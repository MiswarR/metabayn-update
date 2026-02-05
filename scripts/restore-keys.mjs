import fs from 'fs';
import path from 'path';
import os from 'os';

console.log("Starting Key Restoration (Smart Decode Mode)...");

// 1. Ambil Key dari Environment Variable
const rawKey = process.env.TAURI_PRIVATE_KEY;

if (!rawKey) {
  console.error("ERROR: TAURI_PRIVATE_KEY environment variable is not set!");
  process.exit(1);
}

// 2. Tentukan Path Output
const outputPath = path.resolve(process.cwd(), 'tauri.key');

// 3. Process Content
let finalContent = rawKey;

// Cek apakah ini Base64?
// Base64 biasanya tidak punya spasi (kecuali newline), dan hanya karakter A-Za-z0-9+/=
// Header minisign "untrusted comment" pasti punya spasi.
if (!rawKey.includes("untrusted comment")) {
    console.log("Input does not look like raw Minisign key (no header). Trying Base64 decode...");
    try {
        const decoded = Buffer.from(rawKey, 'base64').toString('utf8');
        if (decoded.includes("untrusted comment")) {
            console.log("Success: Base64 decoded to Minisign key.");
            finalContent = decoded;
        } else {
            console.warn("Warning: Decoded content does not have Minisign header. Writing original content.");
            // Mungkin format lain, biarkan saja.
        }
    } catch (e) {
        console.warn("Base64 decode failed or invalid. Writing original content.");
    }
} else {
    console.log("Input looks like raw Minisign key.");
}

// Normalize Line Endings to LF (\n)
// Minisign/Tauri di Linux/Mac mungkin sensitif terhadap CRLF
finalContent = finalContent.replace(/\r\n/g, '\n');

// 4. Tulis File
try {
    fs.writeFileSync(outputPath, finalContent, { encoding: 'utf8' });
    console.log(`Success: Key written to ${outputPath}`);
} catch (err) {
    console.error(`ERROR: Failed to write key file: ${err.message}`);
    process.exit(1);
}

// 5. Set Environment Variable untuk Github Actions
const githubEnvPath = process.env.GITHUB_ENV;
if (githubEnvPath) {
    console.log("Injecting Key PATH into GITHUB_ENV...");
    
    const envContent = `TAURI_PRIVATE_KEY=${outputPath}${os.EOL}`;
    fs.appendFileSync(githubEnvPath, envContent, { encoding: 'utf8' });
    
    // Pass through password logic (user sets TAURI_KEY_PASSWORD in secrets)
    // No need to force empty here.
} else {
    console.warn("WARNING: GITHUB_ENV not detected.");
}

// 6. Force Enable Updater in tauri.conf.json (Safety Net)
try {
    const confPath = path.resolve(process.cwd(), 'src-tauri', 'tauri.conf.json');
    if (fs.existsSync(confPath)) {
        const confRaw = fs.readFileSync(confPath, 'utf8');
        const conf = JSON.parse(confRaw);
        
        let changed = false;
        if (!conf.tauri.updater.active) {
            conf.tauri.updater.active = true;
            changed = true;
        }
        
        if (changed) {
             console.log("Enabling updater in tauri.conf.json...");
             fs.writeFileSync(confPath, JSON.stringify(conf, null, 2));
        }
    }
} catch (e) {
    console.log(`Skip patch tauri.conf.json: ${e.message}`);
}
