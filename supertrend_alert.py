"""
Bot d'alerte SuperTrend -> Telegram
Gratuit, tourne sur GitHub Actions (aucun serveur nécessaire)

Configuration : mets ton TOKEN et CHAT_ID dans les "Secrets" GitHub
(voir README plus bas), jamais en dur dans ce fichier.
"""

import os
import json
import requests
import pandas as pd
import numpy as np

# ---------- CONFIG ----------
SYMBOL = "PEPEUSDT"      # Paire sur Binance (pas d'EUR direct dispo, USDT proche de l'EUR)
INTERVAL = "1d"           # 1d, 4h, 1h ...
ATR_PERIOD = 10
MULTIPLIER = 3
STATE_FILE = "state.json"  # garde en mémoire le dernier signal envoyé

TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
TELEGRAM_CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]


def get_klines(symbol, interval, limit=100):
    url = "https://api.binance.com/api/v3/klines"
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    r = requests.get(url, params=params, timeout=15)
    r.raise_for_status()
    data = r.json()
    df = pd.DataFrame(data, columns=[
        "open_time", "open", "high", "low", "close", "volume",
        "close_time", "qav", "trades", "tbbav", "tbqav", "ignore"
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

    supertrend = [True] * len(df)  # True = haussier

    for i in range(1, len(df)):
        curr_close = df["close"].iloc[i]
        prev_close = df["close"].iloc[i - 1]

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


def load_last_signal():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f).get("last_signal")
    return None


def save_last_signal(signal):
    with open(STATE_FILE, "w") as f:
        json.dump({"last_signal": signal}, f)


def send_telegram(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    requests.post(url, data={"chat_id": TELEGRAM_CHAT_ID, "text": message})


def main():
    df = get_klines(SYMBOL, INTERVAL)
    trend = compute_supertrend(df, ATR_PERIOD, MULTIPLIER)
    current_signal = "BUY" if trend[-1] else "SELL"
    last_signal = load_last_signal()

    price = df["close"].iloc[-1]

    if current_signal != last_signal:
        if current_signal == "BUY":
            msg = f"🟢 BUY\n{SYMBOL} — Signal Achat (SuperTrend)\nPrix: {price:.10f}"
        else:
            msg = f"🔴 SELL\n{SYMBOL} — Signal Vente (SuperTrend)\nPrix: {price:.10f}"
        send_telegram(msg)
        save_last_signal(current_signal)
        print("Alerte envoyée:", msg)
    else:
        print("Pas de changement de tendance. Signal actuel:", current_signal)


if __name__ == "__main__":
    main()
