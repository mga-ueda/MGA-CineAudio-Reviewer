/**
 * waveform-region-rehearsal.js — Rehearsal スロット解決・無音 gap・Rehearsal 欄レイアウト
 */
    /** セッション復元完了時 — SwapUnit baseline（[MusicalSlot] dump/session-restore） */
    function logSessionRestoreRegionRehearsalSnapshot() {
        if (typeof window.logSessionRestoreMusicalSlotSnapshot === 'function') {
            window.logSessionRestoreMusicalSlotSnapshot();
        } else if (typeof writeLog === 'function') {
            regionSwapDiagLog('session/restore', {
                text: regionSwapDiagRehearsalText() || '',
                fill: !!(
                    typeof getMusicalGridRehearsalFillVisible === 'function' &&
                    getMusicalGridRehearsalFillVisible()
                ),
                specSlots: rehearsalSpecCycleSlotCount(),
            });
            const n = getExtraTrackCount();
            let dumped = 0;
            for (let slot = 0; slot < n; slot++) {
                const track = { type: 'extra', slot };
                const loaded =
                    typeof isExtraTrackLoaded === 'function' && isExtraTrackLoaded(slot);
                const active =
                    typeof isTrackRegionActive === 'function' && isTrackRegionActive(track);
                if (!loaded && !active) continue;
                regionSwapDiagDumpTrack(track, 'session-restore');
                dumped++;
            }
            if (!dumped) {
                regionSwapDiagLog('session/restore', {
                    note: 'no extra tracks with regions loaded',
                });
            }
        }
        const n = getExtraTrackCount();
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            const loaded =
                typeof isExtraTrackLoaded === 'function' && isExtraTrackLoaded(slot);
            const active =
                typeof isTrackRegionActive === 'function' && isTrackRegionActive(track);
            if (!loaded && !active) continue;
            repairTrackMicroTimelineGaps(track, {
                stage: 'session-restore',
                silent: true,
                closeMicroGaps: false,
            });
        }
    }
    function rehearsalSlotRangesSnapshot() {
        if (typeof getRehearsalGroupRangesSnapshot !== 'function') return [];
        return getRehearsalGroupRangesSnapshot();
    }

    /** リハーサル名／Rehearsal ナビ — 実リージョン In があればそちらを優先（Tempo ストレッチ後の grid 差を吸収） */
    function resolveSegmentIndexForRehearsalSlot(track, rehearsalSlotIndex) {
        if (!track || rehearsalSlotIndex == null || rehearsalSlotIndex < 0) return -1;
        const segments =
            typeof getTrackSegments === 'function' ? getTrackSegments(track) : [];
        if (!segments.length) return -1;
        const slot = rehearsalSlotIndex | 0;

        if (typeof getTrackTimelineSlots === 'function') {
            const units = getTrackTimelineSlots(track, { writeCache: false });
            for (let ui = 0; ui < units.length; ui++) {
                const unit = units[ui];
                const mus = unit && unit.musical;
                if (!mus || (mus.rehearsalSlotIndex | 0) !== slot) continue;
                if (unit.segmentRefs && unit.segmentRefs.length) {
                    return unit.segmentRefs[0].segmentIndex | 0;
                }
            }
        }

        if (slot < segments.length) return slot;
        return -1;
    }

    function rehearsalNavStartSecForSlot(track, rehearsalSlotIndex, gridStartSec) {
        const si = resolveSegmentIndexForRehearsalSlot(track, rehearsalSlotIndex);
        if (
            si >= 0 &&
            typeof getSegmentRegionTimelineIn === 'function'
        ) {
            const regionIn = getSegmentRegionTimelineIn(track, si);
            if (Number.isFinite(regionIn)) return regionIn;
        }
        return gridStartSec;
    }

    /** Rehearsal 欄 1 サイクル分のスロット数。長尺マスター展開 index とは別。 */
    function rehearsalSpecCycleSlotCount() {
        if (typeof musicalGridDrawSettings === 'function') {
            const settings = musicalGridDrawSettings();
            if (settings && settings.rehearsalSpec && settings.rehearsalSpec.sizes) {
                return settings.rehearsalSpec.sizes.length;
            }
        }
        if (typeof parseRehearsalGroupingSpec === 'function') {
            const spec = parseRehearsalGroupingSpec(regionSwapDiagRehearsalText());
            if (spec && spec.sizes && spec.sizes.length) return spec.sizes.length;
        }
        return 0;
    }

    /** 入れ替え対象は Rehearsal 定義 1 サイクル内（index 0..n-1）のみ */
    function rehearsalSpecCycleSlotIndex(rawIndex) {
        if (rawIndex == null || rawIndex < 0) return null;
        const idx = rawIndex | 0;
        const cycle = rehearsalSpecCycleSlotCount();
        if (cycle > 0 && idx >= cycle) return null;
        return idx;
    }

    /** 入れ替え E 用 — spec 1 サイクル内スロットのみ（Region In 基準） */
    function rehearsalSpecCycleSlotForSegment(track, segmentIndex) {
        if (!(segmentIndex >= 0)) return null;
        return rehearsalSpecCycleSlotIndex(
            rehearsalSlotIndexAtRegionInSec(getSegmentRegionTimelineIn(track, segmentIndex)),
        );
    }


    /** ユーザー向け「頭から N 個目」（1 始まり） */
    function rehearsalSpecCycleSlotLabel(slotIndex) {
        if (slotIndex == null || slotIndex < 0) return '?';
        return String((slotIndex | 0) + 1);
    }

    /** タイムライン着色ラベル（0 始まり: A, B … Z, AA …） */
    function rehearsalSpecCycleSlotGridLabel(slotIndex) {
        if (slotIndex == null || slotIndex < 0) return '?';
        if (typeof rehearsalGroupLabelForIndex === 'function') {
            return rehearsalGroupLabelForIndex(slotIndex);
        }
        return String(slotIndex);
    }

    function syncTrackHeadPadFromFirstSegment(track, segments) {
        if (!segments || !segments.length) return;
        const state = getPlaybackRegionsState(track);
        if (!state) return;
        const t0 = getTrackTimelineStartSec(track);
        const seg0 = segments[0];
        if (!seg0) return;
        const anchor = Number.isFinite(seg0.timelineStartSec) ? seg0.timelineStartSec : t0;
        let lead = Math.max(0, Number(seg0.regionLeadPadSec) || 0);
        if (lead <= 0.00001) {
            const regionIn = Number(seg0.regionTimelineInSec);
            if (Number.isFinite(regionIn) && regionIn < anchor - 0.00001) {
                lead = anchor - regionIn;
            }
        }
        if (lead > 0.00001) {
            seg0.regionLeadPadSec = lead;
            const regionIn = Number.isFinite(seg0.regionTimelineInSec)
                ? seg0.regionTimelineInSec
                : anchor - lead;
            seg0.regionTimelineInSec = regionIn;
            state.regionLeadPadSec = lead;
            state.regionTimelineInSec = regionIn;
            state.headPadSec = Math.max(0, regionIn - t0);
            return;
        }
        delete state.regionLeadPadSec;
        if (Number.isFinite(seg0.regionLeadPadSec)) delete seg0.regionLeadPadSec;
        if (Number.isFinite(seg0.timelineStartSec)) {
            state.headPadSec = Math.max(0, seg0.timelineStartSec - t0);
        } else {
            state.headPadSec = 0;
        }
        if (Number.isFinite(seg0.regionTimelineInSec)) {
            const regionIn = Math.max(0, seg0.regionTimelineInSec);
            seg0.regionTimelineInSec = regionIn;
            state.regionTimelineInSec = regionIn;
        } else {
            delete state.regionTimelineInSec;
            delete seg0.regionTimelineInSec;
        }
    }

    /** transport 秒が属する Rehearsal スロット index */
    function rehearsalSlotIndexAtTransportSec(transportSec) {
        if (!Number.isFinite(transportSec)) return null;
        if (typeof resolveRehearsalGroupIndexAtTransportSec !== 'function') return null;
        const idx = resolveRehearsalGroupIndexAtTransportSec(transportSec);
        if (idx == null || idx < 0) return null;
        return idx;
    }

    /**
     * Region In 用 — Rehearsal 区間境界上は「その秒から始まるスロット」に属する（半開区間 [start, end)）。
     */
    function rehearsalSlotIndexAtRegionInSec(transportSec) {
        if (!Number.isFinite(transportSec)) return null;
        const ranges = rehearsalSlotRangesSnapshot();
        if (!ranges.length) return rehearsalSlotIndexAtTransportSec(transportSec);
        const eps = segmentBoundaryJoinEpsilonSec();
        const s = Number(transportSec);
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (s >= r.startSec - eps && s < r.endSec - eps) return i;
        }
        return rehearsalSlotIndexAtTransportSec(transportSec);
    }

    function rehearsalSlotStartSec(slotIndex) {
        const ranges = rehearsalSlotRangesSnapshot();
        const r = ranges[slotIndex | 0];
        return r && Number.isFinite(r.startSec) ? r.startSec : null;
    }

    function isRehearsalRangeUncoveredByTrack(track, rehearsalIndex, ranges) {
        const r = ranges[rehearsalIndex];
        if (!r || !track) return false;
        const eps = segmentBoundaryJoinEpsilonSec();
        const segments = getTrackSegments(track);
        for (let si = 0; si < segments.length; si++) {
            const a = getSegmentRegionTimelineIn(track, si);
            const b = getSegmentRegionTimelineOut(track, si);
            if (b > r.startSec + eps && a < r.endSec - eps) return false;
        }
        return true;
    }

    /** この Rehearsal スロット内に Region In を持つセグメントが無い（無音スロット選択用） */
    function isRehearsalSlotWithoutAnchoredRegion(track, rehearsalIndex, ranges) {
        const r = ranges[rehearsalIndex];
        if (!r || !track) return false;
        const eps = segmentBoundaryJoinEpsilonSec();
        const segments = getTrackSegments(track);
        for (let si = 0; si < segments.length; si++) {
            const regionIn = getSegmentRegionTimelineIn(track, si);
            if (regionIn >= r.startSec - eps && regionIn < r.endSec - eps) return false;
        }
        return true;
    }

    /** 無音ギャップ区間が重なる Rehearsal スロット（gap.rehearsalIndex を優先） */
    function rehearsalSlotIndexForSilentGap(gap, track) {
        if (
            typeof getMusicalGridRehearsalFillVisible !== 'function' ||
            !getMusicalGridRehearsalFillVisible()
        ) {
            return null;
        }
        if (gap && Number.isFinite(gap.rehearsalIndex) && gap.rehearsalIndex >= 0) {
            return gap.rehearsalIndex | 0;
        }
        const ranges = rehearsalSlotRangesSnapshot();
        if (!gap || !ranges.length) return null;
        const eps = segmentBoundaryJoinEpsilonSec();
        let bestUncovered = null;
        let bestUncoveredOverlap = 0;
        let bestAny = null;
        let bestAnyOverlap = 0;
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            const lo = Math.max(gap.startSec, r.startSec);
            const hi = Math.min(gap.endSec, r.endSec);
            const overlap = hi - lo;
            if (!(overlap > eps)) continue;
            if (overlap > bestAnyOverlap) {
                bestAnyOverlap = overlap;
                bestAny = i;
            }
            if (
                track &&
                isRehearsalRangeUncoveredByTrack(track, i, ranges) &&
                overlap > bestUncoveredOverlap
            ) {
                bestUncoveredOverlap = overlap;
                bestUncovered = i;
            }
        }
        if (bestUncovered != null) return bestUncovered;
        if (bestAny != null) return bestAny;
        return rehearsalSlotIndexAtTransportSec((gap.startSec + gap.endSec) * 0.5);
    }

    /** タイムライン区間が最も多く重なる Rehearsal スロット（境界 ε 付近の誤判定を避ける） */
    function rehearsalDominantSlotForInterval(regionIn, regionOut) {
        if (!Number.isFinite(regionIn) || !Number.isFinite(regionOut)) return null;
        const ranges = rehearsalSlotRangesSnapshot();
        if (!ranges.length) return null;
        let bestIdx = null;
        let bestOverlap = -1;
        for (let pi = 0; pi < ranges.length; pi++) {
            const r = ranges[pi];
            if (!r) continue;
            const lo = Math.max(regionIn, r.startSec);
            const hi = Math.min(regionOut, r.endSec);
            const overlap = hi - lo;
            if (overlap > bestOverlap) {
                bestOverlap = overlap;
                bestIdx = pi;
            }
        }
        return bestIdx;
    }

    /** リージョン In が属する Rehearsal スロット */
    function rehearsalSlotIndexForSegment(track, segmentIndex) {
        if (!(segmentIndex >= 0)) return null;
        return rehearsalSlotIndexAtRegionInSec(getSegmentRegionTimelineIn(track, segmentIndex));
    }

    /**
     * 無音↔リージョン入れ替え — 複数 Rehearsal に跨るリージョンは重なり最大のスロットを採用。
     * Region In が 1 小節スロット内でも本体は次スロット（例: r2 @ 0.1s → rehearsal 2）。
     */
    function rehearsalExpandedSlotForSilentGapSegment(track, segmentIndex) {
        if (!(segmentIndex >= 0)) return null;
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const regionOut = getSegmentRegionTimelineOut(track, segmentIndex);
        const dominant = rehearsalDominantSlotForInterval(regionIn, regionOut);
        if (dominant != null && dominant >= 0) return dominant;
        return rehearsalSlotIndexForSegment(track, segmentIndex);
    }

    /** Rehearsal スロット先頭 + ε（境界上配置を避け次スロット誤判定を防ぐ） */
    function rehearsalSlotPlacementSec(slotIndex) {
        const start = rehearsalSlotStartSec(slotIndex);
        if (start == null) return null;
        const eps = segmentBoundaryJoinEpsilonSec();
        return start + eps * 2;
    }

    function rehearsalSlotOverlapsGap(slotIndex, gap) {
        const ranges = rehearsalSlotRangesSnapshot();
        const r = ranges[slotIndex | 0];
        if (!gap || !r) return false;
        const eps = segmentBoundaryJoinEpsilonSec();
        return gap.endSec > r.startSec + eps && gap.startSec < r.endSec - eps;
    }

    function segmentRegionInWithinRehearsalSlot(track, segmentIndex, slotIndex) {
        const ranges = rehearsalSlotRangesSnapshot();
        const r = ranges[slotIndex | 0];
        if (!r || !(segmentIndex >= 0)) return false;
        const eps = segmentBoundaryJoinEpsilonSec();
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        return regionIn >= r.startSec - eps && regionIn < r.endSec - eps;
    }

    /**
     * 同一 Rehearsal スロット内の部分無音↔リージョン。
     * 部分無音区間とリージョン In が重ならない（または gap.partial）場合に true。
     */
    function isSameRehearsalSlotPartialSilentGapPlacement(track, gap, leaderIndex, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const gapSlotRaw =
            gap && Number.isFinite(gap.rehearsalIndex) && gap.rehearsalIndex >= 0
                ? gap.rehearsalIndex | 0
                : rehearsalSlotIndexForSilentGap(gap, track);
        const gapSlot = rehearsalSpecCycleSlotIndex(gapSlotRaw);
        const segSlot = rehearsalSpecCycleSlotForSegment(track, leaderIndex);
        if (gapSlot == null || segSlot == null || gapSlot !== segSlot) return false;
        const eps = segmentBoundaryJoinEpsilonSec();
        const segIn =
            leaderIndex >= 0 ? getSegmentRegionTimelineIn(track, leaderIndex) : NaN;
        const inGapInterval =
            gap &&
            Number.isFinite(gap.startSec) &&
            Number.isFinite(gap.endSec) &&
            Number.isFinite(segIn) &&
            segIn >= gap.startSec - eps &&
            segIn < gap.endSec - eps;
        let delta = o.delta;
        if (
            (delta == null || !Number.isFinite(delta)) &&
            gap &&
            Number.isFinite(gap.startSec) &&
            Number.isFinite(segIn)
        ) {
            delta = gap.startSec + eps * 2 - segIn;
        }
        if (!Number.isFinite(delta) || Math.abs(delta) <= eps * 0.5) return false;
        return !!(gap && (gap.partial || !inGapInterval));
    }

    /** 無音 gap 区間がカバーする Rehearsal 小節数（複数スロット跨ぎ・部分 gap 対応） */
    function estimateSilentGapBarSpan(gap) {
        if (!gap || !Number.isFinite(gap.startSec) || !Number.isFinite(gap.endSec)) return 0;
        const dur = gap.endSec - gap.startSec;
        if (!(dur > 0.00001)) return 0;
        const counts = expandedRehearsalGroupBarCountsSnapshot();
        const ranges = rehearsalSlotRangesSnapshot();
        if (!counts.length || !ranges.length) return 0;

        const eps = segmentBoundaryJoinEpsilonSec();
        const minOverlap = eps * 4;
        let sum = 0;
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (!r) continue;
            const lo = Math.max(gap.startSec, r.startSec);
            const hi = Math.min(gap.endSec, r.endSec);
            const overlap = hi - lo;
            if (!(overlap > minOverlap)) continue;
            const slotBars = counts[i] | 0;
            const slotDur = r.endSec - r.startSec;
            if (!(slotBars > 0) || !(slotDur > 0.00001)) continue;
            if (overlap >= slotDur - minOverlap) {
                sum += slotBars;
            } else {
                const barDur = slotDur / slotBars;
                sum += Math.max(1, Math.min(Math.round(overlap / barDur), slotBars));
            }
        }
        if (sum > 0) return sum;

        const idx = rehearsalSlotIndexAtRegionInSec(gap.startSec);
        if (idx == null || idx < 0 || idx >= counts.length) return 0;
        const r = ranges[idx];
        const slotBars = counts[idx] | 0;
        if (r && slotBars > 0 && r.endSec - r.startSec > 0.00001) {
            const barDur = (r.endSec - r.startSec) / slotBars;
            return Math.max(1, Math.min(Math.round(dur / barDur), slotBars));
        }
        return slotBars || 0;
    }

    /** 無音↔リージョン — 展開スロット／音源小節数から入れ替えモードを決定 */
    function resolveSilentGapExpandedSwapModes(track, gap, leaderIndex, gapExpanded, segExpanded) {
        const counts = expandedRehearsalGroupBarCountsSnapshot();
        const contentBars = estimateRegionContentBarCountForSegment(track, leaderIndex);
        const result = {
            expandedEqualBarTimelineOnly: false,
            expandedSameSlotTimelineOnly: false,
            expandedUnequalBarTimelineOnly: false,
            expandedRehearsalSwap: false,
            needsPartialSlotShrink: false,
            contentBars: contentBars | 0,
            gapBars: 0,
            gapSlotBars: 0,
        };
        if (gapExpanded == null || gapExpanded < 0 || !counts.length) return result;
        const gapSlotBars = counts[gapExpanded] | 0;
        const gapSpanBars = estimateSilentGapBarSpan(gap);
        result.gapSlotBars = gapSlotBars;
        result.gapBars = gapSpanBars > 0 ? gapSpanBars : gapSlotBars;
        if (!(contentBars > 0) || !(result.gapBars > 0)) return result;

        if (segExpanded != null && gapExpanded === segExpanded) {
            if (contentBars === gapSlotBars) {
                const regionIn =
                    leaderIndex >= 0
                        ? getSegmentRegionTimelineIn(track, leaderIndex)
                        : NaN;
                const eps = segmentBoundaryJoinEpsilonSec();
                const inGapInterval =
                    gap &&
                    Number.isFinite(gap.startSec) &&
                    Number.isFinite(gap.endSec) &&
                    Number.isFinite(regionIn) &&
                    regionIn >= gap.startSec - eps &&
                    regionIn < gap.endSec - eps;
                const nearGapEnd =
                    gap &&
                    Number.isFinite(gap.endSec) &&
                    Number.isFinite(regionIn) &&
                    Math.abs(regionIn - gap.endSec) <= eps * 4;
                const nearGapStart =
                    gap &&
                    Number.isFinite(gap.startSec) &&
                    Number.isFinite(regionIn) &&
                    Math.abs(regionIn - gap.startSec) <= eps * 4;
                if (inGapInterval || gap.partial || nearGapEnd || nearGapStart) {
                    result.expandedSameSlotTimelineOnly = true;
                } else {
                    // 16 小節等の同一展開スロット両端 — gap 先頭へタイムライン移動のみ
                    result.expandedEqualBarTimelineOnly = true;
                }
            } else if (gapSlotBars > contentBars) {
                result.needsPartialSlotShrink = true;
            }
            return result;
        }

        if (segExpanded != null && gapExpanded !== segExpanded) {
            const segSlotBars =
                segExpanded >= 0 && segExpanded < counts.length ? counts[segExpanded] | 0 : 0;
            const gapBars = result.gapBars;
            // 音源小節数 ↔ gap 区間小節数（複数スロット跨ぎ含む）
            if (contentBars > 0 && contentBars === gapBars) {
                result.expandedEqualBarTimelineOnly = true;
            } else if (segSlotBars > 0 && segSlotBars === gapBars) {
                result.expandedEqualBarTimelineOnly = true;
            } else if (segSlotBars > 0 && gapBars > 0) {
                // 8↔16 等 — 展開 counts を入れ替えてから配置（Rehearsal 1,16,8…）
                result.expandedRehearsalSwap = true;
            }
        }
        return result;
    }

    /** 無音↔リージョン入れ替えの Rehearsal スロット解決（spec 1 サイクル index） */
    function resolveSilentGapRehearsalSwapSlots(track, gap, leaderIndex) {
        const gapSlotRaw =
            gap && Number.isFinite(gap.rehearsalIndex) && gap.rehearsalIndex >= 0
                ? gap.rehearsalIndex | 0
                : rehearsalSlotIndexForSilentGap(gap, track);
        const gapSlot = rehearsalSpecCycleSlotIndex(gapSlotRaw);
        const segExpandedRaw = rehearsalExpandedSlotForSilentGapSegment(track, leaderIndex);
        const segExpanded =
            segExpandedRaw != null && segExpandedRaw >= 0 ? segExpandedRaw | 0 : null;
        const segSlot = rehearsalSpecCycleSlotIndex(segExpanded);
        const notes = [];
        const regionIn =
            leaderIndex >= 0 ? getSegmentRegionTimelineIn(track, leaderIndex) : null;

        if (gapSlot == null) {
            notes.push(
                gapSlotRaw != null && gapSlotRaw >= 0
                    ? 'gapSlot outside spec cycle (expanded ' + (gapSlotRaw + 1) + ')'
                    : 'gapSlot unresolved',
            );
        }
        if (segSlot == null) {
            notes.push(
                segExpanded != null && segExpanded >= 0
                    ? 'segSlot outside spec cycle (expanded ' + (segExpanded + 1) + ')'
                    : 'segSlot unresolved',
            );
        }
        const sameSlotPartialPlacement =
            gapSlot != null &&
            segSlot != null &&
            gapSlot === segSlot &&
            isSameRehearsalSlotPartialSilentGapPlacement(track, gap, leaderIndex, {
                delta:
                    gap && leaderIndex >= 0
                        ? gap.startSec +
                          segmentBoundaryJoinEpsilonSec() * 2 -
                          getSegmentRegionTimelineIn(track, leaderIndex)
                        : null,
            });
        const gapExpanded =
            gapSlotRaw != null && gapSlotRaw >= 0 ? gapSlotRaw | 0 : null;
        const expandedModes = resolveSilentGapExpandedSwapModes(
            track,
            gap,
            leaderIndex,
            gapExpanded,
            segExpanded,
        );
        const sameSlotPartialShrink =
            sameSlotPartialPlacement && expandedModes.needsPartialSlotShrink;
        const expandedEqualBarTimelineOnly = expandedModes.expandedEqualBarTimelineOnly;
        const expandedSameSlotTimelineOnly = expandedModes.expandedSameSlotTimelineOnly;
        const expandedUnequalBarTimelineOnly = expandedModes.expandedUnequalBarTimelineOnly;
        const expandedRehearsalSwap = expandedModes.expandedRehearsalSwap;
        if (gapSlot != null && segSlot != null && gapSlot === segSlot) {
            notes.push(
                sameSlotPartialShrink
                    ? 'gapSlot === segSlot (partial silent → slot shrink + timeline placement)'
                    : expandedSameSlotTimelineOnly
                      ? 'gapSlot === segSlot (equal-bar → timeline placement only)'
                      : 'gapSlot === segSlot',
            );
        }

        if (
            gapSlot != null &&
            gapSlot >= 0 &&
            gap &&
            !rehearsalSlotOverlapsGap(gapSlot, gap)
        ) {
            notes.push('warn: gap interval vs gapSlot range mismatch');
        }
        if (
            segSlot != null &&
            segSlot >= 0 &&
            leaderIndex >= 0 &&
            !segmentRegionInWithinRehearsalSlot(track, leaderIndex, segSlot)
        ) {
            notes.push(
                'warn: regionIn ' +
                    regionSwapDiagFmtSec(regionIn) +
                    ' outside segSlot rehearsal ' +
                    rehearsalSpecCycleSlotLabel(segSlot),
            );
        }

        regionSwapDiagLog('rehearsal/slots', {
            gapSlot: gapSlot != null ? rehearsalSpecCycleSlotLabel(gapSlot) : null,
            gapGridLabel: gapSlot != null ? rehearsalSpecCycleSlotGridLabel(gapSlot) : null,
            gapExpanded: gapExpanded != null ? gapExpanded + 1 : null,
            segSlot: segSlot != null ? rehearsalSpecCycleSlotLabel(segSlot) : null,
            segGridLabel: segSlot != null ? rehearsalSpecCycleSlotGridLabel(segSlot) : null,
            segExpanded: segExpanded != null ? segExpanded + 1 : null,
            contentBars: expandedModes.contentBars || null,
            gapBars: expandedModes.gapBars || null,
            rehearsalSpecSwap: gapSlot != null && segSlot != null && gapSlot !== segSlot,
            sameSlotPartialShrink,
            expandedEqualBarTimelineOnly,
            expandedSameSlotTimelineOnly,
            expandedUnequalBarTimelineOnly,
            expandedRehearsalSwap,
            notes,
            region: leaderIndex >= 0 ? leaderIndex + 1 : null,
            regionIn: regionSwapDiagFmtSec(regionIn),
            policy: sameSlotPartialShrink
                ? 'same-slot partial silent → slot shrink + timeline placement'
                : expandedSameSlotTimelineOnly
                  ? 'same expanded slot equal-bar → timeline placement only'
                  : expandedEqualBarTimelineOnly
                    ? 'expanded equal-bar silent ↔ region → timeline placement only'
                    : expandedUnequalBarTimelineOnly
                      ? 'expanded unequal-bar silent ↔ region → timeline placement only'
                      : expandedRehearsalSwap
                        ? 'expanded rehearsal bar-count swap + timeline placement'
                        : 'rehearsal bar-count swap + timeline placement',
        });

        return {
            gapSlot,
            segSlot,
            gapExpanded,
            segExpanded: segExpanded != null && segExpanded >= 0 ? segExpanded | 0 : null,
            expandedEqualBarTimelineOnly,
            expandedSameSlotTimelineOnly,
            expandedUnequalBarTimelineOnly,
            expandedRehearsalSwap,
            sameSlotPartialShrink,
            gapBars: expandedModes.gapBars || 0,
            rehearsalSwap: gapSlot != null && segSlot != null && gapSlot !== segSlot,
            notes,
        };
    }

    function rehearsalJoinSlotIndexForSegment(track, segmentIndex) {
        return rehearsalSpecCycleSlotForSegment(track, segmentIndex);
    }

    /** 同一 Rehearsal スロット内で境界結合された連続セグメント（セパレートされていない列） */
    function collectRehearsalSlotJoinedSegmentIndices(track, segmentIndex) {
        if (!(segmentIndex >= 0)) return [];
        const segments = getTrackSegments(track);
        if (!segments.length) return [];
        const slot = rehearsalJoinSlotIndexForSegment(track, segmentIndex);
        let lo = segmentIndex;
        let hi = segmentIndex;
        while (lo > 0 && isSegmentBoundaryJoined(track, lo - 1)) {
            const leftSlot = rehearsalJoinSlotIndexForSegment(track, lo - 1);
            if (slot == null || leftSlot !== slot) break;
            lo--;
        }
        while (hi < segments.length - 1 && isSegmentBoundaryJoined(track, hi)) {
            const rightSlot = rehearsalJoinSlotIndexForSegment(track, hi + 1);
            if (slot == null || rightSlot !== slot) break;
            hi++;
        }
        const out = [];
        for (let i = lo; i <= hi; i++) out.push(i);
        return out;
    }

    /** 無音↔リージョン入れ替え対象 — 明示選択 1 件（regionGroupId のみ広げる。rehearsal 境界結合は広げない） */
    function resolveSilentGapSwapSegmentIndices(track, segEntries) {
        if (!segEntries || segEntries.length !== 1) return [];
        const idx = segEntries[0].segmentIndex | 0;
        if (!(idx >= 0)) return [];
        const gid = getSegmentRegionGroupId(track, idx);
        if (gid) {
            return sortSegmentIndicesByTimeline(
                track,
                collectRegionGroupMemberIndices(track, idx),
            );
        }
        return [idx];
    }

    function rehearsalLayoutExpandedRangesSnapshot() {
        if (typeof window.musicalGridDrawSettings !== 'function') return [];
        const settings = window.musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return [];
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return [];
        const layoutDuration =
            typeof window.resolveRehearsalLayoutDurationSec === 'function'
                ? window.resolveRehearsalLayoutDurationSec(
                      settings.meterSpec,
                      master,
                      settings.rehearsalSpec,
                  )
                : master;
        const counts = expandedRehearsalGroupBarCountsSnapshot();
        if (!counts.length) return [];
        if (typeof window.collectRehearsalGroupRangesFromBarCounts === 'function') {
            return window.collectRehearsalGroupRangesFromBarCounts(
                settings.meterSpec,
                layoutDuration,
                counts,
            );
        }
        return [];
    }

    function collectTrackSourceStreamForRehearsalLayout(track) {
        const defaultClip = getPrimaryClipIdForTrack(track);
        const fullDur = getTrackSourceDurationSec(track);
        if (!(fullDur > PLAYBACK_REGION_MIN_SEC)) return [];
        return [
            {
                clipId: defaultClip,
                sourceInSec: 0,
                sourceOutSec: fullDur,
            },
        ];
    }

    function takeSourceSliceFromStream(stream, cursor, wantDur, defaultClipId) {
        const next = {
            partIndex: cursor.partIndex | 0,
            offsetSec: cursor.offsetSec || 0,
        };
        if (!(wantDur > 0.00001) || !stream.length) {
            return {
                clipId: defaultClipId,
                sourceInSec: 0,
                sourceOutSec: 0,
                takenSec: 0,
                cursor: next,
            };
        }
        let clipId = defaultClipId;
        let sourceInSec = 0;
        let sourceOutSec = 0;
        let takenSec = 0;
        let started = false;
        while (next.partIndex < stream.length && takenSec < wantDur - 0.00001) {
            const part = stream[next.partIndex];
            const partDur = Math.max(
                0,
                (Number(part.sourceOutSec) || 0) - (Number(part.sourceInSec) || 0),
            );
            const avail = Math.max(0, partDur - next.offsetSec);
            if (!(avail > 0.00001)) {
                next.partIndex++;
                next.offsetSec = 0;
                continue;
            }
            const take = Math.min(wantDur - takenSec, avail);
            if (!started) {
                clipId = part.clipId || defaultClipId;
                sourceInSec = (Number(part.sourceInSec) || 0) + next.offsetSec;
                sourceOutSec = sourceInSec + take;
                started = true;
            } else if ((part.clipId || defaultClipId) === clipId) {
                sourceOutSec += take;
            } else {
                break;
            }
            takenSec += take;
            next.offsetSec += take;
            if (next.offsetSec >= partDur - 0.00001) {
                next.partIndex++;
                next.offsetSec = 0;
            }
        }
        return {
            clipId,
            sourceInSec,
            sourceOutSec,
            takenSec,
            cursor: next,
        };
    }

    function rehearsalLayoutPlacementSecForRange(range) {
        if (!range || !Number.isFinite(range.startSec)) return null;
        const eps = segmentBoundaryJoinEpsilonSec();
        return range.startSec + eps * 2;
    }

    function rehearsalCompositionLayoutReady(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (
            !o.forceLayout &&
            typeof window.getMusicalGridRehearsalFillVisible === 'function' &&
            !window.getMusicalGridRehearsalFillVisible()
        ) {
            return false;
        }
        if (typeof window.musicalGridDrawSettings !== 'function') return false;
        const settings = window.musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return false;
        if (!settings.rehearsalSpec || !settings.rehearsalSpec.sizes.length) return false;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        return master > 0;
    }

    function commitRehearsalLayoutSegments(track, nextSegments, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const segOpt = {
            silent: true,
            skipUndo: true,
            segmentStructureChanged: true,
            affectedSegmentIndices: nextSegments.map((_, idx) => idx),
        };
        if (typeof window.setTrackSegments === 'function') {
            if (window.setTrackSegments(track, nextSegments, segOpt)) {
                return true;
            }
        } else if (typeof setTrackSegments === 'function') {
            if (setTrackSegments(track, nextSegments, segOpt)) {
                return true;
            }
        }
        const fullDur = getTrackSourceDurationSec(track);
        if (!(fullDur > PLAYBACK_REGION_MIN_SEC)) return false;
        const normalized = [];
        for (let i = 0; i < nextSegments.length; i++) {
            normalized.push(normalizeSegmentEntry(nextSegments[i], track, fullDur));
        }
        if (!normalized.length) return false;
        const state = getPlaybackRegionsState(track);
        if (!state) return false;
        state.segments = normalized;
        state.active = true;
        syncTrackRegionHeadStateFromFirstSegment(track);
        bumpRegionPersistEpoch(track.slot);
        if (typeof window.refreshTrackTimelineMusicalSlots === 'function') {
            window.refreshTrackTimelineMusicalSlots(track, { preserveStored: false });
        }
        if (typeof updateTrackRegionOverlays === 'function') {
            updateTrackRegionOverlays(track);
        }
        if (typeof redrawAfterRegionChange === 'function') {
            redrawAfterRegionChange(track.slot, {
                segmentStructureChanged: true,
                affectedSegmentIndices: nextSegments.map((_, idx) => idx),
            });
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (!o.skipPersist && typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        return true;
    }

    /** Rehearsal 欄確定 — 展開スロットごとに 1 リージョンへ再配置 */
    function applyRehearsalCompositionToTrackRegions(track, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!isExtraTrackRef(track)) return false;
        if (!rehearsalCompositionLayoutReady(o)) return false;
        const ranges = rehearsalLayoutExpandedRangesSnapshot();
        if (!ranges.length) return false;
        if (!isTrackRegionActive(track)) {
            if (typeof ensureDefaultTrackRegion === 'function') {
                ensureDefaultTrackRegion(track, { skipOverlay: true, silent: true });
            }
        }
        if (!isTrackRegionActive(track)) return false;

        const oldSegments =
            typeof getTrackSegments === 'function' ? getTrackSegments(track) : [];
        const metaBySegmentIndex = [];
        const beforeBoundsMap =
            typeof captureTrackSegmentRegionBoundsMap === 'function'
                ? captureTrackSegmentRegionBoundsMap(track)
                : null;
        for (let si = 0; si < oldSegments.length; si++) {
            const seg = oldSegments[si];
            metaBySegmentIndex[si] = {
                gainDb:
                    typeof getSegmentGainDb === 'function'
                        ? getSegmentGainDb(track, si)
                        : seg.gainDb,
                pitchSemitones:
                    typeof getSegmentPitchSemitones === 'function'
                        ? getSegmentPitchSemitones(track, si)
                        : seg.pitchSemitones,
                fadeInSec: seg.fadeInSec,
                fadeOutSec: seg.fadeOutSec,
            };
        }

        const stream = collectTrackSourceStreamForRehearsalLayout(track);
        const defaultClip = getPrimaryClipIdForTrack(track);
        let cursor = { partIndex: 0, offsetSec: 0 };
        const nextSegments = [];
        const eps = segmentBoundaryJoinEpsilonSec();
        const sourceTimeOffsetSec = Math.max(0, Number(o.sourceTimeOffsetSec) || 0);
        const gridLeadPadSec = Math.max(0, Number(o.gridLeadPadSec) || 0);
        const fullClipDur = getTrackSourceDurationSec(track);
        const mapSourceFromBarRanges =
            !!o.mapSourceFromBarRanges &&
            stream.length === 1 &&
            (() => {
                if (!(fullClipDur > PLAYBACK_REGION_MIN_SEC)) return false;
                const part = stream[0];
                const inS = Number(part.sourceInSec) || 0;
                const outS = Number(part.sourceOutSec) || 0;
                return inS <= eps && outS >= fullClipDur - eps;
            })();

        const fileGridOriginSec = mapSourceFromBarRanges
            ? (() => {
                  const lead = gridLeadPadSec > 0.00001 ? gridLeadPadSec : 0;
                  const sync = sourceTimeOffsetSec > 0.00001 ? sourceTimeOffsetSec : 0;
                  if (lead > 0 && sync > 0) return lead - sync;
                  if (lead > 0) return lead;
                  if (sync > 0) return sync;
                  return 0;
              })()
            : 0;

        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (!r || !Number.isFinite(r.startSec) || !Number.isFinite(r.endSec)) continue;
            const slotDur = r.endSec - r.startSec;
            if (!(slotDur > eps)) continue;
            const placementSec = mapSourceFromBarRanges
                ? r.startSec
                : rehearsalLayoutPlacementSecForRange(r);
            if (placementSec == null) continue;

            const leadPad =
                i === 0 && mapSourceFromBarRanges
                    ? gridLeadPadSec > 0.00001
                        ? gridLeadPadSec
                        : sourceTimeOffsetSec > 0.00001
                          ? sourceTimeOffsetSec
                          : 0
                    : 0;
            let timelineAnchor = placementSec;

            let slice;
            if (mapSourceFromBarRanges) {
                let fileIn = r.startSec - fileGridOriginSec;
                let fileOut = r.endSec - fileGridOriginSec;
                if (i === 0) {
                    fileIn = 0;
                    const preRollGridOnly =
                        leadPad > 0.00001 && Math.abs(slotDur - leadPad) <= eps;
                    if (
                        !preRollGridOnly &&
                        leadPad > 0.00001 &&
                        sourceTimeOffsetSec > 0.00001 &&
                        gridLeadPadSec > 0.00001
                    ) {
                        // GAC 無音 + MusicalUpbeat pickup — Out は slot 終端（1 小節目線）
                        fileOut = sourceTimeOffsetSec;
                        timelineAnchor = placementSec + leadPad;
                    } else if (leadPad > 0.00001) {
                        // GAC 先頭 Rehearsal（例: 8 小節 @ 140）— グリッドのみ、ファイルは消費しない
                        fileOut = 0;
                        timelineAnchor = placementSec + leadPad;
                    } else if (sourceTimeOffsetSec > 0.00001) {
                        fileOut = r.endSec - sourceTimeOffsetSec;
                        timelineAnchor = placementSec + sourceTimeOffsetSec;
                    } else {
                        fileOut = r.endSec;
                    }
                } else if (
                    i === ranges.length - 1 &&
                    fullClipDur > fileIn + PLAYBACK_REGION_MIN_SEC
                ) {
                    // 最終 slot — グリッド→ファイル変換の端数（GAC / sync 分）をファイル末尾まで含める
                    fileOut = fullClipDur;
                }
                slice = {
                    clipId: stream[0].clipId || defaultClip,
                    sourceInSec: fileIn,
                    sourceOutSec: fileOut,
                    takenSec: slotDur,
                };
            } else {
                slice = takeSourceSliceFromStream(
                    stream,
                    cursor,
                    slotDur,
                    defaultClip,
                );
                cursor = slice.cursor;
            }
            if (!(slice.takenSec >= PLAYBACK_REGION_MIN_SEC)) continue;

            const seg = {
                id: newRegionId(),
                clipId: slice.clipId,
                sourceInSec: slice.sourceInSec,
                sourceOutSec: slice.sourceOutSec,
                timelineStartSec: timelineAnchor,
                regionTimelineInSec:
                    leadPad > 0.00001 ? placementSec : timelineAnchor,
            };
            if (leadPad > 0.00001) {
                seg.regionLeadPadSec = leadPad;
            }
            const meta = i < metaBySegmentIndex.length ? metaBySegmentIndex[i] : null;
            if (meta && !mapSourceFromBarRanges) {
                if (Number.isFinite(meta.gainDb) && Math.abs(meta.gainDb) > 0.0005) {
                    seg.gainDb = meta.gainDb;
                }
                if (Number.isFinite(meta.pitchSemitones) && meta.pitchSemitones !== 0) {
                    seg.pitchSemitones = Math.round(meta.pitchSemitones);
                }
                if (Number.isFinite(meta.fadeInSec) && meta.fadeInSec > 0.0005) {
                    seg.fadeInSec = meta.fadeInSec;
                }
                if (Number.isFinite(meta.fadeOutSec) && meta.fadeOutSec > 0.0005) {
                    seg.fadeOutSec = meta.fadeOutSec;
                }
            }
            nextSegments.push(seg);
        }

        if (!nextSegments.length) return false;

        if (!o.skipUndo && !regionUndoPaused) {
            requestRegionUndoCapture();
        }

        const t0 = getTrackTimelineStartSec(track);
        const state = getPlaybackRegionsState(track);
        if (state) {
            delete state.timelineSlots;
            const firstIn = nextSegments[0].regionTimelineInSec;
            state.headPadSec = Math.max(0, (Number(firstIn) || 0) - t0);
            state.regionTimelineInSec = Math.max(0, Number(firstIn) || 0);
            const firstLead = Number(nextSegments[0].regionLeadPadSec) || 0;
            if (firstLead > 0.00001) {
                state.regionLeadPadSec = firstLead;
            } else {
                delete state.regionLeadPadSec;
            }
        }

        if (!commitRehearsalLayoutSegments(track, nextSegments, o)) {
            return false;
        }
        if (
            beforeBoundsMap &&
            typeof relocateRegionVolumePitchMarkersAfterLayout === 'function'
        ) {
            relocateRegionVolumePitchMarkersAfterLayout(track, beforeBoundsMap, {
                silent: true,
            });
        }
        if (
            beforeBoundsMap &&
            typeof syncSegmentVolumePitchAfterRegionLayout === 'function'
        ) {
            syncSegmentVolumePitchAfterRegionLayout(track, beforeBoundsMap, {
                silent: true,
            });
        }
        if (typeof schedulePitchSliceRenderForTrack === 'function') {
            schedulePitchSliceRenderForTrack(track);
        }
        noteRegionShrinkPersistIntent(track.slot);

        if (!o.silent && typeof writeLog === 'function') {
            writeLog(
                'Ex ' +
                    (track.slot + 1) +
                    ': regions laid out to Rehearsal (' +
                    nextSegments.length +
                    ' region(s))',
            );
        }
        return true;
    }

    function applyRehearsalCompositionToAllExtraTrackRegions(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (
            !o.preserveRehearsalBarCountsOverride &&
            typeof window.clearRehearsalGroupBarCountsOverride === 'function'
        ) {
            window.clearRehearsalGroupBarCountsOverride();
        }
        if (!rehearsalCompositionLayoutReady(o)) return 0;
        if (!o.skipUndo && !regionUndoPaused) {
            requestRegionUndoCapture();
        }
        const n = getExtraTrackCount();
        const onlySlot = Number.isFinite(o.onlySlot) ? o.onlySlot | 0 : null;
        let rebuilt = 0;
        for (let slot = 0; slot < n; slot++) {
            if (onlySlot != null && slot !== onlySlot) continue;
            const track = { type: 'extra', slot };
            if (
                typeof isExtraTrackLoaded === 'function' &&
                !isExtraTrackLoaded(slot) &&
                !isTrackRegionActive(track)
            ) {
                continue;
            }
            if (!(getTrackSourceDurationSec(track) > PLAYBACK_REGION_MIN_SEC)) {
                continue;
            }
            if (
                applyRehearsalCompositionToTrackRegions(track, {
                    silent: true,
                    skipUndo: true,
                    forceLayout: !!o.forceLayout,
                    mapSourceFromBarRanges: !!o.mapSourceFromBarRanges,
                    gridLeadPadSec: o.gridLeadPadSec,
                    sourceTimeOffsetSec: o.sourceTimeOffsetSec,
                })
            ) {
                rebuilt++;
            }
        }
        if (rebuilt > 0) {
            if (typeof schedulePersistSession === 'function') schedulePersistSession();
            if (typeof syncExtraAudioToTransport === 'function') {
                syncExtraAudioToTransport({ force: true });
            }
            if (typeof refreshAllRegionMusicalMetaPresentation === 'function') {
                refreshAllRegionMusicalMetaPresentation();
            } else if (typeof refreshAllRegionRehearsalMarkLabels === 'function') {
                refreshAllRegionRehearsalMarkLabels();
            }
            if (!o.silent && typeof flashSeekHint === 'function') {
                flashSeekHint('Rehearsal', rebuilt + ' Ex track(s) realigned', 'notice');
            }
        }
        return rebuilt;
    }
    /** musical-grid 実装を core 読込時に固定（global 関数名衝突で再帰しないよう） */
    const _musicalGridExpandedRehearsalGroupBarCountsFn =
        typeof window.getExpandedRehearsalGroupBarCountsSnapshot === 'function'
            ? window.getExpandedRehearsalGroupBarCountsSnapshot
            : null;

    /** 展開済み Rehearsal グループ小節数列 */
    function expandedRehearsalGroupBarCountsSnapshot() {
        if (!_musicalGridExpandedRehearsalGroupBarCountsFn) {
            regionSwapDiagLog('rehearsal/counts', { error: 'API missing' });
            return [];
        }
        try {
            return _musicalGridExpandedRehearsalGroupBarCountsFn();
        } catch (err) {
            regionSwapDiagLog('rehearsal/counts', {
                error: 'snapshot threw',
                message: err && err.message ? err.message : String(err),
            });
            return [];
        }
    }

    /** 指定 Region In より後ろで最も早い他セグメント In */
    function nextSegmentRegionInAfter(track, segmentIndex, regionIn, segmentsOpt) {
        const segments = segmentsOpt || getTrackSegments(track);
        const eps = segmentBoundaryJoinEpsilonSec();
        const s = Number(regionIn);
        if (!Number.isFinite(s)) return null;
        let nextIn = null;
        for (let i = 0; i < segments.length; i++) {
            if (i === segmentIndex) continue;
            const seg = segments[i];
            const rin =
                segmentsOpt != null
                    ? segmentCopyRegionIn(seg)
                    : getSegmentRegionTimelineIn(track, i);
            if (rin > s + eps && (nextIn == null || rin < nextIn)) nextIn = rin;
        }
        return nextIn;
    }

    /**
     * Rehearsal スロット先頭配置 — 長さが slot 終端や次リージョンと重なるときは手前へ寄せる（クロスフェード防止）。
     */
    /**
     * 先頭 head pad 付き 1 小節リージョン（R1）— 非対称 swap の ripple/snap 対象外。
     * Rehearsal 0・segment 0 で、ソース In がトランスポート先頭より大きく離れている。
     */
    function isHeadPadAnchoredSwapSlot(track, slot, segmentsOpt) {
        if (!slot || slot.kind === 'silent' || !slot.segmentRefs || !slot.segmentRefs.length) {
            return false;
        }
        const musical = slot.musical;
        if (!musical || (musical.rehearsalSlotIndex | 0) !== 0) return false;
        const leader = slot.segmentRefs[0].segmentIndex | 0;
        if (leader !== 0) return false;
        const segments =
            segmentsOpt ||
            (typeof getTrackSegments === 'function' ? getTrackSegments(track) : null);
        const seg = segments && segments[leader];
        if (!seg) return false;
        const eps = segmentBoundaryJoinEpsilonSec();
        const leadPad = Math.max(0, Number(seg.regionLeadPadSec) || 0);
        if (leadPad > eps * 4) return true;
        const state =
            typeof getPlaybackRegionsState === 'function'
                ? getPlaybackRegionsState(track)
                : null;
        const headPad = state && Number.isFinite(state.headPadSec) ? state.headPadSec : 0;
        if (headPad > eps * 4) return true;
        const t0 =
            typeof getTrackTimelineStartSec === 'function'
                ? getTrackTimelineStartSec(track)
                : 0;
        const regionIn =
            typeof segmentCopyRegionIn === 'function'
                ? segmentCopyRegionIn(seg)
                : typeof getSegmentRegionTimelineIn === 'function'
                  ? getSegmentRegionTimelineIn(track, leader)
                  : 0;
        return regionIn > t0 + eps * 4;
    }

    function rehearsalSlotRegionInTargetSec(track, slotIndex, segmentIndex, segmentsOpt) {
        const segments =
            segmentsOpt ||
            (typeof getTrackSegments === 'function' ? getTrackSegments(track) : null);
        const headPadSlot = {
            kind: 'audio-single',
            segmentRefs: [{ segmentIndex: segmentIndex | 0 }],
            musical: { rehearsalSlotIndex: slotIndex | 0 },
        };
        if (
            typeof isHeadPadAnchoredSwapSlot === 'function' &&
            isHeadPadAnchoredSwapSlot(track, headPadSlot, segments)
        ) {
            const seg = segments && segments[segmentIndex | 0];
            if (seg) {
                return typeof segmentCopyRegionIn === 'function'
                    ? segmentCopyRegionIn(seg)
                    : typeof getSegmentRegionTimelineIn === 'function'
                      ? getSegmentRegionTimelineIn(track, segmentIndex | 0)
                      : rehearsalSlotPlacementSec(slotIndex);
            }
        }
        const slotStart = rehearsalSlotPlacementSec(slotIndex);
        if (slotStart == null) return null;
        const seg = segments && segments[segmentIndex];
        if (!seg) return slotStart;
        const eps = segmentBoundaryJoinEpsilonSec();
        const segDur = segmentCopySourceDurSec(seg);
        let maxIn = Infinity;
        const ranges = rehearsalSlotRangesSnapshot();
        const slotRange = ranges[slotIndex | 0];
        if (slotRange && Number.isFinite(slotRange.endSec)) {
            maxIn = Math.min(maxIn, slotRange.endSec - eps - segDur);
        }
        const nextIn = nextSegmentRegionInAfter(
            track,
            segmentIndex,
            slotStart,
            segmentsOpt,
        );
        if (nextIn != null) {
            maxIn = Math.min(maxIn, nextIn - eps - segDur);
        }
        if (!Number.isFinite(maxIn)) return slotStart;
        if (slotStart > maxIn + eps * 0.5) {
            return maxIn;
        }
        return slotStart;
    }

    /**
     * 無音↔リージョン入れ替え計画。
     * ① Rehearsal 小節数を gapSlot↔segSlot で交換した後は afterRehearsalSwap で range 再取得。
     */
    function silentGapSegmentSwapPlan(track, gap, segmentIndices, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const sorted = sortSegmentIndicesByTimeline(
            track,
            (Array.isArray(segmentIndices) ? segmentIndices : [segmentIndices | 0]).filter(
                (i) => i >= 0,
            ),
        );
        const leaderIndex = sorted.length ? sorted[0] : -1;
        const segRegionIn =
            leaderIndex >= 0 ? getSegmentRegionTimelineIn(track, leaderIndex) : 0;
        const slots =
            gap && leaderIndex >= 0
                ? resolveSilentGapRehearsalSwapSlots(track, gap, leaderIndex)
                : { gapSlot: null, segSlot: null, rehearsalSwap: false };
        const eps = segmentBoundaryJoinEpsilonSec();
        const gapSlotIdx =
            gap && Number.isFinite(gap.rehearsalIndex) && gap.rehearsalIndex >= 0
                ? gap.rehearsalIndex | 0
                : slots.gapSlot;
        let targetSec = null;
        const timelineOnlyTarget =
            !!slots.expandedEqualBarTimelineOnly ||
            !!slots.expandedSameSlotTimelineOnly ||
            !!slots.expandedUnequalBarTimelineOnly;
        if (o.afterRehearsalSwap && gapSlotIdx != null && gapSlotIdx >= 0 && leaderIndex >= 0) {
            targetSec = rehearsalSlotRegionInTargetSec(track, gapSlotIdx, leaderIndex);
        } else if (o.afterRehearsalSwap && gapSlotIdx != null && gapSlotIdx >= 0) {
            targetSec = rehearsalSlotPlacementSec(gapSlotIdx);
        } else if (timelineOnlyTarget && gap && Number.isFinite(gap.startSec)) {
            targetSec = gap.startSec + eps;
        } else if (gap && Number.isFinite(gap.startSec)) {
            targetSec = gap.startSec + eps;
        }
        if (targetSec == null && gapSlotIdx != null && gapSlotIdx >= 0) {
            targetSec = rehearsalSlotPlacementSec(gapSlotIdx);
        }
        if (targetSec == null) targetSec = silentGapMoveTargetSec(gap, track);
        return {
            segRegionIn,
            targetSec,
            delta: targetSec - segRegionIn,
            rehearsalGap: slots.gapSlot,
            rehearsalSeg: slots.segSlot,
            gapExpanded: slots.gapExpanded,
            segExpanded: slots.segExpanded,
            expandedEqualBarTimelineOnly: !!slots.expandedEqualBarTimelineOnly,
            expandedSameSlotTimelineOnly: !!slots.expandedSameSlotTimelineOnly,
            expandedUnequalBarTimelineOnly: !!slots.expandedUnequalBarTimelineOnly,
            expandedRehearsalSwap: !!slots.expandedRehearsalSwap,
            sameSlotPartialShrink: !!slots.sameSlotPartialShrink,
            gapBars: slots.gapBars || 0,
            rehearsalSwapNeeded: !!(
                slots.gapSlot != null && slots.segSlot != null && slots.gapSlot !== slots.segSlot
            ),
            leaderIndex,
            segmentIndices: sorted,
        };
    }

    /** Region Out 直前が属する Rehearsal スロット */
    function rehearsalSlotIndexAtRegionOutSec(transportSec) {
        if (!Number.isFinite(transportSec)) return null;
        const ranges = rehearsalSlotRangesSnapshot();
        if (!ranges.length) return rehearsalSlotIndexAtTransportSec(transportSec);
        const eps = segmentBoundaryJoinEpsilonSec();
        const s = Number(transportSec) - eps;
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (s >= r.startSec - eps && s < r.endSec - eps) return i;
        }
        return rehearsalSlotIndexAtTransportSec(s);
    }

    function sourceDurationSecForSegmentCopy(seg) {
        if (!seg) return 0;
        return Math.max(
            0,
            (Number(seg.sourceOutSec) || 0) - (Number(seg.sourceInSec) || 0),
        );
    }

    /** リージョン In 付近の 1 小節秒数からソース長を小節数換算 */
    function estimateContentBarCountAtRegionIn(regionInSec, sourceDurSec) {
        const counts = expandedRehearsalGroupBarCountsSnapshot();
        const ranges = rehearsalSlotRangesSnapshot();
        if (!counts.length || !ranges.length || !(sourceDurSec > 0)) return 1;
        const idx = rehearsalSlotIndexAtRegionInSec(regionInSec);
        if (idx == null || idx < 0 || idx >= counts.length) return 1;
        const r = ranges[idx];
        const bars = counts[idx] | 0;
        if (!r || !(bars > 0)) return 1;
        const slotDur = r.endSec - r.startSec;
        if (!(slotDur > 0.00001)) return bars;
        const eps = segmentBoundaryJoinEpsilonSec();
        const barDur = slotDur / bars;
        const slotEstimate = Math.max(1, Math.round(sourceDurSec / barDur));
        // 1 小節スロット等 — slot 内 barDur が極端に短く contentBars が膨らむのを防ぐ
        if (bars === 1 && sourceDurSec > slotDur + eps) {
            const regionOut = regionInSec + sourceDurSec;
            const outIdx = rehearsalSlotIndexAtRegionOutSec(regionOut);
            if (outIdx != null && outIdx >= idx && outIdx < counts.length) {
                let spanSum = 0;
                for (let i = idx; i <= outIdx; i++) spanSum += counts[i] | 0;
                if (spanSum > 0) return spanSum;
            }
        }
        if (slotEstimate > bars * 2) {
            return Math.min(slotEstimate, bars);
        }
        return slotEstimate;
    }

    function estimateRegionContentBarCountForSegment(track, segmentIndex) {
        if (!(segmentIndex >= 0)) return 0;
        const seg = getTrackSegments(track)[segmentIndex];
        if (!seg) return 0;
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        return estimateContentBarCountAtRegionIn(
            regionIn,
            sourceDurationSecForSegmentCopy(seg),
        );
    }

    window.logSessionRestoreRegionRehearsalSnapshot = logSessionRestoreRegionRehearsalSnapshot;
    window.applyRehearsalCompositionToTrackRegions = applyRehearsalCompositionToTrackRegions;
    window.applyRehearsalCompositionToAllExtraTrackRegions =
        applyRehearsalCompositionToAllExtraTrackRegions;
    window.rehearsalSlotIndexAtRegionInSec = rehearsalSlotIndexAtRegionInSec;
    window.resolveSegmentIndexForRehearsalSlot = resolveSegmentIndexForRehearsalSlot;
    window.rehearsalNavStartSecForSlot = rehearsalNavStartSecForSlot;
    window.rehearsalSlotIndexForSilentGap = rehearsalSlotIndexForSilentGap;
    window.rehearsalSlotStartSec = rehearsalSlotStartSec;
    window.collectRehearsalSlotJoinedSegmentIndices = collectRehearsalSlotJoinedSegmentIndices;
    window.isHeadPadAnchoredSwapSlot = isHeadPadAnchoredSwapSlot;
    window.silentGapSegmentSwapPlan = silentGapSegmentSwapPlan;
    window.resolveSilentGapSwapSegmentIndices = resolveSilentGapSwapSegmentIndices;
    window.estimateRegionContentBarCountForSegment = estimateRegionContentBarCountForSegment;
    window.isSameRehearsalSlotPartialSilentGapPlacement = isSameRehearsalSlotPartialSilentGapPlacement;
