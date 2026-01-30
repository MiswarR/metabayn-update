import { invoke } from '@tauri-apps/api/tauri'

export async function logAudit(eventType: string, context: string, status: string) {
    try {
        await invoke('log_audit_event', { eventType, context, status })
    } catch (e) {
        console.error("Failed to log audit event", e)
    }
}
