// --- worker/src/engines.js: Google model calls (image + video) ---
// The Gemini API key lives ONLY here in the Worker env — never sent to browsers.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// ---- Image / base-model generation (Gemini Flash) --------------------------
// images: array of base64 strings (no data-uri prefix). Returns base64 PNG.
export async function generateImage(env, prompt, images, opts = {}) {
    const engine = env.IMAGE_MODEL || 'gemini-3.1-flash-image-preview';
    const url = `${GEMINI_BASE}/models/${engine}:generateContent?key=${env.GEMINI_API_KEY}`;

    const parts = [{ text: prompt }];
    for (const b64 of images) {
        if (b64) parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
    }

    const payload = {
        contents: [{ parts }],
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
                aspectRatio: opts.aspectRatio || '4:5',
                imageSize: opts.imageSize || env.IMAGE_SIZE || '2K'
            }
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Gemini error');

    for (const cand of (data.candidates || [])) {
        for (const part of (cand.content?.parts || [])) {
            if (part.inlineData?.data) return part.inlineData.data; // base64 PNG
        }
    }
    throw new Error('No image returned by Gemini.');
}

// ---- Video generation (Veo Lite) — async: start then poll -----------------
// Returns an operation name to poll.
export async function startVideo(env, prompt, imageB64) {
    const engine = env.VIDEO_MODEL || 'veo-3.1-lite-generate-preview';
    const url = `${GEMINI_BASE}/models/${engine}:predictLongRunning?key=${env.GEMINI_API_KEY}`;

    const instance = { prompt };
    if (imageB64) instance.image = { bytesBase64Encoded: imageB64, mimeType: 'image/jpeg' };

    const payload = {
        instances: [instance],
        parameters: {
            aspectRatio: '9:16',
            durationSeconds: Number(env.VIDEO_SECONDS || 8),
            generateAudio: false            // no-audio tier (cheaper)
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Veo start error');
    if (!data.name) throw new Error('Veo did not return an operation name.');
    return data.name; // operation id to poll
}

// Poll an operation once. Returns { done, videoBase64?, error? }.
export async function pollVideo(env, operationName) {
    const url = `${GEMINI_BASE}/${operationName}?key=${env.GEMINI_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) return { done: true, error: data.error.message || 'Veo poll error' };
    if (!data.done) return { done: false };

    // Dig the video bytes out of the response (shape can vary by version)
    const resp = data.response || {};
    const vids = resp.videos || resp.generatedVideos || resp.generateVideoResponse?.generatedSamples || [];
    for (const v of vids) {
        const b64 = v.bytesBase64Encoded || v.video?.bytesBase64Encoded || v.video?.encodedVideo;
        if (b64) return { done: true, videoBase64: b64 };
        const uri = v.uri || v.video?.uri;
        if (uri) {
            // Fetch the file bytes and return as base64
            const fr = await fetch(`${uri}${uri.includes('?') ? '&' : '?'}key=${env.GEMINI_API_KEY}`);
            const buf = new Uint8Array(await fr.arrayBuffer());
            let bin = '';
            for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
            return { done: true, videoBase64: btoa(bin) };
        }
    }
    return { done: true, error: 'Video finished but no data found.' };
}
