// --- file-manager.js: garment + background uploads (production) ---
// Browser folder-sync (showDirectoryPicker) was local-only and is dropped for
// the SaaS build. Garments upload as before; backgrounds come from preloaded
// locations (locations.js) or the user's own uploads.

window.AppState = {
    selectedModelBase64: null,
    selectedModelLocFingerprint: null,
    selectedModelLocName: null,
    selectedBgBase64: null,
    selectedBgFingerprint: null,
    selectedBgName: null,
    garments: []
};

document.addEventListener('DOMContentLoaded', () => {
    const garmentUpload = document.getElementById('garmentUpload');
    const garmentPreviewGrid = document.getElementById('garmentPreviewGrid');
    const garmentPrompt = document.getElementById('garmentPrompt');
    const bgUpload = document.getElementById('bgUpload');

    // ---- Garments (up to 10) ----
    if (garmentUpload) {
        garmentUpload.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files).slice(0, 10);
            if (!files.length) return;
            window.AppState.garments = [];
            garmentPreviewGrid.innerHTML = '';
            garmentPreviewGrid.style.display = 'grid';
            garmentPrompt.style.display = 'none';
            window.logToTerminal(`Processing ${files.length} garment image(s)...`, 'loading');

            for (let file of files) {
                try {
                    if (file.name.toLowerCase().endsWith('.heic')) {
                        const blob = await heic2any({ blob: file, toType: 'image/jpeg' });
                        file = new File([blob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
                    }
                    await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            const b64 = ev.target.result;
                            window.AppState.garments.push(b64.split(',')[1]);
                            const img = document.createElement('img');
                            img.src = b64;
                            img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:4px;';
                            garmentPreviewGrid.appendChild(img);
                            resolve();
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(file);
                    });
                } catch (err) {
                    window.logToTerminal(`Failed to process ${file.name}: ${err.message}`, 'error');
                }
            }
            window.logToTerminal(`Loaded ${window.AppState.garments.length} garment(s).`, 'success');
        });
    }

    // ---- Own background upload (adds to bg gallery via registerCustomLocation) ----
    if (bgUpload) {
        bgUpload.addEventListener('change', async (e) => {
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
                        window.registerCustomLocation(b64, name, fp);
                        window.logToTerminal(`Added background: ${name}`, 'success');
                        resolve();
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
            } catch (err) {
                window.logToTerminal(`Failed to add background: ${err.message}`, 'error');
            }
        });
    }
});
