// --- model-creator.js: Base Model Generator (production / API-backed) ---
// Calls window.API.generateImage('model', ...). Worker deducts 1 credit,
// calls Gemini, stores in R2. Created model is locked to its location.

document.addEventListener('DOMContentLoaded', () => {
    const modelGallery   = document.getElementById('modelGallery');
    const createdGallery = document.getElementById('createdModelsGallery');
    const mcGenerateBtn  = document.getElementById('mcGenerateBtn');
    if (!mcGenerateBtn) return;

    const inputs = { dress: null, ref: null, loc: null, locFp: null, locName: null };

    window.__mcSetLocation = function (b64, fingerprint, name) {
        inputs.loc = b64; inputs.locFp = fingerprint; inputs.locName = name;
        const ind = document.getElementById('mcLocSelected');
        if (ind) { ind.style.display = 'block'; ind.innerHTML = `<i class="ph-bold ph-map-pin"></i> Location set: <strong>${name}</strong>`; }
        window.logToTerminal(`Model location set: ${name}`, 'info');
    };

    document.querySelectorAll('.loc-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.loc-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const mode = btn.getAttribute('data-loc');
            document.getElementById('mcLocPreloadedWrap').style.display = mode === 'preloaded' ? 'block' : 'none';
            document.getElementById('mcLocOwnWrap').style.display = mode === 'own' ? 'block' : 'none';
        });
    });

    function wireUpload(inputId, thumbWrapId, imgId, promptId, key) {
        const input = document.getElementById(inputId);
        const thumbWrap = document.getElementById(thumbWrapId);
        const imgEl = document.getElementById(imgId);
        const promptEl = document.getElementById(promptId);
        if (!input) return;
        input.addEventListener('change', async (e) => {
            let file = e.target.files[0];
            if (!file) return;
            try {
                if (file.name.toLowerCase().endsWith('.heic')) {
                    const blob = await heic2any({ blob: file, toType: 'image/jpeg' });
                    file = new File([blob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
                }
                await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        inputs[key] = ev.target.result.split(',')[1];
                        imgEl.src = ev.target.result;
                        thumbWrap.style.display = 'block';
                        promptEl.style.display = 'none';
                        resolve();
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
            } catch (err) { window.logToTerminal(`Failed to load ${key}: ${err.message}`, 'error'); }
        });
    }
    wireUpload('mcDressUpload', 'mcDressThumb', 'mcDressImg', 'mcDressPrompt', 'dress');
    wireUpload('mcRefUpload', 'mcRefThumb', 'mcRefImg', 'mcRefPrompt', 'ref');

    const locInput = document.getElementById('mcLocUpload');
    if (locInput) {
        locInput.addEventListener('change', async (e) => {
            let file = e.target.files[0];
            if (!file) return;
            try {
                if (file.name.toLowerCase().endsWith('.heic')) {
                    const blob = await heic2any({ blob: file, toType: 'image/jpeg' });
                    file = new File([blob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
                }
                await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const b64 = ev.target.result.split(',')[1];
                        const name = file.name.replace(/\.[^.]+$/, '');
                        const fp = window.locHash(b64);
                        document.getElementById('mcLocImg').src = ev.target.result;
                        document.getElementById('mcLocThumb').style.display = 'block';
                        document.getElementById('mcLocPrompt').style.display = 'none';
                        window.__mcSetLocation(b64, fp, name);
                        window.registerCustomLocation(b64, name, fp);
                        resolve();
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
            } catch (err) { window.logToTerminal(`Failed to load location: ${err.message}`, 'error'); }
        });
    }

    function buildPrompt(hasRef) {
        const age = document.getElementById('mcAgeGroup').value;
        const ethnicity = document.getElementById('mcEthnicity').value.trim();
        const hairStyle = document.getElementById('mcHairStyle').value;
        const hairColour = document.getElementById('mcHairColour').value;
        const skinTone = document.getElementById('mcSkinTone').value;
        const accessories = document.getElementById('mcAccessories').value.trim();
        const refClause = hasRef
            ? `Use @image2 as a REFERENCE for the model's general appearance and facial features — create a NEW, similar-looking model inspired by it (do not copy any real identifiable person). `
            : '';
        return `RAW professional fashion photography, full-body shot, photorealistic, natural lighting, sharp focus. ` +
            `@image1 is a mannequin wearing a dress. @image3 is the location/background. ${refClause}` +
            `Replace the mannequin with a real human female fashion model with these attributes: age group ${age} years, ${ethnicity} ethnicity, ${hairStyle.toLowerCase()} ${hairColour.toLowerCase()} hair, ${skinTone.toLowerCase()} skin tone, subtle natural smile, relaxed front-facing pose. Accessories: ${accessories}. ` +
            `Keep the EXACT same dress design, cut, silhouette and length as on the mannequin, but render the dress in PLAIN SOLID WHITE fabric with NO print, NO pattern, NO embroidery — a clean blank white garment. ` +
            `Place the model naturally into the environment shown in @image3, matching its lighting, perspective and shadows so she looks genuinely photographed in that location (not pasted). A clean, reusable base model identity for a fashion catalog.`;
    }

    mcGenerateBtn.addEventListener('click', async () => {
        if (!inputs.dress) return window.logToTerminal('ERROR: Upload a mannequin dress photo.', 'error');
        if (!inputs.loc) return window.logToTerminal('ERROR: Select or upload a location.', 'error');

        const gate = window.Credits.canGenerate(1);
        if (!gate.ok) return window.logToTerminal(`Cannot create: ${window.API.friendly(gate.reason)}`, 'error');

        mcGenerateBtn.disabled = true;
        const log = window.logToTerminal('Creating base model... (1 credit)', 'loading');

        try {
            const hasRef = !!inputs.ref;
            const prompt = buildPrompt(hasRef);
            const images = [inputs.dress, hasRef ? inputs.ref : inputs.dress, inputs.loc];
            const meta = { locFp: inputs.locFp, locName: inputs.locName };
            const result = await window.API.generateImage('model', prompt, images, meta);

            window.Credits.setCredits(result.credits);
            const url = await window.API.fileUrl(result.key);
            addCreatedModel(url, inputs.locFp, inputs.locName);

            log.innerHTML = `<span class="log-time">[${new Date().toLocaleTimeString([],{hour12:false})}]</span><span class="log-success"><i class="ph-bold ph-check" style="color:var(--ok);"></i> Base model created in “${inputs.locName}”.</span>`;
        } catch (err) {
            log.innerHTML = `<span class="log-time">[${new Date().toLocaleTimeString([],{hour12:false})}]</span><span class="log-error"><i class="ph-bold ph-x" style="color:var(--error);"></i> ${window.API.friendly(err.message)}</span>`;
        }
        window.Credits.refresh();
        mcGenerateBtn.disabled = false;
    });

    let count = 0;
    async function addCreatedModel(url, locFp, locName) {
        count++;
        const title = `TruePose_Model_${count}`;
        // fetch base64 for the photoshoot pipeline (needs raw bytes to re-send)
        const b64 = await (async () => {
            const res = await fetch(url); const blob = await res.blob();
            return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
        })();

        const mcPlaceholder = document.getElementById('mcGalleryPlaceholder');
        if (mcPlaceholder) mcPlaceholder.remove();

        const card = document.createElement('div');
        card.style.cssText = 'background:var(--bg-input);padding:10px;border-radius:8px;border:1px solid var(--border-color);';
        card.innerHTML = `
            <img src="${url}" style="width:100%;border-radius:4px;aspect-ratio:3/4;object-fit:cover;">
            <div style="margin-top:8px;font-weight:bold;font-size:0.85rem;color:var(--accent);">Model ${count}</div>
            <div style="font-size:0.72rem;color:var(--text-muted);"><i class="ph ph-map-pin"></i> ${locName || 'location'}</div>
            <button class="btn-dark mc-dl" style="margin-top:8px;padding:7px;font-size:0.8rem;width:100%;"><i class="ph-bold ph-download-simple"></i> Download</button>`;
        card.querySelector('.mc-dl').addEventListener('click', () => {
            const fmt = (document.getElementById('mcDownloadFormat')?.value) || 'png';
            window.downloadFromUrl(url, title, fmt);
        });
        createdGallery.prepend(card);

        const placeholder = modelGallery.querySelector('.empty-gallery');
        if (placeholder) placeholder.remove();
        const item = document.createElement('div');
        item.className = 'gallery-item';
        item.innerHTML = `<img src="${url}" title="${title}"><span class="created-tag">NEW</span>`;
        item.onclick = () => {
            Array.from(modelGallery.children).forEach(c => c.classList.remove('selected'));
            item.classList.add('selected');
            window.AppState.selectedModelBase64 = b64;
            window.AppState.selectedModelLocFingerprint = locFp;
            window.AppState.selectedModelLocName = locName;
            window.logToTerminal(`Selected ${title} (location: ${locName}).`, 'info');
            window.updateLocationWarning();
        };
        modelGallery.prepend(item);
        item.click();
    }
});
