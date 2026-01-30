#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

use tauri::Manager;
#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

mod anti_clone;
mod api;
mod audit;
mod auth;
mod crypto_utils;
mod csv;
mod filesystem;
mod metadata;
mod duplicates;
mod ai_cluster;
mod security;
mod settings;
mod subscription;
mod token;
mod video;

fn main() {
    let audit_service = crate::audit::AuditService::new();
    let security_service = crate::security::SecurityService::new();
    let subscription_state = crate::subscription::SubscriptionState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let has_deeplink = args.iter().any(|a| a.starts_with("metabayn-studio://"));
            if has_deeplink {
                if let Some(window) = app.get_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.unminimize();
                }
            }
        }))
        .manage(audit_service)
        .manage(security_service)
        .manage(subscription_state)
        .invoke_handler(tauri::generate_handler![
            crate::api::login,
            crate::api::refresh_balance,
            crate::api::scan_folder,
            crate::api::scan_csv_files,
            crate::api::write_image_metadata,
            crate::api::write_video_metadata,
            crate::api::append_csv,
            crate::api::generate_csv_from_folder,
            crate::api::detect_duplicate_images,
            crate::api::get_machine_hash,
            crate::api::generate_metadata_batch,
            crate::api::get_settings,
            crate::api::save_settings,
            crate::api::save_auth_token,
            crate::api::logout,
            crate::api::delete_file,
            crate::api::file_exists,
            crate::api::encrypt_app_token,
            crate::api::check_subscription_status,
            crate::api::activate_subscription_mock,
            crate::api::log_audit_event,
            crate::api::test_api_connection,
            crate::api::run_ai_clustering
        ])
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                // Register custom URL protocol: metabayn-studio://
                if let Ok(exe_path) = std::env::current_exe() {
                    let classes = RegKey::predef(HKEY_CURRENT_USER).create_subkey("Software\\Classes\\metabayn-studio");
                    if let Ok((proto_key, _)) = classes {
                        let _ = proto_key.set_value("", &"URL:Metabayn Studio Protocol");
                        let _ = proto_key.set_value("URL Protocol", &"");
                        if let Ok((cmd_key, _)) = proto_key.create_subkey("shell\\open\\command") {
                            let cmd = format!("\"{}\" \"%1\"", exe_path.to_string_lossy());
                            let _ = cmd_key.set_value("", &cmd);
                        }
                    }
                }
            }
            // Initialize Audit Service
            let audit_state: tauri::State<crate::audit::AuditService> = app.state();
            audit_state.init(&app.handle());

            let window = app.get_window("main").unwrap();
            let _ = window.center();
            let _ = window.set_focus();
            let _ = window.unminimize();
            let _ = window.show();
            
            // Background Token Refresh Task
            std::thread::spawn(|| {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(300));
                    if let Ok(settings) = crate::settings::load_settings() {
                        let token = settings.auth_token;
                        let decrypted_token = if let Some(stripped) = token.strip_prefix("enc:") {
                            crate::crypto_utils::decrypt_token(stripped).unwrap_or_default()
                        } else {
                            token
                        };
                        
                        if !decrypted_token.is_empty() && crate::auth::needs_refresh(&decrypted_token) {
                            let rt = tokio::runtime::Runtime::new().unwrap();
                            if let Ok(new_token) = rt.block_on(crate::auth::refresh_token(&decrypted_token)) {
                                let _ = crate::settings::save_auth_token(&new_token);
                            }
                        }
                    }
                }
            });
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
