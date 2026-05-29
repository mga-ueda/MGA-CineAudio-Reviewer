/**
 * boot-prefs.js — 起動時の prefs 初期化（initPrefsFromStorage、transport-prefs へ委譲）。
 */
    function initPrefsFromStorage() {
        try {
            if (typeof applyTransportPrefsFromStorage === 'function') {
                applyTransportPrefsFromStorage(readPrefs());
            } else {
                const p = readPrefs();
                applySavedLoopPlayback(p.loopPlayback);
                if (typeof applySavedPlayheadCenterLock === 'function') {
                    applySavedPlayheadCenterLock(!!p.playheadCenterLock);
                }
            }
        } catch (_) {}
    }

    window.initPrefsFromStorage = initPrefsFromStorage;

    (function logAppStartupLines() {
        const readyLine = '> System Ready. (' + APP_VERSION_LABEL + ')';
        if (typeof seedLogLines === 'function') {
            seedLogLines(readyLine);
        } else if (logEl) {
            logEl.innerText = readyLine;
        }
        writeLog('MGA CineAudio Reviewer started (' + APP_VERSION_LABEL + ').');
    })();
