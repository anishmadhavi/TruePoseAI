// --- worker/src/supabase.js: server-side Supabase calls (service role) ---
// The service role key bypasses RLS, so ONLY the Worker uses it — never the
// frontend. Used for atomic credit deduction, refunds, and writing generation
// rows.

function headers(env) {
    return {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    };
}

// Call a Postgres function (RPC). Throws with the DB error code on failure.
export async function rpc(env, fn, args) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: headers(env),
        body: JSON.stringify(args)
    });
    const text = await res.text();
    if (!res.ok) {
        // Surface the DB exception message (e.g. INSUFFICIENT_CREDITS)
        let msg = text;
        try { msg = JSON.parse(text).message || text; } catch (_) {}
        throw new Error(msg);
    }
    try { return JSON.parse(text); } catch (_) { return text; }
}

// Deduct credits atomically. Returns new balance. Throws INSUFFICIENT_CREDITS /
// NOT_APPROVED / OWNER_NOT_FOUND.
export function deductCredits(env, ownerId, amount, reason) {
    return rpc(env, 'deduct_credits', {
        p_owner: ownerId,
        p_amount: amount,
        p_reason: reason,
        p_min_balance: Number(env.MIN_GENERATION_BALANCE || 5)
    });
}

// Refund credits (on hard API failure). Returns new balance.
export function refundCredits(env, ownerId, amount, reason) {
    return rpc(env, 'add_credits', {
        p_owner: ownerId,
        p_amount: amount,
        p_type: 'refund',
        p_reason: reason
    });
}

// Insert a generation row + bump storage_used.
export async function recordGeneration(env, ownerId, kind, credits, r2Key, meta) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/generations`, {
        method: 'POST',
        headers: { ...headers(env), 'Prefer': 'return=minimal' },
        body: JSON.stringify({
            owner_id: ownerId, kind, credits_charged: credits,
            r2_key: r2Key, meta: meta || {}, status: 'complete'
        })
    });
    // bump storage counter
    await bumpStorage(env, ownerId, 1);
}

// Read a single owner row (status, balance, storage_used).
export async function getOwner(env, ownerId) {
    const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/owners?id=eq.${ownerId}&select=id,status,credit_balance,storage_used`,
        { headers: headers(env) }
    );
    const rows = await res.json();
    return rows && rows[0] ? rows[0] : null;
}

// Adjust storage_used by delta (can be negative on delete).
export async function bumpStorage(env, ownerId, delta) {
    const owner = await getOwner(env, ownerId);
    if (!owner) return;
    const next = Math.max(0, (owner.storage_used || 0) + delta);
    await fetch(`${env.SUPABASE_URL}/rest/v1/owners?id=eq.${ownerId}`, {
        method: 'PATCH',
        headers: { ...headers(env), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ storage_used: next })
    });
}

// Delete a generation row by r2_key for this owner (used on file delete).
export async function deleteGenerationRow(env, ownerId, r2Key) {
    await fetch(
        `${env.SUPABASE_URL}/rest/v1/generations?owner_id=eq.${ownerId}&r2_key=eq.${encodeURIComponent(r2Key)}`,
        { method: 'DELETE', headers: { ...headers(env), 'Prefer': 'return=minimal' } }
    );
    await bumpStorage(env, ownerId, -1);
}
