/**
 * transport-prefs.js — トランスポート関連 prefs（ループ再生・モニター床等）の適用。
 */
    function getLoopPlaybackEnabled() {
        return !!(loopPlaybackCheckbox && loopPlaybackCheckbox.checked);
    }

    function applySavedLoopPlayback(enabled) {
        if (!loopPlaybackCheckbox) return;
        loopPlaybackCheckbox.checked = enabled !== false;
    }

    function logAndPersistLoopPlayback() {
        const on = getLoopPlaybackEnabled();
        writePrefs();
        writeLog('Loop playback: ' + (on ? 'ON' : 'OFF'));
        flashSeekHint('Loop', on ? 'ON' : 'OFF', 'notice');
        flashTransportOptBox('playback');
    }

    /**
     * ブラウザ localStorage のユーザー設定のみ適用（モニター床・Loop）。
     * IndexedDB セッション復元や Import Review では上書きしない。
     */
    function applyTransportPrefsFromStorage(prefs) {
        const p = prefs && typeof prefs === 'object' ? prefs : {};
        applySavedLoopPlayback(p.loopPlayback);
        if (
            p.monitorPrefs &&
            typeof applyMonitorUiPersistSnapshot === 'function'
        ) {
            applyMonitorUiPersistSnapshot(p.monitorPrefs);
        }
    }

    /** スペクトラム／メーター床のみ（Import・セッション行の影響を受けない） */
    function applyUserMonitorDisplayPrefsFromStorage(prefs) {
        const p = prefs && typeof prefs === 'object' ? prefs : {};
        const mp = p.monitorPrefs;
        if (mp && typeof applyMonitorUiPersistSnapshot === 'function') {
            applyMonitorUiPersistSnapshot({
                spectrumFloor: mp.spectrumFloor,
                meterFloor: mp.meterFloor,
            });
        }
    }

    window.applyUserMonitorDisplayPrefsFromStorage = applyUserMonitorDisplayPrefsFromStorage;
