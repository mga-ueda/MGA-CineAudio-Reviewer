/**
 * musical-grid-meter.js — Tempo / Signature トラックと meterSpec（ランタイム拍子モデル）
 */
    const musicalGridVisibleCheckbox = document.getElementById('musicalGridVisibleCheckbox');
    const musicalGridCanvas =
        typeof audioWaveformMusicalGrid !== 'undefined' && audioWaveformMusicalGrid
            ? audioWaveformMusicalGrid
            : document.getElementById('audioWaveformMusicalGrid');
    /** Tempo / Signature トラックから合成されるランタイム拍子定義（唯一の計算用モデル） */
    let committedMeterSpec = null;
    let musicalGridRehearsalText = '';
    let musicalGridVisible = true;
    let musicalGridRehearsalFillVisible = false;
    let musicalGridPosCache = null;
    let musicalGridNavStopsCache = null;
    let musicalGridNavStopsCacheKey = '';
    /** RegionSwap 等で展開 counts を直接保持（Rehearsal 欄テキストは spec サイクルのまま） */
    let rehearsalGroupBarCountsOverride = null;
    const rehearsalUndoStack = [];
    function clearRehearsalGroupBarCountsOverride() {
        rehearsalGroupBarCountsOverride = null;
    }
    function setRehearsalGroupBarCountsOverride(counts) {
        if (!counts || !counts.length) {
            clearRehearsalGroupBarCountsOverride();
            return;
        }
        rehearsalGroupBarCountsOverride = counts.map((n) => n | 0);
    }
    /** 展開 counts — override 優先、なければ rehearsalSpec から展開 */
    function resolveRehearsalGroupBarCounts(meterSpec, durationSec, rehearsalSpec) {
        if (rehearsalGroupBarCountsOverride && rehearsalGroupBarCountsOverride.length) {
            return rehearsalGroupBarCountsOverride.slice();
        }
        if (!rehearsalSpec) return [];
        return expandRehearsalSpecToGroupBarCounts(meterSpec, durationSec, rehearsalSpec);
    }
    /** Rehearsal 欄 API — [MusicalSlot] rehearsal/* ログ */
    function rehearsalSwapDiagLog(stage, extra) {
        if (typeof window !== 'undefined' && typeof window.musicalSlotDiagLog === 'function') {
            window.musicalSlotDiagLog('rehearsal/' + stage, extra);
            return;
        }
        if (typeof writeLog !== 'function') return;
        const tail = extra ? ' | ' + JSON.stringify(extra) : '';
        writeLog('[MusicalSlot] rehearsal/' + stage + tail);
    }
    const rehearsalRedoStack = [];
    let rehearsalUndoPaused = false;
    function captureRehearsalUndoSnapshot() {
        return normalizeMusicalGridRehearsalText(musicalGridRehearsalText);
    }
    function clearRehearsalRedoStack() {
        rehearsalRedoStack.length = 0;
    }
    function clearRehearsalUndoStack() {
        rehearsalUndoStack.length = 0;
        clearRehearsalRedoStack();
    }
    function requestRehearsalUndoCapture() {
        if (rehearsalUndoPaused) return;
        const snap = captureRehearsalUndoSnapshot();
        if (typeof window.pushAppUndoEntry === 'function') {
            window.pushAppUndoEntry({ kind: 'rehearsal', snap });
            return;
        }
        const top = rehearsalUndoStack.length
            ? rehearsalUndoStack[rehearsalUndoStack.length - 1]
            : null;
        if (top === snap) return;
        rehearsalUndoStack.push(snap);
        clearRehearsalRedoStack();
    }
    function restoreRehearsalUndoSnapshot(rehearsal, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        rehearsalUndoPaused = true;
        if (typeof window.setAppUndoHistoryPaused === 'function') {
            window.setAppUndoHistoryPaused(true);
        }
        clearRehearsalGroupBarCountsOverride();
        musicalGridRehearsalText = normalizeMusicalGridRehearsalText(rehearsal);
        persistMusicalGridAndRedraw({
            skipUndo: true,
            skipTimelineSlotRebuild: !!o.skipTimelineSlotRebuild,
            relayoutRegions:
                !o.skipRelayoutRegions && canCommitRehearsalCompositionLayout(),
        });
        updateRehearsalBoundaryOverlay();
        rehearsalUndoPaused = false;
        if (typeof window.setAppUndoHistoryPaused === 'function') {
            window.setAppUndoHistoryPaused(false);
        }
    }
    function dispatchRehearsalHistoryStep(rehearsal) {
        restoreRehearsalUndoSnapshot(rehearsal);
    }
    function undoRehearsalDefinition() {
        if (typeof window.undoAppHistory === 'function') {
            return window.undoAppHistory();
        }
        return false;
    }
    function redoRehearsalDefinition() {
        if (typeof window.redoAppHistory === 'function') {
            return window.redoAppHistory();
        }
        return false;
    }
    function handleMusicalGridRehearsalUndoKeydown(e) {
        if (typeof window.handleAppUndoKeydown === 'function') {
            return window.handleAppUndoKeydown(e);
        }
        return false;
    }
    function handleMusicalGridRehearsalRedoKeydown(e) {
        if (typeof window.handleAppRedoKeydown === 'function') {
            return window.handleAppRedoKeydown(e);
        }
        return false;
    }
    const BAR_GROUP_FILL_A = 'rgba(200, 48, 58, 0.14)';
    const BAR_GROUP_FILL_B = 'rgba(48, 110, 220, 0.14)';
    const MUSICAL_GRID_DEFAULT_METER_TEXT = '120-4/4';
    const MUSICAL_GRID_DEFAULT_REHEARSAL_SPEC_TEXT = '8';
    /** Rehearsal 欄を指定サイクル定義へ反映（展開 counts 経由で grid を再構築） */
    function repairRehearsalSpecToSizes(sizes, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!sizes || !sizes.length) return false;
        readMusicalGridFromInputs();
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return false;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return false;
        const spec = { sizes: sizes.map((n) => n | 0) };
        const counts = expandRehearsalSpecToGroupBarCounts(
            settings.meterSpec,
            master,
            spec,
        );
        applyExplicitRehearsalGroupBarCounts(counts, { skipUndo: !!o.skipUndo });
        persistMusicalGridAndRedraw({ relayoutSilent: true });
        if (!o.silent) rehearsalSwapDiagLog('spec/repair', { sizes: sizes.join(',') });
        return true;
    }
    function normalizeMusicalGridTempoText(raw) {
        return String(raw == null ? '' : raw).trim();
    }

    function normalizeMusicalGridMeterText(raw) {
        return String(raw == null ? '' : raw)
            .trim()
            .replace(/\s+/g, '')
            .replace(/／/g, '/')
            .replace(/：/g, ':')
            .replace(/，/g, ',');
    }

    function normalizeMusicalGridTimeSigText(raw) {
        return normalizeMusicalGridMeterText(raw);
    }

    function normalizeMusicalGridRehearsalText(raw) {
        return String(raw == null ? '' : raw)
            .trim()
            .replace(/\s+/g, '')
            .replace(/，/g, ',');
    }

    function parseMusicalGridTempoBpm(raw) {
        const s = normalizeMusicalGridTempoText(raw);
        if (!s) return null;
        const m = /^(\d+(?:\.\d+)?)/.exec(s);
        if (!m) return null;
        const bpm = Number(m[1]);
        if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 999) return null;
        return bpm;
    }

    function parseTimeSignatureToken(token) {
        const m = /^(\d+)\/(\d+)$/.exec(String(token || '').trim());
        if (!m) return null;
        const num = parseInt(m[1], 10);
        const den = parseInt(m[2], 10);
        if (!(num > 0 && num <= 32) || !(den > 0 && den <= 32)) return null;
        return { num, den };
    }

    /** @returns {{ num:number, den:number }[]|null} */
    function getMeterSigSegments(sig) {
        if (!sig) return null;
        if (sig.segments && sig.segments.length) return sig.segments;
        if (sig.num > 0 && sig.den > 0) return [{ num: sig.num, den: sig.den }];
        return null;
    }

    function formatMeterSigText(sig) {
        if (sig && sig.alternates && sig.alternates.length) {
            return sig.alternates.map((s) => s.num + '/' + s.den).join(':');
        }
        const segments = getMeterSigSegments(sig);
        if (!segments || !segments.length) return '';
        return segments.map((s) => s.num + '/' + s.den).join('+');
    }

    function cloneMeterSig(sig) {
        if (!sig) return { num: 4, den: 4 };
        if (sig.alternates && sig.alternates.length) {
            if (sig.alternates.length === 1) {
                return { num: sig.alternates[0].num, den: sig.alternates[0].den };
            }
            return { alternates: sig.alternates.map((s) => ({ num: s.num, den: s.den })) };
        }
        const segments = getMeterSigSegments(sig);
        if (!segments || !segments.length) return { num: 4, den: 4 };
        if (segments.length === 1) return { num: segments[0].num, den: segments[0].den };
        return { segments: segments.map((s) => ({ num: s.num, den: s.den })) };
    }

    function getDefaultMeterEntryValues() {
        const def = parseMeterToken(MUSICAL_GRID_DEFAULT_METER_TEXT);
        return def
            ? { bpm: def.bpm, sig: cloneMeterSig(def.sig) }
            : { bpm: 120, sig: { num: 4, den: 4 } };
    }

    function defaultMeterSigSegment() {
        const def = getDefaultMeterEntryValues().sig;
        const segments = getMeterSigSegments(def);
        if (segments && segments.length) return { num: segments[0].num, den: segments[0].den };
        return { num: 4, den: 4 };
    }

    function parsePartialTimeSignatureToken(part) {
        const trimmed = String(part || '').trim();
        if (!trimmed) return defaultMeterSigSegment();
        const full = parseTimeSignatureToken(trimmed);
        if (full) return full;
        const numOnly = /^(\d+)$/.exec(trimmed);
        if (numOnly) {
            return { num: clampMeterSigPart(parseInt(numOnly[1], 10)), den: 4 };
        }
        const numSlash = /^(\d+)\/$/.exec(trimmed);
        if (numSlash) {
            return { num: clampMeterSigPart(parseInt(numSlash[1], 10)), den: 4 };
        }
        return defaultMeterSigSegment();
    }

    function segmentsToMeterSig(segments) {
        if (!segments || !segments.length) return cloneMeterSig(getDefaultMeterEntryValues().sig);
        if (segments.length === 1) return { num: segments[0].num, den: segments[0].den };
        return { segments: segments.map((s) => ({ num: s.num, den: s.den })) };
    }

    function alternatesToMeterSig(alternates) {
        if (!alternates || !alternates.length) return cloneMeterSig(getDefaultMeterEntryValues().sig);
        if (alternates.length === 1) return { num: alternates[0].num, den: alternates[0].den };
        return { alternates: alternates.map((s) => ({ num: s.num, den: s.den })) };
    }

    /** @returns {':'|'+'|''} */
    function meterSigPartDelimiter(sigPart) {
        const s = String(sigPart || '');
        const hasColon = s.indexOf(':') >= 0;
        const hasPlus = s.indexOf('+') >= 0;
        if (hasColon && !hasPlus) return ':';
        if (hasPlus) return '+';
        return '';
    }

    /** 入力途中（例: 120-3/8+ / 120-3/4:）でも編集可能な entry を返す */
    function parseMeterEntryDraft(entryText) {
        const defaults = getDefaultMeterEntryValues();
        const text = String(entryText || '').trim();
        const dash = text.indexOf('-');
        if (dash < 0) {
            const headBpm = parseMusicalGridTempoBpm(text);
            return {
                bpm: headBpm != null ? headBpm : defaults.bpm,
                sig: cloneMeterSig(defaults.sig),
            };
        }
        const bpmPart = text.slice(0, dash).trim();
        let bpm = defaults.bpm;
        if (bpmPart.length > 0) {
            const parsedBpm = Number(bpmPart);
            if (Number.isFinite(parsedBpm) && parsedBpm > 0 && parsedBpm <= 999) {
                bpm = parsedBpm;
            }
        }
        const sigPart = text.slice(dash + 1);
        if (!sigPart.length) {
            return { bpm, sig: cloneMeterSig(defaults.sig) };
        }
        const delim = meterSigPartDelimiter(sigPart) || '+';
        const parts = sigPart.split(delim).map((part) => parsePartialTimeSignatureToken(part));
        if (delim === ':') {
            return { bpm, sig: alternatesToMeterSig(parts) };
        }
        return { bpm, sig: segmentsToMeterSig(parts) };
    }

    function resolveMeterEntryForBump(entryText) {
        if (meterEntryHasTrailingSigPartDelimiter(entryText)) {
            return parseMeterEntryDraft(entryText);
        }
        return parseMeterToken(entryText) || parseMeterEntryDraft(entryText);
    }

    /** 拍子部が + または : で終わる = 変拍子／拍子繰り返しの後半入力途中 */
    function meterEntryHasTrailingSigPartDelimiter(entryText) {
        const entry = String(entryText == null ? '' : entryText);
        const dash = entry.indexOf('-');
        if (dash < 0) return false;
        return /(?:\+|:)\s*$/.test(entry.slice(dash + 1));
    }

    function commaListInputCaretAtEnd(input) {
        if (!input || typeof input.selectionStart !== 'number') return false;
        const len = input.value.length;
        return input.selectionStart === len && input.selectionEnd === len;
    }

    function meterInputShouldAppendCommaEntry(input, raw, entryIndex) {
        if (!input || !commaListInputCaretAtEnd(input)) return false;
        const span = commaListEntrySpan(raw, entryIndex);
        if (meterEntryHasTrailingSigPartDelimiter(span.text)) return false;
        return true;
    }

    function replaceCommaListEntry(raw, entryIndex, newEntryText) {
        const s = String(raw == null ? '' : raw).trim();
        let inner = s;
        let lead = 0;
        let tail = '';
        const alt = /^\((.*)\)$/.exec(s);
        if (alt) {
            lead = s.indexOf('(') + 1;
            tail = s.slice(s.lastIndexOf(')'));
            inner = alt[1];
        }
        const parts = inner.length ? inner.split(',') : [''];
        const idx = Math.max(0, entryIndex | 0);
        while (parts.length <= idx) parts.push('');
        parts[idx] = newEntryText;
        const joined = parts.join(',');
        return lead > 0 ? s.slice(0, lead) + joined + tail : joined;
    }

    /** 変拍子: "3/8+5/8" → { segments:[...] }。拍子繰り返し: "3/4:5/4" → { alternates:[...] }。単拍子は { num, den }。 */
    function parseMeterSigPart(raw) {
        const s = String(raw || '').trim();
        if (!s || /\+\s*$/.test(s) || /:\s*$/.test(s)) return null;
        const hasColon = s.indexOf(':') >= 0;
        const hasPlus = s.indexOf('+') >= 0;
        if (hasColon && hasPlus) return null;
        if (hasColon) {
            const parts = s.split(':');
            if (parts.length === 1) {
                const sig = parseTimeSignatureToken(parts[0]);
                return sig ? { num: sig.num, den: sig.den } : null;
            }
            const alternates = [];
            for (let i = 0; i < parts.length; i++) {
                if (!parts[i].length) return null;
                const sig = parseTimeSignatureToken(parts[i]);
                if (!sig) return null;
                alternates.push(sig);
            }
            return { alternates };
        }
        const parts = s.split('+');
        if (parts.length === 1) {
            const sig = parseTimeSignatureToken(parts[0]);
            return sig ? { num: sig.num, den: sig.den } : null;
        }
        const segments = [];
        for (let i = 0; i < parts.length; i++) {
            if (!parts[i].length) return null;
            const sig = parseTimeSignatureToken(parts[i]);
            if (!sig) return null;
            segments.push(sig);
        }
        return { segments };
    }

    function meterSigPartHasTrailingDelimiter(sigPart) {
        return /(?:\+|:)\s*$/.test(String(sigPart || '').trim());
    }

    /** Signature トラック等、BPM なしの拍子文字列（例: 3/4+）の編集中ドラフト */
    function parseMeterSigPartDraft(sigPart) {
        const text = String(sigPart || '').trim();
        if (!text.length) return cloneMeterSig(getDefaultMeterEntryValues().sig);
        const delim = meterSigPartDelimiter(text) || '+';
        const parts = text.split(delim).map((part) => parsePartialTimeSignatureToken(part));
        if (delim === ':') return alternatesToMeterSig(parts);
        return segmentsToMeterSig(parts);
    }

    function resolveMeterSigForBump(sigText) {
        const text = String(sigText || '').trim();
        if (meterSigPartHasTrailingDelimiter(text)) {
            return parseMeterSigPartDraft(text);
        }
        return parseMeterSigPart(text) || parseMeterSigPartDraft(text);
    }

    function parseMeterToken(token) {
        const s = String(token || '').trim();
        const dash = s.indexOf('-');
        if (dash < 0) return null;
        const bpmPart = s.slice(0, dash).trim();
        const sigPart = s.slice(dash + 1).trim();
        if (!bpmPart.length || !sigPart.length) return null;
        const bpm = Number(bpmPart);
        const sig = parseMeterSigPart(sigPart);
        if (!sig || !(bpm > 0 && bpm <= 999)) return null;
        return { bpm, sig };
    }

    function meterBarDurationSec(entry) {
        if (!entry || !entry.sig) return 0;
        const segments = getMeterSigSegments(entry.sig);
        if (!segments || !segments.length) return 0;
        return segments.reduce(
            (sum, seg) => sum + seg.num * beatDurationSec(seg, entry.bpm),
            0,
        );
    }

    function getMeterSigTotalBeats(sig) {
        const segments = getMeterSigSegments(sig);
        if (!segments || !segments.length) return 0;
        return segments.reduce((sum, seg) => sum + seg.num, 0);
    }

    function forEachMeterBarBeat(barStartSec, entry, fn) {
        const segments = getMeterSigSegments(entry && entry.sig);
        if (!segments || !segments.length || typeof fn !== 'function') return;
        let t = barStartSec;
        let beatInBar = 0;
        for (let si = 0; si < segments.length; si++) {
            const seg = segments[si];
            const beatDur = beatDurationSec(seg, entry.bpm);
            for (let b = 0; b < seg.num; b++) {
                fn({
                    sec: t,
                    beatInBar,
                    beatInBar1: beatInBar + 1,
                    segmentIndex: si,
                    beatInSegment: b,
                    isDownbeat: b === 0,
                    beatDur,
                });
                t += beatDur;
                beatInBar += 1;
            }
        }
    }

    function resolveMeterBeatAtSec(barStartSec, entry, sec) {
        let found = null;
        forEachMeterBarBeat(barStartSec, entry, (beat) => {
            if (sec >= beat.sec - 1e-9 && sec < beat.sec + beat.beatDur - 1e-9) {
                found = beat;
            }
        });
        return found;
    }

    /** ストレッチ delta=0 の編集中接頭辞（± は U+00B1、機種依存文字ではない） */
    const TEMPO_STRETCH_ZERO_PREFIX = '±0,';

    /** 先頭のテンポストレッチ接頭辞（例: +8, / -10, / ±0,）を分離する */
    function parseTempoStretchPrefix(raw) {
        const s = normalizeMusicalGridMeterText(raw);
        const zeroM = /^±0,/.exec(s);
        if (zeroM) {
            return {
                stretchDelta: 0,
                text: s.slice(zeroM[0].length),
                prefixLen: zeroM[0].length,
            };
        }
        const m = /^([+-]\d+),/.exec(s);
        if (!m) {
            return { stretchDelta: 0, text: s, prefixLen: 0 };
        }
        const delta = parseInt(m[1], 10);
        if (!Number.isFinite(delta)) {
            return { stretchDelta: 0, text: s, prefixLen: 0 };
        }
        return {
            stretchDelta: delta,
            text: s.slice(m[0].length),
            prefixLen: m[0].length,
        };
    }

    function caretInTempoStretchPrefix(raw, caret) {
        const info = parseTempoStretchPrefix(raw);
        if (!info.prefixLen) return false;
        const pos = Math.max(0, caret | 0);
        return pos < info.prefixLen;
    }

    function formatTempoStretchPrefix(delta, opt) {
        const d = delta | 0;
        if (!d) {
            return opt && opt.keepZero ? TEMPO_STRETCH_ZERO_PREFIX : '';
        }
        return (d > 0 ? '+' : '') + d + ',';
    }

    /** ストレッチ接頭辞内の桁オフセット（符号直後を 0） */
    function stretchPrefixDigitCaretOffset(raw, caret) {
        const info = parseTempoStretchPrefix(raw);
        if (!info.prefixLen) return 0;
        const pos = Math.max(0, Math.min(caret | 0, info.prefixLen));
        return Math.max(0, pos - 1);
    }

    /** 桁オフセットから接頭辞内カーソル位置を復元（テンポ・拍子フィールドと同様に維持） */
    function caretPosForStretchPrefixField(text, digitOffset) {
        const info = parseTempoStretchPrefix(text);
        if (!info.prefixLen) return 0;
        const numStart = 1;
        const commaPos = info.prefixLen - 1;
        const numLen = Math.max(0, commaPos - numStart);
        return numStart + Math.min(Math.max(0, digitOffset | 0), numLen);
    }

    function meterSpecStretchDeltaValid(spec) {
        if (!spec || !spec.entries || !spec.entries.length) return false;
        const delta = spec.stretchDelta || 0;
        if (!delta) return true;
        for (let i = 0; i < spec.entries.length; i++) {
            const effective = spec.entries[i].bpm + delta;
            if (!(effective > 0 && effective <= 999)) return false;
        }
        return true;
    }

    function meterSigTextEqual(a, b) {
        return formatMeterSigText(a) === formatMeterSigText(b);
    }

    function meterEntriesEqual(a, b) {
        if (!a || !b) return false;
        if (a.mode !== b.mode) return false;
        if (!a.entries || !b.entries || a.entries.length !== b.entries.length) return false;
        for (let i = 0; i < a.entries.length; i++) {
            if (a.entries[i].bpm !== b.entries[i].bpm) return false;
            if (!meterSigTextEqual(a.entries[i].sig, b.entries[i].sig)) return false;
        }
        return true;
    }

    function meterSigEntriesChanged(prevSpec, nextSpec) {
        if (!prevSpec || !nextSpec) return true;
        if (prevSpec.mode !== nextSpec.mode) return true;
        if (!prevSpec.entries || !nextSpec.entries) return true;
        if (prevSpec.entries.length !== nextSpec.entries.length) return true;
        for (let i = 0; i < prevSpec.entries.length; i++) {
            if (!meterSigTextEqual(prevSpec.entries[i].sig, nextSpec.entries[i].sig)) {
                return true;
            }
        }
        return false;
    }

    /** Tempo/Sig 本体は同一で先頭ストレッチ接頭辞だけ変わったか */
    function meterStretchDeltaOnlyChanged(prevSpec, nextSpec) {
        if (!prevSpec || !nextSpec) return false;
        if ((prevSpec.stretchDelta || 0) === (nextSpec.stretchDelta || 0)) return false;
        return meterEntriesEqual(prevSpec, nextSpec);
    }

    /** @returns {{ mode: 'fixed'|'sequence'|'alternate', entries: {bpm:number, sig:{num:number, den:number}}[], stretchDelta?: number }|null} */
    function parseMeterSpec(raw) {
        const prefix = parseTempoStretchPrefix(raw);
        let s = prefix.text;
        if (!s && !prefix.stretchDelta) return null;
        if (!s && prefix.stretchDelta) return null;
        let mode = 'fixed';
        const altMatch = /^\((.+)\)$/.exec(s);
        if (altMatch) {
            mode = 'alternate';
            s = altMatch[1];
        }
        const parts = s.split(',').filter((p) => p.length > 0);
        if (!parts.length) return null;
        const entries = [];
        for (let i = 0; i < parts.length; i++) {
            const entry = parseMeterToken(parts[i]);
            if (!entry) return null;
            entries.push(entry);
        }
        if (entries.length > 1 && mode === 'fixed') mode = 'sequence';
        const spec = {
            mode,
            entries,
            stretchDelta: prefix.stretchDelta || 0,
        };
        if (!meterSpecStretchDeltaValid(spec)) return null;
        return spec;
    }

    function formatBpmForMeter(bpm) {
        return Math.abs(bpm - Math.round(bpm)) < 1e-9 ? String(Math.round(bpm)) : String(bpm);
    }

    function formatMeterSpec(spec, opt) {
        if (!spec || !spec.entries || !spec.entries.length) return '';
        const parts = spec.entries.map((e) => formatMeterEntryToken(e));
        let joined = parts.join(',');
        if (spec.mode === 'alternate') joined = '(' + joined + ')';
        const prefix = formatTempoStretchPrefix(spec.stretchDelta || 0, opt);
        return prefix + joined;
    }

    function formatMeterEntryToken(entry) {
        if (!entry || !entry.sig) return '';
        return formatBpmForMeter(entry.bpm) + '-' + formatMeterSigText(entry.sig);
    }

    /** 指定小節範囲に適用される Tempo/Sig をグローバル spec から抽出（連続同一は 1 つにまとめる） */
    /** Rehearsal グループ除去に合わせ、sequence meter から該当小節分の Tempo/Sig エントリを削除 */
    function spliceMusicalGridMeterForRemovedRehearsalGroup(countsBefore, removedGroupIndex) {
        const counts = countsBefore;
        const pi = removedGroupIndex | 0;
        if (!counts || pi < 0 || pi >= counts.length) return false;
        let barStart = 0;
        for (let c = 0; c < pi; c++) barStart += counts[c] | 0;
        const barCount = counts[pi] | 0;
        if (!(barCount > 0)) return false;
        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        if (!spec || !spec.entries || !spec.entries.length) return false;
        if (spec.mode !== 'sequence') return false;
        if (barStart + barCount > spec.entries.length) return false;
        const nextEntries = spec.entries
            .slice(0, barStart)
            .concat(spec.entries.slice(barStart + barCount));
        if (!nextEntries.length) return false;
        const nextSpec = Object.assign({}, spec, {
            entries: nextEntries,
            mode: nextEntries.length === 1 ? 'fixed' : 'sequence',
        });
        setCommittedMeterSpec(nextSpec);
        if (typeof clearTempoTrackEventsOverride === 'function') {
            clearTempoTrackEventsOverride();
        }
        if (typeof clearSignatureTrackEventsOverride === 'function') {
            clearSignatureTrackEventsOverride();
        }
        if (typeof clearMusicalGridPositionCache === 'function') {
            clearMusicalGridPositionCache();
        }
        if (typeof persistMusicalGridToStorage === 'function') {
            persistMusicalGridToStorage({ skipSessionPersist: false });
        }
        return true;
    }

    function formatMeterTextForBarRange(spec, barStart, barCount) {
        if (!spec || !spec.entries || !spec.entries.length || !(barCount > 0)) return '';
        const parts = [];
        let lastToken = null;
        const start = barStart | 0;
        const count = barCount | 0;
        for (let i = 0; i < count; i++) {
            const token = formatMeterEntryToken(getRawMeterEntryForBar(spec, start + i));
            if (!token) continue;
            if (token !== lastToken) {
                parts.push(token);
                lastToken = token;
            }
        }
        return parts.join(', ');
    }

    function getRawMeterEntryIndexForBar(spec, barIndex) {
        if (!spec || !spec.entries || !spec.entries.length) return -1;
        const entries = spec.entries;
        if (spec.mode === 'fixed') return 0;
        if (spec.mode === 'alternate') {
            return ((barIndex % entries.length) + entries.length) % entries.length;
        }
        if (barIndex < entries.length) return barIndex;
        return entries.length - 1;
    }

    function getRawMeterEntryForBar(spec, barIndex) {
        const idx = getRawMeterEntryIndexForBar(spec, barIndex);
        if (idx < 0 || !spec || !spec.entries || !spec.entries[idx]) return null;
        return spec.entries[idx];
    }

    function meterSigHasRepeats(sig) {
        return !!(sig && sig.alternates && sig.alternates.length > 1);
    }

    function getSigCycleIndexForBar(spec, barIndex) {
        if (!spec || !spec.entries || !spec.entries.length) return 0;
        const entryIdx = getRawMeterEntryIndexForBar(spec, barIndex);
        const entry = entryIdx >= 0 ? spec.entries[entryIdx] : null;
        if (!meterSigHasRepeats(entry && entry.sig)) return 0;
        const altLen = entry.sig.alternates.length;
        if (spec.mode === 'fixed') {
            return barIndex % altLen;
        }
        if (spec.mode === 'sequence' && barIndex < spec.entries.length) {
            return 0;
        }
        let cycleCount = 0;
        for (let b = 0; b < barIndex; b++) {
            if (getRawMeterEntryIndexForBar(spec, b) === entryIdx) {
                cycleCount++;
            }
        }
        return cycleCount % altLen;
    }

    function resolveEntrySigForCycle(sig, cycleIndex) {
        if (!sig) return { num: 4, den: 4 };
        if (sig.alternates && sig.alternates.length) {
            const len = sig.alternates.length;
            const idx = ((cycleIndex % len) + len) % len;
            const a = sig.alternates[idx];
            return { num: a.num, den: a.den };
        }
        return cloneMeterSig(sig);
    }

    function getMeterEntryForBar(spec, barIndex) {
        const raw = getRawMeterEntryForBar(spec, barIndex);
        if (!raw) return null;
        const cycleIndex = getSigCycleIndexForBar(spec, barIndex);
        const delta = spec && spec.stretchDelta ? spec.stretchDelta : 0;
        const bpm = Math.max(1, Math.min(999, raw.bpm + delta));
        return {
            bpm,
            sig: resolveEntrySigForCycle(raw.sig, cycleIndex),
        };
    }

    /** @returns {{ mode: 'fixed'|'sequence'|'alternate', signatures: {num:number, den:number}[] }|null} */
    function parseTimeSignatureSpec(raw) {
        let s = normalizeMusicalGridTimeSigText(raw);
        if (!s) return null;
        let mode = 'fixed';
        const altMatch = /^\((.+)\)$/.exec(s);
        if (altMatch) {
            mode = 'alternate';
            s = altMatch[1];
        }
        const parts = s.split(',').filter((p) => p.length > 0);
        if (!parts.length) return null;
        const signatures = [];
        for (let i = 0; i < parts.length; i++) {
            const sig = parseTimeSignatureToken(parts[i]);
            if (!sig) return null;
            signatures.push(sig);
        }
        if (signatures.length > 1 && mode === 'fixed') mode = 'sequence';
        return { mode, signatures };
    }

    /**
     * Rehearsal 欄: "8" = 8 小節ごと。"1,8" = 先頭 1 小節のみ、その後は 8 小節ずつ。
     * @returns {{ sizes: number[] }|null}
     */
    function parseRehearsalGroupingSpec(raw) {
        const s = normalizeMusicalGridRehearsalText(raw);
        if (!s) return null;
        const parts = s.split(',').filter((p) => p.length > 0);
        if (!parts.length) return null;
        const sizes = [];
        for (let i = 0; i < parts.length; i++) {
            const n = parseInt(parts[i], 10);
            if (!(n > 0 && n <= 999)) return null;
            sizes.push(n);
        }
        return sizes.length ? { sizes } : null;
    }

    function barGroupSizeForIndex(groupIndex, sizes) {
        if (!sizes || !sizes.length) return 1;
        if (sizes.length === 1) return sizes[0];
        if (groupIndex === 0) return sizes[0];
        if (sizes.length === 2) return sizes[1];
        if (groupIndex < sizes.length) return sizes[groupIndex];
        return sizes[sizes.length - 1];
    }

    function beatDurationSec(sig, bpm) {
        return ((4 / sig.den) * 60) / bpm;
    }

    /** 小節線は Measure ジャンプ・Measure トラックと同じ collect*BarBoundarySecs を使う */
    function collectMusicalGridLines(meterSpec, durationSec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const showBeats = o.showBeats !== false;
        const lines = [];
        if (!(durationSec > 0) || !meterSpec) return lines;

        const playbackAligned =
            typeof isAnyExtraTrackTempoStretched === 'function' &&
            isAnyExtraTrackTempoStretched();
        const rate =
            playbackAligned && typeof currentTempoStretchPlaybackRate === 'function'
                ? currentTempoStretchPlaybackRate()
                : 1;
        const specForBar =
            playbackAligned && Math.abs(rate - 1) > 0.00001
                ? Object.assign({}, meterSpec, { stretchDelta: 0 })
                : meterSpec;

        const boundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(meterSpec, durationSec)
                : typeof collectBarBoundarySecs === 'function'
                  ? collectBarBoundarySecs(meterSpec, durationSec)
                  : [];

        const maxLines = 24000;
        for (
            let barIndex = 0;
            barIndex < boundaries.length - 1 && lines.length < maxLines;
            barIndex++
        ) {
            const t = boundaries[barIndex];
            lines.push({ sec: t, kind: 'bar' });
            if (showBeats) {
                const entry = getMeterEntryForBar(specForBar, barIndex);
                if (entry) {
                    forEachMeterBarBeat(t, entry, (beat) => {
                        if (beat.beatInBar === 0) return;
                        if (beat.sec >= durationSec - 1e-9) return;
                        lines.push({ sec: beat.sec, kind: 'beat' });
                    });
                }
            }
        }
        return lines;
    }

    /** @returns {{ startSec: number, endSec: number, paletteIndex: number }[]} */
    function collectRehearsalGroupRanges(meterSpec, durationSec, rehearsalSpec) {
        const ranges = [];
        if (!(durationSec > 0) || !meterSpec || !rehearsalSpec || !rehearsalSpec.sizes) {
            return ranges;
        }
        const sizes = rehearsalSpec.sizes;
        let t = 0;
        let barIndex = 0;
        let groupIndex = 0;
        let barsInGroup = 0;
        let groupStartSec = 0;

        while (t < durationSec - 1e-9) {
            const entry = getMeterEntryForBar(meterSpec, barIndex);
            if (!entry) break;
            const barDur = meterBarDurationSec(entry);
            if (barsInGroup === 0) groupStartSec = t;
            barsInGroup += 1;
            const groupSize = barGroupSizeForIndex(groupIndex, sizes);
            const barEndSec = Math.min(durationSec, t + barDur);
            if (barsInGroup >= groupSize) {
                ranges.push({
                    startSec: groupStartSec,
                    endSec: barEndSec,
                    paletteIndex: groupIndex,
                });
                groupIndex += 1;
                barsInGroup = 0;
            }
            t = barEndSec;
            barIndex += 1;
        }
        if (barsInGroup > 0 && groupStartSec < durationSec - 1e-9) {
            ranges.push({
                startSec: groupStartSec,
                endSec: durationSec,
                paletteIndex: groupIndex,
            });
        }
        return ranges;
    }



    function defaultMeterSpec() {
        return parseMeterSpec(MUSICAL_GRID_DEFAULT_METER_TEXT);
    }

    function cloneMeterSpecObject(spec) {
        if (!spec || !spec.entries || !spec.entries.length) return null;
        return Object.assign({}, spec, {
            entries: spec.entries.map((entry) => ({
                bpm: entry.bpm,
                sig: cloneMeterSig(entry.sig),
            })),
        });
    }

    function getMeterSpec() {
        return committedMeterSpec || defaultMeterSpec();
    }

    function setCommittedMeterSpec(spec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const next = cloneMeterSpecObject(spec);
        if (!next) return false;
        committedMeterSpec = next;
        if (typeof clearMusicalGridPositionCache === 'function') clearMusicalGridPositionCache();
        if (typeof invalidateMusicalGridNavStopsCache === 'function') {
            invalidateMusicalGridNavStopsCache();
        }
        return true;
    }

    /** 表示・ログ用 — ランタイムの正は getMeterSpec() */
    function getCommittedMusicalGridMeterText() {
        const spec = getMeterSpec();
        return spec ? formatMeterSpec(spec) : '';
    }

    function ensureMusicalGridMeterCommitted() {
        if (committedMeterSpec) return true;
        return setCommittedMeterSpec(defaultMeterSpec());
    }

    /** iXML 等 — 外部テキストから meterSpec を直接取り込む（セッション snap とは別経路） */
    function importMeterSpecFromText(meterText) {
        const spec = parseMeterSpec(normalizeMusicalGridMeterText(meterText));
        if (!spec) return false;
        setCommittedMeterSpec(spec);
        if (typeof clearTempoTrackEventsOverride === 'function') {
            clearTempoTrackEventsOverride();
        }
        if (typeof clearSignatureTrackEventsOverride === 'function') {
            clearSignatureTrackEventsOverride();
        }
        return true;
    }

    /** All Clear 等 — Tempo/Sig 本体とトラック override を既定（120-4/4）へ戻す */
    function resetCommittedMeterSpecToDefault() {
        setCommittedMeterSpec(defaultMeterSpec());
        if (typeof clearTempoTrackEventsOverride === 'function') {
            clearTempoTrackEventsOverride();
        }
        if (typeof clearSignatureTrackEventsOverride === 'function') {
            clearSignatureTrackEventsOverride();
        }
        if (typeof clearMusicalGridTrackEventsPersistPending === 'function') {
            clearMusicalGridTrackEventsPersistPending();
        }
        return true;
    }

    /** @deprecated 旧 API — importMeterSpecFromText を使用 */
    function setMusicalGridMeterText(text, opt) {
        void opt;
        return importMeterSpecFromText(text);
    }

    function applyMusicalGridMeterFromPersistSnap(snap) {
        const s = snap && typeof snap === 'object' ? snap : {};
        if (!committedMeterSpec) {
            setCommittedMeterSpec(defaultMeterSpec());
        }
        if (s.stretchDelta != null && Number.isFinite(Number(s.stretchDelta))) {
            const spec = getMeterSpec();
            setCommittedMeterSpec(
                Object.assign({}, spec, { stretchDelta: Number(s.stretchDelta) | 0 }),
            );
        }
    }

    function readMusicalGridFromInputs() {}

    /** @returns {{ accepted: boolean, changed: boolean }} */
    function applyMusicalGridMeterCommitFromInputs() {
        return { accepted: true, changed: false };
    }

    window.importMeterSpecFromText = importMeterSpecFromText;
    window.setMusicalGridMeterText = setMusicalGridMeterText;
    window.ensureMusicalGridMeterCommitted = ensureMusicalGridMeterCommitted;
    window.getMeterSpec = getMeterSpec;
    window.setCommittedMeterSpec = setCommittedMeterSpec;
    window.getCommittedMusicalGridMeterText = getCommittedMusicalGridMeterText;
    window.applyMusicalGridMeterCommitFromInputs = applyMusicalGridMeterCommitFromInputs;
    window.applyMusicalGridMeterFromPersistSnap = applyMusicalGridMeterFromPersistSnap;
    window.resetCommittedMeterSpecToDefault = resetCommittedMeterSpecToDefault;

    /** Tempo トラック — 4 分音符単位のテンポ変化点（sec, bpm） */
    let tempoTrackEventsOverride = null;
    /** 復元時マスター尺未確定の間は Tempo/Signature トラック適用を延期 */
    let musicalGridTrackEventsPersistPending = null;

    function mapSignatureTrackEventsForPersist(sigEvents) {
        if (!Array.isArray(sigEvents)) return [];
        return sigEvents.map((e) => ({
            barIndex: e.barIndex,
            sig: cloneMeterSigForTempoSync(e.sig),
        }));
    }

    function clearMusicalGridTrackEventsPersistPending() {
        musicalGridTrackEventsPersistPending = null;
    }

    function collectMeterBarBoundariesForTempoSync(meterSpec, durationSec) {
        return typeof collectPlaybackAlignedBarBoundarySecs === 'function'
            ? collectPlaybackAlignedBarBoundarySecs(meterSpec, durationSec)
            : typeof collectBarBoundarySecs === 'function'
              ? collectBarBoundarySecs(meterSpec, durationSec)
              : [];
    }

    /** 小節番号から秒位置を求める（尺を超える小節も外挿） */
    function secForBarIndex(barIndex, meterSpec, durationSec) {
        const bi = Math.max(0, barIndex | 0);
        if (bi === 0) return 0;
        if (durationSec > 0 && meterSpec) {
            const boundaries = collectMeterBarBoundariesForTempoSync(meterSpec, durationSec);
            if (boundaries.length >= 2 && bi < boundaries.length - 1) {
                return boundaries[bi];
            }
        }
        let t = 0;
        for (let i = 0; i < bi; i++) {
            const entry = getMeterEntryForBar(meterSpec, i);
            if (!entry) break;
            t += meterBarDurationSec(entry);
        }
        return t;
    }

    function resolveTempoBpmAtBarIndex(barIndex, events) {
        if (!events || !events.length) return 120;
        let bpm = events[0].bpm;
        const bi = barIndex | 0;
        for (let i = 0; i < events.length; i++) {
            const evBar =
                events[i].barIndex != null && Number.isFinite(events[i].barIndex)
                    ? events[i].barIndex | 0
                    : null;
            if (evBar != null && evBar <= bi) bpm = events[i].bpm;
            else if (evBar != null) break;
        }
        return bpm;
    }

    /** BPM 変更後も小節位置 (barIndex) を保ち、sec を再計算する */
    function syncTempoEventSecsFromBarIndices(events, meterSpec, durationSec) {
        if (!events || !events.length || !meterSpec) return false;
        let changed = false;
        for (let i = 0; i < events.length; i++) {
            const bi = i === 0 ? 0 : Math.max(1, events[i].barIndex | 0);
            const nextSec = secForBarIndex(bi, meterSpec, durationSec);
            const prev = events[i];
            if (
                i === 0 &&
                (prev.barIndex !== 0 || Math.abs(prev.sec) > 1e-9)
            ) {
                events[i] = Object.assign({}, prev, { sec: 0, barIndex: 0 });
                changed = true;
            } else if (
                i > 0 &&
                (prev.barIndex !== bi || Math.abs(prev.sec - nextSec) > 1e-6)
            ) {
                events[i] = Object.assign({}, prev, { sec: nextSec, barIndex: bi });
                changed = true;
            }
        }
        return changed;
    }

    function tempoTrackEventsMaxSec(raw, meterSpec) {
        if (!Array.isArray(raw) || !raw.length) return 0;
        let max = 0;
        let maxBar = 0;
        for (let i = 0; i < raw.length; i++) {
            const e = raw[i];
            if (!e || typeof e !== 'object') continue;
            const sec = Number(e.sec);
            if (Number.isFinite(sec)) max = Math.max(max, sec);
            const bi = Number(e.barIndex != null ? e.barIndex : e.bar);
            if (Number.isFinite(bi) && bi >= 0) maxBar = Math.max(maxBar, bi | 0);
        }
        if (maxBar > 0 && meterSpec) {
            const secFromBar = secForBarIndex(maxBar, meterSpec, 0);
            if (secFromBar > max) max = secFromBar;
        }
        return max;
    }

    function tempoTrackEventsMaxBarIndex(raw) {
        if (!Array.isArray(raw) || !raw.length) return 0;
        let maxBar = 0;
        for (let i = 0; i < raw.length; i++) {
            const e = raw[i];
            if (!e || typeof e !== 'object') continue;
            const bi = Number(e.barIndex != null ? e.barIndex : e.bar);
            if (Number.isFinite(bi) && bi >= 0) maxBar = Math.max(maxBar, bi | 0);
        }
        return maxBar;
    }

    function signatureTrackEventsMaxBarIndex(raw) {
        if (!Array.isArray(raw) || !raw.length) return 0;
        let maxBar = 0;
        for (let i = 0; i < raw.length; i++) {
            const e = raw[i];
            if (!e || typeof e !== 'object') continue;
            const bi = Number(e.barIndex != null ? e.barIndex : e.bar);
            if (Number.isFinite(bi) && bi >= 0) maxBar = Math.max(maxBar, bi | 0);
        }
        return maxBar;
    }

    /** 保存済みテンポイベントを考慮して小節開始秒を推定（復元延期判定用） */
    function secForBarIndexWithTempoEvents(barIndex, meterSpec, tempoEventsRaw) {
        const bi = Math.max(0, barIndex | 0);
        if (bi === 0) return 0;
        if (!meterSpec) return 0;
        const tempoEvents =
            Array.isArray(tempoEventsRaw) && tempoEventsRaw.length ? tempoEventsRaw : null;
        if (!tempoEvents) {
            return secForBarIndex(bi, meterSpec, 0);
        }
        let t = 0;
        for (let i = 0; i < bi; i++) {
            t += barDurationSecWithTempoEvents(t, i, meterSpec, tempoEvents, Infinity);
        }
        return t;
    }

    /** Tempo/Signature トラック適用に必要な最小マスター尺（リハーサルマークと同様に短尺では延期） */
    function minDurationSecForMusicalGridTrackApply(snap, meterSpec) {
        const s = snap && typeof snap === 'object' ? snap : {};
        let minReq = tempoTrackEventsMaxSec(s.tempoTrackEvents, meterSpec);
        const maxBar = Math.max(
            tempoTrackEventsMaxBarIndex(s.tempoTrackEvents),
            signatureTrackEventsMaxBarIndex(s.signatureTrackEvents),
        );
        if (maxBar > 0 && meterSpec) {
            const secAtBar = secForBarIndexWithTempoEvents(
                maxBar,
                meterSpec,
                s.tempoTrackEvents,
            );
            if (secAtBar > minReq) minReq = secAtBar;
        }
        return minReq;
    }

    function shouldDeferMusicalGridTrackEventsApply(snap, durationSec, meterSpec) {
        if (!(durationSec > 0)) return true;
        const minReq = minDurationSecForMusicalGridTrackApply(snap, meterSpec);
        return minReq > durationSec + 1e-6;
    }

    function deferMusicalGridTrackEventsFromPersistSnap(snap, maxSec, meterSpec, detail) {
        stashMusicalGridTrackEventsPersistPending(snap);
        if (typeof clearTempoTrackEventsOverride === 'function') {
            clearTempoTrackEventsOverride();
        }
        if (typeof clearSignatureTrackEventsOverride === 'function') {
            clearSignatureTrackEventsOverride();
        }
        if (typeof musicalTrackPersistDiagLog === 'function') {
            const minReq = minDurationSecForMusicalGridTrackApply(snap, meterSpec);
            musicalTrackPersistDiagLog('track/apply/defer', Object.assign(
                {
                    maxSec: maxSec,
                    minRequiredSec: minReq,
                    reason:
                        !(maxSec > 0)
                            ? 'no-duration'
                            : !meterSpec
                              ? 'no-meter-spec'
                              : 'duration-too-short',
                },
                detail || {},
            ));
        }
    }

    function getTempoSignatureTrackEventsDiagState() {
        const pending = musicalGridTrackEventsPersistPending;
        return {
            tempoOverrideCount: tempoTrackEventsOverride ? tempoTrackEventsOverride.length : 0,
            signatureOverrideCount: signatureTrackEventsOverride
                ? signatureTrackEventsOverride.length
                : 0,
            trackPendingTempoCount:
                pending && pending.tempoTrackEvents ? pending.tempoTrackEvents.length : 0,
            trackPendingSignatureCount:
                pending && pending.signatureTrackEvents
                    ? pending.signatureTrackEvents.length
                    : 0,
            hasTrackPending: !!pending,
            meter:
                typeof getCommittedMusicalGridMeterText === 'function'
                    ? getCommittedMusicalGridMeterText()
                    : '',
            masterSec:
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : 0,
        };
    }

    function stashMusicalGridTrackEventsPersistPending(snap) {
        const s = snap && typeof snap === 'object' ? snap : {};
        const hasTempo = Array.isArray(s.tempoTrackEvents) && s.tempoTrackEvents.length;
        const hasSig =
            Array.isArray(s.signatureTrackEvents) && s.signatureTrackEvents.length;
        if (!hasTempo && !hasSig) {
            clearMusicalGridTrackEventsPersistPending();
            return;
        }
        musicalGridTrackEventsPersistPending = {
            tempoTrackEvents: hasTempo ? s.tempoTrackEvents.slice() : null,
            signatureTrackEvents: hasSig ? s.signatureTrackEvents.slice() : null,
        };
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('track/pending/stash', {
                hasTempo: hasTempo,
                hasSig: hasSig,
                tempoTrackEvents:
                    typeof musicalTrackPersistDiagSummarizeTempoEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeTempoEvents(
                              musicalGridTrackEventsPersistPending.tempoTrackEvents,
                          )
                        : null,
                signatureTrackEvents:
                    typeof musicalTrackPersistDiagSummarizeSignatureEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeSignatureEvents(
                              musicalGridTrackEventsPersistPending.signatureTrackEvents,
                          )
                        : null,
                before: getTempoSignatureTrackEventsDiagState(),
            });
        }
    }

    function applyMusicalGridTrackEventsFromPersistSnap(snap, opt) {
        const s = snap && typeof snap === 'object' ? snap : {};
        const o = opt && typeof opt === 'object' ? opt : {};
        const hasTempo = Array.isArray(s.tempoTrackEvents) && s.tempoTrackEvents.length;
        const hasSig =
            Array.isArray(s.signatureTrackEvents) && s.signatureTrackEvents.length;
        if (!hasTempo && !hasSig) {
            clearMusicalGridTrackEventsPersistPending();
            if (typeof clearTempoTrackEventsOverride === 'function') {
                clearTempoTrackEventsOverride();
            }
            if (typeof clearSignatureTrackEventsOverride === 'function') {
                clearSignatureTrackEventsOverride();
            }
            return false;
        }
        const maxSec =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const meterSpec = getMeterSpec();
        if (!(maxSec > 0) || !meterSpec) {
            deferMusicalGridTrackEventsFromPersistSnap(s, maxSec, meterSpec, {
                hasTempo: hasTempo,
                hasSig: hasSig,
                before: getTempoSignatureTrackEventsDiagState(),
            });
            return false;
        }
        if (shouldDeferMusicalGridTrackEventsApply(s, maxSec, meterSpec)) {
            deferMusicalGridTrackEventsFromPersistSnap(s, maxSec, meterSpec, {
                hasTempo: hasTempo,
                hasSig: hasSig,
                before: getTempoSignatureTrackEventsDiagState(),
            });
            return false;
        }
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('track/apply/begin', {
                maxSec: maxSec,
                hasTempo: hasTempo,
                hasSig: hasSig,
                tempoTrackEvents:
                    hasTempo &&
                    typeof musicalTrackPersistDiagSummarizeTempoEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeTempoEvents(s.tempoTrackEvents)
                        : null,
                signatureTrackEvents:
                    hasSig &&
                    typeof musicalTrackPersistDiagSummarizeSignatureEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeSignatureEvents(s.signatureTrackEvents)
                        : null,
                before: getTempoSignatureTrackEventsDiagState(),
            });
        }
        clearMusicalGridTrackEventsPersistPending();
        const applyOpt = { skipBaseline: !!o.skipBaseline };
        if (hasSig) {
            applySignatureTrackEvents(s.signatureTrackEvents, meterSpec, maxSec, applyOpt);
        } else if (typeof clearSignatureTrackEventsOverride === 'function') {
            clearSignatureTrackEventsOverride();
        }
        const meterSpecAfterSig = getMeterSpec() || meterSpec;
        if (hasTempo) {
            applyTempoTrackEvents(s.tempoTrackEvents, meterSpecAfterSig, maxSec, applyOpt);
        } else if (typeof clearTempoTrackEventsOverride === 'function') {
            clearTempoTrackEventsOverride();
        }
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('track/apply/done', {
                maxSec: maxSec,
                after: getTempoSignatureTrackEventsDiagState(),
            });
        }
        return true;
    }

    function tryApplyPendingMusicalGridTrackEvents() {
        const pending = musicalGridTrackEventsPersistPending;
        if (!pending) return false;
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('track/pending/apply', {
                tempoTrackEvents:
                    typeof musicalTrackPersistDiagSummarizeTempoEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeTempoEvents(pending.tempoTrackEvents)
                        : null,
                signatureTrackEvents:
                    typeof musicalTrackPersistDiagSummarizeSignatureEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeSignatureEvents(
                              pending.signatureTrackEvents,
                          )
                        : null,
            });
        }
        const applied = applyMusicalGridTrackEventsFromPersistSnap(pending, { skipBaseline: true });
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog(
                applied
                    ? 'track/pending/applied'
                    : musicalGridTrackEventsPersistPending
                      ? 'track/pending/still-deferred'
                      : 'track/pending/failed',
                {
                    after: getTempoSignatureTrackEventsDiagState(),
                },
            );
        }
        return applied;
    }

    function refreshMusicalGridTrackEventsAfterMasterDurationReady() {
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('track/master/ready', {
                before: getTempoSignatureTrackEventsDiagState(),
            });
        }
        const applied = tryApplyPendingMusicalGridTrackEvents();
        if (typeof scheduleMusicalGridRedraw === 'function') {
            scheduleMusicalGridRedraw();
        } else if (typeof refreshMusicalGridTracks === 'function') {
            refreshMusicalGridTracks();
        }
        return applied;
    }

    function normalizeTempoTrackEvents(raw, meterSpec, durationSec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!(durationSec > 0) || !meterSpec) return [];
        const boundaries = collectMeterBarBoundariesForTempoSync(meterSpec, durationSec);
        const events = [];
        if (Array.isArray(raw)) {
            for (let i = 0; i < raw.length; i++) {
                const e = raw[i];
                if (!e || typeof e !== 'object') continue;
                const sec = Number(e.sec);
                const bpm = Number(e.bpm);
                const barIndexRaw = Number(e.barIndex != null ? e.barIndex : e.bar);
                if (!Number.isFinite(sec) || !Number.isFinite(bpm)) continue;
                if (!(bpm > 0 && bpm <= 999)) continue;
                const ev = { sec: Math.max(0, sec), bpm: bpm };
                if (Number.isFinite(barIndexRaw) && barIndexRaw >= 0) {
                    ev.barIndex = barIndexRaw | 0;
                }
                events.push(ev);
            }
        }
        events.sort((a, b) => {
            const aBar = a.barIndex != null ? a.barIndex : null;
            const bBar = b.barIndex != null ? b.barIndex : null;
            if (aBar != null && bBar != null && aBar !== bBar) return aBar - bBar;
            if (aBar != null && bBar == null) return -1;
            if (aBar == null && bBar != null) return 1;
            return a.sec - b.sec;
        });
        const deduped = [];
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (deduped.length) {
                const prev = deduped[deduped.length - 1];
                const sameBar =
                    ev.barIndex != null &&
                    prev.barIndex != null &&
                    ev.barIndex === prev.barIndex;
                const sameSec =
                    ev.barIndex == null &&
                    prev.barIndex == null &&
                    Math.abs(ev.sec - prev.sec) < 1e-6;
                if (sameBar || sameSec) {
                    deduped[deduped.length - 1] = ev;
                    continue;
                }
            }
            deduped.push(ev);
        }
        const entry0 = getMeterEntryForBar(meterSpec, 0);
        const defaultBpm = entry0 ? entry0.bpm : 120;
        if (!deduped.length || deduped[0].sec > 1e-9) {
            deduped.unshift({ sec: 0, bpm: defaultBpm, barIndex: 0 });
        } else {
            deduped[0].sec = 0;
            deduped[0].barIndex = 0;
        }
        for (let i = 1; i < deduped.length; i++) {
            if (!(deduped[i].barIndex != null && deduped[i].barIndex > 0)) {
                if (boundaries.length >= 2) {
                    deduped[i].barIndex = barIndexForBoundarySec(deduped[i].sec, boundaries);
                } else {
                    deduped[i].barIndex = deduped[i - 1].barIndex + 1;
                }
            }
            if (deduped[i].barIndex <= deduped[i - 1].barIndex) {
                deduped[i].barIndex = deduped[i - 1].barIndex + 1;
            }
        }
        if (!o.preserveInputTempoSecs) {
            syncTempoEventSecsFromBarIndices(deduped, meterSpec, durationSec);
        }
        return deduped;
    }

    function buildTempoTrackEventsFromMeterSpec(meterSpec, durationSec) {
        const boundaries = collectMeterBarBoundariesForTempoSync(meterSpec, durationSec);
        if (boundaries.length < 2) {
            const entry = getMeterEntryForBar(meterSpec, 0);
            return [{ sec: 0, bpm: entry ? entry.bpm : 120, barIndex: 0 }];
        }
        const events = [];
        let lastBpm = null;
        for (let barIndex = 0; barIndex < boundaries.length - 1; barIndex++) {
            const entry = getMeterEntryForBar(meterSpec, barIndex);
            if (!entry) break;
            const bpm = entry.bpm;
            if (lastBpm == null || bpm !== lastBpm) {
                events.push({
                    sec: boundaries[barIndex],
                    bpm: bpm,
                    barIndex: barIndex,
                });
                lastBpm = bpm;
            }
        }
        if (!events.length || events[0].sec > 1e-9) {
            const entry = getMeterEntryForBar(meterSpec, 0);
            events.unshift({
                sec: 0,
                bpm: entry ? entry.bpm : 120,
                barIndex: 0,
            });
        } else {
            events[0].barIndex = 0;
        }
        return events;
    }

    function getTempoTrackEvents(meterSpec, durationSec) {
        if (tempoTrackEventsOverride && tempoTrackEventsOverride.length) {
            return normalizeTempoTrackEvents(
                tempoTrackEventsOverride,
                meterSpec,
                durationSec,
            );
        }
        return buildTempoTrackEventsFromMeterSpec(meterSpec, durationSec);
    }

    function resolveTempoBpmAtSec(sec, meterSpec, events) {
        const t = Number(sec);
        if (!Number.isFinite(t) || !events || !events.length) {
            const entry = getMeterEntryForBar(meterSpec, 0);
            return entry ? entry.bpm : 120;
        }
        let bpm = events[0].bpm;
        for (let i = 0; i < events.length; i++) {
            if (events[i].sec <= t + 1e-9) bpm = events[i].bpm;
            else break;
        }
        return bpm;
    }

    /**
     * リハーサルマーク sec へ挿入する BPM — マーク位置より手前のタイムラインを遡る。
     * Tempo トラックが sparse でも meterSpec 側の継承（例: B 2 小節目 160 → C 頭）を拾う。
     */
    function resolveTempoBpmLookbackAtMarkSec(sec, meterSpec, master) {
        const t = Number(sec);
        if (!Number.isFinite(t) || !meterSpec || !(master > 0)) {
            const entry = getMeterEntryForBar(meterSpec, 0);
            return entry ? entry.bpm : 120;
        }
        const clamped = Math.max(0, Math.min(t, master));
        const tempoEvents = getTempoTrackEvents(meterSpec, master);
        const fromTrack = resolveTempoBpmAtSec(clamped, meterSpec, tempoEvents);
        const fromSpecTrack = buildTempoTrackEventsFromMeterSpec(meterSpec, master);
        const fromSpec = resolveTempoBpmAtSec(clamped, meterSpec, fromSpecTrack);
        if (Math.abs(fromTrack - fromSpec) > 1e-9) {
            return fromSpec;
        }
        return fromTrack;
    }

    /**
     * リハーサルマーク sec へ挿入する拍子 — マーク位置より手前のタイムラインを遡る。
     * Signature トラックが sparse でも meterSpec 側の継承を拾う。
     */
    function resolveSigLookbackAtMarkSec(sec, meterSpec, master) {
        const t = Number(sec);
        if (!Number.isFinite(t) || !meterSpec || !(master > 0)) {
            const entry = getMeterEntryForBar(meterSpec, 0);
            return entry
                ? cloneMeterSigForTempoSync(entry.sig)
                : { num: 4, den: 4 };
        }
        const clamped = Math.max(0, Math.min(t, master));
        const boundaries = collectMeterBarBoundariesForRegionSwap(meterSpec, master);
        const bi = barIndexForBoundarySec(clamped, boundaries);
        const sigEvents = getSignatureTrackEvents(meterSpec, master);
        const fromTrack = resolveSigAtBarIndex(bi, sigEvents);
        const fromSpecEvents = buildSignatureTrackEventsFromMeterSpec(meterSpec, master);
        const fromSpec = resolveSigAtBarIndex(bi, fromSpecEvents);
        if (!meterSigTextEqual(fromTrack, fromSpec)) {
            return cloneMeterSigForTempoSync(fromSpec);
        }
        return cloneMeterSigForTempoSync(fromTrack);
    }

    function clearTempoTrackEventsOverride() {
        if (typeof musicalTrackPersistDiagLog === 'function' && tempoTrackEventsOverride) {
            musicalTrackPersistDiagLog('tempo/clear', {
                hadOverride: !!tempoTrackEventsOverride.length,
            });
        }
        tempoTrackEventsOverride = null;
    }

    function setTempoTrackEvents(events, meterSpec, durationSec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!events || !events.length) {
            clearTempoTrackEventsOverride();
            return [];
        }
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('tempo/set/begin', {
                durationSec: durationSec,
                input:
                    typeof musicalTrackPersistDiagSummarizeTempoEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeTempoEvents(events)
                        : { count: Array.isArray(events) ? events.length : 0 },
                before: getTempoSignatureTrackEventsDiagState(),
            });
        }
        const normalized = normalizeTempoTrackEvents(events, meterSpec, durationSec, o);
        tempoTrackEventsOverride = normalized.slice();
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('tempo/set/done', {
                durationSec: durationSec,
                normalized:
                    typeof musicalTrackPersistDiagSummarizeTempoEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeTempoEvents(normalized)
                        : { count: normalized.length },
                after: getTempoSignatureTrackEventsDiagState(),
            });
        }
        return normalized;
    }

    function barDurationSecWithTempoEvents(barStartSec, barIndex, meterSpec, events, maxSec) {
        const entry = getMeterEntryForBar(meterSpec, barIndex);
        if (!entry) return 0;
        const segments = getMeterSigSegments(entry.sig);
        let t = barStartSec;
        for (let si = 0; si < segments.length; si++) {
            const seg = segments[si];
            for (let b = 0; b < seg.num; b++) {
                if (t >= maxSec - 1e-9) return Math.max(0, t - barStartSec);
                const bpm = resolveTempoBpmAtSec(t, meterSpec, events);
                t += beatDurationSec(seg, bpm);
            }
        }
        return Math.max(0, t - barStartSec);
    }

    function syncMeterSpecBpmFromTempoEvents(events, meterSpec, durationSec) {
        if (!meterSpec || !meterSpec.entries || !meterSpec.entries.length) return null;
        if (!(durationSec > 0)) return null;
        const boundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(meterSpec, durationSec)
                : typeof collectBarBoundarySecs === 'function'
                  ? collectBarBoundarySecs(meterSpec, durationSec)
                  : [];
        if (boundaries.length < 2) return null;
        const entries = meterSpec.entries.map((entry) => ({
            bpm: entry.bpm,
            sig: cloneMeterSigForTempoSync(entry.sig),
        }));
        for (let barIndex = 0; barIndex < boundaries.length - 1; barIndex++) {
            const sec = boundaries[barIndex];
            const bpm = resolveTempoBpmAtSec(sec, meterSpec, events);
            const idx = getRawMeterEntryIndexForBar(meterSpec, barIndex);
            if (idx >= 0 && entries[idx]) entries[idx].bpm = bpm;
        }
        return Object.assign({}, meterSpec, {
            entries,
            mode:
                entries.length === 1
                    ? 'fixed'
                    : meterSpec.mode === 'alternate'
                      ? 'alternate'
                      : 'sequence',
        });
    }

    function cloneMeterSigForTempoSync(sig) {
        return cloneMeterSig(sig);
    }

    function applyTempoTrackEvents(events, meterSpec, durationSec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const normalized = setTempoTrackEvents(events, meterSpec, durationSec, o);
        if (o.skipMeterSpecRebuild) return normalized;
        const nextSpec = rebuildMeterSpecFromTrackEvents(meterSpec, durationSec, o);
        if (normalized.length && nextSpec) {
            const patched = normalized.map((e) => Object.assign({}, e));
            if (syncTempoEventSecsFromBarIndices(patched, nextSpec, durationSec)) {
                tempoTrackEventsOverride = patched;
                rebuildMeterSpecFromTrackEvents(meterSpec, durationSec, o);
                return patched;
            }
        }
        return normalized;
    }

    /** Signature トラック — 小節単位の拍子変化点（barIndex, sig） */
    let signatureTrackEventsOverride = null;

    function normalizeSigFromPersist(raw) {
        if (!raw) return null;
        if (typeof raw === 'string') {
            return typeof parseMeterSigPart === 'function' ? parseMeterSigPart(raw) : null;
        }
        if (typeof raw === 'object') {
            if (Array.isArray(raw.segments) && raw.segments.length) {
                const segments = [];
                for (let i = 0; i < raw.segments.length; i++) {
                    const s = raw.segments[i];
                    const num = Number(s && s.num);
                    const den = Number(s && s.den);
                    if (
                        !(Number.isFinite(num) && num > 0 && Number.isFinite(den) && den > 0)
                    ) {
                        return null;
                    }
                    segments.push({ num, den });
                }
                return segmentsToMeterSig(segments);
            }
            if (Array.isArray(raw.alternates) && raw.alternates.length) {
                const alternates = [];
                for (let i = 0; i < raw.alternates.length; i++) {
                    const s = raw.alternates[i];
                    const num = Number(s && s.num);
                    const den = Number(s && s.den);
                    if (
                        !(Number.isFinite(num) && num > 0 && Number.isFinite(den) && den > 0)
                    ) {
                        return null;
                    }
                    alternates.push({ num, den });
                }
                return alternatesToMeterSig(alternates);
            }
            const num = Number(raw.num);
            const den = Number(raw.den);
            if (Number.isFinite(num) && Number.isFinite(den) && num > 0 && den > 0) {
                return cloneMeterSigForTempoSync(raw);
            }
        }
        return null;
    }

    function normalizeSignatureTrackEvents(raw, meterSpec) {
        const events = [];
        if (Array.isArray(raw)) {
            for (let i = 0; i < raw.length; i++) {
                const e = raw[i];
                if (!e || typeof e !== 'object') continue;
                const barIndex = Number(e.barIndex != null ? e.barIndex : e.bar);
                const sig = normalizeSigFromPersist(e.sig);
                if (!Number.isFinite(barIndex) || barIndex < 0 || !sig) continue;
                events.push({ barIndex: barIndex | 0, sig: sig });
            }
        }
        events.sort((a, b) => a.barIndex - b.barIndex);
        const deduped = [];
        for (let i = 0; i < events.length; i++) {
            if (deduped.length && events[i].barIndex === deduped[deduped.length - 1].barIndex) {
                deduped[deduped.length - 1] = events[i];
            } else {
                deduped.push(events[i]);
            }
        }
        const entry0 = getMeterEntryForBar(meterSpec, 0);
        const defaultSig = entry0 ? cloneMeterSigForTempoSync(entry0.sig) : { num: 4, den: 4 };
        if (!deduped.length || deduped[0].barIndex !== 0) {
            deduped.unshift({ barIndex: 0, sig: defaultSig });
        } else {
            deduped[0].barIndex = 0;
        }
        return deduped;
    }

    function buildSignatureTrackEventsFromMeterSpec(meterSpec, durationSec) {
        const boundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(meterSpec, durationSec)
                : typeof collectBarBoundarySecs === 'function'
                  ? collectBarBoundarySecs(meterSpec, durationSec)
                  : [];
        if (boundaries.length < 2) {
            const entry = getMeterEntryForBar(meterSpec, 0);
            return [
                {
                    barIndex: 0,
                    sig: entry
                        ? cloneMeterSigForTempoSync(entry.sig)
                        : { num: 4, den: 4 },
                },
            ];
        }
        const events = [];
        let lastSigText = null;
        for (let barIndex = 0; barIndex < boundaries.length - 1; barIndex++) {
            const entry = getMeterEntryForBar(meterSpec, barIndex);
            if (!entry) break;
            const sigText = formatMeterSigText(entry.sig);
            if (lastSigText == null || sigText !== lastSigText) {
                events.push({
                    barIndex: barIndex,
                    sig: cloneMeterSigForTempoSync(entry.sig),
                });
                lastSigText = sigText;
            }
        }
        if (!events.length || events[0].barIndex !== 0) {
            const entry = getMeterEntryForBar(meterSpec, 0);
            events.unshift({
                barIndex: 0,
                sig: entry
                    ? cloneMeterSigForTempoSync(entry.sig)
                    : { num: 4, den: 4 },
            });
        }
        return events;
    }

    function getSignatureTrackEvents(meterSpec, durationSec) {
        if (signatureTrackEventsOverride && signatureTrackEventsOverride.length) {
            return normalizeSignatureTrackEvents(signatureTrackEventsOverride, meterSpec);
        }
        return buildSignatureTrackEventsFromMeterSpec(meterSpec, durationSec);
    }

    function resolveSigAtBarIndex(barIndex, events) {
        const bi = barIndex | 0;
        if (!events || !events.length) return { num: 4, den: 4 };
        let sig = events[0].sig;
        for (let i = 0; i < events.length; i++) {
            if (events[i].barIndex <= bi) sig = events[i].sig;
            else break;
        }
        return sig;
    }

    function clearSignatureTrackEventsOverride() {
        if (typeof musicalTrackPersistDiagLog === 'function' && signatureTrackEventsOverride) {
            musicalTrackPersistDiagLog('signature/clear', {
                hadOverride: !!signatureTrackEventsOverride.length,
            });
        }
        signatureTrackEventsOverride = null;
    }

    function setSignatureTrackEvents(events, meterSpec) {
        if (!events || !events.length) {
            clearSignatureTrackEventsOverride();
            return [];
        }
        clearMusicalGridTrackEventsPersistPending();
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('signature/set/begin', {
                input:
                    typeof musicalTrackPersistDiagSummarizeSignatureEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeSignatureEvents(events)
                        : { count: Array.isArray(events) ? events.length : 0 },
                before: getTempoSignatureTrackEventsDiagState(),
            });
        }
        const normalized = normalizeSignatureTrackEvents(events, meterSpec);
        signatureTrackEventsOverride = normalized.map((e) => ({
            barIndex: e.barIndex,
            sig: cloneMeterSigForTempoSync(e.sig),
        }));
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('signature/set/done', {
                normalized:
                    typeof musicalTrackPersistDiagSummarizeSignatureEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeSignatureEvents(normalized)
                        : { count: normalized.length },
                after: getTempoSignatureTrackEventsDiagState(),
            });
        }
        return normalized;
    }

    function barIndexForBoundarySec(sec, boundaries) {
        const t = Number(sec);
        if (!Number.isFinite(t) || !boundaries || boundaries.length < 2) return 0;
        let barIndex = 0;
        for (let i = 0; i < boundaries.length - 1; i++) {
            if (t >= boundaries[i + 1] - 1e-9) barIndex = i + 1;
            else if (t >= boundaries[i] - 1e-9) return i;
        }
        return barIndex;
    }

    function rebuildMeterSpecFromTrackEvents(meterSpec, durationSec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!meterSpec || !meterSpec.entries || !meterSpec.entries.length) return null;
        if (!(durationSec > 0)) return null;
        const tempoEvents = getTempoTrackEvents(meterSpec, durationSec);
        const sigEvents = getSignatureTrackEvents(meterSpec, durationSec);
        if (
            !o.skipDurationDefer &&
            shouldDeferMusicalGridTrackEventsApply(
                {
                    tempoTrackEvents: tempoEvents,
                    signatureTrackEvents: sigEvents,
                },
                durationSec,
                meterSpec,
            )
        ) {
            if (typeof musicalTrackPersistDiagLog === 'function') {
                musicalTrackPersistDiagLog('track/rebuild/skip-short-duration', {
                    durationSec: durationSec,
                    minRequiredSec: minDurationSecForMusicalGridTrackApply(
                        {
                            tempoTrackEvents: tempoEvents,
                            signatureTrackEvents: sigEvents,
                        },
                        meterSpec,
                    ),
                });
            }
            return null;
        }
        const boundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(meterSpec, durationSec)
                : typeof collectBarBoundarySecs === 'function'
                  ? collectBarBoundarySecs(meterSpec, durationSec)
                  : [];
        if (boundaries.length < 2) return null;
        let lastChangeBar = 0;
        for (let i = 1; i < tempoEvents.length; i++) {
            if (tempoEvents[i].barIndex != null && tempoEvents[i].barIndex >= 0) {
                lastChangeBar = Math.max(lastChangeBar, tempoEvents[i].barIndex | 0);
            } else {
                const bi = barIndexForBoundarySec(tempoEvents[i].sec, boundaries);
                lastChangeBar = Math.max(lastChangeBar, bi);
            }
        }
        for (let i = 1; i < sigEvents.length; i++) {
            lastChangeBar = Math.max(lastChangeBar, sigEvents[i].barIndex);
        }
        const entryCount = Math.max(1, lastChangeBar + 1);
        let entries = [];
        for (let i = 0; i < entryCount; i++) {
            const bpm = resolveTempoBpmAtBarIndex(i, tempoEvents);
            const sig = resolveSigAtBarIndex(i, sigEvents);
            entries.push({ bpm: bpm, sig: cloneMeterSigForTempoSync(sig) });
        }
        let mode = entries.length === 1 ? 'fixed' : 'sequence';
        if (entries.length > 1) {
            const first = entries[0];
            let allSame = true;
            for (let i = 1; i < entries.length; i++) {
                if (
                    entries[i].bpm !== first.bpm ||
                    !meterSigTextEqual(entries[i].sig, first.sig)
                ) {
                    allSame = false;
                    break;
                }
            }
            if (allSame) {
                entries = [
                    { bpm: first.bpm, sig: cloneMeterSigForTempoSync(first.sig) },
                ];
                mode = 'fixed';
            }
        }
        const nextSpec = Object.assign({}, meterSpec, {
            entries: entries,
            mode: mode,
        });
        setCommittedMeterSpec(nextSpec);
        if (typeof clearMusicalGridPositionCache === 'function') clearMusicalGridPositionCache();
        return nextSpec;
    }

    function applySignatureTrackEvents(events, meterSpec, durationSec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const normalized = setSignatureTrackEvents(events, meterSpec);
        if (o.skipMeterSpecRebuild) return normalized;
        let spec = meterSpec;
        for (let pass = 0; pass < 2; pass++) {
            const nextSpec = rebuildMeterSpecFromTrackEvents(spec, durationSec, o);
            if (!nextSpec) break;
            spec = nextSpec;
        }
        return normalized;
    }

    /** 展開 counts から Rehearsal グループ先頭小節 index を求める */
    function rehearsalGroupBarStartIndexFromCounts(counts, groupIndex) {
        if (!Array.isArray(counts) || !(groupIndex > 0)) return 0;
        let barStart = 0;
        const gi = groupIndex | 0;
        for (let c = 0; c < gi && c < counts.length; c++) {
            barStart += counts[c] | 0;
        }
        return barStart;
    }

    function cloneMeterBarEntry(entry) {
        if (!entry) return { bpm: 120, sig: cloneMeterSigForTempoSync({ num: 4, den: 4 }) };
        return {
            bpm: entry.bpm,
            sig: cloneMeterSigForTempoSync(entry.sig),
        };
    }

    function collectMeterBarBoundariesForRegionSwap(meterSpec, durationSec) {
        if (typeof collectPlaybackAlignedBarBoundarySecs === 'function') {
            return collectPlaybackAlignedBarBoundarySecs(meterSpec, durationSec);
        }
        if (typeof collectBarBoundarySecs === 'function') {
            return collectBarBoundarySecs(meterSpec, durationSec);
        }
        return [];
    }

    /** Tempo/Sig トラック（override 含む）から小節ごとの bpm/sig を列挙 */
    function collectPerBarMeterEntriesFromTracks(meterSpec, durationSec) {
        if (!meterSpec || !(durationSec > 0)) return [];
        const boundaries = collectMeterBarBoundariesForRegionSwap(meterSpec, durationSec);
        const totalBars = Math.max(0, boundaries.length - 1);
        if (!totalBars) return [];
        const tempoEvents = getTempoTrackEvents(meterSpec, durationSec);
        const sigEvents = getSignatureTrackEvents(meterSpec, durationSec);
        const out = [];
        for (let i = 0; i < totalBars; i++) {
            const secAtBar =
                boundaries.length > i && Number.isFinite(boundaries[i])
                    ? Math.min(boundaries[i], durationSec)
                    : secForBarIndex(i, meterSpec, durationSec);
            out.push({
                bpm: resolveTempoBpmAtSec(secAtBar, meterSpec, tempoEvents),
                sig: cloneMeterSigForTempoSync(resolveSigAtBarIndex(i, sigEvents)),
            });
        }
        return out;
    }

    function splitPerBarEntriesByRehearsalCounts(perBar, counts) {
        const groups = [];
        if (!Array.isArray(perBar) || !Array.isArray(counts)) return groups;
        let bar = 0;
        for (let gi = 0; gi < counts.length; gi++) {
            const len = counts[gi] | 0;
            if (len <= 0) {
                groups.push([]);
                continue;
            }
            const slice = [];
            for (let j = 0; j < len; j++) {
                slice.push(
                    bar + j < perBar.length
                        ? cloneMeterBarEntry(perBar[bar + j])
                        : cloneMeterBarEntry(perBar.length ? perBar[perBar.length - 1] : null),
                );
            }
            groups.push(slice);
            bar += len;
        }
        return groups;
    }

    function concatRehearsalGroupMeterSlices(groups, counts) {
        const out = [];
        if (!Array.isArray(counts)) return out;
        for (let gi = 0; gi < counts.length; gi++) {
            const slice = groups && groups[gi] ? groups[gi] : [];
            const need = counts[gi] | 0;
            for (let j = 0; j < need; j++) {
                if (j < slice.length) {
                    out.push(cloneMeterBarEntry(slice[j]));
                } else if (slice.length) {
                    out.push(cloneMeterBarEntry(slice[slice.length - 1]));
                } else if (out.length) {
                    out.push(cloneMeterBarEntry(out[out.length - 1]));
                } else {
                    out.push(cloneMeterBarEntry(null));
                }
            }
        }
        return out;
    }

    function resolveMeterSpecModeFromEntries(entries) {
        if (!entries || !entries.length) return 'fixed';
        if (entries.length === 1) return 'fixed';
        const first = entries[0];
        for (let i = 1; i < entries.length; i++) {
            const e = entries[i];
            if (
                e.bpm !== first.bpm ||
                !meterSigTextEqual(e.sig, first.sig)
            ) {
                return 'sequence';
            }
        }
        return 'fixed';
    }

    function barIndexFitsWithinDurationSec(barIndex, meterSpec, durationSec) {
        if (!(durationSec > 0)) return true;
        const sec = secForBarIndex(barIndex | 0, meterSpec, durationSec);
        return sec <= durationSec + 1e-6;
    }

    function swapDiagRoundNum(v) {
        return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : v;
    }

    function summarizeTempoTrackForSwapDiag(spec, master, maxItems) {
        const limit = maxItems != null ? maxItems | 0 : 24;
        const events = getTempoTrackEvents(spec, master);
        const sample = [];
        for (let i = 0; i < events.length && i < limit; i++) {
            const e = events[i];
            sample.push({
                sec: swapDiagRoundNum(e.sec),
                bpm: e.bpm,
                bar: e.barIndex != null ? e.barIndex | 0 : null,
            });
        }
        return { count: events.length, sample: sample };
    }

    function summarizeSigTrackForSwapDiag(spec, master, maxItems) {
        const limit = maxItems != null ? maxItems | 0 : 24;
        const events = getSignatureTrackEvents(spec, master);
        const sample = [];
        for (let i = 0; i < events.length && i < limit; i++) {
            const e = events[i];
            sample.push({
                bar: e.barIndex | 0,
                sig: formatMeterSigText(e.sig),
            });
        }
        return { count: events.length, sample: sample };
    }

    function summarizePerBarSliceForSwapDiag(perBar, start, count, label) {
        const s = start | 0;
        const n = count | 0;
        const bars = [];
        for (let i = 0; i < n; i++) {
            const idx = s + i;
            if (idx < 0 || idx >= perBar.length) {
                bars.push({ bar: idx, missing: true });
                continue;
            }
            bars.push({
                bar: idx,
                bpm: perBar[idx].bpm,
                sig: formatMeterSigText(perBar[idx].sig),
            });
        }
        return { label: label || '', start: s, count: n, bars: bars };
    }

    /** mark sec ↔ transport bar ↔ score bar の対応と、各座標系での meter 値 */
    function resolveMarkSecMeterDiagEntries(markSecs, spec, master, scoreBarStarts) {
        if (!spec || !(master > 0)) return [];
        const boundaries = collectMeterBarBoundariesForRegionSwap(spec, master);
        const perBar = collectPerBarMeterEntriesFromTracks(spec, master);
        const transportBarCount = Math.max(0, boundaries.length - 1);
        const secs = Array.isArray(markSecs) ? markSecs : [];
        const scoreStarts = Array.isArray(scoreBarStarts) ? scoreBarStarts : [];
        const out = [];
        for (let i = 0; i < secs.length; i++) {
            const sec = Number(secs[i]);
            if (!Number.isFinite(sec)) continue;
            const t = Math.max(0, Math.min(sec, master));
            const transportBar = barIndexForBoundarySec(t, boundaries);
            const scoreBar = scoreStarts[i] != null ? scoreStarts[i] | 0 : null;
            const bpmAtSec = resolveTempoBpmLookbackAtMarkSec(t, spec, master);
            const sigAtTransportBar = resolveSigLookbackAtMarkSec(t, spec, master);
            const perBarTransport =
                transportBar >= 0 && transportBar < perBar.length ? perBar[transportBar] : null;
            const perBarScore =
                scoreBar != null && scoreBar >= 0 && scoreBar < perBar.length
                    ? perBar[scoreBar]
                    : null;
            out.push({
                markIndex: i,
                sec: swapDiagRoundNum(t),
                transportBar: transportBar,
                transportBarSec:
                    transportBar >= 0 && transportBar < boundaries.length
                        ? swapDiagRoundNum(boundaries[transportBar])
                        : null,
                scoreBar: scoreBar,
                bpmAtSec: bpmAtSec,
                sigAtSec: formatMeterSigText(sigAtTransportBar),
                perBarTransport: perBarTransport
                    ? {
                          bpm: perBarTransport.bpm,
                          sig: formatMeterSigText(perBarTransport.sig),
                      }
                    : null,
                perBarScore: perBarScore
                    ? { bpm: perBarScore.bpm, sig: formatMeterSigText(perBarScore.sig) }
                    : null,
                coordMismatch:
                    scoreBar != null &&
                    perBarScore &&
                    perBarTransport &&
                    (perBarScore.bpm !== perBarTransport.bpm ||
                        formatMeterSigText(perBarScore.sig) !==
                            formatMeterSigText(perBarTransport.sig)),
            });
        }
        return out;
    }

    function logTempoSigSwapStage(stage, spec, master, extra) {
        if (!spec || !(master > 0)) {
            rehearsalSwapDiagLog(stage, Object.assign({ master: master, ok: false }, extra || {}));
            return;
        }
        const boundaries = collectMeterBarBoundariesForRegionSwap(spec, master);
        const payload = Object.assign(
            {
                masterSec: swapDiagRoundNum(master),
                transportBarCount: Math.max(0, boundaries.length - 1),
                tempo: summarizeTempoTrackForSwapDiag(spec, master),
                sig: summarizeSigTrackForSwapDiag(spec, master),
                meterSpec: {
                    mode: spec.mode,
                    entryCount: spec.entries ? spec.entries.length : 0,
                },
            },
            extra || {},
        );
        rehearsalSwapDiagLog(stage, payload);
    }

    function upsertTempoEventAtSec(tempoEvents, sec, bpm, barIndexHint, master) {
        const t = Math.max(0, Math.min(Number(sec), master));
        const bi = barIndexHint != null ? barIndexHint | 0 : null;
        for (let i = 0; i < tempoEvents.length; i++) {
            const ev = tempoEvents[i];
            if (Math.abs(ev.sec - t) < 1e-4) {
                ev.bpm = bpm;
                if (bi != null) ev.barIndex = bi;
                return;
            }
            if (bi != null && ev.barIndex != null && (ev.barIndex | 0) === bi) {
                ev.bpm = bpm;
                ev.sec = t;
                return;
            }
        }
        const next = { sec: t, bpm: bpm };
        if (bi != null) next.barIndex = bi;
        tempoEvents.push(next);
        tempoEvents.sort((a, b) => a.sec - b.sec);
    }

    function upsertSigEventAtBar(sigEvents, barIndex, sig) {
        const bi = barIndex | 0;
        for (let i = 0; i < sigEvents.length; i++) {
            if ((sigEvents[i].barIndex | 0) === bi) {
                sigEvents[i].sig = cloneMeterSigForTempoSync(sig);
                return;
            }
        }
        sigEvents.push({
            barIndex: bi,
            sig: cloneMeterSigForTempoSync(sig),
        });
        sigEvents.sort((a, b) => (a.barIndex | 0) - (b.barIndex | 0));
    }

    /** swap 前 — リハーサルマーク sec 上の継承 Tempo/Sig を明示イベント化 */
    function captureMeterPrepSnapshotsAtMarkSecs(markSecs, spec, master) {
        if (!spec || !(master > 0)) return [];
        const boundaries = collectMeterBarBoundariesForRegionSwap(spec, master);
        const snapshots = [];
        const secs = Array.isArray(markSecs) ? markSecs : [];
        for (let i = 0; i < secs.length; i++) {
            const sec = Number(secs[i]);
            if (!Number.isFinite(sec)) continue;
            const t = Math.max(0, Math.min(sec, master));
            const bi = barIndexForBoundarySec(t, boundaries);
            const bpm = resolveTempoBpmLookbackAtMarkSec(t, spec, master);
            const sig = cloneMeterSigForTempoSync(resolveSigLookbackAtMarkSec(t, spec, master));
            snapshots.push({ sec: t, bar: bi, bpm: bpm, sig: sig });
        }
        return snapshots;
    }

    function applyMeterPinsAtMarkSecs(spec, master, pins, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!spec || !(master > 0) || !pins || !pins.length) return false;
        const boundaries = collectMeterBarBoundariesForRegionSwap(spec, master);
        const tempoEvents = getTempoTrackEvents(spec, master).map((e) => Object.assign({}, e));
        const sigEvents = getSignatureTrackEvents(spec, master).map((e) => ({
            barIndex: e.barIndex | 0,
            sig: cloneMeterSigForTempoSync(e.sig),
        }));
        for (let i = 0; i < pins.length; i++) {
            const p = pins[i];
            if (!p) continue;
            const t = Math.max(0, Math.min(Number(p.sec), master));
            const bi =
                p.bar != null
                    ? p.bar | 0
                    : barIndexForBoundarySec(t, boundaries);
            upsertTempoEventAtSec(tempoEvents, t, p.bpm, bi, master);
            upsertSigEventAtBar(sigEvents, bi, p.sig);
        }
        applyTempoTrackEvents(tempoEvents, spec, master, Object.assign({}, o, {
            skipMeterSpecRebuild: true,
            preserveInputTempoSecs: true,
        }));
        applySignatureTrackEvents(sigEvents, spec, master, Object.assign({}, o, {
            skipMeterSpecRebuild: true,
        }));
        return true;
    }

    function prepareTempoSignatureAtMarkSecs(markSecs, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return [];
        const snapshots = captureMeterPrepSnapshotsAtMarkSecs(markSecs, spec, master);
        if (!snapshots.length) return [];
        applyMeterPinsAtMarkSecs(spec, master, snapshots, o);
        readMusicalGridFromInputs();
        const specAfter = getMeterSpec();
        logTempoSigSwapStage('tempo-sig/prep-mark-secs', specAfter, master, {
            snapshots: snapshots.map((s) => ({
                sec: s.sec,
                bar: s.bar,
                bpm: s.bpm,
                sig: formatMeterSigText(s.sig),
            })),
            marks: resolveMarkSecMeterDiagEntries(markSecs, specAfter, master, null),
        });
        return snapshots;
    }

    /** swap 後 — マーク sec 上の Tempo/Sig を prep スナップショット入れ替えで再 pin */
    function postPinMeterMarksAfterSlotSwap(markSecs, prepSnapshots, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!Array.isArray(markSecs) || markSecs.length < 2) return false;
        if (!Array.isArray(prepSnapshots) || prepSnapshots.length < 2) return false;
        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return false;
        const pins = [
            {
                sec: markSecs[0],
                bpm: prepSnapshots[1].bpm,
                sig: prepSnapshots[1].sig,
            },
            {
                sec: markSecs[1],
                bpm: prepSnapshots[0].bpm,
                sig: prepSnapshots[0].sig,
            },
        ];
        applyMeterPinsAtMarkSecs(spec, master, pins, o);
        readMusicalGridFromInputs();
        const specAfter = getMeterSpec();
        logTempoSigSwapStage('tempo-sig/post-pin-mark-secs', specAfter, master, {
            pins: pins.map((p) => ({
                sec: p.sec,
                bpm: p.bpm,
                sig: formatMeterSigText(p.sig),
            })),
            marks: resolveMarkSecMeterDiagEntries(markSecs, specAfter, master, null),
        });
        return true;
    }

    /**
     * partial RegionSwap 後 — score 小節列を transport 小節 index に投影（UI グリッド用）。
     * 6/4 等が score bar 31+ にのみ存在する場合、11s 付近の transport bar に反映する。
     */
    function projectScoreMeterSpansOntoTransport(spans, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!Array.isArray(spans) || !spans.length) return false;
        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return false;

        const boundaries = collectMeterBarBoundariesForRegionSwap(spec, master);
        const transportBarCount = Math.max(0, boundaries.length - 1);
        const sigEvents = getSignatureTrackEvents(spec, master).map((e) => ({
            barIndex: e.barIndex | 0,
            sig: cloneMeterSigForTempoSync(e.sig),
        }));
        const projected = [];

        for (let s = 0; s < spans.length; s++) {
            const span = spans[s];
            if (!span || typeof span !== 'object') continue;
            const tSec = Number(span.transportStartSec);
            const scoreStart = span.scoreBarStart | 0;
            const barCount = span.barCount | 0;
            if (!Number.isFinite(tSec) || barCount <= 0 || scoreStart < 0) continue;
            const tClamped = Math.max(0, Math.min(tSec, master));
            let transportBar = barIndexForBoundarySec(tClamped, boundaries);
            for (let j = 0; j < barCount; j++) {
                const tb = transportBar + j;
                if (tb >= transportBarCount) break;
                const entry = getMeterEntryForBar(spec, scoreStart + j);
                if (!entry) continue;
                upsertSigEventAtBar(sigEvents, tb, entry.sig);
                projected.push({
                    transportStartSec: swapDiagRoundNum(tClamped),
                    transportBar: tb,
                    scoreBar: scoreStart + j,
                    bpm: entry.bpm,
                    sig: formatMeterSigText(entry.sig),
                });
            }
        }

        if (!projected.length) return false;

        applySignatureTrackEvents(
            sigEvents,
            spec,
            master,
            Object.assign({}, o, { skipMeterSpecRebuild: true }),
        );

        readMusicalGridFromInputs();
        const specAfter = getMeterSpec();
        logTempoSigSwapStage('tempo-sig/project-transport', specAfter, master, {
            spans: spans,
            projected: projected,
        });
        return true;
    }

    /** perBar 列から Tempo トラックイベント（変化点）を構築 */
    function buildTempoTrackEventsFromPerBarEntries(perBarEntries, meterSpec, durationSec) {
        if (!perBarEntries || !perBarEntries.length) {
            return buildTempoTrackEventsFromMeterSpec(meterSpec, durationSec);
        }
        const events = [];
        let lastBpm = null;
        for (let i = 0; i < perBarEntries.length; i++) {
            const secRaw = secForBarIndex(i, meterSpec, durationSec);
            if (durationSec > 0 && secRaw > durationSec + 1e-6) {
                continue;
            }
            const bpm = perBarEntries[i].bpm;
            if (lastBpm == null || Math.abs(bpm - lastBpm) > 1e-9) {
                events.push({
                    barIndex: i,
                    sec:
                        durationSec > 0
                            ? Math.min(Math.max(0, secRaw), durationSec)
                            : secRaw,
                    bpm: bpm,
                });
                lastBpm = bpm;
            }
        }
        if (!events.length || events[0].barIndex !== 0) {
            events.unshift({
                barIndex: 0,
                sec: 0,
                bpm: perBarEntries[0].bpm,
            });
        }
        return events;
    }

    /** perBar 列から Signature トラックイベント（変化点）を構築 */
    function buildSignatureTrackEventsFromPerBarEntries(perBarEntries, meterSpec, durationSec) {
        if (!perBarEntries || !perBarEntries.length) {
            return buildSignatureTrackEventsFromMeterSpec(meterSpec, 0);
        }
        const events = [];
        let lastSigText = null;
        for (let i = 0; i < perBarEntries.length; i++) {
            const sigText = formatMeterSigText(perBarEntries[i].sig);
            if (lastSigText == null || sigText !== lastSigText) {
                events.push({
                    barIndex: i,
                    sig: cloneMeterSigForTempoSync(perBarEntries[i].sig),
                });
                lastSigText = sigText;
            }
        }
        const entry0 = getMeterEntryForBar(meterSpec, 0);
        const defaultSig = entry0
            ? cloneMeterSigForTempoSync(entry0.sig)
            : cloneMeterSigForTempoSync(perBarEntries[0].sig);
        if (!events.length || events[0].barIndex !== 0) {
            events.unshift({ barIndex: 0, sig: defaultSig });
        }
        return events;
    }

    /**
     * partial RegionSwap — meterSpec を再構築せず Tempo/Sig トラックだけ更新（小節線位置を固定）。
     */
    function applySwappedPerBarToTrackEventsOnly(perBarEntries, spec, durationSec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!spec || !perBarEntries || !perBarEntries.length || !(durationSec > 0)) return false;

        const boundaries = collectMeterBarBoundariesForRegionSwap(spec, durationSec);
        const tempoEvents = getTempoTrackEvents(spec, durationSec).map((e) => Object.assign({}, e));
        const sigEvents = getSignatureTrackEvents(spec, durationSec).map((e) => ({
            barIndex: e.barIndex | 0,
            sig: cloneMeterSigForTempoSync(e.sig),
        }));

        let lastBpm = resolveTempoBpmAtBarIndex(0, tempoEvents);
        for (let bi = 0; bi < perBarEntries.length; bi++) {
            const entry = perBarEntries[bi];
            if (!entry) continue;
            upsertSigEventAtBar(sigEvents, bi, entry.sig);
            if (entry.bpm !== lastBpm) {
                const secAtBar =
                    boundaries.length > bi && Number.isFinite(boundaries[bi])
                        ? Math.min(boundaries[bi], durationSec)
                        : secForBarIndex(bi, spec, durationSec);
                upsertTempoEventAtSec(tempoEvents, secAtBar, entry.bpm, bi, durationSec);
                lastBpm = entry.bpm;
            }
        }

        applyTempoTrackEvents(tempoEvents, spec, durationSec, {
            skipMeterSpecRebuild: true,
            preserveInputTempoSecs: true,
            skipSessionPersist: !!o.skipSessionPersist,
        });
        applySignatureTrackEvents(sigEvents, spec, durationSec, {
            skipMeterSpecRebuild: true,
            skipSessionPersist: !!o.skipSessionPersist,
        });
        if (typeof persistMusicalGridToStorage === 'function') {
            persistMusicalGridToStorage({ skipSessionPersist: !!o.skipSessionPersist });
        }
        if (typeof writePrefs === 'function') writePrefs();
        if (typeof window.refreshMusicalGridTracks === 'function') {
            window.refreshMusicalGridTracks();
        }
        rehearsalSwapDiagLog('tempo-sig/apply-track-only', {
            perBarLen: perBarEntries.length,
            tempoBuilt: tempoEvents.length,
            sigBuilt: sigEvents.length,
            preserveMeterSpec: true,
        });
        return true;
    }

    function applyPerBarMeterEntriesToMusicalGrid(perBarEntries, spec, durationSec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!spec || !perBarEntries || !perBarEntries.length) return false;
        const entries = perBarEntries.map((e) => ({
            bpm: e.bpm,
            sig: cloneMeterSigForTempoSync(e.sig),
        }));
        const mode = resolveMeterSpecModeFromEntries(entries);
        const normalizedEntries = mode === 'fixed' ? [entries[0]] : entries;
        const nextSpec = Object.assign({}, spec, {
            entries: normalizedEntries,
            mode: mode === 'fixed' ? 'fixed' : 'sequence',
        });
        setCommittedMeterSpec(nextSpec);
        clearTempoTrackEventsOverride();
        clearSignatureTrackEventsOverride();
        const specNow = getMeterSpec();
        const tempoEvents = buildTempoTrackEventsFromPerBarEntries(
            perBarEntries,
            specNow,
            durationSec,
        );
        const sigEvents = buildSignatureTrackEventsFromPerBarEntries(
            perBarEntries,
            specNow,
            durationSec,
        );
        setTempoTrackEvents(tempoEvents, specNow, durationSec);
        setSignatureTrackEvents(sigEvents, specNow);
        rehearsalSwapDiagLog('tempo-sig/apply-per-bar', {
            perBarLen: perBarEntries.length,
            mode: mode,
            tempoBuilt: tempoEvents.length,
            sigBuilt: sigEvents.length,
            tempoSample: tempoEvents.slice(0, 16).map((e) => ({
                sec: swapDiagRoundNum(e.sec),
                bpm: e.bpm,
                bar: e.barIndex != null ? e.barIndex | 0 : null,
            })),
            sigSample: sigEvents.slice(0, 16).map((e) => ({
                bar: e.barIndex | 0,
                sig: formatMeterSigText(e.sig),
            })),
        });
        if (typeof persistMusicalGridToStorage === 'function') {
            persistMusicalGridToStorage({ skipSessionPersist: !!o.skipSessionPersist });
        }
        if (typeof writePrefs === 'function') writePrefs();
        if (typeof window.refreshMusicalGridTracks === 'function') {
            window.refreshMusicalGridTracks();
        }
        return true;
    }

    /**
     * 非対称入れ替え — 2 つの disjoint 小節範囲を perBar 上で splice 入れ替え（総小節数不変）。
     * 例: [0][A×2][B×3][C×6] → [0][C×6][B×3][A×2]
     */
    function swapPerBarTransportRangesExclusive(perBar, startA, lenA, startB, lenB) {
        const sA = startA | 0;
        const sB = startB | 0;
        const lA = lenA | 0;
        const lB = lenB | 0;
        if (!perBar || !perBar.length || lA <= 0 || lB <= 0 || sA === sB) return false;

        const endA = sA + lA;
        const endB = sB + lB;
        if (sA < 0 || sB < 0 || endA > perBar.length || endB > perBar.length) return false;

        const sliceA = extractMeterBarSlice(perBar, sA, lA);
        const sliceB = extractMeterBarSlice(perBar, sB, lB);

        let next;
        if (sA < sB) {
            if (endA > sB) return false;
            next = perBar
                .slice(0, sA)
                .concat(sliceB, perBar.slice(endA, sB), sliceA, perBar.slice(endB));
        } else {
            if (endB > sA) return false;
            next = perBar
                .slice(0, sB)
                .concat(sliceA, perBar.slice(endB, sA), sliceB, perBar.slice(endA));
        }
        perBar.length = 0;
        for (let i = 0; i < next.length; i++) perBar.push(next[i]);
        return true;
    }

    /**
     * 非対称・小節線固定入れ替え — 2 範囲の Tempo/Sig 内容だけ入れ替え、transport 小節境界（perBar 長）は維持。
     * 小節数が異なるときは短い側を truncate、長い側は expandMeterBarSlice で pad する。
     */
    function swapPerBarTransportRangesInPlace(perBar, startA, lenA, startB, lenB) {
        const sA = startA | 0;
        const sB = startB | 0;
        const lA = lenA | 0;
        const lB = lenB | 0;
        if (!perBar || !perBar.length || lA <= 0 || lB <= 0 || sA === sB) return false;
        const endA = sA + lA;
        const endB = sB + lB;
        if (sA < 0 || sB < 0 || endA > perBar.length || endB > perBar.length) return false;
        if (sA < sB ? endA > sB : endB > sA) return false;

        const sliceA = extractMeterBarSlice(perBar, sA, lA);
        const sliceB = extractMeterBarSlice(perBar, sB, lB);
        writeMeterBarSlice(perBar, sA, lA, expandMeterBarSlice(sliceB, lA));
        writeMeterBarSlice(perBar, sB, lB, expandMeterBarSlice(sliceA, lB));
        return true;
    }

    function expandMeterBarSlice(slice, len) {
        const n = len | 0;
        if (n <= 0) return [];
        const out = [];
        const fallback = slice && slice.length ? slice[slice.length - 1] : null;
        for (let i = 0; i < n; i++) {
            if (slice && i < slice.length) {
                out.push(cloneMeterBarEntry(slice[i]));
            } else {
                out.push(cloneMeterBarEntry(fallback));
            }
        }
        return out;
    }

    function extractMeterBarSlice(perBar, start, count) {
        const slice = [];
        const len = count | 0;
        const s = start | 0;
        if (len <= 0) return slice;
        const fallback =
            perBar && perBar.length ? perBar[Math.max(0, perBar.length - 1)] : null;
        for (let i = 0; i < len; i++) {
            const idx = s + i;
            slice.push(
                idx >= 0 && idx < perBar.length
                    ? cloneMeterBarEntry(perBar[idx])
                    : cloneMeterBarEntry(fallback),
            );
        }
        return slice;
    }

    function writeMeterBarSlice(perBar, start, count, slice) {
        const len = count | 0;
        const s = start | 0;
        if (len <= 0 || !slice || !slice.length) return;
        for (let i = 0; i < len; i++) {
            const idx = s + i;
            if (idx < 0 || idx >= perBar.length) continue;
            const src = i < slice.length ? slice[i] : slice[slice.length - 1];
            perBar[idx] = cloneMeterBarEntry(src);
        }
    }

    function trackEventExistsAtBarIndex(events, barIndex) {
        const bi = barIndex | 0;
        if (!events || !events.length) return bi <= 0;
        for (let i = 0; i < events.length; i++) {
            if ((events[i].barIndex | 0) === bi) return true;
        }
        return false;
    }

    function getMeterBarCountForRegionSwap() {
        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return 0;
        return collectPerBarMeterEntriesFromTracks(spec, master).length;
    }

    /**
     * 入れ替え後 — perBar 上の実値で Tempo/Sig トラックに明示イベントを置く（UI マーカー用）。
     * 手前の継承値ではなく perBar[barIndex] の bpm/sig を使う。
     */
    function pinMeterTrackEventsFromPerBar(perBar, barStarts, spec, master, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!perBar || !perBar.length || !spec || !(master > 0)) return false;
        const indices = [];
        if (Array.isArray(barStarts)) {
            for (let i = 0; i < barStarts.length; i++) {
                const bi = barStarts[i] | 0;
                if (bi >= 0 && bi < perBar.length && indices.indexOf(bi) < 0) indices.push(bi);
            }
        }
        indices.sort((a, b) => a - b);
        if (!indices.length) return false;

        const boundaries = collectMeterBarBoundariesForRegionSwap(spec, master);
        const markSecByBar =
            o.markSecByBar && typeof o.markSecByBar === 'object' ? o.markSecByBar : null;
        const tempoRaw = getTempoTrackEvents(spec, master);
        const sigRaw = getSignatureTrackEvents(spec, master);
        const tempoEvents = tempoRaw.map((e) => Object.assign({}, e));
        const sigEvents = sigRaw.map((e) => ({
            barIndex: e.barIndex | 0,
            sig: cloneMeterSigForTempoSync(e.sig),
        }));

        for (let i = 0; i < indices.length; i++) {
            const bi = indices[i];
            const entry = perBar[bi];
            if (!entry) continue;
            const secAtBar =
                markSecByBar && Number.isFinite(markSecByBar[bi])
                    ? Math.min(markSecByBar[bi], master)
                    : boundaries.length > bi && Number.isFinite(boundaries[bi])
                      ? Math.min(boundaries[bi], master)
                      : secForBarIndex(bi, spec, master);
            const pinBpm =
                markSecByBar && Number.isFinite(markSecByBar[bi])
                    ? resolveTempoBpmLookbackAtMarkSec(secAtBar, spec, master)
                    : entry.bpm;
            let tempoFound = false;
            for (let t = 0; t < tempoEvents.length; t++) {
                if ((tempoEvents[t].barIndex | 0) === bi) {
                    tempoEvents[t].bpm = pinBpm;
                    tempoEvents[t].sec = secAtBar;
                    tempoFound = true;
                    break;
                }
            }
            if (!tempoFound) {
                tempoEvents.push({ barIndex: bi, sec: secAtBar, bpm: pinBpm });
            }
            let sigFound = false;
            for (let s = 0; s < sigEvents.length; s++) {
                if ((sigEvents[s].barIndex | 0) === bi) {
                    sigEvents[s].sig = cloneMeterSigForTempoSync(entry.sig);
                    sigFound = true;
                    break;
                }
            }
            if (!sigFound) {
                sigEvents.push({
                    barIndex: bi,
                    sig: cloneMeterSigForTempoSync(entry.sig),
                });
            }
        }

        tempoEvents.sort(
            (a, b) =>
                (a.barIndex != null ? a.barIndex | 0 : 0) -
                (b.barIndex != null ? b.barIndex | 0 : 0),
        );
        sigEvents.sort((a, b) => (a.barIndex | 0) - (b.barIndex | 0));

        const applyOpt = Object.assign({}, o);
        if (applyOpt.skipMeterSpecRebuild) {
            applyOpt.preserveInputTempoSecs = applyOpt.preserveInputTempoSecs !== false;
        }
        applyTempoTrackEvents(tempoEvents, spec, master, applyOpt);
        applySignatureTrackEvents(sigEvents, spec, master, applyOpt);

        rehearsalSwapDiagLog('tempo-sig/pin-bar-starts', {
            bars: indices,
            pinned: indices.map((bi) => ({
                bar: bi,
                bpm: perBar[bi].bpm,
                sig: formatMeterSigText(perBar[bi].sig),
            })),
        });
        return true;
    }

    /**
     * RegionSwap 前 — 指定小節先頭に Tempo/Sig イベントが無ければ、
     * 手前（継承値）と同じ内容の明示イベントを挿入する。
     */
    function ensureTempoSignatureAtBarStarts(barStarts, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const indices = [];
        if (Array.isArray(barStarts)) {
            for (let i = 0; i < barStarts.length; i++) {
                const bi = barStarts[i] | 0;
                if (bi > 0 && indices.indexOf(bi) < 0) indices.push(bi);
            }
        }
        indices.sort((a, b) => a - b);
        if (!indices.length) return false;

        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return false;

        const boundaries = collectMeterBarBoundariesForRegionSwap(spec, master);
        const maxBar = Math.max(0, boundaries.length - 2);

        const tempoRaw = getTempoTrackEvents(spec, master);
        const sigRaw = getSignatureTrackEvents(spec, master);
        const tempoEvents = tempoRaw.map((e) => Object.assign({}, e));
        const sigEvents = sigRaw.map((e) => ({
            barIndex: e.barIndex | 0,
            sig: cloneMeterSigForTempoSync(e.sig),
        }));

        const insertedTempo = [];
        const insertedSig = [];

        for (let i = 0; i < indices.length; i++) {
            const bi = Math.min(indices[i], maxBar);
            if (bi <= 0) continue;
            const secAtBar =
                boundaries.length > bi && Number.isFinite(boundaries[bi])
                    ? Math.min(boundaries[bi], master)
                    : secForBarIndex(bi, spec, master);
            if (!trackEventExistsAtBarIndex(tempoEvents, bi)) {
                tempoEvents.push({
                    barIndex: bi,
                    sec: secAtBar,
                    bpm: resolveTempoBpmLookbackAtMarkSec(secAtBar, spec, master),
                });
                insertedTempo.push(bi);
            }
            if (!trackEventExistsAtBarIndex(sigEvents, bi)) {
                sigEvents.push({
                    barIndex: bi,
                    sig: cloneMeterSigForTempoSync(
                        resolveSigLookbackAtMarkSec(secAtBar, spec, master),
                    ),
                });
                insertedSig.push(bi);
            }
        }

        if (!insertedTempo.length && !insertedSig.length) return false;

        tempoEvents.sort(
            (a, b) =>
                (a.barIndex != null ? a.barIndex | 0 : 0) -
                (b.barIndex != null ? b.barIndex | 0 : 0),
        );
        sigEvents.sort((a, b) => (a.barIndex | 0) - (b.barIndex | 0));

        const applyOpt = Object.assign({}, o, {
            skipMeterSpecRebuild: true,
            preserveInputTempoSecs: true,
        });
        applyTempoTrackEvents(tempoEvents, spec, master, applyOpt);
        applySignatureTrackEvents(sigEvents, spec, master, applyOpt);

        rehearsalSwapDiagLog('tempo-sig/ensure-bar-starts', {
            bars: indices,
            insertedTempo: insertedTempo,
            insertedSig: insertedSig,
        });
        return true;
    }

    /**
     * RegionSwap — リハーサルマーク等の transport sec から小節先頭を解決し、
     * その位置に Tempo/Sig 明示イベントが無ければ手前の継承値を挿入する。
     */
    function ensureTempoSignatureAtMarkSecs(markSecs, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return false;

        const boundaries = collectMeterBarBoundariesForRegionSwap(spec, master);
        const perBarLen = Math.max(0, boundaries.length - 1);
        if (!perBarLen) return false;

        const barStarts = [];
        const secs = Array.isArray(markSecs) ? markSecs : [];
        for (let i = 0; i < secs.length; i++) {
            const sec = Number(secs[i]);
            if (!Number.isFinite(sec)) continue;
            let bi = barIndexForBoundarySec(sec, boundaries);
            if (bi >= perBarLen) bi = perBarLen - 1;
            if (bi > 0 && barStarts.indexOf(bi) < 0) barStarts.push(bi);
        }
        barStarts.sort((a, b) => a - b);
        if (!barStarts.length) return false;

        rehearsalSwapDiagLog('tempo-sig/ensure-mark-secs', {
            markSecs: secs.filter((s) => Number.isFinite(Number(s))),
            barStarts: barStarts,
        });
        return ensureTempoSignatureAtBarStarts(barStarts, o);
    }

    /** 現在の Rehearsal トラック上の全マーク sec（昇順・重複除去） */
    function collectAllRehearsalMarkTransportSecs() {
        const snap = getRehearsalMarkTrackEventsPersistSnapshot();
        if (!snap || !snap.length) return [];
        const eps = 1e-6;
        const secs = [];
        for (let i = 0; i < snap.length; i++) {
            const sec = Number(snap[i] && snap[i].sec);
            if (!Number.isFinite(sec)) continue;
            let dup = false;
            for (let j = 0; j < secs.length; j++) {
                if (Math.abs(secs[j] - sec) <= eps) {
                    dup = true;
                    break;
                }
            }
            if (!dup) secs.push(sec);
        }
        secs.sort((a, b) => a - b);
        return secs;
    }

    /**
     * RegionSwap 前 — 全 Rehearsal マーク sec 上の継承 Tempo/Sig を明示イベント化。
     * ensureTempoSignatureAtBarStarts（meterSpec 再構築あり）では sec ベース Tempo を誤解釈するため、
     * 入れ替えペアと同じ prepare 経路を全マークに拡張する。
     */
    function ensureTempoSignatureAtAllRehearsalMarks(opt) {
        const secs = collectAllRehearsalMarkTransportSecs();
        if (!secs.length) return false;
        rehearsalSwapDiagLog('tempo-sig/ensure-all-rehearsal-marks', {
            count: secs.length,
            markSecs: secs,
        });
        const snapshots = prepareTempoSignatureAtMarkSecs(secs, opt);
        return snapshots.length > 0;
    }

    /** swap 前 — 全 Rehearsal マークの Tempo/Sig スナップショット（ラベル付き）を読み取る。 */
    function captureMeterPrepSnapshotsAtRehearsalMarks(opt) {
        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const marks = getRehearsalMarkTrackEventsPersistSnapshot();
        if (!spec || !(master > 0) || !marks.length) return [];

        const secs = [];
        for (let i = 0; i < marks.length; i++) {
            const sec = Number(marks[i] && marks[i].sec);
            if (Number.isFinite(sec)) secs.push(sec);
        }
        if (!secs.length) return [];

        const snapshots = captureMeterPrepSnapshotsAtMarkSecs(secs, spec, master);
        const labeled = [];
        let snapIdx = 0;
        for (let i = 0; i < marks.length; i++) {
            const sec = Number(marks[i] && marks[i].sec);
            if (!Number.isFinite(sec)) continue;
            const snap = snapshots[snapIdx++];
            if (!snap) continue;
            labeled.push({
                label: marks[i].label != null ? String(marks[i].label) : '',
                sec: snap.sec,
                bar: snap.bar,
                bpm: snap.bpm,
                sig: snap.sig,
            });
        }

        rehearsalSwapDiagLog('tempo-sig/capture-pre-swap-mark-snapshots', {
            count: labeled.length,
            snapshots: labeled.map((s) => ({
                label: s.label,
                sec: swapDiagRoundNum(s.sec),
                bpm: s.bpm,
                sig: formatMeterSigText(s.sig),
            })),
        });
        return labeled;
    }

    /**
     * transport-swap finalize 後 — swap 前に確定したラベル別 Tempo/Sig を ripple 後 sec へ再 pin。
     * perBar 再計算だと移動したマーク（例: B）が新タイムライン上の手前値（160）を誤採用する。
     */
    function repinMeterTrackEventsFromPreSwapSnapshots(labeledSnapshots, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!Array.isArray(labeledSnapshots) || !labeledSnapshots.length) {
            return repinMeterTrackEventsAtAllRehearsalMarks(o);
        }

        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return false;

        const marks = getRehearsalMarkTrackEventsPersistSnapshot();
        if (!marks.length) return false;

        const snapByLabel = new Map();
        for (let i = 0; i < labeledSnapshots.length; i++) {
            const snap = labeledSnapshots[i];
            if (!snap || snap.label == null || snap.label === '') continue;
            snapByLabel.set(String(snap.label), snap);
        }

        const pins = [];
        for (let i = 0; i < marks.length; i++) {
            const mark = marks[i];
            if (!mark) continue;
            const label = mark.label != null ? String(mark.label) : '';
            const snap = snapByLabel.get(label);
            if (!snap) continue;
            pins.push({
                label: label,
                sec: Number(mark.sec),
                bpm: snap.bpm,
                sig: snap.sig,
                bar: snap.bar,
            });
        }
        if (!pins.length) {
            return repinMeterTrackEventsAtAllRehearsalMarks(o);
        }

        rehearsalSwapDiagLog('tempo-sig/repin-from-pre-swap-snapshots', {
            count: pins.length,
            pins: pins.map((p) => ({
                label: p.label,
                sec: swapDiagRoundNum(p.sec),
                bpm: p.bpm,
                sig: formatMeterSigText(p.sig),
            })),
        });

        return applyMeterPinsAtMarkSecs(
            spec,
            master,
            pins,
            Object.assign({}, o, {
                skipMeterSpecRebuild: true,
                preserveInputTempoSecs: true,
            }),
        );
    }

    function extendPerBarToScoreLength(perBar, spec, minLen) {
        const n = minLen | 0;
        for (let i = perBar.length; i < n; i++) {
            const entry = getMeterEntryForBar(spec, i);
            if (entry) {
                perBar.push({
                    bpm: entry.bpm,
                    sig: cloneMeterSigForTempoSync(entry.sig),
                });
            } else if (perBar.length) {
                perBar.push(cloneMeterBarEntry(perBar[perBar.length - 1]));
            } else {
                perBar.push(cloneMeterBarEntry(null));
            }
        }
        return perBar;
    }

    function slotMeterBarStartFromCounts(counts, slotIndex) {
        if (!counts || !counts.length) return 0;
        const idx = slotIndex | 0;
        if (idx <= 0) return 0;
        let start = 0;
        for (let i = 0; i < idx && i < counts.length; i++) start += counts[i] | 0;
        return start;
    }

    /**
     * RegionSwap — SwapUnit 列（slotLevelCounts）上の 2 スロットに紐づく Tempo/Sig 列を入れ替える。
     * 非対称（6 bars ↔ 1 bar）でもスロット幅は維持し、中身だけ swap する。
     */
    function swapTempoSignatureForSlotIndices(slotIndexA, slotIndexB, slotCounts, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const giA = slotIndexA | 0;
        const giB = slotIndexB | 0;
        if (giA < 0 || giB < 0 || giA === giB) {
            rehearsalSwapDiagLog('tempo-sig/swap-rejected', {
                reason: 'invalid-slot-indices',
                slotA: giA,
                slotB: giB,
            });
            return false;
        }
        if (!Array.isArray(slotCounts) || !slotCounts.length) {
            rehearsalSwapDiagLog('tempo-sig/swap-rejected', { reason: 'no-slot-counts' });
            return false;
        }
        if (giA >= slotCounts.length || giB >= slotCounts.length) {
            rehearsalSwapDiagLog('tempo-sig/swap-rejected', {
                reason: 'slot-index-out-of-range',
                slotA: giA,
                slotB: giB,
                slotCountsLen: slotCounts.length,
            });
            return false;
        }

        readMusicalGridFromInputs();
        let spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) {
            rehearsalSwapDiagLog('tempo-sig/swap-rejected', {
                reason: !spec ? 'no-meter-spec' : 'no-master-duration',
                master: master,
            });
            return false;
        }

        const startA = slotMeterBarStartFromCounts(slotCounts, giA);
        const startB = slotMeterBarStartFromCounts(slotCounts, giB);
        const markScoreBars =
            Array.isArray(o.markSecs) && o.markSecs.length >= 2 ? [startA, startB] : null;

        logTempoSigSwapStage('tempo-sig/swap-begin', spec, master, {
            slotA: giA,
            slotB: giB,
            slotCounts: slotCounts.slice(),
            markSecs: o.markSecs,
            scoreBarStartA: startA,
            scoreBarStartB: startB,
            marks: resolveMarkSecMeterDiagEntries(o.markSecs, spec, master, markScoreBars),
        });

        let prepSnapshots = [];
        if (Array.isArray(o.markSecs) && o.markSecs.length >= 2) {
            prepSnapshots = prepareTempoSignatureAtMarkSecs(o.markSecs, o);
            readMusicalGridFromInputs();
            spec = getMeterSpec();
        }

        let totalScoreBars = 0;
        for (let i = 0; i < slotCounts.length; i++) totalScoreBars += slotCounts[i] | 0;

        let perBar = collectPerBarMeterEntriesFromTracks(spec, master);
        if (!perBar.length && totalScoreBars <= 0) {
            rehearsalSwapDiagLog('tempo-sig/swap-rejected', {
                reason: 'empty-per-bar',
                totalScoreBars: totalScoreBars,
            });
            return false;
        }
        extendPerBarToScoreLength(perBar, spec, totalScoreBars);

        rehearsalSwapDiagLog('tempo-sig/swap-collect', {
            perBarLen: perBar.length,
            totalScoreBars: totalScoreBars,
            beforeSliceA: summarizePerBarSliceForSwapDiag(
                perBar,
                startA,
                slotCounts[giA],
                'slotA',
            ),
            beforeSliceB: summarizePerBarSliceForSwapDiag(
                perBar,
                startB,
                slotCounts[giB],
                'slotB',
            ),
            marks: resolveMarkSecMeterDiagEntries(o.markSecs, spec, master, markScoreBars),
        });

        const groups = splitPerBarEntriesByRehearsalCounts(perBar, slotCounts);
        while (groups.length < slotCounts.length) groups.push([]);

        const sliceA = (groups[giA] || []).map(cloneMeterBarEntry);
        const sliceB = (groups[giB] || []).map(cloneMeterBarEntry);
        groups[giA] = sliceB;
        groups[giB] = sliceA;

        const nextPerBar = concatRehearsalGroupMeterSlices(groups, slotCounts);
        if (!nextPerBar.length) {
            rehearsalSwapDiagLog('tempo-sig/swap-rejected', { reason: 'empty-next-per-bar' });
            return false;
        }

        const applied = applyPerBarMeterEntriesToMusicalGrid(nextPerBar, spec, master, o);
        if (!applied) {
            rehearsalSwapDiagLog('tempo-sig/swap-rejected', {
                reason: 'apply-per-bar-failed',
            });
            return false;
        }

        readMusicalGridFromInputs();
        spec = getMeterSpec();
        logTempoSigSwapStage('tempo-sig/swap-applied', spec, master, {
            afterSliceA: summarizePerBarSliceForSwapDiag(
                nextPerBar,
                startA,
                slotCounts[giA],
                'slotA',
            ),
            afterSliceB: summarizePerBarSliceForSwapDiag(
                nextPerBar,
                startB,
                slotCounts[giB],
                'slotB',
            ),
            marks: resolveMarkSecMeterDiagEntries(o.markSecs, spec, master, markScoreBars),
        });

        if (prepSnapshots.length >= 2 && Array.isArray(o.markSecs) && o.markSecs.length >= 2) {
            postPinMeterMarksAfterSlotSwap(o.markSecs, prepSnapshots, o);
            readMusicalGridFromInputs();
            spec = getMeterSpec();
        }

        const expectedMarks =
            prepSnapshots.length >= 2 && Array.isArray(o.markSecs) && o.markSecs.length >= 2
                ? [
                      {
                          sec: o.markSecs[0],
                          bpm: prepSnapshots[1].bpm,
                          sig: formatMeterSigText(prepSnapshots[1].sig),
                      },
                      {
                          sec: o.markSecs[1],
                          bpm: prepSnapshots[0].bpm,
                          sig: formatMeterSigText(prepSnapshots[0].sig),
                      },
                  ]
                : null;

        logTempoSigSwapStage('tempo-sig/swap-done', spec, master, {
            slotA: giA,
            slotB: giB,
            startA: startA,
            startB: startB,
            countA: slotCounts[giA],
            countB: slotCounts[giB],
            sliceAHead: sliceA.length
                ? { bpm: sliceA[0].bpm, sig: formatMeterSigText(sliceA[0].sig) }
                : null,
            sliceBHead: sliceB.length
                ? { bpm: sliceB[0].bpm, sig: formatMeterSigText(sliceB[0].sig) }
                : null,
            sliceASigs: sliceA.map((e) => formatMeterSigText(e.sig)),
            sliceBSigs: sliceB.map((e) => formatMeterSigText(e.sig)),
            prepSnapshots: prepSnapshots.map((s) => ({
                sec: s.sec,
                bpm: s.bpm,
                sig: formatMeterSigText(s.sig),
            })),
            expectedMarks: expectedMarks,
            marks: resolveMarkSecMeterDiagEntries(o.markSecs, spec, master, markScoreBars),
            verify:
                expectedMarks && Array.isArray(o.markSecs)
                    ? expectedMarks.map((exp, i) => {
                          const marks = resolveMarkSecMeterDiagEntries(
                              [o.markSecs[i]],
                              spec,
                              master,
                              null,
                          );
                          const actual = marks[0];
                          return {
                              sec: exp.sec,
                              expected: { bpm: exp.bpm, sig: exp.sig },
                              actual: actual
                                  ? { bpm: actual.bpmAtSec, sig: actual.sigAtSec }
                                  : null,
                              bpmOk:
                                  actual &&
                                  Math.abs(actual.bpmAtSec - exp.bpm) < 1e-6,
                              sigOk: actual && actual.sigAtSec === exp.sig,
                          };
                      })
                    : null,
            totalBars: nextPerBar.length,
        });
        return true;
    }

    /** リハーサルマーク sec 位置の perBar 実値でトラックイベントを明示 */
    function pinMeterTrackEventsAtMarkSecs(markSecs, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return false;

        const boundaries = collectMeterBarBoundariesForRegionSwap(spec, master);
        const perBarLen = Math.max(0, boundaries.length - 1);
        if (!perBarLen) return false;

        let perBar = o.perBar;
        if (!perBar || !perBar.length) {
            perBar = collectPerBarMeterEntriesFromTracks(spec, master);
        }

        const barStarts = [];
        const resolved = [];
        const markSecByBar = {};
        const secs = Array.isArray(markSecs) ? markSecs : [];
        for (let i = 0; i < secs.length; i++) {
            const sec = Number(secs[i]);
            if (!Number.isFinite(sec)) continue;
            let bi = barIndexForBoundarySec(sec, boundaries);
            if (bi >= perBarLen) bi = perBarLen - 1;
            if (barStarts.indexOf(bi) < 0) {
                barStarts.push(bi);
                markSecByBar[bi] = sec;
                resolved.push({ sec: sec, bar: bi });
            }
        }
        if (!barStarts.length) return false;

        rehearsalSwapDiagLog('tempo-sig/pin-mark-secs', { resolved: resolved });
        return pinMeterTrackEventsFromPerBar(
            perBar,
            barStarts,
            spec,
            master,
            Object.assign({}, o, { markSecByBar: markSecByBar }),
        );
    }

    /**
     * transport-swap finalize 後 — ripple 済み全 Rehearsal マークへ Tempo/Sig 明示 pin を復元。
     * rebuild-from-per-bar は BPM 変化点のみ残すため、B/E など継承区間のマーク pin が消える。
     */
    function repinMeterTrackEventsAtAllRehearsalMarks(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const snap = getRehearsalMarkTrackEventsPersistSnapshot();
        if (!snap || !snap.length) return false;
        const markSecs = [];
        for (let i = 0; i < snap.length; i++) {
            const sec = Number(snap[i] && snap[i].sec);
            if (!Number.isFinite(sec)) continue;
            markSecs.push(sec);
        }
        if (!markSecs.length) return false;
        rehearsalSwapDiagLog('tempo-sig/repin-all-rehearsal-marks', {
            count: markSecs.length,
            markSecs: markSecs,
        });
        return pinMeterTrackEventsAtMarkSecs(
            markSecs,
            Object.assign({}, o, {
                skipMeterSpecRebuild: true,
                preserveInputTempoSecs: true,
            }),
        );
    }

    /** 同一 label が複数あるとき（Intro 等）occurrence で区別する */
    function rehearsalMarkLabelOccurrenceKey(label, occurrence) {
        const norm =
            typeof window.normalizeRehearsalMarkLabel === 'function'
                ? window.normalizeRehearsalMarkLabel(label)
                : String(label == null ? '' : label).trim();
        if (!norm) return '';
        return norm + '\u0001' + (occurrence | 0);
    }

    /** pre-swap labeled スライス — label+occurrence → entry（Map は label 単体不可） */
    function buildLabeledRehearsalSliceOccurrenceMap(labeledEntries) {
        const map = new Map();
        const nextOcc = new Map();
        if (!Array.isArray(labeledEntries)) return map;
        for (let i = 0; i < labeledEntries.length; i++) {
            const entry = labeledEntries[i];
            if (!entry || entry.label == null || entry.label === '') continue;
            const norm =
                typeof window.normalizeRehearsalMarkLabel === 'function'
                    ? window.normalizeRehearsalMarkLabel(entry.label)
                    : String(entry.label).trim();
            if (!norm) continue;
            const occ = nextOcc.get(norm) || 0;
            nextOcc.set(norm, occ + 1);
            map.set(rehearsalMarkLabelOccurrenceKey(entry.label, occ), entry);
        }
        return map;
    }

    function lookupLabeledRehearsalSliceByOccurrence(sliceOccMap, label, occurrence) {
        if (!sliceOccMap || !sliceOccMap.size) return null;
        return sliceOccMap.get(rehearsalMarkLabelOccurrenceKey(label, occurrence | 0)) || null;
    }

    /**
     * transport-swap plan — 全リハーサルラベルごとに perBar スライスを保存。
     * ラベルに紐づく Tempo/拍子は ripple 後もラベル単位で再投影する。
     */
    function captureLabeledRehearsalMeterSlices(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return null;
        if (typeof collectRehearsalMarkDrawRanges !== 'function') return null;

        const perBar = collectPerBarMeterEntriesFromTracks(spec, master);
        if (!perBar.length) return null;

        const ranges = collectRehearsalMarkDrawRanges(master, spec);
        const labeled = [];
        let headPad = null;
        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];
            if (!range) continue;
            const span = resolveTransportMeterSpanForSwapSec(range.startSec, o);
            if (!span || !(span.transportBarCount > 0)) continue;
            const start = span.transportBarStart | 0;
            const count = span.transportBarCount | 0;
            const slice = extractMeterBarSlice(perBar, start, count);
            if (!range.fromRehearsalEvent) {
                headPad = {
                    transportBarStart: start,
                    transportBarCount: count,
                    slice: slice,
                };
                continue;
            }
            labeled.push({
                label: range.label != null ? String(range.label) : '',
                transportBarStart: start,
                transportBarCount: count,
                slice: slice,
            });
        }
        if (!labeled.length) return null;

        rehearsalSwapDiagLog('tempo-sig/capture-labeled-rehearsal-slices', {
            labeledCount: labeled.length,
            hasHeadPad: !!headPad,
            labeled: labeled.map((entry) => ({
                label: entry.label,
                start: entry.transportBarStart,
                count: entry.transportBarCount,
                head:
                    entry.slice && entry.slice[0]
                        ? {
                              bpm: entry.slice[0].bpm,
                              sig: formatMeterSigText(entry.slice[0].sig),
                          }
                        : null,
            })),
        });

        return { labeled: labeled, headPad: headPad };
    }

    /**
     * transport-swap finalize — ripple 後、ラベル別 pre-swap スライスを新 transport span へ再投影。
     */
    function applyLabeledRehearsalMeterSlicesAfterMarkRipple(labeledPack, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!labeledPack || !Array.isArray(labeledPack.labeled) || !labeledPack.labeled.length) {
            return false;
        }

        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return false;
        if (typeof collectRehearsalMarkDrawRanges !== 'function') return false;

        let perBar = collectPerBarMeterEntriesFromTracks(spec, master);
        if (!perBar.length) return false;

        const sliceByOccurrence = buildLabeledRehearsalSliceOccurrenceMap(labeledPack.labeled);
        const nextLabelOcc = new Map();

        const appliedRows = [];
        const drawRanges = collectRehearsalMarkDrawRanges(master, spec);
        for (let i = 0; i < drawRanges.length; i++) {
            const range = drawRanges[i];
            if (!range || !range.fromRehearsalEvent) continue;
            const label = range.label != null ? String(range.label) : '';
            const norm =
                typeof window.normalizeRehearsalMarkLabel === 'function'
                    ? window.normalizeRehearsalMarkLabel(label)
                    : label.trim();
            const occ = norm ? nextLabelOcc.get(norm) || 0 : 0;
            if (norm) nextLabelOcc.set(norm, occ + 1);
            const src = lookupLabeledRehearsalSliceByOccurrence(sliceByOccurrence, label, occ);
            if (!src || !src.slice || !src.slice.length) continue;

            const span = resolveTransportMeterSpanForSwapSec(range.startSec, o);
            if (!span || !(span.transportBarCount > 0)) continue;

            const destStart = span.transportBarStart | 0;
            const destCount = span.transportBarCount | 0;
            const slice = expandMeterBarSlice(src.slice, destCount);
            writeMeterBarSlice(perBar, destStart, destCount, slice);
            appliedRows.push({
                label: label,
                destStart: destStart,
                destCount: destCount,
                sliceHead:
                    slice && slice[0]
                        ? {
                              bpm: slice[0].bpm,
                              sig: formatMeterSigText(slice[0].sig),
                          }
                        : null,
            });
        }

        if (labeledPack.headPad && labeledPack.headPad.slice && labeledPack.headPad.slice.length) {
            const hp = labeledPack.headPad;
            const destStart = hp.transportBarStart | 0;
            const destCount = hp.transportBarCount | 0;
            if (destStart >= 0 && destCount > 0 && destStart < perBar.length) {
                writeMeterBarSlice(
                    perBar,
                    destStart,
                    destCount,
                    expandMeterBarSlice(hp.slice, destCount),
                );
                appliedRows.push({
                    label: '_',
                    destStart: destStart,
                    destCount: destCount,
                });
            }
        }

        rehearsalSwapDiagLog('tempo-sig/apply-labeled-rehearsal-slices', {
            applied: appliedRows,
        });

        const applied = applyPerBarMeterEntriesToMusicalGrid(
            perBar,
            spec,
            master,
            Object.assign({}, o, { skipSessionPersist: !!o.skipSessionPersist }),
        );
        if (!applied) return false;
        return finalizeTransportSwapMeterGridAfterPerBarApply(
            Object.assign({}, o, { labeledSliceAppliedRows: appliedRows }),
        );
    }

    /**
     * apply-labeled-rehearsal-slices 後 — 各 mark を slice の destStart 小節頭へ合わせる。
     * ripple sec を barIndexForBoundarySec で丸めると隣区間の bar 頭へ吸われ B/C の小節数が崩れる。
     */
    function alignRehearsalMarksToLabeledSliceBarStarts(appliedRows, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!Array.isArray(appliedRows) || !appliedRows.length) return false;
        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return false;

        const snap = getRehearsalMarkTrackEventsPersistSnapshot();
        if (!snap.length) return false;

        const boundaries = collectMeterBarBoundariesForRegionSwap(spec, master);
        if (boundaries.length < 2) return false;

        const labeledDestStarts = [];
        for (let ri = 0; ri < appliedRows.length; ri++) {
            const row = appliedRows[ri];
            if (!row || row.label == null || row.label === '' || row.label === '_') continue;
            labeledDestStarts.push(row.destStart | 0);
        }
        if (!labeledDestStarts.length) return false;

        const maxBar = Math.max(0, boundaries.length - 2);
        const rows = [];
        const nextEvents = [];
        const eps = 1e-6;
        let prevSnappedSec = -Infinity;
        for (let i = 0; i < snap.length; i++) {
            const mark = snap[i];
            if (!mark) continue;
            const label = mark.label;
            const fromSec = Number(mark.sec);
            if (!Number.isFinite(fromSec)) continue;
            const destStart = i < labeledDestStarts.length ? labeledDestStarts[i] : null;
            if (destStart == null) {
                nextEvents.push({ sec: fromSec, label: label });
                prevSnappedSec = Math.max(prevSnappedSec, fromSec);
                continue;
            }
            let bi = destStart | 0;
            if (bi > maxBar) bi = maxBar;
            if (bi < 0) bi = 0;
            let toSec = Math.min(boundaries[bi], master);
            if (toSec <= prevSnappedSec + eps) {
                toSec = Math.min(master - 1e-6, Math.max(toSec, prevSnappedSec + eps * 4));
            }
            prevSnappedSec = toSec;
            rows.push({
                label: label,
                from: swapDiagRoundNum(fromSec),
                to: swapDiagRoundNum(toSec),
                bar: bi,
                delta: swapDiagRoundNum(toSec - fromSec),
            });
            nextEvents.push({ sec: toSec, label: label });
        }
        if (!nextEvents.length) return false;

        nextEvents.sort((a, b) => a.sec - b.sec);
        for (let i = 1; i < nextEvents.length; i++) {
            if (nextEvents[i].sec <= nextEvents[i - 1].sec + eps) {
                nextEvents[i].sec = Math.min(master - 1e-6, nextEvents[i - 1].sec + eps * 4);
            }
        }

        const moved = rows.some((r) => Math.abs(r.delta) > 1e-6);
        setRehearsalMarkTrackEvents(nextEvents, spec, master);
        if (typeof persistMusicalGridToStorage === 'function') {
            persistMusicalGridToStorage({ skipSessionPersist: !!o.skipSessionPersist });
        }
        if (typeof writePrefs === 'function') writePrefs();
        if (typeof window.refreshMusicalGridTracks === 'function') {
            window.refreshMusicalGridTracks();
        }

        rehearsalSwapDiagLog('tempo-sig/align-marks-to-labeled-slice-starts', {
            moved: moved,
            rows: rows,
        });
        return true;
    }

    /**
     * apply-per-bar 後 — リハーサルマークを transport 小節境界 sec へスナップ。
     * スロット端 sec のままだと着色区間と小節線がずれ C–B 間に隙間が見える。
     */
    function snapRehearsalMarksToMeterBarBoundaries(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return false;

        const snap = getRehearsalMarkTrackEventsPersistSnapshot();
        if (!snap.length) return false;

        const boundaries = collectMeterBarBoundariesForRegionSwap(spec, master);
        if (boundaries.length < 2) return false;

        const maxBar = Math.max(0, boundaries.length - 2);
        const rows = [];
        const nextEvents = [];
        const eps = 1e-6;
        let prevSnappedSec = -Infinity;
        for (let i = 0; i < snap.length; i++) {
            const mark = snap[i];
            if (!mark) continue;
            const label = mark.label;
            const fromSec = Number(mark.sec);
            if (!Number.isFinite(fromSec)) continue;
            let bi = barIndexForBoundarySec(fromSec, boundaries);
            if (bi > maxBar) bi = maxBar;
            if (bi < 0) bi = 0;
            const barHead = Math.min(boundaries[bi], master);
            let toSec = barHead;
            const forwardDrift = fromSec - barHead;
            // transport-swap: ripple 時 boundaries と per-bar 再構築後 boundaries が僅かに
            // ずれ mark が bar 頭より遅れる → B/A 開始が遅れ B–A 間に隙間が見える。
            // forceMarkBarHeadSnap 時は bar 頭へ吸着。通常は mid-bar 意図配置を維持。
            if (forwardDrift > 1e-4) {
                const maxForwardSnap =
                    o.maxForwardMarkSnapSec != null && Number.isFinite(o.maxForwardMarkSnapSec)
                        ? Math.max(0, o.maxForwardMarkSnapSec)
                        : 0.5;
                if (!o.forceMarkBarHeadSnap && forwardDrift > maxForwardSnap) {
                    toSec = fromSec;
                }
            }
            if (toSec <= prevSnappedSec + eps) {
                toSec = Math.min(master - 1e-6, Math.max(fromSec, prevSnappedSec + eps * 4));
            }
            if (label == null || label === '' || toSec < 0 || toSec >= master - 1e-6) continue;
            prevSnappedSec = toSec;
            rows.push({
                label: label,
                from: swapDiagRoundNum(fromSec),
                to: swapDiagRoundNum(toSec),
                bar: bi,
                delta: swapDiagRoundNum(toSec - fromSec),
            });
            nextEvents.push({ sec: toSec, label: label });
        }
        if (!nextEvents.length) return false;

        nextEvents.sort((a, b) => a.sec - b.sec);
        for (let i = 1; i < nextEvents.length; i++) {
            if (nextEvents[i].sec <= nextEvents[i - 1].sec + eps) {
                nextEvents[i].sec = Math.min(master - 1e-6, nextEvents[i - 1].sec + eps * 4);
            }
        }

        const moved = rows.some((r) => Math.abs(r.delta) > 1e-6);
        if (moved) {
            setRehearsalMarkTrackEvents(nextEvents, spec, master);
            if (typeof persistMusicalGridToStorage === 'function') {
                persistMusicalGridToStorage({ skipSessionPersist: !!o.skipSessionPersist });
            }
            if (typeof writePrefs === 'function') writePrefs();
            if (typeof window.refreshMusicalGridTracks === 'function') {
                window.refreshMusicalGridTracks();
            }
        }

        rehearsalSwapDiagLog('tempo-sig/snap-marks-to-bar-boundaries', {
            moved: moved,
            rows: rows,
        });
        return true;
    }

    /**
     * apply-per-bar 後 — 全 Rehearsal マーク小節の perBar 実値で Tempo/Sig を明示 pin。
     * 変化点のみ再構築すると E 頭（160 継承）など UI マーカーが消える。
     */
    function repinMeterTrackEventsAtAllRehearsalMarkBars(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return false;

        const marks = getRehearsalMarkTrackEventsPersistSnapshot();
        if (!marks.length) return false;

        const boundaries = collectMeterBarBoundariesForRegionSwap(spec, master);
        const perBar = collectPerBarMeterEntriesFromTracks(spec, master);
        const perBarLen = Math.max(0, boundaries.length - 1);
        if (!perBar.length || !perBarLen) return false;

        const pins = [];
        for (let i = 0; i < marks.length; i++) {
            const mark = marks[i];
            if (!mark) continue;
            const sec = Number(mark.sec);
            if (!Number.isFinite(sec)) continue;
            let bi = barIndexForBoundarySec(sec, boundaries);
            if (bi >= perBarLen) bi = perBarLen - 1;
            const entry = perBar[bi];
            if (!entry) continue;
            pins.push({
                label: mark.label,
                sec: sec,
                bar: bi,
                bpm: entry.bpm,
                sig: entry.sig,
            });
        }
        if (!pins.length) return false;

        rehearsalSwapDiagLog('tempo-sig/repin-all-mark-bars', {
            count: pins.length,
            pins: pins.map((p) => ({
                label: p.label,
                sec: swapDiagRoundNum(p.sec),
                bar: p.bar,
                bpm: p.bpm,
                sig: formatMeterSigText(p.sig),
            })),
        });

        return applyMeterPinsAtMarkSecs(
            spec,
            master,
            pins,
            Object.assign({}, o, {
                skipMeterSpecRebuild: true,
                preserveInputTempoSecs: true,
            }),
        );
    }

    /** transport-swap finalize — perBar 反映後の mark 整列 + 全 mark Tempo/Sig pin */
    function finalizeTransportSwapMeterGridAfterPerBarApply(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        let marksAligned = false;
        if (Array.isArray(o.labeledSliceAppliedRows) && o.labeledSliceAppliedRows.length) {
            marksAligned = alignRehearsalMarksToLabeledSliceBarStarts(
                o.labeledSliceAppliedRows,
                o,
            );
        }
        const snapped = marksAligned
            ? false
            : snapRehearsalMarksToMeterBarBoundaries(
                  Object.assign({}, o, { forceMarkBarHeadSnap: true }),
              );
        const repinned = repinMeterTrackEventsAtAllRehearsalMarkBars(o);
        rehearsalSwapDiagLog('tempo-sig/finalize-after-per-bar', {
            marksAlignedToSliceStarts: marksAligned,
            marksSnapped: snapped,
            marksRepinned: repinned,
        });
        return marksAligned || snapped || repinned;
    }

    /** transport-swap plan — 入れ替え前の mark 位置から perBar スライスを保存（ripple 後に再投影） */
    function captureTransportSwapMeterSlices(markSecs, countA, countB, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!Array.isArray(markSecs) || markSecs.length < 2) return null;
        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return null;

        const perBar = collectPerBarMeterEntriesFromTracks(spec, master);
        if (!perBar.length) return null;

        const lenA = countA | 0;
        const lenB = countB | 0;
        if (lenA <= 0 || lenB <= 0) return null;

        const spanA = resolveTransportMeterSpanForSwapSec(markSecs[0], o);
        const spanB = resolveTransportMeterSpanForSwapSec(markSecs[1], o);
        if (!spanA || !spanB) return null;

        const startA = spanA.transportBarStart | 0;
        const startB = spanB.transportBarStart | 0;
        const labeledSlices = captureLabeledRehearsalMeterSlices(o);
        const captured = {
            markSecs: [Number(markSecs[0]), Number(markSecs[1])],
            startA: startA,
            startB: startB,
            countA: lenA,
            countB: lenB,
            sliceA: extractMeterBarSlice(perBar, startA, lenA),
            sliceB: extractMeterBarSlice(perBar, startB, lenB),
            labeledSlices: labeledSlices,
        };
        rehearsalSwapDiagLog('tempo-sig/capture-transport-swap-slices', {
            startA: startA,
            startB: startB,
            countA: lenA,
            countB: lenB,
            sliceAHead: captured.sliceA[0]
                ? {
                      bpm: captured.sliceA[0].bpm,
                      sig: formatMeterSigText(captured.sliceA[0].sig),
                  }
                : null,
            sliceBHead: captured.sliceB[0]
                ? {
                      bpm: captured.sliceB[0].bpm,
                      sig: formatMeterSigText(captured.sliceB[0].sig),
                  }
                : null,
        });
        if (!labeledSlices || !labeledSlices.labeled || !labeledSlices.labeled.length) {
            return null;
        }
        return captured;
    }

    /**
     * transport-swap finalize — ripple 後の mark draw span へ pre-swap スライスを交差投影。
     * slotA 側へ旧 B（C）拍子、slotB 側へ旧 A 拍子。
     */
    function applyTransportSwapMeterSlicesAfterMarkRipple(captured, slotA, slotB, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!captured) return false;

        const headPadPairSwap = !!o.headPadSwapPair;
        if (captured.labeledSlices) {
            return applyLabeledRehearsalMeterSlicesAfterMarkRipple(captured.labeledSlices, o);
        }

        if (!slotA || !slotB) return false;
        if (!Number.isFinite(slotA.timelineStartSec) || !Number.isFinite(slotB.timelineStartSec)) {
            return false;
        }

        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return false;

        let perBar = o.perBar;
        if (!perBar || !perBar.length) {
            perBar = collectPerBarMeterEntriesFromTracks(spec, master);
        }
        if (!perBar.length) return false;

        const spanSlotA = resolveTransportMeterSpanForSwapSec(slotA.timelineStartSec, {
            ...o,
            endSec: slotA.timelineEndSec,
        });
        const spanSlotB = resolveTransportMeterSpanForSwapSec(slotB.timelineStartSec, {
            ...o,
            endSec: slotB.timelineEndSec,
        });
        if (!spanSlotA || !spanSlotB) return false;

        const destStartA = spanSlotA.transportBarStart | 0;
        const destStartB = spanSlotB.transportBarStart | 0;
        const countA = captured.countA | 0;
        const countB = captured.countB | 0;

        if (headPadPairSwap) {
            // head pad ↔ A — region identity の拍子を各 slot の新位置へ（交差投影しない）
            writeMeterBarSlice(perBar, destStartB, countB, captured.sliceB);
            writeMeterBarSlice(perBar, destStartA, countA, captured.sliceA);
        } else {
            writeMeterBarSlice(perBar, destStartA, countB, captured.sliceB);
            writeMeterBarSlice(perBar, destStartB, countA, captured.sliceA);
        }

        const headPadAppliedRows = headPadPairSwap
            ? [{ label: 'A', destStart: destStartB, destCount: countB }]
            : null;

        rehearsalSwapDiagLog('tempo-sig/apply-transport-swap-slices', {
            destStartA: destStartA,
            destStartB: destStartB,
            countA: countA,
            countB: countB,
            headPadPairSwap: headPadPairSwap,
            slotAStart: swapDiagRoundNum(slotA.timelineStartSec),
            slotBStart: swapDiagRoundNum(slotB.timelineStartSec),
            sliceAtA: summarizePerBarSliceForSwapDiag(
                perBar,
                destStartA,
                headPadPairSwap ? countA : countB,
                'slotA-after',
            ),
            sliceAtB: summarizePerBarSliceForSwapDiag(
                perBar,
                destStartB,
                headPadPairSwap ? countB : countA,
                'slotB-after',
            ),
        });

        const applied = applyPerBarMeterEntriesToMusicalGrid(
            perBar,
            spec,
            master,
            Object.assign({}, o, { skipSessionPersist: !!o.skipSessionPersist }),
        );
        if (!applied) return false;
        return finalizeTransportSwapMeterGridAfterPerBarApply(
            Object.assign(
                {},
                o,
                headPadAppliedRows ? { labeledSliceAppliedRows: headPadAppliedRows } : null,
            ),
        );
    }

    /** transport-swap 後 — perBar グリッドから Tempo/Sig トラックを全面再構築（旧 sec pin 残留を除去） */
    function rebuildTempoSigTracksFromPerBarGrid(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return false;

        const perBar =
            o.perBar && o.perBar.length
                ? o.perBar
                : collectPerBarMeterEntriesFromTracks(spec, master);
        if (!perBar.length) return false;

        clearTempoTrackEventsOverride();
        clearSignatureTrackEventsOverride();
        const specNow = getMeterSpec();
        const tempoEvents = buildTempoTrackEventsFromPerBarEntries(perBar, specNow, master);
        const sigEvents = buildSignatureTrackEventsFromPerBarEntries(perBar, specNow, master);
        setTempoTrackEvents(tempoEvents, specNow, master, o);
        setSignatureTrackEvents(sigEvents, specNow, o);

        rehearsalSwapDiagLog('tempo-sig/rebuild-from-per-bar', {
            perBarLen: perBar.length,
            tempoBuilt: tempoEvents.length,
            sigBuilt: sigEvents.length,
            tempoSample: tempoEvents.slice(0, 16).map((e) => ({
                sec: swapDiagRoundNum(e.sec),
                bpm: e.bpm,
                bar: e.barIndex != null ? e.barIndex | 0 : null,
            })),
        });

        if (typeof persistMusicalGridToStorage === 'function') {
            persistMusicalGridToStorage({ skipSessionPersist: !!o.skipSessionPersist });
        }
        if (typeof writePrefs === 'function') writePrefs();
        if (typeof window.refreshMusicalGridTracks === 'function') {
            window.refreshMusicalGridTracks();
        }
        return true;
    }

    /**
     * Partial RegionSwap — リハーサルマーク位置から transport 小節スパン（UI グリッド基準）を求める。
     * score/spec の meterBarStart・contentBarCount とは別座標系。
     */
    function resolveTransportMeterSpanForSwapSec(rehearsalStartSec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const startSec = Number(rehearsalStartSec);
        if (!Number.isFinite(startSec)) return null;

        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return null;

        const eps =
            typeof o.eps === 'number' && o.eps > 0
                ? o.eps
                : typeof window.segmentBoundaryJoinEpsilonSec === 'function'
                  ? window.segmentBoundaryJoinEpsilonSec()
                  : 0.002;

        let range = null;
        if (typeof collectRehearsalMarkDrawRanges === 'function') {
            const ranges = collectRehearsalMarkDrawRanges(master, spec);
            for (let i = 0; i < ranges.length; i++) {
                const r = ranges[i];
                if (
                    r.fromRehearsalEvent &&
                    Math.abs(r.startSec - startSec) <= eps
                ) {
                    range = r;
                    break;
                }
            }
            if (!range) {
                const endSec = Number(o.endSec);
                const useOverlap =
                    Number.isFinite(endSec) && endSec > startSec + eps;
                if (useOverlap) {
                    let bestOverlap = 0;
                    for (let i = 0; i < ranges.length; i++) {
                        const r = ranges[i];
                        const overlapStart = Math.max(startSec, r.startSec);
                        const overlapEnd = Math.min(endSec, r.endSec);
                        const overlap = Math.max(0, overlapEnd - overlapStart);
                        if (overlap > bestOverlap) {
                            bestOverlap = overlap;
                            range = r;
                        }
                    }
                } else {
                    for (let i = 0; i < ranges.length; i++) {
                        const r = ranges[i];
                        if (startSec >= r.startSec - eps && startSec < r.endSec - eps) {
                            range = r;
                            break;
                        }
                    }
                }
            }
        }
        if (!range) return null;

        const boundaries = collectMeterBarBoundariesForRegionSwap(spec, master);
        if (boundaries.length < 2) return null;

        let transportBarStart = barIndexForBoundarySec(range.startSec, boundaries);
        let transportBarEnd = barIndexForBoundarySec(
            Math.max(range.startSec, range.endSec - eps),
            boundaries,
        );
        let transportBarCount = Math.max(1, transportBarEnd - transportBarStart + 1);
        let spanStartSec = range.startSec;
        let spanEndSec = range.endSec;

        const slotEndSec = Number(o.endSec);
        if (Number.isFinite(slotEndSec) && slotEndSec > startSec + eps) {
            const slotBarStart = barIndexForBoundarySec(startSec, boundaries);
            const slotBarEnd = barIndexForBoundarySec(
                Math.max(startSec, slotEndSec - eps),
                boundaries,
            );
            const slotBarCount = Math.max(1, slotBarEnd - slotBarStart + 1);
            if (slotBarCount > transportBarCount) {
                transportBarStart = slotBarStart;
                transportBarEnd = slotBarEnd;
                transportBarCount = slotBarCount;
                spanStartSec = startSec;
                spanEndSec = slotEndSec;
            }
        }

        return {
            transportBarStart: transportBarStart | 0,
            transportBarCount: transportBarCount | 0,
            startSec: spanStartSec,
            endSec: spanEndSec,
            label: range.label,
        };
    }

    /**
     * RegionSwap — 指定 transport 小節範囲の Tempo/Sig 内容だけ入れ替え（transport 小節線位置固定）。
     * Rehearsal Fill の非対称入れ替え向け。meterSpec は再構築せず Tempo/Sig トラックのみ更新。
     * 小節列ごと再構成する swapTempoSignatureForBarRanges とは別経路。
     */
    function swapTempoSignatureForBarRangesInPlace(barStartA, barCountA, barStartB, barCountB, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const lenA = barCountA | 0;
        const lenB = barCountB | 0;
        if (lenA <= 0 && lenB <= 0) {
            rehearsalSwapDiagLog('tempo-sig/swap-rejected', { reason: 'empty-bar-ranges' });
            return false;
        }

        readMusicalGridFromInputs();
        let spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) {
            rehearsalSwapDiagLog('tempo-sig/swap-rejected', {
                reason: !spec ? 'no-meter-spec' : 'no-master-duration',
            });
            return false;
        }

        const rawA = o.rawStartA != null ? o.rawStartA | 0 : barStartA | 0;
        const rawB = o.rawStartB != null ? o.rawStartB | 0 : barStartB | 0;
        const startA = Math.max(0, rawA);
        const startB = Math.max(0, rawB);
        const markScoreBars =
            Array.isArray(o.markSecs) && o.markSecs.length >= 2 ? [startA, startB] : null;

        logTempoSigSwapStage('tempo-sig/swap-begin', spec, master, {
            path: 'bar-ranges-in-place',
            startA: startA,
            startB: startB,
            countA: lenA,
            countB: lenB,
            markSecs: o.markSecs,
            marks: resolveMarkSecMeterDiagEntries(o.markSecs, spec, master, markScoreBars),
        });

        let prepSnapshots = [];
        if (Array.isArray(o.markSecs) && o.markSecs.length >= 2) {
            prepSnapshots = prepareTempoSignatureAtMarkSecs(o.markSecs, o);
            readMusicalGridFromInputs();
            spec = getMeterSpec();
        }

        let perBar = collectPerBarMeterEntriesFromTracks(spec, master);
        if (!perBar.length) {
            rehearsalSwapDiagLog('tempo-sig/swap-rejected', { reason: 'empty-per-bar' });
            return false;
        }

        extendPerBarToScoreLength(
            perBar,
            spec,
            Math.max(perBar.length, startA + lenA, startB + lenB),
        );

        const sliceA = extractMeterBarSlice(perBar, startA, lenA);
        const sliceB = extractMeterBarSlice(perBar, startB, lenB);

        rehearsalSwapDiagLog('tempo-sig/swap-collect', {
            path: 'bar-ranges-in-place',
            beforeSliceA: summarizePerBarSliceForSwapDiag(perBar, startA, lenA, 'rangeA'),
            beforeSliceB: summarizePerBarSliceForSwapDiag(perBar, startB, lenB, 'rangeB'),
            sliceASigs: sliceA.map((e) => formatMeterSigText(e.sig)),
            sliceBSigs: sliceB.map((e) => formatMeterSigText(e.sig)),
            marks: resolveMarkSecMeterDiagEntries(o.markSecs, spec, master, markScoreBars),
        });

        if (!swapPerBarTransportRangesInPlace(perBar, startA, lenA, startB, lenB)) {
            rehearsalSwapDiagLog('tempo-sig/swap-rejected', {
                reason: 'in-place-swap-failed',
                startA: startA,
                startB: startB,
                countA: lenA,
                countB: lenB,
            });
            return false;
        }

        const applied = applySwappedPerBarToTrackEventsOnly(perBar, spec, master, o);
        if (!applied) {
            rehearsalSwapDiagLog('tempo-sig/swap-rejected', { reason: 'apply-track-only-failed' });
            return false;
        }

        readMusicalGridFromInputs();
        spec = getMeterSpec();
        logTempoSigSwapStage('tempo-sig/swap-applied', spec, master, {
            path: 'bar-ranges-in-place',
            totalBars: perBar.length,
            afterHeadAtBar1: summarizePerBarSliceForSwapDiag(
                perBar,
                startA,
                lenB,
                'head-after-in-place',
            ),
            afterTailForOldRangeB: summarizePerBarSliceForSwapDiag(
                perBar,
                startB,
                lenA,
                'tail-after-in-place',
            ),
            marks: resolveMarkSecMeterDiagEntries(o.markSecs, spec, master, markScoreBars),
        });

        if (
            !o.skipPostPinAfterSwap &&
            prepSnapshots.length >= 2 &&
            Array.isArray(o.markSecs) &&
            o.markSecs.length >= 2
        ) {
            postPinMeterMarksAfterSlotSwap(o.markSecs, prepSnapshots, o);
            readMusicalGridFromInputs();
            spec = getMeterSpec();
        } else if (o.skipPostPinAfterSwap && prepSnapshots.length >= 2) {
            rehearsalSwapDiagLog('tempo-sig/post-pin-skipped', {
                reason: 'transport-swap-mark-ripple',
                markSecs: o.markSecs,
            });
        }

        const expectedMarks =
            prepSnapshots.length >= 2 && Array.isArray(o.markSecs) && o.markSecs.length >= 2
                ? [
                      {
                          sec: o.markSecs[0],
                          bpm: prepSnapshots[1].bpm,
                          sig: formatMeterSigText(prepSnapshots[1].sig),
                      },
                      {
                          sec: o.markSecs[1],
                          bpm: prepSnapshots[0].bpm,
                          sig: formatMeterSigText(prepSnapshots[0].sig),
                      },
                  ]
                : null;

        logTempoSigSwapStage('tempo-sig/swap-done', spec, master, {
            path: 'bar-ranges-in-place',
            startA: startA,
            startB: startB,
            countA: lenA,
            countB: lenB,
            sliceAHead: sliceA.length
                ? { bpm: sliceA[0].bpm, sig: formatMeterSigText(sliceA[0].sig) }
                : null,
            sliceBHead: sliceB.length
                ? { bpm: sliceB[0].bpm, sig: formatMeterSigText(sliceB[0].sig) }
                : null,
            sliceASigs: sliceA.map((e) => formatMeterSigText(e.sig)),
            sliceBSigs: sliceB.map((e) => formatMeterSigText(e.sig)),
            prepSnapshots: prepSnapshots.map((s) => ({
                sec: s.sec,
                bpm: s.bpm,
                sig: formatMeterSigText(s.sig),
            })),
            expectedMarks: expectedMarks,
            marks: resolveMarkSecMeterDiagEntries(o.markSecs, spec, master, markScoreBars),
            verify:
                expectedMarks && Array.isArray(o.markSecs)
                    ? expectedMarks.map((exp, i) => {
                          const marks = resolveMarkSecMeterDiagEntries(
                              [o.markSecs[i]],
                              spec,
                              master,
                              null,
                          );
                          const actual = marks[0];
                          return {
                              sec: exp.sec,
                              expected: { bpm: exp.bpm, sig: exp.sig },
                              actual: actual
                                  ? { bpm: actual.bpmAtSec, sig: actual.sigAtSec }
                                  : null,
                              bpmOk:
                                  actual &&
                                  Math.abs(actual.bpmAtSec - exp.bpm) < 1e-6,
                              sigOk: actual && actual.sigAtSec === exp.sig,
                          };
                      })
                    : null,
            totalBars: perBar.length,
        });
        return true;
    }

    /**
     * RegionSwap — 指定 transport 小節範囲を perBar 上で splice 入れ替えし、meterSpec を再構築する。
     * 非対称（6↔2）では exclusive splice（padding/繰り返しなし）。小節線位置は入れ替えに追随。
     * 小節線を固定する swapTempoSignatureForBarRangesInPlace とは別経路。
     */
    function swapTempoSignatureForBarRanges(barStartA, barCountA, barStartB, barCountB, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const lenA = barCountA | 0;
        const lenB = barCountB | 0;
        if (lenA <= 0 && lenB <= 0) {
            rehearsalSwapDiagLog('tempo-sig/swap-rejected', { reason: 'empty-bar-ranges' });
            return false;
        }

        readMusicalGridFromInputs();
        let spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) {
            rehearsalSwapDiagLog('tempo-sig/swap-rejected', {
                reason: !spec ? 'no-meter-spec' : 'no-master-duration',
            });
            return false;
        }

        const rawA = o.rawStartA != null ? o.rawStartA | 0 : barStartA | 0;
        const rawB = o.rawStartB != null ? o.rawStartB | 0 : barStartB | 0;
        const startA = Math.max(0, rawA);
        const startB = Math.max(0, rawB);
        const asymmetric = lenA !== lenB;
        const markScoreBars =
            Array.isArray(o.markSecs) && o.markSecs.length >= 2 ? [startA, startB] : null;

        logTempoSigSwapStage('tempo-sig/swap-begin', spec, master, {
            path: asymmetric ? 'bar-ranges-exclusive' : 'bar-ranges',
            startA: startA,
            startB: startB,
            countA: lenA,
            countB: lenB,
            markSecs: o.markSecs,
            marks: resolveMarkSecMeterDiagEntries(o.markSecs, spec, master, markScoreBars),
        });

        let prepSnapshots = [];
        if (Array.isArray(o.markSecs) && o.markSecs.length >= 2) {
            prepSnapshots = prepareTempoSignatureAtMarkSecs(o.markSecs, o);
            readMusicalGridFromInputs();
            spec = getMeterSpec();
        }

        let perBar = collectPerBarMeterEntriesFromTracks(spec, master);
        if (!perBar.length) {
            rehearsalSwapDiagLog('tempo-sig/swap-rejected', { reason: 'empty-per-bar' });
            return false;
        }

        extendPerBarToScoreLength(
            perBar,
            spec,
            Math.max(perBar.length, startA + lenA, startB + lenB),
        );

        const sliceA = extractMeterBarSlice(perBar, startA, lenA);
        const sliceB = extractMeterBarSlice(perBar, startB, lenB);

        rehearsalSwapDiagLog('tempo-sig/swap-collect', {
            path: asymmetric ? 'bar-ranges-exclusive' : 'bar-ranges',
            beforeSliceA: summarizePerBarSliceForSwapDiag(perBar, startA, lenA, 'rangeA'),
            beforeSliceB: summarizePerBarSliceForSwapDiag(perBar, startB, lenB, 'rangeB'),
            sliceASigs: sliceA.map((e) => formatMeterSigText(e.sig)),
            sliceBSigs: sliceB.map((e) => formatMeterSigText(e.sig)),
            marks: resolveMarkSecMeterDiagEntries(o.markSecs, spec, master, markScoreBars),
        });

        if (asymmetric) {
            if (!swapPerBarTransportRangesExclusive(perBar, startA, lenA, startB, lenB)) {
                rehearsalSwapDiagLog('tempo-sig/swap-rejected', {
                    reason: 'exclusive-splice-failed',
                    startA: startA,
                    startB: startB,
                    countA: lenA,
                    countB: lenB,
                });
                return false;
            }
        } else {
            writeMeterBarSlice(perBar, startA, lenA, sliceB);
            writeMeterBarSlice(perBar, startB, lenB, sliceA);
        }

        const applied = applyPerBarMeterEntriesToMusicalGrid(perBar, spec, master, o);
        if (!applied) {
            rehearsalSwapDiagLog('tempo-sig/swap-rejected', { reason: 'apply-per-bar-failed' });
            return false;
        }

        readMusicalGridFromInputs();
        spec = getMeterSpec();
        const afterHeadA = summarizePerBarSliceForSwapDiag(perBar, 1, Math.min(lenB, perBar.length - 1), 'head-after-splice');
        const afterTailB =
            lenA > 0 && perBar.length > lenA
                ? summarizePerBarSliceForSwapDiag(
                      perBar,
                      Math.max(0, perBar.length - lenA - 1),
                      lenA,
                      'tail-after-splice',
                  )
                : null;
        logTempoSigSwapStage('tempo-sig/swap-applied', spec, master, {
            path: asymmetric ? 'bar-ranges-exclusive' : 'bar-ranges',
            totalBars: perBar.length,
            afterHeadAtBar1: afterHeadA,
            afterTailForOldRangeB: afterTailB,
            marks: resolveMarkSecMeterDiagEntries(o.markSecs, spec, master, markScoreBars),
        });

        // 非対称 splice 後は markSecs[1] が旧 C 区間内（例: bar6=4/4+5/8）に残るため、
        // 旧 sec への post-pin は最終小節の拍子を A 側で上書きしてしまう。
        if (
            !asymmetric &&
            prepSnapshots.length >= 2 &&
            Array.isArray(o.markSecs) &&
            o.markSecs.length >= 2
        ) {
            postPinMeterMarksAfterSlotSwap(o.markSecs, prepSnapshots, o);
            readMusicalGridFromInputs();
            spec = getMeterSpec();
        } else if (asymmetric && prepSnapshots.length >= 2) {
            rehearsalSwapDiagLog('tempo-sig/post-pin-skipped', {
                reason: 'asymmetric-splice',
                markSecs: o.markSecs,
            });
        }

        const expectedMarks =
            prepSnapshots.length >= 2 && Array.isArray(o.markSecs) && o.markSecs.length >= 2
                ? asymmetric
                  ? [
                        {
                            sec: o.markSecs[0],
                            bpm: prepSnapshots[1].bpm,
                            sig: formatMeterSigText(prepSnapshots[1].sig),
                        },
                    ]
                  : [
                        {
                            sec: o.markSecs[0],
                            bpm: prepSnapshots[1].bpm,
                            sig: formatMeterSigText(prepSnapshots[1].sig),
                        },
                        {
                            sec: o.markSecs[1],
                            bpm: prepSnapshots[0].bpm,
                            sig: formatMeterSigText(prepSnapshots[0].sig),
                        },
                    ]
                : null;

        logTempoSigSwapStage('tempo-sig/swap-done', spec, master, {
            path: asymmetric ? 'bar-ranges-exclusive' : 'bar-ranges',
            startA: startA,
            startB: startB,
            countA: lenA,
            countB: lenB,
            sliceAHead: sliceA.length
                ? { bpm: sliceA[0].bpm, sig: formatMeterSigText(sliceA[0].sig) }
                : null,
            sliceBHead: sliceB.length
                ? { bpm: sliceB[0].bpm, sig: formatMeterSigText(sliceB[0].sig) }
                : null,
            sliceASigs: sliceA.map((e) => formatMeterSigText(e.sig)),
            sliceBSigs: sliceB.map((e) => formatMeterSigText(e.sig)),
            prepSnapshots: prepSnapshots.map((s) => ({
                sec: s.sec,
                bpm: s.bpm,
                sig: formatMeterSigText(s.sig),
            })),
            expectedMarks: expectedMarks,
            marks: resolveMarkSecMeterDiagEntries(o.markSecs, spec, master, markScoreBars),
            verify:
                expectedMarks && Array.isArray(o.markSecs)
                    ? expectedMarks.map((exp, i) => {
                          const marks = resolveMarkSecMeterDiagEntries(
                              [o.markSecs[i]],
                              spec,
                              master,
                              null,
                          );
                          const actual = marks[0];
                          return {
                              sec: exp.sec,
                              expected: { bpm: exp.bpm, sig: exp.sig },
                              actual: actual
                                  ? { bpm: actual.bpmAtSec, sig: actual.sigAtSec }
                                  : null,
                              bpmOk:
                                  actual &&
                                  Math.abs(actual.bpmAtSec - exp.bpm) < 1e-6,
                              sigOk: actual && actual.sigAtSec === exp.sig,
                          };
                      })
                    : null,
            totalBars: perBar.length,
        });
        return true;
    }

    /**
     * RegionSwap — 2 つの Rehearsal グループに紐づく Tempo/Sig（小節列）をまるごと入れ替える。
     * preCounts で分割 → グループ内容を swap → postCounts で再構成。
     */
    function swapTempoSignatureForRehearsalGroups(groupIndexA, groupIndexB, preCounts, postCountsOpt, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const giA = groupIndexA | 0;
        const giB = groupIndexB | 0;
        if (giA < 0 || giB < 0 || giA === giB) return false;
        if (!Array.isArray(preCounts) || !preCounts.length) return false;
        if (giA >= preCounts.length || giB >= preCounts.length) return false;

        let postCounts = postCountsOpt;
        if (!Array.isArray(postCounts) || !postCounts.length) {
            postCounts = preCounts.slice();
            const tmp = postCounts[giA];
            postCounts[giA] = postCounts[giB];
            postCounts[giB] = tmp;
        }

        readMusicalGridFromInputs();
        const spec = getMeterSpec();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!spec || !(master > 0)) return false;

        const perBar = collectPerBarMeterEntriesFromTracks(spec, master);
        if (!perBar.length) return false;

        const groups = splitPerBarEntriesByRehearsalCounts(perBar, preCounts);
        while (groups.length < postCounts.length) groups.push([]);

        const sliceA = (groups[giA] || []).map(cloneMeterBarEntry);
        const sliceB = (groups[giB] || []).map(cloneMeterBarEntry);
        groups[giA] = sliceB;
        groups[giB] = sliceA;

        const nextPerBar = concatRehearsalGroupMeterSlices(groups, postCounts);
        if (!nextPerBar.length) return false;

        const applied = applyPerBarMeterEntriesToMusicalGrid(nextPerBar, spec, master, o);
        if (!applied) return false;

        rehearsalSwapDiagLog('tempo-sig/swap-groups', {
            giA: giA + 1,
            giB: giB + 1,
            preCounts: preCounts.slice(0, 16),
            postCounts: postCounts.slice(0, 16),
            barsBefore: perBar.length,
            barsAfter: nextPerBar.length,
        });
        return true;
    }

    /** Rehearsal Mark トラック — 小節頭の任意ラベル（sec, label） */
    let rehearsalMarkTrackEventsOverride = null;
    let rehearsalMarkTrackEventsPendingApply = null;
    let rehearsalMarkTrackEventsPersistCache = null;

    function syncRehearsalMarkTrackEventsPersistCache(raw) {
        if (!Array.isArray(raw)) {
            rehearsalMarkTrackEventsPersistCache = null;
            return;
        }
        const cached = [];
        for (let i = 0; i < raw.length; i++) {
            const e = raw[i];
            if (!e || typeof e !== 'object') continue;
            const sec = Number(e.sec);
            const label = normalizeRehearsalMarkLabel(e.label);
            if (!Number.isFinite(sec) || !label) continue;
            cached.push({ sec: sec, label: label });
        }
        cached.sort((a, b) => a.sec - b.sec);
        rehearsalMarkTrackEventsPersistCache = cached.length ? cached : null;
    }

    /** Rehearsal Mark ラベル — Tempo/Sig 形式や数値列は不正（現行フォーマット外） */
    const REHEARSAL_MARK_INVALID_TEMPO_SIG_RE = /\d+\s*[-–—−]\s*\d+\s*\/\s*\d+/;

    function isRehearsalMarkLabelFormatValid(raw) {
        const s = String(raw == null ? '' : raw).trim();
        if (!s) return false;
        if (REHEARSAL_MARK_INVALID_TEMPO_SIG_RE.test(s)) return false;
        if (/^[\d,\s.]+$/.test(s)) return false;
        return true;
    }

    function normalizeRehearsalMarkLabel(raw) {
        const s = String(raw == null ? '' : raw).trim();
        if (!isRehearsalMarkLabelFormatValid(s)) return '';
        return s;
    }

    function normalizeRehearsalMarkTrackEvents(raw, durationSec) {
        if (!(durationSec > 0)) return [];
        const events = [];
        if (Array.isArray(raw)) {
            for (let i = 0; i < raw.length; i++) {
                const e = raw[i];
                if (!e || typeof e !== 'object') continue;
                const sec = Number(e.sec);
                const label = normalizeRehearsalMarkLabel(e.label);
                if (!Number.isFinite(sec) || !label) continue;
                events.push({ sec: Math.max(0, Math.min(durationSec, sec)), label: label });
            }
        }
        events.sort((a, b) => a.sec - b.sec);
        const deduped = [];
        for (let i = 0; i < events.length; i++) {
            if (
                deduped.length &&
                Math.abs(events[i].sec - deduped[deduped.length - 1].sec) < 1e-6
            ) {
                deduped[deduped.length - 1] = events[i];
            } else {
                deduped.push(events[i]);
            }
        }
        return deduped;
    }

    function rehearsalMarkEventsMaxSec(events) {
        if (!Array.isArray(events) || !events.length) return 0;
        let max = 0;
        for (let i = 0; i < events.length; i++) {
            const e = events[i];
            if (!e || typeof e !== 'object') continue;
            const sec = Number(e.sec);
            if (Number.isFinite(sec)) max = Math.max(max, sec);
        }
        return max;
    }

    function rehearsalMarkTracksMatch(a, b, tolerance) {
        const eps = tolerance != null ? tolerance : 1e-3;
        if (!a || !a.length) return !b || !b.length;
        if (!b || b.length !== a.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (normalizeRehearsalMarkLabel(a[i].label) !== normalizeRehearsalMarkLabel(b[i].label)) {
                return false;
            }
            if (Math.abs(Number(a[i].sec) - Number(b[i].sec)) > eps) return false;
        }
        return true;
    }

    /** マスター長がマーク位置を収容できない間は適用を延期する（復元時の 0.01s プレースホルダ対策） */
    function shouldDeferRehearsalMarkApply(events, durationSec) {
        if (!(durationSec > 0)) return true;
        if (!Array.isArray(events) || !events.length) return false;
        return rehearsalMarkEventsMaxSec(events) > durationSec + 1e-6;
    }

    function resolveRehearsalMarksToApply(maxSec) {
        if (!(maxSec > 0)) return null;
        if (
            rehearsalMarkTrackEventsPendingApply &&
            rehearsalMarkTrackEventsPendingApply.length
        ) {
            const pending = rehearsalMarkTrackEventsPendingApply;
            if (rehearsalMarkEventsMaxSec(pending) <= maxSec + 1e-6) {
                return pending.slice();
            }
            return null;
        }
        const cache = rehearsalMarkTrackEventsPersistCache;
        if (!cache || !cache.length) return null;
        if (rehearsalMarkEventsMaxSec(cache) > maxSec + 1e-6) return null;
        const normalizedCache = normalizeRehearsalMarkTrackEvents(cache, maxSec);
        const normalizedOverride = rehearsalMarkTrackEventsOverride
            ? normalizeRehearsalMarkTrackEvents(rehearsalMarkTrackEventsOverride, maxSec)
            : null;
        if (!rehearsalMarkTracksMatch(normalizedOverride, normalizedCache)) {
            return cache.slice();
        }
        return null;
    }

    function rehearsalMarkTrackEventsSource() {
        if (rehearsalMarkTrackEventsOverride && rehearsalMarkTrackEventsOverride.length) {
            return rehearsalMarkTrackEventsOverride;
        }
        if (rehearsalMarkTrackEventsPendingApply && rehearsalMarkTrackEventsPendingApply.length) {
            return rehearsalMarkTrackEventsPendingApply;
        }
        return null;
    }

    function getRehearsalMarkTrackEvents(_meterSpec, durationSec) {
        const source = rehearsalMarkTrackEventsSource();
        if (!source) return [];
        if (!(durationSec > 0)) {
            const pending = [];
            for (let i = 0; i < source.length; i++) {
                const e = source[i];
                if (!e || typeof e !== 'object') continue;
                const sec = Number(e.sec);
                const label = normalizeRehearsalMarkLabel(e.label);
                if (!Number.isFinite(sec) || !label) continue;
                pending.push({ sec: Math.max(0, sec), label: label });
            }
            pending.sort((a, b) => a.sec - b.sec);
            return pending;
        }
        return normalizeRehearsalMarkTrackEvents(source, durationSec);
    }

    function clearRehearsalMarkTrackEventsOverride() {
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('rehearsal/clear', {
                hadOverride: !!(rehearsalMarkTrackEventsOverride && rehearsalMarkTrackEventsOverride.length),
                hadPending: !!(
                    rehearsalMarkTrackEventsPendingApply && rehearsalMarkTrackEventsPendingApply.length
                ),
                hadCache: !!(
                    rehearsalMarkTrackEventsPersistCache && rehearsalMarkTrackEventsPersistCache.length
                ),
            });
        }
        rehearsalMarkTrackEventsOverride = null;
        rehearsalMarkTrackEventsPendingApply = null;
        rehearsalMarkTrackEventsPersistCache = null;
    }

    function getRehearsalMarkTrackEventsDiagState() {
        return {
            overrideCount: rehearsalMarkTrackEventsOverride
                ? rehearsalMarkTrackEventsOverride.length
                : 0,
            pendingCount: rehearsalMarkTrackEventsPendingApply
                ? rehearsalMarkTrackEventsPendingApply.length
                : 0,
            cacheCount: rehearsalMarkTrackEventsPersistCache
                ? rehearsalMarkTrackEventsPersistCache.length
                : 0,
            snapshotCount: getRehearsalMarkTrackEventsPersistSnapshot().length,
            masterSec:
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : 0,
        };
    }

    function setRehearsalMarkTrackEvents(events, _meterSpec, durationSec) {
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('rehearsal/set/begin', {
                durationSec: durationSec,
                input:
                    typeof musicalTrackPersistDiagSummarizeRehearsalEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeRehearsalEvents(events)
                        : { count: Array.isArray(events) ? events.length : 0 },
                before: getRehearsalMarkTrackEventsDiagState(),
            });
        }
        if (Array.isArray(events)) {
            syncRehearsalMarkTrackEventsPersistCache(events);
        } else if (!events || !events.length) {
            syncRehearsalMarkTrackEventsPersistCache([]);
        }
        const rawEvents = Array.isArray(events) ? events : null;
        if (shouldDeferRehearsalMarkApply(rawEvents, durationSec)) {
            if (rawEvents && rawEvents.length) {
                rehearsalMarkTrackEventsPendingApply = rawEvents.slice();
                rehearsalMarkTrackEventsOverride = null;
                if (typeof musicalTrackPersistDiagLog === 'function') {
                    musicalTrackPersistDiagLog('rehearsal/set/pending', {
                        durationSec: durationSec,
                        reason:
                            durationSec > 0 ? 'duration-too-short' : 'no-duration',
                        pending:
                            typeof musicalTrackPersistDiagSummarizeRehearsalEvents === 'function'
                                ? musicalTrackPersistDiagSummarizeRehearsalEvents(rawEvents)
                                : { count: rawEvents.length },
                        after: getRehearsalMarkTrackEventsDiagState(),
                    });
                }
            } else if (!rawEvents || !rawEvents.length) {
                clearRehearsalMarkTrackEventsOverride();
            }
            return [];
        }
        const normalized = normalizeRehearsalMarkTrackEvents(events, durationSec);
        rehearsalMarkTrackEventsOverride = normalized.length ? normalized.slice() : null;
        rehearsalMarkTrackEventsPendingApply = null;
        if (typeof clearMusicalGridPositionCache === 'function') clearMusicalGridPositionCache();
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('rehearsal/set/done', {
                durationSec: durationSec,
                normalized:
                    typeof musicalTrackPersistDiagSummarizeRehearsalEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeRehearsalEvents(normalized)
                        : { count: normalized.length },
                after: getRehearsalMarkTrackEventsDiagState(),
            });
        }
        return normalized;
    }

    function getRehearsalMarkTrackEventsPersistSnapshot() {
        if (rehearsalMarkTrackEventsPersistCache && rehearsalMarkTrackEventsPersistCache.length) {
            return rehearsalMarkTrackEventsPersistCache.map((e) => ({
                sec: Number(e.sec),
                label: normalizeRehearsalMarkLabel(e.label),
            }));
        }
        const source = rehearsalMarkTrackEventsSource();
        if (!source) return [];
        return source
            .map((e) => ({
                sec: Number(e.sec),
                label: normalizeRehearsalMarkLabel(e.label),
            }))
            .filter((e) => Number.isFinite(e.sec) && e.label);
    }

    function applyRehearsalMarkTrackEventsFromPersist(raw, durationSec) {
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('rehearsal/apply/begin', {
                durationSec: durationSec,
                raw:
                    typeof musicalTrackPersistDiagSummarizeRehearsalEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeRehearsalEvents(raw)
                        : { count: Array.isArray(raw) ? raw.length : 0 },
                before: getRehearsalMarkTrackEventsDiagState(),
            });
        }
        if (!Array.isArray(raw)) {
            clearRehearsalMarkTrackEventsOverride();
            return [];
        }
        syncRehearsalMarkTrackEventsPersistCache(raw);
        if (!raw.length) {
            clearRehearsalMarkTrackEventsOverride();
            if (typeof musicalTrackPersistDiagLog === 'function') {
                musicalTrackPersistDiagLog('rehearsal/apply/clear-empty', {
                    durationSec: durationSec,
                    after: getRehearsalMarkTrackEventsDiagState(),
                });
            }
            return [];
        }
        const out = setRehearsalMarkTrackEvents(raw, null, durationSec);
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('rehearsal/apply/done', {
                durationSec: durationSec,
                after: getRehearsalMarkTrackEventsDiagState(),
                normalized:
                    typeof musicalTrackPersistDiagSummarizeRehearsalEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeRehearsalEvents(out)
                        : { count: out.length },
            });
        }
        return out;
    }

    function tryApplyPendingRehearsalMarkTrackEvents() {
        const maxSec =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const toApply = resolveRehearsalMarksToApply(maxSec);
        if (!toApply || !toApply.length) {
            if (!(maxSec > 0) && typeof musicalTrackPersistDiagLog === 'function') {
                musicalTrackPersistDiagLog('rehearsal/pending/skip-no-master', {
                    maxSec: maxSec,
                    state: getRehearsalMarkTrackEventsDiagState(),
                    pending:
                        rehearsalMarkTrackEventsPendingApply &&
                        rehearsalMarkTrackEventsPendingApply.length &&
                        typeof musicalTrackPersistDiagSummarizeRehearsalEvents === 'function'
                            ? musicalTrackPersistDiagSummarizeRehearsalEvents(
                                  rehearsalMarkTrackEventsPendingApply,
                              )
                            : null,
                });
            }
            return false;
        }
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('rehearsal/pending/apply', {
                maxSec: maxSec,
                pending:
                    typeof musicalTrackPersistDiagSummarizeRehearsalEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeRehearsalEvents(toApply)
                        : { count: toApply.length },
            });
        }
        setRehearsalMarkTrackEvents(toApply, null, maxSec);
        const applied = !!(
            rehearsalMarkTrackEventsOverride && rehearsalMarkTrackEventsOverride.length
        );
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog(applied ? 'rehearsal/pending/applied' : 'rehearsal/pending/failed', {
                maxSec: maxSec,
                after: getRehearsalMarkTrackEventsDiagState(),
            });
        }
        return applied;
    }

    function refreshRehearsalMarkTrackEventsAfterMasterDurationReady() {
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('rehearsal/master/ready', {
                state: getRehearsalMarkTrackEventsDiagState(),
            });
        }
        const applied =
            typeof tryApplyPendingRehearsalMarkTrackEvents === 'function'
                ? tryApplyPendingRehearsalMarkTrackEvents()
                : false;
        if (typeof scheduleMusicalGridRedraw === 'function') {
            scheduleMusicalGridRedraw();
        }
        if (typeof refreshRehearsalTrack === 'function') {
            refreshRehearsalTrack();
        }
        if (applied && typeof refreshAllRegionRehearsalMarkLabels === 'function') {
            refreshAllRegionRehearsalMarkLabels();
        }
        return applied;
    }

    window.barDurationSecWithTempoEvents = barDurationSecWithTempoEvents;
    window.syncMeterSpecBpmFromTempoEvents = syncMeterSpecBpmFromTempoEvents;
    window.applyTempoTrackEvents = applyTempoTrackEvents;
    window.getTempoTrackEvents = getTempoTrackEvents;
    window.resolveTempoBpmAtSec = resolveTempoBpmAtSec;
    window.setTempoTrackEvents = setTempoTrackEvents;
    window.clearTempoTrackEventsOverride = clearTempoTrackEventsOverride;
    window.buildTempoTrackEventsFromMeterSpec = buildTempoTrackEventsFromMeterSpec;
    window.normalizeTempoTrackEvents = normalizeTempoTrackEvents;
    window.getSignatureTrackEvents = getSignatureTrackEvents;
    window.setSignatureTrackEvents = setSignatureTrackEvents;
    window.clearSignatureTrackEventsOverride = clearSignatureTrackEventsOverride;
    window.buildSignatureTrackEventsFromMeterSpec = buildSignatureTrackEventsFromMeterSpec;
    window.applySignatureTrackEvents = applySignatureTrackEvents;
    window.rehearsalGroupBarStartIndexFromCounts = rehearsalGroupBarStartIndexFromCounts;
    window.swapTempoSignatureForBarRanges = swapTempoSignatureForBarRanges;
    window.swapTempoSignatureForBarRangesInPlace = swapTempoSignatureForBarRangesInPlace;
    window.swapPerBarTransportRangesExclusive = swapPerBarTransportRangesExclusive;
    window.swapPerBarTransportRangesInPlace = swapPerBarTransportRangesInPlace;
    window.resolveTransportMeterSpanForSwapSec = resolveTransportMeterSpanForSwapSec;
    window.projectScoreMeterSpansOntoTransport = projectScoreMeterSpansOntoTransport;
    window.swapTempoSignatureForSlotIndices = swapTempoSignatureForSlotIndices;
    window.swapTempoSignatureForRehearsalGroups = swapTempoSignatureForRehearsalGroups;
    window.pinMeterTrackEventsAtMarkSecs = pinMeterTrackEventsAtMarkSecs;
    window.repinMeterTrackEventsAtAllRehearsalMarks = repinMeterTrackEventsAtAllRehearsalMarks;
    window.repinMeterTrackEventsFromPreSwapSnapshots = repinMeterTrackEventsFromPreSwapSnapshots;
    window.captureMeterPrepSnapshotsAtRehearsalMarks = captureMeterPrepSnapshotsAtRehearsalMarks;
    window.resolveTempoBpmLookbackAtMarkSec = resolveTempoBpmLookbackAtMarkSec;
    window.resolveSigLookbackAtMarkSec = resolveSigLookbackAtMarkSec;
    window.rebuildTempoSigTracksFromPerBarGrid = rebuildTempoSigTracksFromPerBarGrid;
    window.captureLabeledRehearsalMeterSlices = captureLabeledRehearsalMeterSlices;
    window.applyLabeledRehearsalMeterSlicesAfterMarkRipple =
        applyLabeledRehearsalMeterSlicesAfterMarkRipple;
    window.snapRehearsalMarksToMeterBarBoundaries = snapRehearsalMarksToMeterBarBoundaries;
    window.repinMeterTrackEventsAtAllRehearsalMarkBars =
        repinMeterTrackEventsAtAllRehearsalMarkBars;
    window.finalizeTransportSwapMeterGridAfterPerBarApply =
        finalizeTransportSwapMeterGridAfterPerBarApply;
    window.captureTransportSwapMeterSlices = captureTransportSwapMeterSlices;
    window.applyTransportSwapMeterSlicesAfterMarkRipple =
        applyTransportSwapMeterSlicesAfterMarkRipple;
    window.ensureTempoSignatureAtBarStarts = ensureTempoSignatureAtBarStarts;
    window.ensureTempoSignatureAtMarkSecs = ensureTempoSignatureAtMarkSecs;
    window.ensureTempoSignatureAtAllRehearsalMarks = ensureTempoSignatureAtAllRehearsalMarks;
    window.collectAllRehearsalMarkTransportSecs = collectAllRehearsalMarkTransportSecs;
    window.getMeterBarCountForRegionSwap = getMeterBarCountForRegionSwap;
    window.pinMeterTrackEventsFromPerBar = pinMeterTrackEventsFromPerBar;
    window.buildTempoTrackEventsFromPerBarEntries = buildTempoTrackEventsFromPerBarEntries;
    window.buildSignatureTrackEventsFromPerBarEntries =
        buildSignatureTrackEventsFromPerBarEntries;
    window.rebuildMeterSpecFromTrackEvents = rebuildMeterSpecFromTrackEvents;
    window.resolveSigAtBarIndex = resolveSigAtBarIndex;
    window.barIndexForBoundarySec = barIndexForBoundarySec;
    window.shouldDeferMusicalGridTrackEventsApply = shouldDeferMusicalGridTrackEventsApply;
    window.minDurationSecForMusicalGridTrackApply = minDurationSecForMusicalGridTrackApply;
    window.getTempoSignatureTrackEventsDiagState = getTempoSignatureTrackEventsDiagState;
    window.mapSignatureTrackEventsForPersist = mapSignatureTrackEventsForPersist;
    window.applyMusicalGridTrackEventsFromPersistSnap = applyMusicalGridTrackEventsFromPersistSnap;
    window.tryApplyPendingMusicalGridTrackEvents = tryApplyPendingMusicalGridTrackEvents;
    window.refreshMusicalGridTrackEventsAfterMasterDurationReady =
        refreshMusicalGridTrackEventsAfterMasterDurationReady;
    window.clearMusicalGridTrackEventsPersistPending = clearMusicalGridTrackEventsPersistPending;
    window.getRehearsalMarkTrackEvents = getRehearsalMarkTrackEvents;
    window.setRehearsalMarkTrackEvents = setRehearsalMarkTrackEvents;
    window.clearRehearsalMarkTrackEventsOverride = clearRehearsalMarkTrackEventsOverride;
    window.normalizeRehearsalMarkTrackEvents = normalizeRehearsalMarkTrackEvents;
    window.normalizeRehearsalMarkLabel = normalizeRehearsalMarkLabel;
    window.getRehearsalMarkTrackEventsPersistSnapshot = getRehearsalMarkTrackEventsPersistSnapshot;
    window.getRehearsalMarkTrackEventsDiagState = getRehearsalMarkTrackEventsDiagState;
    window.applyRehearsalMarkTrackEventsFromPersist = applyRehearsalMarkTrackEventsFromPersist;
    window.tryApplyPendingRehearsalMarkTrackEvents = tryApplyPendingRehearsalMarkTrackEvents;
    window.refreshRehearsalMarkTrackEventsAfterMasterDurationReady =
        refreshRehearsalMarkTrackEventsAfterMasterDurationReady;
