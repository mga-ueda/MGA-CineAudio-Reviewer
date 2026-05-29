/**
 * track-lane-fader-scale.js — トラックフェーダー用 dB ↔ 線形ゲイン変換（スライダーカーブ）。
 */
(function trackLaneFaderScaleModule() {
    /** MGA-Layer-Music-Checker getPracticalGain と同一: スライダー正規化位置 → 線形ゲイン（0 dB 以下） */
    const FADER_GAIN_EXPONENT = 1.5;
    const FADER_GAIN_UNITY_LINEAR = 1;

    const DB_MIN = -96;
    const DB_BOOST_MAX = 20;
    const DB_MAX = DB_BOOST_MAX;
    const POS_MAX = 1000;
    /** 0 dB（線形ゲイン 1.0）のフェーダー位置。右端は +DB_BOOST_MAX dB */
    const POS_UNITY = Math.round((POS_MAX * -DB_MIN) / (-DB_MIN + DB_BOOST_MAX));
    const GAIN_MIN = Math.pow(10, DB_MIN / 20);
    const GAIN_MAX = Math.pow(10, DB_BOOST_MAX / 20);

    function practicalGainFromNormalizedPos(p) {
        const x = Number(p);
        if (!isFinite(x) || x <= 0) return 0;
        return Math.pow(Math.min(1, x), FADER_GAIN_EXPONENT);
    }

    function normalizedPosFromPracticalGain(gain) {
        const g = Number(gain);
        if (!isFinite(g) || g <= 0) return 0;
        if (g >= FADER_GAIN_UNITY_LINEAR) return 1;
        return Math.pow(g, 1 / FADER_GAIN_EXPONENT);
    }

    function clampGainLinear(g) {
        const n = Number(g);
        if (!isFinite(n) || n < 0) return 0;
        if (n === 0) return 0;
        return Math.min(GAIN_MAX, n);
    }

    function linearGainToDb(g) {
        const n = Number(g);
        if (!isFinite(n) || n <= 0) return DB_MIN;
        return 20 * Math.log10(n);
    }

    function linearGainFromDb(db) {
        const d = Math.max(DB_MIN, Math.min(DB_MAX, db));
        return Math.pow(10, d / 20);
    }

    function clampFaderPos(pos) {
        const n = Math.round(Number(pos));
        if (!isFinite(n)) return POS_UNITY;
        return Math.max(0, Math.min(POS_MAX, n));
    }

    function linearGainFromFaderPos(pos) {
        const p = clampFaderPos(pos);
        if (p <= POS_UNITY) {
            const norm = POS_UNITY > 0 ? p / POS_UNITY : 0;
            const g = practicalGainFromNormalizedPos(norm);
            if (g <= 0) return 0;
            return clampGainLinear(g);
        }
        const t = (p - POS_UNITY) / (POS_MAX - POS_UNITY);
        const db = t * DB_BOOST_MAX;
        return clampGainLinear(Math.pow(10, db / 20));
    }

    function faderPosFromLinearGain(gain) {
        const g = Number(gain);
        if (!isFinite(g) || g <= 0) return 0;
        if (g <= FADER_GAIN_UNITY_LINEAR) {
            const p = normalizedPosFromPracticalGain(g);
            return clampFaderPos(Math.round(p * POS_UNITY));
        }
        const db = Math.min(DB_BOOST_MAX, linearGainToDb(g));
        const t = DB_BOOST_MAX > 0 ? db / DB_BOOST_MAX : 0;
        return clampFaderPos(Math.round(POS_UNITY + t * (POS_MAX - POS_UNITY)));
    }

    function formatDbValue(db) {
        if (db <= DB_MIN + 0.05) return '-96.0';
        if (db >= DB_MAX - 0.05) return '+20.0';
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
    window.trackLaneLinearGainToDb = linearGainToDb;
    window.trackLaneLinearGainFromDb = linearGainFromDb;
    window.trackLaneLinearGainFromFaderPos = linearGainFromFaderPos;
    window.trackLaneFaderPosFromLinearGain = faderPosFromLinearGain;
    window.trackLaneFormatFaderDb = formatFaderDb;
    window.trackLaneClampFaderPos = clampFaderPos;
    window.trackLanePracticalGainFromNormalizedPos = practicalGainFromNormalizedPos;
    window.TRACK_LANE_FADER_POS_UNITY = POS_UNITY;
    window.TRACK_LANE_FADER_POS_MAX = POS_MAX;
})();
