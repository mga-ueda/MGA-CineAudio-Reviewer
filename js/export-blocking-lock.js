(function exportBlockingLockModule() {
    let webmExportActive = false;
    let webmExportUserCancel = false;
    let webmExportEmergencyCleanup = null;

    function overlayEl() {
        return document.getElementById('exportBlockingOverlay');
    }

    function subEl() {
        return document.getElementById('exportBlockingSub');
    }

    function formatExportProgressClock(sec) {
        const s = Math.max(0, Math.floor(Number(sec) || 0));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const ss = s % 60;
        const pad = (n) => String(n).padStart(2, '0');
        if (h > 0) return pad(h) + ':' + pad(m) + ':' + pad(ss);
        return pad(m) + ':' + pad(ss);
    }

    function formatWebmExportProgressSub(elapsedSec, totalSec) {
        const total = Math.max(0.001, Number(totalSec) || 0);
        const elapsed = Math.max(0, Number(elapsedSec) || 0);
        const pct = Math.min(100, Math.round((elapsed / total) * 100));
        return (
            'Exporting WebM… ' +
            pct +
            '% (' +
            formatExportProgressClock(elapsed) +
            ' / ' +
            formatExportProgressClock(total) +
            ')'
        );
    }

    function refreshWebmExportControlLocks() {
        const xl = webmExportActive;
        const exportBtn = document.getElementById('sessionExportBtn');
        const importBtn = document.getElementById('sessionImportBtn');
        const exportWebmBtn = document.getElementById('sessionExportVideoBtn');
        const allClearBtn = document.getElementById('sessionAllClearBtn');
        if (exportBtn) exportBtn.disabled = xl;
        if (importBtn) importBtn.disabled = xl;
        if (exportWebmBtn) exportWebmBtn.disabled = xl;
        if (allClearBtn && xl) allClearBtn.disabled = true;
        if (typeof updateControlsEnabled === 'function') updateControlsEnabled();
        if (!xl && typeof refreshExportMediaOptionsUi === 'function') {
            refreshExportMediaOptionsUi();
        }
        if (!xl && typeof updateSessionAllClearButton === 'function') {
            updateSessionAllClearButton();
        }
    }

    function setExportBlockingVisible(visible) {
        const root = overlayEl();
        if (!root) return;
        webmExportActive = !!visible;
        if (visible) {
            root.hidden = false;
            root.setAttribute('aria-hidden', 'false');
            if (subEl()) subEl().textContent = '';
            document.body.classList.add('export-blocking-active');
            try {
                root.focus({ preventScroll: true });
            } catch (_) {}
        } else {
            root.hidden = true;
            root.setAttribute('aria-hidden', 'true');
            if (subEl()) subEl().textContent = '';
            document.body.classList.remove('export-blocking-active');
            webmExportUserCancel = false;
            webmExportEmergencyCleanup = null;
        }
        refreshWebmExportControlLocks();
    }

    function updateExportBlockingSub(text) {
        const sub = subEl();
        if (sub && text != null) sub.textContent = String(text);
    }

    function isWebmExportActive() {
        return webmExportActive;
    }

    function isWebmExportCancelRequested() {
        return webmExportUserCancel;
    }

    function tryCancelWebmExportFromEsc() {
        if (!webmExportActive) return;
        webmExportUserCancel = true;
        updateExportBlockingSub('Cancelling…');
        if (typeof webmExportEmergencyCleanup === 'function') {
            webmExportEmergencyCleanup();
        }
        if (typeof writeLog === 'function') {
            writeLog('Export WebM: cancel requested (Esc)');
        }
    }

    function beginWebmExportLock(opt) {
        webmExportUserCancel = false;
        webmExportEmergencyCleanup = null;
        setExportBlockingVisible(true);
        try {
            const ae = document.activeElement;
            if (ae && ae !== document.body && typeof ae.blur === 'function') {
                ae.blur();
            }
        } catch (_) {}
        const totalSec = opt && Number.isFinite(opt.durationSec) ? opt.durationSec : 0;
        updateExportBlockingSub(
            totalSec > 0
                ? formatWebmExportProgressSub(0, totalSec)
                : 'Preparing export…',
        );
    }

    function endWebmExportLock() {
        setExportBlockingVisible(false);
    }

    function setWebmExportEmergencyCleanup(fn) {
        webmExportEmergencyCleanup = typeof fn === 'function' ? fn : null;
    }

    window.setExportBlockingVisible = setExportBlockingVisible;
    window.updateExportBlockingSub = updateExportBlockingSub;
    window.formatWebmExportProgressSub = formatWebmExportProgressSub;
    window.isWebmExportActive = isWebmExportActive;
    window.isWebmExportCancelRequested = isWebmExportCancelRequested;
    window.tryCancelWebmExportFromEsc = tryCancelWebmExportFromEsc;
    window.beginWebmExportLock = beginWebmExportLock;
    window.endWebmExportLock = endWebmExportLock;
    window.setWebmExportEmergencyCleanup = setWebmExportEmergencyCleanup;
})();
