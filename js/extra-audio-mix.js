/**
 * extra-audio-mix.js — レビューミックス（Web Audio ルーティング・Solo/Mute）。
 */
    function ensureExtraTrackMixRouting(slot, ctx) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !ctx) return null;
        const master = ensureReviewMixMasterBus(ctx);
        if (!tr.gainNode) tr.gainNode = ctx.createGain();
        if (tr.mixRoutingReady) {
            applyExtraTrackLaneGain(slot);
            return tr;
        }
        const meter = ensureExtraTrackAnalyser(ctx, tr);
        try {
            tr.gainNode.disconnect();
        } catch (_) {}
        try {
            if (meter) meter.disconnect();
        } catch (_) {}
        const bus = master || ctx.destination;
        if (meter) {
            tr.gainNode.connect(meter);
            meter.connect(bus);
        } else {
            tr.gainNode.connect(bus);
        }
        tr.mixRoutingReady = true;
        applyExtraTrackLaneGain(slot);
        return tr;
    }

    function startExtraTrackSegmentSource(slot, segHit, gainLinear, scheduleWhen, ctx, opt) {
        const tr = extraTrackBySlot(slot);
        const clip = getExtraTrackClip(tr, segHit.clipId);
        if (!tr || !clip || !clip.buffer || !isExtraTrackAudible(slot)) return;
        if (!tr.segmentSources) tr.segmentSources = {};
        const key = segHit.key;
        const existing = tr.segmentSources[key];
        if (existing && existing.src && !opt.force) {
            applySegmentEntryGain(existing, gainLinear, ctx);
            return;
        }
        ensureExtraTrackMixRouting(slot, ctx);
        const gainT = getCrossfadeGainTransportSec();
        const anchorT = Number.isFinite(opt.transportSec) ? opt.transportSec : gainT;
        stopExtraTrackSegmentSourceEntry(existing);
        const trackRef = { type: 'extra', slot };
        let when = Number.isFinite(scheduleWhen)
            ? scheduleWhen
            : acquireExtraMixScheduleTime(ctx, opt);
        let playTransportSec = anchorT;
        let startAt = Math.max(0, segHit.bufferOff);
        let remain = Math.max(0, segHit.remain);
        let usedJoinedPlan = false;
        const boundaryJoined =
            segHit.segmentIndex > 0 &&
            typeof isSegmentBoundaryJoined === 'function' &&
            isSegmentBoundaryJoined(trackRef, segHit.segmentIndex - 1) &&
            !(
                typeof hasExtendedCrossfadeOverlapAtBoundary === 'function' &&
                hasExtendedCrossfadeOverlapAtBoundary(
                    trackRef,
                    segHit.segmentIndex - 1,
                )
            ) &&
            !(
                typeof hasManualSegmentFadeAtJoinedBoundary === 'function' &&
                hasManualSegmentFadeAtJoinedBoundary(
                    trackRef,
                    segHit.segmentIndex - 1,
                )
            );
        const othersPlaying =
            tr.segmentSources &&
            Object.keys(tr.segmentSources).some((k) => {
                if (k === key) return false;
                const e = tr.segmentSources[k];
                return e && e.src;
            });
        if (
            boundaryJoined &&
            typeof planIncomingSegmentStartAtJoinedBoundary === 'function'
        ) {
            let leftEntry = null;
            if (othersPlaying) {
                for (const k of Object.keys(tr.segmentSources)) {
                    if (k === key) continue;
                    const e = tr.segmentSources[k];
                    if (e && e.src) {
                        leftEntry = e;
                        break;
                    }
                }
            }
            const plan = planIncomingSegmentStartAtJoinedBoundary(
                trackRef,
                segHit.segmentIndex,
                ctx,
                { leftEntry, mapTransportSec: anchorT },
            );
            if (plan) {
                when = plan.whenCtx;
                startAt = plan.bufferOff;
                remain = plan.remain;
                playTransportSec = plan.transportAnchor;
                usedJoinedPlan = true;
            }
        }
        if (!usedJoinedPlan) {
            if (othersPlaying) {
                when = Math.min(
                    when,
                    ctx.currentTime + EXTRA_AUDIO_SEGMENT_ADD_AHEAD_SEC,
                );
            }
            if (
                Number.isFinite(segHit.timelineStart) &&
                Number.isFinite(anchorT) &&
                anchorT < segHit.timelineStart - 0.0005
            ) {
                const leadSec = segHit.timelineStart - anchorT;
                const alignedWhen = ctx.currentTime + Math.max(0.002, leadSec - 0.001);
                when = Math.min(when, alignedWhen);
            }
            playTransportSec = anchorT + Math.max(0, when - ctx.currentTime);
            let liveHit = segHit;
            if (typeof refreshSegmentHitAtTransport === 'function') {
                const refreshed = refreshSegmentHitAtTransport(
                    trackRef,
                    segHit,
                    playTransportSec,
                );
                if (refreshed) liveHit = refreshed;
            }
            startAt = Math.max(0, liveHit.bufferOff);
            remain = Math.max(0, liveHit.remain);
        }
        if (remain <= 0.002) return;
        const maxOff = Math.max(0, clip.buffer.duration - 0.002);
        startAt = Math.min(startAt, maxOff);
        if (
            boundaryJoined &&
            typeof getActiveExtraSegmentsAtTransport === 'function'
        ) {
            const activeAtPlay = getActiveExtraSegmentsAtTransport(playTransportSec);
            if (activeAtPlay.length >= 2) {
                const liveAtPlay = activeAtPlay.find((h) => h.key === key);
                if (liveAtPlay) {
                    const gainsAtPlay = computeSegmentCrossfadeGainsForActive(
                        ctx,
                        activeAtPlay,
                        playTransportSec,
                    );
                    gainLinear = segmentPlaybackGainLinear(
                        liveAtPlay,
                        gainsAtPlay.get(key) ?? 1,
                        playTransportSec,
                    );
                }
            }
        }
        const src = ctx.createBufferSource();
        src.buffer = clip.buffer;
        const segGain = ctx.createGain();
        segGain.gain.value = Math.max(0, gainLinear);
        src.connect(segGain);
        segGain.connect(tr.gainNode);
        src.start(when, startAt, Math.min(remain, clip.buffer.duration - startAt));
        tr.segmentSources[key] = {
            src,
            segGain,
            transportAnchor: playTransportSec,
            playbackAnchorCtxTime: when,
            bufferOff: startAt,
            lastAppliedGain: Math.max(0, gainLinear),
        };
        if (
            boundaryJoined &&
            typeof getActiveExtraSegmentsAtTransport === 'function'
        ) {
            const slotActive = getActiveExtraSegmentsAtTransport(playTransportSec).filter(
                (h) => h.slot === slot,
            );
            if (slotActive.length >= 2) {
                applySegmentCrossfadeGains(
                    ctx,
                    slotActive,
                    getCrossfadeGainTransportSec(),
                );
            }
        }
        tr.source = src;
        tr.playbackAnchorTransportSec = playTransportSec;
        tr.playbackAnchorCtxTime = when;
        src.onended = () => {
            if (tr.segmentSources[key] && tr.segmentSources[key].src === src) {
                delete tr.segmentSources[key];
                if (tr.source === src) {
                    tr.source = null;
                    clearExtraTrackPlaybackAnchor(tr);
                }
            }
            scheduleMasterPlaybackFinishCheck();
        };
    }

    function setMixBtnState(btn, on) {
        if (!btn) return;
        btn.classList.toggle('track-mix-btn--on', !!on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    function laneGainLinear(v) {
        if (typeof trackLaneClampGainLinear === 'function') {
            return trackLaneClampGainLinear(v);
        }
        const n = Number(v);
        if (!isFinite(n) || n < 0) return 1;
        return n === 0 ? 0 : n;
    }

    function ensureVideoTrackAnalyser(ctx) {
        if (!ctx) return null;
        if (!videoAnalyser) {
            videoAnalyser = ctx.createAnalyser();
            videoAnalyser.fftSize = 256;
            videoAnalyser.smoothingTimeConstant = 0.65;
        }
        return videoAnalyser;
    }

    function ensureExtraTrackAnalyser(ctx, tr) {
        if (!ctx || !tr) return null;
        if (!tr.analyser) {
            tr.analyser = ctx.createAnalyser();
            tr.analyser.fftSize = 256;
            tr.analyser.smoothingTimeConstant = 0.65;
        }
        return tr.analyser;
    }

    function getVideoTrackEffectiveGain() {
        if (videoExportAudioInclude && !videoExportAudioInclude.includeVideo) return 0;
        if (!isVideoAudioAudible()) return 0;
        if (!isVideoMixOutputActive()) return 0;
        return laneGainLinear(videoMix.volLinear);
    }

    function getExtraTrackEffectiveGain(slot) {
        if (
            videoExportAudioInclude &&
            (!Array.isArray(videoExportAudioInclude.includeExtra) ||
                !videoExportAudioInclude.includeExtra[slot])
        ) {
            return 0;
        }
        if (!isExtraTrackAudible(slot)) return 0;
        const tr = extraTrackBySlot(slot);
        if (!tr) return 0;
        return laneGainLinear(tr.volLinear);
    }

    function applyExtraTrackLaneGain(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.gainNode) return;
        const ctx = ensureReviewMixCtx();
        if (!ctx) return;
        const g = getExtraTrackEffectiveGain(slot);
        try {
            tr.gainNode.gain.setTargetAtTime(g, ctx.currentTime, 0.02);
        } catch (_) {
            tr.gainNode.gain.value = g;
        }
    }

    function applyAllTrackLaneGains() {
        applyReviewMixVideoGain();
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            applyExtraTrackLaneGain(i);
        }
    }

    function getVideoTrackVolLinear() {
        return videoMix.volLinear;
    }

    function setVideoTrackVolLinear(v) {
        videoMix.volLinear = laneGainLinear(v);
        applyReviewMixVideoGain();
    }

    function getExtraTrackVolLinear(slot) {
        const tr = extraTrackBySlot(slot);
        return tr ? tr.volLinear : 1;
    }

    function setExtraTrackVolLinear(slot, v) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return;
        tr.volLinear = laneGainLinear(v);
        applyExtraTrackLaneGain(slot);
    }

    function getVideoTrackAnalyser() {
        return videoAnalyser;
    }

    function getExtraTrackAnalyser(slot) {
        const tr = extraTrackBySlot(slot);
        return tr ? tr.analyser : null;
    }

    function isVideoTrackLaneMeterSilent() {
        if (!isVideoAudioAudible()) return true;
        if (reviewMixVideoWired || reviewMixVideoBoostPlayback) {
            return getVideoTrackEffectiveGain() <= 0;
        }
        return !videoMonitorStreamSrc;
    }

    /** モニタータップ用ゲイン（ブースト／MES／buffer 時はフェーダー線形値、ネイティブ時は video.volume）。 */
    function getVideoMonitorTapGainLinear() {
        if (!isVideoAudioAudible()) return 0;
        if (reviewMixVideoWired || reviewMixVideoBoostPlayback) {
            return getVideoTrackEffectiveGain();
        }
        if (!videoMain || videoMain.muted) return 0;
        const vol = videoMain.volume;
        return Number.isFinite(vol) && vol > 0 ? vol : 0;
    }

    function isExtraTrackLaneMeterSilent(slot) {
        return !isExtraTrackAudible(slot);
    }

    function anyMixSoloActive() {
        if (videoMix.solo) return true;
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (extraTracks[i].solo) return true;
        }
        return false;
    }

    function isVideoAudioAudible() {
        if (typeof videoReady !== 'function' || !videoReady()) return false;
        if (containerHasAudio.main === false) return false;
        if (videoMix.muted) return false;
        if (anyMixSoloActive()) return videoMix.solo;
        return true;
    }

    function isExtraTrackAudible(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.buffer) return false;
        if (tr.muted) return false;
        if (anyMixSoloActive()) return !!tr.solo;
        return true;
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

    function releaseReviewMixVideoCaptureGraph() {
        reviewMixVideoBoostPlayback = false;
        if (videoMonitorStreamSrc) {
            try {
                videoMonitorStreamSrc.disconnect();
            } catch (_) {}
            videoMonitorStreamSrc = null;
        }
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
        if (
            !videoMain ||
            shouldPlayVideoAudioViaWebAudio() ||
            shouldPlayVideoAudioViaCaptureBoost()
        ) {
            return false;
        }
        if (containerHasAudio.main === false) {
            releaseReviewMixVideoCaptureGraph();
            return false;
        }
        if (typeof canBindReviewMixVideoMediaSource === 'function' && !canBindReviewMixVideoMediaSource()) {
            return false;
        }
        const captureFn = getVideoCaptureStreamFn();
        if (!captureFn) return false;
        const ctx = ensureReviewMixCtx();
        if (!ctx) return false;
        if (!videoGainNode) videoGainNode = ctx.createGain();
        if (!videoMonitorSinkGain) {
            videoMonitorSinkGain = ctx.createGain();
            videoMonitorSinkGain.gain.value = 0;
        }
        const vMeter = ensureVideoTrackAnalyser(ctx);
        const forceRecapture = !!(opt && opt.forceRecapture);
        try {
            if (videoMonitorStreamSrc && forceRecapture) {
                try {
                    videoMonitorStreamSrc.disconnect();
                } catch (_) {}
                videoMonitorStreamSrc = null;
                videoMonitorStream = null;
            }
            if (!videoMonitorStreamSrc) {
                videoMonitorStream = captureFn();
                if (!videoMonitorStream || !videoMonitorStream.getAudioTracks().length) {
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
            applyReviewMixVideoMonitorTapGain();
            return true;
        } catch (err) {
            releaseReviewMixVideoCaptureGraph();
            writeLog(
                'Review mix: video monitor tap failed — ' +
                    (err && err.message ? err.message : String(err)),
            );
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
                videoMonitorStream = null;
            }
            if (!videoMonitorStreamSrc) {
                videoMonitorStream = captureFn();
                if (!videoMonitorStream || !videoMonitorStream.getAudioTracks().length) {
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
                'Review mix: video capture boost failed — ' +
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
        if (!sessionMixRestore || !sessionMixRestore.video || !videoReady()) return false;
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
        refreshExtraTrackUi(slot);
        refreshReviewMixUi();
        syncExtraAudioToTransport();
    }

    function applyVideoMixFromSessionRestoreIfPending() {
        return applyVideoMixFromSessionRestore();
    }

    function toggleVideoSolo() {
        if (!videoReady()) return;
        videoMix.solo = !videoMix.solo;
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        writeLog('Video audio: ' + (videoMix.solo ? 'solo on' : 'solo off'));
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
    }

    function toggleVideoMute() {
        if (!videoReady()) return;
        videoMix.muted = !videoMix.muted;
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        writeLog('Video audio: ' + (videoMix.muted ? 'muted' : 'unmuted'));
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
    }

    function toggleExtraSolo(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.buffer) return;
        tr.solo = !tr.solo;
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        writeLog('Extra audio ' + (slot + 1) + ': ' + (tr.solo ? 'solo on' : 'solo off'));
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
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
        const targets = getVisibleMixLaneTargets();
        const t = targets[displayIndex];
        if (!t) return;
        if (t.kind === 'video') toggleVideoSolo();
        else toggleExtraSolo(t.slot);
    }

    function soloOnlyMixByDisplayIndex(displayIndex) {
        const targets = getVisibleMixLaneTargets();
        const t = targets[displayIndex];
        if (!t) return false;

        if (typeof videoReady === 'function' && videoReady()) {
            videoMix.solo = t.kind === 'video';
            if (t.kind === 'video') {
                videoMix.muted = false;
            }
        }

        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            const tr = extraTrackBySlot(slot);
            if (!tr || !tr.buffer) continue;
            const isTarget = t.kind === 'extra' && t.slot === slot;
            tr.solo = isTarget;
            if (isTarget) {
                tr.muted = false;
            }
        }

        refreshReviewMixUi();
        syncExtraAudioToTransport();
        writeLog('Mix solo only: ' + (t.kind === 'video' ? 'Video' : 'Extra audio ' + (t.slot + 1)));
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
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
        const isUp = matchUserShortcut(e, 'mixLaneVolumeUp', { allowRepeat: true });
        const isDown = matchUserShortcut(e, 'mixLaneVolumeDown', { allowRepeat: true });
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
        refreshReviewMixUi();
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
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
        refreshReviewMixUi();
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

