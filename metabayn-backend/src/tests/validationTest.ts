import { Env } from '../types';
import { validateUserAccess } from '../utils/validation';

export async function runValidationTests(env: Env) {
    const results: any[] = [];
    const TEST_USER_ID = 999999;
    
    try {
        // --- Setup ---
        // Clean previous test user
        await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(TEST_USER_ID).run();

        // Helper to run a test case
        const runTest = async (
            name: string, 
            data: { tokens: number, active: number, expiry: string | null, hasApiKey?: boolean }, 
            expectedValid: boolean,
            options?: { mode?: 'gateway' | 'standard', feature?: 'metadata' | 'csv_fix' }
        ) => {
            try {
                // Insert User Data
                const apiKey = data.hasApiKey ? "sk-dummy-key" : null;
                await env.DB.prepare(
                    "INSERT INTO users (id, email, password, tokens, subscription_active, subscription_expiry, created_at, or_api_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
                ).bind(
                    TEST_USER_ID, 
                    `testuser_${Date.now()}@example.com`, 
                    'dummy_hash', 
                    data.tokens, 
                    data.active, 
                    data.expiry, 
                    Math.floor(Date.now() / 1000),
                    apiKey
                ).run();

                // Run Validation
                const result = await validateUserAccess(TEST_USER_ID, env, options);
                
                // Assertions
                let passed = result.valid === expectedValid;
                let details = "";

                if (!passed) {
                    details = `Expected valid=${expectedValid}, got ${result.valid}. Error: ${result.error}`;
                }

                results.push({
                    test: name,
                    status: passed ? "PASSED" : "FAILED",
                    details: passed ? "OK" : details,
                    actual_error: result.error
                });

            } catch (e: any) {
                results.push({
                    test: name,
                    status: "ERROR",
                    details: e.message
                });
            } finally {
                // Cleanup
                await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(TEST_USER_ID).run();
            }
        };

        // --- Test Cases ---
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 30);
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 1);

        // 1. Gateway Mode (Default)
        await runTest(
            "Gateway: Valid User (Tokens > 50, Active Sub)", 
            { tokens: 1000, active: 1, expiry: futureDate.toISOString() }, 
            true
        );

        await runTest(
            "Gateway: Insufficient Tokens (< 50)", 
            { tokens: 0, active: 1, expiry: futureDate.toISOString() }, 
            false
        );

        await runTest(
            "Gateway: Expired Subscription", 
            { tokens: 1000, active: 1, expiry: pastDate.toISOString() }, 
            false
        );

        // 2. Standard Mode (Auto-detect via API Key)
        // Should be valid even with LOW tokens if subscription is active
        await runTest(
            "Standard (Auto): Low Tokens but Active Sub + API Key", 
            { tokens: 0, active: 1, expiry: futureDate.toISOString(), hasApiKey: true }, 
            true
        );

        await runTest(
            "Standard (Auto): Expired Subscription + API Key", 
            { tokens: 1000, active: 1, expiry: pastDate.toISOString(), hasApiKey: true }, 
            false
        );

        // 3. CSV Fix Feature (Special Exception)
        // Should be valid if Tokens > 50 even if Subscription Expired
        await runTest(
            "CSV Fix: Expired Sub but Enough Tokens", 
            { tokens: 1000, active: 1, expiry: pastDate.toISOString() }, 
            true,
            { feature: 'csv_fix' }
        );

        await runTest(
            "CSV Fix: Free User (No Sub) + High Tokens", 
            { tokens: 1000, active: 0, expiry: null }, 
            true,
            { feature: 'csv_fix' }
        );

        await runTest(
            "CSV Fix: Expired Sub + Low Tokens", 
            { tokens: 0, active: 1, expiry: pastDate.toISOString() }, 
            false,
            { feature: 'csv_fix' }
        );

        await runTest(
            "CSV Fix: Expired Sub + Zero Tokens + API Key (Standard)", 
            { tokens: 0, active: 1, expiry: pastDate.toISOString(), hasApiKey: true }, 
            true,
            { feature: 'csv_fix' }
        );

        // Verify Metadata feature fails in same conditions
        await runTest(
            "Metadata: Expired Sub + High Tokens (Should Fail)", 
            { tokens: 1000, active: 1, expiry: pastDate.toISOString() }, 
            false,
            { feature: 'metadata' }
        );

        // 4. Explicit Mode Override
        // Force Gateway even if user has API Key -> Should fail on low tokens
        await runTest(
            "Force Gateway: Low Tokens + API Key", 
            { tokens: 0, active: 1, expiry: futureDate.toISOString(), hasApiKey: true }, 
            false,
            { mode: 'gateway' }
        ); 

    } catch (e: any) {
        return { error: "Test Suite Failed", details: e.message };
    }

    return { 
        summary: `Tests Completed: ${results.length}`,
        results 
    };
}
