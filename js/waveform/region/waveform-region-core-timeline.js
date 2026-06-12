/**
 * waveform-region-core-timeline.js — タイムライン修復・無音 gap・入れ替え
 */
    window.repairTrackMicroTimelineGaps = repairTrackMicroTimelineGaps;
    function segmentEntryTimelineEnd(seg) {
        const anchor = Number.isFinite(seg.timelineStartSec) ? seg.timelineStartSec : 0;
        return (
            anchor +
            Math.max(
                PLAYBACK_REGION_MIN_SEC,
                (Number(seg.sourceOutSec) || 0) - (Number(seg.sourceInSec) || 0),
            )
        );
    }
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
     * - 重なり解消: |gap| ≲ eps×8 のみ（大きな重なりは phrase 配置の結果 — 触らない）
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
                    const phraseBefore = phraseSlotIndexAtRegionInSec(curIn);
                    const phraseAfter = phraseSlotIndexAtRegionInSec(targetIn);
                    if (
                        phraseBefore != null &&
                        phraseAfter != null &&
                        phraseBefore !== phraseAfter
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
    /** 無音フレーズスロット先頭へリージョン In を合わせる（In パッドは維持） */
    function applySegmentToSilentGapPosition(track, segmentIndex, seg, targetRegionIn, t0) {
        if (!seg || !Number.isFinite(targetRegionIn)) return;
        const anchor = Number.isFinite(seg.timelineStartSec)
            ? seg.timelineStartSec
            : getSegmentTimelineStart(track, segmentIndex);
        const regionIn = Number.isFinite(seg.regionTimelineInSec)
            ? seg.regionTimelineInSec
            : getSegmentRegionTimelineIn(track, segmentIndex);
        const inPad = Math.max(0, regionIn - anchor);
        const newAnchor = targetRegionIn - inPad;
        seg.timelineStartSec = newAnchor;
        seg.regionTimelineInSec = Math.max(0, targetRegionIn);
        // live state（headPad / regionTimelineInSec）は setTrackSegments 確定時に
        // syncTrackHeadPadFromFirstSegment へ委譲 — プレビュー配置中の live 更新は
        // 入れ替えアニメの「旧位置」取得を壊すため行わない
    }
    /** Phrase グループ除去後 — 残存 timelineSlots の phraseSlotIndex を詰める */
    function remapTimelineSlotPhraseIndicesAfterGroupRemoval(track, removedIndex) {
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
            const psi = slot.musical.phraseSlotIndex | 0;
            if (psi > ri) {
                remapped.push({ unit: i, from: psi + 1, to: psi });
                slot.musical.phraseSlotIndex = psi - 1;
            }
        }
        silentGapDeleteDiagLog('remap/phrase-slot-index', {
            ex: track.slot + 1,
            removedPhraseSlot: ri + 1,
            remapped,
        });
    }

    /** 波形ポインタ位置の無音 gap を削除（Phrase 欄 Delete の全切り直しを避ける） */
    function tryDeleteSilentGapAtPhraseEditPointer(transportSec) {
        silentGapDeleteDiagLog('pointer/begin', {
            transportSec: regionSwapDiagFmtSec(transportSec),
            phraseFillOn:
                typeof getMusicalGridPhraseFillVisible === 'function' &&
                getMusicalGridPhraseFillVisible(),
        });
        if (
            typeof getMusicalGridPhraseFillVisible !== 'function' ||
            !getMusicalGridPhraseFillVisible()
        ) {
            silentGapDeleteDiagLog('pointer/reject', { reason: 'phrase-fill-off' });
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

    /** gap 区間の内部に音源リージョンが無い（境界のみ）= 専用無音フレーズ削除 */
    function isDedicatedSilentPhraseGapDelete(track, gap) {
        if (!gap || !isExtraTrackRef(track)) return false;
        const eps = segmentBoundaryJoinEpsilonSec();
        const segments = getTrackSegments(track);
        for (let si = 0; si < segments.length; si++) {
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

    /** フレーズ欄テキスト優先でグループ除去後の counts を構築 */
    function buildPhraseCountsAfterSilentGapSplice(pi, fallbackCounts) {
        const phraseText = regionSwapDiagPhraseText();
        if (phraseText && typeof window.parsePhraseGroupingSpec === 'function') {
            const spec = window.parsePhraseGroupingSpec(phraseText);
            if (spec && spec.sizes && spec.sizes.length >= 2 && pi < spec.sizes.length) {
                const sizes = spec.sizes.slice();
                sizes.splice(pi, 1);
                if (sizes.length) {
                    return { next: sizes.slice(), source: 'phrase-spec' };
                }
            }
        }
        if (typeof window.splicePhraseGroupAtIndex === 'function') {
            const next = window.splicePhraseGroupAtIndex(fallbackCounts, pi);
            if (next) return { next, source: 'expanded-counts' };
        }
        return null;
    }

    /** 無音 gap 削除時の Phrase counts 更新方針（リップル前のトラック状態で判定） */
    function resolveSilentGapPhraseCountUpdate(gap, track, counts, pi) {
        const slotBars = counts[pi] | 0;
        const spanBars =
            typeof estimateSilentGapBarSpan === 'function'
                ? estimateSilentGapBarSpan(gap) | 0
                : 0;
        const dedicatedSilent = isDedicatedSilentPhraseGapDelete(track, gap);

        if (gap.partial && !dedicatedSilent) {
            return {
                mode: 'ripple-only',
                next: counts.slice(),
                shrinkOnly: false,
                skipPhraseApply: true,
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
                shrinkOnly: true,
                skipPhraseApply: false,
                dedicatedSilent,
                spanBars,
                slotBars,
                countsSource: 'shrink',
            };
        }
        const spliced = buildPhraseCountsAfterSilentGapSplice(pi, counts);
        if (!spliced || !spliced.next) return null;
        return {
            mode: dedicatedSilent ? 'splice-dedicated' : 'splice',
            next: spliced.next,
            shrinkOnly: false,
            skipPhraseApply: false,
            dedicatedSilent,
            spanBars,
            slotBars,
            countsSource: spliced.source,
        };
    }

    /** 無音 gap 削除に伴う Phrase 展開 counts を更新（リージョン全体の切り直しは行わない） */
    function syncPhraseGridAfterSilentGapDelete(gap, track, precomputedPlan) {
        silentGapDeleteDiagLog('phrase-sync/begin', {
            ex: isExtraTrackRef(track) ? track.slot + 1 : null,
            gap: gap
                ? {
                      phraseSlot: Number.isFinite(gap.phraseIndex)
                          ? (gap.phraseIndex | 0) + 1
                          : null,
                      partial: !!gap.partial,
                      start: regionSwapDiagFmtSec(gap.startSec),
                      end: regionSwapDiagFmtSec(gap.endSec),
                  }
                : null,
            before: silentGapDeleteDiagSnapshotTrack(track),
        });
        if (
            typeof getMusicalGridPhraseFillVisible !== 'function' ||
            !getMusicalGridPhraseFillVisible()
        ) {
            silentGapDeleteDiagLog('phrase-sync/reject', { reason: 'phrase-fill-off' });
            return false;
        }
        if (!gap || !Number.isFinite(gap.phraseIndex) || gap.phraseIndex < 0) {
            silentGapDeleteDiagLog('phrase-sync/reject', { reason: 'gap-phrase-missing' });
            return false;
        }
        const pi = gap.phraseIndex | 0;
        const plan =
            precomputedPlan && precomputedPlan.next
                ? precomputedPlan
                : (() => {
                      const counts =
                          typeof window.getExpandedPhraseGroupBarCountsSnapshot ===
                          'function'
                              ? window.getExpandedPhraseGroupBarCountsSnapshot()
                              : [];
                      if (!counts.length || pi >= counts.length) return null;
                      return resolveSilentGapPhraseCountUpdate(gap, track, counts, pi);
                  })();
        if (!plan || !plan.next) {
            silentGapDeleteDiagLog('phrase-sync/reject', { reason: 'counts-update-failed' });
            return false;
        }
        const phraseBefore = regionSwapDiagPhraseText();
        silentGapDeleteDiagLog('phrase-sync/plan', {
            mode: plan.mode,
            dedicatedSilent: plan.dedicatedSilent,
            partial: !!gap.partial,
            spanBars: plan.spanBars || null,
            slotBars: plan.slotBars || null,
            countsSource: plan.countsSource || null,
            countsAfter: plan.next.slice(0, 12),
            skipPhraseApply: !!plan.skipPhraseApply,
            precomputed: !!precomputedPlan,
        });
        if (!plan.skipPhraseApply) {
            silentGapDeleteDiagLog('phrase-sync/apply', {
                mode: plan.mode,
                shrinkOnly: !!plan.shrinkOnly,
                relayoutRegions: false,
                optimize: false,
                compress: true,
            });
            if (typeof window.applyPhraseGroupBarCountsForRegionSwap === 'function') {
                window.applyPhraseGroupBarCountsForRegionSwap(plan.next, {
                    skipUndo: true,
                    relayoutRegions: false,
                    optimize: false,
                });
            } else if (typeof window.clearPhraseGroupBarCountsOverride === 'function') {
                window.clearPhraseGroupBarCountsOverride();
            }
            if (!plan.shrinkOnly && isExtraTrackRef(track)) {
                remapTimelineSlotPhraseIndicesAfterGroupRemoval(track, pi);
            }
            if (typeof window.compressPhraseDefinitionFromExpandedCounts === 'function') {
                const phraseMid = regionSwapDiagPhraseText();
                const compressed = window.compressPhraseDefinitionFromExpandedCounts({
                    skipUndo: true,
                });
                silentGapDeleteDiagLog('phrase-sync/compress', {
                    changed: !!compressed,
                    phraseMid,
                    phraseAfter: regionSwapDiagPhraseText(),
                });
            }
        }
        silentGapDeleteDiagLog('phrase-sync/done', {
            phraseBefore,
            phraseAfter: regionSwapDiagPhraseText(),
            after: silentGapDeleteDiagSnapshotTrack(track),
        });
        regionSwapDiagLog('phrase/silent-gap-delete', {
            phraseIndex: pi + 1,
            partial: !!gap.partial,
            mode: plan.mode,
            shrinkOnly: !!plan.shrinkOnly,
            spanBars: plan.spanBars || null,
            slotBars: plan.slotBars || null,
            before: phraseBefore,
            after: regionSwapDiagPhraseText(),
            countsHead: plan.next.slice(0, 8),
        });
        if (typeof writeLog === 'function') {
            writeLog(
                'Phrase: removed slot ' +
                    (pi + 1) +
                    ' (silent gap delete): ' +
                    regionSwapDiagPhraseText(),
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
        const phraseFillOn =
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible();
        let phrasePlanBeforeRipple = null;
        if (phraseFillOn && Number.isFinite(gap.phraseIndex) && gap.phraseIndex >= 0) {
            const pi = gap.phraseIndex | 0;
            const counts =
                typeof window.getExpandedPhraseGroupBarCountsSnapshot === 'function'
                    ? window.getExpandedPhraseGroupBarCountsSnapshot()
                    : [];
            if (counts.length && pi < counts.length) {
                phrasePlanBeforeRipple = resolveSilentGapPhraseCountUpdate(
                    gap,
                    track,
                    counts,
                    pi,
                );
                silentGapDeleteDiagLog('delete/phrase-plan-pre-ripple', {
                    ex: track.slot + 1,
                    gapIndex: gapIndex | 0,
                    phraseSlot: pi + 1,
                    plan: phrasePlanBeforeRipple
                        ? {
                              mode: phrasePlanBeforeRipple.mode,
                              dedicatedSilent: phrasePlanBeforeRipple.dedicatedSilent,
                              countsSource: phrasePlanBeforeRipple.countsSource,
                              countsAfter: phrasePlanBeforeRipple.next.slice(0, 12),
                              skipPhraseApply: !!phrasePlanBeforeRipple.skipPhraseApply,
                          }
                        : null,
                });
            }
        }
        if (!(opt && opt.skipUndoCapture) && !regionUndoPaused) {
            requestRegionUndoCapture({ includePhrase: !!phraseFillOn });
        }
        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        if (!segments.length) {
            silentGapDeleteDiagLog('delete/reject', { reason: 'no-segments' });
            return false;
        }
        let fromIndex = gap.beforeSegmentIndex;
        if (!(fromIndex >= 0)) {
            fromIndex = 0;
            for (let i = 0; i < segments.length; i++) {
                if (getSegmentTimelineStart(track, i) >= gap.endSec - eps) {
                    fromIndex = i;
                    break;
                }
            }
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
            segCount: segments.length,
        });
        applySegmentsToState(track, normalized, {
            skipUndo: true,
            skipMusicalRefresh: phraseFillOn,
            segmentStructureChanged: false,
            affectedSegmentIndices: normalized.map((_, i) => i),
        });
        silentGapDeleteDiagLog('delete/after-ripple', {
            ex: track.slot + 1,
            after: silentGapDeleteDiagSnapshotTrack(track),
        });
        if (phraseFillOn) {
            syncPhraseGridAfterSilentGapDelete(gap, track, phrasePlanBeforeRipple);
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
            silentGapDeleteDiagLog('delete/after-phrase-rebuild', {
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
        const label = Number.isFinite(gap.phraseIndex)
            ? 'phrase ' + (gap.phraseIndex + 1)
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
    function isSegmentTimelineInSilentGap(track, segmentIndex, gap, eps) {
        if (!gap || !(segmentIndex >= 0)) return false;
        const segStart = getSegmentRegionTimelineIn(track, segmentIndex);
        const segEnd = getSegmentTimelineEnd(track, segmentIndex);
        const mid = (segStart + segEnd) * 0.5;
        return mid >= gap.startSec - eps && mid <= gap.endSec + eps;
    }
    function segmentEffectivelySilent(track, segmentIndex) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return false;
        const dur = (Number(seg.sourceOutSec) || 0) - (Number(seg.sourceInSec) || 0);
        return !(dur > 0.0005);
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
        const joined = collectPhraseSlotJoinedSegmentIndices(track, idx);
        if (joined.length > 1) {
            return sortSegmentIndicesByTimeline(track, joined);
        }
        return [idx];
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
    function previewPhraseSlotPlacementSecFromCounts(counts, slotIndex) {
        if (typeof window.previewPhraseSlotStartSecFromCounts !== 'function') return null;
        const start = window.previewPhraseSlotStartSecFromCounts(counts, slotIndex);
        if (start == null) return null;
        const eps = segmentBoundaryJoinEpsilonSec();
        return start + eps * 2;
    }
    function playbackRegionSwapBlockReason() {
        if (
            typeof isPlaybackRegionSwapAnimActive === 'function' &&
            isPlaybackRegionSwapAnimActive()
        ) {
            return 'swap animation in progress';
        }
        if (
            typeof getMusicalGridPhraseFillVisible !== 'function' ||
            !getMusicalGridPhraseFillVisible()
        ) {
            return 'phrase tint off';
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
        const gapEntries = regionSelectionEntries.filter((e) => e.segmentIndex < 0);
        const segEntries = regionSelectionEntries.filter((e) => e.segmentIndex >= 0);
        if (gapEntries.length > 0) {
            if (gapEntries.length !== 1 || segEntries.length !== 1) {
                return 'select 1 silent gap and 1 region';
            }
            const resolved = resolveSilentGapSwapSegmentIndices(track, segEntries);
            if (!resolved.length) {
                return 'invalid region';
            }
            return null;
        }
        if (a.segmentIndex === b.segmentIndex) {
            return 'select 2 different regions';
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
            if (reason === 'select 1 silent gap and 1 region') {
                hint = 'Ctrl+click: silent slot + 1 region (2 items)';
            } else if (reason === 'phrase slot unresolved') {
                hint = 'Could not resolve Phrase slot for selected regions';
            } else if (reason === 'phrase slot outside spec cycle') {
                hint = 'Phrase slot out of range — check Phrase definition';
            } else if (reason === 'invalid phrase spec' || reason === 'phrase fill off') {
                hint = 'Turn on Phrase fill and fix Phrase definition';
            } else if (reason === 'same phrase slot') {
                hint = 'Already in that phrase slot';
            } else if (
                reason === 'phrase span swap not applied' ||
                reason === 'phrase span swap failed' ||
                reason === 'phrase span unresolved'
            ) {
                hint = 'Phrase span swap not applied — check [MusicalSlot] log';
            } else if (reason === 'phrase span bar sum mismatch') {
                hint = 'Phrase bar counts differ — cannot swap these regions';
            } else if (reason === 'phrase block swap API missing') {
                hint = 'Phrase block swap unavailable — reload the app';
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
            if (!result.noop && typeof clearRegionSelection === 'function') {
                clearRegionSelection();
            }
            regionSwapDiagDumpSelectionTracks('swap/done-slot');
            return true;
        }
        if (result && result.reason) {
            notifyCannotSwapPlaybackRegions(result.reason);
        }
        return false;
    }
