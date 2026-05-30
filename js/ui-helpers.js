/**
 * ui-helpers.js — UI 補助（トランスポートオプションの glow、レーンステータス文言、シークヒント）。
 */
    const transportOptGlowClearTimers = { playback: 0, centerLock: 0, analyze: 0 };
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
        playback:
            '.transport-bar--playback .transport-opt-box--playback, .transport-opt-box--playback',
        centerLock:
            '.transport-bar .playhead-center-lock-options.transport-opt-chip, .playhead-center-lock-options.transport-opt-chip',
        analyze:
            '.transport-bar #analyzeToggleWrap.transport-opt-chip, #analyzeToggleWrap.transport-opt-chip',
    };

    function flashVideoPanelDrift() {
        if (!panelMain) return;
        panelMain.classList.remove('video-panel--drift-glow');
        if (videoPanelDriftGlowTimer) {
            clearTimeout(videoPanelDriftGlowTimer);
            videoPanelDriftGlowTimer = 0;
        }
        void panelMain.offsetWidth;
        panelMain.classList.add('video-panel--drift-glow');
        videoPanelDriftGlowTimer = setTimeout(() => {
            panelMain.classList.remove('video-panel--drift-glow');
            videoPanelDriftGlowTimer = 0;
        }, 900);
    }

    function flashTransportOptBox(which) {
        const sel =
            TRANSPORT_OPT_BOX_SELECTOR[which] || TRANSPORT_OPT_BOX_SELECTOR.playback;
        const box = document.querySelector(sel);
        if (!box) return;
        const glowClass = box.classList.contains('transport-opt-box')
            ? 'transport-opt-box--glow'
            : 'transport-opt-chip--glow';
        box.classList.remove('transport-opt-box--glow', 'transport-opt-chip--glow');
        if (transportOptGlowClearTimers[which]) {
            clearTimeout(transportOptGlowClearTimers[which]);
            transportOptGlowClearTimers[which] = 0;
        }
        void box.offsetWidth;
        box.classList.add(glowClass);
        transportOptGlowClearTimers[which] = setTimeout(() => {
            box.classList.remove(glowClass);
            transportOptGlowClearTimers[which] = 0;
        }, 900);
    }

    let altKeySnapSuppressed = false;

    /** Alt 押下中はタイムライン／マーカー／リージョン等のスナップを無効化 */
    function isSnapSuppressedByAlt(opt) {
        if (opt && opt.altKey) return true;
        if (opt && opt.noSnap) return true;
        return altKeySnapSuppressed;
    }

    function setAltKeySnapSuppressed(v) {
        altKeySnapSuppressed = !!v;
    }

    function syncSnapSuppressionFromPointerEvent(ev) {
        if (!ev) return;
        if (typeof ev.getModifierState === 'function') {
            altKeySnapSuppressed = ev.getModifierState('Alt');
        } else if ('altKey' in ev) {
            altKeySnapSuppressed = !!ev.altKey;
        }
    }

    /** 明示シーク後のトランスポート UI（タイムコード・プレイヘッド・ループ／マーカーオーバーレイ） */
    function syncTransportSeekUi(t, opt) {
        if (!Number.isFinite(t)) return;
        if (typeof setTransportSec === 'function') {
            setTransportSec(t);
        } else if (typeof seekBar !== 'undefined' && seekBar) {
            seekBar.value = String(t);
        }
        if (typeof currentTimeEl !== 'undefined' && currentTimeEl) {
            if (typeof formatTimecodeForTransport === 'function') {
                currentTimeEl.textContent = formatTimecodeForTransport(t);
            }
        }
        if (typeof updateTimecodeOverlay === 'function') updateTimecodeOverlay();
        if (typeof updateAllWaveformPlayheads === 'function') updateAllWaveformPlayheads();
        if (typeof updateRangeLoopOverlay === 'function') updateRangeLoopOverlay();
        if (typeof updateMarkerCommentOverlay === 'function') {
            updateMarkerCommentOverlay();
        } else if (opt && opt.markerHighlight && typeof updateTransportMarkerHighlight === 'function') {
            updateTransportMarkerHighlight(t);
        }
    }

    window.isSnapSuppressedByAlt = isSnapSuppressedByAlt;
    window.setAltKeySnapSuppressed = setAltKeySnapSuppressed;
    window.syncSnapSuppressionFromPointerEvent = syncSnapSuppressionFromPointerEvent;
    window.syncTransportSeekUi = syncTransportSeekUi;
