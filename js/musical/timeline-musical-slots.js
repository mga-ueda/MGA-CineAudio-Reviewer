/**
 * timeline-musical-slots.js — SwapUnit / MusicalSlot モデル（Rehearsal モードの根本レイアウト）
 *
 * マーカー統合フェーズ（docs/region-swap-engine-phases.txt）:
 *   Phase 1 — finalize でマーカー再計算を一本化（本ファイル）
 *   Phase 2 — planSlotPairSwap / applySlotSwapPlan（meter 計画: musical-swap-planner.js）
 *   Phase 3 — 回帰 invariant チェック
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Transport Swap — 唯一の真実（AI / 将来の修正者向け）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ケースバイケースの分岐を足さない。不具合は「真実」からの乖離として直す。
 *
 *   真実: transport mark-draw span ≡ ripple 後の postCounts[rehearsalSlotIndex]
 *
 *   非対称ペア配置: applyTransportSwapPairBarCountDestSpans(slotA, slotB, nextCounts, rehearsalIdxA, rehearsalIdxB)
 *     → applySlotTimelineFromCountsRange のみ。preSwap 座標・label 別経路は使わない。
 *   非ペア: syncSlotsFromMarkDrawRanges
 *   計画: musical-swap-planner.js の planMusicalSlotPairSwap / nextCounts
 *
 *   対称 transport-anchored のみ別経路（counts 不変 → bounds 交換）。
 *   これ以上の「第 3 の配置モード」を増やさないこと。
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
                    if (m.rehearsalSlotIndex < 0) m.rehearsalSlotIndex = idx;
                }
                return m;
            }
        }
        return null;
    }

    /** 誤結合のみ分離 — 隣接セグメントが別 Rehearsal 枠にまたがる場合 */
    function splitIndicesIfCrossRehearsalJoin(track, indices) {
        if (!indices || indices.length <= 1) return [indices];
        if (typeof window.rehearsalSpecCycleSlotForSegment !== 'function') return [indices];
        let slot = null;
        for (let k = 0; k < indices.length; k++) {
            const si = indices[k] | 0;
            const cur = window.rehearsalSpecCycleSlotForSegment(track, si);
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
            if ((m.rehearsalBarCount | 0) > 0) {
                valid++;
            }
        }
        return audio > 0 && valid >= Math.max(1, Math.ceil(audio * 0.75));
    }

    function countAudioTimelineSlots(slots) {
        if (!Array.isArray(slots) || !slots.length) return 0;
        let audio = 0;
        for (let i = 0; i < slots.length; i++) {
            const s = slots[i];
            if (s && s.kind !== 'silent') audio++;
        }
        return audio;
    }

    /** segmentRefs 付きの完全 slot のみ fast path / undo 復元に使う（persist slice は refs なし） */
    function persistedTimelineSlotsHaveSegmentRefs(slots) {
        if (!Array.isArray(slots) || !slots.length) return false;
        let audio = 0;
        for (let i = 0; i < slots.length; i++) {
            const s = slots[i];
            if (!s || s.kind === 'silent') continue;
            audio++;
            if (!s.segmentRefs || !s.segmentRefs.length) return false;
        }
        return audio > 0;
    }

    function resolveUsablePersistedTimelineSlots(track) {
        if (typeof window.getPlaybackRegionsState !== 'function') return null;
        const state = window.getPlaybackRegionsState(track);
        const persisted =
            state && Array.isArray(state.timelineSlots) ? state.timelineSlots : null;
        if (!persistedTimelineSlotsAreUsable(persisted)) return null;
        if (!persistedTimelineSlotsHaveSegmentRefs(persisted)) return null;
        if (typeof window.getTrackSegments !== 'function') return persisted.map(cloneTimelineSlot);
        const segLen = window.getTrackSegments(track).length;
        if (!(segLen > 0) || countAudioTimelineSlots(persisted) !== segLen) return null;
        return persisted.map(cloneTimelineSlot);
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

        const persistedAudio = [];
        for (let pi = 0; pi < persisted.length; pi++) {
            const row = persisted[pi];
            if (row && row.kind !== 'silent') persistedAudio.push(row);
        }
        let audioBuiltOrdinal = 0;

        window.musicalSlotDiagLogPersistCacheMerge(track, units, persisted, true);

        for (let i = 0; i < units.length; i++) {
            const built = units[i];
            const builtKey = swapUnitIdentityKey(built);
            let p = byIdentity.get(builtKey);
            if (!p && built.segmentRefs && built.segmentRefs.length === 1) {
                const leader = built.segmentRefs[0].segmentIndex | 0;
                p = byLeader.get(segmentLeaderPersistedIdentity(leader));
            }
            if (!p && built.kind !== 'silent') {
                p = persistedAudio[audioBuiltOrdinal] || null;
            }
            if (built.kind !== 'silent') {
                audioBuiltOrdinal++;
            }
            if (built.kind === 'silent') {
                if (
                    !p ||
                    p.kind !== 'silent' ||
                    (p.silentGapIndex | 0) !== (built.silentGapIndex | 0)
                ) {
                    continue;
                }
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
            rehearsalBarCount: m.rehearsalBarCount | 0,
            meterBarStart: m.meterBarStart | 0,
            rehearsalSlotIndex: m.rehearsalSlotIndex | 0,
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

    function rehearsalRangesFromCounts(counts) {
        const settings = getMeterSettings();
        const master = masterDurationSec();
        if (
            !settings ||
            !settings.meterSpec ||
            !counts ||
            !counts.length ||
            !(master > 0) ||
            typeof window.collectRehearsalGroupRangesFromBarCounts !== 'function'
        ) {
            return [];
        }
        return window.collectRehearsalGroupRangesFromBarCounts(
            settings.meterSpec,
            master,
            counts,
        );
    }

    /** transport 上の startSec から barCount 分の終端 sec（非対称 swap の slot 終端用） */
    function transportEndSecForBarSpanAtStart(startSec, barCount) {
        const settings = getMeterSettings();
        const master = masterDurationSec();
        const bars = barCount | 0;
        if (
            !settings ||
            !settings.meterSpec ||
            !(master > 0) ||
            !(bars > 0) ||
            !Number.isFinite(startSec) ||
            typeof window.barIndexForBoundarySec !== 'function'
        ) {
            return NaN;
        }
        const boundaries =
            typeof window.collectPlaybackAlignedBarBoundarySecs === 'function'
                ? window.collectPlaybackAlignedBarBoundarySecs(settings.meterSpec, master)
                : typeof window.collectMeterBarBoundariesForRegionSwap === 'function'
                  ? window.collectMeterBarBoundariesForRegionSwap(settings.meterSpec, master)
                  : null;
        if (!boundaries || boundaries.length < 2) return NaN;
        const barStart = window.barIndexForBoundarySec(startSec, boundaries);
        const barEnd = (barStart | 0) + bars;
        if (barEnd < boundaries.length) return boundaries[barEnd];
        return master;
    }

    function slotStartSecFromCounts(counts, slotIndex) {
        if (typeof window.previewRehearsalSlotStartSecFromCounts === 'function') {
            const s = window.previewRehearsalSlotStartSecFromCounts(counts, slotIndex);
            if (s != null) return s + segmentBoundaryEps() * 2;
        }
        const ranges = rehearsalRangesFromCounts(counts);
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

    /** SwapUnit 列と同じ長さの小節数配列（transport mark-draw span） */
    function resolveSlotLevelBarCountsForSwap(slots, specCounts, trackOpt) {
        if (!slots || !slots.length) return [];
        const resolve =
            typeof window.resolveSwapBarCountForSlot === 'function'
                ? window.resolveSwapBarCountForSlot
                : null;
        if (resolve) {
            return slots.map((s) => resolve(s));
        }
        const spec = Array.isArray(specCounts) ? specCounts : [];
        return slots.map((s) => resolveSwapUnitBarCount(s, spec, trackOpt));
    }

    /** rehearsalSlotIndex + 展開 counts から meter 入れ替え用小節先頭を求める（stored meterBarStart の陳腐化対策） */
    function meterBarStartFromSlotCounts(slot, counts) {
        if (!slot || !slot.musical || !counts || !counts.length) {
            return slot && slot.musical ? slot.musical.meterBarStart | 0 : 0;
        }
        const idx = slot.musical.rehearsalSlotIndex | 0;
        if (idx < 0 || idx >= counts.length) return slot.musical.meterBarStart | 0;
        let start = 0;
        for (let c = 0; c < idx; c++) start += counts[c] | 0;
        return start;
    }

    function buildSwapMeterBarPlan(slotA, slotB, counts) {
        if (typeof window.buildSwapMeterBarPlanFromTransport !== 'function') {
            return null;
        }
        const plan = window.buildSwapMeterBarPlanFromTransport(slotA, slotB, counts);
        return plan && plan.ok !== false ? plan : null;
    }

    function applySwapMeterBarPlanIfAny(plan, slotIndexA, slotIndexB, slotCounts, skipSessionPersist, partial) {
        const opts = {
            skipSessionPersist: !!skipSessionPersist,
            rawStartA: plan && plan.rawStartA,
            rawStartB: plan && plan.rawStartB,
            markSecs: plan && plan.markSecs,
        };
        if (typeof window.musicalSlotDiagLog === 'function') {
            window.musicalSlotDiagLog('swap/meter-plan', {
                partial: !!partial,
                path:
                    partial &&
                    plan &&
                    typeof window.swapTempoSignatureForBarRanges === 'function'
                        ? 'bar-ranges-transport'
                        : !partial &&
                            plan &&
                            typeof window.swapTempoSignatureForBarRanges === 'function'
                          ? 'bar-ranges'
                          : 'none',
                slotIndexA: slotIndexA,
                slotIndexB: slotIndexB,
                slotCounts: slotCounts ? slotCounts.slice() : [],
                transportSpanA: plan && plan.transportSpanA ? plan.transportSpanA : null,
                transportSpanB: plan && plan.transportSpanB ? plan.transportSpanB : null,
                scoreSpanA: plan && plan.scoreSpanA ? plan.scoreSpanA : null,
                scoreSpanB: plan && plan.scoreSpanB ? plan.scoreSpanB : null,
                coordMismatch: !!(plan && plan.coordMismatch),
                plan: plan,
            });
        }
        if (
            partial &&
            plan &&
            typeof window.swapTempoSignatureForBarRanges === 'function'
        ) {
            const ok = window.swapTempoSignatureForBarRanges(
                plan.rawStartA != null ? plan.rawStartA : plan.startA,
                plan.countA,
                plan.rawStartB != null ? plan.rawStartB : plan.startB,
                plan.countB,
                opts,
            );
            if (typeof window.musicalSlotDiagLog === 'function') {
                window.musicalSlotDiagLog('swap/meter-plan/result', {
                    path: 'bar-ranges',
                    ok: !!ok,
                });
            }
            return;
        }
        if (!plan || typeof window.swapTempoSignatureForBarRanges !== 'function') {
            if (typeof window.musicalSlotDiagLog === 'function') {
                window.musicalSlotDiagLog('swap/meter-plan/result', {
                    path: 'none',
                    ok: false,
                    reason: !plan ? 'no-plan' : 'no-bar-ranges-fn',
                });
            }
            return;
        }
        const ok = window.swapTempoSignatureForBarRanges(
            plan.startA,
            plan.countA,
            plan.startB,
            plan.countB,
            opts,
        );
        if (typeof window.musicalSlotDiagLog === 'function') {
            window.musicalSlotDiagLog('swap/meter-plan/result', {
                path: 'bar-ranges',
                ok: !!ok,
            });
        }
    }

    function swapSlotMusicalMetadataPair(slotA, slotB, opt) {
        if (!slotA || !slotB) return;
        if (!slotA.musical) slotA.musical = {};
        if (!slotB.musical) slotB.musical = {};
        const partial = !!(opt && opt.partial);
        const keys = partial
            ? ['rehearsalSlotIndex', 'rehearsalLabel']
            : [
                  'rehearsalSlotIndex',
                  'rehearsalBarCount',
                  'contentBarCount',
                  'meterBarStart',
                  'rehearsalLabel',
              ];
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            const tmp = slotA.musical[k];
            slotA.musical[k] = slotB.musical[k];
            slotB.musical[k] = tmp;
        }
    }

    function recomputeSlotMeterBarStart(slot, counts) {
        if (!slot || !slot.musical) return;
        slot.musical.meterBarStart = meterBarStartFromSlotCounts(slot, counts);
    }

    function swapPartialSlotTimelinePair(slotA, slotB) {
        if (!slotA || !slotB) return;
        const startA = slotA.timelineStartSec;
        const endA = slotA.timelineEndSec;
        const startB = slotB.timelineStartSec;
        const endB = slotB.timelineEndSec;
        slotA.timelineStartSec = startB;
        slotA.timelineEndSec = endB;
        slotB.timelineStartSec = startA;
        slotB.timelineEndSec = endA;
    }

    function swapSlotTimelineBoundsPair(slotA, slotB) {
        if (!slotA || !slotB) return;
        const tmpStart = slotA.timelineStartSec;
        const tmpEnd = slotA.timelineEndSec;
        slotA.timelineStartSec = slotB.timelineStartSec;
        slotA.timelineEndSec = slotB.timelineEndSec;
        slotB.timelineStartSec = tmpStart;
        slotB.timelineEndSec = tmpEnd;
    }

    /** segment コピー上の in/out から SwapUnit の timeline 境界を同期 */
    function syncSlotTimelineBoundsFromSegmentCopies(track, slots, segments, opt) {
        if (!slots || !segments || !segments.length) return slots;
        const preserve = new Set();
        if (opt && Array.isArray(opt.preserveSlotIndices)) {
            for (let pi = 0; pi < opt.preserveSlotIndices.length; pi++) {
                preserve.add(opt.preserveSlotIndices[pi] | 0);
            }
        }
        for (let i = 0; i < slots.length; i++) {
            if (preserve.has(i)) continue;
            const slot = slots[i];
            if (!slot || slot.kind === 'silent') continue;
            if (
                track &&
                typeof window.isHeadPadAnchoredSwapSlot === 'function' &&
                window.isHeadPadAnchoredSwapSlot(track, slot, segments)
            ) {
                continue;
            }
            const refs = slot.segmentRefs;
            if (!refs || !refs.length) continue;
            const indices = refs
                .map((r) => r.segmentIndex | 0)
                .filter((si) => si >= 0 && si < segments.length)
                .sort((a, b) => a - b);
            if (!indices.length) continue;
            const leader = indices[0];
            const tail = indices[indices.length - 1];
            const leadSeg = segments[leader];
            const tailSeg = segments[tail];
            if (!leadSeg || !tailSeg) continue;
            const inSec =
                typeof window.segmentCopyRegionIn === 'function'
                    ? window.segmentCopyRegionIn(leadSeg)
                    : NaN;
            const outSec =
                typeof window.segmentCopyRegionOut === 'function'
                    ? window.segmentCopyRegionOut(tailSeg)
                    : NaN;
            if (Number.isFinite(inSec)) slot.timelineStartSec = inSec;
            if (Number.isFinite(outSec)) slot.timelineEndSec = outSec;
        }
        return slots;
    }

    /** SwapUnit の入れ替え用小節数 — SwapPlanner（transport mark-draw span）へ委譲 */
    function resolveSwapUnitBarCount(slot, countsOpt, trackOpt) {
        if (typeof window.resolveSwapBarCountForSlot === 'function') {
            return window.resolveSwapBarCountForSlot(slot);
        }
        if (!slot || !slot.musical) return 0;
        const m = slot.musical;
        if (slot.kind === 'silent') {
            const rehearsalBars = m.rehearsalBarCount | 0;
            if (rehearsalBars > 0) return rehearsalBars;
            const counts =
                countsOpt && countsOpt.length
                    ? countsOpt
                    : typeof window.getExpandedRehearsalGroupBarCountsSnapshot === 'function'
                      ? window.getExpandedRehearsalGroupBarCountsSnapshot()
                      : [];
            const idx = m.rehearsalSlotIndex | 0;
            if (idx >= 0 && idx < counts.length) return counts[idx] | 0;
            return 0;
        }
        return m.contentBarCount | 0 || m.rehearsalBarCount | 0 || 0;
    }

    function getSilentGapForSlot(track, slot) {
        if (!slot || slot.kind !== 'silent') return null;
        if (typeof window.collectTrackSilentGaps !== 'function') return null;
        const gaps = window.collectTrackSilentGaps(track);
        const idx = slot.silentGapIndex | 0;
        return idx >= 0 && idx < gaps.length ? gaps[idx] : null;
    }

    /** 同一タイムライン位置の無音 SwapUnit に隣接する audio SwapUnit（並びは silent → audio） */
    function findPairedAudioSlotIndexForSilent(slots, silentIdx) {
        const silent = slots[silentIdx | 0];
        if (!silent || silent.kind !== 'silent') return -1;
        const start = slotTimelineStartSec(silent);
        const eps = segmentBoundaryEps();
        if (silentIdx + 1 < slots.length) {
            const next = slots[silentIdx + 1];
            if (
                next.kind !== 'silent' &&
                next.segmentRefs &&
                next.segmentRefs.length &&
                Math.abs(slotTimelineStartSec(next) - start) <= eps
            ) {
                return silentIdx + 1;
            }
        }
        for (let i = 0; i < slots.length; i++) {
            if (i === silentIdx) continue;
            const s = slots[i];
            if (
                s.kind !== 'silent' &&
                s.segmentRefs &&
                s.segmentRefs.length &&
                Math.abs(slotTimelineStartSec(s) - start) <= eps
            ) {
                return i;
            }
        }
        return -1;
    }

    /** 無音 gap index → 同一 Rehearsal ブロックの audio SwapUnit */
    function findPairedAudioSlotIndexForSilentGap(track, slots, gapIndex) {
        const gapIdx = gapIndex | 0;
        if (!slots || !slots.length || gapIdx < 0) return -1;

        const silentIdx = slots.findIndex(
            (s) => s.kind === 'silent' && (s.silentGapIndex | 0) === gapIdx,
        );

        if (typeof window.collectTrackSilentGaps === 'function') {
            const gaps = window.collectTrackSilentGaps(track);
            const gap = gapIdx < gaps.length ? gaps[gapIdx] : null;
            if (gap && Number.isFinite(gap.rehearsalIndex) && gap.rehearsalIndex >= 0) {
                const ri = gap.rehearsalIndex | 0;
                for (let i = 0; i < slots.length; i++) {
                    const s = slots[i];
                    if (s.kind === 'silent' || !s.musical || !s.segmentRefs || !s.segmentRefs.length) {
                        continue;
                    }
                    if ((s.musical.rehearsalSlotIndex | 0) === ri) {
                        return i;
                    }
                }
            }
            if (gap) {
                const eps = segmentBoundaryEps();
                const leaders = [];
                if (gap.beforeSegmentIndex >= 0) leaders.push(gap.beforeSegmentIndex | 0);
                if (gap.afterSegmentIndex >= 0) leaders.push(gap.afterSegmentIndex | 0);
                for (let li = 0; li < leaders.length; li++) {
                    const leader = leaders[li];
                    const idx = slots.findIndex(
                        (s) =>
                            s.kind !== 'silent' &&
                            s.segmentRefs &&
                            s.segmentRefs.some((r) => (r.segmentIndex | 0) === leader),
                    );
                    if (idx >= 0) return idx;
                }
                if (Number.isFinite(gap.startSec) && Number.isFinite(gap.endSec)) {
                    const mid = (gap.startSec + gap.endSec) * 0.5;
                    let bestIdx = -1;
                    let bestOverlap = -1;
                    for (let i = 0; i < slots.length; i++) {
                        const s = slots[i];
                        if (s.kind === 'silent' || !s.segmentRefs || !s.segmentRefs.length) continue;
                        const leader = s.segmentRefs[0].segmentIndex | 0;
                        const segIn =
                            typeof window.getSegmentRegionTimelineIn === 'function'
                                ? window.getSegmentRegionTimelineIn(track, leader)
                                : slotTimelineStartSec(s);
                        const segOut =
                            typeof window.getSegmentRegionTimelineOut === 'function'
                                ? window.getSegmentRegionTimelineOut(track, leader)
                                : s.timelineEndSec;
                        if (!Number.isFinite(segIn) || !Number.isFinite(segOut)) continue;
                        const lo = Math.max(gap.startSec, segIn);
                        const hi = Math.min(gap.endSec, segOut);
                        const overlap = hi - lo;
                        if (overlap > bestOverlap) {
                            bestOverlap = overlap;
                            bestIdx = i;
                        }
                        if (mid >= segIn - eps && mid < segOut + eps && bestIdx < 0) {
                            bestIdx = i;
                        }
                    }
                    if (bestIdx >= 0) return bestIdx;
                }
            }
        }

        if (silentIdx >= 0) {
            return findPairedAudioSlotIndexForSilent(slots, silentIdx);
        }
        return -1;
    }

    function syncSilentMusicalFromPairedAudio(slots, silentIdx, audioIdx) {
        const silent = slots[silentIdx | 0];
        const audio = slots[audioIdx | 0];
        if (!silent || !audio || silent.kind !== 'silent' || !silent.musical || !audio.musical) {
            return;
        }
        silent.musical.rehearsalSlotIndex = audio.musical.rehearsalSlotIndex | 0;
        silent.musical.rehearsalBarCount = audio.musical.rehearsalBarCount | 0;
        silent.musical.meterBarStart = audio.musical.meterBarStart | 0;
    }

    function syncAllSilentMusicalFromPairedAudio(slots, track) {
        if (!slots || !slots.length) return;
        for (let i = 0; i < slots.length; i++) {
            if (slots[i].kind !== 'silent') continue;
            const gapIdx = slots[i].silentGapIndex | 0;
            const audioIdx =
                track && typeof findPairedAudioSlotIndexForSilentGap === 'function'
                    ? findPairedAudioSlotIndexForSilentGap(track, slots, gapIdx)
                    : findPairedAudioSlotIndexForSilent(slots, i);
            if (audioIdx >= 0) syncSilentMusicalFromPairedAudio(slots, i, audioIdx);
        }
    }

    /**
     * 入れ替え選択を Rehearsal ブロック代表の audio SwapUnit 列 index へ正規化。
     * 無音区間選択 → ペア audio。無音+リージョン混在 → 各ブロックの audio 同士。
     */
    function resolveSwapSelectionAudioSlotIndex(track, entry, slots) {
        if (!entry || !slots || !slots.length) return -1;
        if (entry.segmentIndex >= 0) {
            const idx = resolveTimelineSlotIndexForSelection(track, entry, slots);
            if (idx < 0) return -1;
            if (slots[idx].kind === 'silent') {
                return findPairedAudioSlotIndexForSilent(slots, idx);
            }
            return idx;
        }
        if ((entry.silentGapIndex | 0) >= 0) {
            return findPairedAudioSlotIndexForSilentGap(
                track,
                slots,
                entry.silentGapIndex | 0,
            );
        }
        return -1;
    }

    function resolveSwapSelectionAudioSlotPair(track, entryA, entryB, slots) {
        const idxA = resolveSwapSelectionAudioSlotIndex(track, entryA, slots);
        const idxB = resolveSwapSelectionAudioSlotIndex(track, entryB, slots);
        if (idxA < 0 || idxB < 0) {
            return { ok: false, reason: 'paired audio unresolved' };
        }
        if (idxA === idxB) {
            return { ok: true, noop: true, idxA, idxB };
        }
        const slotA = slots[idxA];
        const slotB = slots[idxB];
        const eps = segmentBoundaryEps();
        if (
            slotA &&
            slotB &&
            Math.abs(slotTimelineStartSec(slotA) - slotTimelineStartSec(slotB)) <= eps
        ) {
            return { ok: false, reason: 'same rehearsal block' };
        }
        return { ok: true, idxA, idxB };
    }

    /** 入れ替え後の rehearsalSlotIndex（A=先選択側の SwapUnit） */
    function assignPairSwapDestinations(rehearsalIdxA, rehearsalIdxB, barA, barB) {
        const ba = barA | 0;
        const bb = barB | 0;
        if (ba === bb) {
            return { destA: rehearsalIdxB | 0, destB: rehearsalIdxA | 0 };
        }
        const idxShort = ba <= bb ? rehearsalIdxA | 0 : rehearsalIdxB | 0;
        const destLong = idxShort;
        const destShort = idxShort + 2;
        if (ba <= bb) {
            return { destA: destShort, destB: destLong };
        }
        return { destA: destLong, destB: destShort };
    }

    /**
     * 同一 Rehearsal スロット内の部分無音↔リージョン — SwapPlanner へ委譲
     */
    function tryResolveSilentAudioPartialPlan(track, silentSlot, audioSlot, counts) {
        if (typeof window.tryResolveSilentAudioPartialPlanFromTransport !== 'function') {
            return null;
        }
        return window.tryResolveSilentAudioPartialPlanFromTransport({
            track: track,
            silentSlot: silentSlot,
            audioSlot: audioSlot,
            specCounts: counts,
            gap: getSilentGapForSlot(track, silentSlot),
        });
    }

    /**
     * counts 更新後 — 各 SwapUnit の timeline を rehearsalSlotIndex / 無音 gap から再配置。
     * startOverrides: { [slot列index]: timelineStartSec }（部分無音などの例外）
     * opt.preservePartialPlacement — 入れ替え対象外の部分配置リージョンは In を維持
     */
    function refreshSlotTimelineBoundsFromRehearsalCounts(track, slots, counts, startOverrides, opt) {
        const ranges = rehearsalRangesFromCounts(counts);
        const gaps =
            typeof window.collectTrackSilentGaps === 'function'
                ? window.collectTrackSilentGaps(track)
                : [];
        const o = startOverrides && typeof startOverrides === 'object' ? startOverrides : {};
        const options = opt && typeof opt === 'object' ? opt : {};
        const preservePartial = !!options.preservePartialPlacement;
        const eps = segmentBoundaryEps();

        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            const idx =
                slot.musical && slot.musical.rehearsalSlotIndex >= 0
                    ? slot.musical.rehearsalSlotIndex | 0
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
                const r = ranges[idx];
                if (preservePartial && slot.segmentRefs && slot.segmentRefs.length) {
                    const leader = slot.segmentRefs[0].segmentIndex | 0;
                    const curIn =
                        typeof window.getSegmentRegionTimelineIn === 'function'
                            ? window.getSegmentRegionTimelineIn(track, leader)
                            : slot.timelineStartSec;
                    if (
                        Number.isFinite(curIn) &&
                        curIn > r.startSec + eps &&
                        curIn < r.endSec - eps
                    ) {
                        slot.timelineStartSec = curIn;
                        slot.timelineEndSec = r.endSec;
                        continue;
                    }
                }
                slot.timelineStartSec = r.startSec;
                slot.timelineEndSec = r.endSec;
            }
        }
        return slots;
    }

    /** 入れ替え前 — 各 slot が載っているリハーサル mark label（音源の所属） */
    function captureSlotContentMarkLabels(track, slots) {
        const labels = [];
        if (!slots || !slots.length) return labels;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return labels;
        if (typeof readMusicalGridFromInputs === 'function') readMusicalGridFromInputs();
        const settings =
            typeof window.musicalGridDrawSettings === 'function'
                ? window.musicalGridDrawSettings()
                : null;
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        if (!meterSpec || typeof window.collectRehearsalMarkDrawRanges !== 'function') {
            return labels;
        }
        const drawRanges = window.collectRehearsalMarkDrawRanges(master, meterSpec);
        const eps = segmentBoundaryEps();
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (!slot || slot.kind === 'silent') continue;
            const sec = slot.timelineStartSec;
            let found = '';
            if (Number.isFinite(sec)) {
                for (let ri = 0; ri < drawRanges.length; ri++) {
                    const r = drawRanges[ri];
                    if (!r) continue;
                    if (sec >= r.startSec - eps && sec < r.endSec - eps) {
                        if (!r.fromRehearsalEvent) {
                            found = '';
                        } else {
                            found = String(r.label == null ? '' : r.label).trim();
                        }
                        break;
                    }
                }
            }
            if (!found && slot.musical && slot.musical.rehearsalLabel) {
                found = String(slot.musical.rehearsalLabel).trim();
            }
            labels[i] = found;
        }
        return labels;
    }

    /** スワップ前 — segmentIndex → 音源所属 rehearsal label（mark-draw 位置基準） */
    function captureSegmentRehearsalLabelMap(slots) {
        const map = {};
        if (!slots || !slots.length) return map;
        for (let si = 0; si < slots.length; si++) {
            const slot = slots[si];
            if (!slot || slot.kind === 'silent' || !slot.segmentRefs || !slot.segmentRefs.length) {
                continue;
            }
            const label = slotRehearsalMarkLabelForTransportSync(slot);
            if (!label) continue;
            const refs = slot.segmentRefs;
            for (let ri = 0; ri < refs.length; ri++) {
                map[refs[ri].segmentIndex | 0] = label;
            }
        }
        return map;
    }

    /**
     * 入れ替え後 — 各 slot の rehearsalLabel を pre-swap のコンテンツ identity で復元。
     * label の小節数は不変（A=2, C=6 等）。配置先は ripple 後の自 label mark-draw。
     */
    function applySwappedPairRehearsalLabelsFromPreSwap(slotA, slotB, preSwapMap) {
        if (!slotA || !slotB || !preSwapMap || typeof preSwapMap !== 'object') return;
        if (
            !slotA.segmentRefs ||
            !slotA.segmentRefs.length ||
            !slotB.segmentRefs ||
            !slotB.segmentRefs.length
        ) {
            return;
        }
        const segA = slotA.segmentRefs[0].segmentIndex | 0;
        const segB = slotB.segmentRefs[0].segmentIndex | 0;
        const preA = preSwapMap[segA];
        const preB = preSwapMap[segB];
        if (!slotA.musical) slotA.musical = {};
        if (!slotB.musical) slotB.musical = {};
        if (preA) {
            slotA.musical.rehearsalLabel =
                typeof window.normalizeRehearsalMarkLabel === 'function'
                    ? window.normalizeRehearsalMarkLabel(preA)
                    : String(preA).trim();
        }
        if (preB) {
            slotB.musical.rehearsalLabel =
                typeof window.normalizeRehearsalMarkLabel === 'function'
                    ? window.normalizeRehearsalMarkLabel(preB)
                    : String(preB).trim();
        }
    }

    function applySegmentRehearsalLabelMapToSlots(slots, segmentLabelMap) {
        if (!slots || !segmentLabelMap || typeof segmentLabelMap !== 'object') return;
        for (let si = 0; si < slots.length; si++) {
            const slot = slots[si];
            if (!slot || slot.kind === 'silent' || !slot.segmentRefs || !slot.segmentRefs.length) {
                continue;
            }
            const segIdx = slot.segmentRefs[0].segmentIndex | 0;
            const label = segmentLabelMap[segIdx];
            if (!label) continue;
            if (!slot.musical) slot.musical = {};
            slot.musical.rehearsalLabel = label;
        }
    }

    /**
     * 非対称 finalize 前 — 入れ替え対象外 slot に pre-swap label を補完（swap 済みは維持）。
     */
    function ensureSlotRehearsalLabelsForMarkSync(slots, preSwapLabelMap, swappedSegmentIndices) {
        if (!slots || !preSwapLabelMap || typeof preSwapLabelMap !== 'object') return;
        const swapped = new Set();
        if (Array.isArray(swappedSegmentIndices)) {
            for (let i = 0; i < swappedSegmentIndices.length; i++) {
                swapped.add(swappedSegmentIndices[i] | 0);
            }
        }
        for (let si = 0; si < slots.length; si++) {
            const slot = slots[si];
            if (!slot || slot.kind === 'silent' || !slot.segmentRefs || !slot.segmentRefs.length) {
                continue;
            }
            if (!slot.musical) slot.musical = {};
            if (slot.musical.rehearsalLabel) {
                const existing = String(slot.musical.rehearsalLabel).trim();
                if (existing) continue;
            }
            const segIdx = slot.segmentRefs[0].segmentIndex | 0;
            if (swapped.has(segIdx)) continue;
            const fromPre = preSwapLabelMap[segIdx];
            if (!fromPre) continue;
            slot.musical.rehearsalLabel = fromPre;
        }
    }

    function collectSwappedSegmentIndicesFromSlots(slots, slotIndices) {
        const out = [];
        if (!slots || !Array.isArray(slotIndices)) return out;
        for (let i = 0; i < slotIndices.length; i++) {
            const slot = slots[slotIndices[i] | 0];
            if (!slot || !slot.segmentRefs) continue;
            for (let ri = 0; ri < slot.segmentRefs.length; ri++) {
                out.push(slot.segmentRefs[ri].segmentIndex | 0);
            }
        }
        return out;
    }

    /** タイムライン順の rehearsalSlotIndex が単調 — 非対称 swap 後の scrambled 状態を検出 */
    function slotsTimelineMusicalOrderIsCanonical(slots) {
        if (!slots || !slots.length) return true;
        const audio = [];
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (!slot || slot.kind === 'silent') continue;
            if (!Number.isFinite(slot.timelineStartSec)) continue;
            audio.push(slot);
        }
        if (audio.length < 2) return true;
        audio.sort((a, b) => a.timelineStartSec - b.timelineStartSec);
        let lastIdx = -1;
        let lastSeg = -1;
        for (let i = 0; i < audio.length; i++) {
            const slot = audio[i];
            const idx =
                slot.musical && slot.musical.rehearsalSlotIndex >= 0
                    ? slot.musical.rehearsalSlotIndex | 0
                    : -1;
            if (idx < 0) continue;
            if (idx < lastIdx) return false;
            lastIdx = idx;
            if (slot.segmentRefs && slot.segmentRefs.length) {
                let leader = slot.segmentRefs[0].segmentIndex | 0;
                for (let ri = 1; ri < slot.segmentRefs.length; ri++) {
                    leader = Math.min(leader, slot.segmentRefs[ri].segmentIndex | 0);
                }
                if (leader >= 0 && leader < lastSeg) return false;
                if (leader >= 0) lastSeg = leader;
            }
        }
        return true;
    }

    /**
     * recompose 後 — 音源所属 label + 旧 timeline ヒントで draw range に再配置（metadata 入れ替え不要）。
     */
    function repositionSlotsByContentMarkLabel(track, slots, contentLabels, timelineHints) {
        if (!slots || !slots.length) return slots;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return slots;
        if (typeof window.collectRehearsalMarkDrawRanges !== 'function') return slots;

        if (typeof readMusicalGridFromInputs === 'function') readMusicalGridFromInputs();
        const settings =
            typeof window.musicalGridDrawSettings === 'function'
                ? window.musicalGridDrawSettings()
                : null;
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        const drawRanges = window.collectRehearsalMarkDrawRanges(master, meterSpec);
        if (!drawRanges.length) return slots;

        const eps = segmentBoundaryEps();
        const hints =
            Array.isArray(timelineHints) && timelineHints.length === slots.length
                ? timelineHints
                : slots.map((s) => (s ? s.timelineStartSec : null));

        const labeledRanges = [];
        for (let i = 0; i < drawRanges.length; i++) {
            const r = drawRanges[i];
            if (r && r.fromRehearsalEvent) labeledRanges.push(r);
        }

        const gaps =
            typeof window.collectTrackSilentGaps === 'function'
                ? window.collectTrackSilentGaps(track)
                : [];

        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (!slot || slot.kind === 'silent') {
                if (slot && slot.kind === 'silent') {
                    const g = gaps[slot.silentGapIndex | 0];
                    if (g && Number.isFinite(g.startSec) && Number.isFinite(g.endSec)) {
                        slot.timelineStartSec = g.startSec;
                        slot.timelineEndSec = g.endSec;
                    }
                }
                continue;
            }
            const hint = hints[i];
            const contentLabel = contentLabels ? contentLabels[i] : '';
            let placedInUnlabeled = false;
            if (Number.isFinite(hint)) {
                for (let ri = 0; ri < drawRanges.length; ri++) {
                    const r = drawRanges[ri];
                    if (
                        r &&
                        !r.fromRehearsalEvent &&
                        hint >= r.startSec - eps &&
                        hint < r.endSec - eps
                    ) {
                        slot.timelineStartSec = r.startSec;
                        slot.timelineEndSec = r.endSec;
                        placedInUnlabeled = true;
                        break;
                    }
                }
            }
            if (placedInUnlabeled) continue;
            if (!contentLabel) continue;

            let best = null;
            let bestDist = Infinity;
            for (let li = 0; li < labeledRanges.length; li++) {
                const r = labeledRanges[li];
                const rl = String(r.label == null ? '' : r.label).trim();
                if (rl !== contentLabel) continue;
                const dist = Number.isFinite(hint)
                    ? Math.abs(r.startSec - hint)
                    : 0;
                if (dist < bestDist) {
                    bestDist = dist;
                    best = r;
                }
            }
            if (best) {
                slot.timelineStartSec = best.startSec;
                slot.timelineEndSec = best.endSec;
                if (slot.musical) {
                    slot.musical.rehearsalLabel = contentLabel;
                }
            }
        }
        return slots;
    }

    /** リハーサルマーク draw ranges から各 slot の timeline 境界を同期（非対称 recompose 後） */
    function refreshSlotTimelineBoundsFromMarkDrawRanges(track, slots, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const skipSet = new Set();
        if (Array.isArray(o.skipSlotIndices)) {
            for (let si = 0; si < o.skipSlotIndices.length; si++) {
                skipSet.add(o.skipSlotIndices[si] | 0);
            }
        }
        if (!slots || !slots.length) return slots;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return slots;
        if (typeof window.collectRehearsalMarkDrawRanges !== 'function') return slots;

        if (typeof readMusicalGridFromInputs === 'function') readMusicalGridFromInputs();
        const settings =
            typeof window.musicalGridDrawSettings === 'function'
                ? window.musicalGridDrawSettings()
                : null;
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        const drawRanges = window.collectRehearsalMarkDrawRanges(master, meterSpec);
        if (!drawRanges.length) return slots;

        const labeledRanges = [];
        for (let i = 0; i < drawRanges.length; i++) {
            const r = drawRanges[i];
            if (r && r.fromRehearsalEvent) labeledRanges.push(r);
        }

        const gaps =
            typeof window.collectTrackSilentGaps === 'function'
                ? window.collectTrackSilentGaps(track)
                : [];

        function resolveRangeForSlot(slot) {
            const label =
                slot.musical && slot.musical.rehearsalLabel
                    ? String(slot.musical.rehearsalLabel).trim()
                    : '';
            const hintSec = Number.isFinite(slot.timelineStartSec) ? slot.timelineStartSec : null;
            let best = null;
            let bestDist = Infinity;
            for (let i = 0; i < labeledRanges.length; i++) {
                const r = labeledRanges[i];
                if (label && r.label && String(r.label).trim() !== label) continue;
                const dist =
                    hintSec != null && Number.isFinite(r.startSec)
                        ? Math.abs(r.startSec - hintSec)
                        : 0;
                if (dist < bestDist) {
                    bestDist = dist;
                    best = r;
                }
            }
            if (!best && label) {
                const idx =
                    slot.musical && slot.musical.rehearsalSlotIndex >= 0
                        ? slot.musical.rehearsalSlotIndex | 0
                        : -1;
                if (idx >= 0 && idx < labeledRanges.length) best = labeledRanges[idx];
            }
            if (!best && hintSec != null) {
                for (let i = 0; i < labeledRanges.length; i++) {
                    const r = labeledRanges[i];
                    const dist = Math.abs(r.startSec - hintSec);
                    if (dist < bestDist) {
                        bestDist = dist;
                        best = r;
                    }
                }
            }
            return best;
        }

        for (let i = 0; i < slots.length; i++) {
            if (skipSet.has(i)) continue;
            const slot = slots[i];
            if (slot.kind === 'silent') {
                const g = gaps[slot.silentGapIndex | 0];
                if (g && Number.isFinite(g.startSec) && Number.isFinite(g.endSec)) {
                    slot.timelineStartSec = g.startSec;
                    slot.timelineEndSec = g.endSec;
                }
                continue;
            }
            const r = resolveRangeForSlot(slot);
            if (!r || !Number.isFinite(r.startSec) || !Number.isFinite(r.endSec)) continue;
            slot.timelineStartSec = r.startSec;
            slot.timelineEndSec = r.endSec;
        }
        return slots;
    }

    /**
     * 非対称 partial swap の region 配置 — SwapPlanner 単一実行経路（transport-swap）
     */
    function resolveAsymmetricSwapPlacementMode(rehearsalIdxA, rehearsalIdxB, countsLen, barA, barB) {
        if (typeof window.resolveAsymmetricSwapExecutionMode === 'function') {
            return window.resolveAsymmetricSwapExecutionMode({
                rehearsalIdxA: rehearsalIdxA,
                rehearsalIdxB: rehearsalIdxB,
                countsLen: countsLen,
                barA: barA,
                barB: barB,
            });
        }
        return 'transport-swap';
    }

    /** @deprecated 旧 counts-anchored 経路用。非対称 swap は transport-swap 単一経路に統合済み */
    function rippleNonSwapSlotsToCountsRanges(track, slots, counts, skipSlotIndices) {
        if (!slots || !counts || !counts.length) return slots;
        const skip = new Set();
        if (Array.isArray(skipSlotIndices)) {
            for (let si = 0; si < skipSlotIndices.length; si++) {
                skip.add(skipSlotIndices[si] | 0);
            }
        }
        const ranges = rehearsalRangesFromCounts(counts);
        for (let i = 0; i < slots.length; i++) {
            if (skip.has(i)) continue;
            const slot = slots[i];
            if (!slot || !slot.musical) continue;
            if (
                track &&
                typeof window.isHeadPadAnchoredSwapSlot === 'function' &&
                window.isHeadPadAnchoredSwapSlot(track, slot)
            ) {
                continue;
            }
            const idx = slot.musical.rehearsalSlotIndex | 0;
            if (idx < 0 || idx >= ranges.length || !ranges[idx]) continue;
            const r = ranges[idx];
            slot.timelineStartSec = r.startSec;
            slot.timelineEndSec = r.endSec;
        }
        return slots;
    }

    /**
     * 非対称 partial swap 後 — 入れ替え対象外 slot の timeline を live segment 位置で維持。
     * Rehearsal Fill では draw 上のリハーサル数が counts 群数より多いため、counts 区間への ripple は
     * 入れ替え対象外のリハーサルユニットを誤移動させる。
     */
    function preserveNonSwapSlotTimelinesFromLiveSegments(track, slots, skipSlotIndices) {
        if (!slots || !slots.length || typeof window.getTrackSegments !== 'function') {
            return slots;
        }
        const skip = new Set();
        if (Array.isArray(skipSlotIndices)) {
            for (let si = 0; si < skipSlotIndices.length; si++) {
                skip.add(skipSlotIndices[si] | 0);
            }
        }
        const segments = window.getTrackSegments(track);
        for (let i = 0; i < slots.length; i++) {
            if (skip.has(i)) continue;
            const slot = slots[i];
            if (!slot || slot.kind === 'silent') continue;
            if (
                track &&
                typeof window.isHeadPadAnchoredSwapSlot === 'function' &&
                window.isHeadPadAnchoredSwapSlot(track, slot, segments)
            ) {
                continue;
            }
            const refs = slot.segmentRefs;
            if (!refs || !refs.length) continue;
            const indices = refs
                .map((r) => r.segmentIndex | 0)
                .filter((si) => si >= 0 && si < segments.length)
                .sort((a, b) => a - b);
            if (!indices.length) continue;
            const leader = indices[0];
            const tail = indices[indices.length - 1];
            const leadSeg = segments[leader];
            const tailSeg = segments[tail];
            if (!leadSeg || !tailSeg) continue;
            const inSec =
                typeof window.getSegmentRegionTimelineIn === 'function'
                    ? window.getSegmentRegionTimelineIn(track, leader)
                    : typeof window.segmentCopyRegionIn === 'function'
                      ? window.segmentCopyRegionIn(leadSeg)
                      : NaN;
            const outSec =
                typeof window.getSegmentRegionTimelineOut === 'function'
                    ? window.getSegmentRegionTimelineOut(track, tail)
                    : typeof window.segmentCopyRegionOut === 'function'
                      ? window.segmentCopyRegionOut(tailSeg)
                      : NaN;
            if (Number.isFinite(inSec)) slot.timelineStartSec = inSec;
            if (Number.isFinite(outSec)) slot.timelineEndSec = outSec;
        }
        return slots;
    }

    /** transport-swap — slot 位置の draw rehearsal スパンから meter / 小節数を同期 */
    function refreshSlotMeterBarStartFromTransport(slot, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (
            o.preserveBarCounts &&
            typeof window.resolveSwapTransportSpanForSlot === 'function' &&
            slot &&
            slot.musical
        ) {
            const span = window.resolveSwapTransportSpanForSlot(slot);
            if (span && Number.isFinite(span.transportBarStart)) {
                slot.musical.meterBarStart = span.transportBarStart | 0;
                return true;
            }
            return false;
        }
        if (typeof window.syncSlotMusicalMetadataFromTransport === 'function') {
            return window.syncSlotMusicalMetadataFromTransport(slot);
        }
        return false;
    }

    /** 非ペア slot — timeline 位置から meterBarStart のみ同期（content 小節数は維持） */
    function refreshNonPairTransportSwapSlotsMeterFromTimeline(
        slots,
        pairIndices,
        track,
        segments,
    ) {
        const skip = new Set(Array.isArray(pairIndices) ? pairIndices : []);
        for (let i = 0; i < slots.length; i++) {
            if (skip.has(i)) continue;
            const slot = slots[i];
            if (!slot || slot.kind === 'silent') continue;
            if (track && isPickupHeadSlotForTransportSync(track, slot, segments)) {
                continue;
            }
            refreshSlotMeterBarStartFromTransport(slot, { preserveBarCounts: true });
        }
    }

    /** swap 後 — 非ペア slot の timeline 位置から rehearsalSlotIndex / 小節数を同期 */
    function refreshSlotsMusicalTimelineAlignment(slots, counts, skipSlotIndices, track) {
        if (!slots || !counts || !counts.length) return slots;
        const master = masterDurationSec();
        const settings = getMeterSettings();
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        if (!(master > 0) || !meterSpec) return slots;
        const eps = segmentBoundaryEps();
        const skip = new Set(Array.isArray(skipSlotIndices) ? skipSlotIndices : []);
        const ranges = rehearsalRangesFromCounts(counts);
        const segments =
            track && typeof window.getTrackSegments === 'function'
                ? window.getTrackSegments(track)
                : null;

        for (let i = 0; i < slots.length; i++) {
            if (skip.has(i)) continue;
            const slot = slots[i];
            if (!slot || slot.kind === 'silent') continue;
            if (track && isPickupHeadSlotForTransportSync(track, slot, segments)) {
                continue;
            }
            if (
                !Number.isFinite(slot.timelineStartSec) ||
                !Number.isFinite(slot.timelineEndSec)
            ) {
                continue;
            }
            const inferred = resolveRehearsalIndexAtRegionInSec(
                slot.timelineStartSec,
                ranges,
                eps,
                slot.timelineEndSec,
            );
            if (inferred == null || inferred < 0 || inferred >= counts.length) {
                continue;
            }
            const spanBars = transportBarCountForDrawRange(
                { startSec: slot.timelineStartSec, endSec: slot.timelineEndSec },
                master,
                meterSpec,
                eps,
            );
            if (!slot.musical) slot.musical = {};
            slot.musical.rehearsalSlotIndex = inferred | 0;
            const bars = spanBars > 0 ? spanBars : counts[inferred] | 0;
            if (bars > 0) {
                slot.musical.rehearsalBarCount = bars;
                slot.musical.contentBarCount = bars;
            }
            let meterBarStart = 0;
            for (let c = 0; c < inferred; c++) {
                meterBarStart += counts[c] | 0;
            }
            slot.musical.meterBarStart = meterBarStart;
        }
        return slots;
    }

    function slotRehearsalMarkLabelForTransportSync(slot) {
        if (!slot || !slot.musical) return '';
        const normLabel =
            typeof window.normalizeRehearsalMarkLabel === 'function'
                ? window.normalizeRehearsalMarkLabel
                : function (v) {
                      return String(v == null ? '' : v).trim();
                  };
        if (Number.isFinite(slot.timelineStartSec)) {
            const resolveSpan =
                typeof window.resolveTransportMeterSpanForSwapSec === 'function'
                    ? window.resolveTransportMeterSpanForSwapSec
                    : null;
            if (resolveSpan) {
                const eps = segmentBoundaryEps();
                const span = resolveSpan(slot.timelineStartSec, {
                    eps: eps,
                    endSec: slot.timelineEndSec,
                });
                if (span && span.label) {
                    const fromSpan = normLabel(span.label);
                    if (fromSpan) return fromSpan;
                }
            }
        }
        if (slot.musical.rehearsalLabel) {
            const raw = String(slot.musical.rehearsalLabel).trim();
            if (raw) {
                const fromMeta = normLabel(raw);
                if (fromMeta) return fromMeta;
            }
        }
        const idx = slot.musical.rehearsalSlotIndex | 0;
        if (idx >= 0 && typeof window.rehearsalMarkLabelForRehearsalSlotIndex === 'function') {
            const fromIdx = window.rehearsalMarkLabelForRehearsalSlotIndex(idx);
            if (fromIdx) {
                const fromIdxNorm = normLabel(fromIdx);
                if (fromIdxNorm) return fromIdxNorm;
            }
        }
        return '';
    }

    function isPickupHeadSlotForTransportSync(track, slot, segments) {
        if (
            track &&
            typeof window.isHeadPadAnchoredSwapSlot === 'function' &&
            window.isHeadPadAnchoredSwapSlot(track, slot, segments)
        ) {
            return true;
        }
        if (!slot || !slot.musical || !slot.segmentRefs || !slot.segmentRefs.length) {
            return false;
        }
        if ((slot.musical.rehearsalSlotIndex | 0) !== 0) return false;
        if ((slot.segmentRefs[0].segmentIndex | 0) !== 0) return false;
        const bars = slot.musical.contentBarCount | 0;
        return bars > 0 && bars <= 1;
    }

    /** plan 時点の live segment から swap ペアの sourceIn/Out を退避 */
    function capturePreSwapPairSegmentSources(slotA, slotB, segments) {
        if (
            !slotA ||
            !slotB ||
            !slotA.segmentRefs ||
            !slotA.segmentRefs.length ||
            !slotB.segmentRefs ||
            !slotB.segmentRefs.length ||
            !segments
        ) {
            return null;
        }
        const idxA = slotA.segmentRefs[0].segmentIndex | 0;
        const idxB = slotB.segmentRefs[0].segmentIndex | 0;
        const segA = segments[idxA];
        const segB = segments[idxB];
        if (!segA || !segB) return null;
        return {
            a: {
                in: Number(segA.sourceInSec) || 0,
                out: Number(segA.sourceOutSec) || 0,
            },
            b: {
                in: Number(segB.sourceInSec) || 0,
                out: Number(segB.sourceOutSec) || 0,
            },
            regionA: idxA + 1,
            regionB: idxB + 1,
        };
    }

    /** plan 時点の sourceIn/Out を segment コピーへ復元（preview stretch の clip を戻す） */
    function restorePreSwapPairSegmentSources(segments, slotA, slotB, preSwapSources) {
        if (
            !preSwapSources ||
            !preSwapSources.a ||
            !preSwapSources.b ||
            !slotA ||
            !slotB ||
            !slotA.segmentRefs ||
            !slotA.segmentRefs.length ||
            !slotB.segmentRefs ||
            !slotB.segmentRefs.length ||
            !segments
        ) {
            return false;
        }
        const idxA = slotA.segmentRefs[0].segmentIndex | 0;
        const idxB = slotB.segmentRefs[0].segmentIndex | 0;
        const segA = segments[idxA];
        const segB = segments[idxB];
        if (!segA || !segB) return false;
        segA.sourceInSec = Number(preSwapSources.a.in) || 0;
        segA.sourceOutSec = Number(preSwapSources.a.out) || 0;
        segB.sourceInSec = Number(preSwapSources.b.in) || 0;
        segB.sourceOutSec = Number(preSwapSources.b.out) || 0;
        delete segA.regionTimelineOutSec;
        delete segB.regionTimelineOutSec;
        return true;
    }

    /** transport-swap identity 固定 — segment index から plan 時点の source 境界を引く */
    function identitySourceBoundsForSwapSegment(
        segmentIndex,
        slotA,
        slotB,
        preSwapSources,
    ) {
        if (
            !preSwapSources ||
            !preSwapSources.a ||
            !preSwapSources.b ||
            !slotA ||
            !slotB ||
            !slotA.segmentRefs ||
            !slotA.segmentRefs.length ||
            !slotB.segmentRefs ||
            !slotB.segmentRefs.length
        ) {
            return null;
        }
        const idxA = slotA.segmentRefs[0].segmentIndex | 0;
        const idxB = slotB.segmentRefs[0].segmentIndex | 0;
        const segIdx = segmentIndex | 0;
        if (segIdx === idxA) {
            return {
                in: Number(preSwapSources.a.in) || 0,
                out: Number(preSwapSources.a.out) || 0,
            };
        }
        if (segIdx === idxB) {
            return {
                in: Number(preSwapSources.b.in) || 0,
                out: Number(preSwapSources.b.out) || 0,
            };
        }
        return null;
    }

    /**
     * transport-swap — partialRecomposed 時に source identity を固定するか。
     * head pad ↔ A のみ mark-draw 交差配置のため source も交換する。
     * それ以外の非対称（F↔B 等）は各 slot が自 label の mark-draw へ行くため source は固定。
     */
    function shouldPreserveTransportSwapPairSourceIdentity(
        partialRecomposed,
        barA,
        barB,
        headPadSwapPair,
    ) {
        void barA;
        void barB;
        if (!partialRecomposed) return false;
        return !headPadSwapPair;
    }

    /** transport-swap — 入れ替えペアの sourceIn/Out を交換（音源コンテンツ入替） */
    function swapTransportSwapPairSegmentSources(track, segments, slotA, slotB, preSwapSources) {
        if (
            !slotA ||
            !slotB ||
            !slotA.segmentRefs ||
            !slotA.segmentRefs.length ||
            !slotB.segmentRefs ||
            !slotB.segmentRefs.length ||
            !segments
        ) {
            return false;
        }
        const idxA = slotA.segmentRefs[0].segmentIndex | 0;
        const idxB = slotB.segmentRefs[0].segmentIndex | 0;
        const segA = segments[idxA];
        const segB = segments[idxB];
        if (!segA || !segB) return false;

        const beforeA = {
            in: Number(segA.sourceInSec) || 0,
            out: Number(segA.sourceOutSec) || 0,
        };
        const beforeB = {
            in: Number(segB.sourceInSec) || 0,
            out: Number(segB.sourceOutSec) || 0,
        };

        if (
            preSwapSources &&
            preSwapSources.a &&
            preSwapSources.b &&
            Number.isFinite(preSwapSources.a.in) &&
            Number.isFinite(preSwapSources.a.out) &&
            Number.isFinite(preSwapSources.b.in) &&
            Number.isFinite(preSwapSources.b.out)
        ) {
            segA.sourceInSec = preSwapSources.b.in;
            segA.sourceOutSec = preSwapSources.b.out;
            segB.sourceInSec = preSwapSources.a.in;
            segB.sourceOutSec = preSwapSources.a.out;
        } else {
            segA.sourceInSec = beforeB.in;
            segA.sourceOutSec = beforeB.out;
            segB.sourceInSec = beforeA.in;
            segB.sourceOutSec = beforeA.out;
        }
        delete segA.regionTimelineOutSec;
        delete segB.regionTimelineOutSec;

        if (typeof window.musicalSlotDiagLog === 'function') {
            window.musicalSlotDiagLog('swap/source-bounds', {
                regionA: idxA + 1,
                regionB: idxB + 1,
                usedPreSwapCapture: !!(
                    preSwapSources &&
                    preSwapSources.a &&
                    preSwapSources.b
                ),
                beforeA: beforeA,
                beforeB: beforeB,
                preSwapA: preSwapSources && preSwapSources.a ? preSwapSources.a : null,
                preSwapB: preSwapSources && preSwapSources.b ? preSwapSources.b : null,
                afterA: {
                    in: segA.sourceInSec,
                    out: segA.sourceOutSec,
                    dur: Math.max(0, segA.sourceOutSec - segA.sourceInSec),
                },
                afterB: {
                    in: segB.sourceInSec,
                    out: segB.sourceOutSec,
                    dur: Math.max(0, segB.sourceOutSec - segB.sourceInSec),
                },
            });
        }
        return true;
    }

    function markDrawRangeKey(range) {
        if (!range || !Number.isFinite(range.startSec) || !Number.isFinite(range.endSec)) {
            return '';
        }
        return Number(range.startSec).toFixed(6) + '|' + Number(range.endSec).toFixed(6);
    }

    /** persist snapshot から mark draw range を構築（override 空時のフォールバック） */
    function buildMarkDrawRangesFromPersistSnapshot(master) {
        if (!(master > 0)) return [];
        const snap =
            typeof window.getRehearsalMarkTrackEventsPersistSnapshot === 'function'
                ? window.getRehearsalMarkTrackEventsPersistSnapshot()
                : [];
        if (!snap.length) return [];
        const ranges = [];
        let paletteIndex = 0;
        const firstStart = snap[0].sec;
        if (firstStart > 1e-6) {
            const unlabeled = '_';
            ranges.push({
                startSec: 0,
                endSec: firstStart,
                paletteIndex: paletteIndex,
                label: unlabeled,
                fromRehearsalEvent: false,
            });
            paletteIndex += 1;
        }
        for (let i = 0; i < snap.length; i++) {
            const startSec = snap[i].sec;
            const endSec = i + 1 < snap.length ? snap[i + 1].sec : master;
            if (!(endSec > startSec + 1e-9)) continue;
            ranges.push({
                startSec: startSec,
                endSec: endSec,
                paletteIndex: paletteIndex,
                label: snap[i].label,
                fromRehearsalEvent: true,
            });
            paletteIndex += 1;
        }
        return ranges;
    }

    /** transport-swap — collectRehearsalMarkDrawRanges + persist snapshot フォールバック */
    function collectMarkDrawRangesForTransportSync(master, meterSpec) {
        let ranges = [];
        if (typeof window.collectRehearsalMarkDrawRanges === 'function') {
            ranges = window.collectRehearsalMarkDrawRanges(master, meterSpec) || [];
        }
        if (ranges.some((r) => r && r.fromRehearsalEvent)) return ranges;
        return buildMarkDrawRangesFromPersistSnapshot(master);
    }

    function isHeadPadRehearsalSlotForTransportSync(slot, track, segments) {
        if (track && segments && isPickupHeadSlotForTransportSync(track, slot, segments)) {
            return true;
        }
        if (!slot || !slot.musical || !slot.segmentRefs || !slot.segmentRefs.length) {
            return false;
        }
        if ((slot.musical.rehearsalSlotIndex | 0) !== 0) return false;
        if ((slot.segmentRefs[0].segmentIndex | 0) !== 0) return false;
        const bars = slot.musical.contentBarCount | 0;
        return bars > 0 && bars <= 1;
    }

    function isHeadPadTransportSwapPair(slotA, slotB, track, segments, preSwapPairTimelines) {
        if (
            isHeadPadRehearsalSlotForTransportSync(slotA, track, segments) ||
            isHeadPadRehearsalSlotForTransportSync(slotB, track, segments)
        ) {
            return true;
        }
        if (!preSwapPairTimelines || !preSwapPairTimelines.a) return false;
        const headStart = Number(preSwapPairTimelines.a.timelineStartSec);
        return Number.isFinite(headStart) && Math.abs(headStart) < segmentBoundaryEps();
    }

    function hasRehearsalMarkEventAtTransportHead() {
        if (typeof window.getRehearsalMarkTrackEventsPersistSnapshot !== 'function') {
            return false;
        }
        const snap = window.getRehearsalMarkTrackEventsPersistSnapshot();
        const eps = segmentBoundaryEps();
        for (let i = 0; i < snap.length; i++) {
            const sec = Number(snap[i].sec);
            if (Number.isFinite(sec) && Math.abs(sec) < eps) return true;
        }
        return false;
    }

    /** head pad ↔ A スワップ前 — transport 冒頭に未使用リハーサルマークが無ければ 0s へ追加 */
    function ensureHeadPadRehearsalMarkBeforeTransportSwap(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (hasRehearsalMarkEventAtTransportHead()) {
            return { inserted: false, alreadyPresent: true };
        }
        if (typeof window.insertRehearsalMarkAtSec !== 'function') {
            return { inserted: false, reason: 'insertRehearsalMarkAtSec missing' };
        }
        const inserted = window.insertRehearsalMarkAtSec(0, {
            silent: true,
            skipUndo: true,
        });
        if (!inserted) {
            return { inserted: false, reason: 'insert failed' };
        }
        const snapAfter =
            typeof window.getRehearsalMarkTrackEventsPersistSnapshot === 'function'
                ? window.getRehearsalMarkTrackEventsPersistSnapshot()
                : [];
        if (typeof window.regionSwapDiagLog === 'function') {
            window.regionSwapDiagLog('rehearsal-mark/head-pad/ensure-before-swap', {
                skipSessionPersist: !!o.skipSessionPersist,
                headMark: snapAfter.length ? snapAfter[0] : null,
            });
        }
        return {
            inserted: true,
            label: snapAfter.length ? snapAfter[0].label : null,
        };
    }

    /** undo 復元先スナップショットに transport 冒頭マークが無いか */
    function undoTargetLacksTransportHeadRehearsalMark(normalizedTarget) {
        const mg = normalizedTarget && normalizedTarget.musicalGrid;
        const events =
            mg && Array.isArray(mg.rehearsalMarkTrackEvents)
                ? mg.rehearsalMarkTrackEvents
                : null;
        if (!events || !events.length) return false;
        const eps = segmentBoundaryEps();
        for (let i = 0; i < events.length; i++) {
            const sec = Number(events[i].sec);
            if (Number.isFinite(sec) && Math.abs(sec) < eps) return false;
        }
        return true;
    }

    function cloneRehearsalMarkTrackEventsForPersist(events) {
        if (!Array.isArray(events) || !events.length) return null;
        return events.map((e) => ({
            sec: Number(e.sec),
            label: e.label != null ? String(e.label) : '',
        }));
    }

    function resolveHeadPadUndoRehearsalMarkTrackEvents(normalizedTarget, swapHint) {
        const hint = swapHint && typeof swapHint === 'object' ? swapHint : null;
        const preferPreSwapHint = undoTargetLacksTransportHeadRehearsalMark(normalizedTarget);
        if (
            preferPreSwapHint &&
            hint &&
            Array.isArray(hint.preSwapRehearsalMarkTrackEvents) &&
            hint.preSwapRehearsalMarkTrackEvents.length
        ) {
            return cloneRehearsalMarkTrackEventsForPersist(hint.preSwapRehearsalMarkTrackEvents);
        }
        const mg = normalizedTarget && normalizedTarget.musicalGrid;
        if (
            mg &&
            Array.isArray(mg.rehearsalMarkTrackEvents) &&
            mg.rehearsalMarkTrackEvents.length
        ) {
            return cloneRehearsalMarkTrackEventsForPersist(mg.rehearsalMarkTrackEvents);
        }
        return null;
    }

    /**
     * head pad swap undo — ensureHeadPad で新設した冒頭マークを剥奪し、
     * undo スナップショットの mark 列を再適用する。
     */
    function reconcileHeadPadRehearsalMarkAfterTransportSwapUndo(normalizedTarget, swapHint) {
        const hint = swapHint && typeof swapHint === 'object' ? swapHint : null;
        const target = normalizedTarget && typeof normalizedTarget === 'object' ? normalizedTarget : null;
        if (!target) return { reconciled: false, reason: 'no-target' };

        const targetLacksHeadMark = undoTargetLacksTransportHeadRehearsalMark(target);
        // redo 等 post-swap 復元 — スナップショットに transport 冒頭 mark がある
        if (!targetLacksHeadMark) {
            if (
                typeof window.regionSwapDiagLog === 'function' &&
                hint &&
                hint.headPadMarkInsertedForSwap
            ) {
                window.regionSwapDiagLog('rehearsal-mark/head-pad/skip-reconcile', {
                    reason: 'post-swap-target',
                });
            }
            return { reconciled: false, skipped: true, reason: 'post-swap-target' };
        }

        const shouldRevoke =
            !!(hint && hint.headPadMarkInsertedForSwap) || targetLacksHeadMark;
        if (!shouldRevoke) {
            return { reconciled: false, skipped: true };
        }

        const marks = resolveHeadPadUndoRehearsalMarkTrackEvents(target, hint);
        if (
            marks &&
            marks.length &&
            typeof window.applyRehearsalMarkTrackEventsFromPersist === 'function'
        ) {
            const master = masterDurationSec();
            if (!(master > 0)) {
                return { reconciled: false, reason: 'no-master' };
            }
            window.applyRehearsalMarkTrackEventsFromPersist(marks, master);
            if (typeof window.refreshRehearsalTrack === 'function') {
                window.refreshRehearsalTrack();
            }
            if (typeof window.clearMusicalGridPositionCache === 'function') {
                window.clearMusicalGridPositionCache();
            }
            if (typeof window.regionSwapDiagLog === 'function') {
                const usedPreSwapHint =
                    targetLacksHeadMark &&
                    hint &&
                    hint.preSwapRehearsalMarkTrackEvents &&
                    hint.preSwapRehearsalMarkTrackEvents.length;
                window.regionSwapDiagLog('rehearsal-mark/head-pad/revoke-after-undo', {
                    headPadMarkInsertedForSwap: !!(hint && hint.headPadMarkInsertedForSwap),
                    source: usedPreSwapHint ? 'hint-pre-swap' : 'snapshot-musical-grid',
                    targetMarkCount: marks.length,
                    targetHead: marks[0]
                        ? { sec: marks[0].sec, label: marks[0].label }
                        : null,
                });
            }
            return { reconciled: true, method: 'reapply-pre-swap-marks' };
        }

        if (hint && hint.headPadMarkInsertedForSwap) {
            return { reconciled: false, reason: 'missing-pre-swap-marks' };
        }

        if (
            hasRehearsalMarkEventAtTransportHead() &&
            typeof window.removeRehearsalMarkAtTransportHead === 'function'
        ) {
            const removed = window.removeRehearsalMarkAtTransportHead({
                skipUndo: true,
                silent: true,
            });
            return removed
                ? { reconciled: true, method: 'remove-head-mark' }
                : { reconciled: false, reason: 'remove-failed' };
        }
        return { reconciled: false, reason: 'no-action' };
    }

    function findMarkDrawRangeForRehearsalLabel(label, master, meterSpec, eps, usedRangeKeys) {
        if (!label || !(master > 0) || !meterSpec) {
            return null;
        }
        const norm =
            typeof window.normalizeRehearsalMarkLabel === 'function'
                ? window.normalizeRehearsalMarkLabel(label)
                : String(label).trim();
        if (!norm) return null;
        if (norm === '_') {
            const head = findHeadPadPickupDrawRange(master, meterSpec);
            if (
                head &&
                (!usedRangeKeys || !usedRangeKeys.has(markDrawRangeKey(head)))
            ) {
                return head;
            }
            return null;
        }
        const ranges = collectMarkDrawRangesForTransportSync(master, meterSpec);
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (!r || !r.fromRehearsalEvent) continue;
            if (usedRangeKeys && usedRangeKeys.has(markDrawRangeKey(r))) continue;
            const rLabel =
                typeof window.normalizeRehearsalMarkLabel === 'function'
                    ? window.normalizeRehearsalMarkLabel(r.label)
                    : String(r.label == null ? '' : r.label).trim();
            if (rLabel === norm) {
                return r;
            }
        }
        return null;
    }

    /** transport-swap — [startSec, endSec) と重なる mark draw range のキー */
    function collectMarkDrawRangeKeysInSpan(startSec, endSec, master, meterSpec, eps) {
        const keys = new Set();
        if (
            !(master > 0) ||
            !meterSpec ||
            !Number.isFinite(startSec) ||
            !Number.isFinite(endSec) ||
            endSec <= startSec + 1e-6 ||
            typeof window.collectRehearsalMarkDrawRanges !== 'function'
        ) {
            return keys;
        }
        const tol = eps > 0 ? eps : segmentBoundaryEps();
        const ranges = window.collectRehearsalMarkDrawRanges(master, meterSpec);
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (!r || !Number.isFinite(r.startSec) || !Number.isFinite(r.endSec)) continue;
            if (r.endSec <= startSec + tol || r.startSec >= endSec - tol) continue;
            keys.add(markDrawRangeKey(r));
        }
        return keys;
    }

    function buildTransportSwapPairUsedMarkRangeKeys(slotA, slotB) {
        const master = masterDurationSec();
        const settings = getMeterSettings();
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        const eps = segmentBoundaryEps();
        const keys = new Set();
        if (!(master > 0) || !meterSpec) return keys;
        for (let pi = 0; pi < 2; pi++) {
            const slot = pi === 0 ? slotA : slotB;
            if (
                !slot ||
                !Number.isFinite(slot.timelineStartSec) ||
                !Number.isFinite(slot.timelineEndSec)
            ) {
                continue;
            }
            for (const k of collectMarkDrawRangeKeysInSpan(
                slot.timelineStartSec,
                slot.timelineEndSec,
                master,
                meterSpec,
                eps,
            )) {
                keys.add(k);
            }
        }
        return keys;
    }

    function findMarkDrawRangeAtTimelineStart(startSec, master, meterSpec, eps, usedRangeKeys) {
        if (!Number.isFinite(startSec) || !(master > 0) || !meterSpec) {
            return null;
        }
        const tol = eps > 0 ? eps : segmentBoundaryEps();
        const ranges = collectMarkDrawRangesForTransportSync(master, meterSpec);
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (!r || !r.fromRehearsalEvent) continue;
            if (!Number.isFinite(r.startSec) || !Number.isFinite(r.endSec)) continue;
            if (usedRangeKeys && usedRangeKeys.has(markDrawRangeKey(r))) continue;
            if (startSec >= r.startSec - tol && startSec < r.endSec - tol) {
                return r;
            }
        }
        return null;
    }

    function rehearsalIdxFitsSpecCounts(idx, countsLen) {
        const i = idx | 0;
        return i >= 0 && i < (countsLen | 0);
    }

    function normalizeRehearsalMarkLabelForTransportSync(label) {
        const raw = String(label == null ? '' : label).trim();
        if (!raw) return '';
        return typeof window.normalizeRehearsalMarkLabel === 'function'
            ? window.normalizeRehearsalMarkLabel(raw)
            : raw;
    }

    /** mark draw range の label を slot.rehearsalLabel へ反映 */
    function applyMarkDrawRangeLabelToTransportSlot(slot, range) {
        if (!slot || !range) return;
        const norm = normalizeRehearsalMarkLabelForTransportSync(range.label);
        if (!norm || norm === '_') return;
        if (!slot.musical) slot.musical = {};
        slot.musical.rehearsalLabel = norm;
    }

    /** transport-swap — mark draw range 先頭から barCount 分を slot timeline に反映 */
    function applyMarkDrawRangeToTransportSwapSlot(slot, range, barCount, eps, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const bars = barCount | 0;
        if (
            !slot ||
            !range ||
            !(bars > 0) ||
            !Number.isFinite(range.startSec)
        ) {
            return false;
        }
        const tol = eps > 0 ? eps : segmentBoundaryEps();
        const startSec = range.startSec;
        let endSec = transportEndSecForBarSpanAtStart(startSec, bars);
        const master = masterDurationSec();
        const settings = getMeterSettings();
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        if (Number.isFinite(range.endSec) && meterSpec && master > 0) {
            const sectionBars = transportBarCountForDrawRange(
                { startSec: range.startSec, endSec: range.endSec },
                master,
                meterSpec,
                tol,
            );
            if (o.preferMarkDrawBoundary && range.endSec > startSec + tol) {
                endSec = range.endSec;
            } else if (sectionBars > 0 && sectionBars === bars) {
                endSec = range.endSec;
            }
        } else if (o.preferMarkDrawBoundary && Number.isFinite(range.endSec)) {
            endSec = range.endSec;
        }
        if (!Number.isFinite(endSec) || endSec <= startSec + tol) {
            return false;
        }
        slot.timelineStartSec = startSec;
        slot.timelineEndSec = endSec;
        if (!slot.musical) slot.musical = {};
        slot.musical.rehearsalBarCount = bars;
        if (slot.kind !== 'silent') {
            slot.musical.contentBarCount = bars;
        }
        refreshSlotMeterBarStartFromTransport(slot, { preserveBarCounts: true });
        return true;
    }

    function transportSwapPairBarsForMarkDrawRange(range, master, meterSpec, eps, planBars) {
        if (!range || !(master > 0) || !meterSpec) {
            return planBars | 0;
        }
        const sectionBars = transportBarCountForDrawRange(range, master, meterSpec, eps);
        return sectionBars > 0 ? sectionBars : planBars | 0;
    }

    /**
     * 冒頭 head pad 等 — 相手の swap 前 timeline 全幅 + 小節数交換（重なりなし）。
     * partner-start-own-bar-count は非対称で重なるため head pad では使わない。
     */
    function applyTransportSwapPairPartnerBoundsDestSpans(
        slotA,
        slotB,
        barA,
        barB,
        preSwapPairTimelines,
    ) {
        if (!slotA || !slotB || !preSwapPairTimelines) return null;
        const legacyA = preSwapPairTimelines.a;
        const legacyB = preSwapPairTimelines.b;
        if (
            !legacyA ||
            !legacyB ||
            !Number.isFinite(legacyA.timelineStartSec) ||
            !Number.isFinite(legacyA.timelineEndSec) ||
            !Number.isFinite(legacyB.timelineStartSec) ||
            !Number.isFinite(legacyB.timelineEndSec)
        ) {
            return null;
        }
        const tol = segmentBoundaryEps();
        if (
            legacyA.timelineEndSec <= legacyA.timelineStartSec + tol ||
            legacyB.timelineEndSec <= legacyB.timelineStartSec + tol
        ) {
            return null;
        }
        slotA.timelineStartSec = legacyB.timelineStartSec;
        slotA.timelineEndSec = legacyB.timelineEndSec;
        slotB.timelineStartSec = legacyA.timelineStartSec;
        slotB.timelineEndSec = legacyA.timelineEndSec;
        const bA = barA | 0;
        const bB = barB | 0;
        if (!slotA.musical) slotA.musical = {};
        if (!slotB.musical) slotB.musical = {};
        slotA.musical.rehearsalBarCount = bB;
        if (slotA.kind !== 'silent') slotA.musical.contentBarCount = bB;
        slotB.musical.rehearsalBarCount = bA;
        if (slotB.kind !== 'silent') slotB.musical.contentBarCount = bA;
        refreshSlotMeterBarStartFromTransport(slotA, { preserveBarCounts: true });
        refreshSlotMeterBarStartFromTransport(slotB, { preserveBarCounts: true });
        return {
            a: { start: slotA.timelineStartSec, end: slotA.timelineEndSec },
            b: { start: slotB.timelineStartSec, end: slotB.timelineEndSec },
        };
    }

    /**
     * 冒頭 head pad 等 — 相手の swap 前開始位置 + 自 barA/barB（物理入替）。
     * fill counts（postCounts）配置のフォールバックより優先。
     */
    function applyTransportSwapPairPartnerStartDestSpans(
        slotA,
        slotB,
        barA,
        barB,
        preSwapPairTimelines,
    ) {
        if (!slotA || !slotB || !preSwapPairTimelines) return null;
        const legacyA = preSwapPairTimelines.a;
        const legacyB = preSwapPairTimelines.b;
        if (
            !legacyA ||
            !legacyB ||
            !Number.isFinite(legacyA.timelineStartSec) ||
            !Number.isFinite(legacyB.timelineStartSec)
        ) {
            return null;
        }
        const bA = barA | 0;
        const bB = barB | 0;
        if (!(bA > 0) || !(bB > 0)) return null;
        const tol = segmentBoundaryEps();
        const startA = legacyB.timelineStartSec;
        const endA = transportEndSecForBarSpanAtStart(startA, bA);
        const startB = legacyA.timelineStartSec;
        const endB = transportEndSecForBarSpanAtStart(startB, bB);
        if (
            !Number.isFinite(startA) ||
            !Number.isFinite(endA) ||
            !Number.isFinite(startB) ||
            !Number.isFinite(endB) ||
            endA <= startA + tol ||
            endB <= startB + tol
        ) {
            return null;
        }
        slotA.timelineStartSec = startA;
        slotA.timelineEndSec = endA;
        slotB.timelineStartSec = startB;
        slotB.timelineEndSec = endB;
        if (!slotA.musical) slotA.musical = {};
        if (!slotB.musical) slotB.musical = {};
        slotA.musical.rehearsalBarCount = bA;
        if (slotA.kind !== 'silent') slotA.musical.contentBarCount = bA;
        slotB.musical.rehearsalBarCount = bB;
        if (slotB.kind !== 'silent') slotB.musical.contentBarCount = bB;
        refreshSlotMeterBarStartFromTransport(slotA, { preserveBarCounts: true });
        refreshSlotMeterBarStartFromTransport(slotB, { preserveBarCounts: true });
        return {
            a: { start: startA, end: endA },
            b: { start: startB, end: endB },
        };
    }

    /**
     * transport-swap — 非対称ペアを ripple 後 mark draw span へ配置。
     * destMarkLabels.forSlotA/B は各 slot のコンテンツ identity label（swap 前の自 label）。
     * 小節数は barA/barB（自カウント）を mark-draw と照合して使う。
     */
    function applyTransportSwapPairMarkDrawDestSpans(slotA, slotB, barA, barB, destMarkLabels, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const master = masterDurationSec();
        const settings = getMeterSettings();
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        const eps = segmentBoundaryEps();
        const bA = barA | 0;
        const bB = barB | 0;
        if (!(master > 0) || !meterSpec || !slotA || !slotB || !(bA > 0) || !(bB > 0)) {
            return null;
        }
        const labels =
            destMarkLabels && typeof destMarkLabels === 'object' ? destMarkLabels : null;
        const labelForA =
            labels && labels.forSlotA
                ? labels.forSlotA
                : slotRehearsalMarkLabelForTransportSync(slotA);
        const labelForB =
            labels && labels.forSlotB
                ? labels.forSlotB
                : slotRehearsalMarkLabelForTransportSync(slotB);
        const dest = { a: null, b: null };
        const rangeA = findMarkDrawRangeForRehearsalLabel(
            labelForA,
            master,
            meterSpec,
            eps,
            null,
        );
        const barsOnA = transportSwapPairBarsForMarkDrawRange(
            rangeA,
            master,
            meterSpec,
            eps,
            bA,
        );
        if (
            rangeA &&
            applyMarkDrawRangeToTransportSwapSlot(slotA, rangeA, barsOnA, eps, null)
        ) {
            dest.a = {
                start: slotA.timelineStartSec,
                end: slotA.timelineEndSec,
            };
        }
        const rangeB = findMarkDrawRangeForRehearsalLabel(
            labelForB,
            master,
            meterSpec,
            eps,
            null,
        );
        const barsOnB = transportSwapPairBarsForMarkDrawRange(
            rangeB,
            master,
            meterSpec,
            eps,
            bB,
        );
        if (
            rangeB &&
            applyMarkDrawRangeToTransportSwapSlot(slotB, rangeB, barsOnB, eps, null)
        ) {
            dest.b = {
                start: slotB.timelineStartSec,
                end: slotB.timelineEndSec,
            };
        }
        return dest.a && dest.b ? dest : null;
    }

    /** mark スナップ後 — ペア slot の rehearsalLabel をコンテンツ identity（自 label）へ復元 */
    function refreshTransportSwapPairMarkLabelsFromDest(pairMarkLabels, slotA, slotB) {
        if (!pairMarkLabels || typeof pairMarkLabels !== 'object') return;
        const norm =
            typeof window.normalizeRehearsalMarkLabel === 'function'
                ? window.normalizeRehearsalMarkLabel
                : function (v) {
                      return String(v == null ? '' : v).trim();
                  };
        if (slotA && pairMarkLabels.forSlotA) {
            if (!slotA.musical) slotA.musical = {};
            slotA.musical.rehearsalLabel = norm(pairMarkLabels.forSlotA);
        }
        if (slotB && pairMarkLabels.forSlotB) {
            if (!slotB.musical) slotB.musical = {};
            slotB.musical.rehearsalLabel = norm(pairMarkLabels.forSlotB);
        }
    }

    /**
     * mark スナップ後 — 1) ペアを mark-draw 境界へ、2) 非ペアを label で強制合わせ、3) 全 segment seal。
     * 非ペアを先に同期すると C ペア（12.5s 残存）と重なり B が 12.2875s に寄せられない。
     */
    function resyncTransportSwapSlotsAfterMarkSnap(
        track,
        slots,
        slotA,
        slotB,
        idxA,
        idxB,
        partnerMarkLabels,
        barA,
        barB,
        segments,
        t0,
        resyncOpt,
    ) {
        const master = masterDurationSec();
        const settings = getMeterSettings();
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        if (!(master > 0) || !meterSpec || !slotA || !slotB || !segments) {
            return null;
        }

        const eps = segmentBoundaryEps();
        const pairSkip = new Set([idxA | 0, idxB | 0]);
        const bA = barA | 0;
        const bB = barB | 0;
        const pairBarCountOpt = null;
        const markDrawOpt = { preferMarkDrawBoundary: true };

        refreshTransportSwapPairMarkLabelsFromDest(partnerMarkLabels, slotA, slotB);

        const resyncO = resyncOpt && typeof resyncOpt === 'object' ? resyncOpt : {};
        const headPadPair =
            !!resyncO.headPadSwapPair ||
            isHeadPadTransportSwapPair(
                slotA,
                slotB,
                track,
                segments,
                resyncO.preSwapPairTimelines,
            );

        let pairA = false;
        let pairB = false;
        if (headPadPair && partnerMarkLabels) {
            const markDest = applyHeadPadTransportSwapPairCrossMarkDrawDestSpans(
                slotA,
                slotB,
                bA,
                bB,
                partnerMarkLabels,
                markDrawOpt,
            );
            pairA = !!(markDest && markDest.a);
            pairB = !!(markDest && markDest.b);
        }
        if (headPadPair && !pairA && !pairB && resyncO.preSwapPairTimelines) {
            const partnerDest = applyTransportSwapPairPartnerBoundsDestSpans(
                slotA,
                slotB,
                bA,
                bB,
                resyncO.preSwapPairTimelines,
            );
            pairA = !!partnerDest;
            pairB = !!partnerDest;
        }

        const destLabels =
            partnerMarkLabels && typeof partnerMarkLabels === 'object'
                ? partnerMarkLabels
                : {};
        const labelForA = destLabels.forSlotA || slotRehearsalMarkLabelForTransportSync(slotA);
        const labelForB = destLabels.forSlotB || slotRehearsalMarkLabelForTransportSync(slotB);

        if (!headPadPair && labelForA && bA > 0) {
            const rangeA = findMarkDrawRangeForRehearsalLabel(
                labelForA,
                master,
                meterSpec,
                eps,
                null,
            );
            const barsOnA = transportSwapPairBarsForMarkDrawRange(
                rangeA,
                master,
                meterSpec,
                eps,
                bA,
            );
            pairA = !!(
                rangeA &&
                barsOnA > 0 &&
                applyMarkDrawRangeToTransportSwapSlot(
                    slotA,
                    rangeA,
                    barsOnA,
                    eps,
                    pairBarCountOpt,
                )
            );
        }
        if (!headPadPair && labelForB && bB > 0) {
            const rangeB = findMarkDrawRangeForRehearsalLabel(
                labelForB,
                master,
                meterSpec,
                eps,
                null,
            );
            const barsOnB = transportSwapPairBarsForMarkDrawRange(
                rangeB,
                master,
                meterSpec,
                eps,
                bB,
            );
            pairB = !!(
                rangeB &&
                barsOnB > 0 &&
                applyMarkDrawRangeToTransportSwapSlot(
                    slotB,
                    rangeB,
                    barsOnB,
                    eps,
                    pairBarCountOpt,
                )
            );
        }

        const usedRangeKeys = buildTransportSwapPairUsedMarkRangeKeys(slotA, slotB);
        const pairDestLabels = new Set(
            [labelForA, labelForB]
                .map((v) => normalizeRehearsalMarkLabelForTransportSync(v))
                .filter(Boolean),
        );

        let nonPairForced = 0;
        for (let i = 0; i < slots.length; i++) {
            if (pairSkip.has(i)) continue;
            const slot = slots[i];
            if (!slot || slot.kind === 'silent') continue;
            if (track && isPickupHeadSlotForTransportSync(track, slot, segments)) {
                continue;
            }
            let range = null;
            if (Number.isFinite(slot.timelineStartSec)) {
                range = findMarkDrawRangeAtTimelineStart(
                    slot.timelineStartSec,
                    master,
                    meterSpec,
                    eps,
                    usedRangeKeys,
                );
            }
            if (!range) {
                const label = slotRehearsalMarkLabelForTransportSync(slot);
                if (!label || label === '_') continue;
                if (pairDestLabels.has(label)) continue;
                range = findMarkDrawRangeForRehearsalLabel(
                    label,
                    master,
                    meterSpec,
                    eps,
                    usedRangeKeys,
                );
            }
            if (!range) continue;
            const sectionBars = transportBarCountForDrawRange(
                { startSec: range.startSec, endSec: range.endSec },
                master,
                meterSpec,
                eps,
            );
            if (
                sectionBars > 0 &&
                applyMarkDrawRangeToTransportSwapSlot(
                    slot,
                    range,
                    sectionBars,
                    eps,
                    markDrawOpt,
                )
            ) {
                applyMarkDrawRangeLabelToTransportSlot(slot, range);
                usedRangeKeys.add(markDrawRangeKey(range));
                nonPairForced++;
            }
        }

        refreshSlotMeterBarStartFromTransport(slotA, { preserveBarCounts: true });
        refreshSlotMeterBarStartFromTransport(slotB, { preserveBarCounts: true });

        const sealed = sealTransportSwapSlotBoundaries(track, slots, segments, t0);
        if (
            resyncOpt &&
            resyncOpt.preSwapPairSegmentSources &&
            resyncOpt.preserveSwapPairSourceIdentity &&
            !headPadPair
        ) {
            restorePreSwapPairSegmentSources(
                segments,
                slotA,
                slotB,
                resyncOpt.preSwapPairSegmentSources,
            );
        }
        const refit = refitTransportSwapSegmentSourcesToSlotSpans(track, slots, segments, {
            preSwapPairSegmentSources:
                resyncOpt && resyncOpt.preSwapPairSegmentSources
                    ? resyncOpt.preSwapPairSegmentSources
                    : null,
            preserveSourceIdentity: !!(
                resyncOpt && resyncOpt.preserveSwapPairSourceIdentity && !headPadPair
            ),
            slotA,
            slotB,
            swapPairIndices: [idxA, idxB],
        });

        if (typeof window.musicalSlotDiagLog === 'function') {
            const fmt =
                typeof window.musicalSlotDiagFmtSec === 'function'
                    ? window.musicalSlotDiagFmtSec
                    : function (v) {
                          return String(v);
                      };
            window.musicalSlotDiagLog('swap/resync-after-mark-snap', {
                ex: track.slot + 1,
                labelForA: labelForA || null,
                labelForB: labelForB || null,
                pairA,
                pairB,
                nonPairForced,
                slotA: {
                    start: fmt(slotA.timelineStartSec),
                    end: fmt(slotA.timelineEndSec),
                },
                slotB: {
                    start: fmt(slotB.timelineStartSec),
                    end: fmt(slotB.timelineEndSec),
                },
                sealed,
                refit,
            });
        }

        return { pairA, pairB, nonPairForced, sealed, refit };
    }

    /**
     * transport-swap — 非対称ペアの timeline 配置（唯一の経路）。
     *
     * 入力 nextCounts は planner が決めた postCounts（recompose 済み）。
     * 各 slot の rehearsalSlotIndex は partial swap でも不変。
     *
     * Fill グループ counts（例: 7,6,18）と mark 単位 rehearsalSlotIndex が
     * 一致しないときは mark-draw span を真実として配置する。
     * ripple 後の mark-draw span と等価であることは invariant で検証する。
     *
     * @see musical-swap-planner.js ファイルヘッダ「設計原則」
     */
    function applyTransportSwapPairBarCountDestSpans(
        slotA,
        slotB,
        nextCounts,
        rehearsalIdxA,
        rehearsalIdxB,
        opt,
    ) {
        if (!slotA || !slotB || !nextCounts || !nextCounts.length) return null;
        const o = opt && typeof opt === 'object' ? opt : {};
        const bA = o.barA | 0;
        const bB = o.barB | 0;
        const countsLen = nextCounts.length;
        const idxA = Number.isFinite(rehearsalIdxA)
            ? rehearsalIdxA | 0
            : slotA.musical
              ? slotA.musical.rehearsalSlotIndex | 0
              : -1;
        const idxB = Number.isFinite(rehearsalIdxB)
            ? rehearsalIdxB | 0
            : slotB.musical
              ? slotB.musical.rehearsalSlotIndex | 0
              : -1;
        const asymmetricTransport = bA > 0 && bB > 0 && bA !== bB;
        const headPadPair =
            !!o.headPadSwapPair ||
            isHeadPadTransportSwapPair(
                slotA,
                slotB,
                o.track,
                o.segments,
                o.preSwapPairTimelines,
            );
        const markIdxMismatch =
            !rehearsalIdxFitsSpecCounts(idxA, countsLen) ||
            !rehearsalIdxFitsSpecCounts(idxB, countsLen);
        if (headPadPair && o.preSwapPairTimelines) {
            if (o.destMarkLabels) {
                const markDest = applyHeadPadTransportSwapPairCrossMarkDrawDestSpans(
                    slotA,
                    slotB,
                    bA,
                    bB,
                    o.destMarkLabels,
                    o.preferMarkDrawDest ? { preferMarkDrawBoundary: true } : null,
                );
                if (markDest) {
                    return markDest;
                }
            }
            const partnerDest = applyTransportSwapPairPartnerBoundsDestSpans(
                slotA,
                slotB,
                bA,
                bB,
                o.preSwapPairTimelines,
            );
            if (partnerDest) {
                return partnerDest;
            }
        }
        if (asymmetricTransport && (markIdxMismatch || o.preferMarkDrawDest)) {
            const markDest = applyTransportSwapPairMarkDrawDestSpans(
                slotA,
                slotB,
                bA,
                bB,
                o.destMarkLabels,
                o.preferMarkDrawDest ? { preferMarkDrawBoundary: true } : null,
            );
            if (markDest) {
                return markDest;
            }
        }
        if (headPadPair) {
            return null;
        }
        const dest = { a: null, b: null };
        if (
            applySlotTimelineFromCountsRange(
                slotA,
                nextCounts,
                Number.isFinite(rehearsalIdxA) ? rehearsalIdxA : undefined,
            )
        ) {
            dest.a = {
                start: slotA.timelineStartSec,
                end: slotA.timelineEndSec,
            };
        }
        if (
            applySlotTimelineFromCountsRange(
                slotB,
                nextCounts,
                Number.isFinite(rehearsalIdxB) ? rehearsalIdxB : undefined,
            )
        ) {
            dest.b = {
                start: slotB.timelineStartSec,
                end: slotB.timelineEndSec,
            };
        }
        return dest.a && dest.b ? dest : null;
    }

    /** head pad ↔ A — ripple 後 mark-draw へ交差配置（自 label ではなく相手 label の span） */
    function applyHeadPadTransportSwapPairCrossMarkDrawDestSpans(
        slotA,
        slotB,
        barA,
        barB,
        partnerMarkLabels,
        opt,
    ) {
        if (!slotA || !slotB || !partnerMarkLabels || typeof partnerMarkLabels !== 'object') {
            return null;
        }
        const bA = barA | 0;
        const bB = barB | 0;
        if (!(bA > 0) || !(bB > 0)) return null;
        const crossLabels = {
            forSlotA: partnerMarkLabels.forSlotB,
            forSlotB: partnerMarkLabels.forSlotA,
        };
        if (!crossLabels.forSlotA || !crossLabels.forSlotB) return null;
        return applyTransportSwapPairMarkDrawDestSpans(
            slotA,
            slotB,
            bB,
            bA,
            crossLabels,
            Object.assign({ preferMarkDrawBoundary: true }, opt || {}),
        );
    }

    function slotTimelineSpansOverlap(slotA, slotB, eps) {
        if (
            !slotA ||
            !slotB ||
            !Number.isFinite(slotA.timelineStartSec) ||
            !Number.isFinite(slotA.timelineEndSec) ||
            !Number.isFinite(slotB.timelineStartSec) ||
            !Number.isFinite(slotB.timelineEndSec)
        ) {
            return false;
        }
        const tol = eps > 0 ? eps : segmentBoundaryEps();
        return (
            slotA.timelineStartSec < slotB.timelineEndSec - tol &&
            slotB.timelineStartSec < slotA.timelineEndSec - tol
        );
    }

    function appendSubtractTimelineSpan(start, end, cutStart, cutEnd, out, eps) {
        if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start + eps)) return;
        if (cutEnd <= start + eps || cutStart >= end - eps) {
            out.push({ startSec: start, endSec: end });
            return;
        }
        if (start < cutStart - eps) {
            out.push({ startSec: start, endSec: Math.min(end, cutStart) });
        }
        if (end > cutEnd + eps) {
            out.push({ startSec: Math.max(start, cutEnd), endSec: end });
        }
    }

    /** 非対称 swap でペアが明け渡した timeline 区間（例: 16→8 小節の末尾 8 小節） */
    function collectVacatedTimelineSpansFromPairSwap(preSwapPairTimelines, slotA, slotB) {
        if (!preSwapPairTimelines || !slotA || !slotB) return [];
        const eps = segmentBoundaryEps();
        const vacated = [];
        const preA = preSwapPairTimelines.a;
        const preB = preSwapPairTimelines.b;
        if (
            preA &&
            Number.isFinite(preA.timelineStartSec) &&
            Number.isFinite(preA.timelineEndSec)
        ) {
            appendSubtractTimelineSpan(
                preA.timelineStartSec,
                preA.timelineEndSec,
                slotA.timelineStartSec,
                slotA.timelineEndSec,
                vacated,
                eps,
            );
        }
        if (
            preB &&
            Number.isFinite(preB.timelineStartSec) &&
            Number.isFinite(preB.timelineEndSec)
        ) {
            appendSubtractTimelineSpan(
                preB.timelineStartSec,
                preB.timelineEndSec,
                slotB.timelineStartSec,
                slotB.timelineEndSec,
                vacated,
                eps,
            );
        }
        return vacated
            .filter((span) => span.endSec > span.startSec + eps)
            .sort((a, b) => a.startSec - b.startSec);
    }

    function evictedSlotContentBarCount(slot) {
        if (!slot || !slot.musical) return 0;
        const content = slot.musical.contentBarCount | 0;
        const rehearsal = slot.musical.rehearsalBarCount | 0;
        if (content > 1) return content;
        if (rehearsal > 0) return rehearsal;
        return content > 0 ? content : 0;
    }

    function shouldClipMarkDrawRangeToSlotContent(
        slot,
        range,
        master,
        meterSpec,
        eps,
        track,
        segments,
    ) {
        if (!slot || !slot.musical || !range) return false;
        if (track && isPickupHeadSlotForTransportSync(track, slot, segments)) {
            return true;
        }
        const content = slot.musical.contentBarCount | 0;
        if (content <= 1) return false;
        const markBars = transportBarCountForDrawRange(range, master, meterSpec, eps);
        return markBars > 0 && content < markBars;
    }

    function clipTimelineSpanToSlotContentBars(startSec, endSec, slot, eps, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
            return { startSec, endSec };
        }
        if (!o.clipToContent) {
            return { startSec, endSec };
        }
        const bars = evictedSlotContentBarCount(slot);
        const capped =
            o.maxPlaceBars > 0 ? Math.min(bars, o.maxPlaceBars | 0) : bars;
        if (!(capped > 0)) {
            return { startSec, endSec };
        }
        const clippedEnd = transportEndSecForBarSpanAtStart(startSec, capped);
        if (Number.isFinite(clippedEnd) && clippedEnd > startSec + eps) {
            return { startSec, endSec: Math.min(endSec, clippedEnd) };
        }
        return { startSec, endSec };
    }

    function slotContentBarCountForTimelineClip(slot) {
        return evictedSlotContentBarCount(slot);
    }

    function applyEvictedSlotTimelineSpan(slot, startSec, endSec, master, meterSpec, eps) {
        const clipped = clipTimelineSpanToSlotContentBars(
            startSec,
            endSec,
            slot,
            eps,
            { clipToContent: true, forEvicted: true },
        );
        if (
            !slot ||
            !Number.isFinite(clipped.startSec) ||
            !Number.isFinite(clipped.endSec) ||
            clipped.endSec <= clipped.startSec + eps
        ) {
            return false;
        }
        slot.timelineStartSec = clipped.startSec;
        slot.timelineEndSec = clipped.endSec;
        if (!slot.musical) slot.musical = {};
        const contentBars = evictedSlotContentBarCount(slot);
        const spanBars = transportBarCountForDrawRange(
            { startSec: clipped.startSec, endSec: clipped.endSec },
            master,
            meterSpec,
            eps,
        );
        const barCount = spanBars > 0 ? spanBars : contentBars;
        if (barCount > 0) {
            slot.musical.rehearsalBarCount = barCount;
            if (slot.kind !== 'silent') {
                slot.musical.contentBarCount = barCount;
            }
        }
        const markRange = findMarkDrawRangeAtTimelineStart(
            clipped.startSec,
            master,
            meterSpec,
            eps,
            null,
        );
        applyMarkDrawRangeLabelToTransportSlot(slot, markRange);
        refreshSlotMeterBarStartFromTransport(slot);
        return true;
    }

    function applyTimelineSpanToEvictedSlot(slot, span, master, meterSpec, eps) {
        if (
            !slot ||
            !span ||
            !Number.isFinite(span.startSec) ||
            !Number.isFinite(span.endSec) ||
            span.endSec <= span.startSec + eps
        ) {
            return false;
        }
        return applyEvictedSlotTimelineSpan(
            slot,
            span.startSec,
            span.endSec,
            master,
            meterSpec,
            eps,
        );
    }

    function timelineSpanProbe(startSec, endSec) {
        return { timelineStartSec: startSec, timelineEndSec: endSec };
    }

    function timelineSpanOccupiedByOtherSlot(slots, span, excludeIdx, eps) {
        if (
            !slots ||
            !span ||
            !Number.isFinite(span.startSec) ||
            !Number.isFinite(span.endSec)
        ) {
            return false;
        }
        const tol = eps > 0 ? eps : segmentBoundaryEps();
        const probe = timelineSpanProbe(span.startSec, span.endSec);
        for (let i = 0; i < slots.length; i++) {
            if (i === (excludeIdx | 0)) continue;
            const slot = slots[i];
            if (
                !slot ||
                slot.kind === 'silent' ||
                !Number.isFinite(slot.timelineStartSec) ||
                !Number.isFinite(slot.timelineEndSec)
            ) {
                continue;
            }
            if (slotTimelineSpansOverlap(slot, probe, tol)) {
                return true;
            }
        }
        return false;
    }

    /** transport-swap — draw range を失った非ペア slot を未使用 mark 区間へ再配置 */
    function assignEvictedSlotsToUnusedMarkDrawRanges(
        slots,
        drawSync,
        pairSkip,
        seedUsedRangeKeys,
        track,
        opt,
    ) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!drawSync || !Array.isArray(drawSync.rows) || !drawSync.rows.length) {
            return 0;
        }
        const master = masterDurationSec();
        const settings = getMeterSettings();
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        if (!(master > 0) || !meterSpec) return 0;
        const eps = segmentBoundaryEps();
        const skip = new Set(Array.isArray(pairSkip) ? pairSkip : []);
        const usedKeys = new Set(seedUsedRangeKeys || []);
        const segments =
            track && typeof window.getTrackSegments === 'function'
                ? window.getTrackSegments(track)
                : null;

        for (let ri = 0; ri < drawSync.rows.length; ri++) {
            const row = drawSync.rows[ri];
            if (!row || !row.synced) continue;
            const slotIdx = (row.unit | 0) - 1;
            const slot = slots[slotIdx];
            if (
                !slot ||
                !Number.isFinite(slot.timelineStartSec) ||
                !Number.isFinite(slot.timelineEndSec)
            ) {
                continue;
            }
            for (const k of collectMarkDrawRangeKeysInSpan(
                slot.timelineStartSec,
                slot.timelineEndSec,
                master,
                meterSpec,
                eps,
            )) {
                usedKeys.add(k);
            }
        }

        if (typeof window.collectRehearsalMarkDrawRanges !== 'function') return 0;
        const allRanges = window
            .collectRehearsalMarkDrawRanges(master, meterSpec)
            .filter((r) => r && r.fromRehearsalEvent)
            .sort((a, b) => a.startSec - b.startSec);

        let assigned = 0;
        const slotA = o.slotA || null;
        const slotB = o.slotB || null;
        const vacatedSpans = collectVacatedTimelineSpansFromPairSwap(
            o.preSwapPairTimelines,
            slotA,
            slotB,
        );
        const pinnedSlotIndices = new Set(skip);
        for (let ri = 0; ri < drawSync.rows.length; ri++) {
            const row = drawSync.rows[ri];
            if (!row || !row.synced) continue;
            pinnedSlotIndices.add((row.unit | 0) - 1);
        }
        let vacIdx = 0;

        function firstUnoccupiedVacatedSpan(slotIdx, startIdx) {
            for (let vi = Math.max(0, startIdx | 0); vi < vacatedSpans.length; vi++) {
                const span = vacatedSpans[vi];
                if (timelineSpanOccupiedByOtherSlot(slots, span, slotIdx, eps)) {
                    continue;
                }
                return { span, nextIdx: vi + 1 };
            }
            return null;
        }

        function tryAssignEvictedSlotTimeline(slot, slotIdx, vacStartIdx) {
            const hit = firstUnoccupiedVacatedSpan(slotIdx, vacStartIdx);
            if (hit) {
                const clipped = clipTimelineSpanToSlotContentBars(
                    hit.span.startSec,
                    hit.span.endSec,
                    slot,
                    eps,
                    { clipToContent: true, forEvicted: true },
                );
                if (
                    !timelineSpanOccupiedByOtherSlot(slots, clipped, slotIdx, eps) &&
                    applyEvictedSlotTimelineSpan(
                        slot,
                        clipped.startSec,
                        clipped.endSec,
                        master,
                        meterSpec,
                        eps,
                    )
                ) {
                    return { ok: true, nextVacIdx: hit.nextIdx };
                }
            }
            for (let ai = 0; ai < allRanges.length; ai++) {
                const range = allRanges[ai];
                const key = markDrawRangeKey(range);
                if (usedKeys.has(key)) continue;
                const markBars = transportBarCountForDrawRange(
                    range,
                    master,
                    meterSpec,
                    eps,
                );
                const clipped = clipTimelineSpanToSlotContentBars(
                    range.startSec,
                    range.endSec,
                    slot,
                    eps,
                    {
                        clipToContent: true,
                        forEvicted: true,
                        maxPlaceBars: markBars > 0 ? markBars : 0,
                    },
                );
                if (timelineSpanOccupiedByOtherSlot(slots, clipped, slotIdx, eps)) {
                    continue;
                }
                if (
                    !applyEvictedSlotTimelineSpan(
                        slot,
                        clipped.startSec,
                        clipped.endSec,
                        master,
                        meterSpec,
                        eps,
                    )
                ) {
                    continue;
                }
                applyMarkDrawRangeLabelToTransportSlot(slot, range);
                if (clipped.endSec >= range.endSec - eps) {
                    usedKeys.add(key);
                }
                return { ok: true, nextVacIdx: vacStartIdx };
            }
            return { ok: false, nextVacIdx: vacStartIdx };
        }

        const pendingEvicted = [];
        for (let ri = 0; ri < drawSync.rows.length; ri++) {
            const row = drawSync.rows[ri];
            if (!row || row.synced || row.reason !== 'no-draw-range') continue;
            const slotIdx = (row.unit | 0) - 1;
            if (skip.has(slotIdx)) continue;
            const slot = slots[slotIdx];
            if (!slot || slot.kind === 'silent') continue;
            if (track && isPickupHeadSlotForTransportSync(track, slot, segments)) continue;

            const result = tryAssignEvictedSlotTimeline(slot, slotIdx, vacIdx);
            if (result.ok) {
                vacIdx = result.nextVacIdx;
                assigned++;
            } else {
                pendingEvicted.push(slotIdx);
            }
        }

        function tryRelocateSlotToUnusedMarkOrVacated(slotIdx) {
            const slot = slots[slotIdx];
            if (!slot || slot.kind === 'silent') return false;
            if (track && isPickupHeadSlotForTransportSync(track, slot, segments)) {
                return false;
            }
            const result = tryAssignEvictedSlotTimeline(slot, slotIdx, 0);
            if (result.ok) {
                vacIdx = Math.max(vacIdx, result.nextVacIdx);
                return true;
            }
            return false;
        }

        for (let pi = 0; pi < pendingEvicted.length; pi++) {
            const slotIdx = pendingEvicted[pi] | 0;
            const slot = slots[slotIdx];
            if (!slot) continue;
            const result = tryAssignEvictedSlotTimeline(slot, slotIdx, vacIdx);
            if (result.ok) {
                vacIdx = result.nextVacIdx;
                assigned++;
            }
        }

        for (let i = 0; i < slots.length; i++) {
            if (pinnedSlotIndices.has(i)) continue;
            const slot = slots[i];
            if (!slot || slot.kind === 'silent') continue;
            if (track && isPickupHeadSlotForTransportSync(track, slot, segments)) {
                continue;
            }
            for (let j = 0; j < slots.length; j++) {
                if (i === j || !pinnedSlotIndices.has(j)) continue;
                if (!slotTimelineSpansOverlap(slot, slots[j], eps)) continue;
                if (tryRelocateSlotToUnusedMarkOrVacated(i)) {
                    if (typeof window.musicalSlotDiagLog === 'function') {
                        window.musicalSlotDiagLog('swap/evict-overlap-to-vacated', {
                            unit: i + 1,
                            pinnedUnit: j + 1,
                            start:
                                typeof window.musicalSlotDiagFmtSec === 'function'
                                    ? window.musicalSlotDiagFmtSec(slot.timelineStartSec)
                                    : slot.timelineStartSec,
                            end:
                                typeof window.musicalSlotDiagFmtSec === 'function'
                                    ? window.musicalSlotDiagFmtSec(slot.timelineEndSec)
                                    : slot.timelineEndSec,
                        });
                    }
                }
                break;
            }
        }

        if (slotA && slotB && skip.size >= 2) {
            const pairIndices = Array.from(skip);
            const pairA = slots[pairIndices[0] | 0];
            const pairB = slots[pairIndices[1] | 0];
            if (pairA && pairB) {
                for (let i = 0; i < slots.length; i++) {
                    if (pinnedSlotIndices.has(i)) continue;
                    const slot = slots[i];
                    if (!slot || slot.kind === 'silent') continue;
                    if (track && isPickupHeadSlotForTransportSync(track, slot, segments)) {
                        continue;
                    }
                    if (
                        !slotTimelineSpansOverlap(slot, pairA, eps) &&
                        !slotTimelineSpansOverlap(slot, pairB, eps)
                    ) {
                        continue;
                    }
                    if (tryRelocateSlotToUnusedMarkOrVacated(i)) {
                        if (typeof window.musicalSlotDiagLog === 'function') {
                            window.musicalSlotDiagLog('swap/evict-overlap-to-vacated', {
                                unit: i + 1,
                                pinnedUnit: 'pair',
                                start:
                                    typeof window.musicalSlotDiagFmtSec === 'function'
                                        ? window.musicalSlotDiagFmtSec(slot.timelineStartSec)
                                        : slot.timelineStartSec,
                                end:
                                    typeof window.musicalSlotDiagFmtSec === 'function'
                                        ? window.musicalSlotDiagFmtSec(slot.timelineEndSec)
                                        : slot.timelineEndSec,
                            });
                        }
                    }
                }
            }
        }

        return assigned;
    }

    function findHeadPadPickupDrawRange(master, meterSpec) {
        if (
            !(master > 0) ||
            !meterSpec ||
            typeof window.collectRehearsalMarkDrawRanges !== 'function'
        ) {
            return null;
        }
        const ranges = window.collectRehearsalMarkDrawRanges(master, meterSpec);
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (!r || r.fromRehearsalEvent) continue;
            if (Number.isFinite(r.startSec) && Number.isFinite(r.endSec) && r.endSec > r.startSec) {
                return r;
            }
        }
        if (
            typeof window.getRehearsalMarkTrackEventsPersistSnapshot === 'function'
        ) {
            const marks = window.getRehearsalMarkTrackEventsPersistSnapshot();
            if (marks && marks.length && Number.isFinite(marks[0].sec) && marks[0].sec > 1e-6) {
                return { startSec: 0, endSec: marks[0].sec, fromRehearsalEvent: false };
            }
        }
        return null;
    }

    function applyHeadPadSlotTimelineFromPickupRange(slot, master, meterSpec, eps) {
        const pickup = findHeadPadPickupDrawRange(master, meterSpec);
        if (!pickup) return false;
        slot.timelineStartSec = pickup.startSec;
        slot.timelineEndSec = pickup.endSec;
        if (!slot.musical) slot.musical = {};
        const barCount = transportBarCountForDrawRange(pickup, master, meterSpec, eps);
        if (barCount > 0) {
            slot.musical.rehearsalBarCount = barCount;
            slot.musical.contentBarCount = barCount;
        }
        slot.musical.meterBarStart = 0;
        return true;
    }

    function transportBarCountForDrawRange(range, master, meterSpec, eps) {
        if (
            !range ||
            !(master > 0) ||
            !meterSpec ||
            typeof window.barIndexForBoundarySec !== 'function'
        ) {
            return 0;
        }
        const boundaries =
            typeof window.collectPlaybackAlignedBarBoundarySecs === 'function'
                ? window.collectPlaybackAlignedBarBoundarySecs(meterSpec, master)
                : typeof window.collectMeterBarBoundariesForRegionSwap === 'function'
                  ? window.collectMeterBarBoundariesForRegionSwap(meterSpec, master)
                  : null;
        if (!boundaries || boundaries.length < 2) return 0;
        const tol = eps > 0 ? eps : segmentBoundaryEps();
        const barStart = window.barIndexForBoundarySec(range.startSec, boundaries);
        const barEnd = window.barIndexForBoundarySec(
            Math.max(range.startSec, range.endSec - tol),
            boundaries,
        );
        return Math.max(1, barEnd - barStart + 1);
    }

    /** transport-swap — リハーサル mark draw range から全 slot の timeline / 小節数を同期 */
    function syncSlotsFromMarkDrawRanges(slots, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!Array.isArray(slots) || !slots.length) return { synced: 0, rows: [] };
        const master = masterDurationSec();
        const settings = getMeterSettings();
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        if (!(master > 0) || !meterSpec) return { synced: 0, rows: [] };
        const eps = segmentBoundaryEps();
        const track = o.track || null;
        const segments =
            track && typeof window.getTrackSegments === 'function'
                ? window.getTrackSegments(track)
                : null;
        const skip = new Set();
        if (Array.isArray(o.skipSlotIndices)) {
            for (let si = 0; si < o.skipSlotIndices.length; si++) {
                skip.add(o.skipSlotIndices[si] | 0);
            }
        }
        const usedRangeKeys = new Set();
        if (o.seedUsedRangeKeys instanceof Set) {
            for (const seedKey of o.seedUsedRangeKeys) {
                if (seedKey) usedRangeKeys.add(seedKey);
            }
        }
        const rows = [];
        let synced = 0;
        for (let i = 0; i < slots.length; i++) {
            if (skip.has(i)) continue;
            const slot = slots[i];
            if (!slot || slot.kind === 'silent') continue;
            if (track && isPickupHeadSlotForTransportSync(track, slot, segments)) {
                const preserved = applyHeadPadSlotTimelineFromPickupRange(
                    slot,
                    master,
                    meterSpec,
                    eps,
                );
                if (preserved) {
                    synced++;
                    rows.push({
                        unit: i + 1,
                        label: '_',
                        synced: true,
                        reason: 'head-pad-preserve',
                        start:
                            typeof window.musicalSlotDiagFmtSec === 'function'
                                ? window.musicalSlotDiagFmtSec(slot.timelineStartSec)
                                : slot.timelineStartSec,
                        end:
                            typeof window.musicalSlotDiagFmtSec === 'function'
                                ? window.musicalSlotDiagFmtSec(slot.timelineEndSec)
                                : slot.timelineEndSec,
                    });
                    if (typeof window.musicalSlotDiagLog === 'function') {
                        window.musicalSlotDiagLog('swap/head-pad-preserve', {
                            unit: i + 1,
                            start:
                                typeof window.musicalSlotDiagFmtSec === 'function'
                                    ? window.musicalSlotDiagFmtSec(slot.timelineStartSec)
                                    : slot.timelineStartSec,
                            end:
                                typeof window.musicalSlotDiagFmtSec === 'function'
                                    ? window.musicalSlotDiagFmtSec(slot.timelineEndSec)
                                    : slot.timelineEndSec,
                        });
                    }
                } else {
                    rows.push({
                        unit: i + 1,
                        label: '_',
                        synced: false,
                        reason: 'head-pad-preserve-failed',
                    });
                }
                continue;
            }
            const label = slotRehearsalMarkLabelForTransportSync(slot);
            let range = findMarkDrawRangeAtTimelineStart(
                slot.timelineStartSec,
                master,
                meterSpec,
                eps,
                usedRangeKeys,
            );
            if (!range) {
                range = findMarkDrawRangeForRehearsalLabel(
                    label,
                    master,
                    meterSpec,
                    eps,
                    usedRangeKeys,
                );
            }
            if (!range || !Number.isFinite(range.startSec) || !Number.isFinite(range.endSec)) {
                rows.push({
                    unit: i + 1,
                    label: label || null,
                    synced: false,
                    reason: 'no-draw-range',
                });
                continue;
            }
            const clipToContent = shouldClipMarkDrawRangeToSlotContent(
                slot,
                range,
                master,
                meterSpec,
                eps,
                track,
                segments,
            );
            let clipped = clipTimelineSpanToSlotContentBars(
                range.startSec,
                range.endSec,
                slot,
                eps,
                { clipToContent: clipToContent },
            );
            if (clipToContent && slot.musical) {
                const sectionBars = transportBarCountForDrawRange(
                    { startSec: range.startSec, endSec: range.endSec },
                    master,
                    meterSpec,
                    eps,
                );
                const content = slot.musical.contentBarCount | 0;
                if (sectionBars > 0 && content === sectionBars) {
                    clipped = { startSec: range.startSec, endSec: range.endSec };
                }
            }
            if (
                timelineSpanOccupiedByOtherSlot(slots, clipped, i, eps) ||
                clipped.endSec <= clipped.startSec + eps
            ) {
                rows.push({
                    unit: i + 1,
                    label: label || null,
                    synced: false,
                    reason: 'no-draw-range',
                });
                continue;
            }
            if (clipped.endSec >= range.endSec - eps) {
                usedRangeKeys.add(markDrawRangeKey(range));
            }
            slot.timelineStartSec = clipped.startSec;
            slot.timelineEndSec = clipped.endSec;
            if (!slot.musical) slot.musical = {};
            const spanBars = transportBarCountForDrawRange(
                { startSec: clipped.startSec, endSec: clipped.endSec },
                master,
                meterSpec,
                eps,
            );
            if (spanBars > 0) {
                slot.musical.rehearsalBarCount = spanBars;
                if (slot.kind !== 'silent') {
                    const content = slot.musical.contentBarCount | 0;
                    if (clipToContent && content > 1) {
                        slot.musical.contentBarCount = Math.min(content, spanBars);
                    } else {
                        slot.musical.contentBarCount = spanBars;
                    }
                }
            }
            if (typeof window.resolveTransportMeterSpanForSwapSec === 'function') {
                const span = window.resolveTransportMeterSpanForSwapSec(clipped.startSec, { eps });
                if (span && Number.isFinite(span.transportBarStart)) {
                    slot.musical.meterBarStart = span.transportBarStart | 0;
                }
            }
            applyMarkDrawRangeLabelToTransportSlot(slot, range);
            synced++;
            rows.push({
                unit: i + 1,
                label,
                synced: true,
                start:
                    typeof window.musicalSlotDiagFmtSec === 'function'
                        ? window.musicalSlotDiagFmtSec(clipped.startSec)
                        : clipped.startSec,
                end:
                    typeof window.musicalSlotDiagFmtSec === 'function'
                        ? window.musicalSlotDiagFmtSec(clipped.endSec)
                        : clipped.endSec,
                bars: spanBars > 0 ? spanBars : null,
            });
        }
        return { synced, rows };
    }

    function rippleRehearsalMarksForTransportSwap(
        rehearsalIdxA,
        rehearsalIdxB,
        postCounts,
        meterPlan,
        markSecs,
        headPadSwapPair,
    ) {
        if (typeof window.recomposeRehearsalMarksAfterPairSwap !== 'function') {
            return false;
        }
        const master = masterDurationSec();
        const settings = getMeterSettings();
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        const snap =
            typeof window.getRehearsalMarkTrackEventsPersistSnapshot === 'function'
                ? window.getRehearsalMarkTrackEventsPersistSnapshot()
                : [];
        const preMarkBarCounts =
            typeof window.captureMarkSectionTransportBarCounts === 'function' && meterSpec
                ? window.captureMarkSectionTransportBarCounts(snap, master, meterSpec)
                : [];
        return window.recomposeRehearsalMarksAfterPairSwap(
            rehearsalIdxA,
            rehearsalIdxB,
            postCounts,
            {
                markSecs: markSecs,
                countA: meterPlan && meterPlan.countA != null ? meterPlan.countA | 0 : 0,
                countB: meterPlan && meterPlan.countB != null ? meterPlan.countB | 0 : 0,
                preMarkBarCounts: preMarkBarCounts,
                headPadSwapPair: !!headPadSwapPair,
            },
        );
    }

    function buildTransportSwapDestTimelinesFromSlots(slotA, slotB) {
        return {
            a:
                slotA &&
                Number.isFinite(slotA.timelineStartSec) &&
                Number.isFinite(slotA.timelineEndSec)
                    ? { start: slotA.timelineStartSec, end: slotA.timelineEndSec }
                    : null,
            b:
                slotB &&
                Number.isFinite(slotB.timelineStartSec) &&
                Number.isFinite(slotB.timelineEndSec)
                    ? { start: slotB.timelineStartSec, end: slotB.timelineEndSec }
                    : null,
        };
    }

    /** 旧「相手の slot 終端ごと入替」vs 期待「各 label が自分の barCount 分の draw range を持つ」 */
    function logTransportSwapSpanExpectation(stage, slotA, slotB, barA, barB, destTimelines, opt) {
        if (typeof window.musicalSlotDiagLog !== 'function') return;
        const o = opt && typeof opt === 'object' ? opt : {};
        const fmt =
            typeof window.musicalSlotDiagFmtSec === 'function'
                ? window.musicalSlotDiagFmtSec
                : function (v) {
                      return String(v);
                  };
        const legacyDestA = o.legacySlotB
            ? {
                  start: fmt(o.legacySlotB.timelineStartSec),
                  end: fmt(o.legacySlotB.timelineEndSec),
                  bars: barB | 0,
                  mode: 'partner-slot-bounds',
              }
            : null;
        const legacyDestB = o.legacySlotA
            ? {
                  start: fmt(o.legacySlotA.timelineStartSec),
                  end: fmt(o.legacySlotA.timelineEndSec),
                  bars: barA | 0,
                  mode: 'partner-slot-bounds',
              }
            : null;
        const expectedA = o.legacySlotB
            ? {
                  start: fmt(o.legacySlotB.timelineStartSec),
                  end: fmt(
                      transportEndSecForBarSpanAtStart(
                          o.legacySlotB.timelineStartSec,
                          barA | 0,
                      ),
                  ),
                  bars: barA | 0,
                  mode: 'partner-start-own-bar-count',
              }
            : null;
        const expectedB = o.legacySlotA
            ? {
                  start: fmt(o.legacySlotA.timelineStartSec),
                  end: fmt(
                      transportEndSecForBarSpanAtStart(
                          o.legacySlotA.timelineStartSec,
                          barB | 0,
                      ),
                  ),
                  bars: barB | 0,
                  mode: 'partner-start-own-bar-count',
              }
            : null;
        const labelA = slotRehearsalMarkLabelForTransportSync(slotA);
        const labelB = slotRehearsalMarkLabelForTransportSync(slotB);
        window.musicalSlotDiagLog('swap/span-expect/' + (stage || 'check'), {
            labels: { slotA: labelA || null, slotB: labelB || null },
            transportBarCounts: { barA: barA | 0, barB: barB | 0 },
            marksRippled: !!o.marksRippled,
            legacyCrossSlotDest: { a: legacyDestA, b: legacyDestB },
            ownBarCountDest: { a: expectedA, b: expectedB },
            appliedDest: destTimelines
                ? {
                      a: destTimelines.a
                          ? {
                                start: fmt(destTimelines.a.start),
                                end: fmt(destTimelines.a.end),
                            }
                          : null,
                      b: destTimelines.b
                          ? {
                                start: fmt(destTimelines.b.start),
                                end: fmt(destTimelines.b.end),
                            }
                          : null,
                  }
                : null,
            slotA: slotA
                ? {
                      start: fmt(slotA.timelineStartSec),
                      end: fmt(slotA.timelineEndSec),
                      contentBars: slotA.musical ? slotA.musical.contentBarCount | 0 : 0,
                  }
                : null,
            slotB: slotB
                ? {
                      start: fmt(slotB.timelineStartSec),
                      end: fmt(slotB.timelineEndSec),
                      contentBars: slotB.musical ? slotB.musical.contentBarCount | 0 : 0,
                  }
                : null,
            drawSync: o.drawSync || undefined,
            note: 'FAIL if appliedDest uses partner bar counts instead of each slot own barA/barB at own label mark-draw',
        });
    }

    /** postCounts の rehearsal 区間へ slot timeline を合わせる（非対称 swap 後） */
    function applySlotTimelineFromCountsRange(slot, counts, rehearsalIdxOverride) {
        if (!slot || !slot.musical || !counts || !counts.length) return false;
        const idx =
            Number.isFinite(rehearsalIdxOverride) && (rehearsalIdxOverride | 0) >= 0
                ? rehearsalIdxOverride | 0
                : slot.musical.rehearsalSlotIndex | 0;
        if (idx < 0 || idx >= counts.length) return false;
        const ranges = rehearsalRangesFromCounts(counts);
        const r = ranges[idx];
        if (!r || !Number.isFinite(r.startSec)) return false;
        slot.timelineStartSec = r.startSec;
        const bars = counts[idx] | 0;
        if (bars > 0) {
            const end = transportEndSecForBarSpanAtStart(r.startSec, bars);
            slot.timelineEndSec = Number.isFinite(end) ? end : r.endSec;
        } else {
            slot.timelineEndSec = r.endSec;
        }
        slot.musical.rehearsalBarCount = bars;
        if (slot.kind !== 'silent') {
            slot.musical.contentBarCount = bars;
        }
        return true;
    }

    /**
     * 非対称 partial swap — slot timeline 同期（transport-swap 実行本体）。
     *
     * 流れ（順序固定）:
     *   1. useBarCountDest → applyTransportSwapPairBarCountDestSpans（ペア = postCounts）
     *   2. syncSlotsFromMarkDrawRanges（非ペア = mark-draw）
     *   3. assignEvictedSlotsToUnusedMarkDrawRanges（退避 slot）
     *
     * barA/barB は各 slot の自小節数。destMarkLabels は swap 前の自 label（コンテンツ identity）。
     * preSwapPairTimelines は退避区間計算（assignEvicted）専用。配置には使わない。
     */
    function applyAsymmetricPartialSwapSlotTimelines(
        track,
        slots,
        slotA,
        slotB,
        idxA,
        idxB,
        nextCounts,
        mode,
        destTimelines,
        barA,
        barB,
        preSwapPairTimelines,
        rehearsalIdxA,
        rehearsalIdxB,
        partnerMarkLabels,
    ) {
        void mode;
        const pairSkip = [idxA | 0, idxB | 0];
        const bA = barA | 0;
        const bB = barB | 0;
        const segs =
            typeof window.getTrackSegments === 'function'
                ? window.getTrackSegments(track)
                : null;
        const headPadPair = isHeadPadTransportSwapPair(
            slotA,
            slotB,
            track,
            segs,
            preSwapPairTimelines,
        );
        const transportDestOpt = {
            barA: bA,
            barB: bB,
            destMarkLabels: partnerMarkLabels,
            preferMarkDrawDest:
                bA > 0 && bB > 0 && bA !== bB && !headPadPair,
            preSwapPairTimelines: preSwapPairTimelines,
            track: track,
            segments: segs,
            headPadSwapPair: headPadPair,
        };
        const useBarCountDest =
            bA > 0 &&
            bB > 0 &&
            bA !== bB &&
            slotA &&
            slotB &&
            nextCounts &&
            nextCounts.length;
        let seedUsedRangeKeys = null;

        if (useBarCountDest) {
            applyTransportSwapPairBarCountDestSpans(
                slotA,
                slotB,
                nextCounts,
                rehearsalIdxA,
                rehearsalIdxB,
                transportDestOpt,
            );
            seedUsedRangeKeys = buildTransportSwapPairUsedMarkRangeKeys(slotA, slotB);
            refreshSlotMeterBarStartFromTransport(slotA, { preserveBarCounts: true });
            refreshSlotMeterBarStartFromTransport(slotB, { preserveBarCounts: true });
        }

        const drawSync = syncSlotsFromMarkDrawRanges(slots, {
            track,
            skipSlotIndices: pairSkip,
            seedUsedRangeKeys: seedUsedRangeKeys,
        });

        if (useBarCountDest) {
            assignEvictedSlotsToUnusedMarkDrawRanges(
                slots,
                drawSync,
                pairSkip,
                seedUsedRangeKeys,
                track,
                {
                    preSwapPairTimelines: preSwapPairTimelines,
                    slotA: slotA,
                    slotB: slotB,
                },
            );
            return drawSync;
        }

        if (drawSync.synced >= 2) {
            refreshSlotMeterBarStartFromTransport(slotA);
            refreshSlotMeterBarStartFromTransport(slotB);
            return drawSync;
        }
        if (
            destTimelines &&
            destTimelines.a &&
            destTimelines.b &&
            Number.isFinite(destTimelines.a.start) &&
            Number.isFinite(destTimelines.a.end) &&
            Number.isFinite(destTimelines.b.start) &&
            Number.isFinite(destTimelines.b.end)
        ) {
            slotA.timelineStartSec = destTimelines.a.start;
            slotA.timelineEndSec = destTimelines.a.end;
            slotB.timelineStartSec = destTimelines.b.start;
            slotB.timelineEndSec = destTimelines.b.end;
        } else {
            swapPartialSlotTimelinePair(slotA, slotB);
        }
        preserveNonSwapSlotTimelinesFromLiveSegments(track, slots, pairSkip);
        refreshSlotMeterBarStartFromTransport(slotA);
        refreshSlotMeterBarStartFromTransport(slotB);
        return drawSync;
    }

    /** transport-swap — segment コピー上でリージョン In/Out を destination スパンへ（音源より slot が長い場合は右端まで伸ばす） */
    function stretchSwapUnitToDestSpan(track, segments, unitIndices, targetInSec, targetOutSec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (
            !unitIndices ||
            !unitIndices.length ||
            !Number.isFinite(targetInSec) ||
            !Number.isFinite(targetOutSec) ||
            targetOutSec <= targetInSec + 1e-6
        ) {
            return false;
        }
        let leader = unitIndices[0] | 0;
        for (let ui = 1; ui < unitIndices.length; ui++) {
            leader = Math.min(leader, unitIndices[ui] | 0);
        }
        const seg = segments[leader];
        if (!seg) return false;
        const minSec =
            typeof PLAYBACK_REGION_MIN_SEC !== 'undefined'
                ? PLAYBACK_REGION_MIN_SEC
                : 0.01;
        const identityIn = Number(o.identitySourceIn);
        const identityOut = Number(o.identitySourceOut);
        const hasIdentity =
            Number.isFinite(identityIn) &&
            Number.isFinite(identityOut) &&
            identityOut > identityIn + 1e-6;
        let sourceIn = Number(seg.sourceInSec) || 0;
        let sourceOut = Number(seg.sourceOutSec) || 0;
        if (hasIdentity) {
            sourceIn = identityIn;
            sourceOut = identityOut;
        }
        const sourceSpan = Math.max(minSec, sourceOut - sourceIn);
        const spanDur = Math.max(minSec, targetOutSec - targetInSec);
        const beforeOut =
            typeof window.segmentCopyRegionOut === 'function'
                ? window.segmentCopyRegionOut(seg)
                : NaN;
        seg.sourceInSec = sourceIn;
        seg.regionTimelineInSec = targetInSec;
        seg.timelineStartSec = targetInSec;
        if (sourceSpan > spanDur + 1e-6) {
            seg.sourceOutSec = Math.min(sourceOut, sourceIn + spanDur);
            delete seg.regionTimelineOutSec;
        } else if (
            o.fillSourceToSpan &&
            !hasIdentity &&
            spanDur > sourceSpan + 1e-6
        ) {
            // mark 小節スナップで slot がわずかに伸びたとき — source が足りるときだけ伸ばす。
            // 非対称 transport-swap で相手 barCount 分に届かない場合は padding を維持。
            let wantOut = sourceIn + spanDur;
            if (typeof window.getTrackSourceDurationSec === 'function') {
                const fullDur = window.getTrackSourceDurationSec(track);
                if (Number.isFinite(fullDur) && fullDur > sourceIn + minSec) {
                    wantOut = Math.min(wantOut, fullDur);
                }
            }
            if (wantOut >= sourceIn + spanDur - 1e-6) {
                seg.sourceOutSec = Math.max(sourceIn + minSec, wantOut);
                delete seg.regionTimelineOutSec;
            } else {
                seg.sourceOutSec = sourceOut;
                seg.regionTimelineOutSec = targetOutSec;
            }
        } else {
            seg.sourceOutSec = sourceOut;
            if (spanDur > sourceSpan + 1e-6) {
                seg.regionTimelineOutSec = targetOutSec;
            } else {
                delete seg.regionTimelineOutSec;
            }
        }
        const afterOut =
            typeof window.segmentCopyRegionOut === 'function'
                ? window.segmentCopyRegionOut(seg)
                : NaN;
        if (typeof window.musicalSlotDiagLog === 'function') {
            window.musicalSlotDiagLog('swap/stretch-unit', {
                region: leader + 1,
                targetIn:
                    typeof window.musicalSlotDiagFmtSec === 'function'
                        ? window.musicalSlotDiagFmtSec(targetInSec)
                        : targetInSec,
                targetOut:
                    typeof window.musicalSlotDiagFmtSec === 'function'
                        ? window.musicalSlotDiagFmtSec(targetOutSec)
                        : targetOutSec,
                beforeOut:
                    typeof window.musicalSlotDiagFmtSec === 'function'
                        ? window.musicalSlotDiagFmtSec(beforeOut)
                        : beforeOut,
                afterOut:
                    typeof window.musicalSlotDiagFmtSec === 'function'
                        ? window.musicalSlotDiagFmtSec(afterOut)
                        : afterOut,
                anchor: seg.timelineStartSec,
                sourceDur: Math.max(0, seg.sourceOutSec - seg.sourceInSec),
                extendedOut: Number.isFinite(seg.regionTimelineOutSec),
                identityPreserved: hasIdentity,
            });
        }
        return true;
    }

    function stretchTransportSwapPairOnSegments(
        track,
        slots,
        segments,
        swapPairIndices,
        destTimelines,
        stretchOpt,
    ) {
        const stretchCtx =
            stretchOpt && typeof stretchOpt === 'object' ? stretchOpt : null;
        if (!destTimelines || !Array.isArray(swapPairIndices) || swapPairIndices.length < 2) {
            return 0;
        }
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        let n = 0;
        for (let pi = 0; pi < swapPairIndices.length; pi++) {
            const slotIdx = swapPairIndices[pi] | 0;
            const slot = slots[slotIdx];
            if (
                !slot ||
                slot.kind === 'silent' ||
                !slot.segmentRefs ||
                !slot.segmentRefs.length
            ) {
                continue;
            }
            const span = resolveTransportSwapDestSpanForSlot(
                slotIdx,
                slot,
                destTimelines,
                swapPairIndices,
            );
            if (!span) continue;
            let targetOut = span.end;
            if (master > 0 && targetOut > master) targetOut = master;
            const indices = slot.segmentRefs.map((r) => r.segmentIndex | 0);
            let unitStretchOpt = null;
            if (
                stretchCtx &&
                stretchCtx.preserveSourceIdentity &&
                stretchCtx.preSwapPairSegmentSources &&
                stretchCtx.slotA &&
                stretchCtx.slotB
            ) {
                const bounds = identitySourceBoundsForSwapSegment(
                    indices[0] | 0,
                    stretchCtx.slotA,
                    stretchCtx.slotB,
                    stretchCtx.preSwapPairSegmentSources,
                );
                if (bounds) {
                    unitStretchOpt = {
                        identitySourceIn: bounds.in,
                        identitySourceOut: bounds.out,
                        fillSourceToSpan: false,
                    };
                }
            }
            if (
                stretchSwapUnitToDestSpan(
                    track,
                    segments,
                    indices,
                    span.start,
                    targetOut,
                    unitStretchOpt,
                )
            ) {
                n++;
            }
        }
        return n;
    }

    /** transport-swap finalize — mark draw 境界へ全 slot の segment 幾何を密封 */
    function sealTransportSwapSlotBoundaries(track, slots, segments, t0) {
        if (
            !track ||
            !slots ||
            !segments ||
            typeof window.alignRegionSwapUnitToSlotSpan !== 'function'
        ) {
            return 0;
        }
        let sealed = 0;
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (
                !slot ||
                slot.kind === 'silent' ||
                !slot.segmentRefs ||
                !slot.segmentRefs.length
            ) {
                continue;
            }
            if (
                track &&
                isPickupHeadSlotForTransportSync(track, slot, segments)
            ) {
                continue;
            }
            if (
                !Number.isFinite(slot.timelineStartSec) ||
                !Number.isFinite(slot.timelineEndSec) ||
                slot.timelineEndSec <= slot.timelineStartSec + 1e-6
            ) {
                continue;
            }
            const indices = slot.segmentRefs.map((r) => r.segmentIndex | 0);
            window.alignRegionSwapUnitToSlotSpan(
                track,
                segments,
                indices,
                slot.timelineStartSec,
                slot.timelineEndSec,
            );
            sealed++;
        }
        return sealed;
    }

    /**
     * transport-swap finalize — mark スナップ後 seal で regionTimelineOutSec パディングが
     * 付いた unit の source 長を slot span へ再フィット（B/A 末尾の平坦無音対策）。
     */
    function refitTransportSwapSegmentSourcesToSlotSpans(track, slots, segments, refitOpt) {
        const o = refitOpt && typeof refitOpt === 'object' ? refitOpt : {};
        if (!track || !Array.isArray(slots) || !slots.length || !segments) return 0;
        const pairSkip =
            o.swapPairIndices && o.swapPairIndices.length
                ? new Set(o.swapPairIndices.map((v) => v | 0))
                : null;
        let refit = 0;
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (
                !slot ||
                slot.kind === 'silent' ||
                !slot.segmentRefs ||
                !slot.segmentRefs.length
            ) {
                continue;
            }
            if (isPickupHeadSlotForTransportSync(track, slot, segments)) {
                continue;
            }
            if (
                !Number.isFinite(slot.timelineStartSec) ||
                !Number.isFinite(slot.timelineEndSec) ||
                slot.timelineEndSec <= slot.timelineStartSec + 1e-6
            ) {
                continue;
            }
            const indices = slot.segmentRefs.map((r) => r.segmentIndex | 0);
            let stretchUnitOpt = { fillSourceToSpan: true };
            if (
                pairSkip &&
                pairSkip.has(i | 0) &&
                o.preserveSourceIdentity &&
                o.preSwapPairSegmentSources &&
                o.slotA &&
                o.slotB
            ) {
                const bounds = identitySourceBoundsForSwapSegment(
                    indices[0] | 0,
                    o.slotA,
                    o.slotB,
                    o.preSwapPairSegmentSources,
                );
                if (bounds) {
                    stretchUnitOpt = {
                        identitySourceIn: bounds.in,
                        identitySourceOut: bounds.out,
                        fillSourceToSpan: false,
                    };
                }
            }
            if (
                stretchSwapUnitToDestSpan(
                    track,
                    segments,
                    indices,
                    slot.timelineStartSec,
                    slot.timelineEndSec,
                    stretchUnitOpt,
                )
            ) {
                refit++;
            }
        }
        if (refit && typeof window.musicalSlotDiagLog === 'function') {
            window.musicalSlotDiagLog('swap/refit-sources-to-slot-spans', {
                ex: track.slot + 1,
                refit,
            });
        }
        return refit;
    }

    function resolveTransportSwapDestSpanForSlot(slotIdx, slot, destTimelines, swapPairIndices) {
        if (
            destTimelines &&
            Array.isArray(swapPairIndices) &&
            swapPairIndices.length >= 2
        ) {
            const aIdx = swapPairIndices[0] | 0;
            const bIdx = swapPairIndices[1] | 0;
            const key =
                (slotIdx | 0) === aIdx ? 'a' : (slotIdx | 0) === bIdx ? 'b' : null;
            const dest = key ? destTimelines[key] : null;
            if (
                dest &&
                Number.isFinite(dest.start) &&
                Number.isFinite(dest.end) &&
                dest.end > dest.start + 1e-6
            ) {
                return { start: dest.start, end: dest.end };
            }
        }
        if (
            !slot ||
            !Number.isFinite(slot.timelineStartSec) ||
            !Number.isFinite(slot.timelineEndSec) ||
            slot.timelineEndSec <= slot.timelineStartSec + 1e-6
        ) {
            return null;
        }
        return { start: slot.timelineStartSec, end: slot.timelineEndSec };
    }

    /** transport-swap finalize — 入れ替えペアだけ segment 幾何を slot timeline へ反映 */
    function repositionSwapPairSlotsToSegments(track, slots, segments, idxA, idxB, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const t0 =
            typeof window.getTrackTimelineStartSec === 'function'
                ? window.getTrackTimelineStartSec(track)
                : 0;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        let moved = 0;
        const pair = [idxA | 0, idxB | 0];
        const swapPairIndices =
            o.swapPairIndices && o.swapPairIndices.length >= 2
                ? o.swapPairIndices
                : pair;
        for (let pi = 0; pi < pair.length; pi++) {
            const slotIdx = pair[pi];
            const slot = slots[slotIdx];
            if (
                !slot ||
                slot.kind === 'silent' ||
                !slot.segmentRefs ||
                !slot.segmentRefs.length
            ) {
                continue;
            }
            const span = resolveTransportSwapDestSpanForSlot(
                slotIdx,
                slot,
                o.destTimelines,
                swapPairIndices,
            );
            if (!span) continue;
            const indices = slot.segmentRefs.map((r) => r.segmentIndex | 0);
            if (typeof window.repositionRegionSwapUnitToTimelineSec === 'function') {
                window.repositionRegionSwapUnitToTimelineSec(
                    track,
                    segments,
                    indices,
                    span.start,
                    t0,
                );
            }
            stretchSwapUnitToDestSpan(
                track,
                segments,
                indices,
                span.start,
                master > 0 && span.end > master ? master : span.end,
            );
            moved++;
        }
        return moved;
    }

    function repositionRippledSlotsToSegments(track, slots, segments, skipSlotIndices, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const skip = new Set();
        if (Array.isArray(skipSlotIndices)) {
            for (let si = 0; si < skipSlotIndices.length; si++) {
                skip.add(skipSlotIndices[si] | 0);
            }
        }
        const t0 =
            typeof window.getTrackTimelineStartSec === 'function'
                ? window.getTrackTimelineStartSec(track)
                : 0;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        let moved = 0;
        for (let i = 0; i < slots.length; i++) {
            if (skip.has(i)) continue;
            const slot = slots[i];
            if (
                !slot ||
                slot.kind === 'silent' ||
                !slot.segmentRefs ||
                !slot.segmentRefs.length
            ) {
                continue;
            }
            if (!Number.isFinite(slot.timelineStartSec)) continue;
            const indices = slot.segmentRefs.map((r) => r.segmentIndex | 0);
            if (
                track &&
                (isPickupHeadSlotForTransportSync(track, slot, segments) ||
                    (typeof window.isHeadPadAnchoredSwapSlot === 'function' &&
                        window.isHeadPadAnchoredSwapSlot(track, slot, segments)))
            ) {
                continue;
            }
            if (
                o.partialRegionSwap &&
                Number.isFinite(slot.timelineEndSec) &&
                slot.timelineEndSec > slot.timelineStartSec + 1e-6 &&
                typeof window.fitPartialSwapUnitToTimelineSpan === 'function'
            ) {
                let targetOut = slot.timelineEndSec;
                if (master > 0 && targetOut > master) targetOut = master;
                window.fitPartialSwapUnitToTimelineSpan(
                    track,
                    segments,
                    indices,
                    slot.timelineStartSec,
                    targetOut,
                );
            } else if (typeof window.repositionRegionSwapUnitToTimelineSec === 'function') {
                window.repositionRegionSwapUnitToTimelineSec(
                    track,
                    segments,
                    indices,
                    slot.timelineStartSec,
                    t0,
                );
            }
            moved += 1;
        }
        syncSlotTimelineBoundsFromSegmentCopies(track, slots, segments);
        return moved;
    }

    /**
     * 非対称 Rehearsal 入れ替え — meter splice / counts / mark ripple を原子実行。
     * リージョン配置は呼び出し側で swapPartialSlotTimelinePair + layout へ委譲。
     */
    function recomposeAsymmetricRehearsalPairSwap(plan, rehearsalIdxA, rehearsalIdxB, preCounts, postCounts, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!plan) return false;

        const markSecs =
            plan.markSecs ||
            (plan.transportSpanA && plan.transportSpanB
                ? [plan.transportSpanA.startSec, plan.transportSpanB.startSec]
                : null);

        if (typeof window.musicalSlotDiagLog === 'function') {
            window.musicalSlotDiagLog('swap/recompose/begin', {
                rehearsalIdxA: (rehearsalIdxA | 0) + 1,
                rehearsalIdxB: (rehearsalIdxB | 0) + 1,
                preCounts: preCounts ? preCounts.slice(0, 12) : [],
                postCounts: Array.isArray(postCounts) ? postCounts.slice(0, 12) : [],
                countA: plan.countA | 0,
                countB: plan.countB | 0,
                markSecs: markSecs,
                plan: plan,
            });
        }

        if (typeof window.swapTempoSignatureForBarRanges !== 'function') return false;
        plan.markSecs = markSecs;
        const meterInPlace = !!o.meterInPlace;
        let meterOk = true;
        if (meterInPlace) {
            if (typeof window.captureTransportSwapMeterSlices === 'function') {
                plan.preSwapMeterSlices = window.captureTransportSwapMeterSlices(
                    markSecs,
                    plan.countA,
                    plan.countB,
                    { skipSessionPersist: !!o.skipSessionPersist },
                );
            }
            if (!plan.preSwapMeterSlices) {
                meterOk = false;
            }
            if (typeof window.musicalSlotDiagLog === 'function') {
                window.musicalSlotDiagLog('swap/recompose/meter-deferred', {
                    reason: 'transport-swap-mark-ripple',
                    captured: !!plan.preSwapMeterSlices,
                });
            }
        } else {
            const meterSwapFn =
                typeof window.swapTempoSignatureForBarRangesInPlace === 'function'
                    ? window.swapTempoSignatureForBarRangesInPlace
                    : window.swapTempoSignatureForBarRanges;
            meterOk = meterSwapFn(
                plan.rawStartA != null ? plan.rawStartA : plan.startA,
                plan.countA,
                plan.rawStartB != null ? plan.rawStartB : plan.startB,
                plan.countB,
                {
                    skipSessionPersist: !!o.skipSessionPersist,
                    rawStartA: plan.rawStartA,
                    rawStartB: plan.rawStartB,
                    markSecs: markSecs,
                },
            );
        }
        if (!meterOk) {
            if (typeof window.musicalSlotDiagLog === 'function') {
                window.musicalSlotDiagLog('swap/recompose/rejected', { reason: 'meter-swap-failed' });
            }
            return false;
        }

        const lo = rehearsalIdxA | 0;
        const hi = rehearsalIdxB | 0;
        const countsChanged =
            Array.isArray(preCounts) &&
            Array.isArray(postCounts) &&
            preCounts.length &&
            postCounts.length &&
            lo >= 0 &&
            hi >= 0 &&
            lo < postCounts.length &&
            hi < postCounts.length &&
            ((postCounts[lo] | 0) !== (preCounts[lo] | 0) ||
                (postCounts[hi] | 0) !== (preCounts[hi] | 0));

        if (
            countsChanged &&
            typeof window.applyRehearsalGroupBarCountsForRegionSwap === 'function'
        ) {
            window.applyRehearsalGroupBarCountsForRegionSwap(postCounts, {
                skipUndo: true,
                relayoutRegions: false,
                skipSessionPersist: !!o.skipSessionPersist,
                skipGridRedraw: true,
            });
        }

        if (typeof window.musicalSlotDiagLog === 'function') {
            window.musicalSlotDiagLog('swap/recompose/marks-deferred', {
                phase: 1,
                reason: 'finalize-only-marker-sync',
            });
        }

        if (typeof window.clearMusicalGridPositionCache === 'function') {
            window.clearMusicalGridPositionCache();
        }
        if (typeof window.musicalSlotDiagLog === 'function') {
            window.musicalSlotDiagLog('swap/recompose/done', {
                rehearsalIdxA: (rehearsalIdxA | 0) + 1,
                rehearsalIdxB: (rehearsalIdxB | 0) + 1,
                postCounts: Array.isArray(postCounts) ? postCounts.slice(0, 12) : [],
                countsApplied: countsChanged,
            });
        }
        return true;
    }

    function rehearsalSnapTargetForSlot(track, slot, segments) {
        if (!slot.musical || slot.musical.rehearsalSlotIndex < 0) return null;
        const rehearsalIdx = slot.musical.rehearsalSlotIndex | 0;
        const leader = slot.segmentRefs[0].segmentIndex | 0;
        if (typeof window.rehearsalSlotRegionInTargetSec === 'function') {
            return window.rehearsalSlotRegionInTargetSec(track, rehearsalIdx, leader, segments);
        }
        if (typeof window.rehearsalSlotPlacementSec === 'function') {
            return window.rehearsalSlotPlacementSec(rehearsalIdx);
        }
        const counts =
            typeof window.getExpandedRehearsalGroupBarCountsSnapshot === 'function'
                ? window.getExpandedRehearsalGroupBarCountsSnapshot()
                : [];
        return slotStartSecFromCounts(counts, rehearsalIdx);
    }

    /** Phase 4 — Rehearsal スロット先頭への sub-frame 端数 snap */
    function snapAudioSlotsToRehearsalTargets(track, slots, segments, t0) {
        const eps = segmentBoundaryEps();
        const maxSnapDrift = eps * 8;
        let snapped = 0;
        const details = [];

        if (
            typeof window.getMusicalGridRehearsalFillVisible !== 'function' ||
            !window.getMusicalGridRehearsalFillVisible() ||
            typeof window.repositionRegionSwapUnitToTimelineSec !== 'function' ||
            !slots ||
            !segments
        ) {
            return { snapped, details };
        }

        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (slot.kind === 'silent' || !slot.segmentRefs || !slot.segmentRefs.length) continue;
            if (!slot.musical) continue;
            if (
                track &&
                (isPickupHeadSlotForTransportSync(track, slot, segments) ||
                    (typeof window.isHeadPadAnchoredSwapSlot === 'function' &&
                        window.isHeadPadAnchoredSwapSlot(track, slot, segments)))
            ) {
                continue;
            }
            const target = rehearsalSnapTargetForSlot(track, slot, segments);
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
                rehearsal: (slot.musical.rehearsalSlotIndex | 0) + 1,
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
            const prevRehearsal =
                prev.musical && prev.musical.rehearsalSlotIndex >= 0
                    ? prev.musical.rehearsalSlotIndex | 0
                    : null;
            const curRehearsal =
                cur.musical && cur.musical.rehearsalSlotIndex >= 0
                    ? cur.musical.rehearsalSlotIndex | 0
                    : null;
            if (prevRehearsal != null && curRehearsal != null && prevRehearsal !== curRehearsal) {
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
    function resolveLayoutCorrections(track, segments, t0, slots, opt) {
        if (!segments || !segments.length) return false;
        const o = opt && typeof opt === 'object' ? opt : {};

        const snapReport = o.skipRehearsalSnap
            ? { snapped: 0, details: [] }
            : snapAudioSlotsToRehearsalTargets(track, slots, segments, t0);
        const xfReport = applyShortCrossfadeAtUnitBoundaries(track, slots, segments, t0);

        let overlapReport = { crossfade: false, overlaps: [] };
        if (typeof window.finalizeSegmentCopyTimelineLayout === 'function') {
            overlapReport = window.finalizeSegmentCopyTimelineLayout(
                track,
                segments,
                t0,
                'slot-layout',
                { skipMicroGapClose: !!o.skipMicroGapClose },
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

    function resolveRehearsalIndexAtRegionInSec(startSec, ranges, eps, endSecOpt) {
        if (!Number.isFinite(startSec)) return null;
        const s = Number(startSec);
        const endSec = Number(endSecOpt);
        if (Number.isFinite(endSec) && endSec > s + eps) {
            let bestIdx = null;
            let bestOverlap = 0;
            for (let i = 0; i < ranges.length; i++) {
                const r = ranges[i];
                const overlapStart = Math.max(s, r.startSec);
                const overlapEnd = Math.min(endSec, r.endSec);
                const overlap = Math.max(0, overlapEnd - overlapStart);
                if (overlap > bestOverlap) {
                    bestOverlap = overlap;
                    bestIdx = i;
                }
            }
            if (bestIdx != null) return bestIdx;
        }
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (s >= r.startSec - eps && s < r.endSec - eps) return i;
        }
        if (typeof window.resolveRehearsalGroupIndexAtTransportSec === 'function') {
            const idx = window.resolveRehearsalGroupIndexAtTransportSec(s);
            return idx != null && idx >= 0 ? idx | 0 : null;
        }
        return null;
    }

    /** タイムライン in/out から小節数を推定（非対称スワップ後の stretch 向け） */
    function estimateContentBarCountFromSlotTimelineSpan(slot, countsOpt) {
        if (
            !slot ||
            slot.kind === 'silent' ||
            !Number.isFinite(slot.timelineStartSec) ||
            !Number.isFinite(slot.timelineEndSec)
        ) {
            return 0;
        }
        const spanSec = slot.timelineEndSec - slot.timelineStartSec;
        if (!(spanSec > 0.001)) return 0;
        const counts =
            countsOpt && countsOpt.length
                ? countsOpt
                : typeof window.getExpandedRehearsalGroupBarCountsSnapshot === 'function'
                  ? window.getExpandedRehearsalGroupBarCountsSnapshot()
                  : [];
        if (!counts.length) return 0;
        const ranges = rehearsalRangesFromCounts(counts);
        const eps = segmentBoundaryEps();
        const idx = resolveRehearsalIndexAtRegionInSec(
            slot.timelineStartSec,
            ranges,
            eps,
            slot.timelineEndSec,
        );
        if (idx == null || idx < 0 || idx >= counts.length) return 0;
        const r = ranges[idx];
        const bars = counts[idx] | 0;
        if (!(bars > 0) || !r) return 0;
        const slotDur = r.endSec - r.startSec;
        if (!(slotDur > 0.00001)) return bars;
        const barDur = slotDur / bars;
        const spanBars = Math.max(1, Math.round(spanSec / barDur));
        if (spanSec >= slotDur - eps * 4 || spanBars >= bars - 1) {
            return bars;
        }
        return spanBars;
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
                            const splitGroups = splitIndicesIfCrossRehearsalJoin(track, unitIndices);
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
                        Number.isFinite(gap.rehearsalIndex) && gap.rehearsalIndex >= 0
                            ? {
                                  rehearsalSlotIndex: gap.rehearsalIndex | 0,
                                  rehearsalBarCount:
                                      Number.isFinite(gap.rehearsalBarCount) &&
                                      gap.rehearsalBarCount > 0
                                          ? gap.rehearsalBarCount | 0
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
            typeof window.getExpandedRehearsalGroupBarCountsSnapshot === 'function'
                ? window.getExpandedRehearsalGroupBarCountsSnapshot()
                : [];
        let ranges =
            typeof window.getRehearsalGroupRangesSnapshot === 'function'
                ? window.getRehearsalGroupRangesSnapshot()
                : [];
        if (!ranges.length && counts.length) {
            ranges = rehearsalRangesFromCounts(counts);
        }
        const eps = segmentBoundaryEps();

        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (o.preserveStored && slot.musical && slot.musical.rehearsalBarCount > 0) {
                const content = slot.musical.contentBarCount | 0;
                const rehearsal = slot.musical.rehearsalBarCount | 0;
                if (
                    content <= 1 &&
                    rehearsal > 1 &&
                    !isPickupHeadSlotForTransportSync(track, slot, o.segments)
                ) {
                    slot.musical.contentBarCount = rehearsal;
                }
                const master = masterDurationSec();
                const settings = getMeterSettings();
                const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
                if (
                    master > 0 &&
                    meterSpec &&
                    Number.isFinite(slot.timelineStartSec) &&
                    Number.isFinite(slot.timelineEndSec) &&
                    !isPickupHeadSlotForTransportSync(track, slot, o.segments)
                ) {
                    const spanBars = transportBarCountForDrawRange(
                        {
                            startSec: slot.timelineStartSec,
                            endSec: slot.timelineEndSec,
                        },
                        master,
                        meterSpec,
                        eps,
                    );
                    const curContent = slot.musical.contentBarCount | 0;
                    if (spanBars > 0 && curContent > spanBars) {
                        slot.musical.contentBarCount = spanBars;
                        if ((slot.musical.rehearsalBarCount | 0) > spanBars) {
                            slot.musical.rehearsalBarCount = spanBars;
                        }
                    }
                }
                if ((slot.musical.contentBarCount | 0) > 0) {
                    refreshSlotMeterBarStartFromTransport(slot, {
                        preserveBarCounts: true,
                    });
                } else if (
                    typeof window.syncSlotMusicalMetadataFromTransport === 'function'
                ) {
                    window.syncSlotMusicalMetadataFromTransport(slot);
                }
                if (
                    !(slot.musical.contentBarCount > 0) &&
                    ranges.length &&
                    Number.isFinite(slot.timelineStartSec)
                ) {
                    const inferred = resolveRehearsalIndexAtRegionInSec(
                        slot.timelineStartSec,
                        ranges,
                        eps,
                        slot.timelineEndSec,
                    );
                    const cur = slot.musical.rehearsalSlotIndex | 0;
                    if (
                        inferred != null &&
                        inferred >= 0 &&
                        inferred < counts.length &&
                        inferred !== cur
                    ) {
                        slot.musical.rehearsalSlotIndex = inferred;
                        if (
                            typeof window.syncSlotMusicalMetadataFromTransport ===
                            'function'
                        ) {
                            window.syncSlotMusicalMetadataFromTransport(slot);
                        }
                    }
                }
                continue;
            }
            const startSec = slot.timelineStartSec;
            let rehearsalIdx = resolveRehearsalIndexAtRegionInSec(
                startSec,
                ranges,
                eps,
                slot.timelineEndSec,
            );
            if (
                rehearsalIdx == null &&
                slot.segmentRefs &&
                slot.segmentRefs.length &&
                slot.kind !== 'silent'
            ) {
                rehearsalIdx = slot.segmentRefs[0].segmentIndex | 0;
            } else if (rehearsalIdx == null) {
                rehearsalIdx = i;
            }
            if (
                slot.kind === 'silent' &&
                slot.musical &&
                Number.isFinite(slot.musical.rehearsalSlotIndex) &&
                slot.musical.rehearsalSlotIndex >= 0
            ) {
                rehearsalIdx = slot.musical.rehearsalSlotIndex | 0;
            }

            let meterBarStart = 0;
            for (let c = 0; c < rehearsalIdx && c < counts.length; c++) {
                meterBarStart += counts[c] | 0;
            }

            slot.musical = {
                contentBarCount: 0,
                rehearsalBarCount: 0,
                meterBarStart,
                rehearsalSlotIndex: rehearsalIdx | 0,
            };
            if (typeof window.syncSlotMusicalMetadataFromTransport === 'function') {
                window.syncSlotMusicalMetadataFromTransport(slot);
            }
            if (!(slot.musical.rehearsalBarCount > 0)) {
                slot.musical.rehearsalBarCount = counts[rehearsalIdx | 0] | 0;
            }
            if (slot.kind !== 'silent' && !(slot.musical.contentBarCount > 0)) {
                slot.musical.contentBarCount = slot.musical.rehearsalBarCount | 0;
            }
            if (
                slot.kind === 'silent' &&
                Number.isFinite(slot.musical.rehearsalBarCount) &&
                slot.musical.rehearsalBarCount > 0
            ) {
                slot.musical.rehearsalBarCount = slot.musical.rehearsalBarCount | 0;
            }
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
            if (persisted && persisted.length && persistedTimelineSlotsHaveSegmentRefs(persisted)) {
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
            !o.forceRebuild &&
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
        if (!o.forceRebuild) {
            const persistedSlots = resolveUsablePersistedTimelineSlots(track);
            if (persistedSlots) {
                let slots = inferMusicalBindingsForTrack(track, persistedSlots, {
                    preserveStored: true,
                });
                if (o.writeCache !== false) {
                    cacheTrackTimelineSlots(track, slots);
                } else if (ex >= 0 && !o.skipReadCacheStore) {
                    storeTrackTimelineSlotsReadCache(track, slots, preserveStored);
                }
                return slots;
            }
        }
        timelineSlotsBuildDepth += 1;
        let slots;
        try {
            slots = buildTrackTimelineSlots(track);
            timelineSlotsBuildScratch = slots;
            slots = inferMusicalBindingsForTrack(track, slots, {
                preserveStored,
            });
            timelineSlotsBuildScratch = slots;
            if (o.writeCache !== false) {
                cacheTrackTimelineSlots(track, slots);
            } else if (ex >= 0 && !o.skipReadCacheStore) {
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
            s.musical && s.musical.rehearsalBarCount > 0
                ? s.musical.rehearsalBarCount | 0
                : s.musical && s.musical.contentBarCount > 0
                  ? s.musical.contentBarCount | 0
                  : 0,
        );
        if (!counts.some((n) => n > 0)) return false;
        if (typeof window.applyRehearsalGroupBarCountsForRegionSwap !== 'function') {
            return false;
        }
        window.applyRehearsalGroupBarCountsForRegionSwap(counts, { skipUndo: !!o.skipUndo });
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

    /** Phase 2 — slots から segment 幾何プレビューを構築（live commit しない） */
    function buildPreviewSegmentsFromSlots(track, slots, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (
            typeof window.getTrackSegments !== 'function' ||
            typeof window.repositionRegionSwapUnitToTimelineSec !== 'function'
        ) {
            return { segments: null, t0: 0 };
        }
        const segments = window.getTrackSegments(track).map((s) => Object.assign({}, s));
        const t0 =
            typeof window.getTrackTimelineStartSec === 'function'
                ? window.getTrackTimelineStartSec(track)
                : 0;
        if (typeof window.snapshotSegmentTimelineAnchorsOnCopies === 'function') {
            window.snapshotSegmentTimelineAnchorsOnCopies(track, segments);
        }
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const transportSwapPair = new Set();
        let transportDestBySlot = null;
        if (o.transportSwap && Array.isArray(o.swapPairIndices)) {
            transportDestBySlot = new Map();
            for (let pi = 0; pi < o.swapPairIndices.length; pi++) {
                const slotIdx = o.swapPairIndices[pi] | 0;
                transportSwapPair.add(slotIdx);
                if (
                    o.transportDestTimelines &&
                    pi === 0 &&
                    o.transportDestTimelines.a
                ) {
                    transportDestBySlot.set(slotIdx, o.transportDestTimelines.a);
                } else if (
                    o.transportDestTimelines &&
                    pi === 1 &&
                    o.transportDestTimelines.b
                ) {
                    transportDestBySlot.set(slotIdx, o.transportDestTimelines.b);
                }
            }
        }
        if (o.meterInPlaceOnly) {
            return { segments, t0 };
        }
        // 音源 sourceIn/Out の交換は finalizeSlotSwapPlan で一度だけ行う。
        // preview 段階で swap すると transportSourcesSwapped が立ち finalize が
        // スキップされ、アニメ後 commit との二重/未反映で「動いたが入替わらない」になる。
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (slot.kind === 'silent') continue;
            if (!slot.segmentRefs || !slot.segmentRefs.length) continue;
            if (!Number.isFinite(slot.timelineStartSec)) continue;
            if (isPickupHeadSlotForTransportSync(track, slot, segments)) {
                continue;
            }
            const indices = slot.segmentRefs.map((r) => r.segmentIndex | 0);
            if (
                o.partialRegionSwap &&
                Number.isFinite(slot.timelineStartSec) &&
                Number.isFinite(slot.timelineEndSec) &&
                slot.timelineEndSec > slot.timelineStartSec + 1e-6
            ) {
                let targetIn = slot.timelineStartSec;
                let targetOut = slot.timelineEndSec;
                const destOverride =
                    transportDestBySlot && transportDestBySlot.has(i)
                        ? transportDestBySlot.get(i)
                        : null;
                if (
                    destOverride &&
                    Number.isFinite(destOverride.start) &&
                    Number.isFinite(destOverride.end) &&
                    destOverride.end > destOverride.start + 1e-6
                ) {
                    targetIn = destOverride.start;
                    targetOut = destOverride.end;
                }
                if (master > 0 && targetOut > master) {
                    targetOut = master;
                }
                if (o.asymmetricPartialRecomposed) {
                    window.repositionRegionSwapUnitToTimelineSec(
                        track,
                        segments,
                        indices,
                        targetIn,
                        t0,
                    );
                }
                stretchSwapUnitToDestSpan(
                    track,
                    segments,
                    indices,
                    targetIn,
                    targetOut,
                );
            } else if (Number.isFinite(slot.timelineStartSec)) {
                window.repositionRegionSwapUnitToTimelineSec(
                    track,
                    segments,
                    indices,
                    slot.timelineStartSec,
                    t0,
                );
            }
        }
        syncSlotTimelineBoundsFromSegmentCopies(
            track,
            slots,
            segments,
            o.transportSwap && transportSwapPair.size
                ? { preserveSlotIndices: Array.from(transportSwapPair) }
                : undefined,
        );
        if (!o.skipLayoutCorrections) {
            resolveLayoutCorrections(track, segments, t0, slots);
        }
        if (o.transportDestTimelines && o.swapPairIndices && o.swapPairIndices.length >= 2) {
            if (
                o.preSwapPairSegmentSources &&
                o.slotA &&
                o.slotB &&
                !shouldPreserveTransportSwapPairSourceIdentity(
                    !!o.asymmetricPartialRecomposed,
                    o.barA | 0,
                    o.barB | 0,
                    !!o.headPadSwapPair,
                )
            ) {
                swapTransportSwapPairSegmentSources(
                    track,
                    segments,
                    o.slotA,
                    o.slotB,
                    o.preSwapPairSegmentSources,
                );
            }
            const t0Stretch =
                typeof window.getTrackTimelineStartSec === 'function'
                    ? window.getTrackTimelineStartSec(track)
                    : 0;
            for (let pi = 0; pi < o.swapPairIndices.length; pi++) {
                const slotIdx = o.swapPairIndices[pi] | 0;
                const slot = slots[slotIdx];
                if (
                    !slot ||
                    slot.kind === 'silent' ||
                    !slot.segmentRefs ||
                    !slot.segmentRefs.length
                ) {
                    continue;
                }
                const span = resolveTransportSwapDestSpanForSlot(
                    slotIdx,
                    slot,
                    o.transportDestTimelines,
                    o.swapPairIndices,
                );
                if (!span) continue;
                const indices = slot.segmentRefs.map((r) => r.segmentIndex | 0);
                if (typeof window.repositionRegionSwapUnitToTimelineSec === 'function') {
                    window.repositionRegionSwapUnitToTimelineSec(
                        track,
                        segments,
                        indices,
                        span.start,
                        t0Stretch,
                    );
                }
            }
            stretchTransportSwapPairOnSegments(
                track,
                slots,
                segments,
                o.swapPairIndices,
                o.transportDestTimelines,
                o.asymmetricPartialRecomposed &&
                    o.preSwapPairSegmentSources &&
                    o.slotA &&
                    o.slotB &&
                    shouldPreserveTransportSwapPairSourceIdentity(
                        true,
                        o.barA | 0,
                        o.barB | 0,
                        !!o.headPadSwapPair,
                    )
                    ? {
                          preSwapPairSegmentSources: o.preSwapPairSegmentSources,
                          slotA: o.slotA,
                          slotB: o.slotB,
                          preserveSourceIdentity: true,
                      }
                    : null,
            );
        }
        return {
            segments,
            t0,
        };
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
        const liveSegments = window.getTrackSegments(track);
        const liveSegmentCount = liveSegments.length;

        const metrics =
            typeof getRegionOverlayTimelineMetrics === 'function'
                ? getRegionOverlayTimelineMetrics()
                : null;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        let oldOverlayIntervals = null;
        if (o.anim) {
            if (typeof window.captureTrackRegionOverlayIntervals === 'function') {
                oldOverlayIntervals = window.captureTrackRegionOverlayIntervals(
                    track,
                    liveSegmentCount,
                );
            }
            if (
                !oldOverlayIntervals &&
                metrics &&
                metrics.scrubW > 0 &&
                master > 0 &&
                typeof getSegmentRegionOverlayTimelineInterval === 'function' &&
                typeof transportSecToOverlayPx === 'function'
            ) {
                oldOverlayIntervals = [];
                for (let si = 0; si < liveSegmentCount; si++) {
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
        }

        const segments =
            o.previewSegments && o.previewSegments.length
                ? o.previewSegments.map((s) => Object.assign({}, s))
                : liveSegments.map((s) => Object.assign({}, s));
        const t0 =
            typeof window.getTrackTimelineStartSec === 'function'
                ? window.getTrackTimelineStartSec(track)
                : 0;

        // plan 済み preview を commit する経路では live 位置のスナップショットを入れない
        // （入れると preview の幾形が破棄され、非対称 swap で片側だけ動く見え方になる）
        if (
            (!o.previewSegments || !o.previewSegments.length) &&
            typeof window.snapshotSegmentTimelineAnchorsOnCopies === 'function'
        ) {
            window.snapshotSegmentTimelineAnchorsOnCopies(track, segments);
        }

        const beforeRegionMarkerBounds =
            typeof window.captureTrackSegmentRegionBoundsMap === 'function'
                ? window.captureTrackSegmentRegionBoundsMap(track)
                : null;

        if (!o.previewSegments || !o.previewSegments.length) {
            for (let i = 0; i < slots.length; i++) {
                const slot = slots[i];
                if (slot.kind === 'silent') continue;
                if (!slot.segmentRefs || !slot.segmentRefs.length) continue;
                if (!Number.isFinite(slot.timelineStartSec)) continue;
                if (
                    typeof window.isHeadPadAnchoredSwapSlot === 'function' &&
                    window.isHeadPadAnchoredSwapSlot(track, slot, segments)
                ) {
                    continue;
                }
                const indices = slot.segmentRefs.map((r) => r.segmentIndex | 0);
                if (
                    o.partialRegionSwap &&
                    Number.isFinite(slot.timelineEndSec) &&
                    slot.timelineEndSec > slot.timelineStartSec + 1e-6 &&
                    typeof window.fitPartialSwapUnitToTimelineSpan === 'function'
                ) {
                    let targetOut = slot.timelineEndSec;
                    if (master > 0 && targetOut > master) {
                        targetOut = master;
                    }
                    window.fitPartialSwapUnitToTimelineSpan(
                        track,
                        segments,
                        indices,
                        slot.timelineStartSec,
                        targetOut,
                    );
                } else {
                    window.repositionRegionSwapUnitToTimelineSec(
                        track,
                        segments,
                        indices,
                        slot.timelineStartSec,
                        t0,
                    );
                }
            }

            syncSlotTimelineBoundsFromSegmentCopies(track, slots, segments);

            if (!o.skipLayoutCorrections) {
                resolveLayoutCorrections(track, segments, t0, slots);
            }
        }

        function commitSegments(animOpt) {
            const ao = animOpt && typeof animOpt === 'object' ? animOpt : {};
            const deferRedraw = !!ao.deferRedraw;
            const ok = window.setTrackSegments(track, segments, {
                skipUndo: !!o.skipUndo,
                silent: o.silent !== false,
                deferRedraw,
                geometryOnly: ao.geometryOnly != null ? !!ao.geometryOnly : false,
                skipMusicalRefresh: !!(ao.skipMusicalRefresh || o.skipMusicalRefresh),
                invalidatePeakCache:
                    ao.invalidatePeakCache != null ? ao.invalidatePeakCache : !deferRedraw,
                skipPersist: !!ao.skipPersist,
                skipSyncTransport: !!ao.skipSyncTransport,
            });
            if (ok && typeof window.syncTrackRegionHeadStateFromFirstSegment === 'function') {
                window.syncTrackRegionHeadStateFromFirstSegment(track);
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
            if (
                ok &&
                !o.deferUserMarkerRelayout &&
                beforeRegionMarkerBounds &&
                typeof window.relocateUserTimelineMarkersAfterRegionLayout === 'function'
            ) {
                window.relocateUserTimelineMarkersAfterRegionLayout(
                    track,
                    beforeRegionMarkerBounds,
                    {
                        silent: true,
                        skipSessionFlush: !!o.skipSessionFlush,
                    },
                );
            }
            if (
                ok &&
                !o.deferUserMarkerRelayout &&
                typeof window.clampUserTimelineMarkersToTrackRegions === 'function'
            ) {
                window.clampUserTimelineMarkersToTrackRegions(track, {
                    silent: true,
                    skipSessionFlush: !!o.skipSessionFlush,
                });
            }
            return !!ok;
        }

        function syncSwapPresentation() {
            if (typeof window.syncRegionSwapVisualPresentation === 'function') {
                window.syncRegionSwapVisualPresentation(track);
            }
        }

        const anim = o.anim;
        const hasAnim =
            anim && typeof window.playPlaybackRegionSwapAnimation === 'function';
        if (hasAnim) {
            const deferCommitForAnim = o.previewSegments && o.previewSegments.length;
            if (
                !deferCommitForAnim &&
                !commitSegments({
                    deferRedraw: true,
                    skipMusicalRefresh: true,
                    skipPersist: true,
                    skipSyncTransport: true,
                    invalidatePeakCache: false,
                })
            ) {
                return false;
            }
            const redrawOpt = { invalidatePeakCache: true };
            const animSpec = {
                track,
                forceTimelineSwap: true,
                previewSegments: segments,
                redrawOpt,
                enableMusicalTrackSwapAnim:
                    typeof window.getMusicalGridVisible === 'function' &&
                    window.getMusicalGridVisible(),
                applySwap: (animOpt) => {
                    const ao = animOpt && typeof animOpt === 'object' ? animOpt : {};
                    return commitSegments({
                        deferRedraw: !!ao.deferRedraw,
                        skipMusicalRefresh: true,
                        skipPersist: !!ao.skipPersist,
                        skipSyncTransport: !!ao.skipSyncTransport,
                        invalidatePeakCache: ao.deferRedraw ? false : true,
                    });
                },
                finalizeSwap:
                    typeof o.finalizeSwap === 'function' ? o.finalizeSwap : function () {},
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
            if (anim.includeSlideMoves) {
                animSpec.includeSlideMoves = true;
            }
            let animResult = false;
            try {
                animResult = window.playPlaybackRegionSwapAnimation(animSpec);
            } catch (animErr) {
                window.musicalSlotDiagLog('swap/animation/error', {
                    message:
                        animErr && animErr.message ? animErr.message : String(animErr),
                });
            }
            window.musicalSlotDiagLog('swap/animation', { result: animResult });
            if (animResult !== 'started') {
                if (deferCommitForAnim) {
                    commitSegments({ skipMusicalRefresh: true });
                }
                if (typeof o.finalizeSwap === 'function') {
                    o.finalizeSwap();
                } else {
                    syncSwapPresentation();
                }
            }
            return true;
        }

        if (!commitSegments({ skipMusicalRefresh: true })) {
            return false;
        }
        if (typeof window.syncRegionSwapVisualPresentation === 'function') {
            window.syncRegionSwapVisualPresentation(track);
        }
        return true;
    }

    /** transport-swap 後 — Tempo/Sig トラック override を meterSpec entries へ反映（小節線・拍線の表示同期） */
    function syncMeterSpecFromTrackEventsAfterInPlaceSwap(opt) {
        if (
            typeof window.rebuildMeterSpecFromTrackEvents !== 'function' ||
            typeof window.getMeterSpec !== 'function'
        ) {
            return false;
        }
        const masterDur =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const spec = window.getMeterSpec();
        if (!spec || !(masterDur > 0)) return false;
        const o = opt && typeof opt === 'object' ? opt : {};
        const next = window.rebuildMeterSpecFromTrackEvents(spec, masterDur, o);
        return !!next;
    }

    /** counts 更新後 — rehearsalSlotIndex に基づき rehearsalBarCount / meterBarStart を同期 */
    function refreshSlotsMusicalFromCounts(slots, counts, opt) {
        if (!slots || !counts || !counts.length) return slots;
        const skip = new Set();
        if (opt && Array.isArray(opt.skipSlotIndices)) {
            for (let si = 0; si < opt.skipSlotIndices.length; si++) {
                skip.add(opt.skipSlotIndices[si] | 0);
            }
        }
        for (let i = 0; i < slots.length; i++) {
            if (skip.has(i)) continue;
            const slot = slots[i];
            if (!slot.musical) continue;
            const idx = slot.musical.rehearsalSlotIndex | 0;
            if (idx < 0 || idx >= counts.length) continue;
            slot.musical.rehearsalBarCount = counts[idx] | 0;
            if (slot.kind !== 'silent') {
                slot.musical.contentBarCount = counts[idx] | 0;
            }
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

    function rehearsalCountsArraysEqual(a, b) {
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
            includeSlideMoves: !!swapAnim.includeSlideMoves,
        };
    }

    function setRegionSwapHistoryAnimHint(
        track,
        swapAnim,
        preSwapRehearsalCounts,
        postSwapRehearsalCounts,
        extra,
    ) {
        if (!track || !swapAnim) {
            regionSwapHistoryAnimHint = null;
            window.regionSwapHistoryAnimHint = null;
            return;
        }
        const o = extra && typeof extra === 'object' ? extra : {};
        regionSwapHistoryAnimHint = {
            trackSlot: track.slot | 0,
            swapAnim: cloneSwapAnimForHistoryHint(swapAnim),
            preSwapRehearsalCounts: preSwapRehearsalCounts ? preSwapRehearsalCounts.slice() : null,
            postSwapRehearsalCounts: postSwapRehearsalCounts ? postSwapRehearsalCounts.slice() : null,
            headPadMarkInsertedForSwap: !!o.headPadMarkInsertedForSwap,
            headPadInsertedMarkLabel: o.headPadInsertedMarkLabel || null,
            preSwapRehearsalMarkTrackEvents: o.preSwapRehearsalMarkTrackEvents
                ? cloneRehearsalMarkTrackEventsForPersist(o.preSwapRehearsalMarkTrackEvents)
                : null,
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
            preSwapRehearsalCounts: hint.preSwapRehearsalCounts
                ? hint.preSwapRehearsalCounts.slice()
                : null,
            postSwapRehearsalCounts: hint.postSwapRehearsalCounts
                ? hint.postSwapRehearsalCounts.slice()
                : null,
            headPadMarkInsertedForSwap: !!hint.headPadMarkInsertedForSwap,
            headPadInsertedMarkLabel: hint.headPadInsertedMarkLabel || null,
            preSwapRehearsalMarkTrackEvents: hint.preSwapRehearsalMarkTrackEvents
                ? cloneRehearsalMarkTrackEventsForPersist(hint.preSwapRehearsalMarkTrackEvents)
                : null,
        };
    }

    function regionSwapHistoryAnimHintMatchesTarget(hint, normalizedTarget) {
        if (!hint || !normalizedTarget) return false;
        const counts = normalizedTarget.rehearsalExpandedCounts;
        if (!counts || !counts.length) return false;
        if (
            hint.preSwapRehearsalCounts &&
            rehearsalCountsArraysEqual(hint.preSwapRehearsalCounts, counts)
        ) {
            return true;
        }
        if (
            hint.postSwapRehearsalCounts &&
            rehearsalCountsArraysEqual(hint.postSwapRehearsalCounts, counts)
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
            includeSlideMoves: !!hintSwapAnim.includeSlideMoves,
        };
    }

    function resolveHistoryRestoreRehearsalCounts(normalizedTarget, hint) {
        if (
            normalizedTarget.rehearsalExpandedCounts &&
            normalizedTarget.rehearsalExpandedCounts.length
        ) {
            return normalizedTarget.rehearsalExpandedCounts;
        }
        if (hint && hint.preSwapRehearsalCounts && hint.preSwapRehearsalCounts.length) {
            return hint.preSwapRehearsalCounts;
        }
        if (hint && hint.postSwapRehearsalCounts && hint.postSwapRehearsalCounts.length) {
            return hint.postSwapRehearsalCounts;
        }
        return null;
    }

    function planRegionHistorySwapAnimationFromHint(normalizedTarget, slotIdx, hint) {
        if (!hint || !hint.swapAnim) return null;
        const track = { type: 'extra', slot: slotIdx | 0 };
        const entry = normalizedTarget.tracks.find((e) => e.slot === slotIdx);
        if (!entry || !entry.playbackRegions) return null;

        const previewRehearsalCounts = resolveHistoryRestoreRehearsalCounts(normalizedTarget, hint);
        const previewSegments =
            typeof window.previewTrackSegmentsFromUndoEntry === 'function'
                ? window.previewTrackSegmentsFromUndoEntry(track, entry, {
                      rehearsalExpandedCounts: previewRehearsalCounts,
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
            targetCounts: previewRehearsalCounts,
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
        const previewRehearsalCounts = resolveHistoryRestoreRehearsalCounts(normalizedTarget, hint);
        const previewSegments =
            typeof window.previewTrackSegmentsFromUndoEntry === 'function'
                ? window.previewTrackSegmentsFromUndoEntry(track, entry, {
                      rehearsalExpandedCounts: previewRehearsalCounts,
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
            targetCounts: previewRehearsalCounts,
            finalizeSwap,
        };
    }

    /** Phase 2 — マーカー再同期（finalize 一本化） */
    function finalizeSlotSwapPlan(plan) {
        if (!plan || !plan.ok) return;
        const track = plan.track;
        const slots = plan.slots;
        const o = plan.opt && typeof plan.opt === 'object' ? plan.opt : {};
        const {
            partialRegionSwap,
            partialRecomposed,
            transportAnchoredSwap,
            segmentRehearsalLabels,
            swapBeforeRegionMarkerBounds,
            swapMode,
            slotA,
            slotB,
            idxA,
            idxB,
            rehearsalIdxA,
            rehearsalIdxB,
            barA,
            barB,
            specCounts,
            nextCounts,
            swapActionMessage,
            swapMeterBarPlan,
        } = plan;

        const asymmetricMarkSecs =
            swapMeterBarPlan && Array.isArray(swapMeterBarPlan.markSecs)
                ? swapMeterBarPlan.markSecs.slice()
                : slotA && slotB
                  ? [slotA.timelineStartSec, slotB.timelineStartSec]
                  : null;

        let marksRecomposed = false;
        let transportSwapFinalize = false;
        invalidateTrackTimelineSlotsReadCache();
        if (typeof window.getTrackSegments === 'function') {
            const liveSegs = window.getTrackSegments(track);
            const masterDur =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : 0;
            let clampedPastMaster = false;
            if (
                partialRegionSwap &&
                masterDur > 0 &&
                typeof window.fitPartialSwapUnitToTimelineSpan === 'function'
            ) {
                const segs = liveSegs.map((s) => Object.assign({}, s));
                for (let si = 0; si < slots.length; si++) {
                    const slot = slots[si];
                    if (
                        !slot ||
                        slot.kind === 'silent' ||
                        !slot.segmentRefs ||
                        !slot.segmentRefs.length
                    ) {
                        continue;
                    }
                    if (
                        track &&
                        isPickupHeadSlotForTransportSync(track, slot, segs)
                    ) {
                        continue;
                    }
                    if (
                        !Number.isFinite(slot.timelineStartSec) ||
                        !Number.isFinite(slot.timelineEndSec)
                    ) {
                        continue;
                    }
                    const indices = slot.segmentRefs.map((r) => r.segmentIndex | 0);
                    const leader = indices[0] | 0;
                    const outSec =
                        typeof window.getSegmentRegionTimelineOut === 'function'
                            ? window.getSegmentRegionTimelineOut(track, leader)
                            : NaN;
                    if (!Number.isFinite(outSec) || outSec <= masterDur + 1e-6) continue;
                    let targetOut = slot.timelineEndSec;
                    if (targetOut > masterDur) targetOut = masterDur;
                    window.fitPartialSwapUnitToTimelineSpan(
                        track,
                        segs,
                        indices,
                        slot.timelineStartSec,
                        targetOut,
                    );
                    clampedPastMaster = true;
                }
                if (clampedPastMaster && typeof window.setTrackSegments === 'function') {
                    window.setTrackSegments(track, segs, {
                        skipUndo: true,
                        silent: true,
                        geometryOnly: true,
                        skipMusicalRefresh: true,
                        skipPersist: false,
                    });
                }
            }
            let segs = window.getTrackSegments(track);
            if (
                partialRecomposed &&
                nextCounts &&
                nextCounts.length &&
                typeof window.setTrackSegments === 'function'
            ) {
                transportSwapFinalize = !!partialRecomposed;
                if (transportSwapFinalize) {
                    if (!plan.marksRippledAtRecompose) {
                        plan.marksRippledAtRecompose = rippleRehearsalMarksForTransportSwap(
                            rehearsalIdxA,
                            rehearsalIdxB,
                            nextCounts,
                            plan.swapMeterBarPlan,
                            plan.swapMeterBarPlan && plan.swapMeterBarPlan.markSecs,
                            plan.headPadSwapPair,
                        );
                    }
                    if (typeof window.clearMusicalGridPositionCache === 'function') {
                        window.clearMusicalGridPositionCache();
                    }
                }
                const drawSync = applyAsymmetricPartialSwapSlotTimelines(
                    track,
                    slots,
                    slotA,
                    slotB,
                    idxA,
                    idxB,
                    nextCounts,
                    plan.asymmetricPlacementMode || 'transport-swap',
                    transportSwapFinalize ? null : plan.asymmetricDestTimelines,
                    barA,
                    barB,
                    plan.preSwapPairTimelines,
                    rehearsalIdxA,
                    rehearsalIdxB,
                    plan.preSwapPartnerMarkLabels,
                );
                plan.asymmetricDestTimelines = buildTransportSwapDestTimelinesFromSlots(
                    slotA,
                    slotB,
                );
                if (transportSwapFinalize) {
                    logTransportSwapSpanExpectation(
                        'finalize-pre-layout',
                        slotA,
                        slotB,
                        barA,
                        barB,
                        plan.asymmetricDestTimelines,
                        {
                            marksRippled: plan.marksRippledAtRecompose,
                            drawSync: drawSync,
                        },
                    );
                }
                const rippleSegs = segs.map((s) => Object.assign({}, s));
                const t0 =
                    typeof window.getTrackTimelineStartSec === 'function'
                        ? window.getTrackTimelineStartSec(track)
                        : 0;
                const rippleMoved = repositionRippledSlotsToSegments(
                    track,
                    slots,
                    rippleSegs,
                    [],
                    { partialRegionSwap: true },
                );
                resolveLayoutCorrections(
                    track,
                    rippleSegs,
                    t0,
                    slots,
                    transportSwapFinalize
                        ? { skipRehearsalSnap: true, skipMicroGapClose: true }
                        : undefined,
                );
                if (transportSwapFinalize && slotA && slotB) {
                    // transport-swap — 通常は timeline のみ入替（source identity 固定）。
                    // head pad ↔ A の mark-draw 交差配置のみ source も交換する。
                    if (
                        shouldPreserveTransportSwapPairSourceIdentity(
                            partialRecomposed,
                            barA,
                            barB,
                            plan.headPadSwapPair,
                        )
                    ) {
                        const restored = restorePreSwapPairSegmentSources(
                            rippleSegs,
                            slotA,
                            slotB,
                            plan.preSwapPairSegmentSources,
                        );
                        if (typeof window.musicalSlotDiagLog === 'function') {
                            const idxA = slotA.segmentRefs[0].segmentIndex | 0;
                            const idxB = slotB.segmentRefs[0].segmentIndex | 0;
                            const segA = rippleSegs[idxA];
                            const segB = rippleSegs[idxB];
                            window.musicalSlotDiagLog('swap/source-bounds', {
                                skipped: true,
                                reason: 'transport-swap-identity-preserved',
                                restoredPreSwapSources: restored,
                                regionA: idxA + 1,
                                regionB: idxB + 1,
                                preSwapA: plan.preSwapPairSegmentSources
                                    ? plan.preSwapPairSegmentSources.a
                                    : null,
                                preSwapB: plan.preSwapPairSegmentSources
                                    ? plan.preSwapPairSegmentSources.b
                                    : null,
                                afterRestoreA: segA
                                    ? {
                                          in: segA.sourceInSec,
                                          out: segA.sourceOutSec,
                                          dur: Math.max(
                                              0,
                                              (Number(segA.sourceOutSec) || 0) -
                                                  (Number(segA.sourceInSec) || 0),
                                          ),
                                      }
                                    : null,
                                afterRestoreB: segB
                                    ? {
                                          in: segB.sourceInSec,
                                          out: segB.sourceOutSec,
                                          dur: Math.max(
                                              0,
                                              (Number(segB.sourceOutSec) || 0) -
                                                  (Number(segB.sourceInSec) || 0),
                                          ),
                                      }
                                    : null,
                            });
                        }
                    } else if (
                        swapTransportSwapPairSegmentSources(
                            track,
                            rippleSegs,
                            slotA,
                            slotB,
                            plan.preSwapPairSegmentSources,
                        )
                    ) {
                        plan.transportSourcesSwapped = true;
                    }
                }
                stretchTransportSwapPairOnSegments(
                    track,
                    slots,
                    rippleSegs,
                    [idxA, idxB],
                    plan.asymmetricDestTimelines,
                    partialRecomposed &&
                        plan.preSwapPairSegmentSources &&
                        shouldPreserveTransportSwapPairSourceIdentity(
                            partialRecomposed,
                            barA,
                            barB,
                            plan.headPadSwapPair,
                        )
                        ? {
                              preSwapPairSegmentSources:
                                  plan.preSwapPairSegmentSources,
                              slotA,
                              slotB,
                              preserveSourceIdentity: true,
                          }
                        : null,
                );
                if (transportSwapFinalize) {
                    if (
                        swapMeterBarPlan &&
                        swapMeterBarPlan.preSwapMeterSlices &&
                        typeof window.applyTransportSwapMeterSlicesAfterMarkRipple === 'function'
                    ) {
                        window.applyTransportSwapMeterSlicesAfterMarkRipple(
                            swapMeterBarPlan.preSwapMeterSlices,
                            slotA,
                            slotB,
                            {
                                skipSessionPersist: !!o.skipSessionPersist,
                                headPadSwapPair: !!plan.headPadSwapPair,
                            },
                        );
                    } else if (typeof window.rebuildTempoSigTracksFromPerBarGrid === 'function') {
                        if (typeof window.musicalSlotDiagLog === 'function') {
                            window.musicalSlotDiagLog('swap/meter-fallback-rebuild', {
                                reason: swapMeterBarPlan && swapMeterBarPlan.preSwapMeterSlices
                                    ? 'apply-transport-swap-slices-missing'
                                    : 'pre-swap-slices-not-captured',
                                stage: 'pre-seal',
                            });
                        }
                        window.rebuildTempoSigTracksFromPerBarGrid({
                            skipSessionPersist: !!o.skipSessionPersist,
                        });
                    }
                    if (typeof window.clearMusicalGridPositionCache === 'function') {
                        window.clearMusicalGridPositionCache();
                    }
                    if (partialRecomposed && slotA && slotB) {
                        applySwappedPairRehearsalLabelsFromPreSwap(
                            slotA,
                            slotB,
                            segmentRehearsalLabels,
                        );
                    }
                    const markSnapResync = resyncTransportSwapSlotsAfterMarkSnap(
                        track,
                        slots,
                        slotA,
                        slotB,
                        idxA,
                        idxB,
                        plan.preSwapPartnerMarkLabels,
                        barA,
                        barB,
                        rippleSegs,
                        t0,
                        {
                            headPadSwapPair: plan.headPadSwapPair,
                            preSwapPairTimelines: plan.preSwapPairTimelines,
                            preSwapPairSegmentSources:
                                plan.preSwapPairSegmentSources,
                            preserveSwapPairSourceIdentity:
                                shouldPreserveTransportSwapPairSourceIdentity(
                                    partialRecomposed,
                                    barA,
                                    barB,
                                    plan.headPadSwapPair,
                                ),
                        },
                    );
                    plan.asymmetricDestTimelines = buildTransportSwapDestTimelinesFromSlots(
                        slotA,
                        slotB,
                    );
                    if (typeof window.musicalSlotDiagLog === 'function') {
                        window.musicalSlotDiagLog('swap/seal-boundaries', {
                            ex: track.slot + 1,
                            sealed: markSnapResync ? markSnapResync.sealed : 0,
                            refit: markSnapResync ? markSnapResync.refit : 0,
                            afterMarkSnap: true,
                        });
                    }
                }
                window.setTrackSegments(track, rippleSegs, {
                    skipUndo: true,
                    silent: true,
                    geometryOnly: true,
                    skipMusicalRefresh: true,
                });
                segs = rippleSegs;
                if (transportSwapFinalize) {
                    refreshSlotMeterBarStartFromTransport(slotA, {
                        preserveBarCounts: true,
                    });
                    refreshSlotMeterBarStartFromTransport(slotB, {
                        preserveBarCounts: true,
                    });
                }
                if (typeof window.musicalSlotDiagLog === 'function') {
                    window.musicalSlotDiagLog('swap/asymmetric-ripple', {
                        ex: track.slot + 1,
                        rippleMoved,
                        mode: 'transport-swap',
                        allUnits: false,
                    });
                }
            }
            syncSlotTimelineBoundsFromSegmentCopies(track, slots, segs);
            if (!transportSwapFinalize) {
                applySegmentRehearsalLabelMapToSlots(slots, segmentRehearsalLabels);
            }
            if (partialRecomposed && slotA && slotB && !transportSwapFinalize) {
                applySwappedPairRehearsalLabelsFromPreSwap(
                    slotA,
                    slotB,
                    segmentRehearsalLabels,
                );
            }
            if (nextCounts && nextCounts.length) {
                if (transportSwapFinalize && partialRecomposed) {
                    refreshNonPairTransportSwapSlotsMeterFromTimeline(
                        slots,
                        [idxA, idxB],
                        track,
                        segs,
                    );
                } else {
                    refreshSlotsMusicalTimelineAlignment(
                        slots,
                        nextCounts,
                        transportSwapFinalize ? [idxA, idxB] : null,
                        track,
                    );
                }
            }
            if (transportSwapFinalize && slotA && slotB) {
                refreshSlotMeterBarStartFromTransport(slotA, {
                    preserveBarCounts: true,
                });
                refreshSlotMeterBarStartFromTransport(slotB, {
                    preserveBarCounts: true,
                });
            }

            if (partialRecomposed) {
                ensureSlotRehearsalLabelsForMarkSync(
                    slots,
                    segmentRehearsalLabels,
                    collectSwappedSegmentIndicesFromSlots(slots, [idxA, idxB]),
                );
                const transportSwapMarkSync = !!partialRecomposed;
                if (
                    transportSwapMarkSync &&
                    plan.marksRippledAtRecompose
                ) {
                    marksRecomposed = true;
                } else if (typeof window.swapRehearsalMarkLabelsForRegionSwap === 'function') {
                    marksRecomposed = window.swapRehearsalMarkLabelsForRegionSwap(
                        rehearsalIdxA,
                        rehearsalIdxB,
                        {
                            preCounts: specCounts,
                            postCounts: nextCounts,
                            transportAnchored:
                                transportSwapMarkSync ||
                                (transportAnchoredSwap && barA === barB),
                            markSecs: asymmetricMarkSecs,
                            useMarkDrawLayout: transportSwapMarkSync,
                        },
                    );
                } else if (typeof window.musicalSlotDiagLog === 'function') {
                    window.musicalSlotDiagLog('rehearsal-mark/swap-missing', {
                        reason: 'swapRehearsalMarkLabelsForRegionSwap not loaded — hard refresh required',
                    });
                }
            }
            cacheTrackTimelineSlots(track, slots);

            if (
                marksRecomposed &&
                typeof window.pinMeterTrackEventsAtMarkSecs === 'function' &&
                typeof window.getRehearsalMarkTrackEventsPersistSnapshot === 'function'
            ) {
                const syncedSnap = window.getRehearsalMarkTrackEventsPersistSnapshot();
                if (syncedSnap && syncedSnap.length) {
                    window.pinMeterTrackEventsAtMarkSecs(
                        syncedSnap.map((e) => e.sec),
                        { skipSessionPersist: !!o.skipSessionPersist },
                    );
                }
            }
            if (
                !marksRecomposed &&
                !partialRecomposed &&
                typeof window.swapRehearsalMarkLabelsForRegionSwap === 'function'
            ) {
                marksRecomposed = window.swapRehearsalMarkLabelsForRegionSwap(
                    rehearsalIdxA,
                    rehearsalIdxB,
                    {
                        preCounts: specCounts,
                        postCounts: nextCounts,
                        transportAnchored: transportAnchoredSwap && barA === barB,
                        markSecs:
                            slotA && slotB
                                ? [slotA.timelineStartSec, slotB.timelineStartSec]
                                : null,
                    },
                );
            }
            if (
                partialRecomposed &&
                typeof window.refreshAllRegionMusicalMetaPresentation === 'function'
            ) {
                window.refreshAllRegionMusicalMetaPresentation();
            }
            if (
                swapBeforeRegionMarkerBounds &&
                slotA &&
                slotB &&
                slotA.segmentRefs &&
                slotA.segmentRefs.length &&
                slotB.segmentRefs &&
                slotB.segmentRefs.length &&
                typeof window.swapUserTimelineMarkerCommentsForRegionPair === 'function'
            ) {
                window.swapUserTimelineMarkerCommentsForRegionPair(
                    track,
                    slotA.segmentRefs[0].segmentIndex | 0,
                    slotB.segmentRefs[0].segmentIndex | 0,
                    swapBeforeRegionMarkerBounds,
                    { silent: true },
                );
            }
            if (
                swapBeforeRegionMarkerBounds &&
                typeof window.relocateUserTimelineMarkersAfterRegionLayout === 'function'
            ) {
                window.relocateUserTimelineMarkersAfterRegionLayout(
                    track,
                    swapBeforeRegionMarkerBounds,
                    { silent: true },
                );
            }
            if (typeof window.clampUserTimelineMarkersToTrackRegions === 'function') {
                window.clampUserTimelineMarkersToTrackRegions(track, { silent: true });
            }
            if (
                typeof window.scheduleMusicalGridRedraw === 'function' &&
                (marksRecomposed || partialRecomposed)
            ) {
                window.scheduleMusicalGridRedraw();
            }
            if (
                marksRecomposed &&
                typeof window.refreshRehearsalTrack === 'function'
            ) {
                window.refreshRehearsalTrack();
            }
            if (
                partialRecomposed &&
                !marksRecomposed &&
                typeof window.pinMeterTrackEventsAtMarkSecs === 'function' &&
                typeof window.getRehearsalMarkTrackEventsPersistSnapshot === 'function'
            ) {
                const postSnap = window.getRehearsalMarkTrackEventsPersistSnapshot();
                if (postSnap && postSnap.length) {
                    window.pinMeterTrackEventsAtMarkSecs(
                        postSnap.map((e) => e.sec),
                        { skipSessionPersist: !!o.skipSessionPersist },
                    );
                }
            }
            if (typeof window.regionSwapDiagLog === 'function') {
                window.regionSwapDiagLog('marker/finalize-phase2', {
                    clampedPastMaster,
                    partialRegionSwap,
                    partialRecomposed,
                    hadPreSwapBounds: !!swapBeforeRegionMarkerBounds,
                });
            }
        }
        window.musicalSlotDiagLog('swap/apply', {
            mode: 'slot-engine/' + swapMode,
            ex: track.slot + 1,
            unitA: window.musicalSlotDiagSummarizeSwapUnit(slotA, idxA),
            unitB: window.musicalSlotDiagSummarizeSwapUnit(slotB, idxB),
            rehearsalIdxA: rehearsalIdxA + 1,
            rehearsalIdxB: rehearsalIdxB + 1,
            asymmetric: barA !== barB,
            partialRegionSwap: partialRegionSwap,
            partialRecomposed: partialRecomposed,
            countsBefore: specCounts.slice(0, 12),
            countsAfter: nextCounts.slice(0, 12),
            destSec: {
                a: window.musicalSlotDiagFmtSec(slotA.timelineStartSec),
                b: window.musicalSlotDiagFmtSec(slotB.timelineStartSec),
            },
        });
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
        if (typeof window.syncRegionSwapVisualPresentation === 'function') {
            window.syncRegionSwapVisualPresentation(track);
        } else if (typeof window.updateTrackRegionOverlays === 'function') {
            window.updateTrackRegionOverlays(track);
            if (typeof window.redrawAfterRegionChange === 'function') {
                window.redrawAfterRegionChange(track.slot, { invalidatePeakCache: true });
            }
        }
        if (
            marksRecomposed &&
            typeof window.refreshRehearsalTrack === 'function'
        ) {
            window.refreshRehearsalTrack();
        }
        if (
            partialRecomposed &&
            typeof window.refreshAllRegionMusicalMetaPresentation === 'function'
        ) {
            window.refreshAllRegionMusicalMetaPresentation();
        } else if (
            marksRecomposed &&
            typeof window.refreshAllRegionRehearsalMarkLabels === 'function'
        ) {
            window.refreshAllRegionRehearsalMarkLabels();
        }
        if (
            partialRecomposed &&
            typeof window.refreshMusicalGridTracks === 'function'
        ) {
            window.refreshMusicalGridTracks();
        }
        if (typeof window.runMusicalSlotSwapInvariantChecks === 'function') {
            window.runMusicalSlotSwapInvariantChecks(track, slots, {
                stage: 'swap/finalize',
                logStage: 'swap/invariant-check',
                counts: nextCounts,
                countsBefore: specCounts,
                skipFillPartialCountsChecks: !!partialRecomposed,
                transportSwap: !!partialRecomposed,
                swapPairIndices: partialRecomposed ? [idxA, idxB] : null,
                destTimelines: plan.asymmetricDestTimelines,
                swapBarCounts: { barA: barA | 0, barB: barB | 0 },
                preSwapMeterSlices:
                    swapMeterBarPlan && swapMeterBarPlan.preSwapMeterSlices
                        ? swapMeterBarPlan.preSwapMeterSlices
                        : null,
            });
        }
        if (typeof window.clearRegionSelection === 'function') {
            window.clearRegionSelection();
        }
        const rehearsal = window.musicalSlotDiagRehearsalSnapshot();
        window.musicalSlotDiagLog('swap/done', {
            mode: 'slot-engine/' + swapMode,
            ex: track.slot + 1,
            partialRegionSwap: partialRegionSwap,
            rehearsalText: rehearsal.text,
            countsAfter: nextCounts.slice(0, 12),
        });
        if (typeof window.regionSwapDiagDumpSelectionTracks === 'function') {
            window.regionSwapDiagDumpSelectionTracks('swap/done-slot');
        }
    }

    /** Phase 2 — plan を live 状態へ一括 commit */
    function applySlotSwapPlan(plan, opt) {
        if (!plan || !plan.ok) {
            return plan || { ok: false, reason: 'no plan' };
        }
        const o = opt && typeof opt === 'object' ? opt : plan.opt || {};
        const track = plan.track;
        const slots = plan.slots;

        if (!o.skipUndo && typeof window.requestRegionUndoCapture === 'function') {
            window.requestRegionUndoCapture({ includeRehearsal: true, forceCapture: true });
        }

        const countsOverrideChanged =
            !plan.partialRecomposed &&
            plan.specCounts.length &&
            plan.nextCounts.length &&
            plan.specCounts.some((n, i) => (plan.nextCounts[i] | 0) !== (n | 0));
        if (
            countsOverrideChanged &&
            typeof window.applyRehearsalGroupBarCountsForRegionSwap === 'function'
        ) {
            window.applyRehearsalGroupBarCountsForRegionSwap(plan.nextCounts, {
                skipUndo: true,
                relayoutRegions: false,
                skipSessionPersist: plan.willAnimateSwap,
                skipGridRedraw: plan.willAnimateSwap,
            });
        }
        if (typeof window.clearMusicalGridPositionCache === 'function') {
            window.clearMusicalGridPositionCache();
        }

        if (plan.swapAnim) {
            setRegionSwapHistoryAnimHint(
                track,
                plan.swapAnim,
                plan.specCounts,
                plan.nextCounts,
                {
                    headPadMarkInsertedForSwap: !!plan.headPadMarkInsertedForSwap,
                    headPadInsertedMarkLabel: plan.headPadInsertedMarkLabel || null,
                    preSwapRehearsalMarkTrackEvents: plan.preSwapRehearsalMarkTrackEvents,
                },
            );
            if (
                plan.headPadMarkInsertedForSwap &&
                plan.preSwapRehearsalMarkTrackEvents &&
                typeof window.attachHeadPadSwapPreMarksToUndoStackTop === 'function'
            ) {
                window.attachHeadPadSwapPreMarksToUndoStackTop(
                    plan.preSwapRehearsalMarkTrackEvents,
                    plan.specCounts,
                );
            }
            if (typeof window.attachRegionSwapAnimHintToUndoStackTop === 'function') {
                window.attachRegionSwapAnimHintToUndoStackTop(
                    window.regionSwapHistoryAnimHint,
                );
            }
        }

        const layoutOpt = {
            skipUndo: true,
            silent: o.silent,
            skipLayoutCorrections: true,
            skipMusicalRefresh: true,
            skipSessionFlush: plan.willAnimateSwap,
            partialRegionSwap: plan.partialRegionSwap,
            deferUserMarkerRelayout: true,
            previewSegments: plan.previewSegments,
            anim: plan.willAnimateSwap && plan.swapAnim ? plan.swapAnim : null,
            finalizeSwap: plan.willAnimateSwap ? () => finalizeSlotSwapPlan(plan) : null,
        };

        if (!applySlotLayoutToSegments(track, slots, layoutOpt)) {
            return { ok: false, reason: 'layout apply incomplete' };
        }
        syncAllSilentMusicalFromPairedAudio(slots, track);
        if (typeof window.getTrackSegments === 'function') {
            syncSlotTimelineBoundsFromSegmentCopies(
                track,
                slots,
                window.getTrackSegments(track),
                partialRecomposed
                    ? { preserveSlotIndices: [plan.idxA, plan.idxB] }
                    : undefined,
            );
        }
        cacheTrackTimelineSlots(track, slots);

        if (!plan.willAnimateSwap) {
            finalizeSlotSwapPlan(plan);
        }

        window.musicalSlotDiagLog('swap/plan-applied', {
            phase: 2,
            ex: track.slot + 1,
            unitA: plan.idxA + 1,
            unitB: plan.idxB + 1,
            previewSegmentCount: plan.previewSegments ? plan.previewSegments.length : 0,
        });

        return { ok: true, slots, nextCounts: plan.nextCounts, plan };
    }

    /** Phase 2 — スワップ結果を計算（segment commit / finalize は apply が担当）
     *
     * nextCounts は musical-swap-planner.js から受け取るのみ。
     * plan 内で postCounts を上書きする safety fix を足さない（設計原則参照）。
     */
    function planSlotPairSwap(track, indexA, indexB, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        let slots =
            Array.isArray(o.slots) && o.slots.length
                ? o.slots
                : getTrackTimelineSlots(track, {
                      preserveStored: false,
                      writeCache: false,
                      forceRebuild: true,
                  });
        const idxA = indexA | 0;
        const idxB = indexB | 0;
        if (idxA < 0 || idxB < 0 || idxA >= slots.length || idxB >= slots.length) {
            return { ok: false, reason: 'slot index out of range' };
        }
        if (idxA === idxB) {
            return { ok: true, noop: true };
        }

        let slotA = slots[idxA];
        let slotB = slots[idxB];
        if (!slotA.musical) slotA.musical = {};
        if (!slotB.musical) slotB.musical = {};
        if (
            typeof window.assertSwapPlannerReady === 'function' &&
            !window.assertSwapPlannerReady()
        ) {
            return { ok: false, reason: 'SwapPlanner not loaded' };
        }
        window.musicalSlotDiagLog('swap/before', {
            ex: track.slot + 1,
            unitA: idxA + 1,
            unitB: idxB + 1,
            unitAIdentity: swapUnitIdentityKey(slotA),
            unitBIdentity: swapUnitIdentityKey(slotB),
        });

        const preSwapPlanSegs =
            typeof window.getTrackSegments === 'function'
                ? window.getTrackSegments(track)
                : null;
        const preSwapHeadPadPair = isHeadPadTransportSwapPair(
            slotA,
            slotB,
            track,
            preSwapPlanSegs,
            {
                a: { timelineStartSec: slotA.timelineStartSec },
                b: { timelineStartSec: slotB.timelineStartSec },
            },
        );
        const preSwapAudioAudio = slotA.kind !== 'silent' && slotB.kind !== 'silent';
        let headPadMarkInsertedForSwap = false;
        let headPadInsertedMarkLabel = null;
        let preSwapRehearsalMarkTrackEvents = null;
        if (preSwapHeadPadPair && preSwapAudioAudio) {
            if (typeof window.getRehearsalMarkTrackEventsPersistSnapshot === 'function') {
                preSwapRehearsalMarkTrackEvents = cloneRehearsalMarkTrackEventsForPersist(
                    window.getRehearsalMarkTrackEventsPersistSnapshot(),
                );
            }
            const headMarkEnsure = ensureHeadPadRehearsalMarkBeforeTransportSwap({
                skipSessionPersist: !!o.skipSessionPersist,
            });
            headPadMarkInsertedForSwap = !!(headMarkEnsure && headMarkEnsure.inserted);
            if (headPadMarkInsertedForSwap && headMarkEnsure && headMarkEnsure.label) {
                headPadInsertedMarkLabel = String(headMarkEnsure.label);
            }
        }

        if (typeof window.ensureTempoSignatureAtAllRehearsalMarks === 'function') {
            window.ensureTempoSignatureAtAllRehearsalMarks({
                skipSessionPersist: !!o.skipSessionPersist,
            });
        }

        let preSwapMarkMeterSnapshots = null;
        if (typeof window.captureMeterPrepSnapshotsAtRehearsalMarks === 'function') {
            preSwapMarkMeterSnapshots = window.captureMeterPrepSnapshotsAtRehearsalMarks({
                skipSessionPersist: !!o.skipSessionPersist,
            });
        }
        function attachPreSwapMarkMeterSnapshots(plan) {
            if (
                plan &&
                preSwapMarkMeterSnapshots &&
                preSwapMarkMeterSnapshots.length
            ) {
                plan.preSwapMarkMeterSnapshots = preSwapMarkMeterSnapshots;
            }
            return plan;
        }

        const segmentRehearsalLabels = captureSegmentRehearsalLabelMap(slots);
        const swapBeforeRegionMarkerBounds =
            typeof window.captureTrackSegmentRegionBoundsMap === 'function'
                ? window.captureTrackSegmentRegionBoundsMap(track)
                : null;

        const specCounts =
            typeof window.getExpandedRehearsalGroupBarCountsSnapshot === 'function'
                ? window.getExpandedRehearsalGroupBarCountsSnapshot()
                : [];
        const slotLevelCounts = resolveSlotLevelBarCountsForSwap(slots, specCounts, track);

        const rehearsalIdxA =
            slotA.musical.rehearsalSlotIndex >= 0
                ? slotA.musical.rehearsalSlotIndex | 0
                : idxA;
        const rehearsalIdxB =
            slotB.musical.rehearsalSlotIndex >= 0
                ? slotB.musical.rehearsalSlotIndex | 0
                : idxB;

        const timelineOrderCanonical = slotsTimelineMusicalOrderIsCanonical(slots);
        const silentGapForPlanner =
            slotA.kind === 'silent'
                ? getSilentGapForSlot(track, slotA)
                : slotB.kind === 'silent'
                  ? getSilentGapForSlot(track, slotB)
                  : null;
        const swapPlannerPlan = window.planMusicalSlotPairSwap({
            slotA: slotA,
            slotB: slotB,
            slots: slots,
            track: track,
            specCounts: specCounts,
            slotLevelCounts: slotLevelCounts,
            rehearsalIdxA: rehearsalIdxA,
            rehearsalIdxB: rehearsalIdxB,
            timelineOrderCanonical: timelineOrderCanonical,
            silentGap: silentGapForPlanner,
        });

        let barA = swapPlannerPlan ? swapPlannerPlan.barA | 0 : 0;
        let barB = swapPlannerPlan ? swapPlannerPlan.barB | 0 : 0;
        const involvesSilent = swapPlannerPlan
            ? !!swapPlannerPlan.involvesSilent
            : slotA.kind === 'silent' || slotB.kind === 'silent';
        const isSpecLevelGroupSwap = swapPlannerPlan
            ? swapPlannerPlan.kind === 'spec-group'
            : false;
        const transportAnchoredSwap = swapPlannerPlan
            ? !!swapPlannerPlan.transportAnchoredSwap
            : !involvesSilent && !timelineOrderCanonical;
        let swapMode = involvesSilent ? 'silent-audio' : 'audio-audio';
        let nextCounts;
        let audioTargetSecOverride = null;
        let swapMeterBarPlan = swapPlannerPlan ? swapPlannerPlan.meterPlan : null;
        let partialRegionSwap = swapPlannerPlan
            ? !!swapPlannerPlan.partialRegionSwap
            : false;
        let partialAsymmetric = swapPlannerPlan
            ? !!swapPlannerPlan.partialAsymmetric
            : false;
        let partialRecomposed = false;
        let asymmetricPlacementMode = null;
        let asymmetricDestTimelines = null;
        let marksRippledAtRecompose = false;
        let preSwapPairTimelines = null;
        let preSwapPairSegmentSources = null;
        let preSwapPartnerMarkLabels = null;
        let headPadSwapPair = false;

        if (involvesSilent) {
            const counts = slotLevelCounts;
            const silentSlot = slotA.kind === 'silent' ? slotA : slotB;
            const audioSlot = slotA.kind === 'silent' ? slotB : slotA;
            const rehearsalIdxSilent = silentSlot.musical.rehearsalSlotIndex | 0;
            const rehearsalIdxAudio = audioSlot.musical.rehearsalSlotIndex | 0;
            const barSilent = swapPlannerPlan.barA | 0;
            const barAudio = swapPlannerPlan.barB | 0;

            const partialPlan =
                swapPlannerPlan.silentPartialPlan ||
                tryResolveSilentAudioPartialPlan(track, silentSlot, audioSlot, specCounts);
            let destSilent;
            let destAudio;
            if (partialPlan) {
                swapMode = partialPlan.mode;
                nextCounts = partialPlan.nextCounts;
                destSilent = partialPlan.silentDestRehearsalIdx | 0;
                destAudio = partialPlan.audioDestRehearsalIdx | 0;
                audioTargetSecOverride = partialPlan.audioTargetSec;
            } else {
                nextCounts = computeNextCountsForSlotPairSwap(
                    counts,
                    rehearsalIdxSilent,
                    rehearsalIdxAudio,
                    barSilent,
                    barAudio,
                );
                const dest = assignPairSwapDestinations(
                    rehearsalIdxSilent,
                    rehearsalIdxAudio,
                    barSilent,
                    barAudio,
                );
                destSilent = dest.destA;
                destAudio = dest.destB;
            }

            if (rehearsalIdxSilent !== rehearsalIdxAudio) {
                if (!swapMeterBarPlan) {
                    swapMeterBarPlan = buildSwapMeterBarPlan(
                        silentSlot,
                        audioSlot,
                        counts,
                    );
                }
                if (!swapMeterBarPlan) {
                    return { ok: false, reason: 'missing transport meter plan' };
                }
                attachPreSwapMarkMeterSnapshots(swapMeterBarPlan);
                const silentIdx = slotA.kind === 'silent' ? idxA : idxB;
                const audioIdx = slotA.kind === 'silent' ? idxB : idxA;
                applySwapMeterBarPlanIfAny(
                    swapMeterBarPlan,
                    silentIdx,
                    audioIdx,
                    counts,
                    o.skipSessionPersist,
                    false,
                );
            }

            silentSlot.musical.rehearsalSlotIndex = destSilent;
            audioSlot.musical.rehearsalSlotIndex = destAudio;
        } else if (isSpecLevelGroupSwap) {
            nextCounts = swapPlannerPlan.nextCounts || specCounts.slice();
            if (!swapPlannerPlan.nextCounts) {
                const tmpCount = nextCounts[rehearsalIdxA];
                nextCounts[rehearsalIdxA] = nextCounts[rehearsalIdxB];
                nextCounts[rehearsalIdxB] = tmpCount;
            }
            if (!swapMeterBarPlan) {
                swapMeterBarPlan = buildSwapMeterBarPlan(
                    slotA,
                    slotB,
                    slotLevelCounts,
                );
            }
            if (!swapMeterBarPlan) {
                return { ok: false, reason: 'missing transport meter plan' };
            }
            attachPreSwapMarkMeterSnapshots(swapMeterBarPlan);
            applySwapMeterBarPlanIfAny(
                swapMeterBarPlan,
                idxA,
                idxB,
                slotLevelCounts,
                o.skipSessionPersist,
                false,
            );
            swapSlotMusicalMetadataPair(slotA, slotB);
            swapSlotTimelineBoundsPair(slotA, slotB);
        } else {
            partialRegionSwap = true;
            if (!swapMeterBarPlan) {
                return { ok: false, reason: 'missing transport meter plan' };
            }
            barA = swapMeterBarPlan.countA | 0;
            barB = swapMeterBarPlan.countB | 0;
            partialAsymmetric = barA !== barB;
            nextCounts =
                swapPlannerPlan.nextCounts != null
                    ? swapPlannerPlan.nextCounts.slice()
                    : specCounts.slice();
            attachPreSwapMarkMeterSnapshots(swapMeterBarPlan);
            if (
                typeof window.musicalSlotDiagLog === 'function' &&
                swapMeterBarPlan.coordMismatch
            ) {
                window.musicalSlotDiagLog('swap/meter-plan/bar-resolve', {
                    scoreSpanA: swapMeterBarPlan.scoreSpanA,
                    scoreSpanB: swapMeterBarPlan.scoreSpanB,
                    transportCountA: swapMeterBarPlan.countA | 0,
                    transportCountB: swapMeterBarPlan.countB | 0,
                    barA,
                    barB,
                    partialAsymmetric,
                });
            }
            swapMeterBarPlan.markSecs = [slotA.timelineStartSec, slotB.timelineStartSec];
            if (partialAsymmetric) {
                preSwapPartnerMarkLabels = {
                    forSlotA: slotRehearsalMarkLabelForTransportSync(slotA),
                    forSlotB: slotRehearsalMarkLabelForTransportSync(slotB),
                };
                const legacySlotA = {
                    timelineStartSec: slotA.timelineStartSec,
                    timelineEndSec: slotA.timelineEndSec,
                };
                const legacySlotB = {
                    timelineStartSec: slotB.timelineStartSec,
                    timelineEndSec: slotB.timelineEndSec,
                };
                preSwapPairTimelines = { a: legacySlotA, b: legacySlotB };
                const planSegs =
                    typeof window.getTrackSegments === 'function'
                        ? window.getTrackSegments(track)
                        : null;
                preSwapPairSegmentSources = capturePreSwapPairSegmentSources(
                    slotA,
                    slotB,
                    planSegs,
                );
                headPadSwapPair = isHeadPadTransportSwapPair(
                    slotA,
                    slotB,
                    track,
                    planSegs,
                    preSwapPairTimelines,
                );
                asymmetricPlacementMode = resolveAsymmetricSwapPlacementMode(
                    rehearsalIdxA,
                    rehearsalIdxB,
                    nextCounts.length,
                    barA,
                    barB,
                );
                partialRecomposed = recomposeAsymmetricRehearsalPairSwap(
                    swapMeterBarPlan,
                    rehearsalIdxA,
                    rehearsalIdxB,
                    specCounts,
                    nextCounts,
                    {
                        skipSessionPersist: o.skipSessionPersist,
                        meterInPlace: true,
                    },
                );
                if (!partialRecomposed) {
                    return { ok: false, reason: 'asymmetric recompose failed' };
                }
                marksRippledAtRecompose = rippleRehearsalMarksForTransportSwap(
                    rehearsalIdxA,
                    rehearsalIdxB,
                    nextCounts,
                    swapMeterBarPlan,
                    swapMeterBarPlan.markSecs,
                    headPadSwapPair,
                );
                if (typeof window.clearMusicalGridPositionCache === 'function') {
                    window.clearMusicalGridPositionCache();
                }
                slotA = slots[idxA];
                slotB = slots[idxB];
                const drawSync = applyAsymmetricPartialSwapSlotTimelines(
                    track,
                    slots,
                    slotA,
                    slotB,
                    idxA,
                    idxB,
                    nextCounts,
                    asymmetricPlacementMode,
                    null,
                    barA,
                    barB,
                    preSwapPairTimelines,
                    rehearsalIdxA,
                    rehearsalIdxB,
                    preSwapPartnerMarkLabels,
                );
                swapSlotMusicalMetadataPair(slotA, slotB, { partial: true });
                applySwappedPairRehearsalLabelsFromPreSwap(
                    slotA,
                    slotB,
                    segmentRehearsalLabels,
                );
                asymmetricDestTimelines = buildTransportSwapDestTimelinesFromSlots(
                    slotA,
                    slotB,
                );
                logTransportSwapSpanExpectation(
                    'plan',
                    slotA,
                    slotB,
                    barA,
                    barB,
                    asymmetricDestTimelines,
                    {
                        marksRippled: marksRippledAtRecompose,
                        legacySlotA: legacySlotA,
                        legacySlotB: legacySlotB,
                        drawSync: drawSync,
                    },
                );
                if (typeof window.musicalSlotDiagLog === 'function') {
                    window.musicalSlotDiagLog('swap/asymmetric-timeline', {
                        ex: track.slot + 1,
                        unitA: idxA + 1,
                        unitB: idxB + 1,
                        mode: asymmetricPlacementMode,
                        rehearsalIdxA: rehearsalIdxA + 1,
                        rehearsalIdxB: rehearsalIdxB + 1,
                        countsLen: nextCounts.length,
                        marksRippled: marksRippledAtRecompose,
                        destTransport: {
                            a: {
                                start: window.musicalSlotDiagFmtSec(
                                    asymmetricDestTimelines.a &&
                                        asymmetricDestTimelines.a.start,
                                ),
                                end: window.musicalSlotDiagFmtSec(
                                    asymmetricDestTimelines.a &&
                                        asymmetricDestTimelines.a.end,
                                ),
                            },
                            b: {
                                start: window.musicalSlotDiagFmtSec(
                                    asymmetricDestTimelines.b &&
                                        asymmetricDestTimelines.b.start,
                                ),
                                end: window.musicalSlotDiagFmtSec(
                                    asymmetricDestTimelines.b &&
                                        asymmetricDestTimelines.b.end,
                                ),
                            },
                        },
                        slotA: {
                            start: window.musicalSlotDiagFmtSec(slotA.timelineStartSec),
                            end: window.musicalSlotDiagFmtSec(slotA.timelineEndSec),
                            label: slotRehearsalMarkLabelForTransportSync(slotA),
                            bars: slotA.musical ? slotA.musical.contentBarCount | 0 : 0,
                        },
                        slotB: {
                            start: window.musicalSlotDiagFmtSec(slotB.timelineStartSec),
                            end: window.musicalSlotDiagFmtSec(slotB.timelineEndSec),
                            label: slotRehearsalMarkLabelForTransportSync(slotB),
                            bars: slotB.musical ? slotB.musical.contentBarCount | 0 : 0,
                        },
                    });
                }
            } else {
                if (!transportAnchoredSwap) {
                    applySwapMeterBarPlanIfAny(
                        swapMeterBarPlan,
                        idxA,
                        idxB,
                        slotLevelCounts,
                        o.skipSessionPersist,
                        true,
                    );
                }
                swapSlotMusicalMetadataPair(slotA, slotB, { partial: true });
                swapPartialSlotTimelinePair(slotA, slotB);
                recomputeSlotMeterBarStart(slotA, nextCounts);
                recomputeSlotMeterBarStart(slotB, nextCounts);
            }
        }

        if (nextCounts && nextCounts.length && !partialRecomposed && !transportAnchoredSwap) {
            refreshSlotsMusicalFromCounts(slots, nextCounts);
        }

        const timelineStartOverrides = {};
        if (involvesSilent && audioTargetSecOverride != null) {
            timelineStartOverrides[slotA.kind === 'silent' ? idxB : idxA] =
                audioTargetSecOverride;
        } else if (!involvesSilent && !partialRecomposed) {
            timelineStartOverrides[idxA] = slotA.timelineStartSec;
            timelineStartOverrides[idxB] = slotB.timelineStartSec;
        }
        if (
            !involvesSilent &&
            nextCounts &&
            nextCounts.length &&
            !partialRecomposed &&
            !transportAnchoredSwap
        ) {
            refreshSlotTimelineBoundsFromRehearsalCounts(
                track,
                slots,
                nextCounts,
                timelineStartOverrides,
                { preservePartialPlacement: true },
            );
        }

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
                    includeSlideMoves: partialRecomposed,
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
                      specCounts,
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

        const willAnimateSwap =
            typeof window.playPlaybackRegionSwapAnimation === 'function' &&
            (involvesSilent ||
                (slotA.segmentRefs &&
                    slotA.segmentRefs.length &&
                    slotB.segmentRefs &&
                    slotB.segmentRefs.length));

        const previewLayout = buildPreviewSegmentsFromSlots(track, slots, {
            partialRegionSwap,
            asymmetricPartialRecomposed: partialRecomposed,
            skipLayoutCorrections: !partialRecomposed,
            meterInPlaceOnly: false,
            transportSwap: !!partialRecomposed,
            swapPairIndices: partialRecomposed ? [idxA, idxB] : null,
            transportDestTimelines: asymmetricDestTimelines,
            preSwapPairSegmentSources: preSwapPairSegmentSources,
            headPadSwapPair: headPadSwapPair,
            barA,
            barB,
            slotA,
            slotB,
        });

        window.musicalSlotDiagLog('swap/plan-built', {
            phase: 2,
            ex: track.slot + 1,
            unitA: idxA + 1,
            unitB: idxB + 1,
            mode: swapMode,
            partialRegionSwap,
            partialRecomposed,
            previewSegmentCount: previewLayout.segments ? previewLayout.segments.length : 0,
        });

        return {
            ok: true,
            track,
            opt: o,
            idxA,
            idxB,
            slots,
            slotA,
            slotB,
            segmentRehearsalLabels,
            swapBeforeRegionMarkerBounds,
            specCounts,
            nextCounts,
            swapMode,
            involvesSilent,
            partialRegionSwap,
            partialRecomposed,
            partialAsymmetric,
            asymmetricPlacementMode,
            asymmetricDestTimelines,
            marksRippledAtRecompose,
            preSwapPairTimelines,
            preSwapPairSegmentSources,
            preSwapPartnerMarkLabels,
            headPadSwapPair,
            headPadMarkInsertedForSwap,
            headPadInsertedMarkLabel,
            preSwapRehearsalMarkTrackEvents,
            transportAnchoredSwap,
            rehearsalIdxA,
            rehearsalIdxB,
            barA,
            barB,
            swapMeterBarPlan,
            swapAnim,
            swapActionMessage,
            willAnimateSwap,
            previewSegments: previewLayout.segments,
            previewT0: previewLayout.t0,
            transportSourcesSwapped: false,
        };
    }

    function swapTimelineSlotsAtIndices(track, indexA, indexB, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        // transport-swap の plan 内 ripple が marks/slots を先に書き換えるため、
        // apply より前（plan より前）で undo を取らないと復元不能になる。
        if (!o.skipUndo && typeof window.requestRegionUndoCapture === 'function') {
            window.requestRegionUndoCapture({ includeRehearsal: true, forceCapture: true });
        }
        const plan = planSlotPairSwap(track, indexA, indexB, o);
        if (!plan.ok) return plan;
        if (plan.noop) return plan;
        return applySlotSwapPlan(plan, Object.assign({}, o, { skipUndo: true }));
    }

    function swapSelectedTimelineSlots() {
        if (
            typeof window.getMusicalGridRehearsalFillVisible !== 'function' ||
            !window.getMusicalGridRehearsalFillVisible()
        ) {
            return { ok: false, reason: 'rehearsal fill off' };
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

        invalidateTrackTimelineSlotsReadCache();
        const slots = getTrackTimelineSlots(track, {
            writeCache: false,
            forceRebuild: true,
            skipReadCacheStore: true,
        });
        const resolved = resolveSwapSelectionAudioSlotPair(track, a, b, slots);
        if (!resolved.ok) {
            return { ok: false, reason: resolved.reason };
        }
        if (resolved.noop) {
            window.musicalSlotDiagLog('swap/skip', { reason: 'same swap unit', ex: track.slot + 1 });
            return { ok: true, noop: true };
        }
        const idxA = resolved.idxA;
        const idxB = resolved.idxB;

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
            normalized: { unitA: idxA + 1, unitB: idxB + 1 },
        });

        return swapTimelineSlotsAtIndices(track, idxA, idxB, { slots });
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
        if (Number.isFinite(r.rehearsalSlotIndex) && (r.rehearsalSlotIndex | 0) >= 0) {
            const rehearsalIdx = r.rehearsalSlotIndex | 0;
            for (let i = 0; i < slots.length; i++) {
                const m = slots[i] && slots[i].musical;
                if (m && (m.rehearsalSlotIndex | 0) === rehearsalIdx) {
                    return cloneMusicalBinding(m);
                }
            }
        }
        return null;
    }

    function formatSwapUnitStoredMusicalMetaText(track, ref, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const binding = resolveSwapUnitMusicalBinding(track, ref, o.slots);
        let rehearsalBars = binding ? binding.rehearsalBarCount | 0 : 0;
        let contentBars = binding ? binding.contentBarCount | 0 : 0;
        if (!(rehearsalBars > 0) && o.counts && Number.isFinite(ref && ref.rehearsalSlotIndex)) {
            const idx = ref.rehearsalSlotIndex | 0;
            if (idx >= 0 && idx < o.counts.length) rehearsalBars = o.counts[idx] | 0;
        }
        if (!(contentBars > 0) && rehearsalBars > 0) contentBars = rehearsalBars;
        let meter = '';
        const settings = getMeterSettings();
        if (
            settings &&
            settings.meterSpec &&
            binding &&
            typeof window.formatMeterTextForBarRange === 'function'
        ) {
            const barStart = binding.meterBarStart | 0;
            const barCount = rehearsalBars > 0 ? rehearsalBars : contentBars;
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
        return typeof window.formatRehearsalSlotMusicalMetaText === 'function'
            ? window.formatRehearsalSlotMusicalMetaText(meter, rehearsalBars, contentBars)
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
            typeof window.getMusicalGridRehearsalFillVisible !== 'function' ||
            !window.getMusicalGridRehearsalFillVisible()
        ) {
            return false;
        }

        let slots = getTrackTimelineSlots(track, { preserveStored: true, writeCache: false });
        if (!slots.length) return false;

        const counts =
            typeof window.getExpandedRehearsalGroupBarCountsSnapshot === 'function'
                ? window.getExpandedRehearsalGroupBarCountsSnapshot()
                : [];
        if (!counts.length) return false;

        refreshSlotsMusicalFromCounts(slots, counts);
        refreshSlotTimelineBoundsFromRehearsalCounts(track, slots, counts);

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
            window.requestRegionUndoCapture({ includeRehearsal: false });
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
        const slots = getTrackTimelineSlots(track, { writeCache: false, forceRebuild: true });
        return slots.map((s) => {
            const row = {
                id: s.id,
                kind: s.kind,
                silentGapIndex: s.silentGapIndex >= 0 ? s.silentGapIndex : undefined,
                regionGroupId: s.regionGroupId,
                musical: cloneMusicalBinding(s.musical),
            };
            if (s.segmentRefs && s.segmentRefs.length) {
                row.segmentRefs = s.segmentRefs.map((r) => ({
                    slot: r.slot | 0,
                    segmentIndex: r.segmentIndex | 0,
                }));
            }
            if (Number.isFinite(s.timelineStartSec)) row.timelineStartSec = s.timelineStartSec;
            if (Number.isFinite(s.timelineEndSec)) row.timelineEndSec = s.timelineEndSec;
            return row;
        });
    }

    function restoreTimelineSlotsForTrack(track, persistedSlots) {
        if (!track || !Array.isArray(persistedSlots) || !persistedSlots.length) {
            return false;
        }
        if (!persistedTimelineSlotsAreUsable(persistedSlots)) {
            return false;
        }
        if (!persistedTimelineSlotsHaveSegmentRefs(persistedSlots)) {
            return false;
        }
        cacheTrackTimelineSlots(track, persistedSlots);
        return true;
    }

    window.buildTrackTimelineSlots = buildTrackTimelineSlots;
    window.getTrackTimelineSlots = getTrackTimelineSlots;
    window.inferMusicalBindingsForTrack = inferMusicalBindingsForTrack;
    window.syncEditorsFromTimelineSlots = syncEditorsFromTimelineSlots;
    window.rebindTimelineSlotsFromEditors = rebindTimelineSlotsFromEditors;
    window.refreshTrackTimelineMusicalSlots = refreshTrackTimelineMusicalSlots;
    window.swapTimelineSlotsAtIndices = swapTimelineSlotsAtIndices;
    window.planSlotPairSwap = planSlotPairSwap;
    window.applySlotSwapPlan = applySlotSwapPlan;
    window.swapSelectedTimelineSlots = swapSelectedTimelineSlots;
    window.rebuildAllTrackTimelineSlots = rebuildAllTrackTimelineSlots;
    window.invalidateTrackTimelineSlotsReadCache = invalidateTrackTimelineSlotsReadCache;
    window.relayoutTrackFromTimelineSlots = relayoutTrackFromTimelineSlots;
    window.relayoutAllTracksFromTimelineSlots = relayoutAllTracksFromTimelineSlots;
    window.swapUnitIdentityKey = swapUnitIdentityKey;
    window.cloneMusicalBinding = cloneMusicalBinding;
    window.resolveTimelineSlotIndexForSelection = resolveTimelineSlotIndexForSelection;
    window.resolveSwapSelectionAudioSlotPair = resolveSwapSelectionAudioSlotPair;
    window.resolveSwapUnitMusicalBinding = resolveSwapUnitMusicalBinding;
    window.formatSwapUnitStoredMusicalMetaText = formatSwapUnitStoredMusicalMetaText;
    window.timelineSlotsPersistSlice = timelineSlotsPersistSlice;
    window.restoreTimelineSlotsForTrack = restoreTimelineSlotsForTrack;
    window.persistedTimelineSlotsAreUsable = persistedTimelineSlotsAreUsable;
    window.persistedTimelineSlotsHaveSegmentRefs = persistedTimelineSlotsHaveSegmentRefs;
    window.isTimelineSlotRegionSwapEnabled = isTimelineSlotRegionSwapEnabled;
    window.planRegionHistorySwapAnimation = planRegionHistorySwapAnimation;
    window.planRegionHistorySwapAnimationFromHint = planRegionHistorySwapAnimationFromHint;
    window.regionSwapHistoryAnimHintMatchesTarget = regionSwapHistoryAnimHintMatchesTarget;
    window.cloneRegionSwapHistoryAnimHint = cloneRegionSwapHistoryAnimHint;
    window.clearRegionSwapHistoryAnimHint = clearRegionSwapHistoryAnimHint;
    window.reconcileHeadPadRehearsalMarkAfterTransportSwapUndo =
        reconcileHeadPadRehearsalMarkAfterTransportSwapUndo;
    window.regionSwapHistoryAnimHint = null;
    window.useTimelineSlotRegionSwap =
        typeof window.useTimelineSlotRegionSwap === 'boolean'
            ? window.useTimelineSlotRegionSwap
            : true;
})();

