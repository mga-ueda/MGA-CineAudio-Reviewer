/**
 * waveform-region-fade-gain.js — リージョン Gain / Fade / Pitch
 */

    function clampRegionGainDb(db) {
        const n = Number(db);
        if (!Number.isFinite(n)) return 0;
        return Math.max(REGION_GAIN_DB_MIN, Math.min(REGION_GAIN_DB_MAX, n));
    }

    function clampRegionPitchSemitones(semitones) {
        const n = Math.round(Number(semitones));
        if (!Number.isFinite(n)) return 0;
        return Math.max(
            REGION_PITCH_SEMITONES_MIN,
            Math.min(REGION_PITCH_SEMITONES_MAX, n),
        );
    }

    function getSegmentPitchSemitones(track, segmentIndex) {
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (!raw || !Number.isFinite(raw.pitchSemitones)) return 0;
        return clampRegionPitchSemitones(raw.pitchSemitones);
    }

    /** +1 半音 = 2^(1/12) 倍速（高く・速く）。レガシー再生のタイムライン尺合わせは playDur 側で補正。 */
    function segmentPitchPlaybackRate(pitchSemitones) {
        const pitch = clampRegionPitchSemitones(pitchSemitones);
        if (pitch === 0) return 1;
        return Math.pow(2, pitch / 12);
    }

    function applySegmentPitchToBufferSource(src, pitchSemitones) {
        if (!src) return 1;
        const pitch = clampRegionPitchSemitones(pitchSemitones);
        if (pitch === 0) {
            src.detune.value = 0;
            src.playbackRate.value = 1;
            return 1;
        }
        const rate = segmentPitchPlaybackRate(pitch);
        src.detune.value = 0;
        src.playbackRate.value = rate;
        return rate;
    }

    function formatRegionPitchDisplay(semitones) {
        const n = clampRegionPitchSemitones(semitones);
        if (Math.abs(n) < 0.0005) return '';
        return 'Key ' + (n > 0 ? '+' : '') + n;
    }

    function getSegmentGainDb(track, segmentIndex) {
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (!raw || !Number.isFinite(raw.gainDb)) return 0;
        return clampRegionGainDb(raw.gainDb);
    }

    function getSegmentGainLinear(track, segmentIndex) {
        const db = getSegmentGainDb(track, segmentIndex);
        if (Math.abs(db) < 0.0005) return 1;
        if (typeof trackLaneLinearGainFromDb === 'function') {
            return trackLaneLinearGainFromDb(db);
        }
        return Math.pow(10, db / 20);
    }

    /** Fade In: 序盤ゆっくり→終盤急上昇 / Fade Out: 序盤急降下→終盤ゆっくり（二次 ease） */
    const SEGMENT_FADE_EASE_POWER = 2;

    function clampFadeNorm(norm) {
        return Math.max(0, Math.min(1, Number(norm) || 0));
    }

    function segmentFadeEaseIn(norm) {
        const p = clampFadeNorm(norm);
        return Math.pow(p, SEGMENT_FADE_EASE_POWER);
    }

    function segmentFadeEaseOut(norm) {
        const p = clampFadeNorm(norm);
        return 1 - Math.pow(1 - p, SEGMENT_FADE_EASE_POWER);
    }

    /** リージョン端 Fade In（進行度 0→1 に ease-in） */
    function segmentFadeInGainFromProgress(progress) {
        return segmentFadeEaseIn(progress);
    }

    /** リージョン端 Fade Out（残量 remaining 1→0 に ease-in = 序盤急降下） */
    function segmentFadeOutGainFromRemaining(remaining) {
        return segmentFadeEaseIn(remaining);
    }

    /** 結合境界の手動 Fade Out/In（二次 ease） */
    function manualJoinedBoundaryFadeOutGain(p) {
        const x = clampFadeNorm(p);
        return 1 - segmentFadeEaseOut(x);
    }

    function manualJoinedBoundaryFadeInGain(p) {
        return segmentFadeEaseIn(p);
    }

    function getSegmentFadeOverlapWindow(track, segmentIndex) {
        const segStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const segEnd = getSegmentTimelineEnd(track, segmentIndex);
        let earliestOverlapStart = segEnd;
        let latestOverlapEnd = segStart;
        const segments = getTrackSegments(track);
        for (let i = 0; i < segments.length; i++) {
            if (i === segmentIndex) continue;
            const otherStart = getSegmentPlaybackTimelineStart(track, i);
            const otherEnd = getSegmentTimelineEnd(track, i);
            const overlapStart = Math.max(segStart, otherStart);
            const overlapEnd = Math.min(segEnd, otherEnd);
            if (overlapEnd - overlapStart < MIN_CROSSFADE_OVERLAP_SEC) continue;
            if (overlapStart < earliestOverlapStart) earliestOverlapStart = overlapStart;
            if (overlapEnd > latestOverlapEnd) latestOverlapEnd = overlapEnd;
        }
        return { segStart, segEnd, earliestOverlapStart, latestOverlapEnd };
    }

    function segmentEqualPowerOverlapHit(track, segmentIndex) {
        const slot =
            track && Number.isFinite(track.slot) ? track.slot | 0 : 0;
        return {
            slot,
            segmentIndex,
            key: 'seg:' + segmentIndex,
            timelineStart: getSegmentPlaybackTimelineStart(track, segmentIndex),
            timelineEnd: getSegmentTimelineEnd(track, segmentIndex),
        };
    }

    /** 等パワー重なり（全ペア・再生ミックスと同じ skip 規則）を列挙 */
    function forEachEqualPowerCrossfadeOverlapForSegment(track, segmentIndex, fn) {
        const segments = getTrackSegments(track);
        const minOverlap =
            typeof window.MIN_CROSSFADE_OVERLAP_SEC === 'number'
                ? window.MIN_CROSSFADE_OVERLAP_SEC
                : 0.005;
        const selfStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const selfEnd = getSegmentTimelineEnd(track, segmentIndex);
        const selfHit = segmentEqualPowerOverlapHit(track, segmentIndex);

        for (let i = 0; i < segments.length; i++) {
            if (i === segmentIndex) continue;
            const otherStart = getSegmentPlaybackTimelineStart(track, i);
            const otherEnd = getSegmentTimelineEnd(track, i);
            const oStart = Math.max(selfStart, otherStart);
            const oEnd = Math.min(selfEnd, otherEnd);
            const overlap = oEnd - oStart;
            if (overlap < minOverlap) continue;

            const otherHit = segmentEqualPowerOverlapHit(track, i);
            const active = [selfHit, otherHit];
            if (
                typeof shouldSkipEqualPowerOverlapPair === 'function' &&
                shouldSkipEqualPowerOverlapPair(active, 0, 1, {
                    trackRefFromHit: () => track,
                })
            ) {
                continue;
            }

            const lo = Math.min(segmentIndex, i);
            const hi = Math.max(segmentIndex, i);
            let role = null;
            if (typeof crossfadeOutInIndices === 'function') {
                const { out, in: inIdx } = crossfadeOutInIndices(active, 0, 1, {
                    trackRefFromHit: () => track,
                });
                role = inIdx === 0 ? 'in' : 'out';
                void out;
            } else if (otherStart < selfStart - 0.0005) {
                role = 'in';
            } else if (selfStart < otherStart - 0.0005) {
                role = 'out';
            } else if (otherEnd < selfEnd - 0.0005) {
                role = 'out';
            } else {
                role = 'in';
            }
            if (!role) continue;
            fn({ lo, hi, oStart, oEnd, overlap, role, otherIndex: i });
        }
    }

    /** 等パワー・タイムライン重なりのみ（手動 Fade 未設定）の表示用フェード幅 */
    function getEqualPowerCrossfadeOverlapFadeSecForSegment(track, segmentIndex, kind) {
        let best = 0;
        forEachEqualPowerCrossfadeOverlapForSegment(
            track,
            segmentIndex,
            (zone) => {
                if (zone.role === kind) {
                    best = Math.max(best, zone.overlap);
                }
            },
        );
        return best;
    }

    function clampRegionAxisRatio(ratio) {
        const n = Number(ratio);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(1, n));
    }

    /** 三角マーカー位置・表示（手動 Fade + 等パワー重なり） */
    function resolveSegmentFadeTrianglePresentation(
        track,
        segmentIndex,
        regionInTransport,
        regionDur,
    ) {
        if (
            typeof isSegmentSilentGridRegion === 'function' &&
            isSegmentSilentGridRegion(track, segmentIndex)
        ) {
            return {
                fadeInAxisRatio: 0,
                fadeOutAxisRatio: 1,
                showIn: false,
                showOut: false,
                fadeInSec: 0,
                fadeOutSec: 0,
            };
        }
        const dur = Math.max(0.001, Number(regionDur) || 0);
        const regionIn = Number(regionInTransport) || 0;
        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const playbackOffsetRatio = clampRegionAxisRatio(
            (playbackStart - regionIn) / dur,
        );

        const rawIn = getRawSegmentFadeSec(track, segmentIndex, 'in');
        const rawOut = getRawSegmentFadeSec(track, segmentIndex, 'out');
        const storedIn = getSegmentFadeDurationSec(track, segmentIndex, 'in');
        const storedOut = getSegmentFadeDurationSec(track, segmentIndex, 'out');

        let fadeInAxisRatio = clampRegionAxisRatio(
            playbackOffsetRatio + storedIn / dur,
        );
        let fadeOutAxisRatio = clampRegionAxisRatio(1 - storedOut / dur);
        let showIn =
            rawIn > 0.0005
                ? true
                : segmentFadeTriangleHandleAllowed(track, segmentIndex, 'in');
        let showOut =
            rawOut > 0.0005
                ? true
                : segmentFadeTriangleHandleAllowed(track, segmentIndex, 'out');
        let markerFadeInSec = storedIn;
        let markerFadeOutSec = storedOut;

        if (rawIn > 0.0005) {
            fadeInAxisRatio = clampRegionAxisRatio(
                playbackOffsetRatio + storedIn / dur,
            );
        }

        if (rawOut > 0.0005) {
            fadeOutAxisRatio = clampRegionAxisRatio(1 - storedOut / dur);
        }

        if (rawIn <= 0.0005) {
            let bestInAxis = null;
            let bestInOverlap = 0;
            forEachEqualPowerCrossfadeOverlapForSegment(
                track,
                segmentIndex,
                (zone) => {
                    if (zone.role !== 'in') return;
                    const axis = clampRegionAxisRatio(
                        (zone.oEnd - regionIn) / dur,
                    );
                    if (bestInAxis == null || zone.overlap >= bestInOverlap) {
                        bestInAxis = axis;
                        bestInOverlap = zone.overlap;
                    }
                },
            );
            if (bestInAxis != null) {
                fadeInAxisRatio = bestInAxis;
                showIn = true;
                markerFadeInSec = bestInOverlap;
            }
        }

        if (rawOut <= 0.0005) {
            let bestOutAxis = null;
            let bestOutOverlap = 0;
            forEachEqualPowerCrossfadeOverlapForSegment(
                track,
                segmentIndex,
                (zone) => {
                    if (zone.role !== 'out') return;
                    const axis = clampRegionAxisRatio(
                        (zone.oStart - regionIn) / dur,
                    );
                    if (bestOutAxis == null || zone.overlap >= bestOutOverlap) {
                        bestOutAxis = axis;
                        bestOutOverlap = zone.overlap;
                    }
                },
            );
            if (bestOutAxis != null) {
                fadeOutAxisRatio = bestOutAxis;
                showOut = true;
                markerFadeOutSec = bestOutOverlap;
            }
        }

        return {
            fadeInAxisRatio,
            fadeOutAxisRatio,
            showIn,
            showOut,
            fadeInSec: markerFadeInSec,
            fadeOutSec: markerFadeOutSec,
        };
    }

    /** 三角マーカー表示可否（従来の fadeMax または等パワー重なり） */
    function segmentFadeTriangleHandleAllowed(track, segmentIndex, kind) {
        if (
            typeof isSegmentSilentGridRegion === 'function' &&
            isSegmentSilentGridRegion(track, segmentIndex)
        ) {
            return false;
        }
        const maxAllowed = getSegmentFadeDurationLimit(track, segmentIndex, kind);
        if (maxAllowed > 0.0005) return true;
        return (
            getEqualPowerCrossfadeOverlapFadeSecForSegment(
                track,
                segmentIndex,
                kind,
            ) > 0.0005
        );
    }

    /** 保存値のフェード秒（上限クランプ・重なり計算なし） */
    function getRawSegmentFadeSec(track, segmentIndex, kind) {
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (!raw) return 0;
        const key = kind === 'out' ? 'fadeOutSec' : 'fadeInSec';
        return Math.max(0, Number(raw[key]) || 0);
    }

    function getSegmentFadeDurationLimit(track, segmentIndex, kind) {
        const win = getSegmentFadeOverlapWindow(track, segmentIndex);
        if (kind === 'in') {
            return Math.max(0, win.earliestOverlapStart - win.segStart);
        }
        if (kind === 'out') {
            return Math.max(0, win.segEnd - win.latestOverlapEnd);
        }
        return 0;
    }

    function getSegmentFadeDurationSec(track, segmentIndex, kind) {
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (!raw) return 0;
        const key = kind === 'out' ? 'fadeOutSec' : 'fadeInSec';
        const stored = Math.max(0, Number(raw[key]) || 0);
        const maxAllowed = getSegmentFadeDurationLimit(track, segmentIndex, kind);
        return Math.max(0, Math.min(stored, maxAllowed));
    }

    function setSegmentFadeDurationSec(track, segmentIndex, kind, sec, opt) {
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return false;
        const raw = state.segments[segmentIndex];
        const key = kind === 'out' ? 'fadeOutSec' : 'fadeInSec';
        const maxAllowed = getSegmentFadeDurationLimit(track, segmentIndex, kind);
        const next = Math.max(0, Math.min(maxAllowed, Number(sec) || 0));
        const prev = getSegmentFadeDurationSec(track, segmentIndex, kind);
        if (Math.abs(next - prev) < 0.0005) return false;
        if (!(opt && opt.skipUndo) && !regionUndoPaused) {
            requestRegionUndoCapture();
        }
        if (next <= 0.0005) delete raw[key];
        else raw[key] = next;
        if (typeof bumpRegionPersistEpoch === 'function') {
            bumpRegionPersistEpoch(track.slot);
        }
        if (opt && opt.geometryOnly) {
            refreshTrackRegionOverlayGeometry(track);
        } else {
            updateTrackRegionOverlays(track);
        }
        redrawAfterRegionChange(track.slot, {
            segmentIndex,
            geometryOnly: !!(opt && opt.geometryOnly),
        });
        if (!(opt && opt.skipPersist) && typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        if (!(opt && opt.geometryOnly) && typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        return true;
    }

    function computeSegmentFadeLinearAtTransport(track, segmentIndex, transportSec, opt) {
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return 1;
        const manualFade = computeManualJoinedBoundaryFadeLinear(
            track,
            segmentIndex,
            transportSec,
        );
        if (manualFade != null) return manualFade;
        const mapDelta =
            opt && Number.isFinite(opt.mapTimelineDelta) ? opt.mapTimelineDelta : 0;
        const start =
            getSegmentPlaybackTimelineStart(track, segmentIndex) + mapDelta;
        const end = getSegmentTimelineEnd(track, segmentIndex) + mapDelta;
        if (!(end > start + 0.0005)) return 1;
        const fadeInSec = getSegmentFadeDurationSec(track, segmentIndex, 'in');
        const fadeOutSec = getSegmentFadeDurationSec(track, segmentIndex, 'out');
        let gIn = 1;
        let gOut = 1;
        if (fadeInSec > 0.0005 && t <= start + fadeInSec) {
            gIn = segmentFadeInGainFromProgress((t - start) / fadeInSec);
        }
        if (fadeOutSec > 0.0005 && t >= end - fadeOutSec) {
            gOut = segmentFadeOutGainFromRemaining((end - t) / fadeOutSec);
        }
        return Math.max(0, Math.min(1, gIn * gOut));
    }

    function getSegmentPlaybackGainLinear(track, segmentIndex, transportSec) {
        return (
            getSegmentGainLinear(track, segmentIndex) *
            computeSegmentFadeLinearAtTransport(track, segmentIndex, transportSec)
        );
    }

    function formatRegionGainDbDisplay(db) {
        const n = clampRegionGainDb(db);
        if (Math.abs(n) < 0.0005) return '';
        if (typeof trackLaneFormatDbValue === 'function') {
            return trackLaneFormatDbValue(n) + ' dB';
        }
        const s = n.toFixed(1);
        return (n > 0 ? '+' : '') + s + ' dB';
    }

    function setSegmentGainDb(track, segmentIndex, gainDb, opt) {
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return false;
        const next = clampRegionGainDb(gainDb);
        const prev = getSegmentGainDb(track, segmentIndex);
        if (Math.abs(next - prev) < 0.0005) return false;
        if (!(opt && opt.skipUndo) && !regionUndoPaused) {
            requestRegionUndoCapture();
        }
        const raw = state.segments[segmentIndex];
        if (Math.abs(next) < 0.0005) {
            delete raw.gainDb;
        } else {
            raw.gainDb = next;
        }
        if (typeof bumpRegionPersistEpoch === 'function') {
            bumpRegionPersistEpoch(track.slot);
        }
        updateTrackRegionOverlays(track);
        redrawAfterRegionChange(track.slot);
        if (!(opt && opt.skipPersist) && typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (
            !(opt && opt.skipVolumeMarker) &&
            typeof syncMarkerForRegionVolumeChange === 'function'
        ) {
            syncMarkerForRegionVolumeChange(track, segmentIndex, next, prev);
        }
        if (
            Math.abs(next) < 0.0005 &&
            !(opt && opt.skipVolumeBoundaryJoin) &&
            typeof tryRejoinVolumeSplitBoundariesAtSegment === 'function'
        ) {
            tryRejoinVolumeSplitBoundariesAtSegment(track, segmentIndex, {
                skipUndo: !!(opt && opt.skipUndo),
            });
        }
        return true;
    }

    function setSegmentPitchSemitones(track, segmentIndex, pitchSemitones, opt) {
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return false;
        const next = clampRegionPitchSemitones(pitchSemitones);
        const prev = getSegmentPitchSemitones(track, segmentIndex);
        if (next === prev) return false;
        if (!(opt && opt.skipUndo) && !regionUndoPaused) {
            requestRegionUndoCapture();
        }
        const raw = state.segments[segmentIndex];
        if (next === 0) {
            delete raw.pitchSemitones;
        } else {
            raw.pitchSemitones = next;
        }
        if (typeof bumpRegionPersistEpoch === 'function') {
            bumpRegionPersistEpoch(track.slot);
        }
        updateTrackRegionOverlays(track);
        redrawAfterRegionChange(track.slot);
        if (!(opt && opt.skipPersist) && typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (
            !(opt && opt.skipPitchMarker) &&
            typeof syncMarkerForRegionPitchChange === 'function'
        ) {
            syncMarkerForRegionPitchChange(track, segmentIndex, next, prev);
        }
        if (typeof invalidatePitchSliceCacheForSegment === 'function') {
            invalidatePitchSliceCacheForSegment(track, segmentIndex);
        }
        if (
            next !== 0 &&
            typeof schedulePitchSliceRenderForSegment === 'function'
        ) {
            schedulePitchSliceRenderForSegment(track, segmentIndex);
            if (
                typeof warmupPitchStretchWorklet === 'function' &&
                typeof ensureReviewMixCtx === 'function'
            ) {
                const mixCtx = ensureReviewMixCtx();
                if (mixCtx) void warmupPitchStretchWorklet(mixCtx);
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Key', 'Processing…', 'notice');
            }
        }
        return true;
    }
