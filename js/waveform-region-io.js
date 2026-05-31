/**
 * waveform-region-io.js — キーボード・永続化・公開 API
 */
    function handlePlaybackRegionSplitKeydown(e) {
        if (!isPlaybackRegionSplitKeyEvent(e)) return false;
        if (e.repeat) return false;
        if (suppressInvalidRegionOpNoticeForVideoAudio()) return false;
        const nowMs =
            Number.isFinite(e && e.timeStamp) && e.timeStamp >= 0
                ? e.timeStamp
                : performance.now();
        if (nowMs - lastRegionSplitShortcutAtMs < REGION_SPLIT_SHORTCUT_DEDUP_MS) {
            e.preventDefault();
            return true;
        }
        lastRegionSplitShortcutAtMs = nowMs;
        e.preventDefault();
        splitPlaybackRegionAtTargetSec();
        return true;
    }

    function isPlaybackRegionSplitKeyEvent(e) {
        return matchUserShortcut(e, 'regionSplit');
    }

    function handlePlaybackRegionSlashKeydown(e) {
        return handlePlaybackRegionSplitKeydown(e);
    }

    function handlePlaybackRegionUndoKeydown(e) {
        if (!matchUserShortcut(e, 'regionUndo')) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        if (regionHandleDragActive || regionUndoDragSnap) return false;
        if (!undoPlaybackRegion()) return false;
        e.preventDefault();
        return true;
    }

    function handlePlaybackRegionRedoKeydown(e) {
        if (!matchUserShortcut(e, 'regionRedo')) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        if (regionHandleDragActive || regionUndoDragSnap) return false;
        if (!redoPlaybackRegion()) return false;
        e.preventDefault();
        return true;
    }

    function handlePlaybackRegionDeleteKeydown(e) {
        if (!matchUserShortcut(e, 'regionDelete')) return false;
        if (e.shiftKey) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        if (regionHandleDragActive) return false;
        if (!deleteRegionSegmentUnderCursor()) return false;
        e.preventDefault();
        return true;
    }

    function handlePlaybackRegionCopyKeydown(e) {
        if (!e.ctrlKey && !e.metaKey) return false;
        if (!matchUserShortcut(e, 'regionCopy')) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        if (regionHandleDragActive) return false;
        e.preventDefault();
        e.stopPropagation();
        copyRegionSegmentUnderCursor();
        return true;
    }

    function handlePlaybackRegionPasteKeydown(e) {
        if (!e.ctrlKey && !e.metaKey) return false;
        if (!matchUserShortcut(e, 'regionPaste')) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        if (regionHandleDragActive) return false;
        e.preventDefault();
        e.stopPropagation();
        pasteRegionSegmentToTrackEnd();
        return true;
    }

    function handlePlaybackRegionEscapeKeydown(e) {
        if (!matchUserShortcut(e, 'regionEscape')) return false;
        if (regionHandleDragActive) {
            endRegionHandleDrag({ cancelled: true });
            return true;
        }
        if (getRegionSelectionCount() > 0) {
            clearRegionSelection();
            e.preventDefault();
            return true;
        }
        return false;
    }

    function handlePlaybackRegionGroupKeydown(e) {
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        if (regionHandleDragActive) return false;
        if (!matchUserShortcut(e, 'regionGroup')) return false;
        if (!toggleRegionGroupFromSelection()) return false;
        e.preventDefault();
        return true;
    }

    function handleRegionSelectionPointerDown(ev, regionHit) {
        if (!ev || !regionHit || !(regionHit.slot >= 0) || !(regionHit.segmentIndex >= 0)) {
            return false;
        }
        if (!(ev.ctrlKey || ev.metaKey)) return false;
        ev.preventDefault();
        ev.stopPropagation();
        toggleRegionSelection(regionHit.slot, regionHit.segmentIndex);
        return true;
    }

    /** 復元デコード直後: クリップ未揃いでも永続化セグメントを state に載せる（正規化は後） */
    function applyPlaybackRegionSegmentsRaw(track, segments, opt) {
        if (!isExtraTrackRef(track) || !Array.isArray(segments) || !segments.length) {
            return false;
        }
        const state = getPlaybackRegionsState(track);
        if (!state) return false;
        state.segments = segments.map((seg) => {
            const copy =
                seg && typeof seg === 'object' ? Object.assign({}, seg) : { sourceInSec: 0 };
            if (!copy.id) copy.id = newRegionId();
            return copy;
        });
        state.active = true;
        if (Number.isFinite(opt && opt.regionHeadPadSec)) {
            state.headPadSec = Math.max(0, opt.regionHeadPadSec);
        }
        if (Number.isFinite(opt && opt.regionTimelineInSec)) {
            state.regionTimelineInSec = Math.max(0, opt.regionTimelineInSec);
        } else {
            delete state.regionTimelineInSec;
        }
        if (Number.isFinite(opt && opt.regionLeadPadSec) && opt.regionLeadPadSec > 0) {
            state.regionLeadPadSec = Math.max(0, opt.regionLeadPadSec);
        } else {
            delete state.regionLeadPadSec;
        }
        if (!(opt && opt.skipOverlay) && typeof updateTrackRegionOverlays === 'function') {
            updateTrackRegionOverlays(track);
        }
        return true;
    }

    /** Ex 1 本のデコード完了後: 生セグメントを正規化して波形へ反映 */
    function finalizePlaybackRegionsForExtraSlot(slot) {
        if (!(slot >= 0) || !isExtraTrackRef({ type: 'extra', slot })) return false;
        const track = { type: 'extra', slot };
        const state = getPlaybackRegionsState(track);
        if (!state || !state.active || !state.segments || !state.segments.length) {
            return false;
        }
        const raw = state.segments.map((s) => Object.assign({}, s));
        const ok = setTrackSegments(track, raw, {
            silent: true,
            skipUndo: true,
            keepPendingRestore: true,
        });
        if (!ok && raw.length) {
            state.segments = raw;
            state.active = true;
        }
        updateTrackRegionOverlays(track);
        redrawAfterRegionChange(slot, { invalidatePeakCache: true });
        return !!(getTrackSegments(track).length || raw.length);
    }

    function finalizeAllPlaybackRegionsAfterSessionRestore() {
        const n = getExtraTrackCount();
        let any = false;
        for (let i = 0; i < n; i++) {
            if (typeof isExtraTrackLoaded === 'function' && !isExtraTrackLoaded(i)) {
                continue;
            }
            if (finalizePlaybackRegionsForExtraSlot(i)) any = true;
        }
        if (typeof applyPendingPlaybackRegionRestore === 'function') {
            applyPendingPlaybackRegionRestore();
        }
        return any;
    }

    function getPlaybackRegionPersistSnapshot() {
        const extras = [];
        const n =
            getExtraTrackCount();
        for (let i = 0; i < n; i++) {
            const track = { type: 'extra', slot: i };
            const segments = getTrackSegments(track);
            if (!segments.length) continue;
            const headPad = getHeadPadSec(track);
            const state = getPlaybackRegionsState(track);
            const regionIn =
                state && Number.isFinite(state.regionTimelineInSec)
                    ? state.regionTimelineInSec
                    : undefined;
            const regionLead =
                state && Number.isFinite(state.regionLeadPadSec) && state.regionLeadPadSec > 0
                    ? state.regionLeadPadSec
                    : undefined;
            extras.push({
                slot: i,
                headPadSec: headPad > 0 ? headPad : undefined,
                regionTimelineInSec: regionIn,
                regionLeadPadSec: regionLead,
                segments: segments.map((seg, i) => {
                    const raw = getRawSegmentEntry(track, i);
                    const entry = {
                        id: seg.id,
                        clipId: seg.clipId,
                        sourceInSec: seg.sourceInSec,
                        sourceOutSec: seg.sourceOutSec,
                    };
                    if (raw && Number.isFinite(raw.timelineStartSec)) {
                        entry.timelineStartSec = raw.timelineStartSec;
                    }
                    if (raw && Number.isFinite(raw.regionTimelineInSec)) {
                        entry.regionTimelineInSec = raw.regionTimelineInSec;
                    }
                    if (raw && Number.isFinite(raw.regionLeadPadSec)) {
                        entry.regionLeadPadSec = raw.regionLeadPadSec;
                    }
                    if (raw && Number.isFinite(raw.gainDb) && Math.abs(raw.gainDb) > 0.0005) {
                        entry.gainDb = raw.gainDb;
                    }
                    if (raw && Number.isFinite(raw.fadeInSec) && raw.fadeInSec > 0.0005) {
                        entry.fadeInSec = raw.fadeInSec;
                    }
                    if (raw && Number.isFinite(raw.fadeOutSec) && raw.fadeOutSec > 0.0005) {
                        entry.fadeOutSec = raw.fadeOutSec;
                    }
                    if (raw && raw.regionGroupId) {
                        entry.regionGroupId = raw.regionGroupId;
                    }
                    return entry;
                }),
            });
        }
        return extras.length ? { extra: extras } : null;
    }

    function restorePlaybackRegionFromPersist(data, opt) {
        if (!data || typeof data !== 'object') return false;
        let restoreFailed = false;
        let restoreDeferred = false;
        regionUndoPaused = true;
        try {
        if (Array.isArray(data.extra)) {
            for (const entry of data.extra) {
                if (!entry || typeof entry.slot !== 'number') continue;
                const track = { type: 'extra', slot: entry.slot };
                if (Array.isArray(entry.segments) && entry.segments.length) {
                    const loaded =
                        typeof isExtraTrackLoaded === 'function' &&
                        isExtraTrackLoaded(entry.slot);
                    if (!loaded) {
                        restoreDeferred = true;
                        continue;
                    }
                    const ok = setTrackSegments(
                        track,
                        entry.segments,
                        Object.assign({ silent: true, skipUndo: true }, opt || {}),
                    );
                    if (!ok) {
                        restoreFailed = true;
                        continue;
                    }
                    const state = getPlaybackRegionsState(track);
                    if (state) {
                        if (Number.isFinite(entry.headPadSec)) {
                            state.headPadSec = Math.max(0, entry.headPadSec);
                        }
                        if (Number.isFinite(entry.regionTimelineInSec)) {
                            state.regionTimelineInSec = Math.max(
                                0,
                                entry.regionTimelineInSec,
                            );
                        } else {
                            delete state.regionTimelineInSec;
                        }
                        if (Number.isFinite(entry.regionLeadPadSec)) {
                            state.regionLeadPadSec = Math.max(0, entry.regionLeadPadSec);
                        } else {
                            delete state.regionLeadPadSec;
                        }
                        updateTrackRegionOverlays(track);
                        redrawAfterRegionChange(entry.slot);
                    }
                } else if (
                    Number.isFinite(entry.sourceInSec) &&
                    Number.isFinite(entry.sourceOutSec)
                ) {
                    const loaded =
                        typeof isExtraTrackLoaded === 'function' &&
                        isExtraTrackLoaded(entry.slot);
                    if (!loaded) continue;
                    const ok = setTrackSegments(
                        track,
                        [{ sourceInSec: entry.sourceInSec, sourceOutSec: entry.sourceOutSec }],
                        Object.assign({ silent: true, skipUndo: true }, opt || {}),
                    );
                    if (!ok) restoreFailed = true;
                }
            }
        }
        if (
            Number.isFinite(data.inSec) &&
            Number.isFinite(data.outSec) &&
            !data.extra &&
            typeof isExtraTrackLoaded === 'function' &&
            isExtraTrackLoaded(0)
        ) {
            const ok = setTrackSegments(
                { type: 'extra', slot: 0 },
                [{ sourceInSec: data.inSec, sourceOutSec: data.outSec }],
                Object.assign({ silent: true, skipUndo: true }, opt || {}),
            );
            if (!ok) restoreFailed = true;
        }
        updateAllPlaybackRegionOverlays();
        if (!(opt && opt.keepUndoHistory)) {
            clearRegionUndoStack();
        }
        return !restoreFailed && !restoreDeferred;
        } finally {
            regionUndoPaused = false;
        }
    }

    function setPendingPlaybackRegionRestore(data) {
        pendingPlaybackRegionRestore =
            data && typeof data === 'object' ? data : null;
    }

    function applyPendingPlaybackRegionRestore() {
        if (!pendingPlaybackRegionRestore) return false;
        const data = pendingPlaybackRegionRestore;
        const ok = restorePlaybackRegionFromPersist(data, { silent: true });
        if (ok) pendingPlaybackRegionRestore = null;
        return ok;
    }

    function initPlaybackRegionHoverUi() {
        let hoverRaf = 0;
        const onPointerMove = (ev) => {
            if (hoverRaf) return;
            hoverRaf = requestAnimationFrame(() => {
                hoverRaf = 0;
                const lanes = getWaveformLanesEl();
                if (!lanes) {
                    updatePlaybackRegionHoverFromPointer(null, null);
                    return;
                }
                const rect = lanes.getBoundingClientRect();
                const x = ev.clientX;
                const y = ev.clientY;
                if (
                    x < rect.left ||
                    x > rect.right ||
                    y < rect.top ||
                    y > rect.bottom
                ) {
                    updatePlaybackRegionHoverFromPointer(null, null);
                    return;
                }
                updatePlaybackRegionHoverFromPointer(x, y, ev.altKey);
            });
        };
        document.addEventListener('pointermove', onPointerMove, { passive: true });
        const lanes = getWaveformLanesEl();
        if (lanes) {
            lanes.addEventListener('pointerleave', () => {
                updatePlaybackRegionHoverFromPointer(null, null);
            });
        }
    }

    function initPlaybackRegionUi() {
        initPlaybackRegionHoverUi();
        document.querySelectorAll('.audio-waveform-lane__playback-regions').forEach((container) => {
            const key = container.getAttribute('data-track');
            const track = parseTrackKey(key);
            if (!track) return;
            container.addEventListener('pointerdown', (ev) => {
                if (ev.button !== 0) return;
                if (ev.ctrlKey || ev.metaKey) {
                    const regionEl = ev.target.closest('.audio-waveform-lane__playback-region');
                    if (regionEl) {
                        const segmentIndex = Number(regionEl.dataset.segmentIndex);
                        if (Number.isFinite(segmentIndex) && segmentIndex >= 0) {
                            ev.preventDefault();
                            ev.stopPropagation();
                            toggleRegionSelection(track.slot, segmentIndex);
                            return;
                        }
                    }
                }
                const splitHandle = ev.target.closest(
                    '.audio-waveform-lane__playback-region__handle--split',
                );
                if (splitHandle) {
                    const boundaryIndex = Number(splitHandle.dataset.boundaryIndex);
                    if (Number.isFinite(boundaryIndex)) {
                        onSplitHandlePointerDown(ev, track, boundaryIndex);
                    }
                    return;
                }
                const resizeHit = resolveRegionResizeHandleAtPointer(
                    track,
                    ev.clientX,
                    ev.clientY,
                );
                if (resizeHit) {
                    onRegionHandlePointerDown(
                        ev,
                        track,
                        resizeHit.segmentIndex,
                        resizeHit.kind,
                    );
                }
            });
        });
    }

    initPlaybackRegionUi();

    window.isPlaybackRegionActive = isPlaybackRegionActive;
    window.isTrackRegionActive = isTrackRegionActive;
    window.isTrackTransportAudible = isTrackTransportAudible;
    window.getTrackRegionBounds = getTrackRegionBounds;
    window.getExtraTrackPlaybackAtTransport = mapTransportToSegmentForPlayback;
    window.drawExtraTrackWaveformRegions = drawExtraTrackWaveformRegions;
    window.rebuildExtraTrackRegionViewportPeaks = rebuildExtraTrackRegionViewportPeaks;
    window.getTrackTimelineEndSec = getTrackTimelineEndSec;
    window.getTrackTimelineStartSec = getTrackTimelineStartSec;
    window.getExtraTrackMaxTimelineEndSec = (function () {
        const impl = getExtraTrackMaxTimelineEndSec;
        return function (slot) {
            return impl({ type: 'extra', slot });
        };
    })();
    window.getRegionOutDragExtendSlot = function () {
        return regionOutDragExtendSlot;
    };
    window.getRegionOutDragTimelineExtentSec = function (slot) {
        if (regionOutDragExtendSlot !== slot) return 0;
        return Number.isFinite(regionOutDragExtentSec) && regionOutDragExtentSec > 0
            ? regionOutDragExtentSec
            : 0;
    };
    window.clearPlaybackRegion = clearPlaybackRegion;
    window.clearTrackRegion = clearTrackRegion;
    window.setTrackSegments = setTrackSegments;
    window.applyTrackRegionBounds = function (track, inS, outS, opt) {
        return setTrackSegments(track, [{ sourceInSec: inS, sourceOutSec: outS }], opt);
    };
    window.splitPlaybackRegionAtTargetSec = splitPlaybackRegionAtTargetSec;
    window.joinPlaybackRegionAtPointer = joinPlaybackRegionAtPointer;
    window.tryRejoinVolumeSplitBoundariesAtSegment =
        tryRejoinVolumeSplitBoundariesAtSegment;
    window.getPlaybackRegionPersistSnapshot = getPlaybackRegionPersistSnapshot;
    window.restorePlaybackRegionFromPersist = restorePlaybackRegionFromPersist;
    window.handlePlaybackRegionSplitKeydown = handlePlaybackRegionSplitKeydown;
    window.handlePlaybackRegionJoinKeydown = handlePlaybackRegionJoinKeydown;
    window.handlePlaybackRegionSlashKeydown = handlePlaybackRegionSlashKeydown;
    window.handlePlaybackRegionUndoKeydown = handlePlaybackRegionUndoKeydown;
    window.handlePlaybackRegionRedoKeydown = handlePlaybackRegionRedoKeydown;
    window.handlePlaybackRegionDeleteKeydown = handlePlaybackRegionDeleteKeydown;
    window.handlePlaybackRegionCopyKeydown = handlePlaybackRegionCopyKeydown;
    window.handlePlaybackRegionPasteKeydown = handlePlaybackRegionPasteKeydown;
    window.beginRegionUndoGesture = beginRegionUndoGesture;
    window.commitRegionUndoGesture = commitRegionUndoGesture;
    window.clearRegionUndoStack = clearRegionUndoStack;
    window.handlePlaybackRegionEscapeKeydown = handlePlaybackRegionEscapeKeydown;
    window.handlePlaybackRegionGroupKeydown = handlePlaybackRegionGroupKeydown;
    window.handleRegionSelectionPointerDown = handleRegionSelectionPointerDown;
    window.toggleRegionSelection = toggleRegionSelection;
    window.clearRegionSelection = clearRegionSelection;
    window.collectRegionGroupMembers = collectRegionGroupMembers;
    window.flashRegionGroupMembers = flashRegionGroupMembers;
    window.collectRegionGroupMemberIndices = collectRegionGroupMemberIndices;
    window.handlePlaybackRegionMixKeydown = handlePlaybackRegionMixKeydown;
    window.resolveMixTargetFromActiveRegion = resolveMixTargetFromActiveRegion;
    window.updateAllPlaybackRegionOverlays = updateAllPlaybackRegionOverlays;
    window.updateTrackRegionOverlay = updateTrackRegionOverlays;
    window.setPendingPlaybackRegionRestore = setPendingPlaybackRegionRestore;
    window.applyPendingPlaybackRegionRestore = applyPendingPlaybackRegionRestore;
    window.applyPlaybackRegionSegmentsRaw = applyPlaybackRegionSegmentsRaw;
    window.finalizePlaybackRegionsForExtraSlot = finalizePlaybackRegionsForExtraSlot;
    window.finalizeAllPlaybackRegionsAfterSessionRestore =
        finalizeAllPlaybackRegionsAfterSessionRestore;
    window.resolveTargetExtraSlot = resolveTargetExtraSlot;
    window.resolveRegionSegmentFromPointer = resolveRegionSegmentFromPointer;
    window.getSegmentTimelineStartForAltDrag = function (slot, segmentIndex) {
        const track = { type: 'extra', slot };
        return getSegmentRegionTimelineIn(track, segmentIndex);
    };
    window.getSegmentAnchorForAltDrag = function (slot, segmentIndex) {
        const track = { type: 'extra', slot };
        return getSegmentTimelineStart(track, segmentIndex);
    };
    window.getSegmentRegionInPadForAltDrag = function (slot, segmentIndex) {
        const track = { type: 'extra', slot };
        return getSegmentRegionInPadSec(track, segmentIndex);
    };
    window.setSegmentTimelineStartSec = setSegmentTimelineStartSec;
    window.clampRegionGroupMoveDelta = clampRegionGroupMoveDelta;
    window.applyRegionGroupMoveDelta = applyRegionGroupMoveDelta;
    window.applyRegionTrackTimelineStart = function (slot, sec, opt) {
        const track = { type: 'extra', slot };
        if (!isTrackRegionActive(track) || getSegmentCount(track) < 1) {
            if (typeof setExtraTrackTimelineStartSec === 'function') {
                setExtraTrackTimelineStartSec(slot, sec, opt);
            }
            return;
        }
        const oldT0 = getTrackTimelineStartSec(track);
        const headPad = getHeadPadSec(track);
        const desiredSegStart = snapRegionTransportSec(sec + headPad, {
            exclude: { slot, segmentIndex: 0 },
        });
        const clamped = clampSegmentTimelineStart(track, 0, desiredSegStart);
        const newT0 = Math.max(0, clamped - headPad);
        if (typeof setExtraTrackTimelineStartSec === 'function') {
            setExtraTrackTimelineStartSec(slot, newT0, opt);
        }
        shiftTrackAbsoluteRegionInsByDelta(track, newT0 - oldT0);
    };
    window.isPointerOnRegionResizeHandle = isPointerOnRegionResizeHandle;
    window.isPointerOnAnyRegionResizeHandle = isPointerOnAnyRegionResizeHandle;
    window.snapRegionTransportSec = snapRegionTransportSec;
    window.snapSecToPlaybackRegionInOut = snapSecToPlaybackRegionInOut;
    window.snapTransportSecForWaveformSeek = snapTransportSecForWaveformSeek;
    window.snapToNearestStop = snapToNearestStop;
    window.collectRegionSnapStops = collectRegionSnapStops;
    window.regionSnapThresholdSec = regionSnapThresholdSec;

    function sortRegionNavStops(stops) {
        stops.sort((a, b) => {
            if (a.sec !== b.sec) return a.sec - b.sec;
            const edgeRank = { in: 0, out: 1 };
            if (a.slot !== b.slot) return a.slot - b.slot;
            if (a.segmentIndex !== b.segmentIndex) return a.segmentIndex - b.segmentIndex;
            return (edgeRank[a.edge] || 0) - (edgeRank[b.edge] || 0);
        });
    }

    function appendRangeLoopNavStops(stops) {
        if (
            typeof isRangeLoopPlaybackActive !== 'function' ||
            !isRangeLoopPlaybackActive()
        ) {
            return;
        }
        const inSec =
            typeof getRangeLoopInSec === 'function' ? getRangeLoopInSec() : NaN;
        const outSec =
            typeof getRangeLoopOutSec === 'function' ? getRangeLoopOutSec() : NaN;
        if (Number.isFinite(inSec)) {
            stops.push({ sec: inSec, edge: 'in', slot: -1, segmentIndex: -1 });
        }
        if (Number.isFinite(outSec)) {
            stops.push({ sec: outSec, edge: 'out', slot: -1, segmentIndex: -1 });
        }
    }

    /** Ex リージョン In/Out（マーカー非表示時の ↑↓ ナビ用） */
    function buildRegionNavStops() {
        const stops = [];
        const trackCount =
            getExtraTrackCount();
        for (let slot = 0; slot < trackCount; slot++) {
            const track = { type: 'extra', slot };
            const segments = getTrackSegments(track);
            for (let i = 0; i < segments.length; i++) {
                const inSec = getSegmentRegionTimelineIn(track, i);
                const outSec = getSegmentTimelineEnd(track, i);
                if (Number.isFinite(inSec)) {
                    stops.push({ sec: inSec, edge: 'in', slot, segmentIndex: i });
                }
                if (Number.isFinite(outSec)) {
                    stops.push({ sec: outSec, edge: 'out', slot, segmentIndex: i });
                }
            }
        }
        if (!stops.length) {
            appendRangeLoopNavStops(stops);
        }
        sortRegionNavStops(stops);
        return stops;
    }

    function regionNavStopEpsilonSec() {
        if (typeof markerNavStopEpsilonSec === 'function') {
            return markerNavStopEpsilonSec();
        }
        return regionSnapThresholdSec();
    }

    function regionNavStopIndexForCurrent(stops, dir) {
        if (!stops || stops.length === 0) return -1;
        const t =
            typeof getTransportSec === 'function'
                ? getTransportSec()
                : typeof videoMain !== 'undefined' && videoMain
                  ? videoMain.currentTime || 0
                  : 0;
        const eps = regionNavStopEpsilonSec();
        if (dir < 0) {
            for (let i = 0; i < stops.length; i++) {
                if (stops[i].sec > t - eps) return i;
            }
            let best = -1;
            for (let i = 0; i < stops.length; i++) {
                if (stops[i].sec <= t + eps) best = i;
                else break;
            }
            return best;
        }
        let best = -1;
        for (let i = 0; i < stops.length; i++) {
            if (stops[i].sec <= t + eps) best = i;
            else break;
        }
        return best;
    }

    function syncRegionNavSeekTransportUi(t) {
        if (typeof syncTransportSeekUi === 'function') {
            syncTransportSeekUi(t);
        }
    }

    function seekToRegionNavStop(stop, opt) {
        if (!stop || !Number.isFinite(stop.sec)) return false;
        const resumeAfter = !!(opt && opt.resumeAfterSeek);
        let target = stop.sec;
        if (typeof clampTransportSec === 'function') {
            target = clampTransportSec(target);
        }
        if (typeof suppressRangeLoopSnapForExplicitSeek === 'function') {
            suppressRangeLoopSnapForExplicitSeek();
        }
        if (typeof applyTransportAtSec === 'function') {
            applyTransportAtSec(target, { resumeAfter: resumeAfter });
        }
        syncRegionNavSeekTransportUi(target);
        const edgeLabel = stop.edge === 'out' ? ' Out' : ' In';
        const hintTc =
            typeof formatTimecodeForTransport === 'function'
                ? formatTimecodeForTransport(target)
                : String(target);
        const hintTitle =
            stop.slot >= 0 ? 'Ex ' + (stop.slot + 1) : 'Range loop';
        writeLog('Region: seek to ' + hintTitle + ' ' + hintTc + edgeLabel);
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(hintTitle, hintTc + edgeLabel);
        }
        return true;
    }

    function jumpToAdjacentRegionStop(dir, opt) {
        const stops = buildRegionNavStops();
        const n = stops.length;
        if (n === 0) return false;
        const idx = regionNavStopIndexForCurrent(stops, dir);
        const t =
            typeof getTransportSec === 'function'
                ? getTransportSec()
                : typeof videoMain !== 'undefined' && videoMain
                  ? videoMain.currentTime || 0
                  : 0;
        const eps = regionNavStopEpsilonSec();
        let next;
        if (idx < 0) {
            if (dir <= 0) return false;
            next = 0;
        } else if (dir < 0 && t > stops[idx].sec + eps) {
            next = idx;
        } else if (dir > 0 && t < stops[idx].sec - eps) {
            next = idx;
        } else {
            next = idx + dir;
            if (next < 0 || next >= n) return false;
        }
        return seekToRegionNavStop(stops[next], opt);
    }

    window.buildRegionNavStops = buildRegionNavStops;
    window.jumpToAdjacentRegionStop = jumpToAdjacentRegionStop;
    window.getTrackSegmentCount = function (slot) {
        return getSegmentCount({ type: 'extra', slot });
    };
    window.syncExtraLaneRegionsForSlot = function (slot) {
        syncExtraLaneRegionsClassForTrack({ type: 'extra', slot });
    };
    window.getActiveExtraSegmentsAtTransport = getActiveExtraSegmentsAtTransport;
    window.refreshSegmentHitAtTransport = refreshSegmentHitAtTransport;
    window.isSegmentBoundaryJoined = isSegmentBoundaryJoined;
    window.isAutoJoinedBoundaryCrossfadeEligible = isAutoJoinedBoundaryCrossfadeEligible;
    window.hasExtendedCrossfadeOverlapAtBoundary = hasExtendedCrossfadeOverlapAtBoundary;
    window.hasManualSegmentFadeAtJoinedBoundary = hasManualSegmentFadeAtJoinedBoundary;
    window.getManualJoinedBoundaryFadeZone = getManualJoinedBoundaryFadeZone;
    window.isTransportInManualJoinedBoundaryFadeZone =
        isTransportInManualJoinedBoundaryFadeZone;
    window.isSegmentSourceContinuousAtBoundary = isSegmentSourceContinuousAtBoundary;
    window.planIncomingSegmentStartAtJoinedBoundary =
        planIncomingSegmentStartAtJoinedBoundary;
    window.JOINED_BOUNDARY_CROSSFADE_SEC = JOINED_BOUNDARY_CROSSFADE_SEC;
    window.getSegmentGainDb = getSegmentGainDb;
    window.getSegmentGainLinear = getSegmentGainLinear;
    window.getSegmentPlaybackGainLinear = getSegmentPlaybackGainLinear;
    window.setSegmentGainDb = setSegmentGainDb;
    window.getSegmentRegionTimelineBounds = function (slot, segmentIndex) {
        const track = { type: 'extra', slot };
        if (!isTrackRegionActive(track)) return null;
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return null;
        return {
            startSec: getSegmentRegionTimelineIn(track, segmentIndex),
            endSec: getSegmentTimelineEnd(track, segmentIndex),
        };
    };
    window.handlePlaybackRegionGainWheel = handlePlaybackRegionGainWheel;
    window.ensureDefaultTrackRegion = ensureDefaultTrackRegion;
    window.updatePlaybackRegionHoverFromPointer = updatePlaybackRegionHoverFromPointer;
    window.addExtraTrackRegionForClip = function (slot, clipId, durationSec, timelineStartSec) {
        const track = { type: 'extra', slot };
        if (!regionUndoPaused) requestRegionUndoCapture();
        const state = getPlaybackRegionsState(track);
        const start = snapRegionTransportSec(timelineStartSec);
        const seg = {
            id: newRegionId(),
            clipId: clipId || 'main',
            sourceInSec: 0,
            sourceOutSec: durationSec,
            timelineStartSec: start,
        };
        const normalized = getTrackSegments(track).map((s) =>
            normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
        );
        normalized.push(normalizeSegmentEntry(seg, track, durationSec));
        state.active = true;
        applySegmentsToState(track, normalized, { silent: true, skipUndo: true });
    };
