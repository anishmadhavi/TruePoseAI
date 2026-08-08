// --- locations.js: preloaded locations + location lock/warn system ---
// PRODUCTION: preloaded locations are defined here as a list. Point each `src`
// at a real location image you host (e.g. in the R2 bucket or /img/locations/).
// Users can also upload their own (registered into the background gallery).
//
// The lock/warn system is unchanged from the offline tool: every created model
// carries a fingerprint of its location; production warns on mismatch.

// EDIT ME: your preloaded location library. Add as many as you like.
// `src` can be any URL your page can load. During early launch you can host
// a handful under public/img/locations/.
window.PRELOADED_LOCATIONS = [
    // { id: 'studio_white', name: 'Studio White', src: 'img/locations/studio_white.jpg' },
    // { id: 'garden',       name: 'Garden',       src: 'img/locations/garden.jpg' },
];

window.locHash = function (b64) {
    if (!b64) return null;
    const s = b64.slice(0, 3000) + '|' + b64.length;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return 'loc_custom_' + (h >>> 0).toString(16);
};

// Load an image URL and return its base64 (no prefix). Used so preloaded
// locations can be sent to the Worker just like uploads.
async function urlToBase64(src) {
    const res = await fetch(src);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(',')[1]);
        r.onerror = reject;
        r.readAsDataURL(blob);
    });
}

window.setSelectedBackground = function (b64, fingerprint, name, itemEl) {
    const bgGallery = document.getElementById('bgGallery');
    if (bgGallery) Array.from(bgGallery.children).forEach(c => c.classList.remove('selected'));
    if (itemEl) itemEl.classList.add('selected');
    window.AppState.selectedBgBase64 = b64;
    window.AppState.selectedBgFingerprint = fingerprint;
    window.AppState.selectedBgName = name;
    window.logToTerminal(`Selected background: ${name}`, 'info');
    window.updateLocationWarning();
};

window.updateLocationWarning = function () {
    const el = document.getElementById('locWarning');
    const txt = document.getElementById('locWarningText');
    if (!el || !txt) return;
    const mFp = window.AppState.selectedModelLocFingerprint;
    const bFp = window.AppState.selectedBgFingerprint;
    const mName = window.AppState.selectedModelLocName || 'its original location';
    const bName = window.AppState.selectedBgName || 'a different location';
    if (mFp && bFp && mFp !== bFp) {
        txt.textContent = `This model was created in “${mName}”, but you selected “${bName}”. ` +
                          `Use the same location, or the image will look incorrect.`;
        el.style.display = 'flex';
    } else {
        el.style.display = 'none';
    }
};

window.registerCustomLocation = function (b64, name, fingerprint) {
    const bgGallery = document.getElementById('bgGallery');
    if (!bgGallery) return;
    if (bgGallery.querySelector(`[data-fp="${fingerprint}"]`)) return;
    const placeholder = bgGallery.querySelector('.empty-gallery');
    if (placeholder) placeholder.remove();
    const dataUri = `data:image/jpeg;base64,${b64}`;
    const item = document.createElement('div');
    item.className = 'gallery-item preloaded-loc';
    item.setAttribute('data-fp', fingerprint);
    item.innerHTML = `<img src="${dataUri}" title="${name}"><span class="created-tag" style="background:var(--info);">YOURS</span>`;
    item.onclick = () => window.setSelectedBackground(b64, fingerprint, name, item);
    bgGallery.prepend(item);
};

// Populate the model-creation picker and the production background gallery
document.addEventListener('DOMContentLoaded', async () => {
    const mcPicker = document.getElementById('mcLocPreloadedGallery');
    const bgGallery = document.getElementById('bgGallery');

    for (const loc of window.PRELOADED_LOCATIONS) {
        let b64;
        try { b64 = await urlToBase64(loc.src); } catch (_) { continue; }
        const fingerprint = 'loc_' + loc.id;
        const dataUri = `data:image/jpeg;base64,${b64}`;

        if (mcPicker) {
            const pick = document.createElement('div');
            pick.className = 'gallery-item';
            pick.innerHTML = `<img src="${dataUri}" title="${loc.name}">`;
            pick.onclick = () => {
                Array.from(mcPicker.children).forEach(c => c.classList.remove('selected'));
                pick.classList.add('selected');
                if (window.__mcSetLocation) window.__mcSetLocation(b64, fingerprint, loc.name);
            };
            mcPicker.appendChild(pick);
        }

        if (bgGallery) {
            const ph = bgGallery.querySelector('.empty-gallery');
            if (ph) ph.remove();
            const item = document.createElement('div');
            item.className = 'gallery-item preloaded-loc';
            item.setAttribute('data-fp', fingerprint);
            item.innerHTML = `<img src="${dataUri}" title="${loc.name}"><span class="created-tag">LOC</span>`;
            item.onclick = () => window.setSelectedBackground(b64, fingerprint, loc.name, item);
            bgGallery.appendChild(item);
        }
    }

    if (mcPicker && !mcPicker.children.length) {
        mcPicker.innerHTML = '<div class="empty-gallery">No preloaded locations yet — use "Upload Your Own", or add some in locations.js</div>';
    }
});
