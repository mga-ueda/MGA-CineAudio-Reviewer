/**
 * waveform-viewport-visual.js — ズーム後の viewport 高解像度ピークと波形再描画。
 */
(function waveformViewportVisualModule() {

    let waveformHiresTimer = 0;
    let waveformHiresScrollTimer = 0;
    let waveformVisualRefreshRaf = 0;
    let regionBoundaryPresentationRaf = 0;
    const WAVEFORM_HIRES_DELAY_MS = 500;
    const WAVEFORM_HIRES_SCROLL_DELAY_MS = 320;
    /** 見た目を保ちつつ負荷を抑える（旧 4px） */
    const WAVEFORM_HIRES_BARS_PER_PX = 3;
    const WAVEFORM_HIRES_BAR_MAX = 12288;

    function cancelWaveformHiresRedraw() {
        if (waveformHiresTimer) {
            clearTimeout(waveformHiresTimer);
            waveformHiresTimer = 0;
        }
        if (waveformHiresScrollTimer) {
            clearTimeout(waveformHiresScrollTimer);
            waveformHiresScrollTimer = 0;
        }
    }

    function clearAllWaveformViewportPeaks() {
        if (typeof clearMainWaveformViewportPeaks === 'function') {
            clearMainWaveformViewportPeaks();
        }
        if (typeof clearAllExtraWaveformViewportPeaks === 'function') {
            clearAllExtraWaveformViewportPeaks();
        }
    }

    let lastWaveformViewportHiresSpec = null;

    /** 停止中の可視範囲（マスター時間）と高解像度バー数 */
    function getWaveformViewportHiresSpec() {
        // 以前は再生中の負荷を避けるため null にしていたが、
        // 再生中でもズーム/スクロール等で波形が追従できるよう spec を返す。
        const lanes = waveformScrubTargetEl();
        if (!lanes) return null;
        const m = waveformTimelineMetrics(lanes);
        if (!m || !(m.scrubW > 0) || !(m.viewportW > 0)) return null;
        const master = getMasterTransportDurationSec();
        if (!(master > 0)) return null;
        const scrollLeft = m.scrollable ? lanes.scrollLeft || 0 : 0;
        const visW = m.viewportW;
        const contentW = m.scrubW;
        const masterStartSec = (scrollLeft / contentW) * master;
        const masterEndSec = ((scrollLeft + visW) / contentW) * master;
        // ズームレベルに応じてバー密度を変化させる（LOD）
        const zoom = getWaveformTimelineZoom();
        let densityScale = 1;
        if (zoom <= 1.02) {
            densityScale = 0.42;
        } else if (zoom <= 4.5) {
            densityScale = 0.55;
        } else if (zoom <= 8.5) {
            densityScale = 0.68;
        } else if (zoom <= 16.5) {
            densityScale = 0.8;
        } else {
            densityScale = 0.92;
        }
        const barsPerPx = WAVEFORM_HIRES_BARS_PER_PX * densityScale;
        const barCount = Math.min(
            WAVEFORM_HIRES_BAR_MAX,
            Math.max(1, Math.round(visW * barsPerPx)),
        );
        return { masterStartSec, masterEndSec, barCount, master };
    }

    function waveformViewportSpecNearlyEqual(prev, live) {
        if (!prev || !live) return false;
        const dt0 = Math.abs(prev.masterStartSec - live.masterStartSec);
        const dt1 = Math.abs(prev.masterEndSec - live.masterEndSec);
        const db = Math.abs(prev.barCount - live.barCount);
        const timeThresh = live.master / 200;
        return dt0 < timeThresh && dt1 < timeThresh && db <= 12;
    }

    /** 再生中は viewport peaks 描画前に scroll を transport に合わせる（拡大中の再生時は除く） */
    function syncPlaybackScrollBeforeWaveformDraw() {
        if (typeof isTransportPlaying !== 'function' || !isTransportPlaying()) return;
        if (
            typeof shouldSkipWaveformTimelineAutoCentering === 'function' &&
            shouldSkipWaveformTimelineAutoCentering()
        ) {
            return;
        }
        const lanes = waveformScrubTargetEl();
        if (
            !lanes ||
            (typeof isWaveformTimelineAtFitZoom === 'function' && isWaveformTimelineAtFitZoom())
        ) {
            return;
        }
        const vw =
            typeof waveformTimelineViewportWidthCss === 'function'
                ? waveformTimelineViewportWidthCss()
                : 0;
        const scrubW =
            typeof waveformTimelineScrubWidthCss === 'function'
                ? waveformTimelineScrubWidthCss()
                : 0;
        if (!(vw > 0) || !(scrubW > 0)) return;
        if (typeof scrollLeftToCenterTransportSec !== 'function') return;
        const next = scrollLeftToCenterTransportSec(scrubW, vw);
        if (Math.abs((lanes.scrollLeft || 0) - next) > 0.01) {
            lanes.scrollLeft = next;
        }
    }

    function extraSlotsForViewportPeaks(opt) {
        if (opt && Array.isArray(opt.slots) && opt.slots.length) {
            return opt.slots.filter((s) => s >= 0);
        }
        if (typeof getVisibleLoadedExtraTrackSlots === 'function') {
            return getVisibleLoadedExtraTrackSlots();
        }
        return [];
    }

    function extraTrackNeedsViewportPeaksRebuild(slot) {
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        if (!tr || !tr.buffer) return false;
        const vp = tr.viewportPeaks;
        if (!vp) return true;
        if (vp.segments && vp.segments.length) {
            for (let i = 0; i < vp.segments.length; i++) {
                const s = vp.segments[i];
                if (
                    s.peaks &&
                    s.peaks.length &&
                    s.masterEndSec > s.masterStartSec + 1e-9
                ) {
                    return false;
                }
            }
            return true;
        }
        return !(vp.peaks && vp.peaks.length);
    }

    function anyExtraTracksNeedViewportPeaksRebuild(opt) {
        const slots = extraSlotsForViewportPeaks(opt);
        for (let j = 0; j < slots.length; j++) {
            if (extraTrackNeedsViewportPeaksRebuild(slots[j])) return true;
        }
        return false;
    }

    function rebuildWaveformViewportPeaksFromSpec(spec, opt) {
        if (!spec) return false;
        if (typeof rebuildMainWaveformViewportPeaks === 'function') {
            rebuildMainWaveformViewportPeaks(spec);
        }
        const extraSlots = extraSlotsForViewportPeaks(opt);
        for (let j = 0; j < extraSlots.length; j++) {
            const slot = extraSlots[j];
            if (typeof rebuildExtraTrackRegionViewportPeaks === 'function') {
                rebuildExtraTrackRegionViewportPeaks(slot, spec);
            }
        }
        return true;
    }

    /** ズーム・リサイズ直後: ピラミッドから可視範囲ピークを同期的に更新（粗い波形のチラつき防止） */
    function applyWaveformViewportPeaksImmediate(opt) {
        const spec = getWaveformViewportHiresSpec();
        if (!spec) return false;
        const peaksMissing = anyExtraTracksNeedViewportPeaksRebuild(opt);
        if (
            !peaksMissing &&
            lastWaveformViewportHiresSpec &&
            waveformViewportSpecNearlyEqual(lastWaveformViewportHiresSpec, spec)
        ) {
            return true;
        }
        lastWaveformViewportHiresSpec = spec;
        return rebuildWaveformViewportPeaksFromSpec(spec, opt);
    }

    function applyWaveformViewportHiresRedraw(opt) {
        const spec = getWaveformViewportHiresSpec();
        if (!spec) {
            clearAllWaveformViewportPeaks();
            return;
        }
        const run = () => {
            const live = getWaveformViewportHiresSpec();
            if (!live) {
                clearAllWaveformViewportPeaks();
                if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
                if (typeof redrawAllExtraTrackWaveforms === 'function') {
                    redrawAllExtraTrackWaveforms();
                }
                return;
            }
            const peaksMissing = anyExtraTracksNeedViewportPeaksRebuild(opt);
            if (
                !peaksMissing &&
                lastWaveformViewportHiresSpec &&
                waveformViewportSpecNearlyEqual(lastWaveformViewportHiresSpec, live)
            ) {
                return;
            }
            lastWaveformViewportHiresSpec = live;
            rebuildWaveformViewportPeaksFromSpec(live, opt);
            if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
            const extraSlots = extraSlotsForViewportPeaks(opt);
            for (let j = 0; j < extraSlots.length; j++) {
                const slot = extraSlots[j];
                if (typeof drawExtraTrackWaveform === 'function') {
                    drawExtraTrackWaveform(slot);
                }
            }
        };
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(run, { timeout: 4000 });
        } else {
            setTimeout(run, 0);
        }
    }

    function scheduleWaveformHiresRedrawAfterZoom(opt) {
        cancelWaveformHiresRedraw();
        waveformHiresTimer = setTimeout(() => {
            waveformHiresTimer = 0;
            applyWaveformViewportHiresRedraw(opt);
        }, WAVEFORM_HIRES_DELAY_MS);
    }

    function cancelWaveformHiresOnPlayback() {
        cancelWaveformHiresRedraw();
        clearAllWaveformViewportPeaks();
    }

    function invalidateWaveformViewportHiresSpec() {
        lastWaveformViewportHiresSpec = null;
    }

    window.cancelWaveformHiresOnPlayback = cancelWaveformHiresOnPlayback;
    window.scheduleWaveformHiresRedrawAfterZoom = scheduleWaveformHiresRedrawAfterZoom;
    window.applyWaveformViewportPeaksImmediate = applyWaveformViewportPeaksImmediate;
    window.scheduleWaveformVisualRefresh = scheduleWaveformVisualRefresh;
    window.flushWaveformVisualRefresh = flushWaveformVisualRefresh;
    window.invalidateWaveformViewportHiresSpec = invalidateWaveformViewportHiresSpec;
    window.getWaveformViewportHiresSpec = getWaveformViewportHiresSpec;

    function scheduleWaveformVisualRefreshOnScroll() {
        if (waveformHiresScrollTimer) clearTimeout(waveformHiresScrollTimer);
        waveformHiresScrollTimer = setTimeout(() => {
            waveformHiresScrollTimer = 0;
            scheduleWaveformVisualRefresh();
        }, WAVEFORM_HIRES_SCROLL_DELAY_MS);
    }

    window.scheduleWaveformVisualRefreshOnScroll = scheduleWaveformVisualRefreshOnScroll;

    function drawWaveformVisualLayers() {
        if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
        if (typeof redrawAllExtraTrackWaveforms === 'function') redrawAllExtraTrackWaveforms();
    }

    function drawWaveformChromeOverlays() {
        if (typeof updateAllWaveformPlayheads === 'function') updateAllWaveformPlayheads();
        if (typeof drawMusicalGridOverlay === 'function') drawMusicalGridOverlay();
        if (typeof renderAudioWaveformMarkers === 'function') renderAudioWaveformMarkers();
        if (typeof updateRangeLoopOverlay === 'function') updateRangeLoopOverlay();
    }

    function cancelPendingRaf(rafId) {
        if (rafId) cancelAnimationFrame(rafId);
        return 0;
    }

    /** 波形描画の直後にリージョン境界 UI を更新。sync 時は同フレーム、通常は次 rAF */
    function scheduleRegionBoundaryPresentationRefresh(opt) {
        if (typeof refreshAllRegionBoundaryPresentation !== 'function') return;
        if (opt && opt.sync) {
            regionBoundaryPresentationRaf = cancelPendingRaf(regionBoundaryPresentationRaf);
            refreshAllRegionBoundaryPresentation();
            return;
        }
        regionBoundaryPresentationRaf = cancelPendingRaf(regionBoundaryPresentationRaf);
        regionBoundaryPresentationRaf = requestAnimationFrame(() => {
            regionBoundaryPresentationRaf = 0;
            refreshAllRegionBoundaryPresentation();
        });
    }

    function flushWaveformVisualRefresh(opt) {
        if (waveformVisualRefreshRaf) {
            cancelAnimationFrame(waveformVisualRefreshRaf);
            waveformVisualRefreshRaf = 0;
        }
        syncPlaybackScrollBeforeWaveformDraw();
        const refreshed = applyWaveformViewportPeaksImmediate(opt);
        drawWaveformVisualLayers();
        drawWaveformChromeOverlays();
        if (opt && opt.sync) {
            scheduleRegionBoundaryPresentationRefresh(opt);
        }
        return refreshed;
    }

    /** 連続ズーム・リサイズ時は 1 フレームにまとめてピーク再計算＋描画 */
    function scheduleWaveformVisualRefresh(opt) {
        if (opt && opt.sync) {
            const refreshed = flushWaveformVisualRefresh(opt);
            if (!refreshed) scheduleWaveformHiresRedrawAfterZoom(opt);
            return;
        }
        if (waveformVisualRefreshRaf) return;
        waveformVisualRefreshRaf = requestAnimationFrame(() => {
            waveformVisualRefreshRaf = 0;
            const refreshed = flushWaveformVisualRefresh(opt);
            if (!refreshed) scheduleWaveformHiresRedrawAfterZoom(opt);
        });
    }

    function refreshWaveformTimelineVisualAfterZoomChange() {
        drawWaveformChromeOverlays();
        if (typeof scheduleMusicalGridRedraw === 'function') scheduleMusicalGridRedraw();
        scheduleRegionBoundaryPresentationRefresh({ sync: true });
        scheduleWaveformVisualRefresh();
    }

    window.refreshWaveformTimelineVisualAfterZoomChange =
        refreshWaveformTimelineVisualAfterZoomChange;
})();
