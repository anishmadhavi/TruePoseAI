// --- app.js: Photoshoot production loop (production / API-backed) ---
// Calls the Worker (window.API) instead of Google directly. The Worker deducts
// credits, calls Gemini, and stores each image in R2. We display via object URLs.

document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('generateBtn');
    const progressPanel = document.getElementById('progressPanel');
    const progressBar = document.getElementById('progressBar');
    const progressStatus = document.getElementById('progressStatus');
    const progressPercent = document.getElementById('progressPercent');
    const productionGallery = document.getElementById('productionGallery');
    const galleryPlaceholder = document.getElementById('galleryPlaceholder');
    const categorySelect = document.getElementById('categorySelect');
    const poseCheckboxesContainer = document.getElementById('poseCheckboxes');

    // Pose database (same as offline tool)
    const poseDatabase = window.POSE_DATABASE;

    // Store keys + object URLs for download/zip
    const imageStore = new Map(); // id -> { key, title, url, b64 }
    let imageCounter = 0;

    function loadPosesForCategory() {
        const poses = poseDatabase[categorySelect.value] || [];
        poseCheckboxesContainer.innerHTML = '';
        poses.forEach((pose, index) => {
            const label = document.createElement('label');
            label.style.cssText = 'display:flex;align-items:flex-start;gap:8px;font-size:0.9rem;color:var(--text-light);cursor:pointer;';
            label.innerHTML = `<input type="checkbox" class="pose-checkbox" value="${pose.prompt.replace(/"/g,'&quot;')}" data-headline="${pose.headline}" ${index < 2 ? 'checked' : ''} style="margin-top:3px;"><span>${pose.headline}</span>`;
            poseCheckboxesContainer.appendChild(label);
        });
    }
    categorySelect.addEventListener('change', loadPosesForCategory);
    loadPosesForCategory();

    // Download helper (PNG direct / JPEG via canvas) — shared with model creator
    async function download(id) {
        const item = imageStore.get(id);
        if (!item) return;
        const fmt = (document.getElementById('downloadFormat')?.value) || 'png';
        window.downloadFromUrl(item.url, item.title, fmt);
    }
    window.__downloadProd = download;

    generateBtn.addEventListener('click', async () => {
        const checked = document.querySelectorAll('.pose-checkbox:checked');
        const poses = Array.from(checked).map(b => ({ prompt: b.value, headline: b.getAttribute('data-headline') }));

        if (!window.AppState.garments.length) return window.logToTerminal('ERROR: Upload at least 1 garment.', 'error');
        if (!window.AppState.selectedModelBase64) return window.logToTerminal('ERROR: Select a model.', 'error');
        if (!window.AppState.selectedBgBase64) return window.logToTerminal('ERROR: Select a background.', 'error');
        if (!poses.length) return window.logToTerminal('ERROR: Select at least one pose.', 'error');

        const total = window.AppState.garments.length * poses.length;
        const gate = window.Credits.canGenerate(total);
        if (!gate.ok) return window.logToTerminal(`Cannot start: ${window.API.friendly(gate.reason)}`, 'error');

        generateBtn.disabled = true;
        if (galleryPlaceholder) galleryPlaceholder.style.display = 'none';
        progressPanel.style.display = 'block';

        let step = 0;
        window.logToTerminal(`--- BATCH: ${window.AppState.garments.length} garment(s) × ${poses.length} pose(s) ---`, 'info');

        for (let g = 0; g < window.AppState.garments.length; g++) {
            for (let p = 0; p < poses.length; p++) {
                const pose = poses[p];
                const log = window.logToTerminal(`Generating "${pose.headline}" (garment ${g+1})...`, 'loading');
                progressStatus.innerText = `Garment ${g+1}: ${pose.headline}...`;

                try {
                    const prompt = `RAW professional fashion photography, 8k, ultra-crisp detail, sharp focus. Seamlessly combine the uploaded model face and the background. Apply this exact pose: ${pose.prompt}. Keep the exact color and print of the uploaded garment perfectly intact, allowing fabric to drape and flow naturally. Natural lighting, realistic skin texture, photorealistic masterpiece.`;
                    const images = [
                        window.AppState.selectedModelBase64,
                        window.AppState.garments[g],
                        window.AppState.selectedBgBase64
                    ];
                    const meta = { pose: pose.headline, category: categorySelect.value };
                    const result = await window.API.generateImage('image', prompt, images, meta);

                    window.Credits.setCredits(result.credits);
                    const url = await window.API.fileUrl(result.key);
                    const id = `img_${imageCounter++}`;
                    const title = `TruePose_G${g+1}_${pose.headline.replace(/[^a-z0-9]/gi,'_')}`;
                    imageStore.set(id, { key: result.key, title, url });

                    const card = document.createElement('div');
                    card.style.cssText = 'background:var(--bg-input);padding:10px;border-radius:8px;border:1px solid var(--border-color);position:relative;';
                    card.innerHTML = `
                        <input type="checkbox" class="img-select-cb" data-id="${id}" style="position:absolute;top:15px;left:15px;width:20px;height:20px;cursor:pointer;accent-color:var(--accent);z-index:5;" checked>
                        <img src="${url}" style="width:100%;border-radius:4px;aspect-ratio:4/5;object-fit:cover;">
                        <div style="margin-top:10px;font-weight:bold;font-size:0.9rem;color:var(--accent);">${pose.headline}</div>
                        <div style="font-size:0.8rem;color:var(--text-muted);">Garment ${g+1}</div>
                        <button class="btn-dark" onclick="window.__downloadProd('${id}')" style="margin-top:8px;padding:8px;font-size:0.85rem;width:100%;"><i class="ph-bold ph-download-simple"></i> Download</button>
                    `;
                    productionGallery.prepend(card);

                    log.innerHTML = `<span class="log-time">[${new Date().toLocaleTimeString([],{hour12:false})}]</span><span class="log-success"><i class="ph-bold ph-check" style="color:var(--ok);"></i> "${pose.headline}" done.</span>`;
                } catch (err) {
                    log.innerHTML = `<span class="log-time">[${new Date().toLocaleTimeString([],{hour12:false})}]</span><span class="log-error"><i class="ph-bold ph-x" style="color:var(--error);"></i> "${pose.headline}": ${window.API.friendly(err.message)}</span>`;
                    // stop batch on credit/approval/storage errors
                    if (['INSUFFICIENT_CREDITS','NOT_APPROVED','STORAGE_FULL','UNAUTHORIZED'].includes(err.message)) {
                        window.logToTerminal('Batch stopped.', 'warning');
                        generateBtn.disabled = false;
                        return;
                    }
                }

                step++;
                const pct = Math.round((step / total) * 100);
                progressBar.style.width = `${pct}%`;
                progressPercent.innerText = `${pct}%`;
            }
        }

        progressStatus.innerText = 'Batch complete';
        window.logToTerminal('--- BATCH COMPLETE ---', 'info');
        window.Credits.refresh();
        generateBtn.disabled = false;
    });

    // ZIP selected
    document.getElementById('downloadZipBtn').addEventListener('click', async () => {
        const selected = document.querySelectorAll('.img-select-cb:checked');
        if (!selected.length) return alert('Select at least one image.');
        window.logToTerminal(`Zipping ${selected.length} file(s)...`, 'loading');
        const zip = new JSZip();
        const fmt = (document.getElementById('downloadFormat')?.value) || 'png';
        for (const box of selected) {
            const item = imageStore.get(box.getAttribute('data-id'));
            if (!item) continue;
            const bytes = await window.urlToBytes(item.url, fmt);
            zip.file(`${item.title}.${fmt === 'png' ? 'png' : 'jpg'}`, bytes);
        }
        const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        window.saveBlob(blob, `TruePose_${new Date().toISOString().slice(0,10)}.zip`);
        window.logToTerminal('ZIP ready.', 'success');
    });
});
