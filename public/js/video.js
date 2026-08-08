// --- video.js: Video generation tab (Veo Lite, no audio) — 2 credits ---
// Upload an image + prompt → Worker starts a Veo job → we poll until done →
// stored in R2 → shown with download. Credits refunded by the Worker on failure.

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('vidGenerateBtn');
    if (!btn) return;

    const upload = document.getElementById('vidImageUpload');
    const thumb = document.getElementById('vidImageThumb');
    const thumbImg = document.getElementById('vidImageImg');
    const prompt = document.getElementById('vidPromptInput');
    const gallery = document.getElementById('videoGallery');
    const placeholder = document.getElementById('vidGalleryPlaceholder');

    let imageB64 = null;
    const store = new Map(); // id -> {key, url, title}
    let counter = 0;

    if (upload) {
        upload.addEventListener('change', async (e) => {
            let file = e.target.files[0];
            if (!file) return;
            if (file.name.toLowerCase().endsWith('.heic')) {
                const blob = await heic2any({ blob: file, toType: 'image/jpeg' });
                file = new File([blob], 'img.jpg', { type: 'image/jpeg' });
            }
            const reader = new FileReader();
            reader.onload = (ev) => {
                imageB64 = ev.target.result.split(',')[1];
                thumbImg.src = ev.target.result;
                thumb.style.display = 'block';
                document.getElementById('vidUploadPrompt').style.display = 'none';
            };
            reader.readAsDataURL(file);
        });
    }

    btn.addEventListener('click', async () => {
        const text = (prompt.value || '').trim();
        if (!text) return window.logToTerminal('ERROR: Enter a video prompt.', 'error');

        const gate = window.Credits.canGenerate(2);
        if (!gate.ok) return window.logToTerminal(`Cannot start: ${window.API.friendly(gate.reason)}`, 'error');

        btn.disabled = true;
        const log = window.logToTerminal('Starting video generation... (2 credits)', 'loading');

        try {
            const start = await window.API.startVideo(text, imageB64);
            await window.Credits.refresh();
            log.innerHTML = logLine('info', 'Video job started. Generating (this can take 1–3 min)...');

            // Poll until done
            const op = start.operation;
            let done = false;
            while (!done) {
                await new Promise(r => setTimeout(r, 8000)); // poll every 8s
                const res = await window.API.pollVideo(op);
                if (res.done) {
                    done = true;
                    if (res.error) {
                        log.innerHTML = logLine('error', `Video failed: ${res.error} (credits refunded)`);
                        window.Credits.refresh();
                    } else {
                        window.Credits.setCredits(res.credits);
                        const url = await window.API.fileUrl(res.key);
                        addVideo(url, res.key);
                        log.innerHTML = logLine('success', 'Video ready.');
                    }
                }
            }
        } catch (err) {
            log.innerHTML = logLine('error', window.API.friendly(err.message));
            window.Credits.refresh();
        }
        btn.disabled = false;
    });

    function addVideo(url, key) {
        counter++;
        const id = `vid_${counter}`;
        const title = `TruePose_Video_${counter}`;
        store.set(id, { key, url, title });
        if (placeholder) placeholder.style.display = 'none';

        const card = document.createElement('div');
        card.style.cssText = 'background:var(--bg-input);padding:10px;border-radius:8px;border:1px solid var(--border-color);';
        card.innerHTML = `
            <video src="${url}" controls style="width:100%;border-radius:4px;"></video>
            <div style="margin-top:8px;font-weight:bold;font-size:0.85rem;color:var(--accent);">${title}</div>
            <button class="btn-dark vid-dl" style="margin-top:8px;padding:7px;font-size:0.8rem;width:100%;"><i class="ph-bold ph-download-simple"></i> Download</button>`;
        card.querySelector('.vid-dl').addEventListener('click', async () => {
            const res = await fetch(url); const blob = await res.blob();
            window.saveBlob(blob, `${title}.mp4`);
        });
        gallery.prepend(card);
    }

    function logLine(type, msg) {
        const icons = { success: 'ph-check', error: 'ph-x', info: 'ph-info' };
        const colors = { success: 'var(--ok)', error: 'var(--error)', info: 'var(--info)' };
        return `<span class="log-time">[${new Date().toLocaleTimeString([],{hour12:false})}]</span><span class="log-${type === 'error' ? 'error' : type === 'success' ? 'success' : 'info'}"><i class="ph-bold ${icons[type]}" style="color:${colors[type]};"></i> ${msg}</span>`;
    }
});
