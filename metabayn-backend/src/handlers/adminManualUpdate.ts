import { Env } from '../types';

export async function handleManualUpdateUser(request: Request, env: Env): Promise<Response> {
    try {
        const body: any = await request.json();
        const { user_id, tokens, subscription_active, subscription_days } = body;

        if (!user_id) {
            return Response.json({ error: "User ID is required" }, { status: 400 });
        }

        // 1. Update Tokens if provided
        const tokenVal = Number(tokens);
        if (!isNaN(tokenVal) && tokens !== undefined && tokens !== null) {
            // User requested Add/Increment logic
            // "jika saldo token ditambahkan langsung menambahkan saldo token"
            await env.DB.prepare("UPDATE users SET tokens = COALESCE(tokens, 0) + ? WHERE id = ?")
                .bind(tokenVal, user_id)
                .run();
        }

        // 2. Update Subscription if provided
        // subscription_active can be boolean or number (0/1)
        if (subscription_active !== undefined) {
            const isActive = subscription_active ? 1 : 0;
            
            // If activating subscription and expiry date provided explicitly
            if (isActive && body.subscription_expiry_date) {
                // Set specific expiry date
                // "pengaturan durasinya diatur mulai tanggal sampai tanggal sekian"
                try {
                    const expiryDate = new Date(body.subscription_expiry_date);
                    if (isNaN(expiryDate.getTime())) {
                        throw new Error("Invalid date format");
                    }
                    const expiryIso = expiryDate.toISOString();
                    
                    await env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?")
                        .bind(expiryIso, user_id)
                        .run();
                } catch (e) {
                     return Response.json({ error: "Invalid expiry date provided" }, { status: 400 });
                }
            } else if (isActive && subscription_days && Number(subscription_days) > 0) {
                // Fallback: Add Days logic (calculated from now)
                const baseDate = new Date();
                baseDate.setDate(baseDate.getDate() + Number(subscription_days));
                const expiryIso = baseDate.toISOString();

                await env.DB.prepare("UPDATE users SET subscription_active = 1, subscription_expiry = ? WHERE id = ?")
                    .bind(expiryIso, user_id)
                    .run();
            } else if (isActive) {
                 // Just activate without changing expiry
                 await env.DB.prepare("UPDATE users SET subscription_active = 1 WHERE id = ?")
                    .bind(user_id)
                    .run();
            } else {
                // Deactivate / Remove Premium
                // "menghapus status premium user atau menghilangkan durasi langganannya menjadi status free"
                await env.DB.prepare("UPDATE users SET subscription_active = 0 WHERE id = ?")
                    .bind(user_id)
                    .run();
            }
        }

        return Response.json({ success: true, message: "User updated successfully" });
    } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
    }
}
