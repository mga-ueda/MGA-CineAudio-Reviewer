/**
 * waveform-region-ui.js — オーバーレイ・ドラッグ・ホバー
 */
    function updateAllPlaybackRegionOverlays() {
        if (typeof window.regionRestoreDiagLog === 'function') {
            window.regionRestoreDiagLog('updateAllOverlays/begin', {
                extraCount: getExtraTrackCount(),
            });
        }
        const n = getExtraTrackCount();
        for (let i = 0; i < n; i++) {
            const track = { type: 'extra', slot: i };
            if (typeof isExtraTrackLoaded === 'function' && !isExtraTrackLoaded(i)) {
                continue;
            }
            if (typeof isTrackRegionActive === 'function' && !isTrackRegionActive(track)) {
                continue;
            }
            try {
                updateTrackRegionOverlays(track);
            } catch (err) {
                writeLog(
                    'Extra audio ' +
                        (i + 1) +
                        ': overlay update skipped — ' +
                        (err && err.message ? err.message : String(err)),
                );
                try {
                    updateTrackRegionOverlays(
                        { type: 'extra', slot: i },
                        { forceLightweight: true },
                    );
                } catch (fallbackErr) {
                    if (typeof window.regionRestoreDiagLog === 'function') {
                        window.regionRestoreDiagLog('overlay/fallback-unavailable', {
                            ex: i + 1,
                            err:
                                fallbackErr && fallbackErr.message
                                    ? fallbackErr.message
                                    : String(fallbackErr),
                        });
                    }
                }
            }
        }
        if (typeof window.regionRestoreDiagLog === 'function') {
            window.regionRestoreDiagLog('updateAllOverlays/done', null);
        }
    }

    /** 平行移動ドラッグ終了 — geometryOnly 中に状態だけ更新されたトラックの波形を確定描画 */
    function finalizeRegionOffsetDragPresentation(members) {
        if (!members || !members.length) return;
        const slots = new Set();
        for (let i = 0; i < members.length; i++) {
            const slot = members[i].slot;
            if (slot >= 0) slots.add(slot);
        }
        for (const slot of slots) {
            const track = { type: 'extra', slot };
            if (typeof refreshTrackTimelineMusicalSlots === 'function') {
                refreshTrackTimelineMusicalSlots(track, { preserveStored: false });
            }
            if (typeof updateTrackRegionOverlays === 'function') {
                updateTrackRegionOverlays(track);
            }
            if (typeof redrawAfterRegionChange === 'function') {
                redrawAfterRegionChange(slot);
            }
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (typeof refreshAllRegionRehearsalMarkLabels === 'function') {
            refreshAllRegionRehearsalMarkLabels();
        }
    }

    window.finalizeRegionOffsetDragPresentation = finalizeRegionOffsetDragPresentation;

    function clearRegionHandlePhraseBoundaryDragState() {
        regionHandleDragPhraseBoundary = false;
        regionHandleDragPhraseBoundaryCtx = null;
        regionHandleDragPhraseBoundaryLatestCounts = null;
    }

    function tryBeginPhraseBoundaryDragFromRegionBoundary(track, boundaryIndex) {
        if (
            typeof window.resolvePhraseBoundaryDragAtRegionBoundary !== 'function' ||
            typeof window.previewPhraseBoundaryDragFromRegionPointer !== 'function'
        ) {
            return false;
        }
        if (typeof window.cancelPhraseBoundaryDragPreview === 'function') {
            window.cancelPhraseBoundaryDragPreview();
        }
        const ctx = window.resolvePhraseBoundaryDragAtRegionBoundary(track, boundaryIndex);
        if (!ctx) return false;
        regionHandleDragPhraseBoundary = true;
        regionHandleDragPhraseBoundaryCtx = ctx;
        regionHandleDragPhraseBoundaryLatestCounts = ctx.startCounts
            ? ctx.startCounts.slice()
            : null;
        return true;
    }

    function applyPhraseBoundaryDragFromRegionPointer(clientX) {
        if (
            !regionHandleDragPhraseBoundary ||
            !regionHandleDragPhraseBoundaryCtx ||
            typeof window.previewPhraseBoundaryDragFromRegionPointer !== 'function'
        ) {
            return;
        }
        const counts = window.previewPhraseBoundaryDragFromRegionPointer(
            regionHandleDragPhraseBoundaryCtx,
            clientX,
            regionHandleDragStartClientX,
        );
        if (counts) {
            regionHandleDragPhraseBoundaryLatestCounts = counts;
        }
    }

    function finalizePhraseBoundaryDragFromRegion(cancelled) {
        if (!regionHandleDragPhraseBoundary) return false;
        if (cancelled) {
            if (typeof window.cancelPhraseBoundaryDragPreview === 'function') {
                window.cancelPhraseBoundaryDragPreview();
            }
            clearRegionHandlePhraseBoundaryDragState();
            return false;
        }
        const ctx = regionHandleDragPhraseBoundaryCtx;
        const startCounts = ctx && ctx.startCounts ? ctx.startCounts : null;
        const finalCounts = regionHandleDragPhraseBoundaryLatestCounts;
        let committed = false;
        if (
            startCounts &&
            finalCounts &&
            typeof window.commitPhraseBoundaryDragFromRegion === 'function'
        ) {
            committed = window.commitPhraseBoundaryDragFromRegion(
                startCounts,
                finalCounts,
                ctx.phraseBoundaryIndex,
                { relayoutSilent: true, skipUndo: true },
            );
        }
        clearRegionHandlePhraseBoundaryDragState();
        return committed;
    }

    function resolveSplitBoundaryIndexForHandleDrag(track, segmentIndex, kind, segmentCount) {
        if (kind === 'in' && segmentIndex > 0) {
            const b = segmentIndex - 1;
            if (
                typeof isSegmentMovableSplitBoundary === 'function' &&
                isSegmentMovableSplitBoundary(track, b)
            ) {
                return b;
            }
            if (
                typeof isSegmentBoundaryJoined === 'function' &&
                isSegmentBoundaryJoined(track, b)
            ) {
                return b;
            }
        } else if (kind === 'out' && segmentIndex < segmentCount - 1) {
            if (
                typeof isSegmentMovableSplitBoundary === 'function' &&
                isSegmentMovableSplitBoundary(track, segmentIndex)
            ) {
                return segmentIndex;
            }
            if (
                typeof isSegmentBoundaryJoined === 'function' &&
                isSegmentBoundaryJoined(track, segmentIndex)
            ) {
                return segmentIndex;
            }
        }
        return -1;
    }

    /** Phrase オフ時 — 配置由来の微小重なり／隙間をスプリット点へ吸着 */
    function prepareMovableSplitBoundaryForDrag(track, boundaryIndex) {
        if (
            typeof isPhraseOffMovableSplitBoundaryEnabled === 'function' &&
            !isPhraseOffMovableSplitBoundaryEnabled()
        ) {
            return;
        }
        if (
            typeof isSegmentMovableSplitBoundary !== 'function' ||
            !isSegmentMovableSplitBoundary(track, boundaryIndex)
        ) {
            return;
        }
        const leftEnd = getSegmentTimelineEnd(track, boundaryIndex);
        const rightStart = getSegmentTimelineStart(track, boundaryIndex + 1);
        const abutTol =
            typeof segmentBoundaryJoinEpsilonSec === 'function'
                ? segmentBoundaryJoinEpsilonSec() * 0.5
                : 0.001;
        if (Math.abs(leftEnd - rightStart) <= abutTol) return;
        const weldTransport = (leftEnd + rightStart) * 0.5;
        setSplitBoundaryFromTransport(track, boundaryIndex, weldTransport, {
            geometryOnly: true,
            silent: true,
        });
    }

    function setSplitBoundaryFromTransport(track, boundaryIndex, transportSec, opt) {
        const state = getPlaybackRegionsState(track);
        if (!state) return;
        const segments = state.segments.map((s) => ({ ...s }));
        const left = segments[boundaryIndex];
        const right = segments[boundaryIndex + 1];
        if (!left || !right) return;

        const leftStart = getSegmentTimelineStart(track, boundaryIndex);
        const snapOpt = {
            exclude: {
                slot: track.slot,
                segmentIndices: [boundaryIndex, boundaryIndex + 1],
            },
            sameSlotOnly: track.slot,
        };
        const t =
            typeof snapRegionHandleTransportSec === 'function'
                ? snapRegionHandleTransportSec(transportSec, snapOpt)
                : snapRegionTransportSec(transportSec, snapOpt);
        if (!Number.isFinite(t)) return;

        const leftIn = Number(left.sourceInSec) || 0;
        const rightClipDur = getSegmentSourceDurationSec(track, right);
        const rightOut = Number.isFinite(right.sourceOutSec)
            ? right.sourceOutSec
            : rightClipDur;
        let sourceSplit = leftIn + (t - leftStart);
        const minSplit = leftIn + PLAYBACK_REGION_MIN_SEC;
        const maxSplit = rightOut - PLAYBACK_REGION_MIN_SEC;
        if (maxSplit < minSplit) return;
        sourceSplit = Math.max(minSplit, Math.min(maxSplit, sourceSplit));

        left.sourceOutSec = sourceSplit;
        right.sourceInSec = sourceSplit;
        if (!Number.isFinite(left.timelineStartSec)) {
            left.timelineStartSec = leftStart;
        }
        right.timelineStartSec = leftStart + (sourceSplit - leftIn);
        delete left.regionTimelineInSec;
        delete left.regionLeadPadSec;
        delete left.fadeOutSec;
        delete right.regionTimelineInSec;
        delete right.regionLeadPadSec;
        delete right.fadeInSec;

        const normalized = segments.map((s) =>
            normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
        );
        applySegmentsToState(track, normalized, {
            silent: !!(opt && opt.silent),
            skipUndo: true,
            geometryOnly: !!(opt && opt.geometryOnly),
            skipPersist: !!(opt && opt.geometryOnly),
            affectedSegmentIndices: [boundaryIndex, boundaryIndex + 1],
        });
    }

    function notifyCannotJoinSegmentBoundary(track, boundaryIndex) {
        const reason =
            typeof playbackRegionBoundaryJoinBlockReason === 'function'
                ? playbackRegionBoundaryJoinBlockReason(track, boundaryIndex)
                : 'unknown block reason';
        writeLog('Playback region: cannot join (' + reason + ')');
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Region', "Can't join here", 'error');
        }
    }

    /** 複数選択ボンドが不可な理由。選択が有効な連続範囲のときは null。 */
    function resolveRegionSelectionJoinBlockReason() {
        if (regionSelectionEntries.length < 2) return null;
        const segEntries = regionSelectionEntries.filter((e) => e.segmentIndex >= 0);
        if (segEntries.length !== regionSelectionEntries.length) {
            return 'silent gap in selection';
        }
        if (segEntries.length < 2) return null;

        const slot = segEntries[0].slot;
        if (!segEntries.every((e) => e.slot === slot)) {
            return 'different tracks';
        }

        const indices = [...new Set(segEntries.map((e) => e.segmentIndex))].sort(
            (a, b) => a - b,
        );
        if (indices.length !== segEntries.length) {
            return 'duplicate selection';
        }

        for (let i = 1; i < indices.length; i++) {
            if (indices[i] !== indices[i - 1] + 1) {
                return 'non-consecutive regions';
            }
        }
        return null;
    }

    function notifyCannotBondFromSelection(reason) {
        writeLog('Playback region: cannot bond (' + reason + ')');
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Region', "Can't bond", 'error');
        }
    }

    function joinSegmentBoundaryAt(track, boundaryIndex, opt) {
        if (!isSegmentBoundaryJoinableAtIndex(track, boundaryIndex)) {
            if (!(opt && opt.silent)) {
                notifyCannotJoinSegmentBoundary(track, boundaryIndex);
            }
            return false;
        }
        if (
            !(opt && opt.skipPhraseRelayout) &&
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible() &&
            typeof window.joinPhraseAtRegionBoundary === 'function' &&
            window.joinPhraseAtRegionBoundary(track, boundaryIndex, opt)
        ) {
            if (!(opt && opt.skipClearSelection) && typeof clearRegionSelection === 'function') {
                clearRegionSelection();
            }
            return true;
        }
        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        const left = segments[boundaryIndex];
        const right = segments[boundaryIndex + 1];
        if (!left || !right) return false;

        const leftClip =
            left.clipId || getSegmentClipId(track, boundaryIndex);
        const rightClip =
            right.clipId || getSegmentClipId(track, boundaryIndex + 1);

        const merged = {
            id: left.id || newRegionId(),
            clipId: leftClip,
            sourceInSec: left.sourceInSec,
            sourceOutSec: right.sourceOutSec,
            timelineStartSec: getSegmentTimelineStart(track, boundaryIndex),
        };
        if (Number.isFinite(left.regionTimelineInSec)) {
            merged.regionTimelineInSec = left.regionTimelineInSec;
        }
        if (Number.isFinite(left.regionLeadPadSec)) {
            merged.regionLeadPadSec = left.regionLeadPadSec;
        }
        if (Number.isFinite(left.gainDb)) {
            merged.gainDb = left.gainDb;
        }
        if (Number.isFinite(left.pitchSemitones) && left.pitchSemitones !== 0) {
            merged.pitchSemitones = left.pitchSemitones;
        }
        if (Number.isFinite(left.fadeInSec)) {
            merged.fadeInSec = left.fadeInSec;
        }
        if (Number.isFinite(right.fadeOutSec)) {
            merged.fadeOutSec = right.fadeOutSec;
        }

        segments.splice(boundaryIndex, 2, merged);
        if (
            !setTrackSegments(track, segments, {
                silent: true,
                skipUndo: !!(opt && opt.skipUndo),
            })
        ) {
            writeLog('Playback region: join not applied');
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'Not joined', 'notice');
            }
            return false;
        }
        noteRegionShrinkPersistIntent(track.slot);

        if (!(opt && opt.skipClearSelection) && typeof clearRegionSelection === 'function') {
            clearRegionSelection();
        }

        writeLog(
            'Ex ' +
                (track.slot + 1) +
                ': regions joined at boundary ' +
                (boundaryIndex + 1) +
                ' (' +
                segments.length +
                ' left)',
        );
        if (!(opt && opt.silent) && typeof flashSeekHint === 'function') {
            flashSeekHint('Ex ' + (track.slot + 1), 'Regions joined', 'notice');
        }
        return true;
    }

    /** lo..hi（含む）の連続セグメントを 1 リージョンにまとめる。各境界が結合可能であること。 */
    function mergeSegmentSpanAt(track, lo, hi, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const first = lo | 0;
        const last = hi | 0;
        if (last <= first) return false;
        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        if (first < 0 || last >= segments.length) return false;

        for (let b = first; b < last; b++) {
            if (!isSegmentBoundaryJoinableAtIndex(track, b)) {
                if (!o.silent) {
                    notifyCannotJoinSegmentBoundary(track, b);
                }
                return false;
            }
        }

        const left = segments[first];
        const right = segments[last];
        if (!left || !right) return false;

        const leftClip = left.clipId || getSegmentClipId(track, first);
        const merged = {
            id: left.id || newRegionId(),
            clipId: leftClip,
            sourceInSec: left.sourceInSec,
            sourceOutSec: right.sourceOutSec,
            timelineStartSec: getSegmentTimelineStart(track, first),
        };
        if (Number.isFinite(left.regionTimelineInSec)) {
            merged.regionTimelineInSec = left.regionTimelineInSec;
        }
        if (Number.isFinite(left.regionLeadPadSec)) {
            merged.regionLeadPadSec = left.regionLeadPadSec;
        }
        if (Number.isFinite(left.gainDb)) {
            merged.gainDb = left.gainDb;
        }
        if (Number.isFinite(left.pitchSemitones) && left.pitchSemitones !== 0) {
            merged.pitchSemitones = left.pitchSemitones;
        }
        if (Number.isFinite(left.fadeInSec)) {
            merged.fadeInSec = left.fadeInSec;
        }
        if (Number.isFinite(right.fadeOutSec)) {
            merged.fadeOutSec = right.fadeOutSec;
        }

        segments.splice(first, last - first + 1, merged);
        if (
            !setTrackSegments(track, segments, {
                silent: true,
                skipUndo: !!(o && o.skipUndo),
            })
        ) {
            if (!o.silent) {
                writeLog('Playback region: join not applied');
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint('Region', 'Not joined', 'notice');
                }
            }
            return false;
        }
        noteRegionShrinkPersistIntent(track.slot);
        return true;
    }

    function notifyRegionsJoined(track, joinedCount, remainingCount, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.silent) return;
        const joinMsg =
            formatExTrack(track.slot) +
            ' joined ' +
            joinedCount +
            ' region(s) (' +
            remainingCount +
            ' left)';
        if (typeof logRegionAction === 'function') {
            logRegionAction(joinMsg);
        } else {
            writeLog(
                'Ex ' +
                    (track.slot + 1) +
                    ': ' +
                    joinedCount +
                    ' regions joined (' +
                    remainingCount +
                    ' left)',
            );
        }
        if (typeof flashSeekHint === 'function') {
            const hint =
                joinedCount >= 2
                    ? joinedCount + ' regions joined'
                    : 'Regions joined';
            flashSeekHint('Ex ' + (track.slot + 1), hint, 'notice');
        }
    }

    /** 選択範囲 lo..hi の連続リージョンをまとめて結合する。 */
    function joinConsecutiveRegionSpanAt(track, lo, hi, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const first = lo | 0;
        const last = hi | 0;
        if (last <= first) return false;

        const joinedCount = last - first + 1;
        if (joinedCount === 2) {
            return joinSegmentBoundaryAt(track, first, o);
        }

        for (let b = first; b < last; b++) {
            if (!isSegmentBoundaryJoinableAtIndex(track, b)) {
                if (!o.silent) {
                    notifyCannotJoinSegmentBoundary(track, b);
                }
                return false;
            }
        }

        if (!regionUndoPaused && !o.skipUndo) {
            const includePhrase =
                typeof getMusicalGridPhraseFillVisible === 'function' &&
                getMusicalGridPhraseFillVisible();
            requestRegionUndoCapture({ includePhrase: !!includePhrase });
        }

        const chainOpt = {
            ...o,
            silent: true,
            skipClearSelection: true,
            skipUndo: true,
        };

        if (
            !(o.skipPhraseRelayout) &&
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible() &&
            typeof window.joinPhraseAtRegionSpan === 'function' &&
            window.joinPhraseAtRegionSpan(track, first, last, chainOpt)
        ) {
            if (!(o.skipClearSelection) && typeof clearRegionSelection === 'function') {
                clearRegionSelection();
            }
            const remaining =
                typeof getTrackSegments === 'function'
                    ? getTrackSegments(track).length
                    : joinedCount;
            notifyRegionsJoined(track, joinedCount, remaining, o);
            return true;
        }

        if (!mergeSegmentSpanAt(track, first, last, chainOpt)) {
            return false;
        }

        if (!(o.skipClearSelection) && typeof clearRegionSelection === 'function') {
            clearRegionSelection();
        }
        notifyRegionsJoined(track, joinedCount, getTrackSegments(track).length, o);
        return true;
    }

    function canRejoinVolumeSplitBoundaryAt(track, boundaryIndex) {
        if (
            typeof isSegmentSourceContinuousAtBoundary !== 'function' ||
            !isSegmentSourceContinuousAtBoundary(track, boundaryIndex)
        ) {
            return false;
        }
        const leftGain = getSegmentGainDb(track, boundaryIndex);
        const rightGain = getSegmentGainDb(track, boundaryIndex + 1);
        return Math.abs(leftGain) < 0.0005 && Math.abs(rightGain) < 0.0005;
    }

    /** 音量リセット後、音量分離で切った結合可能な境界だけをつなぎ直す */
    function tryRejoinVolumeSplitBoundariesAtSegment(track, segmentIndex, opt) {
        if (!isExtraTrackRef(track)) return false;
        let idx = segmentIndex;
        if (!Number.isFinite(idx) || idx < 0) return false;
        let joined = false;
        const joinOpt = {
            silent: true,
            skipUndo: !!(opt && opt.skipUndo),
        };
        if (canRejoinVolumeSplitBoundaryAt(track, idx)) {
            if (joinSegmentBoundaryAt(track, idx, joinOpt)) {
                joined = true;
            }
        }
        const leftBoundary = idx - 1;
        if (leftBoundary >= 0 && canRejoinVolumeSplitBoundaryAt(track, leftBoundary)) {
            if (joinSegmentBoundaryAt(track, leftBoundary, joinOpt)) {
                joined = true;
            }
        }
        return joined;
    }

    function joinedBoundaryPointerHitSec() {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        let hitSec = 0.05;
        if (master > 0) {
            const lanes =
                typeof getWaveformLanesEl === 'function' ? getWaveformLanesEl() : null;
            const m =
                typeof waveformTimelineMetrics === 'function' && lanes
                    ? waveformTimelineMetrics(lanes)
                    : null;
            if (m && m.scrubW > 0) {
                hitSec = (12 / m.scrubW) * master;
            }
        }
        return hitSec;
    }

    /** Phrase オフ — リージョン本体クリックでも境界ドラッグを拾う幅（px） */
    function movableSplitBoundaryPointerHitSec() {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        let hitSec = 0.08;
        if (master > 0) {
            const lanes =
                typeof getWaveformLanesEl === 'function' ? getWaveformLanesEl() : null;
            const m =
                typeof waveformTimelineMetrics === 'function' && lanes
                    ? waveformTimelineMetrics(lanes)
                    : null;
            if (m && m.scrubW > 0) {
                hitSec = (18 / m.scrubW) * master;
            }
        }
        return hitSec;
    }

    function splitBoundaryAtPointerHitSec(track, boundaryIndex) {
        const movable =
            typeof isSegmentMovableSplitBoundary === 'function' &&
            isSegmentMovableSplitBoundary(track, boundaryIndex);
        const joined =
            typeof isSegmentBoundaryJoined === 'function' &&
            isSegmentBoundaryJoined(track, boundaryIndex);
        if (!movable && !joined) return 0;
        let hitSec = 0;
        if (movable) hitSec = Math.max(hitSec, movableSplitBoundaryPointerHitSec());
        if (joined) hitSec = Math.max(hitSec, joinedBoundaryPointerHitSec());
        return hitSec;
    }

    /** スプリット境界付近クリック — { slot, boundaryIndex } */
    function resolveSplitBoundaryPointerHit(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
        const slot =
            typeof waveformExtraLaneSlotFromClientY === 'function'
                ? waveformExtraLaneSlotFromClientY(clientY)
                : typeof extraLaneSlotFromClientY === 'function'
                  ? extraLaneSlotFromClientY(clientY)
                  : -1;
        if (slot < 0) return null;
        const track = { type: 'extra', slot };
        const segments = getTrackSegments(track);
        if (segments.length < 2) return null;
        const transportSec =
            typeof transportSecFromClientX === 'function'
                ? transportSecFromClientX(clientX)
                : NaN;
        if (!Number.isFinite(transportSec)) return null;
        let bestB = -1;
        let bestDist = Infinity;
        for (let b = 0; b < segments.length - 1; b++) {
            const hitSec = splitBoundaryAtPointerHitSec(track, b);
            if (!(hitSec > 0)) continue;
            const leftEnd = getSegmentTimelineEnd(track, b);
            const rightStart = getSegmentTimelineStart(track, b + 1);
            const splitT = (leftEnd + rightStart) * 0.5;
            const dist = Math.min(
                Math.abs(transportSec - leftEnd),
                Math.abs(transportSec - rightStart),
                Math.abs(transportSec - splitT),
            );
            if (dist <= hitSec && dist < bestDist) {
                bestDist = dist;
                bestB = b;
            }
        }
        if (bestB < 0) return null;
        return { slot, boundaryIndex: bestB };
    }

    function isPointerOnSplitHandleAtPointer(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        const el =
            typeof document.elementFromPoint === 'function'
                ? document.elementFromPoint(clientX, clientY)
                : null;
        return !!(el && el.closest && el.closest('.audio-waveform-lane__playback-region__handle--split'));
    }

    function findSplitHandleEl(track, boundaryIndex) {
        const container =
            typeof getPlaybackRegionsContainerEl === 'function'
                ? getPlaybackRegionsContainerEl(track)
                : null;
        if (!container) return null;
        return container.querySelector(
            '.audio-waveform-lane__playback-region__handle--split[data-boundary-index="' +
                boundaryIndex +
                '"]',
        );
    }

    function syncPhraseBoundaryDeferForPointer(clientX, clientY) {
        if (typeof syncPhraseBoundaryDeferToRegionHandles !== 'function') return;
        const forceOff =
            typeof window.isRegionHandleHitDebugEnabled === 'function' &&
            window.isRegionHandleHitDebugEnabled();
        if (forceOff) {
            syncPhraseBoundaryDeferToRegionHandles(true);
            return;
        }
        let defer = false;
        if (
            typeof isPointerInRegionEwCursorHitZone === 'function' &&
            isPointerInRegionEwCursorHitZone(clientX, clientY)
        ) {
            defer = true;
        } else if (
            typeof resolveRegionResizeHandleAtPointer === 'function' &&
            Number.isFinite(clientX) &&
            Number.isFinite(clientY)
        ) {
            const n = typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
            for (let slot = 0; slot < n && !defer; slot++) {
                const hit = resolveRegionResizeHandleAtPointer(
                    { type: 'extra', slot },
                    clientX,
                    clientY,
                );
                defer = !!hit;
            }
        }
        syncPhraseBoundaryDeferToRegionHandles(defer);
    }

    /** lanes capture — Fade/In/Out（pointer-events なし／Phrase 境界より先に幾何ヒット） */
    function tryBeginRegionHandleDragFromPointer(ev) {
        if (!ev || ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
        if (!Number.isFinite(ev.clientX) || !Number.isFinite(ev.clientY)) return false;
        syncPhraseBoundaryDeferForPointer(ev.clientX, ev.clientY);

        const n = typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        let bestHit = null;
        let bestRank = Infinity;
        let bestDist = Infinity;
        for (let slot = 0; slot < n; slot++) {
            const lane = document.getElementById('extraAudioLane' + slot);
            if (!lane || lane.hidden) continue;
            const laneRect = lane.getBoundingClientRect();
            if (
                ev.clientY < laneRect.top ||
                ev.clientY > laneRect.bottom ||
                ev.clientX < laneRect.left ||
                ev.clientX > laneRect.right
            ) {
                continue;
            }
            const track = { type: 'extra', slot };
            const hit = resolveRegionResizeHandleAtPointer(
                track,
                ev.clientX,
                ev.clientY,
            );
            if (!hit) continue;
            const rank =
                hit.kind === 'fade-in' || hit.kind === 'fade-out'
                    ? 0
                    : hit.kind === 'in' || hit.kind === 'out'
                      ? 1
                      : 2;
            let dist = Infinity;
            if (hit.regionEl && typeof hit.regionEl.getBoundingClientRect === 'function') {
                const r = hit.regionEl.getBoundingClientRect();
                dist = Math.hypot(
                    ev.clientX - (r.left + r.width * 0.5),
                    ev.clientY - (r.top + r.height * 0.5),
                );
            }
            if (
                rank < bestRank ||
                (rank === bestRank && dist < bestDist)
            ) {
                bestRank = rank;
                bestDist = dist;
                bestHit = Object.assign({ track }, hit);
            }
        }
        if (!bestHit) return false;
        onRegionHandlePointerDown(
            ev,
            bestHit.track,
            bestHit.segmentIndex,
            bestHit.kind,
            { regionEl: bestHit.regionEl },
        );
        return true;
    }

    function tryBeginRegionFadeHandleDragFromPointer(ev) {
        return tryBeginRegionHandleDragFromPointer(ev);
    }

    /** lanes capture — スプリットハンドル上のみ境界ドラッグ（リージョン本体の平行移動と競合しない） */
    function tryBeginSplitBoundaryDragFromPointer(ev) {
        if (!ev || ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
        const splitEl =
            ev.target &&
            ev.target.closest &&
            ev.target.closest('.audio-waveform-lane__playback-region__handle--split');
        if (!splitEl) return false;
        const boundaryIndex = Number(splitEl.dataset.boundaryIndex);
        if (!Number.isFinite(boundaryIndex) || boundaryIndex < 0) return false;
        const container = splitEl.closest('.audio-waveform-lane__playback-regions');
        const trackKey = container && container.getAttribute('data-track');
        const track = typeof parseTrackKey === 'function' ? parseTrackKey(trackKey) : null;
        if (!track) return false;
        onSplitHandlePointerDown(ev, track, boundaryIndex, splitEl, {
            keepPropagation: true,
        });
        return true;
    }

    function segmentBoundaryPointerHitDistanceSec(track, boundaryIndex, transportSec) {
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return Infinity;
        const leftEnd = getSegmentTimelineEnd(track, boundaryIndex);
        const rightStart = getSegmentTimelineStart(track, boundaryIndex + 1);
        if (
            typeof isSegmentBoundaryJoined === 'function' &&
            isSegmentBoundaryJoined(track, boundaryIndex)
        ) {
            return Math.min(Math.abs(t - leftEnd), Math.abs(t - rightStart));
        }
        const leftPlay = getSegmentPlaybackTimelineStart(track, boundaryIndex);
        const rightPlay = getSegmentPlaybackTimelineStart(track, boundaryIndex + 1);
        const overlapStart = Math.max(leftPlay, rightPlay);
        const overlapEnd = Math.min(
            leftEnd,
            getSegmentTimelineEnd(track, boundaryIndex + 1),
        );
        const minOverlap =
            typeof window.MIN_CROSSFADE_OVERLAP_SEC === 'number'
                ? window.MIN_CROSSFADE_OVERLAP_SEC
                : 0.005;
        if (overlapEnd - overlapStart >= minOverlap) {
            if (t >= overlapStart && t <= overlapEnd) return 0;
        }
        return Math.min(Math.abs(t - leftEnd), Math.abs(t - rightStart));
    }

    function isSegmentBoundaryEligibleForResolve(track, boundaryIndex, joinableOnly) {
        if (
            joinableOnly &&
            typeof isSegmentBoundaryJoinableAtIndex === 'function' &&
            !isSegmentBoundaryJoinableAtIndex(track, boundaryIndex)
        ) {
            return false;
        }
        return true;
    }

    function resolveSegmentBoundaryIndexAtTransport(track, transportSec, joinableOnly) {
        if (!isExtraTrackRef(track)) return -1;
        const segments = getTrackSegments(track);
        if (segments.length < 2) return -1;
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return -1;
        const hitSec = joinedBoundaryPointerHitSec();
        let bestB = -1;
        let bestDist = Infinity;
        for (let b = 0; b < segments.length - 1; b++) {
            if (!isSegmentBoundaryEligibleForResolve(track, b, joinableOnly)) continue;
            const dist = segmentBoundaryPointerHitDistanceSec(track, b, t);
            if (dist <= hitSec && dist < bestDist) {
                bestDist = dist;
                bestB = b;
            }
        }
        return bestB;
    }

    function resolveSegmentBoundaryIndexAtPointer(track, clientX, clientY, joinableOnly) {
        if (!isExtraTrackRef(track)) return -1;
        const segments = getTrackSegments(track);
        if (segments.length < 2) return -1;

        if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
            const hit = document.elementFromPoint(clientX, clientY);
            if (hit) {
                const splitHandle = hit.closest(
                    '.audio-waveform-lane__playback-region__handle--split',
                );
                if (splitHandle) {
                    const lane = splitHandle.closest('.audio-waveform-lane--extra');
                    const m =
                        lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
                    if (m && parseInt(m[1], 10) === track.slot) {
                        const b = Number(splitHandle.dataset.boundaryIndex);
                        if (
                            Number.isFinite(b) &&
                            b >= 0 &&
                            b < segments.length - 1 &&
                            isSegmentBoundaryEligibleForResolve(track, b, joinableOnly)
                        ) {
                            return b;
                        }
                    }
                }
                if (!joinableOnly) {
                    const crossfadeMarker = hit.closest(
                        '.audio-waveform-lane__crossfade-marker',
                    );
                    if (crossfadeMarker) {
                        const lane = crossfadeMarker.closest('.audio-waveform-lane--extra');
                        const m =
                            lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
                        if (m && parseInt(m[1], 10) === track.slot) {
                            const transportSec =
                                typeof transportSecFromClientX === 'function'
                                    ? transportSecFromClientX(clientX)
                                    : null;
                            if (Number.isFinite(transportSec)) {
                                const b = resolveSegmentBoundaryIndexAtTransport(
                                    track,
                                    transportSec,
                                    false,
                                );
                                if (b >= 0) return b;
                            }
                        }
                    }
                }
            }
        }

        const transportSec =
            Number.isFinite(clientX) && typeof transportSecFromClientX === 'function'
                ? transportSecFromClientX(clientX)
                : null;
        if (Number.isFinite(transportSec)) {
            return resolveSegmentBoundaryIndexAtTransport(
                track,
                transportSec,
                joinableOnly,
            );
        }
        return -1;
    }

    function setSegmentHandleFromTransport(track, segmentIndex, kind, transportSec, opt) {
        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        if (!segments[segmentIndex]) return;
        const seg = segments[segmentIndex];
        if (kind === 'fade-in') {
            const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
            const maxDur = getSegmentFadeDurationLimit(track, segmentIndex, 'in');
            if (!(maxDur > 0.0005)) return;
            const t = Math.max(playbackStart, Math.min(playbackStart + maxDur, Number(transportSec) || 0));
            const skipUndo = !opt || opt.skipUndo !== false;
            setSegmentFadeDurationSec(track, segmentIndex, 'in', t - playbackStart, {
                skipUndo,
                geometryOnly: !!(opt && opt.geometryOnly),
            });
            return;
        }
        if (kind === 'fade-out') {
            const playbackEnd = getSegmentTimelineEnd(track, segmentIndex);
            const maxDur = getSegmentFadeDurationLimit(track, segmentIndex, 'out');
            if (!(maxDur > 0.0005)) return;
            const minT = playbackEnd - maxDur;
            const t = Math.max(minT, Math.min(playbackEnd, Number(transportSec) || 0));
            const skipUndo = !opt || opt.skipUndo !== false;
            setSegmentFadeDurationSec(track, segmentIndex, 'out', playbackEnd - t, {
                skipUndo,
                geometryOnly: !!(opt && opt.geometryOnly),
            });
            return;
        }
        const clipDur = getSegmentSourceDurationSec(track, seg);
        const snapOpt = {
            exclude: { slot: track.slot, segmentIndex },
        };
        const t = snapRegionHandleTransportSec(transportSec, snapOpt);
        if (!Number.isFinite(t)) return;

        if (kind === 'in') {
            const splitB = resolveSplitBoundaryIndexForHandleDrag(
                track,
                segmentIndex,
                kind,
                segments.length,
            );
            if (splitB >= 0) {
                setSplitBoundaryFromTransport(track, splitB, t, opt);
                return;
            }
            applySegmentRegionInFromTransport(track, segmentIndex, t, opt);
            return;
        } else if (kind === 'out') {
            const splitB = resolveSplitBoundaryIndexForHandleDrag(
                track,
                segmentIndex,
                kind,
                segments.length,
            );
            if (splitB >= 0) {
                setSplitBoundaryFromTransport(track, splitB, t, opt);
                return;
            }
            const timelineStartSeg = getSegmentTimelineStart(track, segmentIndex);
            const maxEnd = maxSegmentTimelineEndSec(track, segmentIndex);
            let timelineEnd = Math.max(
                timelineStartSeg + PLAYBACK_REGION_MIN_SEC,
                Math.min(maxEnd, t),
            );
            timelineEnd = clampSegmentTimelineEnd(track, segmentIndex, timelineEnd);
            syncRegionOutDragTimelineExtent(track, segmentIndex, timelineEnd);
            const dur = Math.max(PLAYBACK_REGION_MIN_SEC, timelineEnd - timelineStartSeg);
            const newOut = Math.min(
                clipDur,
                Math.max(
                    seg.sourceInSec + PLAYBACK_REGION_MIN_SEC,
                    seg.sourceInSec + dur,
                ),
            );
            if (Math.abs(newOut - seg.sourceOutSec) < 0.00001 && t > timelineStartSeg + dur + 0.01) {
                return;
            }
            seg.sourceOutSec = newOut;
        } else {
            return;
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

    const REGION_IN_MIN_TRANSPORT_SEC = 0;

    /** リージョン In オフセットを保ったままクリップ全体をタイムライン上で平行移動（アンカー負値＝TC0より手前に食い込み可） */
    function moveSegmentClipByTimelineDelta(track, segmentIndex, delta, opt) {
        if (!Number.isFinite(delta) || Math.abs(delta) < 0.00001) return;
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return;
        const t0 = getTrackTimelineStartSec(track);
        const oldAnchor = getSegmentTimelineStart(track, segmentIndex);
        const oldRegionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const baseRegionIn =
            opt && Number.isFinite(opt.dragStartRegionIn)
                ? opt.dragStartRegionIn
                : oldRegionIn;
        const baseAnchor =
            opt && Number.isFinite(opt.dragStartAnchor)
                ? opt.dragStartAnchor
                : oldAnchor;
        const seg = state.segments[segmentIndex];
        const segDur = Math.max(
            PLAYBACK_REGION_MIN_SEC,
            seg.sourceOutSec - seg.sourceInSec,
        );
        if (baseRegionIn + delta < REGION_IN_MIN_TRANSPORT_SEC - 0.00001) {
            delta = REGION_IN_MIN_TRANSPORT_SEC - baseRegionIn;
        }
        if (Math.abs(delta) < 0.00001) return;
        let newAnchor = baseAnchor + delta;
        let newRegionIn = baseRegionIn + delta;
        const isParallelMove =
            opt &&
            Number.isFinite(opt.dragStartRegionIn) &&
            Number.isFinite(opt.dragStartAnchor);
        if (!isParallelMove) {
            const maxRegionIn = newAnchor + segDur - PLAYBACK_REGION_MIN_SEC;
            const minPlayIn = newAnchor + PLAYBACK_REGION_MIN_SEC;
            newRegionIn = Math.max(
                REGION_IN_MIN_TRANSPORT_SEC,
                minPlayIn,
                Math.min(maxRegionIn, newRegionIn),
            );
        } else {
            newRegionIn = Math.max(REGION_IN_MIN_TRANSPORT_SEC, newRegionIn);
        }
        if (
            Math.abs(newAnchor - oldAnchor) < 0.00001 &&
            Math.abs(newRegionIn - oldRegionIn) < 0.00001
        ) {
            return;
        }
        applySegmentAnchorAndRegionInForDrag(
            track,
            segmentIndex,
            newAnchor,
            newRegionIn,
            t0,
            Math.max(0, newRegionIn - newAnchor),
        );
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
        if (opt && opt.geometryOnly) {
            const needsCfAudio =
                typeof needsCrossfadeWaveformPreviewDuringGeometryDrag ===
                    'function' &&
                needsCrossfadeWaveformPreviewDuringGeometryDrag(track.slot, {
                    segmentIndex,
                    geometryOnly: true,
                });
            if (needsCfAudio && typeof syncExtraAudioToTransport === 'function') {
                syncExtraAudioToTransport({ force: true });
                if (typeof applyReviewMixCrossfadeGainsIfNeeded === 'function') {
                    applyReviewMixCrossfadeGainsIfNeeded();
                }
            }
        } else if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: !!(opt && opt.forceAudio) });
        }
    }

    /** グループ: 全メンバーへ同じ delta を適用（個別スナップでずれないよう skipSnap） */
    function applyRegionGroupMoveDelta(members, delta, opt) {
        if (!members || !members.length || !Number.isFinite(delta)) return;
        const startRegionInByKey = (opt && opt.startRegionInByKey) || null;
        const startAnchorByKey = (opt && opt.startAnchorByKey) || null;
        for (let i = 0; i < members.length; i++) {
            const m = members[i];
            const track = { type: 'extra', slot: m.slot };
            const key = regionGroupMemberKey(m.slot, m.segmentIndex);
            const dragStartRegionIn =
                startRegionInByKey && Number.isFinite(startRegionInByKey[key])
                    ? startRegionInByKey[key]
                    : getSegmentRegionTimelineIn(track, m.segmentIndex);
            const dragStartAnchor =
                startAnchorByKey && Number.isFinite(startAnchorByKey[key])
                    ? startAnchorByKey[key]
                    : getSegmentTimelineStart(track, m.segmentIndex);
            moveSegmentClipByTimelineDelta(track, m.segmentIndex, delta, {
                dragStartRegionIn,
                dragStartAnchor,
                skipPersist: !!(opt && opt.skipPersist),
                forceAudio: !!(opt && opt.forceAudio),
                skipUndo: !!(opt && opt.skipUndo),
                geometryOnly: !!(opt && opt.geometryOnly),
            });
        }
    }

    function setSegmentTimelineStartSec(track, segmentIndex, sec, opt) {
        if (!isExtraTrackRef(track)) return;
        if (!(opt && opt.skipUndo) && !regionUndoPaused) {
            requestRegionUndoCapture();
        }
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return;
        const dragStartRegionIn =
            opt && Number.isFinite(opt.dragStartRegionIn)
                ? opt.dragStartRegionIn
                : getSegmentRegionTimelineIn(track, segmentIndex);
        let desiredRegionIn;
        if (opt && opt.skipSnap) {
            desiredRegionIn = snapTimelineSec(Number(sec) || 0, opt);
        } else {
            desiredRegionIn = snapRegionMoveRegionInSec(sec, track, segmentIndex, {
                exclude: { slot: track.slot, segmentIndex },
                dragStartRegionIn: opt && opt.dragStartRegionIn,
                dragStartAnchor: opt && opt.dragStartAnchor,
            });
        }
        if (
            !isParallelRegionOffsetDragOpt(opt) &&
            segmentIndex > 0 &&
            typeof isSegmentBoundaryJoined === 'function' &&
            !isSegmentBoundaryJoined(track, segmentIndex - 1) &&
            Math.abs(desiredRegionIn - dragStartRegionIn) > 0.00001
        ) {
            if (desiredRegionIn < REGION_IN_MIN_TRANSPORT_SEC - 0.00001) {
                desiredRegionIn = REGION_IN_MIN_TRANSPORT_SEC;
            }
            applySegmentRegionInFromTransport(track, segmentIndex, desiredRegionIn, opt);
            return;
        }
        const delta = desiredRegionIn - dragStartRegionIn;
        if (dragStartRegionIn + delta < REGION_IN_MIN_TRANSPORT_SEC - 0.00001) {
            desiredRegionIn = REGION_IN_MIN_TRANSPORT_SEC;
        }
        moveSegmentClipByTimelineDelta(
            track,
            segmentIndex,
            desiredRegionIn - dragStartRegionIn,
            opt,
        );
    }

    function resolveRegionSegmentFromPointer(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;

        if (
            typeof isPointerInRegionEwCursorHitZoneExcludingSplit === 'function' &&
            isPointerInRegionEwCursorHitZoneExcludingSplit(clientX, clientY)
        ) {
            return null;
        }
        if (isPointerOnSplitHandleAtPointer(clientX, clientY)) {
            return null;
        }

        const slotFromY =
            typeof waveformExtraLaneSlotFromClientY === 'function'
                ? waveformExtraLaneSlotFromClientY(clientY)
                : extraLaneSlotFromClientY(clientY);
        if (slotFromY >= 0) {
            const master =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : 0;
            const t0 =
                typeof getTrackTimelineStartSec === 'function'
                    ? getTrackTimelineStartSec({ type: 'extra', slot: slotFromY })
                    : 0;
            if (master > 0 && t0 > 0.0005) {
                const lanes =
                    typeof waveformScrubTargetEl === 'function'
                        ? waveformScrubTargetEl()
                        : getWaveformLanesEl();
                const m =
                    typeof waveformTimelineMetrics === 'function'
                        ? waveformTimelineMetrics(lanes)
                        : null;
                const inner =
                    typeof waveformTimelineInnerEl === 'function'
                        ? waveformTimelineInnerEl()
                        : null;
                const ref = inner || lanes;
                if (m && m.scrubW && ref) {
                    const x0 =
                        ref.getBoundingClientRect().left + (t0 / master) * m.scrubW;
                    if (clientX < x0 - 1) return null;
                }
            }
        }

        let slot = -1;
        let segmentIndex = -1;
        let regionEl = null;

        if (slotFromY >= 0) {
            const handleHit = resolveRegionResizeHandleAtPointer(
                { type: 'extra', slot: slotFromY },
                clientX,
                clientY,
            );
            if (handleHit) return null;
        }

        if (typeof findPlaybackRegionElAtPointer === 'function') {
            regionEl = findPlaybackRegionElAtPointer(clientX, clientY);
            if (regionEl) {
                const lane = regionEl.closest('.audio-waveform-lane--extra');
                const m = lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
                if (m) {
                    slot = parseInt(m[1], 10);
                    segmentIndex = Number(regionEl.dataset.segmentIndex);
                }
            }
        }
        if (!regionEl) {
            const hit = document.elementFromPoint(clientX, clientY);
            if (hit) {
                if (hit.closest('.audio-waveform-lane__playback-region__handle--split')) {
                    return null;
                }
                regionEl = hit.closest('.audio-waveform-lane__playback-region');
                if (regionEl) {
                    const lane = regionEl.closest('.audio-waveform-lane--extra');
                    const m = lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
                    if (m) {
                        slot = parseInt(m[1], 10);
                        segmentIndex = Number(regionEl.dataset.segmentIndex);
                    }
                }
            }
        }

        if (slot < 0 && typeof waveformExtraLaneSlotFromClientY === 'function') {
            slot = waveformExtraLaneSlotFromClientY(clientY);
        }
        if (slot < 0) return null;

        const track = { type: 'extra', slot };
        const count = getSegmentCount(track);
        if (count < 1) return null;

        const t0 = getTrackTimelineStartSec(track);
        const clickTransportSec =
            typeof transportSecFromClientX === 'function'
                ? transportSecFromClientX(clientX)
                : null;
        if (
            Number.isFinite(clickTransportSec) &&
            Number.isFinite(t0) &&
            clickTransportSec < t0 - 0.0005
        ) {
            return null;
        }
        if (
            Number.isFinite(clickTransportSec) &&
            typeof resolveSilentGapListIndexAtTransport === 'function' &&
            resolveSilentGapListIndexAtTransport(track, clickTransportSec) >= 0
        ) {
            return null;
        }

        if (!Number.isFinite(segmentIndex) || segmentIndex < 0) {
            if (count === 1) {
                if (!isTrackRegionActive(track)) return null;
                segmentIndex = 0;
                if (!regionEl) {
                    const transportSec =
                        typeof transportSecFromClientX === 'function'
                            ? transportSecFromClientX(clientX)
                            : null;
                    if (!Number.isFinite(transportSec)) return null;
                    const start = getSegmentRegionTimelineIn(track, 0);
                    const end = getSegmentTimelineEnd(track, 0);
                    if (
                        !(
                            transportSec >= start - 0.0005 &&
                            transportSec < end - 0.002
                        )
                    ) {
                        return null;
                    }
                }
            } else {
                const transportSec =
                    typeof transportSecFromClientX === 'function'
                        ? transportSecFromClientX(clientX)
                        : null;
                if (!Number.isFinite(transportSec)) return null;
                for (let i = 0; i < count; i++) {
                    const start = getSegmentRegionTimelineIn(track, i);
                    const end = getSegmentTimelineEnd(track, i);
                    if (transportSec >= start - 0.0005 && transportSec < end - 0.002) {
                        segmentIndex = i;
                        break;
                    }
                }
                if (segmentIndex < 0) return null;
            }
        }

        return { slot, segmentIndex, track };
    }

    function resolveMixTargetFromActiveRegion(clientX, clientY) {
        void clientX;
        if (typeof resolveMixTargetFromPointer === 'function') {
            return resolveMixTargetFromPointer(clientY);
        }
        return null;
    }

    function handlePlaybackRegionMixKeydown(e) {
        const isSolo = matchUserShortcut(e, 'mixLaneSoloToggle');
        const isMute = matchUserShortcut(e, 'mixLaneMuteToggle');
        const isMuteClearAll = matchUserShortcut(e, 'mixLaneMuteClearAll');
        const isSoloMute = isSolo || isMute || isMuteClearAll;
        if (!isSoloMute) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        if (isMuteClearAll) {
            e.preventDefault();
            if (typeof window.clearAllMixMute === 'function') {
                window.clearAllMixMute();
                return true;
            }
            return false;
        }

        let clientX = null;
        let clientY = null;
        if (typeof getWaveformLanesPointerClientX === 'function') {
            clientX = getWaveformLanesPointerClientX();
        }
        if (typeof getWaveformLanesPointerClientY === 'function') {
            clientY = getWaveformLanesPointerClientY();
        }
        if (clientX == null && typeof getWaveformPointerClientX === 'function') {
            clientX = getWaveformPointerClientX();
        }
        if (clientY == null && typeof getWaveformPointerClientY === 'function') {
            clientY = getWaveformPointerClientY();
        }

        const idx =
            typeof window.resolveActiveMixLaneDisplayIndex === 'function'
                ? window.resolveActiveMixLaneDisplayIndex(clientX, clientY)
                : -1;
        if (idx < 0) return false;

        e.preventDefault();
        if (isSolo) {
            if (typeof window.soloOnlyMixByDisplayIndex === 'function') {
                window.soloOnlyMixByDisplayIndex(idx);
                return true;
            }
            return false;
        }
        if (isMute) {
            if (typeof window.toggleMixMuteByDisplayIndex === 'function') {
                window.toggleMixMuteByDisplayIndex(idx);
                return true;
            }
            return false;
        }
        return false;
    }

    function beginRegionOutDragTimelineExtend() {
        regionOutDragExtendSlot = -1;
        regionOutDragExtentSec = NaN;
    }

    function endRegionOutDragTimelineExtend() {
        regionOutDragStartOutTransportSec = NaN;
        regionOutDragStartMasterSec = NaN;
        regionOutDragStartScrubW = NaN;
        regionOutDragStartScrubRatio = NaN;
        regionOutDragExtentSec = NaN;
        if (regionOutDragExtendSlot < 0) return;
        regionOutDragExtendSlot = -1;
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
    }

    /** ドラッグ中のマスター終端をハンドル位置に追従（クリップ最大長まで一気に伸ばさない） */
    function syncRegionOutDragTimelineExtent(track, segmentIndex, timelineEndSec) {
        if (!track || segmentIndex < 0 || !(timelineEndSec > 0)) return;
        const maxEnd = getExtraTrackMaxTimelineEndSec(track);
        const projected = projectedTrackTimelineEndSec(
            track,
            segmentIndex,
            timelineEndSec,
        );
        const prev = regionOutDragExtentSec;

        if (regionOutDragExtendSlot === track.slot && projected < prev - 0.01) {
            regionOutDragExtentSec = projected;
            if (projected <= getTrackTimelineEndSec(track) + 0.01) {
                regionOutDragExtendSlot = -1;
                regionOutDragExtentSec = NaN;
            }
            if (typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
            return;
        }

        if (timelineEndSec <= getTrackTimelineEndSec(track) + 0.01) {
            if (regionOutDragExtendSlot === track.slot) {
                regionOutDragExtendSlot = -1;
                regionOutDragExtentSec = NaN;
                if (typeof notifyMasterTransportDurationChanged === 'function') {
                    notifyMasterTransportDurationChanged();
                }
            }
            return;
        }

        const next = Math.min(
            maxEnd > 0 ? maxEnd : timelineEndSec,
            Math.max(timelineEndSec, projected),
        );
        regionOutDragExtendSlot = track.slot;
        regionOutDragExtentSec = next;
        if (!(prev > 0) || Math.abs(next - prev) > 0.01) {
            if (typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
        }
    }

    function transportSecFromRegionOutDragDelta(clientX) {
        if (
            !Number.isFinite(regionOutDragStartOutTransportSec) ||
            !Number.isFinite(regionOutDragStartScrubRatio) ||
            !(regionOutDragStartScrubW > 0) ||
            !(regionOutDragStartMasterSec > 0)
        ) {
            return typeof transportSecFromClientX === 'function'
                ? transportSecFromClientX(clientX)
                : 0;
        }
        const ratioNow = scrubRatioUnclampedFromClientX(
            clientX,
            regionOutDragStartScrubW,
        );
        let sec =
            regionOutDragStartOutTransportSec +
            (ratioNow - regionOutDragStartScrubRatio) * regionOutDragStartMasterSec;
        if (regionHandleDragTrack && regionHandleDragSegmentIndex >= 0) {
            const timelineStart = getSegmentTimelineStart(
                regionHandleDragTrack,
                regionHandleDragSegmentIndex,
            );
            const maxEnd = maxSegmentTimelineEndSec(
                regionHandleDragTrack,
                regionHandleDragSegmentIndex,
            );
            sec = Math.max(
                timelineStart + PLAYBACK_REGION_MIN_SEC,
                Math.min(maxEnd, sec),
            );
        }
        return sec;
    }

    function detachRegionHandleDragDocListeners() {
        if (regionHandleDragDocMove) {
            document.removeEventListener('pointermove', regionHandleDragDocMove);
            regionHandleDragDocMove = null;
        }
        if (regionHandleDragDocUp) {
            document.removeEventListener('pointerup', regionHandleDragDocUp);
            document.removeEventListener('pointercancel', regionHandleDragDocUp);
            regionHandleDragDocUp = null;
        }
    }

    function endRegionHandleDrag(opt) {
        const dragTrack = regionHandleDragTrack;
        const dragSegmentIndex = regionHandleDragSegmentIndex;
        const dragBoundaryIndex = regionHandleDragBoundaryIndex;
        const dragKind = regionHandleDragKind;
        const wasSplitBoundary =
            dragKind === 'split' || regionHandleDragSplitBoundary;
        const cancelled = !!(opt && opt.cancelled);
        const didMove = regionHandleDragDidMove;
        const wasPhraseBoundary = regionHandleDragPhraseBoundary;
        if (wasPhraseBoundary && cancelled) {
            finalizePhraseBoundaryDragFromRegion(true);
        }
        if (cancelled && regionUndoDragSnap) {
            restoreRegionUndoSnapshot(regionUndoDragSnap);
            cancelRegionUndoGesture();
        } else {
            commitRegionUndoGesture();
        }
        setHoveredPlaybackRegion(null);
        endRegionOutDragTimelineExtend();
        regionHandleDragActive = false;
        regionHandleDragTrack = null;
        regionHandleDragSegmentIndex = -1;
        regionHandleDragBoundaryIndex = -1;
        regionHandleDragKind = null;
        regionHandleDragSplitBoundary = false;
        clearRegionHandlePhraseBoundaryDragState();
        regionHandleDragPointerId = null;
        regionHandleDragStartClientX = NaN;
        regionHandleDragDidMove = false;
        regionHandleDragCaptureEl = null;
        detachRegionHandleDragDocListeners();
        const lanes =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        if (lanes) lanes.classList.remove('audio-waveform-composite__lanes--region-drag');
        if (dragTrack && !cancelled) {
            if (wasPhraseBoundary) {
                if (typeof refreshAllRegionMusicalMetaPresentation === 'function') {
                    refreshAllRegionMusicalMetaPresentation();
                } else if (typeof refreshAllRegionRehearsalMarkLabels === 'function') {
                    refreshAllRegionRehearsalMarkLabels();
                }
            } else if (wasSplitBoundary) {
                refreshTrackRegionOverlayGeometry(dragTrack);
                const slot = dragTrack.slot;
                if (didMove) {
                    if (
                        typeof refreshExtraTrackViewportPeaksForRegionEdit === 'function'
                    ) {
                        refreshExtraTrackViewportPeaksForRegionEdit(slot, {
                            segmentIndex:
                                dragBoundaryIndex >= 0 ? dragBoundaryIndex : undefined,
                        });
                    }
                    if (typeof drawExtraTrackWaveform === 'function') {
                        drawExtraTrackWaveform(slot);
                    }
                    if (
                        typeof scheduleWaveformHiresRedrawAfterZoom === 'function'
                    ) {
                        scheduleWaveformHiresRedrawAfterZoom({ slots: [slot] });
                    }
                }
            } else {
                updateTrackRegionOverlays(dragTrack);
                if (typeof redrawAfterRegionChange === 'function') {
                    const redrawOpt =
                        dragSegmentIndex >= 0
                            ? { segmentIndex: dragSegmentIndex }
                            : undefined;
                    redrawAfterRegionChange(dragTrack.slot, redrawOpt);
                }
                const slot = dragTrack.slot;
                if (
                    slot >= 0 &&
                    typeof scheduleWaveformHiresRedrawAfterZoom === 'function'
                ) {
                    scheduleWaveformHiresRedrawAfterZoom({ slots: [slot] });
                }
            }
        }
    }

    function onSplitHandlePointerDown(ev, track, boundaryIndex, captureElOpt, opt) {
        if (regionHandleDragActive) return;
        if (ev.button !== 0) return;
        if (typeof syncSnapSuppressionFromPointerEvent === 'function') {
            syncSnapSuppressionFromPointerEvent(ev);
        }
        if (typeof haltTransportForSessionMutation === 'function') {
            haltTransportForSessionMutation({
                silent: true,
                clearLoopAndRegion: false,
            });
        }
        ev.preventDefault();
        if (!(opt && opt.keepPropagation)) {
            ev.stopPropagation();
        }
        if (typeof endAudioWaveformScrub === 'function') {
            endAudioWaveformScrub({ force: true });
        }
        regionHandleDragActive = true;
        regionHandleDragTrack = track;
        regionHandleDragBoundaryIndex = boundaryIndex;
        regionHandleDragKind = 'split';
        regionHandleDragPointerId = ev.pointerId;
        regionHandleDragStartClientX = ev.clientX;
        regionHandleDragDidMove = false;
        regionHandleDragCaptureEl =
            captureElOpt ||
            findSplitHandleEl(track, boundaryIndex) ||
            (typeof getPlaybackRegionsContainerEl === 'function'
                ? getPlaybackRegionsContainerEl(track)
                : null);
        if (
            typeof isPhraseOffMovableSplitBoundaryEnabled === 'function' &&
            isPhraseOffMovableSplitBoundaryEnabled() &&
            typeof isSegmentMovableSplitBoundary === 'function' &&
            isSegmentMovableSplitBoundary(track, boundaryIndex)
        ) {
            regionHandleDragSplitBoundary = true;
        } else {
            regionHandleDragSplitBoundary = false;
        }
        clearRegionHandlePhraseBoundaryDragState();
        if (
            tryBeginPhraseBoundaryDragFromRegionBoundary(track, boundaryIndex)
        ) {
            regionHandleDragSplitBoundary = false;
        }
        const captureEl = regionHandleDragCaptureEl;
        if (captureEl && typeof captureEl.setPointerCapture === 'function') {
            try {
                captureEl.setPointerCapture(ev.pointerId);
            } catch (_) {}
        }
        const lanes =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        if (lanes) lanes.classList.add('audio-waveform-composite__lanes--region-drag');
        beginRegionUndoGesture();

        let splitBoundaryPrepared = false;
        regionHandleDragDocMove = (e) => {
            if (!regionHandleDragActive || e.pointerId !== regionHandleDragPointerId) return;
            if (typeof syncSnapSuppressionFromPointerEvent === 'function') {
                syncSnapSuppressionFromPointerEvent(e);
            }
            e.preventDefault();
            if (
                Number.isFinite(regionHandleDragStartClientX) &&
                Math.abs(e.clientX - regionHandleDragStartClientX) > 5
            ) {
                regionHandleDragDidMove = true;
            }
            if (regionHandleDragPhraseBoundary) {
                applyPhraseBoundaryDragFromRegionPointer(e.clientX);
                return;
            }
            if (
                !splitBoundaryPrepared &&
                regionHandleDragSplitBoundary &&
                regionHandleDragBoundaryIndex >= 0
            ) {
                prepareMovableSplitBoundaryForDrag(
                    regionHandleDragTrack,
                    regionHandleDragBoundaryIndex,
                );
                splitBoundaryPrepared = true;
            }
            const transportSec =
                typeof transportSecFromClientX === 'function'
                    ? transportSecFromClientX(e.clientX)
                    : 0;
            setSplitBoundaryFromTransport(
                regionHandleDragTrack,
                regionHandleDragBoundaryIndex,
                transportSec,
                { geometryOnly: true },
            );
        };
        regionHandleDragDocUp = (e) => {
            if (!regionHandleDragActive || e.pointerId !== regionHandleDragPointerId) return;
            e.preventDefault();
            const releaseEl = regionHandleDragCaptureEl;
            if (releaseEl && typeof releaseEl.releasePointerCapture === 'function') {
                try {
                    releaseEl.releasePointerCapture(e.pointerId);
                } catch (_) {}
            }
            const clickOnly =
                !regionHandleDragDidMove &&
                Number.isFinite(regionHandleDragStartClientX) &&
                Math.abs(e.clientX - regionHandleDragStartClientX) <= 5;
            if (clickOnly) {
                endRegionHandleDrag({ cancelled: true });
            } else {
                if (regionHandleDragPhraseBoundary) {
                    finalizePhraseBoundaryDragFromRegion(false);
                }
                endRegionHandleDrag();
                if (typeof schedulePersistSession === 'function') {
                    schedulePersistSession();
                }
            }
        };
        document.addEventListener('pointermove', regionHandleDragDocMove);
        document.addEventListener('pointerup', regionHandleDragDocUp);
        document.addEventListener('pointercancel', regionHandleDragDocUp);
    }

    function beginRegionHandleDragSession(ev, track, segmentIndex, kind, opt) {
        regionHandleDragActive = true;
        regionHandleDragTrack = track;
        regionHandleDragSegmentIndex = segmentIndex;
        regionHandleDragBoundaryIndex = -1;
        regionHandleDragKind = kind;
        regionHandleDragSplitBoundary = false;
        regionHandleDragPointerId = ev.pointerId;
        regionHandleDragStartClientX = ev.clientX;
        regionHandleDragDidMove = false;
        const o = opt && typeof opt === 'object' ? opt : {};
        const captureEl =
            o.captureEl ||
            o.regionEl ||
            (typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null);
        regionHandleDragCaptureEl = captureEl || null;
        if (captureEl && typeof captureEl.setPointerCapture === 'function') {
            try {
                captureEl.setPointerCapture(ev.pointerId);
            } catch (_) {}
        }
        const lanes =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        if (lanes) lanes.classList.add('audio-waveform-composite__lanes--region-drag');
        beginRegionUndoGesture();
        if (kind === 'out') {
            const scrubW =
                typeof waveformTimelineScrubWidthCss === 'function'
                    ? waveformTimelineScrubWidthCss()
                    : 0;
            regionOutDragStartOutTransportSec = getSegmentTimelineEnd(track, segmentIndex);
            regionOutDragStartMasterSec =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : 0;
            regionOutDragStartScrubW = scrubW;
            regionOutDragStartScrubRatio = scrubRatioUnclampedFromClientX(
                ev.clientX,
                scrubW,
            );
            beginRegionOutDragTimelineExtend();
        } else {
            regionOutDragStartOutTransportSec = NaN;
            regionOutDragStartMasterSec = NaN;
            regionOutDragStartScrubW = NaN;
            regionOutDragStartScrubRatio = NaN;
        }
    }

    function seekFromRegionHandleClick(kind, track, segmentIndex) {
        let sec =
            kind === 'in'
                ? getSegmentRegionTimelineIn(track, segmentIndex)
                : getSegmentTimelineEnd(track, segmentIndex);
        if (typeof snapRegionHandleTransportSec === 'function') {
            sec = snapRegionHandleTransportSec(sec, {
                exclude: { slot: track.slot, segmentIndex },
                sameSlotOnly: -1,
            });
        }
        if (typeof clampTransportSec === 'function') {
            sec = clampTransportSec(sec);
        }
        if (typeof suppressRangeLoopSnapForExplicitSeek === 'function') {
            suppressRangeLoopSnapForExplicitSeek();
        }
        if (typeof applyTransportAtSec === 'function') {
            applyTransportAtSec(sec, { logInput: true, flash: true, markers: true });
        }
        syncRegionNavSeekTransportUi(sec);
        if (typeof updateAllWaveformPlayheads === 'function') {
            updateAllWaveformPlayheads();
        }
    }

    function onRegionHandlePointerDown(ev, track, segmentIndex, kind, opt) {
        if (typeof syncSnapSuppressionFromPointerEvent === 'function') {
            syncSnapSuppressionFromPointerEvent(ev);
        }
        const segments = getTrackSegments(track);
        if (!segments[segmentIndex]) return;
        if (ev.button !== 0) return;
        if (typeof haltTransportForSessionMutation === 'function') {
            haltTransportForSessionMutation({
                silent: true,
                clearLoopAndRegion: false,
            });
        }
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof endAudioWaveformScrub === 'function') {
            endAudioWaveformScrub({ force: true });
        }
        const o = opt && typeof opt === 'object' ? opt : {};
        beginRegionHandleDragSession(ev, track, segmentIndex, kind, {
            ...o,
            captureEl: o.regionEl || o.captureEl,
        });
        const splitB = resolveSplitBoundaryIndexForHandleDrag(
            track,
            segmentIndex,
            kind,
            segments.length,
        );
        if (
            splitB >= 0 &&
            typeof isPhraseOffMovableSplitBoundaryEnabled === 'function' &&
            isPhraseOffMovableSplitBoundaryEnabled() &&
            typeof isSegmentMovableSplitBoundary === 'function' &&
            isSegmentMovableSplitBoundary(track, splitB)
        ) {
            regionHandleDragSplitBoundary = true;
        } else if (splitB >= 0) {
            tryBeginPhraseBoundaryDragFromRegionBoundary(track, splitB);
        }

        regionHandleDragDocMove = (e) => {
            if (!regionHandleDragActive || e.pointerId !== regionHandleDragPointerId) return;
            if (typeof syncSnapSuppressionFromPointerEvent === 'function') {
                syncSnapSuppressionFromPointerEvent(e);
            }
            e.preventDefault();
            if (
                Number.isFinite(regionHandleDragStartClientX) &&
                Math.abs(e.clientX - regionHandleDragStartClientX) > 5
            ) {
                regionHandleDragDidMove = true;
            }
            if (regionHandleDragPhraseBoundary) {
                applyPhraseBoundaryDragFromRegionPointer(e.clientX);
                return;
            }
            const transportSec =
                regionHandleDragKind === 'out'
                    ? transportSecFromRegionOutDragDelta(e.clientX)
                    : typeof transportSecFromClientX === 'function'
                      ? transportSecFromClientX(e.clientX)
                      : 0;
            setSegmentHandleFromTransport(
                regionHandleDragTrack,
                regionHandleDragSegmentIndex,
                regionHandleDragKind,
                transportSec,
                { geometryOnly: true },
            );
        };
        regionHandleDragDocUp = (e) => {
            if (!regionHandleDragActive || e.pointerId !== regionHandleDragPointerId) return;
            e.preventDefault();
            const releaseEl = regionHandleDragCaptureEl;
            if (releaseEl && typeof releaseEl.releasePointerCapture === 'function') {
                try {
                    releaseEl.releasePointerCapture(e.pointerId);
                } catch (_) {}
            } else if (typeof e.target.releasePointerCapture === 'function') {
                try {
                    e.target.releasePointerCapture(e.pointerId);
                } catch (_) {}
            }
            const clickOnly =
                Number.isFinite(regionHandleDragStartClientX) &&
                Math.abs(e.clientX - regionHandleDragStartClientX) <= 5;
            if (
                clickOnly &&
                (regionHandleDragKind === 'in' || regionHandleDragKind === 'out') &&
                regionHandleDragTrack &&
                regionHandleDragSegmentIndex >= 0
            ) {
                seekFromRegionHandleClick(
                    regionHandleDragKind,
                    regionHandleDragTrack,
                    regionHandleDragSegmentIndex,
                );
                endRegionHandleDrag({ cancelled: true });
                regionHandleDragStartClientX = NaN;
                return;
            }
            if (regionHandleDragPhraseBoundary) {
                finalizePhraseBoundaryDragFromRegion(false);
            } else if (
                regionHandleDragKind === 'out' &&
                regionHandleDragTrack &&
                regionHandleDragSegmentIndex >= 0
            ) {
                const transportSec = transportSecFromRegionOutDragDelta(e.clientX);
                setSegmentHandleFromTransport(
                    regionHandleDragTrack,
                    regionHandleDragSegmentIndex,
                    'out',
                    transportSec,
                    { finalizeSnap: true },
                );
            }
            endRegionHandleDrag();
            regionHandleDragStartClientX = NaN;
            if (typeof schedulePersistSession === 'function') schedulePersistSession();
        };
        document.addEventListener('pointermove', regionHandleDragDocMove);
        document.addEventListener('pointerup', regionHandleDragDocUp);
        document.addEventListener('pointercancel', regionHandleDragDocUp);
    }

    function resolveRegionFadeTargets() {
        const fromSelection = expandRegionSegmentEditTargetsFromSelection();
        if (fromSelection.length) return fromSelection;

        const slot = resolveSplitTargetExtraSlot();
        if (slot < 0 || !isExtraSlotUsableForRegion(slot)) return [];
        const track = { type: 'extra', slot };
        if (!isTrackRegionActive(track)) return [];

        const { clientX, clientY } = waveformPointerClientXY();
        let segmentIndex = resolveRegionSegmentIndexAtPointer(track, clientX, clientY);
        if (segmentIndex < 0) {
            const seekSec = transportSecFromSeekbar();
            const mapHit = mapTransportToSegment(track, seekSec);
            if (mapHit) segmentIndex = mapHit.segmentIndex;
        }
        if (segmentIndex < 0) return [];

        const members = collectRegionGroupMembers(track, segmentIndex);
        const seen = new Set();
        const out = [];
        for (let i = 0; i < members.length; i++) {
            const m = members[i];
            const key = regionGroupMemberKey(m.slot, m.segmentIndex);
            if (seen.has(key)) continue;
            seen.add(key);
            const mTrack = { type: 'extra', slot: m.slot };
            if (!isTrackRegionActive(mTrack)) continue;
            out.push({ slot: m.slot, segmentIndex: m.segmentIndex });
        }
        return out;
    }

    function applyRegionFadeAtSeekbar(kind) {
        if (suppressInvalidRegionOpNoticeForVideoAudio()) return false;
        const targets = resolveRegionFadeTargets();
        if (!targets.length) {
            writeLog(
                'Playback region fade: hover/select a region, then Alt+' +
                    (kind === 'fade-in' ? 'I' : 'O'),
            );
            if (typeof flashSeekHint === 'function') {
                flashSeekHint(
                    'Region',
                    kind === 'fade-in' ? 'Fade In' : 'Fade Out',
                    'notice',
                );
            }
            return false;
        }

        const transportSec = transportSecFromSeekbar();
        let anyChanged = false;
        if (!regionUndoPaused) requestRegionUndoCapture();

        for (let i = 0; i < targets.length; i++) {
            const { slot, segmentIndex } = targets[i];
            const track = { type: 'extra', slot };
            const fadeKind = kind === 'fade-in' ? 'in' : 'out';
            const before = getSegmentFadeDurationSec(track, segmentIndex, fadeKind);
            setSegmentHandleFromTransport(track, segmentIndex, kind, transportSec, {
                skipUndo: true,
            });
            const after = getSegmentFadeDurationSec(track, segmentIndex, fadeKind);
            if (Math.abs(after - before) >= 0.0005) anyChanged = true;
        }

        if (typeof schedulePersistSession === 'function') schedulePersistSession();

        const label = kind === 'fade-in' ? 'Fade In' : 'Fade Out';
        writeLog(
            'Playback region ' +
                label +
                ' at seekbar ' +
                transportSec.toFixed(3) +
                's (' +
                targets.length +
                ' region' +
                (targets.length === 1 ? '' : 's') +
                (anyChanged ? '' : ', unchanged') +
                ')',
        );
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Region', label, anyChanged ? 'notice' : 'error');
        }
        return anyChanged;
    }

    /** 同一トラック上で隙間なく連続したリージョンが選択されているとき、その範囲を返す。 */
    function resolveConsecutiveRegionSelectionJoinSpan() {
        const segEntries = regionSelectionEntries.filter((e) => e.segmentIndex >= 0);
        if (segEntries.length < 2) return null;
        if (segEntries.length !== regionSelectionEntries.length) return null;

        const slot = segEntries[0].slot;
        if (!segEntries.every((e) => e.slot === slot)) return null;

        const indices = [...new Set(segEntries.map((e) => e.segmentIndex))].sort(
            (a, b) => a - b,
        );
        if (indices.length !== segEntries.length) return null;

        for (let i = 1; i < indices.length; i++) {
            if (indices[i] !== indices[i - 1] + 1) return null;
        }

        return {
            slot,
            lo: indices[0],
            hi: indices[indices.length - 1],
            regionCount: indices.length,
        };
    }

    function resolveJoinableBoundaryAtPointerOrSeek(track) {
        const { clientX, clientY } = waveformPointerClientXY();
        let boundaryIndex = resolveSegmentBoundaryIndexAtPointer(
            track,
            clientX,
            clientY,
            true,
        );
        if (boundaryIndex < 0) {
            boundaryIndex = resolveSegmentBoundaryIndexAtTransport(
                track,
                transportSecFromSeekbar(),
                true,
            );
        }
        return boundaryIndex;
    }

    function resolveBlockedBoundaryAtPointerOrSeek(track) {
        const { clientX, clientY } = waveformPointerClientXY();
        let boundaryIndex = resolveSegmentBoundaryIndexAtPointer(
            track,
            clientX,
            clientY,
            false,
        );
        if (boundaryIndex < 0) {
            boundaryIndex = resolveSegmentBoundaryIndexAtTransport(
                track,
                transportSecFromSeekbar(),
                false,
            );
        }
        return boundaryIndex;
    }

    function joinPlaybackRegionAtPointer(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const selBlockReason = resolveRegionSelectionJoinBlockReason();
        if (selBlockReason) {
            if (!o.silent && !suppressInvalidRegionOpNoticeForVideoAudio()) {
                notifyCannotBondFromSelection(selBlockReason);
            }
            return false;
        }
        const selSpan = resolveConsecutiveRegionSelectionJoinSpan();
        let slot = resolveSplitTargetExtraSlot();
        if (slot < 0 && selSpan) slot = selSpan.slot;
        if (slot < 0) {
            if (!o.silent && !suppressInvalidRegionOpNoticeForVideoAudio()) {
                writeLog(
                    'Playback region: hover an Ex lane (1–' +
                        getExtraTrackCount() +
                        '), or select consecutive regions, then press B',
                );
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint('Region', 'Hover Ex lane or select regions', 'notice');
                }
            }
            return false;
        }
        if (!isExtraSlotUsableForRegion(slot)) {
            if (selSpan && isExtraSlotUsableForRegion(selSpan.slot)) {
                slot = selSpan.slot;
            } else {
                if (!o.silent) {
                    writeLog('Playback region: load an extra audio track first');
                }
                return false;
            }
        }
        const track = { type: 'extra', slot };
        if (selSpan && isExtraSlotUsableForRegion(selSpan.slot)) {
            const selTrack = { type: 'extra', slot: selSpan.slot };
            if (isTrackRegionActive(selTrack)) {
                return joinConsecutiveRegionSpanAt(selTrack, selSpan.lo, selSpan.hi, o);
            }
        }
        if (isTrackRegionActive(track)) {
            const boundaryIndex = resolveJoinableBoundaryAtPointerOrSeek(track);
            if (boundaryIndex >= 0) {
                return joinSegmentBoundaryAt(track, boundaryIndex, o);
            }
        }
        if (isTrackRegionActive(track)) {
            const blockedBoundaryIndex = resolveBlockedBoundaryAtPointerOrSeek(track);
            if (blockedBoundaryIndex >= 0) {
                if (!o.silent) {
                    notifyCannotJoinSegmentBoundary(track, blockedBoundaryIndex);
                }
                return false;
            }
        }
        if (!o.silent) {
            writeLog(
                'Playback region: hover a joinable boundary, seek to boundary, or select consecutive regions, then press B',
            );
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'Boundary or consecutive regions', 'notice');
            }
        }
        return false;
    }

    function handlePlaybackRegionJoinKeydown(e) {
        if (!matchUserShortcut(e, 'regionJoin')) return false;
        if (suppressInvalidRegionOpNoticeForVideoAudio()) return false;
        e.preventDefault();
        const ok = joinPlaybackRegionAtPointer();
        if (ok) e.stopPropagation();
        return true;
    }

    window.resolveSplitBoundaryPointerHit = resolveSplitBoundaryPointerHit;
    window.tryBeginRegionHandleDragFromPointer = tryBeginRegionHandleDragFromPointer;
    window.tryBeginRegionFadeHandleDragFromPointer = tryBeginRegionFadeHandleDragFromPointer;
    window.tryBeginSplitBoundaryDragFromPointer = tryBeginSplitBoundaryDragFromPointer;
    window.isPointerOnSplitHandleAtPointer = isPointerOnSplitHandleAtPointer;
