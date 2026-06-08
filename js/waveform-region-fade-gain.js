/**
 * waveform-region-fade-gain.js — リージョン Gain / Fade
 */
    function clampRegionGainDb(db) {
        const n = Number(db);
        if (!Number.isFinite(n)) return 0;
        return Math.max(REGION_GAIN_DB_MIN, Math.min(REGION_GAIN_DB_MAX, n));
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

    /** @deprecated 互換用 — fadeIn 進行度向け */
    function segmentFadeCurve(norm) {
        return segmentFadeEaseIn(norm);
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

    function computeSegmentFadeLinearAtTransport(track, segmentIndex, transportSec) {
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return 1;
        const manualFade = computeManualJoinedBoundaryFadeLinear(
            track,
            segmentIndex,
            transportSec,
        );
        if (manualFade != null) return manualFade;
        const start = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const end = getSegmentTimelineEnd(track, segmentIndex);
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
