// --- tabs.js: Simple tab switcher ---
document.addEventListener('DOMContentLoaded', () => {
    const buttons = document.querySelectorAll('.tab-btn');
    const panes = document.querySelectorAll('.tab-pane');

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-tab');

            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            panes.forEach(p => {
                p.classList.toggle('active', p.id === `tab-${target}`);
            });
        });
    });
});
