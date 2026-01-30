// Helper untuk Password Hashing (PBKDF2)
export async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]);
  const derivedKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
  );
  
  // Kita export raw bits sebagai hex untuk disimpan
  const exported = await crypto.subtle.exportKey("raw", derivedKey) as ArrayBuffer;
  const hashHex = [...new Uint8Array(exported)].map(b => b.toString(16).padStart(2, '0')).join('');
  const saltHex = [...salt].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, originalHash] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]);
  const derivedKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
  );
  const exported = await crypto.subtle.exportKey("raw", derivedKey) as ArrayBuffer;
  const hashHex = [...new Uint8Array(exported)].map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex === originalHash;
}

// Helper untuk JWT (HMAC SHA-256)
async function sign(data: any, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify(data));
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${payload}`));
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${header}.${payload}.${signatureB64}`;
}

export async function createToken(user: any, secret: string) {
  const payload = {
    sub: user.id,
    email: user.email,
    is_admin: user.is_admin || 0,
    exp: Math.floor(Date.now() / 1000) + (3650 * 24 * 60 * 60) // 10 tahun (Lifetime)
  };
  return sign(payload, secret);
}

export async function verifyToken(token: string, secret: string) {
  try {
    const [header, payload, signature] = token.split('.');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    
    // Re-create signature check
    const checkSig = signature.replace(/-/g, '+').replace(/_/g, '/');
    const signatureBin = Uint8Array.from(atob(checkSig), c => c.charCodeAt(0));
    
    const valid = await crypto.subtle.verify("HMAC", key, signatureBin, enc.encode(`${header}.${payload}`));
    if (!valid) return null;
    
    const data = JSON.parse(atob(payload));
    if (Date.now() / 1000 > data.exp) return null; // Expired
    return data;
  } catch (e) {
    return null;
  }
}

// Helper untuk Enkripsi/Dekripsi Data Sementara (AES-GCM)
export async function encryptData(text: string, secret: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret.padEnd(32).slice(0, 32)), "AES-GCM", false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));
    
    const ivHex = [...iv].map(b => b.toString(16).padStart(2, '0')).join('');
    const encryptedHex = [...new Uint8Array(encrypted)].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${ivHex}:${encryptedHex}`;
}

export async function decryptData(text: string, secret: string): Promise<string> {
    const [ivHex, encryptedHex] = text.split(':');
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const encrypted = new Uint8Array(encryptedHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret.padEnd(32).slice(0, 32)), "AES-GCM", false, ["decrypt"]);
    
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
    return new TextDecoder().decode(decrypted);
}
