/**
 * ixml-musical-import.js — Nuendo/Cubase iXML から Tempo/Sig・Phrase を構築。
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

    function parseSteinbergAttrMapFromIxmlDoc(doc) {
        const attrs = Object.create(null);
        if (!doc) return attrs;
        const attrEls = doc.getElementsByTagName('ATTR');
        for (let i = 0; i < attrEls.length; i++) {
            const attrEl = attrEls[i];
            const nameEl = ixmlFirstChildElementByTag(attrEl, ['NAME']);
            if (!nameEl) continue;
            const name = ixmlElementPlainText(nameEl);
            if (!name) continue;
            const valueEl = ixmlFirstChildElementByTag(attrEl, ['VALUE']);
            const value = valueEl ? ixmlElementInnerXml(valueEl) : ixmlElementPlainText(attrEl);
            attrs[name] = value;
        }
        return attrs;
    }

    function parseNuendoTimeSignature(raw) {
        const s = String(raw || '').trim();
        if (!s) return null;
        const slash = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
        if (slash) {
            const num = parseInt(slash[1], 10);
            const den = parseInt(slash[2], 10);
            if (num > 0 && num <= 32 && den > 0 && den <= 32) return { num, den };
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

        return {
            attrs,
            tempo: Number.isFinite(tempo) && tempo > 0 ? tempo : null,
            signature: signature || { num: 4, den: 4 },
            upbeatSec: Number.isFinite(upbeat) && upbeat >= 0 ? upbeat : null,
            audioRegionList: attrs.AudioRegionList || attrs.audioRegionList || '',
            project:
                ixmlElementPlainText(doc.getElementsByTagName('PROJECT')[0]) ||
                attrs.Project ||
                '',
        };
    }

    /** 冒頭無音リージョン — Nuendo GACAssetStartTime（なければ MusicalUpbeat） */
    function resolveIxmlGridLeadPadSec(data) {
        if (!data) return 0;
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

    function buildMeterTextFromSteinbergMusicalData(data) {
        if (!data || !data.tempo) return null;
        const bpm = Math.round(data.tempo);
        if (!(bpm > 0 && bpm <= 999)) return null;
        const sig = data.signature || { num: 4, den: 4 };
        return bpm + '-' + sig.num + '/' + sig.den;
    }

    function phraseBarCountsFromRangeMarkers(markers, meterText) {
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

    function phraseBarCountsFromAudioRegionListXml(regionListRaw, meterText) {
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

    function resolvePhraseFromIxmlAndMarkers(data, meterText, opt) {
        let counts = phraseBarCountsFromAudioRegionListXml(
            data && data.audioRegionList,
            meterText,
        );
        let source = counts && counts.length ? 'ixml-audioRegionList' : null;
        if (
            !counts &&
            opt &&
            Array.isArray(opt.waveMarkersForPhrase) &&
            opt.waveMarkersForPhrase.length
        ) {
            counts = phraseBarCountsFromRangeMarkers(opt.waveMarkersForPhrase, meterText);
            if (counts && counts.length) source = 'wav-regions';
        }
        if (!counts && typeof getMarkersSnapshot === 'function') {
            counts = phraseBarCountsFromRangeMarkers(getMarkersSnapshot(), meterText);
            if (counts && counts.length) source = 'wav-regions';
        }
        if (!counts || !counts.length) return null;
        let phraseText = counts.join(',');
        if (typeof formatPhraseTextFromGroupBarCounts === 'function') {
            phraseText = formatPhraseTextFromGroupBarCounts(counts, { optimize: true });
        }
        return {
            phraseText: phraseText || counts.join(','),
            phraseGroupBarCounts: counts,
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

    function relayoutExtraTrackRegionsFromIxmlPhrase(slot, layoutOpt, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const lo = layoutOpt && typeof layoutOpt === 'object' ? layoutOpt : {};
        if (typeof window.applyPhraseCompositionToAllExtraTrackRegions !== 'function') {
            return 0;
        }
        const leadPadSec = Math.max(0, Number(lo.leadPadSec) || 0);
        const sourceOffsetSec = Math.max(0, Number(lo.sourceOffsetSec) || 0);
        let phraseFillWasOff = false;
        if (
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            !getMusicalGridPhraseFillVisible() &&
            typeof setMusicalGridPhraseFillVisible === 'function'
        ) {
            phraseFillWasOff = true;
            setMusicalGridPhraseFillVisible(true, { silent: true, skipRegionRefresh: true });
        }
        if (typeof clearMusicalGridPositionCache === 'function') {
            clearMusicalGridPositionCache();
        }
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        const rebuilt = window.applyPhraseCompositionToAllExtraTrackRegions({
            mapSourceFromBarRanges: true,
            gridLeadPadSec: leadPadSec > 0.001 ? leadPadSec : 0,
            sourceTimeOffsetSec: sourceOffsetSec > 0.001 ? sourceOffsetSec : 0,
            preservePhraseBarCountsOverride: true,
            forceLayout: true,
            onlySlot: Number.isFinite(slot) ? slot : undefined,
            silent: true,
            skipUndo: true,
        });
        if (
            phraseFillWasOff &&
            !o.keepPhraseFillOn &&
            typeof setMusicalGridPhraseFillVisible === 'function'
        ) {
            setMusicalGridPhraseFillVisible(false, { silent: true, skipRegionRefresh: true });
        }
        return rebuilt;
    }

    function applyMusicalGridFromParsedIxml(xmlText, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.fromSessionRestore || o.skipMusicalGridImport) return false;
        if (typeof applyMusicalGridPersistSnapshot !== 'function') return false;

        const data = parseSteinbergMusicalDataFromIxmlXml(xmlText);
        const meterText = buildMeterTextFromSteinbergMusicalData(data);
        if (!meterText) return false;

        const phrase = resolvePhraseFromIxmlAndMarkers(data, meterText, o);
        const snap = { meter: meterText };
        if (phrase && phrase.phraseText) {
            snap.phrase = phrase.phraseText;
            if (phrase.phraseGroupBarCounts && phrase.phraseGroupBarCounts.length) {
                snap.phraseGroupBarCounts = phrase.phraseGroupBarCounts;
            }
        }

        applyMusicalGridPersistSnapshot(snap);
        if (typeof setMusicalGridVisible === 'function') {
            setMusicalGridVisible(true, { silent: true, persist: true });
        } else if (typeof writePrefs === 'function') {
            writePrefs();
        }
        if (typeof scheduleMusicalGridRedraw === 'function') {
            scheduleMusicalGridRedraw();
        }

        const leadPadSec = resolveIxmlGridLeadPadSec(data);
        const sourceOffsetSec = resolveIxmlSourceSyncOffsetSec(data, { sampleRate: o.sampleRate });
        let regionsRelaid = 0;
        if (
            phrase &&
            phrase.phraseGroupBarCounts &&
            phrase.phraseGroupBarCounts.length &&
            o.relayoutRegions !== false
        ) {
            regionsRelaid = relayoutExtraTrackRegionsFromIxmlPhrase(
                o.slot,
                { leadPadSec: leadPadSec, sourceOffsetSec: sourceOffsetSec },
                o,
            );
        }

        if (
            leadPadSec > 0.001 &&
            regionsRelaid > 0 &&
            typeof setRehearsalMarkOffsetEnabled === 'function'
        ) {
            setRehearsalMarkOffsetEnabled(true, { silent: true });
        }

        if (typeof writeLog === 'function') {
            const label = o.logLabel ? o.logLabel + ': ' : '';
            let msg = label + 'Tempo/Sig from iXML → ' + meterText;
            if (phrase && phrase.phraseText) {
                msg += ', Phrase → ' + phrase.phraseText;
                if (phrase.source === 'wav-regions') {
                    msg += ' (from WAV cycle regions)';
                }
            } else if (data && data.upbeatSec != null) {
                msg += ' (Phrase: no region data)';
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
            if (leadPadSec > 0.001 && regionsRelaid > 0) {
                writeLog(label + 'R. Offset enabled (upbeat lead region)');
            }
            if (regionsRelaid > 0) {
                writeLog(
                    label +
                        'Phrase regions relaid (' +
                        regionsRelaid +
                        ' track(s))',
                );
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
