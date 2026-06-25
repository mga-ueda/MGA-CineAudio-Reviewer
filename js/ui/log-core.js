/**
 * log-core.js — ログの tier / category / 表示形式の共通定義。
 *
 * tier:
 *   action — ユーザー操作の結果（Ops Only で表示）
 *   detail — 操作の内部步骤（通常ログに表示、Ops Only では非表示）
 *   diag   — 診断（DEBUG_LOG 有効時のみ writeDiagLog 経由で記録）
 *   meta   — ログ UI 自身・起動メッセージ等
 */
(function logCoreModule() {
    /** @typedef {'action'|'detail'|'diag'|'meta'} LogTier */
    /** @typedef {'info'|'warn'|'error'} LogLevel */

    const LOG_CATEGORY_WIDTH = 8;

    const LOG_DIAG_CATEGORY = {
        REGION_RESTORE: 'Restore',
        REGION_SNAP: 'RgSnap',
        MUSICAL_SLOT: 'Musical',
        WAVEFORM_VIEWPORT: 'Viewport',
        VIDEO_ANALYZER: 'VideoAnz',
        KEY_PLAYBACK: 'KeyPlay',
        TEMPO_STRETCH: 'Tempo',
        SILENT_GAP_DELETE: 'Silent',
        IXML: 'iXML',
        MUSICAL_TRACK_PERSIST: 'MusTrk',
        REGION_BAR_JUMP: 'BarJump',
        GRID_ALIGN: 'GridAln',
        MARKER_POINTER: 'MrkPtr',
    };

    const LEGACY_LOG_RULES = [
        { re: /^\[RegionSnap\]/i, tier: 'diag', category: 'RgSnap' },
        { re: /^\[MusicalSlot\]/i, tier: 'diag', category: 'Musical' },
        { re: /^\[WaveformViewport\]/i, tier: 'diag', category: 'Viewport' },
        { re: /^\[TempoStretch/i, tier: 'diag', category: 'Tempo' },
        { re: /^\[KeyPlayback\]/i, tier: 'diag', category: 'KeyPlay' },
        { re: /^\[RegionRestore\]/i, tier: 'diag', category: 'Restore' },
        { re: /^\[SilentGapDel\]/i, tier: 'diag', category: 'Silent' },
        { re: /^\[VideoAnalyzer\]/i, tier: 'diag', category: 'VideoAnz' },
        { re: /^\[iXML\]/i, tier: 'diag', category: 'iXML' },
        { re: /^\[MusicalTrack\]/i, tier: 'diag', category: 'MusTrk' },
        { re: /^\[RehearsalMark\]/i, tier: 'diag', category: 'MusTrk' },
        { re: /^\[RegionBarJump\]/i, tier: 'diag', category: 'BarJump' },
        { re: /^\[GridAlign\]/i, tier: 'diag', category: 'GridAln' },
        { re: /^\[MarkerPtr\]/i, tier: 'diag', category: 'MrkPtr' },
        { re: /^\[WAV INFO\]/i, tier: 'diag', category: 'iXML' },
        { re: /^\[BWF bext\]/i, tier: 'diag', category: 'iXML' },
        { re: /^\[AXML\]/i, tier: 'diag', category: 'iXML' },
        { re: /^swapped .+ ↔ /i, tier: 'action', category: 'Region' },
        { re: /^undo — /i, tier: 'action', category: 'Region' },
        { re: /^redo — /i, tier: 'action', category: 'Region' },
        { re: /^undo — /i, tier: 'action', category: 'MusicalGrid' },
        { re: /^redo — /i, tier: 'action', category: 'MusicalGrid' },
        { re: /^split at /i, tier: 'action', category: 'Region' },
        { re: /^joined /i, tier: 'action', category: 'Region' },
        { re: /^gain /i, tier: 'action', category: 'Region' },
        { re: /^key /i, tier: 'action', category: 'Region' },
        { re: /^Ex\d+ R\d+/i, tier: 'action', category: 'Region' },
        { re: /^removed (?:point|range) at /i, tier: 'action', category: 'Marker' },
        { re: /^point at /i, tier: 'action', category: 'Marker' },
        { re: /^range /i, tier: 'action', category: 'Marker' },
        { re: /^loaded "/i, tier: 'action', category: 'ExAudio' },
        { re: /^ready \("/i, tier: 'action', category: 'Video' },
        { re: /^cleared "/i, tier: 'action', category: 'Video' },
        { re: /^Video Audio /i, tier: 'action', category: 'Mix' },
        { re: /^Ex\d+ (?:solo|muted|unmuted)/i, tier: 'action', category: 'Mix' },
        { re: /^undo — /i, tier: 'action', category: 'Rehearsal' },
        { re: /^redo — /i, tier: 'action', category: 'Rehearsal' },
        { re: /^(?:added|changed|deleted|moved) (?:tempo|signature)/i, tier: 'action', category: 'MusicalGrid' },
        { re: /^inserted rehearsal mark /i, tier: 'action', category: 'Rehearsal' },
        { re: /^(?:deleted|moved|renamed) rehearsal mark /i, tier: 'action', category: 'Rehearsal' },
        { re: /^grouped \d+ region/i, tier: 'action', category: 'Region' },
        { re: /^ungrouped \d+ group/i, tier: 'action', category: 'Region' },
        { re: /^split Ex\d+/i, tier: 'action', category: 'Region' },
        { re: /^video split:/i, tier: 'action', category: 'Region' },
        { re: /^moved to seekbar /i, tier: 'action', category: 'Region' },
        { re: /^(?:Fade In|Fade Out) at seekbar /i, tier: 'action', category: 'Region' },
        { re: /^(?:In|Out) nudge /i, tier: 'action', category: 'Region' },
        { re: /^Ex\d+ laid out to Rehearsal/i, tier: 'action', category: 'Region' },
        { re: /^Import\s+completed/i, tier: 'action', category: 'Import' },
        { re: /^Import\s+(?:failed|rejected)/i, tier: 'action', category: 'Import' },
        { re: /^Export\s+completed/i, tier: 'action', category: 'Export' },
        { re: /^Export\s+failed/i, tier: 'action', category: 'Export' },
        { re: /^Wave failed —/i, tier: 'action', category: 'Export' },
        { re: /^WebM failed —/i, tier: 'action', category: 'Export' },
        { re: /^Import Review: completed/i, tier: 'action', category: 'Import' },
        { re: /^Import Review: (?:failed|rejected|cancelling)/i, tier: 'action', category: 'Import' },
        { re: /^Import Review:/i, tier: 'detail', category: 'Import' },
        { re: /^Export Review: completed/i, tier: 'action', category: 'Export' },
        { re: /^Export Review: output file "/i, tier: 'action', category: 'Export' },
        { re: /^Export Review: (?:failed|rejected)/i, tier: 'action', category: 'Export' },
        { re: /^Export Review:/i, tier: 'detail', category: 'Export' },
        { re: /^Export Wave: (?:completed|saved|cancelled|failed)/i, tier: 'action', category: 'Export' },
        { re: /^Export Wave:/i, tier: 'detail', category: 'Export' },
        { re: /^Export WebM: (?:completed|saved|cancelled|failed)/i, tier: 'action', category: 'Export' },
        { re: /^Export WebM:/i, tier: 'detail', category: 'Export' },
        {
            re: /^Session: (?:persist|periodic saved stamp|restore rgn|extra tracks layout saved|saved stamp|skip persist|persisted \(tab)/i,
            tier: 'detail',
            category: 'Session',
        },
        {
            re: /^Session: (?:all cleared|All Clear failed|rejected\b|save failed|read failed|nothing to clear)/i,
            tier: 'action',
            category: 'Session',
        },
        { re: /^all cleared\b/i, tier: 'action', category: 'Session' },
        { re: /^All Clear failed —/i, tier: 'action', category: 'Session' },
        { re: /^Restoring |^Restored audio-only session|^Extra audio restore:/i, tier: 'detail', category: 'Import' },
        {
            re: /^Extra audio \d+: (?:decoding|loaded|waveform preview|restore decode|restore payload|still decoding|could not decode|file too large|restore aborted|load superseded)/i,
            tier: 'detail',
            category: 'ExAudio',
        },
        { re: /^Video: cleared\b/i, tier: 'action', category: 'Video' },
        { re: /^Video load: ready\b/i, tier: 'action', category: 'Video' },
        { re: /^Video:/i, tier: 'detail', category: 'Video' },
        {
            re: /^Playback region: (?:swapped|undo|redo|pruned|joined|bonded|gain |key )/i,
            tier: 'action',
            category: 'Region',
        },
        { re: /^pruned \d+ undo/i, tier: 'action', category: 'Region' },
        { re: /^Playback region:/i, tier: 'detail', category: 'Region' },
        { re: /^Ex \d+ region \d+ (?:gain|key):/i, tier: 'action', category: 'Region' },
        { re: /^Ex \d+ key ready\b/i, tier: 'action', category: 'Region' },
        {
            re: /^Ex \d+: (?:region reset|all regions removed|track lane opened|regions: off)/i,
            tier: 'action',
            category: 'Region',
        },
        { re: /^Tempo stretch: begin\b/i, tier: 'action', category: 'Tempo' },
        { re: /^Tempo stretch (?:applied|cleared)/i, tier: 'action', category: 'Tempo' },
        { re: /^begin — (?:lowered|raised|no tempo)/i, tier: 'action', category: 'Tempo' },
        { re: /^(?:applied|cleared) — (?:lowered|raised|was |no tempo)/i, tier: 'action', category: 'Tempo' },
        { re: /^Tempo stretch failed/i, tier: 'action', category: 'Tempo' },
        {
            re: /^Marker: (?:point at|range |removed|all cleared|pasted|copied to|paste started|TC updated|drag )/i,
            tier: 'action',
            category: 'Marker',
        },
        { re: /^Markers: hidden/i, tier: 'action', category: 'Marker' },
        { re: /^Marker:/i, tier: 'detail', category: 'Marker' },
        { re: /^Rehearsal: (?:undo|redo|compressed)/i, tier: 'action', category: 'Rehearsal' },
        { re: /^Rehearsal boundary /i, tier: 'action', category: 'Rehearsal' },
        { re: /^Rehearsal [A-Z]{1,2} (?:absorbed into|merged)/i, tier: 'action', category: 'Rehearsal' },
        { re: /^Rehearsal:/i, tier: 'detail', category: 'Rehearsal' },
        { re: /^Musical Grid: (?:ON|OFF)/i, tier: 'action', category: 'Rehearsal' },
        { re: /^Rehearsal tint: (?:ON|OFF)/i, tier: 'action', category: 'Rehearsal' },
        { re: /^Rehearsal tint: (?:ON|OFF)/i, tier: 'action', category: 'Rehearsal' },
        { re: /^Layout: /i, tier: 'action', category: 'Layout' },
        { re: /^(?:All Clear|Video Clear|Markers Clear|Markers Paste): (?:confirm|cancelled)/i, tier: 'action', category: 'Dialog' },
        { re: /^Video audio: /i, tier: 'action', category: 'Mix' },
        { re: /^Extra audio \d+: (?:solo|muted|unmuted|cleared)/i, tier: 'action', category: 'Mix' },
        { re: /^Extra audio: maximum track count/i, tier: 'action', category: 'ExAudio' },
        { re: /^Extra audio:/i, tier: 'detail', category: 'ExAudio' },
        { re: /^Playback: (?:loop restart|end reached)/i, tier: 'action', category: 'Transport' },
        { re: /^Transport:/i, tier: 'detail', category: 'Transport' },
        { re: /^Region group cleared/i, tier: 'action', category: 'Region' },
        { re: /^Waveform: seek at/i, tier: 'detail', category: 'Waveform' },
        { re: /^Seek bar: scrub to/i, tier: 'detail', category: 'Transport' },
        { re: /^Log (?:copied|download|Debug)/i, tier: 'meta', category: 'Log' },
        { re: /^Debug Log (?:enabled|disabled)/i, tier: 'meta', category: 'Log' },
        { re: /^Test output: sample/i, tier: 'meta', category: 'Log' },
        { re: /^MGA CineAudio Reviewer started/i, tier: 'meta', category: 'System' },
        { re: /^Keyboard: Space -> transport toggle/i, tier: 'detail', category: 'Transport' },
    ];

    function padLogCategory(label) {
        const s = label != null ? String(label) : 'System';
        if (s.length >= LOG_CATEGORY_WIDTH) return s.slice(0, LOG_CATEGORY_WIDTH);
        return s + ' '.repeat(LOG_CATEGORY_WIDTH - s.length);
    }

    function formatLogTime(date) {
        const d = date instanceof Date ? date : new Date();
        return (
            String(d.getHours()).padStart(2, '0') +
            ':' +
            String(d.getMinutes()).padStart(2, '0') +
            ':' +
            String(d.getSeconds()).padStart(2, '0')
        );
    }

    function stripLegacyLevelTag(message) {
        return String(message).replace(/^\[(?:Warning|Error)\]\s+/i, '');
    }

    function inferLegacyLogMeta(message, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.tier === 'action' || o.tier === 'detail' || o.tier === 'diag' || o.tier === 'meta') {
            return {
                tier: o.tier,
                category: o.category ? String(o.category) : 'System',
            };
        }
        if (o.opsSummary === true) {
            return { tier: 'action', category: o.category ? String(o.category) : 'System' };
        }
        const body = stripLegacyLevelTag(String(message));
        for (let i = 0; i < LEGACY_LOG_RULES.length; i++) {
            const rule = LEGACY_LOG_RULES[i];
            if (rule.re.test(body)) {
                return { tier: rule.tier, category: rule.category };
            }
        }
        return { tier: 'detail', category: 'System' };
    }

    function createLogEntry(message, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const now = new Date();
        const meta = inferLegacyLogMeta(message, o);
        const level =
            o.level === 'info' || o.level === 'warn' || o.level === 'error'
                ? o.level
                : typeof window.classifyLogLevel === 'function'
                  ? window.classifyLogLevel(message, o)
                  : 'info';
        return {
            timeMs: now.getTime(),
            time: formatLogTime(now),
            tier: meta.tier,
            category: padLogCategory(meta.category),
            message: stripLegacyLevelTag(String(message)),
            level,
        };
    }

    function formatLogEntryPlainText(entry) {
        if (!entry) return '';
        const levelTag =
            entry.level === 'warn' ? '[Warning] ' : entry.level === 'error' ? '[Error] ' : '';
        return (
            '[' +
            (entry.time || formatLogTime(new Date(entry.timeMs || Date.now()))) +
            '] ' +
            entry.category +
            ' ' +
            levelTag +
            entry.message
        );
    }

    function normalizeStoredLogEntry(raw) {
        if (raw && typeof raw === 'object' && raw.message != null) {
            return {
                timeMs: Number.isFinite(raw.timeMs) ? raw.timeMs : Date.now(),
                time: raw.time || formatLogTime(new Date(raw.timeMs || Date.now())),
                tier: raw.tier || 'detail',
                category: padLogCategory(raw.category || 'System'),
                message: stripLegacyLevelTag(String(raw.message)),
                level: raw.level || 'info',
            };
        }
        if (raw && typeof raw === 'object' && raw.text != null) {
            const parsed = parseLegacyPlainLogLine(String(raw.text));
            if (parsed) return parsed;
        }
        const text = raw && raw.text != null ? String(raw.text) : String(raw);
        const parsed = parseLegacyPlainLogLine(text);
        if (parsed) return parsed;
        return createLogEntry(text, raw && typeof raw === 'object' ? raw : undefined);
    }

    function parseLegacyPlainLogLine(text) {
        const structured = /^\[(\d{2}:\d{2}:\d{2})\]\s+(\S+)\s+([\s\S]*)$/.exec(String(text));
        if (structured) {
            const body = stripLegacyLevelTag(structured[3]);
            let level = 'info';
            if (/^\[Warning\]\s/i.test(structured[3])) level = 'warn';
            else if (/^\[Error\]\s/i.test(structured[3])) level = 'error';
            const meta = inferLegacyLogMeta(body, {});
            return {
                timeMs: Date.now(),
                time: structured[1],
                tier: meta.tier,
                category: padLogCategory(meta.category || structured[2]),
                message: body,
                level,
            };
        }
        const legacy = /^\[(\d{2}:\d{2}:\d{2})\]\s+-\s+([\s\S]*)$/.exec(String(text));
        if (legacy) {
            const body = stripLegacyLevelTag(legacy[2]);
            let level = 'info';
            if (/^\[Warning\]\s/i.test(legacy[2])) level = 'warn';
            else if (/^\[Error\]\s/i.test(legacy[2])) level = 'error';
            const meta = inferLegacyLogMeta(body, {});
            return {
                timeMs: Date.now(),
                time: legacy[1],
                tier: meta.tier,
                category: padLogCategory(meta.category),
                message: body,
                level,
            };
        }
        return null;
    }

    function isLogEntryVisibleInOpsFilter(entry) {
        if (!entry) return false;
        if (entry.level === 'warn' || entry.level === 'error') return true;
        return entry.tier === 'action';
    }

    function writeActionLog(category, message, opt) {
        if (typeof window.appendLogEntry !== 'function') return;
        const o = Object.assign({}, opt, { tier: 'action', category: category });
        window.appendLogEntry(message, o);
    }

    function writeDetailLog(category, message, opt) {
        if (typeof window.appendLogEntry !== 'function') return;
        const o = Object.assign({}, opt, { tier: 'detail', category: category });
        window.appendLogEntry(message, o);
    }

    function writeMetaLog(category, message, opt) {
        if (typeof window.appendLogEntry !== 'function') return;
        const o = Object.assign({}, opt, { tier: 'meta', category: category });
        window.appendLogEntry(message, o);
    }

    function writeDiagLog(categoryKey, step, detail) {
        if (typeof window.isDebugLogCategoryEnabled === 'function') {
            if (!window.isDebugLogCategoryEnabled(categoryKey)) return;
        }
        if (typeof window.appendLogEntry !== 'function') return;
        const label = LOG_DIAG_CATEGORY[categoryKey] || 'Diag';
        let tail = '';
        if (detail != null) {
            try {
                tail = ' | ' + JSON.stringify(detail);
            } catch (_) {
                tail = ' | ' + String(detail);
            }
        }
        window.appendLogEntry(String(step) + tail, {
            tier: 'diag',
            category: label,
        });
    }

    window.LOG_CATEGORY_WIDTH = LOG_CATEGORY_WIDTH;
    window.createLogEntry = createLogEntry;
    window.normalizeStoredLogEntry = normalizeStoredLogEntry;
    window.formatLogEntryPlainText = formatLogEntryPlainText;
    window.inferLegacyLogMeta = inferLegacyLogMeta;
    window.isLogEntryVisibleInOpsFilter = isLogEntryVisibleInOpsFilter;
    window.writeActionLog = writeActionLog;
    window.writeDetailLog = writeDetailLog;
    window.writeMetaLog = writeMetaLog;
    window.writeDiagLog = writeDiagLog;
})();
