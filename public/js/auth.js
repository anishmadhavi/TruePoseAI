// --- auth.js: Supabase email/password auth (frontend) ---
// Uses the Supabase JS client (loaded via CDN in the HTML).

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.TRUEPOSE_CONFIG;
window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

window.Auth = {
    async signUp(email, password, businessName) {
        return await window.sb.auth.signUp({
            email, password,
            options: { data: { business_name: businessName || '' } }
        });
    },
    async signIn(email, password) {
        return await window.sb.auth.signInWithPassword({ email, password });
    },
    async signOut() {
        await window.sb.auth.signOut();
        location.href = 'auth.html';
    },
    async getToken() {
        const { data } = await window.sb.auth.getSession();
        return data?.session?.access_token || null;
    },
    // Redirect to login if not authenticated. Returns the session if OK.
    async requireSession() {
        const { data } = await window.sb.auth.getSession();
        if (!data?.session) { location.href = 'auth.html'; return null; }
        return data.session;
    }
};
