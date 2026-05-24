    (function initPrefsFromStorage() {
        try {
            const p = readPrefs();
            applySavedLoopPlayback(p.loopPlayback);
            applySavedVideoFrameDelay(p.frameDelayFrames);
        } catch (_) {}
    })();

    writeLog('MGA CineAudio Reviewer started (' + APP_VERSION_LABEL + ').');
