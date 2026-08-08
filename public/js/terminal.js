// --- terminal.js: Handles UI Logging (multi-terminal aware) ---

// Global function accessible by other scripts.
// Writes to EVERY element with class "terminal" so logs stay in sync
// across tabs (Photoshoot Studio + Model Creation each have one).
window.logToTerminal = function(message, type = 'info') {
    const time = new Date().toLocaleTimeString([], { hour12: false });

    let icon = '';
    if (type === 'success') icon = '<i class="ph-bold ph-check" style="color:#10b981;"></i> ';
    if (type === 'error') icon = '<i class="ph-bold ph-x" style="color:#ef4444;"></i> ';
    if (type === 'warning') icon = '<i class="ph-bold ph-warning" style="color:#f59e0b;"></i> ';
    if (type === 'loading') icon = '<i class="ph ph-spinner spinner" style="color:#60a5fa;"></i> ';

    const html = `
        <span class="log-time">[${time}]</span>
        <span class="log-${type === 'loading' ? 'info' : type}">${icon}${message}</span>
    `;

    const terminals = document.querySelectorAll('.terminal');
    let lastEntry = null;
    terminals.forEach(box => {
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerHTML = html;
        box.appendChild(entry);
        box.scrollTop = box.scrollHeight;
        lastEntry = entry; // return the last one (used to update spinners)
    });
    return lastEntry;
};

// Initialize once DOM is ready (terminals may not exist at parse time)
document.addEventListener('DOMContentLoaded', () => {
    window.logToTerminal('System initialized. Modular core loaded.', 'success');
    window.logToTerminal('Awaiting API Key and assets.', 'info');
});
