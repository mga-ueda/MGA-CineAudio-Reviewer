/**
 * waveform-region-render-meta.js — リハーサル名・フェード三角表示
 */
    /** メタ表示の narrow 判定（リージョン幅 px） */
    const REGION_OVERLAY_NARROW_PX = 22;

    /** リージョンリハーサル名（0→A, 1→B … 26→AA）— phraseGroupLabelForIndex へ委譲 */
    function formatRegionRehearsalMarkLabel(markIndex) {
        if (typeof phraseGroupLabelForIndex === 'function') {
            return phraseGroupLabelForIndex(markIndex | 0);
        }
        return 'A';
    }

    function formatRehearsalMarkForPhraseSlot(phraseSlotIndex) {
        if (typeof rehearsalMarkLabelForPhraseSlotIndex === 'function') {
            return rehearsalMarkLabelForPhraseSlotIndex(phraseSlotIndex);
        }
        const phraseSlot = phraseSlotIndex | 0;
        if (phraseSlot < 0) return '_';
        const offset =
            typeof getRehearsalMarkOffsetEnabled === 'function'
                ? getRehearsalMarkOffsetEnabled()
                : false;
        const markIndex = phraseSlot - (offset ? 1 : 0);
        if (markIndex < 0) return '_';
        return formatRegionRehearsalMarkLabel(markIndex);
    }

    const REHEARSAL_MARKS_OVERLAY_ID = 'extraAudioRehearsalMarksOverlay';
    const REGION_META_OVERLAY_ID = 'extraAudioRegionMetaOverlay';

    function purgeStaleLaneRehearsalMarks(lane) {
        if (!lane || typeof lane.querySelectorAll !== 'function') return;
        const stale = lane.querySelectorAll(':scope > .audio-waveform-lane__rehearsal-marks');
        for (let i = 0; i < stale.length; i++) {
            if (stale[i].parentElement === lane) stale[i].remove();
        }
    }

    function visibleWaveformLaneCount() {
        let count = 0;
        const videoMeta =
            typeof audioWaveformPanel !== 'undefined' ? audioWaveformPanel : null;
        if (videoMeta && !videoMeta.hidden) count += 1;
        const n = typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        for (let slot = 0; slot < n; slot++) {
            const meta = document.getElementById('extraAudioMeta' + slot);
            if (meta && !meta.hidden) count += 1;
        }
        return Math.max(1, count);
    }

    function purgeLegacyRehearsalMarkContainers() {
        const n = typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        for (let slot = 0; slot < n; slot++) {
            const legacy = document.getElementById('extraAudioRehearsalMarks' + slot);
            if (legacy) legacy.remove();
            purgeStaleLaneRehearsalMarks(document.getElementById('extraAudioLane' + slot));
        }
    }

    function syncRehearsalMarksOverlayGridPlacement(overlayEl) {
        const inner =
            typeof audioWaveformLanesInner !== 'undefined' ? audioWaveformLanesInner : null;
        if (!inner || !overlayEl) return;
        if (typeof syncWaveformLanesViewportWidthCss === 'function') {
            syncWaveformLanesViewportWidthCss();
        }
        if (overlayEl.parentElement !== inner) {
            inner.appendChild(overlayEl);
        }
        const span = '1 / ' + (visibleWaveformLaneCount() + 1);
        overlayEl.style.gridRow = span;
        overlayEl.style.gridColumn = '1';
    }

    function getRehearsalMarksOverlayEl() {
        const inner =
            typeof audioWaveformLanesInner !== 'undefined' ? audioWaveformLanesInner : null;
        if (!inner) return null;
        let el = document.getElementById(REHEARSAL_MARKS_OVERLAY_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = REHEARSAL_MARKS_OVERLAY_ID;
            el.className =
                'audio-waveform-lane__rehearsal-marks audio-waveform-lane__rehearsal-marks--lanes-overlay';
            el.hidden = true;
            el.setAttribute('aria-hidden', 'true');
        }
        syncRehearsalMarksOverlayGridPlacement(el);
        return el;
    }

    function syncRegionMetaOverlayGridPlacement(overlayEl) {
        syncRehearsalMarksOverlayGridPlacement(overlayEl);
    }

    function getRegionMetaOverlayEl() {
        const inner =
            typeof audioWaveformLanesInner !== 'undefined' ? audioWaveformLanesInner : null;
        if (!inner) return null;
        let el = document.getElementById(REGION_META_OVERLAY_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = REGION_META_OVERLAY_ID;
            el.className = 'audio-waveform-lane__region-meta--lanes-overlay';
            el.hidden = true;
            el.setAttribute('aria-hidden', 'true');
        }
        syncRegionMetaOverlayGridPlacement(el);
        return el;
    }

    function positionRegionMetaSlotEl(el, track, segmentIndex) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!el || !(master > 0)) return;
        const trackStart =
            typeof getTrackTimelineStartSec === 'function'
                ? getTrackTimelineStartSec(track)
                : 0;
        const inTransport = Math.max(
            trackStart,
            getSegmentRegionTimelineIn(track, segmentIndex),
        );
        const outTransport = getSegmentTimelineEnd(track, segmentIndex);
        const leftPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(inTransport)
                : (inTransport / master) * 100;
        const rightPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(outTransport)
                : (outTransport / master) * 100;
        const widthPct = Math.max(0.05, rightPct - leftPct);
        el.style.left = leftPct + '%';
        el.style.width = widthPct + '%';
        el.classList.toggle(
            'audio-waveform-lane__region-meta-slot--narrow',
            widthPct > 0 &&
                regionOverlayWidthPxFromPct(
                    widthPct,
                    getRegionOverlayTimelineMetrics()?.scrubW,
                ) < REGION_OVERLAY_NARROW_PX,
        );
    }

    function buildRegionMetaSlotEl(track, segmentIndex) {
        const pitchText =
            typeof formatRegionPitchDisplay === 'function'
                ? formatRegionPitchDisplay(getSegmentPitchSemitones(track, segmentIndex))
                : '';
        const gainText =
            typeof formatRegionGainDbDisplay === 'function'
                ? formatRegionGainDbDisplay(getSegmentGainDb(track, segmentIndex))
                : '';
        if (!pitchText && !gainText) return null;

        const slotEl = document.createElement('div');
        slotEl.className = 'audio-waveform-lane__region-meta-slot';
        slotEl.dataset.segmentIndex = String(segmentIndex);

        if (pitchText) {
            const pitchLabel = document.createElement('span');
            pitchLabel.className = 'audio-waveform-lane__playback-region__pitch';
            pitchLabel.textContent = pitchText;
            pitchLabel.setAttribute('aria-hidden', 'true');
            slotEl.appendChild(pitchLabel);
        }
        if (gainText) {
            const gainLabel = document.createElement('span');
            gainLabel.className = 'audio-waveform-lane__playback-region__gain-db';
            gainLabel.textContent = gainText;
            gainLabel.setAttribute('aria-hidden', 'true');
            slotEl.appendChild(gainLabel);
        }
        positionRegionMetaSlotEl(slotEl, track, segmentIndex);
        return slotEl;
    }

    function buildRegionMetaRowEl(track, lane) {
        const segments =
            typeof getTrackSegments === 'function' ? getTrackSegments(track) : [];
        if (!segments.length) return null;

        const rowEl = document.createElement('div');
        rowEl.className = 'audio-waveform-lane__region-meta-row';
        rowEl.dataset.extraSlot = String(track.slot);
        rowEl.style.top = rehearsalMarksRowTopPx(lane) + 'px';
        rowEl.style.height = rehearsalMarksRowHeightPx(lane) + 'px';

        const regionsContainer =
            typeof getPlaybackRegionsContainerEl === 'function'
                ? getPlaybackRegionsContainerEl(track)
                : null;
        rowEl.classList.toggle(
            'audio-waveform-lane__region-meta-row--dense-boundaries',
            !!(
                regionsContainer &&
                regionsContainer.classList.contains(
                    'audio-waveform-lane__playback-regions--dense-boundaries',
                )
            ),
        );

        for (let i = 0; i < segments.length; i++) {
            const slotEl = buildRegionMetaSlotEl(track, i);
            if (slotEl) rowEl.appendChild(slotEl);
        }
        return rowEl.childElementCount ? rowEl : null;
    }

    function refreshAllRegionPitchGainOverlay() {
        const overlay = getRegionMetaOverlayEl();
        if (!overlay) return;

        const phraseFillOn = isMusicalGridPhraseFillVisibleSafe();
        overlay.replaceChildren();
        if (!phraseFillOn) {
            overlay.hidden = true;
            return;
        }

        const n = typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        let anyVisible = false;
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            const lane = document.getElementById('extraAudioLane' + slot);
            const meta = document.getElementById('extraAudioMeta' + slot);
            if (!lane || lane.hidden || (meta && meta.hidden)) continue;
            if (typeof isTrackRegionActive === 'function' && !isTrackRegionActive(track)) {
                continue;
            }
            const rowEl = buildRegionMetaRowEl(track, lane);
            if (!rowEl) continue;
            overlay.appendChild(rowEl);
            anyVisible = true;
        }
        overlay.hidden = !anyVisible;
    }

    function readWaveLaneHeightPx() {
        if (typeof getWaveformLaneHeightCss === 'function') {
            const h = getWaveformLaneHeightCss();
            if (h > 0) return h;
        }
        if (typeof audioWaveformComposite !== 'undefined' && audioWaveformComposite) {
            const h = parseFloat(
                getComputedStyle(audioWaveformComposite).getPropertyValue('--wave-lane-h'),
            );
            if (h > 0) return h;
        }
        return 92;
    }

    function rehearsalMarksRowTopPx(lane) {
        if (!lane) return 0;
        const laneH = readWaveLaneHeightPx();
        const row = parseInt(String(lane.style.gridRow || '1'), 10);
        if (Number.isFinite(row) && row >= 1) {
            return (row - 1) * laneH;
        }
        if (typeof lane.offsetTop === 'number' && Number.isFinite(lane.offsetTop)) {
            return Math.max(0, lane.offsetTop);
        }
        return 0;
    }

    function rehearsalMarksRowHeightPx(lane) {
        const laneH = readWaveLaneHeightPx();
        if (laneH > 0) return laneH;
        if (lane && lane.offsetHeight > 0) return lane.offsetHeight;
        return 92;
    }

    function positionRehearsalMarkEl(el, startSec, endSec, master) {
        if (!el || !(master > 0)) return;
        const leftPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(startSec)
                : (startSec / master) * 100;
        const rightPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(endSec)
                : (endSec / master) * 100;
        const widthPct = Math.max(0, rightPct - leftPct);
        el.style.left = leftPct + '%';
        el.style.width = widthPct + '%';
        el.classList.toggle(
            'audio-waveform-lane__rehearsal-mark--narrow',
            widthPct > 0 &&
                regionOverlayWidthPxFromPct(
                    widthPct,
                    getRegionOverlayTimelineMetrics()?.scrubW,
                ) < REGION_OVERLAY_NARROW_PX,
        );
    }

    function isMusicalGridPhraseFillVisibleSafe() {
        return (
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible()
        );
    }

    function shouldShowMusicalMetaOnSegment(track, segmentIndex) {
        if (!isMusicalGridPhraseFillVisibleSafe()) return false;
        if (typeof resolveRegionSwapUnitSegmentIndices === 'function') {
            const unit = resolveRegionSwapUnitSegmentIndices(track, segmentIndex);
            if (!unit || !unit.length) return true;
            return (unit[0] | 0) === (segmentIndex | 0);
        }
        return true;
    }

    function appendPhraseMusicalMetaLabelEl(parentEl, metaText) {
        if (!parentEl || !metaText || !isMusicalGridPhraseFillVisibleSafe()) return null;
        const metaEl = document.createElement('span');
        metaEl.className = 'audio-waveform-lane__phrase-meta__label';
        metaEl.textContent = metaText;
        metaEl.title = metaText;
        metaEl.setAttribute('aria-hidden', 'true');
        parentEl.appendChild(metaEl);
        return metaEl;
    }

    function appendSwapUnitMusicalMetaToEl(track, el, ref, slotsOpt) {
        if (!isMusicalGridPhraseFillVisibleSafe()) return;
        if (typeof formatSwapUnitStoredMusicalMetaText === 'function') {
            const metaText = formatSwapUnitStoredMusicalMetaText(track, ref, { slots: slotsOpt });
            appendPhraseMusicalMetaLabelEl(el, metaText);
        }
        appendChainNextRehearsalMarkLabelToEl(track, el, ref);
    }

    function resolveContentPhraseSlotIndexForSwapUnitRef(track, ref, phraseSlotFallback) {
        if (ref && Number.isFinite(ref.segmentIndex) && ref.segmentIndex >= 0) {
            return ref.segmentIndex | 0;
        }
        if (
            ref &&
            Number.isFinite(ref.silentGapIndex) &&
            typeof collectTrackSilentGaps === 'function'
        ) {
            const gaps = collectTrackSilentGaps(track);
            const gap = gaps && gaps[ref.silentGapIndex | 0];
            if (gap && Number.isFinite(gap.phraseIndex) && gap.phraseIndex >= 0) {
                return gap.phraseIndex | 0;
            }
        }
        if (phraseSlotFallback != null && phraseSlotFallback >= 0) {
            return phraseSlotFallback | 0;
        }
        return null;
    }

    function appendChainNextRehearsalMarkLabelToEl(track, el, ref) {
        if (!el || !isMusicalGridPhraseFillVisibleSafe()) return;
        const ranges =
            typeof getPhraseGroupRangesForRegionRehearsalMarks === 'function'
                ? getPhraseGroupRangesForRegionRehearsalMarks()
                : [];
        if (!ranges.length) return;

        let phraseSlotFallback = null;
        if (ref && Number.isFinite(ref.segmentIndex) && ref.segmentIndex >= 0) {
            const si = ref.segmentIndex | 0;
            if (
                typeof phraseSlotIndexAtRegionInSec === 'function' &&
                typeof getSegmentRegionTimelineIn === 'function'
            ) {
                phraseSlotFallback = phraseSlotIndexAtRegionInSec(
                    getSegmentRegionTimelineIn(track, si),
                );
            }
        } else if (
            ref &&
            Number.isFinite(ref.silentGapIndex) &&
            typeof collectTrackSilentGaps === 'function'
        ) {
            const gap = collectTrackSilentGaps(track)[ref.silentGapIndex | 0];
            if (gap && Number.isFinite(gap.phraseIndex) && gap.phraseIndex >= 0) {
                phraseSlotFallback = gap.phraseIndex | 0;
            }
        }

        const contentPhraseIdx = resolveContentPhraseSlotIndexForSwapUnitRef(
            track,
            ref,
            phraseSlotFallback,
        );
        if (contentPhraseIdx == null) return;

        const nextMark = chainSuccessorRehearsalMarkDisplay(contentPhraseIdx, ranges.length);
        if (!nextMark) return;

        const nextEl = document.createElement('span');
        nextEl.className =
            'audio-waveform-lane__phrase-meta__label audio-waveform-lane__phrase-meta__label--chain-next';
        nextEl.textContent = nextMark === 'End' ? 'End' : 'next ' + nextMark;
        nextEl.title =
            nextMark === 'End'
                ? '大元の順序ではここが終端（End）'
                : '大元の順序ではこのリージョンの次に ' + nextMark + ' に繋がる';
        nextEl.setAttribute('aria-hidden', 'true');
        el.appendChild(nextEl);
    }

    /** 大元チェーン上、このコンテンツの直後に繋がるリハーサル名（末尾は End） */
    function chainSuccessorRehearsalMarkDisplay(contentPhraseSlotIndex, phraseSlotCount) {
        const nextIdx = (contentPhraseSlotIndex | 0) + 1;
        if (nextIdx < 0 || nextIdx >= (phraseSlotCount | 0)) return 'End';
        const markInternal = formatRehearsalMarkForPhraseSlot(nextIdx);
        if (typeof rehearsalMarkDisplayLabel === 'function') {
            return rehearsalMarkDisplayLabel(markInternal);
        }
        return markInternal === '_' ? '' : markInternal;
    }

    function appendPhraseRehearsalMarkEls(rowEl, ranges, master) {
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (!r || !Number.isFinite(r.startSec) || !Number.isFinite(r.endSec)) continue;
            const slotEl = document.createElement('div');
            slotEl.className = 'audio-waveform-lane__rehearsal-mark';
            slotEl.dataset.phraseSlotIndex = String(i);
            const markInternal = formatRehearsalMarkForPhraseSlot(i);
            slotEl.dataset.rehearsalMark = markInternal;
            const markDisplay =
                typeof rehearsalMarkDisplayLabel === 'function'
                    ? rehearsalMarkDisplayLabel(markInternal)
                    : markInternal === '_'
                      ? ''
                      : markInternal;
            if (markDisplay) {
                const labelEl = document.createElement('span');
                labelEl.className = 'audio-waveform-lane__rehearsal-mark__label';
                labelEl.textContent = markDisplay;
                labelEl.title =
                    'リハーサル名 ' + markDisplay + '（Shift+' + markDisplay + ' で先頭へジャンプ）';
                labelEl.setAttribute('aria-hidden', 'true');
                slotEl.appendChild(labelEl);
            }
            if (!slotEl.childElementCount) continue;
            positionRehearsalMarkEl(slotEl, r.startSec, r.endSec, master);
            rowEl.appendChild(slotEl);
        }
    }

    function buildRehearsalMarksRowEl(track, lane, ranges, master) {
        const rowEl = document.createElement('div');
        rowEl.className = 'audio-waveform-lane__rehearsal-marks-row';
        rowEl.dataset.extraSlot = String(track.slot);
        rowEl.style.top = rehearsalMarksRowTopPx(lane) + 'px';
        rowEl.style.height = rehearsalMarksRowHeightPx(lane) + 'px';
        appendPhraseRehearsalMarkEls(rowEl, ranges, master);
        return rowEl.childElementCount ? rowEl : null;
    }

    function syncTrackPhraseRehearsalMarks(_track) {
        refreshAllRegionRehearsalMarkLabels();
        refreshAllRegionPitchGainOverlay();
    }

    function refreshAllRegionRehearsalMarkLabels() {
        purgeLegacyRehearsalMarkContainers();
        const overlay = getRehearsalMarksOverlayEl();
        if (!overlay) return;

        const ranges =
            typeof getPhraseGroupRangesForRegionRehearsalMarks === 'function'
                ? getPhraseGroupRangesForRegionRehearsalMarks()
                : [];
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const phraseFillOn = isMusicalGridPhraseFillVisibleSafe();

        overlay.replaceChildren();
        if (!phraseFillOn || !(master > 0) || !ranges.length) {
            overlay.hidden = true;
            return;
        }

        const n = typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        let anyVisible = false;
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            const lane = document.getElementById('extraAudioLane' + slot);
            const meta = document.getElementById('extraAudioMeta' + slot);
            if (!lane || lane.hidden || (meta && meta.hidden)) continue;
            if (typeof isTrackRegionActive === 'function' && !isTrackRegionActive(track)) {
                continue;
            }
            const rowEl = buildRehearsalMarksRowEl(track, lane, ranges, master);
            if (!rowEl) continue;
            overlay.appendChild(rowEl);
            anyVisible = true;
        }
        overlay.hidden = !anyVisible;
    }

    function refreshAllRegionMusicalMetaPresentation() {
        refreshAllRegionRehearsalMarkLabels();
        refreshAllRegionPitchGainOverlay();
        if (typeof getExtraTrackCount !== 'function' || typeof updateTrackRegionOverlays !== 'function') {
            return;
        }
        const n = getExtraTrackCount();
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            if (typeof isTrackRegionActive === 'function' && !isTrackRegionActive(track)) continue;
            updateTrackRegionOverlays(track);
        }
    }

    window.formatRehearsalMarkForPhraseSlot = formatRehearsalMarkForPhraseSlot;
    window.formatRegionRehearsalMarkLabel = formatRegionRehearsalMarkLabel;
    window.refreshAllRegionRehearsalMarkLabels = refreshAllRegionRehearsalMarkLabels;
    window.refreshAllRegionPitchGainOverlay = refreshAllRegionPitchGainOverlay;
    window.syncRehearsalMarksOverlayGridPlacement = syncRehearsalMarksOverlayGridPlacement;
    window.refreshAllRegionMusicalMetaPresentation = refreshAllRegionMusicalMetaPresentation;

    function refreshAllPlaybackRegionFadeTriangles() {
        const n = getExtraTrackCount();
        for (let i = 0; i < n; i++) {
            const track = { type: 'extra', slot: i };
            const container = getPlaybackRegionsContainerEl(track);
            if (container) refreshTrackFadeTriangleVisibility(track, container);
        }
    }

    function getRegionOverlayTimelineMetrics() {
        const lanes =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        return typeof waveformTimelineMetrics === 'function' && lanes
            ? waveformTimelineMetrics(lanes)
            : null;
    }

    function regionOverlayWidthPxFromPct(widthPct, scrubW) {
        const w = Number(widthPct);
        const scrub = Number(scrubW);
        if (!(scrub > 0) || !Number.isFinite(w)) return 0;
        return Math.max(0, (w / 100) * scrub);
    }

    /** リージョン入れ替えアニメ — トランスポート秒をスクラブ上の CSS px に変換 */
    function transportSecToOverlayPx(transportSec, metrics, masterDurSec) {
        const sec = Number(transportSec);
        const master = Number(masterDurSec);
        const scrubW = metrics && Number.isFinite(metrics.scrubW) ? metrics.scrubW : 0;
        if (!Number.isFinite(sec) || !(master > 0) || !(scrubW > 0)) return NaN;
        const leftPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(sec)
                : (sec / master) * 100;
        if (!Number.isFinite(leftPct)) return NaN;
        return regionOverlayWidthPxFromPct(leftPct, scrubW);
    }

    window.transportSecToOverlayPx = transportSecToOverlayPx;

    function applySegmentFadeMarkerLinesToRegionEl(regionEl, marker) {
        if (!regionEl || !marker) return;
        const inLine = regionEl.querySelector(
            '.audio-waveform-lane__playback-region__fade-marker-line--in',
        );
        const outLine = regionEl.querySelector(
            '.audio-waveform-lane__playback-region__fade-marker-line--out',
        );
        if (inLine) {
            const active = marker.fadeInSec > 0.0005;
            inLine.hidden = !active;
            if (active) {
                inLine.style.left = marker.fadeInAxisRatio * 100 + '%';
            }
        }
        if (outLine) {
            const active = marker.fadeOutSec > 0.0005;
            outLine.hidden = !active;
            if (active) {
                outLine.style.left = marker.fadeOutAxisRatio * 100 + '%';
            }
        }
    }

    function applyRegionFadeHandlesDefault(track, segmentIndex, regionEl) {
        const inTransport = Math.max(
            typeof getTrackTimelineStartSec === 'function'
                ? getTrackTimelineStartSec(track)
                : 0,
            getSegmentRegionTimelineIn(track, segmentIndex),
        );
        const outTransport = getSegmentTimelineEnd(track, segmentIndex);
        const regionDur = Math.max(0.001, outTransport - inTransport);
        const pres = resolveSegmentFadeTrianglePresentation(
            track,
            segmentIndex,
            inTransport,
            regionDur,
        );

        const fadeInHandle = regionEl.querySelector(
            '.audio-waveform-lane__playback-region__handle--fade-in',
        );
        if (fadeInHandle) {
            fadeInHandle.style.left = pres.fadeInAxisRatio * 100 + '%';
            fadeInHandle.style.right = 'auto';
            fadeInHandle.hidden = false;
        }
        const fadeOutHandle = regionEl.querySelector(
            '.audio-waveform-lane__playback-region__handle--fade-out',
        );
        if (fadeOutHandle) {
            fadeOutHandle.style.left = pres.fadeOutAxisRatio * 100 + '%';
            fadeOutHandle.style.right = 'auto';
            fadeOutHandle.hidden = false;
        }
        applySegmentFadeMarkerLinesToRegionEl(regionEl, pres);
    }

    function refreshTrackFadeTriangleVisibility(track, container) {
        if (!container) return;
        const regionEls = container.querySelectorAll(
            '.audio-waveform-lane__playback-region',
        );
        for (let i = 0; i < regionEls.length; i++) {
            const segmentIndex = Number(regionEls[i].dataset.segmentIndex);
            if (!Number.isFinite(segmentIndex) || segmentIndex < 0) continue;
            applyRegionFadeHandlesDefault(track, segmentIndex, regionEls[i]);
        }
    }

    function refreshAllRegionBoundaryPresentation() {
        const n =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            const container = getPlaybackRegionsContainerEl(track);
            if (!container || container.hidden) continue;
            refreshTrackFadeTriangleVisibility(track, container);
        }
        if (typeof window.scheduleWaveformRegionOverlayRefresh === 'function') {
            window.scheduleWaveformRegionOverlayRefresh();
        }
    }

    window.refreshAllRegionBoundaryPresentation = refreshAllRegionBoundaryPresentation;

    /** 同一クリップ連続結合チェーンを 1 本の overview として描画（セグメント数分のループを避ける） */
