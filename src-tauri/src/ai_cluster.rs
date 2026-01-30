use anyhow::{Result, anyhow};
use std::process::{Command, Stdio};
use std::io::{BufReader, BufRead};
use tauri::Window;
use std::thread;
use std::path::Path;

pub async fn run_clustering(window: Window, input_folder: &str, threshold: f64) -> Result<String> {
    // Resolve script path
    let mut script_path = Path::new("src-tauri/scripts/ai_cluster.py").to_path_buf();
    
    if !script_path.exists() {
        // Try relative to current exe if needed (for bundled app scenarios, though this is dev specific)
        if let Ok(cwd) = std::env::current_dir() {
            let p = cwd.join("src-tauri").join("scripts").join("ai_cluster.py");
            if p.exists() {
                script_path = p;
            } else {
                 let p2 = cwd.join("scripts").join("ai_cluster.py");
                 if p2.exists() {
                     script_path = p2;
                 }
            }
        }
    }
    
    if !script_path.exists() {
        // Absolute path fallback for safety in this specific environment
        script_path = Path::new("d:\\Proyek App\\metabayn-Tauri\\tauri\\src-tauri\\scripts\\ai_cluster.py").to_path_buf();
    }

    if !script_path.exists() {
        return Err(anyhow!("Script not found. Please ensure src-tauri/scripts/ai_cluster.py exists."));
    }

    let _ = window.emit("ai_cluster_log", serde_json::json!({
        "text": format!("Starting AI Cluster script: {:?}", script_path),
        "status": "processing"
    }));

    let mut cmd = Command::new("python");
    cmd.arg(script_path)
       .arg("--folder")
       .arg(input_folder)
       .arg("--threshold")
       .arg(threshold.to_string());

    // Setup stdout/stderr capture
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let mut child = cmd.spawn().map_err(|e| anyhow!("Failed to start python process: {}. Make sure python is installed and in PATH.", e))?;

    let stdout = child.stdout.take().ok_or(anyhow!("Failed to open stdout"))?;
    let stderr = child.stderr.take().ok_or(anyhow!("Failed to open stderr"))?;

    let window_clone = window.clone();
    
    // Stream stdout
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for l in reader.lines().map_while(Result::ok) {
            // Try parsing JSON
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&l) {
                 let _ = window_clone.emit("ai_cluster_log", json);
            } else {
                 // Raw text
                 let _ = window_clone.emit("ai_cluster_log", serde_json::json!({
                     "text": l,
                     "status": "processing"
                 }));
            }
        }
    });

    // Stream stderr
    let window_clone2 = window.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for l in reader.lines().map_while(Result::ok) {
             // Ignore some common stderr noise from python libraries if needed
             if l.trim().is_empty() { continue; }
             
             let _ = window_clone2.emit("ai_cluster_log", serde_json::json!({
                 "text": format!("[STDERR] {}", l),
                 "status": "error"
             }));
        }
    });

    // We wait for the process in a separate thread to not block async runtime? 
    // Actually, child.wait() is blocking. Since this function is async, we should use tokio process or spawn_blocking.
    // But Command is std::process::Command. 
    // If I block here, I block the async executor thread.
    // Better to use tokio::process::Command or task::spawn_blocking.
    // Given the imports, I'm using std::process. I should switch to spawn_blocking.
    
    let res = tauri::async_runtime::spawn_blocking(move || {
        child.wait()
    }).await??;

    if res.success() {
        Ok("Clustering completed successfully".to_string())
    } else {
        Err(anyhow!("Process exited with code {:?}", res.code()))
    }
}
