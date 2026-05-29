/**
 * extra-audio-crossfade.js — Ex crossfade, joined-boundary playback, segment sources.
 */
    function extraMinCrossfadeOverlapSec() {
        const v = window.EXTRA_AUDIO_MIN_CROSSFADE_OVERLAP_SEC;
        return typeof v === 'number' ? v : 0.005;
    }

    function segmentRegionGainLinear(segHit, transportSec) {
        if (!segHit || typeof getSegmentGainLinear !== 'function') return 1;
        const track = { type: 'extra', slot: segHit.slot };
        const t = Number.isFinite(transportSec) ? transportSec : segHit.transportSec;
        if (typeof getSegmentPlaybackGainLinear === 'function') {
            return getSegmentPlaybackGainLinear(track, segHit.segmentIndex, t);
        }
        return getSegmentGainLinear(track, segHit.segmentIndex);
    }

    function segmentPlaybackGainLinear(segHit, crossfadeLinear, transportSec) {
        const cf = Number.isFinite(crossfadeLinear) ? crossfadeLinear : 1;
        const t = Number.isFinite(transportSec) ? transportSec : segHit.transportSec;
        return cf * segmentRegionGainLinear(segHit, t);
    }

    /**
     * 結合境界: 入側の BufferSource が未作成の間だけ出側=1・入側=0。
     * 両方ある場合は等パワー曲線をそのまま両セグメントへ適用する。
     */
    function withCrossfadeGainsDeferredUntilIncomingAudible(ctx, active, transportSec, gains) {
        if (!ctx || !active || active.length < 2 || !gains) return gains;
        const out = new Map(gains);
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return out;
        for (let i = 0; i < active.length; i++) {
            for (let j = i + 1; j < active.length; j++) {
                if (active[i].slot !== active[j].slot) continue;
                const oStart = Math.max(
                    active[i].timelineStart,
                    active[j].timelineStart,
                );
                const oEnd = Math.min(active[i].timelineEnd, active[j].timelineEnd);
                if (
                    oEnd - oStart < extraMinCrossfadeOverlapSec() ||
                    t < oStart ||
                    t > oEnd
                ) {
                    continue;
                }
                if (
                    typeof shouldSkipManualJoinedEqualPowerPair === 'function' &&
                    shouldSkipManualJoinedEqualPowerPair(active, i, j)
                ) {
                    continue;
                }
                const { out: outIdx, in: inIdx } = crossfadeOutInIndices(active, i, j);
                const inHit = active[inIdx];
                const outHit = active[outIdx];
                const tr = extraTrackBySlot(inHit.slot);
                const inEntry =
                    tr && tr.segmentSources ? tr.segmentSources[inHit.key] : null;
                const outEntry =
                    tr && tr.segmentSources ? tr.segmentSources[outHit.key] : null;
                if (inEntry && inEntry.src && outEntry && outEntry.src) {
                    continue;
                }
                if (!inEntry || !inEntry.src) {
                    const outCf = gains.get(outHit.key) ?? 1;
                    out.set(outHit.key, outCf);
                    out.set(inHit.key, 0);
                    continue;
                }
                if (
                    inEntry.src &&
                    (!outEntry || !outEntry.src) &&
                    !isSegmentSourceAudibleOnCtx(inEntry, ctx)
                ) {
                    const outCf = gains.get(outHit.key) ?? 1;
                    out.set(outHit.key, outCf);
                    out.set(inHit.key, 0);
                }
            }
        }
        return out;
    }

    function getCrossfadeGainTransportSec() {
        return typeof getAudioSyncTransportSec === 'function'
            ? getAudioSyncTransportSec()
            : typeof getSegmentMappingTransportSec === 'function'
              ? getSegmentMappingTransportSec()
              : 0;
    }

    function joinedBoundaryCrossfadeSec() {
        return typeof window.JOINED_BOUNDARY_CROSSFADE_SEC === 'number'
            ? window.JOINED_BOUNDARY_CROSSFADE_SEC
            : 1;
    }

    function activeHasManualCrossfadeOverlapAtTransport(active, transportSec) {
        const t = Number(transportSec);
        if (!Number.isFinite(t) || !active || active.length < 2) return false;
        const bySlot = new Map();
        for (let i = 0; i < active.length; i++) {
            const hit = active[i];
            if (!bySlot.has(hit.slot)) bySlot.set(hit.slot, []);
            bySlot.get(hit.slot).push(hit);
        }
        for (const slotHits of bySlot.values()) {
            if (slotHits.length < 2) continue;
            const trackRef = { type: 'extra', slot: slotHits[0].slot };
            for (let i = 0; i < slotHits.length; i++) {
                for (let j = i + 1; j < slotHits.length; j++) {
                    const a = slotHits[i];
                    const b = slotHits[j];
                    const oStart = Math.max(a.timelineStart, b.timelineStart);
                    const oEnd = Math.min(a.timelineEnd, b.timelineEnd);
                    const overlap = oEnd - oStart;
                    if (overlap < extraMinCrossfadeOverlapSec()) continue;
                    if (t < oStart - 0.0005 || t > oEnd + 0.0005) continue;
                    const lo =
                        a.segmentIndex < b.segmentIndex ? a : b;
                    const hi =
                        a.segmentIndex < b.segmentIndex ? b : a;
                    if (
                        hi.segmentIndex === lo.segmentIndex + 1 &&
                        typeof isSegmentBoundaryJoined === 'function' &&
                        isSegmentBoundaryJoined(trackRef, lo.segmentIndex) &&
                        !(
                            typeof hasExtendedCrossfadeOverlapAtBoundary ===
                                'function' &&
                            hasExtendedCrossfadeOverlapAtBoundary(
                                trackRef,
                                lo.segmentIndex,
                            )
                        )
                    ) {
                        if (
                            typeof hasManualSegmentFadeAtJoinedBoundary ===
                                'function' &&
                            hasManualSegmentFadeAtJoinedBoundary(
                                trackRef,
                                lo.segmentIndex,
                            ) &&
                            typeof getManualJoinedBoundaryFadeZone === 'function'
                        ) {
                            const zone = getManualJoinedBoundaryFadeZone(
                                trackRef,
                                lo.segmentIndex,
                            );
                            if (
                                zone &&
                                t >= zone.startSec - 0.0005 &&
                                t <= zone.endSec + 0.0005
                            ) {
                                return true;
                            }
                        }
                        continue;
                    }
                    return true;
                }
            }
        }
        return false;
    }

    function computeSegmentCrossfadeGainsForActive(ctx, active, transportSec) {
        const gains = computeEqualPowerCrossfadeGains(active, transportSec);
        if (
            activeHasJoinedBoundaryCrossfadeAtTransport(active, transportSec) ||
            activeHasManualCrossfadeOverlapAtTransport(active, transportSec)
        ) {
            return gains;
        }
        return withCrossfadeGainsDeferredUntilIncomingAudible(
            ctx,
            active,
            transportSec,
            gains,
        );
    }

    /** 結合境界の手動 Fade Out/In: 重なり開始前に右セグメントを起動 */
    function ensureManualJoinedBoundaryFadePlayback(ctx, opt) {
        if (!ctx || !isTransportPlayingForExtra()) return;
        if (
            typeof getManualJoinedBoundaryFadeZone !== 'function' ||
            typeof hasManualSegmentFadeAtJoinedBoundary !== 'function'
        ) {
            return;
        }
        const gainT = getCrossfadeGainTransportSec();
        const leadSec = 0.06;
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const trackRef = { type: 'extra', slot: i };
            if (
                typeof isTrackRegionActive !== 'function' ||
                !isTrackRegionActive(trackRef) ||
                !shouldExtraTrackSourceBePlaying(i)
            ) {
                continue;
            }
            const tr = extraTrackBySlot(i);
            if (!tr) continue;
            const segCount =
                typeof getTrackSegmentCount === 'function'
                    ? getTrackSegmentCount(i)
                    : 0;
            if (segCount < 2) continue;
            ensureExtraTrackMixRouting(i, ctx);
            for (let b = 0; b < segCount - 1; b++) {
                if (!hasManualSegmentFadeAtJoinedBoundary(trackRef, b)) continue;
                const zone = getManualJoinedBoundaryFadeZone(trackRef, b);
                if (!zone) continue;
                if (!(zone.fadeIn > 0.0005)) continue;
                if (gainT < zone.startSec - leadSec - 0.0005) continue;
                if (gainT > zone.endSec + 0.0005) continue;
                const probeT = Math.max(zone.startSec, gainT);
                const hitsAtProbe =
                    typeof getActiveExtraSegmentsAtTransport === 'function'
                        ? getActiveExtraSegmentsAtTransport(probeT).filter(
                              (s) => s.slot === i,
                          )
                        : [];
                const startHit = hitsAtProbe.find((h) => h.segmentIndex === b + 1);
                if (!startHit) continue;
                const rightEntry = tr.segmentSources && tr.segmentSources[startHit.key];
                if (rightEntry && rightEntry.src) continue;
                const gRight = segmentPlaybackGainLinear(
                    startHit,
                    1,
                    Math.max(zone.boundaryT, gainT),
                );
                const scheduleWhen =
                    opt && opt.when != null && Number.isFinite(opt.when)
                        ? opt.when
                        : ctx.currentTime + 0.001;
                startExtraTrackSegmentSource(i, startHit, gRight, scheduleWhen, ctx, {
                    force: false,
                    transportSec: gainT,
                });
            }
            const slotActive =
                typeof getActiveExtraSegmentsAtTransport === 'function'
                    ? getActiveExtraSegmentsAtTransport(gainT).filter((s) => s.slot === i)
                    : [];
            if (slotActive.length >= 2) {
                applySegmentCrossfadeGains(ctx, slotActive, gainT);
            }
        }
    }

    /**
     * 非連続の結合スプリット境界: 重なり開始前に入側を起動し、両方へクロスフェードゲインを適用する。
     */
    function ensureJoinedBoundaryCrossfadePlayback(ctx, opt) {
        if (!ctx || !isTransportPlayingForExtra()) return;
        ensureManualJoinedBoundaryFadePlayback(ctx, opt);
        const gainT = getCrossfadeGainTransportSec();
        const fadeW = joinedBoundaryCrossfadeSec();
        const scheduleProbeT = gainT + Math.min(0.12, fadeW * 0.15);
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const trackRef = { type: 'extra', slot: i };
            if (
                typeof isTrackRegionActive !== 'function' ||
                !isTrackRegionActive(trackRef) ||
                !shouldExtraTrackSourceBePlaying(i)
            ) {
                continue;
            }
            const tr = extraTrackBySlot(i);
            if (!tr) continue;
            ensureExtraTrackMixRouting(i, ctx);
            const activeNow =
                typeof getActiveExtraSegmentsAtTransport === 'function'
                    ? getActiveExtraSegmentsAtTransport(gainT).filter((s) => s.slot === i)
                    : [];
            const activeSoon =
                typeof getActiveExtraSegmentsAtTransport === 'function'
                    ? getActiveExtraSegmentsAtTransport(scheduleProbeT).filter(
                          (s) => s.slot === i,
                      )
                    : [];
            const byIndex = new Map();
            for (const h of activeSoon) byIndex.set(h.segmentIndex, h);
            for (const h of activeNow) byIndex.set(h.segmentIndex, h);
            const indices = Array.from(byIndex.keys()).sort((a, b) => a - b);
            for (let k = 0; k < indices.length - 1; k++) {
                const leftIdx = indices[k];
                const rightIdx = indices[k + 1];
                if (rightIdx !== leftIdx + 1) continue;
                if (
                    typeof isSegmentBoundaryJoined !== 'function' ||
                    !isSegmentBoundaryJoined(trackRef, leftIdx)
                ) {
                    continue;
                }
                const leftHit = byIndex.get(leftIdx);
                const rightHit = byIndex.get(rightIdx);
                if (!leftHit || !rightHit) continue;
                const pair = [leftHit, rightHit];
                if (
                    !activeHasJoinedBoundaryCrossfadeAtTransport(pair, gainT) &&
                    !activeHasJoinedBoundaryCrossfadeAtTransport(pair, scheduleProbeT)
                ) {
                    continue;
                }
                const gains = computeSegmentCrossfadeGainsForActive(ctx, pair, gainT);
                const leftEntry =
                    tr.segmentSources && tr.segmentSources[leftHit.key];
                const rightEntry =
                    tr.segmentSources && tr.segmentSources[rightHit.key];
                if (leftEntry && leftEntry.src) {
                    const gLeft = segmentPlaybackGainLinear(
                        leftHit,
                        gains.get(leftHit.key) ?? 1,
                        gainT,
                    );
                    applySegmentEntryGain(leftEntry, gLeft, ctx, {
                        rampSec: 0.008,
                        inCrossfade: true,
                    });
                }
                if (!rightEntry || !rightEntry.src) {
                    const gRight = segmentPlaybackGainLinear(
                        rightHit,
                        gains.get(rightHit.key) ?? 0,
                        gainT,
                    );
                    const scheduleWhen =
                        opt && opt.when != null && Number.isFinite(opt.when)
                            ? opt.when
                            : ctx.currentTime + 0.001;
                    startExtraTrackSegmentSource(i, rightHit, gRight, scheduleWhen, ctx, {
                        force: false,
                        transportSec: gainT,
                    });
                } else if (isSegmentSourceAudibleOnCtx(rightEntry, ctx)) {
                    const gRight = segmentPlaybackGainLinear(
                        rightHit,
                        gains.get(rightHit.key) ?? 1,
                        gainT,
                    );
                    applySegmentEntryGain(rightEntry, gRight, ctx, {
                        rampSec: 0.008,
                        inCrossfade: true,
                    });
                }
            }
            const slotActive =
                typeof getActiveExtraSegmentsAtTransport === 'function'
                    ? getActiveExtraSegmentsAtTransport(gainT).filter((s) => s.slot === i)
                    : [];
            if (slotActive.length >= 2) {
                applySegmentCrossfadeGains(ctx, slotActive, gainT);
            }
        }
    }

    /** 結合境界の重なり区間で複数セグメントが同時にアクティブか */
    function activeHasJoinedBoundaryCrossfadeAtTransport(active, transportSec) {
        const t = Number(transportSec);
        if (!Number.isFinite(t) || !active || active.length < 2) return false;
        if (typeof isSegmentBoundaryJoined !== 'function') return false;
        const bySlot = new Map();
        for (let i = 0; i < active.length; i++) {
            const hit = active[i];
            if (!bySlot.has(hit.slot)) bySlot.set(hit.slot, []);
            bySlot.get(hit.slot).push(hit);
        }
        for (const slotHits of bySlot.values()) {
            if (slotHits.length < 2) continue;
            slotHits.sort((a, b) => a.segmentIndex - b.segmentIndex);
            const trackRef = { type: 'extra', slot: slotHits[0].slot };
            for (let i = 0; i < slotHits.length - 1; i++) {
                const left = slotHits[i];
                const right = slotHits[i + 1];
                if (right.segmentIndex !== left.segmentIndex + 1) continue;
                if (
                    typeof isAutoJoinedBoundaryCrossfadeEligible !== 'function' ||
                    !isAutoJoinedBoundaryCrossfadeEligible(trackRef, left.segmentIndex)
                ) {
                    continue;
                }
                const oStart = Math.max(left.timelineStart, right.timelineStart);
                const oEnd = Math.min(left.timelineEnd, right.timelineEnd);
                if (
                    oEnd - oStart >= extraMinCrossfadeOverlapSec() &&
                    t >= oStart - 0.0005 &&
                    t <= oEnd + 0.0005
                ) {
                    return true;
                }
            }
        }
        return false;
    }

    function slotHasJoinedBoundaryCrossfadeAtTransport(slot, transportSec) {
        if (typeof getActiveExtraSegmentsAtTransport !== 'function') return false;
        const active = getActiveExtraSegmentsAtTransport(transportSec).filter(
            (s) => s.slot === slot,
        );
        return activeHasJoinedBoundaryCrossfadeAtTransport(active, transportSec);
    }

    function stopExtraTrackSegmentSourceEntry(entry) {
        if (!entry) return;
        try {
            if (entry.src) entry.src.stop();
        } catch (_) {}
        try {
            if (entry.src) entry.src.disconnect();
        } catch (_) {}
        try {
            if (entry.segGain) entry.segGain.disconnect();
        } catch (_) {}
        entry.lastAppliedGain = null;
    }

    function isSegmentSourceAudibleOnCtx(entry, ctx) {
        if (
            !entry ||
            entry.src == null ||
            !Number.isFinite(entry.playbackAnchorCtxTime)
        ) {
            return false;
        }
        return ctx.currentTime >= entry.playbackAnchorCtxTime - 0.0005;
    }

    function applySegmentEntryGain(entry, gainLinear, ctx, opt) {
        if (!entry || !entry.segGain) return;
        const now = ctx.currentTime;
        const g = Math.max(0, gainLinear);
        const inCrossfade = !!(opt && opt.inCrossfade);
        if (
            !inCrossfade &&
            entry.lastAppliedGain != null &&
            Math.abs(entry.lastAppliedGain - g) < 0.002
        ) {
            return;
        }
        entry.lastAppliedGain = g;
        const rampSec =
            opt && Number.isFinite(opt.rampSec) ? Math.max(0.001, opt.rampSec) : 0.05;
        try {
            entry.segGain.gain.cancelScheduledValues(now);
        } catch (_) {}
        const cur = entry.segGain.gain.value;
        entry.segGain.gain.setValueAtTime(cur, now);
        if (inCrossfade && rampSec > 0) {
            entry.segGain.gain.linearRampToValueAtTime(g, now + rampSec);
        } else {
            entry.segGain.gain.setTargetAtTime(g, now, rampSec);
        }
    }

    function extraTrackSourcesAudibleOnCtx(tr, ctx) {
        if (!tr || !ctx) return false;
        if (tr.source && isExtraTrackSourceAudibleOnCtx(tr, ctx)) return true;
        if (!tr.segmentSources) return false;
        for (const k of Object.keys(tr.segmentSources)) {
            if (isSegmentSourceAudibleOnCtx(tr.segmentSources[k], ctx)) {
                return true;
            }
        }
        return false;
    }

    function wantedSegmentKeysForSlot(slot, allActiveAtT) {
        const keys = new Set();
        if (!allActiveAtT) return keys;
        for (const segHit of allActiveAtT) {
            if (segHit.slot === slot) keys.add(segHit.key);
        }
        return keys;
    }

    function extraTrackSegmentSourcesMatchActive(slot, allActiveAtT) {
        const tr = extraTrackBySlot(slot);
        const track = { type: 'extra', slot };
        const regionActive =
            typeof isTrackRegionActive === 'function'
                ? isTrackRegionActive(track)
                : false;
        if (!regionActive) return true;
        const wanted = wantedSegmentKeysForSlot(slot, allActiveAtT);
        if (!wanted.size) {
            return !tr || !tr.segmentSources || !Object.keys(tr.segmentSources).length;
        }
        if (!tr || !tr.segmentSources) return false;
        for (const k of wanted) {
            const entry = tr.segmentSources[k];
            if (!entry || !entry.src) return false;
        }
        for (const k of Object.keys(tr.segmentSources)) {
            if (!wanted.has(k)) return false;
        }
        return true;
    }

    function shouldHoldOutgoingSegmentSource(slot, outgoingKey, allActiveAtT, ctx) {
        if (!ctx) return false;
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.segmentSources || !tr.segmentSources[outgoingKey]) return false;
        if (wantedSegmentKeysForSlot(slot, allActiveAtT).has(outgoingKey)) return false;
        for (let h = 0; h < allActiveAtT.length; h++) {
            const segHit = allActiveAtT[h];
            if (segHit.slot !== slot || segHit.key === outgoingKey) continue;
            const incoming = tr.segmentSources[segHit.key];
            if (!incoming || !incoming.src) return true;
            if (!isSegmentSourceAudibleOnCtx(incoming, ctx)) return true;
        }
        return false;
    }

    function pruneExtraSegmentSourcesToActive(allActiveAtT, ctx) {
        const mixCtx = ctx || ensureReviewMixCtx();
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const tr = extraTrackBySlot(i);
            if (!tr || !tr.segmentSources) continue;
            const wanted = wantedSegmentKeysForSlot(i, allActiveAtT);
            for (const k of Object.keys(tr.segmentSources)) {
                if (!wanted.has(k)) {
                    if (
                        mixCtx &&
                        shouldHoldOutgoingSegmentSource(i, k, allActiveAtT, mixCtx)
                    ) {
                        continue;
                    }
                    stopExtraTrackSegmentSourceEntry(tr.segmentSources[k]);
                    delete tr.segmentSources[k];
                }
            }
        }
    }

    function stopExtraTrackAllSources(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return;
        if (tr.segmentSources) {
            for (const k of Object.keys(tr.segmentSources)) {
                stopExtraTrackSegmentSourceEntry(tr.segmentSources[k]);
            }
            tr.segmentSources = {};
        }
        tr.mixRoutingReady = false;
        stopExtraTrackSource(slot);
    }
