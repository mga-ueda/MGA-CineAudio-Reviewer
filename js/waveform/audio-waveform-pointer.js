/**
 * audio-waveform-pointer.js — ポインタ操作・ミックス・シーク
 */
    function getWaveformAudioDurationSec() {
        if (waveformAudioBuffer && waveformAudioBuffer.duration > 0) {
            return waveformAudioBuffer.duration;
        }
        return getVideoTransportDurationSec();
    }

    function getMainVideoAudioBuffer() {
        return waveformAudioBuffer && waveformAudioBuffer.duration > 0.002
            ? waveformAudioBuffer
            : null;
    }

    function getMainWaveformPeaksForDraw() {
        return waveformPeaks;
    }

    window.getWaveformAudioDurationSec = getWaveformAudioDurationSec;
    window.getMainVideoAudioBuffer = getMainVideoAudioBuffer;
    window.getMainWaveformPeaksForDraw = getMainWaveformPeaksForDraw;

    function isAudioWaveformScrubActive() {
        return (
            waveformOffsetDragActive ||
            waveformPointerGestureId != null ||
            seekBarScrubActive
        );
    }

    function detachWaveformOffsetDragDocListeners() {
        if (waveformOffsetDragDocMove) {
            document.removeEventListener('pointermove', waveformOffsetDragDocMove);
            waveformOffsetDragDocMove = null;
        }
        if (waveformOffsetDragDocUp) {
            document.removeEventListener('pointerup', waveformOffsetDragDocUp);
            document.removeEventListener('pointercancel', waveformOffsetDragDocUp);
            waveformOffsetDragDocUp = null;
        }
    }

    function endWaveformTrackOffsetDrag(opt) {
        if (!waveformOffsetDragActive && !(opt && opt.force)) return;
        const endedSlot = waveformOffsetDragSlot;
        detachWaveformOffsetDragDocListeners();
        const releaseId =
            opt && opt.event && opt.event.pointerId != null
                ? opt.event.pointerId
                : waveformOffsetDragPointerId;
        const lanes = waveformScrubTargetEl();
        if (
            lanes &&
            releaseId != null &&
            typeof lanes.releasePointerCapture === 'function'
        ) {
            try {
                lanes.releasePointerCapture(releaseId);
            } catch (_) {}
        }
        waveformOffsetDragActive = false;
        waveformOffsetDragSlot = -1;
        waveformOffsetDragSegmentIndex = -1;
        waveformOffsetDragPointerId = null;
        waveformOffsetDragGroupMembers = null;
        waveformOffsetDragGroupStartTimelineByKey = null;
        waveformOffsetDragGroupStartAnchorByKey = null;
        waveformOffsetDragGroupStartRegionInByKey = null;
        waveformOffsetDragGroupStartRegionSpanByKey = null;
        waveformOffsetDragPreviewHeadSec = NaN;
        waveformOffsetDragStartRegionSpanSec = NaN;
        waveformOffsetDragGrabTransportOffsetSec = NaN;
        waveformOffsetDragStartScrubW = NaN;
        waveformOffsetDragStartPointerRatio = NaN;
        waveformOffsetDragStartXContent = NaN;
        waveformOffsetDragStartMasterSec = NaN;
        if (typeof endRegionOffsetDragMasterFreeze === 'function') {
            endRegionOffsetDragMasterFreeze();
        }
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        if (lanes) lanes.classList.remove('audio-waveform-composite__lanes--offset-drag');
        if (typeof window.commitWaveformOffsetDragIfActive === 'function') {
            window.commitWaveformOffsetDragIfActive = null;
        }
        if (
            typeof clearOffsetDragCrossfadeWaveformDrawnState === 'function' &&
            endedSlot >= 0
        ) {
            clearOffsetDragCrossfadeWaveformDrawnState(endedSlot);
        }
    }

    function waveformExtraLaneSlotFromClientY(clientY) {
        const lanes = waveformScrubTargetEl();
        if (!lanes || !Number.isFinite(clientY)) return -1;
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

    window.waveformExtraLaneSlotFromClientY = waveformExtraLaneSlotFromClientY;

    /** ポインタ Y 座標直下のミックス対象レーン（Video / Ex）。リージョンは見ない。 */
    function resolveMixTargetFromPointer(clientY) {
        if (!Number.isFinite(clientY)) return null;
        const videoLane = document.getElementById('audioWaveformLaneVideo');
        if (videoLane && !videoLane.hidden) {
            const rect = videoLane.getBoundingClientRect();
            if (clientY >= rect.top && clientY <= rect.bottom) {
                return { kind: 'video' };
            }
        }
        const slot = waveformExtraLaneSlotFromClientY(clientY);
        if (slot >= 0) return { kind: 'extra', slot };
        return null;
    }

    window.resolveMixTargetFromPointer = resolveMixTargetFromPointer;

    function isPointerOverVideoAudioLane(clientY) {
        if (!Number.isFinite(clientY)) return false;
        const target = resolveMixTargetFromPointer(clientY);
        return !!(target && target.kind === 'video');
    }

    /** 波形レーン上の直近ポインタが Video Audio 行上か */
    function pointerTargetsVideoAudioLane() {
        let clientY = null;
        if (typeof getWaveformLanesPointerClientY === 'function') {
            clientY = getWaveformLanesPointerClientY();
        }
        if (clientY == null && typeof getWaveformPointerClientY === 'function') {
            clientY = getWaveformPointerClientY();
        }
        return isPointerOverVideoAudioLane(clientY);
    }

    window.isPointerOverVideoAudioLane = isPointerOverVideoAudioLane;
    window.pointerTargetsVideoAudioLane = pointerTargetsVideoAudioLane;

    function isMixLaneTargetMatch(entry, target) {
        if (!target || !entry || !entry.el || entry.el.hidden) return false;
        if (target.kind === 'video') return entry.kind === 'video';
        if (target.kind === 'extra') {
            return entry.kind === 'extra' && entry.slot === target.slot;
        }
        return false;
    }

    function forEachWaveformLaneMeta(onMeta) {
        if (audioWaveformPanel) {
            onMeta({ kind: 'video', el: audioWaveformPanel });
        }
        for (let slot = 0; slot < extraTrackSlotCount(); slot++) {
            const meta = document.getElementById('extraAudioMeta' + slot);
            if (meta) onMeta({ kind: 'extra', slot, el: meta });
        }
    }

    function setActiveMixExtraSlot(slot) {
        if (!(slot >= 0)) return;
        lastActiveMixExtraSlot = slot;
        const target = { kind: 'extra', slot };
        forEachWaveformLaneMeta((entry) => {
            entry.el.classList.toggle(
                'audio-waveform-lane-meta--active',
                isMixLaneTargetMatch(entry, target),
            );
        });
    }

    function isMixExtraSlotUsable(slot) {
        if (!(slot >= 0)) return false;
        if (typeof isExtraTrackLoaded === 'function' && isExtraTrackLoaded(slot)) {
            return true;
        }
        const meta = document.getElementById('extraAudioMeta' + slot);
        return !!(meta && !meta.hidden);
    }

    function firstUsableMixExtraSlot() {
        const n = extraTrackSlotCount();
        for (let i = 0; i < n; i++) {
            if (isMixExtraSlotUsable(i)) return i;
        }
        return -1;
    }

    /** アクティブ Ex が無いとき 1 トラック目（最初に利用可能な Ex）を赤表示にする */
    function ensureDefaultActiveMixExtraSlot() {
        const domSlot =
            typeof getActiveMixExtraSlotFromDom === 'function'
                ? getActiveMixExtraSlotFromDom()
                : -1;
        if (domSlot >= 0 && isMixExtraSlotUsable(domSlot)) {
            lastActiveMixExtraSlot = domSlot;
            return domSlot;
        }
        if (lastActiveMixExtraSlot >= 0 && isMixExtraSlotUsable(lastActiveMixExtraSlot)) {
            setActiveMixExtraSlot(lastActiveMixExtraSlot);
            return lastActiveMixExtraSlot;
        }
        const slot = firstUsableMixExtraSlot();
        if (slot < 0) return -1;
        setActiveMixExtraSlot(slot);
        return slot;
    }

    function refreshActiveMixLaneHighlight(clientY) {
        const target =
            Number.isFinite(clientY) && typeof resolveMixTargetFromPointer === 'function'
                ? resolveMixTargetFromPointer(clientY)
                : null;
        if (target && target.kind === 'extra') {
            setActiveMixExtraSlot(target.slot);
            return;
        }
        forEachWaveformLaneMeta((entry) => {
            entry.el.classList.toggle(
                'audio-waveform-lane-meta--active',
                isMixLaneTargetMatch(entry, target),
            );
        });
    }

    function getLastActiveMixExtraSlot() {
        return lastActiveMixExtraSlot;
    }

    window.refreshActiveMixLaneHighlight = refreshActiveMixLaneHighlight;
    window.getLastActiveMixExtraSlot = getLastActiveMixExtraSlot;
    window.setActiveMixExtraSlot = setActiveMixExtraSlot;
    window.ensureDefaultActiveMixExtraSlot = ensureDefaultActiveMixExtraSlot;

    function canDragWaveformTrackTimelineStart(slot) {
        if (
            typeof isVideoLinkedOffsetDragSlot === 'function' &&
            isVideoLinkedOffsetDragSlot(slot)
        ) {
            const track =
                typeof getVideoTrackRef === 'function' ? getVideoTrackRef() : null;
            return (
                !!track &&
                typeof isTrackRegionActive === 'function' &&
                isTrackRegionActive(track)
            );
        }
        return (
            slot >= 0 &&
            typeof isExtraTrackLoaded === 'function' &&
            isExtraTrackLoaded(slot) &&
            typeof setExtraTrackTimelineStartSec === 'function'
        );
    }

    function isVideoLinkedRegionOffsetDragAllowed(regionHit) {
        if (!regionHit || !(regionHit.segmentIndex >= 0)) return false;
        if (
            typeof isVideoLinkedOffsetDragSlot !== 'function' ||
            !isVideoLinkedOffsetDragSlot(regionHit.slot)
        ) {
            return true;
        }
        return true;
    }

    function regionOffsetDragScrollRatioFromClientX(clientX, scrubWCss) {
        const lanes = typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        const m =
            typeof waveformTimelineMetrics === 'function' ? waveformTimelineMetrics(lanes) : null;
        const w = Number(scrubWCss);
        if (!m || !(w > 0) || !Number.isFinite(clientX)) return 0;
        const xInViewport = clientX - m.contentLeft;
        const xInScrub = xInViewport + (m.scrollable ? m.scrollLeft : 0);
        return xInScrub / w;
    }

    function regionOffsetDragRatioFromClientX(clientX) {
        if (
            typeof window.scrubRatioUnclampedFromClientX === 'function' &&
            waveformOffsetDragStartScrubW > 0
        ) {
            return window.scrubRatioUnclampedFromClientX(
                clientX,
                waveformOffsetDragStartScrubW,
            );
        }
        if (
            waveformOffsetDragStartScrubW > 0 &&
            typeof regionOffsetDragScrollRatioFromClientX === 'function'
        ) {
            return regionOffsetDragScrollRatioFromClientX(
                clientX,
                waveformOffsetDragStartScrubW,
            );
        }
        return NaN;
    }

    /** Region body drag: keep px grab offset; scale delta with master frozen at drag start. */
    function regionOffsetDragRegionInSecFromClientX(clientX) {
        if (
            waveformOffsetDragActive &&
            Number.isFinite(waveformOffsetDragStartTimelineSec) &&
            Number.isFinite(waveformOffsetDragStartPointerRatio) &&
            Number.isFinite(waveformOffsetDragStartMasterSec) &&
            waveformOffsetDragStartMasterSec > 0
        ) {
            const ratioNow = regionOffsetDragRatioFromClientX(clientX);
            if (Number.isFinite(ratioNow)) {
                return (
                    waveformOffsetDragStartTimelineSec +
                    (ratioNow - waveformOffsetDragStartPointerRatio) *
                        waveformOffsetDragStartMasterSec
                );
            }
        }
        const delta = timelineSecDeltaFromClientXDelta(clientX, waveformOffsetDragStartClientX);
        return waveformOffsetDragStartTimelineSec + delta;
    }

    /** REGION_SNAP 診断（F10）— ポインタ秒の複数経路を照合 */
    function regionSnapDiagCollectDragPointerContext(clientX) {
        if (!Number.isFinite(clientX)) return null;
        const round = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : v);
        const ctx = { clientX: round(clientX) };
        if (waveformOffsetDragActive) {
            ctx.dragActive = true;
            ctx.startTimelineSec = round(waveformOffsetDragStartTimelineSec);
            ctx.startMasterSec = round(waveformOffsetDragStartMasterSec);
            ctx.startScrubW = round(waveformOffsetDragStartScrubW);
            ctx.startPointerRatio = round(waveformOffsetDragStartPointerRatio);
            ctx.startClientX = round(waveformOffsetDragStartClientX);
            if (
                waveformOffsetDragStartScrubW > 0 &&
                typeof regionOffsetDragScrollRatioFromClientX === 'function'
            ) {
                ctx.ratioNow = round(regionOffsetDragRatioFromClientX(clientX));
                ctx.ratioDelta = round(ctx.ratioNow - waveformOffsetDragStartPointerRatio);
            }
            ctx.proposedFromRatioDrag = round(
                regionOffsetDragRegionInSecFromClientX(clientX),
            );
            if (Number.isFinite(ctx.ratioDelta)) {
                ctx.proposedFromStartMasterDelta = round(
                    waveformOffsetDragStartTimelineSec +
                        ctx.ratioDelta * waveformOffsetDragStartMasterSec,
                );
                if (typeof computeLiveMasterTransportDurationSec === 'function') {
                    ctx.liveMasterNow = round(computeLiveMasterTransportDurationSec());
                    ctx.hypotheticalLiveMasterScaled = round(
                        waveformOffsetDragStartTimelineSec +
                            ctx.ratioDelta * ctx.liveMasterNow,
                    );
                }
            }
        } else {
            ctx.dragActive = false;
        }
        const liveDelta = timelineSecDeltaFromClientXDelta(
            clientX,
            waveformOffsetDragStartClientX,
        );
        ctx.proposedFromPxDelta = round(
            waveformOffsetDragStartTimelineSec + liveDelta,
        );
        if (typeof transportSecFromClientX === 'function') {
            ctx.transportSecFromClientX = round(transportSecFromClientX(clientX));
        }
        if (
            Number.isFinite(waveformOffsetDragGrabTransportOffsetSec) &&
            Number.isFinite(ctx.transportSecFromClientX)
        ) {
            ctx.grabOffsetSec = round(waveformOffsetDragGrabTransportOffsetSec);
            ctx.regionInFromTransportGrab = round(
                ctx.transportSecFromClientX - waveformOffsetDragGrabTransportOffsetSec,
            );
        }
        if (
            Number.isFinite(ctx.proposedFromRatioDrag) &&
            Number.isFinite(ctx.proposedFromPxDelta)
        ) {
            ctx.dragVsPxDeltaSec = round(
                ctx.proposedFromRatioDrag - ctx.proposedFromPxDelta,
            );
        }
        if (
            Number.isFinite(ctx.proposedFromRatioDrag) &&
            Number.isFinite(ctx.hypotheticalLiveMasterScaled)
        ) {
            ctx.dragVsLiveMasterSec = round(
                ctx.proposedFromRatioDrag - ctx.hypotheticalLiveMasterScaled,
            );
        }
        if (
            Number.isFinite(ctx.proposedFromRatioDrag) &&
            Number.isFinite(ctx.regionInFromTransportGrab)
        ) {
            ctx.dragVsGrabSec = round(
                ctx.proposedFromRatioDrag - ctx.regionInFromTransportGrab,
            );
        }
        if (
            Number.isFinite(ctx.proposedFromRatioDrag) &&
            Number.isFinite(ctx.proposedFromStartMasterDelta)
        ) {
            ctx.dragVsStartMasterSec = round(
                ctx.proposedFromRatioDrag - ctx.proposedFromStartMasterDelta,
            );
        }
        const el = typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        const m =
            typeof waveformTimelineMetrics === 'function' ? waveformTimelineMetrics(el) : null;
        if (m && m.scrubW > 0) {
            ctx.scrubWNow = round(m.scrubW);
            ctx.scrollLeftNow = round(m.scrollable ? m.scrollLeft : 0);
            if (Number.isFinite(waveformOffsetDragStartScrubW) && waveformOffsetDragStartScrubW > 0) {
                ctx.scrubWDriftPx = round(m.scrubW - waveformOffsetDragStartScrubW);
            }
        }
        return ctx;
    }
    window.regionSnapDiagCollectDragPointerContext = regionSnapDiagCollectDragPointerContext;
    window.regionOffsetDragRatioFromClientX = regionOffsetDragRatioFromClientX;

    function timelineSecDeltaFromClientXDelta(clientX, startClientX) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const el = typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        const m =
            typeof waveformTimelineMetrics === 'function' ? waveformTimelineMetrics(el) : null;
        if (!master || !m || !m.scrubW) return 0;
        return ((clientX - startClientX) / m.scrubW) * master;
    }

    function waveformMarkerSnapThresholdSec() {
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const el = typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        const m =
            typeof waveformTimelineMetrics === 'function' ? waveformTimelineMetrics(el) : null;
        if (!master || !m || !m.scrubW) {
            return Math.max(step * 6, 0.05);
        }
        const SNAP_PX = 14;
        return Math.max(step, (SNAP_PX / m.scrubW) * master);
    }

    function snapWaveformTimelineStartSec(sec) {
        if (typeof snapSecToMarkerInOut !== 'function') return sec;
        return snapSecToMarkerInOut(sec, { thresholdSec: waveformMarkerSnapThresholdSec() });
    }

    function applyWaveformTimelineStartFromDrag(slot, sec, opt) {
        if (typeof applyRegionTrackTimelineStart === 'function') {
            applyRegionTrackTimelineStart(slot, sec, opt);
            return;
        }
        const snapped = snapWaveformTimelineStartSec(sec);
        if (typeof setExtraTrackTimelineStartSec === 'function') {
            setExtraTrackTimelineStartSec(slot, snapped, opt);
        }
    }

    function detachWaveformPointerGestureDocListeners() {
        if (waveformPointerGestureDocMove) {
            document.removeEventListener('pointermove', waveformPointerGestureDocMove);
            waveformPointerGestureDocMove = null;
        }
        if (waveformPointerGestureDocUp) {
            document.removeEventListener('pointerup', waveformPointerGestureDocUp);
            document.removeEventListener('pointercancel', waveformPointerGestureDocUp);
            waveformPointerGestureDocUp = null;
        }
    }

    function cancelWaveformPointerGesture() {
        detachWaveformPointerGestureDocListeners();
        waveformPointerGestureId = null;
        waveformPointerGestureRegionHit = null;
        waveformPointerGestureDidMove = false;
        waveformPointerGestureWasPlaying = false;
        const lanes = waveformScrubTargetEl();
        if (lanes) lanes.classList.remove('audio-waveform-composite__lanes--scrubbing');
    }

    function beginWaveformPointerScrubTransport() {
        const lanes = waveformScrubTargetEl();
        if (lanes) lanes.classList.add('audio-waveform-composite__lanes--scrubbing');
        if (typeof clearSeekPlaybackTrail === 'function') clearSeekPlaybackTrail();
        if (typeof beginWaveformVisualRefreshDefer === 'function') {
            beginWaveformVisualRefreshDefer();
        }
        if (typeof beginWaveformScrubOverviewDrawState === 'function') {
            beginWaveformScrubOverviewDrawState();
        }
    }

    function captureWaveformPointerScrubWasPlaying() {
        waveformPointerGestureWasPlaying =
            typeof captureTransportWasActive === 'function' && captureTransportWasActive();
        if (waveformPointerGestureWasPlaying && typeof pauseTransportBeforeSeek === 'function') {
            pauseTransportBeforeSeek();
        }
        return waveformPointerGestureWasPlaying;
    }

    function transportSecForWaveformPointer(clientX) {
        if (!Number.isFinite(clientX) || typeof transportSecFromClientX !== 'function') {
            return NaN;
        }
        let sec = transportSecFromClientX(clientX);
        if (typeof snapTransportSecForWaveformSeek === 'function') {
            const altSuppressed =
                typeof isSnapSuppressedByAlt === 'function' ? isSnapSuppressedByAlt() : false;
            sec = snapTransportSecForWaveformSeek(sec, { altKey: altSuppressed });
        }
        if (typeof clampTransportSec === 'function') {
            sec = clampTransportSec(sec);
        }
        return sec;
    }

    function isPointerOverWaveformAudioLane(clientY) {
        if (!Number.isFinite(clientY)) return false;
        if (isPointerOverVideoAudioLane(clientY)) return true;
        return waveformExtraLaneSlotFromClientY(clientY) >= 0;
    }

    window.isPointerOverWaveformAudioLane = isPointerOverWaveformAudioLane;

    function noteWaveformLanesPointerDownForDoubleClick(clientX, clientY) {
        if (!isPointerOverWaveformAudioLane(clientY)) {
            return false;
        }
        const now = performance.now();
        const prev = waveformLanesClickState;
        const isDouble =
            !!prev &&
            now - prev.at <= WAVEFORM_LANES_DBLCLICK_MS &&
            Math.abs(clientX - prev.x) <= WAVEFORM_LANES_DBLCLICK_SLOP_PX &&
            Math.abs(clientY - prev.y) <= WAVEFORM_LANES_DBLCLICK_SLOP_PX;
        if (isDouble) {
            waveformLanesClickState = null;
            const sec =
                typeof transportSecFromClientX === 'function'
                    ? transportSecFromClientX(clientX)
                    : NaN;
            if (!Number.isFinite(sec)) return false;
            if (typeof handleWaveformTimelineDoubleClickZoom === 'function') {
                handleWaveformTimelineDoubleClickZoom({ sec });
            }
            return true;
        }
        waveformLanesClickState = { at: now, x: clientX, y: clientY };
        return false;
    }

    /** Ex トラック先頭オフセット位置（ビューポート X）。ピクセル基準で空白判定に使う */
    function extraTrackTimelineStartClientX(slot) {
        if (!Number.isFinite(slot) || slot < 0) return null;
        const lanes = waveformScrubTargetEl();
        const m =
            typeof waveformTimelineMetrics === 'function'
                ? waveformTimelineMetrics(lanes)
                : null;
        if (!m || !m.scrubW) return null;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const t0 =
            typeof getTrackTimelineStartSec === 'function'
                ? getTrackTimelineStartSec({ type: 'extra', slot })
                : typeof getExtraTrackTimelineStartSec === 'function'
                  ? getExtraTrackTimelineStartSec(slot)
                  : 0;
        if (!(master > 0) || !(t0 > 0.0005)) return null;
        const inner =
            typeof waveformTimelineInnerEl === 'function' ? waveformTimelineInnerEl() : null;
        const ref = inner || lanes;
        if (!ref) return null;
        return ref.getBoundingClientRect().left + (t0 / master) * m.scrubW;
    }

    /** トラック開始より前のタイムライン空白（オフセット後の左側）か */
    function clickIsInPreTrackTimelineGap(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        const slot = waveformExtraLaneSlotFromClientY(clientY);
        if (slot < 0) return false;
        const x0 = extraTrackTimelineStartClientX(slot);
        if (x0 != null && clientX < x0 - 1) return true;
        const sec =
            typeof transportSecFromClientX === 'function'
                ? transportSecFromClientX(clientX)
                : null;
        if (!Number.isFinite(sec)) return false;
        const t0 =
            typeof getTrackTimelineStartSec === 'function'
                ? getTrackTimelineStartSec({ type: 'extra', slot })
                : typeof getExtraTrackTimelineStartSec === 'function'
                  ? getExtraTrackTimelineStartSec(slot)
                  : 0;
        return sec < t0 - 0.0005;
    }

    function shouldSkipWaveformPointerGesture(ev) {
        if (!ev || ev.button !== 0) return true;
        if (ev.ctrlKey || ev.altKey || ev.metaKey) return true;
        if (clickIsInPreTrackTimelineGap(ev.clientX, ev.clientY)) return false;
        const t = ev.target;
        if (!t || !t.closest) return true;
        if (t.closest('.musical-track-lane__add-input-wrap')) return true;
        if (t.closest('.musical-track-lane__segment-input')) return true;
        /* Tempo/Sig/リハーサル — 値ラベルのみ編集/ドラッグ優先。セグメント空白はシーク */
        if (t.closest('.musical-track-lane__segment-value')) return true;
        if (t.closest('.seek-bar-marker')) return true;
        if (t.closest('.audio-waveform-composite__rehearsal-boundary-handle')) return true;
        if (t.closest('.audio-waveform-composite__seek-input')) return true;
        if (t.closest('.audio-waveform-lane__playback-silent-gap')) return true;
        if (
            typeof isPointerInRegionEwCursorHitZone === 'function' &&
            isPointerInRegionEwCursorHitZone(ev.clientX, ev.clientY)
        ) {
            return true;
        }
        if (
            typeof isPointerOnAnyRegionResizeHandle === 'function' &&
            isPointerOnAnyRegionResizeHandle(ev.clientX, ev.clientY)
        ) {
            return true;
        }
        const regionHandle = t.closest('.audio-waveform-lane__playback-region__handle');
        if (regionHandle) {
            if (clickIsInPreTrackTimelineGap(ev.clientX, ev.clientY)) return false;
            if (
                regionHandle.classList.contains(
                    'audio-waveform-lane__playback-region__handle--split',
                )
            ) {
                return true;
            }
            const region = regionHandle.closest('.audio-waveform-lane__playback-region');
            if (
                region &&
                typeof isPointerOnRegionResizeHandle === 'function' &&
                !isPointerOnRegionResizeHandle(region, ev.clientX, ev.clientY)
            ) {
                return false;
            }
            return true;
        }
        return false;
    }

    function finishWaveformPointerSeek(ev) {
        if (!ev || !Number.isFinite(ev.clientX)) return;
        isSeeking = true;
        const wasPlayingBeforeSeek = waveformPointerGestureWasPlaying;
        waveformPointerGestureWasPlaying = false;
        const targetSec = transportSecForWaveformPointer(ev.clientX);
        if (typeof suppressRangeLoopSnapForExplicitSeek === 'function') {
            suppressRangeLoopSnapForExplicitSeek();
        }
        if (Number.isFinite(targetSec) && typeof applyJumpTransportSeek === 'function') {
            applyJumpTransportSeek(targetSec, wasPlayingBeforeSeek);
        } else {
            seekFromWaveformPointer(ev.clientX, {
                logInput: true,
                flash: true,
                wasPlayingBeforeSeek,
            });
        }
        const t = Number.isFinite(targetSec)
            ? targetSec
            : typeof getTransportSec === 'function'
              ? getTransportSec()
              : parseFloat(seekBar.value) || 0;
        setHoverPlayheadAtClientX(ev.clientX, ev.clientY);
        writeLog('Waveform: seek at ' + formatTimecodeForTransport(t));
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Seek', formatTimecodeForTransport(t));
        }
        isSeeking = false;
        if (typeof updateSeekUiFromVideo === 'function') updateSeekUiFromVideo();
        if (typeof resetWaveformScrubOverviewDrawState === 'function') {
            resetWaveformScrubOverviewDrawState();
        }
        if (typeof endWaveformVisualRefreshDefer === 'function') {
            endWaveformVisualRefreshDefer({ flush: true });
        }
    }

    function onWaveformLanesPointerDownCapture(ev) {
        const ready =
            (typeof videoReady === 'function' && videoReady()) ||
            (typeof hasAnyExtraTrackLoaded === 'function' && hasAnyExtraTrackLoaded());
        if (!ready) return;

        // リージョン In/Out・Fade — MARKERS より先（操作帯デバッグの in/fade-in/out と同じ当たり）
        if (
            typeof tryBeginRegionHandleDragFromPointer === 'function' &&
            tryBeginRegionHandleDragFromPointer(ev)
        ) {
            if (typeof markerPointerDiagLogCaptureWinner === 'function') {
                markerPointerDiagLogCaptureWinner(ev, 'region-handle');
            }
            cancelWaveformPointerGesture();
            return;
        }

        if (
            typeof handleSeekBarMarkerPointerDownCapture === 'function' &&
            handleSeekBarMarkerPointerDownCapture(ev)
        ) {
            if (typeof markerPointerDiagLogCaptureWinner === 'function') {
                markerPointerDiagLogCaptureWinner(ev, 'marker');
            }
            cancelWaveformPointerGesture();
            return;
        }

        let regionHit = null;
        if (typeof resolveVideoLinkedRegionHitFromPointer === 'function') {
            regionHit = resolveVideoLinkedRegionHitFromPointer(ev.clientX, ev.clientY);
        }
        if (!regionHit && typeof resolveRegionSegmentFromPointer === 'function') {
            regionHit = resolveRegionSegmentFromPointer(ev.clientX, ev.clientY);
        }

        // Ctrl/Cmd+クリックは shouldSkipWaveformPointerGesture で弾かれるため、先に選択を処理する
        // 無音スロットをリージョンより先 — 長尺リージョンのタイムライン跨ぎで誤ヒットしないよう
        if (
            typeof handleSilentGapSelectionPointerDown === 'function' &&
            handleSilentGapSelectionPointerDown(ev)
        ) {
            cancelWaveformPointerGesture();
            return;
        }

        if (
            regionHit &&
            typeof handleRegionSelectionPointerDown === 'function' &&
            handleRegionSelectionPointerDown(ev, regionHit)
        ) {
            cancelWaveformPointerGesture();
            return;
        }

        if (
            typeof tryBeginSplitBoundaryDragFromPointer === 'function' &&
            tryBeginSplitBoundaryDragFromPointer(ev)
        ) {
            cancelWaveformPointerGesture();
            return;
        }

        if (shouldSkipWaveformPointerGesture(ev)) {
            if (typeof markerPointerDiagLogCaptureWinner === 'function') {
                markerPointerDiagLogCaptureWinner(ev, 'skip', 'shouldSkipWaveformPointerGesture');
            }
            return;
        }

        if (noteWaveformLanesPointerDownForDoubleClick(ev.clientX, ev.clientY)) {
            ev.preventDefault();
            ev.stopPropagation();
            cancelWaveformPointerGesture();
            return;
        }

        cancelWaveformPointerGesture();
        isSeeking = true;
        waveformPointerGestureId = ev.pointerId;
        waveformPointerGestureStartX = ev.clientX;
        waveformPointerGestureStartY = ev.clientY;
        waveformPointerGestureDidMove = false;
        const inPreTrackGap = clickIsInPreTrackTimelineGap(ev.clientX, ev.clientY);
        const inRegionHandleZone =
            typeof isPointerInRegionEwCursorHitZoneExcludingSplit === 'function'
                ? isPointerInRegionEwCursorHitZoneExcludingSplit(ev.clientX, ev.clientY)
                : typeof isPointerInRegionEwCursorHitZone === 'function' &&
                  isPointerInRegionEwCursorHitZone(ev.clientX, ev.clientY);
        const onSplitHandle =
            typeof isPointerOnSplitHandleAtPointer === 'function' &&
            isPointerOnSplitHandleAtPointer(ev.clientX, ev.clientY);
        waveformPointerGestureRegionHit =
            !inPreTrackGap &&
            !inRegionHandleZone &&
            !onSplitHandle &&
            regionHit &&
            canDragWaveformTrackTimelineStart(regionHit.slot) &&
            isVideoLinkedRegionOffsetDragAllowed(regionHit) &&
            !(
                typeof isPlaybackRegionOffsetDragForbidden === 'function' &&
                isPlaybackRegionOffsetDragForbidden()
            )
                ? regionHit
                : null;

        if (
            !(ev.ctrlKey || ev.metaKey) &&
            !waveformPointerGestureRegionHit &&
            typeof clearRegionSelection === 'function'
        ) {
            clearRegionSelection();
        }

        captureWaveformPointerScrubWasPlaying();

        if (!waveformPointerGestureRegionHit) {
            beginWaveformPointerScrubTransport();
            seekFromWaveformPointer(ev.clientX, { scrubbing: true });
            if (typeof markerPointerDiagLogCaptureWinner === 'function') {
                markerPointerDiagLogCaptureWinner(ev, 'scrub');
            }
            if (currentTimeEl && typeof formatTimecodeForTransport === 'function') {
                const t =
                    typeof getTransportSec === 'function'
                        ? getTransportSec()
                        : parseFloat(seekBar && seekBar.value) || 0;
                currentTimeEl.textContent = formatTimecodeForTransport(t);
            }
        }

        waveformPointerGestureDocMove = (e) => {
            if (e.pointerId !== waveformPointerGestureId) return;
            const dx = e.clientX - waveformPointerGestureStartX;
            const dy = e.clientY - waveformPointerGestureStartY;
            if (
                dx * dx + dy * dy <=
                WAVEFORM_POINTER_GESTURE_DRAG_PX * WAVEFORM_POINTER_GESTURE_DRAG_PX
            ) {
                return;
            }
            waveformPointerGestureDidMove = true;
            if (
                waveformPointerGestureRegionHit &&
                !waveformOffsetDragActive &&
                !regionHandleDragActive
            ) {
                onWaveformTrackOffsetPointerDown(
                    e,
                    waveformPointerGestureRegionHit.slot,
                    waveformPointerGestureRegionHit.segmentIndex,
                );
            } else if (!waveformOffsetDragActive) {
                seekFromWaveformPointer(e.clientX, { scrubbing: true });
            }
        };
        waveformPointerGestureDocUp = (e) => {
            if (e.pointerId !== waveformPointerGestureId) return;
            if (waveformOffsetDragActive) {
                if (
                    typeof window.commitWaveformOffsetDragIfActive === 'function' &&
                    window.commitWaveformOffsetDragIfActive(e)
                ) {
                    /* commit handled */
                } else if (typeof endWaveformTrackOffsetDrag === 'function') {
                    endWaveformTrackOffsetDrag({ force: true, event: e });
                }
                isSeeking = false;
                if (typeof resetWaveformScrubOverviewDrawState === 'function') {
                    resetWaveformScrubOverviewDrawState();
                }
                if (typeof endWaveformVisualRefreshDefer === 'function') {
                    endWaveformVisualRefreshDefer({ flush: true });
                }
            } else {
                finishWaveformPointerSeek(e);
            }
            cancelWaveformPointerGesture();
        };
        document.addEventListener('pointermove', waveformPointerGestureDocMove);
        document.addEventListener('pointerup', waveformPointerGestureDocUp);
        document.addEventListener('pointercancel', waveformPointerGestureDocUp);
    }

    function endAudioWaveformScrub(opt) {
        cancelWaveformPointerGesture();
        endWaveformTrackOffsetDrag(opt);
    }

    let waveformLastHoverClientX = null;
    let waveformLastHoverClientY = null;

    function setHoverPlayheadAtClientX(clientX, clientY) {
        if (audioWaveformHoverPlayhead) audioWaveformHoverPlayhead.hidden = true;
        if (Number.isFinite(clientX)) {
            waveformLastHoverClientX = clientX;
            waveformLastHoverClientY = Number.isFinite(clientY) ? clientY : null;
        }
    }

    function refreshHoverPlayheadFromLastPointer() {
        if (waveformLastHoverClientX == null) return;
        if (!audioWaveformHoverPlayhead || audioWaveformHoverPlayhead.hidden) return;
        setHoverPlayheadAtClientX(waveformLastHoverClientX, waveformLastHoverClientY);
    }

    function hideHoverPlayhead() {
        waveformLastHoverClientX = null;
        waveformLastHoverClientY = null;
        if (audioWaveformHoverPlayhead) audioWaveformHoverPlayhead.hidden = true;
    }

    window.refreshHoverPlayheadFromLastPointer = refreshHoverPlayheadFromLastPointer;

    function getWaveformPointerClientX() {
        return waveformLastHoverClientX;
    }

    function getWaveformPointerClientY() {
        return waveformLastHoverClientY;
    }

    window.getWaveformPointerClientX = getWaveformPointerClientX;
    window.getWaveformPointerClientY = getWaveformPointerClientY;

    function getWaveformLanesPointerClientX() {
        return waveformLanesLastPointerX;
    }

    function getWaveformLanesPointerClientY() {
        return waveformLanesLastPointerY;
    }

    function getWaveformTargetExtraSlot() {
        return waveformTargetExtraSlot;
    }

    window.getWaveformLanesPointerClientX = getWaveformLanesPointerClientX;
    window.getWaveformLanesPointerClientY = getWaveformLanesPointerClientY;
    window.getWaveformTargetExtraSlot = getWaveformTargetExtraSlot;

    function clearAudioWaveform() {
        if (typeof cancelWaveformHiresOnPlayback === 'function') {
            cancelWaveformHiresOnPlayback();
        }
        stopMainVideoWaveformPresenceWatch();
        waveformBuildGen += 1;
        waveformPeaks = null;
        waveformViewportPeaks = null;
        waveformPeakPyramid = null;
        waveformPeakPyramidGen += 1;
        waveformScrubOverviewPeaks = null;
        waveformAudioBuffer = null;
        if (typeof clearViewportPeakCache === 'function') clearViewportPeakCache('mainBufferClear', { force: true });
        endAudioWaveformScrub({ force: true });
        setAudioWaveformLoaded(false);
        setAudioWaveformStatus('Not Loaded');
        if (typeof syncVideoTrackWaveformLoading === 'function') {
            syncVideoTrackWaveformLoading();
        }
        if (audioWaveformPlayheadWrap) audioWaveformPlayheadWrap.hidden = true;
        hideHoverPlayhead();
        if (audioWaveformMarkers) {
            audioWaveformMarkers.replaceChildren();
            audioWaveformMarkers.hidden = true;
        }
        const ctx = audioWaveformCanvas && audioWaveformCanvas.getContext('2d');
        if (ctx && audioWaveformCanvas) {
            ctx.clearRect(0, 0, audioWaveformCanvas.width, audioWaveformCanvas.height);
        }
        if (typeof clearWaveformTrackLkfs === 'function' && audioWaveformTrack) {
            clearWaveformTrackLkfs(audioWaveformTrack);
        }
    }

    function peaksFromAudioBuffer(buffer, barCount) {
        const ch = buffer.getChannelData(0);
        const len = ch.length;
        const bars = Math.max(1, barCount | 0);
        const block = Math.max(1, Math.floor(len / bars));
        const peaks = new Array(bars);
        for (let i = 0; i < bars; i++) {
            const start = i * block;
            const end = Math.min(len, start + block);
            let min = 0;
            let max = 0;
            for (let j = start; j < end; j++) {
                const v = ch[j];
                if (v < min) min = v;
                if (v > max) max = v;
            }
            peaks[i] = { min, max };
        }
        return peaks;
    }

    function peaksFromAudioBufferRange(buffer, startSec, endSec, barCount) {
        if (!buffer || buffer.numberOfChannels < 1) return [];
        const ch = buffer.getChannelData(0);
        const sr = buffer.sampleRate;
        const startSample = Math.max(0, Math.floor(startSec * sr));
        const endSample = Math.min(ch.length, Math.ceil(endSec * sr));
        if (endSample <= startSample) return [];
        const len = endSample - startSample;
        const bars = Math.max(1, barCount | 0);
        const block = Math.max(1, Math.floor(len / bars));
        const peaks = new Array(bars);
        for (let i = 0; i < bars; i++) {
            const blockStart = startSample + i * block;
            const blockEnd = Math.min(endSample, blockStart + block);
            let min = 0;
            let max = 0;
            for (let j = blockStart; j < blockEnd; j++) {
                const v = ch[j];
                if (v < min) min = v;
                if (v > max) max = v;
            }
            peaks[i] = { min, max };
        }
        return peaks;
    }

    window.peaksFromAudioBufferRange = peaksFromAudioBufferRange;

    function syncAudioWaveformCanvasSize() {
        if (!audioWaveformCanvas || !audioWaveformTrack) return null;
        applyWaveformLaneHeightScaleToDom();
        const hCss = resolveWaveformTrackHeightCss();
        if (typeof syncWaveformCanvasElement === 'function') {
            return syncWaveformCanvasElement(audioWaveformCanvas, hCss);
        }
        const layoutW =
            typeof waveformTimelineScrubWidthCss === 'function'
                ? waveformTimelineScrubWidthCss()
                : typeof masterTimelineWidthCss === 'function'
                  ? masterTimelineWidthCss()
                  : Math.max(1, audioWaveformTrack.clientWidth | 0);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        let backingW =
            typeof getWaveformCanvasBackingWidthCss === 'function'
                ? getWaveformCanvasBackingWidthCss(layoutW, dpr)
                : layoutW;
        let barCount = Math.min(4096, Math.max(64, layoutW));
        audioWaveformCanvas.width = Math.max(1, Math.round(backingW * dpr));
        audioWaveformCanvas.height = Math.max(1, Math.round(hCss * dpr));
        audioWaveformCanvas.style.width = layoutW + 'px';
        audioWaveformCanvas.style.height = hCss + 'px';
        const ctx = audioWaveformCanvas.getContext('2d');
        if (ctx) {
            if (typeof applyWaveformCanvasContextTransform === 'function') {
                applyWaveformCanvasContextTransform(ctx, layoutW, backingW, dpr);
            } else {
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
        }
        return { ctx, wCss: layoutW, hCss, barCount, backingW, drawOpt: {} };
    }

    function clearMainWaveformViewportPeaks() {
        waveformViewportPeaks = null;
    }
