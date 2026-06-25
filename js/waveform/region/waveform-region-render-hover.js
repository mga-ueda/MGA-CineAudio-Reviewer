/**
 * waveform-region-render-hover.js — ポインタ hover・カーソル・要素検出
 */
    function getWaveformLanesEl() {
        if (typeof waveformScrubTargetEl === 'function') {
            return waveformScrubTargetEl();
        }
        return document.getElementById('audioWaveformLanesTracks');
    }

    function extraLaneSlotFromClientY(clientY) {
        if (!Number.isFinite(clientY)) return -1;
        const lanes = getWaveformLanesEl();
        if (!lanes) return -1;
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

    function transportSecAtClientX(clientX) {
        if (!Number.isFinite(clientX)) return null;
        if (typeof transportSecFromClientX === 'function') {
            return transportSecFromClientX(clientX);
        }
        if (typeof transportRatioFromClientX !== 'function') return null;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return null;
        return transportRatioFromClientX(clientX) * master;
    }

    function findSilentGapElAtPointer(clientX, clientY) {
        if (
            typeof resolveSilentGapSelectionAtPointer !== 'function' ||
            typeof getPlaybackRegionsContainerEl !== 'function'
        ) {
            return null;
        }
        const hit = resolveSilentGapSelectionAtPointer(clientX, clientY);
        if (!hit) return null;
        const track = { type: 'extra', slot: hit.slot };
        const container = getPlaybackRegionsContainerEl(track);
        if (!container || container.hidden) return null;
        const el = container.querySelector(
            '.audio-waveform-lane__playback-silent-gap[data-silent-gap-index="' +
                hit.gapIndex +
                '"]',
        );
        return el && !el.hidden ? el : null;
    }

    window.findSilentGapElAtPointer = findSilentGapElAtPointer;

    function regionTimelineIntervalAtPointer(track, segmentIndex) {
        return typeof regionOffsetDragTimelineInterval === 'function'
            ? regionOffsetDragTimelineInterval(track, segmentIndex)
            : getSegmentRegionOverlayTimelineInterval(track, segmentIndex);
    }

    function playbackRegionElAtTransportSec(track, container, transportSec, clientX, clientY) {
        if (!container || container.hidden || !Number.isFinite(transportSec)) return null;

        if (typeof collectTrackSilentGaps === 'function') {
            const gapIndex =
                typeof resolveSilentGapListIndexAtTransport === 'function'
                    ? resolveSilentGapListIndexAtTransport(track, transportSec)
                    : -1;
            if (gapIndex >= 0) {
                return null;
            }
        }

        if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
            const hit = document.elementFromPoint(clientX, clientY);
            if (hit) {
                const fromHit = hit.closest('.audio-waveform-lane__playback-region');
                if (fromHit) {
                    const segmentIndex = Number(fromHit.dataset.segmentIndex);
                    if (Number.isFinite(segmentIndex) && segmentIndex >= 0) {
                        const interval = regionTimelineIntervalAtPointer(track, segmentIndex);
                        if (
                            transportSec >= interval.startSec - 0.0005 &&
                            transportSec < interval.endSec - 0.002
                        ) {
                            if (isVideoTrackRef(track)) {
                                return fromHit;
                            }
                            const hitLane = fromHit.closest('.audio-waveform-lane--extra');
                            const m =
                                hitLane && hitLane.id
                                    ? /^extraAudioLane(\d+)$/.exec(hitLane.id)
                                    : null;
                            if (fromHit && m && parseInt(m[1], 10) === track.slot) {
                                return fromHit;
                            }
                        }
                    }
                }
            }
        }

        const segments = getTrackSegments(track);
        for (let i = 0; i < segments.length; i++) {
            const interval = regionTimelineIntervalAtPointer(track, i);
            if (
                transportSec < interval.startSec - 0.0005 ||
                transportSec >= interval.endSec - 0.002
            ) {
                continue;
            }
            const el = container.querySelector(
                '.audio-waveform-lane__playback-region[data-segment-index="' + i + '"]',
            );
            if (el && !el.hidden) return el;
        }
        return null;
    }

    function findPlaybackRegionElAtPointer(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;

        if (
            typeof isPointerOverVideoVizLane === 'function' &&
            isPointerOverVideoVizLane(clientY)
        ) {
            const lane = videoVizLane;
            if (lane && !lane.hidden) {
                const laneRect = lane.getBoundingClientRect();
                if (
                    clientX >= laneRect.left &&
                    clientX <= laneRect.right &&
                    clientY >= laneRect.top &&
                    clientY <= laneRect.bottom
                ) {
                    const track = getVideoTrackRef();
                    const container = getPlaybackRegionsContainerEl(track);
                    if (container && !container.hidden) {
                        const transportSec = transportSecAtClientX(clientX);
                        const hit = playbackRegionElAtTransportSec(
                            track,
                            container,
                            transportSec,
                            clientX,
                            clientY,
                        );
                        if (hit) return hit;
                    }
                }
            }
        }

        if (
            typeof isPointerOverVideoAudioLane === 'function' &&
            isPointerOverVideoAudioLane(clientY)
        ) {
            const lane =
                typeof audioWaveformLaneVideo !== 'undefined' ? audioWaveformLaneVideo : null;
            if (lane && !lane.hidden) {
                const laneRect = lane.getBoundingClientRect();
                if (
                    clientX >= laneRect.left &&
                    clientX <= laneRect.right &&
                    clientY >= laneRect.top &&
                    clientY <= laneRect.bottom
                ) {
                    const track = getVideoTrackRef();
                    const container =
                        typeof getVideoAudioPlaybackRegionsContainerEl === 'function'
                            ? getVideoAudioPlaybackRegionsContainerEl()
                            : null;
                    if (container && !container.hidden) {
                        const transportSec = transportSecAtClientX(clientX);
                        const hit = playbackRegionElAtTransportSec(
                            track,
                            container,
                            transportSec,
                            clientX,
                            clientY,
                        );
                        if (hit) return hit;
                    }
                }
            }
        }

        const slot = extraLaneSlotFromClientY(clientY);
        if (slot < 0) return null;

        const lane = document.getElementById('extraAudioLane' + slot);
        if (!lane || lane.hidden) return null;
        const laneRect = lane.getBoundingClientRect();
        if (
            clientX < laneRect.left ||
            clientX > laneRect.right ||
            clientY < laneRect.top ||
            clientY > laneRect.bottom
        ) {
            return null;
        }

        const track = { type: 'extra', slot };
        const container = getPlaybackRegionsContainerEl(track);
        if (!container || container.hidden) return null;

        const transportSec = transportSecAtClientX(clientX);
        return playbackRegionElAtTransportSec(track, container, transportSec, clientX, clientY);
    }

    const regionCursorOverlayEl =
        typeof audioWaveformLanesInner !== 'undefined' && audioWaveformLanesInner
            ? (() => {
                  const el = document.createElement('div');
                  el.className = 'audio-waveform-composite__region-cursor';
                  el.hidden = true;
                  el.setAttribute('aria-hidden', 'true');
                  audioWaveformLanesInner.appendChild(el);
                  return el;
              })()
            : null;

    function hideRegionCursorOverlay() {
        if (regionCursorOverlayEl) regionCursorOverlayEl.hidden = true;
    }

    function showRegionCursorOverlayAtTransportSec(sec, regionEl) {
        if (!regionCursorOverlayEl || !Number.isFinite(sec)) return;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) {
            hideRegionCursorOverlay();
            return;
        }
        const pct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(sec)
                : (sec / master) * 100;
        regionCursorOverlayEl.style.left = pct + '%';
        const inner =
            typeof audioWaveformLanesInner !== 'undefined' ? audioWaveformLanesInner : null;
        if (inner && regionEl) {
            const innerRect = inner.getBoundingClientRect();
            const regionRect = regionEl.getBoundingClientRect();
            regionCursorOverlayEl.style.top = regionRect.top - innerRect.top + 'px';
            regionCursorOverlayEl.style.height = regionRect.height + 'px';
            regionCursorOverlayEl.style.bottom = 'auto';
        }
        regionCursorOverlayEl.hidden = false;
    }

    function hideRegionCursorLine(regionEl) {
        void regionEl;
        hideRegionCursorOverlay();
    }

    function updateRegionCursorLine(regionEl, clientX, clientY) {
        const lanes = getWaveformLanesEl();
        if (
            lanes &&
            (lanes.classList.contains('audio-waveform-composite__lanes--scrubbing') ||
                lanes.classList.contains('audio-waveform-composite__lanes--offset-drag') ||
                lanes.classList.contains('audio-waveform-composite__lanes--region-drag') ||
                regionHandleDragActive)
        ) {
            hideRegionCursorOverlay();
            return;
        }
        if (!regionEl) {
            hideRegionCursorOverlay();
            return;
        }
        const r = regionEl.getBoundingClientRect();
        if (
            !Number.isFinite(clientX) ||
            !Number.isFinite(clientY) ||
            clientX < r.left ||
            clientX > r.right ||
            clientY < r.top ||
            clientY > r.bottom
        ) {
            hideRegionCursorOverlay();
            return;
        }
        const lane = regionEl.closest('.audio-waveform-lane--extra');
        const laneMatch = lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
        const slot = laneMatch ? parseInt(laneMatch[1], 10) : -1;
        const segmentIndex = Number(regionEl.dataset && regionEl.dataset.segmentIndex);

        // Pre-resolve this region's effective in/out transport range.
        // (We snap to these boundaries for region-only snapping.)
        const track =
            slot >= 0 ? { type: 'extra', slot: slot } : null;
        const thresholdSec = regionSnapThresholdSec();
        let inTransport = null;
        let outTransport = null;
        if (
            track &&
            typeof getTrackTimelineStartSec === 'function' &&
            typeof getSegmentRegionTimelineIn === 'function' &&
            typeof getSegmentTimelineEnd === 'function' &&
            Number.isFinite(segmentIndex)
        ) {
            const trackStart = getTrackTimelineStartSec(track);
            inTransport = Math.max(
                trackStart,
                getSegmentRegionTimelineIn(track, segmentIndex),
            );
            outTransport = getSegmentTimelineEnd(track, segmentIndex);
        }

        const altSuppressed =
            typeof isSnapSuppressedByAlt === 'function' ? isSnapSuppressedByAlt() : false;
        let tRaw = transportSecAtClientX(clientX);
        let snappedTransportSec = tRaw;
        if (
            slot >= 0 &&
            Number.isFinite(segmentIndex) &&
            typeof getTrackTimelineStartSec === 'function' &&
            typeof getSegmentRegionTimelineIn === 'function' &&
            typeof getSegmentTimelineEnd === 'function' &&
            Number.isFinite(snappedTransportSec)
        ) {
            if (Number.isFinite(inTransport) && outTransport > inTransport + 1e-6) {
                const markersShownOnWaveform =
                    typeof audioWaveformMarkers !== 'undefined' &&
                    audioWaveformMarkers &&
                    !audioWaveformMarkers.hidden;

                if (markersShownOnWaveform) {
                    // マーカー表示時: マーカー In/Out のみにスナップ
                    if (
                        typeof snapSecToMarkerInOut === 'function' &&
                        Number.isFinite(tRaw)
                    ) {
                        snappedTransportSec = snapSecToMarkerInOut(tRaw, {
                            thresholdSec,
                            altKey: altSuppressed,
                        });
                    }
                } else {
                    // リージョン表示のみ: 実際のリージョン操作と同じ snapRegionTransportSec を使用
                    if (typeof snapRegionTransportSec === 'function' && Number.isFinite(tRaw)) {
                        snappedTransportSec = snapRegionTransportSec(tRaw, {
                            sameSlotOnly: -1,
                            altKey: altSuppressed,
                        });
                    }
                }

            }
        }
        if (Number.isFinite(snappedTransportSec)) {
            showRegionCursorOverlayAtTransportSec(snappedTransportSec, regionEl);
        } else {
            hideRegionCursorOverlay();
        }
    }

    function regionGroupMembersForOverlayEl(regionEl) {
        if (!regionEl) return [];
        const lane = regionEl.closest('.audio-waveform-lane--extra');
        const m = lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
        if (!m) return [];
        const slot = parseInt(m[1], 10);
        const segmentIndex = Number(regionEl.dataset.segmentIndex);
        if (!Number.isFinite(segmentIndex) || segmentIndex < 0) return [];
        const track = { type: 'extra', slot };
        if (!getSegmentRegionGroupId(track, segmentIndex)) {
            return [{ slot, segmentIndex }];
        }
        return collectRegionGroupMembers(track, segmentIndex);
    }

    function slotAndSegmentIndexFromRegionOverlayEl(regionEl) {
        const lane = regionEl && regionEl.closest('.audio-waveform-lane--extra');
        const m = lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
        if (!m) return null;
        const segmentIndex = Number(regionEl.dataset.segmentIndex);
        if (!Number.isFinite(segmentIndex) || segmentIndex < 0) return null;
        return { slot: parseInt(m[1], 10), segmentIndex };
    }

    const REGION_GROUP_FLASH_CLASS =
        'audio-waveform-lane__playback-region--group-flash';
    const REGION_GROUP_UNGROUP_FLASH_CLASS =
        'audio-waveform-lane__playback-region--group-ungroup-flash';
    const REGION_FLASH_OUTLINE_CLASS =
        'audio-waveform-lane__playback-region__flash-outline';
    const REGION_FLASH_OUTLINE_YELLOW =
        'audio-waveform-lane__playback-region__flash-outline--yellow';
    const REGION_FLASH_OUTLINE_CYAN =
        'audio-waveform-lane__playback-region__flash-outline--cyan';
    const REGION_GROUP_FLASH_MS = 700;

    function removeRegionFlashOutlines(regionEl) {
        if (!regionEl) return;
        const existing = regionEl.querySelectorAll('.' + REGION_FLASH_OUTLINE_CLASS);
        for (let i = 0; i < existing.length; i++) {
            existing[i].remove();
        }
    }

    function createRegionFlashOutline(regionEl, edges, kind) {
        removeRegionFlashOutlines(regionEl);
        const outline = document.createElement('div');
        outline.className =
            REGION_FLASH_OUTLINE_CLASS +
            ' ' +
            (kind === 'ungroup' ? REGION_FLASH_OUTLINE_CYAN : REGION_FLASH_OUTLINE_YELLOW);
        outline.setAttribute('aria-hidden', 'true');
        applyRegionGroupEdgeClasses(outline, edges);
        const buildAnim =
            kind === 'ungroup'
                ? buildRegionGroupUnglowAnimation
                : buildRegionGroupFlashAnimation;
        const anim = buildAnim(edges);
        if (anim) {
            outline.style.animation = anim;
        }
        regionEl.appendChild(outline);
        return outline;
    }

    function buildRegionGroupGlowAnimation(edges, prefix) {
        const parts = [];
        if (edges && edges.top) {
            parts.push(prefix + 'Top ' + REGION_GROUP_FLASH_MS + 'ms ease-in-out 1');
        }
        if (edges && edges.bottom) {
            parts.push(prefix + 'Bottom ' + REGION_GROUP_FLASH_MS + 'ms ease-in-out 1');
        }
        if (edges && edges.left) {
            parts.push(prefix + 'Left ' + REGION_GROUP_FLASH_MS + 'ms ease-in-out 1');
        }
        if (edges && edges.right) {
            parts.push(prefix + 'Right ' + REGION_GROUP_FLASH_MS + 'ms ease-in-out 1');
        }
        parts.push(
            (prefix === 'regionGroupUnglowPulse'
                ? 'regionGroupUnglowPulseHalo'
                : 'regionGroupGlowPulseHalo') +
                ' ' +
                REGION_GROUP_FLASH_MS +
                'ms ease-in-out 1',
        );
        return parts.join(', ');
    }

    function buildRegionGroupFlashAnimation(edges) {
        return buildRegionGroupGlowAnimation(edges, 'regionGroupGlowPulse');
    }

    function buildRegionGroupUnglowAnimation(edges) {
        return buildRegionGroupGlowAnimation(edges, 'regionGroupUnglowPulse');
    }

    function applyGroupedRegionHoverEdgeClasses() {
        if (!hoveredPlaybackRegionEl || !hoveredPlaybackRegionEls.length) return;
        const members = regionGroupMembersForOverlayEl(hoveredPlaybackRegionEl);
        const edgeMap = computeRegionGroupOuterEdges(members);
        for (let i = 0; i < hoveredPlaybackRegionEls.length; i++) {
            const rel = hoveredPlaybackRegionEls[i];
            if (!rel.classList.contains('audio-waveform-lane__playback-region--grouped')) {
                continue;
            }
            const ref = slotAndSegmentIndexFromRegionOverlayEl(rel);
            if (!ref) continue;
            applyRegionGroupEdgeClasses(
                rel,
                edgeMap.get(regionGroupMemberKey(ref.slot, ref.segmentIndex)),
            );
        }
    }

    /** グループ化/解除完了時: 外周 □ のみ発光（kind: 'group' 黄 / 'ungroup' 水色） */
    function flashRegionGroupMembers(members, opt) {
        if (!members || !members.length) return;
        const kind = opt && opt.kind === 'ungroup' ? 'ungroup' : 'group';
        const flashClass =
            kind === 'ungroup'
                ? REGION_GROUP_UNGROUP_FLASH_CLASS
                : REGION_GROUP_FLASH_CLASS;
        const edgeMap = computeRegionGroupOuterEdges(members);
        const flashed = [];
        for (let i = 0; i < members.length; i++) {
            const m = members[i];
            const el = getPlaybackRegionOverlayEl(m.slot, m.segmentIndex);
            if (!el) continue;
            const edges = edgeMap.get(regionGroupMemberKey(m.slot, m.segmentIndex));
            el.classList.remove(REGION_GROUP_FLASH_CLASS, REGION_GROUP_UNGROUP_FLASH_CLASS);
            removeRegionFlashOutlines(el);
            clearRegionGroupEdgeClasses(el);
            el.classList.add(flashClass);
            const outline = createRegionFlashOutline(el, edges, kind);
            flashed.push({ el, outline });
        }
        if (!flashed.length) return;
        setTimeout(() => {
            for (let i = 0; i < flashed.length; i++) {
                const item = flashed[i];
                item.outline.remove();
                item.el.classList.remove(
                    REGION_GROUP_FLASH_CLASS,
                    REGION_GROUP_UNGROUP_FLASH_CLASS,
                );
            }
            applyGroupedRegionHoverEdgeClasses();
        }, REGION_GROUP_FLASH_MS);
    }

    function collectRegionGroupHoverElements(regionEl) {
        if (!regionEl) return [];
        const lane = regionEl.closest('.audio-waveform-lane--extra');
        const m = lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
        if (!m) return [regionEl];
        const slot = parseInt(m[1], 10);
        const segmentIndex = Number(regionEl.dataset.segmentIndex);
        if (!Number.isFinite(segmentIndex) || segmentIndex < 0) return [regionEl];
        const track = { type: 'extra', slot };
        const gid = getSegmentRegionGroupId(track, segmentIndex);
        if (!gid) return [regionEl];
        const members = collectRegionGroupMembers(track, segmentIndex);
        const out = [];
        for (let i = 0; i < members.length; i++) {
            const mem = members[i];
            const el = getPlaybackRegionOverlayEl(mem.slot, mem.segmentIndex);
            if (el && !el.hidden) out.push(el);
        }
        return out.length ? out : [regionEl];
    }

    function clearHoveredPlaybackRegionHighlight() {
        for (let i = 0; i < hoveredPlaybackRegionEls.length; i++) {
            const el = hoveredPlaybackRegionEls[i];
            el.classList.remove('audio-waveform-lane__playback-region--hover');
            // 選択中のグループは --group-edge-* が水色枠に必要（ホバー解除で消さない）
            if (!el.classList.contains('audio-waveform-lane__playback-region--selected')) {
                clearRegionGroupEdgeClasses(el);
            }
        }
        hoveredPlaybackRegionEls.length = 0;
    }

    function setHoveredPlaybackRegion(el) {
        if (hoveredPlaybackRegionEl === el) return;
        if (hoveredPlaybackRegionEl) {
            hideRegionCursorLine(hoveredPlaybackRegionEl);
        }
        clearHoveredPlaybackRegionHighlight();
        hoveredPlaybackRegionEl = el || null;
        if (!hoveredPlaybackRegionEl) return;
        hoveredPlaybackRegionEls = collectRegionGroupHoverElements(hoveredPlaybackRegionEl);
        for (let i = 0; i < hoveredPlaybackRegionEls.length; i++) {
            hoveredPlaybackRegionEls[i].classList.add(
                'audio-waveform-lane__playback-region--hover',
            );
        }
        applyGroupedRegionHoverEdgeClasses();
    }

    const REGION_HANDLE_HOVER_CURSOR_CLASS =
        'audio-waveform-composite__lanes--region-handle-hover';

    function pointInClientRect(clientX, clientY, rect) {
        if (!rect || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        return (
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom
        );
    }

    /** ↔ カーソル判定矩形 */
    function collectRegionEwCursorHitRectsInContainer(container, laneForSplit) {
        if (!container || container.hidden) return [];
        const pad =
            typeof REGION_HANDLE_HIT_PAD_PX === 'number' ? REGION_HANDLE_HIT_PAD_PX : 4;
        const out = [];
        const regions = container.querySelectorAll('.audio-waveform-lane__playback-region');
        for (let r = 0; r < regions.length; r++) {
            const regionEl = regions[r];
            const regionRect = regionEl.getBoundingClientRect();

            if (typeof getFadeHandleHitRect === 'function') {
                for (let f = 0; f < 2; f++) {
                    const edgeKind = f === 0 ? 'in' : 'out';
                    const hitRect = getFadeHandleHitRect(regionEl, edgeKind);
                    if (!hitRect) continue;
                    out.push({
                        regionEl,
                        rect: hitRect,
                        kind: 'fade-' + edgeKind,
                    });
                }
            }

            for (let e = 0; e < 2; e++) {
                const edgeKind = e === 0 ? 'in' : 'out';
                const sel =
                    edgeKind === 'in'
                        ? '.audio-waveform-lane__playback-region__handle--in'
                        : '.audio-waveform-lane__playback-region__handle--out';
                const handleEl = regionEl.querySelector(sel);
                if (!handleEl) continue;
                const handleRect = handleEl.getBoundingClientRect();
                out.push({
                    regionEl,
                    rect: {
                        left: handleRect.left - pad,
                        top: regionRect.top,
                        right: handleRect.right + pad,
                        bottom: regionRect.bottom,
                    },
                    kind: 'edge-' + edgeKind,
                });
            }
        }
        const splitHandles = container.querySelectorAll(
            '.audio-waveform-lane__playback-region__handle--split',
        );
        const laneRect = laneForSplit ? laneForSplit.getBoundingClientRect() : null;
        for (let s = 0; s < splitHandles.length; s++) {
            const handleEl = splitHandles[s];
            if (!handleEl || handleEl.hidden) continue;
            const handleRect = handleEl.getBoundingClientRect();
            if (!(handleRect.width > 0) && !(handleRect.height > 0)) continue;
            const regionEl = handleEl.closest('.audio-waveform-lane__playback-region');
            const top = regionEl
                ? regionEl.getBoundingClientRect().top
                : laneRect
                  ? laneRect.top
                  : handleRect.top;
            const bottom = regionEl
                ? regionEl.getBoundingClientRect().bottom
                : laneRect
                  ? laneRect.bottom
                  : handleRect.bottom;
            out.push({
                regionEl: regionEl || handleEl,
                rect: {
                    left: handleRect.left - pad,
                    top,
                    right: handleRect.right + pad,
                    bottom,
                },
                kind: 'edge-split',
            });
        }
        return out;
    }

    function collectRegionEwCursorHitRectsForTrack(track) {
        if (isVideoTrackRef(track)) {
            const contexts =
                typeof collectVideoPlaybackRegionLaneContexts === 'function'
                    ? collectVideoPlaybackRegionLaneContexts()
                    : [];
            let out = [];
            for (let i = 0; i < contexts.length; i++) {
                out = out.concat(
                    collectRegionEwCursorHitRectsInContainer(
                        contexts[i].container,
                        contexts[i].lane,
                    ),
                );
            }
            return out;
        }
        const container = getPlaybackRegionsContainerEl(track);
        const lane = document.getElementById('extraAudioLane' + track.slot);
        return collectRegionEwCursorHitRectsInContainer(container, lane);
    }

    function collectRegionEwCursorHitRectsAtPointer(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return [];
        const out = [];
        const n = getExtraTrackCount();
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            const lane = document.getElementById('extraAudioLane' + track.slot);
            if (!lane || lane.hidden) continue;
            const laneRect = lane.getBoundingClientRect();
            if (
                clientY < laneRect.top ||
                clientY > laneRect.bottom ||
                clientX < laneRect.left ||
                clientX > laneRect.right
            ) {
                continue;
            }
            const hits = collectRegionEwCursorHitRectsForTrack(track);
            for (let i = 0; i < hits.length; i++) out.push(hits[i]);
        }
        if (typeof collectVideoPlaybackRegionLaneContexts === 'function') {
            const contexts = collectVideoPlaybackRegionLaneContexts();
            for (let vi = 0; vi < contexts.length; vi++) {
                const ctx = contexts[vi];
                const laneRect = ctx.lane.getBoundingClientRect();
                if (
                    clientY < laneRect.top ||
                    clientY > laneRect.bottom ||
                    clientX < laneRect.left ||
                    clientX > laneRect.right
                ) {
                    continue;
                }
                const hits = collectRegionEwCursorHitRectsInContainer(
                    ctx.container,
                    ctx.lane,
                );
                for (let i = 0; i < hits.length; i++) out.push(hits[i]);
            }
        }
        return out;
    }

    function isPointerInRegionEwCursorHitZone(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        const hits = collectRegionEwCursorHitRectsAtPointer(clientX, clientY);
        for (let i = 0; i < hits.length; i++) {
            if (pointInClientRect(clientX, clientY, hits[i].rect)) return true;
        }
        return false;
    }

    /** In/Out・フェード用 EW ゾーン（スプリット境界は除く — リージョン平行移動と競合しない） */
    function isPointerInRegionEwCursorHitZoneExcludingSplit(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        const hits = collectRegionEwCursorHitRectsAtPointer(clientX, clientY);
        for (let i = 0; i < hits.length; i++) {
            if (hits[i].kind === 'edge-split') continue;
            if (pointInClientRect(clientX, clientY, hits[i].rect)) return true;
        }
        return false;
    }

    function clearRegionEwCursorPresentation() {
        const regions = document.querySelectorAll('.audio-waveform-lane__playback-region');
        for (let i = 0; i < regions.length; i++) {
            regions[i].classList.remove('audio-waveform-lane__playback-region--ew-cursor');
            regions[i].style.removeProperty('cursor');
        }
        if (typeof syncRehearsalBoundaryDeferToRegionHandles === 'function') {
            syncRehearsalBoundaryDeferToRegionHandles(false);
        }
    }

    function applyRegionEwCursorFromPointer(clientX, clientY) {
        clearRegionEwCursorPresentation();
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        let any = false;
        const hits = collectRegionEwCursorHitRectsAtPointer(clientX, clientY);
        for (let i = 0; i < hits.length; i++) {
            const item = hits[i];
            if (!pointInClientRect(clientX, clientY, item.rect)) continue;
            any = true;
            item.regionEl.classList.add('audio-waveform-lane__playback-region--ew-cursor');
            item.regionEl.style.cursor = 'ew-resize';
        }
        return any;
    }

    function updateRegionResizeHandleCursorFromPointer(clientX, clientY) {
        const lanes = getWaveformLanesEl();
        if (!lanes) return;
        const clear = () => {
            lanes.classList.remove(REGION_HANDLE_HOVER_CURSOR_CLASS);
            clearRegionEwCursorPresentation();
        };
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
            clear();
            return;
        }
        if (
            regionHandleDragActive ||
            lanes.classList.contains('audio-waveform-composite__lanes--offset-drag') ||
            lanes.classList.contains('audio-waveform-composite__lanes--region-drag')
        ) {
            clear();
            return;
        }
        const onHandle = applyRegionEwCursorFromPointer(clientX, clientY);
        if (typeof syncRehearsalBoundaryDeferToRegionHandles === 'function') {
            syncRehearsalBoundaryDeferToRegionHandles(onHandle);
        }
        lanes.classList.toggle(REGION_HANDLE_HOVER_CURSOR_CLASS, onHandle);
    }

    window.isPointerInRegionEwCursorHitZone = isPointerInRegionEwCursorHitZone;
    window.isPointerInRegionEwCursorHitZoneExcludingSplit =
        isPointerInRegionEwCursorHitZoneExcludingSplit;

    function updatePlaybackRegionHoverFromPointer(clientX, clientY) {
        updateRegionResizeHandleCursorFromPointer(clientX, clientY);
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
            setHoveredPlaybackRegion(null);
            lastRegionHoverClientX = null;
            lastRegionHoverClientY = null;
            return;
        }
        const region = findPlaybackRegionElAtPointer(clientX, clientY);
        setHoveredPlaybackRegion(region);
        lastRegionHoverClientX = clientX;
        lastRegionHoverClientY = clientY;
        if (region) {
            updateRegionCursorLine(region, clientX, clientY);
        }
    }

    function refreshPlaybackRegionHoverCursorLine() {
        if (!hoveredPlaybackRegionEl) return;
        if (!Number.isFinite(lastRegionHoverClientX) || !Number.isFinite(lastRegionHoverClientY)) return;
        updateRegionCursorLine(
            hoveredPlaybackRegionEl,
            lastRegionHoverClientX,
            lastRegionHoverClientY,
        );
    }

    window.refreshPlaybackRegionHoverCursorLine = refreshPlaybackRegionHoverCursorLine;

    /** ドラッグ中: DOM を作り直さず位置・フェード表示だけ更新（ハンドルが消えない） */
