# Skrip Perbaikan Final: Hapus Secrets dari Git Index
# Masalah: File backup secrets ikut ter-commit.

Write-Host "Membersihkan Git Index dari file rahasia..." -ForegroundColor Cyan

# 1. Hapus file rahasia dari Git Index (Tapi biarkan di disk)
git rm --cached "metabayn-backend/wrangler.toml.backup_secrets" -f 2>$null
git rm --cached "metabayn-backend/.dev.vars" -f 2>$null

# 2. Pastikan .gitignore memblokir mereka
$gitignore = ".gitignore"
if (-not (Select-String -Path $gitignore -Pattern "wrangler.toml.backup_secrets")) {
    Add-Content $gitignore "`n*.backup_secrets"
}

# 3. Amend Commit (Perbarui commit terakhir agar bersih)
Write-Host "Memperbarui commit..." -ForegroundColor Green
git add .gitignore
git commit --amend --no-edit

# 4. Push Force
Write-Host "Push ke GitHub..." -ForegroundColor Cyan
git push -u origin main --force
git tag -d v4.4.5 2>$null
git push origin :refs/tags/v4.4.5 2>$null
git tag v4.4.5
git push origin v4.4.5 --force

Write-Host "Selesai. Cek error jika ada." -ForegroundColor Green
