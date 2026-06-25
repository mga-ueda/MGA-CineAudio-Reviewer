/**

 * video-viz-track.js — 動画映像タイムラインレーン（分割・In/Out、filmstrip サムネイル）

 */

    const VIDEO_TRACK_REF = { type: 'video' };

    /** filmstrip キャプチャ高さ（100% 表示 ≒ 32px × 4 = 128px。表示は CSS でレーン高に合わせて縮小） */
    const VIDEO_VIZ_FILMSTRIP_THUMB_HEIGHT_BASE_PX = 32;
    const VIDEO_VIZ_FILMSTRIP_CAPTURE_HEIGHT_PX =
        VIDEO_VIZ_FILMSTRIP_THUMB_HEIGHT_BASE_PX * 4;

    /** 表示時の最大拡大率（自然幅 = レーン高 × アスペクト比）。枚数間引きの下限に使用 */
    const VIDEO_VIZ_FILMSTRIP_MAX_DISPLAY_SCALE = 4;

    /**
     * filmstrip 表示制約（ユーザー指定）:
     * - 縦横比を変えない
     * - レターボックス（黒帯）を出さない
     * - サムネイル同士の間に隙間を開けない（セルは常に右端まで連続。時間軸はスロットで概ね追随）
     * - 上下で見切れない（高さ 100%・幅はアスペクト比に追随、横のみクリップ可）
     */

    /** 波形 offset ドラッグ・スプリット解決で Video レーンを指すスロット番号 */

    const VIDEO_WAVEFORM_OFFSET_DRAG_SLOT = -2;

    /** Video Audio レーン平行移動ヒット用（状態は Video トラックと共有） */

    const VIDEO_AUDIO_WAVEFORM_OFFSET_DRAG_SLOT = -3;



    function isVideoWaveformOffsetDragSlot(slot) {

        return slot === VIDEO_WAVEFORM_OFFSET_DRAG_SLOT;

    }



    function isVideoAudioWaveformOffsetDragSlot(slot) {

        return slot === VIDEO_AUDIO_WAVEFORM_OFFSET_DRAG_SLOT;

    }



    function isVideoLinkedOffsetDragSlot(slot) {

        return isVideoWaveformOffsetDragSlot(slot) || isVideoAudioWaveformOffsetDragSlot(slot);

    }



    /** Video / Video Audio ヒットは状態キーを -2 に統一 */

    function normalizeVideoLinkedOffsetDragSlot(slot) {

        if (isVideoLinkedOffsetDragSlot(slot)) return VIDEO_WAVEFORM_OFFSET_DRAG_SLOT;

        return slot;

    }



    function trackRefFromWaveformOffsetDragSlot(slot) {

        if (isVideoLinkedOffsetDragSlot(slot)) return getVideoTrackRef();

        return { type: 'extra', slot: slot | 0 };

    }



    function getTrackOffsetDragSlot(track) {

        if (isVideoTrackRef(track)) return VIDEO_WAVEFORM_OFFSET_DRAG_SLOT;

        if (isExtraTrackRef(track)) return track.slot | 0;

        return -1;

    }



    function offsetDragSlotMatchesTrack(dragSlot, track) {

        if (isVideoTrackRef(track)) return isVideoLinkedOffsetDragSlot(dragSlot);

        return isExtraTrackRef(track) && dragSlot === (track.slot | 0);

    }



    function isVideoRegionEntrySelected(segmentIndex) {

        if (!(segmentIndex >= 0)) return false;

        if (typeof isRegionEntrySelected !== 'function') return false;

        return (

            isRegionEntrySelected(VIDEO_WAVEFORM_OFFSET_DRAG_SLOT, segmentIndex) ||

            isRegionEntrySelected(VIDEO_AUDIO_WAVEFORM_OFFSET_DRAG_SLOT, segmentIndex)

        );

    }



    function toggleVideoLinkedRegionSelection(segmentIndex) {

        if (!(segmentIndex >= 0) || typeof toggleRegionSelection !== 'function') return;

        toggleRegionSelection(VIDEO_WAVEFORM_OFFSET_DRAG_SLOT, segmentIndex);

    }



    function isVideoRegionHandleDragWaveformPreviewActive() {
        return !!(
            typeof regionHandleDragActive !== 'undefined' &&
            regionHandleDragActive &&
            (regionHandleDragKind === 'in' || regionHandleDragKind === 'out') &&
            regionHandleDragTrack &&
            typeof isVideoTrackRef === 'function' &&
            isVideoTrackRef(regionHandleDragTrack) &&
            regionHandleDragSegmentIndex >= 0
        );
    }

    function resolveVideoTrackWaveformDrawSegmentIndex(track, segments) {
        if (isVideoRegionHandleDragWaveformPreviewActive()) {
            return Math.min(regionHandleDragSegmentIndex, segments.length - 1);
        }
        return 0;
    }

    /** 映像波形描画 — 適用済みリージョンまたはセッション復元 pending */
    function resolveVideoTrackWaveformRegionSegment() {
        const track = getVideoTrackRef();
        if (!track) return null;
        const regionActive =
            typeof isTrackRegionActive === 'function' && isTrackRegionActive(track);
        if (regionActive) {
            const segments =
                typeof getTrackSegments === 'function' ? getTrackSegments(track) : [];
            const segmentIndex = resolveVideoTrackWaveformDrawSegmentIndex(track, segments);
            const seg = segments[segmentIndex];
            if (!seg) return null;
            return { track, seg, segmentIndex, regionActive: true };
        }
        const pending =
            typeof getPendingPlaybackRegionRestoreVideoEntry === 'function'
                ? getPendingPlaybackRegionRestoreVideoEntry()
                : null;
        if (!pending || !Array.isArray(pending.segments) || !pending.segments.length) {
            return null;
        }
        return { track, seg: pending.segments[0], pendingEntry: pending, regionActive: false };
    }

    function isVideoTrackWaveformRegionDrawActive() {
        return !!resolveVideoTrackWaveformRegionSegment();
    }

    function resolveRegionInForVideoWaveformDraw(
        track,
        seg,
        segmentIndex,
        regionActive,
        pendingEntry,
    ) {
        const si = segmentIndex >= 0 ? segmentIndex : 0;
        let anchor = regionActive
            ? typeof getSegmentTimelineStart === 'function'
                ? getSegmentTimelineStart(track, si)
                : 0
            : Number.isFinite(seg.timelineStartSec)
              ? seg.timelineStartSec
              : 0;
        let regionIn = NaN;
        if (regionActive && typeof getSegmentRegionTimelineIn === 'function') {
            regionIn = getSegmentRegionTimelineIn(track, si);
        } else if (Number.isFinite(seg.regionTimelineInSec)) {
            regionIn = seg.regionTimelineInSec;
        } else if (Number.isFinite(pendingEntry?.regionTimelineInSec)) {
            regionIn = pendingEntry.regionTimelineInSec;
        } else {
            regionIn = anchor;
        }
        let sourceIn = Math.max(0, Number(seg.sourceInSec) || 0);
        if (
            isVideoRegionHandleDragWaveformPreviewActive() &&
            typeof getTrackSegments === 'function'
        ) {
            const dragSegIdx = resolveVideoTrackWaveformDrawSegmentIndex(
                track,
                getTrackSegments(track),
            );
            if (dragSegIdx >= 0) {
                if (typeof getSegmentRegionTimelineIn === 'function') {
                    regionIn = getSegmentRegionTimelineIn(track, dragSegIdx);
                }
                if (typeof getSegmentTimelineStart === 'function') {
                    anchor = getSegmentTimelineStart(track, dragSegIdx);
                }
                const dragSeg = getTrackSegments(track)[dragSegIdx];
                if (dragSeg) {
                    sourceIn = Math.max(0, Number(dragSeg.sourceInSec) || 0);
                }
            }
        }
        return { anchor, regionIn, sourceIn };
    }

    /** 再生開始（ソース先頭が鳴り始めるタイムライン位置）。pending 復元時は seg から推定。 */
    function resolvePlaybackStartForVideoWaveformDraw(
        track,
        seg,
        segmentIndex,
        regionActive,
        regionIn,
        anchor,
    ) {
        const si = segmentIndex >= 0 ? segmentIndex : 0;
        if (
            isVideoRegionHandleDragWaveformPreviewActive() &&
            typeof getSegmentPlaybackTimelineStart === 'function' &&
            typeof getTrackSegments === 'function'
        ) {
            const dragSegIdx = resolveVideoTrackWaveformDrawSegmentIndex(
                track,
                getTrackSegments(track),
            );
            if (dragSegIdx >= 0) {
                return getSegmentPlaybackTimelineStart(track, dragSegIdx);
            }
        }
        if (regionActive && typeof getSegmentPlaybackTimelineStart === 'function') {
            return getSegmentPlaybackTimelineStart(track, si);
        }
        if (regionIn > anchor + 0.00001) {
            return regionIn;
        }
        const leadPad = Math.max(0, Number(seg.regionLeadPadSec) || 0);
        if (leadPad > 0.00001) {
            return regionIn + leadPad;
        }
        return anchor;
    }

    /**
     * 映像波形描画パラメータ。
     * ソース 0 を timeline (playbackStart - sourceIn) に置き、clipStart=regionIn / clipEnd=regionOut で
     * In・Out トリムは左右クリップ。タイムライン幅はリージョン編集後の実効終端に合わせる。
     */
    function resolveVideoTrackWaveformDrawParams() {
        const ctx = resolveVideoTrackWaveformRegionSegment();
        if (!ctx) return null;
        const { track, seg, pendingEntry, regionActive } = ctx;
        const segmentIndex = ctx.segmentIndex >= 0 ? ctx.segmentIndex : 0;
        const segments =
            regionActive && typeof getTrackSegments === 'function'
                ? getTrackSegments(track)
                : [seg];
        const segCount = segments.length;
        const firstSeg = segments[0] || seg;
        const lastSeg = segments[segments.length - 1] || seg;
        const chainSourceIn = Math.max(0, Number(firstSeg.sourceInSec) || 0);
        const chainSourceOut = Number.isFinite(lastSeg.sourceOutSec)
            ? lastSeg.sourceOutSec
            : Number(seg.sourceOutSec) || 0;
        const { anchor, regionIn, sourceIn } = resolveRegionInForVideoWaveformDraw(
            track,
            seg,
            segmentIndex,
            regionActive,
            pendingEntry,
        );
        const srcOut = segCount > 1 ? chainSourceOut : Number.isFinite(seg.sourceOutSec) ? seg.sourceOutSec : 0;
        if (!(srcOut > 0.0005)) return null;
        const fullSourceDur =
            typeof getVideoTrackSourceDurationSec === 'function'
                ? getVideoTrackSourceDurationSec()
                : 0;
        const waveformSourceOut =
            fullSourceDur > 0.0005 ? Math.max(srcOut, fullSourceDur) : srcOut;
        const playbackStart = resolvePlaybackStartForVideoWaveformDraw(
            track,
            segCount > 1 ? firstSeg : seg,
            segCount > 1 ? 0 : segmentIndex,
            regionActive,
            segCount > 1 && typeof getSegmentRegionTimelineIn === 'function'
                ? getSegmentRegionTimelineIn(track, 0)
                : regionIn,
            segCount > 1 && typeof getSegmentTimelineStart === 'function'
                ? getSegmentTimelineStart(track, 0)
                : anchor,
        );
        const effectiveSourceIn = segCount > 1 ? chainSourceIn : sourceIn;
        const timelineStartSec = Math.max(0, playbackStart - effectiveSourceIn);
        let clipStartSec = null;
        const clipRegionIn =
            segCount > 1 && typeof getSegmentRegionTimelineIn === 'function'
                ? getSegmentRegionTimelineIn(track, 0)
                : regionIn;
        if (clipRegionIn > timelineStartSec + 0.00001) {
            clipStartSec = clipRegionIn;
        }
        let clipEndSec = null;
        if (regionActive) {
            const end = getVideoTrackRegionTimelineEndSec();
            if (end > 0) clipEndSec = end;
        } else if (Number.isFinite(seg.regionTimelineOutSec) && seg.regionTimelineOutSec > 0) {
            clipEndSec = seg.regionTimelineOutSec;
        }
        const sourceSpan = Math.max(0, srcOut - effectiveSourceIn);
        let timelineContentEnd = playbackStart + sourceSpan;
        if (regionActive && segCount > 1) {
            const trackEnd = getVideoTrackRegionTimelineEndSec();
            if (trackEnd > timelineStartSec) {
                timelineContentEnd = trackEnd;
            }
        } else if (Number.isFinite(clipEndSec) && clipEndSec > 0) {
            timelineContentEnd = Math.min(timelineContentEnd, clipEndSec);
        }
        const contentDurSec = Math.max(
            0.01,
            timelineContentEnd - Math.max(0, timelineStartSec),
        );
        return {
            timelineStartSec,
            clipStartSec,
            clipEndSec,
            contentDurSec,
            sourceInSec: effectiveSourceIn,
            sourceOutSec: waveformSourceOut,
            regionInSec: clipRegionIn,
            playbackStartSec: playbackStart,
            anchorSec: anchor,
            multiSegment: segCount > 1,
        };
    }

    /** 複数セグメント — 各セグメントの sourceIn/Out とタイムライン位置で波形を描画 */
    function drawVideoTrackMultiSegmentWaveform(ctx, peaks, wCss, hCss, fullSourceDur, grad, drawOpt) {
        const track = getVideoTrackRef();
        if (!track || !peaks || !peaks.length || !(fullSourceDur > 0.0005)) return false;
        const segments =
            typeof getTrackSegments === 'function' ? getTrackSegments(track) : [];
        const handleDragPreview = isVideoRegionHandleDragWaveformPreviewActive();
        if (segments.length < 2 && !handleDragPreview) return false;

        const peaksSourceDur =
            typeof getVideoTrackSourceDurationSec === 'function'
                ? getVideoTrackSourceDurationSec()
                : fullSourceDur;
        const sliceDur = peaksSourceDur > 0.0005 ? peaksSourceDur : fullSourceDur;

        const o = drawOpt && typeof drawOpt === 'object' ? drawOpt : {};
        const layoutW =
            typeof resolveTimelineLayoutW === 'function'
                ? resolveTimelineLayoutW(wCss, o)
                : wCss;
        const xOffset = Number.isFinite(o.timelineXOffset) ? o.timelineXOffset : 0;
        const mid = hCss * 0.5;
        const vScale =
            typeof getWaveformVerticalZoom === 'function' ? getWaveformVerticalZoom() : 1;
        const scale = Number.isFinite(vScale) ? vScale : 1;

        ctx.clearRect(0, 0, wCss, hCss);
        ctx.fillStyle =
            typeof TIMELINE_LANE_TRACK_BG !== 'undefined'
                ? TIMELINE_LANE_TRACK_BG
                : '#161820';
        ctx.fillRect(0, 0, wCss, hCss);

        ctx.save();
        if (xOffset) ctx.translate(-xOffset, 0);
        ctx.fillStyle = grad || '#ffffff';

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const srcIn = Math.max(0, Number(seg.sourceInSec) || 0);
            const srcOut = Number(seg.sourceOutSec) || 0;
            if (!(srcOut > srcIn + 0.0005)) continue;
            const segPeaks =
                typeof slicePeaksForRegion === 'function'
                    ? slicePeaksForRegion(peaks, sliceDur, srcIn, srcOut)
                    : null;
            if (!segPeaks || !segPeaks.length) continue;

            const segT0 =
                typeof getSegmentTimelineStartForWaveformDraw === 'function'
                    ? getSegmentTimelineStartForWaveformDraw(track, i)
                    : typeof getSegmentTimelineStart === 'function'
                      ? getSegmentTimelineStart(track, i)
                      : 0;
            const playbackStart =
                typeof getSegmentPlaybackTimelineStart === 'function'
                    ? getSegmentPlaybackTimelineStart(track, i)
                    : segT0;
            const barOrigin = playbackStart;
            const segContentDur = srcOut - srcIn;
            const contentW =
                typeof masterTimelineContentWidth === 'function'
                    ? masterTimelineContentWidth(layoutW, segContentDur)
                    : layoutW;
            const drawW = contentW > 0 ? contentW : layoutW;
            const barW = drawW / segPeaks.length;
            const hideBefore =
                typeof getSegmentWaveformHideBeforeTimeline === 'function'
                    ? getSegmentWaveformHideBeforeTimeline(track, i)
                    : segT0;
            const hideAfter =
                typeof getSegmentRegionTimelineOut === 'function'
                    ? getSegmentRegionTimelineOut(track, i)
                    : Infinity;

            for (let p = 0; p < segPeaks.length; p++) {
                const barTransport =
                    barOrigin + ((p + 0.5) / segPeaks.length) * segContentDur;
                if (barTransport < hideBefore - 0.0005) continue;
                if (barTransport > hideAfter + 0.0005) continue;
                const pk = segPeaks[p];
                if (!pk) continue;
                const x =
                    typeof masterTimelineContentWidth === 'function'
                        ? masterTimelineContentWidth(layoutW, barTransport) - barW * 0.5
                        : p * barW;
                const top = mid - Math.max(0.5, pk.max * scale * (mid - 2));
                const bot = mid - Math.min(-0.5, pk.min * scale * (mid - 2));
                ctx.fillRect(x, top, Math.max(1, barW), bot - top);
            }
        }

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xOffset, mid);
        ctx.lineTo(xOffset + wCss, mid);
        ctx.stroke();
        ctx.restore();
        return true;
    }

    function shouldDrawVideoTrackMultiSegmentWaveform() {
        const track = getVideoTrackRef();
        if (typeof isTrackRegionActive !== 'function' || !isTrackRegionActive(track)) {
            return false;
        }
        if (isVideoRegionHandleDragWaveformPreviewActive()) {
            return true;
        }
        const segments =
            typeof getTrackSegments === 'function' ? getTrackSegments(track) : [];
        return segments.length > 1;
    }

    function getVideoTrackWaveformTimelineStartSec() {
        const p = resolveVideoTrackWaveformDrawParams();
        return p ? p.timelineStartSec : 0;
    }

    function getVideoTrackWaveformTimelineClipStartSec() {
        const p = resolveVideoTrackWaveformDrawParams();
        return p && Number.isFinite(p.clipStartSec) ? p.clipStartSec : null;
    }

    /** 映像音声波形の右端クリップ（リージョン Out）。非リージョン時は null。 */
    function getVideoTrackWaveformTimelineClipEndSec() {
        const p = resolveVideoTrackWaveformDrawParams();
        return p && Number.isFinite(p.clipEndSec) ? p.clipEndSec : null;
    }



    function getVideoAudioPlaybackRegionsContainerEl() {

        return typeof audioWaveformLaneVideo !== 'undefined' && audioWaveformLaneVideo

            ? audioWaveformLaneVideo.querySelector('.audio-waveform-lane__playback-regions')

            : null;

    }

    /** 映像トラックのリージョン操作対象レーン（映像 viz / Video Audio ミラー）。表示中のみ。 */
    function collectVideoPlaybackRegionLaneContexts() {
        const contexts = [];
        const track = getVideoTrackRef();
        if (
            typeof isVideoVizLaneShown === 'function' &&
            isVideoVizLaneShown() &&
            videoVizLane &&
            !videoVizLane.hidden
        ) {
            const container =
                typeof getPlaybackRegionsContainerEl === 'function'
                    ? getPlaybackRegionsContainerEl(track)
                    : videoVizLane.querySelector('.audio-waveform-lane__playback-regions');
            if (container) contexts.push({ track, lane: videoVizLane, container });
        }
        const videoAudioLane =
            typeof audioWaveformLaneVideo !== 'undefined' ? audioWaveformLaneVideo : null;
        if (videoAudioLane && !videoAudioLane.hidden) {
            const container = getVideoAudioPlaybackRegionsContainerEl();
            if (container) contexts.push({ track, lane: videoAudioLane, container });
        }
        return contexts;
    }

    window.collectVideoPlaybackRegionLaneContexts = collectVideoPlaybackRegionLaneContexts;



    function syncVideoAudioLaneRegionOverlays(track) {

        if (!isVideoTrackRef(track)) return;

        const container = getVideoAudioPlaybackRegionsContainerEl();

        if (!container) return;

        const segments =

            typeof getTrackSegments === 'function' ? getTrackSegments(track) : [];

        if (!segments.length) {

            container.hidden = true;

            return;

        }

        container.hidden = false;

        container.replaceChildren();

        for (let i = 0; i < segments.length; i++) {

            const seg = segments[i];

            const el =

                typeof buildRegionOverlayEl === 'function'

                    ? buildRegionOverlayEl(track, i, seg, null, { videoAudioMirror: true })

                    : null;

            if (!el) continue;

            if (typeof positionRegionOverlayEl === 'function') {

                positionRegionOverlayEl(el, track, i, seg);

            }

            container.appendChild(el);

        }

        if (typeof appendTrackRegionSplitHandlesToContainer === 'function') {
            appendTrackRegionSplitHandlesToContainer(track, container);
        }

        if (typeof syncRegionSelectionClasses === 'function') {
            syncRegionSelectionClasses();
        }

        if (typeof scheduleWaveformRegionOverlayRefresh === 'function') {
            scheduleWaveformRegionOverlayRefresh();
        }

        if (typeof audioWaveformLaneVideo !== 'undefined' && audioWaveformLaneVideo) {

            audioWaveformLaneVideo.classList.toggle(

                'audio-waveform-lane--has-regions',

                segments.length > 0,

            );

        }

    }



    function refreshVideoAudioLaneRegionOverlayGeometry(track) {

        if (!isVideoTrackRef(track)) return;

        const container = getVideoAudioPlaybackRegionsContainerEl();

        if (!container || container.hidden) return;

        const segments =

            typeof getTrackSegments === 'function' ? getTrackSegments(track) : [];

        const regionEls = container.querySelectorAll('.audio-waveform-lane__playback-region');

        const splitHandles = container.querySelectorAll(
            '.audio-waveform-lane__playback-region__handle--split',
        );

        const expectedSplitHandles =
            typeof countTrackRegionSplitHandles === 'function'
                ? countTrackRegionSplitHandles(track)
                : Math.max(0, segments.length - 1);

        if (
            regionEls.length !== segments.length ||
            splitHandles.length !== expectedSplitHandles
        ) {

            syncVideoAudioLaneRegionOverlays(track);

            return;

        }

        for (let i = 0; i < segments.length; i++) {

            if (typeof positionRegionOverlayEl === 'function') {

                positionRegionOverlayEl(regionEls[i], track, i, segments[i]);

            }

        }

        if (
            typeof refreshTrackRegionSplitHandlesInContainer === 'function' &&
            !refreshTrackRegionSplitHandlesInContainer(track, container)
        ) {
            syncVideoAudioLaneRegionOverlays(track);
            return;
        }

        if (typeof scheduleWaveformRegionOverlayRefresh === 'function') {
            scheduleWaveformRegionOverlayRefresh();
        }

    }



    function finalizeVideoLinkedOffsetDragPresentation() {

        syncVideoAudioLaneRegionOverlays(getVideoTrackRef());

        if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();

        if (typeof renderVideoVizFilmstrip === 'function') renderVideoVizFilmstrip();

        if (
            !videoTrackFilmstripFrames.length &&
            typeof scheduleVideoTrackFilmstripBuild === 'function'
        ) {
            scheduleVideoTrackFilmstripBuild();
        }

        if (typeof applyVideoTimeForTransportSec === 'function' && typeof getTransportSec === 'function') {
            applyVideoTimeForTransportSec(getTransportSec(), { force: true });
        }

        if (typeof window.videoRegionDiagLog === 'function') {
            window.videoRegionDiagLog('offset/drop', {
                transportSec:
                    typeof getTransportSec === 'function' ? getTransportSec() : undefined,
            });
        }

        if (typeof bumpVideoRegionPersistEpoch === 'function') {
            bumpVideoRegionPersistEpoch();
        }

        if (typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }

    }



    /** リージョン Out ハンドル位置の最大値（In トリム後も Out 固定を反映） */
    function getVideoTrackRegionTimelineEndSec() {
        const track = getVideoTrackRef();
        if (typeof isTrackRegionActive !== 'function' || !isTrackRegionActive(track)) return 0;
        const segments =
            typeof getTrackSegments === 'function' ? getTrackSegments(track) : [];
        if (!segments.length || typeof getSegmentRegionTimelineOut !== 'function') return 0;
        let end = 0;
        for (let i = 0; i < segments.length; i++) {
            end = Math.max(end, getSegmentRegionTimelineOut(track, i));
        }
        return end;
    }

    /** タイムライン上の映像ソース終端（再生 1:1 基準 = playbackStart + span）。Out トリム時は regionOut を優先。 */
    function getVideoTrackSourceTimelineEndSec() {
        const track = getVideoTrackRef();
        if (typeof isTrackRegionActive === 'function' && isTrackRegionActive(track)) {
            const regionEnd = getVideoTrackRegionTimelineEndSec();
            if (regionEnd > 0) return regionEnd;
            const segments =
                typeof getTrackSegments === 'function' ? getTrackSegments(track) : [];
            if (segments.length) {
                let end = 0;
                for (let i = 0; i < segments.length; i++) {
                    const seg = segments[i];
                    const span = Math.max(
                        0,
                        (Number(seg.sourceOutSec) || 0) - (Number(seg.sourceInSec) || 0),
                    );
                    const playbackStart =
                        typeof getSegmentPlaybackTimelineStart === 'function'
                            ? getSegmentPlaybackTimelineStart(track, i)
                            : typeof getSegmentTimelineStart === 'function'
                              ? getSegmentTimelineStart(track, i)
                              : 0;
                    end = Math.max(end, playbackStart + span);
                }
                if (end > 0) return end;
            }
        }
        return 0;
    }

    window.getVideoTrackSourceTimelineEndSec = getVideoTrackSourceTimelineEndSec;

    /** タイムライン上の動画コンテンツ終端（再生・tail 判定。regionOut ではなくソース終端） */
    function getVideoTrackTransportEndSec() {
        const sourceEnd = getVideoTrackSourceTimelineEndSec();
        if (sourceEnd > 0) return sourceEnd;

        if (typeof getVideoPlaybackEndSec === 'function') {
            const end = getVideoPlaybackEndSec();
            if (end > 0) return end;
        }

        return typeof getVideoTransportDurationSec === 'function' ? getVideoTransportDurationSec() : 0;
    }



    function resolveVideoLinkedRegionHitFromPointer(clientX, clientY) {

        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;

        if (typeof findPlaybackRegionElAtPointer !== 'function') return null;

        const regionEl = findPlaybackRegionElAtPointer(clientX, clientY);

        if (!regionEl) return null;

        if (regionEl.closest('.audio-waveform-lane--extra')) return null;

        const onVideoViz = !!regionEl.closest('.audio-waveform-lane--video-viz');

        const onVideoAudioMirror =
            regionEl.classList.contains('audio-waveform-lane__playback-region--video-audio-mirror') ||
            (!!regionEl.closest('.audio-waveform-lane--video') && !onVideoViz);

        if (!onVideoViz && !onVideoAudioMirror) return null;

        const segmentIndex = Number(regionEl.dataset.segmentIndex);

        if (!Number.isFinite(segmentIndex) || segmentIndex < 0) return null;

        const slot = onVideoAudioMirror
            ? VIDEO_AUDIO_WAVEFORM_OFFSET_DRAG_SLOT
            : VIDEO_WAVEFORM_OFFSET_DRAG_SLOT;

        return { slot, segmentIndex, track: getVideoTrackRef() };

    }



    window.resolveVideoLinkedRegionHitFromPointer = resolveVideoLinkedRegionHitFromPointer;



    window.VIDEO_WAVEFORM_OFFSET_DRAG_SLOT = VIDEO_WAVEFORM_OFFSET_DRAG_SLOT;

    window.VIDEO_AUDIO_WAVEFORM_OFFSET_DRAG_SLOT = VIDEO_AUDIO_WAVEFORM_OFFSET_DRAG_SLOT;

    window.isVideoWaveformOffsetDragSlot = isVideoWaveformOffsetDragSlot;

    window.isVideoAudioWaveformOffsetDragSlot = isVideoAudioWaveformOffsetDragSlot;

    window.isVideoLinkedOffsetDragSlot = isVideoLinkedOffsetDragSlot;

    window.normalizeVideoLinkedOffsetDragSlot = normalizeVideoLinkedOffsetDragSlot;

    window.trackRefFromWaveformOffsetDragSlot = trackRefFromWaveformOffsetDragSlot;

    window.getTrackOffsetDragSlot = getTrackOffsetDragSlot;

    window.offsetDragSlotMatchesTrack = offsetDragSlotMatchesTrack;

    window.isVideoRegionEntrySelected = isVideoRegionEntrySelected;

    window.toggleVideoLinkedRegionSelection = toggleVideoLinkedRegionSelection;

    window.resolveVideoTrackWaveformRegionSegment = resolveVideoTrackWaveformRegionSegment;
    window.resolveVideoTrackWaveformDrawParams = resolveVideoTrackWaveformDrawParams;
    window.drawVideoTrackMultiSegmentWaveform = drawVideoTrackMultiSegmentWaveform;
    window.shouldDrawVideoTrackMultiSegmentWaveform = shouldDrawVideoTrackMultiSegmentWaveform;
    window.isVideoTrackWaveformRegionDrawActive = isVideoTrackWaveformRegionDrawActive;
    window.getVideoTrackWaveformTimelineStartSec = getVideoTrackWaveformTimelineStartSec;
    window.getVideoTrackWaveformTimelineClipStartSec = getVideoTrackWaveformTimelineClipStartSec;
    window.getVideoTrackWaveformTimelineClipEndSec = getVideoTrackWaveformTimelineClipEndSec;

    window.getVideoAudioPlaybackRegionsContainerEl = getVideoAudioPlaybackRegionsContainerEl;

    window.syncVideoAudioLaneRegionOverlays = syncVideoAudioLaneRegionOverlays;

    window.refreshVideoAudioLaneRegionOverlayGeometry = refreshVideoAudioLaneRegionOverlayGeometry;

    window.finalizeVideoLinkedOffsetDragPresentation = finalizeVideoLinkedOffsetDragPresentation;



    let videoTrackFilmstripFrames = [];

    let videoTrackFilmstripGen = 0;

    let videoTrackFilmstripBuildQueued = false;

    let videoTrackFilmstripBuildInFlight = false;

    let videoTrackFilmstripDecodeRetryListener = null;

    let videoFilmstripLoadingActive = false;

    let videoVizFilmstripRenderRaf = 0;

    let videoVizFilmstripLayoutRetryRaf = 0;

    /** サムネ生成中の水平モーションブラー上限（stdDeviation X）。E キー入れ替えとは独立した値 */
    const VIDEO_FILMSTRIP_MOTION_BLUR_MAX = 3;

    let videoFilmstripMotionBlurBlurEl = null;



    function ensureVideoFilmstripMotionBlurFilter() {

        if (videoFilmstripMotionBlurBlurEl) return;

        const NS = 'http://www.w3.org/2000/svg';

        let root = document.getElementById('videoFilmstripMotionBlurDefs');

        if (!root) {

            root = document.createElementNS(NS, 'svg');

            root.id = 'videoFilmstripMotionBlurDefs';

            root.setAttribute('aria-hidden', 'true');

            root.style.cssText =

                'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';

            const filter = document.createElementNS(NS, 'filter');

            filter.id = 'videoFilmstripMotionBlurFilter';

            filter.setAttribute('x', '-30%');

            filter.setAttribute('y', '-10%');

            filter.setAttribute('width', '160%');

            filter.setAttribute('height', '120%');

            filter.setAttribute('color-interpolation-filters', 'sRGB');

            const blur = document.createElementNS(NS, 'feGaussianBlur');

            blur.setAttribute('in', 'SourceGraphic');

            blur.setAttribute('stdDeviation', '0 0');

            filter.appendChild(blur);

            root.appendChild(filter);

            document.body.appendChild(root);

        }

        const blur = root.querySelector('feGaussianBlur');

        if (blur) videoFilmstripMotionBlurBlurEl = blur;

    }



    function setVideoFilmstripMotionBlur(active) {

        const show = active === true;

        ensureVideoFilmstripMotionBlurFilter();

        if (videoFilmstripMotionBlurBlurEl) {

            videoFilmstripMotionBlurBlurEl.setAttribute(

                'stdDeviation',

                VIDEO_FILMSTRIP_MOTION_BLUR_MAX.toFixed(2) + ' 0',

            );

        }

        const v =

            typeof videoMain !== 'undefined' ? videoMain : document.getElementById('videoMain');

        if (videoVizLane) {

            videoVizLane.classList.toggle('video-viz-lane--filmstrip-loading', show);

        }

        if (typeof applyVideoPreviewGamma === 'function') {

            applyVideoPreviewGamma({ force: true });

        } else if (v) {

            v.style.filter = show ? 'url(#videoFilmstripMotionBlurFilter)' : '';

        }

    }



    function isVideoFilmstripLoadingActive() {

        return videoFilmstripLoadingActive;

    }



    window.isVideoFilmstripLoadingActive = isVideoFilmstripLoadingActive;

    /** リージョン平行移動中 — filmstrip 再生成・再描画を抑止（枠だけ追従） */
    function shouldSkipHeavyVideoVizRefreshDuringOffsetDrag() {
        return (
            typeof isOffsetDragRegionWaveformPreviewActive === 'function' &&
            isOffsetDragRegionWaveformPreviewActive()
        );
    }

    function setVideoFilmstripLoadingOverlay(active) {

        const show = active === true;

        if (videoFilmstripLoadingActive === show) return;

        videoFilmstripLoadingActive = show;

        setVideoFilmstripMotionBlur(show);

        const el = document.getElementById('videoFilmstripLoading');

        if (el) {

            el.hidden = !show;

            if (show) el.setAttribute('aria-busy', 'true');

            else el.removeAttribute('aria-busy');

        }

        if (typeof refreshVideoPastEndBlackoutUi === 'function') {
            refreshVideoPastEndBlackoutUi();
        }

        if (
            !show &&
            typeof notifyVideoPreviewPresentationReady === 'function'
        ) {
            notifyVideoPreviewPresentationReady();
        }

    }



    function ensureVideoFilmstripLoadingOverlay() {

        setVideoFilmstripLoadingOverlay(true);

    }



    function resetVideoFilmstripLoadingOverlay() {

        setVideoFilmstripLoadingOverlay(false);

    }



    window.ensureVideoFilmstripLoadingOverlay = ensureVideoFilmstripLoadingOverlay;

    window.ensureVideoFilmstripMotionBlurFilter = ensureVideoFilmstripMotionBlurFilter;



    function getVideoTrackRef() {

        return VIDEO_TRACK_REF;

    }



    window.getVideoTrackRef = getVideoTrackRef;



    function getVideoTrackState() {

        if (typeof window._videoTrackState === 'undefined' || !window._videoTrackState) {

            window._videoTrackState = {

                playbackRegions: { active: false, segments: [], headPadSec: 0 },

            };

        }

        return window._videoTrackState;

    }



    function resetVideoTrackState() {

        window._videoTrackState = {

            playbackRegions: { active: false, segments: [], headPadSec: 0 },

        };

        videoTrackFilmstripFrames = [];

        videoTrackFilmstripGen++;

        videoTrackFilmstripBuildQueued = false;

        videoTrackFilmstripBuildInFlight = false;

        if (videoVizFilmstripRenderRaf) {
            cancelAnimationFrame(videoVizFilmstripRenderRaf);
            videoVizFilmstripRenderRaf = 0;
        }
        if (videoVizFilmstripLayoutRetryRaf) {
            cancelAnimationFrame(videoVizFilmstripLayoutRetryRaf);
            videoVizFilmstripLayoutRetryRaf = 0;
        }

        if (videoTrackFilmstripDecodeRetryListener && videoMain) {

            videoMain.removeEventListener('loadeddata', videoTrackFilmstripDecodeRetryListener);

            videoMain.removeEventListener('canplay', videoTrackFilmstripDecodeRetryListener);

            videoTrackFilmstripDecodeRetryListener = null;

        }

        resetVideoFilmstripLoadingOverlay();

    }



    /** 動画アンロード時 — リージョン・filmstrip を破棄し映像レーンを非表示 */
    function clearVideoTrackForMediaRevoke() {

        resetVideoTrackState();

        const track = getVideoTrackRef();

        const container =

            typeof getPlaybackRegionsContainerEl === 'function'

                ? getPlaybackRegionsContainerEl(track)

                : videoVizLane

                  ? videoVizLane.querySelector('.audio-waveform-lane__playback-regions')

                  : null;

        if (container) {

            container.replaceChildren();

        }

        if (videoVizLane) {

            videoVizLane.classList.remove('audio-waveform-lane--has-regions');

        }

        if (typeof syncVideoAudioLaneRegionOverlays === 'function') {

            syncVideoAudioLaneRegionOverlays(track);

        }

        refreshVideoVizLaneVisibility();

    }



    window.clearVideoTrackForMediaRevoke = clearVideoTrackForMediaRevoke;



    function getVideoTrackSourceDurationSec() {

        if (typeof getVideoTransportDurationSec === 'function') {

            const d = getVideoTransportDurationSec();

            if (d > 0) return d;

        }

        if (videoMain && videoMain.duration > 0) return videoMain.duration;

        return 0;

    }



    function getVideoTrackTimelineEndSec() {
        const regionEnd = getVideoTrackRegionTimelineEndSec();
        if (regionEnd > 0) return regionEnd;

        const track = getVideoTrackRef();
        if (typeof getTrackTimelineEndSec === 'function') {
            return getTrackTimelineEndSec(track);
        }

        return getVideoTrackSourceDurationSec();
    }



    window.getVideoTrackTimelineEndSec = getVideoTrackTimelineEndSec;

    window.getVideoTrackTransportEndSec = getVideoTrackTransportEndSec;



    function isVideoVizLaneShown() {
        const hasVideo =
            (typeof urlMain !== 'undefined' && !!urlMain) ||
            (typeof fileMain !== 'undefined' && !!fileMain);
        if (!hasVideo) return false;
        if (typeof getMusicalGridVisible === 'function' && !getMusicalGridVisible()) {
            return false;
        }
        return true;
    }



    window.isVideoVizLaneShown = isVideoVizLaneShown;

    window.getVideoTrackState = getVideoTrackState;

    window.getVideoTrackSourceDurationSec = getVideoTrackSourceDurationSec;



    function getVideoTrackFilmstripFrames() {

        return videoTrackFilmstripFrames;

    }



    window.getVideoTrackFilmstripFrames = getVideoTrackFilmstripFrames;



    function syncVideoTrackRegionsPresentation(opt) {

        if (!isVideoVizLaneShown()) return false;

        const o = opt && typeof opt === 'object' ? opt : {};
        let pendingVideo =
            typeof getPendingPlaybackRegionRestoreVideoEntry === 'function'
                ? getPendingPlaybackRegionRestoreVideoEntry()
                : null;

        const track = getVideoTrackRef();
        let state = getVideoTrackState().playbackRegions;
        const needsRegionApply =
            !state || !state.active || !state.segments || !state.segments.length;

        if (
            needsRegionApply &&
            pendingVideo &&
            typeof applyPendingPlaybackRegionRestore === 'function'
        ) {
            applyPendingPlaybackRegionRestore();
            pendingVideo =
                typeof getPendingPlaybackRegionRestoreVideoEntry === 'function'
                    ? getPendingPlaybackRegionRestoreVideoEntry()
                    : null;
            state = getVideoTrackState().playbackRegions;
        }

        if (
            (!state || !state.segments || !state.segments.length) &&
            pendingVideo &&
            typeof tryApplyPendingVideoPlaybackRegionRestore === 'function'
        ) {
            tryApplyPendingVideoPlaybackRegionRestore({ silent: true, entry: pendingVideo });
            pendingVideo =
                typeof getPendingPlaybackRegionRestoreVideoEntry === 'function'
                    ? getPendingPlaybackRegionRestoreVideoEntry()
                    : null;
            state = getVideoTrackState().playbackRegions;
        }

        if (
            (!state || !state.segments || !state.segments.length) &&
            !pendingVideo
        ) {
            ensureDefaultVideoTrackRegion({ silent: true });
            state = getVideoTrackState().playbackRegions;
        }

        if (!state || !state.active || !state.segments || !state.segments.length) {
            return false;
        }

        if (typeof updateTrackRegionOverlays === 'function') {

            updateTrackRegionOverlays(track);

        }

        renderVideoVizFilmstrip();

        if (
            !o.skipFilmstripBuild &&
            !videoTrackFilmstripFrames.length &&
            typeof scheduleVideoTrackFilmstripBuild === 'function'
        ) {
            scheduleVideoTrackFilmstripBuild();
        }

        return true;

    }



    window.syncVideoTrackRegionsPresentation = syncVideoTrackRegionsPresentation;



    function refreshVideoVizLaneVisibility(opt) {

        const show = isVideoVizLaneShown();

        if (videoVizMeta) {

            videoVizMeta.hidden = !show;

            videoVizMeta.setAttribute('aria-hidden', show ? 'false' : 'true');

            if (!show) videoVizMeta.style.gridRow = '';

        }

        if (videoVizLane) {

            videoVizLane.hidden = !show;

            videoVizLane.setAttribute('aria-hidden', show ? 'false' : 'true');

            if (!show) videoVizLane.style.gridRow = '';

        }

        if (typeof refreshWaveformCompositeLaneLayout === 'function') {

            refreshWaveformCompositeLaneLayout();

        }

        if (!show) return;

        if (opt && opt.skipInit) {

            const pendingVideo =
                typeof getPendingPlaybackRegionRestoreVideoEntry === 'function'
                    ? getPendingPlaybackRegionRestoreVideoEntry()
                    : null;

            if (!pendingVideo && getVideoTrackSourceDurationSec() > 0) {

                syncVideoTrackRegionsPresentation();

            }

        } else {

            syncVideoTrackRegionsPresentation();

        }

    }



    window.refreshVideoVizLaneVisibility = refreshVideoVizLaneVisibility;



    function ensureDefaultVideoTrackRegion(opt) {

        const track = getVideoTrackRef();

        const state = getVideoTrackState().playbackRegions;

        const force = !!(opt && opt.force);

        if (!force && state.active && state.segments && state.segments.length) return true;

        const fullDur = getVideoTrackSourceDurationSec();

        if (!fullDur) return false;

        if (typeof normalizeSegmentEntry === 'function' && typeof newRegionId === 'function') {

            state.segments = [

                normalizeSegmentEntry(

                    {

                        id: newRegionId(),

                        clipId: 'main',

                        sourceInSec: 0,

                        sourceOutSec: fullDur,

                        timelineStartSec: 0,

                    },

                    track,

                    fullDur,

                ),

            ];

        } else {

            state.segments = [

                {

                    id: 'reg-main',

                    clipId: 'main',

                    sourceInSec: 0,

                    sourceOutSec: fullDur,

                    timelineStartSec: 0,

                },

            ];

        }

        state.active = true;

        state.headPadSec = 0;

        delete state.regionTimelineInSec;

        delete state.regionLeadPadSec;

        if (typeof syncTrackRegionHeadStateFromFirstSegment === 'function') {

            syncTrackRegionHeadStateFromFirstSegment(track);

        }

        if (!(opt && opt.silent) && typeof writeLog === 'function') {

            writeLog('Video track: default region');

        }

        return true;

    }



    function resetVideoTrackRegionToFullClip(opt) {

        if (!isVideoVizLaneShown()) return false;

        const track = getVideoTrackRef();

        if (!isTrackRegionActive(track)) return false;

        if (!ensureDefaultVideoTrackRegion(Object.assign({}, opt || {}, { force: true }))) {

            return false;

        }

        if (!(opt && opt.skipOverlay)) {

            if (typeof updateTrackRegionOverlays === 'function') {

                updateTrackRegionOverlays(track);

            }

            syncVideoAudioLaneRegionOverlays(track);

            renderVideoVizFilmstrip();

        }

        if (typeof notifyMasterTransportDurationChanged === 'function') {

            notifyMasterTransportDurationChanged();

        }

        if (typeof updateRangeLoopOverlay === 'function') updateRangeLoopOverlay();

        if (typeof updateAllWaveformPlayheads === 'function') updateAllWaveformPlayheads();

        if (!(opt && opt.skipPersist) && typeof schedulePersistSession === 'function') {

            schedulePersistSession();

        }

        if (typeof syncExtraAudioToTransport === 'function') {

            syncExtraAudioToTransport({ force: true });

        }

        return true;

    }



    window.resetVideoTrackRegionToFullClip = resetVideoTrackRegionToFullClip;



    function initVideoTrackForNewVideo(opt) {

        const pendingVideo =
            typeof getPendingPlaybackRegionRestoreVideoEntry === 'function'
                ? getPendingPlaybackRegionRestoreVideoEntry()
                : null;

        resetVideoTrackState();

        refreshVideoVizLaneVisibility({ skipInit: true });

        const restoreBusy =

            typeof isSessionRestoreInProgress === 'function' && isSessionRestoreInProgress();

        if (!pendingVideo && getVideoTrackSourceDurationSec() > 0) {

            syncVideoTrackRegionsPresentation();

        } else if (

            !restoreBusy &&

            typeof scheduleVideoTrackFilmstripBuild === 'function'

        ) {

            scheduleVideoTrackFilmstripBuild(opt);

        }

    }



    window.initVideoTrackForNewVideo = initVideoTrackForNewVideo;



    function isPointerOverVideoVizLane(clientY) {

        if (!Number.isFinite(clientY) || !videoVizLane || videoVizLane.hidden) return false;

        const rect = videoVizLane.getBoundingClientRect();

        return clientY >= rect.top && clientY <= rect.bottom;

    }



    window.isPointerOverVideoVizLane = isPointerOverVideoVizLane;



    function pointerTargetsVideoVizLane() {

        let clientY = null;

        if (typeof getWaveformLanesPointerClientY === 'function') {

            clientY = getWaveformLanesPointerClientY();

        }

        if (clientY == null && typeof getWaveformPointerClientY === 'function') {

            clientY = getWaveformPointerClientY();

        }

        return isPointerOverVideoVizLane(clientY);

    }



    window.pointerTargetsVideoVizLane = pointerTargetsVideoVizLane;



    function computeFilmstripSampleTimes(durationSec) {

        if (!(durationSec > 0)) return [0];

        const maxFrames = 144;

        const targetIntervalSec = 1;

        let count = Math.max(2, Math.ceil(durationSec / targetIntervalSec) + 1);

        count = Math.min(maxFrames, count);

        if (count <= 1) return [0];

        const step = durationSec / (count - 1);

        const times = [];

        for (let i = 0; i < count; i++) {

            times.push(Math.min(durationSec - 0.001, i * step));

        }

        return times;

    }



    function waitForVideoDecodedFrame(maxMs) {

        return new Promise((resolve) => {

            if (!videoMain) {

                resolve(false);

                return;

            }

            if (

                videoMain.readyState >= 2 &&

                videoMain.videoWidth > 0 &&

                videoMain.videoHeight > 0

            ) {

                resolve(true);

                return;

            }

            if (typeof videoMain.requestVideoFrameCallback === 'function') {

                try {

                    videoMain.requestVideoFrameCallback(() => {

                        finish(

                            videoMain.videoWidth > 0 && videoMain.videoHeight > 0,

                        );

                    });

                } catch (_) {}

            }

            let done = false;

            const finish = (ok) => {

                if (done) return;

                done = true;

                videoMain.removeEventListener('loadeddata', onReady);

                videoMain.removeEventListener('canplay', onReady);

                videoMain.removeEventListener('error', onErr);

                clearTimeout(timer);

                resolve(ok);

            };

            const onReady = () =>

                finish(videoMain.videoWidth > 0 && videoMain.videoHeight > 0);

            const onErr = () => finish(false);

            const timer = setTimeout(

                () => finish(videoMain.videoWidth > 0 && videoMain.videoHeight > 0),

                maxMs > 0 ? maxMs : 8000,

            );

            videoMain.addEventListener('loadeddata', onReady, { once: true });

            videoMain.addEventListener('canplay', onReady, { once: true });

            videoMain.addEventListener('error', onErr, { once: true });

        });

    }



    function waitVideoSeek(sourceSec) {

        return new Promise((resolve) => {

            if (!videoMain) {

                resolve(false);

                return;

            }

            const target = Math.max(0, sourceSec);

            let done = false;

            const finish = (ok) => {

                if (done) return;

                done = true;

                resolve(ok !== false);

            };

            const onSeeked = () => finish(true);

            videoMain.addEventListener('seeked', onSeeked, { once: true });

            try {

                if (Math.abs((videoMain.currentTime || 0) - target) < 0.015) {

                    finish(true);

                    return;

                }

                videoMain.currentTime = target;

            } catch (_) {

                finish(false);

                return;

            }

            setTimeout(() => finish(true), 600);

        });

    }



    async function captureVideoFrameDataUrl(sourceSec, thumbH) {

        if (!videoMain) return '';

        const h = thumbH || VIDEO_VIZ_FILMSTRIP_CAPTURE_HEIGHT_PX;

        const w = videoMain.videoWidth;

        const vidH = videoMain.videoHeight;

        if (!(w > 0 && vidH > 0)) return '';

        const canvas = document.createElement('canvas');

        const thumbW = Math.max(1, Math.round((w / vidH) * h));

        canvas.width = thumbW;

        canvas.height = h;

        const ctx = canvas.getContext('2d');

        if (!ctx) return '';

        ctx.drawImage(videoMain, 0, 0, thumbW, h);

        try {

            return canvas.toDataURL('image/jpeg', 0.65);

        } catch (_) {

            return '';

        }

    }



    function restoreVideoPresentationAfterFilmstripBuild() {

        const refreshUi = () => {

            if (typeof updateTimecodeOverlay === 'function') updateTimecodeOverlay();

            if (typeof refreshVideoPastEndBlackoutUi === 'function') {
                refreshVideoPastEndBlackoutUi();
            }

            if (typeof reapplyVideoPreviewGammaIfPending === 'function') {
                reapplyVideoPreviewGammaIfPending();
            } else if (typeof applyVideoPreviewGamma === 'function') {
                applyVideoPreviewGamma({ force: true });
            }

        };

        try {

            if (
                typeof applyVideoTimeForTransportSec === 'function' &&
                typeof getTransportSec === 'function'
            ) {
                applyVideoTimeForTransportSec(getTransportSec(), { force: true });
            }

        } catch (_) {}

        const v = typeof videoMain !== 'undefined' ? videoMain : null;

        if (v && v.seeking) {
            v.addEventListener('seeked', refreshUi, { once: true });
        } else {
            refreshUi();
        }

    }



    async function buildVideoTrackFilmstrip(opt) {

        const o = opt && typeof opt === 'object' ? opt : {};

        if (videoTrackFilmstripBuildInFlight) return false;

        if (o.skipIfFrames && videoTrackFilmstripFrames.length > 0) return true;

        if (!videoMain || !videoReady || !videoReady()) return false;

        if (shouldSkipHeavyVideoVizRefreshDuringOffsetDrag()) return false;

        const duration = getVideoTrackSourceDurationSec();

        if (!duration) return false;

        ensureVideoFilmstripLoadingOverlay();

        videoTrackFilmstripBuildInFlight = true;

        const gen = ++videoTrackFilmstripGen;

        const times = computeFilmstripSampleTimes(duration);

        const wasPaused = videoMain.paused;

        const frames = [];

        try {

            await waitForVideoDecodedFrame();

            if (gen !== videoTrackFilmstripGen) return false;

            if (

                times[0] <= 0.001 &&

                typeof showFirstVideoFrame === 'function'

            ) {

                await showFirstVideoFrame();

            }

            for (let i = 0; i < times.length; i++) {

                if (gen !== videoTrackFilmstripGen) return false;

                const t = times[i];

                if (!(i === 0 && times[0] <= 0.001)) {

                    await waitVideoSeek(t);

                } else if (!videoMain.videoWidth || !videoMain.videoHeight) {

                    await waitVideoSeek(t);

                }

                if (gen !== videoTrackFilmstripGen) return false;

                const dataUrl = await captureVideoFrameDataUrl(
                    t,
                    VIDEO_VIZ_FILMSTRIP_CAPTURE_HEIGHT_PX,
                );

                if (!dataUrl) continue;

                frames.push({ sourceSec: t, dataUrl: dataUrl });

                videoTrackFilmstripFrames = frames.slice();

                renderVideoVizFilmstrip();

                if (typeof refreshVideoPastEndBlackoutUi === 'function') {
                    refreshVideoPastEndBlackoutUi();
                }

            }

            videoTrackFilmstripFrames = frames;

            renderVideoVizFilmstrip();

            if (!frames.length) {

                scheduleVideoTrackFilmstripBuildRetryAfterDecode();

            }

            return frames.length > 0;

        } catch (_) {

            return false;

        } finally {

            videoTrackFilmstripBuildInFlight = false;

            if (gen === videoTrackFilmstripGen) {

                setVideoFilmstripLoadingOverlay(false);

                restoreVideoPresentationAfterFilmstripBuild();

                if (typeof syncVideoTrackRegionsPresentation === 'function') {
                    syncVideoTrackRegionsPresentation({
                        force: true,
                        skipFilmstripBuild: true,
                    });
                }

                if (!wasPaused) {

                    try {

                        void videoMain.play();

                    } catch (_) {}

                }

            }

        }

    }



    window.buildVideoTrackFilmstrip = buildVideoTrackFilmstrip;



    /** メタデータ／フレームデコード後に filmstrip を構築（セッション復元・リロード向け） */
    async function ensureVideoTrackFilmstripAfterMediaReady(opt) {

        const o = opt && typeof opt === 'object' ? opt : {};

        if (o.skipIfFrames && videoTrackFilmstripFrames.length > 0) return true;

        if (!videoMain || typeof videoReady !== 'function' || !videoReady()) return false;

        if (typeof refreshVideoVizLaneVisibility === 'function') {
            refreshVideoVizLaneVisibility({ skipInit: true });
        }

        if (typeof isVideoVizLaneShown === 'function' && !isVideoVizLaneShown()) {
            return false;
        }

        await waitForVideoDecodedFrame(o.decodeTimeoutMs);

        if (typeof showFirstVideoFrame === 'function') {
            await showFirstVideoFrame();
        }

        if (typeof syncVideoTrackRegionsPresentation === 'function') {
            syncVideoTrackRegionsPresentation({ skipFilmstripBuild: true });
        }

        if (o.skipIfFrames && videoTrackFilmstripFrames.length > 0) return true;

        return buildVideoTrackFilmstrip(o);

    }



    window.ensureVideoTrackFilmstripAfterMediaReady = ensureVideoTrackFilmstripAfterMediaReady;



    /** セッション復元完了後 — 映像リージョン適用と filmstrip を再試行（Chrome file:// 向け） */
    async function finalizeVideoTrackPresentationAfterSessionRestore(opt) {

        const o = opt && typeof opt === 'object' ? opt : {};

        if (!(typeof fileMain !== 'undefined' && fileMain)) return false;

        if (typeof refreshVideoVizLaneVisibility === 'function') {
            refreshVideoVizLaneVisibility({ skipInit: true });
        }

        if (
            typeof waitForVideoDecodedFrame === 'function' &&
            !(typeof videoReadyForSessionRestorePresentation === 'function' &&
                videoReadyForSessionRestorePresentation())
        ) {
            await waitForVideoDecodedFrame(o.decodeTimeoutMs);
        }

        if (
            typeof tryApplyPendingVideoPlaybackRegionRestore === 'function' &&
            !(
                typeof isVideoPlaybackRegionRestoreApplied === 'function' &&
                isVideoPlaybackRegionRestoreApplied()
            )
        ) {
            tryApplyPendingVideoPlaybackRegionRestore({
                silent: true,
                entry: o.videoEntry,
            });
        } else if (
            typeof getPendingPlaybackRegionRestoreVideoEntry === 'function' &&
            getPendingPlaybackRegionRestoreVideoEntry() &&
            typeof applyPendingPlaybackRegionRestore === 'function'
        ) {
            applyPendingPlaybackRegionRestore();
        }

        if (typeof syncVideoTrackRegionsPresentation === 'function') {
            syncVideoTrackRegionsPresentation({ force: true, skipFilmstripBuild: true });
        }

        const segCount =
            typeof isVideoPlaybackRegionRestoreApplied === 'function' &&
            isVideoPlaybackRegionRestoreApplied()
                ? getVideoTrackState().playbackRegions.segments.length
                : 0;
        const frameCount = videoTrackFilmstripFrames.length;

        let filmstripOk = false;
        if (typeof ensureVideoTrackFilmstripAfterMediaReady === 'function') {
            filmstripOk = await ensureVideoTrackFilmstripAfterMediaReady({
                skipIfFrames: o.skipIfFrames !== false,
                decodeTimeoutMs: o.decodeTimeoutMs,
            });
        }

        if (typeof writeLog === 'function') {
            writeLog(
                'Session: video presentation finalize (regions=' +
                    segCount +
                    ', filmstrip=' +
                    (videoTrackFilmstripFrames.length || frameCount) +
                    (filmstripOk ? ', ok' : '') +
                    ')',
            );
        }

        if (typeof reapplyVideoPreviewGammaIfPending === 'function') {
            reapplyVideoPreviewGammaIfPending();
        } else if (typeof applyVideoPreviewGamma === 'function') {
            applyVideoPreviewGamma({ force: true });
        }

        return !!(segCount || videoTrackFilmstripFrames.length || filmstripOk);

    }



    window.finalizeVideoTrackPresentationAfterSessionRestore =
        finalizeVideoTrackPresentationAfterSessionRestore;



    function scheduleVideoTrackFilmstripBuildRetryAfterDecode() {

        if (!videoMain || videoTrackFilmstripFrames.length) return;

        const attemptRetry = () => {

            if (videoTrackFilmstripDecodeRetryListener) {

                videoMain.removeEventListener('loadeddata', videoTrackFilmstripDecodeRetryListener);

                videoMain.removeEventListener('canplay', videoTrackFilmstripDecodeRetryListener);

                videoTrackFilmstripDecodeRetryListener = null;

            }

            if (videoTrackFilmstripFrames.length) return;

            if (typeof ensureVideoTrackFilmstripAfterMediaReady === 'function') {
                void ensureVideoTrackFilmstripAfterMediaReady();
            } else {
                scheduleVideoTrackFilmstripBuild();
            }

        };

        if (

            videoMain.readyState >= 2 &&

            videoMain.videoWidth > 0 &&

            videoMain.videoHeight > 0

        ) {

            attemptRetry();

            return;

        }

        if (videoTrackFilmstripDecodeRetryListener) return;

        videoTrackFilmstripDecodeRetryListener = attemptRetry;

        videoMain.addEventListener('loadeddata', attemptRetry, { once: true });

        videoMain.addEventListener('canplay', attemptRetry, { once: true });

    }



    function scheduleVideoTrackFilmstripBuild(opt) {

        if (shouldSkipHeavyVideoVizRefreshDuringOffsetDrag()) return;

        const o = opt && typeof opt === 'object' ? opt : {};

        if (o.skipIfFrames && videoTrackFilmstripFrames.length > 0) return;

        if (videoTrackFilmstripBuildInFlight || videoTrackFilmstripBuildQueued) return;

        videoTrackFilmstripBuildQueued = true;

        requestAnimationFrame(() => {

            videoTrackFilmstripBuildQueued = false;

            if (videoTrackFilmstripBuildInFlight) return;

            if (o.skipIfFrames && videoTrackFilmstripFrames.length > 0) return;

            void buildVideoTrackFilmstrip(o);

        });

    }



    window.scheduleVideoTrackFilmstripBuild = scheduleVideoTrackFilmstripBuild;



    /** @deprecated 互換用 — filmstrip 構築をスケジュール */

    async function captureVideoTrackThumbnail(opt) {

        scheduleVideoTrackFilmstripBuild(opt);

        return videoTrackFilmstripFrames.length > 0;

    }



    window.captureVideoTrackThumbnail = captureVideoTrackThumbnail;



    /** @deprecated 互換用 — 先頭フレームの data URL */

    function getVideoTrackThumbnailDataUrl() {

        return videoTrackFilmstripFrames.length ? videoTrackFilmstripFrames[0].dataUrl : '';

    }



    window.getVideoTrackThumbnailDataUrl = getVideoTrackThumbnailDataUrl;



    function getVideoFilmstripAspectRatio() {

        if (

            videoMain &&

            videoMain.videoWidth > 0 &&

            videoMain.videoHeight > 0

        ) {

            return videoMain.videoWidth / videoMain.videoHeight;

        }

        return 16 / 9;

    }



    function getFilmstripThumbMetrics(laneHeightPx, regionWidthPx) {

        const laneH = Math.max(1, laneHeightPx | 0);

        const regionW = Math.max(0, regionWidthPx | 0);

        const naturalThumbW = Math.max(1, Math.round(laneH * getVideoFilmstripAspectRatio()));

        const maxThumbW = Math.max(

            naturalThumbW,

            Math.round(naturalThumbW * VIDEO_VIZ_FILMSTRIP_MAX_DISPLAY_SCALE),

        );

        return { naturalThumbW: naturalThumbW, maxThumbW: maxThumbW, regionW: regionW };

    }



    function pickFramesForTimeSlots(sourceFrames, inSec, outSec, slotCount) {

        if (!sourceFrames.length || slotCount < 1) return [];

        const duration = Math.max(0.001, outSec - inSec);

        const sorted = sourceFrames

            .slice()

            .sort((a, b) => (a.sourceSec || 0) - (b.sourceSec || 0));

        const picked = [];

        for (let i = 0; i < slotCount; i++) {

            const wStart = inSec + (i / slotCount) * duration;

            const wEnd = inSec + ((i + 1) / slotCount) * duration;

            const center = (wStart + wEnd) / 2;

            let best = sorted[0];

            let bestDist = Infinity;

            for (let j = 0; j < sorted.length; j++) {

                const f = sorted[j];

                const inWindow = f.sourceSec >= wStart - 0.001 && f.sourceSec < wEnd + 0.001;

                const dist = Math.abs(f.sourceSec - center);

                if (inWindow && dist < bestDist) {

                    best = f;

                    bestDist = dist;

                }

            }

            if (bestDist === Infinity) {

                for (let j = 0; j < sorted.length; j++) {

                    const dist = Math.abs(sorted[j].sourceSec - center);

                    if (dist < bestDist) {

                        best = sorted[j];

                        bestDist = dist;

                    }

                }

            }

            picked.push(best);

        }

        return picked;

    }



    function planFilmstripTimelineLayout(
        sourceFrames,
        inSec,
        outSec,
        regionWidthPx,
        laneHeightPx,
        settled,
    ) {

        if (!sourceFrames || !sourceFrames.length) return [];

        const { naturalThumbW, regionW } = getFilmstripThumbMetrics(

            laneHeightPx,

            regionWidthPx,

        );

        if (regionW <= 0) return [];

        const maxFit = Math.max(1, Math.ceil(regionW / naturalThumbW));

        let cellCount;

        let displayFrames;

        if (settled) {

            cellCount = maxFit;

            displayFrames = pickFramesForTimeSlots(

                sourceFrames,

                inSec,

                outSec,

                cellCount,

            );

        } else {

            cellCount = sourceFrames.length;

            displayFrames = sourceFrames

                .slice()

                .sort((a, b) => (a.sourceSec || 0) - (b.sourceSec || 0));

        }

        if (!cellCount || !displayFrames.length) return [];

        const placements = [];

        let cursorPx = 0;

        for (let i = 0; i < cellCount; i++) {

            const widthPx =

                i === cellCount - 1

                    ? Math.max(1, regionW - cursorPx)

                    : Math.max(1, Math.round(regionW / cellCount));

            placements.push({

                frame: displayFrames[i],

                leftPx: cursorPx,

                widthPx: widthPx,

            });

            cursorPx += widthPx;

        }

        return placements;

    }



    /**
     * 生成中: キャプチャ済み枚数で尺を等分割して右端まで覆う（1 枚ずつ細分化）。
     * 完了後: 自然幅が収まる枚数で時間スロットごとに割当て、隙間なく右端まで。
     */
    function planFilmstripLayout(
        sourceFrames,
        inSec,
        outSec,
        regionWidthPx,
        laneHeightPx,
        settled,
    ) {

        return planFilmstripTimelineLayout(

            sourceFrames,

            inSec,

            outSec,

            regionWidthPx,

            laneHeightPx,

            settled,

        );

    }



    function getFilmstripTimelineZoom() {
        return typeof getWaveformTimelineZoom === 'function' ? getWaveformTimelineZoom() : 1;
    }

    /** ズーム・リージョン幅・キャプチャ枚数が変わったときだけ DOM を組み直す */
    function computeRegionFilmstripLayoutSignature(
        sourceInSec,
        sourceOutSec,
        regionW,
        laneH,
        settled,
        sourceFrameCount,
    ) {
        const zoom = getFilmstripTimelineZoom();
        const { naturalThumbW } = getFilmstripThumbMetrics(laneH, regionW);
        const cellCount = settled
            ? Math.max(1, Math.ceil(regionW / naturalThumbW))
            : Math.max(0, sourceFrameCount | 0);
        return [
            settled ? '1' : '0',
            (Number(sourceInSec) || 0).toFixed(3),
            (Number(sourceOutSec) || 0).toFixed(3),
            regionW | 0,
            laneH | 0,
            zoom.toFixed(3),
            sourceFrameCount | 0,
            cellCount | 0,
        ].join(':');
    }

    function regionFilmstripLayoutPending(regionEl) {
        return regionEl && regionEl.dataset.filmstripLayoutPending === '1';
    }

    function anyVideoRegionFilmstripLayoutPending() {
        const track = getVideoTrackRef();
        const container =
            typeof getPlaybackRegionsContainerEl === 'function'
                ? getPlaybackRegionsContainerEl(track)
                : null;
        if (!container) return false;
        const regions = container.querySelectorAll('.audio-waveform-lane__playback-region');
        for (let i = 0; i < regions.length; i++) {
            if (regionFilmstripLayoutPending(regions[i])) return true;
        }
        return false;
    }

    function videoVizFilmstripPresentationNeedsUpdate() {
        if (
            typeof isVideoVizLaneShown !== 'function' ||
            !isVideoVizLaneShown() ||
            shouldSkipHeavyVideoVizRefreshDuringOffsetDrag()
        ) {
            return false;
        }
        const track = getVideoTrackRef();
        const container =
            typeof getPlaybackRegionsContainerEl === 'function'
                ? getPlaybackRegionsContainerEl(track)
                : null;
        if (!container) return false;
        const state = getVideoTrackState().playbackRegions;
        const segments = state.segments || [];
        const regions = container.querySelectorAll('.audio-waveform-lane__playback-region');
        const settled = !videoTrackFilmstripBuildInFlight;
        for (let i = 0; i < regions.length; i++) {
            const idx = parseInt(regions[i].dataset.segmentIndex, 10);
            const seg = segments[idx];
            if (!seg) continue;
            const regionEl = regions[i];
            const regionW = Math.max(0, regionEl.clientWidth | 0);
            const laneH = Math.max(0, regionEl.clientHeight | 0);
            if (regionW < 1 || laneH < 1) return true;
            const inSec = Number.isFinite(seg.sourceInSec) ? seg.sourceInSec : 0;
            const outSec = Number.isFinite(seg.sourceOutSec) ? seg.sourceOutSec : inSec;
            const frames = videoTrackFilmstripFrames.filter(
                (f) => f.sourceSec >= inSec - 0.05 && f.sourceSec <= outSec + 0.05,
            );
            const sig = computeRegionFilmstripLayoutSignature(
                inSec,
                outSec,
                regionW,
                laneH,
                settled,
                frames.length,
            );
            if (regionEl.dataset.filmstripLayoutSig !== sig) return true;
            const filmstrip = regionEl.querySelector('.video-viz-lane__filmstrip');
            if (!filmstrip || filmstrip.hidden) {
                if (frames.length > 0) return true;
            }
        }
        return anyVideoRegionFilmstripLayoutPending();
    }

    function scheduleVideoVizFilmstripRender(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (shouldSkipHeavyVideoVizRefreshDuringOffsetDrag()) return;
        if (videoVizFilmstripRenderRaf) {
            cancelAnimationFrame(videoVizFilmstripRenderRaf);
            videoVizFilmstripRenderRaf = 0;
        }
        const run = () => {
            videoVizFilmstripRenderRaf = 0;
            if (!o.force && !videoVizFilmstripPresentationNeedsUpdate()) return;
            renderVideoVizFilmstrip();
            if (anyVideoRegionFilmstripLayoutPending()) {
                if (videoVizFilmstripLayoutRetryRaf) {
                    cancelAnimationFrame(videoVizFilmstripLayoutRetryRaf);
                }
                videoVizFilmstripLayoutRetryRaf = requestAnimationFrame(() => {
                    videoVizFilmstripLayoutRetryRaf = 0;
                    if (videoVizFilmstripPresentationNeedsUpdate()) {
                        renderVideoVizFilmstrip();
                    }
                });
            }
        };
        if (o.sync) {
            run();
            return;
        }
        videoVizFilmstripRenderRaf = requestAnimationFrame(() => {
            videoVizFilmstripRenderRaf = requestAnimationFrame(run);
        });
    }

    window.scheduleVideoVizFilmstripRender = scheduleVideoVizFilmstripRender;

    function getFilmstripThumbGammaFilterCss() {
        if (typeof getVideoPreviewGammaFilterCss === 'function') {
            return getVideoPreviewGammaFilterCss();
        }
        return '';
    }

    function syncFilmstripCellImageGammaFilter(img) {
        if (!img) return;
        const filter = getFilmstripThumbGammaFilterCss();
        img.style.filter = filter || '';
    }

    function refreshVideoFilmstripGammaFilters() {
        if (
            typeof isVideoVizLaneShown !== 'function' ||
            !isVideoVizLaneShown() ||
            !videoVizLane ||
            videoVizLane.hidden
        ) {
            return;
        }
        const imgs = videoVizLane.querySelectorAll('.video-viz-lane__filmstrip-cell__img');
        for (let i = 0; i < imgs.length; i++) {
            syncFilmstripCellImageGammaFilter(imgs[i]);
        }
    }

    window.refreshVideoFilmstripGammaFilters = refreshVideoFilmstripGammaFilters;

    function applyFilmstripCellFrame(cell, dataUrl, layout) {

        const leftPx = layout && Number.isFinite(layout.leftPx) ? layout.leftPx : 0;

        const widthPx =

            layout && Number.isFinite(layout.widthPx) ? layout.widthPx : 0;

        let img = cell.querySelector('.video-viz-lane__filmstrip-cell__img');

        if (!img) {

            img = document.createElement('img');

            img.className = 'video-viz-lane__filmstrip-cell__img';

            img.alt = '';

            img.decoding = 'async';

            img.draggable = false;

            cell.replaceChildren(img);

        }

        cell.style.left = Math.round(leftPx) + 'px';

        cell.style.width = Math.max(0, Math.round(widthPx)) + 'px';

        if (img.getAttribute('src') !== dataUrl) {

            img.removeAttribute('src');

            img.setAttribute('src', dataUrl);

        }

        syncFilmstripCellImageGammaFilter(img);

    }



    function renderRegionFilmstrip(regionEl, sourceInSec, sourceOutSec) {

        let filmstrip = regionEl.querySelector('.video-viz-lane__filmstrip');

        if (!filmstrip) {

            filmstrip = document.createElement('div');

            filmstrip.className = 'video-viz-lane__filmstrip';

            filmstrip.setAttribute('aria-hidden', 'true');

            regionEl.insertBefore(filmstrip, regionEl.firstChild);

        }

        const inSec = Number.isFinite(sourceInSec) ? sourceInSec : 0;

        const outSec = Number.isFinite(sourceOutSec) ? sourceOutSec : inSec;

        const frames = videoTrackFilmstripFrames.filter(

            (f) => f.sourceSec >= inSec - 0.05 && f.sourceSec <= outSec + 0.05,

        );

        const regionW = Math.max(0, regionEl.clientWidth | 0);

        const laneH = Math.max(1, regionEl.clientHeight | 0);

        const settled = !videoTrackFilmstripBuildInFlight;

        const layoutSig = computeRegionFilmstripLayoutSignature(
            inSec,
            outSec,
            regionW,
            laneH,
            settled,
            frames.length,
        );

        if (regionW < 1 || laneH < 1) {

            filmstrip.hidden = true;

            regionEl.dataset.filmstripLayoutPending = '1';

            delete regionEl.dataset.filmstripLayoutSig;

            return;

        }

        delete regionEl.dataset.filmstripLayoutPending;

        const placements = planFilmstripLayout(

            frames,

            inSec,

            outSec,

            regionW,

            laneH,

            settled,

        );

        filmstrip.hidden = !placements.length;

        if (!placements.length) {

            filmstrip.textContent = '';

            regionEl.dataset.filmstripLayoutSig = layoutSig;

            return;

        }

        const existing = filmstrip.querySelectorAll('.video-viz-lane__filmstrip-cell');

        if (existing.length === placements.length) {

            let unchanged = true;

            for (let i = 0; i < placements.length; i++) {

                const cell = existing[i];

                const placement = placements[i];

                const expectedLeft = Math.round(placement.leftPx) + 'px';

                const expectedWidth = Math.max(0, Math.round(placement.widthPx)) + 'px';

                if ((cell.style.left || '0') !== expectedLeft) {

                    unchanged = false;

                    break;

                }

                if ((cell.style.width || '0') !== expectedWidth) {

                    unchanged = false;

                    break;

                }

                const img = cell.querySelector('.video-viz-lane__filmstrip-cell__img');

                if (!img || img.getAttribute('src') !== placement.frame.dataUrl) {

                    unchanged = false;

                    break;

                }

            }

            if (unchanged) {

                regionEl.dataset.filmstripLayoutSig = layoutSig;

                return;

            }

        }

        filmstrip.textContent = '';

        for (let i = 0; i < placements.length; i++) {

            const cell = document.createElement('div');

            cell.className = 'video-viz-lane__filmstrip-cell';

            applyFilmstripCellFrame(cell, placements[i].frame.dataUrl, placements[i]);

            filmstrip.appendChild(cell);

        }

        regionEl.dataset.filmstripLayoutSig = layoutSig;

    }



    function renderVideoVizFilmstrip() {

        const track = getVideoTrackRef();

        const container =

            typeof getPlaybackRegionsContainerEl === 'function'

                ? getPlaybackRegionsContainerEl(track)

                : videoVizLane

                  ? videoVizLane.querySelector('.audio-waveform-lane__playback-regions')

                  : null;

        if (!container) return;

        const state = getVideoTrackState().playbackRegions;

        const segments = state.segments || [];

        const regions = container.querySelectorAll('.audio-waveform-lane__playback-region');

        for (let i = 0; i < regions.length; i++) {

            const idx = parseInt(regions[i].dataset.segmentIndex, 10);

            const seg = segments[idx];

            if (!seg) continue;

            renderRegionFilmstrip(regions[i], seg.sourceInSec, seg.sourceOutSec);

        }

    }



    window.renderVideoVizFilmstrip = renderVideoVizFilmstrip;



    function refreshVideoVizRegionThumbnails(opt) {

        const o = opt && typeof opt === 'object' ? opt : {};

        if (o.deferLayout) {

            scheduleVideoVizFilmstripRender(o);

            return;

        }

        renderVideoVizFilmstrip();

    }



    window.refreshVideoVizRegionThumbnails = refreshVideoVizRegionThumbnails;



    /** トランスポート≠映像秒の 1:1 再生 — ネイティブ currentTime 進行を使わず毎 tick 同期 */
    function videoRegionPlaybackRequiresTransportSync() {

        const track = getVideoTrackRef();

        if (typeof isTrackRegionActive !== 'function' || !isTrackRegionActive(track)) {

            return false;

        }

        const count = typeof getSegmentCount === 'function' ? getSegmentCount(track) : 0;

        if (count < 1) return false;

        if (count > 1) return true;

        const regionIn =

            typeof getSegmentRegionTimelineIn === 'function'

                ? getSegmentRegionTimelineIn(track, 0)

                : 0;

        if (regionIn > 0.0005) return true;

        const segments = typeof getTrackSegments === 'function' ? getTrackSegments(track) : [];

        const seg = segments[0];

        if (!seg) return false;

        const fullDur =

            typeof getVideoTrackSourceDurationSec === 'function'

                ? getVideoTrackSourceDurationSec()

                : Math.max(0, (Number(seg.sourceOutSec) || 0) - (Number(seg.sourceInSec) || 0));

        if ((Number(seg.sourceInSec) || 0) > 0.0005) return true;

        if (

            fullDur > 0.0005 &&

            Math.abs((Number(seg.sourceOutSec) || 0) - fullDur) > 0.0005

        ) {

            return true;

        }

        const anchor =

            typeof getSegmentTimelineStart === 'function'

                ? getSegmentTimelineStart(track, 0)

                : 0;

        return Math.abs(anchor - regionIn) > 0.0005;

    }



    window.videoRegionPlaybackRequiresTransportSync = videoRegionPlaybackRequiresTransportSync;

    function getVideoRegionTimelineInSec() {
        const track = getVideoTrackRef();
        if (typeof isTrackRegionActive !== 'function' || !isTrackRegionActive(track)) return 0;
        if (typeof getSegmentRegionTimelineIn !== 'function') return 0;
        return getSegmentRegionTimelineIn(track, 0);
    }

    /** 波形左端 = playbackStart - sourceIn。ここより前だけ preRoll（映像停止）。 */
    function getVideoRegionPreRollHoldEndSec() {
        const track = getVideoTrackRef();
        if (typeof isTrackRegionActive !== 'function' || !isTrackRegionActive(track)) {
            return 0;
        }
        const segments =
            typeof getTrackSegments === 'function' ? getTrackSegments(track) : [];
        const seg = segments[0];
        if (!seg) return 0;
        const playbackStart =
            typeof getSegmentPlaybackTimelineStart === 'function'
                ? getSegmentPlaybackTimelineStart(track, 0)
                : 0;
        const sourceIn = Math.max(0, Number(seg.sourceInSec) || 0);
        return Math.max(0, playbackStart - sourceIn);
    }

    /** 黒画面 — regionIn より前（In トリム非表示区間を含む） */
    function isTransportBeforeVideoRegionIn(transportSec) {
        if (!videoRegionPlaybackRequiresTransportSync()) return false;
        const regionIn = getVideoRegionTimelineInSec();
        if (!(regionIn > 0.0005)) return false;
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return false;
        return t < regionIn - 0.0005;
    }

    /** preRoll 硬直 — 波形左端より前のみ（In トリム区間は同期進行） */
    function isTransportInVideoPreRollHoldZone(transportSec) {
        if (!videoRegionPlaybackRequiresTransportSync()) return false;
        const holdEnd = getVideoRegionPreRollHoldEndSec();
        if (!(holdEnd > 0.0005)) return false;
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return false;
        return t < holdEnd - 0.0005;
    }

    /** スプリット後のリージョン間ギャップ（映像なし区間） */
    function isTransportInVideoSegmentGap(transportSec) {
        const track = getVideoTrackRef();
        if (typeof isTrackRegionActive !== 'function' || !isTrackRegionActive(track)) {
            return false;
        }
        const count = typeof getSegmentCount === 'function' ? getSegmentCount(track) : 0;
        if (count < 2) return false;
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return false;
        const mapForPlayback =
            typeof mapTransportToSegmentForPlayback === 'function'
                ? mapTransportToSegmentForPlayback
                : null;
        if (mapForPlayback && mapForPlayback(track, t)) return false;
        if (isTransportInVideoPreRollHoldZone(t)) return false;
        const lastIdx = count - 1;
        const segTimelineEnd =
            typeof getSegmentTimelineEnd === 'function'
                ? getSegmentTimelineEnd(track, lastIdx)
                : 0;
        const regionOut =
            typeof getSegmentRegionTimelineOut === 'function'
                ? getSegmentRegionTimelineOut(track, lastIdx)
                : segTimelineEnd;
        if (t >= segTimelineEnd - 0.0005 && t < regionOut + 0.0005) return false;
        if (t >= regionOut - 0.0005) return false;
        return true;
    }

    /** 単一セグメント — regionIn 以降は transport と映像秒が 1:1 */
    function videoRegionMappingIsOneToOneAfterIn() {
        const track = getVideoTrackRef();
        if (typeof isTrackRegionActive !== 'function' || !isTrackRegionActive(track)) {
            return false;
        }
        const count = typeof getSegmentCount === 'function' ? getSegmentCount(track) : 0;
        return count === 1;
    }

    window.getVideoRegionTimelineInSec = getVideoRegionTimelineInSec;
    window.getVideoRegionPreRollHoldEndSec = getVideoRegionPreRollHoldEndSec;
    window.isTransportBeforeVideoRegionIn = isTransportBeforeVideoRegionIn;
    window.isTransportInVideoPreRollHoldZone = isTransportInVideoPreRollHoldZone;
    window.isTransportInVideoSegmentGap = isTransportInVideoSegmentGap;
    window.videoRegionMappingIsOneToOneAfterIn = videoRegionMappingIsOneToOneAfterIn;

    function videoRegionTailSourceSec(track, segmentIndex) {
        const segments =
            typeof getTrackSegments === 'function' ? getTrackSegments(track) : [];
        const seg = segments[segmentIndex];
        if (!seg) return null;
        const frame =
            typeof masterFrameSec === 'number' && masterFrameSec > 0 ? masterFrameSec : 1 / 24;
        const srcIn = Number(seg.sourceInSec) || 0;
        const srcOut = Number(seg.sourceOutSec) || 0;
        return Math.max(srcIn, srcOut - frame);
    }

    function videoSecFromVideoTrackRegions(transportSec) {

        const track = getVideoTrackRef();

        if (

            typeof isTrackRegionActive !== 'function' ||

            !isTrackRegionActive(track) ||

            typeof segmentSourceSecFromTransport !== 'function'

        ) {

            return null;

        }

        const mapForPlayback =
            typeof mapTransportToSegmentForPlayback === 'function'
                ? mapTransportToSegmentForPlayback
                : typeof getExtraTrackPlaybackAtTransport === 'function'
                  ? getExtraTrackPlaybackAtTransport
                  : typeof mapTransportToSegment === 'function'
                    ? mapTransportToSegment
                    : null;
        if (!mapForPlayback) return null;

        const t = Number(transportSec);

        if (!Number.isFinite(t)) return null;

        const mapHit = mapForPlayback(track, t);

        if (mapHit) {
            const src = segmentSourceSecFromTransport(track, mapHit.segmentIndex, t);

            if (typeof window.videoRegionDiagLogPlaybackSync === 'function') {
                window.videoRegionDiagLogPlaybackSync(t, mapHit, src);
            }

            return Number.isFinite(src) ? src : null;
        }

        const count = typeof getSegmentCount === 'function' ? getSegmentCount(track) : 0;

        if (count < 1) return null;

        const firstIn =

            typeof getSegmentRegionTimelineIn === 'function'

                ? getSegmentRegionTimelineIn(track, 0)

                : 0;

        if (t < firstIn - 0.0005) {
            const segments =
                typeof getTrackSegments === 'function' ? getTrackSegments(track) : [];
            const seg = segments[0];
            if (seg) {
                const srcIn = Math.max(0, Number(seg.sourceInSec) || 0);
                const playbackStart =
                    typeof getSegmentPlaybackTimelineStart === 'function'
                        ? getSegmentPlaybackTimelineStart(track, 0)
                        : firstIn;
                const timelineStart = Math.max(0, playbackStart - srcIn);
                if (t >= timelineStart - 0.0005) {
                    return Math.max(0, t - timelineStart);
                }
                if (srcIn > 0.0005) {
                    return srcIn;
                }
            }
            return 0;
        }

        const lastIdx = count - 1;

        const regionOut =

            typeof getSegmentRegionTimelineOut === 'function'

                ? getSegmentRegionTimelineOut(track, lastIdx)

                : typeof getSegmentTimelineEnd === 'function'

                  ? getSegmentTimelineEnd(track, lastIdx)

                  : 0;

        const segTimelineEnd =
            typeof getSegmentTimelineEnd === 'function'
                ? getSegmentTimelineEnd(track, lastIdx)
                : regionOut;

        if (t >= segTimelineEnd - 0.0005 && t < regionOut + 0.0005) {
            return videoRegionTailSourceSec(track, lastIdx);
        }

        if (t >= regionOut - 0.0005) {
            return videoRegionTailSourceSec(track, lastIdx);
        }

        return null;

    }



    window.videoSecFromVideoTrackRegions = videoSecFromVideoTrackRegions;
    window.videoRegionTailSourceSec = videoRegionTailSourceSec;


