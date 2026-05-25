    let videoFrameDelayFrames = 0;
    const VIDEO_FRAME_DELAY_MAX = 99;

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

    function normalizeVideoFrameDelayFrames(n) {
        const v = Math.round(Number(n));
        if (!Number.isFinite(v) || v < 0) return 0;
        return Math.min(VIDEO_FRAME_DELAY_MAX, v);
    }

    function getVideoFrameDelayFrames() {
        if (videoFrameDelayInput) {
            const raw = videoFrameDelayInput.value.trim();
            if (raw !== '') return normalizeVideoFrameDelayFrames(raw);
        }
        return videoFrameDelayFrames;
    }

    function getVideoFrameDelaySec() {
        const frames = getVideoFrameDelayFrames();
        if (!frames || frames <= 0) return 0;
        const frameSec =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 60;
        return frames * frameSec;
    }

    window.getVideoFrameDelayFrames = getVideoFrameDelayFrames;
    window.getVideoFrameDelaySec = getVideoFrameDelaySec;

    function syncVideoFrameDelayInputFromState() {
        if (!videoFrameDelayInput) return;
        videoFrameDelayInput.value = String(videoFrameDelayFrames);
    }

    function applySavedVideoFrameDelay(frames) {
        videoFrameDelayFrames = normalizeVideoFrameDelayFrames(frames);
        syncVideoFrameDelayInputFromState();
    }

    function commitVideoFrameDelayFromInput() {
        const raw = videoFrameDelayInput ? videoFrameDelayInput.value.trim() : '';
        const next = normalizeVideoFrameDelayFrames(raw === '' ? 0 : raw);
        const changed = next !== videoFrameDelayFrames;
        videoFrameDelayFrames = next;
        syncVideoFrameDelayInputFromState();
        return changed;
    }

    function applyVideoFrameDelayToTransportNow() {
        if (typeof applyVideoTimeForTransportSec === 'function') {
            const t =
                typeof transportPlaybackSec === 'number' && Number.isFinite(transportPlaybackSec)
                    ? transportPlaybackSec
                    : 0;
            applyVideoTimeForTransportSec(t, { force: true });
        }
        if (
            getVideoFrameDelaySec() > 0.0005 &&
            typeof getMainVideoAudioBuffer === 'function' &&
            !getMainVideoAudioBuffer() &&
            typeof ensureMainVideoWaveformBuildForLoad === 'function'
        ) {
            ensureMainVideoWaveformBuildForLoad();
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
    }

    function logAndPersistVideoFrameDelay() {
        schedulePersistSession();
        writeLog('Video delay: ' + videoFrameDelayFrames + ' f');
        flashSeekHint('Video Delay', videoFrameDelayFrames + ' f', 'notice');
        flashTransportOptBox('videoDelay');
        applyVideoFrameDelayToTransportNow();
    }

    /**
     * ブラウザ localStorage のユーザー設定のみ適用（Video Delay・モニター床・Loop）。
     * IndexedDB セッション復元や Import Review では上書きしない。
     */
    function applyTransportPrefsFromStorage(prefs) {
        const p = prefs && typeof prefs === 'object' ? prefs : {};
        applySavedLoopPlayback(p.loopPlayback);
        if (typeof p.frameDelayFrames === 'number') {
            applySavedVideoFrameDelay(p.frameDelayFrames);
        }
        if (
            p.monitorPrefs &&
            typeof applyMonitorUiPersistSnapshot === 'function'
        ) {
            applyMonitorUiPersistSnapshot(p.monitorPrefs);
        }
    }

    /** Video Delay とスペクトラム／メーター床のみ（Import・セッション行の影響を受けない） */
    function applyUserMonitorDisplayPrefsFromStorage(prefs) {
        const p = prefs && typeof prefs === 'object' ? prefs : {};
        if (typeof p.frameDelayFrames === 'number') {
            applySavedVideoFrameDelay(p.frameDelayFrames);
        }
        const mp = p.monitorPrefs;
        if (mp && typeof applyMonitorUiPersistSnapshot === 'function') {
            applyMonitorUiPersistSnapshot({
                spectrumFloor: mp.spectrumFloor,
                meterFloor: mp.meterFloor,
            });
        }
    }

    window.applyUserMonitorDisplayPrefsFromStorage = applyUserMonitorDisplayPrefsFromStorage;

    window.applyTransportPrefsFromStorage = applyTransportPrefsFromStorage;
