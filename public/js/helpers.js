// --- helpers.js: shared download/format utilities ---

// Save a blob as a file
window.saveBlob = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Convert an (object) image URL to bytes in the requested format (png|jpeg)
window.urlToBytes = async function (url, format) {
    if ((format || 'png') === 'png') {
        const res = await fetch(url);
        return new Uint8Array(await res.arrayBuffer());
    }
    // jpeg: draw onto white canvas
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
    return new Uint8Array(await blob.arrayBuffer());
};

// Download an image URL directly in png|jpeg
window.downloadFromUrl = async function (url, title, format) {
    format = format || 'png';
    const bytes = await window.urlToBytes(url, format);
    const blob = new Blob([bytes], { type: format === 'png' ? 'image/png' : 'image/jpeg' });
    window.saveBlob(blob, `${title}.${format === 'png' ? 'png' : 'jpg'}`);
};

// Download a base64 (no prefix) image in png|jpeg — used by model creator
window.downloadImageAs = function (b64, title, format) {
    const url = `data:image/png;base64,${b64}`;
    window.downloadFromUrl(url, title, format);
};

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}
