import json
import os
import re
import smtplib
import sqlite3
from datetime import datetime
from email.mime.text import MIMEText
from pathlib import Path

import feedparser
import requests
from apscheduler.schedulers.background import BackgroundScheduler
from flask import Flask, jsonify, render_template, request

API_URL = "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/"
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "subscriptions.db"
SNAPSHOT_PATH = DATA_DIR / "daily_snapshots.json"
app = Flask(__name__)
scheduler = BackgroundScheduler()


def ensure_data_files():
    DATA_DIR.mkdir(exist_ok=True)
    if not SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.write_text("[]", encoding="utf-8")


def init_db():
    ensure_data_files()
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            fuel TEXT NOT NULL,
            province TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


def parse_price(value):
    if value is None or value == "":
        return None
    text = str(value).strip().replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def clean_station(station):
    normalized = {}
    for key, value in station.items():
        normalized[key.strip()] = value
    return normalized


def is_coruna_station(station):
    province = str(station.get("Provincia", "")).upper()
    municipio = str(station.get("Municipio", "")).upper()
    return "CORUÑA" in province or "CORUNA" in province or "A CORUÑA" in province or "A CORUNA" in province or "CORUÑA" in municipio or "CORUNA" in municipio


def fuel_price(station, names):
    for name in names:
        value = station.get(name)
        if value is not None and value != "":
            return parse_price(value)
    return None


def load_history():
    history = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    if not isinstance(history, list):
        return []
    return history


def save_history(history):
    SNAPSHOT_PATH.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_current_prices():
    response = requests.get(API_URL, timeout=30)
    response.raise_for_status()
    payload = response.json()
    list_price = payload.get("ListaEESSPrecio", [])
    return [clean_station(station) for station in list_price]


def build_summary_from_stations(stations):
    coruna = [s for s in stations if is_coruna_station(s)]
    if not coruna:
        return {
            "updated_at": datetime.now().strftime("%d/%m/%Y %H:%M"),
            "average_95": 0,
            "average_diesel": 0,
            "top_95": [],
            "top_diesel": [],
            "delta_95": 0,
            "delta_diesel": 0,
        }

    prices_95 = [fuel_price(s, ["Precio Gasolina 95 E5", "Precio Gasolina 95 E10", "Precio Gasolina 95 E25"]) for s in coruna]
    prices_diesel = [fuel_price(s, ["Precio Gasoleo A", "Precio Gasoleo B"]) for s in coruna]
    prices_95 = [p for p in prices_95 if p is not None]
    prices_diesel = [p for p in prices_diesel if p is not None]

    def station_entry(station):
        return {
            "name": station.get("Rótulo", station.get("Localidad", "Estación")),
            "locality": station.get("Localidad", "-"),
            "address": station.get("Dirección", "-"),
            "gasolina95": fuel_price(station, ["Precio Gasolina 95 E5", "Precio Gasolina 95 E10", "Precio Gasolina 95 E25"]),
            "diesel": fuel_price(station, ["Precio Gasoleo A", "Precio Gasoleo B"]),
        }

    top_95 = sorted((station_entry(s) for s in coruna), key=lambda item: (item["gasolina95"] is None, item["gasolina95"] or 99))[:10]
    top_diesel = sorted((station_entry(s) for s in coruna), key=lambda item: (item["diesel"] is None, item["diesel"] or 99))[:10]

    avg_95 = sum(prices_95) / len(prices_95) if prices_95 else 0
    avg_diesel = sum(prices_diesel) / len(prices_diesel) if prices_diesel else 0

    history = load_history()
    previous_day = None
    if history:
        previous_day = history[-1]

    delta_95 = 0
    delta_diesel = 0
    if previous_day is not None:
        delta_95 = round(avg_95 - previous_day.get("average_95", avg_95), 3)
        delta_diesel = round(avg_diesel - previous_day.get("average_diesel", avg_diesel), 3)

    summary = {
        "updated_at": datetime.now().strftime("%d/%m/%Y %H:%M"),
        "average_95": round(avg_95, 3),
        "average_diesel": round(avg_diesel, 3),
        "top_95": top_95,
        "top_diesel": top_diesel,
        "delta_95": round(delta_95, 3),
        "delta_diesel": round(delta_diesel, 3),
    }
    return summary


def persist_daily_snapshot():
    stations = fetch_current_prices()
    summary = build_summary_from_stations(stations)
    history = load_history()
    history.append(
        {
            "date": datetime.now().strftime("%Y-%m-%d"),
            "average_95": summary["average_95"],
            "average_diesel": summary["average_diesel"],
            "updated_at": summary["updated_at"],
        }
    )
    if len(history) > 7:
        history = history[-7:]
    save_history(history)
    return summary


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/summary")
def api_summary():
    try:
        stations = fetch_current_prices()
        summary = build_summary_from_stations(stations)
        return jsonify(summary)
    except Exception as exc:  # pragma: no cover
        return jsonify({"error": str(exc)}), 500


@app.route("/api/subscribe", methods=["POST"])
def subscribe():
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip()
    fuel = (payload.get("fuel") or "gasolina95").strip()
    province = (payload.get("province") or "A Coruña").strip()

    if not email or "@" not in email:
        return jsonify({"ok": False, "message": "Introduce un email válido."}), 400

    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            "INSERT OR IGNORE INTO subscriptions (email, fuel, province, created_at) VALUES (?, ?, ?, ?)",
            (email, fuel, province, datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )
        conn.commit()
    finally:
        conn.close()

    return jsonify({"ok": True, "message": f"Te avisaremos con el resumen diario para {fuel} en {province}."})


@app.route("/api/trigger-digest")
def trigger_digest():
    summary = persist_daily_snapshot()
    conn = sqlite3.connect(DB_PATH)
    subscribers = conn.execute("SELECT email, fuel, province FROM subscriptions").fetchall()
    conn.close()

    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")

    if smtp_host and smtp_user and smtp_password:
        for email, fuel, province in subscribers:
            body = (
                f"Resumen diario de gasolineras en {province}\n"
                f"Media 95: {summary['average_95']} €/L\n"
                f"Media diésel: {summary['average_diesel']} €/L\n"
                f"Cambio respecto a ayer: {summary['delta_95']} €/L gasolina | {summary['delta_diesel']} €/L diésel\n\n"
                f"Gasolineras más baratas:\n"
                + "\n".join(f"- {s['name']} ({s['locality']}): {s['gasolina95']} €/L" for s in summary["top_95"][:5])
            )
            message = MIMEText(body)
            message["Subject"] = "Resumen diario de carburantes en A Coruña"
            message["From"] = smtp_user
            message["To"] = email
            with smtplib.SMTP(smtp_host, smtp_port) as server:
                server.starttls()
                server.login(smtp_user, smtp_password)
                server.sendmail(smtp_user, [email], message.as_string())

    return jsonify({"ok": True, "subscribers": len(subscribers), "summary": summary})


init_db()
late_fetch = persist_daily_snapshot

if __name__ == "__main__":
    scheduler.add_job(persist_daily_snapshot, "cron", hour=7, minute=0, id="daily_snapshot")
    scheduler.start()
    app.run(debug=True, host="0.0.0.0", port=5000)
