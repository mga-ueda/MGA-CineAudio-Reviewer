(function exportBlockingLockModule() {
    const WAVEFORM_RESTORE_FADE_MS = 200;

    /** @type {null | 'webm-export' | 'waveform-restore'} */
    let blockingMode = null;
    let webmExportUserCancel = false;
    let webmExportEmergencyCleanup = null;

    function overlayEl() {
        return document.getElementById('exportBlockingOverlay');
    }

    function titleEl() {
        return document.getElementById('exportBlockingTitle');
    }

    function escHintEl() {
        return document.getElementById('exportBlockingEscHint');
    }

    function subEl() {
        return document.getElementById('exportBlockingSub');
    }

    function minimalEl() {
        return document.getElementById('exportBlockingMinimal');
    }

    function panelEl() {
        const root = overlayEl();
        return root ? root.querySelector('.export-blocking-overlay__panel') : null;
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

    function refreshOperationBlockingControlLocks() {
        const xl = blockingMode !== null;
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

    function applyBlockingOverlayChrome(opt) {
        const title = titleEl();
        const esc = escHintEl();
        if (title && opt && opt.title) title.textContent = String(opt.title);
        if (esc) {
            if (opt && opt.escHint != null) {
                esc.hidden = false;
                esc.textContent = String(opt.escHint);
            } else if (opt && opt.hideEscHint) {
                esc.hidden = true;
            } else {
                esc.hidden = false;
                esc.innerHTML =
                    '操作はロックされています。<kbd>Esc</kbd> キーで書き出しをキャンセルできます。';
            }
        }
    }

    function applyBlockingOverlayLayout(opt) {
        const root = overlayEl();
        if (!root) return;
        const minimal = !!(opt && opt.minimal);
        root.classList.toggle('export-blocking-overlay--minimal', minimal);
        const minEl = minimalEl();
        const panel = panelEl();
        if (minEl) minEl.hidden = !minimal;
        if (panel) panel.hidden = minimal;
        if (minimal) {
            root.setAttribute('aria-labelledby', 'exportBlockingMinimal');
        } else {
            root.setAttribute('aria-labelledby', 'exportBlockingTitle');
        }
    }

    function setOperationBlockingVisible(visible, opt) {
        const root = overlayEl();
        if (!root) return;
        if (visible) {
            root.classList.remove('export-blocking-overlay--fading-out');
            applyBlockingOverlayLayout(opt);
            if (!(opt && opt.minimal)) {
                applyBlockingOverlayChrome(opt);
            }
            root.hidden = false;
            root.setAttribute('aria-hidden', 'false');
            if (subEl()) subEl().textContent = (opt && opt.sub) || '';
            document.body.classList.add('export-blocking-active');
            try {
                root.focus({ preventScroll: true });
            } catch (_) {}
        } else {
            root.hidden = true;
            root.setAttribute('aria-hidden', 'true');
            root.classList.remove('export-blocking-overlay--minimal');
            if (subEl()) subEl().textContent = '';
            const minEl = minimalEl();
            if (minEl) minEl.hidden = true;
            const panel = panelEl();
            if (panel) panel.hidden = false;
            root.setAttribute('aria-labelledby', 'exportBlockingTitle');
            document.body.classList.remove('export-blocking-active');
            blockingMode = null;
            webmExportUserCancel = false;
            webmExportEmergencyCleanup = null;
            applyBlockingOverlayChrome({
                title: 'Exporting WebM',
                hideEscHint: false,
            });
        }
        refreshOperationBlockingControlLocks();
    }

    function setExportBlockingVisible(visible) {
        if (visible) {
            blockingMode = 'webm-export';
            setOperationBlockingVisible(true, {
                title: 'Exporting WebM',
                hideEscHint: false,
            });
        } else if (blockingMode === 'webm-export') {
            setOperationBlockingVisible(false);
        }
    }

    function updateExportBlockingSub(text) {
        if (blockingMode === 'waveform-restore') return;
        const sub = subEl();
        if (sub && text != null) sub.textContent = String(text);
    }

    function isWebmExportActive() {
        return blockingMode === 'webm-export';
    }

    function isWaveformRestoreLockActive() {
        return blockingMode === 'waveform-restore';
    }

    function isOperationBlockingActive() {
        return blockingMode !== null;
    }

    function isWebmExportCancelRequested() {
        return webmExportUserCancel;
    }

    function tryCancelWebmExportFromEsc() {
        if (!isWebmExportActive()) return;
        webmExportUserCancel = true;
        updateExportBlockingSub('Cancelling…');
        if (typeof webmExportEmergencyCleanup === 'function') {
            webmExportEmergencyCleanup();
        }
        if (typeof writeLog === 'function') {
            writeLog('Export WebM: cancel requested (Esc)');
        }
    }

    function beginWaveformRestoreLock(opt) {
        if (blockingMode === 'webm-export') return;
        blockingMode = 'waveform-restore';
        setOperationBlockingVisible(true, { minimal: true });
        try {
            const ae = document.activeElement;
            if (ae && ae !== document.body && typeof ae.blur === 'function') {
                ae.blur();
            }
        } catch (_) {}
    }

    function cleanupWaveformRestoreOverlayDom() {
        const root = overlayEl();
        if (!root) return;
        root.classList.remove(
            'export-blocking-overlay--fading-out',
            'export-blocking-overlay--minimal',
        );
        root.hidden = true;
        root.setAttribute('aria-hidden', 'true');
        const minEl = minimalEl();
        if (minEl) minEl.hidden = true;
        const panel = panelEl();
        if (panel) panel.hidden = false;
        root.setAttribute('aria-labelledby', 'exportBlockingTitle');
    }

    function fadeOutWaveformRestoreOverlay() {
        const root = overlayEl();
        if (!root || root.hidden) {
            cleanupWaveformRestoreOverlayDom();
            return Promise.resolve();
        }

        const reducedMotion =
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const fadeMs = reducedMotion ? 0 : WAVEFORM_RESTORE_FADE_MS;

        return new Promise((resolve) => {
            let finished = false;
            const finish = () => {
                if (finished) return;
                finished = true;
                cleanupWaveformRestoreOverlayDom();
                resolve();
            };

            if (fadeMs <= 0) {
                finish();
                return;
            }

            const onTransitionEnd = (ev) => {
                if (ev.target !== root || ev.propertyName !== 'opacity') return;
                root.removeEventListener('transitionend', onTransitionEnd);
                finish();
            };
            root.addEventListener('transitionend', onTransitionEnd);
            requestAnimationFrame(() => {
                root.classList.add('export-blocking-overlay--fading-out');
            });
            setTimeout(() => {
                root.removeEventListener('transitionend', onTransitionEnd);
                finish();
            }, fadeMs + 40);
        });
    }

    function endWaveformRestoreLock() {
        if (blockingMode !== 'waveform-restore') return Promise.resolve();
        blockingMode = null;
        document.body.classList.remove('export-blocking-active');
        refreshOperationBlockingControlLocks();
        if (typeof updateControlsEnabled === 'function') {
            updateControlsEnabled();
        }
        return fadeOutWaveformRestoreOverlay();
    }

    function beginWebmExportLock(opt) {
        if (blockingMode === 'waveform-restore') return;
        webmExportUserCancel = false;
        webmExportEmergencyCleanup = null;
        blockingMode = 'webm-export';
        setOperationBlockingVisible(true, {
            title: 'Exporting WebM',
            hideEscHint: false,
        });
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
        if (blockingMode === 'webm-export') {
            setOperationBlockingVisible(false);
        }
    }

    function setWebmExportEmergencyCleanup(fn) {
        webmExportEmergencyCleanup = typeof fn === 'function' ? fn : null;
    }

    window.setExportBlockingVisible = setExportBlockingVisible;
    window.updateExportBlockingSub = updateExportBlockingSub;
    window.formatWebmExportProgressSub = formatWebmExportProgressSub;
    window.isWebmExportActive = isWebmExportActive;
    window.isWaveformRestoreLockActive = isWaveformRestoreLockActive;
    window.isOperationBlockingActive = isOperationBlockingActive;
    window.isWebmExportCancelRequested = isWebmExportCancelRequested;
    window.tryCancelWebmExportFromEsc = tryCancelWebmExportFromEsc;
    window.beginWebmExportLock = beginWebmExportLock;
    window.endWebmExportLock = endWebmExportLock;
    window.beginWaveformRestoreLock = beginWaveformRestoreLock;
    window.endWaveformRestoreLock = endWaveformRestoreLock;
    window.setWebmExportEmergencyCleanup = setWebmExportEmergencyCleanup;
})();
