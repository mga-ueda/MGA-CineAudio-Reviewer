/**
 * extra-audio-lane-mix.js — Ex レーン gain / solo / mute
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
        if (existing && existing.src && !(opt && opt.force)) {
            applySegmentEntryGain(existing, gainLinear, ctx);
            return;
        }
        ensureExtraTrackMixRouting(slot, ctx);
        const gainT = getCrossfadeGainTransportSec();
        const anchorT =
            opt && Number.isFinite(opt.transportSec) ? opt.transportSec : gainT;
        const trackRef = { type: 'extra', slot };
        if (
            !(opt && opt.force) &&
            segHit.segmentIndex > 0 &&
            typeof isSegmentSourceContinuousAtBoundary === 'function' &&
            isSegmentSourceContinuousAtBoundary(trackRef, segHit.segmentIndex - 1) &&
            !(
                typeof hasManualSegmentFadeAtJoinedBoundary === 'function' &&
                hasManualSegmentFadeAtJoinedBoundary(
                    trackRef,
                    segHit.segmentIndex - 1,
                )
            )
        ) {
            let leftKey = null;
            if (typeof getActiveExtraSegmentsAtTransport === 'function') {
                const activeAtT = getActiveExtraSegmentsAtTransport(anchorT);
                const leftHit = activeAtT.find(
                    (h) =>
                        h.slot === slot &&
                        h.segmentIndex === segHit.segmentIndex - 1,
                );
                if (leftHit) leftKey = leftHit.key;
            }
            if (!leftKey && typeof getTrackSegments === 'function') {
                const segments = getTrackSegments(trackRef);
                const leftSeg = segments[segHit.segmentIndex - 1];
                if (leftSeg) {
                    leftKey =
                        slot +
                        ':' +
                        (leftSeg.id || 'i' + (segHit.segmentIndex - 1));
                }
            }
            if (leftKey && leftKey !== key && tr.segmentSources[leftKey]) {
                const leftEntry = tr.segmentSources[leftKey];
                if (
                    leftEntry &&
                    leftEntry.src &&
                    typeof isSegmentSourceAudibleOnCtx === 'function' &&
                    isSegmentSourceAudibleOnCtx(leftEntry, ctx)
                ) {
                    delete tr.segmentSources[leftKey];
                    tr.segmentSources[key] = leftEntry;
                    tr.source = leftEntry.src;
                    let liveBuf = leftEntry.bufferOff;
                    if (typeof refreshSegmentHitAtTransport === 'function') {
                        const fresh = refreshSegmentHitAtTransport(
                            trackRef,
                            segHit,
                            anchorT,
                        );
                        if (fresh && Number.isFinite(fresh.bufferOff)) {
                            liveBuf = fresh.bufferOff;
                        }
                    } else if (Number.isFinite(leftEntry.playbackAnchorCtxTime)) {
                        const elapsed = Math.max(
                            0,
                            ctx.currentTime - leftEntry.playbackAnchorCtxTime,
                        );
                        liveBuf = Math.min(
                            clip.buffer.duration - 0.002,
                            leftEntry.bufferOff + elapsed,
                        );
                    }
                    leftEntry.bufferOff = liveBuf;
                    leftEntry.transportAnchor = anchorT;
                    leftEntry.playbackAnchorCtxTime = ctx.currentTime;
                    leftEntry.lastAppliedGain = null;
                    tr.playbackAnchorTransportSec = anchorT;
                    tr.playbackAnchorCtxTime = ctx.currentTime;
                    applySegmentEntryGain(leftEntry, gainLinear, ctx);
                    return;
                }
            }
        }
        if (
            !(opt && opt.force) &&
            typeof shouldDeferIncomingSourceAtContinuousJoinedBoundary === 'function'
        ) {
            const activeAtT =
                typeof getActiveExtraSegmentsAtTransport === 'function'
                    ? getActiveExtraSegmentsAtTransport(anchorT)
                    : null;
            if (
                shouldDeferIncomingSourceAtContinuousJoinedBoundary(
                    trackRef,
                    segHit,
                    anchorT,
                    tr,
                    activeAtT,
                )
            ) {
                return;
            }
        }
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
            typeof planIncomingSegmentStartAtJoinedBoundary === 'function' &&
            !(
                typeof isSegmentSourceContinuousAtBoundary === 'function' &&
                isSegmentSourceContinuousAtBoundary(
                    trackRef,
                    segHit.segmentIndex - 1,
                )
            )
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
        if (remain <= 0.002) {
            return;
        }
        const minStartRemain =
            typeof EXTRA_AUDIO_SEGMENT_MIN_CONTINUE_REMAIN_SEC === 'number'
                ? EXTRA_AUDIO_SEGMENT_MIN_CONTINUE_REMAIN_SEC
                : 0.04;
        if (remain <= minStartRemain) {
            return;
        }
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
        stopExtraTrackSegmentSourceEntry(existing);
        const src = ctx.createBufferSource();
        src.buffer = clip.buffer;
        const segGain = ctx.createGain();
        segGain.gain.value = Math.max(0, gainLinear);
        src.connect(segGain);
        segGain.connect(tr.gainNode);
        const durationPad =
            typeof EXTRA_AUDIO_SEGMENT_DURATION_PAD_SEC === 'number'
                ? EXTRA_AUDIO_SEGMENT_DURATION_PAD_SEC
                : 0.08;
        let playEndOff = startAt + remain;
        if (typeof getContinuousJoinedSourceOutSec === 'function') {
            const chainOut = getContinuousJoinedSourceOutSec(
                trackRef,
                segHit.segmentIndex,
            );
            if (chainOut > startAt + 0.002) {
                playEndOff = Math.max(playEndOff, chainOut);
            }
        }
        playEndOff = Math.min(playEndOff, clip.buffer.duration - 0.002);
        const playDur = Math.min(
            playEndOff - startAt + durationPad,
            clip.buffer.duration - startAt,
        );
        src.start(when, startAt, playDur);
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
            if (!tr.segmentSources[key] || tr.segmentSources[key].src !== src) return;
            delete tr.segmentSources[key];
            if (tr.source === src) {
                tr.source = null;
                clearExtraTrackPlaybackAnchor(tr);
            }
            const minContinue =
                typeof EXTRA_AUDIO_SEGMENT_MIN_CONTINUE_REMAIN_SEC === 'number'
                    ? EXTRA_AUDIO_SEGMENT_MIN_CONTINUE_REMAIN_SEC
                    : 0.04;
            if (
                isTransportPlayingForExtra() &&
                typeof getActiveExtraSegmentsAtTransport === 'function'
            ) {
                const transportSec = getCrossfadeGainTransportSec();
                const hit = getActiveExtraSegmentsAtTransport(transportSec).find(
                    (h) => h.key === key && h.slot === slot,
                );
                if (hit && hit.remain > minContinue) {
                    let g = Math.max(0, gainLinear);
                    if (
                        typeof computeSegmentCrossfadeGainsForActive === 'function' &&
                        typeof segmentPlaybackGainLinear === 'function'
                    ) {
                        const active = getActiveExtraSegmentsAtTransport(transportSec);
                        const gains = computeSegmentCrossfadeGainsForActive(
                            ctx,
                            active,
                            transportSec,
                        );
                        g = segmentPlaybackGainLinear(
                            hit,
                            gains.get(key) ?? 1,
                            transportSec,
                        );
                    }
                    startExtraTrackSegmentSource(
                        slot,
                        hit,
                        g,
                        ctx.currentTime + 0.001,
                        ctx,
                        { force: false, transportSec: transportSec },
                    );
                    scheduleMasterPlaybackFinishCheck();
                    return;
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
            videoAnalyser.fftSize = 1024;
            videoAnalyser.smoothingTimeConstant = 0.65;
        } else if ((videoAnalyser.fftSize | 0) !== 1024) {
            videoAnalyser.fftSize = 1024;
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

