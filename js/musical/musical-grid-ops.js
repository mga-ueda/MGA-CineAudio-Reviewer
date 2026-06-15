/**
 * musical-grid-ops.js — Phrase 結合・分割・入れ替え・公開 API
 */
    function swapPhraseSpecCycleSizesAtIndices(lo, hi, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        function reject(reason, extra) {
            phraseSwapDiagLog('spec-swap/rejected', { reason, ...(extra || {}) });
            return false;
        }
        if (!getMusicalGridPhraseFillVisible()) return reject('phrase fill off');
        readMusicalGridFromInputs();
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.phraseSpec || !settings.phraseSpec.sizes) {
            return reject('no phrase spec');
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
        const sizes = settings.phraseSpec.sizes.slice();
        if (loIdx >= sizes.length || hiIdx >= sizes.length) {
            return reject('index outside spec cycle', {
                lo: loIdx + 1,
                hi: hiIdx + 1,
                specLen: sizes.length,
            });
        }
        const barsLo = sizes[loIdx];
        const barsHi = sizes[hiIdx];
        if (!o.skipUndo) requestPhraseUndoCapture();
        const nextSizes = sizes.slice();
        const tmp = nextSizes[loIdx];
        nextSizes[loIdx] = nextSizes[hiIdx];
        nextSizes[hiIdx] = tmp;
        const phraseBefore = musicalGridPhraseText;
        const spec = { sizes: nextSizes };
        const counts = expandPhraseSpecToGroupBarCounts(
            settings.meterSpec,
            master,
            spec,
        );
        applyExplicitPhraseGroupBarCounts(counts, { skipUndo: true });
        persistPhraseWaveformEditAndRedraw({ relayoutSilent: true });
        if (typeof writeLog === 'function') {
            phraseSwapDiagLog('spec-swap/applied', {
                lo: loIdx + 1,
                hi: hiIdx + 1,
                barsLo,
                barsHi,
                before: phraseBefore,
                after: musicalGridPhraseText,
                textUnchanged: phraseBefore === musicalGridPhraseText,
            });
        }
        return true;
    }
    /**
     * 展開済み Phrase グループの連続ブロックを入れ替える（例: 16↔8+8）。
     * ブロック小節数合計が一致すること。
     */
    function swapPhraseExpandedGroupBlocksAtIndices(startA, countA, startB, countB, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        function reject(reason, extra) {
            phraseSwapDiagLog('block-swap/rejected', { reason, ...(extra || {}) });
            return false;
        }
        if (!getMusicalGridPhraseFillVisible()) return reject('phrase fill off');
        readMusicalGridFromInputs();
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.phraseSpec) return reject('no phrase spec');
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
        const counts = resolvePhraseGroupBarCounts(
            settings.meterSpec,
            master,
            settings.phraseSpec,
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
        if (!o.skipUndo) requestPhraseUndoCapture();
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
        const phraseBefore = musicalGridPhraseText;
        applyExplicitPhraseGroupBarCounts(next, {
            skipUndo: true,
            preservePhraseText: o.preservePhraseText !== false,
        });
        persistPhraseWaveformEditAndRedraw({ relayoutSilent: true });
        if (typeof writeLog === 'function') {
            phraseSwapDiagLog('block-swap/applied', {
                a0: a0 + 1,
                aN,
                b0: b0 + 1,
                bN,
                sumBars: sumA,
                before: phraseBefore,
                after: musicalGridPhraseText,
                textUnchanged: phraseBefore === musicalGridPhraseText,
            });
        }
        return true;
    }
    /** 展開済み Phrase グループ lo / hi の小節数定義を入れ替える（リージョン入れ替え E 用）。 */
    function swapPhraseGroupsAtIndices(lo, hi, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        function reject(reason, extra) {
            phraseSwapDiagLog('swap/rejected', { reason, ...(extra || {}) });
            return false;
        }
        if (!getMusicalGridPhraseFillVisible()) return reject('phrase fill off');
        readMusicalGridFromInputs();
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.phraseSpec) return reject('no phrase spec');
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
        const counts = expandPhraseSpecToGroupBarCounts(
            settings.meterSpec,
            master,
            settings.phraseSpec,
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
        if (!o.skipUndo) requestPhraseUndoCapture();
        const next = counts.slice();
        const tmp = next[loIdx];
        next[loIdx] = next[hiIdx];
        next[hiIdx] = tmp;
        const phraseBefore = musicalGridPhraseText;
        applyExplicitPhraseGroupBarCounts(next, { skipUndo: true });
        persistPhraseWaveformEditAndRedraw({ relayoutSilent: true });
        if (typeof writeLog === 'function') {
            phraseSwapDiagLog('swap/applied', {
                lo: loIdx + 1,
                hi: hiIdx + 1,
                barsLo,
                barsHi,
                before: phraseBefore,
                after: musicalGridPhraseText,
                textUnchanged: phraseBefore === musicalGridPhraseText,
            });
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
    /** 無音 Phrase スロット削除 — グループ g を隣接へマージせず除去。1 件残る場合は null。 */
    function splicePhraseGroupAtIndex(counts, groupIndex) {
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
    function deletePhraseAtWaveformPointer() {
        silentGapDeleteDiagFromGrid('phrase-delete/begin', {
            gridVisible: getMusicalGridVisible(),
            phraseFillVisible: getMusicalGridPhraseFillVisible(),
            boundaryDrag: !!phraseBoundaryDragActive,
            silentGapSelected:
                typeof window.hasSilentGapRegionSelection === 'function' &&
                window.hasSilentGapRegionSelection(),
        });
        if (!getMusicalGridVisible()) {
            silentGapDeleteDiagFromGrid('phrase-delete/reject', { reason: 'grid-off' });
            return false;
        }
        if (phraseBoundaryDragActive) {
            silentGapDeleteDiagFromGrid('phrase-delete/reject', { reason: 'boundary-drag' });
            return false;
        }
        if (
            typeof window.hasSilentGapRegionSelection === 'function' &&
            window.hasSilentGapRegionSelection()
        ) {
            silentGapDeleteDiagFromGrid('phrase-delete/defer', {
                reason: 'silent-gap-selected',
                to: 'region-delete',
            });
            return false;
        }
        const target = resolvePhraseEditTransportSec();
        if (!target) {
            silentGapDeleteDiagFromGrid('phrase-delete/reject', { reason: 'transport-unresolved' });
            return false;
        }
        const { transportSec, useSeekbar } = target;
        if (
            typeof window.tryDeleteSilentGapAtPhraseEditPointer === 'function' &&
            window.tryDeleteSilentGapAtPhraseEditPointer(transportSec)
        ) {
            silentGapDeleteDiagFromGrid('phrase-delete/path', {
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
        if (!settings || !settings.phraseSpec) {
            silentGapDeleteDiagFromGrid('phrase-delete/reject', { reason: 'phrase-spec-missing' });
            return false;
        }
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
        if (!nextCounts) {
            silentGapDeleteDiagFromGrid('phrase-delete/reject', {
                reason: 'delete-group-failed',
                groupIndex,
            });
            return false;
        }
        const label = phraseGroupLabelForIndex(groupIndex);
        silentGapDeleteDiagFromGrid('phrase-delete/path', {
            path: 'phrase-grid-relayout',
            useSeekbar,
            transportSec,
            groupIndex,
            countsBefore: counts.slice(0, 12),
            countsAfter: nextCounts.slice(0, 12),
            phraseBefore: musicalGridPhraseText,
        });
        applyExplicitPhraseGroupBarCounts(nextCounts);
        persistPhraseWaveformEditAndRedraw({ skipUndo: true });
        silentGapDeleteDiagFromGrid('phrase-delete/done', {
            path: 'phrase-grid-relayout',
            phraseAfter: musicalGridPhraseText,
        });
        if (typeof logPhraseAction === 'function') {
            logPhraseAction(
                label +
                    ' deleted' +
                    (useSeekbar ? ' (seekbar)' : '') +
                    ': ' +
                    musicalGridPhraseText,
            );
        } else if (typeof writeLog === 'function') {
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
        silentGapDeleteDiagFromGrid('keydown/begin', { handler: 'musical-grid' });
        if (!deletePhraseAtWaveformPointer()) {
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
     * リージョン結合境界が Phrase スロット境界とどう対応するかを返す。
     * @returns {{ boundaryIndex: number, counts: number[]|null, relayoutOnly?: boolean }|null}
     */
    function resolvePhraseBoundaryJoinAtRegionBoundary(track, boundaryIndex) {
        if (!getMusicalGridPhraseFillVisible()) return null;
        if (!canCommitPhraseCompositionLayout()) return null;
        const b = boundaryIndex | 0;
        if (b < 0) return null;

        const counts = resolveCurrentExpandedPhraseGroupBarCounts();
        if (!counts || counts.length < 2) return null;

        if (
            typeof window.getSegmentRegionTimelineIn === 'function' &&
            typeof window.phraseSlotIndexAtRegionInSec === 'function'
        ) {
            const leftIn = window.getSegmentRegionTimelineIn(track, b);
            const rightIn = window.getSegmentRegionTimelineIn(track, b + 1);
            const leftSlot = window.phraseSlotIndexAtRegionInSec(leftIn);
            const rightSlot = window.phraseSlotIndexAtRegionInSec(rightIn);
            if (leftSlot != null && rightSlot != null) {
                if (rightSlot === leftSlot + 1) {
                    const next = mergePhraseGroupsAtBoundaryIndex(counts, leftSlot);
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
        const ranges = collectPhraseGroupRangesFromBarCounts(
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
                const next = mergePhraseGroupsAtBoundaryIndex(counts, i);
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
     * Phrase 着色 ON — リージョン結合境界が隣接フレーズグループ境界のとき、
     * フレーズ境界ハンドルドラッグと同じ bar スナップ／counts 更新用コンテキストを返す。
     */
    function resolvePhraseBoundaryDragAtRegionBoundary(track, boundaryIndex) {
        if (!getMusicalGridPhraseFillVisible()) return null;
        if (!canCommitPhraseCompositionLayout()) return null;
        const b = boundaryIndex | 0;
        if (b < 0) return null;

        const counts = resolveCurrentExpandedPhraseGroupBarCounts();
        if (!counts || counts.length < 2) return null;

        let phraseBoundaryIndex = -1;
        if (
            typeof window.getSegmentRegionTimelineIn === 'function' &&
            typeof window.phraseSlotIndexAtRegionInSec === 'function'
        ) {
            const leftIn = window.getSegmentRegionTimelineIn(track, b);
            const rightIn = window.getSegmentRegionTimelineIn(track, b + 1);
            const leftSlot = window.phraseSlotIndexAtRegionInSec(leftIn);
            const rightSlot = window.phraseSlotIndexAtRegionInSec(rightIn);
            if (leftSlot != null && rightSlot != null) {
                if (rightSlot === leftSlot + 1) {
                    phraseBoundaryIndex = leftSlot;
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

        if (phraseBoundaryIndex < 0) {
            const ranges = collectPhraseGroupRangesFromBarCounts(
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
                    phraseBoundaryIndex = i;
                    break;
                }
            }
        }

        if (phraseBoundaryIndex < 0 || phraseBoundaryIndex >= counts.length - 1) {
            return null;
        }

        const barBoundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(settings.meterSpec, master)
                : collectBarBoundarySecs(settings.meterSpec, master);
        const startBarK =
            sumGroupBarCounts(counts, phraseBoundaryIndex) + counts[phraseBoundaryIndex];
        return {
            phraseBoundaryIndex,
            startCounts: counts.slice(),
            barBoundaries,
            startBarK,
        };
    }
    function previewPhraseBoundaryDragFromRegionPointer(ctx, clientX, startClientX) {
        if (!ctx || !ctx.startCounts || !ctx.startCounts.length) return null;
        const startCounts = ctx.startCounts;
        const phraseB = ctx.phraseBoundaryIndex | 0;
        if (phraseB < 0 || phraseB >= startCounts.length - 1) return null;
        const sumBefore = sumGroupBarCounts(startCounts, phraseB);
        const minK = sumBefore;
        const maxK = sumBefore + startCounts[phraseB] + startCounts[phraseB + 1];
        const targetK = targetBarKForPhraseBoundaryDrag(
            ctx.startBarK,
            startClientX,
            clientX,
            ctx.barBoundaries,
            minK,
            maxK,
        );
        const newCounts = countsForPhraseBoundaryAtBarIndex(startCounts, phraseB, targetK);
        applyPhraseBoundaryDragPreview(newCounts);
        return newCounts;
    }
    function commitPhraseBoundaryDragFromRegion(startCounts, finalCounts, phraseBoundaryIndex, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!finalCounts || !finalCounts.length) return false;
        if (phraseGroupCountsEqual(startCounts, finalCounts)) return false;
        if (!o.skipUndo) {
            if (typeof window.requestRegionUndoCapture === 'function') {
                window.requestRegionUndoCapture({ includePhrase: true });
            } else {
                requestPhraseUndoCapture();
            }
        }
        applyExplicitPhraseGroupBarCounts(finalCounts, { skipUndo: true });
        persistPhraseWaveformEditAndRedraw({
            skipUndo: true,
            relayoutSilent: o.relayoutSilent !== false,
        });
        if (!phraseBoundaryDragActive) {
            phraseBoundaryDragCounts = null;
            drawMusicalGridOverlay();
            updatePhraseBoundaryOverlay();
        }
        return true;
    }
    function cancelPhraseBoundaryDragPreview() {
        if (phraseBoundaryDragActive) return;
        if (!phraseBoundaryDragCounts) return;
        phraseBoundaryDragCounts = null;
        drawMusicalGridOverlay();
        updatePhraseBoundaryOverlay();
    }
    /**
     * 連続セグメント lo..hi をまとめて結合 — Phrase 境界を右から左へ counts 更新後、1 回 relayout。
     * 同一 Phrase スロット内の分割のみ（relayoutOnly のみ）のときは false を返し、呼び出し側で segment 結合へ。
     */
    function joinPhraseAtRegionSpan(track, lo, hi, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const first = lo | 0;
        const last = hi | 0;
        if (last <= first) return false;
        if (!getMusicalGridPhraseFillVisible()) return false;
        if (!canCommitPhraseCompositionLayout()) return false;

        const phraseBoundaryIndices = [];
        let hasRelayoutOnly = false;
        for (let b = first; b < last; b++) {
            if (
                typeof window.isSegmentBoundaryJoinableAtIndex === 'function' &&
                !window.isSegmentBoundaryJoinableAtIndex(track, b)
            ) {
                return false;
            }
            const hit = resolvePhraseBoundaryJoinAtRegionBoundary(track, b);
            if (!hit) return false;
            if (hit.relayoutOnly) {
                hasRelayoutOnly = true;
            } else if (hit.counts) {
                phraseBoundaryIndices.push(hit.boundaryIndex);
            }
        }
        if (!phraseBoundaryIndices.length) return false;

        if (!o.skipUndo && typeof window.requestRegionUndoCapture === 'function') {
            window.requestRegionUndoCapture({ includePhrase: true });
        }

        if (
            hasRelayoutOnly &&
            typeof window.mergeSegmentSpanAt === 'function' &&
            !window.mergeSegmentSpanAt(track, first, last, {
                silent: true,
                skipUndo: true,
                skipPhraseRelayout: true,
            })
        ) {
            return false;
        }

        let counts = resolveCurrentExpandedPhraseGroupBarCounts();
        if (!counts) return false;
        phraseBoundaryIndices.sort((a, b) => b - a);
        for (let i = 0; i < phraseBoundaryIndices.length; i++) {
            counts = mergePhraseGroupsAtBoundaryIndex(counts, phraseBoundaryIndices[i]);
            if (!counts) return false;
        }

        const phraseBefore = musicalGridPhraseText;
        applyExplicitPhraseGroupBarCounts(counts, { skipUndo: true });
        persistPhraseWaveformEditAndRedraw({
            skipUndo: true,
            relayoutSilent: o.relayoutSilent !== false,
        });

        phraseSwapDiagLog('region-bond/span-applied', {
            ex: (track.slot | 0) + 1,
            regionLo: first + 1,
            regionHi: last + 1,
            phraseBoundaries: phraseBoundaryIndices.map((i) => i + 1),
            before: phraseBefore,
            after: musicalGridPhraseText,
        });
        return true;
    }
    /** Phrase 着色 ON — リージョン境界ボンドで counts 更新＋構成どおりに切り直し */
    function joinPhraseAtRegionBoundary(track, boundaryIndex, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const hit = resolvePhraseBoundaryJoinAtRegionBoundary(track, boundaryIndex);
        if (!hit) return false;

        if (!o.skipUndo && typeof window.requestRegionUndoCapture === 'function') {
            window.requestRegionUndoCapture({ includePhrase: true });
        }

        const phraseBefore = musicalGridPhraseText;
        if (hit.counts) {
            applyExplicitPhraseGroupBarCounts(hit.counts, { skipUndo: true });
        }
        persistPhraseWaveformEditAndRedraw({
            skipUndo: true,
            relayoutSilent: o.relayoutSilent !== false,
        });

        phraseSwapDiagLog('region-bond/applied', {
            ex: (track.slot | 0) + 1,
            regionBoundary: (boundaryIndex | 0) + 1,
            phraseBoundary: hit.boundaryIndex + 1,
            relayoutOnly: !!hit.relayoutOnly,
            before: phraseBefore,
            after: musicalGridPhraseText,
        });

        if (!(o.silent)) {
            if (hit.relayoutOnly) {
                const relayoutMsg =
                    formatExTrack(track.slot) +
                    ' regions joined at boundary ' +
                    ((boundaryIndex | 0) + 1) +
                    ' (phrase relayout)';
                if (typeof logRegionAction === 'function') {
                    logRegionAction(relayoutMsg);
                } else if (typeof writeLog === 'function') {
                    writeLog(
                        'Ex ' +
                            ((track.slot | 0) + 1) +
                            ': regions joined at boundary ' +
                            ((boundaryIndex | 0) + 1) +
                            ' (phrase relayout)',
                    );
                }
            } else {
                const left = phraseGroupLabelForIndex(hit.boundaryIndex);
                const right = phraseGroupLabelForIndex(hit.boundaryIndex + 1);
                const joinMsg =
                    left +
                    '/' +
                    right +
                    ' joined at region boundary: ' +
                    musicalGridPhraseText;
                if (typeof logPhraseAction === 'function') {
                    logPhraseAction(joinMsg);
                } else if (typeof writeLog === 'function') {
                    writeLog('Phrase ' + joinMsg);
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
                const left = phraseGroupLabelForIndex(hit.boundaryIndex);
                const right = phraseGroupLabelForIndex(hit.boundaryIndex + 1);
                flashSeekHint('Phrase', 'Joined ' + left + '/' + right, 'notice');
            }
        }
        return true;
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
        const left = phraseGroupLabelForIndex(hit.boundaryIndex);
        const right = phraseGroupLabelForIndex(hit.boundaryIndex + 1);
        applyExplicitPhraseGroupBarCounts(hit.counts);
        persistPhraseWaveformEditAndRedraw({ skipUndo: true });
        if (typeof logPhraseAction === 'function') {
            logPhraseAction(
                left +
                    '/' +
                    right +
                    ' joined' +
                    (useSeekbar ? ' (seekbar)' : '') +
                    ': ' +
                    musicalGridPhraseText,
            );
        } else if (typeof writeLog === 'function') {
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
        if (
            getMusicalGridPhraseFillVisible() &&
            typeof window.joinPlaybackRegionAtPointer === 'function' &&
            window.joinPlaybackRegionAtPointer()
        ) {
            e.preventDefault();
            e.stopPropagation();
            return true;
        }
        const phraseJoined = joinPhraseAtTarget();
        e.preventDefault();
        if (phraseJoined) e.stopPropagation();
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
            // 最終グループは duration まで伸ばす（テンポストレッチ後の端数小節を別 Phrase にしない）
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
    /** Ctrl+←→ ナビ用: 小節線 + Phrase 境界のみ（拍線は含めない） */
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
        return dedupeSortedMusicalGridStops(
            collectMusicalGridBarSnapStops().concat(collectPhraseGroupSnapStops()),
        );
    }
    function collectMusicalGridNavStops() {
        const key = musicalGridNavStopsCacheKeyNow();
        if (musicalGridNavStopsCache && musicalGridNavStopsCacheKey === key) {
            return musicalGridNavStopsCache;
        }
        const stops = dedupeSortedMusicalGridStops(
            collectMusicalGridBarSnapStopsForNav().concat(collectPhraseGroupSnapStops()),
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

    /** 境界の後ろ側（右／先）に属する Phrase 範囲 */
    function phraseRangeAfterGridBoundarySec(sec) {
        const ranges = resolvePhraseGroupRanges({ requireFillVisible: false });
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

    /** 境界の後ろ側（右／先）に属するリハーサル名（A/B/…）。R. Offset 時のリハーサル名なしは空文字 */
    function phraseRehearsalMarkAfterGridBoundarySec(sec) {
        const range = phraseRangeAfterGridBoundarySec(sec);
        return range ? phraseRehearsalDisplayMarkForSlot(range.paletteIndex) : '';
    }

    function localBarNumberForPhraseAtSec(phraseStartSec, sec, barBoundaries) {
        const phraseStartIdx = barIndexForBoundarySec(phraseStartSec, barBoundaries);
        const barIdx = barIndexForBoundarySec(sec, barBoundaries);
        const localBar = barIdx - phraseStartIdx + 1;
        return localBar >= 1 ? localBar : null;
    }

    function barNumberAfterGridBoundarySec(sec) {
        if (!getMusicalGridVisible()) return null;
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return null;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return null;
        const phraseRange = phraseRangeAfterGridBoundarySec(sec);
        if (phraseRange) {
            const barBoundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(settings.meterSpec, master)
                : collectBarBoundarySecs(settings.meterSpec, master);
            if (barBoundaries.length) {
                const localBar = localBarNumberForPhraseAtSec(
                    phraseRange.startSec,
                    sec,
                    barBoundaries,
                );
                if (localBar != null && localBar >= 1) return localBar;
            }
        }
        const pos = getMusicalGridBarBySec(settings.meterSpec, sec, master);
        if (!pos) return null;
        return (pos.barIndex | 0) + 1;
    }

    function musicalGridSeekToastPrimary(sec) {
        const phraseOn = getMusicalGridPhraseFillVisible();
        const tempoOn = getMusicalGridVisible();
        const mark = phraseOn ? phraseRehearsalMarkAfterGridBoundarySec(sec) : '';
        const parts = [];
        if (mark) {
            parts.push(mark);
        } else if (phraseOn) {
            parts.push('Phrase');
        }
        if (tempoOn) {
            const barNum = barNumberAfterGridBoundarySec(sec);
            if (barNum != null && barNum > 0) {
                parts.push('Bar ' + barNum);
            }
        }
        if (parts.length) return parts.join(' ');
        return phraseOn ? 'Phrase' : 'Bar';
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
            if (!o.fromRepeat) {
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
    function resolveAdjacentMusicalGridStopSec(dir, fromSec) {
        const stops = collectMusicalGridNavStops();
        const n = stops.length;
        if (!n) return null;
        const idx = musicalGridNavStopIndexForCurrent(stops, fromSec);
        const t = Number.isFinite(fromSec)
            ? fromSec
            : typeof getTransportSec === 'function'
              ? getTransportSec()
              : typeof videoMain !== 'undefined' && videoMain
                ? videoMain.currentTime || 0
                : 0;
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
    let meterCommitInFlight = false;
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

        const barBoundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(settings.meterSpec, master)
                : collectBarBoundarySecs(settings.meterSpec, master);
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
                    if (typeof window.requestRegionUndoCapture === 'function') {
                        window.requestRegionUndoCapture({ includePhrase: true });
                    } else {
                        requestPhraseUndoCapture();
                    }
                }
                applyExplicitPhraseGroupBarCounts(finalCounts, { skipUndo: true });
                persistPhraseWaveformEditAndRedraw({ skipUndo: true });
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
                        const left = phraseGroupLabelForIndex(boundaryIdx);
                        const right = phraseGroupLabelForIndex(boundaryIdx + 1);
                        writeLog(
                            'Phrase ' +
                                left +
                                ' absorbed into ' +
                                right +
                                ': ' +
                                musicalGridPhraseText,
                        );
                    } else if (mergedCount > 0) {
                        const left = phraseGroupLabelForIndex(boundaryIdx);
                        writeLog(
                            'Phrase ' +
                                left +
                                ' merged ' +
                                mergedCount +
                                ' phrase(s): ' +
                                musicalGridPhraseText,
                        );
                    } else {
                        const left = phraseGroupLabelForIndex(boundaryIdx);
                        const right = phraseGroupLabelForIndex(boundaryIdx + 1);
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
        if (typeof window.scheduleWaveformRegionOverlayRefresh === 'function') {
            window.scheduleWaveformRegionOverlayRefresh();
        }
    }

    function focusMusicalGridMeterEditor() {
        if (!musicalGridMeterInput) return false;
        musicalGridMeterInput.focus();
        musicalGridMeterInput.select();
        return true;
    }

    function focusMusicalGridPhraseEditor() {
        if (!musicalGridPhraseInput) return false;
        musicalGridPhraseInput.focus();
        musicalGridPhraseInput.select();
        return true;
    }

    function switchMusicalGridEditorFocus(next) {
        readMusicalGridFromInputs();
        clearMusicalGridPositionCache();
        if (next === 'phrase') return focusMusicalGridPhraseEditor();
        return focusMusicalGridMeterEditor();
    }

    function handleMusicalGridEditorTabKeydown(e, from) {
        if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return false;
        e.preventDefault();
        switchMusicalGridEditorFocus(from === 'meter' ? 'phrase' : 'meter');
        scheduleMusicalGridAutosave();
        return true;
    }

    function commitMusicalGridMeterEditor() {
        if (meterCommitInFlight) return;
        const stretchPrevSpec =
            typeof parseMeterSpec === 'function'
                ? parseMeterSpec(
                      typeof getMusicalGridMeterLayoutBaseline === 'function'
                          ? getMusicalGridMeterLayoutBaseline()
                          : getCommittedMusicalGridMeterText(),
                  )
                : null;
        const stretchNextSpec =
            typeof parseMeterSpec === 'function'
                ? parseMeterSpec(
                      musicalGridMeterInput
                          ? musicalGridMeterInput.value
                          : getCommittedMusicalGridMeterText(),
                  )
                : null;
        const stretchDeltaOnlyPending =
            typeof meterStretchDeltaOnlyChanged === 'function' &&
            meterStretchDeltaOnlyChanged(stretchPrevSpec, stretchNextSpec);
        const stretchWillChange =
            stretchPrevSpec &&
            stretchNextSpec &&
            typeof computeTempoStretchRateFromSpec === 'function' &&
            typeof isTempoStretchActiveForSpec === 'function' &&
            (Math.abs(
                computeTempoStretchRateFromSpec(stretchPrevSpec) -
                    computeTempoStretchRateFromSpec(stretchNextSpec),
            ) > 0.00001 ||
                isTempoStretchActiveForSpec(stretchPrevSpec) !==
                    isTempoStretchActiveForSpec(stretchNextSpec));
        meterCommitInFlight = true;
        const run = async () => {
            try {
                persistMusicalGridAndRedraw({
                    relayoutSlotsFromMeter: false,
                    strictMeterCommit: true,
                    skipTimelineSlotRebuild: stretchDeltaOnlyPending,
                });
                if (typeof applyTempoStretchForCurrentMeter === 'function') {
                    await applyTempoStretchForCurrentMeter({ prevSpec: stretchPrevSpec });
                }
                if (
                    stretchWillChange &&
                    typeof setTempoStretchPendingRelayout === 'function'
                ) {
                    setTempoStretchPendingRelayout(true);
                }
                const committedSpec =
                    typeof parseMeterSpec === 'function'
                        ? parseMeterSpec(getCommittedMusicalGridMeterText())
                        : null;
                const stretchDeltaOnly =
                    typeof meterStretchDeltaOnlyChanged === 'function' &&
                    meterStretchDeltaOnlyChanged(stretchPrevSpec, committedSpec);
                persistMusicalGridAndRedraw({
                    skipMeterCommit: true,
                    relayoutSlotsFromMeter: true,
                    forceRelayoutFromMeter: true,
                    preservePhraseTextOnMeterRelayout: stretchDeltaOnly,
                    stretchPrevSpec: stretchPrevSpec,
                    stretchNextSpec: committedSpec,
                    strictMeterCommit: true,
                });
                if (musicalGridMeterInput) musicalGridMeterInput.blur();
                if (typeof scheduleWaveformFocusRestore === 'function') {
                    scheduleWaveformFocusRestore();
                }
            } finally {
                meterCommitInFlight = false;
                if (typeof clearTempoStretchPendingRelayout === 'function') {
                    clearTempoStretchPendingRelayout();
                }
                if (
                    stretchWillChange &&
                    typeof window.pruneRegionUndoStackIncompatibleWithCurrentTransport ===
                        'function'
                ) {
                    window.pruneRegionUndoStackIncompatibleWithCurrentTransport();
                }
            }
        };
        void run();
    }

    function cancelMusicalGridMeterEditor() {
        const restore = getMusicalGridMeterLayoutBaseline();
        musicalGridMeterText = restore;
        if (musicalGridMeterInput) musicalGridMeterInput.value = restore;
        clearMusicalGridPositionCache();
        scheduleMusicalGridRedraw();
        if (musicalGridMeterInput) musicalGridMeterInput.blur();
        if (typeof scheduleWaveformFocusRestore === 'function') scheduleWaveformFocusRestore();
    }

    async function commitMusicalGridPhraseEditor() {
        commitPhraseInputUndoIfChanged();
        phraseInputCommitViaEnter = true;
        const savePromise = persistMusicalGridAndRedraw({
            relayoutRegions: true,
            relayoutSilent: false,
            skipUndo: true,
            compressPhrase: true,
        });
        if (savePromise && typeof savePromise.then === 'function') {
            await savePromise;
        }
        if (musicalGridPhraseInput) musicalGridPhraseInput.blur();
        if (typeof scheduleWaveformFocusRestore === 'function') scheduleWaveformFocusRestore();
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
        if (typeof drawMusicalGridOverlay === 'function') drawMusicalGridOverlay();
        else if (typeof updatePhraseBoundaryOverlay === 'function') updatePhraseBoundaryOverlay();

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
            musicalGridMeterInput.addEventListener('focus', () => {
                syncMusicalGridMeterLayoutBaseline(getCommittedMusicalGridMeterText());
            });
            musicalGridMeterInput.addEventListener('input', onInput);
            musicalGridMeterInput.addEventListener('change', () => {
                commitMusicalGridMeterEditor();
            });
            musicalGridMeterInput.addEventListener('keydown', (e) => {
                if (handleMusicalGridEditorTabKeydown(e, 'meter')) return;
                if (
                    (e.key === '+' || e.key === '-') &&
                    !e.altKey &&
                    !e.ctrlKey &&
                    !e.metaKey
                ) {
                    const raw = musicalGridMeterInput
                        ? normalizeMusicalGridMeterText(musicalGridMeterInput.value)
                        : '';
                    const caret = musicalGridMeterInput
                        ? musicalGridMeterInput.selectionStart
                        : 0;
                    if (
                        typeof caretInTempoStretchPrefix === 'function' &&
                        caretInTempoStretchPrefix(raw, caret) &&
                        typeof bumpMeterStretchDeltaBy === 'function'
                    ) {
                        e.preventDefault();
                        bumpMeterStretchDeltaBy(e.key === '+' ? 1 : -1);
                        return;
                    }
                    if (
                        typeof insertMeterStretchSignAtEditorStart === 'function' &&
                        insertMeterStretchSignAtEditorStart(e.key)
                    ) {
                        e.preventDefault();
                        return;
                    }
                }
                if (
                    matchUserShortcut(e, 'musicalGridInputArrowUp', { allowRepeat: true }) ||
                    matchUserShortcut(e, 'musicalGridInputArrowDown', { allowRepeat: true })
                ) {
                    e.preventDefault();
                    const dir = matchUserShortcut(e, 'musicalGridInputArrowUp', { allowRepeat: true }) ? 1 : -1;
                    const bpmStep = (e.shiftKey ? 10 : 1) * dir;
                    const sigStep = (e.shiftKey ? 10 : 1) * dir;
                    bumpMeterFieldBy(bpmStep, sigStep);
                    return;
                }
                if (matchUserShortcut(e, 'cancelEditing', { allowRepeat: true })) {
                    e.preventDefault();
                    cancelMusicalGridMeterEditor();
                    return;
                }
                if (matchUserShortcut(e, 'submitEditing', { allowRepeat: true })) {
                    e.preventDefault();
                    commitMusicalGridMeterEditor();
                    return;
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
                if (phraseInputCommitViaEnter) {
                    phraseInputCommitViaEnter = false;
                    return;
                }
                clearPhraseGroupBarCountsOverride();
                commitPhraseInputUndoIfChanged();
                persistMusicalGridAndRedraw({
                    skipUndo: true,
                    compressPhrase: true,
                });
            });
            musicalGridPhraseInput.addEventListener('keydown', async (e) => {
                if (handleMusicalGridEditorTabKeydown(e, 'phrase')) return;
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
                if (matchUserShortcut(e, 'submitEditing', { allowRepeat: true }) ||
                    matchUserShortcut(e, 'cancelEditing', { allowRepeat: true })) {
                    e.preventDefault();
                    await commitMusicalGridPhraseEditor();
                    return;
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
    window.focusMusicalGridMeterEditor = focusMusicalGridMeterEditor;
    window.focusMusicalGridPhraseEditor = focusMusicalGridPhraseEditor;
    window.applyMusicalGridPersistSnapshot = applyMusicalGridPersistSnapshot;
    window.resetMusicalGridToDefaults = resetMusicalGridToDefaults;
    window.drawMusicalGridOverlay = drawMusicalGridOverlay;
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
    window.forEachMeterBarBeat = forEachMeterBarBeat;
    window.getMeterSigSegments = getMeterSigSegments;
    window.parseTimeSignatureSpec = parseTimeSignatureSpec;
    window.parseMusicalGridTempoBpm = parseMusicalGridTempoBpm;
    window.parsePhraseGroupingSpec = parsePhraseGroupingSpec;
    window.getPhraseGroupRangesSnapshot = getPhraseGroupRangesSnapshot;
    window.getPhraseGroupRangesForRegionRehearsalMarks =
        getPhraseGroupRangesForRegionRehearsalMarks;
    window.phraseGroupLabelForIndex = phraseGroupLabelForIndex;
    window.resolvePhraseGroupAtTransportSec = resolvePhraseGroupAtTransportSec;
    window.hasMusicalGridSnapStops = hasMusicalGridSnapStops;
    window.collectMusicalGridSnapStops = collectMusicalGridSnapStops;
    window.snapSecToMusicalGridStops = snapSecToMusicalGridStops;
    window.jumpToAdjacentMusicalGridStop = jumpToAdjacentMusicalGridStop;
    window.resolveAdjacentMusicalGridStopSec = resolveAdjacentMusicalGridStopSec;
    window.jumpToAdjacentPhrase = jumpToAdjacentPhrase;
    window.resolveMusicalGridPlayheadPositionText = resolveMusicalGridPlayheadPositionText;
    window.meterBeatDurationSecAtTransport = meterBeatDurationSecAtTransport;
    window.snapSecToMusicalGridQuarterNote = snapSecToMusicalGridQuarterNote;
    window.syncPhraseBoundaryDeferToRegionHandles = syncPhraseBoundaryDeferToRegionHandles;
    window.handleRegionBarNumberJumpKeydown = handleRegionBarNumberJumpKeydown;
    window.jumpToRegionLocalBarNumber = jumpToRegionLocalBarNumber;
    window.resolvePlaybackRegionSpanAtSeekbar = resolvePlaybackRegionSpanAtSeekbar;
    window.handleMusicalGridPhraseSplitKeydown = handleMusicalGridPhraseSplitKeydown;
    window.handleMusicalGridPhraseDeleteKeydown = handleMusicalGridPhraseDeleteKeydown;
    window.handleMusicalGridPhraseJoinKeydown = handleMusicalGridPhraseJoinKeydown;
    window.joinPhraseAtTarget = joinPhraseAtTarget;
    window.joinPhraseAtRegionBoundary = joinPhraseAtRegionBoundary;
    window.resolvePhraseBoundaryDragAtRegionBoundary = resolvePhraseBoundaryDragAtRegionBoundary;
    window.previewPhraseBoundaryDragFromRegionPointer = previewPhraseBoundaryDragFromRegionPointer;
    window.commitPhraseBoundaryDragFromRegion = commitPhraseBoundaryDragFromRegion;
    window.cancelPhraseBoundaryDragPreview = cancelPhraseBoundaryDragPreview;
    window.joinPhraseAtRegionSpan = joinPhraseAtRegionSpan;
    window.handleMusicalGridPhraseUndoKeydown = handleMusicalGridPhraseUndoKeydown;
    window.handleMusicalGridPhraseRedoKeydown = handleMusicalGridPhraseRedoKeydown;
    window.undoPhraseDefinition = undoPhraseDefinition;
    window.redoPhraseDefinition = redoPhraseDefinition;
    window.splitPhraseAtWaveformPointer = splitPhraseAtWaveformPointer;
    window.deletePhraseAtWaveformPointer = deletePhraseAtWaveformPointer;
    window.splicePhraseGroupAtIndex = splicePhraseGroupAtIndex;
    window.swapPhraseGroupsAtIndices = swapPhraseGroupsAtIndices;
    window.swapPhraseSpecCycleSizesAtIndices = swapPhraseSpecCycleSizesAtIndices;
    window.swapPhraseExpandedGroupBlocksAtIndices = swapPhraseExpandedGroupBlocksAtIndices;
    window.getExpandedPhraseGroupBarCountsSnapshot = function getExpandedPhraseGroupBarCountsSnapshot() {
        readMusicalGridFromInputs();
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
    };
    window.clearMusicalGridPositionCache = clearMusicalGridPositionCache;
    window.clearPhraseGroupBarCountsOverride = clearPhraseGroupBarCountsOverride;
    window.setPhraseGroupBarCountsOverride = setPhraseGroupBarCountsOverride;
    window.compressPhraseDefinitionFromExpandedCounts =
        compressPhraseDefinitionFromExpandedCounts;
    window.repairPhraseSpecToSizes = repairPhraseSpecToSizes;
    /** RegionSwap — 展開 counts から Phrase 欄テキストを再構成して反映 */
    window.applyPhraseGroupBarCountsForRegionSwap = function applyPhraseGroupBarCountsForRegionSwap(
        counts,
        opt,
    ) {
        const o = opt && typeof opt === 'object' ? opt : {};
        applyExplicitPhraseGroupBarCounts(counts, {
            skipUndo: !!o.skipUndo,
            preservePhraseText: false,
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
        persistPhraseWaveformEditAndRedraw({
            skipUndo: !!o.skipUndo,
            relayoutSilent: o.relayoutSilent !== false,
        });
    };
    /** 展開 counts から slot 先頭秒をプレビュー（RegionSwap 移動先計算用） */
    window.previewPhraseSlotStartSecFromCounts = function previewPhraseSlotStartSecFromCounts(
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
        const ranges = collectPhraseGroupRangesFromBarCounts(
            settings.meterSpec,
            master,
            counts,
        );
        const r = ranges[slotIndex | 0];
        return r && Number.isFinite(r.startSec) ? r.startSec : null;
    };
    window.resolvePhraseGroupIndexAtTransportSec = resolvePhraseGroupIndexAtTransportSec;
    window.formatPhraseSlotMusicalMetaText = formatPhraseSlotMusicalMetaText;
    window.formatMeterTextForBarRange = formatMeterTextForBarRange;
    window.getMusicalGridMeterDisplayText = getMusicalGridMeterDisplayText;
    window.musicalGridDrawSettings = musicalGridDrawSettings;
    window.getMusicalGridBarBySec = getMusicalGridBarBySec;
    window.collectPhraseGroupRangesFromBarCounts = collectPhraseGroupRangesFromBarCounts;
    window.formatPhraseTextFromGroupBarCounts = formatPhraseTextFromGroupBarCounts;
    window.capturePhraseUndoSnapshot = capturePhraseUndoSnapshot;
    window.restorePhraseUndoSnapshot = restorePhraseUndoSnapshot;

    initMusicalGridUi();
