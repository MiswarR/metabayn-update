/**
 * API Key Storage Utility
 * Manages per-provider API Key storage with encryption
 */

/**
 * Generate storage keys for API Key based on provider
 * Each provider has its own encrypted storage
 */
export const getApiKeyStorageKey = (provider: string): { enc: string; iv: string } => {
  const normalizedProvider = String(provider || 'Gemini').toLowerCase()
  return {
    enc: `metabayn:apikey:${normalizedProvider}:enc`,
    iv: `metabayn:apikey:${normalizedProvider}:iv`
  }
}

/**
 * Retrieve API Key from localStorage for a specific provider
 */
export const getApiKeyFromStorage = (provider: string): { enc: string | null; iv: string | null } => {
  const keys = getApiKeyStorageKey(provider)
  return {
    enc: localStorage.getItem(keys.enc),
    iv: localStorage.getItem(keys.iv)
  }
}

/**
 * Save API Key to localStorage for a specific provider
 */
export const saveApiKeyToStorage = (provider: string, encryptedData: string, iv: string): void => {
  const keys = getApiKeyStorageKey(provider)
  localStorage.setItem(keys.enc, encryptedData)
  localStorage.setItem(keys.iv, iv)
}

/**
 * Clear API Key from localStorage for a specific provider
 */
export const clearApiKeyFromStorage = (provider: string): void => {
  const keys = getApiKeyStorageKey(provider)
  localStorage.removeItem(keys.enc)
  localStorage.removeItem(keys.iv)
}

/**
 * Clear API Keys for all providers
 * Useful when user logs out
 */
export const clearAllApiKeys = (): void => {
  const providers = ['Gemini', 'OpenAI', 'OpenRouter', 'Grok', 'gemini', 'openai', 'openrouter', 'grok']
  providers.forEach(p => clearApiKeyFromStorage(p))
  
  // Also clear legacy keys if they exist
  localStorage.removeItem('metabayn_api_key_enc')
  localStorage.removeItem('metabayn_api_key_iv')
}

/**
 * Migrate legacy API keys to provider-specific storage
 * Call this once during app initialization
 */
export const migrateLegacyApiKeys = async (decryptApiKeyFn: (enc: string, iv: string, secret: string) => Promise<string>): Promise<void> => {
  try {
    const legacyEnc = localStorage.getItem('metabayn_api_key_enc')
    const legacyIv = localStorage.getItem('metabayn_api_key_iv')
    
    // If legacy keys exist and no migration has been done
    if (legacyEnc && legacyIv) {
      const migrationMarker = localStorage.getItem('metabayn:apikey:migrated')
      if (!migrationMarker) {
        // Try to detect provider from the key
        const deviceSecret = '' // Will need to be provided by caller
        try {
          const decrypted = await decryptApiKeyFn(legacyEnc, legacyIv, deviceSecret)
          if (decrypted) {
            // Default to Gemini for legacy keys (previous default)
            const keys = getApiKeyStorageKey('Gemini')
            localStorage.setItem(keys.enc, legacyEnc)
            localStorage.setItem(keys.iv, legacyIv)
            localStorage.setItem('metabayn:apikey:migrated', '1')
            
            // Don't delete legacy keys immediately, keep them for backwards compatibility
          }
        } catch (e) {
          console.warn('Migration of legacy API keys failed:', e)
        }
      }
    }
  } catch (e) {
    console.error('Error during API key migration:', e)
  }
}

/**
 * Get list of all supported providers
 * Used for UI and provider detection
 */
export const getSupportedProviders = (): string[] => {
  return ['Gemini', 'OpenAI', 'OpenRouter', 'Grok']
}
