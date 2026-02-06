import fs from 'fs';
import path from 'path';
import os from 'os';

console.log("Starting Key Restoration (Base64 Passthrough Mode)...");

const rawKey = process.env.TAURI_PRIVATE_KEY;
if (!rawKey) {
  console.error("ERROR: TAURI_PRIVATE_KEY is missing!");
  process.exit(1);
}

const outputPath = path.resolve(process.cwd(), 'tauri.key');

try {
    // The user has confirmed they provided the Base64 string: "dW50cnVzdGVk..."
    // The error "Invalid symbol 32, offset 9" (space character) confirms that the 
    // Tauri signer is receiving "untrusted comment: ..." (Text) but expecting Base64.
    // Therefore, we must NOT decode the key here. We must write the Base64 string directly to the file.
    
    // Write the RAW Base64 content to the file.
    // The Tauri signer will read this file, find the Base64 string, and decode it internally.
    fs.writeFileSync(outputPath, rawKey.trim(), { encoding: 'utf8' });
    console.log(`Base64 Key written to ${outputPath}`);

} catch (e) {
    console.error("Error writing key:", e);
    process.exit(1);
}

// Export to GITHUB_ENV
const githubEnvPath = process.env.GITHUB_ENV;
if (githubEnvPath) {
    console.log("Injecting Key PATH into GITHUB_ENV...");
    fs.appendFileSync(githubEnvPath, `TAURI_PRIVATE_KEY=${outputPath}${os.EOL}`, { encoding: 'utf8' });
    
    // Explicitly set empty password
    fs.appendFileSync(githubEnvPath, `TAURI_KEY_PASSWORD=${''}${os.EOL}`, { encoding: 'utf8' });
    console.log("Success: TAURI_KEY_PASSWORD set to empty");
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
