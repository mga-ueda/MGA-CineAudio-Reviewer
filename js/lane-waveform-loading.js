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

    /** マーカー・ラベル（全行オーバーレイ）より前面に出すため lanes-inner 直下へ配置 */
    function syncLoadingOverlayPlacement(lane, loadingEl) {
        const inner =
            typeof audioWaveformLanesInner !== 'undefined' ? audioWaveformLanesInner : null;
        if (!inner || !lane || !loadingEl) return;
        if (loadingEl.parentElement !== inner) {
            inner.appendChild(loadingEl);
        }
        loadingEl.classList.add('audio-waveform-lane__loading--overlay');
        const row = lane.style.gridRow;
        if (row) {
            loadingEl.style.gridRow = row;
            loadingEl.style.gridColumn = '1';
        } else {
            loadingEl.style.gridRow = '';
            loadingEl.style.gridColumn = '';
        }
    }

    function syncAllLoadingOverlayPlacement() {
        if (typeof audioWaveformLaneVideo !== 'undefined' && audioWaveformLaneVideo) {
            const el = loadingElForLane(audioWaveformLaneVideo);
            if (el) syncLoadingOverlayPlacement(audioWaveformLaneVideo, el);
        }
        const n = typeof EXTRA_TRACK_COUNT !== 'undefined' ? EXTRA_TRACK_COUNT : 0;
        for (let i = 0; i < n; i++) {
            const lane = document.getElementById('extraAudioLane' + i);
            if (!lane) continue;
            const el = loadingElForLane(lane);
            if (el) syncLoadingOverlayPlacement(lane, el);
        }
    }

    function setLaneWaveformLoading(laneEl, visible) {
        const lane = resolveWaveformLaneEl(laneEl);
        if (!lane) return;
        const el = loadingElForLane(lane);
        if (!el) return;
        syncLoadingOverlayPlacement(lane, el);
        el.hidden = !visible;
        if (visible) el.setAttribute('aria-busy', 'true');
        else el.removeAttribute('aria-busy');
    }

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

    window.syncAllLoadingOverlayPlacement = syncAllLoadingOverlayPlacement;

    syncAllTrackWaveformLoading();
})();
