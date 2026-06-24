/**
 * transport-timeline.js — マスタートランスポート（再生・一時停止・尺・シーク・動画同期・焼き込み TC）。
 */
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
    /** Video リージョン In より前 — 暗転中は映像要素を pause して毎 tick シークしない */
    let videoPreRollHoldActive = false;
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
        refreshVideoDriftPanelStat();
    }

    function isPlaybackDriftMonitoringActive() {
        const playing =
            (typeof isTransportPlaying === 'function' && isTransportPlaying()) ||
            (videoMain && !videoMain.paused && !videoMain.ended);
        if (!playing) return false;
        if (typeof isSeeking !== 'undefined' && isSeeking) return false;
        if (videoMain && videoMain.seeking) return false;
        if (
            typeof isAudioWaveformScrubActive === 'function' &&
            isAudioWaveformScrubActive()
        ) {
            return false;
        }
        return true;
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
        if (frames >= 2) return 'danger';
        if (frames === 1) return 'warn';
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
        statEl.title = title || '再生ドリフト: 利用できません';
    }

    function showPlaybackDriftPanelZero(statEl) {
        const driftBox = videoDriftTransportBoxEl(statEl);
        if (driftBox) driftBox.hidden = false;
        setPlaybackDriftDisplay(statEl, 0);
        applyPlaybackDriftPanelTone(statEl, 'safe');
        if (driftBox) driftBox.classList.remove('transport-opt-box--drift-correct');
        statEl.title = '再生ドリフト: セッション未ロード（0 f）';
    }

    function showPlaybackDriftPanelInactive(statEl) {
        const driftBox = videoDriftTransportBoxEl(statEl);
        if (driftBox) driftBox.hidden = false;
        setPlaybackDriftDisplayUnknown(statEl);
        applyPlaybackDriftPanelTone(statEl, 'safe');
        if (driftBox) driftBox.classList.remove('transport-opt-box--drift-correct');
        statEl.title = '再生ドリフト: 停止・シーク中は監視していません（---- f を表示）';
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
                '再生ドリフト: 動画なしでは利用不可（---- f を表示）',
            );
            return;
        }
        if (!isPlaybackDriftMonitoringActive()) {
            showPlaybackDriftPanelInactive(statEl);
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
            const sampled = sampleVideoDriftForPlayback(audioSec, opt);
            if (sampled != null) {
                signed = sampled;
                lastPlaybackDriftUiSigned = sampled;
            } else {
                signed = lastPlaybackDriftUiSigned;
            }
        }
        if (signed == null) {
            showPlaybackDriftPanelUnknown(
                statEl,
                '再生ドリフト: 測定可能なドリフトなし（---- f を表示）',
            );
            return;
        }

        const frames = playbackDriftFramesFromSec(signed);
        const corrected =
            !!(opt && opt.corrected) || performance.now() < videoDriftCorrectFlashUntil;
        if (driftBox) driftBox.hidden = false;
        setPlaybackDriftDisplay(statEl, signed);
        applyPlaybackDriftPanelTone(statEl, playbackDriftToneFromFrames(frames));
        if (driftBox) {
            driftBox.classList.toggle('transport-opt-box--drift-correct', corrected);
        }
        statEl.title = VIDEO_DRIFT_AUTO_CORRECT_ENABLED
            ? '再生ドリフト — 映像と音声マスターの差（約1秒ごとに更新、2 f 以上で赤・1 f で黄、映像を補正）。'
            : '再生ドリフト — 映像と音声マスターの差（約1秒ごとに更新、2 f 以上で赤・1 f で黄、自動補正は無効）。';
    }

    window.refreshVideoDriftPanelStat = refreshVideoDriftPanelStat;
    window.isPlaybackDriftMonitoringActive = isPlaybackDriftMonitoringActive;

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
            const coalescingKeyboardSeek = transportExplicitSeekFinalizeTimer !== 0;
            if (coalescingKeyboardSeek) {
                const barT =
                    typeof getTransportSec === 'function'
                        ? getTransportSec()
                        : typeof transportPlaybackSec === 'number'
                          ? transportPlaybackSec
                          : end;
                let ignoreEndedSnap = false;
                if (end > 0 && meta > 0 && Number.isFinite(barT)) {
                    const expected =
                        typeof videoSecForTransportSec === 'function'
                            ? videoSecForTransportSec(barT)
                            : barT;
                    if (Number.isFinite(expected) && end > expected + 0.12) {
                        ignoreEndedSnap = true;
                    }
                }
                if (end > 0 && !ignoreEndedSnap) return end;
            } else if (end > 0) {
                return end;
            }
        }
        const cap =
            typeof getPlaybackCapSec === 'function' ? getPlaybackCapSec(videoMain) : 0;
        if (cap > 0 && meta > 0 && cap < meta - masterTransportTailEpsilonSec()) {
            return cap;
        }
        return meta;
    }

    /** タイムライン上の動画終端（リージョン平行移動を反映）。 */
    function getVideoContentEndOnTransportSec() {
        if (typeof getVideoTrackTransportEndSec === 'function') {
            const end = getVideoTrackTransportEndSec();
            if (end > 0) return end;
        }
        return getVideoPlaybackEndSec();
    }

    function hasMasterTransportTailBeyondVideo() {
        const master = getMasterTransportDurationSec();
        const vd = getVideoContentEndOnTransportSec();
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
        const vd = getVideoContentEndOnTransportSec();
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
        const vd = getVideoContentEndOnTransportSec();
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
        const vd = getVideoContentEndOnTransportSec();
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
        if (
            typeof isTransportBeforeVideoRegionIn === 'function' &&
            isTransportBeforeVideoRegionIn(transportSec)
        ) {
            return true;
        }
        return shouldBlackoutVideoForTransport(transportSec);
    }

    function getTransportPlaybackClockSec() {
        if (!Number.isFinite(transportPlaybackSec)) return 0;
        const clockActive =
            typeof isTransportPlaying === 'function'
                ? isTransportPlaying()
                : !!(videoMain && !videoMain.paused);
        if (
            clockActive &&
            Number.isFinite(transportPlaybackLastTs) &&
            transportPlaybackLastTs > 0
        ) {
            return (
                transportPlaybackSec + (performance.now() - transportPlaybackLastTs) / 1000
            );
        }
        return transportPlaybackSec;
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
    window.computeLiveMasterTransportDurationSec = computeLiveMasterTransportDurationSec;
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
        if (typeof isOperationBlockingActive === 'function' && isOperationBlockingActive()) {
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
        const vd = getVideoContentEndOnTransportSec();
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
        const start =
            typeof getExtraTrackTimelineStartSec === 'function'
                ? getExtraTrackTimelineStartSec(slot)
                : 0;
        let regionEnd = 0;
        if (typeof getTrackTimelineEndSec === 'function') {
            regionEnd = getTrackTimelineEndSec({ type: 'extra', slot });
        }
        let bufEnd = 0;
        if (typeof extraTrackBufferDuration === 'function') {
            const buf = extraTrackBufferDuration(slot);
            if (buf > 0) bufEnd = start + buf;
        }
        // タイムストレッチ直後はリージョン再配置前でも伸長済みバッファ尺をマスターに反映
        if (
            typeof isExtraTrackTempoStretched === 'function' &&
            isExtraTrackTempoStretched(slot) &&
            bufEnd > regionEnd + 0.0005
        ) {
            return bufEnd;
        }
        // ストレッチ解除直後はリージョン未再配置の間、オリジナルバッファ尺を優先
        if (
            typeof isTempoStretchPendingRelayout === 'function' &&
            isTempoStretchPendingRelayout() &&
            bufEnd > 0
        ) {
            return bufEnd;
        }
        if (regionEnd > 0) return regionEnd;
        if (bufEnd > 0) return bufEnd;
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

    function computeLiveMasterTransportDurationSec() {
        if (
            typeof waveformOffsetDragActive !== 'undefined' &&
            waveformOffsetDragActive &&
            typeof getRegionOffsetDragMasterFreezeSec === 'function'
        ) {
            const frozen = getRegionOffsetDragMasterFreezeSec();
            if (Number.isFinite(frozen) && frozen > 0) {
                return frozen;
            }
        }
        let m = 0;
        const vd = getVideoTransportDurationSec();
        if (vd > 0) m = vd;
        if (typeof getVideoTrackTimelineEndSec === 'function') {
            const vet = getVideoTrackTimelineEndSec();
            if (vet > m) m = vet;
        }
        const extraCount = getExtraTrackCount();
        for (let i = 0; i < extraCount; i++) {
            const ed = getExtraTrackDurationSec(i);
            if (ed > m) m = ed;
        }
        return Math.max(m, 0.01);
    }

    function getMasterTransportDurationSec() {
        if (typeof getRegionOffsetDragMasterFreezeSec === 'function') {
            const frozen = getRegionOffsetDragMasterFreezeSec();
            if (Number.isFinite(frozen) && frozen > 0) {
                return frozen;
            }
        }
        return computeLiveMasterTransportDurationSec();
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
        if (typeof videoSecFromVideoTrackRegions === 'function') {
            const mapped = videoSecFromVideoTrackRegions(x);
            if (Number.isFinite(mapped)) {
                const vd = getVideoTransportDurationSec();
                if (vd > 0) {
                    return Math.max(0, Math.min(mapped, Math.max(0, vd - masterFrameSec)));
                }
                return Math.max(0, mapped);
            }
            const track = typeof getVideoTrackRef === 'function' ? getVideoTrackRef() : null;
            if (
                track &&
                typeof isTrackRegionActive === 'function' &&
                isTrackRegionActive(track)
            ) {
                return 0;
            }
        }
        const vd = getVideoContentEndOnTransportSec();
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

    function clearVideoPreRollHold() {
        videoPreRollHoldActive = false;
        if (typeof refreshVideoPastEndBlackoutUi === 'function') refreshVideoPastEndBlackoutUi();
    }

    window.clearVideoPreRollHold = clearVideoPreRollHold;

    function isVideoParkedForTransportTail() {
        return videoParkedForTransportTail;
    }

    function parkVideoAtTransportTail() {
        if (!videoMain || !videoReady()) return;
        const transportEnd = getVideoContentEndOnTransportSec();
        if (!(transportEnd > 0)) return;
        let park = Math.max(0, transportEnd - masterFrameSec);
        if (typeof videoSecForTransportSec === 'function') {
            const mapped = videoSecForTransportSec(Math.max(0, transportEnd - masterFrameSec));
            if (Number.isFinite(mapped)) {
                park = mapped;
            }
        }
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
        const effectiveEnd = getVideoContentEndOnTransportSec();
        if (effectiveEnd > 0 && x >= effectiveEnd - 0.0005) {
            parkVideoAtTransportTail();
            return false;
        }
        clearVideoParkedForTail();
        let target = videoSecForTransportSec(x);
        if (typeof clampVideoElementSeekSec === 'function') {
            target = clampVideoElementSeekSec(videoMain, target);
        }
        const cur = videoMain.currentTime || 0;
        const drift = Math.abs(cur - target);
        const playing =
            typeof isTransportPlaying === 'function' && isTransportPlaying();
        const regionTransportSync =
            typeof videoRegionPlaybackRequiresTransportSync === 'function' &&
            videoRegionPlaybackRequiresTransportSync();
        const steadyNativePlayback =
            !force &&
            !regionTransportSync &&
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
        const beforeRegionIn =
            regionTransportSync &&
            typeof isTransportBeforeVideoRegionIn === 'function' &&
            isTransportBeforeVideoRegionIn(x);
        const oneToOneAfterIn =
            regionTransportSync &&
            typeof videoRegionMappingIsOneToOneAfterIn === 'function' &&
            videoRegionMappingIsOneToOneAfterIn();

        if (playing) {
            const signed = sampleVideoDriftForPlayback(x, { force: !!force });
            if (signed != null) {
                refreshVideoDriftMonitorFromSample(x, signed);
            }
        }

        let needs = false;
        let justExitedPreRoll = false;
        if (beforeRegionIn) {
            videoPreRollHoldActive = true;
            if (playing && !videoMain.paused) {
                try {
                    videoMain.pause();
                } catch (_) {}
            }
            needs =
                force ||
                videoMain.ended ||
                !Number.isFinite(cur) ||
                drift > 0.02;
        } else {
            justExitedPreRoll = videoPreRollHoldActive;
            if (videoPreRollHoldActive) {
                videoPreRollHoldActive = false;
            }
            if (regionTransportSync && oneToOneAfterIn && playing && !force) {
                needs =
                    justExitedPreRoll ||
                    videoMain.ended ||
                    !Number.isFinite(cur) ||
                    drift > VIDEO_STEADY_FOLLOW_DRIFT_SEC;
            } else {
                needs =
                    force ||
                    justExitedPreRoll ||
                    videoMain.ended ||
                    !Number.isFinite(cur) ||
                    (regionTransportSync && drift > 0.03) ||
                    (VIDEO_DRIFT_AUTO_CORRECT_ENABLED && drift > 0.001);
            }
        }

        if (needs) {
            try {
                videoMain.currentTime = target;
            } catch (_) {}
        }
        if (typeof refreshVideoPastEndBlackoutUi === 'function') {
            refreshVideoPastEndBlackoutUi();
        }
        if (typeof window.videoRegionDiagLogTransportMap === 'function') {
            window.videoRegionDiagLogTransportMap(x, target, {
                force,
                regionTransportSync,
                beforeRegionIn,
                oneToOneAfterIn,
                preRollHold: videoPreRollHoldActive,
                justExitedPreRoll,
                playing,
                drift,
                applied: needs,
            });
        }
        if (playing && !beforeRegionIn && videoMain.paused && !videoMain.ended) {
            const startPlay = () => {
                const p = videoMain.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            };
            if (needs && videoMain.seeking) {
                videoMain.addEventListener('seeked', startPlay, { once: true });
            } else {
                startPlay();
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

    /** スクラブ中: 位置・プレイヘッド・スクロール追従のみ（描画・タイル取得より最優先） */
    function applyTransportScrubPositionImmediate(sec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const x =
            typeof clampTransportSec === 'function'
                ? clampTransportSec(sec)
                : Number.isFinite(Number(sec))
                  ? Number(sec)
                  : 0;
        transportPlaybackSec = x;
        transportPlaybackLastTs = performance.now();
        if (!o.deferSeekBar && typeof setTransportSec === 'function') {
            setTransportSec(x);
        }
        if (
            typeof currentTimeEl !== 'undefined' &&
            currentTimeEl &&
            typeof formatTimecodeForTransport === 'function'
        ) {
            currentTimeEl.textContent = formatTimecodeForTransport(x);
        }
        const pct = transportSecToTimelineLeftPercent(x);
        const playheadWrap =
            typeof audioWaveformPlayheadWrap !== 'undefined' && audioWaveformPlayheadWrap
                ? audioWaveformPlayheadWrap
                : document.getElementById('audioWaveformPlayheadWrap');
        if (playheadWrap) {
            playheadWrap.style.left = pct + '%';
            if (playheadWrap.hidden) {
                const show =
                    (typeof videoReady === 'function' && videoReady()) ||
                    (typeof anyExtraTrackLoadedForTimeline === 'function' &&
                        anyExtraTrackLoadedForTimeline());
                playheadWrap.hidden = !show;
            }
        }
        const wantScrollFollow =
            o.centerScroll !== false &&
            typeof isWaveformTimelineAtFitZoom === 'function' &&
            !isWaveformTimelineAtFitZoom();
        if (wantScrollFollow) {
            const scrollOpt = { deferVisualRefresh: true };
            if (o.centerSeekBar && typeof centerWaveformTimelineOnMasterSec === 'function') {
                centerWaveformTimelineOnMasterSec(x, scrollOpt);
            } else {
                const scrollToSec =
                    typeof syncWaveformTimelineScrollToMasterSec === 'function'
                        ? syncWaveformTimelineScrollToMasterSec
                        : typeof centerWaveformTimelineOnMasterSec === 'function'
                          ? centerWaveformTimelineOnMasterSec
                          : null;
                if (scrollToSec) {
                    scrollToSec(x, scrollOpt);
                }
            }
        }
        if (o.redrawWaveform && typeof scheduleWaveformScrubOverviewDraw === 'function') {
            scheduleWaveformScrubOverviewDraw();
        }
    }

    window.applyTransportScrubPositionImmediate = applyTransportScrubPositionImmediate;

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
        const keyboardLite =
            typeof isKeyboardTransportScrubActive === 'function' &&
            isKeyboardTransportScrubActive() &&
            typeof isKeyboardScrubLightweight === 'function' &&
            isKeyboardScrubLightweight(opt);
        const wantResume = !(opt && opt.resumeAfter === false);
        let wasActive = false;
        if (
            !scrubbing &&
            wantResume &&
            typeof captureTransportWasActive === 'function' &&
            typeof pauseTransportBeforeSeek === 'function'
        ) {
            wasActive =
                !!(opt && opt.wasPlayingBeforeSeek) || captureTransportWasActive();
            if (wasActive || (videoMain && !videoMain.paused)) {
                pauseTransportBeforeSeek();
            }
        }
        const x = clampTransportSec(t);
        if (
            keyboardLite &&
            typeof shouldQueueKeyboardScrubUi === 'function' &&
            shouldQueueKeyboardScrubUi(opt)
        ) {
            transportExplicitSeekTargetSec = x;
            applyTransportScrubPositionImmediate(x);
            if (opt && opt.logInput && typeof logSeekBarInputThrottled === 'function') {
                logSeekBarInputThrottled(x);
            }
            return;
        }
        /* シークバー／波形ドラッグ中: 位置のみ（波形再描画は開始時1回・離したとき） */
        if (scrubbing && !keyboardLite) {
            applyTransportScrubPositionImmediate(x, { deferSeekBar: true });
            return;
        }
        transportPlaybackSec = x;
        transportPlaybackLastTs = performance.now();
        if (!scrubbing && hasMasterTransportTailBeyondVideo()) {
            const vd = getVideoContentEndOnTransportSec();
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
        if (!keyboardLite) {
            if (typeof clearVideoPreRollHold === 'function') clearVideoPreRollHold();
            const videoTimeApplied = applyVideoTimeForTransportSec(x, { force: true });
            if (typeof refreshVideoPastEndBlackoutUi === 'function') refreshVideoPastEndBlackoutUi();
            if (typeof updateTimecodeOverlay === 'function') updateTimecodeOverlay();
            if (
                videoTimeApplied &&
                !(opt && opt.scrubbing) &&
                typeof applyReviewMixVideoGain === 'function'
            ) {
                applyReviewMixVideoGain({ forceRecapture: true });
            }
        }
        if (!(opt && opt.scrubbing) && typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (typeof updateAllWaveformPlayheads === 'function') {
            const lite = keyboardLite;
            updateAllWaveformPlayheads(
                lite
                    ? {
                          lightweight: true,
                          keyboardScrub:
                              typeof shouldQueueKeyboardScrubUi === 'function' &&
                              shouldQueueKeyboardScrubUi(opt),
                      }
                    : undefined,
            );
        }
        if (
            !scrubbing &&
            !keyboardLite &&
            typeof syncWaveformTimelineAfterTransportSeek === 'function'
        ) {
            syncWaveformTimelineAfterTransportSeek(x);
        }
        if (typeof updateLaneContentEndMarkers === 'function') updateLaneContentEndMarkers();
        if (opt && opt.logInput && typeof logSeekBarInputThrottled === 'function') {
            logSeekBarInputThrottled(x);
        }
        if (opt && opt.flash && typeof flashSeekScrubThrottled === 'function') {
            flashSeekScrubThrottled(x);
        }
        if (
            opt &&
            opt.markers &&
            !keyboardLite &&
            typeof renderAudioWaveformMarkers === 'function'
        ) {
            renderAudioWaveformMarkers();
        }
        if (wasActive && wantResume && typeof resumeTransportAfterExplicitSeek === 'function') {
            void resumeTransportAfterExplicitSeek(x);
        }
    }

    function notifyMasterTransportDurationChanged() {
        if (typeof syncSeekMax === 'function') syncSeekMax();
        if (typeof scheduleMusicalGridRedraw === 'function') {
            scheduleMusicalGridRedraw();
        } else if (typeof refreshRehearsalMarkTrackEventsAfterMasterDurationReady === 'function') {
            refreshRehearsalMarkTrackEventsAfterMasterDurationReady();
        }
        if (typeof applyWaveformTimelineZoomLayout === 'function') {
            applyWaveformTimelineZoomLayout();
        }
        if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
        if (typeof redrawAllExtraTrackWaveforms === 'function') redrawAllExtraTrackWaveforms();
        if (typeof updateAllWaveformPlayheads === 'function') updateAllWaveformPlayheads();
        if (typeof updateLaneContentEndMarkers === 'function') updateLaneContentEndMarkers();
        if (typeof updateRangeLoopOverlay === 'function') updateRangeLoopOverlay();
        const restoreBusy =
            (typeof isSessionRestoreInProgress === 'function' &&
                isSessionRestoreInProgress()) ||
            (typeof isSessionRestoreTeardownPending === 'function' &&
                isSessionRestoreTeardownPending());
        if (!restoreBusy && typeof updateAllPlaybackRegionOverlays === 'function') {
            updateAllPlaybackRegionOverlays();
        }
        if (typeof flushPendingSessionMarkersRestore === 'function') {
            flushPendingSessionMarkersRestore();
        }
        const markerDragActive =
            typeof isMarkerWaveformDragActive === 'function' &&
            isMarkerWaveformDragActive();
        if (!markerDragActive && typeof syncAudioOnlyMarkersUi === 'function') {
            syncAudioOnlyMarkersUi();
        } else if (!markerDragActive && typeof refreshMarkerUi === 'function') {
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
        clearVideoPreRollHold();
    }

    /** 一時停止時: 壁時計外挿を止め、シークバー位置で凍結 */
    function freezeTransportPlaybackClock() {
        if (typeof getTransportSec === 'function') {
            const t = getTransportSec();
            if (Number.isFinite(t)) transportPlaybackSec = t;
        } else if (typeof seekBar !== 'undefined' && seekBar) {
            const t = parseFloat(seekBar.value);
            if (Number.isFinite(t)) transportPlaybackSec = t;
        }
        transportPlaybackLastTs = 0;
    }

    function advanceTransportTailPlaybackClock(master) {
        const barT =
            typeof getTransportSec === 'function' ? getTransportSec() : transportPlaybackSec;
        const now = performance.now();
        if (transportPlaybackLastTs > 0) {
            transportPlaybackSec += (now - transportPlaybackLastTs) / 1000;
        } else {
            transportPlaybackSec = Math.max(transportPlaybackSec, barT);
        }
        transportPlaybackLastTs = now;
        const ctx =
            typeof ensureReviewMixCtx === 'function' ? ensureReviewMixCtx() : null;
        nudgeTransportFromExtraMixIfAhead(ctx, master);
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
    }

    function applyTransportPlaybackSecFromExtraMix(fromMix, master) {
        if (!Number.isFinite(fromMix)) return false;
        if (fromMix <= transportPlaybackSec + 0.001) {
            return false;
        }
        transportPlaybackSec = fromMix;
        transportPlaybackLastTs = performance.now();
        if (typeof snapRangeLoopPlaybackIfNeeded === 'function') {
            snapRangeLoopPlaybackIfNeeded();
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

    function advanceTransportWallClock(master) {
        const now = performance.now();
        if (transportPlaybackLastTs > 0) {
            transportPlaybackSec += (now - transportPlaybackLastTs) / 1000;
        }
        transportPlaybackLastTs = now;
        if (typeof snapRangeLoopPlaybackIfNeeded === 'function') {
            snapRangeLoopPlaybackIfNeeded();
        }
        if (master > 0 && transportPlaybackSec >= master - 0.0005) {
            if (typeof handleMasterTransportEndReached === 'function') {
                void handleMasterTransportEndReached();
            }
            return;
        }
        if (typeof maybeFinishMasterTransportPlayback === 'function') {
            maybeFinishMasterTransportPlayback();
        }
    }

    function nudgeTransportFromExtraMixIfAhead(ctx, master) {
        if (!ctx || typeof getTransportSecFromActiveExtraMix !== 'function') return;
        const fromMix = getTransportSecFromActiveExtraMix(ctx);
        if (fromMix == null || !Number.isFinite(fromMix)) return;
        applyTransportPlaybackSecFromExtraMix(fromMix, master);
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
        if (isSeeking) return;
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
        advanceTransportWallClock(master);
        const ctx =
            typeof ensureReviewMixCtx === 'function' ? ensureReviewMixCtx() : null;
        nudgeTransportFromExtraMixIfAhead(ctx, master);
        syncReviewMixPlaybackIfNeeded();
    }

    function syncTransportPlaybackClockFromVideo() {
        syncTransportPlaybackClockFromAudio();
    }

    function getTransportSecForDisplay() {
        if (typeof isTransportPlaying === 'function' && isTransportPlaying()) {
            if (typeof getTransportPlaybackClockSec === 'function') {
                return getTransportPlaybackClockSec();
            }
            if (Number.isFinite(transportPlaybackSec)) return transportPlaybackSec;
        }
        if (typeof getTransportSec === 'function') return getTransportSec();
        return 0;
    }

    function updateMusicalGridPlayheadDisplay(sec) {
        const el =
            typeof musicalGridPlayheadPos !== 'undefined' && musicalGridPlayheadPos
                ? musicalGridPlayheadPos
                : document.getElementById('musicalGridPlayheadPos');
        if (!el) return;
        if (typeof resolveMusicalGridPlayheadPositionText === 'function') {
            el.textContent = resolveMusicalGridPlayheadPositionText(sec);
            return;
        }
        el.textContent = '--- --- ---:--';
    }
    window.updateMusicalGridPlayheadDisplay = updateMusicalGridPlayheadDisplay;

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
        const end = getVideoContentEndOnTransportSec();
        if (end > 0) return end;
        return getVideoTransportDurationSec();
    }

    /** 全波形レーン共通: 動画終端の極細・明るい赤の縦線 */
    function drawTimelineVideoEndMarkerLine(ctx, layoutW, hCss, drawOpt) {
        const videoEndSec = getVideoTimelineEndSecForWaveform();
        if (!videoEndSec || videoEndSec <= 0 || !layoutW || !hCss) return;
        const x = masterTimelineContentWidth(layoutW, videoEndSec);
        const o = drawOpt && typeof drawOpt === 'object' ? drawOpt : {};
        const xOff = Number.isFinite(o.timelineXOffset) ? o.timelineXOffset : 0;
        const canvasW = Number.isFinite(o.timelineCanvasW) ? o.timelineCanvasW : layoutW;
        if (x < xOff - 0.5 || x > xOff + canvasW + 0.5) return;
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

    /** レーン全面の下地（濃いグレー・単色） */
    const TIMELINE_LANE_TRACK_BG = '#161820';

    /** timelineWaveformFillGradient の可聴/非可聴中心色から算出（リージョン UI の opacity に使用） */
    const TIMELINE_MIX_REGION_CHROME_OPACITY_INAUDIBLE = (() => {
        function lum(r, g, b) {
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
        const audible = lum(220, 235, 255) * 0.9;
        const inaudible = lum(68, 74, 84) * 0.96;
        if (!(audible > 0)) return 0.336;
        return Math.max(0.2, Math.min(1, inaudible / audible));
    })();

    function timelineMixRegionChromeOpacity(audible) {
        return audible ? 1 : TIMELINE_MIX_REGION_CHROME_OPACITY_INAUDIBLE;
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

    function applyTransportAtRatio(ratio, opt) {
        const master = getMasterTransportDurationSec();
        if (!master) return;
        const r = Math.max(0, Math.min(1, Number(ratio) || 0));
        const t = r * master;
        applyTransportAtSec(t, Object.assign({ markers: true }, opt || {}));
        if (
            typeof isKeyboardScrubZoomLite === 'function' &&
            isKeyboardScrubZoomLite()
        ) {
            return;
        }
        if (typeof currentTimeEl !== 'undefined' && currentTimeEl) {
            currentTimeEl.textContent = formatTimecodeForTransport(t);
        }
        updateMusicalGridPlayheadDisplay(t);
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
            const contentW =
                typeof masterTimelineWidthCss === 'function' ? masterTimelineWidthCss() : 0;
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
        const inner =
            typeof waveformTimelineInnerEl === 'function' ? waveformTimelineInnerEl() : null;
        if (!canvas || !lanes || !inner) return null;
        const h = lanes.clientHeight;
        if (h < 2) return null;
        if (typeof syncWaveformCanvasElement === 'function') {
            const sized = syncWaveformCanvasElement(canvas, h);
            if (!sized) return null;
            const spec = sized.canvasSpec || {};
            return {
                ctx: sized.ctx,
                w: sized.wCss,
                h: sized.hCss,
                layoutW: spec.contentW || sized.wCss,
                xOffset: spec.mode === 'window' ? spec.canvasLeft || 0 : 0,
            };
        }
        const w =
            typeof masterTimelineWidthCss === 'function' ? masterTimelineWidthCss() : 0;
        if (w < 2) return null;
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
        return { ctx: ctx, w: w, h: h, layoutW: w, xOffset: 0 };
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
        const { ctx, w, h, layoutW, xOffset } = sized;
        ctx.clearRect(0, 0, w, h);
        if (!seekTrailSamples.length) return;

        const now = performance.now();
        pruneSeekTrailSamplesByAge(now);
        if (seekTrailSamples.length < 2) return;

        const master = getMasterTransportDurationSec();
        if (!(master > 0)) return;

        ctx.save();
        if (xOffset) ctx.translate(-xOffset, 0);
        const secToX = (sec) => (sec / master) * layoutW;
        const playheadX = secToX(seekTrailSamples[seekTrailSamples.length - 1].sec);
        const trailRightX = playheadX - SEEK_TRAIL_PLAYHEAD_GAP_PX;
        if (trailRightX <= xOffset) {
            ctx.restore();
            return;
        }

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
        ctx.restore();
    }

    window.clearSeekPlaybackTrail = clearSeekPlaybackTrail;
    window.drawSeekPlaybackTrail = drawSeekPlaybackTrail;

    function updateAllWaveformPlayheads(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const keyboardScrub = !!o.keyboardScrub;
        const transportUiFrame = !!o.transportUiFrame;
        if (keyboardScrub && typeof applyTransportScrubPositionImmediate === 'function') {
            const t =
                typeof getTransportSecForDisplay === 'function'
                    ? getTransportSecForDisplay()
                    : typeof getTransportSec === 'function'
                      ? getTransportSec()
                      : transportPlaybackSec;
            applyTransportScrubPositionImmediate(t, {
                deferSeekBar: false,
                centerScroll: true,
            });
            return;
        }
        const lite = o.lightweight || keyboardScrub || transportUiFrame;
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
        if (!lite) {
            recordSeekPlaybackTrail(t);
            drawSeekPlaybackTrail();
        }
        const lanes = waveformScrubTargetEl();
        if (lanes && !keyboardScrub) {
            lanes.setAttribute('aria-valuenow', String(Math.round(pct)));
        }
        const scrollToTransport =
            typeof syncWaveformTimelineScrollToTransport === 'function'
                ? syncWaveformTimelineScrollToTransport
                : typeof centerWaveformTimelineOnTransport === 'function'
                  ? centerWaveformTimelineOnTransport
                  : null;
        if (scrollToTransport) {
            if (transportUiFrame) {
                scrollToTransport({ deferVisualRefresh: true });
            } else if (!lite) {
                const playbackScroll =
                    typeof isTransportPlaying === 'function' && isTransportPlaying();
                scrollToTransport(playbackScroll ? { deferVisualRefresh: true } : undefined);
            } else {
                const wantScrollFollow =
                    !!o.timelineScroll ||
                    (keyboardScrub &&
                        typeof isWaveformTimelineAtFitZoom === 'function' &&
                        !isWaveformTimelineAtFitZoom());
                if (wantScrollFollow) {
                    scrollToTransport({ deferVisualRefresh: true });
                }
            }
        }
    }

    function anyExtraTrackLoadedForTimeline() {
        const loadFn =
            typeof window.isExtraTrackLoaded === 'function'
                ? window.isExtraTrackLoaded
                : typeof isExtraTrackLoaded === 'function'
                  ? isExtraTrackLoaded
                  : null;
        if (!loadFn) return false;
        const n = getExtraTrackCount();
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

    function resolveTimelineLayoutW(wCss, drawOpt) {
        const o = drawOpt && typeof drawOpt === 'object' ? drawOpt : {};
        return Number.isFinite(o.timelineLayoutW) && o.timelineLayoutW > 0
            ? o.timelineLayoutW
            : wCss;
    }

    function getViewportPeakDrawRange(viewportPeaks, layoutW, contentDurSec, drawOpt) {
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
        const x0 = (t0 / master) * layoutW;
        const x1 = (t1 / master) * layoutW;
        if (!(x1 > x0 + 0.5)) return null;
        return { x0, x1 };
    }

    function drawPeaksBarsInRange(ctx, peaks, x0, drawW, hCss, fillStyle, skipX0, skipX1) {
        if (!peaks || peaks.length === 0 || !(drawW > 0)) return;
        const mid = hCss * 0.5;
        const barW = drawW / peaks.length;
        const vScale =
            typeof getWaveformVerticalZoom === 'function' ? getWaveformVerticalZoom() : 1;
        const scale = Number.isFinite(vScale) ? vScale : 1;
        const hasSkip =
            Number.isFinite(skipX0) && Number.isFinite(skipX1) && skipX1 > skipX0 + 0.5;
        ctx.fillStyle = fillStyle || '#ffffff';
        for (let i = 0; i < peaks.length; i++) {
            const p = peaks[i];
            const x = x0 + i * barW;
            const w = Math.max(1, barW + 0.5);
            if (hasSkip && x + w > skipX0 && x < skipX1) continue;
            const top = mid - Math.max(0.5, p.max * scale * (mid - 2));
            const bot = mid - Math.min(-0.5, p.min * scale * (mid - 2));
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
        const layoutW = resolveTimelineLayoutW(wCss, drawOpt);
        const range = getViewportPeakDrawRange(viewportPeaks, layoutW, contentDurSec, drawOpt);
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

    function drawViewportPeakTileOverlays(
        ctx,
        viewportPeaks,
        layoutW,
        hCss,
        contentDurSec,
        fillStyle,
        drawOpt,
    ) {
        const tiles = viewportPeaks && viewportPeaks.tiles;
        if (!tiles || !tiles.length) return;
        for (let i = 0; i < tiles.length; i++) {
            const tile = tiles[i];
            if (!tile.peaks || !tile.peaks.length) continue;
            drawViewportPeaksOnTimeline(
                ctx,
                {
                    peaks: tile.peaks,
                    masterStartSec: tile.masterStartSec,
                    masterEndSec: tile.masterEndSec,
                },
                layoutW,
                hCss,
                contentDurSec,
                fillStyle,
                drawOpt,
            );
        }
    }

    function drawPeaksForMasterTimeline(ctx, peaks, wCss, hCss, contentDurSec, fillStyle, drawOpt) {
        const o = drawOpt && typeof drawOpt === 'object' ? drawOpt : {};
        const layoutW = resolveTimelineLayoutW(wCss, o);
        const xOffset = Number.isFinite(o.timelineXOffset) ? o.timelineXOffset : 0;
        const mid = hCss * 0.5;
        const atFitZoom =
            typeof isWaveformTimelineAtFitZoom === 'function' &&
            isWaveformTimelineAtFitZoom();
        const useTiles =
            !atFitZoom &&
            !!(o.viewportPeaks && o.viewportPeaks.tiles && o.viewportPeaks.tiles.length);
        ctx.clearRect(0, 0, wCss, hCss);
        ctx.fillStyle = TIMELINE_LANE_TRACK_BG;
        ctx.fillRect(0, 0, wCss, hCss);

        ctx.save();
        if (xOffset) ctx.translate(-xOffset, 0);

        const timelineStartSec =
            Number.isFinite(o.timelineStartSec) && o.timelineStartSec > 0 ? o.timelineStartSec : 0;
        const startX = masterTimelineContentWidth(layoutW, timelineStartSec);
        const vpRange =
            !useTiles && o.viewportPeaks
                ? getViewportPeakDrawRange(o.viewportPeaks, layoutW, contentDurSec, o)
                : null;

        if (!peaks || peaks.length === 0) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(xOffset, mid);
            ctx.lineTo(xOffset + wCss, mid);
            ctx.stroke();
            drawTimelineVideoEndMarkerLine(ctx, layoutW, hCss, o);
            if (vpRange) {
                drawPeaksBarsInRange(
                    ctx,
                    o.viewportPeaks.peaks,
                    vpRange.x0,
                    vpRange.x1 - vpRange.x0,
                    hCss,
                    fillStyle,
                );
            }
            if (useTiles) {
                drawViewportPeakTileOverlays(
                    ctx,
                    o.viewportPeaks,
                    layoutW,
                    hCss,
                    contentDurSec,
                    fillStyle,
                    o,
                );
            }
            ctx.restore();
            return;
        }

        const contentW = masterTimelineContentWidth(layoutW, contentDurSec);
        const drawW = contentW > 0 ? contentW : layoutW;
        drawPeaksBarsInRange(
            ctx,
            peaks,
            startX,
            drawW,
            hCss,
            fillStyle,
            useTiles || !vpRange ? null : vpRange.x0,
            useTiles || !vpRange ? null : vpRange.x1,
        );

        if (useTiles) {
            drawViewportPeakTileOverlays(
                ctx,
                o.viewportPeaks,
                layoutW,
                hCss,
                contentDurSec,
                fillStyle,
                o,
            );
        } else if (vpRange) {
            drawPeaksBarsInRange(
                ctx,
                o.viewportPeaks.peaks,
                vpRange.x0,
                vpRange.x1 - vpRange.x0,
                hCss,
                fillStyle,
            );
        }

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xOffset, mid);
        ctx.lineTo(xOffset + wCss, mid);
        ctx.stroke();

        drawTimelineVideoEndMarkerLine(ctx, layoutW, hCss, o);
        ctx.restore();
    }

    window.drawPeaksBarsInRange = drawPeaksBarsInRange;
    window.drawViewportPeaksOnTimeline = drawViewportPeaksOnTimeline;

    function setLaneContentEndMarker(el, _contentDurSec) {
        if (!el) return;
        el.hidden = true;
    }

    function updateLaneContentEndMarkers() {
        setLaneContentEndMarker(document.getElementById('audioWaveformContentEnd'), 0);
        const extraCount = getExtraTrackCount();
        for (let i = 0; i < extraCount; i++) {
            setLaneContentEndMarker(document.getElementById('extraAudioContentEnd' + i), 0);
        }
    }
