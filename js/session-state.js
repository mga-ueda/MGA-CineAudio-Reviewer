/**
 * session-state.js — 共有セッション状態（動画 blob URL・シーク・トランスポート時計・復元待ち位置）。
 */
    let urlMain = null;
    let fileMain = null;
    let isSeeking = false;
    let dragHoverDepth = 0;
    let lastArrowSeekLogAt = 0;
    let lastSeekBarInputLogAt = 0;
    let lastSeekFlashScrubAt = 0;
    let rafId = 0;
    let transportPlayInFlight = null;
    let transportPlayGeneration = 0;

    let pendingRestoreTime = null;
    /** 直近の再生開始位置（Alt+Enter でここから再生し直す）。未再生時は null。 */
    let transportPlaybackStartSec = null;
    /** @type {{ videoLaneOpen?: boolean, extraLanesOpen?: boolean[] }|null} */
    let pendingLaneUiRestore = null;
    let persistSessionTimer = null;
    let sessionRestoreListenersArmed = false;
    let sessionRestoreInProgress = false;

    let masterFrameSec = 1 / DISPLAY_FPS;

    const containerFps = { main: null };
    const containerSampleCount = { main: null };
    const containerStszSampleCount = { main: null };
    const containerTimelineFrameOffset = { main: 0 };
    const containerMediaDurationSec = { main: null };
    const containerHasAudio = { main: null };

    function isTypingTarget(el) {
        if (!el || !el.nodeName) return false;
        const n = el.nodeName;
        if (n === 'TEXTAREA' || n === 'SELECT') return true;
        if (n === 'INPUT') {
            const t = (el.type || '').toLowerCase();
            if (t === 'range') return false;
            return true;
        }
        return el.isContentEditable === true;
    }

    window.isTypingTarget = isTypingTarget;
