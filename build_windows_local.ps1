# Script untuk build Windows Installer (.msi) secara lokal di laptop Anda
# Jalankan script ini dengan PowerShell (klik kanan -> Run with PowerShell)

Write-Host "=== Memulai Proses Build Lokal Windows ===" -ForegroundColor Cyan

# 1. Cek Prasyarat
Write-Host "1. Memeriksa lingkungan..."
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js tidak ditemukan. Silakan install Node.js terlebih dahulu."
    exit 1
}
if (-not (Get-Command "cargo" -ErrorAction SilentlyContinue)) {
    Write-Error "Rust (cargo) tidak ditemukan. Silakan install Rust terlebih dahulu."
    exit 1
}

# 2. Setup Resources (FFmpeg & ExifTool)
$resourceDir = "src-tauri/resources"
if (-not (Test-Path $resourceDir)) {
    New-Item -ItemType Directory -Force -Path $resourceDir | Out-Null
}

Write-Host "2. Menyiapkan resources (FFmpeg & ExifTool)..."

# FFmpeg
$ffmpegDest = "$resourceDir/ffmpeg.exe"
if (-not (Test-Path $ffmpegDest)) {
    Write-Host "   Downloading FFmpeg..."
    $ffmpegUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    Invoke-WebRequest -Uri $ffmpegUrl -OutFile "ffmpeg.zip"
    Expand-Archive -Path "ffmpeg.zip" -DestinationPath "ffmpeg_temp" -Force
    $ffmpegExe = Get-ChildItem -Path "ffmpeg_temp" -Filter "ffmpeg.exe" -Recurse | Select-Object -First 1
    if ($ffmpegExe) {
        Copy-Item $ffmpegExe.FullName $ffmpegDest -Force
        Write-Host "   FFmpeg berhasil disiapkan." -ForegroundColor Green
    } else {
        Write-Error "   Gagal menemukan ffmpeg.exe dalam zip."
    }
    Remove-Item "ffmpeg.zip" -Force
    Remove-Item "ffmpeg_temp" -Recurse -Force
} else {
    Write-Host "   FFmpeg sudah ada." -ForegroundColor Green
}

# ExifTool
$exiftoolDest = "$resourceDir/exiftool.exe"
if (-not (Test-Path $exiftoolDest)) {
    Write-Host "   Downloading ExifTool..."
    # Menggunakan SourceForge mirror yang lebih stabil
    $exiftoolUrl = "https://downloads.sourceforge.net/project/exiftool/exiftool-13.47_64.zip"
    try {
        Invoke-WebRequest -Uri $exiftoolUrl -OutFile "exiftool.zip"
        Expand-Archive -Path "exiftool.zip" -DestinationPath "exiftool_temp" -Force
        $exiftoolExe = Get-ChildItem -Path "exiftool_temp" -Filter "exiftool(-k).exe" -Recurse | Select-Object -First 1
        if ($exiftoolExe) {
            Copy-Item $exiftoolExe.FullName $exiftoolDest -Force
            Write-Host "   ExifTool berhasil disiapkan." -ForegroundColor Green
        } else {
            Write-Error "   Gagal menemukan exiftool(-k).exe dalam zip."
        }
    } catch {
        Write-Warning "   Gagal download dari SourceForge, mencoba exiftool.org..."
        $exiftoolUrlOrg = "https://exiftool.org/exiftool-13.47_64.zip"
        Invoke-WebRequest -Uri $exiftoolUrlOrg -OutFile "exiftool.zip"
        Expand-Archive -Path "exiftool.zip" -DestinationPath "exiftool_temp" -Force
        $exiftoolExe = Get-ChildItem -Path "exiftool_temp" -Filter "exiftool(-k).exe" -Recurse | Select-Object -First 1
        if ($exiftoolExe) {
            Copy-Item $exiftoolExe.FullName $exiftoolDest -Force
            Write-Host "   ExifTool berhasil disiapkan (dari backup)." -ForegroundColor Green
        }
    }
    
    if (Test-Path "exiftool.zip") { Remove-Item "exiftool.zip" -Force }
    if (Test-Path "exiftool_temp") { Remove-Item "exiftool_temp" -Recurse -Force }
} else {
    Write-Host "   ExifTool sudah ada." -ForegroundColor Green
}

# 3. Install Dependencies
Write-Host "3. Menginstall dependencies (npm install)..."
npm install

# 4. Build
Write-Host "4. Memulai Build Tauri (ini mungkin memakan waktu)..."
# Set environment variable untuk skip password jika key tidak dipassword
$env:TAURI_KEY_PASSWORD = ""

# Set environment variable untuk PRIVATE KEY dari file local
if (Test-Path "final.key") {
    Write-Host "   Mendeteksi file final.key, mengatur TAURI_PRIVATE_KEY..."
    $env:TAURI_PRIVATE_KEY = Get-Content "final.key" -Raw
} else {
    Write-Warning "   File final.key tidak ditemukan! Build mungkin gagal jika updater diaktifkan."
}

# Patch sementara: nonaktifkan target "updater" saat build lokal
# Agar bundling .msi/.exe tetap sukses meskipun kunci updater ber-password
try {
    $confPath = "src-tauri/tauri.conf.json"
    $backupPath = "src-tauri/tauri.conf.json.bak"
    Copy-Item $confPath $backupPath -Force
    $json = Get-Content $confPath -Raw | ConvertFrom-Json
    if ($json.tauri.bundle.targets) {
        $json.tauri.bundle.targets = @($json.tauri.bundle.targets | Where-Object { $_ -ne "updater" })
    }
    $json | ConvertTo-Json -Depth 10 | Set-Content $confPath -Encoding UTF8
} catch {
    Write-Warning "   Gagal mem-patch tauri.conf.json (updater akan tetap aktif)."
}

npm run tauri build

if ($LASTEXITCODE -eq 0) {
    Write-Host "=== BUILD SUKSES! ===" -ForegroundColor Green
    Write-Host "Installer Anda berada di:"
    Write-Host "d:\Proyek App\metabayn-Tauri\tauri\src-tauri\target\release\bundle\msi"
    Invoke-Item "src-tauri\target\release\bundle\msi"
} else {
    Write-Host "=== BUILD GAGAL ===" -ForegroundColor Red
    Write-Host "Silakan cek pesan error di atas."
}

# Pulihkan file konfigurasi asli
try {
    if (Test-Path "src-tauri/tauri.conf.json.bak") {
        Move-Item "src-tauri/tauri.conf.json.bak" "src-tauri/tauri.conf.json" -Force
    }
} catch {}

Read-Host "Tekan Enter untuk keluar..."
