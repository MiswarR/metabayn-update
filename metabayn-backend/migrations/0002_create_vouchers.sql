-- Create Vouchers Table
CREATE TABLE IF NOT EXISTS vouchers (
    code TEXT PRIMARY KEY,
    amount INTEGER NOT NULL,
    max_usage INTEGER DEFAULT 0, -- 0 means unlimited
    current_usage INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Create Voucher Claims Table (to track who claimed what)
CREATE TABLE IF NOT EXISTS voucher_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    voucher_code TEXT NOT NULL,
    device_hash TEXT, -- Optional: Track device ID
    claimed_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(voucher_code) REFERENCES vouchers(code)
);

-- Add device_hash to users if not exists (sqlite doesn't support IF NOT EXISTS for column)
-- So we assume it might fail if exists, or handled manually.
-- ALTER TABLE users ADD COLUMN device_hash TEXT;
