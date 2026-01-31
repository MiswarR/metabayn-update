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
// Kita harus hati-hati. Jika key sudah memiliki header, kita validasi.
// Jika tidak, kita tambahkan header default.

let finalKeyContent = rawKey.trim();

// Cek apakah ada header 'untrusted comment'
if (finalKeyContent.includes('untrusted comment:')) {
    console.log("Key headers detected. Validating...");
    // Ganti header 'rsign' (jika ada) menjadi 'minisign' agar kompatibel
    // Beberapa tool generate key dengan header berbeda
    finalKeyContent = finalKeyContent.replace(/untrusted comment: rsign/g, 'untrusted comment: minisign');
    
    // Pastikan header benar
    if (!finalKeyContent.includes('untrusted comment: minisign secret key') && !finalKeyContent.includes('untrusted comment: minisign encrypted secret key')) {
        console.warn("WARNING: Key header might be non-standard. Attempting to fix...");
        // Jika header ada tapi aneh, kita biarkan dulu, mungkin user punya format sendiri
    }
} else {
    console.log("No headers detected. Assuming raw Base64 key.");
    const hasPwd = (process.env.TAURI_KEY_PASSWORD || '').replace(/\r?\n/g, '').trim().length > 0;
    const header = hasPwd ? "untrusted comment: minisign encrypted secret key" : "untrusted comment: minisign secret key";
    finalKeyContent = `${header}${os.EOL}${finalKeyContent}`;
}

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
    // Kita gunakan RAW BASE64 CONTENT injection karena Tauri signer di GitHub Actions
    // sering bermasalah dengan parsing header "untrusted comment" (Invalid symbol 32 error).
    const githubEnvPath = process.env.GITHUB_ENV;
    if (githubEnvPath) {
        const crypto = await import('crypto');
        const delimiter = `EOF_${crypto.randomBytes(4).toString('hex')}`;
        
        // Ekstrak hanya payload Base64 untuk Environment Variable
        // Hapus header 'untrusted comment' agar tidak ada spasi yang menyebabkan error parsing
        const lines = finalKeyContent.split(/\r?\n/);
        const base64Payload = lines
            .filter(line => line.trim() !== '' && !line.startsWith('untrusted comment:'))
            .join('')
            .trim();

        console.log("Injecting Base64 Payload into GITHUB_ENV (Header removed for compatibility)...");

        // Format Multiline untuk GITHUB_ENV
        const envContent = `TAURI_PRIVATE_KEY<<${delimiter}${os.EOL}${base64Payload}${os.EOL}${delimiter}${os.EOL}`;
        
        fs.appendFileSync(githubEnvPath, envContent, { encoding: 'utf8' });
        console.log("Success: TAURI_PRIVATE_KEY (Payload Only) added to GITHUB_ENV.");

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
    const disable = (process.env.DISABLE_UPDATER || 'true').toLowerCase() === 'true';
    if (disable) {
        conf.tauri.updater.active = false;
        if (Array.isArray(conf.tauri.bundle.targets)) {
            conf.tauri.bundle.targets = conf.tauri.bundle.targets.filter(t => t !== 'updater');
        }
    }
    fs.writeFileSync(confPath, JSON.stringify(conf, null, 2));
    console.log('Patched tauri.conf.json');
} catch (e) {
    console.log(`Skip patch tauri.conf.json: ${e.message}`);
}
