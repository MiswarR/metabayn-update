use anyhow::Result;
use serde::{Serialize, Deserialize};
use chrono::Utc;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};

#[derive(Serialize, Deserialize)]
pub struct LoginResponse { pub token: String, pub balance: f64 }

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    exp: usize,
    sub: String,
}

pub async fn login(email: String, password: String) -> Result<LoginResponse> {
  // REMOVED HARDCODED BACKDOOR to force real JWT auth
  
  let client = reqwest::Client::new();
  let hash = crate::anti_clone::machine_hash().await.unwrap_or_default();
  let body = serde_json::json!({"email": email, "password": password, "device_hash": hash});
  
  // Load server URL from settings or default to production
  let url = crate::settings::load_settings()
      .map(|s| s.server_url)
      .unwrap_or_else(|_| "https://metabayn-backend.metabayn.workers.dev".to_string());
      
  // Ensure no trailing slash
  let base = url.trim_end_matches('/');
  let resp = client.post(format!("{}/auth/login", base)).json(&body).send().await?;
  
  if !resp.status().is_success() {
      let err_text = resp.text().await.unwrap_or_default();
      return Err(anyhow::anyhow!("Login failed: {}", err_text));
  }
  
  // Parse as generic Value first to handle different structures
  let val = resp.json::<serde_json::Value>().await?;
  
  // Extract token and user.tokens (balance)
  let token = val.get("token").and_then(|v| v.as_str()).ok_or_else(|| anyhow::anyhow!("Missing token in response"))?.to_string();
  
  // Handle nested user object structure from backend
  let balance = val.get("user")
      .and_then(|u| u.get("tokens"))
      .and_then(|t| t.as_f64())
      .unwrap_or(0.0);

  Ok(LoginResponse { token, balance })
}

pub async fn refresh_token(current_token: &str) -> Result<String> {
    let client = reqwest::Client::new();
    
    // Load server URL
    let url = crate::settings::load_settings()
        .map(|s| s.server_url)
        .unwrap_or_else(|_| "https://metabayn-backend.metabayn.workers.dev".to_string());
    let base = url.trim_end_matches('/');

    let resp = client.post(format!("{}/auth/refresh", base))
        .header("Authorization", format!("Bearer {}", current_token))
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(anyhow::anyhow!("Refresh failed"));
    }

    let val = resp.json::<serde_json::Value>().await?;
    let new_token = val.get("token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing token in refresh response"))?
        .to_string();
    
    Ok(new_token)
}

fn decode_jwt_payload_insecure(token: &str) -> Result<Claims> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return Err(anyhow::anyhow!("Invalid JWT format"));
    }
    let payload_b64 = parts[1];
    let decoded_bytes = URL_SAFE_NO_PAD.decode(payload_b64)?;
    let claims: Claims = serde_json::from_slice(&decoded_bytes)?;
    Ok(claims)
}

pub fn needs_refresh(token: &str) -> bool {
    // Check if token expires in < 5 minutes
    match decode_jwt_payload_insecure(token) {
        Ok(token_data) => {
            let exp = token_data.exp as i64;
            let now = Utc::now().timestamp();
            // If expires in less than 5 minutes (300 seconds)
            (exp - now) < 300
        },
        Err(_) => true // specific error handling could be better
    }
}
