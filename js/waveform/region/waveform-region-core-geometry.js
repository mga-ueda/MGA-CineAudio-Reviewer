/**
 * waveform-region-core-geometry.js — セグメント幾何・正規化・境界操作
 */
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
        if (seg && Number.isFinite(seg.pitchSemitones)) {
            const pitch = Math.max(
                REGION_PITCH_SEMITONES_MIN,
                Math.min(REGION_PITCH_SEMITONES_MAX, Math.round(seg.pitchSemitones)),
            );
            if (pitch !== 0) base.pitchSemitones = pitch;
        }
        if (seg && Number.isFinite(seg.fadeInSec)) {
            base.fadeInSec = Math.max(0, seg.fadeInSec);
        }
        if (seg && Number.isFinite(seg.fadeOutSec)) {
            base.fadeOutSec = Math.max(0, seg.fadeOutSec);
        }
        if (seg && seg.regionGroupId) {
            base.regionGroupId = String(seg.regionGroupId);
        }
        return base;
    }
    /** カーソル表示用（↔）。操作判定そのものは resolveRegionResizeHandleAtPointer の三角テスト */
    function isPointerOnAnyRegionFadeHandle(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        const n = getExtraTrackCount();
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            const lane = document.getElementById('extraAudioLane' + track.slot);
            if (!lane || lane.hidden) continue;
            const container = getPlaybackRegionsContainerEl(track);
            if (!container || container.hidden) continue;
            const regions = container.querySelectorAll(
                '.audio-waveform-lane__playback-region',
            );
            for (let r = 0; r < regions.length; r++) {
                const regionEl = regions[r];
                if (
                    isPointerInFadeHandleHitZone(regionEl, 'in', clientX, clientY) ||
                    isPointerInFadeHandleHitZone(regionEl, 'out', clientX, clientY)
                ) {
                    return true;
                }
            }
        }
        return false;
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
                stored = Math.max(0, state.regionTimelineInSec);
            }
        } else {
            const raw = getRawSegmentEntry(track, segmentIndex);
            if (raw && Number.isFinite(raw.regionTimelineInSec)) {
                stored = Math.max(0, raw.regionTimelineInSec);
            }
        }
        if (stored == null) return anchor;
        if (readRawRegionLeadPadSec(track, segmentIndex) > 0.00001) return stored;
        return stored < anchor - 0.00001 ? anchor : stored;
    }
    /**
     * リージョン右端（Out ハンドル）。
     * カスタム In があるとき Out は segment 先頭 + 長さのまま固定され、
     * regionIn + (anchor - regionIn + segDur) で In オフセットを反映する。
     */
    function getSegmentRegionTimelineOut(track, segmentIndex) {
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        const timelineEnd = getSegmentTimelineEnd(track, segmentIndex);
        const segDur = Math.max(0, timelineEnd - anchor);
        return regionIn + (anchor - regionIn + segDur);
    }
    /** オーバーレイ描画・外周 □ 判定と同じ [In, Out] 区間 */
    function getSegmentRegionOverlayTimelineInterval(track, segmentIndex) {
        const trackStart = getTrackTimelineStartSec(track);
        const start = Math.max(trackStart, getSegmentRegionTimelineIn(track, segmentIndex));
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
    /** 波形描画のタイムライン左端（リージョン In / 再生開始と同一） */
    function getSegmentWaveformDrawTimelineStart(track, segmentIndex) {
        return getSegmentWaveformVisibleTimelineStart(track, segmentIndex);
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
    function segmentSourceSecFromTransport(track, segmentIndex, transportSec) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return 0;
        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const t = Number(transportSec);
        const span = Math.max(0, seg.sourceOutSec - seg.sourceInSec);
        const local = Math.max(0, Math.min(span, t - playbackStart));
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
        return (
            typeof isPhraseOffMovableSplitBoundaryEnabled === 'function' &&
            isPhraseOffMovableSplitBoundaryEnabled()
        );
    }
    /** Shift+I — 左/In 側の境界で波形内容が連続していないときのみ */
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
    /** Shift+O — 右/Out 側の境界で波形内容が連続していないときのみ */
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
    /** Phrase OFF — リージョン端 nudge 量（参照位置の Tempo/Sig における 1 拍） */
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
    /** Phrase OFF — In を 1 拍分手前へ（In ハンドルドラッグと同じ経路） */
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
        if (isSeparatedSegment(track, segmentIndex)) {
            expandSeparatedSegmentRegionInLeft(
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

        if (newRegionIn >= anchor - 0.00001) {
            if (newRegionIn <= anchor + 0.00001) {
                setSegmentRegionTimelineIn(track, segmentIndex, anchor);
                setSegmentRegionLeadPadSec(track, segmentIndex, 0);
            } else {
                setSegmentRegionTimelineIn(track, segmentIndex, newRegionIn);
                setSegmentRegionLeadPadSec(track, segmentIndex, 0);
            }
        } else {
            setSegmentRegionTimelineIn(track, segmentIndex, newRegionIn);
            setSegmentRegionLeadPadSec(track, segmentIndex, anchor - newRegionIn);
        }

        finishRegionEdgeKeyboardNudge(track, segmentIndex, opt);
        return true;
    }
    /** Phrase OFF — Out を 1 拍分後方へ（Out ハンドルドラッグと同じ経路） */
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
            {
                silent: true,
                skipUndo: true,
                geometryOnly: !!(opt && opt.geometryOnly),
                skipPersist: !!(opt && opt.geometryOnly),
            },
        );
    }
    /**
     * セパレート列: リージョン In を手前へ広げつつ Out を固定（sourceIn を伸ばす）。
     * 手前のセグメントと重なってもよい。
     */
    function expandSeparatedSegmentRegionInLeft(track, segmentIndex, regionIn, audioEnd, t0, opt) {
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        if (regionIn < anchor - 0.00001) {
            extendSegmentAnchorLeft(track, segmentIndex, regionIn, audioEnd, t0, opt);
            return;
        }
        const prevRegionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const delta = prevRegionIn - regionIn;
        if (delta <= 0.00001) return;

        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        const seg = segments[segmentIndex];
        if (!seg) return;

        seg.timelineStartSec = anchor - delta;
        seg.sourceInSec = Math.max(0, seg.sourceInSec - delta);
        if (regionIn <= anchor + 0.00001) {
            delete seg.regionTimelineInSec;
            delete seg.regionLeadPadSec;
        } else {
            seg.regionTimelineInSec = regionIn;
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
    /**
     * セパレート列: リージョン In を後方へ狭げつつ Out を固定（sourceIn を戻す）。
     * 手前のセグメントと重なってもよい。
     */
    function contractSeparatedSegmentRegionInRight(track, segmentIndex, regionIn, audioEnd, t0, opt) {
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        const prevRegionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const delta = regionIn - prevRegionIn;
        if (delta <= 0.00001) return;

        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        const seg = segments[segmentIndex];
        if (!seg) return;

        const maxTrim = Math.max(
            0,
            seg.sourceOutSec - seg.sourceInSec - PLAYBACK_REGION_MIN_SEC,
        );
        const appliedDelta = Math.min(delta, maxTrim);
        if (appliedDelta <= 0.00001) return;

        const effectiveRegionIn = prevRegionIn + appliedDelta;
        seg.timelineStartSec = anchor + appliedDelta;
        seg.sourceInSec = Math.min(
            seg.sourceOutSec - PLAYBACK_REGION_MIN_SEC,
            seg.sourceInSec + appliedDelta,
        );
        if (effectiveRegionIn <= anchor + 0.00001) {
            delete seg.regionTimelineInSec;
            delete seg.regionLeadPadSec;
        } else {
            seg.regionTimelineInSec = effectiveRegionIn;
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
    /** リージョン本体の平行移動ドラッグ（offset drag）— In ハンドル／境界操作と区別 */
    function isParallelRegionOffsetDragOpt(opt) {
        return !!(
            opt &&
            Number.isFinite(opt.dragStartRegionIn) &&
            Number.isFinite(opt.dragStartAnchor)
        );
    }
    function applySegmentRegionInFromTransport(track, segmentIndex, transportSec, opt) {
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        const audioEnd = getSegmentTimelineEnd(track, segmentIndex);
        const t0 = getTrackTimelineStartSec(track);
        const prevRegionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        let regionIn = Math.max(
            0,
            Math.min(audioEnd - PLAYBACK_REGION_MIN_SEC, transportSec),
        );
        if (segmentIndex === 0) {
            regionIn = Math.max(t0, regionIn);
        }
        regionIn = clampSegmentTimelineStart(track, segmentIndex, regionIn);
        if (!isParallelRegionOffsetDragOpt(opt)) {
            if (
                segmentIndex > 0 &&
                typeof isSegmentMovableSplitBoundary === 'function' &&
                isSegmentMovableSplitBoundary(track, segmentIndex - 1)
            ) {
                setSplitBoundaryFromTransport(track, segmentIndex - 1, regionIn, opt);
                return;
            }
            if (
                isSeparatedSegment(track, segmentIndex) &&
                regionIn < prevRegionIn - 0.00001
            ) {
                expandSeparatedSegmentRegionInLeft(
                    track,
                    segmentIndex,
                    regionIn,
                    audioEnd,
                    t0,
                    opt,
                );
                return;
            }
            if (
                isSeparatedSegment(track, segmentIndex) &&
                regionIn > prevRegionIn + 0.00001
            ) {
                contractSeparatedSegmentRegionInRight(
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
        const maxPadIn = audioEnd - PLAYBACK_REGION_MIN_SEC;
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
        if (regionIn <= anchor + 0.00001) {
            setSegmentRegionTimelineIn(track, segmentIndex, anchor);
            setSegmentRegionLeadPadSec(track, segmentIndex, 0);
            if (opt && opt.geometryOnly) {
                refreshTrackRegionOverlayGeometry(track);
            } else {
                updateTrackRegionOverlays(track);
            }
            redrawAfterRegionChange(track.slot, {
                segmentIndex,
                geometryOnly: !!(opt && opt.geometryOnly),
            });
            return;
        }
        if (regionIn <= maxPadIn + 0.00001) {
            setSegmentRegionTimelineIn(track, segmentIndex, regionIn);
            setSegmentRegionLeadPadSec(track, segmentIndex, 0);
            if (opt && opt.geometryOnly) {
                refreshTrackRegionOverlayGeometry(track);
            } else {
                updateTrackRegionOverlays(track);
            }
            redrawAfterRegionChange(track.slot, {
                segmentIndex,
                geometryOnly: !!(opt && opt.geometryOnly),
            });
            return;
        }
        extendSegmentAnchorLeft(track, segmentIndex, regionIn, audioEnd, t0, opt);
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

