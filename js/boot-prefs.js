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
            if (typeof applyDebugLogFromPrefs === 'function') {
                applyDebugLogFromPrefs(p);
            }
            if (typeof applyUserWaveformLaneHeightFromStorage === 'function') {
                applyUserWaveformLaneHeightFromStorage(p);
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
