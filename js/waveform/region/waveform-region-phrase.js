/**
 * waveform-region-phrase.js — Phrase スロット解決・無音 gap・Phrase 欄レイアウト
 */
    function validatePhraseSpecForContentSwap() {
        if (
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            !getMusicalGridPhraseFillVisible()
        ) {
            return { ok: false, reason: 'phrase fill off' };
        }
        if (typeof parsePhraseGroupingSpec !== 'function') {
            return { ok: false, reason: 'invalid phrase spec' };
        }
        const text = regionSwapDiagPhraseText();
        const spec = parsePhraseGroupingSpec(text);
        if (!spec || !spec.sizes || !spec.sizes.length) {
            return { ok: false, reason: 'invalid phrase spec' };
        }
        for (let i = 0; i < spec.sizes.length; i++) {
            if (!(spec.sizes[i] > 0)) {
                return { ok: false, reason: 'invalid phrase spec' };
            }
        }
        return { ok: true, text, slotCount: spec.sizes.length };
    }

    function ensurePhraseSpecReadyForContentSwap(context) {
        const check = validatePhraseSpecForContentSwap();
        if (check.ok) return true;
        regionSwapDiagLog('phrase/spec-blocked', {
            context: context || '',
            reason: check.reason,
            text: check.text || regionSwapDiagPhraseText(),
        });
        return false;
    }

    /** セッション復元完了時 — SwapUnit baseline（[MusicalSlot] dump/session-restore） */
    function logSessionRestoreRegionPhraseSnapshot() {
        if (typeof window.logSessionRestoreMusicalSlotSnapshot === 'function') {
            window.logSessionRestoreMusicalSlotSnapshot();
        } else if (typeof writeLog === 'function') {
            regionSwapDiagLog('session/restore', {
                text: regionSwapDiagPhraseText() || '',
                fill: !!(
                    typeof getMusicalGridPhraseFillVisible === 'function' &&
                    getMusicalGridPhraseFillVisible()
                ),
                specSlots: phraseSpecCycleSlotCount(),
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
    function phraseSlotRangesSnapshot() {
        if (typeof getPhraseGroupRangesSnapshot !== 'function') return [];
        return getPhraseGroupRangesSnapshot();
    }

    /** Phrase 欄 1 サイクル分のスロット数。長尺マスター展開 index とは別。 */
    function phraseSpecCycleSlotCount() {
        if (typeof musicalGridDrawSettings === 'function') {
            const settings = musicalGridDrawSettings();
            if (settings && settings.phraseSpec && settings.phraseSpec.sizes) {
                return settings.phraseSpec.sizes.length;
            }
        }
        if (typeof parsePhraseGroupingSpec === 'function') {
            const spec = parsePhraseGroupingSpec(regionSwapDiagPhraseText());
            if (spec && spec.sizes && spec.sizes.length) return spec.sizes.length;
        }
        return 0;
    }

    /** 入れ替え対象は Phrase 定義 1 サイクル内（index 0..n-1）のみ */
    function phraseSpecCycleSlotIndex(rawIndex) {
        if (rawIndex == null || rawIndex < 0) return null;
        const idx = rawIndex | 0;
        const cycle = phraseSpecCycleSlotCount();
        if (cycle > 0 && idx >= cycle) return null;
        return idx;
    }

    /** 展開 index → spec 1 サイクル内 index（長尺末尾の繰り返し index は null） */
    function phraseSpecCycleSlotForTransportSec(transportSec) {
        return phraseSpecCycleSlotIndex(phraseSlotIndexAtTransportSec(transportSec));
    }

    /** 入れ替え E 用 — spec 1 サイクル内スロットのみ（Region In 基準） */
    function phraseSpecCycleSlotForSegment(track, segmentIndex) {
        if (!(segmentIndex >= 0)) return null;
        return phraseSpecCycleSlotIndex(
            phraseSlotIndexAtRegionInSec(getSegmentRegionTimelineIn(track, segmentIndex)),
        );
    }


    /** ユーザー向け「頭から N 個目」（1 始まり） */
    function phraseSpecCycleSlotLabel(slotIndex) {
        if (slotIndex == null || slotIndex < 0) return '?';
        return String((slotIndex | 0) + 1);
    }

    /** タイムライン着色ラベル（0 始まり: A, B … Z, AA …） */
    function phraseSpecCycleSlotGridLabel(slotIndex) {
        if (slotIndex == null || slotIndex < 0) return '?';
        if (typeof phraseGroupLabelForIndex === 'function') {
            return phraseGroupLabelForIndex(slotIndex);
        }
        return String(slotIndex);
    }

    function syncTrackHeadPadFromFirstSegment(track, segments) {
        if (!segments || !segments.length) return;
        const state = getPlaybackRegionsState(track);
        if (!state) return;
        const t0 = getTrackTimelineStartSec(track);
        const seg0 = segments[0];
        if (!seg0 || !Number.isFinite(seg0.timelineStartSec)) return;
        state.headPadSec = Math.max(0, seg0.timelineStartSec - t0);
        if (Number.isFinite(seg0.regionTimelineInSec)) {
            state.regionTimelineInSec = Math.max(0, seg0.regionTimelineInSec);
        } else {
            delete state.regionTimelineInSec;
        }
        if (Number.isFinite(seg0.regionLeadPadSec) && seg0.regionLeadPadSec > 0.00001) {
            state.regionLeadPadSec = seg0.regionLeadPadSec;
        } else {
            delete state.regionLeadPadSec;
        }
    }

    /** transport 秒が属する Phrase スロット index */
    function phraseSlotIndexAtTransportSec(transportSec) {
        if (!Number.isFinite(transportSec)) return null;
        if (typeof resolvePhraseGroupIndexAtTransportSec !== 'function') return null;
        const idx = resolvePhraseGroupIndexAtTransportSec(transportSec);
        if (idx == null || idx < 0) return null;
        return idx;
    }

    /**
     * Region In 用 — フレーズ境界上は「その秒から始まるスロット」に属する（半開区間 [start, end)）。
     */
    function phraseSlotIndexAtRegionInSec(transportSec) {
        if (!Number.isFinite(transportSec)) return null;
        const ranges = phraseSlotRangesSnapshot();
        if (!ranges.length) return phraseSlotIndexAtTransportSec(transportSec);
        const eps = segmentBoundaryJoinEpsilonSec();
        const s = Number(transportSec);
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (s >= r.startSec - eps && s < r.endSec - eps) return i;
        }
        return phraseSlotIndexAtTransportSec(transportSec);
    }

    function phraseSlotStartSec(slotIndex) {
        const ranges = phraseSlotRangesSnapshot();
        const r = ranges[slotIndex | 0];
        return r && Number.isFinite(r.startSec) ? r.startSec : null;
    }

    function isPhraseRangeUncoveredByTrack(track, phraseIndex, ranges) {
        const r = ranges[phraseIndex];
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

    /** この Phrase スロット内に Region In を持つセグメントが無い（無音スロット選択用） */
    function isPhraseSlotWithoutAnchoredRegion(track, phraseIndex, ranges) {
        const r = ranges[phraseIndex];
        if (!r || !track) return false;
        const eps = segmentBoundaryJoinEpsilonSec();
        const segments = getTrackSegments(track);
        for (let si = 0; si < segments.length; si++) {
            const regionIn = getSegmentRegionTimelineIn(track, si);
            if (regionIn >= r.startSec - eps && regionIn < r.endSec - eps) return false;
        }
        return true;
    }

    /** 無音ギャップ区間が重なる Phrase スロット（gap.phraseIndex を優先） */
    function phraseSlotIndexForSilentGap(gap, track) {
        if (
            typeof getMusicalGridPhraseFillVisible !== 'function' ||
            !getMusicalGridPhraseFillVisible()
        ) {
            return null;
        }
        if (gap && Number.isFinite(gap.phraseIndex) && gap.phraseIndex >= 0) {
            return gap.phraseIndex | 0;
        }
        const ranges = phraseSlotRangesSnapshot();
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
                isPhraseRangeUncoveredByTrack(track, i, ranges) &&
                overlap > bestUncoveredOverlap
            ) {
                bestUncoveredOverlap = overlap;
                bestUncovered = i;
            }
        }
        if (bestUncovered != null) return bestUncovered;
        if (bestAny != null) return bestAny;
        return phraseSlotIndexAtTransportSec((gap.startSec + gap.endSec) * 0.5);
    }

    /** タイムライン区間が最も多く重なる Phrase スロット（境界 ε 付近の誤判定を避ける） */
    function phraseDominantSlotForInterval(regionIn, regionOut) {
        if (!Number.isFinite(regionIn) || !Number.isFinite(regionOut)) return null;
        const ranges = phraseSlotRangesSnapshot();
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

    /** リージョン In が属する Phrase スロット */
    function phraseSlotIndexForSegment(track, segmentIndex) {
        if (!(segmentIndex >= 0)) return null;
        return phraseSlotIndexAtRegionInSec(getSegmentRegionTimelineIn(track, segmentIndex));
    }

    /**
     * 無音↔リージョン入れ替え — 複数 Phrase に跨るリージョンは重なり最大のスロットを採用。
     * Region In が 1 小節スロット内でも本体は次スロット（例: r2 @ 0.1s → phrase 2）。
     */
    function phraseExpandedSlotForSilentGapSegment(track, segmentIndex) {
        if (!(segmentIndex >= 0)) return null;
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const regionOut = getSegmentRegionTimelineOut(track, segmentIndex);
        const dominant = phraseDominantSlotForInterval(regionIn, regionOut);
        if (dominant != null && dominant >= 0) return dominant;
        return phraseSlotIndexForSegment(track, segmentIndex);
    }

    /** フレーズスロット先頭 + ε（境界上配置を避け次スロット誤判定を防ぐ） */
    function phraseSlotPlacementSec(slotIndex) {
        const start = phraseSlotStartSec(slotIndex);
        if (start == null) return null;
        const eps = segmentBoundaryJoinEpsilonSec();
        return start + eps * 2;
    }

    /** 展開 counts 上で slot 先頭までの累積小節数（0 始まり） */
    function phraseSlotStartBarIndex(slotIndex, countsOpt) {
        const counts =
            countsOpt && countsOpt.length
                ? countsOpt
                : expandedPhraseGroupBarCountsSnapshot();
        const idx = slotIndex | 0;
        if (!counts.length || idx < 0 || idx >= counts.length) return null;
        let sum = 0;
        for (let i = 0; i < idx; i++) sum += counts[i] | 0;
        return sum;
    }

    function phraseSlotOverlapsGap(slotIndex, gap) {
        const ranges = phraseSlotRangesSnapshot();
        const r = ranges[slotIndex | 0];
        if (!gap || !r) return false;
        const eps = segmentBoundaryJoinEpsilonSec();
        return gap.endSec > r.startSec + eps && gap.startSec < r.endSec - eps;
    }

    function segmentRegionInWithinPhraseSlot(track, segmentIndex, slotIndex) {
        const ranges = phraseSlotRangesSnapshot();
        const r = ranges[slotIndex | 0];
        if (!r || !(segmentIndex >= 0)) return false;
        const eps = segmentBoundaryJoinEpsilonSec();
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        return regionIn >= r.startSec - eps && regionIn < r.endSec - eps;
    }

    /**
     * 同一 Phrase スロット内の部分無音↔リージョン。
     * 部分無音区間とリージョン In が重ならない（または gap.partial）場合に true。
     */
    function isSamePhraseSlotPartialSilentGapPlacement(track, gap, leaderIndex, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const gapSlotRaw =
            gap && Number.isFinite(gap.phraseIndex) && gap.phraseIndex >= 0
                ? gap.phraseIndex | 0
                : phraseSlotIndexForSilentGap(gap, track);
        const gapSlot = phraseSpecCycleSlotIndex(gapSlotRaw);
        const segSlot = phraseSpecCycleSlotForSegment(track, leaderIndex);
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

    /** 無音 gap 区間がカバーする Phrase 小節数（複数スロット跨ぎ・部分 gap 対応） */
    function estimateSilentGapBarSpan(gap) {
        if (!gap || !Number.isFinite(gap.startSec) || !Number.isFinite(gap.endSec)) return 0;
        const dur = gap.endSec - gap.startSec;
        if (!(dur > 0.00001)) return 0;
        const counts = expandedPhraseGroupBarCountsSnapshot();
        const ranges = phraseSlotRangesSnapshot();
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

        const idx = phraseSlotIndexAtRegionInSec(gap.startSec);
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
        const counts = expandedPhraseGroupBarCountsSnapshot();
        const contentBars = estimateRegionContentBarCountForSegment(track, leaderIndex);
        const result = {
            expandedEqualBarTimelineOnly: false,
            expandedSameSlotTimelineOnly: false,
            expandedUnequalBarTimelineOnly: false,
            expandedPhraseSwap: false,
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
                // 8↔16 等 — 展開 counts を入れ替えてから配置（Phrase 1,16,8…）
                result.expandedPhraseSwap = true;
            }
        }
        return result;
    }

    /** 無音↔リージョン入れ替えの Phrase スロット解決（spec 1 サイクル index） */
    function resolveSilentGapPhraseSwapSlots(track, gap, leaderIndex) {
        const gapSlotRaw =
            gap && Number.isFinite(gap.phraseIndex) && gap.phraseIndex >= 0
                ? gap.phraseIndex | 0
                : phraseSlotIndexForSilentGap(gap, track);
        const gapSlot = phraseSpecCycleSlotIndex(gapSlotRaw);
        const segExpandedRaw = phraseExpandedSlotForSilentGapSegment(track, leaderIndex);
        const segExpanded =
            segExpandedRaw != null && segExpandedRaw >= 0 ? segExpandedRaw | 0 : null;
        const segSlot = phraseSpecCycleSlotIndex(segExpanded);
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
            isSamePhraseSlotPartialSilentGapPlacement(track, gap, leaderIndex, {
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
        const expandedPhraseSwap = expandedModes.expandedPhraseSwap;
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
            !phraseSlotOverlapsGap(gapSlot, gap)
        ) {
            notes.push('warn: gap interval vs gapSlot range mismatch');
        }
        if (
            segSlot != null &&
            segSlot >= 0 &&
            leaderIndex >= 0 &&
            !segmentRegionInWithinPhraseSlot(track, leaderIndex, segSlot)
        ) {
            notes.push(
                'warn: regionIn ' +
                    regionSwapDiagFmtSec(regionIn) +
                    ' outside segSlot phrase ' +
                    phraseSpecCycleSlotLabel(segSlot),
            );
        }

        regionSwapDiagLog('phrase/slots', {
            gapSlot: gapSlot != null ? phraseSpecCycleSlotLabel(gapSlot) : null,
            gapGridLabel: gapSlot != null ? phraseSpecCycleSlotGridLabel(gapSlot) : null,
            gapExpanded: gapExpanded != null ? gapExpanded + 1 : null,
            segSlot: segSlot != null ? phraseSpecCycleSlotLabel(segSlot) : null,
            segGridLabel: segSlot != null ? phraseSpecCycleSlotGridLabel(segSlot) : null,
            segExpanded: segExpanded != null ? segExpanded + 1 : null,
            contentBars: expandedModes.contentBars || null,
            gapBars: expandedModes.gapBars || null,
            phraseSpecSwap: gapSlot != null && segSlot != null && gapSlot !== segSlot,
            sameSlotPartialShrink,
            expandedEqualBarTimelineOnly,
            expandedSameSlotTimelineOnly,
            expandedUnequalBarTimelineOnly,
            expandedPhraseSwap,
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
                      : expandedPhraseSwap
                        ? 'expanded phrase bar-count swap + timeline placement'
                        : 'phrase bar-count swap + timeline placement',
        });

        return {
            gapSlot,
            segSlot,
            gapExpanded,
            segExpanded: segExpanded != null && segExpanded >= 0 ? segExpanded | 0 : null,
            expandedEqualBarTimelineOnly,
            expandedSameSlotTimelineOnly,
            expandedUnequalBarTimelineOnly,
            expandedPhraseSwap,
            sameSlotPartialShrink,
            gapBars: expandedModes.gapBars || 0,
            phraseSwap: gapSlot != null && segSlot != null && gapSlot !== segSlot,
            notes,
        };
    }

    /** timelineSlots cache の musical.phraseSlotIndex（regionIn 誤判定より優先） */
    function phraseMusicalSlotIndexFromPersistedTimelineSlots(track, segmentIndex) {
        const state = getPlaybackRegionsState(track);
        const persisted =
            state && Array.isArray(state.timelineSlots) ? state.timelineSlots : null;
        if (!persisted || !persisted.length) return null;
        const idx = segmentIndex | 0;
        for (let i = 0; i < persisted.length; i++) {
            const slot = persisted[i];
            if (!slot || slot.kind === 'silent' || !slot.segmentRefs) continue;
            for (let r = 0; r < slot.segmentRefs.length; r++) {
                const ref = slot.segmentRefs[r];
                if ((ref.segmentIndex | 0) !== idx) continue;
                if (slot.musical && slot.musical.phraseSlotIndex >= 0) {
                    return slot.musical.phraseSlotIndex | 0;
                }
            }
        }
        return null;
    }

    function phraseJoinSlotIndexForSegment(track, segmentIndex) {
        return phraseSpecCycleSlotForSegment(track, segmentIndex);
    }

    /** 同一 Phrase スロット内で境界結合された連続セグメント（セパレートされていない列） */
    function collectPhraseSlotJoinedSegmentIndices(track, segmentIndex) {
        if (!(segmentIndex >= 0)) return [];
        const segments = getTrackSegments(track);
        if (!segments.length) return [];
        const slot = phraseJoinSlotIndexForSegment(track, segmentIndex);
        let lo = segmentIndex;
        let hi = segmentIndex;
        while (lo > 0 && isSegmentBoundaryJoined(track, lo - 1)) {
            const leftSlot = phraseJoinSlotIndexForSegment(track, lo - 1);
            if (slot == null || leftSlot !== slot) break;
            lo--;
        }
        while (hi < segments.length - 1 && isSegmentBoundaryJoined(track, hi)) {
            const rightSlot = phraseJoinSlotIndexForSegment(track, hi + 1);
            if (slot == null || rightSlot !== slot) break;
            hi++;
        }
        const out = [];
        for (let i = lo; i <= hi; i++) out.push(i);
        return out;
    }

    /** 無音↔リージョン入れ替え対象 — 明示選択 1 件（regionGroupId のみ広げる。phrase 境界結合は広げない） */
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

    function phraseLayoutExpandedRangesSnapshot() {
        if (typeof window.musicalGridDrawSettings !== 'function') return [];
        const settings = window.musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return [];
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return [];
        const counts = expandedPhraseGroupBarCountsSnapshot();
        if (!counts.length) return [];
        if (typeof window.collectPhraseGroupRangesFromBarCounts === 'function') {
            return window.collectPhraseGroupRangesFromBarCounts(
                settings.meterSpec,
                master,
                counts,
            );
        }
        return [];
    }

    function collectTrackSourceStreamForPhraseLayout(track) {
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

    function phraseLayoutPlacementSecForRange(range) {
        if (!range || !Number.isFinite(range.startSec)) return null;
        const eps = segmentBoundaryJoinEpsilonSec();
        return range.startSec + eps * 2;
    }

    function phraseCompositionLayoutReady() {
        if (
            typeof window.getMusicalGridPhraseFillVisible === 'function' &&
            !window.getMusicalGridPhraseFillVisible()
        ) {
            return false;
        }
        if (typeof window.musicalGridDrawSettings !== 'function') return false;
        const settings = window.musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return false;
        if (!settings.phraseSpec || !settings.phraseSpec.sizes.length) return false;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        return master > 0;
    }

    function commitPhraseLayoutSegments(track, nextSegments, opt) {
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

    /** Phrase 欄確定 — 展開スロットごとに 1 リージョンへ再配置 */
    function applyPhraseCompositionToTrackRegions(track, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!isExtraTrackRef(track)) return false;
        if (!phraseCompositionLayoutReady()) return false;
        const ranges = phraseLayoutExpandedRangesSnapshot();
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

        const stream = collectTrackSourceStreamForPhraseLayout(track);
        const defaultClip = getPrimaryClipIdForTrack(track);
        let cursor = { partIndex: 0, offsetSec: 0 };
        const nextSegments = [];
        const eps = segmentBoundaryJoinEpsilonSec();

        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (!r || !Number.isFinite(r.startSec) || !Number.isFinite(r.endSec)) continue;
            const slotDur = r.endSec - r.startSec;
            if (!(slotDur > eps)) continue;
            const placementSec = phraseLayoutPlacementSecForRange(r);
            if (placementSec == null) continue;

            const slice = takeSourceSliceFromStream(
                stream,
                cursor,
                slotDur,
                defaultClip,
            );
            cursor = slice.cursor;
            if (!(slice.takenSec >= PLAYBACK_REGION_MIN_SEC)) continue;

            const seg = {
                id: newRegionId(),
                clipId: slice.clipId,
                sourceInSec: slice.sourceInSec,
                sourceOutSec: slice.sourceOutSec,
                timelineStartSec: placementSec,
                regionTimelineInSec: placementSec,
            };
            const meta = i < metaBySegmentIndex.length ? metaBySegmentIndex[i] : null;
            if (meta) {
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
            delete state.regionLeadPadSec;
        }

        if (!commitPhraseLayoutSegments(track, nextSegments, o)) {
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
                    ': regions laid out to Phrase (' +
                    nextSegments.length +
                    ' region(s))',
            );
        }
        return true;
    }

    function applyPhraseCompositionToAllExtraTrackRegions(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (
            !o.preservePhraseBarCountsOverride &&
            typeof window.clearPhraseGroupBarCountsOverride === 'function'
        ) {
            window.clearPhraseGroupBarCountsOverride();
        }
        if (!phraseCompositionLayoutReady()) return 0;
        if (!o.skipUndo && !regionUndoPaused) {
            requestRegionUndoCapture();
        }
        const n = getExtraTrackCount();
        let rebuilt = 0;
        for (let slot = 0; slot < n; slot++) {
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
                applyPhraseCompositionToTrackRegions(track, {
                    silent: true,
                    skipUndo: true,
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
                flashSeekHint('Phrase', rebuilt + ' Ex track(s) realigned', 'notice');
            }
        }
        return rebuilt;
    }
    /** musical-grid 実装を core 読込時に固定（global 関数名衝突で再帰しないよう） */
    const _musicalGridExpandedPhraseGroupBarCountsFn =
        typeof window.getExpandedPhraseGroupBarCountsSnapshot === 'function'
            ? window.getExpandedPhraseGroupBarCountsSnapshot
            : null;

    /** 展開済み Phrase グループ小節数列 */
    function expandedPhraseGroupBarCountsSnapshot() {
        if (!_musicalGridExpandedPhraseGroupBarCountsFn) {
            regionSwapDiagLog('phrase/counts', { error: 'API missing' });
            return [];
        }
        try {
            return _musicalGridExpandedPhraseGroupBarCountsFn();
        } catch (err) {
            regionSwapDiagLog('phrase/counts', {
                error: 'snapshot threw',
                message: err && err.message ? err.message : String(err),
            });
            return [];
        }
    }

    function phraseSlotRegionInTargetSecDiag(track, slotIndex, segmentIndex, segmentsOpt) {
        const slotStart = phraseSlotPlacementSec(slotIndex);
        if (slotStart == null) {
            return { slotStart: null, targetIn: null, clamped: false, reason: 'slot start unresolved' };
        }
        const segments = segmentsOpt || getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) {
            return { slotStart, targetIn: slotStart, clamped: false, reason: 'no segment' };
        }
        const eps = segmentBoundaryJoinEpsilonSec();
        const segDur = segmentCopySourceDurSec(seg);
        let maxIn = Infinity;
        let limitReason = null;
        const ranges = phraseSlotRangesSnapshot();
        const slotRange = ranges[slotIndex | 0];
        if (slotRange && Number.isFinite(slotRange.endSec)) {
            const slotEndLimit = slotRange.endSec - eps - segDur;
            if (slotEndLimit < maxIn) {
                maxIn = slotEndLimit;
                limitReason = 'slot end';
            }
        }
        const nextIn = nextSegmentRegionInAfter(
            track,
            segmentIndex,
            slotStart,
            segmentsOpt,
        );
        if (nextIn != null) {
            const nextLimit = nextIn - eps - segDur;
            if (nextLimit < maxIn) {
                maxIn = nextLimit;
                limitReason = 'next region in ' + regionSwapDiagFmtSec(nextIn);
            }
        }
        if (!Number.isFinite(maxIn)) {
            return { slotStart, targetIn: slotStart, clamped: false, limitReason: null };
        }
        if (slotStart > maxIn + eps * 0.5) {
            return {
                slotStart,
                targetIn: maxIn,
                clamped: true,
                limitReason,
                maxIn: regionSwapDiagFmtSec(maxIn),
                segDur: regionSwapDiagFmtSec(segDur),
            };
        }
        return { slotStart, targetIn: slotStart, clamped: false, limitReason: null };
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
     * フレーズスロット先頭配置 — 長さが slot 終端や次リージョンと重なるときは手前へ寄せる（クロスフェード防止）。
     */
    function phraseSlotRegionInTargetSec(track, slotIndex, segmentIndex, segmentsOpt) {
        const slotStart = phraseSlotPlacementSec(slotIndex);
        if (slotStart == null) return null;
        const segments = segmentsOpt || getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return slotStart;
        const eps = segmentBoundaryJoinEpsilonSec();
        const segDur = segmentCopySourceDurSec(seg);
        let maxIn = Infinity;
        const ranges = phraseSlotRangesSnapshot();
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

    /** 移動済みセグメントコピー — 次リージョン／slot 終端との誤差重なりを解消 */
    function clampMovedSegmentCopiesToAvoidOverlap(track, segments, movedIndices, gapSlotIdx) {
        const eps = segmentBoundaryJoinEpsilonSec();
        const t0 = getTrackTimelineStartSec(track);
        for (let m = 0; m < movedIndices.length; m++) {
            const mi = movedIndices[m] | 0;
            const seg = segments[mi];
            if (!seg) continue;
            const targetIn = phraseSlotRegionInTargetSec(track, gapSlotIdx, mi, segments);
            if (targetIn == null) continue;
            const curIn = segmentCopyRegionIn(seg);
            if (Math.abs(curIn - targetIn) <= eps * 0.5) continue;
            regionSwapDiagLog('swap/overlap-clamp', {
                region: mi + 1,
                before: regionSwapDiagFmtSec(curIn),
                after: regionSwapDiagFmtSec(targetIn),
                nextIn: regionSwapDiagFmtSec(
                    nextSegmentRegionInAfter(track, mi, curIn, segments),
                ),
            });
            applySegmentToSilentGapPosition(track, mi, seg, targetIn, t0);
        }
    }

    /** タイムラインのみ入れ替え — leader の Region In を targetSec へ再スナップ（従属は相対位置維持） */
    function snapSilentGapSwapSegmentCopiesToTarget(track, segments, indices, targetSec) {
        if (targetSec == null || !Number.isFinite(targetSec) || !indices || !indices.length) {
            return;
        }
        const eps = segmentBoundaryJoinEpsilonSec();
        const t0 = getTrackTimelineStartSec(track);
        const leader = indices[0] | 0;
        const seg = segments[leader];
        if (!seg) return;
        const curIn = segmentCopyRegionIn(seg);
        if (Math.abs(curIn - targetSec) <= eps * 0.5) return;
        regionSwapDiagLog('swap/silent-gap/snap-target', {
            region: leader + 1,
            from: regionSwapDiagFmtSec(curIn),
            to: regionSwapDiagFmtSec(targetSec),
        });
        applySegmentToSilentGapPosition(track, leader, seg, targetSec, t0);
    }

    /**
     * 無音↔リージョン入れ替え計画。
     * ① Phrase 小節数を gapSlot↔segSlot で交換した後は afterPhraseSwap で range 再取得。
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
                ? resolveSilentGapPhraseSwapSlots(track, gap, leaderIndex)
                : { gapSlot: null, segSlot: null, phraseSwap: false };
        const eps = segmentBoundaryJoinEpsilonSec();
        const gapSlotIdx =
            gap && Number.isFinite(gap.phraseIndex) && gap.phraseIndex >= 0
                ? gap.phraseIndex | 0
                : slots.gapSlot;
        let targetSec = null;
        const timelineOnlyTarget =
            !!slots.expandedEqualBarTimelineOnly ||
            !!slots.expandedSameSlotTimelineOnly ||
            !!slots.expandedUnequalBarTimelineOnly;
        if (o.afterPhraseSwap && gapSlotIdx != null && gapSlotIdx >= 0 && leaderIndex >= 0) {
            targetSec = phraseSlotRegionInTargetSec(track, gapSlotIdx, leaderIndex);
        } else if (o.afterPhraseSwap && gapSlotIdx != null && gapSlotIdx >= 0) {
            targetSec = phraseSlotPlacementSec(gapSlotIdx);
        } else if (timelineOnlyTarget && gap && Number.isFinite(gap.startSec)) {
            targetSec = gap.startSec + eps;
        } else if (gap && Number.isFinite(gap.startSec)) {
            targetSec = gap.startSec + eps;
        }
        if (targetSec == null && gapSlotIdx != null && gapSlotIdx >= 0) {
            targetSec = phraseSlotPlacementSec(gapSlotIdx);
        }
        if (targetSec == null) targetSec = silentGapMoveTargetSec(gap, track);
        return {
            segRegionIn,
            targetSec,
            delta: targetSec - segRegionIn,
            phraseGap: slots.gapSlot,
            phraseSeg: slots.segSlot,
            gapExpanded: slots.gapExpanded,
            segExpanded: slots.segExpanded,
            expandedEqualBarTimelineOnly: !!slots.expandedEqualBarTimelineOnly,
            expandedSameSlotTimelineOnly: !!slots.expandedSameSlotTimelineOnly,
            expandedUnequalBarTimelineOnly: !!slots.expandedUnequalBarTimelineOnly,
            expandedPhraseSwap: !!slots.expandedPhraseSwap,
            sameSlotPartialShrink: !!slots.sameSlotPartialShrink,
            gapBars: slots.gapBars || 0,
            phraseSwapNeeded: !!(
                slots.gapSlot != null && slots.segSlot != null && slots.gapSlot !== slots.segSlot
            ),
            leaderIndex,
            segmentIndices: sorted,
        };
    }

    /** Region Out 直前が属する Phrase スロット */
    function phraseSlotIndexAtRegionOutSec(transportSec) {
        if (!Number.isFinite(transportSec)) return null;
        const ranges = phraseSlotRangesSnapshot();
        if (!ranges.length) return phraseSlotIndexAtTransportSec(transportSec);
        const eps = segmentBoundaryJoinEpsilonSec();
        const s = Number(transportSec) - eps;
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (s >= r.startSec - eps && s < r.endSec - eps) return i;
        }
        return phraseSlotIndexAtTransportSec(s);
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
        const counts = expandedPhraseGroupBarCountsSnapshot();
        const ranges = phraseSlotRangesSnapshot();
        if (!counts.length || !ranges.length || !(sourceDurSec > 0)) return 1;
        const idx = phraseSlotIndexAtRegionInSec(regionInSec);
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
            const outIdx = phraseSlotIndexAtRegionOutSec(regionOut);
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

    window.logSessionRestoreRegionPhraseSnapshot = logSessionRestoreRegionPhraseSnapshot;
    window.applyPhraseCompositionToTrackRegions = applyPhraseCompositionToTrackRegions;
    window.applyPhraseCompositionToAllExtraTrackRegions =
        applyPhraseCompositionToAllExtraTrackRegions;
    window.phraseSlotIndexAtRegionInSec = phraseSlotIndexAtRegionInSec;
    window.phraseSlotIndexForSilentGap = phraseSlotIndexForSilentGap;
    window.phraseSlotStartSec = phraseSlotStartSec;
    window.collectPhraseSlotJoinedSegmentIndices = collectPhraseSlotJoinedSegmentIndices;
    window.silentGapSegmentSwapPlan = silentGapSegmentSwapPlan;
    window.resolveSilentGapSwapSegmentIndices = resolveSilentGapSwapSegmentIndices;
    window.estimateRegionContentBarCountForSegment = estimateRegionContentBarCountForSegment;
    window.isSamePhraseSlotPartialSilentGapPlacement = isSamePhraseSlotPartialSilentGapPlacement;
