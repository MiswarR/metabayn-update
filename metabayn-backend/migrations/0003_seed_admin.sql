-- Seed Admin User (Password: adminbayn)
-- device_hash is NULL so it binds to the first device that logs in
INSERT OR REPLACE INTO users (id, email, password, tokens, is_admin, device_hash) 
VALUES (1, 'metabayn@gmail.com', '32c4077c73378a897fb94b0a6839358d:9dcebe4dbc602251b9f964490656d1e4506416b0bfadaae3d61805d6d7c66b10', 999999, 1, NULL);
