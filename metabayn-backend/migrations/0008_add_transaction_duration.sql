-- Add duration_days to topup_transactions for subscription tracking
ALTER TABLE topup_transactions ADD COLUMN duration_days INTEGER DEFAULT 0;
