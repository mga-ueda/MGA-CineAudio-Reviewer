/**
 * waveform-region-render-meta.js — 練習番号・フェード三角・dense 境界表示
 */
    const REGION_OVERLAY_NARROW_PX = 22;
    /** CSS .audio-waveform-lane__playback-region { min-width: 28px } と揃える */
    const REGION_OVERLAY_MIN_CSS_PX = 28;

    /** リージョン練習番号（0→A, 1→B … 26→AA）— phraseGroupLabelForIndex へ委譲 */
    function formatRegionRehearsalMarkLabel(markIndex) {
        if (typeof phraseGroupLabelForIndex === 'function') {
            return phraseGroupLabelForIndex(markIndex | 0);
        }
        return 'A';
    }

    function formatRehearsalMarkForPhraseSlot(phraseSlotIndex) {
        if (typeof rehearsalMarkLabelForPhraseSlotIndex === 'function') {
            return rehearsalMarkLabelForPhraseSlotIndex(phraseSlotIndex);
        }
        const phraseSlot = phraseSlotIndex | 0;
        if (phraseSlot < 0) return '_';
        const offset =
            typeof getRehearsalMarkOffsetEnabled === 'function'
                ? getRehearsalMarkOffsetEnabled()
                : false;
        const markIndex = phraseSlot - (offset ? 1 : 0);
        if (markIndex < 0) return '_';
        return formatRegionRehearsalMarkLabel(markIndex);
    }

    function syncRehearsalMarksOverlayPlacement(track, container) {
        if (!container) return;
        const lane = document.getElementById('extraAudioLane' + track.slot);
        if (!lane) return;
        container.classList.add('audio-waveform-lane__rehearsal-marks--overlay');
        if (typeof syncLaneOverlayGridPlacement === 'function') {
            syncLaneOverlayGridPlacement(lane, container);
        } else if (container.parentElement !== lane) {
            lane.appendChild(container);
        }
    }

    function getRehearsalMarksContainerEl(track) {
        if (!isExtraTrackRef(track)) return null;
        const lane = document.getElementById('extraAudioLane' + track.slot);
        if (!lane) return null;
        const containerId = 'extraAudioRehearsalMarks' + track.slot;
        let el = document.getElementById(containerId);
        if (!el) {
            el = document.createElement('div');
            el.id = containerId;
            el.className = 'audio-waveform-lane__rehearsal-marks';
            el.hidden = true;
            el.setAttribute('aria-hidden', 'true');
        }
        syncRehearsalMarksOverlayPlacement(track, el);
        return el;
    }

    function positionRehearsalMarkEl(el, startSec, endSec, master) {
        if (!el || !(master > 0)) return;
        const leftPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(startSec)
                : (startSec / master) * 100;
        const rightPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(endSec)
                : (endSec / master) * 100;
        const widthPct = Math.max(0, rightPct - leftPct);
        el.style.left = leftPct + '%';
        el.style.width = widthPct + '%';
        el.classList.toggle(
            'audio-waveform-lane__rehearsal-mark--narrow',
            widthPct > 0 &&
                regionOverlayWidthPxFromPct(
                    widthPct,
                    getRegionOverlayTimelineMetrics()?.scrubW,
                ) < REGION_OVERLAY_NARROW_PX,
        );
    }

    function isMusicalGridPhraseFillVisibleSafe() {
        return (
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible()
        );
    }

    function shouldShowOriginLabelOnSegment(track, segmentIndex) {
        if (!isMusicalGridPhraseFillVisibleSafe()) return false;
        if (typeof resolveRegionSwapUnitSegmentIndices === 'function') {
            const unit = resolveRegionSwapUnitSegmentIndices(track, segmentIndex);
            if (!unit || !unit.length) return true;
            return (unit[0] | 0) === (segmentIndex | 0);
        }
        return true;
    }

    function appendSwapUnitOriginLabelToEl(track, el, ref, slotsOpt) {
        if (!isMusicalGridPhraseFillVisibleSafe()) return;
        if (typeof formatSwapUnitOriginLabelText !== 'function') return;
        const indexText = formatSwapUnitOriginLabelText(track, ref, slotsOpt);
        if (!indexText) return;
        let metaText = '';
        if (typeof formatSwapUnitStoredMusicalMetaText === 'function') {
            metaText = formatSwapUnitStoredMusicalMetaText(track, ref, { slots: slotsOpt });
        }
        appendPhraseIndexWithMetaRow(el, indexText, metaText);
    }

    function appendPhraseIndexWithMetaRow(parentEl, indexText, metaText) {
        if (!parentEl || !indexText || !isMusicalGridPhraseFillVisibleSafe()) return null;
        const row = document.createElement('span');
        row.className = 'audio-waveform-lane__phrase-index-row';
        row.setAttribute('aria-hidden', 'true');
        const indexEl = document.createElement('span');
        indexEl.className = 'audio-waveform-lane__phrase-index__label';
        indexEl.textContent = indexText;
        row.appendChild(indexEl);
        if (metaText) {
            const metaEl = document.createElement('span');
            metaEl.className = 'audio-waveform-lane__phrase-meta__label';
            metaEl.textContent = metaText;
            metaEl.title = metaText;
            row.appendChild(metaEl);
        }
        parentEl.appendChild(row);
        return row;
    }

    function syncTrackPhraseRehearsalMarks(track) {
        const container = getRehearsalMarksContainerEl(track);
        if (!container) return;
        if (!isTrackRegionActive(track)) {
            container.replaceChildren();
            container.hidden = true;
            return;
        }
        const ranges =
            typeof getPhraseGroupRangesForRegionRehearsalMarks === 'function'
                ? getPhraseGroupRangesForRegionRehearsalMarks()
                : [];
        if (!ranges.length) {
            container.replaceChildren();
            container.hidden = true;
            return;
        }
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) {
            container.replaceChildren();
            container.hidden = true;
            return;
        }
        const phraseFillOn = isMusicalGridPhraseFillVisibleSafe();
        if (!phraseFillOn) {
            container.replaceChildren();
            container.hidden = true;
            return;
        }
        container.hidden = false;
        container.replaceChildren();
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (!r || !Number.isFinite(r.startSec) || !Number.isFinite(r.endSec)) continue;
            const slotEl = document.createElement('div');
            slotEl.className = 'audio-waveform-lane__rehearsal-mark';
            slotEl.dataset.phraseSlotIndex = String(i);
            const markInternal = formatRehearsalMarkForPhraseSlot(i);
            slotEl.dataset.rehearsalMark = markInternal;
            const markDisplay =
                typeof rehearsalMarkDisplayLabel === 'function'
                    ? rehearsalMarkDisplayLabel(markInternal)
                    : markInternal === '_'
                      ? ''
                      : markInternal;
            if (markDisplay) {
                const labelEl = document.createElement('span');
                labelEl.className = 'audio-waveform-lane__rehearsal-mark__label';
                labelEl.textContent = markDisplay;
                labelEl.title = 'Region ' + markDisplay + '（Shift+' + markDisplay + ' でジャンプ）';
                labelEl.setAttribute('aria-hidden', 'true');
                slotEl.appendChild(labelEl);
            }
            if (!slotEl.childElementCount) continue;
            positionRehearsalMarkEl(slotEl, r.startSec, r.endSec, master);
            container.appendChild(slotEl);
        }
    }

    function refreshAllRegionRehearsalMarkLabels() {
        const n = typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        for (let slot = 0; slot < n; slot++) {
            syncTrackPhraseRehearsalMarks({ type: 'extra', slot });
        }
    }

    function refreshAllRegionMusicalMetaPresentation() {
        refreshAllRegionRehearsalMarkLabels();
        if (typeof getExtraTrackCount !== 'function' || typeof updateTrackRegionOverlays !== 'function') {
            return;
        }
        const n = getExtraTrackCount();
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            if (typeof isTrackRegionActive === 'function' && !isTrackRegionActive(track)) continue;
            updateTrackRegionOverlays(track);
        }
    }

    window.formatRehearsalMarkForPhraseSlot = formatRehearsalMarkForPhraseSlot;
    window.formatRegionRehearsalMarkLabel = formatRegionRehearsalMarkLabel;
    window.refreshAllRegionRehearsalMarkLabels = refreshAllRegionRehearsalMarkLabels;
    window.refreshAllRegionMusicalMetaPresentation = refreshAllRegionMusicalMetaPresentation;
    const REGION_BOUNDARY_CLUSTER_PX = 12;
    const REGION_FADE_TRIANGLE_PX = 8;
    const FADE_TRIANGLE_COLLISION_GAP_PX = 1;

    function regionFadeTriangleHandleVisible(showWhenAllowed) {
        return !!showWhenAllowed;
    }

    function refreshAllPlaybackRegionFadeTriangles() {
        const n = getExtraTrackCount();
        for (let i = 0; i < n; i++) {
            const track = { type: 'extra', slot: i };
            const container = getPlaybackRegionsContainerEl(track);
            if (container) refreshTrackFadeTriangleVisibility(track, container);
        }
    }

    function getRegionOverlayTimelineMetrics() {
        const lanes =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        return typeof waveformTimelineMetrics === 'function' && lanes
            ? waveformTimelineMetrics(lanes)
            : null;
    }

    function regionOverlayWidthPxFromPct(widthPct, scrubW) {
        const w = Number(widthPct);
        const scrub = Number(scrubW);
        if (!(scrub > 0) || !Number.isFinite(w)) return 0;
        return Math.max(0, (w / 100) * scrub);
    }

    function transportSecToOverlayPx(transportSec, metrics, master) {
        if (!metrics || !(metrics.scrubW > 0) || !(master > 0)) return NaN;
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return NaN;
        return (t / master) * metrics.scrubW;
    }

    function collectTrackBoundaryTransports(track) {
        const segments = getTrackSegments(track);
        const list = [];
        const eps =
            typeof transportBoundaryEpsilonSec === 'function'
                ? transportBoundaryEpsilonSec()
                : 0.001;

        function add(transport, meta) {
            const t = Number(transport);
            if (!Number.isFinite(t)) return;
            for (let i = 0; i < list.length; i++) {
                if (Math.abs(list[i].transport - t) <= eps) {
                    list[i].meta.push(meta);
                    return;
                }
            }
            list.push({ transport: t, meta: [meta] });
        }

        for (let i = 0; i < segments.length; i++) {
            if (shouldShowSegmentInHandle(track, i)) {
                add(getSegmentRegionTimelineIn(track, i), { kind: 'in', segmentIndex: i });
            }
            if (shouldShowSegmentOutHandle(track, i)) {
                add(getSegmentTimelineEnd(track, i), { kind: 'out', segmentIndex: i });
            }
        }
        for (let b = 0; b < segments.length - 1; b++) {
            if (!isSegmentBoundaryJoined(track, b)) continue;
            add(getSegmentTimelineEnd(track, b), { kind: 'split', boundaryIndex: b });
        }
        list.sort((a, b) => a.transport - b.transport);
        return list;
    }

    function clusterBoundaryTransportsByPx(entries, metrics, master) {
        if (!entries.length) return [];
        const withPx = entries.map((entry) => ({
            entry,
            px: transportSecToOverlayPx(entry.transport, metrics, master),
        }));
        const clusters = [];
        let current = [withPx[0]];
        for (let i = 1; i < withPx.length; i++) {
            const item = withPx[i];
            if (
                Number.isFinite(item.px) &&
                Number.isFinite(current[0].px) &&
                item.px - current[0].px <= REGION_BOUNDARY_CLUSTER_PX
            ) {
                current.push(item);
            } else {
                clusters.push(current);
                current = [item];
            }
        }
        clusters.push(current);
        return clusters;
    }

    function isDenseBoundaryCluster(track, cluster, metrics, master) {
        if (!cluster || cluster.length < 2) return false;
        const firstPx = cluster[0].px;
        const lastPx = cluster[cluster.length - 1].px;
        if (!Number.isFinite(firstPx) || !Number.isFinite(lastPx)) return false;
        const spanPx = lastPx - firstPx;
        if (spanPx > REGION_BOUNDARY_CLUSTER_PX + 0.5) return false;

        if (spanPx < REGION_FADE_TRIANGLE_PX * 2 - 0.5) return true;

        const tol = Math.max(
            0.001,
            (REGION_BOUNDARY_CLUSTER_PX / metrics.scrubW) * master,
        );
        const segments = getTrackSegments(track);
        for (let i = 0; i < segments.length; i++) {
            const regionIn = getSegmentRegionTimelineIn(track, i);
            const regionOut = getSegmentTimelineEnd(track, i);
            let nearCluster = false;
            for (let b = 0; b < cluster.length; b++) {
                const t = cluster[b].entry.transport;
                if (Math.abs(regionIn - t) <= tol || Math.abs(regionOut - t) <= tol) {
                    nearCluster = true;
                    break;
                }
            }
            if (!nearCluster) continue;
            const widthPx = segmentRegionDisplayWidthPx(track, i, metrics, master);
            if (widthPx > 0 && widthPx < REGION_OVERLAY_NARROW_PX) return true;
        }
        return false;
    }

    function getDenseBoundaryTransportSet(track) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return new Set();
        const metrics = getRegionOverlayTimelineMetrics();
        if (!metrics || !(metrics.scrubW > 0)) return new Set();
        const boundaries = collectTrackBoundaryTransports(track);
        const clusters = clusterBoundaryTransportsByPx(boundaries, metrics, master);
        const dense = new Set();
        for (let c = 0; c < clusters.length; c++) {
            const cluster = clusters[c];
            if (!isDenseBoundaryCluster(track, cluster, metrics, master)) continue;
            for (let i = 0; i < cluster.length; i++) {
                dense.add(cluster[i].entry.transport);
            }
        }
        return dense;
    }

    function denseBoundaryMatchToleranceSec() {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const metrics = getRegionOverlayTimelineMetrics();
        if (!(master > 0) || !(metrics && metrics.scrubW > 0)) {
            return REGION_BOUNDARY_CLUSTER_PX / 1000;
        }
        return Math.max(
            typeof transportBoundaryEpsilonSec === 'function'
                ? transportBoundaryEpsilonSec()
                : 0.001,
            (REGION_BOUNDARY_CLUSTER_PX / metrics.scrubW) * master,
        );
    }

    function isTransportNearDenseBoundary(transportSec, denseSet) {
        if (!denseSet.size) return false;
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return false;
        const tol = denseBoundaryMatchToleranceSec();
        for (const boundary of denseSet) {
            if (Math.abs(boundary - t) <= tol) return true;
        }
        return false;
    }

    function isSegmentInDenseBoundaryZone(track, segmentIndex, denseSet) {
        if (!denseSet.size) return false;
        if (isTransportNearDenseBoundary(getSegmentRegionTimelineIn(track, segmentIndex), denseSet)) {
            return true;
        }
        if (isTransportNearDenseBoundary(getSegmentTimelineEnd(track, segmentIndex), denseSet)) {
            return true;
        }
        if (isTransportNearDenseBoundary(getSegmentTimelineStart(track, segmentIndex), denseSet)) {
            return true;
        }
        return false;
    }

    /** タイムライン上のリージョン幅（px）= 表示幅% × スクロール幅（ビューポート×倍率） */
    function segmentRegionDisplayWidthPx(track, segmentIndex, metrics, master) {
        if (!metrics || !(metrics.scrubW > 0) || !(master > 0)) return 0;
        const trackStart =
            typeof getTrackTimelineStartSec === 'function'
                ? getTrackTimelineStartSec(track)
                : 0;
        const inTransport = Math.max(
            trackStart,
            getSegmentRegionTimelineIn(track, segmentIndex),
        );
        const outTransport = getSegmentTimelineEnd(track, segmentIndex);
        const leftPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(inTransport)
                : (inTransport / master) * 100;
        const rightPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(outTransport)
                : (outTransport / master) * 100;
        return regionOverlayWidthPxFromPct(
            Math.max(0.05, rightPct - leftPct),
            metrics.scrubW,
        );
    }

    function getFadeTriangleWidthPx(sampleEl) {
        if (sampleEl) {
            const rect = sampleEl.getBoundingClientRect();
            if (rect.width > 0.5) return rect.width;
        }
        return REGION_FADE_TRIANGLE_PX;
    }

    function segmentRegionStartPx(track, segmentIndex, metrics, master) {
        if (!metrics || !(metrics.scrubW > 0) || !(master > 0)) return 0;
        const trackStart =
            typeof getTrackTimelineStartSec === 'function'
                ? getTrackTimelineStartSec(track)
                : 0;
        const inTransport = Math.max(
            trackStart,
            getSegmentRegionTimelineIn(track, segmentIndex),
        );
        return transportSecToOverlayPx(inTransport, metrics, master);
    }

    /** 三角の縦軸と占有幅（タイムライン px）。In=軸から右へ、Out=軸から左へ tri 幅。 */
    function fadeTriangleGlobalSpan(
        regionStartPx,
        regionWidthPx,
        axisRatio,
        triPx,
        kind,
    ) {
        const w = Number(regionWidthPx);
        const tri = Number(triPx);
        if (!(w > 0) || !(tri > 0)) return null;
        const axisPx = Math.max(0, Math.min(1, Number(axisRatio) || 0)) * w;
        const axisGlobal = Number(regionStartPx) + axisPx;
        if (kind === 'out') {
            return { axis: axisGlobal, left: axisGlobal - tri, right: axisGlobal };
        }
        return { axis: axisGlobal, left: axisGlobal, right: axisGlobal + tri };
    }

    function fadeTriangleFitsInRegion(axisRatio, regionWidthPx, triPx, kind) {
        const span = fadeTriangleGlobalSpan(0, regionWidthPx, axisRatio, triPx, kind);
        if (!span) return false;
        const w = Number(regionWidthPx);
        const tri = Number(triPx);
        if (kind === 'out') {
            return span.axis >= tri - 0.5 && span.axis <= w + 0.5;
        }
        return span.left >= -0.5 && span.right <= w + 0.5;
    }

    function fadeTriangleSpansOverlap(spanA, spanB, gapPx, kindA, kindB) {
        const gap = Number(gapPx) || 0;
        if (kindA === 'out' && kindB === 'in') {
            if (spanA.right <= spanB.left + gap + 0.5) return false;
        } else if (kindA === 'in' && kindB === 'out') {
            if (spanB.right <= spanA.left + gap + 0.5) return false;
        }
        return spanA.right > spanB.left + gap && spanB.right > spanA.left + gap;
    }

    function computeSegmentFadeTriangleLayout(track, segmentIndex, metrics, master, triPx) {
        const widthPx = segmentRegionDisplayWidthPx(track, segmentIndex, metrics, master);
        const regionStartPx = segmentRegionStartPx(track, segmentIndex, metrics, master);
        const inTransport = Math.max(
            typeof getTrackTimelineStartSec === 'function'
                ? getTrackTimelineStartSec(track)
                : 0,
            getSegmentRegionTimelineIn(track, segmentIndex),
        );
        const outTransport = getSegmentTimelineEnd(track, segmentIndex);
        const regionDur = Math.max(0.001, outTransport - inTransport);
        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const playbackFromRegion = Math.max(0, playbackStart - inTransport);
        const fadeInMax = getSegmentFadeDurationLimit(track, segmentIndex, 'in');
        const fadeOutMax = getSegmentFadeDurationLimit(track, segmentIndex, 'out');
        const fadeInSec = getSegmentFadeDurationSec(track, segmentIndex, 'in');
        const fadeOutSec = getSegmentFadeDurationSec(track, segmentIndex, 'out');
        const fadeInRatio = Math.max(0, Math.min(1, fadeInSec / regionDur));
        const fadeOutRatio = Math.max(0, Math.min(1, fadeOutSec / regionDur));
        const playbackOffsetRatio = Math.max(0, Math.min(1, playbackFromRegion / regionDur));
        const fadeInAxisRatio = playbackOffsetRatio + fadeInRatio;
        const fadeOutAxisRatio = Math.max(0, 1 - fadeOutRatio);

        let showIn =
            fadeInMax > 0.0005 &&
            fadeTriangleFitsInRegion(fadeInAxisRatio, widthPx, triPx, 'in');
        let showOut =
            fadeOutMax > 0.0005 &&
            fadeTriangleFitsInRegion(fadeOutAxisRatio, widthPx, triPx, 'out');

        const spanIn = showIn
            ? fadeTriangleGlobalSpan(
                  regionStartPx,
                  widthPx,
                  fadeInAxisRatio,
                  triPx,
                  'in',
              )
            : null;
        const spanOut = showOut
            ? fadeTriangleGlobalSpan(
                  regionStartPx,
                  widthPx,
                  fadeOutAxisRatio,
                  triPx,
                  'out',
              )
            : null;

        if (showIn && showOut && spanIn && spanOut) {
            if (
                fadeTriangleSpansOverlap(
                    spanIn,
                    spanOut,
                    FADE_TRIANGLE_COLLISION_GAP_PX,
                    'in',
                    'out',
                )
            ) {
                showIn = false;
                showOut = false;
            }
        }

        return {
            fadeInAxisRatio,
            fadeOutAxisRatio,
            showIn,
            showOut,
            spanIn,
            spanOut,
            widthPx,
            regionStartPx,
        };
    }

    function collectVisibleFadeTriangleSpans(entries) {
        const visible = [];
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            if (e.layout.showIn && e.layout.spanIn) {
                visible.push({ entry: e, kind: 'in', span: e.layout.spanIn });
            }
            if (e.layout.showOut && e.layout.spanOut) {
                visible.push({ entry: e, kind: 'out', span: e.layout.spanOut });
            }
        }
        visible.sort((a, b) => a.span.left - b.span.left);
        return visible;
    }

    function resolveFadeTriangleCollisionsOnTrack(entries, triPx, gapPx) {
        void triPx;
        const maxPasses = Math.max(1, entries.length * 2);
        for (let pass = 0; pass < maxPasses; pass++) {
            const visible = collectVisibleFadeTriangleSpans(entries);
            let changed = false;
            for (let i = 0; i < visible.length - 1; i++) {
                const left = visible[i];
                const right = visible[i + 1];
                if (
                    !fadeTriangleSpansOverlap(
                        left.span,
                        right.span,
                        gapPx,
                        left.kind,
                        right.kind,
                    )
                ) {
                    continue;
                }

                if (left.kind === 'out' && right.kind === 'in') {
                    left.entry.layout.showOut = false;
                    left.entry.layout.spanOut = null;
                    right.entry.layout.showIn = false;
                    right.entry.layout.spanIn = null;
                } else {
                    if (left.kind === 'in') {
                        left.entry.layout.showIn = false;
                        left.entry.layout.spanIn = null;
                    } else {
                        left.entry.layout.showOut = false;
                        left.entry.layout.spanOut = null;
                    }
                    if (right.kind === 'in') {
                        right.entry.layout.showIn = false;
                        right.entry.layout.spanIn = null;
                    } else {
                        right.entry.layout.showOut = false;
                        right.entry.layout.spanOut = null;
                    }
                }
                changed = true;
                break;
            }
            if (!changed) break;
        }
    }

    function applySegmentFadeTriangleLayoutToRegionEl(regionEl, layout) {
        const fadeInHandle = regionEl.querySelector(
            '.audio-waveform-lane__playback-region__handle--fade-in',
        );
        if (fadeInHandle) {
            fadeInHandle.style.left = layout.fadeInAxisRatio * 100 + '%';
            fadeInHandle.style.right = 'auto';
            fadeInHandle.hidden = !regionFadeTriangleHandleVisible(layout.showIn);
        }
        const fadeOutHandle = regionEl.querySelector(
            '.audio-waveform-lane__playback-region__handle--fade-out',
        );
        if (fadeOutHandle) {
            fadeOutHandle.style.left = layout.fadeOutAxisRatio * 100 + '%';
            fadeOutHandle.style.right = 'auto';
            fadeOutHandle.hidden = !regionFadeTriangleHandleVisible(layout.showOut);
        }
    }

    function applyRegionFadeHandlesDefault(track, segmentIndex, regionEl) {
        const inTransport = Math.max(
            typeof getTrackTimelineStartSec === 'function'
                ? getTrackTimelineStartSec(track)
                : 0,
            getSegmentRegionTimelineIn(track, segmentIndex),
        );
        const outTransport = getSegmentTimelineEnd(track, segmentIndex);
        const regionDur = Math.max(0.001, outTransport - inTransport);
        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const playbackFromRegion = Math.max(0, playbackStart - inTransport);
        const fadeInMax = getSegmentFadeDurationLimit(track, segmentIndex, 'in');
        const fadeOutMax = getSegmentFadeDurationLimit(track, segmentIndex, 'out');
        const fadeInSec = getSegmentFadeDurationSec(track, segmentIndex, 'in');
        const fadeOutSec = getSegmentFadeDurationSec(track, segmentIndex, 'out');
        const fadeInRatio = Math.max(0, Math.min(1, fadeInSec / regionDur));
        const fadeOutRatio = Math.max(0, Math.min(1, fadeOutSec / regionDur));
        const playbackOffsetRatio = Math.max(0, Math.min(1, playbackFromRegion / regionDur));
        const fadeInAxisRatio = playbackOffsetRatio + fadeInRatio;
        const fadeOutAxisRatio = Math.max(0, 1 - fadeOutRatio);

        const fadeInHandle = regionEl.querySelector(
            '.audio-waveform-lane__playback-region__handle--fade-in',
        );
        if (fadeInHandle) {
            fadeInHandle.style.left = fadeInAxisRatio * 100 + '%';
            fadeInHandle.style.right = 'auto';
            fadeInHandle.hidden = !regionFadeTriangleHandleVisible(fadeInMax > 0.0005);
        }
        const fadeOutHandle = regionEl.querySelector(
            '.audio-waveform-lane__playback-region__handle--fade-out',
        );
        if (fadeOutHandle) {
            fadeOutHandle.style.left = fadeOutAxisRatio * 100 + '%';
            fadeOutHandle.style.right = 'auto';
            fadeOutHandle.hidden = !regionFadeTriangleHandleVisible(fadeOutMax > 0.0005);
        }
    }

    function refreshTrackFadeTriangleVisibility(track, container) {
        if (!container) return;
        const denseSet = getDenseBoundaryTransportSet(track);
        const regionEls = container.querySelectorAll(
            '.audio-waveform-lane__playback-region',
        );

        if (!denseSet.size) {
            for (let i = 0; i < regionEls.length; i++) {
                const segmentIndex = Number(regionEls[i].dataset.segmentIndex);
                if (!Number.isFinite(segmentIndex) || segmentIndex < 0) continue;
                applyRegionFadeHandlesDefault(track, segmentIndex, regionEls[i]);
            }
            return;
        }

        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const metrics = getRegionOverlayTimelineMetrics();
        const sampleHandle = container.querySelector(
            '.audio-waveform-lane__playback-region__handle--fade-in, .audio-waveform-lane__playback-region__handle--fade-out',
        );
        const triPx = getFadeTriangleWidthPx(sampleHandle);

        const entries = [];
        for (let i = 0; i < regionEls.length; i++) {
            const regionEl = regionEls[i];
            const segmentIndex = Number(regionEl.dataset.segmentIndex);
            if (!Number.isFinite(segmentIndex) || segmentIndex < 0) continue;

            if (!isSegmentInDenseBoundaryZone(track, segmentIndex, denseSet)) {
                applyRegionFadeHandlesDefault(track, segmentIndex, regionEl);
                continue;
            }

            const layout = computeSegmentFadeTriangleLayout(
                track,
                segmentIndex,
                metrics,
                master,
                triPx,
            );
            applySegmentFadeTriangleLayoutToRegionEl(regionEl, layout);
            entries.push({ segmentIndex, regionEl, layout });
        }

        resolveFadeTriangleCollisionsOnTrack(
            entries,
            triPx,
            FADE_TRIANGLE_COLLISION_GAP_PX,
        );

        for (let i = 0; i < entries.length; i++) {
            applySegmentFadeTriangleLayoutToRegionEl(
                entries[i].regionEl,
                entries[i].layout,
            );
        }
    }

    function applyDenseBoundaryLineHandleDedup(container) {
        const handles = container.querySelectorAll(
            '.audio-waveform-lane__playback-region__handle--in, .audio-waveform-lane__playback-region__handle--out, .audio-waveform-lane__playback-region__handle--split',
        );
        for (let i = 0; i < handles.length; i++) {
            handles[i].classList.remove(
                'audio-waveform-lane__playback-region__handle--dense-boundary-secondary',
            );
        }

        const items = [];
        for (let i = 0; i < handles.length; i++) {
            const el = handles[i];
            if (el.hidden) continue;
            const rect = el.getBoundingClientRect();
            if (!(rect.width > 0) || !(rect.height > 0)) continue;
            items.push({ el, cx: rect.left + rect.width * 0.5 });
        }
        items.sort((a, b) => a.cx - b.cx);

        const clusters = [];
        let current = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (
                !current.length ||
                item.cx - current[0].cx <= REGION_BOUNDARY_CLUSTER_PX
            ) {
                current.push(item);
            } else {
                clusters.push(current);
                current = [item];
            }
        }
        if (current.length) clusters.push(current);

        for (let c = 0; c < clusters.length; c++) {
            const cluster = clusters[c];
            if (cluster.length < 2) continue;
            for (let i = 1; i < cluster.length; i++) {
                cluster[i].el.classList.add(
                    'audio-waveform-lane__playback-region__handle--dense-boundary-secondary',
                );
            }
        }
    }

    function applyDenseRegionBoundaryPresentation(track, container) {
        if (!container) return;
        const denseSet = getDenseBoundaryTransportSet(track);
        const hasDense = denseSet.size > 0;
        const phraseActive =
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible();
        container.classList.toggle(
            'audio-waveform-lane__playback-regions--dense-boundaries',
            hasDense,
        );
        container.classList.toggle(
            'audio-waveform-lane__playback-regions--phrase-split-narrow',
            phraseActive,
        );

        const regionEls = container.querySelectorAll(
            '.audio-waveform-lane__playback-region',
        );
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const metrics = getRegionOverlayTimelineMetrics();

        if (!hasDense && !phraseActive) {
            for (let i = 0; i < regionEls.length; i++) {
                regionEls[i].classList.remove(
                    'audio-waveform-lane__playback-region--dense-boundary',
                    'audio-waveform-lane__playback-region--narrow',
                    'audio-waveform-lane__playback-region--phrase-narrow',
                );
            }
            applyDenseBoundaryLineHandleDedup(container);
            return;
        }

        for (let i = 0; i < regionEls.length; i++) {
            const el = regionEls[i];
            const segmentIndex = Number(el.dataset.segmentIndex);
            if (!Number.isFinite(segmentIndex) || segmentIndex < 0) continue;

            const inDense = hasDense && isSegmentInDenseBoundaryZone(track, segmentIndex, denseSet);
            el.classList.toggle(
                'audio-waveform-lane__playback-region--dense-boundary',
                inDense,
            );

            const widthPx = segmentRegionDisplayWidthPx(
                track,
                segmentIndex,
                metrics,
                master,
            );
            const narrow = inDense && widthPx > 0 && widthPx < REGION_OVERLAY_NARROW_PX;
            const phraseNarrow =
                phraseActive &&
                widthPx > 0 &&
                widthPx < REGION_OVERLAY_MIN_CSS_PX;
            el.classList.toggle('audio-waveform-lane__playback-region--narrow', narrow);
            el.classList.toggle(
                'audio-waveform-lane__playback-region--phrase-narrow',
                phraseNarrow,
            );
        }

        if (hasDense) {
            applyDenseBoundaryLineHandleDedup(container);
        }
    }

    function refreshAllRegionBoundaryPresentation() {
        const n =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            const container = getPlaybackRegionsContainerEl(track);
            if (!container || container.hidden) continue;
            applyDenseRegionBoundaryPresentation(track, container);
            refreshTrackFadeTriangleVisibility(track, container);
        }
    }

    window.refreshAllRegionBoundaryPresentation = refreshAllRegionBoundaryPresentation;

    /** 同一クリップ連続結合チェーンを 1 本の overview として描画（セグメント数分のループを避ける） */
