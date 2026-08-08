// --- worker/src/auth.js: verify a Supabase access token (ES256 via JWKS) ---
// Supabase now signs user JWTs with asymmetric keys (ES256). We verify the
// signature against the project's public JWKS endpoint. Public keys are cached
// in memory between requests.

let JWKS_CACHE = { keys: null, at: 0 };
const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

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

async function getJwks(env) {
    const now = Date.now();
    if (JWKS_CACHE.keys && (now - JWKS_CACHE.at) < JWKS_TTL_MS) return JWKS_CACHE.keys;
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
    if (!res.ok) throw new Error('JWKS_FETCH_FAILED');
    const data = await res.json();
    JWKS_CACHE = { keys: data.keys || [], at: now };
    return JWKS_CACHE.keys;
}

// Returns the decoded payload if valid, otherwise throws.
export async function verifyToken(token, env) {
    if (!token) throw new Error('NO_TOKEN');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('BAD_TOKEN');
    const [headerB64, payloadB64, sigB64] = parts;

    const header = JSON.parse(b64urlToString(headerB64));
    if (header.alg !== 'ES256') throw new Error('UNSUPPORTED_ALG');

    // Find the matching public key by kid
    const keys = await getJwks(env);
    let jwk = keys.find(k => k.kid === header.kid) || keys[0];
    if (!jwk) throw new Error('NO_JWK');

    const key = await crypto.subtle.importKey(
        'jwk', jwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false, ['verify']
    );

    const valid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        b64urlToBytes(sigB64),
        new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );
    if (!valid) throw new Error('BAD_SIGNATURE');

    const payload = JSON.parse(b64urlToString(payloadB64));
    if (payload.exp && Date.now() / 1000 > payload.exp) throw new Error('TOKEN_EXPIRED');
    if (!payload.sub) throw new Error('NO_SUBJECT');
    return payload;
}

export function getBearer(request) {
    const h = request.headers.get('Authorization') || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? m[1] : null;
}
