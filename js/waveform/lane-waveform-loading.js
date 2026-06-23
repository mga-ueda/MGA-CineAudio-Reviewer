/**
 * lane-waveform-loading.js — 各波形レーンの「読込中／デコード中」表示の同期。
 */
(function laneWaveformLoadingModule() {
    function resolveWaveformLaneEl(laneOrTrackEl) {
        if (!laneOrTrackEl) return null;
        if (laneOrTrackEl.classList && laneOrTrackEl.classList.contains('audio-waveform-lane')) {
            return laneOrTrackEl;
        }
        if (typeof laneOrTrackEl.closest === 'function') {
            return laneOrTrackEl.closest('.audio-waveform-lane');
        }
        return null;
    }

    function loadingElForLane(lane) {
        if (!lane) return null;
        let el = lane.querySelector('.audio-waveform-lane__loading');
        if (el) return el;
        if (lane.id === 'audioWaveformLaneVideo') {
            return document.getElementById('audioWaveformTrackLoading');
        }
        if (lane.id && lane.id.indexOf('extraAudioLane') === 0) {
            return document.getElementById(
                'extraAudioTrackLoading' + lane.id.slice('extraAudioLane'.length),
            );
        }
        return null;
    }

    /** grid-row 未割当時は表示中レーンの行番号（1 始まり） */
    function resolveLaneGridRowStr(lane) {
        if (!lane) return '';
        if (lane.style.gridRow) return lane.style.gridRow;
        if (lane.id === 'musicalRehearsalLane') return '1';
        if (lane.id === 'musicalTempoLane') return '2';
        if (lane.id === 'musicalSignatureLane') return '3';
        if (lane.id === 'musicalMeasureLane') return '4';
        const videoMeta =
            typeof audioWaveformPanel !== 'undefined' ? audioWaveformPanel : null;
        const videoLane =
            typeof audioWaveformLaneVideo !== 'undefined' ? audioWaveformLaneVideo : null;
        const videoShown = !!(videoMeta && !videoMeta.hidden);
        let row = 5;
        if (lane === videoLane) return videoShown ? String(row) : '';
        if (videoShown) row += 1;
        const n = typeof EXTRA_TRACK_COUNT !== 'undefined' ? EXTRA_TRACK_COUNT : 0;
        for (let i = 0; i < n; i++) {
            const meta = document.getElementById('extraAudioMeta' + i);
            const extraLane = document.getElementById('extraAudioLane' + i);
            if (!meta || meta.hidden) continue;
            if (extraLane === lane) return String(row);
            row += 1;
        }
        return '';
    }

    /** lanes-inner 直下オーバーレイの grid-row / column をレーン行に合わせる */
    function syncLaneOverlayGridPlacement(lane, overlayEl) {
        const inner =
            typeof audioWaveformLanesInner !== 'undefined' ? audioWaveformLanesInner : null;
        if (!inner || !lane || !overlayEl) return;
        if (typeof syncWaveformLanesViewportWidthCss === 'function') {
            syncWaveformLanesViewportWidthCss();
        }
        if (overlayEl.parentElement !== inner) {
            inner.appendChild(overlayEl);
        }
        const row = resolveLaneGridRowStr(lane);
        if (row) {
            overlayEl.style.gridRow = row;
            overlayEl.style.gridColumn = '1';
        } else {
            overlayEl.style.gridRow = '';
            overlayEl.style.gridColumn = '';
        }
    }

    function ensureLoadingInLane(lane, loadingEl) {
        if (!lane || !loadingEl) return;
        if (loadingEl.parentElement !== lane) {
            lane.appendChild(loadingEl);
        }
        loadingEl.style.gridRow = '';
        loadingEl.style.gridColumn = '';
        loadingEl.classList.remove('audio-waveform-lane__loading--overlay');
    }

    /** マーカー・プレイヘッド等より前面 — lanes-inner 直下へ該当行に配置 */
    function syncLoadingOverlayPlacement(lane, loadingEl) {
        syncLaneOverlayGridPlacement(lane, loadingEl);
        if (loadingEl) loadingEl.classList.add('audio-waveform-lane__loading--overlay');
    }

    function syncAllRehearsalMarksOverlayPlacement() {
        if (typeof refreshAllRegionRehearsalMarkLabels === 'function') {
            refreshAllRegionRehearsalMarkLabels();
            return;
        }
        const sync =
            typeof syncRehearsalMarksOverlayGridPlacement === 'function'
                ? syncRehearsalMarksOverlayGridPlacement
                : null;
        const el = document.getElementById('extraAudioRehearsalMarksOverlay');
        if (sync && el) sync(el);
    }

    function syncAllLoadingOverlayPlacement() {
        if (typeof audioWaveformLaneVideo !== 'undefined' && audioWaveformLaneVideo) {
            const el = loadingElForLane(audioWaveformLaneVideo);
            if (el && !el.hidden) syncLoadingOverlayPlacement(audioWaveformLaneVideo, el);
        }
        const n = typeof EXTRA_TRACK_COUNT !== 'undefined' ? EXTRA_TRACK_COUNT : 0;
        for (let i = 0; i < n; i++) {
            const lane = document.getElementById('extraAudioLane' + i);
            if (!lane) continue;
            const el = loadingElForLane(lane);
            if (el && !el.hidden) syncLoadingOverlayPlacement(lane, el);
        }
        syncAllRehearsalMarksOverlayPlacement();
    }

    function setLaneWaveformLoading(laneEl, visible) {
        const lane = resolveWaveformLaneEl(laneEl);
        if (!lane) return;
        const el = loadingElForLane(lane);
        if (!el) return;
        el.hidden = !visible;
        if (visible) {
            syncLoadingOverlayPlacement(lane, el);
            const box = el.querySelector('.audio-waveform-lane__loading-box');
            if (box && !box.querySelector('.audio-waveform-lane__loading-ellipsis')) {
                const plain = (box.textContent || '').trim();
                if (loadingMessageAnimatedLabel(plain)) {
                    setLaneWaveformLoadingMessage(lane, plain);
                }
            }
        } else {
            ensureLoadingInLane(lane, el);
            setLaneWaveformLoadingMessage(lane, 'Now Loading');
        }
        if (visible) el.setAttribute('aria-busy', 'true');
        else el.removeAttribute('aria-busy');
    }

    const LOADING_MSG_ANIMATED_LABELS = {
        'time stretching': 'Time Stretching',
        'now loading': 'Now Loading',
    };

    function loadingMessageAnimatedLabel(message) {
        const key = String(message || 'now loading').trim().toLowerCase();
        return LOADING_MSG_ANIMATED_LABELS[key] || null;
    }

    function setLaneWaveformLoadingMessage(laneEl, message) {
        const lane = resolveWaveformLaneEl(laneEl);
        if (!lane) return;
        const el = loadingElForLane(lane);
        if (!el) return;
        const box = el.querySelector('.audio-waveform-lane__loading-box');
        if (!box) return;
        const label = loadingMessageAnimatedLabel(message);
        if (label) {
            box.replaceChildren();
            const labelEl = document.createElement('span');
            labelEl.className = 'audio-waveform-lane__loading-label';
            labelEl.textContent = label;
            const dots = document.createElement('span');
            dots.className = 'audio-waveform-lane__loading-ellipsis';
            dots.setAttribute('aria-hidden', 'true');
            box.appendChild(labelEl);
            box.appendChild(document.createTextNode(' '));
            box.appendChild(dots);
            return;
        }
        box.textContent = message || 'Now Loading';
    }

    window.setExtraTrackWaveformLoadingMessage = function setExtraTrackWaveformLoadingMessage(
        slot,
        message,
    ) {
        const lane = document.getElementById('extraAudioLane' + slot);
        if (lane) {
            setLaneWaveformLoadingMessage(lane, message);
            return;
        }
        const ui = typeof getExtraUi === 'function' ? getExtraUi(slot) : null;
        setLaneWaveformLoadingMessage(ui && ui.track ? ui.track : null, message);
    };

    window.setVideoTrackWaveformLoading = function setVideoTrackWaveformLoading(visible) {
        const lane =
            typeof audioWaveformLaneVideo !== 'undefined' && audioWaveformLaneVideo
                ? audioWaveformLaneVideo
                : typeof audioWaveformTrack !== 'undefined' && audioWaveformTrack
                  ? audioWaveformTrack
                  : null;
        setLaneWaveformLoading(lane, visible);
    };

    window.setExtraTrackWaveformLoading = function setExtraTrackWaveformLoading(slot, visible) {
        const lane = document.getElementById('extraAudioLane' + slot);
        if (lane) {
            setLaneWaveformLoading(lane, visible);
            return;
        }
        const ui = typeof getExtraUi === 'function' ? getExtraUi(slot) : null;
        setLaneWaveformLoading(ui && ui.track ? ui.track : null, visible);
    };

    window.syncVideoTrackWaveformLoading = function syncVideoTrackWaveformLoading() {
        const ready =
            typeof isVideoWaveformPlacementReady === 'function'
                ? isVideoWaveformPlacementReady()
                : true;
        setVideoTrackWaveformLoading(!ready);
    };

    window.syncExtraTrackWaveformLoading = function syncExtraTrackWaveformLoading(slot) {
        const ready =
            typeof isExtraTrackWaveformPlacementReady === 'function'
                ? isExtraTrackWaveformPlacementReady(slot)
                : true;
        setExtraTrackWaveformLoading(slot, !ready);
    };

    window.syncAllTrackWaveformLoading = function syncAllTrackWaveformLoading() {
        syncVideoTrackWaveformLoading();
        const n = typeof EXTRA_TRACK_COUNT !== 'undefined' ? EXTRA_TRACK_COUNT : 0;
        for (let i = 0; i < n; i++) syncExtraTrackWaveformLoading(i);
        syncAllLoadingOverlayPlacement();
    };

    window.syncLaneOverlayGridPlacement = syncLaneOverlayGridPlacement;
    window.syncAllLoadingOverlayPlacement = syncAllLoadingOverlayPlacement;
    window.syncAllRehearsalMarksOverlayPlacement = syncAllRehearsalMarksOverlayPlacement;

    syncAllTrackWaveformLoading();
    if (typeof refreshAllRegionRehearsalMarkLabels === 'function') {
        refreshAllRegionRehearsalMarkLabels();
    }
})();
