# Script Trigger Ulang Build (Tanpa Perubahan Kode)
# Gunakan ini SETELAH Anda memperbaiki GitHub Secrets

Write-Host "Memicu ulang build dengan tag v4.4.5..." -ForegroundColor Cyan

# Hapus tag lokal dan remote, lalu buat ulang
git tag -d v4.4.5 2>$null
git push origin :refs/tags/v4.4.5 2>$null
git tag v4.4.5
git push origin v4.4.5 --force

Write-Host "Build telah dipicu ulang. Silakan cek GitHub Actions." -ForegroundColor Green
