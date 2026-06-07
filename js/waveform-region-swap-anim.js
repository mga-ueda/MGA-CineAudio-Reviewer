/**
 * waveform-region-swap-anim.js — リージョン入れ替えアニメーション
 */
    const REGION_SWAP_ANIM_MS = 500;
    let playbackRegionSwapAnimActive = false;
    let playbackRegionSwapAnimPending = false;

    function normalizeRegionSwapSegmentPair(swapLo, swapHi) {
        const a = swapLo | 0;
        const b = swapHi | 0;
        return a <= b ? { lo: a, hi: b } : { lo: b, hi: a };
    }

    function swapMovesHaveVisibleDisplacement(moves) {
        if (!moves || !moves.length) return false;
        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            if (!m || !m.from || !m.to) continue;
            if (
                Math.abs(m.from.left - m.to.left) > 0.5 ||
                Math.abs(m.from.width - m.to.width) > 0.5
            ) {
                return true;
            }
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
        const left = transportSecToOverlayPx(interval.start, metrics, master);
        const right = transportSecToOverlayPx(interval.end, metrics, master);
        return {
            left: Number.isFinite(left) ? left : 0,
            width: Math.max(1, (Number.isFinite(right) ? right : 0) - left),
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
        return [
            { from: leftPx, to: rightPx, zIndex: 1, kind: 'content-cross' },
            { from: rightPx, to: leftPx, zIndex: 2, kind: 'content-cross' },
        ];
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

        /** 選択2つ: 旧位置 → 入れ替え先（timeline 時は preview 先頭） */
        const moves = [
            { from: leftPx, to: loToPx, zIndex: 1, kind: 'region' },
            { from: rightPx, to: hiToPx, zIndex: 2, kind: 'region' },
        ];

        /** 間に挟まれたリージョンなど、位置だけずれるものはスライド */
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

    function captureLaneCanvasStrip(sourceCanvas, leftCss, widthCss, heightCss) {
        if (!sourceCanvas || !(widthCss > 0) || !(heightCss > 0)) return null;
        const clientW = Math.max(1, sourceCanvas.clientWidth);
        const clientH = Math.max(1, sourceCanvas.clientHeight);
        const scaleX = sourceCanvas.width / clientW;
        const scaleY = sourceCanvas.height / clientH;
        const sx = Math.max(0, Math.floor(leftCss * scaleX));
        const sw = Math.max(1, Math.min(sourceCanvas.width - sx, Math.ceil(widthCss * scaleX)));
        const sh = Math.max(1, Math.min(sourceCanvas.height, Math.ceil(heightCss * scaleY)));
        const off = document.createElement('canvas');
        off.width = sw;
        off.height = sh;
        const ctx = off.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(sourceCanvas, sx, 0, sw, sh, 0, 0, sw, sh);
        return off;
    }

    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function removePlaybackRegionSwapLayer(layer) {
        if (layer && layer.parentNode) layer.remove();
    }

    function revealPlaybackRegionSwapLane(trackEl, lane, slot, redrawOpt, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (trackEl) trackEl.classList.remove('audio-waveform-lane--region-swap-active');
        if (lane) lane.classList.remove('audio-waveform-lane--region-swap-active');
        playbackRegionSwapAnimActive = false;
        playbackRegionSwapAnimPending = false;
        if (o.skipRedraw) return;
        const track = { type: 'extra', slot };
        if (typeof updateTrackRegionOverlays === 'function') {
            updateTrackRegionOverlays(track);
        }
        if (typeof redrawAfterRegionChange === 'function') {
            redrawAfterRegionChange(slot, redrawOpt || { invalidatePeakCache: true });
        }
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
        if (item.bitmap) {
            const snap = document.createElement('canvas');
            snap.width = item.bitmap.width;
            snap.height = item.bitmap.height;
            const snapCtx = snap.getContext('2d');
            if (!snapCtx) return null;
            snapCtx.drawImage(item.bitmap, 0, 0);
            ghost.appendChild(snap);
        }
        return { el: ghost, from: item.move.from, to: item.move.to };
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
    ) {
        const t0 = Number.isFinite(animStartMs) ? animStartMs : performance.now();
        let finished = false;
        paintPlaybackRegionSwapGhosts(ghosts, 0);

        function finish(elapsedMs) {
            if (finished) return;
            finished = true;
            paintPlaybackRegionSwapGhosts(ghosts, 1);
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

        const moves = gapSwap
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
                      oldOverlayIntervals,
                      swapUnitSegmentIndicesA: spec.swapUnitSegmentIndicesA,
                      swapUnitSegmentIndicesB: spec.swapUnitSegmentIndicesB,
                  },
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

        function runPostSwapHeavyWork(applyOk, onRedrawDone) {
            const trackRef = { type: 'extra', slot };
            const runPersist = () => {
                if (!applyOk) return;
                if (typeof finalizeSwap === 'function') finalizeSwap();
                if (typeof window.flushPersistSessionNow === 'function') {
                    void window.flushPersistSessionNow().catch((persistErr) => {
                        if (typeof writeLog === 'function') {
                            writeLog(
                                'Session: swap persist failed — ' +
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
                if (applyOk && typeof updateTrackRegionOverlays === 'function') {
                    updateTrackRegionOverlays(trackRef);
                }
                if (typeof redrawAfterRegionChange === 'function') {
                    redrawAfterRegionChange(slot, redrawOpt || { invalidatePeakCache: true });
                }
                if (applyOk && typeof syncExtraAudioToTransport === 'function') {
                    syncExtraAudioToTransport({ force: true });
                }
                if (typeof schedulePersistSession === 'function') {
                    schedulePersistSession();
                }
                revealPlaybackRegionSwapLane(trackEl, lane, slot, redrawOpt, {
                    skipRedraw: true,
                });
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
            removePlaybackRegionSwapLayer(layer);
            if (!applyOk) {
                revealPlaybackRegionSwapLane(trackEl, lane, slot, redrawOpt, { skipRedraw: false });
                playbackRegionSwapAnimPending = false;
            } else {
                runPostSwapHeavyWork(applyOk);
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
            removePlaybackRegionSwapLayer(layer);
            if (trackEl) trackEl.classList.remove('audio-waveform-lane--region-swap-active');
            if (lane) lane.classList.remove('audio-waveform-lane--region-swap-active');
            if (typeof window.regionSwapDiagLog === 'function') {
                window.regionSwapDiagLog('swap/animation/recovered', { reason: reason || 'unknown' });
            }
            try {
                if (applySwap({ deferRedraw: false })) {
                    if (typeof finalizeSwap === 'function') finalizeSwap();
                    return 'applied-recovered';
                }
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

        function buildSwapAnimationGhosts() {
            const snapshots = [];
            let captureMiss = 0;
            for (let i = 0; i < moves.length; i++) {
                const move = moves[i];
                let bitmap = null;
                if (move.kind !== 'silent-gap') {
                    bitmap = captureLaneCanvasStrip(
                        ui.canvas,
                        move.from.left,
                        move.from.width,
                        hCss,
                    );
                    if (!bitmap) captureMiss++;
                }
                snapshots.push({ move, bitmap: bitmap || null });
            }
            layer.replaceChildren();
            const ghosts = [];
            for (let i = 0; i < snapshots.length; i++) {
                const built = buildRegionSwapGhost(snapshots[i], hCss);
                if (!built) return { ok: false, reason: 'ghost build failed', index: i };
                layer.appendChild(built.el);
                ghosts.push(built);
            }
            return { ok: true, ghosts, captureMiss };
        }

        function beginSwapAnimationPlayback(prepared) {
            const ghosts = prepared.ghosts;
            const captureMiss = prepared.captureMiss | 0;
            try {
                trackEl.appendChild(layer);
                void layer.offsetHeight;
                const animStartMs = performance.now();
                playbackRegionSwapAnimActive = true;
                trackEl.classList.add('audio-waveform-lane--region-swap-active');
                lane.classList.add('audio-waveform-lane--region-swap-active');
                if (captureMiss > 0 && typeof window.regionSwapDiagLog === 'function') {
                    window.regionSwapDiagLog('swap/animation/fallback', {
                        captureMiss,
                        moveCount: moves.length,
                    });
                }
                if (typeof window.regionSwapDiagLog === 'function') {
                    window.regionSwapDiagLog('swap/animation/start', {
                        targetMs: REGION_SWAP_ANIM_MS,
                        moveCount: moves.length,
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
                );
            } catch (err) {
                playbackRegionSwapAnimActive = false;
                playbackRegionSwapAnimPending = false;
                if (trackEl) trackEl.classList.remove('audio-waveform-lane--region-swap-active');
                if (lane) lane.classList.remove('audio-waveform-lane--region-swap-active');
                removePlaybackRegionSwapLayer(layer);
                if (typeof window.regionSwapDiagLog === 'function') {
                    window.regionSwapDiagLog('swap/animation/error', {
                        message: err && err.message ? err.message : String(err),
                    });
                }
                throw err;
            }
        }

        playbackRegionSwapAnimPending = true;
        try {
            requestAnimationFrame(() => {
                const prepared = buildSwapAnimationGhosts();
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
            return regionSwapAnimReject('animation setup failed');
        }
    }

    function isPlaybackRegionSwapAnimActive() {
        return playbackRegionSwapAnimActive || playbackRegionSwapAnimPending;
    }

    window.playPlaybackRegionSwapAnimation = playPlaybackRegionSwapAnimation;
    window.isPlaybackRegionSwapAnimActive = isPlaybackRegionSwapAnimActive;
