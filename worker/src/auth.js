// --- worker/src/auth.js: verify a Supabase access token (HS256 JWT) ---
// Supabase signs user JWTs with your project's JWT secret (HS256). We verify
// the signature + expiry locally so every generation request is authenticated
// without an extra round-trip to Supabase.

function b64urlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function b64urlToString(s) {
    return new TextDecoder().decode(b64urlToBytes(s));
}

// Returns the decoded payload if valid, otherwise throws.
export async function verifyToken(token, jwtSecret) {
    if (!token) throw new Error('NO_TOKEN');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('BAD_TOKEN');

    const [headerB64, payloadB64, sigB64] = parts;

    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(jwtSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
    );

    const valid = await crypto.subtle.verify(
        'HMAC',
        key,
        b64urlToBytes(sigB64),
        new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );
    if (!valid) throw new Error('BAD_SIGNATURE');

    const payload = JSON.parse(b64urlToString(payloadB64));

    if (payload.exp && Date.now() / 1000 > payload.exp) {
        throw new Error('TOKEN_EXPIRED');
    }
    if (!payload.sub) throw new Error('NO_SUBJECT');

    return payload; // payload.sub = the owner's user id
}

// Pull the bearer token out of the Authorization header
export function getBearer(request) {
    const h = request.headers.get('Authorization') || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? m[1] : null;
}
