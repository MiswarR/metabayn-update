const DEFAULT_SECRET = 'user-secret'
const SALT = 'metabayn-api-key-salt-v1'

function b64Encode(bytes: Uint8Array) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function b64Decode(b64: string) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKey(secret: string) {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(SALT), iterations: 120_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptApiKey(apiKey: string, secret: string = DEFAULT_SECRET) {
  const key = await deriveKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(apiKey))
  return { iv: b64Encode(iv), data: b64Encode(new Uint8Array(ciphertext)) }
}

export async function decryptApiKey(data: string, iv: string, secret: string = DEFAULT_SECRET) {
  const key = await deriveKey(secret)
  const ivBytes = b64Decode(iv)
  const dataBytes = b64Decode(data)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, dataBytes)
  return new TextDecoder().decode(plain)
}
