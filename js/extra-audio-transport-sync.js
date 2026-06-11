/**
 * extra-audio-transport-sync.js — レビューミックスとトランスポート同期
 */
    function startExtraTrackSource(slot, offsetSec, opt) {
        const tr = extraTrackBySlot(slot);
        stopExtraTrackSource(slot);
        if (!tr || !tr.buffer || !isExtraTrackAudible(slot)) return;
        const ctx = ensureReviewMixCtx();
        if (!ctx) return;
        const master = ensureReviewMixMasterBus(ctx);
        if (!tr.gainNode) {
            tr.gainNode = ctx.createGain();
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
        applyExtraTrackLaneGain(slot);
        const off = Math.max(0, Number(offsetSec) || 0);
        const maxOff = Math.max(0, tr.buffer.duration - 0.002);
        const startAt = Math.min(off, maxOff);
        let remain = tr.buffer.duration - startAt;
        if (opt && Number.isFinite(opt.playRemainSec)) {
            remain = Math.min(remain, Math.max(0, opt.playRemainSec));
        }
        if (remain <= 0.002) return;
        const scheduleWhen = acquireExtraMixScheduleTime(ctx, opt);
        const src = ctx.createBufferSource();
        src.buffer = tr.buffer;
        connectMonoAudioCentered(src, tr.gainNode, tr.buffer.numberOfChannels);
        src.start(scheduleWhen, startAt, remain);
        tr.source = src;
        const transportAnchor =
            opt && Number.isFinite(opt.transportSec) ? opt.transportSec : off;
        tr.playbackAnchorTransportSec = transportAnchor;
        tr.playbackAnchorCtxTime = scheduleWhen;
        src.onended = () => {
            if (tr.source === src) {
                tr.source = null;
                clearExtraTrackPlaybackAnchor(tr);
            }
            scheduleMasterPlaybackFinishCheck();
        };
    }

    function extraTrackBufferDuration(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return 0;
        let max = 0;
        const clips = ensureExtraTrackClips(tr);
        for (const c of clips) {
            if (c.buffer && c.buffer.duration > max) max = c.buffer.duration;
        }
        if (max > 0) return max;
        return tr.buffer && tr.buffer.duration > 0 ? tr.buffer.duration : 0;
    }

    function isExtraTrackLoaded(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return false;
        const clips = ensureExtraTrackClips(tr);
        for (const c of clips) {
            if (c.buffer && c.buffer.duration > 0) return true;
        }
        return extraTrackBufferDuration(slot) > 0;
    }

    function syncReviewMixToTransport(opt) {
        const force = !!(opt && opt.force);
        const playing = isTransportPlayingForExtra();
        const masterT = getMasterTransportSecForAudioSync();
        const audioT = getAudioSyncTransportSec();
        const mapT =
            typeof getSegmentMappingTransportSec === 'function'
                ? getSegmentMappingTransportSec()
                : audioT;
        applyReviewMixVideoGain();
        if (!playing) {
            stopAllExtraTrackSources();
            if (typeof syncMetronomeToTransport === 'function') {
                syncMetronomeToTransport(opt);
            }
            return;
        }
        const ctx = ensureReviewMixCtx();
        if (!ctx) return;
        ensureJoinedBoundaryCrossfadePlayback(ctx, opt);
        const gainT = getCrossfadeGainTransportSec();
        const allActiveAtT =
            typeof getActiveExtraSegmentsAtTransport === 'function'
                ? getActiveExtraSegmentsAtTransport(gainT)
                : [];
        const crossfadeActive = reviewMixHasCrossfadeAtTransport(gainT);
        if (
            !force &&
            canTryIncrementalRegionSegmentSync(masterT, ctx, allActiveAtT)
        ) {
            applyIncrementalRegionSegmentSync(ctx, masterT, mapT, allActiveAtT, opt);
            applyReviewMixVideoGain();
            return;
        }
        if (
            !force &&
            crossfadeActive &&
            segmentSourcesReadyForActive(allActiveAtT) &&
            !extraTracksNeedResync(masterT, ctx)
        ) {
            applySegmentCrossfadeGains(
                ctx,
                allActiveAtT,
                getCrossfadeGainTransportSec(),
            );
            pruneExtraSegmentSourcesToActive(allActiveAtT, ctx);
            applyReviewMixVideoGain();
            return;
        }
        if (
            !force &&
            !crossfadeActive &&
            !extraTracksNeedResync(masterT, ctx) &&
            extraAudioSourcesActive()
        ) {
            applySegmentFadeGainsForActive(ctx, allActiveAtT, gainT);
            if (allActiveAtT.length >= 2) {
                if (
                    activeHasJoinedBoundaryCrossfadeAtTransport(
                        allActiveAtT,
                        gainT,
                    ) ||
                    activeHasManualCrossfadeOverlapAtTransport(
                        allActiveAtT,
                        gainT,
                    )
                ) {
                    applySegmentCrossfadeGains(ctx, allActiveAtT, gainT);
                }
            }
            pruneExtraSegmentSourcesToActive(allActiveAtT, ctx);
            applyReviewMixVideoGain();
            return;
        }
        if (
            !force &&
            segmentSourcesReadyForActive(allActiveAtT) &&
            extraAudioSourcesActive()
        ) {
            applySegmentFadeGainsForActive(ctx, allActiveAtT, gainT);
            if (allActiveAtT.length >= 2) {
                applySegmentCrossfadeGains(
                    ctx,
                    allActiveAtT,
                    getCrossfadeGainTransportSec(),
                );
            }
            pruneExtraSegmentSourcesToActive(allActiveAtT, ctx);
            applyReviewMixVideoGain();
            return;
        }
        resetExtraMixScheduleTime();
        if (
            typeof pitchPlaybackLog === 'function' &&
            typeof isDebugLogEnabled === 'function' &&
            isDebugLogEnabled()
        ) {
            const pendingPitch = allActiveAtT
                .filter((h) => {
                    const tr = extraTrackBySlot(h.slot);
                    const e =
                        tr && tr.segmentSources
                            ? tr.segmentSources[h.key]
                            : null;
                    return e && (e.pendingLiveStretch || e.usesLiveStretch);
                })
                .map((h) => ({
                    segmentIndex: h.segmentIndex,
                    key: h.key,
                }));
            pitchPlaybackLog('sync/full-resync', {
                force,
                crossfadeActive,
                sourcesReady: segmentSourcesReadyForActive(allActiveAtT),
                needResync: extraTracksNeedResync(masterT, ctx),
                activeCount: allActiveAtT.length,
                gainT,
                pendingPitch,
            });
        }
        const scheduleWhen = acquireExtraMixScheduleTime(ctx, opt);
        const crossfadeGains = computeSegmentCrossfadeGainsForActive(
            ctx,
            allActiveAtT,
            mapT,
        );
        applyReviewMixVideoGain();
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            stopExtraTrackSourceIfPastPlayableEnd(i);
            const tr = extraTrackBySlot(i);
            if (!shouldExtraTrackSourceBePlaying(i)) {
                stopExtraTrackAllSources(i);
                continue;
            }
            const trackRef = { type: 'extra', slot: i };
            const regionActive =
                typeof isTrackRegionActive === 'function'
                    ? isTrackRegionActive(trackRef)
                    : false;
            const activeAtT = allActiveAtT.filter((s) => s.slot === i);

            if (regionActive && activeAtT.length) {
                ensureExtraTrackMixRouting(i, ctx);
                for (const segHit of activeAtT) {
                    const g = segmentPlaybackGainLinear(
                        segHit,
                        crossfadeGains.get(segHit.key) ?? 1,
                        gainT,
                    );
                    startExtraTrackSegmentSource(i, segHit, g, scheduleWhen, ctx, {
                        force,
                        transportSec: gainT,
                    });
                }
                pruneExtraSegmentSourcesToActive(allActiveAtT, ctx);
                continue;
            }

            if (regionActive) {
                if (extraTrackHasAudibleOrImminentSegment(i, gainT)) {
                    continue;
                }
                stopExtraTrackAllSources(i);
                continue;
            }

            const timelineStart = getExtraTrackTimelineStartSec(i);
            let bufferOff = audioT - timelineStart;
            if (
                !tr ||
                !tr.buffer ||
                bufferOff < -0.0005 ||
                bufferOff >= tr.buffer.duration - 0.002
            ) {
                stopExtraTrackAllSources(i);
                continue;
            }
            let needsStart = force || !tr.source;
            if (!needsStart && tr.source && isExtraTrackSourceAudibleOnCtx(tr, ctx)) {
                const expected = expectedTransportSecForTrack(tr, ctx, i);
                needsStart =
                    expected == null ||
                    Math.abs(expected - masterT) > EXTRA_AUDIO_RESYNC_DRIFT_SEC;
            }
            if (!needsStart) continue;
            if (tr.segmentSources && Object.keys(tr.segmentSources).length) {
                stopExtraTrackAllSources(i);
            }
            startExtraTrackSource(i, bufferOff, {
                when: scheduleWhen,
                transportSec: masterT,
                playRemainSec: tr.buffer.duration - bufferOff,
            });
        }
        if (allActiveAtT.length >= 2) {
            applySegmentCrossfadeGains(
                ctx,
                allActiveAtT,
                getCrossfadeGainTransportSec(),
            );
        }
        if (typeof syncMetronomeToTransport === 'function') {
            const metTimerActive =
                typeof isMetronomeSyncTimerActive === 'function' &&
                isMetronomeSyncTimerActive();
            if (force || !metTimerActive) {
                syncMetronomeToTransport(opt);
            }
        }
    }

    function syncExtraAudioToTransport(opt) {
        syncReviewMixToTransport(opt);
    }

    /** Schedule the full mix (video element + extras) before video.play(). */
    async function primeReviewMixForPlayback() {
        const ctx = ensureReviewMixCtx();
        if (ctx && ctx.state === 'suspended') {
            try {
                await ctx.resume();
            } catch (_) {}
        }
        if (ctx && typeof warmupPitchStretchWorklet === 'function') {
            await warmupPitchStretchWorklet(ctx);
        }
        applyReviewMixVideoGain();
        if (ctx) {
            const mode = reviewMixVideoBoostPlayback
                ? 'capture boost'
                : reviewMixVideoWired
                  ? 'Web Audio (MES)'
                  : videoMonitorStreamSrc
                    ? 'native + monitor tap'
                    : 'native element';
            const g =
                reviewMixVideoBoostPlayback ||
                reviewMixVideoWired
                    ? getVideoTrackEffectiveGain()
                    : videoMain
                      ? videoMain.volume
                      : 0;
            writeLog(
                'Review mix: play — ctx=' +
                    ctx.state +
                    ' video=' +
                    (Number(g).toFixed ? Number(g).toFixed(3) : String(g)) +
                    ' (' +
                    mode +
                    ')',
            );
        }
        syncReviewMixToTransport({ force: true });
    }

    async function primeExtraAudioForPlayback() {
        return primeReviewMixForPlayback();
    }

    function extraTrackContentDurationSec(slot) {
        const track = { type: 'extra', slot };
        if (
            typeof isTrackRegionActive === 'function' &&
            isTrackRegionActive(track) &&
            typeof getTrackTimelineEndSec === 'function'
        ) {
            const end = getTrackTimelineEndSec(track);
            const start =
                typeof getExtraTrackTimelineStartSec === 'function'
                    ? getExtraTrackTimelineStartSec(slot)
                    : 0;
            return Math.max(0, end - start);
        }
        const tr = extraTrackBySlot(slot);
        if (!tr) return 0;
        if (tr.buffer && tr.buffer.duration > 0) return tr.buffer.duration;
        const hint = Number(tr.restoreDurationHint);
        return Number.isFinite(hint) && hint > 0 ? hint : 0;
    }

