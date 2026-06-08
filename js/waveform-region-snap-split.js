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
    window.isPlaybackRegionSplitForbiddenAtTransport =
        isPlaybackRegionSplitForbiddenAtTransport;

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
            writeLog(
                'Ex ' +
                    (lastSlot + 1) +
                    ' region ' +
                    (lastSeg + 1) +
                    ' gain: ' +
                    (lastLabel || '0.0 dB'),
            );
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
            writeLog(
                'Playback region gain ' +
                    stepLabel +
                    ' (' +
                    targets.length +
                    ' regions)',
            );
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', stepLabel + ' × ' + targets.length, 'notice');
            }
        }
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

    function regionSnapThresholdSec() {
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const el =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        const m =
            typeof waveformTimelineMetrics === 'function' ? waveformTimelineMetrics(el) : null;
        if (!master || !m || !m.scrubW) {
            return Math.max(step * 6, 0.05);
        }
        const SNAP_PX = 14;
        return Math.max(step, (SNAP_PX / m.scrubW) * master);
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

    function collectRegionMoveSnapStops(exclude) {
        const priority = resolveTimelineSnapPriorityMode();
        if (priority === 'marker' && typeof collectMarkerVideoEndSnapStops === 'function') {
            return collectMarkerVideoEndSnapStops();
        }
        if (priority === 'musical' && typeof collectMusicalGridSnapStops === 'function') {
            return collectMusicalGridSnapStops();
        }
        return collectRegionSnapStops(exclude, -1);
    }

    /** リージョン平行移動: In/Out 両端のうち近い方でマーカー・他トラック In/Out・動画終端へスナップ */
    function snapRegionMoveRegionInSec(desiredRegionIn, track, segmentIndex, opt) {
        const raw = Number(desiredRegionIn) || 0;
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            return Math.max(REGION_IN_MIN_TRANSPORT_SEC, raw);
        }
        const n = snapTimelineSec(raw, opt);
        const threshold = regionSnapThresholdSec();
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
        if (!seg) return snapRegionTransportSec(n, { exclude, sameSlotOnly: -1 });

        const segDur = Math.max(
            PLAYBACK_REGION_MIN_SEC,
            seg.sourceOutSec - seg.sourceInSec,
        );
        const outOffsetFromIn = baseAnchor - baseRegionIn + segDur;
        const rawOut = n + outOffsetFromIn;
        const stops = collectRegionMoveSnapStops(exclude);

        let bestRegionIn = n;
        let bestDist = threshold + 1;
        for (let i = 0; i < stops.length; i++) {
            const stop = stops[i];
            if (!Number.isFinite(stop)) continue;
            const dIn = Math.abs(stop - n);
            if (dIn <= threshold && dIn < bestDist) {
                bestDist = dIn;
                bestRegionIn = stop;
            }
            const dOut = Math.abs(stop - rawOut);
            if (dOut <= threshold && dOut < bestDist) {
                bestDist = dOut;
                bestRegionIn = stop - outOffsetFromIn;
            }
        }
        return Math.max(REGION_IN_MIN_TRANSPORT_SEC, snapTimelineSec(bestRegionIn, opt));
    }

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

    function getAllRegionTimelineIntervals(exclude) {
        const list = [];
        const n =
            getExtraTrackCount();
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            if (!isTrackRegionActive(track)) continue;
            const segs = getTrackSegments(track);
            for (let i = 0; i < segs.length; i++) {
                if (
                    exclude &&
                    exclude.slot === slot &&
                    exclude.segmentIndex === i
                ) {
                    continue;
                }
                const start = getSegmentTimelineStart(track, i);
                const end = getSegmentTimelineEnd(track, i);
                list.push({ slot, segmentIndex: i, start, end });
            }
        }
        return list;
    }

    function intervalsOverlapTimeline(aStart, aEnd, bStart, bEnd) {
        return (
            aStart < bEnd - SEGMENT_BOUNDARY_JOIN_EPS_SEC &&
            aEnd > bStart + SEGMENT_BOUNDARY_JOIN_EPS_SEC
        );
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

    /** In/Out とフェード三角の操作帯が重なるとき、端リサイズ判定から除外する */
    function isPointerInFadeHandleHitZone(regionEl, edgeKind, clientX, clientY) {
        const hitRect = getFadeHandleHitRect(regionEl, edgeKind);
        if (!hitRect || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
            return false;
        }
        return (
            clientX >= hitRect.left &&
            clientX <= hitRect.right &&
            clientY >= hitRect.top &&
            clientY <= hitRect.bottom
        );
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
                    !isPointerInFadeHandleHitZone(
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
