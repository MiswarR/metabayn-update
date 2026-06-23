use anyhow::Result;
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs::{create_dir_all, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::{collections::VecDeque, fs::File};
use tauri::State;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LoginReq {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScanResult {
    pub files: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ImageMetaReq {
    pub file: String,
    pub output_file: Option<String>,
    pub title: String,
    pub description: String,
    pub keywords: Vec<String>,
    pub creator: String,
    pub copyright: String,
    pub overwrite: bool,
    pub auto_embed: bool,
    pub category: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VideoMetaReq {
    pub file: String,
    pub output_file: Option<String>,
    pub title: String,
    pub description: String,
    pub keywords: Vec<String>,
    pub overwrite: bool,
    pub auto_embed: bool,
    pub category: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResizeMediaReq {
    pub input_folder: String,
    pub output_folder: String,
    #[serde(default)]
    pub recurse: bool,
    #[serde(default)]
    pub delete_original: bool,
    pub width: u32,
    pub height: u32,
    pub keep_aspect: bool,
    pub format: String,
    pub quality: u8,
}

fn default_true() -> bool { true }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConvertMediaReq {
    pub input_folder: String,
    pub output_folder: String,
    #[serde(default)]
    pub delete_original: bool,
    #[serde(default = "default_true")]
    pub keep_metadata: bool,
    pub format: String,
    pub quality: u8,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BatchReq {
    pub files: Vec<String>,
    pub model: String,
    pub token: String,
    pub retries: u8,
    pub title_min_words: u32,
    pub title_max_words: u32,
    pub description_min_chars: u32,
    pub description_max_chars: u32,
    pub keywords_min_count: u32,
    pub keywords_max_count: u32,
    pub banned_words: String,
    pub max_threads: u32,
    #[serde(default)]
    pub connection_mode: String,
    pub api_key: Option<String>,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub request_timeout_sec: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PromptGrabberScanItem {
    pub file_path: String,
    pub file_name: String,
    pub kind: String,
    pub width: u32,
    pub height: u32,
    pub thumb_data_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PromptGrabberReq {
    pub files: Vec<String>,
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub connection_mode: String,
    pub api_key: Option<String>,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub retries: u8,
    #[serde(default)]
    pub request_timeout_sec: Option<u64>,
    #[serde(default)]
    pub max_threads: Option<u32>,
    pub platform: String,
    pub detail_level: String,
    pub language: String,
    #[serde(default)]
    pub extra_prompt: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PromptGrabberResult {
    pub file_path: String,
    pub file_name: String,
    pub kind: String,
    pub prompt: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PromptGrabberThumbItem {
    pub file_path: String,
    pub thumb_data_url: Option<String>,
}

#[tauri::command]
pub async fn login(
    req: LoginReq,
    security: State<'_, crate::security::SecurityService>,
    audit: State<'_, crate::audit::AuditService>,
) -> Result<crate::auth::LoginResponse, String> {
    if !security.check_rate_limit() {
        audit.log(crate::audit::AuditEventType::SecurityAlert, "Login rate limited", "Blocked", None);
        return Err("Rate limit exceeded".to_string());
    }

    match crate::auth::login(req.email, req.password).await {
        Ok(res) => {
            audit.log(crate::audit::AuditEventType::Login, "Login", "Success", None);
            Ok(res)
        }
        Err(e) => {
            audit.log(crate::audit::AuditEventType::Login, "Login", "Failed", None);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn refresh_balance(token: String) -> Result<f64, String> {
    crate::token::refresh_balance(token)
        .await
        .map_err(|e| e.to_string())
}

fn is_hidden_name(name: &str) -> bool {
    if name.starts_with('.')
        || name.starts_with('~')
        || name == "Thumbs.db"
        || name == "desktop.ini"
        || name == "$RECYCLE.BIN"
        || name == "System Volume Information"
        || name == "__MACOSX"
        || name == "node_modules"
    {
        return true;
    }

    name.ends_with(".tmp")
        || name.ends_with(".bak")
        || name.ends_with(".log")
        || name.ends_with(".dat")
        || name.ends_with(".ini")
}

fn read_exif_orientation(path: &Path) -> Option<u32> {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !matches!(ext.as_str(), "jpg" | "jpeg" | "tif" | "tiff") {
        return None;
    }

    let file = std::fs::File::open(path).ok()?;
    let mut buf = std::io::BufReader::new(file);
    let exif = exif::Reader::new().read_from_container(&mut buf).ok()?;
    let field = exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY)?;
    field.value.get_uint(0).map(|v| v as u32)
}

fn apply_exif_orientation(img: image::DynamicImage, orientation: u32) -> image::DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.fliph().rotate270(),
        6 => img.rotate90(),
        7 => img.fliph().rotate90(),
        8 => img.rotate270(),
        _ => img,
    }
}

#[tauri::command]
pub async fn scan_folder(input: String) -> Result<ScanResult, String> {
    use walkdir::WalkDir;

    let root = std::path::Path::new(&input);
    if !root.exists() {
        return Ok(ScanResult { files: vec![] });
    }

    let mut out: Vec<String> = Vec::new();
    for entry in WalkDir::new(root).max_depth(1).follow_links(false).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_dir() {
            if let Some(name) = entry.file_name().to_str() {
                if is_hidden_name(name) {
                    continue;
                }
            }
            continue;
        }

        let path = entry.path();
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if is_hidden_name(name) {
            continue;
        }

        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        let supported = matches!(
            ext.as_str(),
            "jpg" | "jpeg" | "png" | "webp" | "eps" | "mp4" | "mov" | "mkv" | "avi" | "webm"
        );
        if supported {
            out.push(path.to_string_lossy().to_string());
        }
    }

    Ok(ScanResult { files: out })
}

#[tauri::command]
pub async fn scan_csv_files(input: String) -> Result<ScanResult, String> {
    let root = std::path::Path::new(&input);
    if !root.exists() {
        return Ok(ScanResult { files: vec![] });
    }

    let mut out: Vec<String> = Vec::new();
    // Use read_dir for non-recursive, robust scanning
    match std::fs::read_dir(root) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                    if is_hidden_name(name) {
                        continue;
                    }

                    if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                        if ext.eq_ignore_ascii_case("csv") {
                            out.push(path.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
        Err(_) => {
            // If read_dir fails (e.g. permissions), return empty list instead of error to avoid crashing frontend logic
            return Ok(ScanResult { files: vec![] });
        }
    }

    Ok(ScanResult { files: out })
}

#[tauri::command]
pub async fn write_image_metadata(req: ImageMetaReq) -> Result<Option<String>, String> {
    crate::metadata::write_image(&req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_video_metadata(req: VideoMetaReq) -> Result<Option<String>, String> {
    crate::video::write_video(&req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn generate_csv_from_folder(
    window: tauri::Window,
    input_folder: String,
    output_folder: String,
    api_key: Option<String>,
    token: Option<String>,
    auto_stop_enabled: Option<bool>,
    auto_stop_fail_threshold: Option<u32>,
    request_timeout_sec: Option<u64>,
) -> Result<String, String> {
    crate::metadata::generate_csv_from_folder(
        window,
        &input_folder,
        &output_folder,
        api_key,
        token,
        auto_stop_enabled,
        auto_stop_fail_threshold,
        request_timeout_sec,
    )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn strip_metadata_batch(window: tauri::Window, input_folder: String, recurse: Option<bool>) -> Result<String, String> {
    crate::metadata::strip_metadata_batch(window, &input_folder, recurse.unwrap_or(true))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn detect_duplicate_images(window: tauri::Window, input_folder: String, auto_delete: Option<bool>, threshold: Option<u8>) -> Result<String, String> {
    let auto = auto_delete.unwrap_or(true);
    let thr = threshold.unwrap_or(3);
    crate::duplicates::detect_duplicates(window, &input_folder, auto, thr)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn append_csv(path: String, row: Vec<String>) -> Result<(), String> {
    crate::csv::append_row(&path, row)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_machine_hash() -> Result<String, String> {
    crate::anti_clone::machine_hash().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn generate_metadata_batch(req: BatchReq, audit: State<'_, crate::audit::AuditService>) -> Result<Vec<crate::metadata::Generated>, String> {
    crate::metadata::clear_cancel_generate_batch();
    audit.log(
        crate::audit::AuditEventType::Error,
        &format!(
            "GenerateBatch start: files={} provider={} model={} mode={}",
            req.files.len(),
            req.provider,
            req.model,
            req.connection_mode
        ),
        "Start",
        None,
    );

    let out = crate::metadata::generate_batch(&req).await;
    match out {
        Ok(v) => {
            audit.log(
                crate::audit::AuditEventType::Error,
                &format!("GenerateBatch end: ok files={} results={}", req.files.len(), v.len()),
                "Ok",
                None,
            );
            Ok(v)
        }
        Err(e) => {
            audit.log(
                crate::audit::AuditEventType::Error,
                &format!("GenerateBatch end: err files={} err={}", req.files.len(), e),
                "Failed",
                None,
            );
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn cancel_generate_metadata_batch(audit: State<'_, crate::audit::AuditService>) -> Result<(), String> {
    crate::metadata::request_cancel_generate_batch();
    let active = crate::metadata::active_generate_batch_count();
    audit.log(
        crate::audit::AuditEventType::Error,
        &format!("GenerateBatch cancel requested (active_batch={})", active),
        "Ok",
        None,
    );
    Ok(())
}

#[tauri::command]
pub async fn prompt_grabber_scan_folder(
    window: tauri::Window,
    input_folder: String,
    recurse: Option<bool>,
    min_size: Option<u32>,
    max_files: Option<u32>,
) -> Result<Vec<PromptGrabberScanItem>, String> {
    crate::metadata::clear_cancel_prompt_grabber();
    crate::metadata::prompt_grabber_scan_folder(
        window,
        &input_folder,
        recurse.unwrap_or(false),
        min_size.unwrap_or(0),
        max_files.unwrap_or(0),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn prompt_grabber_scan_folder_fast(
    window: tauri::Window,
    input_folder: String,
    recurse: Option<bool>,
    min_size: Option<u32>,
    max_files: Option<u32>,
) -> Result<Vec<PromptGrabberScanItem>, String> {
    crate::metadata::clear_cancel_prompt_grabber();
    crate::metadata::prompt_grabber_scan_folder_fast(
        window,
        &input_folder,
        recurse.unwrap_or(false),
        min_size.unwrap_or(0),
        max_files.unwrap_or(0),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn prompt_grabber_get_thumbnails(
    window: tauri::Window,
    files: Vec<String>,
) -> Result<Vec<PromptGrabberThumbItem>, String> {
    crate::metadata::prompt_grabber_get_thumbnails(window, files)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn prompt_grabber_generate(
    window: tauri::Window,
    req: PromptGrabberReq,
) -> Result<Vec<PromptGrabberResult>, String> {
    crate::metadata::clear_cancel_prompt_grabber();
    crate::metadata::prompt_grabber_generate(window, req)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn pg_long_path(p: &str) -> std::path::PathBuf {
    let s = p.trim();
    if s.is_empty() {
        return std::path::PathBuf::new();
    }
    if s.starts_with(r"\\?\") {
        return std::path::PathBuf::from(s);
    }
    if s.starts_with(r"\\") {
        let rest = s.trim_start_matches(r"\\");
        return std::path::PathBuf::from(format!(r"\\?\UNC\{}", rest));
    }
    std::path::PathBuf::from(format!(r"\\?\{}", s))
}

#[cfg(not(target_os = "windows"))]
fn pg_long_path(p: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(p)
}

#[tauri::command]
pub async fn prompt_grabber_save_txt(input_folder: String, content: String) -> Result<String, String> {
    let folder = pg_long_path(&input_folder);
    if !folder.is_dir() {
        return Err("Input folder tidak ditemukan".to_string());
    }
    if content.trim().is_empty() {
        return Err("Output kosong".to_string());
    }
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let file_name = format!("prompt_grabber_output_{}.txt", ts);
    let out_path = folder.join(file_name);
    std::fs::write(&out_path, content).map_err(|e| e.to_string())?;
    Ok(out_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn prompt_grabber_save_file(
    input_folder: String,
    file_name: String,
    content: String,
) -> Result<String, String> {
    let folder = pg_long_path(&input_folder);
    if !folder.is_dir() {
        return Err("Input folder tidak ditemukan".to_string());
    }
    if content.trim().is_empty() {
        return Err("Output kosong".to_string());
    }
    let file_name = file_name.trim().to_string();
    if file_name.is_empty() {
        return Err("Nama file kosong".to_string());
    }
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains(':') || file_name.contains("..") {
        return Err("Nama file tidak valid".to_string());
    }
    let out_path = folder.join(file_name);
    std::fs::write(&out_path, content).map_err(|e| e.to_string())?;
    Ok(out_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn cancel_prompt_grabber() -> Result<(), String> {
    crate::metadata::request_cancel_prompt_grabber();
    Ok(())
}

#[tauri::command]
pub async fn cancel_generate_csv_tools() -> Result<(), String> {
    crate::metadata::request_stop_csv_tools_scheduling();
    Ok(())
}

#[tauri::command]
pub async fn move_file_to_rejected(
    file_path: String,
    output_folder: String,
    reasons: Vec<String>,
    main_reason: String,
) -> Result<(), String> {
    crate::metadata::move_to_rejected(&file_path, &output_folder, &reasons, &main_reason)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_file_to_rejected_with_meta(
    file_path: String,
    output_folder: String,
    reasons: Vec<String>,
    main_reason: String,
    gen: crate::metadata::Generated,
) -> Result<(), String> {
    crate::metadata::move_to_rejected_with_metadata(&file_path, &output_folder, &reasons, &main_reason, &gen)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_settings() -> Result<crate::settings::AppSettings, String> {
    crate::settings::load_settings().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_settings(settings: crate::settings::AppSettings) -> Result<(), String> {
    // Ignore errors when saving settings to avoid crashing the app
    let _ = crate::settings::save_settings(&settings);
    Ok(())
}

#[tauri::command]
pub async fn save_auth_token(token: String) -> Result<(), String> {
    crate::settings::save_auth_token(&token).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn logout() -> Result<(), String> {
    crate::settings::save_auth_token("").map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn file_exists(path: String) -> Result<bool, String> {
    Ok(std::path::Path::new(&path).exists())
}

#[tauri::command]
pub async fn encrypt_app_token(token: String) -> Result<String, String> {
    crate::crypto_utils::encrypt_token(&token)
}

#[tauri::command]
pub async fn check_subscription_status(
    state: State<'_, crate::subscription::SubscriptionState>,
) -> Result<crate::subscription::SubscriptionStatus, String> {
    Ok(crate::subscription::check_subscription_status(&state))
}

#[tauri::command]
pub async fn activate_subscription_mock(state: State<'_, crate::subscription::SubscriptionState>) -> Result<(), String> {
    crate::subscription::activate_mock(&state);
    Ok(())
}

fn parse_audit_type(s: &str) -> crate::audit::AuditEventType {
    match s.to_lowercase().as_str() {
        "login" => crate::audit::AuditEventType::Login,
        "logout" => crate::audit::AuditEventType::Logout,
        "tokenrefresh" | "token_refresh" => crate::audit::AuditEventType::TokenRefresh,
        "modeswitch" | "mode_switch" => crate::audit::AuditEventType::ModeSwitch,
        "apikeyusage" | "api_key_usage" => crate::audit::AuditEventType::ApiKeyUsage,
        "subscriptioncheck" | "subscription_check" => crate::audit::AuditEventType::SubscriptionCheck,
        "securityalert" | "security_alert" => crate::audit::AuditEventType::SecurityAlert,
        _ => crate::audit::AuditEventType::Error,
    }
}

#[tauri::command]
pub async fn log_audit_event(
    event_type: String,
    context: String,
    status: String,
    audit: State<'_, crate::audit::AuditService>,
) -> Result<(), String> {
    let event = parse_audit_type(&event_type);
    audit.log(event, &context, &status, None);
    Ok(())
}

#[tauri::command]
pub async fn read_audit_logs(
    limit: Option<u32>,
    audit: State<'_, crate::audit::AuditService>,
) -> Result<Vec<crate::audit::AuditEntry>, String> {
    let lim = limit.unwrap_or(200).clamp(1, 2000) as usize;
    let log_path = audit
        .state
        .lock()
        .map_err(|_| "Audit state locked".to_string())?
        .as_ref()
        .map(|s| s.log_path.clone())
        .unwrap_or_default();

    if log_path.trim().is_empty() {
        return Ok(vec![]);
    }

    let file = match File::open(&log_path) {
        Ok(f) => f,
        Err(_) => return Ok(vec![]),
    };

    let mut buf: VecDeque<crate::audit::AuditEntry> = VecDeque::with_capacity(lim + 1);
    let reader = BufReader::new(file);
    for line in reader.lines().flatten() {
        if let Ok(entry) = serde_json::from_str::<crate::audit::AuditEntry>(&line) {
            buf.push_back(entry);
            if buf.len() > lim {
                buf.pop_front();
            }
        }
    }

    Ok(buf.into_iter().collect())
}

#[tauri::command]
pub async fn test_api_connection(provider: String, api_key: String, endpoint: Option<String>) -> Result<String, String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("Missing API key".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let res = if provider == "OpenAI" {
        client
            .get("https://api.openai.com/v1/models")
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
    } else if provider == "Grok" {
        // X.ai (Grok) - OpenAI-compatible API
        client
            .get("https://api.x.ai/v1/models")
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
    } else if provider == "Groq" {
        return Err("Groq provider is not available. Please use Gemini, OpenAI, Grok, or OpenRouter instead.".to_string());
    } else if provider == "Anthropic" || provider == "Claude" {
        client
            .get("https://api.anthropic.com/v1/models")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .send()
            .await
    } else if provider == "OpenRouter" {
        let url = endpoint.unwrap_or_else(|| "https://openrouter.ai/api/v1/chat/completions".to_string());
        let target_url = if url.ends_with("/chat/completions") {
            url.replace("/chat/completions", "/models")
        } else if url.ends_with("/v1") {
            url.replace("/v1", "/models")
        } else {
            format!("{}/models", url.trim_end_matches('/'))
        };

        client
            .get(target_url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("HTTP-Referer", "https://metabayn.com")
            .header("X-Title", "Metabayn Studio")
            .send()
            .await
    } else {
        // Default to Gemini (Google)
        // Note: Gemini uses query param 'key'
        client
            .get(format!(
                "https://generativelanguage.googleapis.com/v1beta/models?key={}",
                api_key
            ))
            .send()
            .await
    };

    match res {
        Ok(resp) => {
            if resp.status().is_success() {
                Ok("Success".to_string())
            } else {
                let status = resp.status();
                let err_text = resp.text().await.unwrap_or_default();
                let lower = err_text.to_lowercase();
                // A 403/permission-denied that mentions credit/billing/license/quota means
                // the API key itself authenticated successfully (it is VALID) but the
                // provider account simply has no usable credit/billing yet. This is an
                // account/billing matter on the provider side, not a wrong key or app bug.
                if status.as_u16() == 403
                    && (lower.contains("credit")
                        || lower.contains("licen")
                        || lower.contains("billing")
                        || lower.contains("permission-denied")
                        || lower.contains("quota"))
                {
                    return Err(format!(
                        "API key valid, but your {} account has no active credit/billing yet. Add credit/billing in the provider console, then try again. Provider says: {}",
                        provider, err_text
                    ));
                }
                // If 404/405 (Method Not Allowed) on Worker, it might still mean the worker is reachable but doesn't support GET /models
                // But usually we want 200 OK.
                Err(format!("Connection Failed ({}): {}", status, err_text))
            }
        }
        Err(e) => Err(format!("Network Error: {}", e)),
    }
}

#[derive(Debug, Deserialize)]
struct OpenAiModelItem {
    id: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiModelsResponse {
    data: Vec<OpenAiModelItem>,
}

#[tauri::command]
pub async fn list_openai_models(api_key: String) -> Result<Vec<String>, String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("Missing API key".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get("https://api.openai.com/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Network Error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("Connection Failed ({}): {}", status, err_text));
    }

    let parsed = resp
        .json::<OpenAiModelsResponse>()
        .await
        .map_err(|e| e.to_string())?;

    let mut out: Vec<String> = parsed
        .data
        .into_iter()
        .map(|m| m.id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();

    out.sort();
    out.dedup();
    Ok(out)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenRouterUsage {
    pub label: String,
    pub usage: f64,
    pub limit: Option<f64>,
    pub is_limit_enabled: bool,
}

#[tauri::command]
pub async fn get_openrouter_usage(endpoint: Option<String>) -> Result<OpenRouterUsage, String> {
    let url = endpoint.unwrap_or("https://metabayn-backend.metabayn.workers.dev/v1/chat/completions".to_string());
    
    // Construct target URL for OpenRouter key info
    // Standard OpenRouter endpoint for key info is https://openrouter.ai/api/v1/auth/key
    // We assume the worker proxies this path or exposes a specific /auth/key endpoint
    let target = if url.ends_with("/v1/chat/completions") {
        url.replace("/v1/chat/completions", "/auth/key")
    } else {
        let base = url.trim_end_matches('/');
        if base.ends_with("/v1") {
             base.replace("/v1", "/auth/key")
        } else {
             format!("{}/auth/key", base)
        }
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    // Get auth token from settings for OpenRouter via Worker
    let settings = crate::settings::load_settings().unwrap_or_default();
    let mut auth_token = settings.auth_token;
    if auth_token.starts_with("enc:") {
        if let Ok(dec) = crate::crypto_utils::decrypt_token(&auth_token[4..]) {
            auth_token = dec;
        }
    }

    let res = client.get(&target)
        .header("Authorization", format!("Bearer {}", auth_token))
        .send().await.map_err(|e| e.to_string())?;
    
    if res.status().is_success() {
        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        // Parse OpenRouter response structure (proxied by Worker)
        // Expected format from OpenRouter /auth/key:
        // { "data": { "label": "...", "usage": 1.23, "limit": 10, "is_limit_enabled": true } }
        if let Some(data) = json.get("data") {
             Ok(OpenRouterUsage {
                label: data["label"].as_str().unwrap_or("Unknown").to_string(),
                usage: data["usage"].as_f64().unwrap_or(0.0),
                limit: data["limit"].as_f64(),
                is_limit_enabled: data["is_limit_enabled"].as_bool().unwrap_or(false),
            })
        } else {
            // Fallback if worker returns flat structure
             Ok(OpenRouterUsage {
                label: json["label"].as_str().unwrap_or("Unknown").to_string(),
                usage: json["usage"].as_f64().unwrap_or(0.0),
                limit: json["limit"].as_f64(),
                is_limit_enabled: json["is_limit_enabled"].as_bool().unwrap_or(false),
            })
        }
    } else {
        Err(format!("Failed to fetch usage: {} - {}", res.status(), res.text().await.unwrap_or_default()))
    }
}

#[tauri::command]
pub async fn run_ai_clustering(window: tauri::Window, input_folder: String, threshold: f64) -> Result<String, String> {
    crate::ai_cluster::run_clustering(window, &input_folder, threshold)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_profit_margin(margin: f64) -> Result<(), String> {
    let mut settings = crate::settings::load_settings().map_err(|e| e.to_string())?;
    settings.profit_margin_percent = margin;
    // Ignore errors when saving settings to avoid crashing the app
    let _ = crate::settings::save_settings(&settings);
    Ok(())
}

#[tauri::command]
pub async fn append_cost_log(app: tauri::AppHandle, line: String) -> Result<String, String> {
    let settings = crate::settings::load_settings().unwrap_or_default();
    let base = if !settings.logs_path.trim().is_empty() {
        PathBuf::from(settings.logs_path)
    } else {
        app.path_resolver()
            .app_data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("logs")
    };
    create_dir_all(&base).map_err(|e| e.to_string())?;

    let file_name = format!("cost-{}.log", Local::now().format("%Y-%m-%d"));
    let file_path = base.join(file_name);
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{}", line).map_err(|e| e.to_string())?;
    Ok(file_path.to_string_lossy().to_string())
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

fn resolve_exiftool() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    fn is_probably_valid_windows_exe(p: &Path) -> bool {
        // ExifTool exe typically ~50-60KB on Windows, reject files < 10KB as clearly broken
        std::fs::metadata(p).map(|m| m.len() >= 10_000).unwrap_or(false)
    }

    if let Ok(p) = which::which("exiftool") {
        #[cfg(target_os = "windows")]
        {
            if is_probably_valid_windows_exe(&p) { return Some(p); }
        }
        #[cfg(not(target_os = "windows"))]
        {
            return Some(p);
        }
    }
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

        for c in &candidates {
            if !c.exists() { continue; }
            #[cfg(target_os = "windows")]
            {
                if !is_probably_valid_windows_exe(c) { continue; }
            }
            return Some(c.clone());
        }
    }
    None
}

fn read_orientation_via_exiftool(path: &Path) -> Option<u32> {
    let exiftool = resolve_exiftool()?;
    let mut cmd = std::process::Command::new(exiftool);
    cmd.args([
        "-s",
        "-s",
        "-s",
        "-n",
        "-Orientation",
        path.to_string_lossy().as_ref(),
    ]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        return None;
    }
    s.parse::<u32>().ok()
}

fn resolve_magick() -> Option<PathBuf> {
    if let Ok(p) = which::which("magick") { return Some(p); }
    if let Ok(exe) = std::env::current_exe() {
        let base = exe.parent().unwrap_or_else(|| Path::new("."));
        
        #[cfg(target_os = "windows")]
        let candidates = [
            base.join("resources").join("magick.exe"),
            base.join("magick.exe"),
            base.parent().unwrap_or(base).join("resources").join("magick.exe"),
            base.join("../../src-tauri/resources/magick.exe"),
        ];

        #[cfg(not(target_os = "windows"))]
        let candidates = [
            base.join("resources").join("magick"),
            base.join("magick"),
            base.parent().unwrap_or(base).join("resources").join("magick"),
            base.join("../../src-tauri/resources/magick"),
        ];

        for c in &candidates { if c.exists() { return Some(c.clone()); } }
    }

    #[cfg(target_os = "windows")]
    {
        fn try_find_in_program_files(root: &str) -> Option<PathBuf> {
            let pf = PathBuf::from(root);
            if !pf.exists() { return None; }
            let dir = match std::fs::read_dir(&pf) {
                Ok(v) => v,
                Err(_) => return None,
            };
            for e in dir.flatten() {
                let p = e.path();
                if !p.is_dir() { continue; }
                let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
                if !name.starts_with("ImageMagick-") { continue; }
                let magick = p.join("magick.exe");
                if magick.exists() { return Some(magick); }
            }
            None
        }

        if let Ok(pf) = std::env::var("ProgramFiles") {
            if let Some(p) = try_find_in_program_files(&pf) { return Some(p); }
        }
        if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
            if let Some(p) = try_find_in_program_files(&pf86) { return Some(p); }
        }
    }
    None
}

#[tauri::command]
pub async fn list_convert_formats() -> Result<Vec<String>, String> {
    use std::collections::BTreeSet;

    let magick = resolve_magick().ok_or_else(|| "Conversion engine not found.".to_string())?;
    let mut cmd = std::process::Command::new(&magick);
    cmd.args(["-list", "format"]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(if stderr.trim().is_empty() {
            "Failed to list formats.".to_string()
        } else {
            stderr
        });
    }

    let text = String::from_utf8_lossy(&out.stdout);
    let mut set: BTreeSet<String> = BTreeSet::new();
    for line in text.lines() {
        let l = line.trim();
        if l.is_empty() {
            continue;
        }
        if l.starts_with("Format") || l.starts_with('-') {
            continue;
        }
        let parts: Vec<&str> = l.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }
        let format_token = parts[0];
        let mode = parts[2];
        if !mode.contains('w') {
            continue;
        }
        let trimmed = format_token.trim_matches(|c: char| !c.is_ascii_alphanumeric());
        if trimmed.is_empty() {
            continue;
        }
        set.insert(trimmed.to_ascii_lowercase());
    }

    if set.is_empty() {
        return Err("No writable formats detected.".to_string());
    }

    Ok(set.into_iter().collect())
}

#[tauri::command]
pub async fn resize_media_batch(window: tauri::Window, req: ResizeMediaReq) -> Result<String, String> {
    use image::GenericImageView;
    use image::io::Reader as ImageReader;
    use walkdir::WalkDir;

    let input_path = std::path::Path::new(&req.input_folder);
    if !input_path.exists() || !input_path.is_dir() {
        return Err("Input folder does not exist or is not a directory".to_string());
    }

    let output_path = std::path::Path::new(&req.output_folder);
    if !output_path.exists() {
        create_dir_all(output_path).map_err(|e| format!("Failed to create output folder: {}", e))?;
    }

    let _ = window.emit(
        "resize_log",
        serde_json::json!({
            "code": "RESIZE_CONFIG",
            "status": "info",
            "file": req.input_folder,
            "input_folder": req.input_folder,
            "output_folder": req.output_folder,
            "delete_original": req.delete_original,
            "width": req.width,
            "height": req.height,
            "keep_aspect": req.keep_aspect,
            "format": req.format,
            "quality": req.quality
        }),
    );

    let magick = resolve_magick();
    if let Some(ref p) = magick {
        let _ = window.emit(
            "resize_log",
            serde_json::json!({
                "code": "RESIZE_ENGINE_EXTERNAL",
                "status": "info",
                "detail": p.to_string_lossy(),
                "file": req.input_folder
            }),
        );
    } else {
        let _ = window.emit(
            "resize_log",
            serde_json::json!({
                "code": "RESIZE_ENGINE_INTERNAL",
                "status": "info",
                "file": req.input_folder
            }),
        );
    }

    let mut targets: Vec<std::path::PathBuf> = Vec::new();
    let root = input_path;
    let walker = if req.recurse {
        WalkDir::new(root).follow_links(false)
    } else {
        WalkDir::new(root).max_depth(1).follow_links(false)
    };
    let mut walk_errors: u32 = 0;
    let mut hidden_skipped: u32 = 0;
    let mut all_files_seen: u32 = 0;
    let mut ext_counts: std::collections::BTreeMap<String, u32> = std::collections::BTreeMap::new();

    for entry in walker.into_iter() {
        let entry = match entry {
            Ok(v) => v,
            Err(_) => {
                walk_errors += 1;
                continue;
            }
        };

        if entry.file_type().is_dir() {
            continue;
        }

        all_files_seen += 1;

        let path = entry.path();
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if is_hidden_name(name) {
            hidden_skipped += 1;
            continue;
        }

        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        if !ext.is_empty() {
            *ext_counts.entry(ext.clone()).or_insert(0) += 1;
        }

        let is_image = matches!(
            ext.as_str(),
            "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "tif" | "tiff" | "tga" | "ico"
        );
        let is_video = matches!(
            ext.as_str(),
            "mp4" | "mov" | "mkv" | "avi" | "webm" | "m4v" | "mpg" | "mpeg" | "ts" | "m2ts" | "mts" | "3gp" | "wmv"
        );

        if !is_image && !is_video {
            continue;
        }

        targets.push(path.to_path_buf());
    }

    let total = targets.len() as u32;

    if total == 0 {
        let mut top_exts: Vec<(String, u32)> = ext_counts.into_iter().collect();
        top_exts.sort_by(|a, b| b.1.cmp(&a.1));
        top_exts.truncate(8);
        let exts_text = if top_exts.is_empty() {
            "(no extensions found)".to_string()
        } else {
            top_exts
                .into_iter()
                .map(|(k, v)| format!("{}={}", k, v))
                .collect::<Vec<_>>()
                .join(", ")
        };

        let _ = window.emit(
            "resize_log",
            serde_json::json!({
                "code": "RESIZE_SCAN_NONE",
                "status": "error",
                "file": req.input_folder,
                "files_seen": all_files_seen,
                "hidden_skipped": hidden_skipped,
                "walk_errors": walk_errors,
                "exts_seen": exts_text
            }),
        );
    } else {
        let _ = window.emit(
            "resize_log",
            serde_json::json!({
                "code": "RESIZE_SCAN_OK",
                "status": "success",
                "file": req.input_folder,
                "total": total,
                "files_seen": all_files_seen,
                "hidden_skipped": hidden_skipped,
                "walk_errors": walk_errors
            }),
        );
    }

    let _ = window.emit(
        "resize_log",
        serde_json::json!({ "code": "TOOL_TOTAL", "total": total, "file": req.input_folder }),
    );

    if total == 0 {
        return Err("No supported image/video files found in the selected folder.".to_string());
    }

    let mut done: u32 = 0;
    let mut success: u32 = 0;
    let mut failed: u32 = 0;

    for path in targets {
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        let is_image = matches!(
            ext.as_str(),
            "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "tif" | "tiff" | "tga" | "ico"
        );
        let is_video = matches!(
            ext.as_str(),
            "mp4" | "mov" | "mkv" | "avi" | "webm" | "m4v" | "mpg" | "mpeg" | "ts" | "m2ts" | "mts" | "3gp" | "wmv"
        );
        let file_name_stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("output");

        let output_file = if is_video {
            output_path.join(format!("{}_resized.mp4", file_name_stem))
        } else {
            let output_ext = match req.format.as_str() {
                "jpeg" => "jpeg",
                "jpg" => "jpg",
                "png" => "png",
                "webp" => "webp",
                "gif" => "gif",
                _ => "jpeg",
            };
            output_path.join(format!("{}_resized.{}", file_name_stem, output_ext))
        };

        let file_key = path.to_string_lossy().to_string();
        let _ = window.emit(
            "resize_log",
            serde_json::json!({ "code": "RESIZE_FILE_PROCESSING", "name": name, "status": "processing", "file": file_key }),
        );

        let mut ok = false;
        let mut err_detail: Option<String> = None;

        if is_image {
            let output_ext = output_file
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            let quality = match req.quality {
                0..=100 => req.quality,
                _ => 85,
            };

            let mut resized_with_magick = false;
            if let Some(ref magick) = magick {
                let resize_arg = if req.keep_aspect {
                    format!("{}x{}", req.width, req.height)
                } else {
                    format!("{}x{}!", req.width, req.height)
                };

                let mut cmd = std::process::Command::new(magick);
                cmd.arg(&path).arg("-auto-orient");
                cmd.arg("-filter")
                    .arg("Lanczos")
                    .arg("-resize")
                    .arg(resize_arg);

                if matches!(output_ext.as_str(), "jpg" | "jpeg" | "webp") {
                    cmd.arg("-quality").arg(format!("{}", quality));
                }

                cmd.arg(&output_file);
                #[cfg(target_os = "windows")]
                cmd.creation_flags(0x08000000);

                match cmd.output() {
                    Ok(o) if o.status.success() => {
                        ok = true;
                        resized_with_magick = true;
                    }
                    Ok(o) => {
                        let stderr = String::from_utf8_lossy(&o.stderr).to_string();
                        err_detail = Some(if stderr.trim().is_empty() { "ImageMagick failed".to_string() } else { stderr });
                    }
                    Err(e) => err_detail = Some(format!("{}", e)),
                }
            } else {
                match ImageReader::open(&path) {
                    Ok(reader) => match reader.decode() {
                        Ok(decoded) => {
                            let orientation = read_exif_orientation(&path)
                                .or_else(|| read_orientation_via_exiftool(&path))
                                .unwrap_or(1);
                            let decoded = apply_exif_orientation(decoded, orientation);
                            let (orig_w, orig_h) = decoded.dimensions();
                            let (target_w, target_h) = if req.keep_aspect {
                                let ratio = orig_w as f64 / orig_h as f64;
                                let req_ratio = req.width as f64 / req.height as f64;
                                if ratio > req_ratio {
                                    (req.width, (req.width as f64 / ratio) as u32)
                                } else {
                                    ((req.height as f64 * ratio) as u32, req.height)
                                }
                            } else {
                                (req.width, req.height)
                            };
                            let resized = image::imageops::resize(
                                &decoded,
                                target_w,
                                target_h,
                                image::imageops::FilterType::Lanczos3,
                            );
                            let result = match output_ext.as_str() {
                                "png" => resized.save_with_format(&output_file, image::ImageFormat::Png),
                                "webp" => resized.save_with_format(&output_file, image::ImageFormat::WebP),
                                "gif" => resized.save_with_format(&output_file, image::ImageFormat::Gif),
                                "bmp" => resized.save_with_format(&output_file, image::ImageFormat::Bmp),
                                "tiff" => resized.save_with_format(&output_file, image::ImageFormat::Tiff),
                                _ => {
                                    let f = std::fs::File::create(&output_file)
                                        .map_err(|e| format!("Failed to create file: {}", e))?;
                                    let mut f = std::io::BufWriter::new(f);
                                    resized.write_to(&mut f, image::ImageOutputFormat::Jpeg(quality))
                                }
                            };
                            match result {
                                Ok(_) => ok = true,
                                Err(e) => err_detail = Some(format!("{}", e)),
                            }
                        }
                        Err(e) => {
                            err_detail = Some(format!("{}", e));
                        }
                    },
                    Err(e) => {
                        err_detail = Some(format!("{}", e));
                    }
                }
            }

            if ok {
                let exiftool = resolve_exiftool().ok_or_else(|| {
                    "ExifTool not found (required to preserve metadata).".to_string()
                })?;

                let mut cmd = std::process::Command::new(&exiftool);
                let args: Vec<String> = vec![
                    "-overwrite_original".to_string(),
                    "-m".to_string(),
                    "-sep".to_string(),
                    ";".to_string(),
                    "-charset".to_string(),
                    "filename=utf8".to_string(),
                    "-TagsFromFile".to_string(),
                    path.to_string_lossy().to_string(),
                    "-n".to_string(),
                    "-x".to_string(),
                    "Orientation".to_string(),
                    "-x".to_string(),
                    "Rotation".to_string(),
                    "-x".to_string(),
                    "XMP:Rotation".to_string(),
                    "-x".to_string(),
                    "XMP:Rotate".to_string(),
                    "-x".to_string(),
                    "XMP-tiff:Orientation".to_string(),
                    "-x".to_string(),
                    "EXIF:Orientation".to_string(),
                    "-x".to_string(),
                    "IFD0:Orientation".to_string(),
                    "-all:all".to_string(),
                    "-ICC_Profile:all".to_string(),
                    "-Orientation=1".to_string(),
                    "-EXIF:Orientation=1".to_string(),
                    "-IFD0:Orientation=1".to_string(),
                    "-XMP-tiff:Orientation=1".to_string(),
                    "-Rotation=".to_string(),
                    "-XMP:Rotation=".to_string(),
                    "-XMP:Rotate=".to_string(),
                    output_file.to_string_lossy().to_string(),
                ];
                cmd.args(args);
                #[cfg(target_os = "windows")]
                cmd.creation_flags(0x08000000);

                match cmd.output() {
                    Ok(o) if o.status.success() => {}
                    Ok(o) => {
                        ok = false;
                        let stderr = String::from_utf8_lossy(&o.stderr).to_string();
                        let detail = if stderr.trim().is_empty() { "ExifTool failed to copy metadata".to_string() } else { stderr };
                        err_detail = Some(if resized_with_magick {
                            format!("Resize OK, tapi gagal copy metadata: {}", detail)
                        } else {
                            format!("Resize OK, tapi gagal copy metadata: {}", detail)
                        });
                    }
                    Err(e) => {
                        ok = false;
                        err_detail = Some(format!("Resize OK, tapi gagal copy metadata: {}", e));
                    }
                }
            }
        } else if is_video {
            let quality = match req.quality {
                0..=100 => req.quality,
                _ => 85,
            };
            match resolve_ffmpeg() {
                Some(ffmpeg) => {
                    let scale_arg = if req.keep_aspect {
                        format!(
                            "scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:-1:-1,setsar=1",
                            req.width, req.height, req.width, req.height
                        )
                    } else {
                        format!("scale={}:{}", req.width, req.height)
                    };
                    let crf = 51 - (quality as f32 / 2.0).round() as i32;
                    let out = std::process::Command::new(&ffmpeg)
                        .arg("-y")
                        .arg("-i")
                        .arg(&path)
                        .arg("-vf")
                        .arg(scale_arg)
                        .arg("-c:v")
                        .arg("libx264")
                        .arg("-crf")
                        .arg(format!("{}", crf))
                        .arg("-c:a")
                        .arg("aac")
                        .arg(&output_file)
                        .output();
                    match out {
                        Ok(o) if o.status.success() => ok = true,
                        Ok(o) => {
                            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
                            err_detail = Some(if stderr.trim().is_empty() { "ffmpeg failed".to_string() } else { stderr });
                        }
                        Err(e) => err_detail = Some(format!("{}", e)),
                    }
                }
                None => {
                    err_detail = Some("ffmpeg not found".to_string());
                }
            }
        } else {
            err_detail = Some("unsupported file".to_string());
        }

        if ok && req.delete_original {
            match std::fs::remove_file(&path) {
                Ok(_) => {}
                Err(e) => {
                    ok = false;
                    err_detail = Some(format!("Resize OK, tapi gagal menghapus file asli: {}", e));
                }
            }
        }

        done += 1;
        if ok {
            success += 1;
            let _ = window.emit(
                "resize_log",
                serde_json::json!({
                    "code": "RESIZE_FILE_SUCCESS",
                    "name": name,
                    "deleted_original": req.delete_original,
                    "status": "success",
                    "file": file_key
                }),
            );
        } else {
            failed += 1;
            let _ = window.emit(
                "resize_log",
                serde_json::json!({
                    "code": "RESIZE_FILE_ERROR",
                    "name": name,
                    "status": "error",
                    "detail": err_detail.unwrap_or_else(|| "unknown error".to_string()),
                    "file": file_key
                }),
            );
        }

        let _ = window.emit(
            "resize_log",
            serde_json::json!({ "code": "TOOL_PROGRESS", "total": total, "done": done, "success": success, "failed": failed, "rejected": 0u32, "file": req.input_folder }),
        );
    }

    Ok(format!("Processed {} files (success={}, failed={})", total, success, failed))
}

#[tauri::command]
pub async fn convert_media_batch(window: tauri::Window, req: ConvertMediaReq) -> Result<String, String> {
    let input_path = std::path::Path::new(&req.input_folder);
    if !input_path.exists() || !input_path.is_dir() {
        return Err("Input folder does not exist or is not a directory".to_string());
    }

    let output_path = std::path::Path::new(&req.output_folder);
    if !output_path.exists() {
        create_dir_all(output_path).map_err(|e| format!("Failed to create output folder: {}", e))?;
    }

    let format_raw = req.format.trim().to_lowercase();
    if format_raw.is_empty() {
        return Err("Output format is empty".to_string());
    }
    let output_ext = match format_raw.as_str() {
        "jpeg" => "jpeg".to_string(),
        "jpg" => "jpg".to_string(),
        other => other.to_string(),
    };

    let quality = match req.quality {
        0..=100 => req.quality,
        _ => 85,
    };

    let magick = match resolve_magick() {
        Some(p) => p,
        None => {
            let _ = window.emit(
                "convert_log",
                serde_json::json!({ "code": "CONVERT_ENGINE_MISSING", "status": "error", "file": req.input_folder }),
            );
            return Err("Conversion engine not found. Please install and ensure it is available in PATH.".to_string());
        }
    };

    let _ = window.emit(
        "convert_log",
        serde_json::json!({
            "code": "CONVERT_CONFIG",
            "status": "info",
            "file": req.input_folder,
            "input_folder": req.input_folder,
            "output_folder": req.output_folder,
            "delete_original": req.delete_original,
            "keep_metadata": true,
            "format": output_ext,
            "quality": quality
        }),
    );

    let _ = window.emit(
        "convert_log",
        serde_json::json!({ "code": "CONVERT_ENGINE_EXTERNAL", "status": "info", "detail": magick.to_string_lossy() }),
    );

    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    let mut walk_errors: u32 = 0;
    let mut hidden_skipped: u32 = 0;
    let mut all_files_seen: u32 = 0;
    let mut ext_counts: std::collections::BTreeMap<String, u32> = std::collections::BTreeMap::new();

    match std::fs::read_dir(input_path) {
        Ok(entries) => {
            for entry in entries {
                let entry = match entry {
                    Ok(v) => v,
                    Err(_) => {
                        walk_errors += 1;
                        continue;
                    }
                };
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                all_files_seen += 1;
                let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                if is_hidden_name(name) {
                    hidden_skipped += 1;
                    continue;
                }
                let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                if !ext.is_empty() {
                    *ext_counts.entry(ext).or_insert(0) += 1;
                }
                candidates.push(path);
            }
        }
        Err(_) => {
            walk_errors += 1;
        }
    }

    let is_convertible = |magick: &PathBuf, p: &std::path::Path| -> bool {
        let mut cmd = std::process::Command::new(magick);
        cmd.arg("identify").arg("-ping").arg(p);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        cmd.output().map(|o| o.status.success()).unwrap_or(false)
    };

    let mut targets: Vec<std::path::PathBuf> = Vec::new();
    for c in &candidates {
        if is_convertible(&magick, c) {
            targets.push(c.clone());
        }
    }

    let total = targets.len() as u32;
    if total == 0 {
        let mut top_exts: Vec<(String, u32)> = ext_counts.into_iter().collect();
        top_exts.sort_by(|a, b| b.1.cmp(&a.1));
        top_exts.truncate(10);
        let exts_text = if top_exts.is_empty() {
            "(no extensions found)".to_string()
        } else {
            top_exts.into_iter().map(|(k, v)| format!("{}={}", k, v)).collect::<Vec<_>>().join(", ")
        };

        let _ = window.emit(
            "convert_log",
            serde_json::json!({
                "code": "CONVERT_SCAN_NONE",
                "status": "error",
                "file": req.input_folder,
                "files_seen": all_files_seen,
                "hidden_skipped": hidden_skipped,
                "walk_errors": walk_errors,
                "exts_seen": exts_text
            }),
        );
        let _ = window.emit(
            "convert_log",
            serde_json::json!({ "code": "TOOL_TOTAL", "total": 0u32, "file": req.input_folder }),
        );
        return Err("No supported files found in the selected folder.".to_string());
    }

    let _ = window.emit(
        "convert_log",
        serde_json::json!({
            "code": "CONVERT_SCAN_OK",
            "status": "success",
            "file": req.input_folder,
            "total": total,
            "files_seen": all_files_seen,
            "hidden_skipped": hidden_skipped,
            "walk_errors": walk_errors
        }),
    );
    let _ = window.emit(
        "convert_log",
        serde_json::json!({ "code": "TOOL_TOTAL", "total": total, "file": req.input_folder }),
    );

    let ensure_unique_output = |base: &std::path::Path, ext: &str| -> std::path::PathBuf {
        let parent = base.parent().unwrap_or_else(|| std::path::Path::new("."));
        let stem = base.file_stem().and_then(|s| s.to_str()).unwrap_or("output");
        let mut candidate = parent.join(format!("{}.{}", stem, ext));
        if !candidate.exists() {
            return candidate;
        }
        for i in 1..=9999u32 {
            let p = parent.join(format!("{}_{}.{}", stem, i, ext));
            if !p.exists() {
                candidate = p;
                break;
            }
        }
        candidate
    };

    let mut done: u32 = 0;
    let mut success: u32 = 0;
    let mut failed: u32 = 0;
    let skipped: u32 = 0;

    for path in targets {
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        let file_key = path.to_string_lossy().to_string();
        let _ = window.emit(
            "convert_log",
            serde_json::json!({ "code": "CONVERT_FILE_PROCESSING", "name": name, "status": "processing", "file": file_key }),
        );

        let mut ok = false;
        let mut err_detail: Option<String> = None;
        let mut meta_detail: Option<String> = None;

        let out_base = output_path.join(path.file_stem().and_then(|s| s.to_str()).unwrap_or("output"));
        let mut output_file = ensure_unique_output(&out_base, &output_ext);
        if output_file.to_string_lossy().to_lowercase() == file_key.to_lowercase() {
            let out_base2 = output_path.join(format!(
                "{}_converted",
                path.file_stem().and_then(|s| s.to_str()).unwrap_or("output")
            ));
            output_file = ensure_unique_output(&out_base2, &output_ext);
        }

        let mut cmd = std::process::Command::new(&magick);
        cmd.arg(&path).arg("-auto-orient");
        if output_ext.as_str() == "png" {
            cmd.arg("-define").arg("png:compression-level=3");
        }
        if matches!(output_ext.as_str(), "jpg" | "jpeg" | "webp") {
            cmd.arg("-quality").arg(format!("{}", quality));
        }
        cmd.arg(&output_file);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);

        match cmd.output() {
            Ok(o) if o.status.success() => ok = true,
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr).to_string();
                err_detail = Some(if stderr.trim().is_empty() { "conversion failed".to_string() } else { stderr });
            }
            Err(e) => err_detail = Some(format!("{}", e)),
        }

        if ok {
            match resolve_exiftool() {
                Some(exiftool) => {
                    let mut cmd = std::process::Command::new(&exiftool);
                    let args: Vec<String> = vec![
                        "-overwrite_original".to_string(),
                        "-m".to_string(),
                        "-sep".to_string(),
                        ";".to_string(),
                        "-charset".to_string(),
                        "filename=utf8".to_string(),
                        "-TagsFromFile".to_string(),
                        path.to_string_lossy().to_string(),
                        "-ICC_Profile:all".to_string(),
                        "-XMP-dc:Title".to_string(),
                        "-XMP-dc:Description".to_string(),
                        "-XMP-dc:Subject".to_string(),
                        "-XMP-dc:Creator".to_string(),
                        "-XMP-dc:Rights".to_string(),
                        "-XMP:Rating".to_string(),
                        "-IPTC:ObjectName".to_string(),
                        "-IPTC:Caption-Abstract".to_string(),
                        "-IPTC:Keywords".to_string(),
                        "-IPTC:By-line".to_string(),
                        "-IPTC:CopyrightNotice".to_string(),
                        "-EXIF:Artist".to_string(),
                        "-EXIF:Copyright".to_string(),
                        "-EXIF:ImageDescription".to_string(),
                        "-EXIF:XPTitle".to_string(),
                        "-EXIF:XPComment".to_string(),
                        "-EXIF:XPKeywords".to_string(),
                        "-EXIF:XPSubject".to_string(),
                        "-Orientation=1".to_string(),
                        "-EXIF:Orientation=1".to_string(),
                        "-IFD0:Orientation=1".to_string(),
                        "-XMP-tiff:Orientation=1".to_string(),
                        "-Rotation=".to_string(),
                        "-XMP:Rotation=".to_string(),
                        output_file.to_string_lossy().to_string(),
                    ];
                    cmd.args(args);
                    #[cfg(target_os = "windows")]
                    cmd.creation_flags(0x08000000);

                    match cmd.output() {
                        Ok(o) if o.status.success() => {}
                        Ok(o) => {
                            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
                            meta_detail = Some(if stderr.trim().is_empty() {
                                "metadata copy failed".to_string()
                            } else {
                                stderr
                            });
                        }
                        Err(e) => {
                            meta_detail = Some(format!("metadata copy failed: {}", e));
                        }
                    }
                }
                None => {
                    meta_detail = Some("metadata tool not found".to_string());
                }
            }
        }

        if ok && req.delete_original {
            match std::fs::remove_file(&path) {
                Ok(_) => {}
                Err(e) => {
                    ok = false;
                    err_detail = Some(format!("converted but failed to delete original: {}", e));
                }
            }
        }

        done += 1;
        if ok {
            success += 1;
            let _ = window.emit(
                "convert_log",
                serde_json::json!({
                    "code": "CONVERT_FILE_SUCCESS",
                    "name": name,
                    "deleted_original": req.delete_original,
                    "status": "success",
                    "detail": meta_detail,
                    "file": file_key
                }),
            );
        } else {
            failed += 1;
            let _ = window.emit(
                "convert_log",
                serde_json::json!({
                    "code": "CONVERT_FILE_ERROR",
                    "name": name,
                    "status": "error",
                    "detail": err_detail.unwrap_or_else(|| "unknown error".to_string()),
                    "file": file_key
                }),
            );
        }

        let _ = window.emit(
            "convert_log",
            serde_json::json!({ "code": "TOOL_PROGRESS", "total": total, "done": done, "success": success, "failed": failed, "rejected": skipped, "file": req.input_folder }),
        );
    }

    Ok(format!("Converted {} files (success={}, failed={})", total, success, failed))
}
