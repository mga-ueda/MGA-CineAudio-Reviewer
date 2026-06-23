/**
 * musical-track-persist-diag.js — Musical トラック（Rehearsal / Tempo / Signature）の保存・復元診断
 * constants.js の DEBUG_LOG.MUSICAL_TRACK_PERSIST が true のときのみ出力
 */
(function musicalTrackPersistDiagModule() {
    const LOG_PREFIX = '[MusicalTrack] ';

    function enabled() {
        return (
            typeof window.isDebugLogCategoryEnabled === 'function' &&
            window.isDebugLogCategoryEnabled('MUSICAL_TRACK_PERSIST')
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
        if (!enabled()) return;
        if (typeof writeDiagLog === 'function') {
            writeDiagLog('MUSICAL_TRACK_PERSIST', stage, detail);
            return;
        }
        if (typeof writeLog !== 'function') return;
        const tail = detail != null ? ' | ' + fmtDetail(detail) : '';
        writeLog(LOG_PREFIX + stage + tail);
    }

    function summarizeRehearsalEvents(raw, maxItems) {
        const limit = maxItems != null ? maxItems | 0 : 6;
        if (!Array.isArray(raw)) return { count: 0, sample: [] };
        const sample = [];
        for (let i = 0; i < raw.length && i < limit; i++) {
            const e = raw[i];
            if (!e || typeof e !== 'object') continue;
            sample.push({
                sec: Number(e.sec),
                label: e.label != null ? String(e.label) : '',
            });
        }
        return { count: raw.length, sample: sample };
    }

    function summarizeTempoEvents(raw, maxItems) {
        const limit = maxItems != null ? maxItems | 0 : 6;
        if (!Array.isArray(raw)) return { count: 0, sample: [] };
        const sample = [];
        for (let i = 0; i < raw.length && i < limit; i++) {
            const e = raw[i];
            if (!e || typeof e !== 'object') continue;
            sample.push({
                sec: Number(e.sec),
                bpm: Number(e.bpm),
            });
        }
        return { count: raw.length, sample: sample };
    }

    function formatSigSample(sig) {
        if (!sig || typeof sig !== 'object') return '';
        if (typeof formatMeterSigText === 'function') {
            return formatMeterSigText(sig);
        }
        const num = Number(sig.num);
        const den = Number(sig.den);
        if (Number.isFinite(num) && Number.isFinite(den)) return num + '/' + den;
        return '';
    }

    function summarizeSignatureEvents(raw, maxItems) {
        const limit = maxItems != null ? maxItems | 0 : 6;
        if (!Array.isArray(raw)) return { count: 0, sample: [] };
        const sample = [];
        for (let i = 0; i < raw.length && i < limit; i++) {
            const e = raw[i];
            if (!e || typeof e !== 'object') continue;
            sample.push({
                barIndex: Number(e.barIndex != null ? e.barIndex : e.bar),
                sig: formatSigSample(e.sig),
            });
        }
        return { count: raw.length, sample: sample };
    }

    function liveState() {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const meter =
            typeof getCommittedMusicalGridMeterText === 'function'
                ? getCommittedMusicalGridMeterText()
                : '';
        const rehearsalSnap =
            typeof getRehearsalMarkTrackEventsPersistSnapshot === 'function'
                ? getRehearsalMarkTrackEventsPersistSnapshot()
                : [];
        const rehearsalInternal =
            typeof getRehearsalMarkTrackEventsDiagState === 'function'
                ? getRehearsalMarkTrackEventsDiagState()
                : null;
        const tempoSigInternal =
            typeof getTempoSignatureTrackEventsDiagState === 'function'
                ? getTempoSignatureTrackEventsDiagState()
                : null;
        return {
            masterSec: master,
            meter: meter,
            rehearsal: Object.assign(
                { snapshot: summarizeRehearsalEvents(rehearsalSnap) },
                rehearsalInternal || {},
            ),
            tempoSignature: tempoSigInternal || {},
        };
    }

    window.musicalTrackPersistDiagLog = log;
    window.musicalTrackPersistDiagSummarizeRehearsalEvents = summarizeRehearsalEvents;
    window.musicalTrackPersistDiagSummarizeTempoEvents = summarizeTempoEvents;
    window.musicalTrackPersistDiagSummarizeSignatureEvents = summarizeSignatureEvents;
    window.musicalTrackPersistDiagLiveState = liveState;

    /** @deprecated 後方互換 */
    window.rehearsalMarkPersistDiagLog = log;
    window.rehearsalMarkPersistDiagSummarizeEvents = summarizeRehearsalEvents;
    window.rehearsalMarkPersistDiagLiveState = liveState;
})();
