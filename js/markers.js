    // マーカー（点・範囲）とコメント、表一覧・シークバー表示
    const markersByVideoKey = new Map();
    let currentMarkers = [];
    let pendingRangeStartSec = null;
    let activeMarkerId = null;
    /** In/Out 列ホバー・シークでどちらの TC を +/- 対象にするか（フォーカスが In のままのとき Out を直す） */
    let markerActiveTcEdge = 'in';
    let markerIdSeq = 0;
    /** renderMarkerList 直後など、ホバーシークが誤って元位置へ戻すのを防ぐ */
    let suppressMarkerRowHoverSeekUntil = 0;
    const MARKER_COMMENT_POINT_HOLD_SEC = 1;

    function nextMarkerId() {
        markerIdSeq += 1;
        return 'm' + Date.now().toString(36) + '_' + markerIdSeq;
    }

    const MARKER_SESSION_AUDIO_ONLY_KEY = '\0mga-marker-session-audio-only';

    function getVideoMarkerKey() {
        if (fileMain) {
            return String(fileMain.name) + '\0' + String(fileMain.lastModified);
        }
        if (
            typeof hasPlayableWaveformTimeline === 'function' &&
            hasPlayableWaveformTimeline()
        ) {
            return MARKER_SESSION_AUDIO_ONLY_KEY;
        }
        return null;
    }

    /** 復元直後など、波形タイムライン未準備でもセッション付きマーカーを紐づける */
    function resolveMarkerCacheKey(savedFromSession) {
        if (fileMain) {
            return String(fileMain.name) + '\0' + String(fileMain.lastModified);
        }
        const k = getVideoMarkerKey();
        if (k) return k;
        if (Array.isArray(savedFromSession) && savedFromSession.length > 0) {
            return MARKER_SESSION_AUDIO_ONLY_KEY;
        }
        const cached = markersByVideoKey.get(MARKER_SESSION_AUDIO_ONLY_KEY);
        if (cached && cached.length > 0) {
            return MARKER_SESSION_AUDIO_ONLY_KEY;
        }
        return null;
    }

    let pendingSessionMarkersForRestore = null;

    function flushPendingSessionMarkersRestore() {
        if (pendingSessionMarkersForRestore) {
            const snap = pendingSessionMarkersForRestore;
            pendingSessionMarkersForRestore = null;
            loadMarkersForCurrentVideo(snap);
            return;
        }
        const k = getVideoMarkerKey();
        if (!k || currentMarkers.length > 0) return;
        if (markersByVideoKey.has(k)) {
            loadMarkersForCurrentVideo();
        }
    }

    window.flushPendingSessionMarkersRestore = flushPendingSessionMarkersRestore;

    function adoptMarkersForAudioOnlySession() {
        if (!currentMarkers.length) {
            const cached = markersByVideoKey.get(MARKER_SESSION_AUDIO_ONLY_KEY);
            if (cached && cached.length > 0) {
                currentMarkers = cached.map(cloneMarker).filter(Boolean);
                sortMarkersInPlace();
            }
        }
        if (!currentMarkers.length) {
            flushPendingSessionMarkersRestore();
            if (!currentMarkers.length) return;
        }
        const snap = getMarkersSnapshot();
        markersByVideoKey.set(MARKER_SESSION_AUDIO_ONLY_KEY, snap);
        currentMarkers = snap.map(cloneMarker).filter(Boolean);
        sortMarkersInPlace();
        renderMarkerList();
        renderSeekBarMarkers();
        updateMarkerRangeHint();
        updateMarkerCommentOverlay();
    }

    window.adoptMarkersForAudioOnlySession = adoptMarkersForAudioOnlySession;

    function cloneMarker(m) {
        if (!m || typeof m !== 'object') return null;
        const c = {
            id: String(m.id || nextMarkerId()),
            type: m.type === 'range' ? 'range' : 'point',
            comment: typeof m.comment === 'string' ? m.comment : '',
        };
        if (c.type === 'range') {
            c.startSec = Number(m.startSec);
            c.endSec = Number(m.endSec);
            if (!Number.isFinite(c.startSec)) c.startSec = 0;
            if (!Number.isFinite(c.endSec)) c.endSec = c.startSec;
        } else {
            c.timeSec = Number(m.timeSec);
            if (!Number.isFinite(c.timeSec)) c.timeSec = 0;
        }
        return c;
    }

    function normalizeMarker(m) {
        const c = cloneMarker(m);
        if (!c) return null;
        if (c.type === 'range' && c.endSec < c.startSec) {
            const t = c.startSec;
            c.startSec = c.endSec;
            c.endSec = t;
        }
        return c;
    }

    function getMarkersSnapshot() {
        return currentMarkers.map((m) => {
            if (m.type === 'range') {
                return {
                    id: m.id,
                    type: 'range',
                    startSec: m.startSec,
                    endSec: m.endSec,
                    comment: m.comment || '',
                };
            }
            return {
                id: m.id,
                type: 'point',
                timeSec: m.timeSec,
                comment: m.comment || '',
            };
        });
    }

    function setMarkersFromSnapshot(arr) {
        if (!Array.isArray(arr)) {
            currentMarkers = [];
        } else {
            currentMarkers = arr.map(normalizeMarker).filter(Boolean);
        }
        normalizeAllMarkerRanges({ silent: true });
        sortMarkersInPlace();
        saveMarkersToCache();
        renderMarkerList();
        renderSeekBarMarkers();
        updateMarkerRangeHint();
        updateMarkerCommentOverlay();
    }

    function saveMarkersToCache() {
        const k = getVideoMarkerKey();
        if (k) markersByVideoKey.set(k, getMarkersSnapshot());
    }

    function applyMarkersSnapshotToMemory(arr, cacheKey) {
        if (!Array.isArray(arr)) {
            currentMarkers = [];
            return;
        }
        currentMarkers = arr.map(normalizeMarker).filter(Boolean);
        sortMarkersInPlace();
        const k =
            cacheKey ||
            resolveMarkerCacheKey(arr) ||
            MARKER_SESSION_AUDIO_ONLY_KEY;
        if (k) markersByVideoKey.set(k, getMarkersSnapshot());
        pendingSessionMarkersForRestore = null;
    }

    /** セッション行の markers をメモリへ（音声のみ復元の本命パス） */
    function restoreMarkersFromSessionRow(row) {
        const arr =
            row && Array.isArray(row.markers) && row.markers.length > 0
                ? row.markers
                : null;
        if (!arr) return false;
        applyMarkersSnapshotToMemory(arr, MARKER_SESSION_AUDIO_ONLY_KEY);
        renderMarkerList();
        renderSeekBarMarkers();
        updateMarkerRangeHint();
        updateMarkerCommentOverlay();
        return true;
    }

    window.restoreMarkersFromSessionRow = restoreMarkersFromSessionRow;

    function loadMarkersForCurrentVideo(savedFromSession) {
        pendingRangeStartSec = null;
        activeMarkerId = null;
        const k = resolveMarkerCacheKey(savedFromSession);
        if (!k) {
            if (Array.isArray(savedFromSession) && savedFromSession.length > 0) {
                pendingSessionMarkersForRestore = savedFromSession;
                applyMarkersSnapshotToMemory(
                    savedFromSession,
                    MARKER_SESSION_AUDIO_ONLY_KEY,
                );
            } else {
                pendingSessionMarkersForRestore = null;
                currentMarkers = [];
            }
            renderMarkerList();
            renderSeekBarMarkers();
            updateMarkerRangeHint();
            updateMarkerCommentOverlay();
            return;
        }
        pendingSessionMarkersForRestore = null;
        if (Array.isArray(savedFromSession)) {
            currentMarkers = savedFromSession.map(normalizeMarker).filter(Boolean);
            markersByVideoKey.set(k, getMarkersSnapshot());
        } else if (markersByVideoKey.has(k)) {
            currentMarkers = markersByVideoKey.get(k).map(cloneMarker).filter(Boolean);
        } else {
            currentMarkers = [];
        }
        sortMarkersInPlace();
        renderMarkerList();
        renderSeekBarMarkers();
        updateMarkerRangeHint();
        updateMarkerCommentOverlay();
    }

    function sortMarkersInPlace() {
        currentMarkers.sort((a, b) => {
            const ta = a.type === 'range' ? a.startSec : a.timeSec;
            const tb = b.type === 'range' ? b.startSec : b.timeSec;
            return ta - tb;
        });
    }

    function currentTransportSec() {
        if (typeof getTransportSec === 'function') return getTransportSec();
        if (typeof videoReady === 'function' && videoReady()) {
            return videoMain.currentTime || 0;
        }
        return 0;
    }

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
        if (!markerTimelineReady()) {
            hideMarkerCommentOverlaySlot(markerCommentOverlayPoint, 'point', true);
            hideMarkerCommentOverlaySlot(markerCommentOverlayRange, 'range', true);
            return;
        }
        const t = currentTransportSec();
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
            flushPendingSessionMarkersRestore();
            if (isMarkerTcInputFocused()) {
                renderSeekBarMarkers();
                updateMarkerRangeHint();
                return;
            }
            refreshMarkerUi();
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
        if (!markerRangeHint) return;
        if (pendingRangeStartSec != null && Number.isFinite(pendingRangeStartSec)) {
            markerRangeHint.hidden = false;
            markerRangeHint.textContent =
                'Range In: ' +
                tcLabelForSec(pendingRangeStartSec) +
                ' — press ] for Out (Esc to cancel)';
        } else {
            markerRangeHint.hidden = true;
        }
        updateMarkerClearAllButton();
    }

    function hasMarkerContentToClear() {
        return currentMarkers.length > 0 || pendingRangeStartSec != null;
    }

    window.hasMarkerContentToClear = hasMarkerContentToClear;

    function markerTimelineReady() {
        return (
            typeof transportControlsReady === 'function' && transportControlsReady()
        );
    }

    function updateMarkerClearAllButton() {
        if (!markerClearAllBtn) return;
        const canClear = markerTimelineReady() && hasMarkerContentToClear();
        markerClearAllBtn.disabled = !canClear;
    }

    function clearAllMarkers() {
        if (!hasMarkerContentToClear()) {
            writeLog('Marker: nothing to clear');
            return;
        }
        const n = currentMarkers.length;
        pendingRangeStartSec = null;
        activeMarkerId = null;
        currentMarkers = [];
        const k = getVideoMarkerKey();
        if (k) markersByVideoKey.set(k, []);
        persistMarkersAfterChange();
        writeLog('Marker: all cleared (' + n + ' item(s))');
        flashSeekHint('Markers', 'Cleared', 'notice');
    }

    function cancelPendingRange() {
        if (pendingRangeStartSec == null) return false;
        pendingRangeStartSec = null;
        updateMarkerRangeHint();
        renderSeekBarMarkers();
        writeLog('Marker: range IN cancelled');
        flashSeekHint('Range', 'Cancelled', 'notice');
        return true;
    }

    function clearActiveMarkerTarget() {
        const hadActive = activeMarkerId != null;
        const ae = document.activeElement;
        const inComment =
            ae && ae.closest && ae.closest('.marker-table__comment');
        activeMarkerId = null;
        if (inComment && ae.blur) ae.blur();
        refreshMarkerUi();
        if (hadActive || inComment) {
            writeLog('Marker: target cleared (Esc)');
            flashSeekHint('Marker', 'None', 'notice');
        }
        return hadActive || inComment;
    }

    function isMarkerAreaKeyboardActive(opt) {
        const inPanel = (el) =>
            el && el.nodeType === 1 && el.closest && el.closest('#markerPanel');
        if (inPanel(opt && opt.target)) return true;
        return inPanel(document.activeElement);
    }

    window.isMarkerAreaKeyboardActive = isMarkerAreaKeyboardActive;

    function handleMarkerEscapeKeydown(e) {
        if (e.code !== 'Escape' || e.ctrlKey || e.altKey || e.metaKey) return false;
        if (e.repeat) return false;

        if (pendingRangeStartSec != null) {
            cancelPendingRange();
            e.preventDefault();
            return true;
        }

        const el = e.target;
        const inMarkerPanel = isMarkerAreaKeyboardActive({ target: el });
        const inComment = el && el.closest && el.closest('.marker-table__comment');
        const hadActive = activeMarkerId != null;

        if (!hadActive && !inComment && !inMarkerPanel) return false;

        if (clearActiveMarkerTarget()) {
            e.preventDefault();
            return true;
        }
        return false;
    }

    function persistMarkersAfterChange(opt) {
        normalizeAllMarkerRanges({ silent: true });
        sortMarkersInPlace();
        saveMarkersToCache();
        if (!(opt && opt.skipMarkerList) && !isMarkerTcInputFocused()) {
            renderMarkerList();
        }
        renderSeekBarMarkers();
        if (typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        if (!(opt && opt.skipSessionFlush) && typeof flushPersistSessionNow === 'function') {
            void flushPersistSessionNow().catch(() => {});
        }
    }

    function addPointMarkerAtSec(sec) {
        const t = Math.max(0, sec);
        const m = {
            id: nextMarkerId(),
            type: 'point',
            timeSec: t,
            comment: '',
        };
        currentMarkers.push(m);
        sortMarkersInPlace();
        activeMarkerId = m.id;
        persistMarkersAfterChange();
        writeLog('Marker: point at ' + tcLabelForSec(t));
        flashSeekHint('Marker', tcLabelForSec(t), 'notice');
    }

    function addPointMarkerAtCurrentTime() {
        if (!markerTimelineReady()) {
            writeLog('Marker: load a video first');
            return;
        }
        addPointMarkerAtSec(currentTransportSec());
    }

    function beginPendingRangeAtCurrentTime() {
        if (!markerTimelineReady()) {
            writeLog('Marker: load a video first');
            return;
        }
        const t = currentTransportSec();
        pendingRangeStartSec = t;
        updateMarkerRangeHint();
        updateMarkerClearAllButton();
        renderSeekBarMarkers();
        writeLog('Marker: range In at ' + tcLabelForSec(t));
        flashSeekHint('Range In', tcLabelForSec(t), 'notice');
    }

    function completePendingRangeAtCurrentTime() {
        if (!markerTimelineReady() || pendingRangeStartSec == null) return;
        const t = currentTransportSec();
        let start = pendingRangeStartSec;
        let end = t;
        pendingRangeStartSec = null;
        updateMarkerRangeHint();
        if (end < start) {
            const swap = start;
            start = end;
            end = swap;
        }
        const oneFrame = markerOneFrameSec();
        const span = end - start;
        const m =
            span > oneFrame + 1e-9
                ? {
                      id: nextMarkerId(),
                      type: 'range',
                      startSec: start,
                      endSec: end,
                      comment: '',
                  }
                : {
                      id: nextMarkerId(),
                      type: 'point',
                      timeSec: clampMarkerSec(start),
                      comment: '',
                  };
        currentMarkers.push(m);
        sortMarkersInPlace();
        activeMarkerId = m.id;
        persistMarkersAfterChange();
        writeLog('Marker: range ' + tcLabelForSec(start) + ' – ' + tcLabelForSec(end));
        flashSeekHint('Range', tcLabelForSec(start) + ' – ' + tcLabelForSec(end), 'notice');
    }

    function clampMarkerSec(sec) {
        const dur = masterDurForTimelineMarkers();
        if (!dur || dur <= 0) return 0;
        return Math.max(0, Math.min(dur - 0.001, sec));
    }

    function markerOneFrameSec() {
        const fps = Math.max(1, masterFpsFloatForTransport());
        return 1 / fps;
    }

    /** Out が In 以前（同時刻含む）なら点マーカーへ（Out 削除と同義） */
    function collapseRangeMarkerToPointIfNarrow(m, opt) {
        if (!m || m.type !== 'range') return false;
        const start = Number(m.startSec);
        const end = Number(m.endSec);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
        if (end > start + 1e-9) return false;
        const t = clampMarkerSec(start);
        m.type = 'point';
        m.timeSec = t;
        delete m.startSec;
        delete m.endSec;
        if (!(opt && opt.silent)) {
            writeLog('Marker: range collapsed to point at ' + tcLabelForSec(t));
        }
        return true;
    }

    function normalizeAllMarkerRanges(opt) {
        let changed = false;
        for (let i = 0; i < currentMarkers.length; i++) {
            if (collapseRangeMarkerToPointIfNarrow(currentMarkers[i], { silent: true })) {
                changed = true;
            }
        }
        if (changed && !(opt && opt.silent)) {
            sortMarkersInPlace();
        }
        return changed;
    }

    function transportSecFromWaveformClientX(clientX) {
        if (typeof transportSecFromClientX === 'function') {
            return transportSecFromClientX(clientX);
        }
        const dur = masterDurForTimelineMarkers();
        if (typeof transportRatioFromClientX === 'function') {
            return transportRatioFromClientX(clientX) * dur;
        }
        return 0;
    }

    function transportSecFromPlaybackFrameIndex(targetIdx) {
        if (!markerTimelineReady()) return null;
        const dur = masterDurForTimelineMarkers();
        if (!dur || dur <= 0) return 0;
        if (typeof videoReady === 'function' && videoReady()) {
            const durVideo = getDuration(videoMain);
            if (durVideo > 0) {
                let lo = 0;
                let hi = durVideo - 0.001;
                for (let i = 0; i < 48; i++) {
                    const mid = (lo + hi) * 0.5;
                    if (playbackFrameIndexForSide(mid, 'main') < targetIdx) lo = mid;
                    else hi = mid;
                }
                let sec = hi;
                if (playbackFrameIndexForSide(sec, 'main') < targetIdx) {
                    sec = Math.min(durVideo - 0.001, sec + masterFrameSec);
                }
                const videoSec = Math.max(0, Math.min(durVideo - 0.001, sec));
                return typeof audioSecFromVideoSec === 'function'
                    ? audioSecFromVideoSec(videoSec)
                    : videoSec;
            }
        }
        let lo = 0;
        let hi = dur - 0.001;
        const fps = masterFpsFloatForTransport();
        for (let i = 0; i < 48; i++) {
            const mid = (lo + hi) * 0.5;
            if (linearFrameIndexFromSec(mid, fps) < targetIdx) lo = mid;
            else hi = mid;
        }
        let sec = hi;
        if (linearFrameIndexFromSec(sec, fps) < targetIdx) {
            sec = Math.min(dur - 0.001, sec + masterFrameSec);
        }
        return Math.max(0, Math.min(dur - 0.001, sec));
    }

    function transportSecFromMarkerTcString(tcStr) {
        if (!markerTimelineReady()) return null;
        const targetIdx = parseTimecodeStringToClipFrameIndex(
            String(tcStr || '').trim(),
            masterFpsFloatForTransport(),
        );
        if (targetIdx == null || !Number.isFinite(targetIdx)) return null;
        return transportSecFromPlaybackFrameIndex(targetIdx);
    }

    function applyMarkerOutFrameOffset(markerId, frameDelta) {
        const m = currentMarkers.find((x) => x.id === markerId);
        if (!m || !markerTimelineReady() || !Number.isFinite(frameDelta)) return false;
        const inIdx = playbackFrameIndexForSide(
            markerVideoSecForTransportSec(markerInSec(m)),
            'main',
        );
        const outIdx = clampFrameIndexToClip(inIdx + frameDelta, 'main');
        const startSec = transportSecFromPlaybackFrameIndex(inIdx);
        const endSec = transportSecFromPlaybackFrameIndex(outIdx);
        if (startSec == null || endSec == null) return false;
        if (m.type === 'point') {
            m.type = 'range';
            delete m.timeSec;
        }
        m.startSec = startSec;
        m.endSec = endSec;
        if (m.endSec < m.startSec) {
            const swap = m.startSec;
            m.startSec = m.endSec;
            m.endSec = swap;
        }
        sortMarkersInPlace();
        activeMarkerId = m.id;
        persistMarkersAfterChange();
        writeLog(
            'Marker: Out ' +
                (frameDelta >= 0 ? '+' : '') +
                frameDelta +
                'f -> ' +
                markerTimeLabel(m)
        );
        flashSeekHint('Range Out', tcLabelForSec(m.endSec));
        return true;
    }

    /** Out 欄: 絶対 TC または In からのフレーム相対（例 +120） */
    function parseMarkerOutTcInput(raw, m) {
        const trimmed = String(raw || '').trim();
        if (!trimmed) return null;
        const rel = trimmed.match(/^([+-])(\d+)$/);
        if (rel) {
            if (!markerTimelineReady() || !m) return null;
            const sign = rel[1] === '+' ? 1 : -1;
            const frameDelta = parseInt(rel[2], 10);
            if (!Number.isFinite(frameDelta)) return null;
            return { kind: 'frames', frameDelta: sign * frameDelta };
        }
        const sec = transportSecFromMarkerTcString(trimmed);
        if (sec == null) return null;
        return { kind: 'sec', sec: sec };
        return null;
    }

    /** 範囲マーカーの Out TC を削除し、同じ In 位置の点マーカーに戻す */
    function clearMarkerOutTc(markerId, opt) {
        const m = currentMarkers.find((x) => x.id === markerId);
        if (!m || m.type !== 'range') return false;
        const t = clampMarkerSec(m.startSec);
        m.type = 'point';
        m.timeSec = t;
        delete m.startSec;
        delete m.endSec;
        sortMarkersInPlace();
        activeMarkerId = m.id;
        persistMarkersAfterChange(opt);
        writeLog('Marker: Out TC cleared -> point at ' + tcLabelForSec(t));
        flashSeekHint('Marker', 'Out cleared', 'notice');
        return true;
    }

    function applyMarkerTcEdit(markerId, edge, sec, opt) {
        const m = currentMarkers.find((x) => x.id === markerId);
        if (!m) return false;
        const t = clampMarkerSec(sec);
        const oneFrame = markerOneFrameSec();
        if (m.type === 'point') {
            if (edge === 'in') {
                m.timeSec = t;
            } else if (edge === 'out') {
                const start = clampMarkerSec(m.timeSec);
                m.type = 'range';
                m.startSec = start;
                m.endSec = Math.max(start + oneFrame, t);
                delete m.timeSec;
            } else {
                return false;
            }
        } else if (m.type === 'range') {
            if (edge === 'in') {
                m.startSec = Math.max(0, Math.min(t, m.endSec - oneFrame));
            } else if (edge === 'out') {
                m.endSec = Math.max(m.startSec + oneFrame, t);
            } else {
                return false;
            }
            if (m.endSec <= m.startSec) {
                m.endSec = m.startSec + oneFrame;
            }
        } else {
            return false;
        }
        collapseRangeMarkerToPointIfNarrow(m, { silent: true });
        sortMarkersInPlace();
        activeMarkerId = m.id;
        persistMarkersAfterChange(opt);
        writeLog('Marker: TC updated ' + markerTimeLabel(m));
        flashSeekHint('Marker TC', tcLabelForSec(t));
        return true;
    }

    function markerTcSecForEdge(m, edge) {
        if (!m) return null;
        if (m.type === 'range') return edge === 'in' ? m.startSec : m.endSec;
        return edge === 'in' ? m.timeSec : null;
    }

    function markerTcFrameIndexForEdge(m, edge) {
        const sec = markerTcSecForEdge(m, edge);
        if (sec == null || !Number.isFinite(sec)) return null;
        return playbackFrameIndexForSide(markerVideoSecForTransportSec(sec), 'main');
    }

    /** +/- 用: Out が空の点マーカーは In 位置を基準にする（従来どおり） */
    function markerTcFrameIndexForNudge(m, edge) {
        const effEdge = effectiveMarkerTcEdge(m, edge);
        let idx = markerTcFrameIndexForEdge(m, effEdge);
        if (idx != null) return idx;
        if (effEdge === 'out') {
            const inSec = markerInSec(m);
            if (Number.isFinite(inSec)) {
                return playbackFrameIndexForSide(
                    markerVideoSecForTransportSec(inSec),
                    'main',
                );
            }
        }
        return null;
    }

    function markerVideoSecForTcInputRaw(raw, m, edge) {
        const trimmed = String(raw || '').trim();
        if (trimmed) {
            const transportSec = transportSecFromMarkerTcString(trimmed);
            if (transportSec != null) {
                return markerVideoSecForTransportSec(transportSec);
            }
        }
        const transportSec = markerTcSecForEdge(m, edge);
        if (transportSec != null) {
            return markerVideoSecForTransportSec(transportSec);
        }
        if (edge === 'out' && m.type === 'point') {
            return markerVideoSecForTransportSec(markerInSec(m));
        }
        return markerVideoSecForTransportSec(currentTransportSec());
    }

    function frameIndexFromMarkerTcInputRaw(raw, m, edge) {
        return playbackFrameIndexForSide(markerVideoSecForTcInputRaw(raw, m, edge), 'main');
    }

    function isMarkerTcInputElement(el) {
        return !!(el && el.classList && el.classList.contains('marker-table__tc-input'));
    }

    function isMarkerTcInputFocused() {
        return isMarkerTcInputElement(document.activeElement);
    }

    function effectiveMarkerTcEdge(m, edge) {
        if (edge === 'out') return 'out';
        if (m && m.id === activeMarkerId && markerActiveTcEdge === 'out') {
            return 'out';
        }
        return 'in';
    }

    function refreshMarkerTcInputDisplay(input, m, edge) {
        if (!input || !m) return;
        const eff = edge === 'out' ? 'out' : effectiveMarkerTcEdge(m, edge);
        if (eff === 'out' && m.type === 'range') {
            input.value = tcLabelForSec(m.endSec);
        } else {
            const sec = markerTcSecForEdge(m, eff);
            input.value = sec != null ? tcLabelForSec(sec) : '';
        }
    }

    function nudgeMarkerTcByEdge(m, edge, sign, bySeconds, inputOpt) {
        if (!m || !markerTimelineReady() || !Number.isFinite(sign) || sign === 0) return false;
        const effEdge = effectiveMarkerTcEdge(m, edge);
        let idx = markerTcFrameIndexForNudge(m, edge);
        if (idx == null) {
            const raw = inputOpt && inputOpt.value ? inputOpt.value : '';
            idx = frameIndexFromMarkerTcInputRaw(raw, m, effEdge);
        }
        if (idx == null) return false;
        let newIdx;
        if (bySeconds) {
            const transportSec = transportSecFromPlaybackFrameIndex(idx);
            if (transportSec == null) return false;
            const bumped = clampMarkerSec(transportSec + sign);
            newIdx = playbackFrameIndexForSide(
                markerVideoSecForTransportSec(bumped),
                'main',
            );
        } else {
            newIdx = clampFrameIndexToClip(idx + sign, 'main');
        }
        const newSec = transportSecFromPlaybackFrameIndex(newIdx);
        if (newSec == null) return false;
        if (!applyMarkerTcEdit(m.id, effEdge, newSec, { skipMarkerList: true })) return false;
        const t = commitMarkerTransportSeek(newSec);
        syncMarkerSeekTransportUi(t);
        const input =
            inputOpt ||
            (markerTableBody
                ? markerTableBody.querySelector(
                      '.marker-table__tc-input[data-marker-for="' +
                          m.id +
                          '"][data-marker-tc-edge="' +
                          effEdge +
                          '"]',
                  )
                : null);
        if (input) {
            refreshMarkerTcInputDisplay(input, m, effEdge);
            input.focus();
        }
        if (markerTableBody && m.id === activeMarkerId) {
            const outInput = markerTableBody.querySelector(
                '.marker-table__tc-input[data-marker-for="' +
                    m.id +
                    '"][data-marker-tc-edge="out"]',
            );
            if (outInput && outInput !== input && m.type === 'range') {
                outInput.value = tcLabelForSec(m.endSec);
            }
        }
        renderSeekBarMarkers();
        updateMarkerCommentOverlay();
        if (typeof centerWaveformTimelineOnTransport === 'function') {
            centerWaveformTimelineOnTransport();
        }
        return true;
    }

    function markerTcNudgeShiftHeld(ev) {
        return !!(
            ev.shiftKey ||
            (typeof ev.getModifierState === 'function' && ev.getModifierState('Shift'))
        );
    }

    function handleMarkerPanelTcNudgeKeydown(ev) {
        if (ev.ctrlKey || ev.altKey || ev.metaKey) return false;
        const shift = markerTcNudgeShiftHeld(ev);
        const plus =
            ev.code === 'NumpadAdd' ||
            ev.key === '+' ||
            (ev.code === 'Equal' && shift);
        const minus = ev.code === 'NumpadSubtract' || ev.key === '-' || ev.code === 'Minus';
        if (!plus && !minus) return false;
        if (!markerTimelineReady()) return false;

        const ae = document.activeElement;
        if (ae && ae.closest && ae.closest('.marker-table__comment')) return false;

        let m = null;
        let edge = markerActiveTcEdge;
        let input = null;

        if (isMarkerTcInputElement(ae)) {
            input = ae;
            m = currentMarkers.find((x) => x.id === ae.dataset.markerFor);
            edge = effectiveMarkerTcEdge(m, ae.dataset.markerTcEdge || edge);
        } else if (activeMarkerId) {
            m = currentMarkers.find((x) => x.id === activeMarkerId);
            if (m && markerTableBody) {
                edge = effectiveMarkerTcEdge(m, edge);
                input = markerTableBody.querySelector(
                    '.marker-table__tc-input[data-marker-for="' +
                        m.id +
                        '"][data-marker-tc-edge="' +
                        edge +
                        '"]',
                );
            }
        }
        if (!m) return false;

        const sign = plus ? 1 : -1;
        if (nudgeMarkerTcByEdge(m, edge, sign, shift, input)) {
            ev.preventDefault();
            return true;
        }
        return false;
    }

    function handleMarkerTcInputNudgeKey(ev, input, m, edge) {
        return handleMarkerPanelTcNudgeKeydown(ev);
    }

    function focusMarkerTcInput(markerId, edge) {
        if (!markerTableBody) return;
        const input = markerTableBody.querySelector(
            '.marker-table__tc-input[data-marker-for="' +
                markerId +
                '"][data-marker-tc-edge="' +
                edge +
                '"]',
        );
        if (input && input.focus) input.focus();
    }

    function createMarkerTcInput(m, edge) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'marker-table__tc-input';
        input.dataset.markerFor = m.id;
        input.dataset.markerTcEdge = edge;
        input.readOnly = true;
        input.spellcheck = false;
        input.autocomplete = 'off';
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('autocapitalize', 'off');
        input.addEventListener('paste', (ev) => ev.preventDefault());
        input.addEventListener('drop', (ev) => ev.preventDefault());
        if (edge === 'in') {
            input.value =
                m.type === 'range' ? tcLabelForSec(m.startSec) : tcLabelForSec(m.timeSec);
            input.title = 'In TC: [+][-] ±1f · [Shift][+][-] ±1s (Enter/Esc to finish)';
        } else {
            input.value = m.type === 'range' ? tcLabelForSec(m.endSec) : '';
            input.title =
                m.type === 'range'
                    ? 'Out TC: [+][-] ±1f · [Shift][+][-] ±1s · [Del] clear Out (Enter/Esc to finish)'
                    : 'Out TC: [+][-] sets range Out (±1f / Shift ±1s)';
        }
        const restoreDisplayedTc = () => {
            const sec = markerTcSecForEdge(m, edge);
            if (sec != null) input.value = tcLabelForSec(sec);
            else if (edge === 'out') input.value = '';
        };
        let tcEditRevert = null;
        const applyTcEditRevert = () => {
            if (!tcEditRevert) return;
            if (tcEditRevert.type === 'range') {
                m.type = 'range';
                m.startSec = tcEditRevert.startSec;
                m.endSec = tcEditRevert.endSec;
                delete m.timeSec;
            } else {
                m.type = 'point';
                m.timeSec = tcEditRevert.timeSec;
                delete m.startSec;
                delete m.endSec;
            }
            tcEditRevert = null;
            sortMarkersInPlace();
            persistMarkersAfterChange();
            restoreDisplayedTc();
            renderMarkerList();
            renderSeekBarMarkers();
        };
        input.addEventListener('keydown', (ev) => {
            if (handleMarkerTcInputNudgeKey(ev, input, m, edge)) return;
            if (
                edge === 'out' &&
                (ev.key === 'Delete' || ev.code === 'Delete') &&
                !ev.ctrlKey &&
                !ev.altKey &&
                !ev.metaKey &&
                !ev.shiftKey
            ) {
                if (clearMarkerOutTc(m.id)) {
                    ev.preventDefault();
                    tcEditRevert = null;
                    const t = commitMarkerTransportSeek(clampMarkerSec(m.timeSec));
                    syncMarkerSeekTransportUi(t);
                    updateMarkerCommentOverlay();
                    requestAnimationFrame(() => focusMarkerTcInput(m.id, 'out'));
                }
                return;
            }
            if (ev.key === 'Enter') {
                ev.preventDefault();
                tcEditRevert = null;
                input.blur();
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                applyTcEditRevert();
                input.blur();
            }
        });
        input.addEventListener('mousedown', (ev) => {
            if (ev.button !== 0) return;
            suppressMarkerRowHoverSeek(800);
        });
        input.addEventListener('blur', (ev) => {
            tcEditRevert = null;
            if (isMarkerTcInputElement(ev.relatedTarget)) return;
            if (typeof endMarkerTcEditWaveformZoom === 'function') {
                endMarkerTcEditWaveformZoom();
            }
        });
        input.addEventListener('dblclick', (ev) => {
            ev.preventDefault();
            if (edge === 'out' && m.type === 'range') {
                seekToMarker(m, { seekEnd: true });
            } else {
                seekToMarker(m);
            }
        });
        input.addEventListener('focus', () => {
            suppressMarkerRowHoverSeek(800);
            markerActiveTcEdge = edge === 'out' ? 'out' : 'in';
            activeMarkerId = m.id;
            updateMarkerRowActiveClass(m.id);
            if (m.type === 'range') {
                tcEditRevert = {
                    type: 'range',
                    startSec: m.startSec,
                    endSec: m.endSec,
                };
            } else {
                tcEditRevert = { type: 'point', timeSec: m.timeSec };
            }
            syncSeekToMarkerRow(m, {
                quiet: true,
                seekIn: edge === 'in' || (edge === 'out' && !markerHasOutTc(m)),
                seekEnd: edge === 'out' && markerHasOutTc(m),
            });
            if (typeof beginMarkerTcEditWaveformZoom === 'function') {
                beginMarkerTcEditWaveformZoom();
            }
        });
        return input;
    }

    function removeMarker(id) {
        const idx = currentMarkers.findIndex((m) => m.id === id);
        if (idx < 0) return;
        currentMarkers = currentMarkers.filter((m) => m.id !== id);
        if (activeMarkerId === id) activeMarkerId = null;
        persistMarkersAfterChange();
        writeLog('Marker: removed');
    }

    function updateMarkerComment(id, text) {
        const m = currentMarkers.find((x) => x.id === id);
        if (!m) return;
        m.comment = String(text);
        saveMarkersToCache();
        schedulePersistSession();
        renderSeekBarMarkers();
        updateMarkerCommentOverlay();
    }

    /** 再生位置の更新だけではマーカー再描画は不要。範囲 In 確定待ちの帯だけ追従する。 */
    function markersNeedTimelineRefreshOnTransport() {
        return pendingRangeStartSec != null && Number.isFinite(pendingRangeStartSec);
    }

    function markerSecForNav(m) {
        if (!m) return 0;
        return m.type === 'range' ? m.startSec : m.timeSec;
    }

    function markerInSec(m) {
        return markerSecForNav(m);
    }

    function markerHasOutTc(m) {
        return !!(m && m.type === 'range' && Number.isFinite(m.endSec));
    }

    function updateMarkerRowActiveClass(activeId) {
        if (!markerTableBody) return;
        const rows = markerTableBody.querySelectorAll('tr[data-marker-id]');
        rows.forEach((tr) => {
            tr.classList.toggle(
                'marker-table__row--active',
                activeId != null && tr.dataset.markerId === activeId
            );
        });
    }

    function isMarkerHoverBlockedByCommentFocus(targetMarkerId) {
        const ae = document.activeElement;
        const ta = ae && ae.closest && ae.closest('.marker-table__comment[data-marker-comment]');
        if (!ta) return false;
        return ta.dataset.markerComment !== targetMarkerId;
    }

    function suppressMarkerRowHoverSeek(ms) {
        suppressMarkerRowHoverSeekUntil = performance.now() + (ms > 0 ? ms : 200);
    }

    function isMarkerRowHoverSeekSuppressed() {
        return performance.now() < suppressMarkerRowHoverSeekUntil;
    }

    /** 再生中・TC 編集中は MARKERS 行ホバーでのジャンプを無効 */
    function isMarkerRowHoverSeekBlocked() {
        if (isMarkerTcInputFocused()) return true;
        if (typeof isTransportPlaying === 'function') return isTransportPlaying();
        return !videoMain.paused;
    }

    function bindMarkerRowSeekIn(el, m) {
        el.addEventListener('mouseenter', () => {
            if (isMarkerHoverBlockedByCommentFocus(m.id)) return;
            if (isMarkerRowHoverSeekBlocked()) return;
            syncSeekToMarkerRow(m, { quiet: true, seekIn: true, fromRowHover: true });
        });
    }

    function syncMarkerSeekTransportUi(t) {
        if (!Number.isFinite(t)) return;
        if (typeof setTransportSec === 'function') {
            setTransportSec(t);
        } else if (seekBar) {
            seekBar.value = String(t);
        }
        if (currentTimeEl) {
            currentTimeEl.textContent = formatTimecodeForTransport(t);
        }
        if (typeof updateTimecodeOverlay === 'function') updateTimecodeOverlay();
        if (typeof updateAllWaveformPlayheads === 'function') updateAllWaveformPlayheads();
        if (typeof updateRangeLoopOverlay === 'function') updateRangeLoopOverlay();
        if (typeof updateMarkerCommentOverlay === 'function') updateMarkerCommentOverlay();
    }

    function commitMarkerTransportSeek(target) {
        const dur = masterDurForTimelineMarkers();
        const t = Math.max(0, Math.min(dur - 0.001, target));
        const vd =
            typeof getVideoPlaybackEndSec === 'function' ? getVideoPlaybackEndSec() : 0;
        const tailEps =
            typeof masterTransportTailEpsilonSec === 'function'
                ? masterTransportTailEpsilonSec()
                : 0.001;
        if (typeof clearTransportTailPlayback === 'function' && (!vd || t < vd - tailEps)) {
            clearTransportTailPlayback();
        }
        if (typeof clearVideoParkedForTail === 'function' && vd > 0 && t < vd - tailEps) {
            clearVideoParkedForTail();
        }
        if (typeof suppressRangeLoopSnapForExplicitSeek === 'function') {
            suppressRangeLoopSnapForExplicitSeek();
        }
        if (typeof applyTransportAtSec === 'function') {
            applyTransportAtSec(t);
        } else {
            if (typeof transportPlaybackSec !== 'undefined') {
                transportPlaybackSec = t;
                transportPlaybackLastTs = performance.now();
            }
            applyTimeToVideo(t);
            if (typeof syncExtraAudioToTransport === 'function') {
                syncExtraAudioToTransport({ force: true });
            }
        }
        return t;
    }

    /** Feedback コメント編集開始時: 行ハイライト＋シークバーをそのマーカー In へ */
    function activateMarkerForCommentEdit(m) {
        if (!markerTimelineReady() || !m) return;
        suppressMarkerRowHoverSeek(400);
        syncSeekToMarkerRow(m, { quiet: true, seekIn: true });
    }

    /** In / Out 列上でシーク（seekIn / seekEnd を指定） */
    function syncSeekToMarkerRow(m, opt) {
        if (!markerTimelineReady() || !m || !opt) return;
        activeMarkerId = m.id;
        updateMarkerRowActiveClass(m.id);
        if (!opt.seekIn && !opt.seekEnd) return;
        if (opt.fromRowHover && isMarkerRowHoverSeekSuppressed()) return;
        if (opt.fromRowHover && isMarkerRowHoverSeekBlocked()) return;
        if (opt.seekEnd && !markerHasOutTc(m)) return;
        const quiet = !!(opt && opt.quiet);
        const target = clampMarkerSec(opt.seekIn ? markerInSec(m) : m.endSec);
        const edgeLabel = opt.seekIn ? 'In' : 'Out';
        if (opt.seekEnd) markerActiveTcEdge = 'out';
        else if (opt.seekIn) markerActiveTcEdge = 'in';
        if (!videoMain.paused) {
            videoMain.pause();
            setPlayingUi(false);
            stopRaf();
        }
        const t = commitMarkerTransportSeek(target);
        syncMarkerSeekTransportUi(t);
        renderSeekBarMarkers();
        if (!quiet) {
            writeLog('Marker: row sync ' + tcLabelForSec(t) + ' ' + edgeLabel);
            flashSeekHint('Marker', tcLabelForSec(t) + ' ' + edgeLabel);
        }
    }

    function buildMarkerNavStops() {
        const stops = [];
        for (const m of currentMarkers) {
            if (m.type === 'range') {
                stops.push({ marker: m, sec: m.startSec, edge: 'start' });
                stops.push({ marker: m, sec: m.endSec, edge: 'end' });
            } else {
                stops.push({ marker: m, sec: m.timeSec, edge: 'point' });
            }
        }
        stops.sort((a, b) => {
            if (a.sec !== b.sec) return a.sec - b.sec;
            const edgeRank = { start: 0, point: 1, end: 2 };
            return (edgeRank[a.edge] || 0) - (edgeRank[b.edge] || 0);
        });
        return stops;
    }

    function markerNavIndexForCurrent() {
        if (currentMarkers.length === 0) return -1;
        if (activeMarkerId) {
            const i = currentMarkers.findIndex((m) => m.id === activeMarkerId);
            if (i >= 0) return i;
        }
        const t = currentTransportSec();
        let best = 0;
        for (let i = 0; i < currentMarkers.length; i++) {
            if (markerSecForNav(currentMarkers[i]) <= t + 0.001) best = i;
            else break;
        }
        return best;
    }

    /** Alt+↑↓: 編集中の Feedback 行を基準に前後マーカーへ */
    function markerNavIndexForCommentNav() {
        const ae = document.activeElement;
        const ta = ae && ae.closest && ae.closest('.marker-table__comment[data-marker-comment]');
        if (ta) {
            const id = ta.dataset.markerComment;
            const i = currentMarkers.findIndex((m) => m.id === id);
            if (i >= 0) return i;
        }
        return markerNavIndexForCurrent();
    }

    function markerNavStopEpsilonSec() {
        return Math.max(masterFrameSec > 0 ? masterFrameSec : 1 / 24, 0.001);
    }

    function appendVideoEndSnapStop(stops) {
        if (!markerTimelineReady()) return;
        let end = 0;
        if (typeof getVideoTimelineEndSecForWaveform === 'function') {
            end = getVideoTimelineEndSecForWaveform();
        } else if (typeof getVideoPlaybackEndSec === 'function') {
            end = getVideoPlaybackEndSec();
        } else if (typeof getVideoTransportDurationSec === 'function') {
            end = getVideoTransportDurationSec();
        }
        if (Number.isFinite(end) && end > 0) {
            stops.push(end);
        }
    }

    /** マーカー In/Out・点・動画終端（波形オフセット Alt+ドラッグ用） */
    function snapSecToMarkerInOut(sec, opt) {
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        const stops = [];
        for (const m of currentMarkers) {
            if (m.type === 'range') {
                if (Number.isFinite(m.startSec)) stops.push(m.startSec);
                if (markerHasOutTc(m) && Number.isFinite(m.endSec)) stops.push(m.endSec);
            } else if (Number.isFinite(m.timeSec)) {
                stops.push(m.timeSec);
            }
        }
        appendVideoEndSnapStop(stops);
        if (!stops.length) return n;
        const threshold =
            opt && Number.isFinite(opt.thresholdSec) && opt.thresholdSec > 0
                ? opt.thresholdSec
                : markerNavStopEpsilonSec();
        let best = n;
        let bestDist = threshold + 1;
        for (let i = 0; i < stops.length; i++) {
            const d = Math.abs(stops[i] - n);
            if (d <= threshold && d < bestDist) {
                bestDist = d;
                best = stops[i];
            }
        }
        return best;
    }

    window.snapSecToMarkerInOut = snapSecToMarkerInOut;

    function markerNavStopIndexForCurrent(stops) {
        if (!stops || stops.length === 0) return -1;
        const t = currentTransportSec();
        const eps = markerNavStopEpsilonSec();
        if (activeMarkerId) {
            const m = currentMarkers.find((x) => x.id === activeMarkerId);
            if (m) {
                if (m.type === 'range' && markerHasOutTc(m)) {
                    const startIdx = stops.findIndex(
                        (s) => s.marker.id === m.id && s.edge === 'start'
                    );
                    const endIdx = stops.findIndex((s) => s.marker.id === m.id && s.edge === 'end');
                    if (startIdx >= 0 && endIdx >= 0) {
                        const inside =
                            t > m.startSec + eps && t < m.endSec - eps;
                        if (!inside) {
                            if (Math.abs(t - m.startSec) <= eps) return startIdx;
                            if (Math.abs(t - m.endSec) <= eps) return endIdx;
                        }
                    }
                } else if (m.type !== 'range') {
                    const i = stops.findIndex((s) => s.marker.id === m.id);
                    if (i >= 0) return i;
                }
            }
        }
        let best = -1;
        for (let i = 0; i < stops.length; i++) {
            if (stops[i].sec <= t + eps) best = i;
            else break;
        }
        return best;
    }

    function fitMarkerCommentHeight(ta) {
        if (!ta) return;
        const cs = getComputedStyle(ta);
        const maxPx = parseFloat(cs.maxHeight);
        const lineH = parseFloat(cs.lineHeight) || 16;
        const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        const borderV =
            (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
        const minH = lineH + padV + borderV;
        ta.style.height = '0';
        let h = ta.scrollHeight;
        if (Number.isFinite(maxPx) && maxPx > 0) h = Math.min(h, maxPx);
        ta.style.height = Math.max(minH, h) + 'px';
        ta.style.overflowY =
            Number.isFinite(maxPx) && ta.scrollHeight > maxPx + 1 ? 'auto' : 'hidden';
    }

    function focusMarkerCommentField(id, opt) {
        const m = currentMarkers.find((x) => x.id === id);
        const run = () => {
            const ta =
                markerTableBody &&
                markerTableBody.querySelector('[data-marker-comment="' + id + '"]');
            if (!ta) return;
            if (m) activateMarkerForCommentEdit(m);
            ta.focus();
            const row = ta.closest('tr');
            if (row && row.scrollIntoView) {
                row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        };
        if (opt && opt.sync) run();
        else requestAnimationFrame(run);
    }

    function seekToMarker(m, opt) {
        if (!markerTimelineReady() || !m) return;
        const focusComment = !!(opt && opt.focusComment);
        const resumeAfter = !!(opt && opt.resumeAfterSeek);
        const seekEnd = !!(opt && opt.seekEnd);
        let target = 0;
        if (opt && Number.isFinite(opt.targetSec)) {
            target = opt.targetSec;
        } else if (m.type === 'range') target = seekEnd ? m.endSec : m.startSec;
        else target = m.timeSec;
        const wasPlaying =
            typeof isTransportPlaying === 'function'
                ? isTransportPlaying()
                : !videoMain.paused;
        transportPlayGeneration += 1;
        transportPlayInFlight = null;
        if (resumeAfter && wasPlaying) {
            stopRaf();
            try {
                videoMain.pause();
            } catch (_) {}
        } else if (!resumeAfter && wasPlaying) {
            videoMain.pause();
            setPlayingUi(false);
            stopRaf();
            updateSeekUiFromVideo();
            if (typeof syncExtraAudioToTransport === 'function') {
                syncExtraAudioToTransport();
            }
        }
        const t = commitMarkerTransportSeek(target);
        syncMarkerSeekTransportUi(t);
        activeMarkerId = m.id;
        updateMarkerRowActiveClass(m.id);
        renderSeekBarMarkers();
        schedulePersistSession();
        const hintTc = tcLabelForSec(t);
        const hintSuffix =
            m.type === 'range' && !(opt && Number.isFinite(opt.targetSec))
                ? seekEnd
                    ? ' Out'
                    : ' In'
                : '';
        writeLog('Marker: seek to ' + hintTc + hintSuffix);
        flashSeekHint('Marker', hintTc + hintSuffix);
        if (resumeAfter && wasPlaying) {
            if (
                typeof shouldStartMasterTransportTailPlayback === 'function' &&
                shouldStartMasterTransportTailPlayback(t) &&
                typeof startMasterTransportTailPlayback === 'function'
            ) {
                if (typeof setTransportSessionPlaying === 'function') {
                    setTransportSessionPlaying(true);
                }
                setPlayingUi(true);
                void startMasterTransportTailPlayback();
            } else {
                void resumeTransportPlaybackAfterSeek();
            }
        }
        if (focusComment) {
            suppressMarkerRowHoverSeek(300);
            focusMarkerCommentField(m.id, { sync: true });
        }
    }

    function rangeMarkerTargetSecFromPointer(m, el, clientX) {
        if (!m || m.type !== 'range' || !markerHasOutTc(m)) return null;
        const span = m.endSec - m.startSec;
        if (span <= markerNavStopEpsilonSec()) return m.startSec;
        const rect = el.getBoundingClientRect();
        if (!rect.width) return m.startSec;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return m.startSec + ratio * span;
    }

    let markerDragState = null;

    function setMarkerDragLanesActive(active) {
        const lanes =
            typeof audioWaveformLanesTracks !== 'undefined' && audioWaveformLanesTracks
                ? audioWaveformLanesTracks
                : null;
        if (lanes) lanes.classList.toggle('audio-waveform-composite__lanes--marker-dragging', !!active);
    }

    function detachMarkerDragDocListeners() {
        if (!markerDragState) return;
        if (markerDragState.onMove) {
            document.removeEventListener('pointermove', markerDragState.onMove);
        }
        if (markerDragState.onUp) {
            document.removeEventListener('pointerup', markerDragState.onUp);
            document.removeEventListener('pointercancel', markerDragState.onUp);
        }
    }

    function applyMarkerDragSec(m, edge, sec) {
        const t = clampMarkerSec(sec);
        const oneFrame = markerOneFrameSec();
        if (m.type === 'point') {
            m.timeSec = t;
            return;
        }
        if (edge === 'in') {
            m.startSec = Math.max(0, Math.min(t, m.endSec - oneFrame));
        } else if (edge === 'out') {
            m.endSec = Math.max(m.startSec + oneFrame, t);
        }
        if (m.endSec <= m.startSec) {
            m.endSec = Math.min(
                masterDurForTimelineMarkers() - 0.001,
                m.startSec + oneFrame,
            );
        }
    }

    function scheduleMarkerDragRedraw() {
        if (!markerDragState) return;
        if (markerDragState.raf) return;
        markerDragState.raf = requestAnimationFrame(() => {
            if (!markerDragState) return;
            markerDragState.raf = 0;
            renderSeekBarMarkers();
            if (typeof updateMarkerCommentOverlay === 'function') {
                updateMarkerCommentOverlay();
            }
        });
    }

    function endMarkerDrag(commit) {
        if (!markerDragState) return;
        const st = markerDragState;
        detachMarkerDragDocListeners();
        if (st.raf) cancelAnimationFrame(st.raf);
        markerDragState = null;
        setMarkerDragLanesActive(false);
        if (commit) {
            sortMarkersInPlace();
            persistMarkersAfterChange();
            writeLog('Marker: drag ' + markerTimeLabel(st.m));
            flashSeekHint('Marker', markerTimeLabel(st.m));
        }
    }

    function seekToMarkerOnClick(m, edge, clientX, bandEl) {
        let target = null;
        if (m.type === 'point') {
            target = m.timeSec;
        } else if (edge === 'in') {
            target = m.startSec;
        } else if (edge === 'out') {
            target = m.endSec;
        } else if (bandEl) {
            target = rangeMarkerTargetSecFromPointer(m, bandEl, clientX);
        }
        if (target == null || !Number.isFinite(target)) return;
        const wasPlaying =
            typeof isTransportPlaying === 'function'
                ? isTransportPlaying()
                : !videoMain.paused;
        seekToMarker(m, {
            targetSec: target,
            resumeAfterSeek: wasPlaying,
        });
    }

    function bindSeekBarMarkerPointerSeek(el, m, resolveTargetSec) {
        el.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;
            if (ev.target.closest && ev.target.closest('.seek-bar-marker__handle')) return;
            ev.preventDefault();
            ev.stopPropagation();
            const target = resolveTargetSec(ev);
            if (target == null || !Number.isFinite(target)) return;
            const wasPlaying =
                typeof isTransportPlaying === 'function'
                    ? isTransportPlaying()
                    : !videoMain.paused;
            seekToMarker(m, {
                targetSec: target,
                resumeAfterSeek: wasPlaying,
            });
        });
    }

    function bindSeekBarMarkerDrag(el, m, edge, opt) {
        el.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;
            if (opt && opt.pending) return;
            ev.preventDefault();
            ev.stopPropagation();
            if (typeof endAudioWaveformScrub === 'function') {
                endAudioWaveformScrub({ force: true });
            }
            if (typeof hideHoverPlayhead === 'function') hideHoverPlayhead();

            const bandEl = opt && opt.bandEl ? opt.bandEl : null;
            endMarkerDrag(false);
            markerDragState = {
                m: m,
                edge: edge,
                bandEl: bandEl,
                pointerId: ev.pointerId,
                startX: ev.clientX,
                moved: false,
                raf: 0,
                onMove: null,
                onUp: null,
            };
            activeMarkerId = m.id;
            updateMarkerRowActiveClass(m.id);

            markerDragState.onMove = (e) => {
                if (!markerDragState || e.pointerId !== markerDragState.pointerId) return;
                if (Math.abs(e.clientX - markerDragState.startX) >= 4) {
                    if (!markerDragState.moved) {
                        markerDragState.moved = true;
                        setMarkerDragLanesActive(true);
                    }
                }
                if (!markerDragState.moved) return;
                e.preventDefault();
                applyMarkerDragSec(m, edge, transportSecFromWaveformClientX(e.clientX));
                scheduleMarkerDragRedraw();
            };
            markerDragState.onUp = (e) => {
                if (!markerDragState || e.pointerId !== markerDragState.pointerId) return;
                const st = markerDragState;
                detachMarkerDragDocListeners();
                if (st.raf) cancelAnimationFrame(st.raf);
                markerDragState = null;
                setMarkerDragLanesActive(false);
                if (!st.moved) {
                    seekToMarkerOnClick(m, edge, e.clientX, bandEl);
                    return;
                }
                collapseRangeMarkerToPointIfNarrow(m, { silent: true });
                sortMarkersInPlace();
                persistMarkersAfterChange();
                writeLog('Marker: drag ' + markerTimeLabel(m));
                flashSeekHint('Marker', markerTimeLabel(m));
            };
            document.addEventListener('pointermove', markerDragState.onMove);
            document.addEventListener('pointerup', markerDragState.onUp);
            document.addEventListener('pointercancel', markerDragState.onUp);
        });
    }

    function handleMarkerDeleteKeydown(e) {
        if (e.code !== 'Delete' && e.code !== 'Backspace') return false;
        if (e.repeat) return false;
        if (e.ctrlKey || e.altKey || e.metaKey) return false;
        if (isTypingTarget(e.target)) return false;
        if (!activeMarkerId) return false;
        const m = currentMarkers.find((x) => x.id === activeMarkerId);
        if (!m) {
            activeMarkerId = null;
            return false;
        }
        e.preventDefault();
        removeMarker(activeMarkerId);
        flashSeekHint('Marker', 'Deleted', 'notice');
        return true;
    }

    window.handleMarkerDeleteKeydown = handleMarkerDeleteKeydown;

    function jumpToAdjacentMarker(dir, opt) {
        const n = currentMarkers.length;
        if (n === 0) return false;
        const forComment = !!(opt && opt.focusComment);
        let idx = forComment ? markerNavIndexForCommentNav() : markerNavIndexForCurrent();
        if (idx < 0) idx = 0;
        idx = (idx + dir + n) % n;
        const m = currentMarkers[idx];
        seekToMarker(m, {
            focusComment: forComment,
            resumeAfterSeek: !!(opt && opt.resumeAfterSeek),
            seekEnd: false,
        });
        return true;
    }

    function jumpToAdjacentMarkerStop(dir, opt) {
        const stops = buildMarkerNavStops();
        const n = stops.length;
        if (n === 0) return false;
        const idx = markerNavStopIndexForCurrent(stops);
        let next;
        if (idx < 0) {
            if (dir <= 0) return false;
            next = 0;
        } else {
            next = idx + dir;
            if (next < 0 || next >= n) return false;
        }
        const stop = stops[next];
        seekToMarker(stop.marker, {
            focusComment: !!(opt && opt.focusComment),
            resumeAfterSeek: !!(opt && opt.resumeAfterSeek),
            seekEnd: stop.edge === 'end',
        });
        return true;
    }

    function handleMarkerNavigationKeydown(e) {
        if (e.repeat) return false;
        if (!markerTimelineReady() || currentMarkers.length === 0) return false;
        if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return false;
        if (e.ctrlKey || e.metaKey) return false;

        // Alt+↑↓: 一覧内の Feedback 移動（↑=上の行、↓=下の行）
        if (e.altKey && !e.shiftKey) {
            const dir = e.code === 'ArrowUp' ? -1 : 1;
            e.preventDefault();
            suppressMarkerRowHoverSeek(300);
            jumpToAdjacentMarker(dir, { focusComment: true });
            return true;
        }

        // Shift+↑↓: マーカー停止点ジャンプ（↑=次の停止点）。テキスト入力中は除外
        if (e.shiftKey && !e.altKey) {
            const dir = e.code === 'ArrowUp' ? 1 : -1;
            if (isTypingTarget(e.target)) return false;
            e.preventDefault();
            const wasPlaying =
                typeof isTransportUiClockActive === 'function'
                    ? isTransportUiClockActive()
                    : typeof isTransportPlaying === 'function'
                      ? isTransportPlaying()
                      : !videoMain.paused;
            jumpToAdjacentMarkerStop(dir, {
                focusComment: false,
                resumeAfterSeek: wasPlaying,
            });
            return true;
        }

        return false;
    }

    function markerFeedbackMaxCharsForWidthPct(widthPct) {
        const w = Number(widthPct) || 0;
        if (w >= 18) return 28;
        if (w >= 10) return 18;
        if (w >= 5) return 12;
        return 8;
    }

    function markerFeedbackDisplayText(comment, maxChars) {
        const raw = String(comment || '').replace(/\s+/g, ' ').trim();
        if (!raw) return '';
        const max = Math.max(4, maxChars | 0);
        if (raw.length <= max) return raw;
        return raw.slice(0, max) + '...';
    }

    function markerLabelsLayerEl() {
        return (
            typeof audioWaveformMarkerLabels !== 'undefined' && audioWaveformMarkerLabels
                ? audioWaveformMarkerLabels
                : document.getElementById('audioWaveformMarkerLabels')
        );
    }

    function createMarkerFeedbackLabelSpan(comment, maxChars, titleText, anchor) {
        if (!anchor) return null;
        const label = markerFeedbackDisplayText(comment, maxChars);
        if (!label) return null;
        const span = document.createElement('span');
        span.className =
            'seek-bar-marker__feedback' +
            (anchor.point ? ' seek-bar-marker__feedback--point' : ' seek-bar-marker__feedback--range');
        span.textContent = label;
        if (titleText) span.title = titleText;
        if (anchor.point) {
            span.style.left = anchor.leftPct + '%';
            if (Number.isFinite(anchor.pointSec)) {
                span.dataset.pointSec = String(anchor.pointSec);
            }
        } else {
            const w = Number(anchor.widthPct) || 0;
            const centerPct = anchor.leftPct + w * 0.5;
            span.style.left = centerPct + '%';
            span.dataset.rangeLeftPct = String(anchor.leftPct);
            span.dataset.rangeWidthPct = String(w);
            span.dataset.rangeCenterPct = String(centerPct);
            if (Number.isFinite(anchor.startSec)) {
                span.dataset.rangeStartSec = String(anchor.startSec);
            }
            if (Number.isFinite(anchor.endSec)) {
                span.dataset.rangeEndSec = String(anchor.endSec);
            }
            span.style.transform = 'translate(-50%, -50%)';
            return span;
        }
        span.style.transform = 'translate(0, -50%)';
        return span;
    }

    function markerFeedbackAnchorPct(it) {
        if (Number.isFinite(it.anchorPct)) return it.anchorPct;
        if (Number.isFinite(it.rangeWidthPct) && it.rangeWidthPct > 0) {
            if (Number.isFinite(it.rangeCenterPct)) return it.rangeCenterPct;
            if (Number.isFinite(it.rangeLeftPct)) {
                return it.rangeLeftPct + it.rangeWidthPct * 0.5;
            }
        }
        const pct = parseFloat(it.span && it.span.style ? it.span.style.left : '');
        return Number.isFinite(pct) ? pct : 0;
    }

    function markerFeedbackAnchorLeftPx(it, layerW) {
        if (!(layerW > 0)) return 0;
        return (markerFeedbackAnchorPct(it) / 100) * layerW;
    }

    function markerFeedbackLaneCount(layerEl) {
        const compositeRoot =
            layerEl.closest && layerEl.closest('.audio-waveform-composite');
        if (
            compositeRoot &&
            compositeRoot.classList.contains('audio-waveform-composite--no-video-audio')
        ) {
            return 2;
        }
        return 3;
    }

    function markerFeedbackLaneMetrics(layerEl) {
        const compositeRoot =
            layerEl.closest && layerEl.closest('.audio-waveform-composite');
        const lanes =
            typeof audioWaveformLanesTracks !== 'undefined' && audioWaveformLanesTracks
                ? audioWaveformLanesTracks
                : compositeRoot &&
                    compositeRoot.querySelector('.audio-waveform-composite__lanes');
        const styleTarget = compositeRoot || layerEl;
        const laneH =
            parseFloat(getComputedStyle(styleTarget).getPropertyValue('--wave-lane-h')) || 52;
        const inner =
            typeof audioWaveformLanesInner !== 'undefined' && audioWaveformLanesInner
                ? audioWaveformLanesInner
                : lanes && lanes.querySelector
                  ? lanes.querySelector('.audio-waveform-composite__lanes-inner')
                  : null;
        const layerW =
            (typeof masterTimelineWidthCss === 'function'
                ? masterTimelineWidthCss()
                : 0) ||
            (inner && inner.clientWidth) ||
            (lanes && lanes.clientWidth) ||
            (compositeRoot && compositeRoot.clientWidth) ||
            layerEl.clientWidth ||
            0;
        return { laneH, layerH: laneH, layerW, lanes };
    }

    /** 矩形が接触していなくても、指定ギャップ未満なら重なり扱い */
    function markerFeedbackLabelBoxOverlap(a, b, gapX, gapY) {
        const gx = gapX > 0 ? gapX : 0;
        const gy = gapY > 0 ? gapY : 0;
        const ah = a.height > 0 ? a.height : 14;
        const bh = b.height > 0 ? b.height : 14;
        const aTop = a.top - ah * 0.5;
        const aBot = a.top + ah * 0.5;
        const bTop = b.top - bh * 0.5;
        const bBot = b.top + bh * 0.5;

        let hGap;
        if (a.right <= b.left) hGap = b.left - a.right;
        else if (b.right <= a.left) hGap = a.left - b.right;
        else hGap = -Math.min(b.right - a.left, a.right - b.left);

        let vGap;
        if (aBot <= bTop) vGap = bTop - aBot;
        else if (bBot <= aTop) vGap = aTop - bBot;
        else vGap = -Math.min(bBot - aTop, aBot - bTop);

        return hGap < gx && vGap < gy;
    }

    function markerFeedbackLabelTextWidth(it) {
        return Math.max(it.textW, 18);
    }

    /** ラベル矩形（点=In 左端、範囲=帯の中央にテキスト中心） */
    function markerFeedbackLabelTextBox(it, layerW, topPx) {
        const w = markerFeedbackLabelTextWidth(it);
        const h = it.height > 0 ? it.height : 14;
        let left;
        let right;
        if (!it.isPoint && it.rangeWidthPct > 0 && layerW > 0) {
            const cx = markerFeedbackAnchorLeftPx(it, layerW);
            left = cx - w * 0.5;
            right = cx + w * 0.5;
        } else {
            left = markerFeedbackAnchorLeftPx(it, layerW);
            right = left + w;
        }
        return {
            left: left,
            right: right,
            top: topPx,
            height: h,
        };
    }

    function markerFeedbackLabelTextBoxesOverlap(a, b, padX, padY) {
        return markerFeedbackLabelBoxOverlap(a, b, padX, padY);
    }

    /** 範囲コメント（一覧側ラベル）が点マーカーコメントと横重なり時は下段へ */
    function markerFeedbackMinRowForRangeBelowPoints(it, pointPlaced, layerW, baseTop, padX, padY) {
        let minRow = 0;
        if (!pointPlaced.length) return 0;
        const probeTop = baseTop;
        const rangeProbe = markerFeedbackLabelTextBox(it, layerW, probeTop);
        for (let i = 0; i < pointPlaced.length; i++) {
            const pp = pointPlaced[i];
            const pointBox = markerFeedbackLabelTextBox(pp, layerW, pp.topPx);
            if (markerFeedbackLabelTextBoxesOverlap(pointBox, rangeProbe, padX, padY)) {
                minRow = Math.max(minRow, (pp.assignedRow || 0) + 1);
            }
        }
        return minRow;
    }

    /** 0 行目=レーン中央。重なり時は下へ段を増やし、下に余地がなくなってから上へ */
    function markerFeedbackTopForRow(row, baseTop, rowStep, minTop, maxTop, maxDownRows) {
        if (!row) return baseTop;
        const downCap = maxDownRows > 0 ? maxDownRows : 0;
        if (row <= downCap) {
            return Math.min(maxTop, baseTop + row * rowStep);
        }
        const upRow = row - downCap;
        return Math.max(minTop, baseTop - upRow * rowStep);
    }

    function applyMarkerFeedbackLabelRows(items, baseTop, rowStep, minTop, maxTop, maxDownRows) {
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const top = markerFeedbackTopForRow(
                it.assignedRow || 0,
                baseTop,
                rowStep,
                minTop,
                maxTop,
                maxDownRows,
            );
            it.topPx = top;
            it.span.style.top = top + 'px';
        }
    }

    function markerFeedbackLabelsOverlap(items, layerW, padX, padY) {
        for (let i = 0; i < items.length; i++) {
            const boxI = markerFeedbackLabelTextBox(items[i], layerW, items[i].topPx);
            for (let j = i + 1; j < items.length; j++) {
                const boxJ = markerFeedbackLabelTextBox(items[j], layerW, items[j].topPx);
                if (markerFeedbackLabelTextBoxesOverlap(boxI, boxJ, padX, padY)) {
                    return { a: i, b: j };
                }
            }
        }
        return null;
    }

    /** 1レーン帯内。横はマーカーと同じ % 固定。重なり時は下へ段を増やす。 */
    function layoutMarkerFeedbackLabels(layerEl, spans) {
        if (!layerEl || !spans || !spans.length) return;
        layerEl.hidden = false;
        const frag = document.createDocumentFragment();
        for (let i = 0; i < spans.length; i++) {
            frag.appendChild(spans[i]);
        }
        layerEl.appendChild(frag);

        const metrics = markerFeedbackLaneMetrics(layerEl);
        const layerW = Math.max(1, layerEl.clientWidth || metrics.layerW || 0);
        const layerH = metrics.layerH;
        if (layerW <= 0 || layerH <= 0) return;

        const firstRect = spans[0].getBoundingClientRect();
        const labelH = Math.max(10, firstRect.height || spans[0].offsetHeight || 14);
        const fontPx = parseFloat(getComputedStyle(spans[0]).fontSize) || 9;
        const lh = parseFloat(getComputedStyle(spans[0]).lineHeight);
        const linePx = lh > 3 ? lh : lh * fontPx;
        const rowStep = Math.max(labelH + 5, linePx + 8);
        const padX = 10;
        const padY = 8;
        const baseTop = labelH * 0.5 + 3;
        const minTop = labelH * 0.5 + 1;
        const maxTop = layerH - labelH * 0.5 - 1;
        const maxDownRows =
            rowStep > 0 ? Math.max(0, Math.floor((maxTop - baseTop) / rowStep)) : 0;
        const maxRow = Math.max(
            maxDownRows + Math.ceil((baseTop - minTop) / rowStep) + 2,
            24,
        );

        const items = [];
        const rangeBands = [];
        for (let i = 0; i < spans.length; i++) {
            const r = spans[i].getBoundingClientRect();
            const span = spans[i];
            const rangeLeftPct = parseFloat(span.dataset.rangeLeftPct);
            const rangeWidthPct = parseFloat(span.dataset.rangeWidthPct);
            const rangeStartSec = parseFloat(span.dataset.rangeStartSec);
            const rangeEndSec = parseFloat(span.dataset.rangeEndSec);
            const pointSec = parseFloat(span.dataset.pointSec);
            const isRange = rangeWidthPct > 0 && Number.isFinite(rangeLeftPct);
            const rangeCenterPct = isRange ? rangeLeftPct + rangeWidthPct * 0.5 : NaN;
            const anchorPct = isRange
                ? rangeCenterPct
                : parseFloat(span.style.left) || 0;
            const item = {
                span: span,
                height: Math.max(10, r.height || span.offsetHeight || labelH),
                textW: Math.max(r.width, span.offsetWidth || 0, span.scrollWidth || 0, 18),
                anchorPct: anchorPct,
                rangeCenterPct: Number.isFinite(rangeCenterPct) ? rangeCenterPct : NaN,
                rangeLeftPct: Number.isFinite(rangeLeftPct) ? rangeLeftPct : NaN,
                rangeWidthPct: Number.isFinite(rangeWidthPct) ? rangeWidthPct : 0,
                isPoint: !isRange,
                pointSec: Number.isFinite(pointSec) ? pointSec : NaN,
                startSec: Number.isFinite(rangeStartSec) ? rangeStartSec : NaN,
                endSec: Number.isFinite(rangeEndSec) ? rangeEndSec : NaN,
                rangeBands: rangeBands,
                assignedRow: 0,
                topPx: baseTop,
            };
            items.push(item);
            if (isRange) rangeBands.push(item);
        }
        items.sort((a, b) => a.anchorPct - b.anchorPct);
        const pointItems = items.filter((it) => it.isPoint);
        const rangeItems = items.filter((it) => !it.isPoint);
        const placementOrder = pointItems.concat(rangeItems);

        const pointPlaced = [];
        for (let i = 0; i < placementOrder.length; i++) {
            const it = placementOrder[i];
            let row = 0;
            if (!it.isPoint) {
                row = markerFeedbackMinRowForRangeBelowPoints(
                    it,
                    pointPlaced,
                    layerW,
                    baseTop,
                    padX,
                    padY,
                );
            }
            for (;;) {
                it.assignedRow = row;
                it.topPx = markerFeedbackTopForRow(
                    row,
                    baseTop,
                    rowStep,
                    minTop,
                    maxTop,
                    maxDownRows,
                );
                const candidate = markerFeedbackLabelTextBox(it, layerW, it.topPx);
                let hit = false;
                for (let j = 0; j < i; j++) {
                    const prev = markerFeedbackLabelTextBox(
                        placementOrder[j],
                        layerW,
                        placementOrder[j].topPx,
                    );
                    if (markerFeedbackLabelBoxOverlap(candidate, prev, padX, padY)) {
                        hit = true;
                        break;
                    }
                }
                if (!hit) {
                    if (it.isPoint) {
                        pointPlaced.push(it);
                    }
                    break;
                }
                row += 1;
                if (row > maxRow) {
                    it.assignedRow = maxRow;
                    it.topPx = markerFeedbackTopForRow(
                        maxRow,
                        baseTop,
                        rowStep,
                        minTop,
                        maxTop,
                        maxDownRows,
                    );
                    if (it.isPoint) {
                        pointPlaced.push(it);
                    }
                    break;
                }
            }
        }

        for (let pass = 0; pass < 48; pass++) {
            const pair = markerFeedbackLabelsOverlap(items, layerW, padX, padY);
            if (!pair) break;
            let bumpIdx = pair.b;
            const otherIdx = pair.a;
            if (items[bumpIdx].isPoint && !items[otherIdx].isPoint) {
                bumpIdx = pair.a;
            }
            const bump = items[bumpIdx];
            const anchor = items[bumpIdx === pair.b ? pair.a : pair.b];
            let nextRow = Math.max(bump.assignedRow || 0, anchor.assignedRow || 0) + 1;
            if (nextRow <= bump.assignedRow) nextRow = bump.assignedRow + 1;
            bump.assignedRow = Math.min(nextRow, maxRow);
            applyMarkerFeedbackLabelRows(
                items,
                baseTop,
                rowStep,
                minTop,
                maxTop,
                maxDownRows,
            );
        }

        applyMarkerFeedbackLabelRows(
            items,
            baseTop,
            rowStep,
            minTop,
            maxTop,
            maxDownRows,
        );
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const pct = markerFeedbackAnchorPct(it);
            it.span.style.left = pct + '%';
            it.span.style.top = it.topPx + 'px';
            if (it.isPoint) {
                it.span.style.transform = 'translate(0, -50%)';
            } else {
                it.span.style.transform = 'translate(-50%, -50%)';
            }
        }
    }

    function createSeekBarRangeBandElement(startSec, endSec, dur, opt) {
        const left = secToSeekRatio(startSec, dur);
        const right = secToSeekRatio(endSec, dur);
        const widthPct = Math.max(opt && opt.pending ? 0.12 : 0, right - left);
        if (widthPct <= 0 && !(opt && opt.pending)) return null;
        const el = document.createElement('div');
        const isActive = !!(opt && opt.active);
        const isPending = !!(opt && opt.pending);
        el.className =
            'seek-bar-marker seek-bar-marker--range' +
            (isPending ? ' seek-bar-marker--range-pending' : '') +
            (isActive ? ' seek-bar-marker--active' : '');
        el.style.left = left + '%';
        el.style.width = widthPct + '%';
        if (opt && opt.id) el.dataset.markerId = opt.id;
        if (opt && opt.title) el.title = opt.title;
        if (opt && opt.marker && !isPending) {
            const m = opt.marker;
            bindSeekBarMarkerPointerSeek(el, m, (ev) =>
                rangeMarkerTargetSecFromPointer(m, el, ev.clientX),
            );
            const handleIn = document.createElement('div');
            handleIn.className = 'seek-bar-marker__handle seek-bar-marker__handle--in';
            handleIn.title = 'Drag In';
            const handleOut = document.createElement('div');
            handleOut.className = 'seek-bar-marker__handle seek-bar-marker__handle--out';
            handleOut.title = 'Drag Out';
            el.appendChild(handleIn);
            el.appendChild(handleOut);
            bindSeekBarMarkerDrag(handleIn, m, 'in', { bandEl: el });
            bindSeekBarMarkerDrag(handleOut, m, 'out', { bandEl: el });
        }
        return el;
    }

    function createSeekBarPointElement(sec, dur, opt) {
        const el = document.createElement('div');
        const isActive = !!(opt && opt.active);
        el.className =
            'seek-bar-marker seek-bar-marker--point' + (isActive ? ' seek-bar-marker--active' : '');
        el.style.left = secToSeekRatio(sec, dur) + '%';
        if (opt && opt.id) el.dataset.markerId = opt.id;
        if (opt && opt.title) el.title = opt.title;
        if (opt && opt.marker) {
            const m = opt.marker;
            el.title = (opt.title || '') + ' — drag to move';
            bindSeekBarMarkerDrag(el, m, 'point');
        }
        return el;
    }

    function isMarkerVisibleOnSeekBar(m, dur) {
        if (!m || !dur || dur <= 0) return false;
        if (m.type === 'range') {
            const span = Math.abs(m.endSec - m.startSec);
            return span > markerOneFrameSec() + 1e-9;
        }
        const t = Number(m.timeSec);
        return Number.isFinite(t) && t >= 0 && t <= dur;
    }

    function renderTimelineMarkersLayer(containerEl) {
        if (!containerEl) return;
        containerEl.replaceChildren();
        containerEl.style.display = 'none';
        const labelLayer = markerLabelsLayerEl();
        if (labelLayer) {
            labelLayer.replaceChildren();
        }
        const dur = masterDurForTimelineMarkers();
        if (!dur || dur <= 0) return;

        const frag = document.createDocumentFragment();
        const feedbackLabelSpans = [];
        let drew = 0;
        currentMarkers.forEach((m) => {
            const active = m.id === activeMarkerId;
            if (m.type === 'range') {
                const left = secToSeekRatio(m.startSec, dur);
                const widthPct = Math.max(
                    0,
                    secToSeekRatio(m.endSec, dur) - left,
                );
                const el = createSeekBarRangeBandElement(m.startSec, m.endSec, dur, {
                    id: m.id,
                    active: active,
                    marker: m,
                    comment: m.comment || '',
                    title: markerTimeLabel(m) + (m.comment ? ' — ' + m.comment : ''),
                });
                if (el) {
                    frag.appendChild(el);
                    drew += 1;
                    if (labelLayer && m.comment) {
                        const span = createMarkerFeedbackLabelSpan(
                            m.comment,
                            markerFeedbackMaxCharsForWidthPct(widthPct),
                            markerTimeLabel(m) + ' — ' + m.comment,
                            {
                                leftPct: left,
                                widthPct: widthPct,
                                startSec: m.startSec,
                                endSec: m.endSec,
                            },
                        );
                        if (span) feedbackLabelSpans.push(span);
                    }
                }
            } else {
                const leftPct = secToSeekRatio(m.timeSec, dur);
                const el = createSeekBarPointElement(m.timeSec, dur, {
                    id: m.id,
                    active: active,
                    marker: m,
                    comment: m.comment || '',
                    title: tcLabelForSec(m.timeSec) + (m.comment ? ' — ' + m.comment : ''),
                });
                if (el) {
                    frag.appendChild(el);
                    drew += 1;
                    if (labelLayer && m.comment) {
                        const span = createMarkerFeedbackLabelSpan(
                            m.comment,
                            14,
                            tcLabelForSec(m.timeSec) + ' — ' + m.comment,
                            { leftPct: leftPct, point: true, pointSec: m.timeSec },
                        );
                        if (span) feedbackLabelSpans.push(span);
                    }
                }
            }
        });
        if (
            pendingRangeStartSec != null &&
            Number.isFinite(pendingRangeStartSec)
        ) {
            let start = pendingRangeStartSec;
            let end = currentTransportSec();
            if (end < start) {
                const swap = start;
                start = end;
                end = swap;
            }
            const pendingEl = createSeekBarRangeBandElement(start, end, dur, {
                pending: true,
                title:
                    'Range In ' +
                    tcLabelForSec(pendingRangeStartSec) +
                    ' — press ] for Out',
            });
            if (pendingEl) {
                frag.appendChild(pendingEl);
                drew += 1;
            }
        }
        if (drew > 0) {
            containerEl.appendChild(frag);
            containerEl.style.display = '';
            containerEl.hidden = false;
        } else {
            containerEl.hidden = true;
        }
        if (labelLayer) {
            if (feedbackLabelSpans.length > 0) {
                layoutMarkerFeedbackLabels(labelLayer, feedbackLabelSpans);
                labelLayer.hidden = false;
            } else {
                labelLayer.hidden = true;
            }
        }
    }

    function renderSeekBarMarkers() {
        renderAudioWaveformMarkers();
    }

    function renderAudioWaveformMarkers() {
        renderTimelineMarkersLayer(audioWaveformMarkers);
    }

    function refreshMarkerUi(opt) {
        const skipList =
            (opt && opt.skipMarkerList) || isMarkerTcInputFocused();
        if (!skipList) renderMarkerList();
        renderAudioWaveformMarkers();
        updateMarkerRangeHint();
    }

    function renderMarkerList() {
        const hasRows = currentMarkers.length > 0;

        if (markerTableWrap) markerTableWrap.hidden = !hasRows;
        if (markerListEmpty) markerListEmpty.hidden = hasRows;
        updateMarkerClearAllButton();

        if (!markerTableBody) return;
        markerTableBody.innerHTML = '';

        if (!hasRows) {
            return;
        }

        currentMarkers.forEach((m, idx) => {
            const tr = document.createElement('tr');
            tr.dataset.markerId = m.id;
            if (m.id === activeMarkerId) tr.className = 'marker-table__row--active';

            const tdNum = document.createElement('td');
            tdNum.className = 'marker-table__num';
            tdNum.textContent = String(idx + 1);
            bindMarkerRowSeekIn(tdNum, m);

            const tdIn = document.createElement('td');
            tdIn.className = 'marker-table__cell-info';
            tdIn.addEventListener('mouseenter', () => {
                if (isMarkerHoverBlockedByCommentFocus(m.id)) return;
                if (isMarkerRowHoverSeekBlocked()) return;
                if (isMarkerTcInputFocused()) return;
                markerActiveTcEdge = 'in';
                syncSeekToMarkerRow(m, { quiet: true, seekIn: true, fromRowHover: true });
            });
            tdIn.appendChild(createMarkerTcInput(m, 'in'));

            const tdOut = document.createElement('td');
            tdOut.className = 'marker-table__cell-info';
            tdOut.addEventListener('mouseenter', () => {
                if (isMarkerHoverBlockedByCommentFocus(m.id)) return;
                if (isMarkerRowHoverSeekBlocked()) return;
                if (isMarkerTcInputFocused()) return;
                markerActiveTcEdge = 'out';
                syncSeekToMarkerRow(m, {
                    quiet: true,
                    seekEnd: markerHasOutTc(m),
                    seekIn: !markerHasOutTc(m),
                    fromRowHover: true,
                });
            });
            tdOut.appendChild(createMarkerTcInput(m, 'out'));

            const tdDur = document.createElement('td');
            const durLabel = markerDurationLabel(m);
            tdDur.className =
                m.type === 'range'
                    ? 'marker-table__dur'
                    : 'marker-table__dur marker-table__dur--empty';
            tdDur.textContent = durLabel;
            bindMarkerRowSeekIn(tdDur, m);

            const tdComment = document.createElement('td');
            tdComment.className = 'marker-table__cell-info marker-table__cell-comment';
            bindMarkerRowSeekIn(tdComment, m);
            const comment = document.createElement('textarea');
            comment.className = 'marker-table__comment';
            comment.rows = 1;
            comment.placeholder = '';
            comment.value = m.comment || '';
            comment.dataset.markerComment = m.id;
            comment.addEventListener('pointerdown', (ev) => {
                if (ev.button !== 0) return;
                activateMarkerForCommentEdit(m);
            });
            comment.addEventListener('focus', () => {
                activateMarkerForCommentEdit(m);
            });
            comment.addEventListener('input', () => {
                updateMarkerComment(m.id, comment.value);
                fitMarkerCommentHeight(comment);
            });
            tdComment.appendChild(comment);
            requestAnimationFrame(() => fitMarkerCommentHeight(comment));

            const tdAct = document.createElement('td');
            tdAct.className = 'marker-table__act';
            bindMarkerRowSeekIn(tdAct, m);
            const actWrap = document.createElement('div');
            actWrap.className = 'marker-table__act-wrap';
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'marker-table__btn marker-table__btn--danger';
            delBtn.textContent = '×';
            delBtn.title = 'Delete';
            delBtn.addEventListener('click', () => removeMarker(m.id));
            actWrap.appendChild(delBtn);
            tdAct.appendChild(actWrap);

            tr.appendChild(tdNum);
            tr.appendChild(tdIn);
            tr.appendChild(tdOut);
            tr.appendChild(tdDur);
            tr.appendChild(tdComment);
            tr.appendChild(tdAct);
            markerTableBody.appendChild(tr);
        });
    }

    function clearMarkersForRevoke() {
        pendingRangeStartSec = null;
        activeMarkerId = null;
        pendingSessionMarkersForRestore = null;
        currentMarkers = [];
        markersByVideoKey.clear();
        renderMarkerList();
        renderSeekBarMarkers();
        updateMarkerRangeHint();
        updateMarkerClearAllButton();
        updateMarkerCommentOverlay();
    }

    function handleMarkerKeydown(e) {
        if (e.code !== 'KeyM') return false;
        if (e.repeat) return false;
        if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
        if (isTypingTarget(e.target)) return false;
        if (!markerTimelineReady()) return false;
        e.preventDefault();
        addPointMarkerAtCurrentTime();
        return true;
    }

    function handleMarkerBracketKeydown(e) {
        if (e.repeat) return false;
        if (e.ctrlKey || e.altKey || e.metaKey) return false;
        if (isTypingTarget(e.target)) return false;
        if (!markerTimelineReady()) return false;
        if (e.key === '[') {
            e.preventDefault();
            beginPendingRangeAtCurrentTime();
            return true;
        }
        if (e.key === ']') {
            if (pendingRangeStartSec == null) return false;
            e.preventDefault();
            completePendingRangeAtCurrentTime();
            return true;
        }
        return false;
    }

    function initMarkers() {
        const markerPanelEl = document.getElementById('markerPanel');
        if (markerPanelEl) {
            markerPanelEl.addEventListener(
                'keydown',
                (e) => {
                    if (handleMarkerPanelTcNudgeKeydown(e)) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                    }
                },
                true,
            );
        }
        window.addEventListener(
            'keydown',
            (e) => {
                if (handleMarkerNavigationKeydown(e)) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            },
            true,
        );
        if (markerClearAllBtn) {
            markerClearAllBtn.addEventListener('click', () => clearAllMarkers());
        }
        if (audioWaveformMarkers) {
            audioWaveformMarkers.replaceChildren();
            audioWaveformMarkers.style.display = 'none';
            audioWaveformMarkers.hidden = true;
        }
        renderMarkerList();
        renderSeekBarMarkers();
        updateMarkerRangeHint();
        updateMarkerCommentOverlay();

        const lanes =
            typeof audioWaveformLanesTracks !== 'undefined'
                ? audioWaveformLanesTracks
                : null;
        if (lanes && typeof ResizeObserver !== 'undefined') {
            let markerResizeRaf = 0;
            const obs = new ResizeObserver(() => {
                if (!currentMarkers.length) return;
                if (markerResizeRaf) return;
                markerResizeRaf = requestAnimationFrame(() => {
                    markerResizeRaf = 0;
                    if ((lanes.clientWidth | 0) > 0) renderSeekBarMarkers();
                });
            });
            obs.observe(lanes);
        }
    }
