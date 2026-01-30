# Skrip Fix Pubkey dan Trigger Ulang

Write-Host "Mengirim perbaikan pubkey..." -ForegroundColor Cyan

# 1. Update file
git add src-tauri/tauri.conf.json
git commit -m "Fix tauri.conf.json: Use decoded public key string"

# 2. Push dan Trigger Ulang Tag
git push origin main
git tag -d v4.4.5 2>$null
git push origin :refs/tags/v4.4.5 2>$null
git tag v4.4.5
git push origin v4.4.5 --force

Write-Host "Perbaikan terkirim. Cek GitHub Actions." -ForegroundColor Green
