CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_activity_log_user_ts ON activity_log(user_id, timestamp);

