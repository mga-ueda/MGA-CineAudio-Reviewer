    // 映像上タイムコードオーバーレイ（ドラッグ・サイズ変更・中心スナップ・位置復元）
    const TC_OVERLAY_KEY = 'main';
    const TC_OVERLAY_DEFAULT_TOP_PX = 10;
    const TC_OVERLAY_SNAP_X_PX = 14;
    const TC_OVERLAY_SNAP_Y_PX = 14;
    const TC_OVERLAY_SCALE_MIN = 0.55;
    const TC_OVERLAY_SCALE_MAX = 2.8;
    const LS_TC_OVERLAY_POS_KEY = 'cineaudio_reviewer_timecode_overlay_v1';

    /** @type {{ xRatio: number|null, bottomRatio: number|null, snapX: boolean, snapY: boolean, scale: number }} */
    let tcOverlaySharedPos = { xRatio: null, bottomRatio: null, snapX: false, snapY: false, scale: 1 };
    let tcOverlayDragState = null;
    let tcOverlayResizeState = null;
    let tcOverlayBaseMetrics = null;

    function clampTcOverlayScale(scale) {
        const s = Number(scale);
        if (!Number.isFinite(s) || s <= 0) return 1;
        return Math.max(TC_OVERLAY_SCALE_MIN, Math.min(TC_OVERLAY_SCALE_MAX, s));
    }

    function getTcOverlayUserScale() {
        return clampTcOverlayScale(tcOverlaySharedPos.scale != null ? tcOverlaySharedPos.scale : 1);
    }

    function getTcOverlayElement() {
        return timecodeOverlayMain;
    }

    function getTcOverlayFrame(el) {
        return el ? el.closest('.video-frame') : null;
    }

    function clearTcOverlayInlineSize(el) {
        if (!el) return;
        el.style.fontSize = '';
        el.style.padding = '';
        el.style.borderRadius = '';
    }

    function captureTcOverlayBaseMetrics() {
        const el = getTcOverlayElement();
        if (!el) return null;
        clearTcOverlayInlineSize(el);
        const cs = getComputedStyle(el);
        tcOverlayBaseMetrics = {
            fontSize: parseFloat(cs.fontSize) || 14,
            paddingTop: parseFloat(cs.paddingTop) || 4,
            paddingRight: parseFloat(cs.paddingRight) || 8,
            paddingBottom: parseFloat(cs.paddingBottom) || 4,
            paddingLeft: parseFloat(cs.paddingLeft) || 8,
            borderRadius: parseFloat(cs.borderRadius) || 6,
        };
        return tcOverlayBaseMetrics;
    }

    function tcOverlayBaseMetricsOrCapture() {
        if (tcOverlayBaseMetrics) return tcOverlayBaseMetrics;
        return captureTcOverlayBaseMetrics();
    }

    function invalidateTcOverlayBaseMetrics() {
        tcOverlayBaseMetrics = null;
    }

    function applyTcOverlayAppearance() {
        const el = getTcOverlayElement();
        const base = tcOverlayBaseMetricsOrCapture();
        if (!el || !base) return;
        const s = getTcOverlayUserScale();
        const fontPx = Math.max(10, Math.round(base.fontSize * s));
        el.style.fontSize = fontPx + 'px';
        el.style.padding = '';
        el.style.lineHeight = '1';
        const borderR = Math.max(2, Math.round(base.borderRadius * s));
        el.style.borderRadius = borderR + 'px';
        const textEl = el.querySelector('.video-timecode__text');
        if (textEl) {
            textEl.style.transform = '';
            textEl.style.lineHeight = '1';
        }
        const handle = el.querySelector('.video-timecode__resize-handle');
        if (handle) {
            const handlePx = Math.max(8, Math.round(10 * s));
            handle.style.width = handlePx + 'px';
            handle.style.height = handlePx + 'px';
            handle.style.borderRadius = '0 0 ' + borderR + 'px 0';
        }
    }

    function ensureTcOverlayStructure(el) {
        if (!el) return { textEl: null, handle: null };
        let textEl = el.querySelector('.video-timecode__text');
        if (!textEl) {
            const initial = el.textContent;
            textEl = document.createElement('span');
            textEl.className = 'video-timecode__text';
            textEl.textContent = initial;
            el.textContent = '';
            el.appendChild(textEl);
        }
        let handle = el.querySelector('.video-timecode__resize-handle');
        if (!handle) {
            handle = document.createElement('div');
            handle.className = 'video-timecode__resize-handle';
            handle.setAttribute('aria-hidden', 'true');
            handle.title = 'Drag to resize timecode';
            el.appendChild(handle);
        }
        return { textEl: textEl, handle: handle };
    }

    function tcOverlayTravelForFrame(frame, el) {
        const mw = el.offsetWidth;
        const mh = el.offsetHeight;
        const fw = frame.clientWidth;
        const fh = frame.clientHeight;
        return {
            maxLeft: Math.max(0, fw - mw),
            maxBottom: Math.max(0, fh - mh),
            mw,
            mh,
            fw,
            fh,
        };
    }

    function defaultTcOverlayRatios(maxLeft, maxBottom) {
        const bottom = Math.max(0, maxBottom - TC_OVERLAY_DEFAULT_TOP_PX);
        return {
            xRatio: maxLeft > 0 ? 0.5 : 0,
            bottomRatio: maxBottom > 0 ? bottom / maxBottom : 1,
        };
    }

    function ensureTcOverlayRatios(frame, el) {
        if (tcOverlaySharedPos.xRatio == null || tcOverlaySharedPos.bottomRatio == null) {
            const { maxLeft, maxBottom } = tcOverlayTravelForFrame(frame, el);
            const d = defaultTcOverlayRatios(maxLeft, maxBottom);
            tcOverlaySharedPos.xRatio = d.xRatio;
            tcOverlaySharedPos.bottomRatio = d.bottomRatio;
            tcOverlaySharedPos.snapX = true;
            tcOverlaySharedPos.snapY = false;
        }
    }

    function tcOverlayPixelPosFromRatios(maxLeft, maxBottom) {
        let xRatio = tcOverlaySharedPos.xRatio;
        let bottomRatio = tcOverlaySharedPos.bottomRatio;
        if (xRatio == null || bottomRatio == null) {
            const d = defaultTcOverlayRatios(maxLeft, maxBottom);
            xRatio = d.xRatio;
            bottomRatio = d.bottomRatio;
        }
        let left;
        if (tcOverlaySharedPos.snapX) {
            left = Math.round(maxLeft / 2);
        } else {
            left = Math.round(Math.max(0, Math.min(1, xRatio)) * maxLeft);
        }
        let bottom;
        if (tcOverlaySharedPos.snapY) {
            bottom = Math.round(maxBottom / 2);
        } else {
            bottom = Math.round(Math.max(0, Math.min(1, bottomRatio)) * maxBottom);
        }
        return {
            left: Math.max(0, Math.min(maxLeft, left)),
            bottom: Math.max(0, Math.min(maxBottom, bottom)),
        };
    }

    function pixelPosFromTcShared(frame, el) {
        const t = tcOverlayTravelForFrame(frame, el);
        if (t.fw < 1 || t.fh < 1) return null;
        ensureTcOverlayRatios(frame, el);
        return tcOverlayPixelPosFromRatios(t.maxLeft, t.maxBottom);
    }

    function setTcOverlaySnapClasses(el, snapX, snapY) {
        if (!el) return;
        const drag = !!tcOverlayDragState;
        el.classList.toggle('video-timecode--snap-x', drag && !!snapX);
        el.classList.toggle('video-timecode--snap-y', drag && !!snapY);
    }

    function ensureTcCenterGuides(frame) {
        if (!frame) return;
        let guideV = frame.querySelector('.burn-in-center-guide--v');
        if (!guideV) {
            guideV = document.createElement('div');
            guideV.className = 'burn-in-center-guide burn-in-center-guide--v';
            guideV.setAttribute('aria-hidden', 'true');
            frame.appendChild(guideV);
        }
        let guideH = frame.querySelector('.burn-in-center-guide--h');
        if (!guideH) {
            guideH = document.createElement('div');
            guideH.className = 'burn-in-center-guide burn-in-center-guide--h';
            guideH.setAttribute('aria-hidden', 'true');
            frame.appendChild(guideH);
        }
    }

    function updateTcCenterGuides() {
        if (frameMain) {
            frameMain.classList.remove('video-frame--burn-snap-x', 'video-frame--burn-snap-y');
        }
        if (!tcOverlayDragState || !videoReady()) return;
        const el = getTcOverlayElement();
        const frame = getTcOverlayFrame(el);
        if (!el || !frame || el.classList.contains('video-timecode--hidden')) return;
        ensureTcCenterGuides(frame);
        if (tcOverlaySharedPos.snapX) frame.classList.add('video-frame--burn-snap-x');
        if (tcOverlaySharedPos.snapY) frame.classList.add('video-frame--burn-snap-y');
    }

    function applyTcOverlayPosition() {
        const el = getTcOverlayElement();
        const frame = getTcOverlayFrame(el);
        if (!el || !frame) return;
        applyTcOverlayAppearance();
        const pos = pixelPosFromTcShared(frame, el);
        if (!pos) return;
        el.style.left = pos.left + 'px';
        el.style.bottom = pos.bottom + 'px';
        el.style.top = 'auto';
        el.style.right = 'auto';
        setTcOverlaySnapClasses(el, tcOverlaySharedPos.snapX, tcOverlaySharedPos.snapY);
    }

    function updateTcPosFromPixels(frame, el, left, bottom, snapX, snapY) {
        const t = tcOverlayTravelForFrame(frame, el);
        tcOverlaySharedPos.xRatio = t.maxLeft > 0 ? left / t.maxLeft : 0;
        tcOverlaySharedPos.bottomRatio = t.maxBottom > 0 ? bottom / t.maxBottom : 0;
        tcOverlaySharedPos.snapX = !!snapX;
        tcOverlaySharedPos.snapY = !!snapY;
        applyTcOverlayPosition();
        updateTcCenterGuides();
    }

    function seedDefaultTcOverlayPos() {
        const el = getTcOverlayElement();
        const frame = getTcOverlayFrame(el);
        if (!el || !frame || !videoReady()) return false;
        const { maxLeft, maxBottom } = tcOverlayTravelForFrame(frame, el);
        const d = defaultTcOverlayRatios(maxLeft, maxBottom);
        tcOverlaySharedPos.xRatio = d.xRatio;
        tcOverlaySharedPos.bottomRatio = d.bottomRatio;
        return true;
    }

    function applyTcOverlayDefaultPosition(opt) {
        const save = !!(opt && opt.save);
        tcOverlaySharedPos.xRatio = null;
        tcOverlaySharedPos.bottomRatio = null;
        tcOverlaySharedPos.snapX = true;
        tcOverlaySharedPos.snapY = false;
        tcOverlaySharedPos.scale = 1;
        delete tcOverlaySharedPos._pendingDefaultSeed;
        const seeded = seedDefaultTcOverlayPos();
        if (!seeded) tcOverlaySharedPos._pendingDefaultSeed = true;
        invalidateTcOverlayBaseMetrics();
        captureTcOverlayBaseMetrics();
        applyTcOverlayAppearance();
        applyTcOverlayPosition();
        if (save && seeded) saveTcOverlayPosition();
    }

    function resetTcOverlayToDefaultPosition() {
        applyTcOverlayDefaultPosition({ save: true });
    }

    function tryApplyPendingDefaultTcPosition() {
        if (!tcOverlaySharedPos._pendingDefaultSeed) return;
        if (!videoReady()) return;
        if (!seedDefaultTcOverlayPos()) return;
        delete tcOverlaySharedPos._pendingDefaultSeed;
        invalidateTcOverlayBaseMetrics();
        captureTcOverlayBaseMetrics();
        applyTcOverlayAppearance();
        applyTcOverlayPosition();
    }

    function loadTcOverlayPosition() {
        tcOverlaySharedPos = {
            xRatio: null,
            bottomRatio: null,
            snapX: true,
            snapY: false,
            scale: 1,
            _pendingDefaultSeed: true,
        };
        try {
            const raw = localStorage.getItem(LS_TC_OVERLAY_POS_KEY);
            if (!raw) return;
            const p = JSON.parse(raw);
            if (!p || typeof p !== 'object') return;
            const xRatio = Number(p.xRatio);
            const bottomRatio = Number(p.bottomRatio);
            if (Number.isFinite(xRatio) && Number.isFinite(bottomRatio)) {
                delete tcOverlaySharedPos._pendingDefaultSeed;
                tcOverlaySharedPos.xRatio = Math.max(0, Math.min(1, xRatio));
                tcOverlaySharedPos.bottomRatio = Math.max(0, Math.min(1, bottomRatio));
                tcOverlaySharedPos.snapX = !!p.snapX;
                tcOverlaySharedPos.snapY = !!p.snapY;
                if (Number.isFinite(Number(p.scale))) {
                    tcOverlaySharedPos.scale = clampTcOverlayScale(p.scale);
                }
            }
        } catch (_) {}
    }

    function saveTcOverlayPosition() {
        try {
            localStorage.setItem(
                LS_TC_OVERLAY_POS_KEY,
                JSON.stringify({
                    xRatio: tcOverlaySharedPos.xRatio,
                    bottomRatio: tcOverlaySharedPos.bottomRatio,
                    snapX: tcOverlaySharedPos.snapX,
                    snapY: tcOverlaySharedPos.snapY,
                    scale: getTcOverlayUserScale(),
                })
            );
        } catch (_) {}
    }

    function refreshTimecodeOverlayInteractive() {
        const el = getTcOverlayElement();
        if (!el) return;
        const show = videoReady();
        el.classList.toggle('video-timecode--hidden', !show);
        el.classList.toggle('video-timecode--draggable', show);
        if (!show) {
            setTcOverlaySnapClasses(el, false, false);
            updateTcCenterGuides();
            return;
        }
        ensureTcOverlayStructure(el);
        invalidateTcOverlayBaseMetrics();
        captureTcOverlayBaseMetrics();
        applyTcOverlayPosition();
        tryApplyPendingDefaultTcPosition();
        updateTcCenterGuides();
    }

    function onTcOverlayPointerDown(ev) {
        if (!videoReady() || ev.button !== 0) return;
        if (ev.target && ev.target.closest && ev.target.closest('.video-timecode__resize-handle')) return;
        const el = getTcOverlayElement();
        const frame = getTcOverlayFrame(el);
        if (!el || !frame || el.classList.contains('video-timecode--hidden')) return;
        ev.preventDefault();
        ev.stopPropagation();
        const er = el.getBoundingClientRect();
        tcOverlayDragState = {
            pointerId: ev.pointerId,
            frame: frame,
            el: el,
            grabOffsetX: ev.clientX - er.left,
            grabOffsetY: ev.clientY - er.top,
        };
        el.classList.add('video-timecode--dragging');
        try {
            el.setPointerCapture(ev.pointerId);
        } catch (_) {}
    }

    function onTcOverlayPointerMove(ev) {
        if (!tcOverlayDragState || ev.pointerId !== tcOverlayDragState.pointerId) return;
        const st = tcOverlayDragState;
        const fr = st.frame.getBoundingClientRect();
        const el = st.el;
        const t = tcOverlayTravelForFrame(st.frame, el);
        let left = ev.clientX - fr.left - st.grabOffsetX;
        let top = ev.clientY - fr.top - st.grabOffsetY;
        left = Math.max(0, Math.min(t.maxLeft, left));
        top = Math.max(0, Math.min(t.maxBottom, top));
        let bottom = t.fh - top - t.mh;

        const overlayCenterX = fr.left + left + t.mw / 2;
        const frameCenterX = fr.left + fr.width / 2;
        const snapX = Math.abs(overlayCenterX - frameCenterX) <= TC_OVERLAY_SNAP_X_PX;
        if (snapX) {
            left = Math.round(t.maxLeft / 2);
        }

        const overlayCenterY = fr.top + top + t.mh / 2;
        const frameCenterY = fr.top + fr.height / 2;
        const snapY = Math.abs(overlayCenterY - frameCenterY) <= TC_OVERLAY_SNAP_Y_PX;
        if (snapY) {
            bottom = Math.round(t.maxBottom / 2);
        }
        updateTcPosFromPixels(st.frame, el, left, bottom, snapX, snapY);
    }

    function onTcOverlayPointerUp(ev) {
        if (!tcOverlayDragState || ev.pointerId !== tcOverlayDragState.pointerId) return;
        const st = tcOverlayDragState;
        tcOverlayDragState = null;
        st.el.classList.remove('video-timecode--dragging');
        try {
            st.el.releasePointerCapture(ev.pointerId);
        } catch (_) {}
        updateTcCenterGuides();
        setTcOverlaySnapClasses(st.el, tcOverlaySharedPos.snapX, tcOverlaySharedPos.snapY);
        saveTcOverlayPosition();
    }

    function onTcResizePointerDown(ev) {
        if (!videoReady() || ev.button !== 0) return;
        const el = getTcOverlayElement();
        const frame = getTcOverlayFrame(el);
        if (!el || !frame || el.classList.contains('video-timecode--hidden')) return;
        ev.preventDefault();
        ev.stopPropagation();
        const er = el.getBoundingClientRect();
        const anchorX = er.left;
        const anchorY = er.bottom;
        const startDist = Math.max(12, Math.hypot(ev.clientX - anchorX, ev.clientY - anchorY));
        tcOverlayResizeState = {
            pointerId: ev.pointerId,
            frame: frame,
            el: el,
            anchorX: anchorX,
            anchorY: anchorY,
            startDist: startDist,
            startScale: getTcOverlayUserScale(),
        };
        el.classList.add('video-timecode--resizing');
        try {
            ev.target.setPointerCapture(ev.pointerId);
        } catch (_) {}
    }

    function onTcResizePointerMove(ev) {
        if (!tcOverlayResizeState || ev.pointerId !== tcOverlayResizeState.pointerId) return;
        const st = tcOverlayResizeState;
        const dist = Math.max(12, Math.hypot(ev.clientX - st.anchorX, ev.clientY - st.anchorY));
        tcOverlaySharedPos.scale = clampTcOverlayScale(st.startScale * (dist / st.startDist));
        applyTcOverlayAppearance();
        applyTcOverlayPosition();
        void st.el.offsetHeight;
    }

    function onTcResizePointerUp(ev) {
        if (!tcOverlayResizeState || ev.pointerId !== tcOverlayResizeState.pointerId) return;
        const st = tcOverlayResizeState;
        tcOverlayResizeState = null;
        st.el.classList.remove('video-timecode--resizing');
        try {
            ev.target.releasePointerCapture(ev.pointerId);
        } catch (_) {}
        saveTcOverlayPosition();
    }

    function setupTcOverlayInteraction() {
        const el = getTcOverlayElement();
        if (!el) return;
        ensureTcOverlayStructure(el);
        el.title =
            'Drag to move · resize with corner handle (snaps to center) · double-click: bottom-center ~10px · reset to default size';
        const parts = ensureTcOverlayStructure(el);
        el.addEventListener('pointerdown', onTcOverlayPointerDown);
        el.addEventListener('pointermove', onTcOverlayPointerMove);
        el.addEventListener('pointerup', onTcOverlayPointerUp);
        el.addEventListener('pointercancel', onTcOverlayPointerUp);
        el.addEventListener('dblclick', (ev) => {
            if (!videoReady() || el.classList.contains('video-timecode--hidden')) return;
            ev.preventDefault();
            ev.stopPropagation();
            resetTcOverlayToDefaultPosition();
            invalidateTcOverlayBaseMetrics();
            applyTcOverlayAppearance();
        });
        const handle = parts.handle;
        if (handle) {
            handle.addEventListener('pointerdown', onTcResizePointerDown);
            handle.addEventListener('pointermove', onTcResizePointerMove);
            handle.addEventListener('pointerup', onTcResizePointerUp);
            handle.addEventListener('pointercancel', onTcResizePointerUp);
        }
    }

    function initTimecodeOverlay() {
        loadTcOverlayPosition();
        if (frameMain) ensureTcCenterGuides(frameMain);
        setupTcOverlayInteraction();
        captureTcOverlayBaseMetrics();
        applyTcOverlayAppearance();
        applyTcOverlayPosition();
        refreshTimecodeOverlayInteractive();
        window.addEventListener('resize', () => {
            invalidateTcOverlayBaseMetrics();
            captureTcOverlayBaseMetrics();
            applyTcOverlayAppearance();
            applyTcOverlayPosition();
        });
    }
