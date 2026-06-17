# Changelog
All notable changes to this project will be documented in this file.

## [5.3.2] - 2025-06-16
- Fix AI Cluster log visualization (handle FutureWarning and stderr status).
- Strengthen AI metadata generation: strict single-word keywords rule and disabled file-stem keyword fallback.
- Clean up unused PowerShell scripts and temporary files.
- Improved version management and repository cleanup.

## [5.3.1]
- Fix Lynk.id first-purchase email not sent by ensuring voucher emails are queued and retried reliably.
- Fix Dashboard token balance visibility and null-safe token deduction handling.
- Add compatibility for `/api/v1/wallet/token-balance` and `remaining_balance` field in balance responses.
