export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MANAGEMENT_KEY?: string;
  GEMINI_API_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string; // Optional: Custom Sender Email
  
  // PayPal Config
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_MODE?: string; // 'sandbox' | 'live'

  PROFIT_MULTIPLIER: string; // Environment variable
  // Payment Secrets
  PAYPAL_WEBHOOK_ID?: string;   // PayPal Webhook ID for signature verification
  ADMIN_SECRET?: string;        // Admin Panel Secret Key
  LYNKID_WEBHOOK_SECRET?: string;
  
  // Cloudflare AI Binding
  AI: any;
}
