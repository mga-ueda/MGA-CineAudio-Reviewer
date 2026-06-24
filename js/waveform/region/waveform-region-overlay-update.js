/**
 * waveform-region-overlay-update.js — overlay 更新・ジオメトリ同期
 */
    const REGION_HIT_DEBUG_CLASS = 'audio-waveform-lane__region-hit-debug';
    const REGION_HIT_DEBUG_OVERLAY_CLASS =
        'audio-waveform-composite__region-hit-debug-overlay';
    const REGION_HIT_DEBUG_EDGE_PAD_PX = 4;

    function isRegionHandleHitDebugOn() {
        if (typeof window.isRegionHandleHitDebugEnabled === 'function') {
            return window.isRegionHandleHitDebugEnabled();
        }
        return !!(window.REGION_HANDLE_HIT_DEBUG || window.FADE_TRIANGLE_HIT_DEBUG);
    }

    function getWaveformLanesInnerEl() {
        return typeof audioWaveformLanesInner !== 'undefined' && audioWaveformLanesInner
            ? audioWaveformLanesInner
            : document.getElementById('audioWaveformLanesInner');
    }

    function removeRegionHitDebugEls(root, selector) {
        if (!root) return;
        root.querySelectorAll(selector || '.' + REGION_HIT_DEBUG_CLASS).forEach((el) => el.remove());
    }

    function clearAllRegionHitDebugEls() {
        removeRegionHitDebugEls(document);
        const overlay = document.querySelector('.' + REGION_HIT_DEBUG_OVERLAY_CLASS);
        if (overlay) overlay.replaceChildren();
    }

    function ensureRegionHitDebugOverlayRoot() {
        const on = isRegionHandleHitDebugOn();
        const inner = getWaveformLanesInnerEl();
        if (!inner) return null;
        let root = inner.querySelector('.' + REGION_HIT_DEBUG_OVERLAY_CLASS);
        if (!on) {
            if (root) {
                root.replaceChildren();
                root.hidden = true;
            }
            return null;
        }
        if (!root) {
            root = document.createElement('div');
            root.className = REGION_HIT_DEBUG_OVERLAY_CLASS;
            root.setAttribute('aria-hidden', 'true');
            const rehearsal = inner.querySelector(
                '.audio-waveform-composite__rehearsal-boundaries',
            );
            if (rehearsal) rehearsal.insertAdjacentElement('afterend', root);
            else inner.appendChild(root);
        }
        root.hidden = false;
        return root;
    }

    function createRegionHitDebugEl(kindClass, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const el = document.createElement('div');
        el.className = REGION_HIT_DEBUG_CLASS + ' ' + REGION_HIT_DEBUG_CLASS + kindClass;
        if (o.label) {
            const labelEl = document.createElement('span');
            labelEl.className = REGION_HIT_DEBUG_CLASS + '__label';
            labelEl.textContent = o.label;
            el.appendChild(labelEl);
        }
        el.setAttribute('aria-hidden', 'true');
        return el;
    }

    /** 専用オーバーレイ上の client 座標矩形（musical-grid / Rehearsal 着色は隠さない） */
    function placeRegionHitDebugEl(el, overlayRoot, clientBox) {
        if (!el || !overlayRoot || !clientBox) return;
        const overlayRect = overlayRoot.getBoundingClientRect();
        el.style.position = 'absolute';
        el.style.left = clientBox.left - overlayRect.left + 'px';
        el.style.top = clientBox.top - overlayRect.top + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.transform = 'none';
        if (Number.isFinite(clientBox.width) && clientBox.width > 0) {
            el.style.width = clientBox.width + 'px';
        }
        if (Number.isFinite(clientBox.height) && clientBox.height > 0) {
            el.style.height = clientBox.height + 'px';
        }
        overlayRoot.appendChild(el);
    }

    function syncRegionHitDebugOverlays(regionEl, overlayRoot) {
        if (!regionEl || !overlayRoot || !isRegionHandleHitDebugOn()) return;

        const regionRect = regionEl.getBoundingClientRect();
        if (!(regionRect.width > 0) || !(regionRect.height > 0)) return;

        const reservePx =
            typeof window.REGION_FADE_RESERVE_TOP_INSET_PX === 'number'
                ? window.REGION_FADE_RESERVE_TOP_INSET_PX
                : 18;
        placeRegionHitDebugEl(
            createRegionHitDebugEl('--fade-reserve', { label: 'fade-reserve' }),
            overlayRoot,
            {
                left: regionRect.left,
                top: regionRect.top,
                width: regionRect.width,
                height: reservePx,
            },
        );

        const fadeSpecs = [
            {
                handleSel: '.audio-waveform-lane__playback-region__handle--fade-in',
                kindClass: '--fade-in',
                label: 'fade-in',
                edgeKind: 'in',
            },
            {
                handleSel: '.audio-waveform-lane__playback-region__handle--fade-out',
                kindClass: '--fade-out',
                label: 'fade-out',
                edgeKind: 'out',
            },
        ];
        for (let i = 0; i < fadeSpecs.length; i++) {
            const handle = regionEl.querySelector(fadeSpecs[i].handleSel);
            if (!handle) continue;
            const debugEl = createRegionHitDebugEl(fadeSpecs[i].kindClass, {
                label: fadeSpecs[i].label,
            });
            const hitRect =
                typeof getFadeHandleHitRect === 'function'
                    ? getFadeHandleHitRect(regionEl, fadeSpecs[i].edgeKind)
                    : null;
            if (hitRect) {
                placeRegionHitDebugEl(debugEl, overlayRoot, hitRect);
            } else {
                const handleRect = handle.getBoundingClientRect();
                placeRegionHitDebugEl(debugEl, overlayRoot, handleRect);
            }
            if (handle.hidden) {
                debugEl.classList.add(REGION_HIT_DEBUG_CLASS + '--suppressed');
            }
            if (typeof window.REGION_FADE_RESERVE_TOP_INSET_PX === 'number') {
                debugEl.style.setProperty(
                    '--region-hit-debug-fade-band-h',
                    window.REGION_FADE_RESERVE_TOP_INSET_PX + 'px',
                );
            }
        }

        const inHandle = regionEl.querySelector(
            '.audio-waveform-lane__playback-region__handle--in',
        );
        if (inHandle) {
            const handleRect = inHandle.getBoundingClientRect();
            placeRegionHitDebugEl(
                createRegionHitDebugEl('--edge-in', { label: 'in' }),
                overlayRoot,
                {
                    left: handleRect.left - REGION_HIT_DEBUG_EDGE_PAD_PX,
                    top: regionRect.top,
                    width: handleRect.width + REGION_HIT_DEBUG_EDGE_PAD_PX * 2,
                    height: regionRect.height,
                },
            );
        }
        const outHandle = regionEl.querySelector(
            '.audio-waveform-lane__playback-region__handle--out',
        );
        if (outHandle) {
            const handleRect = outHandle.getBoundingClientRect();
            placeRegionHitDebugEl(
                createRegionHitDebugEl('--edge-out', { label: 'out' }),
                overlayRoot,
                {
                    left: handleRect.left - REGION_HIT_DEBUG_EDGE_PAD_PX,
                    top: regionRect.top,
                    width: handleRect.width + REGION_HIT_DEBUG_EDGE_PAD_PX * 2,
                    height: regionRect.height,
                },
            );
        }
    }

    function syncContainerRegionHitDebugOverlays(track, container, overlayRoot) {
        if (!container || !overlayRoot || !isRegionHandleHitDebugOn()) return;

        const splitHandles = container.querySelectorAll(
            '.audio-waveform-lane__playback-region__handle--split',
        );
        for (let s = 0; s < splitHandles.length; s++) {
            const handle = splitHandles[s];
            if (!handle || handle.hidden) continue;
            const regionEl = handle.closest('.audio-waveform-lane__playback-region');
            const regionRect = regionEl
                ? regionEl.getBoundingClientRect()
                : handle.getBoundingClientRect();
            const handleRect = handle.getBoundingClientRect();
            placeRegionHitDebugEl(
                createRegionHitDebugEl('--split', { label: 'split' }),
                overlayRoot,
                {
                    left: handleRect.left - REGION_HIT_DEBUG_EDGE_PAD_PX,
                    top: regionRect.top,
                    width: handleRect.width + REGION_HIT_DEBUG_EDGE_PAD_PX * 2,
                    height: regionRect.height,
                },
            );
        }

        if (typeof collectTrackCrossfadeZones !== 'function') return;
        const zones = collectTrackCrossfadeZones(track);
        const overlayRect = overlayRoot.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (
            !(master > 0) ||
            !(overlayRect.width > 0) ||
            !(containerRect.width > 0) ||
            !(containerRect.height > 0)
        ) {
            return;
        }
        for (let z = 0; z < zones.length; z++) {
            const zone = zones[z];
            const leftPct =
                typeof transportSecToTimelineLeftPercent === 'function'
                    ? transportSecToTimelineLeftPercent(zone.startSec)
                    : (zone.startSec / master) * 100;
            const rightPct =
                typeof transportSecToTimelineLeftPercent === 'function'
                    ? transportSecToTimelineLeftPercent(zone.endSec)
                    : (zone.endSec / master) * 100;
            const x0 = overlayRect.left + (leftPct / 100) * overlayRect.width;
            const x1 = overlayRect.left + (rightPct / 100) * overlayRect.width;
            if (x1 <= x0 + 0.25) continue;
            placeRegionHitDebugEl(
                createRegionHitDebugEl('--crossfade', { label: 'x-fade' }),
                overlayRoot,
                {
                    left: x0,
                    top: containerRect.top,
                    width: x1 - x0,
                    height: containerRect.height,
                },
            );
        }
    }

    function syncRehearsalBoundaryHitDebug() {
        const root = document.querySelector('.audio-waveform-composite__rehearsal-boundaries');
        if (!root) return;
        root.classList.toggle(
            'audio-waveform-composite__rehearsal-boundaries--hit-debug',
            isRegionHandleHitDebugOn(),
        );
    }

    function syncRegionHitDebugLanesPresentation() {
        ensureRegionHitDebugOverlayRoot();
        if (typeof syncRehearsalBoundaryDeferToRegionHandles === 'function') {
            syncRehearsalBoundaryDeferToRegionHandles(isRegionHandleHitDebugOn());
        }
    }

    function refreshTrackRegionHandleHitDebug(track, container, overlayRoot) {
        if (!container) return;
        const debugOn = isRegionHandleHitDebugOn();
        container.classList.toggle('audio-waveform-lane__playback-regions--hit-debug', debugOn);
        container.classList.toggle(
            'audio-waveform-lane__playback-regions--fade-hit-debug',
            debugOn,
        );
        if (!debugOn || !overlayRoot) return;
        const regionEls = container.querySelectorAll(
            '.audio-waveform-lane__playback-region',
        );
        for (let i = 0; i < regionEls.length; i++) {
            syncRegionHitDebugOverlays(regionEls[i], overlayRoot);
        }
        syncContainerRegionHitDebugOverlays(track, container, overlayRoot);
    }

    function placeClientRectHitDebug(overlayRoot, kindClass, targetEl) {
        if (!targetEl || !overlayRoot) return;
        const r = targetEl.getBoundingClientRect();
        if (!(r.width > 0) || !(r.height > 0)) return;
        placeRegionHitDebugEl(createRegionHitDebugEl(kindClass), overlayRoot, {
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
        });
    }

    function syncMusicalTrackHitDebugOverlays(overlayRoot) {
        if (!overlayRoot || !isRegionHandleHitDebugOn()) return;

        const rehearsalSegments = document.getElementById('musicalRehearsalSegments');
        if (rehearsalSegments) {
            const segEls = rehearsalSegments.querySelectorAll(
                '.musical-track-lane__segment--rehearsal',
            );
            for (let i = 0; i < segEls.length; i++) {
                const seg = segEls[i];
                placeClientRectHitDebug(overlayRoot, '--rehearsal-segment', seg);
                const frame = seg.querySelector(
                    '.musical-track-lane__segment-value--rehearsal-mark',
                );
                const text = seg.querySelector('.rehearsal-mark__text');
                if (frame) {
                    placeClientRectHitDebug(overlayRoot, '--rehearsal-frame', frame);
                }
                if (text) {
                    placeClientRectHitDebug(overlayRoot, '--rehearsal-edit', text);
                }
            }
        }
        const rehearsalTrack = document.getElementById('musicalRehearsalTrack');
        if (rehearsalTrack) {
            placeClientRectHitDebug(overlayRoot, '--musical-track-add', rehearsalTrack);
        }

        const tempoSegments = document.getElementById('musicalTempoSegments');
        if (tempoSegments) {
            const dragEls = tempoSegments.querySelectorAll(
                '.musical-track-lane__segment-value--draggable',
            );
            for (let i = 0; i < dragEls.length; i++) {
                placeClientRectHitDebug(overlayRoot, '--tempo-drag', dragEls[i]);
            }
            const segEls = tempoSegments.querySelectorAll('.musical-track-lane__segment--tempo');
            for (let i = 0; i < segEls.length; i++) {
                placeClientRectHitDebug(overlayRoot, '--tempo-segment', segEls[i]);
            }
        }
        const tempoTrack = document.getElementById('musicalTempoTrack');
        if (tempoTrack) {
            placeClientRectHitDebug(overlayRoot, '--musical-track-add', tempoTrack);
        }

        const signatureSegments = document.getElementById('musicalSignatureSegments');
        if (signatureSegments) {
            const dragEls = signatureSegments.querySelectorAll(
                '.musical-track-lane__segment-value--draggable',
            );
            for (let i = 0; i < dragEls.length; i++) {
                placeClientRectHitDebug(overlayRoot, '--signature-drag', dragEls[i]);
            }
            const segEls = signatureSegments.querySelectorAll(
                '.musical-track-lane__segment--signature',
            );
            for (let i = 0; i < segEls.length; i++) {
                placeClientRectHitDebug(overlayRoot, '--signature-segment', segEls[i]);
            }
        }
        const signatureTrack = document.getElementById('musicalSignatureTrack');
        if (signatureTrack) {
            placeClientRectHitDebug(overlayRoot, '--musical-track-add', signatureTrack);
        }
    }

    function syncMusicalTrackHitDebugLanePresentation() {
        const on = isRegionHandleHitDebugOn();
        const laneIds = [
            'musicalRehearsalLane',
            'musicalTempoLane',
            'musicalSignatureLane',
        ];
        for (let i = 0; i < laneIds.length; i++) {
            const lane = document.getElementById(laneIds[i]);
            if (!lane) continue;
            lane.classList.toggle('audio-waveform-lane--musical-hit-debug', on);
        }
    }

    function refreshAllRegionHandleHitDebug() {
        syncRegionHitDebugLanesPresentation();
        syncMusicalTrackHitDebugLanePresentation();
        clearAllRegionHitDebugEls();
        const overlayRoot = ensureRegionHitDebugOverlayRoot();
        if (!overlayRoot) {
            syncRehearsalBoundaryHitDebug();
            return;
        }
        const n =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            const container = getPlaybackRegionsContainerEl(track);
            if (!container) continue;
            refreshTrackRegionHandleHitDebug(track, container, overlayRoot);
        }
        syncMusicalTrackHitDebugOverlays(overlayRoot);
        syncRehearsalBoundaryHitDebug();
    }

    let regionHitDebugRefreshRaf = 0;
    function scheduleWaveformRegionOverlayRefresh() {
        if (regionHitDebugRefreshRaf) cancelAnimationFrame(regionHitDebugRefreshRaf);
        regionHitDebugRefreshRaf = requestAnimationFrame(() => {
            regionHitDebugRefreshRaf = 0;
            refreshAllRegionHandleHitDebug();
        });
    }
    window.scheduleWaveformRegionOverlayRefresh = scheduleWaveformRegionOverlayRefresh;

    (function bindRegionHitDebugScrollRefresh() {
        const lanes =
            typeof audioWaveformLanesTracks !== 'undefined' && audioWaveformLanesTracks
                ? audioWaveformLanesTracks
                : document.getElementById('audioWaveformLanesTracks');
        if (!lanes || lanes.dataset.regionHitDebugScrollBound === '1') return;
        lanes.dataset.regionHitDebugScrollBound = '1';
        lanes.addEventListener(
            'scroll',
            () => {
                if (isRegionHandleHitDebugOn()) scheduleWaveformRegionOverlayRefresh();
            },
            { passive: true },
        );
    })();

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
        const offsetDragActive = isOffsetDragRegionWaveformPreviewActive();
        const offsetDragSegmentIndices =
            typeof collectOffsetDragSegmentIndicesForTrack === 'function'
                ? collectOffsetDragSegmentIndicesForTrack(track)
                : null;
        for (let i = 0; i < segments.length; i++) {
            positionRegionOverlayEl(regionEls[i], track, i, segments[i]);
            regionEls[i].classList.toggle(
                'audio-waveform-lane__playback-region--offset-drag',
                !!(offsetDragSegmentIndices && offsetDragSegmentIndices.has(i)),
            );
        }
        const splitHandles = container.querySelectorAll(
            '.audio-waveform-lane__playback-region__handle--split',
        );
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
            if (
                offsetDragActive &&
                (!offsetDragSegmentIndices ||
                    typeof isSplitBoundaryAdjacentToOffsetDragSegments !== 'function' ||
                    !isSplitBoundaryAdjacentToOffsetDragSegments(b, offsetDragSegmentIndices))
            ) {
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
        refreshTrackFadeTriangleVisibility(track, container);
        scheduleWaveformRegionOverlayRefresh();
        if (isVideoTrackRef(track) && typeof refreshVideoAudioLaneRegionOverlayGeometry === 'function') {
            refreshVideoAudioLaneRegionOverlayGeometry(track);
        }
        if (isVideoTrackRef(track) && typeof drawAudioWaveformCanvas === 'function') {
            drawAudioWaveformCanvas();
        }
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
        const diagSilent = { silent: true };
        const diagRun =
            typeof window.regionRestoreDiagRunStep === 'function'
                ? function (label, fn, detail, opt) {
                      return window.regionRestoreDiagRunStep(label, fn, detail, opt);
                  }
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
            diagSilent,
        );
        const container = diagRun(
            'overlay/getContainer',
            () => getPlaybackRegionsContainerEl(track),
            diagEx,
            diagSilent,
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
        diagRun('overlay/clearDom', () => container.replaceChildren(), diagEx, diagSilent);
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
            diagSilent,
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
                diagSilent,
            );
        }
        if (!segments.length) {
            container.hidden = true;
            syncExtraLaneRegionsClassForTrack(track);
            syncTrackRehearsalRehearsalMarks(track);
            diagLog('overlay/empty-hidden', diagEx);
            return;
        }
        container.hidden = false;
        let labelSlots = null;
        if (
            !lightweight &&
            isMusicalGridRehearsalFillVisibleSafe() &&
            typeof window.getTrackTimelineSlots === 'function'
        ) {
            labelSlots = diagRun(
                'overlay/getTimelineSlots',
                () => window.getTrackTimelineSlots(track, { writeCache: false }),
                diagEx,
                diagSilent,
            );
        }
        diagRun(
            'overlay/buildRegionEls',
            () => {
                for (let i = 0; i < segments.length; i++) {
                    const seg = segments[i];
                    const el = buildRegionOverlayEl(track, i, seg, labelSlots);
                    positionRegionOverlayEl(el, track, i, seg);
                    container.appendChild(el);
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
                diagSilent,
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
                diagSilent,
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
            diagSilent,
        );
        syncExtraLaneRegionsClassForTrack(track);
        syncRegionSelectionClasses();
        if (!lightweight) {
            diagRun(
                'overlay/fadeTriangles',
                () => {
                    refreshTrackFadeTriangleVisibility(track, container);
                },
                diagEx,
                diagSilent,
            );
        }
        scheduleWaveformRegionOverlayRefresh();
        if (isVideoTrackRef(track) && typeof refreshVideoVizRegionThumbnails === 'function') {
            refreshVideoVizRegionThumbnails();
        }
        if (isVideoTrackRef(track) && typeof syncVideoAudioLaneRegionOverlays === 'function') {
            syncVideoAudioLaneRegionOverlays(track);
        }
        if (isVideoTrackRef(track) && typeof drawAudioWaveformCanvas === 'function') {
            drawAudioWaveformCanvas();
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
            typeof getMusicalGridRehearsalFillVisible === 'function' &&
            getMusicalGridRehearsalFillVisible() &&
            isTrackRegionActive(track) &&
            typeof scheduleMusicalGridRedraw === 'function'
        ) {
            scheduleMusicalGridRedraw();
        }
        if (!lightweight) {
            diagRun(
                'overlay/rehearsalMarks',
                () => syncTrackRehearsalRehearsalMarks(track),
                diagEx,
                diagSilent,
            );
        }
        diagLog('overlay/done', diagEx);
        } finally {
            trackRegionOverlayBuildDepth -= 1;
            if (trackRegionOverlayBuildDepth < 0) trackRegionOverlayBuildDepth = 0;
        }
    }

