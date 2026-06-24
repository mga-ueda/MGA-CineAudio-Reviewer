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
    function bumpVideoRegionPersistEpoch() {
        regionPersistEpochVideo = (regionPersistEpochVideo || 0) + 1;
    }
    window.bumpVideoRegionPersistEpoch = bumpVideoRegionPersistEpoch;
    function getRegionPersistEpoch(slot) {
        if (!(slot >= 0)) return 0;
        return Number(regionPersistEpochBySlot[slot] || 0);
    }
    function getVideoRegionPersistEpoch() {
        return Number(regionPersistEpochVideo || 0);
    }
    window.getVideoRegionPersistEpoch = getVideoRegionPersistEpoch;
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
    window.clearTrackSegmentsMemoForSlot = clearTrackSegmentsMemoForSlot;
    window.pruneRegionUndoStackIncompatibleWithCurrentTransport =
        pruneRegionUndoStackIncompatibleWithCurrentTransport;
    window.regionUndoSnapshotDurationScaleCompatible =
        regionUndoSnapshotDurationScaleCompatible;
    function emptyPlaybackRegionsState() {
        return { active: false, segments: [], headPadSec: 0 };
    }
    function regionUndoSnapshotIncludeRehearsal(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!o.includeRehearsal) return false;
        return (
            typeof getMusicalGridRehearsalFillVisible === 'function' &&
            getMusicalGridRehearsalFillVisible() &&
            typeof captureRehearsalUndoSnapshot === 'function'
        );
    }
    function normalizeRegionUndoSnapshot(snap) {
        if (Array.isArray(snap)) {
            return {
                tracks: snap,
                rehearsal: null,
                rehearsalExpandedCounts: null,
                markers: null,
                musicalGrid: null,
            };
        }
        if (snap && Array.isArray(snap.tracks)) {
            return {
                tracks: snap.tracks,
                rehearsal: snap.rehearsal != null ? snap.rehearsal : null,
                rehearsalExpandedCounts:
                    snap.rehearsalExpandedCounts && snap.rehearsalExpandedCounts.length
                        ? snap.rehearsalExpandedCounts.slice()
                        : null,
                markers: Array.isArray(snap.markers) ? snap.markers : null,
                musicalGrid:
                    snap.musicalGrid && typeof snap.musicalGrid === 'object'
                        ? snap.musicalGrid
                        : null,
            };
        }
        return {
            tracks: [],
            rehearsal: null,
            rehearsalExpandedCounts: null,
            markers: null,
            musicalGrid: null,
        };
    }
    /** Undo スナップショット上のリージョン終端（秒）— タイムストレッチ前後の混在検出用 */
    function regionUndoSnapshotMaxRegionEndSec(snap) {
        const normalized = normalizeRegionUndoSnapshot(snap);
        let max = 0;
        const tracks = normalized.tracks || [];
        for (let ti = 0; ti < tracks.length; ti++) {
            const entry = tracks[ti];
            const segs =
                entry && entry.playbackRegions && Array.isArray(entry.playbackRegions.segments)
                    ? entry.playbackRegions.segments
                    : [];
            for (let si = 0; si < segs.length; si++) {
                const seg = segs[si];
                if (!seg) continue;
                let end = Number(seg.regionTimelineOutSec);
                if (!Number.isFinite(end)) {
                    const inSec = Number(seg.regionTimelineInSec);
                    const srcIn = Number(seg.sourceInSec);
                    const srcOut = Number(seg.sourceOutSec);
                    if (Number.isFinite(inSec) && Number.isFinite(srcOut) && Number.isFinite(srcIn)) {
                        end = inSec + Math.max(0, srcOut - srcIn);
                    } else if (Number.isFinite(srcOut)) {
                        end = srcOut;
                    }
                }
                if (Number.isFinite(end) && end > max) max = end;
            }
        }
        return max;
    }
    function regionUndoSnapshotDurationScaleCompatible(snap, masterSec) {
        if (!(masterSec > 0)) return true;
        const snapMax = regionUndoSnapshotMaxRegionEndSec(snap);
        if (!(snapMax > 0.01)) return true;
        const ratio = snapMax / masterSec;
        return ratio >= 0.92 && ratio <= 1.08;
    }
    /** 現在のマスター尺と合わない Undo エントリを除去（タイムストレッチ後に古い履歴が残る問題） */
    function pruneRegionUndoStackIncompatibleWithCurrentTransport() {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return 0;
        let removed = 0;
        for (let i = regionUndoStack.length - 1; i >= 0; i--) {
            if (regionUndoSnapshotDurationScaleCompatible(regionUndoStack[i], master)) {
                continue;
            }
            regionUndoStack.splice(i, 1);
            removed++;
        }
        if (removed > 0) {
            const msg =
                'pruned ' +
                removed +
                ' undo entr' +
                (removed === 1 ? 'y' : 'ies') +
                ' incompatible with current transport scale';
            if (typeof actionLog === 'function') {
                actionLog('Region', msg);
            } else if (typeof writeActionLog === 'function') {
                writeActionLog('Region', msg);
            } else if (typeof writeLog === 'function') {
                writeLog('Playback region: ' + msg);
            }
        }
        return removed;
    }
    function restoredPlaybackHasUsableTimelineSlots(playbackRegions) {
        const slots =
            playbackRegions && Array.isArray(playbackRegions.timelineSlots)
                ? playbackRegions.timelineSlots
                : null;
        return (
            typeof window.persistedTimelineSlotsAreUsable === 'function' &&
            window.persistedTimelineSlotsAreUsable(slots) &&
            (typeof window.persistedTimelineSlotsHaveSegmentRefs !== 'function' ||
                window.persistedTimelineSlotsHaveSegmentRefs(slots))
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
        return audioSlots !== segs;
    }
    function restoredTimelineSlotAudioCountMatchesSegments(entry) {
        if (!entry || !entry.playbackRegions) return false;
        const segs = Array.isArray(entry.playbackRegions.segments)
            ? entry.playbackRegions.segments.length
            : 0;
        const slots = entry.playbackRegions.timelineSlots;
        if (!Array.isArray(slots) || !segs) return false;
        let audioSlots = 0;
        for (let i = 0; i < slots.length; i++) {
            if (slots[i] && slots[i].kind !== 'silent') audioSlots++;
        }
        return audioSlots === segs;
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
            raw.regionTimelineOutSec = getSegmentRegionTimelineOut(track, i);
        }
    }
    /** Undo 復元後 — segment から slot を再構築し、必要ならスナップショット slot を復元 */
    function refreshRegionUndoTimelineSlotsAfterRestore(normalized, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (typeof window.invalidateTrackTimelineSlotsReadCache === 'function') {
            window.invalidateTrackTimelineSlotsReadCache();
        }
        const n = getExtraTrackCount();
        for (let i = 0; i < n; i++) {
            const entry = normalized.tracks.find((e) => e.slot === i);
            const track = { type: 'extra', slot: i };
            const tr =
                typeof extraTrackBySlot === 'function' ? extraTrackBySlot(i) : null;
            if (entry && tr && tr.playbackRegions) {
                if (restoredTimelineSlotAudioCountMatchesSegments(entry)) {
                    if (
                        restoredPlaybackHasUsableTimelineSlots(entry.playbackRegions) &&
                        typeof window.restoreTimelineSlotsForTrack === 'function'
                    ) {
                        window.restoreTimelineSlotsForTrack(
                            track,
                            entry.playbackRegions.timelineSlots,
                        );
                    }
                } else {
                    tr.playbackRegions.timelineSlots = [];
                }
            }
            if (typeof window.getTrackTimelineSlots === 'function') {
                window.getTrackTimelineSlots(track, {
                    forceRebuild: true,
                    writeCache: true,
                });
            }
        }
        if (!o.deferRedraw) {
            for (let i = 0; i < n; i++) {
                updateTrackRegionOverlays({ type: 'extra', slot: i });
                redrawAfterRegionChange(i);
            }
            updateAllPlaybackRegionOverlays();
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
                if (
                    regionUndoSnapshotIncludeRehearsal(opt) &&
                    typeof window.getTrackTimelineSlots === 'function'
                ) {
                    window.getTrackTimelineSlots(
                        { type: 'extra', slot: i },
                        { forceRebuild: true, writeCache: true },
                    );
                }
                playbackRegions = deepCloneJson(tr.playbackRegions);
            }
            const timelineStartSec =
                typeof getExtraTrackTimelineStartSec === 'function'
                    ? getExtraTrackTimelineStartSec(i)
                    : 0;
            tracks.push({ slot: i, playbackRegions, timelineStartSec });
        }
        let rehearsal = null;
        let rehearsalExpandedCounts = null;
        const rehearsalFillOn =
            typeof getMusicalGridRehearsalFillVisible === 'function' &&
            getMusicalGridRehearsalFillVisible();
        if (regionUndoSnapshotIncludeRehearsal(opt)) {
            rehearsal = captureRehearsalUndoSnapshot();
        }
        if (
            rehearsalFillOn &&
            typeof window.getExpandedRehearsalGroupBarCountsSnapshot === 'function'
        ) {
            const counts = window.getExpandedRehearsalGroupBarCountsSnapshot();
            if (counts && counts.length) {
                rehearsalExpandedCounts = counts.slice();
            }
        }
        let markers = null;
        if (typeof getMarkersSnapshot === 'function') {
            markers = getMarkersSnapshot();
        }
        let musicalGrid = null;
        if (
            regionUndoSnapshotIncludeRehearsal(opt) &&
            typeof window.getMusicalGridPersistSnapshot === 'function'
        ) {
            musicalGrid = deepCloneJson(window.getMusicalGridPersistSnapshot());
        }
        return { tracks, rehearsal, rehearsalExpandedCounts, markers, musicalGrid };
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
    function noteRegionUndoActionLabel(label) {
        const text = label != null ? String(label).trim() : '';
        if (!text || !regionUndoStack.length) return;
        regionUndoStack[regionUndoStack.length - 1].actionLabel = text;
    }
    window.noteRegionUndoActionLabel = noteRegionUndoActionLabel;
    function requestRegionUndoCapture(opt) {
        if (regionUndoPaused) return;
        if (typeof window.clearRegionSwapHistoryAnimHint === 'function') {
            window.clearRegionSwapHistoryAnimHint();
        }
        const snap = captureRegionUndoSnapshot(opt);
        const top = regionUndoStack.length
            ? regionUndoStack[regionUndoStack.length - 1]
            : null;
        const forceCapture = !!(opt && opt.forceCapture);
        if (!forceCapture && top && regionUndoSnapshotsEqual(top, snap)) return;
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
    /** head pad swap — undo スタック先頭へスワップ前 mark 列を固定（plan 内 ripple 後の上書き防止） */
    function attachHeadPadSwapPreMarksToUndoStackTop(marks, counts) {
        if (regionUndoPaused || !regionUndoStack.length) return;
        if (!Array.isArray(marks) || !marks.length) return;
        const top = regionUndoStack[regionUndoStack.length - 1];
        const clonedMarks = marks.map((e) => ({
            sec: Number(e.sec),
            label: e.label != null ? String(e.label) : '',
        }));
        if (!top.musicalGrid || typeof top.musicalGrid !== 'object') {
            top.musicalGrid =
                typeof window.getMusicalGridPersistSnapshot === 'function'
                    ? deepCloneJson(window.getMusicalGridPersistSnapshot())
                    : {};
        } else {
            top.musicalGrid = deepCloneJson(top.musicalGrid);
        }
        top.musicalGrid.rehearsalMarkTrackEvents = clonedMarks;
        if (Array.isArray(counts) && counts.length) {
            top.rehearsalExpandedCounts = counts.slice();
        }
    }
    /** Undo 復元後 — スナップショット上の gain/key を segment へ書き戻し marker と同期 */
    function applyRestoredSegmentAudioAttributesFromUndoTracks(tracks) {
        if (!Array.isArray(tracks)) return;
        for (let ti = 0; ti < tracks.length; ti++) {
            const entry = tracks[ti];
            if (!entry || !(entry.slot >= 0)) continue;
            const track = { type: 'extra', slot: entry.slot };
            const savedSegs =
                entry.playbackRegions && Array.isArray(entry.playbackRegions.segments)
                    ? entry.playbackRegions.segments
                    : null;
            if (!savedSegs || !savedSegs.length) continue;
            const state = getPlaybackRegionsState(track);
            if (!state || !Array.isArray(state.segments) || !state.segments.length) continue;
            const savedById = new Map();
            for (let si = 0; si < savedSegs.length; si++) {
                const s = savedSegs[si];
                if (s && s.id) savedById.set(String(s.id), s);
            }
            const segOpt = {
                skipUndo: true,
                skipPersist: true,
            };
            let anyPitch = false;
            for (let i = 0; i < state.segments.length; i++) {
                const raw = state.segments[i];
                if (!raw) continue;
                const saved = savedById.get(String(raw.id)) || savedSegs[i];
                if (!saved) continue;
                const gainDb = Number.isFinite(saved.gainDb) ? saved.gainDb : 0;
                const pitch = Number.isFinite(saved.pitchSemitones)
                    ? Math.round(saved.pitchSemitones)
                    : 0;
                if (pitch !== 0) anyPitch = true;
                if (typeof setSegmentGainDb === 'function') {
                    setSegmentGainDb(track, i, gainDb, segOpt);
                }
                if (typeof setSegmentPitchSemitones === 'function') {
                    setSegmentPitchSemitones(track, i, pitch, segOpt);
                }
            }
            if (typeof invalidatePitchSliceCacheForTrack === 'function') {
                invalidatePitchSliceCacheForTrack(track);
            }
            if (anyPitch && typeof schedulePitchSliceRenderForTrack === 'function') {
                schedulePitchSliceRenderForTrack(track);
            }
        }
    }
    function isHeadPadSwapHistoryUndoRestore(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.historyRestoreDirection === 'redo') return false;
        return !!(o.swapHint && o.swapHint.headPadMarkInsertedForSwap);
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
                if (!restoredTimelineSlotAudioCountMatchesSegments(entry)) {
                    tr.playbackRegions.timelineSlots = [];
                }
                bumpRegionPersistEpoch(i);
                clearTrackSegmentsMemoForSlot(i);
                if (typeof setExtraTrackTimelineStartSec === 'function') {
                    setExtraTrackTimelineStartSec(entry.slot, entry.timelineStartSec, {
                        skipPersist: true,
                    });
                }
            } else {
                tr.playbackRegions = emptyPlaybackRegionsState();
                bumpRegionPersistEpoch(i);
                clearTrackSegmentsMemoForSlot(i);
            }
        }
        if (typeof window.invalidateTrackTimelineSlotsReadCache === 'function') {
            window.invalidateTrackTimelineSlotsReadCache();
        }
        const musicalGridRestored = !!(
            normalized.musicalGrid &&
            typeof window.applyMusicalGridPersistSnapshot === 'function'
        );
        if (musicalGridRestored) {
            window.applyMusicalGridPersistSnapshot(normalized.musicalGrid);
        } else if (
            normalized.rehearsalExpandedCounts &&
            normalized.rehearsalExpandedCounts.length &&
            typeof window.applyRehearsalGroupBarCountsForRegionSwap === 'function'
        ) {
            window.applyRehearsalGroupBarCountsForRegionSwap(normalized.rehearsalExpandedCounts, {
                skipUndo: true,
                relayoutRegions: false,
            });
        } else if (
            normalized.rehearsal != null &&
            typeof restoreRehearsalUndoSnapshot === 'function'
        ) {
            restoreRehearsalUndoSnapshot(normalized.rehearsal, {
                skipTimelineSlotRebuild: true,
                skipRelayoutRegions: true,
            });
        }
        if (
            !musicalGridRestored &&
            normalized.rehearsal != null &&
            normalized.rehearsalExpandedCounts &&
            normalized.rehearsalExpandedCounts.length &&
            typeof restoreRehearsalUndoSnapshot === 'function'
        ) {
            restoreRehearsalUndoSnapshot(normalized.rehearsal, {
                skipTimelineSlotRebuild: true,
                skipRelayoutRegions: true,
            });
        }
        if (
            isHeadPadSwapHistoryUndoRestore(o) &&
            typeof window.reconcileHeadPadRehearsalMarkAfterTransportSwapUndo === 'function'
        ) {
            window.reconcileHeadPadRehearsalMarkAfterTransportSwapUndo(normalized, o.swapHint);
        }
        const masterSec =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const headPadSwapUndo = isHeadPadSwapHistoryUndoRestore(o);
        const durationScaleMismatch =
            masterSec > 0 &&
            !regionUndoSnapshotDurationScaleCompatible(normalized, masterSec);
        if (durationScaleMismatch && !headPadSwapUndo) {
            for (let i = 0; i < n; i++) {
                const tr =
                    typeof extraTrackBySlot === 'function' ? extraTrackBySlot(i) : null;
                if (tr && tr.playbackRegions) {
                    tr.playbackRegions.timelineSlots = [];
                }
            }
            if (
                !musicalGridRestored &&
                normalized.rehearsalExpandedCounts &&
                normalized.rehearsalExpandedCounts.length &&
                typeof window.applyRehearsalGroupBarCountsForRegionSwap === 'function'
            ) {
                window.applyRehearsalGroupBarCountsForRegionSwap(normalized.rehearsalExpandedCounts, {
                    skipUndo: true,
                    relayoutRegions: false,
                });
            }
            if (typeof writeDetailLog === 'function') {
                writeDetailLog('Region', 'undo snapshot relayouted to match current transport scale');
            } else if (typeof writeLog === 'function') {
                writeLog(
                    'Playback region: undo snapshot relayouted to match current transport scale',
                );
            }
        }
        let needsSlotRebuild = durationScaleMismatch && !headPadSwapUndo;
        for (let i = 0; i < n; i++) {
            const entry = normalized.tracks.find((e) => e.slot === i);
            if (trackNeedsTimelineSlotRebuildAfterRestore(entry, { type: 'extra', slot: i })) {
                needsSlotRebuild = true;
                break;
            }
        }
        if (needsSlotRebuild && typeof window.rebuildAllTrackTimelineSlots === 'function') {
            window.rebuildAllTrackTimelineSlots({
                infer: durationScaleMismatch,
                skipPresentationRefresh: true,
            });
        } else if (
            headPadSwapUndo &&
            typeof window.rebuildAllTrackTimelineSlots === 'function'
        ) {
            let headPadNeedsRebuild = false;
            for (let i = 0; i < n; i++) {
                const entry = normalized.tracks.find((e) => e.slot === i);
                if (
                    trackNeedsTimelineSlotRebuildAfterRestore(entry, {
                        type: 'extra',
                        slot: i,
                    })
                ) {
                    headPadNeedsRebuild = true;
                    break;
                }
            }
            if (headPadNeedsRebuild) {
                window.rebuildAllTrackTimelineSlots({
                    infer: false,
                    preserveStored: true,
                    skipPresentationRefresh: true,
                });
            }
        }
        if (
            headPadSwapUndo &&
            typeof window.reconcileHeadPadRehearsalMarkAfterTransportSwapUndo === 'function'
        ) {
            window.reconcileHeadPadRehearsalMarkAfterTransportSwapUndo(normalized, o.swapHint);
        }
        refreshRegionUndoTimelineSlotsAfterRestore(normalized, o);
        if (Array.isArray(normalized.markers) && typeof setMarkersFromSnapshot === 'function') {
            setMarkersFromSnapshot(normalized.markers);
        }
        applyRestoredSegmentAudioAttributesFromUndoTracks(normalized.tracks);
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
        const rehearsalCounts =
            o.rehearsalExpandedCounts && o.rehearsalExpandedCounts.length
                ? o.rehearsalExpandedCounts
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
            rehearsalCounts &&
            typeof window.setRehearsalGroupBarCountsOverride === 'function' &&
            typeof window.clearRehearsalGroupBarCountsOverride === 'function'
        ) {
            try {
                window.setRehearsalGroupBarCountsOverride(rehearsalCounts);
                if (typeof window.clearMusicalGridPositionCache === 'function') {
                    window.clearMusicalGridPositionCache();
                }
                return previewWithPlaybackRegions();
            } finally {
                window.clearRehearsalGroupBarCountsOverride();
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
    function finishDeferredRegionHistoryRestore(targetSnap, onDone, swapHint, restoreOpt) {
        regionUndoPaused = false;
        const ro = restoreOpt && typeof restoreOpt === 'object' ? restoreOpt : {};
        restoreRegionUndoSnapshot(targetSnap, Object.assign({ swapHint: swapHint }, ro));
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

    function tryAnimateRegionHistoryRestore(targetSnap, onDone, swapHint, animWaitRetries, restoreOpt) {
        const ro = restoreOpt && typeof restoreOpt === 'object' ? restoreOpt : {};
        const rehearsalFillOn =
            typeof getMusicalGridRehearsalFillVisible === 'function' &&
            getMusicalGridRehearsalFillVisible();
        if (!rehearsalFillOn) {
            finishDeferredRegionHistoryRestore(targetSnap, onDone, swapHint, ro);
            return false;
        }
        if (typeof window.playPlaybackRegionSwapAnimation !== 'function') {
            finishDeferredRegionHistoryRestore(targetSnap, onDone, swapHint, ro);
            return false;
        }
        if (
            typeof window.planRegionHistorySwapAnimation !== 'function' &&
            typeof window.planRegionHistorySwapAnimationFromHint !== 'function'
        ) {
            finishDeferredRegionHistoryRestore(targetSnap, onDone, swapHint, ro);
            return false;
        }
        if (
            typeof window.isPlaybackRegionSwapAnimActive === 'function' &&
            window.isPlaybackRegionSwapAnimActive()
        ) {
            const waits = animWaitRetries | 0;
            if (waits < 20) {
                setTimeout(() => {
                    tryAnimateRegionHistoryRestore(
                        targetSnap,
                        onDone,
                        swapHint,
                        waits + 1,
                        ro,
                    );
                }, 50);
                return false;
            }
            finishDeferredRegionHistoryRestore(targetSnap, onDone, swapHint, ro);
            return false;
        }
        const normalized = normalizeRegionUndoSnapshot(targetSnap);
        const hint = resolveHistoryRestoreSwapHint(targetSnap, swapHint);
        const slotIdx = resolveHistoryRestoreTrackSlot(normalized, hint);
        if (slotIdx < 0) {
            finishDeferredRegionHistoryRestore(targetSnap, onDone, swapHint, ro);
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
            finishDeferredRegionHistoryRestore(targetSnap, onDone, swapHint, ro);
            return false;
        }

        // musicalGrid / counts は restoreRegionUndoSnapshot が唯一の真実。
        // ここで applyRehearsalGroupBarCountsForRegionSwap すると ripple 前に mark/tempo が
        // 書き換わり、連続 Undo の終盤で復元先と不一致になる。
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
            enableMusicalTrackSwapAnim:
                typeof window.getMusicalGridVisible === 'function' &&
                window.getMusicalGridVisible(),
            applySwap: (animOpt) => {
                restoreRegionUndoSnapshot(targetSnap, {
                    deferRedraw: !!(animOpt && animOpt.deferRedraw),
                    skipPersist: !!(animOpt && animOpt.skipPersist),
                    skipSyncTransport: !!(animOpt && animOpt.skipSyncTransport),
                    swapHint: hint,
                    historyRestoreDirection: ro.historyRestoreDirection,
                });
                return true;
            },
            finalizeSwap: () => {
                refreshRegionUndoTimelineSlotsAfterRestore(normalized, { deferRedraw: false });
                if (
                    isHeadPadSwapHistoryUndoRestore(
                        Object.assign({ swapHint: hint }, ro),
                    ) &&
                    typeof window.reconcileHeadPadRehearsalMarkAfterTransportSwapUndo ===
                        'function'
                ) {
                    window.reconcileHeadPadRehearsalMarkAfterTransportSwapUndo(
                        normalized,
                        hint,
                    );
                }
                planFinalize();
                if (typeof onDone === 'function') onDone();
            },
            historyRestore: true,
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
            if (swapAnim.includeSlideMoves) {
                animSpec.includeSlideMoves = true;
            }
        }

        const animResult = window.playPlaybackRegionSwapAnimation(animSpec);
        if (animResult === 'started' || animResult === 'applied-recovered') {
            return true;
        }
        finishDeferredRegionHistoryRestore(targetSnap, onDone, swapHint, ro);
        return false;
    }

    function beginDeferredRegionHistoryRestore(targetSnap, onDone, swapHint, restoreOpt) {
        regionUndoPaused = true;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                tryAnimateRegionHistoryRestore(targetSnap, onDone, swapHint, 0, restoreOpt);
            });
        });
    }
    function captureRegionUndoSnapshotForHistory() {
        return captureRegionUndoSnapshot({ includeRehearsal: true });
    }
    function undoPlaybackRegion() {
        if (!regionUndoStack.length) return false;
        const current = captureRegionUndoSnapshotForHistory();
        const prev = regionUndoStack.pop();
        const undoActionLabel = prev && prev.actionLabel ? String(prev.actionLabel) : '';
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
        if (undoActionLabel) current.actionLabel = undoActionLabel;
        regionRedoStack.push(current);
        beginDeferredRegionHistoryRestore(
            prev,
            () => {
            const undoMsg =
                typeof formatRegionHistoryActionMessage === 'function'
                    ? formatRegionHistoryActionMessage('undo', undoActionLabel)
                    : undoActionLabel
                      ? 'undo — ' + undoActionLabel
                      : 'undo';
            if (typeof actionLog === 'function') {
                actionLog('Region', undoMsg);
            } else if (typeof writeActionLog === 'function') {
                writeActionLog('Region', undoMsg);
            } else {
                writeLog('Playback region: ' + undoMsg);
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'Undo', 'notice');
            }
        },
            swapHintForRestore,
            { historyRestoreDirection: 'undo' },
        );
        return true;
    }
    function redoPlaybackRegion() {
        if (!regionRedoStack.length) return false;
        const current = captureRegionUndoSnapshotForHistory();
        const next = regionRedoStack.pop();
        const redoActionLabel = next && next.actionLabel ? String(next.actionLabel) : '';
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
        if (redoActionLabel) current.actionLabel = redoActionLabel;
        regionUndoStack.push(current);
        beginDeferredRegionHistoryRestore(
            next,
            () => {
            const redoMsg =
                typeof formatRegionHistoryActionMessage === 'function'
                    ? formatRegionHistoryActionMessage('redo', redoActionLabel)
                    : redoActionLabel
                      ? 'redo — ' + redoActionLabel
                      : 'redo';
            if (typeof actionLog === 'function') {
                actionLog('Region', redoMsg);
            } else if (typeof writeActionLog === 'function') {
                writeActionLog('Region', redoMsg);
            } else {
                writeLog('Playback region: ' + redoMsg);
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'Redo', 'notice');
            }
        },
            swapHintForRestore,
            { historyRestoreDirection: 'redo' },
        );
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
        return regionUndoSnapshotIncludeRehearsal({ includeRehearsal: true }) ? { includeRehearsal: true } : undefined;
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
        if (track && track.type === 'extra') return 'extra:' + track.slot;
        if (track && track.type === 'video') return 'video';
        return '';
    }
    function parseTrackKey(key) {
        if (key === 'video') return { type: 'video' };
        const m = /^extra:(\d+)$/.exec(key);
        if (m) return { type: 'extra', slot: parseInt(m[1], 10) };
        return null;
    }
    function isExtraTrackRef(track) {
        return !!(track && track.type === 'extra' && Number.isFinite(track.slot));
    }
    function isVideoTrackRef(track) {
        return !!(track && track.type === 'video');
    }
    function isPlaybackRegionTrackRef(track) {
        return isExtraTrackRef(track) || isVideoTrackRef(track);
    }
    window.isVideoTrackRef = isVideoTrackRef;
    window.isPlaybackRegionTrackRef = isPlaybackRegionTrackRef;
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
        outS = Math.max(0, Math.min(outS, fullDur));
        // GAC PreRoll 等 — ファイルを消費しない無音リージョン（0..0）を MIN 幅へ伸ばさない
        if (inS <= 0.00001 && outS <= 0.00001) {
            return { sourceInSec: 0, sourceOutSec: 0 };
        }
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
        const memberSlot = isVideoTrackRef(track)
            ? typeof getTrackOffsetDragSlot === 'function'
                ? getTrackOffsetDragSlot(track)
                : typeof VIDEO_WAVEFORM_OFFSET_DRAG_SLOT !== 'undefined'
                  ? VIDEO_WAVEFORM_OFFSET_DRAG_SLOT
                  : -2
            : isExtraTrackRef(track)
              ? track.slot
              : -1;
        const gid = getSegmentRegionGroupId(track, segmentIndex);
        if (!gid) {
            return [{ slot: memberSlot, segmentIndex }];
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
        if (typeof getVideoTrackRef === 'function') {
            const videoTrack = getVideoTrackRef();
            const videoCount = getSegmentCount(videoTrack);
            const videoSlot =
                typeof getTrackOffsetDragSlot === 'function'
                    ? getTrackOffsetDragSlot(videoTrack)
                    : typeof VIDEO_WAVEFORM_OFFSET_DRAG_SLOT !== 'undefined'
                      ? VIDEO_WAVEFORM_OFFSET_DRAG_SLOT
                      : -2;
            for (let vi = 0; vi < videoCount; vi++) {
                if (getSegmentRegionGroupId(videoTrack, vi) === gid) {
                    members.push({ slot: videoSlot, segmentIndex: vi });
                }
            }
        }
        return members.length
            ? members
            : [{ slot: memberSlot, segmentIndex }];
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
    function regionSwapDiagRehearsalText() {
        if (typeof getMusicalGridPersistSnapshot === 'function') {
            const snap = getMusicalGridPersistSnapshot();
            if (snap && snap.rehearsal) return snap.rehearsal;
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
        if (typeof writeDiagLog === 'function') {
            writeDiagLog('SILENT_GAP_DELETE', stage, payload);
        } else if (typeof writeLog === 'function') {
            const tail = silentGapDeleteDiagFmtPayload(payload);
            writeLog('[SilentGapDel] ' + stage + (tail ? ' | ' + tail : ''));
        }
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
            rehearsal: regionSwapDiagRehearsalText(),
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
                rehearsalSlot: Number.isFinite(g.rehearsalIndex) ? (g.rehearsalIndex | 0) + 1 : null,
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
                    rehearsalSlot:
                        s.musical && Number.isFinite(s.musical.rehearsalSlotIndex)
                            ? (s.musical.rehearsalSlotIndex | 0) + 1
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
