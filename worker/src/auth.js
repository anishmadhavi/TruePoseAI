// --- worker/src/auth.js: verify a Supabase access token ---
// Supabase issues ES256 (asymmetric) user tokens. Rather than verify the
// signature locally, we ask Supabase's auth API who the token belongs to.
// Simple and reliable: if Supabase accepts the token, it's valid.

export async function verifyToken(token, env) {
    if (!token) throw new Error('NO_TOKEN');

    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY
        }
    });

    if (!res.ok) throw new Error('BAD_TOKEN');

    const user = await res.json();
    if (!user || !user.id) throw new Error('NO_SUBJECT');

    // Match the old shape: payload.sub = the owner's user id
    return { sub: user.id, email: user.email };
}

export function getBearer(request) {
    const h = request.headers.get('Authorization') || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? m[1] : null;
}
