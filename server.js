const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT || 10000);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   ENVIRONMENT
========================================================= */

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const BOT_TOKEN = String(process.env.BOT_TOKEN || "").trim();
const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || "").trim();
const ADMIN_SECRET = String(process.env.ADMIN_SECRET || "").trim();
const WEBAPP_URL = String(process.env.WEBAPP_URL || "").trim().replace(/\/+$/, "");
const BOT_USERNAME = String(process.env.BOT_USERNAME || "").trim().replace(/^@/, "");

if (!DATABASE_URL) {
  console.warn("WARNING: DATABASE_URL is missing.");
}

/* =========================================================
   DATABASE
========================================================= */

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function q(sql, params = []) {
  return pool.query(sql, params);
}

/* =========================================================
   THEMES
========================================================= */

const THEMES = {
  gold: {
    name: "Bee Gold",
    primary: "#f5c400",
    secondary: "#ffda3d",
    background: "#0d0f12",
    card: "#15181d",
    text: "#ffffff",
    muted: "#9da3ad"
  },
  emerald: {
    name: "Emerald",
    primary: "#20d48a",
    secondary: "#58f0aa",
    background: "#07110d",
    card: "#101c16",
    text: "#ffffff",
    muted: "#98aaa1"
  },
  ocean: {
    name: "Ocean Blue",
    primary: "#28a9ff",
    secondary: "#67c8ff",
    background: "#071018",
    card: "#111c25",
    text: "#ffffff",
    muted: "#9aaebd"
  },
  purple: {
    name: "Royal Purple",
    primary: "#a66cff",
    secondary: "#c49aff",
    background: "#0e0915",
    card: "#18121f",
    text: "#ffffff",
    muted: "#aaa0b4"
  },
  ruby: {
    name: "Ruby Red",
    primary: "#ff405c",
    secondary: "#ff7185",
    background: "#14090c",
    card: "#211216",
    text: "#ffffff",
    muted: "#b5a0a5"
  },
  cyan: {
    name: "Cyan",
    primary: "#22dce6",
    secondary: "#6df3f7",
    background: "#061214",
    card: "#101c1e",
    text: "#ffffff",
    muted: "#9db3b5"
  },
  sunset: {
    name: "Sunset Orange",
    primary: "#ff8a00",
    secondary: "#ffc14d",
    background: "#160d06",
    card: "#21150c",
    text: "#ffffff",
    muted: "#b9a99a"
  },
  pink: {
    name: "Pink",
    primary: "#ff4fa3",
    secondary: "#ff85c1",
    background: "#160914",
    card: "#21121d",
    text: "#ffffff",
    muted: "#b9a5b1"
  }
};

/* =========================================================
   DEFAULT SETTINGS
========================================================= */

const DEFAULT_SETTINGS = {
  app_name: "ST Earn",
  logo_url: "",
  global_theme: "gold",
  allow_user_theme: false,
  referral_reward: 0.20,
  minimum_withdraw: 1,
  withdraw_fee: 0,
  announcement: "Welcome to ST Earn!",
  maintenance: false,
  telegram_channel: ""
};

/* =========================================================
   DATABASE INIT
========================================================= */

async function initDB() {
  await q(`
    CREATE TABLE IF NOT EXISTS users(
      id SERIAL PRIMARY KEY,
      telegram_id TEXT UNIQUE NOT NULL,
      username TEXT DEFAULT '',
      first_name TEXT DEFAULT '',
      last_name TEXT DEFAULT '',
      balance NUMERIC(18,8) DEFAULT 0,
      total_earned NUMERIC(18,8) DEFAULT 0,
      tasks_done INTEGER DEFAULT 0,
      referrals INTEGER DEFAULT 0,
      referred_by TEXT DEFAULT '',
      blocked BOOLEAN DEFAULT FALSE,
      theme TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS settings(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS tasks(
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      url TEXT DEFAULT '',
      reward NUMERIC(18,8) DEFAULT 0,
      task_type TEXT DEFAULT 'custom',
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS task_completions(
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      reward NUMERIC(18,8) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, task_id)
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS withdrawals(
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(18,8) NOT NULL,
      network TEXT DEFAULT '',
      address TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await q(
      `INSERT INTO settings(key,value)
       VALUES($1,$2)
       ON CONFLICT(key) DO NOTHING`,
      [key, String(value)]
    );
  }
}

async function settings() {
  const s = { ...DEFAULT_SETTINGS };

  const r = await q("SELECT key,value FROM settings");

  for (const row of r.rows) {
    s[row.key] = row.value;
  }

  s.allow_user_theme = String(s.allow_user_theme) === "true";
  s.maintenance = String(s.maintenance) === "true";
  s.referral_reward = Number(s.referral_reward || 0);
  s.minimum_withdraw = Number(s.minimum_withdraw || 0);
  s.withdraw_fee = Number(s.withdraw_fee || 0);

  return s;
}

async function saveSettings(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in DEFAULT_SETTINGS)) continue;

    await q(
      `INSERT INTO settings(key,value)
       VALUES($1,$2)
       ON CONFLICT(key)
       DO UPDATE SET value=EXCLUDED.value`,
      [key, String(value)]
    );
  }
}

/* =========================================================
   TELEGRAM WEBAPP AUTH
========================================================= */

function verify(initData) {
  if (!initData || !BOT_TOKEN) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) return null;

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (
    hash.length !== calculatedHash.length ||
    !crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(calculatedHash)
    )
  ) {
    return null;
  }

  const authDate = Number(params.get("auth_date") || 0);

  if (!authDate) return null;

  if (Date.now() / 1000 - authDate > 86400) {
    return null;
  }

  try {
    return JSON.parse(params.get("user") || "{}");
  } catch {
    return null;
  }
}

/* =========================================================
   USER
========================================================= */

async function getUser(tg, start = "") {
  const telegramId = String(tg.id);

  let r = await q(
    "SELECT * FROM users WHERE telegram_id=$1",
    [telegramId]
  );

  if (r.rows.length) {
    await q(
      `UPDATE users
       SET username=$1,
           first_name=$2,
           last_name=$3,
           updated_at=NOW()
       WHERE telegram_id=$4`,
      [
        tg.username || "",
        tg.first_name || "",
        tg.last_name || "",
        telegramId
      ]
    );

    r = await q(
      "SELECT * FROM users WHERE telegram_id=$1",
      [telegramId]
    );

    return r.rows[0];
  }

  let referredBy = "";

  const match = String(start).match(/^ref_(\d+)$/);

  if (match && match[1] !== telegramId) {
    const rr = await q(
      "SELECT telegram_id FROM users WHERE telegram_id=$1",
      [match[1]]
    );

    if (rr.rows.length) {
      referredBy = match[1];
    }
  }

  r = await q(
    `INSERT INTO users(
      telegram_id,
      username,
      first_name,
      last_name,
      referred_by
    )
    VALUES($1,$2,$3,$4,$5)
    RETURNING *`,
    [
      telegramId,
      tg.username || "",
      tg.first_name || "",
      tg.last_name || "",
      referredBy
    ]
  );

  if (referredBy) {
    const s = await settings();
    const reward = Number(s.referral_reward || 0);

    await q(
      `UPDATE users
       SET referrals=referrals+1,
           balance=balance+$1,
           total_earned=total_earned+$1,
           updated_at=NOW()
       WHERE telegram_id=$2`,
      [reward, referredBy]
    );
  }

  return r.rows[0];
}

/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

async function auth(req, res, next) {
  const initData =
    req.headers["x-telegram-init-data"] ||
    req.body?.initData ||
    "";

  const tg = verify(initData);

  if (!tg) {
    return res.status(401).json({
      error: "Telegram authentication required."
    });
  }

  try {
    const start =
      new URLSearchParams(initData).get("start_param") || "";

    const user = await getUser(tg, start);

    if (user.blocked) {
      return res.status(403).json({
        error: "Your account is blocked."
      });
    }

    req.tgUser = tg;
    req.user = user;

    next();
  } catch (error) {
    console.error("AUTH ERROR:", error);

    res.status(500).json({
      error: "Authentication failed."
    });
  }
}

async function admin(req, res, next) {
  const secret =
    req.headers["x-admin-secret"] ||
    req.body?.adminSecret ||
    "";

  if (ADMIN_SECRET && secret === ADMIN_SECRET) {
    return next();
  }

  const initData =
    req.headers["x-telegram-init-data"] ||
    req.body?.initData ||
    "";

  const tg = verify(initData);

  if (
    !tg ||
    !ADMIN_ID ||
    String(tg.id) !== ADMIN_ID
  ) {
    return res.status(403).json({
      error: "Admin access required."
    });
  }

  next();
}

/* =========================================================
   USER OUTPUT
========================================================= */

function userOut(user) {
  return {
    id: user.id,
    telegramId: user.telegram_id,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    balance: Number(user.balance),
    totalEarned: Number(user.total_earned),
    tasksDone: Number(user.tasks_done),
    referrals: Number(user.referrals),
    blocked: Boolean(user.blocked),
    theme: user.theme || ""
  };
}

function themeData(s, user) {
  let key = s.global_theme || "gold";

  if (
    s.allow_user_theme &&
    user?.theme &&
    THEMES[user.theme]
  ) {
    key = user.theme;
  }

  return {
    key,
    ...(THEMES[key] || THEMES.gold)
  };
}

/* =========================================================
   WINGO ENGINE
========================================================= */

const WINGO_API =
  "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json";

const SIGNAL_INTERVAL_MS = 4000;

let wingoState = {
  live: false,
  loading: false,
  lastSync: null,
  currentPeriod: null,
  currentNumber: null,
  nextPeriod: null,
  prediction: null,
  numbers: [],
  confidence: 0,
  pattern: "WAITING",
  history: [],
  stats: {
    total: 0,
    wins: 0,
    losses: 0,
    jackpots: 0,
    winRate: 0
  },
  error: null
};

let savedSignal = null;
let processedPeriod = null;

/* ---------------------------------------------------------
   FETCH WINGO API
--------------------------------------------------------- */

async function fetchWingoHistory() {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    8000
  );

  try {
    const response = await fetch(
      `${WINGO_API}?t=${Date.now()}`,
      {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/json"
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Wingo API HTTP ${response.status}`);
    }

    const json = await response.json();

    const list =
      json?.data?.list ||
      json?.list ||
      [];

    if (!Array.isArray(list) || !list.length) {
      throw new Error("Wingo API returned empty history.");
    }

    return list;
  } finally {
    clearTimeout(timeout);
  }
}

/* ---------------------------------------------------------
   NORMALIZE RESULT
--------------------------------------------------------- */

function normalizeRound(item) {
  const issue = String(
    item?.issueNumber ??
    item?.issue ??
    item?.period ??
    ""
  );

  const rawNumber =
    item?.number ??
    item?.result ??
    item?.openNumber ??
    item?.winNumber;

  const number = Number(rawNumber);

  if (
    !issue ||
    !Number.isInteger(number) ||
    number < 0 ||
    number > 9
  ) {
    return null;
  }

  return {
    issue,
    number,
    size: number >= 5 ? "BIG" : "SMALL",
    raw: item
  };
}

/* ---------------------------------------------------------
   NEXT PERIOD
--------------------------------------------------------- */

function getNextPeriod(issue) {
  try {
    return String(BigInt(issue) + 1n);
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------
   PATTERN ANALYSIS
--------------------------------------------------------- */

function analyzePattern(rounds) {
  if (rounds.length < 5) {
    return {
      pattern: "WAITING",
      prediction: null,
      confidence: 0,
      votes: {
        big: 0,
        small: 0
      }
    };
  }

  const recent = rounds.slice(0, 12);

  let bigVotes = 0;
  let smallVotes = 0;

  /* Recent trend */
  recent.slice(0, 6).forEach((r, index) => {
    const weight = 6 - index;

    if (r.size === "BIG") {
      bigVotes += weight;
    } else {
      smallVotes += weight;
    }
  });

  /* Last number tendency */
  const last = recent[0];

  if (last) {
    if (last.number >= 5) {
      smallVotes += 2;
    } else {
      bigVotes += 2;
    }
  }

  /* Alternation */
  if (recent.length >= 4) {
    const a = recent[0].size;
    const b = recent[1].size;
    const c = recent[2].size;
    const d = recent[3].size;

    if (
      a !== b &&
      b !== c &&
      c !== d
    ) {
      if (a === "BIG") {
        smallVotes += 4;
      } else {
        bigVotes += 4;
      }
    }
  }

  /* Streak reversal */
  let streak = 1;

  for (let i = 1; i < recent.length; i++) {
    if (recent[i].size === recent[0].size) {
      streak++;
    } else {
      break;
    }
  }

  if (streak >= 3) {
    if (recent[0].size === "BIG") {
      smallVotes += streak * 2;
    } else {
      bigVotes += streak * 2;
    }
  }

  const total = bigVotes + smallVotes;

  if (!total) {
    return {
      pattern: "NEUTRAL",
      prediction: "BIG",
      confidence: 50,
      votes: {
        big: 0,
        small: 0
      }
    };
  }

  const prediction =
    bigVotes >= smallVotes
      ? "BIG"
      : "SMALL";

  const winnerVotes =
    prediction === "BIG"
      ? bigVotes
      : smallVotes;

  let confidence =
    Math.round(
      (winnerVotes / total) * 100
    );

  confidence = Math.max(
    50,
    Math.min(92, confidence)
  );

  let pattern = "TREND";

  if (streak >= 3) {
    pattern = "STREAK REVERSAL";
  } else if (
    recent.length >= 4 &&
    recent[0].size !== recent[1].size &&
    recent[1].size !== recent[2].size
  ) {
    pattern = "ALTERNATING";
  }

  return {
    pattern,
    prediction,
    confidence,
    votes: {
      big: bigVotes,
      small: smallVotes
    }
  };
}

/* ---------------------------------------------------------
   NUMBER CANDIDATES
--------------------------------------------------------- */

function selectNumbers(rounds, prediction) {
  const allowed =
    prediction === "BIG"
      ? [5, 6, 7, 8, 9]
      : [0, 1, 2, 3, 4];

  const frequency = {};

  for (const n of allowed) {
    frequency[n] = 0;
  }

  rounds
    .slice(0, 30)
    .forEach((r) => {
      if (allowed.includes(r.number)) {
        frequency[r.number]++;
      }
    });

  const ranked = [...allowed].sort(
    (a, b) => {
      if (frequency[b] !== frequency[a]) {
        return frequency[b] - frequency[a];
      }

      return a - b;
    }
  );

  return ranked.slice(0, 2);
}

/* ---------------------------------------------------------
   EVALUATE PREVIOUS SIGNAL
--------------------------------------------------------- */

function evaluateSignal(actualRound) {
  if (
    !savedSignal ||
    !actualRound ||
    !savedSignal.period
  ) {
    return null;
  }

  if (
    String(savedSignal.period) !==
    String(actualRound.issue)
  ) {
    return null;
  }

  const resultNumber = actualRound.number;

  let result = "LOSS";

  if (
    Array.isArray(savedSignal.numbers) &&
    savedSignal.numbers.includes(resultNumber)
  ) {
    result = "JACKPOT";
  } else if (
    savedSignal.prediction ===
    actualRound.size
  ) {
    result = "WIN";
  }

  return {
    period: actualRound.issue,
    prediction: savedSignal.prediction,
    numbers: savedSignal.numbers || [],
    actual: resultNumber,
    actualSize: actualRound.size,
    confidence: savedSignal.confidence,
    result,
    createdAt: savedSignal.createdAt
  };
}

/* ---------------------------------------------------------
   BUILD SIGNAL
--------------------------------------------------------- */

function buildSignal(rounds) {
  if (!rounds.length) {
    return null;
  }

  const current = rounds[0];

  const nextPeriod =
    getNextPeriod(current.issue);

  if (!nextPeriod) {
    return null;
  }

  const analysis =
    analyzePattern(rounds);

  if (!analysis.prediction) {
    return null;
  }

  const numbers =
    selectNumbers(
      rounds,
      analysis.prediction
    );

  return {
    period: nextPeriod,
    prediction: analysis.prediction,
    numbers,
    confidence: analysis.confidence,
    pattern: analysis.pattern,
    votes: analysis.votes,
    createdAt: Date.now()
  };
}

/* ---------------------------------------------------------
   ENGINE SYNC
--------------------------------------------------------- */

async function syncWingo() {
  if (wingoState.loading) return;

  wingoState.loading = true;

  try {
    const rawList =
      await fetchWingoHistory();

    const rounds = rawList
      .map(normalizeRound)
      .filter(Boolean);

    if (!rounds.length) {
      throw new Error(
        "No valid Wingo rounds found."
      );
    }

    const current = rounds[0];

    /*
      IMPORTANT:
      API issue number is the source of truth.
      We do not generate the period ourselves.
    */

    if (
      processedPeriod &&
      processedPeriod !== current.issue &&
      savedSignal
    ) {
      const evaluated =
        evaluateSignal(current);

      if (evaluated) {
        wingoState.history.unshift(
          evaluated
        );

        wingoState.history =
          wingoState.history.slice(0, 100);

        processedPeriod =
          current.issue;

        savedSignal = null;
      }
    }

    /*
      Create signal only when there is
      no locked signal for the current
      next period.
    */

    if (!savedSignal) {
      const signal =
        buildSignal(rounds);

      if (signal) {
        savedSignal = signal;
      }
    }

    const stats = calculateStats(
      wingoState.history
    );

    wingoState = {
      ...wingoState,
      live: true,
      loading: false,
      lastSync: new Date().toISOString(),
      currentPeriod: current.issue,
      currentNumber: current.number,
      nextPeriod: savedSignal?.period || getNextPeriod(current.issue),
      prediction: savedSignal?.prediction || null,
      numbers: savedSignal?.numbers || [],
      confidence: savedSignal?.confidence || 0,
      pattern: savedSignal?.pattern || "WAITING",
      history: wingoState.history,
      stats,
      error: null
    };
  } catch (error) {
    wingoState.loading = false;
    wingoState.error = error.message;

    console.error(
      "WINGO ENGINE ERROR:",
      error.message
    );
  }
}

/* ---------------------------------------------------------
   STATS
--------------------------------------------------------- */

function calculateStats(history) {
  const total = history.length;

  const wins = history.filter(
    (x) => x.result === "WIN"
  ).length;

  const jackpots = history.filter(
    (x) => x.result === "JACKPOT"
  ).length;

  const losses = history.filter(
    (x) => x.result === "LOSS"
  ).length;

  const successful =
    wins + jackpots;

  const winRate =
    total > 0
      ? Math.round(
          (successful / total) * 100
        )
      : 0;

  return {
    total,
    wins,
    losses,
    jackpots,
    winRate
  };
}

/* ---------------------------------------------------------
   PUBLIC WINGO API
--------------------------------------------------------- */

app.get("/api/wingo", async (req, res) => {
  try {
    if (
      !wingoState.live ||
      !wingoState.lastSync
    ) {
      await syncWingo();
    }

    res.json({
      success: true,
      market: "WinGo 1M",
      period: wingoState.nextPeriod,
      currentPeriod: wingoState.currentPeriod,
      currentNumber: wingoState.currentNumber,
      signal: wingoState.prediction,
      numbers: wingoState.numbers,
      confidence: wingoState.confidence,
      pattern: wingoState.pattern,
      stats: wingoState.stats,
      history: wingoState.history.slice(0, 30),
      updatedAt: wingoState.lastSync,
      live: wingoState.live,
      error: wingoState.error
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Unable to load Wingo signal."
    });
  }
});

/* ---------------------------------------------------------
   WINGO HISTORY API
--------------------------------------------------------- */

app.get("/api/wingo/history", async (req, res) => {
  res.json({
    success: true,
    history: wingoState.history,
    stats: wingoState.stats
  });
});

/* ---------------------------------------------------------
   BACKGROUND ENGINE
--------------------------------------------------------- */

setInterval(
  () => {
    syncWingo().catch((error) => {
      console.error(
        "Background Wingo error:",
        error.message
      );
    });
  },
  SIGNAL_INTERVAL_MS
);

/* =========================================================
   USER API
========================================================= */

app.get("/health", async (req, res) => {
  try {
    await q("SELECT 1");

    res.json({
      ok: true,
      database: true,
      service: "ST Earn",
      wingo: wingoState.live
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      database: false,
      error: error.message
    });
  }
});

app.get("/api/config", async (req, res) => {
  try {
    const s = await settings();

    res.json({
      appName: s.app_name,
      logoUrl: s.logo_url,
      announcement: s.announcement,
      telegramChannel: s.telegram_channel,
      botUsername: BOT_USERNAME,
      maintenance: s.maintenance,
      allowUserTheme: s.allow_user_theme,
      themes: THEMES
    });
  } catch {
    res.status(500).json({
      error: "Unable to load configuration."
    });
  }
});

app.get("/api/me", auth, async (req, res) => {
  try {
    const s = await settings();

    const r = await q(
      "SELECT * FROM users WHERE id=$1",
      [req.user.id]
    );

    const user = r.rows[0];

    res.json({
      isAdmin: Boolean(
        ADMIN_ID &&
        String(user.telegram_id) === ADMIN_ID
      ),
      user: userOut(user),
      themeData: themeData(s, user)
    });
  } catch (error) {
    console.error(
      "ME API ERROR:",
      error
    );

    res.status(500).json({
      error: "Unable to load account."
    });
  }
});

app.get("/api/tasks", auth, async (req, res) => {
  try {
    const r = await q(
      `SELECT
         t.*,
         CASE
           WHEN tc.id IS NULL THEN FALSE
           ELSE TRUE
         END completed
       FROM tasks t
       LEFT JOIN task_completions tc
         ON tc.task_id=t.id
        AND tc.user_id=$1
       WHERE t.active=TRUE
       ORDER BY t.id DESC`,
      [req.user.id]
    );

    res.json({
      tasks: r.rows.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        url: t.url,
        reward: Number(t.reward),
        taskType: t.task_type,
        completed: Boolean(t.completed)
      }))
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Unable to load tasks."
    });
  }
});

app.post(
  "/api/tasks/:id/complete",
  auth,
  async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        error: "Invalid task ID."
      });
    }

    const connection =
      await pool.connect();

    try {
      await connection.query("BEGIN");

      const task =
        await connection.query(
          `SELECT *
           FROM tasks
           WHERE id=$1
             AND active=TRUE
           FOR UPDATE`,
          [id]
        );

      if (!task.rows.length) {
        await connection.query("ROLLBACK");

        return res.status(404).json({
          error: "Task not found."
        });
      }

      const existing =
        await connection.query(
          `SELECT id
           FROM task_completions
           WHERE user_id=$1
             AND task_id=$2`,
          [req.user.id, id]
        );

      if (existing.rows.length) {
        await connection.query("ROLLBACK");

        return res.status(409).json({
          error: "Task already completed."
        });
      }

      const reward =
        Number(task.rows[0].reward);

      await connection.query(
        `INSERT INTO task_completions(
          user_id,
          task_id,
          reward
        )
        VALUES($1,$2,$3)`,
        [
          req.user.id,
          id,
          reward
        ]
      );

      await connection.query(
        `UPDATE users
         SET balance=balance+$1,
             total_earned=total_earned+$1,
             tasks_done=tasks_done+1,
             updated_at=NOW()
         WHERE id=$2`,
        [
          reward,
          req.user.id
        ]
      );

      await connection.query("COMMIT");

      res.json({
        success: true,
        reward
      });
    } catch (error) {
      await connection.query("ROLLBACK");

      console.error(error);

      res.status(500).json({
        error: "Could not complete task."
      });
    } finally {
      connection.release();
    }
  }
);

app.post("/api/theme", auth, async (req, res) => {
  const s = await settings();

  if (!s.allow_user_theme) {
    return res.status(403).json({
      error: "User theme changing is disabled."
    });
  }

  const theme =
    String(req.body.theme || "");

  if (!THEMES[theme]) {
    return res.status(400).json({
      error: "Invalid theme."
    });
  }

  await q(
    `UPDATE users
     SET theme=$1,
         updated_at=NOW()
     WHERE id=$2`,
    [
      theme,
      req.user.id
    ]
  );

  res.json({
    success: true,
    theme
  });
});

app.get("/api/referrals", auth, async (req, res) => {
  const r = await q(
    `SELECT
       telegram_id,
       username,
       first_name,
       created_at
     FROM users
     WHERE referred_by=$1
     ORDER BY created_at DESC`,
    [req.user.telegram_id]
  );

  const s = await settings();

  const base =
    BOT_USERNAME
      ? `https://t.me/${BOT_USERNAME}`
      : "";

  res.json({
    referralReward:
      Number(s.referral_reward),

    referralLink:
      base
        ? `${base}?start=ref_${req.user.telegram_id}`
        : "",

    referrals: r.rows
  });
});

/* =========================================================
   WITHDRAWALS
========================================================= */

app.post(
  "/api/withdrawals",
  auth,
  async (req, res) => {
    const s = await settings();

    const amount =
      Number(req.body.amount || 0);

    const network =
      String(req.body.network || "").trim();

    const address =
      String(req.body.address || "").trim();

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({
        error: "Invalid withdrawal amount."
      });
    }

    if (
      amount <
      s.minimum_withdraw
    ) {
      return res.status(400).json({
        error:
          `Minimum withdrawal is ${s.minimum_withdraw} USDT.`
      });
    }

    if (!network || !address) {
      return res.status(400).json({
        error:
          "Network and address are required."
      });
    }

    const connection =
      await pool.connect();

    try {
      await connection.query("BEGIN");

      const userResult =
        await connection.query(
          `SELECT *
           FROM users
           WHERE id=$1
           FOR UPDATE`,
          [req.user.id]
        );

      const user =
        userResult.rows[0];

      if (
        !user ||
        Number(user.balance) < amount
      ) {
        await connection.query("ROLLBACK");

        return res.status(400).json({
          error: "Insufficient balance."
        });
      }

      const finalAmount =
        Math.max(
          0,
          amount -
          Number(s.withdraw_fee || 0)
        );

      await connection.query(
        `UPDATE users
         SET balance=balance-$1,
             updated_at=NOW()
         WHERE id=$2`,
        [
          amount,
          req.user.id
        ]
      );

      const withdrawal =
        await connection.query(
          `INSERT INTO withdrawals(
            user_id,
            amount,
            network,
            address,
            status
          )
          VALUES($1,$2,$3,$4,'pending')
          RETURNING *`,
          [
            req.user.id,
            finalAmount,
            network,
            address
          ]
        );

      await connection.query("COMMIT");

      res.json({
        success: true,
        withdrawal:
          withdrawal.rows[0]
      });
    } catch (error) {
      await connection.query("ROLLBACK");

      console.error(error);

      res.status(500).json({
        error: "Withdrawal failed."
      });
    } finally {
      connection.release();
    }
  }
);

app.get(
  "/api/withdrawals",
  auth,
  async (req, res) => {
    const r = await q(
      `SELECT *
       FROM withdrawals
       WHERE user_id=$1
       ORDER BY id DESC`,
      [req.user.id]
    );

    res.json({
      withdrawals: r.rows
    });
  }
);

/* =========================================================
   ADMIN SETTINGS
========================================================= */

app.get(
  "/api/admin/settings",
  admin,
  async (req, res) => {
    res.json({
      settings: await settings(),
      themes: THEMES
    });
  }
);

app.put(
  "/api/admin/settings",
  admin,
  async (req, res) => {
    const allowed = [
      "app_name",
      "logo_url",
      "global_theme",
      "allow_user_theme",
      "referral_reward",
      "minimum_withdraw",
      "withdraw_fee",
      "announcement",
      "maintenance",
      "telegram_channel"
    ];

    const values = {};

    for (const key of allowed) {
      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          key
        )
      ) {
        values[key] =
          req.body[key];
      }
    }

    if (
      values.global_theme &&
      !THEMES[
        String(values.global_theme)
      ]
    ) {
      return res.status(400).json({
        error: "Invalid theme."
      });
    }

    await saveSettings(values);

    res.json({
      success: true,
      settings: await settings()
    });
  }
);

/* =========================================================
   ADMIN TASKS
========================================================= */

app.get(
  "/api/admin/tasks",
  admin,
  async (req, res) => {
    res.json({
      tasks: (
        await q(
          "SELECT * FROM tasks ORDER BY id DESC"
        )
      ).rows
    });
  }
);

app.post(
  "/api/admin/tasks",
  admin,
  async (req, res) => {
    const title =
      String(req.body.title || "").trim();

    const description =
      String(
        req.body.description || ""
      ).trim();

    const url =
      String(req.body.url || "").trim();

    const reward =
      Number(req.body.reward || 0);

    const type =
      String(
        req.body.task_type || "custom"
      ).trim();

    if (!title) {
      return res.status(400).json({
        error: "Task title is required."
      });
    }

    if (
      !Number.isFinite(reward) ||
      reward < 0
    ) {
      return res.status(400).json({
        error: "Invalid reward."
      });
    }

    const r = await q(
      `INSERT INTO tasks(
        title,
        description,
        url,
        reward,
        task_type,
        active
      )
      VALUES($1,$2,$3,$4,$5,TRUE)
      RETURNING *`,
      [
        title,
        description,
        url,
        reward,
        type
      ]
    );

    res.json({
      success: true,
      task: r.rows[0]
    });
  }
);

app.put(
  "/api/admin/tasks/:id",
  admin,
  async (req, res) => {
    const id =
      Number(req.params.id);

    const old =
      (
        await q(
          "SELECT * FROM tasks WHERE id=$1",
          [id]
        )
      ).rows[0];

    if (!old) {
      return res.status(404).json({
        error: "Task not found."
      });
    }

    const title =
      String(
        req.body.title ??
        old.title
      ).trim();

    const description =
      String(
        req.body.description ??
        old.description
      ).trim();

    const url =
      String(
        req.body.url ??
        old.url
      ).trim();

    const reward =
      Number(
        req.body.reward ??
        old.reward
      );

    const type =
      String(
        req.body.task_type ??
        old.task_type
      ).trim();

    const active =
      req.body.active === undefined
        ? Boolean(old.active)
        : Boolean(req.body.active);

    if (
      !title ||
      !Number.isFinite(reward) ||
      reward < 0
    ) {
      return res.status(400).json({
        error: "Invalid task data."
      });
    }

    const r = await q(
      `UPDATE tasks
       SET title=$1,
           description=$2,
           url=$3,
           reward=$4,
           task_type=$5,
           active=$6
       WHERE id=$7
       RETURNING *`,
      [
        title,
        description,
        url,
        reward,
        type,
        active,
        id
      ]
    );

    res.json({
      success: true,
      task: r.rows[0]
    });
  }
);

app.delete(
  "/api/admin/tasks/:id",
  admin,
  async (req, res) => {
    const id =
      Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        error: "Invalid task ID."
      });
    }

    await q(
      "DELETE FROM tasks WHERE id=$1",
      [id]
    );

    res.json({
      success: true
    });
  }
);

/* =========================================================
   ADMIN USERS
========================================================= */

app.get(
  "/api/admin/users",
  admin,
  async (req, res) => {
    const r = await q(
      `SELECT
         id,
         telegram_id,
         username,
         first_name,
         last_name,
         balance,
         total_earned,
         tasks_done,
         referrals,
         blocked,
         created_at
       FROM users
       ORDER BY id DESC`
    );

    res.json({
      users: r.rows
    });
  }
);

app.put(
  "/api/admin/users/:telegramId",
  admin,
  async (req, res) => {
    const updates = [];
    const values = [];

    if (req.body.balance !== undefined) {
      const balance =
        Number(req.body.balance);

      if (
        !Number.isFinite(balance) ||
        balance < 0
      ) {
        return res.status(400).json({
          error: "Invalid balance."
        });
      }

      values.push(balance);

      updates.push(
        `balance=$${values.length}`
      );
    }

    if (
      req.body.blocked !== undefined
    ) {
      values.push(
        Boolean(req.body.blocked)
      );

      updates.push(
        `blocked=$${values.length}`
      );
    }

    if (!updates.length) {
      return res.status(400).json({
        error: "Nothing to update."
      });
    }

    values.push(
      String(req.params.telegramId)
    );

    await q(
      `UPDATE users
       SET ${updates.join(",")},
           updated_at=NOW()
       WHERE telegram_id=$${values.length}`,
      values
    );

    res.json({
      success: true
    });
  }
);

/* =========================================================
   ADMIN WITHDRAWALS
========================================================= */

app.get(
  "/api/admin/withdrawals",
  admin,
  async (req, res) => {
    const r = await q(
      `SELECT
         w.*,
         u.telegram_id,
         u.username,
         u.first_name
       FROM withdrawals w
       JOIN users u
         ON u.id=w.user_id
       ORDER BY w.id DESC`
    );

    res.json({
      withdrawals: r.rows
    });
  }
);

app.put(
  "/api/admin/withdrawals/:id",
  admin,
  async (req, res) => {
    const id =
      Number(req.params.id);

    const status =
      String(
        req.body.status || ""
      );

    if (
      !["paid", "rejected"]
        .includes(status)
    ) {
      return res.status(400).json({
        error:
          "Invalid withdrawal status."
      });
    }

    const connection =
      await pool.connect();

    try {
      await connection.query("BEGIN");

      const r =
        await connection.query(
          `SELECT *
           FROM withdrawals
           WHERE id=$1
           FOR UPDATE`,
          [id]
        );

      if (!r.rows.length) {
        await connection.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          error:
            "Withdrawal not found."
        });
      }

      const withdrawal =
        r.rows[0];

      if (
        withdrawal.status !==
        "pending"
      ) {
        await connection.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          error:
            "Withdrawal already processed."
        });
      }

      await connection.query(
        `UPDATE withdrawals
         SET status=$1,
             updated_at=NOW()
         WHERE id=$2`,
        [
          status,
          id
        ]
      );

      if (status === "rejected") {
        await connection.query(
          `UPDATE users
           SET balance=balance+$1,
               updated_at=NOW()
           WHERE id=$2`,
          [
            Number(
              withdrawal.amount
            ),
            withdrawal.user_id
          ]
        );
      }

      await connection.query(
        "COMMIT"
      );

      res.json({
        success: true
      });
    } catch (error) {
      await connection.query(
        "ROLLBACK"
      );

      console.error(error);

      res.status(500).json({
        error:
          "Unable to update withdrawal."
      });
    } finally {
      connection.release();
    }
  }
);

/* =========================================================
   TELEGRAM API
========================================================= */

async function tg(
  method,
  body = {}
) {
  if (!BOT_TOKEN) {
    throw new Error(
      "BOT_TOKEN is missing."
    );
  }

  const response =
    await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body:
          JSON.stringify(body)
      }
    );

  const data =
    await response.json();

  if (!data.ok) {
    throw new Error(
      data.description ||
      "Telegram API error"
    );
  }

  return data.result;
}

async function setupMenu() {
  if (
    !BOT_TOKEN ||
    !WEBAPP_URL
  ) {
    console.log(
      "BOT_TOKEN or WEBAPP_URL missing. Telegram menu skipped."
    );

    return;
  }

  try {
    await tg(
      "setChatMenuButton",
      {
        menu_button: {
          type: "web_app",
          text: "Open ST Earn",
          web_app: {
            url: WEBAPP_URL
          }
        }
      }
    );

    console.log(
      "Telegram menu button: configured"
    );
  } catch (error) {
    console.error(
      "Telegram menu error:",
      error.message
    );
  }
}

async function botStart(
  chatId,
  user,
  param = ""
) {
  const u =
    await getUser(
      user,
      param
    );

  const s =
    await settings();

  if (u.blocked) {
    await tg(
      "sendMessage",
      {
        chat_id: chatId,
        text:
          "🚫 Your account is blocked."
      }
    );

    return;
  }

  const name =
    user.first_name ||
    user.username ||
    "User";

  let text =
    `🐝 ${s.app_name}\n\n` +
    `Welcome, ${name}! 🎉\n\n` +
    `💰 Balance: ${Number(
      u.balance
    ).toFixed(2)} USDT\n` +
    `🎯 Tasks Done: ${
      u.tasks_done
    }\n` +
    `👥 Referrals: ${
      u.referrals
    }\n\n` +
    `👇 নিচের button চাপ দিয়ে Mini App খুলুন।`;

  if (
    ADMIN_ID &&
    String(user.id) ===
      ADMIN_ID
  ) {
    text +=
      "\n\n👑 Admin account detected.";
  }

  const markup =
    WEBAPP_URL
      ? {
          inline_keyboard: [
            [
              {
                text:
                  "🐝 Open ST Earn",
                web_app: {
                  url:
                    WEBAPP_URL
                }
              }
            ]
          ]
        }
      : undefined;

  await tg(
    "sendMessage",
    {
      chat_id: chatId,
      text,
      ...(markup
        ? {
            reply_markup:
              markup
          }
        : {})
    }
  );
}

/* =========================================================
   TELEGRAM POLLING
========================================================= */

let botPollingStarted = false;
let botPollingStopped = false;

async function startBot() {
  if (!BOT_TOKEN) {
    console.log(
      "BOT_TOKEN missing. Telegram bot skipped."
    );

    return;
  }

  if (botPollingStarted) {
    console.log(
      "Telegram polling already started."
    );

    return;
  }

  botPollingStarted = true;

  try {
    const me =
      await tg("getMe");

    console.log(
      `Telegram bot connected: @${me.username || "unknown"}`
    );

    /*
      Remove webhook before long polling.
      Pending updates are preserved.
    */

    await tg(
      "deleteWebhook",
      {
        drop_pending_updates:
          false
      }
    );

    await setupMenu();

    let offset = 0;

    async function poll() {
      if (botPollingStopped) {
        return;
      }

      try {
        const updates =
          await tg(
            "getUpdates",
            {
              offset,
              timeout: 25,
              allowed_updates: [
                "message"
              ]
            }
          );

        for (
          const update of updates
        ) {
          offset =
            Number(
              update.update_id
            ) + 1;

          const message =
            update.message;

          if (
            !message?.chat ||
            !message?.from
          ) {
            continue;
          }

          const text =
            String(
              message.text || ""
            ).trim();

          const startMatch =
            text.match(
              /^\/start(?:@\w+)?(?:\s+(.+))?$/i
            );

          if (startMatch) {
            await botStart(
              message.chat.id,
              message.from,
              startMatch[1] ||
                ""
            );

            continue;
          }

          if (
            /^\/help(?:@\w+)?$/i.test(
              text
            )
          ) {
            await tg(
              "sendMessage",
              {
                chat_id:
                  message.chat.id,
                text:
                  "🐝 ST Earn Help\n\n" +
                  "/start — Open ST Earn\n" +
                  "/help — Show help"
              }
            );
          }
        }
      } catch (error) {
        console.error(
          "Telegram polling error:",
          error.message
        );

        /*
          Prevent a tight retry loop.
        */

        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              5000
            )
        );
      }

      setImmediate(poll);
    }

    poll();

    console.log(
      "Telegram bot polling started."
    );
  } catch (error) {
    botPollingStarted = false;

    console.error(
      "Telegram bot startup failed:",
      error.message
    );
  }
}

/* =========================================================
   FRONTEND
========================================================= */

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);

app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =========================================================
   START SERVER
========================================================= */

async function start() {
  try {
    if (!DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is missing."
      );
    }

    await initDB();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `ST Earn running on port ${PORT}`
        );
      }
    );

    /*
      Start first Wingo sync.
      Failure here does NOT stop the website.
    */

    syncWingo().catch(
      (error) => {
        console.error(
          "Initial Wingo sync failed:",
          error.message
        );
      }
    );

    await startBot();

    console.log(
      "ST Earn startup completed."
    );
  } catch (error) {
    console.error(
      "Server startup failed:",
      error
    );

    process.exit(1);
  }
}

start();
