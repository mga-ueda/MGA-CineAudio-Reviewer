/**
 * waveform-region-core-geometry.js — セグメント幾何・正規化・境界操作
 */
    function isGridOnlySourceSegmentEntry(seg, epsOpt) {
        if (!seg) return false;
        const eps =
            Number.isFinite(epsOpt) && epsOpt > 0
                ? epsOpt
                : segmentBoundaryJoinEpsilonSec();
        const inS = Number(seg.sourceInSec) || 0;
        const outS = Number(seg.sourceOutSec) || 0;
        return outS - inS <= eps;
    }

    function resolveSegmentAnchorForLeadPad(seg, track) {
        if (seg && Number.isFinite(seg.timelineStartSec)) {
            return seg.timelineStartSec;
        }
        if (track && typeof getTrackTimelineStartSec === 'function') {
            return getTrackTimelineStartSec(track);
        }
        return 0;
    }
    function resolveRawSegmentLeadPadSec(raw, anchor) {
        void anchor;
        return Math.max(0, Number(raw && raw.regionLeadPadSec) || 0);
    }
    function applyRawSegmentLeadPadFields(base, seg, track) {
        if (!base || !seg) return;
        const anchor = resolveSegmentAnchorForLeadPad(seg, track);
        const leadPad = resolveRawSegmentLeadPadSec(seg, anchor);
        if (leadPad > 0.00001) {
            base.regionLeadPadSec = leadPad;
            base.regionTimelineInSec = Number.isFinite(seg.regionTimelineInSec)
                ? seg.regionTimelineInSec
                : anchor - leadPad;
        } else {
            if (Number.isFinite(seg.regionTimelineInSec)) {
                base.regionTimelineInSec = Math.max(0, seg.regionTimelineInSec);
            }
            if (Number.isFinite(seg.regionLeadPadSec) && seg.regionLeadPadSec > 0) {
                base.regionLeadPadSec = Math.max(0, seg.regionLeadPadSec);
            }
        }
        if (Number.isFinite(seg.regionTimelineOutSec)) {
            base.regionTimelineOutSec = seg.regionTimelineOutSec;
        }
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
        applyRawSegmentLeadPadFields(base, seg, track);
        if (seg && Number.isFinite(seg.gainDb)) {
            const db = Math.max(
                REGION_GAIN_DB_MIN,
                Math.min(REGION_GAIN_DB_MAX, seg.gainDb),
            );
            if (Math.abs(db) > 0.0005) base.gainDb = db;
        }
        if (seg && Number.isFinite(seg.pitchSemitones)) {
            const pitch = Math.max(
                REGION_PITCH_SEMITONES_MIN,
                Math.min(REGION_PITCH_SEMITONES_MAX, Math.round(seg.pitchSemitones)),
            );
            if (pitch !== 0) base.pitchSemitones = pitch;
        }
        if (!isVideoTrackRef(track)) {
        if (seg && Number.isFinite(seg.fadeInSec)) {
            base.fadeInSec = Math.max(0, seg.fadeInSec);
        }
        if (seg && Number.isFinite(seg.fadeOutSec)) {
            base.fadeOutSec = Math.max(0, seg.fadeOutSec);
        }
        }
        if (seg && seg.regionGroupId) {
            base.regionGroupId = String(seg.regionGroupId);
        }
        return base;
    }
    function isPointerOnAnyRegionResizeHandle(clientX, clientY, opt) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        const slots = [];
        if (opt && Number.isFinite(opt.slot)) {
            slots.push(opt.slot);
        } else {
            const n =
                getExtraTrackCount();
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
        if (typeof collectVideoPlaybackRegionLaneContexts === 'function') {
            const contexts = collectVideoPlaybackRegionLaneContexts();
            for (let vi = 0; vi < contexts.length; vi++) {
                if (
                    resolveRegionResizeHandleAtPointer(
                        contexts[vi].track,
                        clientX,
                        clientY,
                    )
                ) {
                    return true;
                }
            }
        }
        return false;
    }
    function getPlaybackRegionsState(track) {
        if (isVideoTrackRef(track)) {
            const st = getVideoTrackState().playbackRegions;
            if (!st) {
                getVideoTrackState().playbackRegions = {
                    active: false,
                    segments: [],
                    headPadSec: 0,
                };
            }
            if (!Number.isFinite(getVideoTrackState().playbackRegions.headPadSec)) {
                getVideoTrackState().playbackRegions.headPadSec = 0;
            }
            return getVideoTrackState().playbackRegions;
        }
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
    function readRawRegionLeadPadSec(track, segmentIndex) {
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            return Math.max(0, Number(state && state.regionLeadPadSec) || 0);
        }
        const raw = getRawSegmentEntry(track, segmentIndex);
        return Math.max(0, Number(raw && raw.regionLeadPadSec) || 0);
    }
    /** リージョン左端（In ハンドル） */
    function getSegmentRegionTimelineIn(track, segmentIndex) {
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        let stored = null;
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            if (state && Number.isFinite(state.regionTimelineInSec)) {
                const rawIn = state.regionTimelineInSec;
                stored =
                    readRawRegionLeadPadSec(track, segmentIndex) > 0.00001
                        ? rawIn
                        : Math.max(0, rawIn);
            } else {
                const raw = getRawSegmentEntry(track, segmentIndex);
                if (raw && Number.isFinite(raw.regionTimelineInSec)) {
                    const rawIn = raw.regionTimelineInSec;
                    stored =
                        readRawRegionLeadPadSec(track, segmentIndex) > 0.00001
                            ? rawIn
                            : Math.max(0, rawIn);
                }
            }
        } else {
            const raw = getRawSegmentEntry(track, segmentIndex);
            if (raw && Number.isFinite(raw.regionTimelineInSec)) {
                const rawIn = raw.regionTimelineInSec;
                stored =
                    readRawRegionLeadPadSec(track, segmentIndex) > 0.00001
                        ? rawIn
                        : Math.max(0, rawIn);
            }
        }
        if (stored == null) return anchor;
        if (readRawRegionLeadPadSec(track, segmentIndex) > 0.00001) return stored;
        return stored < anchor - 0.00001 ? anchor : stored;
    }
    function getRawRegionTimelineOutSec(track, segmentIndex) {
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (raw && Number.isFinite(raw.regionTimelineOutSec)) {
            return raw.regionTimelineOutSec;
        }
        return null;
    }
    /**
     * リージョン右端（Out ハンドル）。
     * 未保存時は再生開始 + ソース長（In トリム後も playbackStart 基準）。
     */
    function getSegmentRegionTimelineOut(track, segmentIndex) {
        const storedOut = getRawRegionTimelineOutSec(track, segmentIndex);
        if (storedOut != null) return storedOut;
        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return playbackStart;
        const sourceSpan = Math.max(
            PLAYBACK_REGION_MIN_SEC,
            (Number(seg.sourceOutSec) || 0) - (Number(seg.sourceInSec) || 0),
        );
        return playbackStart + sourceSpan;
    }
    /** Out ハンドル — source 基準の Out と timelineEnd から regionTimelineOutSec を同期 */
    function syncSegmentEntryRegionTimelineOutFromHandle(track, segmentIndex, seg, timelineEndSec) {
        if (!seg) return;
        const sourceIn = Number(seg.sourceInSec) || 0;
        const sourceOut = Number(seg.sourceOutSec) || 0;
        const sourceSpan = Math.max(PLAYBACK_REGION_MIN_SEC, sourceOut - sourceIn);
        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const sourceBasedOut = playbackStart + sourceSpan;
        const end = Number(timelineEndSec);
        if (!Number.isFinite(end)) return;
        if (Math.abs(end - sourceBasedOut) <= 0.00001) {
            delete seg.regionTimelineOutSec;
        } else {
            seg.regionTimelineOutSec = end;
        }
    }
    /** オーバーレイ描画・外周 □ 判定と同じ [In, Out] 区間 */
    function getSegmentRegionOverlayTimelineInterval(track, segmentIndex) {
        if (typeof getSegmentRegionOffsetDragPreviewInterval === 'function') {
            const preview = getSegmentRegionOffsetDragPreviewInterval(track, segmentIndex);
            if (preview) return preview;
        } else if (typeof window.getSegmentRegionOffsetDragPreviewInterval === 'function') {
            const preview = window.getSegmentRegionOffsetDragPreviewInterval(
                track,
                segmentIndex,
            );
            if (preview) return preview;
        }
        const trackStart = getTrackTimelineStartSec(track);
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const start = Math.max(trackStart, regionIn);
        const end = getSegmentRegionTimelineOut(track, segmentIndex);
        return { start, end };
    }
    /** マーカー等: trackStart でクランプしない In〜Out */
    function getSegmentRegionTimelineInterval(track, segmentIndex) {
        return {
            start: getSegmentRegionTimelineIn(track, segmentIndex),
            end: getSegmentRegionTimelineOut(track, segmentIndex),
        };
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
        const raw = state.segments[segmentIndex];
        const leadPad = getSegmentRegionLeadPadSec(track, segmentIndex);
        const preserveLeadPad = leadPad > 0.00001;
        const effectiveInPad = preserveLeadPad ? leadPad : inPad;
        raw.timelineStartSec = desiredAnchor;
        if (segmentIndex === 0) {
            if (effectiveInPad > 0.00001) {
                state.regionTimelineInSec = desiredRegionIn;
                if (isVideoTrackRef(track)) {
                    raw.regionTimelineInSec = desiredRegionIn;
                }
                if (preserveLeadPad) {
                    state.regionLeadPadSec = leadPad;
                }
                state.headPadSec = Math.max(0, desiredRegionIn - t0);
            } else {
                delete state.regionLeadPadSec;
                delete raw.regionLeadPadSec;
                state.headPadSec = Math.max(0, desiredAnchor - t0);
                if (isVideoTrackRef(track)) {
                    state.regionTimelineInSec = desiredRegionIn;
                    raw.regionTimelineInSec = desiredRegionIn;
                    raw.timelineStartSec = desiredAnchor;
                } else {
                    delete state.regionTimelineInSec;
                    delete raw.regionTimelineInSec;
                }
            }
            return;
        }
        if (effectiveInPad > 0.00001) {
            raw.regionTimelineInSec = desiredRegionIn;
            if (preserveLeadPad) {
                raw.regionLeadPadSec = leadPad;
            }
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
    /** 平行移動の左端 — lead pad 時は再生開始が TC0 未満にならない範囲で region In を負にもできる */
    function getSegmentRegionMoveMinTransportSec(track, segmentIndex) {
        const leadPad = getSegmentRegionLeadPadSec(track, segmentIndex);
        if (leadPad > 0.00001) {
            return -leadPad;
        }
        if (segmentIndex === 0) {
            return getTrackTimelineStartSec(track);
        }
        return 0;
    }
    /**
     * 先頭セグメント変更後 — state 上の region In / lead pad を segment[0] と同期。
     * 無音リージョン削除後に regionLeadPadSec が残り、次リージョンが 0s から跨がるのを防ぐ。
     */
    /** regionIn が sourceIn より進んでいる In トリム — sourceIn / regionTimelineOutSec を同期 */
    function reconcileSegmentSourceInWithRegionInTrim(track, segmentIndex) {
        if (segmentIndex !== 0) return false;
        const state = getPlaybackRegionsState(track);
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (!state || !raw) return false;
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const inTrimPad = regionIn - anchor;
        if (inTrimPad <= 0.00001) return false;
        const sourceIn = Math.max(0, Number(raw.sourceInSec) || 0);
        if (sourceIn + 0.00001 >= inTrimPad) return false;

        if (!Number.isFinite(raw.regionTimelineOutSec)) {
            raw.regionTimelineOutSec = getSegmentRegionTimelineOut(track, segmentIndex);
        }
        raw.sourceInSec = inTrimPad;
        if (Number.isFinite(state.regionTimelineInSec)) {
            raw.regionTimelineInSec = state.regionTimelineInSec;
        }
        return true;
    }
    function syncTrackRegionHeadStateFromFirstSegment(track) {
        const state = getPlaybackRegionsState(track);
        if (!state || !Array.isArray(state.segments) || !state.segments.length) {
            return;
        }
        const t0 = getTrackTimelineStartSec(track);
        const raw = state.segments[0];
        let anchor = Number.isFinite(raw.timelineStartSec)
            ? raw.timelineStartSec
            : t0 + Math.max(0, Number(state.headPadSec) || 0);
        const sourceIn = Math.max(0, Number(raw.sourceInSec) || 0);
        let lead = resolveRawSegmentLeadPadSec(raw, anchor);

        if (
            !isVideoTrackRef(track) &&
            lead <= 0.00001 &&
            sourceIn <= 0.00001
        ) {
            if (
                Number.isFinite(raw.regionTimelineInSec) &&
                raw.regionTimelineInSec > anchor + 0.00001
            ) {
                anchor = raw.regionTimelineInSec;
                raw.timelineStartSec = anchor;
                delete raw.regionTimelineInSec;
            }
            if (
                Number.isFinite(state.regionTimelineInSec) &&
                state.regionTimelineInSec > anchor + 0.00001
            ) {
                anchor = state.regionTimelineInSec;
                raw.timelineStartSec = anchor;
                delete state.regionTimelineInSec;
                delete raw.regionTimelineInSec;
            }
        }

        if (lead > 0.00001) {
            raw.regionLeadPadSec = lead;
            const regionIn = Number.isFinite(raw.regionTimelineInSec)
                ? raw.regionTimelineInSec
                : anchor - lead;
            raw.regionTimelineInSec = regionIn;
            state.regionLeadPadSec = lead;
            state.regionTimelineInSec = regionIn;
            state.headPadSec = Math.max(0, regionIn - t0);
            return;
        }

        delete state.regionLeadPadSec;
        delete raw.regionLeadPadSec;
        if (
            Number.isFinite(raw.regionTimelineInSec) &&
            raw.regionTimelineInSec >= anchor - 0.00001
        ) {
            const regionIn = Math.max(0, raw.regionTimelineInSec);
            raw.regionTimelineInSec = regionIn;
            state.regionTimelineInSec = regionIn;
        } else {
            delete state.regionTimelineInSec;
            delete raw.regionTimelineInSec;
        }
        const regionIn = Number.isFinite(state.regionTimelineInSec)
            ? state.regionTimelineInSec
            : anchor;
        state.headPadSec = Math.max(0, regionIn - t0);
        if (isVideoTrackRef(track)) {
            reconcileSegmentSourceInWithRegionInTrim(track, 0);
        }
    }
    /** Rehearsal 無音判定 — スロット内をリージョンが占有するタイムライン区間 */
    function getSegmentRehearsalCoverageInterval(track, segmentIndex) {
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const regionOut = getSegmentRegionTimelineOut(track, segmentIndex);
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        const eps = segmentBoundaryJoinEpsilonSec();
        const sourceSpan = seg
            ? Math.max(0, (Number(seg.sourceOutSec) || 0) - (Number(seg.sourceInSec) || 0))
            : 0;
        if (sourceSpan <= eps && regionOut - regionIn > eps) {
            return { startSec: regionIn, endSec: regionOut };
        }
        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const leadPad = getSegmentRegionLeadPadSec(track, segmentIndex);
        const coverageStart = leadPad > eps ? regionIn : playbackStart;
        return { startSec: coverageStart, endSec: regionOut };
    }
    /** 選択・ポインタヒット — lead pad を除く実音源区間 */
    function getSegmentRegionInteractiveTimelineInterval(track, segmentIndex) {
        return {
            startSec: getSegmentPlaybackTimelineStart(track, segmentIndex),
            endSec: getSegmentRegionTimelineOut(track, segmentIndex),
        };
    }
    /** ソース未消費の無音グリッド区間（GAC PreRoll 等） */
    function isSegmentSilentGridRegion(track, segmentIndex) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return false;
        const eps = segmentBoundaryJoinEpsilonSec();
        const sourceSpan = Math.max(
            0,
            (Number(seg.sourceOutSec) || 0) - (Number(seg.sourceInSec) || 0),
        );
        if (sourceSpan > eps) return false;
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const regionOut = getSegmentRegionTimelineOut(track, segmentIndex);
        return regionOut - regionIn > eps;
    }
    /** 波形描画のタイムライン左端（リージョン In / 再生開始と同一） */
    function getSegmentWaveformDrawTimelineStart(track, segmentIndex) {
        let start = getSegmentWaveformVisibleTimelineStart(track, segmentIndex);
        if (typeof getSegmentWaveformDrawTimelineDelta === 'function') {
            start += getSegmentWaveformDrawTimelineDelta(track, segmentIndex);
        }
        return start;
    }
    function getSegmentTimelineStartForWaveformDraw(track, segmentIndex) {
        let anchor = getSegmentTimelineStart(track, segmentIndex);
        if (typeof getSegmentWaveformDrawTimelineDelta === 'function') {
            anchor += getSegmentWaveformDrawTimelineDelta(track, segmentIndex);
        }
        return anchor;
    }
    function getSegmentTimelineEndForWaveformDraw(track, segmentIndex) {
        let end = getSegmentTimelineEnd(track, segmentIndex);
        if (typeof getSegmentWaveformDrawTimelineDelta === 'function') {
            end += getSegmentWaveformDrawTimelineDelta(track, segmentIndex);
        }
        return end;
    }
    /** 波形を表示するタイムライン左端（リージョン In 以降） */
    function getSegmentWaveformVisibleTimelineStart(track, segmentIndex) {
        const segT0 = getSegmentTimelineStart(track, segmentIndex);
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        let start = regionIn > segT0 + 0.00001 ? regionIn : playbackStart;
        return start;
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
    /** タイムライン位置をクリップ内ソース秒へ（実再生開始基準） */
    function segmentSourceSecFromTransport(track, segmentIndex, transportSec, opt) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return 0;
        const mapDelta =
            opt && Number.isFinite(opt.mapTimelineDelta) ? opt.mapTimelineDelta : 0;
        const playbackStart =
            getSegmentPlaybackTimelineStart(track, segmentIndex) + mapDelta;
        const t = Number(transportSec);
        const span = Math.max(0, seg.sourceOutSec - seg.sourceInSec);
        const regionOut = getSegmentRegionTimelineOut(track, segmentIndex) + mapDelta;
        const timelineSpan = Math.max(0, regionOut - playbackStart);
        let local;
        if (timelineSpan > span + 0.00001) {
            const progress = Math.max(0, Math.min(1, (t - playbackStart) / timelineSpan));
            local = progress * span;
        } else {
            local = Math.max(0, Math.min(span, t - playbackStart));
        }
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
    function isSeparatedSegment(track, segmentIndex) {
        if (segmentIndex <= 0) return false;
        if (
            typeof isSegmentMovableSplitBoundary === 'function' &&
            isSegmentMovableSplitBoundary(track, segmentIndex - 1)
        ) {
            return false;
        }
        return (
            typeof isSegmentBoundaryJoined === 'function' &&
            !isSegmentBoundaryJoined(track, segmentIndex - 1)
        );
    }
    function isRegionEdgeKeyboardNudgeEnabled() {
        return true;
    }
    /** Alt+Shift+I — 左/In 側の境界で波形内容が連続していないときのみ */
    function canNudgeRegionInByKeyboard(track, segmentIndex) {
        if (
            segmentIndex > 0 &&
            typeof isSegmentSourceContinuousAtBoundary === 'function' &&
            isSegmentSourceContinuousAtBoundary(track, segmentIndex - 1)
        ) {
            return false;
        }
        return true;
    }
    /** Alt+Shift+O — 右/Out 側の境界で波形内容が連続していないときのみ */
    function canNudgeRegionOutByKeyboard(track, segmentIndex) {
        const segments = getTrackSegments(track);
        if (
            segmentIndex < segments.length - 1 &&
            typeof isSegmentSourceContinuousAtBoundary === 'function' &&
            isSegmentSourceContinuousAtBoundary(track, segmentIndex)
        ) {
            return false;
        }
        return true;
    }
    function regionEdgeKeyboardNudgeRefTransport(track, segmentIndex, kind) {
        if (kind === 'in') {
            return getSegmentRegionTimelineIn(track, segmentIndex);
        }
        return getSegmentTimelineEnd(track, segmentIndex);
    }
    /** Rehearsal OFF — リージョン端 nudge 量（参照位置の Tempo/Sig における 1 拍） */
    function regionEdgeKeyboardNudgeSecForSegment(track, segmentIndex, kind) {
        const refSec = regionEdgeKeyboardNudgeRefTransport(track, segmentIndex, kind);
        if (
            typeof meterBeatDurationSecAtTransport === 'function'
        ) {
            const beat = meterBeatDurationSecAtTransport(refSec);
            if (Number.isFinite(beat) && beat > 0.00001) return beat;
        }
        return NaN;
    }
    /** エッジ nudge で隣接セグメントと再生タイムラインが重なったか */
    function hasAdjacentPlaybackCrossfadeOverlapForEdgeNudge(track, segmentIndex) {
        if (typeof hasTimelineOverlapAtBoundary !== 'function') return false;
        const segments = getTrackSegments(track);
        if (
            segmentIndex > 0 &&
            hasTimelineOverlapAtBoundary(track, segmentIndex - 1)
        ) {
            return true;
        }
        if (
            segmentIndex < segments.length - 1 &&
            hasTimelineOverlapAtBoundary(track, segmentIndex)
        ) {
            return true;
        }
        return false;
    }
    function finalizeRegionEdgeKeyboardNudge(track, segmentIndex) {
        updateTrackRegionOverlays(track);
        const slot = track.slot;
        const hasOverlap = hasAdjacentPlaybackCrossfadeOverlapForEdgeNudge(
            track,
            segmentIndex,
        );
        redrawAfterRegionChange(slot, { segmentIndex });
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (
            hasOverlap &&
            typeof applyReviewMixCrossfadeGainsIfNeeded === 'function'
        ) {
            applyReviewMixCrossfadeGainsIfNeeded();
        }
    }
    /** In/Out ハンドルドラッグと同じ境界解決（キーボード nudge 用） */
    function resolveSplitBoundaryIndexForRegionEdgeNudge(track, segmentIndex, kind) {
        const segments = getTrackSegments(track);
        if (kind === 'in' && segmentIndex > 0) {
            const b = segmentIndex - 1;
            if (
                typeof isSegmentMovableSplitBoundary === 'function' &&
                isSegmentMovableSplitBoundary(track, b)
            ) {
                return b;
            }
            if (
                typeof isSegmentBoundaryJoined === 'function' &&
                isSegmentBoundaryJoined(track, b)
            ) {
                return b;
            }
        } else if (kind === 'out' && segmentIndex < segments.length - 1) {
            const b = segmentIndex;
            if (
                typeof isSegmentMovableSplitBoundary === 'function' &&
                isSegmentMovableSplitBoundary(track, b)
            ) {
                return b;
            }
            if (
                typeof isSegmentBoundaryJoined === 'function' &&
                isSegmentBoundaryJoined(track, b)
            ) {
                return b;
            }
        }
        return -1;
    }
    function finishRegionEdgeKeyboardNudge(track, segmentIndex, opt) {
        if (opt && opt.geometryOnly) {
            refreshTrackRegionOverlayGeometry(track);
        } else {
            finalizeRegionEdgeKeyboardNudge(track, segmentIndex);
        }
    }
    /** Rehearsal OFF — In を 1 拍分手前へ（In ハンドルドラッグと同じ経路） */
    function nudgeSegmentRegionInEarlierContentFixed(track, segmentIndex, deltaSec, opt) {
        const delta = Number(deltaSec);
        if (!Number.isFinite(delta) || delta <= 0.00001) return false;
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        const prevRegionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const audioEnd = getSegmentTimelineEnd(track, segmentIndex);
        const t0 = getTrackTimelineStartSec(track);
        const minIn = segmentIndex === 0 ? Math.max(t0, 0) : 0;
        const maxIn = audioEnd - PLAYBACK_REGION_MIN_SEC;
        const targetIn = prevRegionIn - delta;
        if (targetIn < minIn - 0.00001 || maxIn < minIn) return false;
        const newRegionIn = Math.max(minIn, Math.min(maxIn, targetIn));
        if (Math.abs(newRegionIn - prevRegionIn) < 0.00001) return false;

        const splitB = resolveSplitBoundaryIndexForRegionEdgeNudge(
            track,
            segmentIndex,
            'in',
        );
        if (splitB >= 0 && typeof setSplitBoundaryFromTransport === 'function') {
            setSplitBoundaryFromTransport(track, splitB, newRegionIn, {
                silent: !!(opt && opt.silent),
                geometryOnly: !!(opt && opt.geometryOnly),
            });
            finishRegionEdgeKeyboardNudge(track, segmentIndex, opt);
            return true;
        }
        if (segmentIndex === 0 && newRegionIn < anchor - 0.00001) {
            extendSegmentAnchorLeft(track, segmentIndex, newRegionIn, audioEnd, t0, opt);
            finishRegionEdgeKeyboardNudge(track, segmentIndex, opt);
            return true;
        }
        expandSegmentRegionInLeft(
            track,
            segmentIndex,
            newRegionIn,
            audioEnd,
            t0,
            opt,
        );
        finishRegionEdgeKeyboardNudge(track, segmentIndex, opt);
        return true;
    }
    /** Rehearsal OFF — Out を 1 拍分後方へ（Out ハンドルドラッグと同じ経路） */
    function nudgeSegmentRegionOutLaterContentFixed(track, segmentIndex, deltaSec, opt) {
        const delta = Number(deltaSec);
        if (!Number.isFinite(delta) || delta <= 0.00001) return false;
        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        const seg = segments[segmentIndex];
        if (!seg) return false;
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        const prevEnd = getSegmentTimelineEnd(track, segmentIndex);
        const maxEnd =
            typeof maxSegmentTimelineEndSec === 'function'
                ? maxSegmentTimelineEndSec(track, segmentIndex)
                : prevEnd + delta;
        const newEnd = Math.min(maxEnd, prevEnd + delta);
        if (newEnd <= prevEnd + 0.00001) return false;

        const splitB = resolveSplitBoundaryIndexForRegionEdgeNudge(
            track,
            segmentIndex,
            'out',
        );
        if (splitB >= 0 && typeof setSplitBoundaryFromTransport === 'function') {
            setSplitBoundaryFromTransport(track, splitB, newEnd, {
                silent: !!(opt && opt.silent),
                geometryOnly: !!(opt && opt.geometryOnly),
            });
            finishRegionEdgeKeyboardNudge(track, segmentIndex, opt);
            return true;
        }

        const newSourceOut = Math.min(
            getSegmentSourceDurationSec(track, seg),
            seg.sourceInSec + Math.max(PLAYBACK_REGION_MIN_SEC, newEnd - anchor),
        );
        if (Math.abs(newSourceOut - seg.sourceOutSec) < 0.00001) return false;
        seg.sourceOutSec = newSourceOut;
        applySegmentsToState(
            track,
            segments.map((s) =>
                normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
            ),
            {
                silent: !!(opt && opt.silent),
                skipUndo: !!(opt && opt.skipUndo),
                geometryOnly: !!(opt && opt.geometryOnly),
                skipPersist: !!(opt && opt.geometryOnly),
            },
        );
        finishRegionEdgeKeyboardNudge(track, segmentIndex, opt);
        return true;
    }
    function extendSegmentAnchorLeft(track, segmentIndex, regionIn, audioEnd, t0, opt) {
        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        const seg = segments[segmentIndex];
        const state = getPlaybackRegionsState(track);
        if (!seg || !state) return;
        const newAnchor = regionIn;
        const newDur = audioEnd - newAnchor;
        seg.sourceInSec = Math.max(0, seg.sourceOutSec - newDur);
        if (segmentIndex === 0) {
            state.headPadSec = Math.max(0, newAnchor - t0);
            delete state.regionLeadPadSec;
            delete seg.regionLeadPadSec;
            delete seg.timelineStartSec;
            if (state.headPadSec > 0.00001) {
                state.regionTimelineInSec = newAnchor;
                seg.regionTimelineInSec = newAnchor;
            } else {
                delete state.regionTimelineInSec;
                delete seg.regionTimelineInSec;
            }
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
            {
                silent: true,
                skipUndo: true,
                geometryOnly: !!(opt && opt.geometryOnly),
                skipPersist: !!(opt && opt.geometryOnly),
            },
        );
    }
    function writeSegmentRegionInAfterContentEdit(
        track,
        segmentIndex,
        regionIn,
        anchor,
        state,
        seg,
    ) {
        if (regionIn <= anchor + 0.00001) {
            if (segmentIndex === 0) {
                delete state.regionTimelineInSec;
                delete state.regionLeadPadSec;
                if (seg) {
                    delete seg.regionTimelineInSec;
                    delete seg.regionLeadPadSec;
                }
            } else if (seg) {
                delete seg.regionTimelineInSec;
                delete seg.regionLeadPadSec;
            }
            return;
        }
        if (segmentIndex === 0) {
            state.regionTimelineInSec = regionIn;
            delete state.regionLeadPadSec;
            if (seg) {
                seg.regionTimelineInSec = regionIn;
                delete seg.regionLeadPadSec;
            }
        } else if (seg) {
            seg.regionTimelineInSec = regionIn;
            delete seg.regionLeadPadSec;
        }
    }
    /** In/Out ドラッグ — 現在の regionIn 基準で増分適用（Out は開始時固定） */
    function applySegmentRegionInFromDragAbsolute(track, segmentIndex, targetRegionIn, opt) {
        const t0 = getTrackTimelineStartSec(track);
        let regionIn = targetRegionIn;
        if (segmentIndex === 0) {
            regionIn = Math.max(t0, regionIn);
        }
        regionIn = clampSegmentTimelineStart(track, segmentIndex, regionIn);

        const dragStartAnchor = Number.isFinite(regionHandleDragStartAnchorSec)
            ? regionHandleDragStartAnchorSec
            : getSegmentTimelineStart(track, segmentIndex);
        const currentAnchor = getSegmentTimelineStart(track, segmentIndex);
        const startSourceIn = Number.isFinite(regionHandleDragStartSourceInSec)
            ? regionHandleDragStartSourceInSec
            : 0;
        const startSourceOut = Number.isFinite(regionHandleDragStartSourceOutSec)
            ? regionHandleDragStartSourceOutSec
            : startSourceIn + PLAYBACK_REGION_MIN_SEC;
        const startRegionOutSec = Number.isFinite(regionHandleDragStartRegionOutSec)
            ? regionHandleDragStartRegionOutSec
            : null;
        const audioEnd =
            dragStartAnchor + Math.max(0, startSourceOut - startSourceIn);

        if (regionIn < currentAnchor - 0.00001) {
            if (
                segmentIndex > 0 &&
                typeof isSegmentBoundaryJoined === 'function' &&
                isSegmentBoundaryJoined(track, segmentIndex - 1)
            ) {
                setSplitBoundaryFromTransport(track, segmentIndex - 1, regionIn, opt);
                return;
            }
            extendSegmentAnchorLeft(track, segmentIndex, regionIn, audioEnd, t0, opt);
            return;
        }

        const prevRegionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const dragFloorIn = Math.min(
            Number.isFinite(regionHandleDragStartRegionIn)
                ? regionHandleDragStartRegionIn
                : prevRegionIn,
            dragStartAnchor,
        );
        const deltaSign = regionIn - prevRegionIn;
        const safePrevRegionIn =
            deltaSign > 0.00001 && prevRegionIn + 0.00001 < dragFloorIn
                ? dragFloorIn
                : prevRegionIn;
        const delta = regionIn - safePrevRegionIn;
        if (Math.abs(delta) < 0.00001) return;

        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        const seg = segments[segmentIndex];
        const state = getPlaybackRegionsState(track);
        if (!seg || !state) return;

        let newSourceIn;
        let effectiveRegionIn;
        const curSourceIn = Math.max(0, Number(seg.sourceInSec) || 0);
        if (delta > 0) {
            const maxTrim = Math.max(
                0,
                startSourceOut - curSourceIn - PLAYBACK_REGION_MIN_SEC,
            );
            const appliedDelta = Math.min(delta, maxTrim);
            if (appliedDelta <= 0.00001) return;
            newSourceIn = Math.min(
                startSourceOut - PLAYBACK_REGION_MIN_SEC,
                curSourceIn + appliedDelta,
            );
            effectiveRegionIn = safePrevRegionIn + appliedDelta;
        } else {
            const appliedDelta = Math.min(-delta, curSourceIn);
            if (appliedDelta <= 0.00001) return;
            newSourceIn = Math.max(0, curSourceIn - appliedDelta);
            effectiveRegionIn = safePrevRegionIn - appliedDelta;
        }

        seg.sourceInSec = newSourceIn;
        seg.sourceOutSec = startSourceOut;
        const raw = getRawSegmentEntry(track, segmentIndex);
        const preservedTimelineOutSec =
            raw && Number.isFinite(raw.regionTimelineOutSec)
                ? raw.regionTimelineOutSec
                : null;
        writeSegmentRegionInAfterContentEdit(
            track,
            segmentIndex,
            effectiveRegionIn,
            currentAnchor,
            state,
            seg,
        );
        if (startRegionOutSec != null) {
            // In ハンドルドラッグ中は Out を開始位置で固定（source トリムで segDur が縮んでも Out は動かさない）
            seg.regionTimelineOutSec = startRegionOutSec;
        } else {
            delete seg.regionTimelineOutSec;
            const timelineEndSec =
                currentAnchor +
                Math.max(PLAYBACK_REGION_MIN_SEC, startSourceOut - newSourceIn);
            syncSegmentEntryRegionTimelineOutFromHandle(
                track,
                segmentIndex,
                seg,
                timelineEndSec,
            );
            if (
                preservedTimelineOutSec != null &&
                preservedTimelineOutSec > timelineEndSec + 0.00001
            ) {
                seg.regionTimelineOutSec = preservedTimelineOutSec;
            }
        }
        applySegmentsToState(
            track,
            segments.map((s) =>
                normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
            ),
            {
                silent: true,
                skipUndo: true,
                geometryOnly: !!(opt && opt.geometryOnly),
                skipPersist: !!(opt && opt.geometryOnly),
            },
        );
    }
    /** リージョン In を後方へ狭げ Out 固定 — sourceIn を進め、アンカーは動かさない */
    function contractSegmentRegionInRight(track, segmentIndex, regionIn, opt) {
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        const prevRegionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const delta = regionIn - prevRegionIn;
        if (delta <= 0.00001) return;

        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        const seg = segments[segmentIndex];
        const state = getPlaybackRegionsState(track);
        if (!seg || !state) return;

        const maxTrim = Math.max(
            0,
            seg.sourceOutSec - seg.sourceInSec - PLAYBACK_REGION_MIN_SEC,
        );
        const appliedDelta = Math.min(delta, maxTrim);
        if (appliedDelta <= 0.00001) return;

        const effectiveRegionIn = prevRegionIn + appliedDelta;
        seg.sourceInSec = Math.min(
            seg.sourceOutSec - PLAYBACK_REGION_MIN_SEC,
            seg.sourceInSec + appliedDelta,
        );
        writeSegmentRegionInAfterContentEdit(
            track,
            segmentIndex,
            effectiveRegionIn,
            anchor,
            state,
            seg,
        );
        const lockedOutSec = getSegmentRegionTimelineOut(track, segmentIndex);
        if (Number.isFinite(lockedOutSec)) {
            seg.regionTimelineOutSec = lockedOutSec;
        }
        applySegmentsToState(
            track,
            segments.map((s) =>
                normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
            ),
            {
                silent: true,
                skipUndo: true,
                geometryOnly: !!(opt && opt.geometryOnly),
                skipPersist: !!(opt && opt.geometryOnly),
            },
        );
    }
    /**
     * リージョン In を手前へ広げ Out 固定 — sourceIn を戻す。
     * アンカーより手前へ伸ばすときだけ extendSegmentAnchorLeft。
     */
    function expandSegmentRegionInLeft(track, segmentIndex, regionIn, audioEnd, t0, opt) {
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        if (regionIn < anchor - 0.00001) {
            if (
                !isParallelRegionOffsetDragOpt(opt) &&
                segmentIndex > 0 &&
                typeof isSegmentBoundaryJoined === 'function' &&
                isSegmentBoundaryJoined(track, segmentIndex - 1)
            ) {
                setSplitBoundaryFromTransport(track, segmentIndex - 1, regionIn, opt);
                return;
            }
            extendSegmentAnchorLeft(track, segmentIndex, regionIn, audioEnd, t0, opt);
            return;
        }
        const prevRegionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const delta = prevRegionIn - regionIn;
        if (delta <= 0.00001) return;

        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        const seg = segments[segmentIndex];
        const state = getPlaybackRegionsState(track);
        if (!seg || !state) return;

        seg.sourceInSec = Math.max(0, seg.sourceInSec - delta);
        writeSegmentRegionInAfterContentEdit(
            track,
            segmentIndex,
            regionIn,
            anchor,
            state,
            seg,
        );
        applySegmentsToState(
            track,
            segments.map((s) =>
                normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
            ),
            {
                silent: true,
                skipUndo: true,
                geometryOnly: !!(opt && opt.geometryOnly),
                skipPersist: !!(opt && opt.geometryOnly),
            },
        );
    }
    /**
     * 平行移動ドラッグで維持する In パッド。
     * sourceIn トリム／lead pad／regionTimelineOutSec 付きクロスフェード配置。
     * それ以外の regionIn>anchor は 0 扱い（Out 固定バグ防止）。
     */
    function resolveParallelRegionOffsetDragInPadSec(
        track,
        segmentIndex,
        startRegionIn,
        startAnchor,
    ) {
        const leadPad = getSegmentRegionLeadPadSec(track, segmentIndex);
        if (leadPad > 0.00001) {
            return leadPad;
        }
        const ri = Number(startRegionIn) || 0;
        const ca = Number(startAnchor) || 0;
        const layoutInPad = Math.max(0, ri - ca);
        if (getRawRegionTimelineOutSec(track, segmentIndex) != null) {
            return layoutInPad;
        }
        const raw = getRawSegmentEntry(track, segmentIndex);
        const sourceIn = raw ? Math.max(0, Number(raw.sourceInSec) || 0) : 0;
        if (sourceIn > layoutInPad + 0.00001) {
            return layoutInPad;
        }
        return 0;
    }
    /** リージョン本体の平行移動ドラッグ（offset drag）— In ハンドル／境界操作と区別 */
    function isParallelRegionOffsetDragOpt(opt) {
        return !!(
            opt &&
            (opt.parallelRegionOffsetDrag === true ||
                (Number.isFinite(opt.dragStartRegionIn) &&
                    Number.isFinite(opt.dragStartAnchor)))
        );
    }
    function isRegionInHandleDragActive() {
        return !!(
            regionHandleDragActive &&
            regionHandleDragKind === 'in' &&
            Number.isFinite(regionHandleDragStartRegionIn)
        );
    }
    /** In ハンドル移動の右端 — ソース終端と regionOut の大きい方（Out 固定・負 anchor 時） */
    function getSegmentRegionInTransportMaxSec(track, segmentIndex) {
        const sourceEnd = getSegmentTimelineEnd(track, segmentIndex);
        const regionOut = getSegmentRegionTimelineOut(track, segmentIndex);
        const end = Math.max(sourceEnd, regionOut);
        return Math.max(0, end - PLAYBACK_REGION_MIN_SEC);
    }
    function applySegmentRegionInFromTransport(track, segmentIndex, transportSec, opt) {
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        const audioEnd = getSegmentTimelineEnd(track, segmentIndex);
        const t0 = getTrackTimelineStartSec(track);
        const prevRegionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const maxRegionIn = getSegmentRegionInTransportMaxSec(track, segmentIndex);
        let regionIn = Math.max(0, Math.min(maxRegionIn, transportSec));
        if (segmentIndex === 0) {
            regionIn = Math.max(t0, regionIn);
        }
        regionIn = clampSegmentTimelineStart(track, segmentIndex, regionIn);
        if (!isParallelRegionOffsetDragOpt(opt) && isRegionInHandleDragActive()) {
            if (
                segmentIndex > 0 &&
                typeof isSegmentMovableSplitBoundary === 'function' &&
                isSegmentMovableSplitBoundary(track, segmentIndex - 1)
            ) {
                setSplitBoundaryFromTransport(track, segmentIndex - 1, regionIn, opt);
                return;
            }
            applySegmentRegionInFromDragAbsolute(
                track,
                segmentIndex,
                regionIn,
                opt,
            );
            return;
        }
        if (!isParallelRegionOffsetDragOpt(opt)) {
            if (
                segmentIndex > 0 &&
                typeof isSegmentMovableSplitBoundary === 'function' &&
                isSegmentMovableSplitBoundary(track, segmentIndex - 1)
            ) {
                setSplitBoundaryFromTransport(track, segmentIndex - 1, regionIn, opt);
                return;
            }
            if (regionIn > prevRegionIn + 0.00001) {
                contractSegmentRegionInRight(track, segmentIndex, regionIn, opt);
                return;
            }
            if (regionIn < prevRegionIn - 0.00001) {
                expandSegmentRegionInLeft(
                    track,
                    segmentIndex,
                    regionIn,
                    audioEnd,
                    t0,
                    opt,
                );
                return;
            }
        }
        if (Math.abs(regionIn - prevRegionIn) < 0.00001) return;
        if (regionIn < anchor - 0.00001) {
            if (
                !isParallelRegionOffsetDragOpt(opt) &&
                segmentIndex > 0 &&
                typeof isSegmentBoundaryJoined === 'function' &&
                isSegmentBoundaryJoined(track, segmentIndex - 1)
            ) {
                setSplitBoundaryFromTransport(track, segmentIndex - 1, regionIn, opt);
                return;
            }
            extendSegmentAnchorLeft(track, segmentIndex, regionIn, audioEnd, t0, opt);
        }
    }
    function getTrackSourceDurationSec(track) {
        if (isVideoTrackRef(track)) {
            if (typeof getVideoTrackSourceDurationSec === 'function') {
                return getVideoTrackSourceDurationSec();
            }
            if (typeof getVideoTransportDurationSec === 'function') {
                return getVideoTransportDurationSec();
            }
            return 0;
        }
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
        if (isVideoTrackRef(track)) return 0;
        if (!isExtraTrackRef(track)) return 0;
        if (typeof getExtraTrackTimelineStartSec === 'function') {
            return getExtraTrackTimelineStartSec(track.slot);
        }
        return 0;
    }
    function getPrimaryClipIdForTrack(track) {
        if (isVideoTrackRef(track)) return 'main';
        if (!isExtraTrackRef(track)) return 'main';
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(track.slot) : null;
        if (tr && tr.clips && tr.clips.length && tr.clips[0].id) {
            return tr.clips[0].id;
        }
        return 'main';
    }
    function ensureDefaultTrackRegion(track, opt) {
        if (isVideoTrackRef(track)) {
            if (typeof ensureDefaultVideoTrackRegion === 'function') {
                return ensureDefaultVideoTrackRegion(opt);
            }
            return false;
        }
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
        state.headPadSec = 0;
        delete state.regionTimelineInSec;
        delete state.regionLeadPadSec;
        for (let i = 0; i < state.segments.length; i++) {
            const raw = state.segments[i];
            if (!raw) continue;
            delete raw.timelineStartSec;
            delete raw.regionTimelineInSec;
            delete raw.regionTimelineOutSec;
            delete raw.regionLeadPadSec;
        }
        if (typeof setExtraTrackTimelineStartSec === 'function') {
            setExtraTrackTimelineStartSec(track.slot, 0, {
                skipPersist: !!(opt && opt.skipPersist),
                skipRedraw: true,
            });
        }
        if (typeof syncTrackRegionHeadStateFromFirstSegment === 'function') {
            syncTrackRegionHeadStateFromFirstSegment(track);
        }
        if (typeof bumpRegionPersistEpoch === 'function') {
            bumpRegionPersistEpoch(track.slot);
        }
        if (
            !(opt && opt.skipMusicalRefresh) &&
            typeof refreshTrackTimelineMusicalSlots === 'function'
        ) {
            refreshTrackTimelineMusicalSlots(track, { preserveStored: false });
        }
        if (!(opt && opt.skipOverlay) && typeof updateTrackRegionOverlays === 'function') {
            updateTrackRegionOverlays(track);
        }
        if (!(opt && opt.silent) && typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        return true;
    }
    const trackSegmentsMemoBySlot = [];
    let getTrackSegmentsBuildSlot = -1;
    let getTrackSegmentsBuildQuick = null;
    function buildTrackSegmentsQuick(track) {
        const state = getPlaybackRegionsState(track);
        if (!state || !state.active || !state.segments || !state.segments.length) {
            return [];
        }
        const normalized = [];
        for (let i = 0; i < state.segments.length; i++) {
            const raw = state.segments[i];
            const fullDur = getSegmentSourceDurationSec(track, raw);
            if (!fullDur) continue;
            normalized.push(normalizeSegmentEntry(raw, track, fullDur));
        }
        return normalized;
    }
    function getTrackSegments(track) {
        const state = getPlaybackRegionsState(track);
        if (!state) return [];
        if (
            !isSessionRestoreBusy() &&
            (!state.active || !state.segments || !state.segments.length)
        ) {
            ensureDefaultTrackRegion(track, { skipOverlay: true, silent: true });
        }
        if (!state.active || !state.segments || !state.segments.length) {
            return [];
        }
        if (isExtraTrackRef(track)) {
            const slot = track.slot | 0;
            if (getTrackSegmentsBuildSlot === slot) {
                if (typeof window.regionRestoreDiagLog === 'function') {
                    window.regionRestoreDiagLog('getTrackSegments/reenter', {
                        ex: slot + 1,
                        hasQuick: !!getTrackSegmentsBuildQuick,
                    });
                }
                if (getTrackSegmentsBuildQuick) return getTrackSegmentsBuildQuick;
                return buildTrackSegmentsQuick(track);
            }
            const epoch = getRegionPersistEpoch(slot);
            const memo = trackSegmentsMemoBySlot[slot];
            if (memo && memo.epoch === epoch) {
                return memo.segments;
            }
            getTrackSegmentsBuildSlot = slot;
            getTrackSegmentsBuildQuick = null;
            try {
                const normalized = buildTrackSegmentsQuick(track);
                getTrackSegmentsBuildQuick = normalized;
                trackSegmentsMemoBySlot[slot] = { epoch, segments: normalized };
                return normalized;
            } finally {
                getTrackSegmentsBuildSlot = -1;
                getTrackSegmentsBuildQuick = null;
            }
        }
        return buildTrackSegmentsQuick(track);
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
        if (isTrackRegionActive(getVideoTrackRef())) return true;
        const n =
            getExtraTrackCount();
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

