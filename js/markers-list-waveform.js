/**
 * markers-list-waveform.js — 一覧 UI・波形マーカー描画・ショートカット。
 */
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

    /** ポインタ直下の範囲マーカー（In/Out 確定済み・pending 除く） */
    function resolveRangeMarkerAtPointer(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
        const hit = document.elementFromPoint(clientX, clientY);
        if (!hit || !hit.closest) return null;
        const band = hit.closest(
            '.seek-bar-marker--range:not(.seek-bar-marker--range-pending)',
        );
        if (!band || !band.dataset.markerId) return null;
        const m = currentMarkers.find((x) => x.id === band.dataset.markerId);
        if (!m || m.type !== 'range' || !markerHasOutTc(m)) return null;
        return {
            marker: m,
            startSec: m.startSec,
            endSec: m.endSec,
            element: band,
        };
    }

    window.resolveRangeMarkerAtPointer = resolveRangeMarkerAtPointer;

    function isMarkerListPlaybackActive() {
        return typeof isTransportPlaying === 'function' && isTransportPlaying();
    }

    /**
     * 指定時刻に対応するマーカー id（点は一致、範囲は In/Out および区間内。
     * 範囲が重なるときは In が遅い方＝一覧で後ろの行を優先）
     */
    function markerIdForTransportSec(transportSec) {
        if (!markerTimelineReady()) return null;
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return null;
        const eps = markerNavStopEpsilonSec();
        for (const m of currentMarkers) {
            if (m.type !== 'range' && Number.isFinite(m.timeSec) && Math.abs(t - m.timeSec) <= eps) {
                return m.id;
            }
        }
        for (const m of currentMarkers) {
            if (m.type === 'range') {
                if (Math.abs(t - m.startSec) <= eps) return m.id;
                if (markerHasOutTc(m) && Math.abs(t - m.endSec) <= eps) return m.id;
            }
        }
        let best = null;
        let bestStart = -Infinity;
        let bestIdx = -1;
        for (let i = 0; i < currentMarkers.length; i++) {
            const m = currentMarkers[i];
            if (m.type !== 'range' || !markerHasOutTc(m)) continue;
            const start = Number(m.startSec);
            const end = Number(m.endSec);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
            if (t <= start + eps || t >= end - eps) continue;
            if (start > bestStart || (start === bestStart && i > bestIdx)) {
                bestStart = start;
                bestIdx = i;
                best = m.id;
            }
        }
        return best;
    }

    function markerIdForWaveformPointerClientX(clientX) {
        if (clientX == null || !Number.isFinite(clientX)) return null;
        return markerIdForTransportSec(transportSecFromWaveformClientX(clientX));
    }

    /** MARKERS 一覧のオレンジ枠は常に最大 1 行。優先度の高い条件だけ採用する */
    function resolveMarkerListHighlightId() {
        if (markerDragState && markerDragState.m && markerDragState.m.id) {
            return markerDragState.m.id;
        }
        if (isMarkerTcInputFocused() && activeMarkerId) {
            return activeMarkerId;
        }
        const ae = document.activeElement;
        if (ae && ae.closest) {
            const comment = ae.closest('.marker-table__comment[data-marker-comment]');
            if (comment && comment.dataset.markerComment) {
                return comment.dataset.markerComment;
            }
        }
        if (!isMarkerListPlaybackActive()) {
            if (waveformLanesPointerInside && !isWaveformMarkerHighlightEnabled()) {
                return null;
            }
            if (markerPanelPointerInside && markerPanelHoverId) {
                return markerPanelHoverId;
            }
            if (isWaveformMarkerHighlightEnabled()) {
                if (waveformMarkerHoverId) {
                    return waveformMarkerHoverId;
                }
                if (waveformLanesPointerInside) {
                    const pointerX =
                        typeof getWaveformLanesPointerClientX === 'function'
                            ? getWaveformLanesPointerClientX()
                            : typeof getWaveformPointerClientX === 'function'
                              ? getWaveformPointerClientX()
                              : null;
                    const atPointer = markerIdForWaveformPointerClientX(pointerX);
                    if (atPointer) {
                        return atPointer;
                    }
                    const playheadId = markerIdForTransportSec(currentTransportSec());
                    if (playheadId) {
                        return playheadId;
                    }
                    return null;
                }
            }
            const playheadId = markerIdForTransportSec(currentTransportSec());
            if (playheadId) {
                return playheadId;
            }
        }
        if (markerPanelPointerInside && markerPanelHoverId) {
            return markerPanelHoverId;
        }
        if (transportMarkerHighlightId && isWaveformMarkerHighlightEnabled()) {
            return transportMarkerHighlightId;
        }
        if (markerPanelPointerInside && activeMarkerId) {
            return activeMarkerId;
        }
        return null;
    }

    function isMarkerListHighlightScrollBlocked() {
        if (markerDragState && markerDragState.m && markerDragState.m.id) return true;
        if (isMarkerTcInputFocused()) return true;
        const ae = document.activeElement;
        if (ae && ae.closest && ae.closest('.marker-table__comment[data-marker-comment]')) {
            return true;
        }
        if (markerPanelPointerInside && markerPanelHoverId) return true;
        return false;
    }

    function isMarkerListRowVisibleInWrap(markerId) {
        if (!markerTableBody || !markerTableWrap || markerTableWrap.hidden) return true;
        const row = markerTableBody.querySelector('tr[data-marker-id="' + markerId + '"]');
        if (!row) return true;
        const wrapRect = markerTableWrap.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const thead = markerTableWrap.querySelector('.marker-table thead');
        const headH = thead ? thead.getBoundingClientRect().height : 0;
        const margin = 2;
        const visibleTop = wrapRect.top + headH + margin;
        const visibleBottom = wrapRect.bottom - margin;
        return rowRect.top >= visibleTop && rowRect.bottom <= visibleBottom;
    }

    function scrollMarkerListRowIntoView(markerId) {
        if (!markerTableBody || !markerTableWrap || markerTableWrap.hidden) return false;
        const row = markerTableBody.querySelector('tr[data-marker-id="' + markerId + '"]');
        if (!row || !row.scrollIntoView) return false;
        if (isMarkerListRowVisibleInWrap(markerId)) return false;
        row.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        return true;
    }

    function followMarkerListHighlightScroll(highlightId) {
        if (highlightId == null) {
            lastMarkerListHighlightScrollId = null;
            return;
        }
        if (isMarkerListHighlightScrollBlocked()) return;
        const idChanged = highlightId !== lastMarkerListHighlightScrollId;
        const keepInViewDuringPlayback =
            isMarkerListPlaybackActive() && !isMarkerListRowVisibleInWrap(highlightId);
        if (!idChanged && !keepInViewDuringPlayback) return;
        if (scrollMarkerListRowIntoView(highlightId)) {
            lastMarkerListHighlightScrollId = highlightId;
        }
    }

    function updateMarkerListRowClasses() {
        if (!markerTableBody) return;
        const highlightId = resolveMarkerListHighlightId();
        const rows = markerTableBody.querySelectorAll('tr[data-marker-id]');
        rows.forEach((tr) => {
            tr.classList.toggle(
                'marker-table__row--active',
                highlightId != null && tr.dataset.markerId === highlightId,
            );
        });
        followMarkerListHighlightScroll(highlightId);
    }

    function markerTransportHighlightSeekThresholdSec() {
        return Math.max(markerNavStopEpsilonSec() * 4, 0.05);
    }

    function resetMarkerHighlightCrossQueue() {
        markerHighlightCrossQueue.length = 0;
        if (markerHighlightCrossRaf) {
            cancelAnimationFrame(markerHighlightCrossRaf);
            markerHighlightCrossRaf = 0;
        }
    }

    function enqueueMarkerHighlightCrossIds(ids) {
        if (!ids || !ids.length) return;
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            if (!id) continue;
            if (markerHighlightCrossQueue[markerHighlightCrossQueue.length - 1] === id) {
                continue;
            }
            markerHighlightCrossQueue.push(id);
        }
        while (markerHighlightCrossQueue.length > MARKER_HIGHLIGHT_CROSS_QUEUE_MAX) {
            markerHighlightCrossQueue.shift();
        }
        drainMarkerHighlightCrossQueue();
    }

    function drainMarkerHighlightCrossQueue() {
        if (markerHighlightCrossRaf) return;
        const step = () => {
            markerHighlightCrossRaf = 0;
            if (!markerHighlightCrossQueue.length) return;
            const id = markerHighlightCrossQueue.shift();
            applyTransportMarkerHighlightStep(id);
            if (markerHighlightCrossQueue.length) {
                markerHighlightCrossRaf = requestAnimationFrame(step);
            }
        };
        markerHighlightCrossRaf = requestAnimationFrame(step);
    }

    /**
     * 再生中に prevT→t で通過したマーカー停止（点・範囲 In/Out）を時系列順に返す。
     * 同一時刻は一覧で後ろの行（idx 大）を後に並べ、後着を最後にハイライトする。
     */
    function markerIdsCrossedBetweenSec(prevT, t, forward) {
        if (!Number.isFinite(prevT) || !Number.isFinite(t)) return [];
        const eps = 1e-9;
        const hits = [];
        for (let i = 0; i < currentMarkers.length; i++) {
            const m = currentMarkers[i];
            const push = (sec) => {
                if (!Number.isFinite(sec)) return;
                const crossed = forward
                    ? sec > prevT + eps && sec <= t + eps
                    : sec < prevT - eps && sec >= t - eps;
                if (crossed) hits.push({ id: m.id, sec: sec, idx: i });
            };
            if (m.type !== 'range') {
                push(Number(m.timeSec));
            } else {
                push(Number(m.startSec));
                if (markerHasOutTc(m)) push(Number(m.endSec));
            }
        }
        hits.sort((a, b) => {
            if (a.sec !== b.sec) return forward ? a.sec - b.sec : b.sec - a.sec;
            return a.idx - b.idx;
        });
        const ids = [];
        for (let i = 0; i < hits.length; i++) {
            const id = hits[i].id;
            if (ids[ids.length - 1] !== id) ids.push(id);
        }
        return ids;
    }

    function applyTransportMarkerHighlightStep(steppedId) {
        if (steppedId != null && transportMarkerHighlightId !== steppedId) {
            transportMarkerHighlightId = steppedId;
            updateMarkerListRowClasses();
        } else if (!isMarkerListPlaybackActive()) {
            updateMarkerListRowClasses();
        }
    }

    function updateTransportMarkerHighlight(transportSecOpt) {
        if (!isWaveformMarkerHighlightEnabled()) {
            if (transportMarkerHighlightId != null) {
                transportMarkerHighlightId = null;
                updateMarkerListRowClasses();
            }
            lastTransportSecForMarkerHighlight = null;
            resetMarkerHighlightCrossQueue();
            return;
        }
        if (!markerTimelineReady()) {
            if (transportMarkerHighlightId != null) {
                transportMarkerHighlightId = null;
                updateMarkerListRowClasses();
            }
            lastTransportSecForMarkerHighlight = null;
            resetMarkerHighlightCrossQueue();
            return;
        }
        const t =
            transportSecOpt != null && Number.isFinite(transportSecOpt)
                ? transportSecOpt
                : currentTransportSec();
        if (
            transportMarkerHighlightId &&
            !currentMarkers.some((m) => m.id === transportMarkerHighlightId)
        ) {
            transportMarkerHighlightId = null;
            lastTransportSecForMarkerHighlight = null;
            resetMarkerHighlightCrossQueue();
            updateMarkerListRowClasses();
            return;
        }

        const playing = isMarkerListPlaybackActive();
        if (!playing) {
            resetMarkerHighlightCrossQueue();
            lastTransportSecForMarkerHighlight = t;
            applyTransportMarkerHighlightStep(markerIdForTransportSec(t));
            return;
        }

        const prevT = lastTransportSecForMarkerHighlight;
        if (!Number.isFinite(prevT)) {
            lastTransportSecForMarkerHighlight = t;
            applyTransportMarkerHighlightStep(markerIdForTransportSec(t));
            return;
        }

        if (Math.abs(t - prevT) > markerTransportHighlightSeekThresholdSec()) {
            resetMarkerHighlightCrossQueue();
            lastTransportSecForMarkerHighlight = t;
            applyTransportMarkerHighlightStep(markerIdForTransportSec(t));
            return;
        }

        const forward = t >= prevT;
        const crossedIds = markerIdsCrossedBetweenSec(prevT, t, forward);
        lastTransportSecForMarkerHighlight = t;
        if (crossedIds.length > 0) {
            enqueueMarkerHighlightCrossIds(crossedIds);
            return;
        }
        const at = markerIdForTransportSec(t);
        if (at != null) {
            applyTransportMarkerHighlightStep(at);
        }
    }

    function setWaveformLanesPointerInside(inside) {
        if (waveformLanesPointerInside === inside) return;
        waveformLanesPointerInside = inside;
        if (!inside) {
            waveformMarkerHoverId = null;
        }
        updateMarkerListRowClasses();
    }

    function bindSeekBarMarkerListHighlight(el, markerId) {
        if (!el || !markerId) return;
        el.addEventListener('pointerenter', () => {
            if (!isWaveformMarkerHighlightEnabled()) return;
            if (isMarkerListPlaybackActive()) return;
            waveformMarkerHoverId = markerId;
            updateMarkerListRowClasses();
        });
        el.addEventListener('pointerleave', (ev) => {
            if (!isWaveformMarkerHighlightEnabled()) return;
            if (isMarkerListPlaybackActive()) return;
            const rel = ev.relatedTarget;
            if (rel && el.contains(rel)) return;
            if (waveformMarkerHoverId === markerId) {
                waveformMarkerHoverId = null;
                updateMarkerListRowClasses();
            }
        });
    }

    /** ドラッグ中など、一覧の再生成なしで In/Out/長さ表示だけモデルに合わせる */
    function syncMarkerListRowFromModel(m) {
        if (!markerTableBody || !m || !m.id) return;
        const row = markerTableBody.querySelector('tr[data-marker-id="' + m.id + '"]');
        if (!row) return;
        const inInput = row.querySelector(
            '.marker-table__tc-input[data-marker-tc-edge="in"]',
        );
        const outInput = row.querySelector(
            '.marker-table__tc-input[data-marker-tc-edge="out"]',
        );
        const durCell = row.querySelector('.marker-table__dur');
        if (inInput) {
            inInput.value = markerListRowTcValueForEdge(m, 'in');
        }
        if (outInput) {
            outInput.value = markerListRowTcValueForEdge(m, 'out');
            outInput.title = markerTcFieldTooltip('out', m.type === 'range');
        }
        if (durCell) {
            const dur = markerListRowDurationCell(m);
            durCell.textContent = dur.text;
            durCell.className = dur.className;
        }
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
        if (typeof syncTransportSeekUi === 'function') {
            syncTransportSeekUi(t, { markerHighlight: true });
        }
    }

    function commitMarkerTransportSeek(target, opt) {
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
            applyTransportAtSec(t, Object.assign({ resumeAfter: false }, opt || {}));
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
        if (opt.fromRowHover) {
            markerPanelHoverId = m.id;
        } else {
            activeMarkerId = m.id;
        }
        updateMarkerListRowClasses();
        if (!opt.seekIn && !opt.seekEnd) return;
        if (opt.fromRowHover && isMarkerRowHoverSeekSuppressed()) return;
        if (opt.fromRowHover && isMarkerRowHoverSeekBlocked()) return;
        if (opt.seekEnd && !markerHasOutTc(m)) return;
        const quiet = !!(opt && opt.quiet);
        const target = clampMarkerSec(opt.seekIn ? markerInSec(m) : m.endSec);
        const edgeLabel = opt.seekIn ? 'In' : 'Out';
        if (opt.seekEnd) markerActiveTcEdge = 'out';
        else if (opt.seekIn) markerActiveTcEdge = 'in';
        const t = commitMarkerTransportSeek(target, { resumeAfter: false });
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

    /** Alt+↑↓: フォーカス中の In / Out TC 欄の行インデックス */
    function markerNavIndexForTcNav(edge) {
        const ae = document.activeElement;
        if (
            ae &&
            ae.classList &&
            ae.classList.contains('marker-table__tc-input') &&
            ae.dataset.markerTcEdge === edge
        ) {
            const id = ae.dataset.markerFor;
            const i = currentMarkers.findIndex((m) => m.id === id);
            if (i >= 0) return i;
        }
        return markerNavIndexForCurrent();
    }

    function markerNavIndexForOutNav() {
        return markerNavIndexForTcNav('out');
    }

    /** Out TC 確定済み（range + endSec）の行だけを対象に前後へ */
    function findAdjacentMarkerIndexWithValidOut(fromIdx, dir) {
        const n = currentMarkers.length;
        if (n === 0) return -1;
        let i = fromIdx;
        if (i < 0) i = 0;
        for (let step = 0; step < n; step++) {
            i = (i + dir + n) % n;
            if (markerHasOutTc(currentMarkers[i])) return i;
        }
        return -1;
    }

    /** Alt+↑↓: Comment / In / Out 列。MARKERS 外からは null（Comment 扱い） */
    function markerListNavColumnFromFocus() {
        const ae = document.activeElement;
        if (!ae || !ae.closest) return null;
        if (ae.closest('.marker-table__comment[data-marker-comment]')) return 'comment';
        if (ae.classList && ae.classList.contains('marker-table__tc-input')) {
            const edge = ae.dataset.markerTcEdge;
            if (edge === 'in') return 'in';
            if (edge === 'out') return 'out';
        }
        return null;
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

    /** マーカー In/Out・点・動画終端（リージョン移動スナップ用） */
    function collectMarkerVideoEndSnapStops(opt) {
        const excludeId = opt && opt.excludeMarkerId;
        const stops = [];
        if (!markersDisplayHidden) {
            for (const m of currentMarkers) {
                if (excludeId && m.id === excludeId) continue;
                if (m.type === 'range') {
                    if (Number.isFinite(m.startSec)) stops.push(m.startSec);
                    if (markerHasOutTc(m) && Number.isFinite(m.endSec)) stops.push(m.endSec);
                } else if (Number.isFinite(m.timeSec)) {
                    stops.push(m.timeSec);
                }
            }
        }
        appendVideoEndSnapStop(stops);
        return stops;
    }

    /** マーカー In/Out・点・動画終端（リージョン／トラックオフセットドラッグ用） */
    function snapSecToMarkerInOut(sec, opt) {
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            return n;
        }
        const stops = collectMarkerVideoEndSnapStops(opt);
        const threshold =
            opt && Number.isFinite(opt.thresholdSec) && opt.thresholdSec > 0
                ? opt.thresholdSec
                : markerNavStopEpsilonSec();
        let best = n;
        if (stops.length) {
            let bestDist = threshold + 1;
            for (let i = 0; i < stops.length; i++) {
                const d = Math.abs(stops[i] - n);
                if (d <= threshold && d < bestDist) {
                    bestDist = d;
                    best = stops[i];
                }
            }
        }
        if (typeof snapSecToMusicalGridStops === 'function') {
            return snapSecToMusicalGridStops(best, {
                thresholdSec: threshold,
                altKey: opt && opt.altKey,
            });
        }
        return best;
    }

    window.snapSecToMarkerInOut = snapSecToMarkerInOut;
    window.collectMarkerVideoEndSnapStops = collectMarkerVideoEndSnapStops;

    function collectVisibleRegionSnapStopsForMarkerDrag() {
        if (typeof collectRegionSnapStops !== 'function') return [];
        if (typeof getVisibleLoadedExtraTrackSlots !== 'function') {
            return collectRegionSnapStops(null, -1);
        }
        const visibleSlots = getVisibleLoadedExtraTrackSlots();
        if (!Array.isArray(visibleSlots) || visibleSlots.length === 0) return [];
        const stops = [];
        for (let i = 0; i < visibleSlots.length; i++) {
            const slot = visibleSlots[i];
            if (!Number.isFinite(slot)) continue;
            const slotStops = collectRegionSnapStops(null, slot);
            if (Array.isArray(slotStops) && slotStops.length) {
                stops.push(...slotStops);
            }
        }
        return stops;
    }

    function collectSeekBarSnapStopsForMarkerDrag() {
        if (typeof seekBar === 'undefined' || !seekBar || seekBar.hidden) return [];
        const stops = [];
        const seekValue = Number(seekBar.value);
        if (Number.isFinite(seekValue)) stops.push(seekValue);
        if (typeof isRangeLoopPlaybackActive === 'function' && isRangeLoopPlaybackActive()) {
            if (typeof getRangeLoopInSec === 'function') {
                const inSec = Number(getRangeLoopInSec());
                if (Number.isFinite(inSec)) stops.push(inSec);
            }
            if (typeof getRangeLoopOutSec === 'function') {
                const outSec = Number(getRangeLoopOutSec());
                if (Number.isFinite(outSec)) stops.push(outSec);
            }
        }
        return stops;
    }

    function collectAllVisibleMarkerDragSnapStops(m) {
        const stops = [];
        if (!markersDisplayHidden && currentMarkers.length > 0) {
            stops.push(
                ...collectMarkerVideoEndSnapStops(
                    m && m.id ? { excludeMarkerId: m.id } : undefined,
                ),
            );
        }
        if (typeof hasMusicalGridSnapStops === 'function' && hasMusicalGridSnapStops()) {
            if (typeof collectMusicalGridSnapStops === 'function') {
                stops.push(...collectMusicalGridSnapStops());
            }
        }
        stops.push(...collectVisibleRegionSnapStopsForMarkerDrag());
        stops.push(...collectSeekBarSnapStopsForMarkerDrag());
        return stops;
    }

    function snapRangeMarkerMoveAnchorTransportSec(sec, m, dragState) {
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        if (!m || m.type !== 'range' || !dragState) return n;
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt()) {
            return n;
        }
        const anchor = Number(dragState.dragAnchorSec);
        const s0 = Number(dragState.dragStartStartSec);
        const e0 = Number(dragState.dragStartEndSec);
        if (!Number.isFinite(anchor) || !Number.isFinite(s0) || !Number.isFinite(e0)) {
            return n;
        }
        const threshold =
            typeof regionSnapThresholdSec === 'function'
                ? regionSnapThresholdSec()
                : markerNavStopEpsilonSec();
        const deltaRaw = n - anchor;
        const proposedStart = s0 + deltaRaw;
        const proposedEnd = e0 + deltaRaw;
        const stops = collectAllVisibleMarkerDragSnapStops(m);
        if (!stops.length) return n;

        let bestAnchor = n;
        let bestDist = threshold + 1;
        for (let i = 0; i < stops.length; i++) {
            const stop = stops[i];
            if (!Number.isFinite(stop)) continue;
            const dStart = Math.abs(stop - proposedStart);
            if (dStart <= threshold && dStart < bestDist) {
                bestDist = dStart;
                bestAnchor = anchor + (stop - s0);
            }
            const dEnd = Math.abs(stop - proposedEnd);
            if (dEnd <= threshold && dEnd < bestDist) {
                bestDist = dEnd;
                bestAnchor = anchor + (stop - e0);
            }
        }
        return bestAnchor;
    }

    /** 波形マーカードラッグ: 他マーカー In/Out・点・動画終端＋全リージョン In/Out */
    function snapMarkerDragTransportSec(sec, m) {
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt()) {
            return n;
        }
        const threshold =
            typeof regionSnapThresholdSec === 'function'
                ? regionSnapThresholdSec()
                : markerNavStopEpsilonSec();
        const stops = collectAllVisibleMarkerDragSnapStops(m);
        if (!stops.length) return n;
        let best = n;
        let bestDist = threshold + 1;
        for (let i = 0; i < stops.length; i++) {
            const s = stops[i];
            if (!Number.isFinite(s)) continue;
            const d = Math.abs(s - n);
            if (d <= threshold && d < bestDist) {
                bestDist = d;
                best = s;
            }
        }
        return best;
    }

    function markerNavStopIndexForCurrent(stops, dir) {
        if (!stops || stops.length === 0) return -1;
        const t = currentTransportSec();
        const eps = markerNavStopEpsilonSec();
        if (activeMarkerId) {
            const m = currentMarkers.find((x) => x.id === activeMarkerId);
            if (m) {
                if (m.type === 'range' && markerHasOutTc(m)) {
                    const startIdx = stops.findIndex(
                        (s) => s.marker && s.marker.id === m.id && s.edge === 'start',
                    );
                    const endIdx = stops.findIndex(
                        (s) => s.marker && s.marker.id === m.id && s.edge === 'end',
                    );
                    if (startIdx >= 0 && endIdx >= 0) {
                        const inside =
                            t > m.startSec + eps && t < m.endSec - eps;
                        if (!inside) {
                            if (Math.abs(t - m.startSec) <= eps) return startIdx;
                            if (Math.abs(t - m.endSec) <= eps) return endIdx;
                        }
                    }
                } else if (m.type !== 'range') {
                    const i = stops.findIndex((s) => s.marker && s.marker.id === m.id);
                    if (i >= 0 && Math.abs(t - m.timeSec) <= eps) return i;
                }
            }
        }
        // Shift+↓（手前）: 再生中は次の停止点を基準にしないと、
        // 通過済みの停止点で idx が決まり 2 つ分戻ってしまう
        if (dir < 0) {
            for (let i = 0; i < stops.length; i++) {
                if (stops[i].sec > t - eps) return i;
            }
            let best = -1;
            for (let i = 0; i < stops.length; i++) {
                if (stops[i].sec <= t + eps) best = i;
                else break;
            }
            return best;
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
        const t = commitMarkerTransportSeek(target, { resumeAfter: resumeAfter });
        syncMarkerSeekTransportUi(t);
        activeMarkerId = m.id;
        updateMarkerListRowClasses();
        renderSeekBarMarkers();
        const hintTc = tcLabelForSec(t);
        const hintSuffix =
            m.type === 'range' && !(opt && Number.isFinite(opt.targetSec))
                ? seekEnd
                    ? ' Out'
                    : ' In'
                : '';
        writeLog('Marker: seek to ' + hintTc + hintSuffix);
        flashSeekHint('Marker', hintTc + hintSuffix);
        const focusTcEdge = opt && opt.focusTcEdge;
        if (focusComment) {
            suppressMarkerRowHoverSeek(300);
            focusMarkerCommentField(m.id, { sync: true });
        } else if (focusTcEdge === 'in' || focusTcEdge === 'out') {
            suppressMarkerRowHoverSeek(300);
            if (typeof focusMarkerTcInput === 'function') {
                focusMarkerTcInput(m.id, focusTcEdge);
            }
            const input =
                markerTableBody &&
                markerTableBody.querySelector(
                    '.marker-table__tc-input[data-marker-for="' +
                        m.id +
                        '"][data-marker-tc-edge="' +
                        focusTcEdge +
                        '"]',
                );
            const row = input && input.closest('tr');
            if (row && row.scrollIntoView) {
                row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
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

    function setMarkerDragLanesActive(active, opt) {
        const lanes =
            typeof audioWaveformLanesTracks !== 'undefined' && audioWaveformLanesTracks
                ? audioWaveformLanesTracks
                : null;
        if (!lanes) return;
        const edge = opt && opt.edge;
        lanes.classList.toggle('audio-waveform-composite__lanes--marker-dragging', !!active);
        lanes.classList.toggle(
            'audio-waveform-composite__lanes--marker-dragging-range-move',
            !!active && edge === 'move',
        );
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
        const t =
            edge === 'move' && m && m.type === 'range'
                ? clampMarkerSec(snapRangeMarkerMoveAnchorTransportSec(sec, m, markerDragState))
                : clampMarkerSec(snapMarkerDragTransportSec(sec, m));
        const oneFrame = markerOneFrameSec();
        if (m.type === 'point') {
            m.timeSec = t;
            return;
        }
        if (edge === 'move') {
            if (!markerDragState) return;
            const anchor = markerDragState.dragAnchorSec;
            const s0 = markerDragState.dragStartStartSec;
            const e0 = markerDragState.dragStartEndSec;
            if (
                !Number.isFinite(anchor) ||
                !Number.isFinite(s0) ||
                !Number.isFinite(e0)
            ) {
                return;
            }
            const delta = t - anchor;
            const span = e0 - s0;
            let newStart = s0 + delta;
            let newEnd = e0 + delta;
            const dur = masterDurForTimelineMarkers();
            const maxEnd = dur > 0 ? dur - 0.001 : e0;
            if (newStart < 0) {
                newStart = 0;
                newEnd = span;
            }
            if (newEnd > maxEnd) {
                newEnd = maxEnd;
                newStart = newEnd - span;
            }
            if (newStart < 0) newStart = 0;
            m.startSec = newStart;
            m.endSec = newEnd;
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
            syncMarkerListRowFromModel(markerDragState.m);
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
        setMarkerDragLanesActive(false, { edge: st.edge });
        if (commit) {
            collapseRangeMarkerToPointIfNarrow(st.m, { silent: true });
            sortMarkersInPlace();
            persistMarkersAfterChange({ forceMarkerList: true });
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
            if (
                edge === 'move' &&
                ev.target.closest &&
                ev.target.closest('.seek-bar-marker__handle')
            ) {
                return;
            }
            if (typeof syncSnapSuppressionFromPointerEvent === 'function') {
                syncSnapSuppressionFromPointerEvent(ev);
            }
            ev.preventDefault();
            ev.stopPropagation();
            if (typeof endAudioWaveformScrub === 'function') {
                endAudioWaveformScrub({ force: true });
            }
            if (typeof hideHoverPlayhead === 'function') hideHoverPlayhead();

            const bandEl = opt && opt.bandEl ? opt.bandEl : null;
            endMarkerDrag(false);
            const pointerSec = transportSecFromWaveformClientX(ev.clientX);
            const moveAnchor =
                edge === 'move' && m.type === 'range'
                    ? clampMarkerSec(snapMarkerDragTransportSec(pointerSec, m))
                    : NaN;
            markerDragState = {
                m: m,
                edge: edge,
                bandEl: bandEl,
                pointerId: ev.pointerId,
                startX: ev.clientX,
                moved: false,
                raf: 0,
                dragAnchorSec: moveAnchor,
                dragStartStartSec:
                    edge === 'move' && m.type === 'range' ? m.startSec : NaN,
                dragStartEndSec:
                    edge === 'move' && m.type === 'range' ? m.endSec : NaN,
                onMove: null,
                onUp: null,
            };
            activeMarkerId = m.id;
            updateMarkerListRowClasses();

            markerDragState.onMove = (e) => {
                if (!markerDragState || e.pointerId !== markerDragState.pointerId) return;
                if (typeof syncSnapSuppressionFromPointerEvent === 'function') {
                    syncSnapSuppressionFromPointerEvent(e);
                }
                if (Math.abs(e.clientX - markerDragState.startX) >= 4) {
                    if (!markerDragState.moved) {
                        markerDragState.moved = true;
                        setMarkerDragLanesActive(true, { edge: markerDragState.edge });
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
                setMarkerDragLanesActive(false, { edge: st.edge });
                if (!st.moved) {
                    seekToMarkerOnClick(m, edge, e.clientX, bandEl);
                    return;
                }
                if (st.edge !== 'move') {
                    collapseRangeMarkerToPointIfNarrow(m, { silent: true });
                }
                sortMarkersInPlace();
                persistMarkersAfterChange({ forceMarkerList: true });
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
        let navColumn = (opt && opt.column) || null;
        if (!navColumn && opt && opt.focusComment) navColumn = 'comment';
        if (!navColumn) navColumn = markerListNavColumnFromFocus();
        if (!navColumn) navColumn = 'comment';

        let idx;
        if (navColumn === 'comment') {
            idx = markerNavIndexForCommentNav();
        } else if (navColumn === 'in') {
            idx = markerNavIndexForTcNav('in');
        } else if (navColumn === 'out') {
            idx = markerNavIndexForOutNav();
        } else {
            idx = markerNavIndexForCurrent();
        }

        if (navColumn === 'out') {
            const nextIdx = findAdjacentMarkerIndexWithValidOut(idx, dir);
            if (nextIdx < 0) return false;
            idx = nextIdx;
        } else {
            if (idx < 0) idx = 0;
            idx = (idx + dir + n) % n;
        }

        const m = currentMarkers[idx];
        const seekOpt = {
            resumeAfterSeek: !!(opt && opt.resumeAfterSeek),
            seekEnd: navColumn === 'out',
        };
        if (navColumn === 'comment') {
            seekOpt.focusComment = true;
            seekOpt.seekEnd = false;
        } else if (navColumn === 'in') {
            seekOpt.focusTcEdge = 'in';
        } else if (navColumn === 'out') {
            seekOpt.focusTcEdge = 'out';
        }
        seekToMarker(m, seekOpt);
        return true;
    }

    function jumpToAdjacentMarkerStop(dir, opt) {
        const stops = buildMarkerNavStops();
        const n = stops.length;
        if (n === 0) return false;
        const idx = markerNavStopIndexForCurrent(stops, dir);
        const t = currentTransportSec();
        const eps = markerNavStopEpsilonSec();
        let next;
        if (idx < 0) {
            if (dir <= 0) return false;
            next = 0;
        } else if (dir < 0 && t > stops[idx].sec + eps) {
            // 通過済みの手前停止点へ（単一マーカーで再生位置が後ろのとき等）
            next = idx;
        } else if (dir > 0 && t < stops[idx].sec - eps) {
            // 未到達の次の停止点へ
            next = idx;
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

    /** Alt+↑↓: 一覧行ナビ（Comment / In / Out 列。テキスト入力中も有効） */
    function isMarkerFeedbackRowNavKeydown(e) {
        if (!e || e.ctrlKey || e.metaKey || !e.altKey || e.shiftKey) return false;
        return (
            matchUserShortcut(e, 'markerNavigateUp', { allowRepeat: true }) ||
            matchUserShortcut(e, 'markerNavigateDown', { allowRepeat: true })
        );
    }

    function handleMarkerNavigationKeydown(e) {
        if (!markerTimelineReady()) return false;
        const isUp = matchUserShortcut(e, 'markerNavigateUp', { allowRepeat: true });
        const isDown = matchUserShortcut(e, 'markerNavigateDown', { allowRepeat: true });
        if (!isUp && !isDown) return false;
        if (e.ctrlKey || e.metaKey) return false;

        const inMarkerPanel = isMarkerAreaKeyboardActive({ target: e.target });
        // トランスポート有効時: ↑↓（↑=次、↓=前）。Markers パネル内: Shift+↑↓
        // マーカー非表示時はフォーカス位置に関わらず ↑↓ でリージョン In/Out へ
        const markerStopNav =
            !e.altKey &&
            (markersDisplayHidden ||
                e.shiftKey ||
                (!inMarkerPanel && markerTimelineReady()));

        // Alt+↑↓: 一覧内の行移動（↑=上の行、↓=下の行）。列はフォーカス先に追従
        if (e.altKey && !e.shiftKey) {
            if (currentMarkers.length === 0) return false;
            const dir = isUp ? -1 : 1;
            e.preventDefault();
            suppressMarkerRowHoverSeek(300);
            const column = markerListNavColumnFromFocus();
            jumpToAdjacentMarker(dir, column ? { column: column } : { focusComment: true });
            return true;
        }

        if (markerStopNav) {
            const dir = isUp ? 1 : -1;
            if (isTypingTarget(e.target)) return false;
            const wasPlaying =
                typeof isTransportUiClockActive === 'function'
                    ? isTransportUiClockActive()
                    : typeof isTransportPlaying === 'function'
                      ? isTransportPlaying()
                      : !videoMain.paused;
            const navOpt = {
                focusComment: false,
                resumeAfterSeek: wasPlaying,
            };
            const markerNavActive = !markersDisplayHidden && currentMarkers.length > 0;
            const musicalNavActive =
                typeof hasMusicalGridSnapStops === 'function' && hasMusicalGridSnapStops();
            if (markerNavActive) {
                e.preventDefault();
                jumpToAdjacentMarkerStop(dir, navOpt);
                return true;
            }
            if (
                musicalNavActive &&
                typeof jumpToAdjacentMusicalGridStop === 'function' &&
                jumpToAdjacentMusicalGridStop(dir, navOpt)
            ) {
                e.preventDefault();
                return true;
            }
            if (musicalNavActive) {
                return false;
            }
            if (markersDisplayHidden) {
                if (typeof jumpToAdjacentRegionStop !== 'function') return false;
                if (!jumpToAdjacentRegionStop(dir, navOpt)) return false;
                e.preventDefault();
                return true;
            }
            if (typeof jumpToAdjacentRegionStop !== 'function') return false;
            if (!jumpToAdjacentRegionStop(dir, navOpt)) return false;
            e.preventDefault();
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
            const handleIn = document.createElement('div');
            handleIn.className = 'seek-bar-marker__handle seek-bar-marker__handle--in';
            handleIn.title = 'In をドラッグ';
            const handleOut = document.createElement('div');
            handleOut.className = 'seek-bar-marker__handle seek-bar-marker__handle--out';
            handleOut.title = 'Out をドラッグ';
            el.appendChild(handleIn);
            el.appendChild(handleOut);
            bindSeekBarMarkerDrag(el, m, 'move', { bandEl: el });
            bindSeekBarMarkerDrag(handleIn, m, 'in', { bandEl: el });
            bindSeekBarMarkerDrag(handleOut, m, 'out', { bandEl: el });
            bindSeekBarMarkerListHighlight(el, opt.id);
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
            bindSeekBarMarkerListHighlight(el, opt.id);
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
        if (!dur || dur <= 0) {
            containerEl.hidden = true;
            return;
        }

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
        if (markersDisplayHidden) {
            hideMarkersVisualLayers();
            return;
        }
        if (typeof applyWaveformTimelineZoomLayout === 'function') {
            applyWaveformTimelineZoomLayout();
        }
        renderTimelineMarkersLayer(audioWaveformMarkers);
        if (
            audioWaveformMarkers &&
            audioWaveformMarkers.hidden &&
            currentMarkers.length > 0
        ) {
            const lanes =
                typeof audioWaveformLanesTracks !== 'undefined' && audioWaveformLanesTracks
                    ? audioWaveformLanesTracks
                    : null;
            if (lanes && (lanes.clientWidth | 0) > 0) {
                requestAnimationFrame(() => renderTimelineMarkersLayer(audioWaveformMarkers));
            }
        }
    }

    function refreshMarkerUi(opt) {
        const skipList =
            (opt && opt.skipMarkerList) ||
            (isMarkerTcInputFocused() && !(opt && opt.forceMarkerList));
        if (!skipList) renderMarkerList();
        else updateMarkerListRowClasses();
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
        lastMarkerListHighlightScrollId = null;

        if (!hasRows) {
            return;
        }
        if (typeof updateSessionAllClearButton === 'function') {
            updateSessionAllClearButton();
        }

        currentMarkers.forEach((m, idx) => {
            const tr = document.createElement('tr');
            tr.dataset.markerId = m.id;

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
            const durCell = markerListRowDurationCell(m);
            tdDur.className = durCell.className;
            tdDur.textContent = durCell.text;
            bindMarkerRowSeekIn(tdDur, m);

            const tdComment = document.createElement('td');
            tdComment.className = 'marker-table__cell-info marker-table__cell-comment';
            bindMarkerRowSeekIn(tdComment, m);
            const comment = document.createElement('textarea');
            comment.className = 'marker-table__comment';
            comment.rows = 1;
            comment.placeholder = '';
            comment.value = m.comment || '';
            const th =
                typeof window.SHORTCUT_HINTS !== 'undefined' ? window.SHORTCUT_HINTS : {};
            const feedbackNav = th.feedbackRowNav || 'Alt+↑/↓';
            const cancelEdit = th.cancelEdit || 'Esc';
            comment.title =
                'Feedback を編集（' +
                feedbackNav +
                ' で前後の行、' +
                cancelEdit +
                ' で編集終了）';
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
            comment.addEventListener('keydown', (ev) => {
                if (!matchUserShortcut(ev, 'cancelEditing', { allowRepeat: true })) return;
                ev.preventDefault();
                ev.stopPropagation();
                if (!clearActiveMarkerTarget()) {
                    focusWaveformDrawingArea();
                }
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
            const delHint =
                typeof window.SHORTCUT_HINTS !== 'undefined' && window.SHORTCUT_HINTS.markerDelete
                    ? window.SHORTCUT_HINTS.markerDelete
                    : 'Del';
            delBtn.title = 'マーカーを削除（' + delHint + '）';
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
        updateMarkerListRowClasses();
    }

    function clearMarkersForRevoke() {
        resetInsertMarkerPressState();
        pendingRangeStartSec = null;
        activeMarkerId = null;
        markerPanelHoverId = null;
        waveformLanesPointerInside = false;
        waveformMarkerHoverId = null;
        transportMarkerHighlightId = null;
        lastTransportSecForMarkerHighlight = null;
        resetMarkerHighlightCrossQueue();
        lastMarkerListHighlightScrollId = null;
        pendingSessionMarkersForRestore = null;
        sessionMarkersRestorePayload = null;
        sessionMarkerMemoRestorePayload = null;
        currentMarkers = [];
        currentMarkerMemo = '';
        markersByVideoKey.clear();
        markerMemoByVideoKey.clear();
        syncMarkerMemoTextarea();
        renderMarkerList();
        renderSeekBarMarkers();
        updateMarkerRangeHint();
        updateMarkerClearAllButton();
        updateMarkerCommentOverlay();
    }

    function handleMarkerKeydown(e) {
        if (!matchUserShortcut(e, 'markerInsert')) return false;
        if (isTypingTarget(e.target)) return false;
        if (!markerTimelineReady()) return false;
        e.preventDefault();
        resetInsertMarkerPressState();
        insertMarkerPressAtMs = performance.now();
        insertMarkerPressSec = currentTransportSec();
        insertMarkerLongPressTimer = setTimeout(() => {
            insertMarkerLongPressTimer = null;
            if (insertMarkerPressAtMs == null) return;
            insertMarkerLongPressStarted = true;
            beginPendingRangeAtSec(insertMarkerPressSec);
        }, MARKER_INSERT_RANGE_HOLD_MS);
        return true;
    }

    function handleMarkerKeyup(e) {
        if (!matchUserShortcut(e, 'markerInsert', { allowRepeat: true })) return false;
        if (insertMarkerPressAtMs == null) return false;

        const pressAt = insertMarkerPressAtMs;
        const pressSec = insertMarkerPressSec;
        const longStarted = insertMarkerLongPressStarted;
        resetInsertMarkerPressState();

        if (!markerTimelineReady()) return true;
        e.preventDefault();

        const durationMs = performance.now() - pressAt;
        if (durationMs < MARKER_INSERT_RANGE_HOLD_MS) {
            if (longStarted || pendingRangeStartSec != null) {
                cancelPendingRange();
            }
            addPointMarkerAtSec(pressSec);
            return true;
        }

        if (pendingRangeStartSec != null) {
            completePendingRangeAtCurrentTime();
        } else {
            pendingRangeStartSec = null;
            updateMarkerRangeHint();
            addRangeMarkerBetweenSecs(pressSec, currentTransportSec());
        }
        return true;
    }

    function handleMarkerHideViewKeydown(e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return false;
        if (!matchUserShortcut(e, 'markerHideToggle')) return false;
        if (isTypingTarget(e.target)) return false;
        if (!markerTimelineReady()) return false;
        if (currentMarkers.length === 0) return false;
        e.preventDefault();
        toggleMarkersDisplayHidden();
        return true;
    }

    window.handleMarkerHideViewKeydown = handleMarkerHideViewKeydown;

    function handleMarkerBracketKeydown(e) {
        if (e.repeat) return false;
        if (e.ctrlKey || e.altKey || e.metaKey) return false;
        if (isTypingTarget(e.target)) return false;
        if (!markerTimelineReady()) return false;
        if (matchUserShortcut(e, 'markerRangeStart', { allowRepeat: true })) {
            e.preventDefault();
            beginPendingRangeAtCurrentTime();
            return true;
        }
        if (matchUserShortcut(e, 'markerRangeEnd', { allowRepeat: true })) {
            if (pendingRangeStartSec == null) return false;
            e.preventDefault();
            completePendingRangeAtCurrentTime();
            return true;
        }
        return false;
    }

