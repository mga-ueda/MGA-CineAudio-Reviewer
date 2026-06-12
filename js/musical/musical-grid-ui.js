/**
 * musical-grid-ui.js — グリッド UI・永続化・描画
 */
    function clearMusicalGridPositionCache() {
        musicalGridPosCache = null;
        invalidateMusicalGridNavStopsCache();
    }
    function invalidateMusicalGridNavStopsCache() {
        musicalGridNavStopsCache = null;
        musicalGridNavStopsCacheKey = '';
    }
    function musicalGridNavStopsCacheKeyNow() {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        return [
            musicalGridMeterText || '',
            musicalGridPhraseText || '',
            getMusicalGridVisible() ? '1' : '0',
            getMusicalGridPhraseFillVisible() ? '1' : '0',
            Number(master).toFixed(4),
        ].join('\0');
    }
    function dedupeSortedMusicalGridStops(stops) {
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
            barEndSec = barStartSec + meterBarDurationSec(entry);
        }
        const maxBars = 48000;
        let guard = 0;
        while (t >= barEndSec - 1e-9 && guard < maxBars) {
            barStartSec = barEndSec;
            barIndex += 1;
            entry = getMeterEntryForBar(meterSpec, barIndex);
            if (!entry) break;
            barEndSec = barStartSec + meterBarDurationSec(entry);
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
        const beat = resolveMeterBeatAtSec(pos.barStartSec, pos.entry, pos.sec);
        let beatInBar1 = 1;
        let beatStartSec = pos.barStartSec;
        let beatDur = beatDurationSec(pos.entry.sig, pos.entry.bpm);
        if (beat) {
            beatInBar1 = beat.beatInBar1;
            beatStartSec = beat.sec;
            beatDur = beat.beatDur;
        } else {
            const segments = getMeterSigSegments(pos.entry.sig);
            const firstSeg = segments && segments.length ? segments[0] : null;
            if (firstSeg) beatDur = beatDurationSec(firstSeg, pos.entry.bpm);
            const totalBeats = getMeterSigTotalBeats(pos.entry.sig);
            beatInBar1 = Math.max(1, Math.min(totalBeats || 1, beatInBar1));
        }
        const quarterDur = beatDur / 4;
        let quarterInBeat = Math.floor((pos.sec - beatStartSec) / quarterDur);
        if (!Number.isFinite(quarterInBeat)) quarterInBeat = 0;
        quarterInBeat = Math.max(0, Math.min(3, quarterInBeat));
        const barText = String(pos.barIndex + 1).padStart(3, '0');
        const beatText = String(beatInBar1).padStart(2, '0');
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
    /** 指定 transport の拍位置における 1 拍の秒数（Tempo/Sig・変拍子の各拍長に追従） */
    function meterBeatDurationSecAtTransport(transportSec) {
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return NaN;
        const maxSec =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(maxSec > 0)) return NaN;
        const pos = getMusicalGridBarBySec(settings.meterSpec, transportSec, maxSec);
        if (!pos || !pos.entry) return NaN;
        const beat = resolveMeterBeatAtSec(pos.barStartSec, pos.entry, pos.sec);
        if (beat && beat.beatDur > 0.00001) return beat.beatDur;
        const segments = getMeterSigSegments(pos.entry.sig);
        const firstSeg = segments && segments.length ? segments[0] : pos.entry.sig;
        const beatDur = beatDurationSec(firstSeg, pos.entry.bpm);
        return beatDur > 0.00001 ? beatDur : NaN;
    }
    function musicalGridDrawSettings() {
        readMusicalGridFromInputs();
        const meterSpec = parseMeterSpec(getCommittedMusicalGridMeterText());
        if (!meterSpec) return null;
        const phraseSpec = parsePhraseGroupingSpec(musicalGridPhraseText);
        return { meterSpec, phraseSpec };
    }
    function musicalGridPersistSnapshot() {
        readMusicalGridFromInputs();
        const snap = {
            meter: getCommittedMusicalGridMeterText(),
            phrase: musicalGridPhraseText,
            gridVisible: getMusicalGridVisible(),
            phraseFillVisible: getMusicalGridPhraseFillVisible(),
        };
        if (phraseGroupBarCountsOverride && phraseGroupBarCountsOverride.length) {
            snap.phraseGroupBarCounts = phraseGroupBarCountsOverride.slice();
        }
        return snap;
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
        const composite = document.getElementById('audioWaveformComposite');
        if (composite) {
            composite.classList.toggle(
                'audio-waveform-composite--phrase-fill',
                getMusicalGridPhraseFillVisible(),
            );
        }
        const regionDragForbidden =
            getMusicalGridVisible() || getMusicalGridPhraseFillVisible();
        const lanes =
            typeof getWaveformLanesEl === 'function' ? getWaveformLanesEl() : null;
        if (lanes) {
            lanes.classList.toggle(
                'audio-waveform-composite__lanes--region-drag-forbidden',
                regionDragForbidden,
            );
        }
    }
    function setMusicalGridVisible(visible, opt) {
        musicalGridVisible = visible !== false;
        const o = opt && typeof opt === 'object' ? opt : {};
        syncMusicalGridVisibilityUi();
        if (typeof drawMusicalGridOverlay === 'function') drawMusicalGridOverlay();
        if (!o.skipRegionRefresh) {
            if (typeof refreshAllWaveformTrackLkfsVisibility === 'function') {
                refreshAllWaveformTrackLkfsVisibility();
            }
            if (typeof refreshAllRegionMusicalMetaPresentation === 'function') {
                refreshAllRegionMusicalMetaPresentation();
            }
        }
        if (o.persist !== false) {
            if (typeof writePrefs === 'function') writePrefs();
            if (!o.skipSessionPersist && typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
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
        if (!o.skipRegionRefresh) {
            if (typeof refreshAllRegionBoundaryPresentation === 'function') {
                refreshAllRegionBoundaryPresentation();
            }
            if (typeof refreshAllWaveformTrackLkfsVisibility === 'function') {
                refreshAllWaveformTrackLkfsVisibility();
            }
            if (typeof refreshAllRegionMusicalMetaPresentation === 'function') {
                refreshAllRegionMusicalMetaPresentation();
            } else if (typeof refreshAllRegionRehearsalMarkLabels === 'function') {
                refreshAllRegionRehearsalMarkLabels();
            }
        }
        if (o.persist !== false) {
            if (typeof writePrefs === 'function') writePrefs();
            if (!o.skipSessionPersist && typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
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
        if (Array.isArray(s.phraseGroupBarCounts) && s.phraseGroupBarCounts.length) {
            setPhraseGroupBarCountsOverride(s.phraseGroupBarCounts);
        } else {
            clearPhraseGroupBarCountsOverride();
        }
        clearMusicalGridPositionCache();
        if (musicalGridMeterInput) musicalGridMeterInput.value = musicalGridMeterText;
        if (musicalGridPhraseInput) musicalGridPhraseInput.value = musicalGridPhraseText;
        if (typeof s.gridVisible === 'boolean') {
            musicalGridVisible = s.gridVisible !== false;
        }
        if (typeof s.phraseFillVisible === 'boolean') {
            musicalGridPhraseFillVisible = s.phraseFillVisible !== false;
        }
        clearPhraseUndoStack();
        meterEditorLayoutBaseline = null;
        syncMusicalGridVisibilityUi();
        scheduleMusicalGridRedraw();
    }
    function resetMusicalGridToDefaults(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        applyMusicalGridPersistSnapshot({
            meter: MUSICAL_GRID_DEFAULT_METER_TEXT,
            phrase: MUSICAL_GRID_DEFAULT_PHRASE_TEXT,
        });
        setMusicalGridVisible(false, {
            silent: !!o.silent,
            persist: false,
            skipRegionRefresh: !!o.skipRegionRefresh,
        });
        setMusicalGridPhraseFillVisible(false, {
            silent: !!o.silent,
            persist: false,
            skipRegionRefresh: !!o.skipRegionRefresh,
        });
        if (o.persist !== false) {
            if (typeof writePrefs === 'function') writePrefs();
        }
    }
    function persistMusicalGridToStorage(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (typeof writePrefs === 'function') writePrefs();
        if (!o.skipSessionPersist && typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
    }
    function canCommitPhraseCompositionLayout() {
        return getMusicalGridPhraseFillVisible();
    }
    function relayoutExtraTrackRegionsToPhraseComposition(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!canCommitPhraseCompositionLayout()) return 0;
        readMusicalGridFromInputs();
        if (!o.preservePhraseBarCountsOverride) {
            clearPhraseGroupBarCountsOverride();
        }
        clearMusicalGridPositionCache();
        if (typeof window.applyPhraseCompositionToAllExtraTrackRegions !== 'function') {
            if (typeof writeLog === 'function') {
                writeLog('Phrase: region relayout skipped (core API not loaded)');
            }
            return 0;
        }
        return window.applyPhraseCompositionToAllExtraTrackRegions(o);
    }
    /** 波形側 Phrase 境界操作確定 — Phrase 欄へ反映後、構成どおりにリージョンを切り直す */
    function persistPhraseWaveformEditAndRedraw(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        persistMusicalGridAndRedraw({
            skipUndo: !!o.skipUndo,
            relayoutRegions: true,
            relayoutSilent: o.relayoutSilent !== false,
        });
    }
    function persistMusicalGridAndRedraw(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const meterCommit = applyMusicalGridMeterCommitFromInputs({
            notifyReject: !!o.strictMeterCommit,
        });
        if (!musicalGridPhraseText || !parsePhraseGroupingSpec(musicalGridPhraseText)) {
            musicalGridPhraseText = MUSICAL_GRID_DEFAULT_PHRASE_TEXT;
            if (musicalGridPhraseInput) musicalGridPhraseInput.value = musicalGridPhraseText;
        }
        const shouldRelayout = !!(o.relayoutRegions && canCommitPhraseCompositionLayout());
        const shouldRelayoutFromMeter = !!(
            o.relayoutSlotsFromMeter &&
            meterCommit.changed &&
            canCommitPhraseCompositionLayout() &&
            !shouldRelayout
        );
        const shouldRelayoutRegions = shouldRelayout || shouldRelayoutFromMeter;
        const shouldCompressPhrase = !!(o.compressPhrase || shouldRelayoutFromMeter);
        if (shouldCompressPhrase) {
            compressPhraseDefinitionFromExpandedCounts({ skipUndo: !!o.skipUndo });
        }
        clearMusicalGridPositionCache();
        persistMusicalGridToStorage();
        scheduleMusicalGridRedraw();
        if (shouldRelayoutRegions) {
            relayoutExtraTrackRegionsToPhraseComposition({
                silent: o.relayoutSilent !== false,
                preservePhraseBarCountsOverride:
                    shouldRelayoutFromMeter && !shouldCompressPhrase,
                skipUndo: !!o.skipUndo,
            });
        }
        if (!o.skipTimelineSlotRebuild && typeof rebuildAllTrackTimelineSlots === 'function') {
            rebuildAllTrackTimelineSlots({
                infer: true,
                preserveStored: false,
            });
        } else if (
            !o.skipTimelineSlotRebuild &&
            typeof refreshAllRegionMusicalMetaPresentation === 'function'
        ) {
            refreshAllRegionMusicalMetaPresentation();
        } else if (
            !o.skipTimelineSlotRebuild &&
            typeof refreshAllRegionRehearsalMarkLabels === 'function'
        ) {
            refreshAllRegionRehearsalMarkLabels();
        }
        if (shouldRelayoutRegions && typeof flushPersistSessionNow === 'function') {
            return flushPersistSessionNow().catch((err) => {
                if (typeof writeLog === 'function') {
                    writeLog(
                        'Session save failed after musical region relayout: ' +
                            (err && err.message ? err.message : String(err)),
                    );
                }
            });
        }
        return null;
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
    /** @returns {number} entry 内で caret が指す拍子セグメント index（+ 変拍子 / : 拍子繰り返し） */
    function meterSigSegmentIndexAtCaret(entryText, caretInEntry) {
        const entry = String(entryText == null ? '' : entryText);
        const dash = entry.indexOf('-');
        if (dash < 0) return 0;
        const sigPart = entry.slice(dash + 1);
        const rel = Math.max(0, Math.min(sigPart.length, caretInEntry - dash - 1));
        const delim = meterSigPartDelimiter(sigPart);
        if (!delim) return 0;
        let pos = 0;
        const parts = sigPart.split(delim);
        for (let i = 0; i < parts.length; i++) {
            const end = pos + parts[i].length;
            if (rel <= end || i === parts.length - 1) return i;
            pos = end + 1;
        }
        return 0;
    }
    /** @returns {'bpm'|'num'|'den'} */
    function meterFieldAtCaretInEntry(entryText, caretInEntry) {
        const entry = String(entryText == null ? '' : entryText);
        const dash = entry.indexOf('-');
        const pos = Math.max(0, Math.min(entry.length, caretInEntry | 0));
        if (dash < 0) return 'bpm';
        if (pos <= dash) return 'bpm';
        const sigPart = entry.slice(dash + 1);
        const rel = pos - dash - 1;
        const segIdx = meterSigSegmentIndexAtCaret(entry, caretInEntry);
        let segStart = 0;
        const delim = meterSigPartDelimiter(sigPart) || '+';
        const parts = sigPart.split(delim);
        for (let i = 0; i < segIdx; i++) {
            segStart += parts[i].length + 1;
        }
        const segText = parts[segIdx] || parts[0] || '';
        const slash = segText.indexOf('/');
        if (slash < 0) return 'num';
        const relInSeg = rel - segStart;
        if (relInSeg < slash) return 'num';
        return 'den';
    }
    function bumpMeterSigField(sig, field, step, segIdx) {
        if (!sig) return;
        if (sig.alternates && sig.alternates.length) {
            const idx = Math.max(0, Math.min(sig.alternates.length - 1, segIdx | 0));
            if (field === 'num') {
                sig.alternates[idx].num = clampMeterSigPart(sig.alternates[idx].num + step);
            } else if (field === 'den') {
                sig.alternates[idx].den = clampMeterSigPart(sig.alternates[idx].den + step);
            }
            return;
        }
        if (sig.segments && sig.segments.length) {
            const idx = Math.max(0, Math.min(sig.segments.length - 1, segIdx | 0));
            if (field === 'num') {
                sig.segments[idx].num = clampMeterSigPart(sig.segments[idx].num + step);
            } else if (field === 'den') {
                sig.segments[idx].den = clampMeterSigPart(sig.segments[idx].den + step);
            }
            return;
        }
        if (field === 'num') {
            sig.num = clampMeterSigPart(sig.num + step);
        } else if (field === 'den') {
            sig.den = clampMeterSigPart(sig.den + step);
        }
    }
    function caretPosForMeterField(raw, entryIndex, field, segIdx) {
        const span = commaListEntrySpan(raw, entryIndex);
        const entry = span.text;
        const dash = entry.indexOf('-');
        if (field === 'bpm' && dash >= 0) return span.start + Math.max(0, dash - 1);
        if ((field === 'num' || field === 'den') && dash >= 0) {
            const sigPart = entry.slice(dash + 1);
            const delim = meterSigPartDelimiter(sigPart) || '+';
            const parts = sigPart.split(delim);
            const idx = Math.max(0, Math.min(parts.length - 1, segIdx | 0));
            let segStart = 0;
            for (let i = 0; i < idx; i++) segStart += parts[i].length + 1;
            const segText = parts[idx] || '4/4';
            const slash = segText.indexOf('/');
            if (field === 'num') return span.start + dash + 1 + segStart;
            return span.start + dash + 1 + segStart + (slash >= 0 ? slash + 1 : 1);
        }
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
    function setMeterInputValuePreserveFieldCaret(input, text, entryIndex, field, segIdx) {
        if (!input) return;
        input.value = text;
        const pos = caretPosForMeterField(text, entryIndex, field, segIdx);
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
        const caretInEntry = caret - span.start;
        const segIdx = meterSigSegmentIndexAtCaret(span.text, caretInEntry);
        const field = meterFieldAtCaretInEntry(span.text, caretInEntry);
        const step = field === 'bpm' ? delta : sigDelta;
        const trailingDelimiter = meterEntryHasTrailingSigPartDelimiter(span.text);
        readMusicalGridFromInputs();
        clearMusicalGridPositionCache();
        let spec = parseMeterSpec(musicalGridMeterText);
        let nextText;
        let caretEntryIndex = entryIndex;
        let caretField = field;
        let caretSegIdx = segIdx;
        if (
            meterInputShouldAppendCommaEntry(input, raw, entryIndex) &&
            spec &&
            spec.entries.length > 0
        ) {
            const defaultEntry = parseMeterToken(MUSICAL_GRID_DEFAULT_METER_TEXT);
            if (defaultEntry) {
                spec.entries.push({
                    bpm: defaultEntry.bpm,
                    sig: cloneMeterSig(defaultEntry.sig),
                });
                nextText = formatMeterSpec(spec);
                caretEntryIndex = spec.entries.length - 1;
                caretField = 'bpm';
                caretSegIdx = 0;
            }
        }
        if (!nextText && spec && !trailingDelimiter) {
            const idx = Math.min(Math.max(0, entryIndex), spec.entries.length - 1);
            const entry = spec.entries[idx];
            if (field === 'bpm') {
                entry.bpm = Math.max(1, Math.min(999, entry.bpm + step));
            } else {
                bumpMeterSigField(entry.sig, field, step, segIdx);
            }
            nextText = formatMeterSpec(spec);
        } else if (!nextText) {
            const token = resolveMeterEntryForBump(span.text);
            if (field === 'bpm') {
                token.bpm = Math.max(1, Math.min(999, token.bpm + step));
            } else if (!trailingDelimiter) {
                bumpMeterSigField(token.sig, field, step, segIdx);
            }
            nextText = replaceCommaListEntry(raw, entryIndex, formatMeterEntryToken(token));
            if (trailingDelimiter) {
                const completedSpan = commaListEntrySpan(nextText, entryIndex);
                const caretAtEnd = completedSpan.text.length;
                caretSegIdx = meterSigSegmentIndexAtCaret(completedSpan.text, caretAtEnd);
                caretField = meterFieldAtCaretInEntry(completedSpan.text, caretAtEnd);
            }
        }
        musicalGridMeterText = nextText;
        setMeterInputValuePreserveFieldCaret(
            input,
            nextText,
            caretEntryIndex,
            caretField,
            caretSegIdx,
        );
        scheduleMusicalGridRedraw();
        scheduleMusicalGridAutosave();
    }
    function phraseInputCaretAtEnd(input) {
        if (!input || typeof input.selectionStart !== 'number') return false;
        const len = input.value.length;
        return input.selectionStart === len && input.selectionEnd === len;
    }
    function bumpPhraseSizeBy(delta) {
        const input = musicalGridPhraseInput;
        const raw = input ? input.value : musicalGridPhraseText;
        const caret = input ? input.selectionStart : 0;
        requestPhraseUndoCapture();
        phraseInputFocusSnapshot = null;
        readMusicalGridFromInputs();
        clearPhraseGroupBarCountsOverride();
        clearMusicalGridPositionCache();
        let spec = parsePhraseGroupingSpec(musicalGridPhraseText);
        let entryIndex = commaListEntryIndexAtCaret(raw, caret);
        let nextText;
        if (input && phraseInputCaretAtEnd(input) && spec && spec.sizes.length > 0) {
            spec.sizes.push(8);
            nextText = spec.sizes.join(',');
            entryIndex = spec.sizes.length - 1;
        } else if (!spec) {
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
        if (
            typeof isWaveformScrubPriorityActive === 'function' &&
            isWaveformScrubPriorityActive()
        ) {
            return;
        }
        if (musicalGridRedrawRaf) return;
        musicalGridRedrawRaf = requestAnimationFrame(() => {
            musicalGridRedrawRaf = 0;
            drawMusicalGridOverlay();
            if (typeof refreshAllRegionRehearsalMarkLabels === 'function') {
                refreshAllRegionRehearsalMarkLabels();
            }
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
        if (!lanes) return null;
        const h = Math.max(1, lanes.clientHeight | 0);
        if (h < 1) return null;
        if (typeof syncWaveformCanvasElement === 'function') {
            const sized = syncWaveformCanvasElement(musicalGridCanvas, h);
            if (!sized) return null;
            const spec = sized.canvasSpec || {};
            return {
                ctx: sized.ctx,
                w: sized.wCss,
                h: sized.hCss,
                layoutW: spec.contentW || sized.wCss,
                xOffset: spec.mode === 'window' ? spec.canvasLeft || 0 : 0,
            };
        }
        const inner =
            typeof audioWaveformLanesInner !== 'undefined' && audioWaveformLanesInner
                ? audioWaveformLanesInner
                : typeof waveformTimelineInnerEl === 'function'
                  ? waveformTimelineInnerEl()
                  : musicalGridCanvas.parentElement;
        if (!inner) return null;
        const w = Math.max(1, inner.clientWidth | 0);
        if (w < 1) return null;
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
        return { ctx, w, h, layoutW: w, xOffset: 0 };
    }

    /** 展開 Phrase スロット index（0 始まり）→ A, B … Z, AA … */
    function phraseGroupLabelForIndex(index) {
        let n = (index | 0) + 1;
        if (n < 1) return 'A';
        let out = '';
        while (n > 0) {
            n--;
            out = String.fromCharCode(65 + (n % 26)) + out;
            n = (n / 26) | 0;
        }
        return out;
    }

    /** フレーズスロット index → リハーサル名表示（R. Offset 時のリハーサル名なしは空文字） */
    function phraseRehearsalDisplayMarkForSlot(phraseSlotIndex) {
        if (typeof rehearsalMarkLabelForPhraseSlotIndex === 'function') {
            const internal = rehearsalMarkLabelForPhraseSlotIndex(phraseSlotIndex);
            if (typeof rehearsalMarkDisplayLabel === 'function') {
                return rehearsalMarkDisplayLabel(internal);
            }
            const unlabeled =
                typeof REHEARSAL_MARK_UNLABELED !== 'undefined'
                    ? REHEARSAL_MARK_UNLABELED
                    : '_';
            return internal && internal !== unlabeled ? internal : '';
        }
        return phraseGroupLabelForIndex(phraseSlotIndex);
    }

    function resolvePhraseGroupRanges(opt) {
        const requireFillVisible = !!(opt && opt.requireFillVisible);
        if (requireFillVisible && !getMusicalGridPhraseFillVisible()) return [];
        if (!requireFillVisible) readMusicalGridFromInputs();
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return [];
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return [];
        if (phraseBoundaryDragCounts && phraseBoundaryDragCounts.length) {
            return collectPhraseGroupRangesFromBarCounts(
                settings.meterSpec,
                master,
                phraseBoundaryDragCounts,
            );
        }
        const counts = resolvePhraseGroupBarCounts(
            settings.meterSpec,
            master,
            settings.phraseSpec,
        );
        if (!counts.length) return [];
        return collectPhraseGroupRangesFromBarCounts(
            settings.meterSpec,
            master,
            counts,
        );
    }

    /** Phrase 着色 OFF でもリハーサル名用 — フレーズ定義から展開した範囲 */
    function getPhraseGroupRangesForRegionRehearsalMarks() {
        return resolvePhraseGroupRanges({ requireFillVisible: false });
    }

    function getPhraseGroupRangesSnapshot() {
        return resolvePhraseGroupRanges({ requireFillVisible: true });
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
            label: phraseRehearsalDisplayMarkForSlot(r.paletteIndex),
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
        const o = opt && typeof opt === 'object' ? opt : {};
        const resumeAfter = !!o.resumeAfterSeek;
        let target = stop.sec;
        if (typeof clampTransportSec === 'function') {
            target = clampTransportSec(target);
        }
        if (typeof suppressRangeLoopSnapForExplicitSeek === 'function') {
            suppressRangeLoopSnapForExplicitSeek();
        }
        const hintTc =
            typeof formatTimecodeForTransport === 'function'
                ? formatTimecodeForTransport(target)
                : String(target);
        const hintTitle = stop.label || 'Phrase';
        if (
            o.discreteStopNav &&
            typeof applyDiscreteStopNavStep === 'function'
        ) {
            applyDiscreteStopNavStep(target, {
                resumeAfterSeek: resumeAfter,
                fromRepeat: o.fromRepeat,
            });
            if (!o.fromRepeat) {
                if (typeof writeLog === 'function') {
                    writeLog('Phrase: seek to ' + hintTitle + ' @ ' + hintTc);
                }
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint(hintTitle, hintTc);
                }
            }
            return true;
        }
        if (typeof applyJumpTransportSeek === 'function') {
            applyJumpTransportSeek(target, resumeAfter);
        } else if (typeof applyTransportAtSec === 'function') {
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

    function collectPhraseGroupDrawRanges(settings, master) {
        if (!getMusicalGridPhraseFillVisible()) return [];
        if (phraseBoundaryDragCounts && phraseBoundaryDragCounts.length) {
            return collectPhraseGroupRangesFromBarCounts(
                settings.meterSpec,
                master,
                phraseBoundaryDragCounts,
            );
        }
        const counts = resolvePhraseGroupBarCounts(
            settings.meterSpec,
            master,
            settings.phraseSpec,
        );
        if (counts.length) {
            return collectPhraseGroupRangesFromBarCounts(
                settings.meterSpec,
                master,
                counts,
            );
        }
        return [];
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

    function anyExtraTrackHasActiveRegions() {
        if (typeof getExtraTrackCount !== 'function' || typeof isTrackRegionActive !== 'function') {
            return false;
        }
        const n = getExtraTrackCount();
        for (let slot = 0; slot < n; slot++) {
            if (isTrackRegionActive({ type: 'extra', slot })) return true;
        }
        return false;
    }

    function collectPhraseGroupDrawCounts(settings, master) {
        if (!getMusicalGridPhraseFillVisible()) return [];
        if (phraseBoundaryDragCounts && phraseBoundaryDragCounts.length) {
            return phraseBoundaryDragCounts.slice();
        }
        return resolvePhraseGroupBarCounts(
            settings.meterSpec,
            master,
            settings.phraseSpec,
        );
    }

    /** slot が記憶する Tempo/Sig + Phrase 小節数（表示用）。content≠phrase 時は 8→16 */
    function formatPhraseSlotMusicalMetaText(meter, phraseBars, contentBars) {
        const m = String(meter == null ? '' : meter).trim();
        const phrase = phraseBars | 0;
        const content = contentBars | 0;
        let barPart = '';
        if (content > 0 && phrase > 0 && content !== phrase) {
            barPart = content + '→' + phrase;
        } else if (phrase > 0) {
            barPart = String(phrase);
        } else if (content > 0) {
            barPart = String(content);
        }
        if (m && barPart) return m + ' · ' + barPart;
        if (m) return m;
        return barPart;
    }

    function getMusicalGridMeterDisplayText() {
        readMusicalGridFromInputs();
        return getCommittedMusicalGridMeterText();
    }

    function drawPhraseGroupLabels(ctx, w, h, master, settings) {
        if (!getMusicalGridPhraseFillVisible()) return;
        /* Ex リージョン ON 時は Ex レーン側 DOM で左端番号を描画 */
        if (anyExtraTrackHasActiveRegions()) return;
        const ranges = collectPhraseGroupDrawRanges(settings, master);
        if (!ranges.length) return;
        const counts = collectPhraseGroupDrawCounts(settings, master);
        const meter = getMusicalGridMeterDisplayText();
        const secToX = (sec) => (sec / master) * w;
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            const x0 = secToX(r.startSec);
            const x1 = secToX(r.endSec);
            if (x1 <= x0 + 0.25) continue;

            const bandW = x1 - x0;
            const lx = x0 + Math.max(2, Math.min(8, bandW * 0.06));
            const ly = h - Math.max(6, h * 0.05);
            const baseFontPx = Math.max(10, Math.min(h * 0.24, 18));
            const fontPx = Math.min(baseFontPx, Math.max(10, bandW * 0.38));
            const label = phraseGroupLabelForIndex(r.paletteIndex);
            const phraseBars =
                counts && counts.length > (r.paletteIndex | 0)
                    ? counts[r.paletteIndex | 0] | 0
                    : 0;
            const meta = formatPhraseSlotMusicalMetaText(meter, phraseBars);
            ctx.save();
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
            ctx.lineJoin = 'round';
            ctx.font = '700 ' + fontPx + 'px system-ui, "Segoe UI", sans-serif';
            ctx.lineWidth = Math.max(2, fontPx * 0.08);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
            ctx.strokeText(label, lx, ly);
            ctx.fillText(label, lx, ly);
            if (meta) {
                const indexW = ctx.measureText(label).width;
                const metaFontPx = Math.max(8, fontPx * 0.72);
                const metaX = lx + indexW + Math.max(3, fontPx * 0.22);
                ctx.font = '600 ' + metaFontPx + 'px system-ui, "Segoe UI", sans-serif';
                ctx.lineWidth = Math.max(1.5, metaFontPx * 0.08);
                ctx.fillStyle = 'rgba(190, 215, 255, 0.88)';
                ctx.strokeText(meta, metaX, ly);
                ctx.fillText(meta, metaX, ly);
            }
            ctx.restore();
        }
    }

    function collectPlaybackRegionSpansForBarLabels() {
        const spans = [];
        if (
            typeof getExtraTrackCount !== 'function' ||
            typeof isTrackRegionActive !== 'function' ||
            typeof getSegmentCount !== 'function'
        ) {
            return spans;
        }
        const trackCount = getExtraTrackCount();
        for (let slot = 0; slot < trackCount; slot++) {
            const track = { type: 'extra', slot };
            if (!isTrackRegionActive(track)) continue;
            const segCount = getSegmentCount(track);
            for (let si = 0; si < segCount; si++) {
                let startSec = null;
                let endSec = null;
                if (typeof getSegmentRegionTimelineInterval === 'function') {
                    const iv = getSegmentRegionTimelineInterval(track, si);
                    startSec = iv && Number.isFinite(iv.start) ? iv.start : null;
                    endSec = iv && Number.isFinite(iv.end) ? iv.end : null;
                } else if (
                    typeof getSegmentRegionTimelineIn === 'function' &&
                    typeof getSegmentRegionTimelineOut === 'function'
                ) {
                    startSec = getSegmentRegionTimelineIn(track, si);
                    endSec = getSegmentRegionTimelineOut(track, si);
                }
                if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;
                if (endSec <= startSec + 1e-9) continue;
                spans.push({ slot, segmentIndex: si, startSec, endSec });
            }
        }
        return spans;
    }

    function regionBarStartBoundarySec(regionInSec, barBoundaries) {
        const idx = barIndexForBoundarySec(regionInSec, barBoundaries);
        return barBoundaries[idx];
    }

    function barLineIndexForSec(sec, barBoundaries) {
        const eps = 1e-4;
        for (let i = 0; i < barBoundaries.length - 1; i++) {
            if (Math.abs(sec - barBoundaries[i]) < eps) return i;
        }
        return -1;
    }

    function localBarNumberForRegionBarLine(regionInSec, barSec, barBoundaries) {
        const lineIdx = barLineIndexForSec(barSec, barBoundaries);
        if (lineIdx < 0) return null;
        const regionBarStart = regionBarStartBoundarySec(regionInSec, barBoundaries);
        const regionBarStartIdx = barLineIndexForSec(regionBarStart, barBoundaries);
        if (regionBarStartIdx < 0) return null;
        const localBar = lineIdx - regionBarStartIdx + 1;
        return localBar >= 1 ? localBar : null;
    }

    function barLineBelongsToRegionSpan(span, barSec, barBoundaries, spans) {
        const eps = 1e-4;
        if (!Number.isFinite(barSec) || !span) return false;
        if (barSec >= span.endSec - eps) return false;
        if (spans) {
            for (let i = 0; i < spans.length; i++) {
                const other = spans[i];
                if (other.slot !== span.slot) continue;
                if (other.segmentIndex <= span.segmentIndex) continue;
                if (barSec >= other.startSec - eps && barSec < other.endSec - eps) {
                    return false;
                }
            }
        }
        if (barSec >= span.startSec - eps) return true;
        const regionBarStart = regionBarStartBoundarySec(span.startSec, barBoundaries);
        return (
            Number.isFinite(regionBarStart) &&
            Math.abs(barSec - regionBarStart) < eps &&
            regionBarStart <= span.startSec + eps
        );
    }

    function regionSpanHasBarOneLabelAtIn(span, barLines, barBoundaries, spans) {
        const eps = 1e-4;
        for (let i = 0; i < barLines.length; i++) {
            const line = barLines[i];
            if (!line || line.kind !== 'bar' || !Number.isFinite(line.sec)) continue;
            if (!barLineBelongsToRegionSpan(span, line.sec, barBoundaries, spans)) continue;
            if (localBarNumberForRegionBarLine(span.startSec, line.sec, barBoundaries) !== 1) {
                continue;
            }
            if (Math.abs(line.sec - span.startSec) < eps) return true;
            const regionBarStart = regionBarStartBoundarySec(span.startSec, barBoundaries);
            if (Math.abs(line.sec - regionBarStart) < eps) return true;
        }
        return false;
    }

    function findPlaybackRegionSpanForBarLine(spans, barSec, barBoundaries) {
        const activeSlot =
            typeof getActiveMixExtraSlotFromDom === 'function'
                ? getActiveMixExtraSlotFromDom()
                : -1;
        let best = null;
        for (let i = 0; i < spans.length; i++) {
            const span = spans[i];
            if (!barLineBelongsToRegionSpan(span, barSec, barBoundaries, spans)) continue;
            if (!best) {
                best = span;
                continue;
            }
            if (span.startSec > best.startSec + 1e-9) {
                best = span;
                continue;
            }
            if (Math.abs(span.startSec - best.startSec) <= 1e-9) {
                if (activeSlot >= 0) {
                    if (span.slot === activeSlot && best.slot !== activeSlot) {
                        best = span;
                        continue;
                    }
                    if (best.slot === activeSlot && span.slot !== activeSlot) {
                        continue;
                    }
                }
                if (span.slot === best.slot && span.segmentIndex > best.segmentIndex) {
                    best = span;
                }
            }
        }
        return best;
    }

    function playbackRegionSpanContainsTransport(span, transportSec, barBoundaries, spans) {
        const eps = 1e-4;
        const t = Number(transportSec);
        if (!Number.isFinite(t) || !span) return false;
        if (t >= span.endSec - eps) return false;
        if (t >= span.startSec - eps) {
            if (spans) {
                for (let i = 0; i < spans.length; i++) {
                    const other = spans[i];
                    if (other.slot !== span.slot) continue;
                    if (other.segmentIndex <= span.segmentIndex) continue;
                    if (t >= other.startSec - eps && t < other.endSec - eps) return false;
                }
            }
            return true;
        }
        const regionBarStart = regionBarStartBoundarySec(span.startSec, barBoundaries);
        return (
            Number.isFinite(regionBarStart) &&
            t >= regionBarStart - eps &&
            regionBarStart <= span.startSec + eps
        );
    }

    function findPlaybackRegionSpanForTransportSec(spans, transportSec, barBoundaries) {
        const activeSlot =
            typeof getActiveMixExtraSlotFromDom === 'function'
                ? getActiveMixExtraSlotFromDom()
                : -1;
        let best = null;
        for (let i = 0; i < spans.length; i++) {
            const span = spans[i];
            if (!playbackRegionSpanContainsTransport(span, transportSec, barBoundaries, spans)) {
                continue;
            }
            if (!best) {
                best = span;
                continue;
            }
            if (span.startSec > best.startSec + 1e-9) {
                best = span;
                continue;
            }
            if (Math.abs(span.startSec - best.startSec) <= 1e-9) {
                if (activeSlot >= 0) {
                    if (span.slot === activeSlot && best.slot !== activeSlot) {
                        best = span;
                        continue;
                    }
                    if (best.slot === activeSlot && span.slot !== activeSlot) continue;
                }
                if (span.slot === best.slot && span.segmentIndex > best.segmentIndex) {
                    best = span;
                }
            }
        }
        return best;
    }

    function playbackRegionSpanForTrackSegment(spans, slot, segmentIndex, startSec, endSec) {
        for (let i = 0; i < spans.length; i++) {
            const span = spans[i];
            if (span.slot === slot && span.segmentIndex === segmentIndex) return span;
        }
        return { slot, segmentIndex, startSec, endSec };
    }

    /** 指定トラック上で seek 秒が Region In〜Out 内にあるセグメント（後続セグメント優先） */
    function resolveRegionSegmentAtTransportForTrack(track, transportSec) {
        const t = Number(transportSec);
        if (!Number.isFinite(t) || !track) return null;
        if (typeof isTrackRegionActive !== 'function' || !isTrackRegionActive(track)) {
            return null;
        }
        const segCount =
            typeof getSegmentCount === 'function' ? getSegmentCount(track) : 0;
        let best = null;
        const eps = 1e-4;
        for (let si = 0; si < segCount; si++) {
            let startSec = null;
            let endSec = null;
            if (typeof getSegmentRegionTimelineIn === 'function') {
                startSec = getSegmentRegionTimelineIn(track, si);
            }
            if (typeof getSegmentRegionTimelineOut === 'function') {
                endSec = getSegmentRegionTimelineOut(track, si);
            }
            if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;
            if (endSec <= startSec + eps) continue;
            if (t < startSec - eps || t >= endSec - eps) continue;
            if (!best || si > best.segmentIndex) {
                best = { slot: track.slot | 0, segmentIndex: si, startSec, endSec };
            }
        }
        return best;
    }

    function collectRegionBarJumpSlotPriority() {
        const slots = [];
        const pushSlot = (slot) => {
            const s = slot | 0;
            if (s < 0 || slots.indexOf(s) >= 0) return;
            slots.push(s);
        };
        if (typeof window.resolveTargetExtraSlot === 'function') {
            pushSlot(window.resolveTargetExtraSlot());
        }
        if (typeof getActiveMixExtraSlotFromDom === 'function') {
            pushSlot(getActiveMixExtraSlotFromDom());
        }
        if (typeof window.getLastActiveMixExtraSlot === 'function') {
            pushSlot(window.getLastActiveMixExtraSlot());
        }
        const trackCount =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        for (let slot = 0; slot < trackCount; slot++) {
            pushSlot(slot);
        }
        return slots;
    }

    /** シークバー現在地が属するリージョン（小節番号ラベルと同じ In〜Out 基準） */
    function resolvePlaybackRegionSpanAtSeekbar(spans, transportSec, barBoundaries) {
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return null;
        const slotOrder = collectRegionBarJumpSlotPriority();
        for (let i = 0; i < slotOrder.length; i++) {
            const slot = slotOrder[i];
            const track = { type: 'extra', slot };
            const hit = resolveRegionSegmentAtTransportForTrack(track, t);
            if (!hit) continue;
            return playbackRegionSpanForTrackSegment(
                spans,
                hit.slot,
                hit.segmentIndex,
                hit.startSec,
                hit.endSec,
            );
        }
        return findPlaybackRegionSpanForTransportSec(spans, t, barBoundaries);
    }

    function regionBarStartIndexForSpan(span, barBoundaries) {
        const regionBarStart = regionBarStartBoundarySec(span.startSec, barBoundaries);
        let idx = barLineIndexForSec(regionBarStart, barBoundaries);
        if (idx < 0) {
            idx = barIndexForBoundarySec(span.startSec, barBoundaries);
        }
        return idx;
    }

    function secForRegionLocalBarNumber(span, localBar, barBoundaries, spans) {
        const n = localBar | 0;
        if (!span || n < 1 || !barBoundaries || !barBoundaries.length) return null;
        const regionBarStartIdx = regionBarStartIndexForSpan(span, barBoundaries);
        if (n === 1) {
            const sec = span.startSec;
            return sec < span.endSec - 1e-4 ? sec : null;
        }
        const targetIdx = regionBarStartIdx + n - 1;
        if (targetIdx < 0 || targetIdx >= barBoundaries.length - 1) return null;
        const sec = barBoundaries[targetIdx];
        if (!barLineBelongsToRegionSpan(span, sec, barBoundaries, spans)) return null;
        if (sec >= span.endSec - 1e-4) return null;
        return sec;
    }

    /** Phrase 定義があるとき — リハーサル名（A/B/C…）内の localBar 小節の開始秒 */
    function secForPhraseLocalBarNumber(phraseRange, localBar, barBoundaries) {
        const n = localBar | 0;
        if (!phraseRange || n < 1 || !barBoundaries || !barBoundaries.length) return null;
        const eps = 1e-4;
        if (n === 1) {
            const sec = phraseRange.startSec;
            return sec < phraseRange.endSec - eps ? sec : null;
        }
        const phraseStartIdx = barIndexForBoundarySec(phraseRange.startSec, barBoundaries);
        if (phraseStartIdx < 0) return null;
        const targetIdx = phraseStartIdx + n - 1;
        if (targetIdx < 0 || targetIdx >= barBoundaries.length - 1) return null;
        const sec = barBoundaries[targetIdx];
        if (sec >= phraseRange.endSec - eps) return null;
        return sec;
    }

    function seekToRegionLocalBarSec(targetSec, localBar, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const resumeAfter = !!o.resumeAfterSeek;
        let target = targetSec;
        if (typeof clampTransportSec === 'function') {
            target = clampTransportSec(target);
        }
        if (typeof suppressRangeLoopSnapForExplicitSeek === 'function') {
            suppressRangeLoopSnapForExplicitSeek();
        }
        const hintTc =
            typeof formatTimecodeForTransport === 'function'
                ? formatTimecodeForTransport(target)
                : String(target);
        const hintTitle = 'Bar ' + (localBar | 0);
        if (
            o.discreteStopNav !== false &&
            typeof applyDiscreteStopNavStep === 'function'
        ) {
            applyDiscreteStopNavStep(target, {
                resumeAfterSeek: resumeAfter,
                fromRepeat: o.fromRepeat,
            });
            if (!o.fromRepeat) {
                if (typeof writeLog === 'function') {
                    writeLog('Region bar: jump to ' + hintTitle + ' @ ' + hintTc);
                }
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint(hintTitle, hintTc);
                }
            }
            return true;
        }
        if (typeof applyJumpTransportSeek === 'function') {
            applyJumpTransportSeek(target, resumeAfter);
        } else if (typeof applyTransportAtSec === 'function') {
            applyTransportAtSec(target, { resumeAfter: resumeAfter });
        } else if (typeof applyTimeToVideo === 'function') {
            applyTimeToVideo(target);
        }
        if (typeof syncTransportSeekUi === 'function') {
            syncTransportSeekUi(target);
        } else if (typeof setTransportSec === 'function') {
            setTransportSec(target);
        }
        if (typeof updateAllWaveformPlayheads === 'function') {
            updateAllWaveformPlayheads();
        }
        if (typeof writeLog === 'function') {
            writeLog('Region bar: jump to ' + hintTitle + ' @ ' + hintTc);
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(hintTitle, hintTc);
        }
        return true;
    }

    function jumpToRegionLocalBarNumber(localBar, opt) {
        if (!getMusicalGridVisible()) return false;
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return false;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return false;
        const spans = collectPlaybackRegionSpansForBarLabels();
        if (!spans.length) return false;
        const barBoundaries = collectBarBoundarySecs(settings.meterSpec, master);
        if (!barBoundaries.length) return false;
        const t =
            typeof getTransportSec === 'function'
                ? getTransportSec()
                : typeof videoMain !== 'undefined' && videoMain
                  ? videoMain.currentTime || 0
                  : 0;
        const phraseRanges = resolvePhraseGroupRanges({ requireFillVisible: false });
        if (phraseRanges.length) {
            const phraseRange = phraseRangeAfterGridBoundarySec(t);
            if (phraseRange) {
                const phraseTargetSec = secForPhraseLocalBarNumber(
                    phraseRange,
                    localBar | 0,
                    barBoundaries,
                );
                if (Number.isFinite(phraseTargetSec)) {
                    return seekToRegionLocalBarSec(phraseTargetSec, localBar | 0, opt);
                }
            }
        }
        const span = resolvePlaybackRegionSpanAtSeekbar(spans, t, barBoundaries);
        if (!span) return false;
        const targetSec = secForRegionLocalBarNumber(span, localBar | 0, barBoundaries, spans);
        if (!Number.isFinite(targetSec)) return false;
        return seekToRegionLocalBarSec(targetSec, localBar | 0, opt);
    }

    let regionBarJumpDigitBuf = '';
    let regionBarJumpDigitTimer = null;
    const REGION_BAR_JUMP_DIGIT_TIMEOUT_MS = 300;
    const REGION_BAR_JUMP_MAX_DIGITS = 3;

    function flushRegionBarJumpDigitBuffer() {
        const buf = regionBarJumpDigitBuf;
        regionBarJumpDigitBuf = '';
        regionBarJumpDigitTimer = null;
        const barNum = parseInt(buf, 10);
        if (!Number.isFinite(barNum) || barNum < 1) return;
        const wasPlaying =
            typeof isTransportPlaying === 'function'
                ? isTransportPlaying()
                : typeof videoMain !== 'undefined' && videoMain && !videoMain.paused;
        if (!jumpToRegionLocalBarNumber(barNum, { resumeAfterSeek: wasPlaying })) {
            if (typeof writeLog === 'function') {
                writeLog(
                    'Region bar: jump skipped (bar ' +
                        barNum +
                        ' — Tempo/Sig OFF, or seekbar not in a region, or bar out of range)',
                );
            }
        }
    }

    function scheduleRegionBarJumpFromBuffer() {
        if (regionBarJumpDigitTimer != null) {
            clearTimeout(regionBarJumpDigitTimer);
        }
        regionBarJumpDigitTimer = setTimeout(flushRegionBarJumpDigitBuffer, REGION_BAR_JUMP_DIGIT_TIMEOUT_MS);
    }

    function handleRegionBarNumberJumpKeydown(e) {
        const digit =
            typeof window.getRegionBarJumpDigit === 'function'
                ? window.getRegionBarJumpDigit(e)
                : typeof window.getShiftSeekDigit === 'function'
                  ? window.getShiftSeekDigit(e)
                  : null;
        if (digit == null) return false;
        if (e.repeat) return false;

        if (
            typeof transportControlsReady === 'function' &&
            !transportControlsReady()
        ) {
            return false;
        }
        if (!getMusicalGridVisible()) return false;

        if (regionBarJumpDigitBuf !== '' && regionBarJumpDigitTimer != null) {
            const composed = regionBarJumpDigitBuf + String(digit);
            if (composed.length > REGION_BAR_JUMP_MAX_DIGITS) {
                regionBarJumpDigitBuf = String(digit);
            } else {
                regionBarJumpDigitBuf = composed;
            }
        } else {
            regionBarJumpDigitBuf = String(digit);
        }

        const pendingBar = parseInt(regionBarJumpDigitBuf, 10);
        if (!Number.isFinite(pendingBar) || pendingBar < 1) {
            regionBarJumpDigitBuf = '';
            if (regionBarJumpDigitTimer != null) {
                clearTimeout(regionBarJumpDigitTimer);
                regionBarJumpDigitTimer = null;
            }
            return false;
        }

        e.preventDefault();
        scheduleRegionBarJumpFromBuffer();
        return true;
    }

    /** Tempo/Sig ON 時 — 小節線（赤）の右に、リージョン内の 1 小節目からの番号を描画（Phrase 定義あり時は小節線の属するフレーズ基準） */
    const REGION_BAR_NUMBER_LABEL_FONT_PX = 10;
    const REGION_BAR_NUMBER_LABEL_Y = 8;
    const REGION_BAR_NUMBER_LABEL_X_OFFSET = 3;

    function localBarNumberLabelForBarLine(lineSec, barBoundaries, phraseRanges, span) {
        if (phraseRanges && phraseRanges.length) {
            const phraseRange = phraseRangeAfterGridBoundarySec(lineSec);
            if (!phraseRange) return null;
            return localBarNumberForPhraseAtSec(phraseRange.startSec, lineSec, barBoundaries);
        }
        if (!span) return null;
        return localBarNumberForRegionBarLine(span.startSec, lineSec, barBoundaries);
    }

    function drawRegionBarNumberLabels(ctx, w, _h, master, barLines, meterSpec) {
        if (!getMusicalGridVisible() || !barLines.length || !meterSpec) return;
        const spans = collectPlaybackRegionSpansForBarLabels();
        if (!spans.length) return;
        const barBoundaries = collectBarBoundarySecs(meterSpec, master);
        if (!barBoundaries.length) return;
        const phraseRanges = resolvePhraseGroupRanges({ requireFillVisible: false });
        const usePhraseBarNumbers = phraseRanges.length > 0;
        const secToX = (sec) => (sec / master) * w;
        const fontPx = REGION_BAR_NUMBER_LABEL_FONT_PX;
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = '400 ' + fontPx + 'px system-ui, "Segoe UI", sans-serif';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
        ctx.fillStyle = 'rgba(255, 230, 80, 0.95)';

        function drawLabelAtSec(sec, label) {
            const x = secToX(sec);
            if (x < -0.5 || x > w + 0.5) return;
            const xi = Math.round(x) + 0.5;
            const labelX = xi + REGION_BAR_NUMBER_LABEL_X_OFFSET;
            const labelY = REGION_BAR_NUMBER_LABEL_Y;
            ctx.strokeText(label, labelX, labelY);
            ctx.fillText(label, labelX, labelY);
        }

        for (let i = 0; i < barLines.length; i++) {
            const line = barLines[i];
            if (!line || line.kind !== 'bar' || !Number.isFinite(line.sec)) continue;
            const span = findPlaybackRegionSpanForBarLine(spans, line.sec, barBoundaries);
            if (!span) continue;
            const localBar = localBarNumberLabelForBarLine(
                line.sec,
                barBoundaries,
                usePhraseBarNumbers ? phraseRanges : null,
                span,
            );
            if (!localBar) continue;
            drawLabelAtSec(line.sec, String(localBar));
        }

        if (!usePhraseBarNumbers) {
            for (let si = 0; si < spans.length; si++) {
                const span = spans[si];
                if (regionSpanHasBarOneLabelAtIn(span, barLines, barBoundaries, spans)) continue;
                if (
                    span.startSec < span.endSec - 1e-6 &&
                    span.startSec >= 0 &&
                    span.startSec < master - 1e-6
                ) {
                    drawLabelAtSec(span.startSec, '1');
                }
            }
        }
        ctx.restore();
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
        const { ctx, w, h, layoutW, xOffset } = sized;
        ctx.clearRect(0, 0, w, h);
        const settings = musicalGridDrawSettings();
        if (!settings) return;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return;
        ctx.save();
        if (xOffset) ctx.translate(-xOffset, 0);
        const suppressPhraseFillsDuringRegionSwap =
            typeof window.isPlaybackRegionSwapPhraseFillSuppressed === 'function' &&
            window.isPlaybackRegionSwapPhraseFillSuppressed();
        if (!suppressPhraseFillsDuringRegionSwap) {
            drawPhraseGroupFills(ctx, layoutW, h, master, settings);
        }
        if (getMusicalGridVisible()) {
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            const zoom =
                typeof getWaveformTimelineZoom === 'function' ? getWaveformTimelineZoom() : 1;
            const showBeats = zoom >= 10;
            const lines = collectMusicalGridLines(settings.meterSpec, master, {
                showBeats,
            });
            const secToX = (sec) => (sec / master) * layoutW;
            const visMin = xOffset - 0.5;
            const visMax = xOffset + w + 0.5;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const x = secToX(line.sec);
                if (x < visMin || x > visMax) continue;
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
            drawRegionBarNumberLabels(ctx, layoutW, h, master, lines, settings.meterSpec);
            ctx.restore();
        }
        drawPhraseGroupLabels(ctx, layoutW, h, master, settings);
        ctx.restore();
        if (!phraseBoundaryDragActive) updatePhraseBoundaryOverlay();
    }
    /** @returns {number[]} 各小節の開始秒。末尾に durationSec。 */
