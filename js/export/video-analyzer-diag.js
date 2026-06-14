/**
 * video-analyzer-diag.js — 動画モニタータップ / Analyze 診断ログ
 * constants.js の DEBUG_LOG.VIDEO_ANALYZER が true のときのみ出力
 */
(function videoAnalyzerDiagModule() {
    const LOG_PREFIX = '[VideoAnalyzer] ';
    let lastConnectedKey = '';
    let lastConnectedAt = 0;

    function enabled() {
        return (
            typeof window.isDebugLogCategoryEnabled === 'function' &&
            window.isDebugLogCategoryEnabled('VIDEO_ANALYZER')
        );
    }

    function fmtDetail(detail) {
        if (detail == null) return '';
        try {
            return JSON.stringify(detail);
        } catch (_) {
            return String(detail);
        }
    }

    function log(stage, detail) {
        if (!enabled() || typeof writeLog !== 'function') return;
        const tail = detail != null ? ' | ' + fmtDetail(detail) : '';
        writeLog(LOG_PREFIX + stage + tail);
    }

    /** 同一 URL・非 recapture の connected は短時間に 1 回だけ */
    window.videoAnalyzerDiagShouldLogConnected = function (detail) {
        const snap = detail && detail.snap;
        const url = snap && snap.url ? snap.url : '';
        const key = url + '|' + String(snap && snap.rs) + '|' + String(snap && snap.t);
        const now = Date.now();
        if (key === lastConnectedKey && now - lastConnectedAt < 2500) {
            return false;
        }
        lastConnectedKey = key;
        lastConnectedAt = now;
        return true;
    };

    window.videoAnalyzerDiagReset = function () {
        lastConnectedKey = '';
        lastConnectedAt = 0;
    };

    window.videoAnalyzerDiagLog = log;
})();
