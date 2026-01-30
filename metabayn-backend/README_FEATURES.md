# Metabayn AI Backend - New Features Documentation

This backend has been enhanced with enterprise-grade stability, security, and dynamic pricing features.

## 🚀 Key Features

### 1. Robust Request Handling
- **Rate Limiter**: Limits users to 1 request every 800ms to prevent spam.
- **Concurrency Lock**: Ensures a user can only have ONE active AI generation job at a time.
- **Daily Token Limit**: Caps usage at 200,000 tokens/day per user (resets at 00:00 UTC).

### 2. Intelligent Model Fallback
- **Auto-Failover**: If the primary model fails (timeout, overload, provider error), the system automatically tries the next best model.
- **Cost Safety**: Fallback NEVER selects a model more expensive than the user's choice.
- **Provider Preference**: Prioritizes keeping the same provider (OpenAI -> OpenAI) before switching.

### 3. Dynamic Pricing & Fair Billing
- **Database-Driven Pricing**: Prices are managed via the `model_prices` table, editable via Admin API.
- **Fair Billing**: Users are ALWAYS charged based on the model they **selected**, not the fallback model used.
- **Profit Protection**: System ensures `Input Cost < Output Revenue` even during fallback.

### 4. Admin API
Manage model prices without redeploying code.

- **GET** `/admin/model-prices` - List all model prices
- **POST** `/admin/model-prices` - Add a new model
- **PUT** `/admin/model-prices/{id}` - Update existing model
- **DELETE** `/admin/model-prices/{id}` - Remove a model

**User Subscription Management:**
- **GET** `/admin/users` - List all users with subscription status
- **POST** `/admin/users/subscription` - Update user subscription
  ```json
  {
    "user_id": 123,
    "is_active": true,
    "expiry_date": "2025-12-31T23:59:59Z"
  }
  ```

**Example JSON Body for POST/PUT:**
```json
{
  "provider": "openai",
  "model_name": "gpt-4o-mini",
  "input_price": 0.15,
  "output_price": 0.60,
  "profit_multiplier": 1.5,
  "active": 1,
  "fallback_priority": 2
}
```

## 🛠️ Setup & Migration

1. **Database Migration**
   If you haven't run the migration yet, execute:
   ```bash
   npm run db:init
   # OR
   npx wrangler d1 execute metabayn-db --local --file=./schema.sql
   ```

2. **Development**
   ```bash
   npm run dev
   ```

## 📂 Project Structure (New Modules)

- `src/handlers/ai.ts`: Main logic integrating all features.
- `src/utils/`:
  - `userRateLimiter.ts`: 800ms throttle.
  - `concurrencyLock.ts`: Single active job enforcement.
  - `tokenDailyLimit.ts`: Daily quota checker.
  - `modelFallback.ts`: Smart fallback chain generator.
  - `tokenCostManager.ts`: Pricing calculator & history recorder.
  - `aiQueue.ts` & `providerThrottle.ts`: Global queue management.

---
*Generated for Metabayn Architecture*
