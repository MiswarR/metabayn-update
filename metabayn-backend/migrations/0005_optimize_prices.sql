-- Migration 0005: Add and update pricing for Flash models (Ultra Low Cost)
-- Prices based on Google Vertex AI / AI Studio pricing (approximate per 1M tokens)

-- Gemini 1.5 Flash: ~0.075 USD / 1M input, ~0.30 USD / 1M output
INSERT INTO model_prices (provider, model_name, input_price, output_price, active) VALUES 
('gemini', 'gemini-1.5-flash', 0.075, 0.30, 1)
ON CONFLICT(model_name) DO UPDATE SET 
input_price = excluded.input_price, 
output_price = excluded.output_price,
active = 1;

-- Gemini 2.0 Flash Lite: Same pricing target
INSERT INTO model_prices (provider, model_name, input_price, output_price, active) VALUES 
('gemini', 'gemini-2.0-flash-lite', 0.075, 0.30, 1)
ON CONFLICT(model_name) DO UPDATE SET 
input_price = excluded.input_price, 
output_price = excluded.output_price,
active = 1;

-- Gemini 1.5 Pro: ~3.50 USD / 1M input, ~10.50 USD / 1M output
INSERT INTO model_prices (provider, model_name, input_price, output_price, active) VALUES 
('gemini', 'gemini-1.5-pro', 3.50, 10.50, 1)
ON CONFLICT(model_name) DO UPDATE SET 
input_price = excluded.input_price, 
output_price = excluded.output_price;
