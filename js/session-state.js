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

    const LS_PREFS_KEY = 'cineaudio_reviewer_prefs_v1';
    const IDB_NAME = 'cineaudio_reviewer_session_v1';
    const IDB_STORE = 'kv';
    const IDB_KEY_LAST = 'lastSession';
    const IDB_VER = 1;

    let pendingRestoreTime = null;
    /** @type {{ videoLaneOpen?: boolean, extraLanesOpen?: boolean[] }|null} */
    let pendingLaneUiRestore = null;
    let persistSessionTimer = null;
    let sessionRestoreListenersArmed = false;

    const DISPLAY_FPS = 60;
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
