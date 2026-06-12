/**
 * waveform-lane-height-boot.js — 初回ペイント前に localStorage のトラック高さ倍率を :root へ適用。
 */
(function waveformLaneHeightBootModule() {
    var LS_PREFS_KEY = 'cineaudio_reviewer_prefs_v1';
    var MIN = 1;
    var MAX = 4;
    var STEP = 0.25;

    function snapScale(scale) {
        var n = Number(scale);
        if (!isFinite(n)) return MIN;
        n = Math.max(MIN, Math.min(MAX, n));
        var steps = Math.round((n - MIN) / STEP);
        return MIN + steps * STEP;
    }

    try {
        var raw = localStorage.getItem(LS_PREFS_KEY);
        if (!raw) return;
        var p = JSON.parse(raw);
        if (!p || typeof p !== 'object') return;
        var scale =
            typeof p.waveformLaneHeightScale === 'number' ? p.waveformLaneHeightScale : MIN;
        document.documentElement.style.setProperty(
            '--wave-lane-height-scale',
            String(snapScale(scale)),
        );
    } catch (_) {}
})();
