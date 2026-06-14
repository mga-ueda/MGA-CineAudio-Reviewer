/**
 * musical-grid-phrase.js — Phrase 定義・ラベル・小節展開
 */
    function collectBarBoundarySecs(meterSpec, durationSec) {
        const boundaries = [];
        if (!(durationSec > 0) || !meterSpec) return boundaries;
        let t = 0;
        let barIndex = 0;
        while (t < durationSec - 1e-9) {
            boundaries.push(t);
            const entry = getMeterEntryForBar(meterSpec, barIndex);
            if (!entry) break;
            t = Math.min(durationSec, t + meterBarDurationSec(entry));
            barIndex += 1;
        }
        if (!boundaries.length || boundaries[boundaries.length - 1] < durationSec - 1e-9) {
            boundaries.push(durationSec);
        }
        return boundaries;
    }

    /** Ex トラックにテンポストレッチ済みバッファがあるか */
    function isAnyExtraTrackTempoStretched() {
        const n =
            typeof EXTRA_TRACK_COUNT !== 'undefined' ? EXTRA_TRACK_COUNT : 0;
        for (let slot = 0; slot < n; slot++) {
            if (
                typeof isExtraTrackTempoStretched === 'function' &&
                isExtraTrackTempoStretched(slot)
            ) {
                return true;
            }
        }
        return false;
    }

    function currentTempoStretchPlaybackRate() {
        if (
            typeof parseMeterSpec !== 'function' ||
            typeof getCommittedMusicalGridMeterText !== 'function' ||
            typeof computeTempoStretchRateFromSpec !== 'function'
        ) {
            return 1;
        }
        const spec = parseMeterSpec(getCommittedMusicalGridMeterText());
        if (!spec) return 1;
        return computeTempoStretchRateFromSpec(spec);
    }

    /**
     * 波形ストレッチ後 — 小節境界は「接頭辞なし BPM × 比例スケール」と Ex リージョンを一致させる。
     * （接頭辞付き BPM で master 全体を再分割すると sequence meter で ~0.5s ずれる）
     */
    function collectPlaybackAlignedBarBoundarySecs(meterSpec, durationSec) {
        if (!isAnyExtraTrackTempoStretched()) {
            return collectBarBoundarySecs(meterSpec, durationSec);
        }
        const rate = currentTempoStretchPlaybackRate();
        if (!(rate > 0) || Math.abs(rate - 1) <= 0.00001) {
            return collectBarBoundarySecs(meterSpec, durationSec);
        }
        const specBaseline = Object.assign({}, meterSpec, { stretchDelta: 0 });
        const unstretchedDur = durationSec * rate;
        const raw = collectBarBoundarySecs(specBaseline, unstretchedDur);
        const scale = 1 / rate;
        const boundaries = [];
        for (let i = 0; i < raw.length; i++) {
            boundaries.push(Math.min(durationSec, raw[i] * scale));
        }
        if (
            !boundaries.length ||
            boundaries[boundaries.length - 1] < durationSec - 1e-9
        ) {
            boundaries.push(durationSec);
        }
        return boundaries;
    }

    /** 末尾の未完サイクル（例: 1,8,4,8 + 1 bar）を最終グループへ吸収する */
    function mergePartialPhraseCycleTail(counts, sizes) {
        if (!counts || !sizes || !sizes.length || counts.length <= sizes.length) {
            return counts;
        }
        const cycleLen = sizes.length;
        const remainder = counts.length % cycleLen;
        if (remainder === 0) return counts;
        const tailStart = counts.length - remainder;
        const mergeTarget = tailStart - 1;
        if (mergeTarget < 0) return counts;
        let tailBars = 0;
        for (let i = tailStart; i < counts.length; i++) {
            tailBars += counts[i] | 0;
        }
        const merged = counts.slice(0, tailStart);
        merged[mergeTarget] = (merged[mergeTarget] | 0) + tailBars;
        return merged;
    }

    /** phraseSpec から各 Phrase グループの小節数列を展開する。 */
    function expandPhraseSpecToGroupBarCounts(meterSpec, durationSec, phraseSpec) {
        const boundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(meterSpec, durationSec)
                : collectBarBoundarySecs(meterSpec, durationSec);
        const totalBars = Math.max(0, boundaries.length - 1);
        if (!totalBars || !phraseSpec || !phraseSpec.sizes) return [];
        const sizes = phraseSpec.sizes;
        const counts = [];
        let groupIndex = 0;
        let barsInGroup = 0;
        for (let bar = 0; bar < totalBars; bar++) {
            if (barsInGroup === 0) counts.push(0);
            counts[counts.length - 1] += 1;
            barsInGroup += 1;
            const groupSize = barGroupSizeForIndex(groupIndex, sizes);
            if (barsInGroup >= groupSize) {
                groupIndex += 1;
                barsInGroup = 0;
            }
        }
        return mergePartialPhraseCycleTail(counts, sizes);
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
    function resolveCurrentExpandedPhraseGroupBarCounts() {
        readMusicalGridFromInputs();
        if (phraseBoundaryDragCounts && phraseBoundaryDragCounts.length) {
            return phraseBoundaryDragCounts.slice();
        }
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return [];
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return [];
        return resolvePhraseGroupBarCounts(
            settings.meterSpec,
            master,
            settings.phraseSpec,
        );
    }
    /** 展開 counts から Phrase 欄テキストを最短表現へ圧縮（確定時・セーブ前）。 */
    function compressPhraseDefinitionFromExpandedCounts(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const counts = resolveCurrentExpandedPhraseGroupBarCounts();
        if (!counts.length) return false;
        const before = musicalGridPhraseText;
        applyExplicitPhraseGroupBarCounts(counts, {
            skipUndo: !!o.skipUndo,
            preservePhraseText: false,
            optimize: true,
        });
        if (typeof writeLog === 'function' && before !== musicalGridPhraseText) {
            writeLog('Phrase: compressed ' + before + ' -> ' + musicalGridPhraseText);
        }
        return before !== musicalGridPhraseText;
    }
    function applyExplicitPhraseGroupBarCounts(counts, opt) {
        if (!counts || !counts.length) return;
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!o.skipUndo) requestPhraseUndoCapture();
        if (o.preservePhraseText) {
            setPhraseGroupBarCountsOverride(counts);
        } else {
            clearPhraseGroupBarCountsOverride();
            const text = formatPhraseTextFromGroupBarCounts(counts, {
                optimize: o.optimize !== false,
            });
            musicalGridPhraseText = normalizeMusicalGridPhraseText(text);
            if (musicalGridPhraseInput) {
                musicalGridPhraseInput.value = musicalGridPhraseText;
            }
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
        const boundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(settings.meterSpec, master)
                : collectBarBoundarySecs(settings.meterSpec, master);
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
        persistPhraseWaveformEditAndRedraw({ skipUndo: true });
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
    /** Phrase 欄 1 サイクル内の sizes[lo]↔sizes[hi] を交換し grid 全体を再展開（RegionSwap 用）。 */
