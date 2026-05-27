    /*
     * トランスポート（transportPlaybackSec / シークバー）= 音声の再生位置（マスタークロック）。
     * 映像はトランスポート位置と同期。焼き込み TC は video.currentTime のみ。
     *
     * マスター長 > 動画の実効終端（getVideoPlaybackEndSec）のときの「動画終端以降」仕様:
     * - 再生: 追加トラックはマスター終端まで。トランスポート時計・波形プレイヘッドは追従する。
     * - 焼き込み TC（映像オーバーレイ）: video.currentTime 基準のため動画尺を超えて増えない（意図した仕様）。
     * - トランスポート欄の現在時刻（#currentTime）: マスター長に合わせて進む（動画終端以降も表示可能）。
     * - シーク: マスター全長へ移動できるが、映像は終端付近にパークしたまま（音声のみ続く区間）。
     * - 波形: 動画尺以降もマスター上はシーク可能（範囲外のグレー帯表示はなし）。
     */
    let transportPlaybackSec = 0;
    let transportPlaybackLastTs = 0;
    let transportSessionPlaying = false;
    let transportTailPlaybackActive = false;
    let videoParkedForTransportTail = false;
    /** 映像 currentTime の自動補正。false が既定（Playback Drift は表示のみ、補正は行わない）。 */
    const VIDEO_DRIFT_AUTO_CORRECT_ENABLED = false;
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

    function playbackDriftFrameSec() {
        return typeof masterFrameSec === 'number' && masterFrameSec > 0
            ? masterFrameSec
            : 1 / 60;
    }

    function videoDriftThresholdFrames() {
        return Math.max(1, Math.round(VIDEO_STEADY_FOLLOW_DRIFT_SEC / playbackDriftFrameSec()));
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

    function playbackDriftFramesFromSec(driftSec) {
        const frameSec = playbackDriftFrameSec();
        return Math.min(9999, Math.round(Math.abs(driftSec) / frameSec));
    }

    /** @returns {'safe'|'warn'|'danger'} */
    function playbackDriftToneFromFrames(frames) {
        const threshFrames = videoDriftThresholdFrames();
        if (frames >= threshFrames) return 'danger';
        if (frames >= Math.max(1, Math.round(threshFrames * 0.55))) return 'warn';
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
            '<span class="transport-drift-suffix"> f</span>';
    }

    function clearPlaybackDriftDisplay(statEl) {
        if (!statEl) return;
        statEl.textContent = '';
    }

    function setPlaybackDriftDisplay(statEl, absDriftSec) {
        ensurePlaybackDriftDisplayStructure(statEl);
        const msEl = playbackDriftMsEl(statEl);
        const frames = playbackDriftFramesFromSec(absDriftSec);
        if (msEl) msEl.textContent = String(frames).padStart(4, '0');
    }

    function setPlaybackDriftDisplayUnknown(statEl) {
        ensurePlaybackDriftDisplayStructure(statEl);
        const msEl = playbackDriftMsEl(statEl);
        if (msEl) msEl.textContent = '----';
    }

    function showPlaybackDriftPanelUnknown(statEl, title) {
        const driftBox = videoDriftTransportBoxEl(statEl);
        if (driftBox) driftBox.hidden = false;
        setPlaybackDriftDisplayUnknown(statEl);
        applyPlaybackDriftPanelTone(statEl, 'safe');
        if (driftBox) driftBox.classList.remove('transport-opt-box--drift-correct');
        statEl.title = title || 'Playback Drift: not available';
    }

    function showPlaybackDriftPanelZero(statEl) {
        const driftBox = videoDriftTransportBoxEl(statEl);
        if (driftBox) driftBox.hidden = false;
        setPlaybackDriftDisplay(statEl, 0);
        applyPlaybackDriftPanelTone(statEl, 'safe');
        if (driftBox) driftBox.classList.remove('transport-opt-box--drift-correct');
        statEl.title = 'Playback Drift: no session loaded (0 f)';
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
        const transportReady =
            typeof transportControlsReady === 'function' && transportControlsReady();
        if (!transportReady) {
            showPlaybackDriftPanelZero(statEl);
            return;
        }
        if (!videoReady()) {
            showPlaybackDriftPanelUnknown(
                statEl,
                'Playback Drift: not available without video (shows ---- f)',
            );
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
            showPlaybackDriftPanelUnknown(
                statEl,
                'Playback Drift: no measurable drift (shows ---- f)',
            );
            return;
        }

        const frames = playbackDriftFramesFromSec(signed);
        const threshFrames = videoDriftThresholdFrames();
        const corrected =
            !!(opt && opt.corrected) || performance.now() < videoDriftCorrectFlashUntil;
        if (driftBox) driftBox.hidden = false;
        setPlaybackDriftDisplay(statEl, signed);
        applyPlaybackDriftPanelTone(statEl, playbackDriftToneFromFrames(frames));
        if (driftBox) {
            driftBox.classList.toggle('transport-opt-box--drift-correct', corrected);
        }
        statEl.title = VIDEO_DRIFT_AUTO_CORRECT_ENABLED
            ? 'Playback Drift vs audio master (updates ~1s; corrects video when over ' +
              threshFrames +
              ' f).'
            : 'Playback Drift vs audio master (updates ~1s; auto-correction disabled).';
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
        // 再生中でもズーム/スクロール等で波形を追従させるため、
        // 再生開始で hires 再描画をキャンセルしない。
        if (!playing) scheduleWaveformHiresRedrawAfterZoom();
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
        if (typeof videoReady === 'function' && !videoReady()) {
            return (
                typeof anyExtraTrackLoadedForTimeline === 'function' &&
                    anyExtraTrackLoadedForTimeline()
            );
        }
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

    /** マスター尺の終端付近か（pause/ended 後でも終了処理を許可する） */
    function isAtMasterTransportEnd() {
        const master = getMasterTransportDurationSec();
        if (!(master > 0)) return false;
        const eps = masterTransportTailEpsilonSec();
        let t =
            typeof transportPlaybackSec === 'number' && Number.isFinite(transportPlaybackSec)
                ? transportPlaybackSec
                : NaN;
        if (!Number.isFinite(t) && typeof getTransportSec === 'function') {
            t = getTransportSec();
        }
        if (!Number.isFinite(t) && videoMain) {
            t = videoMain.currentTime || 0;
        }
        if (!Number.isFinite(t)) return false;
        if (t >= master - eps) return true;
        if (
            typeof extraAudioSourcesActive === 'function' &&
            !extraAudioSourcesActive() &&
            typeof isPastAllLoadedTrackPlaybackEnds === 'function' &&
            isPastAllLoadedTrackPlaybackEnds(t)
        ) {
            return true;
        }
        return false;
    }

    /** トランスポートが動画終端（終了フレーム）を過ぎたら映像を非表示。 */
    function shouldBlackoutVideoForTransport(transportSec) {
        if (typeof videoReady === 'function' && !videoReady()) return false;
        const vd = getVideoPlaybackEndSec();
        if (!(vd > 0)) return false;
        let t = Number(transportSec);
        if (!Number.isFinite(t)) return false;
        if (typeof clampTransportSec === 'function') t = clampTransportSec(t);
        return t >= vd;
    }

    /** プレビュー／書き出し共通: 映像を黒画面にするか（テール再生・パーク含む）。 */
    function shouldBlackoutVideoPicture(transportSec) {
        if (typeof videoReady === 'function' && !videoReady()) return false;
        if (transportTailPlaybackActive || videoParkedForTransportTail) return true;
        return shouldBlackoutVideoForTransport(transportSec);
    }

    function getTransportPlaybackClockSec() {
        return Number.isFinite(transportPlaybackSec) ? transportPlaybackSec : 0;
    }

    function refreshVideoPastEndBlackoutUi() {
        const frame =
            typeof frameMain !== 'undefined' && frameMain
                ? frameMain
                : document.getElementById('frameMain');
        if (!frame) return;
        let t = getTransportPlaybackClockSec();
        if (typeof getTransportSec === 'function') t = getTransportSec();
        frame.classList.toggle('video-frame--past-end', shouldBlackoutVideoPicture(t));
    }

    window.isAtMasterTransportEnd = isAtMasterTransportEnd;
    window.getVideoPlaybackEndSec = getVideoPlaybackEndSec;
    window.getMasterTransportDurationSec = getMasterTransportDurationSec;
    window.shouldBlackoutVideoForTransport = shouldBlackoutVideoForTransport;
    window.shouldBlackoutVideoPicture = shouldBlackoutVideoPicture;
    window.getTransportPlaybackClockSec = getTransportPlaybackClockSec;
    window.isTransportTailPlaybackActive = isTransportTailPlaybackActive;
    window.isVideoParkedForTransportTail = isVideoParkedForTransportTail;
    window.refreshVideoPastEndBlackoutUi = refreshVideoPastEndBlackoutUi;

    /**
     * 全トラックの BufferSource 終了後（特に映像なし）にマスター終端処理へ進める。
     * @returns {boolean} handleMasterTransportEndReached を起動した
     */
    function maybeFinishMasterTransportPlayback() {
        if (typeof isWebmExportActive === 'function' && isWebmExportActive()) {
            return false;
        }
        if (typeof isTransportPlaying !== 'function' || !isTransportPlaying()) {
            return false;
        }
        if (typeof extraAudioSourcesActive === 'function' && extraAudioSourcesActive()) {
            return false;
        }
        if (typeof videoReady === 'function' && videoReady() && videoMain) {
            if (!videoMain.paused && !videoMain.ended) return false;
        }
        const master = getMasterTransportDurationSec();
        const eps = masterTransportTailEpsilonSec();
        let t =
            typeof transportPlaybackSec === 'number' && Number.isFinite(transportPlaybackSec)
                ? transportPlaybackSec
                : NaN;
        const ctx =
            typeof ensureReviewMixCtx === 'function' ? ensureReviewMixCtx() : null;
        if (
            ctx &&
            typeof getTransportSecFromActiveExtraMix === 'function'
        ) {
            const fromMix = getTransportSecFromActiveExtraMix(ctx);
            if (fromMix != null && Number.isFinite(fromMix)) {
                t = fromMix;
            }
        }
        if (!Number.isFinite(t) && typeof getTransportSec === 'function') {
            t = getTransportSec();
        }
        const atMaster = master > 0 && Number.isFinite(t) && t >= master - eps;
        const pastAll =
            typeof isPastAllLoadedTrackPlaybackEnds === 'function' &&
            isPastAllLoadedTrackPlaybackEnds(t);
        if (!atMaster && !pastAll) return false;
        if (typeof handleMasterTransportEndReached !== 'function') return false;
        void handleMasterTransportEndReached();
        return true;
    }

    window.maybeFinishMasterTransportPlayback = maybeFinishMasterTransportPlayback;

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
        if (typeof refreshVideoPastEndBlackoutUi === 'function') refreshVideoPastEndBlackoutUi();
        setTransportSessionPlaying(true);
        if (typeof setPlayingUi === 'function') setPlayingUi(true);
        if (typeof forceTransportRafLoop === 'function') forceTransportRafLoop();
        else if (typeof tick === 'function' && !rafId) rafId = requestAnimationFrame(tick);
        if (typeof updateSeekUiFromVideo === 'function') updateSeekUiFromVideo();
        return true;
    }

    /** マスタータイムラインの右端（秒）。リージョン編集後は実際の終端を使い、未編集時はバッファ長。 */
    function getExtraTrackDurationSec(slot) {
        const extendSlot =
            typeof getRegionOutDragExtendSlot === 'function'
                ? getRegionOutDragExtendSlot()
                : -1;
        if (extendSlot === slot) {
            if (typeof getRegionOutDragTimelineExtentSec === 'function') {
                const dragEnd = getRegionOutDragTimelineExtentSec(slot);
                if (dragEnd > 0) return dragEnd;
            }
            if (typeof getExtraTrackMaxTimelineEndSec === 'function') {
                const maxEnd = getExtraTrackMaxTimelineEndSec(slot);
                if (maxEnd > 0) return maxEnd;
            }
        }
        if (typeof getTrackTimelineEndSec === 'function') {
            const end = getTrackTimelineEndSec({ type: 'extra', slot });
            if (end > 0) return end;
        }
        const start =
            typeof getExtraTrackTimelineStartSec === 'function'
                ? getExtraTrackTimelineStartSec(slot)
                : 0;
        if (typeof extraTrackBufferDuration === 'function') {
            const buf = extraTrackBufferDuration(slot);
            if (buf > 0) return start + buf;
        }
        if (typeof getExtraTrackMaxTimelineEndSec === 'function') {
            const end = getExtraTrackMaxTimelineEndSec(slot);
            if (end > 0) return end;
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
        const extraCount =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 3;
        for (let i = 0; i < extraCount; i++) {
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
        if (typeof refreshVideoPastEndBlackoutUi === 'function') refreshVideoPastEndBlackoutUi();
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
        if (typeof refreshVideoPastEndBlackoutUi === 'function') refreshVideoPastEndBlackoutUi();
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
                if (
                    VIDEO_DRIFT_AUTO_CORRECT_ENABLED &&
                    sampleDrift > VIDEO_STEADY_FOLLOW_DRIFT_SEC
                ) {
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
            force ||
            videoMain.ended ||
            !Number.isFinite(cur) ||
            (VIDEO_DRIFT_AUTO_CORRECT_ENABLED && drift > 0.001);
        if (needs) {
            try {
                videoMain.currentTime = target;
            } catch (_) {}
        }
        if (playing && videoMain.paused && !videoMain.ended) {
            if (target > 0.001) {
                const p = videoMain.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            }
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
        if (
            opt &&
            (opt.logInput || opt.flash) &&
            typeof pendingRestoreTime !== 'undefined' &&
            pendingRestoreTime != null
        ) {
            pendingRestoreTime = null;
        }
        const scrubbing = !!(opt && opt.scrubbing);
        const wantResume = !(opt && opt.resumeAfter === false);
        let wasActive = false;
        if (
            !scrubbing &&
            wantResume &&
            typeof captureTransportWasActive === 'function' &&
            typeof pauseTransportBeforeSeek === 'function'
        ) {
            wasActive = captureTransportWasActive();
            if (wasActive || (videoMain && !videoMain.paused)) {
                pauseTransportBeforeSeek();
            }
        }
        const x = clampTransportSec(t);
        transportPlaybackSec = x;
        transportPlaybackLastTs = performance.now();
        if (!scrubbing && hasMasterTransportTailBeyondVideo()) {
            const vd = getVideoPlaybackEndSec();
            const eps = masterTransportTailEpsilonSec();
            const playing =
                typeof isTransportPlaying === 'function' && isTransportPlaying();
            if (vd > 0 && x >= vd - eps) {
                /* 停止中のシークではトランスポート時計を回さない（映像パークは applyVideoTimeForTransportSec） */
                if (playing) {
                    transportTailPlaybackActive = true;
                } else {
                    clearTransportTailPlayback();
                }
            } else if (transportTailPlaybackActive || videoParkedForTransportTail) {
                clearTransportTailPlayback();
                clearVideoParkedForTail();
            }
        }
        if (typeof setTransportSec === 'function') setTransportSec(x);
        /* 動画終端以降へシークしても映像はパーク位置のまま（上記仕様コメント参照）。 */
        applyVideoTimeForTransportSec(x, { force: true });
        if (typeof refreshVideoPastEndBlackoutUi === 'function') refreshVideoPastEndBlackoutUi();
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
        if (wasActive && wantResume && typeof resumeTransportAfterExplicitSeek === 'function') {
            void resumeTransportAfterExplicitSeek(x);
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
        if (typeof updateAllPlaybackRegionOverlays === 'function') updateAllPlaybackRegionOverlays();
        if (typeof flushPendingSessionMarkersRestore === 'function') {
            flushPendingSessionMarkersRestore();
        }
        if (typeof syncAudioOnlyMarkersUi === 'function') {
            syncAudioOnlyMarkersUi();
        } else if (typeof refreshMarkerUi === 'function') {
            refreshMarkerUi();
        } else if (typeof renderAudioWaveformMarkers === 'function') {
            renderAudioWaveformMarkers();
        }
        if (typeof updateSessionAllClearButton === 'function') {
            updateSessionAllClearButton();
        }
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
            if (
                fromMix != null &&
                Number.isFinite(fromMix) &&
                applyTransportPlaybackSecFromExtraMix(fromMix, master)
            ) {
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
            return;
        }
        if (typeof maybeFinishMasterTransportPlayback === 'function') {
            maybeFinishMasterTransportPlayback();
        }
    }

    function applyTransportPlaybackSecFromExtraMix(fromMix, master) {
        const drift =
            typeof EXTRA_AUDIO_RESYNC_DRIFT_SEC === 'number'
                ? EXTRA_AUDIO_RESYNC_DRIFT_SEC
                : 0.045;
        if (fromMix + drift < transportPlaybackSec) {
            return false;
        }
        transportPlaybackSec = fromMix;
        transportPlaybackLastTs = performance.now();
        if (typeof snapRangeLoopPlaybackIfNeeded === 'function') {
            snapRangeLoopPlaybackIfNeeded();
        }
        if (typeof applyReviewMixVideoGain === 'function') {
            applyReviewMixVideoGain();
        }
        if (master > 0 && transportPlaybackSec >= master - 0.0005) {
            if (typeof handleMasterTransportEndReached === 'function') {
                void handleMasterTransportEndReached();
            }
            return true;
        }
        if (typeof maybeFinishMasterTransportPlayback === 'function') {
            maybeFinishMasterTransportPlayback();
        }
        return true;
    }

    function syncReviewMixPlaybackIfNeeded() {
        if (typeof applyReviewMixCrossfadeGainsIfNeeded === 'function') {
            applyReviewMixCrossfadeGainsIfNeeded();
        }
        if (
            typeof reviewMixNeedsPlaybackSync === 'function' &&
            reviewMixNeedsPlaybackSync() &&
            typeof syncExtraAudioToTransport === 'function'
        ) {
            syncExtraAudioToTransport();
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
            syncReviewMixPlaybackIfNeeded();
            return;
        }
        if (
            typeof advanceRangeLoopPlaybackClock === 'function' &&
            advanceRangeLoopPlaybackClock()
        ) {
            syncReviewMixPlaybackIfNeeded();
            return;
        }
        const ctx =
            typeof ensureReviewMixCtx === 'function' ? ensureReviewMixCtx() : null;
        if (
            ctx &&
            typeof getTransportSecFromActiveExtraMix === 'function'
        ) {
            const fromMix = getTransportSecFromActiveExtraMix(ctx);
            if (
                fromMix != null &&
                Number.isFinite(fromMix) &&
                applyTransportPlaybackSecFromExtraMix(fromMix, master)
            ) {
                syncReviewMixPlaybackIfNeeded();
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
            return;
        }
        if (typeof maybeFinishMasterTransportPlayback === 'function') {
            maybeFinishMasterTransportPlayback();
        }
        syncReviewMixPlaybackIfNeeded();
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

    function getVideoTimelineEndSecForWaveform() {
        if (typeof getVideoPlaybackEndSec === 'function') {
            const end = getVideoPlaybackEndSec();
            if (end > 0) return end;
        }
        return getVideoTransportDurationSec();
    }

    /** 全波形レーン共通: 動画終端の極細・明るい赤の縦線 */
    function drawTimelineVideoEndMarkerLine(ctx, wCss, hCss) {
        const videoEndSec = getVideoTimelineEndSecForWaveform();
        if (!videoEndSec || videoEndSec <= 0 || !wCss || !hCss) return;
        const x = masterTimelineContentWidth(wCss, videoEndSec);
        if (x < 0.5 || x > wCss - 0.5) return;
        const xi = Math.round(x) + 0.5;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.98)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xi, 0);
        ctx.lineTo(xi, hCss);
        ctx.stroke();
        ctx.restore();
    }

    /** @deprecated 赤線は廃止。互換のため空オブジェクトのみ返す。 */
    function timelineContentEndDrawOpt() {
        return {};
    }

    /** レーン全面の下地（濃いグレー・単色） */
    const TIMELINE_LANE_TRACK_BG = '#161820';

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

    /** 波形全体がビューポートに収まる倍率（\ で復帰） */
    const WAVEFORM_TIMELINE_ZOOM_FIT = 1;
    const WAVEFORM_TIMELINE_ZOOM_MIN = 0.25;
    const WAVEFORM_TIMELINE_ZOOM_MAX = 24;
    /** MARKERS の In/Out TC 編集（+/-）中の波形倍率 */
    const MARKER_TC_EDIT_WAVEFORM_ZOOM = 12;
    const WAVEFORM_TIMELINE_ZOOM_WHEEL_FACTOR = 1.14;
    /** Ctrl+ホイール／Shift+Ctrl+ホイール時の倍率（通常の3倍速） */
    const WAVEFORM_TIMELINE_WHEEL_SPEED_FAST = 3;
    let waveformTimelineZoom = 1;
    let markerTcEditWaveformZoomActive = false;
    /** 再生ヘッド（水色の縦線）をビューポート中央に追従させる（localStorage ユーザー設定）。 */
    let playheadCenterLockActive = false;

    function clampWaveformTimelineZoom(z) {
        const n = Number(z);
        if (!Number.isFinite(n)) return WAVEFORM_TIMELINE_ZOOM_FIT;
        return Math.max(
            WAVEFORM_TIMELINE_ZOOM_MIN,
            Math.min(WAVEFORM_TIMELINE_ZOOM_MAX, n),
        );
    }

    function isWaveformTimelineAtFitZoom() {
        return Math.abs(waveformTimelineZoom - WAVEFORM_TIMELINE_ZOOM_FIT) < 0.001;
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

    /** 描画・シーク座標用のタイムライン幅（zoom×ビューポート。1×未満も 0.25× まで反映） */
    function waveformTimelineScrubWidthCss() {
        return masterTimelineWidthCss();
    }

    function waveformTimelineMetrics(el) {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const viewportW = el.clientWidth;
        if (!viewportW) return null;
        const contentW = masterTimelineWidthCss();
        const scrubW = contentW;
        const scrollable = contentW > viewportW + 0.5;
        const scrollLeft = scrollable ? el.scrollLeft || 0 : 0;
        const borderLeft = el.clientLeft || 0;
        return {
            contentLeft: rect.left + borderLeft,
            viewportW,
            contentW,
            scrubW,
            scrollable,
            scrollLeft,
        };
    }

    function waveformTimelineHoverLeftPercent(clientX) {
        return transportRatioFromClientX(clientX) * 100;
    }

    function transportRatioFromClientX(clientX) {
        const lanes = waveformScrubTargetEl();
        const m = waveformTimelineMetrics(lanes);
        if (!m || !m.scrubW) return 0;
        const inner = waveformTimelineInnerEl();
        const ref = inner || lanes;
        if (!ref) return 0;
        const left = ref.getBoundingClientRect().left;
        const xInScrub = clientX - left;
        return Math.max(0, Math.min(1, xInScrub / m.scrubW));
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
        const viewportW = waveformTimelineViewportWidthCss();
        const contentW = masterTimelineWidthCss();
        lanes.style.setProperty('--wave-timeline-content-w', contentW + 'px');
        const zoomed = !isWaveformTimelineAtFitZoom();
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
        const scrollable = contentW > viewportW + 0.5;
        if (!scrollable || isWaveformTimelineAtFitZoom()) lanes.scrollLeft = 0;
        if (typeof scheduleMusicalGridRedraw === 'function') scheduleMusicalGridRedraw();
    }

    let waveformHiresTimer = 0;
    let waveformHiresScrollTimer = 0;
    let waveformVisualRefreshRaf = 0;
    const WAVEFORM_HIRES_DELAY_MS = 500;
    const WAVEFORM_HIRES_SCROLL_DELAY_MS = 320;
    /** 見た目を保ちつつ負荷を抑える（旧 4px） */
    const WAVEFORM_HIRES_BARS_PER_PX = 3;
    const WAVEFORM_HIRES_BAR_MAX = 12288;

    function cancelWaveformHiresRedraw() {
        if (waveformHiresTimer) {
            clearTimeout(waveformHiresTimer);
            waveformHiresTimer = 0;
        }
        if (waveformHiresScrollTimer) {
            clearTimeout(waveformHiresScrollTimer);
            waveformHiresScrollTimer = 0;
        }
    }

    function clearAllWaveformViewportPeaks() {
        if (typeof clearMainWaveformViewportPeaks === 'function') {
            clearMainWaveformViewportPeaks();
        }
        if (typeof clearAllExtraWaveformViewportPeaks === 'function') {
            clearAllExtraWaveformViewportPeaks();
        }
    }

    let lastWaveformViewportHiresSpec = null;

    /** 停止中の可視範囲（マスター時間）と高解像度バー数 */
    function getWaveformViewportHiresSpec() {
        // 以前は再生中の負荷を避けるため null にしていたが、
        // 再生中でもズーム/スクロール等で波形が追従できるよう spec を返す。
        const lanes = waveformScrubTargetEl();
        if (!lanes) return null;
        const m = waveformTimelineMetrics(lanes);
        if (!m || !(m.scrubW > 0) || !(m.viewportW > 0)) return null;
        const master = getMasterTransportDurationSec();
        if (!(master > 0)) return null;
        const scrollLeft = m.scrollable ? lanes.scrollLeft || 0 : 0;
        const visW = m.viewportW;
        const contentW = m.scrubW;
        const masterStartSec = (scrollLeft / contentW) * master;
        const masterEndSec = ((scrollLeft + visW) / contentW) * master;
        // ズームレベルに応じてバー密度を変化させる（LOD）
        const zoom = getWaveformTimelineZoom();
        let densityScale = 1;
        if (zoom <= 1.02) {
            densityScale = 0.42;
        } else if (zoom <= 2.0) {
            densityScale = 0.68;
        } else {
            densityScale = 0.92;
        }
        const barsPerPx = WAVEFORM_HIRES_BARS_PER_PX * densityScale;
        const barCount = Math.min(
            WAVEFORM_HIRES_BAR_MAX,
            Math.max(1, Math.round(visW * barsPerPx)),
        );
        return { masterStartSec, masterEndSec, barCount, master };
    }

    function waveformViewportSpecNearlyEqual(prev, live) {
        if (!prev || !live) return false;
        const dt0 = Math.abs(prev.masterStartSec - live.masterStartSec);
        const dt1 = Math.abs(prev.masterEndSec - live.masterEndSec);
        const db = Math.abs(prev.barCount - live.barCount);
        const timeThresh = live.master / 200;
        return dt0 < timeThresh && dt1 < timeThresh && db <= 12;
    }

    function extraSlotsForViewportPeaks(opt) {
        if (opt && Array.isArray(opt.slots) && opt.slots.length) {
            return opt.slots.filter((s) => s >= 0);
        }
        if (typeof getVisibleLoadedExtraTrackSlots === 'function') {
            return getVisibleLoadedExtraTrackSlots();
        }
        return [];
    }

    function rebuildWaveformViewportPeaksFromSpec(spec, opt) {
        if (!spec) return false;
        if (typeof rebuildMainWaveformViewportPeaks === 'function') {
            rebuildMainWaveformViewportPeaks(spec);
        }
        const extraSlots = extraSlotsForViewportPeaks(opt);
        for (let j = 0; j < extraSlots.length; j++) {
            const slot = extraSlots[j];
            if (typeof rebuildExtraTrackRegionViewportPeaks === 'function') {
                rebuildExtraTrackRegionViewportPeaks(slot, spec);
            }
        }
        return true;
    }

    /** ズーム・リサイズ直後: ピラミッドから可視範囲ピークを同期的に更新（粗い波形のチラつき防止） */
    function applyWaveformViewportPeaksImmediate(opt) {
        const spec = getWaveformViewportHiresSpec();
        if (!spec) return false;
        if (
            lastWaveformViewportHiresSpec &&
            waveformViewportSpecNearlyEqual(lastWaveformViewportHiresSpec, spec)
        ) {
            return true;
        }
        lastWaveformViewportHiresSpec = spec;
        return rebuildWaveformViewportPeaksFromSpec(spec, opt);
    }

    function applyWaveformViewportHiresRedraw(opt) {
        const spec = getWaveformViewportHiresSpec();
        if (!spec) {
            clearAllWaveformViewportPeaks();
            return;
        }
        const run = () => {
            const live = getWaveformViewportHiresSpec();
            if (!live) {
                clearAllWaveformViewportPeaks();
                if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
                if (typeof redrawAllExtraTrackWaveforms === 'function') {
                    redrawAllExtraTrackWaveforms();
                }
                return;
            }
            if (
                lastWaveformViewportHiresSpec &&
                waveformViewportSpecNearlyEqual(lastWaveformViewportHiresSpec, live)
            ) {
                return;
            }
            lastWaveformViewportHiresSpec = live;
            rebuildWaveformViewportPeaksFromSpec(live, opt);
            if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
            const extraSlots = extraSlotsForViewportPeaks(opt);
            for (let j = 0; j < extraSlots.length; j++) {
                const slot = extraSlots[j];
                if (typeof drawExtraTrackWaveform === 'function') {
                    drawExtraTrackWaveform(slot);
                }
            }
        };
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(run, { timeout: 4000 });
        } else {
            setTimeout(run, 0);
        }
    }

    function scheduleWaveformHiresRedrawAfterZoom(opt) {
        cancelWaveformHiresRedraw();
        waveformHiresTimer = setTimeout(() => {
            waveformHiresTimer = 0;
            applyWaveformViewportHiresRedraw(opt);
        }, WAVEFORM_HIRES_DELAY_MS);
    }

    function cancelWaveformHiresOnPlayback() {
        cancelWaveformHiresRedraw();
        clearAllWaveformViewportPeaks();
    }

    function invalidateWaveformViewportHiresSpec() {
        lastWaveformViewportHiresSpec = null;
    }

    window.cancelWaveformHiresOnPlayback = cancelWaveformHiresOnPlayback;
    window.scheduleWaveformHiresRedrawAfterZoom = scheduleWaveformHiresRedrawAfterZoom;
    window.applyWaveformViewportPeaksImmediate = applyWaveformViewportPeaksImmediate;
    window.scheduleWaveformVisualRefresh = scheduleWaveformVisualRefresh;
    window.flushWaveformVisualRefresh = flushWaveformVisualRefresh;
    window.invalidateWaveformViewportHiresSpec = invalidateWaveformViewportHiresSpec;
    window.isWaveformTimelineAtFitZoom = isWaveformTimelineAtFitZoom;
    window.getWaveformViewportHiresSpec = getWaveformViewportHiresSpec;

    function drawWaveformVisualLayers() {
        if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
        if (typeof redrawAllExtraTrackWaveforms === 'function') redrawAllExtraTrackWaveforms();
    }

    function drawWaveformChromeOverlays() {
        if (typeof updateAllWaveformPlayheads === 'function') updateAllWaveformPlayheads();
        if (typeof drawMusicalGridOverlay === 'function') drawMusicalGridOverlay();
        if (typeof renderAudioWaveformMarkers === 'function') renderAudioWaveformMarkers();
        if (typeof updateRangeLoopOverlay === 'function') updateRangeLoopOverlay();
    }

    function flushWaveformVisualRefresh(opt) {
        if (waveformVisualRefreshRaf) {
            cancelAnimationFrame(waveformVisualRefreshRaf);
            waveformVisualRefreshRaf = 0;
        }
        const refreshed = applyWaveformViewportPeaksImmediate(opt);
        drawWaveformVisualLayers();
        drawWaveformChromeOverlays();
        return refreshed;
    }

    /** 連続ズーム・リサイズ時は 1 フレームにまとめてピーク再計算＋描画 */
    function scheduleWaveformVisualRefresh(opt) {
        if (opt && opt.sync) {
            const refreshed = flushWaveformVisualRefresh(opt);
            if (!refreshed) scheduleWaveformHiresRedrawAfterZoom(opt);
            return;
        }
        if (waveformVisualRefreshRaf) return;
        waveformVisualRefreshRaf = requestAnimationFrame(() => {
            waveformVisualRefreshRaf = 0;
            const refreshed = flushWaveformVisualRefresh(opt);
            if (!refreshed) scheduleWaveformHiresRedrawAfterZoom(opt);
        });
    }

    function refreshWaveformTimelineAfterZoomChange() {
        applyWaveformTimelineZoomLayout();
        if (typeof drawSeekPlaybackTrail === 'function') drawSeekPlaybackTrail();
        drawWaveformChromeOverlays();
        if (typeof scheduleMusicalGridRedraw === 'function') scheduleMusicalGridRedraw();
        scheduleWaveformVisualRefresh();
    }

    function transportSecForWaveformZoomCenter() {
        if (typeof getTransportSecForDisplay === 'function') {
            return getTransportSecForDisplay();
        }
        if (typeof getTransportSec === 'function') return getTransportSec();
        return transportPlaybackSec;
    }

    /** 拡縮後にシークバー（プレイヘッド）がビューポート中央へ来る scrollLeft */
    function scrollLeftToCenterTransportSec(scrubW, viewportW) {
        const ratio = transportRatioFromMasterSec(transportSecForWaveformZoomCenter());
        const maxScroll = Math.max(0, scrubW - viewportW);
        const scrollLeft = ratio * scrubW - viewportW * 0.5;
        return Math.max(0, Math.min(maxScroll, scrollLeft));
    }

    function setWaveformTimelineZoom(nextZoom, centerSeekBar) {
        const lanes = waveformScrubTargetEl();
        const vw = waveformTimelineViewportWidthCss();
        const oldZoom = waveformTimelineZoom;
        const z = clampWaveformTimelineZoom(nextZoom);
        if (Math.abs(z - oldZoom) < 0.001) return;

        const newContentW = Math.max(1, Math.round(vw * z));
        let scrollLeft = lanes ? lanes.scrollLeft || 0 : 0;

        if (lanes && centerSeekBar && z > WAVEFORM_TIMELINE_ZOOM_FIT + 0.001) {
            scrollLeft = scrollLeftToCenterTransportSec(newContentW, vw);
        } else if (z <= WAVEFORM_TIMELINE_ZOOM_FIT + 0.001) {
            scrollLeft = 0;
        }

        waveformTimelineZoom = z;
        applyWaveformTimelineZoomLayout();
        if (lanes) lanes.scrollLeft = scrollLeft;
        if (typeof drawSeekPlaybackTrail === 'function') drawSeekPlaybackTrail();
        refreshWaveformTimelineAfterZoomChange();
        applyPlayheadCenterLockIfActive();
    }

    function isWaveformTimelineInteractionReady() {
        if (typeof transportControlsReady === 'function') {
            return transportControlsReady();
        }
        return (
            (typeof videoReady === 'function' && videoReady()) ||
            (typeof anyExtraTrackLoadedForTimeline === 'function' &&
                anyExtraTrackLoadedForTimeline())
        );
    }

    function wheelEventOverWaveformLanes(ev) {
        const lanes = waveformScrubTargetEl();
        if (!lanes || !ev) return false;
        if (typeof ev.composedPath === 'function') {
            return ev.composedPath().includes(lanes);
        }
        return !!(ev.target && lanes.contains(ev.target));
    }

    function onWaveformTimelineWheel(ev) {
        if (!isWaveformTimelineInteractionReady()) return;

        if (
            ev.altKey &&
            !ev.ctrlKey &&
            !ev.metaKey &&
            !ev.shiftKey &&
            typeof handlePlaybackRegionGainWheel === 'function' &&
            handlePlaybackRegionGainWheel(ev)
        ) {
            return;
        }

        const delta = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;
        const fast = !!(ev.ctrlKey || ev.metaKey);
        const fastMult = fast ? WAVEFORM_TIMELINE_WHEEL_SPEED_FAST : 1;

        if (ev.shiftKey) {
            const lanes = waveformScrubTargetEl();
            if (!lanes) return;
            const m = waveformTimelineMetrics(lanes);
            if (!m || !m.scrollable) return;
            if (!delta) return;
            ev.preventDefault();
            const max = Math.max(0, m.scrubW - m.viewportW);
            lanes.scrollLeft = Math.max(
                0,
                Math.min(max, lanes.scrollLeft + delta * fastMult),
            );
            return;
        }

        if (!delta) return;
        ev.preventDefault();
        const base = WAVEFORM_TIMELINE_ZOOM_WHEEL_FACTOR;
        const factor =
            delta < 0
                ? Math.pow(base, fastMult)
                : 1 / Math.pow(base, fastMult);
        setWaveformTimelineZoom(waveformTimelineZoom * factor, true);
    }

    function onWaveformTimelineWheelCapture(ev) {
        if (!wheelEventOverWaveformLanes(ev)) return;
        onWaveformTimelineWheel(ev);
    }

    function onWaveformLanesScroll() {
        if (typeof drawSeekPlaybackTrail === 'function') drawSeekPlaybackTrail();
        if (typeof refreshHoverPlayheadFromLastPointer === 'function') {
            refreshHoverPlayheadFromLastPointer();
        }
        if (isTransportPlaying() || isWaveformTimelineAtFitZoom()) return;
        if (waveformHiresScrollTimer) clearTimeout(waveformHiresScrollTimer);
        waveformHiresScrollTimer = setTimeout(() => {
            waveformHiresScrollTimer = 0;
            scheduleWaveformVisualRefresh();
        }, WAVEFORM_HIRES_SCROLL_DELAY_MS);
    }

    function isWaveformTimelineKeyboardReady() {
        return isWaveformTimelineInteractionReady();
    }

    function resetWaveformTimelineZoom() {
        markerTcEditWaveformZoomActive = false;
        setWaveformTimelineZoom(WAVEFORM_TIMELINE_ZOOM_FIT, false);
    }

    function centerWaveformTimelineOnTransport() {
        const lanes = waveformScrubTargetEl();
        if (!lanes || waveformTimelineZoom <= WAVEFORM_TIMELINE_ZOOM_FIT + 0.001) return;
        const vw = waveformTimelineViewportWidthCss();
        const scrubW = waveformTimelineScrubWidthCss();
        const next = scrollLeftToCenterTransportSec(scrubW, vw);
        if (Math.abs((lanes.scrollLeft || 0) - next) > 0.5) {
            lanes.scrollLeft = next;
            if (typeof drawSeekPlaybackTrail === 'function') drawSeekPlaybackTrail();
        }
    }

    function isPlayheadCenterLockActive() {
        return playheadCenterLockActive;
    }

    function syncPlayheadCenterLockUi() {
        const cb = document.getElementById('playheadCenterLockCheckbox');
        if (cb) cb.checked = playheadCenterLockActive;
        const lanes = waveformScrubTargetEl();
        if (!lanes) return;
        lanes.classList.toggle(
            'audio-waveform-composite__lanes--playhead-center-lock',
            playheadCenterLockActive,
        );
    }

    function applyPlayheadCenterLockIfActive() {
        if (!playheadCenterLockActive) return;
        centerWaveformTimelineOnTransport();
    }

    function setPlayheadCenterLockActive(enabled, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const next = !!enabled;
        playheadCenterLockActive = next;
        syncPlayheadCenterLockUi();
        if (playheadCenterLockActive) centerWaveformTimelineOnTransport();
        if (!o.silent) {
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Center lock', next ? 'ON' : 'OFF', 'notice');
            }
        }
        if (o.persist !== false && typeof writePrefs === 'function') writePrefs();
        return playheadCenterLockActive;
    }

    function applySavedPlayheadCenterLock(enabled) {
        setPlayheadCenterLockActive(!!enabled, { silent: true, persist: false });
    }

    function togglePlayheadCenterLock() {
        return setPlayheadCenterLockActive(!playheadCenterLockActive);
    }

    function bindPlayheadCenterLockCheckbox() {
        const cb = document.getElementById('playheadCenterLockCheckbox');
        if (!cb || cb.dataset.playheadCenterLockBound === '1') return;
        cb.dataset.playheadCenterLockBound = '1';
        const onChange = () => {
            setPlayheadCenterLockActive(!!cb.checked);
        };
        cb.addEventListener('change', onChange);
    }

    function beginMarkerTcEditWaveformZoom() {
        if (markerTcEditWaveformZoomActive) {
            centerWaveformTimelineOnTransport();
            return;
        }
        markerTcEditWaveformZoomActive = true;
        setWaveformTimelineZoom(MARKER_TC_EDIT_WAVEFORM_ZOOM, true);
    }

    function endMarkerTcEditWaveformZoom() {
        if (!markerTcEditWaveformZoomActive) return;
        markerTcEditWaveformZoomActive = false;
        setWaveformTimelineZoom(WAVEFORM_TIMELINE_ZOOM_FIT, false);
    }

    function stepWaveformTimelineZoom(zoomIn, fast) {
        const mult = fast ? WAVEFORM_TIMELINE_WHEEL_SPEED_FAST : 1;
        const base = WAVEFORM_TIMELINE_ZOOM_WHEEL_FACTOR;
        const factor = zoomIn ? Math.pow(base, mult) : 1 / Math.pow(base, mult);
        setWaveformTimelineZoom(waveformTimelineZoom * factor, true);
    }

    function scrollWaveformTimeline(direction, fast) {
        const lanes = waveformScrubTargetEl();
        if (!lanes || isWaveformTimelineAtFitZoom()) return false;
        const step = Math.max(
            48,
            Math.round(waveformTimelineViewportWidthCss() * 0.12) *
                (fast ? WAVEFORM_TIMELINE_WHEEL_SPEED_FAST : 1),
        );
        const max = Math.max(0, lanes.scrollWidth - lanes.clientWidth);
        lanes.scrollLeft = Math.max(0, Math.min(max, lanes.scrollLeft + step * direction));
        onWaveformLanesScroll();
        return true;
    }

    function handleWaveformTimelineKeydown(e) {
        if (!isWaveformTimelineKeyboardReady()) return false;
        if (
            typeof isMarkerAreaKeyboardActive === 'function' &&
            isMarkerAreaKeyboardActive({ target: e.target })
        ) {
            return false;
        }
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return false;

        const zoomIn = e.code === 'Equal' || e.code === 'NumpadAdd';
        const zoomOut = e.code === 'Minus' || e.code === 'NumpadSubtract';
        if (zoomIn || zoomOut) {
            if (e.altKey) return false;
            e.preventDefault();
            const fast = !!(e.shiftKey || e.ctrlKey || e.metaKey);
            stepWaveformTimelineZoom(!!zoomIn, fast);
            return true;
        }

        if (e.ctrlKey || e.altKey || e.metaKey) return false;

        if (!e.shiftKey && !e.repeat && e.code === 'KeyF') {
            e.preventDefault();
            resetWaveformTimelineZoom();
            return true;
        }

        if (e.code === 'PageUp' || e.code === 'PageDown') {
            e.preventDefault();
            const dir = e.code === 'PageDown' ? 1 : -1;
            scrollWaveformTimeline(dir, e.shiftKey);
            return true;
        }

        return false;
    }

    window.waveformTimelineHoverLeftPercent = waveformTimelineHoverLeftPercent;
    window.handleWaveformTimelineKeydown = handleWaveformTimelineKeydown;
    window.resetWaveformTimelineZoom = resetWaveformTimelineZoom;
    window.beginMarkerTcEditWaveformZoom = beginMarkerTcEditWaveformZoom;
    window.endMarkerTcEditWaveformZoom = endMarkerTcEditWaveformZoom;
    window.centerWaveformTimelineOnTransport = centerWaveformTimelineOnTransport;
    window.isPlayheadCenterLockActive = isPlayheadCenterLockActive;
    window.setPlayheadCenterLockActive = setPlayheadCenterLockActive;
    window.applySavedPlayheadCenterLock = applySavedPlayheadCenterLock;
    window.togglePlayheadCenterLock = togglePlayheadCenterLock;

    function initWaveformTimelineZoomUi() {
        const lanes = waveformScrubTargetEl();
        if (!lanes) return;
        const root = document.documentElement;
        if (root && root.dataset.waveformZoomWheel !== '1') {
            root.dataset.waveformZoomWheel = '1';
            document.addEventListener('wheel', onWaveformTimelineWheelCapture, {
                passive: false,
                capture: true,
            });
        }
        if (lanes.dataset.waveformZoomScroll !== '1') {
            lanes.dataset.waveformZoomScroll = '1';
            lanes.addEventListener('scroll', onWaveformLanesScroll, { passive: true });
        }
        applyWaveformTimelineZoomLayout();
        bindPlayheadCenterLockCheckbox();
        syncPlayheadCenterLockUi();
    }

    window.initWaveformTimelineZoomUi = initWaveformTimelineZoomUi;

    window.getWaveformTimelineZoom = getWaveformTimelineZoom;
    window.setWaveformTimelineZoom = setWaveformTimelineZoom;
    window.applyWaveformTimelineZoomLayout = applyWaveformTimelineZoomLayout;

    function transportSecFromClientX(clientX) {
        return transportRatioFromClientX(clientX) * getMasterTransportDurationSec();
    }

    window.transportRatioFromClientX = transportRatioFromClientX;
    window.transportSecFromClientX = transportSecFromClientX;
    window.waveformTimelineScrubWidthCss = waveformTimelineScrubWidthCss;

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

    /** 描画してからこの時間（ms）で完全に透明になる */
    const SEEK_TRAIL_FADE_MS = 10400;
    const SEEK_TRAIL_PEAK_ALPHA = 0.15;
    /** プレイヘッド縦線（2px）と重ねない余白 */
    const SEEK_TRAIL_PLAYHEAD_GAP_PX = 2;
    const SEEK_TRAIL_MIN_SEC_DELTA = 0.02;
    const SEEK_TRAIL_SAMPLE_MIN_INTERVAL_MS = 24;
    /** 広い区間を細分化して描くときの最大幅（px） */
    const SEEK_TRAIL_SEGMENT_CHUNK_PX = 3;
    const SEEK_TRAIL_MAX_SAMPLES = 900;
    /** 再生位置がこれ以上飛ぶとループ／シークとみなし軌跡をリセット */
    const SEEK_TRAIL_DISCONTINUITY_SEC = 1.25;
    let seekTrailSamples = [];

    function seekTrailDiscontinuitySec() {
        const master = getMasterTransportDurationSec();
        if (!(master > 0)) return SEEK_TRAIL_DISCONTINUITY_SEC;
        return Math.max(SEEK_TRAIL_DISCONTINUITY_SEC, master * 0.025);
    }

    function seekTrailAlphaForAgeMs(ageMs) {
        if (ageMs >= SEEK_TRAIL_FADE_MS) return 0;
        const t = ageMs / SEEK_TRAIL_FADE_MS;
        const fade = 1 - t;
        return SEEK_TRAIL_PEAK_ALPHA * fade * fade;
    }

    function pruneSeekTrailSamplesByAge(now) {
        while (seekTrailSamples.length && now - seekTrailSamples[0].at >= SEEK_TRAIL_FADE_MS) {
            seekTrailSamples.shift();
        }
    }

    function clearSeekPlaybackTrail() {
        seekTrailSamples = [];
        drawSeekPlaybackTrail();
    }

    function recordSeekPlaybackTrail(sec) {
        const playing =
            typeof isTransportPlaying === 'function' && isTransportPlaying();
        if (!playing) return;
        const n = Number(sec);
        if (!Number.isFinite(n)) return;
        const now = performance.now();
        const last = seekTrailSamples[seekTrailSamples.length - 1];
        if (last && Math.abs(n - last.sec) >= seekTrailDiscontinuitySec()) {
            seekTrailSamples = [];
        }
        if (
            last &&
            seekTrailSamples.length &&
            now - last.at < SEEK_TRAIL_SAMPLE_MIN_INTERVAL_MS &&
            Math.abs(last.sec - n) < SEEK_TRAIL_MIN_SEC_DELTA
        ) {
            return;
        }
        if (last && seekTrailSamples.length) {
            const master = getMasterTransportDurationSec();
            const contentW = masterTimelineWidthCss();
            const secDelta = Math.abs(n - last.sec);
            if (master > 0 && contentW > 0 && secDelta > SEEK_TRAIL_MIN_SEC_DELTA * 1.5) {
                const pxDelta = (secDelta / master) * contentW;
                const insertN = Math.min(8, Math.max(1, Math.ceil(pxDelta / 8) - 1));
                for (let j = 1; j <= insertN; j++) {
                    const f = j / (insertN + 1);
                    seekTrailSamples.push({
                        sec: last.sec + (n - last.sec) * f,
                        at: last.at + (now - last.at) * f,
                    });
                }
            }
        }
        seekTrailSamples.push({ sec: n, at: now });
        pruneSeekTrailSamplesByAge(now);
        if (seekTrailSamples.length > SEEK_TRAIL_MAX_SAMPLES) {
            seekTrailSamples.splice(0, seekTrailSamples.length - SEEK_TRAIL_MAX_SAMPLES);
            pruneSeekTrailSamplesByAge(now);
        }
    }

    function drawSeekTrailSegmentChunk(ctx, segL, segR, atL, atR, now, h) {
        const a0 = seekTrailAlphaForAgeMs(now - atL);
        const a1 = seekTrailAlphaForAgeMs(now - atR);
        if (a0 <= 0.001 && a1 <= 0.001) return;
        const segW = segR - segL;
        if (segW <= 0) return;
        const grad = ctx.createLinearGradient(segL, 0, segR, 0);
        grad.addColorStop(0, 'rgba(0, 255, 255, ' + a0.toFixed(4) + ')');
        grad.addColorStop(1, 'rgba(0, 255, 255, ' + a1.toFixed(4) + ')');
        ctx.fillStyle = grad;
        ctx.fillRect(segL, 0, segW, h);
    }

    function drawSeekTrailSegment(ctx, older, newer, secToX, now, trailRightX, h) {
        const x0 = secToX(older.sec);
        const x1 = secToX(newer.sec);
        let segL = Math.min(x0, x1);
        let segR = Math.max(x0, x1);
        if (segL >= trailRightX) return;
        segR = Math.min(segR, trailRightX);
        const segW = segR - segL;
        if (segW <= 0) return;

        const steps = Math.max(1, Math.ceil(segW / SEEK_TRAIL_SEGMENT_CHUNK_PX));
        const atSpan = newer.at - older.at;
        for (let k = 0; k < steps; k++) {
            const f0 = k / steps;
            const f1 = (k + 1) / steps;
            const subL = segL + segW * f0;
            const subR = segL + segW * f1;
            const at0 = older.at + atSpan * f0;
            const at1 = older.at + atSpan * f1;
            drawSeekTrailSegmentChunk(ctx, subL, subR, at0, at1, now, h);
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
        pruneSeekTrailSamplesByAge(now);
        if (seekTrailSamples.length < 2) return;

        const master = getMasterTransportDurationSec();
        if (!(master > 0)) return;

        const secToX = (sec) => (sec / master) * w;
        const playheadX = secToX(seekTrailSamples[seekTrailSamples.length - 1].sec);
        const trailRightX = playheadX - SEEK_TRAIL_PLAYHEAD_GAP_PX;
        if (trailRightX <= 0) return;

        for (let i = 1; i < seekTrailSamples.length; i++) {
            drawSeekTrailSegment(
                ctx,
                seekTrailSamples[i - 1],
                seekTrailSamples[i],
                secToX,
                now,
                trailRightX,
                h,
            );
        }
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
                (typeof anyExtraTrackLoadedForTimeline === 'function' &&
                anyExtraTrackLoadedForTimeline());
            playheadWrap.style.left = pct + '%';
            playheadWrap.hidden = !show;
        }
        recordSeekPlaybackTrail(t);
        drawSeekPlaybackTrail();
        const lanes = waveformScrubTargetEl();
        if (lanes) lanes.setAttribute('aria-valuenow', String(Math.round(pct)));
        applyPlayheadCenterLockIfActive();
    }

    function anyExtraTrackLoadedForTimeline() {
        const loadFn =
            typeof window.isExtraTrackLoaded === 'function'
                ? window.isExtraTrackLoaded
                : typeof isExtraTrackLoaded === 'function'
                  ? isExtraTrackLoaded
                  : null;
        if (!loadFn) return false;
        const n = typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 3;
        for (let i = 0; i < n; i++) {
            if (loadFn(i)) return true;
        }
        return false;
    }

    function masterTimelineContentWidth(wCss, contentDurSec) {
        const master = getMasterTransportDurationSec();
        if (!wCss || !master || !contentDurSec) return 0;
        return wCss * (contentDurSec / master);
    }

    function getViewportPeakDrawRange(viewportPeaks, wCss, contentDurSec, drawOpt) {
        if (!viewportPeaks || !viewportPeaks.peaks || viewportPeaks.peaks.length === 0) {
            return null;
        }
        const master = getMasterTransportDurationSec();
        if (!(master > 0)) return null;
        const timelineStartSec =
            drawOpt && Number.isFinite(drawOpt.timelineStartSec) && drawOpt.timelineStartSec > 0
                ? drawOpt.timelineStartSec
                : 0;
        const trackEndSec = timelineStartSec + (contentDurSec > 0 ? contentDurSec : 0);
        const t0 = Math.max(timelineStartSec, viewportPeaks.masterStartSec);
        const t1 = Math.min(trackEndSec, viewportPeaks.masterEndSec);
        if (t1 <= t0 + 1e-9) return null;
        const x0 = (t0 / master) * wCss;
        const x1 = (t1 / master) * wCss;
        if (!(x1 > x0 + 0.5)) return null;
        return { x0, x1 };
    }

    function drawPeaksBarsInRange(ctx, peaks, x0, drawW, hCss, fillStyle, skipX0, skipX1) {
        if (!peaks || peaks.length === 0 || !(drawW > 0)) return;
        const mid = hCss * 0.5;
        const barW = drawW / peaks.length;
        const hasSkip =
            Number.isFinite(skipX0) && Number.isFinite(skipX1) && skipX1 > skipX0 + 0.5;
        ctx.fillStyle = fillStyle || '#ffffff';
        for (let i = 0; i < peaks.length; i++) {
            const p = peaks[i];
            const x = x0 + i * barW;
            const w = Math.max(1, barW + 0.5);
            if (hasSkip && x + w > skipX0 && x < skipX1) continue;
            const top = mid - Math.max(0.5, p.max * (mid - 2));
            const bot = mid - Math.min(-0.5, p.min * (mid - 2));
            const h = Math.max(1, bot - top);
            ctx.fillRect(x, top, w, h);
        }
    }

    /** リージョン描画後など、可視範囲だけを背景で消して高解像度ピークを描く */
    function drawViewportPeaksOnTimeline(
        ctx,
        viewportPeaks,
        wCss,
        hCss,
        contentDurSec,
        fillStyle,
        drawOpt,
    ) {
        const range = getViewportPeakDrawRange(viewportPeaks, wCss, contentDurSec, drawOpt);
        if (!range) return;
        const vpW = range.x1 - range.x0;
        ctx.fillStyle = TIMELINE_LANE_TRACK_BG;
        ctx.fillRect(range.x0, 0, vpW, hCss);
        const mid = hCss * 0.5;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(range.x0, mid);
        ctx.lineTo(range.x1, mid);
        ctx.stroke();
        drawPeaksBarsInRange(
            ctx,
            viewportPeaks.peaks,
            range.x0,
            vpW,
            hCss,
            fillStyle,
        );
    }

    function drawPeaksForMasterTimeline(ctx, peaks, wCss, hCss, contentDurSec, fillStyle, drawOpt) {
        const mid = hCss * 0.5;
        ctx.clearRect(0, 0, wCss, hCss);
        ctx.fillStyle = TIMELINE_LANE_TRACK_BG;
        ctx.fillRect(0, 0, wCss, hCss);

        const timelineStartSec =
            drawOpt && Number.isFinite(drawOpt.timelineStartSec) && drawOpt.timelineStartSec > 0
                ? drawOpt.timelineStartSec
                : 0;
        const startX = masterTimelineContentWidth(wCss, timelineStartSec);
        const vpRange =
            drawOpt && drawOpt.viewportPeaks
                ? getViewportPeakDrawRange(
                      drawOpt.viewportPeaks,
                      wCss,
                      contentDurSec,
                      drawOpt,
                  )
                : null;

        if (!peaks || peaks.length === 0) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, mid);
            ctx.lineTo(wCss, mid);
            ctx.stroke();
            drawTimelineVideoEndMarkerLine(ctx, wCss, hCss);
            if (vpRange) {
                drawPeaksBarsInRange(
                    ctx,
                    drawOpt.viewportPeaks.peaks,
                    vpRange.x0,
                    vpRange.x1 - vpRange.x0,
                    hCss,
                    fillStyle,
                );
            }
            return;
        }

        const contentW = masterTimelineContentWidth(wCss, contentDurSec);
        const drawW = contentW > 0 ? contentW : wCss;
        drawPeaksBarsInRange(
            ctx,
            peaks,
            startX,
            drawW,
            hCss,
            fillStyle,
            vpRange ? vpRange.x0 : null,
            vpRange ? vpRange.x1 : null,
        );

        if (vpRange) {
            drawPeaksBarsInRange(
                ctx,
                drawOpt.viewportPeaks.peaks,
                vpRange.x0,
                vpRange.x1 - vpRange.x0,
                hCss,
                fillStyle,
            );
        }

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, mid);
        ctx.lineTo(wCss, mid);
        ctx.stroke();

        drawTimelineVideoEndMarkerLine(ctx, wCss, hCss);
    }

    window.drawPeaksBarsInRange = drawPeaksBarsInRange;
    window.drawViewportPeaksOnTimeline = drawViewportPeaksOnTimeline;

    function setLaneContentEndMarker(el, _contentDurSec) {
        if (!el) return;
        el.hidden = true;
    }

    function updateLaneContentEndMarkers() {
        setLaneContentEndMarker(document.getElementById('audioWaveformContentEnd'), 0);
        const extraCount =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 3;
        for (let i = 0; i < extraCount; i++) {
            setLaneContentEndMarker(document.getElementById('extraAudioContentEnd' + i), 0);
        }
    }

    function updateAudioWaveformPlayhead() {
        updateAllWaveformPlayheads();
    }

