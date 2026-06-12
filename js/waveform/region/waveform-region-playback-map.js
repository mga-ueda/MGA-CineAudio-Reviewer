/**
 * waveform-region-playback-map.js — transport マッピング・viewport peaks
 */
    function getTrackTimelineEndSec(track) {
        const segments = getTrackSegments(track);
        if (!segments.length) {
            const fullDur = getTrackSourceDurationSec(track);
            return getTrackTimelineStartSec(track) + (fullDur || 0);
        }
        let end = getTrackTimelineStartSec(track);
        for (let i = 0; i < segments.length; i++) {
            end = Math.max(end, getSegmentTimelineEnd(track, i));
        }
        return end;
    }

    function projectedTrackTimelineEndSec(track, segmentIndex, segmentTimelineEndSec) {
        const segments = getTrackSegments(track);
        if (!segments.length) {
            return getTrackTimelineStartSec(track) + (Number(segmentTimelineEndSec) || 0);
        }
        let end = getTrackTimelineStartSec(track);
        for (let i = 0; i < segments.length; i++) {
            const t =
                i === segmentIndex
                    ? Number(segmentTimelineEndSec) || 0
                    : getSegmentTimelineEnd(track, i);
            end = Math.max(end, t);
        }
        return end;
    }

    function mapTransportToSegment(track, transportSec) {
        const hits = mapAllSegmentsAtTransport(track, transportSec);
        return hits.length ? hits[0] : null;
    }

    function mapAllSegmentsAtTransport(track, transportSec, opt) {
        const segments = getTrackSegments(track);
        if (!segments.length) return [];
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return [];
        const forPlayback = !!(opt && opt.forPlayback);
        const hits = [];
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const regionIn = getSegmentRegionTimelineIn(track, i);
            const playbackStart = getSegmentPlaybackTimelineStart(track, i);
            const absEnd = getSegmentTimelineEnd(track, i);
            const absStart = forPlayback ? playbackStart : regionIn;

            const joinedNext =
                forPlayback &&
                i < segments.length - 1 &&
                isSegmentBoundaryJoined(track, i);
            const joinedPrev =
                forPlayback && i > 0 && isSegmentBoundaryJoined(track, i - 1);
            const boundaryNext = joinedNext ? absEnd : null;
            const boundaryPrev = joinedPrev ? getSegmentTimelineStart(track, i) : null;
            const manualFadePrev =
                joinedPrev &&
                i > 0 &&
                hasManualSegmentFadeAtJoinedBoundary(track, i - 1);
            const manualFadeNext =
                joinedNext &&
                i < segments.length - 1 &&
                hasManualSegmentFadeAtJoinedBoundary(track, i);
            const continuousPrev =
                forPlayback &&
                joinedPrev &&
                isSegmentSourceContinuousAtBoundary(track, i - 1);
            const continuousNext =
                forPlayback &&
                joinedNext &&
                isSegmentSourceContinuousAtBoundary(track, i);
            const pitchSplitNext =
                forPlayback &&
                joinedNext &&
                continuousNext &&
                typeof window.boundaryNeedsPitchPlaybackSplit === 'function' &&
                window.boundaryNeedsPitchPlaybackSplit(track, i);
            const autoCrossfadePrev =
                joinedPrev &&
                i > 0 &&
                isAutoJoinedBoundaryCrossfadeEligible(track, i - 1);
            const autoCrossfadeNext =
                joinedNext &&
                i < segments.length - 1 &&
                isAutoJoinedBoundaryCrossfadeEligible(track, i);
            const inHandoffFromPrev =
                autoCrossfadePrev &&
                !manualFadePrev &&
                !continuousPrev &&
                boundaryPrev != null &&
                t >= boundaryPrev - JOINED_BOUNDARY_CROSSFADE_SEC &&
                t < boundaryPrev + 0.00001;
            const inHandoffToNext =
                autoCrossfadeNext &&
                !manualFadeNext &&
                !continuousNext &&
                boundaryNext != null &&
                t >= boundaryNext - JOINED_BOUNDARY_CROSSFADE_SEC &&
                t < boundaryNext + 0.00001;
            let inManualCrossfade = false;
            if (forPlayback && manualFadePrev) {
                const zone = getManualJoinedBoundaryFadeZone(track, i - 1);
                if (
                    zone &&
                    t >= zone.startSec - 0.0005 &&
                    t <= zone.endSec + 0.0005
                ) {
                    inManualCrossfade = true;
                }
            }
            if (forPlayback && manualFadeNext) {
                const zone = getManualJoinedBoundaryFadeZone(track, i);
                if (
                    zone &&
                    t >= zone.startSec - 0.0005 &&
                    t <= zone.endSec + 0.0005
                ) {
                    inManualCrossfade = true;
                }
            }

            if (
                t < regionIn - 0.0005 &&
                !(
                    forPlayback &&
                    (inHandoffFromPrev || inManualCrossfade)
                )
            ) {
                continue;
            }
            if (forPlayback) {
                if (t < playbackStart - 0.0005 && !inHandoffFromPrev && !inManualCrossfade) {
                    continue;
                }
                let playbackEndCutoff =
                    joinedNext && continuousNext
                        ? absEnd + 0.00001
                        : absEnd - 0.0005;
                if (pitchSplitNext && boundaryNext != null) {
                    let pitchHandoffSec = 0;
                    if (
                        typeof window.pitchSplitBoundaryHandoffSec === 'function'
                    ) {
                        pitchHandoffSec = window.pitchSplitBoundaryHandoffSec(
                            track,
                            i,
                        );
                    } else if (
                        typeof window.pitchSliceExitBoundary === 'function' &&
                        window.pitchSliceExitBoundary(track, i)
                    ) {
                        pitchHandoffSec =
                            typeof window.PITCH_SLICE_EXIT_HANDOFF_SEC === 'number'
                                ? window.PITCH_SLICE_EXIT_HANDOFF_SEC
                                : 0.02;
                    } else {
                        pitchHandoffSec =
                            typeof window.PITCH_SPLIT_BOUNDARY_HANDOFF_SEC ===
                            'number'
                                ? window.PITCH_SPLIT_BOUNDARY_HANDOFF_SEC
                                : 0.12;
                    }
                    if (pitchHandoffSec > 0.0005) {
                        playbackEndCutoff = Math.max(
                            playbackEndCutoff,
                            boundaryNext + pitchHandoffSec,
                        );
                    } else {
                        playbackEndCutoff = Math.min(
                            playbackEndCutoff,
                            boundaryNext + 0.00001,
                        );
                    }
                }
                if (t >= playbackEndCutoff && !inHandoffToNext && !inManualCrossfade) {
                    continue;
                }
            } else if (t >= absEnd - 0.002) {
                continue;
            }

            let sourceSec;
            if (
                forPlayback &&
                inHandoffFromPrev &&
                i > 0 &&
                isSegmentSourceContinuousAtBoundary(track, i - 1)
            ) {
                /** 同一クリップ連続: 左セグメントのソース位置をそのまま使う（sourceInSec へクランプすると境界で飛ぶ） */
                sourceSec = segmentSourceSecFromTransport(track, i - 1, t);
                sourceSec = Math.min(seg.sourceOutSec, sourceSec);
            } else if (forPlayback && inHandoffFromPrev && t < playbackStart + 0.00001) {
                const fadeStart = boundaryPrev - JOINED_BOUNDARY_CROSSFADE_SEC;
                sourceSec = seg.sourceInSec + Math.max(0, t - fadeStart);
            } else if (t < playbackStart - 0.0005) {
                sourceSec = seg.sourceInSec;
            } else {
                sourceSec = segmentSourceSecFromTransport(track, i, t);
            }
            if (forPlayback && inManualCrossfade) {
                const boundaryIndex = manualFadePrev ? i - 1 : i;
                const zone = getManualJoinedBoundaryFadeZone(track, boundaryIndex);
                if (zone && isSegmentSourceContinuousAtBoundary(track, boundaryIndex)) {
                    sourceSec = segmentSourceSecForManualJoinedCrossfade(
                        track,
                        i,
                        t,
                        boundaryIndex,
                    );
                }
            }

            let timelineStart = absStart;
            let timelineEnd = absEnd;
            const skipJoinedCrossfadeClamp =
                forPlayback &&
                ((i > 0 &&
                    ((isSegmentBoundaryJoined(track, i - 1) &&
                        (hasExtendedCrossfadeOverlapAtBoundary(track, i - 1) ||
                            hasManualSegmentFadeAtJoinedBoundary(track, i - 1))) ||
                        hasTimelineOverlapAtBoundary(track, i - 1))) ||
                    (i < segments.length - 1 &&
                        ((isSegmentBoundaryJoined(track, i) &&
                            (hasExtendedCrossfadeOverlapAtBoundary(track, i) ||
                                hasManualSegmentFadeAtJoinedBoundary(track, i))) ||
                            hasTimelineOverlapAtBoundary(track, i))));
            if (forPlayback && !skipJoinedCrossfadeClamp && joinedPrev && boundaryPrev != null) {
                timelineStart = Math.min(
                    timelineStart,
                    boundaryPrev - JOINED_BOUNDARY_CROSSFADE_SEC,
                );
                timelineEnd = boundaryPrev;
            } else if (
                forPlayback &&
                !skipJoinedCrossfadeClamp &&
                joinedNext &&
                boundaryNext != null
            ) {
                timelineStart = Math.min(
                    timelineStart,
                    boundaryNext - JOINED_BOUNDARY_CROSSFADE_SEC,
                );
                timelineEnd = boundaryNext;
            }

            hits.push({
                slot: track.slot,
                segmentIndex: i,
                segmentId: seg.id,
                clipId: seg.clipId || getSegmentClipId(track, i),
                sourceSec,
                bufferOff: sourceSec,
                remain: Math.max(0, seg.sourceOutSec - sourceSec),
                timelineStart,
                timelineEnd,
                transportSec: t,
                key: track.slot + ':' + (seg.id || 'i' + i),
            });
        }
        return hits;
    }

    function mapTransportToSegmentForPlayback(track, transportSec) {
        const hits = mapAllSegmentsAtTransport(track, transportSec, { forPlayback: true });
        return hits.length ? hits[0] : null;
    }

    function refreshSegmentHitAtTransport(track, hit, transportSec) {
        const fresh = mapAllSegmentsAtTransport(track, transportSec, {
            forPlayback: true,
        }).find((h) => h.segmentIndex === hit.segmentIndex);
        return fresh || null;
    }

    function getActiveExtraSegmentsAtTransport(transportSec) {
        const all = [];
        const seen = new Set();
        const n =
            getExtraTrackCount();
        let t = Number(transportSec);
        if (!Number.isFinite(t)) return all;
        const scheduleAhead =
            typeof window.EXTRA_AUDIO_SCHEDULE_AHEAD_SEC === 'number'
                ? window.EXTRA_AUDIO_SCHEDULE_AHEAD_SEC
                : 0.02;
        /** 先読みはスケジュール余裕のみ（フェード幅ぶん早く拾うと bufferOff が未来のままになる） */
        const lookahead = scheduleAhead + 0.01;
        const probes = [t, t + lookahead];
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            if (!isTrackRegionActive(track)) continue;
            for (let p = 0; p < probes.length; p++) {
                const hits = mapAllSegmentsAtTransport(track, probes[p], {
                    forPlayback: true,
                });
                for (let i = 0; i < hits.length; i++) {
                    const hit = hits[i];
                    if (seen.has(hit.key)) continue;
                    if (
                        p > 0 &&
                        hit.segmentIndex > 0 &&
                        typeof pitchSliceEnterBoundary === 'function' &&
                        pitchSliceEnterBoundary(track, hit.segmentIndex - 1) &&
                        typeof getSegmentPlaybackTimelineStart === 'function'
                    ) {
                        const boundaryT = getSegmentPlaybackTimelineStart(
                            track,
                            hit.segmentIndex,
                        );
                        if (
                            Number.isFinite(boundaryT) &&
                            t < boundaryT - 0.0005
                        ) {
                            continue;
                        }
                    }
                    const refreshed = refreshSegmentHitAtTransport(track, hit, t);
                    if (!refreshed) continue;
                    seen.add(hit.key);
                    all.push(refreshed);
                }
            }
        }
        return all;
    }

    function transportSecToSegmentSourceSec(track, segmentIndex, transportSec) {
        return segmentSourceSecFromTransport(track, segmentIndex, transportSec);
    }

    function isTrackTransportAudible(track, transportSec) {
        return !!mapTransportToSegment(track, transportSec);
    }

    function slicePeaksForRegion(peaks, fullDurSec, sourceInSec, sourceOutSec) {
        if (!peaks || !peaks.length || !fullDurSec) return peaks;
        const inS = Math.max(0, Number(sourceInSec) || 0);
        const outS = Math.min(fullDurSec, Number(sourceOutSec) || fullDurSec);
        if (outS <= inS + 0.0005) return [];
        const i0 = Math.floor((inS / fullDurSec) * peaks.length);
        const i1 = Math.ceil((outS / fullDurSec) * peaks.length);
        return peaks.slice(Math.max(0, i0), Math.min(peaks.length, Math.max(i0 + 1, i1)));
    }

    function samplePeakAtSourceSec(peaks, fullDurSec, sourceSec) {
        if (!peaks || !peaks.length || !(fullDurSec > 0)) {
            return { max: 0, min: 0 };
        }
        const s = Math.max(0, Math.min(fullDurSec, Number(sourceSec) || 0));
        const pos = (s / fullDurSec) * peaks.length;
        const i0 = Math.max(0, Math.min(peaks.length - 1, Math.floor(pos)));
        const i1 = Math.min(peaks.length - 1, i0 + 1);
        if (i0 === i1) return peaks[i0];
        const f = pos - i0;
        return {
            max: peaks[i0].max * (1 - f) + peaks[i1].max * f,
            min: peaks[i0].min * (1 - f) + peaks[i1].min * f,
        };
    }

    /** 再生 map と同じソース秒（結合境界クロスフェードの先行区間を含む） */
    function segmentWaveformSourceSecAtTransport(track, segmentIndex, transportSec) {
        const hits = mapAllSegmentsAtTransport(track, transportSec, {
            forPlayback: true,
        });
        const hit = hits.find((h) => h.segmentIndex === segmentIndex);
        if (hit) return hit.sourceSec;
        return segmentSourceSecFromTransport(track, segmentIndex, transportSec);
    }

    function getSegmentWaveformHideBeforeTimeline(track, segmentIndex) {
        return Math.min(
            getSegmentWaveformVisibleTimelineStart(track, segmentIndex),
            getSegmentWaveformDrawTimelineStart(track, segmentIndex),
        );
    }

    /** 再生区間と同じ基準でセグメント同士のタイムライン重なりがあるか */
    function trackHasPlaybackSegmentOverlap(track) {
        const segments = getTrackSegments(track);
        for (let i = 0; i < segments.length; i++) {
            for (let j = i + 1; j < segments.length; j++) {
                const oStart = Math.max(
                    getSegmentPlaybackTimelineStart(track, i),
                    getSegmentPlaybackTimelineStart(track, j),
                );
                const oEnd = Math.min(
                    getSegmentTimelineEnd(track, i),
                    getSegmentTimelineEnd(track, j),
                );
                if (oEnd - oStart >= MIN_CROSSFADE_OVERLAP_SEC) return true;
            }
        }
        return false;
    }

    function computeWaveformSegmentCrossfadeLinear(track, hits, transportSec) {
        if (!hits || hits.length <= 1) return new Map();
        if (typeof computeEqualPowerCrossfadeGainsForGroup !== 'function') {
            return new Map();
        }
        return computeEqualPowerCrossfadeGainsForGroup(hits, transportSec, {
            groupBySlot: false,
            sameSlotOnly: false,
            trackRefFromHit: () => track,
        });
    }

    /**
     * 再生ミックスと同じゲイン（等パワー × segmentPlaybackGainLinear）でピークを合成。
     * 複数セグメントが同時に鳴る区間専用（単一セグメントは localPeak を使う）。
     */
    function lookupViewportPeakAtTransport(vp, segmentIndex, transportSec) {
        if (!vp || !vp.segments || !vp.segments.length) return null;
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return null;
        for (let i = 0; i < vp.segments.length; i++) {
            const s = vp.segments[i];
            if (s.segmentIndex !== segmentIndex) continue;
            if (t + 1e-9 < s.masterStartSec || t - 1e-9 > s.masterEndSec) continue;
            if (!s.peaks || !s.peaks.length) return null;
            const segDur = s.masterEndSec - s.masterStartSec;
            if (!(segDur > 1e-9)) return null;
            const pos = ((t - s.masterStartSec) / segDur) * s.peaks.length;
            const i0 = Math.max(0, Math.min(s.peaks.length - 1, Math.floor(pos)));
            const i1 = Math.min(s.peaks.length - 1, i0 + 1);
            if (i0 === i1) return s.peaks[i0];
            const f = pos - i0;
            return {
                max: s.peaks[i0].max * (1 - f) + s.peaks[i1].max * f,
                min: s.peaks[i0].min * (1 - f) + s.peaks[i1].min * f,
            };
        }
        return null;
    }

    function waveformPeakForHitAtTransport(track, slot, hit, transportSec, opt) {
        const vp = opt && opt.viewportPeaks;
        if (vp) {
            const vpPk = lookupViewportPeakAtTransport(
                vp,
                hit.segmentIndex,
                transportSec,
            );
            if (vpPk) return vpPk;
        }
        const segments = getTrackSegments(track);
        const seg = segments[hit.segmentIndex];
        if (!seg) return null;
        const fullDur = getSegmentSourceDurationSec(track, seg);
        const peaks = getSegmentPeaksForDraw(slot, hit.clipId);
        if (!peaks || !peaks.length || !(fullDur > 0)) return null;
        return samplePeakAtSourceSec(peaks, fullDur, hit.sourceSec);
    }

    function waveformPlaybackGainForHit(track, hit, hits, transportSec) {
        const cfGains = computeWaveformSegmentCrossfadeLinear(track, hits, transportSec);
        const cf = cfGains.get(hit.key) ?? 1;
        return cf * getSegmentPlaybackGainLinear(track, hit.segmentIndex, transportSec);
    }

    function computeWaveformMixPeakAtTransport(track, slot, transportSec, opt) {
        const hits = mapAllSegmentsAtTransport(track, transportSec, {
            forPlayback: true,
        });
        if (hits.length <= 1) return null;
        let sumMax = 0;
        let sumMin = 0;
        let any = false;
        for (let h = 0; h < hits.length; h++) {
            const hit = hits[h];
            const pk = waveformPeakForHitAtTransport(
                track,
                slot,
                hit,
                transportSec,
                opt,
            );
            if (!pk) continue;
            const gain = waveformPlaybackGainForHit(track, hit, hits, transportSec);
            sumMax += pk.max * gain;
            sumMin += pk.min * gain;
            any = true;
        }
        if (!any) return null;
        return { max: sumMax, min: sumMin };
    }

    function waveformGainForLocalSegment(track, hits, localSegmentIndex, barTransport) {
        const localHit = hits.find((h) => h.segmentIndex === localSegmentIndex);
        if (localHit) {
            return waveformPlaybackGainForHit(track, localHit, hits, barTransport);
        }
        return getSegmentPlaybackGainLinear(track, localSegmentIndex, barTransport);
    }

    function drawLocalWaveformBarAtTransport(
        ctx,
        track,
        hits,
        x,
        barW,
        mid,
        barTransport,
        localPeak,
        localSegmentIndex,
    ) {
        if (!localPeak) return;
        const gain = waveformGainForLocalSegment(
            track,
            hits,
            localSegmentIndex,
            barTransport,
        );
        fillWaveformBarFromPeak(ctx, x, barW, mid, localPeak, gain);
    }

    /** タイムライン位置の波形バー（重なり時は合成、それ以外は localPeak を使用） */
    function drawWaveformBarAtTransport(
        ctx,
        track,
        slot,
        x,
        barW,
        mid,
        barTransport,
        localPeak,
        localSegmentIndex,
        opt,
    ) {
        const hits = mapAllSegmentsAtTransport(track, barTransport, {
            forPlayback: true,
        });
        const hasLocal =
            typeof localSegmentIndex === 'number' &&
            localSegmentIndex >= 0 &&
            localPeak;

        if (hits.length > 1) {
            const mix = computeWaveformMixPeakAtTransport(track, slot, barTransport, opt);
            if (mix) {
                fillWaveformBarFromPeak(ctx, x, barW, mid, mix, 1);
                return;
            }
            if (hasLocal) {
                drawLocalWaveformBarAtTransport(
                    ctx,
                    track,
                    hits,
                    x,
                    barW,
                    mid,
                    barTransport,
                    localPeak,
                    localSegmentIndex,
                );
            }
            return;
        }

        if (hasLocal) {
            drawLocalWaveformBarAtTransport(
                ctx,
                track,
                hits,
                x,
                barW,
                mid,
                barTransport,
                localPeak,
                localSegmentIndex,
            );
            return;
        }

        if (hits.length === 1) {
            const hit = hits[0];
            const gain = waveformPlaybackGainForHit(track, hit, hits, barTransport);
            const pk = waveformPeakForHitAtTransport(
                track,
                slot,
                hit,
                barTransport,
                opt,
            );
            if (pk) fillWaveformBarFromPeak(ctx, x, barW, mid, pk, gain);
        }
    }

    function fillWaveformBarFromPeak(ctx, x, barW, mid, pk, gainScale) {
        const g = Number.isFinite(gainScale) ? gainScale : 1;
        const vScale =
            typeof getWaveformVerticalZoom === 'function' ? getWaveformVerticalZoom() : 1;
        const scale = g * (Number.isFinite(vScale) ? vScale : 1);
        const top = mid - Math.max(0.5, pk.max * scale * (mid - 2));
        const bot = mid - Math.min(-0.5, pk.min * scale * (mid - 2));
        ctx.fillRect(x, top, Math.max(1, barW + 0.5), Math.max(1, bot - top));
    }

    function trackWaveformNeedsCrossfadeVisualMap(track) {
        if (trackHasPlaybackSegmentOverlap(track)) return true;
        const segments = getTrackSegments(track);
        for (let b = 0; b < segments.length - 1; b++) {
            if (hasManualSegmentFadeAtJoinedBoundary(track, b)) return true;
            if (hasExtendedCrossfadeOverlapAtBoundary(track, b)) return true;
            if (isAutoJoinedBoundaryCrossfadeEligible(track, b)) return true;
        }
        return false;
    }

    function trackSegmentsAreContinuousSameClipChain(track) {
        const segments = getTrackSegments(track);
        if (segments.length <= 1) return false;
        const clip0 = segments[0].clipId || getSegmentClipId(track, 0);
        for (let i = 1; i < segments.length; i++) {
            const clip = segments[i].clipId || getSegmentClipId(track, i);
            if (clip !== clip0) return false;
            if (!isSegmentBoundaryJoined(track, i - 1)) return false;
            if (!isSegmentSourceContinuousAtBoundary(track, i - 1)) return false;
        }
        return true;
    }

    function segmentIndexAtMasterTransport(track, transportSec) {
        const segments = getTrackSegments(track);
        const t = Number(transportSec);
        if (!Number.isFinite(t) || !segments.length) return 0;
        for (let i = segments.length - 1; i >= 0; i--) {
            const start = getSegmentPlaybackTimelineStart(track, i);
            const end = getSegmentTimelineEnd(track, i);
            if (t >= start - 0.0005 && t < end + 0.0005) return i;
        }
        return 0;
    }

    /**
     * 波形 1 パス分の gain を前計算（バーごとの mapAllSegmentsAtTransport を避ける）。
     */
    function createWaveformVisualGainState(track) {
        const segments = getTrackSegments(track);
        const n = segments.length;
        if (!n) {
            return { simple: true, uniform: 1, at: () => 1 };
        }

        const segGain = [];
        const playStart = [];
        const playEnd = [];
        const fadeInSec = [];
        const fadeOutSec = [];
        const needsCrossfade = trackWaveformNeedsCrossfadeVisualMap(track);
        let needsManualDisplay = false;
        let uniformGain = null;

        for (let i = 0; i < n; i++) {
            const g = getSegmentGainLinear(track, i);
            segGain.push(g);
            playStart.push(getSegmentPlaybackTimelineStart(track, i));
            playEnd.push(getSegmentTimelineEnd(track, i));
            fadeInSec.push(getSegmentFadeDurationSec(track, i, 'in'));
            fadeOutSec.push(getSegmentFadeDurationSec(track, i, 'out'));
            if (fadeInSec[i] > 0.0005 || fadeOutSec[i] > 0.0005) {
                needsManualDisplay = true;
            }
            if (uniformGain === null) uniformGain = g;
            else if (Math.abs(uniformGain - g) > 0.001) uniformGain = NaN;
        }
        for (let b = 0; b < n - 1; b++) {
            if (hasManualSegmentFadeAtJoinedBoundary(track, b)) {
                needsManualDisplay = true;
                break;
            }
        }

        const simple =
            !needsCrossfade && !needsManualDisplay && Number.isFinite(uniformGain);

        if (simple) {
            return {
                simple: true,
                uniform: uniformGain,
                at: () => uniformGain,
            };
        }

        const crossfadeCache = new Map();

        function crossfadeAt(segmentIndex, transportSec) {
            if (!needsCrossfade) return 1;
            const bucket = Math.round(Number(transportSec) * 500);
            const key = segmentIndex + ':' + bucket;
            if (crossfadeCache.has(key)) return crossfadeCache.get(key);
            const hits = mapAllSegmentsAtTransport(track, transportSec, {
                forPlayback: true,
            });
            let v = 1;
            if (hits.length > 1) {
                const pos = hits.findIndex((h) => h.segmentIndex === segmentIndex);
                if (
                    pos >= 0 &&
                    typeof computeEqualPowerCrossfadeGainsForGroup === 'function'
                ) {
                    const gains = computeEqualPowerCrossfadeGainsForGroup(
                        hits,
                        transportSec,
                        {
                            groupBySlot: false,
                            sameSlotOnly: false,
                            trackRefFromHit: () => track,
                        },
                    );
                    v = Math.max(0, gains.get(hits[pos].key) ?? 1);
                }
            }
            crossfadeCache.set(key, v);
            return v;
        }

        return {
            simple: false,
            uniform: null,
            at(segmentIndex, transportSec) {
                const manualG = computeManualJoinedBoundaryFadeLinearForDisplay(
                    track,
                    segmentIndex,
                    transportSec,
                );
                if (manualG != null) return manualG * segGain[segmentIndex];
                let gIn = 1;
                let gOut = 1;
                const t = transportSec;
                const i = segmentIndex;
                if (fadeInSec[i] > 0.0005 && t <= playStart[i] + fadeInSec[i]) {
                    gIn = segmentFadeCurve((t - playStart[i]) / fadeInSec[i]);
                }
                if (fadeOutSec[i] > 0.0005 && t >= playEnd[i] - fadeOutSec[i]) {
                    gOut = segmentFadeCurve((playEnd[i] - t) / fadeOutSec[i]);
                }
                return crossfadeAt(i, t) * gIn * gOut * segGain[i];
            },
        };
    }

    /** 再生ミックスと同じ等パワー・重なり（波形振幅表示用） */
    function computeSegmentCrossfadeVisualGain(track, segmentIndex, transportSec) {
        const manualG = computeManualJoinedBoundaryFadeLinearForDisplay(
            track,
            segmentIndex,
            transportSec,
        );
        if (manualG != null) return manualG;
        if (!trackWaveformNeedsCrossfadeVisualMap(track)) return 1;
        const hits = mapAllSegmentsAtTransport(track, transportSec, {
            forPlayback: true,
        });
        if (hits.length <= 1) return 1;
        const pos = hits.findIndex((h) => h.segmentIndex === segmentIndex);
        if (pos < 0) return 1;
        if (typeof computeEqualPowerCrossfadeGainsForGroup !== 'function') return 1;
        const gains = computeEqualPowerCrossfadeGainsForGroup(hits, transportSec, {
            groupBySlot: false,
            sameSlotOnly: false,
            trackRefFromHit: () => track,
        });
        return Math.max(0, gains.get(hits[pos].key) ?? 1);
    }

    function getSegmentPeaksForDraw(slot, clipId) {
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        const tp = tr && tr.peaks ? tr.peaks : null;
        if (typeof getExtraTrackClipPeaks === 'function') {
            const cp = getExtraTrackClipPeaks(slot, clipId);
            if (cp && cp.length) {
                if (!tp || cp.length >= tp.length) return cp;
            }
        }
        return tp;
    }

    function viewportTilePeaksCoverMasterTime(tile, masterSec) {
        if (!tile) return false;
        if (
            masterSec + 1e-9 < tile.masterStartSec ||
            masterSec - 1e-9 > tile.masterEndSec
        ) {
            return false;
        }
        if (tile.peaks && tile.peaks.length) return true;
        if (!tile.segments || !tile.segments.length) return false;
        for (let i = 0; i < tile.segments.length; i++) {
            const s = tile.segments[i];
            if (
                masterSec + 1e-9 >= s.masterStartSec &&
                masterSec - 1e-9 <= s.masterEndSec &&
                s.peaks &&
                s.peaks.length
            ) {
                return true;
            }
        }
        return false;
    }

    function viewportPeaksCoverMasterTime(vp, masterSec) {
        if (!vp) return false;
        if (masterSec + 1e-9 < vp.masterStartSec || masterSec - 1e-9 > vp.masterEndSec) {
            return false;
        }
        if (vp.tiles && vp.tiles.length) {
            for (let ti = 0; ti < vp.tiles.length; ti++) {
                if (viewportTilePeaksCoverMasterTime(vp.tiles[ti], masterSec)) {
                    return true;
                }
            }
            return false;
        }
        if (!vp.segments || !vp.segments.length) {
            return !!(vp.peaks && vp.peaks.length);
        }
        for (let i = 0; i < vp.segments.length; i++) {
            const s = vp.segments[i];
            if (
                masterSec + 1e-9 >= s.masterStartSec &&
                masterSec - 1e-9 <= s.masterEndSec &&
                s.peaks &&
                s.peaks.length
            ) {
                return true;
            }
        }
        return false;
    }

    function drawRegionViewportPeaks(ctx, wCss, hCss, master, vp, grad, track, drawOpt) {
        if (!vp || !(master > 0) || !track) {
            return;
        }
        if (vp.tiles && vp.tiles.length) {
            for (let ti = 0; ti < vp.tiles.length; ti++) {
                const tile = vp.tiles[ti];
                if (tile.segments && tile.segments.length) {
                    drawRegionViewportPeaks(
                        ctx,
                        wCss,
                        hCss,
                        master,
                        { segments: tile.segments },
                        grad,
                        track,
                        drawOpt,
                    );
                } else if (tile.peaks && tile.peaks.length) {
                    drawRegionViewportPeaks(
                        ctx,
                        wCss,
                        hCss,
                        master,
                        {
                            peaks: tile.peaks,
                            masterStartSec: tile.masterStartSec,
                            masterEndSec: tile.masterEndSec,
                        },
                        grad,
                        track,
                        drawOpt,
                    );
                }
            }
            return;
        }
        if (!vp.segments || !vp.segments.length) {
            if (vp.peaks && vp.peaks.length) {
                const layoutW =
                    drawOpt &&
                    Number.isFinite(drawOpt.timelineLayoutW) &&
                    drawOpt.timelineLayoutW > 0
                        ? drawOpt.timelineLayoutW
                        : wCss;
                const mid = hCss * 0.5;
                const gradFill = grad || '#ffffff';
                const x0 = (vp.masterStartSec / master) * layoutW;
                const x1 = (vp.masterEndSec / master) * layoutW;
                const drawW = x1 - x0;
                if (drawW > 0.5) {
                    ctx.fillStyle =
                        typeof TIMELINE_LANE_TRACK_BG !== 'undefined'
                            ? TIMELINE_LANE_TRACK_BG
                            : '#161820';
                    ctx.fillRect(x0, 0, drawW, hCss);
                    ctx.fillStyle = gradFill;
                    drawPeaksBarsInRange(ctx, vp.peaks, x0, drawW, hCss, gradFill);
                }
            }
            return;
        }
        if (!vp.segments.length) return;
        const layoutW =
            drawOpt &&
            Number.isFinite(drawOpt.timelineLayoutW) &&
            drawOpt.timelineLayoutW > 0
                ? drawOpt.timelineLayoutW
                : wCss;
        const slot = track.slot;
        const mid = hCss * 0.5;
        const bg =
            typeof TIMELINE_LANE_TRACK_BG !== 'undefined'
                ? TIMELINE_LANE_TRACK_BG
                : '#161820';
        const gradFill = grad || '#ffffff';
        const vpDrawOpt = { viewportPeaks: vp };

        for (let si = 0; si < vp.segments.length; si++) {
            const s = vp.segments[si];
            if (!s.peaks || !s.peaks.length) continue;
            const segDur = s.masterEndSec - s.masterStartSec;
            if (!(segDur > 1e-9)) continue;
            const x0 = (s.masterStartSec / master) * layoutW;
            const x1 = (s.masterEndSec / master) * layoutW;
            const drawW = x1 - x0;
            if (!(drawW > 0.5)) continue;
            ctx.fillStyle = bg;
            ctx.fillRect(x0, 0, drawW, hCss);
        }

        ctx.fillStyle = gradFill;
        for (let si = 0; si < vp.segments.length; si++) {
            const s = vp.segments[si];
            if (!s.peaks || !s.peaks.length) continue;
            const segDur = s.masterEndSec - s.masterStartSec;
            if (!(segDur > 1e-9)) continue;
            const x0 = (s.masterStartSec / master) * layoutW;
            const x1 = (s.masterEndSec / master) * layoutW;
            const drawW = x1 - x0;
            if (!(drawW > 0.5)) continue;
            const barW = drawW / s.peaks.length;
            const segIdx =
                typeof s.segmentIndex === 'number' && s.segmentIndex >= 0 ? s.segmentIndex : si;
            for (let p = 0; p < s.peaks.length; p++) {
                const x = x0 + p * barW;
                const barTransport =
                    s.masterStartSec + ((p + 0.5) / s.peaks.length) * segDur;
                const hideBefore = getSegmentWaveformHideBeforeTimeline(track, segIdx);
                if (barTransport < hideBefore - 0.0005) continue;
                drawWaveformBarAtTransport(
                    ctx,
                    track,
                    slot,
                    x,
                    barW,
                    mid,
                    barTransport,
                    s.peaks[p],
                    segIdx,
                    vpDrawOpt,
                );
            }
        }
    }

    function buildSegmentViewportPeakEntry(track, tr, segmentIndex, spec, viewportDur, applyOpt) {
        const opt = applyOpt && typeof applyOpt === 'object' ? applyOpt : { cacheOnly: !!applyOpt };
        const cacheOnly = !!opt.cacheOnly;
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return null;
        const segT0 = getSegmentTimelineStart(track, segmentIndex);
        const segEnd = getSegmentTimelineEnd(track, segmentIndex);
        // 表示はリージョン In 以降（結合境界のクロスフェード手前は含めない）
        let t0 = Math.max(
            spec.masterStartSec,
            getSegmentWaveformVisibleTimelineStart(track, segmentIndex),
        );
        let t1 = Math.min(segEnd, spec.masterEndSec);
        if (t1 <= t0 + 1e-9) return null;

        const srcStart = segmentWaveformSourceSecAtTransport(track, segmentIndex, t0);
        const srcEnd = segmentWaveformSourceSecAtTransport(track, segmentIndex, t1);
        const clipId = seg.clipId || getSegmentClipId(track, segmentIndex);
        let buf = tr.buffer;
        if (typeof getExtraTrackClipBuffer === 'function') {
            buf = getExtraTrackClipBuffer(tr, clipId) || buf;
        }
        if (!buf) return null;

        const bars = Math.max(1, Math.round(spec.barCount * ((t1 - t0) / viewportDur)));
        let peaks = [];
        let peakQuality = 'preview';
        const rangeOpt = cacheOnly ? { cacheOnly: true } : opt;
        if (typeof peaksForViewportRangeWithQuality === 'function') {
            const bufId =
                (typeof bufferPeakId === 'function' ? bufferPeakId(buf) : 0) +
                (track && track.slot >= 0 ? (track.slot + 1) * 1000003 : 0);
            const result = peaksForViewportRangeWithQuality(
                buf,
                tr.peakPyramid,
                srcStart,
                srcEnd,
                bars,
                bufId,
                rangeOpt,
            );
            peaks = result.peaks;
            peakQuality = result.peakQuality;
        } else if (typeof peaksForViewportRange === 'function') {
            const bufId =
                (typeof bufferPeakId === 'function' ? bufferPeakId(buf) : 0) +
                (track && track.slot >= 0 ? (track.slot + 1) * 1000003 : 0);
            peaks = peaksForViewportRange(
                buf,
                tr.peakPyramid,
                srcStart,
                srcEnd,
                bars,
                bufId,
                rangeOpt,
            );
            peakQuality = opt.peakPass === 'preview' ? 'preview' : 'full';
        } else if (typeof peaksFromBufferRange === 'function') {
            peaks = peaksFromBufferRange(buf, srcStart, srcEnd, bars);
            peakQuality = 'full';
        }
        if (!peaks.length) return null;
        return {
            masterStartSec: t0,
            masterEndSec: t1,
            peaks,
            segmentIndex,
            peakQuality,
            srcStart,
            srcEnd,
            barCount: bars,
        };
    }

    function extraSegmentPeakNeedsRefine(tr, segEntry) {
        if (!segEntry || !segEntry.peaks || !segEntry.peaks.length) return true;
        if (segEntry.peakQuality === 'full') return false;
        if (!tr || !tr.peakPyramid) return true;
        const rangeDur = segEntry.srcEnd - segEntry.srcStart;
        if (!(rangeDur > 0)) return false;
        return (
            typeof isViewportPeakPyramidInsufficient === 'function' &&
            isViewportPeakPyramidInsufficient(
                tr.peakPyramid,
                segEntry.barCount,
                rangeDur,
            )
        );
    }

    function segmentHasViewportPeaksForDraw(vp, segmentIndex) {
        if (!vp) return false;
        if (vp.tiles && vp.tiles.length) {
            for (let ti = 0; ti < vp.tiles.length; ti++) {
                const tile = vp.tiles[ti];
                if (!tile.segments || !tile.segments.length) continue;
                for (let j = 0; j < tile.segments.length; j++) {
                    const s = tile.segments[j];
                    if (
                        s.segmentIndex === segmentIndex &&
                        s.peaks &&
                        s.peaks.length > 0 &&
                        s.masterEndSec > s.masterStartSec + 1e-9
                    ) {
                        return true;
                    }
                }
            }
            return false;
        }
        if (!vp.segments || !vp.segments.length) return false;
        for (let j = 0; j < vp.segments.length; j++) {
            const s = vp.segments[j];
            if (
                s.segmentIndex === segmentIndex &&
                s.peaks &&
                s.peaks.length > 0 &&
                s.masterEndSec > s.masterStartSec + 1e-9
            ) {
                return true;
            }
        }
        return false;
    }

    function resolveRegionEditViewportPeakIndices(opt) {
        if (opt && Array.isArray(opt.affectedSegmentIndices) && opt.affectedSegmentIndices.length) {
            return opt.affectedSegmentIndices.filter(
                (i) => typeof i === 'number' && i >= 0,
            );
        }
        if (opt && typeof opt.segmentIndex === 'number' && opt.segmentIndex >= 0) {
            return [opt.segmentIndex];
        }
        return null;
    }

    /** viewport peaks が現在のセグメント境界をはみ出していないか */
    function viewportPeaksMatchTrackSegments(track, vp) {
        const segments = getTrackSegments(track);
        if (!segments.length) {
            return !(vp && vp.segments && vp.segments.length);
        }
        if (!vp || !vp.segments || !vp.segments.length) return false;
        const crossfadeSlack = JOINED_BOUNDARY_CROSSFADE_SEC + 0.05;
        for (let i = 0; i < vp.segments.length; i++) {
            const s = vp.segments[i];
            if (!s.peaks || !s.peaks.length) continue;
            if (!(s.masterEndSec > s.masterStartSec + 1e-9)) continue;
            const idx =
                typeof s.segmentIndex === 'number' && s.segmentIndex >= 0
                    ? s.segmentIndex
                    : i;
            if (idx >= segments.length) return false;
            const segEnd = getSegmentTimelineEnd(track, idx);
            const visibleStart = getSegmentWaveformVisibleTimelineStart(track, idx);
            if (s.masterEndSec > segEnd + 0.02) return false;
            if (s.masterStartSec < visibleStart - crossfadeSlack) return false;
        }
        return true;
    }

    /** リージョン編集中: 変更セグメントだけピラミッドから高解像度ピークを即時更新 */
    function refreshExtraTrackViewportPeaksForRegionEdit(slot, opt) {
        if (!(slot >= 0)) return false;
        if (typeof getWaveformViewportHiresSpec !== 'function') return false;
        const spec = getWaveformViewportHiresSpec();
        if (!spec) return false;
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        if (!tr || !tr.buffer) return false;
        const track = { type: 'extra', slot };
        const only = resolveRegionEditViewportPeakIndices(opt);
        const structureChanged = !!(opt && opt.segmentStructureChanged);
        rebuildExtraTrackRegionViewportPeaks(slot, spec, {
            onlySegmentIndices: only,
            merge: !!only && !structureChanged,
        });
        if (!tr.viewportPeaks || !tr.viewportPeaks.segments || !tr.viewportPeaks.segments.length) {
            return false;
        }
        return viewportPeaksMatchTrackSegments(track, tr.viewportPeaks);
    }

    window.refreshExtraTrackViewportPeaksForRegionEdit =
        refreshExtraTrackViewportPeaksForRegionEdit;

    function extraTrackViewportTileLacksPeaks(slot, tileId) {
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        if (!tr || !tr.buffer) return false;
        const vp = tr.viewportPeaks;
        if (!vp || !vp.tiles) return true;
        for (let i = 0; i < vp.tiles.length; i++) {
            const t = vp.tiles[i];
            if (t.tileId !== tileId) continue;
            if (t.segments && t.segments.length) {
                const track = { type: 'extra', slot };
                const tileSpec = {
                    masterStartSec: t.masterStartSec,
                    masterEndSec: t.masterEndSec,
                };
                const segments = getTrackSegments(track);
                for (let si = 0; si < segments.length; si++) {
                    if (!segmentIntersectsTileSpec(track, si, tileSpec)) continue;
                    let found = false;
                    for (let k = 0; k < t.segments.length; k++) {
                        const s = t.segments[k];
                        if (s.segmentIndex !== si) continue;
                        found = true;
                        if (!s.peaks || !s.peaks.length) return true;
                        break;
                    }
                    if (!found) return true;
                }
                return false;
            }
            return !(t.peaks && t.peaks.length);
        }
        return true;
    }

    function extraTrackViewportTilePending(slot, tileId) {
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        if (!tr || !tr.buffer) return false;
        const vp = tr.viewportPeaks;
        if (!vp || !vp.tiles) return true;
        for (let i = 0; i < vp.tiles.length; i++) {
            const t = vp.tiles[i];
            if (t.tileId !== tileId) continue;
            if (t.segments && t.segments.length) {
                return extraTrackViewportTileSegmentIndicesPending(slot, tileId);
            }
            if (!(t.peaks && t.peaks.length)) return true;
            if (t.peakQuality === 'full') return false;
            if (!tr.peakPyramid) return true;
            const rangeDur = t.masterEndSec - t.masterStartSec;
            return (
                typeof isViewportPeakPyramidInsufficient === 'function' &&
                isViewportPeakPyramidInsufficient(tr.peakPyramid, t.barCount, rangeDur)
            );
        }
        return true;
    }

    window.extraTrackViewportTilePending = extraTrackViewportTilePending;
    window.extraTrackViewportTileLacksPeaks = extraTrackViewportTileLacksPeaks;

    function initExtraTrackViewportTiles(slot, plan) {
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        if (!tr || !plan || !plan.tiles || !plan.tiles.length) return;
        const prevById = new Map();
        if (tr.viewportPeaks && tr.viewportPeaks.tiles) {
            for (let i = 0; i < tr.viewportPeaks.tiles.length; i++) {
                const pt = tr.viewportPeaks.tiles[i];
                if (extraViewportTileHasPeaks(pt)) prevById.set(pt.tileId, pt);
            }
        }
        let reused = 0;
        const tiles = plan.tiles.map((t) => {
            const prev = prevById.get(t.id);
            if (prev && prev.barCount === t.barCount && extraViewportTileHasPeaks(prev)) {
                reused++;
                return {
                    tileId: t.id,
                    pxLeft: t.px,
                    pxWidth: t.width,
                    masterStartSec: prev.masterStartSec,
                    masterEndSec: prev.masterEndSec,
                    barCount: t.barCount,
                    peaks: prev.peaks || null,
                    peakQuality: prev.peakQuality || 'preview',
                    segments: prev.segments || null,
                };
            }
            return {
                tileId: t.id,
                pxLeft: t.px,
                pxWidth: t.width,
                masterStartSec: t.masterStartSec,
                masterEndSec: t.masterEndSec,
                barCount: t.barCount,
                peaks: null,
                segments: null,
            };
        });
        if (typeof logWaveformViewportTileMerge === 'function') {
            logWaveformViewportTileMerge('extra' + (slot + 1), reused, tiles.length - reused, tiles.length);
        }
        tr.viewportPeaks = {
            masterStartSec: tiles[0].masterStartSec,
            masterEndSec: tiles[tiles.length - 1].masterEndSec,
            tiles,
        };
    }

    function extraViewportTileHasPeaks(prev) {
        if (!prev) return false;
        if (prev.peaks && prev.peaks.length) return true;
        if (prev.segments && prev.segments.length) {
            for (let i = 0; i < prev.segments.length; i++) {
                const s = prev.segments[i];
                if (s.peaks && s.peaks.length) return true;
            }
        }
        return false;
    }

    function segmentIntersectsTileSpec(track, segmentIndex, tileSpec) {
        const segEnd = getSegmentTimelineEnd(track, segmentIndex);
        const visStart = getSegmentWaveformVisibleTimelineStart(track, segmentIndex);
        return (
            segEnd > tileSpec.masterStartSec + 1e-9 &&
            visStart < tileSpec.masterEndSec - 1e-9
        );
    }

    function buildExtraTrackTileSegmentPeaks(track, tr, tileSpec, applyOpt) {
        const segments = getTrackSegments(track);
        const viewportDur = tileSpec.masterEndSec - tileSpec.masterStartSec;
        const outSegs = [];
        for (let i = 0; i < segments.length; i++) {
            if (!segmentIntersectsTileSpec(track, i, tileSpec)) continue;
            const entry = buildSegmentViewportPeakEntry(
                track,
                tr,
                i,
                tileSpec,
                viewportDur,
                applyOpt,
            );
            if (entry) outSegs.push(entry);
        }
        return outSegs;
    }

    function extraTrackViewportTileSegmentIndicesPending(slot, tileId) {
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        if (!tr || !tr.viewportPeaks || !tr.viewportPeaks.tiles) return true;
        const track = { type: 'extra', slot };
        let tile = null;
        for (let i = 0; i < tr.viewportPeaks.tiles.length; i++) {
            if (tr.viewportPeaks.tiles[i].tileId === tileId) {
                tile = tr.viewportPeaks.tiles[i];
                break;
            }
        }
        if (!tile || !tile.segments || !tile.segments.length) return true;
        const tileSpec = {
            masterStartSec: tile.masterStartSec,
            masterEndSec: tile.masterEndSec,
        };
        const segments = getTrackSegments(track);
        for (let i = 0; i < segments.length; i++) {
            if (!segmentIntersectsTileSpec(track, i, tileSpec)) continue;
            let found = false;
            for (let k = 0; k < tile.segments.length; k++) {
                const s = tile.segments[k];
                if (s.segmentIndex !== i) continue;
                found = true;
                if (!s.peaks || !s.peaks.length) return true;
                if (extraSegmentPeakNeedsRefine(tr, s)) return true;
                break;
            }
            if (!found) return true;
        }
        return false;
    }

    function applyExtraTrackViewportTile(slot, tile, plan, applyOpt) {
        const opt = applyOpt && typeof applyOpt === 'object' ? applyOpt : {};
        if (
            typeof isWaveformScrubPriorityActive === 'function' &&
            isWaveformScrubPriorityActive() &&
            !opt.cacheOnly &&
            !(opt.peakPass === 'preview' && opt.scrubPreview)
        ) {
            return false;
        }
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        if (!tr || !tile || !plan) return false;
        const cacheOnly = !!opt.cacheOnly;
        if (!cacheOnly && !tr.peakPyramid) return false;
        const track = { type: 'extra', slot };
        const tileSpec = {
            masterStartSec: tile.masterStartSec,
            masterEndSec: tile.masterEndSec,
            barCount: tile.barCount,
            master: plan.master,
        };
        const rangeOpt = cacheOnly ? { cacheOnly: true } : opt;
        const segments = getTrackSegments(track);
        let tileEntry = null;
        if (!segments.length) {
            const t0Track = getTrackTimelineStartSec(track);
            const fullDur = getTrackSourceDurationSec(track);
            if (!fullDur || !tr.buffer) return false;
            const trackEnd = t0Track + fullDur;
            const t0 = Math.max(t0Track, tile.masterStartSec);
            const t1 = Math.min(trackEnd, tile.masterEndSec);
            if (t1 <= t0 + 1e-9) return false;
            const srcStart = t0 - t0Track;
            const srcEnd = t1 - t0Track;
            const viewportDur = tile.masterEndSec - tile.masterStartSec;
            const bars = Math.max(
                1,
                Math.round(tile.barCount * ((t1 - t0) / Math.max(viewportDur, 1e-9))),
            );
            let peaks = [];
            let peakQuality = 'preview';
            if (typeof peaksForViewportRangeWithQuality === 'function') {
                const bufId =
                    (typeof bufferPeakId === 'function' ? bufferPeakId(tr.buffer) : 0) +
                    (slot >= 0 ? (slot + 1) * 1000003 : 0);
                const result = peaksForViewportRangeWithQuality(
                    tr.buffer,
                    tr.peakPyramid,
                    srcStart,
                    srcEnd,
                    bars,
                    bufId,
                    rangeOpt,
                );
                peaks = result.peaks;
                peakQuality = result.peakQuality;
            } else if (typeof peaksForViewportRange === 'function') {
                const bufId =
                    (typeof bufferPeakId === 'function' ? bufferPeakId(tr.buffer) : 0) +
                    (slot >= 0 ? (slot + 1) * 1000003 : 0);
                peaks = peaksForViewportRange(
                    tr.buffer,
                    tr.peakPyramid,
                    srcStart,
                    srcEnd,
                    bars,
                    bufId,
                    rangeOpt,
                );
                peakQuality = opt.peakPass === 'preview' ? 'preview' : 'full';
            } else if (!cacheOnly && typeof peaksFromBufferRange === 'function') {
                peaks = peaksFromBufferRange(tr.buffer, srcStart, srcEnd, bars);
                peakQuality = 'full';
            }
            if (!peaks.length) return false;
            tileEntry = {
                tileId: tile.id,
                pxLeft: tile.px,
                pxWidth: tile.width,
                masterStartSec: t0,
                masterEndSec: t1,
                barCount: tile.barCount,
                peaks,
                peakQuality,
                segments: null,
            };
        } else {
            const outSegs = buildExtraTrackTileSegmentPeaks(
                track,
                tr,
                tileSpec,
                rangeOpt,
            );
            if (!outSegs.length) return false;
            if (!cacheOnly) {
                const needed = [];
                for (let i = 0; i < segments.length; i++) {
                    if (segmentIntersectsTileSpec(track, i, tileSpec)) {
                        needed.push(i);
                    }
                }
                if (needed.length) {
                    const got = new Set(outSegs.map((s) => s.segmentIndex));
                    for (let n = 0; n < needed.length; n++) {
                        if (!got.has(needed[n])) return false;
                    }
                }
            } else {
                if (tr.viewportPeaks && tr.viewportPeaks.tiles) {
                    for (let ti = 0; ti < tr.viewportPeaks.tiles.length; ti++) {
                        const prevTile = tr.viewportPeaks.tiles[ti];
                        if (prevTile.tileId !== tile.id || !prevTile.segments) continue;
                        const byIdx = new Map();
                        for (let ps = 0; ps < prevTile.segments.length; ps++) {
                            const s = prevTile.segments[ps];
                            byIdx.set(s.segmentIndex, s);
                        }
                        for (let os = 0; os < outSegs.length; os++) {
                            byIdx.set(outSegs[os].segmentIndex, outSegs[os]);
                        }
                        outSegs.length = 0;
                        byIdx.forEach((v) => outSegs.push(v));
                        break;
                    }
                }
                let anyCachedPeaks = false;
                for (let ci = 0; ci < outSegs.length; ci++) {
                    if (outSegs[ci].peaks && outSegs[ci].peaks.length) {
                        anyCachedPeaks = true;
                        break;
                    }
                }
                if (!anyCachedPeaks) return false;
            }
            let tilePeakQuality = 'full';
            for (let si = 0; si < outSegs.length; si++) {
                if (outSegs[si].peakQuality !== 'full') {
                    tilePeakQuality = 'preview';
                    break;
                }
            }
            tileEntry = {
                tileId: tile.id,
                pxLeft: tile.px,
                pxWidth: tile.width,
                masterStartSec: tile.masterStartSec,
                masterEndSec: tile.masterEndSec,
                barCount: tile.barCount,
                peaks: null,
                peakQuality: tilePeakQuality,
                segments: outSegs,
            };
        }
        if (!tr.viewportPeaks || !tr.viewportPeaks.tiles) {
            initExtraTrackViewportTiles(slot, plan);
        }
        const tiles = tr.viewportPeaks && tr.viewportPeaks.tiles;
        if (!tiles) return false;
        for (let i = 0; i < tiles.length; i++) {
            if (tiles[i].tileId === tile.id) {
                tiles[i] = tileEntry;
                return true;
            }
        }
        return false;
    }

    function rebuildExtraTrackRegionViewportPeaks(slot, spec, opt) {
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        if (!tr) return;
        const merge = !!(opt && opt.merge);
        if (!merge) {
            tr.viewportPeaks = null;
        }
        if (!spec) return;

        const track = { type: 'extra', slot };
        const viewportDur = spec.masterEndSec - spec.masterStartSec;
        if (!(viewportDur > 1e-9)) return;
        if (typeof peaksFromBufferRange !== 'function') return;

        const segments = getTrackSegments(track);
        const onlyIndices =
            opt && Array.isArray(opt.onlySegmentIndices) ? opt.onlySegmentIndices : null;

        if (onlyIndices && onlyIndices.length && segments.length) {
            let outSegs =
                merge && tr.viewportPeaks && tr.viewportPeaks.segments
                    ? tr.viewportPeaks.segments.slice()
                    : [];
            for (let k = 0; k < onlyIndices.length; k++) {
                const segIdx = onlyIndices[k];
                const entry = buildSegmentViewportPeakEntry(
                    track,
                    tr,
                    segIdx,
                    spec,
                    viewportDur,
                );
                const existing = outSegs.findIndex((s) => s.segmentIndex === segIdx);
                if (entry) {
                    if (existing >= 0) outSegs[existing] = entry;
                    else outSegs.push(entry);
                } else if (existing >= 0) {
                    outSegs.splice(existing, 1);
                }
            }
            outSegs = outSegs.filter((s) => {
                const idx =
                    typeof s.segmentIndex === 'number' && s.segmentIndex >= 0
                        ? s.segmentIndex
                        : -1;
                return idx >= 0 && idx < segments.length;
            });
            if (outSegs.length) {
                tr.viewportPeaks = {
                    masterStartSec: spec.masterStartSec,
                    masterEndSec: spec.masterEndSec,
                    segments: outSegs,
                };
            } else {
                tr.viewportPeaks = null;
            }
            return;
        }

        if (!segments.length) {
            const t0Track = getTrackTimelineStartSec(track);
            const fullDur = getTrackSourceDurationSec(track);
            if (!fullDur || !tr.buffer) return;
            const trackEnd = t0Track + fullDur;
            const t0 = Math.max(t0Track, spec.masterStartSec);
            const t1 = Math.min(trackEnd, spec.masterEndSec);
            if (t1 <= t0 + 1e-9) return;
            const srcStart = t0 - t0Track;
            const srcEnd = t1 - t0Track;
            const bars = Math.max(1, Math.round(spec.barCount * ((t1 - t0) / viewportDur)));
            let peaks = [];
            if (typeof peaksForViewportRange === 'function') {
                const bufId =
                    (typeof bufferPeakId === 'function' ? bufferPeakId(tr.buffer) : 0) +
                    (slot >= 0 ? (slot + 1) * 1000003 : 0);
                peaks = peaksForViewportRange(
                    tr.buffer,
                    tr.peakPyramid,
                    srcStart,
                    srcEnd,
                    bars,
                    bufId,
                );
            } else if (typeof peaksFromBufferRange === 'function') {
                peaks = peaksFromBufferRange(tr.buffer, srcStart, srcEnd, bars);
            }
            if (!peaks.length) return;
            tr.viewportPeaks = {
                masterStartSec: spec.masterStartSec,
                masterEndSec: spec.masterEndSec,
                segments: [{ masterStartSec: t0, masterEndSec: t1, peaks }],
            };
            return;
        }

        const outSegs = [];
        for (let i = 0; i < segments.length; i++) {
            const entry = buildSegmentViewportPeakEntry(track, tr, i, spec, viewportDur);
            if (entry) outSegs.push(entry);
        }

        if (outSegs.length) {
            tr.viewportPeaks = {
                masterStartSec: spec.masterStartSec,
                masterEndSec: spec.masterEndSec,
                segments: outSegs,
            };
        } else {
            tr.viewportPeaks = null;
        }
    }




