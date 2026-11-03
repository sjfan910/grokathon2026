"""Aquatic Twin API: live conditions and the Grok proxy. The xAI key stays on the server."""
import os

import requests
from flask import Blueprint, jsonify, request

twin_bp = Blueprint("twin", __name__)

XAI_URL = "https://api.x.ai/v1/responses"

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


def _function(name, description, properties, required=None):
    return {"type": "function", "name": name, "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required or []}}


TOOLS = [
    _function("get_lake_info", "Current metrics, conditions, sites and source of the lakebed data.", {}),
    _function("set_scenario", "Change conditions on the live model.", {
        "windSpeed": {"type": "number", "description": "m/s"}, "windDir": {"type": "number", "description": "degrees the wind comes from"},
        "inflowCfs": {"type": "number", "description": "Maumee flow, ft3/s"}, "airTempC": {"type": "number"}}),
    _function("test_plan", "Run a what-if on a copy of the live model and return metrics after that many days.", {
        "actions": {"type": "array", "items": ACTION_SCHEMA}, "days": {"type": "number", "description": "Up to 60. Default 30."}}, ["actions"]),
    _function("apply_plan", "Apply the chosen actions to the live model the audience is watching.", {
        "actions": {"type": "array", "items": ACTION_SCHEMA}}, ["actions"]),
    _function("focus_view", "Point the 3D view at a field or site.", {
        "field": {"type": "string", "enum": ["T", "P", "A", "O", "X", "H"]}, "site": {"type": "string"},
        "explode": {"type": "number", "description": "0 keeps layers in place, 1 separates them."}}),
    {"type": "web_search"},
    {"type": "x_search"},
]


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


@twin_bp.route("/grok", methods=["POST"])
def grok():
    key = os.getenv("XAI_API_KEY")
    if not key:
        return jsonify({"error": "XAI_API_KEY is not set. Add it to backend/.env and restart Flask."}), 503
    body = request.get_json(force=True)
    payload = {"model": os.getenv("XAI_MODEL", "grok-4.7"), "tools": TOOLS, "input": body.get("input", [])}
    if body.get("previous_response_id"):
        payload["previous_response_id"] = body["previous_response_id"]
    else:
        payload["input"] = [{"role": "system", "content": SYSTEM}] + payload["input"]
    try:
        r = requests.post(XAI_URL, json=payload, timeout=180, headers={"Authorization": f"Bearer {key}"})
    except requests.RequestException as e:
        return jsonify({"error": f"Could not reach xAI: {e}"}), 502
    if not r.ok:
        return jsonify({"error": f"xAI returned {r.status_code}: {r.text[:500]}"}), 502
    return jsonify(r.json())
