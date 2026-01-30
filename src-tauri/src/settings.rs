use anyhow::{Result, anyhow};
use serde::{Serialize, Deserialize};
use std::fs::{create_dir_all, File};
use std::io::{Read, Write};

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(default)]
pub struct AppSettings {
  pub server_url: String,
  pub default_model: String,
  pub overwrite: bool,
  pub csv_path: String,
  pub logs_path: String,
  pub input_folder: String,
  pub output_folder: String,
  pub max_threads: u32,
  pub retry_count: u8,
  pub title_min_words: u32,
  pub title_max_words: u32,
  pub description_min_chars: u32,
  pub description_max_chars: u32,
  pub keywords_min_count: u32,
  pub keywords_max_count: u32,
  pub auto_embed: bool,
  pub banned_words: String,
  pub ai_provider: String,
  pub auth_email: String,
  pub auth_token: String,
  pub selection_enabled: bool,
  // pub check_anatomy_defect: bool, // Deprecated, covered by human/animal defects
  // pub check_human_animal_similarity: bool, // Deprecated, moved to sub-options
  pub check_human_presence: bool,
  pub check_animal_presence: bool,
  
  // Text Sub-options
  pub text_filter_gibberish: bool,
  pub text_filter_non_english: bool,
  pub text_filter_irrelevant: bool,
  pub text_filter_relevant: bool,

  // Human Sub-options
  pub human_filter_full_face: bool,
  pub human_filter_no_head: bool,
  pub human_filter_partial_perfect: bool,
  pub human_filter_partial_defect: bool,
  pub human_filter_back_view: bool,
  pub human_filter_unclear: bool,
  pub human_filter_face_only: bool,
  pub human_filter_nudity: bool,

  // Animal Sub-options
  pub animal_filter_full_face: bool,
  pub animal_filter_no_head: bool,
  pub animal_filter_partial_perfect: bool,
  pub animal_filter_partial_defect: bool,
  pub animal_filter_back_view: bool,
  pub animal_filter_unclear: bool,
  pub animal_filter_face_only: bool,
  pub animal_filter_nudity: bool,

  pub check_deformed_object: bool,
  pub check_unrecognizable_subject: bool,
  pub check_text_or_text_like: bool,
  pub check_brand_logo: bool,
  pub check_famous_trademark: bool,
  pub check_watermark: bool,
  pub check_duplicate_similarity: bool,
  pub enable_quality_filter: bool,
  pub quality_blur_min: f64,
  pub quality_noise_max: f64,
  pub quality_luma_min: f64,
  pub quality_luma_max: f64,
  pub duplicate_max_hamming_distance: u32
  ,pub selection_order: String
  ,pub connection_mode: String, // "server" or "direct"
  #[serde(default = "default_true")]
  pub generate_csv: bool,

  // Rename Options
  #[serde(default)]
  pub rename_enabled: bool,
  #[serde(default)]
  pub rename_mode: String, // "title", "datetime", "custom"
  #[serde(default)]
  pub rename_custom_text: String
}

fn default_true() -> bool { true }

fn settings_path() -> Result<std::path::PathBuf> {
  let dir = dirs::config_dir().ok_or_else(|| anyhow!("no config dir"))?.join("metabayn-studio");
  create_dir_all(&dir)?;
  Ok(dir.join("settings.json"))
}

pub fn load_settings() -> Result<AppSettings> {
  let p = settings_path()?;
  if !p.exists() {
    let d = default_paths();
    return Ok(AppSettings{
      server_url: "https://metabayn-backend.metabayn.workers.dev".into(),
      default_model: "gemini-flash".into(),
      overwrite: true,
      csv_path: d.0,
      logs_path: d.1,
      input_folder: String::new(),
      output_folder: String::new(),
      max_threads: 4,
      retry_count: 1,
      title_min_words: 5,
      title_max_words: 13,
      description_min_chars: 80,
      description_max_chars: 200,
      keywords_min_count: 35,
      keywords_max_count: 49,
      auto_embed: true,
      banned_words: String::new(),
      ai_provider: "Gemini".into()
      ,auth_email: String::new(), auth_token: String::new(),
      selection_enabled: false,
      // check_anatomy_defect: false,
      // check_human_animal_similarity: false,
      check_human_presence: false,
      check_animal_presence: false,
      text_filter_gibberish: false,
      text_filter_non_english: false,
      text_filter_irrelevant: false,
      text_filter_relevant: false,
      human_filter_full_face: false,
      human_filter_no_head: false,
      human_filter_partial_perfect: false,
      human_filter_partial_defect: false,
      human_filter_back_view: false,
      human_filter_unclear: false,
      human_filter_face_only: false,
      human_filter_nudity: false,
      animal_filter_full_face: false,
      animal_filter_no_head: false,
      animal_filter_partial_perfect: false,
      animal_filter_partial_defect: false,
      animal_filter_back_view: false,
      animal_filter_unclear: false,
      animal_filter_face_only: false,
      animal_filter_nudity: false,
      check_deformed_object: false,
      check_unrecognizable_subject: false,
      check_text_or_text_like: false,
      check_brand_logo: false,
      check_famous_trademark: false,
      check_watermark: false,
      check_duplicate_similarity: false,
      enable_quality_filter: false,
      quality_blur_min: 100.0,
      quality_noise_max: 16.0,
      quality_luma_min: 30.0,
      quality_luma_max: 225.0,
      duplicate_max_hamming_distance: 4,
      selection_order: "before".into(),
      connection_mode: "server".into(),
      generate_csv: true,
      rename_enabled: false,
      rename_mode: "title".into(),
      rename_custom_text: String::new()
    });
  }
  let mut f = File::open(p)?; let mut s = String::new(); f.read_to_string(&mut s)?;
  let mut v = serde_json::from_str::<AppSettings>(&s)?;
  
  // Decrypt token if encrypted
  if v.auth_token.starts_with("enc:") {
      let enc = v.auth_token.trim_start_matches("enc:");
      if let Ok(dec) = crate::crypto_utils::decrypt_token(enc) {
          v.auth_token = dec;
      }
  }

  // Auto-fix server URL if kosong / whitespace atau masih pointing ke default lama / localhost
  let trimmed = v.server_url.trim();
  if trimmed.is_empty() || trimmed == "http://localhost:8787" || trimmed == "https://api.metabayn.local" {
    v.server_url = "https://metabayn-backend.metabayn.workers.dev".into();
    let _ = save_settings(&v); // Try to save back the fix
  }
  Ok(v)
}

pub fn save_settings(v: &AppSettings) -> Result<()> {
  let p = settings_path()?;
  let mut f = File::create(p)?;

  // Encrypt token if present and not already encrypted
  let mut v_to_save = v.clone();
  if !v_to_save.auth_token.is_empty() && !v_to_save.auth_token.starts_with("enc:") {
      if let Ok(enc) = crate::crypto_utils::encrypt_token(&v_to_save.auth_token) {
          v_to_save.auth_token = format!("enc:{}", enc);
      }
  }

  f.write_all(serde_json::to_string_pretty(&v_to_save)?.as_bytes())?;
  Ok(())
}

pub fn save_auth_token(token: &str) -> Result<()> {
  let mut s = load_settings()?;
  s.auth_token = token.to_string();
  save_settings(&s)
}

fn default_paths() -> (String, String) {
  let mut csv = String::new();
  let mut logs = String::new();
  if let Some(doc) = dirs::document_dir() { csv = doc.join("metabayn.csv").to_string_lossy().to_string(); logs = doc.join("metabayn.log").to_string_lossy().to_string(); }
  (csv, logs)
}
