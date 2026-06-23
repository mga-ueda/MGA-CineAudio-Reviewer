/**
 * extra-audio-lane-ui.js — Ex レーン表示・ボタン・可視性
 */
    function drawExtraTrackWaveform(slot) {
        const ui = getExtraUi(slot);
        const tr = extraTrackBySlot(slot);
        if (!ui || !ui.canvas) return;
        const scrubActive =
            typeof isWaveformScrubPriorityActive === 'function' &&
            isWaveformScrubPriorityActive();
        const scrubOverview =
            scrubActive &&
            typeof isWaveformScrubOverviewDrawActive === 'function' &&
            isWaveformScrubOverviewDrawActive();
        try {
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
            const drawOpt = Object.assign({ timelineStartSec }, sized.drawOpt || {});
            if (scrubActive) {
                drawOpt.scrubRedraw = !scrubOverview;
            }
            if (scrubOverview) {
                drawOpt.scrubOverview = true;
                if (tr && tr.scrubOverviewPeaks && tr.scrubOverviewPeaks.length) {
                    drawOpt.scrubOverviewPeaks = tr.scrubOverviewPeaks;
                }
            }
            if (!scrubOverview && tr && tr.viewportPeaks) {
                if (tr.viewportPeaks.segments && tr.viewportPeaks.segments.length === 1) {
                    drawOpt.viewportPeaks = tr.viewportPeaks.segments[0];
                } else if (tr.viewportPeaks.peaks || tr.viewportPeaks.tiles) {
                    drawOpt.viewportPeaks = tr.viewportPeaks;
                }
            }
            if (typeof drawExtraTrackWaveformRegions === 'function') {
                try {
                    drawExtraTrackWaveformRegions(ctx, wCss, hCss, slot, grad, drawOpt);
                } catch (err) {
                    ctx.clearRect(0, 0, wCss, hCss);
                    ctx.fillStyle =
                        typeof TIMELINE_LANE_TRACK_BG !== 'undefined'
                            ? TIMELINE_LANE_TRACK_BG
                            : '#161820';
                    ctx.fillRect(0, 0, wCss, hCss);
                    drawPeaksForMasterTimeline(
                        ctx,
                        scrubOverview &&
                            tr &&
                            tr.scrubOverviewPeaks &&
                            tr.scrubOverviewPeaks.length
                            ? tr.scrubOverviewPeaks
                            : tr
                              ? tr.peaks
                              : null,
                        wCss,
                        hCss,
                        extraTrackContentDurationSec(slot),
                        grad,
                        drawOpt,
                    );
                }
            } else {
                drawPeaksForMasterTimeline(
                    ctx,
                    scrubOverview &&
                        tr &&
                        tr.scrubOverviewPeaks &&
                        tr.scrubOverviewPeaks.length
                        ? tr.scrubOverviewPeaks
                        : tr
                          ? tr.peaks
                          : null,
                    wCss,
                    hCss,
                    extraTrackContentDurationSec(slot),
                    grad,
                    drawOpt,
                );
            }
        } catch (err) {
            const sized = syncExtraCanvasSize(ui);
            if (!sized || !sized.ctx) return;
            const { ctx, wCss, hCss } = sized;
            ctx.clearRect(0, 0, wCss, hCss);
            ctx.fillStyle =
                typeof TIMELINE_LANE_TRACK_BG !== 'undefined'
                    ? TIMELINE_LANE_TRACK_BG
                    : '#161820';
            ctx.fillRect(0, 0, wCss, hCss);
            if (tr && tr.peaks && tr.peaks.length) {
                const grad =
                    typeof timelineWaveformFillGradient === 'function'
                        ? timelineWaveformFillGradient(ctx, hCss, 'extra', true)
                        : null;
                drawPeaksForMasterTimeline(
                    ctx,
                    tr.peaks,
                    wCss,
                    hCss,
                    extraTrackContentDurationSec(slot),
                    grad,
                    { timelineStartSec: getExtraTrackTimelineStartSec(slot) },
                );
            }
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
                if (typeof logExAudioAction === 'function') {
                    logExAudioAction(formatExTrack(i) + ' レーンを表示');
                } else {
                    writeLog('Ex ' + (i + 1) + ': track lane opened');
                }
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

    const EXTRA_CLEAR_TITLE_ENABLED = 'この Audio Track を非表示にしてクリア';
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

    function clearExtraTrackWaveformDerivedCache(tr) {
        if (!tr) return;
        tr.viewportPeaks = null;
        tr.scrubOverviewPeaks = null;
    }

    function invalidateExtraTrackSlotCachesAfterSwap(aSlot, bSlot) {
        if (typeof invalidateTrackTimelineSlotsReadCache === 'function') {
            invalidateTrackTimelineSlotsReadCache();
        }
        if (typeof clearTrackSegmentsMemoForSlot === 'function') {
            clearTrackSegmentsMemoForSlot(aSlot);
            clearTrackSegmentsMemoForSlot(bSlot);
        }
        clearExtraTrackWaveformDerivedCache(extraTracks[aSlot]);
        clearExtraTrackWaveformDerivedCache(extraTracks[bSlot]);
    }

    /** 入れ替え後: viewport 高解像度ピークを再構築（クリア直後の粗い概要ピーク描画を防ぐ） */
    function refreshExtraTrackWaveformsAfterSlotSwap(aSlot, bSlot) {
        const slots = [];
        if (
            aSlot >= 0 &&
            aSlot < EXTRA_TRACK_COUNT &&
            typeof extraTrackSlotHasContent === 'function' &&
            extraTrackSlotHasContent(aSlot)
        ) {
            slots.push(aSlot);
        }
        if (
            bSlot >= 0 &&
            bSlot < EXTRA_TRACK_COUNT &&
            bSlot !== aSlot &&
            typeof extraTrackSlotHasContent === 'function' &&
            extraTrackSlotHasContent(bSlot)
        ) {
            slots.push(bSlot);
        }
        if (!slots.length) return;
        for (let i = 0; i < slots.length; i++) {
            if (typeof rebuildExtraTrackPeaksIfNeeded === 'function') {
                rebuildExtraTrackPeaksIfNeeded(slots[i]);
            }
        }
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

    function refreshExtraTrackMusicalSlotsAfterSlotSwap(slot) {
        if (!(slot >= 0)) return;
        if (typeof refreshTrackTimelineMusicalSlots !== 'function') return;
        const track = { type: 'extra', slot };
        if (
            typeof isTrackRegionActive === 'function' &&
            !isTrackRegionActive(track)
        ) {
            return;
        }
        refreshTrackTimelineMusicalSlots(track);
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
        invalidateExtraTrackSlotCachesAfterSwap(aSlot, bSlot);
        applyExtraTrackLaneVisibility(aSlot);
        applyExtraTrackLaneVisibility(bSlot);
        refreshExtraTrackMusicalSlotsAfterSlotSwap(aSlot);
        refreshExtraTrackMusicalSlotsAfterSlotSwap(bSlot);
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
        refreshExtraTrackWaveformsAfterSlotSwap(aSlot, bSlot);
        if (typeof scheduleWaveformRegionOverlayRefresh === 'function') {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    scheduleWaveformRegionOverlayRefresh();
                });
            });
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

    /** セッション復元 teardown 後: 波形描画とマスター尺通知（オーバーレイは updateAllPlaybackRegionOverlays に集約） */
    function refreshExtraTrackRegionOverlaysAfterSessionRestore() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackLoaded(i)) continue;
            try {
                drawExtraTrackWaveform(i);
            } catch (err) {
                writeLog(
                    'Extra audio ' +
                        (i + 1) +
                        ': waveform restore incomplete — ' +
                        (err && err.message ? err.message : String(err)),
                );
            }
        }
        try {
            if (typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
        } catch (err) {
            writeLog(
                'Session: restore notify skipped — ' +
                    (err && err.message ? err.message : String(err)),
            );
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

    function refreshExtraTrackUi(slot, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
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
        if (!o.skipDraw) {
            drawExtraTrackWaveform(slot);
        }
        const skipRegionOverlay =
            !!o.skipRegionOverlay ||
            (typeof isSessionRestoreInProgress === 'function' &&
                isSessionRestoreInProgress());
        if (
            hasBuf &&
            !skipRegionOverlay &&
            typeof updateTrackRegionOverlay === 'function'
        ) {
            updateTrackRegionOverlay({ type: 'extra', slot });
        }
        if (typeof refreshTrackLaneControlsUi === 'function') refreshTrackLaneControlsUi();
        refreshExtraTrackLaneVisibility(slot);
        refreshExtraTrackAddLaneButtons();
    }

