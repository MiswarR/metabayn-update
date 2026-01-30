
const lastRequestTime: Record<string, number> = {
  openai: 0,
  gemini: 0
};

const INTERVALS: Record<string, number> = {
  openai: 10,
  gemini: 10,
  groq: 10
};

export async function waitTurn(provider: string) {
  const now = Date.now();
  const last = lastRequestTime[provider] || 0;
  const interval = INTERVALS[provider] || 0;
  
  const timeSinceLast = now - last;
  
  if (timeSinceLast < interval) {
    const delay = interval - timeSinceLast;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  // Update timestamp AFTER waiting (or immediately if no wait needed)
  // This marks the "start" of the allowed slot.
  lastRequestTime[provider] = Date.now();
}
