use anyhow::Result;

pub async fn refresh_balance(token: String) -> Result<f64> {
  if token.starts_with("dev-") { return Ok(999.99); }
  let client = reqwest::Client::new();
  let url = crate::settings::load_settings()
      .map(|s| s.server_url)
      .unwrap_or_else(|_| "https://metabayn-backend.metabayn.workers.dev".to_string());
  let trimmed = url.trim();
  let effective = if trimmed.is_empty() || trimmed == "http://localhost:8787" {
      "https://metabayn-backend.metabayn.workers.dev".to_string()
  } else {
      trimmed.to_string()
  };
  let base = effective.trim_end_matches('/');
  
  let resp = client.get(format!("{}/token/balance", base))
      .header("Authorization", format!("Bearer {}", token))
      .send().await?;
      
  if !resp.status().is_success() {
     return Ok(0.0);
  }
  
  let v = resp.json::<serde_json::Value>().await?;
  Ok(v.get("balance").and_then(|x| x.as_f64()).unwrap_or(0.0))
}
