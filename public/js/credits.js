// --- credits.js: header balance + status + storage, and gating helpers ---

window.Credits = {
    state: { credits: 0, status: 'pending', storage_used: 0, storage_cap: 200 },

    async refresh() {
        try {
            const me = await window.API.me();
            if (me && !me.error) {
                this.state = me;
                this.render();
            }
            return me;
        } catch (_) { return null; }
    },

    render() {
        const c = document.getElementById('creditCount');
        const s = document.getElementById('storageCount');
        if (c) c.textContent = this.state.credits;
        if (s) s.textContent = `${this.state.storage_used}/${this.state.storage_cap}`;

        const badge = document.getElementById('lowBalanceBadge');
        if (badge) badge.style.display = (this.state.credits < 5) ? 'inline-flex' : 'none';

        const pending = document.getElementById('pendingBanner');
        if (pending) pending.style.display = (this.state.status !== 'approved') ? 'flex' : 'none';
    },

    // True if the user can start a generation costing `cost` credits.
    canGenerate(cost) {
        if (this.state.status !== 'approved') return { ok: false, reason: 'NOT_APPROVED' };
        if (this.state.credits < 5) return { ok: false, reason: 'LOW_BALANCE' };
        if (this.state.credits < cost) return { ok: false, reason: 'INSUFFICIENT_CREDITS' };
        if (this.state.storage_used >= this.state.storage_cap) return { ok: false, reason: 'STORAGE_FULL' };
        return { ok: true };
    },

    setCredits(n) { this.state.credits = n; this.render(); }
};
