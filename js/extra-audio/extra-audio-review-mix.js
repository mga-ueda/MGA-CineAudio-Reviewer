/**
 * extra-audio-review-mix.js — Review mix WebAudio routing
 */
    function videoAnalyzerDiag(stage, detail) {
        if (typeof window.videoAnalyzerDiagLog !== 'function') return;
        if (stage === 'monitor/skip') {
            const reason = detail && detail.reason;
            const snap = detail && detail.snap;
            if (
                reason === 'cannot-bind' &&
                snap &&
                (!snap.videoReady || !snap.url)
            ) {
                return;
            }
        }
        if (
            stage === 'monitor/connected' &&
            detail &&
            !detail.forceRecapture &&
            detail.snap &&
            detail.snap.monitorSrc
        ) {
            if (typeof window.videoAnalyzerDiagShouldLogConnected === 'function') {
                if (!window.videoAnalyzerDiagShouldLogConnected(detail)) return;
            }
        }
        window.videoAnalyzerDiagLog(stage, detail);
    }

    function markReviewMixVideoMonitorPlayPrimed() {
        reviewMixVideoMonitorTapPrimedUrl = urlMain || '';
        videoAnalyzerDiag('monitor/primed', { url: reviewMixVideoMonitorTapPrimedUrl });
    }

    function needsReviewMixVideoMonitorPlayRecapture() {
        if (!urlMain || !videoMain) return false;
        if (reviewMixVideoWired || reviewMixVideoBoostPlayback) return false;
        if (shouldPlayVideoAudioViaWebAudio() || shouldPlayVideoAudioViaCaptureBoost()) {
            return false;
        }
        if (containerHasAudio.main === false) return false;
        return reviewMixVideoMonitorTapPrimedUrl !== urlMain;
    }

    function getVideoMonitorTapDiagSnapshot() {
        const snap = {
            url: urlMain || '',
            primedUrl: reviewMixVideoMonitorTapPrimedUrl || '',
            containerHasAudio: containerHasAudio.main,
            wired: !!reviewMixVideoWired,
            boost: !!reviewMixVideoBoostPlayback,
            monitorSrc: !!videoMonitorStreamSrc,
            native: isVideoAudioPlaybackViaNativeElement(),
            videoReady: typeof videoReady === 'function' ? videoReady() : false,
            rs: videoMain ? videoMain.readyState : null,
            paused: videoMain ? videoMain.paused : null,
            t: videoMain ? videoMain.currentTime : null,
            muted: videoMain ? videoMain.muted : null,
            vol: videoMain ? videoMain.volume : null,
            retryCount: reviewMixVideoMonitorTapRetryCount,
        };
        if (typeof window.isDebugLogEnabled !== 'function' || !window.isDebugLogEnabled()) {
            return snap;
        }
        if (videoMonitorStream) {
            snap.captureAudioTracks = videoMonitorStream.getAudioTracks().length;
            snap.captureProbeOk = snap.captureAudioTracks > 0;
            return snap;
        }
        try {
            const fn = getVideoCaptureStreamFn();
            if (fn && videoMain) {
                const s = fn();
                if (s) {
                    snap.captureAudioTracks = s.getAudioTracks().length;
                    snap.captureProbeOk = snap.captureAudioTracks > 0;
                    for (const track of s.getTracks()) {
                        track.stop();
                    }
                }
            }
        } catch (_) {}
        return snap;
    }
    function getVideoTransportDurationSecForMix() {
        if (typeof getVideoPlaybackEndSec === 'function') {
            return getVideoPlaybackEndSec();
        }
        if (typeof getVideoTransportDurationSec === 'function') {
            return getVideoTransportDurationSec();
        }
        return typeof getDuration === 'function' ? getDuration(videoMain) : 0;
    }

    function isVideoMixOutputActive() {
        if (!isVideoAudioAudible()) return false;
        if (
            videoMain &&
            isTransportPlayingForExtra() &&
            typeof transportPlaybackIsInMasterTail === 'function' &&
            transportPlaybackIsInMasterTail()
        ) {
            return false;
        }
        const vd = getVideoTransportDurationSecForMix();
        if (vd <= 0) return true;
        const t = getMasterTransportSecForAudioSync();
        if (Number.isFinite(t) && t < vd - 0.001) return true;
        if (videoMain && typeof videoReady === 'function' && videoReady()) {
            const vt = videoMain.currentTime || 0;
            if (Number.isFinite(vt) && vt < vd - 0.05) return true;
        }
        return false;
    }

    function useReviewMixVideoWebAudioRouting() {
        return ROUTE_VIDEO_AUDIO_VIA_WEB_AUDIO && !reviewMixVideoWireFailed;
    }

    function videoMixNeedsWebAudioBoost() {
        if (!isVideoAudioAudible()) return false;
        return laneGainLinear(videoMix.volLinear) > 1.0001;
    }

    /** ROUTE_VIDEO_AUDIO_VIA_WEB_AUDIO 時のみ MediaElementSource 経由。 */
    function shouldPlayVideoAudioViaWebAudio() {
        if (reviewMixVideoWireFailed) return false;
        if (!videoMediaSrc) return useReviewMixVideoWebAudioRouting();
        return useReviewMixVideoWebAudioRouting() || reviewMixVideoWired;
    }

    function clearStaleReviewMixVideoWiredFlag() {
        if (reviewMixVideoWired && !videoMediaSrc) {
            reviewMixVideoWired = false;
        }
    }

    /** 0 dB 超のブースト（captureStream → master、要素のネイティブ出力は止める）。 */
    function shouldPlayVideoAudioViaCaptureBoost() {
        if (reviewMixVideoWireFailed || useReviewMixVideoWebAudioRouting()) return false;
        return videoMixNeedsWebAudioBoost();
    }

    /** 動画音声が video 要素のスピーカー直出力（Web Audio 未接続時のみ）。 */
    function isVideoAudioPlaybackViaNativeElement() {
        return !reviewMixVideoWired && !reviewMixVideoBoostPlayback;
    }

    function getVideoCaptureStreamFn() {
        if (!videoMain) return null;
        if (typeof videoMain.captureStream === 'function') {
            return videoMain.captureStream.bind(videoMain);
        }
        if (typeof videoMain.mozCaptureStream === 'function') {
            return videoMain.mozCaptureStream.bind(videoMain);
        }
        return null;
    }

    /**
     * MES 経由時は video.muted=true だと無音になる実装がある。
     * ブースト時は capture 用に muted=false・volume=0（スピーカーは Web Audio のみ）。
     * ネイティブ時は video.volume（最大 1.0 = 0 dB）でミックスする。
     */
    function syncVideoElementOutputForReviewMix() {
        if (!videoMain) return;
        if (reviewMixVideoWired || reviewMixVideoBoostPlayback) {
            videoMain.muted = false;
            videoMain.volume = 0;
            return;
        }
        const g =
            isVideoMixOutputActive() && isVideoAudioAudible()
                ? laneGainLinear(videoMix.volLinear)
                : 0;
        if (g > 0) {
            videoMain.muted = false;
            videoMain.volume = Math.min(1, g);
            return;
        }
        videoMain.volume = 0;
        videoMain.muted = true;
    }

    function applyNativeVideoElementMix() {
        releaseReviewMixVideoBoostPlayback();
        if (videoMediaSrc) {
            releaseReviewMixVideoWebAudioTap({ resetElement: true });
        } else if (reviewMixVideoWired) {
            reviewMixVideoWired = false;
            reviewMixVideoWireFailed = false;
        }
        syncVideoElementOutputForReviewMix();
        applyReviewMixVideoMonitorTapGain();
        if (!nativeVideoMixModeLogged) {
            nativeVideoMixModeLogged = true;
            writeLog('Review mix: video audio via element (native output)');
        }
    }

    function ensureReviewMixMasterBus(ctx) {
        if (!ctx) return null;
        if (!reviewMixMaster) {
            reviewMixMaster = ctx.createGain();
            reviewMixMaster.gain.value = 1;
        }
        if (typeof ensureReviewMixMonitorOutput === 'function') {
            ensureReviewMixMonitorOutput(ctx, reviewMixMaster);
        } else {
            try {
                reviewMixMaster.disconnect(ctx.destination);
            } catch (_) {}
            reviewMixMaster.connect(ctx.destination);
        }
        return reviewMixMaster;
    }

    /** Route video element audio through the same AudioContext as extra tracks. */
    function ensureReviewMixVideoRouting() {
        if (!shouldPlayVideoAudioViaWebAudio() || !videoMain) return false;
        const ctx = ensureReviewMixCtx();
        if (!ctx) return false;
        const master = ensureReviewMixMasterBus(ctx);
        if (!master) return false;
        if (!videoGainNode) {
            videoGainNode = ctx.createGain();
        }
        const vMeter = ensureVideoTrackAnalyser(ctx);
        try {
            videoGainNode.disconnect();
        } catch (_) {}
        try {
            if (vMeter) vMeter.disconnect();
        } catch (_) {}
        if (vMeter) {
            videoGainNode.connect(vMeter);
            vMeter.connect(master);
        } else {
            videoGainNode.connect(master);
        }
        if (!videoMediaSrc) {
            if (!canBindReviewMixVideoMediaSource()) {
                return false;
            }
            try {
                videoMediaSrc = ctx.createMediaElementSource(videoMain);
                videoMediaSrc.connect(videoGainNode);
                reviewMixVideoWired = true;
                syncVideoElementOutputForReviewMix();
                writeLog('Review mix: video audio routed via Web Audio');
            } catch (err) {
                reviewMixVideoWireFailed = true;
                reviewMixVideoWired = false;
                writeLog(
                    'Review mix: video Web Audio routing unavailable — ' +
                        (err && err.message ? err.message : String(err)),
                );
                syncVideoElementOutputForReviewMix();
                return false;
            }
        }
        if (reviewMixVideoWired) {
            syncVideoElementOutputForReviewMix();
        }
        return reviewMixVideoWired;
    }

    function stopVideoMonitorStreamTracks() {
        if (!videoMonitorStream) return;
        try {
            for (const track of videoMonitorStream.getTracks()) {
                track.stop();
            }
        } catch (_) {}
    }

    const REVIEW_MIX_VIDEO_MONITOR_TAP_RETRY_MAX = 16;
    const REVIEW_MIX_VIDEO_MONITOR_TAP_RETRY_MS = 200;

    function stopReviewMixVideoMonitorTapRetryOnly() {
        if (reviewMixVideoMonitorTapRetryTimer) {
            clearTimeout(reviewMixVideoMonitorTapRetryTimer);
            reviewMixVideoMonitorTapRetryTimer = 0;
        }
        reviewMixVideoMonitorTapRetryCount = 0;
        reviewMixVideoMonitorTapMediaRetryArmed = false;
    }

    function resetReviewMixVideoMonitorTapSession() {
        stopReviewMixVideoMonitorTapRetryOnly();
        reviewMixVideoMonitorTapPrimedUrl = '';
    }

    function cancelReviewMixVideoMonitorTapRetry() {
        stopReviewMixVideoMonitorTapRetryOnly();
    }

    function shouldRetryReviewMixVideoMonitorTap() {
        if (videoMonitorStreamSrc) return false;
        if (shouldPlayVideoAudioViaWebAudio() || shouldPlayVideoAudioViaCaptureBoost()) {
            return false;
        }
        if (containerHasAudio.main === false) return false;
        if (!videoMain || !urlMain) return false;
        if (typeof canBindReviewMixVideoMediaSource === 'function' && !canBindReviewMixVideoMediaSource()) {
            return false;
        }
        return true;
    }

    function armReviewMixVideoMonitorTapMediaRetry() {
        if (!shouldRetryReviewMixVideoMonitorTap() || reviewMixVideoMonitorTapMediaRetryArmed) {
            return;
        }
        reviewMixVideoMonitorTapMediaRetryArmed = true;
        const onMediaReady = () => {
            if (!videoMain) return;
            videoMain.removeEventListener('canplay', onMediaReady);
            videoMain.removeEventListener('loadeddata', onMediaReady);
            videoMain.removeEventListener('seeked', onMediaReady);
            if (!shouldRetryReviewMixVideoMonitorTap()) return;
            applyReviewMixVideoGain();
            if (videoMonitorStreamSrc) {
                reviewMixVideoMonitorTapMediaRetryArmed = false;
            }
        };
        videoMain.addEventListener('canplay', onMediaReady, { once: true });
        videoMain.addEventListener('loadeddata', onMediaReady, { once: true });
        videoMain.addEventListener('seeked', onMediaReady, { once: true });
    }

    function scheduleReviewMixVideoMonitorTapRetry() {
        if (!shouldRetryReviewMixVideoMonitorTap()) return;
        armReviewMixVideoMonitorTapMediaRetry();
        if (reviewMixVideoMonitorTapRetryTimer) return;
        if (reviewMixVideoMonitorTapRetryCount >= REVIEW_MIX_VIDEO_MONITOR_TAP_RETRY_MAX) {
            return;
        }
        const attempt = () => {
            reviewMixVideoMonitorTapRetryTimer = 0;
            if (!shouldRetryReviewMixVideoMonitorTap()) return;
            reviewMixVideoMonitorTapRetryCount += 1;
            applyReviewMixVideoGain();
            if (videoMonitorStreamSrc) {
                stopReviewMixVideoMonitorTapRetryOnly();
                return;
            }
            if (reviewMixVideoMonitorTapRetryCount < REVIEW_MIX_VIDEO_MONITOR_TAP_RETRY_MAX) {
                reviewMixVideoMonitorTapRetryTimer = setTimeout(
                    attempt,
                    REVIEW_MIX_VIDEO_MONITOR_TAP_RETRY_MS,
                );
            }
        };
        reviewMixVideoMonitorTapRetryTimer = setTimeout(
            attempt,
            REVIEW_MIX_VIDEO_MONITOR_TAP_RETRY_MS,
        );
    }

    function markReviewMixVideoMonitorTapStale() {
        reviewMixVideoMonitorTapStale = true;
    }

    function consumeReviewMixVideoMonitorTapStale() {
        const stale = reviewMixVideoMonitorTapStale;
        reviewMixVideoMonitorTapStale = false;
        return stale;
    }

    function releaseReviewMixVideoCaptureGraph() {
        resetReviewMixVideoMonitorTapSession();
        reviewMixVideoBoostPlayback = false;
        if (videoMonitorStreamSrc) {
            try {
                videoMonitorStreamSrc.disconnect();
            } catch (_) {}
            videoMonitorStreamSrc = null;
        }
        stopVideoMonitorStreamTracks();
        videoMonitorStream = null;
        if (videoMonitorSinkGain) {
            try {
                videoMonitorSinkGain.disconnect();
            } catch (_) {}
        }
        if (videoGainNode) {
            try {
                videoGainNode.disconnect();
            } catch (_) {}
        }
        if (videoAnalyser) {
            try {
                videoAnalyser.disconnect();
            } catch (_) {}
        }
    }

    function releaseReviewMixVideoBoostPlayback() {
        if (!reviewMixVideoBoostPlayback) return;
        releaseReviewMixVideoCaptureGraph();
    }

    function releaseReviewMixVideoMonitorTap() {
        releaseReviewMixVideoCaptureGraph();
    }

    function applyReviewMixVideoCapturePlaybackGain() {
        if (!videoGainNode || !videoMonitorStreamSrc) return;
        const g = getVideoTrackEffectiveGain();
        const ctx = ensureReviewMixCtx();
        try {
            if (ctx && ctx.state === 'running') {
                videoGainNode.gain.setTargetAtTime(g, ctx.currentTime, 0.02);
            } else {
                videoGainNode.gain.value = g;
            }
        } catch (_) {
            videoGainNode.gain.value = g;
        }
        if (ctx && ctx.state === 'suspended') {
            void ctx.resume().catch(() => {});
        }
    }

    function applyReviewMixVideoMonitorTapGain() {
        if (!videoGainNode || !videoMonitorStreamSrc) return;
        const g = getVideoMonitorTapGainLinear();
        const ctx = ensureReviewMixCtx();
        try {
            if (ctx && ctx.state === 'running') {
                videoGainNode.gain.setTargetAtTime(g, ctx.currentTime, 0.02);
            } else {
                videoGainNode.gain.value = g;
            }
        } catch (_) {
            videoGainNode.gain.value = g;
        }
    }

    /**
     * ネイティブ再生のまま captureStream でアナライザーへタップ（スピーカー二重出力なし）。
     * Analyser は destination へ gain=0 で接続しないとグラフが進まないブラウザがある。
     */
    function ensureReviewMixVideoMonitorTap(opt) {
        const forceRecapture = !!(opt && opt.forceRecapture);
        if (
            !videoMain ||
            shouldPlayVideoAudioViaWebAudio() ||
            shouldPlayVideoAudioViaCaptureBoost()
        ) {
            videoAnalyzerDiag('monitor/skip', {
                reason: !videoMain
                    ? 'no-video'
                    : shouldPlayVideoAudioViaWebAudio()
                      ? 'web-audio-route'
                      : 'capture-boost',
                forceRecapture,
                snap: getVideoMonitorTapDiagSnapshot(),
            });
            return false;
        }
        if (containerHasAudio.main === false) {
            releaseReviewMixVideoCaptureGraph();
            videoAnalyzerDiag('monitor/skip', {
                reason: 'container-no-audio',
                forceRecapture,
                snap: getVideoMonitorTapDiagSnapshot(),
            });
            return false;
        }
        if (typeof canBindReviewMixVideoMediaSource === 'function' && !canBindReviewMixVideoMediaSource()) {
            videoAnalyzerDiag('monitor/skip', {
                reason: 'cannot-bind',
                forceRecapture,
                snap: getVideoMonitorTapDiagSnapshot(),
            });
            return false;
        }
        const captureFn = getVideoCaptureStreamFn();
        if (!captureFn) {
            videoAnalyzerDiag('monitor/skip', {
                reason: 'no-capture-fn',
                forceRecapture,
                snap: getVideoMonitorTapDiagSnapshot(),
            });
            return false;
        }
        const ctx = ensureReviewMixCtx();
        if (!ctx) {
            videoAnalyzerDiag('monitor/skip', {
                reason: 'no-audio-ctx',
                forceRecapture,
                snap: getVideoMonitorTapDiagSnapshot(),
            });
            return false;
        }
        if (!videoGainNode) videoGainNode = ctx.createGain();
        if (!videoMonitorSinkGain) {
            videoMonitorSinkGain = ctx.createGain();
            videoMonitorSinkGain.gain.value = 0;
        }
        const vMeter = ensureVideoTrackAnalyser(ctx);
        try {
            if (videoMonitorStreamSrc && forceRecapture) {
                videoAnalyzerDiag('monitor/recapture', getVideoMonitorTapDiagSnapshot());
                try {
                    videoMonitorStreamSrc.disconnect();
                } catch (_) {}
                videoMonitorStreamSrc = null;
                stopVideoMonitorStreamTracks();
                videoMonitorStream = null;
            }
            if (!videoMonitorStreamSrc) {
                videoMonitorStream = captureFn();
                const trackCount = videoMonitorStream
                    ? videoMonitorStream.getAudioTracks().length
                    : 0;
                if (!videoMonitorStream || !trackCount) {
                    stopVideoMonitorStreamTracks();
                    videoMonitorStream = null;
                    videoAnalyzerDiag('monitor/no-audio-tracks', {
                        forceRecapture,
                        trackCount,
                        snap: getVideoMonitorTapDiagSnapshot(),
                    });
                    scheduleReviewMixVideoMonitorTapRetry();
                    return false;
                }
                videoMonitorStreamSrc = ctx.createMediaStreamSource(videoMonitorStream);
            }
            try {
                videoMonitorStreamSrc.disconnect();
            } catch (_) {}
            try {
                videoGainNode.disconnect();
            } catch (_) {}
            try {
                if (vMeter) vMeter.disconnect();
            } catch (_) {}
            try {
                videoMonitorSinkGain.disconnect();
            } catch (_) {}
            videoMonitorStreamSrc.connect(videoGainNode);
            if (vMeter) {
                videoGainNode.connect(vMeter);
                vMeter.connect(videoMonitorSinkGain);
                videoMonitorSinkGain.connect(ctx.destination);
            } else {
                videoGainNode.connect(videoMonitorSinkGain);
                videoMonitorSinkGain.connect(ctx.destination);
            }
            reviewMixVideoBoostPlayback = false;
            stopReviewMixVideoMonitorTapRetryOnly();
            applyReviewMixVideoMonitorTapGain();
            if (forceRecapture) {
                markReviewMixVideoMonitorPlayPrimed();
            }
            videoAnalyzerDiag('monitor/connected', {
                forceRecapture,
                tapGain: getVideoMonitorTapGainLinear(),
                ctxState: ctx.state,
                snap: getVideoMonitorTapDiagSnapshot(),
            });
            return true;
        } catch (err) {
            releaseReviewMixVideoCaptureGraph();
            writeLog(
                'Review mix: video monitor tap unavailable — ' +
                    (err && err.message ? err.message : String(err)),
            );
            videoAnalyzerDiag('monitor/error', {
                forceRecapture,
                err: err && err.message ? err.message : String(err),
                snap: getVideoMonitorTapDiagSnapshot(),
            });
            return false;
        }
    }

    /**
     * 0 dB 超: captureStream を master へ（MediaElementSource は無音になりやすいため使わない）。
     */
    function ensureReviewMixVideoBoostPlayback(opt) {
        if (!videoMain || !shouldPlayVideoAudioViaCaptureBoost()) {
            return false;
        }
        if (containerHasAudio.main === false) {
            releaseReviewMixVideoBoostPlayback();
            return false;
        }
        if (typeof canBindReviewMixVideoMediaSource === 'function' && !canBindReviewMixVideoMediaSource()) {
            return false;
        }
        const captureFn = getVideoCaptureStreamFn();
        if (!captureFn) return false;
        const ctx = ensureReviewMixCtx();
        if (!ctx) return false;
        const master = ensureReviewMixMasterBus(ctx);
        if (!master) return false;
        if (!videoGainNode) videoGainNode = ctx.createGain();
        const vMeter = ensureVideoTrackAnalyser(ctx);
        const forceRecapture = !!(opt && opt.forceRecapture);
        try {
            if (videoMonitorStreamSrc && forceRecapture) {
                try {
                    videoMonitorStreamSrc.disconnect();
                } catch (_) {}
                videoMonitorStreamSrc = null;
                stopVideoMonitorStreamTracks();
                videoMonitorStream = null;
            }
            if (!videoMonitorStreamSrc) {
                videoMonitorStream = captureFn();
                if (!videoMonitorStream || !videoMonitorStream.getAudioTracks().length) {
                    stopVideoMonitorStreamTracks();
                    videoMonitorStream = null;
                    return false;
                }
                videoMonitorStreamSrc = ctx.createMediaStreamSource(videoMonitorStream);
            }
            try {
                videoMonitorStreamSrc.disconnect();
            } catch (_) {}
            try {
                videoGainNode.disconnect();
            } catch (_) {}
            try {
                if (vMeter) vMeter.disconnect();
            } catch (_) {}
            try {
                if (videoMonitorSinkGain) videoMonitorSinkGain.disconnect();
            } catch (_) {}
            videoMonitorStreamSrc.connect(videoGainNode);
            if (vMeter) {
                videoGainNode.connect(vMeter);
                vMeter.connect(master);
            } else {
                videoGainNode.connect(master);
            }
            reviewMixVideoBoostPlayback = true;
            syncVideoElementOutputForReviewMix();
            applyReviewMixVideoCapturePlaybackGain();
            if (!reviewMixVideoBoostLogged) {
                reviewMixVideoBoostLogged = true;
                writeLog('Review mix: video boost via captureStream → master');
            }
            return true;
        } catch (err) {
            releaseReviewMixVideoBoostPlayback();
            writeLog(
                'Review mix: video capture boost unavailable — ' +
                    (err && err.message ? err.message : String(err)),
            );
            return false;
        }
    }

    function applyReviewMixVideoGain(opt) {
        if (!videoMain) {
            return;
        }
        clearStaleReviewMixVideoWiredFlag();

        if (!ROUTE_VIDEO_AUDIO_VIA_WEB_AUDIO && videoMediaSrc) {
            releaseReviewMixVideoWebAudioTap({ resetElement: true });
            reviewMixVideoWired = false;
            reviewMixVideoWireFailed = false;
        }
        const forceRecapture = !!(opt && opt.forceRecapture);
        if (forceRecapture) {
            videoAnalyzerDiag('gain/apply', {
                forceRecapture,
                snap: getVideoMonitorTapDiagSnapshot(),
            });
        }

        if (shouldPlayVideoAudioViaCaptureBoost()) {
            if (ensureReviewMixVideoBoostPlayback({ forceRecapture })) {
                return;
            }
            writeLog('Review mix: video boost unavailable — output limited to 0 dB');
            releaseReviewMixVideoBoostPlayback();
        } else {
            releaseReviewMixVideoBoostPlayback();
        }

        if (shouldPlayVideoAudioViaWebAudio()) {
            releaseReviewMixVideoCaptureGraph();
            if (ensureReviewMixVideoRouting()) {
                syncVideoElementOutputForReviewMix();
                if (videoGainNode) {
                    const g = getVideoTrackEffectiveGain();
                    const ctx = ensureReviewMixCtx();
                    try {
                        if (ctx && ctx.state === 'running') {
                            videoGainNode.gain.setTargetAtTime(g, ctx.currentTime, 0.02);
                        } else {
                            videoGainNode.gain.value = g;
                        }
                    } catch (_) {
                        videoGainNode.gain.value = g;
                    }
                }
                return;
            }
            writeLog('Review mix: video Web Audio (MES) routing unavailable');
        }

        applyNativeVideoElementMix();
        ensureReviewMixVideoMonitorTap({ forceRecapture });
        applyReviewMixVideoMonitorTapGain();
    }

    /** メタデータ準備後: Web Audio ルートまたはモニタータップを接続。 */
    function tryWireReviewMixVideoAudioWhenReady() {
        if (!videoMain || reviewMixVideoWireFailed) return false;
        if (typeof canBindReviewMixVideoMediaSource === 'function' && !canBindReviewMixVideoMediaSource()) {
            return false;
        }
        applyReviewMixVideoGain();
        if (reviewMixVideoWired || reviewMixVideoBoostPlayback) return true;
        return !!videoMonitorStreamSrc;
    }

    function applyVideoMixToElement() {
        applyReviewMixVideoGain();
    }

    function refreshReviewMixUi() {
        const videoReadyNow = typeof videoReady === 'function' && videoReady();
        const videoLaneShown =
            typeof isVideoAudioLaneShown === 'function' && isVideoAudioLaneShown();
        if (videoAudioSoloBtn) {
            videoAudioSoloBtn.disabled = !videoReadyNow || !videoLaneShown;
            setMixBtnState(videoAudioSoloBtn, videoMix.solo);
        }
        if (videoAudioMuteBtn) {
            videoAudioMuteBtn.disabled = !videoReadyNow || !videoLaneShown;
            setMixBtnState(videoAudioMuteBtn, videoMix.muted);
        }
        const videoAudioClearBtn = document.getElementById('videoAudioClearBtn');
        if (videoAudioClearBtn) {
            videoAudioClearBtn.disabled = true;
        }
        applyAllTrackLaneGains();
        applyVideoMixToElement();
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) refreshExtraTrackUi(i);
        if (typeof refreshTrackLaneControlsUi === 'function') refreshTrackLaneControlsUi();
        if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
    }

    function getMixPersistSnapshot() {
        const extra = [];
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const tr = extraTrackBySlot(i);
            if (!tr || !tr.buffer) continue;
            extra.push({
                slot: i,
                muted: !!tr.muted,
                solo: !!tr.solo,
                vol: tr.volLinear,
            });
        }
        return {
            video: {
                muted: !!videoMix.muted,
                solo: !!videoMix.solo,
                vol: videoMix.volLinear,
            },
            extra,
        };
    }

    function beginVideoExportAudioFilter(opts) {
        const count =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : EXTRA_TRACK_COUNT;
        const includeExtra = [];
        for (let i = 0; i < count; i++) {
            includeExtra.push(
                !!(opts && Array.isArray(opts.includeExtra) && opts.includeExtra[i]),
            );
        }
        videoExportAudioInclude = {
            includeVideo: !!(opts && opts.includeVideo),
            includeExtra,
        };
        applyAllTrackLaneGains();
    }

    function endVideoExportAudioFilter() {
        videoExportAudioInclude = null;
        applyAllTrackLaneGains();
    }

    function setSessionMixRestore(mix) {
        sessionMixRestore = mix && typeof mix === 'object' ? mix : null;
    }

    function applyVideoMixFromSessionRestore() {
        if (
            !sessionMixRestore ||
            !sessionMixRestore.video ||
            typeof videoReady !== 'function' ||
            !videoReady()
        ) {
            return false;
        }
        videoMix.muted = !!sessionMixRestore.video.muted;
        videoMix.solo = !!sessionMixRestore.video.solo;
        if (typeof sessionMixRestore.video.vol === 'number' && isFinite(sessionMixRestore.video.vol)) {
            videoMix.volLinear = laneGainLinear(sessionMixRestore.video.vol);
        }
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        return true;
    }

    function removeExtraSlotFromSessionMixRestore(slot) {
        if (typeof isSessionRestoreInProgress === 'function' && isSessionRestoreInProgress()) {
            return;
        }
        if (!sessionMixRestore || !Array.isArray(sessionMixRestore.extra)) return;
        sessionMixRestore.extra = sessionMixRestore.extra.filter((e) => !e || e.slot !== slot);
    }

    /** レーン削除時: フェーダーを 0 dB（線形 1）に戻し、復元用ミックス状態からも除外 */
    function resetExtraTrackMixToDefault(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return;
        tr.muted = false;
        tr.solo = false;
        tr.volLinear = 1;
        removeExtraSlotFromSessionMixRestore(slot);
        applyExtraTrackLaneGain(slot);
    }

    function resetVideoTrackMixToDefault() {
        videoMix.muted = false;
        videoMix.solo = false;
        videoMix.volLinear = 1;
        if (
            sessionMixRestore &&
            sessionMixRestore.video &&
            !(typeof isSessionRestoreInProgress === 'function' && isSessionRestoreInProgress())
        ) {
            sessionMixRestore.video = {
                muted: false,
                solo: false,
                vol: 1,
            };
        }
        refreshReviewMixUi();
    }


    function applyExtraSlotMixFromSessionRestore(slot) {
        if (!sessionMixRestore || !Array.isArray(sessionMixRestore.extra)) return;
        const entry = sessionMixRestore.extra.find((e) => e && e.slot === slot);
        if (!entry) return;
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.buffer) return;
        tr.muted = !!entry.muted;
        tr.solo = !!entry.solo;
        if (typeof entry.vol === 'number' && isFinite(entry.vol)) {
            tr.volLinear = laneGainLinear(entry.vol);
        }
        syncExtraTrackLaneMixVisual(slot);
        const ui = getExtraUi(slot);
        if (ui) {
            if (ui.soloBtn) setMixBtnState(ui.soloBtn, !!tr.solo);
            if (ui.muteBtn) setMixBtnState(ui.muteBtn, !!tr.muted);
        }
        refreshReviewMixUi();
        syncExtraAudioToTransport();
    }

    function applyVideoMixFromSessionRestoreIfPending() {
        return applyVideoMixFromSessionRestore();
    }

    function isMixTargetSolo(target) {
        if (!target) return false;
        if (target.kind === 'video') {
            return typeof videoReady === 'function' && videoReady() && videoMix.solo;
        }
        const tr = extraTrackBySlot(target.slot);
        return !!(tr && tr.buffer && tr.solo);
    }

    function clearAllMixSolo() {
        let changed = false;
        if (typeof videoReady === 'function' && videoReady() && videoMix.solo) {
            videoMix.solo = false;
            changed = true;
        }
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            const tr = extraTrackBySlot(slot);
            if (!tr || !tr.buffer || !tr.solo) continue;
            tr.solo = false;
            changed = true;
        }
        if (!changed) return false;
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        return true;
    }

    function applyExclusiveMixSolo(target) {
        if (!target) return false;

        if (typeof videoReady === 'function' && videoReady()) {
            videoMix.solo = target.kind === 'video';
            if (target.kind === 'video') {
                videoMix.muted = false;
            }
        }

        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            const tr = extraTrackBySlot(slot);
            if (!tr || !tr.buffer) continue;
            const isTarget = target.kind === 'extra' && target.slot === slot;
            tr.solo = isTarget;
            if (isTarget) {
                tr.muted = false;
            }
        }

        refreshReviewMixUi();
        syncExtraAudioToTransport();
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        return true;
    }

    function toggleExclusiveMixSolo(target) {
        if (!target) return false;
        if (isMixTargetSolo(target)) {
            return clearAllMixSolo();
        }
        return applyExclusiveMixSolo(target);
    }

    function toggleVideoSolo() {
        if (typeof videoReady !== 'function' || !videoReady()) return;
        const target = { kind: 'video' };
        const wasSolo = isMixTargetSolo(target);
        if (!toggleExclusiveMixSolo(target)) return;
        writeLog('Video audio: ' + (wasSolo ? 'solo off' : 'solo'));
    }

    function toggleVideoMute() {
        if (typeof videoReady !== 'function' || !videoReady()) return;
        videoMix.muted = !videoMix.muted;
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        writeLog('Video audio: ' + (videoMix.muted ? 'muted' : 'unmuted'));
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
    }

    function toggleExtraSolo(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.buffer) return;
        const target = { kind: 'extra', slot: slot };
        const wasSolo = isMixTargetSolo(target);
        if (!toggleExclusiveMixSolo(target)) return;
        writeLog('Extra audio ' + (slot + 1) + ': ' + (wasSolo ? 'solo off' : 'solo'));
    }

    function toggleExtraMute(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.buffer) return;
        tr.muted = !tr.muted;
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        writeLog('Extra audio ' + (slot + 1) + ': ' + (tr.muted ? 'muted' : 'unmuted'));
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
    }

    /** 画面上に表示されているレーンだけ、上から 1〜4 番目（Video は枠表示中なら常に 1 枠目）。 */
    function getVisibleMixLaneTargets() {
        const out = [];
        if (typeof isVideoAudioLaneShown === 'function' && isVideoAudioLaneShown()) {
            out.push({ kind: 'video' });
        }
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            if (isExtraTrackLaneShown(slot)) {
                out.push({ kind: 'extra', slot: slot });
            }
        }
        return out;
    }

    function toggleMixSoloByDisplayIndex(displayIndex) {
        return soloOnlyMixByDisplayIndex(displayIndex);
    }

    function soloOnlyMixByDisplayIndex(displayIndex) {
        const targets = getVisibleMixLaneTargets();
        const t = targets[displayIndex];
        if (!t) return false;
        const wasSolo = isMixTargetSolo(t);
        if (!toggleExclusiveMixSolo(t)) return false;
        const label = t.kind === 'video' ? 'Video' : 'Extra audio ' + (t.slot + 1);
        writeLog('Mix solo' + (wasSolo ? ' off: ' : ': ') + label);
        return true;
    }

    function toggleMixMuteByDisplayIndex(displayIndex) {
        const targets = getVisibleMixLaneTargets();
        const t = targets[displayIndex];
        if (!t) return;
        if (t.kind === 'video') toggleVideoMute();
        else toggleExtraMute(t.slot);
    }

    function clearAllMixMute() {
        let changed = false;
        if (typeof videoReady === 'function' && videoReady() && videoMix.muted) {
            videoMix.muted = false;
            changed = true;
        }
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            const tr = extraTrackBySlot(slot);
            if (!tr || !tr.buffer) continue;
            if (!tr.muted) continue;
            tr.muted = false;
            changed = true;
        }
        if (!changed) return false;
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        writeLog('Mix mute: all tracks unmuted');
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        return true;
    }

    function isMixLaneDbAtUnity(db) {
        return Math.abs(db) <= 0.05;
    }

    function mixLaneVolumeDbAfterStep(currentDb, deltaDb) {
        const atUnity = isMixLaneDbAtUnity(currentDb);
        if (deltaDb > 0) {
            if (!atUnity && currentDb < 0 && currentDb + deltaDb > 0) return 0;
            return currentDb + deltaDb;
        }
        if (!atUnity && currentDb > 0 && currentDb + deltaDb < 0) return 0;
        return currentDb + deltaDb;
    }

    function mixLaneVolumeToastFileName(t) {
        if (!t) return '';
        if (t.kind === 'video') {
            if (typeof nameMain !== 'undefined' && nameMain) {
                const n = String(nameMain.textContent || '').trim();
                if (n && n !== 'Not Loaded') return n;
            }
            return 'Video';
        }
        if (typeof getExtraTrackFileName === 'function' && typeof extraTrackBySlot === 'function') {
            const name = getExtraTrackFileName(extraTrackBySlot(t.slot));
            if (name) return name;
        }
        return 'Ex ' + (t.slot + 1);
    }

    function formatMixLaneVolumeToastDb(db) {
        if (typeof trackLaneFormatDbValue === 'function') {
            return trackLaneFormatDbValue(db) + ' dB';
        }
        const digits = Math.abs(db) >= 10 ? 0 : 1;
        const s = db.toFixed(digits);
        return (db > 0 ? '+' : '') + s + ' dB';
    }

    function flashMixLaneVolumeToast(t, db) {
        if (typeof flashSeekHint !== 'function') return;
        const fileName = mixLaneVolumeToastFileName(t);
        flashSeekHint(fileName, formatMixLaneVolumeToastDb(db), 'notice');
    }

    function resolveActiveMixLaneDisplayIndex(clientX, clientY) {
        const targets = getVisibleMixLaneTargets();
        if (!targets.length) return -1;

        const pointerTarget =
            typeof resolveMixTargetFromPointer === 'function'
                ? resolveMixTargetFromPointer(clientY)
                : null;
        if (pointerTarget) {
            if (pointerTarget.kind === 'video') {
                const vi = targets.findIndex((t) => t.kind === 'video');
                if (vi >= 0) return vi;
            }
            if (pointerTarget.kind === 'extra') {
                const ei = targets.findIndex(
                    (t) => t.kind === 'extra' && t.slot === pointerTarget.slot,
                );
                if (ei >= 0) return ei;
            }
        }

        return -1;
    }

    function handleActiveMixLaneVolumeKeydown(e) {
        const isUp =
            typeof matchMixLaneVolumeUp === 'function' && matchMixLaneVolumeUp(e, { allowRepeat: true });
        const isDown =
            typeof matchMixLaneVolumeDown === 'function' &&
            matchMixLaneVolumeDown(e, { allowRepeat: true });
        if (!isUp && !isDown) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }

        let clientX = null;
        let clientY = null;
        if (typeof getWaveformLanesPointerClientX === 'function') {
            clientX = getWaveformLanesPointerClientX();
        }
        if (typeof getWaveformLanesPointerClientY === 'function') {
            clientY = getWaveformLanesPointerClientY();
        }
        if (clientX == null && typeof getWaveformPointerClientX === 'function') {
            clientX = getWaveformPointerClientX();
        }
        if (clientY == null && typeof getWaveformPointerClientY === 'function') {
            clientY = getWaveformPointerClientY();
        }

        const idx = resolveActiveMixLaneDisplayIndex(clientX, clientY);
        if (idx < 0) return false;

        e.preventDefault();
        const deltaDb = isUp ? 1 : -1;
        adjustMixLaneVolumeByDisplayIndex(idx, deltaDb);
        return true;
    }


    const mixLaneVolumeUnityHoldDir = {};

    function mixLaneVolumeUnityHoldKey(t) {
        return t.kind === 'video' ? 'video' : t.slot;
    }

    function adjustMixLaneVolumeByDisplayIndex(displayIndex, deltaDb) {
        if (
            typeof trackLaneLinearGainToDb !== 'function' ||
            typeof trackLaneLinearGainFromDb !== 'function'
        ) {
            return false;
        }
        const targets = getVisibleMixLaneTargets();
        const t = targets[displayIndex];
        if (!t) return false;
        const holdKey = mixLaneVolumeUnityHoldKey(t);
        const hold = mixLaneVolumeUnityHoldDir[holdKey] || 0;
        if (hold !== 0 && ((hold > 0 && deltaDb > 0) || (hold < 0 && deltaDb < 0))) {
            return false;
        }
        let currentLinear;
        if (t.kind === 'video') {
            if (typeof videoReady !== 'function' || !videoReady()) return false;
            currentLinear = getVideoTrackVolLinear();
        } else {
            if (typeof isExtraTrackLoaded !== 'function' || !isExtraTrackLoaded(t.slot)) {
                return false;
            }
            currentLinear = getExtraTrackVolLinear(t.slot);
        }
        const currentDb = trackLaneLinearGainToDb(currentLinear);
        const atUnityBefore = isMixLaneDbAtUnity(currentDb);
        const nextDb = mixLaneVolumeDbAfterStep(currentDb, deltaDb);
        if (Math.abs(nextDb - currentDb) < 1e-6) {
            return false;
        }
        const next = trackLaneLinearGainFromDb(nextDb);
        if (t.kind === 'video') {
            setVideoTrackVolLinear(next);
        } else {
            setExtraTrackVolLinear(t.slot, next);
        }
        if (typeof syncTrackLaneFaderUi === 'function') {
            syncTrackLaneFaderUi(t.kind === 'video' ? 'video' : t.slot);
        }
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        flashMixLaneVolumeToast(t, nextDb);
        const stoppedAtUnity =
            isMixLaneDbAtUnity(nextDb) &&
            !atUnityBefore &&
            ((deltaDb > 0 && currentDb < 0) || (deltaDb < 0 && currentDb > 0));
        if (stoppedAtUnity) {
            mixLaneVolumeUnityHoldDir[holdKey] = deltaDb > 0 ? 1 : -1;
        } else {
            delete mixLaneVolumeUnityHoldDir[holdKey];
        }
        return stoppedAtUnity;
    }

    function clearExtraTrackVolumeUnityHold(slot) {
        if (slot === 'video') {
            delete mixLaneVolumeUnityHoldDir.video;
            return;
        }
        if (Number.isFinite(slot)) {
            delete mixLaneVolumeUnityHoldDir[slot];
        } else {
            for (const k of Object.keys(mixLaneVolumeUnityHoldDir)) {
                delete mixLaneVolumeUnityHoldDir[k];
            }
        }
    }

    function adjustExtraTrackVolumeDb(slot, deltaDb) {
        if (
            typeof trackLaneLinearGainToDb !== 'function' ||
            typeof trackLaneLinearGainFromDb !== 'function'
        ) {
            return false;
        }
        if (typeof isExtraTrackLoaded !== 'function' || !isExtraTrackLoaded(slot)) {
            return false;
        }
        const hold = mixLaneVolumeUnityHoldDir[slot] || 0;
        if (hold !== 0 && ((hold > 0 && deltaDb > 0) || (hold < 0 && deltaDb < 0))) {
            return false;
        }
        const currentLinear = getExtraTrackVolLinear(slot);
        const currentDb = trackLaneLinearGainToDb(currentLinear);
        const atUnityBefore = isMixLaneDbAtUnity(currentDb);
        const nextDb = mixLaneVolumeDbAfterStep(currentDb, deltaDb);
        if (Math.abs(nextDb - currentDb) < 1e-6) {
            return false;
        }
        setExtraTrackVolLinear(slot, trackLaneLinearGainFromDb(nextDb));
        if (typeof syncTrackLaneFaderUi === 'function') {
            syncTrackLaneFaderUi(slot);
        }
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        const stoppedAtUnity =
            isMixLaneDbAtUnity(nextDb) &&
            !atUnityBefore &&
            ((deltaDb > 0 && currentDb < 0) || (deltaDb < 0 && currentDb > 0));
        if (stoppedAtUnity) {
            mixLaneVolumeUnityHoldDir[slot] = deltaDb > 0 ? 1 : -1;
        } else {
            delete mixLaneVolumeUnityHoldDir[slot];
        }
        return stoppedAtUnity;
    }


