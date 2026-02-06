import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log("Generating NEW key with EMPTY password (FINAL ATTEMPT)...");

// Clean up old keys
try {
    if (fs.existsSync('mysigning.key')) fs.unlinkSync('mysigning.key');
    if (fs.existsSync('mysigning.key.pub')) fs.unlinkSync('mysigning.key.pub');
} catch (e) {}

const cmd = 'npm'; 
const child = spawn(cmd, ['run', 'tauri', 'signer', 'generate', '--', '-w', 'mysigning.key', '--force'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'inherit', 'inherit'],
  shell: true
});

// Send newlines for empty password
setTimeout(() => {
    try {
        console.log("Sending first newline (Empty Password)...");
        child.stdin.write('\n');
    } catch (e) { console.error(e); }
}, 3000);

setTimeout(() => {
    try {
        console.log("Sending second newline (Confirm)...");
        child.stdin.write('\n');
        child.stdin.end();
    } catch (e) { console.error(e); }
}, 5000);
