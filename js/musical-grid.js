/**
 * musical-grid.js — 拍子グリッド（表示・拍/小節設定・フレーズ塗り）と prefs 永続化。
 */
(function musicalGridModule() {
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

    const phraseUndoStack = [];
    const phraseRedoStack = [];
    let phraseUndoPaused = false;
    let phraseInputFocusSnapshot = null;

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

    function restorePhraseUndoSnapshot(phrase) {
        phraseUndoPaused = true;
        musicalGridPhraseText = normalizeMusicalGridPhraseText(phrase);
        if (musicalGridPhraseInput) {
            musicalGridPhraseInput.value = musicalGridPhraseText;
        }
        clearMusicalGridPositionCache();
        if (typeof persistMusicalGridToStorage === 'function') {
            persistMusicalGridToStorage();
        }
        scheduleMusicalGridRedraw();
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
            writeLog('Phrase: undo -> ' + musicalGridPhraseText);
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
            writeLog('Phrase: redo -> ' + musicalGridPhraseText);
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

    function normalizeMusicalGridTempoText(raw) {
        return String(raw == null ? '' : raw).trim();
    }

    function normalizeMusicalGridMeterText(raw) {
        return String(raw == null ? '' : raw)
            .trim()
            .replace(/\s+/g, '')
            .replace(/／/g, '/')
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

    function parseMeterToken(token) {
        const m = /^(\d+(?:\.\d+)?)-(\d+\/\d+)$/.exec(String(token || '').trim());
        if (!m) return null;
        const bpm = Number(m[1]);
        const sig = parseTimeSignatureToken(m[2]);
        if (!sig || !(bpm > 0 && bpm <= 999)) return null;
        return { bpm, sig };
    }

    /** @returns {{ mode: 'fixed'|'sequence'|'alternate', entries: {bpm:number, sig:{num:number, den:number}}[] }|null} */
    function parseMeterSpec(raw) {
        let s = normalizeMusicalGridMeterText(raw);
        if (!s) return null;
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
        return { mode, entries };
    }

    function formatBpmForMeter(bpm) {
        return Math.abs(bpm - Math.round(bpm)) < 1e-9 ? String(Math.round(bpm)) : String(bpm);
    }

    function formatMeterSpec(spec) {
        if (!spec || !spec.entries || !spec.entries.length) return '';
        const parts = spec.entries.map(
            (e) => formatBpmForMeter(e.bpm) + '-' + e.sig.num + '/' + e.sig.den,
        );
        const joined = parts.join(',');
        return spec.mode === 'alternate' ? '(' + joined + ')' : joined;
    }

    function getMeterEntryForBar(spec, barIndex) {
        if (!spec || !spec.entries || !spec.entries.length) return null;
        const entries = spec.entries;
        if (spec.mode === 'fixed') return entries[0];
        if (spec.mode === 'alternate') {
            return entries[((barIndex % entries.length) + entries.length) % entries.length];
        }
        if (barIndex < entries.length) return entries[barIndex];
        return entries[entries.length - 1];
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
            if (/^\d+(?:\.\d+)?-\d+\/\d+$/.test(p)) return p;
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

    function getTimeSignatureForBar(spec, barIndex) {
        if (!spec || !spec.signatures || !spec.signatures.length) return null;
        const sigs = spec.signatures;
        if (spec.mode === 'fixed') return sigs[0];
        if (spec.mode === 'alternate') {
            return sigs[((barIndex % sigs.length) + sigs.length) % sigs.length];
        }
        if (barIndex < sigs.length) return sigs[barIndex];
        return sigs[sigs.length - 1];
    }

    function beatDurationSec(sig, bpm) {
        return ((4 / sig.den) * 60) / bpm;
    }

    function collectMusicalGridLines(meterSpec, durationSec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const showBeats = o.showBeats !== false;
        const lines = [];
        if (!(durationSec > 0) || !meterSpec) return lines;
        let t = 0;
        let barIndex = 0;
        const maxLines = 24000;
        while (t < durationSec - 1e-9 && lines.length < maxLines) {
            const entry = getMeterEntryForBar(meterSpec, barIndex);
            if (!entry) break;
            const sig = entry.sig;
            const bpm = entry.bpm;
            const beatDur = beatDurationSec(sig, bpm);
            const barDur = sig.num * beatDur;
            lines.push({ sec: t, kind: 'bar' });
            if (showBeats) {
                for (let beat = 1; beat < sig.num; beat++) {
                    const beatSec = t + beat * beatDur;
                    if (beatSec >= durationSec - 1e-9) break;
                    lines.push({ sec: beatSec, kind: 'beat' });
                }
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
            const sig = entry.sig;
            const barDur = sig.num * beatDurationSec(sig, entry.bpm);
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
            musicalGridMeterText = normalizeMusicalGridMeterText(musicalGridMeterInput.value);
        }
        if (musicalGridPhraseInput) {
            musicalGridPhraseText = normalizeMusicalGridPhraseText(musicalGridPhraseInput.value);
        }
    }

    function clearMusicalGridPositionCache() {
        musicalGridPosCache = null;
    }

    function clampMusicalGridSec(sec, maxSec) {
        const s = Number(sec);
        if (!Number.isFinite(s)) return 0;
        if (!(maxSec > 0)) return Math.max(0, s);
        return Math.max(0, Math.min(maxSec, s));
    }

    function getMusicalGridBarBySec(meterSpec, sec, maxSec) {
        const t = clampMusicalGridSec(sec, maxSec);
        const meterKey = musicalGridMeterText || '';
        if (!musicalGridPosCache || musicalGridPosCache.meterKey !== meterKey) {
            musicalGridPosCache = {
                meterKey,
                barIndex: 0,
                barStartSec: 0,
                barEndSec: 0,
                entry: null,
            };
        }
        let barIndex = musicalGridPosCache.barIndex | 0;
        let barStartSec = Number.isFinite(musicalGridPosCache.barStartSec)
            ? musicalGridPosCache.barStartSec
            : 0;
        let barEndSec = Number.isFinite(musicalGridPosCache.barEndSec)
            ? musicalGridPosCache.barEndSec
            : 0;
        let entry = musicalGridPosCache.entry;

        if (!entry || !(barEndSec > barStartSec + 1e-9) || t < barStartSec - 1e-9) {
            barIndex = 0;
            barStartSec = 0;
            entry = null;
            barEndSec = 0;
        }
        if (!entry) {
            entry = getMeterEntryForBar(meterSpec, barIndex);
            if (!entry) return null;
            const barDur0 = entry.sig.num * beatDurationSec(entry.sig, entry.bpm);
            barEndSec = barStartSec + barDur0;
        }
        const maxBars = 48000;
        let guard = 0;
        while (t >= barEndSec - 1e-9 && guard < maxBars) {
            barStartSec = barEndSec;
            barIndex += 1;
            entry = getMeterEntryForBar(meterSpec, barIndex);
            if (!entry) break;
            const barDur = entry.sig.num * beatDurationSec(entry.sig, entry.bpm);
            barEndSec = barStartSec + barDur;
            guard += 1;
            if (barStartSec >= maxSec - 1e-9) break;
        }
        if (!entry) return null;
        musicalGridPosCache = {
            meterKey,
            barIndex,
            barStartSec,
            barEndSec,
            entry,
        };
        return {
            barIndex,
            barStartSec,
            barEndSec,
            entry,
            sec: t,
        };
    }

    function formatMusicalGridPlayheadPosition(pos) {
        if (!pos) return '---:--:--';
        const sig = pos.entry.sig;
        const beatDur = beatDurationSec(sig, pos.entry.bpm);
        let beatInBar = Math.floor((pos.sec - pos.barStartSec) / beatDur);
        if (!Number.isFinite(beatInBar)) beatInBar = 0;
        beatInBar = Math.max(0, Math.min(sig.num - 1, beatInBar));
        const beatStartSec = pos.barStartSec + beatInBar * beatDur;
        const quarterDur = beatDur / 4;
        let quarterInBeat = Math.floor((pos.sec - beatStartSec) / quarterDur);
        if (!Number.isFinite(quarterInBeat)) quarterInBeat = 0;
        quarterInBeat = Math.max(0, Math.min(3, quarterInBeat));
        const barText = String(pos.barIndex + 1).padStart(3, '0');
        const beatText = String(beatInBar + 1).padStart(2, '0');
        const quarterText = String(quarterInBeat + 1).padStart(2, '0');
        return barText + ':' + beatText + ':' + quarterText;
    }

    function resolveMusicalGridPlayheadPositionText(sec) {
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return '---:--:--';
        const maxSec =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(maxSec > 0)) return '---:--:--';
        const pos = getMusicalGridBarBySec(settings.meterSpec, sec, maxSec);
        return formatMusicalGridPlayheadPosition(pos);
    }

    function musicalGridDrawSettings() {
        readMusicalGridFromInputs();
        if (!musicalGridMeterText) return null;
        const meterSpec = parseMeterSpec(musicalGridMeterText);
        if (!meterSpec) return null;
        const phraseSpec = parsePhraseGroupingSpec(musicalGridPhraseText);
        return { meterSpec, phraseSpec };
    }

    function musicalGridPersistSnapshot() {
        readMusicalGridFromInputs();
        return {
            meter: musicalGridMeterText,
            phrase: musicalGridPhraseText,
        };
    }

    function getMusicalGridVisible() {
        return musicalGridVisible !== false;
    }

    function syncMusicalGridVisibilityUi() {
        if (musicalGridVisibleCheckbox) {
            musicalGridVisibleCheckbox.checked = getMusicalGridVisible();
        }
        if (musicalGridPhraseFillCheckbox) {
            musicalGridPhraseFillCheckbox.checked = getMusicalGridPhraseFillVisible();
        }
    }

    function setMusicalGridVisible(visible, opt) {
        musicalGridVisible = visible !== false;
        const o = opt && typeof opt === 'object' ? opt : {};
        syncMusicalGridVisibilityUi();
        if (typeof drawMusicalGridOverlay === 'function') drawMusicalGridOverlay();
        if (o.persist !== false) {
            if (typeof writePrefs === 'function') writePrefs();
        }
        if (!o.silent) {
            if (typeof writeLog === 'function') {
                writeLog('Musical Grid: ' + (musicalGridVisible ? 'ON' : 'OFF'));
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Tempo/Sig', musicalGridVisible ? 'ON' : 'OFF', 'notice');
            }
        }
    }

    function toggleMusicalGridVisible() {
        setMusicalGridVisible(!getMusicalGridVisible());
        return true;
    }

    function getMusicalGridPhraseFillVisible() {
        return musicalGridPhraseFillVisible !== false;
    }

    function setMusicalGridPhraseFillVisible(visible, opt) {
        musicalGridPhraseFillVisible = visible !== false;
        const o = opt && typeof opt === 'object' ? opt : {};
        syncMusicalGridVisibilityUi();
        if (!musicalGridPhraseFillVisible) endPhraseBoundaryDrag();
        if (typeof drawMusicalGridOverlay === 'function') drawMusicalGridOverlay();
        else updatePhraseBoundaryOverlay();
        if (typeof refreshAllRegionBoundaryPresentation === 'function') {
            refreshAllRegionBoundaryPresentation();
        }
        if (o.persist !== false) {
            if (typeof writePrefs === 'function') writePrefs();
        }
        if (!o.silent) {
            if (typeof writeLog === 'function') {
                writeLog('Phrase tint: ' + (musicalGridPhraseFillVisible ? 'ON' : 'OFF'));
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Phrase', musicalGridPhraseFillVisible ? 'ON' : 'OFF', 'notice');
            }
        }
    }

    function toggleMusicalGridPhraseFillVisible() {
        setMusicalGridPhraseFillVisible(!getMusicalGridPhraseFillVisible());
        return true;
    }

    function applyMusicalGridPersistSnapshot(snap) {
        const s = snap && typeof snap === 'object' ? snap : {};
        musicalGridMeterText = meterTextFromPersistSnapshot(s);
        const phraseRaw =
            s.phrase != null ? s.phrase : s.bars != null ? s.bars : '';
        musicalGridPhraseText = normalizeMusicalGridPhraseText(phraseRaw);
        clearMusicalGridPositionCache();
        if (musicalGridMeterInput) musicalGridMeterInput.value = musicalGridMeterText;
        if (musicalGridPhraseInput) musicalGridPhraseInput.value = musicalGridPhraseText;
        clearPhraseUndoStack();
        scheduleMusicalGridRedraw();
    }

    function resetMusicalGridToDefaults(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        applyMusicalGridPersistSnapshot({
            meter: MUSICAL_GRID_DEFAULT_METER_TEXT,
            phrase: MUSICAL_GRID_DEFAULT_PHRASE_TEXT,
        });
        setMusicalGridVisible(false, { silent: !!o.silent, persist: false });
        setMusicalGridPhraseFillVisible(false, { silent: !!o.silent, persist: false });
        if (o.persist !== false) {
            if (typeof writePrefs === 'function') writePrefs();
        }
    }

    function persistMusicalGridToStorage() {
        if (typeof writePrefs === 'function') writePrefs();
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
    }

    function persistMusicalGridAndRedraw() {
        readMusicalGridFromInputs();
        // 空欄や不正フォーマットは既定値へフォールバックして保存・復元を安定させる。
        if (!musicalGridMeterText || !parseMeterSpec(musicalGridMeterText)) {
            musicalGridMeterText = MUSICAL_GRID_DEFAULT_METER_TEXT;
            if (musicalGridMeterInput) musicalGridMeterInput.value = musicalGridMeterText;
        }
        if (!musicalGridPhraseText || !parsePhraseGroupingSpec(musicalGridPhraseText)) {
            musicalGridPhraseText = MUSICAL_GRID_DEFAULT_PHRASE_TEXT;
            if (musicalGridPhraseInput) musicalGridPhraseInput.value = musicalGridPhraseText;
        }
        clearMusicalGridPositionCache();
        persistMusicalGridToStorage();
        scheduleMusicalGridRedraw();
    }

    /** comma 区切りリストでキャレットが属する要素インデックス（0 始まり）。alternate の () はラップのみ扱う。 */
    function commaListEntryIndexAtCaret(raw, caret) {
        const s = String(raw == null ? '' : raw).trim();
        const c = Math.max(0, Math.min(s.length, caret | 0));
        let inner = s;
        let lead = 0;
        const alt = /^\((.*)\)$/.exec(s);
        if (alt) {
            const open = s.indexOf('(');
            const close = s.lastIndexOf(')');
            lead = open + 1;
            inner = alt[1];
            if (c <= open) return 0;
            if (c > close) {
                let index = 0;
                for (let i = 0; i < inner.length; i++) {
                    if (inner[i] === ',') index++;
                }
                return index;
            }
            caret = c - lead;
        } else {
            caret = c;
        }
        const pos = Math.max(0, Math.min(inner.length, caret));
        let index = 0;
        for (let i = 0; i < pos; i++) {
            if (inner[i] === ',') index++;
        }
        return index;
    }

    function commaListCaretPosForEntry(raw, entryIndex) {
        const s = String(raw == null ? '' : raw).trim();
        let inner = s;
        let lead = 0;
        const alt = /^\((.*)\)$/.exec(s);
        if (alt) {
            lead = s.indexOf('(') + 1;
            inner = alt[1];
        }
        let idx = Math.max(0, entryIndex | 0);
        let pos = 0;
        while (idx > 0) {
            const comma = inner.indexOf(',', pos);
            if (comma < 0) break;
            pos = comma + 1;
            idx--;
        }
        return lead + pos;
    }

    /** @returns {{ start: number, end: number, text: string }} */
    function commaListEntrySpan(raw, entryIndex) {
        const s = String(raw == null ? '' : raw).trim();
        let inner = s;
        let lead = 0;
        const alt = /^\((.*)\)$/.exec(s);
        if (alt) {
            lead = s.indexOf('(') + 1;
            inner = alt[1];
        }
        let idx = Math.max(0, entryIndex | 0);
        let start = 0;
        let i = 0;
        while (i < idx) {
            const comma = inner.indexOf(',', start);
            if (comma < 0) break;
            start = comma + 1;
            i++;
        }
        let end = inner.length;
        const comma = inner.indexOf(',', start);
        if (comma >= 0) end = comma;
        return { start: lead + start, end: lead + end, text: inner.slice(start, end) };
    }

    /** @returns {'bpm'|'num'|'den'} */
    function meterFieldAtCaretInEntry(entryText, caretInEntry) {
        const entry = String(entryText == null ? '' : entryText);
        const dash = entry.indexOf('-');
        const slash = entry.indexOf('/');
        const pos = Math.max(0, Math.min(entry.length, caretInEntry | 0));
        if (dash < 0 || slash < 0 || slash <= dash) return 'bpm';
        if (pos <= dash) return 'bpm';
        if (pos < slash) return 'num';
        return 'den';
    }

    function caretPosForMeterField(raw, entryIndex, field) {
        const span = commaListEntrySpan(raw, entryIndex);
        const entry = span.text;
        const dash = entry.indexOf('-');
        const slash = entry.indexOf('/');
        if (field === 'num' && dash >= 0) return span.start + dash + 1;
        if (field === 'den' && slash >= 0) return span.start + slash + 1;
        if (field === 'bpm' && dash >= 0) return span.start + Math.max(0, dash - 1);
        return span.start;
    }

    function setMusicalGridInputValuePreserveEntryCaret(input, text, entryIndex) {
        if (!input) return;
        input.value = text;
        const pos = commaListCaretPosForEntry(text, entryIndex);
        if (typeof input.setSelectionRange === 'function') {
            input.setSelectionRange(pos, pos);
        }
    }

    function setMeterInputValuePreserveFieldCaret(input, text, entryIndex, field) {
        if (!input) return;
        input.value = text;
        const pos = caretPosForMeterField(text, entryIndex, field);
        if (typeof input.setSelectionRange === 'function') {
            input.setSelectionRange(pos, pos);
        }
    }

    function clampMeterSigPart(n) {
        return Math.max(1, Math.min(32, n | 0));
    }

    function bumpMeterFieldBy(delta, sigDelta) {
        const input = musicalGridMeterInput;
        const raw = input ? input.value : musicalGridMeterText;
        const caret = input ? input.selectionStart : 0;
        const entryIndex = commaListEntryIndexAtCaret(raw, caret);
        const span = commaListEntrySpan(raw, entryIndex);
        const field = meterFieldAtCaretInEntry(span.text, caret - span.start);
        const step = field === 'bpm' ? delta : sigDelta;
        readMusicalGridFromInputs();
        clearMusicalGridPositionCache();
        let spec = parseMeterSpec(musicalGridMeterText);
        let nextText;
        if (!spec) {
            const token = parseMeterToken(span.text);
            if (token) {
                if (field === 'bpm') {
                    token.bpm = Math.max(1, Math.min(999, token.bpm + step));
                } else if (field === 'num') {
                    token.sig.num = clampMeterSigPart(token.sig.num + step);
                } else {
                    token.sig.den = clampMeterSigPart(token.sig.den + step);
                }
                nextText =
                    formatBpmForMeter(token.bpm) + '-' + token.sig.num + '/' + token.sig.den;
            } else if (field === 'bpm') {
                const cur = parseMusicalGridTempoBpm(musicalGridMeterText);
                const next = Math.max(1, Math.min(999, (cur != null ? cur : 120) + step));
                nextText = formatBpmForMeter(next) + '-4/4';
            } else {
                const cur = parseMusicalGridTempoBpm(musicalGridMeterText);
                const bpm = cur != null ? cur : 120;
                let num = 4;
                let den = 4;
                if (field === 'num') num = clampMeterSigPart(num + step);
                else den = clampMeterSigPart(den + step);
                nextText = formatBpmForMeter(bpm) + '-' + num + '/' + den;
            }
        } else {
            const idx = Math.min(Math.max(0, entryIndex), spec.entries.length - 1);
            const entry = spec.entries[idx];
            if (field === 'bpm') {
                entry.bpm = Math.max(1, Math.min(999, entry.bpm + step));
            } else if (field === 'num') {
                entry.sig.num = clampMeterSigPart(entry.sig.num + step);
            } else {
                entry.sig.den = clampMeterSigPart(entry.sig.den + step);
            }
            nextText = formatMeterSpec(spec);
        }
        musicalGridMeterText = nextText;
        setMeterInputValuePreserveFieldCaret(input, nextText, entryIndex, field);
        scheduleMusicalGridRedraw();
        scheduleMusicalGridAutosave();
    }

    function bumpPhraseSizeBy(delta) {
        const input = musicalGridPhraseInput;
        const raw = input ? input.value : musicalGridPhraseText;
        const caret = input ? input.selectionStart : 0;
        const entryIndex = commaListEntryIndexAtCaret(raw, caret);
        requestPhraseUndoCapture();
        phraseInputFocusSnapshot = null;
        readMusicalGridFromInputs();
        clearMusicalGridPositionCache();
        let spec = parsePhraseGroupingSpec(musicalGridPhraseText);
        let nextText;
        if (!spec) {
            const cur = parseInt(normalizeMusicalGridPhraseText(musicalGridPhraseText), 10);
            const base = Number.isFinite(cur) && cur > 0 ? cur : 8;
            const next = Math.max(1, Math.min(999, base + delta));
            nextText = String(next);
        } else {
            const idx = Math.min(Math.max(0, entryIndex), spec.sizes.length - 1);
            spec.sizes[idx] = Math.max(1, Math.min(999, spec.sizes[idx] + delta));
            nextText = spec.sizes.join(',');
        }
        musicalGridPhraseText = normalizeMusicalGridPhraseText(nextText);
        setMusicalGridInputValuePreserveEntryCaret(input, musicalGridPhraseText, entryIndex);
        scheduleMusicalGridRedraw();
        scheduleMusicalGridAutosave();
    }

    let musicalGridRedrawRaf = 0;
    let musicalGridAutosaveTimer = 0;

    function scheduleMusicalGridAutosave() {
        if (musicalGridAutosaveTimer) {
            clearTimeout(musicalGridAutosaveTimer);
        }
        musicalGridAutosaveTimer = setTimeout(() => {
            musicalGridAutosaveTimer = 0;
            readMusicalGridFromInputs();
            clearMusicalGridPositionCache();
            persistMusicalGridToStorage();
        }, 400);
    }

    function scheduleMusicalGridRedraw() {
        if (musicalGridRedrawRaf) return;
        musicalGridRedrawRaf = requestAnimationFrame(() => {
            musicalGridRedrawRaf = 0;
            drawMusicalGridOverlay();
        });
    }

    function ensureMusicalGridCanvasSized() {
        if (!musicalGridCanvas) return null;
        const lanes =
            typeof audioWaveformLanesTracks !== 'undefined' && audioWaveformLanesTracks
                ? audioWaveformLanesTracks
                : typeof waveformScrubTargetEl === 'function'
                  ? waveformScrubTargetEl()
                  : null;
        const inner =
            typeof audioWaveformLanesInner !== 'undefined' && audioWaveformLanesInner
                ? audioWaveformLanesInner
                : typeof waveformTimelineInnerEl === 'function'
                  ? waveformTimelineInnerEl()
                  : musicalGridCanvas.parentElement;
        if (!lanes || !inner) return null;
        const w = Math.max(1, inner.clientWidth | 0);
        const h = Math.max(1, lanes.clientHeight | 0);
        if (w < 1 || h < 1) return null;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const bw = Math.round(w * dpr);
        const bh = Math.round(h * dpr);
        if (musicalGridCanvas.width !== bw || musicalGridCanvas.height !== bh) {
            musicalGridCanvas.width = bw;
            musicalGridCanvas.height = bh;
            musicalGridCanvas.style.width = w + 'px';
            musicalGridCanvas.style.height = h + 'px';
        }
        const ctx = musicalGridCanvas.getContext('2d');
        if (!ctx) return null;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { ctx, w, h };
    }

    function phraseGroupLabelForIndex(index) {
        const n = index | 0;
        if (n >= 0 && n <= 9) return String.fromCharCode(0xff10 + n);
        return String(n);
    }

    function phraseGroupLogLabelForIndex(index) {
        return String(index | 0);
    }

    function getPhraseGroupRangesSnapshot() {
        if (!getMusicalGridPhraseFillVisible()) return [];
        const settings = musicalGridDrawSettings();
        if (!settings) return [];
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return [];
        if (
            phraseBoundaryDragActive &&
            phraseBoundaryDragCounts &&
            phraseBoundaryDragCounts.length
        ) {
            return collectPhraseGroupRangesFromBarCounts(
                settings.meterSpec,
                master,
                phraseBoundaryDragCounts,
            );
        }
        if (!settings.phraseSpec) return [];
        return collectPhraseGroupRanges(
            settings.meterSpec,
            master,
            settings.phraseSpec,
        );
    }

    /** Phrase 着色 ON 時、transport 秒が属する Phrase 範囲。該当なしは null。 */
    function resolvePhraseGroupAtTransportSec(sec) {
        if (!getMusicalGridPhraseFillVisible()) return null;
        const s = Number(sec);
        if (!Number.isFinite(s)) return null;
        const ranges = getPhraseGroupRangesSnapshot();
        if (!ranges.length) return null;
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (s >= r.startSec - 1e-9 && s < r.endSec + 1e-9) {
                return {
                    startSec: r.startSec,
                    endSec: r.endSec,
                    paletteIndex: r.paletteIndex,
                    label: phraseGroupLabelForIndex(r.paletteIndex),
                };
            }
        }
        return null;
    }

    function buildPhraseNavStops() {
        const ranges = getPhraseGroupRangesSnapshot();
        if (!ranges.length) return [];
        return ranges.map((r) => ({
            sec: r.startSec,
            label: phraseGroupLabelForIndex(r.paletteIndex),
            paletteIndex: r.paletteIndex,
        }));
    }

    function phraseNavStopEpsilonSec() {
        if (typeof regionNavStopEpsilonSec === 'function') {
            return regionNavStopEpsilonSec();
        }
        if (typeof markerNavStopEpsilonSec === 'function') {
            return markerNavStopEpsilonSec();
        }
        return 0.05;
    }

    function phraseNavStopIndexForCurrent(stops, dir) {
        if (!stops || !stops.length) return -1;
        const t =
            typeof getTransportSec === 'function'
                ? getTransportSec()
                : typeof videoMain !== 'undefined' && videoMain
                  ? videoMain.currentTime || 0
                  : 0;
        const eps = phraseNavStopEpsilonSec();
        if (dir < 0) {
            for (let i = 0; i < stops.length; i++) {
                if (stops[i].sec > t - eps) return i;
            }
            let best = -1;
            for (let i = 0; i < stops.length; i++) {
                if (stops[i].sec <= t + eps) best = i;
                else break;
            }
            return best;
        }
        let best = -1;
        for (let i = 0; i < stops.length; i++) {
            if (stops[i].sec <= t + eps) best = i;
            else break;
        }
        return best;
    }

    function seekToPhraseNavStop(stop, opt) {
        if (!stop || !Number.isFinite(stop.sec)) return false;
        const resumeAfter = !!(opt && opt.resumeAfterSeek);
        let target = stop.sec;
        if (typeof clampTransportSec === 'function') {
            target = clampTransportSec(target);
        }
        if (typeof suppressRangeLoopSnapForExplicitSeek === 'function') {
            suppressRangeLoopSnapForExplicitSeek();
        }
        if (typeof applyTransportAtSec === 'function') {
            applyTransportAtSec(target, { resumeAfter: resumeAfter });
        } else if (typeof applyTimeToVideo === 'function') {
            applyTimeToVideo(target);
        }
        if (typeof setTransportSec === 'function') {
            setTransportSec(target);
        }
        if (typeof updateAllWaveformPlayheads === 'function') {
            updateAllWaveformPlayheads();
        }
        const hintTc =
            typeof formatTimecodeForTransport === 'function'
                ? formatTimecodeForTransport(target)
                : String(target);
        const hintTitle = 'Phrase ' + stop.label;
        if (typeof writeLog === 'function') {
            writeLog('Phrase: seek to ' + hintTitle + ' @ ' + hintTc);
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(hintTitle, hintTc);
        }
        return true;
    }

    /** ↑=次のフレーズ、↓=前のフレーズ（各フレーズ先頭へ）。 */
    function jumpToAdjacentPhrase(dir, opt) {
        if (!getMusicalGridPhraseFillVisible()) return false;
        const stops = buildPhraseNavStops();
        const n = stops.length;
        if (n === 0) return false;
        const idx = phraseNavStopIndexForCurrent(stops, dir);
        const t =
            typeof getTransportSec === 'function'
                ? getTransportSec()
                : typeof videoMain !== 'undefined' && videoMain
                  ? videoMain.currentTime || 0
                  : 0;
        const eps = phraseNavStopEpsilonSec();
        let next;
        if (idx < 0) {
            if (dir <= 0) return false;
            next = 0;
        } else if (dir < 0 && t > stops[idx].sec + eps) {
            next = idx;
        } else if (dir > 0 && t < stops[idx].sec - eps) {
            next = idx;
        } else {
            next = idx + dir;
            if (next < 0 || next >= n) return false;
        }
        return seekToPhraseNavStop(stops[next], opt);
    }

    /** Phrase 着色 ON 時、テンキー digit に対応するシーク位置（秒）。該当なしは null。 */
    function resolveMusicalGridNumpadSeekSec(digit) {
        if (!getMusicalGridPhraseFillVisible()) return null;
        const d = digit | 0;
        if (!(d >= 0 && d <= 9)) return null;
        const ranges = getPhraseGroupRangesSnapshot();
        if (!ranges.length) return null;
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (r.paletteIndex === d) {
                return Math.max(0, r.startSec);
            }
        }
        return null;
    }

    function collectPhraseGroupDrawRanges(settings, master) {
        if (!getMusicalGridPhraseFillVisible()) return [];
        if (
            phraseBoundaryDragActive &&
            phraseBoundaryDragCounts &&
            phraseBoundaryDragCounts.length
        ) {
            return collectPhraseGroupRangesFromBarCounts(
                settings.meterSpec,
                master,
                phraseBoundaryDragCounts,
            );
        }
        if (!settings.phraseSpec) return [];
        return collectPhraseGroupRanges(settings.meterSpec, master, settings.phraseSpec);
    }

    function drawPhraseGroupFills(ctx, w, h, master, settings) {
        const ranges = collectPhraseGroupDrawRanges(settings, master);
        if (!ranges.length) return;
        const secToX = (sec) => (sec / master) * w;
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            const x0 = secToX(r.startSec);
            const x1 = secToX(r.endSec);
            if (x1 <= x0 + 0.25) continue;
            ctx.fillStyle = r.paletteIndex % 2 === 0 ? BAR_GROUP_FILL_A : BAR_GROUP_FILL_B;
            ctx.fillRect(x0, 0, x1 - x0, h);
        }
    }

    function drawPhraseGroupLabels(ctx, w, h, master, settings) {
        const ranges = collectPhraseGroupDrawRanges(settings, master);
        if (!ranges.length) return;
        const secToX = (sec) => (sec / master) * w;
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            const x0 = secToX(r.startSec);
            const x1 = secToX(r.endSec);
            if (x1 <= x0 + 0.25) continue;

            const bandW = x1 - x0;
            const cx = x0 + bandW * 0.5;
            const cy = h * 0.42;
            const baseFontPx = Math.max(12, Math.min(h * 0.34, 24));
            const fontPx = Math.min(baseFontPx, Math.max(12, bandW * 0.5));
            const label = phraseGroupLabelForIndex(r.paletteIndex);
            ctx.save();
            ctx.font = '700 ' + fontPx + 'px system-ui, "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
            ctx.lineWidth = Math.max(2, fontPx * 0.08);
            ctx.lineJoin = 'round';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
            ctx.strokeText(label, cx, cy);
            ctx.fillText(label, cx, cy);
            ctx.restore();
        }
    }

    function drawMusicalGridOverlay() {
        const sized = ensureMusicalGridCanvasSized();
        if (!sized || !musicalGridCanvas) {
            if (musicalGridCanvas) {
                const ctx = musicalGridCanvas.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, musicalGridCanvas.width, musicalGridCanvas.height);
            }
            return;
        }
        const { ctx, w, h } = sized;
        ctx.clearRect(0, 0, w, h);

        const settings = musicalGridDrawSettings();
        if (!settings) return;

        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return;

        drawPhraseGroupFills(ctx, w, h, master, settings);

        if (getMusicalGridVisible()) {
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';

            const zoom =
                typeof getWaveformTimelineZoom === 'function' ? getWaveformTimelineZoom() : 1;
            const showBeats = zoom >= 10;

            const lines = collectMusicalGridLines(settings.meterSpec, master, {
                showBeats,
            });
            const secToX = (sec) => (sec / master) * w;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const x = secToX(line.sec);
                if (x < -0.5 || x > w + 0.5) continue;
                const xi = Math.round(x) + 0.5;
                if (line.kind === 'bar') {
                    ctx.strokeStyle = 'rgba(255, 90, 90, 0.75)';
                    ctx.lineWidth = 1;
                } else {
                    ctx.strokeStyle = 'rgba(0, 220, 255, 0.45)';
                    ctx.lineWidth = 1;
                }
                ctx.beginPath();
                ctx.moveTo(xi, 0);
                ctx.lineTo(xi, h);
                ctx.stroke();
            }
            ctx.restore();
        }

        drawPhraseGroupLabels(ctx, w, h, master, settings);
        if (!phraseBoundaryDragActive) updatePhraseBoundaryOverlay();
    }

    /** @returns {number[]} 各小節の開始秒。末尾に durationSec。 */
    function collectBarBoundarySecs(meterSpec, durationSec) {
        const boundaries = [];
        if (!(durationSec > 0) || !meterSpec) return boundaries;
        let t = 0;
        let barIndex = 0;
        while (t < durationSec - 1e-9) {
            boundaries.push(t);
            const entry = getMeterEntryForBar(meterSpec, barIndex);
            if (!entry) break;
            const sig = entry.sig;
            const barDur = sig.num * beatDurationSec(sig, entry.bpm);
            t = Math.min(durationSec, t + barDur);
            barIndex += 1;
        }
        if (!boundaries.length || boundaries[boundaries.length - 1] < durationSec - 1e-9) {
            boundaries.push(durationSec);
        }
        return boundaries;
    }

    /** phraseSpec から各 Phrase グループの小節数列を展開する。 */
    function expandPhraseSpecToGroupBarCounts(meterSpec, durationSec, phraseSpec) {
        const boundaries = collectBarBoundarySecs(meterSpec, durationSec);
        const totalBars = Math.max(0, boundaries.length - 1);
        if (!totalBars || !phraseSpec || !phraseSpec.sizes) return [];
        const counts = [];
        let groupIndex = 0;
        let barsInGroup = 0;
        for (let bar = 0; bar < totalBars; bar++) {
            if (barsInGroup === 0) counts.push(0);
            counts[counts.length - 1] += 1;
            barsInGroup += 1;
            const groupSize = barGroupSizeForIndex(groupIndex, phraseSpec.sizes);
            if (barsInGroup >= groupSize) {
                groupIndex += 1;
                barsInGroup = 0;
            }
        }
        return counts;
    }

    function groupBarCountsMatchPhraseSizes(counts, sizes) {
        if (!counts || !counts.length || !sizes || !sizes.length) return false;
        for (let i = 0; i < counts.length; i++) {
            if (barGroupSizeForIndex(i, sizes) !== counts[i]) return false;
        }
        return true;
    }

    /** barGroupSizeForIndex の逆算: 指定長の Phrase 候補を counts から構成する。 */
    function candidatePhraseSizesForLength(counts, len) {
        if (!counts || !counts.length || len < 1 || len > counts.length) return null;
        if (len === 1) {
            if (counts.every((c) => c === counts[0])) return [counts[0]];
            return null;
        }
        if (len === 2) {
            const tailVal = counts[1];
            if (counts.slice(1).every((c) => c === tailVal)) return [counts[0], tailVal];
            return null;
        }
        const sizes = counts.slice(0, len - 1);
        const tailVal = counts[len - 1];
        for (let i = len - 1; i < counts.length; i++) {
            if (counts[i] !== tailVal) return null;
        }
        sizes.push(tailVal);
        return sizes;
    }

    /** 展開済みグループ小節数列から、同等の Phrase 指定を最短表現へ圧縮する。 */
    function inferMinimalPhraseSizesFromGroupBarCounts(counts) {
        if (!counts || !counts.length) return [];
        for (let len = 1; len <= counts.length; len++) {
            const candidate = candidatePhraseSizesForLength(counts, len);
            if (candidate && groupBarCountsMatchPhraseSizes(counts, candidate)) {
                return candidate;
            }
        }
        return counts.slice();
    }

    function formatPhraseTextFromGroupBarCounts(counts, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!counts || !counts.length) return '';
        const sizes =
            o.optimize === false ? counts.slice() : inferMinimalPhraseSizesFromGroupBarCounts(counts);
        if (!sizes.length) return '';
        return sizes.join(',');
    }

    function phraseGroupCountsEqual(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if ((a[i] | 0) !== (b[i] | 0)) return false;
        }
        return true;
    }

    function sumGroupBarCounts(counts, endExclusive) {
        let sum = 0;
        const end = Math.min(endExclusive | 0, counts.length);
        for (let i = 0; i < end; i++) sum += counts[i];
        return sum;
    }

    function countsForPhraseBoundaryAtBarIndex(startCounts, boundaryIndex, targetBarK) {
        const b = boundaryIndex | 0;
        if (!startCounts || b < 0 || b >= startCounts.length - 1) {
            return startCounts ? startCounts.slice() : [];
        }
        const sumBefore = sumGroupBarCounts(startCounts, b);
        const left0 = startCounts[b];
        const right0 = startCounts[b + 1];
        const pairEnd = sumBefore + left0 + right0;
        const minK = sumBefore;
        const maxK = pairEnd;
        const k = Math.max(minK, Math.min(maxK, targetBarK | 0));

        if (k <= sumBefore) {
            const newCounts = startCounts.slice(0, b);
            newCounts.push(left0 + right0);
            for (let i = b + 2; i < startCounts.length; i++) {
                newCounts.push(startCounts[i]);
            }
            return newCounts;
        }

        const barsForLeft = k - sumBefore;
        const barsForRight = pairEnd - k;

        if (barsForRight <= 0) {
            const merged = startCounts.slice(0, b);
            merged.push(left0 + right0);
            for (let i = b + 2; i < startCounts.length; i++) {
                merged.push(startCounts[i]);
            }
            return merged;
        }

        const newCounts = startCounts.slice(0, b);
        newCounts.push(barsForLeft);
        newCounts.push(barsForRight);
        for (let i = b + 2; i < startCounts.length; i++) {
            newCounts.push(startCounts[i]);
        }
        return newCounts;
    }

    function targetBarKForPhraseBoundaryDrag(
        startBarK,
        startClientX,
        clientX,
        barBoundaries,
        minK,
        maxK,
    ) {
        const sk = startBarK | 0;
        const lo = minK | 0;
        const hi = maxK | 0;
        if (!barBoundaries || !barBoundaries.length) return sk;
        const startSec = barBoundaries[sk];
        if (!Number.isFinite(startSec)) return Math.max(lo, Math.min(hi, sk));

        let deltaSec = 0;
        if (typeof timelineSecDeltaFromClientXDelta === 'function') {
            deltaSec = timelineSecDeltaFromClientXDelta(clientX, startClientX);
        } else if (typeof transportSecFromClientX === 'function') {
            const curSec = transportSecFromClientX(clientX);
            const startTransportSec = transportSecFromClientX(startClientX);
            if (Number.isFinite(curSec) && Number.isFinite(startTransportSec)) {
                deltaSec = curSec - startTransportSec;
            }
        }
        let targetSec = startSec + deltaSec;
        const minSec = barBoundaries[lo];
        const maxSec = barBoundaries[hi];
        if (Number.isFinite(minSec)) targetSec = Math.max(minSec, targetSec);
        if (Number.isFinite(maxSec)) targetSec = Math.min(maxSec, targetSec);

        if (getMusicalGridVisible()) {
            let bestSec = targetSec;
            let bestDist = Infinity;
            for (let bar = lo; bar <= hi; bar++) {
                const sec = barBoundaries[bar];
                if (!Number.isFinite(sec)) continue;
                const d = Math.abs(sec - targetSec);
                if (d < bestDist) {
                    bestDist = d;
                    bestSec = sec;
                }
            }
            targetSec = bestSec;
        }

        const bar = barIndexForBoundarySec(targetSec, barBoundaries);
        return Math.max(lo, Math.min(hi, bar));
    }

    function applyPhraseBoundaryDragPreview(counts) {
        const prevLen = phraseBoundaryDragCounts ? phraseBoundaryDragCounts.length : 0;
        phraseBoundaryDragCounts = counts.slice();
        drawMusicalGridOverlay();
        if (prevLen !== counts.length) {
            updatePhraseBoundaryOverlay();
        } else {
            repositionPhraseBoundaryHandlesFromSnapshot();
        }
    }

    function applyExplicitPhraseGroupBarCounts(counts, opt) {
        if (!counts || !counts.length) return;
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!o.skipUndo) requestPhraseUndoCapture();
        const text = formatPhraseTextFromGroupBarCounts(counts);
        musicalGridPhraseText = normalizeMusicalGridPhraseText(text);
        if (musicalGridPhraseInput) {
            musicalGridPhraseInput.value = musicalGridPhraseText;
        }
        clearMusicalGridPositionCache();
    }

    /** 小節 index k（その小節の開始＝小節線）で Phrase グループを 2 分割。境界上は null。 */
    function splitPhraseGroupAtBarIndex(counts, barIndex) {
        const k = barIndex | 0;
        if (!counts || !counts.length || k <= 0) return null;
        let sum = 0;
        for (let g = 0; g < counts.length; g++) {
            const groupBars = counts[g] | 0;
            const groupStart = sum;
            const groupEnd = sum + groupBars;
            if (k > groupStart && k < groupEnd) {
                const leftBars = k - groupStart;
                const rightBars = groupEnd - k;
                if (leftBars < 1 || rightBars < 1) return null;
                const next = counts.slice(0, g);
                next.push(leftBars, rightBars);
                for (let i = g + 1; i < counts.length; i++) {
                    next.push(counts[i]);
                }
                return next;
            }
            sum = groupEnd;
        }
        return null;
    }

    function musicalGridBarLineSnapThresholdSec() {
        if (typeof regionSnapThresholdSec === 'function') {
            return regionSnapThresholdSec();
        }
        return 0.05;
    }

    /**
     * transport 秒が小節線（各小節の開始）に近いとき、その bar index で Phrase 分割候補を返す。
     * @param {object} [opt]
     * @param {boolean} [opt.nearestBarLine] true なら閾値に関係なく最寄りの小節線（シークバー用）
     * @returns {{ barIndex: number, barSec: number, counts: number[] }|{ barIndex: number, invalid: true }|null}
     */
    function resolveMusicalGridBarLinePhraseSplitAtTransportSec(transportSec, opt) {
        if (!getMusicalGridVisible()) return null;
        const o = opt && typeof opt === 'object' ? opt : {};
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.phraseSpec) return null;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return null;
        const boundaries = collectBarBoundarySecs(settings.meterSpec, master);
        const totalBars = Math.max(0, boundaries.length - 1);
        if (totalBars < 2) return null;
        const s = Number(transportSec);
        if (!Number.isFinite(s)) return null;
        const threshold = musicalGridBarLineSnapThresholdSec();

        let bestK = -1;
        let bestDist = Infinity;
        for (let k = 1; k < totalBars; k++) {
            const lineSec = boundaries[k];
            if (!Number.isFinite(lineSec)) continue;
            const d = Math.abs(s - lineSec);
            if (d < bestDist) {
                bestDist = d;
                bestK = k;
            }
        }
        if (bestK < 1) return null;
        if (!o.nearestBarLine && bestDist > threshold) return null;

        const counts = expandPhraseSpecToGroupBarCounts(
            settings.meterSpec,
            master,
            settings.phraseSpec,
        );
        if (!counts.length) return null;
        const nextCounts = splitPhraseGroupAtBarIndex(counts, bestK);
        if (!nextCounts) {
            return { barIndex: bestK, invalid: true };
        }
        return {
            barIndex: bestK,
            barSec: boundaries[bestK],
            counts: nextCounts,
        };
    }

    function isWaveformPointerInsideLanes() {
        return (
            typeof waveformLanesPointerInside !== 'undefined' && waveformLanesPointerInside === true
        );
    }

    function seekbarTransportSec() {
        if (typeof getTransportSec === 'function') {
            const sec = getTransportSec();
            if (Number.isFinite(sec)) return sec;
        }
        return null;
    }

    /** 波形ポインタ優先。トラック外または座標なしはシークバー位置。 */
    function resolvePhraseEditTransportSec() {
        const pointerOnWaveform = isWaveformPointerInsideLanes();
        let transportSec = pointerOnWaveform ? waveformPointerTransportSec() : null;
        let useSeekbar = !pointerOnWaveform;
        if (transportSec == null) {
            transportSec = seekbarTransportSec();
            useSeekbar = true;
        }
        if (transportSec == null) return null;
        return { transportSec, useSeekbar };
    }

    /** 波形外はシークバー、波形上はポインタ（join 専用。ポインタ X のフォールバックなし）。 */
    function resolvePhraseJoinTargetSec() {
        if (isWaveformPointerInsideLanes()) {
            const transportSec = waveformPointerTransportSec();
            if (transportSec == null) return null;
            return { transportSec, useSeekbar: false };
        }
        const transportSec = seekbarTransportSec();
        if (transportSec == null) return null;
        return { transportSec, useSeekbar: true };
    }

    function snapSecToPhraseBoundaryStops(sec, threshold) {
        const s = Number(sec);
        if (!Number.isFinite(s)) return sec;
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.phraseSpec) return sec;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return sec;
        const counts = expandPhraseSpecToGroupBarCounts(
            settings.meterSpec,
            master,
            settings.phraseSpec,
        );
        if (counts.length < 2) return sec;
        const ranges = collectPhraseGroupRangesFromBarCounts(
            settings.meterSpec,
            master,
            counts,
        );
        if (ranges.length < 2) return sec;

        let bestSec = s;
        let bestDist = Infinity;
        for (let i = 0; i < ranges.length - 1; i++) {
            const stopSec = ranges[i].endSec;
            if (!Number.isFinite(stopSec)) continue;
            const d = Math.abs(stopSec - s);
            if (d < bestDist) {
                bestDist = d;
                bestSec = stopSec;
            }
        }
        if (bestDist <= threshold) return bestSec;
        return sec;
    }

    function waveformPointerTransportSec() {
        let clientX = null;
        if (typeof getWaveformLanesPointerClientX === 'function') {
            clientX = getWaveformLanesPointerClientX();
        }
        if (!Number.isFinite(clientX) && typeof getWaveformPointerClientX === 'function') {
            clientX = getWaveformPointerClientX();
        }
        if (!Number.isFinite(clientX) || typeof transportSecFromClientX !== 'function') {
            return null;
        }
        const sec = transportSecFromClientX(clientX);
        return Number.isFinite(sec) ? sec : null;
    }

    function splitPhraseAtWaveformPointer() {
        if (!getMusicalGridVisible()) return false;
        if (phraseBoundaryDragActive) return false;

        const target = resolvePhraseEditTransportSec();
        if (!target) return false;
        const { transportSec, useSeekbar } = target;

        const hit = resolveMusicalGridBarLinePhraseSplitAtTransportSec(transportSec, {
            nearestBarLine: useSeekbar,
        });
        if (!hit) return false;

        const barLabel = String((hit.barIndex | 0) + 1);
        if (hit.invalid) {
            if (typeof writeLog === 'function') {
                writeLog(
                    'Phrase: already at boundary (bar ' +
                        barLabel +
                        (useSeekbar ? ', seekbar' : '') +
                        ')',
                );
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Phrase', "Can't split here", 'error');
            }
            return true;
        }

        applyExplicitPhraseGroupBarCounts(hit.counts);
        persistMusicalGridAndRedraw({ skipUndo: true });
        if (typeof writeLog === 'function') {
            writeLog(
                'Phrase split at bar ' +
                    barLabel +
                    (useSeekbar ? ' (seekbar)' : '') +
                    ': ' +
                    musicalGridPhraseText,
            );
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(
                'Phrase',
                'Split at bar ' + barLabel + (useSeekbar ? ' (seekbar)' : ''),
                'notice',
            );
        }
        return true;
    }

    function handleMusicalGridPhraseSplitKeydown(e) {
        if (!matchUserShortcut(e, 'regionSplit')) return false;
        if (e.repeat) return false;
        if (!getMusicalGridVisible()) return false;
        splitPhraseAtWaveformPointer();
        e.preventDefault();
        return true;
    }

    function resolvePhraseGroupIndexAtTransportSec(transportSec) {
        if (!getMusicalGridPhraseFillVisible()) return null;
        const ranges = getPhraseGroupRangesSnapshot();
        if (!ranges.length) return null;
        const s = Number(transportSec);
        if (!Number.isFinite(s)) return null;
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (s >= r.startSec - 1e-9 && s < r.endSec + 1e-9) {
                return i;
            }
        }
        return null;
    }

    /** 展開済み Phrase グループ lo / hi の小節数定義を入れ替える（リージョン入れ替え E 用）。 */
    function swapPhraseGroupsAtIndices(lo, hi, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!getMusicalGridPhraseFillVisible()) return false;
        readMusicalGridFromInputs();
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.phraseSpec) return false;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return false;
        const loIdx = lo | 0;
        const hiIdx = hi | 0;
        if (loIdx < 0 || hiIdx < 0 || loIdx === hiIdx) return false;
        const counts = expandPhraseSpecToGroupBarCounts(
            settings.meterSpec,
            master,
            settings.phraseSpec,
        );
        if (!counts.length || loIdx >= counts.length || hiIdx >= counts.length) {
            return false;
        }
        if (!o.skipUndo) requestPhraseUndoCapture();
        const next = counts.slice();
        const tmp = next[loIdx];
        next[loIdx] = next[hiIdx];
        next[hiIdx] = tmp;
        applyExplicitPhraseGroupBarCounts(next, { skipUndo: true });
        persistMusicalGridAndRedraw();
        if (typeof writeLog === 'function') {
            writeLog(
                'Phrase: swapped groups ' +
                    phraseGroupLogLabelForIndex(loIdx) +
                    ' and ' +
                    phraseGroupLogLabelForIndex(hiIdx) +
                    ': ' +
                    musicalGridPhraseText,
            );
        }
        return true;
    }

    /** Phrase グループ g を隣接グループへ吸収して削除。2 グループ未満は null。 */
    function deletePhraseGroupAtIndex(counts, groupIndex) {
        const g = groupIndex | 0;
        if (!counts || counts.length < 2 || g < 0 || g >= counts.length) return null;
        const next = counts.slice();
        if (g > 0) {
            next[g - 1] += next[g];
            next.splice(g, 1);
        } else {
            next[1] += next[0];
            next.splice(0, 1);
        }
        return next;
    }

    function deletePhraseAtWaveformPointer() {
        if (!getMusicalGridVisible()) return false;
        if (phraseBoundaryDragActive) return false;

        const target = resolvePhraseEditTransportSec();
        if (!target) return false;
        const { transportSec, useSeekbar } = target;

        const settings = musicalGridDrawSettings();
        if (!settings || !settings.phraseSpec) return false;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return false;

        const groupIndex = resolvePhraseGroupIndexAtTransportSec(transportSec);
        if (groupIndex == null) return false;

        const counts = expandPhraseSpecToGroupBarCounts(
            settings.meterSpec,
            master,
            settings.phraseSpec,
        );
        if (counts.length < 2) {
            if (typeof writeLog === 'function') {
                writeLog(
                    'Phrase: cannot delete the only phrase' + (useSeekbar ? ' (seekbar)' : ''),
                );
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Phrase', "Can't delete here", 'error');
            }
            return true;
        }

        const nextCounts = deletePhraseGroupAtIndex(counts, groupIndex);
        if (!nextCounts) return false;

        const label = phraseGroupLogLabelForIndex(groupIndex);
        applyExplicitPhraseGroupBarCounts(nextCounts);
        persistMusicalGridAndRedraw({ skipUndo: true });
        if (typeof writeLog === 'function') {
            writeLog(
                'Phrase ' +
                    label +
                    ' deleted' +
                    (useSeekbar ? ' (seekbar)' : '') +
                    ': ' +
                    musicalGridPhraseText,
            );
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(
                'Phrase',
                'Deleted ' + label + (useSeekbar ? ' (seekbar)' : ''),
                'notice',
            );
        }
        return true;
    }

    function handleMusicalGridPhraseDeleteKeydown(e) {
        if (!matchUserShortcut(e, 'regionDelete')) return false;
        if (e.shiftKey) return false;
        if (e.repeat) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        if (!deletePhraseAtWaveformPointer()) return false;
        e.preventDefault();
        return true;
    }

    /** 境界 index b の右隣フレーズを b に連結。 */
    function mergePhraseGroupsAtBoundaryIndex(counts, boundaryIndex) {
        const b = boundaryIndex | 0;
        if (!counts || counts.length < 2 || b < 0 || b >= counts.length - 1) return null;
        const next = counts.slice(0, b);
        next.push(counts[b] + counts[b + 1]);
        for (let i = b + 2; i < counts.length; i++) {
            next.push(counts[i]);
        }
        return next;
    }

    /**
     * transport 秒がフレーズ境界に近いとき、その境界で連結候補を返す。
     * 連結は常にスナップ閾値内の境界のみ。
     */
    function resolvePhraseBoundaryJoinAtTransportSec(transportSec) {
        if (!getMusicalGridVisible()) return null;
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.phraseSpec) return null;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return null;
        const counts = expandPhraseSpecToGroupBarCounts(
            settings.meterSpec,
            master,
            settings.phraseSpec,
        );
        if (counts.length < 2) return null;
        const ranges = collectPhraseGroupRangesFromBarCounts(
            settings.meterSpec,
            master,
            counts,
        );
        if (ranges.length < 2) return null;
        const s = Number(transportSec);
        if (!Number.isFinite(s)) return null;
        const threshold = musicalGridBarLineSnapThresholdSec();

        let bestB = -1;
        let bestDist = Infinity;
        for (let i = 0; i < ranges.length - 1; i++) {
            const sec = ranges[i].endSec;
            if (!Number.isFinite(sec)) continue;
            const d = Math.abs(s - sec);
            if (d < bestDist) {
                bestDist = d;
                bestB = i;
            }
        }
        if (bestB < 0 || bestDist > threshold) return null;

        const nextCounts = mergePhraseGroupsAtBoundaryIndex(counts, bestB);
        if (!nextCounts) return null;
        return {
            boundaryIndex: bestB,
            boundarySec: ranges[bestB].endSec,
            counts: nextCounts,
        };
    }

    function joinPhraseAtTarget() {
        if (!getMusicalGridVisible()) return false;
        if (phraseBoundaryDragActive) return false;

        const target = resolvePhraseJoinTargetSec();
        if (!target) return false;
        let { transportSec, useSeekbar } = target;
        const threshold = musicalGridBarLineSnapThresholdSec();
        if (useSeekbar) {
            transportSec = snapSecToPhraseBoundaryStops(transportSec, threshold);
        }

        const hit = resolvePhraseBoundaryJoinAtTransportSec(transportSec);
        if (!hit) return false;

        const left = phraseGroupLogLabelForIndex(hit.boundaryIndex);
        const right = phraseGroupLogLabelForIndex(hit.boundaryIndex + 1);
        applyExplicitPhraseGroupBarCounts(hit.counts);
        persistMusicalGridAndRedraw({ skipUndo: true });
        if (typeof writeLog === 'function') {
            writeLog(
                'Phrase ' +
                    left +
                    '/' +
                    right +
                    ' joined' +
                    (useSeekbar ? ' (seekbar)' : '') +
                    ': ' +
                    musicalGridPhraseText,
            );
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(
                'Phrase',
                'Joined ' + left + '/' + right + (useSeekbar ? ' (seekbar)' : ''),
                'notice',
            );
        }
        return true;
    }

    function handleMusicalGridPhraseJoinKeydown(e) {
        if (!matchUserShortcut(e, 'regionJoin')) return false;
        if (e.repeat) return false;
        if (!getMusicalGridVisible()) return false;
        joinPhraseAtTarget();
        e.preventDefault();
        return true;
    }

    function wasLeftPhraseAbsorbedIntoRight(startCounts, finalCounts, boundaryIndex) {
        const b = boundaryIndex | 0;
        if (!startCounts || !finalCounts || finalCounts.length !== startCounts.length - 1) {
            return false;
        }
        if (b < 0 || b >= startCounts.length - 1) return false;
        for (let i = 0; i < b; i++) {
            if (finalCounts[i] !== startCounts[i]) return false;
        }
        if (finalCounts[b] !== startCounts[b] + startCounts[b + 1]) return false;
        for (let i = b + 1; i < finalCounts.length; i++) {
            if (finalCounts[i] !== startCounts[i + 1]) return false;
        }
        return true;
    }

    /** 展開済みグループ小節数列から Phrase 着色範囲を求める（境界ドラッグ中のスナップショット用）。 */
    function collectPhraseGroupRangesFromBarCounts(meterSpec, durationSec, counts) {
        const ranges = [];
        if (!(durationSec > 0) || !meterSpec || !counts || !counts.length) return ranges;
        const barBoundaries = collectBarBoundarySecs(meterSpec, durationSec);
        const totalBars = Math.max(0, barBoundaries.length - 1);
        let barIndex = 0;
        for (let gi = 0; gi < counts.length && barIndex < totalBars; gi++) {
            const groupBars = Math.max(0, counts[gi] | 0);
            if (groupBars <= 0) continue;
            const startSec = barBoundaries[barIndex];
            const endBarIndex = Math.min(totalBars, barIndex + groupBars);
            const endSec =
                endBarIndex < totalBars ? barBoundaries[endBarIndex] : durationSec;
            if (endSec > startSec + 1e-9) {
                ranges.push({
                    startSec,
                    endSec,
                    paletteIndex: gi,
                });
            }
            barIndex = endBarIndex;
        }
        if (barIndex < totalBars) {
            const startSec = barBoundaries[barIndex];
            if (durationSec > startSec + 1e-9) {
                ranges.push({
                    startSec,
                    endSec: durationSec,
                    paletteIndex: counts.length,
                });
            }
        }
        return ranges;
    }

    function barIndexForBoundarySec(sec, barBoundaries) {
        const s = Number(sec);
        if (!Number.isFinite(s) || !barBoundaries || !barBoundaries.length) return 0;
        let bar = 0;
        for (let i = 0; i < barBoundaries.length - 1; i++) {
            if (s >= barBoundaries[i] - 1e-9) bar = i;
        }
        return bar;
    }

    function collectMusicalGridBarSnapStops() {
        if (!getMusicalGridVisible()) return [];
        const settings = musicalGridDrawSettings();
        if (!settings) return [];
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return [];
        const zoom = typeof getWaveformTimelineZoom === 'function' ? getWaveformTimelineZoom() : 1;
        const showBeats = zoom >= 10;
        const lines = collectMusicalGridLines(settings.meterSpec, master, { showBeats });
        if (!lines.length) return [];
        const stops = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (
                line &&
                (line.kind === 'bar' || line.kind === 'beat') &&
                Number.isFinite(line.sec)
            ) {
                stops.push(line.sec);
            }
        }
        return stops;
    }

    function collectPhraseGroupSnapStops() {
        if (!getMusicalGridPhraseFillVisible()) return [];
        const ranges = getPhraseGroupRangesSnapshot();
        if (!ranges.length) return [];
        const stops = [];
        for (let i = 0; i < ranges.length; i++) {
            if (Number.isFinite(ranges[i].startSec)) stops.push(ranges[i].startSec);
            if (Number.isFinite(ranges[i].endSec)) stops.push(ranges[i].endSec);
        }
        return stops;
    }

    function collectMusicalGridSnapStops() {
        const stops = collectMusicalGridBarSnapStops().concat(collectPhraseGroupSnapStops());
        if (!stops.length) return stops;
        stops.sort((a, b) => a - b);
        const deduped = [];
        for (let i = 0; i < stops.length; i++) {
            if (!deduped.length || Math.abs(stops[i] - deduped[deduped.length - 1]) > 1e-6) {
                deduped.push(stops[i]);
            }
        }
        return deduped;
    }

    function hasMusicalGridSnapStops() {
        return collectMusicalGridSnapStops().length > 0;
    }

    function musicalGridNavStopEpsilonSec() {
        if (typeof regionNavStopEpsilonSec === 'function') {
            return regionNavStopEpsilonSec();
        }
        if (typeof markerNavStopEpsilonSec === 'function') {
            return markerNavStopEpsilonSec();
        }
        return 0.05;
    }

    function musicalGridNavStopIndexForCurrent(stops) {
        if (!stops || !stops.length) return -1;
        const t =
            typeof getTransportSec === 'function'
                ? getTransportSec()
                : typeof videoMain !== 'undefined' && videoMain
                  ? videoMain.currentTime || 0
                  : 0;
        const eps = musicalGridNavStopEpsilonSec();
        let best = -1;
        for (let i = 0; i < stops.length; i++) {
            if (stops[i] <= t + eps) best = i;
            else break;
        }
        return best;
    }

    function seekToMusicalGridNavStop(stopSec, opt) {
        if (!Number.isFinite(stopSec)) return false;
        const resumeAfter = !!(opt && opt.resumeAfterSeek);
        let target = stopSec;
        if (typeof clampTransportSec === 'function') {
            target = clampTransportSec(target);
        }
        if (typeof suppressRangeLoopSnapForExplicitSeek === 'function') {
            suppressRangeLoopSnapForExplicitSeek();
        }
        if (typeof applyTransportAtSec === 'function') {
            applyTransportAtSec(target, { resumeAfter: resumeAfter });
        } else if (typeof applyTimeToVideo === 'function') {
            applyTimeToVideo(target);
        }
        if (typeof setTransportSec === 'function') {
            setTransportSec(target);
        }
        if (typeof updateAllWaveformPlayheads === 'function') {
            updateAllWaveformPlayheads();
        }
        const hintTc =
            typeof formatTimecodeForTransport === 'function'
                ? formatTimecodeForTransport(target)
                : String(target);
        if (typeof writeLog === 'function') {
            writeLog('Grid: seek to ' + hintTc);
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Grid', hintTc);
        }
        return true;
    }

    function jumpToAdjacentMusicalGridStop(dir, opt) {
        const stops = collectMusicalGridSnapStops();
        const n = stops.length;
        if (!n) return false;
        const idx = musicalGridNavStopIndexForCurrent(stops);
        const t =
            typeof getTransportSec === 'function'
                ? getTransportSec()
                : typeof videoMain !== 'undefined' && videoMain
                  ? videoMain.currentTime || 0
                  : 0;
        const eps = musicalGridNavStopEpsilonSec();
        let next;
        if (idx < 0) {
            if (dir <= 0) return false;
            next = 0;
        } else if (dir < 0 && t > stops[idx] + eps) {
            next = idx;
        } else if (dir > 0 && t < stops[idx] - eps) {
            next = idx;
        } else {
            next = idx + dir;
            if (next < 0 || next >= n) return false;
        }
        return seekToMusicalGridNavStop(stops[next], opt);
    }

    function snapSecToMusicalGridStops(sec, opt) {
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            return Math.max(0, n);
        }
        const stops = collectMusicalGridSnapStops();
        if (!stops.length) return Math.max(0, n);
        const threshold =
            opt && Number.isFinite(opt.thresholdSec) && opt.thresholdSec > 0
                ? opt.thresholdSec
                : typeof regionSnapThresholdSec === 'function'
                  ? regionSnapThresholdSec()
                  : 0.05;
        if (typeof snapToNearestStop === 'function') {
            return Math.max(0, snapToNearestStop(n, stops, threshold, opt));
        }
        return Math.max(0, n);
    }

    function snapBoundaryBarIndexForTransportSec(
        transportSec,
        barBoundaries,
        boundaryIndex,
        counts,
    ) {
        const b = boundaryIndex | 0;
        const sumBefore = sumGroupBarCounts(counts, b);
        if (b < 0 || b >= counts.length - 1) {
            return sumBefore + 1;
        }
        const pairEnd = sumBefore + counts[b] + counts[b + 1];
        const minK = sumBefore;
        const maxK = pairEnd;
        const s = Number(transportSec);
        if (!Number.isFinite(s)) return sumBefore + counts[b];

        let targetSec = s;
        if (getMusicalGridVisible()) {
            let bestSec = null;
            let bestDist = Infinity;
            for (let bar = minK; bar <= maxK; bar++) {
                const sec = barBoundaries[bar];
                if (!Number.isFinite(sec)) continue;
                const d = Math.abs(sec - s);
                if (d < bestDist) {
                    bestDist = d;
                    bestSec = sec;
                }
            }
            if (Number.isFinite(bestSec)) targetSec = bestSec;
        }

        const bar = barIndexForBoundarySec(targetSec, barBoundaries);
        return Math.max(minK, Math.min(maxK, bar));
    }

    function repositionPhraseBoundaryHandlesFromSnapshot() {
        if (!phraseBoundaryRoot || phraseBoundaryRoot.hidden) return;
        const ranges = getPhraseGroupRangesSnapshot();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0) || ranges.length < 2) return;
        const handles = phraseBoundaryRoot.querySelectorAll(
            '.audio-waveform-composite__phrase-boundary-handle',
        );
        for (let i = 0; i < handles.length && i < ranges.length - 1; i++) {
            handles[i].style.left =
                transportSecToOverlayLeftPercent(ranges[i].endSec, master) + '%';
        }
    }

    function applyPhraseGroupBarCounts(counts, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const text = formatPhraseTextFromGroupBarCounts(counts, {
            optimize: o.optimize !== false,
        });
        musicalGridPhraseText = normalizeMusicalGridPhraseText(text);
        if (musicalGridPhraseInput) {
            musicalGridPhraseInput.value = musicalGridPhraseText;
        }
        if (phraseBoundaryDragActive) {
            drawMusicalGridOverlay();
            updatePhraseBoundaryOverlay();
        } else {
            scheduleMusicalGridRedraw();
        }
        if (o.persist !== false) {
            persistMusicalGridToStorage();
        }
    }

    const phraseBoundaryRoot =
        typeof audioWaveformLanesInner !== 'undefined' && audioWaveformLanesInner
            ? (() => {
                  const root = document.createElement('div');
                  root.className = 'audio-waveform-composite__phrase-boundaries';
                  root.hidden = true;
                  root.setAttribute('aria-hidden', 'true');
                  audioWaveformLanesInner.appendChild(root);
                  return root;
              })()
            : null;

    let phraseBoundaryDragActive = false;
    let phraseBoundaryDragPointerId = null;
    let phraseBoundaryDragBoundaryIndex = -1;
    let phraseBoundaryDragBarBoundaries = null;
    let phraseBoundaryDragCounts = null;
    let phraseBoundaryDragStartCounts = null;
    let phraseBoundaryDragStartBoundaryIndex = -1;
    let phraseBoundaryDragStartBarK = -1;
    let phraseBoundaryDragStartClientX = 0;
    let phraseBoundaryDragDocMove = null;
    let phraseBoundaryDragDocUp = null;

    function getWaveformLanesElForPhraseDrag() {
        return typeof audioWaveformLanesTracks !== 'undefined' && audioWaveformLanesTracks
            ? audioWaveformLanesTracks
            : typeof waveformScrubTargetEl === 'function'
              ? waveformScrubTargetEl()
              : null;
    }

    function transportSecToOverlayLeftPercent(sec, master) {
        if (typeof transportSecToTimelineLeftPercent === 'function') {
            return transportSecToTimelineLeftPercent(sec);
        }
        if (!(master > 0)) return 0;
        return (sec / master) * 100;
    }

    function detachPhraseBoundaryDragDocListeners() {
        if (phraseBoundaryDragDocMove) {
            document.removeEventListener('pointermove', phraseBoundaryDragDocMove);
            phraseBoundaryDragDocMove = null;
        }
        if (phraseBoundaryDragDocUp) {
            document.removeEventListener('pointerup', phraseBoundaryDragDocUp);
            document.removeEventListener('pointercancel', phraseBoundaryDragDocUp);
            phraseBoundaryDragDocUp = null;
        }
    }

    function endPhraseBoundaryDrag() {
        phraseBoundaryDragActive = false;
        phraseBoundaryDragPointerId = null;
        phraseBoundaryDragBoundaryIndex = -1;
        phraseBoundaryDragBarBoundaries = null;
        phraseBoundaryDragCounts = null;
        phraseBoundaryDragStartCounts = null;
        phraseBoundaryDragStartBoundaryIndex = -1;
        phraseBoundaryDragStartBarK = -1;
        phraseBoundaryDragStartClientX = 0;
        detachPhraseBoundaryDragDocListeners();
        const lanes = getWaveformLanesElForPhraseDrag();
        if (lanes) lanes.classList.remove('audio-waveform-composite__lanes--phrase-boundary-drag');
    }

    function syncPhraseBoundaryDeferToRegionHandles(defer) {
        if (!phraseBoundaryRoot || phraseBoundaryRoot.hidden) return;
        if (phraseBoundaryDragActive) defer = false;
        phraseBoundaryRoot.classList.toggle(
            'audio-waveform-composite__phrase-boundaries--defer-regions',
            !!defer,
        );
    }

    function onPhraseBoundaryHandlePointerDown(ev, boundaryIndex) {
        if (
            typeof isPointerInRegionEwCursorHitZone === 'function' &&
            isPointerInRegionEwCursorHitZone(ev.clientX, ev.clientY)
        ) {
            return;
        }
        if (!getMusicalGridPhraseFillVisible()) return;
        if (ev.button !== 0) return;
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.phraseSpec) return;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return;
        const counts = expandPhraseSpecToGroupBarCounts(
            settings.meterSpec,
            master,
            settings.phraseSpec,
        );
        if (counts.length < 2) return;
        const b = boundaryIndex | 0;
        if (b < 0 || b >= counts.length - 1) return;

        ev.preventDefault();
        ev.stopPropagation();
        if (typeof endAudioWaveformScrub === 'function') {
            endAudioWaveformScrub({ force: true });
        }

        const barBoundaries = collectBarBoundarySecs(settings.meterSpec, master);
        phraseBoundaryDragActive = true;
        phraseBoundaryDragPointerId = ev.pointerId;
        phraseBoundaryDragBoundaryIndex = b;
        phraseBoundaryDragBarBoundaries = barBoundaries;
        phraseBoundaryDragCounts = counts.slice();
        phraseBoundaryDragStartCounts = counts.slice();
        phraseBoundaryDragStartBoundaryIndex = b;
        phraseBoundaryDragStartBarK = sumGroupBarCounts(counts, b) + counts[b];
        phraseBoundaryDragStartClientX = ev.clientX;

        const lanes = getWaveformLanesElForPhraseDrag();
        if (lanes) lanes.classList.add('audio-waveform-composite__lanes--phrase-boundary-drag');

        phraseBoundaryDragDocMove = (e) => {
            if (!phraseBoundaryDragActive || e.pointerId !== phraseBoundaryDragPointerId) {
                return;
            }
            e.preventDefault();
            const startCounts = phraseBoundaryDragStartCounts;
            const b = phraseBoundaryDragStartBoundaryIndex;
            if (!startCounts || b < 0 || b >= startCounts.length - 1) return;
            const sumBefore = sumGroupBarCounts(startCounts, b);
            const minK = sumBefore;
            const maxK = sumBefore + startCounts[b] + startCounts[b + 1];
            const targetK = targetBarKForPhraseBoundaryDrag(
                phraseBoundaryDragStartBarK,
                phraseBoundaryDragStartClientX,
                e.clientX,
                phraseBoundaryDragBarBoundaries,
                minK,
                maxK,
            );
            applyPhraseBoundaryDragPreview(
                countsForPhraseBoundaryAtBarIndex(startCounts, b, targetK),
            );
        };

        phraseBoundaryDragDocUp = (e) => {
            if (!phraseBoundaryDragActive || e.pointerId !== phraseBoundaryDragPointerId) {
                return;
            }
            e.preventDefault();
            const finalCounts = phraseBoundaryDragCounts;
            const startCounts = phraseBoundaryDragStartCounts;
            const boundaryIdx = phraseBoundaryDragStartBoundaryIndex;
            if (finalCounts && finalCounts.length) {
                if (!phraseGroupCountsEqual(startCounts, finalCounts)) {
                    requestPhraseUndoCapture();
                }
                applyExplicitPhraseGroupBarCounts(finalCounts, { skipUndo: true });
                persistMusicalGridAndRedraw({ skipUndo: true });
            }
            endPhraseBoundaryDrag();
            if (finalCounts && finalCounts.length) {
                if (typeof writeLog === 'function') {
                    const mergedCount =
                        startCounts && startCounts.length > finalCounts.length
                            ? startCounts.length - finalCounts.length
                            : 0;
                    if (
                        mergedCount > 0 &&
                        wasLeftPhraseAbsorbedIntoRight(startCounts, finalCounts, boundaryIdx)
                    ) {
                        const left = phraseGroupLogLabelForIndex(boundaryIdx);
                        const right = phraseGroupLogLabelForIndex(boundaryIdx + 1);
                        writeLog(
                            'Phrase ' +
                                left +
                                ' absorbed into ' +
                                right +
                                ': ' +
                                musicalGridPhraseText,
                        );
                    } else if (mergedCount > 0) {
                        const left = phraseGroupLogLabelForIndex(boundaryIdx);
                        writeLog(
                            'Phrase ' +
                                left +
                                ' merged ' +
                                mergedCount +
                                ' phrase(s): ' +
                                musicalGridPhraseText,
                        );
                    } else {
                        const left = phraseGroupLogLabelForIndex(boundaryIdx);
                        const right = phraseGroupLogLabelForIndex(boundaryIdx + 1);
                        writeLog(
                            'Phrase boundary ' +
                                left +
                                '/' +
                                right +
                                ': ' +
                                musicalGridPhraseText,
                        );
                    }
                }
            }
        };

        document.addEventListener('pointermove', phraseBoundaryDragDocMove);
        document.addEventListener('pointerup', phraseBoundaryDragDocUp);
        document.addEventListener('pointercancel', phraseBoundaryDragDocUp);
    }

    function updatePhraseBoundaryOverlay() {
        if (!phraseBoundaryRoot) return;
        while (phraseBoundaryRoot.firstChild) {
            phraseBoundaryRoot.removeChild(phraseBoundaryRoot.firstChild);
        }
        if (!getMusicalGridPhraseFillVisible()) {
            phraseBoundaryRoot.hidden = true;
            return;
        }
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.phraseSpec) {
            phraseBoundaryRoot.hidden = true;
            return;
        }
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) {
            phraseBoundaryRoot.hidden = true;
            return;
        }
        const ranges = phraseBoundaryDragActive
            ? getPhraseGroupRangesSnapshot()
            : collectPhraseGroupRanges(
                  settings.meterSpec,
                  master,
                  settings.phraseSpec,
              );
        if (ranges.length < 2) {
            phraseBoundaryRoot.hidden = true;
            return;
        }
        phraseBoundaryRoot.hidden = false;
        for (let i = 0; i < ranges.length - 1; i++) {
            const boundarySec = ranges[i].endSec;
            const leftPct = transportSecToOverlayLeftPercent(boundarySec, master);
            const handle = document.createElement('div');
            handle.className = 'audio-waveform-composite__phrase-boundary-handle';
            handle.style.left = leftPct + '%';
            handle.dataset.boundaryIndex = String(i);
            const leftLabel = phraseGroupLabelForIndex(ranges[i].paletteIndex);
            const rightLabel = phraseGroupLabelForIndex(ranges[i + 1].paletteIndex);
            handle.title =
                'Phrase ' +
                leftLabel +
                ' / ' +
                rightLabel +
                ' 境界（ドラッグで小節数調整・左端で右と結合・右へ結合）';
            handle.addEventListener('pointerdown', (ev) => {
                onPhraseBoundaryHandlePointerDown(ev, i);
            });
            phraseBoundaryRoot.appendChild(handle);
        }
    }

    function initMusicalGridUi() {
        try {
            const prefs = typeof readPrefs === 'function' ? readPrefs() : {};
            if (prefs.musicalGrid) applyMusicalGridPersistSnapshot(prefs.musicalGrid);
            if (typeof prefs.musicalGridVisible === 'boolean') {
                musicalGridVisible = prefs.musicalGridVisible;
            }
            if (typeof prefs.musicalGridPhraseFillVisible === 'boolean') {
                musicalGridPhraseFillVisible = prefs.musicalGridPhraseFillVisible;
            }
        } catch (_) {}

        syncMusicalGridVisibilityUi();

        if (musicalGridVisibleCheckbox) {
            musicalGridVisibleCheckbox.addEventListener('change', () => {
                setMusicalGridVisible(musicalGridVisibleCheckbox.checked);
            });
        }
        if (musicalGridPhraseFillCheckbox) {
            musicalGridPhraseFillCheckbox.addEventListener('change', () => {
                setMusicalGridPhraseFillVisible(musicalGridPhraseFillCheckbox.checked);
            });
        }

        const onInput = () => {
            scheduleMusicalGridRedraw();
            scheduleMusicalGridAutosave();
        };
        if (musicalGridMeterInput) {
            musicalGridMeterInput.addEventListener('input', onInput);
            musicalGridMeterInput.addEventListener('change', persistMusicalGridAndRedraw);
            musicalGridMeterInput.addEventListener('keydown', (e) => {
                if (
                    matchUserShortcut(e, 'musicalGridInputArrowUp', { allowRepeat: true }) ||
                    matchUserShortcut(e, 'musicalGridInputArrowDown', { allowRepeat: true })
                ) {
                    e.preventDefault();
                    const dir = matchUserShortcut(e, 'musicalGridInputArrowUp', { allowRepeat: true }) ? 1 : -1;
                    const bpmStep = (e.shiftKey ? 10 : 1) * dir;
                    const sigStep = dir;
                    bumpMeterFieldBy(bpmStep, sigStep);
                    return;
                }
                if (matchUserShortcut(e, 'submitEditing', { allowRepeat: true })) {
                    e.preventDefault();
                    persistMusicalGridAndRedraw();
                    musicalGridMeterInput.blur();
                    if (typeof scheduleWaveformFocusRestore === 'function') scheduleWaveformFocusRestore();
                    return;
                }
                if (matchUserShortcut(e, 'cancelEditing', { allowRepeat: true })) {
                    e.preventDefault();
                    musicalGridMeterInput.blur();
                    if (typeof scheduleWaveformFocusRestore === 'function') scheduleWaveformFocusRestore();
                }
            });
        }
        if (musicalGridPhraseInput) {
            musicalGridPhraseInput.addEventListener('focus', () => {
                readMusicalGridFromInputs();
                phraseInputFocusSnapshot = capturePhraseUndoSnapshot();
            });
            musicalGridPhraseInput.addEventListener('input', onInput);
            musicalGridPhraseInput.addEventListener('change', () => {
                commitPhraseInputUndoIfChanged();
                persistMusicalGridAndRedraw({ skipUndo: true });
            });
            musicalGridPhraseInput.addEventListener('keydown', (e) => {
                if (
                    matchUserShortcut(e, 'musicalGridInputArrowUp', { allowRepeat: true }) ||
                    matchUserShortcut(e, 'musicalGridInputArrowDown', { allowRepeat: true })
                ) {
                    e.preventDefault();
                    const step = e.shiftKey ? 10 : 1;
                    bumpPhraseSizeBy(
                        matchUserShortcut(e, 'musicalGridInputArrowUp', { allowRepeat: true })
                            ? step
                            : -step,
                    );
                    return;
                }
                if (matchUserShortcut(e, 'submitEditing', { allowRepeat: true })) {
                    e.preventDefault();
                    commitPhraseInputUndoIfChanged();
                    persistMusicalGridAndRedraw({ skipUndo: true });
                    musicalGridPhraseInput.blur();
                    if (typeof scheduleWaveformFocusRestore === 'function') scheduleWaveformFocusRestore();
                    return;
                }
                if (matchUserShortcut(e, 'cancelEditing', { allowRepeat: true })) {
                    e.preventDefault();
                    musicalGridPhraseInput.blur();
                    if (typeof scheduleWaveformFocusRestore === 'function') scheduleWaveformFocusRestore();
                }
            });
        }

        if (typeof audioWaveformLanesTracks !== 'undefined' && audioWaveformLanesTracks) {
            audioWaveformLanesTracks.addEventListener('scroll', scheduleMusicalGridRedraw, {
                passive: true,
            });
        }
        window.addEventListener('resize', scheduleMusicalGridRedraw);
        scheduleMusicalGridRedraw();
    }

    window.getMusicalGridPersistSnapshot = musicalGridPersistSnapshot;
    window.getMusicalGridVisible = getMusicalGridVisible;
    window.setMusicalGridVisible = setMusicalGridVisible;
    window.toggleMusicalGridVisible = toggleMusicalGridVisible;
    window.getMusicalGridPhraseFillVisible = getMusicalGridPhraseFillVisible;
    window.setMusicalGridPhraseFillVisible = setMusicalGridPhraseFillVisible;
    window.toggleMusicalGridPhraseFillVisible = toggleMusicalGridPhraseFillVisible;
    window.applyMusicalGridPersistSnapshot = applyMusicalGridPersistSnapshot;
    window.resetMusicalGridToDefaults = resetMusicalGridToDefaults;
    window.drawMusicalGridOverlay = drawMusicalGridOverlay;
    window.scheduleMusicalGridRedraw = scheduleMusicalGridRedraw;
    window.parseMeterSpec = parseMeterSpec;
    window.parseTimeSignatureSpec = parseTimeSignatureSpec;
    window.parseMusicalGridTempoBpm = parseMusicalGridTempoBpm;
    window.parsePhraseGroupingSpec = parsePhraseGroupingSpec;
    window.resolveMusicalGridNumpadSeekSec = resolveMusicalGridNumpadSeekSec;
    window.getPhraseGroupRangesSnapshot = getPhraseGroupRangesSnapshot;
    window.resolvePhraseGroupAtTransportSec = resolvePhraseGroupAtTransportSec;
    window.hasMusicalGridSnapStops = hasMusicalGridSnapStops;
    window.collectMusicalGridSnapStops = collectMusicalGridSnapStops;
    window.snapSecToMusicalGridStops = snapSecToMusicalGridStops;
    window.jumpToAdjacentMusicalGridStop = jumpToAdjacentMusicalGridStop;
    window.jumpToAdjacentPhrase = jumpToAdjacentPhrase;
    window.resolveMusicalGridPlayheadPositionText = resolveMusicalGridPlayheadPositionText;
    window.syncPhraseBoundaryDeferToRegionHandles = syncPhraseBoundaryDeferToRegionHandles;
    window.handleMusicalGridPhraseSplitKeydown = handleMusicalGridPhraseSplitKeydown;
    window.handleMusicalGridPhraseDeleteKeydown = handleMusicalGridPhraseDeleteKeydown;
    window.handleMusicalGridPhraseJoinKeydown = handleMusicalGridPhraseJoinKeydown;
    window.joinPhraseAtTarget = joinPhraseAtTarget;
    window.handleMusicalGridPhraseUndoKeydown = handleMusicalGridPhraseUndoKeydown;
    window.handleMusicalGridPhraseRedoKeydown = handleMusicalGridPhraseRedoKeydown;
    window.undoPhraseDefinition = undoPhraseDefinition;
    window.redoPhraseDefinition = redoPhraseDefinition;
    window.splitPhraseAtWaveformPointer = splitPhraseAtWaveformPointer;
    window.deletePhraseAtWaveformPointer = deletePhraseAtWaveformPointer;
    window.swapPhraseGroupsAtIndices = swapPhraseGroupsAtIndices;
    window.resolvePhraseGroupIndexAtTransportSec = resolvePhraseGroupIndexAtTransportSec;
    window.capturePhraseUndoSnapshot = capturePhraseUndoSnapshot;
    window.restorePhraseUndoSnapshot = restorePhraseUndoSnapshot;

    initMusicalGridUi();
})();
