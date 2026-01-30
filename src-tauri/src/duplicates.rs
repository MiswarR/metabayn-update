use anyhow::{Result, anyhow};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use csv::Writer;
use image::DynamicImage;
use image::imageops::FilterType;
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

fn ext_is_image(p: &Path) -> bool {
    p.extension()
        .and_then(|s| s.to_str())
        .map(|e| matches!(e.to_lowercase().as_str(), "jpg"|"jpeg"|"png"|"webp"|"bmp"|"tif"|"tiff"))
        .unwrap_or(false)
}

fn ext_is_video(p: &Path) -> bool {
    p.extension()
        .and_then(|s| s.to_str())
        .map(|e| matches!(e.to_lowercase().as_str(), "mp4"|"mov"|"mkv"|"webm"|"avi"|"m2ts"|"3gp"|"wmv"))
        .unwrap_or(false)
}

fn resolve_ffmpeg() -> Option<PathBuf> {
    if let Ok(p) = which::which("ffmpeg") { return Some(p); }
    if let Ok(exe) = std::env::current_exe() {
        let base = exe.parent().unwrap_or(Path::new("."));
        let candidates = [
            base.join("resources").join("ffmpeg.exe"),
            base.join("ffmpeg.exe"),
            base.parent().unwrap_or(base).join("resources").join("ffmpeg.exe"),
            base.join("../../src-tauri/resources/ffmpeg.exe"),
            PathBuf::from("C:\\Windows\\ffmpeg.exe"),
        ];
        for c in &candidates { if c.exists() { return Some(c.clone()); } }
    }
    None
}

fn dhash64(img: &DynamicImage) -> u64 {
    let gray = img.to_luma8();
    let resized = image::imageops::resize(&gray, 9, 8, FilterType::Nearest);
    let mut hash: u64 = 0;
    let mut bit_index = 0;
    for y in 0..8 {
        for x in 0..8 {
            let a = resized.get_pixel(x, y)[0];
            let b = resized.get_pixel(x + 1, y)[0];
            let bit = if a > b { 1u64 } else { 0u64 };
            hash |= bit << (63 - bit_index);
            bit_index += 1;
        }
    }
    hash
}

fn hamming(a: u64, b: u64) -> u32 { (a ^ b).count_ones() }

fn hash_image_file(p: &Path) -> anyhow::Result<u64> {
    let img = image::open(p)?;
    Ok(dhash64(&img))
}

fn hash_video_file(p: &Path) -> anyhow::Result<u64> {
    println!("DEBUG: Hashing video: {:?}", p);
    let ffmpeg = resolve_ffmpeg().ok_or(anyhow!("FFmpeg not found"))?;
    let tmp = tempfile::Builder::new().suffix(".jpg").tempfile()?;
    let out_path = tmp.path().to_path_buf();
    
    // Attempt 1: Seek to 1s
    let status = Command::new(&ffmpeg)
        .args([
            "-nostdin", "-y",
            "-ss", "00:00:01",
            "-i", &p.to_string_lossy(),
            "-frames:v", "1",
            "-q:v", "2",
            &out_path.to_string_lossy(),
        ]);
    #[cfg(target_os = "windows")]
    status_cmd.creation_flags(0x08000000);
    
    let status = status_cmd.status()?;

    // Check if output exists and has size
    let success = status.success() && out_path.exists() && fs::metadata(&out_path).map(|m| m.len() > 0).unwrap_or(false);

    if !success {
        println!("DEBUG: First attempt failed for {:?}, trying fallback", p);
        // Fallback: try at start (0.1s)
        let mut retry_cmd = Command::new(&ffmpeg);
        retry_cmd.args([
                "-nostdin", "-y",
                "-ss", "00:00:00.1",
                "-i", &p.to_string_lossy(),
                "-frames:v", "1",
                "-q:v", "2",
                &out_path.to_string_lossy(),
            ]);
        #[cfg(target_os = "windows")]
        retry_cmd.creation_flags(0x08000000);
        
        let _ = retry_cmd.status();
    }
    
    if !out_path.exists() || fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0) == 0 { 
        println!("DEBUG: Failed to extract frame for {:?}", p);
        return Err(anyhow!("Failed to extract frame for hashing")); 
    }
    
    println!("DEBUG: Frame extracted, computing hash for {:?}", p);
    let img = image::open(&out_path)?;
    Ok(dhash64(&img))
}

pub async fn detect_duplicates(window: tauri::Window, input_folder: &str, auto_delete: bool, threshold: u8) -> Result<String> {
    let root = PathBuf::from(input_folder);
    println!("DEBUG: Starting duplicate scan on: {:?}", root);

    if !root.exists() { 
        println!("DEBUG: Folder not found: {:?}", root);
        return Err(anyhow!("Folder not found")); 
    }

    let review = root.join("_DUPLICATE_REVIEW");
    let _ = fs::create_dir_all(&review);
    let csv_path = root.join("duplicate_log.csv");

    let _ = window.emit("dup_log", serde_json::json!({
        "text": "Initializing scan...",
        "status": "processing"
    }));

    let mut total = 0usize;
    for e in WalkDir::new(&root).into_iter().flatten() {
        let p = e.path();
        if p.is_file() && (ext_is_image(p) || ext_is_video(p)) { total += 1; }
    }

    println!("DEBUG: Found {} files to scan", total);
    
    if total == 0 {
        let _ = window.emit("dup_log", serde_json::json!({
            "text": "No supported files (Images/Videos) found in this folder.",
            "status": "error"
        }));
        return Ok("No files found".to_string());
    }

    let mut writer = Writer::from_path(&csv_path)?;
    writer.write_record(["MASTER_FILE", "DUPLICATE_FILE", "MODE"]) ?;

    let mut processed = 0usize;
    let mut moved = 0usize;
    let mut deleted = 0usize;
    let mut hashes: HashMap<u64, PathBuf> = HashMap::new();

    for e in WalkDir::new(&root).into_iter().flatten() {
        let p = e.path();
        if !p.is_file() { continue; }
        if !(ext_is_image(p) || ext_is_video(p)) { continue; }
        if p.starts_with(&review) { continue; }

        processed += 1;
        println!("DEBUG: Processing file {}/{}: {:?}", processed, total, p);
        
        let _ = window.emit("dup_log", serde_json::json!({
            "text": format!("[{:}/{}] Checking: {}", processed, total, p.file_name().and_then(|s| s.to_str()).unwrap_or("")),
            "file": p.to_string_lossy().to_string(),
            "status": "processing"
        }));

        let h = match () {
            _ if ext_is_image(p) => match hash_image_file(p) { Ok(h) => h, Err(e) => { 
                println!("DEBUG: Image hash error: {:?}", e);
                let _ = window.emit("dup_log", serde_json::json!({
                    "text": format!("Skip image: {} error: {}", p.to_string_lossy(), e),
                    "file": p.to_string_lossy().to_string(),
                    "status": "error"
                })); continue; 
            } },
            _ if ext_is_video(p) => match hash_video_file(p) { Ok(h) => h, Err(e) => { 
                println!("DEBUG: Video hash error: {:?}", e);
                let _ = window.emit("dup_log", serde_json::json!({
                    "text": format!("Skip video: {} error: {}", p.to_string_lossy(), e),
                    "file": p.to_string_lossy().to_string(),
                    "status": "error"
                })); continue; 
            } },
            _ => { continue; }
        };

        let mut duplicate_found = false;
        for (saved_hash, saved_path) in hashes.clone().into_iter() {
            let dist = hamming(h, saved_hash) as u8;
            if auto_delete && dist == 0 {
                println!("DEBUG: Auto deleting identical: {:?}", p);
                let _ = fs::remove_file(p);
                deleted += 1;
                writer.write_record([saved_path.to_string_lossy().to_string(), p.to_string_lossy().to_string(), "AUTO_DELETE_IDENTICAL".to_string()]) ?;
                let _ = window.emit("dup_log", serde_json::json!({
                    "text": format!("→ DELETE identical: {}", p.to_string_lossy()),
                    "file": p.to_string_lossy().to_string(),
                    "status": "deleted"
                }));
                duplicate_found = true;
                break;
            } else if dist <= threshold {
                println!("DEBUG: Moving duplicate (dist {}): {:?}", dist, p);
                let mut target = review.join(p.file_name().unwrap_or_default());
                let mut idx = 1u32;
                while target.exists() {
                    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
                    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
                    let name = if ext.is_empty() { format!("{} ({})", stem, idx) } else { format!("{} ({}).{}", stem, idx, ext) };
                    target = review.join(name);
                    idx += 1;
                }
                let _ = fs::rename(p, &target).or_else(|_| fs::copy(p, &target).map(|_| fs::remove_file(p).unwrap_or(())));
                moved += 1;
                writer.write_record([saved_path.to_string_lossy().to_string(), p.to_string_lossy().to_string(), "REVIEW_MOVE".to_string()]) ?;
                let _ = window.emit("dup_log", serde_json::json!({
                    "text": format!("→ MOVE to review: {}", p.to_string_lossy()),
                    "file": p.to_string_lossy().to_string(),
                    "status": "deleted"
                }));
                duplicate_found = true;
                break;
            }
        }

        if !duplicate_found { 
            hashes.insert(h, p.to_path_buf()); 
            let _ = window.emit("dup_log", serde_json::json!({
                "text": format!("[{:}/{}] Checked: {}", processed, total, p.file_name().and_then(|s| s.to_str()).unwrap_or("")),
                "file": p.to_string_lossy().to_string(),
                "status": "success"
            }));
        }
    }

    writer.flush()?;

    let _ = window.emit("dup_log", serde_json::json!({
        "text": "",
        "status": "success"
    }));
    let _ = window.emit("dup_log", serde_json::json!({
        "text": "=== DONE ===",
        "status": "success"
    }));
    let _ = window.emit("dup_log", serde_json::json!({
        "text": format!("Moved to review       : {}", moved),
        "status": "success"
    }));
    let _ = window.emit("dup_log", serde_json::json!({
        "text": format!("Deleted (identical)  : {}", deleted),
        "status": "success"
    }));
    let _ = window.emit("dup_log", serde_json::json!({
        "text": format!("CSV log              : {}", csv_path.to_string_lossy()),
        "status": "success"
    }));
    Ok(format!("Review: {} | Deleted: {} | CSV: {}", moved, deleted, csv_path.to_string_lossy()))
}
