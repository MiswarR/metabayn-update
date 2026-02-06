import fs from 'fs';
import path from 'path';
import os from 'os';

console.log("Starting Key Restoration (Raw Key Body Mode)...");

const rawKey = process.env.TAURI_PRIVATE_KEY;
if (!rawKey) {
  console.error("ERROR: TAURI_PRIVATE_KEY is missing!");
  process.exit(1);
}

const outputPath = path.resolve(process.cwd(), 'tauri.key');

try {
    // 1. Decode the GitHub Secret (Base64 -> Text)
    // Expectation: The secret contains the FULL file content (Header + Key) encoded in Base64
    let decodedContent = Buffer.from(rawKey.trim(), 'base64').toString('utf-8');
    console.log("Decoded key content length:", decodedContent.length);

    // 2. Extract ONLY the Key Body (remove headers/comments)
    // The error "Invalid symbol 32, offset 9" happens because Tauri is trying to Base64-decode
    // the text "untrusted comment..." and fails at the space (symbol 32) at offset 9.
    // Solution: Give it ONLY the Base64 key data.
    
    let keyBody = decodedContent;
    const lines = decodedContent.split(/\r?\n/);
    
    // Find the line that looks like a key (long, no spaces, not a comment)
    const keyLine = lines.find(line => 
        line.trim().length > 20 && 
        !line.startsWith('untrusted comment:') && 
        !line.includes(' ')
    );

    if (keyLine) {
        console.log("Found raw key body in file content. extracting...");
        keyBody = keyLine.trim();
    } else {
        console.warn("Could not identify key body line. Using full content (risky).");
        // Fallback: maybe the content IS just the key?
        keyBody = decodedContent.trim();
    }

    // 3. Write ONLY the key body to the file
    fs.writeFileSync(outputPath, keyBody, { encoding: 'utf8' });
    console.log(`Raw Key Body written to ${outputPath}`);

} catch (e) {
    console.error("Error processing key:", e);
    process.exit(1);
}

// 4. Export to GITHUB_ENV
const githubEnvPath = process.env.GITHUB_ENV;
if (githubEnvPath) {
    console.log("Injecting Key PATH into GITHUB_ENV...");
    fs.appendFileSync(githubEnvPath, `TAURI_PRIVATE_KEY=${outputPath}${os.EOL}`, { encoding: 'utf8' });
    
    // Explicitly set empty password
    fs.appendFileSync(githubEnvPath, `TAURI_KEY_PASSWORD=${''}${os.EOL}`, { encoding: 'utf8' });
    console.log("Success: TAURI_KEY_PASSWORD set to empty");
}

// 5. Ensure Updater Active
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
