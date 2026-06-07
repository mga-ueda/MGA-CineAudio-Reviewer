/**
 * extra-audio-slot-transfer.js — スロット入替・データ移行
 */
    function extraSlotHasShownLanesAbove(slot) {
        for (let i = slot + 1; i < EXTRA_TRACK_COUNT; i++) {
            if (isExtraTrackLaneShown(i)) return true;
        }
        return false;
    }

    function cloneExtraTrackClips(clips) {
        if (!clips || !clips.length) return [];
        return clips.map((c) => ({
            id: c.id,
            file: c.file,
            buffer: c.buffer,
            peaks: c.peaks,
            persistBlob: c.persistBlob,
            name: c.name,
        }));
    }

    function transferSessionMixRestoreEntry(fromSlot, toSlot) {
        if (!sessionMixRestore || !Array.isArray(sessionMixRestore.extra)) return;
        const entry = sessionMixRestore.extra.find((e) => e && e.slot === fromSlot);
        sessionMixRestore.extra = sessionMixRestore.extra.filter(
            (e) => !e || e.slot !== toSlot,
        );
        if (entry) entry.slot = toSlot;
    }

    function transferExtraTrackPlaybackRegions(fromSlot, toSlot) {
        const srcTr = extraTrackBySlot(fromSlot);
        const dstTr = extraTrackBySlot(toSlot);
        const toTrack = { type: 'extra', slot: toSlot };
        if (typeof clearTrackRegion === 'function') {
            clearTrackRegion(toTrack, { silent: true, skipUndo: true });
        }
        if (
            !srcTr ||
            !dstTr ||
            !srcTr.playbackRegions ||
            !srcTr.playbackRegions.active ||
            !srcTr.playbackRegions.segments.length
        ) {
            return;
        }
        dstTr.playbackRegions = JSON.parse(JSON.stringify(srcTr.playbackRegions));
        delete dstTr.region;
        if (typeof updateTrackRegionOverlay === 'function') {
            updateTrackRegionOverlay(toTrack);
        }
    }

    function transferExtraTrackSlotContent(fromSlot, toSlot, opt) {
        if (fromSlot === toSlot) return;
        const src = extraTrackBySlot(fromSlot);
        const dst = extraTrackBySlot(toSlot);
        if (!src || !dst) return;

        stopExtraTrackAllSources(fromSlot);
        stopExtraTrackAllSources(toSlot);
        dst.loadGen += 1;

        dst.file = src.file;
        dst.buffer = src.buffer;
        dst.peaks = src.peaks;
        dst.peakPyramid = src.peakPyramid || null;
        dst.peakPyramidGen = src.peakPyramidGen || 0;
        // Force viewport peaks rebuild for the moved slot to avoid stale view slices.
        dst.viewportPeaks = null;
        if (dst.clips) {
            for (let ci = 0; ci < dst.clips.length; ci++) {
                const clip = dst.clips[ci];
                if (clip) clip.peaks = null;
            }
        }
        dst.persistBlob = src.persistBlob;
        dst.restoreDurationHint = src.restoreDurationHint;
        dst.timelineStartSec = src.timelineStartSec;
        dst.clips = cloneExtraTrackClips(src.clips);
        dst.segmentSources = {};
        dst.muted = src.muted;
        dst.solo = src.solo;
        dst.volLinear = src.volLinear;
        transferSessionMixRestoreEntry(fromSlot, toSlot);
        transferExtraTrackPlaybackRegions(fromSlot, toSlot);
        applyExtraTrackLaneGain(toSlot);

        const loaded = extraTrackSlotHasContent(toSlot);
        setExtraTrackLoaded(toSlot, loaded, { skipLayoutRefresh: true });
        if (loaded) {
            setExtraTrackStatus(toSlot, 'Ready');
        } else {
            setExtraTrackStatus(toSlot, 'Not Loaded');
        }
        refreshExtraTrackUi(toSlot);
        const uiDest = getExtraUi(toSlot);
        if (
            loaded &&
            dst.buffer &&
            typeof scheduleWaveformTrackLkfsMeasure === 'function' &&
            uiDest &&
            uiDest.track
        ) {
            void scheduleWaveformTrackLkfsMeasure(uiDest.track, dst.buffer);
        }
        if (typeof bumpRegionPersistEpoch === 'function') {
            bumpRegionPersistEpoch(toSlot);
        }
        if (opt && opt.wipeSource) {
            wipeExtraTrackSlotContent(fromSlot, { keepMix: true });
        }
    }

    function wipeExtraTrackSlotContent(slot, opt) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return false;
        const hadContent = extraTrackSlotHasContent(slot);
        stopExtraTrackAllSources(slot);
        tr.loadGen += 1;
        if (typeof clearTrackRegion === 'function') {
            clearTrackRegion(
                { type: 'extra', slot },
                { silent: true, skipUndo: true, skipOverlay: true, skipRedraw: true },
            );
        }
        tr.clips = [];
        tr.segmentSources = {};
        tr.file = null;
        tr.buffer = null;
        tr.peaks = null;
        tr.peakPyramid = null;
        tr.viewportPeaks = null;
        tr.persistBlob = null;
        tr.restoreDurationHint = 0;
        tr.timelineStartSec = 0;
        tr.playbackRegions = { active: false, segments: [], headPadSec: 0 };
        delete tr.region;
        if (!opt || !opt.keepMix) {
            resetExtraTrackMixToDefault(slot);
        }
        try {
            if (tr.analyser) tr.analyser.disconnect();
        } catch (_) {}
        tr.analyser = null;
        setExtraTrackLoaded(slot, false, { skipLayoutRefresh: true });
        setExtraTrackStatus(slot, 'Not Loaded');
        const uiClear = getExtraUi(slot);
        if (typeof clearWaveformTrackLkfs === 'function' && uiClear && uiClear.track) {
            clearWaveformTrackLkfs(uiClear.track);
        }
        refreshExtraTrackUi(slot, {
            skipDraw: !!(opt && opt.skipDraw),
            skipRegionOverlay: !!(opt && opt.skipRegionOverlay),
        });
        if (typeof syncExtraTrackWaveformLoading === 'function') {
            syncExtraTrackWaveformLoading(slot);
        }
        return hadContent;
    }

    /** レーン詰め替え後: 概要ピーク・高解像度 viewport ピークを再構築する */
    function refreshExtraTrackWaveformsAfterLaneCompaction() {
        const slots = [];
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!extraTrackSlotHasContent(i)) continue;
            slots.push(i);
            if (typeof rebuildExtraTrackPeaksIfNeeded === 'function') {
                rebuildExtraTrackPeaksIfNeeded(i);
            }
        }
        if (!slots.length) return;
        if (typeof invalidateWaveformViewportHiresSpec === 'function') {
            invalidateWaveformViewportHiresSpec();
        }
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const opt = { slots };
                if (typeof applyWaveformViewportPeaksImmediate === 'function') {
                    applyWaveformViewportPeaksImmediate(opt);
                }
                if (typeof drawAudioWaveformCanvas === 'function') {
                    drawAudioWaveformCanvas();
                }
                for (let j = 0; j < slots.length; j++) {
                    drawExtraTrackWaveform(slots[j]);
                }
                if (typeof scheduleWaveformHiresRedrawAfterZoom === 'function') {
                    scheduleWaveformHiresRedrawAfterZoom(opt);
                }
            });
        });
    }

    function compactExtraTracksAfterClear(clearedSlot) {
        stopAllExtraTrackSources();
        let dest = clearedSlot;
        for (let src = clearedSlot + 1; src < EXTRA_TRACK_COUNT; src++) {
            if (!isExtraTrackLaneShown(src)) continue;
            if (dest !== src) {
                if (extraTrackSlotHasContent(src)) {
                    transferExtraTrackSlotContent(src, dest, { wipeSource: true });
                }
                extraLaneUiOpen[dest] = extraLaneUiOpen[src];
            }
            dest++;
        }
        for (let i = dest; i < EXTRA_TRACK_COUNT; i++) {
            wipeExtraTrackSlotContent(i);
            extraLaneUiOpen[i] = false;
            setExtraTrackLaneUiOpen(i, false, { deferLayout: true, skipPersist: true });
        }
        for (let i = clearedSlot; i < dest; i++) {
            setExtraTrackLaneUiOpen(i, true, { deferLayout: true, skipPersist: true });
        }
        if (typeof clearExtraTrackVolumeUnityHold === 'function') {
            clearExtraTrackVolumeUnityHold();
        }
        if (typeof remapRegionPersistMetadataAfterExtraTrackCompaction === 'function') {
            remapRegionPersistMetadataAfterExtraTrackCompaction(clearedSlot);
        }
        for (let i = clearedSlot; i < dest; i++) {
            if (!extraTrackSlotHasContent(i)) continue;
            if (typeof updateTrackRegionOverlay === 'function') {
                updateTrackRegionOverlay({ type: 'extra', slot: i });
            }
            drawExtraTrackWaveform(i);
        }
    }

    function clearExtraTrack(slot) {
        if (typeof canHideAnyWaveformLane === 'function' && !canHideAnyWaveformLane()) {
            return;
        }
        const tr = extraTrackBySlot(slot);
        if (!tr) return;
        const hadContent = extraTrackSlotHasContent(slot);
        const shouldCompact = extraSlotHasShownLanesAbove(slot);

        if (shouldCompact) {
            compactExtraTracksAfterClear(slot);
            if (typeof refreshTrackLaneControlsUi === 'function') {
                refreshTrackLaneControlsUi();
            }
            if (typeof refreshReviewMixUi === 'function') {
                refreshReviewMixUi();
            }
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
            if (typeof syncExtraAudioToTransport === 'function') {
                syncExtraAudioToTransport({ force: true });
            }
            if (hadContent && typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
            if (typeof schedulePersistExtraTrackLayout === 'function') {
                schedulePersistExtraTrackLayout();
            } else if (typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
        } else {
            wipeExtraTrackSlotContent(slot);
            extraLaneUiOpen[slot] = false;
            setExtraTrackLaneUiOpen(slot, false, { deferLayout: true, skipPersist: false });
            if (typeof refreshTrackLaneControlsUi === 'function') {
                refreshTrackLaneControlsUi();
            }
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
            if (hadContent && typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
            if (hadContent && typeof removeExtraTrackFromSession === 'function') {
                void removeExtraTrackFromSession(slot);
            } else if (hadContent && typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
        }

        refreshExtraTrackAddLaneButtons();
        if (typeof refreshExportMediaOptionsUi === 'function') {
            refreshExportMediaOptionsUi();
        }
        if (shouldCompact || hadContent) {
            refreshExtraTrackWaveformsAfterLaneCompaction();
        }
    }

    function clearAllExtraTracks() {
        stopAllExtraTrackSources();
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            wipeExtraTrackSlotContent(i, { keepMix: true, skipDraw: true, skipRegionOverlay: true });
            extraLaneUiOpen[i] = false;
            setExtraTrackLaneUiOpen(i, false, { deferLayout: true, skipPersist: true });
        }
        if (typeof clearExtraTrackVolumeUnityHold === 'function') {
            clearExtraTrackVolumeUnityHold();
        }
        if (typeof refreshTrackLaneControlsUi === 'function') {
            refreshTrackLaneControlsUi();
        }
        if (typeof refreshReviewMixUi === 'function') {
            refreshReviewMixUi();
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        try {
            if (typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
        } catch (err) {
            writeLog(
                'Session: clear notify failed — ' +
                    (err && err.message ? err.message : String(err)),
            );
        }
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (typeof removeExtraTrackFromSession === 'function') {
                void removeExtraTrackFromSession(i);
            }
        }
        if (typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        refreshExtraTrackAddLaneButtons();
        if (typeof refreshExportMediaOptionsUi === 'function') {
            refreshExportMediaOptionsUi();
        }
        if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
    }

    function resetVideoMix() {
        videoMix.muted = false;
        videoMix.solo = false;
        videoMix.volLinear = 1;
        refreshReviewMixUi();
    }


