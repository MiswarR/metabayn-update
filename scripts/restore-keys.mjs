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
    // Asumsi ini adalah raw base64 dari passwordless key
    const correctHeader = "untrusted comment: minisign secret key";
    finalKeyContent = `${correctHeader}${os.EOL}${finalKeyContent}`;
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
// Kita gunakan CONTENT injection (bukan path) karena Tauri signer sering bermasalah dengan path parsing
// Referensi: https://github.com/tauri-apps/tauri/issues/6950
const githubEnvPath = process.env.GITHUB_ENV;
if (githubEnvPath) {
    const crypto = await import('crypto');
    const delimiter = `EOF_${crypto.randomBytes(4).toString('hex')}`;
    
    // Format Multiline untuk GITHUB_ENV
    // KEY_NAME<<DELIMITER
    // value
    // DELIMITER
    const envContent = `TAURI_PRIVATE_KEY<<${delimiter}${os.EOL}${finalKeyContent}${os.EOL}${delimiter}${os.EOL}`;
    
    fs.appendFileSync(githubEnvPath, envContent, { encoding: 'utf8' });
    console.log("Success: TAURI_PRIVATE_KEY content added to GITHUB_ENV.");

    // Handle Password (Optional)
    if (process.env.TAURI_KEY_PASSWORD) {
        fs.appendFileSync(githubEnvPath, `TAURI_KEY_PASSWORD=${process.env.TAURI_KEY_PASSWORD}${os.EOL}`, { encoding: 'utf8' });
        console.log("Success: TAURI_KEY_PASSWORD added to GITHUB_ENV.");
    }
} else {
    console.warn("WARNING: GITHUB_ENV not detected. Assuming local run.");
}
