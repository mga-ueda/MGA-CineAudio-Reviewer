(function trackLaneFaderScaleModule() {
    const DB_MIN = -96;
    const DB_MAX = 10;
    const UNITY_POS = 0.7;
    const POS_MAX = 1000;
    const GAIN_MIN = Math.pow(10, DB_MIN / 20);
    const GAIN_MAX = Math.pow(10, DB_MAX / 20);

    function clampGainLinear(g) {
        const n = Number(g);
        if (!isFinite(n) || n <= 0) return GAIN_MIN;
        return Math.max(GAIN_MIN, Math.min(GAIN_MAX, n));
    }

    function linearGainToDb(g) {
        return 20 * Math.log10(clampGainLinear(g));
    }

    function linearGainFromDb(db) {
        const d = Math.max(DB_MIN, Math.min(DB_MAX, db));
        return Math.pow(10, d / 20);
    }

    function clampFaderPos(pos) {
        const n = Math.round(Number(pos));
        if (!isFinite(n)) return Math.round(POS_MAX * UNITY_POS);
        return Math.max(0, Math.min(POS_MAX, n));
    }

    function linearGainFromFaderPos(pos) {
        const p = clampFaderPos(pos) / POS_MAX;
        let db;
        if (p <= UNITY_POS) {
            db = DB_MIN + (p / UNITY_POS) * -DB_MIN;
        } else {
            db = ((p - UNITY_POS) / (1 - UNITY_POS)) * DB_MAX;
        }
        return linearGainFromDb(db);
    }

    function faderPosFromLinearGain(gain) {
        const db = linearGainToDb(gain);
        let p;
        if (db <= 0) {
            p = ((db - DB_MIN) / -DB_MIN) * UNITY_POS;
        } else {
            p = UNITY_POS + (db / DB_MAX) * (1 - UNITY_POS);
        }
        return clampFaderPos(Math.round(p * POS_MAX));
    }

    function formatDbValue(db) {
        if (db <= DB_MIN + 0.05) return '-96.0';
        if (db >= DB_MAX - 0.05) return '+10.0';
        if (Math.abs(db) < 0.05) return '0.0';
        const digits = Math.abs(db) >= 10 ? 0 : 1;
        const s = db.toFixed(digits);
        return db > 0 ? '+' + s : s;
    }

    function formatFaderDb(gain) {
        return formatDbValue(linearGainToDb(gain)) + ' dB';
    }

    window.trackLaneFormatDbValue = formatDbValue;

    window.trackLaneClampGainLinear = clampGainLinear;
    window.trackLaneLinearGainFromFaderPos = linearGainFromFaderPos;
    window.trackLaneFaderPosFromLinearGain = faderPosFromLinearGain;
    window.trackLaneFormatFaderDb = formatFaderDb;
    window.trackLaneClampFaderPos = clampFaderPos;
    window.TRACK_LANE_FADER_POS_UNITY = Math.round(POS_MAX * UNITY_POS);
    window.TRACK_LANE_FADER_POS_MAX = POS_MAX;
})();
