# Changelog
All notable changes to this project will be documented in this file.

## Unreleased
- Fix Lynk.id first-purchase email not sent by ensuring voucher emails are queued and retried reliably.
- Fix Dashboard token balance visibility and null-safe token deduction handling.
- Add compatibility for `/api/v1/wallet/token-balance` and `remaining_balance` field in balance responses.
