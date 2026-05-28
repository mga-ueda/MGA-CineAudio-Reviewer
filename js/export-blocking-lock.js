(function exportBlockingLockModule() {
    /** Now Loading（波形復元ロック UI・起動時ぼかし）の有効／無効 */
    const NOW_LOADING_ENABLED = true;

    const WAVEFORM_RESTORE_FADE_MS = 200;
    const WAVEFORM_RESTORE_BOOT_HINT_KEY = 'mgaWaveformRestoreBootHint';
    const NOW_LOADING_LOG_MAX_LINES = 80;

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

    function minimalLogEl() {
        return document.getElementById('exportBlockingMinimalLog');
    }

    function isNowLoadingLogMirrorActive() {
        if (!NOW_LOADING_ENABLED) return false;
        if (blockingMode === 'waveform-restore') return true;
        try {
            return document.documentElement.classList.contains(
                'waveform-restore-boot-pending',
            );
        } catch (_) {
            return false;
        }
    }

    function isMaskedNowLoadingLogLine(message) {
        const text = message != null ? String(message) : '';
        return text.toLowerCase().includes('debug');
    }

    function formatNowLoadingLogLine(message) {
        const now = new Date();
        const time =
            '[' +
            String(now.getHours()).padStart(2, '0') +
            ':' +
            String(now.getMinutes()).padStart(2, '0') +
            ':' +
            String(now.getSeconds()).padStart(2, '0') +
            ']';
        return time + ' - ' + String(message);
    }

    function clearNowLoadingLog() {
        const el = minimalLogEl();
        if (!el) return;
        el.textContent = '';
        el.hidden = true;
    }

    function appendNowLoadingLogLine(message) {
        if (!isNowLoadingLogMirrorActive()) return;
        if (isMaskedNowLoadingLogLine(message)) return;
        const el = minimalLogEl();
        if (!el) return;
        const line = formatNowLoadingLogLine(message);
        const cur = el.textContent || '';
        const lines = cur ? cur.split('\n') : [];
        lines.push(line);
        if (lines.length > NOW_LOADING_LOG_MAX_LINES) {
            lines.splice(0, lines.length - NOW_LOADING_LOG_MAX_LINES);
        }
        el.textContent = lines.join('\n');
        el.hidden = false;
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
        // waveform-restore（Now Loading）中は All Clear を残す（ショートカット／ボタンで脱出可能に）
        if (allClearBtn && xl && blockingMode !== 'waveform-restore') {
            allClearBtn.disabled = true;
        }
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

    function sessionRowNeedsWaveformRestoreBootHint(row) {
        if (!row || typeof row !== 'object') return false;
        const hasVideo = row.mBlob && (row.mBlob.size || 0) > 0;
        const hasExtra =
            Array.isArray(row.extraTracks) &&
            row.extraTracks.some(
                (e) => e && e.blob && (e.byteLength || e.blob.size || 0) > 0,
            );
        return hasVideo || hasExtra;
    }

    function readWaveformRestoreBootHint() {
        if (!NOW_LOADING_ENABLED) return false;
        try {
            return (
                localStorage.getItem(WAVEFORM_RESTORE_BOOT_HINT_KEY) === '1' ||
                sessionStorage.getItem(WAVEFORM_RESTORE_BOOT_HINT_KEY) === '1'
            );
        } catch (_) {
            return false;
        }
    }

    function syncWaveformRestoreBootHint(row) {
        if (!NOW_LOADING_ENABLED) {
            clearWaveformRestoreBootHint();
            return;
        }
        try {
            if (sessionRowNeedsWaveformRestoreBootHint(row)) {
                localStorage.setItem(WAVEFORM_RESTORE_BOOT_HINT_KEY, '1');
            } else {
                localStorage.removeItem(WAVEFORM_RESTORE_BOOT_HINT_KEY);
            }
            sessionStorage.removeItem(WAVEFORM_RESTORE_BOOT_HINT_KEY);
        } catch (_) {}
    }

    function clearWaveformRestoreBootHint() {
        try {
            localStorage.removeItem(WAVEFORM_RESTORE_BOOT_HINT_KEY);
            sessionStorage.removeItem(WAVEFORM_RESTORE_BOOT_HINT_KEY);
        } catch (_) {}
    }

    function armWaveformRestoreBootPending() {
        if (!NOW_LOADING_ENABLED) return;
        try {
            document.documentElement.classList.add('waveform-restore-boot-pending');
        } catch (_) {}
    }

    function disarmWaveformRestoreBootPending() {
        try {
            document.documentElement.classList.remove('waveform-restore-boot-pending');
        } catch (_) {}
    }

    /** 復元不要と判明したら head の即時ぼかしを外す */
    function dismissWaveformRestoreBootShellIfIdle() {
        if (blockingMode !== null) return;
        disarmWaveformRestoreBootPending();
    }

    /** 前回保存のヒントだけで、スクリプト読込直後に Now Loading を出す */
    function maybeBeginWaveformRestoreOverlayFromBootHint() {
        if (!NOW_LOADING_ENABLED) return false;
        if (!readWaveformRestoreBootHint()) return false;
        armWaveformRestoreBootPending();
        if (blockingMode !== null) return true;
        beginWaveformRestoreLock({ reason: 'reload' });
        return true;
    }

    function beginWaveformRestoreLock(opt) {
        if (!NOW_LOADING_ENABLED) return;
        if (blockingMode === 'webm-export') return;
        blockingMode = 'waveform-restore';
        disarmWaveformRestoreBootPending();
        setOperationBlockingVisible(true, { minimal: true });
        try {
            const ae = document.activeElement;
            if (ae && ae !== document.body && typeof ae.blur === 'function') {
                ae.blur();
            }
        } catch (_) {}
    }

    function cleanupWaveformRestoreOverlayDom() {
        clearWaveformRestoreBootHint();
        clearNowLoadingLog();
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

    /** 復元ロック／起動時ぼかしを確実に外す（エラー時・タイムアウト時のフェイルセーフ） */
    async function ensureWaveformRestoreLockDismissed() {
        disarmWaveformRestoreBootPending();
        if (blockingMode === 'waveform-restore') {
            return endWaveformRestoreLock();
        }
        const root = overlayEl();
        if (
            root &&
            !root.hidden &&
            root.classList.contains('export-blocking-overlay--minimal')
        ) {
            blockingMode = null;
            document.body.classList.remove('export-blocking-active');
            cleanupWaveformRestoreOverlayDom();
            refreshOperationBlockingControlLocks();
            if (typeof updateControlsEnabled === 'function') {
                updateControlsEnabled();
            }
        }
        return Promise.resolve();
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

    function isNowLoadingEnabled() {
        return NOW_LOADING_ENABLED;
    }

    if (!NOW_LOADING_ENABLED) {
        clearWaveformRestoreBootHint();
        disarmWaveformRestoreBootPending();
    }

    window.NOW_LOADING_ENABLED = NOW_LOADING_ENABLED;
    window.isNowLoadingEnabled = isNowLoadingEnabled;
    window.isNowLoadingLogMirrorActive = isNowLoadingLogMirrorActive;
    window.appendNowLoadingLogLine = appendNowLoadingLogLine;
    window.clearNowLoadingLog = clearNowLoadingLog;
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
    window.ensureWaveformRestoreLockDismissed = ensureWaveformRestoreLockDismissed;
    window.setWebmExportEmergencyCleanup = setWebmExportEmergencyCleanup;
    window.syncWaveformRestoreBootHint = syncWaveformRestoreBootHint;
    window.clearWaveformRestoreBootHint = clearWaveformRestoreBootHint;
    window.maybeBeginWaveformRestoreOverlayFromBootHint =
        maybeBeginWaveformRestoreOverlayFromBootHint;
    window.armWaveformRestoreBootPending = armWaveformRestoreBootPending;
    window.disarmWaveformRestoreBootPending = disarmWaveformRestoreBootPending;
    window.dismissWaveformRestoreBootShellIfIdle = dismissWaveformRestoreBootShellIfIdle;
})();
