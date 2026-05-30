/**
 * extra-audio-waveform.js — Ex 波形描画・レーン表示・可視性。
 */
    function drawExtraTrackWaveform(slot) {
        const ui = getExtraUi(slot);
        const tr = extraTrackBySlot(slot);
        if (!ui || !ui.canvas) return;
        if (tr && tr.buffer && (!tr.peaks || tr.peaks.length < 1)) {
            rebuildExtraTrackPeaksIfNeeded(slot);
        }
        const sized = syncExtraCanvasSize(ui);
        if (!sized || !sized.ctx) return;
        const { ctx, wCss, hCss } = sized;
        const audible =
            typeof isExtraTrackAudible === 'function' ? isExtraTrackAudible(slot) : true;
        const grad =
            typeof timelineWaveformFillGradient === 'function'
                ? timelineWaveformFillGradient(ctx, hCss, 'extra', audible)
                : null;
        const timelineStartSec = getExtraTrackTimelineStartSec(slot);
        const drawOpt = { timelineStartSec };
        if (tr && tr.viewportPeaks) {
            if (tr.viewportPeaks.segments && tr.viewportPeaks.segments.length === 1) {
                drawOpt.viewportPeaks = tr.viewportPeaks.segments[0];
            } else if (tr.viewportPeaks.peaks) {
                drawOpt.viewportPeaks = tr.viewportPeaks;
            }
        }
        if (typeof drawExtraTrackWaveformRegions === 'function') {
            drawExtraTrackWaveformRegions(ctx, wCss, hCss, slot, grad);
        } else {
            drawPeaksForMasterTimeline(
                ctx,
                tr ? tr.peaks : null,
                wCss,
                hCss,
                extraTrackContentDurationSec(slot),
                grad,
                drawOpt,
            );
        }
    }

    function redrawAllExtraTrackWaveforms() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) drawExtraTrackWaveform(i);
    }

    function clearAllExtraWaveformViewportPeaks() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const tr = extraTrackBySlot(i);
            if (tr) tr.viewportPeaks = null;
        }
    }

    function rebuildAllExtraWaveformViewportPeaks(spec, opt) {
        if (!spec) {
            clearAllExtraWaveformViewportPeaks();
            return;
        }
        const slots =
            opt && Array.isArray(opt.slots) && opt.slots.length
                ? opt.slots
                : getVisibleLoadedExtraTrackSlots();
        for (let j = 0; j < slots.length; j++) {
            const i = slots[j];
            if (typeof rebuildExtraTrackRegionViewportPeaks === 'function') {
                rebuildExtraTrackRegionViewportPeaks(i, spec);
            } else {
                const tr = extraTrackBySlot(i);
                if (tr) tr.viewportPeaks = null;
            }
        }
    }


    /** レーン表示直後は clientWidth が 0 のことがあるため、レイアウト確定まで再試行する。 */
    function scheduleExtraTrackWaveformRedraw(slot, opt) {
        const ensureOpt = {
            notifyMaster: !!(opt && opt.notifyMaster),
            maxFrames: opt && opt.maxFrames > 0 ? opt.maxFrames : undefined,
        };
        if (slot >= 0 && slot < EXTRA_TRACK_COUNT) {
            ensureOpt.slots = [slot];
        }
        ensureExtraTrackWaveformsDrawn(ensureOpt);
    }

    function setExtraTrackStatus(slot, text) {
        const ui = getExtraUi(slot);
        if (ui && ui.status) {
            if (typeof applyLaneStatusEl === 'function') {
                applyLaneStatusEl(ui.status, text);
            } else {
                ui.status.textContent = text || '';
                ui.status.hidden = true;
            }
        }
        const tr = extraTrackBySlot(slot);
        const label = getExtraTrackDisplayLabel(slot, tr);
        if (ui && ui.title) {
            ui.title.textContent = label;
            ui.title.title = buildTrackTitleTooltip(label, tr ? tr.file : null, text);
        }
    }

    function setExtraTrackLoaded(slot, loaded, opt) {
        const ui = getExtraUi(slot);
        if (ui && ui.meta) ui.meta.classList.toggle('loaded', !!loaded);
        if (typeof refreshAudioWaveformCompositeLoadedState === 'function') {
            refreshAudioWaveformCompositeLoadedState();
        }
        if (loaded && typeof syncAudioOnlyMarkersUi === 'function') {
            syncAudioOnlyMarkersUi();
        }
        applyExtraTrackLaneVisibility(slot);
        if (!opt || !opt.skipLayoutRefresh) {
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
        }
    }

    function extraTrackSlotHasContent(slot) {
        if (isExtraTrackLoaded(slot)) return true;
        const track = { type: 'extra', slot };
        if (
            typeof isTrackRegionActive === 'function' &&
            isTrackRegionActive(track)
        ) {
            return true;
        }
        const tr = extraTrackBySlot(slot);
        if (!tr) return false;
        const clips = tr.clips;
        if (clips && clips.length) {
            for (const c of clips) {
                if (c.buffer && c.buffer.duration > 0) return true;
            }
        }
        if (tr.peaks && tr.peaks.length) {
            const hint = Number(tr.restoreDurationHint);
            if (Number.isFinite(hint) && hint > 0) return true;
            if (tr.buffer && tr.buffer.duration > 0) return true;
        }
        return false;
    }

    function isExtraTrackLaneShown(slot) {
        if (extraTrackSlotHasContent(slot)) return true;
        return !!extraLaneUiOpen[slot];
    }

    /** リロード後: 波形・リージョンのない Ex レーンを閉じ、最低 1 レーンは残す */
    function syncExtraLaneVisibilityAfterSessionRestore() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!extraTrackSlotHasContent(i)) {
                extraLaneUiOpen[i] = false;
            } else {
                extraLaneUiOpen[i] = true;
            }
            applyExtraTrackLaneVisibility(i);
        }
        if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        refreshExtraTrackAddLaneButtons();
    }

    function canRevealNextExtraTrackLane(fromSlot) {
        for (let i = fromSlot + 1; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackLaneShown(i)) return true;
        }
        return false;
    }

    function revealNextExtraTrackLane(fromSlot) {
        for (let i = fromSlot + 1; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackLaneShown(i)) {
                setExtraTrackLaneUiOpen(i, true);
                setExtraTrackStatus(i, 'Not Loaded');
                refreshExtraTrackUi(i);
                writeLog('Ex ' + (i + 1) + ': track lane opened');
                return i;
            }
        }
        writeLog('Extra audio: maximum track count reached');
        return -1;
    }

    function handleExtraTrackAddShortcutKeydown(e) {
        if (!matchUserShortcut(e, 'addExtraTrack')) {
            return false;
        }
        e.preventDefault();
        revealNextExtraTrackLane(-1);
        refreshExtraTrackAddLaneButtons();
        return true;
    }

    function refreshVideoAudioAddTrackButton() {
        const btn = document.getElementById('videoAudioAddTrackBtn');
        if (!btn) return;
        const videoLaneShown =
            typeof isVideoAudioLaneShown === 'function' && isVideoAudioLaneShown();
        const canAdd = canRevealNextExtraTrackLane(-1);
        btn.hidden = !videoLaneShown || !canAdd;
        btn.disabled = !canAdd;
    }

    const EXTRA_CLEAR_TITLE_ENABLED = 'レーンを非表示';
    const EXTRA_CLEAR_TITLE_DISABLED = '最後の1トラックは非表示にできません';

    function refreshExtraTrackClearButtons() {
        const canClear =
            typeof canHideAnyWaveformLane === 'function' && canHideAnyWaveformLane();
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            const ui = getExtraUi(slot);
            if (!ui || !ui.clearBtn) continue;
            const laneShown = isExtraTrackLaneShown(slot);
            ui.clearBtn.disabled = !laneShown || !canClear;
            ui.clearBtn.title =
                canClear && laneShown ? EXTRA_CLEAR_TITLE_ENABLED : EXTRA_CLEAR_TITLE_DISABLED;
        }
    }

    function refreshExtraTrackAddLaneButtons() {
        refreshVideoAudioAddTrackButton();
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            const ui = getExtraUi(slot);
            if (!ui || !ui.addTrackBtn) continue;
            const canAdd = canRevealNextExtraTrackLane(slot);
            ui.addTrackBtn.disabled = !canAdd;
            ui.addTrackBtn.hidden = slot >= EXTRA_TRACK_COUNT - 1 && !canAdd;
        }
        refreshExtraTrackClearButtons();
        refreshExtraTrackMoveButtons();
    }

    function findShownExtraTrackSlotAbove(slot) {
        for (let i = slot - 1; i >= 0; i--) {
            if (isExtraTrackLaneShown(i)) return i;
        }
        return -1;
    }

    function findShownExtraTrackSlotBelow(slot) {
        for (let i = slot + 1; i < EXTRA_TRACK_COUNT; i++) {
            if (isExtraTrackLaneShown(i)) return i;
        }
        return -1;
    }

    function refreshExtraTrackMoveButtons() {
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            const ui = getExtraUi(slot);
            if (!ui) continue;
            const shown = isExtraTrackLaneShown(slot);
            const upSlot = findShownExtraTrackSlotAbove(slot);
            const downSlot = findShownExtraTrackSlotBelow(slot);
            if (ui.moveUpBtn) ui.moveUpBtn.disabled = !shown || upSlot < 0;
            if (ui.moveDownBtn) ui.moveDownBtn.disabled = !shown || downSlot < 0;
        }
    }

    function swapExtraTrackSlots(aSlot, bSlot) {
        if (
            !Number.isInteger(aSlot) ||
            !Number.isInteger(bSlot) ||
            aSlot < 0 ||
            bSlot < 0 ||
            aSlot >= EXTRA_TRACK_COUNT ||
            bSlot >= EXTRA_TRACK_COUNT ||
            aSlot === bSlot
        ) {
            return false;
        }
        stopAllExtraTrackSources();
        const tmpTrack = extraTracks[aSlot];
        extraTracks[aSlot] = extraTracks[bSlot];
        extraTracks[bSlot] = tmpTrack;
        const tmpOpen = extraLaneUiOpen[aSlot];
        extraLaneUiOpen[aSlot] = extraLaneUiOpen[bSlot];
        extraLaneUiOpen[bSlot] = tmpOpen;
        if (typeof swapRegionPersistMetadataBetweenExtraTrackSlots === 'function') {
            swapRegionPersistMetadataBetweenExtraTrackSlots(aSlot, bSlot);
        }
        applyExtraTrackLaneVisibility(aSlot);
        applyExtraTrackLaneVisibility(bSlot);
        refreshExtraTrackUi(aSlot);
        refreshExtraTrackUi(bSlot);
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
        if (typeof schedulePersistExtraTrackLayout === 'function') {
            schedulePersistExtraTrackLayout();
        } else if (typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        return true;
    }

    function moveExtraTrackSlot(slot, direction) {
        if (!isExtraTrackLaneShown(slot)) return false;
        const target =
            direction < 0
                ? findShownExtraTrackSlotAbove(slot)
                : findShownExtraTrackSlotBelow(slot);
        if (target < 0) return false;
        if (!swapExtraTrackSlots(slot, target)) return false;
        writeLog(
            'Extra audio track moved: Ex ' +
                (slot + 1) +
                ' ' +
                (direction < 0 ? 'up' : 'down') +
                ' to Ex ' +
                (target + 1),
        );
        return true;
    }

    function applyExtraTrackLaneVisibility(slot) {
        const ui = getExtraUi(slot);
        const show = isExtraTrackLaneShown(slot);
        const laneEl = document.getElementById('extraAudioLane' + slot);
        if (ui && ui.meta) {
            ui.meta.hidden = !show;
            ui.meta.setAttribute('aria-hidden', show ? 'false' : 'true');
        }
        if (laneEl) {
            laneEl.hidden = !show;
            laneEl.setAttribute('aria-hidden', show ? 'false' : 'true');
        }
    }

    function setExtraTrackLaneUiOpen(slot, open, opt) {
        if (slot < 0 || slot >= EXTRA_TRACK_COUNT) return;
        extraLaneUiOpen[slot] = !!open;
        applyExtraTrackLaneVisibility(slot);
        if (!open && typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
        if (!opt || !opt.deferLayout) {
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
        }
        refreshExtraTrackAddLaneButtons();
        if (!opt || !opt.skipPersist) {
            if (typeof schedulePersistSession === 'function') schedulePersistSession();
        }
    }

    /** 表示レーンが 0 のとき空きドロップ枠として Ex レーンを 1 つ再表示 */
    function reviveOneEmptyExtraLane() {
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            if (!isExtraTrackLaneShown(slot)) {
                setExtraTrackLaneUiOpen(slot, true, { deferLayout: true });
                setExtraTrackStatus(slot, 'Not Loaded');
                refreshExtraTrackUi(slot);
                return slot;
            }
        }
        setExtraTrackLaneUiOpen(0, true, { deferLayout: true });
        setExtraTrackStatus(0, 'Not Loaded');
        refreshExtraTrackUi(0);
        return 0;
    }


    function getWaveformLaneUiPersistSnapshot() {
        const extraLanesOpen = [];
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            extraLanesOpen[i] = isExtraTrackLaneShown(i);
        }
        return {
            videoLaneOpen:
                typeof getVideoLaneUiOpen === 'function' ? !!getVideoLaneUiOpen() : true,
            extraLanesOpen,
        };
    }

    function applyWaveformLaneUiPersistSnapshot(snap, opt) {
        if (!snap || typeof snap !== 'object') return false;
        if (typeof setVideoLaneUiOpenFromPersist === 'function') {
            setVideoLaneUiOpenFromPersist(
                typeof snap.videoLaneOpen === 'boolean' ? snap.videoLaneOpen : true,
                { skipRefresh: true },
            );
        }
        if (Array.isArray(snap.extraLanesOpen)) {
            for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
                if (typeof snap.extraLanesOpen[i] === 'boolean') {
                    setExtraTrackLaneUiOpen(i, snap.extraLanesOpen[i], {
                        deferLayout: true,
                        skipPersist: true,
                    });
                }
            }
        }
        refreshAllExtraTrackLaneVisibility();
        if (!opt || !opt.skipRefresh) {
            if (typeof refreshVideoAudioLaneVisibility === 'function') {
                refreshVideoAudioLaneVisibility();
            }
        }
        if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
        return true;
    }

    function applySavedWaveformLaneUi(sessionSnap) {
        let snap = sessionSnap;
        if (!snap && typeof readPrefs === 'function') {
            const p = readPrefs();
            if (p && p.laneUi) snap = p.laneUi;
        }
        if (snap) {
            applyWaveformLaneUiPersistSnapshot(snap);
        } else if (typeof restoreExtraTrackLanesForNewVideo === 'function') {
            restoreExtraTrackLanesForNewVideo();
        }
        if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
    }

    function refreshExtraTrackLaneVisibility(slot) {
        applyExtraTrackLaneVisibility(slot);
    }

    function refreshAllExtraTrackLaneVisibility() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            refreshExtraTrackLaneVisibility(i);
        }
        refreshExtraTrackClearButtons();
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
    }

    /** 新規動画読み込み時: 空き Ex レーンは閉じる（追加は + Add Track またはドロップ） */
    function restoreExtraTrackLanesForNewVideo() {
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            setExtraTrackLaneUiOpen(slot, false, {
                deferLayout: true,
                skipPersist: true,
            });
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        if (typeof restoreVideoAudioLaneForNewVideo === 'function') {
            restoreVideoAudioLaneForNewVideo();
        }
        if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
    }

    /** Video Audio 表示中は中身のない Ex レーンを閉じる（誤って開いた空レーンの後片付け） */
    function hideEmptyExtraLanesWhenVideoAudioVisible() {
        if (typeof isVideoAudioLaneShown !== 'function' || !isVideoAudioLaneShown()) {
            return;
        }
        let changed = false;
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            if (extraTrackSlotHasContent(slot)) continue;
            if (!extraLaneUiOpen[slot]) continue;
            setExtraTrackLaneUiOpen(slot, false, { deferLayout: true, skipPersist: true });
            changed = true;
        }
        if (changed && typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
    }

    /** 読み込み済みなのに Decoding 表示が残っている Ex スロットをクリア */
    function clearStaleExtraTrackDecodingStatus() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackLoaded(i)) continue;
            if (!extraTrackStatusIndicatesDecoding(i)) continue;
            setExtraTrackStatus(i, '');
        }
    }

    function cancelExtraTrackWaveformEnsure() {
        extraWaveformEnsureGen += 1;
    }

    /** セッション復元ロック解除後: マスター尺確定後に Ex リージョンオーバーレイを再同期 */
    function refreshExtraTrackRegionOverlaysAfterSessionRestore() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackLoaded(i)) continue;
            if (typeof updateTrackRegionOverlay === 'function') {
                updateTrackRegionOverlay({ type: 'extra', slot: i });
            }
            drawExtraTrackWaveform(i);
        }
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
    }

    function syncExtraTrackLaneMixVisual(slot) {
        const lane = document.getElementById('extraAudioLane' + slot);
        if (!lane) return;
        const audible =
            typeof isExtraTrackAudible === 'function' ? isExtraTrackAudible(slot) : true;
        const chromeOpacity =
            typeof timelineMixRegionChromeOpacity === 'function'
                ? timelineMixRegionChromeOpacity(audible)
                : audible
                  ? 1
                  : 0.336;
        lane.classList.toggle('audio-waveform-lane--mix-muted', !audible);
        if (audible) {
            lane.style.removeProperty('--timeline-mix-chrome-opacity');
        } else {
            lane.style.setProperty('--timeline-mix-chrome-opacity', String(chromeOpacity));
        }
    }

    function refreshExtraTrackUi(slot) {
        const ui = getExtraUi(slot);
        const tr = extraTrackBySlot(slot);
        if (!ui) return;
        syncExtraTrackLaneMixVisual(slot);
        if (ui.title) {
            const label = getExtraTrackDisplayLabel(slot, tr);
            const st = ui.status ? ui.status.textContent || '' : '';
            ui.title.textContent = label;
            ui.title.title = buildTrackTitleTooltip(label, tr ? tr.file : null, st);
        }
        const hasBuf = !!(tr && tr.buffer);
        if (ui.meta) ui.meta.classList.toggle('loaded', hasBuf);
        if (typeof refreshAudioWaveformCompositeLoadedState === 'function') {
            refreshAudioWaveformCompositeLoadedState();
        }
        if (ui.soloBtn) {
            ui.soloBtn.disabled = !hasBuf;
            setMixBtnState(ui.soloBtn, !!(tr && tr.solo));
        }
        if (ui.muteBtn) {
            ui.muteBtn.disabled = !hasBuf;
            setMixBtnState(ui.muteBtn, !!(tr && tr.muted));
        }
        drawExtraTrackWaveform(slot);
        if (hasBuf && typeof updateTrackRegionOverlay === 'function') {
            updateTrackRegionOverlay({ type: 'extra', slot });
        }
        if (typeof refreshTrackLaneControlsUi === 'function') refreshTrackLaneControlsUi();
        refreshExtraTrackLaneVisibility(slot);
        refreshExtraTrackAddLaneButtons();
    }

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
            clearTrackRegion({ type: 'extra', slot }, { silent: true, skipUndo: true });
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
        refreshExtraTrackUi(slot);
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
            wipeExtraTrackSlotContent(i);
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
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
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

