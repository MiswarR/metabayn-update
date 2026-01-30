# Skrip Otomatis: Amankan Secrets & Push ke GitHub
# Mengatasi masalah "Push rejected due to secrets"

Write-Host "Mulai proses pengamanan secrets..." -ForegroundColor Cyan

# 1. Backup file yang berisi secrets (Hanya lokal, tidak akan di-upload)
$wranglerPath = "metabayn-backend\wrangler.toml"
$backupPath = "metabayn-backend\wrangler.toml.backup_secrets"

if (Test-Path $wranglerPath) {
    Copy-Item $wranglerPath $backupPath -Force
    Write-Host "Backup wrangler.toml dibuat di: $backupPath" -ForegroundColor Green
}

# 2. Update .gitignore
$gitignore = ".gitignore"
$ignores = @(".dev.vars", "*.backup_secrets", "metabayn-backend/.dev.vars")
foreach ($ignore in $ignores) {
    if (-not (Select-String -Path $gitignore -Pattern $ignore)) {
        Add-Content $gitignore "`n$ignore"
        Write-Host "Menambahkan $ignore ke .gitignore" -ForegroundColor Yellow
    }
}

# 3. Sensor wrangler.toml (Ganti nilai rahasia dengan placeholder)
if (Test-Path $wranglerPath) {
    $content = Get-Content $wranglerPath
    $newContent = @()
    foreach ($line in $content) {
        if ($line -match 'JWT_SECRET\s*=') { $line = 'JWT_SECRET = "YOUR_JWT_SECRET"' }
        if ($line -match 'ADMIN_SECRET\s*=') { $line = 'ADMIN_SECRET = "YOUR_ADMIN_SECRET"' }
        if ($line -match 'LYNKID_WEBHOOK_SECRET\s*=') { $line = 'LYNKID_WEBHOOK_SECRET = "YOUR_WEBHOOK_SECRET"' }
        if ($line -match 'OPENAI_API_KEY\s*=') { $line = 'OPENAI_API_KEY = "YOUR_OPENAI_API_KEY"' }
        if ($line -match 'GEMINI_API_KEY\s*=') { $line = 'GEMINI_API_KEY = "YOUR_GEMINI_API_KEY"' }
        if ($line -match 'PAYPAL_CLIENT_ID\s*=') { $line = 'PAYPAL_CLIENT_ID = "YOUR_PAYPAL_CLIENT_ID"' }
        if ($line -match 'PAYPAL_CLIENT_SECRET\s*=') { $line = 'PAYPAL_CLIENT_SECRET = "YOUR_PAYPAL_SECRET"' }
        if ($line -match 'RESEND_API_KEY\s*=') { $line = 'RESEND_API_KEY = "YOUR_RESEND_API_KEY"' }
        if ($line -match 'GOOGLE_OAUTH_CLIENT_ID\s*=') { $line = 'GOOGLE_OAUTH_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID"' }
        if ($line -match 'GOOGLE_OAUTH_CLIENT_SECRET\s*=') { $line = 'GOOGLE_OAUTH_CLIENT_SECRET = "YOUR_GOOGLE_CLIENT_SECRET"' }
        if ($line -match 'GOOGLE_PRIVATE_KEY\s*=') { $line = 'GOOGLE_PRIVATE_KEY = "YOUR_GOOGLE_PRIVATE_KEY"' }
        if ($line -match '-----BEGIN PRIVATE KEY-----') { continue }
        if ($line -match '-----END PRIVATE KEY-----') { continue }
        # Hapus baris kunci privat yang panjang (base64/pem content)
        if ($line -match '^[A-Za-z0-9+/=]{20,}$') { continue } 
        
        $newContent += $line
    }
    Set-Content $wranglerPath $newContent
    Write-Host "wrangler.toml telah disensor untuk keamanan." -ForegroundColor Green
}

# 4. Hapus file rahasia dari Git Index (Cached)
Write-Host "Menghapus file rahasia dari Git staging..." -ForegroundColor Yellow
git rm --cached metabayn-backend/.dev.vars -f 2>$null
git rm --cached metabayn-backend/wrangler.toml -f 2>$null # Kita add ulang nanti versi sensor

# 5. Add ulang & Amend Commit
Write-Host "Update commit..." -ForegroundColor Green
git add .
git commit --amend --no-edit

# 6. Push Lagi
Write-Host "Mencoba Push ke GitHub..." -ForegroundColor Cyan
git push -u origin main --force
git tag -d v4.4.5 2>$null
git push origin :refs/tags/v4.4.5 2>$null # Hapus tag remote jika ada
git tag v4.4.5
git push origin v4.4.5 --force

Write-Host "Selesai! Cek apakah berhasil." -ForegroundColor Green
