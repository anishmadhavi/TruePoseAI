// --- config.js: public frontend configuration (NO secrets) ---
// These two values are safe to expose in the browser:
//   - Supabase URL and the ANON key are designed to be public; Row Level
//     Security protects the data.
//   - API_BASE is your deployed Worker URL.
// Fill these in after you deploy (see README). They are not secrets.

window.TRUEPOSE_CONFIG = {
    SUPABASE_URL: "https://hyqsnueouzlwerwguzsu.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5cXNudWVvdXpsd2Vyd2d1enN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNDkyNTYsImV4cCI6MjEwMTcyNTI1Nn0.Y1ZsjveigpHyca80KsbP3R9J96nEU4cnNNnX9tbVYMQ",
    API_BASE: "https://truepose-ai-api.anishmadhavi.workers.dev"
};
