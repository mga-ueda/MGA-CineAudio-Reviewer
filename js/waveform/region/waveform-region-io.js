/**
 * waveform-region-io.js — キーボード・永続化・公開 API
 */
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
                if (regionHandleDragActive) return;
                if (ev.ctrlKey || ev.metaKey) {
                    if (typeof resolveSilentGapSelectionAtPointer === 'function') {
                        const hit = resolveSilentGapSelectionAtPointer(
                            ev.clientX,
                            ev.clientY,
                        );
                        if (hit && hit.slot === track.slot) {
                            ev.preventDefault();
                            ev.stopPropagation();
                            toggleSilentGapSelection(hit.slot, hit.gapIndex);
                            return;
                        }
                    }
                    if (typeof findSilentGapElAtPointer === 'function') {
                        const gapEl = findSilentGapElAtPointer(ev.clientX, ev.clientY);
                        if (gapEl) {
                            const gapIndex = Number(gapEl.dataset.silentGapIndex);
                            if (Number.isFinite(gapIndex) && gapIndex >= 0) {
                                ev.preventDefault();
                                ev.stopPropagation();
                                toggleSilentGapSelection(track.slot, gapIndex);
                                return;
                            }
                        }
                    }
                    const regionEl = ev.target.closest(
                        '.audio-waveform-lane__playback-region',
                    );
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
                    if (
                        (resizeHit.kind === 'in' || resizeHit.kind === 'out') &&
                        typeof isPointerInRegionParallelMoveBodyZone === 'function' &&
                        isPointerInRegionParallelMoveBodyZone(
                            track,
                            resizeHit.segmentIndex,
                            ev.clientX,
                            ev.clientY,
                        )
                    ) {
                        return;
                    }
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
    window.initExtraTrackViewportTiles = initExtraTrackViewportTiles;
    window.applyExtraTrackViewportTile = applyExtraTrackViewportTile;
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
    function beginRegionOffsetDragMasterFreeze() {
        regionOffsetDragStickyHeadSec = NaN;
        regionOffsetDragMasterFreezeSec =
            typeof computeLiveMasterTransportDurationSec === 'function'
                ? computeLiveMasterTransportDurationSec()
                : typeof getMasterTransportDurationSec === 'function'
                  ? getMasterTransportDurationSec()
                  : 0;
    }
    function updateRegionOffsetDragMasterFreeze() {
        if (!Number.isFinite(regionOffsetDragMasterFreezeSec) || regionOffsetDragMasterFreezeSec <= 0) {
            return;
        }
        if (typeof waveformOffsetDragActive !== 'undefined' && waveformOffsetDragActive) {
            return;
        }
        const live =
            typeof computeLiveMasterTransportDurationSec === 'function'
                ? computeLiveMasterTransportDurationSec()
                : 0;
        if (live > regionOffsetDragMasterFreezeSec + 0.01) {
            regionOffsetDragMasterFreezeSec = live;
        }
    }
    function endRegionOffsetDragMasterFreeze() {
        regionOffsetDragMasterFreezeSec = NaN;
        regionOffsetDragStickyHeadSec = NaN;
    }
    window.getRegionOffsetDragMasterFreezeSec = function () {
        return Number.isFinite(regionOffsetDragMasterFreezeSec) &&
            regionOffsetDragMasterFreezeSec > 0
            ? regionOffsetDragMasterFreezeSec
            : 0;
    };
    window.beginRegionOffsetDragMasterFreeze = beginRegionOffsetDragMasterFreeze;
    window.updateRegionOffsetDragMasterFreeze = updateRegionOffsetDragMasterFreeze;
    window.endRegionOffsetDragMasterFreeze = endRegionOffsetDragMasterFreeze;
    window.clearPlaybackRegion = clearPlaybackRegion;
    window.clearTrackRegion = clearTrackRegion;
    window.setTrackSegments = setTrackSegments;
    window.applyTrackRegionBounds = function (track, inS, outS, opt) {
        return setTrackSegments(track, [{ sourceInSec: inS, sourceOutSec: outS }], opt);
    };
    window.splitPlaybackRegionAtTargetSec = splitPlaybackRegionAtTargetSec;
    window.joinPlaybackRegionAtPointer = joinPlaybackRegionAtPointer;
    window.mergeSegmentSpanAt = mergeSegmentSpanAt;
    window.applyRegionFadeAtSeekbar = applyRegionFadeAtSeekbar;
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
    window.handlePlaybackRegionSelectAllKeydown = handlePlaybackRegionSelectAllKeydown;
    window.handlePlaybackRegionSelectAtSeekbarKeydown =
        handlePlaybackRegionSelectAtSeekbarKeydown;
    window.selectAllRegionsOnTargetTrack = selectAllRegionsOnTargetTrack;
    window.selectPlaybackRegionsAtActiveTrackEnter = selectPlaybackRegionsAtActiveTrackEnter;
    window.handlePlaybackRegionFadeInKeydown = handlePlaybackRegionFadeInKeydown;
    window.handlePlaybackRegionFadeOutKeydown = handlePlaybackRegionFadeOutKeydown;
    window.handlePlaybackRegionInNudgeKeydown = handlePlaybackRegionInNudgeKeydown;
    window.handlePlaybackRegionOutNudgeKeydown = handlePlaybackRegionOutNudgeKeydown;
    window.beginRegionUndoGesture = beginRegionUndoGesture;
    window.commitRegionUndoGesture = commitRegionUndoGesture;
    window.clearRegionUndoStack = clearRegionUndoStack;
    window.handlePlaybackRegionEscapeKeydown = handlePlaybackRegionEscapeKeydown;
    window.handlePlaybackRegionGroupKeydown = handlePlaybackRegionGroupKeydown;
    window.handlePlaybackRegionSwapKeydown = handlePlaybackRegionSwapKeydown;
    window.handlePlaybackRegionRehearsalMarkJumpKeydown =
        handlePlaybackRegionRehearsalMarkJumpKeydown;
    window.jumpToRegionRehearsalMark = jumpToRegionRehearsalMark;
    window.swapSelectedPlaybackRegions = swapSelectedPlaybackRegions;
    window.handleRegionSelectionPointerDown = handleRegionSelectionPointerDown;
    window.handleSilentGapSelectionPointerDown = handleSilentGapSelectionPointerDown;
    window.toggleRegionSelection = toggleRegionSelection;
    window.toggleSilentGapSelection = toggleSilentGapSelection;
    window.deleteSilentGapAt = deleteSilentGapAt;
    window.tryDeleteSilentGapAtRehearsalEditPointer = tryDeleteSilentGapAtRehearsalEditPointer;
    window.hasSilentGapRegionSelection = hasSilentGapRegionSelection;
    window.silentGapDeleteDiagLog = silentGapDeleteDiagLog;
    window.silentGapDeleteDiagSnapshotTrack = silentGapDeleteDiagSnapshotTrack;
    window.clearRegionSelection = clearRegionSelection;
    window.collectRegionGroupMembers = collectRegionGroupMembers;
    window.flashRegionGroupMembers = flashRegionGroupMembers;
    window.collectRegionGroupMemberIndices = collectRegionGroupMemberIndices;
    window.handlePlaybackRegionMixKeydown = handlePlaybackRegionMixKeydown;
    window.resolveMixTargetFromActiveRegion = resolveMixTargetFromActiveRegion;
    window.updateAllPlaybackRegionOverlays = updateAllPlaybackRegionOverlays;
    window.refreshAllPlaybackRegionFadeTriangles = refreshAllPlaybackRegionFadeTriangles;
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
    window.resolveParallelRegionOffsetDragInPadSec =
        resolveParallelRegionOffsetDragInPadSec;
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
