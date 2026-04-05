use anyhow::{Result, anyhow, Context};
use serde::{Serialize, Deserialize};
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::fs;
use base64::prelude::*;
use tokio::time::Duration;
use image::{GenericImageView, imageops::FilterType};
// use image::DynamicImage;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::io::Cursor;
use image::io::Reader as ImageReader;

// use tauri::Manager;

#[derive(Serialize, Deserialize, Clone)]
pub struct Generated { 
    pub file: String, 
    pub file_path: String,
    pub title: String, 
    pub description: String, 
    pub keywords: Vec<String>, 
    pub category: String, 
    pub source: String,
    pub selection_status: Option<String>,
    pub failed_checks: Option<Vec<String>>, 
    pub reason: Option<String>,
    pub gen_provider: Option<String>,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub cost: Option<f64>,
    pub app_balance_after: Option<f64>,
    pub app_tokens_deducted: Option<f64>,
    // Detailed Usage
    pub vision_input_tokens: Option<u32>,
    pub vision_output_tokens: Option<u32>,
    pub text_input_tokens: Option<u32>,
    pub text_output_tokens: Option<u32>,
    pub vision_cost: Option<f64>,
    pub text_cost: Option<f64>,
    pub vision_model: Option<String>,
    pub text_model: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct TokenUsage {
    #[serde(alias = "promptTokenCount")]
    pub prompt_tokens: u32,
    #[serde(alias = "candidatesTokenCount", alias = "completionTokenCount")]
    pub completion_tokens: u32,
    #[serde(alias = "totalTokenCount")]
    pub total_tokens: u32,
}

struct ImageCache { map: HashMap<String, (String, String)>, order: VecDeque<String>, capacity: usize }
static IMAGE_B64_CACHE: OnceLock<Mutex<ImageCache>> = OnceLock::new();
static CANCEL_GENERATE_BATCH: AtomicBool = AtomicBool::new(false);
static ACTIVE_GENERATE_BATCH: AtomicUsize = AtomicUsize::new(0);
static STOP_CSV_TOOLS_SCHEDULING: AtomicBool = AtomicBool::new(false);

pub fn request_cancel_generate_batch() {
    CANCEL_GENERATE_BATCH.store(true, Ordering::SeqCst);
}

pub fn clear_cancel_generate_batch() {
    CANCEL_GENERATE_BATCH.store(false, Ordering::SeqCst);
}

pub fn request_stop_csv_tools_scheduling() {
    STOP_CSV_TOOLS_SCHEDULING.store(true, Ordering::SeqCst);
}

pub fn clear_stop_csv_tools_scheduling() {
    STOP_CSV_TOOLS_SCHEDULING.store(false, Ordering::SeqCst);
}

pub fn active_generate_batch_count() -> usize {
    ACTIVE_GENERATE_BATCH.load(Ordering::SeqCst)
}

fn cancel_requested() -> bool {
    CANCEL_GENERATE_BATCH.load(Ordering::SeqCst)
}

fn csv_tools_stop_requested() -> bool {
    STOP_CSV_TOOLS_SCHEDULING.load(Ordering::SeqCst)
}

struct ActiveBatchGuard;
impl ActiveBatchGuard {
    fn new() -> Self {
        ACTIVE_GENERATE_BATCH.fetch_add(1, Ordering::SeqCst);
        Self
    }
}
impl Drop for ActiveBatchGuard {
    fn drop(&mut self) {
        ACTIVE_GENERATE_BATCH.fetch_sub(1, Ordering::SeqCst);
    }
}

fn cache_get(key: &str) -> Option<(String, String)> {
    let c = IMAGE_B64_CACHE.get_or_init(|| Mutex::new(ImageCache { map: HashMap::new(), order: VecDeque::new(), capacity: 12 }));
    let mut cache = c.lock().ok()?;
    if let Some(v) = cache.map.get(key).cloned() {
        if let Some(pos) = cache.order.iter().position(|k| k == key) { cache.order.remove(pos); }
        cache.order.push_back(key.to_string());
        return Some(v);
    }
    None
}

// --- NATURAL SORT HELPERS ---

#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum Chunk {
    Text(String),
    Number(u64),
}

fn split_natural(s: &str) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    let mut current_text = String::new();
    let mut current_num = String::new();
    let mut parsing_num = false;

    for c in s.chars() {
        if c.is_ascii_digit() {
            if !parsing_num {
                if !current_text.is_empty() {
                    chunks.push(Chunk::Text(current_text.clone()));
                    current_text.clear();
                }
                parsing_num = true;
            }
            current_num.push(c);
        } else {
            if parsing_num {
                if !current_num.is_empty() {
                    if let Ok(n) = current_num.parse::<u64>() {
                         chunks.push(Chunk::Number(n));
                    } else {
                         // Fallback for huge numbers
                         chunks.push(Chunk::Text(current_num.clone()));
                    }
                    current_num.clear();
                }
                parsing_num = false;
            }
            current_text.push(c);
        }
    }
    
    if parsing_num && !current_num.is_empty() {
         if let Ok(n) = current_num.parse::<u64>() {
             chunks.push(Chunk::Number(n));
         } else {
             chunks.push(Chunk::Text(current_num));
         }
    } else if !current_text.is_empty() {
        chunks.push(Chunk::Text(current_text));
    }
    
    chunks
}

pub async fn generate_csv_from_folder(
    window: tauri::Window,
    input_folder: &str,
    output_folder: &str,
    api_key: Option<String>,
    token: Option<String>,
    auto_stop_enabled: Option<bool>,
    auto_stop_fail_threshold: Option<u32>,
    request_timeout_sec: Option<u64>,
) -> Result<String> {
    clear_cancel_generate_batch();
    clear_stop_csv_tools_scheduling();
    let exiftool = resolve_exiftool().ok_or(anyhow!("ExifTool not found"))?;
    
    // Run ExifTool on the folder
    let _ = window.emit("csv_log", serde_json::json!({
        "text": format!("Scanning folder: {}...", input_folder),
        "file": input_folder,
        "status": "processing"
    }));
    let args = vec![
        "-json".to_string(),
        // Title candidates
        "-Title".to_string(),
        "-XPTitle".to_string(),
        "-ObjectName".to_string(),
        "-Headline".to_string(),
        // Description candidates
        "-Description".to_string(),
        "-ImageDescription".to_string(),
        "-XPComment".to_string(),
        "-Caption-Abstract".to_string(),
        // Keywords candidates
        "-Keywords".to_string(),
        "-Subject".to_string(),
        "-XPKeywords".to_string(),
        "-LastKeywordXMP".to_string(),
        "-TagsList".to_string(), // Common in video
        // Custom
        "-SpecialInstructions".to_string(),
        "-XMP:Instructions".to_string(),
        "-ext".to_string(), "jpg".to_string(),
        "-ext".to_string(), "jpeg".to_string(),
        "-ext".to_string(), "png".to_string(),
        "-ext".to_string(), "mp4".to_string(),
        "-ext".to_string(), "mov".to_string(),
        input_folder.to_string(),
    ];

    let mut cmd = Command::new(&exiftool);
    cmd.args(args);
    cmd.args(["-api", "LargeFileSupport=1"]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = cmd.output()?;

    if !output.status.success() {
        return Err(anyhow!("ExifTool failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    
    // Log Scan Success
    let _ = window.emit("csv_log", serde_json::json!({
        "text": format!("Scan complete. Found files in: {}", input_folder),
        "file": input_folder,
        "status": "success"
    }));

    let json_str = String::from_utf8_lossy(&output.stdout);
    let mut items: Vec<serde_json::Value> = serde_json::from_str(&json_str)?;
    let _ = window.emit("csv_log", serde_json::json!({
        "code": "TOOL_TOTAL",
        "tool": "csv_gen",
        "total": items.len(),
        "text": "",
        "file": input_folder,
        "status": "processing"
    }));

    // Sort items naturally by SourceFile
    items.sort_by(|a, b| {
        let path_a = a["SourceFile"].as_str().unwrap_or("");
        let path_b = b["SourceFile"].as_str().unwrap_or("");
        split_natural(path_a).cmp(&split_natural(path_b))
    });

    if items.is_empty() {
        return Err(anyhow!("No files with metadata found in folder"));
    }

    // CHECK & FILL MISSING SHUTTERSTOCK METADATA (AI)
    // Categories, Editorial, Mature, Illustration
    let settings = crate::settings::load_settings().unwrap_or_default();
    let model = settings.default_model.clone();
    let cm_raw = settings.connection_mode.trim().to_lowercase();
    let api_key_present = api_key.as_ref().map(|k| !k.trim().is_empty()).unwrap_or(false);
    let effective_connection_mode = if cm_raw == "direct" || cm_raw == "standard" || cm_raw == "standard_ai" {
        "direct".to_string()
    } else if cm_raw == "gateway" || cm_raw == "ai_gateway" {
        "gateway".to_string()
    } else if api_key_present {
        "direct".to_string()
    } else {
        "gateway".to_string()
    };
    let effective_token = if effective_connection_mode == "gateway" {
        token.unwrap_or(settings.auth_token.clone())
    } else {
        String::new()
    };
    
    // Construct BatchReq for AI calls
    let req_template = crate::api::BatchReq {
        files: vec![],
        model: model.clone(),
        token: effective_token,
        retries: settings.retry_count,
        title_min_words: 0, title_max_words: 0,
        description_min_chars: 0, description_max_chars: 0,
        keywords_min_count: 0, keywords_max_count: 0,
        banned_words: String::new(),
        max_threads: 1,
        connection_mode: effective_connection_mode,
        api_key: api_key.clone(),
        provider: settings.ai_provider.clone(),
    };

    // use tokio::sync::Semaphore;
    use std::sync::Arc;
    use tokio::sync::Semaphore;

    let csv_auto_stop_enabled = auto_stop_enabled.unwrap_or(true);
    let csv_auto_stop_fail_threshold = auto_stop_fail_threshold
        .unwrap_or(5)
        .clamp(1, 50) as usize;
    let csv_request_timeout_sec = request_timeout_sec.unwrap_or(180).clamp(15, 900);
    let fail_streak = Arc::new(tokio::sync::Mutex::new(0usize));

    let _ = window.emit("csv_log", serde_json::json!({
        "code": "CSV_CFG",
        "text": format!(
            "[Sistem] CSV AI: mode={}, provider={}, model={}, timeout={} dtk, auto_stop={}{}",
            req_template.connection_mode,
            req_template.provider,
            model,
            csv_request_timeout_sec,
            if csv_auto_stop_enabled { "on" } else { "off" },
            if csv_auto_stop_enabled { format!(", ambang={}", csv_auto_stop_fail_threshold) } else { "".to_string() }
        ),
        "file": input_folder,
        "status": "processing"
    }));

    let max_threads = if settings.max_threads > 0 { settings.max_threads as usize } else { 1 };
    let sem = Arc::new(Semaphore::new(max_threads));
    
    // We need to process items concurrently but also collect them back to write CSV
    // However, CSV writing happens AFTER loop. The loop updates `items`.
    // Mutating `items` in parallel is tricky.
    // Better strategy: Use a channel to collect updates, or map-reduce.
    // Or just use a loop with spawn and collect results.
    
    let mut tasks = Vec::new();
    let _items_len = items.len();

    // Clone necessary data for tasks
    let _window_arc = Arc::new(Mutex::new(window.clone())); // Window is cloneable but let's wrap if needed. Actually tauri::Window is cheap clone.
    // tauri::Window is Send + Sync + Clone.
    
    // We need to move `items` into tasks? No, we need to update them.
    // We can't share &mut items across threads easily without Mutex.
    // Let's iterate and spawn tasks that return the updated Item (or None if no change).
    
    // Actually, `items` contains the metadata. We need to update `SpecialInstructions` in it.
    // Let's clone items for reading, and collect results.
    
    for (idx, item) in items.iter().enumerate() {
        if csv_tools_stop_requested() {
            let _ = window.emit("csv_log", serde_json::json!({
                "code": "CSV_STOP_REQUESTED",
                "text": "Stop requested.",
                "file": input_folder,
                "status": "warning"
            }));
            break;
        }
        let item_clone = item.clone();
        let sem_clone = sem.clone();
        let window = window.clone();
        let _settings = settings.clone();
        let model = model.clone();
        let req_template = req_template.clone();
        let exiftool = exiftool.clone();
        let fail_streak = fail_streak.clone();
        
        let task = tokio::spawn(async move {
            let _permit = match sem_clone.acquire().await {
                Ok(p) => p,
                Err(_) => return (idx, None),
            };

            if csv_tools_stop_requested() {
                return (idx, None);
            }
            
            let path_str = item_clone["SourceFile"].as_str().unwrap_or("").to_string();
            if path_str.is_empty() { return (idx, None); }
            
            let filename = Path::new(&path_str).file_name().unwrap_or(std::ffi::OsStr::new("")).to_string_lossy().to_string();
            
            // Log Processing
            let _ = window.emit("csv_log", serde_json::json!({
                "text": format!("Processing {}...", filename),
                "file": filename.clone(),
                "status": "processing"
            }));

            let mut instructions = item_clone["SpecialInstructions"].as_str().unwrap_or("").to_string();
            if instructions.is_empty() {
                 instructions = item_clone["Instructions"].as_str().unwrap_or("").to_string();
            }
            
            let needs_fill = if instructions.is_empty() {
                true
            } else if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&instructions) {
                     let cats = parsed["categories"].as_str().unwrap_or("").trim();
                     cats.is_empty() ||
                     cats == "Miscellaneous, Objects" ||
                     parsed["editorial"].as_str().is_none() ||
                     parsed["mature"].as_str().is_none() ||
                     parsed["illustration"].as_str().is_none()
            } else {
                     true
            };

            if needs_fill {
                if csv_tools_stop_requested() {
                    return (idx, None);
                }
                let _ = window.emit("csv_log", serde_json::json!({
                    "text": format!("> {} missing metadata. AI identifying...", filename),
                    "file": filename.clone(),
                    "status": "processing"
                }));
                
                // CALL AI
                match prepare_image_data(&path_str, &model).await {
                    Ok((b64, mime)) => {
                        let prompt = "Analyze this image for Shutterstock metadata. Provide:
                        1. Two most relevant Categories (comma separated).
                           MUST be chosen ONLY from this list and MUST match EXACT spelling character-by-character:
                           [Abstract, Animals/Wildlife, Arts, Backgrounds/Textures, Beauty/Fashion, Buildings/Landmarks, Business/Finance, Celebrities, Education, Food and drink, Healthcare/Medical, Holidays, Industrial, Interiors, Miscellaneous, Nature, Objects, Parks/Outdoor, People, Religion, Science, Signs/Symbols, Sports/Recreation, Technology, Transportation, Vintage]
                        2. Editorial (Yes/No).
                        3. Mature Content (Yes/No).
                        4. Illustration (Yes/No).
                        
                        Output ONLY valid JSON: { \"categories\": \"Cat1, Cat2\", \"editorial\": \"No\", \"mature\": \"No\", \"illustration\": \"No\" }";
    
                        match call_ai_base(&model, prompt, Some((b64, mime)), &req_template, csv_request_timeout_sec).await {
                            Ok((content, usage, used_model, _cost, _balance_after, _tokens_deducted)) => {
                                let clean_json = content.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
                                
                                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(clean_json) {
                                     let cats_raw = if let Some(arr) = parsed["categories"].as_array() {
                                         arr.iter()
                                             .filter_map(|v| v.as_str())
                                             .collect::<Vec<_>>()
                                             .join(", ")
                                     } else {
                                         parsed["categories"].as_str().unwrap_or("").to_string()
                                     };
                                     let (cats_str, _cat_issues) = normalize_shutterstock_categories(&cats_raw);
    
                                     let new_extras = serde_json::json!({
                                         "categories": cats_str,
                                         "editorial": parsed["editorial"].as_str().unwrap_or("No"),
                                         "mature": parsed["mature"].as_str().unwrap_or("No"),
                                         "illustration": parsed["illustration"].as_str().unwrap_or("No")
                                     });
                                     let new_instr = new_extras.to_string();
                                     
                                     // Write to file immediately with RETRY
                                     let mut et_attempts = 0;
                                     let et_max = req_template.retries + 1;
                                     loop {
                                         et_attempts += 1;
                                         let mut cmd = Command::new(&exiftool);
                                     cmd.args([
                                            "-overwrite_original",
                                            "-m",
                                            "-api", "LargeFileSupport=1",
                                            "-ignoreMinorErrors",
                                            &format!("-SpecialInstructions={}", new_instr),
                                            &format!("-XMP-photoshop:Instructions={}", new_instr),
                                            &path_str
                                        ]);
                                     #[cfg(target_os = "windows")]
                                     cmd.creation_flags(0x08000000);

                                     let out_et = cmd.output();
                                         
                                         if let Ok(o) = out_et {
                                             if o.status.success() { break; }
                                         }
                                         
                                         if et_attempts >= et_max {
                                             let _ = window.emit("csv_log", serde_json::json!({
                                                 "text": format!("> {} Failed to write metadata (ExifTool)", filename),
                                                 "file": filename.clone(),
                                                 "status": "warning"
                                             }));
                                             break;
                                         }
                                         tokio::time::sleep(Duration::from_millis(500)).await;
                                     }
                                     
                                     let mut detail_msg = String::new();
                                     if let Some(u) = usage.clone() {
                                         let cost_usd = _cost.unwrap_or(0.0);
                                         let cost_idr = cost_usd * 16300.0;
                                         let final_model = used_model.clone().unwrap_or(model.clone());
                                         detail_msg = format!(
                                             "-- Full Generation (Vision + Text) --\nModel: {}\nIn: {} | Out: {}\nCost: ${:.6} / Rp {:.2}\nSelection: n/a", 
                                             final_model, u.prompt_tokens, u.completion_tokens, cost_usd, cost_idr
                                         );
                                     }
    
                                     let _ = window.emit("csv_log", serde_json::json!({
                                        "text": format!("> {} metadata updated.", filename),
                                        "file": filename.clone(),
                                        "detail": detail_msg,
                                        "status": "success"
                                    }));

                                    if let Ok(mut st) = fail_streak.try_lock() {
                                        *st = 0;
                                    } else {
                                        let mut st = fail_streak.lock().await;
                                        *st = 0;
                                    }
                                    
                                    // Return updated fields to merge back to items
                                    return (idx, Some(new_instr));
                                } else {
                                    let _ = window.emit("csv_log", serde_json::json!({
                                        "text": format!("> {} AI response parse error: {}", filename, clean_json),
                                        "file": filename.clone(),
                                        "status": "error"
                                    }));

                                    let mut st = fail_streak.lock().await;
                                    *st = st.saturating_add(1);
                                    if csv_auto_stop_enabled && *st >= csv_auto_stop_fail_threshold {
                                        request_stop_csv_tools_scheduling();
                                        let _ = window.emit("csv_log", serde_json::json!({
                                            "code": "CSV_AUTO_STOP",
                                            "text": format!("Auto-stop: {}x gagal beruntun. Melewati file berikutnya.", csv_auto_stop_fail_threshold),
                                            "file": filename.clone(),
                                            "status": "warning"
                                        }));
                                    }
                                }
                            },
                            Err(e) => {
                                 let _ = window.emit("csv_log", serde_json::json!({
                                     "text": format!("> {} AI Call Failed: {}", filename, e),
                                     "file": filename.clone(),
                                     "status": "error"
                                 }));

                                 let mut st = fail_streak.lock().await;
                                 *st = st.saturating_add(1);
                                 if csv_auto_stop_enabled && *st >= csv_auto_stop_fail_threshold {
                                     request_stop_csv_tools_scheduling();
                                     let _ = window.emit("csv_log", serde_json::json!({
                                         "code": "CSV_AUTO_STOP",
                                         "text": format!("Auto-stop: {}x gagal beruntun. Melewati file berikutnya.", csv_auto_stop_fail_threshold),
                                         "file": filename.clone(),
                                         "status": "warning"
                                     }));
                                 }
                            }
                        }
                    },
                    Err(e) => {
                        let _ = window.emit("csv_log", serde_json::json!({
                            "text": format!("> {} Image Prep Failed: {}", filename, e),
                            "file": filename.clone(),
                            "status": "error"
                        }));

                        let mut st = fail_streak.lock().await;
                        *st = st.saturating_add(1);
                        if csv_auto_stop_enabled && *st >= csv_auto_stop_fail_threshold {
                            request_stop_csv_tools_scheduling();
                            let _ = window.emit("csv_log", serde_json::json!({
                                "code": "CSV_AUTO_STOP",
                                "text": format!("Auto-stop: {}x gagal beruntun. Melewati file berikutnya.", csv_auto_stop_fail_threshold),
                                "file": filename.clone(),
                                "status": "warning"
                            }));
                        }
                    }
                }
            } else {
                let _ = window.emit("csv_log", serde_json::json!({
                    "text": format!("> {} metadata complete. Skipping AI.", filename),
                    "file": filename.clone(),
                    "status": "skipped"
                }));

                if let Ok(mut st) = fail_streak.try_lock() {
                    *st = 0;
                } else {
                    let mut st = fail_streak.lock().await;
                    *st = 0;
                }
            }
            
            (idx, None)
        });
        tasks.push(task);
    }
    
    // Await all tasks and update items
    for t in tasks {
        if let Ok((idx, Some(new_instr))) = t.await {
            if let Some(obj) = items[idx].as_object_mut() {
                    obj.insert("SpecialInstructions".to_string(), serde_json::Value::String(new_instr.clone()));
                    obj.insert("Instructions".to_string(), serde_json::Value::String(new_instr));
                }
        }
    }

    // Prepare CSV Content (Synchronous part)


    // Prepare CSV Content
    // Use folder name for filename to allow overwriting
    let folder_name = Path::new(input_folder)
        .file_name()
        .unwrap_or(std::ffi::OsStr::new(""))
        .to_string_lossy()
        .to_string();
    let safe_name = if folder_name.is_empty() { "Result".to_string() } else { folder_name };
    
    // Metabay CSV
    // Header: Filename,Title,Description,Keywords
    let mut mb_csv = String::from("Filename,Title,Description,Keywords\n");
    
    // Shutterstock CSV
    // Header: Filename,Description,Keywords,Categories,Editorial,Mature Content,Illustration
    let mut ss_csv = String::from("Filename,Description,Keywords,Categories,Editorial,Mature Content,Illustration\n");

    for item in items {
        let path_str = item["SourceFile"].as_str().unwrap_or("");
        let filename = Path::new(path_str).file_name().unwrap_or(std::ffi::OsStr::new("")).to_string_lossy();
        
        // Smart Field Extraction
        let title = item["Title"].as_str()
            .or(item["XPTitle"].as_str())
            .or(item["ObjectName"].as_str())
            .or(item["Headline"].as_str())
            .unwrap_or("");

        let desc = item["Description"].as_str()
            .or(item["ImageDescription"].as_str())
            .or(item["Caption-Abstract"].as_str())
            .or(item["XPComment"].as_str())
            .unwrap_or("");
        
        // Keywords Strategy: Check multiple fields, merge if needed or prioritize
        // Prioritize: Keywords > Subject > XPKeywords > TagsList
        let mut raw_keywords = Vec::new();
        
        let candidate_keys = ["Keywords", "Subject", "XPKeywords", "TagsList", "LastKeywordXMP"];

        for key in candidate_keys {
             if !raw_keywords.is_empty() { break; }

             if let Some(val) = item.get(key) {
                if let Some(arr) = val.as_array() {
                    for v in arr {
                        if let Some(s) = v.as_str() { raw_keywords.push(s.to_string()); }
                    }
                } else if let Some(s) = val.as_str() {
                    // Split by common delimiters just in case
                    for part in s.split(&[',', ';'][..]) {
                        let trimmed = part.trim();
                        if !trimmed.is_empty() { raw_keywords.push(trimmed.to_string()); }
                    }
                }
             }
        }

        // Deduplicate and Join
        raw_keywords.sort();
        raw_keywords.dedup();
        let keywords = raw_keywords.join(",");

        // Parse SpecialInstructions for Extras
        let mut instructions = item["SpecialInstructions"].as_str().unwrap_or("");
        if instructions.is_empty() {
             instructions = item["Instructions"].as_str().unwrap_or("");
        }
        if instructions.is_empty() {
             instructions = item["XMP:Instructions"].as_str().unwrap_or(""); // Try explicit XMP
        }

        let (cats_raw, editorial, mature, illustration) = if !instructions.is_empty() {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(instructions) {
                 let c = if let Some(arr) = parsed["categories"].as_array() {
                     arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(", ")
                 } else {
                     parsed["categories"].as_str().unwrap_or("").to_string()
                 };
                 
                 (
                    c,
                    parsed["editorial"].as_str().unwrap_or("No").to_string(),
                    parsed["mature"].as_str().unwrap_or("No").to_string(),
                    parsed["illustration"].as_str().unwrap_or("No").to_string()
                 )
            } else {
                 // Fallback: If instructions is not JSON, assume it's just categories or raw data
                 // But for Shutterstock CSV, we need separated fields.
                 // We'll put raw instructions in Categories if it looks like categories, else empty.
                 let raw = instructions.trim();
                 // Simple heuristic: if it contains commas and no braces, it might be categories
                 if !raw.starts_with('{') && raw.contains(',') {
                     (raw.to_string(), "No".to_string(), "No".to_string(), "No".to_string())
                 } else {
                     ("".to_string(), "No".to_string(), "No".to_string(), "No".to_string())
                 }
            }
        } else {
             ("".to_string(), "No".to_string(), "No".to_string(), "No".to_string())
        };

        let cats = if cats_raw.trim().is_empty() {
            cats_raw
        } else {
            normalize_shutterstock_categories(&cats_raw).0
        };

        if cats.is_empty() {
             let _ = window.emit("csv_log", format!("Warning: No Category found for {}", filename));
        }

        // Escape CSV fields properly
        let esc = |s: &str| -> String {
            if s.contains(',') || s.contains('"') || s.contains('\n') {
                format!("\"{}\"", s.replace("\"", "\"\""))
            } else {
                s.to_string()
            }
        };

        if title.trim().is_empty() && desc.trim().is_empty() {
            let _ = window.emit("csv_log", serde_json::json!({
                "code": "CSV_MISSING_TITLE_DESC",
                "text": format!("> {} FAILED: Title & Description empty.", filename),
                "file": filename.to_string(),
                "status": "error"
            }));
            continue;
        }

        mb_csv.push_str(&format!("{},{},{},{}\n", esc(&filename), esc(title), esc(desc), esc(&keywords)));
        let ss_desc = title;
        ss_csv.push_str(&format!("{},{},{},{},{},{},{}\n", esc(&filename), esc(ss_desc), esc(&keywords), esc(&cats), esc(&editorial), esc(&mature), esc(&illustration)));
    }

    // Write Files
    let out_path = Path::new(output_folder);
    if !out_path.exists() {
        fs::create_dir_all(out_path)?;
    }

    let mb_filename = format!("{}_Metabayn.csv", safe_name);
    let ss_filename = format!("{}_Shutterstock.csv", safe_name);

    fs::write(out_path.join(&mb_filename), mb_csv)?;
    fs::write(out_path.join(&ss_filename), ss_csv)?;

    Ok(format!("Generated CSVs: {} and {}", mb_filename, ss_filename))
}

fn cache_set(key: String, value: (String, String)) {
    let c = IMAGE_B64_CACHE.get_or_init(|| Mutex::new(ImageCache { map: HashMap::new(), order: VecDeque::new(), capacity: 12 }));
    if let Ok(mut cache) = c.lock() {
        if cache.map.contains_key(&key) {
            cache.map.insert(key.clone(), value);
            if let Some(pos) = cache.order.iter().position(|k| k == &key) { cache.order.remove(pos); }
            cache.order.push_back(key);
        } else {
            cache.map.insert(key.clone(), value);
            cache.order.push_back(key);
            if cache.order.len() > cache.capacity {
                if let Some(old_key) = cache.order.pop_front() { cache.map.remove(&old_key); }
            }
        }
    }
}

// --- PROMPTS ---

fn effective_generation_bounds(req: &crate::api::BatchReq) -> (u32, u32, u32, u32, u32, u32) {
    let tmin = req.title_min_words;
    let tmax = std::cmp::max(req.title_max_words, tmin);

    let kw_min = req.keywords_min_count;
    let kw_max = std::cmp::max(req.keywords_max_count, kw_min);

    let dmax = req.description_max_chars;
    let dmin = if dmax == 0 { 0 } else { std::cmp::min(req.description_min_chars, dmax) };

    (tmin, tmax, dmin, dmax, kw_min, kw_max)
}

fn get_primary_prompt(req: &crate::api::BatchReq, context: Option<&str>) -> String {
    let (tmin, tmax, dmin, dmax, kw_min, kw_max) = effective_generation_bounds(req);
    let desc_rule = if dmax == 0 {
        "Description: DISABLED. Set description to an empty string \"\".".to_string()
    } else {
        format!("Description: {} to {} characters.", dmin, dmax)
    };

    let mut p = format!(
        "Generate metadata for stock media.
Rules:
- Title: {} to {} words.
- {} 
- Keywords: {} to {} tags. Single words only, comma separated.
- Banned characters: `~@#$%^&*()_+=-/\\][{{}}|';\":?/><` (Only . and , allowed).
- Output Format: JSON with keys 'title', 'description', 'keywords', 'category'.
- Category: Choose EXACTLY TWO relevant categories from this list, separated by a comma.
          You MUST provide TWO categories. If only one is perfectly relevant, choose the second most relevant one.
          NEVER provide just one category.
          MUST match EXACT spelling character-by-character.
          List: [Abstract, Animals/Wildlife, Arts, Backgrounds/Textures, Beauty/Fashion, Buildings/Landmarks, Business/Finance, Celebrities, Education, Food and drink, Healthcare/Medical, Holidays, Industrial, Interiors, Miscellaneous, Nature, Objects, Parks/Outdoor, People, Religion, Science, Signs/Symbols, Sports/Recreation, Technology, Transportation, Vintage]
          Example: \"Nature, Transportation\"
        ",
        tmin, tmax,
        desc_rule,
        kw_min, kw_max
    );

    if !req.banned_words.is_empty() {
        let mut banned: Vec<String> = req
            .banned_words
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect();
        banned.sort();
        banned.dedup();

        if !banned.is_empty() {
            let list_len = banned.len();
            let joined = banned.join(", ");
            if list_len <= 20 && joined.chars().count() <= 180 {
                p.push_str(&format!("\n- Keywords MUST NOT include any of these words: {}\n", joined));
            } else {
                let preview = banned.into_iter().take(20).collect::<Vec<_>>().join(", ");
                p.push_str(&format!("\n- Keywords banned words (partial): {} (and more)\n", preview));
                p.push_str("- IMPORTANT: The app will enforce this for keywords even if omitted.\n");
            }
        }
    }

    if let Some(ctx) = context {
        p.push_str(&format!("\nBased on this visual description:\n{}\n", ctx));
    } else {
        p.push_str("\nAnalyze the attached image and generate the metadata.\n");
    }
    
    p
}

fn build_selection_checks(settings: &crate::settings::AppSettings) -> Vec<String> {
    let mut checks: Vec<String> = Vec::new();

    if settings.check_text_or_text_like {
        let mut text_rules = Vec::new();
        if settings.text_filter_gibberish { text_rules.push("gibberish (meaningless/random letters)"); }
        if settings.text_filter_non_english { text_rules.push("non-english (valid language other than English)"); }
        if settings.text_filter_irrelevant { text_rules.push("irrelevant-text (readable but unrelated to image)"); }
        if settings.text_filter_relevant { text_rules.push("relevant-text (ALL detected text - strict mode)"); }
        if !text_rules.is_empty() {
            checks.push(format!("Reject if text type matches: {:?}", text_rules));
        }
    }

    if settings.check_brand_logo { checks.push("brand_logo: Reject if specific trademarked logo is visible (ignore clock hands, generic shapes, zippers)".to_string()); }
    if settings.check_watermark { checks.push("watermark: Reject if digital watermark/copyright stamp visible (ignore natural text)".to_string()); }

    if settings.check_human_presence {
        let mut human_rules = Vec::new();
        if settings.human_filter_full_face { human_rules.push("full_body_perfect: Full human body visible with distinct face"); }
        if settings.human_filter_no_head { human_rules.push("no_head: Human body present but head cut off/missing"); }
        if settings.human_filter_partial_perfect { human_rules.push("partial_perfect: Realistic/perfect human body parts (hands, legs, torso)"); }
        if settings.human_filter_partial_defect { human_rules.push("partial_defect: Deformed/distorted/unnatural human body parts"); }
        if settings.human_filter_back_view { human_rules.push("back_view: Human subject facing away from camera"); }
        if settings.human_filter_unclear { human_rules.push("unclear_hybrid: Distorted/hybrid/alien-like human subject"); }
        if settings.human_filter_face_only { human_rules.push("face_only: Close-up human face without significant body"); }
        if settings.human_filter_nudity { human_rules.push("nudity_nsfw: Nudity, sexual content, or inappropriate material"); }
        if !human_rules.is_empty() {
            checks.push(format!("Reject if human matches: {:?}", human_rules));
        }
    }

    if settings.check_animal_presence {
        let mut animal_rules = Vec::new();
        if settings.animal_filter_full_face { animal_rules.push("full_body_perfect: Complete realistic animal body"); }
        if settings.animal_filter_no_head { animal_rules.push("no_head: Animal body visible but head missing/cut off"); }
        if settings.animal_filter_partial_perfect { animal_rules.push("partial_perfect: Realistic animal parts (paws, tails, torso)"); }
        if settings.animal_filter_partial_defect { animal_rules.push("partial_defect: Deformed/distorted animal body parts"); }
        if settings.animal_filter_back_view { animal_rules.push("back_view: Animal seen from behind"); }
        if settings.animal_filter_unclear { animal_rules.push("unclear_hybrid: Distorted/hybrid/monster-like animal"); }
        if settings.animal_filter_face_only { animal_rules.push("face_only: Close-up animal face without body"); }
        if settings.animal_filter_nudity { animal_rules.push("mating_genitals: Animals mating or visible genitals"); }
        if !animal_rules.is_empty() {
            checks.push(format!("Reject if animal matches: {:?}", animal_rules));
        }
    }

    if settings.check_deformed_object { checks.push("deformed_object: Reject if primary subject is anatomically incorrect or physically impossible".to_string()); }
    if settings.check_unrecognizable_subject { checks.push("unrecognizable: Reject if main subject is indistinguishable/too abstract".to_string()); }
    if settings.check_famous_trademark { checks.push("famous_trademark: Reject if famous IP/logo (Disney, Marvel, Apple, etc) is clearly visible".to_string()); }

    checks
}

fn get_primary_prompt_with_selection(req: &crate::api::BatchReq, settings: &crate::settings::AppSettings, context: Option<&str>) -> String {
    let mut p = get_primary_prompt(req, context);
    let checks = build_selection_checks(settings);
    p.push_str(&format!(
        "\nStock compliance selection (in the SAME response):\nEnabled checks:\n{:#?}\n\nIf ANY check fails, selection.status MUST be 'rejected'.\nIf no checks are enabled, selection.status MUST be 'accepted'.\nOutput Format: JSON with keys 'title', 'description', 'keywords', 'category', 'selection'.\nselection must be: {{\"status\":\"accepted\"|\"rejected\",\"reason\":\"...\",\"failed_checks\":[\"code1\",...]}}.\nIMPORTANT: Use ONLY the short code prefix (part before colon) for selection.failed_checks.",
        checks
    ));
    p
}

fn is_quota_or_rate_limit_error(lower: &str) -> bool {
    lower.contains("resource_exhausted")
        || lower.contains("too many requests")
        || lower.contains("rate limit")
        || lower.contains("ratelimit")
        || lower.contains("quota exceeded")
        || lower.contains("exceeded your current quota")
        || lower.contains("generate_content_free_tier")
        || lower.contains("\"code\": 429")
        || lower.contains("http 429")
}

fn is_safety_block_error(lower: &str) -> bool {
    lower.contains("safety")
        || lower.contains("blocked")
        || lower.contains("content policy")
        || lower.contains("policy violation")
        || lower.contains("moderation")
        || lower.contains("nsfw")
        || lower.contains("nudity")
        || lower.contains("sexual")
}

// --- AI CALLS ---

async fn call_ai_base(
    model: &str, 
    prompt: &str, 
    image_b64: Option<(String, String)>, 
    req: &crate::api::BatchReq,
    request_timeout_sec: u64,
) -> Result<(String, Option<TokenUsage>, Option<String>, Option<f64>, Option<f64>, Option<f64>)> {
    
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request_timeout_sec.clamp(15, 900)))
        .build()?;
    let settings = crate::settings::load_settings().unwrap_or_default();
    
    // Construct System/User messages
    let messages = if let Some((b64, mime)) = &image_b64 {
        serde_json::json!([
            { "role": "system", "content": "Respond with ONLY a JSON object. No code fences. No extra text." },
            { 
                "role": "user", 
                "content": [
                    { "type": "text", "text": prompt },
                    { "type": "image_url", "image_url": { "url": format!("data:{};base64,{}", mime, b64), "detail": "low" } }
                ] 
            }
        ])
    } else {
        serde_json::json!([
            { "role": "system", "content": "Respond with ONLY a JSON object. No code fences. No extra text." },
            { "role": "user", "content": prompt }
        ])
    };

    let current_model = model.to_string();
    // Retry Loop
    let max_attempts = (req.retries as usize).saturating_add(1).max(1);
    for attempt in 0..max_attempts {
        if req.connection_mode == "direct" {
            let raw_key = req.api_key.as_ref().ok_or(anyhow!("Missing API key"))?;
            let api_key = raw_key.trim();
            
            // Determine URL based on model or provider (OpenAI vs Gemini) or API Key format
            let is_key_google = api_key.starts_with("AIza");
            
            let is_gemini = current_model.to_lowercase().contains("gemini") 
                || req.provider.to_lowercase().contains("gemini")
                || is_key_google;
            
            let url = if is_gemini {
                "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
            } else {
                "https://api.openai.com/v1/chat/completions"
            };
            
            let resp = client.post(url)
               .header("Authorization", format!("Bearer {}", api_key))
               .json(&serde_json::json!({
                   "model": current_model,
                   "messages": messages,
                   "temperature": 0.2
               })).send().await;

             match resp {
                Ok(r) => {
                    if !r.status().is_success() {
                        let status = r.status();
                        let err_text = r.text().await.unwrap_or_default();
                        // Retry on any error if attempts remain
                        if attempt < max_attempts - 1 {
                            let exp = std::cmp::min(attempt as u32, 4);
                            let backoff_secs = std::cmp::min(30u64, 2u64.saturating_mul(1u64 << exp));
                            tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
                            continue; 
                        }
                        return Err(anyhow!("Direct API Error (HTTP {}, URL: {}): {}", status, url, err_text));
                    }
                    let res_json: serde_json::Value = r.json().await?;
                    let content = res_json.pointer("/choices/0/message/content").and_then(|s| s.as_str()).unwrap_or("").to_string();
                    let usage: Option<TokenUsage> = res_json.get("usage").and_then(|u| serde_json::from_value(u.clone()).ok());
                    return Ok((content, usage, Some("direct".into()), None, None, None));
                },
                Err(e) => {
                    if attempt < max_attempts - 1 { 
                        let exp = std::cmp::min(attempt as u32, 4);
                        let backoff_secs = std::cmp::min(30u64, 2u64.saturating_mul(1u64 << exp));
                        tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
                        continue; 
                    }
                    return Err(anyhow!("Direct API Network Error: {}", e));
                }
             }
        } else {
            // Server Mode
            let url = settings.server_url.clone();
            let base = url.trim_end_matches('/');
            let (b64, mime) = image_b64.clone().unwrap_or_default();
            
            let is_selection = prompt.starts_with("You are an AI Image Quality Inspector");
            let body = serde_json::json!({
                "model": current_model,
                "messages": messages, // For OpenAI/Groq
                "prompt": prompt,     // For Gemini
                "image": b64,
                "mimeType": mime,
                "selectionMode": is_selection,
                "retries": req.retries
            });

            let resp = client.post(format!("{}/ai/generate", base))
                .header("Authorization", format!("Bearer {}", req.token))
                .json(&body)
                .send()
                .await;

            match resp {
                Ok(r) => {
                    if !r.status().is_success() {
                        let status = r.status();
                        let err_text = r.text().await.unwrap_or_default();
                        let lower = err_text.to_lowercase();
                        let is_transient =
                            status.as_u16() == 429
                                || status.as_u16() >= 500
                                || lower.contains("queue timeout")
                                || lower.contains("system busy")
                                || lower.contains("bad gateway")
                                || lower.contains("gateway timeout")
                                || lower.contains("timeout")
                                || lower.contains("temporarily unavailable")
                                || lower.contains("service unavailable")
                                || lower.contains("try again");
                         if is_transient && attempt < max_attempts - 1 {
                            let exp = std::cmp::min(attempt as u32, 4);
                            let backoff_secs = std::cmp::min(30u64, 2u64.saturating_mul(1u64 << exp));
                            tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
                            continue; 
                        }
                        return Err(anyhow!("API Error (HTTP {}): {}", status, err_text));
                    }
                    let res_json: serde_json::Value = r.json().await?;
                    let content = res_json.get("result").and_then(|s| s.as_str()).ok_or(anyhow!("No result"))?.to_string();
                    
                    // Parse usage - Support both nested object and top-level fields
                    let usage = if let (Some(i), Some(o)) = (
                        res_json.get("input_tokens").and_then(|v| v.as_u64()), 
                        res_json.get("output_tokens").and_then(|v| v.as_u64())
                    ) {
                        Some(TokenUsage {
                            prompt_tokens: i as u32,
                            completion_tokens: o as u32,
                            total_tokens: (i + o) as u32,
                        })
                    } else {
                        res_json.get("usage")
                            .or(res_json.get("usageMetadata"))
                            .or(res_json.get("token_usage"))
                            .and_then(|u| serde_json::from_value(u.clone()).ok())
                    };
                        
                    let provider = res_json.pointer("/metadata/provider")
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_string());
                        
                    // Cost might be top-level or in metadata
                    let cost = res_json.get("cost")
                        .or(res_json.get("cost_usd"))
                        .or(res_json.pointer("/metadata/cost"))
                        .and_then(|v| v.as_f64());

                    let balance_after = res_json.get("app_balance_after")
                        .or(res_json.get("user_balance_after"))
                        .or(res_json.pointer("/metabayn/user_balance_after"))
                        .or(res_json.pointer("/metabayn/user_balance"))
                        .or(res_json.get("remaining_balance"))
                        .or(res_json.get("remaining"))
                        .or(res_json.pointer("/metadata/remaining"))
                        .and_then(|v| v.as_f64().or_else(|| v.as_u64().map(|x| x as f64)));

                    let tokens_deducted = res_json.get("app_tokens_deducted")
                        .or(res_json.get("tokens_deducted"))
                        .or(res_json.pointer("/metabayn/tokens_deducted"))
                        .and_then(|v| v.as_f64().or_else(|| v.as_u64().map(|x| x as f64)));
                    
                    return Ok((content, usage, provider, cost, balance_after, tokens_deducted));
                },
                Err(e) => {
                    if attempt < max_attempts - 1 { 
                        let exp = std::cmp::min(attempt as u32, 4);
                        let backoff_secs = std::cmp::min(30u64, 2u64.saturating_mul(1u64 << exp));
                        tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
                        continue; 
                    }
                    return Err(anyhow!("Server API Network Error: {}", e));
                }
            }
        }
    }
    
    Err(anyhow!("All retry attempts failed."))
}

fn add_usage(acc_u: &mut TokenUsage, acc_c: &mut f64, u: Option<TokenUsage>, c: Option<f64>) {
    if let Some(usg) = u {
        acc_u.prompt_tokens += usg.prompt_tokens;
        acc_u.completion_tokens += usg.completion_tokens;
        acc_u.total_tokens += usg.total_tokens;
    }
    if let Some(cost) = c { *acc_c += cost; }
}

fn is_vision_like_model_id(model_id: &str) -> bool {
    let id = model_id.trim().to_lowercase();
    if id.is_empty() { return false; }
    if id == "openrouter/free" { return false; }
    id.contains("vision")
        || id.contains("/vl")
        || id.contains("-vl")
        || id.contains("pixtral")
        || id.contains("gpt-4o")
        || id.contains("gpt-4.1")
        || id.contains("gpt-4.5")
        || id.contains("gpt-5")
        || id.contains("gemini")
        || id.contains("claude-4")
        || id.contains("claude-3")
        || id.contains("llava")
        || id.contains("cogvlm")
        || id.contains("qwen-vl")
        || id.contains("qwen3-vl")
        || id.contains("molmo")
        || id.contains("moondream")
        || id.contains("internvl")
}

fn is_vision_model_for_provider(provider: &str, model_id: &str) -> bool {
    let p = provider.trim().to_lowercase();
    let id = model_id.trim().to_lowercase();
    if p.is_empty() || id.is_empty() { return false; }
    if p == "gemini" || p.contains("google") {
        if !id.starts_with("gemini") { return false; }
        if id.contains("embedding") { return false; }
        return true;
    }
    if p == "openai" {
        let ok =
            id.contains("vision")
                || id.contains("gpt-4o")
                || id.contains("gpt-4.1")
                || id.contains("gpt-4.5")
                || id.contains("gpt-5");
        if !ok { return false; }
        if id.contains("audio") || id.contains("realtime") || id.contains("transcribe") || id.contains("whisper") { return false; }
        if id.contains("embedding") || id.contains("tts") { return false; }
        return true;
    }
    if p == "openrouter" {
        return is_vision_like_model_id(&id);
    }
    is_vision_like_model_id(&id)
}

pub async fn generate_batch(req: &crate::api::BatchReq) -> Result<Vec<Generated>> {
  let _active_guard = ActiveBatchGuard::new();
  let settings = crate::settings::load_settings().unwrap_or_default();
  let selection_on = settings.selection_enabled;
  let selection_order = settings.selection_order.as_str();
  let vision_model = &req.model;
  let provider = req.provider.clone();

  if !is_vision_model_for_provider(&provider, vision_model) {
      return Err(anyhow!(format!("Model tidak mendukung vision: provider={} model={}. Silakan pilih model vision di Settings.", provider, vision_model)));
  }

  let mut out = Vec::new();
  let mut used_titles: HashSet<String> = HashSet::new();

  let mut files = req.files.clone();
  files.sort_by_key(|a| split_natural(a));

  for f in &files {
      if cancel_requested() {
          return Err(anyhow!("CANCELLED_BY_USER"));
      }
      // Check file existence
      if !std::path::Path::new(f).exists() { continue; }

      let mut file_balance_after: Option<f64> = None;
      let mut file_tokens_deducted: f64 = 0.0;

      // Prepare Image (Vision)
      if cancel_requested() {
          return Err(anyhow!("CANCELLED_BY_USER"));
      }
      let (img_b64, mime) = prepare_image_data(f, vision_model).await?;
      let img_data = Some((img_b64, mime));

      let mut generated: Option<Generated> = None;
      let mut last_error = String::new();
      
      // Track accumulated usage and cost
      let mut acc_vis_usage = TokenUsage::default();
      let mut acc_vis_cost = 0.0;
      let acc_text_usage = TokenUsage::default();
      let acc_text_cost = 0.0;

      // --- LOGIC FLOW ---
      
    // Use Vision Model Logic (Case A & B)
    if selection_on && selection_order == "before" {
        // CASE B: Single pass (Metadata + Selection)
        let prompt = get_primary_prompt_with_selection(req, &settings, None);
        if cancel_requested() { return Err(anyhow!("CANCELLED_BY_USER")); }
        match call_ai_base(vision_model, &prompt, img_data.clone(), req, 120).await {
            Ok((txt, usage, prov, cost, balance_after, tokens_deducted)) => {
                add_usage(&mut acc_vis_usage, &mut acc_vis_cost, usage, cost);
                if let Some(b) = balance_after { file_balance_after = Some(b); }
                if let Some(d) = tokens_deducted { file_tokens_deducted += d; }

                let temp_gen = parse_generated_json(&txt, f, vision_model, prov, acc_vis_usage.clone(), acc_vis_cost, acc_text_usage.clone(), acc_text_cost, req, Some(vision_model.to_string()), None);
                if let Some(g) = temp_gen {
                    let sel_status = g.selection_status.clone().unwrap_or_default();
                    let sel_reason = g.reason.clone().unwrap_or_default();
                    let sel_failed = g.failed_checks.clone().unwrap_or_default();

                    if sel_status.is_empty() {
                        last_error = "Selection missing in response".to_string();
                    }

                    if sel_status == "accepted" {
                        generated = Some(g);
                    } else if !sel_status.is_empty() {
                        last_error = format!("Rejected: {}", sel_reason);
                        let total_input = acc_vis_usage.prompt_tokens + acc_text_usage.prompt_tokens;
                        let total_output = acc_vis_usage.completion_tokens + acc_text_usage.completion_tokens;
                        let total_cost = acc_vis_cost + acc_text_cost;
                        generated = Some(Generated {
                            file: f.clone(),
                            file_path: f.clone(),
                            title: "ERROR".into(),
                            description: format!("Rejected: {}", sel_reason),
                            keywords: vec![],
                            category: String::new(),
                            source: vision_model.to_string(),
                            selection_status: Some("rejected".into()),
                            failed_checks: Some(sel_failed),
                            reason: Some(sel_reason),
                            gen_provider: None,
                            input_tokens: Some(total_input),
                            output_tokens: Some(total_output),
                            cost: Some(total_cost),
                            app_balance_after: None,
                            app_tokens_deducted: None,
                            vision_input_tokens: Some(acc_vis_usage.prompt_tokens),
                            vision_output_tokens: Some(acc_vis_usage.completion_tokens),
                            vision_cost: Some(acc_vis_cost),
                            text_input_tokens: Some(acc_text_usage.prompt_tokens),
                            text_output_tokens: Some(acc_text_usage.completion_tokens),
                            text_cost: Some(acc_text_cost),
                            vision_model: Some(vision_model.to_string()),
                            text_model: None,
                        });
                    } else if last_error.is_empty() {
                        last_error = "Selection missing in response".to_string();
                    }
                } else {
                    last_error = "Failed to parse JSON".to_string();
                }
            },
            Err(e) => last_error = e.to_string(),
        }
    } else {
        // CASE A & Selection After: Primary Only (OpenAI/Gemini) -> Vision
        // If Selection After, we generate first then check.
        let prompt = if selection_on && selection_order == "after" {
            get_primary_prompt_with_selection(req, &settings, None)
        } else {
            get_primary_prompt(req, None)
        };
        if cancel_requested() { return Err(anyhow!("CANCELLED_BY_USER")); }
        match call_ai_base(vision_model, &prompt, img_data.clone(), req, 120).await {
            Ok((txt, usage, prov, cost, balance_after, tokens_deducted)) => {
                add_usage(&mut acc_vis_usage, &mut acc_vis_cost, usage, cost);
                if let Some(b) = balance_after { file_balance_after = Some(b); }
                if let Some(d) = tokens_deducted { file_tokens_deducted += d; }
                let mut temp_gen = parse_generated_json(&txt, f, vision_model, prov, acc_vis_usage.clone(), acc_vis_cost, acc_text_usage.clone(), acc_text_cost, req, Some(vision_model.to_string()), None);
                
          if let Some(ref mut _g) = temp_gen {
              if selection_on && selection_order == "after" {
                   let sel_status = temp_gen.as_ref().and_then(|g| g.selection_status.clone()).unwrap_or_default();
                   let sel_reason = temp_gen.as_ref().and_then(|g| g.reason.clone()).unwrap_or_default();
                   let sel_failed = temp_gen.as_ref().and_then(|g| g.failed_checks.clone()).unwrap_or_default();

                   if sel_status.is_empty() {
                       last_error = "Selection missing in response".to_string();
                   }

                   if sel_status == "accepted" {
                       if let Some(ref mut g2) = temp_gen {
                           g2.selection_status = Some("accepted".into());
                       }
                       generated = temp_gen;
                   } else if !sel_status.is_empty() {
                       if let Some(ref mut g_data) = temp_gen {
                           enforce_generation_contract(g_data, req);
                           let meta_req = crate::api::ImageMetaReq {
                               file: f.clone(),
                               output_file: None,
                               title: g_data.title.clone(),
                               description: g_data.description.clone(),
                               keywords: g_data.keywords.clone(),
                               creator: String::new(),
                               copyright: String::new(),
                               overwrite: true,
                               auto_embed: true,
                               category: Some(g_data.category.clone()),
                           };
                           if let Ok(Some(new_path)) = write_image(&meta_req).await {
                               g_data.file = new_path.clone();
                               g_data.file_path = new_path;
                           }
                       }

                       last_error = format!("Rejected: {}", sel_reason);
                       if let Some(ref mut g2) = temp_gen {
                           g2.selection_status = Some("rejected".into());
                           g2.failed_checks = Some(sel_failed);
                           g2.reason = Some(sel_reason);
                           generated = temp_gen;
                       }
                   }
              } else {
                  generated = temp_gen;
              }
          }
            },
            Err(e) => last_error = e.to_string(),
        }
    }

      if let Some(mut g) = generated {
          g.app_balance_after = file_balance_after;
          g.app_tokens_deducted = if file_tokens_deducted > 0.0 { Some(file_tokens_deducted) } else { None };
          enforce_generation_contract(&mut g, req);
          // Validation
           if valid(&g, req) { 
                ensure_unique_title(&mut g, &mut used_titles, req);
                out.push(g);
           } else {
               g.failed_checks = Some(vec!["Length/Count Validation Failed".to_string()]);
               ensure_unique_title(&mut g, &mut used_titles, req);
               out.push(g);
           }
      } else {
           // Check if the error was a Safety Block (common with Gemini)
           let lower = last_error.to_lowercase();
           let is_rate_limited = is_quota_or_rate_limit_error(&lower);
           let is_safety = is_safety_block_error(&lower) && !is_rate_limited;
           let tokens_deducted = if file_tokens_deducted > 0.0 { Some(file_tokens_deducted) } else { None };
                
           if is_safety && selection_on {
                // Treat as Rejected (NSFW/Safety)
                out.push(Generated {
                    file: f.clone(), file_path: f.clone(),
                    title: "ERROR".into(), description: format!("Rejected: Safety Block: {}", last_error), keywords: vec![], category: "".into(),
                    source: vision_model.to_string(), 
                    selection_status: Some("rejected".into()), 
                    failed_checks: Some(vec!["nudity_nsfw".into(), "safety_block".into()]), 
                    reason: Some(format!("Safety Block: {}", last_error)), 
                    gen_provider: None, 
                    input_tokens: Some(acc_vis_usage.prompt_tokens + acc_text_usage.prompt_tokens), 
                    output_tokens: Some(acc_vis_usage.completion_tokens + acc_text_usage.completion_tokens), 
                    cost: Some(acc_vis_cost + acc_text_cost),
                    app_balance_after: file_balance_after,
                    app_tokens_deducted: tokens_deducted,
                    vision_input_tokens: Some(acc_vis_usage.prompt_tokens),
                    vision_output_tokens: Some(acc_vis_usage.completion_tokens),
                    vision_cost: Some(acc_vis_cost),
                    text_input_tokens: Some(acc_text_usage.prompt_tokens),
                    text_output_tokens: Some(acc_text_usage.completion_tokens),
                    text_cost: Some(acc_text_cost),
                    vision_model: if acc_vis_usage.total_tokens > 0 { Some(vision_model.to_string()) } else { None },
                    text_model: None,
                });
           } else {
               // Push Error Result with accumulated usage/cost
               out.push(Generated {
                    file: f.clone(), file_path: f.clone(),
                    title: "ERROR".into(), description: last_error, keywords: vec![], category: "".into(),
                    source: vision_model.to_string(), selection_status: None, failed_checks: None, reason: None, gen_provider: None, 
                    input_tokens: Some(acc_vis_usage.prompt_tokens + acc_text_usage.prompt_tokens), 
                    output_tokens: Some(acc_vis_usage.completion_tokens + acc_text_usage.completion_tokens), 
                    cost: Some(acc_vis_cost + acc_text_cost),
                    app_balance_after: file_balance_after,
                    app_tokens_deducted: tokens_deducted,
                    vision_input_tokens: Some(acc_vis_usage.prompt_tokens),
                    vision_output_tokens: Some(acc_vis_usage.completion_tokens),
                    vision_cost: Some(acc_vis_cost),
                    text_input_tokens: Some(acc_text_usage.prompt_tokens),
                    text_output_tokens: Some(acc_text_usage.completion_tokens),
                    text_cost: Some(acc_text_cost),
                    vision_model: if acc_vis_usage.total_tokens > 0 { Some(vision_model.to_string()) } else { None },
                    text_model: None,
               });
           }
      }
  }
  Ok(out)
}

// --- PARSING & HELPERS ---

#[allow(clippy::too_many_arguments)]
fn parse_generated_json(
    txt: &str, 
    file: &str, 
    model: &str, 
    provider: Option<String>, 
    v_usage: TokenUsage, 
    v_cost: f64,
    t_usage: TokenUsage,
    t_cost: f64,
    req: &crate::api::BatchReq,
    v_model: Option<String>,
    t_model: Option<String>
) -> Option<Generated> {
    let clean = txt.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
    
    // Calculate totals
    let total_input = v_usage.prompt_tokens + t_usage.prompt_tokens;
    let total_output = v_usage.completion_tokens + t_usage.completion_tokens;
    let total_cost = v_cost + t_cost;

    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(clean) {
        let mut selection_status: Option<String> = None;
        let mut failed_checks: Option<Vec<String>> = None;
        let mut reason: Option<String> = None;

        if let Some(sel) = parsed.get("selection") {
            if sel.is_object() {
                selection_status = sel.get("status").and_then(|v| v.as_str()).map(|s| s.to_string());
                failed_checks = sel.get("failed_checks").and_then(|v| v.as_array()).map(|a| {
                    a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect::<Vec<String>>()
                });
                reason = sel.get("reason").and_then(|v| v.as_str()).map(|s| s.to_string());
            }
        } else {
            selection_status = parsed.get("selection_status").and_then(|v| v.as_str()).map(|s| s.to_string());
            failed_checks = parsed.get("failed_checks").and_then(|v| v.as_array()).map(|a| {
                a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect::<Vec<String>>()
            });
            reason = parsed.get("reason").and_then(|v| v.as_str()).map(|s| s.to_string());
        }

        Some(Generated {
            file: file.to_string(),
            file_path: file.to_string(),
            title: parsed["title"].as_str().unwrap_or("").to_string(),
            description: parsed["description"].as_str().unwrap_or("").to_string(),
            keywords: normalize_keywords(&parsed["keywords"], req.keywords_min_count, req.keywords_max_count, &req.banned_words),
            category: if let Some(arr) = parsed["category"].as_array() {
                arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(",")
            } else {
                parsed["category"].as_str().unwrap_or("").to_string()
            },
            source: model.to_string(),
            selection_status,
            failed_checks,
            reason,
            gen_provider: provider,
            input_tokens: Some(total_input),
            output_tokens: Some(total_output),
            cost: Some(total_cost),
            app_balance_after: None,
            app_tokens_deducted: None,
            vision_input_tokens: Some(v_usage.prompt_tokens),
            vision_output_tokens: Some(v_usage.completion_tokens),
            vision_cost: Some(v_cost),
            text_input_tokens: Some(t_usage.prompt_tokens),
            text_output_tokens: Some(t_usage.completion_tokens),
            text_cost: Some(t_cost),
            vision_model: v_model,
            text_model: t_model,
        })
    } else {
        if let Some(start) = clean.find('{') {
            if let Some(end) = clean.rfind('}') {
                if end > start {
                    let potential_json = &clean[start..=end];
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(potential_json) {
                        let mut selection_status: Option<String> = None;
                        let mut failed_checks: Option<Vec<String>> = None;
                        let mut reason: Option<String> = None;

                        if let Some(sel) = parsed.get("selection") {
                            if sel.is_object() {
                                selection_status = sel.get("status").and_then(|v| v.as_str()).map(|s| s.to_string());
                                failed_checks = sel.get("failed_checks").and_then(|v| v.as_array()).map(|a| {
                                    a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect::<Vec<String>>()
                                });
                                reason = sel.get("reason").and_then(|v| v.as_str()).map(|s| s.to_string());
                            }
                        } else {
                            selection_status = parsed.get("selection_status").and_then(|v| v.as_str()).map(|s| s.to_string());
                            failed_checks = parsed.get("failed_checks").and_then(|v| v.as_array()).map(|a| {
                                a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect::<Vec<String>>()
                            });
                            reason = parsed.get("reason").and_then(|v| v.as_str()).map(|s| s.to_string());
                        }

                        return Some(Generated {
                            file: file.to_string(),
                            file_path: file.to_string(),
                            title: parsed["title"].as_str().unwrap_or("").to_string(),
                            description: parsed["description"].as_str().unwrap_or("").to_string(),
                            keywords: normalize_keywords(&parsed["keywords"], req.keywords_min_count, req.keywords_max_count, &req.banned_words),
                            category: if let Some(arr) = parsed["category"].as_array() { arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(",") } else { parsed["category"].as_str().unwrap_or("").to_string() },
                            source: model.to_string(),
                            selection_status,
                            failed_checks,
                            reason,
                            gen_provider: provider.clone(),
                            input_tokens: Some(total_input),
                            output_tokens: Some(total_output),
                            cost: Some(total_cost),
                            app_balance_after: None,
                            app_tokens_deducted: None,
                            vision_input_tokens: Some(v_usage.prompt_tokens),
                            vision_output_tokens: Some(v_usage.completion_tokens),
                            vision_cost: Some(v_cost),
                            text_input_tokens: Some(t_usage.prompt_tokens),
                            text_output_tokens: Some(t_usage.completion_tokens),
                            text_cost: Some(t_cost),
                            vision_model: v_model.clone(),
                            text_model: t_model.clone(),
                        });
                    }
                }
            }
        }
        // let lower = clean.to_lowercase(); // Unused variable
        let mut title = String::new();
        let mut description = String::new();
        let mut keywords_raw: Vec<String> = Vec::new();
        let mut category = String::new();
        for line in clean.lines() {
            let l = line.trim();
            if title.is_empty() && (l.starts_with("title:") || l.starts_with("Title:")) {
                title = l.splitn(2, ':').nth(1).unwrap_or("").trim().to_string();
            } else if description.is_empty() && (l.starts_with("description:") || l.starts_with("Description:")) {
                description = l.splitn(2, ':').nth(1).unwrap_or("").trim().to_string();
            } else if keywords_raw.is_empty() && (l.starts_with("keywords:") || l.starts_with("Keywords:")) {
                let ks = l.splitn(2, ':').nth(1).unwrap_or("");
                keywords_raw = ks.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
            } else if category.is_empty() && (l.starts_with("category:") || l.starts_with("Category:")) {
                category = l.splitn(2, ':').nth(1).unwrap_or("").trim().to_string();
            }
        }
        let keywords_val = serde_json::Value::Array(keywords_raw.iter().map(|s| serde_json::Value::String(s.clone())).collect());
        let keywords = normalize_keywords(&keywords_val, req.keywords_min_count, req.keywords_max_count, &req.banned_words);
        if title.is_empty() { title = Path::new(file).file_stem().and_then(|s| s.to_str()).unwrap_or("Untitled").to_string(); }
        Some(Generated {
            file: file.to_string(),
            file_path: file.to_string(),
            title,
            description,
            keywords,
            category,
            source: model.to_string(),
            selection_status: None,
            failed_checks: None,
            reason: None,
            gen_provider: provider,
            input_tokens: Some(total_input),
            output_tokens: Some(total_output),
            cost: Some(total_cost),
            app_balance_after: None,
            app_tokens_deducted: None,
            vision_input_tokens: Some(v_usage.prompt_tokens),
            vision_output_tokens: Some(v_usage.completion_tokens),
            vision_cost: Some(v_cost),
            text_input_tokens: Some(t_usage.prompt_tokens),
            text_output_tokens: Some(t_usage.completion_tokens),
            text_cost: Some(t_cost),
            vision_model: v_model,
            text_model: t_model,
        })
    }
}

fn normalize_keywords(v: &serde_json::Value, _min_c: u32, max_c: u32, banned_str: &str) -> Vec<String> {
      let mut raw: Vec<String> = if let Some(arr) = v.as_array() { arr.iter().map(|x| x.as_str().unwrap_or("").to_string()).collect() } else { v.as_str().map(|s| s.split(',').map(|t| t.trim().to_string()).collect()).unwrap_or_default() };
      
      let banned_list: Vec<String> = banned_str.split(',')
          .map(|s| s.trim().to_lowercase())
          .filter(|s| !s.is_empty())
          .collect();

      let mut out: Vec<String> = Vec::new();
      for kw in raw.drain(..) {
          let lower = kw.to_lowercase();
          
          // Check explicit banned words
          if banned_list.contains(&lower) { continue; }

          let clean = lower.replace(|c: char| !c.is_ascii_alphanumeric(), " ");
          for token in clean.split_whitespace() {
              if !token.is_empty() {
                  // Check again after cleaning (e.g. if banned word was "ai", and token is "ai")
                  if banned_list.contains(&token.to_string()) { continue; }
                  
                  if !out.contains(&token.to_string()) { out.push(token.to_string()); }
              }
          }
      }
      if out.len() as u32 > max_c { out.truncate(max_c as usize); }
      out
}

fn build_stopwords() -> std::collections::HashSet<String> {
    [
        "a","an","the","and","or","with","without","of","in","on","for","to","from","by","at","as",
        "is","are","be","was","were","this","that","these","those","into","over","under","above","below",
        "around","between","across","through","up","down","out","off","via","but","if","then","than",
        "also","very","more","most","much","many","such","some","any","each","other","another","own",
        "stock","photo","photos","image","images","media",
        "picture","pictures","shot","shots","capture","captured","high","quality","professional",
        "commercial","editorial","resolution","highresolution","hd","4k","8k","showing","view"
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

fn is_meaningful_token(token: &str, stopwords: &std::collections::HashSet<String>, banned_list: &Vec<String>) -> bool {
    let lower = token.trim().to_lowercase();
    if lower.is_empty() { return false; }
    if lower.len() < 2 { return false; }
    if lower.chars().all(|c| c.is_ascii_digit()) { return false; }
    if stopwords.contains(&lower) { return false; }
    if banned_list.contains(&lower) { return false; }
    true
}

const SHUTTERSTOCK_CATEGORIES: [&str; 26] = [
    "Abstract",
    "Animals/Wildlife",
    "Arts",
    "Backgrounds/Textures",
    "Beauty/Fashion",
    "Buildings/Landmarks",
    "Business/Finance",
    "Celebrities",
    "Education",
    "Food and drink",
    "Healthcare/Medical",
    "Holidays",
    "Industrial",
    "Interiors",
    "Miscellaneous",
    "Nature",
    "Objects",
    "Parks/Outdoor",
    "People",
    "Religion",
    "Science",
    "Signs/Symbols",
    "Sports/Recreation",
    "Technology",
    "Transportation",
    "Vintage",
];

fn normalize_shutterstock_category_token(raw: &str) -> Option<&'static str> {
    let t = raw.trim().trim_matches('"').trim_matches('\'').trim();
    if t.is_empty() { return None; }
    let lower = t.to_lowercase();
    match lower.as_str() {
        "abstract" => Some("Abstract"),
        "animals/wildlife" | "animals & wildlife" | "animals and wildlife" => Some("Animals/Wildlife"),
        "arts" | "the arts" => Some("Arts"),
        "backgrounds/textures" | "backgrounds / textures" | "backgrounds & textures" => Some("Backgrounds/Textures"),
        "beauty/fashion" | "beauty & fashion" | "beauty and fashion" => Some("Beauty/Fashion"),
        "buildings/landmarks" | "buildings & landmarks" | "buildings and landmarks" => Some("Buildings/Landmarks"),
        "business/finance" | "business & finance" | "business and finance" => Some("Business/Finance"),
        "celebrities" => Some("Celebrities"),
        "education" => Some("Education"),
        "food and drink" | "food and drinks" | "food & drink" | "food & drinks" | "food and drink." | "food and drink," => Some("Food and drink"),
        "healthcare/medical" | "healthcare & medical" | "healthcare and medical" | "health care/medical" => Some("Healthcare/Medical"),
        "holidays" => Some("Holidays"),
        "industrial" => Some("Industrial"),
        "interiors" => Some("Interiors"),
        "miscellaneous" => Some("Miscellaneous"),
        "nature" => Some("Nature"),
        "objects" => Some("Objects"),
        "parks/outdoor" | "parks/outdoors" | "parks & outdoor" | "parks and outdoor" => Some("Parks/Outdoor"),
        "people" => Some("People"),
        "religion" => Some("Religion"),
        "science" => Some("Science"),
        "signs/symbols" | "signs & symbols" | "signs and symbols" => Some("Signs/Symbols"),
        "sports/recreation" | "sports & recreation" | "sports and recreation" => Some("Sports/Recreation"),
        "technology" => Some("Technology"),
        "transportation" => Some("Transportation"),
        "vintage" | "vectors/vintage" => Some("Vintage"),
        _ => {
            for c in SHUTTERSTOCK_CATEGORIES {
                if c.eq_ignore_ascii_case(t) {
                    return Some(c);
                }
            }
            None
        }
    }
}

pub(crate) fn normalize_shutterstock_categories(raw: &str) -> (String, bool) {
    let raw_clean = raw.replace("Vectors/Vintage", "Vintage");
    let mut out: Vec<&'static str> = Vec::new();
    let mut had_issues = false;

    for part in raw_clean.split(&[',', ';', '|', '\n', '\r'][..]) {
        let token = part.trim();
        if token.is_empty() { continue; }
        match normalize_shutterstock_category_token(token) {
            Some(canon) => {
                if !out.contains(&canon) {
                    out.push(canon);
                }
            }
            None => {
                had_issues = true;
            }
        }
        if out.len() >= 2 { break; }
    }

    if out.is_empty() {
        return ("Miscellaneous, Objects".to_string(), true);
    }
    if out.len() == 1 {
        had_issues = true;
        let second = if out[0] == "Miscellaneous" { "Objects" } else { "Miscellaneous" };
        out.push(second);
    }

    (format!("{}, {}", out[0], out[1]), had_issues)
}

fn enforce_generation_contract(g: &mut Generated, req: &crate::api::BatchReq) {
    if g.title.trim().eq_ignore_ascii_case("ERROR") {
        return;
    }
    let (cat_norm, _cat_issues) = normalize_shutterstock_categories(&g.category);
    g.category = cat_norm;
    let (tmin, tmax, dmin, dmax, kw_min, kw_max) = effective_generation_bounds(req);

    let banned_list: Vec<String> = req
        .banned_words
        .split(',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();

    let mut title_words: Vec<&str> = g.title.split_whitespace().filter(|w| !w.is_empty()).collect();
    if tmax > 0 && (title_words.len() as u32) > tmax {
        title_words.truncate(tmax as usize);
        g.title = title_words.join(" ");
        title_words = g.title.split_whitespace().filter(|w| !w.is_empty()).collect();
    }
    if tmin > 0 && (title_words.len() as u32) < tmin {
        let mut extra: Vec<String> = Vec::new();
        for kw in &g.keywords {
            if extra.len() as u32 >= (tmin - title_words.len() as u32) { break; }
            if kw.is_empty() { continue; }
            extra.push(kw.clone());
        }
        if !extra.is_empty() {
            g.title = format!("{} {}", g.title.trim(), extra.join(" ")).trim().to_string();
            let mut words: Vec<&str> = g.title.split_whitespace().filter(|w| !w.is_empty()).collect();
            if tmax > 0 && (words.len() as u32) > tmax {
                words.truncate(tmax as usize);
                g.title = words.join(" ");
            }
        }
        let stopwords_title = build_stopwords();
        let empty_banned: Vec<String> = Vec::new();
        let mut cur_words: Vec<String> = g.title.split_whitespace().map(|w| w.to_string()).collect();
        let mut seen_title: std::collections::HashSet<String> = cur_words.iter().map(|w| w.to_lowercase()).collect();

        let push_words_from_text = |text: &str, cur_words: &mut Vec<String>, seen_title: &mut std::collections::HashSet<String>| {
            let clean = text.to_lowercase().replace(|c: char| !c.is_ascii_alphanumeric(), " ");
            for token in clean.split_whitespace() {
                if (cur_words.len() as u32) >= tmin { break; }
                if !is_meaningful_token(token, &stopwords_title, &empty_banned) { continue; }
                let w = token.trim().to_string();
                if seen_title.insert(w.clone()) {
                    cur_words.push(w);
                }
            }
        };

        if (cur_words.len() as u32) < tmin {
            push_words_from_text(&g.category, &mut cur_words, &mut seen_title);
        }
        if (cur_words.len() as u32) < tmin {
            if let Some(stem) = std::path::Path::new(&g.file_path).file_stem().and_then(|s| s.to_str()) {
                push_words_from_text(stem, &mut cur_words, &mut seen_title);
            }
        }

        if !cur_words.is_empty() {
            while (cur_words.len() as u32) < tmin {
                cur_words.push(cur_words[0].clone());
            }
            if tmax > 0 && (cur_words.len() as u32) > tmax {
                cur_words.truncate(tmax as usize);
            }
            g.title = cur_words.join(" ");
        }
    }

    if dmax == 0 {
        g.description = String::new();
    } else {
        let mut desc = g.description.trim().split_whitespace().collect::<Vec<_>>().join(" ");
        if desc.chars().count() as u32 > dmax {
            desc = desc.chars().take(dmax as usize).collect::<String>().trim().to_string();
        }
        if (desc.chars().count() as u32) < dmin {
            let title_part = g.title.trim();
            let mut alt = if title_part.is_empty() {
                "Image.".to_string()
            } else {
                format!("Image showing {}.", title_part)
            };
            if (alt.chars().count() as u32) < dmin {
                let kws = g.keywords.iter().take(12).cloned().collect::<Vec<_>>().join(", ");
                if !kws.is_empty() {
                    alt = format!("{} Keywords: {}.", alt.trim_end_matches('.'), kws);
                }
            }
            if alt.chars().count() as u32 > dmax {
                alt = alt.chars().take(dmax as usize).collect::<String>().trim().to_string();
            }
            desc = alt;
        }
        if dmin > 0 {
            while (desc.chars().count() as u32) < dmin {
                if desc.is_empty() {
                    desc.push_str("Image.");
                } else {
                    desc.push_str(" Image.");
                }
                if (desc.chars().count() as u32) > dmax {
                    desc = desc.chars().take(dmax as usize).collect::<String>().trim().to_string();
                    break;
                }
            }
        }
        g.description = desc;
    }

    let stopwords = build_stopwords();
    let mut out: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for kw in g.keywords.drain(..) {
        let lower = kw.trim().to_lowercase();
        if lower.is_empty() { continue; }
        let clean = lower.replace(|c: char| !c.is_ascii_alphanumeric(), " ");
        for token in clean.split_whitespace() {
            if !is_meaningful_token(token, &stopwords, &banned_list) { continue; }
            let t = token.trim().to_string();
            if seen.insert(t.clone()) { out.push(t); }
        }
    }

    let push_from_text = |text: &str, out: &mut Vec<String>, seen: &mut std::collections::HashSet<String>| {
        let lower = text.to_lowercase();
        let clean = lower.replace(|c: char| !c.is_ascii_alphanumeric(), " ");
        for token in clean.split_whitespace() {
            if out.len() as u32 >= kw_min { break; }
            if !is_meaningful_token(token, &stopwords, &banned_list) { continue; }
            let t = token.trim().to_string();
            if seen.insert(t.clone()) { out.push(t); }
        }
    };

    if kw_min > 0 && (out.len() as u32) < kw_min {
        push_from_text(&g.title, &mut out, &mut seen);
    }
    if kw_min > 0 && (out.len() as u32) < kw_min {
        push_from_text(&g.description, &mut out, &mut seen);
    }
    if kw_min > 0 && (out.len() as u32) < kw_min {
        push_from_text(&g.category, &mut out, &mut seen);
    }
    if kw_min > 0 && (out.len() as u32) < kw_min {
        use std::path::Path;
        if let Some(stem) = Path::new(&g.file_path).file_stem().and_then(|s| s.to_str()) {
            let lower = stem.to_lowercase();
            let clean = lower.replace(|c: char| !c.is_ascii_alphanumeric(), " ");
            for token in clean.split_whitespace() {
                if out.len() as u32 >= kw_min { break; }
                if !is_meaningful_token(token, &stopwords, &banned_list) { continue; }
                let t = token.trim().to_string();
                if seen.insert(t.clone()) { out.push(t); }
            }
        }
    }

    if kw_min > 0 && (out.len() as u32) < kw_min {
        let base = out.clone();
        for w in base {
            if out.len() as u32 >= kw_min { break; }
            let lower = w.to_lowercase();
            if lower.len() < 3 { continue; }
            if lower.ends_with('s') && lower.len() > 3 {
                let singular = lower.trim_end_matches('s').to_string();
                if is_meaningful_token(&singular, &stopwords, &banned_list) && seen.insert(singular.clone()) {
                    out.push(singular);
                }
            } else {
                let plural = format!("{}s", lower);
                if is_meaningful_token(&plural, &stopwords, &banned_list) && seen.insert(plural.clone()) {
                    out.push(plural);
                }
            }
        }
    }

    if kw_max == 0 {
        out.clear();
    } else if (out.len() as u32) > kw_max {
        out.truncate(kw_max as usize);
    }
    g.keywords = out;
}

fn valid(g: &Generated, req: &crate::api::BatchReq) -> bool {
  let (tmin, tmax, dmin, dmax, kw_min, kw_max_raw) = effective_generation_bounds(req);
  let tw = g.title.split_whitespace().count() as u32;
  let dl = g.description.chars().count() as u32;
  let kw = g.keywords.len() as u32;
  let dl_max = dmax + 15;
  let kw_max = kw_max_raw + 3;
  let tw_max = tmax + 2;
  tw >= tmin && tw <= tw_max &&
  dl >= dmin && dl <= dl_max &&
  kw >= kw_min && kw <= kw_max
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vision_model_filter_openai() {
        assert!(is_vision_model_for_provider("OpenAI", "gpt-4o-mini"));
        assert!(is_vision_model_for_provider("OpenAI", "gpt-4o"));
        assert!(is_vision_model_for_provider("OpenAI", "gpt-4o-mini-vision"));
        assert!(!is_vision_model_for_provider("OpenAI", "gpt-4o-audio-preview"));
        assert!(is_vision_model_for_provider("OpenAI", "gpt-4.1"));
    }

    #[test]
    fn vision_model_filter_gemini() {
        assert!(is_vision_model_for_provider("Gemini", "gemini-2.5-flash"));
        assert!(!is_vision_model_for_provider("Gemini", "text-embedding-004"));
    }

    #[test]
    fn vision_model_filter_openrouter() {
        assert!(is_vision_model_for_provider("OpenRouter", "qwen/qwen3-vl-235b-a22b-thinking"));
        assert!(is_vision_model_for_provider("OpenRouter", "nvidia/nemotron-nano-12b-v2-vl:free"));
        assert!(!is_vision_model_for_provider("OpenRouter", "openrouter/free"));
        assert!(!is_vision_model_for_provider("OpenRouter", "meta-llama/llama-3.1-8b-instruct"));
    }

    #[test]
    fn excessive_dimensions_guard() {
        assert!(!is_excessive_image_dimensions(512, 512));
        assert!(!is_excessive_image_dimensions(8000, 8000));
        assert!(!is_excessive_image_dimensions(12096, 6912));
        assert!(!is_excessive_image_dimensions(20001, 10));
        assert!(!is_excessive_image_dimensions(10, 20001));
        assert!(!is_excessive_image_dimensions(12000, 12000));
    }

    #[test]
    fn generation_enforcement_respects_min_max() {
        let req = crate::api::BatchReq {
            files: vec![],
            model: "any".into(),
            token: "".into(),
            retries: 0,
            title_min_words: 5,
            title_max_words: 10,
            description_min_chars: 60,
            description_max_chars: 120,
            keywords_min_count: 8,
            keywords_max_count: 15,
            banned_words: "banned".into(),
            max_threads: 1,
            connection_mode: "".into(),
            api_key: None,
            provider: "OpenRouter".into(),
        };

        let mut g = Generated {
            file: "x".into(),
            file_path: "x".into(),
            title: "Cat".into(),
            description: "short".into(),
            keywords: vec!["cat".into(), "banned".into()],
            category: "Animals/Wildlife,Nature".into(),
            source: "any".into(),
            selection_status: None,
            failed_checks: None,
            reason: None,
            gen_provider: None,
            input_tokens: None,
            output_tokens: None,
            cost: None,
            app_balance_after: None,
            app_tokens_deducted: None,
            vision_input_tokens: None,
            vision_output_tokens: None,
            text_input_tokens: None,
            text_output_tokens: None,
            vision_cost: None,
            text_cost: None,
            vision_model: None,
            text_model: None,
        };

        enforce_generation_contract(&mut g, &req);

        let tw = g.title.split_whitespace().count() as u32;
        let dl = g.description.chars().count() as u32;
        let kw = g.keywords.len() as u32;

        assert!(tw >= 5 && tw <= 10);
        assert!(dl >= 60 && dl <= 120);
        assert!(kw >= 8 && kw <= 15);
        assert!(!g.keywords.iter().any(|k| k == "banned"));
        assert!(g.keywords.iter().all(|k| !k.contains(char::is_whitespace)));
        assert!(valid(&g, &req));
    }

    #[test]
    fn generation_enforcement_disables_description() {
        let req = crate::api::BatchReq {
            files: vec![],
            model: "any".into(),
            token: "".into(),
            retries: 0,
            title_min_words: 3,
            title_max_words: 6,
            description_min_chars: 200,
            description_max_chars: 0,
            keywords_min_count: 5,
            keywords_max_count: 8,
            banned_words: "".into(),
            max_threads: 1,
            connection_mode: "".into(),
            api_key: None,
            provider: "OpenAI".into(),
        };

        let mut g = Generated {
            file: "x".into(),
            file_path: "x".into(),
            title: "Blue sky".into(),
            description: "This should be removed.".into(),
            keywords: vec!["blue".into(), "sky".into()],
            category: "Nature,Backgrounds/Textures".into(),
            source: "any".into(),
            selection_status: None,
            failed_checks: None,
            reason: None,
            gen_provider: None,
            input_tokens: None,
            output_tokens: None,
            cost: None,
            app_balance_after: None,
            app_tokens_deducted: None,
            vision_input_tokens: None,
            vision_output_tokens: None,
            text_input_tokens: None,
            text_output_tokens: None,
            vision_cost: None,
            text_cost: None,
            vision_model: None,
            text_model: None,
        };

        enforce_generation_contract(&mut g, &req);
        assert_eq!(g.description, "");
        assert!(valid(&g, &req));
    }

    #[test]
    fn generation_enforcement_disables_keywords() {
        let req = crate::api::BatchReq {
            files: vec![],
            model: "any".into(),
            token: "".into(),
            retries: 0,
            title_min_words: 1,
            title_max_words: 6,
            description_min_chars: 0,
            description_max_chars: 50,
            keywords_min_count: 0,
            keywords_max_count: 0,
            banned_words: "".into(),
            max_threads: 1,
            connection_mode: "".into(),
            api_key: None,
            provider: "Gemini".into(),
        };

        let mut g = Generated {
            file: "x".into(),
            file_path: "x".into(),
            title: "Ocean".into(),
            description: "Waves.".into(),
            keywords: vec!["ocean".into(), "sea".into()],
            category: "Nature,Travel".into(),
            source: "any".into(),
            selection_status: None,
            failed_checks: None,
            reason: None,
            gen_provider: None,
            input_tokens: None,
            output_tokens: None,
            cost: None,
            app_balance_after: None,
            app_tokens_deducted: None,
            vision_input_tokens: None,
            vision_output_tokens: None,
            text_input_tokens: None,
            text_output_tokens: None,
            vision_cost: None,
            text_cost: None,
            vision_model: None,
            text_model: None,
        };

        enforce_generation_contract(&mut g, &req);
        assert!(g.keywords.is_empty());
        assert!(valid(&g, &req));
    }

    #[test]
    fn direct_api_quota_errors_are_not_misclassified_as_safety() {
        let err = r#"Direct API Error (HTTP 429 Too Many Requests, URL: https://generativelanguage.googleapis.com/v1beta/openai/chat/completions): {"error":{"code":429,"message":"You exceeded your current quota.","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"subject":"generate_content_free_tier_requests"}]}]}}"#;
        let lower = err.to_lowercase();
        assert!(is_quota_or_rate_limit_error(&lower));
        assert!(!is_safety_block_error(&lower));
    }

    #[test]
    fn safety_block_errors_still_detected() {
        let err = "Blocked due to safety policy: nudity";
        let lower = err.to_lowercase();
        assert!(!is_quota_or_rate_limit_error(&lower));
        assert!(is_safety_block_error(&lower));
    }
}

fn normalize_title_str(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() { out.push(ch.to_ascii_lowercase()); }
        else if ch.is_whitespace() { out.push(' '); }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn ensure_unique_title(g: &mut Generated, used: &mut HashSet<String>, _req: &crate::api::BatchReq) {
    let base = normalize_title_str(&g.title);
    if used.contains(&base) {
        let mut i = 1;
        loop {
             let new_title = format!("{} {}", g.title, i);
             let new_base = normalize_title_str(&new_title);
             if !used.contains(&new_base) {
                 g.title = new_title;
                 used.insert(new_base);
                 break;
             }
             i += 1;
        }
    } else {
        used.insert(base);
    }
}

async fn prepare_image_data(path: &str, _model: &str) -> Result<(String, String)> {
    if let Some(cached) = cache_get(path) {
        return Ok(cached);
    }

    if cancel_requested() {
        return Err(anyhow!("CANCELLED_BY_USER"));
    }
    
    // Check if video
    let path_lower = path.to_lowercase();
    let is_video = path_lower.ends_with(".mp4") 
        || path_lower.ends_with(".mov") 
        || path_lower.ends_with(".avi") 
        || path_lower.ends_with(".mkv")
        || path_lower.ends_with(".webm");

    let buf = if is_video {
        // Extract frame using FFmpeg (already resized to 1024px)
        crate::video::extract_frame(path)?
    } else {
        let file_len = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let (w, h) = ImageReader::open(path)?.with_guessed_format()?.into_dimensions()?;

        if cancel_requested() {
            return Err(anyhow!("CANCELLED_BY_USER"));
        }

        let is_jpeg_path = path_lower.ends_with(".jpg") || path_lower.ends_with(".jpeg");
        if is_jpeg_path && w <= 768 && h <= 768 && file_len > 0 && file_len < (150 * 1024) {
            let mut f_buf = Vec::new();
            let mut attempts = 0;
            loop {
                attempts += 1;
                match std::fs::File::open(path) {
                    Ok(mut file) => {
                        match std::io::Read::read_to_end(&mut file, &mut f_buf) {
                            Ok(_) => break,
                            Err(e) => {
                                if attempts >= 5 { return Err(e.into()); }
                                tokio::time::sleep(Duration::from_millis(500)).await;
                            }
                        }
                    },
                    Err(e) => {
                        if attempts >= 5 { return Err(e.into()); }
                        tokio::time::sleep(Duration::from_millis(500)).await;
                    }
                }
            }
            f_buf
        } else {
            let img = ImageReader::open(path)?.with_guessed_format()?.decode()?;
            let (w, h) = img.dimensions();
            let (nw, nh) = if w > 512 || h > 512 {
                if w > h { (512, (512.0 * h as f32 / w as f32) as u32) }
                else { ((512.0 * w as f32 / h as f32) as u32, 512) }
            } else { (w, h) };

            let resized = img.resize(nw, nh, FilterType::Triangle);
            let mut out = Cursor::new(Vec::new());
            resized.write_to(&mut out, image::ImageOutputFormat::Jpeg(60))?;
            out.into_inner()
        }
    };
    
    if cancel_requested() {
        return Err(anyhow!("CANCELLED_BY_USER"));
    }

    // FAST PATH 1: If file is very small (< 60KB), assume it's already a thumbnail
    if buf.len() < 60 * 1024 { 
        let is_jpeg = buf.len() > 2 && buf[0] == 0xFF && buf[1] == 0xD8;
        if is_jpeg {
             let b64 = BASE64_STANDARD.encode(&buf);
             let mime = "image/jpeg".to_string();
             if b64.len() <= 1_500_000 {
                 cache_set(path.to_string(), (b64.clone(), mime.clone()));
             }
             return Ok((b64, mime));
        }
    }

    let b64 = BASE64_STANDARD.encode(&buf);
    let mime = "image/jpeg".to_string();
    
    if b64.len() <= 1_500_000 {
        cache_set(path.to_string(), (b64.clone(), mime.clone()));
    }
    Ok((b64, mime))
}

fn is_excessive_image_dimensions(w: u32, h: u32) -> bool {
    let _ = (w, h);
    false
}

fn map_failure_to_tag(fail: &str) -> String {
    let f = fail.to_lowercase();
    
    // Brand/Watermark
    if f.contains("trademarked logo") || f.contains("brand logo") || f.contains("specific trademarked logo") { return "Brand_Logo".to_string(); }
    if f.contains("watermark") || f.contains("copyright stamp") { return "Watermark".to_string(); }
    
    // Quality
    if f.contains("blurry") || f.contains("blur") || f.contains("out of focus") { return "Blurry".to_string(); }
    if f.contains("pixelated") || f.contains("low resolution") || f.contains("low quality") { return "Low_Quality".to_string(); }
    if f.contains("artifact") || f.contains("distortion") { return "Artifacts".to_string(); }

    // Text
    if f.contains("gibberish") { return "Text_Gibberish".to_string(); }
    if f.contains("non-english") { return "Text_Non_English".to_string(); }
    if f.contains("irrelevant") { return "Text_Irrelevant".to_string(); }
    if f.contains("relevant-text") { return "Text_Relevant".to_string(); }
    if f.contains("text") || f.contains("words") || f.contains("letters") || f.contains("overlay") { return "Text_Overlay".to_string(); }
    
    // Human
    if f.contains("human") {
        if f.contains("full body") || f.contains("full_body") { return "Human_Full_Body".to_string(); }
        if f.contains("no head") || f.contains("no_head") { return "Human_No_Head".to_string(); }
        if f.contains("partial body (perfect") || f.contains("partial_perfect") { return "Human_Partial_Perfect".to_string(); }
        if f.contains("partial body (defect") || f.contains("partial_defect") { return "Human_Partial_Defect".to_string(); }
        if f.contains("back view") || f.contains("back_view") { return "Human_Back_View".to_string(); }
        if f.contains("unclear") || f.contains("distorted") || f.contains("alien") { return "Human_Distorted".to_string(); }
        if f.contains("face only") || f.contains("face_only") { return "Human_Face_Only".to_string(); }
        if f.contains("nudity") || f.contains("nsfw") || f.contains("sexual") { return "Human_NSFW".to_string(); }
        return "Human_Presence".to_string();
    }
    
    // Animal
    if f.contains("animal") {
        if f.contains("full body") || f.contains("full_body") { return "Animal_Full_Body".to_string(); }
        if f.contains("no head") || f.contains("no_head") { return "Animal_No_Head".to_string(); }
        if f.contains("partial body (perfect") || f.contains("partial_perfect") { return "Animal_Partial_Perfect".to_string(); }
        if f.contains("partial body (defect") || f.contains("partial_defect") { return "Animal_Partial_Defect".to_string(); }
        if f.contains("back view") || f.contains("back_view") { return "Animal_Back_View".to_string(); }
        if f.contains("unclear") || f.contains("distorted") || f.contains("alien") { return "Animal_Distorted".to_string(); }
        if f.contains("face only") || f.contains("face_only") { return "Animal_Face_Only".to_string(); }
        if f.contains("nudity") || f.contains("genitals") { return "Animal_NSFW".to_string(); }
        return "Animal_Presence".to_string();
    }
    
    // Short Codes / Other
    if f.contains("full_body_perfect") { return "Full_Body_Perfect".to_string(); }
    if f.contains("no_head") { return "No_Head".to_string(); }
    if f.contains("partial_perfect") { return "Partial_Perfect".to_string(); }
    if f.contains("partial_defect") { return "Partial_Defect".to_string(); }
    if f.contains("back_view") { return "Back_View".to_string(); }
    if f.contains("unclear_hybrid") { return "Distorted".to_string(); }
    if f.contains("face_only") { return "Face_Only".to_string(); }
    if f.contains("nudity_nsfw") { return "NSFW".to_string(); }
    
    if f.contains("deformed") { return "Deformed_Object".to_string(); }
    if f.contains("unrecognizable") { return "Unrecognizable".to_string(); }
    if f.contains("famous") { return "Famous_Trademark".to_string(); }

    if f.contains("json parse error") || f.contains("unrecognized response") || f.contains("parse failed") { return "Selection_Parse_Failed".to_string(); }

    String::new()
}

pub async fn strip_metadata_batch(window: tauri::Window, input_folder: &str, recurse: bool) -> Result<String> {
    let root = Path::new(input_folder);
    if !root.exists() {
        return Err(anyhow!("Folder tidak ditemukan: {}", input_folder));
    }

    let exiftool = resolve_exiftool().ok_or(anyhow!("ExifTool not found"))?;

    let total = {
        use walkdir::WalkDir;
        let mut n = 0usize;
        let walker = if recurse { WalkDir::new(root) } else { WalkDir::new(root).max_depth(1) };
        for e in walker.into_iter().flatten() {
            let p = e.path();
            if !p.is_file() { continue; }
            let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            let ok = matches!(ext.as_str(), "jpg"|"jpeg"|"png"|"webp"|"bmp"|"tif"|"tiff"|"mp4"|"mov"|"mkv"|"webm"|"avi"|"m2ts"|"3gp"|"wmv");
            if ok { n += 1; }
        }
        n
    };

    let _ = window.emit("tools_log", serde_json::json!({
        "code": "TOOL_TOTAL",
        "tool": "strip_meta",
        "total": total,
        "text": format!("Removing metadata: {}...", input_folder),
        "file": input_folder,
        "status": "processing"
    }));

    let mut args: Vec<String> = Vec::new();
    args.push("-overwrite_original".to_string());
    args.push("-m".to_string());
    args.push("-api".to_string());
    args.push("LargeFileSupport=1".to_string());
    if recurse {
        args.push("-r".to_string());
    }

    for ext in ["jpg","jpeg","png","webp","bmp","tif","tiff","mp4","mov","mkv","webm","avi","m2ts","3gp","wmv"] {
        args.push("-ext".to_string());
        args.push(ext.to_string());
    }

    args.push("-all=".to_string());
    args.push("-tagsfromfile".to_string());
    args.push("@".to_string());
    args.push("-Orientation".to_string());
    args.push(input_folder.to_string());

    let mut cmd = Command::new(exiftool);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = cmd.output()?;
    if !output.status.success() {
        return Err(anyhow!("{}", String::from_utf8_lossy(&output.stderr)));
    }

    let _ = window.emit("tools_log", serde_json::json!({
        "code": "TOOL_PROGRESS",
        "tool": "strip_meta",
        "total": total,
        "done": total,
        "success": total,
        "failed": 0,
        "rejected": 0,
        "text": "Metadata removed successfully",
        "file": input_folder,
        "status": "success"
    }));

    Ok("ok".to_string())
}

pub async fn move_to_rejected_with_metadata(
    file_path: &str, 
    output_folder: &str, 
    reasons: &[String], 
    main_reason: &str,
    gen: &Generated
) -> Result<()> {
    let rej_dir = if output_folder.is_empty() {
        PathBuf::from(file_path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."))
            .join("rejected")
    } else {
        PathBuf::from(output_folder).join("rejected")
    };
    std::fs::create_dir_all(&rej_dir)?;
    
    // Get original extension
    let path_obj = PathBuf::from(file_path);
    let ext = path_obj.extension().unwrap_or_default().to_string_lossy().to_string();
    
    // Determine new filename from reasons using mapping
    let mut mapped: Vec<String> = reasons.iter()
        .map(|r| map_failure_to_tag(r))
        .filter(|s| !s.is_empty())
        .collect();

    if mapped.is_empty() {
        let r_tag = map_failure_to_tag(main_reason);
        if !r_tag.is_empty() { mapped.push(r_tag); }
    }

    let reason_str = if !mapped.is_empty() {
        mapped.join("_")
    } else {
        let source = if !main_reason.is_empty() { main_reason } else { reasons.first().map(|s| s.as_str()).unwrap_or("Rejected") };
        let safe: String = source.chars()
            .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { ' ' })
            .collect();
        let trimmed = safe.split_whitespace().collect::<Vec<_>>().join(" ");
        let len = std::cmp::min(trimmed.len(), 50); 
        let final_str = trimmed[..len].trim().to_string();
        if final_str.is_empty() { "Rejected".to_string() } else { final_str }
    };
    
    // Ensure unique filename
    let mut dest_path = rej_dir.join(format!("{}.{}", reason_str, ext));
    let mut counter = 1;
    while dest_path.exists() {
        dest_path = rej_dir.join(format!("{} ({}).{}", reason_str, counter, ext));
        counter += 1;
    }
    
    if std::fs::rename(file_path, &dest_path).is_err() {
        let mut copied = false;
        for _ in 0..5 {
            if std::fs::copy(file_path, &dest_path).is_ok() { copied = true; break; }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        if !copied { return Err(anyhow!("Failed to copy to rejected folder")); }

        if std::path::Path::new(file_path).exists() {
            let mut del_attempts = 0;
            loop {
                del_attempts += 1;
                match std::fs::remove_file(file_path) {
                    Ok(_) => break,
                    Err(_) => {
                        if del_attempts >= 5 { break; }
                        tokio::time::sleep(Duration::from_millis(500)).await;
                    }
                }
            }
        }
    }

    // Now write metadata to the rejected file
    let req = crate::api::ImageMetaReq {
        file: dest_path.to_string_lossy().to_string(),
        output_file: Some(dest_path.to_string_lossy().to_string()),
        title: gen.title.clone(),
        description: gen.description.clone(),
        keywords: gen.keywords.clone(),
        category: Some(gen.category.clone()),
        auto_embed: true,
        ..Default::default() // Use default for others
    };

    // Use blocking command for ExifTool since we are in sync/async boundary or just use standard process
    let exiftool = resolve_exiftool().ok_or(anyhow!("ExifTool not found"))?;
    
    let mut args = vec![
        "-overwrite_original".to_string(),
        "-m".to_string(),
        "-sep".to_string(), ";".to_string(),
        "-charset".to_string(), "filename=utf8".to_string(),
    ];
    
    args.push(format!("-Title={}", req.title));
    args.push(format!("-Comment={}", req.description));
    args.push(format!("-UserComment={}", req.description));
    args.push(format!("-XPComment={}", req.description));
    
    let cats_raw = req.category.clone().unwrap_or_default();
    let cats = if cats_raw.trim().is_empty() {
        cats_raw
    } else {
        normalize_shutterstock_categories(&cats_raw).0
    };
    let extras_obj = serde_json::json!({
        "categories": cats,
        "editorial": "No",
        "mature": "No",
        "illustration": "No"
    });
    let extras = extras_obj.to_string();
    args.push(format!("-SpecialInstructions={}", extras));

    let keywords_str = req.keywords.join(";");
    args.push(format!("-Keywords={}", keywords_str));
    args.push(format!("-Subject={}", keywords_str));
    
    args.push(dest_path.to_string_lossy().to_string());
    
    let mut cmd = Command::new(exiftool);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let _ = cmd.output(); // Ignore error if writing metadata fails, at least file is there

    Ok(())
}

pub async fn move_to_rejected(file_path: &str, output_folder: &str, reasons: &[String], main_reason: &str) -> Result<()> {
    let rej_dir = if output_folder.is_empty() {
        PathBuf::from(file_path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."))
            .join("rejected")
    } else {
        PathBuf::from(output_folder).join("rejected")
    };
    std::fs::create_dir_all(&rej_dir)?;
    
    // Get original extension
    let path_obj = PathBuf::from(file_path);
    let ext = path_obj.extension().unwrap_or_default().to_string_lossy().to_string();
    
    // Determine new filename from reasons using mapping
    let mut mapped: Vec<String> = reasons.iter()
        .map(|r| map_failure_to_tag(r))
        .filter(|s| !s.is_empty())
        .collect();

    // If mapping from list empty, try mapping from main reason
    if mapped.is_empty() {
        let r_tag = map_failure_to_tag(main_reason);
        if !r_tag.is_empty() { mapped.push(r_tag); }
    }

    let reason_str = if !mapped.is_empty() {
        mapped.join("_")
    } else {
        // Fallback: Sanitize raw reason string (use main_reason as it's more likely to have content)
        let source = if !main_reason.is_empty() { main_reason } else { reasons.first().map(|s| s.as_str()).unwrap_or("Rejected") };
        
        let safe: String = source.chars()
            .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { ' ' })
            .collect();
        let trimmed = safe.split_whitespace().collect::<Vec<_>>().join(" ");
        let len = std::cmp::min(trimmed.len(), 50); 
        let final_str = trimmed[..len].trim().to_string();
        if final_str.is_empty() { "Rejected".to_string() } else { final_str }
    };
    
    // Ensure unique filename with (N) suffix
    let mut dest_path = rej_dir.join(format!("{}.{}", reason_str, ext));
    let mut counter = 1;
    while dest_path.exists() {
        dest_path = rej_dir.join(format!("{} ({}).{}", reason_str, counter, ext));
        counter += 1;
    }
    
    // Copy with retry (5 attempts)
    let mut copied = false;
    for _ in 0..5 {
        if std::fs::copy(file_path, &dest_path).is_ok() { copied = true; break; }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    if !copied { return Err(anyhow!("Failed to copy to rejected folder")); }
    
    if std::path::Path::new(file_path).exists() {
        let mut del_attempts = 0;
        loop {
            del_attempts += 1;
            match std::fs::remove_file(file_path) {
                Ok(_) => break,
                Err(_) => {
                    if del_attempts >= 5 { break; }
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            }
        }
    }
    
    Ok(())
}

pub async fn write_image(req: &crate::api::ImageMetaReq) -> Result<Option<String>> {
    if !req.auto_embed { return Ok(None); }
    
    let source = Path::new(&req.file);
    if !source.exists() {
        return Err(anyhow!("Source file not found: {}", req.file));
    }

    let target = if let Some(ref out) = req.output_file {
        PathBuf::from(out)
    } else {
        source.to_path_buf()
    };

    if target != source && target.exists() && !req.overwrite {
        return Err(anyhow!("Target file already exists: {}", target.to_string_lossy()));
    }

    let exiftool = resolve_exiftool().ok_or(anyhow!("ExifTool not found"))?;
    
    let mut args = vec![
        "-overwrite_original".to_string(),
        "-m".to_string(),
        "-sep".to_string(), ";".to_string(),
        "-charset".to_string(), "filename=utf8".to_string(),
    ];
    
    args.push(format!("-Title={}", req.title));
    // Pindahkan Deskripsi HANYA ke Comments (UserComment) agar tidak ganda di Subject/Description
    // args.push(format!("-Description={}", req.description));
    // args.push(format!("-ImageDescription={}", req.description));
    // args.push(format!("-Caption-Abstract={}", req.description));
    // args.push(format!("-Headline={}", req.description));
    
    args.push(format!("-Comment={}", req.description));
    args.push(format!("-UserComment={}", req.description));
    args.push(format!("-XPComment={}", req.description));
    
    // Embed Extra Metadata for CSV Generation (Shutterstock etc)
    // We use IPTC:SpecialInstructions to store JSON data
    let cats = req.category.clone().unwrap_or_default();
    let extras_obj = serde_json::json!({
        "categories": cats,
        "editorial": "No",
        "mature": "No",
        "illustration": "No"
    });
    let extras = extras_obj.to_string();
    args.push(format!("-SpecialInstructions={}", extras));

    let keywords_str = req.keywords.join(";");
    args.push(format!("-Keywords={}", keywords_str));
    args.push(format!("-Subject={}", keywords_str));
    
    let working_path = if target == source {
        source.to_path_buf()
    } else {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).with_context(|| format!("Gagal membuat folder output: {}", parent.to_string_lossy()))?;
        }
        let ext = target.extension().and_then(|s| s.to_str()).unwrap_or("");
        let stem = target.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
        let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        let pid = std::process::id();
        let tmp_name = if ext.is_empty() { format!(".{}.tmp-{}-{}", stem, ms, pid) } else { format!(".{}.tmp-{}-{}.{}", stem, ms, pid, ext) };
        let tmp_path = target.with_file_name(tmp_name);
        let mut last = None;
        for _ in 0..5 {
            match fs::copy(source, &tmp_path) {
                Ok(_) => { last = None; break; }
                Err(e) => {
                    last = Some(e);
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
            }
        }
        if let Some(e) = last {
            return Err(anyhow!(e).context(format!("Gagal menulis file sementara di folder output: {}", tmp_path.to_string_lossy())));
        }
        tmp_path
    };

    args.push(working_path.to_string_lossy().to_string());
    
    let mut cmd = Command::new(exiftool);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    let out = match cmd.output() {
        Ok(v) => v,
        Err(e) => {
            let _ = if working_path != source { fs::remove_file(&working_path) } else { Ok(()) };
            if e.raw_os_error() == Some(216) {
                return Err(anyhow!("ExifTool tidak kompatibel atau rusak di Windows ini (os error 216). Solusi: reinstall versi terbaru atau update ke rilis berikutnya."));
            }
            return Err(anyhow!("{}", e));
        }
    };
        
    if !out.status.success() {
        let _ = if working_path != source { fs::remove_file(&working_path) } else { Ok(()) };
        return Err(anyhow!("{}", String::from_utf8_lossy(&out.stderr)));
    }

    let final_path = if target == source {
        target.clone()
    } else {
        let mut moved = false;
        for _ in 0..5 {
            if fs::rename(&working_path, &target).is_ok() { moved = true; break; }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        if !moved {
            let mut copied = false;
            let mut last = None;
            for _ in 0..5 {
                match fs::copy(&working_path, &target) {
                    Ok(_) => { copied = true; last = None; break; }
                    Err(e) => {
                        last = Some(e);
                        tokio::time::sleep(Duration::from_millis(250)).await;
                    }
                }
            }
            if !copied {
                if let Some(e) = last {
                    let _ = fs::remove_file(&working_path);
                    return Err(anyhow!(e).context(format!("Gagal menulis hasil ke folder output: {}", target.to_string_lossy())));
                }
                let _ = fs::remove_file(&working_path);
                return Err(anyhow!("Gagal menulis hasil ke folder output: {}", target.to_string_lossy()));
            }
            let _ = fs::remove_file(&working_path);
        }
        target.clone()
    };
    
    // Rename File if enabled
    let new_path = apply_file_rename(&final_path, &req.title)?;
    
    if let Some(ref np) = new_path {
        return Ok(Some(np.to_string_lossy().to_string()));
    }

    Ok(None)
}

pub fn apply_file_rename(path: &Path, title: &str) -> Result<Option<PathBuf>> {
    let settings = crate::settings::load_settings().unwrap_or_default();
    if !settings.rename_enabled { return Ok(None); }

    let parent = path.parent().unwrap_or(Path::new("."));
    let ext = path.extension().unwrap_or_default().to_string_lossy();
    let old_name = path.file_stem().unwrap_or_default().to_string_lossy();

    let new_base_name = match settings.rename_mode.as_str() {
        "title" => {
            if title.is_empty() { return Ok(None); }
             title.chars()
                .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-')
                .collect::<String>()
                .trim()
                .to_string()
        },
        "datetime" => {
            chrono::Local::now().format("%d%m%y-%H%M%S").to_string()
        },
        "custom" => {
             if settings.rename_custom_text.is_empty() { return Ok(None); }
             settings.rename_custom_text.clone()
        },
        _ => return Ok(None)
    };

    if new_base_name.is_empty() { return Ok(None); }
    if new_base_name == old_name { return Ok(None); }

    let mut new_path = parent.join(format!("{}.{}", new_base_name, ext));
    
    // Handle duplicates
    let mut counter = 2;
    while new_path.exists() && new_path != path {
        new_path = parent.join(format!("{} ({}).{}", new_base_name, counter, ext));
        counter += 1;
    }

    if new_path != path {
        fs::rename(path, &new_path)?;
        return Ok(Some(new_path));
    }

    Ok(None)
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
