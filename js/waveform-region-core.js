/**
 * waveform-region-core.js — コア（Undo・選択・グループ・タイムライン修復・幾何・ピーク）
 */
    const PLAYBACK_REGION_MIN_SEC = 0.05;
    const MIN_CROSSFADE_OVERLAP_SEC =
        typeof window.MIN_CROSSFADE_OVERLAP_SEC === 'number'
            ? window.MIN_CROSSFADE_OVERLAP_SEC
            : 0.005;
    const SEGMENT_BOUNDARY_JOIN_EPS_SEC = 0.002;
    /** 結合境界のクロスフェード幅（分割点の手前のみ、境界以降は伸ばさない） */
    const JOINED_BOUNDARY_CROSSFADE_SEC = 1;
    const REGION_GAIN_DB_MIN = -96;
    const REGION_GAIN_DB_MAX = 10;
    const REGION_PITCH_SEMITONES_MIN = -12;
    const REGION_PITCH_SEMITONES_MAX = 12;
    const regionUndoStack = [];
    const regionRedoStack = [];
    let regionUndoPaused = false;
    let regionUndoDragSnap = null;
    let lastRegionSplitShortcutAtMs = -Infinity;
    const REGION_SPLIT_SHORTCUT_DEDUP_MS = 120;
    let pendingPlaybackRegionRestore = null;
    /** @type {{ slot: number, segment: object } | null} */
    let regionSegmentClipboard = null;
    const regionPersistEpochBySlot = {};
    const regionShrinkPersistIntentUntilBySlot = {};
    const REGION_SHRINK_PERSIST_INTENT_MS = 6000;
    function noteRegionShrinkPersistIntent(slot) {
        if (!(slot >= 0)) return;
        regionShrinkPersistIntentUntilBySlot[slot] =
            performance.now() + REGION_SHRINK_PERSIST_INTENT_MS;
    }
    function canPersistRegionShrink(slot) {
        if (!(slot >= 0)) return false;
        const until = Number(regionShrinkPersistIntentUntilBySlot[slot] || 0);
        return until > 0 && performance.now() <= until;
    }
    function bumpRegionPersistEpoch(slot) {
        if (!(slot >= 0)) return;
        regionPersistEpochBySlot[slot] = (regionPersistEpochBySlot[slot] || 0) + 1;
    }
    window.bumpRegionPersistEpoch = bumpRegionPersistEpoch;
    function getRegionPersistEpoch(slot) {
        if (!(slot >= 0)) return 0;
        return Number(regionPersistEpochBySlot[slot] || 0);
    }
    function swapRegionPersistEpochBetweenSlots(aSlot, bSlot) {
        if (!(aSlot >= 0) || !(bSlot >= 0) || aSlot === bSlot) return;
        const tmp = regionPersistEpochBySlot[aSlot] || 0;
        regionPersistEpochBySlot[aSlot] = regionPersistEpochBySlot[bSlot] || 0;
        regionPersistEpochBySlot[bSlot] = tmp;
        const tmpShrink = regionShrinkPersistIntentUntilBySlot[aSlot] || 0;
        regionShrinkPersistIntentUntilBySlot[aSlot] =
            regionShrinkPersistIntentUntilBySlot[bSlot] || 0;
        regionShrinkPersistIntentUntilBySlot[bSlot] = tmpShrink;
    }
    window.canPersistRegionShrink = canPersistRegionShrink;
    window.getRegionPersistEpoch = getRegionPersistEpoch;
    window.swapRegionPersistEpochBetweenSlots = swapRegionPersistEpochBetweenSlots;
    function emptyPlaybackRegionsState() {
        return { active: false, segments: [], headPadSec: 0 };
    }
    function regionUndoSnapshotIncludePhrase(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!o.includePhrase) return false;
        return (
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible() &&
            typeof capturePhraseUndoSnapshot === 'function'
        );
    }
    function normalizeRegionUndoSnapshot(snap) {
        if (Array.isArray(snap)) {
            return { tracks: snap, phrase: null, phraseExpandedCounts: null, markers: null };
        }
        if (snap && Array.isArray(snap.tracks)) {
            return {
                tracks: snap.tracks,
                phrase: snap.phrase != null ? snap.phrase : null,
                phraseExpandedCounts:
                    snap.phraseExpandedCounts && snap.phraseExpandedCounts.length
                        ? snap.phraseExpandedCounts.slice()
                        : null,
                markers: Array.isArray(snap.markers) ? snap.markers : null,
            };
        }
        return { tracks: [], phrase: null, phraseExpandedCounts: null, markers: null };
    }
    function restoredPlaybackHasUsableTimelineSlots(playbackRegions) {
        const slots =
            playbackRegions && Array.isArray(playbackRegions.timelineSlots)
                ? playbackRegions.timelineSlots
                : null;
        return (
            typeof window.persistedTimelineSlotsAreUsable === 'function' &&
            window.persistedTimelineSlotsAreUsable(slots)
        );
    }
    function trackNeedsTimelineSlotRebuildAfterRestore(entry, track) {
        if (
            typeof window.isTrackRegionActive === 'function' &&
            !window.isTrackRegionActive(track)
        ) {
            return false;
        }
        if (!entry || !entry.playbackRegions) return true;
        const segs = Array.isArray(entry.playbackRegions.segments)
            ? entry.playbackRegions.segments.length
            : 0;
        const slots = entry.playbackRegions.timelineSlots;
        if (!restoredPlaybackHasUsableTimelineSlots(entry.playbackRegions)) return true;
        if (!Array.isArray(slots) || !segs) return true;
        let audioSlots = 0;
        for (let i = 0; i < slots.length; i++) {
            if (slots[i] && slots[i].kind !== 'silent') audioSlots++;
        }
        return audioSlots < segs;
    }
    /** Undo スナップショット用 — 計算位置を raw segment へ書き戻してから clone する */
    function materializePlaybackRegionTimelineAnchorsForSnapshot(track) {
        if (!isExtraTrackRef(track)) return;
        const state = getPlaybackRegionsState(track);
        if (!state || !state.active || !state.segments || !state.segments.length) {
            return;
        }
        for (let i = 0; i < state.segments.length; i++) {
            const raw = state.segments[i];
            if (!raw) continue;
            raw.timelineStartSec = getSegmentTimelineStart(track, i);
            raw.regionTimelineInSec = getSegmentRegionTimelineIn(track, i);
        }
    }
    function captureRegionUndoSnapshot(opt) {
        const tracks = [];
        const n = getExtraTrackCount();
        for (let i = 0; i < n; i++) {
            const tr =
                typeof extraTrackBySlot === 'function' ? extraTrackBySlot(i) : null;
            let playbackRegions = emptyPlaybackRegionsState();
            if (tr && tr.playbackRegions) {
                materializePlaybackRegionTimelineAnchorsForSnapshot({
                    type: 'extra',
                    slot: i,
                });
                playbackRegions = deepCloneJson(tr.playbackRegions);
            }
            const timelineStartSec =
                typeof getExtraTrackTimelineStartSec === 'function'
                    ? getExtraTrackTimelineStartSec(i)
                    : 0;
            tracks.push({ slot: i, playbackRegions, timelineStartSec });
        }
        let phrase = null;
        let phraseExpandedCounts = null;
        if (regionUndoSnapshotIncludePhrase(opt)) {
            phrase = capturePhraseUndoSnapshot();
            if (typeof window.getExpandedPhraseGroupBarCountsSnapshot === 'function') {
                const counts = window.getExpandedPhraseGroupBarCountsSnapshot();
                if (counts && counts.length) {
                    phraseExpandedCounts = counts.slice();
                }
            }
        }
        let markers = null;
        if (typeof getMarkersSnapshot === 'function') {
            markers = getMarkersSnapshot();
        }
        return { tracks, phrase, phraseExpandedCounts, markers };
    }
    function regionUndoSnapshotsEqual(a, b) {
        return (
            JSON.stringify(normalizeRegionUndoSnapshot(a)) ===
            JSON.stringify(normalizeRegionUndoSnapshot(b))
        );
    }
    function clearRegionRedoStack() {
        regionRedoStack.length = 0;
    }
    function requestRegionUndoCapture(opt) {
        if (regionUndoPaused) return;
        if (typeof window.clearRegionSwapHistoryAnimHint === 'function') {
            window.clearRegionSwapHistoryAnimHint();
        }
        const snap = captureRegionUndoSnapshot(opt);
        const top = regionUndoStack.length
            ? regionUndoStack[regionUndoStack.length - 1]
            : null;
        if (top && regionUndoSnapshotsEqual(top, snap)) return;
        regionUndoStack.push(snap);
        clearRegionRedoStack();
    }
    function attachRegionSwapAnimHintToUndoStackTop(hint) {
        if (regionUndoPaused || !hint || !hint.swapAnim) return;
        if (!regionUndoStack.length) return;
        const top = regionUndoStack[regionUndoStack.length - 1];
        if (typeof window.cloneRegionSwapHistoryAnimHint === 'function') {
            top.regionSwapAnimHint = window.cloneRegionSwapHistoryAnimHint(hint);
        }
    }
    function restoreRegionUndoSnapshot(snap, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        regionUndoPaused = true;
        const normalized = normalizeRegionUndoSnapshot(snap);
        const n = getExtraTrackCount();
        for (let i = 0; i < n; i++) {
            const entry = normalized.tracks.find((e) => e.slot === i);
            const tr =
                typeof extraTrackBySlot === 'function' ? extraTrackBySlot(i) : null;
            if (!tr) continue;
            if (entry) {
                tr.playbackRegions = deepCloneJson(entry.playbackRegions);
                bumpRegionPersistEpoch(i);
                if (typeof setExtraTrackTimelineStartSec === 'function') {
                    setExtraTrackTimelineStartSec(entry.slot, entry.timelineStartSec, {
                        skipPersist: true,
                    });
                }
            } else {
                tr.playbackRegions = emptyPlaybackRegionsState();
                bumpRegionPersistEpoch(i);
            }
        }
        if (typeof window.invalidateTrackTimelineSlotsReadCache === 'function') {
            window.invalidateTrackTimelineSlotsReadCache();
        }
        if (
            normalized.phraseExpandedCounts &&
            normalized.phraseExpandedCounts.length &&
            typeof window.applyPhraseGroupBarCountsForRegionSwap === 'function'
        ) {
            window.applyPhraseGroupBarCountsForRegionSwap(normalized.phraseExpandedCounts, {
                skipUndo: true,
                relayoutRegions: false,
            });
        } else if (
            normalized.phrase != null &&
            typeof restorePhraseUndoSnapshot === 'function'
        ) {
            restorePhraseUndoSnapshot(normalized.phrase, { skipTimelineSlotRebuild: true });
        }
        let needsSlotRebuild = false;
        for (let i = 0; i < n; i++) {
            const entry = normalized.tracks.find((e) => e.slot === i);
            if (trackNeedsTimelineSlotRebuildAfterRestore(entry, { type: 'extra', slot: i })) {
                needsSlotRebuild = true;
                break;
            }
        }
        if (needsSlotRebuild) {
            if (typeof window.rebuildAllTrackTimelineSlots === 'function') {
                window.rebuildAllTrackTimelineSlots({
                    infer: false,
                    skipPresentationRefresh: true,
                });
            }
        }
        if (Array.isArray(normalized.markers) && typeof setMarkersFromSnapshot === 'function') {
            setMarkersFromSnapshot(normalized.markers);
        }
        if (!o.deferRedraw) {
            for (let i = 0; i < n; i++) {
                const tr =
                    typeof extraTrackBySlot === 'function' ? extraTrackBySlot(i) : null;
                if (!tr) continue;
                updateTrackRegionOverlays({ type: 'extra', slot: i });
                redrawAfterRegionChange(i);
            }
            updateAllPlaybackRegionOverlays();
        }
        if (!o.deferRedraw && !o.skipSyncTransport && typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (
            Array.isArray(normalized.markers) &&
            typeof refreshAllRegionPitchGainOverlay === 'function'
        ) {
            refreshAllRegionPitchGainOverlay();
        }
        if (!o.deferRedraw && !o.skipPersist && typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        regionUndoPaused = false;
    }
    function trackUndoEntryFingerprint(entry) {
        if (!entry) {
            return JSON.stringify({
                playbackRegions: emptyPlaybackRegionsState(),
                timelineStartSec: 0,
            });
        }
        return JSON.stringify({
            playbackRegions: entry.playbackRegions,
            timelineStartSec: entry.timelineStartSec,
        });
    }
    function findSingleChangedTrackSlotForHistoryRestore(normalizedTarget) {
        const n = getExtraTrackCount();
        const changed = [];
        for (let i = 0; i < n; i++) {
            const entry = normalizedTarget.tracks.find((e) => e.slot === i);
            const tr =
                typeof extraTrackBySlot === 'function' ? extraTrackBySlot(i) : null;
            if (!tr) continue;
            materializePlaybackRegionTimelineAnchorsForSnapshot({ type: 'extra', slot: i });
            const curFp = JSON.stringify({
                playbackRegions: deepCloneJson(tr.playbackRegions),
                timelineStartSec:
                    typeof getExtraTrackTimelineStartSec === 'function'
                        ? getExtraTrackTimelineStartSec(i)
                        : 0,
            });
            if (curFp !== trackUndoEntryFingerprint(entry)) changed.push(i);
        }
        return changed.length === 1 ? changed[0] : -1;
    }
    function clearTrackSegmentsMemoForSlot(slot) {
        trackSegmentsMemoBySlot[slot] = undefined;
    }
    function previewTrackSegmentsFromUndoEntry(track, entry, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const phraseCounts =
            o.phraseExpandedCounts && o.phraseExpandedCounts.length
                ? o.phraseExpandedCounts
                : null;
        const slot = track.slot | 0;
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        if (!tr || !entry) return null;

        function previewWithPlaybackRegions() {
            const savedRegions = deepCloneJson(tr.playbackRegions);
            const savedTls =
                typeof getExtraTrackTimelineStartSec === 'function'
                    ? getExtraTrackTimelineStartSec(slot)
                    : 0;
            tr.playbackRegions = deepCloneJson(entry.playbackRegions);
            if (typeof setExtraTrackTimelineStartSec === 'function') {
                setExtraTrackTimelineStartSec(slot, entry.timelineStartSec, { skipPersist: true });
            }
            if (typeof window.invalidateTrackTimelineSlotsReadCache === 'function') {
                window.invalidateTrackTimelineSlotsReadCache();
            }
            clearTrackSegmentsMemoForSlot(slot);
            let segments = null;
            try {
                segments = getTrackSegments(track).map((s) => Object.assign({}, s));
            } finally {
                tr.playbackRegions = savedRegions;
                if (typeof setExtraTrackTimelineStartSec === 'function') {
                    setExtraTrackTimelineStartSec(slot, savedTls, { skipPersist: true });
                }
                if (typeof window.invalidateTrackTimelineSlotsReadCache === 'function') {
                    window.invalidateTrackTimelineSlotsReadCache();
                }
                clearTrackSegmentsMemoForSlot(slot);
            }
            return segments;
        }

        if (
            phraseCounts &&
            typeof window.setPhraseGroupBarCountsOverride === 'function' &&
            typeof window.clearPhraseGroupBarCountsOverride === 'function'
        ) {
            try {
                window.setPhraseGroupBarCountsOverride(phraseCounts);
                if (typeof window.clearMusicalGridPositionCache === 'function') {
                    window.clearMusicalGridPositionCache();
                }
                return previewWithPlaybackRegions();
            } finally {
                window.clearPhraseGroupBarCountsOverride();
                if (typeof window.clearMusicalGridPositionCache === 'function') {
                    window.clearMusicalGridPositionCache();
                }
            }
        }
        return previewWithPlaybackRegions();
    }
    function captureTrackRegionOverlayIntervals(track, segmentCount) {
        const metrics =
            typeof getRegionOverlayTimelineMetrics === 'function'
                ? getRegionOverlayTimelineMetrics()
                : null;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (
            !metrics ||
            !(metrics.scrubW > 0) ||
            !(master > 0) ||
            typeof getSegmentRegionOverlayTimelineInterval !== 'function' ||
            typeof transportSecToOverlayPx !== 'function'
        ) {
            return null;
        }
        const n = segmentCount | 0;
        if (!(n > 0)) return null;
        const intervals = [];
        for (let si = 0; si < n; si++) {
            const iv = getSegmentRegionOverlayTimelineInterval(track, si);
            if (!iv) return null;
            const left = transportSecToOverlayPx(iv.start, metrics, master);
            const right = transportSecToOverlayPx(iv.end, metrics, master);
            intervals.push({
                left: Number.isFinite(left) ? left : 0,
                width: Math.max(1, (Number.isFinite(right) ? right : 0) - left),
            });
        }
        return intervals;
    }
    function finishDeferredRegionHistoryRestore(targetSnap, onDone) {
        regionUndoPaused = false;
        restoreRegionUndoSnapshot(targetSnap);
        if (typeof onDone === 'function') onDone();
    }

    function resolveHistoryRestoreTrackSlot(normalized, swapHint) {
        if (swapHint && swapHint.swapAnim) {
            return swapHint.trackSlot | 0;
        }
        const hint = swapHint || null;
        if (
            hint &&
            typeof window.regionSwapHistoryAnimHintMatchesTarget === 'function' &&
            window.regionSwapHistoryAnimHintMatchesTarget(hint, normalized)
        ) {
            return hint.trackSlot | 0;
        }
        return findSingleChangedTrackSlotForHistoryRestore(normalized);
    }

    function resolveHistoryRestoreSwapHint(targetSnap, swapHint) {
        if (swapHint && swapHint.swapAnim) return swapHint;
        const normalized = normalizeRegionUndoSnapshot(targetSnap);
        const globalHint =
            typeof window.regionSwapHistoryAnimHint !== 'undefined'
                ? window.regionSwapHistoryAnimHint
                : null;
        if (
            globalHint &&
            typeof window.regionSwapHistoryAnimHintMatchesTarget === 'function' &&
            window.regionSwapHistoryAnimHintMatchesTarget(globalHint, normalized)
        ) {
            return globalHint;
        }
        return null;
    }

    function tryAnimateRegionHistoryRestore(targetSnap, onDone, swapHint, animWaitRetries) {
        if (typeof window.playPlaybackRegionSwapAnimation !== 'function') {
            finishDeferredRegionHistoryRestore(targetSnap, onDone);
            return false;
        }
        if (
            typeof window.planRegionHistorySwapAnimation !== 'function' &&
            typeof window.planRegionHistorySwapAnimationFromHint !== 'function'
        ) {
            finishDeferredRegionHistoryRestore(targetSnap, onDone);
            return false;
        }
        if (
            typeof window.isPlaybackRegionSwapAnimActive === 'function' &&
            window.isPlaybackRegionSwapAnimActive()
        ) {
            const waits = animWaitRetries | 0;
            if (waits < 20) {
                setTimeout(() => {
                    tryAnimateRegionHistoryRestore(targetSnap, onDone, swapHint, waits + 1);
                }, 50);
                return false;
            }
            finishDeferredRegionHistoryRestore(targetSnap, onDone);
            return false;
        }
        const normalized = normalizeRegionUndoSnapshot(targetSnap);
        const hint = resolveHistoryRestoreSwapHint(targetSnap, swapHint);
        const slotIdx = resolveHistoryRestoreTrackSlot(normalized, hint);
        if (slotIdx < 0) {
            finishDeferredRegionHistoryRestore(targetSnap, onDone);
            return false;
        }

        let plan = null;
        if (
            hint &&
            (hint.trackSlot | 0) === slotIdx &&
            typeof window.planRegionHistorySwapAnimationFromHint === 'function'
        ) {
            plan = window.planRegionHistorySwapAnimationFromHint(normalized, slotIdx, hint);
        }
        if (!plan && typeof window.planRegionHistorySwapAnimation === 'function') {
            plan = window.planRegionHistorySwapAnimation(normalized, slotIdx);
        }
        if (!plan) {
            finishDeferredRegionHistoryRestore(targetSnap, onDone);
            return false;
        }

        if (
            plan.targetCounts &&
            plan.targetCounts.length &&
            typeof window.applyPhraseGroupBarCountsForRegionSwap === 'function'
        ) {
            window.applyPhraseGroupBarCountsForRegionSwap(plan.targetCounts, {
                skipUndo: true,
                relayoutRegions: false,
                skipSessionPersist: true,
                skipGridRedraw: true,
            });
        }
        if (typeof window.clearMusicalGridPositionCache === 'function') {
            window.clearMusicalGridPositionCache();
        }

        const planFinalize =
            typeof plan.finalizeSwap === 'function' ? plan.finalizeSwap : function () {};
        const animSpec = {
            track: plan.track,
            forceTimelineSwap: true,
            previewSegments: plan.previewSegments,
            redrawOpt: { invalidatePeakCache: true },
            oldOverlayIntervals: plan.oldOverlayIntervals,
            applySwap: (animOpt) => {
                restoreRegionUndoSnapshot(targetSnap, {
                    deferRedraw: !!(animOpt && animOpt.deferRedraw),
                    skipPersist: !!(animOpt && animOpt.skipPersist),
                    skipSyncTransport: !!(animOpt && animOpt.skipSyncTransport),
                });
                return true;
            },
            finalizeSwap: () => {
                planFinalize();
                if (typeof onDone === 'function') onDone();
            },
        };
        const swapAnim = plan.swapAnim;
        if (swapAnim && swapAnim.gap) {
            animSpec.gap = swapAnim.gap;
            animSpec.segmentIndex = swapAnim.segmentIndex | 0;
            animSpec.segmentIndices = swapAnim.segmentIndices || [];
            if (swapAnim.swapPlan) animSpec.swapPlan = swapAnim.swapPlan;
        } else if (swapAnim) {
            animSpec.swapLo = swapAnim.swapLo | 0;
            animSpec.swapHi = swapAnim.swapHi | 0;
            if (swapAnim.swapUnitSegmentIndicesA && swapAnim.swapUnitSegmentIndicesB) {
                animSpec.swapUnitSegmentIndicesA = swapAnim.swapUnitSegmentIndicesA;
                animSpec.swapUnitSegmentIndicesB = swapAnim.swapUnitSegmentIndicesB;
            }
        }

        const animResult = window.playPlaybackRegionSwapAnimation(animSpec);
        if (animResult === 'started' || animResult === 'applied-recovered') {
            return true;
        }
        finishDeferredRegionHistoryRestore(targetSnap, onDone);
        return false;
    }

    function beginDeferredRegionHistoryRestore(targetSnap, onDone, swapHint) {
        regionUndoPaused = true;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                tryAnimateRegionHistoryRestore(targetSnap, onDone, swapHint);
            });
        });
    }
    function captureRegionUndoSnapshotForHistory() {
        return captureRegionUndoSnapshot({ includePhrase: true });
    }
    function undoPlaybackRegion() {
        if (!regionUndoStack.length) return false;
        const current = captureRegionUndoSnapshotForHistory();
        const prev = regionUndoStack.pop();
        const normalizedPrev = normalizeRegionUndoSnapshot(prev);
        let swapHintForRestore = null;
        if (prev.regionSwapAnimHint && prev.regionSwapAnimHint.swapAnim) {
            swapHintForRestore = prev.regionSwapAnimHint;
            if (typeof window.cloneRegionSwapHistoryAnimHint === 'function') {
                current.regionSwapAnimHint =
                    window.cloneRegionSwapHistoryAnimHint(prev.regionSwapAnimHint);
            }
        } else {
            const globalHint =
                typeof window.regionSwapHistoryAnimHint !== 'undefined'
                    ? window.regionSwapHistoryAnimHint
                    : null;
            if (
                globalHint &&
                typeof window.regionSwapHistoryAnimHintMatchesTarget === 'function' &&
                window.regionSwapHistoryAnimHintMatchesTarget(globalHint, normalizedPrev)
            ) {
                swapHintForRestore = globalHint;
                if (typeof window.cloneRegionSwapHistoryAnimHint === 'function') {
                    current.regionSwapAnimHint =
                        window.cloneRegionSwapHistoryAnimHint(globalHint);
                }
            }
        }
        if (typeof window.clearRegionSwapHistoryAnimHint === 'function') {
            window.clearRegionSwapHistoryAnimHint();
        }
        regionRedoStack.push(current);
        beginDeferredRegionHistoryRestore(prev, () => {
            writeLog('Playback region: undo');
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'Undo', 'notice');
            }
        }, swapHintForRestore);
        return true;
    }
    function redoPlaybackRegion() {
        if (!regionRedoStack.length) return false;
        const current = captureRegionUndoSnapshotForHistory();
        const next = regionRedoStack.pop();
        let swapHintForRestore = null;
        if (next.regionSwapAnimHint && next.regionSwapAnimHint.swapAnim) {
            swapHintForRestore = next.regionSwapAnimHint;
            delete next.regionSwapAnimHint;
        } else {
            const normalizedNext = normalizeRegionUndoSnapshot(next);
            const globalHint =
                typeof window.regionSwapHistoryAnimHint !== 'undefined'
                    ? window.regionSwapHistoryAnimHint
                    : null;
            if (
                globalHint &&
                typeof window.regionSwapHistoryAnimHintMatchesTarget === 'function' &&
                window.regionSwapHistoryAnimHintMatchesTarget(globalHint, normalizedNext)
            ) {
                swapHintForRestore = globalHint;
            }
        }
        if (typeof window.clearRegionSwapHistoryAnimHint === 'function') {
            window.clearRegionSwapHistoryAnimHint();
        }
        regionUndoStack.push(current);
        beginDeferredRegionHistoryRestore(next, () => {
            writeLog('Playback region: redo');
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'Redo', 'notice');
            }
        }, swapHintForRestore);
        return true;
    }
    function clearRegionUndoStack() {
        regionUndoStack.length = 0;
        clearRegionRedoStack();
        regionUndoDragSnap = null;
        if (typeof window.clearRegionSwapHistoryAnimHint === 'function') {
            window.clearRegionSwapHistoryAnimHint();
        }
    }
    function regionUndoCaptureOptions() {
        return regionUndoSnapshotIncludePhrase({ includePhrase: true }) ? { includePhrase: true } : undefined;
    }
    function beginRegionUndoGesture() {
        if (regionUndoPaused) return;
        regionUndoDragSnap = captureRegionUndoSnapshot(regionUndoCaptureOptions());
    }
    function commitRegionUndoGesture() {
        if (regionUndoPaused || !regionUndoDragSnap) return;
        const current = captureRegionUndoSnapshot(regionUndoCaptureOptions());
        if (!regionUndoSnapshotsEqual(regionUndoDragSnap, current)) {
            regionUndoStack.push(regionUndoDragSnap);
            clearRegionRedoStack();
        }
        regionUndoDragSnap = null;
    }
    function cancelRegionUndoGesture() {
        regionUndoDragSnap = null;
    }
    function trackKey(track) {
        return track && track.type === 'extra' ? 'extra:' + track.slot : '';
    }
    function parseTrackKey(key) {
        const m = /^extra:(\d+)$/.exec(key);
        if (m) return { type: 'extra', slot: parseInt(m[1], 10) };
        return null;
    }
    function isExtraTrackRef(track) {
        return !!(track && track.type === 'extra' && Number.isFinite(track.slot));
    }
    function isSessionRestoreBusy() {
        return (
            (typeof isSessionRestoreInProgress === 'function' &&
                isSessionRestoreInProgress()) ||
            (typeof isSessionRestoreTeardownPending === 'function' &&
                isSessionRestoreTeardownPending())
        );
    }
    function normalizeSegment(sourceInSec, sourceOutSec, fullDur) {
        let inS = Number(sourceInSec);
        let outS = Number(sourceOutSec);
        if (!Number.isFinite(inS)) inS = 0;
        if (!Number.isFinite(outS)) outS = fullDur;
        if (outS < inS) {
            const t = inS;
            inS = outS;
            outS = t;
        }
        inS = Math.max(0, Math.min(inS, fullDur));
        outS = Math.max(inS + PLAYBACK_REGION_MIN_SEC, Math.min(fullDur, outS));
        return { sourceInSec: inS, sourceOutSec: outS };
    }
    function newRegionId() {
        return (
            'reg-' +
            Date.now().toString(36) +
            '-' +
            Math.random().toString(36).slice(2, 9)
        );
    }
    function newRegionGroupId() {
        return (
            'rgrp-' +
            Date.now().toString(36) +
            '-' +
            Math.random().toString(36).slice(2, 7)
        );
    }
    function getSegmentRegionGroupId(track, segmentIndex) {
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (!raw || !raw.regionGroupId) return '';
        return String(raw.regionGroupId);
    }
    function regionGroupMemberKey(slot, segmentIndex) {
        return slot + ':' + segmentIndex;
    }
    /** 同一 groupId のリージョンを全 Ex トラックから列挙 */
    function collectRegionGroupMembers(track, segmentIndex) {
        const gid = getSegmentRegionGroupId(track, segmentIndex);
        if (!gid) {
            return [{ slot: track.slot, segmentIndex }];
        }
        const members = [];
        const n = getExtraTrackCount();
        for (let s = 0; s < n; s++) {
            const t = { type: 'extra', slot: s };
            const count = getSegmentCount(t);
            for (let i = 0; i < count; i++) {
                if (getSegmentRegionGroupId(t, i) === gid) {
                    members.push({ slot: s, segmentIndex: i });
                }
            }
        }
        return members.length
            ? members
            : [{ slot: track.slot, segmentIndex }];
    }
    function collectRegionGroupMemberIndices(track, segmentIndex) {
        return collectRegionGroupMembers(track, segmentIndex)
            .filter((m) => m.slot === track.slot)
            .map((m) => m.segmentIndex);
    }
    function sortSegmentIndicesByTimeline(track, indices) {
        return indices
            .slice()
            .filter((i) => i >= 0)
            .sort((a, b) => {
                const aIn = getSegmentRegionTimelineIn(track, a);
                const bIn = getSegmentRegionTimelineIn(track, b);
                if (Math.abs(aIn - bIn) > 1e-9) return aIn - bIn;
                return a - b;
            });
    }
    function regionSwapDiagFmtSec(v) {
        return Number.isFinite(v) ? (v | 0) === v ? String(v) : v.toFixed(4) + 's' : String(v);
    }
    function regionSwapDiagPhraseText() {
        if (typeof getMusicalGridPersistSnapshot === 'function') {
            const snap = getMusicalGridPersistSnapshot();
            if (snap && snap.phrase) return snap.phrase;
        }
        return '';
    }
    function regionSwapDiagLog(stage, payload) {
        if (typeof window.musicalSlotDiagLog === 'function') {
            window.musicalSlotDiagLog(stage, payload);
        }
    }
    function resolveRegionSwapDiagTrackRef(trackOrSlot) {
        if (trackOrSlot != null && typeof trackOrSlot === 'object' && isExtraTrackRef(trackOrSlot)) {
            return trackOrSlot;
        }
        if (typeof trackOrSlot === 'number' && trackOrSlot >= 0) {
            return { type: 'extra', slot: trackOrSlot | 0 };
        }
        return null;
    }
    /** ログへスナップショット（E キー入れ替え時は自動出力）。手動: musicalSlotDiagDumpTrack(0) */
    function regionSwapDiagDumpTrack(trackOrSlot, label) {
        if (typeof window.musicalSlotDiagDumpTrack === 'function') {
            return window.musicalSlotDiagDumpTrack(trackOrSlot, label);
        }
        const track = resolveRegionSwapDiagTrackRef(trackOrSlot);
        if (!track) {
            regionSwapDiagLog('dump/error', { label, error: 'invalid track' });
        }
    }
    function regionSwapDiagDumpSelectionTracks(label) {
        if (typeof window.musicalSlotDiagDumpSelectionTracks === 'function') {
            return window.musicalSlotDiagDumpSelectionTracks(label);
        }
        const slots = new Set();
        for (let i = 0; i < regionSelectionEntries.length; i++) {
            slots.add(regionSelectionEntries[i].slot);
        }
        if (!slots.size) slots.add(0);
        for (const slot of slots) {
            regionSwapDiagDumpTrack({ type: 'extra', slot }, label);
        }
    }
    window.repairTrackMicroTimelineGaps = repairTrackMicroTimelineGaps;
    function segmentEntryTimelineEnd(seg) {
        const anchor = Number.isFinite(seg.timelineStartSec) ? seg.timelineStartSec : 0;
        return (
            anchor +
            Math.max(
                PLAYBACK_REGION_MIN_SEC,
                (Number(seg.sourceOutSec) || 0) - (Number(seg.sourceInSec) || 0),
            )
        );
    }
    function mergeTimelineCoverageIntervals(intervals, eps) {
        if (!intervals.length) return [];
        const sorted = intervals.slice().sort((a, b) => a.startSec - b.startSec);
        const merged = [{ startSec: sorted[0].startSec, endSec: sorted[0].endSec }];
        for (let i = 1; i < sorted.length; i++) {
            const iv = sorted[i];
            const last = merged[merged.length - 1];
            if (iv.startSec <= last.endSec + eps) {
                last.endSec = Math.max(last.endSec, iv.endSec);
            } else {
                merged.push({ startSec: iv.startSec, endSec: iv.endSec });
            }
        }
        return merged;
    }
    function subtractTimelineCoverage(rangeStart, rangeEnd, covers, eps) {
        const out = [];
        let cursor = rangeStart;
        for (let i = 0; i < covers.length; i++) {
            const c = covers[i];
            if (c.startSec > cursor + eps) {
                out.push({
                    startSec: cursor,
                    endSec: Math.min(c.startSec, rangeEnd),
                });
            }
            cursor = Math.max(cursor, c.endSec);
            if (cursor >= rangeEnd - eps) break;
        }
        if (cursor < rangeEnd - eps) {
            out.push({ startSec: cursor, endSec: rangeEnd });
        }
        return out.filter((u) => u.endSec - u.startSec > eps);
    }
    /** セグメントコピー列のタイムライン重なり診断（クロスフェード検出用） */
    function regionSwapDiagCheckSegmentTimelineOverlaps(track, segments, stage) {
        if (!segments || !segments.length) return { crossfade: false, overlaps: [] };
        const eps = segmentBoundaryJoinEpsilonSec();
        const rows = [];
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (!seg) continue;
            const regionIn = segmentCopyRegionIn(seg);
            const regionOut = segmentCopyRegionOut(seg);
            rows.push({
                region: i + 1,
                regionIn: regionSwapDiagFmtSec(regionIn),
                regionOut: regionSwapDiagFmtSec(regionOut),
                sourceDur: regionSwapDiagFmtSec(segmentCopySourceDurSec(seg)),
            });
        }
        const overlaps = [];
        for (let i = 0; i < segments.length; i++) {
            const a = segments[i];
            if (!a) continue;
            const aIn = segmentCopyRegionIn(a);
            const aOut = segmentCopyRegionOut(a);
            for (let j = i + 1; j < segments.length; j++) {
                const b = segments[j];
                if (!b) continue;
                const bIn = segmentCopyRegionIn(b);
                const bOut = segmentCopyRegionOut(b);
                const overlapSec = Math.min(aOut, bOut) - Math.max(aIn, bIn);
                if (overlapSec > eps) {
                    overlaps.push({
                        a: i + 1,
                        b: j + 1,
                        overlapSec: regionSwapDiagFmtSec(overlapSec),
                        aSpan: regionSwapDiagFmtSec(aIn) + '–' + regionSwapDiagFmtSec(aOut),
                        bSpan: regionSwapDiagFmtSec(bIn) + '–' + regionSwapDiagFmtSec(bOut),
                    });
                }
            }
        }
        const crossfade = overlaps.length > 0;
        regionSwapDiagLog('swap/overlap-check/' + (stage || 'check'), {
            crossfade,
            overlapCount: overlaps.length,
            overlaps,
            segments: rows,
        });
        return { crossfade, overlaps, segments: rows };
    }
    /**
     * タイムライン順の隣接 Region Out/In を整列（移動由来の sub-frame 誤差のみ）。
     * - 重なり解消: |gap| ≲ eps×8 のみ（大きな重なりは phrase 配置の結果 — 触らない）
     * - 微小隙間: 同閾値以内かつ segment index がタイムライン順と一致するときのみ
     * - タイムライン順が segment index 逆転（入れ替え直後）のペアはスキップ
     */
    function eliminateSegmentCopyTimelineOverlaps(track, segments, t0, opt) {
        if (!segments || !segments.length) return false;
        const layoutOpt = opt && typeof opt === 'object' ? opt : {};
        const resolveOverlap = layoutOpt.resolveOverlap !== false;
        const closeMicroGaps = layoutOpt.closeMicroGaps !== false;
        if (!resolveOverlap && !closeMicroGaps) return false;
        const eps = segmentBoundaryJoinEpsilonSec();
        const maxMicroSec = eps * 8;
        const abutTol = eps * 0.5;
        let changed = false;
        const maxPass = Math.max(2, segments.length + 1);
        for (let pass = 0; pass < maxPass; pass++) {
            const order = segments
                .map((_, i) => i)
                .sort((a, b) => {
                    const da = segmentCopyRegionIn(segments[a]);
                    const db = segmentCopyRegionIn(segments[b]);
                    if (Math.abs(da - db) > 1e-12) return da - db;
                    return a - b;
                });
            const adjustments = [];
            for (let o = 1; o < order.length; o++) {
                const prevIdx = order[o - 1];
                const curIdx = order[o];
                const prevSeg = segments[prevIdx];
                const curSeg = segments[curIdx];
                if (!prevSeg || !curSeg) continue;
                const prevOut = segmentCopyRegionOut(prevSeg);
                const curIn = segmentCopyRegionIn(curSeg);
                const gap = curIn - prevOut;
                if (Math.abs(gap) <= abutTol) continue;
                const isOverlap =
                    resolveOverlap && gap < -abutTol && -gap <= maxMicroSec;
                const isMicroGap =
                    closeMicroGaps && gap > abutTol && gap <= maxMicroSec;
                // 重なり解消は index 逆転ペアではスキップ — 微小隙間の吸着のみ許可
                if (curIdx <= prevIdx && !isMicroGap) continue;
                if (!isOverlap && !isMicroGap) continue;
                const targetIn = prevOut;
                if (isMicroGap) {
                    const phraseBefore = phraseSlotIndexAtRegionInSec(curIn);
                    const phraseAfter = phraseSlotIndexAtRegionInSec(targetIn);
                    if (
                        phraseBefore != null &&
                        phraseAfter != null &&
                        phraseBefore !== phraseAfter
                    ) {
                        continue;
                    }
                }
                const delta = targetIn - curIn;
                if (Math.abs(delta) <= abutTol * 0.5) continue;
                applyTimelineDeltaToRawSegment(track, curIdx, curSeg, delta, t0);
                adjustments.push({
                    kind: isOverlap ? 'overlap' : 'micro-gap',
                    region: curIdx + 1,
                    after: prevIdx + 1,
                    gap: regionSwapDiagFmtSec(gap),
                    from: regionSwapDiagFmtSec(curIn),
                    to: regionSwapDiagFmtSec(targetIn),
                    delta: regionSwapDiagFmtSec(delta),
                });
            }
            if (!adjustments.length) break;
            changed = true;
            regionSwapDiagLog('swap/timeline-abut', { pass: pass + 1, adjustments });
        }
        return changed;
    }
    /** タイムライン上の sub-frame 微小隙間を吸着（セッション復元後・手動修復用） */
    function repairTrackMicroTimelineGaps(track, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const segments = getTrackSegments(track);
        if (!segments || segments.length < 2) return false;
        const copies = segments.map((s) => ({ ...s }));
        const t0 = getTrackTimelineStartSec(track);
        snapshotSegmentTimelineAnchorsOnCopies(track, copies);
        const changed = eliminateSegmentCopyTimelineOverlaps(track, copies, t0, {
            resolveOverlap: o.resolveOverlap === true,
            closeMicroGaps: o.closeMicroGaps !== false,
        });
        if (!changed) return false;
        regionSwapDiagLog('repair/micro-gaps', {
            ex: isExtraTrackRef(track) ? track.slot + 1 : null,
            stage: o.stage || 'manual',
        });
        const normalized = copies.map((s) =>
            normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
        );
        setTrackSegments(track, normalized, {
            silent: o.silent !== false,
            skipUndo: true,
            segmentStructureChanged: true,
            affectedSegmentIndices: normalized.map((_, i) => i),
        });
        return true;
    }
    function finalizeSegmentCopyTimelineLayout(track, segments, t0, stage, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        eliminateSegmentCopyTimelineOverlaps(track, segments, t0, {
            resolveOverlap: !o.skipOverlapResolve,
            closeMicroGaps: !o.skipMicroGapClose,
        });
        return regionSwapDiagCheckSegmentTimelineOverlaps(track, segments, stage);
    }
    window.finalizeSegmentCopyTimelineLayout = finalizeSegmentCopyTimelineLayout;
    window.snapshotSegmentTimelineAnchorsOnCopies = snapshotSegmentTimelineAnchorsOnCopies;
    /** 入れ替え前: 全セグメントの絶対タイムライン位置を segments コピーへ固定 */
    function snapshotSegmentTimelineAnchorsOnCopies(track, segments) {
        if (!segments || !segments.length) return;
        for (let i = 0; i < segments.length; i++) {
            segments[i].timelineStartSec = getSegmentTimelineStart(track, i);
            segments[i].regionTimelineInSec = getSegmentRegionTimelineIn(track, i);
        }
    }
    function applyTimelineDeltaToRawSegment(track, segmentIndex, seg, delta, t0) {
        if (!seg || !Number.isFinite(delta) || Math.abs(delta) < 0.00001) return;
        const anchor = Number.isFinite(seg.timelineStartSec)
            ? seg.timelineStartSec
            : getSegmentTimelineStart(track, segmentIndex);
        const regionIn = Number.isFinite(seg.regionTimelineInSec)
            ? seg.regionTimelineInSec
            : anchor;
        applySegmentToSilentGapPosition(track, segmentIndex, seg, regionIn + delta, t0);
    }
    /** 無音フレーズスロット先頭へリージョン In を合わせる（In パッドは維持） */
    function applySegmentToSilentGapPosition(track, segmentIndex, seg, targetRegionIn, t0) {
        if (!seg || !Number.isFinite(targetRegionIn)) return;
        const anchor = Number.isFinite(seg.timelineStartSec)
            ? seg.timelineStartSec
            : getSegmentTimelineStart(track, segmentIndex);
        const regionIn = Number.isFinite(seg.regionTimelineInSec)
            ? seg.regionTimelineInSec
            : getSegmentRegionTimelineIn(track, segmentIndex);
        const inPad = Math.max(0, regionIn - anchor);
        const newAnchor = targetRegionIn - inPad;
        seg.timelineStartSec = newAnchor;
        seg.regionTimelineInSec = Math.max(0, targetRegionIn);
        // live state（headPad / regionTimelineInSec）は setTrackSegments 確定時に
        // syncTrackHeadPadFromFirstSegment へ委譲 — プレビュー配置中の live 更新は
        // 入れ替えアニメの「旧位置」取得を壊すため行わない
    }
    /** 無音 gap 削除に伴う Phrase 展開 counts から当該グループを除去 */
    function syncPhraseGridAfterSilentGapDelete(gap) {
        if (
            typeof getMusicalGridPhraseFillVisible !== 'function' ||
            !getMusicalGridPhraseFillVisible()
        ) {
            return false;
        }
        if (!gap || !Number.isFinite(gap.phraseIndex) || gap.phraseIndex < 0) {
            return false;
        }
        const pi = gap.phraseIndex | 0;
        const counts =
            typeof window.getExpandedPhraseGroupBarCountsSnapshot === 'function'
                ? window.getExpandedPhraseGroupBarCountsSnapshot()
                : [];
        if (!counts.length || pi >= counts.length) return false;
        if (typeof window.splicePhraseGroupAtIndex !== 'function') return false;
        const next = window.splicePhraseGroupAtIndex(counts, pi);
        if (!next) return false;
        const phraseBefore = regionSwapDiagPhraseText();
        if (typeof window.applyPhraseGroupBarCountsForRegionSwap === 'function') {
            window.applyPhraseGroupBarCountsForRegionSwap(next, { skipUndo: true });
        } else if (typeof window.clearPhraseGroupBarCountsOverride === 'function') {
            window.clearPhraseGroupBarCountsOverride();
        }
        regionSwapDiagLog('phrase/silent-gap-delete', {
            phraseIndex: pi + 1,
            partial: !!gap.partial,
            before: phraseBefore,
            after: regionSwapDiagPhraseText(),
            countsHead: next.slice(0, 8),
        });
        if (typeof writeLog === 'function') {
            writeLog(
                'Phrase: removed slot ' +
                    (pi + 1) +
                    ' (silent gap delete): ' +
                    regionSwapDiagPhraseText(),
            );
        }
        return true;
    }
    function deleteSilentGapAt(track, gapIndex, opt) {
        const gaps = collectTrackSilentGaps(track);
        const gap = gaps[gapIndex | 0];
        if (!gap) return false;
        const gapDur = gap.endSec - gap.startSec;
        const eps = segmentBoundaryJoinEpsilonSec();
        if (!(gapDur > eps)) return false;
        const phraseFillOn =
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible();
        if (!(opt && opt.skipUndoCapture) && !regionUndoPaused) {
            requestRegionUndoCapture({ includePhrase: !!phraseFillOn });
        }
        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        if (!segments.length) return false;
        let fromIndex = gap.beforeSegmentIndex;
        if (!(fromIndex >= 0)) {
            fromIndex = 0;
            for (let i = 0; i < segments.length; i++) {
                if (getSegmentTimelineStart(track, i) >= gap.endSec - eps) {
                    fromIndex = i;
                    break;
                }
            }
        }
        if (typeof shiftSegmentEntriesTimelineFromIndex === 'function') {
            shiftSegmentEntriesTimelineFromIndex(
                segments,
                track,
                fromIndex,
                -gapDur,
            );
        } else {
            for (let i = fromIndex; i < segments.length; i++) {
                if (Number.isFinite(segments[i].timelineStartSec)) {
                    segments[i].timelineStartSec -= gapDur;
                }
            }
        }
        const normalized = segments.map((s) =>
            normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
        );
        applySegmentsToState(track, normalized, {
            skipUndo: true,
            segmentStructureChanged: false,
            affectedSegmentIndices: normalized.map((_, i) => i),
        });
        if (phraseFillOn) {
            syncPhraseGridAfterSilentGapDelete(gap);
            if (typeof window.rebuildAllTrackTimelineSlots === 'function') {
                window.rebuildAllTrackTimelineSlots({ infer: true });
            }
        }
        if (!(opt && opt.skipClearSelection) && typeof clearRegionSelection === 'function') {
            clearRegionSelection();
        }
        const label = Number.isFinite(gap.phraseIndex)
            ? 'phrase ' + (gap.phraseIndex + 1)
            : 'gap @ ' + gap.startSec.toFixed(2) + 's';
        writeLog(
            'Ex ' +
                (track.slot + 1) +
                ': silent ' +
                label +
                ' removed (ripple −' +
                gapDur.toFixed(2) +
                's)',
        );
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Ex ' + (track.slot + 1), 'Silent gap removed', 'notice');
        }
        return true;
    }
    function isSegmentTimelineInSilentGap(track, segmentIndex, gap, eps) {
        if (!gap || !(segmentIndex >= 0)) return false;
        const segStart = getSegmentRegionTimelineIn(track, segmentIndex);
        const segEnd = getSegmentTimelineEnd(track, segmentIndex);
        const mid = (segStart + segEnd) * 0.5;
        return mid >= gap.startSec - eps && mid <= gap.endSec + eps;
    }
    function segmentEffectivelySilent(track, segmentIndex) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return false;
        const dur = (Number(seg.sourceOutSec) || 0) - (Number(seg.sourceInSec) || 0);
        return !(dur > 0.0005);
    }
    /** 境界結合列 / regionGroupId グループを含む入れ替え単位 */
    function resolveRegionSwapUnitSegmentIndices(track, segmentIndex) {
        const idx = segmentIndex | 0;
        if (!(idx >= 0)) return [];
        const gid = getSegmentRegionGroupId(track, idx);
        if (gid) {
            return sortSegmentIndicesByTimeline(
                track,
                collectRegionGroupMemberIndices(track, idx),
            );
        }
        const joined = collectPhraseSlotJoinedSegmentIndices(track, idx);
        if (joined.length > 1) {
            return sortSegmentIndicesByTimeline(track, joined);
        }
        return [idx];
    }
    function repositionRegionSwapUnitToTimelineSec(
        track,
        segments,
        unitIndices,
        targetInSec,
        t0Opt,
    ) {
        if (!unitIndices || !unitIndices.length || !Number.isFinite(targetInSec)) return;
        const sorted = sortSegmentIndicesByTimeline(track, unitIndices);
        const leader = sorted[0];
        const seg = segments[leader];
        if (!seg) return;
        const t0 =
            Number.isFinite(t0Opt) ? t0Opt : getTrackTimelineStartSec(track);
        const curIn = segmentCopyRegionIn(seg);
        const delta = targetInSec - curIn;
        if (Math.abs(delta) < 0.00001) return;
        for (let i = 0; i < sorted.length; i++) {
            applyTimelineDeltaToRawSegment(
                track,
                sorted[i],
                segments[sorted[i]],
                delta,
                t0,
            );
        }
    }
    function previewPhraseSlotPlacementSecFromCounts(counts, slotIndex) {
        if (typeof window.previewPhraseSlotStartSecFromCounts !== 'function') return null;
        const start = window.previewPhraseSlotStartSecFromCounts(counts, slotIndex);
        if (start == null) return null;
        const eps = segmentBoundaryJoinEpsilonSec();
        return start + eps * 2;
    }
    function playbackRegionSwapBlockReason() {
        if (
            typeof isPlaybackRegionSwapAnimActive === 'function' &&
            isPlaybackRegionSwapAnimActive()
        ) {
            return 'swap animation in progress';
        }
        if (
            typeof getMusicalGridPhraseFillVisible !== 'function' ||
            !getMusicalGridPhraseFillVisible()
        ) {
            return 'phrase tint off';
        }
        if (
            typeof window.isTimelineSlotRegionSwapEnabled === 'function' &&
            !window.isTimelineSlotRegionSwapEnabled()
        ) {
            return 'slot engine disabled';
        }
        if (typeof window.swapSelectedTimelineSlots !== 'function') {
            return 'slot swap unavailable';
        }
        if (regionSelectionEntries.length !== 2) {
            return 'select exactly 2 items';
        }
        const a = regionSelectionEntries[0];
        const b = regionSelectionEntries[1];
        if (a.slot !== b.slot) {
            return 'different tracks';
        }
        const track = { type: 'extra', slot: a.slot };
        if (!isTrackRegionActive(track)) {
            return 'no active regions';
        }
        const gapEntries = regionSelectionEntries.filter((e) => e.segmentIndex < 0);
        const segEntries = regionSelectionEntries.filter((e) => e.segmentIndex >= 0);
        if (gapEntries.length > 0) {
            if (gapEntries.length !== 1 || segEntries.length !== 1) {
                return 'select 1 silent gap and 1 region';
            }
            const resolved = resolveSilentGapSwapSegmentIndices(track, segEntries);
            if (!resolved.length) {
                return 'invalid region';
            }
            return null;
        }
        if (a.segmentIndex === b.segmentIndex) {
            return 'select 2 different regions';
        }
        return null;
    }
    function notifyCannotSwapPlaybackRegions(reason) {
        regionSwapDiagLog('swap/blocked', {
            reason,
            selection: regionSelectionEntries.map((e) =>
                e.segmentIndex < 0
                    ? { silentGap: e.silentGapIndex, slot: e.slot }
                    : { seg: e.segmentIndex, slot: e.slot },
            ),
        });
        regionSwapDiagDumpSelectionTracks('swap/blocked');
        writeLog('Playback region: cannot swap (' + reason + ')');
        if (typeof flashSeekHint === 'function') {
            let hint = "Can't swap regions";
            if (reason === 'select 1 silent gap and 1 region') {
                hint = 'Ctrl+click: silent slot + 1 region (2 items)';
            } else if (reason === 'phrase slot unresolved') {
                hint = 'Could not resolve Phrase slot for selected regions';
            } else if (reason === 'phrase slot outside spec cycle') {
                hint = 'Phrase slot out of range — check Phrase definition';
            } else if (reason === 'invalid phrase spec' || reason === 'phrase fill off') {
                hint = 'Turn on Phrase fill and fix Phrase definition';
            } else if (reason === 'same phrase slot') {
                hint = 'Already in that phrase slot';
            } else if (
                reason === 'phrase span swap not applied' ||
                reason === 'phrase span swap failed' ||
                reason === 'phrase span unresolved'
            ) {
                hint = 'Phrase span swap not applied — check [MusicalSlot] log';
            } else if (reason === 'phrase span bar sum mismatch') {
                hint = 'Phrase bar counts differ — cannot swap these regions';
            } else if (reason === 'phrase block swap API missing') {
                hint = 'Phrase block swap unavailable — reload the app';
            }
            flashSeekHint('Region', hint, 'error');
        }
    }
    function swapSelectedPlaybackRegions() {
        regionSwapDiagDumpSelectionTracks('swap/E-key');
        const reason = playbackRegionSwapBlockReason();
        if (reason) {
            notifyCannotSwapPlaybackRegions(reason);
            return false;
        }
        const result = window.swapSelectedTimelineSlots();
        if (result && result.ok) {
            if (!result.noop && typeof clearRegionSelection === 'function') {
                clearRegionSelection();
            }
            regionSwapDiagDumpSelectionTracks('swap/done-slot');
            return true;
        }
        if (result && result.reason) {
            notifyCannotSwapPlaybackRegions(result.reason);
        }
        return false;
    }
    function normalizeSegmentEntry(seg, track, fullDur) {
        const base = normalizeSegment(seg.sourceInSec, seg.sourceOutSec, fullDur);
        base.id = seg && seg.id ? seg.id : newRegionId();
        if (seg && seg.clipId) {
            base.clipId = seg.clipId;
        } else if (typeof getDefaultExtraClipId === 'function' && track) {
            base.clipId = getDefaultExtraClipId(track.slot);
        } else {
            base.clipId = 'main';
        }
        if (seg && Number.isFinite(seg.timelineStartSec)) {
            base.timelineStartSec = seg.timelineStartSec;
        }
        if (seg && Number.isFinite(seg.regionTimelineInSec)) {
            base.regionTimelineInSec = Math.max(0, seg.regionTimelineInSec);
        }
        if (seg && Number.isFinite(seg.regionLeadPadSec)) {
            base.regionLeadPadSec = Math.max(0, seg.regionLeadPadSec);
        }
        if (seg && Number.isFinite(seg.gainDb)) {
            const db = Math.max(
                REGION_GAIN_DB_MIN,
                Math.min(REGION_GAIN_DB_MAX, seg.gainDb),
            );
            if (Math.abs(db) > 0.0005) base.gainDb = db;
        }
        if (seg && Number.isFinite(seg.pitchSemitones)) {
            const pitch = Math.max(
                REGION_PITCH_SEMITONES_MIN,
                Math.min(REGION_PITCH_SEMITONES_MAX, Math.round(seg.pitchSemitones)),
            );
            if (pitch !== 0) base.pitchSemitones = pitch;
        }
        if (seg && Number.isFinite(seg.fadeInSec)) {
            base.fadeInSec = Math.max(0, seg.fadeInSec);
        }
        if (seg && Number.isFinite(seg.fadeOutSec)) {
            base.fadeOutSec = Math.max(0, seg.fadeOutSec);
        }
        if (seg && seg.regionGroupId) {
            base.regionGroupId = String(seg.regionGroupId);
        }
        return base;
    }
    /** カーソル表示用（↔）。操作判定そのものは resolveRegionResizeHandleAtPointer の三角テスト */
    function isPointerOnAnyRegionFadeHandle(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        const n = getExtraTrackCount();
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            const lane = document.getElementById('extraAudioLane' + track.slot);
            if (!lane || lane.hidden) continue;
            const container = getPlaybackRegionsContainerEl(track);
            if (!container || container.hidden) continue;
            const regions = container.querySelectorAll(
                '.audio-waveform-lane__playback-region',
            );
            for (let r = 0; r < regions.length; r++) {
                const regionEl = regions[r];
                if (
                    isPointerInFadeHandleHitZone(regionEl, 'in', clientX, clientY) ||
                    isPointerInFadeHandleHitZone(regionEl, 'out', clientX, clientY)
                ) {
                    return true;
                }
            }
        }
        return false;
    }
    function isPointerOnAnyRegionResizeHandle(clientX, clientY, opt) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        const slots = [];
        if (opt && Number.isFinite(opt.slot)) {
            slots.push(opt.slot);
        } else {
            const n =
                getExtraTrackCount();
            for (let i = 0; i < n; i++) slots.push(i);
        }
        for (let i = 0; i < slots.length; i++) {
            if (
                resolveRegionResizeHandleAtPointer(
                    { type: 'extra', slot: slots[i] },
                    clientX,
                    clientY,
                )
            ) {
                return true;
            }
        }
        return false;
    }
    function getPlaybackRegionsState(track) {
        if (!isExtraTrackRef(track)) return null;
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(track.slot) : null;
        if (!tr) return null;
        if (!tr.playbackRegions) {
            if (tr.region && tr.region.active) {
                const fullDur =
                    typeof extraTrackContentDurationSec === 'function'
                        ? extraTrackContentDurationSec(track.slot)
                        : 0;
                const out =
                    Number.isFinite(tr.region.sourceOutSec) && tr.region.sourceOutSec > 0
                        ? tr.region.sourceOutSec
                        : fullDur;
                tr.playbackRegions = {
                    active: true,
                    headPadSec: 0,
                    segments: [
                        normalizeSegment(tr.region.sourceInSec, out, fullDur),
                    ],
                };
                delete tr.region;
            } else {
                tr.playbackRegions = { active: false, segments: [], headPadSec: 0 };
            }
        }
        if (!Number.isFinite(tr.playbackRegions.headPadSec)) {
            tr.playbackRegions.headPadSec = 0;
        }
        return tr.playbackRegions;
    }
    function getHeadPadSec(track) {
        const state = getPlaybackRegionsState(track);
        if (!state) return 0;
        return Math.max(0, Number(state.headPadSec) || 0);
    }
    /** リージョン左端（In ハンドル） */
    function getSegmentRegionTimelineIn(track, segmentIndex) {
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            if (state && Number.isFinite(state.regionTimelineInSec)) {
                const regionIn = Math.max(0, state.regionTimelineInSec);
                return regionIn < anchor - 0.00001 ? anchor : regionIn;
            }
            return anchor;
        }
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (raw && Number.isFinite(raw.regionTimelineInSec)) {
            const regionIn = Math.max(0, raw.regionTimelineInSec);
            return regionIn < anchor - 0.00001 ? anchor : regionIn;
        }
        return anchor;
    }
    /**
     * リージョン右端（Out ハンドル）。
     * カスタム In があるとき Out は segment 先頭 + 長さのまま固定され、
     * regionIn + (anchor - regionIn + segDur) で In オフセットを反映する。
     */
    function getSegmentRegionTimelineOut(track, segmentIndex) {
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        const timelineEnd = getSegmentTimelineEnd(track, segmentIndex);
        const segDur = Math.max(0, timelineEnd - anchor);
        return regionIn + (anchor - regionIn + segDur);
    }
    /** オーバーレイ描画・外周 □ 判定と同じ [In, Out] 区間 */
    function getSegmentRegionOverlayTimelineInterval(track, segmentIndex) {
        const trackStart = getTrackTimelineStartSec(track);
        const start = Math.max(trackStart, getSegmentRegionTimelineIn(track, segmentIndex));
        const end = getSegmentRegionTimelineOut(track, segmentIndex);
        return { start, end };
    }
    /** マーカー等: trackStart でクランプしない In〜Out */
    function getSegmentRegionTimelineInterval(track, segmentIndex) {
        return {
            start: getSegmentRegionTimelineIn(track, segmentIndex),
            end: getSegmentRegionTimelineOut(track, segmentIndex),
        };
    }
    /** アンカーと regionTimelineInSec の差（ドラッグ移動で維持する In オフセット） */
    function getSegmentRegionInPadSec(track, segmentIndex) {
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        let stored = null;
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            if (state && Number.isFinite(state.regionTimelineInSec)) {
                stored = state.regionTimelineInSec;
            }
        } else {
            const raw = getRawSegmentEntry(track, segmentIndex);
            if (raw && Number.isFinite(raw.regionTimelineInSec)) {
                stored = raw.regionTimelineInSec;
            }
        }
        if (stored == null) return 0;
        return Math.max(0, stored - anchor);
    }
    function applySegmentAnchorAndRegionInForDrag(
        track,
        segmentIndex,
        desiredAnchor,
        desiredRegionIn,
        t0,
        inPad,
    ) {
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return;
        state.segments[segmentIndex].timelineStartSec = desiredAnchor;
        if (segmentIndex === 0) {
            if (inPad > 0.00001) {
                state.regionTimelineInSec = desiredRegionIn;
            } else {
                delete state.regionTimelineInSec;
                delete state.regionLeadPadSec;
                state.headPadSec = Math.max(0, desiredAnchor - t0);
            }
            return;
        }
        const raw = state.segments[segmentIndex];
        if (inPad > 0.00001) {
            raw.regionTimelineInSec = desiredRegionIn;
        } else {
            delete raw.regionTimelineInSec;
            delete raw.regionLeadPadSec;
        }
    }
    function getSegmentRegionLeadPadSec(track, segmentIndex) {
        let lead = 0;
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            lead = Math.max(0, Number(state && state.regionLeadPadSec) || 0);
        } else {
            const raw = getRawSegmentEntry(track, segmentIndex);
            lead = Math.max(0, Number(raw && raw.regionLeadPadSec) || 0);
        }
        if (lead <= 0.00001) return 0;
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        if (regionIn > anchor + 0.00001) {
            return 0;
        }
        return lead;
    }
    /** 波形描画のタイムライン左端（リージョン In / 再生開始と同一） */
    function getSegmentWaveformDrawTimelineStart(track, segmentIndex) {
        return getSegmentWaveformVisibleTimelineStart(track, segmentIndex);
    }
    /** 波形を表示するタイムライン左端（リージョン In 以降） */
    function getSegmentWaveformVisibleTimelineStart(track, segmentIndex) {
        const segT0 = getSegmentTimelineStart(track, segmentIndex);
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        let start = regionIn > segT0 + 0.00001 ? regionIn : playbackStart;
        return start;
    }
    /** 再生上の音声開始（リージョン内先頭ギャップの後） */
    function getSegmentPlaybackTimelineStart(track, segmentIndex) {
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        if (regionIn > anchor + 0.00001) {
            return regionIn;
        }
        const leadPad = getSegmentRegionLeadPadSec(track, segmentIndex);
        if (leadPad > 0.00001) {
            return regionIn + leadPad;
        }
        return anchor;
    }
    /** タイムライン位置をクリップ内ソース秒へ（実再生開始基準） */
    function segmentSourceSecFromTransport(track, segmentIndex, transportSec) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return 0;
        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const t = Number(transportSec);
        const span = Math.max(0, seg.sourceOutSec - seg.sourceInSec);
        const local = Math.max(0, Math.min(span, t - playbackStart));
        return seg.sourceInSec + local;
    }
    function setSegmentRegionLeadPadSec(track, segmentIndex, sec) {
        const lead = Math.max(0, Number(sec) || 0);
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            if (!state) return;
            if (lead <= 0.00001) {
                delete state.regionLeadPadSec;
            } else {
                state.regionLeadPadSec = lead;
            }
            return;
        }
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return;
        const raw = state.segments[segmentIndex];
        if (lead <= 0.00001) {
            delete raw.regionLeadPadSec;
        } else {
            raw.regionLeadPadSec = lead;
        }
    }
    function setSegmentRegionTimelineIn(track, segmentIndex, regionIn) {
        const audioEnd = getSegmentTimelineEnd(track, segmentIndex);
        const maxIn = audioEnd - PLAYBACK_REGION_MIN_SEC;
        const clamped = Math.max(0, Math.min(Number(regionIn) || 0, maxIn));
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            if (!state) return;
            if (Math.abs(clamped - anchor) < 0.00001) {
                delete state.regionTimelineInSec;
            } else {
                state.regionTimelineInSec = clamped;
            }
            return;
        }
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return;
        const raw = state.segments[segmentIndex];
        if (Math.abs(clamped - anchor) < 0.00001) {
            delete raw.regionTimelineInSec;
        } else {
            raw.regionTimelineInSec = clamped;
        }
    }
    function extendSegmentAnchorLeft(track, segmentIndex, regionIn, audioEnd, t0, opt) {
        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        const seg = segments[segmentIndex];
        const state = getPlaybackRegionsState(track);
        if (!seg || !state) return;
        const newAnchor = regionIn;
        const newDur = audioEnd - newAnchor;
        seg.sourceInSec = Math.max(0, seg.sourceOutSec - newDur);
        if (segmentIndex === 0) {
            state.headPadSec = Math.max(0, newAnchor - t0);
            delete state.regionTimelineInSec;
            delete state.regionLeadPadSec;
        } else {
            seg.timelineStartSec = newAnchor;
            delete seg.regionTimelineInSec;
            delete seg.regionLeadPadSec;
        }
        applySegmentsToState(
            track,
            segments.map((s) =>
                normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
            ),
            {
                silent: true,
                skipUndo: true,
                geometryOnly: !!(opt && opt.geometryOnly),
                skipPersist: !!(opt && opt.geometryOnly),
            },
        );
    }
    function applySegmentRegionInFromTransport(track, segmentIndex, transportSec, opt) {
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        const audioEnd = getSegmentTimelineEnd(track, segmentIndex);
        const t0 = getTrackTimelineStartSec(track);
        let regionIn = Math.max(
            0,
            Math.min(audioEnd - PLAYBACK_REGION_MIN_SEC, transportSec),
        );
        if (segmentIndex === 0) {
            regionIn = Math.max(t0, regionIn);
        }
        regionIn = clampSegmentTimelineStart(track, segmentIndex, regionIn);
        const maxPadIn = audioEnd - PLAYBACK_REGION_MIN_SEC;
        if (regionIn < anchor - 0.00001) {
            if (
                segmentIndex > 0 &&
                isSegmentBoundaryJoined(track, segmentIndex - 1)
            ) {
                setSplitBoundaryFromTransport(track, segmentIndex - 1, regionIn, opt);
                return;
            }
            extendSegmentAnchorLeft(track, segmentIndex, regionIn, audioEnd, t0, opt);
            return;
        }
        if (regionIn <= anchor + 0.00001) {
            setSegmentRegionTimelineIn(track, segmentIndex, anchor);
            setSegmentRegionLeadPadSec(track, segmentIndex, 0);
            if (opt && opt.geometryOnly) {
                refreshTrackRegionOverlayGeometry(track);
            } else {
                updateTrackRegionOverlays(track);
            }
            redrawAfterRegionChange(track.slot, {
                segmentIndex,
                geometryOnly: !!(opt && opt.geometryOnly),
            });
            return;
        }
        if (regionIn <= maxPadIn + 0.00001) {
            setSegmentRegionTimelineIn(track, segmentIndex, regionIn);
            setSegmentRegionLeadPadSec(track, segmentIndex, 0);
            if (opt && opt.geometryOnly) {
                refreshTrackRegionOverlayGeometry(track);
            } else {
                updateTrackRegionOverlays(track);
            }
            redrawAfterRegionChange(track.slot, {
                segmentIndex,
                geometryOnly: !!(opt && opt.geometryOnly),
            });
            return;
        }
        extendSegmentAnchorLeft(track, segmentIndex, regionIn, audioEnd, t0, opt);
    }
    function getTrackSourceDurationSec(track) {
        if (!isExtraTrackRef(track)) return 0;
        if (typeof getExtraTrackMaxClipDurationSec === 'function') {
            const d = getExtraTrackMaxClipDurationSec(track.slot);
            if (d > 0) return d;
        }
        if (typeof extraTrackBufferDuration === 'function') {
            const d = extraTrackBufferDuration(track.slot);
            if (d > 0) return d;
        }
        return 0;
    }
    /** マスター尺用: 各セグメントがクリップ長まで伸ばせるタイムライン終端 */
    function getExtraTrackMaxTimelineEndSec(track) {
        if (!isExtraTrackRef(track)) return 0;
        const t0 = getTrackTimelineStartSec(track);
        const segments = getTrackSegments(track);
        if (!segments.length) {
            const buf = getTrackSourceDurationSec(track);
            return t0 + (buf > 0 ? buf : 0);
        }
        let end = t0;
        for (let i = 0; i < segments.length; i++) {
            end = Math.max(end, getSegmentTimelineEnd(track, i));
            end = Math.max(end, maxSegmentTimelineEndSec(track, i));
        }
        return end;
    }
    function getTrackTimelineStartSec(track) {
        if (!isExtraTrackRef(track)) return 0;
        if (typeof getExtraTrackTimelineStartSec === 'function') {
            return getExtraTrackTimelineStartSec(track.slot);
        }
        return 0;
    }
    function getPrimaryClipIdForTrack(track) {
        if (!isExtraTrackRef(track)) return 'main';
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(track.slot) : null;
        if (tr && tr.clips && tr.clips.length && tr.clips[0].id) {
            return tr.clips[0].id;
        }
        return 'main';
    }
    function ensureDefaultTrackRegion(track, opt) {
        if (!isExtraTrackRef(track)) return false;
        const state = getPlaybackRegionsState(track);
        if (!state || (state.active && state.segments && state.segments.length)) {
            return false;
        }
        const fullDur = getTrackSourceDurationSec(track);
        if (!fullDur) return false;
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(track.slot) : null;
        const segments = [];
        if (tr && tr.clips && tr.clips.length > 1) {
            for (const c of tr.clips) {
                if (!c.buffer || c.buffer.duration <= 0) continue;
                segments.push({
                    id: newRegionId(),
                    clipId: c.id || 'main',
                    sourceInSec: 0,
                    sourceOutSec: c.buffer.duration,
                });
            }
        }
        if (!segments.length) {
            segments.push({
                id: newRegionId(),
                clipId: getPrimaryClipIdForTrack(track),
                sourceInSec: 0,
                sourceOutSec: fullDur,
            });
        }
        state.segments = segments;
        state.active = true;
        state.headPadSec = Math.max(0, Number(state.headPadSec) || 0);
        if (!(opt && opt.skipOverlay) && typeof updateTrackRegionOverlays === 'function') {
            updateTrackRegionOverlays(track);
        }
        if (!(opt && opt.silent) && typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        return true;
    }
    const trackSegmentsMemoBySlot = [];
    let getTrackSegmentsBuildSlot = -1;
    let getTrackSegmentsBuildQuick = null;
    function buildTrackSegmentsQuick(track) {
        const state = getPlaybackRegionsState(track);
        if (!state || !state.active || !state.segments || !state.segments.length) {
            return [];
        }
        const normalized = [];
        for (let i = 0; i < state.segments.length; i++) {
            const raw = state.segments[i];
            const fullDur = getSegmentSourceDurationSec(track, raw);
            if (!fullDur) continue;
            normalized.push(normalizeSegmentEntry(raw, track, fullDur));
        }
        return normalized;
    }
    function getTrackSegments(track) {
        const state = getPlaybackRegionsState(track);
        if (!state) return [];
        if (
            !isSessionRestoreBusy() &&
            (!state.active || !state.segments || !state.segments.length)
        ) {
            ensureDefaultTrackRegion(track, { skipOverlay: true, silent: true });
        }
        if (!state.active || !state.segments || !state.segments.length) {
            return [];
        }
        if (isExtraTrackRef(track)) {
            const slot = track.slot | 0;
            if (getTrackSegmentsBuildSlot === slot) {
                if (typeof window.regionRestoreDiagLog === 'function') {
                    window.regionRestoreDiagLog('getTrackSegments/reenter', {
                        ex: slot + 1,
                        hasQuick: !!getTrackSegmentsBuildQuick,
                    });
                }
                if (getTrackSegmentsBuildQuick) return getTrackSegmentsBuildQuick;
                return buildTrackSegmentsQuick(track);
            }
            const epoch = getRegionPersistEpoch(slot);
            const memo = trackSegmentsMemoBySlot[slot];
            if (memo && memo.epoch === epoch) {
                return memo.segments;
            }
            getTrackSegmentsBuildSlot = slot;
            getTrackSegmentsBuildQuick = null;
            try {
                const normalized = buildTrackSegmentsQuick(track);
                getTrackSegmentsBuildQuick = normalized;
                trackSegmentsMemoBySlot[slot] = { epoch, segments: normalized };
                return normalized;
            } finally {
                getTrackSegmentsBuildSlot = -1;
                getTrackSegmentsBuildQuick = null;
            }
        }
        return buildTrackSegmentsQuick(track);
    }
    function getSegmentCount(track) {
        return getTrackSegments(track).length;
    }
    function getRawSegmentEntry(track, segmentIndex) {
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return null;
        return state.segments[segmentIndex];
    }
    function getTrackRegionBounds(track) {
        const fullDur = getTrackSourceDurationSec(track);
        const segments = getTrackSegments(track);
        if (!fullDur || !segments.length) {
            return { sourceInSec: 0, sourceOutSec: 0, fullDurSec: fullDur, active: false };
        }
        return {
            sourceInSec: segments[0].sourceInSec,
            sourceOutSec: segments[segments.length - 1].sourceOutSec,
            fullDurSec: fullDur,
            active: true,
        };
    }
    function isTrackRegionActive(track) {
        return getTrackSegments(track).length > 0;
    }
    function isPlaybackRegionActive() {
        const n =
            getExtraTrackCount();
        for (let i = 0; i < n; i++) {
            if (isTrackRegionActive({ type: 'extra', slot: i })) return true;
        }
        return false;
    }
    function getCompactSegmentTimelineStart(track, segmentIndex) {
        const t0 = getTrackTimelineStartSec(track);
        const segments = getTrackSegments(track);
        let offset = getHeadPadSec(track);
        for (let i = 0; i < segmentIndex && i < segments.length; i++) {
            offset += segments[i].sourceOutSec - segments[i].sourceInSec;
        }
        return t0 + offset;
    }
    function getSegmentTimelineStart(track, segmentIndex) {
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (raw && Number.isFinite(raw.timelineStartSec)) {
            return raw.timelineStartSec;
        }
        return getCompactSegmentTimelineStart(track, segmentIndex);
    }
    function getSegmentTimelineEnd(track, segmentIndex) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return getTrackTimelineStartSec(track);
        return getSegmentTimelineStart(track, segmentIndex) + (seg.sourceOutSec - seg.sourceInSec);
    }
