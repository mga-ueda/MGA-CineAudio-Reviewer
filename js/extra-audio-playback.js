/**
 * extra-audio-playback.js — 再生スケジュール・トランスポート同期。
 */
    function ensureReviewMixCtx() {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        if (!reviewMixCtx) {
            reviewMixCtx = new Ctx();
            if (typeof warmupPitchStretchWorklet === 'function') {
                void warmupPitchStretchWorklet(reviewMixCtx);
            }
        }
        ensureReviewMixMasterBus(reviewMixCtx);
        if (reviewMixCtx.state === 'suspended') {
            void reviewMixCtx.resume();
        }
        return reviewMixCtx;
    }

    function extraTrackBySlot(slot) {
        return extraTracks[slot] || null;
    }

    function clampExtraTrackTimelineStartSec(slot, sec) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return 0;
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        return Math.max(0, Math.round(n / step) * step);
    }

    function getExtraTrackTimelineStartSec(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return 0;
        const n = Number(tr.timelineStartSec);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function extraTrackTimelineEndSec(slot) {
        if (typeof getTrackTimelineEndSec === 'function') {
            return getTrackTimelineEndSec({ type: 'extra', slot });
        }
        const start = getExtraTrackTimelineStartSec(slot);
        const dur = extraTrackContentDurationSec(slot);
        return start + (dur > 0 ? dur : 0);
    }

    function setExtraTrackTimelineStartSec(slot, sec, opt) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.buffer) return;
        const next = clampExtraTrackTimelineStartSec(slot, sec);
        if (Math.abs(next - getExtraTrackTimelineStartSec(slot)) < 0.0005) return;
        tr.timelineStartSec = next;
        if (typeof updateTrackRegionOverlay === 'function') {
            updateTrackRegionOverlay({ type: 'extra', slot });
        }
        if (opt && opt.skipRedraw) return;
        if (typeof drawExtraTrackWaveform === 'function') drawExtraTrackWaveform(slot);
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (!(opt && opt.skipPersist)) {
            if (typeof schedulePersistExtraTrackSlot === 'function') {
                schedulePersistExtraTrackSlot(slot);
            } else if (typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
        }
    }

    function getExtraUi(slot) {
        return extraTrackUi[slot] || null;
    }

    function clearExtraTrackPlaybackAnchor(tr) {
        if (!tr) return;
        tr.playbackAnchorTransportSec = null;
        tr.playbackAnchorCtxTime = null;
    }

    function resetExtraMixScheduleTime() {
        extraMixScheduleCtxTime = 0;
    }

    function isTransportPlayingForExtra() {
        return typeof isTransportPlaying === 'function'
            ? isTransportPlaying()
            : !!(videoMain && !videoMain.paused);
    }

    /** スケジュール位置 = 音声マスター（シークバーと同じ）。正オフセットの遅延は映像側 Web Audio で処理。 */
    function getAudioSyncTransportSec() {
        return Math.max(0, getMasterTransportSecForAudioSync());
    }

    /** 音声マスター位置（transportPlaybackSec / シークバー）。 */
    function getMasterTransportSecForAudioSync() {
        if (
            isTransportPlayingForExtra() &&
            typeof transportPlaybackSec === 'number' &&
            Number.isFinite(transportPlaybackSec)
        ) {
            return transportPlaybackSec;
        }
        if (typeof getTransportSec === 'function') {
            return getTransportSec();
        }
        return 0;
    }

    function expectedTransportSecForSegmentEntry(entry, ctx) {
        if (
            !entry ||
            !Number.isFinite(entry.transportAnchor) ||
            !Number.isFinite(entry.playbackAnchorCtxTime)
        ) {
            return null;
        }
        if (ctx.currentTime < entry.playbackAnchorCtxTime) {
            return entry.transportAnchor;
        }
        return (
            entry.transportAnchor + (ctx.currentTime - entry.playbackAnchorCtxTime)
        );
    }

    function expectedTransportSecForTrack(tr, ctx, slot) {
        if (
            !tr ||
            tr.source == null ||
            !Number.isFinite(tr.playbackAnchorTransportSec) ||
            !Number.isFinite(tr.playbackAnchorCtxTime)
        ) {
            return null;
        }
        let expected;
        if (ctx.currentTime < tr.playbackAnchorCtxTime) {
            expected = tr.playbackAnchorTransportSec;
        } else {
            expected =
                tr.playbackAnchorTransportSec + (ctx.currentTime - tr.playbackAnchorCtxTime);
        }
        if (slot >= 0 && slot < EXTRA_TRACK_COUNT) {
            const end = extraTrackPlayableTransportEndSec(slot);
            if (Number.isFinite(end) && end > 0) {
                expected = Math.min(expected, end);
            }
        }
        return expected;
    }

    function isExtraTrackSourceAudibleOnCtx(tr, ctx) {
        if (!tr || tr.source == null || !Number.isFinite(tr.playbackAnchorCtxTime)) {
            return false;
        }
        return ctx.currentTime >= tr.playbackAnchorCtxTime - 0.0005;
    }

    function extraTrackPlayableTransportEndSec(slot) {
        if (typeof getTrackTimelineEndSec === 'function') {
            return getTrackTimelineEndSec({ type: 'extra', slot });
        }
        return getExtraTrackTimelineStartSec(slot) + extraTrackBufferDuration(slot);
    }

    /** 読み込み済み・可聴トラックの再生終端をすべて過ぎたか（映像なしセッション向け） */
    function isPastAllLoadedTrackPlaybackEnds(transportSec) {
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return false;
        const eps =
            typeof masterTransportTailEpsilonSec === 'function'
                ? masterTransportTailEpsilonSec()
                : 0.02;
        let any = false;
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackLoaded(i)) continue;
            if (!isExtraTrackAudible(i)) continue;
            any = true;
            const end = extraTrackPlayableTransportEndSec(i);
            if (!(end > 0) || t < end - eps) return false;
        }
        if (any) return true;
        if (typeof videoReady === 'function' && videoReady()) {
            const vd =
                typeof getVideoPlaybackEndSec === 'function'
                    ? getVideoPlaybackEndSec()
                    : typeof getVideoTransportDurationSec === 'function'
                      ? getVideoTransportDurationSec()
                      : 0;
            return vd > 0 && t >= vd - eps;
        }
        return false;
    }

    function scheduleMasterPlaybackFinishCheck() {
        const run = () => {
            if (typeof maybeFinishMasterTransportPlayback === 'function') {
                maybeFinishMasterTransportPlayback();
            }
        };
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(run);
        } else {
            setTimeout(run, 0);
        }
    }

    function extraTrackHasAudibleOrImminentSegment(slot, transportSec) {
        if (typeof getActiveExtraSegmentsAtTransport !== 'function') return false;
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return false;
        const ahead =
            typeof EXTRA_AUDIO_SCHEDULE_AHEAD_SEC === 'number'
                ? EXTRA_AUDIO_SCHEDULE_AHEAD_SEC
                : 0.02;
        const probes = [t, t + ahead + 0.04, t - 0.06];
        for (let p = 0; p < probes.length; p++) {
            if (probes[p] < -0.001) continue;
            const hits = getActiveExtraSegmentsAtTransport(probes[p]);
            if (hits.some((s) => s.slot === slot)) return true;
        }
        const ctx = ensureReviewMixCtx();
        const tr = extraTrackBySlot(slot);
        if (
            ctx &&
            tr &&
            typeof extraTrackSourcesScheduledOrAudibleOnCtx === 'function' &&
            extraTrackSourcesScheduledOrAudibleOnCtx(tr, ctx)
        ) {
            return true;
        }
        return false;
    }

    function isExtraTrackWithinPlayableTimeline(slot, transportSec) {
        const track = { type: 'extra', slot };
        if (
            typeof isTrackRegionActive === 'function' &&
            isTrackRegionActive(track)
        ) {
            return extraTrackHasAudibleOrImminentSegment(slot, transportSec);
        }
        if (typeof isTrackTransportAudible === 'function') {
            return isTrackTransportAudible(track, transportSec);
        }
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return false;
        const start = getExtraTrackTimelineStartSec(slot);
        const end = extraTrackPlayableTransportEndSec(slot);
        return t >= start - 0.0005 && t < end - 0.002;
    }

    function shouldExtraTrackSourceBePlaying(slot) {
        if (!isExtraTrackAudible(slot)) return false;
        if (!isExtraTrackLoaded(slot)) return false;
        const tr = extraTrackBySlot(slot);
        if (!tr) return false;
        if (!isTransportPlayingForExtra()) return false;
        const audioT = getAudioSyncTransportSec();
        if (!isExtraTrackWithinPlayableTimeline(slot, audioT)) {
            return false;
        }
        const ctx = ensureReviewMixCtx();
        if (tr.source && ctx && !isExtraTrackSourceAudibleOnCtx(tr, ctx)) {
            return true;
        }
        return true;
    }

    function stopExtraTrackSourceIfPastPlayableEnd(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return;
        const audioT = getAudioSyncTransportSec();
        if (!isExtraTrackWithinPlayableTimeline(slot, audioT)) {
            stopExtraTrackAllSources(slot);
        }
    }

    function extraTrackRoutingMismatch() {
        const ctx = ensureReviewMixCtx();
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const tr = extraTrackBySlot(i);
            const shouldPlay = shouldExtraTrackSourceBePlaying(i);
            const playing =
                typeof extraTrackSourcesScheduledOrAudibleOnCtx === 'function'
                    ? extraTrackSourcesScheduledOrAudibleOnCtx(tr, ctx)
                    : extraTrackSourcesAudibleOnCtx(tr, ctx);
            if (shouldPlay === playing) continue;
            if (!shouldPlay && playing) {
                stopExtraTrackSourceIfPastPlayableEnd(i);
                if (!tr || !tr.source) continue;
            }
            return true;
        }
        return false;
    }

    function reviewMixHasCrossfadeAtTransport(transportSec) {
        if (typeof getActiveExtraSegmentsAtTransport !== 'function') return false;
        const active = getActiveExtraSegmentsAtTransport(transportSec);
        if (active.length < 2) return false;
        if (activeHasJoinedBoundaryCrossfadeAtTransport(active, transportSec)) {
            return true;
        }
        const gains = computeEqualPowerCrossfadeGains(active, transportSec);
        for (let i = 0; i < active.length; i++) {
            const g = gains.get(active[i].key) ?? 1;
            if (g < 0.97) return true;
        }
        return false;
    }

    function segmentSourcesReadyForActive(active) {
        if (!active || !active.length) return false;
        const gainT = getCrossfadeGainTransportSec();
        for (const segHit of active) {
            const tr = extraTrackBySlot(segHit.slot);
            const trackRef = { type: 'extra', slot: segHit.slot };
            if (
                typeof shouldDeferIncomingSourceAtContinuousJoinedBoundary ===
                    'function' &&
                shouldDeferIncomingSourceAtContinuousJoinedBoundary(
                    trackRef,
                    segHit,
                    gainT,
                    tr,
                    active,
                )
            ) {
                continue;
            }
            const entry =
                tr && tr.segmentSources ? tr.segmentSources[segHit.key] : null;
            if (entry && entry.pendingLiveStretch && !entry.src) {
                continue;
            }
            if (!entry || !entry.src) return false;
        }
        return true;
    }

    /** 再生中: セグメント Fade In/Out ゲインを毎同期で反映（単一セグメント時も） */
    function applySegmentFadeGainsForActive(ctx, active, transportSec) {
        if (!ctx || !active || !active.length) return false;
        const gainT = Number.isFinite(transportSec)
            ? transportSec
            : getCrossfadeGainTransportSec();
        const crossfadeGains = computeSegmentCrossfadeGainsForActive(
            ctx,
            active,
            gainT,
        );
        const rampSec = active.length >= 2 ? 0.008 : 0.012;
        const inCrossfade =
            active.length >= 2 &&
            (activeHasJoinedBoundaryCrossfadeAtTransport(active, gainT) ||
                activeHasManualCrossfadeOverlapAtTransport(active, gainT));
        let applied = false;
        for (const segHit of active) {
            const tr = extraTrackBySlot(segHit.slot);
            const entry =
                tr && tr.segmentSources ? tr.segmentSources[segHit.key] : null;
            if (!entry || !entry.segGain || !entry.src) continue;
            if (
                !isSegmentSourceAudibleOnCtx(entry, ctx) &&
                entry.playbackAnchorCtxTime > ctx.currentTime + 0.0005
            ) {
                continue;
            }
            const g = segmentPlaybackGainLinear(
                segHit,
                crossfadeGains.get(segHit.key) ?? 1,
                gainT,
            );
            applySegmentEntryGain(entry, g, ctx, { rampSec, inCrossfade });
            applied = true;
        }
        return applied;
    }

    function applySegmentCrossfadeGains(ctx, active, transportSec) {
        if (!ctx || !active || active.length < 2) return false;
        const gainT = Number.isFinite(transportSec)
            ? transportSec
            : getCrossfadeGainTransportSec();
        const gains = computeSegmentCrossfadeGainsForActive(ctx, active, gainT);
        const rampSec = 0.008;
        const inCrossfade =
            activeHasJoinedBoundaryCrossfadeAtTransport(active, gainT) ||
            activeHasManualCrossfadeOverlapAtTransport(active, gainT) ||
            reviewMixHasCrossfadeAtTransport(gainT);
        let applied = false;
        for (const segHit of active) {
            const tr = extraTrackBySlot(segHit.slot);
            const entry =
                tr && tr.segmentSources ? tr.segmentSources[segHit.key] : null;
            if (!entry || !entry.segGain || !entry.src) continue;
            if (
                !isSegmentSourceAudibleOnCtx(entry, ctx) &&
                entry.playbackAnchorCtxTime > ctx.currentTime + 0.0005
            ) {
                continue;
            }
            const g = segmentPlaybackGainLinear(
                segHit,
                gains.get(segHit.key) ?? 1,
                gainT,
            );
            applySegmentEntryGain(entry, g, ctx, { rampSec, inCrossfade });
            applied = true;
        }
        return applied;
    }

    function reviewMixNeedsPlaybackSync() {
        if (!isTransportPlayingForExtra()) return false;
        if (extraTrackRoutingMismatch()) return true;
        const audioT = getAudioSyncTransportSec();
        const mapT =
            typeof getSegmentMappingTransportSec === 'function'
                ? getSegmentMappingTransportSec()
                : audioT;
        const active =
            typeof getActiveExtraSegmentsAtTransport === 'function'
                ? getActiveExtraSegmentsAtTransport(mapT)
                : [];
        if (active.length > 1) {
            return !segmentSourcesReadyForActive(active);
        }
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const trackRef = { type: 'extra', slot: i };
            if (
                typeof isTrackRegionActive === 'function' &&
                isTrackRegionActive(trackRef) &&
                !extraTrackSegmentSourcesMatchActive(i, active)
            ) {
                return true;
            }
        }
        return false;
    }

    function applyReviewMixCrossfadeGainsIfNeeded() {
        if (!isTransportPlayingForExtra()) return;
        const ctx = ensureReviewMixCtx();
        if (!ctx) return;
        ensureJoinedBoundaryCrossfadePlayback(ctx);
        const gainT = getCrossfadeGainTransportSec();
        const active =
            typeof getActiveExtraSegmentsAtTransport === 'function'
                ? getActiveExtraSegmentsAtTransport(gainT)
                : [];
        if (!active.length) return;
        applySegmentFadeGainsForActive(ctx, active, gainT);
        if (active.length < 2) return;
        const inJoinedOverlap = activeHasJoinedBoundaryCrossfadeAtTransport(
            active,
            gainT,
        );
        const inManualOverlap = activeHasManualCrossfadeOverlapAtTransport(
            active,
            gainT,
        );
        if (
            !inJoinedOverlap &&
            !inManualOverlap &&
            !segmentSourcesReadyForActive(active)
        ) {
            return;
        }
        applySegmentCrossfadeGains(ctx, active, gainT);
    }

    function extraTrackSegmentSourcesDrifted(slot, allActiveAtT, targetSec, ctx) {
        const mapT =
            typeof getSegmentMappingTransportSec === 'function'
                ? getSegmentMappingTransportSec()
                : targetSec;
        if (slotHasJoinedBoundaryCrossfadeAtTransport(slot, mapT)) {
            return false;
        }
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.segmentSources) return false;
        const wanted = wantedSegmentKeysForSlot(slot, allActiveAtT);
        for (const k of wanted) {
            const entry = tr.segmentSources[k];
            if (!entry || !entry.src || !isSegmentSourceAudibleOnCtx(entry, ctx)) {
                continue;
            }
            const expected = expectedTransportSecForSegmentEntry(entry, ctx);
            if (
                expected == null ||
                Math.abs(expected - targetSec) > EXTRA_AUDIO_RESYNC_DRIFT_SEC
            ) {
                return true;
            }
        }
        return false;
    }

    function canTryIncrementalRegionSegmentSync(targetSec, ctx, allActiveAtT) {
        if (extraTrackRoutingMismatch()) return false;
        let needsWork = false;
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const trackRef = { type: 'extra', slot: i };
            if (
                typeof isTrackRegionActive !== 'function' ||
                !isTrackRegionActive(trackRef)
            ) {
                continue;
            }
            if (extraTrackSegmentSourcesDrifted(i, allActiveAtT, targetSec, ctx)) {
                return false;
            }
            if (!extraTrackSegmentSourcesMatchActive(i, allActiveAtT)) {
                needsWork = true;
            }
        }
        return needsWork;
    }

    function applyIncrementalRegionSegmentSync(ctx, masterT, mapT, allActiveAtT, opt) {
        ensureJoinedBoundaryCrossfadePlayback(ctx, opt);
        const gainT = getCrossfadeGainTransportSec();
        const scheduleWhen = acquireExtraMixScheduleTime(ctx, opt);
        const crossfadeGains = computeSegmentCrossfadeGainsForActive(
            ctx,
            allActiveAtT,
            gainT,
        );
        const crossfadeActive = reviewMixHasCrossfadeAtTransport(gainT);
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const trackRef = { type: 'extra', slot: i };
            const regionActive =
                typeof isTrackRegionActive === 'function'
                    ? isTrackRegionActive(trackRef)
                    : false;
            if (!regionActive) continue;
            const tr = extraTrackBySlot(i);
            if (!tr || !shouldExtraTrackSourceBePlaying(i)) continue;
            ensureExtraTrackMixRouting(i, ctx);
            const activeAtT = allActiveAtT
                .filter((s) => s.slot === i)
                .sort((a, b) => a.segmentIndex - b.segmentIndex);
            for (const segHit of activeAtT) {
                const g = segmentPlaybackGainLinear(
                    segHit,
                    crossfadeGains.get(segHit.key) ?? 1,
                    gainT,
                );
                const existing = tr.segmentSources && tr.segmentSources[segHit.key];
                if (existing && existing.pendingLiveStretch && !existing.src) {
                    continue;
                }
                if (
                    !existing ||
                    !existing.src
                ) {
                    if (
                        typeof shouldDeferIncomingSourceAtContinuousJoinedBoundary ===
                            'function' &&
                        shouldDeferIncomingSourceAtContinuousJoinedBoundary(
                            trackRef,
                            segHit,
                            gainT,
                            tr,
                            activeAtT,
                        )
                    ) {
                        continue;
                    }
                    if (
                        segHit.segmentIndex > 0 &&
                        typeof isSegmentBoundaryJoined === 'function' &&
                        isSegmentBoundaryJoined(trackRef, segHit.segmentIndex - 1) &&
                        !(
                            typeof hasExtendedCrossfadeOverlapAtBoundary ===
                                'function' &&
                            hasExtendedCrossfadeOverlapAtBoundary(
                                trackRef,
                                segHit.segmentIndex - 1,
                            )
                        ) &&
                        typeof refreshSegmentHitAtTransport === 'function'
                    ) {
                        const priorAudible = Object.keys(
                            tr.segmentSources || {},
                        ).filter(
                            (k) =>
                                tr.segmentSources[k] &&
                                tr.segmentSources[k].src,
                        );
                        if (priorAudible.length === 1) {
                            const leftHit = activeAtT.find(
                                (s) =>
                                    s.segmentIndex === segHit.segmentIndex - 1,
                            );
                            const refreshedLeft = leftHit
                                ? refreshSegmentHitAtTransport(
                                      trackRef,
                                      leftHit,
                                      gainT,
                                  )
                                : null;
                            const leftEntry =
                                refreshedLeft &&
                                tr.segmentSources &&
                                tr.segmentSources[refreshedLeft.key];
                            if (leftEntry && leftEntry.src) {
                                const gLeft = segmentPlaybackGainLinear(
                                    refreshedLeft,
                                    crossfadeGains.get(refreshedLeft.key) ?? 1,
                                    gainT,
                                );
                                applySegmentEntryGain(leftEntry, gLeft, ctx, {
                                    rampSec: 0.008,
                                    inCrossfade: true,
                                });
                            }
                        }
                    }
                    startExtraTrackSegmentSource(i, segHit, g, scheduleWhen, ctx, {
                        force: false,
                        transportSec: gainT,
                    });
                } else {
                    const inCf =
                        activeAtT.length > 1 &&
                        (crossfadeActive ||
                            activeHasJoinedBoundaryCrossfadeAtTransport(
                                activeAtT,
                                gainT,
                            ));
                    applySegmentEntryGain(existing, g, ctx, {
                        rampSec: inCf ? 0.008 : 0.05,
                        inCrossfade: inCf,
                    });
                }
            }
        }
        pruneExtraSegmentSourcesToActive(allActiveAtT, ctx);
        if (allActiveAtT.length >= 2) {
            applySegmentCrossfadeGains(ctx, allActiveAtT, getCrossfadeGainTransportSec());
        }
    }

    function extraTracksNeedResync(targetSec, ctx) {
        if (extraTrackRoutingMismatch()) return true;
        const mapT =
            typeof getSegmentMappingTransportSec === 'function'
                ? getSegmentMappingTransportSec()
                : targetSec;
        const allActiveAtT =
            typeof getActiveExtraSegmentsAtTransport === 'function'
                ? getActiveExtraSegmentsAtTransport(mapT)
                : [];
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackAudible(i)) continue;
            if (!shouldExtraTrackSourceBePlaying(i)) {
                const tr = extraTrackBySlot(i);
                if (tr && tr.source) return true;
                continue;
            }
            const trackRef = { type: 'extra', slot: i };
            const regionActive =
                typeof isTrackRegionActive === 'function'
                    ? isTrackRegionActive(trackRef)
                    : false;
            if (regionActive) {
                if (extraTrackSegmentSourcesDrifted(i, allActiveAtT, targetSec, ctx)) {
                    return true;
                }
                if (!extraTrackSegmentSourcesMatchActive(i, allActiveAtT)) {
                    return false;
                }
                continue;
            }
            const tr = extraTrackBySlot(i);
            if (!tr || !tr.source) return true;
            if (!isExtraTrackSourceAudibleOnCtx(tr, ctx)) continue;
            const expected = expectedTransportSecForTrack(tr, ctx, i);
            if (
                expected == null ||
                Math.abs(expected - targetSec) > EXTRA_AUDIO_RESYNC_DRIFT_SEC
            ) {
                return true;
            }
        }
        return false;
    }

    function acquireExtraMixScheduleTime(ctx, opt) {
        if (opt && opt.when != null && Number.isFinite(opt.when)) {
            return opt.when;
        }
        const when = Math.max(
            ctx.currentTime + EXTRA_AUDIO_SCHEDULE_AHEAD_SEC,
            extraMixScheduleCtxTime || 0,
        );
        extraMixScheduleCtxTime = when;
        return when;
    }

    function stopExtraTrackSource(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.source) return;
        try {
            tr.source.stop();
        } catch (_) {}
        try {
            tr.source.disconnect();
        } catch (_) {}
        tr.source = null;
        clearExtraTrackPlaybackAnchor(tr);
    }

    function stopAllExtraTrackSources() {
        resetExtraMixScheduleTime();
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) stopExtraTrackAllSources(i);
    }

    function extraAudioSourcesActive() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const tr = extraTrackBySlot(i);
            if (!tr || !isExtraTrackAudible(i)) continue;
            if (tr.source) return true;
            if (tr.segmentSources) {
                for (const k of Object.keys(tr.segmentSources)) {
                    if (tr.segmentSources[k] && tr.segmentSources[k].src) return true;
                }
            }
        }
        return false;
    }

    /** Transport position implied by running mix BufferSources (AudioContext clock). */
    function getTransportSecFromActiveExtraMix(ctx) {
        let best = null;
        let anyActive = false;
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackAudible(i)) continue;
            if (!shouldExtraTrackSourceBePlaying(i)) continue;
            const tr = extraTrackBySlot(i);
            if (!tr) continue;
            if (tr.segmentSources && Object.keys(tr.segmentSources).length) {
                for (const k of Object.keys(tr.segmentSources)) {
                    const entry = tr.segmentSources[k];
                    if (!entry || !entry.src || !isSegmentSourceAudibleOnCtx(entry, ctx)) {
                        continue;
                    }
                    anyActive = true;
                    const expected = expectedTransportSecForSegmentEntry(entry, ctx);
                    if (expected == null || !Number.isFinite(expected)) return null;
                    if (best == null || expected > best) best = expected;
                }
                continue;
            }
            if (!tr.source || !isExtraTrackSourceAudibleOnCtx(tr, ctx)) continue;
            anyActive = true;
            const expected = expectedTransportSecForTrack(tr, ctx, i);
            if (expected == null || !Number.isFinite(expected)) return null;
            if (best == null || expected > best) best = expected;
        }
        return anyActive ? best : null;
    }

    /** リージョン境界のセグメント判定に使うタイムライン秒（実際に鳴っている位置を優先） */
    function getSegmentMappingTransportSec() {
        const barT = getAudioSyncTransportSec();
        if (!isTransportPlayingForExtra()) return barT;
        const ctx = ensureReviewMixCtx();
        if (!ctx) return barT;
        const fromMix = getTransportSecFromActiveExtraMix(ctx);
        if (fromMix != null && Number.isFinite(fromMix)) return fromMix;
        return barT;
    }

    /**
     * Enter post-video tail without restarting extra sources (avoids a gap at video end).
     * @returns {number} transport seconds to use for the tail clock
     */
    function handoffReviewMixToTransportTail() {
        applyReviewMixVideoGain();
        const ctx = ensureReviewMixCtx();
        const barT =
            typeof getTransportSec === 'function'
                ? getTransportSec()
                : videoMain
                  ? videoMain.currentTime || 0
                  : 0;
        const vd = getVideoTransportDurationSecForMix();
        if (ctx) {
            const fromMix = getTransportSecFromActiveExtraMix(ctx);
            if (fromMix != null && Number.isFinite(fromMix)) {
                return fromMix;
            }
        }
        const startAt = vd > 0 ? Math.max(barT, vd) : barT;
        if (
            typeof extraAudioSourcesActive !== 'function' ||
            !extraAudioSourcesActive()
        ) {
            syncReviewMixToTransport({ force: true });
        }
        return startAt;
    }

    function mimeTypeHintForAudioFileName(name) {
        const s = String(name || '').toLowerCase();
        const dot = s.lastIndexOf('.');
        const ext = dot >= 0 ? s.slice(dot) : '';
        const map = {
            '.wav': 'audio/wav',
            '.wave': 'audio/wav',
            '.flac': 'audio/flac',
            '.ogg': 'audio/ogg',
            '.oga': 'audio/ogg',
            '.mp3': 'audio/mpeg',
            '.m4a': 'audio/mp4',
            '.aac': 'audio/aac',
            '.aif': 'audio/aiff',
            '.aiff': 'audio/aiff',
            '.wma': 'audio/x-ms-wma',
            '.opus': 'audio/opus',
            '.webm': 'audio/webm',
        };
        return map[ext] || 'application/octet-stream';
    }

    function cacheExtraTrackPersistBlob(tr, file, ab) {
        if (!tr || !file || !ab || ab.byteLength < 1) {
            if (tr) tr.persistBlob = null;
            return null;
        }
        const type =
            file.type ||
            (typeof mimeTypeHintForAudioFileName === 'function'
                ? mimeTypeHintForAudioFileName(file.name)
                : 'application/octet-stream');
        tr.persistBlob = new Blob([ab.slice(0)], { type });
        return tr.persistBlob;
    }

    function cacheExtraClipPersistBlob(clip, file, ab) {
        if (!clip || !file || !ab || ab.byteLength < 1) {
            if (clip) clip.persistBlob = null;
            return null;
        }
        const type =
            file.type ||
            (typeof mimeTypeHintForAudioFileName === 'function'
                ? mimeTypeHintForAudioFileName(file.name)
                : 'application/octet-stream');
        clip.persistBlob = new Blob([ab.slice(0)], { type });
        return clip.persistBlob;
    }

    /** getPlaybackRegionPersistSnapshot と同じ経路でリージョンを収集（0/1 不一致防止） */
    function appendRegionFieldsToExtraTrackPersistEntry(entry, slot) {
        if (!entry || !(slot >= 0)) return;
        const track = { type: 'extra', slot };
        if (typeof getTrackSegments !== 'function') return;
        const segments = getTrackSegments(track);
        if (!segments.length) return;
        entry.regionSegments = segments.map((seg, segIndex) => {
            const raw =
                typeof getRawSegmentEntry === 'function'
                    ? getRawSegmentEntry(track, segIndex)
                    : null;
            const out = {
                id: seg.id,
                clipId: seg.clipId,
                sourceInSec: seg.sourceInSec,
                sourceOutSec: seg.sourceOutSec,
            };
            if (raw && Number.isFinite(raw.timelineStartSec)) {
                out.timelineStartSec = raw.timelineStartSec;
            }
            if (raw && Number.isFinite(raw.regionTimelineInSec)) {
                out.regionTimelineInSec = raw.regionTimelineInSec;
            }
            if (raw && Number.isFinite(raw.regionLeadPadSec)) {
                out.regionLeadPadSec = raw.regionLeadPadSec;
            }
            if (raw && Number.isFinite(raw.gainDb) && Math.abs(raw.gainDb) > 0.0005) {
                out.gainDb = raw.gainDb;
            }
            if (raw && Number.isFinite(raw.pitchSemitones) && raw.pitchSemitones !== 0) {
                out.pitchSemitones = Math.round(raw.pitchSemitones);
            }
            if (raw && Number.isFinite(raw.fadeInSec) && raw.fadeInSec > 0.0005) {
                out.fadeInSec = raw.fadeInSec;
            }
            if (raw && Number.isFinite(raw.fadeOutSec) && raw.fadeOutSec > 0.0005) {
                out.fadeOutSec = raw.fadeOutSec;
            }
            return out;
        });
        if (typeof getPlaybackRegionsState !== 'function') return;
        const state = getPlaybackRegionsState(track);
        if (!state) return;
        if (Number.isFinite(state.headPadSec) && state.headPadSec > 0) {
            entry.regionHeadPadSec = state.headPadSec;
        } else {
            delete entry.regionHeadPadSec;
        }
        if (Number.isFinite(state.regionTimelineInSec)) {
            entry.regionTimelineInSec = state.regionTimelineInSec;
        } else {
            delete entry.regionTimelineInSec;
        }
        if (Number.isFinite(state.regionLeadPadSec) && state.regionLeadPadSec > 0) {
            entry.regionLeadPadSec = state.regionLeadPadSec;
        } else {
            delete entry.regionLeadPadSec;
        }
    }

    function getExtraTrackPersistEntry(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.file || !tr.buffer || !tr.persistBlob || tr.persistBlob.size < 1) {
            return null;
        }
        const peaks = clonePeaksForPersist(tr.peaks);
        const timelineStart = getExtraTrackTimelineStartSec(slot);
        const entry = {
            slot,
            name: tr.file.name,
            lastModified: tr.file.lastModified,
            blob: tr.persistBlob,
            byteLength: tr.persistBlob.size,
            duration: tr.buffer.duration,
            peaks,
            timelineStartSec: timelineStart > 0 ? timelineStart : 0,
        };
        appendRegionFieldsToExtraTrackPersistEntry(entry, slot);
        const clips = ensureExtraTrackClips(tr);
        if (clips.length > 1) {
            entry.clips = clips
                .map((c) => {
                    if (!c.persistBlob || c.persistBlob.size < 1) return null;
                    return {
                        id: c.id,
                        name: c.file ? c.file.name : c.name || 'audio',
                        lastModified: c.file ? c.file.lastModified : Date.now(),
                        blob: c.persistBlob,
                        byteLength: c.persistBlob.size,
                        duration: c.buffer && c.buffer.duration > 0 ? c.buffer.duration : 0,
                        peaks: clonePeaksForPersist(c.peaks),
                    };
                })
                .filter(Boolean);
        }
        return entry;
    }

