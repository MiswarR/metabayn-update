-- Tabel User
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL, -- Format: salt:hash
    tokens REAL DEFAULT 0,  -- Saldo Token
    is_admin INTEGER DEFAULT 0, -- 1 = Admin, 0 = User
    device_hash TEXT,       -- Anti-Cloning Lock
    status TEXT DEFAULT 'active', -- active / pending
    subscription_active INTEGER DEFAULT 0, -- 1 = Active, 0 = Inactive
    subscription_expiry TEXT, -- ISO Date String
    confirmation_token TEXT,
    confirmation_expires_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
);

-- Tabel History Transaksi AI
CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost REAL,
    timestamp INTEGER DEFAULT (unixepoch()),
    actual_model_used TEXT, -- Untuk tracking fallback
    FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Tabel Config (Untuk Dynamic Pricing tanpa redeploy)
CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Tabel Harga Model Dinamis
CREATE TABLE IF NOT EXISTS model_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,             -- "openai" atau "gemini"
  model_name TEXT NOT NULL UNIQUE,    -- misal: "gpt-4o-mini"
  input_price REAL NOT NULL,          -- harga per 1 JUTA token input (biasanya) atau per 1 token (tergantung satuan user)
  output_price REAL NOT NULL,         -- harga per 1 JUTA token output (biasanya) atau per 1 token
  profit_multiplier REAL NOT NULL DEFAULT 1.5,
  active INTEGER NOT NULL DEFAULT 1,  -- 1 = aktif, 0 = nonaktif
  fallback_priority INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Seed Config Awal
INSERT OR IGNORE INTO app_config (key, value) VALUES ('profit_multiplier', '1.5');

-- Seed Model Prices (Default from models.ts)
INSERT OR IGNORE INTO model_prices (provider, model_name, input_price, output_price, active) VALUES 
('openai', 'gpt-4o', 5.00, 15.00, 1),
('openai', 'gpt-4o-mini', 0.80, 3.20, 1),
('openai', 'gpt-4.1', 3.00, 12.00, 1),
('openai', 'gpt-4.1-mini', 0.80, 3.20, 1),
('openai', 'gpt-4.1-distilled', 0.80, 3.20, 1),
('openai', 'gpt-5.1', 1.25, 10.00, 1),
('openai', 'gpt-5.1-mini', 0.25, 2.00, 1),
('openai', 'gpt-5.1-instant', 0.05, 0.40, 1),
('gemini', 'gemini-2.5-pro', 0.50, 1.50, 1),
('gemini', 'gemini-2.5-flash', 0.05, 0.15, 1),
('gemini', 'gemini-2.0-pro', 0.30, 1.00, 1),
('gemini', 'gemini-2.0-flash', 0.05, 0.10, 1),
('gemini', 'gemini-2.0-flash-lite', 0.02, 0.05, 1),
('gemini', 'gemini-flash', 0.05, 0.10, 1),
('gemini', 'gemini-pro', 0.20, 1.00, 1),
('gemini', 'gemini-1.5-pro', 0.20, 1.00, 1),
('gemini', 'gemini-1.5-flash', 0.05, 0.10, 1),
('gemini', 'gemini-1.5-flash-lite', 0.02, 0.04, 1);

-- Tabel Transaksi Top-up
CREATE TABLE IF NOT EXISTS topup_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    amount_rp INTEGER,             -- Nominal IDR (Nullable jika USD)
    amount_usd REAL,               -- Nominal USD (Nullable jika IDR)
    tokens_added INTEGER NOT NULL,
    method TEXT NOT NULL,          -- paypal / qris
    status TEXT NOT NULL,          -- pending / paid / failed
    payment_ref TEXT,              -- ID transaksi dari payment gateway
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Tabel Admin Logs
CREATE TABLE IF NOT EXISTS admin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Tabel Rate Limits (Untuk Register/Login)
CREATE TABLE IF NOT EXISTS rate_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    action TEXT NOT NULL,
    timestamp INTEGER NOT NULL
);

-- Tabel Auth Logs (Login/Register History)
CREATE TABLE IF NOT EXISTS auth_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    email TEXT NOT NULL,
    action TEXT NOT NULL,
    ip_address TEXT,
    device_hash TEXT,
    timestamp INTEGER DEFAULT (unixepoch())
);

-- Tabel Email Logs
CREATE TABLE IF NOT EXISTS email_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL, -- 'sent', 'failed'
    error TEXT,
    timestamp INTEGER NOT NULL
);

-- Seed Config Tambahan (Rate & Bonus)
-- Disimpan sebagai JSON string untuk table bonus
INSERT OR IGNORE INTO app_config (key, value) VALUES 
('TOKEN_RATE_IDR', '1000'), -- Rp 1.000 = 1 Token
('TOKEN_RATE_USD', '16'),      -- $1 = 16 Token (Asumsi kurs 16.000, jadi $1 ~ Rp 16.000 ~ 16 Token)
('BONUS_IDR_TABLE', '{"100000":3,"200000":5,"500000":10}'),
('BONUS_USD_TABLE', '{"10":3,"20":5,"50":10}');
