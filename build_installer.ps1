$keyContent = Get-Content -Path "final.key" -Raw
$env:TAURI_PRIVATE_KEY=$keyContent.Trim()
$env:TAURI_KEY_PASSWORD=""

Write-Host "Membersihkan file installer lama agar bersih..."
if (Test-Path "src-tauri\target\release\bundle") {
    Remove-Item -Path "src-tauri\target\release\bundle" -Recurse -Force
    Write-Host "Folder output lama berhasil dihapus."
}

Write-Host "Mulai proses build Installer Metabayn Studio..."
Write-Host "Mohon tunggu, proses ini memakan waktu beberapa menit..."

npm run tauri build

Write-Host "Selesai! Cek folder target/release/bundle/msi"
Pause
