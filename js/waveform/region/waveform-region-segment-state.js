/**
 * waveform-region-segment-state.js — セグメント状態の適用・クリア
 */
    function applySegmentsToState(track, segments, opt) {
        if (!isPlaybackRegionTrackRef(track)) return false;
        if (!segments.length) return false;
        if (!(opt && opt.skipUndo) && !regionUndoPaused) {
            requestRegionUndoCapture();
        }

        const state = getPlaybackRegionsState(track);
        const prevSegmentCount = state.segments ? state.segments.length : 0;
        state.segments = segments;
        state.active = true;
        syncTrackRegionHeadStateFromFirstSegment(track);
        if (isExtraTrackRef(track)) {
            bumpRegionPersistEpoch(track.slot);
        }
        if (
            !(typeof isSessionRestoreInProgress === 'function' && isSessionRestoreInProgress()) &&
            !(opt && opt.keepPendingRestore)
        ) {
            pendingPlaybackRegionRestore = null;
        }

        const deferRedraw = !!(opt && opt.deferRedraw);
        const geometryOnly = !!(opt && opt.geometryOnly);
        const skipOverlay = !!(opt && opt.skipOverlay);
        if (
            !(opt && opt.skipMusicalRefresh) &&
            !geometryOnly &&
            typeof refreshTrackTimelineMusicalSlots === 'function'
        ) {
            refreshTrackTimelineMusicalSlots(track, { preserveStored: false });
        }
        if (!deferRedraw && !skipOverlay) {
            if (geometryOnly) {
                refreshTrackRegionOverlayGeometry(track);
            } else {
                updateTrackRegionOverlays(track);
            }
        }
        const redrawOpt = {
            invalidatePeakCache: !(opt && opt.invalidatePeakCache === false),
            segmentStructureChanged:
                opt && opt.segmentStructureChanged != null
                    ? !!opt.segmentStructureChanged
                    : prevSegmentCount !== segments.length,
            geometryOnly,
        };
        if (opt && Array.isArray(opt.affectedSegmentIndices) && opt.affectedSegmentIndices.length) {
            redrawOpt.affectedSegmentIndices = opt.affectedSegmentIndices;
        }
        if (!deferRedraw) {
            if (isVideoTrackRef(track)) {
                if (typeof refreshVideoVizRegionThumbnails === 'function') {
                    refreshVideoVizRegionThumbnails();
                }
                if (typeof notifyMasterTransportDurationChanged === 'function') {
                    notifyMasterTransportDurationChanged();
                }
            } else {
                redrawAfterRegionChange(track.slot, redrawOpt);
            }
        }

        if (!(opt && opt.silent)) {
            if (isVideoTrackRef(track)) {
                writeLog('Video split: ' + segments.length + ' region(s)');
                flashSeekHint('Video', segments.length + ' regions', 'notice');
            } else {
                writeLog(
                    'Ex ' +
                        (track.slot + 1) +
                        ' split: ' +
                        segments.length +
                        ' region(s)',
                );
                flashSeekHint('Ex ' + (track.slot + 1), segments.length + ' regions', 'notice');
            }
        }
        if (
            !(opt && opt.skipPersist) &&
            !deferRedraw &&
            typeof schedulePersistSession === 'function'
        ) {
            schedulePersistSession();
        }
        if (
            !geometryOnly &&
            !deferRedraw &&
            !(opt && opt.skipSyncTransport) &&
            isExtraTrackRef(track) &&
            typeof syncExtraAudioToTransport === 'function'
        ) {
            syncExtraAudioToTransport({ force: true });
        }
        return true;
    }

    function setTrackSegments(track, segments, opt) {
        if (!isPlaybackRegionTrackRef(track)) return false;
        const collapsed = Array.isArray(segments) ? segments : [];
        const normalized = [];
        for (const seg of collapsed) {
            let fullDur = getSegmentSourceDurationSec(track, seg);
            if (!fullDur) {
                const inS = Number(seg && seg.sourceInSec) || 0;
                const outS = Number(seg && seg.sourceOutSec);
                if (Number.isFinite(outS) && outS > inS + 1e-6) fullDur = outS;
            }
            if (!fullDur) continue;
            normalized.push(normalizeSegmentEntry(seg, track, fullDur));
        }
        if (!normalized.length) return false;

        if (
            typeof isRangeLoopPlaybackActive === 'function' &&
            isRangeLoopPlaybackActive() &&
            typeof clearRangeLoopPlayback === 'function'
        ) {
            clearRangeLoopPlayback({ silent: true });
        }

        return applySegmentsToState(track, normalized, opt);
    }

    function clearTrackRegion(track, opt) {
        if (!isExtraTrackRef(track)) return;
        if (!(opt && opt.skipUndo) && !regionUndoPaused) {
            requestRegionUndoCapture();
        }
        const state = getPlaybackRegionsState(track);
        if (!state) return;
        const was = state.active && state.segments.length;
        state.segments = [];
        state.active = false;
        state.headPadSec = 0;
        delete state.regionTimelineInSec;
        delete state.regionLeadPadSec;
        if (opt && opt.skipOverlay) {
            const container = getPlaybackRegionsContainerEl(track);
            if (container) {
                container.replaceChildren();
                container.hidden = true;
            }
            syncExtraLaneRegionsClassForTrack(track);
        } else {
            updateTrackRegionOverlays(track);
            syncExtraLaneRegionsClassForTrack(track);
        }
        if (was && !(opt && opt.skipRedraw)) {
            noteRegionShrinkPersistIntent(track.slot);
            redrawAfterRegionChange(track.slot);
            if (!(opt && opt.silent)) {
                writeLog('Ex ' + (track.slot + 1) + ' regions: off');
            }
            if (typeof schedulePersistSession === 'function') schedulePersistSession();
        }
    }

    function clearPlaybackRegion(opt) {
        if (!(opt && opt.skipUndo) && !regionUndoPaused) {
            requestRegionUndoCapture();
        }
        const childOpt = Object.assign({}, opt || {}, { skipUndo: true });
        const n =
            getExtraTrackCount();
        for (let i = 0; i < n; i++) {
            clearTrackRegion({ type: 'extra', slot: i }, childOpt);
        }
        if (!(opt && opt.silent) && typeof flashSeekHint === 'function') {
            flashSeekHint('Region', 'Off', 'notice');
        }
    }
