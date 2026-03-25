use anyhow::{Result, anyhow};
use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BalanceInfo {
    pub balance: u64,
    pub currency: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ImageInput {
    pub id: String,
    pub base64: String,
    pub filename: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CloudflareSettings {
    pub title_count: u32,
    pub tag_count: u32,
    pub description_count: u32,
    pub banned_words: Vec<String>,
    pub image_quality: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CloudflareRequest {
    pub images: Vec<ImageInput>,
    pub settings: CloudflareSettings,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MetadataItem {
    pub titles: Vec<String>,
    pub tags: Vec<String>,
    pub descriptions: Vec<String>,
    pub colors: Vec<String>,
    pub objects: Vec<HashMap<String, serde_json::Value>>,
    pub mood: String,
    pub technical_quality: HashMap<String, f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CloudflareResponseData {
    pub image_id: String,
    pub metadata: MetadataItem,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CostDetails {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cost_usd: f64,
    pub cost_idr: f64,
    pub token_deducted: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CloudflareResponse {
    pub success: bool,
    pub data: Vec<CloudflareResponseData>,
    pub cost: CostDetails,
    pub remaining_balance: u64,
    pub cached: bool,
    pub processing_time_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GenerationResult {
    pub results: Vec<CloudflareResponseData>,
    pub total_cost: CostDetails,
    pub remaining_balance: u64,
}

/// Check token balance from Cloudflare Worker
pub async fn check_cloudflare_balance(
    token: &str,
    worker_url: &str,
) -> Result<BalanceInfo> {
    let client = reqwest::Client::new();
    
    let response = client
        .get(format!("{}/balance", worker_url))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| anyhow!("Failed to check balance: {}", e))?;

    if !response.status().is_success() {
        return Err(anyhow!("Balance check failed: {}", response.status()));
    }

    let balance_info: BalanceInfo = response
        .json()
        .await
        .map_err(|e| anyhow!("Failed to parse balance response: {}", e))?;

    Ok(balance_info)
}

/// Generate metadata via Cloudflare Worker
pub async fn generate_metadata_cloudflare(
    token: &str,
    worker_url: &str,
    request: CloudflareRequest,
) -> Result<CloudflareResponse> {
    let client = reqwest::Client::new();
    
    let response = client
        .post(format!("{}/generate", worker_url))
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| anyhow!("Failed to generate metadata: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(anyhow!("Metadata generation failed: {}", error_text));
    }

    let cloudflare_response: CloudflareResponse = response
        .json()
        .await
        .map_err(|e| anyhow!("Failed to parse metadata response: {}", e))?;

    if !cloudflare_response.success {
        return Err(anyhow!("Cloudflare Worker returned error"));
    }

    Ok(cloudflare_response)
}