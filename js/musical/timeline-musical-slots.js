/**
 * timeline-musical-slots.js — SwapUnit / MusicalSlot モデル（Phrase モードの根本レイアウト）
 *
 * 診断ログ: ログパネルで [MusicalSlot] フィルタ（調査中は既定 ON。本番は false）。
 * 診断ログはログ枠の Debug Log が ON のときのみ（[MusicalSlot] / regionSwapDiagLog 経由）
 * 手動ダンプ: window.musicalSlotDiagDumpOriginBindings(0) / musicalSlotDiagDumpTrack(0)
 */
(function timelineMusicalSlotsModule() {
    const LOG_PREFIX = '[MusicalSlot]';
    let slotsReadCacheSlot = -1;
    let slotsReadCacheEpoch = 0;
    let slotsReadCacheStoredEpoch = -1;
    let slotsReadCacheSlots = null;
    let slotsReadCachePreserve = true;
    /** getTrackTimelineSlots 再入防止（overlay ラベル解決中の build 再帰で stack overflow しない） */
    let timelineSlotsBuildDepth = 0;
    let timelineSlotsBuildScratch = null;

    function invalidateTrackTimelineSlotsReadCache() {
        slotsReadCacheEpoch++;
        slotsReadCacheStoredEpoch = -1;
        slotsReadCacheSlots = null;
        slotsReadCacheSlot = -1;
    }

    function storeTrackTimelineSlotsReadCache(track, slots, preserveStored) {
        const ex =
            track && track.type === 'extra' && Number.isFinite(track.slot)
                ? track.slot | 0
                : -1;
        if (ex < 0 || !slots) return;
        slotsReadCacheSlot = ex;
        slotsReadCacheStoredEpoch = slotsReadCacheEpoch;
        slotsReadCacheSlots = slots;
        slotsReadCachePreserve = preserveStored !== false;
    }

    function isTimelineSlotRegionSwapEnabled() {
        return window.useTimelineSlotRegionSwap !== false;
    }



    function swapUnitIdentityKey(slot) {
        if (!slot) return '?';
        if (slot.kind === 'silent') {
            return 'silent:' + (slot.silentGapIndex | 0);
        }
        const refs = slot.segmentRefs;
        if (refs && refs.length) {
            const leaders = refs
                .map((r) => r.segmentIndex | 0)
                .sort((a, b) => a - b)
                .join(',');
            return 'audio:' + leaders;
        }
        return slot.id || '?';
    }


    function segmentLeaderPersistedIdentity(segmentIndex) {
        return 'audio:' + (segmentIndex | 0);
    }

    function persistedMusicalBindingForSegmentLeader(track, segmentIndex) {
        const idx = segmentIndex | 0;
        const leaderKey = segmentLeaderPersistedIdentity(idx);
        const state =
            typeof window.getPlaybackRegionsState === 'function'
                ? window.getPlaybackRegionsState(track)
                : null;
        const persisted =
            state && Array.isArray(state.timelineSlots) ? state.timelineSlots : null;
        if (!persisted || !persisted.length) return null;

        for (let i = 0; i < persisted.length; i++) {
            const p = persisted[i];
            if (!p || !p.musical) continue;
            if (swapUnitIdentityKey(p) === leaderKey) {
                return cloneMusicalBinding(p.musical);
            }
        }
        for (let i = 0; i < persisted.length; i++) {
            const p = persisted[i];
            if (!p || !p.segmentRefs || !p.musical) continue;
            for (let r = 0; r < p.segmentRefs.length; r++) {
                if ((p.segmentRefs[r].segmentIndex | 0) !== idx) continue;
                const m = cloneMusicalBinding(p.musical);
                if (p.segmentRefs.length > 1 || p.kind === 'audio-group') {
                    if (m.phraseSlotIndex < 0) m.phraseSlotIndex = idx;
                }
                return m;
            }
        }
        return null;
    }

    /** 誤結合のみ分離 — 隣接セグメントが別 Phrase 枠にまたがる場合 */
    function splitIndicesIfCrossPhraseJoin(track, indices) {
        if (!indices || indices.length <= 1) return [indices];
        if (typeof window.phraseSpecCycleSlotForSegment !== 'function') return [indices];
        let slot = null;
        for (let k = 0; k < indices.length; k++) {
            const si = indices[k] | 0;
            const cur = window.phraseSpecCycleSlotForSegment(track, si);
            if (slot == null) {
                slot = cur;
            } else if (cur !== slot) {
                return indices.map((i) => [i | 0]);
            }
        }
        return [indices];
    }

    function persistedTimelineSlotsAreUsable(slots) {
        if (!Array.isArray(slots) || !slots.length) return false;
        let audio = 0;
        let valid = 0;
        for (let i = 0; i < slots.length; i++) {
            const s = slots[i];
            if (!s || s.kind === 'silent' || !s.musical) continue;
            audio++;
            const m = s.musical;
            if ((m.phraseBarCount | 0) > 0) {
                valid++;
            }
        }
        return audio > 0 && valid >= Math.max(1, Math.ceil(audio * 0.75));
    }

    function resolvePreserveStoredMusical(track, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.preserveStored === false) return false;
        if (typeof window.getPlaybackRegionsState !== 'function') {
            return o.preserveStored === true;
        }
        const state = window.getPlaybackRegionsState(track);
        const persisted =
            state && Array.isArray(state.timelineSlots) ? state.timelineSlots : null;
        return persistedTimelineSlotsAreUsable(persisted);
    }

    /** persisted timelineSlots の musical / id を entity identity でマージ */
    function mergePersistedTimelineSlotsMusical(track, units) {
        const state =
            typeof window.getPlaybackRegionsState === 'function'
                ? window.getPlaybackRegionsState(track)
                : null;
        const persisted =
            state && Array.isArray(state.timelineSlots) ? state.timelineSlots : null;
        if (!persisted || !persisted.length || !units || !units.length) return;

        const byIdentity = new Map();
        const byLeader = new Map();
        for (let i = 0; i < persisted.length; i++) {
            const p = persisted[i];
            if (!p) continue;
            const key = swapUnitIdentityKey(p);
            if (!byIdentity.has(key)) byIdentity.set(key, p);
            const refs = p.segmentRefs;
            if (refs && refs.length) {
                for (let r = 0; r < refs.length; r++) {
                    const leader = refs[r].segmentIndex | 0;
                    const leaderKey = segmentLeaderPersistedIdentity(leader);
                    if (!byLeader.has(leaderKey)) byLeader.set(leaderKey, p);
                }
            }
        }

        window.musicalSlotDiagLogPersistCacheMerge(track, units, persisted, true);

        for (let i = 0; i < units.length; i++) {
            const built = units[i];
            const builtKey = swapUnitIdentityKey(built);
            let p = byIdentity.get(builtKey);
            if (!p && built.segmentRefs && built.segmentRefs.length === 1) {
                const leader = built.segmentRefs[0].segmentIndex | 0;
                p = byLeader.get(segmentLeaderPersistedIdentity(leader));
            }
            if (built.segmentRefs && built.segmentRefs.length > 1) {
                if (!p || swapUnitIdentityKey(p) !== builtKey) {
                    continue;
                }
            }
            if (!p) continue;
            if (p.id) built.id = p.id;
            if (built.segmentRefs && built.segmentRefs.length === 1) {
                const repaired = persistedMusicalBindingForSegmentLeader(
                    track,
                    built.segmentRefs[0].segmentIndex | 0,
                );
                if (repaired) {
                    built.musical = repaired;
                    continue;
                }
            }
            if (p.musical) built.musical = cloneMusicalBinding(p.musical);
        }
    }


    function newTimelineSlotId() {
        return (
            'tslot-' +
            Date.now().toString(36) +
            '-' +
            Math.random().toString(36).slice(2, 8)
        );
    }

    function cloneMusicalBinding(m) {
        if (!m || typeof m !== 'object') return null;
        return {
            contentBarCount: m.contentBarCount | 0,
            phraseBarCount: m.phraseBarCount | 0,
            meterBarStart: m.meterBarStart | 0,
            phraseSlotIndex: m.phraseSlotIndex | 0,
        };
    }

    function cloneTimelineSlot(slot) {
        if (!slot) return null;
        return {
            id: slot.id,
            kind: slot.kind,
            segmentRefs: (slot.segmentRefs || []).map((r) => ({
                slot: r.slot | 0,
                segmentIndex: r.segmentIndex | 0,
            })),
            silentGapIndex: slot.silentGapIndex | 0,
            regionGroupId: slot.regionGroupId || undefined,
            timelineStartSec: slot.timelineStartSec,
            timelineEndSec: slot.timelineEndSec,
            musical: cloneMusicalBinding(slot.musical),
        };
    }

    function trackRef(slot) {
        return { type: 'extra', slot: slot | 0 };
    }

    function segmentBoundaryEps() {
        if (typeof window.segmentBoundaryJoinEpsilonSec === 'function') {
            return window.segmentBoundaryJoinEpsilonSec();
        }
        return 0.002;
    }

    function getMeterSettings() {
        if (typeof window.musicalGridDrawSettings === 'function') {
            return window.musicalGridDrawSettings();
        }
        return null;
    }

    function masterDurationSec() {
        return typeof getMasterTransportDurationSec === 'function'
            ? getMasterTransportDurationSec()
            : 0;
    }

    function phraseRangesFromCounts(counts) {
        const settings = getMeterSettings();
        const master = masterDurationSec();
        if (
            !settings ||
            !settings.meterSpec ||
            !counts ||
            !counts.length ||
            !(master > 0) ||
            typeof window.collectPhraseGroupRangesFromBarCounts !== 'function'
        ) {
            return [];
        }
        return window.collectPhraseGroupRangesFromBarCounts(
            settings.meterSpec,
            master,
            counts,
        );
    }

    function slotStartSecFromCounts(counts, slotIndex) {
        if (typeof window.previewPhraseSlotStartSecFromCounts === 'function') {
            const s = window.previewPhraseSlotStartSecFromCounts(counts, slotIndex);
            if (s != null) return s + segmentBoundaryEps() * 2;
        }
        const ranges = phraseRangesFromCounts(counts);
        const r = ranges[slotIndex | 0];
        return r && Number.isFinite(r.startSec) ? r.startSec : null;
    }

    /** 非対称入れ替え後の counts（例: 8↔16 → slot2=16, slot3=16, slot4=8） */
    function computeNextCountsForAsymmetricSlotSwap(counts, idxShort, shortBar, longBar) {
        const next = counts.slice();
        const i = idxShort | 0;
        const sBar = shortBar | 0;
        const lBar = longBar | 0;
        if (!(sBar > 0) || !(lBar > 0) || sBar === lBar) return next;
        next[i] = lBar;
        if (i + 1 < next.length) {
            next[i + 1] = lBar;
        } else {
            next.push(lBar);
        }
        const shortDest = i + 2;
        if (shortDest < next.length) {
            next[shortDest] = sBar;
        } else {
            next.push(sBar);
        }
        return next;
    }

    function computeNextCountsForSlotPairSwap(counts, idxA, idxB, barA, barB) {
        if (!counts || !counts.length) return [];
        const a = idxA | 0;
        const b = idxB | 0;
        const ba = barA | 0;
        const bb = barB | 0;
        if (ba === bb) {
            const next = counts.slice();
            const tmp = next[a];
            next[a] = next[b];
            next[b] = tmp;
            return next;
        }
        const idxShort = ba < bb ? a : b;
        const shortBar = Math.min(ba, bb);
        const longBar = Math.max(ba, bb);
        return computeNextCountsForAsymmetricSlotSwap(counts, idxShort, shortBar, longBar);
    }

    /** SwapUnit の入れ替え用小節数（無音=phraseBarCount、音源=contentBarCount） */
    function resolveSwapUnitBarCount(slot, countsOpt) {
        if (!slot || !slot.musical) return 0;
        const m = slot.musical;
        if (slot.kind === 'silent') {
            const phraseBars = m.phraseBarCount | 0;
            if (phraseBars > 0) return phraseBars;
            const idx = m.phraseSlotIndex | 0;
            const counts =
                countsOpt && countsOpt.length
                    ? countsOpt
                    : typeof window.getExpandedPhraseGroupBarCountsSnapshot === 'function'
                      ? window.getExpandedPhraseGroupBarCountsSnapshot()
                      : [];
            if (idx >= 0 && idx < counts.length) return counts[idx] | 0;
            return 0;
        }
        const content = m.contentBarCount | 0;
        if (content > 0) return content;
        return m.phraseBarCount | 0;
    }

    function getSilentGapForSlot(track, slot) {
        if (!slot || slot.kind !== 'silent') return null;
        if (typeof window.collectTrackSilentGaps !== 'function') return null;
        const gaps = window.collectTrackSilentGaps(track);
        const idx = slot.silentGapIndex | 0;
        return idx >= 0 && idx < gaps.length ? gaps[idx] : null;
    }

    /** 入れ替え後の phraseSlotIndex（A=先選択側の SwapUnit） */
    function assignPairSwapDestinations(phraseIdxA, phraseIdxB, barA, barB) {
        const ba = barA | 0;
        const bb = barB | 0;
        if (ba === bb) {
            return { destA: phraseIdxB | 0, destB: phraseIdxA | 0 };
        }
        const idxShort = ba <= bb ? phraseIdxA | 0 : phraseIdxB | 0;
        const destLong = idxShort;
        const destShort = idxShort + 2;
        if (ba <= bb) {
            return { destA: destShort, destB: destLong };
        }
        return { destA: destLong, destB: destShort };
    }

    /**
     * 同一 Phrase スロット内の部分無音↔リージョン
     * — 縮小（slotBars > contentBars）またはタイムライン移動のみ
     */
    function tryResolveSilentAudioPartialPlan(track, silentSlot, audioSlot, counts) {
        const gap = getSilentGapForSlot(track, silentSlot);
        if (!gap || !audioSlot.segmentRefs || !audioSlot.segmentRefs.length) return null;
        const phraseIdx = silentSlot.musical.phraseSlotIndex | 0;
        const audioPhraseIdx = audioSlot.musical.phraseSlotIndex | 0;
        if (phraseIdx !== audioPhraseIdx || phraseIdx < 0 || phraseIdx >= counts.length) {
            return null;
        }
        const leader = audioSlot.segmentRefs[0].segmentIndex | 0;
        const placementFn = window.isSamePhraseSlotPartialSilentGapPlacement;
        if (typeof placementFn !== 'function' || !placementFn(track, gap, leader)) {
            return null;
        }
        const eps = segmentBoundaryEps();
        const targetSec = Number.isFinite(gap.startSec) ? gap.startSec + eps * 2 : null;
        if (targetSec == null) return null;
        const barAudio = resolveSwapUnitBarCount(audioSlot);
        const slotBars = counts[phraseIdx] | 0;
        if (slotBars > barAudio && barAudio > 0) {
            const next = counts.slice();
            next[phraseIdx] = barAudio;
            return {
                mode: 'silent-partial-shrink',
                nextCounts: next,
                audioDestPhraseIdx: phraseIdx,
                silentDestPhraseIdx: phraseIdx,
                audioTargetSec: targetSec,
            };
        }
        return {
            mode: 'silent-timeline-only',
            nextCounts: counts.slice(),
            audioDestPhraseIdx: phraseIdx,
            silentDestPhraseIdx: phraseIdx,
            audioTargetSec: targetSec,
        };
    }

    /**
     * counts 更新後 — 各 SwapUnit の timeline を phraseSlotIndex / 無音 gap から再配置。
     * startOverrides: { [slot列index]: timelineStartSec }（部分無音などの例外）
     */
    function refreshSlotTimelineBoundsFromPhraseCounts(track, slots, counts, startOverrides) {
        const ranges = phraseRangesFromCounts(counts);
        const gaps =
            typeof window.collectTrackSilentGaps === 'function'
                ? window.collectTrackSilentGaps(track)
                : [];
        const o = startOverrides && typeof startOverrides === 'object' ? startOverrides : {};

        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            const idx =
                slot.musical && slot.musical.phraseSlotIndex >= 0
                    ? slot.musical.phraseSlotIndex | 0
                    : -1;

            if (o[i] != null && Number.isFinite(o[i])) {
                slot.timelineStartSec = o[i];
                if (idx >= 0 && ranges[idx]) {
                    slot.timelineEndSec = ranges[idx].endSec;
                }
                continue;
            }

            if (slot.kind === 'silent') {
                const g = gaps[slot.silentGapIndex | 0];
                if (g && Number.isFinite(g.startSec) && Number.isFinite(g.endSec)) {
                    slot.timelineStartSec = g.startSec;
                    slot.timelineEndSec = g.endSec;
                } else if (idx >= 0 && ranges[idx]) {
                    slot.timelineStartSec = ranges[idx].startSec;
                    slot.timelineEndSec = ranges[idx].endSec;
                }
                continue;
            }

            if (idx >= 0 && ranges[idx]) {
                slot.timelineStartSec = ranges[idx].startSec;
                slot.timelineEndSec = ranges[idx].endSec;
            }
        }
        return slots;
    }

    function phraseSnapTargetForSlot(track, slot, segments) {
        if (!slot.musical || slot.musical.phraseSlotIndex < 0) return null;
        const phraseIdx = slot.musical.phraseSlotIndex | 0;
        const leader = slot.segmentRefs[0].segmentIndex | 0;
        if (typeof window.phraseSlotRegionInTargetSec === 'function') {
            return window.phraseSlotRegionInTargetSec(track, phraseIdx, leader, segments);
        }
        if (typeof window.phraseSlotPlacementSec === 'function') {
            return window.phraseSlotPlacementSec(phraseIdx);
        }
        const counts =
            typeof window.getExpandedPhraseGroupBarCountsSnapshot === 'function'
                ? window.getExpandedPhraseGroupBarCountsSnapshot()
                : [];
        return slotStartSecFromCounts(counts, phraseIdx);
    }

    /** Phase 4 — フレーズスロット先頭への sub-frame 端数 snap */
    function snapAudioSlotsToPhraseTargets(track, slots, segments, t0) {
        const eps = segmentBoundaryEps();
        const maxSnapDrift = eps * 8;
        let snapped = 0;
        const details = [];

        if (
            typeof window.getMusicalGridPhraseFillVisible !== 'function' ||
            !window.getMusicalGridPhraseFillVisible() ||
            typeof window.repositionRegionSwapUnitToTimelineSec !== 'function' ||
            !slots ||
            !segments
        ) {
            return { snapped, details };
        }

        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (slot.kind === 'silent' || !slot.segmentRefs || !slot.segmentRefs.length) continue;
            const target = phraseSnapTargetForSlot(track, slot, segments);
            if (target == null || !Number.isFinite(target)) continue;

            const leader = slot.segmentRefs[0].segmentIndex | 0;
            const seg = segments[leader];
            if (!seg) continue;
            const curIn = segmentCopyRegionIn(seg);
            const drift = curIn - target;
            if (Math.abs(drift) <= eps * 0.5 || Math.abs(drift) > maxSnapDrift) continue;

            const indices = slot.segmentRefs.map((r) => r.segmentIndex | 0);
            window.repositionRegionSwapUnitToTimelineSec(track, segments, indices, target, t0);
            snapped++;
            details.push({
                unit: i + 1,
                phrase: (slot.musical.phraseSlotIndex | 0) + 1,
                from: window.musicalSlotDiagFmtSec(curIn),
                to: window.musicalSlotDiagFmtSec(target),
                delta: window.musicalSlotDiagFmtSec(drift),
            });
        }
        return { snapped, details };
    }

    /** Phase 4 — 隣接 SwapUnit 間の微小隙間を短クロスフェード用の重なりへ */
    function applyShortCrossfadeAtUnitBoundaries(track, slots, segments, t0) {
        const eps = segmentBoundaryEps();
        const maxMicro = eps * 8;
        const minXf =
            typeof window.MIN_CROSSFADE_OVERLAP_SEC === 'number'
                ? window.MIN_CROSSFADE_OVERLAP_SEC
                : 0.005;
        let applied = 0;
        const details = [];

        if (
            !slots ||
            !segments ||
            typeof window.repositionRegionSwapUnitToTimelineSec !== 'function'
        ) {
            return { applied, details };
        }

        const audioSlots = slots
            .filter((s) => s.kind !== 'silent' && s.segmentRefs && s.segmentRefs.length)
            .slice()
            .sort((a, b) => {
                const aIn = segmentCopyRegionIn(
                    segments[a.segmentRefs[0].segmentIndex | 0],
                );
                const bIn = segmentCopyRegionIn(
                    segments[b.segmentRefs[0].segmentIndex | 0],
                );
                return aIn - bIn;
            });

        for (let i = 1; i < audioSlots.length; i++) {
            const prev = audioSlots[i - 1];
            const cur = audioSlots[i];
            const prevPhrase =
                prev.musical && prev.musical.phraseSlotIndex >= 0
                    ? prev.musical.phraseSlotIndex | 0
                    : null;
            const curPhrase =
                cur.musical && cur.musical.phraseSlotIndex >= 0
                    ? cur.musical.phraseSlotIndex | 0
                    : null;
            if (prevPhrase != null && curPhrase != null && prevPhrase !== curPhrase) {
                continue;
            }
            const prevTail = prev.segmentRefs[prev.segmentRefs.length - 1].segmentIndex | 0;
            const curLeader = cur.segmentRefs[0].segmentIndex | 0;
            const prevOut = segmentCopyRegionOut(segments[prevTail]);
            const curIn = segmentCopyRegionIn(segments[curLeader]);
            const gap = curIn - prevOut;

            if (gap > eps * 0.5 && gap <= maxMicro) {
                const overlap = Math.min(minXf, gap * 0.5 + minXf);
                const targetIn = prevOut - overlap;
                const indices = cur.segmentRefs.map((r) => r.segmentIndex | 0);
                window.repositionRegionSwapUnitToTimelineSec(
                    track,
                    segments,
                    indices,
                    targetIn,
                    t0,
                );
                applied++;
                details.push({
                    after: prevTail + 1,
                    region: curLeader + 1,
                    gap: window.musicalSlotDiagFmtSec(gap),
                    overlap: window.musicalSlotDiagFmtSec(overlap),
                    targetIn: window.musicalSlotDiagFmtSec(targetIn),
                });
            }
        }
        return { applied, details };
    }

    /** Phase 4 — 端数 snap・短クロスフェード・隣接整列（segment コピー列に適用） */
    function resolveLayoutCorrections(track, segments, t0, slots) {
        if (!segments || !segments.length) return false;

        const snapReport = snapAudioSlotsToPhraseTargets(track, slots, segments, t0);
        const xfReport = applyShortCrossfadeAtUnitBoundaries(track, slots, segments, t0);

        let overlapReport = { crossfade: false, overlaps: [] };
        if (typeof window.finalizeSegmentCopyTimelineLayout === 'function') {
            overlapReport = window.finalizeSegmentCopyTimelineLayout(
                track,
                segments,
                t0,
                'slot-layout',
            );
        }

        window.musicalSlotDiagLog('layout/corrections-applied', {
            ex: (track.slot | 0) + 1,
            snapped: snapReport.snapped,
            snapDetails: snapReport.details.length ? snapReport.details : undefined,
            shortCrossfade: xfReport.applied,
            crossfadeDetails: xfReport.details.length ? xfReport.details : undefined,
            overlapCount: overlapReport.overlaps ? overlapReport.overlaps.length : 0,
            crossfade: !!overlapReport.crossfade,
        });
        return (
            snapReport.snapped > 0 ||
            xfReport.applied > 0 ||
            !!overlapReport.crossfade
        );
    }

    function resolvePhraseIndexAtRegionInSec(startSec, ranges, eps) {
        if (!Number.isFinite(startSec)) return null;
        const s = Number(startSec);
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (s >= r.startSec - eps && s < r.endSec - eps) return i;
        }
        if (typeof window.resolvePhraseGroupIndexAtTransportSec === 'function') {
            const idx = window.resolvePhraseGroupIndexAtTransportSec(s);
            return idx != null && idx >= 0 ? idx | 0 : null;
        }
        return null;
    }

    function estimateContentBarCountForUnit(track, segmentRefs) {
        if (
            !segmentRefs ||
            !segmentRefs.length ||
            typeof window.estimateRegionContentBarCountForSegment !== 'function'
        ) {
            return 0;
        }
        const leader = segmentRefs[0].segmentIndex | 0;
        const bars = window.estimateRegionContentBarCountForSegment(track, leader);
        return bars > 0 ? bars | 0 : 0;
    }

    /**
     * segments + silent gaps → タイムライン順 SwapUnit 列
     */
    function buildTrackTimelineSlots(track) {
        if (
            !track ||
            track.type !== 'extra' ||
            typeof window.getTrackSegments !== 'function'
        ) {
            return [];
        }
        const diagEx =
            Number.isFinite(track.slot) ? { ex: (track.slot | 0) + 1 } : null;
        const diagRun =
            typeof window.regionRestoreDiagRunStep === 'function'
                ? window.regionRestoreDiagRunStep
                : function (_label, fn) {
                      return fn();
                  };

        return diagRun(
            'slots/build',
            () => {
                const segments = diagRun(
                    'slots/getTrackSegments',
                    () => window.getTrackSegments(track),
                    diagEx,
                );
                if (!segments.length) return [];

                const eps = segmentBoundaryEps();
                const consumed = new Set();
                const units = [];

                diagRun(
                    'slots/buildAudioUnits',
                    () => {
                        for (let i = 0; i < segments.length; i++) {
                            if (consumed.has(i)) continue;
                            const unitIndices =
                                typeof window.resolveRegionSwapUnitSegmentIndices === 'function'
                                    ? window.resolveRegionSwapUnitSegmentIndices(track, i)
                                    : [i];
                            const splitGroups = splitIndicesIfCrossPhraseJoin(track, unitIndices);
                            for (let g = 0; g < splitGroups.length; g++) {
                                const groupIndices = splitGroups[g];
                                for (let u = 0; u < groupIndices.length; u++) {
                                    consumed.add(groupIndices[u]);
                                }
                                const sorted = groupIndices.slice().sort((a, b) => {
                                    const aIn =
                                        typeof window.getSegmentRegionTimelineIn === 'function'
                                            ? window.getSegmentRegionTimelineIn(track, a)
                                            : 0;
                                    const bIn =
                                        typeof window.getSegmentRegionTimelineIn === 'function'
                                            ? window.getSegmentRegionTimelineIn(track, b)
                                            : 0;
                                    if (Math.abs(aIn - bIn) > 1e-9) return aIn - bIn;
                                    return a - b;
                                });
                                const leader = sorted[0];
                                const gid =
                                    typeof window.getSegmentRegionGroupId === 'function'
                                        ? window.getSegmentRegionGroupId(track, leader)
                                        : '';
                                const startSec =
                                    typeof window.getSegmentRegionTimelineIn === 'function'
                                        ? window.getSegmentRegionTimelineIn(track, leader)
                                        : 0;
                                const tail = sorted[sorted.length - 1];
                                const endSec =
                                    typeof window.getSegmentRegionTimelineOut === 'function'
                                        ? window.getSegmentRegionTimelineOut(track, tail)
                                        : startSec;
                                units.push({
                                    id: newTimelineSlotId(),
                                    kind:
                                        sorted.length > 1 || gid ? 'audio-group' : 'audio-single',
                                    segmentRefs: sorted.map((si) => ({
                                        slot: track.slot | 0,
                                        segmentIndex: si,
                                    })),
                                    silentGapIndex: -1,
                                    regionGroupId: gid || undefined,
                                    timelineStartSec: startSec,
                                    timelineEndSec: endSec,
                                    musical: null,
                                });
                            }
                        }
                    },
                    diagEx,
                );

                const gaps = diagRun(
                    'slots/collectSilentGaps',
                    () =>
                        typeof window.collectTrackSilentGaps === 'function'
                            ? window.collectTrackSilentGaps(track)
                            : [],
                    diagEx,
                );
                const firstSegIn =
                    segments.length &&
                    typeof window.getSegmentRegionTimelineIn === 'function'
                        ? window.getSegmentRegionTimelineIn(track, 0)
                        : 0;
                const minGapSec = eps * 4;
                for (let g = 0; g < gaps.length; g++) {
                    const gap = gaps[g];
                    const gapDur =
                        Number.isFinite(gap.endSec) && Number.isFinite(gap.startSec)
                            ? gap.endSec - gap.startSec
                            : 0;
                    if (gapDur < minGapSec) continue;
                    if (gap.endSec <= firstSegIn + eps) continue;
                    const gapMusical =
                        Number.isFinite(gap.phraseIndex) && gap.phraseIndex >= 0
                            ? {
                                  phraseSlotIndex: gap.phraseIndex | 0,
                                  phraseBarCount:
                                      Number.isFinite(gap.phraseBarCount) &&
                                      gap.phraseBarCount > 0
                                          ? gap.phraseBarCount | 0
                                          : 0,
                                  contentBarCount: 0,
                                  meterBarStart: 0,
                              }
                            : null;
                    units.push({
                        id: newTimelineSlotId(),
                        kind: 'silent',
                        segmentRefs: [],
                        silentGapIndex: g,
                        timelineStartSec: gap.startSec,
                        timelineEndSec: gap.endSec,
                        musical: gapMusical,
                    });
                }

                units.sort((a, b) => {
                    const d = (a.timelineStartSec || 0) - (b.timelineStartSec || 0);
                    if (Math.abs(d) > eps) return d;
                    if (a.kind === 'silent' && b.kind !== 'silent') return -1;
                    if (a.kind !== 'silent' && b.kind === 'silent') return 1;
                    return 0;
                });

                diagRun(
                    'slots/mergePersisted',
                    () => mergePersistedTimelineSlotsMusical(track, units),
                    diagEx,
                );

                return units;
            },
            diagEx,
        );
    }

    function inferMusicalBindingsForTrack(track, slots, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const counts =
            typeof window.getExpandedPhraseGroupBarCountsSnapshot === 'function'
                ? window.getExpandedPhraseGroupBarCountsSnapshot()
                : [];
        let ranges =
            typeof window.getPhraseGroupRangesSnapshot === 'function'
                ? window.getPhraseGroupRangesSnapshot()
                : [];
        if (!ranges.length && counts.length) {
            ranges = phraseRangesFromCounts(counts);
        }
        const eps = segmentBoundaryEps();

        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (o.preserveStored && slot.musical && slot.musical.phraseBarCount > 0) {
                continue;
            }
            const startSec = slot.timelineStartSec;
            let phraseIdx = resolvePhraseIndexAtRegionInSec(startSec, ranges, eps);
            if (
                phraseIdx == null &&
                slot.segmentRefs &&
                slot.segmentRefs.length &&
                slot.kind !== 'silent'
            ) {
                phraseIdx = slot.segmentRefs[0].segmentIndex | 0;
            } else if (phraseIdx == null) {
                phraseIdx = i;
            }
            if (
                slot.kind === 'silent' &&
                slot.musical &&
                Number.isFinite(slot.musical.phraseSlotIndex) &&
                slot.musical.phraseSlotIndex >= 0
            ) {
                phraseIdx = slot.musical.phraseSlotIndex | 0;
            }

            let meterBarStart = 0;
            for (let c = 0; c < phraseIdx && c < counts.length; c++) {
                meterBarStart += counts[c] | 0;
            }

            let contentBarCount = counts[phraseIdx | 0] | 0;
            if (slot.kind !== 'silent') {
                const est = estimateContentBarCountForUnit(track, slot.segmentRefs);
                if (est > 0) contentBarCount = est;
            }

            let phraseBarCount = counts[phraseIdx | 0] | 0;
            if (!(phraseBarCount > 0)) phraseBarCount = contentBarCount;
            if (
                slot.kind === 'silent' &&
                slot.musical &&
                Number.isFinite(slot.musical.phraseBarCount) &&
                slot.musical.phraseBarCount > 0
            ) {
                phraseBarCount = slot.musical.phraseBarCount | 0;
            }

            slot.musical = {
                contentBarCount,
                phraseBarCount,
                meterBarStart,
                phraseSlotIndex: phraseIdx | 0,
            };
        }
        return slots;
    }

    function cacheTrackTimelineSlots(track, slots) {
        if (typeof window.getPlaybackRegionsState !== 'function') return;
        const state = window.getPlaybackRegionsState(track);
        if (!state) return;
        state.timelineSlots = slots.map(cloneTimelineSlot);
        storeTrackTimelineSlotsReadCache(track, slots, true);
    }

    function timelineSlotsReentrantFallback(track) {
        const ex =
            track && track.type === 'extra' && Number.isFinite(track.slot)
                ? track.slot | 0
                : -1;
        if (
            ex >= 0 &&
            slotsReadCacheSlots &&
            slotsReadCacheSlot === ex
        ) {
            return slotsReadCacheSlots;
        }
        if (timelineSlotsBuildScratch && timelineSlotsBuildScratch.length) {
            return timelineSlotsBuildScratch;
        }
        if (typeof window.getPlaybackRegionsState === 'function') {
            const state = window.getPlaybackRegionsState(track);
            const persisted =
                state && Array.isArray(state.timelineSlots) ? state.timelineSlots : null;
            if (persisted && persisted.length) {
                return persisted.map(cloneTimelineSlot);
            }
        }
        return [];
    }

    function getTrackTimelineSlots(track, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const ex =
            track && track.type === 'extra' && Number.isFinite(track.slot)
                ? track.slot | 0
                : -1;
        const preserveStored = resolvePreserveStoredMusical(track, o);
        if (
            o.writeCache === false &&
            ex >= 0 &&
            slotsReadCacheSlots &&
            slotsReadCacheSlot === ex &&
            slotsReadCacheStoredEpoch === slotsReadCacheEpoch &&
            slotsReadCachePreserve === preserveStored
        ) {
            return slotsReadCacheSlots;
        }
        if (timelineSlotsBuildDepth > 0) {
            return timelineSlotsReentrantFallback(track);
        }
        timelineSlotsBuildDepth += 1;
        let slots;
        try {
            slots = buildTrackTimelineSlots(track);
            slots = inferMusicalBindingsForTrack(track, slots, {
                preserveStored,
            });
            timelineSlotsBuildScratch = slots;
            if (o.writeCache !== false) {
                cacheTrackTimelineSlots(track, slots);
            } else if (ex >= 0) {
                storeTrackTimelineSlotsReadCache(track, slots, preserveStored);
            }
            return slots;
        } finally {
            timelineSlotsBuildDepth -= 1;
            if (timelineSlotsBuildDepth <= 0) {
                timelineSlotsBuildDepth = 0;
                timelineSlotsBuildScratch = null;
            }
        }
    }

    function syncEditorsFromTimelineSlots(slots, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!slots || !slots.length) return false;
        const counts = slots.map((s) =>
            s.musical && s.musical.phraseBarCount > 0
                ? s.musical.phraseBarCount | 0
                : s.musical && s.musical.contentBarCount > 0
                  ? s.musical.contentBarCount | 0
                  : 0,
        );
        if (!counts.some((n) => n > 0)) return false;
        if (typeof window.applyPhraseGroupBarCountsForRegionSwap !== 'function') {
            return false;
        }
        window.applyPhraseGroupBarCountsForRegionSwap(counts, { skipUndo: !!o.skipUndo });
        window.musicalSlotDiagLog('sync-editors', { head: counts.slice(0, 8), len: counts.length });
        return true;
    }

    function rebindTimelineSlotsFromEditors(track) {
        const slots = buildTrackTimelineSlots(track);
        return inferMusicalBindingsForTrack(track, slots, { preserveStored: false });
    }

    /** セパレート／ボンド等で segment 列が変わった後 — musical 紐付けを組み直し cache 更新 */
    function refreshTrackTimelineMusicalSlots(track, opt) {
        if (
            !track ||
            track.type !== 'extra' ||
            typeof window.isTrackRegionActive !== 'function' ||
            !window.isTrackRegionActive(track)
        ) {
            return null;
        }
        const o = opt && typeof opt === 'object' ? opt : {};
        const preserveStored = resolvePreserveStoredMusical(track, {
            preserveStored: o.preserveStored === true ? true : false,
        });
        const slots = getTrackTimelineSlots(track, { preserveStored, writeCache: true });
        window.musicalSlotDiagLog('rebind/region-edit', {
            ex: (track.slot | 0) + 1,
            units: slots.length,
            preserveStored,
        });
        return slots;
    }

    function applySlotLayoutToSegments(track, slots, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (
            typeof window.getTrackSegments !== 'function' ||
            typeof window.setTrackSegments !== 'function' ||
            typeof window.repositionRegionSwapUnitToTimelineSec !== 'function'
        ) {
            return false;
        }
        const segments = window.getTrackSegments(track).map((s) => Object.assign({}, s));
        const t0 =
            typeof window.getTrackTimelineStartSec === 'function'
                ? window.getTrackTimelineStartSec(track)
                : 0;

        if (typeof window.snapshotSegmentTimelineAnchorsOnCopies === 'function') {
            window.snapshotSegmentTimelineAnchorsOnCopies(track, segments);
        }

        const beforeRegionMarkerBounds =
            typeof window.captureTrackSegmentRegionBoundsMap === 'function'
                ? window.captureTrackSegmentRegionBoundsMap(track)
                : null;

        const metrics =
            typeof getRegionOverlayTimelineMetrics === 'function'
                ? getRegionOverlayTimelineMetrics()
                : null;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        let oldOverlayIntervals = null;
        if (
            o.anim &&
            metrics &&
            metrics.scrubW > 0 &&
            master > 0 &&
            typeof getSegmentRegionOverlayTimelineInterval === 'function' &&
            typeof transportSecToOverlayPx === 'function'
        ) {
            oldOverlayIntervals = [];
            for (let si = 0; si < segments.length; si++) {
                const iv = getSegmentRegionOverlayTimelineInterval(track, si);
                if (!iv) {
                    oldOverlayIntervals = null;
                    break;
                }
                const left = transportSecToOverlayPx(iv.start, metrics, master);
                const right = transportSecToOverlayPx(iv.end, metrics, master);
                oldOverlayIntervals.push({
                    left: Number.isFinite(left) ? left : 0,
                    width: Math.max(1, (Number.isFinite(right) ? right : 0) - left),
                });
            }
        }

        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (slot.kind === 'silent') continue;
            if (!slot.segmentRefs || !slot.segmentRefs.length) continue;
            if (!Number.isFinite(slot.timelineStartSec)) continue;
            const indices = slot.segmentRefs.map((r) => r.segmentIndex | 0);
            window.repositionRegionSwapUnitToTimelineSec(
                track,
                segments,
                indices,
                slot.timelineStartSec,
                t0,
            );
        }

        if (!o.skipLayoutCorrections) {
            resolveLayoutCorrections(track, segments, t0, slots);
        }

        function commitSegments(animOpt) {
            const ao = animOpt && typeof animOpt === 'object' ? animOpt : {};
            const deferRedraw = !!ao.deferRedraw;
            const ok = window.setTrackSegments(track, segments, {
                skipUndo: !!o.skipUndo,
                silent: o.silent !== false,
                deferRedraw,
                geometryOnly: deferRedraw && o.geometryOnly !== false,
                invalidatePeakCache: !deferRedraw,
                skipPersist: !!ao.skipPersist,
                skipSyncTransport: !!ao.skipSyncTransport,
            });
            if (ok && typeof window.syncTrackHeadPadFromFirstSegment === 'function') {
                window.syncTrackHeadPadFromFirstSegment(track, segments);
            }
            if (ok && slots) {
                cacheTrackTimelineSlots(track, slots);
            }
            if (
                ok &&
                beforeRegionMarkerBounds &&
                typeof window.relocateRegionVolumePitchMarkersAfterLayout === 'function'
            ) {
                window.relocateRegionVolumePitchMarkersAfterLayout(track, beforeRegionMarkerBounds, {
                    silent: true,
                });
            }
            if (
                ok &&
                beforeRegionMarkerBounds &&
                typeof window.syncSegmentVolumePitchAfterRegionLayout === 'function'
            ) {
                window.syncSegmentVolumePitchAfterRegionLayout(track, beforeRegionMarkerBounds, {
                    silent: true,
                });
            }
            return !!ok;
        }

        const anim = o.anim;
        if (
            anim &&
            typeof window.playPlaybackRegionSwapAnimation === 'function'
        ) {
            const redrawOpt = { invalidatePeakCache: true };
            const animSpec = {
                track,
                forceTimelineSwap: true,
                previewSegments: segments,
                redrawOpt,
                applySwap: (animOpt) => commitSegments(animOpt),
                finalizeSwap: typeof o.finalizeSwap === 'function' ? o.finalizeSwap : function () {},
            };
            if (anim.gap) {
                animSpec.gap = anim.gap;
                animSpec.segmentIndex = anim.segmentIndex | 0;
                animSpec.segmentIndices = anim.segmentIndices || [];
                if (anim.swapPlan) animSpec.swapPlan = anim.swapPlan;
            } else {
                animSpec.swapLo = anim.swapLo | 0;
                animSpec.swapHi = anim.swapHi | 0;
                if (anim.swapUnitSegmentIndicesA && anim.swapUnitSegmentIndicesB) {
                    animSpec.swapUnitSegmentIndicesA = anim.swapUnitSegmentIndicesA;
                    animSpec.swapUnitSegmentIndicesB = anim.swapUnitSegmentIndicesB;
                }
            }
            if (oldOverlayIntervals && oldOverlayIntervals.length === segments.length) {
                animSpec.oldOverlayIntervals = oldOverlayIntervals;
            }
            const animResult = window.playPlaybackRegionSwapAnimation(animSpec);
            window.musicalSlotDiagLog('swap/animation', { result: animResult });
            if (animResult === 'started' || animResult === 'applied-recovered') {
                return true;
            }
        }

        return commitSegments();
    }

    /** counts 更新後 — phraseSlotIndex に基づき phraseBarCount / meterBarStart を同期 */
    function refreshSlotsMusicalFromCounts(slots, counts) {
        if (!slots || !counts || !counts.length) return slots;
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (!slot.musical) continue;
            const idx = slot.musical.phraseSlotIndex | 0;
            if (idx < 0 || idx >= counts.length) continue;
            slot.musical.phraseBarCount = counts[idx] | 0;
            let meterBarStart = 0;
            for (let c = 0; c < idx; c++) {
                meterBarStart += counts[c] | 0;
            }
            slot.musical.meterBarStart = meterBarStart;
        }
        return slots;
    }

    function resolveTimelineSlotIndexForSelection(track, entry, slots) {
        if (!entry || !slots || !slots.length) return -1;
        if (entry.segmentIndex < 0) {
            return slots.findIndex(
                (s) => s.kind === 'silent' && (s.silentGapIndex | 0) === (entry.silentGapIndex | 0),
            );
        }
        const unitIndices =
            typeof window.resolveRegionSwapUnitSegmentIndices === 'function'
                ? window.resolveRegionSwapUnitSegmentIndices(track, entry.segmentIndex)
                : [entry.segmentIndex | 0];
        const leader = unitIndices[0] | 0;
        return slots.findIndex(
            (s) =>
                s.kind !== 'silent' &&
                s.segmentRefs.some((r) => (r.segmentIndex | 0) === leader),
        );
    }

    function resolveSwapAnimLeaderSegmentIndex(slot) {
        if (!slot || !slot.segmentRefs || !slot.segmentRefs.length) return -1;
        let min = Infinity;
        for (let i = 0; i < slot.segmentRefs.length; i++) {
            min = Math.min(min, slot.segmentRefs[i].segmentIndex | 0);
        }
        return Number.isFinite(min) ? min : -1;
    }

    function slotTimelineStartSec(slot) {
        return Number.isFinite(slot && slot.timelineStartSec) ? slot.timelineStartSec : 0;
    }

    function previewSegmentTimelineStart(seg) {
        if (!seg) return NaN;
        if (Number.isFinite(seg.regionTimelineInSec)) return seg.regionTimelineInSec;
        if (Number.isFinite(seg.timelineStartSec)) return seg.timelineStartSec;
        return NaN;
    }

    /** 復元先 segment 列と現状態のタイムライン位置差から入れ替え spec を推定（slot 並び替え後も検出可） */
    function findSwapAnimFromPreviewSegments(track, previewSegments) {
        if (!previewSegments || !previewSegments.length) return null;
        const eps = 0.001;
        const n = previewSegments.length;
        const unitMap = new Map();

        function unitKey(indices) {
            return indices.join(',');
        }

        for (let i = 0; i < n; i++) {
            const tgtStart = previewSegmentTimelineStart(previewSegments[i]);
            if (!Number.isFinite(tgtStart)) continue;
            const curStart =
                typeof window.getSegmentRegionTimelineIn === 'function'
                    ? window.getSegmentRegionTimelineIn(track, i)
                    : NaN;
            if (!Number.isFinite(curStart) || Math.abs(curStart - tgtStart) <= eps) continue;

            const unitIndices =
                typeof window.resolveRegionSwapUnitSegmentIndices === 'function'
                    ? window.resolveRegionSwapUnitSegmentIndices(track, i)
                    : [i | 0];
            const key = unitKey(unitIndices);
            if (unitMap.has(key)) continue;
            let leader = unitIndices[0] | 0;
            for (let u = 0; u < unitIndices.length; u++) {
                leader = Math.min(leader, unitIndices[u] | 0);
            }
            const curRegionIn =
                typeof window.getSegmentRegionTimelineIn === 'function'
                    ? window.getSegmentRegionTimelineIn(track, leader)
                    : curStart;
            const tgtRegionIn = previewSegmentTimelineStart(previewSegments[leader]);
            unitMap.set(key, {
                unitIndices: unitIndices.slice(),
                leader,
                curStart: Number.isFinite(curRegionIn) ? curRegionIn : curStart,
                tgtStart: Number.isFinite(tgtRegionIn) ? tgtRegionIn : tgtStart,
            });
        }

        const units = [];
        unitMap.forEach((u) => units.push(u));
        if (!units.length) return null;

        for (let a = 0; a < units.length; a++) {
            for (let b = a + 1; b < units.length; b++) {
                const ua = units[a];
                const ub = units[b];
                if (
                    Math.abs(ua.curStart - ub.tgtStart) < eps &&
                    Math.abs(ub.curStart - ua.tgtStart) < eps &&
                    Math.abs(ua.curStart - ua.tgtStart) > eps
                ) {
                    const segA = ua.leader | 0;
                    const segB = ub.leader | 0;
                    if (segA === segB) continue;
                    return {
                        swapLo: Math.min(segA, segB),
                        swapHi: Math.max(segA, segB),
                        swapUnitSegmentIndicesA: ua.unitIndices,
                        swapUnitSegmentIndicesB: ub.unitIndices,
                    };
                }
            }
        }

        if (units.length === 1) {
            const u = units[0];
            const slots = getTrackTimelineSlots(track, {
                preserveStored: true,
                writeCache: false,
            });
            if (slots && slots.length) {
                for (let si = 0; si < slots.length; si++) {
                    const slot = slots[si];
                    if (!slot || slot.kind !== 'silent') continue;
                    const gap = getSilentGapForSlot(track, slot);
                    if (!gap || !u.unitIndices.length) continue;
                    return {
                        gap,
                        segmentIndex: u.unitIndices[0] | 0,
                        segmentIndices: u.unitIndices.slice(),
                    };
                }
            }
        }
        return null;
    }

    /** Undo/Redo 復元先と現状態の slot 配置から入れ替えアニメーション spec を推定 */
    function findSwapAnimBetweenSlotLayouts(currentSlots, targetSlots, track) {
        if (!currentSlots || !targetSlots || currentSlots.length !== targetSlots.length) {
            return null;
        }
        const eps = 0.001;
        const n = currentSlots.length;
        let silentIdx = -1;
        let audioIdx = -1;
        for (let i = 0; i < n; i++) {
            const changed =
                Math.abs(slotTimelineStartSec(currentSlots[i]) - slotTimelineStartSec(targetSlots[i])) >
                eps;
            if (!changed) continue;
            if (currentSlots[i].kind === 'silent') silentIdx = i;
            else if (
                currentSlots[i].segmentRefs &&
                currentSlots[i].segmentRefs.length
            ) {
                audioIdx = i;
            }
        }
        if (silentIdx >= 0 && audioIdx >= 0) {
            const silentSlot = currentSlots[silentIdx];
            const audioSlot = currentSlots[audioIdx];
            const gap = getSilentGapForSlot(track, silentSlot);
            const indices = (audioSlot.segmentRefs || []).map((r) => r.segmentIndex | 0);
            if (gap && indices.length) {
                return {
                    gap,
                    segmentIndex: indices[0] | 0,
                    segmentIndices: indices,
                };
            }
        }
        for (let i = 0; i < n; i++) {
            if (currentSlots[i].kind === 'silent') continue;
            for (let j = i + 1; j < n; j++) {
                if (currentSlots[j].kind === 'silent') continue;
                const curI = slotTimelineStartSec(currentSlots[i]);
                const curJ = slotTimelineStartSec(currentSlots[j]);
                const tgtI = slotTimelineStartSec(targetSlots[i]);
                const tgtJ = slotTimelineStartSec(targetSlots[j]);
                if (
                    Math.abs(curI - tgtJ) < eps &&
                    Math.abs(curJ - tgtI) < eps &&
                    Math.abs(curI - tgtI) > eps
                ) {
                    const slotA = currentSlots[i];
                    const slotB = currentSlots[j];
                    const segA = resolveSwapAnimLeaderSegmentIndex(slotA);
                    const segB = resolveSwapAnimLeaderSegmentIndex(slotB);
                    if (segA >= 0 && segB >= 0 && segA !== segB) {
                        return {
                            swapLo: Math.min(segA, segB),
                            swapHi: Math.max(segA, segB),
                            swapUnitSegmentIndicesA: (slotA.segmentRefs || []).map(
                                (r) => r.segmentIndex | 0,
                            ),
                            swapUnitSegmentIndicesB: (slotB.segmentRefs || []).map(
                                (r) => r.segmentIndex | 0,
                            ),
                        };
                    }
                }
            }
        }
        return null;
    }

    let regionSwapHistoryAnimHint = null;

    function phraseCountsArraysEqual(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if ((a[i] | 0) !== (b[i] | 0)) return false;
        }
        return true;
    }

    function cloneSwapAnimForHistoryHint(swapAnim) {
        if (!swapAnim) return null;
        if (swapAnim.gap || (swapAnim.segmentIndices && swapAnim.segmentIndices.length)) {
            return {
                silent: true,
                segmentIndex: swapAnim.segmentIndex | 0,
                segmentIndices: (swapAnim.segmentIndices || []).map((i) => i | 0),
            };
        }
        return {
            swapLo: swapAnim.swapLo | 0,
            swapHi: swapAnim.swapHi | 0,
            swapUnitSegmentIndicesA: (swapAnim.swapUnitSegmentIndicesA || []).map((i) => i | 0),
            swapUnitSegmentIndicesB: (swapAnim.swapUnitSegmentIndicesB || []).map((i) => i | 0),
        };
    }

    function setRegionSwapHistoryAnimHint(track, swapAnim, preSwapPhraseCounts, postSwapPhraseCounts) {
        if (!track || !swapAnim) {
            regionSwapHistoryAnimHint = null;
            window.regionSwapHistoryAnimHint = null;
            return;
        }
        regionSwapHistoryAnimHint = {
            trackSlot: track.slot | 0,
            swapAnim: cloneSwapAnimForHistoryHint(swapAnim),
            preSwapPhraseCounts: preSwapPhraseCounts ? preSwapPhraseCounts.slice() : null,
            postSwapPhraseCounts: postSwapPhraseCounts ? postSwapPhraseCounts.slice() : null,
        };
        window.regionSwapHistoryAnimHint = regionSwapHistoryAnimHint;
    }

    function clearRegionSwapHistoryAnimHint() {
        regionSwapHistoryAnimHint = null;
        window.regionSwapHistoryAnimHint = null;
    }

    function cloneRegionSwapHistoryAnimHint(hint) {
        if (!hint || !hint.swapAnim) return null;
        return {
            trackSlot: hint.trackSlot | 0,
            swapAnim: cloneSwapAnimForHistoryHint(hint.swapAnim),
            preSwapPhraseCounts: hint.preSwapPhraseCounts
                ? hint.preSwapPhraseCounts.slice()
                : null,
            postSwapPhraseCounts: hint.postSwapPhraseCounts
                ? hint.postSwapPhraseCounts.slice()
                : null,
        };
    }

    function regionSwapHistoryAnimHintMatchesTarget(hint, normalizedTarget) {
        if (!hint || !normalizedTarget) return false;
        const counts = normalizedTarget.phraseExpandedCounts;
        if (!counts || !counts.length) return false;
        if (
            hint.preSwapPhraseCounts &&
            phraseCountsArraysEqual(hint.preSwapPhraseCounts, counts)
        ) {
            return true;
        }
        if (
            hint.postSwapPhraseCounts &&
            phraseCountsArraysEqual(hint.postSwapPhraseCounts, counts)
        ) {
            return true;
        }
        return false;
    }

    function resolveSwapAnimFromHistoryHint(track, hintSwapAnim, previewSegments) {
        if (!hintSwapAnim) return null;
        if (hintSwapAnim.silent) {
            const indices =
                hintSwapAnim.segmentIndices && hintSwapAnim.segmentIndices.length
                    ? hintSwapAnim.segmentIndices.map((i) => i | 0)
                    : [hintSwapAnim.segmentIndex | 0];
            const slots = getTrackTimelineSlots(track, {
                preserveStored: true,
                writeCache: false,
            });
            if (!slots || !slots.length) return null;
            for (let si = 0; si < slots.length; si++) {
                if (slots[si].kind !== 'silent') continue;
                const gap = getSilentGapForSlot(track, slots[si]);
                if (!gap || !indices.length) continue;
                const leader = indices[0] | 0;
                const segRegionIn =
                    typeof window.getSegmentRegionTimelineIn === 'function'
                        ? window.getSegmentRegionTimelineIn(track, leader)
                        : 0;
                const previewSeg = previewSegments[leader];
                let targetSec = segRegionIn;
                if (previewSeg) {
                    if (Number.isFinite(previewSeg.regionTimelineInSec)) {
                        targetSec = previewSeg.regionTimelineInSec;
                    } else if (Number.isFinite(previewSeg.timelineStartSec)) {
                        targetSec = previewSeg.timelineStartSec;
                    }
                }
                return {
                    gap,
                    segmentIndex: leader,
                    segmentIndices: indices,
                    swapPlan: {
                        targetSec,
                        delta: targetSec - segRegionIn,
                    },
                };
            }
            return null;
        }
        return {
            swapLo: hintSwapAnim.swapLo | 0,
            swapHi: hintSwapAnim.swapHi | 0,
            swapUnitSegmentIndicesA: hintSwapAnim.swapUnitSegmentIndicesA,
            swapUnitSegmentIndicesB: hintSwapAnim.swapUnitSegmentIndicesB,
        };
    }

    function resolveHistoryRestorePhraseCounts(normalizedTarget, hint) {
        if (
            normalizedTarget.phraseExpandedCounts &&
            normalizedTarget.phraseExpandedCounts.length
        ) {
            return normalizedTarget.phraseExpandedCounts;
        }
        if (hint && hint.preSwapPhraseCounts && hint.preSwapPhraseCounts.length) {
            return hint.preSwapPhraseCounts;
        }
        if (hint && hint.postSwapPhraseCounts && hint.postSwapPhraseCounts.length) {
            return hint.postSwapPhraseCounts;
        }
        return null;
    }

    function planRegionHistorySwapAnimationFromHint(normalizedTarget, slotIdx, hint) {
        if (!hint || !hint.swapAnim) return null;
        const track = { type: 'extra', slot: slotIdx | 0 };
        const entry = normalizedTarget.tracks.find((e) => e.slot === slotIdx);
        if (!entry || !entry.playbackRegions) return null;

        const previewPhraseCounts = resolveHistoryRestorePhraseCounts(normalizedTarget, hint);
        const previewSegments =
            typeof window.previewTrackSegmentsFromUndoEntry === 'function'
                ? window.previewTrackSegmentsFromUndoEntry(track, entry, {
                      phraseExpandedCounts: previewPhraseCounts,
                  })
                : null;
        if (!previewSegments || !previewSegments.length) return null;

        const swapAnim = resolveSwapAnimFromHistoryHint(track, hint.swapAnim, previewSegments);
        if (!swapAnim) return null;

        const oldOverlayIntervals =
            typeof window.captureTrackRegionOverlayIntervals === 'function'
                ? window.captureTrackRegionOverlayIntervals(track, previewSegments.length)
                : null;

        function finalizeSwap() {
            if (typeof window.scheduleMusicalGridRedraw === 'function') {
                window.scheduleMusicalGridRedraw();
            }
            if (typeof window.notifyMasterTransportDurationChanged === 'function') {
                window.notifyMasterTransportDurationChanged();
            }
        }

        return {
            track,
            previewSegments,
            oldOverlayIntervals,
            swapAnim,
            targetCounts: previewPhraseCounts,
            finalizeSwap,
        };
    }

    function planRegionHistorySwapAnimation(normalizedTarget, slotIdx) {
        const track = { type: 'extra', slot: slotIdx | 0 };
        const entry = normalizedTarget.tracks.find((e) => e.slot === slotIdx);
        if (!entry || !entry.playbackRegions) return null;

        const hint =
            typeof window.regionSwapHistoryAnimHint !== 'undefined'
                ? window.regionSwapHistoryAnimHint
                : null;
        const previewPhraseCounts = resolveHistoryRestorePhraseCounts(normalizedTarget, hint);
        const previewSegments =
            typeof window.previewTrackSegmentsFromUndoEntry === 'function'
                ? window.previewTrackSegmentsFromUndoEntry(track, entry, {
                      phraseExpandedCounts: previewPhraseCounts,
                  })
                : null;
        if (!previewSegments || !previewSegments.length) return null;

        let swapAnim = findSwapAnimFromPreviewSegments(track, previewSegments);
        if (!swapAnim) {
            const targetSlots = persistedTimelineSlotsAreUsable(entry.playbackRegions.timelineSlots)
                ? entry.playbackRegions.timelineSlots.map((s) => cloneTimelineSlot(s))
                : null;
            const currentSlots = getTrackTimelineSlots(track, {
                preserveStored: true,
                writeCache: false,
            });
            if (
                targetSlots &&
                currentSlots &&
                currentSlots.length === targetSlots.length
            ) {
                swapAnim = findSwapAnimBetweenSlotLayouts(currentSlots, targetSlots, track);
            }
        }
        if (!swapAnim) return null;

        if (swapAnim.gap) {
            const leader = (swapAnim.segmentIndices && swapAnim.segmentIndices[0]) | 0;
            const segRegionIn =
                typeof window.getSegmentRegionTimelineIn === 'function'
                    ? window.getSegmentRegionTimelineIn(track, leader)
                    : 0;
            const previewSeg = previewSegments[leader];
            let targetSec = segRegionIn;
            if (previewSeg) {
                if (Number.isFinite(previewSeg.regionTimelineInSec)) {
                    targetSec = previewSeg.regionTimelineInSec;
                } else if (Number.isFinite(previewSeg.timelineStartSec)) {
                    targetSec = previewSeg.timelineStartSec;
                }
            }
            swapAnim.swapPlan = {
                targetSec,
                delta: targetSec - segRegionIn,
            };
        }

        const oldOverlayIntervals =
            typeof window.captureTrackRegionOverlayIntervals === 'function'
                ? window.captureTrackRegionOverlayIntervals(track, previewSegments.length)
                : null;

        function finalizeSwap() {
            if (typeof window.scheduleMusicalGridRedraw === 'function') {
                window.scheduleMusicalGridRedraw();
            }
            if (typeof window.notifyMasterTransportDurationChanged === 'function') {
                window.notifyMasterTransportDurationChanged();
            }
        }

        return {
            track,
            previewSegments,
            oldOverlayIntervals,
            swapAnim,
            targetCounts: previewPhraseCounts,
            finalizeSwap,
        };
    }

    function swapTimelineSlotsAtIndices(track, indexA, indexB, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        let slots = getTrackTimelineSlots(track, { preserveStored: true, writeCache: false });
        const idxA = indexA | 0;
        const idxB = indexB | 0;
        if (idxA < 0 || idxB < 0 || idxA >= slots.length || idxB >= slots.length) {
            return { ok: false, reason: 'slot index out of range' };
        }
        if (idxA === idxB) {
            return { ok: true, noop: true };
        }

        const slotA = slots[idxA];
        const slotB = slots[idxB];
        if (slotA.kind === 'silent' && slotB.kind === 'silent') {
            return { ok: true, noop: true };
        }
        if (!slotA.musical) slotA.musical = {};
        if (!slotB.musical) slotB.musical = {};

        window.musicalSlotDiagLog('swap/before', {
            ex: track.slot + 1,
            unitA: idxA + 1,
            unitB: idxB + 1,
            unitAIdentity: swapUnitIdentityKey(slotA),
            unitBIdentity: swapUnitIdentityKey(slotB),
        });

        const counts =
            typeof window.getExpandedPhraseGroupBarCountsSnapshot === 'function'
                ? window.getExpandedPhraseGroupBarCountsSnapshot()
                : slots.map((s) =>
                      s.musical && s.musical.phraseBarCount > 0
                          ? s.musical.phraseBarCount | 0
                          : 0,
                  );

        const phraseIdxA =
            slotA.musical.phraseSlotIndex >= 0
                ? slotA.musical.phraseSlotIndex | 0
                : idxA;
        const phraseIdxB =
            slotB.musical.phraseSlotIndex >= 0
                ? slotB.musical.phraseSlotIndex | 0
                : idxB;

        const barA = resolveSwapUnitBarCount(slotA, counts);
        const barB = resolveSwapUnitBarCount(slotB, counts);
        const involvesSilent = slotA.kind === 'silent' || slotB.kind === 'silent';
        let swapMode = involvesSilent ? 'silent-audio' : 'audio-audio';
        let nextCounts;
        let audioTargetSecOverride = null;

        if (involvesSilent) {
            const silentSlot = slotA.kind === 'silent' ? slotA : slotB;
            const audioSlot = slotA.kind === 'silent' ? slotB : slotA;
            const phraseIdxSilent = silentSlot.musical.phraseSlotIndex | 0;
            const phraseIdxAudio = audioSlot.musical.phraseSlotIndex | 0;
            const barSilent = resolveSwapUnitBarCount(silentSlot, counts);
            const barAudio = resolveSwapUnitBarCount(audioSlot, counts);

            const partialPlan = tryResolveSilentAudioPartialPlan(
                track,
                silentSlot,
                audioSlot,
                counts,
            );
            let destSilent;
            let destAudio;
            if (partialPlan) {
                swapMode = partialPlan.mode;
                nextCounts = partialPlan.nextCounts;
                destSilent = partialPlan.silentDestPhraseIdx | 0;
                destAudio = partialPlan.audioDestPhraseIdx | 0;
                audioTargetSecOverride = partialPlan.audioTargetSec;
            } else {
                nextCounts = computeNextCountsForSlotPairSwap(
                    counts,
                    phraseIdxSilent,
                    phraseIdxAudio,
                    barSilent,
                    barAudio,
                );
                const dest = assignPairSwapDestinations(
                    phraseIdxSilent,
                    phraseIdxAudio,
                    barSilent,
                    barAudio,
                );
                destSilent = dest.destA;
                destAudio = dest.destB;
            }

            silentSlot.musical.phraseSlotIndex = destSilent;
            audioSlot.musical.phraseSlotIndex = destAudio;
        } else {
            nextCounts = counts.slice();
            const canSwapPhraseIndices =
                phraseIdxA >= 0 &&
                phraseIdxA < nextCounts.length &&
                phraseIdxB >= 0 &&
                phraseIdxB < nextCounts.length;
            if (canSwapPhraseIndices) {
                const tmp = nextCounts[phraseIdxA];
                nextCounts[phraseIdxA] = nextCounts[phraseIdxB];
                nextCounts[phraseIdxB] = tmp;
                slotA.musical.phraseSlotIndex = phraseIdxB;
                slotB.musical.phraseSlotIndex = phraseIdxA;
            }
        }

        if (!o.skipUndo && typeof window.requestRegionUndoCapture === 'function') {
            window.requestRegionUndoCapture({ includePhrase: true, forceCapture: true });
        }

        const willAnimateSwap =
            typeof window.playPlaybackRegionSwapAnimation === 'function' &&
            (involvesSilent ||
                (slotA.segmentRefs &&
                    slotA.segmentRefs.length &&
                    slotB.segmentRefs &&
                    slotB.segmentRefs.length));
        if (typeof window.applyPhraseGroupBarCountsForRegionSwap === 'function') {
            window.applyPhraseGroupBarCountsForRegionSwap(nextCounts, {
                skipUndo: true,
                relayoutRegions: false,
                skipSessionPersist: willAnimateSwap,
                skipGridRedraw: willAnimateSwap,
            });
        }
        if (typeof window.clearMusicalGridPositionCache === 'function') {
            window.clearMusicalGridPositionCache();
        }

        refreshSlotsMusicalFromCounts(slots, nextCounts);

        const timelineStartOverrides = {};
        if (involvesSilent && audioTargetSecOverride != null) {
            timelineStartOverrides[slotA.kind === 'silent' ? idxB : idxA] = audioTargetSecOverride;
        }
        refreshSlotTimelineBoundsFromPhraseCounts(
            track,
            slots,
            nextCounts,
            timelineStartOverrides,
        );

        window.musicalSlotDiagLog('swap/apply', {
            mode: 'slot-engine/' + swapMode,
            ex: track.slot + 1,
            unitA: window.musicalSlotDiagSummarizeSwapUnit(slotA, idxA),
            unitB: window.musicalSlotDiagSummarizeSwapUnit(slotB, idxB),
            phraseIdxA: phraseIdxA + 1,
            phraseIdxB: phraseIdxB + 1,
            asymmetric: barA !== barB,
            countsBefore: counts.slice(0, 12),
            countsAfter: nextCounts.slice(0, 12),
            destSec: {
                a: window.musicalSlotDiagFmtSec(slotA.timelineStartSec),
                b: window.musicalSlotDiagFmtSec(slotB.timelineStartSec),
            },
        });

        let swapAnim = null;
        if (involvesSilent) {
            const silentSlot = slotA.kind === 'silent' ? slotA : slotB;
            const audioSlot = slotA.kind === 'silent' ? slotB : slotA;
            const gap = getSilentGapForSlot(track, silentSlot);
            const indices = (audioSlot.segmentRefs || []).map((r) => r.segmentIndex | 0);
            if (gap && indices.length) {
                swapAnim = {
                    gap,
                    segmentIndex: indices[0],
                    segmentIndices: indices,
                };
                if (typeof window.silentGapSegmentSwapPlan === 'function') {
                    swapAnim.swapPlan = window.silentGapSegmentSwapPlan(
                        track,
                        gap,
                        indices,
                    );
                }
            }
        } else if (
            slotA.segmentRefs &&
            slotA.segmentRefs.length &&
            slotB.segmentRefs &&
            slotB.segmentRefs.length
        ) {
            const segA = resolveSwapAnimLeaderSegmentIndex(slotA);
            const segB = resolveSwapAnimLeaderSegmentIndex(slotB);
            if (segA >= 0 && segB >= 0 && segA !== segB) {
                swapAnim = {
                    swapLo: Math.min(segA, segB),
                    swapHi: Math.max(segA, segB),
                    swapUnitSegmentIndicesA: (slotA.segmentRefs || []).map(
                        (r) => r.segmentIndex | 0,
                    ),
                    swapUnitSegmentIndicesB: (slotB.segmentRefs || []).map(
                        (r) => r.segmentIndex | 0,
                    ),
                };
            }
        }

        const swapActionMessage =
            typeof formatRegionSwapActionMessage === 'function'
                ? formatRegionSwapActionMessage(
                      track,
                      slotA,
                      slotB,
                      idxA,
                      idxB,
                      swapMode,
                      counts,
                  )
                : 'swapped on Ex ' +
                  (track.slot + 1) +
                  ' (unit ' +
                  (idxA + 1) +
                  ' ↔ ' +
                  (idxB + 1) +
                  ', ' +
                  swapMode +
                  ')';

        function runDeferredSwapUiAndDiagnostics() {
            window.musicalSlotDiagLog('swap/after-cache', {
                ex: track.slot + 1,
                cachedUnits: slots.map((s, i) => ({
                    index: i,
                    identity: swapUnitIdentityKey(s),
                    musical: window.musicalSlotDiagSummarizeMusicalOrigin(s.musical),
                    unit: window.musicalSlotDiagSummarizeSwapUnit(s, i),
                })),
            });
            if (typeof logRegionAction === 'function') {
                logRegionAction(swapActionMessage);
            } else if (typeof writeLog === 'function') {
                writeLog('Playback region: ' + swapActionMessage);
            }
            if (typeof window.scheduleMusicalGridRedraw === 'function') {
                window.scheduleMusicalGridRedraw();
            }
            if (typeof window.notifyMasterTransportDurationChanged === 'function') {
                window.notifyMasterTransportDurationChanged();
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'Swapped', 'notice');
            }
            if (typeof window.schedulePersistExtraTrackLayout === 'function') {
                window.schedulePersistExtraTrackLayout();
            } else if (typeof window.schedulePersistExtraTrackSlot === 'function') {
                window.schedulePersistExtraTrackSlot(track.slot);
            }
            const phrase = window.musicalSlotDiagPhraseSnapshot();
            window.musicalSlotDiagLog('swap/done', {
                mode: 'slot-engine/' + swapMode,
                ex: track.slot + 1,
                phraseText: phrase.text,
                countsAfter: nextCounts.slice(0, 12),
            });
        }

        if (swapAnim) {
            setRegionSwapHistoryAnimHint(track, swapAnim, counts, nextCounts);
            if (typeof window.attachRegionSwapAnimHintToUndoStackTop === 'function') {
                window.attachRegionSwapAnimHintToUndoStackTop(
                    window.regionSwapHistoryAnimHint,
                );
            }
        }

        const deferPostSwapUi = !!(willAnimateSwap && swapAnim);
        const layoutOpt = {
            skipUndo: true,
            silent: o.silent,
            skipLayoutCorrections: true,
            anim: swapAnim,
        };
        if (deferPostSwapUi) {
            layoutOpt.finalizeSwap = runDeferredSwapUiAndDiagnostics;
        }

        if (!applySlotLayoutToSegments(track, slots, layoutOpt)) {
            return { ok: false, reason: 'layout apply incomplete' };
        }
        cacheTrackTimelineSlots(track, slots);

        if (deferPostSwapUi) {
            return { ok: true, slots, nextCounts };
        }

        window.musicalSlotDiagLog('swap/after-cache', {
            ex: track.slot + 1,
            cachedUnits: slots.map((s, i) => ({
                index: i,
                identity: swapUnitIdentityKey(s),
                musical: window.musicalSlotDiagSummarizeMusicalOrigin(s.musical),
                unit: window.musicalSlotDiagSummarizeSwapUnit(s, i),
            })),
        });

        if (typeof window.scheduleMusicalGridRedraw === 'function') {
            window.scheduleMusicalGridRedraw();
        }
        const animActive =
            typeof window.isPlaybackRegionSwapAnimActive === 'function' &&
            window.isPlaybackRegionSwapAnimActive();
        if (!animActive && typeof window.redrawAfterRegionChange === 'function') {
            window.redrawAfterRegionChange(track.slot, { invalidatePeakCache: false });
        }
        if (!animActive) {
            if (typeof window.schedulePersistExtraTrackLayout === 'function') {
                window.schedulePersistExtraTrackLayout();
            } else if (typeof window.schedulePersistExtraTrackSlot === 'function') {
                window.schedulePersistExtraTrackSlot(track.slot);
            }
        }
        if (typeof window.notifyMasterTransportDurationChanged === 'function') {
            window.notifyMasterTransportDurationChanged();
        }
        if (typeof logRegionAction === 'function') {
            logRegionAction(swapActionMessage);
        } else if (typeof writeLog === 'function') {
            writeLog('Playback region: ' + swapActionMessage);
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Region', 'Swapped', 'notice');
        }

        const phrase = window.musicalSlotDiagPhraseSnapshot();
        window.musicalSlotDiagLog('swap/done', {
            mode: 'slot-engine/' + swapMode,
            ex: track.slot + 1,
            phraseText: phrase.text,
            countsAfter: nextCounts.slice(0, 12),
        });

        return { ok: true, slots, nextCounts };
    }

    function swapSelectedTimelineSlots() {
        if (
            typeof window.getMusicalGridPhraseFillVisible !== 'function' ||
            !window.getMusicalGridPhraseFillVisible()
        ) {
            return { ok: false, reason: 'phrase fill off' };
        }
        if (
            !regionSelectionEntries ||
            !regionSelectionEntries.length ||
            regionSelectionEntries.length !== 2
        ) {
            return { ok: false, reason: 'select exactly 2 items' };
        }
        const a = regionSelectionEntries[0];
        const b = regionSelectionEntries[1];
        if (a.slot !== b.slot) {
            return { ok: false, reason: 'different tracks' };
        }
        const track = trackRef(a.slot);
        if (typeof window.isTrackRegionActive === 'function' && !window.isTrackRegionActive(track)) {
            return { ok: false, reason: 'no active regions' };
        }

        const slots = getTrackTimelineSlots(track);
        const idxA = resolveTimelineSlotIndexForSelection(track, a, slots);
        const idxB = resolveTimelineSlotIndexForSelection(track, b, slots);
        if (idxA < 0 || idxB < 0) {
            return { ok: false, reason: 'slot unresolved' };
        }
        if (idxA === idxB) {
            window.musicalSlotDiagLog('swap/skip', { reason: 'same swap unit', ex: track.slot + 1 });
            return { ok: true, noop: true };
        }

        window.musicalSlotDiagLog('swap/start', {
            mode: 'slot-engine',
            ex: track.slot + 1,
            unitA: idxA + 1,
            unitB: idxB + 1,
            selection: [a, b].map((e) =>
                e.segmentIndex < 0
                    ? { silentGap: (e.silentGapIndex | 0) + 1 }
                    : { region: (e.segmentIndex | 0) + 1 },
            ),
        });

        return swapTimelineSlotsAtIndices(track, idxA, idxB);
    }

    function resolveSwapUnitMusicalBinding(track, ref, slotsOpt) {
        const r = ref && typeof ref === 'object' ? ref : {};
        let slots =
            Array.isArray(slotsOpt) && slotsOpt.length
                ? slotsOpt
                : null;
        if (!slots) {
            slots = getTrackTimelineSlots(track, { writeCache: false });
        }
        if (!slots.length) return null;
        if (Number.isFinite(r.segmentIndex) && (r.segmentIndex | 0) >= 0) {
            const unitIdx = resolveTimelineSlotIndexForSelection(
                track,
                { segmentIndex: r.segmentIndex | 0 },
                slots,
            );
            if (unitIdx >= 0 && slots[unitIdx] && slots[unitIdx].musical) {
                return cloneMusicalBinding(slots[unitIdx].musical);
            }
            return null;
        }
        if (Number.isFinite(r.silentGapIndex) && (r.silentGapIndex | 0) >= 0) {
            const gapIdx = r.silentGapIndex | 0;
            for (let i = 0; i < slots.length; i++) {
                const slot = slots[i];
                if (slot.kind === 'silent' && (slot.silentGapIndex | 0) === gapIdx && slot.musical) {
                    return cloneMusicalBinding(slot.musical);
                }
            }
            return null;
        }
        if (Number.isFinite(r.phraseSlotIndex) && (r.phraseSlotIndex | 0) >= 0) {
            const phraseIdx = r.phraseSlotIndex | 0;
            for (let i = 0; i < slots.length; i++) {
                const m = slots[i] && slots[i].musical;
                if (m && (m.phraseSlotIndex | 0) === phraseIdx) {
                    return cloneMusicalBinding(m);
                }
            }
        }
        return null;
    }

    function formatSwapUnitStoredMusicalMetaText(track, ref, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const binding = resolveSwapUnitMusicalBinding(track, ref, o.slots);
        let phraseBars = binding ? binding.phraseBarCount | 0 : 0;
        let contentBars = binding ? binding.contentBarCount | 0 : 0;
        if (!(phraseBars > 0) && o.counts && Number.isFinite(ref && ref.phraseSlotIndex)) {
            const idx = ref.phraseSlotIndex | 0;
            if (idx >= 0 && idx < o.counts.length) phraseBars = o.counts[idx] | 0;
        }
        if (!(contentBars > 0) && phraseBars > 0) contentBars = phraseBars;
        let meter = '';
        const settings = getMeterSettings();
        if (
            settings &&
            settings.meterSpec &&
            binding &&
            typeof window.formatMeterTextForBarRange === 'function'
        ) {
            const barStart = binding.meterBarStart | 0;
            const barCount = phraseBars > 0 ? phraseBars : contentBars;
            if (barCount > 0) {
                meter = window.formatMeterTextForBarRange(
                    settings.meterSpec,
                    barStart,
                    barCount,
                );
            }
        }
        if (
            !meter &&
            typeof window.getMusicalGridMeterDisplayText === 'function'
        ) {
            meter = window.getMusicalGridMeterDisplayText();
        }
        return typeof window.formatPhraseSlotMusicalMetaText === 'function'
            ? window.formatPhraseSlotMusicalMetaText(meter, phraseBars, contentBars)
            : '';
    }

    /** Phase 5 — Tempo/Sig 変更時: musical 紐付けを保ちつつ秒位置だけ再計算 */
    function relayoutTrackFromTimelineSlots(track, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (
            !track ||
            typeof window.isTrackRegionActive !== 'function' ||
            !window.isTrackRegionActive(track)
        ) {
            return false;
        }
        if (
            typeof window.getMusicalGridPhraseFillVisible !== 'function' ||
            !window.getMusicalGridPhraseFillVisible()
        ) {
            return false;
        }

        let slots = getTrackTimelineSlots(track, { preserveStored: true, writeCache: false });
        if (!slots.length) return false;

        const counts =
            typeof window.getExpandedPhraseGroupBarCountsSnapshot === 'function'
                ? window.getExpandedPhraseGroupBarCountsSnapshot()
                : [];
        if (!counts.length) return false;

        refreshSlotsMusicalFromCounts(slots, counts);
        refreshSlotTimelineBoundsFromPhraseCounts(track, slots, counts);

        const ok = applySlotLayoutToSegments(track, slots, {
            skipUndo: true,
            silent: o.silent !== false,
        });
        if (!ok) return false;

        cacheTrackTimelineSlots(track, slots);
        return true;
    }

    function relayoutAllTracksFromTimelineSlots(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const n =
            typeof window.getExtraTrackCount === 'function' ? window.getExtraTrackCount() : 0;
        if (!o.skipUndo && typeof window.requestRegionUndoCapture === 'function') {
            window.requestRegionUndoCapture({ includePhrase: false });
        }
        const trackOpt = Object.assign({}, o, { skipUndo: true });
        let relayouted = 0;
        for (let slot = 0; slot < n; slot++) {
            if (relayoutTrackFromTimelineSlots(trackRef(slot), trackOpt)) relayouted++;
        }
        window.musicalSlotDiagLog('rebind/meter-change', { tracks: relayouted });
        if (
            relayouted > 0 &&
            typeof window.refreshAllRegionMusicalMetaPresentation === 'function'
        ) {
            window.refreshAllRegionMusicalMetaPresentation();
        }
        if (relayouted > 0 && typeof window.schedulePersistSession === 'function') {
            window.schedulePersistSession();
        }
        return relayouted;
    }

    function rebuildAllTrackTimelineSlots(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const n =
            typeof window.getExtraTrackCount === 'function' ? window.getExtraTrackCount() : 0;
        let rebuilt = 0;
        for (let slot = 0; slot < n; slot++) {
            const track = trackRef(slot);
            if (
                typeof window.isTrackRegionActive === 'function' &&
                !window.isTrackRegionActive(track)
            ) {
                continue;
            }
            const slots = getTrackTimelineSlots(track, {
                preserveStored: !o.infer,
                writeCache: true,
            });
            if (o.infer) {
                inferMusicalBindingsForTrack(track, slots, {
                    preserveStored: o.preserveStored === true,
                });
                cacheTrackTimelineSlots(track, slots);
            }
            rebuilt++;
        }
        window.musicalSlotDiagLog('rebuild/all', { tracks: rebuilt, infer: !!o.infer });
        if (
            rebuilt > 0 &&
            o.skipPresentationRefresh !== true &&
            typeof window.refreshAllRegionMusicalMetaPresentation === 'function'
        ) {
            window.refreshAllRegionMusicalMetaPresentation();
        }
        return rebuilt;
    }


    function timelineSlotsPersistSlice(track) {
        const slots = getTrackTimelineSlots(track, { writeCache: false });
        return slots.map((s) => ({
            id: s.id,
            kind: s.kind,
            silentGapIndex: s.silentGapIndex >= 0 ? s.silentGapIndex : undefined,
            regionGroupId: s.regionGroupId,
            musical: cloneMusicalBinding(s.musical),
        }));
    }

    function restoreTimelineSlotsForTrack(track, persistedSlots) {
        if (
            !track ||
            !Array.isArray(persistedSlots) ||
            !persistedSlots.length ||
            typeof window.getPlaybackRegionsState !== 'function'
        ) {
            return false;
        }
        const state = window.getPlaybackRegionsState(track);
        if (!state) return false;
        state.timelineSlots = persistedSlots.map((s) => cloneTimelineSlot(s));
        invalidateTrackTimelineSlotsReadCache();
        return true;
    }

    window.buildTrackTimelineSlots = buildTrackTimelineSlots;
    window.getTrackTimelineSlots = getTrackTimelineSlots;
    window.inferMusicalBindingsForTrack = inferMusicalBindingsForTrack;
    window.syncEditorsFromTimelineSlots = syncEditorsFromTimelineSlots;
    window.rebindTimelineSlotsFromEditors = rebindTimelineSlotsFromEditors;
    window.refreshTrackTimelineMusicalSlots = refreshTrackTimelineMusicalSlots;
    window.swapTimelineSlotsAtIndices = swapTimelineSlotsAtIndices;
    window.swapSelectedTimelineSlots = swapSelectedTimelineSlots;
    window.rebuildAllTrackTimelineSlots = rebuildAllTrackTimelineSlots;
    window.invalidateTrackTimelineSlotsReadCache = invalidateTrackTimelineSlotsReadCache;
    window.relayoutTrackFromTimelineSlots = relayoutTrackFromTimelineSlots;
    window.relayoutAllTracksFromTimelineSlots = relayoutAllTracksFromTimelineSlots;
    window.swapUnitIdentityKey = swapUnitIdentityKey;
    window.cloneMusicalBinding = cloneMusicalBinding;
    window.resolveTimelineSlotIndexForSelection = resolveTimelineSlotIndexForSelection;
    window.resolveSwapUnitMusicalBinding = resolveSwapUnitMusicalBinding;
    window.formatSwapUnitStoredMusicalMetaText = formatSwapUnitStoredMusicalMetaText;
    window.timelineSlotsPersistSlice = timelineSlotsPersistSlice;
    window.restoreTimelineSlotsForTrack = restoreTimelineSlotsForTrack;
    window.persistedTimelineSlotsAreUsable = persistedTimelineSlotsAreUsable;
    window.isTimelineSlotRegionSwapEnabled = isTimelineSlotRegionSwapEnabled;
    window.planRegionHistorySwapAnimation = planRegionHistorySwapAnimation;
    window.planRegionHistorySwapAnimationFromHint = planRegionHistorySwapAnimationFromHint;
    window.regionSwapHistoryAnimHintMatchesTarget = regionSwapHistoryAnimHintMatchesTarget;
    window.cloneRegionSwapHistoryAnimHint = cloneRegionSwapHistoryAnimHint;
    window.clearRegionSwapHistoryAnimHint = clearRegionSwapHistoryAnimHint;
    window.regionSwapHistoryAnimHint = null;
    window.useTimelineSlotRegionSwap =
        typeof window.useTimelineSlotRegionSwap === 'boolean'
            ? window.useTimelineSlotRegionSwap
            : true;
})();

