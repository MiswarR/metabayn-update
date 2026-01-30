use anyhow::{Result, anyhow};
use std::process::Command;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::fs;

pub async fn write_video(req: &crate::api::VideoMetaReq) -> Result<Option<String>> {
    if !req.auto_embed { return Ok(None); }
    
    let source = Path::new(&req.file);
    if !source.exists() {
        return Err(anyhow!("Source file not found: {}", req.file));
    }

    let mut target = if let Some(ref out) = req.output_file {
        PathBuf::from(out)
    } else {
        source.to_path_buf()
    };
    if let Ok(settings) = crate::settings::load_settings() {
        if settings.selection_enabled && !settings.output_folder.is_empty() {
            let parent = target.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default().to_lowercase();
            let root = settings.output_folder.trim_end_matches(['\\', '/']).to_lowercase();
            let approved_marker = if settings.output_folder.contains('\\') { "\\approved".to_string() } else { "/approved".to_string() };
            let rejected_marker = if settings.output_folder.contains('\\') { "\\rejected".to_string() } else { "/rejected".to_string() };
            let is_under_root = parent.starts_with(&root);
            let in_special = parent.contains(&approved_marker) || parent.contains(&rejected_marker);
            if is_under_root && !in_special {
                let sep = if settings.output_folder.contains('\\') { "\\" } else { "/" };
                let name = target.file_name().and_then(|s| s.to_str()).unwrap_or("");
                target = if settings.output_folder.ends_with(sep) {
                    PathBuf::from(format!("{}approved{}{}", settings.output_folder, sep, name))
                } else {
                    PathBuf::from(format!("{}{}approved{}{}", settings.output_folder, sep, sep, name))
                };
            }
        }
    }

    if target != source {
        if let Some(parent) = target.parent() { let _ = fs::create_dir_all(parent); }
        // Copy with retry
        let mut copied = false;
        for _ in 0..3 {
            if fs::copy(source, &target).is_ok() { copied = true; break; }
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
        if !copied { return Err(anyhow!("Failed to copy video to output")); }
        
        // Remove source file after successful copy
        if let Err(e) = fs::remove_file(source) {
            eprintln!("Warning: Failed to remove source file {:?}: {}", source, e);
        }
    }

    // Strategy 1: Embed Metadata into Video
    // We stick to standard fields. Windows Explorer might not show tags, but Microstock will read them.
    if let Err(e1) = run_exiftool(&target, req) {
        println!("ExifTool failed: {}. Retrying with FFmpeg...", e1);
        
        if let Err(e2) = run_ffmpeg(&target, req) {
            return Err(anyhow!("Both ExifTool and FFmpeg failed. ExifTool: {}. FFmpeg: {}", e1, e2));
        }
    }

    // Rename File if enabled
    let new_path = crate::metadata::apply_file_rename(&target, &req.title)?;
    
    if let Some(ref np) = new_path {
        return Ok(Some(np.to_string_lossy().to_string()));
    }

    Ok(None)
}

fn run_exiftool(path: &Path, req: &crate::api::VideoMetaReq) -> Result<()> {
    let exiftool = resolve_exiftool().ok_or(anyhow!("ExifTool not found"))?;
    
    let mut args = vec![
        "-overwrite_original".to_string(),
        "-m".to_string(),
        "-api".to_string(), "LargeFileSupport=1".to_string(),
        "-sep".to_string(), ";".to_string(),
        "-charset".to_string(), "filename=utf8".to_string(),
    ];

    // 1. Title
    args.push(format!("-Title={}", req.title));
    args.push(format!("-XPTitle={}", req.title));
    args.push(format!("-ItemList:Title={}", req.title));

    // 2. Description (Clean, no tags appended)
    args.push(format!("-Description={}", req.description));
    args.push(format!("-ImageDescription={}", req.description));
    args.push(format!("-ItemList:Description={}", req.description)); 
    args.push(format!("-Caption-Abstract={}", req.description));
    args.push(format!("-Headline={}", req.description));
    // args.push(format!("-Subject={}", req.description)); // Removing this to avoid conflict with Keywords Subject

    // 3. Comment
    args.push(format!("-Comment={}", req.description));
    args.push(format!("-UserComment={}", req.description));
    args.push(format!("-XPComment={}", req.description));

    // Embed Extra Metadata
    let cats = req.category.clone().unwrap_or_default();
    let extras_obj = serde_json::json!({
        "categories": cats,
        "editorial": "No",
        "mature": "No",
        "illustration": "No"
    });
    let extras = extras_obj.to_string();
    args.push(format!("-SpecialInstructions={}", extras));
    args.push(format!("-XMP-photoshop:Instructions={}", extras));
    
    // 4. Keywords (Standard Atoms for Stock Sites/Adobe)
    let keywords_str = req.keywords.join(";");
    args.push(format!("-Keywords={}", keywords_str));
    args.push(format!("-XPKeywords={}", keywords_str));
    args.push(format!("-ItemList:Keyword={}", keywords_str));
    args.push(format!("-Microsoft:Keywords={}", keywords_str));
    args.push(format!("-Subject={}", keywords_str)); // Standard XMP Subject for Tags

    args.push(path.to_string_lossy().to_string());

    let mut cmd = Command::new(exiftool);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    
    let out = cmd.output()?;
        
    if !out.status.success() {
        return Err(anyhow!("{}", String::from_utf8_lossy(&out.stderr)));
    }
    Ok(())
}

fn run_ffmpeg(path: &Path, req: &crate::api::VideoMetaReq) -> Result<()> {
    let ffmpeg = resolve_ffmpeg().ok_or(anyhow!("FFmpeg not found"))?;
    
    let temp_name = format!("temp_{}_{}", 
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis(), 
        path.file_name().unwrap().to_string_lossy());
    let temp = path.parent().unwrap().join(temp_name);
    
    let args = vec![
        "-i".to_string(), path.to_string_lossy().to_string(),
        "-c".to_string(), "copy".to_string(),
        "-metadata".to_string(), format!("title={}", req.title),
        "-metadata".to_string(), format!("description={}", req.description),
        "-metadata".to_string(), format!("subtitle={}", req.description),
        "-metadata".to_string(), format!("comment={}", req.description),
        "-metadata".to_string(), format!("synopsis={}", req.description),
        // Still write standard keywords atom for players that support it
        "-metadata".to_string(), format!("keywords={}", req.keywords.join(";")),
        "-y".to_string(),
        temp.to_string_lossy().to_string(),
    ];

    let mut cmd = Command::new(ffmpeg);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let out = cmd.output()?;

    if !out.status.success() {
        let _ = fs::remove_file(&temp);
        return Err(anyhow!("{}", String::from_utf8_lossy(&out.stderr)));
    }

    if fs::rename(&temp, path).is_err() {
        fs::copy(&temp, path)?;
        fs::remove_file(&temp)?;
    }

    Ok(())

}

pub fn extract_frame(path: &str) -> Result<Vec<u8>> {
    let ffmpeg = resolve_ffmpeg().ok_or(anyhow!("FFmpeg not found"))?;
    
    // Extract frame at 1s, scale to max 768px (maintain aspect ratio)
    // -ss 1: seek to 1 second (avoid black start frames)
    // -vframes 1: get one frame
    // -vf scale: resize
    // -f image2pipe: output format
    // -c:v mjpeg: jpeg codec
    let args = vec![
        "-ss".to_string(), "1".to_string(),
        "-i".to_string(), path.to_string(),
        "-vframes".to_string(), "1".to_string(),
        "-vf".to_string(), "scale='if(gt(iw,ih),768,-1)':'if(gt(iw,ih),-1,768)'".to_string(),
        "-f".to_string(), "image2pipe".to_string(),
        "-c:v".to_string(), "mjpeg".to_string(),
        "-q:v".to_string(), "15".to_string(), // Lower quality (higher val) to keep size small (<50KB)
        "-".to_string(),
    ];

    let mut cmd = Command::new(ffmpeg);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let out = cmd.output()?;

    if !out.status.success() {
        // Fallback: try seeking to 0s if 1s fails (short video)
        let args_retry = vec![
            "-i".to_string(), path.to_string(),
            "-vframes".to_string(), "1".to_string(),
            "-vf".to_string(), "scale='if(gt(iw,ih),768,-1)':'if(gt(iw,ih),-1,768)'".to_string(),
            "-f".to_string(), "image2pipe".to_string(),
            "-c:v".to_string(), "mjpeg".to_string(),
            "-q:v".to_string(), "15".to_string(),
            "-".to_string(),
        ];
        
        let mut cmd_retry = Command::new(resolve_ffmpeg().unwrap());
        cmd_retry.args(args_retry);
        #[cfg(target_os = "windows")]
        cmd_retry.creation_flags(0x08000000);
        
        let out_retry = cmd_retry.output()?;
            
        if !out_retry.status.success() {
             return Err(anyhow!("FFmpeg extraction failed: {}", String::from_utf8_lossy(&out.stderr)));
        }
        return Ok(out_retry.stdout);
    }

    Ok(out.stdout)
}

fn resolve_exiftool() -> Option<PathBuf> {
    if let Ok(p) = which::which("exiftool") { return Some(p); }
    if let Ok(exe) = std::env::current_exe() {
        let base = exe.parent().unwrap_or_else(|| Path::new("."));
        
        #[cfg(target_os = "windows")]
        let candidates = [
            base.join("resources").join("exiftool.exe"),
            base.join("exiftool.exe"),
            base.parent().unwrap_or(base).join("resources").join("exiftool.exe"),
            base.join("../../src-tauri/resources/exiftool.exe"),
            PathBuf::from("C:\\Windows\\exiftool.exe"),
        ];

        #[cfg(not(target_os = "windows"))]
        let candidates = [
            base.join("resources").join("exiftool"),
            base.join("exiftool"),
            base.parent().unwrap_or(base).join("resources").join("exiftool"),
            base.join("../../src-tauri/resources/exiftool"),
        ];

        for c in &candidates { if c.exists() { return Some(c.clone()); } }
    }
    None
}

fn resolve_ffmpeg() -> Option<PathBuf> {
    if let Ok(p) = which::which("ffmpeg") { return Some(p); }
    if let Ok(exe) = std::env::current_exe() {
        let base = exe.parent().unwrap_or_else(|| Path::new("."));
        
        #[cfg(target_os = "windows")]
        let candidates = [
            base.join("resources").join("ffmpeg.exe"),
            base.join("ffmpeg.exe"),
            base.parent().unwrap_or(base).join("resources").join("ffmpeg.exe"),
            base.join("../../src-tauri/resources/ffmpeg.exe"),
            PathBuf::from("C:\\Windows\\ffmpeg.exe"),
        ];

        #[cfg(not(target_os = "windows"))]
        let candidates = [
            base.join("resources").join("ffmpeg"),
            base.join("ffmpeg"),
            base.parent().unwrap_or(base).join("resources").join("ffmpeg"),
            base.join("../../src-tauri/resources/ffmpeg"),
        ];

        for c in &candidates { if c.exists() { return Some(c.clone()); } }
    }
    None
}
