const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

const ADMIN_ID = String(
  process.env.ADMIN_TELEGRAM_ID || ""
).trim();

const ADMIN_SECRET = String(
  process.env.ADMIN_SECRET || ""
).trim();

const BOT_TOKEN = String(
  process.env.BOT_TOKEN || ""
).trim();

const WEBAPP_URL = String(
  process.env.WEBAPP_URL || ""
).trim();

const BOT_USERNAME = String(
  process.env.BOT_USERNAME || ""
).trim();

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
  }
};

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

function db() {
  return pool;
}

async function query(text, params = []) {
  return db().query(text, params);
}

/* =========================
   DATABASE
========================= */

async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
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

  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS tasks (
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

  await query(`
    CREATE TABLE IF NOT EXISTS task_completions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      reward NUMERIC(18,8) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, task_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(18,8) NOT NULL,
      network TEXT DEFAULT '',
      address TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await query(
      `
      INSERT INTO settings(key, value)
      VALUES($1, $2)
      ON CONFLICT(key) DO NOTHING
      `,
      [key, String(value)]
    );
  }
}

async function getSettings() {
  const result = await query(
    "SELECT key, value FROM settings"
  );

  const settings = {
    ...DEFAULT_SETTINGS
  };

  for (const row of result.rows) {
    settings[row.key] = row.value;
  }

  settings.allow_user_theme =
    String(settings.allow_user_theme) === "true";

  settings.maintenance =
    String(settings.maintenance) === "true";

  settings.referral_reward =
    Number(settings.referral_reward || 0);

  settings.minimum_withdraw =
    Number(settings.minimum_withdraw || 0);

  settings.withdraw_fee =
    Number(settings.withdraw_fee || 0);

  return settings;
}

async function setSettings(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in DEFAULT_SETTINGS)) continue;

    await query(
      `
      INSERT INTO settings(key, value)
      VALUES($1, $2)
      ON CONFLICT(key)
      DO UPDATE SET value = EXCLUDED.value
      `,
      [key, String(value)]
    );
  }
}

/* =========================
   TELEGRAM AUTH
========================= */

function verifyTelegramInitData(initData) {
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
    calculatedHash.length !== hash.length ||
    !crypto.timingSafeEqual(
      Buffer.from(calculatedHash),
      Buffer.from(hash)
    )
  ) {
    return null;
  }

  const authDate = Number(
    params.get("auth_date") || 0
  );

  if (!authDate) return null;

  if (Date.now() / 1000 - authDate > 86400) {
    return null;
  }

  try {
    return JSON.parse(
      params.get("user") || "{}"
    );
  } catch {
    return null;
  }
}

/* =========================
   USER
========================= */

async function getOrCreateUser(
  tgUser,
  startParam = ""
) {
  const telegramId = String(tgUser.id);

  let result = await query(
    "SELECT * FROM users WHERE telegram_id=$1",
    [telegramId]
  );

  /* Existing user */
  if (result.rows.length) {
    await query(
      `
      UPDATE users
      SET username=$1,
          first_name=$2,
          last_name=$3,
          updated_at=NOW()
      WHERE telegram_id=$4
      `,
      [
        tgUser.username || "",
        tgUser.first_name || "",
        tgUser.last_name || "",
        telegramId
      ]
    );

    result = await query(
      "SELECT * FROM users WHERE telegram_id=$1",
      [telegramId]
    );

    return result.rows[0];
  }

  /* Find referrer */
  let referredBy = "";

  if (startParam) {
    const match = String(startParam).match(
      /^ref_(\d+)$/
    );

    if (
      match &&
      match[1] &&
      match[1] !== telegramId
    ) {
      const referrer = await query(
        `
        SELECT telegram_id
        FROM users
        WHERE telegram_id=$1
        `,
        [match[1]]
      );

      if (referrer.rows.length) {
        referredBy = match[1];
      }
    }
  }

  /* Create user */
  const inserted = await query(
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
      telegramId,
      tgUser.username || "",
      tgUser.first_name || "",
      tgUser.last_name || "",
      referredBy
    ]
  );

  const newUser = inserted.rows[0];

  /* Give referral reward */
  if (referredBy) {
    const settings = await getSettings();

    const reward = Number(
      settings.referral_reward || 0
    );

    if (reward > 0) {
      await query(
        `
        UPDATE users
        SET referrals=referrals+1,
            balance=balance+$1,
            total_earned=total_earned+$1,
            updated_at=NOW()
        WHERE telegram_id=$2
        `,
        [
          reward,
          referredBy
        ]
      );
    } else {
      await query(
        `
        UPDATE users
        SET referrals=referrals+1,
            updated_at=NOW()
        WHERE telegram_id=$1
        `,
        [referredBy]
      );
    }
  }

  return newUser;
}

/* =========================
   AUTH MIDDLEWARE
========================= */

async function authMiddleware(
  req,
  res,
  next
) {
  const initData =
    req.headers["x-telegram-init-data"] ||
    req.body?.initData ||
    "";

  const tgUser =
    verifyTelegramInitData(initData);

  if (!tgUser) {
    return res.status(401).json({
      error:
        "Telegram authentication required."
    });
  }

  try {
    const params =
      new URLSearchParams(initData);

    const startParam =
      params.get("start_param") || "";

    const user =
      await getOrCreateUser(
        tgUser,
        startParam
      );

    if (user.blocked) {
      return res.status(403).json({
        error:
          "Your account is blocked."
      });
    }

    req.tgUser = tgUser;
    req.user = user;

    next();
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error:
        "Authentication failed."
    });
  }
}

/* =========================
   ADMIN AUTH
========================= */

async function adminMiddleware(
  req,
  res,
  next
) {
  if (ADMIN_SECRET) {
    const secret =
      req.headers["x-admin-secret"] ||
      req.body?.adminSecret ||
      "";

    if (secret === ADMIN_SECRET) {
      return next();
    }
  }

  const initData =
    req.headers["x-telegram-init-data"] ||
    req.body?.initData ||
    "";

  const tgUser =
    verifyTelegramInitData(initData);

  if (
    !tgUser ||
    !ADMIN_ID ||
    String(tgUser.id) !== ADMIN_ID
  ) {
    return res.status(403).json({
      error:
        "Admin access required."
    });
  }

  next();
}

/* =========================
   THEME
========================= */

function themeData(
  settings,
  user
) {
  let themeName =
    settings.global_theme || "gold";

  if (
    settings.allow_user_theme &&
    user &&
    user.theme &&
    THEMES[user.theme]
  ) {
    themeName = user.theme;
  }

  return {
    key: themeName,
    ...THEMES[themeName]
  };
}

/* =========================
   HEALTH
========================= */

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,
      service: "ST Earn",
      time:
        new Date().toISOString()
    });
  }
);

/* =========================
   CONFIG
========================= */

app.get(
  "/api/config",
  async (req, res) => {
    try {
      const settings =
        await getSettings();

      res.json({
        appName:
          settings.app_name,

        logoUrl:
          settings.logo_url,

        announcement:
          settings.announcement,

        telegramChannel:
          settings.telegram_channel,

        botUsername:
          BOT_USERNAME,

        maintenance:
          settings.maintenance,

        allowUserTheme:
          settings.allow_user_theme,

        themes:
          THEMES
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Unable to load configuration."
      });
    }
  }
);

/* =========================
   CURRENT USER
========================= */

app.get(
  "/api/me",
  authMiddleware,
  async (req, res) => {
    const settings =
      await getSettings();

    const fresh =
      await query(
        "SELECT * FROM users WHERE id=$1",
        [req.user.id]
      );

    const user =
      fresh.rows[0];

    const isAdmin =
      ADMIN_ID &&
      String(user.telegram_id) ===
        ADMIN_ID;

    res.json({
      isAdmin:
        Boolean(isAdmin),

      user: {
        id: user.id,

        telegramId:
          user.telegram_id,

        username:
          user.username,

        firstName:
          user.first_name,

        lastName:
          user.last_name,

        balance:
          Number(user.balance),

        totalEarned:
          Number(user.total_earned),

        tasksDone:
          user.tasks_done,

        referrals:
          user.referrals,

        blocked:
          user.blocked,

        theme:
          user.theme || ""
      },

      themeData:
        themeData(
          settings,
          user
        )
    });
  }
);

/* =========================
   TASKS
========================= */

app.get(
  "/api/tasks",
  authMiddleware,
  async (req, res) => {
    const result =
      await query(
        `
        SELECT
          t.*,
          CASE
            WHEN tc.id IS NULL
            THEN FALSE
            ELSE TRUE
          END AS completed
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
      tasks:
        result.rows.map(
          t => ({
            id: t.id,
            title: t.title,
            description:
              t.description,
            url: t.url,
            reward:
              Number(t.reward),
            taskType:
              t.task_type,
            completed:
              t.completed
          })
        )
    });
  }
);

/* =========================
   COMPLETE TASK
========================= */

app.post(
  "/api/tasks/:id/complete",
  authMiddleware,
  async (req, res) => {
    const taskId =
      Number(req.params.id);

    if (!Number.isInteger(taskId)) {
      return res.status(400).json({
        error:
          "Invalid task ID."
      });
    }

    const client =
      await pool.connect();

    try {
      await client.query(
        "BEGIN"
      );

      const taskResult =
        await client.query(
          `
          SELECT *
          FROM tasks
          WHERE id=$1
          AND active=TRUE
          `,
          [taskId]
        );

      if (!taskResult.rows.length) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          error:
            "Task not found."
        });
      }

      const task =
        taskResult.rows[0];

      const existing =
        await client.query(
          `
          SELECT id
          FROM task_completions
          WHERE user_id=$1
          AND task_id=$2
          `,
          [
            req.user.id,
            taskId
          ]
        );

      if (existing.rows.length) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(409).json({
          error:
            "Task already completed."
        });
      }

      const reward =
        Number(task.reward);

      await client.query(
        `
        INSERT INTO task_completions(
          user_id,
          task_id,
          reward
        )
        VALUES($1,$2,$3)
        `,
        [
          req.user.id,
          taskId,
          reward
        ]
      );

      await client.query(
        `
        UPDATE users
        SET balance=balance+$1,
            total_earned=total_earned+$1,
            tasks_done=tasks_done+1,
            updated_at=NOW()
        WHERE id=$2
        `,
        [
          reward,
          req.user.id
        ]
      );

      await client.query(
        "COMMIT"
      );

      res.json({
        success: true,
        reward
      });

    } catch (error) {
      await client.query(
        "ROLLBACK"
      );

      console.error(error);

      res.status(500).json({
        error:
          "Could not complete task."
      });

    } finally {
      client.release();
    }
  }
);

/* =========================
   USER THEME
========================= */

app.post(
  "/api/theme",
  authMiddleware,
  async (req, res) => {
    const settings =
      await getSettings();

    if (!settings.allow_user_theme) {
      return res.status(403).json({
        error:
          "User theme changing is disabled."
      });
    }

    const theme =
      String(req.body.theme || "");

    if (!THEMES[theme]) {
      return res.status(400).json({
        error:
          "Invalid theme."
      });
    }

    await query(
      `
      UPDATE users
      SET theme=$1,
          updated_at=NOW()
      WHERE id=$2
      `,
      [
        theme,
        req.user.id
      ]
    );

    res.json({
      success: true,
      theme
    });
  }
);

/* =========================
   REFERRALS
========================= */

app.get(
  "/api/referrals",
  authMiddleware,
  async (req, res) => {
    const result =
      await query(
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

    res.json({
      referrals:
        result.rows
    });
  }
);

/* =========================
   WITHDRAWAL
========================= */

app.post(
  "/api/withdrawals",
  authMiddleware,
  async (req, res) => {
    const settings =
      await getSettings();

    const amount =
      Number(
        req.body.amount || 0
      );

    const network =
      String(
        req.body.network || ""
      ).trim();

    const address =
      String(
        req.body.address || ""
      ).trim();

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({
        error:
          "Invalid withdrawal amount."
      });
    }

    if (
      amount <
      settings.minimum_withdraw
    ) {
      return res.status(400).json({
        error:
          `Minimum withdrawal is ${settings.minimum_withdraw} USDT.`
      });
    }

    if (
      !network ||
      !address
    ) {
      return res.status(400).json({
        error:
          "Network and address are required."
      });
    }

    const client =
      await pool.connect();

    try {
      await client.query(
        "BEGIN"
      );

      const userResult =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE id=$1
          FOR UPDATE
          `,
          [req.user.id]
        );

      const user =
        userResult.rows[0];

      if (
        Number(user.balance) <
        amount
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          error:
            "Insufficient balance."
        });
      }

      const fee =
        settings.withdraw_fee;

      const finalAmount =
        Math.max(
          0,
          amount - fee
        );

      await client.query(
        `
        UPDATE users
        SET balance=balance-$1,
            updated_at=NOW()
        WHERE id=$2
        `,
        [
          amount,
          req.user.id
        ]
      );

      const withdrawal =
        await client.query(
          `
          INSERT INTO withdrawals(
            user_id,
            amount,
            network,
            address,
            status
          )
          VALUES(
            $1,
            $2,
            $3,
            $4,
            'pending'
          )
          RETURNING *
          `,
          [
            req.user.id,
            finalAmount,
            network,
            address
          ]
        );

      await client.query(
        "COMMIT"
      );

      res.json({
        success: true,
        withdrawal:
          withdrawal.rows[0]
      });

    } catch (error) {
      await client.query(
        "ROLLBACK"
      );

      console.error(error);

      res.status(500).json({
        error:
          "Withdrawal failed."
      });

    } finally {
      client.release();
    }
  }
);

/* =========================
   USER WITHDRAWALS
========================= */

app.get(
  "/api/withdrawals",
  authMiddleware,
  async (req, res) => {
    const result =
      await query(
        `
        SELECT *
        FROM withdrawals
        WHERE user_id=$1
        ORDER BY id DESC
        `,
        [req.user.id]
      );

    res.json({
      withdrawals:
        result.rows
    });
  }
);

/* =========================
   ADMIN SETTINGS
========================= */

app.get(
  "/api/admin/settings",
  adminMiddleware,
  async (req, res) => {
    const settings =
      await getSettings();

    res.json({
      settings,
      themes:
        THEMES
    });
  }
);

app.put(
  "/api/admin/settings",
  adminMiddleware,
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

    for (
      const key of allowed
    ) {
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
        String(
          values.global_theme
        )
      ]
    ) {
      return res.status(400).json({
        error:
          "Invalid theme."
      });
    }

    await setSettings(
      values
    );

    res.json({
      success: true,
      settings:
        await getSettings()
    });
  }
);

/* =========================
   ADMIN TASKS
========================= */

app.get(
  "/api/admin/tasks",
  adminMiddleware,
  async (req, res) => {
    const result =
      await query(
        "SELECT * FROM tasks ORDER BY id DESC"
      );

    res.json({
      tasks:
        result.rows
    });
  }
);

app.post(
  "/api/admin/tasks",
  adminMiddleware,
  async (req, res) => {
    const title =
      String(
        req.body.title || ""
      ).trim();

    const description =
      String(
        req.body.description || ""
      ).trim();

    const url =
      String(
        req.body.url || ""
      ).trim();

    const reward =
      Number(
        req.body.reward || 0
      );

    const taskType =
      String(
        req.body.task_type ||
        "custom"
      );

    if (!title) {
      return res.status(400).json({
        error:
          "Task title is required."
      });
    }

    if (
      !Number.isFinite(reward) ||
      reward < 0
    ) {
      return res.status(400).json({
        error:
          "Invalid reward."
      });
    }

    const result =
      await query(
        `
        INSERT INTO tasks(
          title,
          description,
          url,
          reward,
          task_type,
          active
        )
        VALUES(
          $1,
          $2,
          $3,
          $4,
          $5,
          TRUE
        )
        RETURNING *
        `,
        [
          title,
          description,
          url,
          reward,
          taskType
        ]
      );

    res.json({
      success: true,
      task:
        result.rows[0]
    });
  }
);

app.delete(
  "/api/admin/tasks/:id",
  adminMiddleware,
  async (req, res) => {
    const taskId =
      Number(req.params.id);

    if (
      !Number.isInteger(taskId)
    ) {
      return res.status(400).json({
        error:
          "Invalid task ID."
      });
    }

    await query(
      "DELETE FROM tasks WHERE id=$1",
      [taskId]
    );

    res.json({
      success: true
    });
  }
);

/* =========================
   ADMIN USERS
========================= */

app.get(
  "/api/admin/users",
  adminMiddleware,
  async (req, res) => {
    const result =
      await query(`
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
      `);

    res.json({
      users:
        result.rows
    });
  }
);

app.put(
  "/api/admin/users/:telegramId",
  adminMiddleware,
  async (req, res) => {
    const telegramId =
      String(
        req.params.telegramId
      );

    const updates = [];
    const values = [];

    if (
      req.body.balance !==
      undefined
    ) {
      const balance =
        Number(
          req.body.balance
        );

      if (
        !Number.isFinite(balance) ||
        balance < 0
      ) {
        return res.status(400).json({
          error:
            "Invalid balance."
        });
      }

      values.push(balance);

      updates.push(
        `balance=$${values.length}`
      );
    }

    if (
      req.body.blocked !==
      undefined
    ) {
      values.push(
        Boolean(
          req.body.blocked
        )
      );

      updates.push(
        `blocked=$${values.length}`
      );
    }

    if (!updates.length) {
      return res.status(400).json({
        error:
          "Nothing to update."
      });
    }

    values.push(
      telegramId
    );

    await query(
      `
      UPDATE users
      SET ${updates.join(", ")},
          updated_at=NOW()
      WHERE telegram_id=$${values.length}
      `,
      values
    );

    res.json({
      success: true
    });
  }
);

/* =========================
   ADMIN WITHDRAWALS
========================= */

app.get(
  "/api/admin/withdrawals",
  adminMiddleware,
  async (req, res) => {
    const result =
      await query(`
        SELECT
          w.*,
          u.telegram_id,
          u.username,
          u.first_name
        FROM withdrawals w
        JOIN users u
          ON u.id=w.user_id
        ORDER BY w.id DESC
      `);

    res.json({
      withdrawals:
        result.rows
    });
  }
);

app.put(
  "/api/admin/withdrawals/:id",
  adminMiddleware,
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

    const client =
      await pool.connect();

    try {
      await client.query(
        "BEGIN"
      );

      const result =
        await client.query(
          `
          SELECT *
          FROM withdrawals
          WHERE id=$1
          FOR UPDATE
          `,
          [id]
        );

      if (!result.rows.length) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          error:
            "Withdrawal not found."
        });
      }

      const withdrawal =
        result.rows[0];

      if (
        withdrawal.status !==
        "pending"
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          error:
            "Withdrawal already processed."
        });
      }

      await client.query(
        `
        UPDATE withdrawals
        SET status=$1,
            updated_at=NOW()
        WHERE id=$2
        `,
        [
          status,
          id
        ]
      );

      if (
        status ===
        "rejected"
      ) {
        await client.query(
          `
          UPDATE users
          SET balance=balance+$1,
              updated_at=NOW()
          WHERE id=$2
          `,
          [
            Number(
              withdrawal.amount
            ),
            withdrawal.user_id
          ]
        );
      }

      await client.query(
        "COMMIT"
      );

      res.json({
        success: true
      });

    } catch (error) {
      await client.query(
        "ROLLBACK"
      );

      console.error(error);

      res.status(500).json({
        error:
          "Unable to update withdrawal."
      });

    } finally {
      client.release();
    }
  }
);

/* =========================
   TELEGRAM MENU BUTTON
========================= */

async function setupTelegramMenuButton() {
  if (
    !BOT_TOKEN ||
    !WEBAPP_URL
  ) {
    console.log(
      "BOT_TOKEN or WEBAPP_URL missing. Telegram menu button skipped."
    );

    return;
  }

  try {
    const response =
      await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            menu_button: {
              type: "web_app",
              text:
                "Open ST Earn",

              web_app: {
                url:
                  WEBAPP_URL
              }
            }
          })
        }
      );

    const data =
      await response.json();

    console.log(
      "Telegram menu button:",
      data.ok
        ? "configured"
        : data.description
    );

  } catch (error) {
    console.error(
      "Telegram menu button error:",
      error.message
    );
  }
}

/* =========================
   STATIC FILES
========================= */

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);

app.get(
  "*",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/* =========================
   START
========================= */

async function start() {
  try {
    await initDatabase();

    app.listen(
      PORT,
      () => {
        console.log(
          `ST Earn running on port ${PORT}`
        );
      }
    );

    await setupTelegramMenuButton();

  } catch (error) {
    console.error(
      "Server startup failed:",
      error
    );

    process.exit(1);
  }
}

start();
