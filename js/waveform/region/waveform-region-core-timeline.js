/**
 * waveform-region-core-timeline.js — タイムライン修復・無音 gap・入れ替え
 */
    window.repairTrackMicroTimelineGaps = repairTrackMicroTimelineGaps;
    function mergeTimelineCoverageIntervals(intervals, eps) {
        if (!intervals.length) return [];
        const sorted = intervals.slice().sort((a, b) => a.startSec - b.startSec);
        const merged = [{ startSec: sorted[0].startSec, endSec: sorted[0].endSec }];
        for (let i = 1; i < sorted.length; i++) {
            const iv = sorted[i];
            const last = merged[merged.length - 1];
            if (iv.startSec <= last.endSec + eps) {
                last.endSec = Math.max(last.endSec, iv.endSec);
            } else {
                merged.push({ startSec: iv.startSec, endSec: iv.endSec });
            }
        }
        return merged;
    }
    function subtractTimelineCoverage(rangeStart, rangeEnd, covers, eps) {
        const out = [];
        let cursor = rangeStart;
        for (let i = 0; i < covers.length; i++) {
            const c = covers[i];
            if (c.startSec > cursor + eps) {
                out.push({
                    startSec: cursor,
                    endSec: Math.min(c.startSec, rangeEnd),
                });
            }
            cursor = Math.max(cursor, c.endSec);
            if (cursor >= rangeEnd - eps) break;
        }
        if (cursor < rangeEnd - eps) {
            out.push({ startSec: cursor, endSec: rangeEnd });
        }
        return out.filter((u) => u.endSec - u.startSec > eps);
    }
    /** セグメントコピー列のタイムライン重なり診断（クロスフェード検出用） */
    function regionSwapDiagCheckSegmentTimelineOverlaps(track, segments, stage) {
        if (!segments || !segments.length) return { crossfade: false, overlaps: [] };
        const eps = segmentBoundaryJoinEpsilonSec();
        const rows = [];
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (!seg) continue;
            const regionIn = segmentCopyRegionIn(seg);
            const regionOut = segmentCopyRegionOut(seg);
            rows.push({
                region: i + 1,
                regionIn: regionSwapDiagFmtSec(regionIn),
                regionOut: regionSwapDiagFmtSec(regionOut),
                sourceDur: regionSwapDiagFmtSec(segmentCopySourceDurSec(seg)),
            });
        }
        const overlaps = [];
        for (let i = 0; i < segments.length; i++) {
            const a = segments[i];
            if (!a) continue;
            const aIn = segmentCopyRegionIn(a);
            const aOut = segmentCopyRegionOut(a);
            for (let j = i + 1; j < segments.length; j++) {
                const b = segments[j];
                if (!b) continue;
                const bIn = segmentCopyRegionIn(b);
                const bOut = segmentCopyRegionOut(b);
                const overlapSec = Math.min(aOut, bOut) - Math.max(aIn, bIn);
                if (overlapSec > eps) {
                    overlaps.push({
                        a: i + 1,
                        b: j + 1,
                        overlapSec: regionSwapDiagFmtSec(overlapSec),
                        aSpan: regionSwapDiagFmtSec(aIn) + '–' + regionSwapDiagFmtSec(aOut),
                        bSpan: regionSwapDiagFmtSec(bIn) + '–' + regionSwapDiagFmtSec(bOut),
                    });
                }
            }
        }
        const crossfade = overlaps.length > 0;
        regionSwapDiagLog('swap/overlap-check/' + (stage || 'check'), {
            crossfade,
            overlapCount: overlaps.length,
            overlaps,
            segments: rows,
        });
        return { crossfade, overlaps, segments: rows };
    }
    /**
     * タイムライン順の隣接 Region Out/In を整列（移動由来の sub-frame 誤差のみ）。
     * - 重なり解消: |gap| ≲ eps×8 のみ（大きな重なりは rehearsal 配置の結果 — 触らない）
     * - 微小隙間: 同閾値以内かつ segment index がタイムライン順と一致するときのみ
     * - タイムライン順が segment index 逆転（入れ替え直後）のペアはスキップ
     */
    function eliminateSegmentCopyTimelineOverlaps(track, segments, t0, opt) {
        if (!segments || !segments.length) return false;
        const layoutOpt = opt && typeof opt === 'object' ? opt : {};
        const resolveOverlap = layoutOpt.resolveOverlap !== false;
        const closeMicroGaps = layoutOpt.closeMicroGaps !== false;
        if (!resolveOverlap && !closeMicroGaps) return false;
        const eps = segmentBoundaryJoinEpsilonSec();
        const maxMicroSec = eps * 8;
        const abutTol = eps * 0.5;
        let changed = false;
        const maxPass = Math.max(2, segments.length + 1);
        for (let pass = 0; pass < maxPass; pass++) {
            const order = segments
                .map((_, i) => i)
                .sort((a, b) => {
                    const da = segmentCopyRegionIn(segments[a]);
                    const db = segmentCopyRegionIn(segments[b]);
                    if (Math.abs(da - db) > 1e-12) return da - db;
                    return a - b;
                });
            const adjustments = [];
            for (let o = 1; o < order.length; o++) {
                const prevIdx = order[o - 1];
                const curIdx = order[o];
                const prevSeg = segments[prevIdx];
                const curSeg = segments[curIdx];
                if (!prevSeg || !curSeg) continue;
                const prevOut = segmentCopyRegionOut(prevSeg);
                const curIn = segmentCopyRegionIn(curSeg);
                const gap = curIn - prevOut;
                if (Math.abs(gap) <= abutTol) continue;
                const isOverlap =
                    resolveOverlap && gap < -abutTol && -gap <= maxMicroSec;
                const isMicroGap =
                    closeMicroGaps && gap > abutTol && gap <= maxMicroSec;
                // 重なり解消は index 逆転ペアではスキップ — 微小隙間の吸着のみ許可
                if (curIdx <= prevIdx && !isMicroGap) continue;
                if (!isOverlap && !isMicroGap) continue;
                const targetIn = prevOut;
                if (isMicroGap) {
                    const rehearsalBefore = rehearsalSlotIndexAtRegionInSec(curIn);
                    const rehearsalAfter = rehearsalSlotIndexAtRegionInSec(targetIn);
                    if (
                        rehearsalBefore != null &&
                        rehearsalAfter != null &&
                        rehearsalBefore !== rehearsalAfter
                    ) {
                        continue;
                    }
                }
                const delta = targetIn - curIn;
                if (Math.abs(delta) <= abutTol * 0.5) continue;
                applyTimelineDeltaToRawSegment(track, curIdx, curSeg, delta, t0);
                adjustments.push({
                    kind: isOverlap ? 'overlap' : 'micro-gap',
                    region: curIdx + 1,
                    after: prevIdx + 1,
                    gap: regionSwapDiagFmtSec(gap),
                    from: regionSwapDiagFmtSec(curIn),
                    to: regionSwapDiagFmtSec(targetIn),
                    delta: regionSwapDiagFmtSec(delta),
                });
            }
            if (!adjustments.length) break;
            changed = true;
            regionSwapDiagLog('swap/timeline-abut', { pass: pass + 1, adjustments });
        }
        return changed;
    }
    /** タイムライン上の sub-frame 微小隙間を吸着（セッション復元後・手動修復用） */
    function repairTrackMicroTimelineGaps(track, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const segments = getTrackSegments(track);
        if (!segments || segments.length < 2) return false;
        const copies = segments.map((s) => ({ ...s }));
        const t0 = getTrackTimelineStartSec(track);
        snapshotSegmentTimelineAnchorsOnCopies(track, copies);
        const changed = eliminateSegmentCopyTimelineOverlaps(track, copies, t0, {
            resolveOverlap: o.resolveOverlap === true,
            closeMicroGaps: o.closeMicroGaps !== false,
        });
        if (!changed) return false;
        regionSwapDiagLog('repair/micro-gaps', {
            ex: isExtraTrackRef(track) ? track.slot + 1 : null,
            stage: o.stage || 'manual',
        });
        const normalized = copies.map((s) =>
            normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
        );
        setTrackSegments(track, normalized, {
            silent: o.silent !== false,
            skipUndo: true,
            segmentStructureChanged: true,
            affectedSegmentIndices: normalized.map((_, i) => i),
        });
        return true;
    }
    function finalizeSegmentCopyTimelineLayout(track, segments, t0, stage, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        eliminateSegmentCopyTimelineOverlaps(track, segments, t0, {
            resolveOverlap: !o.skipOverlapResolve,
            closeMicroGaps: !o.skipMicroGapClose,
        });
        return regionSwapDiagCheckSegmentTimelineOverlaps(track, segments, stage);
    }
    window.finalizeSegmentCopyTimelineLayout = finalizeSegmentCopyTimelineLayout;
    window.snapshotSegmentTimelineAnchorsOnCopies = snapshotSegmentTimelineAnchorsOnCopies;
    window.fitPartialSwapUnitToTimelineSpan = fitPartialSwapUnitToTimelineSpan;
    window.alignRegionSwapUnitToSlotSpan = alignRegionSwapUnitToSlotSpan;
    /** 入れ替え前: 全セグメントの絶対タイムライン位置を segments コピーへ固定 */
    function snapshotSegmentTimelineAnchorsOnCopies(track, segments) {
        if (!segments || !segments.length) return;
        for (let i = 0; i < segments.length; i++) {
            segments[i].timelineStartSec = getSegmentTimelineStart(track, i);
            segments[i].regionTimelineInSec = getSegmentRegionTimelineIn(track, i);
        }
    }
    function applyTimelineDeltaToRawSegment(track, segmentIndex, seg, delta, t0) {
        if (!seg || !Number.isFinite(delta) || Math.abs(delta) < 0.00001) return;
        const anchor = Number.isFinite(seg.timelineStartSec)
            ? seg.timelineStartSec
            : getSegmentTimelineStart(track, segmentIndex);
        const regionIn = Number.isFinite(seg.regionTimelineInSec)
            ? seg.regionTimelineInSec
            : anchor;
        applySegmentToSilentGapPosition(track, segmentIndex, seg, regionIn + delta, t0);
    }
    /** 無音Rehearsal スロット先頭へリージョン In を合わせる（In パッドは維持） */
    function applySegmentToSilentGapPosition(track, segmentIndex, seg, targetRegionIn, t0) {
        if (!seg || !Number.isFinite(targetRegionIn)) return;
        const anchor = Number.isFinite(seg.timelineStartSec)
            ? seg.timelineStartSec
            : getSegmentTimelineStart(track, segmentIndex);
        const regionIn = Number.isFinite(seg.regionTimelineInSec)
            ? seg.regionTimelineInSec
            : getSegmentRegionTimelineIn(track, segmentIndex);
        const delta = targetRegionIn - regionIn;
        if (Math.abs(delta) < 0.00001) return;
        if (Number.isFinite(seg.regionTimelineOutSec)) {
            seg.timelineStartSec = anchor + delta;
            seg.regionTimelineInSec = Math.max(0, regionIn + delta);
            seg.regionTimelineOutSec = seg.regionTimelineOutSec + delta;
            return;
        }
        const inPad = Math.max(0, regionIn - anchor);
        const newAnchor = targetRegionIn - inPad;
        seg.timelineStartSec = newAnchor;
        seg.regionTimelineInSec = Math.max(0, targetRegionIn);
        // live state（headPad / regionTimelineInSec）は setTrackSegments 確定時に
        // syncTrackHeadPadFromFirstSegment へ委譲 — プレビュー配置中の live 更新は
        // 入れ替えアニメの「旧位置」取得を壊すため行わない
    }
    /** Rehearsal グループ除去後 — 残存 timelineSlots の rehearsalSlotIndex を詰める */
    function remapTimelineSlotRehearsalIndicesAfterGroupRemoval(track, removedIndex) {
        if (!isExtraTrackRef(track)) return;
        const state = getPlaybackRegionsState(track);
        const slots =
            state && Array.isArray(state.timelineSlots) ? state.timelineSlots : null;
        if (!slots || !slots.length) return;
        const ri = removedIndex | 0;
        const remapped = [];
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (!slot || !slot.musical) continue;
            const psi = slot.musical.rehearsalSlotIndex | 0;
            if (psi > ri) {
                remapped.push({ unit: i, from: psi + 1, to: psi });
                slot.musical.rehearsalSlotIndex = psi - 1;
            }
        }
        silentGapDeleteDiagLog('remap/rehearsal-slot-index', {
            ex: track.slot + 1,
            removedRehearsalSlot: ri + 1,
            remapped,
        });
    }

    /** 波形ポインタ位置の無音 gap を削除（Rehearsal 欄 Delete の全切り直しを避ける） */
    function tryDeleteSilentGapAtRehearsalEditPointer(transportSec) {
        silentGapDeleteDiagLog('pointer/begin', {
            transportSec: regionSwapDiagFmtSec(transportSec),
            rehearsalFillOn:
                typeof getMusicalGridRehearsalFillVisible === 'function' &&
                getMusicalGridRehearsalFillVisible(),
        });
        if (
            typeof getMusicalGridRehearsalFillVisible !== 'function' ||
            !getMusicalGridRehearsalFillVisible()
        ) {
            silentGapDeleteDiagLog('pointer/reject', { reason: 'rehearsal-fill-off' });
            return false;
        }
        if (!Number.isFinite(transportSec)) {
            silentGapDeleteDiagLog('pointer/reject', { reason: 'transport-invalid' });
            return false;
        }
        const n = getExtraTrackCount();
        let slot = -1;
        if (typeof getWaveformPointerClientY === 'function') {
            const clientY = getWaveformPointerClientY();
            if (Number.isFinite(clientY) && typeof extraSlotFromPointerY === 'function') {
                slot = extraSlotFromPointerY(clientY);
            }
        }
        const tryTrack = (track) => {
            const probe = silentGapDeleteDiagSnapshotTrack(track);
            if (!isTrackRegionActive(track)) {
                silentGapDeleteDiagLog('pointer/track-skip', {
                    ex: track.slot + 1,
                    reason: 'region-inactive',
                    probe,
                });
                return false;
            }
            const gapIdx = resolveSilentGapListIndexAtTransport(track, transportSec);
            silentGapDeleteDiagLog('pointer/track-probe', {
                ex: track.slot + 1,
                gapIndex: gapIdx,
                probe,
            });
            if (gapIdx < 0) return false;
            const ok = deleteSilentGapAt(track, gapIdx, { skipClearSelection: true });
            silentGapDeleteDiagLog('pointer/track-delete', {
                ex: track.slot + 1,
                gapIndex: gapIdx,
                ok: !!ok,
                after: silentGapDeleteDiagSnapshotTrack(track),
            });
            return ok;
        };
        if (slot >= 0) {
            silentGapDeleteDiagLog('pointer/lane', { ex: slot + 1 });
            return tryTrack({ type: 'extra', slot });
        }
        silentGapDeleteDiagLog('pointer/scan-all-tracks', { extraCount: n });
        for (let s = 0; s < n; s++) {
            if (tryTrack({ type: 'extra', slot: s })) return true;
        }
        silentGapDeleteDiagLog('pointer/miss', { reason: 'no-gap-at-transport' });
        return false;
    }

    function isGridOnlySegmentEntry(seg, eps) {
        if (!seg) return false;
        const inS = Number(seg.sourceInSec) || 0;
        const outS = Number(seg.sourceOutSec) || 0;
        return outS - inS <= eps;
    }

    /** gap 内に収まるファイル未消費（GAC 先頭グリッド等）セグメント index */
    function collectGridOnlySegmentIndicesInsideGap(track, gap, eps) {
        const indices = [];
        if (!gap || !isExtraTrackRef(track)) return indices;
        const segments = getTrackSegments(track);
        for (let si = 0; si < segments.length; si++) {
            if (!isGridOnlySegmentEntry(segments[si], eps)) continue;
            const regionIn = getSegmentRegionTimelineIn(track, si);
            const regionOut = getSegmentRegionTimelineOut(track, si);
            if (!(regionOut - regionIn > eps)) continue;
            if (regionIn >= gap.startSec - eps && regionOut <= gap.endSec + eps * 4) {
                indices.push(si);
            }
        }
        return indices;
    }

    /** gap 区間の内部に音源リージョンが無い（境界のみ）= 専用無音Rehearsal 区間の削除 */
    function isDedicatedSilentRehearsalGapDelete(track, gap) {
        if (!gap || !isExtraTrackRef(track)) return false;
        const eps = segmentBoundaryJoinEpsilonSec();
        const segments = getTrackSegments(track);
        for (let si = 0; si < segments.length; si++) {
            if (isGridOnlySegmentEntry(segments[si], eps)) continue;
            const regionIn = getSegmentRegionTimelineIn(track, si);
            if (regionIn > gap.startSec + eps * 4 && regionIn < gap.endSec - eps * 4) {
                return false;
            }
            const regionOut = getSegmentRegionTimelineOut(track, si);
            const lo = Math.max(regionIn, gap.startSec);
            const hi = Math.min(regionOut, gap.endSec);
            if (hi - lo > eps * 8) return false;
        }
        return true;
    }

    /** Rehearsal 定義テキスト優先でグループ除去後の counts を構築 */
    function buildRehearsalCountsAfterSilentGapSplice(pi, fallbackCounts) {
        const rehearsalText = regionSwapDiagRehearsalText();
        if (rehearsalText && typeof window.parseRehearsalGroupingSpec === 'function') {
            const spec = window.parseRehearsalGroupingSpec(rehearsalText);
            if (spec && spec.sizes && spec.sizes.length >= 2 && pi < spec.sizes.length) {
                const sizes = spec.sizes.slice();
                sizes.splice(pi, 1);
                if (sizes.length) {
                    return { next: sizes.slice(), source: 'rehearsal-spec' };
                }
            }
        }
        if (typeof window.spliceRehearsalGroupAtIndex === 'function') {
            const next = window.spliceRehearsalGroupAtIndex(fallbackCounts, pi);
            if (next) return { next, source: 'expanded-counts' };
        }
        return null;
    }

    /** 無音 gap 削除時の Rehearsal counts 更新方針（リップル前のトラック状態で判定） */
    function resolveSilentGapRehearsalCountUpdate(gap, track, counts, pi) {
        const slotBars = counts[pi] | 0;
        const spanBars =
            typeof estimateSilentGapBarSpan === 'function'
                ? estimateSilentGapBarSpan(gap) | 0
                : 0;
        const dedicatedSilent = isDedicatedSilentRehearsalGapDelete(track, gap);

        if (gap.partial && !dedicatedSilent) {
            return {
                mode: 'ripple-only',
                next: counts.slice(),
                countsBefore: counts.slice(),
                shrinkOnly: false,
                skipRehearsalApply: true,
                dedicatedSilent,
                spanBars,
                slotBars,
                countsSource: 'unchanged',
            };
        }
        if (
            gap.partial &&
            dedicatedSilent &&
            spanBars > 0 &&
            slotBars > 0 &&
            spanBars < slotBars
        ) {
            const next = counts.slice();
            next[pi] = Math.max(1, slotBars - spanBars);
            return {
                mode: 'shrink-partial',
                next,
                countsBefore: counts.slice(),
                shrinkOnly: true,
                skipRehearsalApply: false,
                dedicatedSilent,
                spanBars,
                slotBars,
                countsSource: 'shrink',
            };
        }
        const spliced = buildRehearsalCountsAfterSilentGapSplice(pi, counts);
        if (!spliced || !spliced.next) return null;
        return {
            mode: dedicatedSilent ? 'splice-dedicated' : 'splice',
            next: spliced.next,
            countsBefore: counts.slice(),
            shrinkOnly: false,
            skipRehearsalApply: false,
            dedicatedSilent,
            spanBars,
            slotBars,
            countsSource: spliced.source,
        };
    }

    /** 無音 gap 削除に伴う Rehearsal 展開 counts を更新（リージョン全体の切り直しは行わない） */
    function syncRehearsalGridAfterSilentGapDelete(gap, track, precomputedPlan) {
        silentGapDeleteDiagLog('rehearsal-sync/begin', {
            ex: isExtraTrackRef(track) ? track.slot + 1 : null,
            gap: gap
                ? {
                      rehearsalSlot: Number.isFinite(gap.rehearsalIndex)
                          ? (gap.rehearsalIndex | 0) + 1
                          : null,
                      partial: !!gap.partial,
                      start: regionSwapDiagFmtSec(gap.startSec),
                      end: regionSwapDiagFmtSec(gap.endSec),
                  }
                : null,
            before: silentGapDeleteDiagSnapshotTrack(track),
        });
        if (
            typeof getMusicalGridRehearsalFillVisible !== 'function' ||
            !getMusicalGridRehearsalFillVisible()
        ) {
            silentGapDeleteDiagLog('rehearsal-sync/reject', { reason: 'rehearsal-fill-off' });
            return false;
        }
        if (!gap || !Number.isFinite(gap.rehearsalIndex) || gap.rehearsalIndex < 0) {
            silentGapDeleteDiagLog('rehearsal-sync/reject', { reason: 'gap-rehearsal-missing' });
            return false;
        }
        const pi = gap.rehearsalIndex | 0;
        const plan =
            precomputedPlan && precomputedPlan.next
                ? precomputedPlan
                : (() => {
                      const counts =
                          typeof window.getExpandedRehearsalGroupBarCountsSnapshot ===
                          'function'
                              ? window.getExpandedRehearsalGroupBarCountsSnapshot()
                              : [];
                      if (!counts.length || pi >= counts.length) return null;
                      return resolveSilentGapRehearsalCountUpdate(gap, track, counts, pi);
                  })();
        if (!plan || !plan.next) {
            silentGapDeleteDiagLog('rehearsal-sync/reject', { reason: 'counts-update-failed' });
            return false;
        }
        const countsBefore =
            precomputedPlan && precomputedPlan.countsBefore
                ? precomputedPlan.countsBefore.slice()
                : typeof window.getExpandedRehearsalGroupBarCountsSnapshot === 'function'
                  ? window.getExpandedRehearsalGroupBarCountsSnapshot()
                  : [];
        const rehearsalBefore = regionSwapDiagRehearsalText();
        silentGapDeleteDiagLog('rehearsal-sync/plan', {
            mode: plan.mode,
            dedicatedSilent: plan.dedicatedSilent,
            partial: !!gap.partial,
            spanBars: plan.spanBars || null,
            slotBars: plan.slotBars || null,
            countsSource: plan.countsSource || null,
            countsAfter: plan.next.slice(0, 12),
            skipRehearsalApply: !!plan.skipRehearsalApply,
            precomputed: !!precomputedPlan,
        });
        if (!plan.skipRehearsalApply) {
            silentGapDeleteDiagLog('rehearsal-sync/apply', {
                mode: plan.mode,
                shrinkOnly: !!plan.shrinkOnly,
                relayoutRegions: false,
                optimize: false,
                compress: true,
            });
            if (typeof window.applyRehearsalGroupBarCountsForRegionSwap === 'function') {
                window.applyRehearsalGroupBarCountsForRegionSwap(plan.next, {
                    skipUndo: true,
                    relayoutRegions: false,
                    optimize: false,
                });
            } else if (typeof window.clearRehearsalGroupBarCountsOverride === 'function') {
                window.clearRehearsalGroupBarCountsOverride();
            }
            if (!plan.shrinkOnly && isExtraTrackRef(track)) {
                remapTimelineSlotRehearsalIndicesAfterGroupRemoval(track, pi);
            }
            if (
                !plan.shrinkOnly &&
                countsBefore.length &&
                pi < countsBefore.length &&
                typeof window.spliceMusicalGridMeterForRemovedRehearsalGroup === 'function'
            ) {
                const meterChanged = window.spliceMusicalGridMeterForRemovedRehearsalGroup(
                    countsBefore,
                    pi,
                );
                silentGapDeleteDiagLog('rehearsal-sync/meter-splice', {
                    rehearsalSlot: pi + 1,
                    removedBars: countsBefore[pi] | 0,
                    changed: !!meterChanged,
                });
            }
            if (typeof window.compressRehearsalDefinitionFromExpandedCounts === 'function') {
                const rehearsalMid = regionSwapDiagRehearsalText();
                const compressed = window.compressRehearsalDefinitionFromExpandedCounts({
                    skipUndo: true,
                });
                silentGapDeleteDiagLog('rehearsal-sync/compress', {
                    changed: !!compressed,
                    rehearsalMid,
                    rehearsalAfter: regionSwapDiagRehearsalText(),
                });
            }
        }
        silentGapDeleteDiagLog('rehearsal-sync/done', {
            rehearsalBefore,
            rehearsalAfter: regionSwapDiagRehearsalText(),
            after: silentGapDeleteDiagSnapshotTrack(track),
        });
        regionSwapDiagLog('rehearsal/silent-gap-delete', {
            rehearsalIndex: pi + 1,
            partial: !!gap.partial,
            mode: plan.mode,
            shrinkOnly: !!plan.shrinkOnly,
            spanBars: plan.spanBars || null,
            slotBars: plan.slotBars || null,
            before: rehearsalBefore,
            after: regionSwapDiagRehearsalText(),
            countsHead: plan.next.slice(0, 8),
        });
        if (typeof writeLog === 'function') {
            writeLog(
                'Rehearsal: removed slot ' +
                    (pi + 1) +
                    ' (silent gap delete): ' +
                    regionSwapDiagRehearsalText(),
            );
        }
        return true;
    }
    function deleteSilentGapAt(track, gapIndex, opt) {
        silentGapDeleteDiagLog('delete/begin', {
            ex: isExtraTrackRef(track) ? track.slot + 1 : null,
            gapIndex: gapIndex | 0,
            opt: opt || null,
            before: silentGapDeleteDiagSnapshotTrack(track),
        });
        const gaps = collectTrackSilentGaps(track);
        const gap = gaps[gapIndex | 0];
        if (!gap) {
            silentGapDeleteDiagLog('delete/reject', {
                reason: 'gap-not-found',
                gapCount: gaps.length,
            });
            return false;
        }
        const gapDur = gap.endSec - gap.startSec;
        const eps = segmentBoundaryJoinEpsilonSec();
        if (!(gapDur > eps)) {
            silentGapDeleteDiagLog('delete/reject', {
                reason: 'gap-too-small',
                gapDur: regionSwapDiagFmtSec(gapDur),
            });
            return false;
        }
        const rehearsalFillOn =
            typeof getMusicalGridRehearsalFillVisible === 'function' &&
            getMusicalGridRehearsalFillVisible();
        let rehearsalPlanBeforeRipple = null;
        if (rehearsalFillOn && Number.isFinite(gap.rehearsalIndex) && gap.rehearsalIndex >= 0) {
            const pi = gap.rehearsalIndex | 0;
            const counts =
                typeof window.getExpandedRehearsalGroupBarCountsSnapshot === 'function'
                    ? window.getExpandedRehearsalGroupBarCountsSnapshot()
                    : [];
            if (counts.length && pi < counts.length) {
                rehearsalPlanBeforeRipple = resolveSilentGapRehearsalCountUpdate(
                    gap,
                    track,
                    counts,
                    pi,
                );
                silentGapDeleteDiagLog('delete/rehearsal-plan-pre-ripple', {
                    ex: track.slot + 1,
                    gapIndex: gapIndex | 0,
                    rehearsalSlot: pi + 1,
                    plan: rehearsalPlanBeforeRipple
                        ? {
                              mode: rehearsalPlanBeforeRipple.mode,
                              dedicatedSilent: rehearsalPlanBeforeRipple.dedicatedSilent,
                              countsSource: rehearsalPlanBeforeRipple.countsSource,
                              countsAfter: rehearsalPlanBeforeRipple.next.slice(0, 12),
                              skipRehearsalApply: !!rehearsalPlanBeforeRipple.skipRehearsalApply,
                          }
                        : null,
                });
            }
        }
        if (!(opt && opt.skipUndoCapture) && !regionUndoPaused) {
            requestRegionUndoCapture({ includeRehearsal: !!rehearsalFillOn });
        }
        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        if (!segments.length) {
            silentGapDeleteDiagLog('delete/reject', { reason: 'no-segments' });
            return false;
        }
        const shouldRemoveGridSegments =
            rehearsalPlanBeforeRipple &&
            !rehearsalPlanBeforeRipple.shrinkOnly &&
            rehearsalPlanBeforeRipple.mode !== 'ripple-only';
        let removedGridSegmentIndices = [];
        if (shouldRemoveGridSegments) {
            removedGridSegmentIndices = collectGridOnlySegmentIndicesInsideGap(track, gap, eps);
            for (let r = removedGridSegmentIndices.length - 1; r >= 0; r--) {
                segments.splice(removedGridSegmentIndices[r], 1);
            }
            if (!segments.length) {
                silentGapDeleteDiagLog('delete/reject', { reason: 'no-segments-after-grid-remove' });
                return false;
            }
        }
        let fromIndex = -1;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const regionIn = Number.isFinite(seg.regionTimelineInSec)
                ? seg.regionTimelineInSec
                : Number.isFinite(seg.timelineStartSec)
                  ? seg.timelineStartSec
                  : getSegmentRegionTimelineIn(track, i);
            if (regionIn >= gap.endSec - eps) {
                fromIndex = i;
                break;
            }
        }
        if (!(fromIndex >= 0)) {
            fromIndex = gap.beforeSegmentIndex >= 0 ? gap.beforeSegmentIndex : segments.length;
            if (removedGridSegmentIndices.length) {
                for (let r = 0; r < removedGridSegmentIndices.length; r++) {
                    if (removedGridSegmentIndices[r] < fromIndex) fromIndex--;
                }
            }
            fromIndex = Math.max(0, Math.min(fromIndex, segments.length));
        }
        if (typeof shiftSegmentEntriesTimelineFromIndex === 'function') {
            shiftSegmentEntriesTimelineFromIndex(
                segments,
                track,
                fromIndex,
                -gapDur,
            );
        } else {
            for (let i = fromIndex; i < segments.length; i++) {
                if (Number.isFinite(segments[i].timelineStartSec)) {
                    segments[i].timelineStartSec -= gapDur;
                }
            }
        }
        const normalized = segments.map((s) =>
            normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
        );
        silentGapDeleteDiagLog('delete/ripple', {
            ex: track.slot + 1,
            gapIndex: gapIndex | 0,
            gapDur: regionSwapDiagFmtSec(gapDur),
            fromIndex: fromIndex >= 0 ? fromIndex + 1 : null,
            removedGridSegments: removedGridSegmentIndices.map((i) => i + 1),
            segCount: segments.length,
        });
        applySegmentsToState(track, normalized, {
            skipUndo: true,
            skipMusicalRefresh: rehearsalFillOn,
            segmentStructureChanged: removedGridSegmentIndices.length > 0,
            affectedSegmentIndices: normalized.map((_, i) => i),
        });
        if (removedGridSegmentIndices.length && typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        silentGapDeleteDiagLog('delete/after-ripple', {
            ex: track.slot + 1,
            after: silentGapDeleteDiagSnapshotTrack(track),
        });
        if (typeof window.rippleMarkersForRemovedTimelineInterval === 'function') {
            const markersRippled = window.rippleMarkersForRemovedTimelineInterval(
                gap.startSec,
                gap.endSec,
            );
            if (markersRippled) {
                silentGapDeleteDiagLog('delete/markers-rippled', {
                    ex: track.slot + 1,
                    gapStart: regionSwapDiagFmtSec(gap.startSec),
                    gapEnd: regionSwapDiagFmtSec(gap.endSec),
                    gapDur: regionSwapDiagFmtSec(gapDur),
                });
            }
        }
        if (rehearsalFillOn) {
            syncRehearsalGridAfterSilentGapDelete(gap, track, rehearsalPlanBeforeRipple);
            if (typeof window.scheduleMusicalGridRedraw === 'function') {
                window.scheduleMusicalGridRedraw();
            }
            if (typeof window.rebuildAllTrackTimelineSlots === 'function') {
                window.rebuildAllTrackTimelineSlots({ infer: true });
            }
            if (typeof window.refreshAllRegionMusicalMetaPresentation === 'function') {
                window.refreshAllRegionMusicalMetaPresentation();
            } else if (typeof window.refreshAllRegionRehearsalMarkLabels === 'function') {
                window.refreshAllRegionRehearsalMarkLabels();
            }
            silentGapDeleteDiagLog('delete/after-rehearsal-rebuild', {
                ex: track.slot + 1,
                after: silentGapDeleteDiagSnapshotTrack(track),
            });
        }
        if (!(opt && opt.skipClearSelection) && typeof clearRegionSelection === 'function') {
            clearRegionSelection();
        }
        silentGapDeleteDiagLog('delete/done', {
            ex: track.slot + 1,
            gapIndex: gapIndex | 0,
            after: silentGapDeleteDiagSnapshotTrack(track),
        });
        const label = Number.isFinite(gap.rehearsalIndex)
            ? 'rehearsal ' + (gap.rehearsalIndex + 1)
            : 'gap @ ' + gap.startSec.toFixed(2) + 's';
        writeLog(
            'Ex ' +
                (track.slot + 1) +
                ': silent ' +
                label +
                ' removed (ripple −' +
                gapDur.toFixed(2) +
                's)',
        );
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Ex ' + (track.slot + 1), 'Silent gap removed', 'notice');
        }
        return true;
    }
    /** 境界結合列 / regionGroupId グループを含む入れ替え単位 */
    function resolveRegionSwapUnitSegmentIndices(track, segmentIndex) {
        const idx = segmentIndex | 0;
        if (!(idx >= 0)) return [];
        const gid = getSegmentRegionGroupId(track, idx);
        if (gid) {
            return sortSegmentIndicesByTimeline(
                track,
                collectRegionGroupMemberIndices(track, idx),
            );
        }
        const joined = collectRehearsalSlotJoinedSegmentIndices(track, idx);
        if (joined.length > 1) {
            return sortSegmentIndicesByTimeline(track, joined);
        }
        return [idx];
    }
    function sortSegmentIndicesOnCopies(track, segments, indices) {
        const copyIn =
            typeof window.segmentCopyRegionIn === 'function'
                ? window.segmentCopyRegionIn
                : null;
        return indices
            .slice()
            .filter((i) => i >= 0)
            .sort((a, b) => {
                let aIn = NaN;
                let bIn = NaN;
                if (segments && segments[a] && copyIn) {
                    aIn = copyIn(segments[a]);
                } else if (typeof getSegmentRegionTimelineIn === 'function') {
                    aIn = getSegmentRegionTimelineIn(track, a);
                }
                if (segments && segments[b] && copyIn) {
                    bIn = copyIn(segments[b]);
                } else if (typeof getSegmentRegionTimelineIn === 'function') {
                    bIn = getSegmentRegionTimelineIn(track, b);
                }
                if (Number.isFinite(aIn) && Number.isFinite(bIn) && Math.abs(aIn - bIn) > 1e-9) {
                    return aIn - bIn;
                }
                return a - b;
            });
    }

    function repositionRegionSwapUnitToTimelineSec(
        track,
        segments,
        unitIndices,
        targetInSec,
        t0Opt,
    ) {
        if (!unitIndices || !unitIndices.length || !Number.isFinite(targetInSec)) return;
        const sorted = sortSegmentIndicesByTimeline(track, unitIndices);
        const leader = sorted[0];
        const seg = segments[leader];
        if (!seg) return;
        const t0 =
            Number.isFinite(t0Opt) ? t0Opt : getTrackTimelineStartSec(track);
        const curIn = segmentCopyRegionIn(seg);
        const delta = targetInSec - curIn;
        if (Math.abs(delta) < 0.00001) return;
        for (let i = 0; i < sorted.length; i++) {
            applyTimelineDeltaToRawSegment(
                track,
                sorted[i],
                segments[sorted[i]],
                delta,
                t0,
            );
        }
    }

    /**
     * partial RegionSwap — リージョン In/Out をリハーサルマークスパン [targetIn, targetOut] に合わせる。
     * 音源長がスパンより長い場合は Out 側をトリムする。
     */
    function fitPartialSwapUnitToTimelineSpan(
        track,
        segments,
        unitIndices,
        targetInSec,
        targetOutSec,
    ) {
        if (
            !unitIndices ||
            !unitIndices.length ||
            !Number.isFinite(targetInSec) ||
            !Number.isFinite(targetOutSec) ||
            targetOutSec <= targetInSec + 1e-6
        ) {
            return;
        }
        const sorted = sortSegmentIndicesOnCopies(track, segments, unitIndices);
        const leader = sorted[0];
        const seg = segments[leader];
        if (!seg) return;
        const minSec =
            typeof PLAYBACK_REGION_MIN_SEC !== 'undefined'
                ? PLAYBACK_REGION_MIN_SEC
                : 0.01;
        const sourceIn = Number(seg.sourceInSec) || 0;
        const sourceOut = Number(seg.sourceOutSec) || 0;
        const sourceSpan = Math.max(minSec, sourceOut - sourceIn);
        const spanDur = Math.max(minSec, targetOutSec - targetInSec);
        seg.sourceInSec = sourceIn;
        seg.regionTimelineInSec = targetInSec;
        seg.timelineStartSec = targetInSec;
        if (sourceSpan > spanDur + 1e-6) {
            seg.sourceOutSec = sourceIn + spanDur;
            delete seg.regionTimelineOutSec;
        } else {
            seg.sourceOutSec = sourceOut;
            if (spanDur > sourceSpan + 1e-6) {
                seg.regionTimelineOutSec = targetOutSec;
            } else {
                delete seg.regionTimelineOutSec;
            }
        }
    }

    /**
     * recompose 後 — リージョン In/Out を slot スパンに合わせる（音源が slot より短い場合は表示 span まで伸ばす）。
     */
    function alignRegionSwapUnitToSlotSpan(
        track,
        segments,
        unitIndices,
        targetInSec,
        targetOutSec,
    ) {
        if (
            !unitIndices ||
            !unitIndices.length ||
            !Number.isFinite(targetInSec) ||
            !Number.isFinite(targetOutSec) ||
            targetOutSec <= targetInSec + 1e-6
        ) {
            return;
        }
        const sorted = sortSegmentIndicesOnCopies(track, segments, unitIndices);
        const leader = sorted[0];
        const seg = segments[leader];
        if (!seg) return;
        const minSec =
            typeof PLAYBACK_REGION_MIN_SEC !== 'undefined'
                ? PLAYBACK_REGION_MIN_SEC
                : 0.01;
        const sourceIn = Number(seg.sourceInSec) || 0;
        const sourceOut = Number(seg.sourceOutSec) || 0;
        const sourceSpan = Math.max(minSec, sourceOut - sourceIn);
        const spanDur = Math.max(minSec, targetOutSec - targetInSec);
        seg.sourceInSec = sourceIn;
        seg.regionTimelineInSec = targetInSec;
        seg.timelineStartSec = targetInSec;
        if (sourceSpan > spanDur + 1e-6) {
            seg.sourceOutSec = sourceIn + spanDur;
            delete seg.regionTimelineOutSec;
        } else {
            seg.sourceOutSec = sourceOut;
            if (spanDur > sourceSpan + 1e-6) {
                seg.regionTimelineOutSec = targetOutSec;
            } else {
                delete seg.regionTimelineOutSec;
            }
        }
    }
    window.sortSegmentIndicesOnCopies = sortSegmentIndicesOnCopies;
    function playbackRegionSwapBlockReason() {
        if (
            typeof isPlaybackRegionSwapAnimActive === 'function' &&
            isPlaybackRegionSwapAnimActive()
        ) {
            return 'swap animation in progress';
        }
        if (
            typeof getMusicalGridRehearsalFillVisible !== 'function' ||
            !getMusicalGridRehearsalFillVisible()
        ) {
            return 'rehearsal tint off';
        }
        if (
            typeof window.isTimelineSlotRegionSwapEnabled === 'function' &&
            !window.isTimelineSlotRegionSwapEnabled()
        ) {
            return 'slot engine disabled';
        }
        if (typeof window.swapSelectedTimelineSlots !== 'function') {
            return 'slot swap unavailable';
        }
        if (regionSelectionEntries.length !== 2) {
            return 'select exactly 2 items';
        }
        const a = regionSelectionEntries[0];
        const b = regionSelectionEntries[1];
        if (a.slot !== b.slot) {
            return 'different tracks';
        }
        const track = { type: 'extra', slot: a.slot };
        if (!isTrackRegionActive(track)) {
            return 'no active regions';
        }
        if (a.segmentIndex >= 0 && b.segmentIndex >= 0 && a.segmentIndex === b.segmentIndex) {
            return 'select 2 different regions';
        }
        if (typeof window.resolveSwapSelectionAudioSlotPair === 'function') {
            if (typeof window.invalidateTrackTimelineSlotsReadCache === 'function') {
                window.invalidateTrackTimelineSlotsReadCache();
            }
            const slots =
                typeof window.getTrackTimelineSlots === 'function'
                    ? window.getTrackTimelineSlots(track, {
                          writeCache: false,
                          forceRebuild: true,
                          skipReadCacheStore: true,
                      })
                    : [];
            const resolved = window.resolveSwapSelectionAudioSlotPair(track, a, b, slots);
            if (!resolved.ok) {
                return resolved.reason;
            }
        }
        return null;
    }
    function notifyCannotSwapPlaybackRegions(reason) {
        regionSwapDiagLog('swap/blocked', {
            reason,
            selection: regionSelectionEntries.map((e) =>
                e.segmentIndex < 0
                    ? { silentGap: e.silentGapIndex, slot: e.slot }
                    : { seg: e.segmentIndex, slot: e.slot },
            ),
        });
        regionSwapDiagDumpSelectionTracks('swap/blocked');
        writeLog('Playback region: cannot swap (' + reason + ')');
        if (typeof flashSeekHint === 'function') {
            let hint = "Can't swap regions";
            if (reason === 'paired audio unresolved') {
                hint = 'Could not resolve audio region paired with selected silent gap';
            } else if (reason === 'same rehearsal block') {
                hint = 'Select two different Rehearsal blocks (not a region and its silent gap)';
            } else if (reason === 'rehearsal slot unresolved') {
                hint = 'Could not resolve Rehearsal slot for selected regions';
            } else if (reason === 'rehearsal slot outside spec cycle') {
                hint = 'Rehearsal slot out of range — check Rehearsal definition';
            } else if (reason === 'invalid rehearsal spec' || reason === 'rehearsal fill off') {
                hint = 'Turn on Rehearsal fill and fix Rehearsal definition';
            } else if (reason === 'same rehearsal slot') {
                hint = 'Already in that rehearsal slot';
            } else if (
                reason === 'rehearsal span swap not applied' ||
                reason === 'rehearsal span swap failed' ||
                reason === 'rehearsal span unresolved'
            ) {
                hint = 'Rehearsal span swap not applied — check [MusicalSlot] log';
            } else if (reason === 'rehearsal span bar sum mismatch') {
                hint = 'Rehearsal bar counts differ — cannot swap these regions';
            } else if (reason === 'rehearsal block swap API missing') {
                hint = 'Rehearsal block swap unavailable — reload the app';
            }
            flashSeekHint('Region', hint, 'error');
        }
    }
    function swapSelectedPlaybackRegions() {
        regionSwapDiagDumpSelectionTracks('swap/E-key');
        const reason = playbackRegionSwapBlockReason();
        if (reason) {
            notifyCannotSwapPlaybackRegions(reason);
            return false;
        }
        const result = window.swapSelectedTimelineSlots();
        if (result && result.ok) {
            if (typeof clearRegionSelection === 'function') {
                clearRegionSelection();
            }
            return true;
        }
        if (result && result.reason) {
            notifyCannotSwapPlaybackRegions(result.reason);
        }
        return false;
    }
