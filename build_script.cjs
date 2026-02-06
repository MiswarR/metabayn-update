const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Use a path without spaces!
const tempKeyPath = 'D:\\tauri_temp.key';
const sourceKeyPath = path.resolve('tauri_private.key');

console.log(`Copying key from ${sourceKeyPath} to ${tempKeyPath}`);
// Read and clean the key (ensure LF)
let keyContent = fs.readFileSync(sourceKeyPath, 'utf8');
keyContent = keyContent.replace(/\r\n/g, '\n');

// Base64 encode the WHOLE content
const encodedKey = Buffer.from(keyContent, 'utf8').toString('base64');

console.log('Setting TAURI_PRIVATE_KEY env var to Base64 encoded key content (original header).');

// Set env var to the KEY CONTENT directly
const env = { ...process.env };
env.TAURI_PRIVATE_KEY = encodedKey;
if (env.TAURI_KEY_PASSWORD) delete env.TAURI_KEY_PASSWORD;

// We don't need the temp file anymore
if (fs.existsSync(tempKeyPath)) {
  fs.unlinkSync(tempKeyPath);
}

console.log(`Running build with TAURI_PRIVATE_KEY length ${encodedKey.length}`);

const build = spawn('npm.cmd', ['run', 'tauri', 'build'], { env, stdio: 'inherit', shell: true });

build.on('close', (code) => {
  console.log(`Build exited with code ${code}`);
  // Clean up
  try {
    if (fs.existsSync(tempKeyPath)) {
      fs.unlinkSync(tempKeyPath);
    }
  } catch (e) {
    console.error('Failed to cleanup temp key:', e);
  }
  process.exit(code);
});
