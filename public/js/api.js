// --- api.js: talks to the Cloudflare Worker (never to Google directly) ---
// Every call attaches the Supabase access token. The Worker holds the Gemini
// key, deducts credits, and stores results — the browser never sees the key.

const API_BASE = window.TRUEPOSE_CONFIG.API_BASE;

async function authHeaders() {
    const token = await window.Auth.getToken();
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

// Central error → friendly message
function friendly(code) {
    switch (code) {
        case 'INSUFFICIENT_CREDITS': return 'Not enough credits. Please recharge.';
        case 'NOT_APPROVED':         return 'Your account is awaiting approval.';
        case 'STORAGE_FULL':         return 'Storage full (200 items). Delete some to continue.';
        case 'GENERATION_FAILED':    return 'Generation failed — your credit was refunded.';
        case 'VIDEO_START_FAILED':   return 'Video failed to start — your credits were refunded.';
        case 'UNAUTHORIZED':         return 'Session expired. Please log in again.';
        default:                     return code || 'Something went wrong.';
    }
}

window.API = {
    friendly,

    async me() {
        const res = await fetch(`${API_BASE}/api/me`, { headers: await authHeaders() });
        return await res.json();
    },

    async history() {
        const res = await fetch(`${API_BASE}/api/history`, { headers: await authHeaders() });
        return await res.json();
    },

    // kind: 'image' | 'model'.  images: array of base64 (no prefix). meta optional.
    async generateImage(kind, prompt, images, meta) {
        const res = await fetch(`${API_BASE}/api/${kind}`, {
            method: 'POST', headers: await authHeaders(),
            body: JSON.stringify({ prompt, images, meta })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'ERROR');
        return data; // { ok, key, credits }
    },

    async startVideo(prompt, imageB64) {
        const res = await fetch(`${API_BASE}/api/video/start`, {
            method: 'POST', headers: await authHeaders(),
            body: JSON.stringify({ prompt, image: imageB64 || null })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'ERROR');
        return data; // { ok, operation }
    },

    async pollVideo(operation) {
        const res = await fetch(`${API_BASE}/api/video/poll`, {
            method: 'POST', headers: await authHeaders(),
            body: JSON.stringify({ operation })
        });
        const data = await res.json();
        if (!res.ok && data.error) throw new Error(data.error);
        return data; // { done, ok?, key?, credits?, error? }
    },

    // Returns an object URL for a stored asset (fetches bytes with auth).
    async fileUrl(key) {
        const res = await fetch(`${API_BASE}/api/file?key=${encodeURIComponent(key)}`, {
            headers: await authHeaders()
        });
        if (!res.ok) throw new Error('FILE_FETCH_FAILED');
        const blob = await res.blob();
        return URL.createObjectURL(blob);
    },

    async deleteFile(key) {
        const res = await fetch(`${API_BASE}/api/delete`, {
            method: 'POST', headers: await authHeaders(),
            body: JSON.stringify({ key })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'ERROR');
        return data;
    }
};
