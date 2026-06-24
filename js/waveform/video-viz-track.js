/**

 * video-viz-track.js — 動画映像タイムラインレーン（分割・In/Out、filmstrip サムネイル）

 */

    const VIDEO_TRACK_REF = { type: 'video' };

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



    /** 映像波形描画 — 適用済みリージョンまたはセッション復元 pending */
    function resolveVideoTrackWaveformRegionSegment() {
        const track = getVideoTrackRef();
        if (!track) return null;
        const regionActive =
            typeof isTrackRegionActive === 'function' && isTrackRegionActive(track);
        if (regionActive) {
            const segments =
                typeof getTrackSegments === 'function' ? getTrackSegments(track) : [];
            const seg = segments[0];
            if (!seg) return null;
            return { track, seg, regionActive: true };
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

    function resolveRegionInForVideoWaveformDraw(track, seg, regionActive, pendingEntry) {
        const anchor = regionActive
            ? typeof getSegmentTimelineStart === 'function'
                ? getSegmentTimelineStart(track, 0)
                : 0
            : Number.isFinite(seg.timelineStartSec)
              ? seg.timelineStartSec
              : 0;
        let regionIn = NaN;
        if (Number.isFinite(seg.regionTimelineInSec)) {
            regionIn = seg.regionTimelineInSec;
        } else if (regionActive && typeof getSegmentRegionTimelineIn === 'function') {
            regionIn = getSegmentRegionTimelineIn(track, 0);
        } else if (Number.isFinite(pendingEntry?.regionTimelineInSec)) {
            regionIn = pendingEntry.regionTimelineInSec;
        } else {
            regionIn = anchor;
        }
        const sourceIn = Math.max(0, Number(seg.sourceInSec) || 0);
        if (
            typeof isRegionInHandleDragActive === 'function' &&
            isRegionInHandleDragActive() &&
            Number.isFinite(regionHandleDragStartRegionIn) &&
            Number.isFinite(regionHandleDragStartSourceInSec)
        ) {
            const dragRegionIn =
                regionHandleDragStartRegionIn +
                (sourceIn - regionHandleDragStartSourceInSec);
            if (dragRegionIn > regionIn + 0.00001) {
                regionIn = dragRegionIn;
            }
        }
        return { anchor, regionIn, sourceIn };
    }

    /** 再生開始（ソース先頭が鳴り始めるタイムライン位置）。pending 復元時は seg から推定。 */
    function resolvePlaybackStartForVideoWaveformDraw(
        track,
        seg,
        regionActive,
        regionIn,
        anchor,
    ) {
        if (regionActive && typeof getSegmentPlaybackTimelineStart === 'function') {
            return getSegmentPlaybackTimelineStart(track, 0);
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
     * In・Out トリムは左右クリップのみ（波形幅はソース全長固定）。
     */
    function resolveVideoTrackWaveformDrawParams() {
        const ctx = resolveVideoTrackWaveformRegionSegment();
        if (!ctx) return null;
        const { track, seg, pendingEntry, regionActive } = ctx;
        const { anchor, regionIn, sourceIn } = resolveRegionInForVideoWaveformDraw(
            track,
            seg,
            regionActive,
            pendingEntry,
        );
        const srcOut = Number.isFinite(seg.sourceOutSec) ? seg.sourceOutSec : 0;
        if (!(srcOut > 0.0005)) return null;
        const fullSourceDur =
            typeof getVideoTrackSourceDurationSec === 'function'
                ? getVideoTrackSourceDurationSec()
                : 0;
        const waveformSourceOut =
            fullSourceDur > 0.0005 ? Math.max(srcOut, fullSourceDur) : srcOut;
        const playbackStart = resolvePlaybackStartForVideoWaveformDraw(
            track,
            seg,
            regionActive,
            regionIn,
            anchor,
        );
        const timelineStartSec = Math.max(0, playbackStart - sourceIn);
        let clipStartSec = null;
        if (regionIn > timelineStartSec + 0.00001) {
            clipStartSec = regionIn;
        }
        let clipEndSec = null;
        if (regionActive) {
            const end = getVideoTrackRegionTimelineEndSec();
            if (end > 0) clipEndSec = end;
        } else if (Number.isFinite(seg.regionTimelineOutSec) && seg.regionTimelineOutSec > 0) {
            clipEndSec = seg.regionTimelineOutSec;
        }
        return {
            timelineStartSec,
            clipStartSec,
            clipEndSec,
            contentDurSec: waveformSourceOut,
            sourceInSec: sourceIn,
            sourceOutSec: waveformSourceOut,
            regionInSec: regionIn,
            playbackStartSec: playbackStart,
            anchorSec: anchor,
        };
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

        if (regionEls.length !== segments.length) {

            syncVideoAudioLaneRegionOverlays(track);

            return;

        }

        for (let i = 0; i < segments.length; i++) {

            if (typeof positionRegionOverlayEl === 'function') {

                positionRegionOverlayEl(regionEls[i], track, i, segments[i]);

            }

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

    /** タイムライン上の映像ソース終端（再生 1:1 基準 = playbackStart + span） */
    function getVideoTrackSourceTimelineEndSec() {
        const track = getVideoTrackRef();
        if (typeof isTrackRegionActive === 'function' && isTrackRegionActive(track)) {
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

    let videoFilmstripLoadingActive = false;



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
        const pendingVideo =
            typeof getPendingPlaybackRegionRestoreVideoEntry === 'function'
                ? getPendingPlaybackRegionRestoreVideoEntry()
                : null;

        if (!pendingVideo) {
            ensureDefaultVideoTrackRegion({ silent: true });
        }

        const track = getVideoTrackRef();
        const state = getVideoTrackState().playbackRegions;
        if (!state || !state.active || !state.segments || !state.segments.length) {
            return false;
        }

        if (typeof updateTrackRegionOverlays === 'function') {

            updateTrackRegionOverlays(track);

        }

        renderVideoVizFilmstrip();

        if (
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

        ensureVideoFilmstripLoadingOverlay();

        refreshVideoVizLaneVisibility({ skipInit: true });

        if (!pendingVideo && getVideoTrackSourceDurationSec() > 0) {

            syncVideoTrackRegionsPresentation();

        }

        scheduleVideoTrackFilmstripBuild(opt);

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

        const maxFrames = 72;

        const targetIntervalSec = 2;

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

        const h = thumbH || 32;

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

        return canvas.toDataURL('image/jpeg', 0.65);

    }



    function restoreVideoPresentationAfterFilmstripBuild() {

        const refreshUi = () => {

            if (typeof updateTimecodeOverlay === 'function') updateTimecodeOverlay();

            if (typeof refreshVideoPastEndBlackoutUi === 'function') {
                refreshVideoPastEndBlackoutUi();
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

        if (!videoMain || !videoReady || !videoReady()) return false;

        if (shouldSkipHeavyVideoVizRefreshDuringOffsetDrag()) return false;

        const duration = getVideoTrackSourceDurationSec();

        if (!duration) return false;

        ensureVideoFilmstripLoadingOverlay();

        const gen = ++videoTrackFilmstripGen;

        const times = computeFilmstripSampleTimes(duration);

        const wasPaused = videoMain.paused;

        const frames = [];

        try {

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

                }

                if (gen !== videoTrackFilmstripGen) return false;

                const dataUrl = await captureVideoFrameDataUrl(t, 32);

                if (!dataUrl) continue;

                frames.push({ sourceSec: t, dataUrl: dataUrl });

                if (i % 3 === 0 || i === times.length - 1) {

                    videoTrackFilmstripFrames = frames.slice();

                    renderVideoVizFilmstrip();

                    if (typeof refreshVideoPastEndBlackoutUi === 'function') {
                        refreshVideoPastEndBlackoutUi();
                    }

                }

            }

            videoTrackFilmstripFrames = frames;

            renderVideoVizFilmstrip();

            return frames.length > 0;

        } catch (_) {

            return false;

        } finally {

            if (gen === videoTrackFilmstripGen) {

                setVideoFilmstripLoadingOverlay(false);

                restoreVideoPresentationAfterFilmstripBuild();

                if (typeof syncVideoTrackRegionsPresentation === 'function') {
                    syncVideoTrackRegionsPresentation({ force: true });
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



    function scheduleVideoTrackFilmstripBuild(opt) {

        if (shouldSkipHeavyVideoVizRefreshDuringOffsetDrag()) return;

        ensureVideoFilmstripLoadingOverlay();

        if (videoTrackFilmstripBuildQueued) return;

        videoTrackFilmstripBuildQueued = true;

        requestAnimationFrame(() => {

            videoTrackFilmstripBuildQueued = false;

            void buildVideoTrackFilmstrip(opt);

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

        filmstrip.hidden = !frames.length;

        if (!frames.length) {

            filmstrip.textContent = '';

            return;

        }

        const existing = filmstrip.querySelectorAll('.video-viz-lane__filmstrip-cell');

        if (existing.length === frames.length) {

            for (let i = 0; i < frames.length; i++) {

                existing[i].style.backgroundImage = 'url("' + frames[i].dataUrl + '")';

            }

            return;

        }

        filmstrip.textContent = '';

        for (let i = 0; i < frames.length; i++) {

            const cell = document.createElement('div');

            cell.className = 'video-viz-lane__filmstrip-cell';

            cell.style.backgroundImage = 'url("' + frames[i].dataUrl + '")';

            filmstrip.appendChild(cell);

        }

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



    function refreshVideoVizRegionThumbnails() {

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


