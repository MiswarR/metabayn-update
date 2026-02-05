import fs from 'fs';
import path from 'path';
import os from 'os';

console.log("Starting Key Restoration (Raw Body Mode)...");

const rawKey = process.env.TAURI_PRIVATE_KEY;
if (!rawKey) {
  console.error("ERROR: TAURI_PRIVATE_KEY is missing!");
  process.exit(1);
}

const outputPath = path.resolve(process.cwd(), 'tauri.key');

function extractBase64Body(input) {
    let content = input.trim();
    
    // 1. Remove standard headers if present
    // Minisign / Rsign headers
    const headers = [
        "untrusted comment: rsign encrypted secret key",
        "untrusted comment: minisign secret key",
        "untrusted comment: minisign public key"
    ];
    
    for (const h of headers) {
        if (content.toLowerCase().startsWith(h.toLowerCase())) {
             console.log(`Removing header: ${h}`);
             // Remove header (case insensitive match)
             content = content.substring(h.length).trim();
        }
    }
    
    // 2. Remove all non-base64 characters (whitespace, newlines)
    // Keep only A-Z, a-z, 0-9, +, /, =
    const cleanContent = content.replace(/[^a-zA-Z0-9+/=]/g, '');
    
    console.log("Extracted clean Base64 body.");
    return cleanContent;
}

const finalContent = extractBase64Body(rawKey);

if (finalContent.length < 10) {
    console.error("ERROR: Resulting key content is too short! Something went wrong.");
    process.exit(1);
}

// Write ONLY the Base64 body to the file
// This avoids "Invalid symbol 32" (space) errors if the parser tries to Base64 decode the whole file.
fs.writeFileSync(outputPath, finalContent, { encoding: 'utf8' });
console.log(`Key written to ${outputPath} (Raw Base64 format)`);
console.log("Content preview:");
console.log(finalContent.substring(0, 20) + "..." + finalContent.substring(finalContent.length - 10));

// Setup Env
const githubEnvPath = process.env.GITHUB_ENV;
if (githubEnvPath) {
    fs.appendFileSync(githubEnvPath, `TAURI_PRIVATE_KEY=${outputPath}${os.EOL}`, { encoding: 'utf8' });
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
