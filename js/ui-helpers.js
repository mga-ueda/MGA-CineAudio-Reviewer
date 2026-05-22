    const transportOptGlowClearTimers = { playback: 0 };
    let videoPanelDriftGlowTimer = 0;

    const LANE_STATUS_HIDE_RE =
        /^(Not Loaded|No audio track|Loading waveform|Reading audio|Decoding)/i;

    function shouldShowLaneStatus(text) {
        if (!text || !String(text).trim()) return false;
        const t = String(text).trim();
        if (LANE_STATUS_HIDE_RE.test(t)) return false;
        if (/too large|failed|unavailable/i.test(t)) return true;
        return false;
    }

    function applyLaneStatusEl(el, text) {
        if (!el) return;
        const t = text ? String(text).trim() : '';
        el.textContent = t;
        el.hidden = !shouldShowLaneStatus(t);
    }

    function laneStatusTooltip(text) {
        if (!text || !String(text).trim()) return '';
        const t = String(text).trim();
        if (LANE_STATUS_HIDE_RE.test(t)) return '';
        return t;
    }

    function isPlayInterruptedError(err) {
        if (!err) return false;
        if (err.name === 'AbortError') return true;
        const msg = String(err.message || err);
        return /interrupted by a call to pause/i.test(msg);
    }

    const TRANSPORT_OPT_BOX_SELECTOR = {
        playback: '.transport-opt-box--playback',
    };

    function flashVideoPanelDrift() {
        const panel = document.getElementById('panelMain');
        if (!panel) return;
        panel.classList.remove('video-panel--drift-glow');
        if (videoPanelDriftGlowTimer) {
            clearTimeout(videoPanelDriftGlowTimer);
            videoPanelDriftGlowTimer = 0;
        }
        void panel.offsetWidth;
        panel.classList.add('video-panel--drift-glow');
        videoPanelDriftGlowTimer = setTimeout(() => {
            panel.classList.remove('video-panel--drift-glow');
            videoPanelDriftGlowTimer = 0;
        }, 900);
    }

    let playbackScrollPlayerStageRequested = false;

    function requestScrollToPlayerStageOnNextPlay() {
        playbackScrollPlayerStageRequested = true;
    }

    /** Space 等で再生開始するとき、Video + Markers（#playerStage）をビューポート上端へ。 */
    function scrollToPlayerStageOnPlaybackStart() {
        if (!playbackScrollPlayerStageRequested) return;
        playbackScrollPlayerStageRequested = false;
        const stage = document.getElementById('playerStage');
        if (!stage) return;
        requestAnimationFrame(() => {
            stage.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
        });
    }

    function flashTransportOptBox(which) {
        const sel =
            TRANSPORT_OPT_BOX_SELECTOR[which] || TRANSPORT_OPT_BOX_SELECTOR.playback;
        const box = document.querySelector(sel);
        if (!box) return;
        box.classList.remove('transport-opt-box--glow');
        if (transportOptGlowClearTimers[which]) {
            clearTimeout(transportOptGlowClearTimers[which]);
            transportOptGlowClearTimers[which] = 0;
        }
        void box.offsetWidth;
        box.classList.add('transport-opt-box--glow');
        transportOptGlowClearTimers[which] = setTimeout(() => {
            box.classList.remove('transport-opt-box--glow');
            transportOptGlowClearTimers[which] = 0;
        }, 900);
    }
