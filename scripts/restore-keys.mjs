import fs from 'fs';
import path from 'path';
import os from 'os';

console.log("Starting Key Restoration (Aggressive Reformat Mode)...");

const rawKey = process.env.TAURI_PRIVATE_KEY;
if (!rawKey) {
  console.error("ERROR: TAURI_PRIVATE_KEY is missing!");
  process.exit(1);
}

const outputPath = path.resolve(process.cwd(), 'tauri.key');

function reformatKey(input) {
    let content = input.trim();
    
    // Normalisasi: Hapus semua carriage return (\r)
    content = content.replace(/\r/g, '');

    // Coba deteksi header dan body menggunakan Regex
    // Mencari "untrusted comment: ... key" diikuti oleh karakter Base64
    // Flag 's' (dotAll) agar . bisa match newline jika ada
    // Kita gunakan logic manual parsing agar lebih aman
    
    const headerPrefix = "untrusted comment:";
    const headerSuffix = "key";
    
    const headerStartIndex = content.indexOf(headerPrefix);
    if (headerStartIndex !== -1) {
        // Cari akhir header (kata "key" pertama setelah prefix)
        // Perhatikan: isi comment bisa mengandung kata key, tapi format standar biasanya berakhiran " secret key" atau " public key"
        // Kita cari " key" (spasi key) untuk lebih aman, atau newline.
        
        // Asumsi standar: Header ada di baris pertama.
        // Jika ada newline, split di sana.
        if (content.includes('\n')) {
             const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
             if (lines.length >= 2) {
                 console.log("Input has multiple lines. Using first as header, second as body.");
                 return `${lines[0]}\n${lines[1]}`;
             }
        }

        // Jika tidak ada newline (satu baris panjang), kita harus menebak di mana header berakhir.
        // Kita cari pola " key" diikuti oleh karakter Base64 (R, R, ... biasanya Minisign mulai dengan R)
        // Atau kita cari posisi " key" terakhir sebelum string base64 panjang.
        
        // Minisign secret key standard comment: "untrusted comment: minisign secret key" atau "rsign encrypted secret key"
        const knownSuffixes = [" secret key", " public key"];
        let splitIndex = -1;
        
        for (const suffix of knownSuffixes) {
            const idx = content.indexOf(suffix);
            if (idx !== -1) {
                // Potensi akhir header. Cek apakah setelahnya ada body.
                // index akhir header adalah idx + suffix.length
                splitIndex = idx + suffix.length;
                break;
            }
        }
        
        if (splitIndex !== -1) {
            const header = content.substring(0, splitIndex).trim();
            const body = content.substring(splitIndex).trim();
            
            console.log(`Split single-line input. Header: "${header}"`);
            return `${header}\n${body}`;
        }
    }
    
    // Jika tidak ketemu pola header standar, tapi terlihat seperti Base64 murni
    if (/^[a-zA-Z0-9+/=]+$/.test(content) && content.length > 40) {
        console.warn("No header detected. Assuming raw Base64. Adding default Minisign header.");
        return `untrusted comment: rsign encrypted secret key\n${content}`;
    }

    // Fallback terakhir: kembalikan apa adanya (mungkin user sudah format benar tapi regex kita luput)
    console.log("Returning input as-is (no restructure applied).");
    return content;
}

const finalContent = reformatKey(rawKey);

fs.writeFileSync(outputPath, finalContent, { encoding: 'utf8' });
console.log(`Key written to ${outputPath}`);
console.log("Content preview:");
console.log(finalContent.substring(0, 50) + "...");

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
