(function waveformRegionModule() {
    const PLAYBACK_REGION_MIN_SEC = 0.05;
    const SEGMENT_BOUNDARY_JOIN_EPS_SEC = 0.002;
    /** 結合境界のクロスフェード幅（分割点の手前のみ、境界以降は伸ばさない） */
    const JOINED_BOUNDARY_CROSSFADE_SEC = 0.1;
    const REGION_GAIN_DB_MIN = -96;
    const REGION_GAIN_DB_MAX = 10;

    let regionHandleDragActive = false;
    let regionHandleDragTrack = null;
    let regionHandleDragSegmentIndex = -1;
    let regionHandleDragBoundaryIndex = -1;
    let regionHandleDragKind = null;
    let regionHandleDragPointerId = null;
    let regionHandleDragDocMove = null;
    let regionHandleDragDocUp = null;
    /** Out ドラッグ中のみ、当該 Ex のタイムラインをクリップ最大長まで一時拡張 */
    let regionOutDragExtendSlot = -1;
    let regionOutDragStartClientX = NaN;
    let regionOutDragStartOutTransportSec = NaN;

    const regionUndoStack = [];
    const regionRedoStack = [];
    let regionUndoPaused = false;
    let regionUndoDragSnap = null;

    let pendingPlaybackRegionRestore = null;
    /** @type {{ slot: number, segment: object } | null} */
    let regionSegmentClipboard = null;

    function deepCloneJson(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function emptyPlaybackRegionsState() {
        return { active: false, segments: [], headPadSec: 0 };
    }

    function captureRegionUndoSnapshot() {
        const n =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 3;
        const snap = [];
        for (let i = 0; i < n; i++) {
            const tr =
                typeof extraTrackBySlot === 'function' ? extraTrackBySlot(i) : null;
            let playbackRegions = emptyPlaybackRegionsState();
            if (tr && tr.playbackRegions) {
                playbackRegions = deepCloneJson(tr.playbackRegions);
            }
            const timelineStartSec =
                typeof getExtraTrackTimelineStartSec === 'function'
                    ? getExtraTrackTimelineStartSec(i)
                    : 0;
            snap.push({ slot: i, playbackRegions, timelineStartSec });
        }
        return snap;
    }

    function regionUndoSnapshotsEqual(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    function clearRegionRedoStack() {
        regionRedoStack.length = 0;
    }

    function requestRegionUndoCapture() {
        if (regionUndoPaused) return;
        const snap = captureRegionUndoSnapshot();
        const top = regionUndoStack.length
            ? regionUndoStack[regionUndoStack.length - 1]
            : null;
        if (top && regionUndoSnapshotsEqual(top, snap)) return;
        regionUndoStack.push(snap);
        clearRegionRedoStack();
    }

    function restoreRegionUndoSnapshot(snap) {
        regionUndoPaused = true;
        const n =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 3;
        for (let i = 0; i < n; i++) {
            const entry = snap.find((e) => e.slot === i);
            const tr =
                typeof extraTrackBySlot === 'function' ? extraTrackBySlot(i) : null;
            if (!tr) continue;
            if (entry) {
                tr.playbackRegions = deepCloneJson(entry.playbackRegions);
                if (typeof setExtraTrackTimelineStartSec === 'function') {
                    setExtraTrackTimelineStartSec(entry.slot, entry.timelineStartSec, {
                        skipPersist: true,
                    });
                }
            } else {
                tr.playbackRegions = emptyPlaybackRegionsState();
            }
            updateTrackRegionOverlays({ type: 'extra', slot: i });
            redrawAfterRegionChange(i);
        }
        updateAllPlaybackRegionOverlays();
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        regionUndoPaused = false;
    }

    function undoPlaybackRegion() {
        if (!regionUndoStack.length) return false;
        const current = captureRegionUndoSnapshot();
        const prev = regionUndoStack.pop();
        regionRedoStack.push(current);
        restoreRegionUndoSnapshot(prev);
        writeLog('Playback region: undo');
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Region', 'Undo', 'notice');
        }
        return true;
    }

    function redoPlaybackRegion() {
        if (!regionRedoStack.length) return false;
        const current = captureRegionUndoSnapshot();
        const next = regionRedoStack.pop();
        regionUndoStack.push(current);
        restoreRegionUndoSnapshot(next);
        writeLog('Playback region: redo');
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Region', 'Redo', 'notice');
        }
        return true;
    }

    function clearRegionUndoStack() {
        regionUndoStack.length = 0;
        clearRegionRedoStack();
        regionUndoDragSnap = null;
    }

    function beginRegionUndoGesture() {
        if (regionUndoPaused) return;
        regionUndoDragSnap = captureRegionUndoSnapshot();
    }

    function commitRegionUndoGesture() {
        if (regionUndoPaused || !regionUndoDragSnap) return;
        const current = captureRegionUndoSnapshot();
        if (!regionUndoSnapshotsEqual(regionUndoDragSnap, current)) {
            regionUndoStack.push(regionUndoDragSnap);
            clearRegionRedoStack();
        }
        regionUndoDragSnap = null;
    }

    function cancelRegionUndoGesture() {
        regionUndoDragSnap = null;
    }

    function trackKey(track) {
        return track && track.type === 'extra' ? 'extra:' + track.slot : '';
    }

    function parseTrackKey(key) {
        const m = /^extra:(\d+)$/.exec(key);
        if (m) return { type: 'extra', slot: parseInt(m[1], 10) };
        return null;
    }

    function isExtraTrackRef(track) {
        return !!(track && track.type === 'extra' && Number.isFinite(track.slot));
    }

    function normalizeSegment(sourceInSec, sourceOutSec, fullDur) {
        let inS = Number(sourceInSec);
        let outS = Number(sourceOutSec);
        if (!Number.isFinite(inS)) inS = 0;
        if (!Number.isFinite(outS)) outS = fullDur;
        if (outS < inS) {
            const t = inS;
            inS = outS;
            outS = t;
        }
        inS = Math.max(0, Math.min(inS, fullDur));
        outS = Math.max(inS + PLAYBACK_REGION_MIN_SEC, Math.min(fullDur, outS));
        return { sourceInSec: inS, sourceOutSec: outS };
    }

    function newRegionId() {
        return (
            'reg-' +
            Date.now().toString(36) +
            '-' +
            Math.random().toString(36).slice(2, 9)
        );
    }

    function normalizeSegmentEntry(seg, track, fullDur) {
        const base = normalizeSegment(seg.sourceInSec, seg.sourceOutSec, fullDur);
        base.id = seg && seg.id ? seg.id : newRegionId();
        if (seg && seg.clipId) {
            base.clipId = seg.clipId;
        } else if (typeof getDefaultExtraClipId === 'function' && track) {
            base.clipId = getDefaultExtraClipId(track.slot);
        } else {
            base.clipId = 'main';
        }
        if (seg && Number.isFinite(seg.timelineStartSec)) {
            base.timelineStartSec = seg.timelineStartSec;
        }
        if (seg && Number.isFinite(seg.regionTimelineInSec)) {
            base.regionTimelineInSec = Math.max(0, seg.regionTimelineInSec);
        }
        if (seg && Number.isFinite(seg.regionLeadPadSec)) {
            base.regionLeadPadSec = Math.max(0, seg.regionLeadPadSec);
        }
        if (seg && Number.isFinite(seg.gainDb)) {
            const db = Math.max(
                REGION_GAIN_DB_MIN,
                Math.min(REGION_GAIN_DB_MAX, seg.gainDb),
            );
            if (Math.abs(db) > 0.0005) base.gainDb = db;
        }
        return base;
    }

    function clampRegionGainDb(db) {
        const n = Number(db);
        if (!Number.isFinite(n)) return 0;
        return Math.max(REGION_GAIN_DB_MIN, Math.min(REGION_GAIN_DB_MAX, n));
    }

    function getSegmentGainDb(track, segmentIndex) {
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (!raw || !Number.isFinite(raw.gainDb)) return 0;
        return clampRegionGainDb(raw.gainDb);
    }

    function getSegmentGainLinear(track, segmentIndex) {
        const db = getSegmentGainDb(track, segmentIndex);
        if (Math.abs(db) < 0.0005) return 1;
        if (typeof trackLaneLinearGainFromDb === 'function') {
            return trackLaneLinearGainFromDb(db);
        }
        return Math.pow(10, db / 20);
    }

    function formatRegionGainDbDisplay(db) {
        const n = clampRegionGainDb(db);
        if (Math.abs(n) < 0.0005) return '';
        if (typeof trackLaneFormatDbValue === 'function') {
            return trackLaneFormatDbValue(n) + ' dB';
        }
        const s = n.toFixed(1);
        return (n > 0 ? '+' : '') + s + ' dB';
    }

    function setSegmentGainDb(track, segmentIndex, gainDb, opt) {
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return false;
        const next = clampRegionGainDb(gainDb);
        const prev = getSegmentGainDb(track, segmentIndex);
        if (Math.abs(next - prev) < 0.0005) return false;
        if (!(opt && opt.skipUndo) && !regionUndoPaused) {
            requestRegionUndoCapture();
        }
        const raw = state.segments[segmentIndex];
        if (Math.abs(next) < 0.0005) {
            delete raw.gainDb;
        } else {
            raw.gainDb = next;
        }
        updateTrackRegionOverlays(track);
        redrawAfterRegionChange(track.slot);
        if (!(opt && opt.skipPersist) && typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (
            !(opt && opt.skipVolumeMarker) &&
            typeof syncMarkerForRegionVolumeChange === 'function'
        ) {
            syncMarkerForRegionVolumeChange(track, segmentIndex, next, prev);
        }
        return true;
    }

    function adjustSegmentGainDbAtPointer(clientX, clientY, deltaDb) {
        const hit =
            typeof resolveRegionSegmentFromPointer === 'function'
                ? resolveRegionSegmentFromPointer(clientX, clientY)
                : null;
        if (!hit || hit.segmentIndex < 0) return false;
        const track = hit.track || { type: 'extra', slot: hit.slot };
        if (!isTrackRegionActive(track)) return false;
        const step = Number(deltaDb);
        if (!Number.isFinite(step) || Math.abs(step) < 0.0005) return false;
        const next = clampRegionGainDb(
            getSegmentGainDb(track, hit.segmentIndex) + step,
        );
        if (
            !setSegmentGainDb(track, hit.segmentIndex, next, { skipPersist: true })
        ) {
            return false;
        }
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        const label = formatRegionGainDbDisplay(next);
        writeLog(
            'Ex ' +
                (hit.slot + 1) +
                ' region ' +
                (hit.segmentIndex + 1) +
                ' gain: ' +
                (label || '0.0 dB'),
        );
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(
                'Ex ' + (hit.slot + 1) + ' R' + (hit.segmentIndex + 1),
                label || '0.0 dB',
                'notice',
            );
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
        if (!adjustSegmentGainDbAtPointer(ev.clientX, ev.clientY, deltaDb)) {
            return false;
        }
        ev.preventDefault();
        return true;
    }

    function getSegmentSourceDurationSec(track, seg) {
        const clipId = seg && seg.clipId ? seg.clipId : 'main';
        if (isExtraTrackRef(track) && typeof getExtraTrackClipDurationSec === 'function') {
            const d = getExtraTrackClipDurationSec(track.slot, clipId);
            if (d > 0) return d;
        }
        return getTrackSourceDurationSec(track);
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
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 3;
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

    function snapRegionTransportSec(sec, opt) {
        let n = snapTimelineSec(sec, opt);
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            return Math.max(0, n);
        }
        const threshold = regionSnapThresholdSec();
        const exclude = opt && opt.exclude ? opt.exclude : null;
        const sameSlotOnly =
            opt && typeof opt.sameSlotOnly === 'number' ? opt.sameSlotOnly : -1;
        n = snapToNearestStop(
            n,
            collectRegionSnapStops(exclude, sameSlotOnly),
            threshold,
            opt,
        );
        if (typeof snapSecToMarkerInOut === 'function') {
            n = snapSecToMarkerInOut(n, { thresholdSec: threshold, altKey: opt && opt.altKey });
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

    function collectRegionEndSnapStops(exclude, sameSlotOnly) {
        const stops = [];
        const n =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 3;
        const limitSlot =
            typeof sameSlotOnly === 'number' && sameSlotOnly >= 0 ? sameSlotOnly : -1;
        for (let slot = 0; slot < n; slot++) {
            if (limitSlot >= 0 && slot !== limitSlot) continue;
            const track = { type: 'extra', slot };
            if (!isTrackRegionActive(track)) continue;
            const segs = getTrackSegments(track);
            for (let i = 0; i < segs.length; i++) {
                if (exclude && exclude.slot === slot && exclude.segmentIndex === i) {
                    continue;
                }
                stops.push(getSegmentTimelineEnd(track, i));
            }
        }
        return stops;
    }

    /** Out ハンドル: フレームスナップ＋他リージョンの終端（同一 Ex）へスナップ */
    function snapRegionOutTransportSec(sec, opt) {
        let n = snapTimelineSec(sec, opt);
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            return Math.max(0, n);
        }
        const threshold = regionSnapThresholdSec();
        const exclude = opt && opt.exclude ? opt.exclude : null;
        const sameSlotOnly =
            opt && typeof opt.sameSlotOnly === 'number' ? opt.sameSlotOnly : -1;
        n = snapToNearestStop(
            n,
            collectRegionEndSnapStops(exclude, sameSlotOnly),
            threshold,
            opt,
        );
        if (typeof snapSecToMarkerInOut === 'function') {
            n = snapSecToMarkerInOut(n, { thresholdSec: threshold, altKey: opt && opt.altKey });
        }
        return Math.max(0, n);
    }

    function collectRegionMoveSnapStops(exclude) {
        const stops = collectRegionSnapStops(exclude, -1);
        if (typeof collectMarkerVideoEndSnapStops === 'function') {
            const markerStops = collectMarkerVideoEndSnapStops();
            for (let i = 0; i < markerStops.length; i++) {
                stops.push(markerStops[i]);
            }
        }
        return stops;
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
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 3;
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

    function isPointerOnRegionResizeHandle(regionEl, clientX) {
        if (!regionEl || !Number.isFinite(clientX)) return false;
        const pad = REGION_HANDLE_HIT_PAD_PX;
        const handleIn = regionEl.querySelector(
            '.audio-waveform-lane__playback-region__handle--in',
        );
        const handleOut = regionEl.querySelector(
            '.audio-waveform-lane__playback-region__handle--out',
        );
        if (handleIn) {
            const r = handleIn.getBoundingClientRect();
            if (clientX >= r.left - pad && clientX <= r.right + pad) return true;
        }
        if (handleOut) {
            const r = handleOut.getBoundingClientRect();
            if (clientX >= r.left - pad && clientX <= r.right + pad) return true;
        }
        return false;
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
        let best = null;
        let bestDist = Infinity;
        const regions = container.querySelectorAll('.audio-waveform-lane__playback-region');
        for (let r = 0; r < regions.length; r++) {
            const regionEl = regions[r];
            const segmentIndex = Number(regionEl.dataset.segmentIndex);
            if (!Number.isFinite(segmentIndex)) continue;
            const candidates = [
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
            for (let c = 0; c < candidates.length; c++) {
                const handleEl = candidates[c].el;
                if (!handleEl) continue;
                const rect = handleEl.getBoundingClientRect();
                if (clientX < rect.left - pad || clientX > rect.right + pad) continue;
                const cx = (rect.left + rect.right) * 0.5;
                const dist = Math.abs(clientX - cx);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = { segmentIndex, kind: candidates[c].kind, regionEl };
                }
            }
        }
        return best;
    }

    function isPointerOnAnyRegionResizeHandle(clientX, clientY, opt) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        const slots = [];
        if (opt && Number.isFinite(opt.slot)) {
            slots.push(opt.slot);
        } else {
            const n =
                typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 3;
            for (let i = 0; i < n; i++) slots.push(i);
        }
        for (let i = 0; i < slots.length; i++) {
            if (
                resolveRegionResizeHandleAtPointer(
                    { type: 'extra', slot: slots[i] },
                    clientX,
                    clientY,
                )
            ) {
                return true;
            }
        }
        return false;
    }

    function getPlaybackRegionsState(track) {
        if (!isExtraTrackRef(track)) return null;
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(track.slot) : null;
        if (!tr) return null;
        if (!tr.playbackRegions) {
            if (tr.region && tr.region.active) {
                const fullDur =
                    typeof extraTrackContentDurationSec === 'function'
                        ? extraTrackContentDurationSec(track.slot)
                        : 0;
                const out =
                    Number.isFinite(tr.region.sourceOutSec) && tr.region.sourceOutSec > 0
                        ? tr.region.sourceOutSec
                        : fullDur;
                tr.playbackRegions = {
                    active: true,
                    headPadSec: 0,
                    segments: [
                        normalizeSegment(tr.region.sourceInSec, out, fullDur),
                    ],
                };
                delete tr.region;
            } else {
                tr.playbackRegions = { active: false, segments: [], headPadSec: 0 };
            }
        }
        if (!Number.isFinite(tr.playbackRegions.headPadSec)) {
            tr.playbackRegions.headPadSec = 0;
        }
        return tr.playbackRegions;
    }

    function getHeadPadSec(track) {
        const state = getPlaybackRegionsState(track);
        if (!state) return 0;
        return Math.max(0, Number(state.headPadSec) || 0);
    }

    /** リージョン左端（In ハンドル） */
    function getSegmentRegionTimelineIn(track, segmentIndex) {
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            if (state && Number.isFinite(state.regionTimelineInSec)) {
                const regionIn = Math.max(0, state.regionTimelineInSec);
                return regionIn < anchor - 0.00001 ? anchor : regionIn;
            }
            return anchor;
        }
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (raw && Number.isFinite(raw.regionTimelineInSec)) {
            const regionIn = Math.max(0, raw.regionTimelineInSec);
            return regionIn < anchor - 0.00001 ? anchor : regionIn;
        }
        return anchor;
    }

    /** アンカーと regionTimelineInSec の差（ドラッグ移動で維持する In オフセット） */
    function getSegmentRegionInPadSec(track, segmentIndex) {
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        let stored = null;
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            if (state && Number.isFinite(state.regionTimelineInSec)) {
                stored = state.regionTimelineInSec;
            }
        } else {
            const raw = getRawSegmentEntry(track, segmentIndex);
            if (raw && Number.isFinite(raw.regionTimelineInSec)) {
                stored = raw.regionTimelineInSec;
            }
        }
        if (stored == null) return 0;
        return Math.max(0, stored - anchor);
    }

    function applySegmentAnchorAndRegionInForDrag(
        track,
        segmentIndex,
        desiredAnchor,
        desiredRegionIn,
        t0,
        inPad,
    ) {
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return;
        state.segments[segmentIndex].timelineStartSec = desiredAnchor;
        if (segmentIndex === 0) {
            if (inPad > 0.00001) {
                state.regionTimelineInSec = desiredRegionIn;
            } else {
                delete state.regionTimelineInSec;
                delete state.regionLeadPadSec;
                state.headPadSec = Math.max(0, desiredAnchor - t0);
            }
            return;
        }
        const raw = state.segments[segmentIndex];
        if (inPad > 0.00001) {
            raw.regionTimelineInSec = desiredRegionIn;
        } else {
            delete raw.regionTimelineInSec;
            delete raw.regionLeadPadSec;
        }
    }

    function getSegmentRegionLeadPadSec(track, segmentIndex) {
        let lead = 0;
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            lead = Math.max(0, Number(state && state.regionLeadPadSec) || 0);
        } else {
            const raw = getRawSegmentEntry(track, segmentIndex);
            lead = Math.max(0, Number(raw && raw.regionLeadPadSec) || 0);
        }
        if (lead <= 0.00001) return 0;
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        if (regionIn > anchor + 0.00001) {
            return 0;
        }
        return lead;
    }

    /** 再生上の音声開始（リージョン内先頭ギャップの後） */
    function getSegmentPlaybackTimelineStart(track, segmentIndex) {
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        if (regionIn > anchor + 0.00001) {
            return regionIn;
        }
        const leadPad = getSegmentRegionLeadPadSec(track, segmentIndex);
        if (leadPad > 0.00001) {
            return regionIn + leadPad;
        }
        return anchor;
    }

    /** タイムライン位置をクリップ内ソース秒へ（アンカー基準） */
    function segmentSourceSecFromTransport(track, segmentIndex, transportSec) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return 0;
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        const t = Number(transportSec);
        const span = Math.max(0, seg.sourceOutSec - seg.sourceInSec);
        const local = Math.max(0, Math.min(span, t - anchor));
        return seg.sourceInSec + local;
    }

    function setSegmentRegionLeadPadSec(track, segmentIndex, sec) {
        const lead = Math.max(0, Number(sec) || 0);
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            if (!state) return;
            if (lead <= 0.00001) {
                delete state.regionLeadPadSec;
            } else {
                state.regionLeadPadSec = lead;
            }
            return;
        }
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return;
        const raw = state.segments[segmentIndex];
        if (lead <= 0.00001) {
            delete raw.regionLeadPadSec;
        } else {
            raw.regionLeadPadSec = lead;
        }
    }

    function setSegmentRegionTimelineIn(track, segmentIndex, regionIn) {
        const audioEnd = getSegmentTimelineEnd(track, segmentIndex);
        const maxIn = audioEnd - PLAYBACK_REGION_MIN_SEC;
        const clamped = Math.max(0, Math.min(Number(regionIn) || 0, maxIn));
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            if (!state) return;
            if (Math.abs(clamped - anchor) < 0.00001) {
                delete state.regionTimelineInSec;
            } else {
                state.regionTimelineInSec = clamped;
            }
            return;
        }
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return;
        const raw = state.segments[segmentIndex];
        if (Math.abs(clamped - anchor) < 0.00001) {
            delete raw.regionTimelineInSec;
        } else {
            raw.regionTimelineInSec = clamped;
        }
    }

    function extendSegmentAnchorLeft(track, segmentIndex, regionIn, audioEnd, t0) {
        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        const seg = segments[segmentIndex];
        const state = getPlaybackRegionsState(track);
        if (!seg || !state) return;

        const newAnchor = regionIn;
        const newDur = audioEnd - newAnchor;
        seg.sourceInSec = Math.max(0, seg.sourceOutSec - newDur);
        if (segmentIndex === 0) {
            state.headPadSec = Math.max(0, newAnchor - t0);
            delete state.regionTimelineInSec;
            delete state.regionLeadPadSec;
        } else {
            seg.timelineStartSec = newAnchor;
            delete seg.regionTimelineInSec;
            delete seg.regionLeadPadSec;
        }
        applySegmentsToState(
            track,
            segments.map((s) =>
                normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
            ),
            { silent: true, skipUndo: true },
        );
    }

    function applySegmentRegionInFromTransport(track, segmentIndex, transportSec) {
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        const audioEnd = getSegmentTimelineEnd(track, segmentIndex);
        const t0 = getTrackTimelineStartSec(track);
        let regionIn = Math.max(
            0,
            Math.min(audioEnd - PLAYBACK_REGION_MIN_SEC, transportSec),
        );
        if (segmentIndex === 0) {
            regionIn = Math.max(t0, regionIn);
        }
        regionIn = clampSegmentTimelineStart(track, segmentIndex, regionIn);

        const maxPadIn = audioEnd - PLAYBACK_REGION_MIN_SEC;

        if (regionIn < anchor - 0.00001) {
            if (
                segmentIndex > 0 &&
                isSegmentBoundaryJoined(track, segmentIndex - 1)
            ) {
                setSplitBoundaryFromTransport(track, segmentIndex - 1, regionIn);
                return;
            }
            extendSegmentAnchorLeft(track, segmentIndex, regionIn, audioEnd, t0);
            return;
        }

        if (regionIn <= anchor + 0.00001) {
            setSegmentRegionTimelineIn(track, segmentIndex, anchor);
            setSegmentRegionLeadPadSec(track, segmentIndex, 0);
            updateTrackRegionOverlays(track);
            redrawAfterRegionChange(track.slot);
            return;
        }

        if (regionIn <= maxPadIn + 0.00001) {
            setSegmentRegionTimelineIn(track, segmentIndex, regionIn);
            setSegmentRegionLeadPadSec(track, segmentIndex, 0);
            updateTrackRegionOverlays(track);
            redrawAfterRegionChange(track.slot);
            return;
        }

        extendSegmentAnchorLeft(track, segmentIndex, regionIn, audioEnd, t0);
    }

    function getTrackSourceDurationSec(track) {
        if (!isExtraTrackRef(track)) return 0;
        if (typeof getExtraTrackMaxClipDurationSec === 'function') {
            const d = getExtraTrackMaxClipDurationSec(track.slot);
            if (d > 0) return d;
        }
        if (typeof extraTrackBufferDuration === 'function') {
            const d = extraTrackBufferDuration(track.slot);
            if (d > 0) return d;
        }
        return 0;
    }

    /** マスター尺用: 各セグメントがクリップ長まで伸ばせるタイムライン終端 */
    function getExtraTrackMaxTimelineEndSec(track) {
        if (!isExtraTrackRef(track)) return 0;
        const t0 = getTrackTimelineStartSec(track);
        const segments = getTrackSegments(track);
        if (!segments.length) {
            const buf = getTrackSourceDurationSec(track);
            return t0 + (buf > 0 ? buf : 0);
        }
        let end = t0;
        for (let i = 0; i < segments.length; i++) {
            end = Math.max(end, getSegmentTimelineEnd(track, i));
            end = Math.max(end, maxSegmentTimelineEndSec(track, i));
        }
        return end;
    }

    function getTrackTimelineStartSec(track) {
        if (!isExtraTrackRef(track)) return 0;
        if (typeof getExtraTrackTimelineStartSec === 'function') {
            return getExtraTrackTimelineStartSec(track.slot);
        }
        return 0;
    }

    function getPrimaryClipIdForTrack(track) {
        if (!isExtraTrackRef(track)) return 'main';
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(track.slot) : null;
        if (tr && tr.clips && tr.clips.length && tr.clips[0].id) {
            return tr.clips[0].id;
        }
        return 'main';
    }

    function ensureDefaultTrackRegion(track, opt) {
        if (!isExtraTrackRef(track)) return false;
        const state = getPlaybackRegionsState(track);
        if (!state || (state.active && state.segments && state.segments.length)) {
            return false;
        }
        const fullDur = getTrackSourceDurationSec(track);
        if (!fullDur) return false;
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(track.slot) : null;
        const segments = [];
        if (tr && tr.clips && tr.clips.length > 1) {
            for (const c of tr.clips) {
                if (!c.buffer || c.buffer.duration <= 0) continue;
                segments.push({
                    id: newRegionId(),
                    clipId: c.id || 'main',
                    sourceInSec: 0,
                    sourceOutSec: c.buffer.duration,
                });
            }
        }
        if (!segments.length) {
            segments.push({
                id: newRegionId(),
                clipId: getPrimaryClipIdForTrack(track),
                sourceInSec: 0,
                sourceOutSec: fullDur,
            });
        }
        state.segments = segments;
        state.active = true;
        state.headPadSec = Math.max(0, Number(state.headPadSec) || 0);
        if (!(opt && opt.skipOverlay) && typeof updateTrackRegionOverlays === 'function') {
            updateTrackRegionOverlays(track);
        }
        if (!(opt && opt.silent) && typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        return true;
    }

    function getTrackSegments(track) {
        const state = getPlaybackRegionsState(track);
        if (!state) return [];
        if (!state.active || !state.segments || !state.segments.length) {
            ensureDefaultTrackRegion(track, { skipOverlay: true, silent: true });
        }
        if (!state.active || !state.segments || !state.segments.length) {
            return [];
        }
        const normalized = [];
        for (let i = 0; i < state.segments.length; i++) {
            const raw = state.segments[i];
            const fullDur = getSegmentSourceDurationSec(track, raw);
            if (!fullDur) return [];
            normalized.push(normalizeSegmentEntry(raw, track, fullDur));
        }
        return normalized;
    }

    function getSegmentCount(track) {
        return getTrackSegments(track).length;
    }

    function getRawSegmentEntry(track, segmentIndex) {
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return null;
        return state.segments[segmentIndex];
    }

    function getTrackRegionBounds(track) {
        const fullDur = getTrackSourceDurationSec(track);
        const segments = getTrackSegments(track);
        if (!fullDur || !segments.length) {
            return { sourceInSec: 0, sourceOutSec: 0, fullDurSec: fullDur, active: false };
        }
        return {
            sourceInSec: segments[0].sourceInSec,
            sourceOutSec: segments[segments.length - 1].sourceOutSec,
            fullDurSec: fullDur,
            active: true,
        };
    }

    function isTrackRegionActive(track) {
        return getTrackSegments(track).length > 0;
    }

    function isPlaybackRegionActive() {
        const n =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 3;
        for (let i = 0; i < n; i++) {
            if (isTrackRegionActive({ type: 'extra', slot: i })) return true;
        }
        return false;
    }

    function getCompactSegmentTimelineStart(track, segmentIndex) {
        const t0 = getTrackTimelineStartSec(track);
        const segments = getTrackSegments(track);
        let offset = getHeadPadSec(track);
        for (let i = 0; i < segmentIndex && i < segments.length; i++) {
            offset += segments[i].sourceOutSec - segments[i].sourceInSec;
        }
        return t0 + offset;
    }

    function getSegmentTimelineStart(track, segmentIndex) {
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (raw && Number.isFinite(raw.timelineStartSec)) {
            return raw.timelineStartSec;
        }
        return getCompactSegmentTimelineStart(track, segmentIndex);
    }

    function getSegmentTimelineEnd(track, segmentIndex) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return getTrackTimelineStartSec(track);
        return getSegmentTimelineStart(track, segmentIndex) + (seg.sourceOutSec - seg.sourceInSec);
    }

    function isSegmentBoundaryJoined(track, boundaryIndex) {
        const segments = getTrackSegments(track);
        if (boundaryIndex < 0 || boundaryIndex >= segments.length - 1) return false;
        const leftEnd = getSegmentTimelineEnd(track, boundaryIndex);
        const rightStart = getSegmentTimelineStart(track, boundaryIndex + 1);
        return Math.abs(leftEnd - rightStart) <= SEGMENT_BOUNDARY_JOIN_EPS_SEC;
    }

    /** タイムライン結合かつクリップ内ソースが連続（分割直後・B結合可能な境界） */
    function isSegmentSourceContinuousAtBoundary(track, boundaryIndex) {
        if (!isSegmentBoundaryJoined(track, boundaryIndex)) return false;
        const segments = getTrackSegments(track);
        const left = segments[boundaryIndex];
        const right = segments[boundaryIndex + 1];
        if (!left || !right) return false;
        const leftClip =
            left.clipId || getSegmentClipId(track, boundaryIndex);
        const rightClip =
            right.clipId || getSegmentClipId(track, boundaryIndex + 1);
        if (leftClip !== rightClip) return false;
        return (
            Math.abs(
                (Number(left.sourceOutSec) || 0) - (Number(right.sourceInSec) || 0),
            ) <= SEGMENT_BOUNDARY_JOIN_EPS_SEC
        );
    }

    /**
     * 連続結合境界: 入側を左の BufferSource クロックに同期して開始する計画
     * @returns {{ whenCtx: number, bufferOff: number, remain: number, transportAnchor: number } | null}
     */
    function planIncomingSegmentStartAtJoinedBoundary(track, segmentIndex, ctx, opt) {
        if (!ctx || segmentIndex < 1) return null;
        if (!isSegmentSourceContinuousAtBoundary(track, segmentIndex - 1)) {
            return null;
        }
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return null;
        const boundaryT = getSegmentTimelineStart(track, segmentIndex);
        const fadeTransportSec = boundaryT - JOINED_BOUNDARY_CROSSFADE_SEC;
        const mapT =
            opt && Number.isFinite(opt.mapTransportSec)
                ? opt.mapTransportSec
                : fadeTransportSec;
        const probeT = Math.max(fadeTransportSec, mapT);
        const fromLeft = segmentSourceSecFromTransport(
            track,
            segmentIndex - 1,
            probeT,
        );
        const bufferOff = Math.max(
            seg.sourceInSec,
            Math.min(seg.sourceOutSec, fromLeft),
        );
        const remain = Math.max(0, seg.sourceOutSec - bufferOff);
        if (remain <= 0.002) return null;
        let whenCtx = ctx.currentTime + 0.0005;
        const leftEntry = opt && opt.leftEntry ? opt.leftEntry : null;
        if (
            leftEntry &&
            leftEntry.src &&
            Number.isFinite(leftEntry.playbackAnchorCtxTime) &&
            Number.isFinite(leftEntry.bufferOff)
        ) {
            const fadeBuf = segmentSourceSecFromTransport(
                track,
                segmentIndex - 1,
                fadeTransportSec,
            );
            whenCtx =
                leftEntry.playbackAnchorCtxTime +
                Math.max(0, fadeBuf - leftEntry.bufferOff);
        } else {
            whenCtx = ctx.currentTime + Math.max(0.0005, fadeTransportSec - mapT);
        }
        if (whenCtx < ctx.currentTime) {
            whenCtx = ctx.currentTime + 0.0005;
        }
        return {
            whenCtx,
            bufferOff,
            remain,
            transportAnchor: probeT,
        };
    }

    function shouldShowSegmentInHandle(track, segmentIndex) {
        if (segmentIndex === 0) return true;
        return !isSegmentBoundaryJoined(track, segmentIndex - 1);
    }

    function shouldShowSegmentOutHandle(track, segmentIndex) {
        const segments = getTrackSegments(track);
        if (segmentIndex >= segments.length - 1) return true;
        return !isSegmentBoundaryJoined(track, segmentIndex);
    }

    function getTrackTimelineEndSec(track) {
        const segments = getTrackSegments(track);
        if (!segments.length) {
            const fullDur = getTrackSourceDurationSec(track);
            return getTrackTimelineStartSec(track) + (fullDur || 0);
        }
        let end = getTrackTimelineStartSec(track);
        for (let i = 0; i < segments.length; i++) {
            end = Math.max(end, getSegmentTimelineEnd(track, i));
        }
        return end;
    }

    function mapTransportToSegment(track, transportSec) {
        const hits = mapAllSegmentsAtTransport(track, transportSec);
        return hits.length ? hits[0] : null;
    }

    function mapAllSegmentsAtTransport(track, transportSec, opt) {
        const segments = getTrackSegments(track);
        if (!segments.length) return [];
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return [];
        const forPlayback = !!(opt && opt.forPlayback);
        const hits = [];
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const regionIn = getSegmentRegionTimelineIn(track, i);
            const playbackStart = getSegmentPlaybackTimelineStart(track, i);
            const absEnd = getSegmentTimelineEnd(track, i);
            const absStart = forPlayback ? playbackStart : regionIn;

            const joinedNext =
                forPlayback &&
                i < segments.length - 1 &&
                isSegmentBoundaryJoined(track, i);
            const joinedPrev =
                forPlayback && i > 0 && isSegmentBoundaryJoined(track, i - 1);
            const boundaryNext = joinedNext ? absEnd : null;
            const boundaryPrev = joinedPrev ? getSegmentTimelineStart(track, i) : null;
            const inHandoffFromPrev =
                joinedPrev &&
                boundaryPrev != null &&
                t >= boundaryPrev - JOINED_BOUNDARY_CROSSFADE_SEC &&
                t < boundaryPrev + 0.00001;
            const inHandoffToNext =
                joinedNext &&
                boundaryNext != null &&
                t >= boundaryNext - JOINED_BOUNDARY_CROSSFADE_SEC &&
                t < boundaryNext + 0.00001;

            if (t < regionIn - 0.0005) continue;
            if (forPlayback) {
                if (t < playbackStart - 0.0005 && !inHandoffFromPrev) continue;
                if (t >= absEnd - 0.0005 && !inHandoffToNext) continue;
            } else if (t >= absEnd - 0.002) {
                continue;
            }

            let sourceSec;
            if (
                forPlayback &&
                inHandoffFromPrev &&
                i > 0 &&
                isSegmentSourceContinuousAtBoundary(track, i - 1)
            ) {
                const fromLeft = segmentSourceSecFromTransport(track, i - 1, t);
                sourceSec = Math.max(
                    seg.sourceInSec,
                    Math.min(seg.sourceOutSec, fromLeft),
                );
            } else if (forPlayback && inHandoffFromPrev && t < playbackStart + 0.00001) {
                const fadeStart = boundaryPrev - JOINED_BOUNDARY_CROSSFADE_SEC;
                sourceSec = seg.sourceInSec + Math.max(0, t - fadeStart);
            } else if (t < playbackStart - 0.0005) {
                sourceSec = seg.sourceInSec;
            } else {
                sourceSec = segmentSourceSecFromTransport(track, i, t);
            }

            let timelineStart = absStart;
            let timelineEnd = absEnd;
            if (forPlayback && joinedPrev && boundaryPrev != null) {
                timelineStart = Math.min(
                    timelineStart,
                    boundaryPrev - JOINED_BOUNDARY_CROSSFADE_SEC,
                );
                timelineEnd = boundaryPrev;
            } else if (forPlayback && joinedNext && boundaryNext != null) {
                timelineEnd = boundaryNext;
            }

            hits.push({
                slot: track.slot,
                segmentIndex: i,
                segmentId: seg.id,
                clipId: seg.clipId || getSegmentClipId(track, i),
                sourceSec,
                bufferOff: sourceSec,
                remain: Math.max(0, seg.sourceOutSec - sourceSec),
                timelineStart,
                timelineEnd,
                key: track.slot + ':' + (seg.id || 'i' + i),
            });
        }
        return hits;
    }

    function mapTransportToSegmentForPlayback(track, transportSec) {
        const hits = mapAllSegmentsAtTransport(track, transportSec, { forPlayback: true });
        return hits.length ? hits[0] : null;
    }

    function refreshSegmentHitAtTransport(track, hit, transportSec) {
        const fresh = mapAllSegmentsAtTransport(track, transportSec, {
            forPlayback: true,
        }).find((h) => h.segmentIndex === hit.segmentIndex);
        return fresh || null;
    }

    function getActiveExtraSegmentsAtTransport(transportSec) {
        const all = [];
        const seen = new Set();
        const n =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 3;
        let t = Number(transportSec);
        if (!Number.isFinite(t)) return all;
        const scheduleAhead =
            typeof window.EXTRA_AUDIO_SCHEDULE_AHEAD_SEC === 'number'
                ? window.EXTRA_AUDIO_SCHEDULE_AHEAD_SEC
                : 0.02;
        /** 先読みはスケジュール余裕のみ（フェード幅ぶん早く拾うと bufferOff が未来のままになる） */
        const lookahead = scheduleAhead + 0.01;
        const probes = [t, t + lookahead];
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            if (!isTrackRegionActive(track)) continue;
            for (let p = 0; p < probes.length; p++) {
                const hits = mapAllSegmentsAtTransport(track, probes[p], {
                    forPlayback: true,
                });
                for (let i = 0; i < hits.length; i++) {
                    const hit = hits[i];
                    if (seen.has(hit.key)) continue;
                    const refreshed = refreshSegmentHitAtTransport(track, hit, t);
                    if (!refreshed) continue;
                    seen.add(hit.key);
                    all.push(refreshed);
                }
            }
        }
        return all;
    }

    function transportSecToSegmentSourceSec(track, segmentIndex, transportSec) {
        return segmentSourceSecFromTransport(track, segmentIndex, transportSec);
    }

    function isTrackTransportAudible(track, transportSec) {
        return !!mapTransportToSegment(track, transportSec);
    }

    function slicePeaksForRegion(peaks, fullDurSec, sourceInSec, sourceOutSec) {
        if (!peaks || !peaks.length || !fullDurSec) return peaks;
        const inS = Math.max(0, Number(sourceInSec) || 0);
        const outS = Math.min(fullDurSec, Number(sourceOutSec) || fullDurSec);
        if (outS <= inS + 0.0005) return [];
        const i0 = Math.floor((inS / fullDurSec) * peaks.length);
        const i1 = Math.ceil((outS / fullDurSec) * peaks.length);
        return peaks.slice(Math.max(0, i0), Math.min(peaks.length, Math.max(i0 + 1, i1)));
    }

    function crossfadeOutInIndicesForTrack(active, i, j) {
        const a = active[i];
        const b = active[j];
        if (a.timelineStart < b.timelineStart - 0.0005) {
            return { out: i, in: j };
        }
        if (b.timelineStart < a.timelineStart - 0.0005) {
            return { out: j, in: i };
        }
        if (a.timelineEnd < b.timelineEnd - 0.0005) {
            return { out: i, in: j };
        }
        if (b.timelineEnd < a.timelineEnd - 0.0005) {
            return { out: j, in: i };
        }
        return { out: i, in: j };
    }

    const MIN_CROSSFADE_OVERLAP_SEC = 0.005;

    /** 再生ミックスと同じ等パワー・重なりゲイン（波形振幅表示用） */
    function computeSegmentCrossfadeVisualGain(track, segmentIndex, transportSec) {
        const hits = mapAllSegmentsAtTransport(track, transportSec, {
            forPlayback: true,
        });
        if (hits.length <= 1) return 1;
        const pos = hits.findIndex((h) => h.segmentIndex === segmentIndex);
        if (pos < 0) return 1;
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return 1;
        const weights = hits.map(() => 1);
        for (let i = 0; i < hits.length; i++) {
            for (let j = i + 1; j < hits.length; j++) {
                const oStart = Math.max(hits[i].timelineStart, hits[j].timelineStart);
                const oEnd = Math.min(hits[i].timelineEnd, hits[j].timelineEnd);
                if (
                    oEnd - oStart < MIN_CROSSFADE_OVERLAP_SEC ||
                    t < oStart ||
                    t > oEnd
                ) {
                    continue;
                }
                const p = (t - oStart) / (oEnd - oStart);
                const gOut = Math.cos(p * Math.PI * 0.5);
                const gIn = Math.sin(p * Math.PI * 0.5);
                const { out, in: inIdx } = crossfadeOutInIndicesForTrack(hits, i, j);
                weights[out] *= gOut;
                weights[inIdx] *= gIn;
            }
        }
        let sumSq = 0;
        for (let i = 0; i < weights.length; i++) sumSq += weights[i] * weights[i];
        const norm = sumSq > 0 ? 1 / Math.sqrt(sumSq) : 1;
        return Math.max(0, weights[pos] * norm);
    }

    function getSegmentPeaksForDraw(slot, clipId) {
        if (typeof getExtraTrackClipPeaks === 'function') {
            const cp = getExtraTrackClipPeaks(slot, clipId);
            if (cp && cp.length) return cp;
        }
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        return tr && tr.peaks ? tr.peaks : null;
    }

    function viewportPeaksCoverMasterTime(vp, masterSec) {
        if (!vp) return false;
        if (masterSec + 1e-9 < vp.masterStartSec || masterSec - 1e-9 > vp.masterEndSec) {
            return false;
        }
        if (!vp.segments || !vp.segments.length) {
            return !!(vp.peaks && vp.peaks.length);
        }
        for (let i = 0; i < vp.segments.length; i++) {
            const s = vp.segments[i];
            if (
                masterSec + 1e-9 >= s.masterStartSec &&
                masterSec - 1e-9 <= s.masterEndSec &&
                s.peaks &&
                s.peaks.length
            ) {
                return true;
            }
        }
        return false;
    }

    function drawRegionViewportPeaks(ctx, wCss, hCss, master, vp, grad, track) {
        if (!vp || !vp.segments || !vp.segments.length || !(master > 0) || !track) {
            return;
        }
        const mid = hCss * 0.5;
        const bg =
            typeof TIMELINE_LANE_TRACK_BG !== 'undefined'
                ? TIMELINE_LANE_TRACK_BG
                : '#161820';
        const vpX0 = (vp.masterStartSec / master) * wCss;
        const vpX1 = (vp.masterEndSec / master) * wCss;
        const vpW = vpX1 - vpX0;
        if (!(vpW > 0.5)) return;

        ctx.fillStyle = bg;
        ctx.fillRect(vpX0, 0, vpW, hCss);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(vpX0, mid);
        ctx.lineTo(vpX1, mid);
        ctx.stroke();

        ctx.fillStyle = grad || '#ffffff';
        for (let si = 0; si < vp.segments.length; si++) {
            const s = vp.segments[si];
            if (!s.peaks || !s.peaks.length) continue;
            const segDur = s.masterEndSec - s.masterStartSec;
            if (!(segDur > 1e-9)) continue;
            const x0 = (s.masterStartSec / master) * wCss;
            const x1 = (s.masterEndSec / master) * wCss;
            const drawW = x1 - x0;
            if (!(drawW > 0.5)) continue;
            const barW = drawW / s.peaks.length;
            const segIdx =
                typeof s.segmentIndex === 'number' && s.segmentIndex >= 0 ? s.segmentIndex : si;
            for (let p = 0; p < s.peaks.length; p++) {
                const pk = s.peaks[p];
                const x = x0 + p * barW;
                const barTransport =
                    s.masterStartSec + ((p + 0.5) / s.peaks.length) * segDur;
                const gain =
                    computeSegmentCrossfadeVisualGain(track, segIdx, barTransport) *
                    getSegmentGainLinear(track, segIdx);
                const top = mid - Math.max(0.5, pk.max * gain * (mid - 2));
                const bot = mid - Math.min(-0.5, pk.min * gain * (mid - 2));
                ctx.fillRect(x, top, Math.max(1, barW + 0.5), Math.max(1, bot - top));
            }
        }
    }

    function rebuildExtraTrackRegionViewportPeaks(slot, spec) {
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        if (!tr) return;
        tr.viewportPeaks = null;
        if (!spec) return;

        const track = { type: 'extra', slot };
        const viewportDur = spec.masterEndSec - spec.masterStartSec;
        if (!(viewportDur > 1e-9)) return;
        if (typeof peaksFromBufferRange !== 'function') return;

        const segments = getTrackSegments(track);
        if (!segments.length) {
            const t0Track = getTrackTimelineStartSec(track);
            const fullDur = getTrackSourceDurationSec(track);
            if (!fullDur || !tr.buffer) return;
            const trackEnd = t0Track + fullDur;
            const t0 = Math.max(t0Track, spec.masterStartSec);
            const t1 = Math.min(trackEnd, spec.masterEndSec);
            if (t1 <= t0 + 1e-9) return;
            const srcStart = t0 - t0Track;
            const srcEnd = t1 - t0Track;
            const bars = Math.max(1, Math.round(spec.barCount * ((t1 - t0) / viewportDur)));
            const peaks = peaksFromBufferRange(tr.buffer, srcStart, srcEnd, bars);
            if (!peaks.length) return;
            tr.viewportPeaks = {
                masterStartSec: spec.masterStartSec,
                masterEndSec: spec.masterEndSec,
                segments: [{ masterStartSec: t0, masterEndSec: t1, peaks }],
            };
            return;
        }

        const outSegs = [];
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const segT0 = getSegmentTimelineStart(track, i);
            const segEnd = getSegmentTimelineEnd(track, i);
            let t0 = Math.max(segT0, spec.masterStartSec);
            let t1 = Math.min(segEnd, spec.masterEndSec);
            if (t1 <= t0 + 1e-9) continue;
            const playbackStart = getSegmentPlaybackTimelineStart(track, i);
            t0 = Math.max(t0, playbackStart);
            if (t1 <= t0 + 1e-9) continue;

            const srcStart = segmentSourceSecFromTransport(track, i, t0);
            const srcEnd = segmentSourceSecFromTransport(track, i, t1);
            const clipId = seg.clipId || getSegmentClipId(track, i);
            let buf = tr.buffer;
            if (typeof getExtraTrackClipBuffer === 'function') {
                buf = getExtraTrackClipBuffer(tr, clipId) || buf;
            }
            if (!buf) continue;

            const bars = Math.max(1, Math.round(spec.barCount * ((t1 - t0) / viewportDur)));
            const peaks = peaksFromBufferRange(buf, srcStart, srcEnd, bars);
            if (!peaks.length) continue;
            outSegs.push({ masterStartSec: t0, masterEndSec: t1, peaks, segmentIndex: i });
        }

        if (outSegs.length) {
            tr.viewportPeaks = {
                masterStartSec: spec.masterStartSec,
                masterEndSec: spec.masterEndSec,
                segments: outSegs,
            };
        }
    }

    function drawExtraTrackWaveformRegions(ctx, wCss, hCss, slot, grad) {
        const track = { type: 'extra', slot };
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        const vp = tr ? tr.viewportPeaks : null;
        const t0 = getTrackTimelineStartSec(track);
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
        for (let i = 0; i < segments.length; i++) {
            const regionIn = getSegmentRegionTimelineIn(track, i);
            const playbackStart = getSegmentPlaybackTimelineStart(track, i);
            const seg = segments[i];
            const clipId = seg.clipId || getSegmentClipId(track, i);
            const fullDur = getSegmentSourceDurationSec(track, seg);
            const peaks = getSegmentPeaksForDraw(slot, clipId);
            if (!peaks || !peaks.length || !fullDur) continue;
            const segPeaks = slicePeaksForRegion(
                peaks,
                fullDur,
                seg.sourceInSec,
                seg.sourceOutSec,
            );
            if (!segPeaks || !segPeaks.length) continue;
            const contentDur = seg.sourceOutSec - seg.sourceInSec;
            const segT0 = getSegmentTimelineStart(track, i);
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
            const waveformHideBefore =
                regionIn > segT0 + 0.00001 ? regionIn : playbackStart;
            for (let p = 0; p < segPeaks.length; p++) {
                const pk = segPeaks[p];
                const x = startX + p * barW;
                const barTransport =
                    segT0 + ((p + 0.5) / segPeaks.length) * contentDur;
                if (barTransport < waveformHideBefore - 0.0005) {
                    continue;
                }
                if (viewportPeaksCoverMasterTime(vp, barTransport)) {
                    continue;
                }
                const gain =
                    computeSegmentCrossfadeVisualGain(track, i, barTransport) *
                    getSegmentGainLinear(track, i);
                const top = mid - Math.max(0.5, pk.max * gain * (mid - 2));
                const bot = mid - Math.min(-0.5, pk.min * gain * (mid - 2));
                ctx.fillRect(x, top, Math.max(1, barW + 0.5), Math.max(1, bot - top));
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
        state.segments = segments;
        state.active = true;

        updateTrackRegionOverlays(track);
        redrawAfterRegionChange(track.slot);

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
            const fullDur = getSegmentSourceDurationSec(track, seg);
            if (!fullDur) return false;
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
        syncLaneFileNameForTrack(track);
        if (was) {
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
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 3;
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
        if (typeof waveformExtraLaneSlotFromClientY !== 'function') return -1;
        let clientY = null;
        if (typeof getWaveformLanesPointerClientY === 'function') {
            clientY = getWaveformLanesPointerClientY();
        }
        if (clientY == null && typeof getWaveformPointerClientY === 'function') {
            clientY = getWaveformPointerClientY();
        }
        if (clientY != null) {
            if (suppressInvalidRegionOpNoticeForVideoAudio()) {
                return -1;
            }
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
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 3;
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
        const regionEl = findPlaybackRegionElAtPointer(clientX, clientY);
        if (regionEl && Number.isFinite(clientX)) {
            const fromPointer = transportSecAtClientX(clientX);
            if (Number.isFinite(fromPointer)) {
                return clampRegionEditTransportSec(track, fromPointer);
            }
        }
        return clampRegionEditTransportSec(track, transportSecFromSeekbar());
    }

    function splitPlaybackRegionAtTargetSec() {
        const { clientX, clientY } = waveformPointerClientXY();
        const slot = resolveSplitTargetExtraSlot();
        if (slot < 0) {
            if (!suppressInvalidRegionOpNoticeForVideoAudio()) {
                writeLog('Playback region: hover an Ex lane (1–3), then press X');
                flashSeekHint('Region', 'Hover Ex lane', 'notice');
            }
            return false;
        }
        if (!isExtraSlotUsableForRegion(slot)) {
            writeLog('Playback region: load an extra audio track first');
            return false;
        }
        const track = { type: 'extra', slot };

        const splitTransport = getRegionSplitTargetTransportSec(track, clientX, clientY);
        const hit = mapTransportToSegment(track, splitTransport);
        let segments = getTrackSegments(track);
        let splitIndex = -1;
        let sourceSplit = 0;
        let clipId = 'main';

        if (hit) {
            sourceSplit = hit.sourceSec;
            splitIndex = hit.segmentIndex;
            clipId = hit.clipId || getSegmentClipId(track, splitIndex);
        } else if (segments.length) {
            writeLog('Playback region: split inside a region (not at edges)');
            flashSeekHint('Region', 'Split inside region', 'notice');
            return false;
        } else {
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
            sourceSplit = Math.max(
                PLAYBACK_REGION_MIN_SEC,
                Math.min(fullDur, splitTransport - t0),
            );
            segments = [{ sourceInSec: 0, sourceOutSec: fullDur, clipId }];
            splitIndex = 0;
        }

        const seg = segments[splitIndex];
        const fullDur = getSegmentSourceDurationSec(track, seg);
        if (
            sourceSplit <= seg.sourceInSec + PLAYBACK_REGION_MIN_SEC ||
            sourceSplit >= seg.sourceOutSec - PLAYBACK_REGION_MIN_SEC
        ) {
            writeLog('Playback region: split inside a region (not at edges)');
            flashSeekHint('Region', 'Split inside region', 'notice');
            return false;
        }

        const leftStart = getSegmentTimelineStart(track, splitIndex);
        const leftDur = sourceSplit - seg.sourceInSec;
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
            timelineStartSec: leftStart + leftDur,
        };
        const next = segments.slice();
        next.splice(splitIndex, 1, left, right);
        if (!setTrackSegments(track, next)) {
            writeLog('Playback region: split failed (could not apply segments)');
            flashSeekHint('Region', 'Split failed', 'notice');
            return false;
        }
        return true;
    }

    function redrawAfterRegionChange(slot) {
        if (
            typeof slot === 'number' &&
            slot >= 0 &&
            typeof drawExtraTrackWaveform === 'function'
        ) {
            drawExtraTrackWaveform(slot);
        } else if (typeof redrawAllExtraTrackWaveforms === 'function') {
            redrawAllExtraTrackWaveforms();
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

    function getTrackRegionFileName(track) {
        if (!isExtraTrackRef(track)) return '';
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(track.slot) : null;
        return tr && tr.file && tr.file.name ? tr.file.name : '';
    }

    function syncLaneFileNameForTrack(track) {
        if (!isExtraTrackRef(track)) return;
        const el = document.getElementById('extraAudioFileName' + track.slot);
        if (!el) return;
        const lane = document.getElementById('extraAudioLane' + track.slot);
        const hasRegions = isTrackRegionActive(track);
        if (lane) {
            const hadRegions = lane.classList.contains('audio-waveform-lane--has-regions');
            lane.classList.toggle('audio-waveform-lane--has-regions', hasRegions);
            if (
                hadRegions !== hasRegions &&
                typeof renderAudioWaveformMarkers === 'function'
            ) {
                renderAudioWaveformMarkers();
            }
        }
        if (hasRegions) {
            el.hidden = true;
            el.textContent = '';
            el.removeAttribute('title');
        } else {
            const name = getTrackRegionFileName(track);
            el.textContent = name;
            el.title = name;
            el.hidden = !name;
        }
    }

    function buildRegionOverlayEl(track, segmentIndex, seg, fileName) {
        const el = document.createElement('div');
        el.className = 'audio-waveform-lane__playback-region';
        el.dataset.segmentIndex = String(segmentIndex);
        if (shouldShowSegmentInHandle(track, segmentIndex)) {
            const handleIn = document.createElement('div');
            handleIn.className =
                'audio-waveform-lane__playback-region__handle audio-waveform-lane__playback-region__handle--in';
            handleIn.title = 'Region ' + (segmentIndex + 1) + ' In';
            el.appendChild(handleIn);
        }
        if (shouldShowSegmentOutHandle(track, segmentIndex)) {
            const handleOut = document.createElement('div');
            handleOut.className =
                'audio-waveform-lane__playback-region__handle audio-waveform-lane__playback-region__handle--out';
            handleOut.title = 'Region ' + (segmentIndex + 1) + ' Out';
            el.appendChild(handleOut);
        }
        const label = document.createElement('span');
        label.className = 'audio-waveform-lane__playback-region__label';
        label.textContent = fileName || 'Region ' + (segmentIndex + 1);
        label.title = fileName || '';
        el.appendChild(label);
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
        el.title = 'Split point (drag to move)';
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
        el.style.left = leftPct + '%';
        el.style.width = Math.max(0.05, rightPct - leftPct) + '%';
        el.hidden = false;
    }

    const CROSSFADE_OVERLAP_MIN_SEC = 0.25;
    const CROSSFADE_OVERLAP_MAX_SEC = 1.5;
    const CROSSFADE_OVERLAP_RATIO = 0.35;

    function crossfadeOverlapSecForSegment(seg) {
        const dur = Math.max(0, seg.sourceOutSec - seg.sourceInSec);
        return Math.min(
            CROSSFADE_OVERLAP_MAX_SEC,
            Math.max(CROSSFADE_OVERLAP_MIN_SEC, dur * CROSSFADE_OVERLAP_RATIO),
        );
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
                if (oEnd - oStart < MIN_CROSSFADE_OVERLAP_SEC) continue;
                zones.push({ startSec: oStart, endSec: oEnd });
            }
        }
        return zones;
    }

    function buildCrossfadeMarkerEl() {
        const el = document.createElement('div');
        el.className = 'audio-waveform-lane__crossfade-marker';
        el.setAttribute('aria-hidden', 'true');
        el.title = 'Crossfade';
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
        if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
            const hit = document.elementFromPoint(clientX, clientY);
            if (hit) {
                const region = hit.closest('.audio-waveform-lane__playback-region');
                if (region) {
                    const lane = region.closest('.audio-waveform-lane--extra');
                    const m =
                        lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
                    if (m && parseInt(m[1], 10) === track.slot) {
                        const idx = Number(region.dataset.segmentIndex);
                        if (Number.isFinite(idx) && idx >= 0) return idx;
                    }
                }
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
        const mapHit = mapTransportToSegment(track, transportSec);
        return mapHit ? mapHit.segmentIndex : -1;
    }

    function deleteRegionSegmentAt(track, segmentIndex) {
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
        const segmentIndex = resolveRegionSegmentIndexAtPointer(track, clientX, clientY);
        if (segmentIndex < 0) {
            writeLog('Playback region: copy — hover a region on Ex ' + (slot + 1));
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'Hover a region', 'notice');
            }
            return false;
        }
        const segment = snapshotSegmentForClipboard(track, segmentIndex);
        if (!segment) return false;
        regionSegmentClipboard = { slot, segment };
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
        const slot = regionSegmentClipboard.slot;
        if (!isExtraSlotUsableForRegion(slot)) {
            writeLog('Playback region: load extra audio before paste');
            return false;
        }
        const track = { type: 'extra', slot };
        if (!isTrackRegionActive(track)) return false;

        const clip = regionSegmentClipboard.segment;
        const segments = getTrackSegments(track);
        if (!segments.length) return false;

        const lastIndex = segments.length - 1;
        const trackEnd = getSegmentTimelineEnd(track, lastIndex);
        const snapped = snapRegionTransportSec(trackEnd, {
            exclude: { slot, segmentIndex: segments.length },
        });
        const start = Math.max(
            trackEnd,
            Number.isFinite(snapped) ? snapped : trackEnd,
        );

        const clone = {
            id: newRegionId(),
            clipId: clip.clipId,
            sourceInSec: clip.sourceInSec,
            sourceOutSec: clip.sourceOutSec,
            timelineStartSec: start,
        };
        const regionInDelta = clip.regionInSec - clip.anchorStartSec;
        if (regionInDelta > SEGMENT_BOUNDARY_JOIN_EPS_SEC) {
            clone.regionTimelineInSec = start + regionInDelta;
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

        const fullDur = getSegmentSourceDurationSec(track, clone);
        if (!fullDur) return false;
        let norm = normalizeSegmentEntry(clone, track, fullDur);
        const pastedAnchor = Number.isFinite(norm.timelineStartSec) ? norm.timelineStartSec : start;
        let pastedRegionIn = pastedAnchor;
        if (Number.isFinite(norm.regionTimelineInSec)) {
            pastedRegionIn = Math.max(pastedAnchor, norm.regionTimelineInSec);
        }
        const pastedEnd =
            pastedAnchor + Math.max(0, norm.sourceOutSec - norm.sourceInSec);
        for (let i = 0; i < segments.length; i++) {
            const otherIn = getSegmentRegionTimelineIn(track, i);
            const otherEnd = getSegmentTimelineEnd(track, i);
            if (
                intervalsOverlapTimeline(
                    pastedRegionIn,
                    pastedEnd,
                    otherIn,
                    otherEnd,
                )
            ) {
                delete norm.regionTimelineInSec;
                delete norm.regionLeadPadSec;
                norm.timelineStartSec = Math.max(trackEnd, pastedAnchor);
                norm = normalizeSegmentEntry(norm, track, fullDur);
                pastedRegionIn = Number.isFinite(norm.timelineStartSec)
                    ? norm.timelineStartSec
                    : Math.max(trackEnd, pastedAnchor);
                break;
            }
        }
        if (!regionUndoPaused) requestRegionUndoCapture();
        const normalized = segments.map((s) =>
            normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
        );
        normalized.push(norm);
        applySegmentsToState(track, normalized, {
            silent: true,
            skipUndo: true,
        });
        writeLog(
            'Ex ' +
                (slot + 1) +
                ': region pasted at track end (' +
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
        return deleteRegionSegmentAt(track, segmentIndex);
    }

    let hoveredPlaybackRegionEl = null;

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

    function hideRegionCursorLine(regionEl) {
        if (!regionEl) return;
        const line = regionEl.querySelector(
            '.audio-waveform-lane__playback-region__cursor-line',
        );
        if (line) line.hidden = true;
    }

    function updateRegionCursorLine(regionEl, clientX, clientY) {
        const line = regionEl.querySelector(
            '.audio-waveform-lane__playback-region__cursor-line',
        );
        if (!line) return;
        const r = regionEl.getBoundingClientRect();
        if (
            !Number.isFinite(clientX) ||
            !Number.isFinite(clientY) ||
            clientX < r.left ||
            clientX > r.right ||
            clientY < r.top ||
            clientY > r.bottom
        ) {
            line.hidden = true;
            return;
        }
        const x = Math.max(0, Math.min(r.width, clientX - r.left));
        line.style.left = x + 'px';
        line.hidden = false;
    }

    function setHoveredPlaybackRegion(el) {
        if (hoveredPlaybackRegionEl === el) return;
        if (hoveredPlaybackRegionEl) {
            hideRegionCursorLine(hoveredPlaybackRegionEl);
            hoveredPlaybackRegionEl.classList.remove(
                'audio-waveform-lane__playback-region--hover',
            );
        }
        hoveredPlaybackRegionEl = el || null;
        if (hoveredPlaybackRegionEl) {
            hoveredPlaybackRegionEl.classList.add(
                'audio-waveform-lane__playback-region--hover',
            );
        }
    }

    const REGION_HANDLE_HOVER_CURSOR_CLASS =
        'audio-waveform-composite__lanes--region-handle-hover';

    function updateRegionResizeHandleCursorFromPointer(clientX, clientY) {
        const lanes = getWaveformLanesEl();
        if (!lanes) return;
        const clear = () => lanes.classList.remove(REGION_HANDLE_HOVER_CURSOR_CLASS);
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
        const onHandle = isPointerOnAnyRegionResizeHandle(clientX, clientY);
        lanes.classList.toggle(REGION_HANDLE_HOVER_CURSOR_CLASS, onHandle);
    }

    function updatePlaybackRegionHoverFromPointer(clientX, clientY) {
        updateRegionResizeHandleCursorFromPointer(clientX, clientY);
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
            setHoveredPlaybackRegion(null);
            return;
        }
        const region = findPlaybackRegionElAtPointer(clientX, clientY);
        setHoveredPlaybackRegion(region);
        if (region) {
            updateRegionCursorLine(region, clientX, clientY);
        }
    }

    function updateTrackRegionOverlays(track) {
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
        if (restoreHover) {
            setHoveredPlaybackRegion(null);
        }
        container.replaceChildren();
        let segments = getTrackSegments(track);
        if (!segments.length && ensureDefaultTrackRegion(track, { skipOverlay: true, silent: true })) {
            segments = getTrackSegments(track);
        }
        if (!segments.length) {
            container.hidden = true;
            syncLaneFileNameForTrack(track);
            return;
        }
        container.hidden = false;
        const fileName = getTrackRegionFileName(track);
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const el = buildRegionOverlayEl(track, i, seg, fileName);
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
        syncLaneFileNameForTrack(track);
        if (
            restoreHover &&
            Number.isFinite(hoverClientX) &&
            Number.isFinite(hoverClientY)
        ) {
            updatePlaybackRegionHoverFromPointer(hoverClientX, hoverClientY);
        }
    }

    function updateAllPlaybackRegionOverlays() {
        const n =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 3;
        for (let i = 0; i < n; i++) {
            updateTrackRegionOverlays({ type: 'extra', slot: i });
        }
    }

    function setSplitBoundaryFromTransport(track, boundaryIndex, transportSec) {
        const state = getPlaybackRegionsState(track);
        if (!state) return;
        const segments = state.segments.map((s) => ({ ...s }));
        const left = segments[boundaryIndex];
        const right = segments[boundaryIndex + 1];
        if (!left || !right) return;

        const leftStart = getSegmentTimelineStart(track, boundaryIndex);
        const t = snapRegionTransportSec(transportSec, {
            exclude: {
                slot: track.slot,
                segmentIndices: [boundaryIndex, boundaryIndex + 1],
            },
            sameSlotOnly: track.slot,
        });
        if (!Number.isFinite(t)) return;

        const leftIn = Number(left.sourceInSec) || 0;
        const rightClipDur = getSegmentSourceDurationSec(track, right);
        const rightOut = Number.isFinite(right.sourceOutSec)
            ? right.sourceOutSec
            : rightClipDur;
        let sourceSplit = leftIn + (t - leftStart);
        const minSplit = leftIn + PLAYBACK_REGION_MIN_SEC;
        const maxSplit = rightOut - PLAYBACK_REGION_MIN_SEC;
        sourceSplit = Math.max(minSplit, Math.min(maxSplit, sourceSplit));

        left.sourceOutSec = sourceSplit;
        right.sourceInSec = sourceSplit;
        if (!Number.isFinite(left.timelineStartSec)) {
            left.timelineStartSec = leftStart;
        }
        right.timelineStartSec = leftStart + (sourceSplit - leftIn);
        delete left.regionTimelineInSec;
        delete left.regionLeadPadSec;
        delete right.regionTimelineInSec;
        delete right.regionLeadPadSec;

        state.segments = segments.map((s) =>
            normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
        );
        updateTrackRegionOverlays(track);
        redrawAfterRegionChange(track.slot);
    }

    function joinSegmentBoundaryAt(track, boundaryIndex, opt) {
        if (!isSegmentBoundaryJoined(track, boundaryIndex)) return false;
        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        const left = segments[boundaryIndex];
        const right = segments[boundaryIndex + 1];
        if (!left || !right) return false;

        const leftClip =
            left.clipId || getSegmentClipId(track, boundaryIndex);
        const rightClip =
            right.clipId || getSegmentClipId(track, boundaryIndex + 1);
        if (leftClip !== rightClip) {
            writeLog('Playback region: cannot join (different clips at boundary)');
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'Cannot join', 'notice');
            }
            return false;
        }

        const sourceJoin =
            Math.abs((Number(left.sourceOutSec) || 0) - (Number(right.sourceInSec) || 0)) <=
            SEGMENT_BOUNDARY_JOIN_EPS_SEC;
        if (!sourceJoin) {
            writeLog('Playback region: cannot join (source gap at boundary)');
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'Cannot join', 'notice');
            }
            return false;
        }

        const merged = {
            id: left.id || newRegionId(),
            clipId: leftClip,
            sourceInSec: left.sourceInSec,
            sourceOutSec: right.sourceOutSec,
            timelineStartSec: getSegmentTimelineStart(track, boundaryIndex),
        };
        if (Number.isFinite(left.regionTimelineInSec)) {
            merged.regionTimelineInSec = left.regionTimelineInSec;
        }
        if (Number.isFinite(left.regionLeadPadSec)) {
            merged.regionLeadPadSec = left.regionLeadPadSec;
        }
        if (Number.isFinite(left.gainDb)) {
            merged.gainDb = left.gainDb;
        }

        segments.splice(boundaryIndex, 2, merged);
        if (
            !setTrackSegments(track, segments, {
                silent: true,
                skipUndo: !!(opt && opt.skipUndo),
            })
        ) {
            writeLog('Playback region: join failed');
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'Join failed', 'notice');
            }
            return false;
        }

        writeLog(
            'Ex ' +
                (track.slot + 1) +
                ': regions joined at boundary ' +
                (boundaryIndex + 1) +
                ' (' +
                segments.length +
                ' left)',
        );
        if (!(opt && opt.silent) && typeof flashSeekHint === 'function') {
            flashSeekHint('Ex ' + (track.slot + 1), 'Regions joined', 'notice');
        }
        return true;
    }

    function resolveJoinedBoundaryIndexAtPointer(track, clientX, clientY) {
        if (!isExtraTrackRef(track)) return -1;
        const segments = getTrackSegments(track);
        if (segments.length < 2) return -1;

        if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
            const hit = document.elementFromPoint(clientX, clientY);
            if (hit) {
                const splitHandle = hit.closest(
                    '.audio-waveform-lane__playback-region__handle--split',
                );
                if (splitHandle) {
                    const lane = splitHandle.closest('.audio-waveform-lane--extra');
                    const m =
                        lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
                    if (m && parseInt(m[1], 10) === track.slot) {
                        const b = Number(splitHandle.dataset.boundaryIndex);
                        if (Number.isFinite(b) && isSegmentBoundaryJoined(track, b)) {
                            return b;
                        }
                    }
                }
            }
        }

        const transportSec =
            typeof transportSecFromClientX === 'function'
                ? transportSecFromClientX(clientX)
                : null;
        if (!Number.isFinite(transportSec)) return -1;

        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        let hitSec = 0.05;
        if (master > 0) {
            const lanes =
                typeof getWaveformLanesEl === 'function' ? getWaveformLanesEl() : null;
            const m =
                typeof waveformTimelineMetrics === 'function' && lanes
                    ? waveformTimelineMetrics(lanes)
                    : null;
            if (m && m.scrubW > 0) {
                hitSec = (12 / m.scrubW) * master;
            }
        }

        for (let b = 0; b < segments.length - 1; b++) {
            if (!isSegmentBoundaryJoined(track, b)) continue;
            const boundT = getSegmentTimelineEnd(track, b);
            if (Math.abs(transportSec - boundT) <= hitSec) return b;
        }
        return -1;
    }

    function setSegmentHandleFromTransport(track, segmentIndex, kind, transportSec) {
        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        if (!segments[segmentIndex]) return;
        const state = getPlaybackRegionsState(track);
        const seg = segments[segmentIndex];
        const clipDur = getSegmentSourceDurationSec(track, seg);
        const snapOpt = {
            exclude: { slot: track.slot, segmentIndex },
            sameSlotOnly: track.slot,
        };
        const t =
            kind === 'out'
                ? snapRegionOutTransportSec(transportSec, snapOpt)
                : snapRegionTransportSec(transportSec, snapOpt);
        if (!Number.isFinite(t)) return;

        if (kind === 'in') {
            applySegmentRegionInFromTransport(track, segmentIndex, t);
            return;
        } else if (kind === 'out') {
            const timelineStartSeg = getSegmentTimelineStart(track, segmentIndex);
            const maxEnd = maxSegmentTimelineEndSec(track, segmentIndex);
            let timelineEnd = Math.max(
                timelineStartSeg + PLAYBACK_REGION_MIN_SEC,
                Math.min(maxEnd, t),
            );
            timelineEnd = clampSegmentTimelineEnd(track, segmentIndex, timelineEnd);
            const dur = Math.max(PLAYBACK_REGION_MIN_SEC, timelineEnd - timelineStartSeg);
            const newOut = Math.min(
                clipDur,
                Math.max(
                    seg.sourceInSec + PLAYBACK_REGION_MIN_SEC,
                    seg.sourceInSec + dur,
                ),
            );
            if (Math.abs(newOut - seg.sourceOutSec) < 0.00001 && t > timelineStartSeg + dur + 0.01) {
                return;
            }
            seg.sourceOutSec = newOut;
        } else {
            return;
        }
        applySegmentsToState(
            track,
            segments.map((s) =>
                normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
            ),
            { silent: true, skipUndo: true },
        );
    }

    const REGION_IN_MIN_TRANSPORT_SEC = 0;

    /** リージョン In オフセットを保ったままクリップ全体をタイムライン上で平行移動（アンカー負値＝TC0より手前に食い込み可） */
    function moveSegmentClipByTimelineDelta(track, segmentIndex, delta, opt) {
        if (!Number.isFinite(delta) || Math.abs(delta) < 0.00001) return;
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return;
        const t0 = getTrackTimelineStartSec(track);
        const oldAnchor = getSegmentTimelineStart(track, segmentIndex);
        const oldRegionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const baseRegionIn =
            opt && Number.isFinite(opt.dragStartRegionIn)
                ? opt.dragStartRegionIn
                : oldRegionIn;
        const baseAnchor =
            opt && Number.isFinite(opt.dragStartAnchor)
                ? opt.dragStartAnchor
                : oldAnchor;
        const seg = state.segments[segmentIndex];
        const segDur = Math.max(
            PLAYBACK_REGION_MIN_SEC,
            seg.sourceOutSec - seg.sourceInSec,
        );
        if (baseRegionIn + delta < REGION_IN_MIN_TRANSPORT_SEC - 0.00001) {
            delta = REGION_IN_MIN_TRANSPORT_SEC - baseRegionIn;
        }
        if (Math.abs(delta) < 0.00001) return;
        let newAnchor = baseAnchor + delta;
        let newRegionIn = baseRegionIn + delta;
        const isParallelMove =
            opt &&
            Number.isFinite(opt.dragStartRegionIn) &&
            Number.isFinite(opt.dragStartAnchor);
        if (!isParallelMove) {
            const maxRegionIn = newAnchor + segDur - PLAYBACK_REGION_MIN_SEC;
            const minPlayIn = newAnchor + PLAYBACK_REGION_MIN_SEC;
            newRegionIn = Math.max(
                REGION_IN_MIN_TRANSPORT_SEC,
                minPlayIn,
                Math.min(maxRegionIn, newRegionIn),
            );
        } else {
            newRegionIn = Math.max(REGION_IN_MIN_TRANSPORT_SEC, newRegionIn);
        }
        if (
            Math.abs(newAnchor - oldAnchor) < 0.00001 &&
            Math.abs(newRegionIn - oldRegionIn) < 0.00001
        ) {
            return;
        }
        applySegmentAnchorAndRegionInForDrag(
            track,
            segmentIndex,
            newAnchor,
            newRegionIn,
            t0,
            Math.max(0, newRegionIn - newAnchor),
        );
        updateTrackRegionOverlays(track);
        redrawAfterRegionChange(track.slot);
        if (!(opt && opt.skipPersist) && typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: !!(opt && opt.forceAudio) });
        }
    }

    function setSegmentTimelineStartSec(track, segmentIndex, sec, opt) {
        if (!isExtraTrackRef(track)) return;
        if (!(opt && opt.skipUndo) && !regionUndoPaused) {
            requestRegionUndoCapture();
        }
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return;
        const dragStartRegionIn =
            opt && Number.isFinite(opt.dragStartRegionIn)
                ? opt.dragStartRegionIn
                : getSegmentRegionTimelineIn(track, segmentIndex);
        let desiredRegionIn;
        if (opt && opt.skipSnap) {
            desiredRegionIn = snapTimelineSec(Number(sec) || 0, opt);
        } else {
            desiredRegionIn = snapRegionMoveRegionInSec(sec, track, segmentIndex, {
                exclude: { slot: track.slot, segmentIndex },
                dragStartRegionIn: opt && opt.dragStartRegionIn,
                dragStartAnchor: opt && opt.dragStartAnchor,
            });
        }
        const delta = desiredRegionIn - dragStartRegionIn;
        if (dragStartRegionIn + delta < REGION_IN_MIN_TRANSPORT_SEC - 0.00001) {
            desiredRegionIn = REGION_IN_MIN_TRANSPORT_SEC;
        }
        moveSegmentClipByTimelineDelta(
            track,
            segmentIndex,
            desiredRegionIn - dragStartRegionIn,
            opt,
        );
    }

    function resolveRegionSegmentFromPointer(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;

        const slotFromY =
            typeof waveformExtraLaneSlotFromClientY === 'function'
                ? waveformExtraLaneSlotFromClientY(clientY)
                : extraLaneSlotFromClientY(clientY);
        if (slotFromY >= 0) {
            const master =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : 0;
            const t0 =
                typeof getTrackTimelineStartSec === 'function'
                    ? getTrackTimelineStartSec({ type: 'extra', slot: slotFromY })
                    : 0;
            if (master > 0 && t0 > 0.0005) {
                const lanes =
                    typeof waveformScrubTargetEl === 'function'
                        ? waveformScrubTargetEl()
                        : getWaveformLanesEl();
                const m =
                    typeof waveformTimelineMetrics === 'function'
                        ? waveformTimelineMetrics(lanes)
                        : null;
                const inner =
                    typeof waveformTimelineInnerEl === 'function'
                        ? waveformTimelineInnerEl()
                        : null;
                const ref = inner || lanes;
                if (m && m.scrubW && ref) {
                    const x0 =
                        ref.getBoundingClientRect().left + (t0 / master) * m.scrubW;
                    if (clientX < x0 - 1) return null;
                }
            }
        }

        let slot = -1;
        let segmentIndex = -1;
        let regionEl = null;

        if (slotFromY >= 0) {
            const handleHit = resolveRegionResizeHandleAtPointer(
                { type: 'extra', slot: slotFromY },
                clientX,
                clientY,
            );
            if (handleHit) return null;
        }

        const hit = document.elementFromPoint(clientX, clientY);
        if (hit) {
            if (hit.closest('.audio-waveform-lane__playback-region__handle--split')) {
                return null;
            }
            regionEl = hit.closest('.audio-waveform-lane__playback-region');
            if (regionEl) {
                const lane = regionEl.closest('.audio-waveform-lane--extra');
                const m = lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
                if (m) {
                    slot = parseInt(m[1], 10);
                    segmentIndex = Number(regionEl.dataset.segmentIndex);
                }
            }
        }

        if (slot < 0 && typeof waveformExtraLaneSlotFromClientY === 'function') {
            slot = waveformExtraLaneSlotFromClientY(clientY);
        }
        if (slot < 0) return null;

        const track = { type: 'extra', slot };
        const count = getSegmentCount(track);
        if (count < 1) return null;

        const t0 = getTrackTimelineStartSec(track);
        const clickTransportSec =
            typeof transportSecFromClientX === 'function'
                ? transportSecFromClientX(clientX)
                : null;
        if (
            Number.isFinite(clickTransportSec) &&
            Number.isFinite(t0) &&
            clickTransportSec < t0 - 0.0005
        ) {
            return null;
        }

        if (!Number.isFinite(segmentIndex) || segmentIndex < 0) {
            if (count === 1) {
                if (!isTrackRegionActive(track)) return null;
                segmentIndex = 0;
                if (!regionEl) {
                    const transportSec =
                        typeof transportSecFromClientX === 'function'
                            ? transportSecFromClientX(clientX)
                            : null;
                    if (!Number.isFinite(transportSec)) return null;
                    const start = getSegmentRegionTimelineIn(track, 0);
                    const end = getSegmentTimelineEnd(track, 0);
                    if (
                        !(
                            transportSec >= start - 0.0005 &&
                            transportSec < end - 0.002
                        )
                    ) {
                        return null;
                    }
                }
            } else {
                const transportSec =
                    typeof transportSecFromClientX === 'function'
                        ? transportSecFromClientX(clientX)
                        : null;
                if (!Number.isFinite(transportSec)) return null;
                for (let i = 0; i < count; i++) {
                    const start = getSegmentRegionTimelineIn(track, i);
                    const end = getSegmentTimelineEnd(track, i);
                    if (transportSec >= start - 0.0005 && transportSec < end - 0.002) {
                        segmentIndex = i;
                        break;
                    }
                }
                if (segmentIndex < 0) return null;
            }
        }

        return { slot, segmentIndex, track };
    }

    function resolveMixTargetFromActiveRegion(clientX, clientY) {
        void clientX;
        if (typeof resolveMixTargetFromPointer === 'function') {
            return resolveMixTargetFromPointer(clientY);
        }
        return null;
    }

    function handlePlaybackRegionMixKeydown(e) {
        if (e.ctrlKey || e.altKey || e.metaKey) return false;
        const isSoloMute = e.code === 'KeyS' || e.code === 'KeyM';
        if (!isSoloMute) return false;
        if (e.repeat) return false;
        if (isSoloMute && e.shiftKey) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }

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

        const idx =
            typeof window.resolveActiveMixLaneDisplayIndex === 'function'
                ? window.resolveActiveMixLaneDisplayIndex(clientX, clientY)
                : -1;
        if (idx < 0) return false;

        e.preventDefault();
        if (e.code === 'KeyS') {
            if (typeof window.toggleMixSoloByDisplayIndex === 'function') {
                window.toggleMixSoloByDisplayIndex(idx);
                return true;
            }
            return false;
        }
        if (e.code === 'KeyM') {
            if (typeof window.toggleMixMuteByDisplayIndex === 'function') {
                window.toggleMixMuteByDisplayIndex(idx);
                return true;
            }
            return false;
        }
        return false;
    }

    function beginRegionOutDragTimelineExtend(track, segmentIndex) {
        regionOutDragExtendSlot = -1;
        if (!track || segmentIndex < 0) return;
        const currentEnd = getSegmentTimelineEnd(track, segmentIndex);
        const maxEnd = maxSegmentTimelineEndSec(track, segmentIndex);
        if (maxEnd <= currentEnd + 0.01) return;
        regionOutDragExtendSlot = track.slot;
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
    }

    function endRegionOutDragTimelineExtend() {
        regionOutDragStartClientX = NaN;
        regionOutDragStartOutTransportSec = NaN;
        if (regionOutDragExtendSlot < 0) return;
        regionOutDragExtendSlot = -1;
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
    }

    function transportSecFromRegionOutDragDelta(clientX) {
        if (!Number.isFinite(regionOutDragStartOutTransportSec)) {
            return typeof transportSecFromClientX === 'function'
                ? transportSecFromClientX(clientX)
                : 0;
        }
        const w =
            typeof waveformTimelineScrubWidthCss === 'function'
                ? waveformTimelineScrubWidthCss()
                : 0;
        if (!w || !Number.isFinite(regionOutDragStartClientX)) {
            return regionOutDragStartOutTransportSec;
        }
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!master) return regionOutDragStartOutTransportSec;
        const deltaSec =
            ((Number(clientX) - regionOutDragStartClientX) / w) * master;
        return regionOutDragStartOutTransportSec + deltaSec;
    }

    function detachRegionHandleDragDocListeners() {
        if (regionHandleDragDocMove) {
            document.removeEventListener('pointermove', regionHandleDragDocMove);
            regionHandleDragDocMove = null;
        }
        if (regionHandleDragDocUp) {
            document.removeEventListener('pointerup', regionHandleDragDocUp);
            document.removeEventListener('pointercancel', regionHandleDragDocUp);
            regionHandleDragDocUp = null;
        }
    }

    function endRegionHandleDrag(opt) {
        if (opt && opt.cancelled && regionUndoDragSnap) {
            restoreRegionUndoSnapshot(regionUndoDragSnap);
            cancelRegionUndoGesture();
        } else {
            commitRegionUndoGesture();
        }
        setHoveredPlaybackRegion(null);
        endRegionOutDragTimelineExtend();
        regionHandleDragActive = false;
        regionHandleDragTrack = null;
        regionHandleDragSegmentIndex = -1;
        regionHandleDragBoundaryIndex = -1;
        regionHandleDragKind = null;
        regionHandleDragPointerId = null;
        detachRegionHandleDragDocListeners();
        const lanes =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        if (lanes) lanes.classList.remove('audio-waveform-composite__lanes--region-drag');
    }

    function onSplitHandlePointerDown(ev, track, boundaryIndex) {
        if (ev.button !== 0) return;
        if (typeof syncSnapSuppressionFromPointerEvent === 'function') {
            syncSnapSuppressionFromPointerEvent(ev);
        }
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof endAudioWaveformScrub === 'function') {
            endAudioWaveformScrub({ force: true });
        }
        regionHandleDragActive = true;
        regionHandleDragTrack = track;
        regionHandleDragBoundaryIndex = boundaryIndex;
        regionHandleDragKind = 'split';
        regionHandleDragPointerId = ev.pointerId;
        const lanes =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        if (lanes) lanes.classList.add('audio-waveform-composite__lanes--region-drag');
        beginRegionUndoGesture();

        regionHandleDragDocMove = (e) => {
            if (!regionHandleDragActive || e.pointerId !== regionHandleDragPointerId) return;
            if (typeof syncSnapSuppressionFromPointerEvent === 'function') {
                syncSnapSuppressionFromPointerEvent(e);
            }
            e.preventDefault();
            const transportSec =
                typeof transportSecFromClientX === 'function'
                    ? transportSecFromClientX(e.clientX)
                    : 0;
            setSplitBoundaryFromTransport(
                regionHandleDragTrack,
                regionHandleDragBoundaryIndex,
                transportSec,
            );
        };
        regionHandleDragDocUp = (e) => {
            if (!regionHandleDragActive || e.pointerId !== regionHandleDragPointerId) return;
            e.preventDefault();
            endRegionHandleDrag();
            if (typeof schedulePersistSession === 'function') schedulePersistSession();
        };
        document.addEventListener('pointermove', regionHandleDragDocMove);
        document.addEventListener('pointerup', regionHandleDragDocUp);
        document.addEventListener('pointercancel', regionHandleDragDocUp);
    }

    function onRegionHandlePointerDown(ev, track, segmentIndex, kind) {
        if (typeof syncSnapSuppressionFromPointerEvent === 'function') {
            syncSnapSuppressionFromPointerEvent(ev);
        }
        const segments = getTrackSegments(track);
        if (!segments[segmentIndex]) return;
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof endAudioWaveformScrub === 'function') {
            endAudioWaveformScrub({ force: true });
        }
        regionHandleDragActive = true;
        regionHandleDragTrack = track;
        regionHandleDragSegmentIndex = segmentIndex;
        regionHandleDragBoundaryIndex = -1;
        regionHandleDragKind = kind;
        regionHandleDragPointerId = ev.pointerId;
        const lanes =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        if (lanes) lanes.classList.add('audio-waveform-composite__lanes--region-drag');
        beginRegionUndoGesture();
        if (kind === 'out') {
            regionOutDragStartClientX = ev.clientX;
            regionOutDragStartOutTransportSec = getSegmentTimelineEnd(
                track,
                segmentIndex,
            );
            beginRegionOutDragTimelineExtend(track, segmentIndex);
        } else {
            regionOutDragStartClientX = NaN;
            regionOutDragStartOutTransportSec = NaN;
        }

        regionHandleDragDocMove = (e) => {
            if (!regionHandleDragActive || e.pointerId !== regionHandleDragPointerId) return;
            if (typeof syncSnapSuppressionFromPointerEvent === 'function') {
                syncSnapSuppressionFromPointerEvent(e);
            }
            e.preventDefault();
            const transportSec =
                regionHandleDragKind === 'out'
                    ? transportSecFromRegionOutDragDelta(e.clientX)
                    : typeof transportSecFromClientX === 'function'
                      ? transportSecFromClientX(e.clientX)
                      : 0;
            setSegmentHandleFromTransport(
                regionHandleDragTrack,
                regionHandleDragSegmentIndex,
                regionHandleDragKind,
                transportSec,
            );
        };
        regionHandleDragDocUp = (e) => {
            if (!regionHandleDragActive || e.pointerId !== regionHandleDragPointerId) return;
            e.preventDefault();
            endRegionHandleDrag();
            if (typeof schedulePersistSession === 'function') schedulePersistSession();
        };
        document.addEventListener('pointermove', regionHandleDragDocMove);
        document.addEventListener('pointerup', regionHandleDragDocUp);
        document.addEventListener('pointercancel', regionHandleDragDocUp);
    }

    function joinPlaybackRegionAtPointer() {
        const slot = resolveTargetExtraSlot();
        if (slot < 0) {
            if (!suppressInvalidRegionOpNoticeForVideoAudio()) {
                writeLog('Playback region: hover an Ex lane (1–3), then press B');
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint('Region', 'Hover Ex lane', 'notice');
                }
            }
            return false;
        }
        if (!isExtraSlotUsableForRegion(slot)) {
            writeLog('Playback region: load an extra audio track first');
            return false;
        }
        const track = { type: 'extra', slot };
        if (!isTrackRegionActive(track)) {
            writeLog('Playback region: no active regions on Ex ' + (slot + 1));
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'No regions', 'notice');
            }
            return false;
        }
        const { clientX, clientY } = waveformPointerClientXY();
        const boundaryIndex = resolveJoinedBoundaryIndexAtPointer(
            track,
            clientX,
            clientY,
        );
        if (boundaryIndex < 0) {
            writeLog('Playback region: hover a joined boundary, then press B');
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'Hover joined boundary', 'notice');
            }
            return false;
        }
        return joinSegmentBoundaryAt(track, boundaryIndex);
    }

    function handlePlaybackRegionJoinKeydown(e) {
        if (!e || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
        if (e.code !== 'KeyB') return false;
        if (e.repeat) return false;
        if (suppressInvalidRegionOpNoticeForVideoAudio()) return false;
        e.preventDefault();
        joinPlaybackRegionAtPointer();
        return true;
    }

    function handlePlaybackRegionSplitKeydown(e) {
        if (!isPlaybackRegionSplitKeyEvent(e)) return false;
        if (e.repeat) return false;
        if (suppressInvalidRegionOpNoticeForVideoAudio()) return false;
        e.preventDefault();
        splitPlaybackRegionAtTargetSec();
        return true;
    }

    function isPlaybackRegionSplitKeyEvent(e) {
        if (!e || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
        return e.code === 'KeyX';
    }

    function handlePlaybackRegionSlashKeydown(e) {
        return handlePlaybackRegionSplitKeydown(e);
    }

    function handlePlaybackRegionUndoKeydown(e) {
        if (e.code !== 'KeyZ') return false;
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return false;
        if (e.repeat) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        if (regionHandleDragActive || regionUndoDragSnap) return false;
        if (!undoPlaybackRegion()) return false;
        e.preventDefault();
        return true;
    }

    function handlePlaybackRegionRedoKeydown(e) {
        if (e.code !== 'KeyZ') return false;
        if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return false;
        if (e.repeat) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        if (regionHandleDragActive || regionUndoDragSnap) return false;
        if (!redoPlaybackRegion()) return false;
        e.preventDefault();
        return true;
    }

    function handlePlaybackRegionDeleteKeydown(e) {
        if (e.code !== 'Delete' && e.code !== 'Backspace') return false;
        if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        if (regionHandleDragActive) return false;
        if (!deleteRegionSegmentUnderCursor()) return false;
        e.preventDefault();
        return true;
    }

    function handlePlaybackRegionCopyKeydown(e) {
        if (e.code !== 'KeyC') return false;
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return false;
        if (e.repeat) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        if (regionHandleDragActive) return false;
        if (!copyRegionSegmentUnderCursor()) return false;
        e.preventDefault();
        return true;
    }

    function handlePlaybackRegionPasteKeydown(e) {
        if (e.code !== 'KeyV') return false;
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return false;
        if (e.repeat) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        if (regionHandleDragActive) return false;
        if (!pasteRegionSegmentToTrackEnd()) return false;
        e.preventDefault();
        return true;
    }

    function handlePlaybackRegionEscapeKeydown(e) {
        if (e.code !== 'Escape' || e.ctrlKey || e.altKey || e.metaKey) return false;
        if (e.repeat) return false;
        if (regionHandleDragActive) {
            endRegionHandleDrag({ cancelled: true });
            return true;
        }
        if (
            typeof isRangeLoopEscapeRelevant === 'function' &&
            isRangeLoopEscapeRelevant()
        ) {
            return false;
        }
        const slot = resolveTargetExtraSlot();
        if (slot >= 0 && isTrackRegionActive({ type: 'extra', slot })) {
            clearTrackRegion({ type: 'extra', slot });
            e.preventDefault();
            return true;
        }
        if (!isPlaybackRegionActive()) return false;
        clearPlaybackRegion();
        e.preventDefault();
        return true;
    }

    function getPlaybackRegionPersistSnapshot() {
        const extras = [];
        const n =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 3;
        for (let i = 0; i < n; i++) {
            const track = { type: 'extra', slot: i };
            const segments = getTrackSegments(track);
            if (!segments.length) continue;
            const headPad = getHeadPadSec(track);
            const state = getPlaybackRegionsState(track);
            const regionIn =
                state && Number.isFinite(state.regionTimelineInSec)
                    ? state.regionTimelineInSec
                    : undefined;
            const regionLead =
                state && Number.isFinite(state.regionLeadPadSec) && state.regionLeadPadSec > 0
                    ? state.regionLeadPadSec
                    : undefined;
            extras.push({
                slot: i,
                headPadSec: headPad > 0 ? headPad : undefined,
                regionTimelineInSec: regionIn,
                regionLeadPadSec: regionLead,
                segments: segments.map((seg, i) => {
                    const raw = getRawSegmentEntry(track, i);
                    const entry = {
                        id: seg.id,
                        clipId: seg.clipId,
                        sourceInSec: seg.sourceInSec,
                        sourceOutSec: seg.sourceOutSec,
                    };
                    if (raw && Number.isFinite(raw.timelineStartSec)) {
                        entry.timelineStartSec = raw.timelineStartSec;
                    }
                    if (raw && Number.isFinite(raw.regionTimelineInSec)) {
                        entry.regionTimelineInSec = raw.regionTimelineInSec;
                    }
                    if (raw && Number.isFinite(raw.regionLeadPadSec)) {
                        entry.regionLeadPadSec = raw.regionLeadPadSec;
                    }
                    if (raw && Number.isFinite(raw.gainDb) && Math.abs(raw.gainDb) > 0.0005) {
                        entry.gainDb = raw.gainDb;
                    }
                    return entry;
                }),
            });
        }
        return extras.length ? { extra: extras } : null;
    }

    function restorePlaybackRegionFromPersist(data, opt) {
        if (!data || typeof data !== 'object') return false;
        let restoreFailed = false;
        regionUndoPaused = true;
        try {
        if (Array.isArray(data.extra)) {
            for (const entry of data.extra) {
                if (!entry || typeof entry.slot !== 'number') continue;
                const track = { type: 'extra', slot: entry.slot };
                if (Array.isArray(entry.segments) && entry.segments.length) {
                    const loaded =
                        typeof isExtraTrackLoaded === 'function' &&
                        isExtraTrackLoaded(entry.slot);
                    if (!loaded) continue;
                    const ok = setTrackSegments(
                        track,
                        entry.segments,
                        Object.assign({ silent: true, skipUndo: true }, opt || {}),
                    );
                    if (!ok) {
                        restoreFailed = true;
                        continue;
                    }
                    const state = getPlaybackRegionsState(track);
                    if (state) {
                        if (Number.isFinite(entry.headPadSec)) {
                            state.headPadSec = Math.max(0, entry.headPadSec);
                        }
                        if (Number.isFinite(entry.regionTimelineInSec)) {
                            state.regionTimelineInSec = Math.max(
                                0,
                                entry.regionTimelineInSec,
                            );
                        } else {
                            delete state.regionTimelineInSec;
                        }
                        if (Number.isFinite(entry.regionLeadPadSec)) {
                            state.regionLeadPadSec = Math.max(0, entry.regionLeadPadSec);
                        } else {
                            delete state.regionLeadPadSec;
                        }
                        updateTrackRegionOverlays(track);
                        redrawAfterRegionChange(entry.slot);
                    }
                } else if (
                    Number.isFinite(entry.sourceInSec) &&
                    Number.isFinite(entry.sourceOutSec)
                ) {
                    const loaded =
                        typeof isExtraTrackLoaded === 'function' &&
                        isExtraTrackLoaded(entry.slot);
                    if (!loaded) continue;
                    const ok = setTrackSegments(
                        track,
                        [{ sourceInSec: entry.sourceInSec, sourceOutSec: entry.sourceOutSec }],
                        Object.assign({ silent: true, skipUndo: true }, opt || {}),
                    );
                    if (!ok) restoreFailed = true;
                }
            }
        }
        if (
            Number.isFinite(data.inSec) &&
            Number.isFinite(data.outSec) &&
            !data.extra &&
            typeof isExtraTrackLoaded === 'function' &&
            isExtraTrackLoaded(0)
        ) {
            const ok = setTrackSegments(
                { type: 'extra', slot: 0 },
                [{ sourceInSec: data.inSec, sourceOutSec: data.outSec }],
                Object.assign({ silent: true, skipUndo: true }, opt || {}),
            );
            if (!ok) restoreFailed = true;
        }
        updateAllPlaybackRegionOverlays();
        if (!(opt && opt.keepUndoHistory)) {
            clearRegionUndoStack();
        }
        return !restoreFailed;
        } finally {
            regionUndoPaused = false;
        }
    }

    function setPendingPlaybackRegionRestore(data) {
        pendingPlaybackRegionRestore =
            data && typeof data === 'object' ? data : null;
    }

    function applyPendingPlaybackRegionRestore() {
        if (!pendingPlaybackRegionRestore) return false;
        const data = pendingPlaybackRegionRestore;
        const ok = restorePlaybackRegionFromPersist(data, { silent: true });
        if (ok) pendingPlaybackRegionRestore = null;
        return ok;
    }

    function initPlaybackRegionHoverUi() {
        let hoverRaf = 0;
        const onPointerMove = (ev) => {
            if (hoverRaf) return;
            hoverRaf = requestAnimationFrame(() => {
                hoverRaf = 0;
                const lanes = getWaveformLanesEl();
                if (!lanes) {
                    updatePlaybackRegionHoverFromPointer(null, null);
                    return;
                }
                const rect = lanes.getBoundingClientRect();
                const x = ev.clientX;
                const y = ev.clientY;
                if (
                    x < rect.left ||
                    x > rect.right ||
                    y < rect.top ||
                    y > rect.bottom
                ) {
                    updatePlaybackRegionHoverFromPointer(null, null);
                    return;
                }
                updatePlaybackRegionHoverFromPointer(x, y);
            });
        };
        document.addEventListener('pointermove', onPointerMove, { passive: true });
        const lanes = getWaveformLanesEl();
        if (lanes) {
            lanes.addEventListener('pointerleave', () => {
                updatePlaybackRegionHoverFromPointer(null, null);
            });
        }
    }

    function initPlaybackRegionUi() {
        initPlaybackRegionHoverUi();
        document.querySelectorAll('.audio-waveform-lane__playback-regions').forEach((container) => {
            const key = container.getAttribute('data-track');
            const track = parseTrackKey(key);
            if (!track) return;
            container.addEventListener('pointerdown', (ev) => {
                const splitHandle = ev.target.closest(
                    '.audio-waveform-lane__playback-region__handle--split',
                );
                if (splitHandle) {
                    const boundaryIndex = Number(splitHandle.dataset.boundaryIndex);
                    if (Number.isFinite(boundaryIndex)) {
                        onSplitHandlePointerDown(ev, track, boundaryIndex);
                    }
                    return;
                }
                const resizeHit = resolveRegionResizeHandleAtPointer(
                    track,
                    ev.clientX,
                    ev.clientY,
                );
                if (resizeHit) {
                    onRegionHandlePointerDown(
                        ev,
                        track,
                        resizeHit.segmentIndex,
                        resizeHit.kind,
                    );
                }
            });
        });
    }

    initPlaybackRegionUi();

    window.isPlaybackRegionActive = isPlaybackRegionActive;
    window.isTrackRegionActive = isTrackRegionActive;
    window.isTrackTransportAudible = isTrackTransportAudible;
    window.getTrackRegionBounds = getTrackRegionBounds;
    window.getExtraTrackPlaybackAtTransport = mapTransportToSegmentForPlayback;
    window.drawExtraTrackWaveformRegions = drawExtraTrackWaveformRegions;
    window.rebuildExtraTrackRegionViewportPeaks = rebuildExtraTrackRegionViewportPeaks;
    window.getTrackTimelineEndSec = getTrackTimelineEndSec;
    window.getTrackTimelineStartSec = getTrackTimelineStartSec;
    window.getExtraTrackMaxTimelineEndSec = function (slot) {
        return getExtraTrackMaxTimelineEndSec({ type: 'extra', slot });
    };
    window.getRegionOutDragExtendSlot = function () {
        return regionOutDragExtendSlot;
    };
    window.clearPlaybackRegion = clearPlaybackRegion;
    window.clearTrackRegion = clearTrackRegion;
    window.setTrackSegments = setTrackSegments;
    window.applyTrackRegionBounds = function (track, inS, outS, opt) {
        return setTrackSegments(track, [{ sourceInSec: inS, sourceOutSec: outS }], opt);
    };
    window.splitPlaybackRegionAtTargetSec = splitPlaybackRegionAtTargetSec;
    window.joinPlaybackRegionAtPointer = joinPlaybackRegionAtPointer;
    window.cutPlaybackRegionTailAtTargetSec = splitPlaybackRegionAtTargetSec;
    window.getPlaybackRegionPersistSnapshot = getPlaybackRegionPersistSnapshot;
    window.restorePlaybackRegionFromPersist = restorePlaybackRegionFromPersist;
    window.handlePlaybackRegionSplitKeydown = handlePlaybackRegionSplitKeydown;
    window.handlePlaybackRegionJoinKeydown = handlePlaybackRegionJoinKeydown;
    window.handlePlaybackRegionSlashKeydown = handlePlaybackRegionSlashKeydown;
    window.handlePlaybackRegionUndoKeydown = handlePlaybackRegionUndoKeydown;
    window.handlePlaybackRegionRedoKeydown = handlePlaybackRegionRedoKeydown;
    window.handlePlaybackRegionDeleteKeydown = handlePlaybackRegionDeleteKeydown;
    window.handlePlaybackRegionCopyKeydown = handlePlaybackRegionCopyKeydown;
    window.handlePlaybackRegionPasteKeydown = handlePlaybackRegionPasteKeydown;
    window.beginRegionUndoGesture = beginRegionUndoGesture;
    window.commitRegionUndoGesture = commitRegionUndoGesture;
    window.clearRegionUndoStack = clearRegionUndoStack;
    window.handlePlaybackRegionEscapeKeydown = handlePlaybackRegionEscapeKeydown;
    window.handlePlaybackRegionMixKeydown = handlePlaybackRegionMixKeydown;
    window.resolveMixTargetFromActiveRegion = resolveMixTargetFromActiveRegion;
    window.updateAllPlaybackRegionOverlays = updateAllPlaybackRegionOverlays;
    window.updateTrackRegionOverlay = updateTrackRegionOverlays;
    window.setPendingPlaybackRegionRestore = setPendingPlaybackRegionRestore;
    window.applyPendingPlaybackRegionRestore = applyPendingPlaybackRegionRestore;
    window.resolveTargetExtraSlot = resolveTargetExtraSlot;
    window.resolveRegionSegmentFromPointer = resolveRegionSegmentFromPointer;
    window.getSegmentTimelineStartForAltDrag = function (slot, segmentIndex) {
        const track = { type: 'extra', slot };
        return getSegmentRegionTimelineIn(track, segmentIndex);
    };
    window.getSegmentAnchorForAltDrag = function (slot, segmentIndex) {
        const track = { type: 'extra', slot };
        return getSegmentTimelineStart(track, segmentIndex);
    };
    window.getSegmentRegionInPadForAltDrag = function (slot, segmentIndex) {
        const track = { type: 'extra', slot };
        return getSegmentRegionInPadSec(track, segmentIndex);
    };
    window.setSegmentTimelineStartSec = setSegmentTimelineStartSec;
    window.applyRegionTrackTimelineStart = function (slot, sec, opt) {
        const track = { type: 'extra', slot };
        if (!isTrackRegionActive(track) || getSegmentCount(track) < 1) {
            if (typeof setExtraTrackTimelineStartSec === 'function') {
                setExtraTrackTimelineStartSec(slot, sec, opt);
            }
            return;
        }
        const oldT0 = getTrackTimelineStartSec(track);
        const headPad = getHeadPadSec(track);
        const desiredSegStart = snapRegionTransportSec(sec + headPad, {
            exclude: { slot, segmentIndex: 0 },
        });
        const clamped = clampSegmentTimelineStart(track, 0, desiredSegStart);
        const newT0 = Math.max(0, clamped - headPad);
        if (typeof setExtraTrackTimelineStartSec === 'function') {
            setExtraTrackTimelineStartSec(slot, newT0, opt);
        }
        shiftTrackAbsoluteRegionInsByDelta(track, newT0 - oldT0);
    };
    window.isPointerOnRegionResizeHandle = isPointerOnRegionResizeHandle;
    window.isPointerOnAnyRegionResizeHandle = isPointerOnAnyRegionResizeHandle;
    window.snapRegionTransportSec = snapRegionTransportSec;
    window.snapSecToPlaybackRegionInOut = snapSecToPlaybackRegionInOut;
    window.collectRegionSnapStops = collectRegionSnapStops;
    window.regionSnapThresholdSec = regionSnapThresholdSec;
    window.getTrackSegmentCount = function (slot) {
        return getSegmentCount({ type: 'extra', slot });
    };
    window.syncExtraLaneFileNameForRegions = function (slot) {
        syncLaneFileNameForTrack({ type: 'extra', slot });
    };
    window.getActiveExtraSegmentsAtTransport = getActiveExtraSegmentsAtTransport;
    window.refreshSegmentHitAtTransport = refreshSegmentHitAtTransport;
    window.isSegmentSourceContinuousAtBoundary = isSegmentSourceContinuousAtBoundary;
    window.planIncomingSegmentStartAtJoinedBoundary =
        planIncomingSegmentStartAtJoinedBoundary;
    window.getSegmentGainDb = getSegmentGainDb;
    window.getSegmentGainLinear = getSegmentGainLinear;
    window.setSegmentGainDb = setSegmentGainDb;
    window.getSegmentRegionTimelineBounds = function (slot, segmentIndex) {
        const track = { type: 'extra', slot };
        if (!isTrackRegionActive(track)) return null;
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return null;
        return {
            startSec: getSegmentRegionTimelineIn(track, segmentIndex),
            endSec: getSegmentTimelineEnd(track, segmentIndex),
        };
    };
    window.handlePlaybackRegionGainWheel = handlePlaybackRegionGainWheel;
    window.ensureDefaultTrackRegion = ensureDefaultTrackRegion;
    window.updatePlaybackRegionHoverFromPointer = updatePlaybackRegionHoverFromPointer;
    window.addExtraTrackRegionForClip = function (slot, clipId, durationSec, timelineStartSec) {
        const track = { type: 'extra', slot };
        if (!regionUndoPaused) requestRegionUndoCapture();
        const state = getPlaybackRegionsState(track);
        const start = snapRegionTransportSec(timelineStartSec);
        const seg = {
            id: newRegionId(),
            clipId: clipId || 'main',
            sourceInSec: 0,
            sourceOutSec: durationSec,
            timelineStartSec: start,
        };
        const normalized = getTrackSegments(track).map((s) =>
            normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
        );
        normalized.push(normalizeSegmentEntry(seg, track, durationSec));
        state.active = true;
        applySegmentsToState(track, normalized, { silent: true, skipUndo: true });
    };
})();
