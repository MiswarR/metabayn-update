use aes::Aes256;
use cbc::Encryptor;
use cbc::Decryptor;
use cbc::cipher::{BlockEncryptMut, BlockDecryptMut, KeyIvInit};
use cbc::cipher::block_padding::Pkcs7;
use rand::Rng;

type Aes256CbcEnc = Encryptor<Aes256>;
type Aes256CbcDec = Decryptor<Aes256>;

// Hardcoded key for demonstration (In production, use a secure key management system)
const KEY: &[u8; 32] = b"0123456789abcdef0123456789abcdef";

pub fn encrypt_token(token: &str) -> Result<String, String> {
    let mut iv = [0u8; 16];
    rand::rng().fill(&mut iv);

    let pt_len = token.len();
    let mut buf = vec![0u8; pt_len + 16]; // Buffer for padding
    buf[..pt_len].copy_from_slice(token.as_bytes());

    let ct = Aes256CbcEnc::new(KEY.into(), &iv.into())
        .encrypt_padded_mut::<Pkcs7>(&mut buf, pt_len)
        .map_err(|e| format!("Encryption error: {:?}", e))?;

    // Return IV + Ciphertext in hex
    let mut result = Vec::new();
    result.extend_from_slice(&iv);
    result.extend_from_slice(ct);
    
    Ok(hex::encode(result))
}

pub fn decrypt_token(encrypted_hex: &str) -> Result<String, String> {
    let encrypted_data = hex::decode(encrypted_hex).map_err(|e| format!("Hex decode error: {}", e))?;
    
    if encrypted_data.len() < 16 {
        return Err("Invalid data length".to_string());
    }

    let (iv, ct) = encrypted_data.split_at(16);
    let mut buf = ct.to_vec();

    let pt = Aes256CbcDec::new(KEY.into(), iv.into())
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|e| format!("Decryption error: {:?}", e))?;

    String::from_utf8(pt.to_vec()).map_err(|e| format!("UTF-8 error: {}", e))
}
