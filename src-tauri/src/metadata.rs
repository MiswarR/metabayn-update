use anyhow::{Result, anyhow};
use serde::{Serialize, Deserialize};
use std::process::Command;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::fs;
use base64::prelude::*;
use tokio::time::Duration;
use image::{GenericImageView, imageops::FilterType};
// use image::DynamicImage;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Mutex, OnceLock};
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

struct SelectionResult { 
    status: String, 
    failed_checks: Vec<String>, 
    reason: String,
    #[allow(dead_code)]
    usage: Option<TokenUsage>
}

struct ImageCache { map: HashMap<String, (String, String)>, order: VecDeque<String>, capacity: usize }
static IMAGE_B64_CACHE: OnceLock<Mutex<ImageCache>> = OnceLock::new();

fn cache_get(key: &str) -> Option<(String, String)> {
    let c = IMAGE_B64_CACHE.get_or_init(|| Mutex::new(ImageCache { map: HashMap::new(), order: VecDeque::new(), capacity: 500 }));
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

pub async fn generate_csv_from_folder(window: tauri::Window, input_folder: &str, output_folder: &str, api_key: Option<String>, token: Option<String>) -> Result<String> {
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

    let output = Command::new(&exiftool)
        .args(args)
        .args(["-api", "LargeFileSupport=1"])
        .creation_flags(0x08000000)
        .output()?;

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
    
    // Construct BatchReq for AI calls
    let req_template = crate::api::BatchReq {
        files: vec![],
        model: model.clone(),
        token: token.unwrap_or(settings.auth_token.clone()),
        retries: settings.retry_count,
        title_min_words: 0, title_max_words: 0,
        description_min_chars: 0, description_max_chars: 0,
        keywords_min_count: 0, keywords_max_count: 0,
        banned_words: String::new(),
        max_threads: 1,
        connection_mode: settings.connection_mode.clone(),
        api_key: api_key.clone(),
        provider: settings.ai_provider.clone(),
    };

    // use tokio::sync::Semaphore;
    use std::sync::Arc;
    use tokio::sync::Semaphore;

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
        let item_clone = item.clone();
        let sem_clone = sem.clone();
        let window = window.clone();
        let _settings = settings.clone();
        let model = model.clone();
        let req_template = req_template.clone();
        let exiftool = exiftool.clone();
        
        let task = tokio::spawn(async move {
            let _permit = sem_clone.acquire().await.unwrap();
            
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
                let _ = window.emit("csv_log", serde_json::json!({
                    "text": format!("> {} missing metadata. AI identifying...", filename),
                    "file": filename.clone(),
                    "status": "processing"
                }));
                
                // CALL AI
                match prepare_image_data(&path_str, &model).await {
                    Ok((b64, mime)) => {
                        let prompt = "Analyze this image for Shutterstock metadata. Provide:
                        1. Two most relevant Categories (comma separated) from standard Shutterstock categories (e.g. Abstract, Animals/Wildlife, Arts, Backgrounds/Textures, Beauty/Fashion, Buildings/Landmarks, Business/Finance, Celebrities, Education, Food and Drink, Healthcare/Medical, Holidays, Industrial, Interiors, Miscellaneous, Nature, Objects, Parks/Outdoor, People, Religion, Science, Signs/Symbols, Sports/Recreation, Technology, The Arts, Transportation, Vintage).
                        2. Editorial (Yes/No).
                        3. Mature Content (Yes/No).
                        4. Illustration (Yes/No).
                        
                        Output ONLY valid JSON: { \"categories\": \"Cat1, Cat2\", \"editorial\": \"No\", \"mature\": \"No\", \"illustration\": \"No\" }";
    
                        match call_ai_base(&model, prompt, Some((b64, mime)), &req_template).await {
                            Ok((content, usage, used_model, _cost)) => {
                                let clean_json = content.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
                                
                                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(clean_json) {
                                     let cats_str = if let Some(arr) = parsed["categories"].as_array() {
                                         arr.iter().filter_map(|v| {
                                             let s = v.as_str()?;
                                             if s == "Vectors/Vintage" { Some("Vintage") } else { Some(s) }
                                         }).collect::<Vec<_>>().join(", ")
                                     } else {
                                         parsed["categories"].as_str().unwrap_or("Miscellaneous, Objects").replace("Vectors/Vintage", "Vintage")
                                     };
    
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
                                         let out_et = Command::new(&exiftool)
                                            .args([
                                                "-overwrite_original",
                                                "-m",
                                                "-api", "LargeFileSupport=1",
                                                "-ignoreMinorErrors",
                                                &format!("-SpecialInstructions={}", new_instr),
                                                &format!("-XMP-photoshop:Instructions={}", new_instr),
                                                &path_str
                                            ])
                                            .creation_flags(0x08000000)
                                            .output();
                                         
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
                                    
                                    // Return updated fields to merge back to items
                                    return (idx, Some(new_instr));
                                } else {
                                    let _ = window.emit("csv_log", serde_json::json!({
                                        "text": format!("> {} AI response parse error: {}", filename, clean_json),
                                        "file": filename.clone(),
                                        "status": "error"
                                    }));
                                }
                            },
                            Err(e) => {
                                 let _ = window.emit("csv_log", serde_json::json!({
                                     "text": format!("> {} AI Call Failed: {}", filename, e),
                                     "file": filename.clone(),
                                     "status": "error"
                                 }));
                            }
                        }
                    },
                    Err(e) => {
                        let _ = window.emit("csv_log", serde_json::json!({
                            "text": format!("> {} Image Prep Failed: {}", filename, e),
                            "file": filename.clone(),
                            "status": "error"
                        }));
                    }
                }
            } else {
                let _ = window.emit("csv_log", serde_json::json!({
                    "text": format!("> {} metadata complete. Skipping AI.", filename),
                    "file": filename.clone(),
                    "status": "skipped"
                }));
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

        let (cats, editorial, mature, illustration) = if !instructions.is_empty() {
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

        mb_csv.push_str(&format!("{},{},{},{}\n", esc(&filename), esc(title), esc(desc), esc(&keywords)));
        ss_csv.push_str(&format!("{},{},{},{},{},{},{}\n", esc(&filename), esc(desc), esc(&keywords), esc(&cats), esc(&editorial), esc(&mature), esc(&illustration)));
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
    let c = IMAGE_B64_CACHE.get_or_init(|| Mutex::new(ImageCache { map: HashMap::new(), order: VecDeque::new(), capacity: 500 }));
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

fn get_primary_prompt(req: &crate::api::BatchReq, context: Option<&str>) -> String {
    let mut p = format!(
        "Generate metadata for stock media.
Rules:
- Title: {} to {} words.
- Description: {} to {} characters.
- Keywords: {} to {} tags. Single words only, comma separated.
- Banned characters: `~@#$%^&*()_+=-/\\][{{}}|';\":?/><` (Only . and , allowed).
- Output Format: JSON with keys 'title', 'description', 'keywords', 'category'.
- Category: Choose EXACTLY TWO relevant categories from this list, separated by a comma.
          You MUST provide TWO categories. If only one is perfectly relevant, choose the second most relevant one.
          NEVER provide just one category.
          List: [Abstract, Animals/Wildlife, Arts, Backgrounds/Textures, Beauty/Fashion, Buildings/Landmarks, Business/Finance, Celebrities, Education, Food and Drink, Healthcare/Medical, Holidays, Industrial, Interiors, Miscellaneous, Nature, Objects, Parks/Outdoor, People, Religion, Science, Signs/Symbols, Sports/Recreation, Technology, Transportation, Vintage]
          Example: \"Nature,Transportation\"
        ",
        req.title_min_words, req.title_max_words,
        req.description_min_chars, req.description_max_chars,
        req.keywords_min_count, req.keywords_max_count
    );

    if !req.banned_words.is_empty() {
        p.push_str(&format!("\n- Additional Banned Words: {}\n", req.banned_words));
    }

    if let Some(ctx) = context {
        p.push_str(&format!("\nBased on this visual description:\n{}\n", ctx));
    } else {
        p.push_str("\nAnalyze the attached image and generate the metadata.\n");
    }
    
    p
}







fn get_selection_vision_prompt(settings: &crate::settings::AppSettings) -> String {
    let mut checks: Vec<String> = Vec::new();
    // if settings.check_anatomy_defect { checks.push("check_anatomy_defect".to_string()); }
    
    // Text Vision Logic
    if settings.check_text_or_text_like {
         let mut text_rules = Vec::new();
         if settings.text_filter_gibberish { text_rules.push("gibberish"); }
         if settings.text_filter_non_english { text_rules.push("non-english"); }
         if settings.text_filter_irrelevant { text_rules.push("irrelevant-text"); }
         if settings.text_filter_relevant { text_rules.push("relevant-text"); }
         if !text_rules.is_empty() {
             checks.push(format!("Reject if text type is: {:?}", text_rules));
         }
    }

    if settings.check_brand_logo { checks.push("Reject ONLY if specific trademarked logo is visible (ignore clock hands, generic shapes, zippers)".to_string()); }
    if settings.check_watermark { checks.push("Reject ONLY if digital watermark/copyright stamp visible (ignore natural text)".to_string()); }
    
    // Human Vision Logic
    if settings.check_human_presence {
        let mut human_rules = Vec::new();
        if settings.human_filter_full_face { human_rules.push("full_body_perfect"); }
        if settings.human_filter_no_head { human_rules.push("no_head"); }
        if settings.human_filter_partial_perfect { human_rules.push("partial_perfect"); }
        if settings.human_filter_partial_defect { human_rules.push("partial_defect"); }
        if settings.human_filter_back_view { human_rules.push("back_view"); }
        if settings.human_filter_unclear { human_rules.push("unclear_hybrid"); }
        if settings.human_filter_face_only { human_rules.push("face_only"); }
        if settings.human_filter_nudity { human_rules.push("nudity_nsfw"); }
        if !human_rules.is_empty() {
             checks.push(format!("Reject if human matches: {:?}", human_rules));
        }
    }

    // Animal Vision Logic
    if settings.check_animal_presence {
        let mut animal_rules = Vec::new();
        if settings.animal_filter_full_face { animal_rules.push("full_body_perfect"); }
        if settings.animal_filter_no_head { animal_rules.push("no_head"); }
        if settings.animal_filter_partial_perfect { animal_rules.push("partial_perfect"); }
        if settings.animal_filter_partial_defect { animal_rules.push("partial_defect"); }
        if settings.animal_filter_back_view { animal_rules.push("back_view"); }
        if settings.animal_filter_unclear { animal_rules.push("unclear_hybrid"); }
        if settings.animal_filter_face_only { animal_rules.push("face_only"); }
        if settings.animal_filter_nudity { animal_rules.push("mating_genitals"); }
        if !animal_rules.is_empty() {
             checks.push(format!("Reject if animal matches: {:?}", animal_rules));
        }
    }

    // if settings.check_human_animal_similarity { checks.push("check_human_animal_similarity".to_string()); } // Deprecated
    if settings.check_deformed_object { checks.push("Reject if primary subject is anatomically incorrect or physically impossible (bad hands, extra limbs, melting objects). Ignore artistic abstraction.".to_string()); }
    if settings.check_unrecognizable_subject { checks.push("Reject if the main subject is indistinguishable or too abstract to identify. Ignore abstract art styles.".to_string()); }
    if settings.check_famous_trademark { checks.push("Reject if famous trademark/IP is clearly visible (e.g., Disney, Marvel, Ferrari, Apple logo, Coca-Cola). Ignore generic objects, cars without badges, or common architectural elements.".to_string()); }
    
    format!(
        "You are an AI Image Quality Inspector. Analyze this image for stock compliance.
        Enabled Checks: {:?}
        If ANY check fails, REJECT the image.
        Output JSON: {{ \"status\": \"accepted\" | \"rejected\", \"reason\": \"...\", \"failed_checks\": [...] }}",
        checks
    )
}

// --- AI CALLS ---

async fn call_ai_base(
    model: &str, 
    prompt: &str, 
    image_b64: Option<(String, String)>, 
    req: &crate::api::BatchReq
) -> Result<(String, Option<TokenUsage>, Option<String>, Option<f64>)> {
    
    let client = reqwest::Client::builder().timeout(Duration::from_secs(120)).build()?;
    let settings = crate::settings::load_settings().unwrap_or_default();
    
    // Construct System/User messages
    let messages = if let Some((b64, mime)) = &image_b64 {
        serde_json::json!([
            { "role": "system", "content": "You are a helpful assistant. Output JSON." },
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
            { "role": "system", "content": "You are a helpful assistant. Output JSON." },
            { "role": "user", "content": prompt }
        ])
    };

    let mut current_model = model.to_string();
    // Retry Loop
    let max_attempts = (req.retries as usize) + 1;
    for attempt in 0..max_attempts {
        let is_fallback = attempt > 0;
        if is_fallback {
             let m_lower = model.to_lowercase();
             if m_lower.contains("gpt") || m_lower.contains("openai") || m_lower.contains("o1") || m_lower.contains("o3") {
                 current_model = "gpt-4o-mini".to_string();
             } else if m_lower.contains("gemini-3") {
                 current_model = "gemini-2.5-flash-lite".to_string();
             } else if m_lower.contains("gemini-2.5") || m_lower.contains("gemini-1.5") {
                 current_model = "gemini-2.0-flash-lite-preview-02-05".to_string();
             } else {
                 // Default fallback
                 current_model = "gemini-2.0-flash-lite-preview-02-05".to_string();
             }
             println!("Retrying with Fallback Model: {}", current_model);
        }

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
                        let err_text = r.text().await.unwrap_or_default();
                        // Retry on any error if attempts remain
                        if attempt < max_attempts - 1 {
                            tokio::time::sleep(Duration::from_secs(2)).await;
                            continue; 
                        }
                        return Err(anyhow!("Direct API Error (URL: {}): {}", url, err_text));
                    }
                    let res_json: serde_json::Value = r.json().await?;
                    let content = res_json.pointer("/choices/0/message/content").and_then(|s| s.as_str()).unwrap_or("").to_string();
                    let usage: Option<TokenUsage> = res_json.get("usage").and_then(|u| serde_json::from_value(u.clone()).ok());
                    return Ok((content, usage, Some("direct".into()), None));
                },
                Err(e) => {
                    if attempt < max_attempts - 1 { 
                        tokio::time::sleep(Duration::from_secs(2)).await;
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
            
            let body = serde_json::json!({
                "model": current_model,
                "messages": messages, // For OpenAI/Groq
                "prompt": prompt,     // For Gemini
                "image": b64,
                "mimeType": mime
            });

            let resp = client.post(format!("{}/ai/generate", base))
                .header("Authorization", format!("Bearer {}", req.token))
                .json(&body)
                .send()
                .await;

            match resp {
                Ok(r) => {
                    if !r.status().is_success() {
                        let err_text = r.text().await.unwrap_or_default();
                         if attempt < max_attempts - 1 {
                            tokio::time::sleep(Duration::from_secs(2)).await;
                            continue; 
                        }
                        return Err(anyhow!("API Error: {}", err_text));
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
                        .or(res_json.pointer("/metadata/cost"))
                        .and_then(|v| v.as_f64());
                    
                    return Ok((content, usage, provider, cost));
                },
                Err(e) => {
                    if attempt < max_attempts - 1 { 
                        tokio::time::sleep(Duration::from_secs(2)).await;
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

pub async fn generate_batch(req: &crate::api::BatchReq) -> Result<Vec<Generated>> {
  let settings = crate::settings::load_settings().unwrap_or_default();
  let selection_on = settings.selection_enabled;
  let selection_order = settings.selection_order.as_str();
  let vision_model = &req.model;

  let mut out = Vec::new();
  let mut used_titles: HashSet<String> = HashSet::new();

  let mut files = req.files.clone();
  files.sort_by_key(|a| split_natural(a));

  for f in &files {
      // Check file existence
      if !std::path::Path::new(f).exists() { continue; }

      // Prepare Image (Vision)
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
        // CASE B: Selection -> Primary (OpenAI/Gemini) -> All Vision
        let sel_prompt = get_selection_vision_prompt(&settings);
        match call_ai_base(vision_model, &sel_prompt, img_data.clone(), req).await {
            Ok((sel_txt, usage, _, cost)) => {
                 add_usage(&mut acc_vis_usage, &mut acc_vis_cost, usage, cost);
                 let sel_res = parse_selection_json(&sel_txt);
                 if sel_res.status == "accepted" {
                     let prompt = get_primary_prompt(req, None);
                     match call_ai_base(vision_model, &prompt, img_data.clone(), req).await {
                          Ok((txt, usage, prov, cost)) => {
                              add_usage(&mut acc_vis_usage, &mut acc_vis_cost, usage, cost);
                              generated = parse_generated_json(&txt, f, vision_model, prov, acc_vis_usage.clone(), acc_vis_cost, acc_text_usage.clone(), acc_text_cost, req, Some(vision_model.to_string()), None);
                          },
                          Err(e) => last_error = e.to_string(),
                     }
                 } else {
                     last_error = format!("Rejected: {}", sel_res.reason);
                     move_to_rejected(f, &settings.output_folder, &sel_res.failed_checks, &sel_res.reason).await.ok();
                 }
            },
            Err(e) => last_error = e.to_string(),
        }
    } else {
        // CASE A & Selection After: Primary Only (OpenAI/Gemini) -> Vision
        // If Selection After, we generate first then check.
        let prompt = get_primary_prompt(req, None);
        match call_ai_base(vision_model, &prompt, img_data.clone(), req).await {
            Ok((txt, usage, prov, cost)) => {
                add_usage(&mut acc_vis_usage, &mut acc_vis_cost, usage, cost);
                let mut temp_gen = parse_generated_json(&txt, f, vision_model, prov, acc_vis_usage.clone(), acc_vis_cost, acc_text_usage.clone(), acc_text_cost, req, Some(vision_model.to_string()), None);
                
          if let Some(ref mut _g) = temp_gen {
              if selection_on && selection_order == "after" {
                   // Selection After Generate
                   let sel_prompt = get_selection_vision_prompt(&settings);
                   match call_ai_base(vision_model, &sel_prompt, img_data.clone(), req).await {
                       Ok((sel_txt, usage, _, cost)) => {
                           add_usage(&mut acc_vis_usage, &mut acc_vis_cost, usage, cost);
                           let sel_res = parse_selection_json(&sel_txt);
                           if sel_res.status == "accepted" {
                               generated = temp_gen;
                           } else {
                               last_error = format!("Rejected: {}", sel_res.reason);
                               if let Some(ref g) = temp_gen {
                                   move_to_rejected_with_metadata(f, &settings.output_folder, &sel_res.failed_checks, &sel_res.reason, g).await.ok();
                               } else {
                                   move_to_rejected(f, &settings.output_folder, &sel_res.failed_checks, &sel_res.reason).await.ok();
                               }
                               generated = None;
                           }
                       },
                       Err(e) => last_error = e.to_string(),
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
           // Push Error Result with accumulated usage/cost
           out.push(Generated {
                file: f.clone(), file_path: f.clone(),
                title: "ERROR".into(), description: last_error, keywords: vec![], category: "".into(),
                source: "error".into(), selection_status: None, failed_checks: None, reason: None, gen_provider: None, 
                input_tokens: Some(acc_vis_usage.prompt_tokens + acc_text_usage.prompt_tokens), 
                output_tokens: Some(acc_vis_usage.completion_tokens + acc_text_usage.completion_tokens), 
                cost: Some(acc_vis_cost + acc_text_cost),
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
            selection_status: None,
            failed_checks: None,
            reason: None,
            gen_provider: provider,
            input_tokens: Some(total_input),
            output_tokens: Some(total_output),
            cost: Some(total_cost),
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
        None
    }
}

fn parse_selection_json(txt: &str) -> SelectionResult {
    let clean = txt.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(clean) {
        SelectionResult {
            status: parsed["status"].as_str().unwrap_or("rejected").to_string(),
            failed_checks: parsed["failed_checks"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect::<Vec<String>>()).unwrap_or_default(),
            reason: parsed["reason"].as_str().unwrap_or("").to_string(),
            usage: None
        }
    } else {
        // Try to find JSON object {} if surrounded by text
        if let Some(start) = clean.find('{') {
            if let Some(end) = clean.rfind('}') {
                if end > start {
                    let potential_json = &clean[start..=end];
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(potential_json) {
                         return SelectionResult {
                            status: parsed["status"].as_str().unwrap_or("rejected").to_string(),
                            failed_checks: parsed["failed_checks"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect::<Vec<String>>()).unwrap_or_default(),
                            reason: parsed["reason"].as_str().unwrap_or("").to_string(),
                            usage: None
                        };
                    }
                }
            }
        }
        SelectionResult { status: "rejected".into(), failed_checks: vec![], reason: "Unrecognized Response".into(), usage: None }
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

fn valid(g: &Generated, req: &crate::api::BatchReq) -> bool {
  let tw = g.title.split_whitespace().count() as u32;
  let dl = g.description.chars().count() as u32;
  let kw = g.keywords.len() as u32;
  let dl_max = req.description_max_chars + 15; 
  let kw_max = req.keywords_max_count + 3; 
  let tw_max = req.title_max_words + 2; 
  tw >= req.title_min_words && tw <= tw_max && 
  dl >= req.description_min_chars && dl <= dl_max && 
  kw >= req.keywords_min_count && kw <= kw_max
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
        // Read file with retry
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
    };
    
    // Resize if needed (for images) or re-encode
    // Optimization: Decode only dimensions first to check if we can skip full load
    // BUT image crate doesn't support easy "header only" check without creating a Reader
    // For now, let's trust the user's files are standard.
    
    // FAST PATH 1: If file is very small (< 60KB), assume it's already a thumbnail
    if buf.len() < 60 * 1024 { 
        let is_jpeg = buf.len() > 2 && buf[0] == 0xFF && buf[1] == 0xD8;
        if is_jpeg {
             let b64 = BASE64_STANDARD.encode(&buf);
             let mime = "image/jpeg".to_string();
             cache_set(path.to_string(), (b64.clone(), mime.clone()));
             return Ok((b64, mime));
        }
    }

    // Header-only check to avoid full decode if dimensions are already small
    // This saves CPU by not decoding pixels for small-dimension but large-files (e.g. uncompressed)
    let cursor = Cursor::new(&buf);
    if let Ok(reader) = ImageReader::new(cursor).with_guessed_format() {
        if let Ok((w, h)) = reader.into_dimensions() {
            if w <= 768 && h <= 768 {
                // Dimensions are small enough, check if file size is reasonable (< 150KB)
                if buf.len() < 150 * 1024 {
                     // Check if it's JPEG
                     let is_jpeg = buf.len() > 2 && buf[0] == 0xFF && buf[1] == 0xD8;
                     if is_jpeg {
                        let b64 = BASE64_STANDARD.encode(&buf);
                        let mime = "image/jpeg".to_string();
                        cache_set(path.to_string(), (b64.clone(), mime.clone()));
                        return Ok((b64, mime));
                     }
                }
            }
        }
    }

    // SLOW PATH: Decode, Resize, Re-encode
    let img = image::load_from_memory(&buf)?;
    let (w, h) = img.dimensions();
    
    // Target 768px max dimension for optimal AI analysis while keeping size small
    let (nw, nh) = if w > 768 || h > 768 {
        if w > h { (768, (768.0 * h as f32 / w as f32) as u32) }
        else { ((768.0 * w as f32 / h as f32) as u32, 768) }
    } else { (w, h) };
    
    // Always resize/re-encode to ensure consistent JPEG format for API
    // Use Triangle for better quality/speed balance than Nearest (too jagged)
    let resized = img.resize(nw, nh, FilterType::Triangle);
    let mut out = Cursor::new(Vec::new());
    // Quality 60 is the sweet spot for <50KB thumbnails at ~768px
    resized.write_to(&mut out, image::ImageOutputFormat::Jpeg(60))?;
    
    let b64 = BASE64_STANDARD.encode(out.get_ref());
    let mime = "image/jpeg".to_string();
    
    cache_set(path.to_string(), (b64.clone(), mime.clone()));
    Ok((b64, mime))
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

    if f.contains("json parse error") || f.contains("unrecognized response") { return "AI_Response_Error".to_string(); }

    String::new()
}

pub async fn move_to_rejected_with_metadata(
    file_path: &str, 
    output_folder: &str, 
    reasons: &[String], 
    main_reason: &str,
    gen: &Generated
) -> Result<()> {
    if output_folder.is_empty() { return Ok(()); }
    let rej_dir = PathBuf::from(output_folder).join("rejected");
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
    
    args.push(dest_path.to_string_lossy().to_string());
    
    let _ = Command::new(exiftool)
        .args(args)
        .creation_flags(0x08000000)
        .output(); // Ignore error if writing metadata fails, at least file is there

    Ok(())
}

pub async fn move_to_rejected(file_path: &str, output_folder: &str, reasons: &[String], main_reason: &str) -> Result<()> {
    if output_folder.is_empty() { return Ok(()); }
    let rej_dir = PathBuf::from(output_folder).join("rejected");
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
    
    if target != source {
        if let Some(parent) = target.parent() { let _ = fs::create_dir_all(parent); }
        if fs::rename(source, &target).is_err() {
            fs::copy(source, &target)?;
            if source.exists() {
                let mut del_attempts = 0;
                loop {
                    del_attempts += 1;
                    match fs::remove_file(source) {
                        Ok(_) => break,
                        Err(_) => {
                            if del_attempts >= 5 { break; }
                            tokio::time::sleep(Duration::from_millis(500)).await;
                        }
                    }
                }
            }
        }
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
    
    args.push(target.to_string_lossy().to_string());
    
    let out = Command::new(exiftool)
        .args(args)
        .creation_flags(0x08000000)
        .output()?;
        
    if !out.status.success() {
        return Err(anyhow!("{}", String::from_utf8_lossy(&out.stderr)));
    }
    
    // Rename File if enabled
    let new_path = apply_file_rename(&target, &req.title)?;
    
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
