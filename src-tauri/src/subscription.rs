use serde::{Deserialize, Serialize};
use std::sync::Mutex;

// Simple in-memory mock database for subscription status
// In a real app, this would be a SQLite DB or a file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionStatus {
    pub is_active: bool,
    pub expiry: Option<String>, // ISO date string
}

pub struct SubscriptionState {
    pub status: Mutex<SubscriptionStatus>,
}

impl SubscriptionState {
    pub fn new() -> Self {
        Self {
            status: Mutex::new(SubscriptionStatus {
                is_active: false,
                expiry: None,
            }),
        }
    }
}

pub fn check_subscription_status(state: &SubscriptionState) -> SubscriptionStatus {
    let mut status = match state.status.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    
    // Check expiry
    if status.is_active {
        if let Some(expiry_str) = &status.expiry {
            if let Ok(expiry) = chrono::DateTime::parse_from_rfc3339(expiry_str) {
                if chrono::Utc::now() > expiry {
                    status.is_active = false;
                    status.expiry = None;
                }
            }
        }
    }
    
    status.clone()
}

pub fn activate_mock(state: &SubscriptionState) {
    let mut status = match state.status.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    status.is_active = true;
    // Set expiry to 30 days from now
    let expiry = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::days(30))
        .unwrap_or_else(chrono::Utc::now);
    status.expiry = Some(expiry.to_rfc3339());
}
