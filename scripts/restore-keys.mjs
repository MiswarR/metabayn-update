import fs from 'fs';
import path from 'path';
import os from 'os';

console.log("Starting Key Restoration (Simple Dump Mode)...");

// 1. Ambil Key dari Environment Variable
const rawKey = process.env.TAURI_PRIVATE_KEY;

if (!rawKey) {
  console.error("ERROR: TAURI_PRIVATE_KEY environment variable is not set!");
  process.exit(1);
}

// 2. Tentukan Path Output
const outputPath = path.resolve(process.cwd(), 'tauri.key');

// 3. Tulis File (Dump Raw Content)
try {
    // Kita asumsikan isi variable adalah konten file key yang valid (header + body)
    fs.writeFileSync(outputPath, rawKey, { encoding: 'utf8' });
    console.log(`Success: Key written to ${outputPath}`);
} catch (err) {
    console.error(`ERROR: Failed to write key file: ${err.message}`);
    process.exit(1);
}

// 4. Set Environment Variable untuk Github Actions
const githubEnvPath = process.env.GITHUB_ENV;
if (githubEnvPath) {
    console.log("Injecting Key PATH into GITHUB_ENV...");
    
    const envContent = `TAURI_PRIVATE_KEY=${outputPath}${os.EOL}`;
    fs.appendFileSync(githubEnvPath, envContent, { encoding: 'utf8' });
    
    // Force empty password (since we generated a key with empty password)
    fs.appendFileSync(githubEnvPath, `TAURI_KEY_PASSWORD=${''}${os.EOL}`, { encoding: 'utf8' });
    console.log("Success: TAURI_KEY_PASSWORD forced to empty");
} else {
    console.warn("WARNING: GITHUB_ENV not detected.");
}

// 5. Force Enable Updater in tauri.conf.json
try {
    const confPath = path.resolve(process.cwd(), 'src-tauri', 'tauri.conf.json');
    const confRaw = fs.readFileSync(confPath, 'utf8');
    const conf = JSON.parse(confRaw);
    
    // Ensure updater is active
    if (!conf.tauri.updater.active) {
        console.log("Enabling updater in tauri.conf.json...");
        conf.tauri.updater.active = true;
        if (Array.isArray(conf.tauri.bundle.targets)) {
             if (!conf.tauri.bundle.targets.includes('updater')) {
                 conf.tauri.bundle.targets.push('updater');
             }
        }
        fs.writeFileSync(confPath, JSON.stringify(conf, null, 2));
    }
} catch (e) {
    console.log(`Skip patch tauri.conf.json: ${e.message}`);
}
