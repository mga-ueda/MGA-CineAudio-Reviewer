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
                const playbackEndCutoff =
                    joinedNext && continuousNext
                        ? absEnd + 0.00001
                        : absEnd - 0.0005;
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
                    isSegmentBoundaryJoined(track, i - 1) &&
                    (hasExtendedCrossfadeOverlapAtBoundary(track, i - 1) ||
                        hasManualSegmentFadeAtJoinedBoundary(track, i - 1))) ||
                    (i < segments.length - 1 &&
                        isSegmentBoundaryJoined(track, i) &&
                        (hasExtendedCrossfadeOverlapAtBoundary(track, i) ||
                            hasManualSegmentFadeAtJoinedBoundary(track, i))));
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
        const top = mid - Math.max(0.5, pk.max * g * (mid - 2));
        const bot = mid - Math.min(-0.5, pk.min * g * (mid - 2));
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

    function viewportPeaksCoverMasterTime(vp, masterSec) {
        if (!vp) return false;
        if (masterSec + 1e-9 < vp.masterStartSec || masterSec - 1e-9 > vp.masterEndSec) {
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

    function drawRegionViewportPeaks(ctx, wCss, hCss, master, vp, grad, track) {
        if (!vp || !vp.segments || !vp.segments.length || !(master > 0) || !track) {
            return;
        }
        const slot = track.slot;
        const mid = hCss * 0.5;
        const bg =
            typeof TIMELINE_LANE_TRACK_BG !== 'undefined'
                ? TIMELINE_LANE_TRACK_BG
                : '#161820';
        const gradFill = grad || '#ffffff';
        const drawOpt = { viewportPeaks: vp };

        for (let si = 0; si < vp.segments.length; si++) {
            const s = vp.segments[si];
            if (!s.peaks || !s.peaks.length) continue;
            const segDur = s.masterEndSec - s.masterStartSec;
            if (!(segDur > 1e-9)) continue;
            const x0 = (s.masterStartSec / master) * wCss;
            const x1 = (s.masterEndSec / master) * wCss;
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
            const x0 = (s.masterStartSec / master) * wCss;
            const x1 = (s.masterEndSec / master) * wCss;
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
                    drawOpt,
                );
            }
        }
    }

    function buildSegmentViewportPeakEntry(track, tr, segmentIndex, spec, viewportDur) {
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
        if (typeof peaksForViewportRange === 'function') {
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
            );
        } else if (typeof peaksFromBufferRange === 'function') {
            peaks = peaksFromBufferRange(buf, srcStart, srcEnd, bars);
        }
        if (!peaks.length) return null;
        return { masterStartSec: t0, masterEndSec: t1, peaks, segmentIndex };
    }

    function segmentHasViewportPeaksForDraw(vp, segmentIndex) {
        if (!vp || !vp.segments || !vp.segments.length) return false;
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




