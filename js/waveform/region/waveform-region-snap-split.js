/**
 * waveform-region-snap-split.js — スナップ・分割・ハンドル判定
 */
    function transportBoundaryEpsilonSec() {
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        return Math.max(1e-6, step * 0.5);
    }

    /** 分割禁止マージン（最短リージョン長と同じ。クランプで無音片ができるのを防ぐ） */
    function playbackRegionSplitForbiddenMarginSec() {
        return PLAYBACK_REGION_MIN_SEC;
    }

    function isNearPlaybackRegionUncuttableTransport(track, transportSec, marginSec) {
        const segments = getTrackSegments(track);
        if (!segments.length) return false;
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return true;
        const margin = Math.max(
            playbackRegionSplitForbiddenMarginSec(),
            Number(marginSec) || 0,
        );
        const eps = transportBoundaryEpsilonSec();
        for (let i = 0; i < segments.length; i++) {
            const regionIn = getSegmentRegionTimelineIn(track, i);
            const segEnd = getSegmentTimelineEnd(track, i);
            if (Math.abs(regionIn - t) <= margin + eps) return true;
            if (Math.abs(segEnd - t) <= margin + eps) return true;
            if (i < segments.length - 1) {
                const nextAnchor = getSegmentTimelineStart(track, i + 1);
                if (Math.abs(nextAnchor - t) <= margin + eps) return true;
            }
        }
        const t0 = getTrackTimelineStartSec(track);
        const trackEnd = getTrackTimelineEndSec(track);
        if (Math.abs(t0 - t) <= margin + eps) return true;
        if (Math.abs(trackEnd - t) <= margin + eps) return true;
        return false;
    }

    function isSourceSecAtExistingSegmentBoundary(track, sourceSec) {
        const segments = getTrackSegments(track);
        if (!segments.length) return false;
        const s = Number(sourceSec);
        if (!Number.isFinite(s)) return true;
        const eps = Math.max(1e-5, PLAYBACK_REGION_MIN_SEC * 0.05);
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (Math.abs(seg.sourceInSec - s) <= eps) return true;
            if (Math.abs(seg.sourceOutSec - s) <= eps) return true;
        }
        return false;
    }

    function resolvePlaybackRegionSplitPlacement(track, transportSec) {
        if (!isExtraTrackRef(track)) return null;
        const splitTransport = clampRegionEditTransportSec(track, transportSec);
        if (
            isNearPlaybackRegionUncuttableTransport(
                track,
                splitTransport,
                playbackRegionSplitForbiddenMarginSec(),
            )
        ) {
            return null;
        }
        const hit = mapTransportToSegment(track, splitTransport);
        if (!hit) return null;

        const segments = getTrackSegments(track);
        const splitIndex = hit.segmentIndex;
        const seg = segments[splitIndex];
        if (!seg) return null;
        const fullDur = getSegmentSourceDurationSec(track, seg);
        if (!fullDur) return null;

        const clipId = hit.clipId || getSegmentClipId(track, splitIndex);
        const sourceSplit = segmentSourceSecFromTransport(
            track,
            splitIndex,
            splitTransport,
        );
        const minSplit = seg.sourceInSec + PLAYBACK_REGION_MIN_SEC;
        const maxSplit = seg.sourceOutSec - PLAYBACK_REGION_MIN_SEC;
        if (!(maxSplit > minSplit)) return null;

        const eps = transportBoundaryEpsilonSec();
        if (sourceSplit < minSplit - eps || sourceSplit > maxSplit + eps) {
            return null;
        }
        if (isSourceSecAtExistingSegmentBoundary(track, sourceSplit)) {
            return null;
        }

        const margin = playbackRegionSplitForbiddenMarginSec();
        const regionIn = getSegmentRegionTimelineIn(track, splitIndex);
        const segEnd = getSegmentTimelineEnd(track, splitIndex);
        const playStart = getSegmentPlaybackTimelineStart(track, splitIndex);
        if (splitTransport - regionIn < margin - eps) return null;
        if (segEnd - splitTransport < margin - eps) return null;
        if (splitTransport - playStart < margin - eps) return null;

        return {
            splitTransport,
            splitIndex,
            sourceSplit,
            clipId,
            seg,
        };
    }

    function isPlaybackRegionSplitForbiddenAtTransport(track, transportSec) {
        return !resolvePlaybackRegionSplitPlacement(track, transportSec);
    }
    /** Tempo/Sig または Phrase 着色 ON 時 — リージョン本体（平行移動）ドラッグを禁止 */
    function isPlaybackRegionOffsetDragForbidden() {
        if (
            typeof getMusicalGridVisible === 'function' &&
            getMusicalGridVisible()
        ) {
            return true;
        }
        if (
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible()
        ) {
            return true;
        }
        return false;
    }
    window.isPlaybackRegionSplitForbiddenAtTransport =
        isPlaybackRegionSplitForbiddenAtTransport;
    window.isPlaybackRegionOffsetDragForbidden = isPlaybackRegionOffsetDragForbidden;
    window.isPlaybackRegionDragForbidden = isPlaybackRegionOffsetDragForbidden;

    function splitPlaybackRegionAtTransportSec(track, transportSec, opt) {
        if (!isExtraTrackRef(track)) return false;
        const placement = resolvePlaybackRegionSplitPlacement(track, transportSec);
        if (!placement) return false;

        const { splitIndex, sourceSplit, clipId, seg } = placement;
        let segments = getTrackSegments(track);

        const leftStart = getSegmentTimelineStart(track, splitIndex);
        const leftSourceDur = sourceSplit - seg.sourceInSec;
        const splitTimelineSec = leftStart + leftSourceDur;
        const left = {
            id: newRegionId(),
            clipId: seg.clipId || clipId,
            sourceInSec: seg.sourceInSec,
            sourceOutSec: sourceSplit,
            timelineStartSec: leftStart,
        };
        const right = {
            id: newRegionId(),
            clipId: seg.clipId || clipId,
            sourceInSec: sourceSplit,
            sourceOutSec: seg.sourceOutSec,
            timelineStartSec: splitTimelineSec,
        };
        if (Number.isFinite(seg.gainDb) && Math.abs(seg.gainDb) > 0.0005) {
            left.gainDb = seg.gainDb;
            right.gainDb = seg.gainDb;
        }
        if (Number.isFinite(seg.pitchSemitones) && seg.pitchSemitones !== 0) {
            left.pitchSemitones = seg.pitchSemitones;
            right.pitchSemitones = seg.pitchSemitones;
        }
        if (Number.isFinite(seg.fadeInSec) && seg.fadeInSec > 0.0005) {
            left.fadeInSec = seg.fadeInSec;
        }
        if (Number.isFinite(seg.fadeOutSec) && seg.fadeOutSec > 0.0005) {
            right.fadeOutSec = seg.fadeOutSec;
        }
        const next = segments.slice();
        next.splice(splitIndex, 1, left, right);
        const ok = !!setTrackSegments(track, next, {
            silent: true,
            skipUndo: !!(opt && opt.skipUndo),
            affectedSegmentIndices: [splitIndex, splitIndex + 1],
        });
        if (ok && typeof schedulePersistExtraTrackSlot === 'function') {
            schedulePersistExtraTrackSlot(track.slot);
        }
        if (
            ok &&
            !(opt && opt.skipPersistFlush) &&
            typeof flushPersistSessionNow === 'function'
        ) {
            void flushPersistSessionNow().catch(() => {});
        }
        return ok;
    }

    function adjustSegmentGainDbForTargets(targets, deltaDb) {
        const step = Number(deltaDb);
        if (!targets || !targets.length) return false;
        if (!Number.isFinite(step) || Math.abs(step) < 0.0005) return false;

        if (!regionUndoPaused) requestRegionUndoCapture();
        let anyChanged = false;
        let lastSlot = -1;
        let lastSeg = -1;
        let lastLabel = '';
        for (let i = 0; i < targets.length; i++) {
            const { slot, segmentIndex } = targets[i];
            const track = { type: 'extra', slot };
            if (!isTrackRegionActive(track)) continue;
            const next = clampRegionGainDb(
                getSegmentGainDb(track, segmentIndex) + step,
            );
            if (
                setSegmentGainDb(track, segmentIndex, next, {
                    skipPersist: true,
                    skipUndo: true,
                    skipVolumeBoundaryJoin: true,
                })
            ) {
                anyChanged = true;
                lastSlot = slot;
                lastSeg = segmentIndex;
                lastLabel = formatRegionGainDbDisplay(next);
            }
        }
        if (!anyChanged) return false;

        if (typeof schedulePersistSession === 'function') schedulePersistSession();

        if (targets.length === 1) {
            const gainMsg =
                formatRegionRef(lastSlot, lastSeg) + ' gain → ' + (lastLabel || '0.0 dB');
            if (typeof logRegionAction === 'function') {
                logRegionAction(gainMsg);
            } else {
                writeLog(
                    'Ex ' +
                        (lastSlot + 1) +
                        ' region ' +
                        (lastSeg + 1) +
                        ' gain: ' +
                        (lastLabel || '0.0 dB'),
                );
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint(
                    'Ex ' + (lastSlot + 1) + ' R' + (lastSeg + 1),
                    lastLabel || '0.0 dB',
                    'notice',
                );
            }
        } else {
            const stepLabel =
                (step > 0 ? '+' : '') + step.toFixed(0) + ' dB';
            const refs = targets
                .slice(0, 4)
                .map((t) => formatRegionRef(t.slot, t.segmentIndex))
                .join(', ');
            const gainMsg =
                'gain ' +
                stepLabel +
                ' on ' +
                targets.length +
                ' region(s)' +
                (refs ? ' (' + refs + (targets.length > 4 ? ', …' : '') + ')' : '');
            if (typeof logRegionAction === 'function') {
                logRegionAction(gainMsg);
            } else {
                writeLog(
                    'Playback region gain ' +
                        stepLabel +
                        ' (' +
                        targets.length +
                        ' regions)',
                );
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', stepLabel + ' × ' + targets.length, 'notice');
            }
        }
        return true;
    }

    function adjustSegmentPitchSemitonesForTargets(targets, deltaSemitones) {
        const step = Math.round(Number(deltaSemitones));
        if (!targets || !targets.length) return false;
        if (!Number.isFinite(step) || step === 0) return false;

        if (!regionUndoPaused) requestRegionUndoCapture();
        let anyChanged = false;
        let lastSlot = -1;
        let lastSeg = -1;
        let lastLabel = '';
        for (let i = 0; i < targets.length; i++) {
            const { slot, segmentIndex } = targets[i];
            const track = { type: 'extra', slot };
            if (!isTrackRegionActive(track)) continue;
            const next = clampRegionPitchSemitones(
                getSegmentPitchSemitones(track, segmentIndex) + step,
            );
            if (
                setSegmentPitchSemitones(track, segmentIndex, next, {
                    skipPersist: true,
                    skipUndo: true,
                })
            ) {
                anyChanged = true;
                lastSlot = slot;
                lastSeg = segmentIndex;
                lastLabel = formatRegionPitchDisplay(next);
            }
        }
        if (!anyChanged) return false;

        if (typeof schedulePersistSession === 'function') schedulePersistSession();

        for (let i = 0; i < targets.length; i++) {
            const { slot, segmentIndex } = targets[i];
            if (typeof schedulePitchSliceRenderForSegment === 'function') {
                schedulePitchSliceRenderForSegment({ type: 'extra', slot }, segmentIndex);
            }
        }

        if (targets.length === 1) {
            const keyMsg =
                formatRegionRef(lastSlot, lastSeg) + ' key → ' + (lastLabel || 'Key 0');
            if (typeof logRegionAction === 'function') {
                logRegionAction(keyMsg);
            } else {
                writeLog(
                    'Ex ' +
                        (lastSlot + 1) +
                        ' region ' +
                        (lastSeg + 1) +
                        ' key: ' +
                        (lastLabel || 'Key 0'),
                );
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint(
                    'Ex ' + (lastSlot + 1) + ' R' + (lastSeg + 1),
                    lastLabel || 'Key 0',
                    'notice',
                );
            }
        } else {
            const stepLabel = (step > 0 ? '+' : '') + step;
            const refs = targets
                .slice(0, 4)
                .map((t) => formatRegionRef(t.slot, t.segmentIndex))
                .join(', ');
            const keyMsg =
                'key ' +
                stepLabel +
                ' on ' +
                targets.length +
                ' region(s)' +
                (refs ? ' (' + refs + (targets.length > 4 ? ', …' : '') + ')' : '');
            if (typeof logRegionAction === 'function') {
                logRegionAction(keyMsg);
            } else {
                writeLog(
                    'Playback region key ' +
                        stepLabel +
                        ' (' +
                        targets.length +
                        ' regions)',
                );
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'Key ' + stepLabel + ' × ' + targets.length, 'notice');
            }
        }
        return true;
    }

    function handlePlaybackRegionPitchWheel(ev) {
        if (!ev || !ev.altKey || !ev.shiftKey || ev.ctrlKey || ev.metaKey) {
            return false;
        }
        if (
            typeof getMusicalGridPhraseFillVisible !== 'function' ||
            !getMusicalGridPhraseFillVisible()
        ) {
            return false;
        }
        const lanes =
            typeof getWaveformLanesEl === 'function' ? getWaveformLanesEl() : null;
        if (!lanes) return false;
        let over = false;
        if (typeof ev.composedPath === 'function') {
            over = ev.composedPath().includes(lanes);
        } else if (ev.target) {
            over = lanes.contains(ev.target);
        }
        if (!over) return false;
        const delta = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;
        if (!delta) return false;
        const deltaPitch = delta > 0 ? -1 : 1;

        const selectionTargets = expandRegionSegmentEditTargetsFromSelection();
        if (!selectionTargets.length) {
            return false;
        }

        adjustSegmentPitchSemitonesForTargets(selectionTargets, deltaPitch);
        ev.preventDefault();
        return true;
    }

    function handlePlaybackRegionGainWheel(ev) {
        if (!ev || !ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) {
            return false;
        }
        const lanes =
            typeof getWaveformLanesEl === 'function' ? getWaveformLanesEl() : null;
        if (!lanes) return false;
        let over = false;
        if (typeof ev.composedPath === 'function') {
            over = ev.composedPath().includes(lanes);
        } else if (ev.target) {
            over = lanes.contains(ev.target);
        }
        if (!over) return false;
        const delta = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;
        if (!delta) return false;
        const deltaDb = delta > 0 ? -1 : 1;

        const selectionTargets = expandRegionSegmentEditTargetsFromSelection();
        if (!selectionTargets.length) {
            return false;
        }

        adjustSegmentGainDbForTargets(selectionTargets, deltaDb);
        ev.preventDefault();
        return true;
    }

    function getSegmentSourceDurationSec(track, seg) {
        const clipId = seg && seg.clipId ? seg.clipId : 'main';
        if (isExtraTrackRef(track) && typeof getExtraTrackClipDurationSec === 'function') {
            const d = getExtraTrackClipDurationSec(track.slot, clipId);
            if (d > 0) return d;
        }
        const trackDur = getTrackSourceDurationSec(track);
        if (trackDur > 0) return trackDur;
        const inS = Number(seg && seg.sourceInSec);
        const outS = Number(seg && seg.sourceOutSec);
        if (Number.isFinite(outS) && outS > inS + 1e-6) return outS;
        return 0;
    }

    function getSegmentClipId(track, segmentIndex) {
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return 'main';
        const raw = state.segments[segmentIndex];
        return raw.clipId || 'main';
    }

    function snapTimelineSec(sec, opt) {
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            return Math.max(0, n);
        }
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        return Math.max(0, Math.round(n / step) * step);
    }

    function regionSnapDenseGapSec() {
        const v = window.REGION_MOVE_SNAP_DENSE_GAP_SEC;
        return Number.isFinite(v) && v > 0 ? v : 2.5;
    }

    function regionSnapDenseGapRatio() {
        const v = window.REGION_MOVE_SNAP_DENSE_GAP_RATIO;
        return Number.isFinite(v) && v > 0 ? v : 0.15;
    }

    /** 候補 stop から最も近い隣接 stop までの秒間隔 */
    function regionSnapAdjacentGapSec(stop, stops) {
        let minGap = Infinity;
        for (let i = 0; i < stops.length; i++) {
            const s = stops[i];
            if (!Number.isFinite(s) || Math.abs(s - stop) < 1e-9) continue;
            minGap = Math.min(minGap, Math.abs(s - stop));
        }
        return Number.isFinite(minGap) && minGap < Infinity ? minGap : Infinity;
    }

    /** 密集境界は狭く、離れた境界は画面上の SNAP_PX をそのまま使う */
    function regionSnapEffectiveThresholdSec(stop, stops, pixelTh) {
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        const gap = regionSnapAdjacentGapSec(stop, stops);
        if (!Number.isFinite(gap) || gap > regionSnapDenseGapSec()) {
            return pixelTh;
        }
        return Math.min(pixelTh, Math.max(step, gap * regionSnapDenseGapRatio()));
    }

    function regionSnapWithinThresholdSec(dist, threshold) {
        if (!Number.isFinite(dist) || !Number.isFinite(threshold)) return false;
        return dist <= threshold + regionMoveDragDeltaEpsilonSec();
    }

    function regionSnapThresholdSec(opt) {
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        const freeze =
            typeof getRegionOffsetDragMasterFreezeSec === 'function'
                ? getRegionOffsetDragMasterFreezeSec()
                : 0;
        const master =
            freeze > 0
                ? freeze
                : typeof getMasterTransportDurationSec === 'function'
                  ? getMasterTransportDurationSec()
                  : 0;
        const el =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        const m =
            typeof waveformTimelineMetrics === 'function' ? waveformTimelineMetrics(el) : null;
        if (!master || !m || !m.scrubW) {
            return Math.max(step * 6, 0.05);
        }
        let scrubW = m.scrubW;
        if (
            typeof waveformOffsetDragActive !== 'undefined' &&
            waveformOffsetDragActive &&
            typeof waveformOffsetDragStartScrubW === 'number' &&
            waveformOffsetDragStartScrubW > 0
        ) {
            scrubW = waveformOffsetDragStartScrubW;
        }
        const SNAP_PX = opt && opt.commitSnap ? 18 : 14;
        return Math.max(step, (SNAP_PX / scrubW) * master);
    }

    function regionMoveSnapPxThreshold(opt) {
        return opt && opt.commitSnap ? 18 : 14;
    }

    function regionMoveSnapLayoutMetrics() {
        const freeze =
            typeof getRegionOffsetDragMasterFreezeSec === 'function'
                ? getRegionOffsetDragMasterFreezeSec()
                : 0;
        const master =
            freeze > 0
                ? freeze
                : typeof getMasterTransportDurationSec === 'function'
                  ? getMasterTransportDurationSec()
                  : 0;
        const el =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        const m =
            typeof waveformTimelineMetrics === 'function' ? waveformTimelineMetrics(el) : null;
        let scrubW = m && m.scrubW > 0 ? m.scrubW : 0;
        if (
            typeof waveformOffsetDragActive !== 'undefined' &&
            waveformOffsetDragActive &&
            typeof waveformOffsetDragStartScrubW === 'number' &&
            waveformOffsetDragStartScrubW > 0
        ) {
            scrubW = waveformOffsetDragStartScrubW;
        }
        return { master, scrubW };
    }

    function regionSecGapToPx(gapSec, master, scrubW) {
        if (!Number.isFinite(gapSec) || !(master > 0) || !(scrubW > 0)) {
            return Infinity;
        }
        return (Math.abs(gapSec) / master) * scrubW;
    }

    function regionSnapEffectiveThresholdPx(stop, stops, snapPx, master, scrubW) {
        const secTh = regionSnapEffectiveThresholdSec(
            stop,
            stops,
            (snapPx / scrubW) * master,
        );
        return regionSecGapToPx(secTh, master, scrubW);
    }

    function regionSnapWithinThresholdPx(distPx, thresholdPx) {
        if (!Number.isFinite(distPx) || !Number.isFinite(thresholdPx)) return false;
        return distPx <= thresholdPx + 0.5;
    }

    function snapToNearestStop(sec, stops, threshold, opt) {
        const n = Number(sec);
        if (!Number.isFinite(n) || !stops || !stops.length) return n;
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            return n;
        }
        const th = Number.isFinite(threshold) && threshold > 0 ? threshold : regionSnapThresholdSec();
        let best = n;
        let bestDist = th + 1;
        for (let i = 0; i < stops.length; i++) {
            const s = stops[i];
            if (!Number.isFinite(s)) continue;
            const d = Math.abs(s - n);
            if (d <= th && d < bestDist) {
                bestDist = d;
                best = s;
            }
        }
        return best;
    }

    function isRegionSnapStopExcluded(exclude, slot, segmentIndex) {
        if (!exclude || exclude.slot !== slot) return false;
        if (Array.isArray(exclude.segmentIndices)) {
            return exclude.segmentIndices.indexOf(segmentIndex) >= 0;
        }
        return exclude.segmentIndex === segmentIndex;
    }

    function collectRegionSnapStops(exclude, sameSlotOnly) {
        const stops = [];
        const n =
            getExtraTrackCount();
        const limitSlot =
            typeof sameSlotOnly === 'number' && sameSlotOnly >= 0 ? sameSlotOnly : -1;
        for (let slot = 0; slot < n; slot++) {
            if (limitSlot >= 0 && slot !== limitSlot) continue;
            const track = { type: 'extra', slot };
            if (!isTrackRegionActive(track)) continue;
            const segs = getTrackSegments(track);
            for (let i = 0; i < segs.length; i++) {
                if (isRegionSnapStopExcluded(exclude, slot, i)) {
                    continue;
                }
                stops.push(getSegmentRegionTimelineIn(track, i));
                stops.push(getSegmentTimelineEnd(track, i));
            }
        }
        return stops;
    }

    function resolveTimelineSnapPriorityMode() {
        const markerActive =
            typeof hasVisibleMarkersOnTimeline === 'function' &&
            hasVisibleMarkersOnTimeline();
        if (markerActive) return 'marker';
        const musicalActive =
            typeof hasMusicalGridSnapStops === 'function' && hasMusicalGridSnapStops();
        if (musicalActive) return 'musical';
        return 'region';
    }

    function snapRegionTransportSec(sec, opt) {
        let n = snapTimelineSec(sec, opt);
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            return Math.max(0, n);
        }
        const threshold = regionSnapThresholdSec();
        const exclude = opt && opt.exclude ? opt.exclude : null;
        const sameSlotOnly =
            opt && typeof opt.sameSlotOnly === 'number' ? opt.sameSlotOnly : -1;
        if (sameSlotOnly >= 0) {
            const snappedSameSlot = snapToNearestStop(
                n,
                collectRegionSnapStops(exclude, sameSlotOnly),
                threshold,
                opt,
            );
            if (Math.abs(snappedSameSlot - n) > 1e-9) {
                return Math.max(0, snappedSameSlot);
            }
        }
        const priority = resolveTimelineSnapPriorityMode();
        if (priority === 'marker' && typeof collectMarkerVideoEndSnapStops === 'function') {
            n = snapToNearestStop(n, collectMarkerVideoEndSnapStops(), threshold, opt);
        } else if (priority === 'musical' && typeof collectMusicalGridSnapStops === 'function') {
            n = snapToNearestStop(n, collectMusicalGridSnapStops(), threshold, opt);
        } else {
            n = snapToNearestStop(
                n,
                collectRegionSnapStops(exclude, sameSlotOnly),
                threshold,
                opt,
            );
        }
        return Math.max(0, n);
    }

    /** In/Out ハンドル: 全 Ex のリージョン In/Out を常に候補にし、マーカー／グリッドも併用 */
    function snapRegionHandleTransportSec(sec, opt) {
        let n = snapTimelineSec(sec, opt);
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            return Math.max(0, n);
        }
        const threshold = regionSnapThresholdSec();
        const exclude = opt && opt.exclude ? opt.exclude : null;
        const stops = collectRegionSnapStops(exclude, -1);
        const priority = resolveTimelineSnapPriorityMode();
        if (priority === 'marker' && typeof collectMarkerVideoEndSnapStops === 'function') {
            const markerStops = collectMarkerVideoEndSnapStops();
            for (let i = 0; i < markerStops.length; i++) {
                stops.push(markerStops[i]);
            }
        } else if (priority === 'musical' && typeof collectMusicalGridSnapStops === 'function') {
            const gridStops = collectMusicalGridSnapStops();
            for (let i = 0; i < gridStops.length; i++) {
                stops.push(gridStops[i]);
            }
        }
        return Math.max(0, snapToNearestStop(n, stops, threshold, opt));
    }

    /** 波形クリック／シークバー: リージョン In/Out（またはマーカー表示時はマーカー）へスナップ */
    function snapTransportSecForWaveformSeek(sec, opt) {
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            return Math.max(0, n);
        }
        const thresholdSec = regionSnapThresholdSec();
        const markersShownOnWaveform =
            typeof audioWaveformMarkers !== 'undefined' &&
            audioWaveformMarkers &&
            !audioWaveformMarkers.hidden;
        if (markersShownOnWaveform && typeof snapSecToMarkerInOut === 'function') {
            return snapSecToMarkerInOut(n, {
                thresholdSec,
                altKey: !!(opt && opt.altKey),
            });
        }
        if (typeof snapRegionTransportSec === 'function') {
            return snapRegionTransportSec(n, {
                sameSlotOnly: -1,
                altKey: !!(opt && opt.altKey),
            });
        }
        return Math.max(0, n);
    }

    /** マーカードラッグ: 全 Ex トラックのリージョン In/Out へスナップ */
    function snapSecToPlaybackRegionInOut(sec, opt) {
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            const n = Number(sec);
            return Number.isFinite(n) ? Math.max(0, n) : 0;
        }
        const threshold =
            opt && Number.isFinite(opt.thresholdSec) && opt.thresholdSec > 0
                ? opt.thresholdSec
                : regionSnapThresholdSec();
        return Math.max(
            0,
            snapToNearestStop(sec, collectRegionSnapStops(null, -1), threshold, opt),
        );
    }

    /** transportRatioFromClientX は 0–1 クランプのため、Out ドラッグでは未クランプ比率を使う */
    function scrubRatioUnclampedFromClientX(clientX, scrubWCss) {
        const inner =
            typeof waveformTimelineInnerEl === 'function' ? waveformTimelineInnerEl() : null;
        const lanes =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        const ref = inner || lanes;
        const w = Number(scrubWCss);
        if (!ref || !(w > 0) || !Number.isFinite(clientX)) return 0;
        const left = ref.getBoundingClientRect().left;
        return (Number(clientX) - left) / w;
    }

    /** 平行移動: 全 Ex のリージョン In/Out を常に候補にし、マーカー／グリッドも併用（ハンドル操作と同じ） */
    function collectRegionMoveSnapStops(exclude) {
        const raw = collectRegionSnapStops(exclude, -1);
        const priority = resolveTimelineSnapPriorityMode();
        if (priority === 'marker' && typeof collectMarkerVideoEndSnapStops === 'function') {
            const markerStops = collectMarkerVideoEndSnapStops();
            for (let i = 0; i < markerStops.length; i++) {
                raw.push(markerStops[i]);
            }
        } else if (priority === 'musical' && typeof collectMusicalGridSnapStops === 'function') {
            const gridStops = collectMusicalGridSnapStops();
            for (let i = 0; i < gridStops.length; i++) {
                raw.push(gridStops[i]);
            }
        }
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        const eps = step * 0.5;
        const unique = [];
        for (let i = 0; i < raw.length; i++) {
            const s = raw[i];
            if (!Number.isFinite(s)) continue;
            let dup = false;
            for (let j = 0; j < unique.length; j++) {
                if (Math.abs(unique[j] - s) <= eps) {
                    dup = true;
                    break;
                }
            }
            if (!dup) unique.push(s);
        }
        return unique;
    }

    function regionMoveDragDeltaEpsilonSec() {
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        return step * 0.5;
    }

    function regionMoveEdgeSnapIneligibleReason(stop, edgeSec, currentEdgeSec, instantDelta) {
        if (!Number.isFinite(stop) || !Number.isFinite(edgeSec)) {
            return 'invalid';
        }
        const eps = regionMoveDragDeltaEpsilonSec();
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        if (!Number.isFinite(instantDelta) || Math.abs(instantDelta) <= eps) {
            return null;
        }
        if (instantDelta < 0) {
            if (stop > edgeSec + step) {
                return 'ahead-left';
            }
            return null;
        }
        if (stop < edgeSec - step) {
            return 'behind-right';
        }
        return null;
    }

    function regionMoveEdgeSnapEligible(stop, edgeSec, currentEdgeSec, instantDelta) {
        return regionMoveEdgeSnapIneligibleReason(
            stop,
            edgeSec,
            currentEdgeSec,
            instantDelta,
        ) == null;
    }

    function regionSnapDiagEnabled() {
        return (
            typeof window.isDebugLogCategoryEnabled === 'function' &&
            window.isDebugLogCategoryEnabled('REGION_SNAP')
        );
    }

    function regionMoveCommitSnapRejectReasons(stop, snapHead, snapTail, baseHead, baseTail) {
        const eps = regionMoveDragDeltaEpsilonSec();
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        const nearEps = Math.max(eps * 2, step);
        const dragHeadDelta = snapHead - baseHead;
        const dragTailDelta = snapTail - baseTail;
        let headReject = null;
        let tailReject = null;

        if (Math.abs(baseHead - stop) <= nearEps && Math.abs(dragHeadDelta) > eps) {
            if (dragHeadDelta > eps && snapHead > stop + eps) {
                headReject = 'moved-away-from-stop-head';
            } else if (dragHeadDelta < -eps && snapHead < stop - eps) {
                headReject = 'moved-away-from-stop-head';
            }
        }
        if (Math.abs(baseTail - stop) <= nearEps && Math.abs(dragTailDelta) > eps) {
            if (dragTailDelta > eps && snapTail > stop + eps) {
                tailReject = 'moved-away-from-stop-tail';
            } else if (dragTailDelta < -eps && snapTail < stop - eps) {
                tailReject = 'moved-away-from-stop-tail';
            }
        }
        return { headReject, tailReject };
    }

    /** リージョン平行移動: 頭（In）か末端（Out）の近い方を候補境界へ合わせる */
    function snapRegionMoveRegionInSecDetail(desiredRegionIn, track, segmentIndex, opt) {
        const raw = Number(desiredRegionIn) || 0;
        const detail = {
            proposedHeadSec: raw,
            pointerSec: raw,
            frameSec: raw,
            proposedTailSec: null,
            snappedSec: raw,
            edge: 'none',
            stopSec: null,
            thresholdSec: null,
        };
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            detail.edge = 'alt';
            detail.snappedSec = Math.max(REGION_IN_MIN_TRANSPORT_SEC, raw);
            return {
                sec: detail.snappedSec,
                detail,
            };
        }
        const proposedHead = snapTimelineSec(raw, opt);
        detail.proposedHeadSec = raw;
        detail.frameSec = proposedHead;
        detail.pointerSec = raw;
        const threshold = regionSnapThresholdSec(opt);
        const snapPx = regionMoveSnapPxThreshold(opt);
        const layout = regionMoveSnapLayoutMetrics();
        detail.thresholdSec = threshold;
        detail.pixelThresholdSec = snapPx;
        detail.snapScrubW = layout.scrubW;
        detail.snapMasterSec = layout.master;
        const exclude =
            opt && opt.exclude
                ? opt.exclude
                : { slot: track.slot, segmentIndex };
        const baseRegionIn =
            opt && Number.isFinite(opt.dragStartRegionIn)
                ? opt.dragStartRegionIn
                : getSegmentRegionTimelineIn(track, segmentIndex);
        const baseAnchor =
            opt && Number.isFinite(opt.dragStartAnchor)
                ? opt.dragStartAnchor
                : getSegmentTimelineStart(track, segmentIndex);
        const seg = getTrackSegments(track)[segmentIndex];
        if (!seg) {
            detail.edge = 'transport-fallback';
            detail.snappedSec = snapRegionTransportSec(proposedHead, { exclude, sameSlotOnly: -1 });
            return {
                sec: detail.snappedSec,
                detail,
            };
        }

        const segDur = Math.max(
            PLAYBACK_REGION_MIN_SEC,
            seg.sourceOutSec - seg.sourceInSec,
        );
        const outOffsetFromIn = baseAnchor - baseRegionIn + segDur;
        const proposedTail = raw + outOffsetFromIn;
        const baseTail = baseRegionIn + outOffsetFromIn;
        detail.proposedTailSec = proposedTail;
        detail.baseHeadSec = baseRegionIn;
        detail.baseTailSec = baseTail;
        const dragDelta = raw - baseRegionIn;
        detail.dragDeltaSec = dragDelta;
        const currentRegionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const currentTail = currentRegionIn + outOffsetFromIn;
        const lastProposed =
            opt && Number.isFinite(opt.lastProposedHeadSec)
                ? opt.lastProposedHeadSec
                : currentRegionIn;
        const frameHeadDelta = proposedHead - lastProposed;
        const instantHeadDelta = raw - currentRegionIn;
        const eps = regionMoveDragDeltaEpsilonSec();
        const directionDelta =
            opt && opt.geometryOnly && Number.isFinite(opt.lastProposedHeadSec)
                ? Math.abs(frameHeadDelta) > eps
                    ? frameHeadDelta
                    : dragDelta
                : Math.abs(instantHeadDelta) > eps
                  ? instantHeadDelta
                  : dragDelta;
        detail.currentHeadSec = currentRegionIn;
        detail.instantDeltaSec = instantHeadDelta;
        detail.frameDeltaSec = frameHeadDelta;
        detail.directionDeltaSec = directionDelta;

        const stops = collectRegionMoveSnapStops(exclude);
        const diagCandidates = regionSnapDiagEnabled() ? [] : null;

        let bestRegionIn = proposedHead;
        let bestDistPx = snapPx + 1;
        let bestEdge = 'none';
        let bestStop = null;
        let nearestStop = null;
        let nearestDist = Infinity;
        let nearestDistPx = Infinity;
        let nearestEdge = null;
        const snapHead = raw;
        const snapTail = proposedTail;
        for (let i = 0; i < stops.length; i++) {
            const stop = stops[i];
            if (!Number.isFinite(stop)) continue;
            const dHead = Math.abs(stop - snapHead);
            const dTail = Math.abs(stop - snapTail);
            const dHeadPx = regionSecGapToPx(dHead, layout.master, layout.scrubW);
            const dTailPx = regionSecGapToPx(dTail, layout.master, layout.scrubW);
            const minD = Math.min(dHead, dTail);
            const minDPx = Math.min(dHeadPx, dTailPx);
            if (minDPx < nearestDistPx) {
                nearestDistPx = minDPx;
                nearestDist = minD;
                nearestStop = stop;
                nearestEdge = dHeadPx <= dTailPx ? 'in' : 'out';
            }
            const headThPx = regionSnapEffectiveThresholdPx(
                stop,
                stops,
                snapPx,
                layout.master,
                layout.scrubW,
            );
            const tailThPx = headThPx;
            const headTh = regionSnapEffectiveThresholdSec(stop, stops, threshold);
            const tailTh = headTh;
            const rejectReasons = regionMoveCommitSnapRejectReasons(
                stop,
                snapHead,
                snapTail,
                baseRegionIn,
                baseTail,
            );
            const headReject = rejectReasons.headReject;
            const tailReject = rejectReasons.tailReject;
            if (
                diagCandidates &&
                (regionSnapWithinThresholdPx(dHeadPx, headThPx) ||
                    regionSnapWithinThresholdPx(dTailPx, tailThPx))
            ) {
                diagCandidates.push({
                    stopSec: Math.round(stop * 10000) / 10000,
                    dHeadSec: Math.round(dHead * 10000) / 10000,
                    dTailSec: Math.round(dTail * 10000) / 10000,
                    dHeadPx: Math.round(dHeadPx * 100) / 100,
                    dTailPx: Math.round(dTailPx * 100) / 100,
                    headThSec: Math.round(headTh * 10000) / 10000,
                    tailThSec: Math.round(tailTh * 10000) / 10000,
                    headThPx: Math.round(headThPx * 100) / 100,
                    adjGapSec:
                        Math.round(regionSnapAdjacentGapSec(stop, stops) * 10000) / 10000,
                    headReject: headReject,
                    tailReject: tailReject,
                });
            }
            if (
                !headReject &&
                regionSnapWithinThresholdPx(dHeadPx, headThPx) &&
                dHeadPx < bestDistPx
            ) {
                bestDistPx = dHeadPx;
                bestRegionIn = stop;
                bestEdge = 'in';
                bestStop = stop;
            }
            if (
                !tailReject &&
                regionSnapWithinThresholdPx(dTailPx, tailThPx) &&
                dTailPx < bestDistPx
            ) {
                bestDistPx = dTailPx;
                bestRegionIn = stop - outOffsetFromIn;
                bestEdge = 'out';
                bestStop = stop;
            }
        }
        if (diagCandidates) {
            diagCandidates.sort((a, b) => {
                const da = Math.min(a.dHeadSec, a.dTailSec);
                const db = Math.min(b.dHeadSec, b.dTailSec);
                return da - db;
            });
            detail.candidates = diagCandidates.slice(0, 16);
            detail.stopCount = stops.length;
        }
        if (Number.isFinite(nearestStop)) {
            detail.nearestStopSec = Math.round(nearestStop * 10000) / 10000;
            detail.nearestDistSec = Math.round(nearestDist * 10000) / 10000;
            detail.nearestDistPx = Math.round(nearestDistPx * 100) / 100;
            detail.nearestEdge = nearestEdge;
        }
        detail.edge = bestEdge;
        detail.stopSec = bestStop;
        detail.snappedSec = Math.max(
            REGION_IN_MIN_TRANSPORT_SEC,
            snapTimelineSec(bestRegionIn, opt),
        );
        return {
            sec: detail.snappedSec,
            detail,
        };
    }

    function snapRegionMoveRegionInSec(desiredRegionIn, track, segmentIndex, opt) {
        return snapRegionMoveRegionInSecDetail(desiredRegionIn, track, segmentIndex, opt).sec;
    }

    window.snapRegionMoveRegionInSecDetail = snapRegionMoveRegionInSecDetail;
    window.scrubRatioUnclampedFromClientX = scrubRatioUnclampedFromClientX;

    function maxSegmentSourceOutSec(track, segmentIndex) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return 0;
        const clipDur = getSegmentSourceDurationSec(track, seg);
        return Math.max(seg.sourceInSec + PLAYBACK_REGION_MIN_SEC, clipDur);
    }

    function maxSegmentTimelineEndSec(track, segmentIndex) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return 0;
        const start = getSegmentTimelineStart(track, segmentIndex);
        const span = Math.max(
            PLAYBACK_REGION_MIN_SEC,
            maxSegmentSourceOutSec(track, segmentIndex) - seg.sourceInSec,
        );
        return start + span;
    }

    function clampSegmentTimelineStart(_track, _segmentIndex, desiredStart) {
        return Math.max(0, Number(desiredStart) || 0);
    }

    function clampSegmentTimelineEnd(track, segmentIndex, desiredEnd) {
        const start = getSegmentTimelineStart(track, segmentIndex);
        return Math.max(start + PLAYBACK_REGION_MIN_SEC, Number(desiredEnd) || 0);
    }

    const REGION_RESIZE_HANDLE_HIT_PX = 7;

    /** リージョン移動時、絶対位置の regionTimelineInSec をアンカーと同量だけ追従させる */
    function shiftSegmentRegionTimelineInByDelta(track, segmentIndex, delta) {
        if (!Number.isFinite(delta) || Math.abs(delta) < 0.00001) return;
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            if (!state || !Number.isFinite(state.regionTimelineInSec)) return;
            state.regionTimelineInSec = Math.max(0, state.regionTimelineInSec + delta);
            return;
        }
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (raw && Number.isFinite(raw.regionTimelineInSec)) {
            raw.regionTimelineInSec = Math.max(0, raw.regionTimelineInSec + delta);
        }
    }

    function shiftTrackAbsoluteRegionInsByDelta(track, delta) {
        if (!Number.isFinite(delta) || Math.abs(delta) < 0.00001) return;
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments || !state.segments.length) return;
        for (let i = 0; i < state.segments.length; i++) {
            shiftSegmentRegionTimelineInByDelta(track, i, delta);
        }
    }

    const REGION_HANDLE_HIT_PAD_PX = 4;
    /** 見た目 8px の三角に対し、操作判定だけ下方向に倍 */
    const FADE_HANDLE_HIT_HEIGHT_MUL = 2;

    function fadeHandleHitTestRect(visualRect) {
        if (!visualRect || !(visualRect.width > 0) || !(visualRect.height > 0)) {
            return null;
        }
        const w = visualRect.width;
        const h = visualRect.height * FADE_HANDLE_HIT_HEIGHT_MUL;
        return {
            left: visualRect.left,
            top: visualRect.top,
            right: visualRect.left + w,
            bottom: visualRect.top + h,
            width: w,
            height: h,
        };
    }

    function isPointerOnFadeHandleTriangle(kind, rect, clientX, clientY) {
        if (!rect || !(rect.width > 0) || !(rect.height > 0)) return false;
        if (
            clientX < rect.left ||
            clientX > rect.right ||
            clientY < rect.top ||
            clientY > rect.bottom
        ) {
            return false;
        }
        const lx = clientX - rect.left;
        const ly = clientY - rect.top;
        const w = rect.width;
        const h = rect.height;
        if (kind === 'fade-in') {
            return lx / w + ly / h <= 1 + 1e-6;
        }
        if (kind === 'fade-out') {
            return (w - lx) / w + ly / h <= 1 + 1e-6;
        }
        return false;
    }

    function getFadeHandleHitRect(regionEl, edgeKind) {
        if (!regionEl) return null;
        const sel =
            edgeKind === 'in'
                ? '.audio-waveform-lane__playback-region__handle--fade-in'
                : edgeKind === 'out'
                  ? '.audio-waveform-lane__playback-region__handle--fade-out'
                  : null;
        if (!sel) return null;
        const handleEl = regionEl.querySelector(sel);
        if (!handleEl || handleEl.hidden) return null;
        return fadeHandleHitTestRect(handleEl.getBoundingClientRect());
    }

    function pointInClientRect(clientX, clientY, rect) {
        if (!rect || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        return (
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom
        );
    }

    /** ドラッグ開始用 — 三角＋下方向拡張の操作矩形全体 */
    function isPointerInFadeHandleGrabZone(regionEl, edgeKind, clientX, clientY) {
        const hitRect = getFadeHandleHitRect(regionEl, edgeKind);
        return pointInClientRect(clientX, clientY, hitRect);
    }

    /** In/Out とフェード三角の操作帯が重なるとき、端リサイズ判定から除外する */
    function isPointerInFadeHandleHitZone(regionEl, edgeKind, clientX, clientY) {
        const hitRect = getFadeHandleHitRect(regionEl, edgeKind);
        if (!hitRect || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
            return false;
        }
        const kind = edgeKind === 'in' ? 'fade-in' : 'fade-out';
        return isPointerOnFadeHandleTriangle(kind, hitRect, clientX, clientY);
    }

    function isPointerOnRegionEdgeResizeHandle(regionEl, edgeKind, clientX, clientY) {
        if (!regionEl || !Number.isFinite(clientX)) return false;
        const pad = REGION_HANDLE_HIT_PAD_PX;
        const sel =
            edgeKind === 'in'
                ? '.audio-waveform-lane__playback-region__handle--in'
                : edgeKind === 'out'
                  ? '.audio-waveform-lane__playback-region__handle--out'
                  : null;
        if (!sel) return false;
        const handleEl = regionEl.querySelector(sel);
        if (!handleEl) return false;
        const r = handleEl.getBoundingClientRect();
        if (clientX < r.left - pad || clientX > r.right + pad) return false;
        if (
            Number.isFinite(clientY) &&
            isPointerInFadeHandleHitZone(regionEl, edgeKind, clientX, clientY)
        ) {
            return false;
        }
        return true;
    }

    function isPointerOnRegionResizeHandle(regionEl, clientX, clientY) {
        if (!regionEl || !Number.isFinite(clientX)) return false;
        return (
            isPointerOnRegionEdgeResizeHandle(regionEl, 'in', clientX, clientY) ||
            isPointerOnRegionEdgeResizeHandle(regionEl, 'out', clientX, clientY)
        );
    }

    /** 重なり／クロスフェード部でも、DOM 前面のリージョン本体に隠れた In/Out を拾う */
    function resolveRegionResizeHandleAtPointer(track, clientX, clientY) {
        if (!isExtraTrackRef(track) || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
            return null;
        }
        const lane = document.getElementById('extraAudioLane' + track.slot);
        if (!lane || lane.hidden) return null;
        const laneRect = lane.getBoundingClientRect();
        if (
            clientY < laneRect.top ||
            clientY > laneRect.bottom ||
            clientX < laneRect.left ||
            clientX > laneRect.right
        ) {
            return null;
        }
        const container = getPlaybackRegionsContainerEl(track);
        if (!container || container.hidden) return null;

        const pad = REGION_HANDLE_HIT_PAD_PX;
        let bestFade = null;
        let bestFadeDist = Infinity;
        let best = null;
        let bestDist = Infinity;
        const regions = container.querySelectorAll('.audio-waveform-lane__playback-region');
        for (let r = 0; r < regions.length; r++) {
            const regionEl = regions[r];
            const segmentIndex = Number(regionEl.dataset.segmentIndex);
            if (!Number.isFinite(segmentIndex)) continue;
            const fadeCandidates = [
                {
                    kind: 'fade-in',
                    el: regionEl.querySelector(
                        '.audio-waveform-lane__playback-region__handle--fade-in',
                    ),
                },
                {
                    kind: 'fade-out',
                    el: regionEl.querySelector(
                        '.audio-waveform-lane__playback-region__handle--fade-out',
                    ),
                },
            ];
            for (let c = 0; c < fadeCandidates.length; c++) {
                const handleEl = fadeCandidates[c].el;
                if (!handleEl || handleEl.hidden) continue;
                const kind = fadeCandidates[c].kind;
                const fadeEdgeKind = kind === 'fade-in' ? 'in' : 'out';
                if (
                    !isPointerInFadeHandleGrabZone(
                        regionEl,
                        fadeEdgeKind,
                        clientX,
                        clientY,
                    )
                ) {
                    continue;
                }
                const hitRect = getFadeHandleHitRect(regionEl, fadeEdgeKind);
                if (!hitRect) continue;
                const cx = (hitRect.left + hitRect.right) * 0.5;
                const cy = (hitRect.top + hitRect.bottom) * 0.5;
                const dist = Math.hypot(clientX - cx, clientY - cy);
                if (dist < bestFadeDist) {
                    bestFadeDist = dist;
                    bestFade = { segmentIndex, kind, regionEl };
                }
            }
            const edgeCandidates = [
                {
                    kind: 'in',
                    el: regionEl.querySelector(
                        '.audio-waveform-lane__playback-region__handle--in',
                    ),
                },
                {
                    kind: 'out',
                    el: regionEl.querySelector(
                        '.audio-waveform-lane__playback-region__handle--out',
                    ),
                },
            ];
            for (let c = 0; c < edgeCandidates.length; c++) {
                const kind = edgeCandidates[c].kind;
                const handleEl = edgeCandidates[c].el;
                if (!handleEl) continue;
                const rect = handleEl.getBoundingClientRect();
                if (clientX < rect.left - pad || clientX > rect.right + pad) continue;
                if (isPointerInFadeHandleHitZone(regionEl, kind, clientX, clientY)) {
                    continue;
                }
                const cx = (rect.left + rect.right) * 0.5;
                const dist = Math.abs(clientX - cx);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = { segmentIndex, kind, regionEl };
                }
            }
        }
        return bestFade || best;
    }

    window.getFadeHandleHitRect = getFadeHandleHitRect;
    window.isPointerInFadeHandleGrabZone = isPointerInFadeHandleGrabZone;
    window.isPointerInFadeHandleHitZone = isPointerInFadeHandleHitZone;
    window.isPointerOnFadeHandleTriangle = isPointerOnFadeHandleTriangle;
    window.resolveRegionResizeHandleAtPointer = resolveRegionResizeHandleAtPointer;
