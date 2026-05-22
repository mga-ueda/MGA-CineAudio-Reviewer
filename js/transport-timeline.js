    /*
     * トランスポート（transportPlaybackSec / シークバー）= 音声の再生位置（マスタークロック）。
     * 映像はトランスポート位置と同期。焼き込み TC は video.currentTime のみ。
     *
     * マスター長 > 動画の実効終端（getVideoPlaybackEndSec）のときの「動画終端以降」仕様:
     * - 再生: 追加トラックはマスター終端まで。トランスポート時計・波形プレイヘッドは追従する。
     * - 焼き込み TC（映像オーバーレイ）: video.currentTime 基準のため動画尺を超えて増えない（意図した仕様）。
     * - トランスポート欄の現在時刻（#currentTime）: マスター長に合わせて進む（動画終端以降も表示可能）。
     * - シーク: マスター全長へ移動できるが、映像は終端付近にパークしたまま（音声のみ続く区間）。
     * - 波形: 動画尺以降をグレーの横グラデで「範囲外」と示す（3レーン共通）。
     */
    let transportPlaybackSec = 0;
    let transportPlaybackLastTs = 0;
    let transportSessionPlaying = false;
    let transportTailPlaybackActive = false;
    let videoParkedForTransportTail = false;
    /** 通常再生中に currentTime を直す閾値（これ未満は映像の自然再生に任せる）。 */
    const VIDEO_STEADY_FOLLOW_DRIFT_SEC = 0.15;
    /** Playback Drift の測定・表示・補正判定（通常再生中）の最短間隔。 */
    const VIDEO_DRIFT_MONITOR_INTERVAL_MS = 1000;
    let videoDriftCorrectFlashUntil = 0;
    let lastVideoDriftSampleAt = 0;
    /** 表示用に保持する直近のドリフト（約1秒ごとに更新） */
    let lastPlaybackDriftUiSigned = null;

    function resetVideoDriftMonitorSchedule() {
        lastVideoDriftSampleAt = 0;
        lastPlaybackDriftUiSigned = null;
    }

    function shouldSampleVideoDriftNow(opt) {
        if (opt && (opt.force || opt.corrected)) return true;
        const now = performance.now();
        return (
            lastVideoDriftSampleAt <= 0 ||
            now - lastVideoDriftSampleAt >= VIDEO_DRIFT_MONITOR_INTERVAL_MS
        );
    }

    /** @returns {number|null} 符号付きズレ（秒）。間隔外なら null。 */
    function sampleVideoDriftForPlayback(audioSec, opt) {
        if (!shouldSampleVideoDriftNow(opt)) return null;
        lastVideoDriftSampleAt = performance.now();
        return measureVideoPlaybackDriftSec(audioSec);
    }

    function refreshVideoDriftMonitorFromSample(audioSec, signedDrift, uiOpt) {
        updateVideoDriftMonitorUi(
            Object.assign({ audioSec: audioSec, driftSec: signedDrift }, uiOpt || {}),
        );
    }

    function videoDriftThresholdMs() {
        return Math.round(VIDEO_STEADY_FOLLOW_DRIFT_SEC * 1000);
    }

    /** 映像 currentTime と音声マスターから求めた目標映像位置の差（秒, 符号付き）。 */
    function measureVideoPlaybackDriftSec(audioSec) {
        if (!videoMain || typeof videoReady !== 'function' || !videoReady()) return null;
        const x = clampTransportSec(audioSec);
        const target = videoSecForTransportSec(x);
        const cur = videoMain.currentTime || 0;
        if (!Number.isFinite(target) || !Number.isFinite(cur)) return null;
        return cur - target;
    }

    function reportVideoDriftCorrection(driftSec) {
        videoDriftCorrectFlashUntil = performance.now() + 1400;
        updateVideoDriftMonitorUi({ corrected: true, driftSec: driftSec });
        if (typeof flashVideoPanelDrift === 'function') {
            flashVideoPanelDrift();
        }
    }

    function updateVideoDriftMonitorUi(opt) {
        updateVideoDriftPanelStatUi(opt);
    }

    function refreshVideoDriftPanelStat() {
        updateVideoDriftPanelStatUi({ repaintCached: true });
    }

    function playbackDriftMsFromSec(driftSec) {
        return Math.min(9999, Math.round(Math.abs(driftSec) * 1000));
    }

    /** @returns {'safe'|'warn'|'danger'} */
    function playbackDriftToneFromMs(ms) {
        const threshMs = videoDriftThresholdMs();
        if (ms >= threshMs) return 'danger';
        if (ms >= threshMs * 0.55) return 'warn';
        return 'safe';
    }

    function videoDriftTransportBoxEl(statEl) {
        if (!statEl) return null;
        return statEl.closest('.transport-opt-box--video-drift');
    }

    function playbackDriftMsEl(statEl) {
        if (!statEl) return null;
        return statEl.querySelector('.transport-drift-ms');
    }

    function ensurePlaybackDriftDisplayStructure(statEl) {
        if (!statEl || statEl.querySelector('.transport-drift-ms')) return;
        statEl.innerHTML =
            '<span class="transport-drift-prefix">Playback Drift - </span>' +
            '<span class="transport-drift-ms transport-drift-ms--safe">0000</span>' +
            '<span class="transport-drift-suffix"> ms</span>';
    }

    function clearPlaybackDriftDisplay(statEl) {
        if (!statEl) return;
        statEl.textContent = '';
    }

    function setPlaybackDriftDisplay(statEl, absDriftSec) {
        ensurePlaybackDriftDisplayStructure(statEl);
        const msEl = playbackDriftMsEl(statEl);
        const ms = playbackDriftMsFromSec(absDriftSec);
        if (msEl) msEl.textContent = String(ms).padStart(4, '0');
    }

    function applyPlaybackDriftPanelTone(statEl, tone) {
        if (!statEl) return;
        const box = videoDriftTransportBoxEl(statEl);
        const msEl = playbackDriftMsEl(statEl);
        if (box || msEl) {
            if (box) {
                box.classList.remove(
                    'transport-opt-box--drift-ok',
                    'transport-opt-box--drift-warn',
                    'transport-opt-box--drift-danger',
                );
                if (tone === 'danger') box.classList.add('transport-opt-box--drift-danger');
                else if (tone === 'warn') box.classList.add('transport-opt-box--drift-warn');
                else box.classList.add('transport-opt-box--drift-ok');
            }
            if (msEl) {
                msEl.classList.remove(
                    'transport-drift-ms--safe',
                    'transport-drift-ms--warn',
                    'transport-drift-ms--danger',
                );
                if (tone === 'danger') msEl.classList.add('transport-drift-ms--danger');
                else if (tone === 'warn') msEl.classList.add('transport-drift-ms--warn');
                else msEl.classList.add('transport-drift-ms--safe');
            }
            statEl.classList.remove(
                'panel-info-drift--safe',
                'panel-info-drift--warn',
                'panel-info-drift--danger',
            );
            return;
        }
        statEl.classList.remove(
            'panel-info-drift--safe',
            'panel-info-drift--warn',
            'panel-info-drift--danger',
        );
        if (tone === 'danger') statEl.classList.add('panel-info-drift--danger');
        else if (tone === 'warn') statEl.classList.add('panel-info-drift--warn');
        else statEl.classList.add('panel-info-drift--safe');
    }

    function updateVideoDriftPanelStatUi(opt) {
        const statEl =
            typeof videoDriftPanelStat !== 'undefined' && videoDriftPanelStat
                ? videoDriftPanelStat
                : document.getElementById('videoDriftPanelStat');
        if (!statEl) return;

        const driftBox = videoDriftTransportBoxEl(statEl);
        if (!videoReady()) {
            clearPlaybackDriftDisplay(statEl);
            if (driftBox) driftBox.hidden = true;
            applyPlaybackDriftPanelTone(statEl, 'safe');
            return;
        }

        const audioSec =
            opt && Number.isFinite(opt.audioSec)
                ? opt.audioSec
                : Number.isFinite(transportPlaybackSec)
                  ? transportPlaybackSec
                  : typeof getTransportSec === 'function'
                    ? getTransportSec()
                    : 0;
        let signed = null;
        if (opt && Number.isFinite(opt.driftSec)) {
            signed = opt.driftSec;
            lastPlaybackDriftUiSigned = signed;
        } else if (opt && opt.repaintCached) {
            signed = lastPlaybackDriftUiSigned;
            if (signed == null) {
                signed = measureVideoPlaybackDriftSec(audioSec);
                if (signed != null) lastPlaybackDriftUiSigned = signed;
            }
        } else {
            const playingUi =
                (typeof isTransportPlaying === 'function' && isTransportPlaying()) ||
                (videoMain && !videoMain.paused && !videoMain.ended);
            if (playingUi) {
                const sampled = sampleVideoDriftForPlayback(audioSec, opt);
                if (sampled != null) {
                    signed = sampled;
                    lastPlaybackDriftUiSigned = sampled;
                } else {
                    signed = lastPlaybackDriftUiSigned;
                }
            } else {
                signed = lastPlaybackDriftUiSigned;
                if (signed == null) {
                    signed = measureVideoPlaybackDriftSec(audioSec);
                    if (signed != null) lastPlaybackDriftUiSigned = signed;
                }
            }
        }
        if (signed == null) {
            clearPlaybackDriftDisplay(statEl);
            if (driftBox) driftBox.hidden = true;
            return;
        }

        const ms = playbackDriftMsFromSec(signed);
        const threshMs = videoDriftThresholdMs();
        const corrected =
            !!(opt && opt.corrected) || performance.now() < videoDriftCorrectFlashUntil;
        if (driftBox) driftBox.hidden = false;
        setPlaybackDriftDisplay(statEl, signed);
        applyPlaybackDriftPanelTone(statEl, playbackDriftToneFromMs(ms));
        if (driftBox) {
            driftBox.classList.toggle('transport-opt-box--drift-correct', corrected);
        }
        statEl.title =
            'Playback Drift vs audio master (updates ~1s; corrects video when over ' +
            threshMs +
            ' ms).';
    }

    window.refreshVideoDriftPanelStat = refreshVideoDriftPanelStat;

    function isTransportTailPlaybackActive() {
        return transportTailPlaybackActive;
    }

    function clearTransportTailPlayback() {
        transportTailPlaybackActive = false;
    }

    function markTransportTailPlaybackActive() {
        transportTailPlaybackActive = true;
    }

    function isTransportPlaying() {
        return transportSessionPlaying;
    }

    function setTransportSessionPlaying(playing) {
        transportSessionPlaying = !!playing;
    }

    function masterTransportTailEpsilonSec() {
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        return Math.max(step * 0.5, 0.001);
    }

    /** Picture/stream end (ended currentTime), not always equal to container metadata duration. */
    function getVideoPlaybackEndSec() {
        if (!videoMain) return 0;
        const meta = getVideoTransportDurationSec();
        if (videoMain.ended) {
            const end = videoMain.currentTime || 0;
            if (end > 0) return end;
        }
        const cap =
            typeof getPlaybackCapSec === 'function' ? getPlaybackCapSec(videoMain) : 0;
        if (cap > 0 && meta > 0 && cap < meta - masterTransportTailEpsilonSec()) {
            return cap;
        }
        return meta;
    }

    function hasMasterTransportTailBeyondVideo() {
        const master = getMasterTransportDurationSec();
        const vd = getVideoPlaybackEndSec();
        const eps = masterTransportTailEpsilonSec();
        return master > vd + eps;
    }

    function shouldHoldTransportPastVideoPause() {
        if (!hasMasterTransportTailBeyondVideo()) return false;
        if (isTransportPlaying()) return true;
        if (
            typeof extraAudioSourcesActive === 'function' &&
            extraAudioSourcesActive()
        ) {
            return true;
        }
        return false;
    }

    function shouldKeepPlayingPastVideoEnd() {
        if (!shouldHoldTransportPastVideoPause()) return false;
        const t =
            typeof getTransportSec === 'function'
                ? getTransportSec()
                : transportPlaybackSec;
        const master = getMasterTransportDurationSec();
        const eps = Math.max(masterTransportTailEpsilonSec() * 2, 0.01);
        return t < master - eps;
    }

    function shouldStartMasterTransportTailPlayback(t) {
        if (!hasMasterTransportTailBeyondVideo()) return false;
        const vd = getVideoPlaybackEndSec();
        const master = getMasterTransportDurationSec();
        const eps = masterTransportTailEpsilonSec();
        let x = Number(t);
        if (!Number.isFinite(x) && typeof getTransportSec === 'function') {
            x = getTransportSec();
        }
        if (!Number.isFinite(x)) x = transportPlaybackSec;
        return master > vd + eps && x >= vd - eps * 2;
    }

    function transportPlaybackIsInMasterTail() {
        if (transportTailPlaybackActive) return true;
        if (!hasMasterTransportTailBeyondVideo()) return false;
        const vd = getVideoPlaybackEndSec();
        const eps = masterTransportTailEpsilonSec();
        const barT =
            typeof getTransportSec === 'function' ? getTransportSec() : transportPlaybackSec;
        return (
            videoMain &&
            (videoMain.ended ||
                videoParkedForTransportTail ||
                barT >= vd - eps ||
                transportPlaybackSec >= vd - eps)
        );
    }

    function isTransportUiClockActive() {
        if (transportTailPlaybackActive) return true;
        if (isTransportPlaying()) return true;
        return !!(videoMain && !videoMain.paused);
    }

    /** Enter post-video tail: keep extra audio, advance transport UI to master end. */
    function enterPostVideoTransportTail() {
        if (!hasMasterTransportTailBeyondVideo()) return false;
        transportTailPlaybackActive = true;
        if (typeof pendingRestoreTime !== 'undefined') pendingRestoreTime = null;
        const vd = getVideoPlaybackEndSec();
        let tailT =
            typeof getTransportSec === 'function' ? getTransportSec() : transportPlaybackSec;
        if (typeof handoffReviewMixToTransportTail === 'function') {
            tailT = handoffReviewMixToTransportTail();
        } else if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
            tailT = Math.max(tailT, vd);
        } else {
            tailT = Math.max(tailT, vd);
        }
        transportPlaybackSec = Number.isFinite(tailT) ? tailT : Math.max(tailT, vd);
        transportPlaybackLastTs = performance.now();
        if (typeof parkVideoAtTransportTail === 'function') parkVideoAtTransportTail();
        setTransportSessionPlaying(true);
        if (typeof setPlayingUi === 'function') setPlayingUi(true);
        if (typeof forceTransportRafLoop === 'function') forceTransportRafLoop();
        else if (typeof tick === 'function' && !rafId) rafId = requestAnimationFrame(tick);
        if (typeof updateSeekUiFromVideo === 'function') updateSeekUiFromVideo();
        return true;
    }

    function getExtraTrackDurationSec(slot) {
        if (typeof extraTrackBufferDuration === 'function') {
            return extraTrackBufferDuration(slot);
        }
        return 0;
    }

    function getVideoTransportDurationSec() {
        if (!videoMain) return 0;
        return getDuration(videoMain);
    }

    function getMasterTransportDurationSec() {
        let m = 0;
        const vd = getVideoTransportDurationSec();
        if (vd > 0) m = vd;
        for (let i = 0; i < 2; i++) {
            const ed = getExtraTrackDurationSec(i);
            if (ed > m) m = ed;
        }
        return Math.max(m, 0.01);
    }

    function clampTransportSec(t) {
        const master = getMasterTransportDurationSec();
        const n = Number(t);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(master, n));
    }

    /** トランスポート位置に対応する映像 currentTime。 */
    function videoSecForTransportSec(audioSec) {
        const x = clampTransportSec(audioSec);
        const vd = getVideoPlaybackEndSec();
        if (!vd) return 0;
        if (x >= vd - 0.0005) return Math.max(0, vd - masterFrameSec);
        return Math.max(0, Math.min(x, Math.max(0, vd - masterFrameSec)));
    }

    /** 映像 currentTime からトランスポート位置を推定（フォールバック用）。 */
    function audioSecFromVideoSec(vt) {
        const v = Number(vt);
        if (!Number.isFinite(v)) return 0;
        return Math.max(0, v);
    }

    function clearVideoParkedForTail() {
        videoParkedForTransportTail = false;
    }

    function isVideoParkedForTransportTail() {
        return videoParkedForTransportTail;
    }

    function parkVideoAtTransportTail() {
        if (!videoMain || !videoReady()) return;
        const vd = getVideoPlaybackEndSec();
        if (!vd) return;
        const park = Math.max(0, vd - masterFrameSec);
        const cur = videoMain.currentTime || 0;
        if (videoParkedForTransportTail && Math.abs(cur - park) < 0.03) return;
        if (Math.abs(cur - park) > 0.02 || !videoMain.ended) {
            try {
                videoMain.currentTime = park;
            } catch (_) {}
        }
        videoParkedForTransportTail = true;
    }

    function applyVideoTimeForTransportSec(audioSec, opt) {
        if (!videoReady()) return false;
        const force = !!(opt && opt.force);
        const x = clampTransportSec(audioSec);
        const vd = getVideoPlaybackEndSec();
        if (vd > 0 && x >= vd - 0.0005) {
            parkVideoAtTransportTail();
            return false;
        }
        clearVideoParkedForTail();
        const target = videoSecForTransportSec(x);
        const cur = videoMain.currentTime || 0;
        const drift = Math.abs(cur - target);
        const playing =
            typeof isTransportPlaying === 'function' && isTransportPlaying();
        const steadyNativePlayback =
            !force &&
            playing &&
            !videoMain.seeking &&
            !videoMain.paused &&
            !videoMain.ended;
        if (steadyNativePlayback) {
            const signedDrift = sampleVideoDriftForPlayback(x);
            if (signedDrift != null) {
                const sampleDrift = Math.abs(signedDrift);
                refreshVideoDriftMonitorFromSample(x, signedDrift);
                if (sampleDrift > VIDEO_STEADY_FOLLOW_DRIFT_SEC) {
                    try {
                        videoMain.currentTime = target;
                    } catch (_) {}
                    reportVideoDriftCorrection(signedDrift);
                    return true;
                }
            }
            return false;
        }
        if (playing) {
            const signed = sampleVideoDriftForPlayback(x, { force: !!force });
            if (signed != null) {
                refreshVideoDriftMonitorFromSample(x, signed);
            }
        }
        const needs =
            videoMain.ended || !Number.isFinite(cur) || drift > 0.001;
        if (needs) {
            try {
                videoMain.currentTime = target;
            } catch (_) {}
        }
        if (playing && videoMain.paused && !videoMain.ended && target > 0.001) {
            const p = videoMain.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        }
        return needs;
    }

    function transportSecToTimelineLeftPercent(sec) {
        const master = getMasterTransportDurationSec();
        if (!master) return 0;
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        const ratio = Math.max(0, Math.min(1, n / master));
        return ratio * 100;
    }

    function applyTransportAtSec(t, opt) {
        const x = clampTransportSec(t);
        transportPlaybackSec = x;
        transportPlaybackLastTs = performance.now();
        const scrubbing = !!(opt && opt.scrubbing);
        if (!scrubbing && hasMasterTransportTailBeyondVideo()) {
            const vd = getVideoPlaybackEndSec();
            const eps = masterTransportTailEpsilonSec();
            if (vd > 0 && x >= vd - eps) {
                transportTailPlaybackActive = true;
            } else if (transportTailPlaybackActive || videoParkedForTransportTail) {
                clearTransportTailPlayback();
                clearVideoParkedForTail();
            }
        }
        if (typeof setTransportSec === 'function') setTransportSec(x);
        /* 動画終端以降へシークしても映像はパーク位置のまま（上記仕様コメント参照）。 */
        applyVideoTimeForTransportSec(x, { force: true });
        if (typeof updateTimecodeOverlay === 'function') updateTimecodeOverlay();
        if (!(opt && opt.scrubbing) && typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (typeof updateAllWaveformPlayheads === 'function') updateAllWaveformPlayheads();
        if (typeof updateLaneContentEndMarkers === 'function') updateLaneContentEndMarkers();
        if (opt && opt.logInput && typeof logSeekBarInputThrottled === 'function') {
            logSeekBarInputThrottled(x);
        }
        if (opt && opt.flash && typeof flashSeekScrubThrottled === 'function') {
            flashSeekScrubThrottled(x);
        }
        if (opt && opt.markers && typeof renderAudioWaveformMarkers === 'function') {
            renderAudioWaveformMarkers();
        }
    }

    function notifyMasterTransportDurationChanged() {
        if (typeof syncSeekMax === 'function') syncSeekMax();
        if (typeof applyWaveformTimelineZoomLayout === 'function') {
            applyWaveformTimelineZoomLayout();
        }
        if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
        if (typeof redrawAllExtraTrackWaveforms === 'function') redrawAllExtraTrackWaveforms();
        if (typeof updateAllWaveformPlayheads === 'function') updateAllWaveformPlayheads();
        if (typeof updateLaneContentEndMarkers === 'function') updateLaneContentEndMarkers();
        if (typeof updateRangeLoopOverlay === 'function') updateRangeLoopOverlay();
        if (typeof renderAudioWaveformMarkers === 'function') renderAudioWaveformMarkers();
    }

    function resetTransportPlaybackClock() {
        transportPlaybackSec = 0;
        transportPlaybackLastTs = 0;
        clearTransportTailPlayback();
        clearVideoParkedForTail();
    }

    function advanceTransportTailPlaybackClock(master) {
        const barT =
            typeof getTransportSec === 'function' ? getTransportSec() : transportPlaybackSec;
        const ctx =
            typeof ensureReviewMixCtx === 'function' ? ensureReviewMixCtx() : null;
        if (
            ctx &&
            typeof getTransportSecFromActiveExtraMix === 'function'
        ) {
            const fromMix = getTransportSecFromActiveExtraMix(ctx);
            if (fromMix != null && Number.isFinite(fromMix)) {
                transportPlaybackSec = fromMix;
                transportPlaybackLastTs = performance.now();
                if (typeof snapRangeLoopPlaybackIfNeeded === 'function') {
                    snapRangeLoopPlaybackIfNeeded();
                }
                if (typeof applyReviewMixVideoGain === 'function') {
                    applyReviewMixVideoGain();
                }
                if (transportPlaybackSec >= master - 0.0005) {
                    if (typeof handleMasterTransportEndReached === 'function') {
                        void handleMasterTransportEndReached();
                    }
                }
                return;
            }
        }
        const now = performance.now();
        if (transportPlaybackLastTs > 0) {
            transportPlaybackSec += (now - transportPlaybackLastTs) / 1000;
        } else {
            transportPlaybackSec = Math.max(transportPlaybackSec, barT);
        }
        transportPlaybackLastTs = now;
        if (typeof snapRangeLoopPlaybackIfNeeded === 'function') {
            snapRangeLoopPlaybackIfNeeded();
        }
        if (typeof applyReviewMixVideoGain === 'function') {
            applyReviewMixVideoGain();
        }
        if (transportPlaybackSec >= master - 0.0005) {
            if (typeof handleMasterTransportEndReached === 'function') {
                void handleMasterTransportEndReached();
            }
        }
    }

    /** 音声マスター: 再生中は壁時計（またはミックス／テール）で transportPlaybackSec を進める。 */
    function syncTransportPlaybackClockFromAudio() {
        if (!isTransportUiClockActive()) return;
        const master = getMasterTransportDurationSec();
        const inTail =
            transportPlaybackIsInMasterTail() ||
            (videoMain && videoMain.ended && hasMasterTransportTailBeyondVideo());
        if (inTail) {
            advanceTransportTailPlaybackClock(master);
            return;
        }
        if (
            typeof advanceRangeLoopPlaybackClock === 'function' &&
            advanceRangeLoopPlaybackClock()
        ) {
            return;
        }
        const ctx =
            typeof ensureReviewMixCtx === 'function' ? ensureReviewMixCtx() : null;
        if (
            ctx &&
            typeof getTransportSecFromActiveExtraMix === 'function'
        ) {
            const fromMix = getTransportSecFromActiveExtraMix(ctx);
            if (fromMix != null && Number.isFinite(fromMix)) {
                transportPlaybackSec = fromMix;
                transportPlaybackLastTs = performance.now();
                if (typeof snapRangeLoopPlaybackIfNeeded === 'function') {
                    snapRangeLoopPlaybackIfNeeded();
                }
                if (transportPlaybackSec >= master - 0.0005) {
                    if (typeof handleMasterTransportEndReached === 'function') {
                        void handleMasterTransportEndReached();
                    }
                }
                return;
            }
        }
        const now = performance.now();
        if (transportPlaybackLastTs > 0) {
            transportPlaybackSec += (now - transportPlaybackLastTs) / 1000;
        }
        transportPlaybackLastTs = now;
        if (typeof snapRangeLoopPlaybackIfNeeded === 'function') {
            snapRangeLoopPlaybackIfNeeded();
        }
        if (transportPlaybackSec >= master - 0.0005) {
            if (typeof handleMasterTransportEndReached === 'function') {
                void handleMasterTransportEndReached();
            }
        }
    }

    function syncTransportPlaybackClockFromVideo() {
        syncTransportPlaybackClockFromAudio();
    }

    function getTransportSecForDisplay() {
        if (isTransportUiClockActive()) {
            if (Number.isFinite(transportPlaybackSec)) return transportPlaybackSec;
        }
        if (typeof getTransportSec === 'function') return getTransportSec();
        return 0;
    }

    function transportRatioFromMasterSec(sec) {
        const master = getMasterTransportDurationSec();
        if (!master) return 0;
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(1, n / master));
    }

    function waveformScrubTargetEl() {
        return audioWaveformLanesTracks || audioWaveformTrack;
    }

    /** 動画尺以降マスター上の「範囲外」帯（グレーの横グラデーション）。 */
    function timelineBeyondVideoFillGradient(ctx, x0, x1, hCss) {
        const grad = ctx.createLinearGradient(x0, 0, x1, 0);
        grad.addColorStop(0, 'rgba(62, 66, 74, 0.94)');
        grad.addColorStop(0.42, 'rgba(40, 44, 50, 0.9)');
        grad.addColorStop(1, 'rgba(22, 24, 28, 0.86)');
        void hCss;
        return grad;
    }

    /** 3レーン共通: 動画の実効終端〜マスター終端をグレーで塗る（波形の有無は問わない）。 */
    function drawTimelineBeyondVideoBand(ctx, wCss, hCss) {
        const master = getMasterTransportDurationSec();
        const videoEndSec = getVideoTimelineEndSecForWaveform();
        if (!master || !videoEndSec || !wCss) return;
        const videoEndW = masterTimelineContentWidth(wCss, videoEndSec);
        const eps = masterTransportTailEpsilonSec();
        if (videoEndW <= 0 || videoEndW >= wCss - 0.5) return;
        if (master <= videoEndSec + eps) return;
        ctx.fillStyle = timelineBeyondVideoFillGradient(ctx, videoEndW, wCss, hCss);
        ctx.fillRect(videoEndW, 0, wCss - videoEndW, hCss);
    }

    function getVideoTimelineEndSecForWaveform() {
        if (typeof getVideoPlaybackEndSec === 'function') {
            const end = getVideoPlaybackEndSec();
            if (end > 0) return end;
        }
        return getVideoTransportDurationSec();
    }

    /** @deprecated 赤線は廃止。互換のため空オブジェクトのみ返す。 */
    function timelineContentEndDrawOpt() {
        return {};
    }

    function timelineWaveformFillGradient(ctx, hCss, laneKind, audible) {
        void laneKind;
        const h = Math.max(8, hCss);
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        if (!audible) {
            grad.addColorStop(0, 'rgba(38, 42, 48, 0.88)');
            grad.addColorStop(0.5, 'rgba(68, 74, 84, 0.96)');
            grad.addColorStop(1, 'rgba(38, 42, 48, 0.88)');
            return grad;
        }
        grad.addColorStop(0, 'rgba(200, 220, 255, 0.35)');
        grad.addColorStop(0.5, 'rgba(220, 235, 255, 0.9)');
        grad.addColorStop(1, 'rgba(200, 220, 255, 0.35)');
        return grad;
    }

    const WAVEFORM_TIMELINE_ZOOM_MIN = 1;
    const WAVEFORM_TIMELINE_ZOOM_MAX = 24;
    const WAVEFORM_TIMELINE_ZOOM_WHEEL_FACTOR = 1.14;
    /** Ctrl+ホイール／Shift+Ctrl+ホイール時の倍率（通常の3倍速） */
    const WAVEFORM_TIMELINE_WHEEL_SPEED_FAST = 3;
    let waveformTimelineZoom = 1;

    function clampWaveformTimelineZoom(z) {
        const n = Number(z);
        if (!Number.isFinite(n)) return WAVEFORM_TIMELINE_ZOOM_MIN;
        return Math.max(
            WAVEFORM_TIMELINE_ZOOM_MIN,
            Math.min(WAVEFORM_TIMELINE_ZOOM_MAX, n),
        );
    }

    function getWaveformTimelineZoom() {
        return waveformTimelineZoom;
    }

    function waveformTimelineViewportWidthCss() {
        const el = waveformScrubTargetEl();
        if (el) return Math.max(1, el.clientWidth | 0);
        if (audioWaveformTrack) return Math.max(1, audioWaveformTrack.clientWidth | 0);
        return 1;
    }

    function masterTimelineWidthCss() {
        return Math.max(
            1,
            Math.round(waveformTimelineViewportWidthCss() * waveformTimelineZoom),
        );
    }

    function waveformTimelineMetrics(el) {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const viewportW = el.clientWidth;
        if (!viewportW) return null;
        const contentW = masterTimelineWidthCss();
        const scrollLeft = el.scrollLeft || 0;
        const borderLeft = el.clientLeft || 0;
        return {
            contentLeft: rect.left + borderLeft,
            viewportW,
            contentW,
            scrollLeft,
        };
    }

    function waveformTimelineHoverLeftPercent(clientX) {
        return transportRatioFromClientX(clientX) * 100;
    }

    function transportRatioFromClientX(clientX) {
        const el = waveformScrubTargetEl();
        const m = waveformTimelineMetrics(el);
        if (!m || !m.contentW) return 0;
        const xInContent = clientX - m.contentLeft + m.scrollLeft;
        return Math.max(0, Math.min(1, xInContent / m.contentW));
    }

    function waveformTimelineInnerEl() {
        if (typeof audioWaveformLanesInner !== 'undefined' && audioWaveformLanesInner) {
            return audioWaveformLanesInner;
        }
        const lanes = waveformScrubTargetEl();
        return lanes
            ? lanes.querySelector('.audio-waveform-composite__lanes-inner')
            : null;
    }

    function applyWaveformTimelineZoomLayout() {
        waveformTimelineZoom = clampWaveformTimelineZoom(waveformTimelineZoom);
        const lanes = waveformScrubTargetEl();
        if (!lanes) return;
        const contentW = masterTimelineWidthCss();
        lanes.style.setProperty('--wave-timeline-content-w', contentW + 'px');
        const zoomed = waveformTimelineZoom > WAVEFORM_TIMELINE_ZOOM_MIN + 0.001;
        lanes.classList.toggle('audio-waveform-composite__lanes--zoomed', zoomed);
        const inner = waveformTimelineInnerEl();
        if (inner) {
            if (zoomed) {
                inner.style.width = contentW + 'px';
                inner.style.minWidth = contentW + 'px';
            } else {
                inner.style.width = '';
                inner.style.minWidth = '';
            }
        }
        if (!zoomed) lanes.scrollLeft = 0;
    }

    function refreshWaveformTimelineAfterZoomChange() {
        applyWaveformTimelineZoomLayout();
        if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
        if (typeof redrawAllExtraTrackWaveforms === 'function') redrawAllExtraTrackWaveforms();
        if (typeof updateAllWaveformPlayheads === 'function') updateAllWaveformPlayheads();
        if (typeof renderAudioWaveformMarkers === 'function') renderAudioWaveformMarkers();
        if (typeof updateRangeLoopOverlay === 'function') updateRangeLoopOverlay();
    }

    function setWaveformTimelineZoom(nextZoom, anchorClientX) {
        const lanes = waveformScrubTargetEl();
        const vw = waveformTimelineViewportWidthCss();
        const oldZoom = waveformTimelineZoom;
        const z = clampWaveformTimelineZoom(nextZoom);
        if (Math.abs(z - oldZoom) < 0.001) return;

        const oldContentW = Math.max(1, Math.round(vw * oldZoom));
        const newContentW = Math.max(1, Math.round(vw * z));
        let scrollLeft = lanes ? lanes.scrollLeft || 0 : 0;

        if (lanes && anchorClientX != null && Number.isFinite(anchorClientX)) {
            const rect = lanes.getBoundingClientRect();
            const anchorInContent = anchorClientX - rect.left + scrollLeft;
            const ratio = oldContentW > 0 ? anchorInContent / oldContentW : 0;
            scrollLeft = ratio * newContentW - (anchorClientX - rect.left);
            const maxScroll = Math.max(0, newContentW - vw);
            scrollLeft = Math.max(0, Math.min(maxScroll, scrollLeft));
        } else if (z <= WAVEFORM_TIMELINE_ZOOM_MIN + 0.001) {
            scrollLeft = 0;
        }

        waveformTimelineZoom = z;
        applyWaveformTimelineZoomLayout();
        if (lanes) lanes.scrollLeft = scrollLeft;
        if (typeof drawSeekPlaybackTrail === 'function') drawSeekPlaybackTrail();
        refreshWaveformTimelineAfterZoomChange();
    }

    function onWaveformTimelineWheel(ev) {
        const ready =
            (typeof videoReady === 'function' && videoReady()) ||
            (typeof hasAnyExtraTrackLoaded === 'function' && hasAnyExtraTrackLoaded());
        if (!ready) return;

        const fast = !!(ev.ctrlKey || ev.metaKey);
        const fastMult = fast ? WAVEFORM_TIMELINE_WHEEL_SPEED_FAST : 1;

        if (ev.shiftKey) {
            const lanes = waveformScrubTargetEl();
            if (!lanes) return;
            const delta = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;
            if (!delta) return;
            ev.preventDefault();
            lanes.scrollLeft += delta * fastMult;
            return;
        }

        if (!ev.deltaY) return;
        ev.preventDefault();
        const base = WAVEFORM_TIMELINE_ZOOM_WHEEL_FACTOR;
        const factor =
            ev.deltaY < 0
                ? Math.pow(base, fastMult)
                : 1 / Math.pow(base, fastMult);
        setWaveformTimelineZoom(waveformTimelineZoom * factor, ev.clientX);
    }

    function onWaveformLanesScroll() {
        if (typeof drawSeekPlaybackTrail === 'function') drawSeekPlaybackTrail();
        if (typeof refreshHoverPlayheadFromLastPointer === 'function') {
            refreshHoverPlayheadFromLastPointer();
        }
    }

    window.waveformTimelineHoverLeftPercent = waveformTimelineHoverLeftPercent;

    function initWaveformTimelineZoomUi() {
        const lanes = waveformScrubTargetEl();
        if (!lanes || lanes.dataset.waveformZoomWheel === '1') return;
        lanes.dataset.waveformZoomWheel = '1';
        lanes.addEventListener('wheel', onWaveformTimelineWheel, { passive: false });
        lanes.addEventListener('scroll', onWaveformLanesScroll, { passive: true });
        applyWaveformTimelineZoomLayout();
    }

    window.getWaveformTimelineZoom = getWaveformTimelineZoom;
    window.setWaveformTimelineZoom = setWaveformTimelineZoom;
    window.applyWaveformTimelineZoomLayout = applyWaveformTimelineZoomLayout;

    function transportSecFromClientX(clientX) {
        return transportRatioFromClientX(clientX) * getMasterTransportDurationSec();
    }

    function applyTransportAtRatio(ratio, opt) {
        const master = getMasterTransportDurationSec();
        if (!master) return;
        const r = Math.max(0, Math.min(1, Number(ratio) || 0));
        const t = r * master;
        applyTransportAtSec(t, Object.assign({ markers: true }, opt || {}));
        if (typeof currentTimeEl !== 'undefined' && currentTimeEl) {
            currentTimeEl.textContent = formatTimecodeForTransport(t);
        }
        const lanes = waveformScrubTargetEl();
        if (lanes) lanes.setAttribute('aria-valuenow', String(Math.round(r * 100)));
    }

    const SEEK_TRAIL_MAX_AGE_MS = 5200;
    const SEEK_TRAIL_MIN_PCT_DELTA = 0.05;
    const SEEK_TRAIL_MAX_SAMPLES = 420;
    /** 再生位置がこれ以上飛ぶとループ／シークとみなし軌跡をリセット */
    const SEEK_TRAIL_DISCONTINUITY_PCT = 2.5;
    let seekTrailSamples = [];

    function clearSeekPlaybackTrail() {
        seekTrailSamples = [];
        drawSeekPlaybackTrail();
    }

    function recordSeekPlaybackTrail(pct) {
        const playing =
            typeof isTransportPlaying === 'function' && isTransportPlaying();
        if (!playing) return;
        const now = performance.now();
        const last = seekTrailSamples[seekTrailSamples.length - 1];
        if (last && Math.abs(pct - last.pct) >= SEEK_TRAIL_DISCONTINUITY_PCT) {
            seekTrailSamples = [];
        }
        if (
            last &&
            seekTrailSamples.length &&
            now - last.at < 36 &&
            Math.abs(last.pct - pct) < SEEK_TRAIL_MIN_PCT_DELTA
        ) {
            return;
        }
        seekTrailSamples.push({ pct: pct, at: now });
        const cutoff = now - SEEK_TRAIL_MAX_AGE_MS;
        while (seekTrailSamples.length && seekTrailSamples[0].at < cutoff) {
            seekTrailSamples.shift();
        }
        if (seekTrailSamples.length > SEEK_TRAIL_MAX_SAMPLES) {
            seekTrailSamples.splice(0, seekTrailSamples.length - SEEK_TRAIL_MAX_SAMPLES);
        }
    }

    function ensureSeekTrailCanvasSized() {
        const canvas =
            typeof audioWaveformSeekTrail !== 'undefined' && audioWaveformSeekTrail
                ? audioWaveformSeekTrail
                : document.getElementById('audioWaveformSeekTrail');
        const lanes = waveformScrubTargetEl();
        const inner = waveformTimelineInnerEl();
        if (!canvas || !lanes || !inner) return null;
        const w = masterTimelineWidthCss();
        const h = lanes.clientHeight;
        if (w < 2 || h < 2) return null;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const bw = Math.round(w * dpr);
        const bh = Math.round(h * dpr);
        if (canvas.width !== bw || canvas.height !== bh) {
            canvas.width = bw;
            canvas.height = bh;
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { ctx: ctx, w: w, h: h };
    }

    function drawSeekPlaybackTrail() {
        const sized = ensureSeekTrailCanvasSized();
        const canvas =
            typeof audioWaveformSeekTrail !== 'undefined' && audioWaveformSeekTrail
                ? audioWaveformSeekTrail
                : document.getElementById('audioWaveformSeekTrail');
        if (!sized || !canvas) {
            if (canvas) {
                const ctx = canvas.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
            return;
        }
        const { ctx, w, h } = sized;
        ctx.clearRect(0, 0, w, h);
        if (!seekTrailSamples.length) return;
        const now = performance.now();
        const cutoff = now - SEEK_TRAIL_MAX_AGE_MS;
        while (seekTrailSamples.length && seekTrailSamples[0].at < cutoff) {
            seekTrailSamples.shift();
        }
        if (!seekTrailSamples.length) return;

        let minPct = seekTrailSamples[0].pct;
        let maxPct = seekTrailSamples[0].pct;
        for (let i = 1; i < seekTrailSamples.length; i++) {
            const p = seekTrailSamples[i].pct;
            if (p < minPct) minPct = p;
            if (p > maxPct) maxPct = p;
        }

        const leftX = (minPct / 100) * w;
        const rightX = (maxPct / 100) * w;
        const rectW = Math.max(1, rightX - leftX);
        if (rectW <= 0) return;

        /* 右端はくっきりシアン、左へ向かって同系色で薄く透明へ */
        const grad = ctx.createLinearGradient(leftX, 0, rightX, 0);
        grad.addColorStop(0, 'rgba(0, 255, 255, 0)');
        grad.addColorStop(0.2, 'rgba(0, 240, 255, 0.07)');
        grad.addColorStop(0.45, 'rgba(0, 230, 255, 0.13)');
        grad.addColorStop(0.72, 'rgba(0, 255, 255, 0.2)');
        grad.addColorStop(1, 'rgba(0, 255, 255, 0.26)');
        ctx.fillStyle = grad;
        ctx.fillRect(leftX, 0, rectW, h);
    }

    window.clearSeekPlaybackTrail = clearSeekPlaybackTrail;
    window.drawSeekPlaybackTrail = drawSeekPlaybackTrail;

    function updateAllWaveformPlayheads() {
        const t =
            typeof getTransportSecForDisplay === 'function'
                ? getTransportSecForDisplay()
                : typeof getTransportSec === 'function'
                  ? getTransportSec()
                  : 0;
        const pct = transportSecToTimelineLeftPercent(t);
        const playheadWrap =
            typeof audioWaveformPlayheadWrap !== 'undefined' && audioWaveformPlayheadWrap
                ? audioWaveformPlayheadWrap
                : document.getElementById('audioWaveformPlayheadWrap');
        if (playheadWrap) {
            const show =
                (typeof videoReady === 'function' && videoReady()) ||
                (typeof hasAnyExtraTrackLoaded === 'function' && hasAnyExtraTrackLoaded());
            playheadWrap.style.left = pct + '%';
            playheadWrap.hidden = !show;
        }
        recordSeekPlaybackTrail(pct);
        drawSeekPlaybackTrail();
        const lanes = waveformScrubTargetEl();
        if (lanes) lanes.setAttribute('aria-valuenow', String(Math.round(pct)));
    }

    function hasAnyExtraTrackLoaded() {
        if (typeof isExtraTrackLoaded !== 'function') return false;
        return isExtraTrackLoaded(0) || isExtraTrackLoaded(1);
    }

    function masterTimelineContentWidth(wCss, contentDurSec) {
        const master = getMasterTransportDurationSec();
        if (!wCss || !master || !contentDurSec) return 0;
        return wCss * (contentDurSec / master);
    }

    function drawPeaksForMasterTimeline(ctx, peaks, wCss, hCss, contentDurSec, fillStyle, drawOpt) {
        const mid = hCss * 0.5;
        ctx.clearRect(0, 0, wCss, hCss);
        ctx.fillStyle = 'rgba(8, 6, 10, 0.92)';
        ctx.fillRect(0, 0, wCss, hCss);

        if (!peaks || peaks.length === 0) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, mid);
            ctx.lineTo(wCss, mid);
            ctx.stroke();
            drawTimelineBeyondVideoBand(ctx, wCss, hCss);
            return;
        }

        const contentW = masterTimelineContentWidth(wCss, contentDurSec);
        const drawW = contentW > 0 ? contentW : wCss;
        const barW = drawW / peaks.length;
        ctx.fillStyle = fillStyle || '#ffffff';

        for (let i = 0; i < peaks.length; i++) {
            const p = peaks[i];
            const x = i * barW;
            const top = mid - Math.max(0.5, p.max * (mid - 2));
            const bot = mid - Math.min(-0.5, p.min * (mid - 2));
            const h = Math.max(1, bot - top);
            ctx.fillRect(x, top, Math.max(1, barW + 0.5), h);
        }

        drawTimelineBeyondVideoBand(ctx, wCss, hCss);

        void drawOpt;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, mid);
        ctx.lineTo(wCss, mid);
        ctx.stroke();
    }

    function setLaneContentEndMarker(el, _contentDurSec) {
        if (!el) return;
        el.hidden = true;
    }

    function updateLaneContentEndMarkers() {
        setLaneContentEndMarker(document.getElementById('audioWaveformContentEnd'), 0);
        for (let i = 0; i < 2; i++) {
            setLaneContentEndMarker(document.getElementById('extraAudioContentEnd' + i), 0);
        }
    }

    function updateAudioWaveformPlayhead() {
        updateAllWaveformPlayheads();
    }

    initWaveformTimelineZoomUi();
