/**
 * waveform-region-ui.js — オーバーレイ・ドラッグ・ホバー
 */
    function updateAllPlaybackRegionOverlays() {
        const n =
            getExtraTrackCount();
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
        delete left.fadeOutSec;
        delete right.regionTimelineInSec;
        delete right.regionLeadPadSec;
        delete right.fadeInSec;

        state.segments = segments.map((s) =>
            normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
        );
        if (opt && opt.geometryOnly) {
            refreshTrackRegionOverlayGeometry(track);
        } else {
            updateTrackRegionOverlays(track);
        }
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
        if (Number.isFinite(left.fadeInSec)) {
            merged.fadeInSec = left.fadeInSec;
        }
        if (Number.isFinite(right.fadeOutSec)) {
            merged.fadeOutSec = right.fadeOutSec;
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
        noteRegionShrinkPersistIntent(track.slot);

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

    function setSegmentHandleFromTransport(track, segmentIndex, kind, transportSec, opt) {
        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        if (!segments[segmentIndex]) return;
        const seg = segments[segmentIndex];
        if (kind === 'fade-in') {
            const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
            const maxDur = getSegmentFadeDurationLimit(track, segmentIndex, 'in');
            if (!(maxDur > 0.0005)) return;
            const t = Math.max(playbackStart, Math.min(playbackStart + maxDur, Number(transportSec) || 0));
            setSegmentFadeDurationSec(track, segmentIndex, 'in', t - playbackStart, {
                skipUndo: true,
                geometryOnly: !!(opt && opt.geometryOnly),
            });
            return;
        }
        if (kind === 'fade-out') {
            const playbackEnd = getSegmentTimelineEnd(track, segmentIndex);
            const maxDur = getSegmentFadeDurationLimit(track, segmentIndex, 'out');
            if (!(maxDur > 0.0005)) return;
            const minT = playbackEnd - maxDur;
            const t = Math.max(minT, Math.min(playbackEnd, Number(transportSec) || 0));
            setSegmentFadeDurationSec(track, segmentIndex, 'out', playbackEnd - t, {
                skipUndo: true,
                geometryOnly: !!(opt && opt.geometryOnly),
            });
            return;
        }
        const clipDur = getSegmentSourceDurationSec(track, seg);
        const snapOpt = {
            exclude: { slot: track.slot, segmentIndex },
        };
        const t = snapRegionHandleTransportSec(transportSec, snapOpt);
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
            syncRegionOutDragTimelineExtent(track, segmentIndex, timelineEnd);
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
        redrawAfterRegionChange(track.slot, { segmentIndex });
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
        const isSolo = matchUserShortcut(e, 'mixLaneSoloToggle');
        const isSoloExclusive = matchUserShortcut(e, 'mixLaneSoloExclusive');
        const isMute = matchUserShortcut(e, 'mixLaneMuteToggle');
        const isMuteClearAll = matchUserShortcut(e, 'mixLaneMuteClearAll');
        const isSoloMute = isSolo || isSoloExclusive || isMute || isMuteClearAll;
        if (!isSoloMute) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        if (isMuteClearAll) {
            e.preventDefault();
            if (typeof window.clearAllMixMute === 'function') {
                window.clearAllMixMute();
                return true;
            }
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
        if (isSoloExclusive) {
            if (typeof window.soloOnlyMixByDisplayIndex === 'function') {
                window.soloOnlyMixByDisplayIndex(idx);
                return true;
            }
            return false;
        }
        if (isSolo) {
            if (typeof window.toggleMixSoloByDisplayIndex === 'function') {
                window.toggleMixSoloByDisplayIndex(idx);
                return true;
            }
            return false;
        }
        if (isMute) {
            if (typeof window.toggleMixMuteByDisplayIndex === 'function') {
                window.toggleMixMuteByDisplayIndex(idx);
                return true;
            }
            return false;
        }
        return false;
    }

    function beginRegionOutDragTimelineExtend() {
        regionOutDragExtendSlot = -1;
        regionOutDragExtentSec = NaN;
    }

    function endRegionOutDragTimelineExtend() {
        regionOutDragStartOutTransportSec = NaN;
        regionOutDragStartMasterSec = NaN;
        regionOutDragStartScrubW = NaN;
        regionOutDragStartScrubRatio = NaN;
        regionOutDragExtentSec = NaN;
        if (regionOutDragExtendSlot < 0) return;
        regionOutDragExtendSlot = -1;
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
    }

    /** ドラッグ中のマスター終端をハンドル位置に追従（クリップ最大長まで一気に伸ばさない） */
    function syncRegionOutDragTimelineExtent(track, segmentIndex, timelineEndSec) {
        if (!track || segmentIndex < 0 || !(timelineEndSec > 0)) return;
        const maxEnd = getExtraTrackMaxTimelineEndSec(track);
        const projected = projectedTrackTimelineEndSec(
            track,
            segmentIndex,
            timelineEndSec,
        );
        const prev = regionOutDragExtentSec;

        if (regionOutDragExtendSlot === track.slot && projected < prev - 0.01) {
            regionOutDragExtentSec = projected;
            if (projected <= getTrackTimelineEndSec(track) + 0.01) {
                regionOutDragExtendSlot = -1;
                regionOutDragExtentSec = NaN;
            }
            if (typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
            return;
        }

        if (timelineEndSec <= getTrackTimelineEndSec(track) + 0.01) {
            if (regionOutDragExtendSlot === track.slot) {
                regionOutDragExtendSlot = -1;
                regionOutDragExtentSec = NaN;
                if (typeof notifyMasterTransportDurationChanged === 'function') {
                    notifyMasterTransportDurationChanged();
                }
            }
            return;
        }

        const next = Math.min(
            maxEnd > 0 ? maxEnd : timelineEndSec,
            Math.max(timelineEndSec, projected),
        );
        regionOutDragExtendSlot = track.slot;
        regionOutDragExtentSec = next;
        if (!(prev > 0) || Math.abs(next - prev) > 0.01) {
            if (typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
        }
    }

    function transportSecFromRegionOutDragDelta(clientX) {
        if (
            !Number.isFinite(regionOutDragStartOutTransportSec) ||
            !Number.isFinite(regionOutDragStartScrubRatio) ||
            !(regionOutDragStartScrubW > 0) ||
            !(regionOutDragStartMasterSec > 0)
        ) {
            return typeof transportSecFromClientX === 'function'
                ? transportSecFromClientX(clientX)
                : 0;
        }
        const ratioNow = scrubRatioUnclampedFromClientX(
            clientX,
            regionOutDragStartScrubW,
        );
        let sec =
            regionOutDragStartOutTransportSec +
            (ratioNow - regionOutDragStartScrubRatio) * regionOutDragStartMasterSec;
        if (regionHandleDragTrack && regionHandleDragSegmentIndex >= 0) {
            const timelineStart = getSegmentTimelineStart(
                regionHandleDragTrack,
                regionHandleDragSegmentIndex,
            );
            const maxEnd = maxSegmentTimelineEndSec(
                regionHandleDragTrack,
                regionHandleDragSegmentIndex,
            );
            sec = Math.max(
                timelineStart + PLAYBACK_REGION_MIN_SEC,
                Math.min(maxEnd, sec),
            );
        }
        return sec;
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
        const dragTrack = regionHandleDragTrack;
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
        regionHandleDragStartClientX = NaN;
        detachRegionHandleDragDocListeners();
        const lanes =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        if (lanes) lanes.classList.remove('audio-waveform-composite__lanes--region-drag');
        if (dragTrack) {
            updateTrackRegionOverlays(dragTrack);
        }
        if (!(opt && opt.cancelled) && dragTrack) {
            const slot = dragTrack.slot;
            if (
                slot >= 0 &&
                typeof scheduleWaveformHiresRedrawAfterZoom === 'function'
            ) {
                scheduleWaveformHiresRedrawAfterZoom({ slots: [slot] });
            }
        }
    }

    function onSplitHandlePointerDown(ev, track, boundaryIndex) {
        if (ev.button !== 0) return;
        if (typeof syncSnapSuppressionFromPointerEvent === 'function') {
            syncSnapSuppressionFromPointerEvent(ev);
        }
        if (typeof haltTransportForSessionMutation === 'function') {
            haltTransportForSessionMutation({
                silent: true,
                clearLoopAndRegion: false,
            });
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
        if (typeof ev.target.setPointerCapture === 'function') {
            try {
                ev.target.setPointerCapture(ev.pointerId);
            } catch (_) {}
        }
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
                { geometryOnly: true },
            );
        };
        regionHandleDragDocUp = (e) => {
            if (!regionHandleDragActive || e.pointerId !== regionHandleDragPointerId) return;
            e.preventDefault();
            if (typeof e.target.releasePointerCapture === 'function') {
                try {
                    e.target.releasePointerCapture(e.pointerId);
                } catch (_) {}
            }
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
        if (typeof haltTransportForSessionMutation === 'function') {
            haltTransportForSessionMutation({
                silent: true,
                clearLoopAndRegion: false,
            });
        }
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
        regionHandleDragStartClientX = ev.clientX;
        if (typeof ev.target.setPointerCapture === 'function') {
            try {
                ev.target.setPointerCapture(ev.pointerId);
            } catch (_) {}
        }
        const lanes =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        if (lanes) lanes.classList.add('audio-waveform-composite__lanes--region-drag');
        beginRegionUndoGesture();
        if (kind === 'out') {
            const scrubW =
                typeof waveformTimelineScrubWidthCss === 'function'
                    ? waveformTimelineScrubWidthCss()
                    : 0;
            regionOutDragStartOutTransportSec = getSegmentTimelineEnd(
                track,
                segmentIndex,
            );
            regionOutDragStartMasterSec =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : 0;
            regionOutDragStartScrubW = scrubW;
            regionOutDragStartScrubRatio = scrubRatioUnclampedFromClientX(
                ev.clientX,
                scrubW,
            );
            beginRegionOutDragTimelineExtend();
        } else {
            regionOutDragStartOutTransportSec = NaN;
            regionOutDragStartMasterSec = NaN;
            regionOutDragStartScrubW = NaN;
            regionOutDragStartScrubRatio = NaN;
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
                { geometryOnly: true },
            );
        };
        regionHandleDragDocUp = (e) => {
            if (!regionHandleDragActive || e.pointerId !== regionHandleDragPointerId) return;
            e.preventDefault();
            if (typeof e.target.releasePointerCapture === 'function') {
                try {
                    e.target.releasePointerCapture(e.pointerId);
                } catch (_) {}
            }
            const clickOnly =
                Number.isFinite(regionHandleDragStartClientX) &&
                Math.abs(e.clientX - regionHandleDragStartClientX) <= 5;
            if (
                clickOnly &&
                (regionHandleDragKind === 'in' || regionHandleDragKind === 'out') &&
                regionHandleDragTrack &&
                regionHandleDragSegmentIndex >= 0
            ) {
                const track = regionHandleDragTrack;
                const seg = regionHandleDragSegmentIndex;
                let sec =
                    regionHandleDragKind === 'in'
                        ? getSegmentRegionTimelineIn(track, seg)
                        : getSegmentTimelineEnd(track, seg);
                if (typeof snapRegionHandleTransportSec === 'function') {
                    sec = snapRegionHandleTransportSec(sec, {
                        exclude: { slot: track.slot, segmentIndex: seg },
                        sameSlotOnly: -1,
                    });
                }
                if (typeof clampTransportSec === 'function') {
                    sec = clampTransportSec(sec);
                }
                if (typeof suppressRangeLoopSnapForExplicitSeek === 'function') {
                    suppressRangeLoopSnapForExplicitSeek();
                }
                if (typeof applyTransportAtSec === 'function') {
                    applyTransportAtSec(sec, { logInput: true, flash: true, markers: true });
                }
                syncRegionNavSeekTransportUi(sec);
                if (typeof updateAllWaveformPlayheads === 'function') {
                    updateAllWaveformPlayheads();
                }
                if (typeof schedulePersistSession === 'function') schedulePersistSession();
                endRegionHandleDrag({ cancelled: true });
                regionHandleDragStartClientX = NaN;
                return;
            }
            if (
                regionHandleDragKind === 'out' &&
                regionHandleDragTrack &&
                regionHandleDragSegmentIndex >= 0
            ) {
                const transportSec = transportSecFromRegionOutDragDelta(e.clientX);
                setSegmentHandleFromTransport(
                    regionHandleDragTrack,
                    regionHandleDragSegmentIndex,
                    'out',
                    transportSec,
                    { finalizeSnap: true },
                );
            }
            endRegionHandleDrag();
            regionHandleDragStartClientX = NaN;
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
                writeLog(
                    'Playback region: hover an Ex lane (1–' +
                        getExtraTrackCount() +
                        '), then press B',
                );
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
        let boundaryIndex = resolveJoinedBoundaryIndexAtPointer(
            track,
            clientX,
            clientY,
        );
        if (boundaryIndex < 0) {
            const seekTransportSec = transportSecFromSeekbar();
            if (Number.isFinite(seekTransportSec)) {
                const segments = getTrackSegments(track);
                for (let b = 0; b < segments.length - 1; b++) {
                    if (!isSegmentBoundaryJoined(track, b)) continue;
                    const boundT = getSegmentTimelineEnd(track, b);
                    if (Math.abs(seekTransportSec - boundT) <= SEGMENT_BOUNDARY_JOIN_EPS_SEC) {
                        boundaryIndex = b;
                        break;
                    }
                }
            }
        }
        if (boundaryIndex < 0) {
            writeLog('Playback region: hover a joined boundary or seek to boundary, then press B');
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'Hover/seek joined boundary', 'notice');
            }
            return false;
        }
        return joinSegmentBoundaryAt(track, boundaryIndex);
    }

    function handlePlaybackRegionJoinKeydown(e) {
        if (!matchUserShortcut(e, 'regionJoin')) return false;
        if (suppressInvalidRegionOpNoticeForVideoAudio()) return false;
        e.preventDefault();
        joinPlaybackRegionAtPointer();
        return true;
    }

