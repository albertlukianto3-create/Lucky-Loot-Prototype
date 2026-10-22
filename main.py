"""
Lucky Loot - FastAPI backend (prototype)
Jalankan:  uvicorn main:app --reload --host 0.0.0.0 --port 8000

Environment variables:
  ADMIN_USERNAME     (default: admin_ll)
  ADMIN_PASSWORD     (default: acak, dicetak di console saat startup)
  WEBHOOK_SECRET     (default: acak, dicetak di console saat startup)
  DB_PATH            (default: lucky_loot.db)
  BANK_NAME / BANK_ACCOUNT / BANK_HOLDER   (info rekening tujuan deposit)
  ANTHROPIC_API_KEY  (opsional, mengaktifkan jawaban AI penuh untuk Riska)
  ANTHROPIC_MODEL    (default: claude-haiku-5-5)
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from typing import List, Literal, Optional

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ----------------------------------------------------------------------------
# Konfigurasi
# ----------------------------------------------------------------------------
DB_PATH = os.getenv("DB_PATH", "lucky_loot.db")
COIN_IDR = 100  # 1 Coin = Rp 100  ->  100 Coin = Rp 10.000
MIN_BET, MAX_BET = 10, 5000
MIN_WITHDRAW_COINS = 100
WITHDRAW_METHODS = ["BCA", "Mandiri", "DANA", "GoPay"]
SESSION_TTL = 7 * 24 * 3600

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin_ll").strip()
_env_admin_pw = os.getenv("ADMIN_PASSWORD")
ADMIN_PASSWORD = _env_admin_pw or secrets.token_urlsafe(16)
_env_hook = os.getenv("WEBHOOK_SECRET")
WEBHOOK_SECRET = _env_hook or secrets.token_urlsafe(24)

BANK_NAME = os.getenv("BANK_NAME", "BCA")
BANK_ACCOUNT = os.getenv("BANK_ACCOUNT", "0000000000")
BANK_HOLDER = os.getenv("BANK_HOLDER", "LUCKY LOOT")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-5-5")

rng = secrets.SystemRandom()  # RNG kriptografis untuk semua game


def now() -> int:
    return int(time.time())


# ----------------------------------------------------------------------------
# Database (SQLite, satu koneksi + lock => transaksi atomik & aman dari race)
# ----------------------------------------------------------------------------
_lock = threading.RLock()
_conn = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
_conn.row_factory = sqlite3.Row


@contextmanager
def tx():
    with _lock:
        _conn.execute("BEGIN IMMEDIATE")
        try:
            yield _conn
            _conn.execute("COMMIT")
        except BaseException:
            _conn.execute("ROLLBACK")
            raise


SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt TEXT NOT NULL, pw_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  coins INTEGER NOT NULL DEFAULT 0 CHECK(coins >= 0),
  deposit_code TEXT UNIQUE,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ledger(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
  delta INTEGER NOT NULL, reason TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS items(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
  name TEXT NOT NULL, tier TEXT NOT NULL, rarity TEXT NOT NULL,
  value INTEGER NOT NULL, sold INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS withdrawals(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
  method TEXT NOT NULL, account_number TEXT NOT NULL, account_name TEXT NOT NULL,
  coins INTEGER NOT NULL, amount_idr INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', note TEXT,
  created_at INTEGER NOT NULL, processed_at INTEGER, processed_by TEXT);
CREATE TABLE IF NOT EXISTS deposits(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
  amount_idr INTEGER NOT NULL, coins INTEGER NOT NULL,
  sender TEXT, bank TEXT, message TEXT,
  dedupe TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bj(user_id INTEGER PRIMARY KEY, state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

# ----------------------------------------------------------------------------
# Data Case (odds dapat diatur admin, disimpan di tabel config)
# ----------------------------------------------------------------------------
RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic"]
TIER_PRICES = {"bronze": 50, "silver": 200, "gold": 500, "platinum": 1500, "ruby": 5000}
TIER_LABEL = {"bronze": "Bronze", "silver": "Silver", "gold": "Gold", "platinum": "Platinum", "ruby": "Ruby"}
PATTERN = [(0.3, 45), (0.6, 30), (1.2, 15), (2, 7), (5, 2.5), (20, 0.5)]  # (kelipatan harga, bobot)
TIER_ITEMS = {
    "bronze": ["Rusty Knife", "Scrap Pistol", "Dusty Gloves", "Copper Rifle", "Iron Karambit", "Bronze Crown"],
    "silver": ["Steel Dagger", "Chrome Pistol", "Silver Wraps", "Mirror Rifle", "Frost Karambit", "Silver Crown"],
    "gold": ["Brass Blade", "Gilded Pistol", "Gold Gloves", "Sunfire Rifle", "Aurum Karambit", "Golden Crown"],
    "platinum": ["Nova Blade", "Plasma Pistol", "Platinum Gloves", "Ion Rifle", "Comet Karambit", "Platinum Crown"],
    "ruby": ["Garnet Blade", "Crimson Pistol", "Ruby Gloves", "Blood Rifle", "Inferno Karambit", "Ruby Crown"],
}


def default_cases() -> dict:
    out = {}
    for tier, price in TIER_PRICES.items():
        out[tier] = {
            "price": price,
            "items": [
                {"name": TIER_ITEMS[tier][i], "value": max(1, round(price * m)), "weight": w}
                for i, (m, w) in enumerate(PATTERN)
            ],
        }
    return out


def init_db():
    with _lock:
        _conn.executescript(SCHEMA)
    with tx() as c:
        if not c.execute("SELECT 1 FROM config WHERE key='cases'").fetchone():
            c.execute("INSERT INTO config(key,value) VALUES('cases',?)", (json.dumps(default_cases()),))
        salt, h = hash_pw(ADMIN_PASSWORD)
        row = c.execute("SELECT id FROM users WHERE username=?", (ADMIN_USERNAME,)).fetchone()
        if row:  # password admin selalu mengikuti environment variable
            c.execute("UPDATE users SET salt=?, pw_hash=?, role='admin' WHERE id=?", (salt, h, row["id"]))
        else:
            c.execute(
                "INSERT INTO users(username,salt,pw_hash,role,coins,deposit_code,created_at) VALUES(?,?,?,?,?,?,?)",
                (ADMIN_USERNAME, salt, h, "admin", 0, new_deposit_code(c), now()),
            )


# ----------------------------------------------------------------------------
# Helper keamanan
# ----------------------------------------------------------------------------
def hash_pw(password: str, salt: Optional[str] = None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000).hex()
    return salt, h


def sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def new_deposit_code(c) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        code = "LL-" + "".join(secrets.choice(alphabet) for _ in range(6))
        if not c.execute("SELECT 1 FROM users WHERE deposit_code=?", (code,)).fetchone():
            return code


def new_session(c, uid: int) -> str:
    token = secrets.token_urlsafe(32)
    c.execute("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)", (sha(token), uid, now() + SESSION_TTL))
    return token


def public_user(r) -> dict:
    return {"id": r["id"], "username": r["username"], "role": r["role"], "coins": r["coins"], "deposit_code": r["deposit_code"]}


_fails: dict = {}


def check_rate(key: str):
    rec = [t for t in _fails.get(key, []) if t > now() - 300]
    _fails[key] = rec
    if len(rec) >= 8:
        raise HTTPException(429, "Terlalu banyak percobaan gagal. Coba lagi dalam 5 menit.")


def current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Silakan login terlebih dahulu")
    th = sha(authorization[7:].strip())
    with tx() as c:
        row = c.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
            (th, now()),
        ).fetchone()
    if not row:
        raise HTTPException(401, "Sesi berakhir, silakan login kembali")
    return row


def optional_user(authorization: Optional[str] = Header(None)):
    try:
        return current_user(authorization)
    except HTTPException:
        return None


def admin_user(user=Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(403, "Akses khusus admin")
    return user


def add_coins(c, uid: int, delta: int, reason: str):
    if delta < 0:
        cur = c.execute("UPDATE users SET coins=coins+? WHERE id=? AND coins>=?", (delta, uid, -delta))
        if cur.rowcount == 0:
            raise HTTPException(400, "Saldo Coin tidak cukup")
    elif delta > 0:
        c.execute("UPDATE users SET coins=coins+? WHERE id=?", (delta, uid))
    if delta:
        c.execute("INSERT INTO ledger(user_id,delta,reason,created_at) VALUES(?,?,?,?)", (uid, delta, reason, now()))


def balance(c, uid: int) -> int:
    return c.execute("SELECT coins FROM users WHERE id=?", (uid,)).fetchone()["coins"]


# ----------------------------------------------------------------------------
# App + CORS
# ----------------------------------------------------------------------------
app = FastAPI(title="Lucky Loot API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,  # token dikirim lewat header Authorization, jadi aman memakai "*"
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    init_db()
    if not _env_admin_pw:
        print(f"[Lucky Loot] ADMIN_PASSWORD tidak diset. Password sementara untuk '{ADMIN_USERNAME}': {ADMIN_PASSWORD}")
    if not _env_hook:
        print(f"[Lucky Loot] WEBHOOK_SECRET tidak diset. Secret sementara: {WEBHOOK_SECRET}")


@app.get("/")
def root():
    return {"app": "Lucky Loot API", "status": "ok"}


# ----------------------------------------------------------------------------
# AUTH
# ----------------------------------------------------------------------------
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")


class Creds(BaseModel):
    username: str = Field(min_length=3, max_length=20)
    password: str = Field(min_length=6, max_length=72)


@app.get("/api/auth/check-username")
def check_username(u: str):
    u = u.strip()
    if not USERNAME_RE.match(u):
        return {"available": False}
    with tx() as c:
        taken = c.execute("SELECT 1 FROM users WHERE username=?", (u,)).fetchone()
    return {"available": not taken and u.lower() != ADMIN_USERNAME.lower()}


@app.post("/api/auth/register")
def register(body: Creds):
    u = body.username.strip()
    if not USERNAME_RE.match(u):
        raise HTTPException(400, "Username hanya boleh huruf, angka, dan underscore (3-20 karakter)")
    if u.lower() == ADMIN_USERNAME.lower():
        raise HTTPException(409, "Username sudah digunakan")
    salt, h = hash_pw(body.password)
    with tx() as c:
        if c.execute("SELECT 1 FROM users WHERE username=?", (u,)).fetchone():  # NOCASE
            raise HTTPException(409, "Username sudah digunakan")
        try:
            cur = c.execute(
                "INSERT INTO users(username,salt,pw_hash,role,coins,deposit_code,created_at) VALUES(?,?,?,?,?,?,?)",
                (u, salt, h, "user", 0, new_deposit_code(c), now()),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Username sudah digunakan")
        uid = cur.lastrowid
        token = new_session(c, uid)
        row = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return {"token": token, "user": public_user(row)}


@app.post("/api/auth/login")
def login(body: Creds, request: Request):
    key = f"{request.client.host if request.client else '?'}|{body.username.lower()}"
    check_rate(key)
    with tx() as c:
        row = c.execute("SELECT * FROM users WHERE username=?", (body.username.strip(),)).fetchone()
        ok = False
        if row:
            _, h = hash_pw(body.password, row["salt"])
            ok = hmac.compare_digest(h, row["pw_hash"])
        if not ok:
            _fails.setdefault(key, []).append(now())
            raise HTTPException(401, "Username atau password salah")
        _fails.pop(key, None)
        token = new_session(c, row["id"])
    return {"token": token, "user": public_user(row)}


@app.post("/api/auth/logout")
def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.lower().startswith("bearer "):
        with tx() as c:
            c.execute("DELETE FROM sessions WHERE token_hash=?", (sha(authorization[7:].strip()),))
    return {"ok": True}


@app.get("/api/me")
def me(user=Depends(current_user)):
    return public_user(user)


# ----------------------------------------------------------------------------
# CASE OPENING
# ----------------------------------------------------------------------------
def load_cases(c) -> dict:
    return json.loads(c.execute("SELECT value FROM config WHERE key='cases'").fetchone()["value"])


def decorate(cfg: dict) -> dict:
    """Tambahkan rarity (berdasar urutan nilai) dan persentase peluang."""
    out = {}
    for tier, d in cfg.items():
        items = d["items"]
        total = sum(i["weight"] for i in items)
        order = sorted(range(len(items)), key=lambda k: items[k]["value"])
        n = len(items)
        rar = {idx: RARITIES[round(pos * 5 / max(1, n - 1))] for pos, idx in enumerate(order)}
        out[tier] = {
            "label": TIER_LABEL.get(tier, tier),
            "price": d["price"],
            "items": [
                {**it, "rarity": rar[k], "chance": round(it["weight"] / total * 100, 3)} for k, it in enumerate(items)
            ],
            "rtp": round(sum(i["weight"] * i["value"] for i in items) / total / d["price"] * 100, 2),
        }
    return out


@app.get("/api/cases")
def list_cases():
    with tx() as c:
        data = decorate(load_cases(c))
    for d in data.values():
        d.pop("rtp", None)  # RTP hanya untuk admin
    return data


WIN_INDEX = 42
TAPE_LEN = 55


@app.post("/api/cases/{tier}/open")
def open_case(tier: str, user=Depends(current_user)):
    with tx() as c:
        cfg = load_cases(c)
        if tier not in cfg:
            raise HTTPException(404, "Case tidak ditemukan")
        deco = decorate(cfg)[tier]
        add_coins(c, user["id"], -deco["price"], f"open_case:{tier}")
        items = deco["items"]
        weights = [i["weight"] for i in items]
        won = rng.choices(items, weights=weights, k=1)[0]
        tape = rng.choices(items, weights=weights, k=TAPE_LEN)
        tape[WIN_INDEX] = won
        cur = c.execute(
            "INSERT INTO items(user_id,name,tier,rarity,value,created_at) VALUES(?,?,?,?,?,?)",
            (user["id"], won["name"], tier, won["rarity"], won["value"], now()),
        )
        bal = balance(c, user["id"])
    strip = lambda i: {"name": i["name"], "value": i["value"], "rarity": i["rarity"]}
    return {
        "item": {**strip(won), "id": cur.lastrowid, "tier": tier},
        "tape": [strip(i) for i in tape],
        "win_index": WIN_INDEX,
        "balance": bal,
    }


# ----------------------------------------------------------------------------
# INVENTORY & JUAL ITEM
# ----------------------------------------------------------------------------
@app.get("/api/inventory")
def inventory(user=Depends(current_user)):
    with tx() as c:
        rows = c.execute("SELECT * FROM items WHERE user_id=? AND sold=0 ORDER BY id DESC", (user["id"],)).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/inventory/{item_id}/sell")
def sell_item(item_id: int, user=Depends(current_user)):
    with tx() as c:
        cur = c.execute("UPDATE items SET sold=1 WHERE id=? AND user_id=? AND sold=0", (item_id, user["id"]))
        if cur.rowcount == 0:
            raise HTTPException(404, "Item tidak ditemukan atau sudah terjual")
        val = c.execute("SELECT value FROM items WHERE id=?", (item_id,)).fetchone()["value"]
        add_coins(c, user["id"], val, f"sell_item:{item_id}")
        bal = balance(c, user["id"])
    return {"sold": val, "balance": bal}


@app.post("/api/inventory/sell-all")
def sell_all(user=Depends(current_user)):
    with tx() as c:
        rows = c.execute("SELECT id,value FROM items WHERE user_id=? AND sold=0", (user["id"],)).fetchall()
        if not rows:
            raise HTTPException(400, "Inventory kosong")
        total = sum(r["value"] for r in rows)
        c.execute("UPDATE items SET sold=1 WHERE user_id=? AND sold=0", (user["id"],))
        add_coins(c, user["id"], total, "sell_all")
        bal = balance(c, user["id"])
    return {"sold": total, "count": len(rows), "balance": bal}


# ----------------------------------------------------------------------------
# ROULETTE (Eropa, 0-36)
# ----------------------------------------------------------------------------
RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}


class RouletteBet(BaseModel):
    bet_type: Literal["red", "black", "green", "odd", "even", "low", "high", "dozen1", "dozen2", "dozen3", "number"]
    number: Optional[int] = Field(default=None, ge=0, le=36)
    amount: int = Field(ge=MIN_BET, le=MAX_BET)


def roulette_multiplier(b: RouletteBet, n: int) -> int:
    if b.bet_type == "number":
        return 36 if n == b.number else 0
    if b.bet_type == "green":
        return 36 if n == 0 else 0
    if n == 0:
        return 0
    simple = {
        "red": n in RED, "black": n not in RED, "odd": n % 2 == 1, "even": n % 2 == 0,
        "low": n <= 18, "high": n >= 19,
    }
    if b.bet_type in simple:
        return 2 if simple[b.bet_type] else 0
    dz = {"dozen1": (1, 12), "dozen2": (13, 24), "dozen3": (25, 36)}[b.bet_type]
    return 3 if dz[0] <= n <= dz[1] else 0


@app.post("/api/games/roulette")
def roulette(b: RouletteBet, user=Depends(current_user)):
    if b.bet_type == "number" and b.number is None:
        raise HTTPException(400, "Pilih angka 0-36")
    with tx() as c:
        add_coins(c, user["id"], -b.amount, "roulette:bet")
        n = rng.randint(0, 36)
        mult = roulette_multiplier(b, n)
        payout = b.amount * mult
        if payout:
            add_coins(c, user["id"], payout, "roulette:win")
        bal = balance(c, user["id"])
    color = "green" if n == 0 else ("red" if n in RED else "black")
    return {"number": n, "color": color, "multiplier": mult, "payout": payout, "win": payout > 0, "balance": bal}


# ----------------------------------------------------------------------------
# SLOT MACHINE (RTP sekitar 89%)
# ----------------------------------------------------------------------------
SLOT_SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣"]
SLOT_WEIGHTS = [30, 25, 20, 12, 8, 5]
SLOT_TRIPLE = {"🍒": 5, "🍋": 8, "🔔": 15, "⭐": 30, "💎": 60, "7️⃣": 150}


class SlotBet(BaseModel):
    amount: int = Field(ge=MIN_BET, le=MAX_BET)


@app.post("/api/games/slots")
def slots(b: SlotBet, user=Depends(current_user)):
    with tx() as c:
        add_coins(c, user["id"], -b.amount, "slots:bet")
        reels = rng.choices(SLOT_SYMBOLS, weights=SLOT_WEIGHTS, k=3)
        if reels[0] == reels[1] == reels[2]:
            mult = float(SLOT_TRIPLE[reels[0]])
        else:
            ch = reels.count("🍒")
            mult = 1.0 if ch == 2 else (0.5 if ch == 1 else 0.0)
        payout = int(b.amount * mult)
        if payout:
            add_coins(c, user["id"], payout, "slots:win")
        bal = balance(c, user["id"])
    return {"reels": reels, "multiplier": mult, "payout": payout, "win": payout > b.amount, "balance": bal}


# ----------------------------------------------------------------------------
# BLACKJACK (4 deck, dealer stand di 17, BJ bayar 3:2)
# ----------------------------------------------------------------------------
RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
SUITS = ["♠", "♥", "♦", "♣"]


def new_deck():
    d = [{"r": r, "s": s} for r in RANKS for s in SUITS] * 4
    rng.shuffle(d)
    return d


def hand_val(h) -> int:
    total, aces = 0, 0
    for card in h:
        if card["r"] == "A":
            aces += 1
            total += 11
        elif card["r"] in ("J", "Q", "K"):
            total += 10
        else:
            total += int(card["r"])
    while total > 21 and aces:
        total -= 10
        aces -= 1
    return total


def bj_view(st: dict, bal: Optional[int] = None) -> dict:
    done = st["done"]
    dealer = st["dealer"] if done else [st["dealer"][0], {"hidden": True}]
    return {
        "active": not done, "bet": st["bet"], "player": st["player"], "dealer": dealer,
        "player_value": hand_val(st["player"]),
        "dealer_value": hand_val(st["dealer"]) if done else hand_val(st["dealer"][:1]),
        "outcome": st.get("outcome"), "payout": st.get("payout", 0),
        "can_double": (not done) and len(st["player"]) == 2 and not st.get("doubled"),
        "balance": bal,
    }


def bj_save(c, uid, st):
    c.execute("INSERT OR REPLACE INTO bj(user_id,state) VALUES(?,?)", (uid, json.dumps(st)))


def bj_finish(c, uid, st, outcome):
    bet = st["bet"]
    payout = {"blackjack": bet * 5 // 2, "win": bet * 2, "push": bet, "lose": 0}[outcome]
    st.update(done=True, outcome=outcome, payout=payout)
    if payout:
        add_coins(c, uid, payout, f"blackjack:{outcome}")
    c.execute("DELETE FROM bj WHERE user_id=?", (uid,))
    return bj_view(st, balance(c, uid))


def bj_stand(c, uid, st):
    while hand_val(st["dealer"]) < 17:
        st["dealer"].append(st["deck"].pop())
    pv, dv = hand_val(st["player"]), hand_val(st["dealer"])
    if pv > 21:
        out = "lose"
    elif dv > 21 or pv > dv:
        out = "win"
    elif pv == dv:
        out = "push"
    else:
        out = "lose"
    return bj_finish(c, uid, st, out)


def bj_load(c, uid):
    row = c.execute("SELECT state FROM bj WHERE user_id=?", (uid,)).fetchone()
    if not row:
        raise HTTPException(400, "Tidak ada permainan Blackjack yang aktif")
    return json.loads(row["state"])


@app.get("/api/games/blackjack/state")
def bj_state(user=Depends(current_user)):
    with tx() as c:
        row = c.execute("SELECT state FROM bj WHERE user_id=?", (user["id"],)).fetchone()
        if not row:
            return {"active": False, "balance": balance(c, user["id"])}
        return bj_view(json.loads(row["state"]), balance(c, user["id"]))


@app.post("/api/games/blackjack/start")
def bj_start(b: SlotBet, user=Depends(current_user)):
    uid = user["id"]
    with tx() as c:
        if c.execute("SELECT 1 FROM bj WHERE user_id=?", (uid,)).fetchone():
            raise HTTPException(400, "Selesaikan permainan Blackjack yang sedang berjalan")
        add_coins(c, uid, -b.amount, "blackjack:bet")
        deck = new_deck()
        st = {"deck": deck, "player": [deck.pop(), deck.pop()], "dealer": [deck.pop(), deck.pop()],
              "bet": b.amount, "done": False, "doubled": False}
        pbj, dbj = hand_val(st["player"]) == 21, hand_val(st["dealer"]) == 21
        if pbj and dbj:
            return bj_finish(c, uid, st, "push")
        if pbj:
            return bj_finish(c, uid, st, "blackjack")
        if dbj:
            return bj_finish(c, uid, st, "lose")
        bj_save(c, uid, st)
        return bj_view(st, balance(c, uid))


@app.post("/api/games/blackjack/hit")
def bj_hit(user=Depends(current_user)):
    uid = user["id"]
    with tx() as c:
        st = bj_load(c, uid)
        st["player"].append(st["deck"].pop())
        pv = hand_val(st["player"])
        if pv > 21:
            return bj_finish(c, uid, st, "lose")
        if pv == 21:
            return bj_stand(c, uid, st)
        bj_save(c, uid, st)
        return bj_view(st, balance(c, uid))


@app.post("/api/games/blackjack/stand")
def bj_stand_ep(user=Depends(current_user)):
    with tx() as c:
        st = bj_load(c, user["id"])
        return bj_stand(c, user["id"], st)


@app.post("/api/games/blackjack/double")
def bj_double(user=Depends(current_user)):
    uid = user["id"]
    with tx() as c:
        st = bj_load(c, uid)
        if len(st["player"]) != 2 or st.get("doubled"):
            raise HTTPException(400, "Double hanya bisa pada 2 kartu pertama")
        add_coins(c, uid, -st["bet"], "blackjack:double")
        st["bet"] *= 2
        st["doubled"] = True
        st["player"].append(st["deck"].pop())
        if hand_val(st["player"]) > 21:
            return bj_finish(c, uid, st, "lose")
        return bj_stand(c, uid, st)


# ----------------------------------------------------------------------------
# DEPOSIT (info + webhook otomatis dari HP Android)
# ----------------------------------------------------------------------------
@app.get("/api/deposit/info")
def deposit_info(user=Depends(current_user)):
    with tx() as c:
        rows = c.execute(
            "SELECT id,amount_idr,coins,status,created_at FROM deposits WHERE user_id=? ORDER BY id DESC LIMIT 20",
            (user["id"],),
        ).fetchall()
    return {
        "rate": "100 Coin = Rp 10.000", "coin_idr": COIN_IDR, "code": user["deposit_code"],
        "bank_name": BANK_NAME, "bank_account": BANK_ACCOUNT, "bank_holder": BANK_HOLDER,
        "history": [dict(r) for r in rows],
    }


class DepositHook(BaseModel):
    message: str = Field(default="", max_length=2000)
    amount: Optional[int] = Field(default=None, ge=1)
    sender: Optional[str] = Field(default=None, max_length=100)
    bank: Optional[str] = Field(default=None, max_length=50)
    ref: Optional[str] = Field(default=None, max_length=100)


def parse_amount(text: str) -> Optional[int]:
    m = re.search(r"Rp\.?\s*([\d.,]+)", text, re.I)
    if not m:
        return None
    s = re.sub(r",\d{1,2}$", "", m.group(1).strip(".,"))
    digits = re.sub(r"[^\d]", "", s)
    return int(digits) if digits else None


@app.post("/api/webhook/bank-deposit")
def bank_deposit(body: DepositHook, x_webhook_secret: Optional[str] = Header(None)):
    """
    Dipanggil Tasker/MacroDroid saat notifikasi mobile banking masuk.
    Header : X-Webhook-Secret: <WEBHOOK_SECRET>
    Body   : {"message": "<isi notifikasi>", "sender": "...", "bank": "BCA", "ref": "<id unik opsional>"}
             atau {"amount": 50000, "message": "LL-ABC123"}
    User dikenali dari kode deposit (LL-XXXXXX) yang ditulis di berita/catatan transfer.
    """
    if not x_webhook_secret or not hmac.compare_digest(x_webhook_secret, WEBHOOK_SECRET):
        raise HTTPException(401, "Webhook secret tidak valid")
    text = body.message or ""
    amount = body.amount
    if amount is None:
        if not re.search(r"masuk|diterima|terima|transfer|kredit|received|credit", text, re.I):
            return {"status": "ignored", "reason": "bukan notifikasi dana masuk"}
        amount = parse_amount(text)
    if not amount or amount <= 0:
        raise HTTPException(400, "Nominal tidak terbaca")
    dedupe = sha(body.ref) if body.ref else sha(f"{text}|{body.sender}|{amount}|{now() // 60}")
    coins = amount // COIN_IDR
    m = re.search(r"LL[-\s]?([A-Z0-9]{6})", text.upper())
    code = f"LL-{m.group(1)}" if m else None
    with tx() as c:
        if c.execute("SELECT 1 FROM deposits WHERE dedupe=?", (dedupe,)).fetchone():
            return {"status": "duplicate"}
        urow = c.execute("SELECT id,username FROM users WHERE deposit_code=?", (code,)).fetchone() if code else None
        if urow:
            c.execute(
                "INSERT INTO deposits(user_id,amount_idr,coins,sender,bank,message,dedupe,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (urow["id"], amount, coins, body.sender, body.bank, text[:500], dedupe, "credited", now()),
            )
            add_coins(c, urow["id"], coins, f"deposit:{amount}")
            return {"status": "credited", "username": urow["username"], "coins": coins}
        c.execute(
            "INSERT INTO deposits(user_id,amount_idr,coins,sender,bank,message,dedupe,status,created_at) VALUES(NULL,?,?,?,?,?,?,?,?)",
            (amount, coins, body.sender, body.bank, text[:500], dedupe, "unmatched", now()),
        )
    return {"status": "unmatched", "detail": "Kode deposit tidak ditemukan, menunggu penugasan admin"}


# ----------------------------------------------------------------------------
# WITHDRAW (Pending sampai di-approve admin)
# ----------------------------------------------------------------------------
class WithdrawReq(BaseModel):
    method: Literal["BCA", "Mandiri", "DANA", "GoPay"]
    account_number: str = Field(min_length=5, max_length=20)
    account_name: str = Field(min_length=2, max_length=60)
    coins: int = Field(ge=MIN_WITHDRAW_COINS, le=1_000_000)


@app.post("/api/withdraw")
def withdraw(b: WithdrawReq, user=Depends(current_user)):
    if not re.fullmatch(r"\d{5,20}", b.account_number.strip()):
        raise HTTPException(400, "Nomor rekening/e-wallet hanya boleh angka")
    with tx() as c:
        add_coins(c, user["id"], -b.coins, "withdraw:hold")
        cur = c.execute(
            "INSERT INTO withdrawals(user_id,method,account_number,account_name,coins,amount_idr,status,created_at) VALUES(?,?,?,?,?,?,'pending',?)",
            (user["id"], b.method, b.account_number.strip(), b.account_name.strip(), b.coins, b.coins * COIN_IDR, now()),
        )
        bal = balance(c, user["id"])
    return {"id": cur.lastrowid, "status": "pending", "amount_idr": b.coins * COIN_IDR, "balance": bal}


@app.get("/api/withdrawals")
def my_withdrawals(user=Depends(current_user)):
    with tx() as c:
        rows = c.execute("SELECT * FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 30", (user["id"],)).fetchall()
    return [dict(r) for r in rows]


# ----------------------------------------------------------------------------
# CHATBOT CS AI "RISKA"
# ----------------------------------------------------------------------------
class ChatMsg(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=1000)


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    history: List[ChatMsg] = Field(default_factory=list, max_length=20)


RISKA_SYSTEM = (
    "Kamu adalah Riska, agen Customer Service AI untuk platform Lucky Loot. Jawab dalam Bahasa Indonesia, ramah, singkat, jelas. "
    "Fakta platform: 100 Coin = Rp 10.000 (1 Coin = Rp 100). Deposit via transfer bank dengan menulis kode deposit user (format LL-XXXXXX) "
    "di berita transfer; Coin masuk otomatis dalam hitungan menit. Withdraw minimal 100 Coin ke BCA, Mandiri, DANA, atau GoPay; status Pending "
    "sampai disetujui admin, dan Coin ditahan selama pending (dikembalikan jika ditolak). Game: Case Opening (Bronze, Silver, Gold, Platinum, Ruby), "
    "Roulette Eropa 0-36 (merah/hitam/ganjil/genap/1-18/19-36 x2, lusin x3, angka tunggal & hijau 0 x36), Blackjack (dealer stand di 17, Blackjack bayar 3:2, "
    "ada Double), Slot 3 reel. Item hasil case bisa dijual ke Coin. Taruhan min 10 Coin, maks 5.000 Coin. Jangan menjanjikan kemenangan; "
    "ingatkan bermain bijak. Jika masalah tidak bisa diselesaikan, minta user menyiapkan username, nominal, dan bukti transfer untuk diteruskan ke admin. "
    "Jangan pernah meminta password."
)


def riska_rules(msg: str, user) -> str:
    t = msg.lower()
    has = lambda *k: any(x in t for x in k)
    code = f" Kode deposit kamu: {user['deposit_code']}." if user else " Login dulu untuk melihat kode deposit pribadimu."
    if has("belum masuk", "tidak masuk", "ga masuk", "gak masuk", "kendala deposit", "deposit gagal", "saldo belum"):
        return ("Maaf atas kendalanya. Cek dulu: (1) berita transfer memuat kode deposit LL-XXXXXX milikmu, (2) nominal sudah benar. "
                "Deposit biasanya masuk otomatis dalam 1-5 menit." + code +
                " Jika lewat 15 menit, kirim username, nominal, dan bukti transfer, nanti admin bantu cocokkan manual.")
    if has("withdraw", "wd", "tarik", "cairkan", "cash out", "cashout"):
        extra = ""
        if user:
            extra = f" Saldo kamu saat ini {user['coins']:,} Coin.".replace(",", ".")
        return ("Withdraw minimal 100 Coin (Rp 10.000) ke BCA, Mandiri, DANA, atau GoPay lewat menu Kasir. Coin langsung ditahan dan status "
                "menjadi Pending sampai admin menyetujui. Jika ditolak, Coin dikembalikan penuh." + extra)
    if has("deposit", "top up", "topup", "top-up", "isi saldo", "beli coin", "tukar"):
        return ("Rate: 100 Coin = Rp 10.000. Transfer ke rekening di menu Kasir > Deposit dan tulis kode deposit pribadimu di berita transfer. "
                "Coin masuk otomatis setelah transfer terdeteksi." + code)
    if has("roulette"):
        return ("Roulette Eropa 0-36. Merah/Hitam, Ganjil/Genap, 1-18, 19-36 membayar x2. Lusin (1-12, 13-24, 25-36) x3. Angka tunggal atau Hijau (0) x36. "
                "Angka 0 mengalahkan taruhan merah/hitam/ganjil/genap/rendah/tinggi.")
    if has("blackjack", "bj"):
        return ("Blackjack: kalahkan dealer dengan total mendekati 21 tanpa lewat. Dealer berhenti di 17. Blackjack (As + 10) bayar 3:2, menang biasa x2, seri uang kembali. "
                "Kamu bisa Hit, Stand, atau Double (pada 2 kartu pertama).")
    if has("slot"):
        return ("Slot 3 reel: tiga simbol sama membayar x5 sampai x150 (7️⃣ tertinggi). Dua 🍒 mengembalikan taruhan (x1), satu 🍒 membayar x0,5.")
    if has("case", "peti", "odds", "peluang", "drop", "bronze", "silver", "gold", "platinum", "ruby"):
        return ("Ada 5 tier case: Bronze, Silver, Gold, Platinum, Ruby. Peluang tiap item tampil jelas di halaman Case. "
                "Item yang didapat masuk Inventory dan bisa dijual langsung menjadi Coin.")
    if has("jual", "sell", "inventory", "item"):
        return "Buka menu Inventory lalu tekan Jual pada item, atau Jual Semua. Coin masuk seketika sesuai nilai item."
    if has("aturan", "rule", "cara main", "main"):
        return "Pilih game di menu atas: Case, Roulette, Blackjack, atau Slot. Taruhan 10-5.000 Coin per putaran. Mau aku jelaskan aturan game tertentu?"
    if has("lupa password", "reset password", "password"):
        return "Demi keamanan, Riska tidak pernah meminta atau melihat password. Untuk reset, hubungi admin dengan menyebutkan username dan bukti kepemilikan akun."
    if has("halo", "hai", "hi", "pagi", "siang", "sore", "malam", "hello"):
        return "Halo! Aku Riska dari Lucky Loot. Mau tanya soal deposit, withdraw, atau aturan game?"
    if has("terima kasih", "makasih", "thanks", "thx"):
        return "Sama-sama! Selamat bermain dan tetap bijak ya."
    return ("Aku bisa bantu soal deposit, withdraw, aturan Roulette/Blackjack/Slot, dan Case Opening. "
            "Coba tanyakan salah satunya, atau jelaskan kendalamu lebih detail.")


def riska_llm(message: str, history: List[ChatMsg], user) -> Optional[str]:
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return None
    msgs: list = []
    for h in history[-10:] + [ChatMsg(role="user", content=message)]:
        if msgs and msgs[-1]["role"] == h.role:
            msgs[-1]["content"] += "\n" + h.content
        elif msgs or h.role == "user":
            msgs.append({"role": h.role, "content": h.content})
    ctx = f"\nKonteks user: username={user['username']}, saldo={user['coins']} Coin, kode_deposit={user['deposit_code']}." if user else "\nUser belum login."
    try:
        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": ANTHROPIC_MODEL, "max_tokens": 400, "system": RISKA_SYSTEM + ctx, "messages": msgs},
            timeout=15,
        )
        r.raise_for_status()
        text = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text").strip()
        return text or None
    except Exception:
        return None


@app.post("/api/chat")
def chat(body: ChatIn, user=Depends(optional_user)):
    reply = riska_llm(body.message, body.history, user) or riska_rules(body.message, user)
    return {"agent": "Riska", "reply": reply}


# ----------------------------------------------------------------------------
# ADMIN (semua endpoint wajib role "admin")
# ----------------------------------------------------------------------------
@app.get("/api/admin/stats")
def admin_stats(_=Depends(admin_user)):
    with tx() as c:
        q = lambda sql: c.execute(sql).fetchone()[0] or 0
        return {
            "users": q("SELECT COUNT(*) FROM users WHERE role='user'"),
            "coins_in_circulation": q("SELECT SUM(coins) FROM users WHERE role='user'"),
            "deposit_idr_total": q("SELECT SUM(amount_idr) FROM deposits WHERE status='credited'"),
            "pending_withdrawals": q("SELECT COUNT(*) FROM withdrawals WHERE status='pending'"),
            "pending_withdraw_idr": q("SELECT SUM(amount_idr) FROM withdrawals WHERE status='pending'"),
            "paid_withdraw_idr": q("SELECT SUM(amount_idr) FROM withdrawals WHERE status='approved'"),
            "unmatched_deposits": q("SELECT COUNT(*) FROM deposits WHERE status='unmatched'"),
        }


@app.get("/api/admin/users")
def admin_users(_=Depends(admin_user)):
    with tx() as c:
        rows = c.execute("SELECT id,username,role,coins,deposit_code,created_at FROM users ORDER BY id DESC LIMIT 200").fetchall()
    return [dict(r) for r in rows]


class CoinAdjust(BaseModel):
    delta: int = Field(ge=-1_000_000, le=1_000_000)
    note: str = Field(default="", max_length=100)


@app.post("/api/admin/users/{uid}/coins")
def admin_adjust(uid: int, b: CoinAdjust, adm=Depends(admin_user)):
    with tx() as c:
        if not c.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
            raise HTTPException(404, "User tidak ditemukan")
        add_coins(c, uid, b.delta, f"admin:{adm['username']}:{b.note}")
        return {"balance": balance(c, uid)}


@app.get("/api/admin/withdrawals")
def admin_withdrawals(status: Optional[str] = None, _=Depends(admin_user)):
    sql = "SELECT w.*, u.username FROM withdrawals w JOIN users u ON u.id=w.user_id"
    args: tuple = ()
    if status:
        sql += " WHERE w.status=?"
        args = (status,)
    with tx() as c:
        rows = c.execute(sql + " ORDER BY w.id DESC LIMIT 200", args).fetchall()
    return [dict(r) for r in rows]


class Decision(BaseModel):
    note: str = Field(default="", max_length=200)


def _decide(wid: int, status: str, note: str, adm):
    with tx() as c:
        w = c.execute("SELECT * FROM withdrawals WHERE id=?", (wid,)).fetchone()
        if not w:
            raise HTTPException(404, "Withdraw tidak ditemukan")
        if w["status"] != "pending":
            raise HTTPException(400, "Withdraw sudah diproses")
        c.execute(
            "UPDATE withdrawals SET status=?, note=?, processed_at=?, processed_by=? WHERE id=?",
            (status, note, now(), adm["username"], wid),
        )
        if status == "rejected":
            add_coins(c, w["user_id"], w["coins"], f"withdraw:refund:{wid}")
    return {"id": wid, "status": status}


@app.post("/api/admin/withdrawals/{wid}/approve")
def approve_wd(wid: int, b: Decision = Decision(), adm=Depends(admin_user)):
    return _decide(wid, "approved", b.note, adm)


@app.post("/api/admin/withdrawals/{wid}/reject")
def reject_wd(wid: int, b: Decision = Decision(), adm=Depends(admin_user)):
    return _decide(wid, "rejected", b.note, adm)


@app.get("/api/admin/cases")
def admin_get_cases(_=Depends(admin_user)):
    with tx() as c:
        return decorate(load_cases(c))


class CaseItem(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    value: int = Field(ge=0, le=10_000_000)
    weight: float = Field(gt=0, le=1_000_000)


class CaseUpdate(BaseModel):
    price: int = Field(ge=1, le=1_000_000)
    items: List[CaseItem] = Field(min_length=2, max_length=12)


@app.put("/api/admin/cases/{tier}")
def admin_set_case(tier: str, b: CaseUpdate, _=Depends(admin_user)):
    with tx() as c:
        cfg = load_cases(c)
        if tier not in cfg:
            raise HTTPException(404, "Tier tidak ditemukan")
        cfg[tier] = {"price": b.price, "items": [i.model_dump() for i in b.items]}
        c.execute("UPDATE config SET value=? WHERE key='cases'", (json.dumps(cfg),))
        return decorate(cfg)[tier]


@app.get("/api/admin/deposits")
def admin_deposits(status: Optional[str] = "unmatched", _=Depends(admin_user)):
    with tx() as c:
        rows = c.execute("SELECT * FROM deposits WHERE status=? ORDER BY id DESC LIMIT 100", (status,)).fetchall()
    return [dict(r) for r in rows]


class Assign(BaseModel):
    username: str = Field(min_length=3, max_length=20)


@app.post("/api/admin/deposits/{did}/assign")
def admin_assign(did: int, b: Assign, adm=Depends(admin_user)):
    with tx() as c:
        d = c.execute("SELECT * FROM deposits WHERE id=? AND status='unmatched'", (did,)).fetchone()
        if not d:
            raise HTTPException(404, "Deposit tidak ditemukan / sudah diproses")
        u = c.execute("SELECT id FROM users WHERE username=?", (b.username.strip(),)).fetchone()
        if not u:
            raise HTTPException(404, "Username tidak ditemukan")
        c.execute("UPDATE deposits SET user_id=?, status='credited' WHERE id=?", (u["id"], did))
        add_coins(c, u["id"], d["coins"], f"deposit:manual:{did}:{adm['username']}")
    return {"ok": True, "coins": d["coins"]}
