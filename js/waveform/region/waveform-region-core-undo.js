/**
 * waveform-region-core-undo.js — Undo/Redo・履歴復元
 */
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
        const phraseFillOn =
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible();
        if (!phraseFillOn) {
            finishDeferredRegionHistoryRestore(targetSnap, onDone);
            return false;
        }
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
    /** 無音リージョン削除調査用 — constants.js の DEBUG_LOG.SILENT_GAP_DELETE */
    function silentGapDeleteDiagFmtPayload(payload) {
        if (payload == null) return '';
        if (typeof payload === 'string') return payload;
        return JSON.stringify(payload, (_, v) =>
            Number.isFinite(v) && Math.abs(v) < 1e6 && Math.abs(v) > 0.0001
                ? Math.round(v * 10000) / 10000
                : v,
        );
    }
    function silentGapDeleteDiagLog(stage, payload) {
        if (
            typeof window.isDebugLogCategoryEnabled !== 'function' ||
            !window.isDebugLogCategoryEnabled('SILENT_GAP_DELETE')
        ) {
            return;
        }
        if (typeof writeLog !== 'function') return;
        const tail = silentGapDeleteDiagFmtPayload(payload);
        writeLog('[SilentGapDel] ' + stage + (tail ? ' | ' + tail : ''));
        if (typeof window.musicalSlotDiagLog === 'function') {
            window.musicalSlotDiagLog('silent-del/' + stage, payload);
        }
    }
    function silentGapDeleteDiagSnapshotTrack(track) {
        const snap = {
            ex: isExtraTrackRef(track) ? (track.slot | 0) + 1 : null,
            active: isExtraTrackRef(track) ? isTrackRegionActive(track) : false,
            segCount: 0,
            segments: [],
            gaps: [],
            slots: [],
            phrase: regionSwapDiagPhraseText(),
        };
        if (!isExtraTrackRef(track) || !isTrackRegionActive(track)) return snap;
        const segments = getTrackSegments(track);
        snap.segCount = segments.length;
        for (let i = 0; i < segments.length; i++) {
            snap.segments.push({
                region: i + 1,
                in: regionSwapDiagFmtSec(getSegmentRegionTimelineIn(track, i)),
                out: regionSwapDiagFmtSec(getSegmentRegionTimelineOut(track, i)),
            });
        }
        const gaps = collectTrackSilentGaps(track);
        for (let gi = 0; gi < gaps.length; gi++) {
            const g = gaps[gi];
            snap.gaps.push({
                gapIndex: gi,
                phraseSlot: Number.isFinite(g.phraseIndex) ? (g.phraseIndex | 0) + 1 : null,
                partial: !!g.partial,
                start: regionSwapDiagFmtSec(g.startSec),
                end: regionSwapDiagFmtSec(g.endSec),
                beforeSeg: Number.isFinite(g.beforeSegmentIndex) ? g.beforeSegmentIndex + 1 : null,
                afterSeg: Number.isFinite(g.afterSegmentIndex) ? g.afterSegmentIndex + 1 : null,
            });
        }
        if (typeof window.getTrackTimelineSlots === 'function') {
            const slots = window.getTrackTimelineSlots(track, { writeCache: false });
            for (let si = 0; si < slots.length; si++) {
                const s = slots[si];
                snap.slots.push({
                    unit: si,
                    kind: s.kind,
                    phraseSlot:
                        s.musical && Number.isFinite(s.musical.phraseSlotIndex)
                            ? (s.musical.phraseSlotIndex | 0) + 1
                            : null,
                    meta:
                        s.musical &&
                        typeof window.formatSwapUnitStoredMusicalMetaText === 'function'
                            ? window.formatSwapUnitStoredMusicalMetaText(s.musical)
                            : null,
                });
            }
        }
        return snap;
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
