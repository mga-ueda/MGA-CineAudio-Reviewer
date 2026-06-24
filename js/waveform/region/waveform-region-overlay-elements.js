/**
 * waveform-region-overlay-elements.js — リージョン overlay DOM 要素の構築・配置
 */
    function getPlaybackRegionsContainerEl(track) {
        if (isVideoTrackRef(track)) {
            return videoVizLane
                ? videoVizLane.querySelector('.audio-waveform-lane__playback-regions')
                : null;
        }
        if (!isExtraTrackRef(track)) return null;
        const lane = document.getElementById('extraAudioLane' + track.slot);
        if (!lane) return null;
        return lane.querySelector('.audio-waveform-lane__playback-regions');
    }

    function syncExtraLaneRegionsClassForTrack(track) {
        if (!isPlaybackRegionTrackRef(track)) return;
        const lane = isVideoTrackRef(track)
            ? videoVizLane
            : document.getElementById('extraAudioLane' + track.slot);
        if (!lane) return;
        const hasRegions = isTrackRegionActive(track);
        const hadRegions = lane.classList.contains('audio-waveform-lane--has-regions');
        lane.classList.toggle('audio-waveform-lane--has-regions', hasRegions);
        if (
            hadRegions !== hasRegions &&
            typeof getMusicalGridRehearsalFillVisible === 'function' &&
            getMusicalGridRehearsalFillVisible()
        ) {
            if (typeof scheduleMusicalGridRedraw === 'function') {
                scheduleMusicalGridRedraw();
            } else if (typeof drawMusicalGridOverlay === 'function') {
                drawMusicalGridOverlay();
            }
        }
        if (
            hadRegions !== hasRegions &&
            typeof renderAudioWaveformMarkers === 'function'
        ) {
            renderAudioWaveformMarkers();
        }
        syncTrackRehearsalRehearsalMarks(track);
    }

    function buildSilentGapOverlayEl(track, gapIndex, gap, slotsOpt) {
        const el = document.createElement('div');
        el.className = 'audio-waveform-lane__playback-silent-gap';
        el.dataset.silentGapIndex = String(gapIndex);
        el.setAttribute('aria-hidden', 'true');
        let title = '無音スロット';
        if (Number.isFinite(gap.rehearsalIndex)) {
            if (typeof rehearsalGroupLabelForIndex === 'function') {
                const mark = rehearsalGroupLabelForIndex(gap.rehearsalIndex);
                if (mark) title += '（リハーサル名 ' + mark + ' 付近）';
            }
            if (gap.partial) title += '（部分無音）';
        }
        title += ' — Ctrl+クリックで選択';
        el.title = title;
        if (isSilentGapEntrySelected(track.slot, gapIndex)) {
            el.classList.add('audio-waveform-lane__playback-silent-gap--selected');
        }
        return el;
    }

    function positionSilentGapOverlayEl(el, gap) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!master) return;
        const leftPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(gap.startSec)
                : (gap.startSec / master) * 100;
        const rightPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(gap.endSec)
                : (gap.endSec / master) * 100;
        const widthPct = Math.max(0.05, rightPct - leftPct);
        el.style.left = leftPct + '%';
        el.style.width = widthPct + '%';
        el.hidden = false;
    }

    function buildRegionOverlayEl(track, segmentIndex, seg, slotsOpt, buildOpt) {
        const el = document.createElement('div');
        el.className = 'audio-waveform-lane__playback-region';
        const videoAudioMirror = !!(buildOpt && buildOpt.videoAudioMirror);
        if (isVideoTrackRef(track)) {
            if (videoAudioMirror) {
                el.classList.add('audio-waveform-lane__playback-region--video-audio-mirror');
            } else {
                el.classList.add('audio-waveform-lane__playback-region--video-viz');
            }
        }
        if (getSegmentRegionGroupId(track, segmentIndex)) {
            el.classList.add('audio-waveform-lane__playback-region--grouped');
        }
        const selected = isVideoTrackRef(track)
            ? typeof isVideoRegionEntrySelected === 'function' &&
              isVideoRegionEntrySelected(segmentIndex)
            : isRegionEntrySelected(track.slot, segmentIndex);
        if (selected) {
            el.classList.add('audio-waveform-lane__playback-region--selected');
        }
        el.dataset.segmentIndex = String(segmentIndex);
        const nudgeInKey =
            typeof window.SHORTCUT_HINTS !== 'undefined' && window.SHORTCUT_HINTS.regionInNudge
                ? window.SHORTCUT_HINTS.regionInNudge
                : 'Alt+Shift+I';
        const nudgeOutKey =
            typeof window.SHORTCUT_HINTS !== 'undefined' && window.SHORTCUT_HINTS.regionOutNudge
                ? window.SHORTCUT_HINTS.regionOutNudge
                : 'Alt+Shift+O';
        if (shouldShowSegmentInHandle(track, segmentIndex)) {
            el.classList.add('audio-waveform-lane__playback-region--edge-in');
            const handleIn = document.createElement('div');
            handleIn.className =
                'audio-waveform-lane__playback-region__handle audio-waveform-lane__playback-region__handle--in';
            handleIn.title =
                'リージョン ' +
                (segmentIndex + 1) +
                ' の In（ドラッグでソース開始位置。' +
                nudgeInKey +
                ' で1拍前へ）';
            el.appendChild(handleIn);
        }
        if (shouldShowSegmentOutHandle(track, segmentIndex)) {
            el.classList.add('audio-waveform-lane__playback-region--edge-out');
            const handleOut = document.createElement('div');
            handleOut.className =
                'audio-waveform-lane__playback-region__handle audio-waveform-lane__playback-region__handle--out';
            handleOut.title =
                'リージョン ' +
                (segmentIndex + 1) +
                ' の Out（ドラッグでソース終了位置。' +
                nudgeOutKey +
                ' で1拍後方へ）';
            el.appendChild(handleOut);
        }
        if (!isVideoTrackRef(track)) {
        const fadeCurve = document.createElement('div');
        fadeCurve.className = 'audio-waveform-lane__playback-region__fade-curve';
        fadeCurve.setAttribute('aria-hidden', 'true');
        const fadeInCurve = document.createElement('div');
        fadeInCurve.className =
            'audio-waveform-lane__playback-region__fade-curve-part audio-waveform-lane__playback-region__fade-curve-part--in';
        const fadeInSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        fadeInSvg.setAttribute('class', 'audio-waveform-lane__playback-region__fade-svg');
        fadeInSvg.setAttribute('viewBox', '0 0 100 100');
        fadeInSvg.setAttribute('preserveAspectRatio', 'none');
        const fadeInPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        fadeInPath.setAttribute('d', 'M 0 99 Q 50 99 100 1');
        fadeInSvg.appendChild(fadeInPath);
        fadeInCurve.appendChild(fadeInSvg);
        const fadeOutCurve = document.createElement('div');
        fadeOutCurve.className =
            'audio-waveform-lane__playback-region__fade-curve-part audio-waveform-lane__playback-region__fade-curve-part--out';
        const fadeOutSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        fadeOutSvg.setAttribute('class', 'audio-waveform-lane__playback-region__fade-svg');
        fadeOutSvg.setAttribute('viewBox', '0 0 100 100');
        fadeOutSvg.setAttribute('preserveAspectRatio', 'none');
        const fadeOutPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        fadeOutPath.setAttribute('d', 'M 100 99 Q 50 99 0 1');
        fadeOutSvg.appendChild(fadeOutPath);
        fadeOutCurve.appendChild(fadeOutSvg);
        fadeCurve.appendChild(fadeInCurve);
        fadeCurve.appendChild(fadeOutCurve);
        el.appendChild(fadeCurve);

        const fadeInHandle = document.createElement('div');
        fadeInHandle.className =
            'audio-waveform-lane__playback-region__handle audio-waveform-lane__playback-region__handle--fade-in';
        const fadeInKey =
            typeof window.SHORTCUT_HINTS !== 'undefined' && window.SHORTCUT_HINTS.regionFadeIn
                ? window.SHORTCUT_HINTS.regionFadeIn
                : 'Alt+I';
        const fadeOutKey =
            typeof window.SHORTCUT_HINTS !== 'undefined' && window.SHORTCUT_HINTS.regionFadeOut
                ? window.SHORTCUT_HINTS.regionFadeOut
                : 'Alt+O';
        fadeInHandle.title =
            'Fade In（内側へドラッグ、' + fadeInKey + ' でシークバーまで）';
        el.appendChild(fadeInHandle);
        const fadeOutHandle = document.createElement('div');
        fadeOutHandle.className =
            'audio-waveform-lane__playback-region__handle audio-waveform-lane__playback-region__handle--fade-out';
        fadeOutHandle.title =
            'Fade Out（内側へドラッグ、' + fadeOutKey + ' でシークバーまで）';
        el.appendChild(fadeOutHandle);

        const fadeInMarkerLine = document.createElement('div');
        fadeInMarkerLine.className =
            'audio-waveform-lane__playback-region__fade-marker-line audio-waveform-lane__playback-region__fade-marker-line--in';
        fadeInMarkerLine.hidden = true;
        fadeInMarkerLine.setAttribute('aria-hidden', 'true');
        el.appendChild(fadeInMarkerLine);
        const fadeOutMarkerLine = document.createElement('div');
        fadeOutMarkerLine.className =
            'audio-waveform-lane__playback-region__fade-marker-line audio-waveform-lane__playback-region__fade-marker-line--out';
        fadeOutMarkerLine.hidden = true;
        fadeOutMarkerLine.setAttribute('aria-hidden', 'true');
        el.appendChild(fadeOutMarkerLine);

        const gainDb = getSegmentGainDb(track, segmentIndex);
        const gainLabel = document.createElement('span');
        gainLabel.className = 'audio-waveform-lane__playback-region__gain-db';
        const gainText = formatRegionGainDbDisplay(gainDb);
        gainLabel.textContent = gainText;
        gainLabel.hidden = !gainText;
        gainLabel.setAttribute('aria-hidden', gainText ? 'false' : 'true');
        el.appendChild(gainLabel);
        const pitchSemitones = getSegmentPitchSemitones(track, segmentIndex);
        const pitchLabel = document.createElement('span');
        pitchLabel.className = 'audio-waveform-lane__playback-region__pitch';
        const pitchText = formatRegionPitchDisplay(pitchSemitones);
        pitchLabel.textContent = pitchText;
        pitchLabel.hidden = !pitchText;
        pitchLabel.setAttribute('aria-hidden', pitchText ? 'false' : 'true');
        el.appendChild(pitchLabel);
        }
        if (isVideoTrackRef(track) && !videoAudioMirror) {
            const filmstrip = document.createElement('div');
            filmstrip.className = 'video-viz-lane__filmstrip';
            filmstrip.setAttribute('aria-hidden', 'true');
            filmstrip.hidden = true;
            el.insertBefore(filmstrip, el.firstChild);
        }
        const cursorLine = document.createElement('div');
        cursorLine.className = 'audio-waveform-lane__playback-region__cursor-line';
        cursorLine.setAttribute('aria-hidden', 'true');
        cursorLine.hidden = true;
        el.appendChild(cursorLine);
        return el;
    }

    function buildSplitHandleEl(boundaryIndex) {
        const el = document.createElement('div');
        el.className =
            'audio-waveform-lane__playback-region__handle audio-waveform-lane__playback-region__handle--split';
        el.dataset.boundaryIndex = String(boundaryIndex);
        el.title = 'スプリット点（ドラッグで境界を移動）';
        return el;
    }

    function positionSplitHandleEl(el, track, boundaryIndex) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!master) return;
        const leftEnd = getSegmentTimelineEnd(track, boundaryIndex);
        const rightStart = getSegmentTimelineStart(track, boundaryIndex + 1);
        const splitTransport = (leftEnd + rightStart) * 0.5;
        const pct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(splitTransport)
                : (splitTransport / master) * 100;
        el.style.left = pct + '%';
        el.style.width = '14px';
        el.hidden = false;
    }

    function positionRegionOverlayEl(el, track, segmentIndex, seg) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!master) return;
        const overlayInterval =
            typeof getSegmentRegionOverlayTimelineInterval === 'function'
                ? getSegmentRegionOverlayTimelineInterval(track, segmentIndex)
                : null;
        const inTransport = overlayInterval
            ? overlayInterval.start
            : Math.max(
                  typeof getTrackTimelineStartSec === 'function'
                      ? getTrackTimelineStartSec(track)
                      : 0,
                  getSegmentRegionTimelineIn(track, segmentIndex),
              );
        const outTransport = overlayInterval
            ? overlayInterval.end
            : getSegmentRegionTimelineOut(track, segmentIndex);
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
        el.hidden = false;

        applyRegionFadeHandlesDefault(track, segmentIndex, el);

        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const regionDur = Math.max(0.001, outTransport - inTransport);
        const playbackFromRegion = Math.max(0, playbackStart - inTransport);
        const leadPad = getSegmentRegionLeadPadSec(track, segmentIndex);
        const playbackOffsetRatio = Math.max(0, Math.min(1, playbackFromRegion / regionDur));
        if (leadPad > 0.00001) {
            el.classList.add('audio-waveform-lane__playback-region--lead-pad');
            el.style.setProperty('--region-playback-offset', playbackOffsetRatio * 100 + '%');
        } else {
            el.classList.remove('audio-waveform-lane__playback-region--lead-pad');
            el.style.removeProperty('--region-playback-offset');
        }
        const fadeInSec = getSegmentFadeDurationSec(track, segmentIndex, 'in');
        const fadeOutSec = getSegmentFadeDurationSec(track, segmentIndex, 'out');
        const fadeInRatio = Math.max(0, Math.min(1, fadeInSec / regionDur));
        const fadeOutRatio = Math.max(0, Math.min(1, fadeOutSec / regionDur));

        const fadeCurve = el.querySelector('.audio-waveform-lane__playback-region__fade-curve');
        if (fadeCurve) {
            fadeCurve.style.setProperty('--region-fade-in-start', playbackOffsetRatio * 100 + '%');
            fadeCurve.style.setProperty('--region-fade-in-width', fadeInRatio * 100 + '%');
            fadeCurve.style.setProperty('--region-fade-out-width', fadeOutRatio * 100 + '%');
        }

        const gainLabel = el.querySelector('.audio-waveform-lane__playback-region__gain-db');
        if (gainLabel) {
            const gainText = formatRegionGainDbDisplay(getSegmentGainDb(track, segmentIndex));
            gainLabel.textContent = gainText;
            gainLabel.hidden = !gainText;
            gainLabel.setAttribute('aria-hidden', gainText ? 'false' : 'true');
        }
        const pitchLabel = el.querySelector('.audio-waveform-lane__playback-region__pitch');
        if (pitchLabel) {
            const pitchText = formatRegionPitchDisplay(
                getSegmentPitchSemitones(track, segmentIndex),
            );
            pitchLabel.textContent = pitchText;
            pitchLabel.hidden = !pitchText;
            pitchLabel.setAttribute('aria-hidden', pitchText ? 'false' : 'true');
        }
    }

    /** 再生ミックスと同じ区間で、同一トラック内のクロスフェード重なりを列挙 */
    function collectTrackCrossfadeZones(track) {
        const segments = getTrackSegments(track);
        if (segments.length < 2) return [];
        const zones = [];
        const probeInterval =
            typeof getSegmentCrossfadeProbeInterval === 'function'
                ? getSegmentCrossfadeProbeInterval
                : function (t, segmentIndex) {
                      return {
                          start: getSegmentPlaybackTimelineStart(t, segmentIndex),
                          end: getSegmentTimelineEnd(t, segmentIndex),
                      };
                  };
        for (let i = 0; i < segments.length; i++) {
            for (let j = i + 1; j < segments.length; j++) {
                const ivI = probeInterval(track, i);
                const ivJ = probeInterval(track, j);
                const oStart = Math.max(ivI.start, ivJ.start);
                const oEnd = Math.min(ivI.end, ivJ.end);
                const minOverlap =
                    typeof window.MIN_CROSSFADE_OVERLAP_SEC === 'number'
                        ? window.MIN_CROSSFADE_OVERLAP_SEC
                        : 0.005;
                if (oEnd - oStart < minOverlap) continue;
                zones.push({ startSec: oStart, endSec: oEnd });
            }
        }
        return zones;
    }

    function buildCrossfadeMarkerEl() {
        const el = document.createElement('div');
        el.className = 'audio-waveform-lane__crossfade-marker';
        el.setAttribute('aria-hidden', 'true');
        el.title = 'クロスフェード（ドラッグで量を調整）';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'audio-waveform-lane__crossfade-marker__shape');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('preserveAspectRatio', 'none');
        const fadeOut = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        fadeOut.setAttribute('d', 'M 1 1 Q 50 14 99 99');
        const fadeIn = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        fadeIn.setAttribute('d', 'M 1 99 Q 50 14 99 1');
        svg.appendChild(fadeOut);
        svg.appendChild(fadeIn);
        el.appendChild(svg);
        return el;
    }

    function positionCrossfadeMarkerEl(el, startSec, endSec) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!master) return;
        const leftPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(startSec)
                : (startSec / master) * 100;
        const rightPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(endSec)
                : (endSec / master) * 100;
        el.style.left = leftPct + '%';
        el.style.width = Math.max(0.08, rightPct - leftPct) + '%';
        el.hidden = false;
    }
