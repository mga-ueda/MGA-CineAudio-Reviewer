/**
 * waveform-region-boundary-join.js — セグメント境界結合・クロスフェード
 */
    function segmentBoundaryJoinEpsilonSec() {
        const frame =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        return Math.max(SEGMENT_BOUNDARY_JOIN_EPS_SEC, frame * 0.5);
    }

    function isSegmentBoundaryJoined(track, boundaryIndex) {
        const segments = getTrackSegments(track);
        if (boundaryIndex < 0 || boundaryIndex >= segments.length - 1) return false;
        const leftEnd = getSegmentTimelineEnd(track, boundaryIndex);
        const rightStart = getSegmentTimelineStart(track, boundaryIndex + 1);
        return Math.abs(leftEnd - rightStart) <= segmentBoundaryJoinEpsilonSec();
    }

    /** B 結合: 波形内容が連続している隣接境界のみ（分割直後相当） */
    function isSegmentBoundaryJoinableAtIndex(track, boundaryIndex) {
        if (!isSegmentSourceContinuousAtBoundary(track, boundaryIndex)) return false;
        if (hasManualSegmentFadeAtJoinedBoundary(track, boundaryIndex)) return false;
        if (hasExtendedCrossfadeOverlapAtBoundary(track, boundaryIndex)) return false;
        return true;
    }

    function playbackRegionBoundaryJoinBlockReason(track, boundaryIndex) {
        const segments = getTrackSegments(track);
        if (boundaryIndex < 0 || boundaryIndex >= segments.length - 1) {
            return 'invalid boundary';
        }
        if (!isSegmentSourceContinuousAtBoundary(track, boundaryIndex)) {
            if (!isSegmentBoundaryJoined(track, boundaryIndex)) {
                return 'timeline gap or overlap at boundary';
            }
            const left = segments[boundaryIndex];
            const right = segments[boundaryIndex + 1];
            if (!left || !right) return 'invalid boundary';
            const leftClip =
                left.clipId || getSegmentClipId(track, boundaryIndex);
            const rightClip =
                right.clipId || getSegmentClipId(track, boundaryIndex + 1);
            if (leftClip !== rightClip) return 'different clips at boundary';
            return 'source not continuous at boundary';
        }
        if (hasManualSegmentFadeAtJoinedBoundary(track, boundaryIndex)) {
            return 'crossfade at boundary';
        }
        if (hasExtendedCrossfadeOverlapAtBoundary(track, boundaryIndex)) {
            return 'crossfade overlap at boundary';
        }
        return 'unknown block reason';
    }

    /**
     * 結合アンカーは維持したまま、リージョン In/Out で重なりを広げた手動クロス。
     * 結合境界専用の 1 秒ハンドオフより長い／手前からの重なりがある。
     */
    /** 隣接セグメントのタイムライン重なり（結合境界の有無に依存しない） */
    function hasTimelineOverlapAtBoundary(track, boundaryIndex) {
        const segments = getTrackSegments(track);
        if (boundaryIndex < 0 || boundaryIndex >= segments.length - 1) return false;
        const oStart = Math.max(
            getSegmentPlaybackTimelineStart(track, boundaryIndex),
            getSegmentPlaybackTimelineStart(track, boundaryIndex + 1),
        );
        const oEnd = Math.min(
            getSegmentTimelineEnd(track, boundaryIndex),
            getSegmentTimelineEnd(track, boundaryIndex + 1),
        );
        return oEnd - oStart >= MIN_CROSSFADE_OVERLAP_SEC;
    }

    function hasExtendedCrossfadeOverlapAtBoundary(track, boundaryIndex) {
        if (!isSegmentBoundaryJoined(track, boundaryIndex)) return false;
        const boundaryT = getSegmentTimelineStart(track, boundaryIndex + 1);
        const rightPlay = getSegmentPlaybackTimelineStart(track, boundaryIndex + 1);
        const leftPlay = getSegmentPlaybackTimelineStart(track, boundaryIndex);
        const leftEnd = getSegmentTimelineEnd(track, boundaryIndex);
        const rightEnd = getSegmentTimelineEnd(track, boundaryIndex + 1);
        const overlapStart = Math.max(leftPlay, rightPlay);
        const overlapEnd = Math.min(leftEnd, rightEnd);
        const overlapDur = overlapEnd - overlapStart;
        if (overlapDur < MIN_CROSSFADE_OVERLAP_SEC) return false;
        if (
            rightPlay <
            boundaryT - JOINED_BOUNDARY_CROSSFADE_SEC + SEGMENT_BOUNDARY_JOIN_EPS_SEC
        ) {
            return true;
        }
        return (
            overlapDur >
            JOINED_BOUNDARY_CROSSFADE_SEC + SEGMENT_BOUNDARY_JOIN_EPS_SEC
        );
    }

    /** 結合境界で手動 Fade In/Out が設定されている（自動 1 秒ハンドオフは使わない） */
    function hasManualSegmentFadeAtJoinedBoundary(track, boundaryIndex) {
        if (!isSegmentBoundaryJoined(track, boundaryIndex)) return false;
        const fadeOut = getRawSegmentFadeSec(track, boundaryIndex, 'out');
        const fadeIn = getRawSegmentFadeSec(track, boundaryIndex + 1, 'in');
        return fadeOut > 0.0005 || fadeIn > 0.0005;
    }

    /** 結合境界の自動 1 秒ハンドオフ（現状未使用: ペースト/分割は境界ぴったり） */
    function isAutoJoinedBoundaryCrossfadeEligible(_track, _boundaryIndex) {
        return false;
    }

    /** 結合境界の手動フェード重なり区間（左 FadeOut + 右 FadeIn） */
    function getManualJoinedBoundaryFadeZone(track, boundaryIndex) {
        if (!hasManualSegmentFadeAtJoinedBoundary(track, boundaryIndex)) return null;
        const fadeOut = getRawSegmentFadeSec(track, boundaryIndex, 'out');
        const fadeIn = getRawSegmentFadeSec(track, boundaryIndex + 1, 'in');
        if (fadeOut <= 0.0005 && fadeIn <= 0.0005) return null;
        const boundaryT = getSegmentTimelineStart(track, boundaryIndex + 1);
        const totalSec = fadeOut + fadeIn;
        return {
            boundaryT,
            fadeOut,
            fadeIn,
            startSec: boundaryT - fadeOut,
            endSec: boundaryT + fadeIn,
            totalSec,
        };
    }

    function findManualJoinedBoundaryFadeAtTransport(track, segmentIndex, transportSec) {
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return null;
        const segments = getTrackSegments(track);
        if (segmentIndex > 0) {
            const boundaryIndex = segmentIndex - 1;
            const zone = getManualJoinedBoundaryFadeZone(track, boundaryIndex);
            if (
                zone &&
                t >= zone.startSec - 0.0005 &&
                t <= zone.endSec + 0.0005
            ) {
                return { zone, boundaryIndex, role: 'right' };
            }
        }
        if (segmentIndex < segments.length - 1) {
            const boundaryIndex = segmentIndex;
            const zone = getManualJoinedBoundaryFadeZone(track, boundaryIndex);
            if (
                zone &&
                t >= zone.startSec - 0.0005 &&
                t <= zone.endSec + 0.0005
            ) {
                return { zone, boundaryIndex, role: 'left' };
            }
        }
        return null;
    }

    /**
     * 結合境界の手動フェード（再生）: 二次 ease。左は境界より後は 0、右は境界より前は 0。
     */
    function computeManualJoinedBoundaryFadeLinear(track, segmentIndex, transportSec) {
        const hit = findManualJoinedBoundaryFadeAtTransport(
            track,
            segmentIndex,
            transportSec,
        );
        if (!hit) return null;
        const { zone, role } = hit;
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return null;
        if (role === 'left') {
            if (t >= zone.boundaryT - 0.0005) return 0;
            if (!(zone.fadeOut > 0.0005)) return null;
            const p = Math.max(
                0,
                Math.min(1, (t - zone.startSec) / zone.fadeOut),
            );
            return manualJoinedBoundaryFadeOutGain(p);
        }
        if (t < zone.boundaryT - 0.0005) return 0;
        if (!(zone.fadeIn > 0.0005)) return null;
        const p = Math.max(
            0,
            Math.min(1, (t - zone.boundaryT) / zone.fadeIn),
        );
        return manualJoinedBoundaryFadeInGain(p);
    }

    /** 波形表示: リージョン内のみ（タイムライン外へは伸ばさない） */
    function computeManualJoinedBoundaryFadeLinearForDisplay(
        track,
        segmentIndex,
        transportSec,
    ) {
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return null;
        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const absEnd = getSegmentTimelineEnd(track, segmentIndex);
        if (t < playbackStart - 0.0005 || t > absEnd + 0.0005) return null;
        return computeManualJoinedBoundaryFadeLinear(track, segmentIndex, transportSec);
    }

    function segmentSourceSecForManualJoinedCrossfade(
        track,
        segmentIndex,
        transportSec,
        boundaryIndex,
    ) {
        const zone = getManualJoinedBoundaryFadeZone(track, boundaryIndex);
        const segments = getTrackSegments(track);
        const left = segments[boundaryIndex];
        const right = segments[boundaryIndex + 1];
        if (!zone || !left || !right) {
            return segmentSourceSecFromTransport(track, segmentIndex, transportSec);
        }
        if (isSegmentSourceContinuousAtBoundary(track, boundaryIndex)) {
            const sourceAtB = Number(left.sourceOutSec) || 0;
            const src = sourceAtB + (Number(transportSec) - zone.boundaryT);
            if (segmentIndex === boundaryIndex) {
                return Math.max(
                    left.sourceInSec,
                    Math.min(left.sourceOutSec, src),
                );
            }
            return Math.max(
                right.sourceInSec,
                Math.min(right.sourceOutSec, src),
            );
        }
        return segmentSourceSecFromTransport(track, segmentIndex, transportSec);
    }

    function isTransportInManualJoinedBoundaryFadeZone(track, segmentIndex, transportSec) {
        return !!findManualJoinedBoundaryFadeAtTransport(
            track,
            segmentIndex,
            transportSec,
        );
    }

    /** Phrase オフ時のみ — スプリット境界ドラッグのタイムライン／ソースずれ許容 */
    const PHRASE_OFF_MOVABLE_SPLIT_BOUNDARY_TOLERANCE_SEC = 0.1;

    function isPhraseOffMovableSplitBoundaryEnabled() {
        if (
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible()
        ) {
            return false;
        }
        return true;
    }

    function phraseOffMovableSplitBoundaryToleranceSec() {
        return PHRASE_OFF_MOVABLE_SPLIT_BOUNDARY_TOLERANCE_SEC;
    }

    /** 同一クリップでソース上の分割点が共有されている（タイムライン結合は未要求） */
    function isSegmentSourceSplitAtBoundary(track, boundaryIndex) {
        const segments = getTrackSegments(track);
        if (boundaryIndex < 0 || boundaryIndex >= segments.length - 1) return false;
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
            ) <= segmentBoundaryJoinEpsilonSec()
        );
    }

    /**
     * スプリット境界をドラッグで移動できる隣接ペア。
     * タイムライン上の隣接（重なり／微小隙間）のみ。ソース分割点が共有されていても
     * タイムラインが離れていればハンドルは出さない（平行移動後の隙間中央の縦線を防ぐ）。
     */
    function isSegmentMovableSplitBoundary(track, boundaryIndex) {
        if (!isPhraseOffMovableSplitBoundaryEnabled()) return false;
        const segments = getTrackSegments(track);
        if (boundaryIndex < 0 || boundaryIndex >= segments.length - 1) return false;
        const left = segments[boundaryIndex];
        const right = segments[boundaryIndex + 1];
        if (!left || !right) return false;
        const leftClip =
            left.clipId || getSegmentClipId(track, boundaryIndex);
        const rightClip =
            right.clipId || getSegmentClipId(track, boundaryIndex + 1);
        if (leftClip !== rightClip) return false;
        const tol = phraseOffMovableSplitBoundaryToleranceSec();
        const leftEnd = getSegmentTimelineEnd(track, boundaryIndex);
        const rightStart = getSegmentTimelineStart(track, boundaryIndex + 1);
        return Math.abs(leftEnd - rightStart) <= tol;
    }

    /** タイムライン結合かつクリップ内ソースが連続（分割直後・B結合可能な境界） */
    function isSegmentSourceContinuousAtBoundary(track, boundaryIndex) {
        if (!isSegmentBoundaryJoined(track, boundaryIndex)) return false;
        return isSegmentSourceSplitAtBoundary(track, boundaryIndex);
    }

    /** 同一クリップ連続結合チェーンのソース終端（再生ではリージョン境界を跨いで1本） */
    function getContinuousJoinedSourceOutSec(track, segmentIndex) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return 0;
        let outSec = Number(seg.sourceOutSec) || 0;
        for (let b = segmentIndex; b < segments.length - 1; b++) {
            if (!isSegmentBoundaryJoined(track, b)) break;
            if (!isSegmentSourceContinuousAtBoundary(track, b)) break;
            if (
                typeof boundaryNeedsPitchPlaybackSplit === 'function' &&
                boundaryNeedsPitchPlaybackSplit(track, b)
            ) {
                break;
            }
            const next = segments[b + 1];
            if (!next) break;
            outSec = Number(next.sourceOutSec) || outSec;
        }
        return outSec;
    }

    /**
     * 結合境界: 入側をフェード開始位置から再生する計画（ソース連続時は左の BufferSource クロックに同期）
     * @returns {{ whenCtx: number, bufferOff: number, remain: number, transportAnchor: number } | null}
     */
    function planIncomingSegmentStartAtJoinedBoundary(track, segmentIndex, ctx, opt) {
        if (!ctx || segmentIndex < 1) return null;
        const boundaryIndex = segmentIndex - 1;
        if (!isSegmentBoundaryJoined(track, boundaryIndex)) return null;
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return null;
        const boundaryT = getSegmentTimelineStart(track, segmentIndex);
        const fadeTransportSec = boundaryT - JOINED_BOUNDARY_CROSSFADE_SEC;
        const mapT =
            opt && Number.isFinite(opt.mapTransportSec)
                ? opt.mapTransportSec
                : fadeTransportSec;
        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const sourceContinuous = isSegmentSourceContinuousAtBoundary(
            track,
            boundaryIndex,
        );
        const liveHit = mapAllSegmentsAtTransport(track, mapT, {
            forPlayback: true,
        }).find((h) => h.segmentIndex === segmentIndex);
        if (!liveHit || liveHit.remain <= 0.002) return null;
        const bufferOff = liveHit.bufferOff;
        const remain = liveHit.remain;
        let whenCtx = ctx.currentTime + 0.0005;
        const leftEntry = opt && opt.leftEntry ? opt.leftEntry : null;
        const inCrossfadeLeadIn = mapT < playbackStart - 0.0005;
        if (
            inCrossfadeLeadIn &&
            sourceContinuous &&
            leftEntry &&
            leftEntry.src &&
            Number.isFinite(leftEntry.playbackAnchorCtxTime) &&
            Number.isFinite(leftEntry.bufferOff)
        ) {
            let leftSourceSecNow;
            if (leftEntry.usesPitchSlice) {
                const leftSeg = segments[segmentIndex - 1];
                const leftSourceIn = leftSeg ? leftSeg.sourceInSec : 0;
                leftSourceSecNow =
                    leftSourceIn + Math.max(0, Number(leftEntry.bufferOff) || 0);
            } else {
                leftSourceSecNow = Number.isFinite(leftEntry.absoluteBufferOff)
                    ? leftEntry.absoluteBufferOff
                    : leftEntry.bufferOff;
            }
            const elapsed = Math.max(
                0,
                ctx.currentTime - leftEntry.playbackAnchorCtxTime,
            );
            leftSourceSecNow = Math.min(
                segments[segmentIndex - 1]
                    ? segments[segmentIndex - 1].sourceOutSec
                    : leftSourceSecNow + elapsed,
                leftSourceSecNow + elapsed,
            );
            const incomingSourceAtStart = segmentSourceSecFromTransport(
                track,
                segmentIndex,
                playbackStart,
            );
            whenCtx =
                ctx.currentTime +
                Math.max(0.0005, playbackStart - mapT);
            if (leftEntry.usesPitchSlice) {
                const sourceLeadSec = Math.max(
                    0,
                    incomingSourceAtStart - leftSourceSecNow,
                );
                whenCtx = Math.max(
                    whenCtx,
                    leftEntry.playbackAnchorCtxTime +
                        Math.max(0, sourceLeadSec - elapsed),
                );
            } else {
                const fadeBuf = segmentSourceSecFromTransport(
                    track,
                    segmentIndex - 1,
                    fadeTransportSec,
                );
                whenCtx = Math.max(
                    whenCtx,
                    leftEntry.playbackAnchorCtxTime +
                        Math.max(0, fadeBuf - leftSourceSecNow),
                );
            }
        } else if (inCrossfadeLeadIn && mapT < fadeTransportSec) {
            whenCtx = ctx.currentTime + Math.max(0.0005, fadeTransportSec - mapT);
        }
        if (whenCtx < ctx.currentTime) {
            whenCtx = ctx.currentTime + 0.0005;
        }
        return {
            whenCtx,
            bufferOff,
            remain,
            transportAnchor: mapT,
        };
    }

    function shouldShowSegmentInHandle(track, segmentIndex) {
        if (segmentIndex === 0) return true;
        if (isSegmentMovableSplitBoundary(track, segmentIndex - 1)) return false;
        return !isSegmentBoundaryJoined(track, segmentIndex - 1);
    }

    function shouldShowSegmentOutHandle(track, segmentIndex) {
        const segments = getTrackSegments(track);
        if (segmentIndex >= segments.length - 1) return true;
        if (isSegmentMovableSplitBoundary(track, segmentIndex)) return false;
        return !isSegmentBoundaryJoined(track, segmentIndex);
    }

