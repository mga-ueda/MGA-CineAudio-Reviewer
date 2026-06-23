/**
 * musical-grid-rehearsal.js — Rehearsal 定義・ラベル・小節展開
 */
    let timelineMusicalSampleRateHint = 0;

    function setTimelineMusicalSampleRate(rate) {
        const r = Number(rate) | 0;
        timelineMusicalSampleRateHint = r > 0 ? r : 0;
    }

    /** WAV マーカー import と同じ sampleRate（読込時 set / 未設定時は Ex バッファ） */
    function resolveTimelineMusicalSampleRate() {
        if (timelineMusicalSampleRateHint > 0) return timelineMusicalSampleRateHint;
        const n =
            typeof EXTRA_TRACK_COUNT !== 'undefined' ? EXTRA_TRACK_COUNT : 0;
        for (let slot = 0; slot < n; slot++) {
            if (
                typeof extraTrackBySlot !== 'function' ||
                typeof getExtraTrackClipBuffer !== 'function'
            ) {
                continue;
            }
            const tr = extraTrackBySlot(slot);
            if (!tr) continue;
            const buf = getExtraTrackClipBuffer(tr, 'main');
            if (buf && buf.sampleRate > 0) return buf.sampleRate | 0;
        }
        return 0;
    }

    /** 拍ごとに sample 累積 → 小節頭を sample 境界へ（WAV cue の round(sample) と揃える） */
    function collectSampleAccurateBarBoundarySecs(meterSpec, durationSec, sampleRate) {
        const sr = Number(sampleRate) | 0;
        const boundaries = [];
        if (!(durationSec > 0) || !meterSpec || !(sr > 0)) return boundaries;
        let totalSamples = 0;
        boundaries.push(0);
        let barIndex = 0;
        const maxBars = 200000;
        while (totalSamples / sr < durationSec - 1e-9 && barIndex < maxBars) {
            const entry = getMeterEntryForBar(meterSpec, barIndex);
            if (!entry) break;
            let barSamples = 0;
            if (typeof forEachMeterBarBeat === 'function') {
                forEachMeterBarBeat(0, entry, (beat) => {
                    barSamples += Math.round(beat.beatDur * sr);
                });
            } else {
                barSamples = Math.round(meterBarDurationSec(entry) * sr);
            }
            if (barSamples <= 0) break;
            totalSamples += barSamples;
            boundaries.push(Math.min(durationSec, totalSamples / sr));
            barIndex += 1;
        }
        if (!boundaries.length || boundaries[boundaries.length - 1] < durationSec - 1e-9) {
            boundaries.push(durationSec);
        }
        return boundaries;
    }

    function collectBarBoundarySecs(meterSpec, durationSec) {
        const sr =
            typeof isAnyExtraTrackTempoStretched === 'function' &&
            isAnyExtraTrackTempoStretched()
                ? 0
                : resolveTimelineMusicalSampleRate();
        if (sr > 0) {
            return collectSampleAccurateBarBoundarySecs(meterSpec, durationSec, sr);
        }
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

    /** Rehearsal 欄が 3 項以上の明示グループ列のとき、その小節数合計（例: 8,3,1,…,2 → 22） */
    function minimumBarCountFromExplicitRehearsalSpec(rehearsalSpec) {
        if (!rehearsalSpec || !rehearsalSpec.sizes || rehearsalSpec.sizes.length < 3) return 0;
        let sum = 0;
        for (let i = 0; i < rehearsalSpec.sizes.length; i++) {
            const n = rehearsalSpec.sizes[i] | 0;
            if (n > 0) sum += n;
        }
        return sum;
    }

    /** meterSpec 上で barCount 小節ぶんの秒（小節 0 起点） */
    function durationSecForBarCount(meterSpec, barCount) {
        const n = barCount | 0;
        if (!(n > 0) || !meterSpec) return 0;
        let t = 0;
        for (let barIndex = 0; barIndex < n; barIndex++) {
            const entry = getMeterEntryForBar(meterSpec, barIndex);
            if (!entry) break;
            t += meterBarDurationSec(entry);
        }
        return t;
    }

    /**
     * Rehearsal 展開・着色・リージョン再配置用のタイムライン尺。
     * クリップ長 < 明示 Rehearsal 全小節（GAC 先頭無音など）のとき、後半グループが切れないよう延長する。
     */
    function resolveRehearsalLayoutDurationSec(meterSpec, durationSec, rehearsalSpec) {
        const master = Number(durationSec);
        if (!Number.isFinite(master) || !(master > 0) || !meterSpec) {
            return Number.isFinite(master) && master > 0 ? master : 0;
        }
        const minBars = minimumBarCountFromExplicitRehearsalSpec(rehearsalSpec);
        if (!(minBars > 0)) return master;
        let gridDur = durationSecForBarCount(meterSpec, minBars);
        if (!(gridDur > master + 1e-9)) return master;
        if (
            typeof isAnyExtraTrackTempoStretched === 'function' &&
            isAnyExtraTrackTempoStretched() &&
            typeof currentTempoStretchPlaybackRate === 'function'
        ) {
            const rate = currentTempoStretchPlaybackRate();
            if (rate > 0 && Math.abs(rate - 1) > 0.00001) {
                gridDur /= rate;
            }
        }
        return gridDur;
    }

    /** 末尾の未完サイクル（例: 1,8,4,8 + 1 bar）を最終グループへ吸収する */
    function mergePartialRehearsalCycleTail(counts, sizes) {
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

    /** rehearsalSpec から各 Rehearsal グループの小節数列を展開する。 */
    function expandRehearsalSpecToGroupBarCounts(meterSpec, durationSec, rehearsalSpec) {
        const effectiveDuration = resolveRehearsalLayoutDurationSec(
            meterSpec,
            durationSec,
            rehearsalSpec,
        );
        const boundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(meterSpec, effectiveDuration)
                : collectBarBoundarySecs(meterSpec, effectiveDuration);
        const totalBars = Math.max(0, boundaries.length - 1);
        if (!totalBars || !rehearsalSpec || !rehearsalSpec.sizes) return [];
        const sizes = rehearsalSpec.sizes;
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
        return mergePartialRehearsalCycleTail(counts, sizes);
    }
    function groupBarCountsMatchRehearsalSizes(counts, sizes) {
        if (!counts || !counts.length || !sizes || !sizes.length) return false;
        for (let i = 0; i < counts.length; i++) {
            if (barGroupSizeForIndex(i, sizes) !== counts[i]) return false;
        }
        return true;
    }
    /** barGroupSizeForIndex の逆算: 指定長の Rehearsal 候補を counts から構成する。 */
    function candidateRehearsalSizesForLength(counts, len) {
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
    /** 展開済みグループ小節数列から、同等の Rehearsal 指定を最短表現へ圧縮する。 */
    function inferMinimalRehearsalSizesFromGroupBarCounts(counts) {
        if (!counts || !counts.length) return [];
        for (let len = 1; len <= counts.length; len++) {
            const candidate = candidateRehearsalSizesForLength(counts, len);
            if (candidate && groupBarCountsMatchRehearsalSizes(counts, candidate)) {
                return candidate;
            }
        }
        return counts.slice();
    }
    function formatRehearsalTextFromGroupBarCounts(counts, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!counts || !counts.length) return '';
        const sizes =
            o.optimize === false ? counts.slice() : inferMinimalRehearsalSizesFromGroupBarCounts(counts);
        if (!sizes.length) return '';
        return sizes.join(',');
    }
    function rehearsalGroupCountsEqual(a, b) {
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
    function countsForRehearsalBoundaryAtBarIndex(startCounts, boundaryIndex, targetBarK) {
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
    function targetBarKForRehearsalBoundaryDrag(
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
    function applyRehearsalBoundaryDragPreview(counts) {
        const prevLen = rehearsalBoundaryDragCounts ? rehearsalBoundaryDragCounts.length : 0;
        rehearsalBoundaryDragCounts = counts.slice();
        drawMusicalGridOverlay();
        if (prevLen !== counts.length) {
            updateRehearsalBoundaryOverlay();
        } else {
            repositionRehearsalBoundaryHandlesFromSnapshot();
        }
    }
    function resolveCurrentExpandedRehearsalGroupBarCounts() {
        readMusicalGridFromInputs();
        if (rehearsalBoundaryDragCounts && rehearsalBoundaryDragCounts.length) {
            return rehearsalBoundaryDragCounts.slice();
        }
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return [];
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return [];
        return resolveRehearsalGroupBarCounts(
            settings.meterSpec,
            master,
            settings.rehearsalSpec,
        );
    }
    /** 展開 counts から Rehearsal 欄テキストを最短表現へ圧縮（確定時・セーブ前）。 */
    function compressRehearsalDefinitionFromExpandedCounts(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const counts = resolveCurrentExpandedRehearsalGroupBarCounts();
        if (!counts.length) return false;
        const before = musicalGridRehearsalText;
        applyExplicitRehearsalGroupBarCounts(counts, {
            skipUndo: !!o.skipUndo,
            preserveRehearsalText: false,
            optimize: true,
        });
        if (typeof writeLog === 'function' && before !== musicalGridRehearsalText) {
            writeLog('Rehearsal: compressed ' + before + ' -> ' + musicalGridRehearsalText);
        }
        return before !== musicalGridRehearsalText;
    }
    function applyExplicitRehearsalGroupBarCounts(counts, opt) {
        if (!counts || !counts.length) return;
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!o.skipUndo) requestRehearsalUndoCapture();
        if (o.preserveRehearsalText) {
            setRehearsalGroupBarCountsOverride(counts);
        } else {
            const text = formatRehearsalTextFromGroupBarCounts(counts, {
                optimize: o.optimize !== false,
            });
            musicalGridRehearsalText = normalizeMusicalGridRehearsalText(text);
            // Rehearsal spec は "1,4,8" 等に圧縮されても、着色は展開 counts（例: 1,4,8,8）に合わせる
            setRehearsalGroupBarCountsOverride(counts);
        }
        clearMusicalGridPositionCache();
    }
    /** 小節 index k（その小節の開始＝小節線）で Rehearsal グループを 2 分割。境界上は null。 */
    function splitRehearsalGroupAtBarIndex(counts, barIndex) {
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
     * transport 秒が小節線（各小節の開始）に近いとき、その bar index で Rehearsal 分割候補を返す。
     * @param {object} [opt]
     * @param {boolean} [opt.nearestBarLine] true なら閾値に関係なく最寄りの小節線（シークバー用）
     * @returns {{ barIndex: number, barSec: number, counts: number[] }|{ barIndex: number, invalid: true }|null}
     */
    function resolveMusicalGridBarLineRehearsalSplitAtTransportSec(transportSec, opt) {
        if (!getMusicalGridVisible()) return null;
        const o = opt && typeof opt === 'object' ? opt : {};
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.rehearsalSpec) return null;
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
        const counts = expandRehearsalSpecToGroupBarCounts(
            settings.meterSpec,
            master,
            settings.rehearsalSpec,
        );
        if (!counts.length) return null;
        const nextCounts = splitRehearsalGroupAtBarIndex(counts, bestK);
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
    function resolveRehearsalEditTransportSec() {
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
    function resolveRehearsalJoinTargetSec() {
        if (isWaveformPointerInsideLanes()) {
            const transportSec = waveformPointerTransportSec();
            if (transportSec == null) return null;
            return { transportSec, useSeekbar: false };
        }
        const transportSec = seekbarTransportSec();
        if (transportSec == null) return null;
        return { transportSec, useSeekbar: true };
    }
    function snapSecToRehearsalBoundaryStops(sec, threshold) {
        const s = Number(sec);
        if (!Number.isFinite(s)) return sec;
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.rehearsalSpec) return sec;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return sec;
        const counts = expandRehearsalSpecToGroupBarCounts(
            settings.meterSpec,
            master,
            settings.rehearsalSpec,
        );
        if (counts.length < 2) return sec;
        const ranges = collectRehearsalGroupRangesFromBarCounts(
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
    function splitRehearsalAtWaveformPointer() {
        if (!getMusicalGridVisible()) return false;
        if (rehearsalBoundaryDragActive) return false;
        const target = resolveRehearsalEditTransportSec();
        if (!target) return false;
        const { transportSec, useSeekbar } = target;
        const hit = resolveMusicalGridBarLineRehearsalSplitAtTransportSec(transportSec, {
            nearestBarLine: useSeekbar,
        });
        if (!hit) return false;
        const barLabel = String((hit.barIndex | 0) + 1);
        if (hit.invalid) {
            if (typeof writeLog === 'function') {
                writeLog(
                    'Rehearsal: already at boundary (bar ' +
                        barLabel +
                        (useSeekbar ? ', seekbar' : '') +
                        ')',
                );
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Rehearsal', "Can't split here", 'error');
            }
            return true;
        }
        applyExplicitRehearsalGroupBarCounts(hit.counts);
        persistRehearsalWaveformEditAndRedraw({ skipUndo: true });
        if (typeof writeLog === 'function') {
            writeLog(
                'Rehearsal split at bar ' +
                    barLabel +
                    (useSeekbar ? ' (seekbar)' : '') +
                    ': ' +
                    musicalGridRehearsalText,
            );
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(
                'Rehearsal',
                'Split at bar ' + barLabel + (useSeekbar ? ' (seekbar)' : ''),
                'notice',
            );
        }
        return true;
    }
    function handleMusicalGridRehearsalSplitKeydown(e) {
        if (!matchUserShortcut(e, 'regionSplit')) return false;
        if (e.repeat) return false;
        if (!getMusicalGridVisible()) return false;
        splitRehearsalAtWaveformPointer();
        e.preventDefault();
        e.stopPropagation();
        return true;
    }
    function resolveRehearsalGroupIndexAtTransportSec(transportSec) {
        if (!getMusicalGridRehearsalFillVisible()) return null;
        const ranges = getRehearsalGroupRangesSnapshot();
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
