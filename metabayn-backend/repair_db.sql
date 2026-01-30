-- 1. Add status (Likely exists, commenting out to avoid error)
-- ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';

-- 2. Add confirmation fields (Likely exists, commenting out)
-- ALTER TABLE users ADD COLUMN confirmation_token TEXT;
-- ALTER TABLE users ADD COLUMN confirmation_expires_at INTEGER;

-- 3. Subscription fields EXIST (Skipping)
-- ALTER TABLE users ADD COLUMN subscription_active INTEGER DEFAULT 0;
-- ALTER TABLE users ADD COLUMN subscription_expiry TEXT;

-- 4. Add device_hash EXIST (Skipping)
-- ALTER TABLE users ADD COLUMN device_hash TEXT;

-- 5. Create missing tables
CREATE TABLE IF NOT EXISTS rate_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    action TEXT NOT NULL,
    timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    email TEXT NOT NULL,
    action TEXT NOT NULL,
    ip_address TEXT,
    device_hash TEXT,
    timestamp INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS email_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL, -- 'sent', 'failed'
    error TEXT,
    timestamp INTEGER NOT NULL
);
