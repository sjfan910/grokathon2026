"""Aquatic Twin API: live conditions and the AI operator. Keys stay on the server, in aquatic-twin/.env.

LLM_PROVIDER picks the operator: mock (default, no key, no paid calls), gemini, anthropic or xai.
The browser runs every tool call on the real solver and sends results back. Conversation state
is opaque to it, so all four providers share one loop in web/agent.js.
"""
import json
import os
import re

import requests
from flask import Blueprint, jsonify, request

twin_bp = Blueprint("twin", __name__)

SYSTEM = """You operate a 3D screening model of Lake Erie. Act as a careful experimenter.
Find the cheapest plan that meets the user's goal by testing options with test_plan, then compare the numbers.
Every number you quote must come from a tool result. Say that costs are placeholders and that this is a screening
model, not a forecast. Test at least three different plans before recommending one, and include one that uses
algaecide so its side effects are checked. Call focus_view so the audience can see what you are examining.
When you have a winner, call apply_plan and then explain it in under 120 words."""

ACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": ["alum", "oxygen", "wetland", "upstream", "algaecide"],
                 "description": "alum: tonnes, removes phosphorus in a patch. oxygen: tonnes O2/day at the lake bed. wetland: hectares at the river mouth, cuts inflow phosphorus. upstream: fraction 0 to 0.4, cuts inflow phosphorus. algaecide: tonnes, kills algae fast."},
        "site": {"type": "string", "description": "Where to act: toledo_intake, port_clinton, sandusky, cleveland or maumee."},
        "radius": {"type": "number", "description": "Patch radius in grid cells, about 3 km each. Default 4."},
        "amount": {"type": "number", "description": "Size of the action, in the units for its type."},
    },
    "required": ["type", "amount"],
}

FUNCTIONS = [
    ("get_lake_info", "Current metrics, conditions, sites and source of the lakebed data.", {}, []),
    ("set_scenario", "Change conditions on the live model.", {
        "windSpeed": {"type": "number", "description": "m/s"},
        "windDir": {"type": "number", "description": "degrees the wind comes from"},
        "inflowCfs": {"type": "number", "description": "Maumee flow, ft3/s"},
        "airTempC": {"type": "number"}}, []),
    ("test_plan", "Run a what-if on a copy of the live model. Returns metrics measured from now, after that many days.", {
        "actions": {"type": "array", "items": ACTION_SCHEMA},
        "days": {"type": "number", "description": "Up to 60. Default 30."}}, ["actions"]),
    ("apply_plan", "Apply the chosen actions to the live model the audience is watching.", {
        "actions": {"type": "array", "items": ACTION_SCHEMA}}, ["actions"]),
    ("focus_view", "Point the 3D view at a field or site.", {
        "field": {"type": "string", "enum": ["T", "P", "A", "O", "X", "H"]},
        "site": {"type": "string"},
        "explode": {"type": "number", "description": "0 keeps layers in place, 1 separates them."}}, []),
]


def _schema(props, required):
    return {"type": "object", "properties": props, "required": required}


def _post(url, headers, payload):
    r = requests.post(url, json=payload, headers=headers, timeout=180)
    if not r.ok:
        raise RuntimeError(f"{r.status_code}: {r.text[:500]}")
    return r.json()


# Simulated operator: no LLM. It really runs each plan on the solver and picks from the real results.
MOCK_PLANS = [
    ("doing nothing", []),
    ("algaecide at the intake", [{"type": "algaecide", "site": "toledo_intake", "radius": 6, "amount": 400}]),
    ("alum at the intake", [{"type": "alum", "site": "toledo_intake", "radius": 8, "amount": 8000}]),
    ("wetlands at the river mouth", [{"type": "wetland", "site": "maumee", "amount": 150}]),
    ("alum plus wetlands", [{"type": "alum", "site": "toledo_intake", "radius": 8, "amount": 3000},
                            {"type": "wetland", "site": "maumee", "amount": 100}]),
]


def _mock_turn(state, results):
    goal = state["goal"]
    limit = re.search(r"below\s+([\d.]+)", goal)
    budget = re.search(r"\$\s*([\d.]+)\s*M", goal, re.I)
    limit = float(limit.group(1)) if limit else 1.0
    budget = float(budget.group(1)) * 1e6 if budget else 5e6
    n = state["turn"]
    state["turn"] = n + 1
    if results and 3 <= n <= 2 + len(MOCK_PLANS):
        state["trials"].append(json.loads(results[0]["output"]))
    call = lambda name, args: {"id": f"mock{n}", "name": name, "args": args}
    if n == 0:
        return "Simulated operator: no LLM is connected. These are real solver runs on a fixed list of plans.", [call("focus_view", {"field": "X", "site": "toledo_intake"})]
    if n == 1:
        return None, [call("get_lake_info", {})]
    if n <= len(MOCK_PLANS) + 1:
        name, actions = MOCK_PLANS[n - 2]
        return f"Testing {name}.", [call("test_plan", {"actions": actions, "days": 30})]
    options = [(MOCK_PLANS[m], t) for m, t in enumerate(state["trials"]) if MOCK_PLANS[m][1] and t.get("planCostUsd", 0) <= budget]
    meets = [o for o in options if o[1]["peakIntakeToxin"] <= limit]
    pool = meets or options
    if not pool:
        return "No tested plan fits the budget.", []
    best = min(pool, key=(lambda o: o[1]["planCostUsd"]) if meets else (lambda o: o[1]["peakIntakeToxin"]))
    if n == len(MOCK_PLANS) + 2:
        return f"Applying {best[0][0]}.", [call("apply_plan", {"actions": best[0][1]})]
    base = state["trials"][0]
    verdict = "meets" if meets else "does not meet"
    lines = [f"{MOCK_PLANS[m][0]}: peak toxin {x['peakIntakeToxin']} µg/L, bloom {x['bloomKm2']} km², ${x['planCostUsd'] / 1e6:.1f}M" for m, x in enumerate(state["trials"])]
    return ("Results over 30 days. " + "; ".join(lines) + f". Chosen: {best[0][0]}, which {verdict} the {limit} µg/L limit, "
            f"against {base['peakIntakeToxin']} µg/L for doing nothing. Costs are placeholders and this is a screening model, not a forecast."), []


def _gemini_turn(state, results):
    base = os.getenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta")
    model = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")
    if results:
        state["contents"].append({"role": "user", "parts": [
            {"functionResponse": {"name": r["name"], "response": {"result": r["output"]}}} for r in results]})
    decls = []
    for name, desc, props, req in FUNCTIONS:
        d = {"name": name, "description": desc}
        if props:
            d["parameters"] = _schema(props, req)
        decls.append(d)
    data = _post(f"{base}/models/{model}:generateContent", {"x-goog-api-key": os.environ["GEMINI_API_KEY"]}, {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": state["contents"], "tools": [{"functionDeclarations": decls}]})
    content = data["candidates"][0]["content"]
    state["contents"].append(content)  # kept whole, so Gemini's thought signatures survive the round trip
    text, calls = [], []
    for m, part in enumerate(content.get("parts", [])):
        if part.get("text"):
            text.append(part["text"])
        if part.get("functionCall"):
            fc = part["functionCall"]
            calls.append({"id": f"g{m}", "name": fc["name"], "args": fc.get("args", {})})
    return "\n".join(text) or None, calls


def _anthropic_turn(state, results):
    if results:
        state["messages"].append({"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": r["id"], "content": r["output"]} for r in results]})
    data = _post("https://api.anthropic.com/v1/messages",
                 {"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"}, {
        "model": os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5"), "max_tokens": 2000, "system": SYSTEM,
        "messages": state["messages"],
        "tools": [{"name": n, "description": d, "input_schema": _schema(p, r)} for n, d, p, r in FUNCTIONS]})
    state["messages"].append({"role": "assistant", "content": data["content"]})
    text = "\n".join(b["text"] for b in data["content"] if b["type"] == "text") or None
    return text, [{"id": b["id"], "name": b["name"], "args": b["input"]} for b in data["content"] if b["type"] == "tool_use"]


def _xai_turn(state, results):
    payload = {"model": os.getenv("XAI_MODEL", "grok-4.7"),
               "tools": [{"type": "function", "name": n, "description": d, "parameters": _schema(p, r)} for n, d, p, r in FUNCTIONS]
                        + [{"type": "web_search"}, {"type": "x_search"}]}
    if state.get("previous_response_id"):
        payload["previous_response_id"] = state["previous_response_id"]
        payload["input"] = [{"type": "function_call_output", "call_id": r["id"], "output": r["output"]} for r in results]
    else:
        payload["input"] = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": state["goal"]}]
    data = _post("https://api.x.ai/v1/responses", {"Authorization": f"Bearer {os.environ['XAI_API_KEY']}"}, payload)
    state["previous_response_id"] = data["id"]
    text, calls = [], []
    for item in data.get("output", []):
        if item.get("type") == "message":
            text += [p["text"] for p in item.get("content", []) if p.get("text")]
        elif item.get("type") == "function_call":
            calls.append({"id": item["call_id"], "name": item["name"], "args": json.loads(item.get("arguments") or "{}")})
    return "\n".join(text) or None, calls


PROVIDERS = {
    "mock": ("Simulated (no LLM)", None, _mock_turn, lambda g: {"goal": g, "turn": 0, "trials": []}),
    "gemini": ("Gemini", "GEMINI_API_KEY", _gemini_turn, lambda g: {"contents": [{"role": "user", "parts": [{"text": g}]}]}),
    "anthropic": ("Claude", "ANTHROPIC_API_KEY", _anthropic_turn, lambda g: {"messages": [{"role": "user", "content": g}]}),
    "xai": ("Grok", "XAI_API_KEY", _xai_turn, lambda g: {"goal": g}),
}


def _provider():
    return os.getenv("LLM_PROVIDER", "mock").strip().lower()


@twin_bp.before_request
def local_only():
    # Keys cost money, so operator calls only come from the laptop running the server.
    if request.endpoint == "twin.llm" and request.remote_addr not in ("127.0.0.1", "::1"):
        return jsonify({"error": "The AI operator is only available from the computer running the server."}), 403
    if (request.content_length or 0) > 4_000_000:
        return jsonify({"error": "Request too large."}), 413


@twin_bp.route("/provider")
def provider():
    name = _provider()
    label = PROVIDERS[name][0] if name in PROVIDERS else name
    return jsonify({"provider": name, "label": label})


@twin_bp.route("/llm", methods=["POST"])
def llm():
    name = _provider()
    if name not in PROVIDERS:
        return jsonify({"error": f"Unknown LLM_PROVIDER '{name}'. Use mock, gemini, anthropic or xai."}), 400
    label, key_name, turn, start = PROVIDERS[name]
    if key_name and not os.getenv(key_name):
        return jsonify({"error": f"{key_name} is not set. Add it to aquatic-twin/.env and restart."}), 503
    body = request.get_json(silent=True) or {}
    state = body.get("state") or start(str(body.get("goal", ""))[:2000])
    try:
        text, calls = turn(state, body.get("results") or [])
    except Exception as e:
        return jsonify({"error": f"{label} request failed: {e}. Use Replay saved run, or set LLM_PROVIDER=mock."}), 502
    return jsonify({"provider": name, "label": label, "state": state, "text": text, "calls": calls})


@twin_bp.route("/live")
def live():
    out, errors = {}, []
    try:
        r = requests.get("https://waterservices.usgs.gov/nwis/iv/", timeout=10,
                         params={"sites": "04193500", "parameterCd": "00060", "format": "json"})
        r.raise_for_status()
        out["inflowCfs"] = float(r.json()["value"]["timeSeries"][0]["values"][0]["value"][-1]["value"])
    except Exception as e:
        errors.append(f"USGS: {e}")
    try:
        r = requests.get("https://api.open-meteo.com/v1/forecast", timeout=10, params={
            "latitude": 41.7, "longitude": -83.0, "wind_speed_unit": "ms",
            "current": "wind_speed_10m,wind_direction_10m,temperature_2m"})
        r.raise_for_status()
        cur = r.json()["current"]
        out.update(windSpeed=cur["wind_speed_10m"], windDir=cur["wind_direction_10m"], airTempC=cur["temperature_2m"])
    except Exception as e:
        errors.append(f"Open-Meteo: {e}")
    out["errors"] = errors
    return jsonify(out)
