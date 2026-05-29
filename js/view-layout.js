    let videoMarkersPanelsHidden = false;

    function applyVideoMarkersPanelsHidden(hidden) {
        videoMarkersPanelsHidden = !!hidden;
        if (playerStage) {
            playerStage.classList.toggle(
                'player-stage--video-markers-panels-hidden',
                videoMarkersPanelsHidden,
            );
        }
        if (panelMain) {
            panelMain.setAttribute('aria-hidden', videoMarkersPanelsHidden ? 'true' : 'false');
        }
        if (markerPanel) {
            markerPanel.setAttribute('aria-hidden', videoMarkersPanelsHidden ? 'true' : 'false');
        }
        if (typeof scheduleMarkersUiRefreshAfterLayout === 'function') {
            scheduleMarkersUiRefreshAfterLayout();
        }
        return videoMarkersPanelsHidden;
    }

    function toggleVideoMarkersPanelsHidden() {
        const hidden = applyVideoMarkersPanelsHidden(!videoMarkersPanelsHidden);
        writeLog(
            hidden
                ? 'Video and Markers panels: hidden (F)'
                : 'Video and Markers panels: shown (F)',
        );
        flashSeekHint('Video + Markers', hidden ? 'Hidden' : 'Shown', 'notice');
        return hidden;
    }

    function handleVideoMarkersPanelsToggleKeydown(e) {
        if (!matchUserShortcut(e, 'videoMarkersPanelsToggle')) return false;
        e.preventDefault();
        toggleVideoMarkersPanelsHidden();
        return true;
    }

    window.handleVideoMarkersPanelsToggleKeydown = handleVideoMarkersPanelsToggleKeydown;

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

    /**
     * ブラウザ localStorage のユーザー設定のみ適用（モニター床・Loop）。
     * IndexedDB セッション復元や Import Review では上書きしない。
     */
    function applyTransportPrefsFromStorage(prefs) {
        const p = prefs && typeof prefs === 'object' ? prefs : {};
        applySavedLoopPlayback(p.loopPlayback);
        if (typeof applySavedPlayheadCenterLock === 'function') {
            applySavedPlayheadCenterLock(!!p.playheadCenterLock);
        }
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
