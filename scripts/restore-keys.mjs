import fs from 'fs';
import path from 'path';
import os from 'os';

console.log("Starting Key Restoration (Fresh Start Mode)...");

const rawKey = process.env.TAURI_PRIVATE_KEY;
if (!rawKey) {
  console.error("ERROR: TAURI_PRIVATE_KEY is missing!");
  process.exit(1);
}

const outputPath = path.resolve(process.cwd(), 'tauri.key');

try {
    // The key in GitHub Secrets is expected to be a Base64 string of the entire key file.
    // We decode it to get the original Minisign key file content (text).
    const decodedKey = Buffer.from(rawKey.trim(), 'base64').toString('utf-8');

    // Basic validation to ensure it looks like a Minisign key
    if (!decodedKey.startsWith('untrusted comment:')) {
        console.warn("WARNING: Decoded key does not start with 'untrusted comment'. It might be raw or invalid.");
        // Fallback: If decoding didn't produce expected text, maybe it wasn't base64? 
        // Or maybe it was just the raw key body?
        // We'll write the decoded content anyway, or maybe the raw content if decoding failed to produce text?
        // Let's assume the plan: User provides Base64, we decode.
    }

    fs.writeFileSync(outputPath, decodedKey, { encoding: 'utf8' });
    console.log(`Key written to ${outputPath}`);
} catch (e) {
    console.error("Error decoding/writing key:", e);
    process.exit(1);
}

// Ensure Updater Active
try {
    const confPath = path.resolve(process.cwd(), 'src-tauri', 'tauri.conf.json');
    if (fs.existsSync(confPath)) {
        const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
        if (!conf.tauri.updater.active) {
            conf.tauri.updater.active = true;
            fs.writeFileSync(confPath, JSON.stringify(conf, null, 2));
        }
    }
} catch (e) {}
