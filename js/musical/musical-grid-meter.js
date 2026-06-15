/**
 * musical-grid-meter.js — Tempo/Sig パース・拍子編集
 */
    const musicalGridMeterInput = document.getElementById('musicalGridMeterInput');
    const musicalGridPhraseInput = document.getElementById('musicalGridPhraseInput');
    const musicalGridVisibleCheckbox = document.getElementById('musicalGridVisibleCheckbox');
    const musicalGridPhraseFillCheckbox = document.getElementById('musicalGridPhraseFillCheckbox');
    const musicalGridCanvas =
        typeof audioWaveformMusicalGrid !== 'undefined' && audioWaveformMusicalGrid
            ? audioWaveformMusicalGrid
            : document.getElementById('audioWaveformMusicalGrid');
    let musicalGridMeterText = '';
    let musicalGridPhraseText = '';
    let musicalGridVisible = false;
    let musicalGridPhraseFillVisible = false;
    let musicalGridPosCache = null;
    let musicalGridNavStopsCache = null;
    let musicalGridNavStopsCacheKey = '';
    /** RegionSwap 等で展開 counts を直接保持（Phrase 欄テキストは spec サイクルのまま） */
    let phraseGroupBarCountsOverride = null;
    const phraseUndoStack = [];
    function clearPhraseGroupBarCountsOverride() {
        phraseGroupBarCountsOverride = null;
    }
    function setPhraseGroupBarCountsOverride(counts) {
        if (!counts || !counts.length) {
            clearPhraseGroupBarCountsOverride();
            return;
        }
        phraseGroupBarCountsOverride = counts.map((n) => n | 0);
    }
    /** 展開 counts — override 優先、なければ phraseSpec から展開 */
    function resolvePhraseGroupBarCounts(meterSpec, durationSec, phraseSpec) {
        if (phraseGroupBarCountsOverride && phraseGroupBarCountsOverride.length) {
            return phraseGroupBarCountsOverride.slice();
        }
        if (!phraseSpec) return [];
        return expandPhraseSpecToGroupBarCounts(meterSpec, durationSec, phraseSpec);
    }
    /** Phrase 欄 API — [MusicalSlot] phrase/* ログ */
    function phraseSwapDiagLog(stage, extra) {
        if (typeof window !== 'undefined' && typeof window.musicalSlotDiagLog === 'function') {
            window.musicalSlotDiagLog('phrase/' + stage, extra);
            return;
        }
        if (typeof writeLog !== 'function') return;
        const tail = extra ? ' | ' + JSON.stringify(extra) : '';
        writeLog('[MusicalSlot] phrase/' + stage + tail);
    }
    const phraseRedoStack = [];
    let phraseUndoPaused = false;
    let phraseInputFocusSnapshot = null;
    let phraseInputCommitViaEnter = false;
    /** Tempo/Sig 確定時のリージョン切り直し判定 — 編集開始時の確定値（編集中の musicalGridMeterText 更新と区別） */
    let meterEditorLayoutBaseline = null;
    function capturePhraseUndoSnapshot() {
        readMusicalGridFromInputs();
        return normalizeMusicalGridPhraseText(musicalGridPhraseText);
    }
    function clearPhraseRedoStack() {
        phraseRedoStack.length = 0;
    }
    function clearPhraseUndoStack() {
        phraseUndoStack.length = 0;
        clearPhraseRedoStack();
        phraseInputFocusSnapshot = null;
    }
    function requestPhraseUndoCapture() {
        if (phraseUndoPaused) return;
        const snap = capturePhraseUndoSnapshot();
        const top = phraseUndoStack.length
            ? phraseUndoStack[phraseUndoStack.length - 1]
            : null;
        if (top === snap) return;
        phraseUndoStack.push(snap);
        clearPhraseRedoStack();
    }
    function restorePhraseUndoSnapshot(phrase, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        phraseUndoPaused = true;
        clearPhraseGroupBarCountsOverride();
        musicalGridPhraseText = normalizeMusicalGridPhraseText(phrase);
        if (musicalGridPhraseInput) {
            musicalGridPhraseInput.value = musicalGridPhraseText;
        }
        persistMusicalGridAndRedraw({
            skipUndo: true,
            skipTimelineSlotRebuild: !!o.skipTimelineSlotRebuild,
            relayoutRegions:
                !o.skipRelayoutRegions && canCommitPhraseCompositionLayout(),
        });
        updatePhraseBoundaryOverlay();
        phraseUndoPaused = false;
    }
    function undoPhraseDefinition() {
        if (!phraseUndoStack.length) return false;
        const current = capturePhraseUndoSnapshot();
        const prev = phraseUndoStack.pop();
        phraseRedoStack.push(current);
        restorePhraseUndoSnapshot(prev);
        if (typeof writeLog === 'function') {
            if (typeof logPhraseAction === 'function') {
                logPhraseAction('undo → ' + musicalGridPhraseText);
            } else {
                writeLog('Phrase: undo -> ' + musicalGridPhraseText);
            }
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Phrase', 'Undo', 'notice');
        }
        return true;
    }
    function redoPhraseDefinition() {
        if (!phraseRedoStack.length) return false;
        const current = capturePhraseUndoSnapshot();
        const next = phraseRedoStack.pop();
        phraseUndoStack.push(current);
        restorePhraseUndoSnapshot(next);
        if (typeof writeLog === 'function') {
            if (typeof logPhraseAction === 'function') {
                logPhraseAction('redo → ' + musicalGridPhraseText);
            } else {
                writeLog('Phrase: redo -> ' + musicalGridPhraseText);
            }
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Phrase', 'Redo', 'notice');
        }
        return true;
    }
    function commitPhraseInputUndoIfChanged() {
        readMusicalGridFromInputs();
        const after = capturePhraseUndoSnapshot();
        if (phraseInputFocusSnapshot == null || phraseUndoPaused) {
            phraseInputFocusSnapshot = null;
            return;
        }
        if (phraseInputFocusSnapshot !== after) {
            const top = phraseUndoStack.length
                ? phraseUndoStack[phraseUndoStack.length - 1]
                : null;
            if (top !== phraseInputFocusSnapshot) {
                phraseUndoStack.push(phraseInputFocusSnapshot);
                clearPhraseRedoStack();
            }
        }
        phraseInputFocusSnapshot = null;
    }
    function handleMusicalGridPhraseUndoKeydown(e) {
        if (!matchUserShortcut(e, 'regionUndo')) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        if (phraseBoundaryDragActive) return false;
        if (!undoPhraseDefinition()) return false;
        e.preventDefault();
        return true;
    }
    function handleMusicalGridPhraseRedoKeydown(e) {
        if (!matchUserShortcut(e, 'regionRedo')) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        if (phraseBoundaryDragActive) return false;
        if (!redoPhraseDefinition()) return false;
        e.preventDefault();
        return true;
    }
    const BAR_GROUP_FILL_A = 'rgba(200, 48, 58, 0.14)';
    const BAR_GROUP_FILL_B = 'rgba(48, 110, 220, 0.14)';
    const MUSICAL_GRID_DEFAULT_METER_TEXT = '120-4/4';
    const MUSICAL_GRID_DEFAULT_PHRASE_TEXT = '8';
    /** Phrase 欄を指定サイクル定義へ反映（展開 counts 経由で grid を再構築） */
    function repairPhraseSpecToSizes(sizes, opt) {
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
        const counts = expandPhraseSpecToGroupBarCounts(
            settings.meterSpec,
            master,
            spec,
        );
        applyExplicitPhraseGroupBarCounts(counts, { skipUndo: !!o.skipUndo });
        persistMusicalGridAndRedraw({ relayoutSilent: true });
        if (!o.silent) phraseSwapDiagLog('spec/repair', { sizes: sizes.join(',') });
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

    function normalizeMusicalGridPhraseText(raw) {
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

    function meterInputShouldAppendCommaEntry(input, raw, entryIndex) {
        if (!input || !phraseInputCaretAtEnd(input)) return false;
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

    function meterEntriesEqual(a, b) {
        if (!a || !b) return false;
        if (a.mode !== b.mode) return false;
        if (!a.entries || !b.entries || a.entries.length !== b.entries.length) return false;
        for (let i = 0; i < a.entries.length; i++) {
            if (a.entries[i].bpm !== b.entries[i].bpm) return false;
            if (a.entries[i].sig.num !== b.entries[i].sig.num) return false;
            if (a.entries[i].sig.den !== b.entries[i].sig.den) return false;
        }
        return true;
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

    function composeMeterTextFromLegacy(tempo, timeSignature) {
        const bpmStr = normalizeMusicalGridTempoText(tempo);
        const sigStr = normalizeMusicalGridTimeSigText(timeSignature);
        if (!bpmStr && !sigStr) return '';
        const bpm = bpmStr || '120';
        let sig = sigStr || '4/4';
        let mode = 'fixed';
        const altMatch = /^\((.+)\)$/.exec(sig);
        if (altMatch) {
            mode = 'alternate';
            sig = altMatch[1];
        }
        const sigParts = sig.split(',').filter((p) => p.length > 0);
        const tokens = sigParts.map((p) => {
            if (/^\d+(?:\.\d+)?-[\d\/:+]+$/.test(p)) return p;
            return bpm + '-' + p;
        });
        if (!tokens.length) return '';
        const joined = tokens.join(',');
        return mode === 'alternate' ? '(' + joined + ')' : joined;
    }

    function meterTextFromPersistSnapshot(snap) {
        const s = snap && typeof snap === 'object' ? snap : {};
        if (s.meter != null && String(s.meter).trim()) {
            return normalizeMusicalGridMeterText(s.meter);
        }
        return composeMeterTextFromLegacy(s.tempo, s.timeSignature);
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
     * Phrase 欄: "8" = 8 小節ごと。"1,8" = 先頭 1 小節のみ、その後は 8 小節ずつ。
     * @returns {{ sizes: number[] }|null}
     */
    function parsePhraseGroupingSpec(raw) {
        const s = normalizeMusicalGridPhraseText(raw);
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

        if (
            playbackAligned &&
            Math.abs(rate - 1) > 0.00001 &&
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
        ) {
            const boundaries = collectPlaybackAlignedBarBoundarySecs(
                meterSpec,
                durationSec,
            );
            for (let barIndex = 0; barIndex < boundaries.length - 1; barIndex++) {
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

        let t = 0;
        let barIndex = 0;
        const maxLines = 24000;
        while (t < durationSec - 1e-9 && lines.length < maxLines) {
            const entry = getMeterEntryForBar(meterSpec, barIndex);
            if (!entry) break;
            const barDur = meterBarDurationSec(entry);
            lines.push({ sec: t, kind: 'bar' });
            if (showBeats) {
                forEachMeterBarBeat(t, entry, (beat) => {
                    if (beat.beatInBar === 0) return;
                    if (beat.sec >= durationSec - 1e-9) return;
                    lines.push({ sec: beat.sec, kind: 'beat' });
                });
            }
            t += barDur;
            barIndex += 1;
        }
        return lines;
    }

    /** @returns {{ startSec: number, endSec: number, paletteIndex: number }[]} */
    function collectPhraseGroupRanges(meterSpec, durationSec, phraseSpec) {
        const ranges = [];
        if (!(durationSec > 0) || !meterSpec || !phraseSpec || !phraseSpec.sizes) {
            return ranges;
        }
        const sizes = phraseSpec.sizes;
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



    function readMusicalGridFromInputs() {
        if (musicalGridMeterInput) {
            const draft = normalizeMusicalGridMeterText(musicalGridMeterInput.value);
            if (draft && parseMeterSpec(draft)) {
                musicalGridMeterText = draft;
            }
        }
        if (musicalGridPhraseInput) {
            musicalGridPhraseText = normalizeMusicalGridPhraseText(musicalGridPhraseInput.value);
        }
    }

    function getCommittedMusicalGridMeterText() {
        const s = normalizeMusicalGridMeterText(musicalGridMeterText);
        if (s && parseMeterSpec(s)) return s;
        return MUSICAL_GRID_DEFAULT_METER_TEXT;
    }

    function getMusicalGridMeterLayoutBaseline() {
        if (meterEditorLayoutBaseline != null && meterEditorLayoutBaseline !== '') {
            const spec = parseMeterSpec(meterEditorLayoutBaseline);
            if (spec) return formatMeterSpec(spec);
        }
        return getCommittedMusicalGridMeterText();
    }

    function syncMusicalGridMeterLayoutBaseline(text) {
        const spec = parseMeterSpec(text);
        meterEditorLayoutBaseline = spec ? formatMeterSpec(spec) : getCommittedMusicalGridMeterText();
    }

    /** @returns {{ accepted: boolean, changed: boolean }} */
    function applyMusicalGridMeterCommitFromInputs(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const draft = musicalGridMeterInput
            ? normalizeMusicalGridMeterText(musicalGridMeterInput.value)
            : normalizeMusicalGridMeterText(musicalGridMeterText);
        const prevCommitted = getCommittedMusicalGridMeterText();
        const prevStored = musicalGridMeterText;
        const layoutBaseline = getMusicalGridMeterLayoutBaseline();

        if (!draft) {
            musicalGridMeterText = prevCommitted;
            if (musicalGridMeterInput) musicalGridMeterInput.value = musicalGridMeterText;
            return { accepted: false, changed: prevStored !== musicalGridMeterText };
        }

        const spec = parseMeterSpec(draft);
        if (!spec) {
            musicalGridMeterText = prevCommitted;
            if (musicalGridMeterInput) musicalGridMeterInput.value = musicalGridMeterText;
            if (
                o.notifyReject &&
                typeof flashSeekHint === 'function' &&
                draft !== prevCommitted
            ) {
                flashSeekHint('Tempo/Sig', '入力が不正のため前の値を維持', 'notice');
            }
            return { accepted: false, changed: false };
        }

        const next = formatMeterSpec(spec);
        const changed = next !== layoutBaseline;
        musicalGridMeterText = next;
        if (musicalGridMeterInput) musicalGridMeterInput.value = next;
        if (changed) syncMusicalGridMeterLayoutBaseline(next);
        return { accepted: true, changed };
    }
