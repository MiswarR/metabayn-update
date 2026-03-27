import { invoke } from '@tauri-apps/api/tauri'

type AuditEventType =
  | 'Login'
  | 'Logout'
  | 'TokenRefresh'
  | 'ModeSwitch'
  | 'ApiKeyUsage'
  | 'SubscriptionCheck'
  | 'Error'
  | 'SecurityAlert'

const isTauri = typeof (window as any).__TAURI_IPC__ === 'function'

export async function logAudit(eventType: AuditEventType | string, context: string, status: string) {
  if (!isTauri) return
  const event = String(eventType || '').trim()
  if (!event) return
  await invoke('log_audit_event', { eventType: event, context: String(context || ''), status: String(status || '') })
}
