export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  OPENAI_API_KEY: string;
  GEMINI_API_KEY: string;
  RESEND_API_KEY: string;
  EMAIL_FROM?: string; // Optional: Custom Sender Email
  
  // PayPal Config
  PAYPAL_CLIENT_ID: string;
  PAYPAL_CLIENT_SECRET: string;
  PAYPAL_MODE?: string; // 'sandbox' | 'live'

  PROFIT_MULTIPLIER: string; // Environment variable
  // Payment Secrets
  PAYPAL_WEBHOOK_ID: string;   // PayPal Webhook ID for signature verification
  ADMIN_SECRET: string;        // Admin Panel Secret Key
  LYNKID_WEBHOOK_SECRET?: string;
  
  // Google Auth
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  // GOOGLE_REDIRECT_URI removed as it is hardcoded or not used in env anymore

  // Vertex AI Config
  GOOGLE_PROJECT_ID: string;
  GOOGLE_CLIENT_EMAIL: string;
  GOOGLE_PRIVATE_KEY: string; // The full PEM string (handle newlines correctly)
  GOOGLE_LOCATION?: string; // e.g. "us-central1" or "asia-southeast2"
}
