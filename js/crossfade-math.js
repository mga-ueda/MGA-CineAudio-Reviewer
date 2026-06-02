/**
 * crossfade-math.js — セグメント重なりの等パワー・クロスフェード（再生ミックス／波形表示共通）。
 */
(function crossfadeMathModule() {
    const MIN_CROSSFADE_OVERLAP_SEC = 0.005;
    const TIMELINE_ORDER_EPS_SEC = 0.0005;

    function clampCrossfadeProgress(p) {
        const x = Number(p);
        if (!Number.isFinite(x)) return 0;
        return Math.max(0, Math.min(1, x));
    }

    function crossfadeEqualPowerGainOut(p) {
        return Math.cos(clampCrossfadeProgress(p) * Math.PI * 0.5);
    }

    function crossfadeEqualPowerGainIn(p) {
        return Math.sin(clampCrossfadeProgress(p) * Math.PI * 0.5);
    }

    function crossfadeOutInByTimelineOrder(active, i, j) {
        const a = active[i];
        const b = active[j];
        if (a.timelineStart < b.timelineStart - TIMELINE_ORDER_EPS_SEC) {
            return { out: i, in: j };
        }
        if (b.timelineStart < a.timelineStart - TIMELINE_ORDER_EPS_SEC) {
            return { out: j, in: i };
        }
        if (a.timelineEnd < b.timelineEnd - TIMELINE_ORDER_EPS_SEC) {
            return { out: i, in: j };
        }
        if (b.timelineEnd < a.timelineEnd - TIMELINE_ORDER_EPS_SEC) {
            return { out: j, in: i };
        }
        return { out: i, in: j };
    }

    function trackRefForHit(hit, opt) {
        if (opt && typeof opt.trackRefFromHit === 'function') {
            return opt.trackRefFromHit(hit);
        }
        return { type: 'extra', slot: hit.slot };
    }

    function crossfadeOutInIndices(active, i, j, opt) {
        const a = active[i];
        const b = active[j];
        const sameSlotOnly = !opt || opt.sameSlotOnly !== false;
        if (sameSlotOnly && a.slot !== b.slot) {
            return crossfadeOutInByTimelineOrder(active, i, j);
        }
        const lo = a.segmentIndex < b.segmentIndex ? a : b;
        const hi = a.segmentIndex < b.segmentIndex ? b : a;
        if (hi.segmentIndex === lo.segmentIndex + 1) {
            const trackRef = trackRefForHit(lo, opt);
            if (
                typeof window.isAutoJoinedBoundaryCrossfadeEligible === 'function' &&
                window.isAutoJoinedBoundaryCrossfadeEligible(trackRef, lo.segmentIndex)
            ) {
                const loIdx = a.segmentIndex < b.segmentIndex ? i : j;
                const hiIdx = a.segmentIndex < b.segmentIndex ? j : i;
                return { out: loIdx, in: hiIdx };
            }
        }
        return crossfadeOutInByTimelineOrder(active, i, j);
    }

    function shouldSkipManualJoinedEqualPowerPair(active, i, j, opt) {
        const a = active[i];
        const b = active[j];
        const sameSlotOnly = !opt || opt.sameSlotOnly !== false;
        if (sameSlotOnly && a.slot !== b.slot) return false;
        const lo = a.segmentIndex < b.segmentIndex ? a : b;
        const hi = a.segmentIndex < b.segmentIndex ? b : a;
        if (hi.segmentIndex !== lo.segmentIndex + 1) return false;
        const trackRef = trackRefForHit(lo, opt);
        if (typeof window.isSegmentBoundaryJoined !== 'function') return false;
        if (!window.isSegmentBoundaryJoined(trackRef, lo.segmentIndex)) return false;
        return (
            typeof window.hasManualSegmentFadeAtJoinedBoundary === 'function' &&
            window.hasManualSegmentFadeAtJoinedBoundary(trackRef, lo.segmentIndex)
        );
    }

    function shouldSkipContinuousJoinedEqualPowerPair(active, i, j, opt) {
        const a = active[i];
        const b = active[j];
        const sameSlotOnly = !opt || opt.sameSlotOnly !== false;
        if (sameSlotOnly && a.slot !== b.slot) return false;
        const lo = a.segmentIndex < b.segmentIndex ? a : b;
        const hi = a.segmentIndex < b.segmentIndex ? b : a;
        if (hi.segmentIndex !== lo.segmentIndex + 1) return false;
        const trackRef = trackRefForHit(lo, opt);
        if (typeof window.isSegmentBoundaryJoined !== 'function') return false;
        if (!window.isSegmentBoundaryJoined(trackRef, lo.segmentIndex)) return false;
        if (typeof window.isSegmentSourceContinuousAtBoundary !== 'function') {
            return false;
        }
        return window.isSegmentSourceContinuousAtBoundary(trackRef, lo.segmentIndex);
    }

    /**
     * 重なり区間で Fade In/Out が有効なときは等パワーを使わない（フェード曲線と二重減衰になるため）。
     */
    function shouldSkipSegmentFadeOverlapEqualPowerPair(active, i, j, opt) {
        if (shouldSkipManualJoinedEqualPowerPair(active, i, j, opt)) return true;
        const getFade =
            typeof window.getSegmentFadeDurationSec === 'function'
                ? window.getSegmentFadeDurationSec
                : null;
        if (!getFade) return false;
        const { out: outIdx, in: inIdx } = crossfadeOutInIndices(active, i, j, opt);
        const outHit = active[outIdx];
        const inHit = active[inIdx];
        const trackRef = trackRefForHit(outHit, opt);
        const fadeOut = getFade(trackRef, outHit.segmentIndex, 'out');
        const fadeIn = getFade(trackRef, inHit.segmentIndex, 'in');
        if (fadeOut <= 0.0005 && fadeIn <= 0.0005) return false;
        const t =
            opt && Number.isFinite(opt.transportSec) ? Number(opt.transportSec) : NaN;
        if (!Number.isFinite(t)) return false;
        const oStart = Math.max(outHit.timelineStart, inHit.timelineStart);
        const oEnd = Math.min(outHit.timelineEnd, inHit.timelineEnd);
        if (oEnd - oStart < MIN_CROSSFADE_OVERLAP_SEC) return false;
        const inFadeZone =
            fadeIn > 0.0005 &&
            t >= inHit.timelineStart - TIMELINE_ORDER_EPS_SEC &&
            t <= inHit.timelineStart + fadeIn + TIMELINE_ORDER_EPS_SEC;
        const outFadeZone =
            fadeOut > 0.0005 &&
            t >= outHit.timelineEnd - fadeOut - TIMELINE_ORDER_EPS_SEC &&
            t <= outHit.timelineEnd + TIMELINE_ORDER_EPS_SEC;
        return inFadeZone || outFadeZone;
    }

    function shouldSkipEqualPowerOverlapPair(active, i, j, opt) {
        if (opt && typeof opt.shouldSkipPair === 'function') {
            return opt.shouldSkipPair(active, i, j, opt);
        }
        if (shouldSkipContinuousJoinedEqualPowerPair(active, i, j, opt)) return true;
        if (shouldSkipManualJoinedEqualPowerPair(active, i, j, opt)) return true;
        return shouldSkipSegmentFadeOverlapEqualPowerPair(active, i, j, opt);
    }

    function computeEqualPowerCrossfadeGainsForGroup(group, transportSec, opt) {
        const gains = new Map();
        if (!group.length) return gains;
        if (group.length === 1) {
            gains.set(group[0].key, 1);
            return gains;
        }
        const minOverlap =
            opt && Number.isFinite(opt.minOverlapSec)
                ? opt.minOverlapSec
                : MIN_CROSSFADE_OVERLAP_SEC;
        const weights = group.map(() => 1);
        const t = Number(transportSec);
        const pairOpt = opt ? { ...opt, transportSec: t } : { transportSec: t };
        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                if (shouldSkipEqualPowerOverlapPair(group, i, j, pairOpt)) continue;
                const oStart = Math.max(group[i].timelineStart, group[j].timelineStart);
                const oEnd = Math.min(group[i].timelineEnd, group[j].timelineEnd);
                if (oEnd - oStart < minOverlap || t < oStart || t > oEnd) {
                    continue;
                }
                const p = (t - oStart) / (oEnd - oStart);
                const { out, in: inIdx } = crossfadeOutInIndices(group, i, j, opt);
                weights[out] *= crossfadeEqualPowerGainOut(p);
                weights[inIdx] *= crossfadeEqualPowerGainIn(p);
            }
        }
        let sumSq = 0;
        for (let w = 0; w < weights.length; w++) sumSq += weights[w] * weights[w];
        const norm = sumSq > 0 ? 1 / Math.sqrt(sumSq) : 1;
        for (let w = 0; w < group.length; w++) {
            gains.set(group[w].key, weights[w] * norm);
        }
        return gains;
    }

    function computeEqualPowerCrossfadeGains(active, transportSec, opt) {
        const gains = new Map();
        if (!active.length) return gains;
        const groupBySlot = !opt || opt.groupBySlot !== false;
        if (!groupBySlot) {
            return computeEqualPowerCrossfadeGainsForGroup(active, transportSec, opt);
        }
        const bySlot = new Map();
        for (let i = 0; i < active.length; i++) {
            const hit = active[i];
            if (!bySlot.has(hit.slot)) bySlot.set(hit.slot, []);
            bySlot.get(hit.slot).push(hit);
        }
        for (const slotActive of bySlot.values()) {
            const slotGains = computeEqualPowerCrossfadeGainsForGroup(
                slotActive,
                transportSec,
                opt,
            );
            slotGains.forEach((g, key) => gains.set(key, g));
        }
        return gains;
    }

    window.MIN_CROSSFADE_OVERLAP_SEC = MIN_CROSSFADE_OVERLAP_SEC;
    window.EXTRA_AUDIO_MIN_CROSSFADE_OVERLAP_SEC = MIN_CROSSFADE_OVERLAP_SEC;
    window.crossfadeEqualPowerGainOut = crossfadeEqualPowerGainOut;
    window.crossfadeEqualPowerGainIn = crossfadeEqualPowerGainIn;
    window.crossfadeOutInIndices = crossfadeOutInIndices;
    window.shouldSkipManualJoinedEqualPowerPair = shouldSkipManualJoinedEqualPowerPair;
    window.shouldSkipEqualPowerOverlapPair = shouldSkipEqualPowerOverlapPair;
    window.shouldSkipSegmentFadeOverlapEqualPowerPair =
        shouldSkipSegmentFadeOverlapEqualPowerPair;
    window.computeEqualPowerCrossfadeGainsForGroup = computeEqualPowerCrossfadeGainsForGroup;
    window.computeEqualPowerCrossfadeGains = computeEqualPowerCrossfadeGains;
})();
