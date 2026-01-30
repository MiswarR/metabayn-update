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
// Hapus semua baris 'untrusted comment' lama untuk kita bangun ulang
// Hapus whitespace berlebih
// Ambil hanya bagian Base64 (Payload)
let payload = "";
const lines = rawKey.split(/\r?\n/);

for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("untrusted comment:")) {
        console.log(`Found header: ${trimmed}`);
        continue; // Skip header lama
    }
    // Asumsi baris sisa adalah payload base64
    // Minisign key payload biasanya satu baris panjang
    payload += trimmed;
}

if (!payload) {
    console.error("ERROR: Could not extract key payload (Base64 string).");
    console.log("Raw Key Dump (First 50 chars):", rawKey.substring(0, 50));
    process.exit(1);
}

console.log("Payload extracted successfully.");

// 3. Rekonstruksi Key dengan Format Minisign yang Benar
// Format:
// untrusted comment: minisign secret key
// <BASE64_PAYLOAD>
const correctHeader = "untrusted comment: minisign secret key";
const finalKeyContent = `${correctHeader}\n${payload}`;

// 4. Tentukan Path Output
// Gunakan current working directory
const outputPath = path.resolve(process.cwd(), 'tauri.key');

// 5. Tulis File dengan Encoding UTF-8 (Tanpa BOM) dan Newline LF
try {
    fs.writeFileSync(outputPath, finalKeyContent, { encoding: 'utf8' });
    console.log(`Success: Key written to ${outputPath}`);
} catch (err) {
    console.error(`ERROR: Failed to write key file: ${err.message}`);
    process.exit(1);
}

// 6. Validasi File
try {
    const readBack = fs.readFileSync(outputPath, 'utf8');
    const readLines = readBack.split('\n');
    console.log("Validation - First Line:", readLines[0]);
    if (readLines[0].trim() !== correctHeader) {
        console.error("ERROR: Written file header does not match expected header!");
        process.exit(1);
    }
    console.log("Validation: File integrity check passed.");
} catch (err) {
    console.error(`ERROR: Validation failed: ${err.message}`);
    process.exit(1);
}

// 7. Set Environment Variable untuk Step Selanjutnya (Github Actions)
// Kita perlu append ke $GITHUB_ENV
const githubEnvPath = process.env.GITHUB_ENV;
if (githubEnvPath) {
    const envContent = `TAURI_PRIVATE_KEY=${outputPath}${os.EOL}`;
    fs.appendFileSync(githubEnvPath, envContent, { encoding: 'utf8' });
    console.log("Success: TAURI_PRIVATE_KEY path added to GITHUB_ENV.");

    // Handle Password (Optional)
    if (process.env.TAURI_KEY_PASSWORD) {
        fs.appendFileSync(githubEnvPath, `TAURI_KEY_PASSWORD=${process.env.TAURI_KEY_PASSWORD}${os.EOL}`, { encoding: 'utf8' });
        console.log("Success: TAURI_KEY_PASSWORD added to GITHUB_ENV.");
    }
} else {
    console.warn("WARNING: GITHUB_ENV not detected. Assuming local run.");
}
