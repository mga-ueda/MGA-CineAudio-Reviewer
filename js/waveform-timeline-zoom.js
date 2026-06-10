/**
 * waveform-timeline-zoom.js — 波形タイムライン 1×/4×/8×/16×/32× ズーム・横スクロール・レイアウト。
 */
(function waveformTimelineZoomModule() {
    /** 波形全体がビューポートに収まる倍率 */
    const WAVEFORM_TIMELINE_ZOOM_FIT = 1;
    const WAVEFORM_TIMELINE_ZOOM_MAX = 32;
    const WAVEFORM_TIMELINE_ZOOM_LEVELS = Object.freeze([1, 4, 8, 16, 32]);
    /** MARKERS の In/Out TC 編集（+/-）中の波形倍率 */
    const MARKER_TC_EDIT_WAVEFORM_ZOOM = WAVEFORM_TIMELINE_ZOOM_MAX;
    /** 波形の縦方向表示倍率（振幅スケール） */
    const WAVEFORM_VERTICAL_ZOOM_LEVELS = Object.freeze([1, 2, 4, 8, 16]);
    let waveformTimelineZoom = 1;
    let waveformVerticalZoom = 1;
    let markerTcEditWaveformZoomActive = false;
    /** マーカー TC 編集時のみ有効。通常再生・シークでは左端追従 */
    let waveformTimelineCenterLockActive = false;

    /** ブラウザ canvas backing store の実効上限（device px） */
    const WAVEFORM_CANVAS_BACKING_MAX_PX = 32767;

    /** layoutW を CSS 座標のまま保ち、backing だけ上限内に収める */
    function getWaveformCanvasBackingWidthCss(layoutW, dpr) {
        const lw = Math.max(1, layoutW | 0);
        const d = Math.min(Math.max(dpr || 1, 1), 2);
        const browserCap = Math.max(1, Math.floor(WAVEFORM_CANVAS_BACKING_MAX_PX / d));
        return Math.min(lw, browserCap);
    }

    function applyWaveformCanvasContextTransform(ctx, layoutW, backingW, dpr) {
        if (!ctx) return;
        const lw = Math.max(1, layoutW | 0);
        const bw = Math.max(1, backingW | 0);
        const d = Math.min(Math.max(dpr || 1, 1), 2);
        if (bw < lw) {
            const scaleX = (d * bw) / lw;
            ctx.setTransform(scaleX, 0, 0, d, 0, 0);
        } else {
            ctx.setTransform(d, 0, 0, d, 0, 0);
        }
    }

    /** 可視幅の前後に同量の余白 → 合計 3× ビューポート幅の描画バッファ */
    const WAVEFORM_CANVAS_WINDOW_SIDE_FACTOR = 1;
    let waveformCanvasWindowLeftCache = null;
    let waveformCanvasWindowWCache = 0;
    let waveformCanvasWindowContentWCache = 0;
    let waveformCanvasWindowViewportWCache = 0;
    let waveformCanvasWindowZoomCache = 1;
    let lanesScrollTrailRaf = 0;
    let waveformTimelineProgrammaticScroll = false;

    function setWaveformTimelineScrollLeft(lanes, scrollLeft, opt) {
        if (!lanes) return;
        const force = !!(opt && opt.force);
        if (!force && Math.abs((lanes.scrollLeft || 0) - scrollLeft) <= 0.5) return;
        waveformTimelineProgrammaticScroll = true;
        try {
            if (typeof lanes.scrollTo === 'function') {
                lanes.scrollTo({ left: scrollLeft, top: 0, behavior: 'instant' });
            } else {
                lanes.scrollLeft = scrollLeft;
            }
        } finally {
            waveformTimelineProgrammaticScroll = false;
        }
    }

    function isWaveformTimelineProgrammaticScroll() {
        return waveformTimelineProgrammaticScroll;
    }

    function isWaveformLanesScrollVisualDeferActive() {
        if (typeof isWaveformVisualRefreshDeferred === 'function' && isWaveformVisualRefreshDeferred()) {
            return true;
        }
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

    function scheduleSeekPlaybackTrailOnLanesScroll() {
        if (isWaveformLanesScrollVisualDeferActive()) return;
        if (lanesScrollTrailRaf) return;
        lanesScrollTrailRaf = requestAnimationFrame(() => {
            lanesScrollTrailRaf = 0;
            if (isWaveformLanesScrollVisualDeferActive()) return;
            if (typeof drawSeekPlaybackTrail === 'function') drawSeekPlaybackTrail();
        });
    }

    function invalidateWaveformCanvasWindowCache() {
        waveformCanvasWindowLeftCache = null;
        waveformCanvasWindowWCache = 0;
        waveformCanvasWindowContentWCache = 0;
        waveformCanvasWindowViewportWCache = 0;
        waveformCanvasWindowZoomCache = 1;
    }

    function clampWaveformCanvasWindowLeft(left, contentW, windowW) {
        return Math.max(0, Math.min(left, Math.max(0, contentW - windowW)));
    }

    function resolveWaveformCanvasWindowLeft(scrollLeft, viewportW, contentW, windowW) {
        const side = viewportW * WAVEFORM_CANVAS_WINDOW_SIDE_FACTOR;
        const idealLeft = scrollLeft - side;
        const clampLeft = (v) => clampWaveformCanvasWindowLeft(v, contentW, windowW);
        const zoom = waveformTimelineZoom;
        if (
            waveformCanvasWindowLeftCache == null ||
            waveformCanvasWindowWCache !== windowW ||
            waveformCanvasWindowContentWCache !== contentW ||
            waveformCanvasWindowViewportWCache !== viewportW ||
            Math.abs(waveformCanvasWindowZoomCache - zoom) > 0.001
        ) {
            waveformCanvasWindowLeftCache = clampLeft(idealLeft);
            waveformCanvasWindowWCache = windowW;
            waveformCanvasWindowContentWCache = contentW;
            waveformCanvasWindowViewportWCache = viewportW;
            waveformCanvasWindowZoomCache = zoom;
            return waveformCanvasWindowLeftCache;
        }
        const bufLeft = waveformCanvasWindowLeftCache;
        const bufRight = bufLeft + windowW;
        const visLeft = scrollLeft;
        const visRight = scrollLeft + viewportW;
        const margin = Math.max(32, viewportW * 0.25);
        if (visLeft < bufLeft + margin || visRight > bufRight - margin) {
            waveformCanvasWindowLeftCache = clampLeft(idealLeft);
        }
        return waveformCanvasWindowLeftCache;
    }

    /** 拡大時: 可視+前後バッファの Canvas 窓。1× 時は従来どおり全幅 */
    function getWaveformCanvasWindowSpec() {
        const lanes = waveformScrubTargetEl();
        if (!lanes) return null;
        const m = waveformTimelineMetrics(lanes);
        if (!m || !(m.viewportW > 0)) return null;
        const contentW = Math.max(1, m.scrubW | 0);
        const viewportW = Math.max(1, m.viewportW | 0);
        const scrollLeft = m.scrollable ? lanes.scrollLeft || 0 : 0;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const useWindow = !isWaveformTimelineAtFitZoom() && contentW > viewportW + 0.5;
        if (!useWindow) {
            return {
                mode: 'full',
                contentW,
                viewportW,
                scrollLeft,
                canvasW: contentW,
                canvasLeft: 0,
                dpr,
            };
        }
        const idealWindowW = viewportW * (1 + 2 * WAVEFORM_CANVAS_WINDOW_SIDE_FACTOR);
        const maxCanvasCss = getWaveformCanvasBackingWidthCss(idealWindowW, dpr);
        const windowW = Math.max(viewportW, Math.min(contentW, idealWindowW, maxCanvasCss));
        const canvasLeft = resolveWaveformCanvasWindowLeft(
            scrollLeft,
            viewportW,
            contentW,
            windowW,
        );
        return {
            mode: 'window',
            contentW,
            viewportW,
            scrollLeft,
            canvasW: windowW,
            canvasLeft,
            dpr,
        };
    }

    function buildWaveformCanvasDrawOpt(spec) {
        if (!spec || spec.mode !== 'window') return {};
        return {
            timelineLayoutW: spec.contentW,
            timelineXOffset: spec.canvasLeft,
            timelineCanvasW: spec.canvasW,
        };
    }

    function syncWaveformCanvasElement(canvas, hCss) {
        if (!canvas) return null;
        const spec = getWaveformCanvasWindowSpec();
        if (!spec) return null;
        const laneH = Math.max(1, hCss | 0);
        const backingW = getWaveformCanvasBackingWidthCss(spec.canvasW, spec.dpr);
        canvas.width = Math.max(1, Math.round(backingW * spec.dpr));
        canvas.height = Math.max(1, Math.round(laneH * spec.dpr));
        canvas.style.width = spec.canvasW + 'px';
        canvas.style.height = laneH + 'px';
        if (spec.mode === 'window') {
            canvas.style.position = 'absolute';
            canvas.style.left = spec.canvasLeft + 'px';
            canvas.style.top = '0';
        } else {
            canvas.style.position = '';
            canvas.style.left = '';
            canvas.style.top = '';
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
            applyWaveformCanvasContextTransform(ctx, spec.canvasW, backingW, spec.dpr);
        }
        const overviewLayoutW = spec.contentW;
        const barCount = Math.min(4096, Math.max(64, overviewLayoutW));
        return {
            ctx,
            wCss: spec.canvasW,
            hCss: laneH,
            barCount,
            backingW,
            canvasSpec: spec,
            drawOpt: buildWaveformCanvasDrawOpt(spec),
        };
    }

    function snapWaveformTimelineZoom(z) {
        const n = Number(z);
        if (!Number.isFinite(n)) return WAVEFORM_TIMELINE_ZOOM_FIT;
        let best = WAVEFORM_TIMELINE_ZOOM_LEVELS[0];
        let bestDist = Math.abs(n - best);
        for (let i = 1; i < WAVEFORM_TIMELINE_ZOOM_LEVELS.length; i++) {
            const level = WAVEFORM_TIMELINE_ZOOM_LEVELS[i];
            const dist = Math.abs(n - level);
            if (dist < bestDist) {
                best = level;
                bestDist = dist;
            }
        }
        return best;
    }

    function clampWaveformTimelineZoom(z) {
        return snapWaveformTimelineZoom(z);
    }

    function waveformTimelineZoomLevelIndex(z) {
        const snapped = snapWaveformTimelineZoom(z);
        const idx = WAVEFORM_TIMELINE_ZOOM_LEVELS.findIndex(
            (level) => Math.abs(level - snapped) < 0.001,
        );
        return idx >= 0 ? idx : 0;
    }

    function stepWaveformTimelineZoomLevel(dir) {
        const d = dir > 0 ? 1 : dir < 0 ? -1 : 0;
        if (!d) return waveformTimelineZoom;
        const idx = waveformTimelineZoomLevelIndex(waveformTimelineZoom);
        const next = Math.max(0, Math.min(WAVEFORM_TIMELINE_ZOOM_LEVELS.length - 1, idx + d));
        return WAVEFORM_TIMELINE_ZOOM_LEVELS[next];
    }

    function snapWaveformVerticalZoom(z) {
        const n = Number(z);
        if (!Number.isFinite(n)) return 1;
        let best = WAVEFORM_VERTICAL_ZOOM_LEVELS[0];
        let bestDist = Math.abs(n - best);
        for (let i = 1; i < WAVEFORM_VERTICAL_ZOOM_LEVELS.length; i++) {
            const level = WAVEFORM_VERTICAL_ZOOM_LEVELS[i];
            const dist = Math.abs(n - level);
            if (dist < bestDist) {
                best = level;
                bestDist = dist;
            }
        }
        return best;
    }

    function waveformVerticalZoomLevelIndex(z) {
        const snapped = snapWaveformVerticalZoom(z);
        const idx = WAVEFORM_VERTICAL_ZOOM_LEVELS.findIndex(
            (level) => Math.abs(level - snapped) < 0.001,
        );
        return idx >= 0 ? idx : 0;
    }

    function stepWaveformVerticalZoomLevel(dir) {
        const d = dir > 0 ? 1 : dir < 0 ? -1 : 0;
        if (!d) return waveformVerticalZoom;
        const idx = waveformVerticalZoomLevelIndex(waveformVerticalZoom);
        const next = Math.max(
            0,
            Math.min(WAVEFORM_VERTICAL_ZOOM_LEVELS.length - 1, idx + d),
        );
        return WAVEFORM_VERTICAL_ZOOM_LEVELS[next];
    }

    function getWaveformVerticalZoom() {
        return waveformVerticalZoom;
    }

    function waveformVerticalZoomHintLabel(zoom) {
        const z = snapWaveformVerticalZoom(zoom);
        if (Math.abs(z - 1) < 0.001) return '1×';
        return z + '×';
    }

    function flashWaveformVerticalZoomHint(zoom, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.silent) return;
        if (typeof flashSeekHint !== 'function') return;
        flashSeekHint('V-Zoom', waveformVerticalZoomHintLabel(zoom), 'notice');
    }

    function setWaveformVerticalZoom(nextZoom, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const z = snapWaveformVerticalZoom(nextZoom);
        if (Math.abs(z - waveformVerticalZoom) < 0.001) return true;
        waveformVerticalZoom = z;
        if (typeof scheduleWaveformVisualRefresh === 'function') {
            scheduleWaveformVisualRefresh({ sync: true });
        }
        flashWaveformVerticalZoomHint(z, o);
        return true;
    }

    function resetWaveformVerticalZoom(opt) {
        return setWaveformVerticalZoom(1, opt);
    }

    function isWaveformTimelineAtFitZoom() {
        return Math.abs(waveformTimelineZoom - WAVEFORM_TIMELINE_ZOOM_FIT) < 0.001;
    }

    function isWaveformTimelineAtMaxZoom() {
        return Math.abs(waveformTimelineZoom - WAVEFORM_TIMELINE_ZOOM_MAX) < 0.001;
    }

    function getWaveformTimelineZoom() {
        return waveformTimelineZoom;
    }

    function waveformTimelineViewportWidthCss() {
        const el = waveformScrubTargetEl();
        if (el) return Math.max(1, el.clientWidth | 0);
        if (audioWaveformTrack) return Math.max(1, audioWaveformTrack.clientWidth | 0);
        return 1;
    }

    function masterTimelineWidthCss() {
        return Math.max(
            1,
            Math.round(waveformTimelineViewportWidthCss() * waveformTimelineZoom),
        );
    }

    /** 描画・シーク座標用のタイムライン幅（zoom×ビューポート） */
    function waveformTimelineScrubWidthCss() {
        return masterTimelineWidthCss();
    }

    function waveformTimelineMetrics(el) {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const viewportW = el.clientWidth;
        if (!viewportW) return null;
        const contentW = masterTimelineWidthCss();
        const scrubW = contentW;
        const scrollable = contentW > viewportW + 0.5;
        const scrollLeft = scrollable ? el.scrollLeft || 0 : 0;
        const borderLeft = el.clientLeft || 0;
        return {
            contentLeft: rect.left + borderLeft,
            viewportW,
            contentW,
            scrubW,
            scrollable,
            scrollLeft,
        };
    }

    function waveformTimelineHoverLeftPercent(clientX) {
        return transportRatioFromClientX(clientX) * 100;
    }

    function transportRatioFromClientX(clientX) {
        const lanes = waveformScrubTargetEl();
        const m = waveformTimelineMetrics(lanes);
        if (!m || !m.scrubW) return 0;
        // clientX を「表示領域」ではなく「全タイムライン内容」座標へ変換する。
        // ズーム時は scrollLeft を足さないと、分割点が描画幅比で前方にズレる。
        const xInViewport = clientX - m.contentLeft;
        const xInScrub = xInViewport + (m.scrollable ? m.scrollLeft : 0);
        return Math.max(0, Math.min(1, xInScrub / m.scrubW));
    }

    function transportSecFromClientX(clientX) {
        return transportRatioFromClientX(clientX) * getMasterTransportDurationSec();
    }

    function notifyWaveformTimelineZoomChanged() {
        if (typeof drawSeekPlaybackTrail === 'function') drawSeekPlaybackTrail();
        if (typeof refreshWaveformTimelineVisualAfterZoomChange === 'function') {
            refreshWaveformTimelineVisualAfterZoomChange();
        }
    }

    function waveformTimelineZoomHintLabel(zoom) {
        const z = snapWaveformTimelineZoom(zoom);
        return z + '×';
    }

    function flashWaveformTimelineZoomHint(zoom, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.silent) return;
        if (typeof flashSeekHint !== 'function') return;
        flashSeekHint('H-Zoom', waveformTimelineZoomHintLabel(zoom), 'notice');
    }

    function waveformTimelineInnerEl() {
        if (typeof audioWaveformLanesInner !== 'undefined' && audioWaveformLanesInner) {
            return audioWaveformLanesInner;
        }
        const lanes = waveformScrubTargetEl();
        return lanes
            ? lanes.querySelector('.audio-waveform-composite__lanes-inner')
            : null;
    }

    /** ローディング帯の幅用（inner の content 幅が未確定でも見えている幅を使う） */
    function syncWaveformLanesViewportWidthCss() {
        const lanes = waveformScrubTargetEl();
        if (!lanes) return 0;
        const viewportW = Math.max(0, waveformTimelineViewportWidthCss());
        lanes.style.setProperty('--wave-lanes-viewport-w', viewportW + 'px');
        return viewportW;
    }

    function applyWaveformTimelineZoomLayout() {
        waveformTimelineZoom = clampWaveformTimelineZoom(waveformTimelineZoom);
        const lanes = waveformScrubTargetEl();
        if (!lanes) return;
        const viewportW = syncWaveformLanesViewportWidthCss();
        if (Math.abs(viewportW - waveformCanvasWindowViewportWCache) > 0.5) {
            invalidateWaveformCanvasWindowCache();
        }
        const contentW = masterTimelineWidthCss();
        lanes.style.setProperty('--wave-timeline-content-w', contentW + 'px');
        const zoomed = !isWaveformTimelineAtFitZoom();
        lanes.classList.toggle('audio-waveform-composite__lanes--zoomed', zoomed);
        const inner = waveformTimelineInnerEl();
        if (inner) {
            if (zoomed) {
                inner.style.width = contentW + 'px';
                inner.style.minWidth = contentW + 'px';
                inner.style.maxWidth = '';
            } else {
                inner.style.width = '';
                inner.style.minWidth = '';
                inner.style.maxWidth = '';
            }
        }
        if (zoomed) {
            const cs = window.getComputedStyle(lanes);
            const borderTop = parseFloat(cs.borderTopWidth || '0') || 0;
            const borderBottom = parseFloat(cs.borderBottomWidth || '0') || 0;
            const chromeH = Math.max(0, lanes.offsetHeight - lanes.clientHeight);
            const scrollbarH = Math.max(0, Math.round(chromeH - borderTop - borderBottom));
            lanes.style.setProperty('--wave-lanes-scrollbar-h', scrollbarH + 'px');
        } else {
            lanes.style.setProperty('--wave-lanes-scrollbar-h', '0px');
        }
        const scrollable = contentW > viewportW + 0.5;
        if (!scrollable || isWaveformTimelineAtFitZoom()) lanes.scrollLeft = 0;
        if (typeof scheduleMusicalGridRedraw === 'function') scheduleMusicalGridRedraw();
    }

    function transportSecForWaveformZoomCenter() {
        if (typeof getTransportSecForDisplay === 'function') {
            return getTransportSecForDisplay();
        }
        if (typeof getTransportSec === 'function') return getTransportSec();
        return transportPlaybackSec;
    }

    function clampWaveformTimelineScrollLeft(scrollLeft, scrubW, viewportW) {
        const maxScroll = Math.max(0, scrubW - viewportW);
        return Math.max(0, Math.min(maxScroll, scrollLeft));
    }

    /** 指定時刻がビューポート中央へ来る scrollLeft */
    function scrollLeftToCenterMasterSec(sec, scrubW, viewportW) {
        const ratio = transportRatioFromMasterSec(sec);
        return clampWaveformTimelineScrollLeft(
            ratio * scrubW - viewportW * 0.5,
            scrubW,
            viewportW,
        );
    }

    /** 拡縮後にシークバー（プレイヘッド）がビューポート中央へ来る scrollLeft */
    function scrollLeftToCenterTransportSec(scrubW, viewportW) {
        return scrollLeftToCenterMasterSec(
            transportSecForWaveformZoomCenter(),
            scrubW,
            viewportW,
        );
    }

    /** 指定時刻が画面外のときだけ、ビューポート左端へ来る scrollLeft */
    function scrollLeftToRevealMasterSecAtLeftEdge(sec, scrubW, viewportW, currentScrollLeft) {
        const ratio = transportRatioFromMasterSec(sec);
        const x = ratio * scrubW;
        const scrollLeft = Number.isFinite(currentScrollLeft) ? currentScrollLeft : 0;
        const visLeft = scrollLeft;
        const visRight = scrollLeft + viewportW;
        if (x >= visLeft && x <= visRight) return scrollLeft;
        return clampWaveformTimelineScrollLeft(x, scrubW, viewportW);
    }

    function scrollLeftForMasterSec(sec, scrubW, viewportW, currentScrollLeft) {
        if (waveformTimelineCenterLockActive) {
            return scrollLeftToCenterMasterSec(sec, scrubW, viewportW);
        }
        const ratio = transportRatioFromMasterSec(sec);
        if (ratio <= 1e-8) {
            return 0;
        }
        return scrollLeftToRevealMasterSecAtLeftEdge(
            sec,
            scrubW,
            viewportW,
            currentScrollLeft,
        );
    }

    function scrollLeftForTransportSec(scrubW, viewportW, currentScrollLeft) {
        return scrollLeftForMasterSec(
            transportSecForWaveformZoomCenter(),
            scrubW,
            viewportW,
            currentScrollLeft,
        );
    }

    function isWaveformTimelineCenterLockActive() {
        return waveformTimelineCenterLockActive;
    }

    function setWaveformTimelineCenterLock(active) {
        waveformTimelineCenterLockActive = !!active;
    }

    function applyWaveformTimelineZoomScroll(lanes, scrollLeft) {
        if (!lanes) return;
        if (Math.abs((lanes.scrollLeft || 0) - scrollLeft) <= 0.5) return;
        lanes.scrollLeft = scrollLeft;
        notifyWaveformTimelineZoomChanged();
        syncWaveformTimelineScrollToTransport();
    }

    function setWaveformTimelineZoom(nextZoom, centerSeekBar, scrollOpt) {
        const o = scrollOpt && typeof scrollOpt === 'object' ? scrollOpt : {};
        const lanes = waveformScrubTargetEl();
        const vw = waveformTimelineViewportWidthCss();
        const oldZoom = waveformTimelineZoom;
        const z = clampWaveformTimelineZoom(nextZoom);
        const newContentW = Math.max(1, Math.round(vw * z));
        let scrollLeft = lanes ? lanes.scrollLeft || 0 : 0;

        if (scrollOpt && Number.isFinite(scrollOpt.scrollLeft)) {
            scrollLeft = clampWaveformTimelineScrollLeft(
                scrollOpt.scrollLeft,
                newContentW,
                vw,
            );
        } else if (lanes && centerSeekBar && z > WAVEFORM_TIMELINE_ZOOM_FIT + 0.001) {
            scrollLeft = scrollLeftForTransportSec(newContentW, vw, scrollLeft);
        } else if (z <= WAVEFORM_TIMELINE_ZOOM_FIT + 0.001) {
            scrollLeft = 0;
        }

        if (Math.abs(z - oldZoom) < 0.001) {
            if (o.scrollLeft != null && Number.isFinite(o.scrollLeft)) {
                applyWaveformTimelineZoomScroll(lanes, scrollLeft);
            }
            return true;
        }

        invalidateWaveformCanvasWindowCache();
        waveformTimelineZoom = z;
        if (
            z <= WAVEFORM_TIMELINE_ZOOM_FIT + 0.001 &&
            oldZoom > WAVEFORM_TIMELINE_ZOOM_FIT + 0.001 &&
            typeof onWaveformTimelineFitZoomRestored === 'function'
        ) {
            onWaveformTimelineFitZoomRestored();
        }
        applyWaveformTimelineZoomLayout();
        if (lanes) lanes.scrollLeft = scrollLeft;
        notifyWaveformTimelineZoomChanged();
        syncWaveformTimelineScrollToTransport();
        flashWaveformTimelineZoomHint(z, o);
        return true;
    }

    /** 点マーカー位置を最大倍率（32×）で中央表示 */
    function zoomWaveformTimelineToMarkerPointSec(sec) {
        if (!Number.isFinite(sec)) return;
        markerTcEditWaveformZoomActive = false;
        setWaveformTimelineCenterLock(false);
        setWaveformTimelineZoom(WAVEFORM_TIMELINE_ZOOM_MAX, false);
        syncWaveformTimelineScrollToMasterSec(sec);
    }

    /** 範囲マーカーを 32× で中央表示（再生位置は範囲中央） */
    function zoomWaveformTimelineToMarkerRangeSec(startSec, endSec) {
        const master = getMasterTransportDurationSec();
        if (!(master > 0)) return;
        const lo = Math.min(startSec, endSec);
        const hi = Math.max(startSec, endSec);
        const span = Math.max(hi - lo, master * 1e-6, 1e-6);
        const centerSec = lo + span * 0.5;
        markerTcEditWaveformZoomActive = false;
        setWaveformTimelineCenterLock(false);
        applyTransportAtSec(centerSec, { markers: true });
        setWaveformTimelineZoom(WAVEFORM_TIMELINE_ZOOM_MAX, false);
        syncWaveformTimelineScrollToMasterSec(centerSec);
    }

    /** ダブルクリック時: 最大倍率なら全体表示へ、それ以外は対象に合わせて拡大 */
    function handleWaveformTimelineDoubleClickZoom(opt) {
        if (isWaveformTimelineAtMaxZoom()) {
            resetWaveformTimelineZoom();
            return true;
        }
        const o = opt || {};
        if (Number.isFinite(o.rangeStartSec) && Number.isFinite(o.rangeEndSec)) {
            zoomWaveformTimelineToMarkerRangeSec(o.rangeStartSec, o.rangeEndSec);
            return true;
        }
        if (Number.isFinite(o.sec)) {
            zoomWaveformTimelineToMarkerPointSec(o.sec);
            return true;
        }
        return false;
    }

    function isWaveformTimelineInteractionReady() {
        if (typeof transportControlsReady === 'function') {
            return transportControlsReady();
        }
        return (
            (typeof videoReady === 'function' && videoReady()) ||
            (typeof anyExtraTrackLoadedForTimeline === 'function' &&
                anyExtraTrackLoadedForTimeline())
        );
    }

    function wheelEventOverWaveformLanes(ev) {
        const lanes = waveformScrubTargetEl();
        if (!lanes || !ev) return false;
        if (typeof ev.composedPath === 'function') {
            return ev.composedPath().includes(lanes);
        }
        return !!(ev.target && lanes.contains(ev.target));
    }

    function onWaveformTimelineWheel(ev) {
        if (!isWaveformTimelineInteractionReady()) return;

        if (
            ev.altKey &&
            ev.shiftKey &&
            !ev.ctrlKey &&
            !ev.metaKey &&
            typeof handlePlaybackRegionPitchWheel === 'function' &&
            handlePlaybackRegionPitchWheel(ev)
        ) {
            return;
        }

        if (
            ev.altKey &&
            !ev.ctrlKey &&
            !ev.metaKey &&
            !ev.shiftKey &&
            typeof handlePlaybackRegionGainWheel === 'function' &&
            handlePlaybackRegionGainWheel(ev)
        ) {
            return;
        }

        const delta = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;

        if (
            (ev.ctrlKey || ev.metaKey) &&
            !ev.altKey &&
            !ev.shiftKey &&
            !isWaveformTimelineZoomKeyboardBlocked(ev)
        ) {
            if (!delta) return;
            ev.preventDefault();
            if (delta < 0) {
                setWaveformTimelineZoom(WAVEFORM_TIMELINE_ZOOM_MAX, true);
            } else {
                resetWaveformTimelineZoom();
            }
            return;
        }

        if (
            (ev.ctrlKey || ev.metaKey) &&
            ev.shiftKey &&
            !ev.altKey &&
            !isWaveformTimelineZoomKeyboardBlocked(ev) &&
            typeof stepWaveformLaneHeightScale === 'function' &&
            typeof setWaveformLaneHeightScale === 'function'
        ) {
            if (!delta) return;
            ev.preventDefault();
            if (delta < 0) {
                setWaveformLaneHeightScale(stepWaveformLaneHeightScale(-1));
            } else {
                setWaveformLaneHeightScale(stepWaveformLaneHeightScale(1));
            }
            return;
        }

        if (ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
            const lanes = waveformScrubTargetEl();
            if (!lanes) return;
            const m = waveformTimelineMetrics(lanes);
            if (!m || !m.scrollable) return;
            if (!delta) return;
            ev.preventDefault();
            const max = Math.max(0, m.scrubW - m.viewportW);
            lanes.scrollLeft = Math.max(
                0,
                Math.min(max, lanes.scrollLeft + delta),
            );
            return;
        }

        if (
            !ev.ctrlKey &&
            !ev.metaKey &&
            !ev.altKey &&
            !ev.shiftKey &&
            !isWaveformTimelineZoomKeyboardBlocked(ev)
        ) {
            if (!delta) return;
            ev.preventDefault();
            if (delta < 0) {
                setWaveformTimelineZoom(stepWaveformTimelineZoomLevel(1), true);
            } else {
                setWaveformTimelineZoom(stepWaveformTimelineZoomLevel(-1), true);
            }
            return;
        }

    }

    function onWaveformTimelineWheelCapture(ev) {
        if (!wheelEventOverWaveformLanes(ev)) return;
        onWaveformTimelineWheel(ev);
    }

    function onWaveformLanesScroll() {
        if (waveformTimelineProgrammaticScroll) return;
        if (
            typeof isWaveformScrubPriorityActive === 'function' &&
            isWaveformScrubPriorityActive()
        ) {
            return;
        }
        scheduleSeekPlaybackTrailOnLanesScroll();
        if (typeof refreshHoverPlayheadFromLastPointer === 'function') {
            refreshHoverPlayheadFromLastPointer();
        }
        if (isWaveformTimelineAtFitZoom()) return;
        if (isWaveformLanesScrollVisualDeferActive()) return;
        if (isTransportPlaying()) {
            if (typeof scheduleWaveformVisualRefreshOnScroll === 'function') {
                scheduleWaveformVisualRefreshOnScroll({ playbackScroll: true });
            }
            return;
        }
        if (typeof scheduleWaveformVisualRefreshOnScroll === 'function') {
            scheduleWaveformVisualRefreshOnScroll();
        }
    }

    function isWaveformTimelineKeyboardReady() {
        return isWaveformTimelineInteractionReady();
    }

    /** マーカー一覧の TC・コメント編集中は ↑/↓ ズームを無効にする */
    function isWaveformTimelineZoomKeyboardBlocked(e) {
        return (
            typeof isMarkerListEditableFieldActive === 'function' &&
            isMarkerListEditableFieldActive({ target: e && e.target })
        );
    }

    function resetWaveformTimelineZoom(opt) {
        markerTcEditWaveformZoomActive = false;
        setWaveformTimelineCenterLock(false);
        invalidateWaveformCanvasWindowCache();
        return setWaveformTimelineZoom(WAVEFORM_TIMELINE_ZOOM_FIT, false, opt);
    }

    function applyWaveformTimelineScrollTarget(next, opt) {
        const lanes = waveformScrubTargetEl();
        if (!lanes || isWaveformTimelineAtFitZoom()) return;
        const force = !!(opt && opt.force);
        if (!force && Math.abs((lanes.scrollLeft || 0) - next) <= 0.5) return;
        const seekSync = !!(opt && opt.seekSync);
        const deferVisualRefresh = !!(opt && opt.deferVisualRefresh);
        const keyboardScrub =
            typeof isKeyboardTransportScrubActive === 'function' &&
            isKeyboardTransportScrubActive();
        const playbackScroll =
            !seekSync &&
            typeof isTransportPlaying === 'function' &&
            isTransportPlaying() &&
            !keyboardScrub;

        if (seekSync || force || deferVisualRefresh || keyboardScrub || playbackScroll) {
            setWaveformTimelineScrollLeft(lanes, next, force || seekSync ? { force: true } : undefined);
            scheduleSeekPlaybackTrailOnLanesScroll();
            if (seekSync || force) {
                if (typeof invalidateWaveformCanvasWindowCache === 'function') {
                    invalidateWaveformCanvasWindowCache();
                }
                if (typeof flushWaveformVisualRefresh === 'function') {
                    flushWaveformVisualRefresh({ force: true });
                } else if (typeof scheduleWaveformVisualRefresh === 'function') {
                    scheduleWaveformVisualRefresh({ force: true, sync: true });
                }
                return;
            }
            if (playbackScroll) {
                if (typeof scheduleWaveformScrubOverviewDraw === 'function') {
                    scheduleWaveformScrubOverviewDraw();
                }
                if (typeof scheduleWaveformVisualRefreshOnScroll === 'function') {
                    scheduleWaveformVisualRefreshOnScroll({ playbackScroll: true });
                }
            } else if (
                typeof isWaveformScrubPriorityActive === 'function' &&
                isWaveformScrubPriorityActive() &&
                typeof scheduleWaveformScrubOverviewDraw === 'function'
            ) {
                scheduleWaveformScrubOverviewDraw();
            } else if (typeof scheduleWaveformVisualRefreshOnScroll === 'function') {
                scheduleWaveformVisualRefreshOnScroll();
            } else if (typeof scheduleWaveformVisualRefresh === 'function') {
                scheduleWaveformVisualRefresh();
            }
            return;
        }

        lanes.scrollLeft = next;
        scheduleSeekPlaybackTrailOnLanesScroll();
        if (typeof scheduleWaveformVisualRefreshOnScroll === 'function') {
            scheduleWaveformVisualRefreshOnScroll();
        } else if (typeof scheduleWaveformVisualRefresh === 'function') {
            scheduleWaveformVisualRefresh();
        }
    }

    /** センターロック ON 時は中央、OFF 時は画面外なら左端追従 */
    function syncWaveformTimelineScrollToMasterSec(sec, opt) {
        const lanes = waveformScrubTargetEl();
        if (!lanes || isWaveformTimelineAtFitZoom()) return;
        const vw = waveformTimelineViewportWidthCss();
        const scrubW = waveformTimelineScrubWidthCss();
        const next = scrollLeftForMasterSec(sec, scrubW, vw, lanes.scrollLeft || 0);
        applyWaveformTimelineScrollTarget(next, opt);
    }

    function syncWaveformTimelineScrollToTransport(opt) {
        syncWaveformTimelineScrollToMasterSec(transportSecForWaveformZoomCenter(), opt);
    }

    /** 明示シーク後: スクロール位置を合わせて波形を即再描画（先頭シーク等） */
    function syncWaveformTimelineAfterTransportSeek(sec) {
        if (typeof isWaveformTimelineAtFitZoom === 'function' && isWaveformTimelineAtFitZoom()) {
            if (typeof invalidateWaveformCanvasWindowCache === 'function') {
                invalidateWaveformCanvasWindowCache();
            }
            if (typeof scheduleWaveformVisualRefresh === 'function') {
                scheduleWaveformVisualRefresh({ force: true, sync: true });
            }
            return;
        }
        syncWaveformTimelineScrollToMasterSec(sec, { force: true, seekSync: true });
    }

    /** 指定時刻がビューポート中央へ来るよう scrollLeft を設定（明示センターロック） */
    function centerWaveformTimelineOnMasterSec(sec, opt) {
        const lanes = waveformScrubTargetEl();
        if (!lanes || isWaveformTimelineAtFitZoom()) return;
        const vw = waveformTimelineViewportWidthCss();
        const scrubW = waveformTimelineScrubWidthCss();
        const next = scrollLeftToCenterMasterSec(sec, scrubW, vw);
        applyWaveformTimelineScrollTarget(next, opt);
    }

    /** 現在の transport 位置をビューポート中央へ */
    function centerWaveformTimelineOnTransport(opt) {
        centerWaveformTimelineOnMasterSec(transportSecForWaveformZoomCenter(), opt);
    }

    function beginMarkerTcEditWaveformZoom() {
        setWaveformTimelineCenterLock(true);
        if (markerTcEditWaveformZoomActive) {
            centerWaveformTimelineOnTransport();
            return;
        }
        markerTcEditWaveformZoomActive = true;
        setWaveformTimelineZoom(MARKER_TC_EDIT_WAVEFORM_ZOOM, false, { silent: true });
        centerWaveformTimelineOnTransport();
    }

    function endMarkerTcEditWaveformZoom() {
        if (!markerTcEditWaveformZoomActive) return;
        markerTcEditWaveformZoomActive = false;
        setWaveformTimelineCenterLock(false);
        setWaveformTimelineZoom(WAVEFORM_TIMELINE_ZOOM_FIT, false, { silent: true });
    }

    function handleWaveformTimelineKeydown(e) {
        if (!isWaveformTimelineKeyboardReady()) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return false;

        if (!isWaveformTimelineZoomKeyboardBlocked(e)) {
            if (matchUserShortcut(e, 'waveformTimelineZoomMax')) {
                e.preventDefault();
                setWaveformTimelineZoom(WAVEFORM_TIMELINE_ZOOM_MAX, true);
                return true;
            }
            if (matchUserShortcut(e, 'waveformTimelineZoomFit')) {
                e.preventDefault();
                resetWaveformTimelineZoom();
                return true;
            }
            if (matchUserShortcut(e, 'waveformTimelineZoomIn', { allowRepeat: true })) {
                e.preventDefault();
                setWaveformTimelineZoom(stepWaveformTimelineZoomLevel(1), true);
                return true;
            }
            if (matchUserShortcut(e, 'waveformTimelineZoomOut', { allowRepeat: true })) {
                e.preventDefault();
                setWaveformTimelineZoom(stepWaveformTimelineZoomLevel(-1), true);
                return true;
            }
            if (matchUserShortcut(e, 'waveformLaneHeightExpand', { allowRepeat: true })) {
                e.preventDefault();
                if (
                    typeof stepWaveformLaneHeightScale === 'function' &&
                    typeof setWaveformLaneHeightScale === 'function'
                ) {
                    setWaveformLaneHeightScale(stepWaveformLaneHeightScale(1));
                }
                return true;
            }
            if (matchUserShortcut(e, 'waveformLaneHeightShrink', { allowRepeat: true })) {
                e.preventDefault();
                if (
                    typeof stepWaveformLaneHeightScale === 'function' &&
                    typeof setWaveformLaneHeightScale === 'function'
                ) {
                    setWaveformLaneHeightScale(stepWaveformLaneHeightScale(-1));
                }
                return true;
            }
            if (matchUserShortcut(e, 'waveformVerticalZoomIn', { allowRepeat: true })) {
                e.preventDefault();
                setWaveformVerticalZoom(stepWaveformVerticalZoomLevel(1));
                return true;
            }
            if (matchUserShortcut(e, 'waveformVerticalZoomOut', { allowRepeat: true })) {
                e.preventDefault();
                setWaveformVerticalZoom(stepWaveformVerticalZoomLevel(-1));
                return true;
            }
        }

        return false;
    }

    const ZOOM_VIEWPORT_PLAYBACK_MIN_SEC = 0.05;
    /** 表示範囲の右端手前で止める（端まで行くと追従スクロールが発生するため） */
    const ZOOM_VIEWPORT_PLAYBACK_STOP_RATIO = 0.99;
    let zoomViewportPlaybackActive = false;
    let zoomViewportPlaybackInSec = 0;
    let zoomViewportPlaybackOutSec = 0;

    /** 現在の scrollLeft / ビューポートから表示中の transport 秒範囲 */
    function getWaveformTimelineVisibleSecRange() {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return null;
        const lanes = waveformScrubTargetEl();
        const m = lanes ? waveformTimelineMetrics(lanes) : null;
        if (!m || !m.scrubW) {
            return { startSec: 0, endSec: master };
        }
        const scrollLeft = m.scrollable ? m.scrollLeft : 0;
        const startRatio = scrollLeft / m.scrubW;
        const endRatio = (scrollLeft + m.viewportW) / m.scrubW;
        const startSec = Math.max(0, startRatio * master);
        const endSec = Math.min(master, endRatio * master);
        if (endSec - startSec < ZOOM_VIEWPORT_PLAYBACK_MIN_SEC) return null;
        return { startSec, endSec };
    }

    function isZoomViewportPlaybackActive() {
        return (
            zoomViewportPlaybackActive &&
            Number.isFinite(zoomViewportPlaybackInSec) &&
            Number.isFinite(zoomViewportPlaybackOutSec) &&
            zoomViewportPlaybackOutSec > zoomViewportPlaybackInSec
        );
    }

    function clearZoomViewportPlayback() {
        zoomViewportPlaybackActive = false;
        zoomViewportPlaybackInSec = 0;
        zoomViewportPlaybackOutSec = 0;
    }

    function getTransportSecForZoomViewportPlayback() {
        if (typeof getTransportSecForDisplay === 'function') {
            return getTransportSecForDisplay();
        }
        if (typeof getTransportSec === 'function') {
            return getTransportSec();
        }
        if (typeof transportPlaybackSec === 'number' && Number.isFinite(transportPlaybackSec)) {
            return transportPlaybackSec;
        }
        return 0;
    }

    /** 拡大中の再生開始: 表示範囲を Out に設定し、範外なら In へ合わせる */
    function armZoomViewportPlaybackOnPlayStart() {
        clearZoomViewportPlayback();
        if (isWaveformTimelineAtFitZoom()) return false;
        if (
            typeof isRangeLoopPlaybackActive === 'function' &&
            isRangeLoopPlaybackActive()
        ) {
            return false;
        }
        const range = getWaveformTimelineVisibleSecRange();
        if (!range) return false;
        const span = range.endSec - range.startSec;
        const stopSec = range.startSec + span * ZOOM_VIEWPORT_PLAYBACK_STOP_RATIO;
        const cur = getTransportSecForZoomViewportPlayback();
        let playStart = cur;
        if (cur < range.startSec || cur >= range.endSec) {
            playStart = range.startSec;
            if (typeof setTransportSec === 'function') {
                setTransportSec(playStart);
            }
            if (typeof transportPlaybackSec === 'number') {
                transportPlaybackSec = playStart;
                transportPlaybackLastTs = performance.now();
            }
            if (typeof applyVideoTimeForTransportSec === 'function') {
                applyVideoTimeForTransportSec(playStart, { force: true });
            }
        }
        if (playStart >= stopSec - 1e-6) {
            return false;
        }
        zoomViewportPlaybackInSec = playStart;
        zoomViewportPlaybackOutSec = stopSec;
        zoomViewportPlaybackActive = true;
        return true;
    }

    function stopZoomViewportPlaybackAtEnd() {
        const returnSec = zoomViewportPlaybackInSec;
        clearZoomViewportPlayback();
        if (typeof transportPlaybackSec === 'number' && Number.isFinite(returnSec)) {
            transportPlaybackSec = returnSec;
            transportPlaybackLastTs = performance.now();
        }
        if (typeof setTransportSec === 'function' && Number.isFinite(returnSec)) {
            setTransportSec(returnSec);
        }
        if (typeof applyVideoTimeForTransportSec === 'function' && Number.isFinite(returnSec)) {
            applyVideoTimeForTransportSec(returnSec, { force: true });
        }
        if (typeof pauseTransportBeforeSeek === 'function') {
            pauseTransportBeforeSeek();
        }
        if (typeof updateSeekUiFromVideo === 'function') {
            updateSeekUiFromVideo();
        }
        if (typeof updateAllWaveformPlayheads === 'function') {
            updateAllWaveformPlayheads();
        }
    }

    /**
     * 拡大ビューポート再生中の tick で毎フレーム video.currentTime を書き換えると再生が途切れる。
     * 表示範囲内の通常再生では動画に追従し、終端停止時のみ同期する。
     */
    function shouldApplyVideoTimeDuringZoomViewportTick(t) {
        if (!isZoomViewportPlaybackActive()) return true;
        if (typeof videoMain === 'undefined' || !videoMain) return true;
        if (videoMain.seeking) return false;
        const x = Number(t);
        if (!Number.isFinite(x)) return true;
        if (!videoMain.paused && !videoMain.ended && x >= zoomViewportPlaybackInSec && x < zoomViewportPlaybackOutSec) {
            return false;
        }
        return true;
    }

    /** @returns {boolean} */
    function advanceZoomViewportPlaybackClock() {
        if (!isZoomViewportPlaybackActive()) return false;
        if (
            typeof transportPlaybackIsInMasterTail === 'function' &&
            transportPlaybackIsInMasterTail()
        ) {
            clearZoomViewportPlayback();
            return false;
        }
        if (typeof transportPlaybackSec !== 'number' || !Number.isFinite(transportPlaybackSec)) {
            return false;
        }
        if (typeof videoMain !== 'undefined' && videoMain && videoMain.seeking) {
            return true;
        }
        const now = performance.now();
        if (transportPlaybackLastTs > 0) {
            transportPlaybackSec += (now - transportPlaybackLastTs) / 1000;
        }
        transportPlaybackLastTs = now;
        if (transportPlaybackSec >= zoomViewportPlaybackOutSec) {
            stopZoomViewportPlaybackAtEnd();
        }
        return true;
    }

    window.waveformTimelineHoverLeftPercent = waveformTimelineHoverLeftPercent;
    window.handleWaveformTimelineKeydown = handleWaveformTimelineKeydown;
    window.resetWaveformTimelineZoom = resetWaveformTimelineZoom;
    window.beginMarkerTcEditWaveformZoom = beginMarkerTcEditWaveformZoom;
    window.endMarkerTcEditWaveformZoom = endMarkerTcEditWaveformZoom;
    window.centerWaveformTimelineOnTransport = centerWaveformTimelineOnTransport;
    window.centerWaveformTimelineOnMasterSec = centerWaveformTimelineOnMasterSec;
    window.syncWaveformTimelineScrollToTransport = syncWaveformTimelineScrollToTransport;
    window.syncWaveformTimelineScrollToMasterSec = syncWaveformTimelineScrollToMasterSec;
    window.syncWaveformTimelineAfterTransportSeek = syncWaveformTimelineAfterTransportSeek;
    window.setWaveformTimelineCenterLock = setWaveformTimelineCenterLock;
    window.isWaveformTimelineCenterLockActive = isWaveformTimelineCenterLockActive;
    window.setWaveformTimelineScrollLeft = setWaveformTimelineScrollLeft;
    window.getWaveformCanvasBackingWidthCss = getWaveformCanvasBackingWidthCss;
    window.applyWaveformCanvasContextTransform = applyWaveformCanvasContextTransform;
    window.getWaveformCanvasWindowSpec = getWaveformCanvasWindowSpec;
    window.buildWaveformCanvasDrawOpt = buildWaveformCanvasDrawOpt;
    window.syncWaveformCanvasElement = syncWaveformCanvasElement;
    window.invalidateWaveformCanvasWindowCache = invalidateWaveformCanvasWindowCache;

    function initWaveformTimelineZoomUi() {
        const lanes = waveformScrubTargetEl();
        if (!lanes) return;
        const root = document.documentElement;
        if (root && root.dataset.waveformZoomWheel !== '1') {
            root.dataset.waveformZoomWheel = '1';
            document.addEventListener('wheel', onWaveformTimelineWheelCapture, {
                passive: false,
                capture: true,
            });
        }
        if (lanes.dataset.waveformZoomScroll !== '1') {
            lanes.dataset.waveformZoomScroll = '1';
            lanes.addEventListener('scroll', onWaveformLanesScroll, { passive: true });
        }
        applyWaveformTimelineZoomLayout();
    }

    window.initWaveformTimelineZoomUi = initWaveformTimelineZoomUi;

    window.getWaveformTimelineZoom = getWaveformTimelineZoom;
    window.getWaveformVerticalZoom = getWaveformVerticalZoom;
    window.setWaveformTimelineZoom = setWaveformTimelineZoom;
    window.setWaveformVerticalZoom = setWaveformVerticalZoom;
    window.resetWaveformVerticalZoom = resetWaveformVerticalZoom;
    window.isWaveformTimelineAtFitZoom = isWaveformTimelineAtFitZoom;
    window.isWaveformTimelineAtMaxZoom = isWaveformTimelineAtMaxZoom;
    window.isWaveformTimelineZoomKeyboardBlocked = isWaveformTimelineZoomKeyboardBlocked;
    window.WAVEFORM_TIMELINE_ZOOM_LEVELS = WAVEFORM_TIMELINE_ZOOM_LEVELS;
    window.zoomWaveformTimelineToMarkerPointSec = zoomWaveformTimelineToMarkerPointSec;
    window.zoomWaveformTimelineToMarkerRangeSec = zoomWaveformTimelineToMarkerRangeSec;
    window.handleWaveformTimelineDoubleClickZoom = handleWaveformTimelineDoubleClickZoom;
    window.applyWaveformTimelineZoomLayout = applyWaveformTimelineZoomLayout;
    window.syncWaveformLanesViewportWidthCss = syncWaveformLanesViewportWidthCss;
    window.waveformTimelineViewportWidthCss = waveformTimelineViewportWidthCss;
    window.waveformTimelineMetrics = waveformTimelineMetrics;
    window.waveformTimelineScrubWidthCss = waveformTimelineScrubWidthCss;
    window.masterTimelineWidthCss = masterTimelineWidthCss;
    window.waveformTimelineInnerEl = waveformTimelineInnerEl;
    window.transportRatioFromClientX = transportRatioFromClientX;
    window.transportSecFromClientX = transportSecFromClientX;
    window.scrollLeftToCenterTransportSec = scrollLeftToCenterTransportSec;
    window.scrollLeftForTransportSec = scrollLeftForTransportSec;
    window.getWaveformTimelineVisibleSecRange = getWaveformTimelineVisibleSecRange;
    window.isZoomViewportPlaybackActive = isZoomViewportPlaybackActive;
    window.clearZoomViewportPlayback = clearZoomViewportPlayback;
    window.armZoomViewportPlaybackOnPlayStart = armZoomViewportPlaybackOnPlayStart;
    window.advanceZoomViewportPlaybackClock = advanceZoomViewportPlaybackClock;
    window.shouldApplyVideoTimeDuringZoomViewportTick = shouldApplyVideoTimeDuringZoomViewportTick;
})();
