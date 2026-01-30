# Skrip Fix Build (Trigger Ulang)

Write-Host "Mengirim perbaikan workflow..." -ForegroundColor Cyan

# 1. Update file
git add .github/workflows/release.yml
git commit -m "Fix workflow: Enable LFS checkout for binaries"

# 2. Push dan Trigger Ulang Tag
git push origin main
git tag -d v4.4.5 2>$null
git push origin :refs/tags/v4.4.5 2>$null
git tag v4.4.5
git push origin v4.4.5 --force

Write-Host "Perbaikan terkirim. Cek GitHub Actions." -ForegroundColor Green
