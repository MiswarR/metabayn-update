-- Add type and duration columns to vouchers table
ALTER TABLE vouchers ADD COLUMN type TEXT DEFAULT 'token'; -- 'token' or 'subscription'
ALTER TABLE vouchers ADD COLUMN duration_days INTEGER DEFAULT 0;
