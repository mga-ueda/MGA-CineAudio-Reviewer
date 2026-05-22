    (function initPrefsFromStorage() {
        try {
            const p = readPrefs();
            applySavedLoopPlayback(p.loopPlayback);
        } catch (_) {}
    })();

    writeLog('MGA CineAudio Reviewer started (' + APP_VERSION_LABEL + ').');
