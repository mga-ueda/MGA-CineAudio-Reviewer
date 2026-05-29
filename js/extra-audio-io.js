/**
 * extra-audio-io.js — Ex 音声モジュールの公開 API（window エクスポート集約）。
 */
(function extraAudioIoModule() {
    window.VIDEO_AUDIO_SLOT_LABEL = VIDEO_AUDIO_SLOT_LABEL;
    window.EXTRA_TRACK_COUNT = EXTRA_TRACK_COUNT;

    window.ensureReviewMixCtx = ensureReviewMixCtx;
    window.getExtraTrackTimelineStartSec = getExtraTrackTimelineStartSec;
    window.setExtraTrackTimelineStartSec = setExtraTrackTimelineStartSec;
    window.extraTrackTimelineEndSec = extraTrackTimelineEndSec;
    window.getDefaultExtraClipId = function () {
        return 'main';
    };
    window.getExtraTrackClipDurationSec = function (slot, clipId) {
        const tr = extraTrackBySlot(slot);
        const clip = getExtraTrackClip(tr, clipId);
        return clip && clip.buffer && clip.buffer.duration > 0 ? clip.buffer.duration : 0;
    };
    window.getExtraTrackClipPeaks = function (slot, clipId) {
        const tr = extraTrackBySlot(slot);
        const clip = getExtraTrackClip(tr, clipId);
        return clip && clip.peaks ? clip.peaks : null;
    };
    window.getExtraTrackPersistEntry = getExtraTrackPersistEntry;
    window.reviewMixNeedsPlaybackSync = reviewMixNeedsPlaybackSync;
    window.applyReviewMixCrossfadeGainsIfNeeded = applyReviewMixCrossfadeGainsIfNeeded;
    window.getSegmentMappingTransportSec = getSegmentMappingTransportSec;
    window.EXTRA_AUDIO_SCHEDULE_AHEAD_SEC = EXTRA_AUDIO_SCHEDULE_AHEAD_SEC;
    window.beginVideoExportAudioFilter = beginVideoExportAudioFilter;
    window.endVideoExportAudioFilter = endVideoExportAudioFilter;

    window.resetVideoTrackMixToDefault = resetVideoTrackMixToDefault;
    window.handleActiveMixLaneVolumeKeydown = handleActiveMixLaneVolumeKeydown;
    window.toggleExtraTrackSolo = toggleExtraSolo;
    window.toggleExtraTrackMute = toggleExtraMute;
    window.resolveActiveMixLaneDisplayIndex = resolveActiveMixLaneDisplayIndex;
    window.toggleMixSoloByDisplayIndex = toggleMixSoloByDisplayIndex;
    window.soloOnlyMixByDisplayIndex = soloOnlyMixByDisplayIndex;
    window.toggleMixMuteByDisplayIndex = toggleMixMuteByDisplayIndex;
    window.clearAllMixMute = clearAllMixMute;
    window.adjustExtraTrackVolumeDb = adjustExtraTrackVolumeDb;
    window.clearExtraTrackVolumeUnityHold = clearExtraTrackVolumeUnityHold;
    window.tryWireReviewMixVideoAudioWhenReady = tryWireReviewMixVideoAudioWhenReady;
    window.ensureReviewMixVideoMonitorTap = ensureReviewMixVideoMonitorTap;
    window.applyReviewMixVideoMonitorTapGain = applyReviewMixVideoMonitorTapGain;
    window.isVideoAudioPlaybackViaNativeElement = isVideoAudioPlaybackViaNativeElement;

    window.getExtraTrackClipBuffer = getExtraTrackClipBuffer;
    window.peaksFromBuffer = peaksFromBuffer;
    window.peaksFromBufferRange = peaksFromBufferRange;
    window.decodeExtraFileArrayBuffer = decodeExtraFileArrayBuffer;
    window.buildExtraTrackPeaksPreviewFromWavBlob = buildExtraTrackPeaksPreviewFromWavBlob;

    window.primeReviewMixForPlayback = primeReviewMixForPlayback;
    window.extraTrackContentDurationSec = extraTrackContentDurationSec;
    window.getExtraTrackMaxClipDurationSec = function (slot) {
        return extraTrackBufferDuration(slot);
    };
    window.extraTrackBufferDuration = extraTrackBufferDuration;
    window.isExtraTrackLoaded = isExtraTrackLoaded;
    window.syncReviewMixToTransport = syncReviewMixToTransport;
    window.syncExtraAudioToTransport = syncExtraAudioToTransport;
    window.isPastAllLoadedTrackPlaybackEnds = isPastAllLoadedTrackPlaybackEnds;

    window.applyExtraTrackPeaksPreview = applyExtraTrackPeaksPreview;
    window.getExtraTracksPersistSnapshot = getExtraTracksPersistSnapshot;
    window.schedulePersistExtraTrackSlot = schedulePersistExtraTrackSlot;
    window.finalizeReviewMixAfterSessionRestore = finalizeReviewMixAfterSessionRestore;
    window.prepareReviewMixForNewVideoLoad = prepareReviewMixForNewVideoLoad;
    window.ensureExtraTrackWaveformsDrawn = ensureExtraTrackWaveformsDrawn;
    window.ensureExtraTrackWaveformsDrawnAsync = ensureExtraTrackWaveformsDrawnAsync;
    window.getVisibleLoadedExtraTrackSlots = getVisibleLoadedExtraTrackSlots;
    window.isExtraTrackWaveformPlacementReady = isExtraTrackWaveformPlacementReady;
    window.areExtraTrackWaveformsRestorePending = areExtraTrackWaveformsRestorePending;
    window.extraTrackStatusIndicatesDecoding = extraTrackStatusIndicatesDecoding;

    window.clearAllExtraWaveformViewportPeaks = clearAllExtraWaveformViewportPeaks;
    window.rebuildAllExtraWaveformViewportPeaks = rebuildAllExtraWaveformViewportPeaks;
    window.reviveOneEmptyExtraLane = reviveOneEmptyExtraLane;
    window.getWaveformLaneUiPersistSnapshot = getWaveformLaneUiPersistSnapshot;
    window.applyWaveformLaneUiPersistSnapshot = applyWaveformLaneUiPersistSnapshot;
    window.applySavedWaveformLaneUi = applySavedWaveformLaneUi;
    window.hideEmptyExtraLanesWhenVideoAudioVisible = hideEmptyExtraLanesWhenVideoAudioVisible;
    window.restoreExtraTrackLanesForNewVideo = restoreExtraTrackLanesForNewVideo;
    window.extraTrackSlotHasContent = extraTrackSlotHasContent;
    window.isExtraTrackLaneShown = isExtraTrackLaneShown;
    window.redrawAllExtraTrackWaveforms = redrawAllExtraTrackWaveforms;
    window.syncExtraTrackLaneMixVisual = syncExtraTrackLaneMixVisual;
    window.scheduleExtraTrackWaveformRedraw = scheduleExtraTrackWaveformRedraw;
    window.clearStaleExtraTrackDecodingStatus = clearStaleExtraTrackDecodingStatus;
    window.cancelExtraTrackWaveformEnsure = cancelExtraTrackWaveformEnsure;
    window.refreshExtraTrackRegionOverlaysAfterSessionRestore =
        refreshExtraTrackRegionOverlaysAfterSessionRestore;
    window.refreshAllExtraTrackLaneVisibility = refreshAllExtraTrackLaneVisibility;

    window.loadExtraTrackFile = loadExtraTrackFile;
    window.hasAnyExtraTrackLoaded = hasAnyExtraTrackLoaded;
    window.hasAnyExtraTrackTimelineContent = hasAnyExtraTrackTimelineContent;
    window.assignExtraAudioFiles = assignExtraAudioFiles;
    window.assignExtraAudioFilesFromDrop = assignExtraAudioFilesFromDrop;
    window.isBulkOneFilePerTrackDropTarget = isBulkOneFilePerTrackDropTarget;
    window.revealNextExtraTrackLane = revealNextExtraTrackLane;
    window.handleExtraTrackAddShortcutKeydown = handleExtraTrackAddShortcutKeydown;
    window.syncExtraLaneVisibilityAfterSessionRestore = syncExtraLaneVisibilityAfterSessionRestore;
})();
