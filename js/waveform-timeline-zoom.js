/**
 * waveform-timeline-zoom.js — 波形タイムライン 1×/32× ズーム・横スクロール・レイアウト。
 */
(function waveformTimelineZoomModule() {
    /** 波形全体がビューポートに収まる倍率 */
    const WAVEFORM_TIMELINE_ZOOM_FIT = 1;
    const WAVEFORM_TIMELINE_ZOOM_MAX = 32;
    /** MARKERS の In/Out TC 編集（+/-）中の波形倍率 */
    const MARKER_TC_EDIT_WAVEFORM_ZOOM = WAVEFORM_TIMELINE_ZOOM_MAX;
    let waveformTimelineZoom = 1;
    let markerTcEditWaveformZoomActive = false;

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

    function snapWaveformTimelineZoom(z) {
        const n = Number(z);
        if (!Number.isFinite(n)) return WAVEFORM_TIMELINE_ZOOM_FIT;
        return n >= (WAVEFORM_TIMELINE_ZOOM_FIT + WAVEFORM_TIMELINE_ZOOM_MAX) * 0.5
            ? WAVEFORM_TIMELINE_ZOOM_MAX
            : WAVEFORM_TIMELINE_ZOOM_FIT;
    }

    function clampWaveformTimelineZoom(z) {
        return snapWaveformTimelineZoom(z);
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

    function pauseTransportBeforeWaveformZoomIfNeeded(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.allowDuringPlayback) return;
        if (!isTransportPlaying()) return;
        if (typeof pauseTransportBeforeSeek === 'function') {
            pauseTransportBeforeSeek();
        }
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
        const contentW = masterTimelineWidthCss();
        lanes.style.setProperty('--wave-timeline-content-w', contentW + 'px');
        const zoomed = !isWaveformTimelineAtFitZoom();
        lanes.classList.toggle('audio-waveform-composite__lanes--zoomed', zoomed);
        const inner = waveformTimelineInnerEl();
        if (inner) {
            if (zoomed) {
                inner.style.width = contentW + 'px';
                inner.style.minWidth = contentW + 'px';
            } else {
                inner.style.width = '';
                inner.style.minWidth = '';
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

    function applyWaveformTimelineZoomScroll(lanes, scrollLeft) {
        if (!lanes) return;
        if (Math.abs((lanes.scrollLeft || 0) - scrollLeft) <= 0.5) return;
        lanes.scrollLeft = scrollLeft;
        notifyWaveformTimelineZoomChanged();
        centerWaveformTimelineOnTransport();
    }

    function setWaveformTimelineZoom(nextZoom, centerSeekBar, scrollOpt) {
        const o = scrollOpt && typeof scrollOpt === 'object' ? scrollOpt : {};
        pauseTransportBeforeWaveformZoomIfNeeded(o);
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
            scrollLeft = scrollLeftToCenterTransportSec(newContentW, vw);
        } else if (z <= WAVEFORM_TIMELINE_ZOOM_FIT + 0.001) {
            scrollLeft = 0;
        }

        if (Math.abs(z - oldZoom) < 0.001) {
            if (o.scrollLeft != null && Number.isFinite(o.scrollLeft)) {
                applyWaveformTimelineZoomScroll(lanes, scrollLeft);
            }
            return true;
        }

        waveformTimelineZoom = z;
        applyWaveformTimelineZoomLayout();
        if (lanes) lanes.scrollLeft = scrollLeft;
        notifyWaveformTimelineZoomChanged();
        centerWaveformTimelineOnTransport();
        return true;
    }

    /** 点マーカー位置を最大倍率（32×）で中央表示 */
    function zoomWaveformTimelineToMarkerPointSec(sec) {
        if (!Number.isFinite(sec)) return;
        markerTcEditWaveformZoomActive = false;
        const vw = waveformTimelineViewportWidthCss();
        const z = WAVEFORM_TIMELINE_ZOOM_MAX;
        const scrubW = Math.max(1, Math.round(vw * z));
        setWaveformTimelineZoom(z, false, {
            scrollLeft: scrollLeftToCenterMasterSec(sec, scrubW, vw),
        });
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
        applyTransportAtSec(centerSec, { markers: true });
        const vw = waveformTimelineViewportWidthCss();
        const z = WAVEFORM_TIMELINE_ZOOM_MAX;
        const scrubW = Math.max(1, Math.round(vw * z));
        setWaveformTimelineZoom(z, false, {
            scrollLeft: scrollLeftToCenterMasterSec(centerSec, scrubW, vw),
        });
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
            !ev.ctrlKey &&
            !ev.metaKey &&
            !ev.shiftKey &&
            typeof handlePlaybackRegionGainWheel === 'function' &&
            handlePlaybackRegionGainWheel(ev)
        ) {
            return;
        }

        const delta = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;

        if (ev.shiftKey) {
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

        if (!delta) return;
        ev.preventDefault();
        if (delta < 0) {
            if (!isWaveformTimelineAtMaxZoom()) {
                setWaveformTimelineZoom(WAVEFORM_TIMELINE_ZOOM_MAX, true);
            }
        } else if (!isWaveformTimelineAtFitZoom()) {
            setWaveformTimelineZoom(WAVEFORM_TIMELINE_ZOOM_FIT, true);
        }
    }

    function onWaveformTimelineWheelCapture(ev) {
        if (!wheelEventOverWaveformLanes(ev)) return;
        onWaveformTimelineWheel(ev);
    }

    function onWaveformLanesScroll() {
        if (typeof drawSeekPlaybackTrail === 'function') drawSeekPlaybackTrail();
        if (typeof refreshHoverPlayheadFromLastPointer === 'function') {
            refreshHoverPlayheadFromLastPointer();
        }
        if (isWaveformTimelineAtFitZoom()) return;
        if (
            typeof isKeyboardTransportScrubActive === 'function' &&
            isKeyboardTransportScrubActive()
        ) {
            return;
        }
        if (isTransportPlaying()) {
            if (typeof scheduleWaveformVisualRefresh === 'function') {
                scheduleWaveformVisualRefresh();
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

    function resetWaveformTimelineZoom(opt) {
        markerTcEditWaveformZoomActive = false;
        return setWaveformTimelineZoom(WAVEFORM_TIMELINE_ZOOM_FIT, false, opt);
    }

    function centerWaveformTimelineOnTransport() {
        const lanes = waveformScrubTargetEl();
        if (!lanes || isWaveformTimelineAtFitZoom()) return;
        const vw = waveformTimelineViewportWidthCss();
        const scrubW = waveformTimelineScrubWidthCss();
        const next = scrollLeftToCenterTransportSec(scrubW, vw);
        if (Math.abs((lanes.scrollLeft || 0) - next) > 0.5) {
            lanes.scrollLeft = next;
            const keyboardScrub =
                typeof isKeyboardTransportScrubActive === 'function' &&
                isKeyboardTransportScrubActive();
            if (!keyboardScrub && typeof drawSeekPlaybackTrail === 'function') {
                drawSeekPlaybackTrail();
            }
            if (
                isTransportPlaying() &&
                !keyboardScrub &&
                typeof scheduleWaveformVisualRefresh === 'function'
            ) {
                scheduleWaveformVisualRefresh();
            }
        }
    }

    function beginMarkerTcEditWaveformZoom() {
        if (markerTcEditWaveformZoomActive) {
            centerWaveformTimelineOnTransport();
            return;
        }
        markerTcEditWaveformZoomActive = true;
        setWaveformTimelineZoom(MARKER_TC_EDIT_WAVEFORM_ZOOM, true);
    }

    function endMarkerTcEditWaveformZoom() {
        if (!markerTcEditWaveformZoomActive) return;
        markerTcEditWaveformZoomActive = false;
        setWaveformTimelineZoom(WAVEFORM_TIMELINE_ZOOM_FIT, false, {
            allowDuringPlayback: true,
            silent: true,
        });
    }

    function toggleWaveformTimelineZoom() {
        if (isWaveformTimelineAtMaxZoom()) {
            resetWaveformTimelineZoom();
        } else {
            setWaveformTimelineZoom(WAVEFORM_TIMELINE_ZOOM_MAX, true);
        }
    }

    function scrollWaveformTimeline(direction) {
        const lanes = waveformScrubTargetEl();
        if (!lanes || isWaveformTimelineAtFitZoom()) return false;
        const step = Math.max(48, Math.round(waveformTimelineViewportWidthCss() * 0.12));
        const max = Math.max(0, lanes.scrollWidth - lanes.clientWidth);
        lanes.scrollLeft = Math.max(0, Math.min(max, lanes.scrollLeft + step * direction));
        onWaveformLanesScroll();
        return true;
    }

    function handleWaveformTimelineKeydown(e) {
        if (!isWaveformTimelineKeyboardReady()) return false;
        if (
            typeof isMarkerAreaKeyboardActive === 'function' &&
            isMarkerAreaKeyboardActive({ target: e.target })
        ) {
            return false;
        }
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return false;

        if (matchUserShortcut(e, 'waveformTimelineZoomToggle')) {
            e.preventDefault();
            toggleWaveformTimelineZoom();
            return true;
        }

        if (e.ctrlKey || e.altKey || e.metaKey) return false;

        if (
            matchUserShortcut(e, 'waveformTimelineScrollBack', { allowRepeat: true }) ||
            matchUserShortcut(e, 'waveformTimelineScrollForward', { allowRepeat: true })
        ) {
            e.preventDefault();
            const dir = matchUserShortcut(e, 'waveformTimelineScrollForward', { allowRepeat: true })
                ? 1
                : -1;
            scrollWaveformTimeline(dir);
            return true;
        }

        return false;
    }

    window.waveformTimelineHoverLeftPercent = waveformTimelineHoverLeftPercent;
    window.handleWaveformTimelineKeydown = handleWaveformTimelineKeydown;
    window.resetWaveformTimelineZoom = resetWaveformTimelineZoom;
    window.beginMarkerTcEditWaveformZoom = beginMarkerTcEditWaveformZoom;
    window.endMarkerTcEditWaveformZoom = endMarkerTcEditWaveformZoom;
    window.centerWaveformTimelineOnTransport = centerWaveformTimelineOnTransport;
    window.getWaveformCanvasBackingWidthCss = getWaveformCanvasBackingWidthCss;
    window.applyWaveformCanvasContextTransform = applyWaveformCanvasContextTransform;

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
    window.setWaveformTimelineZoom = setWaveformTimelineZoom;
    window.isWaveformTimelineAtFitZoom = isWaveformTimelineAtFitZoom;
    window.isWaveformTimelineAtMaxZoom = isWaveformTimelineAtMaxZoom;
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
})();
