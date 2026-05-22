    function getLoopPlaybackEnabled() {
        return !!(loopPlaybackCheckbox && loopPlaybackCheckbox.checked);
    }

    function applySavedLoopPlayback(enabled) {
        if (!loopPlaybackCheckbox) return;
        loopPlaybackCheckbox.checked = enabled !== false;
    }

    function logAndPersistLoopPlayback() {
        const on = getLoopPlaybackEnabled();
        schedulePersistSession();
        writeLog('Loop playback: ' + (on ? 'ON' : 'OFF'));
        flashSeekHint('Loop', on ? 'ON' : 'OFF', 'notice');
        flashTransportOptBox('playback');
    }
