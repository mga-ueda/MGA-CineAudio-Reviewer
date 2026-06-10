/**
 * waveform-region-io-nav.js — リージョンナビ・練習番号ジャンプ
 */
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

    function regionNavStopIndexForCurrent(stops, dir, fromSec) {
        if (!stops || stops.length === 0) return -1;
        const t = Number.isFinite(fromSec)
            ? fromSec
            : typeof getTransportSec === 'function'
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

    function regionNavHintTitleForSlot(slot) {
        if (slot < 0) return 'Range loop';
        if (
            typeof extraTrackBySlot === 'function' &&
            typeof getExtraTrackFileName === 'function'
        ) {
            const name = getExtraTrackFileName(extraTrackBySlot(slot));
            if (name) return name;
        }
        return 'Ex ' + (slot + 1);
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
        if (
            opt &&
            opt.discreteStopNav &&
            typeof applyDiscreteStopNavStep === 'function'
        ) {
            applyDiscreteStopNavStep(target, {
                resumeAfterSeek: resumeAfter,
                fromRepeat: opt.fromRepeat,
            });
            syncRegionNavSeekTransportUi(target);
            const edgeLabel = stop.edge === 'out' ? ' Out' : ' In';
            const hintTc =
                typeof formatTimecodeForTransport === 'function'
                    ? formatTimecodeForTransport(target)
                    : String(target);
            const hintTitle =
                opt && opt.hintTitle
                    ? opt.hintTitle
                    : regionNavHintTitleForSlot(stop.slot);
            if (!opt.fromRepeat) {
                writeLog('Region: seek to ' + hintTitle + ' ' + hintTc + edgeLabel);
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint(hintTitle, hintTc + edgeLabel);
                }
            }
            return true;
        }
        if (typeof applyJumpTransportSeek === 'function') {
            applyJumpTransportSeek(target, resumeAfter);
        } else if (typeof applyTransportAtSec === 'function') {
            applyTransportAtSec(target, { resumeAfter: resumeAfter });
        }
        syncRegionNavSeekTransportUi(target);
        const edgeLabel = stop.edge === 'out' ? ' Out' : ' In';
        const hintTc =
            typeof formatTimecodeForTransport === 'function'
                ? formatTimecodeForTransport(target)
                : String(target);
        const hintTitle =
            opt && opt.hintTitle
                ? opt.hintTitle
                : regionNavHintTitleForSlot(stop.slot);
        writeLog('Region: seek to ' + hintTitle + ' ' + hintTc + edgeLabel);
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(hintTitle, hintTc + edgeLabel);
        }
        return true;
    }

    let rehearsalMarkOffsetEnabled = false;

    /** Offset ON 時、番号なしフレーズの内部表現 */
    const REHEARSAL_MARK_UNLABELED = '_';

    function rehearsalMarkOffsetSlotAdjustment() {
        return rehearsalMarkOffsetEnabled ? 1 : 0;
    }

    /** フレーズスロット index（0 始まり）→ 練習番号（A/B/… または REHEARSAL_MARK_UNLABELED） */
    function rehearsalMarkLabelForPhraseSlotIndex(phraseSlotIndex) {
        const phraseSlot = phraseSlotIndex | 0;
        if (phraseSlot < 0) return REHEARSAL_MARK_UNLABELED;
        const markIndex = phraseSlot - rehearsalMarkOffsetSlotAdjustment();
        if (markIndex < 0) return REHEARSAL_MARK_UNLABELED;
        if (typeof formatRegionRehearsalMarkLabel === 'function') {
            return formatRegionRehearsalMarkLabel(markIndex);
        }
        if (typeof phraseGroupLabelForIndex === 'function') {
            return phraseGroupLabelForIndex(markIndex);
        }
        return 'A';
    }

    /** 内部ラベル → UI 表示用文字（番号なしは空文字） */
    function rehearsalMarkDisplayLabel(internalLabel) {
        return internalLabel === REHEARSAL_MARK_UNLABELED ? '' : internalLabel;
    }

    /** キーボード練習番号 index（A=0）→ フレーズスロット index */
    function phraseSlotIndexForRehearsalMarkKeyIndex(markIndex) {
        return (markIndex | 0) + rehearsalMarkOffsetSlotAdjustment();
    }

    function segmentIndexFromRehearsalMarkKey(e) {
        if (!e || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return null;
        const key = e.key;
        if (!key || key.length !== 1) return null;
        const code = key.toUpperCase().charCodeAt(0);
        if (code < 65 || code > 90) return null;
        return code - 65;
    }

    function resolveSegmentIndexForRehearsalMarkKey(track, markIndex) {
        const mi = markIndex | 0;
        if (mi < 0) return null;
        const phraseSlot = phraseSlotIndexForRehearsalMarkKeyIndex(mi);
        const ranges =
            typeof getPhraseGroupRangesForRegionRehearsalMarks === 'function'
                ? getPhraseGroupRangesForRegionRehearsalMarks()
                : [];
        if (phraseSlot < 0 || phraseSlot >= ranges.length) return null;
        const r = ranges[phraseSlot];
        const eps = segmentBoundaryJoinEpsilonSec();
        const count = getSegmentCount(track);
        let bestIdx = null;
        let bestIn = Infinity;
        for (let si = 0; si < count; si++) {
            const inSec = getSegmentRegionTimelineIn(track, si);
            if (inSec >= r.startSec - eps && inSec < r.endSec - eps) {
                if (inSec < bestIn) {
                    bestIn = inSec;
                    bestIdx = si;
                }
            }
        }
        return bestIdx;
    }

    function resolveRegionRehearsalJumpTrack() {
        for (let i = 0; i < regionSelectionEntries.length; i++) {
            const entry = regionSelectionEntries[i];
            if (entry.segmentIndex >= 0) {
                return { type: 'extra', slot: entry.slot | 0 };
            }
        }
        const trackCount = getExtraTrackCount();
        for (let slot = 0; slot < trackCount; slot++) {
            const track = { type: 'extra', slot };
            if (isTrackRegionActive(track) && getSegmentCount(track) > 0) {
                return track;
            }
        }
        return null;
    }

    function jumpToRegionRehearsalMark(markIndex, opt) {
        const track = resolveRegionRehearsalJumpTrack();
        if (!track || !isTrackRegionActive(track)) return false;
        const mi = markIndex | 0;
        if (mi < 0) return false;
        const phraseSlot = phraseSlotIndexForRehearsalMarkKeyIndex(mi);
        const ranges =
            typeof getPhraseGroupRangesForRegionRehearsalMarks === 'function'
                ? getPhraseGroupRangesForRegionRehearsalMarks()
                : [];
        if (phraseSlot < 0 || phraseSlot >= ranges.length) return false;
        const r = ranges[phraseSlot];
        const segIdx = resolveSegmentIndexForRehearsalMarkKey(track, markIndex);
        const inSec =
            segIdx != null && segIdx >= 0
                ? getSegmentRegionTimelineIn(track, segIdx)
                : r && Number.isFinite(r.startSec)
                  ? r.startSec
                  : null;
        if (!Number.isFinite(inSec)) return false;
        const mark = rehearsalMarkLabelForPhraseSlotIndex(phraseSlot);
        const markHint = rehearsalMarkDisplayLabel(mark) || mark;
        return seekToRegionNavStop(
            {
                sec: inSec,
                edge: 'in',
                slot: track.slot,
                segmentIndex: segIdx != null ? segIdx : -1,
            },
            {
                resumeAfterSeek: !!(opt && opt.resumeAfterSeek),
                hintTitle: 'Region ' + markHint,
                discreteStopNav: true,
            },
        );
    }

    function handlePlaybackRegionRehearsalMarkJumpKeydown(e) {
        const markIndex = segmentIndexFromRehearsalMarkKey(e);
        if (markIndex == null) return false;
        if (e.repeat) return false;
        if (
            typeof transportControlsReady === 'function' &&
            !transportControlsReady()
        ) {
            return false;
        }
        if (!resolveRegionRehearsalJumpTrack()) return false;
        const wasPlaying =
            typeof isTransportPlaying === 'function'
                ? isTransportPlaying()
                : typeof videoMain !== 'undefined' && videoMain && !videoMain.paused;
        if (!jumpToRegionRehearsalMark(markIndex, { resumeAfterSeek: wasPlaying })) {
            return false;
        }
        e.preventDefault();
        return true;
    }

    function syncRehearsalMarkOffsetUi() {
        const el = document.getElementById('rehearsalMarkOffsetCheckbox');
        if (el) el.checked = rehearsalMarkOffsetEnabled;
    }

    function getRehearsalMarkOffsetEnabled() {
        return rehearsalMarkOffsetEnabled;
    }

    function getRehearsalMarkPersistSnapshot() {
        return { offset: rehearsalMarkOffsetEnabled };
    }

    function setRehearsalMarkOffsetEnabled(value, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        rehearsalMarkOffsetEnabled = !!value;
        syncRehearsalMarkOffsetUi();
        if (typeof refreshAllRegionMusicalMetaPresentation === 'function') {
            refreshAllRegionMusicalMetaPresentation();
        } else if (typeof refreshAllRegionRehearsalMarkLabels === 'function') {
            refreshAllRegionRehearsalMarkLabels();
        }
        if (!o.silent && typeof writeLog === 'function') {
            writeLog('R. Offset: ' + (rehearsalMarkOffsetEnabled ? 'ON' : 'OFF'));
        }
        if (!o.silent && typeof flashSeekHint === 'function') {
            flashSeekHint('R. Offset', rehearsalMarkOffsetEnabled ? 'ON' : 'OFF', 'notice');
        }
        if (!o.silent && typeof flashTransportOptBox === 'function') {
            flashTransportOptBox('rehearsalMarkOffset');
        }
        if (!o.silent && !o.skipPersist && typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
    }

    function applyRehearsalMarkImportSnapshot(snap) {
        const s = snap && typeof snap === 'object' ? snap : {};
        setRehearsalMarkOffsetEnabled(!!s.offset, { silent: true });
    }

    function toggleRehearsalMarkOffset() {
        setRehearsalMarkOffsetEnabled(!getRehearsalMarkOffsetEnabled());
        return true;
    }

    function initRehearsalMarkOffsetUi() {
        const el = document.getElementById('rehearsalMarkOffsetCheckbox');
        if (!el || el.dataset.bound === '1') return;
        el.dataset.bound = '1';
        syncRehearsalMarkOffsetUi();
        el.addEventListener('change', () => {
            setRehearsalMarkOffsetEnabled(!!el.checked);
        });
    }

    initRehearsalMarkOffsetUi();

    function resolveAdjacentRegionStopSec(dir, fromSec) {
        const stops = buildRegionNavStops();
        const n = stops.length;
        if (n === 0) return null;
        const idx = regionNavStopIndexForCurrent(stops, dir, fromSec);
        const t = Number.isFinite(fromSec)
            ? fromSec
            : typeof getTransportSec === 'function'
              ? getTransportSec()
              : typeof videoMain !== 'undefined' && videoMain
                ? videoMain.currentTime || 0
                : 0;
        const eps = regionNavStopEpsilonSec();
        let next;
        if (idx < 0) {
            if (dir <= 0) return null;
            next = 0;
        } else if (dir < 0 && t > stops[idx].sec + eps) {
            next = idx;
        } else if (dir > 0 && t < stops[idx].sec - eps) {
            next = idx;
        } else {
            next = idx + dir;
            if (next < 0 || next >= n) return null;
        }
        const sec = stops[next].sec;
        return Number.isFinite(sec) ? sec : null;
    }

    function jumpToAdjacentRegionStop(dir, opt) {
        const targetSec = resolveAdjacentRegionStopSec(dir);
        if (targetSec == null) return false;
        const stops = buildRegionNavStops();
        const eps = regionNavStopEpsilonSec();
        const stop = stops.find((s) => Math.abs(s.sec - targetSec) <= eps);
        if (!stop) return false;
        return seekToRegionNavStop(stop, opt);
    }

    window.buildRegionNavStops = buildRegionNavStops;
    window.resolveAdjacentRegionStopSec = resolveAdjacentRegionStopSec;
    window.jumpToAdjacentRegionStop = jumpToAdjacentRegionStop;
    window.getTrackSegmentCount = function (slot) {
        return getSegmentCount({ type: 'extra', slot });
    };
    window.syncExtraLaneRegionsForSlot = function (slot) {
        syncExtraLaneRegionsClassForTrack({ type: 'extra', slot });
    };
    window.getActiveExtraSegmentsAtTransport = getActiveExtraSegmentsAtTransport;
    window.refreshSegmentHitAtTransport = refreshSegmentHitAtTransport;
    window.phraseSlotPlacementSec = phraseSlotPlacementSec;
    window.phraseSlotRegionInTargetSec = phraseSlotRegionInTargetSec;
    window.isSegmentBoundaryJoined = isSegmentBoundaryJoined;
    window.isSegmentBoundaryJoinableAtIndex = isSegmentBoundaryJoinableAtIndex;
    window.playbackRegionBoundaryJoinBlockReason = playbackRegionBoundaryJoinBlockReason;
    window.isAutoJoinedBoundaryCrossfadeEligible = isAutoJoinedBoundaryCrossfadeEligible;
    window.hasExtendedCrossfadeOverlapAtBoundary = hasExtendedCrossfadeOverlapAtBoundary;
    window.hasManualSegmentFadeAtJoinedBoundary = hasManualSegmentFadeAtJoinedBoundary;
    window.getManualJoinedBoundaryFadeZone = getManualJoinedBoundaryFadeZone;
    window.isTransportInManualJoinedBoundaryFadeZone =
        isTransportInManualJoinedBoundaryFadeZone;
    window.isSegmentSourceContinuousAtBoundary = isSegmentSourceContinuousAtBoundary;
    window.getContinuousJoinedSourceOutSec = getContinuousJoinedSourceOutSec;
    window.planIncomingSegmentStartAtJoinedBoundary =
        planIncomingSegmentStartAtJoinedBoundary;
    window.JOINED_BOUNDARY_CROSSFADE_SEC = JOINED_BOUNDARY_CROSSFADE_SEC;
    window.getSegmentGainDb = getSegmentGainDb;
    window.getSegmentGainLinear = getSegmentGainLinear;
    window.getSegmentFadeDurationSec = getSegmentFadeDurationSec;
    window.getSegmentPlaybackGainLinear = getSegmentPlaybackGainLinear;
    window.setSegmentGainDb = setSegmentGainDb;
    window.getSegmentRegionTimelineBounds = function (slot, segmentIndex) {
        const track = { type: 'extra', slot };
        if (!isTrackRegionActive(track)) return null;
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return null;
        const bounds = getSegmentRegionTimelineInterval(track, segmentIndex);
        return {
            startSec: bounds.start,
            endSec: bounds.end,
        };
    };
    window.handlePlaybackRegionGainWheel = handlePlaybackRegionGainWheel;
    window.handlePlaybackRegionPitchWheel = handlePlaybackRegionPitchWheel;
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
    window.getTrackSegments = getTrackSegments;
    window.getSegmentRegionTimelineIn = getSegmentRegionTimelineIn;
    window.getSegmentRegionTimelineOut = getSegmentRegionTimelineOut;
    window.getSegmentRegionGroupId = getSegmentRegionGroupId;
    window.resolveRegionSwapUnitSegmentIndices = resolveRegionSwapUnitSegmentIndices;
    window.repositionRegionSwapUnitToTimelineSec = repositionRegionSwapUnitToTimelineSec;
    window.syncTrackHeadPadFromFirstSegment = syncTrackHeadPadFromFirstSegment;
    window.segmentBoundaryJoinEpsilonSec = function segmentBoundaryJoinEpsilonSec() {
        return SEGMENT_BOUNDARY_JOIN_EPS_SEC;
    };
    window.getPlaybackRegionsState = getPlaybackRegionsState;
    window.requestRegionUndoCapture = requestRegionUndoCapture;
    window.attachRegionSwapAnimHintToUndoStackTop = attachRegionSwapAnimHintToUndoStackTop;
    window.previewTrackSegmentsFromUndoEntry = previewTrackSegmentsFromUndoEntry;
    window.captureTrackRegionOverlayIntervals = captureTrackRegionOverlayIntervals;
    window.redrawAfterRegionChange = redrawAfterRegionChange;
    window.REHEARSAL_MARK_UNLABELED = REHEARSAL_MARK_UNLABELED;
    window.rehearsalMarkLabelForPhraseSlotIndex = rehearsalMarkLabelForPhraseSlotIndex;
    window.rehearsalMarkDisplayLabel = rehearsalMarkDisplayLabel;
    window.phraseSlotIndexForRehearsalMarkKeyIndex = phraseSlotIndexForRehearsalMarkKeyIndex;
    window.getRehearsalMarkOffsetEnabled = getRehearsalMarkOffsetEnabled;
    window.setRehearsalMarkOffsetEnabled = setRehearsalMarkOffsetEnabled;
    window.toggleRehearsalMarkOffset = toggleRehearsalMarkOffset;
    window.getRehearsalMarkPersistSnapshot = getRehearsalMarkPersistSnapshot;
    window.applyRehearsalMarkImportSnapshot = applyRehearsalMarkImportSnapshot;

