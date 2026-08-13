-- =========================================
-- ST EARN DATABASE SCHEMA
-- =========================================

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
);


-- =========================================
-- APP SETTINGS
-- =========================================

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);


-- =========================================
-- TASKS
-- =========================================

CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,

    title TEXT NOT NULL,

    description TEXT DEFAULT '',

    url TEXT DEFAULT '',

    reward NUMERIC(18,8) DEFAULT 0,

    task_type TEXT DEFAULT 'custom',

    active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- =========================================
-- TASK COMPLETIONS
-- =========================================

CREATE TABLE IF NOT EXISTS task_completions (
    id SERIAL PRIMARY KEY,

    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    task_id INTEGER NOT NULL
        REFERENCES tasks(id)
        ON DELETE CASCADE,

    reward NUMERIC(18,8) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, task_id)
);


-- =========================================
-- WITHDRAWALS
-- =========================================

CREATE TABLE IF NOT EXISTS withdrawals (
    id SERIAL PRIMARY KEY,

    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    amount NUMERIC(18,8) NOT NULL,

    network TEXT DEFAULT '',

    address TEXT DEFAULT '',

    status TEXT DEFAULT 'pending',

    created_at TIMESTAMPTZ DEFAULT NOW(),

    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- =========================================
-- INDEXES
-- =========================================

CREATE INDEX IF NOT EXISTS idx_users_telegram_id
ON users(telegram_id);

CREATE INDEX IF NOT EXISTS idx_users_referred_by
ON users(referred_by);

CREATE INDEX IF NOT EXISTS idx_tasks_active
ON tasks(active);

CREATE INDEX IF NOT EXISTS idx_task_completions_user
ON task_completions(user_id);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user
ON withdrawals(user_id);

CREATE INDEX IF NOT EXISTS idx_withdrawals_status
ON withdrawals(status);


-- =========================================
-- DEFAULT SETTINGS
-- =========================================

INSERT INTO settings(key, value)
VALUES
    ('app_name', 'ST Earn'),
    ('logo_url', ''),
    ('global_theme', 'gold'),
    ('allow_user_theme', 'false'),
    ('referral_reward', '0.20'),
    ('minimum_withdraw', '1'),
    ('withdraw_fee', '0'),
    ('announcement', 'Welcome to ST Earn!'),
    ('maintenance', 'false'),
    ('telegram_channel', '')
ON CONFLICT(key) DO NOTHING;
