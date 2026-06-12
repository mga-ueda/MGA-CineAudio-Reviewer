/**
 * waveform-region-overlay-update.js — overlay 更新・ジオメトリ同期
 */
    function refreshTrackRegionOverlayGeometry(track) {
        const container = getPlaybackRegionsContainerEl(track);
        if (!container) return;
        const segments = getTrackSegments(track);
        if (!segments.length) {
            updateTrackRegionOverlays(track);
            return;
        }
        const regionEls = container.querySelectorAll(
            '.audio-waveform-lane__playback-region',
        );
        if (regionEls.length !== segments.length) {
            updateTrackRegionOverlays(track);
            return;
        }
        for (let i = 0; i < segments.length; i++) {
            positionRegionOverlayEl(regionEls[i], track, i, segments[i]);
        }
        const splitHandles = container.querySelectorAll(
            '.audio-waveform-lane__playback-region__handle--split',
        );
        const offsetDragActive = isOffsetDragRegionWaveformPreviewActive();
        const activeSplitBoundaryIndex =
            isSplitBoundaryRegionDragActive() &&
            Number.isFinite(regionHandleDragBoundaryIndex)
                ? regionHandleDragBoundaryIndex
                : -1;
        for (let h = 0; h < splitHandles.length; h++) {
            const el = splitHandles[h];
            const b = Number(el.dataset.boundaryIndex);
            if (!Number.isFinite(b) || b < 0 || b >= segments.length - 1) {
                el.hidden = true;
                continue;
            }
            if (offsetDragActive) {
                el.hidden = true;
                continue;
            }
            const showSplitHandle =
                b === activeSplitBoundaryIndex ||
                isSegmentMovableSplitBoundary(track, b) ||
                isSegmentBoundaryJoined(track, b);
            if (showSplitHandle) {
                positionSplitHandleEl(el, track, b);
            } else {
                el.hidden = true;
            }
        }
        const zones = collectTrackCrossfadeZones(track);
        const markers = container.querySelectorAll('.audio-waveform-lane__crossfade-marker');
        if (markers.length !== zones.length) {
            if (isSplitBoundaryRegionDragActive()) {
                for (let z = 0; z < markers.length && z < zones.length; z++) {
                    positionCrossfadeMarkerEl(markers[z], zones[z].startSec, zones[z].endSec);
                }
            } else {
                updateTrackRegionOverlays(track);
                return;
            }
        } else {
            for (let z = 0; z < zones.length; z++) {
                positionCrossfadeMarkerEl(markers[z], zones[z].startSec, zones[z].endSec);
            }
        }
        const silentGaps =
            typeof collectTrackSilentGaps === 'function'
                ? collectTrackSilentGaps(track)
                : [];
        const silentGapEls = container.querySelectorAll(
            '.audio-waveform-lane__playback-silent-gap',
        );
        if (silentGapEls.length !== silentGaps.length && !isSplitBoundaryRegionDragActive()) {
            updateTrackRegionOverlays(track);
            return;
        }
        for (let g = 0; g < silentGaps.length; g++) {
            positionSilentGapOverlayEl(silentGapEls[g], silentGaps[g]);
        }
        applyDenseRegionBoundaryPresentation(track, container);
        refreshTrackFadeTriangleVisibility(track, container);
    }

    let trackRegionOverlayBuildDepth = 0;

    function updateTrackRegionOverlays(track, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const restoreBusy =
            typeof isSessionRestoreBusy === 'function' && isSessionRestoreBusy();
        const lightweight = !!(o.lightweight || o.forceLightweight || restoreBusy);
        const diagEx =
            isExtraTrackRef(track) && Number.isFinite(track.slot)
                ? { ex: (track.slot | 0) + 1, lightweight }
                : { lightweight };
        const diagRun =
            typeof window.regionRestoreDiagRunStep === 'function'
                ? window.regionRestoreDiagRunStep
                : function (_label, fn) {
                      return fn();
                  };
        const diagLog =
            typeof window.regionRestoreDiagLog === 'function'
                ? window.regionRestoreDiagLog
                : function () {};
        if (trackRegionOverlayBuildDepth > 0) {
            diagLog('overlay/reenter-skip', diagEx);
            return;
        }
        trackRegionOverlayBuildDepth += 1;
        diagLog('overlay/begin', diagEx);
        try {
        diagRun(
            'overlay/syncLaneMix',
            () => {
                if (
                    isExtraTrackRef(track) &&
                    typeof syncExtraTrackLaneMixVisual === 'function'
                ) {
                    syncExtraTrackLaneMixVisual(track.slot);
                }
            },
            diagEx,
        );
        const container = diagRun(
            'overlay/getContainer',
            () => getPlaybackRegionsContainerEl(track),
            diagEx,
        );
        if (!container) {
            diagLog('overlay/no-container', diagEx);
            return;
        }
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
        if (restoreHover) setHoveredPlaybackRegion(null);
        diagRun('overlay/clearDom', () => container.replaceChildren(), diagEx);
        const state = getPlaybackRegionsState(track);
        const hasConfiguredRegions =
            state &&
            state.active &&
            Array.isArray(state.segments) &&
            state.segments.length > 0;
        let segments = diagRun(
            'overlay/getTrackSegments',
            () => getTrackSegments(track),
            diagEx,
        );
        if (
            !segments.length &&
            !hasConfiguredRegions &&
            !isSessionRestoreBusy() &&
            ensureDefaultTrackRegion(track, { skipOverlay: true, silent: true })
        ) {
            segments = diagRun(
                'overlay/getTrackSegments-after-default',
                () => getTrackSegments(track),
                diagEx,
            );
        }
        if (!segments.length) {
            container.hidden = true;
            syncExtraLaneRegionsClassForTrack(track);
            syncTrackPhraseRehearsalMarks(track);
            diagLog('overlay/empty-hidden', diagEx);
            return;
        }
        container.hidden = false;
        let labelSlots = null;
        if (
            !lightweight &&
            isMusicalGridPhraseFillVisibleSafe() &&
            typeof window.getTrackTimelineSlots === 'function'
        ) {
            labelSlots = diagRun(
                'overlay/getTimelineSlots',
                () => window.getTrackTimelineSlots(track, { writeCache: false }),
                diagEx,
            );
        }
        diagRun(
            'overlay/buildRegionEls',
            () => {
                for (let i = 0; i < segments.length; i++) {
                    const seg = segments[i];
                    const stepLabel = 'overlay/region/' + (i + 1);
                    if (typeof window.regionRestoreDiagRunStep === 'function') {
                        window.regionRestoreDiagRunStep(
                            stepLabel,
                            () => {
                                const el = buildRegionOverlayEl(track, i, seg, labelSlots);
                                positionRegionOverlayEl(el, track, i, seg);
                                container.appendChild(el);
                            },
                            diagEx,
                        );
                    } else {
                        const el = buildRegionOverlayEl(track, i, seg, labelSlots);
                        positionRegionOverlayEl(el, track, i, seg);
                        container.appendChild(el);
                    }
                }
            },
            Object.assign({}, diagEx, { segCount: segments.length }),
        );
        if (!lightweight) {
            diagRun(
                'overlay/silentGaps',
                () => {
                    const silentGaps =
                        typeof collectTrackSilentGaps === 'function'
                            ? collectTrackSilentGaps(track)
                            : [];
                    for (let g = 0; g < silentGaps.length; g++) {
                        const gapEl = buildSilentGapOverlayEl(
                            track,
                            g,
                            silentGaps[g],
                            labelSlots,
                        );
                        positionSilentGapOverlayEl(gapEl, silentGaps[g]);
                        container.appendChild(gapEl);
                    }
                    return silentGaps.length;
                },
                diagEx,
            );
            diagRun(
                'overlay/crossfadeMarkers',
                () => {
                    const crossfadeZones = collectTrackCrossfadeZones(track);
                    for (let z = 0; z < crossfadeZones.length; z++) {
                        const zone = crossfadeZones[z];
                        const marker = buildCrossfadeMarkerEl();
                        positionCrossfadeMarkerEl(marker, zone.startSec, zone.endSec);
                        container.appendChild(marker);
                    }
                    return crossfadeZones.length;
                },
                diagEx,
            );
        }
        diagRun(
            'overlay/splitHandles',
            () => {
                for (let b = 0; b < segments.length - 1; b++) {
                    if (
                        !isSegmentMovableSplitBoundary(track, b) &&
                        !isSegmentBoundaryJoined(track, b)
                    ) {
                        continue;
                    }
                    const splitEl = buildSplitHandleEl(b);
                    positionSplitHandleEl(splitEl, track, b);
                    container.appendChild(splitEl);
                }
            },
            diagEx,
        );
        syncExtraLaneRegionsClassForTrack(track);
        syncRegionSelectionClasses();
        if (!lightweight) {
            diagRun(
                'overlay/densePresentation',
                () => {
                    applyDenseRegionBoundaryPresentation(track, container);
                    refreshTrackFadeTriangleVisibility(track, container);
                },
                diagEx,
            );
        }
        if (
            restoreHover &&
            Number.isFinite(hoverClientX) &&
            Number.isFinite(hoverClientY)
        ) {
            updatePlaybackRegionHoverFromPointer(hoverClientX, hoverClientY, false);
        }
        if (
            !lightweight &&
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible() &&
            isTrackRegionActive(track) &&
            typeof scheduleMusicalGridRedraw === 'function'
        ) {
            scheduleMusicalGridRedraw();
        }
        if (!lightweight) {
            diagRun('overlay/phraseMarks', () => syncTrackPhraseRehearsalMarks(track), diagEx);
        }
        diagLog('overlay/done', diagEx);
        } finally {
            trackRegionOverlayBuildDepth -= 1;
            if (trackRegionOverlayBuildDepth < 0) trackRegionOverlayBuildDepth = 0;
        }
    }

