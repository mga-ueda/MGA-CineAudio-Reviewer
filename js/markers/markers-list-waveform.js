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

    /** Rehearsal モード中・再生中の Ins マーカー確定時のみ 4 分音符（拍）へクオンタイズ */
    function quantizeMarkerInsSecIfNeeded(sec) {
        if (
            typeof getMusicalGridRehearsalFillVisible !== 'function' ||
            !getMusicalGridRehearsalFillVisible() ||
            !isMarkerListPlaybackActive() ||
            typeof snapSecToMusicalGridQuarterNote !== 'function'
        ) {
            return sec;
        }
        return snapSecToMusicalGridQuarterNote(sec);
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
            if (
                typeof isMarkerPanelInteractionActive === 'function' &&
                isMarkerPanelInteractionActive() &&
                activeMarkerId &&
                currentMarkers.some((x) => x.id === activeMarkerId)
            ) {
                return activeMarkerId;
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
        if (
            typeof isMarkerPanelInteractionActive === 'function' &&
            isMarkerPanelInteractionActive() &&
            activeMarkerId &&
            currentMarkers.some((x) => x.id === activeMarkerId)
        ) {
            return activeMarkerId;
        }
        if (transportMarkerHighlightId && isWaveformMarkerHighlightEnabled()) {
            return transportMarkerHighlightId;
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
        if (!row) return false;
        if (isMarkerListRowVisibleInWrap(markerId)) return false;

        const wrap = markerTableWrap;
        const thead = wrap.querySelector('.marker-table thead');
        const headH = thead ? thead.getBoundingClientRect().height : 0;
        const margin = 2;
        const wrapRect = wrap.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const visibleTop = wrapRect.top + headH + margin;
        const visibleBottom = wrapRect.bottom - margin;
        let delta = 0;
        if (rowRect.top < visibleTop) {
            delta = rowRect.top - visibleTop;
        } else if (rowRect.bottom > visibleBottom) {
            delta = rowRect.bottom - visibleBottom;
        } else {
            return false;
        }
        const prev = wrap.scrollTop;
        wrap.scrollTop = Math.max(0, prev + delta);
        return wrap.scrollTop !== prev;
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
        const resumeAfter = !!(opt && opt.resumeAfter);
        const o = opt && typeof opt === 'object' ? opt : {};
        if (
            o.discreteStopNav &&
            typeof applyDiscreteStopNavStep === 'function'
        ) {
            applyDiscreteStopNavStep(t, {
                resumeAfterSeek: resumeAfter,
                fromRepeat: o.fromRepeat,
            });
            return t;
        }
        if (typeof applyJumpTransportSeek === 'function') {
            applyJumpTransportSeek(t, resumeAfter);
        } else if (typeof applyTransportAtSec === 'function') {
            applyTransportAtSec(t, { resumeAfter: resumeAfter });
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
        if (opt.seekEnd) markerActiveTcEdge = 'out';
        else if (opt.seekIn) markerActiveTcEdge = 'in';
        const t = commitMarkerTransportSeek(target, { resumeAfter: false });
        syncMarkerSeekTransportUi(t);
        renderSeekBarMarkers();
        if (!quiet) {
            const hintSuffix =
                m.type === 'range' ? (opt.seekIn ? ' In' : ' Out') : '';
            writeLog('Marker: row sync ' + tcLabelForSec(t) + hintSuffix);
            flashMarkerSeekHint(m, tcLabelForSec(t), hintSuffix);
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
        if (
            typeof isMarkerPanelInteractionActive === 'function' &&
            isMarkerPanelInteractionActive() &&
            activeMarkerId
        ) {
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

    /** マーカー In/Out・点のみ（動画終端は別途 appendVideoEndSnapStop） */
    function collectMarkerOnlySnapStops(opt) {
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
        return stops;
    }

    /** マーカー In/Out・点・動画終端（リージョン移動スナップ用） */
    function collectMarkerVideoEndSnapStops(opt) {
        const stops = collectMarkerOnlySnapStops(opt);
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
    window.appendVideoEndSnapStop = appendVideoEndSnapStop;
    window.collectMarkerOnlySnapStops = collectMarkerOnlySnapStops;
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

    function markerNavStopIndexForCurrent(stops, dir, fromSec) {
        if (!stops || stops.length === 0) return -1;
        const t = Number.isFinite(fromSec) ? fromSec : currentTransportSec();
        const eps = markerNavStopEpsilonSec();
        if (
            !Number.isFinite(fromSec) &&
            typeof isMarkerPanelInteractionActive === 'function' &&
            isMarkerPanelInteractionActive() &&
            activeMarkerId
        ) {
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

    const MARKER_SEEK_TOAST_COMMENT_MAX_CHARS = 48;

    function markerCommentForSeekToast(m) {
        if (!m) return '';
        const raw = String(m.comment || '').replace(/\s+/g, ' ').trim();
        if (!raw) return '';
        if (raw.length <= MARKER_SEEK_TOAST_COMMENT_MAX_CHARS) return raw;
        return raw.slice(0, MARKER_SEEK_TOAST_COMMENT_MAX_CHARS) + '...';
    }

    function flashMarkerSeekHint(m, hintTc, hintSuffix) {
        if (typeof flashSeekHint !== 'function') return;
        const suffix = hintSuffix || '';
        const comment = markerCommentForSeekToast(m);
        flashSeekHint((comment || 'Marker') + suffix, hintTc);
    }

    function markerSeekHintSuffix(m, opt, targetSec) {
        if (!m || m.type !== 'range') return '';
        if (opt && opt.seekEnd) return ' Out';
        if (opt && opt.seekIn) return ' In';
        if (Number.isFinite(targetSec)) {
            const eps = markerNavStopEpsilonSec();
            if (Math.abs(targetSec - m.endSec) <= eps) return ' Out';
            if (Math.abs(targetSec - m.startSec) <= eps) return ' In';
            return Math.abs(targetSec - m.endSec) < Math.abs(targetSec - m.startSec)
                ? ' Out'
                : ' In';
        }
        return ' In';
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
        const t = commitMarkerTransportSeek(target, {
            resumeAfter: resumeAfter,
            discreteStopNav: !!(opt && opt.discreteStopNav),
            fromRepeat: !!(opt && opt.fromRepeat),
        });
        syncMarkerSeekTransportUi(t);
        markerPanelHoverId = null;
        waveformMarkerHoverId = null;
        transportMarkerHighlightId = m.id;
        lastTransportSecForMarkerHighlight = t;
        resetMarkerHighlightCrossQueue();
        activeMarkerId = m.id;
        updateMarkerListRowClasses();
        renderSeekBarMarkers();
        if (!(opt && opt.fromRepeat)) {
            const hintTc = tcLabelForSec(t);
            const hintSuffix = markerSeekHintSuffix(m, opt, target);
            writeLog('Marker: seek to ' + hintTc + hintSuffix);
            flashMarkerSeekHint(m, hintTc, hintSuffix);
        }
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

    function isMarkerWaveformDragActive() {
        return !!(markerDragState && markerDragState.m);
    }

    /** ドラッグ中に currentMarkers が clone 差し替えされても、常に live モデルを更新する */
    function markerLiveModelForDrag(stOrId) {
        const id =
            stOrId && typeof stOrId === 'object'
                ? stOrId.markerId || (stOrId.m && stOrId.m.id)
                : stOrId;
        if (!id) return null;
        return currentMarkers.find((x) => x.id === id) || null;
    }

    /** pointerup 確定時: live モデルを返す（孤立 st.m から live へはコピーしない） */
    function markerCommitModelForDrag(st) {
        if (!st) return null;
        let live = markerLiveModelForDrag(st);
        if (!live) live = st.m;
        if (!live) return null;
        if (st.moved && Number.isFinite(st.lastAppliedSec)) {
            const cur = markerSecSnapshotForDrag(live, st.edge);
            if (!Number.isFinite(cur) || Math.abs(cur - st.lastAppliedSec) > 1e-9) {
                applyMarkerDragSec(live, st.edge, st.lastAppliedSec);
            }
        }
        return live;
    }

    const MARKER_WAVEFORM_DBLCLICK_MS = 450;
    const MARKER_WAVEFORM_DBLCLICK_SLOP_PX = 12;
    let markerWaveformClickState = null;
    let markerWaveformClickSeekTimer = 0;

    function cancelMarkerWaveformClickSeek() {
        if (!markerWaveformClickSeekTimer) return;
        clearTimeout(markerWaveformClickSeekTimer);
        markerWaveformClickSeekTimer = 0;
    }

    function tryMarkerWaveformDoubleClick(m, clientX, clientY) {
        const now = performance.now();
        const prev = markerWaveformClickState;
        const isDouble =
            !!prev &&
            prev.id === m.id &&
            now - prev.at <= MARKER_WAVEFORM_DBLCLICK_MS &&
            Math.abs(clientX - prev.x) <= MARKER_WAVEFORM_DBLCLICK_SLOP_PX &&
            Math.abs(clientY - prev.y) <= MARKER_WAVEFORM_DBLCLICK_SLOP_PX;
        markerWaveformClickState = isDouble
            ? null
            : { id: m.id, at: now, x: clientX, y: clientY };
        return isDouble;
    }

    function zoomWaveformToMarker(m) {
        if (!m) return;
        activeMarkerId = m.id;
        updateMarkerListRowClasses();
        if (typeof handleWaveformTimelineDoubleClickZoom !== 'function') return;
        if (m.type === 'range' && markerHasOutTc(m)) {
            handleWaveformTimelineDoubleClickZoom({
                rangeStartSec: m.startSec,
                rangeEndSec: m.endSec,
            });
        } else if (m.type === 'point') {
            handleWaveformTimelineDoubleClickZoom({ sec: m.timeSec });
        }
    }

    function scheduleMarkerWaveformClickSeek(m, edge, clientX, bandEl) {
        cancelMarkerWaveformClickSeek();
        markerWaveformClickSeekTimer = setTimeout(() => {
            markerWaveformClickSeekTimer = 0;
            seekToMarkerOnClick(m, edge, clientX, bandEl);
        }, MARKER_WAVEFORM_DBLCLICK_MS);
    }

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
            const live = markerLiveModelForDrag(markerDragState) || markerDragState.m;
            syncMarkerListRowFromModel(live);
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
            const m = markerCommitModelForDrag(st);
            if (!m) return;
            collapseRangeMarkerToPointIfNarrow(m, { silent: true });
            sortMarkersInPlace();
            sessionMarkersRestorePayload = null;
            persistMarkersAfterChange({ forceMarkerList: true });
            writeLog('Marker: drag ' + markerTimeLabel(m));
            flashSeekHint('Marker', markerTimeLabel(m));
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
        const seekOpt = {
            targetSec: target,
            resumeAfterSeek: wasPlaying,
        };
        if (m.type === 'range') {
            if (edge === 'out') seekOpt.seekEnd = true;
            else if (edge === 'in') seekOpt.seekIn = true;
        }
        seekToMarker(m, seekOpt);
    }

    const SEEK_BAR_MARKER_POINTER_HIT_SLOP_PX = 12;
    const SEEK_BAR_MARKER_HANDLE_HIT_SLOP_PX = 14;

    function seekBarMarkerBandElForId(markerId) {
        if (!markerId) return null;
        const container =
            typeof audioWaveformMarkers !== 'undefined' ? audioWaveformMarkers : null;
        if (!container) return null;
        return container.querySelector(
            '.seek-bar-marker--range[data-marker-id="' + markerId + '"]',
        );
    }

    function isPointerInsideTimelineLanes(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        const el =
            (typeof audioWaveformLanesInner !== 'undefined' && audioWaveformLanesInner) ||
            (typeof audioWaveformLanesTracks !== 'undefined' && audioWaveformLanesTracks);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    }

    /** ポインタ clientX → タイムライン内容座標 px（マーカー left と同じ系） */
    function waveformPointerTimelineContentPx(clientX) {
        if (!Number.isFinite(clientX)) return null;
        if (
            typeof waveformScrubTargetEl !== 'function' ||
            typeof waveformTimelineMetrics !== 'function'
        ) {
            return null;
        }
        const lanes = waveformScrubTargetEl();
        const m = waveformTimelineMetrics(lanes);
        if (!m || !(m.scrubW > 0)) return null;
        const xInViewport = clientX - m.contentLeft;
        return xInViewport + (m.scrollable ? m.scrollLeft : 0);
    }

    function seekBarMarkerTimelineContentPxForSec(sec) {
        if (typeof timelineSecToContentPx === 'function') {
            return timelineSecToContentPx(sec);
        }
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const contentW =
            typeof masterTimelineWidthCss === 'function'
                ? Math.max(1, masterTimelineWidthCss() | 0)
                : 0;
        const n = Number(sec);
        if (!Number.isFinite(n) || !(master > 0) || !contentW) return 0;
        return Math.max(0, Math.min(contentW, Math.round((n / master) * contentW)));
    }

    function refineSeekBarMarkerDragEdgeFromDirectTarget(ev, m, edge, bandEl) {
        if (!ev || !ev.target || !ev.target.closest || !m || m.type !== 'range') {
            return { m: m, edge: edge, bandEl: bandEl };
        }
        let nextEdge = edge;
        if (ev.target.closest('.seek-bar-marker__handle--in')) {
            nextEdge = 'in';
        } else if (ev.target.closest('.seek-bar-marker__handle--out')) {
            nextEdge = 'out';
        }
        return { m: m, edge: nextEdge, bandEl: bandEl };
    }

    function markerSecSnapshotForDrag(m, edge) {
        if (!m) return NaN;
        if (m.type === 'point') return Number(m.timeSec);
        if (edge === 'out') return Number(m.endSec);
        return Number(m.startSec);
    }

    function rejectMarkerDragTarget(ev, reason) {
        if (typeof markerPointerDiagLogResolve === 'function') {
            markerPointerDiagLogResolve(ev, null, { reason: reason });
        }
        return null;
    }

    function logMarkerDragTargetResolved(ev, result, hitVia) {
        if (typeof markerPointerDiagLogResolve === 'function') {
            markerPointerDiagLogResolve(ev, result, { hitVia: hitVia });
        }
        return result;
    }

    /** リージョン In/Out・Fade 操作帯上では MARKERS ドラッグに譲らない */
    function isPointerOnRegionResizeHandleForAnyTrack(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        if (
            typeof isPointerInRegionEwCursorHitZone === 'function' &&
            isPointerInRegionEwCursorHitZone(clientX, clientY)
        ) {
            return true;
        }
        if (typeof resolveRegionResizeHandleAtPointer !== 'function') return false;
        const n = typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        for (let slot = 0; slot < n; slot++) {
            const hit = resolveRegionResizeHandleAtPointer(
                { type: 'extra', slot },
                clientX,
                clientY,
            );
            if (hit) return true;
        }
        if (typeof collectVideoPlaybackRegionLaneContexts === 'function') {
            const contexts = collectVideoPlaybackRegionLaneContexts();
            for (let vi = 0; vi < contexts.length; vi++) {
                const hit = resolveRegionResizeHandleAtPointer(
                    contexts[vi].track,
                    clientX,
                    clientY,
                );
                if (hit) return true;
            }
        }
        return false;
    }

    /** Musical トラックが前面でも、描画 px 座標で最寄りマーカーを拾う */
    function resolveSeekBarMarkerPointerDragTargetFromTime(clientX, clientY) {
        if (!Number.isFinite(clientX) || !isPointerInsideTimelineLanes(clientX, clientY)) {
            return null;
        }
        const pointerPx = waveformPointerTimelineContentPx(clientX);
        if (!Number.isFinite(pointerPx)) return null;

        const slopPx = SEEK_BAR_MARKER_POINTER_HIT_SLOP_PX;
        const handleSlopPx = SEEK_BAR_MARKER_HANDLE_HIT_SLOP_PX;
        let best = null;
        let bestDistPx = Infinity;

        for (let i = 0; i < currentMarkers.length; i++) {
            const m = currentMarkers[i];
            if (m.type === 'point') {
                const t = Number(m.timeSec);
                if (!Number.isFinite(t)) continue;
                const distPx = Math.abs(pointerPx - seekBarMarkerTimelineContentPxForSec(t));
                if (distPx <= slopPx && distPx < bestDistPx) {
                    bestDistPx = distPx;
                    best = { m, edge: 'point', bandEl: null };
                }
                continue;
            }
            if (m.type !== 'range') continue;
            const start = Number(m.startSec);
            if (!Number.isFinite(start)) continue;
            const startPx = seekBarMarkerTimelineContentPxForSec(start);
            const bandEl = seekBarMarkerBandElForId(m.id);

            if (!markerHasOutTc(m)) {
                const distInPx = Math.abs(pointerPx - startPx);
                if (distInPx <= handleSlopPx && distInPx < bestDistPx) {
                    bestDistPx = distInPx;
                    best = { m, edge: 'in', bandEl: bandEl };
                }
                continue;
            }

            const end = Number(m.endSec);
            if (!Number.isFinite(end) || end <= start) continue;
            const endPx = seekBarMarkerTimelineContentPxForSec(end);
            const spanPx = Math.max(1, endPx - startPx);
            const handleSlop = Math.max(handleSlopPx, spanPx * 0.08);

            const dInPx = Math.abs(pointerPx - startPx);
            if (dInPx <= handleSlop && dInPx < bestDistPx) {
                bestDistPx = dInPx;
                best = { m, edge: 'in', bandEl: bandEl };
            }
            const dOutPx = Math.abs(pointerPx - endPx);
            if (dOutPx <= handleSlop && dOutPx < bestDistPx) {
                bestDistPx = dOutPx;
                best = { m, edge: 'out', bandEl: bandEl };
            }
            if (pointerPx >= startPx - slopPx && pointerPx <= endPx + slopPx) {
                let distPx = 0;
                if (pointerPx < startPx) distPx = startPx - pointerPx;
                else if (pointerPx > endPx) distPx = pointerPx - endPx;
                if (distPx <= slopPx && distPx < bestDistPx) {
                    bestDistPx = distPx;
                    best = { m, edge: 'move', bandEl: bandEl };
                } else if (
                    pointerPx >= startPx + handleSlop &&
                    pointerPx <= endPx - handleSlop &&
                    Math.min(dInPx, dOutPx) < bestDistPx
                ) {
                    bestDistPx = Math.min(dInPx, dOutPx);
                    best = { m, edge: 'move', bandEl: bandEl };
                }
            }
        }
        return best;
    }

    function resolveSeekBarMarkerPointerDragTarget(ev) {
        if (!ev || ev.button !== 0) {
            return rejectMarkerDragTarget(ev, 'not-left-button');
        }
        if (markersDisplayHidden || !currentMarkers.length) {
            return rejectMarkerDragTarget(
                ev,
                markersDisplayHidden ? 'markers-display-hidden' : 'no-markers',
            );
        }
        if (isPointerOnRegionResizeHandleForAnyTrack(ev.clientX, ev.clientY)) {
            return rejectMarkerDragTarget(ev, 'region-handle-zone');
        }
        const container =
            typeof audioWaveformMarkers !== 'undefined' ? audioWaveformMarkers : null;
        if (!container || container.hidden) {
            return rejectMarkerDragTarget(ev, 'marker-layer-hidden');
        }
        const markerStyle = window.getComputedStyle(container);
        if (markerStyle.display === 'none' || markerStyle.visibility === 'hidden') {
            return rejectMarkerDragTarget(ev, 'marker-layer-css-hidden');
        }

        const direct =
            ev.target &&
            ev.target.closest &&
            ev.target.closest('.seek-bar-marker:not(.seek-bar-marker--range-pending)');

        const fromTime = resolveSeekBarMarkerPointerDragTargetFromTime(
            ev.clientX,
            ev.clientY,
        );
        if (fromTime) {
            if (direct && direct.dataset.markerId === fromTime.m.id) {
                return logMarkerDragTargetResolved(
                    ev,
                    refineSeekBarMarkerDragEdgeFromDirectTarget(
                        ev,
                        fromTime.m,
                        fromTime.edge,
                        fromTime.bandEl,
                    ),
                    direct ? 'timePx+direct' : 'timePx',
                );
            }
            return logMarkerDragTargetResolved(ev, fromTime, 'timePx');
        }

        if (direct && direct.dataset.markerId) {
            const m = currentMarkers.find((x) => x.id === direct.dataset.markerId);
            if (!m) return rejectMarkerDragTarget(ev, 'direct-unknown-id');
            let edge = m.type === 'range' ? 'move' : 'point';
            let bandEl = m.type === 'range' ? direct : null;
            if (m.type === 'range') {
                if (ev.target.closest('.seek-bar-marker__handle--in')) {
                    edge = 'in';
                } else if (ev.target.closest('.seek-bar-marker__handle--out')) {
                    edge = 'out';
                } else if (!direct.classList.contains('seek-bar-marker--range')) {
                    bandEl = direct.closest('.seek-bar-marker--range');
                }
            }
            return logMarkerDragTargetResolved(ev, { m, edge, bandEl }, 'direct');
        }

        const slop = SEEK_BAR_MARKER_POINTER_HIT_SLOP_PX;
        const cx = ev.clientX;
        const cy = ev.clientY;
        const inTimeline = isPointerInsideTimelineLanes(cx, cy);
        const markers = container.querySelectorAll(
            '.seek-bar-marker:not(.seek-bar-marker--range-pending)',
        );
        let best = null;
        let bestDist = Infinity;
        for (let i = 0; i < markers.length; i++) {
            const el = markers[i];
            const r = el.getBoundingClientRect();
            if (!Number.isFinite(r.left)) continue;
            if (!inTimeline && !(cy >= r.top - 1 && cy <= r.bottom + 1)) continue;
            const id = el.dataset.markerId;
            const m = id ? currentMarkers.find((x) => x.id === id) : null;
            if (!m) continue;

            if (el.classList.contains('seek-bar-marker--point')) {
                const center = r.left + r.width * 0.5;
                const dist = Math.abs(cx - center);
                if (dist <= slop && dist < bestDist) {
                    bestDist = dist;
                    best = { m, edge: 'point', bandEl: null };
                }
                continue;
            }
            if (!el.classList.contains('seek-bar-marker--range')) continue;

            const handleIn = el.querySelector('.seek-bar-marker__handle--in');
            const handleOut = el.querySelector('.seek-bar-marker__handle--out');
            if (handleIn) {
                const hr = handleIn.getBoundingClientRect();
                if (cx >= hr.left - slop && cx <= hr.right + slop) {
                    const dist = Math.min(Math.abs(cx - hr.left), Math.abs(cx - hr.right));
                    if (dist < bestDist) {
                        bestDist = dist;
                        best = { m, edge: 'in', bandEl: el };
                    }
                }
            }
            if (handleOut) {
                const hr = handleOut.getBoundingClientRect();
                if (cx >= hr.left - slop && cx <= hr.right + slop) {
                    const dist = Math.min(Math.abs(cx - hr.left), Math.abs(cx - hr.right));
                    if (dist < bestDist) {
                        bestDist = dist;
                        best = { m, edge: 'out', bandEl: el };
                    }
                }
            }
            if (cx >= r.left - slop && cx <= r.right + slop) {
                const dist =
                    cx < r.left ? r.left - cx : cx > r.right ? cx - r.right : 0;
                if (dist < bestDist) {
                    bestDist = dist;
                    best = { m, edge: 'move', bandEl: el };
                }
            }
        }
        return best
            ? logMarkerDragTargetResolved(ev, best, 'geom')
            : rejectMarkerDragTarget(ev, 'no-hit');
    }

    function beginSeekBarMarkerDragFromPointer(ev, dragTarget) {
        if (!ev || ev.button !== 0 || !dragTarget || !dragTarget.m) return false;
        const m = dragTarget.m;
        const edge = dragTarget.edge;
        const bandEl = dragTarget.bandEl || null;
        if (
            edge === 'move' &&
            ev.target &&
            ev.target.closest &&
            ev.target.closest('.seek-bar-marker__handle')
        ) {
            if (typeof markerPointerDiagLog === 'function') {
                markerPointerDiagLog('marker/reject', {
                    reason: 'move-on-handle-element',
                    marker: { id: m.id, edge: edge },
                });
            }
            return false;
        }
        if (
            markerDragState &&
            markerDragState.pointerId === ev.pointerId &&
            markerDragState.m &&
            markerDragState.m.id === m.id
        ) {
            return true;
        }
        cancelMarkerWaveformClickSeek();
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof ev.stopImmediatePropagation === 'function') {
            ev.stopImmediatePropagation();
        }
        if (typeof endAudioWaveformScrub === 'function') {
            endAudioWaveformScrub({ force: true });
        }
        if (typeof hideHoverPlayhead === 'function') hideHoverPlayhead();

        const lanes =
            typeof audioWaveformLanesTracks !== 'undefined' ? audioWaveformLanesTracks : null;
        if (lanes && ev.pointerId != null && typeof lanes.setPointerCapture === 'function') {
            try {
                lanes.setPointerCapture(ev.pointerId);
            } catch (_) {}
        }

        endMarkerDrag(false);
        const pointerSec = transportSecFromWaveformClientX(ev.clientX);
        const moveAnchor =
            edge === 'move' && m.type === 'range'
                ? clampMarkerSec(snapMarkerDragTransportSec(pointerSec, m))
                : NaN;
        markerDragState = {
            m: m,
            markerId: m.id,
            edge: edge,
            bandEl: bandEl,
            pointerId: ev.pointerId,
            startX: ev.clientX,
            moved: false,
            raf: 0,
            dragStartLog:
                typeof markerTimeLabel === 'function' ? markerTimeLabel(m) : String(m.id),
            dragStartSec: markerSecSnapshotForDrag(m, edge),
            lastPointerSec: pointerSec,
            lastAppliedSec: markerSecSnapshotForDrag(m, edge),
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
        if (typeof markerPointerDiagLogMarkerBegin === 'function') {
            markerPointerDiagLogMarkerBegin(ev, dragTarget, {
                dragStartSec: markerDragState.dragStartSec,
            });
        }

        markerDragState.onMove = (e) => {
            if (!markerDragState || e.pointerId !== markerDragState.pointerId) return;
            if (Math.abs(e.clientX - markerDragState.startX) >= 4) {
                if (!markerDragState.moved) {
                    markerDragState.moved = true;
                    setMarkerDragLanesActive(true, { edge: markerDragState.edge });
                }
            }
            if (!markerDragState.moved) return;
            e.preventDefault();
            const live = markerLiveModelForDrag(markerDragState);
            if (!live) return;
            const dragEdge = markerDragState.edge;
            const pointerSec = transportSecFromWaveformClientX(e.clientX);
            markerDragState.lastPointerSec = pointerSec;
            applyMarkerDragSec(live, dragEdge, pointerSec);
            markerDragState.lastAppliedSec = markerSecSnapshotForDrag(live, dragEdge);
            if (typeof markerPointerDiagLogMarkerMove === 'function') {
                markerPointerDiagLogMarkerMove(markerDragState, {
                    liveDetached: live !== markerDragState.m,
                });
            }
            scheduleMarkerDragRedraw();
        };
            markerDragState.onUp = (e) => {
                if (!markerDragState || e.pointerId !== markerDragState.pointerId) return;
                const st = markerDragState;
                const m = markerCommitModelForDrag(st);
                if (!m) {
                    markerDragState = null;
                    setMarkerDragLanesActive(false, { edge: st.edge });
                    return;
                }
                const lanesUp =
                    typeof audioWaveformLanesTracks !== 'undefined'
                        ? audioWaveformLanesTracks
                        : null;
                if (
                    lanesUp &&
                    typeof lanesUp.releasePointerCapture === 'function' &&
                    lanesUp.hasPointerCapture &&
                    lanesUp.hasPointerCapture(st.pointerId)
                ) {
                    try {
                        lanesUp.releasePointerCapture(st.pointerId);
                    } catch (_) {}
                }
                detachMarkerDragDocListeners();
            if (st.raf) cancelAnimationFrame(st.raf);
            if (typeof markerPointerDiagLogMarkerUp === 'function') {
                markerPointerDiagLogMarkerUp(st, {
                    clickOnly: !st.moved,
                    liveDetached: !!(m && st.m && m !== st.m),
                    dragEnd:
                        m && typeof markerTimeLabel === 'function' ? markerTimeLabel(m) : null,
                    liveSec:
                        m && m.type === 'point'
                            ? m.timeSec
                            : m && m.type === 'range'
                              ? st.edge === 'out'
                                  ? m.endSec
                                  : m.startSec
                              : null,
                    commitSec: Number.isFinite(st.lastAppliedSec) ? st.lastAppliedSec : null,
                    orphanSec:
                        st.m && st.m.type === 'point'
                            ? st.m.timeSec
                            : st.m && st.m.type === 'range'
                              ? st.edge === 'out'
                                  ? st.m.endSec
                                  : st.m.startSec
                              : null,
                });
            }
            markerDragState = null;
            setMarkerDragLanesActive(false, { edge: st.edge });
            if (!st.moved) {
                if (tryMarkerWaveformDoubleClick(m, e.clientX, e.clientY)) {
                    e.preventDefault();
                    e.stopPropagation();
                    cancelMarkerWaveformClickSeek();
                    zoomWaveformToMarker(m);
                    return;
                }
                scheduleMarkerWaveformClickSeek(m, edge, e.clientX, bandEl);
                return;
            }
            if (st.edge !== 'move') {
                collapseRangeMarkerToPointIfNarrow(m, { silent: true });
            }
            sortMarkersInPlace();
            sessionMarkersRestorePayload = null;
            persistMarkersAfterChange({ forceMarkerList: true });
            const fromLog = st.dragStartLog || '';
            const toLog =
                typeof markerTimeLabel === 'function' ? markerTimeLabel(m) : String(m.id);
            writeLog(
                'Marker: drag' +
                    (fromLog && fromLog !== toLog ? ' ' + fromLog + ' → ' + toLog : ' ' + toLog),
            );
            flashSeekHint('Marker', markerTimeLabel(m));
        };
        document.addEventListener('pointermove', markerDragState.onMove);
        document.addEventListener('pointerup', markerDragState.onUp);
        document.addEventListener('pointercancel', markerDragState.onUp);
        return true;
    }

    /** lanes capture — Musical トラック等が前面でもマーカー線付近ならシークより先にドラッグ開始 */
    function handleSeekBarMarkerPointerDownCapture(ev) {
        const dragTarget = resolveSeekBarMarkerPointerDragTarget(ev);
        if (!dragTarget) return false;
        return beginSeekBarMarkerDragFromPointer(ev, dragTarget);
    }

    function bindSeekBarMarkerDrag(el, m, edge, opt) {
        el.addEventListener('pointerdown', (ev) => {
            if (opt && opt.pending) return;
            beginSeekBarMarkerDragFromPointer(ev, {
                m: m,
                edge: edge,
                bandEl: opt && opt.bandEl ? opt.bandEl : null,
            });
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

    function resolveAdjacentMarkerStopSec(dir, fromSec) {
        const stops = buildMarkerNavStops();
        const n = stops.length;
        if (n === 0) return null;
        const idx = markerNavStopIndexForCurrent(stops, dir, fromSec);
        const t = Number.isFinite(fromSec) ? fromSec : currentTransportSec();
        const eps = markerNavStopEpsilonSec();
        let next;
        if (idx < 0) {
            if (dir <= 0) return null;
            next = 0;
        } else if (dir < 0 && t > stops[idx].sec + eps) {
            next = idx;
        } else if (dir > 0 && t < stops[idx].sec - eps) {
            next = idx;
        } else {
            next = idx + dir;
            if (next < 0 || next >= n) return null;
        }
        const sec = stops[next].sec;
        return Number.isFinite(sec) ? sec : null;
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
            next = idx;
        } else if (dir > 0 && t < stops[idx].sec - eps) {
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
            discreteStopNav: !!(opt && opt.discreteStopNav),
            fromRepeat: !!(opt && opt.fromRepeat),
        });
        return true;
    }

    function resolveAdjacentStopNavigationTargetSec(dir, fromSec) {
        const markerNavActive = !markersDisplayHidden && currentMarkers.length > 0;
        const musicalNavActive =
            typeof hasMusicalGridSnapStops === 'function' && hasMusicalGridSnapStops();
        if (markerNavActive) {
            return resolveAdjacentMarkerStopSec(dir, fromSec);
        }
        if (
            musicalNavActive &&
            typeof resolveAdjacentMusicalGridStopSec === 'function'
        ) {
            const sec = resolveAdjacentMusicalGridStopSec(dir, fromSec);
            if (sec != null) return sec;
        }
        if (musicalNavActive) {
            return null;
        }
        if (typeof resolveAdjacentRegionStopSec === 'function') {
            return resolveAdjacentRegionStopSec(dir, fromSec);
        }
        return null;
    }

    window.resolveAdjacentStopNavigationTargetSec = resolveAdjacentStopNavigationTargetSec;

    /** Alt+↑↓: 一覧行ナビ（Comment / In / Out 列。テキスト入力中も有効） */
    function isMarkerFeedbackRowNavKeydown(e) {
        if (!e || e.ctrlKey || e.metaKey || !e.altKey || e.shiftKey) return false;
        return (
            matchUserShortcut(e, 'markerNavigateUp', { allowRepeat: true }) ||
            matchUserShortcut(e, 'markerNavigateDown', { allowRepeat: true })
        );
    }

    function markerStopNavigationResumeAfterSeek() {
        return typeof isTransportUiClockActive === 'function'
            ? isTransportUiClockActive()
            : typeof isTransportPlaying === 'function'
              ? isTransportPlaying()
              : !videoMain.paused;
    }

    function runAdjacentStopNavigation(dir, navOpt) {
        const markerNavActive = !markersDisplayHidden && currentMarkers.length > 0;
        const musicalNavActive =
            typeof hasMusicalGridSnapStops === 'function' && hasMusicalGridSnapStops();
        if (markerNavActive) {
            return jumpToAdjacentMarkerStop(dir, navOpt);
        }
        if (
            musicalNavActive &&
            typeof jumpToAdjacentMusicalGridStop === 'function' &&
            jumpToAdjacentMusicalGridStop(dir, navOpt)
        ) {
            return true;
        }
        if (musicalNavActive) {
            return false;
        }
        if (typeof jumpToAdjacentRegionStop !== 'function') return false;
        return jumpToAdjacentRegionStop(dir, navOpt);
    }

    /** Ctrl+←→ — マーカー・Musical Grid・リージョン停止点ナビが有効か */
    function isAdjacentStopNavigationActive() {
        if (!markersDisplayHidden && currentMarkers.length > 0) return true;
        if (typeof hasMusicalGridSnapStops === 'function' && hasMusicalGridSnapStops()) {
            return true;
        }
        if (typeof buildRegionNavStops === 'function') {
            const stops = buildRegionNavStops();
            if (stops && stops.length > 0) return true;
        }
        return false;
    }

    function handleMarkerStopJumpKeydown(e) {
        if (!markerTimelineReady()) return false;
        if (typeof isMarkerStopJumpEvent !== 'function' || !isMarkerStopJumpEvent(e, { allowRepeat: true })) {
            return false;
        }
        if (e.altKey || e.shiftKey) return false;
        if (isTypingTarget(e.target)) return false;
        if (!isAdjacentStopNavigationActive()) return false;
        const dir =
            typeof isMarkerStopJumpNextEvent === 'function' && isMarkerStopJumpNextEvent(e, { allowRepeat: true })
                ? 1
                : -1;
        const navOpt = {
            focusComment: false,
            resumeAfterSeek: markerStopNavigationResumeAfterSeek(),
            discreteStopNav: true,
            fromRepeat: e.repeat,
        };
        runAdjacentStopNavigation(dir, navOpt);
        e.preventDefault();
        return true;
    }

    function handleMarkerNavigationKeydown(e) {
        if (!markerTimelineReady()) return false;
        const isUp = matchUserShortcut(e, 'markerNavigateUp', { allowRepeat: true });
        const isDown = matchUserShortcut(e, 'markerNavigateDown', { allowRepeat: true });
        if (!isUp && !isDown) return false;
        if (e.ctrlKey || e.metaKey) return false;

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
        if (anchor.markerId) {
            span.dataset.markerId = String(anchor.markerId);
        }
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
        const laneCount = markerFeedbackLaneCount(layerEl);
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
        return { laneH, layerH: laneH * Math.max(1, laneCount), layerW, lanes };
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

    function markerFeedbackSecNearlyEqual(a, b) {
        const frame = markerOneFrameSec();
        const eps = Math.max(1e-6, frame * 0.5);
        return Math.abs(Number(a) - Number(b)) <= eps;
    }

    function markerFeedbackPreassignRowsByBounds(items) {
        const ordered = items
            .slice()
            .sort((a, b) => (a.listIdx | 0) - (b.listIdx | 0));
        const groups = [];
        for (let i = 0; i < ordered.length; i++) {
            const it = ordered[i];
            if (it.isPoint) continue;
            if (!Number.isFinite(it.startSec) || !Number.isFinite(it.endSec)) continue;
            let group = null;
            for (let g = 0; g < groups.length; g++) {
                const gr = groups[g];
                if (
                    markerFeedbackSecNearlyEqual(it.startSec, gr.startSec) &&
                    markerFeedbackSecNearlyEqual(it.endSec, gr.endSec)
                ) {
                    group = gr;
                    break;
                }
            }
            if (!group) {
                group = {
                    startSec: it.startSec,
                    endSec: it.endSec,
                    count: 0,
                };
                groups.push(group);
            }
            it.minRowForBounds = group.count;
            group.count += 1;
        }
    }

    function markerFeedbackSameRangeBounds(a, b) {
        if (!a || !b || a.isPoint || b.isPoint) return false;
        if (
            !Number.isFinite(a.startSec) ||
            !Number.isFinite(a.endSec) ||
            !Number.isFinite(b.startSec) ||
            !Number.isFinite(b.endSec)
        ) {
            return false;
        }
        return (
            markerFeedbackSecNearlyEqual(a.startSec, b.startSec) &&
            markerFeedbackSecNearlyEqual(a.endSec, b.endSec)
        );
    }

    /** 同一 In/Out の範囲マーカーは段をずらして両方のコメントを表示 */
    function markerFeedbackMinRowForSameRangeBounds(it, rangePlaced) {
        let minRow = 0;
        if (!rangePlaced || !rangePlaced.length) return 0;
        for (let i = 0; i < rangePlaced.length; i++) {
            const prev = rangePlaced[i];
            if (!markerFeedbackSameRangeBounds(it, prev)) continue;
            minRow = Math.max(minRow, (prev.assignedRow | 0) + 1);
        }
        return minRow;
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

    function markerFeedbackApplyItemTopPx(it, baseTop, rowStep, minTop, maxTop, maxDownRows) {
        const top = Math.min(
            maxTop,
            Math.max(
                minTop,
                markerFeedbackTopForRow(
                    it.assignedRow || 0,
                    baseTop,
                    rowStep,
                    minTop,
                    maxTop,
                    maxDownRows,
                ),
            ),
        );
        it.topPx = top;
        it.span.style.top = top + 'px';
        it.span.style.zIndex = String(10 + (it.assignedRow | 0));
    }

    /** 1レーン帯内。横はマーカーと同じ % 固定。重なり時は下へ段を増やす。 */
    function layoutMarkerFeedbackLabels(layerEl, spans, opt) {
        if (!layerEl || !spans || !spans.length) return;
        const o = opt && typeof opt === 'object' ? opt : {};
        layerEl.hidden = false;
        const alreadyMounted = spans.every((s) => s.parentElement === layerEl);
        if (!alreadyMounted) {
            const frag = document.createDocumentFragment();
            for (let i = 0; i < spans.length; i++) {
                frag.appendChild(spans[i]);
            }
            layerEl.appendChild(frag);
        }

        const metrics = markerFeedbackLaneMetrics(layerEl);
        const layerW = Math.max(1, layerEl.clientWidth || metrics.layerW || 0);
        const layerH = metrics.layerH;
        if (layerW <= 0 || layerH <= 0) {
            if (!o.deferred) {
                requestAnimationFrame(() => {
                    layoutMarkerFeedbackLabels(layerEl, spans, { deferred: true });
                });
            }
            return;
        }

        let labelH = 14;
        let measureSpan = spans[0];
        for (let si = 0; si < spans.length; si++) {
            const r = spans[si].getBoundingClientRect();
            const h = Math.max(10, r.height || spans[si].offsetHeight || 14);
            if (h >= labelH) {
                labelH = h;
                measureSpan = spans[si];
            }
        }
        const fontPx = parseFloat(getComputedStyle(measureSpan).fontSize) || 9;
        const lh = parseFloat(getComputedStyle(measureSpan).lineHeight);
        const linePx = lh > 3 ? lh : lh * fontPx;
        const padX = 10;
        const padY = 10;
        const rowStep = Math.max(labelH + padY + 4, linePx + 10);
        const baseTop = labelH * 0.5 + 3;
        const minTop = labelH * 0.5 + 1;
        const maxTop = layerH - labelH * 0.5 - 1;
        const maxDownRows =
            rowStep > 0 ? Math.max(0, Math.floor((maxTop - baseTop) / rowStep)) : 0;

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
                listIdx: i,
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
                minRowForBounds: 0,
                assignedRow: 0,
                topPx: baseTop,
            };
            items.push(item);
            if (isRange) rangeBands.push(item);
        }
        markerFeedbackPreassignRowsByBounds(items);
        items.sort((a, b) => a.anchorPct - b.anchorPct);
        const pointItems = items.filter((it) => it.isPoint);
        const rangeItems = items.filter((it) => !it.isPoint);
        const placementOrder = pointItems.concat(rangeItems);
        const maxRow = Math.max(
            maxDownRows + Math.ceil((baseTop - minTop) / rowStep) + 4,
            items.length * 3,
            48,
        );

        const pointPlaced = [];
        const rangePlaced = [];
        for (let i = 0; i < placementOrder.length; i++) {
            const it = placementOrder[i];
            let row = 0;
            if (!it.isPoint) {
                row = Math.max(
                    markerFeedbackMinRowForRangeBelowPoints(
                        it,
                        pointPlaced,
                        layerW,
                        baseTop,
                        padX,
                        padY,
                    ),
                    markerFeedbackMinRowForSameRangeBounds(it, rangePlaced),
                    it.minRowForBounds | 0,
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
                    const prevIt = placementOrder[j];
                    const prev = markerFeedbackLabelTextBox(
                        prevIt,
                        layerW,
                        prevIt.topPx,
                    );
                    if (markerFeedbackLabelBoxOverlap(candidate, prev, padX, padY)) {
                        hit = true;
                        break;
                    }
                }
                if (!hit) {
                    if (it.isPoint) {
                        pointPlaced.push(it);
                    } else {
                        rangePlaced.push(it);
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
                    } else {
                        rangePlaced.push(it);
                    }
                    break;
                }
            }
        }

        for (let pass = 0; pass < 96; pass++) {
            const pair = markerFeedbackLabelsOverlap(items, layerW, padX, padY);
            if (!pair) break;
            let bumpIdx = pair.b;
            const otherIdx = pair.a;
            if (
                !items[bumpIdx].isPoint &&
                !items[otherIdx].isPoint &&
                markerFeedbackSameRangeBounds(items[bumpIdx], items[otherIdx])
            ) {
                bumpIdx =
                    (items[bumpIdx].listIdx | 0) >= (items[otherIdx].listIdx | 0)
                        ? bumpIdx
                        : otherIdx;
            } else if (items[bumpIdx].isPoint && !items[otherIdx].isPoint) {
                bumpIdx = pair.a;
            }
            const bump = items[bumpIdx];
            const anchor = items[bumpIdx === pair.b ? pair.a : pair.b];
            let nextRow = Math.max(bump.assignedRow || 0, anchor.assignedRow || 0) + 1;
            if (nextRow <= bump.assignedRow) nextRow = bump.assignedRow + 1;
            bump.assignedRow = Math.max(
                bump.minRowForBounds | 0,
                Math.min(nextRow, maxRow),
            );
            for (let ri = 0; ri < items.length; ri++) {
                markerFeedbackApplyItemTopPx(
                    items[ri],
                    baseTop,
                    rowStep,
                    minTop,
                    maxTop,
                    maxDownRows,
                );
            }
        }

        for (let i = 0; i < items.length; i++) {
            markerFeedbackApplyItemTopPx(
                items[i],
                baseTop,
                rowStep,
                minTop,
                maxTop,
                maxDownRows,
            );
        }
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const pct = markerFeedbackAnchorPct(it);
            it.span.style.left = pct + '%';
            it.span.style.top = it.topPx + 'px';
            it.span.style.zIndex = String(10 + (it.assignedRow | 0));
            if (it.isPoint) {
                it.span.style.transform = 'translate(0, -50%)';
            } else {
                it.span.style.transform = 'translate(-50%, -50%)';
            }
        }
    }

    function masterTimelineDurationForMarkerLayout() {
        if (typeof masterTimelineLayoutDurationSec === 'function') {
            const master = masterTimelineLayoutDurationSec();
            if (master > 0) return master;
        }
        if (typeof getMasterTransportDurationSec === 'function') {
            const master = getMasterTransportDurationSec();
            if (master > 0) return master;
        }
        return masterDurForTimelineMarkers();
    }

    function snapTimelineMarkerLinePx(sec) {
        if (typeof timelineSecToContentPx === 'function') {
            return timelineSecToContentPx(sec);
        }
        const dur = masterTimelineDurationForMarkerLayout();
        const layerW =
            typeof masterTimelineWidthCss === 'function'
                ? Math.max(1, masterTimelineWidthCss() | 0)
                : 0;
        if (!dur || dur <= 0 || !layerW) return 0;
        const x = (Number(sec) / dur) * layerW;
        return Math.max(0, Math.min(layerW, Math.round(x)));
    }

    function applySeekBarPointMarkerPosition(el, sec, dur, layerW) {
        if (typeof timelineSecToContentPx === 'function') {
            el.style.left = timelineSecToContentPx(sec) + 'px';
        } else if (layerW > 0) {
            el.style.left = snapTimelineMarkerLinePx(sec) + 'px';
        } else {
            el.style.left = secToSeekRatio(sec, dur) + '%';
        }
    }

    function applySeekBarRangeBandPosition(el, startSec, endSec, dur, layerW, opt) {
        if (typeof timelineSecToContentPx === 'function') {
            const leftPx = timelineSecToContentPx(startSec);
            const rightPx = timelineSecToContentPx(endSec);
            const contentW =
                typeof masterTimelineWidthCss === 'function'
                    ? Math.max(1, masterTimelineWidthCss() | 0)
                    : layerW;
            const minW = opt && opt.pending ? Math.max(1, Math.round(contentW * 0.0012)) : 0;
            const widthPx = Math.max(minW, rightPx - leftPx);
            if (widthPx <= 0 && !(opt && opt.pending)) return false;
            el.style.left = leftPx + 'px';
            el.style.width = widthPx + 'px';
            return true;
        }
        if (layerW > 0) {
            const leftPx = snapTimelineMarkerLinePx(startSec);
            const rightPx = snapTimelineMarkerLinePx(endSec);
            const minW = opt && opt.pending ? Math.max(1, Math.round(layerW * 0.0012)) : 0;
            const widthPx = Math.max(minW, rightPx - leftPx);
            if (widthPx <= 0 && !(opt && opt.pending)) return false;
            el.style.left = leftPx + 'px';
            el.style.width = widthPx + 'px';
            return true;
        }
        const left = secToSeekRatio(startSec, dur);
        const right = secToSeekRatio(endSec, dur);
        const widthPct = Math.max(opt && opt.pending ? 0.12 : 0, right - left);
        if (widthPct <= 0 && !(opt && opt.pending)) return false;
        el.style.left = left + '%';
        el.style.width = widthPct + '%';
        return true;
    }

    function createSeekBarRangeBandElement(startSec, endSec, dur, opt, layerW) {
        const el = document.createElement('div');
        const isActive = !!(opt && opt.active);
        const isPending = !!(opt && opt.pending);
        if (!applySeekBarRangeBandPosition(el, startSec, endSec, dur, layerW, opt)) return null;
        el.className =
            'seek-bar-marker seek-bar-marker--range' +
            (isPending ? ' seek-bar-marker--range-pending' : '') +
            (isActive ? ' seek-bar-marker--active' : '');
        if (opt && opt.id) el.dataset.markerId = opt.id;
        if (opt && opt.title) el.title = opt.title;
        if (opt && opt.marker && !isPending) {
            const m = opt.marker;
            const handleIn = document.createElement('div');
            handleIn.className = 'seek-bar-marker__handle seek-bar-marker__handle--in';
            handleIn.title = 'In をドラッグ（Alt 押下中は他要素へのスナップを抑制）';
            const handleOut = document.createElement('div');
            handleOut.className = 'seek-bar-marker__handle seek-bar-marker__handle--out';
            handleOut.title = 'Out をドラッグ（Alt 押下中は他要素へのスナップを抑制）';
            el.appendChild(handleIn);
            el.appendChild(handleOut);
            bindSeekBarMarkerDrag(el, m, 'move', { bandEl: el });
            bindSeekBarMarkerDrag(handleIn, m, 'in', { bandEl: el });
            bindSeekBarMarkerDrag(handleOut, m, 'out', { bandEl: el });
            bindSeekBarMarkerListHighlight(el, opt.id);
        }
        return el;
    }

    function createSeekBarPointElement(sec, dur, opt, layerW) {
        const el = document.createElement('div');
        const isActive = !!(opt && opt.active);
        el.className =
            'seek-bar-marker seek-bar-marker--point' + (isActive ? ' seek-bar-marker--active' : '');
        applySeekBarPointMarkerPosition(el, sec, dur, layerW);
        if (opt && opt.id) el.dataset.markerId = opt.id;
        if (opt && opt.title) el.title = opt.title;
        if (opt && opt.marker) {
            const m = opt.marker;
            el.title = (opt.title || '') + ' — ドラッグで移動';
            bindSeekBarMarkerDrag(el, m, 'point');
            bindSeekBarMarkerListHighlight(el, opt.id);
        }
        return el;
    }

    function renderTimelineMarkersLayer(containerEl) {
        if (!containerEl) return;
        containerEl.replaceChildren();
        containerEl.style.display = 'none';
        const labelLayer = markerLabelsLayerEl();
        if (labelLayer) {
            labelLayer.replaceChildren();
        }
        const dur = masterTimelineDurationForMarkerLayout();
        if (!dur || dur <= 0) {
            containerEl.hidden = true;
            return;
        }
        const layerW =
            typeof masterTimelineWidthCss === 'function'
                ? Math.max(1, masterTimelineWidthCss() | 0)
                : 0;

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
                const el = createSeekBarRangeBandElement(
                    m.startSec,
                    m.endSec,
                    dur,
                    {
                        id: m.id,
                        active: active,
                        marker: m,
                        comment: m.comment || '',
                        title: markerTimeLabel(m) + (m.comment ? ' — ' + m.comment : ''),
                    },
                    layerW,
                );
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
                                markerId: m.id,
                            },
                        );
                        if (span) feedbackLabelSpans.push(span);
                    }
                }
            } else {
                const leftPct = secToSeekRatio(m.timeSec, dur);
                const el = createSeekBarPointElement(
                    m.timeSec,
                    dur,
                    {
                        id: m.id,
                        active: active,
                        marker: m,
                        comment: m.comment || '',
                        title: tcLabelForSec(m.timeSec) + (m.comment ? ' — ' + m.comment : ''),
                    },
                    layerW,
                );
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
            const pendingEl = createSeekBarRangeBandElement(
                start,
                end,
                dur,
                {
                    pending: true,
                    title:
                        'Range In ' +
                        tcLabelForSec(pendingRangeStartSec) +
                        ' — press ] for Out',
                },
                layerW,
            );
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
            comment.cols = 1;
            comment.wrap = 'soft';
            comment.placeholder = '';
            comment.value = m.comment || '';
            const th =
                typeof window.SHORTCUT_HINTS !== 'undefined' ? window.SHORTCUT_HINTS : {};
            const feedbackNav = th.feedbackRowNav || 'Alt+↑/↓';
            const cancelEdit = th.cancelEdit || 'Esc';
            comment.title =
                'Comment を編集（' +
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
            });
            comment.addEventListener('keydown', (ev) => {
                if (!matchUserShortcut(ev, 'cancelEditing', { allowRepeat: true })) return;
                ev.preventDefault();
                ev.stopPropagation();
                if (!clearActiveMarkerTarget()) {
                    if (typeof scheduleWaveformFocusRestore === 'function') scheduleWaveformFocusRestore();
                }
            });
            tdComment.appendChild(comment);

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
            beginPendingRangeAtSec(quantizeMarkerInsSecIfNeeded(insertMarkerPressSec));
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
            addPointMarkerAtSec(quantizeMarkerInsSecIfNeeded(pressSec));
            return true;
        }

        const outSec = quantizeMarkerInsSecIfNeeded(currentTransportSec());
        if (pendingRangeStartSec != null) {
            completePendingRangeAtCurrentTime({ endSec: outSec });
        } else {
            pendingRangeStartSec = null;
            updateMarkerRangeHint();
            addRangeMarkerBetweenSecs(
                quantizeMarkerInsSecIfNeeded(pressSec),
                outSec,
            );
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

    window.handleMarkerBracketKeydown = handleMarkerBracketKeydown;
    window.handleMarkerStopJumpKeydown = handleMarkerStopJumpKeydown;
    window.handleSeekBarMarkerPointerDownCapture = handleSeekBarMarkerPointerDownCapture;
    window.resolveSeekBarMarkerPointerDragTarget = resolveSeekBarMarkerPointerDragTarget;
    window.waveformPointerTimelineContentPx = waveformPointerTimelineContentPx;
    window.isMarkerWaveformDragActive = isMarkerWaveformDragActive;
    window.markerLiveModelForDrag = markerLiveModelForDrag;
