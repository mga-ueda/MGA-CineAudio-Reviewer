/**
 * musical-grid-ops.js — Rehearsal 結合・分割・入れ替え・公開 API
 */
    function swapRehearsalSpecCycleSizesAtIndices(lo, hi, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        function reject(reason, extra) {
            rehearsalSwapDiagLog('spec-swap/rejected', { reason, ...(extra || {}) });
            return false;
        }
        if (!getMusicalGridRehearsalFillVisible()) return reject('rehearsal fill off');
        readMusicalGridFromInputs();
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.rehearsalSpec || !settings.rehearsalSpec.sizes) {
            return reject('no rehearsal spec');
        }
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return reject('master duration zero');
        const loIdx = lo | 0;
        const hiIdx = hi | 0;
        if (loIdx < 0 || hiIdx < 0 || loIdx === hiIdx) {
            return reject('invalid indices', { lo: loIdx, hi: hiIdx });
        }
        const sizes = settings.rehearsalSpec.sizes.slice();
        if (loIdx >= sizes.length || hiIdx >= sizes.length) {
            return reject('index outside spec cycle', {
                lo: loIdx + 1,
                hi: hiIdx + 1,
                specLen: sizes.length,
            });
        }
        const barsLo = sizes[loIdx];
        const barsHi = sizes[hiIdx];
        if (!o.skipUndo) requestRehearsalUndoCapture();
        const nextSizes = sizes.slice();
        const tmp = nextSizes[loIdx];
        nextSizes[loIdx] = nextSizes[hiIdx];
        nextSizes[hiIdx] = tmp;
        const rehearsalBefore = musicalGridRehearsalText;
        const spec = { sizes: nextSizes };
        const counts = expandRehearsalSpecToGroupBarCounts(
            settings.meterSpec,
            master,
            spec,
        );
        applyExplicitRehearsalGroupBarCounts(counts, { skipUndo: true });
        persistRehearsalWaveformEditAndRedraw({ relayoutSilent: true });
        if (typeof writeLog === 'function') {
            rehearsalSwapDiagLog('spec-swap/applied', {
                lo: loIdx + 1,
                hi: hiIdx + 1,
                barsLo,
                barsHi,
                before: rehearsalBefore,
                after: musicalGridRehearsalText,
                textUnchanged: rehearsalBefore === musicalGridRehearsalText,
            });
        }
        return true;
    }
    /**
     * 展開済み Rehearsal グループの連続ブロックを入れ替える（例: 16↔8+8）。
     * ブロック小節数合計が一致すること。
     */
    function swapRehearsalExpandedGroupBlocksAtIndices(startA, countA, startB, countB, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        function reject(reason, extra) {
            rehearsalSwapDiagLog('block-swap/rejected', { reason, ...(extra || {}) });
            return false;
        }
        if (!getMusicalGridRehearsalFillVisible()) return reject('rehearsal fill off');
        readMusicalGridFromInputs();
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.rehearsalSpec) return reject('no rehearsal spec');
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return reject('master duration zero');
        const a0 = startA | 0;
        const aN = countA | 0;
        const b0 = startB | 0;
        const bN = countB | 0;
        if (aN < 1 || bN < 1) return reject('invalid block size', { aN, bN });
        if (a0 < 0 || b0 < 0 || a0 === b0) {
            return reject('invalid block start', { a0, b0 });
        }
        const aEnd = a0 + aN;
        const bEnd = b0 + bN;
        if (a0 < bEnd && b0 < aEnd) {
            return reject('overlapping blocks', { a0, aN, b0, bN });
        }
        const counts = resolveRehearsalGroupBarCounts(
            settings.meterSpec,
            master,
            settings.rehearsalSpec,
        );
        if (
            !counts.length ||
            a0 + aN > counts.length ||
            b0 + bN > counts.length
        ) {
            return reject('block out of expanded range', {
                a0,
                aN,
                b0,
                bN,
                countLen: counts.length,
            });
        }
        const blockA = counts.slice(a0, a0 + aN);
        const blockB = counts.slice(b0, b0 + bN);
        let sumA = 0;
        let sumB = 0;
        for (let i = 0; i < blockA.length; i++) sumA += blockA[i];
        for (let i = 0; i < blockB.length; i++) sumB += blockB[i];
        if (sumA !== sumB) {
            return reject('block bar sum mismatch', { sumA, sumB, blockA, blockB });
        }
        if (!o.skipUndo) requestRehearsalUndoCapture();
        const loIdx = Math.min(a0, b0);
        const hiIdx = Math.max(a0 + aN, b0 + bN);
        const beforeA = counts.slice(0, loIdx);
        const mid =
            loIdx === a0
                ? counts.slice(a0 + aN, b0)
                : counts.slice(b0 + bN, a0);
        const afterB = counts.slice(hiIdx);
        const next =
            loIdx === a0
                ? beforeA.concat(blockB, mid, blockA, afterB)
                : beforeA.concat(blockA, mid, blockB, afterB);
        const rehearsalBefore = musicalGridRehearsalText;
        applyExplicitRehearsalGroupBarCounts(next, {
            skipUndo: true,
            preserveRehearsalText: o.preserveRehearsalText !== false,
        });
        persistRehearsalWaveformEditAndRedraw({ relayoutSilent: true });
        if (typeof writeLog === 'function') {
            rehearsalSwapDiagLog('block-swap/applied', {
                a0: a0 + 1,
                aN,
                b0: b0 + 1,
                bN,
                sumBars: sumA,
                before: rehearsalBefore,
                after: musicalGridRehearsalText,
                textUnchanged: rehearsalBefore === musicalGridRehearsalText,
            });
        }
        return true;
    }
    /** 展開済み Rehearsal グループ lo / hi の小節数定義を入れ替える（リージョン入れ替え E 用）。 */
    function swapRehearsalGroupsAtIndices(lo, hi, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        function reject(reason, extra) {
            rehearsalSwapDiagLog('swap/rejected', { reason, ...(extra || {}) });
            return false;
        }
        if (!getMusicalGridRehearsalFillVisible()) return reject('rehearsal fill off');
        readMusicalGridFromInputs();
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.rehearsalSpec) return reject('no rehearsal spec');
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return reject('master duration zero');
        const loIdx = lo | 0;
        const hiIdx = hi | 0;
        if (loIdx < 0 || hiIdx < 0 || loIdx === hiIdx) {
            return reject('invalid indices', { lo: loIdx, hi: hiIdx });
        }
        const counts = expandRehearsalSpecToGroupBarCounts(
            settings.meterSpec,
            master,
            settings.rehearsalSpec,
        );
        if (!counts.length || loIdx >= counts.length || hiIdx >= counts.length) {
            return reject('index out of expanded counts range', {
                lo: loIdx + 1,
                hi: hiIdx + 1,
                countLen: counts.length,
                head: counts.slice(0, 8),
            });
        }
        const barsLo = counts[loIdx];
        const barsHi = counts[hiIdx];
        if (!o.skipUndo) requestRehearsalUndoCapture();
        const next = counts.slice();
        const tmp = next[loIdx];
        next[loIdx] = next[hiIdx];
        next[hiIdx] = tmp;
        const rehearsalBefore = musicalGridRehearsalText;
        applyExplicitRehearsalGroupBarCounts(next, { skipUndo: true });
        persistRehearsalWaveformEditAndRedraw({ relayoutSilent: true });
        if (typeof writeLog === 'function') {
            rehearsalSwapDiagLog('swap/applied', {
                lo: loIdx + 1,
                hi: hiIdx + 1,
                barsLo,
                barsHi,
                before: rehearsalBefore,
                after: musicalGridRehearsalText,
                textUnchanged: rehearsalBefore === musicalGridRehearsalText,
            });
        }
        return true;
    }
    /** Rehearsal グループ g を隣接グループへ吸収して削除。2 グループ未満は null。 */
    function deleteRehearsalGroupAtIndex(counts, groupIndex) {
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
    /** 無音 Rehearsal スロット削除 — グループ g を隣接へマージせず除去。1 件残る場合は null。 */
    function spliceRehearsalGroupAtIndex(counts, groupIndex) {
        const g = groupIndex | 0;
        if (!counts || counts.length < 2 || g < 0 || g >= counts.length) return null;
        const next = counts.slice();
        next.splice(g, 1);
        return next.length ? next : null;
    }
    function silentGapDeleteDiagFromGrid(stage, payload) {
        if (typeof window.silentGapDeleteDiagLog === 'function') {
            window.silentGapDeleteDiagLog('grid/' + stage, payload);
        }
    }
    function deleteRehearsalAtWaveformPointer() {
        silentGapDeleteDiagFromGrid('rehearsal-delete/begin', {
            gridVisible: getMusicalGridVisible(),
            rehearsalFillVisible: getMusicalGridRehearsalFillVisible(),
            boundaryDrag: !!rehearsalBoundaryDragActive,
            silentGapSelected:
                typeof window.hasSilentGapRegionSelection === 'function' &&
                window.hasSilentGapRegionSelection(),
        });
        if (!getMusicalGridVisible()) {
            silentGapDeleteDiagFromGrid('rehearsal-delete/reject', { reason: 'grid-off' });
            return false;
        }
        if (rehearsalBoundaryDragActive) {
            silentGapDeleteDiagFromGrid('rehearsal-delete/reject', { reason: 'boundary-drag' });
            return false;
        }
        if (
            typeof window.hasSilentGapRegionSelection === 'function' &&
            window.hasSilentGapRegionSelection()
        ) {
            silentGapDeleteDiagFromGrid('rehearsal-delete/defer', {
                reason: 'silent-gap-selected',
                to: 'region-delete',
            });
            return false;
        }
        const target = resolveRehearsalEditTransportSec();
        if (!target) {
            silentGapDeleteDiagFromGrid('rehearsal-delete/reject', { reason: 'transport-unresolved' });
            return false;
        }
        const { transportSec, useSeekbar } = target;
        if (
            typeof window.tryDeleteSilentGapAtRehearsalEditPointer === 'function' &&
            window.tryDeleteSilentGapAtRehearsalEditPointer(transportSec)
        ) {
            silentGapDeleteDiagFromGrid('rehearsal-delete/path', {
                path: 'silent-gap-pointer',
                useSeekbar,
                transportSec,
            });
            if (typeof flashSeekHint === 'function') {
                flashSeekHint(
                    'Region',
                    'Silent gap removed' + (useSeekbar ? ' (seekbar)' : ''),
                    'notice',
                );
            }
            return true;
        }
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.rehearsalSpec) {
            silentGapDeleteDiagFromGrid('rehearsal-delete/reject', { reason: 'rehearsal-spec-missing' });
            return false;
        }
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return false;
        const groupIndex = resolveRehearsalGroupIndexAtTransportSec(transportSec);
        if (groupIndex == null) return false;
        const counts = expandRehearsalSpecToGroupBarCounts(
            settings.meterSpec,
            master,
            settings.rehearsalSpec,
        );
        if (counts.length < 2) {
            if (typeof writeLog === 'function') {
                writeLog(
                    'Rehearsal: cannot delete the only rehearsal' + (useSeekbar ? ' (seekbar)' : ''),
                );
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Rehearsal', "Can't delete here", 'error');
            }
            return true;
        }
        const nextCounts = deleteRehearsalGroupAtIndex(counts, groupIndex);
        if (!nextCounts) {
            silentGapDeleteDiagFromGrid('rehearsal-delete/reject', {
                reason: 'delete-group-failed',
                groupIndex,
            });
            return false;
        }
        const label = rehearsalGroupLabelForIndex(groupIndex);
        silentGapDeleteDiagFromGrid('rehearsal-delete/path', {
            path: 'rehearsal-grid-relayout',
            useSeekbar,
            transportSec,
            groupIndex,
            countsBefore: counts.slice(0, 12),
            countsAfter: nextCounts.slice(0, 12),
            rehearsalBefore: musicalGridRehearsalText,
        });
        applyExplicitRehearsalGroupBarCounts(nextCounts);
        persistRehearsalWaveformEditAndRedraw({ skipUndo: true });
        silentGapDeleteDiagFromGrid('rehearsal-delete/done', {
            path: 'rehearsal-grid-relayout',
            rehearsalAfter: musicalGridRehearsalText,
        });
        if (typeof logRehearsalAction === 'function') {
            logRehearsalAction(
                label +
                    ' deleted' +
                    (useSeekbar ? ' (seekbar)' : '') +
                    ': ' +
                    musicalGridRehearsalText,
            );
        } else if (typeof writeLog === 'function') {
            writeLog(
                'Rehearsal ' +
                    label +
                    ' deleted' +
                    (useSeekbar ? ' (seekbar)' : '') +
                    ': ' +
                    musicalGridRehearsalText,
            );
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(
                'Rehearsal',
                'Deleted ' + label + (useSeekbar ? ' (seekbar)' : ''),
                'notice',
            );
        }
        return true;
    }
    function handleMusicalGridRehearsalDeleteKeydown(e) {
        if (!matchUserShortcut(e, 'regionDelete')) return false;
        if (e.shiftKey) return false;
        if (e.repeat) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        silentGapDeleteDiagFromGrid('keydown/begin', { handler: 'musical-grid' });
        if (!deleteRehearsalAtWaveformPointer()) {
            silentGapDeleteDiagFromGrid('keydown/miss', {
                handler: 'musical-grid',
                fallthrough: 'region-delete',
            });
            return false;
        }
        silentGapDeleteDiagFromGrid('keydown/handled', { handler: 'musical-grid' });
        e.preventDefault();
        return true;
    }
    /** 境界 index b の右隣Rehearsal 区間を b に連結。 */
    function mergeRehearsalGroupsAtBoundaryIndex(counts, boundaryIndex) {
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
     * リージョン結合境界が Rehearsal スロット境界とどう対応するかを返す。
     * @returns {{ boundaryIndex: number, counts: number[]|null, relayoutOnly?: boolean }|null}
     */
    function resolveRehearsalBoundaryJoinAtRegionBoundary(track, boundaryIndex) {
        if (!getMusicalGridRehearsalFillVisible()) return null;
        if (!canCommitRehearsalCompositionLayout()) return null;
        const b = boundaryIndex | 0;
        if (b < 0) return null;

        const counts = resolveCurrentExpandedRehearsalGroupBarCounts();
        if (!counts || counts.length < 2) return null;

        if (
            typeof window.getSegmentRegionTimelineIn === 'function' &&
            typeof window.rehearsalSlotIndexAtRegionInSec === 'function'
        ) {
            const leftIn = window.getSegmentRegionTimelineIn(track, b);
            const rightIn = window.getSegmentRegionTimelineIn(track, b + 1);
            const leftSlot = window.rehearsalSlotIndexAtRegionInSec(leftIn);
            const rightSlot = window.rehearsalSlotIndexAtRegionInSec(rightIn);
            if (leftSlot != null && rightSlot != null) {
                if (rightSlot === leftSlot + 1) {
                    const next = mergeRehearsalGroupsAtBoundaryIndex(counts, leftSlot);
                    if (next) {
                        return {
                            boundaryIndex: leftSlot,
                            counts: next,
                        };
                    }
                }
                if (leftSlot === rightSlot) {
                    return {
                        boundaryIndex: leftSlot,
                        counts: null,
                        relayoutOnly: true,
                    };
                }
            }
        }

        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return null;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return null;
        const ranges = collectRehearsalGroupRangesFromBarCounts(
            settings.meterSpec,
            master,
            counts,
        );
        if (ranges.length < 2) return null;
        let boundarySec = null;
        if (typeof window.getSegmentRegionTimelineIn === 'function') {
            const leftIn = window.getSegmentRegionTimelineIn(track, b);
            const rightIn = window.getSegmentRegionTimelineIn(track, b + 1);
            if (Number.isFinite(leftIn) && Number.isFinite(rightIn)) {
                boundarySec = (leftIn + rightIn) * 0.5;
            }
        }
        if (boundarySec == null) return null;
        const eps =
            typeof window.segmentBoundaryJoinEpsilonSec === 'function'
                ? window.segmentBoundaryJoinEpsilonSec()
                : musicalGridBarLineSnapThresholdSec();
        for (let i = 0; i < ranges.length - 1; i++) {
            const sec = ranges[i].endSec;
            if (!Number.isFinite(sec)) continue;
            if (Math.abs(sec - boundarySec) <= eps) {
                const next = mergeRehearsalGroupsAtBoundaryIndex(counts, i);
                if (next) {
                    return {
                        boundaryIndex: i,
                        counts: next,
                    };
                }
            }
        }
        return null;
    }
    /**
     * Rehearsal 着色 ON — リージョン結合境界が隣接Rehearsal 区間グループ境界のとき、
     * Rehearsal 区間境界ハンドルドラッグと同じ bar スナップ／counts 更新用コンテキストを返す。
     */
    function resolveRehearsalBoundaryDragAtRegionBoundary(track, boundaryIndex) {
        if (!getMusicalGridRehearsalFillVisible()) return null;
        if (!canCommitRehearsalCompositionLayout()) return null;
        const b = boundaryIndex | 0;
        if (b < 0) return null;

        const counts = resolveCurrentExpandedRehearsalGroupBarCounts();
        if (!counts || counts.length < 2) return null;

        let rehearsalBoundaryIndex = -1;
        if (
            typeof window.getSegmentRegionTimelineIn === 'function' &&
            typeof window.rehearsalSlotIndexAtRegionInSec === 'function'
        ) {
            const leftIn = window.getSegmentRegionTimelineIn(track, b);
            const rightIn = window.getSegmentRegionTimelineIn(track, b + 1);
            const leftSlot = window.rehearsalSlotIndexAtRegionInSec(leftIn);
            const rightSlot = window.rehearsalSlotIndexAtRegionInSec(rightIn);
            if (leftSlot != null && rightSlot != null) {
                if (rightSlot === leftSlot + 1) {
                    rehearsalBoundaryIndex = leftSlot;
                } else if (leftSlot === rightSlot) {
                    return null;
                }
            }
        }

        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return null;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return null;

        if (rehearsalBoundaryIndex < 0) {
            const ranges = collectRehearsalGroupRangesFromBarCounts(
                settings.meterSpec,
                master,
                counts,
            );
            if (ranges.length < 2) return null;
            let boundarySec = null;
            if (typeof window.getSegmentRegionTimelineIn === 'function') {
                const leftIn = window.getSegmentRegionTimelineIn(track, b);
                const rightIn = window.getSegmentRegionTimelineIn(track, b + 1);
                if (Number.isFinite(leftIn) && Number.isFinite(rightIn)) {
                    boundarySec = (leftIn + rightIn) * 0.5;
                }
            }
            if (boundarySec == null) return null;
            const eps =
                typeof window.segmentBoundaryJoinEpsilonSec === 'function'
                    ? window.segmentBoundaryJoinEpsilonSec()
                    : musicalGridBarLineSnapThresholdSec();
            for (let i = 0; i < ranges.length - 1; i++) {
                const sec = ranges[i].endSec;
                if (!Number.isFinite(sec)) continue;
                if (Math.abs(sec - boundarySec) <= eps) {
                    rehearsalBoundaryIndex = i;
                    break;
                }
            }
        }

        if (rehearsalBoundaryIndex < 0 || rehearsalBoundaryIndex >= counts.length - 1) {
            return null;
        }

        const barBoundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(settings.meterSpec, master)
                : collectBarBoundarySecs(settings.meterSpec, master);
        const startBarK =
            sumGroupBarCounts(counts, rehearsalBoundaryIndex) + counts[rehearsalBoundaryIndex];
        return {
            rehearsalBoundaryIndex,
            startCounts: counts.slice(),
            barBoundaries,
            startBarK,
        };
    }
    function previewRehearsalBoundaryDragFromRegionPointer(ctx, clientX, startClientX) {
        if (!ctx || !ctx.startCounts || !ctx.startCounts.length) return null;
        const startCounts = ctx.startCounts;
        const rehearsalB = ctx.rehearsalBoundaryIndex | 0;
        if (rehearsalB < 0 || rehearsalB >= startCounts.length - 1) return null;
        const sumBefore = sumGroupBarCounts(startCounts, rehearsalB);
        const minK = sumBefore;
        const maxK = sumBefore + startCounts[rehearsalB] + startCounts[rehearsalB + 1];
        const targetK = targetBarKForRehearsalBoundaryDrag(
            ctx.startBarK,
            startClientX,
            clientX,
            ctx.barBoundaries,
            minK,
            maxK,
        );
        const newCounts = countsForRehearsalBoundaryAtBarIndex(startCounts, rehearsalB, targetK);
        applyRehearsalBoundaryDragPreview(newCounts);
        return newCounts;
    }
    function commitRehearsalBoundaryDragFromRegion(startCounts, finalCounts, rehearsalBoundaryIndex, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!finalCounts || !finalCounts.length) return false;
        if (rehearsalGroupCountsEqual(startCounts, finalCounts)) return false;
        if (!o.skipUndo) {
            if (typeof window.requestRegionUndoCapture === 'function') {
                window.requestRegionUndoCapture({ includeRehearsal: true });
            } else {
                requestRehearsalUndoCapture();
            }
        }
        applyExplicitRehearsalGroupBarCounts(finalCounts, { skipUndo: true });
        persistRehearsalWaveformEditAndRedraw({
            skipUndo: true,
            relayoutSilent: o.relayoutSilent !== false,
        });
        if (!rehearsalBoundaryDragActive) {
            rehearsalBoundaryDragCounts = null;
            drawMusicalGridOverlay();
            updateRehearsalBoundaryOverlay();
        }
        return true;
    }
    function cancelRehearsalBoundaryDragPreview() {
        if (rehearsalBoundaryDragActive) return;
        if (!rehearsalBoundaryDragCounts) return;
        rehearsalBoundaryDragCounts = null;
        drawMusicalGridOverlay();
        updateRehearsalBoundaryOverlay();
    }
    /**
     * 連続セグメント lo..hi をまとめて結合 — Rehearsal 境界を右から左へ counts 更新後、1 回 relayout。
     * 同一 Rehearsal スロット内の分割のみ（relayoutOnly のみ）のときは false を返し、呼び出し側で segment 結合へ。
     */
    function joinRehearsalAtRegionSpan(track, lo, hi, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const first = lo | 0;
        const last = hi | 0;
        if (last <= first) return false;
        if (!getMusicalGridRehearsalFillVisible()) return false;
        if (!canCommitRehearsalCompositionLayout()) return false;

        const rehearsalBoundaryIndices = [];
        let hasRelayoutOnly = false;
        for (let b = first; b < last; b++) {
            if (
                typeof window.isSegmentBoundaryJoinableAtIndex === 'function' &&
                !window.isSegmentBoundaryJoinableAtIndex(track, b)
            ) {
                return false;
            }
            const hit = resolveRehearsalBoundaryJoinAtRegionBoundary(track, b);
            if (!hit) return false;
            if (hit.relayoutOnly) {
                hasRelayoutOnly = true;
            } else if (hit.counts) {
                rehearsalBoundaryIndices.push(hit.boundaryIndex);
            }
        }
        if (!rehearsalBoundaryIndices.length) return false;

        if (!o.skipUndo && typeof window.requestRegionUndoCapture === 'function') {
            window.requestRegionUndoCapture({ includeRehearsal: true });
        }

        if (
            hasRelayoutOnly &&
            typeof window.mergeSegmentSpanAt === 'function' &&
            !window.mergeSegmentSpanAt(track, first, last, {
                silent: true,
                skipUndo: true,
                skipRehearsalRelayout: true,
            })
        ) {
            return false;
        }

        let counts = resolveCurrentExpandedRehearsalGroupBarCounts();
        if (!counts) return false;
        rehearsalBoundaryIndices.sort((a, b) => b - a);
        for (let i = 0; i < rehearsalBoundaryIndices.length; i++) {
            counts = mergeRehearsalGroupsAtBoundaryIndex(counts, rehearsalBoundaryIndices[i]);
            if (!counts) return false;
        }

        const rehearsalBefore = musicalGridRehearsalText;
        applyExplicitRehearsalGroupBarCounts(counts, { skipUndo: true });
        persistRehearsalWaveformEditAndRedraw({
            skipUndo: true,
            relayoutSilent: o.relayoutSilent !== false,
        });

        rehearsalSwapDiagLog('region-bond/span-applied', {
            ex: (track.slot | 0) + 1,
            regionLo: first + 1,
            regionHi: last + 1,
            rehearsalBoundaries: rehearsalBoundaryIndices.map((i) => i + 1),
            before: rehearsalBefore,
            after: musicalGridRehearsalText,
        });
        return true;
    }
    /** Rehearsal 着色 ON — リージョン境界ボンドで counts 更新＋構成どおりに切り直し */
    function joinRehearsalAtRegionBoundary(track, boundaryIndex, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const hit = resolveRehearsalBoundaryJoinAtRegionBoundary(track, boundaryIndex);
        if (!hit) return false;

        if (!o.skipUndo && typeof window.requestRegionUndoCapture === 'function') {
            window.requestRegionUndoCapture({ includeRehearsal: true });
        }

        const rehearsalBefore = musicalGridRehearsalText;
        if (hit.counts) {
            applyExplicitRehearsalGroupBarCounts(hit.counts, { skipUndo: true });
        }
        persistRehearsalWaveformEditAndRedraw({
            skipUndo: true,
            relayoutSilent: o.relayoutSilent !== false,
        });

        rehearsalSwapDiagLog('region-bond/applied', {
            ex: (track.slot | 0) + 1,
            regionBoundary: (boundaryIndex | 0) + 1,
            rehearsalBoundary: hit.boundaryIndex + 1,
            relayoutOnly: !!hit.relayoutOnly,
            before: rehearsalBefore,
            after: musicalGridRehearsalText,
        });

        if (!(o.silent)) {
            if (hit.relayoutOnly) {
                const relayoutMsg =
                    formatExTrack(track.slot) +
                    ' regions joined at boundary ' +
                    ((boundaryIndex | 0) + 1) +
                    ' (rehearsal relayout)';
                if (typeof logRegionAction === 'function') {
                    logRegionAction(relayoutMsg);
                } else if (typeof writeLog === 'function') {
                    writeLog(
                        'Ex ' +
                            ((track.slot | 0) + 1) +
                            ': regions joined at boundary ' +
                            ((boundaryIndex | 0) + 1) +
                            ' (rehearsal relayout)',
                    );
                }
            } else {
                const left = rehearsalGroupLabelForIndex(hit.boundaryIndex);
                const right = rehearsalGroupLabelForIndex(hit.boundaryIndex + 1);
                const joinMsg =
                    left +
                    '/' +
                    right +
                    ' joined at region boundary: ' +
                    musicalGridRehearsalText;
                if (typeof logRehearsalAction === 'function') {
                    logRehearsalAction(joinMsg);
                } else if (typeof writeLog === 'function') {
                    writeLog('Rehearsal ' + joinMsg);
                }
            }
        }
        if (!(o.silent) && typeof flashSeekHint === 'function') {
            if (hit.relayoutOnly) {
                flashSeekHint(
                    'Ex ' + ((track.slot | 0) + 1),
                    'Regions joined',
                    'notice',
                );
            } else {
                const left = rehearsalGroupLabelForIndex(hit.boundaryIndex);
                const right = rehearsalGroupLabelForIndex(hit.boundaryIndex + 1);
                flashSeekHint('Rehearsal', 'Joined ' + left + '/' + right, 'notice');
            }
        }
        return true;
    }
    /**
     * transport 秒がRehearsal 区間境界に近いとき、その境界で連結候補を返す。
     * 連結は常にスナップ閾値内の境界のみ。
     */
    function resolveRehearsalBoundaryJoinAtTransportSec(transportSec) {
        if (!getMusicalGridVisible()) return null;
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.rehearsalSpec) return null;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return null;
        const counts = expandRehearsalSpecToGroupBarCounts(
            settings.meterSpec,
            master,
            settings.rehearsalSpec,
        );
        if (counts.length < 2) return null;
        const ranges = collectRehearsalGroupRangesFromBarCounts(
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
        const nextCounts = mergeRehearsalGroupsAtBoundaryIndex(counts, bestB);
        if (!nextCounts) return null;
        return {
            boundaryIndex: bestB,
            boundarySec: ranges[bestB].endSec,
            counts: nextCounts,
        };
    }
    function joinRehearsalAtTarget() {
        if (!getMusicalGridVisible()) return false;
        if (rehearsalBoundaryDragActive) return false;
        const target = resolveRehearsalJoinTargetSec();
        if (!target) return false;
        let { transportSec, useSeekbar } = target;
        const threshold = musicalGridBarLineSnapThresholdSec();
        if (useSeekbar) {
            transportSec = snapSecToRehearsalBoundaryStops(transportSec, threshold);
        }
        const hit = resolveRehearsalBoundaryJoinAtTransportSec(transportSec);
        if (!hit) return false;
        const left = rehearsalGroupLabelForIndex(hit.boundaryIndex);
        const right = rehearsalGroupLabelForIndex(hit.boundaryIndex + 1);
        applyExplicitRehearsalGroupBarCounts(hit.counts);
        persistRehearsalWaveformEditAndRedraw({ skipUndo: true });
        if (typeof logRehearsalAction === 'function') {
            logRehearsalAction(
                left +
                    '/' +
                    right +
                    ' joined' +
                    (useSeekbar ? ' (seekbar)' : '') +
                    ': ' +
                    musicalGridRehearsalText,
            );
        } else if (typeof writeLog === 'function') {
            writeLog(
                'Rehearsal ' +
                    left +
                    '/' +
                    right +
                    ' joined' +
                    (useSeekbar ? ' (seekbar)' : '') +
                    ': ' +
                    musicalGridRehearsalText,
            );
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(
                'Rehearsal',
                'Joined ' + left + '/' + right + (useSeekbar ? ' (seekbar)' : ''),
                'notice',
            );
        }
        return true;
    }
    function handleMusicalGridRehearsalJoinKeydown(e) {
        if (!matchUserShortcut(e, 'regionJoin')) return false;
        if (e.repeat) return false;
        if (!getMusicalGridVisible()) return false;
        if (
            getMusicalGridRehearsalFillVisible() &&
            typeof window.joinPlaybackRegionAtPointer === 'function' &&
            window.joinPlaybackRegionAtPointer()
        ) {
            e.preventDefault();
            e.stopPropagation();
            return true;
        }
        const rehearsalJoined = joinRehearsalAtTarget();
        e.preventDefault();
        if (rehearsalJoined) e.stopPropagation();
        return true;
    }
    function wasLeftRehearsalAbsorbedIntoRight(startCounts, finalCounts, boundaryIndex) {
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
    /** 展開済みグループ小節数列から Rehearsal 着色範囲を求める（境界ドラッグ中のスナップショット用）。 */
    function collectRehearsalGroupRangesFromBarCounts(meterSpec, durationSec, counts) {
        const ranges = [];
        if (!(durationSec > 0) || !meterSpec || !counts || !counts.length) return ranges;
        const barBoundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(meterSpec, durationSec)
                : collectBarBoundarySecs(meterSpec, durationSec);
        const totalBars = Math.max(0, barBoundaries.length - 1);
        let lastGi = -1;
        for (let gi = counts.length - 1; gi >= 0; gi--) {
            if ((counts[gi] | 0) > 0) {
                lastGi = gi;
                break;
            }
        }
        let barIndex = 0;
        for (let gi = 0; gi < counts.length && barIndex < totalBars; gi++) {
            const groupBars = Math.max(0, counts[gi] | 0);
            if (groupBars <= 0) continue;
            const remainingBars = totalBars - barIndex;
            const effectiveBars = Math.min(groupBars, remainingBars);
            const startSec = barBoundaries[barIndex];
            const endBarIndex = barIndex + effectiveBars;
            const isLastGroup = gi === lastGi || endBarIndex >= totalBars;
            // 最終グループは duration まで伸ばす（テンポストレッチ後の端数小節を別 Rehearsal にしない）
            const endSec = isLastGroup ? durationSec : barBoundaries[endBarIndex];
            if (endSec > startSec + 1e-9) {
                ranges.push({
                    startSec,
                    endSec,
                    paletteIndex: gi,
                });
            }
            barIndex = isLastGroup ? totalBars : endBarIndex;
        }
        // counts 合計が totalBars 未満の端数 — 最終帯へ吸収（余分な palette を増やさない）
        if (barIndex < totalBars && ranges.length) {
            ranges[ranges.length - 1].endSec = durationSec;
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
    /** Ctrl+←→ ナビ用: 小節線 + Rehearsal 境界のみ（拍線は含めない） */
    function collectMusicalGridBarSnapStopsForNav() {
        if (!getMusicalGridVisible()) return [];
        const settings = musicalGridDrawSettings();
        if (!settings) return [];
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return [];
        const lines = collectMusicalGridLines(settings.meterSpec, master, { showBeats: false });
        if (!lines.length) return [];
        const stops = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line && line.kind === 'bar' && Number.isFinite(line.sec)) {
                stops.push(line.sec);
            }
        }
        return stops;
    }
    function collectRehearsalGroupSnapStops() {
        if (!getMusicalGridRehearsalFillVisible()) return [];
        const ranges = getRehearsalGroupRangesSnapshot();
        if (!ranges.length) return [];
        const stops = [];
        for (let i = 0; i < ranges.length; i++) {
            if (Number.isFinite(ranges[i].startSec)) stops.push(ranges[i].startSec);
            if (Number.isFinite(ranges[i].endSec)) stops.push(ranges[i].endSec);
        }
        return stops;
    }
    function collectMusicalGridSnapStops() {
        return dedupeSortedMusicalGridStops(
            collectMusicalGridBarSnapStops().concat(collectRehearsalGroupSnapStops()),
        );
    }
    /** リージョン平行移動 T ON — 小節線 + 拡大時の拍線のみ（Rehearsal 境界は含めない） */
    function collectMusicalGridRegionMoveSnapStops() {
        return dedupeSortedMusicalGridStops(collectMusicalGridBarSnapStops());
    }
    function collectMusicalGridNavStops() {
        const key = musicalGridNavStopsCacheKeyNow();
        if (musicalGridNavStopsCache && musicalGridNavStopsCacheKey === key) {
            return musicalGridNavStopsCache;
        }
        const stops = dedupeSortedMusicalGridStops(
            collectMusicalGridBarSnapStopsForNav().concat(collectRehearsalGroupSnapStops()),
        );
        musicalGridNavStopsCache = stops;
        musicalGridNavStopsCacheKey = key;
        return stops;
    }
    function hasMusicalGridSnapStops() {
        if (collectMusicalGridNavStops().length > 0) return true;
        return collectMusicalGridBarSnapStops().length > 0;
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
    function musicalGridNavStopIndexForCurrent(stops, fromSec) {
        if (!stops || !stops.length) return -1;
        const t = Number.isFinite(fromSec)
            ? fromSec
            : typeof getTransportSec === 'function'
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

    /** 境界判定・小節ラベル用 — Rehearsal Mark トラック優先（Shift+字母ジャンプと同じ） */
    function rehearsalGroupRangesForGridBoundarySec() {
        if (typeof getRehearsalMarkNavRanges === 'function') {
            const fromTrack = getRehearsalMarkNavRanges();
            if (fromTrack && fromTrack.length) return fromTrack;
        }
        return resolveRehearsalGroupRanges({ requireFillVisible: false });
    }

    function rehearsalRehearsalMarkFromRange(range) {
        if (!range || range.fromRehearsalEvent !== true) return '';
        const raw = range.label != null ? String(range.label).trim() : '';
        if (!raw) return '';
        const unlabeled =
            typeof REHEARSAL_MARK_UNLABELED !== 'undefined' ? REHEARSAL_MARK_UNLABELED : '_';
        const internal =
            typeof normalizeRehearsalMarkLabel === 'function'
                ? normalizeRehearsalMarkLabel(raw)
                : raw;
        if (!internal || internal === unlabeled) return '';
        if (typeof rehearsalMarkDisplayLabel === 'function') {
            return rehearsalMarkDisplayLabel(internal) || '';
        }
        return internal;
    }

    /** 境界の後ろ側（右／先）に属する Rehearsal 範囲 */
    function rehearsalRangeAfterGridBoundarySec(sec) {
        const ranges = rehearsalGroupRangesForGridBoundarySec();
        if (!ranges.length) return null;
        const eps = musicalGridNavStopEpsilonSec();
        const s = Number(sec);
        if (!Number.isFinite(s)) return null;
        for (let i = 0; i < ranges.length; i++) {
            if (Math.abs(s - ranges[i].startSec) <= eps) {
                return ranges[i];
            }
        }
        for (let i = 0; i < ranges.length - 1; i++) {
            if (Math.abs(s - ranges[i].endSec) <= eps) {
                return ranges[i + 1];
            }
        }
        for (let i = 0; i < ranges.length; i++) {
            if (s >= ranges[i].startSec - eps && s < ranges[i].endSec - eps) {
                return ranges[i];
            }
        }
        if (s >= ranges[ranges.length - 1].startSec - eps) {
            return ranges[ranges.length - 1];
        }
        return null;
    }

    /** 境界の後ろ側（右／先）に属するリハーサル名（A/B/…）。リハーサル名なし区間は空文字 */
    function rehearsalRehearsalMarkAfterGridBoundarySec(sec) {
        return rehearsalRehearsalMarkFromRange(rehearsalRangeAfterGridBoundarySec(sec));
    }

    function localBarNumberForRehearsalAtSec(rehearsalStartSec, sec, barBoundaries) {
        const rehearsalStartIdx = barIndexForBoundarySec(rehearsalStartSec, barBoundaries);
        const barIdx = barIndexForBoundarySec(sec, barBoundaries);
        const localBar = barIdx - rehearsalStartIdx + 1;
        return localBar >= 1 ? localBar : null;
    }

    /** Measure トラックと同じタイムライン全体の小節番号（1 始まり） */
    function barNumberAfterGridBoundarySec(sec) {
        if (!getMusicalGridVisible()) return null;
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return null;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return null;
        const pos = getMusicalGridBarBySec(settings.meterSpec, sec, master);
        if (!pos) return null;
        return (pos.barIndex | 0) + 1;
    }

    function musicalGridSeekToastPrimary(sec) {
        const rehearsalOn = getMusicalGridRehearsalFillVisible();
        const tempoOn = getMusicalGridVisible();
        const mark = rehearsalOn ? rehearsalRehearsalMarkAfterGridBoundarySec(sec) : '';
        const parts = [];
        if (mark) {
            parts.push(mark);
        } else if (rehearsalOn) {
            parts.push('Rehearsal');
        }
        if (tempoOn) {
            const measureNum = barNumberAfterGridBoundarySec(sec);
            if (measureNum != null && measureNum > 0) {
                parts.push('Measure ' + measureNum);
            }
        }
        if (parts.length) return parts.join(' ');
        return rehearsalOn ? 'Rehearsal' : 'Measure';
    }

    function flashMusicalGridSeekHint(targetSec, hintTc) {
        if (typeof flashSeekHint !== 'function') return;
        flashSeekHint(musicalGridSeekToastPrimary(targetSec), hintTc);
    }

    function seekToMusicalGridNavStop(stopSec, opt) {
        if (!Number.isFinite(stopSec)) return false;
        const o = opt && typeof opt === 'object' ? opt : {};
        const resumeAfter = !!o.resumeAfterSeek;
        let target = stopSec;
        if (typeof clampTransportSec === 'function') {
            target = clampTransportSec(target);
        }
        if (typeof suppressRangeLoopSnapForExplicitSeek === 'function') {
            suppressRangeLoopSnapForExplicitSeek();
        }
        const scrubOpt = Object.assign({ keyboardScrub: true }, o);
        if (
            o.discreteStopNav &&
            typeof applyDiscreteStopNavStep === 'function'
        ) {
            applyDiscreteStopNavStep(target, {
                resumeAfterSeek: resumeAfter,
                fromRepeat: o.fromRepeat,
            });
            {
                const hintTc =
                    typeof formatTimecodeForTransport === 'function'
                        ? formatTimecodeForTransport(target)
                        : String(target);
                const hintTitle = musicalGridSeekToastPrimary(target);
                if (!o.fromRepeat && typeof writeLog === 'function') {
                    writeLog('Grid: seek to ' + hintTitle + ' @ ' + hintTc);
                }
                flashMusicalGridSeekHint(target, hintTc);
            }
            return true;
        }
        if (
            typeof isKeyboardScrubLightweight === 'function' &&
            isKeyboardScrubLightweight(scrubOpt)
        ) {
            if (typeof applyKeyboardTransportScrubStep === 'function') {
                applyKeyboardTransportScrubStep(target, scrubOpt);
            } else if (typeof applyTransportUiImmediate === 'function') {
                applyTransportUiImmediate(target, { lightweight: true, keyboardScrub: true });
            }
            if (
                !o.fromRepeat &&
                !(
                    typeof isKeyboardTransportScrubActive === 'function' &&
                    isKeyboardTransportScrubActive()
                )
            ) {
                const hintTc =
                    typeof formatTimecodeForTransport === 'function'
                        ? formatTimecodeForTransport(target)
                        : String(target);
                const hintTitle = musicalGridSeekToastPrimary(target);
                if (typeof writeLog === 'function') {
                    writeLog('Grid: seek to ' + hintTitle + ' @ ' + hintTc);
                }
                flashMusicalGridSeekHint(target, hintTc);
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
        const hintTc =
            typeof formatTimecodeForTransport === 'function'
                ? formatTimecodeForTransport(target)
                : String(target);
        const hintTitle = musicalGridSeekToastPrimary(target);
        if (typeof writeLog === 'function') {
            writeLog('Grid: seek to ' + hintTitle + ' @ ' + hintTc);
        }
        flashMusicalGridSeekHint(target, hintTc);
        return true;
    }
    function coalescedStopNavTransportSec(fallbackSec) {
        if (Number.isFinite(fallbackSec)) return fallbackSec;
        if (typeof getCoalescedStopNavTransportSec === 'function') {
            return getCoalescedStopNavTransportSec();
        }
        if (typeof getTransportSec === 'function') return getTransportSec();
        if (typeof videoMain !== 'undefined' && videoMain) {
            return videoMain.currentTime || 0;
        }
        return 0;
    }

    function resolveAdjacentMusicalGridStopSec(dir, fromSec) {
        const stops = collectMusicalGridNavStops();
        const n = stops.length;
        if (!n) return null;
        const t = coalescedStopNavTransportSec(fromSec);
        const idx = musicalGridNavStopIndexForCurrent(stops, t);
        const eps = musicalGridNavStopEpsilonSec();
        let next;
        if (idx < 0) {
            if (dir <= 0) return null;
            next = 0;
        } else if (dir < 0 && t > stops[idx] + eps) {
            next = idx;
        } else if (dir > 0 && t < stops[idx] - eps) {
            next = idx;
        } else {
            next = idx + dir;
            if (next < 0 || next >= n) return null;
        }
        const sec = stops[next];
        return Number.isFinite(sec) ? sec : null;
    }

    function jumpToAdjacentMusicalGridStop(dir, opt) {
        const targetSec = resolveAdjacentMusicalGridStopSec(dir);
        if (targetSec == null) return false;
        return seekToMusicalGridNavStop(targetSec, opt);
    }

    function collectMusicalGridBarNavStops() {
        return collectMusicalGridBarSnapStopsForNav();
    }

    function hasMusicalGridBarNavStops() {
        return collectMusicalGridBarNavStops().length > 0;
    }

    function resolveAdjacentMusicalGridBarStopSec(dir, fromSec) {
        const stops = collectMusicalGridBarNavStops();
        const n = stops.length;
        if (!n) return null;
        const t = coalescedStopNavTransportSec(fromSec);
        const idx = musicalGridNavStopIndexForCurrent(stops, t);
        const eps = musicalGridNavStopEpsilonSec();
        let next;
        if (idx < 0) {
            if (dir <= 0) return null;
            next = 0;
        } else if (dir < 0 && t > stops[idx] + eps) {
            next = idx;
        } else if (dir > 0 && t < stops[idx] - eps) {
            next = idx;
        } else {
            next = idx + dir;
            if (next < 0 || next >= n) return null;
        }
        const sec = stops[next];
        return Number.isFinite(sec) ? sec : null;
    }

    function jumpToAdjacentMusicalGridBarStop(dir, opt) {
        const targetSec = resolveAdjacentMusicalGridBarStopSec(dir);
        if (targetSec == null) return false;
        return seekToMusicalGridNavStop(targetSec, opt);
    }

    function musicalGridBarNavResumeAfterSeek() {
        return typeof isTransportUiClockActive === 'function'
            ? isTransportUiClockActive()
            : typeof isTransportPlaying === 'function'
              ? isTransportPlaying()
              : typeof videoMain !== 'undefined' && videoMain
                ? !videoMain.paused
                : false;
    }

    /** Tempo/Sig ON 時 — 修飾キーなし Home/End で小節線のみ前後へ */
    function handleMusicalGridBarNavKeydown(e) {
        if (!getMusicalGridVisible()) return false;
        if (typeof transportControlsReady !== 'function' || !transportControlsReady()) {
            return false;
        }
        if (
            typeof isMusicalGridBarNavEvent !== 'function' ||
            !isMusicalGridBarNavEvent(e, { allowRepeat: true })
        ) {
            return false;
        }
        if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return false;
        const dir =
            typeof isMusicalGridBarNavNextEvent === 'function' &&
            isMusicalGridBarNavNextEvent(e, { allowRepeat: true })
                ? 1
                : -1;
        const navOpt = {
            resumeAfterSeek: musicalGridBarNavResumeAfterSeek(),
            discreteStopNav: true,
            fromRepeat: e.repeat,
        };
        jumpToAdjacentMusicalGridBarStop(dir, navOpt);
        e.preventDefault();
        return true;
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
    function repositionRehearsalBoundaryHandlesFromSnapshot() {
        if (!rehearsalBoundaryRoot || rehearsalBoundaryRoot.hidden) return;
        const ranges = getRehearsalGroupRangesSnapshot();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0) || ranges.length < 2) return;
        const handles = rehearsalBoundaryRoot.querySelectorAll(
            '.audio-waveform-composite__rehearsal-boundary-handle',
        );
        for (let i = 0; i < handles.length && i < ranges.length - 1; i++) {
            handles[i].style.left =
                transportSecToOverlayLeftPercent(ranges[i].endSec, master) + '%';
        }
    }
    const rehearsalBoundaryRoot =
        typeof audioWaveformLanesInner !== 'undefined' && audioWaveformLanesInner
            ? (() => {
                  const root = document.createElement('div');
                  root.className = 'audio-waveform-composite__rehearsal-boundaries';
                  root.hidden = true;
                  root.setAttribute('aria-hidden', 'true');
                  audioWaveformLanesInner.appendChild(root);
                  return root;
              })()
            : null;
    let rehearsalBoundaryDragActive = false;
    let rehearsalBoundaryDragPointerId = null;
    let rehearsalBoundaryDragBoundaryIndex = -1;
    let rehearsalBoundaryDragBarBoundaries = null;
    let rehearsalBoundaryDragCounts = null;
    let rehearsalBoundaryDragStartCounts = null;
    let rehearsalBoundaryDragStartBoundaryIndex = -1;
    let rehearsalBoundaryDragStartBarK = -1;
    let rehearsalBoundaryDragStartClientX = 0;
    let rehearsalBoundaryDragDocMove = null;
    let rehearsalBoundaryDragDocUp = null;
    function getWaveformLanesElForRehearsalDrag() {
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
    function detachRehearsalBoundaryDragDocListeners() {
        if (rehearsalBoundaryDragDocMove) {
            document.removeEventListener('pointermove', rehearsalBoundaryDragDocMove);
            rehearsalBoundaryDragDocMove = null;
        }
        if (rehearsalBoundaryDragDocUp) {
            document.removeEventListener('pointerup', rehearsalBoundaryDragDocUp);
            document.removeEventListener('pointercancel', rehearsalBoundaryDragDocUp);
            rehearsalBoundaryDragDocUp = null;
        }
    }

    function endRehearsalBoundaryDrag() {
        rehearsalBoundaryDragActive = false;
        rehearsalBoundaryDragPointerId = null;
        rehearsalBoundaryDragBoundaryIndex = -1;
        rehearsalBoundaryDragBarBoundaries = null;
        rehearsalBoundaryDragCounts = null;
        rehearsalBoundaryDragStartCounts = null;
        rehearsalBoundaryDragStartBoundaryIndex = -1;
        rehearsalBoundaryDragStartBarK = -1;
        rehearsalBoundaryDragStartClientX = 0;
        detachRehearsalBoundaryDragDocListeners();
        const lanes = getWaveformLanesElForRehearsalDrag();
        if (lanes) lanes.classList.remove('audio-waveform-composite__lanes--rehearsal-boundary-drag');
    }

    function syncRehearsalBoundaryDeferToRegionHandles(defer) {
        if (!rehearsalBoundaryRoot || rehearsalBoundaryRoot.hidden) return;
        if (rehearsalBoundaryDragActive) defer = false;
        rehearsalBoundaryRoot.classList.toggle(
            'audio-waveform-composite__rehearsal-boundaries--defer-regions',
            !!defer,
        );
    }

    function onRehearsalBoundaryHandlePointerDown(ev, boundaryIndex) {
        if (
            typeof tryBeginRegionHandleDragFromPointer === 'function' &&
            tryBeginRegionHandleDragFromPointer(ev)
        ) {
            return;
        }
        if (
            typeof isPointerInRegionEwCursorHitZone === 'function' &&
            isPointerInRegionEwCursorHitZone(ev.clientX, ev.clientY)
        ) {
            return;
        }
        if (!getMusicalGridRehearsalFillVisible()) return;
        if (ev.button !== 0) return;
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.rehearsalSpec) return;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return;
        const counts = expandRehearsalSpecToGroupBarCounts(
            settings.meterSpec,
            master,
            settings.rehearsalSpec,
        );
        if (counts.length < 2) return;
        const b = boundaryIndex | 0;
        if (b < 0 || b >= counts.length - 1) return;

        ev.preventDefault();
        ev.stopPropagation();
        if (typeof endAudioWaveformScrub === 'function') {
            endAudioWaveformScrub({ force: true });
        }

        const barBoundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(settings.meterSpec, master)
                : collectBarBoundarySecs(settings.meterSpec, master);
        rehearsalBoundaryDragActive = true;
        rehearsalBoundaryDragPointerId = ev.pointerId;
        rehearsalBoundaryDragBoundaryIndex = b;
        rehearsalBoundaryDragBarBoundaries = barBoundaries;
        rehearsalBoundaryDragCounts = counts.slice();
        rehearsalBoundaryDragStartCounts = counts.slice();
        rehearsalBoundaryDragStartBoundaryIndex = b;
        rehearsalBoundaryDragStartBarK = sumGroupBarCounts(counts, b) + counts[b];
        rehearsalBoundaryDragStartClientX = ev.clientX;

        const lanes = getWaveformLanesElForRehearsalDrag();
        if (lanes) lanes.classList.add('audio-waveform-composite__lanes--rehearsal-boundary-drag');

        rehearsalBoundaryDragDocMove = (e) => {
            if (!rehearsalBoundaryDragActive || e.pointerId !== rehearsalBoundaryDragPointerId) {
                return;
            }
            e.preventDefault();
            const startCounts = rehearsalBoundaryDragStartCounts;
            const b = rehearsalBoundaryDragStartBoundaryIndex;
            if (!startCounts || b < 0 || b >= startCounts.length - 1) return;
            const sumBefore = sumGroupBarCounts(startCounts, b);
            const minK = sumBefore;
            const maxK = sumBefore + startCounts[b] + startCounts[b + 1];
            const targetK = targetBarKForRehearsalBoundaryDrag(
                rehearsalBoundaryDragStartBarK,
                rehearsalBoundaryDragStartClientX,
                e.clientX,
                rehearsalBoundaryDragBarBoundaries,
                minK,
                maxK,
            );
            applyRehearsalBoundaryDragPreview(
                countsForRehearsalBoundaryAtBarIndex(startCounts, b, targetK),
            );
        };

        rehearsalBoundaryDragDocUp = (e) => {
            if (!rehearsalBoundaryDragActive || e.pointerId !== rehearsalBoundaryDragPointerId) {
                return;
            }
            e.preventDefault();
            const finalCounts = rehearsalBoundaryDragCounts;
            const startCounts = rehearsalBoundaryDragStartCounts;
            const boundaryIdx = rehearsalBoundaryDragStartBoundaryIndex;
            if (finalCounts && finalCounts.length) {
                if (!rehearsalGroupCountsEqual(startCounts, finalCounts)) {
                    if (typeof window.requestRegionUndoCapture === 'function') {
                        window.requestRegionUndoCapture({ includeRehearsal: true });
                    } else {
                        requestRehearsalUndoCapture();
                    }
                }
                applyExplicitRehearsalGroupBarCounts(finalCounts, { skipUndo: true });
                persistRehearsalWaveformEditAndRedraw({ skipUndo: true });
            }
            endRehearsalBoundaryDrag();
            if (finalCounts && finalCounts.length) {
                if (typeof writeLog === 'function') {
                    const mergedCount =
                        startCounts && startCounts.length > finalCounts.length
                            ? startCounts.length - finalCounts.length
                            : 0;
                    if (
                        mergedCount > 0 &&
                        wasLeftRehearsalAbsorbedIntoRight(startCounts, finalCounts, boundaryIdx)
                    ) {
                        const left = rehearsalGroupLabelForIndex(boundaryIdx);
                        const right = rehearsalGroupLabelForIndex(boundaryIdx + 1);
                        writeLog(
                            'Rehearsal ' +
                                left +
                                ' absorbed into ' +
                                right +
                                ': ' +
                                musicalGridRehearsalText,
                        );
                    } else if (mergedCount > 0) {
                        const left = rehearsalGroupLabelForIndex(boundaryIdx);
                        writeLog(
                            'Rehearsal ' +
                                left +
                                ' merged ' +
                                mergedCount +
                                ' rehearsal(s): ' +
                                musicalGridRehearsalText,
                        );
                    } else {
                        const left = rehearsalGroupLabelForIndex(boundaryIdx);
                        const right = rehearsalGroupLabelForIndex(boundaryIdx + 1);
                        writeLog(
                            'Rehearsal boundary ' +
                                left +
                                '/' +
                                right +
                                ': ' +
                                musicalGridRehearsalText,
                        );
                    }
                }
            }
        };

        document.addEventListener('pointermove', rehearsalBoundaryDragDocMove);
        document.addEventListener('pointerup', rehearsalBoundaryDragDocUp);
        document.addEventListener('pointercancel', rehearsalBoundaryDragDocUp);
    }

    function updateRehearsalBoundaryOverlay() {
        if (!rehearsalBoundaryRoot) return;
        while (rehearsalBoundaryRoot.firstChild) {
            rehearsalBoundaryRoot.removeChild(rehearsalBoundaryRoot.firstChild);
        }
        if (!getMusicalGridRehearsalFillVisible()) {
            rehearsalBoundaryRoot.hidden = true;
            return;
        }
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) {
            rehearsalBoundaryRoot.hidden = true;
            return;
        }
        let ranges = [];
        if (
            rehearsalBoundaryDragActive &&
            rehearsalBoundaryDragCounts &&
            rehearsalBoundaryDragCounts.length
        ) {
            const settings = musicalGridDrawSettings();
            if (settings && settings.meterSpec) {
                ranges = collectRehearsalGroupRangesFromBarCounts(
                    settings.meterSpec,
                    master,
                    rehearsalBoundaryDragCounts,
                );
            }
        } else if (typeof getRehearsalGroupRangesSnapshot === 'function') {
            ranges = getRehearsalGroupRangesSnapshot();
        }
        /* 境界ハンドル — 通常時はリハーサルマーク区間のみ（Rehearsal 欄小節数は使わない） */
        if (ranges.length < 2) {
            rehearsalBoundaryRoot.hidden = true;
            return;
        }
        rehearsalBoundaryRoot.hidden = false;
        for (let i = 0; i < ranges.length - 1; i++) {
            const boundarySec = ranges[i].endSec;
            const leftPct = transportSecToOverlayLeftPercent(boundarySec, master);
            const handle = document.createElement('div');
            handle.className = 'audio-waveform-composite__rehearsal-boundary-handle';
            handle.style.left = leftPct + '%';
            handle.dataset.boundaryIndex = String(i);
            const leftLabel =
                ranges[i].label != null && String(ranges[i].label).trim()
                    ? String(ranges[i].label).trim()
                    : rehearsalGroupLabelForIndex(ranges[i].paletteIndex);
            const rightLabel =
                ranges[i + 1].label != null && String(ranges[i + 1].label).trim()
                    ? String(ranges[i + 1].label).trim()
                    : rehearsalGroupLabelForIndex(ranges[i + 1].paletteIndex);
            handle.title =
                'Rehearsal ' +
                leftLabel +
                ' / ' +
                rightLabel +
                ' 境界（ドラッグで小節数調整・左端で右と結合・右へ結合）';
            handle.addEventListener('pointerdown', (ev) => {
                onRehearsalBoundaryHandlePointerDown(ev, i);
            });
            rehearsalBoundaryRoot.appendChild(handle);
        }
        if (typeof window.scheduleWaveformRegionOverlayRefresh === 'function') {
            window.scheduleWaveformRegionOverlayRefresh();
        }
    }

    function initMusicalGridUi() {
        try {
            const prefs = typeof readPrefs === 'function' ? readPrefs() : {};
            if (prefs.musicalGrid) {
                if (typeof musicalTrackPersistDiagLog === 'function') {
                    const rm = prefs.musicalGrid.rehearsalMarkTrackEvents;
                    musicalTrackPersistDiagLog('prefs/apply/begin', {
                        rehearsalMarkTrackEvents:
                            typeof musicalTrackPersistDiagSummarizeRehearsalEvents === 'function'
                                ? musicalTrackPersistDiagSummarizeRehearsalEvents(rm)
                                : {
                                      count: Array.isArray(rm) ? rm.length : 0,
                                      missing: !Array.isArray(rm),
                                  },
                    });
                }
                applyMusicalGridPersistSnapshot(prefs.musicalGrid);
                if (typeof musicalTrackPersistDiagLog === 'function') {
                    musicalTrackPersistDiagLog('prefs/apply/done', {
                        after:
                            typeof musicalTrackPersistDiagLiveState === 'function'
                                ? musicalTrackPersistDiagLiveState()
                                : null,
                    });
                }
            }
            if (typeof prefs.musicalGridVisible === 'boolean') {
                musicalGridVisible = prefs.musicalGridVisible;
            }
            if (typeof prefs.musicalGridRehearsalFillVisible === 'boolean') {
                musicalGridRehearsalFillVisible = prefs.musicalGridRehearsalFillVisible;
                if (
                    musicalGridRehearsalFillVisible &&
                    typeof window.ensureDefaultRehearsalMarkForRehearsalTint === 'function'
                ) {
                    window.ensureDefaultRehearsalMarkForRehearsalTint({ silent: true });
                }
            }
        } catch (_) {}

        syncMusicalGridVisibilityUi();
        if (typeof drawMusicalGridOverlay === 'function') drawMusicalGridOverlay();
        else if (typeof updateRehearsalBoundaryOverlay === 'function') updateRehearsalBoundaryOverlay();
        if (typeof refreshMusicalGridTracks === 'function') refreshMusicalGridTracks();

        if (musicalGridVisibleCheckbox) {
            musicalGridVisibleCheckbox.addEventListener('change', () => {
                setMusicalGridVisible(musicalGridVisibleCheckbox.checked);
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
    window.getMusicalGridRehearsalFillVisible = getMusicalGridRehearsalFillVisible;
    window.setMusicalGridRehearsalFillVisible = setMusicalGridRehearsalFillVisible;
    window.toggleMusicalGridRehearsalFillVisible = toggleMusicalGridRehearsalFillVisible;
    window.applyMusicalGridPersistSnapshot = applyMusicalGridPersistSnapshot;
    window.resetMusicalGridToDefaults = resetMusicalGridToDefaults;
    window.drawMusicalGridOverlay = drawMusicalGridOverlay;
    window.drawRehearsalFillOverlay = drawRehearsalFillOverlay;
    window.drawBarLinesOverlay = drawBarLinesOverlay;
    window.clearRegionSwapWaveformGridOverlays = clearRegionSwapWaveformGridOverlays;
    window.scheduleMusicalGridRedraw = scheduleMusicalGridRedraw;
    window.parseMeterSpec = parseMeterSpec;
    window.parseTempoStretchPrefix = parseTempoStretchPrefix;
    window.caretInTempoStretchPrefix = caretInTempoStretchPrefix;
    window.stretchPrefixDigitCaretOffset = stretchPrefixDigitCaretOffset;
    window.caretPosForStretchPrefixField = caretPosForStretchPrefixField;
    window.meterSpecStretchDeltaValid = meterSpecStretchDeltaValid;
    window.meterStretchDeltaOnlyChanged = meterStretchDeltaOnlyChanged;
    window.formatTempoStretchPrefix = formatTempoStretchPrefix;
    window.getCommittedMusicalGridMeterText = getCommittedMusicalGridMeterText;
    window.getMeterEntryForBar = getMeterEntryForBar;
    window.meterBarDurationSec = meterBarDurationSec;
    window.isAnyExtraTrackTempoStretched = isAnyExtraTrackTempoStretched;
    window.currentTempoStretchPlaybackRate = currentTempoStretchPlaybackRate;
    window.collectPlaybackAlignedBarBoundarySecs =
        collectPlaybackAlignedBarBoundarySecs;
    window.setTimelineMusicalSampleRate = setTimelineMusicalSampleRate;
    window.resolveTimelineMusicalSampleRate = resolveTimelineMusicalSampleRate;
    window.resolveRehearsalLayoutDurationSec = resolveRehearsalLayoutDurationSec;
    window.forEachMeterBarBeat = forEachMeterBarBeat;
    window.getMeterSigSegments = getMeterSigSegments;
    window.parseTimeSignatureSpec = parseTimeSignatureSpec;
    window.parseMusicalGridTempoBpm = parseMusicalGridTempoBpm;
    window.parseRehearsalGroupingSpec = parseRehearsalGroupingSpec;
    window.getRehearsalGroupRangesSnapshot = getRehearsalGroupRangesSnapshot;
    window.getRehearsalGroupRangesForRegionRehearsalMarks =
        getRehearsalGroupRangesForRegionRehearsalMarks;
    window.getRehearsalMarkNavRanges = getRehearsalMarkNavRanges;
    window.rehearsalRehearsalDisplayMarkForSlot = rehearsalRehearsalDisplayMarkForSlot;
    window.rehearsalGroupLabelForIndex = rehearsalGroupLabelForIndex;
    window.resolveRehearsalGroupAtTransportSec = resolveRehearsalGroupAtTransportSec;
    window.hasMusicalGridSnapStops = hasMusicalGridSnapStops;
    window.collectMusicalGridSnapStops = collectMusicalGridSnapStops;
    window.collectMusicalGridRegionMoveSnapStops = collectMusicalGridRegionMoveSnapStops;
    window.snapSecToMusicalGridStops = snapSecToMusicalGridStops;
    window.jumpToAdjacentMusicalGridStop = jumpToAdjacentMusicalGridStop;
    window.collectMusicalGridBarNavStops = collectMusicalGridBarNavStops;
    window.hasMusicalGridBarNavStops = hasMusicalGridBarNavStops;
    window.resolveAdjacentMusicalGridBarStopSec = resolveAdjacentMusicalGridBarStopSec;
    window.jumpToAdjacentMusicalGridBarStop = jumpToAdjacentMusicalGridBarStop;
    window.handleMusicalGridBarNavKeydown = handleMusicalGridBarNavKeydown;
    window.resolveAdjacentMusicalGridStopSec = resolveAdjacentMusicalGridStopSec;
    window.resolveMusicalGridPlayheadPositionText = resolveMusicalGridPlayheadPositionText;
    window.resolveMusicalGridPlayheadDisplay = resolveMusicalGridPlayheadDisplay;
    window.meterBeatDurationSecAtTransport = meterBeatDurationSecAtTransport;
    window.snapSecToMusicalGridQuarterNote = snapSecToMusicalGridQuarterNote;
    window.snapSecToMusicalGridBar = snapSecToMusicalGridBar;
    window.getMusicalGridBarSnapThresholdSec = getMusicalGridBarSnapThresholdSec;
    window.getMusicalGridSnapThresholdSec = getMusicalGridBarSnapThresholdSec;
    window.syncRehearsalBoundaryDeferToRegionHandles = syncRehearsalBoundaryDeferToRegionHandles;
    window.handleRegionBarJumpDialogKeydown = handleRegionBarJumpDialogKeydown;
    window.handleRegionBarNumberJumpKeydown = handleRegionBarNumberJumpKeydown;
    window.openRegionBarJumpDialog = openRegionBarJumpDialog;
    window.jumpToRegionLocalBarNumber = jumpToRegionLocalBarNumber;
    window.jumpToMeasureTrackBarNumber = jumpToMeasureTrackBarNumber;
    window.resolvePlaybackRegionSpanAtSeekbar = resolvePlaybackRegionSpanAtSeekbar;
    window.secForMeasureTrackBarNumber = secForMeasureTrackBarNumber;
    window.handleMusicalGridRehearsalSplitKeydown = handleMusicalGridRehearsalSplitKeydown;
    window.handleMusicalGridRehearsalDeleteKeydown = handleMusicalGridRehearsalDeleteKeydown;
    window.handleMusicalGridRehearsalJoinKeydown = handleMusicalGridRehearsalJoinKeydown;
    window.joinRehearsalAtTarget = joinRehearsalAtTarget;
    window.joinRehearsalAtRegionBoundary = joinRehearsalAtRegionBoundary;
    window.resolveRehearsalBoundaryDragAtRegionBoundary = resolveRehearsalBoundaryDragAtRegionBoundary;
    window.previewRehearsalBoundaryDragFromRegionPointer = previewRehearsalBoundaryDragFromRegionPointer;
    window.commitRehearsalBoundaryDragFromRegion = commitRehearsalBoundaryDragFromRegion;
    window.cancelRehearsalBoundaryDragPreview = cancelRehearsalBoundaryDragPreview;
    window.joinRehearsalAtRegionSpan = joinRehearsalAtRegionSpan;
    window.handleMusicalGridRehearsalUndoKeydown = handleMusicalGridRehearsalUndoKeydown;
    window.handleMusicalGridRehearsalRedoKeydown = handleMusicalGridRehearsalRedoKeydown;
    window.undoRehearsalDefinition = undoRehearsalDefinition;
    window.redoRehearsalDefinition = redoRehearsalDefinition;
    window.splitRehearsalAtWaveformPointer = splitRehearsalAtWaveformPointer;
    window.deleteRehearsalAtWaveformPointer = deleteRehearsalAtWaveformPointer;
    window.spliceRehearsalGroupAtIndex = spliceRehearsalGroupAtIndex;
    window.swapRehearsalGroupsAtIndices = swapRehearsalGroupsAtIndices;
    window.swapRehearsalSpecCycleSizesAtIndices = swapRehearsalSpecCycleSizesAtIndices;
    window.swapRehearsalExpandedGroupBlocksAtIndices = swapRehearsalExpandedGroupBlocksAtIndices;
    window.getExpandedRehearsalGroupBarCountsSnapshot = function getExpandedRehearsalGroupBarCountsSnapshot() {
        readMusicalGridFromInputs();
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return [];
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return [];
        const layoutDuration =
            typeof resolveRehearsalLayoutDurationSec === 'function'
                ? resolveRehearsalLayoutDurationSec(
                      settings.meterSpec,
                      master,
                      settings.rehearsalSpec,
                  )
                : master;
        return resolveRehearsalGroupBarCounts(
            settings.meterSpec,
            layoutDuration,
            settings.rehearsalSpec,
        );
    };
    window.clearMusicalGridPositionCache = clearMusicalGridPositionCache;
    window.clearRehearsalGroupBarCountsOverride = clearRehearsalGroupBarCountsOverride;
    window.setRehearsalGroupBarCountsOverride = setRehearsalGroupBarCountsOverride;
    window.compressRehearsalDefinitionFromExpandedCounts =
        compressRehearsalDefinitionFromExpandedCounts;
    window.repairRehearsalSpecToSizes = repairRehearsalSpecToSizes;
    /** RegionSwap — 展開 counts から Rehearsal 欄テキストを再構成して反映 */
    window.applyRehearsalGroupBarCountsForRegionSwap = function applyRehearsalGroupBarCountsForRegionSwap(
        counts,
        opt,
    ) {
        const o = opt && typeof opt === 'object' ? opt : {};
        applyExplicitRehearsalGroupBarCounts(counts, {
            skipUndo: !!o.skipUndo,
            preserveRehearsalText: false,
            optimize: o.optimize !== false,
        });
        if (o.relayoutRegions === false) {
            clearMusicalGridPositionCache();
            persistMusicalGridToStorage({ skipSessionPersist: !!o.skipSessionPersist });
            if (!o.skipGridRedraw) {
                scheduleMusicalGridRedraw();
            }
            return;
        }
        persistRehearsalWaveformEditAndRedraw({
            skipUndo: !!o.skipUndo,
            relayoutSilent: o.relayoutSilent !== false,
        });
    };
    /** 展開 counts から slot 先頭秒をプレビュー（RegionSwap 移動先計算用） */
    window.previewRehearsalSlotStartSecFromCounts = function previewRehearsalSlotStartSecFromCounts(
        counts,
        slotIndex,
    ) {
        readMusicalGridFromInputs();
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec || !counts || !counts.length) return null;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return null;
        const layoutDuration =
            typeof resolveRehearsalLayoutDurationSec === 'function'
                ? resolveRehearsalLayoutDurationSec(
                      settings.meterSpec,
                      master,
                      settings.rehearsalSpec,
                  )
                : master;
        const ranges = collectRehearsalGroupRangesFromBarCounts(
            settings.meterSpec,
            layoutDuration,
            counts,
        );
        const r = ranges[slotIndex | 0];
        return r && Number.isFinite(r.startSec) ? r.startSec : null;
    };
    window.resolveRehearsalGroupIndexAtTransportSec = resolveRehearsalGroupIndexAtTransportSec;
    window.formatRehearsalSlotMusicalMetaText = formatRehearsalSlotMusicalMetaText;
    window.formatMeterTextForBarRange = formatMeterTextForBarRange;
    window.spliceMusicalGridMeterForRemovedRehearsalGroup =
        spliceMusicalGridMeterForRemovedRehearsalGroup;
    window.getMusicalGridMeterDisplayText = getMusicalGridMeterDisplayText;
    window.musicalGridDrawSettings = musicalGridDrawSettings;
    window.getMusicalGridBarBySec = getMusicalGridBarBySec;
    window.collectRehearsalGroupRangesFromBarCounts = collectRehearsalGroupRangesFromBarCounts;
    window.formatRehearsalTextFromGroupBarCounts = formatRehearsalTextFromGroupBarCounts;
    window.captureRehearsalUndoSnapshot = captureRehearsalUndoSnapshot;
    window.restoreRehearsalUndoSnapshot = restoreRehearsalUndoSnapshot;

    initMusicalGridUi();
