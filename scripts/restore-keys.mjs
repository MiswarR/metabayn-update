import fs from 'fs';
import path from 'path';
import os from 'os';

console.log("Starting Key Restoration...");

// 1. Ambil Key dari Environment Variable
const rawKey = process.env.TAURI_PRIVATE_KEY;

if (!rawKey) {
  console.error("ERROR: TAURI_PRIVATE_KEY environment variable is not set!");
  process.exit(1);
}

console.log(`Key length: ${rawKey.length}`);

// 2. Bersihkan Key (Normalize)
// REWRITE: Reconstruct key strictly to avoid "Invalid symbol" errors.
// We extract ONLY the Base64 body and Prepend a fresh header.

// Check password status
const pwdCheck = (process.env.TAURI_KEY_PASSWORD || '').replace(/\r?\n/g, '').trim();
const hasPwd = pwdCheck.length > 0;
const expectedHeader = hasPwd 
    ? "untrusted comment: minisign encrypted secret key" 
    : "untrusted comment: minisign secret key";

console.log(`Password detected: ${hasPwd ? 'YES' : 'NO'}`);
console.log(`Expected Header: ${expectedHeader}`);

// Extract Base64 Body
// Pattern: Cari string Base64 yang panjang (50+ chars).
// Ini mengabaikan header lama yang mungkin rusak/salah spasi.
const base64Pattern = /([a-zA-Z0-9+/=]{40,})/;
const match = rawKey.match(base64Pattern);

if (!match) {
    console.error("CRITICAL ERROR: Could not find valid Base64 key body in the provided secret!");
    // Fallback: Use rawKey trimmed, maybe it's short?
    // But usually minisign keys are longer.
    console.error("Raw Key Dump (First 20 chars):", rawKey.substring(0, 20));
    process.exit(1);
}

const keyBody = match[1].trim();
console.log("Extracted Key Body (first 10 chars):", keyBody.substring(0, 10) + "...");

// Reconstruct Key Strictly
// Note: We use \n (Line Feed) explicitly for consistency across platforms (macOS needs \n)
const finalKeyContent = `${expectedHeader}\n${keyBody}`;

console.log("Key Reconstructed Successfully.");


console.log("Key content prepared.");

// 4. Tentukan Path Output (Untuk backup/debug, tapi kita utamakan Env Var)
const outputPath = path.resolve(process.cwd(), 'tauri.key');

// 5. Tulis File (Backup/Fallback)
try {
    fs.writeFileSync(outputPath, finalKeyContent, { encoding: 'utf8' });
    console.log(`Success: Key written to ${outputPath}`);
} catch (err) {
    console.error(`ERROR: Failed to write key file: ${err.message}`);
    process.exit(1);
}

// 6. Validasi File (Basic Check)
try {
    const readBack = fs.readFileSync(outputPath, 'utf8');
    const readLines = readBack.split('\n');
    console.log("Validation - First Line:", readLines[0].trim());
    
    if (!readBack.includes('untrusted comment:')) {
        console.error("ERROR: File does not contain 'untrusted comment' header!");
        process.exit(1);
    }
    console.log("Validation: File integrity check passed.");
} catch (err) {
    console.error(`ERROR: Validation failed: ${err.message}`);
    process.exit(1);
}

    // 7. Set Environment Variable untuk Step Selanjutnya (Github Actions)
    const githubEnvPath = process.env.GITHUB_ENV;
    if (githubEnvPath) {
        console.log("Injecting Key PATH (not content) into GITHUB_ENV to avoid parsing errors...");
        
        // Use the absolute path to the file we just wrote
        // This avoids "Invalid symbol 32" errors caused by Env Var parsing issues
        const envContent = `TAURI_PRIVATE_KEY=${outputPath}${os.EOL}`;
        
        fs.appendFileSync(githubEnvPath, envContent, { encoding: 'utf8' });
        console.log(`Success: TAURI_PRIVATE_KEY set to path: ${outputPath}`);

        // Handle Password (Optional)
        const pwdRaw = process.env.TAURI_KEY_PASSWORD;
    if (pwdRaw && pwdRaw.length > 0) {
        const pwd = pwdRaw.replace(/\r?\n/g, '').trim();
        fs.appendFileSync(githubEnvPath, `TAURI_KEY_PASSWORD=${pwd}${os.EOL}`, { encoding: 'utf8' });
        console.log(`Success: TAURI_KEY_PASSWORD added to GITHUB_ENV. Length: ${pwd.length}`);
    }
} else {
    console.warn("WARNING: GITHUB_ENV not detected. Assuming local run.");
}

try {
    const confPath = path.resolve(process.cwd(), 'src-tauri', 'tauri.conf.json');
    const confRaw = fs.readFileSync(confPath, 'utf8');
    const conf = JSON.parse(confRaw);
    const pub = process.env.TAURI_PUBLIC_KEY;
    if (pub && pub.trim().length > 0) {
        conf.tauri.updater.pubkey = pub.trim();
    }
    const disable = (process.env.DISABLE_UPDATER || 'false').toLowerCase() === 'true';
    if (disable) {
        conf.tauri.updater.active = false;
        if (Array.isArray(conf.tauri.bundle.targets)) {
            conf.tauri.bundle.targets = conf.tauri.bundle.targets.filter(t => t !== 'updater');
        }
    } else {
        // FORCE ENABLE UPDATER if not disabled
        console.log("Enabling updater in tauri.conf.json...");
        conf.tauri.updater.active = true;
        if (Array.isArray(conf.tauri.bundle.targets)) {
             if (!conf.tauri.bundle.targets.includes('updater')) {
                 conf.tauri.bundle.targets.push('updater');
             }
        }
    }
    fs.writeFileSync(confPath, JSON.stringify(conf, null, 2));
    console.log('Patched tauri.conf.json');
} catch (e) {
    console.log(`Skip patch tauri.conf.json: ${e.message}`);
}
