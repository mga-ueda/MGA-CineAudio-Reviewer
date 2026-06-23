/**
 * waveform-region-silent-gaps.js — 無音 gap 収集・選択・メタデータ
 */
    /** タイムライン上で隣接する無音区間を 1 つにまとめる（同一 Rehearsal スロット内のみ） */
    function mergeAdjacentSilentGapIntervals(gaps, eps) {
        if (!gaps || gaps.length <= 1) return gaps ? gaps.slice() : [];
        const out = [];
        let cur = {
            startSec: gaps[0].startSec,
            endSec: gaps[0].endSec,
            rehearsalIndex: gaps[0].rehearsalIndex,
            partial: !!gaps[0].partial,
            afterSegmentIndex: gaps[0].afterSegmentIndex,
            beforeSegmentIndex: gaps[0].beforeSegmentIndex,
        };
        for (let i = 1; i < gaps.length; i++) {
            const g = gaps[i];
            if (!g || !Number.isFinite(g.startSec) || !Number.isFinite(g.endSec)) continue;
            const curRi = Number.isFinite(cur.rehearsalIndex) ? cur.rehearsalIndex | 0 : -1;
            const gRi = Number.isFinite(g.rehearsalIndex) ? g.rehearsalIndex | 0 : -1;
            const sameRehearsal = curRi < 0 || gRi < 0 || curRi === gRi;
            if (g.startSec <= cur.endSec + eps && sameRehearsal) {
                cur.endSec = Math.max(cur.endSec, g.endSec);
                cur.partial = !!(cur.partial || g.partial);
                if (cur.beforeSegmentIndex == null || cur.beforeSegmentIndex < 0) {
                    cur.beforeSegmentIndex = g.beforeSegmentIndex;
                }
            } else {
                out.push(cur);
                cur = {
                    startSec: g.startSec,
                    endSec: g.endSec,
                    rehearsalIndex: g.rehearsalIndex,
                    partial: !!g.partial,
                    afterSegmentIndex: g.afterSegmentIndex,
                    beforeSegmentIndex: g.beforeSegmentIndex,
                };
            }
        }
        out.push(cur);
        return refreshSilentGapRehearsalMetadata(out);
    }

    /** 無音 gap の rehearsalIndex / rehearsalBarCount — 重なり最大の Rehearsal スロット基準 */
    function refreshSilentGapRehearsalMetadata(gaps) {
        if (!gaps || !gaps.length) return gaps ? gaps.slice() : [];
        const counts = expandedRehearsalGroupBarCountsSnapshot();
        const ranges = rehearsalSlotRangesSnapshot();
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
                gap.rehearsalIndex = bestIdx;
                const spanBars = estimateSilentGapBarSpan(gap);
                if (spanBars > 0) {
                    gap.rehearsalBarCount = spanBars;
                } else if (counts.length && bestIdx < counts.length) {
                    gap.rehearsalBarCount = counts[bestIdx] | 0;
                }
            }
        }
        return gaps;
    }

    /** 境界誤差レベルの微小無音（例: 41.247–41.250s）を除外 */
    function filterNegligibleSilentGaps(gaps, eps) {
        if (!gaps.length) return gaps;
        const counts = expandedRehearsalGroupBarCountsSnapshot();
        const ranges = rehearsalSlotRangesSnapshot();
        return gaps.filter((gap) => {
            const dur = gap.endSec - gap.startSec;
            if (!(dur > eps * 4)) return false;
            const pi = Number.isFinite(gap.rehearsalIndex) ? gap.rehearsalIndex | 0 : -1;
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
     * Rehearsal 区間先頭に置かれたリージョンより後ろの trailing 無音を除外する。
     * 非対称 swap 後に rehearsal 枠内へリージョン＋無音が二重に見えるのを防ぐ。
     */
    function suppressTrailingSilentGapsAfterRehearsalAnchoredRegions(track, gaps, eps) {
        if (!gaps.length) return gaps;
        const ranges = rehearsalSlotRangesSnapshot();
        if (!ranges.length) return gaps;
        const segments = getTrackSegments(track);
        const anchoredOut = new Map();
        for (let si = 0; si < segments.length; si++) {
            const regionIn = getSegmentRegionTimelineIn(track, si);
            const pi = rehearsalSlotIndexAtRegionInSec(regionIn);
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
            const pi = Number.isFinite(gap.rehearsalIndex) ? gap.rehearsalIndex | 0 : -1;
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
     * Rehearsal モード: 各 Rehearsal スロットからリージョンのタイムライン占有を引いた無音区間。
     * Region In だけがスロット内にあっても、クリック位置が音源 span 外なら選択可能。
     */
    function collectRehearsalModeUncoveredSilentIntervals(track, eps) {
        if (typeof getRehearsalGroupRangesSnapshot !== 'function') return [];
        const ranges = getRehearsalGroupRangesSnapshot();
        if (!ranges.length) return [];
        const segments = getTrackSegments(track);
        const gaps = [];

        for (let pi = 0; pi < ranges.length; pi++) {
            const r = ranges[pi];
            if (!r || !(r.endSec - r.startSec > eps)) continue;
            const covers = [];
            for (let si = 0; si < segments.length; si++) {
                const cover = getSegmentRehearsalCoverageInterval(track, si);
                const lo = Math.max(r.startSec, cover.startSec);
                const hi = Math.min(r.endSec, cover.endSec);
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
                    rehearsalIndex: pi,
                    partial: merged.length > 0,
                });
            }
        }

        gaps.sort((a, b) => a.startSec - b.startSec);
        let mergedGaps = mergeAdjacentSilentGapIntervals(gaps, eps);
        mergedGaps = suppressTrailingSilentGapsAfterRehearsalAnchoredRegions(track, mergedGaps, eps);
        mergedGaps = filterNegligibleSilentGaps(mergedGaps, eps);
        mergedGaps = refreshSilentGapRehearsalMetadata(mergedGaps);
        attachSilentGapNeighborIndices(mergedGaps, track, eps);
        return mergedGaps;
    }

    /** タイムライン上の無音隙間（Rehearsal 着色 ON 時は枠内 uncovered、OFF 時はセグメント間） */
    function collectTrackSilentGaps(track) {
        const segments = getTrackSegments(track);
        if (!segments.length) return [];
        const eps = segmentBoundaryJoinEpsilonSec();

        if (
            typeof getMusicalGridRehearsalFillVisible === 'function' &&
            getMusicalGridRehearsalFillVisible()
        ) {
            return collectRehearsalModeUncoveredSilentIntervals(track, eps);
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
            rehearsalSlot: Number.isFinite(gap.rehearsalIndex) ? (gap.rehearsalIndex | 0) + 1 : null,
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
        const rehearsalExpanded = rehearsalSlotIndexAtTransportSec(transportSec);
        const ranges = rehearsalSlotRangesSnapshot();
        const rehearsalRange =
            rehearsalExpanded != null && ranges[rehearsalExpanded | 0]
                ? ranges[rehearsalExpanded | 0]
                : null;
        const anchored =
            rehearsalExpanded != null &&
            isRehearsalSlotWithoutAnchoredRegion(track, rehearsalExpanded | 0, ranges) === false;
        let regionUnderSpan = null;
        const segments = getTrackSegments(track);
        const eps = segmentBoundaryJoinEpsilonSec();
        for (let si = 0; si < segments.length; si++) {
            const cover = getSegmentRehearsalCoverageInterval(track, si);
            if (
                transportSec >= cover.startSec - eps &&
                transportSec < cover.endSec - eps
            ) {
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
                rehearsalSlot: gap && Number.isFinite(gap.rehearsalIndex) ? (gap.rehearsalIndex | 0) + 1 : null,
                partial: !!(gap && gap.partial),
                regionUnderSpan,
                rehearsalExpanded: rehearsalExpanded != null ? rehearsalExpanded + 1 : null,
            };
        }
        let reason = 'transport-outside-silent-gaps';
        if (rehearsalExpanded == null) reason = 'rehearsal-slot-unresolved';
        else if (!rehearsalRange) reason = 'rehearsal-range-missing';
        else if (regionUnderSpan != null) reason = 'under-region-span';
        else if (anchored) reason = 'rehearsal-slot-has-region-in';
        else reason = 'rehearsal-empty-not-listed';
        return {
            ok: false,
            reason,
            ex: slot + 1,
            transportSec: regionSwapDiagFmtSec(transportSec),
            rehearsalExpanded: rehearsalExpanded != null ? rehearsalExpanded + 1 : null,
            rehearsalRange: rehearsalRange
                ? {
                      start: regionSwapDiagFmtSec(rehearsalRange.startSec),
                      end: regionSwapDiagFmtSec(rehearsalRange.endSec),
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

    /** 無音↔リージョン入れ替え時の移動先（Rehearsal 区間空きはRehearsal 区間範囲先頭） */
    function silentGapMoveTargetSec(gap, track) {
        const slot = rehearsalSlotIndexForSilentGap(gap, track);
        const start = slot != null ? rehearsalSlotStartSec(slot) : null;
        if (start != null) return start;
        return gap ? gap.startSec : 0;
    }
    window.collectTrackSilentGaps = collectTrackSilentGaps;
    window.resolveSilentGapListIndexAtTransport = resolveSilentGapListIndexAtTransport;
    window.resolveSilentGapSelectionAtPointer = resolveSilentGapSelectionAtPointer;
    window.explainSilentGapSelectionAtPointer = explainSilentGapSelectionAtPointer;
    window.logSilentGapSelectionDiag = logSilentGapSelectionDiag;
    window.silentGapMoveTargetSec = silentGapMoveTargetSec;
