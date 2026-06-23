/**
 * audio-waveform-build.js — ピーク生成・デコード・波形ビルド
 */
    /** 現在のタイムライン幅に合わせて overview ピークを再構築 */
    function rebuildMainWaveformOverviewPeaksIfNeeded() {
        if (!waveformAudioBuffer) return false;
        const sized = syncAudioWaveformCanvasSize();
        if (!sized) return false;
        const barCount = sized.barCount;
        if (waveformPeakPyramid && typeof peaksOverviewFromPyramid === 'function') {
            const overview = peaksOverviewFromPyramid(waveformPeakPyramid, barCount);
            if (overview && overview.length) waveformPeaks = overview;
            refreshWaveformScrubOverviewCache();
        }
        if (!waveformPeaks || waveformPeaks.length !== barCount) {
            if (typeof peaksFromAudioBuffer === 'function') {
                waveformPeaks = peaksFromAudioBuffer(
                    waveformAudioBuffer,
                    Math.min(512, barCount),
                );
            }
        }
        return !!(waveformPeaks && waveformPeaks.length > 0);
    }

    function rebuildMainWaveformViewportPeaks(spec) {
        if (!waveformAudioBuffer || !spec) {
            waveformViewportPeaks = null;
            return;
        }
        const contentDur = getWaveformAudioDurationSec();
        const timelineStartSec = 0;
        const trackEndSec = timelineStartSec + contentDur;
        const t0 = Math.max(timelineStartSec, spec.masterStartSec);
        const t1 = Math.min(trackEndSec, spec.masterEndSec);
        if (t1 <= t0 + 1e-9) {
            waveformViewportPeaks = null;
            return;
        }
        const audioStart = t0 - timelineStartSec;
        const audioEnd = t1 - timelineStartSec;
        let peaks = [];
        if (typeof peaksForViewportRange === 'function') {
            const bufId =
                typeof bufferPeakId === 'function'
                    ? bufferPeakId(waveformAudioBuffer)
                    : 0;
            peaks = peaksForViewportRange(
                waveformAudioBuffer,
                waveformPeakPyramid,
                audioStart,
                audioEnd,
                spec.barCount,
                bufId,
            );
        } else {
            peaks = peaksFromAudioBufferRange(
                waveformAudioBuffer,
                audioStart,
                audioEnd,
                spec.barCount,
            );
        }
        if (!peaks.length) {
            waveformViewportPeaks = null;
            return;
        }
        waveformViewportPeaks = { peaks, masterStartSec: t0, masterEndSec: t1 };
    }

    function initMainWaveformViewportTiles(plan) {
        if (!plan || !plan.tiles || !plan.tiles.length) {
            waveformViewportPeaks = null;
            return;
        }
        const prevById = new Map();
        if (waveformViewportPeaks && waveformViewportPeaks.tiles) {
            for (let i = 0; i < waveformViewportPeaks.tiles.length; i++) {
                const pt = waveformViewportPeaks.tiles[i];
                if (pt.peaks && pt.peaks.length) prevById.set(pt.tileId, pt);
            }
        }
        let reused = 0;
        const tiles = plan.tiles.map((t) => {
            const prev = prevById.get(t.id);
            if (
                prev &&
                prev.peaks &&
                prev.peaks.length &&
                prev.barCount === t.barCount
            ) {
                reused++;
                return {
                    tileId: t.id,
                    pxLeft: t.px,
                    pxWidth: t.width,
                    masterStartSec: prev.masterStartSec,
                    masterEndSec: prev.masterEndSec,
                    barCount: t.barCount,
                    peaks: prev.peaks,
                    peakQuality: prev.peakQuality || 'preview',
                };
            }
            return {
                tileId: t.id,
                pxLeft: t.px,
                pxWidth: t.width,
                masterStartSec: t.masterStartSec,
                masterEndSec: t.masterEndSec,
                barCount: t.barCount,
                peaks: null,
            };
        });
        if (typeof logWaveformViewportTileMerge === 'function') {
            logWaveformViewportTileMerge('main', reused, tiles.length - reused, tiles.length);
        }
        waveformViewportPeaks = {
            masterStartSec: tiles[0].masterStartSec,
            masterEndSec: tiles[tiles.length - 1].masterEndSec,
            tiles,
        };
    }

    function mainWaveformTilePeakNeedsRefine(tile) {
        if (!tile || !tile.peaks || !tile.peaks.length) return false;
        if (tile.peakQuality === 'full') return false;
        if (!waveformPeakPyramid) return true;
        const rangeDur = tile.masterEndSec - tile.masterStartSec;
        if (!(rangeDur > 0)) return false;
        return (
            typeof isViewportPeakPyramidInsufficient === 'function' &&
            isViewportPeakPyramidInsufficient(
                waveformPeakPyramid,
                tile.barCount,
                rangeDur,
            )
        );
    }

    function applyMainWaveformViewportTile(tile, applyOpt) {
        const opt = applyOpt && typeof applyOpt === 'object' ? applyOpt : {};
        if (
            typeof isWaveformScrubPriorityActive === 'function' &&
            isWaveformScrubPriorityActive() &&
            !opt.cacheOnly &&
            !(opt.peakPass === 'preview' && opt.scrubPreview)
        ) {
            return false;
        }
        if (!waveformAudioBuffer || !tile || !waveformViewportPeaks || !waveformViewportPeaks.tiles) {
            return false;
        }
        const cacheOnly = !!opt.cacheOnly;
        const contentDur = getWaveformAudioDurationSec();
        const timelineStartSec = 0;
        const trackEndSec = timelineStartSec + contentDur;
        const t0 = Math.max(timelineStartSec, tile.masterStartSec);
        const t1 = Math.min(trackEndSec, tile.masterEndSec);
        if (t1 <= t0 + 1e-9) return false;
        const audioStart = t0 - timelineStartSec;
        const audioEnd = t1 - timelineStartSec;
        let peaks = [];
        let peakQuality = 'preview';
        const rangeOpt = cacheOnly ? { cacheOnly: true } : opt;
        if (typeof peaksForViewportRangeWithQuality === 'function') {
            const bufId =
                typeof bufferPeakId === 'function'
                    ? bufferPeakId(waveformAudioBuffer)
                    : 0;
            const result = peaksForViewportRangeWithQuality(
                waveformAudioBuffer,
                waveformPeakPyramid,
                audioStart,
                audioEnd,
                tile.barCount,
                bufId,
                rangeOpt,
            );
            peaks = result.peaks;
            peakQuality = result.peakQuality;
        } else if (typeof peaksForViewportRange === 'function') {
            const bufId =
                typeof bufferPeakId === 'function'
                    ? bufferPeakId(waveformAudioBuffer)
                    : 0;
            peaks = peaksForViewportRange(
                waveformAudioBuffer,
                waveformPeakPyramid,
                audioStart,
                audioEnd,
                tile.barCount,
                bufId,
                rangeOpt,
            );
            peakQuality = opt.peakPass === 'preview' ? 'preview' : 'full';
        } else if (!cacheOnly) {
            peaks = peaksFromAudioBufferRange(
                waveformAudioBuffer,
                audioStart,
                audioEnd,
                tile.barCount,
            );
            peakQuality = 'full';
        }
        if (!peaks.length) return false;
        const tiles = waveformViewportPeaks.tiles;
        for (let i = 0; i < tiles.length; i++) {
            if (tiles[i].tileId === tile.id) {
                tiles[i].peaks = peaks;
                tiles[i].masterStartSec = t0;
                tiles[i].masterEndSec = t1;
                tiles[i].barCount = tile.barCount;
                tiles[i].peakQuality = peakQuality;
                return true;
            }
        }
        return false;
    }

    function scheduleMainWaveformPeakPyramidBuild(buffer, barCount) {
        const gen = ++waveformPeakPyramidGen;
        const onBuilt = (pyramid) => {
            if (gen !== waveformPeakPyramidGen || waveformAudioBuffer !== buffer) return;
            if (!pyramid) return;
            waveformPeakPyramid = pyramid;
            refreshWaveformScrubOverviewCache();
            if (typeof peaksOverviewFromPyramid === 'function') {
                const overview = peaksOverviewFromPyramid(waveformPeakPyramid, barCount);
                if (overview && overview.length) waveformPeaks = overview;
            }
            drawAudioWaveformCanvas();
            if (typeof scheduleWaveformHiresRedrawAfterZoom === 'function') {
                scheduleWaveformHiresRedrawAfterZoom();
            }
        };
        const run = () => {
            if (gen !== waveformPeakPyramidGen || waveformAudioBuffer !== buffer) return;
            if (typeof buildPeakPyramidFromBufferAsync === 'function') {
                buildPeakPyramidFromBufferAsync(buffer, onBuilt);
            } else if (typeof buildPeakPyramidFromBuffer === 'function') {
                onBuilt(buildPeakPyramidFromBuffer(buffer));
            }
        };
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(run, { timeout: 3000 });
        } else {
            setTimeout(run, 16);
        }
    }

    function mainWaveformViewportTileLacksPeaks(tileId) {
        if (!waveformAudioBuffer) return false;
        if (!waveformViewportPeaks || !waveformViewportPeaks.tiles) return true;
        for (let i = 0; i < waveformViewportPeaks.tiles.length; i++) {
            const t = waveformViewportPeaks.tiles[i];
            if (t.tileId !== tileId) continue;
            return !(t.peaks && t.peaks.length);
        }
        return true;
    }

    function mainWaveformViewportTilePending(tileId) {
        if (!waveformAudioBuffer) return false;
        if (!waveformViewportPeaks || !waveformViewportPeaks.tiles) return false;
        for (let i = 0; i < waveformViewportPeaks.tiles.length; i++) {
            const t = waveformViewportPeaks.tiles[i];
            if (t.tileId !== tileId) continue;
            if (!(t.peaks && t.peaks.length)) return true;
            return mainWaveformTilePeakNeedsRefine(t);
        }
        return true;
    }

    function mainWaveformViewportTilesPending() {
        if (!waveformViewportPeaks) return true;
        const vp = waveformViewportPeaks;
        if (vp.tiles && vp.tiles.length) {
            for (let i = 0; i < vp.tiles.length; i++) {
                const t = vp.tiles[i];
                if (!(t.peaks && t.peaks.length)) return true;
                if (mainWaveformTilePeakNeedsRefine(t)) return true;
            }
            return false;
        }
        return !(vp.peaks && vp.peaks.length);
    }

    function mainWaveformViewportPeaksHasTiles() {
        return !!(
            waveformViewportPeaks &&
            waveformViewportPeaks.tiles &&
            waveformViewportPeaks.tiles.length
        );
    }

    window.clearMainWaveformViewportPeaks = clearMainWaveformViewportPeaks;
    window.rebuildMainWaveformOverviewPeaksIfNeeded = rebuildMainWaveformOverviewPeaksIfNeeded;
    window.rebuildMainWaveformViewportPeaks = rebuildMainWaveformViewportPeaks;
    window.initMainWaveformViewportTiles = initMainWaveformViewportTiles;
    window.applyMainWaveformViewportTile = applyMainWaveformViewportTile;
    window.mainWaveformViewportTilePending = mainWaveformViewportTilePending;
    window.mainWaveformViewportTileLacksPeaks = mainWaveformViewportTileLacksPeaks;
    window.mainWaveformViewportTilesPending = mainWaveformViewportTilesPending;
    window.mainWaveformViewportPeaksHasTiles = mainWaveformViewportPeaksHasTiles;

    function drawAudioWaveformCanvas() {
        const scrubActive =
            typeof isWaveformScrubPriorityActive === 'function' &&
            isWaveformScrubPriorityActive();
        if (!audioWaveformCanvas) return;
        const sized = syncAudioWaveformCanvasSize();
        if (!sized || !sized.ctx) return;
        const { ctx, wCss, hCss } = sized;
        const contentDur = getWaveformAudioDurationSec();
        const audible =
            typeof isVideoAudioAudible === 'function' ? isVideoAudioAudible() : true;
        const grad =
            typeof timelineWaveformFillGradient === 'function'
                ? timelineWaveformFillGradient(ctx, hCss, 'video', audible)
                : (() => {
                      const g = ctx.createLinearGradient(0, 0, 0, hCss);
                      g.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
                      g.addColorStop(0.5, 'rgba(255, 255, 255, 0.96)');
                      g.addColorStop(1, 'rgba(255, 255, 255, 0.42)');
                      return g;
                  })();
        const drawOpt = Object.assign({}, sized.drawOpt || {});
        const useScrubOverview =
            scrubActive &&
            waveformScrubOverviewDrawCommitted &&
            waveformScrubOverviewPeaks &&
            waveformScrubOverviewPeaks.length;
        let peaksForDraw = useScrubOverview ? waveformScrubOverviewPeaks : waveformPeaks;
        if (
            scrubActive &&
            (!peaksForDraw || !peaksForDraw.length) &&
            waveformScrubOverviewPeaks &&
            waveformScrubOverviewPeaks.length
        ) {
            peaksForDraw = waveformScrubOverviewPeaks;
        }
        if (!useScrubOverview && waveformViewportPeaks) {
            drawOpt.viewportPeaks = waveformViewportPeaks;
        }
        if (scrubActive && !useScrubOverview) {
            drawOpt.scrubRedraw = true;
        }
        drawPeaksForMasterTimeline(ctx, peaksForDraw, wCss, hCss, contentDur, grad, drawOpt);
    }

    function seekFromWaveformPointer(clientX, opt) {
        if (typeof applyTransportAtRatio !== 'function') return;
        let ratio = transportRatioFromClientX(clientX);
        if (
            typeof transportSecFromClientX === 'function' &&
            typeof snapTransportSecForWaveformSeek === 'function'
        ) {
            const raw = transportSecFromClientX(clientX);
            const altSuppressed =
                typeof isSnapSuppressedByAlt === 'function' ? isSnapSuppressedByAlt() : false;
            const snapped = snapTransportSecForWaveformSeek(raw, { altKey: altSuppressed });
            const master =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : 0;
            if (master > 0 && Number.isFinite(snapped)) {
                ratio = Math.max(0, Math.min(1, snapped / master));
            }
        }
        applyTransportAtRatio(ratio, opt);
    }

    function snapSeekBarTransportSec(t) {
        if (!Number.isFinite(t)) return t;
        if (typeof snapTransportSecForWaveformSeek === 'function') {
            const altSuppressed =
                typeof isSnapSuppressedByAlt === 'function' ? isSnapSuppressedByAlt() : false;
            return snapTransportSecForWaveformSeek(t, { altKey: altSuppressed });
        }
        return t;
    }

    let waveformOffsetDragSegmentIndex = -1;

    function applyWaveformSegmentTimelineStartFromDrag(slot, segmentIndex, sec, opt) {
        if (typeof setSegmentTimelineStartSec === 'function') {
            setSegmentTimelineStartSec(
                { type: 'extra', slot },
                segmentIndex,
                sec,
                Object.assign(
                    {
                        skipPersist: true,
                        forceAudio: true,
                        skipUndo: true,
                        dragStartRegionIn: waveformOffsetDragStartTimelineSec,
                        dragStartAnchor: waveformOffsetDragStartAnchorSec,
                        preserveInPadSec: waveformOffsetDragPreserveInPadSec,
                    },
                    opt || {},
                ),
            );
        }
    }

    function regionGroupDragKey(slot, segmentIndex) {
        return slot + ':' + segmentIndex;
    }

    function applyWaveformGroupSegmentTimelineStartFromDrag(slot, primaryNextSec, opt) {
        const members =
            waveformOffsetDragGroupMembers && waveformOffsetDragGroupMembers.length
                ? waveformOffsetDragGroupMembers
                : waveformOffsetDragSegmentIndex >= 0
                  ? [{ slot, segmentIndex: waveformOffsetDragSegmentIndex }]
                  : [];
        if (!members.length) return;

        if (members.length === 1) {
            applyWaveformSegmentTimelineStartFromDrag(
                slot,
                waveformOffsetDragSegmentIndex,
                primaryNextSec,
                opt,
            );
            return;
        }

        const primaryKey = regionGroupDragKey(slot, waveformOffsetDragSegmentIndex);
        const primaryStart =
            waveformOffsetDragGroupStartTimelineByKey &&
            Number.isFinite(waveformOffsetDragGroupStartTimelineByKey[primaryKey])
                ? waveformOffsetDragGroupStartTimelineByKey[primaryKey]
                : waveformOffsetDragStartTimelineSec;
        const primaryTrack = { type: 'extra', slot };
        const primaryDragRegionIn =
            waveformOffsetDragGroupStartRegionInByKey &&
            Number.isFinite(waveformOffsetDragGroupStartRegionInByKey[primaryKey])
                ? waveformOffsetDragGroupStartRegionInByKey[primaryKey]
                : primaryStart;
        const primaryDragAnchor =
            waveformOffsetDragGroupStartAnchorByKey &&
            Number.isFinite(waveformOffsetDragGroupStartAnchorByKey[primaryKey])
                ? waveformOffsetDragGroupStartAnchorByKey[primaryKey]
                : primaryStart;

        let snappedNext = primaryNextSec;
        let snapDetail = null;
        const skipSnap = !!(opt && opt.skipSnap);
        if (!skipSnap && typeof snapRegionMoveRegionInSecDetail === 'function') {
            const snapResult = snapRegionMoveRegionInSecDetail(
                primaryNextSec,
                primaryTrack,
                waveformOffsetDragSegmentIndex,
                {
                    dragStartRegionIn: primaryDragRegionIn,
                    dragStartAnchor: primaryDragAnchor,
                    exclude: { slot, segmentIndex: waveformOffsetDragSegmentIndex },
                    commitSnap: !(opt && opt.geometryOnly),
                    lastProposedHeadSec: opt && opt.lastProposedHeadSec,
                    geometryOnly: !!(opt && opt.geometryOnly),
                },
            );
            snappedNext = snapResult.sec;
            snapDetail = snapResult.detail;
        } else if (!skipSnap && typeof snapRegionMoveRegionInSec === 'function') {
            snappedNext = snapRegionMoveRegionInSec(
                primaryNextSec,
                primaryTrack,
                waveformOffsetDragSegmentIndex,
                {
                    dragStartRegionIn: primaryDragRegionIn,
                    dragStartAnchor: primaryDragAnchor,
                    exclude: { slot, segmentIndex: waveformOffsetDragSegmentIndex },
                },
            );
        }

        const primaryCurrent =
            typeof getSegmentRegionTimelineIn === 'function'
                ? getSegmentRegionTimelineIn(
                      primaryTrack,
                      waveformOffsetDragSegmentIndex,
                  )
                : primaryStart;
        const deltaRaw = snappedNext - primaryCurrent;
        const effectiveDelta =
            typeof clampRegionGroupMoveDelta === 'function'
                ? clampRegionGroupMoveDelta(
                      members,
                      deltaRaw,
                      waveformOffsetDragGroupStartRegionInByKey,
                      { useCurrentRegionInBase: true },
                  )
                : deltaRaw;

        if (typeof applyRegionGroupMoveDelta === 'function') {
            applyRegionGroupMoveDelta(members, effectiveDelta, {
                startRegionInByKey: waveformOffsetDragGroupStartRegionInByKey,
                startAnchorByKey: waveformOffsetDragGroupStartAnchorByKey,
                skipPersist: !!(opt && opt.skipPersist),
                forceAudio: !!(opt && opt.forceAudio !== false),
                skipUndo: !!(opt && opt.skipUndo),
                geometryOnly: !!(opt && opt.geometryOnly),
                useCurrentRegionInBase: true,
            });
        }
        if (
            !(opt && opt.geometryOnly) &&
            snapDetail &&
            typeof window.regionSnapDiagLogMoveCommit === 'function'
        ) {
            const headAfterApply =
                typeof getSegmentRegionTimelineIn === 'function'
                    ? getSegmentRegionTimelineIn(
                          primaryTrack,
                          waveformOffsetDragSegmentIndex,
                      )
                    : null;
            window.regionSnapDiagLogMoveCommit(
                primaryTrack,
                waveformOffsetDragSegmentIndex,
                primaryNextSec,
                snapDetail,
                Object.assign({}, opt || {}, {
                    phase: 'commit',
                    headBeforeApply: primaryCurrent,
                    headAfterApply,
                }),
            );
        }
    }

    function onWaveformTrackOffsetPointerDown(ev, slot, segmentIndex) {
        if (waveformOffsetDragActive) {
            return;
        }
        if (
            typeof isPlaybackRegionOffsetDragForbidden === 'function' &&
            isPlaybackRegionOffsetDragForbidden() &&
            typeof segmentIndex === 'number' &&
            segmentIndex >= 0
        ) {
            return;
        }
        if (typeof syncSnapSuppressionFromPointerEvent === 'function') {
            syncSnapSuppressionFromPointerEvent(ev);
        }
        isSeeking = false;
        if (typeof cancelWaveformPointerGesture === 'function') {
            cancelWaveformPointerGesture();
        }
        const scrubLanes = waveformScrubTargetEl();
        if (scrubLanes) {
            scrubLanes.classList.remove('audio-waveform-composite__lanes--scrubbing');
        }
        if (typeof beginRegionUndoGesture === 'function') beginRegionUndoGesture();
        waveformOffsetDragActive = true;
        waveformOffsetDragSlot = slot;
        waveformOffsetDragSegmentIndex =
            typeof segmentIndex === 'number' && segmentIndex >= 0 ? segmentIndex : -1;
        waveformOffsetDragPointerId = ev.pointerId;
        if (typeof beginRegionOffsetDragMasterFreeze === 'function') {
            beginRegionOffsetDragMasterFreeze();
        }
        waveformOffsetDragStartMasterSec =
            typeof getRegionOffsetDragMasterFreezeSec === 'function'
                ? getRegionOffsetDragMasterFreezeSec()
                : typeof getMasterTransportDurationSec === 'function'
                  ? getMasterTransportDurationSec()
                  : NaN;
        waveformOffsetDragStartClientX = Number.isFinite(waveformPointerGestureStartX)
            ? waveformPointerGestureStartX
            : ev.clientX;
        const offsetDragScrubW =
            typeof waveformTimelineScrubWidthCss === 'function'
                ? waveformTimelineScrubWidthCss()
                : 0;
        waveformOffsetDragStartScrubW = offsetDragScrubW > 0 ? offsetDragScrubW : NaN;
        waveformOffsetDragStartPointerRatio =
            typeof window.regionOffsetDragRatioFromClientX === 'function'
                ? window.regionOffsetDragRatioFromClientX(waveformOffsetDragStartClientX)
                : typeof window.scrubRatioUnclampedFromClientX === 'function' &&
                    waveformOffsetDragStartScrubW > 0
                  ? window.scrubRatioUnclampedFromClientX(
                        waveformOffsetDragStartClientX,
                        waveformOffsetDragStartScrubW,
                    )
                  : NaN;
        waveformOffsetDragStartXContent =
            Number.isFinite(waveformOffsetDragStartPointerRatio) &&
            waveformOffsetDragStartScrubW > 0
                ? waveformOffsetDragStartPointerRatio * waveformOffsetDragStartScrubW
                : NaN;
        if (waveformOffsetDragSegmentIndex >= 0) {
            const track = { type: 'extra', slot };
            waveformOffsetDragGroupMembers =
                typeof collectRegionGroupMembers === 'function'
                    ? collectRegionGroupMembers(track, waveformOffsetDragSegmentIndex)
                    : [{ slot, segmentIndex: waveformOffsetDragSegmentIndex }];
            waveformOffsetDragGroupStartTimelineByKey = {};
            waveformOffsetDragGroupStartAnchorByKey = {};
            waveformOffsetDragGroupStartRegionInByKey = {};
            for (let gi = 0; gi < waveformOffsetDragGroupMembers.length; gi++) {
                const m = waveformOffsetDragGroupMembers[gi];
                const key = regionGroupDragKey(m.slot, m.segmentIndex);
                waveformOffsetDragGroupStartTimelineByKey[key] =
                    typeof getSegmentTimelineStartForAltDrag === 'function'
                        ? getSegmentTimelineStartForAltDrag(m.slot, m.segmentIndex)
                        : 0;
                waveformOffsetDragGroupStartAnchorByKey[key] =
                    typeof getSegmentAnchorForAltDrag === 'function'
                        ? getSegmentAnchorForAltDrag(m.slot, m.segmentIndex)
                        : waveformOffsetDragGroupStartTimelineByKey[key];
                waveformOffsetDragGroupStartRegionInByKey[key] =
                    waveformOffsetDragGroupStartTimelineByKey[key];
            }
            const primaryKey = regionGroupDragKey(slot, waveformOffsetDragSegmentIndex);
            waveformOffsetDragStartTimelineSec =
                waveformOffsetDragGroupStartTimelineByKey[primaryKey];
            waveformOffsetDragStartAnchorSec =
                waveformOffsetDragGroupStartAnchorByKey[primaryKey];
            waveformOffsetDragLastProposedSec = waveformOffsetDragStartTimelineSec;
            const transportAtGrab =
                Number.isFinite(waveformOffsetDragStartPointerRatio) &&
                Number.isFinite(waveformOffsetDragStartMasterSec)
                    ? waveformOffsetDragStartPointerRatio * waveformOffsetDragStartMasterSec
                    : typeof transportSecFromClientX === 'function'
                      ? transportSecFromClientX(waveformOffsetDragStartClientX)
                      : NaN;
            waveformOffsetDragGrabTransportOffsetSec =
                Number.isFinite(transportAtGrab) &&
                Number.isFinite(waveformOffsetDragStartTimelineSec)
                    ? transportAtGrab - waveformOffsetDragStartTimelineSec
                    : NaN;
            waveformOffsetDragPreserveInPadSec =
                typeof getSegmentRegionInPadForAltDrag === 'function'
                    ? getSegmentRegionInPadForAltDrag(slot, waveformOffsetDragSegmentIndex)
                    : Math.max(
                          0,
                          waveformOffsetDragStartTimelineSec -
                              waveformOffsetDragStartAnchorSec,
                      );
        } else {
            waveformOffsetDragGroupMembers = null;
            waveformOffsetDragGroupStartTimelineByKey = null;
            waveformOffsetDragGroupStartAnchorByKey = null;
            waveformOffsetDragGroupStartRegionInByKey = null;
            waveformOffsetDragStartTimelineSec =
                typeof getExtraTrackTimelineStartSec === 'function'
                    ? getExtraTrackTimelineStartSec(slot)
                    : 0;
        }
        hideHoverPlayhead();
        const lanes = waveformScrubTargetEl();
        if (lanes) {
            lanes.classList.add('audio-waveform-composite__lanes--offset-drag');
            if (ev.pointerId != null && typeof lanes.setPointerCapture === 'function') {
                try {
                    lanes.setPointerCapture(ev.pointerId);
                } catch (_) {}
            }
        }
        if (waveformOffsetDragSegmentIndex >= 0) {
            writeLog(
                'Waveform: drag region ' +
                    (waveformOffsetDragSegmentIndex + 1) +
                    ' start (Ex ' +
                    (slot + 1) +
                    ')',
            );
        } else {
            writeLog('Waveform: drag track offset start (Ex ' + (slot + 1) + ')');
        }

        waveformOffsetDragDocMove = (e) => {
            if (!waveformOffsetDragActive || e.pointerId !== waveformOffsetDragPointerId) return;
            if (typeof syncSnapSuppressionFromPointerEvent === 'function') {
                syncSnapSuppressionFromPointerEvent(e);
            }
            const next =
                typeof regionOffsetDragRegionInSecFromClientX === 'function'
                    ? regionOffsetDragRegionInSecFromClientX(e.clientX)
                    : waveformOffsetDragStartTimelineSec +
                      timelineSecDeltaFromClientXDelta(
                          e.clientX,
                          waveformOffsetDragStartClientX,
                      );
            if (waveformOffsetDragSegmentIndex >= 0) {
                applyWaveformGroupSegmentTimelineStartFromDrag(slot, next, {
                    skipPersist: true,
                    geometryOnly: true,
                    lastProposedHeadSec: waveformOffsetDragLastProposedSec,
                });
                const dragTrack = { type: 'extra', slot };
                if (typeof getSegmentRegionTimelineIn === 'function') {
                    waveformOffsetDragLastProposedSec = getSegmentRegionTimelineIn(
                        dragTrack,
                        waveformOffsetDragSegmentIndex,
                    );
                }
            } else {
                applyWaveformTimelineStartFromDrag(slot, next, { skipPersist: true });
            }
            if (typeof updateRegionOffsetDragMasterFreeze === 'function') {
                updateRegionOffsetDragMasterFreeze();
            }
        };
        waveformOffsetDragDocUp = (e) => {
            if (!waveformOffsetDragActive || e.pointerId !== waveformOffsetDragPointerId) return;
            if (typeof e.preventDefault === 'function') {
                e.preventDefault();
            }
            if (typeof updateRegionOffsetDragMasterFreeze === 'function') {
                updateRegionOffsetDragMasterFreeze();
            }
            const next =
                typeof regionOffsetDragRegionInSecFromClientX === 'function'
                    ? regionOffsetDragRegionInSecFromClientX(e.clientX)
                    : waveformOffsetDragStartTimelineSec +
                      timelineSecDeltaFromClientXDelta(
                          e.clientX,
                          waveformOffsetDragStartClientX,
                      );
            const dragMembers =
                waveformOffsetDragGroupMembers && waveformOffsetDragGroupMembers.length
                    ? waveformOffsetDragGroupMembers.slice()
                    : waveformOffsetDragSegmentIndex >= 0
                      ? [{ slot, segmentIndex: waveformOffsetDragSegmentIndex }]
                      : [];
            if (waveformOffsetDragSegmentIndex >= 0) {
                const commitTrack = { type: 'extra', slot };
                const commitSec =
                    typeof getSegmentRegionTimelineIn === 'function'
                        ? getSegmentRegionTimelineIn(
                              commitTrack,
                              waveformOffsetDragSegmentIndex,
                          )
                        : next;
                applyWaveformGroupSegmentTimelineStartFromDrag(slot, commitSec, {
                    skipSnap: true,
                    snapDiagClientX: e.clientX,
                });
                if (
                    dragMembers.length &&
                    typeof finalizeRegionOffsetDragPresentation === 'function'
                ) {
                    finalizeRegionOffsetDragPresentation(dragMembers);
                }
            } else {
                applyWaveformTimelineStartFromDrag(slot, next);
            }
            if (typeof endRegionOffsetDragMasterFreeze === 'function') {
                endRegionOffsetDragMasterFreeze();
            }
            if (typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
            const releasedSegmentIndex = waveformOffsetDragSegmentIndex;
            const t =
                releasedSegmentIndex >= 0 &&
                typeof getSegmentTimelineStartForAltDrag === 'function'
                    ? getSegmentTimelineStartForAltDrag(slot, releasedSegmentIndex)
                    : typeof getExtraTrackTimelineStartSec === 'function'
                      ? getExtraTrackTimelineStartSec(slot)
                      : 0;
            endWaveformTrackOffsetDrag({ force: true, event: e });
            setHoverPlayheadAtClientX(e.clientX, e.clientY);
            const tc =
                typeof formatTimecodeForTransport === 'function'
                    ? formatTimecodeForTransport(t)
                    : t.toFixed(2) + ' s';
            if (releasedSegmentIndex >= 0) {
                writeLog(
                    'Waveform: Ex ' +
                        (slot + 1) +
                        ' region ' +
                        (releasedSegmentIndex + 1) +
                        ' at ' +
                        tc,
                );
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint('Region start', tc);
                }
            } else {
                writeLog('Waveform: Ex ' + (slot + 1) + ' audio start at ' + tc);
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint('Audio start', tc);
                }
            }
            if (typeof commitRegionUndoGesture === 'function') commitRegionUndoGesture();
            if (typeof schedulePersistSession === 'function') schedulePersistSession();
        };
        window.commitWaveformOffsetDragIfActive = function commitWaveformOffsetDragIfActive(e) {
            if (!waveformOffsetDragActive) return false;
            if (
                e &&
                waveformOffsetDragPointerId != null &&
                e.pointerId !== waveformOffsetDragPointerId
            ) {
                return false;
            }
            if (typeof waveformOffsetDragDocUp !== 'function') return false;
            waveformOffsetDragDocUp(
                e || { pointerId: waveformOffsetDragPointerId, clientX: NaN, clientY: NaN },
            );
            return true;
        };
        document.addEventListener('pointermove', waveformOffsetDragDocMove);
        document.addEventListener('pointerup', waveformOffsetDragDocUp);
        document.addEventListener('pointercancel', waveformOffsetDragDocUp);
    }

    function onWaveformPointerMove(ev) {
        if (waveformOffsetDragActive) return;
        setHoverPlayheadAtClientX(ev.clientX, ev.clientY);
    }

    function clipAudioBufferToDuration(buffer, maxSec) {
        if (!buffer || !(maxSec > 0)) return buffer;
        const maxLen = Math.min(buffer.length, Math.ceil(maxSec * buffer.sampleRate));
        if (maxLen >= buffer.length) return buffer;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return buffer;
        const ctx = new Ctx();
        try {
            const out = ctx.createBuffer(buffer.numberOfChannels, maxLen, buffer.sampleRate);
            for (let c = 0; c < buffer.numberOfChannels; c++) {
                out.copyToChannel(buffer.getChannelData(c).subarray(0, maxLen), c, 0);
            }
            return out;
        } catch (_) {
            return buffer;
        } finally {
            try {
                if (typeof ctx.close === 'function') ctx.close();
            } catch (_) {}
        }
    }

    async function readArrayBufferForWaveformDecode() {
        if (fileMain && typeof fileMain.arrayBuffer === 'function') {
            const n = fileMain.size || 0;
            if (n > WAVEFORM_DECODE_MAX_BYTES) {
                throw new Error(
                    'file too large (' + Math.round(n / (1024 * 1024)) + ' MB; max ' +
                        Math.round(WAVEFORM_DECODE_MAX_BYTES / (1024 * 1024)) +
                        ' MB)'
                );
            }
            setAudioWaveformStatus('Reading audio…');
            await yieldToBrowser();
            return await fileMain.arrayBuffer();
        }
        const res = await fetch(urlMain);
        if (!res.ok) throw new Error('fetch unavailable');
        const ab = await res.arrayBuffer();
        if (ab.byteLength > WAVEFORM_DECODE_MAX_BYTES) {
            const e = new Error('blob too large for waveform decode');
            e.byteLength = ab.byteLength;
            throw e;
        }
        return ab;
    }

    async function buildAudioWaveformForCurrentVideo() {
        const gen = ++waveformBuildGen;
        if (!urlMain) {
            clearAudioWaveform();
            return;
        }
        if (!videoReady()) {
            scheduleWaveformBuildRetryIfNeeded();
            return;
        }
        waveformDecodeInFlight = true;
        if (typeof syncVideoTrackWaveformLoading === 'function') {
            syncVideoTrackWaveformLoading();
        }
        if (containerHasAudio.main === false) {
            waveformDecodeInFlight = false;
            waveformPeaks = null;
            setAudioWaveformLoaded(false);
            setAudioWaveformStatus('Not Loaded');
            drawAudioWaveformCanvas();
            updateAllWaveformPlayheads();
            if (typeof renderAudioWaveformMarkers === 'function') renderAudioWaveformMarkers();
            showExtraLaneForNoVideoAudio();
            notifyVideoAudioLoadSettled();
            if (typeof syncVideoTrackWaveformLoading === 'function') {
                syncVideoTrackWaveformLoading();
            }
            return;
        }

        if (fileMain && fileMain.size > WAVEFORM_DECODE_MAX_BYTES) {
            waveformDecodeInFlight = false;
            reportWaveformFileTooLarge(fileMain.size);
            return;
        }

        setAudioWaveformLoaded(true);
        setAudioWaveformStatus('Decoding audio…');
        await yieldToBrowser();

        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) {
            waveformDecodeInFlight = false;
            setAudioWaveformStatus('AudioContext unavailable');
            notifyVideoAudioLoadSettled();
            return;
        }

        let buffer;
        const ctx = new Ctx();
        try {
            let ab = await readArrayBufferForWaveformDecode();
            if (waveformBuildGenerationStale(gen)) return;
            setAudioWaveformStatus('Decoding audio…');
            await yieldToBrowser();
            if (waveformBuildGenerationStale(gen)) return;
            try {
                buffer = await decodeArrayBufferToAudioBuffer(
                    ctx,
                    ab,
                    WAVEFORM_DECODE_TIMEOUT_MS,
                );
            } catch (err1) {
                if (!urlMain) throw err1;
                const res = await fetch(urlMain);
                if (!res.ok) throw err1;
                ab = await res.arrayBuffer();
                if (waveformBuildGenerationStale(gen)) return;
                await yieldToBrowser();
                buffer = await decodeArrayBufferToAudioBuffer(
                    ctx,
                    ab,
                    WAVEFORM_DECODE_TIMEOUT_MS,
                );
            }
            if (waveformBuildGenerationStale(gen)) return;
            const videoDur = getDuration(videoMain);
            if (videoDur > 0 && buffer.duration > videoDur + 0.5) {
                buffer = clipAudioBufferToDuration(buffer, videoDur);
            }
        } catch (err) {
            if (waveformBuildGenerationStale(gen)) return;
            if (isWaveformFileTooLargeError(err)) {
                const n =
                    fileMain && fileMain.size
                        ? fileMain.size
                        : err && err.byteLength
                          ? err.byteLength
                          : 0;
                reportWaveformFileTooLarge(n);
                return;
            }
            waveformPeaks = null;
            const msg = err && err.message ? err.message : String(err);
            writeLog('Waveform: decode failed — ' + msg);
            setAudioWaveformStatus('Waveform unavailable');
            if (typeof clearWaveformTrackLkfs === 'function' && audioWaveformTrack) {
                clearWaveformTrackLkfs(audioWaveformTrack);
            }
            drawAudioWaveformCanvas();
            notifyVideoAudioLoadSettled();
            if (typeof syncVideoTrackWaveformLoading === 'function') {
                syncVideoTrackWaveformLoading();
            }
            return;
        } finally {
            waveformDecodeInFlight = false;
            try {
                if (typeof ctx.close === 'function') await ctx.close();
            } catch (_) {
                /* ignore */
            }
        }

        if (waveformBuildGenerationStale(gen)) return;

        waveformAudioBuffer = buffer;
        waveformPeakPyramid = null;
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport();
        }
        const sized = syncAudioWaveformCanvasSize();
        const barCount = sized ? sized.barCount : 1200;
        if (typeof peaksFromAudioBuffer === 'function') {
            waveformPeaks = peaksFromAudioBuffer(buffer, Math.min(512, barCount));
        }
        scheduleMainWaveformPeakPyramidBuild(buffer, barCount);
        const ch = buffer.numberOfChannels;
        const rate = buffer.sampleRate | 0;
        const dur = buffer.duration;
        setAudioWaveformStatus(
            ch +
                ' ch · ' +
                (rate ? rate + ' Hz' : '') +
                (dur > 0 ? ' · ' + dur.toFixed(2) + ' s' : ''),
        );
        if (typeof scheduleWaveformTrackLkfsMeasure === 'function' && audioWaveformTrack) {
            void scheduleWaveformTrackLkfsMeasure(audioWaveformTrack, buffer);
        }
        drawAudioWaveformCanvas();
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        notifyVideoAudioLoadSettled();
        stopMainVideoWaveformPresenceWatch();
        if (typeof syncVideoTrackWaveformLoading === 'function') {
            syncVideoTrackWaveformLoading();
        }
    }

    function onContainerMetaReadyForWaveform() {
        if (!urlMain) return;
        if (containerHasAudio.main === false) {
            waveformBuildGen += 1;
            notifyVideoAudioLoadSettled();
            waveformPeaks = null;
            waveformAudioBuffer = null;
            setAudioWaveformLoaded(false);
            setAudioWaveformStatus('Not Loaded');
            drawAudioWaveformCanvas();
            updateAllWaveformPlayheads();
            if (typeof renderAudioWaveformMarkers === 'function') renderAudioWaveformMarkers();
            if (typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
            showExtraLaneForNoVideoAudio();
            if (typeof syncVideoTrackWaveformLoading === 'function') {
                syncVideoTrackWaveformLoading();
            }
            return;
        }
        refreshVideoAudioLaneVisibility();
    }

    function detachWaveformPauseBuildListener() {
        if (waveformPauseBuildListener) {
            videoMain.removeEventListener('pause', waveformPauseBuildListener);
            waveformPauseBuildListener = null;
        }
    }

    function abortWaveformDecodeInFlight() {
        waveformBuildGen += 1;
        waveformDecodeInFlight = false;
    }

    function abortWaveformSchedule() {
        if (waveformBuildTimer) {
            clearTimeout(waveformBuildTimer);
            waveformBuildTimer = 0;
        }
        if (waveformLoadKickTimer) {
            clearTimeout(waveformLoadKickTimer);
            waveformLoadKickTimer = 0;
        }
        detachWaveformPauseBuildListener();
    }

    function abortWaveformBuildInFlight() {
        abortWaveformDecodeInFlight();
        abortWaveformSchedule();
    }

    function shouldBuildMainVideoWaveform() {
        if (containerHasAudio.main === false) return false;
        if (isVideoAudioLaneShown()) return true;
        return containerHasAudio.main === true || containerHasAudio.main === null;
    }

    function waitForVideoReadyThenBuild() {
        if (!videoMain || !urlMain) return;
        const retry = () => {
            videoMain.removeEventListener('loadedmetadata', retry);
            videoMain.removeEventListener('durationchange', retry);
            videoMain.removeEventListener('loadeddata', retry);
            startWaveformBuildWhenReady();
        };
        videoMain.addEventListener('loadedmetadata', retry, { once: true });
        videoMain.addEventListener('durationchange', retry, { once: true });
        videoMain.addEventListener('loadeddata', retry, { once: true });
    }

    function startWaveformBuildWhenReady() {
        if (!urlMain) return;
        if (containerHasAudio.main === false) {
            notifyVideoAudioLoadSettled();
            return;
        }
        if (!videoReady()) {
            waitForVideoReadyThenBuild();
            return;
        }
        if (!shouldBuildMainVideoWaveform()) {
            if (containerHasAudio.main === false) {
                notifyVideoAudioLoadSettled();
            }
            return;
        }
        if (waveformPeaks && waveformPeaks.length > 0) {
            notifyVideoAudioLoadSettled();
            return;
        }

        const run = () => {
            if (!urlMain) return;
            if (!videoReady()) {
                waitForVideoReadyThenBuild();
                return;
            }
            if (waveformPeaks && waveformPeaks.length > 0) {
                notifyVideoAudioLoadSettled();
                return;
            }
            void buildAudioWaveformForCurrentVideo();
        };

        if (videoMain.readyState < 2) {
            const onMeta = () => {
                videoMain.removeEventListener('loadeddata', onMeta);
                startWaveformBuildWhenReady();
            };
            videoMain.addEventListener('loadeddata', onMeta, { once: true });
            return;
        }

        setTimeout(run, 0);
    }

    function scheduleBackgroundWaveformBuild(delayMs) {
        abortWaveformSchedule();
        if (!urlMain) return;
        let delay = delayMs > 0 ? delayMs : WAVEFORM_BG_BUILD_DELAY_MS;
        if (typeof isVideoLoadLockActive === 'function' && isVideoLoadLockActive()) {
            delay =
                typeof videoReady === 'function' && videoReady()
                    ? Math.min(delay, 80)
                    : 0;
        }
        setAudioWaveformLoaded(true);
        setAudioWaveformStatus('Loading waveform…');
        drawAudioWaveformCanvas();
        if (typeof syncVideoTrackWaveformLoading === 'function') {
            syncVideoTrackWaveformLoading();
        }
        const run = () => {
            waveformBuildTimer = 0;
            startWaveformBuildWhenReady();
        };
        if (delay <= 0) {
            run();
            return;
        }
        waveformBuildTimer = setTimeout(run, delay);
    }

    /** 動画メタ／コンテナ解析後に波形ビルドを開始（重複キックはまとめる）。 */
    function ensureMainVideoWaveformAfterSessionRestore() {
        if (!urlMain) return;
        if (containerHasAudio.main === false) return;
        kickMainVideoWaveformBuild({ allowSettle: false });
    }

    function kickMainVideoWaveformBuild(opt) {
        if (!urlMain) return;
        if (containerHasAudio.main === false) {
            stopMainVideoWaveformPresenceWatch();
            if (!opt || opt.allowSettle) notifyVideoAudioLoadSettled();
            return;
        }
        if (waveformPeaks && waveformPeaks.length > 0) {
            stopMainVideoWaveformPresenceWatch();
            if (!opt || opt.allowSettle) notifyVideoAudioLoadSettled();
            return;
        }
        if (waveformDecodeInFlight) {
            scheduleWaveformBuildRetryIfNeeded();
            scheduleMainVideoWaveformPresenceWatch();
            return;
        }
        if (waveformLoadKickTimer) {
            scheduleMainVideoWaveformPresenceWatch();
            return;
        }
        if (waveformBuildTimer) {
            clearTimeout(waveformBuildTimer);
            waveformBuildTimer = 0;
        }
        waveformLoadKickTimer = setTimeout(() => {
            waveformLoadKickTimer = 0;
            startWaveformBuildWhenReady();
        }, 0);
        scheduleMainVideoWaveformPresenceWatch();
    }

    /** 読み込みロック中のみキック（ロック解除待ちの波形用）。 */
    function ensureMainVideoWaveformBuildForLoad() {
        if (!isVideoLoadLockWaitingForAudio()) return;
        kickMainVideoWaveformBuild({ allowSettle: true });
    }

    /** ロック解除後も波形が未完了なら再キック。 */
    function kickMainVideoWaveformAfterLoadLock() {
        kickMainVideoWaveformBuild({ allowSettle: false });
    }

    function resetAudioWaveformForNewVideo(opt) {
        stopMainVideoWaveformPresenceWatch();
        abortWaveformSchedule();
        abortWaveformDecodeInFlight();
        waveformDecodeInFlight = false;
        waveformPeaks = null;
        waveformAudioBuffer = null;
        refreshVideoAudioLaneVisibility();
        setAudioWaveformLoaded(!!urlMain);
        if (!urlMain) {
            setAudioWaveformStatus('Not Loaded');
            drawAudioWaveformCanvas();
            if (audioWaveformPlayheadWrap) audioWaveformPlayheadWrap.hidden = true;
            return;
        }
        setAudioWaveformStatus('Loading waveform…');
        drawAudioWaveformCanvas();
        if (audioWaveformPlayheadWrap) audioWaveformPlayheadWrap.hidden = true;
        if (typeof syncVideoTrackWaveformLoading === 'function') {
            syncVideoTrackWaveformLoading();
        }
        if (!opt || !opt.skipScheduleBuild) {
            scheduleBackgroundWaveformBuild(WAVEFORM_BG_BUILD_DELAY_MS);
        }
    }

    function scheduleAudioWaveformBuildAfterPlayback() {
        scheduleBackgroundWaveformBuild(400);
    }

    function tryScheduleWaveformBuildIfNeeded(delayMs) {
        if (!urlMain || !videoReady()) return;
        if (waveformPeaks && waveformPeaks.length > 0) return;
        const label = audioWaveformStatus ? audioWaveformStatus.textContent || '' : '';
        if (label === 'No audio track' || label === 'Waveform unavailable') return;
        if (label.indexOf(' ch · ') >= 0) return;
        if (waveformBuildTimer) return;
        if (label.indexOf('Decoding') >= 0 && waveformDecodeInFlight) return;
        scheduleBackgroundWaveformBuild(delayMs > 0 ? delayMs : 600);
    }

    function ensureLaneScrubHitLayers() {
        const laneIds = ['audioWaveformLaneVideo'];
        for (let i = 0; i < extraTrackSlotCount(); i++) {
            laneIds.push('extraAudioLane' + i);
        }
        const musicalTrackIds = [
            'musicalRehearsalTrack',
            'musicalTempoTrack',
            'musicalSignatureTrack',
            'musicalMeasureTrack',
        ];
        for (let i = 0; i < laneIds.length; i++) {
            const lane = document.getElementById(laneIds[i]);
            if (!lane) continue;
            if (lane.querySelector(':scope > .audio-waveform-lane__scrub-hit')) continue;
            const hit = document.createElement('div');
            hit.className = 'audio-waveform-lane__scrub-hit';
            hit.setAttribute('aria-hidden', 'true');
            lane.insertBefore(hit, lane.firstChild);
        }
        for (let i = 0; i < musicalTrackIds.length; i++) {
            const track = document.getElementById(musicalTrackIds[i]);
            if (!track) continue;
            if (track.querySelector(':scope > .audio-waveform-lane__scrub-hit')) continue;
            const hit = document.createElement('div');
            hit.className = 'audio-waveform-lane__scrub-hit';
            hit.setAttribute('aria-hidden', 'true');
            track.insertBefore(hit, track.firstChild);
        }
    }

    function initAudioWaveformUi() {
        const lanes = waveformScrubTargetEl();
        if (!lanes) return;
        ensureLaneScrubHitLayers();
        if (typeof initWaveformTimelineZoomUi === 'function') initWaveformTimelineZoomUi();

        const videoAudioClearBtn = document.getElementById('videoAudioClearBtn');
        if (videoAudioClearBtn) {
            videoAudioClearBtn.disabled = true;
        }

        if (typeof ResizeObserver !== 'undefined') {
            waveformResizeObs = new ResizeObserver(() => {
                if (typeof applyWaveformTimelineZoomLayout === 'function') {
                    applyWaveformTimelineZoomLayout();
                }
                const sized = syncAudioWaveformCanvasSize();
                if (!sized) return;
                if (!waveformAudioBuffer) {
                    drawAudioWaveformCanvas();
                    updateAllWaveformPlayheads();
                    return;
                }
                if (typeof scheduleWaveformVisualRefresh === 'function') {
                    scheduleWaveformVisualRefresh();
                } else if (typeof applyWaveformViewportPeaksImmediate === 'function') {
                    applyWaveformViewportPeaksImmediate();
                    drawAudioWaveformCanvas();
                    if (typeof redrawAllExtraTrackWaveforms === 'function') {
                        redrawAllExtraTrackWaveforms();
                    }
                } else {
                    drawAudioWaveformCanvas();
                }
                updateAllWaveformPlayheads();
                if (typeof renderAudioWaveformMarkers === 'function') {
                    renderAudioWaveformMarkers();
                }
            });
            waveformResizeObs.observe(lanes);
        } else {
            window.addEventListener('resize', () => {
                drawAudioWaveformCanvas();
                updateAllWaveformPlayheads();
            });
        }

        lanes.addEventListener('pointerdown', onWaveformLanesPointerDownCapture, true);

        if (typeof seekBar !== 'undefined' && seekBar) {
            const flushSeekBarWaveformRefresh = () => {
                seekBarScrubActive = false;
                isSeeking = false;
                if (typeof resetWaveformScrubOverviewDrawState === 'function') {
                    resetWaveformScrubOverviewDrawState();
                }
                if (typeof endWaveformVisualRefreshDefer === 'function') {
                    endWaveformVisualRefreshDefer({ flush: true });
                }
            };
            const runSeekBarInputFrame = () => {
                seekBarInputRaf = 0;
                const t = seekBarInputPendingSec;
                seekBarInputPendingSec = null;
                if (!Number.isFinite(t)) return;
                isSeeking = true;
                if (typeof applyTransportScrubPositionImmediate === 'function') {
                    applyTransportScrubPositionImmediate(t, { deferSeekBar: true });
                } else if (typeof applyTransportAtSec === 'function') {
                    applyTransportAtSec(t, { scrubbing: true });
                }
            };
            const onSeekBarInput = () => {
                if (seekBar.disabled) return;
                const raw = parseFloat(seekBar.value);
                const t = seekBarScrubActive ? raw : snapSeekBarTransportSec(raw);
                if (!Number.isFinite(t)) return;
                seekBarInputPendingSec = t;
                if (seekBarInputRaf) return;
                seekBarInputRaf = requestAnimationFrame(runSeekBarInputFrame);
            };
            const onSeekBarChange = () => {
                if (seekBar.disabled) return;
                if (seekBarInputRaf) {
                    cancelAnimationFrame(seekBarInputRaf);
                    seekBarInputRaf = 0;
                    runSeekBarInputFrame();
                }
                const t = snapSeekBarTransportSec(parseFloat(seekBar.value));
                if (!Number.isFinite(t)) {
                    flushSeekBarWaveformRefresh();
                    return;
                }
                const wasPlayingBeforeSeek = seekBarScrubWasPlaying;
                seekBarScrubWasPlaying = false;
                if (typeof suppressRangeLoopSnapForExplicitSeek === 'function') {
                    suppressRangeLoopSnapForExplicitSeek();
                }
                if (typeof applyJumpTransportSeek === 'function') {
                    applyJumpTransportSeek(t, wasPlayingBeforeSeek);
                } else if (typeof applyTransportAtSec === 'function') {
                    applyTransportAtSec(t, {
                        logInput: true,
                        flash: true,
                        markers: true,
                        wasPlayingBeforeSeek,
                    });
                }
                flushSeekBarWaveformRefresh();
                if (typeof updateSeekUiFromVideo === 'function') updateSeekUiFromVideo();
            };
            seekBar.addEventListener('pointerdown', (ev) => {
                ev.stopPropagation();
                if (ev.button !== 0) return;
                seekBarScrubActive = true;
                if (typeof beginWaveformVisualRefreshDefer === 'function') {
                    beginWaveformVisualRefreshDefer();
                }
                if (typeof beginWaveformScrubOverviewDrawState === 'function') {
                    beginWaveformScrubOverviewDrawState();
                }
                seekBarScrubWasPlaying =
                    typeof captureTransportWasActive === 'function' && captureTransportWasActive();
                if (seekBarScrubWasPlaying && typeof pauseTransportBeforeSeek === 'function') {
                    pauseTransportBeforeSeek();
                }
                if (noteWaveformLanesPointerDownForDoubleClick(ev.clientX, ev.clientY)) {
                    ev.preventDefault();
                }
            });
            seekBar.addEventListener('input', onSeekBarInput);
            seekBar.addEventListener('change', onSeekBarChange);
        }

        lanes.addEventListener('pointermove', (ev) => {
            waveformLanesLastPointerX = ev.clientX;
            waveformLanesLastPointerY = ev.clientY;
            const exSlot = waveformExtraLaneSlotFromClientY(ev.clientY);
            if (exSlot >= 0) {
                waveformTargetExtraSlot = exSlot;
            } else if (isPointerOverVideoAudioLane(ev.clientY)) {
                waveformTargetExtraSlot = -1;
            }
            if (typeof updatePlaybackRegionHoverFromPointer === 'function') {
                updatePlaybackRegionHoverFromPointer(ev.clientX, ev.clientY);
            }
            onWaveformPointerMove(ev);
        });
        lanes.addEventListener('pointerleave', () => {
            waveformLanesLastPointerX = null;
            waveformLanesLastPointerY = null;
            if (typeof updatePlaybackRegionHoverFromPointer === 'function') {
                updatePlaybackRegionHoverFromPointer(null, null);
            }
            if (!waveformOffsetDragActive) hideHoverPlayhead();
        });

        if (audioWaveformComposite) {
            audioWaveformComposite.addEventListener('pointermove', (ev) => {
                refreshActiveMixLaneHighlight(ev.clientY);
            });
            audioWaveformComposite.addEventListener('pointerleave', () => {
                refreshActiveMixLaneHighlight(null);
            });
        }

        lanes.addEventListener('keydown', (ev) => {
            if (
                (typeof handleMusicalGridRehearsalSplitKeydown === 'function' &&
                    handleMusicalGridRehearsalSplitKeydown(ev)) ||
                (typeof handlePlaybackRegionSplitKeydown === 'function' &&
                    handlePlaybackRegionSplitKeydown(ev)) ||
                (typeof handlePlaybackRegionSlashKeydown === 'function' &&
                    handlePlaybackRegionSlashKeydown(ev))
            ) {
                return;
            }
            if (
                (typeof handleMusicalGridRehearsalJoinKeydown === 'function' &&
                    handleMusicalGridRehearsalJoinKeydown(ev)) ||
                (typeof handlePlaybackRegionJoinKeydown === 'function' &&
                    handlePlaybackRegionJoinKeydown(ev))
            ) {
                return;
            }
            if (
                typeof handleMusicalGridBarNavKeydown === 'function' &&
                handleMusicalGridBarNavKeydown(ev)
            ) {
                return;
            }
            const master =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : 0;
            if (!master) return;
            // PgUp/PgDn（±1s / Shift+±10s）は events-shortcuts 側で処理する。
            if (ev.shiftKey) return;
            let ratio = transportRatioFromMasterSec(
                typeof getTransportSec === 'function' ? getTransportSec() : 0,
            );
            if (matchUserShortcut(ev, 'transportSeekHomeStart', { allowRepeat: true })) ratio = 0;
            else if (matchUserShortcut(ev, 'transportSeekHomeEnd', { allowRepeat: true })) ratio = 1;
            else if (matchUserShortcut(ev, 'waveformLaneSeekPrev', { allowRepeat: true }))
                ratio = Math.max(0, ratio - masterFrameSec / master);
            else if (matchUserShortcut(ev, 'waveformLaneSeekNext', { allowRepeat: true }))
                ratio = Math.min(1, ratio + masterFrameSec / master);
            else return;
            const isOneFrameLaneSeek =
                matchUserShortcut(ev, 'waveformLaneSeekPrev', { allowRepeat: true }) ||
                matchUserShortcut(ev, 'waveformLaneSeekNext', { allowRepeat: true });
            const playingBeforeStep =
                typeof isTransportPlaying === 'function'
                    ? isTransportPlaying()
                    : !!(videoMain && !videoMain.paused);
            ev.preventDefault();
            if (isOneFrameLaneSeek && playingBeforeStep && ev.repeat) return;
            if (
                !ev.repeat &&
                typeof flashSeekHint === 'function' &&
                isOneFrameLaneSeek
            ) {
                const fwd = matchUserShortcut(ev, 'waveformLaneSeekNext', { allowRepeat: true });
                flashSeekHint(fwd ? '→' : '←', fwd ? '+1f' : '−1f');
            }
            if (isOneFrameLaneSeek && playingBeforeStep) {
                const t = ratio * master;
                if (typeof seekTransportToAndWait === 'function') {
                    void seekTransportToAndWait(t, {
                        pauseAfterSeek: true,
                        resumeAfter: false,
                    });
                } else {
                    applyTransportAtRatio(ratio, { markers: true });
                }
                return;
            }
            if (typeof noteKeyboardTransportScrubBegin === 'function') {
                noteKeyboardTransportScrubBegin(ev);
            }
            applyTransportAtRatio(ratio, {
                scrubbing: true,
                markers: false,
                logInput: !ev.repeat,
                flash: false,
                fromRepeat: ev.repeat,
            });
        });

        lanes.addEventListener('keyup', (ev) => {
            if (
                typeof isWaveformLaneSeekShortcut === 'function' &&
                isWaveformLaneSeekShortcut(ev) &&
                typeof flushKeyboardTransportScrubIfActive === 'function'
            ) {
                flushKeyboardTransportScrubIfActive();
            }
        });
    }

    window.onContainerMetaReadyForWaveform = onContainerMetaReadyForWaveform;
    function isMainVideoWaveformBuildPending() {
        if (!urlMain) return false;
        if (containerHasAudio.main === false) return false;
        if (waveformDecodeInFlight) return true;
        if (waveformBuildTimer || waveformLoadKickTimer) return true;
        const status = audioWaveformStatus ? audioWaveformStatus.textContent || '' : '';
        if (status === 'No audio track' || status === 'Waveform unavailable') return false;
        if (status.indexOf('Too large') >= 0) return false;
        if (status.indexOf(' ch · ') >= 0) return false;
        if (waveformPeaks && waveformPeaks.length > 0) return false;
        return true;
    }

    window.isMainVideoWaveformBuildPending = isMainVideoWaveformBuildPending;
    window.isVideoWaveformPlacementReady = isVideoWaveformPlacementReady;
    window.ensureMainVideoWaveformBuildForLoad = ensureMainVideoWaveformBuildForLoad;
    window.kickMainVideoWaveformBuild = kickMainVideoWaveformBuild;
    window.kickMainVideoWaveformAfterLoadLock = kickMainVideoWaveformAfterLoadLock;
    window.ensureMainVideoWaveformAfterSessionRestore = ensureMainVideoWaveformAfterSessionRestore;
    window.scheduleMainVideoWaveformPresenceWatch = scheduleMainVideoWaveformPresenceWatch;

    initAudioWaveformUi();
    refreshVideoAudioLaneVisibility();

