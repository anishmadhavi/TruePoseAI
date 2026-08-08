// --- worker/src/auth.js: verify a Supabase access token (Updated for New Supabase Auth) ---

export async function verifyToken(token, env) {
    if (!token) throw new Error('NO_TOKEN: no bearer token in Authorization header');

    let res;
    try {
        // Use the new Publishable Key (or fallback to anon key) for the API gateway
        const apiKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
        
        res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'apikey': apiKey
            }
        });
    } catch (e) {
        throw new Error(`FETCH_FAILED: could not reach Supabase (${e.message})`);
    }

    if (!res.ok) {
        let body = '';
        try { body = await res.text(); } catch (_) {}
        
        // Ensure error detail is formatted so index.js can catch it
        throw new Error(`SUPABASE_REJECTED: /auth/v1/user returned ${res.status} ${body.slice(0,200)}`);
    }

    const user = await res.json();
    if (!user || !user.id) throw new Error('NO_USER_ID: Supabase response had no user id');

    return { sub: user.id, email: user.email };
}

export function getBearer(request) {
    const h = request.headers.get('Authorization') || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? m[1] : null;
}
