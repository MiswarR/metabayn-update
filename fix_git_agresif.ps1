# Skrip Perbaikan Total Git LFS (Versi Agresif)
# Fokus: Pastikan ffmpeg.exe benar-benar menjadi pointer

Write-Host "Mulai proses reset total Git (Versi Agresif)..." -ForegroundColor Magenta

# 1. Hapus folder .git lama dengan CMD (Lebih kuat)
if (Test-Path ".git") {
    Write-Host "Menghapus repository Git lama..." -ForegroundColor Yellow
    cmd /c "rmdir /s /q .git"
}

# 2. Inisialisasi ulang
Write-Host "Inisialisasi Git baru..." -ForegroundColor Green
git init
git branch -M main

# 3. Konfigurasi User
git config user.email "miswar@example.com"
git config user.name "Miswar"

# 4. Setup LFS dan .gitattributes
Write-Host "Mengaktifkan Git LFS..." -ForegroundColor Green
git lfs install

# TRACK SEMUA EXE (Agar aman)
git lfs track "*.exe"
git lfs track "*.dll"
git lfs track "src-tauri/resources/ffmpeg.exe"

# 5. Add file
Write-Host "Menambahkan file ke staging..." -ForegroundColor Green
git add .

# 6. Commit
Write-Host "Membuat Commit..." -ForegroundColor Green
git commit -m "Initial commit: v4.4.5 with LFS (Agresif)"

# 7. Verifikasi Ukuran .git
$gitSize = (Get-ChildItem .git -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host "Ukuran folder .git saat ini: $gitSize MB" -ForegroundColor Cyan

if ($gitSize -gt 150) {
    Write-Host "BAHAYA: Ukuran .git masih terlalu besar ($gitSize MB). LFS mungkin gagal." -ForegroundColor Red
    Write-Host "Membatalkan Push." -ForegroundColor Red
    exit
} else {
    Write-Host "Ukuran .git aman ($gitSize MB). Melanjutkan Push." -ForegroundColor Green
}

# 8. Setup Remote & Push
git remote add origin https://github.com/MiswarR/metabayn-update.git

Write-Host "Mengirim ke GitHub..." -ForegroundColor Green
git push -u origin main --force

# 9. Tagging
Write-Host "Membuat Tag v4.4.5..." -ForegroundColor Green
git tag v4.4.5
git push origin v4.4.5 --force

Write-Host "Selesai!" -ForegroundColor Green
