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

    /** 点マーカー: 表示時間が重なるコメントはすべて返す（In 昇順・同 In は一覧順）。 */
    function findAllPointMarkerCommentHitsForOverlay(t) {
        if (!markerTimelineReady() || !Number.isFinite(t)) return [];
        const fadeDur = markerCommentFadeOutDurationSec();
        const holdSec = MARKER_COMMENT_POINT_HOLD_SEC;
        const hits = [];
        for (let i = 0; i < currentMarkers.length; i++) {
            const m = currentMarkers[i];
            if (m.type === 'range') continue;
            if (!markerCommentHasDisplayText(m.comment)) continue;
            const start = Number(m.timeSec);
            if (!Number.isFinite(start)) continue;
            if (t < start || t >= start + holdSec + fadeDur) continue;
            hits.push({ marker: m, text: m.comment, listIdx: i });
        }
        hits.sort((a, b) => {
            const sa = markerCommentStartSec(a.marker);
            const sb = markerCommentStartSec(b.marker);
            if (sa !== sb) return sa - sb;
            return a.listIdx - b.listIdx;
        });
        return hits;
    }

    /** 範囲マーカー: 表示時間が重なるコメントはすべて返す（In 昇順・同 In は一覧順）。 */
    function findAllRangeMarkerCommentHitsForOverlay(t) {
        if (!markerTimelineReady() || !Number.isFinite(t)) return [];
        const fadeDur = markerCommentFadeOutDurationSec();
        const hits = [];
        for (let i = 0; i < currentMarkers.length; i++) {
            const m = currentMarkers[i];
            if (m.type !== 'range') continue;
            if (!markerCommentHasDisplayText(m.comment)) continue;
            const start = Number(m.startSec);
            const end = Number(m.endSec);
            if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
            if (t < start || t >= end + fadeDur) continue;
            hits.push({ marker: m, text: m.comment, listIdx: i });
        }
        hits.sort((a, b) => {
            const sa = markerCommentStartSec(a.marker);
            const sb = markerCommentStartSec(b.marker);
            if (sa !== sb) return sa - sb;
            return a.listIdx - b.listIdx;
        });
        return hits;
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

    function markerCommentOverlayStatesFromHits(hits, t) {
        const states = [];
        for (let i = 0; i < hits.length; i++) {
            const hit = hits[i];
            const phase = markerCommentOverlayPhaseForHit(hit, t);
            if (phase === 'off') continue;
            states.push({ hit: hit, phase: phase });
        }
        return states;
    }

    function getPointMarkerCommentOverlayStates(t) {
        return markerCommentOverlayStatesFromHits(
            findAllPointMarkerCommentHitsForOverlay(t),
            t,
        );
    }

    function getRangeMarkerCommentOverlayStates(t) {
        return markerCommentOverlayStatesFromHits(
            findAllRangeMarkerCommentHitsForOverlay(t),
            t,
        );
    }

    /** 点・範囲を In 昇順でまとめた表示状態（配置は共通キューで重なり回避）。 */
    function getAllMarkerCommentOverlayStates(t) {
        const merged = getPointMarkerCommentOverlayStates(t).concat(
            getRangeMarkerCommentOverlayStates(t),
        );
        merged.sort((a, b) => {
            const sa = markerCommentStartSec(a.hit.marker);
            const sb = markerCommentStartSec(b.hit.marker);
            if (sa !== sb) return sa - sb;
            return 0;
        });
        return merged;
    }

    function markerHitIsRange(hit) {
        return !!(hit && hit.marker && hit.marker.type === 'range');
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

    function markerCommentOverlayFrameEl() {
        return typeof frameMain !== 'undefined' ? frameMain : null;
    }

    function markerRangeCommentStackGapPx() {
        return 4;
    }

    function markerRangeCommentStackTopPadPx(frameH) {
        return Math.max(8, frameH * 0.04);
    }

    function markerCommentRectsOverlap(bottomPx, heightPx, placedRects, gapPx) {
        const topPx = bottomPx + heightPx;
        for (let i = 0; i < placedRects.length; i++) {
            const r = placedRects[i];
            if (bottomPx < r.topPx + gapPx && topPx > r.bottomPx - gapPx) return true;
        }
        return false;
    }

    /**
     * 新規コメント用の下端 px。既に配置済みの矩形は動かさず、重なる場合は上方向の空きへずらす。
     */
    function computeMarkerCommentBottomPxForNew(
        frameH,
        itemHeightPx,
        placedRects,
        defaultBottomPct,
        minBottomPx,
    ) {
        if (!Number.isFinite(frameH) || frameH <= 0 || itemHeightPx <= 0) {
            return (frameH * defaultBottomPct) / 100;
        }
        const gap = markerRangeCommentStackGapPx();
        const topPad = markerRangeCommentStackTopPadPx(frameH);
        const maxTopPx = frameH - topPad;
        const defaultBottomPxVal = (frameH * defaultBottomPct) / 100;
        const floorBottomPx = Math.max(defaultBottomPxVal, minBottomPx);
        let bottomPx = defaultBottomPxVal;
        let guard = 0;
        while (
            markerCommentRectsOverlap(bottomPx, itemHeightPx, placedRects, gap) &&
            guard < 64
        ) {
            let nextBottom = bottomPx;
            const topPx = bottomPx + itemHeightPx;
            for (let i = 0; i < placedRects.length; i++) {
                const r = placedRects[i];
                if (bottomPx < r.topPx + gap && topPx > r.bottomPx - gap) {
                    nextBottom = Math.max(nextBottom, r.topPx + gap);
                }
            }
            bottomPx = nextBottom;
            guard += 1;
        }
        if (bottomPx + itemHeightPx > maxTopPx) {
            bottomPx = Math.max(floorBottomPx, maxTopPx - itemHeightPx);
        }
        return bottomPx;
    }

    function collectPlacedCommentRectsFromDom(containerEl, frameH, skipMarkerId, opt) {
        const rects = [];
        const holdOnly = !!(opt && opt.holdOnly);
        const byId = markerCommentOverlayFade.byId;
        if (!containerEl || frameH <= 0) return rects;
        const items = containerEl.querySelectorAll('.marker-comment-overlay__item');
        for (let i = 0; i < items.length; i++) {
            const itemEl = items[i];
            const id = itemEl.dataset.markerId;
            if (!id || id === skipMarkerId) continue;
            const ent = byId[id];
            if (!ent || !Number.isFinite(ent.bottomPct)) continue;
            if (holdOnly && ent.phase !== 'hold') continue;
            const h = itemEl.offsetHeight;
            if (h <= 0) continue;
            const bottomPx = (frameH * ent.bottomPct) / 100;
            rects.push({ bottomPx: bottomPx, topPx: bottomPx + h, height: h });
        }
        return rects;
    }

    /** フェード中スロットの下端 px（下端が低い順）。hold と重ならないものを新規へ再利用。 */
    function findFadingSlotBottomPxForReuse(
        containerEl,
        frameH,
        skipMarkerId,
        itemHeightPx,
        holdRects,
        claimedFadingIds,
    ) {
        if (!containerEl || frameH <= 0 || itemHeightPx <= 0) return null;
        const gap = markerRangeCommentStackGapPx();
        const byId = markerCommentOverlayFade.byId;
        const candidates = [];
        const items = containerEl.querySelectorAll('.marker-comment-overlay__item');
        for (let i = 0; i < items.length; i++) {
            const itemEl = items[i];
            const id = itemEl.dataset.markerId;
            if (!id || id === skipMarkerId) continue;
            const ent = byId[id];
            if (!ent || ent.phase !== 'fading' || !Number.isFinite(ent.bottomPct)) continue;
            if (claimedFadingIds && claimedFadingIds.has(id)) continue;
            const bottomPx = (frameH * ent.bottomPct) / 100;
            candidates.push({ markerId: id, bottomPx: bottomPx });
        }
        candidates.sort((a, b) => a.bottomPx - b.bottomPx);
        for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            if (
                markerCommentRectsOverlap(c.bottomPx, itemHeightPx, holdRects, gap)
            ) {
                continue;
            }
            if (claimedFadingIds) claimedFadingIds.add(c.markerId);
            return c.bottomPx;
        }
        return null;
    }

    function ensureMarkerCommentOverlayContainerLayout(containerEl) {
        if (!containerEl) return;
        containerEl.style.left = '0';
        containerEl.style.right = '0';
        containerEl.style.top = '0';
        containerEl.style.bottom = '0';
        containerEl.style.width = '100%';
        containerEl.style.maxWidth = 'none';
        containerEl.style.transform = 'none';
    }

    function applyMarkerCommentItemPosition(itemEl, bottomPct) {
        if (!itemEl || !Number.isFinite(bottomPct)) return;
        itemEl.style.left = MARKER_VIDEO_COMMENT_CENTER_LEFT_PCT + '%';
        itemEl.style.bottom = bottomPct + '%';
        itemEl.style.transform = 'translate(-50%, 0)';
    }

    function markerCommentItemSortKey(markerId) {
        for (let i = 0; i < currentMarkers.length; i++) {
            const m = currentMarkers[i];
            if (m && m.id === markerId) {
                const sec = markerCommentStartSec(m);
                return Number.isFinite(sec) ? sec : 0;
            }
        }
        return 0;
    }

    /** 未配置のコメントのみ座標を決定。配置済みは bottomPct を維持（点・範囲共通キュー）。 */
    function layoutNewMarkerCommentItems(containerEl) {
        const frameEl = markerCommentOverlayFrameEl();
        const frameH = frameEl && frameEl.clientHeight > 0 ? frameEl.clientHeight : 0;
        if (!containerEl || frameH <= 0) return;
        const defaultBottomPct = MARKER_VIDEO_COMMENT_DEFAULT_BOTTOM_PCT;
        const minBottomPx = (frameH * defaultBottomPct) / 100;
        ensureMarkerCommentOverlayContainerLayout(containerEl);
        const items = Array.from(containerEl.querySelectorAll('.marker-comment-overlay__item'));
        const claimedFadingIds = new Set();
        items.sort((a, b) => {
            const sa = markerCommentItemSortKey(a.dataset.markerId);
            const sb = markerCommentItemSortKey(b.dataset.markerId);
            if (sa !== sb) return sa - sb;
            return 0;
        });
        for (let i = 0; i < items.length; i++) {
            const itemEl = items[i];
            const id = itemEl.dataset.markerId;
            if (!id) continue;
            const ent = markerCommentFadeEntry(id);
            if (!ent) continue;
            if (Number.isFinite(ent.bottomPct)) {
                applyMarkerCommentItemPosition(itemEl, ent.bottomPct);
                continue;
            }
            const h = itemEl.offsetHeight;
            if (h <= 0) continue;
            const holdPlaced = collectPlacedCommentRectsFromDom(containerEl, frameH, id, {
                holdOnly: true,
            });
            let bottomPx = findFadingSlotBottomPxForReuse(
                containerEl,
                frameH,
                id,
                h,
                holdPlaced,
                claimedFadingIds,
            );
            if (bottomPx == null) {
                bottomPx = computeMarkerCommentBottomPxForNew(
                    frameH,
                    h,
                    holdPlaced,
                    defaultBottomPct,
                    minBottomPx,
                );
            }
            ent.bottomPct = (bottomPx / frameH) * 100;
            applyMarkerCommentItemPosition(itemEl, ent.bottomPct);
        }
    }

    function markerCommentBurnInBottomPctsForStates(states, exportCanvasH) {
        if (!states.length || !Number.isFinite(exportCanvasH) || exportCanvasH <= 0) {
            return [];
        }
        const metrics = getMarkerCommentBurnInMetrics(exportCanvasH, false);
        const lineH = metrics.fontPx * metrics.lineHeightRatio;
        const defaultBottomPct = MARKER_VIDEO_COMMENT_DEFAULT_BOTTOM_PCT;
        const minBottomPx = (exportCanvasH * defaultBottomPct) / 100;
        const holdPlaced = [];
        const bottomPcts = [];
        const claimedFadeIdx = new Set();
        const gap = markerRangeCommentStackGapPx();
        for (let i = 0; i < states.length; i++) {
            const isRange = markerHitIsRange(states[i].hit);
            const text = markerCommentOverlayDisplayText(states[i].hit.text, isRange);
            const lines = Math.max(1, String(text).split('\n').length);
            const h = lines * lineH;
            let bottomPx = null;
            if (states[i].phase !== 'fade') {
                for (let j = 0; j < i; j++) {
                    if (states[j].phase !== 'fade') continue;
                    if (claimedFadeIdx.has(j)) continue;
                    const fadeBottomPx = (exportCanvasH * bottomPcts[j]) / 100;
                    if (
                        !markerCommentRectsOverlap(fadeBottomPx, h, holdPlaced, gap)
                    ) {
                        bottomPx = fadeBottomPx;
                        claimedFadeIdx.add(j);
                        break;
                    }
                }
            }
            if (bottomPx == null) {
                bottomPx = computeMarkerCommentBottomPxForNew(
                    exportCanvasH,
                    h,
                    holdPlaced,
                    defaultBottomPct,
                    minBottomPx,
                );
            }
            bottomPcts.push((bottomPx / exportCanvasH) * 100);
            if (states[i].phase === 'hold') {
                holdPlaced.push({
                    bottomPx: bottomPx,
                    topPx: bottomPx + h,
                    height: h,
                });
            }
        }
        return bottomPcts;
    }

    /** Burn-in data for video export at transportSec (respects markers hidden). */
    function getVideoExportMarkerBurnIns(transportSec) {
        if (markersDisplayHidden || !markerTimelineReady() || !Number.isFinite(transportSec)) {
            return { point: [], range: [] };
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
        const exportH =
            typeof frameMain !== 'undefined' && frameMain && frameMain.clientHeight > 0
                ? frameMain.clientHeight
                : 1080;
        const allStates = getAllMarkerCommentOverlayStates(t);
        const allBottoms = markerCommentBurnInBottomPctsForStates(allStates, exportH);
        const point = [];
        const range = [];
        for (let i = 0; i < allStates.length; i++) {
            const isRange = markerHitIsRange(allStates[i].hit);
            const item = pack(allStates[i], allBottoms[i], isRange);
            if (!item) continue;
            if (isRange) range.push(item);
            else point.push(item);
        }
        return { point: point, range: range };
    }

    function markerCommentOverlayDisplayText(text, isRange) {
        const raw = typeof text === 'string' ? text : '';
        if (!raw.trim()) return '';
        if (isRange) return '- ' + raw + ' -';
        return raw;
    }

    const MARKER_VIDEO_COMMENT_CENTER_LEFT_PCT = 50;
    /** 点・範囲共通：映像下部からの既定位置（新規コメントの初期下端） */
    const MARKER_VIDEO_COMMENT_DEFAULT_BOTTOM_PCT = 7;
    const MARKER_COMMENT_FADE_OUT_FRAMES = 30;
    const markerCommentOverlayFade = {
        byId: {},
    };

    function markerCommentFadeOutDurationSec() {
        const fps =
            typeof masterFpsFloatForTransport === 'function'
                ? masterFpsFloatForTransport()
                : 24;
        return MARKER_COMMENT_FADE_OUT_FRAMES / Math.max(1, fps);
    }

    function markerCommentFadeEntry(markerId) {
        if (!markerId) return null;
        const byId = markerCommentOverlayFade.byId;
        if (!byId[markerId]) {
            byId[markerId] = {
                timerId: null,
                phase: 'hidden',
                bottomPct: NaN,
            };
        }
        return byId[markerId];
    }

    function cancelMarkerCommentItemFade(markerId) {
        const ent = markerCommentFadeEntry(markerId);
        if (!ent || ent.timerId == null) return;
        clearTimeout(ent.timerId);
        ent.timerId = null;
    }

    function resetMarkerCommentOverlayState() {
        const byId = markerCommentOverlayFade.byId;
        for (const id of Object.keys(byId)) {
            cancelMarkerCommentItemFade(id);
        }
        markerCommentOverlayFade.byId = {};
    }

    function finishMarkerCommentItemHide(itemEl, markerId) {
        if (itemEl && itemEl.parentNode) itemEl.parentNode.removeChild(itemEl);
        if (markerId) delete markerCommentOverlayFade.byId[markerId];
    }

    function finishMarkerCommentOverlayHide(containerEl) {
        if (!containerEl) return;
        containerEl.hidden = true;
        containerEl.setAttribute('aria-hidden', 'true');
        containerEl.replaceChildren();
        containerEl.style.removeProperty('left');
        containerEl.style.removeProperty('right');
        containerEl.style.removeProperty('top');
        containerEl.style.removeProperty('bottom');
        containerEl.style.removeProperty('width');
        containerEl.style.removeProperty('max-width');
        containerEl.style.removeProperty('transform');
        resetMarkerCommentOverlayState();
    }

    function ensureMarkerCommentItemEl(containerEl, markerId, isRange) {
        let itemEl = containerEl.querySelector(
            '.marker-comment-overlay__item[data-marker-id="' + markerId + '"]',
        );
        const kindClass = isRange
            ? 'marker-comment-overlay__item--range'
            : 'marker-comment-overlay__item--point';
        if (itemEl) {
            itemEl.classList.remove(
                'marker-comment-overlay__item--point',
                'marker-comment-overlay__item--range',
            );
            itemEl.classList.add(kindClass);
            return itemEl;
        }
        itemEl = document.createElement('div');
        itemEl.className = 'marker-comment-overlay__item ' + kindClass;
        itemEl.dataset.markerId = markerId;
        const textEl = document.createElement('span');
        textEl.className = 'marker-comment-overlay__text';
        itemEl.appendChild(textEl);
        containerEl.appendChild(itemEl);
        return itemEl;
    }

    function startMarkerCommentItemFadeOut(containerEl, itemEl, markerId) {
        if (!itemEl || !markerId) return;
        const ent = markerCommentFadeEntry(markerId);
        if (!ent || ent.timerId != null) return;
        const durMs = Math.max(16, Math.round(markerCommentFadeOutDurationSec() * 1000));
        ent.phase = 'fading';
        itemEl.style.transition = 'opacity ' + durMs + 'ms linear';
        itemEl.style.opacity = '1';
        void itemEl.offsetWidth;
        itemEl.style.opacity = '0';
        ent.timerId = setTimeout(() => {
            ent.timerId = null;
            finishMarkerCommentItemHide(itemEl, markerId);
            if (!containerEl) return;
            const remaining = containerEl.querySelectorAll('.marker-comment-overlay__item');
            if (!remaining.length) {
                finishMarkerCommentOverlayHide(containerEl);
            }
        }, durMs + 24);
    }

    function syncMarkerCommentVideoOverlay(t) {
        const containerEl = markerCommentOverlayRange;
        if (!containerEl) return;
        const states = getAllMarkerCommentOverlayStates(t);
        const byId = markerCommentOverlayFade.byId;
        const activeIds = new Set();
        for (let i = 0; i < states.length; i++) {
            if (states[i].hit && states[i].hit.marker) {
                activeIds.add(states[i].hit.marker.id);
            }
        }
        for (const id of Object.keys(byId)) {
            const ent = byId[id];
            if (ent && ent.phase === 'fading') activeIds.add(id);
        }

        if (!activeIds.size) {
            finishMarkerCommentOverlayHide(containerEl);
            return;
        }

        containerEl.hidden = false;
        containerEl.setAttribute('aria-hidden', 'false');

        const seenIds = new Set();
        for (let i = 0; i < states.length; i++) {
            const st = states[i];
            const hit = st.hit;
            const phase = st.phase;
            if (!hit || !hit.marker || phase === 'off') continue;
            const id = hit.marker.id;
            const isRange = markerHitIsRange(hit);
            seenIds.add(id);
            const ent = markerCommentFadeEntry(id);
            const itemEl = ensureMarkerCommentItemEl(containerEl, id, isRange);
            const textEl = markerCommentOverlayTextEl(itemEl);
            if (textEl) {
                textEl.textContent = markerCommentOverlayDisplayText(hit.text, isRange);
            }
            if (phase === 'hold') {
                if (ent.phase === 'fading') cancelMarkerCommentItemFade(id);
                itemEl.style.removeProperty('transition');
                itemEl.style.opacity = '1';
                ent.phase = 'hold';
                continue;
            }
            if (phase === 'fade') {
                if (ent.phase === 'hold') {
                    startMarkerCommentItemFadeOut(containerEl, itemEl, id);
                } else if (ent.phase === 'hidden') {
                    itemEl.style.removeProperty('transition');
                    itemEl.style.opacity = '1';
                    ent.phase = 'hold';
                    startMarkerCommentItemFadeOut(containerEl, itemEl, id);
                }
            }
        }

        const existing = containerEl.querySelectorAll('.marker-comment-overlay__item');
        for (let i = 0; i < existing.length; i++) {
            const itemEl = existing[i];
            const id = itemEl.dataset.markerId;
            if (!id || seenIds.has(id)) continue;
            const ent = markerCommentFadeEntry(id);
            if (ent.phase === 'fading') continue;
            if (ent.phase === 'hold') {
                startMarkerCommentItemFadeOut(containerEl, itemEl, id);
            } else {
                finishMarkerCommentItemHide(itemEl, id);
            }
        }

        layoutNewMarkerCommentItems(containerEl);
        requestAnimationFrame(function () {
            layoutNewMarkerCommentItems(containerEl);
        });
    }

    function updateMarkerCommentOverlay() {
        if (!markerCommentOverlayRange) return;
        if (markersDisplayHidden) {
            finishMarkerCommentOverlayHide(markerCommentOverlayRange);
            if (!isMarkerListPlaybackActive()) {
                updateMarkerListRowClasses();
            }
            return;
        }
        if (!markerTimelineReady()) {
            finishMarkerCommentOverlayHide(markerCommentOverlayRange);
            return;
        }
        const t = currentTransportSec();
        updateTransportMarkerHighlight(t);
        if (!isMarkerListPlaybackActive()) {
            updateMarkerListRowClasses();
        }
        syncMarkerCommentVideoOverlay(t);
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

    function markerTransportSecIsBeyondVideoEnd(transportSec) {
        if (!Number.isFinite(transportSec)) return false;
        if (typeof videoReady === 'function' && !videoReady()) return false;
        const vd =
            typeof getVideoPlaybackEndSec === 'function' ? getVideoPlaybackEndSec() : 0;
        if (!(vd > 0)) return false;
        const eps =
            typeof masterTransportTailEpsilonSec === 'function'
                ? masterTransportTailEpsilonSec()
                : 0.001;
        return transportSec > vd - eps;
    }

    /** マーカー欄 TC: 映像内は焼き込み TC、動画終端以降はトランスポート TC。 */
    function tcLabelForSec(transportSec) {
        if (!Number.isFinite(transportSec)) return '';
        if (markerTransportSecIsBeyondVideoEnd(transportSec)) {
            const fps = masterFpsFloatForTransport();
            return formatTimecodeFromFrameIndex(
                linearFrameIndexFromSec(transportSec, fps),
                fps,
            );
        }
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

    function masterDurForTimelineMarkers(opt) {
        let dur = 0;
        if (typeof getMasterTransportDurationSec === 'function') {
            dur = getMasterTransportDurationSec();
        }
        if (!dur || dur <= 0) {
            dur = getDuration(videoMain);
        }
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
        const pending = opt && opt.pendingSec;
        if (Number.isFinite(pending) && pending > 0) {
            markerMax = Math.max(markerMax, pending);
        }
        if (Number.isFinite(markerMax) && markerMax > 0) {
            const floor = markerMax + Math.max(markerOneFrameSec(), 0.04);
            if (dur <= 0.01 + 1e-6 || floor > dur) {
                dur = Math.max(dur, floor);
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
        if (markerCommentOverlayRange) {
            finishMarkerCommentOverlayHide(markerCommentOverlayRange);
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
        const overlay = markerCommentOverlayRange;
        let textEl = markerCommentOverlayTextEl(overlay);
        if (overlay && !textEl) {
            textEl = overlay.querySelector(
                '.marker-comment-overlay__item--' +
                    (isRange ? 'range' : 'point') +
                    ' .marker-comment-overlay__text',
            );
            if (!textEl) {
                textEl = overlay.querySelector('.marker-comment-overlay__text');
            }
        }
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
        if (typeof refreshExportMediaOptionsUi === 'function') {
            refreshExportMediaOptionsUi();
        }
    }

    /** タブ区切りコピー用: セル内のタブ・改行を正規化 */
