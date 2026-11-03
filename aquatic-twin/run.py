"""Runs the Aquatic Sustainability site with Aquatic Twin mounted at /water.

aquatic-sustainability/ stays an untouched copy of the BDBI project. Everything we built lives here.
Run from anywhere: python aquatic-twin/run.py, then open http://localhost:5001/water
"""
import os
import secrets
import sys
import types
from pathlib import Path

from dotenv import load_dotenv
from flask import Response, send_from_directory

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent / "aquatic-sustainability" / "backend"
WEB = HERE / "web"

load_dotenv(HERE / ".env")
os.environ.setdefault("SECRET_KEY", secrets.token_hex(32))
sys.path[:0] = [str(BACKEND), str(HERE)]

# Aquatic's routes import its flood model, and so torch, at startup. Defer that until a flood request.
tasks = types.ModuleType("app.tasks")


def run_flood_job(lat, lon):
    from app.flood_model import run_flood_inference
    return run_flood_inference(lat, lon)


tasks.run_flood_job = run_flood_job
sys.modules["app.tasks"] = tasks

from app import create_app  # noqa: E402
from twin_routes import twin_bp  # noqa: E402

app = create_app()
app.register_blueprint(twin_bp, url_prefix="/api/twin")

# Aquatic already routes /water to a page that doesn't exist. This fills it in.
app.view_functions["water"] = lambda: send_from_directory(WEB, "water.html")


@app.route("/twin/<path:filename>")
def twin_static(filename):
    return send_from_directory(WEB, filename)


@app.route("/static/components/navbar.html")
def navbar_with_twin():
    html = (BACKEND / "static" / "components" / "navbar.html").read_text()
    link = '<a data-nav-path="/water" href="/water">Lake Twin</a>\n'
    return Response(html.replace('<a data-nav-path="/about"', link + '<a data-nav-path="/about"', 1), mimetype="text/html")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5001)), debug=False)
