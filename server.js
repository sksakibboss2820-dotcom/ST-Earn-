const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT || 10000);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const BOT_TOKEN = String(process.env.BOT_TOKEN || "").trim();
const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || "").trim();
const ADMIN_SECRET = String(process.env.ADMIN_SECRET || "").trim();
const WEBAPP_URL = String(process.env.WEBAPP_URL || "").trim().replace(/\/+$/, "");
const BOT_USERNAME = String(process.env.BOT_USERNAME || "").trim().replace(/^@/, "");

if (!DATABASE_URL) {
  console.warn("WARNING: DATABASE_URL is missing.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : false
});


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
    text: "#fff",
    muted: "#9da3ad"
  },

  emerald: {
    name: "Emerald",
    primary: "#20d48a",
    secondary: "#58f0aa",
    background: "#07110d",
    card: "#101c16",
    text: "#fff",
    muted: "#98aaa1"
  },

  ocean: {
    name: "Ocean Blue",
    primary: "#28a9ff",
    secondary: "#67c8ff",
    background: "#071018",
    card: "#111c25",
    text: "#fff",
    muted: "#9aaebd"
  },

  purple: {
    name: "Royal Purple",
    primary: "#a66cff",
    secondary: "#c49aff",
    background: "#0e0915",
    card: "#18121f",
    text: "#fff",
    muted: "#aaa0b4"
  },

  ruby: {
    name: "Ruby Red",
    primary: "#ff405c",
    secondary: "#ff7185",
    background: "#14090c",
    card: "#211216",
    text: "#fff",
    muted: "#b5a0a5"
  },

  cyan: {
    name: "Cyan",
    primary: "#22dce6",
    secondary: "#6df3f7",
    background: "#061214",
    card: "#101c1e",
    text: "#fff",
    muted: "#9db3b5"
  },

  sunset: {
    name: "Sunset Orange",
    primary: "#ff8a00",
    secondary: "#ffc14d",
    background: "#160d06",
    card: "#21150c",
    text: "#fff",
    muted: "#b9a99a"
  },

  pink: {
    name: "Pink",
    primary: "#ff4fa3",
    secondary: "#ff85c1",
    background: "#160914",
    card: "#21121d",
    text: "#fff",
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
   DATABASE
========================================================= */

async function q(sql, params = []) {
  return pool.query(sql, params);
}

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

  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await q(
      `
      INSERT INTO settings(key,value)
      VALUES($1,$2)
      ON CONFLICT(key) DO NOTHING
      `,
      [k, String(v)]
    );
  }
}


async function settings() {

  const s = { ...DEFAULT_SETTINGS };

  const r = await q("SELECT key,value FROM settings");

  for (const x of r.rows) {
    s[x.key] = x.value;
  }

  s.allow_user_theme = String(s.allow_user_theme) === "true";
  s.maintenance = String(s.maintenance) === "true";
  s.referral_reward = Number(s.referral_reward || 0);
  s.minimum_withdraw = Number(s.minimum_withdraw || 0);
  s.withdraw_fee = Number(s.withdraw_fee || 0);

  return s;
}


async function saveSettings(values) {

  for (const [k, v] of Object.entries(values)) {

    if (!(k in DEFAULT_SETTINGS)) {
      continue;
    }

    await q(
      `
      INSERT INTO settings(key,value)
      VALUES($1,$2)
      ON CONFLICT(key)
      DO UPDATE SET value=EXCLUDED.value
      `,
      [k, String(v)]
    );
  }
}


/* =========================================================
   TELEGRAM WEB APP AUTH
========================================================= */

function verify(initData) {

  if (!initData || !BOT_TOKEN) {
    return null;
  }

  const p = new URLSearchParams(initData);
  const hash = p.get("hash");

  if (!hash) {
    return null;
  }

  p.delete("hash");

  const check = [...p.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const calc = crypto
    .createHmac("sha256", secret)
    .update(check)
    .digest("hex");

  if (
    hash.length !== calc.length ||
    !crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(calc)
    )
  ) {
    return null;
  }

  const authDate = Number(p.get("auth_date") || 0);

  if (!authDate || Date.now() / 1000 - authDate > 86400) {
    return null;
  }

  try {
    return JSON.parse(p.get("user") || "{}");
  } catch {
    return null;
  }
}


/* =========================================================
   USER
========================================================= */

async function getUser(tg, start = "") {

  const tid = String(tg.id);

  let r = await q(
    "SELECT * FROM users WHERE telegram_id=$1",
    [tid]
  );

  if (r.rows.length) {

    await q(
      `
      UPDATE users
      SET
        username=$1,
        first_name=$2,
        last_name=$3,
        updated_at=NOW()
      WHERE telegram_id=$4
      `,
      [
        tg.username || "",
        tg.first_name || "",
        tg.last_name || "",
        tid
      ]
    );

    r = await q(
      "SELECT * FROM users WHERE telegram_id=$1",
      [tid]
    );

    return r.rows[0];
  }

  let ref = "";

  const m = String(start).match(/^ref_(\d+)$/);

  if (m && m[1] !== tid) {

    const rr = await q(
      "SELECT telegram_id FROM users WHERE telegram_id=$1",
      [m[1]]
    );

    if (rr.rows.length) {
      ref = m[1];
    }
  }

  r = await q(
    `
    INSERT INTO users(
      telegram_id,
      username,
      first_name,
      last_name,
      referred_by
    )
    VALUES($1,$2,$3,$4,$5)
    RETURNING *
    `,
    [
      tid,
      tg.username || "",
      tg.first_name || "",
      tg.last_name || "",
      ref
    ]
  );

  if (ref) {

    const s = await settings();
    const reward = Number(s.referral_reward || 0);

    await q(
      `
      UPDATE users
      SET
        referrals=referrals+1,
        balance=balance+$1,
        total_earned=total_earned+$1,
        updated_at=NOW()
      WHERE telegram_id=$2
      `,
      [reward, ref]
    );
  }

  return r.rows[0];
}


/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

async function auth(req, res, next) {

  const init =
    req.headers["x-telegram-init-data"] ||
    req.body?.initData ||
    "";

  const tg = verify(init);

  if (!tg) {
    return res.status(401).json({
      error: "Telegram authentication required."
    });
  }

  try {

    const start =
      new URLSearchParams(init).get("start_param") || "";

    const user = await getUser(tg, start);

    if (user.blocked) {
      return res.status(403).json({
        error: "Your account is blocked."
      });
    }

    req.tgUser = tg;
    req.user = user;

    next();

  } catch (e) {

    console.error("AUTH:", e);

    res.status(500).json({
      error: "Authentication failed."
    });
  }
}


/* =========================================================
   ADMIN AUTH
========================================================= */

async function admin(req, res, next) {

  const secret =
    req.headers["x-admin-secret"] ||
    req.body?.adminSecret ||
    "";

  if (ADMIN_SECRET && secret === ADMIN_SECRET) {
    return next();
  }

  const init =
    req.headers["x-telegram-init-data"] ||
    req.body?.initData ||
    "";

  const tg = verify(init);

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
   OUTPUT HELPERS
========================================================= */

function userOut(u) {

  return {
    id: u.id,
    telegramId: u.telegram_id,
    username: u.username,
    firstName: u.first_name,
    lastName: u.last_name,
    balance: Number(u.balance),
    totalEarned: Number(u.total_earned),
    tasksDone: Number(u.tasks_done),
    referrals: Number(u.referrals),
    blocked: Boolean(u.blocked),
    theme: u.theme || ""
  };
}


function themeData(s, u) {

  let k = s.global_theme || "gold";

  if (
    s.allow_user_theme &&
    u?.theme &&
    THEMES[u.theme]
  ) {
    k = u.theme;
  }

  return {
    key: k,
    ...(THEMES[k] || THEMES.gold)
  };
}


/* =========================================================
   USER API
========================================================= */

app.get("/health", async (req, res) => {

  try {

    await q("SELECT 1");

    res.json({
      ok: true,
      database: true,
      service: "ST Earn"
    });

  } catch (e) {

    res.status(500).json({
      ok: false,
      database: false,
      error: e.message
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

  } catch (e) {

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

    const u = r.rows[0];

    res.json({
      isAdmin:
        Boolean(
          ADMIN_ID &&
          String(u.telegram_id) === ADMIN_ID
        ),

      user: userOut(u),

      themeData: themeData(s, u)
    });

  } catch (e) {

    console.error(e);

    res.status(500).json({
      error: "Unable to load account."
    });
  }
});


/* =========================================================
   TASKS
========================================================= */

app.get("/api/tasks", auth, async (req, res) => {

  try {

    const r = await q(
      `
      SELECT
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

      ORDER BY t.id DESC
      `,
      [req.user.id]
    );

    res.json({
      tasks: r.rows.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        url: t.url,
        reward: Number(t.reward),
        taskType: t.task_type,
        completed: Boolean(t.completed)
      }))
    });

  } catch (e) {

    console.error(e);

    res.status(500).json({
      error: "Unable to load tasks."
    });
  }
});


app.post("/api/tasks/:id/complete", auth, async (req, res) => {

  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({
      error: "Invalid task ID."
    });
  }

  const c = await pool.connect();

  try {

    await c.query("BEGIN");

    const tr = await c.query(
      `
      SELECT *
      FROM tasks
      WHERE id=$1
      AND active=TRUE
      FOR UPDATE
      `,
      [id]
    );

    if (!tr.rows.length) {

      await c.query("ROLLBACK");

      return res.status(404).json({
        error: "Task not found."
      });
    }

    const ex = await c.query(
      `
      SELECT id
      FROM task_completions
      WHERE user_id=$1
      AND task_id=$2
      `,
      [req.user.id, id]
    );

    if (ex.rows.length) {

      await c.query("ROLLBACK");

      return res.status(409).json({
        error: "Task already completed."
      });
    }

    const reward = Number(tr.rows[0].reward);

    await c.query(
      `
      INSERT INTO task_completions(
        user_id,
        task_id,
        reward
      )
      VALUES($1,$2,$3)
      `,
      [req.user.id, id, reward]
    );

    await c.query(
      `
      UPDATE users
      SET
        balance=balance+$1,
        total_earned=total_earned+$1,
        tasks_done=tasks_done+1,
        updated_at=NOW()
      WHERE id=$2
      `,
      [reward, req.user.id]
    );

    await c.query("COMMIT");

    res.json({
      success: true,
      reward
    });

  } catch (e) {

    await c.query("ROLLBACK");

    console.error(e);

    res.status(500).json({
      error: "Could not complete task."
    });

  } finally {

    c.release();
  }
});


/* =========================================================
   USER THEME
========================================================= */

app.post("/api/theme", auth, async (req, res) => {

  const s = await settings();

  if (!s.allow_user_theme) {

    return res.status(403).json({
      error: "User theme changing is disabled."
    });
  }

  const t = String(req.body.theme || "");

  if (!THEMES[t]) {

    return res.status(400).json({
      error: "Invalid theme."
    });
  }

  await q(
    `
    UPDATE users
    SET theme=$1,
        updated_at=NOW()
    WHERE id=$2
    `,
    [t, req.user.id]
  );

  res.json({
    success: true,
    theme: t
  });
});


/* =========================================================
   REFERRALS
========================================================= */

app.get("/api/referrals", auth, async (req, res) => {

  const r = await q(
    `
    SELECT
      telegram_id,
      username,
      first_name,
      created_at
    FROM users
    WHERE referred_by=$1
    ORDER BY created_at DESC
    `,
    [req.user.telegram_id]
  );

  const s = await settings();

  const base = BOT_USERNAME
    ? `https://t.me/${BOT_USERNAME}`
    : "";

  res.json({
    referralReward: Number(s.referral_reward),
    referralLink: base
      ? `${base}?start=ref_${req.user.telegram_id}`
      : "",
    referrals: r.rows
  });
});


/* =========================================================
   WITHDRAW
========================================================= */

app.post("/api/withdrawals", auth, async (req, res) => {

  const s = await settings();

  const amount = Number(req.body.amount || 0);

  const network =
    String(req.body.network || "").trim();

  const address =
    String(req.body.address || "").trim();

  if (!Number.isFinite(amount) || amount <= 0) {

    return res.status(400).json({
      error: "Invalid withdrawal amount."
    });
  }

  if (amount < s.minimum_withdraw) {

    return res.status(400).json({
      error:
        `Minimum withdrawal is ${s.minimum_withdraw} USDT.`
    });
  }

  if (!network || !address) {

    return res.status(400).json({
      error: "Network and address are required."
    });
  }

  const c = await pool.connect();

  try {

    await c.query("BEGIN");

    const ur = await c.query(
      "SELECT * FROM users WHERE id=$1 FOR UPDATE",
      [req.user.id]
    );

    const u = ur.rows[0];

    if (!u || Number(u.balance) < amount) {

      await c.query("ROLLBACK");

      return res.status(400).json({
        error: "Insufficient balance."
      });
    }

    const final = Math.max(
      0,
      amount - Number(s.withdraw_fee || 0)
    );

    await c.query(
      `
      UPDATE users
      SET
        balance=balance-$1,
        updated_at=NOW()
      WHERE id=$2
      `,
      [amount, req.user.id]
    );

    const wr = await c.query(
      `
      INSERT INTO withdrawals(
        user_id,
        amount,
        network,
        address,
        status
      )
      VALUES($1,$2,$3,$4,'pending')
      RETURNING *
      `,
      [
        req.user.id,
        final,
        network,
        address
      ]
    );

    await c.query("COMMIT");

    res.json({
      success: true,
      withdrawal: wr.rows[0]
    });

  } catch (e) {

    await c.query("ROLLBACK");

    console.error(e);

    res.status(500).json({
      error: "Withdrawal failed."
    });

  } finally {

    c.release();
  }
});


app.get("/api/withdrawals", auth, async (req, res) => {

  const r = await q(
    `
    SELECT *
    FROM withdrawals
    WHERE user_id=$1
    ORDER BY id DESC
    `,
    [req.user.id]
  );

  res.json({
    withdrawals: r.rows
  });
});


/* =========================================================
   ADMIN SETTINGS
========================================================= */

app.get("/api/admin/settings", admin, async (req, res) => {

  res.json({
    settings: await settings(),
    themes: THEMES
  });
});


app.put("/api/admin/settings", admin, async (req, res) => {

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

  const v = {};

  for (const k of allowed) {

    if (
      Object.prototype.hasOwnProperty.call(
        req.body,
        k
      )
    ) {
      v[k] = req.body[k];
    }
  }

  if (
    v.global_theme &&
    !THEMES[String(v.global_theme)]
  ) {

    return res.status(400).json({
      error: "Invalid theme."
    });
  }

  await saveSettings(v);

  res.json({
    success: true,
    settings: await settings()
  });
});


/* =========================================================
   ADMIN TASKS
========================================================= */

app.get("/api/admin/tasks", admin, async (req, res) => {

  res.json({
    tasks: (
      await q(
        "SELECT * FROM tasks ORDER BY id DESC"
      )
    ).rows
  });
});


app.post("/api/admin/tasks", admin, async (req, res) => {

  const title =
    String(req.body.title || "").trim();

  const description =
    String(req.body.description || "").trim();

  const url =
    String(req.body.url || "").trim();

  const reward =
    Number(req.body.reward || 0);

  const type =
    String(req.body.task_type || "custom").trim();

  if (!title) {

    return res.status(400).json({
      error: "Task title is required."
    });
  }

  if (!Number.isFinite(reward) || reward < 0) {

    return res.status(400).json({
      error: "Invalid reward."
    });
  }

  const r = await q(
    `
    INSERT INTO tasks(
      title,
      description,
      url,
      reward,
      task_type,
      active
    )
    VALUES($1,$2,$3,$4,$5,TRUE)
    RETURNING *
    `,
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
});


app.put("/api/admin/tasks/:id", admin, async (req, res) => {

  const id = Number(req.params.id);

  const old = (
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
      req.body.title ?? old.title
    ).trim();

  const description =
    String(
      req.body.description ?? old.description
    ).trim();

  const url =
    String(
      req.body.url ?? old.url
    ).trim();

  const reward =
    Number(
      req.body.reward ?? old.reward
    );

  const type =
    String(
      req.body.task_type ?? old.task_type
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
    `
    UPDATE tasks
    SET
      title=$1,
      description=$2,
      url=$3,
      reward=$4,
      task_type=$5,
      active=$6
    WHERE id=$7
    RETURNING *
    `,
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
});


app.delete("/api/admin/tasks/:id", admin, async (req, res) => {

  const id = Number(req.params.id);

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
});


/* =========================================================
   ADMIN USERS
========================================================= */

app.get("/api/admin/users", admin, async (req, res) => {

  const r = await q(
    `
    SELECT
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
    ORDER BY id DESC
    `
  );

  res.json({
    users: r.rows
  });
});


app.put("/api/admin/users/:telegramId", admin, async (req, res) => {

  const updates = [];
  const vals = [];

  if (req.body.balance !== undefined) {

    const b = Number(req.body.balance);

    if (!Number.isFinite(b) || b < 0) {

      return res.status(400).json({
        error: "Invalid balance."
      });
    }

    vals.push(b);

    updates.push(
      `balance=$${vals.length}`
    );
  }

  if (req.body.blocked !== undefined) {

    vals.push(Boolean(req.body.blocked));

    updates.push(
      `blocked=$${vals.length}`
    );
  }

  if (!updates.length) {

    return res.status(400).json({
      error: "Nothing to update."
    });
  }

  vals.push(String(req.params.telegramId));

  await q(
    `
    UPDATE users
    SET
      ${updates.join(",")},
      updated_at=NOW()
    WHERE telegram_id=$${vals.length}
    `,
    vals
  );

  res.json({
    success: true
  });
});


/* =========================================================
   ADMIN WITHDRAWALS
========================================================= */

app.get("/api/admin/withdrawals", admin, async (req, res) => {

  const r = await q(
    `
    SELECT
      w.*,
      u.telegram_id,
      u.username,
      u.first_name
    FROM withdrawals w
    JOIN users u
      ON u.id=w.user_id
    ORDER BY w.id DESC
    `
  );

  res.json({
    withdrawals: r.rows
  });
});


app.put("/api/admin/withdrawals/:id", admin, async (req, res) => {

  const id = Number(req.params.id);

  const status =
    String(req.body.status || "");

  if (!["paid", "rejected"].includes(status)) {

    return res.status(400).json({
      error: "Invalid withdrawal status."
    });
  }

  const c = await pool.connect();

  try {

    await c.query("BEGIN");

    const r = await c.query(
      `
      SELECT *
      FROM withdrawals
      WHERE id=$1
      FOR UPDATE
      `,
      [id]
    );

    if (!r.rows.length) {

      await c.query("ROLLBACK");

      return res.status(404).json({
        error: "Withdrawal not found."
      });
    }

    const w = r.rows[0];

    if (w.status !== "pending") {

      await c.query("ROLLBACK");

      return res.status(400).json({
        error: "Withdrawal already processed."
      });
    }

    await c.query(
      `
      UPDATE withdrawals
      SET
        status=$1,
        updated_at=NOW()
      WHERE id=$2
      `,
      [status, id]
    );

    if (status === "rejected") {

      await c.query(
        `
        UPDATE users
        SET
          balance=balance+$1,
          updated_at=NOW()
        WHERE id=$2
        `,
        [
          Number(w.amount),
          w.user_id
        ]
      );
    }

    await c.query("COMMIT");

    res.json({
      success: true
    });

  } catch (e) {

    await c.query("ROLLBACK");

    console.error(e);

    res.status(500).json({
      error: "Unable to update withdrawal."
    });

  } finally {

    c.release();
  }
});


/* =========================================================
   TELEGRAM BOT
========================================================= */

async function tg(method, body = {}) {

  if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN is missing.");
  }

  const r = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await r.json();

  if (!data.ok) {
    throw new Error(
      data.description || "Telegram API error"
    );
  }

  return data.result;
}


async function setupMenu() {

  if (!BOT_TOKEN || !WEBAPP_URL) {

    console.log(
      "BOT_TOKEN or WEBAPP_URL missing. Telegram menu button skipped."
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

  } catch (e) {

    console.error(
      "Telegram menu error:",
      e.message
    );
  }
}


async function botStart(
  chatId,
  user,
  param = ""
) {

  const u = await getUser(
    user,
    param
  );

  const s = await settings();

  if (u.blocked) {

    await tg(
      "sendMessage",
      {
        chat_id: chatId,
        text: "🚫 Your account is blocked."
      }
    );

    return;
  }

  const name =
    user.first_name ||
    user.username ||
    "User";

  let text =
`🐝 ${s.app_name}

Welcome, ${name}! 🎉

💰 Balance: ${Number(u.balance).toFixed(2)} USDT
🎯 Tasks Done: ${u.tasks_done}
👥 Referrals: ${u.referrals}

👇 নিচের button চাপ দিয়ে Mini App খুলুন।`;

  if (
    ADMIN_ID &&
    String(user.id) === ADMIN_ID
  ) {
    text +=
      "\n\n👑 Admin account detected.";
  }

  const markup = WEBAPP_URL
    ? {
        inline_keyboard: [
          [
            {
              text: "🐝 Open ST Earn",
              web_app: {
                url: WEBAPP_URL
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
        ? { reply_markup: markup }
        : {})
    }
  );
}


/* =========================================================
   BOT POLLING
========================================================= */

async function startBot() {

  if (!BOT_TOKEN) {

    console.log(
      "BOT_TOKEN missing. Telegram bot skipped."
    );

    return;
  }

  try {

    const me = await tg("getMe");

    console.log(
      `Telegram bot connected: @${me.username || "unknown"}`
    );

    await tg(
      "deleteWebhook",
      {
        drop_pending_updates: false
      }
    );

    await setupMenu();

    let offset = 0;

    async function poll() {

      try {

        const updates = await tg(
          "getUpdates",
          {
            offset,
            timeout: 25,
            allowed_updates: ["message"]
          }
        );

        for (const u of updates) {

          offset = u.update_id + 1;

          const m = u.message;

          if (!m?.chat || !m.from) {
            continue;
          }

          const text =
            String(m.text || "").trim();

          const match =
            text.match(
              /^\/start(?:@\w+)?(?:\s+(.+))?$/i
            );

          if (match) {

            await botStart(
              m.chat.id,
              m.from,
              match[1] || ""
            );

          } else if (
            /^\/help(?:@\w+)?$/i.test(text)
          ) {

            await tg(
              "sendMessage",
              {
                chat_id: m.chat.id,
                text:
`🐝 ST Earn Help

/start — Open ST Earn
/help — Show help`
              }
            );
          }
        }

      } catch (e) {

        console.error(
          "Telegram polling error:",
          e.message
        );

        await new Promise(
          r => setTimeout(r, 3000)
        );
      }

      setImmediate(poll);
    }

    poll();

    console.log(
      "Telegram bot polling started."
    );

  } catch (e) {

    console.error(
      "Telegram bot startup failed:",
      e.message
    );
  }
}


/* =========================================================
   FRONTEND
========================================================= */

app.use(
  express.static(
    path.join(__dirname, "public")
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

    await startBot();

    console.log(
      "ST Earn startup completed."
    );

  } catch (e) {

    console.error(
      "Server startup failed:",
      e
    );

    process.exit(1);
  }
}

start();
