-- Add confirmation columns
ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';
ALTER TABLE users ADD COLUMN confirmation_token TEXT;
ALTER TABLE users ADD COLUMN confirmation_expires_at INTEGER;
