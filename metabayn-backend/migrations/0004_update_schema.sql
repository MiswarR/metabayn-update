-- Add missing columns to vouchers table
ALTER TABLE vouchers ADD COLUMN expires_at TEXT;
ALTER TABLE vouchers ADD COLUMN allowed_emails TEXT;

-- Ensure app_config exists (for settings)
CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT
);
