export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Konfigurasi CORS agar bisa diakses dari aplikasi Tauri
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    let targetUrl = '';
    
    // 1. Cek Credit/Usage (Target: /auth/key)
    if (url.pathname.endsWith('/auth/key') || url.pathname.includes('/key')) {
      targetUrl = 'https://openrouter.ai/api/v1/auth/key';
    } 
    // 2. Chat Completions (Target: /chat/completions)
    else {
      targetUrl = 'https://openrouter.ai/api/v1/chat/completions';
    }

    const newRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method === 'POST' ? request.body : null,
    });

    // INJEKSI API KEY
    // Pastikan Variable 'OPENROUTER_API_KEY' ada di Settings -> Variables pada Cloudflare Dashboard
    newRequest.headers.set('Authorization', `Bearer ${env.OPENROUTER_API_KEY}`);
    newRequest.headers.set('HTTP-Referer', 'https://metabayn.app');
    newRequest.headers.set('X-Title', 'Metabayn Desktop App');

    try {
      const response = await fetch(newRequest);
      const newResponse = new Response(response.body, response);
      newResponse.headers.set('Access-Control-Allow-Origin', '*');
      return newResponse;
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
  },
};