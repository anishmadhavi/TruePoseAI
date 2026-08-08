// --- worker/src/index.js: TruePose AI API (Cloudflare Worker) ---
// Secure backend. Holds the Gemini key, verifies each user, deducts credits
// atomically, calls Google, stores results in R2, records generations.
//
// Routes:
//   POST /api/image        -> generate one catalog image        (1 credit)
//   POST /api/model        -> generate one base model           (1 credit)
//   POST /api/video/start  -> start a video job                 (2 credits, refunded if it fails)
//   POST /api/video/poll   -> poll a video job; saves on finish
//   GET  /api/file?key=..  -> stream a stored asset (auth'd)
//   POST /api/delete       -> delete a stored asset (frees storage)
//   GET  /api/me           -> balance, status, storage
//   GET  /api/history      -> last 30 days generations

import { verifyToken, getBearer } from './auth.js';
import {
    deductCredits, refundCredits, recordGeneration,
    getOwner, bumpStorage, deleteGenerationRow, rpc
} from './supabase.js';
import { generateImage, startVideo, pollVideo } from './engines.js';

const IMAGE_COST = 1;
const MODEL_COST = 1;
const VIDEO_COST = 2;

function cors(env) {
    return {
        'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    };
}
function json(body, env, status = 200) {
    return new Response(JSON.stringify(body), {
        status, headers: { 'Content-Type': 'application/json', ...cors(env) }
    });
}
function b64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}
function uuid() { return crypto.randomUUID(); }

async function requireOwner(request, env) {
    const token = getBearer(request);
    const payload = await verifyToken(token, env.SUPABASE_JWT_SECRET);
    const owner = await getOwner(env, payload.sub);
    if (!owner) throw new Error('OWNER_NOT_FOUND');
    return owner; // { id, status, credit_balance, storage_used }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: cors(env) });
        }

        try {
            // ---- who am I / balance -------------------------------------
            if (path === '/api/me' && request.method === 'GET') {
                const owner = await requireOwner(request, env);
                return json({
                    status: owner.status,
                    credits: owner.credit_balance,
                    storage_used: owner.storage_used,
                    storage_cap: Number(env.STORAGE_CAP || 200)
                }, env);
            }

            // ---- history (last 30d) -------------------------------------
            if (path === '/api/history' && request.method === 'GET') {
                const owner = await requireOwner(request, env);
                const res = await fetch(
                    `${env.SUPABASE_URL}/rest/v1/generations?owner_id=eq.${owner.id}` +
                    `&created_at=gte.${new Date(Date.now() - 30 * 864e5).toISOString()}` +
                    `&select=kind,credits_charged,r2_key,created_at&order=created_at.desc`,
                    { headers: {
                        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
                        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
                    } }
                );
                return json({ items: await res.json() }, env);
            }

            // ---- image OR model generation ------------------------------
            if ((path === '/api/image' || path === '/api/model') && request.method === 'POST') {
                const owner = await requireOwner(request, env);
                const kind = path === '/api/model' ? 'model' : 'image';
                const cost = kind === 'model' ? MODEL_COST : IMAGE_COST;

                // storage cap
                if ((owner.storage_used || 0) >= Number(env.STORAGE_CAP || 200)) {
                    return json({ error: 'STORAGE_FULL' }, env, 409);
                }

                const body = await request.json();
                const { prompt, images, meta } = body; // images: [b64,...]
                if (!prompt || !Array.isArray(images) || images.length === 0) {
                    return json({ error: 'BAD_REQUEST' }, env, 400);
                }

                // 1) atomic deduct (throws if not approved / insufficient)
                await deductCredits(env, owner.id, cost, `${kind} generation`);

                // 2) call Gemini; refund on hard failure
                let pngB64;
                try {
                    pngB64 = await generateImage(env, prompt, images, meta || {});
                } catch (err) {
                    await refundCredits(env, owner.id, cost, `refund: ${kind} failed`);
                    return json({ error: 'GENERATION_FAILED', detail: String(err.message || err) }, env, 502);
                }

                // 3) store in R2 + record
                const key = `${owner.id}/${kind}/${uuid()}.png`;
                await env.BUCKET.put(key, b64ToBytes(pngB64), {
                    httpMetadata: { contentType: 'image/png' }
                });
                await recordGeneration(env, owner.id, kind, cost, key, meta || {});

                const balance = (await getOwner(env, owner.id)).credit_balance;
                return json({ ok: true, key, credits: balance }, env);
            }

            // ---- video: start -------------------------------------------
            if (path === '/api/video/start' && request.method === 'POST') {
                const owner = await requireOwner(request, env);
                if ((owner.storage_used || 0) >= Number(env.STORAGE_CAP || 200)) {
                    return json({ error: 'STORAGE_FULL' }, env, 409);
                }
                const { prompt, image } = await request.json(); // image: b64 (optional)
                if (!prompt) return json({ error: 'BAD_REQUEST' }, env, 400);

                await deductCredits(env, owner.id, VIDEO_COST, 'video generation');

                let operation;
                try {
                    operation = await startVideo(env, prompt, image || null);
                } catch (err) {
                    await refundCredits(env, owner.id, VIDEO_COST, 'refund: video start failed');
                    return json({ error: 'VIDEO_START_FAILED', detail: String(err.message || err) }, env, 502);
                }
                return json({ ok: true, operation }, env);
            }

            // ---- video: poll --------------------------------------------
            if (path === '/api/video/poll' && request.method === 'POST') {
                const owner = await requireOwner(request, env);
                const { operation } = await request.json();
                if (!operation) return json({ error: 'BAD_REQUEST' }, env, 400);

                const result = await pollVideo(env, operation);

                if (!result.done) return json({ done: false }, env);

                if (result.error) {
                    // hard failure after start -> refund the 2 credits
                    await refundCredits(env, owner.id, VIDEO_COST, 'refund: video failed');
                    return json({ done: true, error: result.error }, env, 502);
                }

                // success -> store the video
                const key = `${owner.id}/video/${uuid()}.mp4`;
                await env.BUCKET.put(key, b64ToBytes(result.videoBase64), {
                    httpMetadata: { contentType: 'video/mp4' }
                });
                await recordGeneration(env, owner.id, 'video', VIDEO_COST, key, {});
                const balance = (await getOwner(env, owner.id)).credit_balance;
                return json({ done: true, ok: true, key, credits: balance }, env);
            }

            // ---- stream a stored file (auth'd) --------------------------
            if (path === '/api/file' && request.method === 'GET') {
                const owner = await requireOwner(request, env);
                const key = url.searchParams.get('key');
                if (!key || !key.startsWith(`${owner.id}/`)) {
                    return json({ error: 'FORBIDDEN' }, env, 403);
                }
                const obj = await env.BUCKET.get(key);
                if (!obj) return json({ error: 'NOT_FOUND' }, env, 404);
                return new Response(obj.body, {
                    headers: {
                        'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
                        'Cache-Control': 'private, max-age=3600',
                        ...cors(env)
                    }
                });
            }

            // ---- delete a stored file -----------------------------------
            if (path === '/api/delete' && request.method === 'POST') {
                const owner = await requireOwner(request, env);
                const { key } = await request.json();
                if (!key || !key.startsWith(`${owner.id}/`)) {
                    return json({ error: 'FORBIDDEN' }, env, 403);
                }
                await env.BUCKET.delete(key);
                await deleteGenerationRow(env, owner.id, key);
                const owner2 = await getOwner(env, owner.id);
                return json({ ok: true, storage_used: owner2.storage_used }, env);
            }

            return json({ error: 'NOT_FOUND' }, env, 404);

        } catch (err) {
            const msg = String(err.message || err);
            // Map known auth/credit errors to clean statuses
            if (/TOKEN|SIGNATURE|SUBJECT|NO_TOKEN|BAD_TOKEN/.test(msg)) return json({ error: 'UNAUTHORIZED' }, env, 401);
            if (msg.includes('NOT_APPROVED')) return json({ error: 'NOT_APPROVED' }, env, 403);
            if (msg.includes('INSUFFICIENT_CREDITS')) return json({ error: 'INSUFFICIENT_CREDITS' }, env, 402);
            if (msg.includes('OWNER_NOT_FOUND')) return json({ error: 'OWNER_NOT_FOUND' }, env, 404);
            return json({ error: 'SERVER_ERROR', detail: msg }, env, 500);
        }
    }
};
