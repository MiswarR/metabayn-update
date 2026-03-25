CREATE TABLE IF NOT EXISTS lynk_purchases (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT UNIQUE,
    provider TEXT NOT NULL,
    product_ref TEXT,
    email TEXT NOT NULL,
    payment_status TEXT,
    purchase_ts INTEGER,
    status TEXT NOT NULL,
    user_id TEXT,
    activated_at INTEGER,
    activation_started_at INTEGER,
    raw_payload TEXT,
    signature_status INTEGER,
    email_status TEXT,
    email_last_error TEXT,
    failure_count INTEGER DEFAULT 0,
    next_retry_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_lynk_purchases_email_status ON lynk_purchases(email, status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_lynk_purchases_status_retry ON lynk_purchases(status, next_retry_at, deleted_at);

CREATE TABLE IF NOT EXISTS user_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    purchase_id TEXT UNIQUE,
    start_at INTEGER NOT NULL,
    end_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS bonus_token_grants (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    purchase_id TEXT UNIQUE,
    amount_tenths INTEGER NOT NULL,
    remaining_tenths INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_bonus_grants_user_exp ON bonus_token_grants(user_id, expires_at, deleted_at);

CREATE TABLE IF NOT EXISTS lynk_webhook_logs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    idempotency_key TEXT,
    purchase_id TEXT,
    received_at INTEGER NOT NULL,
    ip TEXT,
    headers TEXT,
    body TEXT,
    auth_ok INTEGER,
    signature_status INTEGER,
    status_code INTEGER,
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_lynk_webhook_logs_received ON lynk_webhook_logs(received_at);

CREATE TABLE IF NOT EXISTS webhook_rate_limits (
    key TEXT PRIMARY KEY,
    minute_bucket INTEGER NOT NULL,
    count INTEGER NOT NULL
);

