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
    // Bersihkan spasi/newline yang tidak perlu dari rawKey jika ada
    // tapi PERTAHANKAN newline antara header dan body jika itu adalah formatnya.
    // Error "Invalid symbol 32, offset 9" (space) biasanya terjadi jika parser 
    // mencoba membaca Base64 tapi menemukan header text ("untrusted comment...").
    //
    // Jika kita menggunakan "Simple Dump Mode" di mana kita menuliskan seluruh isi key file
    // (termasuk header), maka kita harus memastikan `process.env.TAURI_PRIVATE_KEY` 
    // menunjuk ke FILE PATH saat di step build Tauri, BUKAN konten filenya lagi.
    //
    // Di step 4, kita sudah menginject PATH ke GITHUB_ENV:
    // `TAURI_PRIVATE_KEY=${outputPath}`
    //
    // Masalahnya mungkin terjadi jika Tauri membaca variable environment SEBELUM script ini
    // mengubahnya, atau jika ada race condition.
    //
    // TAPI, error "Invalid symbol 32" di "offset 9" sangat spesifik:
    // "untrusted comment: ..."
    //  0123456789
    //           ^ offset 9 is the space after "untrusted".
    //
    // Ini berarti Tauri CLI mencoba mem-parse isi file ini sebagai RAW BASE64 dan gagal di header.
    //
    // SOLUSI: Kita harus menghapus header dari file yang kita tulis, HANYA JIKA
    // Tauri di environment ini mengharapkan raw base64.
    // Namun, kunci yang kita generate tadi ("rsign encrypted") MEMILIKI header.
    //
    // Mari kita coba strategi "Hanya Base64 Body" lagi, tapi kali ini untuk key yang TERENKRIPSI.
    
    console.log("Processing Key Content...");
    
    // STRATEGI BARU:
    // Error "invalid utf-8 sequence of 1 bytes from index 6"
    // Ini biasanya terjadi jika kita memberikan file BINARY (raw bytes) ke sesuatu yang mengharapkan STRING (utf-8),
    // ATAU sebaliknya, kita memberikan STRING Base64 ke sesuatu yang mengharapkan BINARY DECODED.
    //
    // Jika kita memberikan Base64 string ke `tauri build` melalui file, tauri CLI akan membacanya.
    //
    // Mari kita coba pendekatan paling standar: Tulis persis apa adanya dari ENV,
    // TAPI pastikan encoding file adalah UTF-8 dan tidak ada BOM atau karakter aneh.
    //
    // Namun, error "Invalid symbol 32" sebelumnya menunjukkan bahwa parser TIDAK SUKA header.
    // Dan sekarang "invalid utf-8" mungkin karena kita memotong header tapi menyisakan karakter sampah,
    // atau karena kunci terenkripsi (binary) tidak valid jika dibaca sebagai utf-8.
    
    // KITA AKAN COBA REKONSTRUKSI ULANG DENGAN HEADER LENGKAP TAPI PASTI BENAR.
    // Kita tahu kuncinya adalah:
    // untrusted comment: rsign encrypted secret key
    // <BASE64>
    
    let keyContentToWrite = rawKey.trim();
    
    // Jika user mengcopy-paste dengan spasi berantakan, kita rapikan.
    const base64Match = rawKey.match(/([a-zA-Z0-9+/=]{50,})/);
    if (base64Match) {
        const body = base64Match[1];
        // Kita paksa format standar Minisign/Rsign
        // Note: Gunakan \n (LF) bukan \r\n (CRLF) untuk aman di Linux/Mac runner.
        keyContentToWrite = `untrusted comment: rsign encrypted secret key\n${body}`;
        console.log("Reconstructed Key with correct header (LF line endings).");
    } else {
        console.warn("Could not find Base64 body to reconstruct. Writing raw.");
    }

    fs.writeFileSync(outputPath, keyContentToWrite, { encoding: 'utf8' });
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
    
    // Use the provided password from env
    // We do NOT force empty here anymore because the user provided a password.
    // The TAURI_KEY_PASSWORD secret in GitHub should be set to the password.
    console.log("Using TAURI_KEY_PASSWORD from Secrets (not forcing empty).");
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
