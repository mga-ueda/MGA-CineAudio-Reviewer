/**
 * boot-prefs.js — 起動時の prefs 初期化（initPrefsFromStorage、transport-prefs へ委譲）。
 */
    function initPrefsFromStorage() {
        try {
            const p = readPrefs();
            if (typeof applyTransportPrefsFromStorage === 'function') {
                applyTransportPrefsFromStorage(p);
            } else {
                applySavedLoopPlayback(p.loopPlayback);
            }
            if (typeof applyUserWaveformLaneHeightFromStorage === 'function') {
                applyUserWaveformLaneHeightFromStorage(p);
            }
            if (typeof initLayoutDockFromPrefs === 'function') {
                initLayoutDockFromPrefs(p);
            }
        } catch (_) {}
    }

    window.initPrefsFromStorage = initPrefsFromStorage;

    (function logAppStartupLines() {
        if (typeof seedLogLines === 'function') {
            seedLogLines([]);
        } else if (logEl) {
            logEl.replaceChildren();
        }
        if (typeof writeMetaLog === 'function') {
            writeMetaLog('System', 'ready (' + APP_VERSION_LABEL + ')');
        } else {
            writeLog('MGA CineAudio Reviewer started (' + APP_VERSION_LABEL + ').');
        }
    })();
