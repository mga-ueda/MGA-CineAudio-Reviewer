/**
 * waveform-region-render-segments.js — 描画・分割・コピー・overlay 構築
 */
    function drawContinuousSegmentChainOverview(
        ctx,
        track,
        slot,
        wCss,
        hCss,
        mid,
        grad,
        vp,
        segments,
    ) {
        if (!trackSegmentsAreContinuousSameClipChain(track)) return false;
        for (let i = 0; i < segments.length; i++) {
            if (segmentHasViewportPeaksForDraw(vp, i)) return false;
        }
        const clipId = segments[0].clipId || getSegmentClipId(track, 0);
        const fullDur = getSegmentSourceDurationSec(track, segments[0]);
        const peaks = getSegmentPeaksForDraw(slot, clipId);
        if (!peaks || !peaks.length || !fullDur) return false;

        const chainStart = getSegmentTimelineStart(track, 0);
        const chainEnd = getSegmentTimelineEnd(track, segments.length - 1);
        const chainDur = chainEnd - chainStart;
        if (!(chainDur > 0.0005)) return false;

        const srcIn = segments[0].sourceInSec;
        const srcOut = segments[segments.length - 1].sourceOutSec;
        const chainPeaks = slicePeaksForRegion(peaks, fullDur, srcIn, srcOut);
        if (!chainPeaks || !chainPeaks.length) return false;

        const startX =
            typeof masterTimelineContentWidth === 'function'
                ? masterTimelineContentWidth(wCss, chainStart)
                : 0;
        const contentW =
            typeof masterTimelineContentWidth === 'function'
                ? masterTimelineContentWidth(wCss, chainDur)
                : wCss;
        const drawW = contentW > 0 ? contentW : wCss;
        const barW = drawW / chainPeaks.length;

        ctx.fillStyle = grad || '#ffffff';
        for (let p = 0; p < chainPeaks.length; p++) {
            const pk = chainPeaks[p];
            const x = startX + p * barW;
            const barTransport =
                chainStart + ((p + 0.5) / chainPeaks.length) * chainDur;
            const segIdx = segmentIndexAtMasterTransport(track, barTransport);
            const hideBefore = getSegmentWaveformHideBeforeTimeline(track, segIdx);
            if (barTransport < hideBefore - 0.0005) continue;
            if (viewportPeaksCoverMasterTime(vp, barTransport)) continue;
            drawWaveformBarAtTransport(
                ctx,
                track,
                slot,
                x,
                barW,
                mid,
                barTransport,
                pk,
                segIdx,
                vp ? { viewportPeaks: vp } : null,
            );
        }
        return true;
    }

    function drawExtraTrackWaveformRegions(ctx, wCss, hCss, slot, grad, drawOpt) {
        const track = { type: 'extra', slot };
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        const o = drawOpt && typeof drawOpt === 'object' ? drawOpt : {};
        const scrubOverview = !!o.scrubOverview;
        const scrubRedraw = !!o.scrubRedraw;
        const vpOverlay = scrubOverview ? null : tr ? tr.viewportPeaks : null;
        const vpSkip = scrubOverview || scrubRedraw ? null : vpOverlay;
        const t0 = getTrackTimelineStartSec(track);
        const layoutW = Number.isFinite(o.timelineLayoutW) && o.timelineLayoutW > 0
            ? o.timelineLayoutW
            : wCss;
        const xOffset = Number.isFinite(o.timelineXOffset) ? o.timelineXOffset : 0;
        const state = getPlaybackRegionsState(track);
        const hasConfiguredRegions =
            state &&
            state.active &&
            Array.isArray(state.segments) &&
            state.segments.length > 0;
        const segments = getTrackSegments(track);
        const mid = hCss * 0.5;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;

        ctx.clearRect(0, 0, wCss, hCss);
        ctx.fillStyle =
            typeof TIMELINE_LANE_TRACK_BG !== 'undefined'
                ? TIMELINE_LANE_TRACK_BG
                : '#161820';
        ctx.fillRect(0, 0, wCss, hCss);

        ctx.save();
        if (xOffset) ctx.translate(-xOffset, 0);

        if (!segments.length) {
            if (hasConfiguredRegions) {
                if (tr) {
                    tr.viewportPeaks = null;
                    vp = null;
                }
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(xOffset, mid);
                ctx.lineTo(xOffset + wCss, mid);
                ctx.stroke();
                ctx.restore();
                return;
            }
            const fullDur = getTrackSourceDurationSec(track);
            const peaks =
                scrubOverview && o.scrubOverviewPeaks && o.scrubOverviewPeaks.length
                    ? o.scrubOverviewPeaks
                    : tr
                      ? tr.peaks
                      : null;
            if (!peaks || !peaks.length || !fullDur) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(xOffset, mid);
                ctx.lineTo(xOffset + wCss, mid);
                ctx.stroke();
                ctx.restore();
                return;
            }
            if (typeof drawPeaksForMasterTimeline === 'function') {
                const peakDrawOpt = Object.assign({ timelineStartSec: t0 }, o);
                if (!scrubOverview) {
                    if (vpOverlay && vpOverlay.segments && vpOverlay.segments.length === 1) {
                        peakDrawOpt.viewportPeaks = vpOverlay.segments[0];
                    } else if (vpOverlay && vpOverlay.peaks) {
                        peakDrawOpt.viewportPeaks = vpOverlay;
                    } else if (vpOverlay && vpOverlay.tiles) {
                        peakDrawOpt.viewportPeaks = vpOverlay;
                    }
                }
                ctx.restore();
                drawPeaksForMasterTimeline(ctx, peaks, wCss, hCss, fullDur, grad, peakDrawOpt);
                return;
            }
            ctx.restore();
            return;
        }

        if (
            scrubOverview &&
            o.scrubOverviewPeaks &&
            o.scrubOverviewPeaks.length &&
            segments.length &&
            typeof drawPeaksForMasterTimeline === 'function'
        ) {
            const fullDur = getTrackSourceDurationSec(track);
            if (fullDur > 0) {
                const underlayOpt = Object.assign({ timelineStartSec: t0 }, o);
                delete underlayOpt.viewportPeaks;
                delete underlayOpt.scrubOverview;
                ctx.restore();
                drawPeaksForMasterTimeline(
                    ctx,
                    o.scrubOverviewPeaks,
                    wCss,
                    hCss,
                    fullDur,
                    grad,
                    underlayOpt,
                );
                ctx.save();
                if (xOffset) ctx.translate(-xOffset, 0);
            }
            drawRegionViewportPeaks(ctx, layoutW, hCss, master, vpOverlay, grad, track, o);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(xOffset, mid);
            ctx.lineTo(xOffset + wCss, mid);
            ctx.stroke();
            if (typeof drawTimelineVideoEndMarkerLine === 'function') {
                drawTimelineVideoEndMarkerLine(ctx, layoutW, hCss, o);
            }
            ctx.restore();
            return;
        }

        ctx.fillStyle = grad || '#ffffff';
        const chainOverviewDrawn = drawContinuousSegmentChainOverview(
            ctx,
            track,
            slot,
            layoutW,
            hCss,
            mid,
            grad,
            vpSkip,
            segments,
        );
        if (!chainOverviewDrawn) {
            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                const clipId = seg.clipId || getSegmentClipId(track, i);
                const fullDur = getSegmentSourceDurationSec(track, seg);
                if (segmentHasViewportPeaksForDraw(vpSkip, i)) continue;

                const peaks = getSegmentPeaksForDraw(slot, clipId);
                if (!peaks || !peaks.length || !fullDur) continue;
                const segPeaks = slicePeaksForRegion(
                    peaks,
                    fullDur,
                    seg.sourceInSec,
                    seg.sourceOutSec,
                );
                if (!segPeaks || !segPeaks.length) continue;
                const segT0 = getSegmentTimelineStart(track, i);
                const contentDur = seg.sourceOutSec - seg.sourceInSec;
                if (!(contentDur > 0.0005)) continue;
                const startX =
                    typeof masterTimelineContentWidth === 'function'
                        ? masterTimelineContentWidth(layoutW, segT0)
                        : 0;
                const contentW =
                    typeof masterTimelineContentWidth === 'function'
                        ? masterTimelineContentWidth(layoutW, contentDur)
                        : layoutW;
                const drawW = contentW > 0 ? contentW : layoutW;
                const barW = drawW / segPeaks.length;
                const waveformHideBefore = getSegmentWaveformHideBeforeTimeline(track, i);
                for (let p = 0; p < segPeaks.length; p++) {
                    const barTransport =
                        segT0 + ((p + 0.5) / segPeaks.length) * contentDur;
                    if (barTransport < waveformHideBefore - 0.0005) {
                        continue;
                    }
                    const x =
                        typeof masterTimelineContentWidth === 'function'
                            ? masterTimelineContentWidth(layoutW, barTransport) - barW * 0.5
                            : startX + p * barW;
                    if (viewportPeaksCoverMasterTime(vpSkip, barTransport)) {
                        continue;
                    }
                    drawWaveformBarAtTransport(
                        ctx,
                        track,
                        slot,
                        x,
                        barW,
                        mid,
                        barTransport,
                        segPeaks[p],
                        i,
                        vpSkip ? { viewportPeaks: vpSkip } : null,
                    );
                }
            }
        }

        drawRegionViewportPeaks(ctx, layoutW, hCss, master, vpOverlay, grad, track, o);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xOffset, mid);
        ctx.lineTo(xOffset + wCss, mid);
        ctx.stroke();
        if (typeof drawTimelineVideoEndMarkerLine === 'function') {
            drawTimelineVideoEndMarkerLine(ctx, layoutW, hCss, o);
        }
        ctx.restore();
    }

    function applySegmentsToState(track, segments, opt) {
        if (!isExtraTrackRef(track)) return false;
        if (!segments.length) return false;
        if (!(opt && opt.skipUndo) && !regionUndoPaused) {
            requestRegionUndoCapture();
        }

        const state = getPlaybackRegionsState(track);
        const prevSegmentCount = state.segments ? state.segments.length : 0;
        state.segments = segments;
        state.active = true;
        bumpRegionPersistEpoch(track.slot);
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
            redrawAfterRegionChange(track.slot, redrawOpt);
        }

        if (!(opt && opt.silent)) {
            writeLog(
                'Ex ' +
                    (track.slot + 1) +
                    ' split: ' +
                    segments.length +
                    ' region(s)',
            );
            flashSeekHint('Ex ' + (track.slot + 1), segments.length + ' regions', 'notice');
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
            typeof syncExtraAudioToTransport === 'function'
        ) {
            syncExtraAudioToTransport({ force: true });
        }
        return true;
    }

    function setTrackSegments(track, segments, opt) {
        if (!isExtraTrackRef(track)) return false;
        const normalized = [];
        for (const seg of segments) {
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
        const lane = regionEl.closest('.audio-waveform-lane--extra');
        if (!lane || !lane.id) return -1;
        const m = /^extraAudioLane(\d+)$/.exec(lane.id);
        return m ? parseInt(m[1], 10) : -1;
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
    window.getActiveMixExtraSlotFromDom = getActiveMixExtraSlotFromDom;

    /** スプリット対象 Ex：リージョン上 → そのリージョン／それ以外 → resolveTargetExtraSlot */
    function resolveSplitTargetExtraSlot() {
        const { clientX, clientY } = waveformPointerClientXY();
        const regionEl = findPlaybackRegionElAtPointer(clientX, clientY);
        if (regionEl) {
            const slot = extraSlotFromPlaybackRegionEl(regionEl);
            if (slot >= 0 && isExtraSlotUsableForRegion(slot)) return slot;
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
        if (Number.isFinite(clientY) && typeof extraLaneSlotFromClientY === 'function') {
            const laneSlot = extraLaneSlotFromClientY(clientY);
            if (laneSlot >= 0) return laneSlot;
        }
        const regionEl = findPlaybackRegionElAtPointer(clientX, clientY);
        if (regionEl) {
            const slot = extraSlotFromPlaybackRegionEl(regionEl);
            if (slot >= 0) return slot;
        }
        return -1;
    }

    function getRegionSplitTargetTransportSec(track, clientX, clientY, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        let pointerSec = null;
        if (Number.isFinite(clientX)) {
            let canUsePointer = false;
            if (o.pointerOverAnyExLane) {
                canUsePointer = resolveRegionSplitPointerLaneSlot(clientX, clientY) >= 0;
            } else {
                const laneSlot = resolveRegionSplitPointerLaneSlot(clientX, clientY);
                canUsePointer =
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

        writeLog(
            'Playback region split at ' +
                splitTransport.toFixed(3) +
                's (' +
                successCount +
                ' track' +
                (successCount === 1 ? '' : 's') +
                ')',
        );
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
                    'Playback region: hover an Ex lane (1–' +
                        getExtraTrackCount() +
                        '), then press X',
                );
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

    /** 再生ミックスと同じ基準でセグメント同士のタイムライン重なり（クロスフェード区間） */
    function trackHasCrossfadeOverlapForWaveformPreview(track) {
        if (!track) return false;
        const zones = collectTrackCrossfadeZones(track);
        return zones.length > 0;
    }

    /** geometryOnly ドラッグ中でも波形プレビューが必要なとき（フェードハンドル / 重なり開始） */
    function needsCrossfadeWaveformPreviewDuringGeometryDrag(slot, opt) {
        if (isCrossfadeHandleDragActive()) return true;
        if (!isRegionGeometryOnlyDrag(opt)) return false;
        if (!(typeof slot === 'number' && slot >= 0)) return false;
        return trackHasCrossfadeOverlapForWaveformPreview({ type: 'extra', slot });
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
                const oStart = Math.max(
                    getSegmentPlaybackTimelineStart(track, i),
                    getSegmentPlaybackTimelineStart(track, j),
                );
                const oEnd = Math.min(
                    getSegmentTimelineEnd(track, i),
                    getSegmentTimelineEnd(track, j),
                );
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
        }
        if (typeof drawExtraTrackWaveform === 'function') {
            drawExtraTrackWaveform(slot);
        }
    }

    function redrawAfterRegionChange(slot, opt) {
        const geometryOnly = isRegionGeometryOnlyDrag(opt);
        const crossfadeWaveform = needsCrossfadeWaveformPreviewDuringGeometryDrag(slot, opt);
        if (geometryOnly && !crossfadeWaveform) {
            return;
        }
        if (geometryOnly && crossfadeWaveform) {
            redrawCrossfadeWaveformPreviewDuringGeometryDrag(slot, opt);
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

        if (!dragging && typeof scheduleWaveformHiresRedrawAfterZoom === 'function') {
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

    function getPlaybackRegionsContainerEl(track) {
        if (!isExtraTrackRef(track)) return null;
        const lane = document.getElementById('extraAudioLane' + track.slot);
        if (!lane) return null;
        return lane.querySelector('.audio-waveform-lane__playback-regions');
    }

    function syncExtraLaneRegionsClassForTrack(track) {
        if (!isExtraTrackRef(track)) return;
        const lane = document.getElementById('extraAudioLane' + track.slot);
        if (!lane) return;
        const hasRegions = isTrackRegionActive(track);
        const hadRegions = lane.classList.contains('audio-waveform-lane--has-regions');
        lane.classList.toggle('audio-waveform-lane--has-regions', hasRegions);
        if (
            hadRegions !== hasRegions &&
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible()
        ) {
            if (typeof scheduleMusicalGridRedraw === 'function') {
                scheduleMusicalGridRedraw();
            } else if (typeof drawMusicalGridOverlay === 'function') {
                drawMusicalGridOverlay();
            }
        }
        if (
            hadRegions !== hasRegions &&
            typeof renderAudioWaveformMarkers === 'function'
        ) {
            renderAudioWaveformMarkers();
        }
        syncTrackPhraseRehearsalMarks(track);
    }

    function buildSilentGapOverlayEl(track, gapIndex, gap, slotsOpt) {
        const el = document.createElement('div');
        el.className = 'audio-waveform-lane__playback-silent-gap';
        el.dataset.silentGapIndex = String(gapIndex);
        el.setAttribute('aria-hidden', 'true');
        let title = '無音スロット';
        if (Number.isFinite(gap.phraseIndex)) {
            if (typeof phraseGroupLabelForIndex === 'function') {
                const mark = phraseGroupLabelForIndex(gap.phraseIndex);
                if (mark) title += '（練習番号 ' + mark + ' 付近）';
            }
            if (gap.partial) title += '（部分無音）';
        }
        title += ' — Ctrl+クリックで選択（Phrase 着色 ON 時は E で入れ替え可）';
        el.title = title;
        appendSwapUnitMusicalMetaToEl(track, el, { silentGapIndex: gapIndex | 0 }, slotsOpt);
        if (isSilentGapEntrySelected(track.slot, gapIndex)) {
            el.classList.add('audio-waveform-lane__playback-silent-gap--selected');
        }
        return el;
    }

    function positionSilentGapOverlayEl(el, gap) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!master) return;
        const leftPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(gap.startSec)
                : (gap.startSec / master) * 100;
        const rightPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(gap.endSec)
                : (gap.endSec / master) * 100;
        const widthPct = Math.max(0.05, rightPct - leftPct);
        el.style.left = leftPct + '%';
        el.style.width = widthPct + '%';
        el.hidden = false;
    }

    function buildRegionOverlayEl(track, segmentIndex, seg, slotsOpt) {
        const el = document.createElement('div');
        el.className = 'audio-waveform-lane__playback-region';
        if (getSegmentRegionGroupId(track, segmentIndex)) {
            el.classList.add('audio-waveform-lane__playback-region--grouped');
        }
        if (isRegionEntrySelected(track.slot, segmentIndex)) {
            el.classList.add('audio-waveform-lane__playback-region--selected');
        }
        el.dataset.segmentIndex = String(segmentIndex);
        if (shouldShowSegmentInHandle(track, segmentIndex)) {
            el.classList.add('audio-waveform-lane__playback-region--edge-in');
            const handleIn = document.createElement('div');
            handleIn.className =
                'audio-waveform-lane__playback-region__handle audio-waveform-lane__playback-region__handle--in';
            handleIn.title = 'リージョン ' + (segmentIndex + 1) + ' の In（ソース開始位置）';
            el.appendChild(handleIn);
        }
        if (shouldShowSegmentOutHandle(track, segmentIndex)) {
            el.classList.add('audio-waveform-lane__playback-region--edge-out');
            const handleOut = document.createElement('div');
            handleOut.className =
                'audio-waveform-lane__playback-region__handle audio-waveform-lane__playback-region__handle--out';
            handleOut.title = 'リージョン ' + (segmentIndex + 1) + ' の Out（ソース終了位置）';
            el.appendChild(handleOut);
        }
        const fadeCurve = document.createElement('div');
        fadeCurve.className = 'audio-waveform-lane__playback-region__fade-curve';
        fadeCurve.setAttribute('aria-hidden', 'true');
        const fadeInCurve = document.createElement('div');
        fadeInCurve.className =
            'audio-waveform-lane__playback-region__fade-curve-part audio-waveform-lane__playback-region__fade-curve-part--in';
        const fadeInSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        fadeInSvg.setAttribute('class', 'audio-waveform-lane__playback-region__fade-svg');
        fadeInSvg.setAttribute('viewBox', '0 0 100 100');
        fadeInSvg.setAttribute('preserveAspectRatio', 'none');
        const fadeInPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        fadeInPath.setAttribute('d', 'M 0 99 Q 50 99 100 1');
        fadeInSvg.appendChild(fadeInPath);
        fadeInCurve.appendChild(fadeInSvg);
        const fadeOutCurve = document.createElement('div');
        fadeOutCurve.className =
            'audio-waveform-lane__playback-region__fade-curve-part audio-waveform-lane__playback-region__fade-curve-part--out';
        const fadeOutSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        fadeOutSvg.setAttribute('class', 'audio-waveform-lane__playback-region__fade-svg');
        fadeOutSvg.setAttribute('viewBox', '0 0 100 100');
        fadeOutSvg.setAttribute('preserveAspectRatio', 'none');
        const fadeOutPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        fadeOutPath.setAttribute('d', 'M 100 99 Q 50 99 0 1');
        fadeOutSvg.appendChild(fadeOutPath);
        fadeOutCurve.appendChild(fadeOutSvg);
        fadeCurve.appendChild(fadeInCurve);
        fadeCurve.appendChild(fadeOutCurve);
        el.appendChild(fadeCurve);

        const fadeInHandle = document.createElement('div');
        fadeInHandle.className =
            'audio-waveform-lane__playback-region__handle audio-waveform-lane__playback-region__handle--fade-in';
        const fadeInKey =
            typeof window.SHORTCUT_HINTS !== 'undefined' && window.SHORTCUT_HINTS.regionFadeIn
                ? window.SHORTCUT_HINTS.regionFadeIn
                : 'Alt+I';
        const fadeOutKey =
            typeof window.SHORTCUT_HINTS !== 'undefined' && window.SHORTCUT_HINTS.regionFadeOut
                ? window.SHORTCUT_HINTS.regionFadeOut
                : 'Alt+O';
        fadeInHandle.title =
            'Fade In（内側へドラッグ、' + fadeInKey + ' でシークバーまで）';
        el.appendChild(fadeInHandle);
        const fadeOutHandle = document.createElement('div');
        fadeOutHandle.className =
            'audio-waveform-lane__playback-region__handle audio-waveform-lane__playback-region__handle--fade-out';
        fadeOutHandle.title =
            'Fade Out（内側へドラッグ、' + fadeOutKey + ' でシークバーまで）';
        el.appendChild(fadeOutHandle);

        const fadeInMarkerLine = document.createElement('div');
        fadeInMarkerLine.className =
            'audio-waveform-lane__playback-region__fade-marker-line audio-waveform-lane__playback-region__fade-marker-line--in';
        fadeInMarkerLine.hidden = true;
        fadeInMarkerLine.setAttribute('aria-hidden', 'true');
        el.appendChild(fadeInMarkerLine);
        const fadeOutMarkerLine = document.createElement('div');
        fadeOutMarkerLine.className =
            'audio-waveform-lane__playback-region__fade-marker-line audio-waveform-lane__playback-region__fade-marker-line--out';
        fadeOutMarkerLine.hidden = true;
        fadeOutMarkerLine.setAttribute('aria-hidden', 'true');
        el.appendChild(fadeOutMarkerLine);

        const gainDb = getSegmentGainDb(track, segmentIndex);
        const gainLabel = document.createElement('span');
        gainLabel.className = 'audio-waveform-lane__playback-region__gain-db';
        const gainText = formatRegionGainDbDisplay(gainDb);
        gainLabel.textContent = gainText;
        gainLabel.hidden = !gainText;
        gainLabel.setAttribute('aria-hidden', gainText ? 'false' : 'true');
        el.appendChild(gainLabel);
        const pitchSemitones = getSegmentPitchSemitones(track, segmentIndex);
        const pitchLabel = document.createElement('span');
        pitchLabel.className = 'audio-waveform-lane__playback-region__pitch';
        const pitchText = formatRegionPitchDisplay(pitchSemitones);
        pitchLabel.textContent = pitchText;
        pitchLabel.hidden = !pitchText;
        pitchLabel.setAttribute('aria-hidden', pitchText ? 'false' : 'true');
        el.appendChild(pitchLabel);
        if (shouldShowMusicalMetaOnSegment(track, segmentIndex)) {
            const restoreBusy =
                typeof isSessionRestoreBusy === 'function' && isSessionRestoreBusy();
            if (!restoreBusy || (Array.isArray(slotsOpt) && slotsOpt.length)) {
                appendSwapUnitMusicalMetaToEl(
                    track,
                    el,
                    { segmentIndex: segmentIndex | 0 },
                    slotsOpt,
                );
            }
        }
        const cursorLine = document.createElement('div');
        cursorLine.className = 'audio-waveform-lane__playback-region__cursor-line';
        cursorLine.setAttribute('aria-hidden', 'true');
        cursorLine.hidden = true;
        el.appendChild(cursorLine);
        return el;
    }

    function buildSplitHandleEl(boundaryIndex) {
        const el = document.createElement('div');
        el.className =
            'audio-waveform-lane__playback-region__handle audio-waveform-lane__playback-region__handle--split';
        el.dataset.boundaryIndex = String(boundaryIndex);
        el.title = 'スプリット点（ドラッグで境界を移動）';
        return el;
    }

    function positionSplitHandleEl(el, track, boundaryIndex) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!master) return;
        const splitTransport = getSegmentTimelineEnd(track, boundaryIndex);
        const pct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(splitTransport)
                : (splitTransport / master) * 100;
        el.style.left = pct + '%';
        el.style.width = '0';
        el.hidden = false;
    }

    function positionRegionOverlayEl(el, track, segmentIndex, seg) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!master) return;
        const trackStart =
            typeof getTrackTimelineStartSec === 'function'
                ? getTrackTimelineStartSec(track)
                : 0;
        const inTransport = Math.max(
            trackStart,
            getSegmentRegionTimelineIn(track, segmentIndex),
        );
        const outTransport = getSegmentTimelineEnd(track, segmentIndex);
        const leftPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(inTransport)
                : (inTransport / master) * 100;
        const rightPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(outTransport)
                : (outTransport / master) * 100;
        const widthPct = Math.max(0.05, rightPct - leftPct);
        el.style.left = leftPct + '%';
        el.style.width = widthPct + '%';
        el.hidden = false;

        applyRegionFadeHandlesDefault(track, segmentIndex, el);

        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const regionDur = Math.max(0.001, outTransport - inTransport);
        const playbackFromRegion = Math.max(0, playbackStart - inTransport);
        const fadeInSec = getSegmentFadeDurationSec(track, segmentIndex, 'in');
        const fadeOutSec = getSegmentFadeDurationSec(track, segmentIndex, 'out');
        const fadeInRatio = Math.max(0, Math.min(1, fadeInSec / regionDur));
        const fadeOutRatio = Math.max(0, Math.min(1, fadeOutSec / regionDur));
        const playbackOffsetRatio = Math.max(0, Math.min(1, playbackFromRegion / regionDur));

        const fadeCurve = el.querySelector('.audio-waveform-lane__playback-region__fade-curve');
        if (fadeCurve) {
            fadeCurve.style.setProperty('--region-fade-in-start', playbackOffsetRatio * 100 + '%');
            fadeCurve.style.setProperty('--region-fade-in-width', fadeInRatio * 100 + '%');
            fadeCurve.style.setProperty('--region-fade-out-width', fadeOutRatio * 100 + '%');
        }

        const gainLabel = el.querySelector('.audio-waveform-lane__playback-region__gain-db');
        if (gainLabel) {
            const gainText = formatRegionGainDbDisplay(getSegmentGainDb(track, segmentIndex));
            gainLabel.textContent = gainText;
            gainLabel.hidden = !gainText;
            gainLabel.setAttribute('aria-hidden', gainText ? 'false' : 'true');
        }
        const pitchLabel = el.querySelector('.audio-waveform-lane__playback-region__pitch');
        if (pitchLabel) {
            const pitchText = formatRegionPitchDisplay(
                getSegmentPitchSemitones(track, segmentIndex),
            );
            pitchLabel.textContent = pitchText;
            pitchLabel.hidden = !pitchText;
            pitchLabel.setAttribute('aria-hidden', pitchText ? 'false' : 'true');
        }
    }

    /** 再生ミックスと同じ区間で、同一トラック内のクロスフェード重なりを列挙 */
    function collectTrackCrossfadeZones(track) {
        const segments = getTrackSegments(track);
        if (segments.length < 2) return [];
        const zones = [];
        for (let i = 0; i < segments.length; i++) {
            for (let j = i + 1; j < segments.length; j++) {
                const oStart = Math.max(
                    getSegmentPlaybackTimelineStart(track, i),
                    getSegmentPlaybackTimelineStart(track, j),
                );
                const oEnd = Math.min(
                    getSegmentTimelineEnd(track, i),
                    getSegmentTimelineEnd(track, j),
                );
                const minOverlap =
                    typeof window.MIN_CROSSFADE_OVERLAP_SEC === 'number'
                        ? window.MIN_CROSSFADE_OVERLAP_SEC
                        : 0.005;
                if (oEnd - oStart < minOverlap) continue;
                zones.push({ startSec: oStart, endSec: oEnd });
            }
        }
        return zones;
    }

    function buildCrossfadeMarkerEl() {
        const el = document.createElement('div');
        el.className = 'audio-waveform-lane__crossfade-marker';
        el.setAttribute('aria-hidden', 'true');
        el.title = 'Crossfade（クロスフェード量）';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'audio-waveform-lane__crossfade-marker__shape');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('preserveAspectRatio', 'none');
        const fadeOut = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        fadeOut.setAttribute('d', 'M 1 1 Q 50 14 99 99');
        const fadeIn = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        fadeIn.setAttribute('d', 'M 1 99 Q 50 14 99 1');
        svg.appendChild(fadeOut);
        svg.appendChild(fadeIn);
        el.appendChild(svg);
        return el;
    }

    function positionCrossfadeMarkerEl(el, startSec, endSec) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!master) return;
        const leftPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(startSec)
                : (startSec / master) * 100;
        const rightPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(endSec)
                : (endSec / master) * 100;
        el.style.left = leftPct + '%';
        el.style.width = Math.max(0.08, rightPct - leftPct) + '%';
        el.hidden = false;
    }

    function resolveRegionSegmentIndexAtPointer(track, clientX, clientY) {
        const regionEl = findPlaybackRegionElAtPointer(clientX, clientY);
        if (regionEl) {
            const lane = regionEl.closest('.audio-waveform-lane--extra');
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
            const lane = hoveredPlaybackRegionEl.closest('.audio-waveform-lane--extra');
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
                writeLog('Ex ' + (track.slot + 1) + ': region reset to full clip');
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint('Ex ' + (track.slot + 1), 'Region reset', 'notice');
                }
                redrawAfterRegionChange(track.slot);
                return true;
            }
            clearTrackRegion(track, { skipUndo: true });
            writeLog('Ex ' + (track.slot + 1) + ': all regions removed');
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Ex ' + (track.slot + 1), 'Regions off', 'notice');
            }
            return true;
        }
        applySegmentsToState(track, segments, { skipUndo: true });
        writeLog(
            'Ex ' +
                (track.slot + 1) +
                ': region ' +
                (segmentIndex + 1) +
                ' deleted (' +
                segments.length +
                ' left)',
        );
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
        const segments = getTrackSegments(track);
        if (!segments.length) return false;

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
        if (srcIdx < 0 || srcIdx >= segments.length) {
            srcIdx = segments.length - 1;
        }

        const srcEnd = getSegmentTimelineEnd(track, srcIdx);
        let availableGap = Infinity;
        if (srcIdx < segments.length - 1) {
            availableGap =
                getSegmentTimelineStart(track, srcIdx + 1) - srcEnd;
        }
        const pushDelta =
            availableGap >= pasteDur - eps ? 0 : pasteDur - availableGap;
        const pasteStart = srcEnd;

        const clone = {
            id: newRegionId(),
            clipId: clip.clipId,
            sourceInSec: clip.sourceInSec,
            sourceOutSec: clip.sourceOutSec,
            timelineStartSec: pasteStart,
        };
        const regionInDelta = clip.regionInSec - clip.anchorStartSec;
        if (regionInDelta > SEGMENT_BOUNDARY_JOIN_EPS_SEC) {
            clone.regionTimelineInSec = pasteStart + regionInDelta;
        }
        if (
            Number.isFinite(clip.regionLeadPadSec) &&
            clip.regionLeadPadSec > 0 &&
            regionInDelta <= SEGMENT_BOUNDARY_JOIN_EPS_SEC
        ) {
            clone.regionLeadPadSec = clip.regionLeadPadSec;
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
        const working = segments.map((s) => ({ ...s }));
        const insertAt = srcIdx + 1;
        if (pushDelta > eps) {
            shiftSegmentEntriesTimelineFromIndex(working, track, insertAt, pushDelta);
        }
        const normalized = working.map((s) =>
            normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
        );
        const srcSeg = normalized[srcIdx];
        if (srcSeg && Number.isFinite(srcSeg.fadeOutSec)) {
            delete srcSeg.fadeOutSec;
        }
        normalized.splice(insertAt, 0, norm);
        applySegmentsToState(track, normalized, {
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
                normalized.length +
                ' total)',
        );
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Ex ' + (slot + 1), 'Region pasted', 'notice');
        }
        return true;
    }

    function deleteRegionSegmentUnderCursor() {
        if (!regionSelectionEntries.length) return false;
        const entries = regionSelectionEntries.map((e) => ({
            slot: e.slot,
            segmentIndex: e.segmentIndex,
            silentGapIndex: e.silentGapIndex,
        }));
        if (typeof clearRegionSelection === 'function') clearRegionSelection();
        const gapEntries = entries.filter((e) => e.segmentIndex < 0);
        const phraseFillOn =
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible();
        if (!regionUndoPaused) {
            requestRegionUndoCapture({
                includePhrase: !!(phraseFillOn && gapEntries.length),
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
        for (let i = 0; i < segEntries.length; i++) {
            const e = segEntries[i];
            if (!bySlot[e.slot]) bySlot[e.slot] = [];
            if (bySlot[e.slot].indexOf(e.segmentIndex) < 0) {
                bySlot[e.slot].push(e.segmentIndex);
            }
        }

        const slotKeys = Object.keys(bySlot);
        for (let s = 0; s < slotKeys.length; s++) {
            const slot = parseInt(slotKeys[s], 10);
            const track = { type: 'extra', slot };
            if (!isTrackRegionActive(track)) continue;
            noteRegionShrinkPersistIntent(slot);
            const indices = bySlot[slot].sort((a, b) => b - a);
            for (let i = 0; i < indices.length; i++) {
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
        return anyDeleted;
    }

    function refreshTrackRegionOverlayGeometry(track) {
        const container = getPlaybackRegionsContainerEl(track);
        if (!container) return;
        const segments = getTrackSegments(track);
        if (!segments.length) {
            updateTrackRegionOverlays(track);
            return;
        }
        const regionEls = container.querySelectorAll(
            '.audio-waveform-lane__playback-region',
        );
        if (regionEls.length !== segments.length) {
            updateTrackRegionOverlays(track);
            return;
        }
        for (let i = 0; i < segments.length; i++) {
            positionRegionOverlayEl(regionEls[i], track, i, segments[i]);
        }
        const splitHandles = container.querySelectorAll(
            '.audio-waveform-lane__playback-region__handle--split',
        );
        for (let h = 0; h < splitHandles.length; h++) {
            const el = splitHandles[h];
            const b = Number(el.dataset.boundaryIndex);
            if (
                Number.isFinite(b) &&
                b >= 0 &&
                b < segments.length - 1 &&
                isSegmentBoundaryJoined(track, b)
            ) {
                positionSplitHandleEl(el, track, b);
            }
        }
        const zones = collectTrackCrossfadeZones(track);
        const markers = container.querySelectorAll('.audio-waveform-lane__crossfade-marker');
        if (markers.length !== zones.length) {
            updateTrackRegionOverlays(track);
            return;
        }
        for (let z = 0; z < zones.length; z++) {
            positionCrossfadeMarkerEl(markers[z], zones[z].startSec, zones[z].endSec);
        }
        const silentGaps =
            typeof collectTrackSilentGaps === 'function'
                ? collectTrackSilentGaps(track)
                : [];
        const silentGapEls = container.querySelectorAll(
            '.audio-waveform-lane__playback-silent-gap',
        );
        if (silentGapEls.length !== silentGaps.length) {
            updateTrackRegionOverlays(track);
            return;
        }
        for (let g = 0; g < silentGaps.length; g++) {
            positionSilentGapOverlayEl(silentGapEls[g], silentGaps[g]);
        }
        applyDenseRegionBoundaryPresentation(track, container);
        refreshTrackFadeTriangleVisibility(track, container);
    }

    let trackRegionOverlayBuildDepth = 0;

    function updateTrackRegionOverlays(track, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const restoreBusy =
            typeof isSessionRestoreBusy === 'function' && isSessionRestoreBusy();
        const lightweight = !!(o.lightweight || o.forceLightweight || restoreBusy);
        const diagEx =
            isExtraTrackRef(track) && Number.isFinite(track.slot)
                ? { ex: (track.slot | 0) + 1, lightweight }
                : { lightweight };
        const diagRun =
            typeof window.regionRestoreDiagRunStep === 'function'
                ? window.regionRestoreDiagRunStep
                : function (_label, fn) {
                      return fn();
                  };
        const diagLog =
            typeof window.regionRestoreDiagLog === 'function'
                ? window.regionRestoreDiagLog
                : function () {};
        if (trackRegionOverlayBuildDepth > 0) {
            diagLog('overlay/reenter-skip', diagEx);
            return;
        }
        trackRegionOverlayBuildDepth += 1;
        diagLog('overlay/begin', diagEx);
        try {
        diagRun(
            'overlay/syncLaneMix',
            () => {
                if (
                    isExtraTrackRef(track) &&
                    typeof syncExtraTrackLaneMixVisual === 'function'
                ) {
                    syncExtraTrackLaneMixVisual(track.slot);
                }
            },
            diagEx,
        );
        const container = diagRun(
            'overlay/getContainer',
            () => getPlaybackRegionsContainerEl(track),
            diagEx,
        );
        if (!container) {
            diagLog('overlay/no-container', diagEx);
            return;
        }
        const restoreHover =
            hoveredPlaybackRegionEl &&
            hoveredPlaybackRegionEl.parentElement === container;
        const hoverClientX =
            typeof getWaveformLanesPointerClientX === 'function'
                ? getWaveformLanesPointerClientX()
                : null;
        const hoverClientY =
            typeof getWaveformLanesPointerClientY === 'function'
                ? getWaveformLanesPointerClientY()
                : null;
        if (restoreHover) setHoveredPlaybackRegion(null);
        diagRun('overlay/clearDom', () => container.replaceChildren(), diagEx);
        const state = getPlaybackRegionsState(track);
        const hasConfiguredRegions =
            state &&
            state.active &&
            Array.isArray(state.segments) &&
            state.segments.length > 0;
        let segments = diagRun(
            'overlay/getTrackSegments',
            () => getTrackSegments(track),
            diagEx,
        );
        if (
            !segments.length &&
            !hasConfiguredRegions &&
            !isSessionRestoreBusy() &&
            ensureDefaultTrackRegion(track, { skipOverlay: true, silent: true })
        ) {
            segments = diagRun(
                'overlay/getTrackSegments-after-default',
                () => getTrackSegments(track),
                diagEx,
            );
        }
        if (!segments.length) {
            container.hidden = true;
            syncExtraLaneRegionsClassForTrack(track);
            syncTrackPhraseRehearsalMarks(track);
            diagLog('overlay/empty-hidden', diagEx);
            return;
        }
        container.hidden = false;
        let labelSlots = null;
        if (
            !lightweight &&
            isMusicalGridPhraseFillVisibleSafe() &&
            typeof window.getTrackTimelineSlots === 'function'
        ) {
            labelSlots = diagRun(
                'overlay/getTimelineSlots',
                () => window.getTrackTimelineSlots(track, { writeCache: false }),
                diagEx,
            );
        }
        diagRun(
            'overlay/buildRegionEls',
            () => {
                for (let i = 0; i < segments.length; i++) {
                    const seg = segments[i];
                    const stepLabel = 'overlay/region/' + (i + 1);
                    if (typeof window.regionRestoreDiagRunStep === 'function') {
                        window.regionRestoreDiagRunStep(
                            stepLabel,
                            () => {
                                const el = buildRegionOverlayEl(track, i, seg, labelSlots);
                                positionRegionOverlayEl(el, track, i, seg);
                                container.appendChild(el);
                            },
                            diagEx,
                        );
                    } else {
                        const el = buildRegionOverlayEl(track, i, seg, labelSlots);
                        positionRegionOverlayEl(el, track, i, seg);
                        container.appendChild(el);
                    }
                }
            },
            Object.assign({}, diagEx, { segCount: segments.length }),
        );
        if (!lightweight) {
            diagRun(
                'overlay/silentGaps',
                () => {
                    const silentGaps =
                        typeof collectTrackSilentGaps === 'function'
                            ? collectTrackSilentGaps(track)
                            : [];
                    for (let g = 0; g < silentGaps.length; g++) {
                        const gapEl = buildSilentGapOverlayEl(
                            track,
                            g,
                            silentGaps[g],
                            labelSlots,
                        );
                        positionSilentGapOverlayEl(gapEl, silentGaps[g]);
                        container.appendChild(gapEl);
                    }
                    return silentGaps.length;
                },
                diagEx,
            );
            diagRun(
                'overlay/crossfadeMarkers',
                () => {
                    const crossfadeZones = collectTrackCrossfadeZones(track);
                    for (let z = 0; z < crossfadeZones.length; z++) {
                        const zone = crossfadeZones[z];
                        const marker = buildCrossfadeMarkerEl();
                        positionCrossfadeMarkerEl(marker, zone.startSec, zone.endSec);
                        container.appendChild(marker);
                    }
                    return crossfadeZones.length;
                },
                diagEx,
            );
        }
        diagRun(
            'overlay/splitHandles',
            () => {
                for (let b = 0; b < segments.length - 1; b++) {
                    if (!isSegmentBoundaryJoined(track, b)) continue;
                    const splitEl = buildSplitHandleEl(b);
                    positionSplitHandleEl(splitEl, track, b);
                    container.appendChild(splitEl);
                }
            },
            diagEx,
        );
        syncExtraLaneRegionsClassForTrack(track);
        syncRegionSelectionClasses();
        if (!lightweight) {
            diagRun(
                'overlay/densePresentation',
                () => {
                    applyDenseRegionBoundaryPresentation(track, container);
                    refreshTrackFadeTriangleVisibility(track, container);
                },
                diagEx,
            );
        }
        if (
            restoreHover &&
            Number.isFinite(hoverClientX) &&
            Number.isFinite(hoverClientY)
        ) {
            updatePlaybackRegionHoverFromPointer(hoverClientX, hoverClientY, false);
        }
        if (
            !lightweight &&
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible() &&
            isTrackRegionActive(track) &&
            typeof scheduleMusicalGridRedraw === 'function'
        ) {
            scheduleMusicalGridRedraw();
        }
        if (!lightweight) {
            diagRun('overlay/phraseMarks', () => syncTrackPhraseRehearsalMarks(track), diagEx);
        }
        diagLog('overlay/done', diagEx);
        } finally {
            trackRegionOverlayBuildDepth -= 1;
            if (trackRegionOverlayBuildDepth < 0) trackRegionOverlayBuildDepth = 0;
        }
    }



