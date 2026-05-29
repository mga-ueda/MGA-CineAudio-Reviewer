/**
 * markers-overlay.js — コメントオーバーレイ・表示切替・メモ。
 */
    function markerCommentOverlayTextEl(overlayEl) {
        if (!overlayEl) return null;
        return overlayEl.querySelector('.marker-comment-overlay__text');
    }

    function markerCommentHasDisplayText(comment) {
        return typeof comment === 'string' && comment.trim().length > 0;
    }

    function markerCommentStartSec(m) {
        if (!m) return null;
        if (m.type === 'range') return Number(m.startSec);
        return Number(m.timeSec);
    }

    /**
     * 点・範囲それぞれ独立に後着優先（表示時間が重なる／連続する場合は In が遅い方）。
     * In が同じときは一覧で後ろのマーカー（後から追加された方）を優先。
     */
    function findMarkerCommentHitForOverlayByType(t, type) {
        if (!markerTimelineReady() || !Number.isFinite(t)) return null;
        const wantPoint = type === 'point';
        const fadeDur = markerCommentFadeOutDurationSec();
        const holdSec = MARKER_COMMENT_POINT_HOLD_SEC;
        let best = null;
        let bestStart = -Infinity;
        let bestIdx = -1;
        for (let i = 0; i < currentMarkers.length; i++) {
            const m = currentMarkers[i];
            const isPoint = m.type !== 'range';
            if (wantPoint !== isPoint) continue;
            if (!markerCommentHasDisplayText(m.comment)) continue;
            let windowStart = null;
            let windowEnd = null;
            if (isPoint) {
                const start = Number(m.timeSec);
                if (!Number.isFinite(start)) continue;
                windowStart = start;
                windowEnd = start + holdSec + fadeDur;
            } else {
                const start = Number(m.startSec);
                const end = Number(m.endSec);
                if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
                windowStart = start;
                windowEnd = end + fadeDur;
            }
            if (t < windowStart || t >= windowEnd) continue;
            const sortStart = markerCommentStartSec(m);
            if (!Number.isFinite(sortStart)) continue;
            if (sortStart > bestStart || (sortStart === bestStart && i > bestIdx)) {
                bestStart = sortStart;
                bestIdx = i;
                best = { marker: m, text: m.comment };
            }
        }
        return best;
    }

    function markerCommentOverlayPhaseForHit(hit, t) {
        if (!hit || !hit.marker || !Number.isFinite(t)) return 'off';
        const m = hit.marker;
        const fadeDur = markerCommentFadeOutDurationSec();
        if (m.type === 'range') {
            const end = Number(m.endSec);
            if (!Number.isFinite(end)) return 'off';
            if (t <= end) return 'hold';
            if (t < end + fadeDur) return 'fade';
            return 'off';
        }
        const start = Number(m.timeSec);
        if (!Number.isFinite(start)) return 'off';
        const elapsed = t - start;
        if (elapsed < MARKER_COMMENT_POINT_HOLD_SEC) return 'hold';
        if (elapsed < MARKER_COMMENT_POINT_HOLD_SEC + fadeDur) return 'fade';
        return 'off';
    }

    function getMarkerCommentOverlayState(t, type) {
        const hit = findMarkerCommentHitForOverlayByType(t, type);
        if (!hit) return { hit: null, phase: 'off' };
        const phase = markerCommentOverlayPhaseForHit(hit, t);
        if (phase === 'off') return { hit: null, phase: 'off' };
        return { hit: hit, phase: phase };
    }

    function markerExportOpacityForOverlayState(state, t) {
        if (!state || !state.hit || state.phase === 'off') return 0;
        if (state.phase === 'hold') return 1;
        const m = state.hit.marker;
        const fadeDur = markerCommentFadeOutDurationSec();
        if (!Number.isFinite(fadeDur) || fadeDur <= 0) return 0;
        if (m.type === 'range') {
            const end = Number(m.endSec);
            if (!Number.isFinite(end)) return 0;
            return Math.max(0, 1 - (t - end) / fadeDur);
        }
        const start = Number(m.timeSec);
        if (!Number.isFinite(start)) return 0;
        const elapsed = t - start - MARKER_COMMENT_POINT_HOLD_SEC;
        return Math.max(0, 1 - elapsed / fadeDur);
    }

    /** Burn-in data for video export at transportSec (respects markers hidden). */
    function getVideoExportMarkerBurnIns(transportSec) {
        if (markersDisplayHidden || !markerTimelineReady() || !Number.isFinite(transportSec)) {
            return { point: null, range: null };
        }
        const t = transportSec;
        function pack(state, bottomPct, isRange) {
            if (!state.hit || state.phase === 'off') return null;
            const opacity = markerExportOpacityForOverlayState(state, t);
            if (opacity <= 0.001) return null;
            const text = markerCommentOverlayDisplayText(state.hit.text, isRange);
            if (!text) return null;
            return { text, opacity, bottomPct, isRange };
        }
        return {
            point: pack(
                getMarkerCommentOverlayState(t, 'point'),
                MARKER_VIDEO_COMMENT_POINT_BOTTOM_PCT,
                false,
            ),
            range: pack(
                getMarkerCommentOverlayState(t, 'range'),
                MARKER_VIDEO_COMMENT_RANGE_BOTTOM_PCT,
                true,
            ),
        };
    }

    function markerCommentOverlayDisplayText(text, isRange) {
        const raw = typeof text === 'string' ? text : '';
        if (!raw.trim()) return '';
        if (isRange) return '- ' + raw + ' -';
        return raw;
    }

    const MARKER_VIDEO_COMMENT_CENTER_LEFT_PCT = 50;
    /** 点マーカーコメント：画面下部中央（固定） */
    const MARKER_VIDEO_COMMENT_POINT_BOTTOM_PCT = 18;
    /** 範囲マーカーコメント：点より少し下（固定・表示の有無で位置は変えない） */
    const MARKER_VIDEO_COMMENT_RANGE_BOTTOM_PCT = 7;
    const MARKER_COMMENT_FADE_OUT_FRAMES = 30;
    const markerCommentOverlayFade = {
        point: { timerId: null, activeId: null, phase: 'hidden' },
        range: { timerId: null, activeId: null, phase: 'hidden' },
    };

    function markerCommentOverlaySlotKey(overlayEl) {
        if (overlayEl === markerCommentOverlayRange) return 'range';
        return 'point';
    }

    function markerCommentFadeOutDurationSec() {
        const fps =
            typeof masterFpsFloatForTransport === 'function'
                ? masterFpsFloatForTransport()
                : 24;
        return MARKER_COMMENT_FADE_OUT_FRAMES / Math.max(1, fps);
    }

    function cancelMarkerCommentFade(slotKey) {
        const st = markerCommentOverlayFade[slotKey];
        if (!st || st.timerId == null) return;
        clearTimeout(st.timerId);
        st.timerId = null;
    }

    function resetMarkerCommentOverlaySlotState(slotKey) {
        const st = markerCommentOverlayFade[slotKey];
        if (!st) return;
        cancelMarkerCommentFade(slotKey);
        st.activeId = null;
        st.phase = 'hidden';
    }

    function finishMarkerCommentOverlayHide(overlayEl, slotKey) {
        if (!overlayEl) return;
        const textEl = markerCommentOverlayTextEl(overlayEl);
        overlayEl.hidden = true;
        overlayEl.setAttribute('aria-hidden', 'true');
        overlayEl.style.removeProperty('opacity');
        overlayEl.style.removeProperty('transition');
        if (textEl) textEl.textContent = '';
        overlayEl.style.removeProperty('left');
        overlayEl.style.removeProperty('bottom');
        overlayEl.style.removeProperty('transform');
        if (slotKey) resetMarkerCommentOverlaySlotState(slotKey);
    }

    function showMarkerCommentOverlayImmediate(overlayEl, hit, layout) {
        if (!overlayEl || !hit || !markerCommentHasDisplayText(hit.text)) return;
        const textEl = markerCommentOverlayTextEl(overlayEl);
        const isRange =
            overlayEl.classList && overlayEl.classList.contains('marker-comment-overlay--range');
        overlayEl.hidden = false;
        overlayEl.setAttribute('aria-hidden', 'false');
        overlayEl.style.removeProperty('transition');
        overlayEl.style.opacity = '1';
        if (textEl) textEl.textContent = markerCommentOverlayDisplayText(hit.text, isRange);
        const leftPct =
            layout && Number.isFinite(layout.leftPct)
                ? layout.leftPct
                : MARKER_VIDEO_COMMENT_CENTER_LEFT_PCT;
        const defaultBottom =
            overlayEl === markerCommentOverlayRange
                ? MARKER_VIDEO_COMMENT_RANGE_BOTTOM_PCT
                : MARKER_VIDEO_COMMENT_POINT_BOTTOM_PCT;
        const bottomPct =
            layout && Number.isFinite(layout.bottomPct) ? layout.bottomPct : defaultBottom;
        overlayEl.style.left = leftPct + '%';
        overlayEl.style.bottom = bottomPct + '%';
        overlayEl.style.transform = 'translate(-50%, 0)';
    }

    function startMarkerCommentFadeOut(overlayEl, slotKey) {
        if (!overlayEl || !slotKey) return;
        const st = markerCommentOverlayFade[slotKey];
        if (!st || st.timerId != null) return;
        const durMs = Math.max(16, Math.round(markerCommentFadeOutDurationSec() * 1000));
        st.phase = 'fading';
        overlayEl.hidden = false;
        overlayEl.setAttribute('aria-hidden', 'true');
        overlayEl.style.transition = 'opacity ' + durMs + 'ms linear';
        overlayEl.style.opacity = '1';
        void overlayEl.offsetWidth;
        overlayEl.style.opacity = '0';
        st.timerId = setTimeout(() => {
            st.timerId = null;
            finishMarkerCommentOverlayHide(overlayEl, slotKey);
        }, durMs + 24);
    }

    function hideMarkerCommentOverlaySlot(overlayEl, slotKey, immediate) {
        if (!overlayEl || !slotKey) return;
        cancelMarkerCommentFade(slotKey);
        if (immediate) {
            finishMarkerCommentOverlayHide(overlayEl, slotKey);
            return;
        }
        const st = markerCommentOverlayFade[slotKey];
        if (st.phase === 'fading') return;
        if (st.activeId != null) {
            startMarkerCommentFadeOut(overlayEl, slotKey);
            return;
        }
        finishMarkerCommentOverlayHide(overlayEl, slotKey);
    }

    function syncMarkerCommentOverlaySlot(overlayEl, slotKey, overlayState, layout) {
        if (!overlayEl || !slotKey) return;
        const st = markerCommentOverlayFade[slotKey];
        const hit = overlayState.hit;
        const phase = overlayState.phase;
        const nextId = hit && hit.marker ? hit.marker.id : null;

        if (!hit || phase === 'off') {
            if (st.phase === 'fading') return;
            if (st.activeId != null && st.phase === 'hold') {
                startMarkerCommentFadeOut(overlayEl, slotKey);
                return;
            }
            if (st.activeId == null && !overlayEl.hidden) {
                finishMarkerCommentOverlayHide(overlayEl, slotKey);
            }
            return;
        }

        if (nextId !== st.activeId) {
            cancelMarkerCommentFade(slotKey);
            showMarkerCommentOverlayImmediate(overlayEl, hit, layout);
            st.activeId = nextId;
            if (phase === 'fade') {
                startMarkerCommentFadeOut(overlayEl, slotKey);
            } else {
                st.phase = 'hold';
            }
            return;
        }

        if (phase === 'hold') {
            if (st.phase === 'fading') cancelMarkerCommentFade(slotKey);
            showMarkerCommentOverlayImmediate(overlayEl, hit, layout);
            st.activeId = nextId;
            st.phase = 'hold';
            return;
        }

        if (phase === 'fade') {
            if (st.phase === 'hold') {
                startMarkerCommentFadeOut(overlayEl, slotKey);
            } else if (st.phase === 'hidden') {
                showMarkerCommentOverlayImmediate(overlayEl, hit, layout);
                st.activeId = nextId;
                startMarkerCommentFadeOut(overlayEl, slotKey);
            }
        }
    }

    function updateMarkerCommentOverlay() {
        if (!markerCommentOverlayPoint && !markerCommentOverlayRange) return;
        if (markersDisplayHidden) {
            hideMarkerCommentOverlaySlot(markerCommentOverlayPoint, 'point', true);
            hideMarkerCommentOverlaySlot(markerCommentOverlayRange, 'range', true);
            if (!isMarkerListPlaybackActive()) {
                updateMarkerListRowClasses();
            }
            return;
        }
        if (!markerTimelineReady()) {
            hideMarkerCommentOverlaySlot(markerCommentOverlayPoint, 'point', true);
            hideMarkerCommentOverlaySlot(markerCommentOverlayRange, 'range', true);
            return;
        }
        const t = currentTransportSec();
        updateTransportMarkerHighlight(t);
        if (!isMarkerListPlaybackActive()) {
            updateMarkerListRowClasses();
        }
        syncMarkerCommentOverlaySlot(
            markerCommentOverlayPoint,
            'point',
            getMarkerCommentOverlayState(t, 'point'),
            {
                leftPct: MARKER_VIDEO_COMMENT_CENTER_LEFT_PCT,
                bottomPct: MARKER_VIDEO_COMMENT_POINT_BOTTOM_PCT,
            },
        );
        syncMarkerCommentOverlaySlot(
            markerCommentOverlayRange,
            'range',
            getMarkerCommentOverlayState(t, 'range'),
            {
                leftPct: MARKER_VIDEO_COMMENT_CENTER_LEFT_PCT,
                bottomPct: MARKER_VIDEO_COMMENT_RANGE_BOTTOM_PCT,
            },
        );
    }

    function markerVideoSecForTransportSec(transportSec) {
        if (!Number.isFinite(transportSec)) return 0;
        if (typeof videoReady === 'function' && !videoReady()) {
            return transportSec;
        }
        return typeof videoSecForTransportSec === 'function'
            ? videoSecForTransportSec(transportSec)
            : transportSec;
    }

    /** マーカー欄 TC は動画焼き込み TC（映像位置）と一致させる。 */
    function tcLabelForSec(transportSec) {
        return formatTimecodeForSide(markerVideoSecForTransportSec(transportSec), 'main');
    }

    function markerTimeLabel(m) {
        if (m.type === 'range') {
            return tcLabelForSec(m.startSec) + ' – ' + tcLabelForSec(m.endSec);
        }
        return tcLabelForSec(m.timeSec);
    }

    function markerRangeLengthFrames(m) {
        if (m.type !== 'range') return 0;
        const startIdx = playbackFrameIndexForSide(m.startSec, 'main');
        const endIdx = playbackFrameIndexForSide(m.endSec, 'main');
        return Math.max(0, endIdx - startIdx);
    }

    function markerDurationLabel(m) {
        if (m.type !== 'range') return '—';
        const frames = markerRangeLengthFrames(m);
        const span = Math.max(0, m.endSec - m.startSec);
        if (span < 1) return frames + 'f';
        const s = span.toFixed(2).replace(/\.?0+$/, '');
        return s + 's / ' + frames + 'f';
    }

    function markerTcSecForEdge(m, edge) {
        if (!m) return null;
        if (m.type === 'range') return edge === 'in' ? m.startSec : m.endSec;
        return edge === 'in' ? m.timeSec : null;
    }

    /** マーカー一覧行の In/Out TC 文字列（モデルから直接） */
    function markerListRowTcInValue(m) {
        return markerListRowTcValueForEdge(m, 'in');
    }

    function markerListRowTcOutValue(m) {
        return markerListRowTcValueForEdge(m, 'out');
    }

    function markerListRowTcValueForEdge(m, edge) {
        if (!m) return '';
        if (edge === 'out') {
            return m.type === 'range' ? tcLabelForSec(m.endSec) : '';
        }
        const sec = markerTcSecForEdge(m, edge);
        return sec != null ? tcLabelForSec(sec) : '';
    }

    function markerListRowDurationCell(m) {
        return {
            text: markerDurationLabel(m),
            className:
                m && m.type === 'range'
                    ? 'marker-table__dur'
                    : 'marker-table__dur marker-table__dur--empty',
        };
    }

    function masterDurForTimelineMarkers() {
        let dur = 0;
        if (typeof getMasterTransportDurationSec === 'function') {
            dur = getMasterTransportDurationSec();
        }
        if (!dur || dur <= 0) {
            dur = getDuration(videoMain);
        }
        if (currentMarkers.length > 0) {
            let markerMax = 0;
            for (const m of currentMarkers) {
                if (m.type === 'range') {
                    markerMax = Math.max(
                        markerMax,
                        Number(m.startSec),
                        Number(m.endSec),
                    );
                } else {
                    markerMax = Math.max(markerMax, Number(m.timeSec));
                }
            }
            if (Number.isFinite(markerMax) && markerMax > 0) {
                const floor = markerMax + Math.max(markerOneFrameSec(), 0.04);
                if (dur <= 0.01 + 1e-6 || floor > dur) {
                    dur = Math.max(dur, floor);
                }
            }
        }
        return dur > 0 ? dur : 0;
    }

    let markersLayoutRefreshTimer = null;

    /** レーン配置確定後にマーカー UI を再描画（音声のみセッション復元直後・Chrome 向けに複数回） */
    function scheduleMarkersUiRefreshAfterLayout() {
        if (markersLayoutRefreshTimer != null) {
            clearTimeout(markersLayoutRefreshTimer);
            markersLayoutRefreshTimer = null;
        }
        const run = () => {
            if (typeof ensureMarkersRestoredFromSession === 'function') {
                ensureMarkersRestoredFromSession();
            }
            flushPendingSessionMarkersRestore();
            if (isMarkerTcInputFocused()) {
                renderSeekBarMarkers();
                updateMarkerRangeHint();
            } else {
                refreshMarkerUi();
            }
            if (typeof syncAudioOnlyMarkersUi === 'function') {
                syncAudioOnlyMarkersUi();
            }
            if (typeof updateSessionAllClearButton === 'function') {
                updateSessionAllClearButton();
            }
        };
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        run();
        requestAnimationFrame(() => {
            requestAnimationFrame(run);
        });
        [50, 200, 600].forEach((ms) => {
            setTimeout(run, ms);
        });
        markersLayoutRefreshTimer = setTimeout(() => {
            markersLayoutRefreshTimer = null;
            run();
        }, 1200);
    }

    window.scheduleMarkersUiRefreshAfterLayout = scheduleMarkersUiRefreshAfterLayout;

    function secToSeekRatio(sec, dur) {
        if (!dur || dur <= 0) return 0;
        return Math.max(0, Math.min(100, (sec / dur) * 100));
    }

    function updateMarkerRangeHint() {
        if (markerRangeHint) markerRangeHint.hidden = true;
        updateMarkerClearAllButton();
    }

    function getCurrentMarkerMemoText() {
        if (markerMemoTextarea && typeof markerMemoTextarea.value === 'string') {
            return markerMemoTextarea.value;
        }
        return currentMarkerMemo || '';
    }

    function syncMarkerMemoTextarea() {
        if (!markerMemoTextarea) return;
        const ready = markerTimelineReady();
        markerMemoTextarea.disabled = !ready;
        if (document.activeElement !== markerMemoTextarea) {
            markerMemoTextarea.value = currentMarkerMemo || '';
        }
    }

    function setMarkerMemoText(text, opt) {
        currentMarkerMemo = String(text ?? '');
        if (!(opt && opt.skipTextareaSync)) {
            syncMarkerMemoTextarea();
        }
    }

    function saveMarkerMemoToCache() {
        const k = getVideoMarkerKey() || resolveMarkerCacheKey();
        if (k) markerMemoByVideoKey.set(k, currentMarkerMemo);
    }

    function getMarkerMemoSnapshot() {
        return getCurrentMarkerMemoText();
    }

    window.getMarkerMemoSnapshot = getMarkerMemoSnapshot;

    function hasMarkerMemoText() {
        return !!String(getCurrentMarkerMemoText() || '').trim();
    }

    function hasMarkerContentToClear() {
        if (currentMarkers.length > 0 || pendingRangeStartSec != null) return true;
        if (hasMarkerMemoText()) return true;
        if (
            sessionMarkerMemoRestorePayload &&
            String(sessionMarkerMemoRestorePayload).trim()
        ) {
            return true;
        }
        return hasSessionMarkersPendingRestore();
    }

    window.hasMarkerContentToClear = hasMarkerContentToClear;

    function markerTimelineReady() {
        return (
            typeof transportControlsReady === 'function' && transportControlsReady()
        );
    }

    function hideMarkersVisualLayers() {
        if (audioWaveformMarkers) {
            audioWaveformMarkers.replaceChildren();
            audioWaveformMarkers.style.display = 'none';
            audioWaveformMarkers.hidden = true;
        }
        const labelLayer = markerLabelsLayerEl();
        if (labelLayer) {
            labelLayer.replaceChildren();
            labelLayer.hidden = true;
        }
        if (markerCommentOverlayPoint) {
            hideMarkerCommentOverlaySlot(markerCommentOverlayPoint, 'point', true);
        }
        if (markerCommentOverlayRange) {
            hideMarkerCommentOverlaySlot(markerCommentOverlayRange, 'range', true);
        }
    }

    /** セッション復元・インポート後など、表示を既定（表示）に戻す */
    function resetMarkersDisplayHidden() {
        if (!markersDisplayHidden) {
            updateMarkerHideViewButton();
            return;
        }
        markersDisplayHidden = false;
        applyMarkersDisplayVisibility();
        updateMarkerHideViewButton();
    }

    function areMarkersHiddenOnTimeline() {
        return !!markersDisplayHidden;
    }

    function hasVisibleMarkersOnTimeline() {
        return !markersDisplayHidden && currentMarkers.length > 0;
    }

    window.resetMarkersDisplayHidden = resetMarkersDisplayHidden;
    window.areMarkersHiddenOnTimeline = areMarkersHiddenOnTimeline;
    window.hasVisibleMarkersOnTimeline = hasVisibleMarkersOnTimeline;
    function getMarkerCommentBurnInMetrics(exportCanvasH, isRange) {
        const overlay = isRange ? markerCommentOverlayRange : markerCommentOverlayPoint;
        const textEl = markerCommentOverlayTextEl(overlay);
        const frame = typeof frameMain !== 'undefined' ? frameMain : null;
        const video = typeof videoMain !== 'undefined' ? videoMain : null;
        let layoutScale = 1;
        if (typeof getVideoExportLayoutScale === 'function') {
            layoutScale = getVideoExportLayoutScale(exportCanvasH);
        } else if (frame && frame.clientHeight > 0) {
            layoutScale = exportCanvasH / frame.clientHeight;
        }
        let fontPx = Math.max(12, Math.round(14 * layoutScale));
        let lineHeightRatio = 1.3;
        let strokePx = Math.max(1, 1.5 * layoutScale);
        if (textEl) {
            const cs = getComputedStyle(textEl);
            const parsed = parseFloat(cs.fontSize);
            if (Number.isFinite(parsed) && parsed > 0) fontPx = Math.max(10, Math.round(parsed * layoutScale));
            const lh = parseFloat(cs.lineHeight);
            if (Number.isFinite(lh) && lh > 0 && fontPx > 0) {
                lineHeightRatio = lh / (parsed || fontPx / layoutScale);
            }
            strokePx = Math.max(1, 1.5 * layoutScale);
        }
        return {
            fontPx,
            lineHeightRatio,
            strokePx,
            layoutScale,
        };
    }

    window.getVideoExportMarkerBurnIns = getVideoExportMarkerBurnIns;
    window.getMarkerCommentBurnInMetrics = getMarkerCommentBurnInMetrics;

    function isWaveformMarkerHighlightEnabled() {
        return !markersDisplayHidden;
    }

    function clearWaveformMarkerHighlightState() {
        let changed = false;
        if (waveformMarkerHoverId != null) {
            waveformMarkerHoverId = null;
            changed = true;
        }
        if (transportMarkerHighlightId != null) {
            transportMarkerHighlightId = null;
            changed = true;
        }
        lastTransportSecForMarkerHighlight = null;
        resetMarkerHighlightCrossQueue();
        if (changed) {
            updateMarkerListRowClasses();
        }
    }

    function applyMarkersDisplayVisibility() {
        if (markerPanel) {
            markerPanel.classList.toggle('marker-panel--markers-hidden', markersDisplayHidden);
        }
        if (markersDisplayHidden) {
            hideMarkersVisualLayers();
            clearWaveformMarkerHighlightState();
            return;
        }
        renderSeekBarMarkers();
        updateMarkerCommentOverlay();
    }

    function setMarkersDisplayHidden(hidden) {
        const next = !!hidden;
        if (markersDisplayHidden === next) {
            updateMarkerHideViewButton();
            return;
        }
        markersDisplayHidden = next;
        applyMarkersDisplayVisibility();
        updateMarkerHideViewButton();
        writeLog(
            markersDisplayHidden
                ? 'Markers: hidden on timeline'
                : 'Markers: shown on timeline',
        );
    }

    function toggleMarkersDisplayHidden() {
        if (currentMarkers.length === 0) return;
        setMarkersDisplayHidden(!markersDisplayHidden);
    }

    function updateMarkerHideViewButton() {
        if (!markerHideViewBtn) return;
        const hasMarkers = currentMarkers.length > 0;
        markerHideViewBtn.textContent = markersDisplayHidden ? 'View' : 'Hide';
        const hintV =
            typeof window.SHORTCUT_HINTS !== 'undefined' && window.SHORTCUT_HINTS.markerHide
                ? window.SHORTCUT_HINTS.markerHide
                : 'V';
        markerHideViewBtn.title = hasMarkers
            ? markersDisplayHidden
                ? 'タイムラインと映像上のマーカーを表示（' + hintV + '）'
                : 'タイムラインと映像上のマーカーを非表示（' + hintV + '）'
            : 'マーカーを追加すると Hide/View が使えます';
        markerHideViewBtn.setAttribute(
            'aria-pressed',
            markersDisplayHidden ? 'true' : 'false',
        );
        markerHideViewBtn.disabled = !hasMarkers;
    }

    function updateMarkerClearAllButton() {
        const timelineReady = markerTimelineReady();
        if (markerPanel) {
            markerPanel.classList.toggle('marker-panel--ready', timelineReady);
        }
        if (markerClearAllBtn) {
            markerClearAllBtn.disabled = !(timelineReady && hasMarkerContentToClear());
        }
        if (markerCopyBtn) {
            markerCopyBtn.disabled = !(
                timelineReady &&
                (currentMarkers.length > 0 || hasMarkerMemoText())
            );
        }
        syncMarkerMemoTextarea();
        if (markerPasteBtn) {
            markerPasteBtn.disabled = !timelineReady;
        }
        updateMarkerHideViewButton();
    }

    /** タブ区切りコピー用: セル内のタブ・改行を正規化 */
