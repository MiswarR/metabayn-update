# Script untuk beralih ke strategi "Download on Build" dan membersihkan LFS
# Ini akan memperbaiki masalah upload file besar dan kuota LFS

Write-Host "Mulai perbaikan final strategi build..."

# 1. Uninstall LFS (agar tidak mencoba upload file besar lagi)
git lfs uninstall 2>$null

# 2. Hapus tracking file binary dari Git (Hanya dari index, file asli tetap ada di folder)
# Kita gunakan --cached agar file di disk komputer Anda TIDAK terhapus
git rm --cached "src-tauri/resources/ffmpeg.exe" -f 2>$null
git rm --cached "src-tauri/resources/exiftool.exe" -f 2>$null

# 3. Update .gitignore agar file binary tidak pernah di-upload lagi
$gitignorePath = ".gitignore"
if (-not (Select-String -Path $gitignorePath -Pattern "src-tauri/resources/\*.exe")) {
    Add-Content -Path $gitignorePath -Value "`nsrc-tauri/resources/*.exe"
}
if (-not (Select-String -Path $gitignorePath -Pattern "src-tauri/resources/ffmpeg")) {
    Add-Content -Path $gitignorePath -Value "`nsrc-tauri/resources/ffmpeg"
}
if (-not (Select-String -Path $gitignorePath -Pattern "src-tauri/resources/exiftool")) {
    Add-Content -Path $gitignorePath -Value "`nsrc-tauri/resources/exiftool"
}

# 4. Commit perubahan
git add .
git commit -m "Switch to download-on-build strategy to fix LFS issues"

# 5. Push ke Main (Force push untuk memastikan history bersih)
Write-Host "Mengirim update ke GitHub..."
git push origin main --force

# 6. Reset Tag untuk memicu build ulang
Write-Host "Memicu ulang proses build..."
git tag -d v4.4.5 2>$null
git push origin :refs/tags/v4.4.5 2>$null
git tag v4.4.5
git push origin v4.4.5 --force

Write-Host "Selesai! Silakan cek GitHub Actions lagi."
