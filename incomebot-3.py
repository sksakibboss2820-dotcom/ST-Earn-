import os
import re
import sqlite3
import json
import time
import hmac
import hashlib
import asyncio
import logging
import threading
from urllib.parse import parse_qsl, urlparse, parse_qs
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime
from telegram import (
    Update, InlineKeyboardButton, InlineKeyboardMarkup,
    ReplyKeyboardMarkup, KeyboardButton, ReplyKeyboardRemove, WebAppInfo,
)
from telegram.ext import (
    Application, CommandHandler, MessageHandler, CallbackQueryHandler,
    ContextTypes, filters, ConversationHandler, ApplicationHandlerStop
)
import telegram.error

logging.basicConfig(level=logging.INFO)

# ================================================================
#   ⚙️  CONFIG — হোস্টিং করার আগে এখানে সব বসিয়ে নিন (এই একটা জায়গাতেই)
# ================================================================
BOT_TOKEN          = os.environ.get("BOT_TOKEN") or "8970348269:AAE-NUYwaH1CJ3vWutbfk2qnb1brzn3iwmA"
ADMIN_ID           = 7163496323
SUPPORT_USERNAME   = "BDincometvadmin_sakib"
REQUIRED_CHANNELS  = [
    "@BDincomeTV",
]
DB_PATH = "income.db"
LINE = "━━━━━━━━━━━━━━━━━━━━━━"

# Mini App (Telegram Web App) URL — Render-এ deploy করার পর যেই HTTPS URL
# পাবেন (যেমন https://ns-coin-3.onrender.com) তার সাথে "/webapp" জুড়ে বসান।
# Telegram Web App বাটনের জন্য HTTPS বাধ্যতামূলক — Render নিজেই এটা দেয়।
WEBAPP_BASE_URL = "https://st-earn.onrender.com"

DEFAULT_AD_LINK = "https://example.com/your-ad-smartlink"

DEFAULT_ANNOUNCEMENT_BN = (
    "🎉 <b>স্বাগতম!</b>\n"
    f"{LINE}\n"
    "✅ প্রতিদিন সহজ কাজ করে আয় করুন\n"
    "✅ রেফার করে বাড়তি বোনাস নিন\n"
    "✅ দ্রুত bKash/Nagad withdraw\n\n"
    "📌 এখনই 💰 Earn Now বাটনে চাপুন!"
)

DEFAULT_RULES_BN = (
    "📜 <b>নিয়মাবলী</b>\n"
    f"{LINE}\n"
    "1️⃣ প্রতিটা টাস্কে সত্যিই ad/link ভিজিট করুন, তাড়াতাড়ি claim করলে reject হতে পারে\n"
    "2️⃣ প্রতিদিন একটা নির্দিষ্ট সংখ্যক টাস্কই করা যাবে\n"
    "3️⃣ Fake ক্লিক/বট ব্যবহার করলে অ্যাকাউন্ট ব্যান করা হবে\n"
    "4️⃣ Withdraw এর জন্য সর্বনিম্ন ব্যালেন্স লাগবে\n"
    "5️⃣ কোনো সমস্যা হলে Support বাটনে যোগাযোগ করুন\n\n"
    "🙏 নিয়ম মেনে আয় করুন, নিরাপদ থাকুন।"
)

DEFAULT_RULES_EN = (
    "📜 <b>Rules</b>\n"
    f"{LINE}\n"
    "1️⃣ Actually visit the ad/link for each task — claiming too fast may be rejected\n"
    "2️⃣ There's a daily limit on how many tasks you can complete\n"
    "3️⃣ Using bots/fake clicks will result in a ban\n"
    "4️⃣ A minimum balance is required to withdraw\n"
    "5️⃣ For any issue, contact via the Support button\n\n"
    "🙏 Follow the rules, stay safe."
)

# ================================================================
#   ভাষা / টেক্সট
# ================================================================
LANG = {
    "bn": {
        "btn_earn"        : "💰 Earn Now",
        "btn_miniapp"     : "🌐 Mini App খুলুন",
        "btn_balance"     : "💳 আমার Balance",
        "btn_referral"    : "🔗 রেফারেল",
        "btn_history"     : "📊 History",
        "btn_support"     : "🎧 Support",
        "btn_rules"       : "📜 নিয়মাবলী",
        "btn_lang"        : "🌐 Language",
        "btn_claim"       : "✅ Claim Reward",
        "btn_withdraw"    : "💸 Withdraw",
        "btn_cancel"      : "❌ বাতিল",
        "welcome": (
            "👋 <b>স্বাগতম, {{name}}!</b>\n"
            f"{LINE}\n"
            "প্রতিদিন সহজ কাজ (Ad দেখা) করে আয় করুন, রেফার করে বাড়তি বোনাস নিন।\n\n"
            "👇 নিচের মেনু থেকে শুরু করুন।"
        ),
        "join_required": (
            "🔒 <b>বট ব্যবহার করতে আগে চ্যানেলে জয়েন করতে হবে</b>\n"
            "নিচের চ্যানেল(গুলো)-এ জয়েন করে ✅ Check বাটনে চাপুন।"
        ),
        "join_fail"     : "⚠️ এখনো সব চ্যানেলে জয়েন করেননি। জয়েন করে আবার Check চাপুন।",
        "join_btn"      : "📢 Join",
        "join_check_btn": "✅ Check",
        "join_check_error": "⚠️ যাচাই করা যাচ্ছে না। কিছুক্ষণ পর আবার চেষ্টা করুন।",
        "lang_set"      : "✅ ভাষা বাংলা করা হয়েছে।",
        "unknown_command": (
            "❌ <b>ভুল কমান্ড!</b>\n\n"
            "অনুগ্রহ করে নিচের মেনু থেকে একটি অপশন নির্বাচন করুন।"
        ),
        "maintenance_default": "🛠️ বট রক্ষণাবেক্ষণ চলছে, কিছুক্ষণ পর আবার চেষ্টা করুন।",
        "earn_task": (
            "💰 <b>নতুন টাস্ক!</b>\n"
            f"{LINE}\n"
            "👉 নিচের লিংকে ক্লিক করে কমপক্ষে <b>{{seconds}} সেকেন্ড</b> পেজে থাকুন, তারপর ফিরে এসে Claim চাপুন।\n\n"
            "🔗 {{link}}\n\n"
            "💵 রিওয়ার্ড: <b>{{reward}}৳</b>"
        ),
        "earn_too_soon": "⏳ এখনো সময় হয়নি! আরও <b>{{sec}} সেকেন্ড</b> অপেক্ষা করুন।",
        "earn_limit_reached": (
            "🚫 <b>আজকের টাস্ক লিমিট শেষ!</b>\n"
            "আগামীকাল আবার চেষ্টা করুন।"
        ),
        "earn_success": (
            "✅ <b>Reward পেয়েছেন!</b>\n"
            f"{LINE}\n"
            "💵 <b>+{{reward}}৳</b> আপনার balance-এ যোগ হয়েছে।\n"
            "📊 আজ সম্পন্ন: <b>{{done}}/{{limit}}</b>"
        ),
        "balance_msg": (
            "💰 <b>আপনার Balance</b>\n"
            f"{LINE}\n"
            "💵 বর্তমান ব্যালেন্স:  <b>{{balance}}৳</b>\n"
            "📈 সর্বমোট আয়:      <b>{{total}}৳</b>"
        ),
        "withdraw_below_min": "⚠️ Withdraw করতে সর্বনিম্ন <b>{{min}}৳</b> লাগবে। আপনার ব্যালেন্স: {{balance}}৳",
        "withdraw_choose_method": "💳 কোন মেথডে টাকা নিতে চান?",
        "withdraw_ask_number": "{{icon}} <b>{{method}}</b> নম্বর দিন (01 দিয়ে শুরু, ১১ ডিজিট):",
        "withdraw_number_invalid": "⚠️ সঠিক নম্বর দিন (01 দিয়ে শুরু, ১১ ডিজিট)।",
        "withdraw_submitted": (
            "✅ <b>Withdraw রিকোয়েস্ট জমা হয়েছে!</b>\n"
            f"{LINE}\n"
            "💵 এমাউন্ট: <b>{{amount}}৳</b>\n"
            "🆔 রিকোয়েস্ট: <b>#{{wid}}</b>\n"
            "⏳ যাচাই করে দ্রুত পাঠানো হবে।"
        ),
        "referral_text": (
            "🔗 <b>আপনার রেফারেল লিংক</b>\n"
            f"{LINE}\n"
            "বন্ধুদের এই লিংক শেয়ার করুন:\n\n"
            "👉 {{link}}\n\n"
            f"{LINE}\n"
            "👥 মোট রেফার করেছেন:  <b>{{count}}</b> জন\n"
            "💰 প্রতি রেফারে পাবেন (প্রথম টাস্কে):  <b>{{bonus}}৳</b>\n\n"
            "💡 বন্ধু প্রথম টাস্ক শেষ করলেই বোনাস পাবেন!"
        ),
        "referral_joined_notify": "👋 আপনার রেফারেল লিংক দিয়ে একজন জয়েন করেছে। প্রথম টাস্ক শেষ করলেই বোনাস পাবেন।",
        "referral_bonus_notify": (
            "🎉 <b>রেফারেল বোনাস পেয়েছেন!</b>\n"
            "আপনার রেফার করা একজন প্রথম টাস্ক সম্পন্ন করেছে।\n"
            "💰 <b>{{bonus}}৳</b> যোগ হয়েছে।"
        ),
        "history_empty": "📊 এখনো কোনো টাস্ক/লেনদেন নেই।",
        "history_header": "📊 <b>সাম্প্রতিক কার্যক্রম</b>\n{LINE}\n{{items}}",
    },
    "en": {
        "btn_earn"        : "💰 Earn Now",
        "btn_miniapp"     : "🌐 Open Mini App",
        "btn_balance"     : "💳 My Balance",
        "btn_referral"    : "🔗 Referral",
        "btn_history"     : "📊 History",
        "btn_support"     : "🎧 Support",
        "btn_rules"       : "📜 Rules",
        "btn_lang"        : "🌐 Language",
        "btn_claim"       : "✅ Claim Reward",
        "btn_withdraw"    : "💸 Withdraw",
        "btn_cancel"      : "❌ Cancel",
        "welcome": (
            "👋 <b>Welcome, {{name}}!</b>\n"
            f"{LINE}\n"
            "Earn daily by completing simple tasks (viewing ads), and get bonus by referring friends.\n\n"
            "👇 Start from the menu below."
        ),
        "join_required": (
            "🔒 <b>You must join our channel(s) to use this bot</b>\n"
            "Join the channel(s) below, then tap ✅ Check."
        ),
        "join_fail"     : "⚠️ You haven't joined all channels yet. Join, then tap Check again.",
        "join_btn"      : "📢 Join",
        "join_check_btn": "✅ Check",
        "join_check_error": "⚠️ Couldn't verify. Please try again shortly.",
        "lang_set"      : "✅ Language set to English.",
        "unknown_command": (
            "❌ <b>Unknown command!</b>\n\n"
            "Please choose an option from the menu below."
        ),
        "maintenance_default": "🛠️ Bot under maintenance, please try again later.",
        "earn_task": (
            "💰 <b>New Task!</b>\n"
            f"{LINE}\n"
            "👉 Click the link below and stay on the page for at least <b>{{seconds}} seconds</b>, then come back and tap Claim.\n\n"
            "🔗 {{link}}\n\n"
            "💵 Reward: <b>{{reward}}৳</b>"
        ),
        "earn_too_soon": "⏳ Not yet! Wait <b>{{sec}} more seconds</b>.",
        "earn_limit_reached": (
            "🚫 <b>Today's task limit reached!</b>\n"
            "Please try again tomorrow."
        ),
        "earn_success": (
            "✅ <b>Reward received!</b>\n"
            f"{LINE}\n"
            "💵 <b>+{{reward}}৳</b> added to your balance.\n"
            "📊 Completed today: <b>{{done}}/{{limit}}</b>"
        ),
        "balance_msg": (
            "💰 <b>Your Balance</b>\n"
            f"{LINE}\n"
            "💵 Current balance:  <b>{{balance}}৳</b>\n"
            "📈 Total earned:      <b>{{total}}৳</b>"
        ),
        "withdraw_below_min": "⚠️ Minimum <b>{{min}}৳</b> required to withdraw. Your balance: {{balance}}৳",
        "withdraw_choose_method": "💳 Which method would you like to withdraw to?",
        "withdraw_ask_number": "{{icon}} Enter your <b>{{method}}</b> number (starts with 01, 11 digits):",
        "withdraw_number_invalid": "⚠️ Please enter a valid number (starts with 01, 11 digits).",
        "withdraw_submitted": (
            "✅ <b>Withdraw request submitted!</b>\n"
            f"{LINE}\n"
            "💵 Amount: <b>{{amount}}৳</b>\n"
            "🆔 Request: <b>#{{wid}}</b>\n"
            "⏳ Will be verified and sent soon."
        ),
        "referral_text": (
            "🔗 <b>Your Referral Link</b>\n"
            f"{LINE}\n"
            "Share this link with friends:\n\n"
            "👉 {{link}}\n\n"
            f"{LINE}\n"
            "👥 Total referred:  <b>{{count}}</b>\n"
            "💰 Bonus per referral (on their first task):  <b>{{bonus}}৳</b>\n\n"
            "💡 You'll get the bonus once your friend completes their first task!"
        ),
        "referral_joined_notify": "👋 Someone joined using your referral link. You'll get a bonus once they complete their first task.",
        "referral_bonus_notify": (
            "🎉 <b>Referral Bonus Received!</b>\n"
            "A user you referred completed their first task.\n"
            "💰 <b>{{bonus}}৳</b> added."
        ),
        "history_empty": "📊 No tasks/transactions yet.",
        "history_header": "📊 <b>Recent Activity</b>\n{LINE}\n{{items}}",
    },
}

def t(user_id: int, key: str, **kwargs) -> str:
    lang = get_user_lang(user_id)
    text = LANG[lang].get(key, LANG["bn"].get(key, key))
    for k, v in kwargs.items():
        text = text.replace("{{" + k + "}}", str(v))
    return text

# ================================================================
#   DATABASE
# ================================================================
def get_conn():
    return sqlite3.connect(DB_PATH)

def init_db():
    conn = get_conn()
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id       INTEGER PRIMARY KEY,
            lang          TEXT DEFAULT 'bn',
            referrer_id   INTEGER,
            referral_paid INTEGER DEFAULT 0,
            balance       REAL DEFAULT 0,
            total_earned  REAL DEFAULT 0,
            tasks_today   INTEGER DEFAULT 0,
            last_task_date TEXT,
            joined_at     TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS tasks_log (
            task_id    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER,
            reward     REAL,
            created_at TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS withdrawals (
            withdraw_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER,
            amount      REAL,
            method      TEXT,
            number      TEXT,
            status      TEXT DEFAULT 'pending',
            created_at  TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS webapp_sessions (
            user_id    INTEGER PRIMARY KEY,
            task_start REAL
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS wallets (
            user_id INTEGER,
            method  TEXT,
            number  TEXT,
            PRIMARY KEY (user_id, method)
        )
    """)
    conn.commit()
    conn.close()

def get_setting(key, default=None):
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT value FROM settings WHERE key=?", (key,))
    row = c.fetchone()
    conn.close()
    return row[0] if row else default

def set_setting(key, value):
    conn = get_conn()
    c = conn.cursor()
    c.execute("INSERT INTO settings (key, value) VALUES (?, ?) "
              "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(value)))
    conn.commit()
    conn.close()

def ensure_user_exists(user_id: int):
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT user_id FROM users WHERE user_id=?", (user_id,))
    if not c.fetchone():
        c.execute("INSERT INTO users (user_id, joined_at) VALUES (?, ?)",
                  (user_id, datetime.utcnow().isoformat()))
        conn.commit()
    conn.close()

def get_user_lang(user_id: int) -> str:
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT lang FROM users WHERE user_id=?", (user_id,))
    row = c.fetchone()
    conn.close()
    return row[0] if row and row[0] else "bn"

def set_user_lang(user_id: int, lang: str):
    ensure_user_exists(user_id)
    conn = get_conn()
    c = conn.cursor()
    c.execute("UPDATE users SET lang=? WHERE user_id=?", (lang, user_id))
    conn.commit()
    conn.close()

def get_balance(user_id: int) -> float:
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT balance FROM users WHERE user_id=?", (user_id,))
    row = c.fetchone()
    conn.close()
    return row[0] if row else 0.0

def get_total_earned(user_id: int) -> float:
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT total_earned FROM users WHERE user_id=?", (user_id,))
    row = c.fetchone()
    conn.close()
    return row[0] if row else 0.0

def add_balance(user_id: int, amount: float):
    ensure_user_exists(user_id)
    conn = get_conn()
    c = conn.cursor()
    c.execute("UPDATE users SET balance=balance+?, total_earned=total_earned+? WHERE user_id=?",
              (amount, max(amount, 0), user_id))
    conn.commit()
    conn.close()

def deduct_balance(user_id: int, amount: float):
    conn = get_conn()
    c = conn.cursor()
    c.execute("UPDATE users SET balance=balance-? WHERE user_id=?", (amount, user_id))
    conn.commit()
    conn.close()

def get_task_progress(user_id: int):
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT tasks_today, last_task_date FROM users WHERE user_id=?", (user_id,))
    row = c.fetchone()
    conn.close()
    today = datetime.utcnow().strftime("%Y-%m-%d")
    if not row:
        return 0, today
    tasks_today, last_date = row
    if last_date != today:
        return 0, today
    return tasks_today or 0, today

def record_task_completion(user_id: int, reward: float):
    tasks_today, today = get_task_progress(user_id)
    conn = get_conn()
    c = conn.cursor()
    c.execute("UPDATE users SET tasks_today=?, last_task_date=? WHERE user_id=?",
              (tasks_today + 1, today, user_id))
    c.execute("INSERT INTO tasks_log (user_id, reward, created_at) VALUES (?, ?, ?)",
              (user_id, reward, datetime.utcnow().isoformat()))
    conn.commit()
    conn.close()
    add_balance(user_id, reward)
    return tasks_today + 1

def get_referrer(user_id: int):
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT referrer_id FROM users WHERE user_id=?", (user_id,))
    row = c.fetchone()
    conn.close()
    return row[0] if row and row[0] else None

def set_referrer(user_id: int, referrer_id: int) -> bool:
    ensure_user_exists(user_id)
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT referrer_id FROM users WHERE user_id=?", (user_id,))
    row = c.fetchone()
    if row and row[0]:
        conn.close()
        return False
    c.execute("UPDATE users SET referrer_id=? WHERE user_id=?", (referrer_id, user_id))
    conn.commit()
    conn.close()
    return True

def mark_referral_paid(user_id: int):
    conn = get_conn()
    c = conn.cursor()
    c.execute("UPDATE users SET referral_paid=1 WHERE user_id=?", (user_id,))
    conn.commit()
    conn.close()

def is_referral_paid(user_id: int) -> bool:
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT referral_paid FROM users WHERE user_id=?", (user_id,))
    row = c.fetchone()
    conn.close()
    return bool(row and row[0])

def get_referral_count(user_id: int) -> int:
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM users WHERE referrer_id=?", (user_id,))
    count = c.fetchone()[0]
    conn.close()
    return count or 0

def get_total_tasks_done(user_id: int) -> int:
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM tasks_log WHERE user_id=?", (user_id,))
    count = c.fetchone()[0]
    conn.close()
    return count or 0

def get_webapp_task_start(user_id: int):
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT task_start FROM webapp_sessions WHERE user_id=?", (user_id,))
    row = c.fetchone()
    conn.close()
    return row[0] if row else None

def set_webapp_task_start(user_id: int, ts):
    conn = get_conn()
    c = conn.cursor()
    c.execute("INSERT INTO webapp_sessions (user_id, task_start) VALUES (?, ?) "
              "ON CONFLICT(user_id) DO UPDATE SET task_start=excluded.task_start", (user_id, ts))
    conn.commit()
    conn.close()

def get_recent_activity(user_id: int, limit=5):
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT reward, created_at FROM tasks_log WHERE user_id=? ORDER BY task_id DESC LIMIT ?",
              (user_id, limit))
    rows = c.fetchall()
    conn.close()
    return rows

def save_wallet(user_id, method, number):
    conn = get_conn()
    c = conn.cursor()
    c.execute("INSERT INTO wallets (user_id, method, number) VALUES (?, ?, ?) "
              "ON CONFLICT(user_id, method) DO UPDATE SET number=excluded.number",
              (user_id, method, number))
    conn.commit()
    conn.close()

def get_wallet(user_id, method):
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT number FROM wallets WHERE user_id=? AND method=?", (user_id, method))
    row = c.fetchone()
    conn.close()
    return row[0] if row else None

def get_all_user_ids() -> list:
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT user_id FROM users")
    rows = c.fetchall()
    conn.close()
    return [r[0] for r in rows]

def get_pending_withdrawals():
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM withdrawals WHERE status='pending' ORDER BY withdraw_id DESC")
    rows = c.fetchall()
    conn.close()
    return rows

def save_withdrawal(user_id, amount, method, number):
    conn = get_conn()
    c = conn.cursor()
    c.execute("INSERT INTO withdrawals (user_id, amount, method, number, created_at) VALUES (?, ?, ?, ?, ?)",
              (user_id, amount, method, number, datetime.utcnow().isoformat()))
    conn.commit()
    wid = c.lastrowid
    conn.close()
    return wid

def get_withdrawal(wid):
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM withdrawals WHERE withdraw_id=?", (wid,))
    row = c.fetchone()
    conn.close()
    return row

def update_withdrawal_status(wid, status):
    conn = get_conn()
    c = conn.cursor()
    c.execute("UPDATE withdrawals SET status=? WHERE withdraw_id=?", (status, wid))
    conn.commit()
    conn.close()

def get_stats() -> dict:
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM users")
    users = c.fetchone()[0] or 0
    c.execute("SELECT COUNT(*) FROM tasks_log")
    total_tasks = c.fetchone()[0] or 0
    c.execute("SELECT SUM(reward) FROM tasks_log")
    total_paid_out = c.fetchone()[0] or 0
    c.execute("SELECT COUNT(*) FROM withdrawals WHERE status='pending'")
    pending_withdrawals = c.fetchone()[0] or 0
    c.execute("SELECT SUM(amount) FROM withdrawals WHERE status='paid'")
    total_withdrawn = c.fetchone()[0] or 0
    conn.close()
    return {
        "users": users, "total_tasks": total_tasks, "total_paid_out": int(total_paid_out),
        "pending_withdrawals": pending_withdrawals, "total_withdrawn": int(total_withdrawn),
    }

# ── Admin-editable settings ──
def get_task_reward() -> float:
    return float(get_setting("task_reward", "1"))

def get_daily_task_limit() -> int:
    return int(float(get_setting("daily_task_limit", "5")))

def get_task_wait_seconds() -> int:
    return int(float(get_setting("task_wait_seconds", "15")))

def get_referral_bonus() -> float:
    return float(get_setting("referral_bonus", "2"))

def get_min_withdraw() -> float:
    return float(get_setting("min_withdraw", "20"))

def get_ad_link() -> str:
    return get_setting("ad_link", DEFAULT_AD_LINK)

def is_maintenance() -> bool:
    return get_setting("maintenance", "0") == "1"

def set_maintenance(on: bool):
    set_setting("maintenance", "1" if on else "0")

def get_maintenance_msg(lang: str) -> str:
    return get_setting(f"maintenance_msg_{lang}", LANG[lang]["maintenance_default"])

def get_announcement() -> str:
    return get_setting("announcement", "")

def set_announcement(text: str):
    set_setting("announcement", text)

def get_required_channels() -> list:
    raw = get_setting("required_channels", None)
    if raw is None:
        set_setting("required_channels", json.dumps(REQUIRED_CHANNELS))
        return list(REQUIRED_CHANNELS)
    try:
        return json.loads(raw)
    except Exception:
        return list(REQUIRED_CHANNELS)

def set_required_channels(channels: list):
    set_setting("required_channels", json.dumps(channels))

def add_required_channel(channel: str) -> bool:
    channel = channel.strip()
    if not channel.startswith("@"):
        channel = "@" + channel
    channels = get_required_channels()
    if channel in channels:
        return False
    channels.append(channel)
    set_required_channels(channels)
    return True

def remove_required_channel(channel: str) -> bool:
    channel = channel.strip()
    if not channel.startswith("@"):
        channel = "@" + channel
    channels = get_required_channels()
    if channel not in channels:
        return False
    channels.remove(channel)
    set_required_channels(channels)
    return True

def get_support_username() -> str:
    return get_setting("support_username", SUPPORT_USERNAME)

def mask_number(number):
    if not number or len(number) < 6:
        return number
    return number[:3] + "*" * (len(number) - 6) + number[-3:]

def method_icon(method: str) -> str:
    return {"bKash": "💗", "Nagad": "🟠"}.get(method, "💰")

# ================================================================
#   TELEGRAM WEB APP (Mini App) — initData ভেরিফিকেশন
# ================================================================
def validate_init_data(init_data: str):
    """Telegram WebApp থেকে আসা initData আসল কিনা যাচাই করে।
    সঠিক হলে Telegram user dict রিটার্ন করে, ভুল/জাল হলে None।"""
    try:
        if not init_data:
            logging.warning("[webapp-debug] initData is EMPTY — client থেকে কিছুই আসেনি")
            return None
        parsed = dict(parse_qsl(init_data, keep_blank_values=True))
        received_hash = parsed.pop("hash", None)
        logging.info(f"[webapp-debug] raw initData: {init_data[:300]}")
        logging.info(f"[webapp-debug] parsed keys: {list(parsed.keys())}, received_hash: {received_hash}")
        if not received_hash:
            logging.warning("[webapp-debug] no hash field found in initData")
            return None
        data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))
        secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
        computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        logging.info(f"[webapp-debug] computed_hash: {computed_hash} vs received_hash: {received_hash}")
        if not hmac.compare_digest(computed_hash, received_hash):
            logging.warning("[webapp-debug] HASH MISMATCH — BOT_TOKEN ভুল হতে পারে অথবা initData পুরনো/মেয়াদোত্তীর্ণ")
            return None
        user_json = parsed.get("user")
        if not user_json:
            logging.warning("[webapp-debug] no user field in initData")
            return None
        return json.loads(user_json)
    except Exception as e:
        logging.warning(f"[webapp] initData validation failed: {e}")
        return None

MINIAPP_HTML = """<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Income Bot</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, 'Segoe UI', Roboto, sans-serif;
    background: linear-gradient(160deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
    color: #fff; min-height: 100vh; padding: 16px 14px 32px;
  }
  .header { text-align: center; margin-bottom: 18px; }
  .header h1 {
    font-size: 22px; font-weight: 800;
    background: linear-gradient(90deg, #ffd86f, #fc6262);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .header p { color: #b8b3d9; font-size: 13px; margin-top: 4px; }
  .card {
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 18px; padding: 18px; margin-bottom: 14px;
    backdrop-filter: blur(10px);
  }
  .balance-card { text-align: center; }
  .balance-label { color: #b8b3d9; font-size: 13px; }
  .balance-amount {
    font-size: 40px; font-weight: 800; margin: 6px 0;
    background: linear-gradient(90deg, #7ee8fa, #66a6ff);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .stats-row { display: flex; justify-content: space-around; margin-top: 12px; }
  .stat { text-align: center; }
  .stat-num { font-size: 18px; font-weight: 700; }
  .stat-label { font-size: 11px; color: #b8b3d9; }
  .btn {
    display: block; width: 100%; padding: 14px; border: none; border-radius: 14px;
    font-size: 15px; font-weight: 700; cursor: pointer; margin-top: 10px;
    transition: transform .1s;
  }
  .btn:active { transform: scale(0.97); }
  .btn-primary { background: linear-gradient(90deg, #ff9966, #ff5e62); color: #fff; }
  .btn-secondary { background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .section-title { font-size: 14px; font-weight: 700; margin-bottom: 8px; color: #ffd86f; }
  .ref-link {
    background: rgba(0,0,0,0.25); border-radius: 10px; padding: 10px 12px;
    font-size: 12px; word-break: break-all; color: #7ee8fa; margin-bottom: 10px;
  }
  .status-msg { text-align: center; font-size: 13px; color: #b8b3d9; margin-top: 8px; min-height: 18px; }
  .loading { text-align: center; padding: 40px 0; color: #b8b3d9; }
</style>
</head>
<body>
  <div class="header">
    <h1>💰 Income Bot</h1>
    <p>প্রতিদিন কাজ করুন, আয় করুন</p>
  </div>

  <div id="app"><div class="loading">লোড হচ্ছে...</div></div>

<script>
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();
const initData = tg.initData || "";

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({initData, ...body})
  });
  return res.json();
}

let state = {};

async function loadMe() {
  const data = await api("/api/me", {});
  if (data.error) {
    document.getElementById("app").innerHTML = `<div class="card"><p>⚠️ ${data.error}</p></div>`;
    return;
  }
  state = data;
  render();
}

function render() {
  const limitTxt = state.daily_limit == 0 ? "∞" : state.daily_limit;
  document.getElementById("app").innerHTML = `
    <div class="card balance-card">
      <div class="balance-label">আপনার Balance</div>
      <div class="balance-amount">${state.balance}৳</div>
      <div class="stats-row">
        <div class="stat"><div class="stat-num">${state.total_earned}৳</div><div class="stat-label">মোট আয়</div></div>
        <div class="stat"><div class="stat-num">${state.tasks_today}/${limitTxt}</div><div class="stat-label">আজকের টাস্ক</div></div>
        <div class="stat"><div class="stat-num">${state.referral_count}</div><div class="stat-label">রেফার</div></div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">💰 Earn Now</div>
      <button class="btn btn-primary" id="earnBtn" onclick="startTask()">🚀 টাস্ক শুরু করুন (+${state.task_reward}৳)</button>
      <div class="status-msg" id="earnStatus"></div>
    </div>

    <div class="card">
      <div class="section-title">🔗 রেফারেল লিংক</div>
      <div class="ref-link">${state.referral_link}</div>
      <button class="btn btn-secondary" onclick="copyRef()">📋 লিংক কপি করুন</button>
    </div>

    <div class="card">
      <div class="section-title">💳 Withdraw</div>
      <p style="font-size:12px;color:#b8b3d9;">সর্বনিম্ন উইথড্র: ${state.min_withdraw}৳ — বটে ফিরে গিয়ে "আমার Balance" থেকে withdraw করুন।</p>
    </div>
  `;
}

function copyRef() {
  navigator.clipboard.writeText(state.referral_link);
  tg.showAlert("✅ লিংক কপি হয়েছে!");
}

async function startTask() {
  const btn = document.getElementById("earnBtn");
  const status = document.getElementById("earnStatus");
  const data = await api("/api/start-task", {});
  if (data.error) { status.textContent = "⚠️ " + data.error; return; }
  tg.openLink(data.ad_link);
  btn.disabled = true;
  let remaining = data.wait_seconds;
  status.textContent = `⏳ ${remaining} সেকেন্ড অপেক্ষা করুন...`;
  const timer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = "✅ Claim Reward";
      btn.onclick = claimTask;
      status.textContent = "এখন Claim করুন!";
    } else {
      status.textContent = `⏳ ${remaining} সেকেন্ড অপেক্ষা করুন...`;
    }
  }, 1000);
}

async function claimTask() {
  const status = document.getElementById("earnStatus");
  const data = await api("/api/claim", {});
  if (data.error) { status.textContent = "⚠️ " + data.error; return; }
  tg.showAlert(`✅ +${data.reward}৳ পেয়েছেন!`);
  loadMe();
}

loadMe();
</script>
</body>
</html>
"""

# ================================================================
#   RENDER / HOSTING: HTTP সার্ভার (health-check + Mini App + postback)
# ================================================================
class _HealthCheckHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/postback"):
            self._handle_postback()
            return
        if self.path.startswith("/webapp"):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(MINIAPP_HTML.encode("utf-8"))
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"OK - IncomeBot is running")

    def do_HEAD(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            body = json.loads(raw or b"{}")
        except Exception:
            self._json_response(400, {"error": "Bad request"})
            return

        init_data = body.get("initData", "")
        tg_user = validate_init_data(init_data)
        if not tg_user:
            self._json_response(401, {"error": "যাচাই ব্যর্থ, বটের ভেতর থেকে খুলুন"})
            return
        uid = tg_user.get("id")
        ensure_user_exists(uid)

        if self.path == "/api/me":
            self._api_me(uid)
        elif self.path == "/api/start-task":
            self._api_start_task(uid)
        elif self.path == "/api/claim":
            self._api_claim(uid)
        else:
            self._json_response(404, {"error": "Not found"})

    def _api_me(self, uid):
        balance = get_balance(uid)
        total = get_total_earned(uid)
        tasks_today, _ = get_task_progress(uid)
        ref_count = get_referral_count(uid)
        bot_username = get_setting("bot_username", "")
        ref_link = f"https://t.me/{bot_username}?start=ref_{uid}" if bot_username else f"start=ref_{uid}"
        self._json_response(200, {
            "balance": round(balance, 2), "total_earned": round(total, 2),
            "tasks_today": tasks_today, "daily_limit": get_daily_task_limit(),
            "referral_count": ref_count, "referral_link": ref_link,
            "task_reward": get_task_reward(), "min_withdraw": get_min_withdraw(),
        })

    def _api_start_task(self, uid):
        tasks_today, _ = get_task_progress(uid)
        limit = get_daily_task_limit()
        if limit > 0 and tasks_today >= limit:
            self._json_response(200, {"error": "আজকের টাস্ক লিমিট শেষ! আগামীকাল আসুন।"})
            return
        set_webapp_task_start(uid, time.time())
        self._json_response(200, {
            "ad_link": get_ad_link(), "wait_seconds": get_task_wait_seconds(),
        })

    def _api_claim(self, uid):
        start_ts = get_webapp_task_start(uid)
        seconds = get_task_wait_seconds()
        if not start_ts or (time.time() - start_ts) < seconds:
            self._json_response(200, {"error": "এখনো সময় হয়নি!"})
            return
        tasks_today, _ = get_task_progress(uid)
        limit = get_daily_task_limit()
        if limit > 0 and tasks_today >= limit:
            self._json_response(200, {"error": "আজকের টাস্ক লিমিট শেষ!"})
            return
        reward = get_task_reward()
        record_task_completion(uid, reward)
        set_webapp_task_start(uid, None)
        if not is_referral_paid(uid):
            referrer_id = get_referrer(uid)
            if referrer_id:
                bonus = get_referral_bonus()
                add_balance(referrer_id, bonus)
                mark_referral_paid(uid)
        self._json_response(200, {"reward": reward})

    def _json_response(self, code, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _handle_postback(self):
        # ভবিষ্যতে Ad network Postback/S2S সাপোর্ট করলে এই endpoint ব্যবহার করে
        # স্বয়ংক্রিয়ভাবে verified reward দেওয়া যাবে:
        # https://yourdomain.com/postback?uid=123&secret=YOUR_SECRET
        query = parse_qs(urlparse(self.path).query)
        uid = query.get("uid", [None])[0]
        secret = query.get("secret", [None])[0]
        expected_secret = get_setting("postback_secret", "changeme123")
        if secret != expected_secret or not uid:
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"Forbidden")
            return
        try:
            reward = get_task_reward()
            record_task_completion(int(uid), reward)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"OK")
        except Exception:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(b"Error")

    def log_message(self, format, *args):
        pass

def _run_health_server():
    port = int(os.environ.get("PORT", 10000))
    server = ThreadingHTTPServer(("0.0.0.0", port), _HealthCheckHandler)
    server.serve_forever()

def start_health_server():
    threading.Thread(target=_run_health_server, daemon=True).start()


# ================================================================
#   DB BACKUP
# ================================================================
async def send_db_backup(bot):
    try:
        if os.path.exists(DB_PATH):
            with open(DB_PATH, "rb") as f:
                await bot.send_document(
                    chat_id=ADMIN_ID, document=f,
                    filename=f"income_backup_{datetime.utcnow().strftime('%Y%m%d_%H%M')}.db",
                    caption="💾 Database Backup"
                )
    except Exception as e:
        logging.error(f"Backup failed: {e}")

async def periodic_backup_loop(app):
    while True:
        await asyncio.sleep(6 * 60 * 60)
        await send_db_backup(app.bot)

async def post_init(app):
    try:
        me = await app.bot.get_me()
        set_setting("bot_username", me.username)
    except Exception as e:
        logging.warning(f"Could not fetch bot username: {e}")
    asyncio.create_task(periodic_backup_loop(app))

# ================================================================
#   CHANNEL JOIN GATE
# ================================================================
async def check_channel_member(bot, user_id: int):
    channels = get_required_channels()
    for channel in channels:
        try:
            member = await bot.get_chat_member(chat_id=channel, user_id=user_id)
            logging.info(f"[join-check] uid={user_id} channel={channel} status={member.status}")
            if member.status in ("left", "kicked"):
                return False
        except telegram.error.BadRequest:
            return False
        except telegram.error.Forbidden as e:
            logging.warning(f"[join-check] Forbidden — বট সম্ভবত '{channel}'-এ Admin না! {e}")
            return None
        except Exception as e:
            logging.warning(f"[join-check] error channel={channel}: {e}")
            return None
    return True

def join_keyboard(L):
    channels = get_required_channels()
    buttons = [
        [InlineKeyboardButton(f"{L['join_btn']} ({ch.lstrip('@')})", url=f"https://t.me/{ch.lstrip('@')}")]
        for ch in channels
    ]
    buttons.append([InlineKeyboardButton(L["join_check_btn"], callback_data="check_join")])
    return InlineKeyboardMarkup(buttons)

async def _ensure_joined(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    uid = update.effective_user.id
    if uid == ADMIN_ID:
        return True
    result = await check_channel_member(context.bot, uid)
    L = LANG[get_user_lang(uid)]
    if result is None:
        await update.message.reply_text(L["join_check_error"], parse_mode="HTML")
        return False
    if not result:
        await update.message.reply_text(L["join_required"], parse_mode="HTML",
                                        reply_markup=join_keyboard(L))
        return False
    return True

# ================================================================
#   MAINTENANCE GATE
# ================================================================
async def maintenance_gate_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_maintenance():
        return
    uid = update.effective_user.id if update.effective_user else None
    if uid == ADMIN_ID:
        return
    lang = get_user_lang(uid) if uid else "bn"
    if update.message:
        await update.message.reply_text(get_maintenance_msg(lang), parse_mode="HTML")
    raise ApplicationHandlerStop()

async def maintenance_gate_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_maintenance():
        return
    uid = update.effective_user.id if update.effective_user else None
    if uid == ADMIN_ID:
        return
    lang = get_user_lang(uid) if uid else "bn"
    if update.callback_query:
        await update.callback_query.answer(get_maintenance_msg(lang), show_alert=True)
    raise ApplicationHandlerStop()

# ================================================================
#   MENUS
# ================================================================
MENU_BUTTONS = [
    ("earn",      "btn_earn"),
    ("miniapp",   "btn_miniapp"),
    ("balance",   "btn_balance"),
    ("referral",  "btn_referral"),
    ("history",   "btn_history"),
    ("support",   "btn_support"),
    ("rules",     "btn_rules"),
    ("lang",      "btn_lang"),
]

def get_menu_button_enabled(key: str) -> bool:
    return get_setting(f"menu_btn_{key}", "1") == "1"

def set_menu_button_enabled(key: str, enabled: bool):
    set_setting(f"menu_btn_{key}", "1" if enabled else "0")

def menu_toggle_keyboard():
    buttons = []
    for key, label_key in MENU_BUTTONS:
        label = LANG["bn"][label_key]
        state = "✅" if get_menu_button_enabled(key) else "❌"
        buttons.append([InlineKeyboardButton(f"{state} {label}", callback_data=f"toggle_menu_{key}")])
    return InlineKeyboardMarkup(buttons)

def build_main_menu(user_id: int) -> ReplyKeyboardMarkup:
    lang = get_user_lang(user_id)
    L = LANG[lang]
    active = []
    for key, label_key in MENU_BUTTONS:
        if not get_menu_button_enabled(key):
            continue
        if key == "miniapp" and WEBAPP_BASE_URL and "PUT_YOUR_RENDER_URL_HERE" not in WEBAPP_BASE_URL:
            active.append(KeyboardButton(L[label_key], web_app=WebAppInfo(url=f"{WEBAPP_BASE_URL}/webapp")))
        elif key != "miniapp":
            active.append(KeyboardButton(L[label_key]))
    if not active:
        active = [KeyboardButton(L["btn_earn"])]
    rows = [active[i:i + 2] for i in range(0, len(active), 2)]
    return ReplyKeyboardMarkup(rows, resize_keyboard=True)

# ================================================================
#   USER HANDLERS
# ================================================================
async def _send_welcome(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    name = update.effective_user.first_name or "Friend"
    ann = get_announcement()
    text = t(uid, "welcome", name=name)
    if ann:
        text = ann + "\n\n" + text
    await update.message.reply_text(text, parse_mode="HTML", reply_markup=build_main_menu(uid))

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    ensure_user_exists(uid)

    if context.args:
        arg = context.args[0]
        if arg.startswith("ref_"):
            try:
                referrer_id = int(arg[4:])
                if referrer_id != uid:
                    if set_referrer(uid, referrer_id):
                        try:
                            await context.bot.send_message(
                                chat_id=referrer_id,
                                text=LANG[get_user_lang(referrer_id)]["referral_joined_notify"],
                                parse_mode="HTML"
                            )
                        except Exception:
                            pass
            except ValueError:
                pass

    if uid == ADMIN_ID:
        await _send_welcome(update, context)
        return

    result = await check_channel_member(context.bot, uid)
    L = LANG[get_user_lang(uid)]
    if result is None:
        await update.message.reply_text(L["join_check_error"], parse_mode="HTML")
        return
    if not result:
        await update.message.reply_text(L["join_required"], parse_mode="HTML",
                                        reply_markup=join_keyboard(L))
        return
    await _send_welcome(update, context)

async def check_join(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    uid = query.from_user.id
    L = LANG[get_user_lang(uid)]
    result = await check_channel_member(context.bot, uid)
    if result is None:
        await query.answer(L["join_check_error"], show_alert=True)
        return
    if not result:
        await query.answer()
        await query.edit_message_text(L["join_required"] + "\n\n" + L["join_fail"],
                                      parse_mode="HTML", reply_markup=join_keyboard(L))
        return
    await query.answer("✅ Verified!")
    await query.edit_message_text(t(uid, "welcome", name=query.from_user.first_name or "Friend"),
                                  parse_mode="HTML")
    await context.bot.send_message(chat_id=uid, text="👇", reply_markup=build_main_menu(uid))

async def change_lang_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("🇧🇩 বাংলা", callback_data="setlang_bn"),
         InlineKeyboardButton("🇬🇧 English", callback_data="setlang_en")],
    ])
    await update.message.reply_text("🌐 Choose language / ভাষা বেছে নিন:", reply_markup=keyboard)

async def set_lang_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    uid = query.from_user.id
    lang = query.data.split("_", 1)[1]
    set_user_lang(uid, lang)
    L = LANG[lang]
    await query.edit_message_text(L["lang_set"], parse_mode="HTML")
    await context.bot.send_message(chat_id=uid, text="👇", reply_markup=build_main_menu(uid))

async def earn_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if not await _ensure_joined(update, context):
        return
    tasks_today, _ = get_task_progress(uid)
    limit = get_daily_task_limit()
    if limit > 0 and tasks_today >= limit:
        await update.message.reply_text(t(uid, "earn_limit_reached"), parse_mode="HTML")
        return
    reward = get_task_reward()
    seconds = get_task_wait_seconds()
    link = get_ad_link()
    context.user_data["task_start_time"] = time.time()
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton(t(uid, "btn_claim"), callback_data="claim_task")],
    ])
    await update.message.reply_text(
        t(uid, "earn_task", seconds=seconds, link=link, reward=reward),
        parse_mode="HTML", reply_markup=keyboard, disable_web_page_preview=True
    )

async def claim_task(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    uid = query.from_user.id
    start_time = context.user_data.get("task_start_time")
    seconds = get_task_wait_seconds()
    if not start_time or (time.time() - start_time) < seconds:
        remaining = int(seconds - (time.time() - start_time)) if start_time else seconds
        await query.answer(t(uid, "earn_too_soon", sec=max(remaining, 1)), show_alert=True)
        return
    tasks_today, _ = get_task_progress(uid)
    limit = get_daily_task_limit()
    if limit > 0 and tasks_today >= limit:
        await query.answer(t(uid, "earn_limit_reached"), show_alert=True)
        return
    reward = get_task_reward()
    done = record_task_completion(uid, reward)
    context.user_data.pop("task_start_time", None)
    await query.answer("✅")
    await query.edit_message_text(
        t(uid, "earn_success", reward=reward, done=done, limit=limit if limit > 0 else "∞"),
        parse_mode="HTML"
    )
    # Referral bonus — শুধু প্রথম টাস্কেই একবার
    if not is_referral_paid(uid):
        referrer_id = get_referrer(uid)
        if referrer_id:
            bonus = get_referral_bonus()
            add_balance(referrer_id, bonus)
            mark_referral_paid(uid)
            try:
                await context.bot.send_message(
                    chat_id=referrer_id,
                    text=LANG[get_user_lang(referrer_id)]["referral_bonus_notify"].replace(
                        "{{bonus}}", str(int(bonus) if bonus == int(bonus) else bonus)
                    ),
                    parse_mode="HTML"
                )
            except Exception:
                pass

async def balance_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if not await _ensure_joined(update, context):
        return
    balance = get_balance(uid)
    total = get_total_earned(uid)
    min_w = get_min_withdraw()
    keyboard = None
    if balance >= min_w:
        L = LANG[get_user_lang(uid)]
        keyboard = InlineKeyboardMarkup([[InlineKeyboardButton(L["btn_withdraw"], callback_data="withdraw_start")]])
    else:
        await update.message.reply_text(
            t(uid, "withdraw_below_min", min=int(min_w) if min_w == int(min_w) else min_w,
              balance=int(balance) if balance == int(balance) else balance),
            parse_mode="HTML"
        )
    await update.message.reply_text(
        t(uid, "balance_msg", balance=int(balance) if balance == int(balance) else balance,
          total=int(total) if total == int(total) else total),
        parse_mode="HTML", reply_markup=keyboard
    )

WITHDRAW_METHOD, WITHDRAW_NUMBER = range(200, 202)

async def withdraw_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    uid = query.from_user.id
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("💗 bKash", callback_data="wmethod_bKash"),
         InlineKeyboardButton("🟠 Nagad", callback_data="wmethod_Nagad")],
    ])
    await query.edit_message_text(t(uid, "withdraw_choose_method"), parse_mode="HTML", reply_markup=keyboard)
    return WITHDRAW_METHOD

async def withdraw_method_choice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    uid = query.from_user.id
    method = query.data.split("_", 1)[1]
    context.user_data["withdraw_method"] = method
    icon = method_icon(method)
    saved = get_wallet(uid, method)
    if saved:
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton(f"✅ সংরক্ষিত ({mask_number(saved)})", callback_data="wsaved")],
            [InlineKeyboardButton("✏️ নতুন নম্বর", callback_data="wnewnum")],
        ])
        await query.edit_message_text(f"{icon} <b>{method}</b>", parse_mode="HTML", reply_markup=keyboard)
        return WITHDRAW_NUMBER
    await query.edit_message_text(t(uid, "withdraw_ask_number", icon=icon, method=method), parse_mode="HTML")
    return WITHDRAW_NUMBER

async def withdraw_saved_choice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    uid = query.from_user.id
    method = context.user_data.get("withdraw_method")
    if query.data == "wsaved":
        await query.answer()
        number = get_wallet(uid, method)
        return await _finalize_withdraw(update, context, number, is_callback=True)
    await query.answer()
    icon = method_icon(method)
    await query.edit_message_text(t(uid, "withdraw_ask_number", icon=icon, method=method), parse_mode="HTML")
    return WITHDRAW_NUMBER

async def withdraw_number_receive(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    number = update.message.text.strip()
    if not re.match(r'^01\d{9}$', number):
        await update.message.reply_text(t(uid, "withdraw_number_invalid"), parse_mode="HTML")
        return WITHDRAW_NUMBER
    return await _finalize_withdraw(update, context, number, is_callback=False)

async def _finalize_withdraw(update, context, number, is_callback):
    uid = update.effective_user.id if not is_callback else update.callback_query.from_user.id
    method = context.user_data.get("withdraw_method")
    balance = get_balance(uid)
    save_wallet(uid, method, number)
    wid = save_withdrawal(uid, balance, method, number)
    deduct_balance(uid, balance)
    icon = method_icon(method)
    text = t(uid, "withdraw_submitted", amount=int(balance) if balance == int(balance) else balance, wid=wid)
    if is_callback:
        await update.callback_query.edit_message_text(text, parse_mode="HTML")
    else:
        await update.message.reply_text(text, parse_mode="HTML", reply_markup=build_main_menu(uid))
    display_name = update.effective_user.username or update.effective_user.first_name
    await context.bot.send_message(
        chat_id=ADMIN_ID,
        text=(f"💸 <b>নতুন Withdraw রিকোয়েস্ট!</b>\n{LINE}\n"
              f"👤 {display_name} [{uid}]\n"
              f"💵 {balance}৳\n"
              f"{icon} {method}: <code>{number}</code>\n"
              f"🆔 #{wid}"),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup([[
            InlineKeyboardButton("✅ Approve", callback_data=f"appw_{wid}"),
            InlineKeyboardButton("❌ Reject",  callback_data=f"rejw_{wid}"),
        ]])
    )
    return ConversationHandler.END

async def withdraw_admin_action(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    action, wid = query.data.split("_", 1)
    wid = int(wid)
    row = get_withdrawal(wid)
    if not row:
        await query.edit_message_text("⚠️ পাওয়া যায়নি।")
        return
    _, user_id, amount, method, number, status, created_at = row
    if status != "pending":
        await query.answer("ইতোমধ্যে প্রসেস করা হয়েছে।", show_alert=True)
        return
    if action == "appw":
        update_withdrawal_status(wid, "paid")
        await query.edit_message_text(f"✅ Withdraw #{wid} Approved হয়েছে।")
        try:
            await context.bot.send_message(chat_id=user_id, text=f"✅ আপনার #{wid} withdraw সম্পন্ন হয়েছে!")
        except Exception:
            pass
    else:
        update_withdrawal_status(wid, "rejected")
        add_balance(user_id, amount)
        await query.edit_message_text(f"❌ Withdraw #{wid} Reject হয়েছে, ব্যালেন্স ফেরত দেওয়া হয়েছে।")
        try:
            await context.bot.send_message(chat_id=user_id,
                text=f"❌ আপনার #{wid} withdraw বাতিল হয়েছে, ব্যালেন্স ফেরত দেওয়া হয়েছে।")
        except Exception:
            pass

async def referral_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if not await _ensure_joined(update, context):
        return
    bot_username = (await context.bot.get_me()).username
    link = f"https://t.me/{bot_username}?start=ref_{uid}"
    count = get_referral_count(uid)
    bonus = get_referral_bonus()
    await update.message.reply_text(
        t(uid, "referral_text", link=link, count=count,
          bonus=int(bonus) if bonus == int(bonus) else bonus),
        parse_mode="HTML"
    )

async def history_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if not await _ensure_joined(update, context):
        return
    rows = get_recent_activity(uid)
    if not rows:
        await update.message.reply_text(t(uid, "history_empty"), parse_mode="HTML")
        return
    lines = [f"💰 +{r[0]}৳  —  {r[1][:16].replace('T', ' ')}" for r in rows]
    await update.message.reply_text(
        t(uid, "history_header", items="\n".join(lines)), parse_mode="HTML"
    )

async def support_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("🎧 Contact Support", url=f"https://t.me/{get_support_username()}")
    ]])
    await update.message.reply_text("🎧 যেকোনো সমস্যায় যোগাযোগ করুন:", reply_markup=keyboard)

async def rules_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if not await _ensure_joined(update, context):
        return
    lang = get_user_lang(uid)
    default_rules = DEFAULT_RULES_BN if lang == "bn" else DEFAULT_RULES_EN
    rules_text = get_setting("rules_text_" + lang, default_rules)
    await update.message.reply_text(rules_text, parse_mode="HTML")

async def menu_router(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    lang = get_user_lang(uid)
    L = LANG[lang]
    text = update.message.text
    if text == L["btn_earn"]:
        return await earn_menu(update, context)
    if text == L["btn_balance"]:
        return await balance_menu(update, context)
    if text == L["btn_referral"]:
        return await referral_menu(update, context)
    if text == L["btn_history"]:
        return await history_menu(update, context)
    if text == L["btn_support"]:
        return await support_menu(update, context)
    if text == L["btn_rules"]:
        return await rules_menu(update, context)
    if text == L["btn_lang"]:
        return await change_lang_menu(update, context)
    await update.message.reply_text(t(uid, "unknown_command"), parse_mode="HTML",
                                    reply_markup=build_main_menu(uid))

# ================================================================
#   ADMIN PANEL (bottom-menu style, like NS Coin bot)
# ================================================================
ABTN_TASK_REWARD = "💰 Task Reward সেট করুন"
ABTN_DAILY_LIMIT = "📅 Daily Task Limit"
ABTN_WAIT_TIME   = "⏱️ Task Wait Time"
ABTN_AD_LINK     = "🔗 Ad Link সেট করুন"
ABTN_REF         = "🔗 Referral/Withdraw সেটিংস"
ABTN_MAINT       = "🔧 Maintenance টগল"
ABTN_MAINTMSG_BN = "📝 Maintenance মেসেজ (BN)"
ABTN_MAINTMSG_EN = "📝 Maintenance Message (EN)"
ABTN_ANNOUNCE    = "📣 Announcement"
ABTN_BROADCAST   = "📢 Broadcast"
ABTN_RULES_BN    = "📜 নিয়মাবলী (BN)"
ABTN_RULES_EN    = "📜 Rules (EN)"
ABTN_SUPPORT_UN  = "🎧 Support Username"
ABTN_CHANNELS    = "📢 Join Channel সেটিংস"
ABTN_MENU_TOGGLE = "🔘 User মেনু বাটন On/Off"
ABTN_STATS       = "📈 Stats"
ABTN_WITHDRAWALS = "💸 Withdrawals"
ABTN_VIEW        = "ℹ️ সব সেটিংস দেখুন"
ABTN_EXIT        = "🔚 Admin মেনু থেকে বের হন"

def admin_reply_keyboard():
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton(ABTN_TASK_REWARD), KeyboardButton(ABTN_DAILY_LIMIT)],
            [KeyboardButton(ABTN_WAIT_TIME),   KeyboardButton(ABTN_AD_LINK)],
            [KeyboardButton(ABTN_REF),         KeyboardButton(ABTN_MAINT)],
            [KeyboardButton(ABTN_ANNOUNCE),    KeyboardButton(ABTN_BROADCAST)],
            [KeyboardButton(ABTN_MAINTMSG_BN), KeyboardButton(ABTN_MAINTMSG_EN)],
            [KeyboardButton(ABTN_RULES_BN),    KeyboardButton(ABTN_RULES_EN)],
            [KeyboardButton(ABTN_SUPPORT_UN),  KeyboardButton(ABTN_CHANNELS)],
            [KeyboardButton(ABTN_MENU_TOGGLE), KeyboardButton(ABTN_STATS)],
            [KeyboardButton(ABTN_WITHDRAWALS), KeyboardButton(ABTN_VIEW)],
            [KeyboardButton(ABTN_EXIT)],
        ],
        resize_keyboard=True
    )

(ADMIN_TASK_INPUT, ADMIN_MSG_INPUT, ADMIN_ANNOUNCE_INPUT, ADMIN_BROADCAST_INPUT,
 ADMIN_SETTING_INPUT, ADMIN_RULES_INPUT, ADMIN_USERNAME_INPUT, ADMIN_CHANNEL_INPUT,
 ADMIN_ADLINK_INPUT) = range(300, 309)

async def admin_entry(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID:
        await update.message.reply_text("⛔ আপনার অনুমতি নেই।")
        return ConversationHandler.END
    await update.message.reply_text(
        "🛠️ <b>Admin Control Panel</b>\nনিচের মেনু থেকে যা পরিবর্তন করতে চান বেছে নিন 👇",
        parse_mode="HTML", reply_markup=admin_reply_keyboard()
    )
    return ConversationHandler.END

async def admin_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    await update.message.reply_text("❌ বাতিল করা হয়েছে।", reply_markup=admin_reply_keyboard())
    return ConversationHandler.END

async def admin_menu_task_reward(update: Update, context: ContextTypes.DEFAULT_TYPE):
    reward = get_task_reward()
    await update.message.reply_text(
        f"💰 বর্তমান Task Reward: <b>{reward}৳</b>\n\nনতুন এমাউন্ট পাঠান (শুধু সংখ্যা, যেমন 1.5)।\nবাতিল করতে /cancel লিখুন।",
        parse_mode="HTML"
    )
    return ADMIN_TASK_INPUT

async def admin_task_reward_receive(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        val = float(update.message.text.strip())
        set_setting("task_reward", str(val))
        await update.message.reply_text(f"✅ Task Reward আপডেট হয়েছে: {val}৳")
    except ValueError:
        await update.message.reply_text("⚠️ শুধু সংখ্যা দিন, যেমন: 1.5")
        return ADMIN_TASK_INPUT
    await update.message.reply_text("🛠️ Admin Panel:", reply_markup=admin_reply_keyboard())
    return ConversationHandler.END

async def admin_menu_daily_limit(update: Update, context: ContextTypes.DEFAULT_TYPE):
    limit = get_daily_task_limit()
    await update.message.reply_text(
        f"📅 বর্তমান Daily Task Limit: <b>{'Unlimited' if limit==0 else limit}</b>\n\n"
        f"নতুন সংখ্যা পাঠান (0 = Unlimited)।\nবাতিল করতে /cancel লিখুন।",
        parse_mode="HTML"
    )
    return ADMIN_TASK_INPUT

async def admin_daily_limit_receive(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        val = int(update.message.text.strip())
        set_setting("daily_task_limit", str(val))
        await update.message.reply_text(f"✅ Daily Task Limit: {'Unlimited' if val==0 else val}")
    except ValueError:
        await update.message.reply_text("⚠️ শুধু সংখ্যা দিন।")
        return ADMIN_TASK_INPUT
    await update.message.reply_text("🛠️ Admin Panel:", reply_markup=admin_reply_keyboard())
    return ConversationHandler.END

async def admin_menu_wait_time(update: Update, context: ContextTypes.DEFAULT_TYPE):
    seconds = get_task_wait_seconds()
    await update.message.reply_text(
        f"⏱️ বর্তমান Wait Time: <b>{seconds} সেকেন্ড</b>\n\nনতুন সেকেন্ড সংখ্যা পাঠান।\nবাতিল করতে /cancel লিখুন।",
        parse_mode="HTML"
    )
    return ADMIN_TASK_INPUT

async def admin_wait_time_receive(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        val = int(update.message.text.strip())
        set_setting("task_wait_seconds", str(val))
        await update.message.reply_text(f"✅ Wait Time: {val} সেকেন্ড")
    except ValueError:
        await update.message.reply_text("⚠️ শুধু সংখ্যা দিন।")
        return ADMIN_TASK_INPUT
    await update.message.reply_text("🛠️ Admin Panel:", reply_markup=admin_reply_keyboard())
    return ConversationHandler.END

async def admin_menu_adlink(update: Update, context: ContextTypes.DEFAULT_TYPE):
    link = get_ad_link()
    await update.message.reply_text(
        f"🔗 বর্তমান Ad Link:\n<code>{link}</code>\n\nনতুন লিংক পাঠান।\nবাতিল করতে /cancel লিখুন।",
        parse_mode="HTML"
    )
    return ADMIN_ADLINK_INPUT

async def admin_adlink_receive(update: Update, context: ContextTypes.DEFAULT_TYPE):
    link = update.message.text.strip()
    set_setting("ad_link", link)
    await update.message.reply_text(f"✅ Ad Link আপডেট হয়েছে।")
    await update.message.reply_text("🛠️ Admin Panel:", reply_markup=admin_reply_keyboard())
    return ConversationHandler.END

async def admin_menu_ref(update: Update, context: ContextTypes.DEFAULT_TYPE):
    bonus = get_referral_bonus()
    min_w = get_min_withdraw()
    await update.message.reply_text(
        f"⚙️ <b>Referral ও Withdraw সেটিংস</b>\n{LINE}\n"
        f"🔗 Referral Bonus: <b>{int(bonus) if bonus==int(bonus) else bonus}৳</b>\n"
        f"💸 Min Withdraw:  <b>{int(min_w) if min_w==int(min_w) else min_w}৳</b>\n{LINE}\n"
        f"নতুন সেটিং পাঠান এই ফরম্যাটে:\n<code>bonus-2\nminwithdraw-20</code>\n\n"
        f"বাতিল করতে /cancel লিখুন।",
        parse_mode="HTML"
    )
    return ADMIN_SETTING_INPUT

async def admin_ref_settings_receive(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    changed = []
    for line in text.splitlines():
        line = line.strip().lower()
        if not line:
            continue
        m = re.match(r'^([a-z_]+)\s*[-:=]\s*([\d.]+)$', line)
        if not m:
            continue
        key, val_str = m.group(1), float(m.group(2))
        if key in ("bonus", "referralbonus"):
            set_setting("referral_bonus", str(val_str))
            changed.append(f"✅ Referral Bonus: {val_str}৳")
        elif key in ("minwithdraw", "withdraw"):
            set_setting("min_withdraw", str(val_str))
            changed.append(f"✅ Min Withdraw: {val_str}৳")
    if changed:
        await update.message.reply_text("✅ আপডেট হয়েছে:\n" + "\n".join(changed))
    else:
        await update.message.reply_text("⚠️ কোনো পরিবর্তন হয়নি। ফরম্যাট চেক করুন।")
    await update.message.reply_text("🛠️ Admin Panel:", reply_markup=admin_reply_keyboard())
    return ConversationHandler.END

async def admin_menu_maint(update: Update, context: ContextTypes.DEFAULT_TYPE):
    set_maintenance(not is_maintenance())
    state = "চালু ✅" if is_maintenance() else "বন্ধ ❌"
    await update.message.reply_text(f"🛠️ Maintenance Mode এখন <b>{state}</b>।", parse_mode="HTML")
    return ConversationHandler.END

async def admin_menu_maintmsg_bn(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["maintmsg_lang"] = "bn"
    await update.message.reply_text(
        f"📝 বর্তমান Maintenance মেসেজ (বাংলা):\n{LINE}\n{get_maintenance_msg('bn')}\n{LINE}\n\n"
        f"নতুন মেসেজ পাঠান।\nবাতিল করতে /cancel লিখুন।", parse_mode="HTML"
    )
    return ADMIN_MSG_INPUT

async def admin_menu_maintmsg_en(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["maintmsg_lang"] = "en"
    await update.message.reply_text(
        f"📝 Current Maintenance Message (English):\n{LINE}\n{get_maintenance_msg('en')}\n{LINE}\n\n"
        f"Send new message.\nType /cancel to cancel.", parse_mode="HTML"
    )
    return ADMIN_MSG_INPUT

async def admin_maintmsg_receive(update: Update, context: ContextTypes.DEFAULT_TYPE):
    lang_key = context.user_data.get("maintmsg_lang", "bn")
    text = update.message.text.strip()
    set_setting(f"maintenance_msg_{lang_key}", text)
    await update.message.reply_text("✅ Maintenance মেসেজ আপডেট হয়েছে!")
    await update.message.reply_text("🛠️ Admin Panel:", reply_markup=admin_reply_keyboard())
    return ConversationHandler.END

async def admin_menu_announce(update: Update, context: ContextTypes.DEFAULT_TYPE):
    current = get_announcement() or "(কোনো announcement নেই)"
    await update.message.reply_text(
        f"📣 বর্তমান Announcement:\n{LINE}\n{current}\n{LINE}\n\n"
        f"নতুন Announcement লিখুন। মুছতে <code>clear</code> লিখুন।\nবাতিল করতে /cancel লিখুন।",
        parse_mode="HTML"
    )
    return ADMIN_ANNOUNCE_INPUT

async def admin_announce_receive(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    if text.lower() == "clear":
        set_announcement("")
        await update.message.reply_text("✅ Announcement মুছে ফেলা হয়েছে।")
    else:
        set_announcement(text)
        await update.message.reply_text("✅ Announcement সেট হয়েছে!")
    await update.message.reply_text("🛠️ Admin Panel:", reply_markup=admin_reply_keyboard())
    return ConversationHandler.END

async def admin_menu_broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_count = len(get_all_user_ids())
    await update.message.reply_text(
        f"📢 মোট <b>{user_count}</b> জন user-কে message পাঠানো হবে।\n\n"
        f"এখন আপনার message লিখুন।\nবাতিল করতে /cancel লিখুন।", parse_mode="HTML"
    )
    return ADMIN_BROADCAST_INPUT

async def admin_broadcast_send(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    user_ids = get_all_user_ids()
    sent, failed = 0, 0
    status_msg = await update.message.reply_text(f"⏳ Broadcast শুরু... মোট {len(user_ids)} জন।")
    for uid in user_ids:
        try:
            await context.bot.send_message(chat_id=uid, text=f"📢 {text}", parse_mode="HTML")
            sent += 1
        except Exception:
            failed += 1
        await asyncio.sleep(0.05)
    await status_msg.edit_text(f"✅ সম্পন্ন! সফল: {sent}, ব্যর্থ: {failed}")
    await update.message.reply_text("🛠️ Admin Panel:", reply_markup=admin_reply_keyboard())
    return ConversationHandler.END

async def admin_menu_rulesmsg_bn(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["rulesmsg_lang"] = "bn"
    current = get_setting("rules_text_bn", DEFAULT_RULES_BN)
    await update.message.reply_text(
        f"📜 বর্তমান নিয়মাবলী:\n{LINE}\n{current}\n{LINE}\n\nনতুন নিয়মাবলী পাঠান। reset লিখলে ডিফল্টে ফিরবে।\n/cancel দিয়ে বাতিল।",
        parse_mode="HTML"
    )
    return ADMIN_RULES_INPUT

async def admin_menu_rulesmsg_en(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["rulesmsg_lang"] = "en"
    current = get_setting("rules_text_en", DEFAULT_RULES_EN)
    await update.message.reply_text(
        f"📜 Current Rules:\n{LINE}\n{current}\n{LINE}\n\nSend new rules. Send reset for default.\n/cancel to cancel.",
        parse_mode="HTML"
    )
    return ADMIN_RULES_INPUT

async def admin_rulesmsg_receive(update: Update, context: ContextTypes.DEFAULT_TYPE):
    lang_key = context.user_data.get("rulesmsg_lang", "bn")
    key = "rules_text_" + lang_key
    text = update.message.text.strip()
    if text.lower() == "reset":
        default_rules = DEFAULT_RULES_BN if lang_key == "bn" else DEFAULT_RULES_EN
        set_setting(key, default_rules)
        await update.message.reply_text("✅ ডিফল্টে ফিরিয়ে দেওয়া হয়েছে!")
    else:
        set_setting(key, text)
        await update.message.reply_text("✅ আপডেট হয়েছে!")
    await update.message.reply_text("🛠️ Admin Panel:", reply_markup=admin_reply_keyboard())
    return ConversationHandler.END

async def admin_menu_support_un(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        f"🎧 বর্তমান Support Username: <code>@{get_support_username()}</code>\n\n"
        f"নতুন username পাঠান (@ ছাড়া)।\n/cancel দিয়ে বাতিল।", parse_mode="HTML"
    )
    return ADMIN_USERNAME_INPUT

async def admin_username_receive(update: Update, context: ContextTypes.DEFAULT_TYPE):
    new_username = update.message.text.strip().lstrip("@")
    if not re.match(r'^[A-Za-z0-9_]{4,32}$', new_username):
        await update.message.reply_text("⚠️ ভুল ফরম্যাট। @ ছাড়া, ৪-৩২ ক্যারেক্টার দিন।")
        return ADMIN_USERNAME_INPUT
    set_setting("support_username", new_username)
    await update.message.reply_text(f"✅ Support Username: @{new_username}")
    await update.message.reply_text("🛠️ Admin Panel:", reply_markup=admin_reply_keyboard())
    return ConversationHandler.END

async def admin_menu_channels(update: Update, context: ContextTypes.DEFAULT_TYPE):
    channels = get_required_channels()
    listing = "\n".join([f"  {i+1}. {ch}" for i, ch in enumerate(channels)]) or "  (কোনো চ্যানেল নেই)"
    await update.message.reply_text(
        f"📢 বর্তমান চ্যানেল:\n{listing}\n\n"
        f"➕ যোগ করতে: <code>+@channelname</code>\n➖ বাদ দিতে: <code>-@channelname</code>\n"
        f"/cancel দিয়ে বাতিল।", parse_mode="HTML"
    )
    return ADMIN_CHANNEL_INPUT

async def admin_channel_receive(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    added, removed = [], []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("+"):
            if add_required_channel(line[1:]):
                added.append(line[1:])
        elif line.startswith("-"):
            if remove_required_channel(line[1:]):
                removed.append(line[1:])
    msg = []
    if added:
        msg.append("✅ যোগ: " + ", ".join(added))
    if removed:
        msg.append("🗑️ বাদ: " + ", ".join(removed))
    await update.message.reply_text("\n".join(msg) if msg else "⚠️ কোনো পরিবর্তন হয়নি।")
    await update.message.reply_text("🛠️ Admin Panel:", reply_markup=admin_reply_keyboard())
    return ConversationHandler.END

async def admin_menu_toggle_screen(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🔘 <b>User মেনু বাটন On/Off</b>\nচাপুন চালু/বন্ধ করতে।",
        parse_mode="HTML", reply_markup=menu_toggle_keyboard()
    )
    return ConversationHandler.END

async def admin_toggle_menu_button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    key = query.data.split("toggle_menu_", 1)[1]
    new_state = not get_menu_button_enabled(key)
    set_menu_button_enabled(key, new_state)
    await query.answer("✅ চালু" if new_state else "❌ বন্ধ")
    await query.edit_message_reply_markup(reply_markup=menu_toggle_keyboard())

async def admin_menu_stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    s = get_stats()
    await update.message.reply_text(
        f"📈 <b>Bot Statistics</b>\n{LINE}\n"
        f"👥 মোট Users: <b>{s['users']:,}</b>\n"
        f"✅ মোট Tasks সম্পন্ন: <b>{s['total_tasks']:,}</b>\n"
        f"💵 মোট পরিশোধিত: <b>{s['total_paid_out']:,}৳</b>\n{LINE}\n"
        f"💸 Pending Withdrawals: <b>{s['pending_withdrawals']}</b>\n"
        f"💵 Total Withdrawn: <b>{s['total_withdrawn']:,}৳</b>",
        parse_mode="HTML"
    )
    return ConversationHandler.END

async def admin_menu_withdrawals(update: Update, context: ContextTypes.DEFAULT_TYPE):
    pending = get_pending_withdrawals()
    if not pending:
        await update.message.reply_text("✅ কোনো pending withdrawal নেই।")
        return ConversationHandler.END
    for row in pending[:10]:
        wid, uid, amount, method, number, status, created_at = row
        icon = method_icon(method)
        await update.message.reply_text(
            f"<b>#W{wid}</b>  [{uid}]  {amount}৳  {icon}{method}  <code>{number}</code>",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton("✅ Approve", callback_data=f"appw_{wid}"),
                InlineKeyboardButton("❌ Reject",  callback_data=f"rejw_{wid}"),
            ]])
        )
    return ConversationHandler.END

async def admin_menu_view(update: Update, context: ContextTypes.DEFAULT_TYPE):
    reward = get_task_reward()
    limit = get_daily_task_limit()
    seconds = get_task_wait_seconds()
    bonus = get_referral_bonus()
    min_w = get_min_withdraw()
    maint = "🔴 চালু (ON)" if is_maintenance() else "🟢 বন্ধ (OFF)"
    channels = get_required_channels()
    channels_txt = "\n".join([f"  • {ch}" for ch in channels]) or "  (কোনো চ্যানেল নেই)"
    ann = get_announcement() or "(কোনো announcement নেই)"
    await update.message.reply_text(
        f"ℹ️ <b>বর্তমান সেটিংস</b>\n{LINE}\n"
        f"💰 Task Reward: <b>{reward}৳</b>\n"
        f"📅 Daily Limit: <b>{'Unlimited' if limit==0 else limit}</b>\n"
        f"⏱️ Wait Time: <b>{seconds}s</b>\n"
        f"🔗 Ad Link: <code>{get_ad_link()}</code>\n{LINE}\n"
        f"🔗 Referral Bonus: <b>{int(bonus) if bonus==int(bonus) else bonus}৳</b>\n"
        f"💸 Min Withdraw: <b>{int(min_w) if min_w==int(min_w) else min_w}৳</b>\n{LINE}\n"
        f"🛠️ Maintenance: <b>{maint}</b>\n{LINE}\n"
        f"🎧 Support: <b>@{get_support_username()}</b>\n{LINE}\n"
        f"📢 Channels:\n{channels_txt}\n{LINE}\n"
        f"📣 Announcement:\n{ann}",
        parse_mode="HTML"
    )
    return ConversationHandler.END

async def admin_menu_exit(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("🔚 Admin মেনু থেকে বের হলেন।", reply_markup=ReplyKeyboardRemove())
    return ConversationHandler.END

# ================================================================
#   MAIN
# ================================================================
def main():
    if not BOT_TOKEN or BOT_TOKEN == "PUT_YOUR_BOT_TOKEN_HERE":
        print("❌ BOT_TOKEN সেট করা নেই!")
        print("   ফাইলের একদম উপরে CONFIG সেকশনে BOT_TOKEN বসান, অথবা")
        print('   export BOT_TOKEN="আপনার_টোকেন"  কমান্ড দিয়ে চালান।')
        return
    init_db()
    start_health_server()
    app = Application.builder().token(BOT_TOKEN).post_init(post_init).build()

    app.add_handler(MessageHandler(filters.ALL, maintenance_gate_message), group=-1)
    app.add_handler(CallbackQueryHandler(maintenance_gate_callback), group=-1)

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("admin", admin_entry, filters=filters.User(user_id=ADMIN_ID)))
    app.add_handler(CommandHandler("cancel", admin_cancel))

    app.add_handler(CallbackQueryHandler(check_join, pattern="^check_join$"))
    app.add_handler(CallbackQueryHandler(set_lang_callback, pattern="^setlang_"))
    app.add_handler(CallbackQueryHandler(claim_task, pattern="^claim_task$"))
    app.add_handler(CallbackQueryHandler(withdraw_admin_action, pattern="^(appw|rejw)_"))
    app.add_handler(CallbackQueryHandler(admin_toggle_menu_button, pattern="^toggle_menu_"))

    withdraw_conv = ConversationHandler(
        entry_points=[CallbackQueryHandler(withdraw_start, pattern="^withdraw_start$")],
        states={
            WITHDRAW_METHOD: [CallbackQueryHandler(withdraw_method_choice, pattern="^wmethod_")],
            WITHDRAW_NUMBER: [
                CallbackQueryHandler(withdraw_saved_choice, pattern="^(wsaved|wnewnum)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, withdraw_number_receive),
            ],
        },
        fallbacks=[CommandHandler("cancel", admin_cancel)],
        per_message=False,
    )
    app.add_handler(withdraw_conv)

    admin_conv = ConversationHandler(
        entry_points=[
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_TASK_REWARD)}$"), admin_menu_task_reward),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_DAILY_LIMIT)}$"), admin_menu_daily_limit),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_WAIT_TIME)}$"), admin_menu_wait_time),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_AD_LINK)}$"), admin_menu_adlink),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_REF)}$"), admin_menu_ref),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_MAINT)}$"), admin_menu_maint),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_MAINTMSG_BN)}$"), admin_menu_maintmsg_bn),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_MAINTMSG_EN)}$"), admin_menu_maintmsg_en),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_ANNOUNCE)}$"), admin_menu_announce),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_BROADCAST)}$"), admin_menu_broadcast),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_RULES_BN)}$"), admin_menu_rulesmsg_bn),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_RULES_EN)}$"), admin_menu_rulesmsg_en),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_SUPPORT_UN)}$"), admin_menu_support_un),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_CHANNELS)}$"), admin_menu_channels),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_MENU_TOGGLE)}$"), admin_menu_toggle_screen),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_STATS)}$"), admin_menu_stats),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_WITHDRAWALS)}$"), admin_menu_withdrawals),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_VIEW)}$"), admin_menu_view),
            MessageHandler(filters.User(user_id=ADMIN_ID) & filters.Regex(f"^{re.escape(ABTN_EXIT)}$"), admin_menu_exit),
        ],
        states={
            ADMIN_TASK_INPUT:     [MessageHandler(filters.TEXT & ~filters.COMMAND, admin_task_reward_receive)],
            ADMIN_MSG_INPUT:      [MessageHandler(filters.TEXT & ~filters.COMMAND, admin_maintmsg_receive)],
            ADMIN_ANNOUNCE_INPUT: [MessageHandler(filters.TEXT & ~filters.COMMAND, admin_announce_receive)],
            ADMIN_BROADCAST_INPUT:[MessageHandler(filters.TEXT & ~filters.COMMAND, admin_broadcast_send)],
            ADMIN_SETTING_INPUT:  [MessageHandler(filters.TEXT & ~filters.COMMAND, admin_ref_settings_receive)],
            ADMIN_RULES_INPUT:    [MessageHandler(filters.TEXT & ~filters.COMMAND, admin_rulesmsg_receive)],
            ADMIN_USERNAME_INPUT: [MessageHandler(filters.TEXT & ~filters.COMMAND, admin_username_receive)],
            ADMIN_CHANNEL_INPUT:  [MessageHandler(filters.TEXT & ~filters.COMMAND, admin_channel_receive)],
            ADMIN_ADLINK_INPUT:   [MessageHandler(filters.TEXT & ~filters.COMMAND, admin_adlink_receive)],
        },
        fallbacks=[CommandHandler("cancel", admin_cancel)],
        per_message=False,
    )
    app.add_handler(admin_conv)

    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, menu_router))

    print("✅ IncomeBot চালু হয়েছে...")
    app.run_polling()

if __name__ == "__main__":
    main()
