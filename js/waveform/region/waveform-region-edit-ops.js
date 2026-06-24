/**
 * waveform-region-edit-ops.js — スプリット・コピー・削除・再描画
 */
    function suppressInvalidRegionOpNoticeForVideoAudio() {
        return (
            typeof pointerTargetsVideoAudioLane === 'function' &&
            pointerTargetsVideoAudioLane()
        );
    }

    function resolveTargetExtraSlot() {
        let clientY = null;
        if (typeof getWaveformLanesPointerClientY === 'function') {
            clientY = getWaveformLanesPointerClientY();
        }
        if (clientY == null && typeof getWaveformPointerClientY === 'function') {
            clientY = getWaveformPointerClientY();
        }
        if (
            clientY != null &&
            typeof waveformExtraLaneSlotFromClientY === 'function' &&
            !suppressInvalidRegionOpNoticeForVideoAudio()
        ) {
            const slot = waveformExtraLaneSlotFromClientY(clientY);
            if (slot >= 0 && isExtraSlotUsableForRegion(slot)) {
                return slot;
            }
        }
        if (typeof getWaveformTargetExtraSlot === 'function') {
            const slot = getWaveformTargetExtraSlot();
            if (slot >= 0 && isExtraSlotUsableForRegion(slot)) {
                return slot;
            }
        }
        if (
            clientY != null &&
            typeof extraLaneSlotFromClientY === 'function'
        ) {
            const slot = extraLaneSlotFromClientY(clientY);
            if (slot >= 0 && isExtraSlotUsableForRegion(slot)) {
                return slot;
            }
        }
        const domSlot = getActiveMixExtraSlotFromDom();
        if (domSlot >= 0 && isExtraSlotUsableForRegion(domSlot)) return domSlot;
        if (typeof getLastActiveMixExtraSlot === 'function') {
            const slot = getLastActiveMixExtraSlot();
            if (slot >= 0 && isExtraSlotUsableForRegion(slot)) return slot;
        }
        if (typeof ensureDefaultActiveMixExtraSlot === 'function') {
            const slot = ensureDefaultActiveMixExtraSlot();
            if (slot >= 0 && isExtraSlotUsableForRegion(slot)) return slot;
        }
        return -1;
    }

    function resolvePasteTargetExtraSlot() {
        const slot = resolveTargetExtraSlot();
        if (slot >= 0) return slot;
        if (
            regionSegmentClipboard &&
            isExtraSlotUsableForRegion(regionSegmentClipboard.slot)
        ) {
            return regionSegmentClipboard.slot;
        }
        return -1;
    }

    function isExtraSlotUsableForRegion(slot) {
        if (slot < 0) return false;
        if (typeof isExtraTrackLoaded === 'function' && isExtraTrackLoaded(slot)) {
            return true;
        }
        if (
            typeof isExtraTrackLaneShown === 'function' &&
            isExtraTrackLaneShown(slot) &&
            typeof isTrackRegionActive === 'function' &&
            isTrackRegionActive({ type: 'extra', slot })
        ) {
            return true;
        }
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        const hint = tr ? Number(tr.restoreDurationHint) : 0;
        return Number.isFinite(hint) && hint > 0;
    }

    function transportSecFromWaveformPointer() {
        let clientX = null;
        if (typeof getWaveformLanesPointerClientX === 'function') {
            clientX = getWaveformLanesPointerClientX();
        }
        if (clientX == null && typeof getWaveformPointerClientX === 'function') {
            clientX = getWaveformPointerClientX();
        }
        if (Number.isFinite(clientX)) {
            const lanes = getWaveformLanesEl();
            if (lanes) {
                const r = lanes.getBoundingClientRect();
                if (clientX >= r.left && clientX <= r.right) {
                    const fromPointer = transportSecAtClientX(clientX);
                    if (Number.isFinite(fromPointer)) return fromPointer;
                }
            }
        }
        if (typeof getTransportSec === 'function') {
            return getTransportSec();
        }
        return typeof transportPlaybackSec === 'number' ? transportPlaybackSec : 0;
    }

    function transportSecFromSeekbar() {
        if (typeof getTransportSec === 'function') {
            return getTransportSec();
        }
        return typeof transportPlaybackSec === 'number' ? transportPlaybackSec : 0;
    }

    function extraSlotFromPlaybackRegionEl(regionEl) {
        if (!regionEl) return -1;
        if (regionEl.closest('.audio-waveform-lane--video-viz')) return -2;
        if (
            regionEl.classList.contains('audio-waveform-lane__playback-region--video-audio-mirror') ||
            (regionEl.closest('.audio-waveform-lane--video') &&
                !regionEl.closest('.audio-waveform-lane--video-viz'))
        ) {
            return typeof VIDEO_AUDIO_WAVEFORM_OFFSET_DRAG_SLOT !== 'undefined'
                ? VIDEO_AUDIO_WAVEFORM_OFFSET_DRAG_SLOT
                : -3;
        }
        const lane = regionEl.closest('.audio-waveform-lane--extra');
        if (!lane || !lane.id) return -1;
        const m = /^extraAudioLane(\d+)$/.exec(lane.id);
        return m ? parseInt(m[1], 10) : -1;
    }

    function isVideoRegionSplitSlot(slot) {
        return (
            slot === -2 ||
            slot === -3 ||
            (typeof VIDEO_WAVEFORM_OFFSET_DRAG_SLOT !== 'undefined' &&
                slot === VIDEO_WAVEFORM_OFFSET_DRAG_SLOT) ||
            (typeof VIDEO_AUDIO_WAVEFORM_OFFSET_DRAG_SLOT !== 'undefined' &&
                slot === VIDEO_AUDIO_WAVEFORM_OFFSET_DRAG_SLOT)
        );
    }

    function trackRefFromRegionSplitSlot(slot) {
        if (isVideoRegionSplitSlot(slot)) return getVideoTrackRef();
        if (slot >= 0) return { type: 'extra', slot };
        return null;
    }

    function getActiveMixExtraSlotFromDom() {
        const n = getExtraTrackCount();
        for (let i = 0; i < n; i++) {
            const meta = document.getElementById('extraAudioMeta' + i);
            if (
                meta &&
                !meta.hidden &&
                meta.classList.contains('audio-waveform-lane-meta--active')
            ) {
                return i;
            }
        }
        return -1;
    }
    /* --- overlay 由来の編集操作 --- */
    function resolveRegionSegmentIndexAtPointer(track, clientX, clientY) {
        const regionEl = findPlaybackRegionElAtPointer(clientX, clientY);
        if (regionEl) {
            const videoLane = regionEl.closest('.audio-waveform-lane--video-viz');
            const lane = regionEl.closest('.audio-waveform-lane--extra');
            if (isVideoTrackRef(track) && videoLane) {
                const idx = Number(regionEl.dataset.segmentIndex);
                if (Number.isFinite(idx) && idx >= 0) return idx;
            }
            const m = lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
            if (m && parseInt(m[1], 10) === track.slot) {
                const idx = Number(regionEl.dataset.segmentIndex);
                if (Number.isFinite(idx) && idx >= 0) return idx;
            }
        }
        if (
            hoveredPlaybackRegionEl &&
            !hoveredPlaybackRegionEl.hidden
        ) {
            const videoLane = hoveredPlaybackRegionEl.closest('.audio-waveform-lane--video-viz');
            const lane = hoveredPlaybackRegionEl.closest('.audio-waveform-lane--extra');
            if (isVideoTrackRef(track) && videoLane) {
                const idx = Number(hoveredPlaybackRegionEl.dataset.segmentIndex);
                if (Number.isFinite(idx) && idx >= 0) return idx;
            }
            const m = lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
            if (m && parseInt(m[1], 10) === track.slot) {
                const idx = Number(hoveredPlaybackRegionEl.dataset.segmentIndex);
                if (Number.isFinite(idx) && idx >= 0) return idx;
            }
        }
        let transportSec = null;
        if (Number.isFinite(clientX)) {
            transportSec = transportSecAtClientX(clientX);
        }
        if (!Number.isFinite(transportSec)) {
            transportSec = transportSecFromWaveformPointer();
        }
        transportSec = clampRegionEditTransportSec(track, transportSec);
        const mapHit = mapTransportToSegmentForPlayback(track, transportSec);
        if (mapHit) return mapHit.segmentIndex;
        const mapHitUi = mapTransportToSegment(track, transportSec);
        return mapHitUi ? mapHitUi.segmentIndex : -1;
    }

    function deleteRegionSegmentAt(track, segmentIndex, opt) {
        if (!(opt && opt.skipClearSelection) && typeof clearRegionSelection === 'function') {
            clearRegionSelection();
        }
        if (!(opt && opt.skipUndoCapture) && !regionUndoPaused) requestRegionUndoCapture();
        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        if (!segments[segmentIndex]) return false;
        segments.splice(segmentIndex, 1);
        if (!segments.length) {
            const state = getPlaybackRegionsState(track);
            if (state) {
                state.active = false;
                state.segments = [];
            }
            if (ensureDefaultTrackRegion(track, { silent: true })) {
                const resetMsg = formatExTrack(track.slot) + ' reset to full clip';
                if (typeof logRegionAction === 'function') {
                    logRegionAction(resetMsg);
                } else {
                    writeLog('Ex ' + (track.slot + 1) + ': region reset to full clip');
                }
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint('Ex ' + (track.slot + 1), 'Region reset', 'notice');
                }
                updateTrackRegionOverlays(track);
                redrawAfterRegionChange(track.slot, { segmentStructureChanged: true });
                if (typeof schedulePersistSession === 'function') {
                    schedulePersistSession();
                }
                if (typeof syncExtraAudioToTransport === 'function') {
                    syncExtraAudioToTransport({ force: true });
                }
                return true;
            }
            clearTrackRegion(track, { skipUndo: true });
            const offMsg = formatExTrack(track.slot) + ' all regions removed';
            if (typeof logRegionAction === 'function') {
                logRegionAction(offMsg);
            } else {
                writeLog('Ex ' + (track.slot + 1) + ': all regions removed');
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Ex ' + (track.slot + 1), 'Regions off', 'notice');
            }
            return true;
        }
        applySegmentsToState(track, segments, { skipUndo: true });
        const deleteMsg =
            formatExTrack(track.slot) +
            ' R' +
            (segmentIndex + 1) +
            ' deleted (' +
            segments.length +
            ' left)';
        if (typeof logRegionAction === 'function') {
            logRegionAction(deleteMsg);
        } else {
            writeLog(
                'Ex ' +
                    (track.slot + 1) +
                    ': region ' +
                    (segmentIndex + 1) +
                    ' deleted (' +
                    segments.length +
                    ' left)',
            );
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Ex ' + (track.slot + 1), 'Region deleted', 'notice');
        }
        return true;
    }

    function waveformPointerClientXY() {
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
        return { clientX, clientY };
    }

    function snapshotSegmentForClipboard(track, segmentIndex) {
        const raw = getRawSegmentEntry(track, segmentIndex);
        const seg = getTrackSegments(track)[segmentIndex];
        if (!raw || !seg) return null;
        return {
            clipId: seg.clipId || raw.clipId || 'main',
            sourceInSec: seg.sourceInSec,
            sourceOutSec: seg.sourceOutSec,
            anchorStartSec: getSegmentTimelineStart(track, segmentIndex),
            regionInSec: getSegmentRegionTimelineIn(track, segmentIndex),
            regionLeadPadSec: getSegmentRegionLeadPadSec(track, segmentIndex),
            gainDb: getSegmentGainDb(track, segmentIndex),
            pitchSemitones: getSegmentPitchSemitones(track, segmentIndex),
            fadeInSec: getSegmentFadeDurationSec(track, segmentIndex, 'in'),
            fadeOutSec: getSegmentFadeDurationSec(track, segmentIndex, 'out'),
        };
    }

    function copyRegionSegmentUnderCursor() {
        if (!regionSelectionEntries.length) return false;
        if (regionSelectionEntries.length > 1) return false;
        const { slot, segmentIndex } = regionSelectionEntries[0];
        const track = { type: 'extra', slot };
        if (!isTrackRegionActive(track)) return false;
        const segment = snapshotSegmentForClipboard(track, segmentIndex);
        if (!segment) return false;
        regionSegmentClipboard = { slot, segmentIndex, segment };
        writeLog(
            'Ex ' +
                (slot + 1) +
                ': region ' +
                (segmentIndex + 1) +
                ' copied',
        );
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Ex ' + (slot + 1), 'Region copied', 'notice');
        }
        return true;
    }

    function shiftSegmentEntriesTimelineFromIndex(segments, track, fromIndex, delta) {
        if (!Number.isFinite(delta) || Math.abs(delta) < 0.00001) return;
        const state = getPlaybackRegionsState(track);
        for (let i = fromIndex; i < segments.length; i++) {
            const seg = segments[i];
            if (Number.isFinite(seg.timelineStartSec)) {
                seg.timelineStartSec += delta;
            }
            if (i === 0) {
                if (state && Number.isFinite(state.regionTimelineInSec)) {
                    state.regionTimelineInSec = Math.max(0, state.regionTimelineInSec + delta);
                }
            } else if (Number.isFinite(seg.regionTimelineInSec)) {
                seg.regionTimelineInSec = Math.max(0, seg.regionTimelineInSec + delta);
            }
        }
    }

    function pasteRegionSegmentToTrackEnd() {
        if (!regionSegmentClipboard) {
            if (!suppressInvalidRegionOpNoticeForVideoAudio()) {
                writeLog('Playback region: nothing to paste (Ctrl+C first)');
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint('Region', 'Copy a region first', 'notice');
                }
            }
            return false;
        }
        const slot = resolvePasteTargetExtraSlot();
        if (slot < 0) {
            if (!suppressInvalidRegionOpNoticeForVideoAudio()) {
                writeLog('Playback region: hover an Ex lane, then Ctrl+V to paste');
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint('Region', 'Hover Ex lane', 'notice');
                }
            }
            return false;
        }
        if (!isExtraSlotUsableForRegion(slot)) {
            writeLog('Playback region: load extra audio before paste');
            return false;
        }
        const track = { type: 'extra', slot };
        if (!isTrackRegionActive(track)) {
            ensureDefaultTrackRegion(track, { silent: true });
        }
        if (!isTrackRegionActive(track)) return false;

        const clip = regionSegmentClipboard.segment;
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments || !state.segments.length) return false;
        const segmentCount = state.segments.length;

        const eps = segmentBoundaryJoinEpsilonSec();
        const pasteDur = Math.max(
            PLAYBACK_REGION_MIN_SEC,
            (Number(clip.sourceOutSec) || 0) - (Number(clip.sourceInSec) || 0),
        );

        let srcIdx =
            regionSegmentClipboard.slot === slot &&
            Number.isFinite(regionSegmentClipboard.segmentIndex)
                ? regionSegmentClipboard.segmentIndex | 0
                : -1;
        if (srcIdx < 0 || srcIdx >= segmentCount) {
            srcIdx = segmentCount - 1;
        }

        // コピー元の隣 = リージョン Out 直後（アンカー+ソース長ではない — 平行移動 In オフセット分ずれる）
        const srcRegionOut = getSegmentRegionTimelineOut(track, srcIdx);
        let availableGap = Infinity;
        if (srcIdx < segmentCount - 1) {
            availableGap =
                getSegmentTimelineStart(track, srcIdx + 1) - srcRegionOut;
        }
        const pushDelta =
            availableGap >= pasteDur - eps ? 0 : pasteDur - availableGap;
        const pasteStart = srcRegionOut;

        const clone = {
            id: newRegionId(),
            clipId: clip.clipId,
            sourceInSec: clip.sourceInSec,
            sourceOutSec: clip.sourceOutSec,
            timelineStartSec: pasteStart,
        };
        // 隣接ペーストは新規リージョンとして Out 直後に置く — コピー元の平行 In オフセットは引き継がない
        const srcLeadPad = Number(clip.regionLeadPadSec) || 0;
        const srcHadLeadPad =
            srcLeadPad > 0.00001 &&
            Number.isFinite(clip.regionInSec) &&
            Number.isFinite(clip.anchorStartSec) &&
            clip.regionInSec < clip.anchorStartSec - SEGMENT_BOUNDARY_JOIN_EPS_SEC;
        if (srcHadLeadPad) {
            clone.regionLeadPadSec = srcLeadPad;
            clone.regionTimelineInSec = pasteStart - srcLeadPad;
        }
        if (Number.isFinite(clip.gainDb) && Math.abs(clip.gainDb) > 0.0005) {
            clone.gainDb = clip.gainDb;
        }
        if (Number.isFinite(clip.pitchSemitones) && clip.pitchSemitones !== 0) {
            clone.pitchSemitones = clip.pitchSemitones;
        }
        if (Number.isFinite(clip.fadeOutSec) && clip.fadeOutSec > 0.0005) {
            clone.fadeOutSec = clip.fadeOutSec;
        }

        const fullDur = getSegmentSourceDurationSec(track, clone);
        if (!fullDur) return false;
        let norm = normalizeSegmentEntry(clone, track, fullDur);
        delete norm.fadeInSec;

        if (!regionUndoPaused) requestRegionUndoCapture();
        // コピー元は raw のまま保持 — 全セグメント再 normalize すると seg0 の head 状態が壊れる
        const working = state.segments.map((s) => Object.assign({}, s));
        const insertAt = srcIdx + 1;
        if (pushDelta > eps) {
            shiftSegmentEntriesTimelineFromIndex(working, track, insertAt, pushDelta);
        }
        if (working[srcIdx] && Number.isFinite(working[srcIdx].fadeOutSec)) {
            delete working[srcIdx].fadeOutSec;
        }
        working.splice(insertAt, 0, norm);
        applySegmentsToState(track, working, {
            silent: true,
            skipUndo: true,
            segmentStructureChanged: true,
        });
        writeLog(
            'Ex ' +
                (slot + 1) +
                ': region pasted after region ' +
                (srcIdx + 1) +
                ' (' +
                working.length +
                ' total)',
        );
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Ex ' + (slot + 1), 'Region pasted', 'notice');
        }
        return true;
    }

    function deleteRegionSegmentUnderCursor() {
        if (!regionSelectionEntries.length) {
            if (typeof window.silentGapDeleteDiagLog === 'function') {
                window.silentGapDeleteDiagLog('region-delete/reject', {
                    reason: 'no-selection',
                });
            }
            return false;
        }
        const entries = regionSelectionEntries.map((e) => ({
            slot: e.slot,
            segmentIndex: e.segmentIndex,
            silentGapIndex: e.silentGapIndex,
        }));
        if (typeof window.silentGapDeleteDiagLog === 'function') {
            window.silentGapDeleteDiagLog('region-delete/begin', {
                entries,
            });
        }
        if (typeof clearRegionSelection === 'function') clearRegionSelection();
        const gapEntries = entries.filter((e) => e.segmentIndex < 0);
        const rehearsalFillOn =
            typeof getMusicalGridRehearsalFillVisible === 'function' &&
            getMusicalGridRehearsalFillVisible();
        if (!regionUndoPaused) {
            requestRegionUndoCapture({
                includeRehearsal: !!(rehearsalFillOn && gapEntries.length),
            });
        }

        const segEntries = entries.filter((e) => e.segmentIndex >= 0);

        let anyDeleted = false;

        const gapBySlot = {};
        for (let i = 0; i < gapEntries.length; i++) {
            const e = gapEntries[i];
            if (!(e.silentGapIndex >= 0)) continue;
            if (!gapBySlot[e.slot]) gapBySlot[e.slot] = [];
            if (gapBySlot[e.slot].indexOf(e.silentGapIndex) < 0) {
                gapBySlot[e.slot].push(e.silentGapIndex);
            }
        }
        const gapSlotKeys = Object.keys(gapBySlot);
        for (let s = 0; s < gapSlotKeys.length; s++) {
            const slot = parseInt(gapSlotKeys[s], 10);
            const track = { type: 'extra', slot };
            if (!isTrackRegionActive(track)) continue;
            noteRegionShrinkPersistIntent(slot);
            const indices = gapBySlot[slot].sort((a, b) => b - a);
            for (let i = 0; i < indices.length; i++) {
                if (typeof window.silentGapDeleteDiagLog === 'function') {
                    window.silentGapDeleteDiagLog('region-delete/gap-attempt', {
                        ex: slot + 1,
                        gapIndex: indices[i],
                    });
                }
                if (
                    typeof deleteSilentGapAt === 'function' &&
                    deleteSilentGapAt(track, indices[i], {
                        skipClearSelection: true,
                        skipUndoCapture: true,
                    })
                ) {
                    anyDeleted = true;
                }
            }
        }

        const bySlot = {};
        const hasVideoRegionSelection = segEntries.some((e) => isVideoRegionSplitSlot(e.slot));
        for (let i = 0; i < segEntries.length; i++) {
            const e = segEntries[i];
            if (isVideoRegionSplitSlot(e.slot)) continue;
            if (!bySlot[e.slot]) bySlot[e.slot] = [];
            if (bySlot[e.slot].indexOf(e.segmentIndex) < 0) {
                bySlot[e.slot].push(e.segmentIndex);
            }
        }

        if (
            hasVideoRegionSelection &&
            typeof resetVideoTrackRegionToFullClip === 'function' &&
            resetVideoTrackRegionToFullClip({
                skipUndoCapture: true,
                silent: true,
            })
        ) {
            const resetMsg = 'Video track reset to full clip';
            if (typeof logRegionAction === 'function') {
                logRegionAction(resetMsg);
            } else if (typeof writeLog === 'function') {
                writeLog('Video track: region reset to full clip');
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Video', 'Region reset', 'notice');
            }
            anyDeleted = true;
        }

        const slotKeys = Object.keys(bySlot);
        for (let s = 0; s < slotKeys.length; s++) {
            const slot = parseInt(slotKeys[s], 10);
            const track = trackRefFromRegionSplitSlot(slot);
            if (!track || !isTrackRegionActive(track)) continue;
            noteRegionShrinkPersistIntent(slot);
            const indices = bySlot[slot].sort((a, b) => b - a);
            for (let i = 0; i < indices.length; i++) {
                if (typeof window.silentGapDeleteDiagLog === 'function') {
                    window.silentGapDeleteDiagLog('region-delete/segment-attempt', {
                        ex: slot + 1,
                        segmentIndex: indices[i],
                        region: indices[i] + 1,
                    });
                }
                if (
                    deleteRegionSegmentAt(track, indices[i], {
                        skipClearSelection: true,
                        skipUndoCapture: true,
                    })
                ) {
                    anyDeleted = true;
                }
            }
        }
        if (typeof window.silentGapDeleteDiagLog === 'function') {
            window.silentGapDeleteDiagLog('region-delete/done', {
                anyDeleted: !!anyDeleted,
                gapSlots: gapSlotKeys.length,
                segSlots: slotKeys.length,
            });
        }
        return anyDeleted;
    }

    window.getActiveMixExtraSlotFromDom = getActiveMixExtraSlotFromDom;
    window.needsCrossfadeWaveformPreviewDuringGeometryDrag =
        needsCrossfadeWaveformPreviewDuringGeometryDrag;

    /** スプリット対象：Video / Ex リージョン上 → そのリージョン／それ以外 → resolveTargetExtraSlot */
    function resolveSplitTargetExtraSlot() {
        const { clientX, clientY } = waveformPointerClientXY();
        const regionEl = findPlaybackRegionElAtPointer(clientX, clientY);
        if (regionEl) {
            const slot = extraSlotFromPlaybackRegionEl(regionEl);
            if (isVideoRegionSplitSlot(slot) && isVideoVizLaneShown()) return slot;
            if (slot >= 0 && isExtraSlotUsableForRegion(slot)) return slot;
        }
        if (typeof isPointerOverVideoVizLane === 'function' && isPointerOverVideoVizLane(clientY)) {
            return -2;
        }
        const targetSlot = resolveTargetExtraSlot();
        if (targetSlot >= 0) return targetSlot;
        if (typeof resolveMixTargetFromPointer === 'function' && Number.isFinite(clientY)) {
            const target = resolveMixTargetFromPointer(clientY);
            if (target && target.kind === 'extra') {
                const slot = target.slot;
                if (isExtraSlotUsableForRegion(slot)) return slot;
            }
        }
        return -1;
    }

    function resolveSplitTargetPlaybackRegionTrack() {
        const slot = resolveSplitTargetExtraSlot();
        if (isVideoRegionSplitSlot(slot)) {
            return isVideoVizLaneShown() ? getVideoTrackRef() : null;
        }
        if (slot >= 0 && isExtraSlotUsableForRegion(slot)) {
            return { type: 'extra', slot };
        }
        return null;
    }

    function clampRegionEditTransportSec(track, sec) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!master) return 0;
        let t = Number(sec);
        if (!Number.isFinite(t)) t = 0;
        t = Math.max(0, Math.min(master, t));

        const segments = getTrackSegments(track);
        if (!segments.length) {
            const t0 = getTrackTimelineStartSec(track);
            const fullDur = getTrackSourceDurationSec(track);
            if (!fullDur) return t;
            return Math.max(
                t0 + PLAYBACK_REGION_MIN_SEC,
                Math.min(t0 + fullDur - PLAYBACK_REGION_MIN_SEC, t),
            );
        }

        if (mapTransportToSegment(track, t)) return t;

        const t0 = getTrackTimelineStartSec(track);
        const end = getTrackTimelineEndSec(track);
        return Math.max(
            t0 + PLAYBACK_REGION_MIN_SEC,
            Math.min(end - PLAYBACK_REGION_MIN_SEC, t),
        );
    }

    function resolveRegionSplitPointerLaneSlot(clientX, clientY) {
        if (Number.isFinite(clientY) && typeof isPointerOverVideoVizLane === 'function') {
            if (isPointerOverVideoVizLane(clientY)) return -2;
        }
        if (Number.isFinite(clientY) && typeof extraLaneSlotFromClientY === 'function') {
            const laneSlot = extraLaneSlotFromClientY(clientY);
            if (laneSlot >= 0) return laneSlot;
        }
        const regionEl = findPlaybackRegionElAtPointer(clientX, clientY);
        if (regionEl) {
            const slot = extraSlotFromPlaybackRegionEl(regionEl);
            if (slot >= 0 || isVideoRegionSplitSlot(slot)) return slot;
        }
        return -1;
    }

    function getRegionSplitTargetTransportSec(track, clientX, clientY, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        let pointerSec = null;
        if (Number.isFinite(clientX)) {
            let canUsePointer = false;
            if (o.pointerOverAnyExLane) {
                const laneSlot = resolveRegionSplitPointerLaneSlot(clientX, clientY);
                canUsePointer = laneSlot >= 0 || laneSlot === -2;
            } else {
                const laneSlot = resolveRegionSplitPointerLaneSlot(clientX, clientY);
                canUsePointer =
                    (isVideoTrackRef(track) && laneSlot === -2) ||
                    laneSlot === track.slot ||
                    (!Number.isFinite(clientY) &&
                        !!findPlaybackRegionElAtPointer(clientX, clientY));
            }
            if (canUsePointer) {
                pointerSec = transportSecAtClientX(clientX);
            }
        }
        if (Number.isFinite(pointerSec)) {
            const thresholdSec = regionSnapThresholdSec();
            const altSuppressed =
                typeof isSnapSuppressedByAlt === 'function'
                    ? isSnapSuppressedByAlt()
                    : false;
            const markersShownOnWaveform =
                typeof audioWaveformMarkers !== 'undefined' &&
                audioWaveformMarkers &&
                !audioWaveformMarkers.hidden;
            let snapped = pointerSec;
            if (markersShownOnWaveform) {
                if (typeof snapSecToMarkerInOut === 'function') {
                    snapped = snapSecToMarkerInOut(pointerSec, {
                        thresholdSec,
                        altKey: altSuppressed,
                    });
                }
            } else if (typeof snapRegionTransportSec === 'function') {
                snapped = snapRegionTransportSec(pointerSec, {
                    sameSlotOnly: -1,
                    altKey: altSuppressed,
                });
            }
            let clampTrack = track;
            if (o.pointerOverAnyExLane) {
                const laneSlot = resolveRegionSplitPointerLaneSlot(clientX, clientY);
                if (laneSlot >= 0) {
                    clampTrack = { type: 'extra', slot: laneSlot };
                }
            }
            const clamped = clampRegionEditTransportSec(clampTrack, snapped);
            writeLog(
                'Playback region split target: pointer sec=' +
                    pointerSec.toFixed(3) +
                    ' snapped=' +
                    snapped.toFixed(3) +
                    ' final=' +
                    clamped.toFixed(3),
            );
            return clamped;
        }
        const seekbarSec = transportSecFromSeekbar();
        const clamped = clampRegionEditTransportSec(track, seekbarSec);
        writeLog(
            'Playback region split target: seekbar sec=' +
                seekbarSec.toFixed(3) +
                ' final=' +
                clamped.toFixed(3),
        );
        return clamped;
    }

    function trySplitTrackAtTransportSec(track, splitTransport, opt) {
        const segments = getTrackSegments(track);
        if (
            segments.length &&
            isPlaybackRegionSplitForbiddenAtTransport(track, splitTransport)
        ) {
            return false;
        }
        if (!mapTransportToSegment(track, splitTransport) && segments.length) {
            return false;
        }
        if (
            getTrackSegments(track).length &&
            isPlaybackRegionSplitForbiddenAtTransport(track, splitTransport)
        ) {
            return false;
        }
        if (splitPlaybackRegionAtTransportSec(track, splitTransport, opt)) {
            return true;
        }
        const frameStep =
            typeof masterFrameSec === 'number' && masterFrameSec > 0 ? masterFrameSec : 1 / 60;
        const retryOffsets = [1, -1, 2, -2, 3, -3];
        for (let i = 0; i < retryOffsets.length; i++) {
            const tRetry = splitTransport + retryOffsets[i] * frameStep;
            if (isPlaybackRegionSplitForbiddenAtTransport(track, tRetry)) {
                continue;
            }
            if (splitPlaybackRegionAtTransportSec(track, tRetry, opt)) {
                writeLog(
                    'Playback region: split retried at ±' +
                        Math.abs(retryOffsets[i]) +
                        ' frame(s)',
                );
                return true;
            }
        }
        return false;
    }

    function splitPlaybackRegionAtTargetSecForSelection(targets, clientX, clientY) {
        if (!targets || !targets.length) return false;

        const selectedBySlot = new Map();
        for (let i = 0; i < targets.length; i++) {
            const t = targets[i];
            if (!selectedBySlot.has(t.slot)) selectedBySlot.set(t.slot, new Set());
            selectedBySlot.get(t.slot).add(t.segmentIndex);
        }

        const refTrack = { type: 'extra', slot: targets[0].slot };
        const splitTransport = getRegionSplitTargetTransportSec(
            refTrack,
            clientX,
            clientY,
            { pointerOverAnyExLane: true },
        );

        if (!regionUndoPaused) requestRegionUndoCapture();
        let successCount = 0;
        const slotKeys = Array.from(selectedBySlot.keys()).sort((a, b) => a - b);
        for (let s = 0; s < slotKeys.length; s++) {
            const slot = slotKeys[s];
            const track = { type: 'extra', slot };
            if (!isExtraSlotUsableForRegion(slot) || !isTrackRegionActive(track)) continue;

            const hit = mapTransportToSegment(track, splitTransport);
            const selectedIndices = selectedBySlot.get(slot);
            if (!hit || !selectedIndices.has(hit.segmentIndex)) continue;

            if (trySplitTrackAtTransportSec(track, splitTransport, { skipUndo: true })) {
                successCount++;
            }
        }

        if (!successCount) {
            if (!suppressInvalidRegionOpNoticeForVideoAudio()) {
                writeLog(
                    'Playback region: split at boundary or no selected region at cursor/seekbar',
                );
                flashSeekHint('Region', "Can't split here", 'error');
            }
            return false;
        }

        const splitTc =
            typeof formatActionTc === 'function'
                ? formatActionTc(splitTransport)
                : splitTransport.toFixed(3) + ' s';
        const splitMsg =
            'split at ' +
            splitTc +
            ' (' +
            successCount +
            ' track' +
            (successCount === 1 ? '' : 's') +
            ')';
        if (typeof logRegionAction === 'function') {
            logRegionAction(splitMsg);
        } else {
            writeLog('Playback region split at ' + splitTransport.toFixed(3) + 's (' + successCount + ' track(s))');
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Region', 'Split', 'notice');
        }
        return true;
    }

    function splitPlaybackRegionAtTargetSec() {
        const { clientX, clientY } = waveformPointerClientXY();
        const selectionTargets = expandRegionSegmentEditTargetsFromSelection();
        if (selectionTargets.length) {
            return splitPlaybackRegionAtTargetSecForSelection(
                selectionTargets,
                clientX,
                clientY,
            );
        }

        const slot = resolveSplitTargetExtraSlot();
        if (slot < 0) {
            if (!suppressInvalidRegionOpNoticeForVideoAudio()) {
                writeLog(
                    'Playback region: hover a Video or Ex lane, then press X',
                );
                flashSeekHint('Region', "Can't split here", 'error');
            }
            return false;
        }
        if (isVideoRegionSplitSlot(slot)) {
            const track = getVideoTrackRef();
            if (!isTrackRegionActive(track)) {
                writeLog('Playback region: load a video first');
                return false;
            }
            const splitTransport = getRegionSplitTargetTransportSec(track, clientX, clientY);
            if (trySplitTrackAtTransportSec(track, splitTransport)) {
                if (typeof logRegionAction === 'function') {
                    logRegionAction('video split');
                }
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint('Video', 'Split', 'notice');
                }
                return true;
            }
            if (!suppressInvalidRegionOpNoticeForVideoAudio()) {
                flashSeekHint('Region', "Can't split here", 'error');
            }
            return false;
        }
        if (!isExtraSlotUsableForRegion(slot)) {
            writeLog('Playback region: load an extra audio track first');
            return false;
        }
        const track = { type: 'extra', slot };

        const splitTransport = getRegionSplitTargetTransportSec(track, clientX, clientY);
        let segmentIndex = resolveRegionSegmentIndexAtPointer(track, clientX, clientY);
        if (segmentIndex < 0) {
            const mapHit = mapTransportToSegment(track, splitTransport);
            if (mapHit) segmentIndex = mapHit.segmentIndex;
        }
        if (segmentIndex >= 0 && getSegmentRegionGroupId(track, segmentIndex)) {
            const members = collectRegionGroupMembers(track, segmentIndex);
            if (members.length > 1) {
                return splitPlaybackRegionAtTargetSecForSelection(
                    members,
                    clientX,
                    clientY,
                );
            }
        }

        const segments = getTrackSegments(track);
        if (
            segments.length &&
            isPlaybackRegionSplitForbiddenAtTransport(track, splitTransport)
        ) {
            writeLog('Playback region: split at boundary or too close to adjacent region');
            flashSeekHint('Region', "Can't split here", 'error');
            return false;
        }
        if (!mapTransportToSegment(track, splitTransport) && segments.length) {
            writeLog('Playback region: split inside a region (not at edges)');
            flashSeekHint('Region', "Can't split here", 'error');
            return false;
        }
        if (!segments.length) {
            const clipId = getPrimaryClipIdForTrack(track);
            const fullDur =
                typeof getExtraTrackClipDurationSec === 'function'
                    ? getExtraTrackClipDurationSec(slot, clipId)
                    : getTrackSourceDurationSec(track);
            if (!fullDur) {
                writeLog('Playback region: track has no duration');
                return false;
            }
            const t0 = getTrackTimelineStartSec(track);
            const sourceSplit = Math.max(
                PLAYBACK_REGION_MIN_SEC,
                Math.min(fullDur, splitTransport - t0),
            );
            const seeded = [
                {
                    id: newRegionId(),
                    clipId,
                    sourceInSec: 0,
                    sourceOutSec: fullDur,
                    timelineStartSec: t0,
                },
            ];
            if (!setTrackSegments(track, seeded, { silent: true })) {
                writeLog('Playback region: split not applied (could not apply segments)');
                flashSeekHint('Region', "Can't split here", 'error');
                return false;
            }
        }
        if (
            getTrackSegments(track).length &&
            isPlaybackRegionSplitForbiddenAtTransport(track, splitTransport)
        ) {
            writeLog('Playback region: split at boundary or too close to adjacent region');
            flashSeekHint('Region', "Can't split here", 'error');
            return false;
        }
        if (trySplitTrackAtTransportSec(track, splitTransport)) {
            return true;
        }
        if (
            segments.length &&
            isPlaybackRegionSplitForbiddenAtTransport(track, splitTransport)
        ) {
            writeLog('Playback region: split at boundary or too close to adjacent region');
            flashSeekHint('Region', "Can't split here", 'error');
            return false;
        }
        writeLog('Playback region: split inside a region (not at edges)');
        flashSeekHint('Region', "Can't split here", 'error');
        return false;
    }

    function clearExtraTrackViewportPeaksForSlot(slot) {
        if (!(slot >= 0)) return;
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        if (tr) tr.viewportPeaks = null;
    }

    function isCrossfadeHandleDragActive() {
        return !!(
            regionHandleDragActive &&
            (regionHandleDragKind === 'fade-in' || regionHandleDragKind === 'fade-out')
        );
    }

    /**
     * クロスフェード重なり判定 — 平行移動プレビュー中は枠と同じ preview 区間を使う。
     * （seg0 geometryOnly は raw 未更新のため、確定位置だけでは検出できない）
     */
    function getSegmentCrossfadeProbeInterval(track, segmentIndex) {
        if (typeof getSegmentRegionOverlayTimelineInterval === 'function') {
            const iv = getSegmentRegionOverlayTimelineInterval(track, segmentIndex);
            return { start: iv.start, end: iv.end };
        }
        if (typeof getSegmentRegionOffsetDragPreviewInterval === 'function') {
            const preview = getSegmentRegionOffsetDragPreviewInterval(track, segmentIndex);
            if (preview) {
                return { start: preview.start, end: preview.end };
            }
        }
        return {
            start: getSegmentPlaybackTimelineStart(track, segmentIndex),
            end: getSegmentTimelineEnd(track, segmentIndex),
        };
    }

    /** 再生ミックスと同じ基準でセグメント同士のタイムライン重なり（クロスフェード区間） */
    function trackHasCrossfadeOverlapForWaveformPreview(track) {
        if (!track) return false;
        return collectCrossfadeOverlapSegmentIndices(track).length > 0;
    }

    let offsetDragCrossfadeWaveformDrawnBySlot = null;

    /** 平行移動中 — 重なり開始／終了の瞬間だけ波形を再描画する */
    function shouldRedrawWaveformDuringOffsetDrag(slot) {
        if (!(typeof slot === 'number' && slot >= 0)) return false;
        if (
            typeof isOffsetDragRegionWaveformPreviewActive !== 'function' ||
            !isOffsetDragRegionWaveformPreviewActive()
        ) {
            return false;
        }
        const track = { type: 'extra', slot };
        const hasOverlap = trackHasCrossfadeOverlapForWaveformPreview(track);
        if (!offsetDragCrossfadeWaveformDrawnBySlot) {
            offsetDragCrossfadeWaveformDrawnBySlot = Object.create(null);
        }
        const wasDrawn = !!offsetDragCrossfadeWaveformDrawnBySlot[slot];
        if (hasOverlap) {
            offsetDragCrossfadeWaveformDrawnBySlot[slot] = true;
            return true;
        }
        if (wasDrawn) {
            delete offsetDragCrossfadeWaveformDrawnBySlot[slot];
            return true;
        }
        return false;
    }

    function clearOffsetDragCrossfadeWaveformDrawnState(slot) {
        if (!offsetDragCrossfadeWaveformDrawnBySlot) return;
        if (typeof slot === 'number' && slot >= 0) {
            delete offsetDragCrossfadeWaveformDrawnBySlot[slot];
        } else {
            offsetDragCrossfadeWaveformDrawnBySlot = null;
        }
    }

    function isSplitBoundaryRegionDragActive() {
        return !!(regionHandleDragActive && regionHandleDragSplitBoundary);
    }

    /** リージョン平行移動ドラッグ中（overlay 専用処理用） */
    function isOffsetDragRegionWaveformPreviewActive() {
        const lanes =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        return (
            lanes &&
            lanes.classList.contains('audio-waveform-composite__lanes--offset-drag')
        );
    }

    function regionOffsetDragMemberKey(slot, segmentIndex) {
        return (slot | 0) + ':' + (segmentIndex | 0);
    }

    function setRegionOffsetDragPreviewHeadSec(sec) {
        waveformOffsetDragPreviewHeadSec = Number(sec) || 0;
    }

    /** 平行移動ドラッグ中 — ポインタ基準の枠 [In, Out]（t0 未更新でも追従） */
    function getSegmentRegionOffsetDragPreviewInterval(track, segmentIndex) {
        if (!isOffsetDragRegionWaveformPreviewActive()) return null;
        const indices = collectOffsetDragSegmentIndicesForTrack(track);
        if (!indices || !indices.has(segmentIndex)) return null;
        if (!Number.isFinite(waveformOffsetDragPreviewHeadSec)) return null;

        const key = regionOffsetDragMemberKey(
            typeof getTrackOffsetDragSlot === 'function'
                ? getTrackOffsetDragSlot(track)
                : track.slot | 0,
            segmentIndex,
        );
        let span = NaN;
        if (
            waveformOffsetDragGroupStartRegionSpanByKey &&
            Number.isFinite(waveformOffsetDragGroupStartRegionSpanByKey[key])
        ) {
            span = waveformOffsetDragGroupStartRegionSpanByKey[key];
        } else if (Number.isFinite(waveformOffsetDragStartRegionSpanSec)) {
            span = waveformOffsetDragStartRegionSpanSec;
        }
        if (!(span > 0.00001)) {
            const iv = getSegmentRegionTimelineInterval(track, segmentIndex);
            span = Math.max(0.001, iv.end - iv.start);
        }

        let head = waveformOffsetDragPreviewHeadSec;
        if (
            typeof waveformOffsetDragGroupMembers !== 'undefined' &&
            waveformOffsetDragGroupMembers &&
            waveformOffsetDragGroupMembers.length > 1 &&
            waveformOffsetDragGroupStartRegionInByKey &&
            waveformOffsetDragGroupStartTimelineByKey &&
            typeof waveformOffsetDragSlot === 'number' &&
            typeof waveformOffsetDragSegmentIndex === 'number' &&
            waveformOffsetDragSegmentIndex >= 0
        ) {
            const primaryKey = regionOffsetDragMemberKey(
                waveformOffsetDragSlot,
                waveformOffsetDragSegmentIndex,
            );
            const primaryStart = waveformOffsetDragGroupStartTimelineByKey[primaryKey];
            const memberStart = waveformOffsetDragGroupStartRegionInByKey[key];
            if (Number.isFinite(primaryStart) && Number.isFinite(memberStart)) {
                head = memberStart + (waveformOffsetDragPreviewHeadSec - primaryStart);
            }
        }
        return { start: head, end: head + span };
    }

    /** 平行移動プレビュー中 — 波形描画位置を枠（preview）に合わせる delta（重なり時のみ） */
    function getSegmentWaveformDrawTimelineDelta(track, segmentIndex) {
        if (typeof getSegmentRegionOffsetDragPreviewInterval !== 'function') return 0;
        if (
            typeof isOffsetDragRegionWaveformPreviewActive !== 'function' ||
            !isOffsetDragRegionWaveformPreviewActive()
        ) {
            return 0;
        }
        if (
            typeof trackHasCrossfadeOverlapForWaveformPreview === 'function' &&
            !trackHasCrossfadeOverlapForWaveformPreview(track)
        ) {
            return 0;
        }
        const preview = getSegmentRegionOffsetDragPreviewInterval(track, segmentIndex);
        if (!preview) return 0;
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        return preview.start - regionIn;
    }

    window.setRegionOffsetDragPreviewHeadSec = setRegionOffsetDragPreviewHeadSec;
    window.getSegmentRegionOffsetDragPreviewInterval =
        getSegmentRegionOffsetDragPreviewInterval;
    window.getSegmentWaveformDrawTimelineDelta = getSegmentWaveformDrawTimelineDelta;
    window.getSegmentCrossfadeProbeInterval = getSegmentCrossfadeProbeInterval;

    /** 平行移動ドラッグ中の対象セグメント index（当該トラックのみ）。なければ null */
    function collectOffsetDragSegmentIndicesForTrack(track) {
        if (
            typeof waveformOffsetDragActive === 'undefined' ||
            !waveformOffsetDragActive ||
            !isOffsetDragRegionWaveformPreviewActive()
        ) {
            return null;
        }
        const indices = new Set();
        const matchesTrack =
            typeof offsetDragSlotMatchesTrack === 'function'
                ? (dragSlot) => offsetDragSlotMatchesTrack(dragSlot, track)
                : isExtraTrackRef(track)
                  ? (dragSlot) => dragSlot === track.slot
                  : () => false;
        if (!isExtraTrackRef(track) && !isVideoTrackRef(track)) return null;
        if (
            typeof waveformOffsetDragGroupMembers !== 'undefined' &&
            waveformOffsetDragGroupMembers &&
            waveformOffsetDragGroupMembers.length
        ) {
            for (let i = 0; i < waveformOffsetDragGroupMembers.length; i++) {
                const m = waveformOffsetDragGroupMembers[i];
                if (m && matchesTrack(m.slot) && Number.isFinite(m.segmentIndex)) {
                    indices.add(m.segmentIndex | 0);
                }
            }
        } else if (
            typeof waveformOffsetDragSegmentIndex === 'number' &&
            waveformOffsetDragSegmentIndex >= 0 &&
            typeof waveformOffsetDragSlot === 'number' &&
            matchesTrack(waveformOffsetDragSlot)
        ) {
            indices.add(waveformOffsetDragSegmentIndex | 0);
        }
        return indices.size ? indices : null;
    }

    /** 平行移動中の同一グループ内ペア — 外部リージョンとのクロス判定から除外 */
    function isIntraOffsetDragMemberCrossfadePair(track, segmentIndexA, segmentIndexB) {
        const dragIndices = collectOffsetDragSegmentIndicesForTrack(track);
        if (!dragIndices) return false;
        return dragIndices.has(segmentIndexA) && dragIndices.has(segmentIndexB);
    }

    function isSplitBoundaryAdjacentToOffsetDragSegments(boundaryIndex, dragIndices) {
        const b = boundaryIndex | 0;
        return dragIndices.has(b) || dragIndices.has(b + 1);
    }

    /** geometryOnly ドラッグ中でも波形プレビューが必要なとき（フェードハンドル / 重なり開始） */
    function needsCrossfadeWaveformPreviewDuringGeometryDrag(slot, opt) {
        if (isSplitBoundaryRegionDragActive()) return false;
        if (isCrossfadeHandleDragActive()) return true;
        if (!isRegionGeometryOnlyDrag(opt)) return false;
        if (!(typeof slot === 'number' && slot >= 0)) return false;
        return trackHasCrossfadeOverlapForWaveformPreview({ type: 'extra', slot });
    }

    /** In/Out ハンドル — ソース In/Out または region In が変わるので波形を追従描画 */
    function needsRegionEdgeWaveformPreviewDuringGeometryDrag(slot, opt) {
        if (!isRegionGeometryOnlyDrag(opt)) return false;
        if (!(typeof slot === 'number' && slot >= 0)) return false;
        if (
            regionHandleDragActive &&
            (regionHandleDragKind === 'in' || regionHandleDragKind === 'out')
        ) {
            return true;
        }
        return false;
    }

    function needsWaveformPreviewDuringRegionGeometryDrag(slot, opt) {
        return (
            needsCrossfadeWaveformPreviewDuringGeometryDrag(slot, opt) ||
            needsRegionEdgeWaveformPreviewDuringGeometryDrag(slot, opt)
        );
    }

    /** ドラッグ中の軽量更新（フェード＝クロスフェードプレビューは除く） */
    function isRegionGeometryOnlyDrag(opt) {
        if (opt && opt.geometryOnly === false) return false;
        if (opt && opt.geometryOnly) return true;
        if (regionHandleDragActive && !isCrossfadeHandleDragActive()) return true;
        return false;
    }

    /** 重なり区間に関与するセグメント index（高解像度ピーク更新用） */
    function collectCrossfadeOverlapSegmentIndices(track) {
        const segments = getTrackSegments(track);
        const indices = new Set();
        const minOverlap =
            typeof window.MIN_CROSSFADE_OVERLAP_SEC === 'number'
                ? window.MIN_CROSSFADE_OVERLAP_SEC
                : 0.005;
        for (let i = 0; i < segments.length; i++) {
            for (let j = i + 1; j < segments.length; j++) {
                if (isIntraOffsetDragMemberCrossfadePair(track, i, j)) {
                    continue;
                }
                const ivI = getSegmentCrossfadeProbeInterval(track, i);
                const ivJ = getSegmentCrossfadeProbeInterval(track, j);
                const oStart = Math.max(ivI.start, ivJ.start);
                const oEnd = Math.min(ivI.end, ivJ.end);
                if (oEnd - oStart >= minOverlap) {
                    indices.add(i);
                    indices.add(j);
                }
            }
        }
        return Array.from(indices).sort((a, b) => a - b);
    }

    function redrawCrossfadeWaveformPreviewDuringGeometryDrag(slot, opt) {
        if (!(typeof slot === 'number' && slot >= 0)) return;
        const track = { type: 'extra', slot };
        const refreshOpt = {};
        if (opt && typeof opt.segmentIndex === 'number' && opt.segmentIndex >= 0) {
            refreshOpt.segmentIndex = opt.segmentIndex;
        }
        if (!isCrossfadeHandleDragActive()) {
            const overlapSegs = collectCrossfadeOverlapSegmentIndices(track);
            if (overlapSegs.length) {
                refreshOpt.affectedSegmentIndices = overlapSegs;
            }
        }
        let usedViewport = false;
        if (typeof refreshExtraTrackViewportPeaksForRegionEdit === 'function') {
            usedViewport = refreshExtraTrackViewportPeaksForRegionEdit(slot, refreshOpt);
        }
        if (!usedViewport) {
            clearExtraTrackViewportPeaksForSlot(slot);
            if (typeof invalidateWaveformViewportPeaksForRegionEdit === 'function') {
                invalidateWaveformViewportPeaksForRegionEdit({
                    slot,
                    clearTrackTiles: true,
                });
            }
        }
        if (typeof drawExtraTrackWaveform === 'function') {
            drawExtraTrackWaveform(slot);
        }
        if (typeof scheduleWaveformHiresRedrawAfterZoom === 'function') {
            scheduleWaveformHiresRedrawAfterZoom({ slots: [slot] });
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (typeof applyReviewMixCrossfadeGainsIfNeeded === 'function') {
            applyReviewMixCrossfadeGainsIfNeeded();
        }
    }

    function redrawAfterRegionChange(slot, opt) {
        const geometryOnly = isRegionGeometryOnlyDrag(opt);
        const waveformPreview = needsWaveformPreviewDuringRegionGeometryDrag(slot, opt);
        if (geometryOnly && !waveformPreview) {
            return;
        }
        if (geometryOnly && waveformPreview) {
            if (
                typeof isOffsetDragRegionWaveformPreviewActive === 'function' &&
                isOffsetDragRegionWaveformPreviewActive() &&
                needsCrossfadeWaveformPreviewDuringGeometryDrag(slot, opt)
            ) {
                if (typeof drawExtraTrackWaveform === 'function') {
                    drawExtraTrackWaveform(slot);
                }
                if (typeof applyReviewMixCrossfadeGainsIfNeeded === 'function') {
                    applyReviewMixCrossfadeGainsIfNeeded();
                }
                return;
            }
            if (needsCrossfadeWaveformPreviewDuringGeometryDrag(slot, opt)) {
                redrawCrossfadeWaveformPreviewDuringGeometryDrag(slot, opt);
            } else if (typeof drawExtraTrackWaveform === 'function') {
                drawExtraTrackWaveform(slot);
            }
            return;
        }

        const dragging = !!regionHandleDragActive || geometryOnly;
        const structureChanged = !!(opt && opt.segmentStructureChanged);
        let usedViewportRefresh = false;
        if (typeof slot === 'number' && slot >= 0) {
            if (structureChanged) {
                clearExtraTrackViewportPeaksForSlot(slot);
            } else if (typeof refreshExtraTrackViewportPeaksForRegionEdit === 'function') {
                usedViewportRefresh = refreshExtraTrackViewportPeaksForRegionEdit(slot, opt);
            }
            if (!usedViewportRefresh) {
                clearExtraTrackViewportPeaksForSlot(slot);
            }
        } else if (typeof clearAllExtraWaveformViewportPeaks === 'function') {
            clearAllExtraWaveformViewportPeaks();
        }

        if (!usedViewportRefresh) {
            if (typeof invalidateWaveformViewportPeaksForRegionEdit === 'function') {
                invalidateWaveformViewportPeaksForRegionEdit({
                    slot: typeof slot === 'number' ? slot : -1,
                    clearTrackTiles: true,
                });
            } else {
                if (opt && opt.invalidatePeakCache && typeof clearViewportPeakCache === 'function') {
                    clearViewportPeakCache('regionRenderFallback', { force: true });
                }
                if (typeof invalidateWaveformViewportHiresSpec === 'function') {
                    invalidateWaveformViewportHiresSpec();
                }
            }
        }

        if (
            typeof slot === 'number' &&
            slot >= 0 &&
            typeof drawExtraTrackWaveform === 'function'
        ) {
            drawExtraTrackWaveform(slot);
        } else if (typeof redrawAllExtraTrackWaveforms === 'function') {
            redrawAllExtraTrackWaveforms();
        }

        if (
            !dragging &&
            !(opt && opt.skipHiresSchedule) &&
            typeof scheduleWaveformHiresRedrawAfterZoom === 'function'
        ) {
            const hiresOpt =
                typeof slot === 'number' && slot >= 0 ? { slots: [slot] } : undefined;
            scheduleWaveformHiresRedrawAfterZoom(hiresOpt);
        }
        if (typeof updateRangeLoopOverlay === 'function') updateRangeLoopOverlay();
        if (typeof updateAllWaveformPlayheads === 'function') updateAllWaveformPlayheads();
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            const restoreBusy =
                typeof isSessionRestoreInProgress === 'function' &&
                isSessionRestoreInProgress();
            if (!restoreBusy) {
                notifyMasterTransportDurationChanged();
            }
        }
    }

    /** リハーサルマーク追従 — タイムライン先頭の小節線はスキップ */
    function isRehearsalBarLineAtTimelineStart(transportSec) {
        const t = Number(transportSec);
        return !Number.isFinite(t) || t <= 1e-6;
    }

    function splitAllExtraTrackRegionsAtBarLine(transportSec, opt) {
        if (isRehearsalBarLineAtTimelineStart(transportSec)) return 0;
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return 0;
        const o = opt && typeof opt === 'object' ? opt : {};
        let count = 0;
        const n = getExtraTrackCount();
        for (let slot = 0; slot < n; slot++) {
            if (!isExtraSlotUsableForRegion(slot)) continue;
            const track = { type: 'extra', slot };
            if (!isTrackRegionActive(track)) continue;
            if (!(getTrackSourceDurationSec(track) > PLAYBACK_REGION_MIN_SEC)) continue;
            if (trySplitTrackAtTransportSec(track, t, { skipUndo: true, silent: true })) {
                count++;
            }
        }
        if (count > 0 && !o.silent && typeof writeLog === 'function') {
            writeLog(
                'Rehearsal mark: split regions at ' +
                    t.toFixed(3) +
                    ' s (' +
                    count +
                    ' track' +
                    (count === 1 ? '' : 's') +
                    ')',
            );
        }
        return count;
    }

    window.isRehearsalBarLineAtTimelineStart = isRehearsalBarLineAtTimelineStart;
    window.splitAllExtraTrackRegionsAtBarLine = splitAllExtraTrackRegionsAtBarLine;
    window.trySplitTrackAtTransportSec = trySplitTrackAtTransportSec;
    window.getActiveMixExtraSlotFromDom = getActiveMixExtraSlotFromDom;
    window.needsCrossfadeWaveformPreviewDuringGeometryDrag =
        needsCrossfadeWaveformPreviewDuringGeometryDrag;
    window.needsRegionEdgeWaveformPreviewDuringGeometryDrag =
        needsRegionEdgeWaveformPreviewDuringGeometryDrag;
    window.needsWaveformPreviewDuringRegionGeometryDrag =
        needsWaveformPreviewDuringRegionGeometryDrag;
    window.trackHasCrossfadeOverlapForWaveformPreview =
        trackHasCrossfadeOverlapForWaveformPreview;
    window.shouldRedrawWaveformDuringOffsetDrag = shouldRedrawWaveformDuringOffsetDrag;
    window.clearOffsetDragCrossfadeWaveformDrawnState =
        clearOffsetDragCrossfadeWaveformDrawnState;
