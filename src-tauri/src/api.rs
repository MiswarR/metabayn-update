use serde::{Deserialize, Serialize};
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
pub async fn generate_metadata_batch(req: BatchReq) -> Result<Vec<crate::metadata::Generated>, String> {
    crate::metadata::generate_batch(&req)
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
pub async fn test_api_connection(provider: String, api_key: String) -> Result<String, String> {
    if api_key.trim().is_empty() {
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
    } else {
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
                let err_text = resp.text().await.unwrap_or_default();
                Err(format!("Connection Failed: {}", err_text))
            }
        }
        Err(e) => Err(format!("Network Error: {}", e)),
    }
}

#[tauri::command]
pub async fn run_ai_clustering(window: tauri::Window, input_folder: String, threshold: f64) -> Result<String, String> {
    crate::ai_cluster::run_clustering(window, &input_folder, threshold)
        .await
        .map_err(|e| e.to_string())
}
