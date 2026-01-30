# Skrip Reset Git dengan Rename (Workaround Lock)

Write-Host "Mencoba memindahkan folder .git yang rusak..." -ForegroundColor Magenta

$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$garbageName = ".git_garbage_$timestamp"

try {
    Rename-Item ".git" $garbageName -ErrorAction Stop
    Write-Host "Sukses memindahkan .git ke $garbageName" -ForegroundColor Green
} catch {
    Write-Host "Gagal rename .git. Mencoba menghapus isinya..." -ForegroundColor Red
    # Fallback: Hapus isi folder objects
    Remove-Item ".git\objects\*" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item ".git\refs\*" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item ".git\index" -Force -ErrorAction SilentlyContinue
}

# Mulai Fresh
git init
git branch -M main
git config user.email "miswar@example.com"
git config user.name "Miswar"

# LFS Setup
git lfs install
git lfs track "*.exe"
git lfs track "*.dll"
git lfs track "src-tauri/resources/ffmpeg.exe"

# Pastikan target diabaikan
if (-not (Select-String -Path .gitignore -Pattern "src-tauri/target")) {
    Add-Content .gitignore "`nsrc-tauri/target"
}

git add .
git commit -m "Initial commit (Fresh)"

$gitSize = (Get-ChildItem .git -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host "Ukuran .git baru: $gitSize MB" -ForegroundColor Cyan

if ($gitSize -lt 200) {
    git remote add origin https://github.com/MiswarR/metabayn-update.git
    git push -u origin main --force
    git tag v4.4.5
    git push origin v4.4.5 --force
} else {
    Write-Host "Masih terlalu besar. Cek manual." -ForegroundColor Red
}
