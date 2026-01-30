# Skrip Otomatis Setup Git dan Push ke GitHub
# Dibuat oleh Trae AI untuk mengatasi masalah lock file

Write-Host "Mulai proses setup Git..." -ForegroundColor Green

# 1. Hapus lock file yang membandel jika ada
if (Test-Path ".git\index.lock") {
    Write-Host "Menghapus lock file yang tersangkut..." -ForegroundColor Yellow
    Remove-Item ".git\index.lock" -Force -ErrorAction SilentlyContinue
}

# 2. Inisialisasi ulang
git init
git branch -M main

# 3. Setup Remote (Hapus lama, tambah baru)
git remote remove origin 2>$null
git remote add origin https://github.com/MiswarR/metabayn-update.git

# 4. Tambahkan semua file (Add)
Write-Host "Menambahkan file ke staging..." -ForegroundColor Green
git add .

# 5. Commit
Write-Host "Membuat commit..." -ForegroundColor Green
git commit -m "Setup ulang: Update v4.4.5 dengan fitur auto-update"

# 6. Push Main Branch
Write-Host "Mengirim kode ke GitHub (Push)..." -ForegroundColor Green
git push -u origin main --force

# 7. Tagging untuk Trigger Build
Write-Host "Membuat Tag v4.4.5 untuk trigger build..." -ForegroundColor Green
git tag -d v4.4.5 2>$null
git tag v4.4.5
git push origin v4.4.5

Write-Host "Selesai! Cek GitHub Actions Anda." -ForegroundColor Green
