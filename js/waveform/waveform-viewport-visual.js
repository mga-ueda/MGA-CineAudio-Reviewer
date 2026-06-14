/**
 * waveform-viewport-visual.js — ズーム後の viewport 高解像度ピークと波形再描画。
 */
(function waveformViewportVisualModule() {

    let waveformHiresTimer = 0;
    let waveformHiresScrollTimer = 0;
    let waveformVisualRefreshRaf = 0;
    let regionBoundaryPresentationRaf = 0;
    const WAVEFORM_HIRES_DELAY_MS = 80;
    const WAVEFORM_HIRES_SCROLL_DELAY_MS = 120;
    /** 高解像度ピークを分割取得する 1 タイルの CSS 幅（小さいほど初回レスポンスが速い） */
    const WAVEFORM_VIEWPORT_TILE_CSS_PX = 128;
    /** 初回表示用: ピラミッドのみのプレビュー（同期・軽量） */
    const WAVEFORM_VIEWPORT_TILE_PREVIEW_COUNT = 3;
    /** full 品質取得を idle でまとめる並列数 */
    const WAVEFORM_VIEWPORT_TILE_IDLE_PARALLEL = 6;
    /** 見た目を保ちつつ負荷を抑える（旧 4px） */
    const WAVEFORM_HIRES_BARS_PER_PX = 3;
    const WAVEFORM_HIRES_BAR_MAX = 12288;

    let waveformViewportTileGeneration = 0;
    let waveformViewportTilePlanKeyCache = '';
    let waveformViewportTileLoadsActive = 0;
    let deferredViewportPeakCacheClearReason = '';
    let waveformViewportTileRedrawRaf = 0;
    let waveformVisualRefreshDeferDepth = 0;
    let waveformVisualRefreshPending = false;

    function isWaveformVisualRefreshDeferred() {
        return waveformVisualRefreshDeferDepth > 0;
    }

    /** スクラブ中は波形タイル取得・再描画より UI 更新を優先 */
    function isWaveformScrubPriorityActive() {
        if (isWaveformVisualRefreshDeferred()) return true;
        if (typeof isAudioWaveformScrubActive === 'function' && isAudioWaveformScrubActive()) {
            return true;
        }
        if (
            typeof isKeyboardTransportScrubActive === 'function' &&
            isKeyboardTransportScrubActive()
        ) {
            return true;
        }
        if (typeof isSeeking !== 'undefined' && isSeeking) return true;
        return false;
    }

    function prioritizeWaveformScrub(reason) {
        cancelWaveformHiresRedraw();
        if (waveformVisualRefreshRaf) {
            cancelAnimationFrame(waveformVisualRefreshRaf);
            waveformVisualRefreshRaf = 0;
        }
        if (waveformViewportTileRedrawRaf) {
            cancelAnimationFrame(waveformViewportTileRedrawRaf);
            waveformViewportTileRedrawRaf = 0;
        }
        if (regionBoundaryPresentationRaf) {
            cancelAnimationFrame(regionBoundaryPresentationRaf);
            regionBoundaryPresentationRaf = 0;
        }
        cancelWaveformViewportTileLoads(reason || 'scrub');
    }

    function beginWaveformVisualRefreshDefer() {
        prioritizeWaveformScrub('scrubDefer');
        waveformVisualRefreshDeferDepth++;
    }

    function endWaveformVisualRefreshDefer(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        waveformVisualRefreshDeferDepth = Math.max(0, waveformVisualRefreshDeferDepth - 1);
        if (waveformVisualRefreshDeferDepth > 0) return;
        if (o.cancelPending) {
            waveformVisualRefreshPending = false;
            return;
        }
        if (waveformVisualRefreshPending || o.flush) {
            waveformVisualRefreshPending = false;
            flushWaveformVisualRefresh({ sync: true, force: !!(o.force || o.flush) });
        }
    }

    function isWaveformPlaybackScrollFollowActive() {
        if (typeof isTransportPlaying !== 'function' || !isTransportPlaying()) return false;
        if (
            typeof isWaveformTimelineAtFitZoom === 'function' &&
            isWaveformTimelineAtFitZoom()
        ) {
            return false;
        }
        return true;
    }

    window.isWaveformPlaybackScrollFollowActive = isWaveformPlaybackScrollFollowActive;
    window.isWaveformVisualRefreshDeferred = isWaveformVisualRefreshDeferred;
    window.isWaveformScrubPriorityActive = isWaveformScrubPriorityActive;
    window.prioritizeWaveformScrub = prioritizeWaveformScrub;
    window.beginWaveformVisualRefreshDefer = beginWaveformVisualRefreshDefer;
    window.endWaveformVisualRefreshDefer = endWaveformVisualRefreshDefer;

    function markWaveformVisualRefreshPending() {
        waveformVisualRefreshPending = true;
    }

    function isWaveformViewportTileLoadActive() {
        return waveformViewportTileLoadsActive > 0;
    }

    function deferViewportPeakCacheClear(reason) {
        if (reason) deferredViewportPeakCacheClearReason = reason;
    }

    function flushDeferredViewportPeakCacheClear() {
        if (!deferredViewportPeakCacheClearReason) return;
        if (isWaveformViewportTileLoadActive()) return;
        const reason = deferredViewportPeakCacheClearReason;
        deferredViewportPeakCacheClearReason = '';
        if (typeof clearViewportPeakCache === 'function') {
            clearViewportPeakCache(reason, { force: true });
        }
    }

    window.isWaveformViewportTileLoadActive = isWaveformViewportTileLoadActive;
    window.deferViewportPeakCacheClear = deferViewportPeakCacheClear;

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

    function cancelWaveformViewportTileLoads(reason) {
        if (waveformViewportTileLoadsActive > 0) {
            waveformViewportTileLoadsActive = 0;
        }
        if (typeof logWaveformViewportTileCancel === 'function') {
            logWaveformViewportTileCancel(waveformViewportTileGeneration, reason);
        }
        waveformViewportTileGeneration++;
        waveformViewportTilePlanKeyCache = '';
        flushDeferredViewportPeakCacheClear();
    }

    function waveformViewportDensityScaleForZoom(zoom) {
        const z = Number(zoom);
        if (!Number.isFinite(z) || z <= 1.02) return 0.42;
        if (z <= 4.5) return 0.78;
        if (z <= 8.5) return 0.9;
        if (z <= 16.5) return 0.96;
        return 1;
    }

    function waveformViewportBarCountForCssWidth(widthCss, zoom) {
        const w = Math.max(1, widthCss | 0);
        const barsPerPx =
            WAVEFORM_HIRES_BARS_PER_PX * waveformViewportDensityScaleForZoom(zoom);
        return Math.min(
            WAVEFORM_HIRES_BAR_MAX,
            Math.max(1, Math.round(w * barsPerPx)),
        );
    }

    function buildWaveformViewportTilePlan(spec) {
        const winSpec =
            typeof getWaveformCanvasWindowSpec === 'function'
                ? getWaveformCanvasWindowSpec()
                : null;
        if (!winSpec || winSpec.mode !== 'window') return null;
        const contentW = winSpec.contentW;
        const canvasLeft = winSpec.canvasLeft;
        const scrollLeft = winSpec.scrollLeft;
        const viewportW = winSpec.viewportW;
        const master = spec.master;
        const zoom = getWaveformTimelineZoom();
        const tilePx = WAVEFORM_VIEWPORT_TILE_CSS_PX;
        const visLeft = scrollLeft;
        const visRight = Math.min(contentW, scrollLeft + viewportW);
        const tiles = [];
        if (visRight > visLeft + 0.5) {
            const tileStartAbs = Math.floor(visLeft / tilePx) * tilePx;
            for (let absLeft = tileStartAbs; absLeft < visRight; absLeft += tilePx) {
                const width = Math.min(tilePx, contentW - absLeft);
                if (width <= 0) break;
                const masterStartSec = (absLeft / contentW) * master;
                const masterEndSec = ((absLeft + width) / contentW) * master;
                tiles.push({
                    id: absLeft / tilePx,
                    px: absLeft - canvasLeft,
                    width,
                    absLeft,
                    masterStartSec,
                    masterEndSec,
                    barCount: waveformViewportBarCountForCssWidth(width, zoom),
                });
            }
        }
        tiles.sort((a, b) => a.absLeft - b.absLeft);
        return {
            master,
            contentW,
            canvasLeft,
            canvasW: winSpec.canvasW,
            scrollLeft,
            viewportW,
            tiles,
        };
    }

    function waveformViewportTilePlanKey(plan) {
        if (!plan || !plan.tiles || !plan.tiles.length) return '';
        const first = plan.tiles[0];
        const last = plan.tiles[plan.tiles.length - 1];
        return [
            plan.scrollLeft | 0,
            plan.viewportW | 0,
            plan.contentW | 0,
            first.masterStartSec.toFixed(4),
            last.masterEndSec.toFixed(4),
            getWaveformTimelineZoom(),
        ].join('|');
    }

    function initAllTrackViewportTiles(plan, opt) {
        if (typeof initMainWaveformViewportTiles === 'function') {
            initMainWaveformViewportTiles(plan);
        }
        const slots = extraSlotsForViewportPeaks(opt);
        for (let j = 0; j < slots.length; j++) {
            const slot = slots[j];
            if (typeof initExtraTrackViewportTiles === 'function') {
                initExtraTrackViewportTiles(slot, plan);
            }
        }
    }

    function applyWaveformViewportTileToAllTracks(plan, tile, applyOpt) {
        let changed = false;
        if (typeof applyMainWaveformViewportTile === 'function') {
            changed = applyMainWaveformViewportTile(tile, applyOpt) || changed;
        }
        const slots =
            typeof getVisibleLoadedExtraTrackSlots === 'function'
                ? getVisibleLoadedExtraTrackSlots()
                : [];
        for (let j = 0; j < slots.length; j++) {
            const slot = slots[j];
            if (typeof applyExtraTrackViewportTile === 'function') {
                changed =
                    applyExtraTrackViewportTile(slot, tile, plan, applyOpt) || changed;
            }
        }
        return changed;
    }

    function drawWaveformViewportTileLayersNow() {
        if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
        if (typeof redrawAllExtraTrackWaveforms === 'function') redrawAllExtraTrackWaveforms();
    }

    function scheduleWaveformViewportTileRedrawSync() {
        if (isWaveformScrubPriorityActive()) {
            markWaveformVisualRefreshPending();
            return;
        }
        if (waveformViewportTileRedrawRaf) {
            cancelAnimationFrame(waveformViewportTileRedrawRaf);
            waveformViewportTileRedrawRaf = 0;
        }
        drawWaveformViewportTileLayersNow();
    }

    /** idle バッチ間の再描画は 1 フレームにまとめる */
    function scheduleWaveformViewportTileRedraw() {
        if (isWaveformScrubPriorityActive()) {
            markWaveformVisualRefreshPending();
            return;
        }
        if (waveformViewportTileRedrawRaf) return;
        waveformViewportTileRedrawRaf = requestAnimationFrame(() => {
            waveformViewportTileRedrawRaf = 0;
            drawWaveformViewportTileLayersNow();
        });
    }

    function waveformViewportTileLacksPeaks(plan, tile, opt) {
        if (
            typeof mainWaveformViewportTileLacksPeaks === 'function' &&
            mainWaveformViewportTileLacksPeaks(tile.id)
        ) {
            return true;
        }
        const slots = extraSlotsForViewportPeaks(opt);
        for (let j = 0; j < slots.length; j++) {
            if (
                typeof extraTrackViewportTileLacksPeaks === 'function' &&
                extraTrackViewportTileLacksPeaks(slots[j], tile.id)
            ) {
                return true;
            }
        }
        return false;
    }

    function isWaveformViewportTilePending(plan, tile, opt) {
        if (!plan || !tile) return false;
        if (
            typeof mainWaveformViewportTilePending === 'function' &&
            mainWaveformViewportTilePending(tile.id)
        ) {
            return true;
        }
        const slots = extraSlotsForViewportPeaks(opt);
        for (let j = 0; j < slots.length; j++) {
            if (
                typeof extraTrackViewportTilePending === 'function' &&
                extraTrackViewportTilePending(slots[j], tile.id)
            ) {
                return true;
            }
        }
        return false;
    }

    function hydrateWaveformViewportTilesFromCache(plan, opt) {
        if (!plan || !plan.tiles || !plan.tiles.length) return false;
        let changed = false;
        let hit = 0;
        let partial = 0;
        let miss = 0;
        const cacheOpt = { cacheOnly: true };
        for (let i = 0; i < plan.tiles.length; i++) {
            const tile = plan.tiles[i];
            if (!isWaveformViewportTilePending(plan, tile, opt)) continue;
            const didChange = applyWaveformViewportTileToAllTracks(plan, tile, cacheOpt);
            const stillPending = isWaveformViewportTilePending(plan, tile, opt);
            if (didChange && !stillPending) {
                changed = true;
                hit++;
                if (typeof logWaveformViewportTileLoad === 'function') {
                    logWaveformViewportTileLoad('hydrateHit', tile, { ok: true });
                }
            } else if (didChange && stillPending) {
                changed = true;
                partial++;
                if (typeof logWaveformViewportTileLoad === 'function') {
                    logWaveformViewportTileLoad('hydratePartial', tile, { ok: true });
                }
            } else {
                miss++;
                if (typeof logWaveformViewportTileLoad === 'function') {
                    logWaveformViewportTileLoad('hydrateMiss', tile, { ok: false });
                }
            }
        }
        if (typeof logWaveformViewportTileSchedule === 'function' && (hit || partial || miss)) {
            logWaveformViewportTileSchedule({ phase: 'hydrate', hit, partial, miss });
        }
        return changed;
    }

    function queueWaveformViewportTileLoads(plan, opt, queue, gen) {
        if (!queue || !queue.length) return;
        const tileOpt = { peakPass: 'full' };
        waveformViewportTileLoadsActive += queue.length;
        if (typeof logWaveformViewportTileSchedule === 'function') {
            logWaveformViewportTileSchedule({
                phase: 'idleQueue',
                gen,
                count: queue.length,
                parallel: WAVEFORM_VIEWPORT_TILE_IDLE_PARALLEL,
                tileIds: queue.map((t) => t.id),
            });
        }
        let qi = 0;
        const finishOne = () => {
            waveformViewportTileLoadsActive = Math.max(0, waveformViewportTileLoadsActive - 1);
            flushDeferredViewportPeakCacheClear();
        };
        const loadNext = () => {
            if (gen !== waveformViewportTileGeneration) return;
            if (qi >= queue.length) {
                flushDeferredViewportPeakCacheClear();
                return;
            }
            const batch = [];
            while (
                batch.length < WAVEFORM_VIEWPORT_TILE_IDLE_PARALLEL &&
                qi < queue.length
            ) {
                const tile = queue[qi++];
                batch.push(tile);
                if (typeof logWaveformViewportTileLoad === 'function') {
                    logWaveformViewportTileLoad('idleStart', tile, {
                        gen,
                        index: qi,
                        remaining: queue.length - qi,
                        batch: batch.length,
                    });
                }
            }
            const run = () => {
                if (gen !== waveformViewportTileGeneration) {
                    waveformViewportTileLoadsActive = Math.max(
                        0,
                        waveformViewportTileLoadsActive - batch.length,
                    );
                    return;
                }
                if (
                    typeof isWaveformScrubPriorityActive === 'function' &&
                    isWaveformScrubPriorityActive()
                ) {
                    waveformViewportTileLoadsActive = Math.max(
                        0,
                        waveformViewportTileLoadsActive - batch.length,
                    );
                    return;
                }
                let okAny = false;
                for (let b = 0; b < batch.length; b++) {
                    const tile = batch[b];
                    const ok = applyWaveformViewportTileToAllTracks(plan, tile, tileOpt);
                    if (typeof logWaveformViewportTileLoad === 'function') {
                        logWaveformViewportTileLoad('idleDone', tile, { gen, ok: !!ok });
                    }
                    if (ok) okAny = true;
                    finishOne();
                }
                if (okAny) scheduleWaveformViewportTileRedraw();
                loadNext();
            };
            setTimeout(run, 0);
        };
        loadNext();
    }

    function loadImmediateWaveformViewportTiles(plan, opt, queue, applyOpt) {
        if (!queue || !queue.length) return;
        if (isWaveformScrubPriorityActive()) return;
        const previewQueue = queue.filter((tile) =>
            waveformViewportTileLacksPeaks(plan, tile, opt),
        );
        if (!previewQueue.length) return;
        const n = Math.min(WAVEFORM_VIEWPORT_TILE_PREVIEW_COUNT, previewQueue.length);
        const tileOpt = Object.assign({ peakPass: 'preview' }, applyOpt || {});
        const gen = waveformViewportTileGeneration;
        waveformViewportTileLoadsActive += n;
        let okAny = false;
        for (let i = 0; i < n; i++) {
            if (gen !== waveformViewportTileGeneration) {
                waveformViewportTileLoadsActive = Math.max(
                    0,
                    waveformViewportTileLoadsActive - (n - i),
                );
                return;
            }
            const tile = previewQueue[i];
            if (typeof logWaveformViewportTileLoad === 'function') {
                logWaveformViewportTileLoad('immediateStart', tile, { index: i + 1, of: n });
            }
            const ok = applyWaveformViewportTileToAllTracks(plan, tile, tileOpt);
            if (typeof logWaveformViewportTileLoad === 'function') {
                logWaveformViewportTileLoad('immediateDone', tile, { ok: !!ok, index: i + 1, of: n });
            }
            if (ok) okAny = true;
            waveformViewportTileLoadsActive = Math.max(0, waveformViewportTileLoadsActive - 1);
        }
        flushDeferredViewportPeakCacheClear();
        if (okAny) scheduleWaveformViewportTileRedrawSync();
    }

    function pendingWaveformViewportTiles(plan, opt) {
        return plan.tiles.filter((tile) => isWaveformViewportTilePending(plan, tile, opt));
    }

    function scheduleWaveformViewportTileLoads(plan, opt) {
        if (!plan || !plan.tiles || !plan.tiles.length) return;
        if (isWaveformScrubPriorityActive()) {
            markWaveformVisualRefreshPending();
            return;
        }
        const planKey = waveformViewportTilePlanKey(plan);

        if (planKey && planKey === waveformViewportTilePlanKeyCache) {
            let queue = pendingWaveformViewportTiles(plan, opt);
            if (!queue.length) {
                if (typeof logWaveformViewportTileSchedule === 'function') {
                    logWaveformViewportTileSchedule({
                        phase: 'skip',
                        planKey,
                        reason: 'allLoaded',
                    });
                }
                return;
            }
            const gen = waveformViewportTileGeneration;
            if (typeof logWaveformViewportTileSchedule === 'function') {
                logWaveformViewportTilePlan(plan, {
                    tilePx: WAVEFORM_VIEWPORT_TILE_CSS_PX,
                    planKey,
                    mode: 'resume',
                    pending: queue.length,
                    gen,
                });
            }
            loadImmediateWaveformViewportTiles(plan, opt, queue);
            queue = pendingWaveformViewportTiles(plan, opt);
            queueWaveformViewportTileLoads(plan, opt, queue, gen);
            return;
        }

        cancelWaveformViewportTileLoads('planChange');
        waveformViewportTilePlanKeyCache = planKey;
        const gen = waveformViewportTileGeneration;
        if (typeof logWaveformViewportTilePlan === 'function') {
            logWaveformViewportTilePlan(plan, {
                tilePx: WAVEFORM_VIEWPORT_TILE_CSS_PX,
                planKey,
                mode: 'new',
                gen,
            });
        }
        initAllTrackViewportTiles(plan, opt);
        hydrateWaveformViewportTilesFromCache(plan, opt);
        scheduleWaveformViewportTileRedrawSync();

        let queue = pendingWaveformViewportTiles(plan, opt);
        if (!queue.length) {
            if (typeof logWaveformViewportTileSchedule === 'function') {
                logWaveformViewportTileSchedule({
                    phase: 'complete',
                    planKey,
                    gen,
                    reason: 'allCachedOrMerged',
                });
            }
            return;
        }
        if (typeof logWaveformViewportTileSchedule === 'function') {
            logWaveformViewportTileSchedule({
                phase: 'pending',
                planKey,
                gen,
                count: queue.length,
            });
        }
        loadImmediateWaveformViewportTiles(plan, opt, queue);
        queue = pendingWaveformViewportTiles(plan, opt);
        queueWaveformViewportTileLoads(plan, opt, queue, gen);
    }

    function shouldUseWaveformViewportTiles(spec) {
        const winSpec =
            typeof getWaveformCanvasWindowSpec === 'function'
                ? getWaveformCanvasWindowSpec()
                : null;
        return !!(winSpec && winSpec.mode === 'window' && spec);
    }

    function clearAllWaveformViewportPeaks() {
        cancelWaveformViewportTileLoads('clearAllViewportPeaks');
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
        const winSpec =
            typeof getWaveformCanvasWindowSpec === 'function'
                ? getWaveformCanvasWindowSpec()
                : null;
        let rangeStartPx = scrollLeft;
        let rangeEndPx = scrollLeft + visW;
        let barLayoutW = visW;
        let canvasLeft = scrollLeft;
        if (winSpec && winSpec.mode === 'window') {
            rangeStartPx = winSpec.canvasLeft;
            rangeEndPx = winSpec.canvasLeft + winSpec.canvasW;
            barLayoutW = winSpec.canvasW;
            canvasLeft = winSpec.canvasLeft;
        }
        const masterStartSec = (rangeStartPx / contentW) * master;
        const masterEndSec = (rangeEndPx / contentW) * master;
        const zoom = getWaveformTimelineZoom();
        const barsPerPx = WAVEFORM_HIRES_BARS_PER_PX * waveformViewportDensityScaleForZoom(zoom);
        const barCount = Math.min(
            WAVEFORM_HIRES_BAR_MAX,
            Math.max(1, Math.round(barLayoutW * barsPerPx)),
        );
        return {
            masterStartSec,
            masterEndSec,
            barCount,
            master,
            canvasLeft,
            viewportW: visW,
            bufferW: barLayoutW,
        };
    }

    function waveformViewportSpecNearlyEqual(prev, live) {
        if (!prev || !live) return false;
        const dt0 = Math.abs(prev.masterStartSec - live.masterStartSec);
        const dt1 = Math.abs(prev.masterEndSec - live.masterEndSec);
        const db = Math.abs(prev.barCount - live.barCount);
        const timeThresh = live.master / 200;
        if (dt0 >= timeThresh || dt1 >= timeThresh || db > 12) return false;
        if (Number.isFinite(prev.canvasLeft) && Number.isFinite(live.canvasLeft)) {
            const shiftThresh = Math.max(24, (live.viewportW || 0) * 0.2);
            if (Math.abs(prev.canvasLeft - live.canvasLeft) > shiftThresh) return false;
        }
        return true;
    }

    /** 再生中は viewport peaks 描画前に scroll を transport に合わせる */
    function syncPlaybackScrollBeforeWaveformDraw() {
        if (typeof isTransportPlaying !== 'function' || !isTransportPlaying()) return;
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
        const currentScroll = lanes.scrollLeft || 0;
        const next =
            typeof scrollLeftForTransportSec === 'function'
                ? scrollLeftForTransportSec(scrubW, vw, currentScroll)
                : typeof scrollLeftToCenterTransportSec === 'function'
                  ? scrollLeftToCenterTransportSec(scrubW, vw)
                  : null;
        if (next == null || !Number.isFinite(next)) return;
        if (Math.abs(currentScroll - next) > 0.01) {
            if (typeof setWaveformTimelineScrollLeft === 'function') {
                setWaveformTimelineScrollLeft(lanes, next);
            } else {
                lanes.scrollLeft = next;
            }
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
        if (vp && vp.tiles && vp.tiles.length) {
            for (let i = 0; i < vp.tiles.length; i++) {
                const tile = vp.tiles[i];
                if (tile.peaks && tile.peaks.length) return false;
                if (tile.segments && tile.segments.length) return false;
            }
            return true;
        }
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

    function mainTrackNeedsViewportPeaksRebuild() {
        if (typeof mainWaveformViewportTilesPending === 'function') {
            return mainWaveformViewportTilesPending();
        }
        return true;
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
        if (shouldUseWaveformViewportTiles(spec)) {
            const plan = buildWaveformViewportTilePlan(spec);
            if (plan) {
                scheduleWaveformViewportTileLoads(plan, opt);
                return true;
            }
        }
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

    /** ズーム・リサイズ直後: overview を即描画し、高解像度はタイル単位で非同期取得 */
    function applyWaveformViewportPeaksImmediate(opt) {
        if (isWaveformScrubPriorityActive() && !(opt && opt.force)) {
            markWaveformVisualRefreshPending();
            return false;
        }
        const spec = getWaveformViewportHiresSpec();
        if (!spec) return false;
        if (shouldUseWaveformViewportTiles(spec)) {
            const plan = buildWaveformViewportTilePlan(spec);
            if (!plan) return false;
            lastWaveformViewportHiresSpec = spec;
            scheduleWaveformViewportTileLoads(plan, opt);
            return true;
        }
        if (
            typeof mainWaveformViewportPeaksHasTiles === 'function' &&
            mainWaveformViewportPeaksHasTiles()
        ) {
            if (typeof clearMainWaveformViewportPeaks === 'function') {
                clearMainWaveformViewportPeaks();
            }
            if (typeof clearAllExtraWaveformViewportPeaks === 'function') {
                clearAllExtraWaveformViewportPeaks();
            }
            lastWaveformViewportHiresSpec = null;
        }
        const peaksMissing =
            mainTrackNeedsViewportPeaksRebuild() ||
            anyExtraTracksNeedViewportPeaksRebuild(opt);
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
                scheduleWaveformViewportTileRedraw();
                return;
            }
            if (shouldUseWaveformViewportTiles(live)) {
                const plan = buildWaveformViewportTilePlan(live);
                if (plan) {
                    lastWaveformViewportHiresSpec = live;
                    scheduleWaveformViewportTileLoads(plan, opt);
                }
                return;
            }
            const peaksMissing =
                mainTrackNeedsViewportPeaksRebuild() ||
                anyExtraTracksNeedViewportPeaksRebuild(opt);
            if (
                !peaksMissing &&
                lastWaveformViewportHiresSpec &&
                waveformViewportSpecNearlyEqual(lastWaveformViewportHiresSpec, live)
            ) {
                return;
            }
            lastWaveformViewportHiresSpec = live;
            rebuildWaveformViewportPeaksFromSpec(live, opt);
            scheduleWaveformViewportTileRedraw();
        };
        setTimeout(run, 0);
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
        cancelWaveformViewportTileLoads('playback');
        if (typeof clearMainWaveformViewportPeaks === 'function') {
            clearMainWaveformViewportPeaks();
        }
        if (typeof clearAllExtraWaveformViewportPeaks === 'function') {
            clearAllExtraWaveformViewportPeaks();
        }
    }

    function invalidateWaveformViewportHiresSpec() {
        lastWaveformViewportHiresSpec = null;
        cancelWaveformViewportTileLoads('hiresSpec');
        if (typeof logWaveformViewportInvalidate === 'function') {
            logWaveformViewportInvalidate('hiresSpec', null);
        }
    }

    /** リージョン編集後: ピーク計算キャッシュとタイル plan を破棄し再取得させる */
    function invalidateWaveformViewportPeaksForRegionEdit(opt) {
        if (typeof clearViewportPeakCache === 'function') {
            clearViewportPeakCache('regionEdit', { force: true });
        }
        lastWaveformViewportHiresSpec = null;
        cancelWaveformViewportTileLoads('regionEdit');
        if (typeof logWaveformViewportInvalidate === 'function') {
            logWaveformViewportInvalidate('regionEdit', opt || null);
        }
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.clearTrackTiles !== false) {
            if (typeof o.slot === 'number' && o.slot >= 0) {
                const tr =
                    typeof extraTrackBySlot === 'function'
                        ? extraTrackBySlot(o.slot)
                        : null;
                if (tr) tr.viewportPeaks = null;
            } else {
                if (typeof clearAllExtraWaveformViewportPeaks === 'function') {
                    clearAllExtraWaveformViewportPeaks();
                }
                if (typeof clearMainWaveformViewportPeaks === 'function') {
                    clearMainWaveformViewportPeaks();
                }
            }
        }
    }

    function onWaveformTimelineFitZoomRestored() {
        cancelWaveformViewportTileLoads('fitZoom');
        if (typeof logWaveformViewportInvalidate === 'function') {
            logWaveformViewportInvalidate('fitZoom', null);
        }
        lastWaveformViewportHiresSpec = null;
        if (typeof clearMainWaveformViewportPeaks === 'function') {
            clearMainWaveformViewportPeaks();
        }
        if (typeof clearAllExtraWaveformViewportPeaks === 'function') {
            clearAllExtraWaveformViewportPeaks();
        }
        if (typeof rebuildMainWaveformOverviewPeaksIfNeeded === 'function') {
            rebuildMainWaveformOverviewPeaksIfNeeded();
        }
        if (typeof getVisibleLoadedExtraTrackSlots === 'function') {
            const slots = getVisibleLoadedExtraTrackSlots();
            for (let i = 0; i < slots.length; i++) {
                const slot = slots[i];
                if (typeof rebuildExtraTrackPeaksIfNeeded === 'function') {
                    rebuildExtraTrackPeaksIfNeeded(slot);
                }
            }
        }
    }

    /** スクラブ中: viewportPeakCache からタイル復元のみ（pyramid preview は後段） */
    function hydrateWaveformViewportCacheForScrub() {
        const spec = getWaveformViewportHiresSpec();
        if (!spec) return 'none';
        if (!shouldUseWaveformViewportTiles(spec)) return 'full';
        const plan = buildWaveformViewportTilePlan(spec);
        if (!plan || !plan.tiles || !plan.tiles.length) return 'none';
        const planKey = waveformViewportTilePlanKey(plan);
        const planUnchanged = !!(planKey && planKey === waveformViewportTilePlanKeyCache);
        const pending = pendingWaveformViewportTiles(plan);
        if (planUnchanged && !pending.length) {
            return waveformViewportScrubWindowCoverage();
        }
        if (!planUnchanged) {
            initAllTrackViewportTiles(plan);
        }
        hydrateWaveformViewportTilesFromCache(plan);
        return waveformViewportScrubWindowCoverage();
    }

    function isWaveformViewportTileDrawable(plan, tile, opt) {
        if (!plan || !tile) return false;
        if (
            typeof mainWaveformViewportTileLacksPeaks === 'function' &&
            mainWaveformViewportTileLacksPeaks(tile.id)
        ) {
            return false;
        }
        const slots = extraSlotsForViewportPeaks(opt);
        for (let j = 0; j < slots.length; j++) {
            const slot = slots[j];
            if (
                typeof extraTrackViewportTileLacksPeaks === 'function' &&
                extraTrackViewportTileLacksPeaks(slot, tile.id)
            ) {
                return false;
            }
        }
        return true;
    }

    function waveformViewportScrubWindowDrawableCoverage(opt) {
        const spec = getWaveformViewportHiresSpec();
        if (!spec) return 'none';
        if (!shouldUseWaveformViewportTiles(spec)) return 'full';
        const plan = buildWaveformViewportTilePlan(spec);
        if (!plan || !plan.tiles || !plan.tiles.length) return 'none';
        let drawable = 0;
        for (let i = 0; i < plan.tiles.length; i++) {
            if (isWaveformViewportTileDrawable(plan, plan.tiles[i], opt)) {
                drawable++;
            }
        }
        if (drawable === 0) return 'none';
        if (drawable >= plan.tiles.length) return 'full';
        return 'partial';
    }

    /** 表示窓・タイルが揃っており、プレイヘッド移動だけなら波形再取得不要 */
    function isWaveformViewportDisplayCurrent(opt) {
        const spec = getWaveformViewportHiresSpec();
        if (!spec) return false;
        if (!shouldUseWaveformViewportTiles(spec)) {
            return !!(
                lastWaveformViewportHiresSpec &&
                waveformViewportSpecNearlyEqual(lastWaveformViewportHiresSpec, spec)
            );
        }
        const plan = buildWaveformViewportTilePlan(spec);
        if (!plan || !plan.tiles || !plan.tiles.length) return false;
        const planKey = waveformViewportTilePlanKey(plan);
        if (!planKey || planKey !== waveformViewportTilePlanKeyCache) return false;
        return waveformViewportScrubWindowDrawableCoverage(opt) === 'full';
    }

    function refreshWaveformChromeIfViewportCurrent(opt) {
        if (!isWaveformViewportDisplayCurrent(opt)) return false;
        drawWaveformChromeOverlays();
        return true;
    }

    /** キャッシュ未ヒット分に pyramid preview（中解像度）を同期生成 */
    function applyScrubPreviewWaveformViewportTiles() {
        const spec = getWaveformViewportHiresSpec();
        if (!spec || !shouldUseWaveformViewportTiles(spec)) return false;
        const plan = buildWaveformViewportTilePlan(spec);
        if (!plan || !plan.tiles || !plan.tiles.length) return false;
        let changed = false;
        const pending = pendingWaveformViewportTiles(plan);
        if (!pending.length) return false;
        const previewOpt = { peakPass: 'preview', scrubPreview: true };
        const n = Math.min(
            pending.length,
            Math.max(WAVEFORM_VIEWPORT_TILE_PREVIEW_COUNT, 12),
        );
        for (let i = 0; i < n; i++) {
            if (applyWaveformViewportTileToAllTracks(plan, pending[i], previewOpt)) {
                changed = true;
            }
        }
        return changed;
    }

    /** 表示窓タイルのキャッシュ充足度: none / partial / full */
    function waveformViewportScrubWindowCoverage(opt) {
        const spec = getWaveformViewportHiresSpec();
        if (!spec) return 'none';
        if (!shouldUseWaveformViewportTiles(spec)) return 'full';
        const plan = buildWaveformViewportTilePlan(spec);
        if (!plan || !plan.tiles || !plan.tiles.length) return 'none';
        let withPeaks = 0;
        for (let i = 0; i < plan.tiles.length; i++) {
            if (!isWaveformViewportTilePending(plan, plan.tiles[i], opt)) {
                withPeaks++;
            }
        }
        if (withPeaks === 0) return 'none';
        if (withPeaks >= plan.tiles.length) return 'full';
        return 'partial';
    }

    /** 現在の Canvas 窓で描ける viewport タイル（preview/full）があるか */
    function waveformViewportHasScrubDrawablePeaks(opt) {
        return waveformViewportScrubWindowCoverage(opt) !== 'none';
    }

    window.onWaveformTimelineFitZoomRestored = onWaveformTimelineFitZoomRestored;
    window.scheduleWaveformHiresRedrawAfterZoom = scheduleWaveformHiresRedrawAfterZoom;
    window.applyWaveformViewportPeaksImmediate = applyWaveformViewportPeaksImmediate;
    window.scheduleWaveformVisualRefresh = scheduleWaveformVisualRefresh;
    window.flushWaveformVisualRefresh = flushWaveformVisualRefresh;
    window.invalidateWaveformViewportHiresSpec = invalidateWaveformViewportHiresSpec;
    window.invalidateWaveformViewportPeaksForRegionEdit =
        invalidateWaveformViewportPeaksForRegionEdit;
    window.getWaveformViewportHiresSpec = getWaveformViewportHiresSpec;
    window.hydrateWaveformViewportCacheForScrub = hydrateWaveformViewportCacheForScrub;
    window.applyScrubPreviewWaveformViewportTiles = applyScrubPreviewWaveformViewportTiles;
    window.waveformViewportScrubWindowCoverage = waveformViewportScrubWindowCoverage;
    window.waveformViewportHasScrubDrawablePeaks = waveformViewportHasScrubDrawablePeaks;

    function scheduleWaveformVisualRefreshOnScroll(opt) {
        if (isWaveformVisualRefreshDeferred()) {
            markWaveformVisualRefreshPending();
            return;
        }
        if (waveformHiresScrollTimer) clearTimeout(waveformHiresScrollTimer);
        const o = opt && typeof opt === 'object' ? opt : {};
        waveformHiresScrollTimer = setTimeout(() => {
            waveformHiresScrollTimer = 0;
            const playbackScroll =
                !!o.playbackScroll ||
                (typeof isTransportPlaying === 'function' && isTransportPlaying());
            scheduleWaveformVisualRefresh(
                playbackScroll ? { playbackScroll: true } : undefined,
            );
        }, WAVEFORM_HIRES_SCROLL_DELAY_MS);
    }

    window.scheduleWaveformVisualRefreshOnScroll = scheduleWaveformVisualRefreshOnScroll;

    function drawWaveformVisualLayers() {
        if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
        if (typeof redrawAllExtraTrackWaveforms === 'function') redrawAllExtraTrackWaveforms();
    }

    function drawWaveformChromeOverlays() {
        const transportUiOwnsPlayhead =
            typeof isTransportUiRafActive === 'function' && isTransportUiRafActive();
        if (!transportUiOwnsPlayhead && typeof updateAllWaveformPlayheads === 'function') {
            updateAllWaveformPlayheads();
        }
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

    function flushWaveformVisualRefreshForPlaybackScroll(opt) {
        if (waveformVisualRefreshRaf) {
            cancelAnimationFrame(waveformVisualRefreshRaf);
            waveformVisualRefreshRaf = 0;
        }
        if (
            !(opt && opt.forceViewportRefresh) &&
            refreshWaveformChromeIfViewportCurrent(opt)
        ) {
            return true;
        }
        let drew = false;
        if (typeof tryDrawWaveformScrubOverviewIfNeeded === 'function') {
            drew = !!tryDrawWaveformScrubOverviewIfNeeded();
        }
        if (!drew) {
            const coverage =
                typeof hydrateWaveformViewportCacheForScrub === 'function'
                    ? hydrateWaveformViewportCacheForScrub()
                    : 'none';
            if (coverage === 'partial') {
                if (typeof applyScrubPreviewWaveformViewportTiles === 'function') {
                    applyScrubPreviewWaveformViewportTiles();
                }
            }
            if (coverage !== 'none') {
                drawWaveformVisualLayers();
                drew = true;
            }
        }
        if (
            typeof scheduleWaveformHiresRedrawAfterZoom === 'function' &&
            !(opt && opt.forceViewportRefresh) &&
            typeof isWaveformViewportDisplayCurrent === 'function' &&
            isWaveformViewportDisplayCurrent(opt)
        ) {
            return drew;
        }
        if (typeof scheduleWaveformHiresRedrawAfterZoom === 'function') {
            scheduleWaveformHiresRedrawAfterZoom(opt);
        }
        return drew;
    }

    function flushWaveformVisualRefresh(opt) {
        if (isWaveformScrubPriorityActive() && !(opt && opt.force)) {
            markWaveformVisualRefreshPending();
            return false;
        }
        if (opt && opt.playbackScroll) {
            return flushWaveformVisualRefreshForPlaybackScroll(opt);
        }
        if (waveformVisualRefreshRaf) {
            cancelAnimationFrame(waveformVisualRefreshRaf);
            waveformVisualRefreshRaf = 0;
        }
        syncPlaybackScrollBeforeWaveformDraw();
        applyWaveformViewportPeaksImmediate(opt);
        drawWaveformVisualLayers();
        drawWaveformChromeOverlays();
        if (opt && opt.sync) {
            scheduleRegionBoundaryPresentationRefresh(opt);
        }
        if (
            typeof scheduleWaveformHiresRedrawAfterZoom === 'function' &&
            typeof isWaveformViewportDisplayCurrent === 'function' &&
            !isWaveformViewportDisplayCurrent(opt)
        ) {
            scheduleWaveformHiresRedrawAfterZoom(opt);
        }
        return true;
    }

    /** 連続ズーム・リサイズ時は 1 フレームにまとめて overview 描画＋タイル取得を開始 */
    function scheduleWaveformVisualRefresh(opt) {
        if (isWaveformScrubPriorityActive() && !(opt && opt.force)) {
            markWaveformVisualRefreshPending();
            return;
        }
        if (opt && opt.sync) {
            flushWaveformVisualRefresh(opt);
            return;
        }
        if (waveformVisualRefreshRaf) return;
        const runFlush = () => {
            waveformVisualRefreshRaf = 0;
            flushWaveformVisualRefresh(opt);
        };
        if (typeof scheduleWorkAfterTransportUiFrame === 'function') {
            waveformVisualRefreshRaf = scheduleWorkAfterTransportUiFrame(runFlush);
        } else {
            waveformVisualRefreshRaf = requestAnimationFrame(runFlush);
        }
    }

    function refreshWaveformTimelineVisualAfterZoomChange() {
        drawWaveformChromeOverlays();
        if (typeof scheduleMusicalGridRedraw === 'function') scheduleMusicalGridRedraw();
        scheduleRegionBoundaryPresentationRefresh({ sync: true });
        if (typeof syncAllRehearsalMarksOverlayPlacement === 'function') {
            syncAllRehearsalMarksOverlayPlacement();
        }
        scheduleWaveformVisualRefresh({ sync: true });
    }

    window.refreshWaveformTimelineVisualAfterZoomChange =
        refreshWaveformTimelineVisualAfterZoomChange;
    window.isWaveformViewportDisplayCurrent = isWaveformViewportDisplayCurrent;
    window.refreshWaveformChromeIfViewportCurrent = refreshWaveformChromeIfViewportCurrent;
    window.drawWaveformChromeOverlays = drawWaveformChromeOverlays;
})();
