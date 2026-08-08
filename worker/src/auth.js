// --- worker/src/auth.js: verify a Supabase access token (with diagnostics) ---

export async function verifyToken(token, env) {
    if (!token) throw new Error('NO_TOKEN: no bearer token in Authorization header');

    let res;
    try {
        res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY
            }
        });
    } catch (e) {
        throw new Error(`FETCH_FAILED: could not reach ${env.SUPABASE_URL}/auth/v1/user (${e.message})`);
    }

    if (!res.ok) {
        let body = '';
        try { body = await res.text(); } catch (_) {}
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
