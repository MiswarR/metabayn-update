use anyhow::Result;
use walkdir::{WalkDir, DirEntry};
#[cfg(target_os = "windows")]
use std::os::windows::fs::MetadataExt;

fn is_hidden(entry: &DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy();
    // Basic name checks
    if name.starts_with(".") || name.starts_with("~") || name == "Thumbs.db" || name == "desktop.ini" || name == "$RECYCLE.BIN" || name == "System Volume Information" || name == "__MACOSX" || name == "node_modules" {
        return true;
    }
    
    // Extension checks for common junk/temp files
    if name.ends_with(".tmp") || name.ends_with(".bak") || name.ends_with(".log") || name.ends_with(".dat") || name.ends_with(".ini") {
        return true;
    }
    
    // Windows specific hidden attribute check
    #[cfg(target_os = "windows")]
    if let Ok(metadata) = entry.metadata() {
        let attributes = metadata.file_attributes();
        // 0x02 is the Hidden attribute
        if (attributes & 0x02) != 0 {
            return true;
        }
    }
    
    false
}

#[allow(dead_code)]
pub async fn scan_supported(input: &str, exclude_paths: Option<Vec<String>>) -> Result<Vec<String>> {
  let mut out = Vec::new();
  let excludes = exclude_paths.unwrap_or_default();
  
  // Normalize excludes for consistent comparison
  let normalized_excludes: Vec<String> = excludes.iter().map(|e| {
      e.replace("/", "\\").trim_end_matches('\\').to_lowercase()
  }).collect();

  for e in WalkDir::new(input).max_depth(1).into_iter().filter_entry(|e| !is_hidden(e)).filter_map(|e| e.ok()) {
    let p_str = e.path().to_string_lossy().to_string().replace("/", "\\");
    let p_lower = p_str.to_lowercase();
    
    // Check if this path starts with any exclude path
    let mut skip = false;
    for ex in &normalized_excludes {
        if !ex.is_empty() && p_lower.starts_with(ex) { 
            skip = true; 
            break; 
        }
    }
    if skip { continue; }

    if e.file_type().is_file() {
      // Filter out empty files only. 1KB limit was too aggressive.
      if let Ok(meta) = e.metadata() {
          if meta.len() == 0 { continue; } 
      }
      
      if is_supported(&p_str) { out.push(p_str); }
    }
  }
  println!("Scanned folder: '{}'. Found {} files.", input, out.len());
  Ok(out)
}

#[allow(dead_code)]
fn is_supported(p: &str) -> bool {
  let l = p.to_lowercase();
  l.ends_with(".jpg")||l.ends_with(".jpeg")||l.ends_with(".png")||l.ends_with(".webp")||l.ends_with(".tiff")||l.ends_with(".bmp")||l.ends_with(".mp4")||l.ends_with(".mov")||l.ends_with(".mkv")||l.ends_with(".avi")||l.ends_with(".webm")
}

