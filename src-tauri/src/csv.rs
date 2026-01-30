use anyhow::Result;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

pub fn append_row(path: &str, row: Vec<String>) -> Result<()> {
    if let Some(parent) = Path::new(path).parent() {
        fs::create_dir_all(parent)?;
    }
    
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
  
  // Escape CSV fields
  let escaped: Vec<String> = row.iter().map(|s| {
      if s.contains(',') || s.contains('"') || s.contains('\n') {
          format!("\"{}\"", s.replace("\"", "\"\""))
      } else {
          s.clone()
      }
  }).collect();
  
  let line = escaped.join(",");
  f.write_all(line.as_bytes())?;
  f.write_all(b"\n")?;
  Ok(())
}

