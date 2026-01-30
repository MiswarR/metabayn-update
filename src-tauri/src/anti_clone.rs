use anyhow::Result;
use sha2::{Sha256, Digest};
use std::process::Command;
use base64::prelude::*;

pub async fn machine_hash() -> Result<String> {
  // Try stable Registry MachineGuid first
  let reg = Command::new("reg")
      .args(["query", "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"])
      .output()
      .ok();

  let mut raw_id = String::new();

  if let Some(output) = reg {
      let s = String::from_utf8_lossy(&output.stdout).to_string();
      if let Some(idx) = s.find("REG_SZ") {
          let guid = s[idx+6..].trim().to_string();
          if !guid.is_empty() {
              raw_id = guid;
          }
      }
  }

  // Fallback to old method if Registry fails (for some reason)
  if raw_id.is_empty() {
      let cpu = Command::new("wmic").args(["cpu","get","ProcessorId"]).output().ok();
      let hdd = Command::new("wmic").args(["diskdrive","get","SerialNumber"]).output().ok();
      let a = cpu.as_ref().map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
      let b = hdd.as_ref().map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
      raw_id = format!("{}{}", a, b);
  }

  let mut hasher = Sha256::new();
  hasher.update(raw_id.as_bytes());
  let out = hasher.finalize();
  Ok(BASE64_STANDARD.encode(out))
}

