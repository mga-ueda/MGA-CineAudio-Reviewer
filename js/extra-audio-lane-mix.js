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

    function continuousJoinHandoffOverlapSec() {
        return typeof CONTINUOUS_JOIN_HANDOFF_SEC === 'number'
            ? CONTINUOUS_JOIN_HANDOFF_SEC
            : 0.04;
    }

    function continuousJoinPlayExtendSec() {
        return typeof CONTINUOUS_JOIN_PLAY_EXTEND_SEC === 'number'
            ? CONTINUOUS_JOIN_PLAY_EXTEND_SEC
            : 0.06;
    }

    function segmentHasContinuousJoinedRight(trackRef, segmentIndex) {
        if (typeof isSegmentSourceContinuousAtBoundary !== 'function') {
            return false;
        }
        if (
            typeof boundaryNeedsPitchPlaybackSplit === 'function' &&
            boundaryNeedsPitchPlaybackSplit(trackRef, segmentIndex)
        ) {
            return false;
        }
        if (
            typeof hasManualSegmentFadeAtJoinedBoundary === 'function' &&
            hasManualSegmentFadeAtJoinedBoundary(trackRef, segmentIndex)
        ) {
            return false;
        }
        return isSegmentSourceContinuousAtBoundary(trackRef, segmentIndex);
    }

    function pitchSplitHandoffOverlapSec(stretchLatencySec, trackRef, boundaryIndex) {
        if (
            trackRef != null &&
            boundaryIndex != null &&
            typeof pitchSplitBoundaryHandoffSec === 'function'
        ) {
            const base = pitchSplitBoundaryHandoffSec(trackRef, boundaryIndex);
            if (base <= 0) return 0;
            const latency = Number.isFinite(stretchLatencySec)
                ? Math.max(0, stretchLatencySec)
                : 0;
            return Math.max(base, latency + 0.02);
        }
        return typeof PITCH_SPLIT_BOUNDARY_HANDOFF_SEC === 'number'
            ? PITCH_SPLIT_BOUNDARY_HANDOFF_SEC
            : 0.12;
    }

    function resolveSegmentSourceEntryBySrc(tr, src, preferKey) {
        if (!tr || !tr.segmentSources || !src) {
            return { key: preferKey, entry: null };
        }
        if (preferKey && tr.segmentSources[preferKey]?.src === src) {
            return { key: preferKey, entry: tr.segmentSources[preferKey] };
        }
        for (const k of Object.keys(tr.segmentSources)) {
            const e = tr.segmentSources[k];
            if (e && e.src === src) {
                return { key: k, entry: e };
            }
        }
        return { key: preferKey, entry: null };
    }

    function handleSegmentSourceOnended(p) {
        const {
            slot,
            key,
            tr,
            ctx,
            trackRef,
            segHit,
            src,
            gainLinear,
            segmentPitch,
        } = p;
        const resolved = resolveSegmentSourceEntryBySrc(tr, src, key);
        const entryKey = resolved.key;
        const endedEntry = resolved.entry;
        if (!endedEntry || endedEntry.src !== src) return;
        const handoffStopped = !!endedEntry._handoffStopRequested;
        if (handoffStopped) {
            delete tr.segmentSources[entryKey];
            if (tr.source === src) {
                tr.source = null;
                clearExtraTrackPlaybackAnchor(tr);
            }
            scheduleMasterPlaybackFinishCheck();
            return;
        }
        const minContinue =
            typeof EXTRA_AUDIO_SEGMENT_MIN_CONTINUE_REMAIN_SEC === 'number'
                ? EXTRA_AUDIO_SEGMENT_MIN_CONTINUE_REMAIN_SEC
                : 0.04;
        if (
            !isTransportPlayingForExtra() ||
            typeof getActiveExtraSegmentsAtTransport !== 'function'
        ) {
            scheduleMasterPlaybackFinishCheck();
            return;
        }
        const transportSec = getCrossfadeGainTransportSec();
        let hit = getActiveExtraSegmentsAtTransport(transportSec).find(
            (h) => h.key === entryKey && h.slot === slot,
        );
        const segIdx =
            endedEntry.segmentIndex != null
                ? endedEntry.segmentIndex
                : segHit.segmentIndex;
        if (!hit) {
            hit = getActiveExtraSegmentsAtTransport(transportSec).find(
                (h) => h.slot === slot && h.segmentIndex === segIdx,
            );
        }
        const restartSegHit = hit || segHit;
        if (
            hit &&
            hit.remain > minContinue &&
            !shouldSkipSegmentOnendedRestart(
                slot,
                entryKey,
                restartSegHit,
                trackRef,
                tr,
                hit,
                transportSec,
                endedEntry,
                ctx,
            )
        ) {
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
                    gains.get(hit.key) ?? 1,
                    transportSec,
                );
            }
            if (typeof pitchPlaybackLog === 'function') {
                pitchPlaybackLog('onended/restart', {
                    slot,
                    segmentIndex: segIdx,
                    pitch: segmentPitch,
                    remain: hit.remain,
                    gainLinear: g,
                    entryKey,
                });
            }
            startExtraTrackSegmentSource(
                slot,
                hit,
                g,
                ctx.currentTime,
                ctx,
                { force: false, transportSec: transportSec },
            );
            delete tr.segmentSources[entryKey];
            if (tr.source === src) {
                tr.source = null;
                clearExtraTrackPlaybackAnchor(tr);
            }
            scheduleMasterPlaybackFinishCheck();
            return;
        }
        delete tr.segmentSources[entryKey];
        if (tr.source === src) {
            tr.source = null;
            clearExtraTrackPlaybackAnchor(tr);
        }
        scheduleMasterPlaybackFinishCheck();
    }

    function startExtraTrackSegmentSource(slot, segHit, gainLinear, scheduleWhen, ctx, opt) {
        const tr = extraTrackBySlot(slot);
        const clip = getExtraTrackClip(tr, segHit.clipId);
        if (!tr || !clip || !clip.buffer || !isExtraTrackAudible(slot)) return;
        if (!tr.segmentSources) tr.segmentSources = {};
        const key = segHit.key;
        let existing = tr.segmentSources[key];
        const trackRef = { type: 'extra', slot };
        if (existing && existing.pendingLiveStretch && !existing.src) {
            if (!(opt && opt.force)) {
                if (typeof pitchPlaybackLog === 'function') {
                    pitchPlaybackLog('start/live-stretch-pending', {
                        slot,
                        segmentIndex: segHit.segmentIndex,
                        pitch: existing.pitchSemitones || 0,
                        gen: existing.liveStretchGen,
                    });
                }
                return;
            }
            if (!tr._livePitchStretchGenByKey) tr._livePitchStretchGenByKey = {};
            tr._livePitchStretchGenByKey[key] =
                (tr._livePitchStretchGenByKey[key] || 0) + 1;
            delete tr.segmentSources[key];
            existing = null;
        }
        if (existing && existing.src) {
            const pitch = getSegmentPitchSemitones(trackRef, segHit.segmentIndex);
            const absOff = Number.isFinite(existing.absoluteBufferOff)
                ? existing.absoluteBufferOff
                : Number(segHit.bufferOff) || 0;
            let keepExisting = pitch === (existing.pitchSemitones || 0);
            if (
                keepExisting &&
                pitch !== 0 &&
                typeof resolveRegionSegmentPlaybackBuffer === 'function'
            ) {
                const resolved = resolveRegionSegmentPlaybackBuffer(
                    trackRef,
                    segHit.segmentIndex,
                    clip,
                    absOff,
                );
                const wantsSlice = !!resolved.usesPitchSlice;
                const wantsLive =
                    !wantsSlice &&
                    typeof isSignalsmithPitchStretchAvailable === 'function' &&
                    isSignalsmithPitchStretchAvailable();
                keepExisting =
                    wantsSlice === !!existing.usesPitchSlice &&
                    wantsLive === !!existing.usesLiveStretch;
            }
            if (keepExisting) {
                if (typeof pitchPlaybackLog === 'function' && pitch !== 0) {
                    pitchPlaybackLog('start/keep-existing', {
                        slot,
                        segmentIndex: segHit.segmentIndex,
                        pitch,
                        force: !!(opt && opt.force),
                        usesLiveStretch: !!existing.usesLiveStretch,
                        gainLinear,
                    });
                }
                applySegmentEntryGain(existing, gainLinear, ctx);
                return;
            }
            if (typeof pitchPlaybackLog === 'function') {
                pitchPlaybackLog('start/upgrade-existing', {
                    slot,
                    segmentIndex: segHit.segmentIndex,
                    pitch,
                    force: !!(opt && opt.force),
                    hadSlice: !!existing.usesPitchSlice,
                    hadLiveStretch: !!existing.usesLiveStretch,
                });
            }
            stopExtraTrackSegmentSourceEntry(existing);
            delete tr.segmentSources[key];
        }
        ensureExtraTrackMixRouting(slot, ctx);
        const gainT = getCrossfadeGainTransportSec();
        const anchorT =
            opt && Number.isFinite(opt.transportSec) ? opt.transportSec : gainT;
        const pitchSplitBoundary =
            segHit.segmentIndex > 0 &&
            typeof boundaryNeedsPitchPlaybackSplit === 'function' &&
            boundaryNeedsPitchPlaybackSplit(trackRef, segHit.segmentIndex - 1);
        let pitchHandoffLeftKey = null;
        let pitchHandoffLeftEntry = null;
        if (pitchSplitBoundary && segHit.segmentIndex > 0 && typeof getTrackSegments === 'function') {
            const segments = getTrackSegments(trackRef);
            const leftSeg = segments[segHit.segmentIndex - 1];
            const leftKey =
                leftSeg &&
                slot + ':' + (leftSeg.id || 'i' + (segHit.segmentIndex - 1));
            if (leftKey && leftKey !== key && tr.segmentSources[leftKey]) {
                pitchHandoffLeftKey = leftKey;
                pitchHandoffLeftEntry = tr.segmentSources[leftKey];
            }
        }
        if (
            !(opt && opt.force) &&
            !pitchSplitBoundary &&
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
                const leftAudible =
                    leftEntry &&
                    leftEntry.src &&
                    typeof isSegmentSourceAudibleOnCtx === 'function' &&
                    isSegmentSourceAudibleOnCtx(leftEntry, ctx);
                const leftScheduled =
                    leftEntry &&
                    leftEntry.src &&
                    typeof extraTrackSourceEntryScheduledOrAudibleOnCtx ===
                        'function' &&
                    extraTrackSourceEntryScheduledOrAudibleOnCtx(leftEntry, ctx);
                if (leftEntry && leftEntry.src && !leftAudible && !leftScheduled) {
                    if (typeof pitchPlaybackLog === 'function') {
                        pitchPlaybackLog('start/reuse-continuous-stale', {
                            slot,
                            segmentIndex: segHit.segmentIndex,
                            leftKey,
                        });
                    }
                    stopExtraTrackSegmentSourceEntry(leftEntry);
                    delete tr.segmentSources[leftKey];
                } else if (leftAudible) {
                    const freshHit =
                        typeof refreshSegmentHitAtTransport === 'function'
                            ? refreshSegmentHitAtTransport(
                                  trackRef,
                                  segHit,
                                  anchorT,
                              )
                            : null;
                    const incomingHit = freshHit || segHit;
                    const overlapSec = continuousJoinHandoffOverlapSec();
                    if (typeof pitchPlaybackLog === 'function') {
                        pitchPlaybackLog('start/continuous-handoff', {
                            slot,
                            segmentIndex: segHit.segmentIndex,
                            leftKey,
                            overlapSec,
                            transportSec: anchorT,
                        });
                    }
                    markSegmentSourceEntryForHandoffStop(leftEntry);
                    try {
                        leftEntry.src.stop(ctx.currentTime + overlapSec);
                    } catch (_) {}
                    startExtraTrackSegmentSource(
                        slot,
                        incomingHit,
                        gainLinear,
                        ctx.currentTime,
                        ctx,
                        {
                            transportSec: anchorT,
                            force: true,
                        },
                    );
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
            !pitchSplitBoundary &&
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
        if (
            pitchSplitBoundary &&
            pitchHandoffLeftEntry &&
            typeof getTrackSegments === 'function'
        ) {
            const segments = getTrackSegments(trackRef);
            const leftSeg = segments[segHit.segmentIndex - 1];
            const boundaryT =
                typeof getSegmentPlaybackTimelineStart === 'function'
                    ? getSegmentPlaybackTimelineStart(
                          trackRef,
                          segHit.segmentIndex,
                      )
                    : playTransportSec;
            if (Number.isFinite(boundaryT) && anchorT < boundaryT - 0.0005) {
                if (typeof pitchPlaybackLog === 'function') {
                    pitchPlaybackLog('start/pitch-split-defer', {
                        slot,
                        segmentIndex: segHit.segmentIndex,
                        anchorT,
                        boundaryT,
                    });
                }
                return;
            }
            if (leftSeg && Number.isFinite(leftSeg.sourceOutSec)) {
                if (Number.isFinite(boundaryT)) {
                    playTransportSec = boundaryT;
                    when =
                        ctx.currentTime +
                        Math.max(0.0005, boundaryT - anchorT);
                }
                startAt = leftSeg.sourceOutSec;
                if (typeof refreshSegmentHitAtTransport === 'function') {
                    const refreshed = refreshSegmentHitAtTransport(
                        trackRef,
                        segHit,
                        playTransportSec,
                    );
                    if (refreshed) {
                        remain = Math.max(0, refreshed.remain);
                    }
                }
                if (typeof pitchPlaybackLog === 'function') {
                    pitchPlaybackLog('start/pitch-split-incoming', {
                        slot,
                        segmentIndex: segHit.segmentIndex,
                        playTransportSec,
                        joinSourceSec: startAt,
                        leftSourceOut: leftSeg.sourceOutSec,
                        when,
                        boundaryT,
                    });
                }
            }
        } else if (
            typeof segmentSourceSecFromTransport === 'function' &&
            Number.isFinite(playTransportSec)
        ) {
            const mappedSource = segmentSourceSecFromTransport(
                trackRef,
                segHit.segmentIndex,
                playTransportSec,
            );
            if (Number.isFinite(mappedSource)) {
                startAt = mappedSource;
            }
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
        const absoluteStartAt = startAt;
        const playbackResolved =
            typeof resolveRegionSegmentPlaybackBuffer === 'function'
                ? resolveRegionSegmentPlaybackBuffer(
                      trackRef,
                      segHit.segmentIndex,
                      clip,
                      absoluteStartAt,
                  )
                : {
                      buffer: clip.buffer,
                      bufferOff: absoluteStartAt,
                      pitchRate: 1,
                      legacyPlaybackRate: false,
                  };
        const playbackBuffer = playbackResolved.buffer || clip.buffer;
        startAt = playbackResolved.bufferOff;
        let pitchRate = playbackResolved.pitchRate;
        const legacyPlaybackRate = playbackResolved.legacyPlaybackRate;
        const usesPitchSlice = !!playbackResolved.usesPitchSlice;
        const segmentPitch = getSegmentPitchSemitones(trackRef, segHit.segmentIndex);
        const useLivePitchStretch =
            segmentPitch !== 0 &&
            !usesPitchSlice &&
            !(opt && opt.disableLivePitchStretch) &&
            typeof isSignalsmithPitchStretchAvailable === 'function' &&
            isSignalsmithPitchStretchAvailable();
        if (playbackBuffer !== clip.buffer) {
            remain = Math.min(
                remain,
                Math.max(0, playbackBuffer.duration - startAt),
            );
        }
        const maxOff = Math.max(0, playbackBuffer.duration - 0.002);
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
        const durationPad =
            typeof EXTRA_AUDIO_SEGMENT_DURATION_PAD_SEC === 'number'
                ? EXTRA_AUDIO_SEGMENT_DURATION_PAD_SEC
                : 0.08;
        const endPad = usesPitchSlice ? 0.002 : durationPad;
        let playEndOff = startAt + remain;
        if (typeof getContinuousJoinedSourceOutSec === 'function') {
            const chainOut = getContinuousJoinedSourceOutSec(
                trackRef,
                segHit.segmentIndex,
            );
            let chainEnd = chainOut;
            if (
                (!legacyPlaybackRate || useLivePitchStretch) &&
                chainOut > 0
            ) {
                const segments =
                    typeof getTrackSegments === 'function'
                        ? getTrackSegments(trackRef)
                        : [];
                const seg = segments[segHit.segmentIndex];
                if (seg) chainEnd = Math.max(0, chainOut - seg.sourceInSec);
            }
            if (chainEnd > startAt + 0.002) {
                playEndOff = Math.max(playEndOff, chainEnd);
            }
        }
        if (
            segmentPitch === 0 &&
            typeof pitchSliceEnterBoundary === 'function' &&
            pitchSliceEnterBoundary(trackRef, segHit.segmentIndex) &&
            typeof getTrackSegments === 'function'
        ) {
            const enterPad =
                typeof PITCH_SLICE_ENTER_HANDOFF_SEC === 'number'
                    ? PITCH_SLICE_ENTER_HANDOFF_SEC
                    : 0.004;
            const segments = getTrackSegments(trackRef);
            const seg = segments[segHit.segmentIndex];
            if (seg && Number.isFinite(seg.sourceOutSec)) {
                const tailOff = Math.min(
                    seg.sourceOutSec + enterPad,
                    playbackBuffer.duration - 0.002,
                );
                if (tailOff > startAt + 0.002) {
                    playEndOff = Math.max(playEndOff, tailOff);
                }
            }
        }
        playEndOff = Math.min(playEndOff, playbackBuffer.duration - 0.002);
        let playDur = Math.min(
            playEndOff - startAt + endPad,
            playbackBuffer.duration - startAt,
        );
        let pitchSliceTimelineFitRate = 1;
        if (Number.isFinite(playTransportSec)) {
            let timelineEnd =
                typeof getSegmentTimelineEnd === 'function'
                    ? getSegmentTimelineEnd(trackRef, segHit.segmentIndex)
                    : segHit.timelineEnd;
            if (!Number.isFinite(timelineEnd)) {
                timelineEnd = segHit.timelineEnd;
            }
            if (Number.isFinite(timelineEnd)) {
                const timelineRemain = Math.max(0, timelineEnd - playTransportSec);
                if (
                    usesPitchSlice &&
                    typeof pitchSliceTimelineDurationSec === 'function' &&
                    typeof getSegmentPlaybackTimelineStart === 'function'
                ) {
                    const strictDur = pitchSliceTimelineDurationSec(
                        trackRef,
                        segHit.segmentIndex,
                    );
                    const playbackStart = getSegmentPlaybackTimelineStart(
                        trackRef,
                        segHit.segmentIndex,
                    );
                    if (strictDur != null && Number.isFinite(playbackStart)) {
                        timelineEnd = playbackStart + strictDur;
                    }
                }
                const timelineRemainStrict = Math.max(
                    0,
                    timelineEnd - playTransportSec,
                );
                if (segmentPitch !== 0) {
                    if (usesPitchSlice) {
                        const bufferRemain = Math.max(
                            0.002,
                            playbackBuffer.duration - startAt,
                        );
                        playDur = Math.min(
                            playDur,
                            bufferRemain,
                            remain,
                            timelineRemainStrict,
                        );
                        if (
                            timelineRemainStrict > 0.001 &&
                            bufferRemain > 0.001 &&
                            typeof pitchSlicePlaybackFitRate === 'function'
                        ) {
                            pitchSliceTimelineFitRate = pitchSlicePlaybackFitRate(
                                bufferRemain,
                                timelineRemainStrict,
                            );
                            if (
                                Math.abs(pitchSliceTimelineFitRate - 1) < 0.0002
                            ) {
                                pitchSliceTimelineFitRate = 1;
                            }
                        }
                    } else if (useLivePitchStretch) {
                        playDur = Math.min(
                            playDur,
                            timelineRemain,
                            playbackBuffer.duration - startAt,
                            remain,
                        );
                    } else {
                        const effectivePitchRate =
                            typeof segmentPitchPlaybackRate === 'function'
                                ? segmentPitchPlaybackRate(segmentPitch)
                                : pitchRate !== 1
                                  ? pitchRate
                                  : 1;
                        playDur = Math.min(
                            playDur,
                            timelineRemain * effectivePitchRate + durationPad,
                            playbackBuffer.duration - startAt,
                        );
                    }
                }
                if (typeof pitchPlaybackLog === 'function' && segmentPitch !== 0) {
                    pitchPlaybackLog('start/playdur', {
                        segmentIndex: segHit.segmentIndex,
                        usesPitchSlice,
                        useLivePitchStretch,
                        legacyPlaybackRate,
                        pitchRate: usesPitchSlice
                            ? pitchSliceTimelineFitRate
                            : pitchRate,
                        timelineRemain: timelineRemainStrict,
                        playDur,
                        playbackRate: usesPitchSlice
                            ? pitchSliceTimelineFitRate
                            : useLivePitchStretch
                              ? 1
                              : pitchRate,
                        pitchSliceFitRate: usesPitchSlice
                            ? pitchSliceTimelineFitRate
                            : undefined,
                    });
                }
                const continuousRight =
                    !usesPitchSlice &&
                    !useLivePitchStretch &&
                    segmentHasContinuousJoinedRight(
                        trackRef,
                        segHit.segmentIndex,
                    );
                const strictTimelinePad = usesPitchSlice
                    ? 0
                    : continuousRight
                      ? continuousJoinPlayExtendSec()
                      : 0.006;
                let timelinePad = strictTimelinePad;
                if (
                    segmentPitch === 0 &&
                    typeof pitchSliceEnterBoundary === 'function' &&
                    pitchSliceEnterBoundary(trackRef, segHit.segmentIndex)
                ) {
                    timelinePad +=
                        typeof PITCH_SLICE_ENTER_HANDOFF_SEC === 'number'
                            ? PITCH_SLICE_ENTER_HANDOFF_SEC
                            : 0.004;
                }
                if (!usesPitchSlice) {
                    playDur = Math.min(
                        playDur,
                        timelineRemainStrict + timelinePad,
                        playbackBuffer.duration - startAt,
                    );
                }
            }
        }
        playDur = Math.max(0.002, playDur);
        if (usesPitchSlice && typeof pitchPlaybackLog === 'function') {
            const timelineEndLog =
                typeof getSegmentTimelineEnd === 'function'
                    ? getSegmentTimelineEnd(trackRef, segHit.segmentIndex)
                    : segHit.timelineEnd;
            const timelineRemainLog = Number.isFinite(timelineEndLog)
                ? Math.max(0, timelineEndLog - playTransportSec)
                : null;
            pitchPlaybackLog('start/playdur-slice', {
                segmentIndex: segHit.segmentIndex,
                playDur,
                timelineRemain: timelineRemainLog,
                sliceRemain: remain,
                bufferRemain: playbackBuffer.duration - startAt,
                pitchSliceFitRate: pitchSliceTimelineFitRate,
                wallDurSec:
                    pitchSliceTimelineFitRate > 0
                        ? playDur / pitchSliceTimelineFitRate
                        : playDur,
            });
        }
        if (useLivePitchStretch) {
            if (!tr._livePitchStretchGenByKey) tr._livePitchStretchGenByKey = {};
            const liveStretchGen =
                (tr._livePitchStretchGenByKey[key] || 0) + 1;
            tr._livePitchStretchGenByKey[key] = liveStretchGen;
            tr.segmentSources[key] = {
                pendingLiveStretch: true,
                liveStretchGen,
                pitchSemitones: segmentPitch,
                pitchHandoffLeftKey,
                transportAnchor: playTransportSec,
            };
            if (typeof pitchPlaybackLog === 'function') {
                pitchPlaybackLog('live-stretch/begin', {
                    slot,
                    segmentIndex: segHit.segmentIndex,
                    pitch: segmentPitch,
                    gen: liveStretchGen,
                    bufferOff: startAt,
                    playDur,
                    playTransportSec,
                    when,
                    gainLinear,
                    hasLeftHandoff: !!pitchHandoffLeftEntry,
                });
            }
            void beginLivePitchStretchSegmentSource({
                slot,
                key,
                tr,
                ctx,
                trackRef,
                segHit,
                playbackBuffer,
                startAt,
                playDur,
                playTransportSec,
                when,
                anchorT,
                absoluteStartAt,
                remain,
                gainLinear,
                segmentPitch,
                boundaryJoined,
                pitchHandoffLeftEntry,
                pitchHandoffLeftKey,
                liveStretchGen,
            });
            return;
        }
        const src = ctx.createBufferSource();
        src.buffer = playbackBuffer;
        if (usesPitchSlice) {
            src.detune.value = 0;
            src.playbackRate.value = pitchSliceTimelineFitRate;
            pitchRate = pitchSliceTimelineFitRate;
        } else if (
            segmentPitch !== 0 &&
            typeof applySegmentPitchToBufferSource === 'function'
        ) {
            pitchRate = applySegmentPitchToBufferSource(src, segmentPitch);
        } else {
            src.detune.value = 0;
            src.playbackRate.value = 1;
            pitchRate = 1;
        }
        const segGain = ctx.createGain();
        segGain.gain.value = Math.max(0, gainLinear);
        connectMonoAudioCentered(src, segGain, playbackBuffer.numberOfChannels);
        segGain.connect(tr.gainNode);
        if (typeof pitchPlaybackLog === 'function') {
            const timelineEndForLog =
                typeof getSegmentTimelineEnd === 'function'
                    ? getSegmentTimelineEnd(trackRef, segHit.segmentIndex)
                    : segHit.timelineEnd;
            pitchPlaybackLog('start/new-source', {
                slot,
                segmentIndex: segHit.segmentIndex,
                pitch: segmentPitch,
                usesPitchSlice,
                legacyPlaybackRate,
                absoluteBufferOff: absoluteStartAt,
                bufferOff: startAt,
                remain,
                playDur,
                bufferDurSec: playbackBuffer.duration,
                playTransportSec,
                hitTimelineEnd: segHit.timelineEnd,
                segmentTimelineEnd: timelineEndForLog,
            });
        }
        src.start(when, startAt, playDur);
        if (pitchSplitBoundary && pitchHandoffLeftEntry && pitchHandoffLeftEntry.src) {
            const pitchHandoffOverlapSec = pitchSplitHandoffOverlapSec(
                null,
                trackRef,
                segHit.segmentIndex - 1,
            );
            if (pitchHandoffOverlapSec > 0.0005) {
                const leftStopWhen = when + pitchHandoffOverlapSec;
                markSegmentSourceEntryForHandoffStop(pitchHandoffLeftEntry);
                try {
                    pitchHandoffLeftEntry.src.stop(leftStopWhen);
                } catch (_) {}
                if (pitchHandoffLeftEntry.stretch) {
                    try {
                        pitchHandoffLeftEntry.stretch.stop(leftStopWhen);
                    } catch (_) {}
                }
                pitchHandoffLeftEntry.lastAppliedGain = null;
                if (typeof pitchPlaybackLog === 'function') {
                    pitchPlaybackLog('handoff/stop-left-at-when', {
                        slot,
                        segmentIndex: segHit.segmentIndex,
                        leftKey: pitchHandoffLeftKey,
                        pitchWhen: when,
                        leftStopWhen,
                        overlapSec: pitchHandoffOverlapSec,
                    });
                }
            }
        }
        tr.segmentSources[key] = {
            src,
            segGain,
            transportAnchor: playTransportSec,
            playbackAnchorCtxTime: when,
            bufferOff: startAt,
            absoluteBufferOff: absoluteStartAt,
            segmentIndex: segHit.segmentIndex,
            pitchRate,
            pitchSemitones: segmentPitch,
            usesPitchSlice,
            legacyPlaybackRate,
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
            handleSegmentSourceOnended({
                slot,
                key,
                tr,
                ctx,
                trackRef,
                segHit,
                src,
                gainLinear,
                segmentPitch,
            });
        };
    }

    async function beginLivePitchStretchSegmentSource(p) {
        const {
            slot,
            key,
            tr,
            ctx,
            trackRef,
            segHit,
            playbackBuffer,
            startAt,
            playDur,
            playTransportSec,
            when,
            anchorT,
            absoluteStartAt,
            remain,
            gainLinear,
            segmentPitch,
            boundaryJoined,
            pitchHandoffLeftEntry,
            pitchHandoffLeftKey,
            liveStretchGen,
        } = p;
        const startGen = liveStretchGen;
        function liveStretchGenStale(reason) {
            const cur =
                tr._livePitchStretchGenByKey &&
                tr._livePitchStretchGenByKey[key];
            if (cur === startGen) return false;
            if (typeof pitchPlaybackLog === 'function') {
                pitchPlaybackLog('live-stretch/cancelled', {
                    slot,
                    segmentIndex: segHit.segmentIndex,
                    pitch: segmentPitch,
                    reason,
                    startGen,
                    currentGen: cur,
                });
            }
            return true;
        }
        try {
            if (typeof warmupPitchStretchWorklet === 'function') {
                await warmupPitchStretchWorklet(ctx);
            }
            if (liveStretchGenStale('after-warmup')) return;
            if (
                typeof isTransportPlayingForExtra === 'function' &&
                !isTransportPlayingForExtra()
            ) {
                if (typeof pitchPlaybackLog === 'function') {
                    pitchPlaybackLog('live-stretch/cancelled', {
                        slot,
                        segmentIndex: segHit.segmentIndex,
                        pitch: segmentPitch,
                        reason: 'transport-stopped',
                        startGen,
                    });
                }
                return;
            }
            const stretch =
                typeof createLivePitchStretchNode === 'function'
                    ? await createLivePitchStretchNode(
                          ctx,
                          playbackBuffer.numberOfChannels,
                      )
                    : await SignalsmithStretch(ctx, {
                          numberOfInputs: 0,
                          numberOfOutputs: 1,
                          outputChannelCount: [playbackBuffer.numberOfChannels],
                      });
            if (liveStretchGenStale('after-node-create')) {
                try {
                    stretch.disconnect();
                } catch (_) {}
                return;
            }
            const slice =
                typeof extractBufferSliceChannelArrays === 'function'
                    ? extractBufferSliceChannelArrays(
                          playbackBuffer,
                          startAt,
                          playDur,
                      )
                    : null;
            if (!slice || !slice.channelArrays.length) {
                throw new Error('live stretch slice empty');
            }
            let liveWhen = when;
            let liveTransportSec = playTransportSec;
            if (pitchHandoffLeftEntry && pitchHandoffLeftEntry.src) {
                liveWhen = ctx.currentTime;
                liveTransportSec = playTransportSec;
            }
            const segGain = ctx.createGain();
            segGain.gain.value = Math.max(0, gainLinear);
            connectMonoAudioCentered(stretch, segGain, slice.channelArrays.length);
            segGain.connect(tr.gainNode);
            await stretch.addBuffers(
                slice.channelArrays,
                slice.channelArrays.map((arr) => arr.buffer),
            );
            const stretchLatency =
                typeof stretch.latency === 'function'
                    ? Math.max(0, await stretch.latency())
                    : 0;
            await stretch.start(liveWhen, 0, undefined, 1, segmentPitch);
            const liveDurationPad =
                typeof EXTRA_AUDIO_SEGMENT_DURATION_PAD_SEC === 'number'
                    ? EXTRA_AUDIO_SEGMENT_DURATION_PAD_SEC
                    : 0.08;
            try {
                stretch.stop(liveWhen + playDur + liveDurationPad);
            } catch (_) {}
            const src = ctx.createBufferSource();
            src.buffer = playbackBuffer;
            src.playbackRate.value = 1;
            src.detune.value = 0;
            const muteGain = ctx.createGain();
            muteGain.gain.value = 0;
            src.connect(muteGain);
            muteGain.connect(tr.gainNode);
            if (liveStretchGenStale('after-stretch-start')) {
                try {
                    src.stop();
                } catch (_) {}
                try {
                    stretch.stop();
                } catch (_) {}
                try {
                    stretch.disconnect();
                } catch (_) {}
                return;
            }
            src.start(liveWhen, startAt, playDur);
            if (typeof pitchPlaybackLog === 'function') {
                pitchPlaybackLog('start/live-stretch', {
                    slot,
                    segmentIndex: segHit.segmentIndex,
                    pitch: segmentPitch,
                    bufferOff: startAt,
                    playDur,
                    playTransportSec: liveTransportSec,
                    when: liveWhen,
                    stretchStopWhen: liveWhen + playDur + liveDurationPad,
                    gainLinear,
                    channels: playbackBuffer.numberOfChannels,
                    ctxTime: ctx.currentTime,
                    mode: 'addBuffers',
                    sliceFrames: slice.frameCount,
                    stretchLatency,
                });
            }
            if (pitchHandoffLeftEntry && pitchHandoffLeftEntry.src) {
                const pitchHandoffOverlapSec = pitchSplitHandoffOverlapSec(
                    stretchLatency,
                    trackRef,
                    segHit.segmentIndex - 1,
                );
                if (pitchHandoffOverlapSec > 0.0005) {
                    const leftStopWhen = liveWhen + pitchHandoffOverlapSec;
                    markSegmentSourceEntryForHandoffStop(pitchHandoffLeftEntry);
                    try {
                        pitchHandoffLeftEntry.src.stop(leftStopWhen);
                    } catch (_) {}
                    if (pitchHandoffLeftEntry.stretch) {
                        try {
                            pitchHandoffLeftEntry.stretch.stop(leftStopWhen);
                        } catch (_) {}
                    }
                    pitchHandoffLeftEntry.lastAppliedGain = null;
                    if (typeof pitchPlaybackLog === 'function') {
                        pitchPlaybackLog('handoff/stop-left-at-when', {
                            slot,
                            segmentIndex: segHit.segmentIndex,
                            leftKey: pitchHandoffLeftKey,
                            pitchWhen: liveWhen,
                            leftStopWhen,
                            overlapSec: pitchHandoffOverlapSec,
                            liveStretch: true,
                        });
                    }
                }
            }
            tr.segmentSources[key] = {
                src,
                stretch,
                segGain,
                transportAnchor: liveTransportSec,
                playbackAnchorCtxTime: liveWhen,
                bufferOff: startAt,
                absoluteBufferOff: absoluteStartAt,
                segmentIndex: segHit.segmentIndex,
                pitchRate: 1,
                pitchSemitones: segmentPitch,
                usesPitchSlice: false,
                usesLiveStretch: true,
                usesStretchBuffers: true,
                legacyPlaybackRate: false,
                lastAppliedGain: Math.max(0, gainLinear),
            };
            if (
                boundaryJoined &&
                typeof getActiveExtraSegmentsAtTransport === 'function'
            ) {
                const slotActive = getActiveExtraSegmentsAtTransport(
                    liveTransportSec,
                ).filter((h) => h.slot === slot);
                if (slotActive.length >= 2) {
                    applySegmentCrossfadeGains(
                        ctx,
                        slotActive,
                        getCrossfadeGainTransportSec(),
                    );
                }
            }
            tr.source = src;
            tr.playbackAnchorTransportSec = liveTransportSec;
            tr.playbackAnchorCtxTime = liveWhen;
            src.onended = () => {
                if (typeof pitchPlaybackLog === 'function') {
                    pitchPlaybackLog('onended/live-stretch', {
                        slot,
                        segmentIndex: segHit.segmentIndex,
                        pitch: segmentPitch,
                        transportSec: getCrossfadeGainTransportSec(),
                        ctxTime: ctx.currentTime,
                    });
                }
                handleSegmentSourceOnended({
                    slot,
                    key,
                    tr,
                    ctx,
                    trackRef,
                    segHit,
                    src,
                    gainLinear,
                    segmentPitch,
                });
            };
        } catch (err) {
            if (typeof pitchPlaybackLog === 'function') {
                pitchPlaybackLog('live-stretch/failed', {
                    slot,
                    segmentIndex: segHit.segmentIndex,
                    pitch: segmentPitch,
                    message: err && err.message ? err.message : String(err),
                });
            }
            if (tr._livePitchStretchGenByKey &&
                tr._livePitchStretchGenByKey[key] === startGen) {
                delete tr.segmentSources[key];
            }
            if (tr._livePitchStretchGenByKey &&
                tr._livePitchStretchGenByKey[key] !== startGen) {
                return;
            }
            startExtraTrackSegmentSource(
                slot,
                segHit,
                gainLinear,
                when,
                ctx,
                {
                    force: true,
                    transportSec: playTransportSec,
                    disableLivePitchStretch: true,
                },
            );
        }
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

