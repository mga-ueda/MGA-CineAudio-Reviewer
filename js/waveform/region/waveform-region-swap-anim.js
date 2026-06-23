/**
 * waveform-region-swap-anim.js — リージョン入れ替えアニメーション
 */
    const REGION_SWAP_ANIM_MS = 500;
    const REGION_SWAP_REVEAL_FADE_MS = 180;
    const REGION_SWAP_MOTION_BLUR_GAIN = 0.022;
    const REGION_SWAP_MOTION_BLUR_MAX = 12;
    let playbackRegionSwapAnimActive = false;
    let playbackRegionSwapAnimPending = false;
    let regionSwapMotionBlurSvg = null;
    let regionSwapMotionBlurDefs = null;
    let regionSwapMotionBlurFilterSeq = 0;

    /** 入れ替え後 — リージョン DOM・波形・グリッドを同期（シーク相当の flush を含む） */
    function syncRegionSwapVisualPresentation(track, opt) {
        if (!track || !isExtraTrackRef(track)) return;
        const slot = track.slot | 0;
        const ro = opt && typeof opt === 'object' ? opt : {};
        if (typeof updateTrackRegionOverlays === 'function') {
            updateTrackRegionOverlays(track);
        }
        if (typeof redrawAfterRegionChange === 'function') {
            redrawAfterRegionChange(slot, {
                invalidatePeakCache: ro.invalidatePeakCache !== false,
            });
        }
        if (typeof flushWaveformVisualRefresh === 'function') {
            flushWaveformVisualRefresh({ sync: true, force: true });
        } else if (typeof scheduleRegionBoundaryPresentationRefresh === 'function') {
            scheduleRegionBoundaryPresentationRefresh({ sync: true });
        }
        if (typeof stopExtraTrackAllSources === 'function') {
            stopExtraTrackAllSources(slot);
        } else if (typeof stopAllExtraTrackSources === 'function') {
            stopAllExtraTrackSources();
        }
        if (
            typeof getTrackSegments === 'function' &&
            typeof invalidatePitchSliceCacheForSegment === 'function'
        ) {
            const segs = getTrackSegments(track);
            for (let i = 0; i < segs.length; i++) {
                invalidatePitchSliceCacheForSegment(track, i);
            }
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        refreshRegionRehearsalMarksAfterSwap();
        if (typeof window.refreshRehearsalTrack === 'function') {
            window.refreshRehearsalTrack();
        }
    }

    function normalizeRegionSwapSegmentPair(swapLo, swapHi) {
        const a = swapLo | 0;
        const b = swapHi | 0;
        return a <= b ? { lo: a, hi: b } : { lo: b, hi: a };
    }

    function swapMoveHasVisibleDisplacement(move) {
        if (!move || !move.from || !move.to) return false;
        return (
            Math.abs(move.from.left - move.to.left) > 0.5 ||
            Math.abs(move.from.width - move.to.width) > 0.5
        );
    }

    function filterVisibleRegionSwapMoves(moves) {
        if (!moves || !moves.length) return [];
        const out = [];
        for (let i = 0; i < moves.length; i++) {
            if (swapMoveHasVisibleDisplacement(moves[i])) out.push(moves[i]);
        }
        return out;
    }

    function swapMovesHaveVisibleDisplacement(moves) {
        if (!moves || !moves.length) return false;
        for (let i = 0; i < moves.length; i++) {
            if (swapMoveHasVisibleDisplacement(moves[i])) return true;
        }
        return false;
    }

    function segmentOverlayIntervalFromPreview(track, segmentIndex, previewSegments) {
        const seg = previewSegments[segmentIndex];
        if (!seg) return null;
        const trackStart =
            typeof getTrackTimelineStartSec === 'function'
                ? getTrackTimelineStartSec(track)
                : 0;
        const regionIn =
            typeof window.segmentCopyRegionIn === 'function'
                ? window.segmentCopyRegionIn(seg)
                : Number.isFinite(seg.regionTimelineInSec)
                  ? seg.regionTimelineInSec
                  : Number.isFinite(seg.timelineStartSec)
                    ? seg.timelineStartSec
                    : trackStart;
        const regionOut =
            typeof window.segmentCopyRegionOut === 'function'
                ? window.segmentCopyRegionOut(seg)
                : regionIn +
                  Math.max(
                      0.001,
                      (Number(seg.sourceOutSec) || 0) - (Number(seg.sourceInSec) || 0),
                  );
        return {
            start: Math.max(trackStart, regionIn),
            end: regionOut,
        };
    }

    function segmentOverlayPxFromStoredRect(rect) {
        if (!rect) return null;
        return {
            left: Number.isFinite(rect.left) ? rect.left : 0,
            width: Math.max(1, Number.isFinite(rect.width) ? rect.width : 1),
        };
    }

    function resolveSegmentOverlayPxFromLive(track, segmentIndex, metrics, master, oldOverlayIntervals) {
        if (
            oldOverlayIntervals &&
            segmentIndex >= 0 &&
            segmentIndex < oldOverlayIntervals.length
        ) {
            return segmentOverlayPxFromStoredRect(oldOverlayIntervals[segmentIndex]);
        }
        const iv = getSegmentRegionOverlayTimelineInterval(track, segmentIndex);
        if (!iv) return null;
        return timelineIntervalToPxRect(iv, metrics, master);
    }

    function timelineIntervalToPxRect(interval, metrics, master) {
        const toPx =
            typeof transportSecToOverlayPx === 'function'
                ? transportSecToOverlayPx
                : typeof window.transportSecToOverlayPx === 'function'
                  ? window.transportSecToOverlayPx
                  : null;
        if (!toPx) return null;
        const left = toPx(interval.start, metrics, master);
        const right = toPx(interval.end, metrics, master);
        if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
        return {
            left,
            width: Math.max(1, right - left),
        };
    }

    function playbackRegionPairSwapIsContentOnly(track, previewSegments, swapLo, swapHi) {
        const eps = 0.001;
        const lo = swapLo | 0;
        const hi = swapHi | 0;
        if (!previewSegments || lo < 0 || hi < 0) return false;
        for (let k = 0; k < 2; k++) {
            const i = k === 0 ? lo : hi;
            const oldIv = getSegmentRegionOverlayTimelineInterval(track, i);
            const seg = previewSegments[i];
            if (!oldIv || !seg) return false;
            const anchor = Number.isFinite(seg.timelineStartSec)
                ? seg.timelineStartSec
                : oldIv.start;
            const regionIn = Number.isFinite(seg.regionTimelineInSec)
                ? seg.regionTimelineInSec
                : anchor;
            const dur = Math.max(
                0,
                (Number(seg.sourceOutSec) || 0) - (Number(seg.sourceInSec) || 0),
            );
            const end = regionIn + (anchor - regionIn + dur);
            if (
                Math.abs(oldIv.start - regionIn) > eps ||
                Math.abs(oldIv.end - end) > eps
            ) {
                return false;
            }
        }
        return true;
    }

    function collectContentOnlyRegionSwapMoves(track, swapLo, swapHi, oldOverlayIntervals) {
        const pair = normalizeRegionSwapSegmentPair(swapLo, swapHi);
        const lo = pair.lo;
        const hi = pair.hi;
        const metrics = getRegionOverlayTimelineMetrics();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!metrics || !(metrics.scrubW > 0) || !(master > 0)) return [];
        const leftPx = resolveSegmentOverlayPxFromLive(track, lo, metrics, master, oldOverlayIntervals);
        const rightPx = resolveSegmentOverlayPxFromLive(track, hi, metrics, master, oldOverlayIntervals);
        if (!leftPx || !rightPx) return [];
        return buildEndpointRegionSwapMoves(leftPx, rightPx, rightPx, leftPx);
    }

    /** 端点2つ — timeline 先が live と同じなら相手側へクロス（中身入れ替えの視覚フィードバック） */
    function buildEndpointRegionSwapMoves(leftPx, rightPx, loToPx, hiToPx) {
        const loMove = { from: leftPx, to: loToPx, zIndex: 1, kind: 'region' };
        const hiMove = { from: rightPx, to: hiToPx, zIndex: 2, kind: 'region' };
        if (!swapMoveHasVisibleDisplacement(loMove)) {
            loMove.to = rightPx;
            loMove.kind = 'content-cross';
        }
        if (!swapMoveHasVisibleDisplacement(hiMove)) {
            hiMove.to = leftPx;
            hiMove.kind = 'content-cross';
        }
        return [loMove, hiMove];
    }

    function resolveSwapEndpointSegmentIndices(swapLo, swapHi, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const lo = swapLo | 0;
        const hi = swapHi | 0;
        const a = o.swapUnitSegmentIndicesA;
        const b = o.swapUnitSegmentIndicesB;
        if (a && a.length && b && b.length) {
            let minA = Infinity;
            let minB = Infinity;
            for (let i = 0; i < a.length; i++) minA = Math.min(minA, a[i] | 0);
            for (let i = 0; i < b.length; i++) minB = Math.min(minB, b[i] | 0);
            if (Number.isFinite(minA) && Number.isFinite(minB) && minA !== minB) {
                return minA < minB ? { lo: minA, hi: minB } : { lo: minB, hi: minA };
            }
        }
        return normalizeRegionSwapSegmentPair(lo, hi);
    }

    function collectSwapUnitSlideMoves(
        track,
        previewSegments,
        metrics,
        master,
        endpointLo,
        endpointHi,
        oldOverlayIntervals,
    ) {
        const moves = [];
        const n = previewSegments.length;
        for (let i = 0; i < n; i++) {
            if (i === endpointLo || i === endpointHi) continue;
            const from = resolveSegmentOverlayPxFromLive(
                track,
                i,
                metrics,
                master,
                oldOverlayIntervals,
            );
            const newIv = segmentOverlayIntervalFromPreview(track, i, previewSegments);
            if (!from || !newIv) continue;
            const to = timelineIntervalToPxRect(newIv, metrics, master);
            if (
                Math.abs(from.left - to.left) < 0.5 &&
                Math.abs(from.width - to.width) < 0.5
            ) {
                continue;
            }
            moves.push({ from, to, zIndex: 0 });
        }
        return moves;
    }

    function collectPlaybackRegionSwapMoves(track, previewSegments, swapLo, swapHi, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const segments = getTrackSegments(track);
        const n = segments.length;
        if (!n || n !== previewSegments.length) return [];
        const metrics = getRegionOverlayTimelineMetrics();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!metrics || !(metrics.scrubW > 0) || !(master > 0)) return [];

        const endpoints = resolveSwapEndpointSegmentIndices(swapLo, swapHi, o);
        const lo = endpoints.lo;
        const hi = endpoints.hi;
        if (lo < 0 || hi < 0) return [];
        if (lo === hi) return [];

        const oldOverlayIntervals = o.oldOverlayIntervals;
        const leftPx = resolveSegmentOverlayPxFromLive(
            track,
            lo,
            metrics,
            master,
            oldOverlayIntervals,
        );
        const rightPx = resolveSegmentOverlayPxFromLive(
            track,
            hi,
            metrics,
            master,
            oldOverlayIntervals,
        );
        if (!leftPx || !rightPx) return [];

        const contentOnly =
            !o.forceTimelineSwap &&
            (!!o.contentOnlySwap ||
                playbackRegionPairSwapIsContentOnly(track, previewSegments, lo, hi));
        if (contentOnly) {
            return collectContentOnlyRegionSwapMoves(track, lo, hi, oldOverlayIntervals);
        }

        let loToPx = rightPx;
        let hiToPx = leftPx;
        if (o.forceTimelineSwap) {
            const newLoIv = segmentOverlayIntervalFromPreview(track, lo, previewSegments);
            const newHiIv = segmentOverlayIntervalFromPreview(track, hi, previewSegments);
            if (newLoIv && newHiIv) {
                loToPx = timelineIntervalToPxRect(newLoIv, metrics, master);
                hiToPx = timelineIntervalToPxRect(newHiIv, metrics, master);
            }
        }

        /** 選択2つ: timeline 先 → 変位なし端点は相手側へクロス */
        const moves = buildEndpointRegionSwapMoves(leftPx, rightPx, loToPx, hiToPx);

        /** 非対称 recompose 時のみ — 間リージョンのスライド（対称 swap は選択2つのクロスだけ） */
        if (o.includeSlideMoves) {
            moves.push.apply(
                moves,
                collectSwapUnitSlideMoves(
                    track,
                    previewSegments,
                    metrics,
                    master,
                    lo,
                    hi,
                    oldOverlayIntervals,
                ),
            );
        }
        return moves;
    }

    /** 無音隙間 ↔ リージョン入れ替え: リージョン（ブロック）と隙間の2 ghosts */
    function collectSilentGapSegmentSwapMoves(track, gap, segmentIndex, swapPlan, segmentIndices) {
        if (!gap) return [];
        const indices =
            segmentIndices && segmentIndices.length
                ? segmentIndices
                : segmentIndex >= 0
                  ? [segmentIndex | 0]
                  : [];
        if (!indices.length) return [];
        const metrics = getRegionOverlayTimelineMetrics();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!metrics || !(metrics.scrubW > 0) || !(master > 0)) return [];

        let minStart = Infinity;
        let maxEnd = -Infinity;
        for (let i = 0; i < indices.length; i++) {
            const iv = getSegmentRegionOverlayTimelineInterval(track, indices[i]);
            if (!iv) return [];
            minStart = Math.min(minStart, iv.start);
            maxEnd = Math.max(maxEnd, iv.end);
        }
        const segOldIv = { start: minStart, end: maxEnd };
        let gapStart = gap.startSec;
        let delta = gapStart - segOldIv.start;
        if (swapPlan && Number.isFinite(swapPlan.delta)) {
            gapStart = swapPlan.targetSec;
            delta = swapPlan.delta;
        } else if (typeof silentGapSegmentSwapPlan === 'function') {
            const plan = silentGapSegmentSwapPlan(track, gap, indices);
            gapStart = plan.targetSec;
            delta = plan.delta;
        } else if (typeof silentGapMoveTargetSec === 'function') {
            gapStart = silentGapMoveTargetSec(gap, track);
            delta = gapStart - segOldIv.start;
        }
        const segNewIv = {
            start: segOldIv.start + delta,
            end: segOldIv.end + delta,
        };
        const gapIv = { start: gap.startSec, end: gap.endSec };

        const segOldPx = timelineIntervalToPxRect(segOldIv, metrics, master);
        const segNewPx = timelineIntervalToPxRect(segNewIv, metrics, master);
        const gapPx = timelineIntervalToPxRect(gapIv, metrics, master);

        return [
            { from: segOldPx, to: segNewPx, zIndex: 2, kind: 'region' },
            { from: gapPx, to: segOldPx, zIndex: 1, kind: 'silent-gap' },
        ];
    }

    function captureCanvasStrip(sourceCanvas, leftCss, topCss, widthCss, heightCss) {
        if (!sourceCanvas || !(widthCss > 0) || !(heightCss > 0)) return null;
        const clientW = Math.max(1, sourceCanvas.clientWidth);
        const clientH = Math.max(1, sourceCanvas.clientHeight);
        const scaleX = sourceCanvas.width / clientW;
        const scaleY = sourceCanvas.height / clientH;
        const sx = Math.max(0, Math.floor(leftCss * scaleX));
        const sy = Math.max(0, Math.floor(topCss * scaleY));
        const sw = Math.max(1, Math.min(sourceCanvas.width - sx, Math.ceil(widthCss * scaleX)));
        const sh = Math.max(
            1,
            Math.min(sourceCanvas.height - sy, Math.ceil(heightCss * scaleY)),
        );
        const off = document.createElement('canvas');
        off.width = sw;
        off.height = sh;
        const ctx = off.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
        return off;
    }

    function isMusicalGridRehearsalFillVisibleSafe() {
        if (typeof getMusicalGridRehearsalFillVisible === 'function') {
            return getMusicalGridRehearsalFillVisible();
        }
        if (typeof window.getMusicalGridRehearsalFillVisible === 'function') {
            return window.getMusicalGridRehearsalFillVisible();
        }
        return false;
    }

    function resolveMusicalGridCanvasEl() {
        if (typeof audioWaveformMusicalGrid !== 'undefined' && audioWaveformMusicalGrid) {
            return audioWaveformMusicalGrid;
        }
        return document.getElementById('audioWaveformMusicalGrid');
    }

    function resolveRehearsalFillCanvasEl() {
        if (typeof audioWaveformRehearsalFill !== 'undefined' && audioWaveformRehearsalFill) {
            return audioWaveformRehearsalFill;
        }
        return document.getElementById('audioWaveformRehearsalFill');
    }

    function trackTopInLanesInnerCss(trackEl) {
        const inner =
            typeof audioWaveformLanesInner !== 'undefined' ? audioWaveformLanesInner : null;
        if (!inner || !trackEl) return 0;
        const trackRect = trackEl.getBoundingClientRect();
        const innerRect = inner.getBoundingClientRect();
        return trackRect.top - innerRect.top;
    }

    function isMusicalGridVisibleSafe() {
        if (typeof getMusicalGridVisible === 'function') {
            return getMusicalGridVisible();
        }
        if (typeof window.getMusicalGridVisible === 'function') {
            return window.getMusicalGridVisible();
        }
        return false;
    }

    /** Rehearsal / Tempo / Signature / Measure — transport-swap アニメ用 */
    function getMusicalSwapTrackSpecs() {
        const ids = [
            ['musicalRehearsalTrack', 'musicalRehearsalGridCanvas'],
            ['musicalTempoTrack', 'musicalTempoGridCanvas'],
            ['musicalSignatureTrack', 'musicalSignatureGridCanvas'],
            ['musicalMeasureTrack', 'musicalMeasureGridCanvas'],
        ];
        const out = [];
        for (let i = 0; i < ids.length; i++) {
            const trackEl = document.getElementById(ids[i][0]);
            if (!trackEl) return null;
            out.push({
                trackEl,
                gridCanvas: document.getElementById(ids[i][1]),
            });
        }
        return out;
    }

    function musicalSwapTracksTotalHeightCss(specs) {
        let h = 0;
        for (let i = 0; i < specs.length; i++) {
            h += Math.max(1, specs[i].trackEl.clientHeight | 0);
        }
        return Math.max(1, h);
    }

    function musicalTrackStripBackgroundCss(trackEl) {
        const bgEl = trackEl && trackEl.querySelector('.audio-waveform-lane__track-bg');
        if (!bgEl || typeof window.getComputedStyle !== 'function') return '#161820';
        const style = window.getComputedStyle(bgEl);
        const c = style.backgroundColor;
        return c && c !== 'rgba(0, 0, 0, 0)' ? c : '#161820';
    }

    function paintMusicalTrackSegmentsOnStrip(ctx, trackEl, leftCss, widthCss, hCss, scaleX, scaleY) {
        if (!ctx || !trackEl) return;
        const trackRect = trackEl.getBoundingClientRect();
        const stripRight = leftCss + widthCss;
        const segments = trackEl.querySelectorAll('.musical-track-lane__segment');
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const r = seg.getBoundingClientRect();
            const segLeft = r.left - trackRect.left;
            const segRight = segLeft + r.width;
            if (segRight <= leftCss + 0.5 || segLeft >= stripRight - 0.5) continue;
            const valueEl = seg.querySelector('.musical-track-lane__segment-value');
            const textEl = valueEl || seg;
            const text = (textEl.textContent || '').trim();
            if (!text) continue;
            const style = window.getComputedStyle(textEl);
            const fontSize = parseFloat(style.fontSize) || 10;
            const weight = style.fontWeight || '600';
            const family = style.fontFamily || 'sans-serif';
            ctx.font = weight + ' ' + fontSize + 'px ' + family;
            ctx.fillStyle = style.color || '#e8ecf4';
            ctx.textBaseline = 'middle';
            const pad = 4;
            const textX = (Math.max(segLeft, leftCss) - leftCss + pad) * scaleX;
            ctx.fillText(text, textX, (hCss * 0.5) * scaleY);
        }
    }

    function captureMusicalTrackStrip(trackEl, gridCanvas, leftCss, widthCss) {
        const hCss = Math.max(1, trackEl.clientHeight | 0);
        if (!(widthCss > 0)) return null;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const sw = Math.max(1, Math.ceil(widthCss * dpr));
        const sh = Math.max(1, Math.ceil(hCss * dpr));
        const off = document.createElement('canvas');
        off.width = sw;
        off.height = sh;
        const ctx = off.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = musicalTrackStripBackgroundCss(trackEl);
        ctx.fillRect(0, 0, sw, sh);
        if (gridCanvas && gridCanvas.width > 0 && gridCanvas.height > 0) {
            const gridStrip = captureCanvasStrip(gridCanvas, leftCss, 0, widthCss, hCss);
            if (gridStrip) {
                ctx.drawImage(gridStrip, 0, 0, sw, sh);
            }
        }
        paintMusicalTrackSegmentsOnStrip(ctx, trackEl, leftCss, widthCss, hCss, dpr, dpr);
        return off;
    }

    /** Musical 4 トラックを縦1枚に合成（region swap moves と同じ水平範囲） */
    function captureMusicalTracksSwapStrip(leftCss, widthCss) {
        const specs = getMusicalSwapTrackSpecs();
        if (!specs) return null;
        const strips = [];
        let totalHCss = 0;
        for (let i = 0; i < specs.length; i++) {
            const spec = specs[i];
            const hCss = Math.max(1, spec.trackEl.clientHeight | 0);
            const strip = captureMusicalTrackStrip(spec.trackEl, spec.gridCanvas, leftCss, widthCss);
            if (!strip) return null;
            strips.push({ strip, hCss });
            totalHCss += hCss;
        }
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const totalW = Math.max(1, Math.ceil(widthCss * dpr));
        const totalH = Math.max(1, Math.ceil(totalHCss * dpr));
        const off = document.createElement('canvas');
        off.width = totalW;
        off.height = totalH;
        const ctx = off.getContext('2d');
        if (!ctx) return null;
        let y = 0;
        for (let i = 0; i < strips.length; i++) {
            const sh = Math.max(1, Math.ceil(strips[i].hCss * dpr));
            ctx.drawImage(strips[i].strip, 0, y, totalW, sh);
            y += sh;
        }
        return off;
    }

    function syncMusicalTracksSwapLayerPlacement(lanesInner, layer) {
        if (!lanesInner || !layer) return;
        if (typeof window.syncWaveformLanesViewportWidthCss === 'function') {
            window.syncWaveformLanesViewportWidthCss();
        }
        if (layer.parentElement !== lanesInner) {
            lanesInner.appendChild(layer);
        }
        const laneCount =
            typeof window.getMusicalTrackLaneCount === 'function'
                ? window.getMusicalTrackLaneCount() | 0
                : specsLengthFromDom();
        layer.style.gridRow = laneCount > 0 ? '1 / ' + (laneCount + 1) : '1 / 5';
        layer.style.gridColumn = '1';
    }

    function specsLengthFromDom() {
        const specs = getMusicalSwapTrackSpecs();
        return specs ? specs.length : 4;
    }

    function removeMusicalTracksSwapLayer(layer) {
        if (!layer) return;
        const anims = layer.querySelectorAll('.audio-waveform-lane__region-swap-anim');
        for (let i = 0; i < anims.length; i++) {
            releaseRegionSwapGhostMotionBlur(anims[i]);
        }
        if (layer.parentNode) layer.remove();
    }

    function collectMusicalTracksSwapMoves(moves, gapSwap) {
        if (gapSwap || !moves || !moves.length) return [];
        const out = [];
        for (let i = 0; i < moves.length; i++) {
            if (moves[i].kind === 'silent-gap') continue;
            out.push(moves[i]);
        }
        return filterVisibleRegionSwapMoves(out);
    }

    /** 波形ストリップ + Rehearsal 着色 + 拍線グリッドを合成キャプチャ */
    function captureRegionSwapStrip(waveCanvas, trackEl, leftCss, widthCss, heightCss) {
        const wave = captureCanvasStrip(waveCanvas, leftCss, 0, widthCss, heightCss);
        if (!wave) return null;
        if (!isMusicalGridRehearsalFillVisibleSafe()) return wave;

        const laneTopCss = trackTopInLanesInnerCss(trackEl);
        const ctx = wave.getContext('2d');
        if (!ctx) return wave;

        const rehearsalFill = resolveRehearsalFillCanvasEl();
        if (rehearsalFill && rehearsalFill.width > 0 && rehearsalFill.height > 0) {
            const fillStrip = captureCanvasStrip(
                rehearsalFill,
                leftCss,
                laneTopCss,
                widthCss,
                heightCss,
            );
            if (fillStrip) ctx.drawImage(fillStrip, 0, 0);
        }

        const gridCanvas = resolveMusicalGridCanvasEl();
        if (gridCanvas && gridCanvas.width > 0 && gridCanvas.height > 0) {
            const grid = captureCanvasStrip(gridCanvas, leftCss, laneTopCss, widthCss, heightCss);
            if (grid) ctx.drawImage(grid, 0, 0);
        }
        return wave;
    }

    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function easeInOutCubicDerivative(t) {
        const x = Math.max(0, Math.min(1, t));
        if (x < 0.5) return 12 * x * x;
        const u = 1 - x;
        return 6 * u * u;
    }

    function ensureRegionSwapMotionBlurSvg() {
        if (regionSwapMotionBlurDefs) return regionSwapMotionBlurDefs;
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.style.position = 'absolute';
        svg.style.overflow = 'hidden';
        const defs = document.createElementNS(NS, 'defs');
        svg.appendChild(defs);
        document.body.appendChild(svg);
        regionSwapMotionBlurSvg = svg;
        regionSwapMotionBlurDefs = defs;
        return defs;
    }

    function createRegionSwapGhostMotionBlurFilter() {
        const NS = 'http://www.w3.org/2000/svg';
        const defs = ensureRegionSwapMotionBlurSvg();
        const id = 'region-swap-hblur-' + ++regionSwapMotionBlurFilterSeq;
        const filter = document.createElementNS(NS, 'filter');
        filter.setAttribute('id', id);
        filter.setAttribute('x', '-30%');
        filter.setAttribute('y', '-10%');
        filter.setAttribute('width', '160%');
        filter.setAttribute('height', '120%');
        filter.setAttribute('color-interpolation-filters', 'sRGB');
        const blur = document.createElementNS(NS, 'feGaussianBlur');
        blur.setAttribute('in', 'SourceGraphic');
        blur.setAttribute('stdDeviation', '0 0');
        filter.appendChild(blur);
        defs.appendChild(filter);
        return { id: id, blurEl: blur, filterEl: filter };
    }

    function regionSwapMotionBlurStdX(progress, from, to) {
        const dist = Math.abs((to.left || 0) - (from.left || 0));
        if (!(dist > 0.5)) return 0;
        const speed = easeInOutCubicDerivative(progress) * dist;
        return Math.min(REGION_SWAP_MOTION_BLUR_MAX, speed * REGION_SWAP_MOTION_BLUR_GAIN);
    }

    function releaseRegionSwapGhostMotionBlur(ghostEl) {
        if (!ghostEl) return;
        ghostEl.style.filter = 'none';
        const filterEl = ghostEl._motionBlurFilter;
        if (filterEl && filterEl.parentNode) filterEl.remove();
        ghostEl._motionBlurFilter = null;
    }

    function removePlaybackRegionSwapLayer(layer) {
        if (!layer) return;
        const anims = layer.querySelectorAll('.audio-waveform-lane__region-swap-anim');
        for (let i = 0; i < anims.length; i++) {
            releaseRegionSwapGhostMotionBlur(anims[i]);
        }
        if (layer.parentNode) layer.remove();
    }

    function scheduleMusicalGridRedrawAfterRegionSwapAnim() {
        if (typeof window.scheduleMusicalGridRedraw === 'function') {
            window.scheduleMusicalGridRedraw();
        }
    }

    function waveformLanesInnerEl() {
        return typeof audioWaveformLanesInner !== 'undefined' ? audioWaveformLanesInner : null;
    }

    function hideRegionSwapWaveformGridOverlaysAfterCapture() {
        if (typeof window.clearRegionSwapWaveformGridOverlays === 'function') {
            window.clearRegionSwapWaveformGridOverlays();
        }
    }

    function setRegionSwapCompositeActive(active) {
        const inner = waveformLanesInnerEl();
        if (!inner) return;
        if (active) {
            inner.classList.add('audio-waveform-composite--region-swap-active');
        } else {
            inner.classList.remove('audio-waveform-composite--region-swap-active');
        }
    }

    function refreshRegionRehearsalMarksAfterSwap() {
        if (typeof window.refreshAllRegionMusicalMetaPresentation === 'function') {
            window.refreshAllRegionMusicalMetaPresentation();
        } else if (typeof window.refreshAllRegionRehearsalMarkLabels === 'function') {
            window.refreshAllRegionRehearsalMarkLabels();
        }
    }

    function regionSwapRevealFadeAllowed() {
        if (typeof window.matchMedia !== 'function') return true;
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        return !mq || !mq.matches;
    }

    function clearRegionSwapRevealFadeClasses(lane, lanesInner) {
        if (lane) {
            lane.classList.remove(
                'audio-waveform-lane--region-swap-reveal',
                'audio-waveform-lane--region-swap-reveal--active',
            );
        }
        if (lanesInner) {
            lanesInner.classList.remove(
                'audio-waveform-composite--region-swap-reveal',
                'audio-waveform-composite--region-swap-reveal--active',
            );
        }
    }

    function startRegionSwapRevealFade(lane, trackEl, swapLayer, musicalSwapLayer) {
        playbackRegionSwapAnimActive = false;
        playbackRegionSwapAnimPending = false;
        scheduleMusicalGridRedrawAfterRegionSwapAnim();
        refreshRegionRehearsalMarksAfterSwap();

        if (trackEl) trackEl.classList.remove('audio-waveform-lane--region-swap-active');
        if (lane) lane.classList.remove('audio-waveform-lane--region-swap-active');
        setRegionSwapCompositeActive(false);

        const lanesInner = waveformLanesInnerEl();
        clearRegionSwapRevealFadeClasses(lane, lanesInner);
        const crossfadeLayers = [swapLayer, musicalSwapLayer];
        for (let ci = 0; ci < crossfadeLayers.length; ci++) {
            const el = crossfadeLayers[ci];
            if (!el) continue;
            el.classList.remove(
                'audio-waveform-lane__region-swap-layer--crossfade-out',
                'audio-waveform-lane__region-swap-layer--crossfade-out--active',
            );
            el.classList.add('audio-waveform-lane__region-swap-layer--crossfade-out');
        }
        if (lane) lane.classList.add('audio-waveform-lane--region-swap-reveal');
        if (lanesInner) lanesInner.classList.add('audio-waveform-composite--region-swap-reveal');
        if (lane) void lane.offsetHeight;
        if (swapLayer) void swapLayer.offsetHeight;
        if (musicalSwapLayer) void musicalSwapLayer.offsetHeight;

        requestAnimationFrame(() => {
            if (lane) lane.classList.add('audio-waveform-lane--region-swap-reveal--active');
            if (lanesInner) lanesInner.classList.add('audio-waveform-composite--region-swap-reveal--active');
            for (let ci = 0; ci < crossfadeLayers.length; ci++) {
                const el = crossfadeLayers[ci];
                if (el) el.classList.add('audio-waveform-lane__region-swap-layer--crossfade-out--active');
            }
            setTimeout(() => {
                if (swapLayer) removePlaybackRegionSwapLayer(swapLayer);
                if (musicalSwapLayer) removeMusicalTracksSwapLayer(musicalSwapLayer);
                clearRegionSwapRevealFadeClasses(lane, lanesInner);
            }, REGION_SWAP_REVEAL_FADE_MS + 48);
        });
    }

    function revealPlaybackRegionSwapLane(trackEl, lane, slot, redrawOpt, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const track = { type: 'extra', slot };
        if (!o.skipRedraw) {
            if (typeof updateTrackRegionOverlays === 'function') {
                updateTrackRegionOverlays(track);
            }
            if (typeof redrawAfterRegionChange === 'function') {
                redrawAfterRegionChange(slot, redrawOpt || { invalidatePeakCache: true });
            }
        }
        if (o.fadeIn && lane && regionSwapRevealFadeAllowed()) {
            startRegionSwapRevealFade(
                lane,
                trackEl,
                o.swapLayer || null,
                o.musicalSwapLayer || null,
            );
            return;
        }
        if (trackEl) trackEl.classList.remove('audio-waveform-lane--region-swap-active');
        if (lane) lane.classList.remove('audio-waveform-lane--region-swap-active');
        setRegionSwapCompositeActive(false);
        playbackRegionSwapAnimActive = false;
        playbackRegionSwapAnimPending = false;
        scheduleMusicalGridRedrawAfterRegionSwapAnim();
        refreshRegionRehearsalMarksAfterSwap();
    }

    function endPlaybackRegionSwapAnimation(trackEl, layer, lane, slot, redrawOpt, opt) {
        removePlaybackRegionSwapLayer(layer);
        revealPlaybackRegionSwapLane(trackEl, lane, slot, redrawOpt, opt);
    }

    function buildRegionSwapGhost(item, hCss) {
        const ghost = document.createElement('div');
        ghost.className = 'audio-waveform-lane__region-swap-anim';
        if (item.move.kind === 'silent-gap') {
            ghost.classList.add('audio-waveform-lane__region-swap-anim--silent-gap');
        } else if (!item.bitmap) {
            ghost.classList.add('audio-waveform-lane__region-swap-anim--no-capture');
        }
        ghost.style.left = item.move.from.left + 'px';
        ghost.style.width = item.move.from.width + 'px';
        ghost.style.height = hCss + 'px';
        ghost.style.transformOrigin = 'left center';
        ghost.style.transform = 'translate3d(0, 0, 0) scaleX(1)';
        if (item.move.zIndex > 0) {
            ghost.style.zIndex = String(item.move.zIndex);
        }
        const motionBlur = createRegionSwapGhostMotionBlurFilter();
        ghost._motionBlurFilter = motionBlur.filterEl;
        if (item.bitmap) {
            const snap = document.createElement('canvas');
            snap.width = item.bitmap.width;
            snap.height = item.bitmap.height;
            const snapCtx = snap.getContext('2d');
            if (!snapCtx) return null;
            snapCtx.drawImage(item.bitmap, 0, 0);
            ghost.appendChild(snap);
        }
        return {
            el: ghost,
            from: item.move.from,
            to: item.move.to,
            motionBlur: motionBlur,
        };
    }

    function paintPlaybackRegionSwapGhosts(ghosts, progress) {
        const t = Math.max(0, Math.min(1, progress));
        const e = easeInOutCubic(t);
        for (let i = 0; i < ghosts.length; i++) {
            const g = ghosts[i];
            const from = g.from;
            const to = g.to;
            const dx = (to.left - from.left) * e;
            const width = from.width + (to.width - from.width) * e;
            const scaleX = from.width > 0 ? width / from.width : 1;
            g.el.style.transform = 'translate3d(' + dx + 'px, 0, 0) scaleX(' + scaleX + ')';
            if (g.motionBlur) {
                const blurX = regionSwapMotionBlurStdX(t, from, to);
                if (blurX > 0.2) {
                    g.motionBlur.blurEl.setAttribute('stdDeviation', blurX.toFixed(2) + ' 0');
                    g.el.style.filter = 'url(#' + g.motionBlur.id + ')';
                } else {
                    g.el.style.filter = 'none';
                }
            }
        }
    }

    function animatePlaybackRegionSwapGhosts(
        ghosts,
        trackEl,
        layer,
        lane,
        slot,
        redrawOpt,
        onComplete,
        animStartMs,
        musicalGhosts,
    ) {
        const t0 = Number.isFinite(animStartMs) ? animStartMs : performance.now();
        let finished = false;
        paintPlaybackRegionSwapGhosts(ghosts, 0);
        if (musicalGhosts && musicalGhosts.length) {
            paintPlaybackRegionSwapGhosts(musicalGhosts, 0);
        }

        function finish(elapsedMs) {
            if (finished) return;
            finished = true;
            paintPlaybackRegionSwapGhosts(ghosts, 1);
            if (musicalGhosts && musicalGhosts.length) {
                paintPlaybackRegionSwapGhosts(musicalGhosts, 1);
            }
            if (typeof onComplete === 'function') {
                onComplete(elapsedMs);
            } else {
                endPlaybackRegionSwapAnimation(trackEl, layer, lane, slot, redrawOpt);
            }
        }

        function frame(now) {
            if (finished) return;
            const elapsed = now - t0;
            const progress = Math.min(1, elapsed / REGION_SWAP_ANIM_MS);
            paintPlaybackRegionSwapGhosts(ghosts, progress);
            if (musicalGhosts && musicalGhosts.length) {
                paintPlaybackRegionSwapGhosts(musicalGhosts, progress);
            }
            if (progress >= 1) {
                finish(elapsed);
                return;
            }
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
        setTimeout(() => finish(REGION_SWAP_ANIM_MS), REGION_SWAP_ANIM_MS + 64);
    }

    function regionSwapAnimReject(reason, extra) {
        if (typeof window.regionSwapDiagLog === 'function') {
            window.regionSwapDiagLog('swap/animation/rejected', { reason, ...(extra || {}) });
        }
        return false;
    }

    function playPlaybackRegionSwapAnimation(spec) {
        if (!spec || typeof spec.applySwap !== 'function') {
            return regionSwapAnimReject('missing spec or applySwap');
        }
        if (playbackRegionSwapAnimActive || playbackRegionSwapAnimPending) {
            return regionSwapAnimReject('animation already active');
        }
        if (typeof window.matchMedia === 'function') {
            const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
            if (mq && mq.matches) {
                return regionSwapAnimReject('prefers-reduced-motion');
            }
        }

        const track = spec.track;
        const previewSegments = spec.previewSegments;
        const redrawOpt = spec.redrawOpt;
        const applySwap = spec.applySwap;
        const finalizeSwap = spec.finalizeSwap;
        const swapLo = spec.swapLo | 0;
        const swapHi = spec.swapHi | 0;
        const normalizedPair = normalizeRegionSwapSegmentPair(swapLo, swapHi);
        const contentOnlySwap = !!spec.contentOnlySwap;
        const forceTimelineSwap = !!spec.forceTimelineSwap;
        const oldOverlayIntervals = spec.oldOverlayIntervals;
        const gapSwap = spec.gap && (spec.segmentIndices?.length || Number.isFinite(spec.segmentIndex));
        if (!track || !isExtraTrackRef(track)) {
            return regionSwapAnimReject('invalid track');
        }
        const slot = track.slot;

        const moves = filterVisibleRegionSwapMoves(
            gapSwap
                ? collectSilentGapSegmentSwapMoves(
                      track,
                      spec.gap,
                      spec.segmentIndex | 0,
                      spec.swapPlan,
                      spec.segmentIndices,
                  )
                : collectPlaybackRegionSwapMoves(
                      track,
                      previewSegments,
                      normalizedPair.lo,
                      normalizedPair.hi,
                      {
                          contentOnlySwap,
                          forceTimelineSwap,
                          includeSlideMoves: !!spec.includeSlideMoves,
                          oldOverlayIntervals,
                          swapUnitSegmentIndicesA: spec.swapUnitSegmentIndicesA,
                          swapUnitSegmentIndicesB: spec.swapUnitSegmentIndicesB,
                      },
                  ),
        );
        if (moves.length < 2) {
            return regionSwapAnimReject('insufficient moves', { moveCount: moves.length });
        }
        if (!swapMovesHaveVisibleDisplacement(moves)) {
            return regionSwapAnimReject('moves have no visible displacement', {
                moveCount: moves.length,
            });
        }

        const ui = typeof getExtraUi === 'function' ? getExtraUi(slot) : null;
        if (!ui || !ui.canvas || !ui.track) {
            return regionSwapAnimReject('extra ui missing', { slot });
        }
        const hCss = Math.max(1, ui.track.clientHeight | 0);

        const lane = document.getElementById('extraAudioLane' + slot);
        const trackEl = ui.track;
        if (!lane || !trackEl) {
            return regionSwapAnimReject('lane or track element missing', { slot });
        }

        const layer = document.createElement('div');
        layer.className = 'audio-waveform-lane__region-swap-layer';
        layer.setAttribute('aria-hidden', 'true');

        const enableMusicalTrackSwapAnim =
            spec.enableMusicalTrackSwapAnim !== false && isMusicalGridVisibleSafe();
        let musicalLayer = null;

        function schedulePersistAfterSwapCommit() {
            if (typeof window.schedulePersistExtraTrackLayout === 'function') {
                window.schedulePersistExtraTrackLayout();
            } else if (typeof window.schedulePersistExtraTrackSlot === 'function') {
                window.schedulePersistExtraTrackSlot(slot);
            }
            if (typeof window.schedulePersistSession === 'function') {
                window.schedulePersistSession();
            }
        }

        function runPostSwapHeavyWork(applyOk, swapLayer, musicalSwapLayer, onRedrawDone) {
            const trackRef = { type: 'extra', slot };
            const historyRestore = !!spec.historyRestore;
            const runPersist = () => {
                if (!applyOk) return;
                if (typeof window.flushPersistSessionNow === 'function') {
                    void window.flushPersistSessionNow().catch((persistErr) => {
                        if (typeof writeLog === 'function') {
                            writeLog(
                                'Session: swap persist could not complete — ' +
                                    (persistErr && persistErr.message
                                        ? persistErr.message
                                        : String(persistErr)),
                            );
                        }
                        schedulePersistAfterSwapCommit();
                    });
                } else {
                    schedulePersistAfterSwapCommit();
                }
            };
            const runRedraw = () => {
                if (applyOk && typeof finalizeSwap === 'function') finalizeSwap();
                if (typeof schedulePersistSession === 'function') {
                    schedulePersistSession();
                }
                revealPlaybackRegionSwapLane(trackEl, lane, slot, redrawOpt, {
                    skipRedraw: !historyRestore,
                    fadeIn: true,
                    swapLayer: swapLayer || null,
                    musicalSwapLayer: musicalSwapLayer || null,
                });
                if (!historyRestore) {
                    refreshRegionRehearsalMarksAfterSwap();
                }
                if (typeof window.refreshRehearsalTrack === 'function') {
                    window.refreshRehearsalTrack();
                }
                if (typeof onRedrawDone === 'function') onRedrawDone();
                if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback(runPersist, { timeout: 1200 });
                } else {
                    setTimeout(runPersist, 0);
                }
            };
            requestAnimationFrame(() => {
                requestAnimationFrame(runRedraw);
            });
        }

        function finishSwapAfterAnimation(elapsedMs) {
            let applyOk = false;
            try {
                applyOk = applySwap({
                    deferRedraw: true,
                    skipPersist: true,
                    skipSyncTransport: true,
                });
            } catch (applyErr) {
                if (typeof window.regionSwapDiagLog === 'function') {
                    window.regionSwapDiagLog('swap/animation/apply-error', {
                        message:
                            applyErr && applyErr.message
                                ? applyErr.message
                                : String(applyErr),
                    });
                }
            }
            if (!applyOk) {
                removePlaybackRegionSwapLayer(layer);
                if (musicalLayer) removeMusicalTracksSwapLayer(musicalLayer);
                revealPlaybackRegionSwapLane(trackEl, lane, slot, redrawOpt, { skipRedraw: false });
                playbackRegionSwapAnimPending = false;
            } else {
                runPostSwapHeavyWork(applyOk, layer, musicalLayer);
            }
            if (typeof window.regionSwapDiagLog === 'function') {
                window.regionSwapDiagLog('swap/animation/done', {
                    elapsedMs: Math.round(elapsedMs || 0),
                    targetMs: REGION_SWAP_ANIM_MS,
                });
            }
        }

        function recoverSwapWithoutAnimation(reason) {
            playbackRegionSwapAnimPending = false;
            playbackRegionSwapAnimActive = false;
            scheduleMusicalGridRedrawAfterRegionSwapAnim();
            removePlaybackRegionSwapLayer(layer);
            if (musicalLayer) removeMusicalTracksSwapLayer(musicalLayer);
            if (trackEl) trackEl.classList.remove('audio-waveform-lane--region-swap-active');
            if (lane) lane.classList.remove('audio-waveform-lane--region-swap-active');
            setRegionSwapCompositeActive(false);
            if (typeof window.regionSwapDiagLog === 'function') {
                window.regionSwapDiagLog('swap/animation/recovered', { reason: reason || 'unknown' });
            }
            const trackRef = { type: 'extra', slot };
            try {
                applySwap({ deferRedraw: false });
                if (typeof syncRegionSwapVisualPresentation === 'function') {
                    syncRegionSwapVisualPresentation(trackRef);
                }
                if (typeof finalizeSwap === 'function') finalizeSwap();
                return 'applied-recovered';
            } catch (recoverErr) {
                if (typeof window.regionSwapDiagLog === 'function') {
                    window.regionSwapDiagLog('swap/animation/recover-error', {
                        message:
                            recoverErr && recoverErr.message
                                ? recoverErr.message
                                : String(recoverErr),
                    });
                }
            }
            return false;
        }

        function captureSwapAnimationSnapshots() {
            const snapshots = [];
            let captureMiss = 0;
            for (let i = 0; i < moves.length; i++) {
                const move = moves[i];
                let bitmap = null;
                if (move.kind !== 'silent-gap') {
                    bitmap = captureRegionSwapStrip(
                        ui.canvas,
                        trackEl,
                        move.from.left,
                        move.from.width,
                        hCss,
                    );
                    if (!bitmap) captureMiss++;
                }
                snapshots.push({ move, bitmap: bitmap || null });
            }

            let musicalPrepared = { ok: true, snapshots: [], captureMiss: 0, skipped: true };
            if (enableMusicalTrackSwapAnim) {
                musicalPrepared = captureMusicalTracksSwapSnapshots(moves, gapSwap);
                if (!musicalPrepared.ok) {
                    return {
                        ok: false,
                        reason: musicalPrepared.reason || 'musical capture incomplete',
                        index: musicalPrepared.index,
                    };
                }
            }

            return {
                ok: true,
                snapshots,
                captureMiss,
                musicalSnapshots: musicalPrepared.snapshots || [],
                musicalCaptureMiss: musicalPrepared.captureMiss | 0,
                musicalSkipped: !!musicalPrepared.skipped,
            };
        }

        function captureMusicalTracksSwapSnapshots(moves, gapSwap) {
            if (!isMusicalGridVisibleSafe()) {
                return { ok: true, snapshots: [], captureMiss: 0, skipped: true };
            }
            const musicalMoves = collectMusicalTracksSwapMoves(moves, gapSwap);
            if (musicalMoves.length < 2 || !swapMovesHaveVisibleDisplacement(musicalMoves)) {
                return { ok: true, snapshots: [], captureMiss: 0, skipped: true };
            }
            const specs = getMusicalSwapTrackSpecs();
            if (!specs) {
                return { ok: true, snapshots: [], captureMiss: 0, skipped: true };
            }
            const snapshots = [];
            let captureMiss = 0;
            for (let i = 0; i < musicalMoves.length; i++) {
                const move = musicalMoves[i];
                const bitmap = captureMusicalTracksSwapStrip(move.from.left, move.from.width);
                if (!bitmap) captureMiss++;
                snapshots.push({ move, bitmap: bitmap || null });
            }
            return { ok: true, snapshots, captureMiss, skipped: false };
        }

        function assembleSwapAnimationGhosts(captured) {
            layer.replaceChildren();
            const ghosts = [];
            for (let i = 0; i < captured.snapshots.length; i++) {
                const built = buildRegionSwapGhost(captured.snapshots[i], hCss);
                if (!built) {
                    return { ok: false, reason: 'ghost build incomplete', index: i };
                }
                layer.appendChild(built.el);
                ghosts.push(built);
            }

            const musicalGhosts = [];
            if (captured.musicalSnapshots && captured.musicalSnapshots.length) {
                const specs = getMusicalSwapTrackSpecs();
                const totalH = specs ? musicalSwapTracksTotalHeightCss(specs) : hCss;
                for (let i = 0; i < captured.musicalSnapshots.length; i++) {
                    const built = buildRegionSwapGhost(captured.musicalSnapshots[i], totalH);
                    if (!built) {
                        return {
                            ok: false,
                            reason: 'musical ghost build incomplete',
                            index: i,
                        };
                    }
                    musicalGhosts.push(built);
                }
            }

            return {
                ok: true,
                ghosts,
                captureMiss: captured.captureMiss | 0,
                musicalGhosts,
                musicalCaptureMiss: captured.musicalCaptureMiss | 0,
                musicalSkipped: !!captured.musicalSkipped,
            };
        }

        function beginSwapAnimationPlayback(prepared) {
            const ghosts = prepared.ghosts;
            const captureMiss = prepared.captureMiss | 0;
            const musicalGhosts = prepared.musicalGhosts || [];
            const musicalCaptureMiss = prepared.musicalCaptureMiss | 0;
            try {
                layer.classList.add('audio-waveform-lane__region-swap-layer--lanes-overlay');
                if (typeof window.syncLaneOverlayGridPlacement === 'function') {
                    window.syncLaneOverlayGridPlacement(lane, layer);
                } else {
                    trackEl.appendChild(layer);
                }

                if (musicalGhosts.length) {
                    musicalLayer = document.createElement('div');
                    musicalLayer.className =
                        'audio-waveform-lane__region-swap-layer audio-waveform-lane__region-swap-layer--musical-tracks';
                    musicalLayer.setAttribute('aria-hidden', 'true');
                    musicalLayer.classList.add('audio-waveform-lane__region-swap-layer--lanes-overlay');
                    const lanesInner = waveformLanesInnerEl();
                    syncMusicalTracksSwapLayerPlacement(lanesInner, musicalLayer);
                    for (let mi = 0; mi < musicalGhosts.length; mi++) {
                        musicalLayer.appendChild(musicalGhosts[mi].el);
                    }
                }

                void layer.offsetHeight;
                if (musicalLayer) void musicalLayer.offsetHeight;

                paintPlaybackRegionSwapGhosts(ghosts, 0);
                if (musicalGhosts.length) {
                    paintPlaybackRegionSwapGhosts(musicalGhosts, 0);
                }

                const animStartMs = performance.now();
                playbackRegionSwapAnimActive = true;
                hideRegionSwapWaveformGridOverlaysAfterCapture();
                setRegionSwapCompositeActive(true);
                trackEl.classList.add('audio-waveform-lane--region-swap-active');
                lane.classList.add('audio-waveform-lane--region-swap-active');
                if (captureMiss > 0 && typeof window.regionSwapDiagLog === 'function') {
                    window.regionSwapDiagLog('swap/animation/fallback', {
                        captureMiss,
                        moveCount: moves.length,
                    });
                }
                if (
                    musicalCaptureMiss > 0 &&
                    typeof window.regionSwapDiagLog === 'function'
                ) {
                    window.regionSwapDiagLog('swap/animation/musical-fallback', {
                        captureMiss: musicalCaptureMiss,
                        moveCount: musicalGhosts.length,
                    });
                }
                if (typeof window.regionSwapDiagLog === 'function') {
                    window.regionSwapDiagLog('swap/animation/start', {
                        targetMs: REGION_SWAP_ANIM_MS,
                        moveCount: moves.length,
                        musicalMoveCount: musicalGhosts.length,
                        musicalSkipped: !!prepared.musicalSkipped,
                    });
                }
                animatePlaybackRegionSwapGhosts(
                    ghosts,
                    trackEl,
                    layer,
                    lane,
                    slot,
                    redrawOpt,
                    finishSwapAfterAnimation,
                    animStartMs,
                    musicalGhosts,
                );
            } catch (err) {
                playbackRegionSwapAnimActive = false;
                playbackRegionSwapAnimPending = false;
                scheduleMusicalGridRedrawAfterRegionSwapAnim();
                setRegionSwapCompositeActive(false);
                if (trackEl) trackEl.classList.remove('audio-waveform-lane--region-swap-active');
                if (lane) lane.classList.remove('audio-waveform-lane--region-swap-active');
                removePlaybackRegionSwapLayer(layer);
                if (musicalLayer) removeMusicalTracksSwapLayer(musicalLayer);
                if (typeof window.regionSwapDiagLog === 'function') {
                    window.regionSwapDiagLog('swap/animation/error', {
                        message: err && err.message ? err.message : String(err),
                    });
                }
                throw err;
            }
        }

        let captured;
        try {
            captured = captureSwapAnimationSnapshots();
        } catch (captureErr) {
            if (typeof window.regionSwapDiagLog === 'function') {
                window.regionSwapDiagLog('swap/animation/capture-error', {
                    message:
                        captureErr && captureErr.message
                            ? captureErr.message
                            : String(captureErr),
                });
            }
            return regionSwapAnimReject('capture failed');
        }
        if (!captured || !captured.ok) {
            return regionSwapAnimReject(captured && captured.reason ? captured.reason : 'capture incomplete');
        }

        playbackRegionSwapAnimPending = true;
        try {
            requestAnimationFrame(() => {
                let prepared;
                try {
                    prepared = assembleSwapAnimationGhosts(captured);
                } catch (assembleErr) {
                    recoverSwapWithoutAnimation(
                        assembleErr && assembleErr.message
                            ? assembleErr.message
                            : String(assembleErr),
                    );
                    return;
                }
                if (!prepared.ok) {
                    recoverSwapWithoutAnimation(prepared.reason);
                    return;
                }
                requestAnimationFrame(() => {
                    try {
                        beginSwapAnimationPlayback(prepared);
                    } catch (err) {
                        recoverSwapWithoutAnimation(
                            err && err.message ? err.message : String(err),
                        );
                    }
                });
            });
            return 'started';
        } catch (err) {
            playbackRegionSwapAnimPending = false;
            scheduleMusicalGridRedrawAfterRegionSwapAnim();
            return regionSwapAnimReject('animation setup incomplete');
        }
    }

    function isPlaybackRegionSwapAnimActive() {
        return playbackRegionSwapAnimActive || playbackRegionSwapAnimPending;
    }

    /** 背景の Rehearsal 着色・小節線オーバーレイを抑止（キャプチャ後 active のみ） */
    function isPlaybackRegionSwapRehearsalFillSuppressed() {
        return playbackRegionSwapAnimActive;
    }

    window.playPlaybackRegionSwapAnimation = playPlaybackRegionSwapAnimation;
    window.syncRegionSwapVisualPresentation = syncRegionSwapVisualPresentation;
    window.isPlaybackRegionSwapAnimActive = isPlaybackRegionSwapAnimActive;
    window.isPlaybackRegionSwapRehearsalFillSuppressed = isPlaybackRegionSwapRehearsalFillSuppressed;
