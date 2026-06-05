/**
 * waveform-region-render.js — 波形リージョン描画
 */
    const REGION_OVERLAY_NARROW_PX = 22;
    /** CSS .audio-waveform-lane__playback-region { min-width: 28px } と揃える */
    const REGION_OVERLAY_MIN_CSS_PX = 28;
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
    function drawContinuousSegmentChainOverview(
        ctx,
        track,
        slot,
        wCss,
        hCss,
        mid,
        grad,
        vp,
        segments,
    ) {
        if (!trackSegmentsAreContinuousSameClipChain(track)) return false;
        for (let i = 0; i < segments.length; i++) {
            if (segmentHasViewportPeaksForDraw(vp, i)) return false;
        }
        const clipId = segments[0].clipId || getSegmentClipId(track, 0);
        const fullDur = getSegmentSourceDurationSec(track, segments[0]);
        const peaks = getSegmentPeaksForDraw(slot, clipId);
        if (!peaks || !peaks.length || !fullDur) return false;

        const chainStart = getSegmentTimelineStart(track, 0);
        const chainEnd = getSegmentTimelineEnd(track, segments.length - 1);
        const chainDur = chainEnd - chainStart;
        if (!(chainDur > 0.0005)) return false;

        const srcIn = segments[0].sourceInSec;
        const srcOut = segments[segments.length - 1].sourceOutSec;
        const chainPeaks = slicePeaksForRegion(peaks, fullDur, srcIn, srcOut);
        if (!chainPeaks || !chainPeaks.length) return false;

        const startX =
            typeof masterTimelineContentWidth === 'function'
                ? masterTimelineContentWidth(wCss, chainStart)
                : 0;
        const contentW =
            typeof masterTimelineContentWidth === 'function'
                ? masterTimelineContentWidth(wCss, chainDur)
                : wCss;
        const drawW = contentW > 0 ? contentW : wCss;
        const barW = drawW / chainPeaks.length;

        ctx.fillStyle = grad || '#ffffff';
        for (let p = 0; p < chainPeaks.length; p++) {
            const pk = chainPeaks[p];
            const x = startX + p * barW;
            const barTransport =
                chainStart + ((p + 0.5) / chainPeaks.length) * chainDur;
            const segIdx = segmentIndexAtMasterTransport(track, barTransport);
            const hideBefore = getSegmentWaveformHideBeforeTimeline(track, segIdx);
            if (barTransport < hideBefore - 0.0005) continue;
            if (viewportPeaksCoverMasterTime(vp, barTransport)) continue;
            drawWaveformBarAtTransport(
                ctx,
                track,
                slot,
                x,
                barW,
                mid,
                barTransport,
                pk,
                segIdx,
                vp ? { viewportPeaks: vp } : null,
            );
        }
        return true;
    }

    function drawExtraTrackWaveformRegions(ctx, wCss, hCss, slot, grad) {
        const track = { type: 'extra', slot };
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        let vp = tr ? tr.viewportPeaks : null;
        const t0 = getTrackTimelineStartSec(track);
        const state = getPlaybackRegionsState(track);
        const hasConfiguredRegions =
            state &&
            state.active &&
            Array.isArray(state.segments) &&
            state.segments.length > 0;
        const segments = getTrackSegments(track);
        const mid = hCss * 0.5;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;

        ctx.clearRect(0, 0, wCss, hCss);
        ctx.fillStyle =
            typeof TIMELINE_LANE_TRACK_BG !== 'undefined'
                ? TIMELINE_LANE_TRACK_BG
                : '#161820';
        ctx.fillRect(0, 0, wCss, hCss);

        if (!segments.length) {
            if (hasConfiguredRegions) {
                if (tr) {
                    tr.viewportPeaks = null;
                    vp = null;
                }
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, mid);
                ctx.lineTo(wCss, mid);
                ctx.stroke();
                return;
            }
            const fullDur = getTrackSourceDurationSec(track);
            const peaks = tr ? tr.peaks : null;
            if (!peaks || !peaks.length || !fullDur) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, mid);
                ctx.lineTo(wCss, mid);
                ctx.stroke();
                return;
            }
            if (typeof drawPeaksForMasterTimeline === 'function') {
                const drawOpt = { timelineStartSec: t0 };
                if (vp && vp.segments && vp.segments.length === 1) {
                    drawOpt.viewportPeaks = vp.segments[0];
                } else if (vp && vp.peaks) {
                    drawOpt.viewportPeaks = vp;
                }
                drawPeaksForMasterTimeline(ctx, peaks, wCss, hCss, fullDur, grad, drawOpt);
            }
            return;
        }

        ctx.fillStyle = grad || '#ffffff';
        const chainOverviewDrawn = drawContinuousSegmentChainOverview(
            ctx,
            track,
            slot,
            wCss,
            hCss,
            mid,
            grad,
            vp,
            segments,
        );
        if (!chainOverviewDrawn) {
            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                const clipId = seg.clipId || getSegmentClipId(track, i);
                const fullDur = getSegmentSourceDurationSec(track, seg);
                if (segmentHasViewportPeaksForDraw(vp, i)) continue;

                const peaks = getSegmentPeaksForDraw(slot, clipId);
                if (!peaks || !peaks.length || !fullDur) continue;
                const segPeaks = slicePeaksForRegion(
                    peaks,
                    fullDur,
                    seg.sourceInSec,
                    seg.sourceOutSec,
                );
                if (!segPeaks || !segPeaks.length) continue;
                const segT0 = getSegmentTimelineStart(track, i);
                const contentDur = seg.sourceOutSec - seg.sourceInSec;
                if (!(contentDur > 0.0005)) continue;
                const startX =
                    typeof masterTimelineContentWidth === 'function'
                        ? masterTimelineContentWidth(wCss, segT0)
                        : 0;
                const contentW =
                    typeof masterTimelineContentWidth === 'function'
                        ? masterTimelineContentWidth(wCss, contentDur)
                        : wCss;
                const drawW = contentW > 0 ? contentW : wCss;
                const barW = drawW / segPeaks.length;
                const waveformHideBefore = getSegmentWaveformHideBeforeTimeline(track, i);
                for (let p = 0; p < segPeaks.length; p++) {
                    const barTransport =
                        segT0 + ((p + 0.5) / segPeaks.length) * contentDur;
                    if (barTransport < waveformHideBefore - 0.0005) {
                        continue;
                    }
                    const x =
                        typeof masterTimelineContentWidth === 'function'
                            ? masterTimelineContentWidth(wCss, barTransport) - barW * 0.5
                            : startX + p * barW;
                    if (viewportPeaksCoverMasterTime(vp, barTransport)) {
                        continue;
                    }
                    drawWaveformBarAtTransport(
                        ctx,
                        track,
                        slot,
                        x,
                        barW,
                        mid,
                        barTransport,
                        segPeaks[p],
                        i,
                        vp ? { viewportPeaks: vp } : null,
                    );
                }
            }
        }

        drawRegionViewportPeaks(ctx, wCss, hCss, master, vp, grad, track);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, mid);
        ctx.lineTo(wCss, mid);
        ctx.stroke();
        if (typeof drawTimelineVideoEndMarkerLine === 'function') {
            drawTimelineVideoEndMarkerLine(ctx, wCss, hCss);
        }
    }

    function applySegmentsToState(track, segments, opt) {
        if (!isExtraTrackRef(track)) return false;
        if (!segments.length) return false;
        if (!(opt && opt.skipUndo) && !regionUndoPaused) {
            requestRegionUndoCapture();
        }

        const state = getPlaybackRegionsState(track);
        const prevSegmentCount = state.segments ? state.segments.length : 0;
        state.segments = segments;
        state.active = true;
        bumpRegionPersistEpoch(track.slot);
        if (
            !(typeof isSessionRestoreInProgress === 'function' && isSessionRestoreInProgress()) &&
            !(opt && opt.keepPendingRestore)
        ) {
            pendingPlaybackRegionRestore = null;
        }

        updateTrackRegionOverlays(track);
        const redrawOpt = {
            invalidatePeakCache: true,
            segmentStructureChanged: prevSegmentCount !== segments.length,
        };
        if (opt && Array.isArray(opt.affectedSegmentIndices) && opt.affectedSegmentIndices.length) {
            redrawOpt.affectedSegmentIndices = opt.affectedSegmentIndices;
        }
        redrawAfterRegionChange(track.slot, redrawOpt);

        if (!(opt && opt.silent)) {
            writeLog(
                'Ex ' +
                    (track.slot + 1) +
                    ' split: ' +
                    segments.length +
                    ' region(s)',
            );
            flashSeekHint('Ex ' + (track.slot + 1), segments.length + ' regions', 'notice');
        }
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        return true;
    }

    function setTrackSegments(track, segments, opt) {
        if (!isExtraTrackRef(track)) return false;
        const normalized = [];
        for (const seg of segments) {
            let fullDur = getSegmentSourceDurationSec(track, seg);
            if (!fullDur) {
                const inS = Number(seg && seg.sourceInSec) || 0;
                const outS = Number(seg && seg.sourceOutSec);
                if (Number.isFinite(outS) && outS > inS + 1e-6) fullDur = outS;
            }
            if (!fullDur) continue;
            normalized.push(normalizeSegmentEntry(seg, track, fullDur));
        }
        if (!normalized.length) return false;

        if (
            typeof isRangeLoopPlaybackActive === 'function' &&
            isRangeLoopPlaybackActive() &&
            typeof clearRangeLoopPlayback === 'function'
        ) {
            clearRangeLoopPlayback({ silent: true });
        }

        return applySegmentsToState(track, normalized, opt);
    }

    function clearTrackRegion(track, opt) {
        if (!isExtraTrackRef(track)) return;
        if (!(opt && opt.skipUndo) && !regionUndoPaused) {
            requestRegionUndoCapture();
        }
        const state = getPlaybackRegionsState(track);
        if (!state) return;
        const was = state.active && state.segments.length;
        state.segments = [];
        state.active = false;
        state.headPadSec = 0;
        delete state.regionTimelineInSec;
        delete state.regionLeadPadSec;
        updateTrackRegionOverlays(track);
        syncExtraLaneRegionsClassForTrack(track);
        if (was) {
            noteRegionShrinkPersistIntent(track.slot);
            redrawAfterRegionChange(track.slot);
            if (!(opt && opt.silent)) {
                writeLog('Ex ' + (track.slot + 1) + ' regions: off');
            }
            if (typeof schedulePersistSession === 'function') schedulePersistSession();
        }
    }

    function clearPlaybackRegion(opt) {
        if (!(opt && opt.skipUndo) && !regionUndoPaused) {
            requestRegionUndoCapture();
        }
        const childOpt = Object.assign({}, opt || {}, { skipUndo: true });
        const n =
            getExtraTrackCount();
        for (let i = 0; i < n; i++) {
            clearTrackRegion({ type: 'extra', slot: i }, childOpt);
        }
        if (!(opt && opt.silent) && typeof flashSeekHint === 'function') {
            flashSeekHint('Region', 'Off', 'notice');
        }
    }

    function suppressInvalidRegionOpNoticeForVideoAudio() {
        return (
            typeof pointerTargetsVideoAudioLane === 'function' &&
            pointerTargetsVideoAudioLane()
        );
    }

    function resolveTargetExtraSlot() {
        let clientY = null;
        if (typeof getWaveformLanesPointerClientY === 'function') {
            clientY = getWaveformLanesPointerClientY();
        }
        if (clientY == null && typeof getWaveformPointerClientY === 'function') {
            clientY = getWaveformPointerClientY();
        }
        if (
            clientY != null &&
            typeof waveformExtraLaneSlotFromClientY === 'function' &&
            !suppressInvalidRegionOpNoticeForVideoAudio()
        ) {
            const slot = waveformExtraLaneSlotFromClientY(clientY);
            if (slot >= 0 && isExtraSlotUsableForRegion(slot)) {
                return slot;
            }
        }
        if (typeof getWaveformTargetExtraSlot === 'function') {
            const slot = getWaveformTargetExtraSlot();
            if (slot >= 0 && isExtraSlotUsableForRegion(slot)) {
                return slot;
            }
        }
        if (
            clientY != null &&
            typeof extraLaneSlotFromClientY === 'function'
        ) {
            const slot = extraLaneSlotFromClientY(clientY);
            if (slot >= 0 && isExtraSlotUsableForRegion(slot)) {
                return slot;
            }
        }
        const domSlot = getActiveMixExtraSlotFromDom();
        if (domSlot >= 0 && isExtraSlotUsableForRegion(domSlot)) return domSlot;
        if (typeof getLastActiveMixExtraSlot === 'function') {
            const slot = getLastActiveMixExtraSlot();
            if (slot >= 0 && isExtraSlotUsableForRegion(slot)) return slot;
        }
        if (typeof ensureDefaultActiveMixExtraSlot === 'function') {
            const slot = ensureDefaultActiveMixExtraSlot();
            if (slot >= 0 && isExtraSlotUsableForRegion(slot)) return slot;
        }
        return -1;
    }

    function resolvePasteTargetExtraSlot() {
        const slot = resolveTargetExtraSlot();
        if (slot >= 0) return slot;
        if (
            regionSegmentClipboard &&
            isExtraSlotUsableForRegion(regionSegmentClipboard.slot)
        ) {
            return regionSegmentClipboard.slot;
        }
        return -1;
    }

    function isExtraSlotUsableForRegion(slot) {
        if (slot < 0) return false;
        if (typeof isExtraTrackLoaded === 'function' && isExtraTrackLoaded(slot)) {
            return true;
        }
        if (
            typeof isExtraTrackLaneShown === 'function' &&
            isExtraTrackLaneShown(slot) &&
            typeof isTrackRegionActive === 'function' &&
            isTrackRegionActive({ type: 'extra', slot })
        ) {
            return true;
        }
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        const hint = tr ? Number(tr.restoreDurationHint) : 0;
        return Number.isFinite(hint) && hint > 0;
    }

    function transportSecFromWaveformPointer() {
        let clientX = null;
        if (typeof getWaveformLanesPointerClientX === 'function') {
            clientX = getWaveformLanesPointerClientX();
        }
        if (clientX == null && typeof getWaveformPointerClientX === 'function') {
            clientX = getWaveformPointerClientX();
        }
        if (Number.isFinite(clientX)) {
            const lanes = getWaveformLanesEl();
            if (lanes) {
                const r = lanes.getBoundingClientRect();
                if (clientX >= r.left && clientX <= r.right) {
                    const fromPointer = transportSecAtClientX(clientX);
                    if (Number.isFinite(fromPointer)) return fromPointer;
                }
            }
        }
        if (typeof getTransportSec === 'function') {
            return getTransportSec();
        }
        return typeof transportPlaybackSec === 'number' ? transportPlaybackSec : 0;
    }

    function transportSecFromSeekbar() {
        if (typeof getTransportSec === 'function') {
            return getTransportSec();
        }
        return typeof transportPlaybackSec === 'number' ? transportPlaybackSec : 0;
    }

    function extraSlotFromPlaybackRegionEl(regionEl) {
        if (!regionEl) return -1;
        const lane = regionEl.closest('.audio-waveform-lane--extra');
        if (!lane || !lane.id) return -1;
        const m = /^extraAudioLane(\d+)$/.exec(lane.id);
        return m ? parseInt(m[1], 10) : -1;
    }

    function getActiveMixExtraSlotFromDom() {
        const n =
            getExtraTrackCount();
        for (let i = 0; i < n; i++) {
            const meta = document.getElementById('extraAudioMeta' + i);
            if (
                meta &&
                !meta.hidden &&
                meta.classList.contains('audio-waveform-lane-meta--active')
            ) {
                return i;
            }
        }
        return -1;
    }

    /** スプリット対象 Ex：リージョン上 → そのリージョン／それ以外 → アクティブトラック（赤表示） */
    function resolveSplitTargetExtraSlot() {
        const { clientX, clientY } = waveformPointerClientXY();
        const regionEl = findPlaybackRegionElAtPointer(clientX, clientY);
        if (regionEl) {
            const slot = extraSlotFromPlaybackRegionEl(regionEl);
            if (slot >= 0 && isExtraSlotUsableForRegion(slot)) return slot;
        }
        const targetSlot = resolveTargetExtraSlot();
        if (targetSlot >= 0) return targetSlot;
        if (typeof resolveMixTargetFromPointer === 'function' && Number.isFinite(clientY)) {
            const target = resolveMixTargetFromPointer(clientY);
            if (target && target.kind === 'extra') {
                const slot = target.slot;
                if (isExtraSlotUsableForRegion(slot)) return slot;
            }
        }
        const domSlot = getActiveMixExtraSlotFromDom();
        if (domSlot >= 0 && isExtraSlotUsableForRegion(domSlot)) return domSlot;
        if (typeof getLastActiveMixExtraSlot === 'function') {
            const slot = getLastActiveMixExtraSlot();
            if (slot >= 0 && isExtraSlotUsableForRegion(slot)) return slot;
        }
        if (typeof ensureDefaultActiveMixExtraSlot === 'function') {
            const slot = ensureDefaultActiveMixExtraSlot();
            if (slot >= 0 && isExtraSlotUsableForRegion(slot)) return slot;
        }
        return -1;
    }

    function clampRegionEditTransportSec(track, sec) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!master) return 0;
        let t = Number(sec);
        if (!Number.isFinite(t)) t = 0;
        t = Math.max(0, Math.min(master, t));

        const segments = getTrackSegments(track);
        if (!segments.length) {
            const t0 = getTrackTimelineStartSec(track);
            const fullDur = getTrackSourceDurationSec(track);
            if (!fullDur) return t;
            return Math.max(
                t0 + PLAYBACK_REGION_MIN_SEC,
                Math.min(t0 + fullDur - PLAYBACK_REGION_MIN_SEC, t),
            );
        }

        if (mapTransportToSegment(track, t)) return t;

        const t0 = getTrackTimelineStartSec(track);
        const end = getTrackTimelineEndSec(track);
        return Math.max(
            t0 + PLAYBACK_REGION_MIN_SEC,
            Math.min(end - PLAYBACK_REGION_MIN_SEC, t),
        );
    }

    function getRegionSplitTargetTransportSec(track, clientX, clientY) {
        let pointerSec = null;
        if (Number.isFinite(clientX)) {
            const laneSlot =
                Number.isFinite(clientY) && typeof extraLaneSlotFromClientY === 'function'
                    ? extraLaneSlotFromClientY(clientY)
                    : -1;
            const canUsePointer =
                laneSlot === track.slot ||
                (!Number.isFinite(clientY) &&
                    !!findPlaybackRegionElAtPointer(clientX, clientY));
            if (canUsePointer) {
                pointerSec = transportSecAtClientX(clientX);
            }
        }
        if (Number.isFinite(pointerSec)) {
            const thresholdSec = regionSnapThresholdSec();
            const altSuppressed =
                typeof isSnapSuppressedByAlt === 'function'
                    ? isSnapSuppressedByAlt()
                    : false;
            const markersShownOnWaveform =
                typeof audioWaveformMarkers !== 'undefined' &&
                audioWaveformMarkers &&
                !audioWaveformMarkers.hidden;
            let snapped = pointerSec;
            if (markersShownOnWaveform) {
                if (typeof snapSecToMarkerInOut === 'function') {
                    snapped = snapSecToMarkerInOut(pointerSec, {
                        thresholdSec,
                        altKey: altSuppressed,
                    });
                }
            } else if (typeof snapRegionTransportSec === 'function') {
                snapped = snapRegionTransportSec(pointerSec, {
                    sameSlotOnly: -1,
                    altKey: altSuppressed,
                });
            }
            const clamped = clampRegionEditTransportSec(track, snapped);
            writeLog(
                'Playback region split target: pointer sec=' +
                    pointerSec.toFixed(3) +
                    ' snapped=' +
                    snapped.toFixed(3) +
                    ' final=' +
                    clamped.toFixed(3),
            );
            return clamped;
        }
        const seekbarSec = transportSecFromSeekbar();
        const clamped = clampRegionEditTransportSec(track, seekbarSec);
        writeLog(
            'Playback region split target: seekbar sec=' +
                seekbarSec.toFixed(3) +
                ' final=' +
                clamped.toFixed(3),
        );
        return clamped;
    }

    function splitPlaybackRegionAtTargetSec() {
        const { clientX, clientY } = waveformPointerClientXY();
        const slot = resolveSplitTargetExtraSlot();
        if (slot < 0) {
            if (!suppressInvalidRegionOpNoticeForVideoAudio()) {
                writeLog(
                    'Playback region: hover an Ex lane (1–' +
                        getExtraTrackCount() +
                        '), then press X',
                );
                flashSeekHint('Region', "Can't split here", 'error');
            }
            return false;
        }
        if (!isExtraSlotUsableForRegion(slot)) {
            writeLog('Playback region: load an extra audio track first');
            return false;
        }
        const track = { type: 'extra', slot };

        const splitTransport = getRegionSplitTargetTransportSec(track, clientX, clientY);
        const segments = getTrackSegments(track);
        if (
            segments.length &&
            isPlaybackRegionSplitForbiddenAtTransport(track, splitTransport)
        ) {
            writeLog('Playback region: split at boundary or too close to adjacent region');
            flashSeekHint('Region', "Can't split here", 'error');
            return false;
        }
        if (!mapTransportToSegment(track, splitTransport) && segments.length) {
            writeLog('Playback region: split inside a region (not at edges)');
            flashSeekHint('Region', "Can't split here", 'error');
            return false;
        }
        if (!segments.length) {
            const clipId = getPrimaryClipIdForTrack(track);
            const fullDur =
                typeof getExtraTrackClipDurationSec === 'function'
                    ? getExtraTrackClipDurationSec(slot, clipId)
                    : getTrackSourceDurationSec(track);
            if (!fullDur) {
                writeLog('Playback region: track has no duration');
                return false;
            }
            const t0 = getTrackTimelineStartSec(track);
            const sourceSplit = Math.max(
                PLAYBACK_REGION_MIN_SEC,
                Math.min(fullDur, splitTransport - t0),
            );
            const seeded = [
                {
                    id: newRegionId(),
                    clipId,
                    sourceInSec: 0,
                    sourceOutSec: fullDur,
                    timelineStartSec: t0,
                },
            ];
            if (!setTrackSegments(track, seeded, { silent: true })) {
                writeLog('Playback region: split failed (could not apply segments)');
                flashSeekHint('Region', "Can't split here", 'error');
                return false;
            }
        }
        if (
            getTrackSegments(track).length &&
            isPlaybackRegionSplitForbiddenAtTransport(track, splitTransport)
        ) {
            writeLog('Playback region: split at boundary or too close to adjacent region');
            flashSeekHint('Region', "Can't split here", 'error');
            return false;
        }
        if (splitPlaybackRegionAtTransportSec(track, splitTransport)) {
            return true;
        }
        const frameStep =
            typeof masterFrameSec === 'number' && masterFrameSec > 0 ? masterFrameSec : 1 / 60;
        const retryOffsets = [1, -1, 2, -2, 3, -3];
        for (let i = 0; i < retryOffsets.length; i++) {
            const tRetry = splitTransport + retryOffsets[i] * frameStep;
            if (isPlaybackRegionSplitForbiddenAtTransport(track, tRetry)) {
                continue;
            }
            if (splitPlaybackRegionAtTransportSec(track, tRetry)) {
                writeLog(
                    'Playback region: split retried at ±' +
                        Math.abs(retryOffsets[i]) +
                        ' frame(s)',
                );
                return true;
            }
        }
        if (
            segments.length &&
            isPlaybackRegionSplitForbiddenAtTransport(track, splitTransport)
        ) {
            writeLog('Playback region: split at boundary or too close to adjacent region');
            flashSeekHint('Region', "Can't split here", 'error');
            return false;
        }
        writeLog('Playback region: split inside a region (not at edges)');
        flashSeekHint('Region', "Can't split here", 'error');
        return false;
    }

    function clearExtraTrackViewportPeaksForSlot(slot) {
        if (!(slot >= 0)) return;
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        if (tr) tr.viewportPeaks = null;
    }

    function redrawAfterRegionChange(slot, opt) {
        const dragging = !!regionHandleDragActive;
        const structureChanged = !!(opt && opt.segmentStructureChanged);
        let usedViewportRefresh = false;
        if (typeof slot === 'number' && slot >= 0) {
            if (structureChanged) {
                clearExtraTrackViewportPeaksForSlot(slot);
            } else if (typeof refreshExtraTrackViewportPeaksForRegionEdit === 'function') {
                usedViewportRefresh = refreshExtraTrackViewportPeaksForRegionEdit(slot, opt);
            }
            if (!usedViewportRefresh) {
                clearExtraTrackViewportPeaksForSlot(slot);
            }
        } else if (typeof clearAllExtraWaveformViewportPeaks === 'function') {
            clearAllExtraWaveformViewportPeaks();
        }

        if (!usedViewportRefresh) {
            if (opt && opt.invalidatePeakCache && typeof clearViewportPeakCache === 'function') {
                clearViewportPeakCache();
            }
            if (typeof invalidateWaveformViewportHiresSpec === 'function') {
                invalidateWaveformViewportHiresSpec();
            }
        }

        if (
            typeof slot === 'number' &&
            slot >= 0 &&
            typeof drawExtraTrackWaveform === 'function'
        ) {
            drawExtraTrackWaveform(slot);
        } else if (typeof redrawAllExtraTrackWaveforms === 'function') {
            redrawAllExtraTrackWaveforms();
        }

        if (!dragging && typeof scheduleWaveformHiresRedrawAfterZoom === 'function') {
            const hiresOpt =
                typeof slot === 'number' && slot >= 0 ? { slots: [slot] } : undefined;
            scheduleWaveformHiresRedrawAfterZoom(hiresOpt);
        }
        if (typeof updateRangeLoopOverlay === 'function') updateRangeLoopOverlay();
        if (typeof updateAllWaveformPlayheads === 'function') updateAllWaveformPlayheads();
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
    }

    function getPlaybackRegionsContainerEl(track) {
        if (!isExtraTrackRef(track)) return null;
        const lane = document.getElementById('extraAudioLane' + track.slot);
        if (!lane) return null;
        return lane.querySelector('.audio-waveform-lane__playback-regions');
    }

    function syncExtraLaneRegionsClassForTrack(track) {
        if (!isExtraTrackRef(track)) return;
        const lane = document.getElementById('extraAudioLane' + track.slot);
        if (!lane) return;
        const hasRegions = isTrackRegionActive(track);
        const hadRegions = lane.classList.contains('audio-waveform-lane--has-regions');
        lane.classList.toggle('audio-waveform-lane--has-regions', hasRegions);
        if (
            hadRegions !== hasRegions &&
            typeof renderAudioWaveformMarkers === 'function'
        ) {
            renderAudioWaveformMarkers();
        }
    }

    function buildRegionOverlayEl(track, segmentIndex, seg) {
        const el = document.createElement('div');
        el.className = 'audio-waveform-lane__playback-region';
        if (getSegmentRegionGroupId(track, segmentIndex)) {
            el.classList.add('audio-waveform-lane__playback-region--grouped');
        }
        if (isRegionEntrySelected(track.slot, segmentIndex)) {
            el.classList.add('audio-waveform-lane__playback-region--selected');
        }
        el.dataset.segmentIndex = String(segmentIndex);
        if (shouldShowSegmentInHandle(track, segmentIndex)) {
            const handleIn = document.createElement('div');
            handleIn.className =
                'audio-waveform-lane__playback-region__handle audio-waveform-lane__playback-region__handle--in';
            handleIn.title = 'Region ' + (segmentIndex + 1) + ' In（開始位置）';
            el.appendChild(handleIn);
        }
        if (shouldShowSegmentOutHandle(track, segmentIndex)) {
            const handleOut = document.createElement('div');
            handleOut.className =
                'audio-waveform-lane__playback-region__handle audio-waveform-lane__playback-region__handle--out';
            handleOut.title = 'Region ' + (segmentIndex + 1) + ' Out（終了位置）';
            el.appendChild(handleOut);
        }
        const fadeCurve = document.createElement('div');
        fadeCurve.className = 'audio-waveform-lane__playback-region__fade-curve';
        fadeCurve.setAttribute('aria-hidden', 'true');
        const fadeInCurve = document.createElement('div');
        fadeInCurve.className =
            'audio-waveform-lane__playback-region__fade-curve-part audio-waveform-lane__playback-region__fade-curve-part--in';
        const fadeInSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        fadeInSvg.setAttribute('class', 'audio-waveform-lane__playback-region__fade-svg');
        fadeInSvg.setAttribute('viewBox', '0 0 100 100');
        fadeInSvg.setAttribute('preserveAspectRatio', 'none');
        const fadeInPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        fadeInPath.setAttribute('d', 'M 0 99 Q 50 99 100 1');
        fadeInSvg.appendChild(fadeInPath);
        fadeInCurve.appendChild(fadeInSvg);
        const fadeOutCurve = document.createElement('div');
        fadeOutCurve.className =
            'audio-waveform-lane__playback-region__fade-curve-part audio-waveform-lane__playback-region__fade-curve-part--out';
        const fadeOutSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        fadeOutSvg.setAttribute('class', 'audio-waveform-lane__playback-region__fade-svg');
        fadeOutSvg.setAttribute('viewBox', '0 0 100 100');
        fadeOutSvg.setAttribute('preserveAspectRatio', 'none');
        const fadeOutPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        fadeOutPath.setAttribute('d', 'M 100 99 Q 50 99 0 1');
        fadeOutSvg.appendChild(fadeOutPath);
        fadeOutCurve.appendChild(fadeOutSvg);
        fadeCurve.appendChild(fadeInCurve);
        fadeCurve.appendChild(fadeOutCurve);
        el.appendChild(fadeCurve);

        const fadeInHandle = document.createElement('div');
        fadeInHandle.className =
            'audio-waveform-lane__playback-region__handle audio-waveform-lane__playback-region__handle--fade-in';
        fadeInHandle.title = 'Fade In（内側へドラッグ）';
        el.appendChild(fadeInHandle);
        const fadeOutHandle = document.createElement('div');
        fadeOutHandle.className =
            'audio-waveform-lane__playback-region__handle audio-waveform-lane__playback-region__handle--fade-out';
        fadeOutHandle.title = 'Fade Out（内側へドラッグ）';
        el.appendChild(fadeOutHandle);

        const gainDb = getSegmentGainDb(track, segmentIndex);
        const gainLabel = document.createElement('span');
        gainLabel.className = 'audio-waveform-lane__playback-region__gain-db';
        const gainText = formatRegionGainDbDisplay(gainDb);
        gainLabel.textContent = gainText;
        gainLabel.hidden = !gainText;
        gainLabel.setAttribute('aria-hidden', gainText ? 'false' : 'true');
        el.appendChild(gainLabel);
        const cursorLine = document.createElement('div');
        cursorLine.className = 'audio-waveform-lane__playback-region__cursor-line';
        cursorLine.setAttribute('aria-hidden', 'true');
        cursorLine.hidden = true;
        el.appendChild(cursorLine);
        return el;
    }

    function buildSplitHandleEl(boundaryIndex) {
        const el = document.createElement('div');
        el.className =
            'audio-waveform-lane__playback-region__handle audio-waveform-lane__playback-region__handle--split';
        el.dataset.boundaryIndex = String(boundaryIndex);
        el.title = 'Split point（ドラッグで移動）';
        return el;
    }

    function positionSplitHandleEl(el, track, boundaryIndex) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!master) return;
        const splitTransport = getSegmentTimelineEnd(track, boundaryIndex);
        const pct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(splitTransport)
                : (splitTransport / master) * 100;
        el.style.left = pct + '%';
        el.style.width = '0';
        el.hidden = false;
    }

    function positionRegionOverlayEl(el, track, segmentIndex, seg) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!master) return;
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
        const widthPct = Math.max(0.05, rightPct - leftPct);
        el.style.left = leftPct + '%';
        el.style.width = widthPct + '%';
        el.hidden = false;

        applyRegionFadeHandlesDefault(track, segmentIndex, el);

        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const regionDur = Math.max(0.001, outTransport - inTransport);
        const playbackFromRegion = Math.max(0, playbackStart - inTransport);
        const fadeInSec = getSegmentFadeDurationSec(track, segmentIndex, 'in');
        const fadeOutSec = getSegmentFadeDurationSec(track, segmentIndex, 'out');
        const fadeInRatio = Math.max(0, Math.min(1, fadeInSec / regionDur));
        const fadeOutRatio = Math.max(0, Math.min(1, fadeOutSec / regionDur));
        const playbackOffsetRatio = Math.max(0, Math.min(1, playbackFromRegion / regionDur));

        const fadeCurve = el.querySelector('.audio-waveform-lane__playback-region__fade-curve');
        if (fadeCurve) {
            fadeCurve.style.setProperty('--region-fade-in-start', playbackOffsetRatio * 100 + '%');
            fadeCurve.style.setProperty('--region-fade-in-width', fadeInRatio * 100 + '%');
            fadeCurve.style.setProperty('--region-fade-out-width', fadeOutRatio * 100 + '%');
        }
    }

    /** 再生ミックスと同じ区間で、同一トラック内のクロスフェード重なりを列挙 */
    function collectTrackCrossfadeZones(track) {
        const segments = getTrackSegments(track);
        if (segments.length < 2) return [];
        const zones = [];
        for (let i = 0; i < segments.length; i++) {
            for (let j = i + 1; j < segments.length; j++) {
                const oStart = Math.max(
                    getSegmentPlaybackTimelineStart(track, i),
                    getSegmentPlaybackTimelineStart(track, j),
                );
                const oEnd = Math.min(
                    getSegmentTimelineEnd(track, i),
                    getSegmentTimelineEnd(track, j),
                );
                const minOverlap =
                    typeof window.MIN_CROSSFADE_OVERLAP_SEC === 'number'
                        ? window.MIN_CROSSFADE_OVERLAP_SEC
                        : 0.005;
                if (oEnd - oStart < minOverlap) continue;
                zones.push({ startSec: oStart, endSec: oEnd });
            }
        }
        return zones;
    }

    function buildCrossfadeMarkerEl() {
        const el = document.createElement('div');
        el.className = 'audio-waveform-lane__crossfade-marker';
        el.setAttribute('aria-hidden', 'true');
        el.title = 'Crossfade（クロスフェード量）';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'audio-waveform-lane__crossfade-marker__shape');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('preserveAspectRatio', 'none');
        const fadeOut = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        fadeOut.setAttribute('d', 'M 1 1 Q 50 14 99 99');
        const fadeIn = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        fadeIn.setAttribute('d', 'M 1 99 Q 50 14 99 1');
        svg.appendChild(fadeOut);
        svg.appendChild(fadeIn);
        el.appendChild(svg);
        return el;
    }

    function positionCrossfadeMarkerEl(el, startSec, endSec) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!master) return;
        const leftPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(startSec)
                : (startSec / master) * 100;
        const rightPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(endSec)
                : (endSec / master) * 100;
        el.style.left = leftPct + '%';
        el.style.width = Math.max(0.08, rightPct - leftPct) + '%';
        el.hidden = false;
    }

    function resolveRegionSegmentIndexAtPointer(track, clientX, clientY) {
        const regionEl = findPlaybackRegionElAtPointer(clientX, clientY);
        if (regionEl) {
            const lane = regionEl.closest('.audio-waveform-lane--extra');
            const m = lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
            if (m && parseInt(m[1], 10) === track.slot) {
                const idx = Number(regionEl.dataset.segmentIndex);
                if (Number.isFinite(idx) && idx >= 0) return idx;
            }
        }
        if (
            hoveredPlaybackRegionEl &&
            !hoveredPlaybackRegionEl.hidden
        ) {
            const lane = hoveredPlaybackRegionEl.closest('.audio-waveform-lane--extra');
            const m = lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
            if (m && parseInt(m[1], 10) === track.slot) {
                const idx = Number(hoveredPlaybackRegionEl.dataset.segmentIndex);
                if (Number.isFinite(idx) && idx >= 0) return idx;
            }
        }
        let transportSec = null;
        if (Number.isFinite(clientX)) {
            transportSec = transportSecAtClientX(clientX);
        }
        if (!Number.isFinite(transportSec)) {
            transportSec = transportSecFromWaveformPointer();
        }
        transportSec = clampRegionEditTransportSec(track, transportSec);
        const mapHit = mapTransportToSegmentForPlayback(track, transportSec);
        if (mapHit) return mapHit.segmentIndex;
        const mapHitUi = mapTransportToSegment(track, transportSec);
        return mapHitUi ? mapHitUi.segmentIndex : -1;
    }

    function deleteRegionSegmentAt(track, segmentIndex) {
        if (typeof clearRegionSelection === 'function') clearRegionSelection();
        if (!regionUndoPaused) requestRegionUndoCapture();
        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        if (!segments[segmentIndex]) return false;
        segments.splice(segmentIndex, 1);
        if (!segments.length) {
            const state = getPlaybackRegionsState(track);
            if (state) {
                state.active = false;
                state.segments = [];
            }
            if (ensureDefaultTrackRegion(track, { silent: true })) {
                writeLog('Ex ' + (track.slot + 1) + ': region reset to full clip');
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint('Ex ' + (track.slot + 1), 'Region reset', 'notice');
                }
                redrawAfterRegionChange(track.slot);
                return true;
            }
            clearTrackRegion(track, { skipUndo: true });
            writeLog('Ex ' + (track.slot + 1) + ': all regions removed');
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Ex ' + (track.slot + 1), 'Regions off', 'notice');
            }
            return true;
        }
        applySegmentsToState(track, segments, { skipUndo: true });
        writeLog(
            'Ex ' +
                (track.slot + 1) +
                ': region ' +
                (segmentIndex + 1) +
                ' deleted (' +
                segments.length +
                ' left)',
        );
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Ex ' + (track.slot + 1), 'Region deleted', 'notice');
        }
        return true;
    }

    function waveformPointerClientXY() {
        let clientX = null;
        let clientY = null;
        if (typeof getWaveformLanesPointerClientX === 'function') {
            clientX = getWaveformLanesPointerClientX();
        }
        if (typeof getWaveformLanesPointerClientY === 'function') {
            clientY = getWaveformLanesPointerClientY();
        }
        if (clientX == null && typeof getWaveformPointerClientX === 'function') {
            clientX = getWaveformPointerClientX();
        }
        if (clientY == null && typeof getWaveformPointerClientY === 'function') {
            clientY = getWaveformPointerClientY();
        }
        return { clientX, clientY };
    }

    function snapshotSegmentForClipboard(track, segmentIndex) {
        const raw = getRawSegmentEntry(track, segmentIndex);
        const seg = getTrackSegments(track)[segmentIndex];
        if (!raw || !seg) return null;
        return {
            clipId: seg.clipId || raw.clipId || 'main',
            sourceInSec: seg.sourceInSec,
            sourceOutSec: seg.sourceOutSec,
            anchorStartSec: getSegmentTimelineStart(track, segmentIndex),
            regionInSec: getSegmentRegionTimelineIn(track, segmentIndex),
            regionLeadPadSec: getSegmentRegionLeadPadSec(track, segmentIndex),
            gainDb: getSegmentGainDb(track, segmentIndex),
            fadeInSec: getSegmentFadeDurationSec(track, segmentIndex, 'in'),
            fadeOutSec: getSegmentFadeDurationSec(track, segmentIndex, 'out'),
        };
    }

    function copyRegionSegmentUnderCursor() {
        const slot = resolveTargetExtraSlot();
        if (slot < 0) {
            if (!suppressInvalidRegionOpNoticeForVideoAudio()) {
                writeLog('Playback region: hover an Ex lane, then Ctrl+C to copy');
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint('Region', 'Hover Ex lane', 'notice');
                }
            }
            return false;
        }
        const track = { type: 'extra', slot };
        if (!isTrackRegionActive(track)) return false;
        const { clientX, clientY } = waveformPointerClientXY();
        let segmentIndex = resolveRegionSegmentIndexAtPointer(track, clientX, clientY);
        if (segmentIndex < 0) {
            const t = clampRegionEditTransportSec(track, transportSecFromWaveformPointer());
            const playHit = mapTransportToSegmentForPlayback(track, t);
            if (playHit) segmentIndex = playHit.segmentIndex;
        }
        if (segmentIndex < 0) {
            writeLog('Playback region: copy — hover a region on Ex ' + (slot + 1));
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'Hover a region', 'notice');
            }
            return false;
        }
        const segment = snapshotSegmentForClipboard(track, segmentIndex);
        if (!segment) return false;
        regionSegmentClipboard = { slot, segmentIndex, segment };
        writeLog(
            'Ex ' +
                (slot + 1) +
                ': region ' +
                (segmentIndex + 1) +
                ' copied',
        );
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Ex ' + (slot + 1), 'Region copied', 'notice');
        }
        return true;
    }

    function shiftSegmentEntriesTimelineFromIndex(segments, track, fromIndex, delta) {
        if (!Number.isFinite(delta) || Math.abs(delta) < 0.00001) return;
        const state = getPlaybackRegionsState(track);
        for (let i = fromIndex; i < segments.length; i++) {
            const seg = segments[i];
            if (Number.isFinite(seg.timelineStartSec)) {
                seg.timelineStartSec += delta;
            }
            if (i === 0) {
                if (state && Number.isFinite(state.regionTimelineInSec)) {
                    state.regionTimelineInSec = Math.max(0, state.regionTimelineInSec + delta);
                }
            } else if (Number.isFinite(seg.regionTimelineInSec)) {
                seg.regionTimelineInSec = Math.max(0, seg.regionTimelineInSec + delta);
            }
        }
    }

    function pasteRegionSegmentToTrackEnd() {
        if (!regionSegmentClipboard) {
            if (!suppressInvalidRegionOpNoticeForVideoAudio()) {
                writeLog('Playback region: nothing to paste (Ctrl+C first)');
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint('Region', 'Copy a region first', 'notice');
                }
            }
            return false;
        }
        const slot = resolvePasteTargetExtraSlot();
        if (slot < 0) {
            if (!suppressInvalidRegionOpNoticeForVideoAudio()) {
                writeLog('Playback region: hover an Ex lane, then Ctrl+V to paste');
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint('Region', 'Hover Ex lane', 'notice');
                }
            }
            return false;
        }
        if (!isExtraSlotUsableForRegion(slot)) {
            writeLog('Playback region: load extra audio before paste');
            return false;
        }
        const track = { type: 'extra', slot };
        if (!isTrackRegionActive(track)) {
            ensureDefaultTrackRegion(track, { silent: true });
        }
        if (!isTrackRegionActive(track)) return false;

        const clip = regionSegmentClipboard.segment;
        const segments = getTrackSegments(track);
        if (!segments.length) return false;

        const eps = segmentBoundaryJoinEpsilonSec();
        const pasteDur = Math.max(
            PLAYBACK_REGION_MIN_SEC,
            (Number(clip.sourceOutSec) || 0) - (Number(clip.sourceInSec) || 0),
        );

        let srcIdx =
            regionSegmentClipboard.slot === slot &&
            Number.isFinite(regionSegmentClipboard.segmentIndex)
                ? regionSegmentClipboard.segmentIndex | 0
                : -1;
        if (srcIdx < 0 || srcIdx >= segments.length) {
            srcIdx = segments.length - 1;
        }

        const srcEnd = getSegmentTimelineEnd(track, srcIdx);
        let availableGap = Infinity;
        if (srcIdx < segments.length - 1) {
            availableGap =
                getSegmentTimelineStart(track, srcIdx + 1) - srcEnd;
        }
        const pushDelta =
            availableGap >= pasteDur - eps ? 0 : pasteDur - availableGap;
        const pasteStart = srcEnd;

        const clone = {
            id: newRegionId(),
            clipId: clip.clipId,
            sourceInSec: clip.sourceInSec,
            sourceOutSec: clip.sourceOutSec,
            timelineStartSec: pasteStart,
        };
        const regionInDelta = clip.regionInSec - clip.anchorStartSec;
        if (regionInDelta > SEGMENT_BOUNDARY_JOIN_EPS_SEC) {
            clone.regionTimelineInSec = pasteStart + regionInDelta;
        }
        if (
            Number.isFinite(clip.regionLeadPadSec) &&
            clip.regionLeadPadSec > 0 &&
            regionInDelta <= SEGMENT_BOUNDARY_JOIN_EPS_SEC
        ) {
            clone.regionLeadPadSec = clip.regionLeadPadSec;
        }
        if (Number.isFinite(clip.gainDb) && Math.abs(clip.gainDb) > 0.0005) {
            clone.gainDb = clip.gainDb;
        }
        if (Number.isFinite(clip.fadeOutSec) && clip.fadeOutSec > 0.0005) {
            clone.fadeOutSec = clip.fadeOutSec;
        }

        const fullDur = getSegmentSourceDurationSec(track, clone);
        if (!fullDur) return false;
        let norm = normalizeSegmentEntry(clone, track, fullDur);
        delete norm.fadeInSec;

        if (!regionUndoPaused) requestRegionUndoCapture();
        const working = segments.map((s) => ({ ...s }));
        const insertAt = srcIdx + 1;
        if (pushDelta > eps) {
            shiftSegmentEntriesTimelineFromIndex(working, track, insertAt, pushDelta);
        }
        const normalized = working.map((s) =>
            normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
        );
        const srcSeg = normalized[srcIdx];
        if (srcSeg && Number.isFinite(srcSeg.fadeOutSec)) {
            delete srcSeg.fadeOutSec;
        }
        normalized.splice(insertAt, 0, norm);
        applySegmentsToState(track, normalized, {
            silent: true,
            skipUndo: true,
            segmentStructureChanged: true,
        });
        writeLog(
            'Ex ' +
                (slot + 1) +
                ': region pasted after region ' +
                (srcIdx + 1) +
                ' (' +
                normalized.length +
                ' total)',
        );
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Ex ' + (slot + 1), 'Region pasted', 'notice');
        }
        return true;
    }

    function deleteRegionSegmentUnderCursor() {
        const slot = resolveTargetExtraSlot();
        if (slot < 0) return false;
        const track = { type: 'extra', slot };
        if (!isTrackRegionActive(track)) return false;
        const { clientX, clientY } = waveformPointerClientXY();
        const segmentIndex = resolveRegionSegmentIndexAtPointer(track, clientX, clientY);
        if (segmentIndex < 0) return false;
        noteRegionShrinkPersistIntent(track.slot);
        return deleteRegionSegmentAt(track, segmentIndex);
    }

    function getWaveformLanesEl() {
        if (typeof waveformScrubTargetEl === 'function') {
            return waveformScrubTargetEl();
        }
        return document.getElementById('audioWaveformLanesTracks');
    }

    function extraLaneSlotFromClientY(clientY) {
        if (!Number.isFinite(clientY)) return -1;
        const lanes = getWaveformLanesEl();
        if (!lanes) return -1;
        const laneEls = lanes.querySelectorAll('.audio-waveform-lane--extra');
        for (let i = 0; i < laneEls.length; i++) {
            const lane = laneEls[i];
            if (lane.hidden) continue;
            const rect = lane.getBoundingClientRect();
            if (clientY >= rect.top && clientY <= rect.bottom) {
                const m = /^extraAudioLane(\d+)$/.exec(lane.id);
                if (m) return parseInt(m[1], 10);
            }
        }
        return -1;
    }

    function transportSecAtClientX(clientX) {
        if (!Number.isFinite(clientX)) return null;
        if (typeof transportSecFromClientX === 'function') {
            return transportSecFromClientX(clientX);
        }
        if (typeof transportRatioFromClientX !== 'function') return null;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return null;
        return transportRatioFromClientX(clientX) * master;
    }

    function findPlaybackRegionElAtPointer(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;

        const hit = document.elementFromPoint(clientX, clientY);
        if (hit) {
            const fromHit = hit.closest('.audio-waveform-lane__playback-region');
            if (fromHit) return fromHit;
        }

        const slot = extraLaneSlotFromClientY(clientY);
        if (slot < 0) return null;

        const lane = document.getElementById('extraAudioLane' + slot);
        if (!lane || lane.hidden) return null;
        const laneRect = lane.getBoundingClientRect();
        if (
            clientX < laneRect.left ||
            clientX > laneRect.right ||
            clientY < laneRect.top ||
            clientY > laneRect.bottom
        ) {
            return null;
        }

        const track = { type: 'extra', slot };
        const container = getPlaybackRegionsContainerEl(track);
        if (!container || container.hidden) return null;

        const transportSec = transportSecAtClientX(clientX);
        if (!Number.isFinite(transportSec)) return null;

        const segments = getTrackSegments(track);
        for (let i = 0; i < segments.length; i++) {
            const start = getSegmentRegionTimelineIn(track, i);
            const end = getSegmentTimelineEnd(track, i);
            if (transportSec < start - 0.0005 || transportSec >= end - 0.002) continue;
            const el = container.querySelector(
                '.audio-waveform-lane__playback-region[data-segment-index="' + i + '"]',
            );
            if (el && !el.hidden) return el;
        }
        return null;
    }

    const regionCursorOverlayEl =
        typeof audioWaveformLanesInner !== 'undefined' && audioWaveformLanesInner
            ? (() => {
                  const el = document.createElement('div');
                  el.className = 'audio-waveform-composite__region-cursor';
                  el.hidden = true;
                  el.setAttribute('aria-hidden', 'true');
                  audioWaveformLanesInner.appendChild(el);
                  return el;
              })()
            : null;

    function hideRegionCursorOverlay() {
        if (regionCursorOverlayEl) regionCursorOverlayEl.hidden = true;
    }

    function showRegionCursorOverlayAtTransportSec(sec) {
        if (!regionCursorOverlayEl || !Number.isFinite(sec)) return;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) {
            hideRegionCursorOverlay();
            return;
        }
        const pct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(sec)
                : (sec / master) * 100;
        regionCursorOverlayEl.style.left = pct + '%';
        regionCursorOverlayEl.hidden = false;
    }

    function hideRegionCursorLine(regionEl) {
        void regionEl;
        hideRegionCursorOverlay();
    }

    function updateRegionCursorLine(regionEl, clientX, clientY, altKey) {
        const lanes = getWaveformLanesEl();
        if (
            lanes &&
            (lanes.classList.contains('audio-waveform-composite__lanes--scrubbing') ||
                lanes.classList.contains('audio-waveform-composite__lanes--offset-drag') ||
                lanes.classList.contains('audio-waveform-composite__lanes--region-drag') ||
                regionHandleDragActive)
        ) {
            hideRegionCursorOverlay();
            return;
        }
        if (!regionEl) {
            hideRegionCursorOverlay();
            return;
        }
        const r = regionEl.getBoundingClientRect();
        if (
            !Number.isFinite(clientX) ||
            !Number.isFinite(clientY) ||
            clientX < r.left ||
            clientX > r.right ||
            clientY < r.top ||
            clientY > r.bottom
        ) {
            hideRegionCursorOverlay();
            return;
        }
        const lane = regionEl.closest('.audio-waveform-lane--extra');
        const laneMatch = lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
        const slot = laneMatch ? parseInt(laneMatch[1], 10) : -1;
        const segmentIndex = Number(regionEl.dataset && regionEl.dataset.segmentIndex);

        // Pre-resolve this region's effective in/out transport range.
        // (We snap to these boundaries for region-only snapping.)
        const track =
            slot >= 0 ? { type: 'extra', slot: slot } : null;
        const thresholdSec = regionSnapThresholdSec();
        let inTransport = null;
        let outTransport = null;
        if (
            track &&
            typeof getTrackTimelineStartSec === 'function' &&
            typeof getSegmentRegionTimelineIn === 'function' &&
            typeof getSegmentTimelineEnd === 'function' &&
            Number.isFinite(segmentIndex)
        ) {
            const trackStart = getTrackTimelineStartSec(track);
            inTransport = Math.max(
                trackStart,
                getSegmentRegionTimelineIn(track, segmentIndex),
            );
            outTransport = getSegmentTimelineEnd(track, segmentIndex);
        }

        let tRaw = transportSecAtClientX(clientX);
        let snappedTransportSec = tRaw;
        if (
            slot >= 0 &&
            Number.isFinite(segmentIndex) &&
            typeof getTrackTimelineStartSec === 'function' &&
            typeof getSegmentRegionTimelineIn === 'function' &&
            typeof getSegmentTimelineEnd === 'function' &&
            Number.isFinite(snappedTransportSec)
        ) {
            if (Number.isFinite(inTransport) && outTransport > inTransport + 1e-6) {
                const markersShownOnWaveform =
                    typeof audioWaveformMarkers !== 'undefined' &&
                    audioWaveformMarkers &&
                    !audioWaveformMarkers.hidden;

                if (markersShownOnWaveform) {
                    // マーカー表示時: マーカー In/Out のみにスナップ
                    if (
                        typeof snapSecToMarkerInOut === 'function' &&
                        Number.isFinite(tRaw)
                    ) {
                        snappedTransportSec = snapSecToMarkerInOut(tRaw, {
                            thresholdSec,
                            altKey: !!altKey,
                        });
                    }
                } else {
                    // リージョン表示のみ: 実際のリージョン操作と同じ snapRegionTransportSec を使用
                    if (typeof snapRegionTransportSec === 'function' && Number.isFinite(tRaw)) {
                        snappedTransportSec = snapRegionTransportSec(tRaw, {
                            sameSlotOnly: -1,
                            altKey: !!altKey,
                        });
                    }
                }

            }
        }
        if (Number.isFinite(snappedTransportSec)) {
            showRegionCursorOverlayAtTransportSec(snappedTransportSec);
        } else {
            hideRegionCursorOverlay();
        }
    }

    function getPlaybackRegionOverlayEl(slot, segmentIndex) {
        const container = getPlaybackRegionsContainerEl({ type: 'extra', slot });
        if (!container) return null;
        return container.querySelector(
            '.audio-waveform-lane__playback-region[data-segment-index="' +
                segmentIndex +
                '"]',
        );
    }

    const REGION_GROUP_FLASH_CLASS =
        'audio-waveform-lane__playback-region--group-flash';

    /** グループ化完了時: メンバー全リージョンの枠を一度発光 */
    function flashRegionGroupMembers(members) {
        if (!members || !members.length) return;
        for (let i = 0; i < members.length; i++) {
            const m = members[i];
            const el = getPlaybackRegionOverlayEl(m.slot, m.segmentIndex);
            if (!el) continue;
            el.classList.remove(REGION_GROUP_FLASH_CLASS);
            const onEnd = (e) => {
                if (e && e.animationName && e.animationName !== 'regionGroupGlowPulse') {
                    return;
                }
                el.classList.remove(REGION_GROUP_FLASH_CLASS);
                el.removeEventListener('animationend', onEnd);
            };
            el.addEventListener('animationend', onEnd);
            requestAnimationFrame(() => {
                el.classList.add(REGION_GROUP_FLASH_CLASS);
            });
        }
    }

    function collectRegionGroupHoverElements(regionEl) {
        if (!regionEl) return [];
        const lane = regionEl.closest('.audio-waveform-lane--extra');
        const m = lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
        if (!m) return [regionEl];
        const slot = parseInt(m[1], 10);
        const segmentIndex = Number(regionEl.dataset.segmentIndex);
        if (!Number.isFinite(segmentIndex) || segmentIndex < 0) return [regionEl];
        const track = { type: 'extra', slot };
        const gid = getSegmentRegionGroupId(track, segmentIndex);
        if (!gid) return [regionEl];
        const members = collectRegionGroupMembers(track, segmentIndex);
        const out = [];
        for (let i = 0; i < members.length; i++) {
            const mem = members[i];
            const el = getPlaybackRegionOverlayEl(mem.slot, mem.segmentIndex);
            if (el && !el.hidden) out.push(el);
        }
        return out.length ? out : [regionEl];
    }

    function clearHoveredPlaybackRegionHighlight() {
        for (let i = 0; i < hoveredPlaybackRegionEls.length; i++) {
            hoveredPlaybackRegionEls[i].classList.remove(
                'audio-waveform-lane__playback-region--hover',
            );
        }
        hoveredPlaybackRegionEls.length = 0;
    }

    function setHoveredPlaybackRegion(el) {
        if (hoveredPlaybackRegionEl === el) return;
        if (hoveredPlaybackRegionEl) {
            hideRegionCursorLine(hoveredPlaybackRegionEl);
        }
        clearHoveredPlaybackRegionHighlight();
        hoveredPlaybackRegionEl = el || null;
        if (!hoveredPlaybackRegionEl) return;
        hoveredPlaybackRegionEls = collectRegionGroupHoverElements(hoveredPlaybackRegionEl);
        for (let i = 0; i < hoveredPlaybackRegionEls.length; i++) {
            hoveredPlaybackRegionEls[i].classList.add(
                'audio-waveform-lane__playback-region--hover',
            );
        }
    }

    const REGION_HANDLE_HOVER_CURSOR_CLASS =
        'audio-waveform-composite__lanes--region-handle-hover';

    function pointInClientRect(clientX, clientY, rect) {
        if (!rect || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        return (
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom
        );
    }

    /** ↔ カーソル判定矩形 */
    function collectRegionEwCursorHitRectsForTrack(track) {
        const container = getPlaybackRegionsContainerEl(track);
        if (!container || container.hidden) return [];
        const pad =
            typeof REGION_HANDLE_HIT_PAD_PX === 'number' ? REGION_HANDLE_HIT_PAD_PX : 4;
        const out = [];
        const regions = container.querySelectorAll('.audio-waveform-lane__playback-region');
        for (let r = 0; r < regions.length; r++) {
            const regionEl = regions[r];
            const regionRect = regionEl.getBoundingClientRect();

            if (typeof getFadeHandleHitRect === 'function') {
                for (let f = 0; f < 2; f++) {
                    const edgeKind = f === 0 ? 'in' : 'out';
                    const hitRect = getFadeHandleHitRect(regionEl, edgeKind);
                    if (!hitRect) continue;
                    out.push({
                        regionEl,
                        rect: hitRect,
                        kind: 'fade-' + edgeKind,
                    });
                }
            }

            for (let e = 0; e < 2; e++) {
                const edgeKind = e === 0 ? 'in' : 'out';
                const sel =
                    edgeKind === 'in'
                        ? '.audio-waveform-lane__playback-region__handle--in'
                        : '.audio-waveform-lane__playback-region__handle--out';
                const handleEl = regionEl.querySelector(sel);
                if (!handleEl) continue;
                const handleRect = handleEl.getBoundingClientRect();
                out.push({
                    regionEl,
                    rect: {
                        left: handleRect.left - pad,
                        top: regionRect.top,
                        right: handleRect.right + pad,
                        bottom: regionRect.bottom,
                    },
                    kind: 'edge-' + edgeKind,
                });
            }
        }
        return out;
    }

    function isPointerInRegionEwCursorHitZone(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        const n = getExtraTrackCount();
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            const lane = document.getElementById('extraAudioLane' + track.slot);
            if (!lane || lane.hidden) continue;
            const laneRect = lane.getBoundingClientRect();
            if (
                clientY < laneRect.top ||
                clientY > laneRect.bottom ||
                clientX < laneRect.left ||
                clientX > laneRect.right
            ) {
                continue;
            }
            const hits = collectRegionEwCursorHitRectsForTrack(track);
            for (let i = 0; i < hits.length; i++) {
                if (pointInClientRect(clientX, clientY, hits[i].rect)) return true;
            }
        }
        return false;
    }

    function clearRegionEwCursorPresentation() {
        const regions = document.querySelectorAll('.audio-waveform-lane__playback-region');
        for (let i = 0; i < regions.length; i++) {
            regions[i].classList.remove('audio-waveform-lane__playback-region--ew-cursor');
            regions[i].style.removeProperty('cursor');
        }
        if (typeof syncPhraseBoundaryDeferToRegionHandles === 'function') {
            syncPhraseBoundaryDeferToRegionHandles(false);
        }
    }

    function applyRegionEwCursorFromPointer(clientX, clientY) {
        clearRegionEwCursorPresentation();
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        let any = false;
        const n = getExtraTrackCount();
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            const hits = collectRegionEwCursorHitRectsForTrack(track);
            for (let i = 0; i < hits.length; i++) {
                const item = hits[i];
                if (!pointInClientRect(clientX, clientY, item.rect)) continue;
                any = true;
                item.regionEl.classList.add('audio-waveform-lane__playback-region--ew-cursor');
                item.regionEl.style.cursor = 'ew-resize';
            }
        }
        return any;
    }

    function updateRegionResizeHandleCursorFromPointer(clientX, clientY) {
        const lanes = getWaveformLanesEl();
        if (!lanes) return;
        const clear = () => {
            lanes.classList.remove(REGION_HANDLE_HOVER_CURSOR_CLASS);
            clearRegionEwCursorPresentation();
        };
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
            clear();
            return;
        }
        if (
            regionHandleDragActive ||
            lanes.classList.contains('audio-waveform-composite__lanes--offset-drag') ||
            lanes.classList.contains('audio-waveform-composite__lanes--region-drag')
        ) {
            clear();
            return;
        }
        const onHandle = applyRegionEwCursorFromPointer(clientX, clientY);
        if (typeof syncPhraseBoundaryDeferToRegionHandles === 'function') {
            syncPhraseBoundaryDeferToRegionHandles(onHandle);
        }
        lanes.classList.toggle(REGION_HANDLE_HOVER_CURSOR_CLASS, onHandle);
    }

    window.isPointerInRegionEwCursorHitZone = isPointerInRegionEwCursorHitZone;

    function updatePlaybackRegionHoverFromPointer(clientX, clientY, altKey) {
        updateRegionResizeHandleCursorFromPointer(clientX, clientY);
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
            setHoveredPlaybackRegion(null);
            lastRegionHoverClientX = null;
            lastRegionHoverClientY = null;
            return;
        }
        const region = findPlaybackRegionElAtPointer(clientX, clientY);
        setHoveredPlaybackRegion(region);
        lastRegionHoverClientX = clientX;
        lastRegionHoverClientY = clientY;
        if (region) {
            updateRegionCursorLine(region, clientX, clientY, altKey);
        }
    }

    function refreshPlaybackRegionHoverCursorLine() {
        if (!hoveredPlaybackRegionEl) return;
        if (!Number.isFinite(lastRegionHoverClientX) || !Number.isFinite(lastRegionHoverClientY)) return;
        updateRegionCursorLine(
            hoveredPlaybackRegionEl,
            lastRegionHoverClientX,
            lastRegionHoverClientY,
            false,
        );
    }

    window.refreshPlaybackRegionHoverCursorLine = refreshPlaybackRegionHoverCursorLine;

    /** ドラッグ中: DOM を作り直さず位置・フェード表示だけ更新（ハンドルが消えない） */
    function refreshTrackRegionOverlayGeometry(track) {
        const container = getPlaybackRegionsContainerEl(track);
        if (!container) return;
        const segments = getTrackSegments(track);
        if (!segments.length) {
            updateTrackRegionOverlays(track);
            return;
        }
        const regionEls = container.querySelectorAll(
            '.audio-waveform-lane__playback-region',
        );
        if (regionEls.length !== segments.length) {
            updateTrackRegionOverlays(track);
            return;
        }
        for (let i = 0; i < segments.length; i++) {
            positionRegionOverlayEl(regionEls[i], track, i, segments[i]);
        }
        const splitHandles = container.querySelectorAll(
            '.audio-waveform-lane__playback-region__handle--split',
        );
        for (let h = 0; h < splitHandles.length; h++) {
            const el = splitHandles[h];
            const b = Number(el.dataset.boundaryIndex);
            if (
                Number.isFinite(b) &&
                b >= 0 &&
                b < segments.length - 1 &&
                isSegmentBoundaryJoined(track, b)
            ) {
                positionSplitHandleEl(el, track, b);
            }
        }
        const zones = collectTrackCrossfadeZones(track);
        const markers = container.querySelectorAll('.audio-waveform-lane__crossfade-marker');
        if (markers.length !== zones.length) {
            updateTrackRegionOverlays(track);
            return;
        }
        for (let z = 0; z < zones.length; z++) {
            positionCrossfadeMarkerEl(markers[z], zones[z].startSec, zones[z].endSec);
        }
        applyDenseRegionBoundaryPresentation(track, container);
        refreshTrackFadeTriangleVisibility(track, container);
    }

    function updateTrackRegionOverlays(track) {
        if (
            isExtraTrackRef(track) &&
            typeof syncExtraTrackLaneMixVisual === 'function'
        ) {
            syncExtraTrackLaneMixVisual(track.slot);
        }
        const container = getPlaybackRegionsContainerEl(track);
        if (!container) return;
        const restoreHover =
            hoveredPlaybackRegionEl &&
            hoveredPlaybackRegionEl.parentElement === container;
        const hoverClientX =
            typeof getWaveformLanesPointerClientX === 'function'
                ? getWaveformLanesPointerClientX()
                : null;
        const hoverClientY =
            typeof getWaveformLanesPointerClientY === 'function'
                ? getWaveformLanesPointerClientY()
                : null;
        if (restoreHover) setHoveredPlaybackRegion(null);
        container.replaceChildren();
        const state = getPlaybackRegionsState(track);
        const hasConfiguredRegions =
            state &&
            state.active &&
            Array.isArray(state.segments) &&
            state.segments.length > 0;
        let segments = getTrackSegments(track);
        if (
            !segments.length &&
            !hasConfiguredRegions &&
            !isSessionRestoreBusy() &&
            ensureDefaultTrackRegion(track, { skipOverlay: true, silent: true })
        ) {
            segments = getTrackSegments(track);
        }
        if (!segments.length) {
            container.hidden = true;
            syncExtraLaneRegionsClassForTrack(track);
            return;
        }
        container.hidden = false;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const el = buildRegionOverlayEl(track, i, seg);
            positionRegionOverlayEl(el, track, i, seg);
            container.appendChild(el);
        }
        const crossfadeZones = collectTrackCrossfadeZones(track);
        for (let z = 0; z < crossfadeZones.length; z++) {
            const zone = crossfadeZones[z];
            const marker = buildCrossfadeMarkerEl();
            positionCrossfadeMarkerEl(marker, zone.startSec, zone.endSec);
            container.appendChild(marker);
        }
        for (let b = 0; b < segments.length - 1; b++) {
            if (!isSegmentBoundaryJoined(track, b)) continue;
            const splitEl = buildSplitHandleEl(b);
            positionSplitHandleEl(splitEl, track, b);
            container.appendChild(splitEl);
        }
        syncExtraLaneRegionsClassForTrack(track);
        syncRegionSelectionClasses();
        applyDenseRegionBoundaryPresentation(track, container);
        refreshTrackFadeTriangleVisibility(track, container);
        if (
            restoreHover &&
            Number.isFinite(hoverClientX) &&
            Number.isFinite(hoverClientY)
        ) {
            updatePlaybackRegionHoverFromPointer(hoverClientX, hoverClientY, false);
        }
    }

