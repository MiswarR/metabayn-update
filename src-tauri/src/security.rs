use governor::{Quota, RateLimiter};
use governor::clock::DefaultClock;
use governor::state::{InMemoryState, NotKeyed};
use std::num::NonZeroU32;
use std::sync::Arc;
use std::collections::HashMap;
use std::sync::Mutex;

pub struct SecurityService {
    // Rate limiter: 100 requests per minute
    limiter: Arc<RateLimiter<NotKeyed, InMemoryState, DefaultClock>>,
    // Simple IP blacklist (simulated for client-side context, could be remote hosts)
    #[allow(dead_code)]
    blocked_ips: Mutex<HashMap<String, u32>>, // IP -> Failure Count
    #[allow(dead_code)]
    max_failures: u32,
}

impl SecurityService {
    pub fn new() -> Self {
        let quota = Quota::per_minute(NonZeroU32::new(100).unwrap());
        Self {
            limiter: Arc::new(RateLimiter::direct(quota)),
            blocked_ips: Mutex::new(HashMap::new()),
            max_failures: 5,
        }
    }

    pub fn check_rate_limit(&self) -> bool {
        self.limiter.check().is_ok()
    }

    #[allow(dead_code)]
    pub fn record_auth_failure(&self, ip: &str) {
        let mut blocked = self.blocked_ips.lock().unwrap();
        let count = blocked.entry(ip.to_string()).or_insert(0);
        *count += 1;
    }

    #[allow(dead_code)]
    pub fn is_ip_blocked(&self, ip: &str) -> bool {
        let blocked = self.blocked_ips.lock().unwrap();
        if let Some(count) = blocked.get(ip) {
            return *count >= self.max_failures;
        }
        false
    }

    #[allow(dead_code)]
    pub fn reset_failures(&self, ip: &str) {
        let mut blocked = self.blocked_ips.lock().unwrap();
        blocked.remove(ip);
    }
}
