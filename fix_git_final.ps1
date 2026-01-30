# Skrip Perbaikan Total Git LFS
# Menghapus history lama yang rusak dan memulai dari awal yang bersih

Write-Host "Mulai proses reset total Git..." -ForegroundColor Magenta

# 1. Hapus folder .git lama (Hati-hati, ini menghapus history lokal!)
if (Test-Path ".git") {
    Write-Host "Menghapus repository Git lama yang bermasalah..." -ForegroundColor Yellow
    Remove-Item ".git" -Recurse -Force -ErrorAction SilentlyContinue
}

# 2. Inisialisasi ulang
Write-Host "Inisialisasi Git baru..." -ForegroundColor Green
git init
git branch -M main

# 3. Konfigurasi User (Penting agar tidak error)
git config user.email "miswar@example.com"
git config user.name "Miswar"

# 4. Setup LFS DULUAN sebelum add file apapun
Write-Host "Mengaktifkan Git LFS..." -ForegroundColor Green
git lfs install
git lfs track "src-tauri/resources/ffmpeg.exe"
# Pastikan .gitattributes ada dan benar
if (-not (Test-Path ".gitattributes")) {
    Set-Content -Path ".gitattributes" -Value "src-tauri/resources/ffmpeg.exe filter=lfs diff=lfs merge=lfs -text"
}

# 5. Add file secara bertahap
Write-Host "Menambahkan file ke staging..." -ForegroundColor Green
# Tambahkan .gitattributes dulu
git add .gitattributes
# Tambahkan sisanya
git add .

# 6. Commit Perdana
Write-Host "Membuat Commit Perdana..." -ForegroundColor Green
git commit -m "Initial commit: v4.4.5 with Auto-Update & LFS support"

# 7. Setup Remote
git remote add origin https://github.com/MiswarR/metabayn-update.git

# 8. Push Force (Menimpa yang ada di GitHub)
Write-Host "Mengirim ke GitHub (Ini mungkin butuh waktu untuk upload file besar)..." -ForegroundColor Green
git push -u origin main --force

# 9. Tagging
Write-Host "Membuat Tag v4.4.5..." -ForegroundColor Green
git tag v4.4.5
git push origin v4.4.5 --force

Write-Host "Selesai! Cek GitHub sekarang." -ForegroundColor Green
