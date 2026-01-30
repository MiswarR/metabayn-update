# Skrip Setup Git Final (Setelah Cleanup)
# Pastikan disk space sudah lega sebelum menjalankan ini

Write-Host "Memulai Setup Git Fresh..." -ForegroundColor Cyan

# 1. Bersihkan sisa-sisa .git jika ada
if (Test-Path ".git") {
    $trash = ".git_trash_" + (Get-Date -Format "yyyyMMddHHmmss")
    Rename-Item ".git" $trash -ErrorAction SilentlyContinue
    Remove-Item $trash -Recurse -Force -ErrorAction SilentlyContinue
}

# 2. Inisialisasi
git init
git branch -M main
git config user.email "miswar@example.com"
git config user.name "Miswar"

# 3. Setup LFS
Write-Host "Setup Git LFS..." -ForegroundColor Green
git lfs install
git lfs track "*.exe"
git lfs track "*.dll"
git lfs track "src-tauri/resources/ffmpeg.exe"

# 4. Pastikan .gitignore benar
if (-not (Select-String -Path .gitignore -Pattern "src-tauri/target")) {
    Add-Content .gitignore "`nsrc-tauri/target"
}
if (-not (Select-String -Path .gitignore -Pattern ".git_garbage")) {
    Add-Content .gitignore "`n.git_garbage_*"
}

# 5. Add Files
Write-Host "Menambahkan file..." -ForegroundColor Green
git add .

# 6. Commit
Write-Host "Membuat Commit..." -ForegroundColor Green
git commit -m "Initial commit: v4.4.5 with Auto-Update (Cleaned)"

# 7. Cek Ukuran Repo
$gitSize = (Get-ChildItem .git -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host "Ukuran Repo: $gitSize MB" -ForegroundColor Cyan

if ($gitSize -lt 200) {
    Write-Host "Ukuran aman. Mengirim ke GitHub..." -ForegroundColor Green
    git remote add origin https://github.com/MiswarR/metabayn-update.git
    git push -u origin main --force
    git tag v4.4.5
    git push origin v4.4.5 --force
} else {
    Write-Host "WARNING: Repo masih besar. Cek file apa yang masuk." -ForegroundColor Red
}
