/**
 * region-snap-diag.js — Region parallel-move snap diagnostics (F10 panel)
 * Verdict semantics: MAGNET_HELD = drag-time magnet only; COMMITTED = drop with no commit snap.
 */
(function regionSnapDiagModule() {
    const LOG_PREFIX = '[RegionSnap] ';
    let lastDragLogKey = '';
    let lastDragLogAt = 0;
    const DRAG_LOG_MIN_MS = 250;

    function enabled() {
        return (
            typeof window.isDebugLogCategoryEnabled === 'function' &&
            window.isDebugLogCategoryEnabled('REGION_SNAP')
        );
    }

    function roundSec(v) {
        return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : v;
    }

    function fmtTc(sec) {
        if (!Number.isFinite(sec)) return null;
        if (typeof formatTimecodeForTransport === 'function') {
            return formatTimecodeForTransport(sec);
        }
        return sec.toFixed(4) + 's';
    }

    function log(stage, detail) {
        if (!enabled()) return;
        if (typeof writeDiagLog === 'function') {
            writeDiagLog('REGION_SNAP', stage, detail);
            return;
        }
        if (typeof writeLog !== 'function') return;
        let tail = '';
        if (detail != null) {
            try {
                tail = ' | ' + JSON.stringify(detail);
            } catch (_) {
                tail = ' | ' + String(detail);
            }
        }
        writeLog(LOG_PREFIX + stage + tail);
    }

    function summarizeCandidates(snapDetail) {
        if (!snapDetail || !snapDetail.candidates || !snapDetail.candidates.length) {
            return null;
        }
        const rows = [];
        for (let i = 0; i < snapDetail.candidates.length; i++) {
            const c = snapDetail.candidates[i];
            rows.push({
                stopTc: fmtTc(c.stopSec),
                dHead: c.dHeadSec,
                dTail: c.dTailSec,
                headTh: c.headThSec,
                adjGap: c.adjGapSec,
                headReject: c.headReject,
                tailReject: c.tailReject,
            });
        }
        return rows;
    }

    function resolvePhase(opt) {
        if (opt && opt.phase) return opt.phase;
        return opt && opt.geometryOnly ? 'drag' : 'commit';
    }

    function shouldEmitDragSnapLog(track, segmentIndex, snapDetail, phase) {
        if (phase !== 'drag') return true;
        if (!snapDetail) return false;
        const edge = snapDetail.edge;
        if (!edge || edge === 'none' || edge === 'skip' || edge === 'alt') {
            return false;
        }
        const pointerRaw = snapDetail.pointerSec;
        const snapped = snapDetail.snappedSec;
        const frameEps =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        const magnetEps = Math.max(frameEps * 0.75, 0.02);
        if (
            Number.isFinite(pointerRaw) &&
            Number.isFinite(snapped) &&
            Math.abs(snapped - pointerRaw) < magnetEps
        ) {
            return false;
        }
        const key =
            (track.slot | 0) +
            ':' +
            (segmentIndex | 0) +
            ':' +
            String(snapDetail.stopSec) +
            ':' +
            String(snapDetail.snappedSec);
        const now = performance.now();
        if (key === lastDragLogKey && now - lastDragLogAt < DRAG_LOG_MIN_MS) {
            return false;
        }
        lastDragLogKey = key;
        lastDragLogAt = now;
        return true;
    }

    function collectMasterContext() {
        const freezeSec =
            typeof getRegionOffsetDragMasterFreezeSec === 'function'
                ? getRegionOffsetDragMasterFreezeSec()
                : null;
        const liveSec =
            typeof computeLiveMasterTransportDurationSec === 'function'
                ? computeLiveMasterTransportDurationSec()
                : null;
        const displaySec =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : null;
        return {
            displayMasterSec: roundSec(displaySec),
            liveMasterSec: roundSec(liveSec),
            freezeMasterSec: roundSec(freezeSec),
            freezeActiveAtLog: Number.isFinite(freezeSec) && freezeSec > 0,
        };
    }

    function estimateNearestDistPx(nearestDistSec, masterSec, scrubW) {
        if (
            !Number.isFinite(nearestDistSec) ||
            !Number.isFinite(masterSec) ||
            !(masterSec > 0) ||
            !Number.isFinite(scrubW) ||
            !(scrubW > 0)
        ) {
            return null;
        }
        return roundSec((nearestDistSec / masterSec) * scrubW);
    }

    function computeSnapVerdict(snapDetail, opt, headBefore, headAfter, proposedHead) {
        const frameEps =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        const matchEps = frameEps * 1.5;
        const magnetEps = Math.max(frameEps * 0.75, 0.02);
        const phase = opt && opt.phase ? opt.phase : 'commit';

        if (phase === 'commit') {
            const movedSec =
                Number.isFinite(headBefore) && Number.isFinite(headAfter)
                    ? headAfter - headBefore
                    : null;
            const movedStr =
                movedSec != null && Math.abs(movedSec) >= magnetEps
                    ? ', moved ' + movedSec.toFixed(3) + 's vs before drop'
                    : '';
            return {
                snapApplied: false,
                verdict: 'COMMITTED',
                summary:
                    'Dropped at ' +
                    fmtTc(headAfter) +
                    movedStr +
                    ' — commit does not snap (magnet is drag-only)',
            };
        }

        if (opt && opt.skipSnap) {
            return {
                snapApplied: false,
                verdict: 'DRAG_FREE',
                summary: 'Dragging without snap evaluation',
            };
        }

        const edge = snapDetail ? snapDetail.edge : null;
        const stopSec = snapDetail && snapDetail.stopSec;
        const snappedSec = snapDetail && snapDetail.snappedSec;
        const nearestDistPx =
            snapDetail && Number.isFinite(snapDetail.nearestDistPx)
                ? snapDetail.nearestDistPx
                : null;
        const pixelThresholdSec =
            snapDetail && Number.isFinite(snapDetail.pixelThresholdSec)
                ? snapDetail.pixelThresholdSec
                : null;

        if (edge === 'alt') {
            return {
                snapApplied: false,
                verdict: 'ALT_HELD',
                summary: 'Alt held — magnet disabled',
            };
        }

        const pointerRawSec =
            snapDetail && Number.isFinite(snapDetail.pointerSec)
                ? snapDetail.pointerSec
                : proposedHead;
        const magnetCorrectionSec =
            Number.isFinite(pointerRawSec) && Number.isFinite(snappedSec)
                ? snappedSec - pointerRawSec
                : null;
        const headAfterApply =
            Number.isFinite(headAfter) ? headAfter : snappedSec;

        if (edge === 'in' || edge === 'out') {
            const matchedStop =
                Number.isFinite(headAfterApply) &&
                Number.isFinite(stopSec) &&
                Math.abs(headAfterApply - stopSec) <= matchEps;
            const meaningfulMagnet =
                magnetCorrectionSec != null && Math.abs(magnetCorrectionSec) >= magnetEps;

            if (matchedStop && meaningfulMagnet) {
                return {
                    snapApplied: true,
                    verdict: 'MAGNET_HELD',
                    summary:
                        'Magnet holding at ' +
                        fmtTc(stopSec) +
                        ' during drag (pointer offset ' +
                        magnetCorrectionSec.toFixed(3) +
                        's)',
                    snapCorrectionSec: roundSec(magnetCorrectionSec),
                };
            }
            return {
                snapApplied: false,
                verdict: 'DRAGGING',
                summary: 'Dragging — near boundary but magnet not engaged',
            };
        }

        const distStr =
            nearestDistPx != null
                ? nearestDistPx.toFixed(1) + 'px'
                : snapDetail && Number.isFinite(snapDetail.nearestDistSec)
                  ? snapDetail.nearestDistSec.toFixed(2) + 's'
                  : '?';
        const thStr =
            pixelThresholdSec != null ? pixelThresholdSec + 'px' : '?';
        return {
            snapApplied: false,
            verdict: 'DRAGGING',
            summary:
                'Dragging — no magnet (nearest boundary ' +
                distStr +
                ', threshold ' +
                thStr +
                ')',
        };
    }

    /** ドラッグ中（edge 変化時）および確定時 */
    function regionSnapDiagLogMoveCommit(track, segmentIndex, proposedHeadSec, snapDetail, opt) {
        if (!enabled()) return;
        if (!track || !Number.isFinite(segmentIndex)) return;

        const phase = resolvePhase(opt);
        if (!shouldEmitDragSnapLog(track, segmentIndex, snapDetail, phase)) {
            return;
        }

        const headBefore =
            opt && Number.isFinite(opt.headBeforeApply)
                ? opt.headBeforeApply
                : snapDetail && Number.isFinite(snapDetail.currentHeadSec)
                  ? snapDetail.currentHeadSec
                  : null;
        const headAfter =
            opt && Number.isFinite(opt.headAfterApply)
                ? opt.headAfterApply
                : typeof getSegmentRegionTimelineIn === 'function'
                  ? getSegmentRegionTimelineIn(track, segmentIndex)
                  : null;

        const proposedHead =
            snapDetail && Number.isFinite(snapDetail.proposedHeadSec)
                ? snapDetail.proposedHeadSec
                : Number.isFinite(proposedHeadSec)
                  ? proposedHeadSec
                  : null;
        const proposedTail =
            snapDetail && Number.isFinite(snapDetail.proposedTailSec)
                ? snapDetail.proposedTailSec
                : null;
        const baseHead =
            snapDetail && Number.isFinite(snapDetail.baseHeadSec)
                ? snapDetail.baseHeadSec
                : null;
        const baseTail =
            snapDetail && Number.isFinite(snapDetail.baseTailSec)
                ? snapDetail.baseTailSec
                : null;
        const frameSec =
            snapDetail && Number.isFinite(snapDetail.frameSec)
                ? snapDetail.frameSec
                : proposedHead;
        const snappedSec =
            snapDetail && Number.isFinite(snapDetail.snappedSec)
                ? snapDetail.snappedSec
                : null;
        const nearestStop =
            snapDetail && Number.isFinite(snapDetail.nearestStopSec)
                ? snapDetail.nearestStopSec
                : null;
        const nearestDist =
            snapDetail && Number.isFinite(snapDetail.nearestDistSec)
                ? snapDetail.nearestDistSec
                : null;
        const nearestDistPx =
            snapDetail && Number.isFinite(snapDetail.nearestDistPx)
                ? snapDetail.nearestDistPx
                : null;
        const thresholdSec =
            snapDetail && Number.isFinite(snapDetail.thresholdSec)
                ? snapDetail.thresholdSec
                : null;
        const pixelThresholdSec =
            snapDetail && Number.isFinite(snapDetail.pixelThresholdSec)
                ? snapDetail.pixelThresholdSec
                : null;

        const clientX =
            opt && Number.isFinite(opt.snapDiagClientX) ? opt.snapDiagClientX : null;
        const pointerCrossCheck =
            clientX != null &&
            typeof window.regionSnapDiagCollectDragPointerContext === 'function'
                ? window.regionSnapDiagCollectDragPointerContext(clientX)
                : null;

        const masterCtx = collectMasterContext();
        const scrubWForPx =
            snapDetail && Number.isFinite(snapDetail.snapScrubW) && snapDetail.snapScrubW > 0
                ? snapDetail.snapScrubW
                : pointerCrossCheck && Number.isFinite(pointerCrossCheck.scrubWNow)
                  ? pointerCrossCheck.scrubWNow
                  : pointerCrossCheck && Number.isFinite(pointerCrossCheck.startScrubW)
                    ? pointerCrossCheck.startScrubW
                    : null;
        const masterForPx =
            snapDetail && Number.isFinite(snapDetail.snapMasterSec) && snapDetail.snapMasterSec > 0
                ? snapDetail.snapMasterSec
                : masterCtx.displayMasterSec;

        const verdictInfo = computeSnapVerdict(
            snapDetail,
            opt,
            headBefore,
            headAfter,
            proposedHead,
        );

        const appliedMoveSec =
            Number.isFinite(headBefore) && Number.isFinite(headAfter)
                ? headAfter - headBefore
                : null;
        const pointerToAppliedSec =
            Number.isFinite(proposedHead) && Number.isFinite(headAfter)
                ? headAfter - proposedHead
                : null;

        log('move/' + phase, {
            verdict: verdictInfo.verdict,
            snapApplied: verdictInfo.snapApplied,
            summary: verdictInfo.summary,
            ex: (track.slot | 0) + 1,
            region: (segmentIndex | 0) + 1,
            phase,
            skipSnap: !!(opt && opt.skipSnap),
            headBeforeTc: fmtTc(headBefore),
            headAfterTc: fmtTc(headAfter),
            headBeforeSec: roundSec(headBefore),
            headAfterSec: roundSec(headAfter),
            appliedMoveSec: roundSec(appliedMoveSec),
            pointerToAppliedSec: roundSec(pointerToAppliedSec),
            baseHeadTc: fmtTc(baseHead),
            baseTailTc: fmtTc(baseTail),
            pointerTc: fmtTc(proposedHead),
            tailTc: fmtTc(proposedTail),
            snappedHeadTc: fmtTc(snappedSec),
            pointerSec: roundSec(proposedHead),
            tailSec: roundSec(proposedTail),
            baseHeadSec: roundSec(baseHead),
            baseTailSec: roundSec(baseTail),
            snappedHeadSec: roundSec(snappedSec),
            frameSec: roundSec(frameSec),
            edge: snapDetail ? snapDetail.edge : null,
            stopTc:
                snapDetail && Number.isFinite(snapDetail.stopSec)
                    ? fmtTc(snapDetail.stopSec)
                    : null,
            stopSec:
                snapDetail && Number.isFinite(snapDetail.stopSec)
                    ? roundSec(snapDetail.stopSec)
                    : null,
            nearestStopTc: fmtTc(nearestStop),
            nearestDistSec: roundSec(nearestDist),
            nearestDistPx:
                nearestDistPx != null
                    ? nearestDistPx
                    : estimateNearestDistPx(nearestDist, masterForPx, scrubWForPx),
            nearestEdge: snapDetail ? snapDetail.nearestEdge : null,
            thresholdSec: roundSec(thresholdSec),
            pixelThresholdSec: pixelThresholdSec,
            snapScrubW: snapDetail ? snapDetail.snapScrubW : null,
            dragDeltaSec:
                snapDetail && Number.isFinite(snapDetail.dragDeltaSec)
                    ? roundSec(snapDetail.dragDeltaSec)
                    : null,
            instantDeltaSec:
                snapDetail && Number.isFinite(snapDetail.instantDeltaSec)
                    ? roundSec(snapDetail.instantDeltaSec)
                    : null,
            frameDeltaSec:
                snapDetail && Number.isFinite(snapDetail.frameDeltaSec)
                    ? roundSec(snapDetail.frameDeltaSec)
                    : null,
            stickyHeadSec:
                snapDetail && Number.isFinite(snapDetail.stickyHeadSec)
                    ? roundSec(snapDetail.stickyHeadSec)
                    : null,
            directionDeltaSec:
                snapDetail && Number.isFinite(snapDetail.directionDeltaSec)
                    ? roundSec(snapDetail.directionDeltaSec)
                    : null,
            currentHeadSec:
                snapDetail && Number.isFinite(snapDetail.currentHeadSec)
                    ? roundSec(snapDetail.currentHeadSec)
                    : null,
            appliedDeltaSec:
                snapDetail && Number.isFinite(snapDetail.appliedDeltaSec)
                    ? roundSec(snapDetail.appliedDeltaSec)
                    : null,
            master: masterCtx,
            masterScaleDriftSec:
                Number.isFinite(masterCtx.liveMasterSec) &&
                Number.isFinite(masterCtx.displayMasterSec)
                    ? roundSec(masterCtx.liveMasterSec - masterCtx.displayMasterSec)
                    : null,
            pointerCrossCheck,
            stopCount: snapDetail ? snapDetail.stopCount : null,
            snappedFromPointer:
                Number.isFinite(snappedSec) && Number.isFinite(proposedHead)
                    ? roundSec(snappedSec - proposedHead)
                    : null,
            candidates: summarizeCandidates(snapDetail),
        });
    }

    window.regionSnapDiagLogMoveCommit = regionSnapDiagLogMoveCommit;
})();
