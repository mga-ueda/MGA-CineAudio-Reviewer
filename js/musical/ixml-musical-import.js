/**
 * ixml-musical-import.js — Nuendo/Cubase iXML から Tempo/Sig・Rehearsal を構築。
 */
(function ixmlMusicalImportModule() {
    function ixmlFirstChildElementByTag(el, tagNames) {
        if (!el) return null;
        const want = tagNames.map((t) => String(t || '').toUpperCase());
        for (let i = 0; i < el.childNodes.length; i++) {
            const node = el.childNodes[i];
            if (
                node.nodeType === Node.ELEMENT_NODE &&
                want.indexOf(String(node.tagName || '').toUpperCase()) >= 0
            ) {
                return node;
            }
        }
        return null;
    }

    function ixmlElementPlainText(el) {
        if (!el) return '';
        const parts = [];
        for (let i = 0; i < el.childNodes.length; i++) {
            const node = el.childNodes[i];
            if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
                if (node.textContent) parts.push(node.textContent);
            }
        }
        return parts.join('').trim();
    }

    function ixmlElementInnerXml(el) {
        if (!el) return '';
        if (typeof XMLSerializer === 'function') {
            const parts = [];
            for (let i = 0; i < el.childNodes.length; i++) {
                parts.push(new XMLSerializer().serializeToString(el.childNodes[i]));
            }
            const joined = parts.join('').trim();
            if (joined) return joined;
        }
        return ixmlElementPlainText(el);
    }

    function ixmlSteinbergAttrValueText(attrEl) {
        const valueEl = ixmlFirstChildElementByTag(attrEl, ['VALUE']);
        if (valueEl) return ixmlElementInnerXml(valueEl);
        const numEl = ixmlFirstChildElementByTag(attrEl, ['NUMERATOR']);
        const denEl = ixmlFirstChildElementByTag(attrEl, ['DENOMINATOR']);
        if (numEl && denEl) {
            return ixmlElementPlainText(numEl) + '/' + ixmlElementPlainText(denEl);
        }
        const itemListEl = ixmlFirstChildElementByTag(attrEl, ['ITEM_LIST']);
        if (itemListEl) return ixmlElementInnerXml(itemListEl);
        return ixmlElementPlainText(attrEl);
    }

    function parseSteinbergAttrMapFromIxmlDoc(doc) {
        const attrs = Object.create(null);
        if (!doc) return attrs;
        const steinberg = doc.getElementsByTagName('STEINBERG')[0];
        const attrList =
            steinberg && ixmlFirstChildElementByTag(steinberg, ['ATTR_LIST']);
        if (!attrList) return attrs;
        for (let i = 0; i < attrList.childNodes.length; i++) {
            const attrEl = attrList.childNodes[i];
            if (
                !attrEl ||
                attrEl.nodeType !== Node.ELEMENT_NODE ||
                String(attrEl.tagName || '').toUpperCase() !== 'ATTR'
            ) {
                continue;
            }
            const nameEl = ixmlFirstChildElementByTag(attrEl, ['NAME']);
            if (!nameEl) continue;
            const name = ixmlElementPlainText(nameEl);
            if (!name) continue;
            attrs[name] = ixmlSteinbergAttrValueText(attrEl);
        }
        return attrs;
    }

    function cloneMeterSig(sig) {
        if (!sig) return { num: 4, den: 4 };
        if (sig.alternates && sig.alternates.length) {
            return {
                alternates: sig.alternates.map((a) => ({ num: a.num, den: a.den })),
            };
        }
        return { num: sig.num, den: sig.den };
    }

    /** Nuendo iXML rational — NUM=1 DEN=4 は 4/4 として書き出されることが多い */
    function parseSteinbergMusicalSignaturePair(numRaw, denRaw) {
        const num = parseInt(String(numRaw || '').trim(), 10);
        const den = parseInt(String(denRaw || '').trim(), 10);
        if (num === 1 && den === 4) return { num: 4, den: 4 };
        if (num > 0 && num <= 32 && den > 0 && den <= 32) return { num, den };
        return null;
    }

    function parseSteinbergAttrByName(doc, attrName) {
        const steinberg = doc.getElementsByTagName('STEINBERG')[0];
        const attrList =
            steinberg && ixmlFirstChildElementByTag(steinberg, ['ATTR_LIST']);
        if (!attrList) return null;
        const want = String(attrName || '').toUpperCase();
        for (let i = 0; i < attrList.childNodes.length; i++) {
            const attrEl = attrList.childNodes[i];
            if (
                !attrEl ||
                attrEl.nodeType !== Node.ELEMENT_NODE ||
                String(attrEl.tagName || '').toUpperCase() !== 'ATTR'
            ) {
                continue;
            }
            const nameEl = ixmlFirstChildElementByTag(attrEl, ['NAME']);
            if (!nameEl) continue;
            if (String(ixmlElementPlainText(nameEl) || '').toUpperCase() !== want) continue;
            return attrEl;
        }
        return null;
    }

    function parseSteinbergItemListMarkers(attrEl) {
        if (!attrEl) return [];
        const itemListEl = ixmlFirstChildElementByTag(attrEl, ['ITEM_LIST']);
        if (!itemListEl) return [];
        const markers = [];
        for (let i = 0; i < itemListEl.childNodes.length; i++) {
            const itemEl = itemListEl.childNodes[i];
            if (
                !itemEl ||
                itemEl.nodeType !== Node.ELEMENT_NODE ||
                String(itemEl.tagName || '').toUpperCase() !== 'ITEM'
            ) {
                continue;
            }
            const itemAttrList = ixmlFirstChildElementByTag(itemEl, ['ATTR_LIST']);
            if (!itemAttrList) continue;
            let position = NaN;
            let value = NaN;
            for (let j = 0; j < itemAttrList.childNodes.length; j++) {
                const nestedAttr = itemAttrList.childNodes[j];
                if (
                    !nestedAttr ||
                    nestedAttr.nodeType !== Node.ELEMENT_NODE ||
                    String(nestedAttr.tagName || '').toUpperCase() !== 'ATTR'
                ) {
                    continue;
                }
                const nestedNameEl = ixmlFirstChildElementByTag(nestedAttr, ['NAME']);
                const nestedValueEl = ixmlFirstChildElementByTag(nestedAttr, ['VALUE']);
                const nestedName = nestedNameEl
                    ? ixmlElementPlainText(nestedNameEl).toUpperCase()
                    : '';
                const nestedValue = nestedValueEl ? ixmlElementPlainText(nestedValueEl) : '';
                if (nestedName === 'AUDIOMARKERPOSITION') {
                    position = parseInt(String(nestedValue || '').trim(), 10);
                } else if (nestedName === 'AUDIOMARKERVALUE') {
                    value = Number(String(nestedValue || '').trim());
                }
            }
            if (position > 0 && Number.isFinite(value)) {
                markers.push({ position, value });
            }
        }
        markers.sort((a, b) => a.position - b.position);
        return markers;
    }

    function parseAudioTempiListFromDoc(doc) {
        return parseSteinbergItemListMarkers(parseSteinbergAttrByName(doc, 'AudioTempiList'));
    }

    /** GACAssetStartTime ≒ preRollBars × 4/4 @ preRollBpm（Nuendo 書き出し） */
    function inferPreRollFromGacAssetStartTime(gacStartSec, preRollBpm) {
        const gac = Number(gacStartSec);
        const bpm = Number(preRollBpm);
        if (!(gac > 0.001) || !(bpm > 0)) return null;
        const barDur = (4 * 60) / bpm;
        if (!(barDur > 0)) return null;
        const bars = Math.round(gac / barDur);
        if (bars < 1 || bars > 999) return null;
        if (Math.abs(gac - bars * barDur) > 0.05) return null;
        return { bars, bpm: Math.round(bpm), sig: { num: 4, den: 4 } };
    }

    function inferPreRollFromGacAssetStartTimeAuto(gacStartSec, tempoHint) {
        const candidates = [];
        const hint = Number(tempoHint);
        if (hint > 0) candidates.push(Math.round(hint));
        const defaults = [140, 120, 134, 100, 160, 180, 200];
        for (let i = 0; i < defaults.length; i++) {
            if (candidates.indexOf(defaults[i]) < 0) candidates.push(defaults[i]);
        }
        for (let i = 0; i < candidates.length; i++) {
            const found = inferPreRollFromGacAssetStartTime(gacStartSec, candidates[i]);
            if (found) return found;
        }
        return null;
    }

    function steinbergTempoBpmFromMarkerValue(baseTempo, value) {
        const classified = classifySteinbergAudioMarkerValue(baseTempo, value);
        if (classified && classified.kind === 'tempo') return classified.bpm;
        return null;
    }

    /** AudioTempiList — クリップ先頭（= プロジェクト bar 9 相当）からの 0 始まり拍位置 */
    function buildNuendoClipBeatChanges(data) {
        const baseTempo = data && data.tempo;
        if (!(baseTempo > 0)) return [];
        const baseSig = cloneMeterSig(data.signature || { num: 4, den: 4 });
        const markers = Array.isArray(data.audioTempiMarkers) ? data.audioTempiMarkers : [];
        const changes = [{ beat: 0, bpm: Math.round(baseTempo), sig: cloneMeterSig(baseSig) }];
        for (let i = 0; i < markers.length; i++) {
            const marker = markers[i];
            const beat = marker.position | 0;
            if (beat < 0) continue;
            const bpm = steinbergTempoBpmFromMarkerValue(baseTempo, marker.value);
            if (!(bpm > 0)) continue;
            changes.push({ beat, bpm, sig: null });
        }
        changes.sort((a, b) => a.beat - b.beat);
        const deduped = [];
        for (let i = 0; i < changes.length; i++) {
            const cur = changes[i];
            if (deduped.length && deduped[deduped.length - 1].beat === cur.beat) {
                deduped[deduped.length - 1] = cur;
            } else {
                deduped.push(cur);
            }
        }
        for (let i = 0; i < deduped.length; i++) {
            if (deduped[i].sig) continue;
            const prev = i > 0 ? deduped[i - 1] : null;
            const nextBeat = i + 1 < deduped.length ? deduped[i + 1].beat : null;
            const delta = nextBeat != null ? nextBeat - deduped[i].beat : null;
            deduped[i].sig = inferSteinbergSigForBeatSpan(delta, deduped[i].bpm);
            if (prev && prev.sig == null && nextBeat != null) {
                const prevDelta = deduped[i].beat - prev.beat;
                prev.sig = inferSteinbergSigForBeatSpan(prevDelta, prev.bpm);
            }
        }
        if (deduped.length && !deduped[0].sig) {
            deduped[0].sig = cloneMeterSig(baseSig);
        }
        return deduped;
    }

    function inferSteinbergSigForBeatSpan(beatSpan, bpm) {
        const beats = beatSpan | 0;
        if (beats === 1) return { num: 1, den: 4 };
        if (beats === 2) return { num: 2, den: 4 };
        if (beats === 3) return { num: 3, den: 4 };
        if (beats === 5) return { num: 5, den: 4 };
        if (beats === 6) return { num: 6, den: 4 };
        if (beats === 7) return { num: 7, den: 4 };
        if (beats === 9) return { num: 9, den: 4 };
        // テンポマーカー間の拍数 — 4/4 小節の倍数（24 拍 = 6 小節など）
        return { num: 4, den: 4 };
    }

    function pushBarEntriesForBeatSpan(entries, bpm, sig, beatSpan) {
        let beatsLeft = Math.max(1, beatSpan | 0);
        while (beatsLeft > 0) {
            let barSig;
            if (beatsLeft === 1) barSig = { num: 1, den: 4 };
            else if (beatsLeft === 2) barSig = { num: 2, den: 4 };
            else if (beatsLeft === 3) barSig = { num: 3, den: 4 };
            else if (beatsLeft === 5) barSig = { num: 5, den: 4 };
            else if (beatsLeft === 6) barSig = { num: 6, den: 4 };
            else if (beatsLeft === 7) barSig = { num: 7, den: 4 };
            else if (beatsLeft === 9) barSig = { num: 9, den: 4 };
            else if (sig && sig.num > 0 && sig.num <= beatsLeft) {
                barSig = { num: sig.num, den: sig.den || 4 };
            } else {
                barSig = { num: 4, den: 4 };
            }
            entries.push({ bpm, sig: cloneMeterSig(barSig) });
            beatsLeft -= barSig.num;
        }
    }

    function buildNuendoProjectMeterEntries(data, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!data || !(data.tempo > 0)) return [];
        const clipDurationSec =
            Number(o.clipDurationSec) > 0
                ? Number(o.clipDurationSec)
                : data.gacAssetLength;
        const changes = buildNuendoClipBeatChanges(data);
        if (!changes.length) return [];

        const entries = [];
        const preRoll = inferPreRollFromGacAssetStartTimeAuto(
            data.gacAssetStartTime,
            data.tempo,
        );
        if (preRoll && preRoll.bars > 0) {
            for (let i = 0; i < preRoll.bars; i++) {
                entries.push({
                    bpm: preRoll.bpm,
                    sig: cloneMeterSig(preRoll.sig),
                });
            }
        }

        let clipBeatCursor = 0;
        for (let i = 0; i < changes.length; i++) {
            const cur = changes[i];
            if (
                !o.forRehearsalOnly &&
                clipDurationSec > 0 &&
                entries.length > (preRoll ? preRoll.bars : 0)
            ) {
                let usedSec = 0;
                const clipStartIdx = preRoll ? preRoll.bars : 0;
                for (let ei = clipStartIdx; ei < entries.length; ei++) {
                    usedSec += steinbergMeterEntryBarDuration(entries[ei]);
                }
                if (usedSec >= clipDurationSec - 0.25 && i < changes.length - 1) {
                    break;
                }
            }
            const nextBeat = i + 1 < changes.length ? changes[i + 1].beat : null;
            let span =
                nextBeat != null
                    ? Math.max(1, nextBeat - cur.beat)
                    : estimateRemainingClipBeats(data, changes, clipDurationSec, cur.beat);
            if (nextBeat == null && i === changes.length - 1) {
                span = Math.max(span, 4);
            }
            pushBarEntriesForBeatSpan(entries, cur.bpm, cur.sig, span);
            clipBeatCursor = nextBeat != null ? nextBeat : clipBeatCursor + span;
        }

        if (o.forRehearsalOnly || !(clipDurationSec > 0)) return entries;

        const clipEntriesStart = preRoll ? preRoll.bars : 0;
        while (entries.length > clipEntriesStart + 1) {
            const last = entries[entries.length - 1];
            const lastDur = steinbergMeterEntryBarDuration(last);
            let totalSec = 0;
            for (let i = clipEntriesStart; i < entries.length; i++) {
                totalSec += steinbergMeterEntryBarDuration(entries[i]);
            }
            if (totalSec <= clipDurationSec + 0.05) break;
            entries.pop();
        }

        trimPartialTailBarFromClipDuration(entries, clipEntriesStart, clipDurationSec);
        return entries;
    }

    /** Rehearsal 用 — forRehearsalOnly 構築後にクリップ長だけ合わせる（途中打ち切りはしない） */
    function trimRehearsalMeterEntriesToClipDuration(entries, preRoll, clipDurationSec) {
        if (!Array.isArray(entries) || !entries.length) return entries;
        const clipSec = Number(clipDurationSec);
        if (!(clipSec > 0)) return entries;
        const clipStart = preRoll && preRoll.bars > 0 ? preRoll.bars : 0;
        if (clipStart >= entries.length) return entries;
        while (entries.length > clipStart + 1) {
            let totalSec = 0;
            for (let i = clipStart; i < entries.length; i++) {
                totalSec += steinbergMeterEntryBarDuration(entries[i]);
            }
            if (totalSec <= clipSec + 0.05) break;
            entries.pop();
        }
        trimPartialTailBarFromClipDuration(entries, clipStart, clipSec);
        return entries;
    }

    function estimateRemainingClipBeats(data, changes, clipDurationSec, fromBeat) {
        if (!(clipDurationSec > 0) || !changes.length) return 4;
        const last = changes[changes.length - 1];
        let t = 0;
        let beat = 0;
        for (let i = 0; i < changes.length; i++) {
            const cur = changes[i];
            const nextBeat = i + 1 < changes.length ? changes[i + 1].beat : null;
            if (nextBeat != null && nextBeat <= fromBeat) {
                beat = nextBeat;
                continue;
            }
            const span = nextBeat != null ? nextBeat - cur.beat : 4;
            const entry = { bpm: cur.bpm, sig: cur.sig || { num: 4, den: 4 } };
            for (let b = 0; b < span; b++) {
                if (beat >= fromBeat) {
                    t += steinbergMeterEntryBarDuration(entry);
                    if (t >= clipDurationSec - 0.01) {
                        return Math.max(1, beat - fromBeat + 1);
                    }
                }
                beat += entry.sig.num;
            }
        }
        return Math.max(4, Math.ceil((clipDurationSec / steinbergMeterEntryBarDuration(last)) * 4));
    }

    function trimPartialTailBarFromClipDuration(entries, clipEntriesStart, clipDurationSec) {
        if (!entries.length || clipEntriesStart >= entries.length) return;
        let totalSec = 0;
        for (let i = clipEntriesStart; i < entries.length; i++) {
            totalSec += steinbergMeterEntryBarDuration(entries[i]);
        }
        if (totalSec <= clipDurationSec + 0.05) return;
        while (entries.length > clipEntriesStart + 1) {
            const lastDur = steinbergMeterEntryBarDuration(entries[entries.length - 1]);
            if (totalSec - lastDur >= clipDurationSec - 0.05) {
                totalSec -= lastDur;
                entries.pop();
            } else {
                break;
            }
        }
    }

    function nearestSteinbergSignatureRatio(value) {
        const v = Number(value);
        if (!Number.isFinite(v) || v <= 0) return null;
        let best = null;
        let bestErr = Infinity;
        const dens = [2, 4, 8, 16];
        for (let di = 0; di < dens.length; di++) {
            const den = dens[di];
            for (let num = 1; num <= 16; num++) {
                const ratio = num / den;
                const err = Math.abs(ratio - v);
                if (err < bestErr) {
                    bestErr = err;
                    best = { num, den };
                }
            }
        }
        return bestErr <= 0.002 ? best : null;
    }

    function classifySteinbergAudioMarkerValue(baseTempo, value) {
        const v = Number(value);
        const tempo = Number(baseTempo);
        if (!Number.isFinite(v) || !Number.isFinite(tempo) || tempo <= 0) return null;
        const bpmRaw = tempo * v;
        const bpmRounded = Math.round(bpmRaw);
        const tempoMatch =
            Math.abs(bpmRaw - bpmRounded) < 0.02 &&
            bpmRounded >= 30 &&
            bpmRounded <= 400;
        const sigMatch = nearestSteinbergSignatureRatio(v);
        if (tempoMatch) {
            return { kind: 'tempo', bpm: bpmRounded };
        }
        if (sigMatch) {
            return { kind: 'signature', sig: sigMatch };
        }
        if (Number.isFinite(bpmRaw) && bpmRaw > 0) {
            return { kind: 'tempo', bpm: Math.max(1, Math.min(999, Math.round(bpmRaw))) };
        }
        return null;
    }

    function steinbergMeterEntryBarDuration(entry) {
        if (
            typeof meterBarDurationSec === 'function' &&
            entry &&
            entry.bpm > 0 &&
            entry.sig
        ) {
            return meterBarDurationSec(entry);
        }
        const sig = entry && entry.sig ? entry.sig : { num: 4, den: 4 };
        const bpm = entry && entry.bpm > 0 ? entry.bpm : 120;
        return (sig.num * (4 / sig.den) * 60) / bpm;
    }

    function meterEntryTokenKey(entry) {
        if (!entry || !entry.sig) return '';
        const sig = entry.sig;
        if (sig.alternates && sig.alternates.length) {
            return (
                entry.bpm +
                ':' +
                sig.alternates.map((a) => a.num + '/' + a.den).join('+')
            );
        }
        return entry.bpm + '-' + sig.num + '/' + sig.den;
    }

    function rehearsalBarCountsFromSequenceMeterEntries(entries, preRollBars) {
        if (!Array.isArray(entries) || !entries.length) return null;
        const preRoll = Math.max(0, preRollBars | 0);
        if (preRoll > 0 && preRoll < entries.length) {
            const headCounts = rehearsalBarCountsFromSequenceMeterEntries(
                entries.slice(0, preRoll),
            );
            const tailCounts = rehearsalBarCountsFromSequenceMeterEntries(
                entries.slice(preRoll),
            );
            if (!headCounts || !tailCounts) return null;
            return headCounts.concat(tailCounts);
        }
        const counts = [];
        let i = 0;
        while (i < entries.length) {
            const key = meterEntryTokenKey(entries[i]);
            let run = 1;
            while (i + run < entries.length && meterEntryTokenKey(entries[i + run]) === key) {
                run += 1;
            }
            counts.push(run);
            i += run;
        }
        return counts.length ? counts : null;
    }

    function parseNuendoTimeSignature(raw) {
        const s = String(raw || '').trim();
        if (!s) return null;
        const slash = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
        if (slash) {
            return (
                parseSteinbergMusicalSignaturePair(slash[1], slash[2]) || {
                    num: parseInt(slash[1], 10),
                    den: parseInt(slash[2], 10),
                }
            );
        }
        const semi = /^(\d+)\s*;\s*(\d+)$/.exec(s);
        if (semi) {
            const num = parseInt(semi[1], 10);
            const den = parseInt(semi[2], 10);
            if (num > 0 && num <= 32 && den > 0 && den <= 32) return { num, den };
        }
        if (typeof DOMParser === 'function' && s.indexOf('<') >= 0) {
            try {
                const inner = new DOMParser().parseFromString(s, 'application/xml');
                if (!inner.getElementsByTagName('parsererror').length) {
                    const numEl =
                        inner.getElementsByTagName('SignatureNumerator')[0] ||
                        inner.getElementsByTagName('Numerator')[0] ||
                        inner.getElementsByTagName('Beats')[0];
                    const denEl =
                        inner.getElementsByTagName('SignatureDenominator')[0] ||
                        inner.getElementsByTagName('Denominator')[0] ||
                        inner.getElementsByTagName('BeatType')[0];
                    const num = numEl ? parseInt(ixmlElementPlainText(numEl), 10) : NaN;
                    const den = denEl ? parseInt(ixmlElementPlainText(denEl), 10) : NaN;
                    if (num > 0 && den > 0) return { num, den };
                }
            } catch (_) {}
        }
        return null;
    }

    function parseSteinbergMusicalDataFromIxmlXml(xmlText) {
        const raw = String(xmlText || '').trim();
        if (!raw || typeof DOMParser !== 'function') return null;
        let doc;
        try {
            doc = new DOMParser().parseFromString(raw, 'application/xml');
        } catch (_) {
            return null;
        }
        if (doc.getElementsByTagName('parsererror').length) return null;

        const attrs = parseSteinbergAttrMapFromIxmlDoc(doc);
        const tempoRaw =
            attrs.MusicalTempo ||
            attrs.MusicalUpTempo ||
            attrs.musical_tempo ||
            attrs.musicalTempo;
        const tempo = Number(String(tempoRaw || '').trim());
        const signature = parseNuendoTimeSignature(
            attrs.MusicalSignature || attrs.musical_signature || attrs.musicalSignature,
        );
        const upbeat = Number(String(attrs.MusicalUpbeat || attrs.musical_upbeat || '').trim());
        const gacAssetLength = Number(
            String(attrs.GACAssetLength || attrs.gacAssetLength || '').trim(),
        );
        const gacAssetStartTime = Number(
            String(attrs.GACAssetStartTime || attrs.gacAssetStartTime || '').trim(),
        );

        return {
            attrs,
            tempo: Number.isFinite(tempo) && tempo > 0 ? tempo : null,
            signature: signature || { num: 4, den: 4 },
            upbeatSec: Number.isFinite(upbeat) && upbeat >= 0 ? upbeat : null,
            audioRegionList: attrs.AudioRegionList || attrs.audioRegionList || '',
            audioTempiMarkers: parseAudioTempiListFromDoc(doc),
            gacAssetLength: Number.isFinite(gacAssetLength) && gacAssetLength > 0 ? gacAssetLength : null,
            gacAssetStartTime:
                Number.isFinite(gacAssetStartTime) && gacAssetStartTime >= 0
                    ? gacAssetStartTime
                    : null,
            project:
                ixmlElementPlainText(doc.getElementsByTagName('PROJECT')[0]) ||
                attrs.Project ||
                '',
        };
    }

    /** 先頭リージョン手前の無音尺 — GAC PreRoll 小節（なければ GACAssetStartTime / MusicalUpbeat） */
    function resolveIxmlGridLeadPadSec(data) {
        if (!data) return 0;
        const preRoll = inferPreRollFromGacAssetStartTimeAuto(
            data.gacAssetStartTime,
            data.tempo,
        );
        if (preRoll && preRoll.bars > 0) {
            const entry = { bpm: preRoll.bpm, sig: preRoll.sig };
            let sec = 0;
            for (let i = 0; i < preRoll.bars; i++) {
                sec += steinbergMeterEntryBarDuration(entry);
            }
            if (sec > 0.001) return sec;
        }
        const attrs = data.attrs || {};
        const gac = Number(String(attrs.GACAssetStartTime || attrs.gacAssetStartTime || '').trim());
        if (Number.isFinite(gac) && gac > 0.001) return gac;
        if (data.upbeatSec != null && data.upbeatSec > 0.001) return data.upbeatSec;
        return 0;
    }

    /** ファイル内ソース同期 — AudioSyncpoint（なければ MusicalUpbeat） */
    function resolveIxmlSourceSyncOffsetSec(data, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!data) return 0;
        const attrs = data.attrs || {};
        const sampleRate = Number(o.sampleRate) || 0;
        const syncRaw =
            attrs.AudioSyncpoint ||
            attrs.AudioSyncPoint ||
            attrs.audioSyncpoint ||
            attrs.audioSyncPoint;
        const syncSamples = parseInt(String(syncRaw || '').trim(), 10);
        if (syncSamples > 0 && sampleRate > 0) {
            return syncSamples / sampleRate;
        }
        if (data.upbeatSec != null && data.upbeatSec >= 0) return data.upbeatSec;
        return 0;
    }

    function formatSteinbergMeterEntryToken(entry) {
        if (!entry || !entry.sig) return '';
        const bpm =
            Math.abs(entry.bpm - Math.round(entry.bpm)) < 1e-9
                ? Math.round(entry.bpm)
                : entry.bpm;
        const sig = entry.sig;
        if (sig.alternates && sig.alternates.length) {
            const parts = sig.alternates.map((a) => a.num + '/' + a.den);
            const delim = sig.alternates.length > 1 && sig.alternates[0].repeat ? ':' : '+';
            return bpm + '-' + parts.join(delim);
        }
        return bpm + '-' + sig.num + '/' + sig.den;
    }

    function buildMeterTextFromSteinbergMusicalData(data, opt) {
        if (!data || !data.tempo) return null;
        if (Array.isArray(data.audioTempiMarkers) && data.audioTempiMarkers.length) {
            const entries = buildNuendoProjectMeterEntries(data, opt);
            if (entries.length) {
                return entries.map((e) => formatSteinbergMeterEntryToken(e)).join(',');
            }
        }
        const bpm = Math.round(data.tempo);
        if (!(bpm > 0 && bpm <= 999)) return null;
        const sig = data.signature || { num: 4, den: 4 };
        return bpm + '-' + sig.num + '/' + sig.den;
    }

    function rehearsalBarCountsFromRangeMarkers(markers, meterText) {
        if (
            typeof parseMeterSpec !== 'function' ||
            typeof getMeterEntryForBar !== 'function' ||
            typeof meterBarDurationSec !== 'function'
        ) {
            return null;
        }
        const meterSpec = parseMeterSpec(meterText);
        if (!meterSpec) return null;
        const entry0 = getMeterEntryForBar(meterSpec, 0);
        if (!entry0) return null;
        const barDur = meterBarDurationSec(entry0);
        if (!(barDur > 0)) return null;

        const ranges = (Array.isArray(markers) ? markers : [])
            .filter((m) => m && m.type === 'range')
            .slice()
            .sort((a, b) => (Number(a.startSec) || 0) - (Number(b.startSec) || 0));
        if (!ranges.length) return null;

        const counts = [];
        for (let i = 0; i < ranges.length; i++) {
            const dur = Math.max(0, Number(ranges[i].endSec) - Number(ranges[i].startSec));
            if (!(dur > 0)) continue;
            counts.push(Math.max(1, Math.round(dur / barDur)));
        }
        return counts.length ? counts : null;
    }

    /** 末尾 1 小節が PreRoll と同じ Tempo/Sig のみ — 23 小節目以降の Tempo 復帰など Rehearsal 境界にしない */
    function trimEchoPreRollRehearsalTail(counts, entries, preRoll) {
        if (!preRoll || !Array.isArray(counts) || counts.length < 2) return counts;
        if (!Array.isArray(entries) || !entries.length) return counts;
        if ((counts[counts.length - 1] | 0) !== 1) return counts;
        const preRollKey = meterEntryTokenKey({
            bpm: preRoll.bpm,
            sig: preRoll.sig || { num: 4, den: 4 },
        });
        const lastKey = meterEntryTokenKey(entries[entries.length - 1]);
        if (preRollKey && lastKey === preRollKey) {
            return counts.slice(0, -1);
        }
        return counts;
    }

    function rehearsalBarCountsFromNuendoTempoMap(data, opt) {
        if (!data || !(data.tempo > 0)) return null;
        if (!Array.isArray(data.audioTempiMarkers) || !data.audioTempiMarkers.length) {
            return null;
        }
        const preRoll = inferPreRollFromGacAssetStartTimeAuto(
            data.gacAssetStartTime,
            data.tempo,
        );
        const clipDurationSec =
            opt && Number(opt.clipDurationSec) > 0
                ? Number(opt.clipDurationSec)
                : data.gacAssetLength;
        const rehearsalOpt =
            opt && typeof opt === 'object'
                ? Object.assign({}, opt, { forRehearsalOnly: true })
                : { forRehearsalOnly: true };
        let entries = buildNuendoProjectMeterEntries(data, rehearsalOpt);
        entries = trimRehearsalMeterEntriesToClipDuration(
            entries,
            preRoll,
            clipDurationSec,
        );
        if (!entries.length) return null;
        let counts = rehearsalBarCountsFromSequenceMeterEntries(
            entries,
            preRoll && preRoll.bars > 0 ? preRoll.bars : 0,
        );
        if (!counts || !counts.length) return null;
        counts = trimEchoPreRollRehearsalTail(counts, entries, preRoll);
        return counts && counts.length ? counts : null;
    }

    function readSteinbergItemAttrValue(itemEl, attrName) {
        const itemAttrList = ixmlFirstChildElementByTag(itemEl, ['ATTR_LIST']);
        if (!itemAttrList) return null;
        const want = String(attrName || '').toUpperCase();
        for (let j = 0; j < itemAttrList.childNodes.length; j++) {
            const nestedAttr = itemAttrList.childNodes[j];
            if (
                !nestedAttr ||
                nestedAttr.nodeType !== Node.ELEMENT_NODE ||
                String(nestedAttr.tagName || '').toUpperCase() !== 'ATTR'
            ) {
                continue;
            }
            const nestedNameEl = ixmlFirstChildElementByTag(nestedAttr, ['NAME']);
            if (!nestedNameEl) continue;
            if (String(ixmlElementPlainText(nestedNameEl) || '').toUpperCase() !== want) {
                continue;
            }
            const nestedValueEl = ixmlFirstChildElementByTag(nestedAttr, ['VALUE']);
            return nestedValueEl ? ixmlElementPlainText(nestedValueEl) : null;
        }
        return null;
    }

    function rehearsalBarCountsFromRegionDurationSecs(durationsSec, meterText, clipBarOffset) {
        if (
            typeof parseMeterSpec !== 'function' ||
            typeof getMeterEntryForBar !== 'function' ||
            typeof meterBarDurationSec !== 'function'
        ) {
            return null;
        }
        const meterSpec = parseMeterSpec(meterText);
        if (!meterSpec) return null;
        const durations = Array.isArray(durationsSec) ? durationsSec : [];
        if (!durations.length) return null;

        let barIndex = Math.max(0, clipBarOffset | 0);
        const counts = [];
        for (let i = 0; i < durations.length; i++) {
            let timeLeft = Math.max(0, Number(durations[i]) || 0);
            if (!(timeLeft > 1e-6)) continue;
            let barsInGroup = 0;
            while (timeLeft > 1e-6) {
                const entry = getMeterEntryForBar(meterSpec, barIndex);
                if (!entry) break;
                const barDur = meterBarDurationSec(entry);
                if (!(barDur > 1e-6)) break;
                barsInGroup += 1;
                timeLeft -= barDur;
                barIndex += 1;
            }
            if (barsInGroup > 0) counts.push(barsInGroup);
        }
        return counts.length ? counts : null;
    }

    /** Nuendo AudioRegionList — ITEM / AudioMarkerStart+End（End は次 ITEM 手前までの長さ[samples]） */
    function rehearsalBarCountsFromSteinbergItemRegionList(regionListRaw, meterText, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const sampleRate = Number(o.sampleRate) || 0;
        if (!(sampleRate > 0)) return null;
        const raw = String(regionListRaw || '').trim();
        if (!raw || raw.indexOf('<') < 0 || typeof DOMParser !== 'function') return null;
        if (raw.indexOf('<ITEM') < 0) return null;

        let doc;
        try {
            doc = new DOMParser().parseFromString('<ROOT>' + raw + '</ROOT>', 'application/xml');
        } catch (_) {
            return null;
        }
        if (doc.getElementsByTagName('parsererror').length) return null;

        const items = doc.getElementsByTagName('ITEM');
        if (!items || !items.length) return null;

        const parsed = [];
        for (let i = 0; i < items.length; i++) {
            const startSamples = Number(readSteinbergItemAttrValue(items[i], 'AudioMarkerStart'));
            const endSamples = Number(readSteinbergItemAttrValue(items[i], 'AudioMarkerEnd'));
            if (!Number.isFinite(startSamples) || !(startSamples >= 0)) continue;
            if (!Number.isFinite(endSamples) || !(endSamples > 0)) continue;
            parsed.push({ startSamples, endSamples });
        }
        if (!parsed.length) return null;
        parsed.sort((a, b) => a.startSamples - b.startSamples);

        const durationsSec = [];
        for (let i = 0; i < parsed.length; i++) {
            const cur = parsed[i];
            const next = i + 1 < parsed.length ? parsed[i + 1] : null;
            let lenSamples;
            if (
                next &&
                Math.abs(cur.startSamples + cur.endSamples - next.startSamples) < 1
            ) {
                lenSamples = cur.endSamples;
            } else if (cur.endSamples > cur.startSamples) {
                lenSamples = cur.endSamples - cur.startSamples;
            } else {
                lenSamples = cur.endSamples;
            }
            if (lenSamples > 0) durationsSec.push(lenSamples / sampleRate);
        }
        if (!durationsSec.length) return null;

        const preRoll = inferPreRollFromGacAssetStartTimeAuto(
            o.gacAssetStartTime,
            o.tempo,
        );
        const clipBarOffset = preRoll && preRoll.bars > 0 ? preRoll.bars : 0;
        const clipCounts = rehearsalBarCountsFromRegionDurationSecs(
            durationsSec,
            meterText,
            clipBarOffset,
        );
        if (!clipCounts || !clipCounts.length) return null;
        if (clipBarOffset > 0) return [clipBarOffset].concat(clipCounts);
        return clipCounts;
    }

    function rehearsalBarCountsFromAudioRegionListXml(regionListRaw, meterText, opt) {
        const steinbergCounts = rehearsalBarCountsFromSteinbergItemRegionList(
            regionListRaw,
            meterText,
            opt,
        );
        if (steinbergCounts && steinbergCounts.length) return steinbergCounts;

        const raw = String(regionListRaw || '').trim();
        if (!raw || raw.indexOf('<') < 0 || typeof DOMParser !== 'function') return null;
        if (
            typeof parseMeterSpec !== 'function' ||
            typeof getMeterEntryForBar !== 'function' ||
            typeof meterBarDurationSec !== 'function'
        ) {
            return null;
        }
        const meterSpec = parseMeterSpec(meterText);
        if (!meterSpec) return null;
        const entry0 = getMeterEntryForBar(meterSpec, 0);
        if (!entry0) return null;
        const barDur = meterBarDurationSec(entry0);
        if (!(barDur > 0)) return null;

        let doc;
        try {
            doc = new DOMParser().parseFromString(raw, 'application/xml');
        } catch (_) {
            return null;
        }
        if (doc.getElementsByTagName('parsererror').length) return null;

        const regionTags = [
            'AudioRegion',
            'Region',
            'Cycle',
            'Marker',
            'Entry',
        ];
        let regionEls = [];
        for (let t = 0; t < regionTags.length; t++) {
            const found = doc.getElementsByTagName(regionTags[t]);
            if (found && found.length) {
                regionEls = Array.from(found);
                break;
            }
        }
        if (!regionEls.length) return null;

        const counts = [];
        for (let i = 0; i < regionEls.length; i++) {
            const el = regionEls[i];
            const barsRaw =
                ixmlElementPlainText(
                    ixmlFirstChildElementByTag(el, [
                        'Bars',
                        'BarCount',
                        'LengthBars',
                        'MusicalBars',
                    ]),
                ) ||
                el.getAttribute('bars') ||
                el.getAttribute('barCount');
            let bars = parseInt(String(barsRaw || '').trim(), 10);
            if (!(bars > 0)) {
                const lenSec = Number(
                    ixmlElementPlainText(
                        ixmlFirstChildElementByTag(el, [
                            'Length',
                            'Duration',
                            'LengthSeconds',
                            'MusicalLength',
                        ]),
                    ) ||
                        el.getAttribute('length') ||
                        el.getAttribute('duration'),
                );
                if (Number.isFinite(lenSec) && lenSec > 0) {
                    bars = Math.max(1, Math.round(lenSec / barDur));
                }
            }
            if (bars > 0) counts.push(bars);
        }
        return counts.length ? counts : null;
    }

    function resolveRehearsalFromIxmlAndMarkers(data, meterText, opt) {
        const rehearsalOpt =
            opt && typeof opt === 'object'
                ? Object.assign({}, opt, {
                      gacAssetStartTime: data && data.gacAssetStartTime,
                      tempo: data && data.tempo,
                  })
                : {
                      gacAssetStartTime: data && data.gacAssetStartTime,
                      tempo: data && data.tempo,
                  };
        let counts = rehearsalBarCountsFromNuendoTempoMap(data, opt);
        let source = counts && counts.length ? 'ixml-audioTempiList' : null;
        if (!counts) {
            counts = rehearsalBarCountsFromAudioRegionListXml(
                data && data.audioRegionList,
                meterText,
                rehearsalOpt,
            );
            if (counts && counts.length) source = 'ixml-audioRegionList';
        }
        if (
            !counts &&
            opt &&
            Array.isArray(opt.waveMarkersForRehearsal) &&
            opt.waveMarkersForRehearsal.length
        ) {
            counts = rehearsalBarCountsFromRangeMarkers(opt.waveMarkersForRehearsal, meterText);
            if (counts && counts.length) source = 'wav-regions';
        }
        if (!counts && typeof getMarkersSnapshot === 'function') {
            counts = rehearsalBarCountsFromRangeMarkers(getMarkersSnapshot(), meterText);
            if (counts && counts.length) source = 'wav-regions';
        }
        if (!counts || !counts.length) return null;
        let rehearsalText = counts.join(',');
        if (typeof formatRehearsalTextFromGroupBarCounts === 'function') {
            rehearsalText = formatRehearsalTextFromGroupBarCounts(counts, { optimize: true });
        }
        return {
            rehearsalText: rehearsalText || counts.join(','),
            rehearsalGroupBarCounts: counts,
            source: source || 'unknown',
        };
    }

    /** iXML MusicalUpbeat — 第 1 リージョン手前に無音ギャップ（グリッド原点＝region In） */
    function applyMusicalUpbeatToTrackRegion(track, upbeatSec) {
        const upbeat = Number(upbeatSec);
        if (!(upbeat > 0.001)) return false;
        if (typeof getPlaybackRegionsState !== 'function') return false;
        const state = getPlaybackRegionsState(track);
        if (!state || !Array.isArray(state.segments) || !state.segments.length) {
            return false;
        }
        const t0 =
            typeof getTrackTimelineStartSec === 'function'
                ? getTrackTimelineStartSec(track)
                : 0;
        const seg0 = state.segments[0];
        if (!seg0) return false;
        const anchor = t0 + upbeat;
        seg0.timelineStartSec = anchor;
        state.regionTimelineInSec = t0;
        state.regionLeadPadSec = upbeat;
        state.headPadSec = upbeat;
        if (typeof bumpRegionPersistEpoch === 'function' && track && track.slot >= 0) {
            bumpRegionPersistEpoch(track.slot);
        }
        return true;
    }

    /** WAV マーカー取り込み用 — ファイル秒 → タイムライン秒（再生開始基準） */
    function importedMarkerTimelineOffsetSec(track, clipId) {
        if (typeof getTrackSegments !== 'function') return 0;
        const segs = getTrackSegments(track);
        for (let si = 0; si < segs.length; si++) {
            const seg = segs[si];
            if (clipId && seg.clipId && seg.clipId !== clipId) continue;
            const sourceIn = Number(seg.sourceInSec) || 0;
            if (
                typeof getSegmentRegionTimelineIn === 'function' &&
                typeof getSegmentTimelineStart === 'function'
            ) {
                const regionIn = getSegmentRegionTimelineIn(track, si);
                const anchor = getSegmentTimelineStart(track, si);
                let playbackStart;
                if (regionIn > anchor + 0.00001) {
                    playbackStart = regionIn;
                } else if (si === 0 && typeof getPlaybackRegionsState === 'function') {
                    const state = getPlaybackRegionsState(track);
                    const lead = Math.max(0, Number(state && state.regionLeadPadSec) || 0);
                    playbackStart = lead > 0.00001 ? regionIn + lead : anchor;
                } else {
                    playbackStart = anchor;
                }
                if (Number.isFinite(playbackStart)) {
                    return playbackStart - sourceIn;
                }
            }
            const timelineIn = Number.isFinite(seg.timelineStartSec) ? seg.timelineStartSec : 0;
            return timelineIn - sourceIn;
        }
        return 0;
    }

    /** iXML のグリッド先頭オフセットをリージョン In / lead pad / 再生開始位置へ反映（Rehearsal 分割は行わない） */
    function applyIxmlRegionStartToExtraTrack(slot, data, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!Number.isFinite(slot) || slot < 0) return false;
        const track = { type: 'extra', slot: slot | 0 };
        const gridLeadPadSec = resolveIxmlGridLeadPadSec(data);
        const sourceTimeOffsetSec = resolveIxmlSourceSyncOffsetSec(data, {
            sampleRate: o.sampleRate,
        });
        if (gridLeadPadSec <= 0.001 && sourceTimeOffsetSec <= 0.001) return false;

        if (
            typeof isTrackRegionActive === 'function' &&
            !isTrackRegionActive(track) &&
            typeof ensureDefaultTrackRegion === 'function'
        ) {
            ensureDefaultTrackRegion(track, { skipOverlay: true, silent: true });
        }
        if (
            typeof getTrackSegments !== 'function' ||
            typeof getPlaybackRegionsState !== 'function' ||
            typeof getTrackSourceDurationSec !== 'function'
        ) {
            return false;
        }
        const existing = getTrackSegments(track);
        if (!existing.length) return false;
        const fullClipDur = getTrackSourceDurationSec(track);
        if (!(fullClipDur > 0.001)) return false;

        const t0 =
            typeof getTrackTimelineStartSec === 'function' ? getTrackTimelineStartSec(track) : 0;
        const placementSec = t0;
        const clipId =
            existing[0] && existing[0].clipId
                ? existing[0].clipId
                : typeof getDefaultExtraClipId === 'function'
                  ? getDefaultExtraClipId(slot | 0)
                  : 'main';
        const regId =
            typeof newRegionId === 'function'
                ? newRegionId
                : function fallbackRegionId() {
                      return (
                          'reg-' +
                          Date.now().toString(36) +
                          '-' +
                          Math.random().toString(36).slice(2, 9)
                      );
                  };

        let nextSegments = null;
        if (gridLeadPadSec > 0.001) {
            nextSegments = [
                {
                    id: regId(),
                    clipId: clipId,
                    sourceInSec: 0,
                    sourceOutSec: fullClipDur,
                    timelineStartSec: placementSec + gridLeadPadSec,
                    regionTimelineInSec: placementSec,
                    regionLeadPadSec: gridLeadPadSec,
                },
            ];
        } else if (sourceTimeOffsetSec > 0.001) {
            nextSegments = [
                {
                    id: existing[0].id || regId(),
                    clipId: clipId,
                    sourceInSec: 0,
                    sourceOutSec: fullClipDur,
                    timelineStartSec: placementSec + sourceTimeOffsetSec,
                    regionTimelineInSec: placementSec,
                },
            ];
        }
        if (!nextSegments || !nextSegments.length) return false;

        let applied = false;
        if (typeof window.setTrackSegments === 'function') {
            applied = window.setTrackSegments(track, nextSegments, {
                silent: true,
                skipUndo: true,
                segmentStructureChanged: nextSegments.length !== existing.length,
            });
        } else if (typeof applySegmentsToState === 'function') {
            applied = applySegmentsToState(track, nextSegments, {
                silent: true,
                skipUndo: true,
                segmentStructureChanged: nextSegments.length !== existing.length,
            });
        } else {
            const state = getPlaybackRegionsState(track);
            if (!state) return false;
            state.segments = nextSegments;
            state.active = true;
            state.headPadSec = Math.max(0, placementSec - t0);
            state.regionTimelineInSec = Math.max(0, placementSec);
            if (gridLeadPadSec > 0.001) {
                state.regionLeadPadSec = gridLeadPadSec;
            } else {
                delete state.regionLeadPadSec;
            }
            applied = true;
        }

        if (!applied) return false;

        if (typeof bumpRegionPersistEpoch === 'function') {
            bumpRegionPersistEpoch(slot | 0);
        }
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        if (typeof updateTrackRegionOverlays === 'function') {
            updateTrackRegionOverlays(track);
        } else if (typeof redrawAfterRegionChange === 'function') {
            redrawAfterRegionChange(slot | 0, {
                segmentStructureChanged: nextSegments.length !== existing.length,
            });
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        return true;
    }

    function applyMusicalGridFromParsedIxml(xmlText, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.fromSessionRestore || o.skipMusicalGridImport) return false;
        if (typeof applyMusicalGridPersistSnapshot !== 'function') return false;

        const data = parseSteinbergMusicalDataFromIxmlXml(xmlText);
        const meterText = buildMeterTextFromSteinbergMusicalData(data, o);
        if (!meterText) return false;

        const rehearsal = resolveRehearsalFromIxmlAndMarkers(data, meterText, o);
        if (typeof importMeterSpecFromText === 'function') {
            importMeterSpecFromText(meterText);
        } else if (typeof setMusicalGridMeterText === 'function') {
            setMusicalGridMeterText(meterText);
        }
        const snap = {};
        if (rehearsal && rehearsal.rehearsalText) {
            snap.rehearsal = rehearsal.rehearsalText;
            if (rehearsal.rehearsalGroupBarCounts && rehearsal.rehearsalGroupBarCounts.length) {
                snap.rehearsalGroupBarCounts = rehearsal.rehearsalGroupBarCounts;
            }
        }

        applyMusicalGridPersistSnapshot(snap);
        if (typeof setTimelineMusicalSampleRate === 'function' && Number(o.sampleRate) > 0) {
            setTimelineMusicalSampleRate(o.sampleRate);
        }
        if (typeof setMusicalGridVisible === 'function') {
            setMusicalGridVisible(true, { silent: true });
        }
        if (typeof scheduleMusicalGridRedraw === 'function') {
            scheduleMusicalGridRedraw();
        }

        const leadPadSec = resolveIxmlGridLeadPadSec(data);
        const sourceOffsetSec = resolveIxmlSourceSyncOffsetSec(data, { sampleRate: o.sampleRate });
        if (Number.isFinite(o.slot)) {
            applyIxmlRegionStartToExtraTrack(o.slot, data, o);
        }

        if (typeof writeLog === 'function') {
            const label = o.logLabel ? o.logLabel + ': ' : '';
            let msg = label + 'Tempo/Sig from iXML → ' + meterText;
            if (rehearsal && rehearsal.rehearsalText) {
                msg += ', Rehearsal → ' + rehearsal.rehearsalText;
                if (rehearsal.source === 'wav-regions') {
                    msg += ' (from WAV cycle regions)';
                } else if (rehearsal.source === 'ixml-audioTempiList') {
                    msg += ' (from iXML tempo map)';
                }
            } else if (data && data.upbeatSec != null) {
                msg += ' (Rehearsal: no region data)';
            }
            writeLog(msg);
            if (leadPadSec > 0.001 || sourceOffsetSec > 0.001) {
                let padMsg =
                    label +
                    'iXML grid lead pad ' +
                    leadPadSec.toFixed(6) +
                    ' s';
                if (sourceOffsetSec > 0.001 && Math.abs(sourceOffsetSec - leadPadSec) > 0.0005) {
                    padMsg += ', source sync ' + sourceOffsetSec.toFixed(6) + ' s';
                }
                writeLog(padMsg);
            }
        }
        return true;
    }

    window.parseSteinbergMusicalDataFromIxmlXml = parseSteinbergMusicalDataFromIxmlXml;
    window.buildMeterTextFromSteinbergMusicalData = buildMeterTextFromSteinbergMusicalData;
    window.applyMusicalUpbeatToTrackRegion = applyMusicalUpbeatToTrackRegion;
    window.importedMarkerTimelineOffsetSec = importedMarkerTimelineOffsetSec;
    window.applyMusicalGridFromParsedIxml = applyMusicalGridFromParsedIxml;
})();
