"""
Bot SuperTrend -> Trading automatique sur Revolut X + alerte Telegram
Tourne sur GitHub Actions
"""

import os
import json
import time
import uuid
import base64
import requests
import pandas as pd
from datetime import datetime
from zoneinfo import ZoneInfo
from nacl.signing import SigningKey
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend

# ---------- CONFIG SIGNAL ----------
SYMBOL = "PEPE-USDT"      # Source du signal (KuCoin, historique fiable)
INTERVAL = "3min"
ATR_PERIOD = 10
MULTIPLIER = 3
STATE_FILE = "state.json"
PARIS_TZ = ZoneInfo("Europe/Paris")

# ---------- CONFIG TRADING ----------
REVX_SYMBOL = "PEPE-USD"       # Paire reellement tradee sur Revolut X
BUY_PERCENT = 0.35             # 35% du solde USD disponible a chaque BUY
MAX_TRADES_PER_DAY = 300       # Securite anti-emballement
STOP_LOSS_PERCENT = 0.10       # Vend automatiquement si -10% depuis l'achat

TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
TELEGRAM_CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]
REVX_API_KEY = os.environ["REVX_API_KEY"]
REVX_PRIVATE_KEY_PEM = os.environ["REVX_PRIVATE_KEY"]
REVX_BASE_URL = "https://revx.revolut.com/api"


# ---------- SIGNAL (KuCoin, inchange) ----------
def get_klines(symbol, interval, limit=100):
    url = "https://api.kucoin.com/api/v1/market/candles"
    params = {"symbol": symbol, "type": interval}
    r = requests.get(url, params=params, timeout=15)
    r.raise_for_status()
    payload = r.json()
    data = payload["data"]
    data = list(reversed(data))[-limit:]
    df = pd.DataFrame(data, columns=[
        "time", "open", "close", "high", "low", "volume", "turnover"
    ])
    for col in ["open", "high", "low", "close"]:
        df[col] = df[col].astype(float)
    return df


def compute_supertrend(df, period=10, multiplier=3):
    hl2 = (df["high"] + df["low"]) / 2
    tr1 = df["high"] - df["low"]
    tr2 = (df["high"] - df["close"].shift()).abs()
    tr3 = (df["low"] - df["close"].shift()).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr = tr.rolling(period).mean()

    upper_band = hl2 + multiplier * atr
    lower_band = hl2 - multiplier * atr

    supertrend = [True] * len(df)

    for i in range(1, len(df)):
        curr_close = df["close"].iloc[i]

        if curr_close > upper_band.iloc[i - 1]:
            supertrend[i] = True
        elif curr_close < lower_band.iloc[i - 1]:
            supertrend[i] = False
        else:
            supertrend[i] = supertrend[i - 1]
            if supertrend[i] and lower_band.iloc[i] < lower_band.iloc[i - 1]:
                lower_band.iloc[i] = lower_band.iloc[i - 1]
            if not supertrend[i] and upper_band.iloc[i] > upper_band.iloc[i - 1]:
                upper_band.iloc[i] = upper_band.iloc[i - 1]

    return supertrend


# ---------- ETAT (state.json) ----------
def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {
        "last_signal": None,
        "trade_count": 0,
        "trade_count_date": "",
        "check_count": 0,
        "check_count_date": "",
        "last_check": "",
    }


def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)


# ---------- SIGNATURE REVOLUT X (Ed25519) ----------
def load_signing_key(pem_str):
    private_key_obj = serialization.load_pem_private_key(
        pem_str.encode(), password=None, backend=default_backend()
    )
    raw_private = private_key_obj.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return SigningKey(raw_private)


SIGNING_KEY = load_signing_key(REVX_PRIVATE_KEY_PEM)


def revx_request(method, path, query="", body_obj=None):
    timestamp = str(int(time.time() * 1000))
    body = json.dumps(body_obj, separators=(",", ":")) if body_obj else ""
    sign_path = f"/api{path}"
    message = f"{timestamp}{method}{sign_path}{query}{body}".encode("utf-8")
    signature = base64.b64encode(SIGNING_KEY.sign(message).signature).decode()

    headers = {
        "X-Revx-API-Key": REVX_API_KEY,
        "X-Revx-Timestamp": timestamp,
        "X-Revx-Signature": signature,
    }
    url = f"{REVX_BASE_URL}{path}"
    if query:
        url += f"?{query}"
    if body_obj:
        headers["Content-Type"] = "application/json"

    if method == "GET":
        r = requests.get(url, headers=headers, timeout=15)
    elif method == "POST":
        r = requests.post(url, headers=headers, data=body, timeout=15)
    else:
        raise ValueError("Methode non supportee")

    r.raise_for_status()
    return r.json()


def get_balance(currency):
    data = revx_request("GET", "/1.0/balances")
    for entry in data:
        if entry["currency"] == currency:
            return float(entry["available"])
    return 0.0


def place_market_order(side, quote_size=None, base_size=None):
    order_config = {}
    if quote_size is not None:
        order_config["market"] = {"quote_size": str(round(quote_size, 2))}
    else:
        order_config["market"] = {"base_size": str(base_size)}

    body = {
        "client_order_id": str(uuid.uuid4()),
        "symbol": REVX_SYMBOL,
        "side": side,
        "order_configuration": order_config,
    }
    return revx_request("POST", "/1.0/orders", body_obj=body)


# ---------- TELEGRAM ----------
def send_telegram(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    r = requests.post(url, data={"chat_id": TELEGRAM_CHAT_ID, "text": message})
    try:
        return r.json()["result"]["message_id"]
    except Exception:
        return None


def delete_telegram(message_id):
    if not message_id:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/deleteMessage"
    try:
        requests.post(url, data={"chat_id": TELEGRAM_CHAT_ID, "message_id": message_id})
    except Exception:
        pass


def get_usd_to_eur_rate():
    try:
        r = requests.get(
            "https://api.frankfurter.app/latest",
            params={"from": "USD", "to": "EUR"},
            timeout=10,
        )
        r.raise_for_status()
        return r.json()["rates"]["EUR"]
    except Exception:
        return None


# ---------- MAIN ----------
def main():
    df = get_klines(SYMBOL, INTERVAL)
    trend = compute_supertrend(df, ATR_PERIOD, MULTIPLIER)
    current_signal = "BUY" if trend[-1] else "SELL"
    price = df["close"].iloc[-1]

    state = load_state()
    last_signal = state.get("last_signal")

    now_str = datetime.now(PARIS_TZ).strftime("%Y-%m-%d %H:%M:%S")
    today = datetime.now(PARIS_TZ).strftime("%Y-%m-%d")

    state["check_count_date"] = today
    state["check_count"] = state.get("check_count", 0) + 1
    state["last_check"] = now_str

    if state.get("trade_count_date") != today:
        state["trade_count"] = 0
        state["trade_count_date"] = today

    # ---------- STOP LOSS : verifie AVANT tout, meme si le signal n'a pas change ----------
    entry_price = state.get("entry_price")
    if entry_price:
        drawdown = (price - entry_price) / entry_price
        if drawdown <= -STOP_LOSS_PERCENT:
            base_currency = REVX_SYMBOL.split("-")[0]
            pepe_balance = get_balance(base_currency)
            if pepe_balance > 0:
                try:
                    place_market_order("sell", base_size=pepe_balance)
                    usd_value = pepe_balance * price
                    rate = get_usd_to_eur_rate()
                    eur_value = usd_value * rate if rate else None
                    eur_str = f" (~€{eur_value:.2f})" if eur_value else ""
                    send_telegram(
                        f"🛑 STOP LOSS TRIGGERED\n{REVX_SYMBOL}\n"
                        f"Loss: {drawdown*100:.1f}%\n"
                        f"Sold: {pepe_balance} PEPE (~${usd_value:.2f}{eur_str})\n"
                        f"Entry: {entry_price:.10f} -> Now: {price:.10f}"
                    )
                    # On force le signal a SELL pour que le bot puisse racheter
                    # normalement des qu'un vrai signal BUY reapparait
                    state["last_signal"] = "SELL"
                    state["entry_price"] = None
                    state["trade_count"] += 1
                    save_state(state)
                    return
                except requests.exceptions.HTTPError as e:
                    send_telegram(f"❌ Stop loss order failed: {e}")

    if current_signal == last_signal:
        print("Pas de changement de tendance. Signal actuel:", current_signal)
        emoji = "🟢" if current_signal == "BUY" else "🔴"
        delete_telegram(state.get("last_status_message_id"))
        new_id = send_telegram(
            f"{emoji} Check {now_str}\n"
            f"Signal: {current_signal} (no change)\n"
            f"Price: {price:.10f}"
        )
        state["last_status_message_id"] = new_id
        save_state(state)
        return

    if state["trade_count"] >= MAX_TRADES_PER_DAY:
        send_telegram(
            f"Signal {current_signal} detecte mais limite de "
            f"{MAX_TRADES_PER_DAY} trades/jour atteinte. Aucun ordre passe."
        )
        state["last_signal"] = current_signal
        save_state(state)
        return

    try:
        if current_signal == "BUY":
            usd_balance = get_balance("USD")
            amount_to_spend = usd_balance * BUY_PERCENT
            if amount_to_spend < 1:
                send_telegram(
                    f"⚠️ BUY signal detected but amount too low "
                    f"(${amount_to_spend:.2f} USD available: ${usd_balance:.2f}). No order placed."
                )
            else:
                result = place_market_order("buy", quote_size=amount_to_spend)
                rate = get_usd_to_eur_rate()
                eur_amount = amount_to_spend * rate if rate else None
                eur_str = f" (~€{eur_amount:.2f})" if eur_amount else ""
                send_telegram(
                    f"🟢 BUY EXECUTED\n{REVX_SYMBOL}\n"
                    f"Amount: ${amount_to_spend:.2f}{eur_str}\n"
                    f"Indicative price: {price:.10f}"
                )
                state["entry_price"] = price
        else:
            base_currency = REVX_SYMBOL.split("-")[0]
            pepe_balance = get_balance(base_currency)
            if pepe_balance <= 0:
                send_telegram("⚠️ SELL signal detected but no PEPE balance. No order placed.")
            else:
                result = place_market_order("sell", base_size=pepe_balance)
                usd_value = pepe_balance * price
                rate = get_usd_to_eur_rate()
                eur_value = usd_value * rate if rate else None
                eur_str = f" (~€{eur_value:.2f})" if eur_value else ""
                send_telegram(
                    f"🔴 SELL EXECUTED\n{REVX_SYMBOL}\n"
                    f"Quantity: {pepe_balance} PEPE\n"
                    f"Value: ~${usd_value:.2f}{eur_str}\n"
                    f"Indicative price: {price:.10f}"
                )
                state["entry_price"] = None

        state["trade_count"] += 1
        state["last_signal"] = current_signal
        save_state(state)

    except requests.exceptions.HTTPError as e:
        send_telegram(f"❌ Error placing {current_signal} order: {e}")
        print("Erreur API Revolut X:", e, e.response.text if e.response else "")


if __name__ == "__main__":
    main()
    
