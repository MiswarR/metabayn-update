export const MODEL_CONFIG: any = {
  "profit_multiplier_min": 1.6,
  "profit_multiplier_max": 1.8,
  "safety_buffer": 1.10,
  "usd_per_credit": 0.0001,

  "models": {
    "gpt-4.1": {
      "provider": "openai",
      "input": 3.00,
      "output": 12.00,
      "official": true,
      "enabled": true
    },
    "gpt-4o": {
      "provider": "openai",
      "input": 2.50,
      "output": 10.00,
      "official": true,
      "enabled": true
    },
    "gpt-4o-mini": {
      "provider": "openai",
      "input": 0.15,
      "output": 0.60,
      "official": true,
      "enabled": true
    },
    "gpt-4o-realtime": {
      "provider": "openai",
      "input": 5.00,
      "output": 20.00,
      "official": true,
      "enabled": false
    },
    "gpt-4-turbo": {
      "provider": "openai",
      "input": 10.00,
      "output": 30.00,
      "official": true,
      "enabled": true
    },
    "o3": {
      "provider": "openai",
      "input": 4.00,
      "output": 16.00,
      "official": true,
      "enabled": true
    },
    "o4-mini": {
      "provider": "openai",
      "input": 0.20,
      "output": 0.80,
      "official": true,
      "enabled": true
    },
    "o1": {
      "provider": "openai",
      "input": 15.00,
      "output": 60.00,
      "official": true,
      "enabled": true
    },
    "gemini-2.5-pro": {
      "provider": "gemini",
      "input": 1.25,
      "output": 10.00,
      "official": true,
      "enabled": true
    },
    "gemini-2.5-flash": {
      "provider": "gemini",
      "input": 0.30,
      "output": 2.50,
      "official": true,
      "enabled": true
    },
    "gemini-2.5-flash-lite": {
      "provider": "gemini",
      "input": 0.10,
      "output": 0.40,
      "official": true,
      "enabled": true
    },
    "gemini-2.5-ultra": {
      "provider": "gemini",
      "input": 2.50,
      "output": 12.00,
      "official": true,
      "enabled": true
    },
    "gemini-1.5-pro": {
      "provider": "gemini",
      "input": 3.50,
      "output": 10.50,
      "official": false,
      "enabled": true
    },
    "gemini-1.5-flash": {
      "provider": "gemini",
      "input": 0.075,
      "output": 0.30,
      "official": false,
      "enabled": true
    },
    "gemini-1.5-flash-8b": {
      "provider": "gemini",
      "input": 0.0375,
      "output": 0.15,
      "official": false,
      "enabled": true
    },
    "gemini-2.0-pro": {
      "provider": "gemini",
      "input": 3.50,
      "output": 10.50,
      "official": false,
      "enabled": true
    },
    "gemini-2.0-pro-exp-02-05": {
      "provider": "gemini",
      "input": 3.50,
      "output": 10.50,
      "official": false,
      "enabled": true
    },
    "gemini-2.0-flash": {
      "provider": "gemini",
      "input": 0.10,
      "output": 0.40,
      "official": false,
      "enabled": true
    },
    "gemini-2.0-flash-exp": {
      "provider": "gemini",
      "input": 0.10,
      "output": 0.40,
      "official": false,
      "enabled": true
    },
    "gemini-2.0-flash-lite": {
      "provider": "gemini",
      "input": 0.075,
      "output": 0.30,
      "official": false,
      "enabled": true
    },
    "gemini-2.0-flash-lite-preview-02-05": {
      "provider": "gemini",
      "input": 0.075,
      "output": 0.30,
      "official": false,
      "enabled": true
    },
    "gemini-2.0-ultra": {
      "provider": "gemini",
      "input": 2.50,
      "output": 12.00,
      "official": true,
      "enabled": true
    },
    "gemini-3.0-flash-preview": {
      "provider": "gemini",
      "input": 0.35,
      "output": 3.00,
      "official": false,
      "enabled": true
    },
    "gemini-3.0-pro-preview": {
      "provider": "gemini",
      "input": 1.50,
      "output": 8.00,
      "official": false,
      "enabled": true
    },
    "gemini-3.0-ultra": {
      "provider": "gemini",
      "input": 4.00,
      "output": 12.00,
      "official": true,
      "enabled": true
    },
    "gemini-pro": {
      "provider": "gemini",
      "input": 0.50,
      "output": 1.50,
      "official": false,
      "enabled": true
    }
  }
};
