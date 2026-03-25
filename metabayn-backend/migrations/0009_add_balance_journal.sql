CREATE TABLE IF NOT EXISTS balance_transactions (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT UNIQUE,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    amount_tenths INTEGER NOT NULL,
    balance_before_tenths INTEGER,
    balance_after_tenths INTEGER,
    status TEXT NOT NULL,
    error TEXT,
    meta TEXT,
    created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_balance_transactions_user_ts ON balance_transactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_balance_transactions_status_ts ON balance_transactions(status, created_at);

CREATE TABLE IF NOT EXISTS balance_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_id TEXT NOT NULL,
    account_type TEXT NOT NULL,
    account_id TEXT,
    delta_tenths INTEGER NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_balance_entries_tx ON balance_entries(tx_id);
