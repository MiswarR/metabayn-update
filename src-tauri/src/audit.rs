use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum AuditEventType {
    Login,
    Logout,
    TokenRefresh,
    ModeSwitch,
    ApiKeyUsage,
    SubscriptionCheck,
    Error,
    SecurityAlert,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuditEntry {
    pub timestamp: String,
    pub event_type: AuditEventType,
    pub context: String,
    pub status: String,
    pub user_id: Option<String>,
}

pub struct AuditState {
    pub log_path: String,
}

impl AuditState {
    pub fn new(app_handle: &AppHandle) -> Self {
        let path = app_handle
            .path_resolver()
            .app_data_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("audit.log");
        
        Self {
            log_path: path.to_string_lossy().to_string(),
        }
    }

    pub fn log(&self, event_type: AuditEventType, context: &str, status: &str, user_id: Option<&str>) {
        let entry = AuditEntry {
            timestamp: Local::now().to_rfc3339(),
            event_type,
            context: context.to_string(),
            status: status.to_string(),
            user_id: user_id.map(|s| s.to_string()),
        };

        if let Ok(json) = serde_json::to_string(&entry) {
            if let Ok(mut file) = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.log_path)
            {
                let _ = writeln!(file, "{}", json);
            }
        }
    }
}

pub struct AuditService {
    pub state: Mutex<Option<AuditState>>,
}

impl AuditService {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(None),
        }
    }

    pub fn init(&self, app_handle: &AppHandle) {
        let mut state = self.state.lock().unwrap();
        *state = Some(AuditState::new(app_handle));
    }

    pub fn log(&self, event_type: AuditEventType, context: &str, status: &str, user_id: Option<&str>) {
        if let Ok(state) = self.state.lock() {
            if let Some(s) = state.as_ref() {
                s.log(event_type, context, status, user_id);
            }
        }
    }
}
