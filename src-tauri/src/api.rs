use anyhow::Result;
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs::{create_dir_all, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::{collections::VecDeque, fs::File};
use tauri::State;

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
            "jpg" | "jpeg" | "png" | "webp" | "mp4" | "mov" | "mkv" | "avi" | "webm"
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
pub async fn generate_csv_from_folder(window: tauri::Window, input_folder: String, output_folder: String, api_key: Option<String>, token: Option<String>) -> Result<String, String> {
    crate::metadata::generate_csv_from_folder(window, &input_folder, &output_folder, api_key, token)
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
    crate::settings::save_settings(&settings).map_err(|e| e.to_string())
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
    // For OpenRouter, api_key might be empty/dummy since it's server managed
    if api_key.is_empty() && provider != "OpenRouter" {
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
    } else if provider == "Groq" {
        return Err("Groq provider is currently disabled.".to_string());
    } else if provider == "Anthropic" || provider == "Claude" {
        client
            .get("https://api.anthropic.com/v1/models")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .send()
            .await
    } else if provider == "OpenRouter" {
        // Test connection to Worker or Direct OpenRouter
        let url = endpoint.unwrap_or("https://metabayn-worker.metabayn.workers.dev/v1/chat/completions".to_string());
        
        let target_url = if url.ends_with("/chat/completions") {
             url.replace("/chat/completions", "/models")
        } else {
             format!("{}/models", url.trim_end_matches('/'))
        };
        
        // Determine which token to use
        // If the user provided a specific API Key (sk-or-...), use it directly against OpenRouter (or via worker if it supports it)
        // If api_key is empty/server-managed, use the App Token from settings.
        
        let final_token = if api_key.starts_with("sk-or-") {
            api_key.to_string()
        } else {
            let settings = crate::settings::load_settings().unwrap_or_default();
            let mut auth_token = settings.auth_token;
            if auth_token.starts_with("enc:") {
                if let Ok(dec) = crate::crypto_utils::decrypt_token(&auth_token[4..]) {
                    auth_token = dec;
                }
            }
            auth_token
        };

        client
            .get(target_url)
            .header("Authorization", format!("Bearer {}", final_token)) 
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
                // If 404/405 (Method Not Allowed) on Worker, it might still mean the worker is reachable but doesn't support GET /models
                // But usually we want 200 OK.
                Err(format!("Connection Failed ({}): {}", status, err_text))
            }
        }
        Err(e) => Err(format!("Network Error: {}", e)),
    }
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

// Cloudflare Gateway Commands

#[derive(Debug, Serialize, Deserialize, Clone)]
#[allow(dead_code)]
pub struct ModeToggleReq {
    pub mode: String, // "apikey" or "cloudflare"
}

#[tauri::command]
pub async fn set_profit_margin(margin: f64) -> Result<(), String> {
    let mut settings = crate::settings::load_settings().map_err(|e| e.to_string())?;
    settings.profit_margin_percent = margin;
    crate::settings::save_settings(&settings).map_err(|e| e.to_string())
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
