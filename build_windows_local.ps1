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

# ExifTool - ALWAYS download fresh from official source
Write-Host "   Downloading ExifTool from official source (exiftool.org)..."
$exiftoolDest = "$resourceDir/exiftool.exe"
$exiftoolZipUrl = "https://exiftool.org/exiftool-13.50.zip"
$exiftoolZip = "exiftool_download.zip"
$exiftoolTempDir = "exiftool_temp_extract"

try {
    # Download fresh exiftool
    Invoke-WebRequest -Uri $exiftoolZipUrl -OutFile $exiftoolZip -UseBasicParsing
    $downloadedSize = (Get-Item $exiftoolZip).Length
    Write-Host "   Downloaded zip size: $downloadedSize bytes"

    if ($downloadedSize -lt 500000) {
        throw "Downloaded zip too small - likely failed"
    }

    # Extract
    if (Test-Path $exiftoolTempDir) { Remove-Item $exiftoolTempDir -Recurse -Force }
    Expand-Archive -Path $exiftoolZip -DestinationPath $exiftoolTempDir -Force

    # Find exiftool(-k).exe
    $exiftoolExe = Get-ChildItem -Path $exiftoolTempDir -Filter "exiftool(-k).exe" -Recurse | Select-Object -First 1

    if (-not $exiftoolExe) {
        throw "Failed to find exiftool(-k).exe in zip"
    }

    Write-Host "   Found: $($exiftoolExe.FullName) ($($exiftoolExe.Length) bytes)"

    # Validate size
    if ($exiftoolExe.Length -lt 1000000) {
        Write-Host "   WARNING: exiftool.exe is small ($($exiftoolExe.Length) bytes). Validating PE header..."
        $bytes = [System.IO.File]::ReadAllBytes($exiftoolExe.FullName)[0..1]
        if ($bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) {
            throw "exiftool.exe does not have valid PE header"
        }
        Write-Host "   PE header OK"
    }

    # Copy exe
    Copy-Item $exiftoolExe.FullName $exiftoolDest -Force
    Write-Host "   Copied exiftool.exe to resources ($($exiftoolExe.Length) bytes)"

    # Copy exiftool_files/lib
    $libParent = Get-ChildItem -Path $exiftoolTempDir -Directory -Filter "Image-ExifTool-*" | Select-Object -First 1
    if ($libParent) {
        $libSrc = Join-Path $libParent.FullName "exiftool_files"
        if (Test-Path $libSrc) {
            if (Test-Path "$resourceDir/exiftool_files") {
                Remove-Item "$resourceDir/exiftool_files" -Recurse -Force
            }
            Copy-Item $libSrc "$resourceDir/exiftool_files" -Recurse -Force
            Write-Host "   Copied exiftool_files/lib"
        }
    }

    Write-Host "   ExifTool ready." -ForegroundColor Green

} catch {
    Write-Warning "   Download failed: $_"
    Write-Host "   Trying alternative (SourceForge)..."

    try {
        $altUrl = "https://downloads.sourceforge.net/project/exiftool/exiftool-13.50.zip"
        Invoke-WebRequest -Uri $altUrl -OutFile $exiftoolZip -UseBasicParsing

        if (Test-Path $exiftoolTempDir) { Remove-Item $exiftoolTempDir -Recurse -Force }
        Expand-Archive -Path $exiftoolZip -DestinationPath $exiftoolTempDir -Force

        $exiftoolExe = Get-ChildItem -Path $exiftoolTempDir -Filter "exiftool(-k).exe" -Recurse | Select-Object -First 1
        if ($exiftoolExe) {
            Copy-Item $exiftoolExe.FullName $exiftoolDest -Force

            $libParent = Get-ChildItem -Path $exiftoolTempDir -Directory -Filter "Image-ExifTool-*" | Select-Object -First 1
            if ($libParent) {
                $libSrc = Join-Path $libParent.FullName "exiftool_files"
                if (Test-Path $libSrc) {
                    if (Test-Path "$resourceDir/exiftool_files") {
                        Remove-Item "$resourceDir/exiftool_files" -Recurse -Force
                    }
                    Copy-Item $libSrc "$resourceDir/exiftool_files" -Recurse -Force
                }
            }
            Write-Host "   ExifTool ready (from SourceForge backup)." -ForegroundColor Green
        }
    } catch {
        Write-Error "   Failed to download ExifTool: $_"
    }
} finally {
    # Cleanup
    if (Test-Path $exiftoolZip) { Remove-Item $exiftoolZip -Force -ErrorAction SilentlyContinue }
    if (Test-Path $exiftoolTempDir) { Remove-Item $exiftoolTempDir -Recurse -Force -ErrorAction SilentlyContinue }
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
