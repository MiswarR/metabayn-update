// Cloudflare Gateway Commands
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CloudflareBalanceReq {
    // No fields needed, uses AppSettings.auth_token
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CloudflareGenerateReq {
    pub images: Vec<crate::cloudflare::ImageInput>,
    pub settings: crate::cloudflare::CloudflareSettings,
    // No token/user_id needed, uses AppSettings.auth_token
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModeToggleReq {
    pub mode: String, // "apikey" or "cloudflare"
}

#[tauri::command]
pub async fn check_cloudflare_balance(
    _req: CloudflareBalanceReq,
    settings: State<'_, crate::settings::AppSettings>,
) -> Result<crate::cloudflare::BalanceInfo, String> {
    let worker_url = settings.server_url.clone() + "/cloudflare";
    // Use auth_token from settings
    crate::cloudflare::check_cloudflare_balance(&settings.auth_token, &worker_url)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn generate_metadata_cloudflare(
    req: CloudflareGenerateReq,
    settings: State<'_, crate::settings::AppSettings>,
    _window: tauri::Window,
) -> Result<crate::cloudflare::GenerationResult, String> {
    let worker_url = settings.server_url.clone() + "/cloudflare";
    
    // TODO: Implement full flow with progress updates
    // For now, just call the basic function
    let cloudflare_req = crate::cloudflare::CloudflareRequest {
        images: req.images,
        settings: req.settings,
    };
    
    // Use auth_token from settings
    let response = crate::cloudflare::generate_metadata_cloudflare(
        &settings.auth_token,
        &worker_url,
        cloudflare_req,
    ).await.map_err(|e| e.to_string())?;
    
    Ok(crate::cloudflare::GenerationResult {
        results: response.data,
        total_cost: response.cost,
        remaining_balance: response.remaining_balance,
    })
}

#[tauri::command]
pub async fn set_active_mode(
    req: ModeToggleReq,
    _settings: State<'_, crate::settings::AppSettings>,
) -> Result<(), String> {
    if req.mode != "apikey" && req.mode != "cloudflare" {
        return Err("Invalid mode. Must be 'apikey' or 'cloudflare'".to_string());
    }
    
    // TODO: Add validation logic for each mode
    // For now, just return success
    Ok(())
}