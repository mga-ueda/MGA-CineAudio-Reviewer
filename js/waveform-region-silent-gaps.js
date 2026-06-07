/**
 * waveform-region-silent-gaps.js — 無音 gap 収集・選択・メタデータ
 */
    /** タイムライン上で隣接する無音区間を 1 つにまとめる（phrase 境界での分割表示を防ぐ） */
    function mergeAdjacentSilentGapIntervals(gaps, eps) {
        if (!gaps || gaps.length <= 1) return gaps ? gaps.slice() : [];
        const out = [];
        let cur = {
            startSec: gaps[0].startSec,
            endSec: gaps[0].endSec,
            phraseIndex: gaps[0].phraseIndex,
            partial: !!gaps[0].partial,
        };
        for (let i = 1; i < gaps.length; i++) {
            const g = gaps[i];
            if (!g || !Number.isFinite(g.startSec) || !Number.isFinite(g.endSec)) continue;
            if (g.startSec <= cur.endSec + eps) {
                cur.endSec = Math.max(cur.endSec, g.endSec);
                cur.partial = !!(cur.partial || g.partial);
            } else {
                out.push(cur);
                cur = {
                    startSec: g.startSec,
                    endSec: g.endSec,
                    phraseIndex: g.phraseIndex,
                    partial: !!g.partial,
                };
            }
        }
        out.push(cur);
        return refreshSilentGapPhraseMetadata(out);
    }

    /** 無音 gap の phraseIndex / phraseBarCount — 重なり最大の Phrase スロット基準 */
    function refreshSilentGapPhraseMetadata(gaps) {
        if (!gaps || !gaps.length) return gaps ? gaps.slice() : [];
        const counts = expandedPhraseGroupBarCountsSnapshot();
        const ranges = phraseSlotRangesSnapshot();
        if (!ranges.length) return gaps;
        for (let i = 0; i < gaps.length; i++) {
            const gap = gaps[i];
            let bestIdx = null;
            let bestOverlap = -1;
            for (let pi = 0; pi < ranges.length; pi++) {
                const r = ranges[pi];
                if (!r) continue;
                const lo = Math.max(gap.startSec, r.startSec);
                const hi = Math.min(gap.endSec, r.endSec);
                const overlap = hi - lo;
                if (overlap > bestOverlap) {
                    bestOverlap = overlap;
                    bestIdx = pi;
                }
            }
            if (bestIdx != null && bestIdx >= 0) {
                gap.phraseIndex = bestIdx;
                const spanBars = estimateSilentGapBarSpan(gap);
                if (spanBars > 0) {
                    gap.phraseBarCount = spanBars;
                } else if (counts.length && bestIdx < counts.length) {
                    gap.phraseBarCount = counts[bestIdx] | 0;
                }
            }
        }
        return gaps;
    }

    /** 境界誤差レベルの微小無音（例: 41.247–41.250s）を除外 */
    function filterNegligibleSilentGaps(gaps, eps) {
        if (!gaps.length) return gaps;
        const counts = expandedPhraseGroupBarCountsSnapshot();
        const ranges = phraseSlotRangesSnapshot();
        return gaps.filter((gap) => {
            const dur = gap.endSec - gap.startSec;
            if (!(dur > eps * 4)) return false;
            const pi = Number.isFinite(gap.phraseIndex) ? gap.phraseIndex | 0 : -1;
            if (pi >= 0 && ranges[pi] && counts[pi] > 0) {
                const slotDur = ranges[pi].endSec - ranges[pi].startSec;
                const bars = counts[pi] | 0;
                if (slotDur > 0 && bars > 0 && dur < (slotDur / bars) * 0.25) {
                    return false;
                }
            }
            return true;
        });
    }

    /**
     * フレーズ先頭に置かれたリージョンより後ろの trailing 無音を除外する。
     * 非対称 swap 後に phrase 枠内へリージョン＋無音が二重に見えるのを防ぐ。
     */
    function suppressTrailingSilentGapsAfterPhraseAnchoredRegions(track, gaps, eps) {
        if (!gaps.length) return gaps;
        const ranges = phraseSlotRangesSnapshot();
        if (!ranges.length) return gaps;
        const segments = getTrackSegments(track);
        const anchoredOut = new Map();
        for (let si = 0; si < segments.length; si++) {
            const regionIn = getSegmentRegionTimelineIn(track, si);
            const pi = phraseSlotIndexAtRegionInSec(regionIn);
            if (pi == null || pi < 0) continue;
            const r = ranges[pi];
            if (!r || !Number.isFinite(r.startSec)) continue;
            if (Math.abs(regionIn - r.startSec) <= eps * 4) {
                const regionOut = getSegmentRegionTimelineOut(track, si);
                const prev = anchoredOut.get(pi);
                if (prev == null || regionOut > prev) anchoredOut.set(pi, regionOut);
            }
        }
        if (!anchoredOut.size) return gaps;
        return gaps.filter((gap) => {
            const pi = Number.isFinite(gap.phraseIndex) ? gap.phraseIndex | 0 : -1;
            if (pi < 0) return true;
            const regionOut = anchoredOut.get(pi);
            if (regionOut == null) return true;
            const r = ranges[pi];
            if (!r) return true;
            if (
                gap.startSec >= regionOut - eps &&
                gap.endSec <= r.endSec + eps
            ) {
                return false;
            }
            return true;
        });
    }

    /** セグメント Region In が属する最大 Phrase スロット */
    function lastPhraseSlotIndexForSegmentLeaders(track) {
        let maxIdx = -1;
        const segments = getTrackSegments(track);
        for (let si = 0; si < segments.length; si++) {
            const pi = phraseSlotIndexForSegment(track, si);
            if (pi != null && pi >= 0) maxIdx = Math.max(maxIdx, pi);
        }
        return maxIdx;
    }

    function attachSilentGapNeighborIndices(gaps, track, eps) {
        if (!track || !isExtraTrackRef(track) || !gaps.length) return;
        const segments = getTrackSegments(track);
        for (let i = 0; i < gaps.length; i++) {
            const gap = gaps[i];
            let afterIndex = -1;
            let beforeIndex = -1;
            for (let si = 0; si < segments.length; si++) {
                const leftEnd = getSegmentRegionTimelineOut(track, si);
                if (leftEnd <= gap.startSec + eps) afterIndex = si;
                const rightStart = getSegmentRegionTimelineIn(track, si);
                if (rightStart >= gap.endSec - eps && beforeIndex < 0) beforeIndex = si;
            }
            if (afterIndex >= 0) gap.afterSegmentIndex = afterIndex;
            if (beforeIndex >= 0) gap.beforeSegmentIndex = beforeIndex;
        }
    }

    /**
     * フレーズモード: 各 Phrase スロットからリージョンのタイムライン占有を引いた無音区間。
     * Region In だけがスロット内にあっても、クリック位置が音源 span 外なら選択可能。
     */
    function collectPhraseModeUncoveredSilentIntervals(track, eps) {
        if (typeof getPhraseGroupRangesSnapshot !== 'function') return [];
        const ranges = getPhraseGroupRangesSnapshot();
        if (!ranges.length) return [];
        const segments = getTrackSegments(track);
        const gaps = [];

        for (let pi = 0; pi < ranges.length; pi++) {
            const r = ranges[pi];
            if (!r || !(r.endSec - r.startSec > eps)) continue;
            const covers = [];
            for (let si = 0; si < segments.length; si++) {
                const a = getSegmentRegionTimelineIn(track, si);
                const b = getSegmentRegionTimelineOut(track, si);
                const lo = Math.max(r.startSec, a);
                const hi = Math.min(r.endSec, b);
                if (hi - lo > eps) {
                    covers.push({ startSec: lo, endSec: hi });
                }
            }
            const merged = mergeTimelineCoverageIntervals(covers, eps);
            const uncovered = subtractTimelineCoverage(r.startSec, r.endSec, merged, eps);
            for (let u = 0; u < uncovered.length; u++) {
                const part = uncovered[u];
                if (!(part.endSec - part.startSec > eps)) continue;
                gaps.push({
                    startSec: part.startSec,
                    endSec: part.endSec,
                    phraseIndex: pi,
                    partial: merged.length > 0,
                });
            }
        }

        gaps.sort((a, b) => a.startSec - b.startSec);
        let mergedGaps = mergeAdjacentSilentGapIntervals(gaps, eps);
        mergedGaps = suppressTrailingSilentGapsAfterPhraseAnchoredRegions(track, mergedGaps, eps);
        mergedGaps = filterNegligibleSilentGaps(mergedGaps, eps);
        mergedGaps = refreshSilentGapPhraseMetadata(mergedGaps);
        attachSilentGapNeighborIndices(mergedGaps, track, eps);
        return mergedGaps;
    }

    /** タイムライン上の無音隙間（非フレーズ: セグメント間／フレーズ: 1 スロット = 1 リージョン） */
    function collectTrackSilentGaps(track) {
        const segments = getTrackSegments(track);
        if (!segments.length) return [];
        const eps = segmentBoundaryJoinEpsilonSec();

        const phraseMode =
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible();

        if (phraseMode) {
            return collectPhraseModeUncoveredSilentIntervals(track, eps);
        }

        const t0 = getTrackTimelineStartSec(track);
        const gaps = [];

        const firstIn = getSegmentRegionTimelineIn(track, 0);
        if (firstIn > t0 + eps) {
            gaps.push({
                startSec: t0,
                endSec: firstIn,
                beforeSegmentIndex: 0,
                afterSegmentIndex: -1,
            });
        }

        for (let i = 0; i < segments.length - 1; i++) {
            const leftEnd = getSegmentRegionTimelineOut(track, i);
            const rightStart = getSegmentRegionTimelineIn(track, i + 1);
            if (rightStart - leftEnd > eps) {
                gaps.push({
                    startSec: leftEnd,
                    endSec: rightStart,
                    afterSegmentIndex: i,
                    beforeSegmentIndex: i + 1,
                });
            }
        }

        attachSilentGapNeighborIndices(gaps, track, eps);
        return gaps;
    }

    /** transport 秒が属する無音隙間の collectTrackSilentGaps 内 index。該当なしは -1。 */
    function resolveSilentGapListIndexAtTransport(track, transportSec) {
        if (!Number.isFinite(transportSec)) return -1;
        const gaps = collectTrackSilentGaps(track);
        const eps = segmentBoundaryJoinEpsilonSec();
        for (let g = 0; g < gaps.length; g++) {
            const gap = gaps[g];
            if (
                transportSec >= gap.startSec - eps &&
                transportSec < gap.endSec - eps
            ) {
                return g;
            }
        }
        return -1;
    }

    function extraSlotFromPointerY(clientY) {
        if (!Number.isFinite(clientY)) return -1;
        if (typeof window.waveformExtraLaneSlotFromClientY === 'function') {
            const slot = window.waveformExtraLaneSlotFromClientY(clientY);
            if (slot >= 0) return slot;
        }
        if (typeof window.extraLaneSlotFromClientY === 'function') {
            return window.extraLaneSlotFromClientY(clientY);
        }
        return -1;
    }

    function transportSecFromPointerX(clientX) {
        if (!Number.isFinite(clientX)) return null;
        if (typeof window.transportSecFromClientX === 'function') {
            return window.transportSecFromClientX(clientX);
        }
        return null;
    }

    function summarizeSilentGapsForDiag(track) {
        const gaps = collectTrackSilentGaps(track);
        return gaps.map((gap, i) => ({
            listIndex: i,
            phraseSlot: Number.isFinite(gap.phraseIndex) ? (gap.phraseIndex | 0) + 1 : null,
            partial: !!gap.partial,
            start: regionSwapDiagFmtSec(gap.startSec),
            end: regionSwapDiagFmtSec(gap.endSec),
        }));
    }

    /** Ctrl+クリック時の無音選択診断（[MusicalSlot] select/silent-gap/*） */
    function explainSilentGapSelectionAtPointer(clientX, clientY) {
        const slot = extraSlotFromPointerY(clientY);
        if (slot < 0) {
            return { ok: false, reason: 'no-extra-lane', clientX, clientY };
        }
        const track = { type: 'extra', slot };
        const transportSec = transportSecFromPointerX(clientX);
        if (!Number.isFinite(transportSec)) {
            return { ok: false, reason: 'transport-unresolved', ex: slot + 1, clientX, clientY };
        }
        const gapIndex = resolveSilentGapListIndexAtTransport(track, transportSec);
        const gaps = collectTrackSilentGaps(track);
        const phraseExpanded = phraseSlotIndexAtTransportSec(transportSec);
        const ranges = phraseSlotRangesSnapshot();
        const phraseRange =
            phraseExpanded != null && ranges[phraseExpanded | 0]
                ? ranges[phraseExpanded | 0]
                : null;
        const anchored =
            phraseExpanded != null &&
            isPhraseSlotWithoutAnchoredRegion(track, phraseExpanded | 0, ranges) === false;
        let regionUnderSpan = null;
        const segments = getTrackSegments(track);
        const eps = segmentBoundaryJoinEpsilonSec();
        for (let si = 0; si < segments.length; si++) {
            const start = getSegmentRegionTimelineIn(track, si);
            const end = getSegmentRegionTimelineOut(track, si);
            if (transportSec >= start - eps && transportSec < end - eps) {
                regionUnderSpan = si + 1;
                break;
            }
        }
        if (gapIndex >= 0) {
            const gap = gaps[gapIndex];
            return {
                ok: true,
                ex: slot + 1,
                transportSec: regionSwapDiagFmtSec(transportSec),
                gapIndex,
                phraseSlot: gap && Number.isFinite(gap.phraseIndex) ? (gap.phraseIndex | 0) + 1 : null,
                partial: !!(gap && gap.partial),
                regionUnderSpan,
                phraseExpanded: phraseExpanded != null ? phraseExpanded + 1 : null,
            };
        }
        let reason = 'transport-outside-silent-gaps';
        if (phraseExpanded == null) reason = 'phrase-slot-unresolved';
        else if (!phraseRange) reason = 'phrase-range-missing';
        else if (regionUnderSpan != null) reason = 'under-region-span';
        else if (anchored) reason = 'phrase-slot-has-region-in';
        else reason = 'phrase-empty-not-listed';
        return {
            ok: false,
            reason,
            ex: slot + 1,
            transportSec: regionSwapDiagFmtSec(transportSec),
            phraseExpanded: phraseExpanded != null ? phraseExpanded + 1 : null,
            phraseRange: phraseRange
                ? {
                      start: regionSwapDiagFmtSec(phraseRange.startSec),
                      end: regionSwapDiagFmtSec(phraseRange.endSec),
                  }
                : null,
            regionUnderSpan,
            silentGaps: summarizeSilentGapsForDiag(track),
        };
    }

    function resolveSilentGapSelectionAtPointer(clientX, clientY) {
        const info = explainSilentGapSelectionAtPointer(clientX, clientY);
        if (!info.ok || !(info.gapIndex >= 0)) return null;
        return { slot: (info.ex | 0) - 1, gapIndex: info.gapIndex | 0, diag: info };
    }

    function logSilentGapSelectionDiag(stage, payload) {
        regionSwapDiagLog('select/silent-gap/' + stage, payload);
    }

    function pruneInvalidSilentGapSelectionEntries() {
        let pruned = 0;
        for (let i = regionSelectionEntries.length - 1; i >= 0; i--) {
            const e = regionSelectionEntries[i];
            if (e.segmentIndex >= 0) continue;
            const track = { type: 'extra', slot: e.slot };
            const gaps = collectTrackSilentGaps(track);
            if (e.silentGapIndex < 0 || e.silentGapIndex >= gaps.length) {
                regionSelectionEntries.splice(i, 1);
                pruned++;
            }
        }
        return pruned;
    }

    /** 無音↔リージョン入れ替え時の移動先（フレーズ空きはフレーズ範囲先頭） */
    function silentGapMoveTargetSec(gap, track) {
        const slot = phraseSlotIndexForSilentGap(gap, track);
        const start = slot != null ? phraseSlotStartSec(slot) : null;
        if (start != null) return start;
        return gap ? gap.startSec : 0;
    }
    window.collectTrackSilentGaps = collectTrackSilentGaps;
    window.resolveSilentGapListIndexAtTransport = resolveSilentGapListIndexAtTransport;
    window.resolveSilentGapSelectionAtPointer = resolveSilentGapSelectionAtPointer;
    window.explainSilentGapSelectionAtPointer = explainSilentGapSelectionAtPointer;
    window.logSilentGapSelectionDiag = logSilentGapSelectionDiag;
    window.silentGapMoveTargetSec = silentGapMoveTargetSec;
