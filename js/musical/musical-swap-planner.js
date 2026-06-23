/**
 * musical-swap-planner.js — Transport Swap の単一入口（計画・小節数・分類）
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 設計原則 — 唯一の真実（対処療法を増やさない）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 不具合報告のたびに「このケースだけ」分岐を足すと、あっちを立てれば
 * こっちが立たずになる。修正は常に下記モデルへ寄せること。
 *
 * 【真実の源泉】
 *   transport mark-draw span（collectRehearsalMarkDrawRanges）
 *   非対称 recompose + mark ripple 後は postCounts × rehearsalSlotIndex と等価。
 *
 * 【本モジュールの責務 — 計画のみ】
 *   - classifyMusicalSlotPairSwap … 対称 / 非対称 / spec-group / silent
 *   - resolveAsymmetricSwapNextCounts … 非対称の postCounts（ここだけで決める）
 *   - buildSwapMeterBarPlanFromTransport … 入替前 transport span
 *   配置・segment 幾何・mark 書き込みは timeline-musical-slots.js 側。
 *
 * 【実行経路は構造的に 2 系統だけ（第 3 の隠れ経路を作らない）】
 *   1. 非対称 partial（barA ≠ barB）
 *        planner.nextCounts → recompose → mark ripple
 *        → applySlotTimelineFromCountsRange（ペア）
 *        → syncSlotsFromMarkDrawRanges（非ペア）
 *   2. 対称 transport-anchored（barA = barB, counts 不変）
 *        timeline bounds 交換 + mark label 交換（finalize）
 *
 * 【禁止 — 対処療法パターン】
 *   - postCounts 以外の基準で非対称ペアを配置（preSwap 座標・partner 旧開始位置など）
 *   - planner の nextCounts を plan 側で上書きする safety fix
 *   - transportAnchoredSwap / countsUnchanged 等のフラグで非対称配置を分岐
 *   - label 検索と counts 配置の二重経路（ripple 後は同値のはず）
 *
 * 【不具合修正時の手順】
 *   1. どの真実から乖離しているか特定（counts / mark-draw / slot timeline）
 *   2. 乖離の「前段」（planner / recompose / ripple）を直す
 *   3. 配置は applyTransportSwapPairBarCountDestSpans（counts 一本）を維持
 *   4. swap/invariant-check と verify-transport-swap で回帰確認
 *
 * 詳細: docs/region-swap-engine-phases.txt「設計原則」
 * 配置実装: js/musical/timeline-musical-slots.js（applyAsymmetricPartialSwapSlotTimelines）
 */
(function musicalSwapPlannerModule() {
    function segmentBoundaryEps() {
        return typeof window.segmentBoundaryJoinEpsilonSec === 'function'
            ? window.segmentBoundaryJoinEpsilonSec()
            : 0.002;
    }

    function resolveSwapTransportSpanForSlot(slot, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const resolveSpan =
            typeof window.resolveTransportMeterSpanForSwapSec === 'function'
                ? window.resolveTransportMeterSpanForSwapSec
                : null;
        if (!resolveSpan || !slot) return null;
        const eps =
            typeof o.eps === 'number' && o.eps > 0 ? o.eps : segmentBoundaryEps();
        const startSec = slot.timelineStartSec;
        const endSec =
            o.endSec != null && Number.isFinite(o.endSec)
                ? o.endSec
                : slot.timelineEndSec;
        if (!Number.isFinite(startSec)) return null;
        return resolveSpan(startSec, { eps: eps, endSec: endSec });
    }

    /** mark draw range の bar 数（slot 幅による拡張なし） */
    function resolveMarkRangeTransportBarCountForSlot(slot) {
        const resolveSpan =
            typeof window.resolveTransportMeterSpanForSwapSec === 'function'
                ? window.resolveTransportMeterSpanForSwapSec
                : null;
        if (!resolveSpan || !slot || !Number.isFinite(slot.timelineStartSec)) return 0;
        const eps = segmentBoundaryEps();
        const markSpan = resolveSpan(slot.timelineStartSec, { eps: eps });
        return markSpan ? markSpan.transportBarCount | 0 : 0;
    }

    function resolveSwapBarCountForSlot(slot, opt) {
        if (!slot) return 0;
        const span = resolveSwapTransportSpanForSlot(slot, opt);
        if (span && (span.transportBarCount | 0) > 0) {
            return span.transportBarCount | 0;
        }
        if (slot.kind === 'silent' && slot.musical) {
            const rehearsalBars = slot.musical.rehearsalBarCount | 0;
            if (rehearsalBars > 0) return rehearsalBars;
        }
        return 0;
    }

    /** slot.musical の小節 metadata を transport span に同期 */
    function syncSlotMusicalMetadataFromTransport(slot) {
        if (!slot || !slot.musical) return false;
        const span = resolveSwapTransportSpanForSlot(slot);
        if (!span) return false;
        if (Number.isFinite(span.transportBarStart)) {
            slot.musical.meterBarStart = span.transportBarStart | 0;
        }
        const barCount = span.transportBarCount | 0;
        if (barCount > 0) {
            slot.musical.rehearsalBarCount = barCount;
            if (slot.kind !== 'silent') {
                slot.musical.contentBarCount = barCount;
            }
        }
        return true;
    }

    function scoreMeterBarStartFromSlot(slot, counts) {
        if (!slot || !slot.musical || !counts || !counts.length) {
            return slot && slot.musical ? slot.musical.meterBarStart | 0 : 0;
        }
        const idx = slot.musical.rehearsalSlotIndex | 0;
        if (idx < 0 || idx >= counts.length) return slot.musical.meterBarStart | 0;
        let start = 0;
        for (let c = 0; c < idx; c++) start += counts[c] | 0;
        return start;
    }

    function scoreBarCountFromSlot(slot, counts) {
        if (!slot || !slot.musical || !counts || !counts.length) return 0;
        const idx = slot.musical.rehearsalSlotIndex | 0;
        if (idx < 0 || idx >= counts.length) return 0;
        return counts[idx] | 0;
    }

    function slotCoversTransportMarkSpan(slot, span, eps) {
        if (!slot || !span) return false;
        if (
            !Number.isFinite(slot.timelineStartSec) ||
            !Number.isFinite(slot.timelineEndSec) ||
            !Number.isFinite(span.startSec) ||
            !Number.isFinite(span.endSec)
        ) {
            return false;
        }
        return (
            Math.abs(slot.timelineStartSec - span.startSec) <= eps &&
            Math.abs(slot.timelineEndSec - span.endSec) <= eps
        );
    }

    function buildSwapMeterBarPlanFromTransport(slotA, slotB, countsOpt, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const counts = Array.isArray(countsOpt) ? countsOpt : [];
        const eps =
            typeof o.eps === 'number' && o.eps > 0 ? o.eps : segmentBoundaryEps();
        const spanA = resolveSwapTransportSpanForSlot(slotA, { eps: eps });
        const spanB = resolveSwapTransportSpanForSlot(slotB, { eps: eps });
        const scoreStartA = scoreMeterBarStartFromSlot(slotA, counts);
        const scoreStartB = scoreMeterBarStartFromSlot(slotB, counts);
        const scoreCountA = scoreBarCountFromSlot(slotA, counts);
        const scoreCountB = scoreBarCountFromSlot(slotB, counts);

        function planSide(slot, span, scoreStart, scoreCount) {
            if (span && (span.transportBarCount | 0) > 0) {
                const perBarLen =
                    typeof window.getMeterBarCountForRegionSwap === 'function'
                        ? window.getMeterBarCountForRegionSwap() | 0
                        : 0;
                const rawStart = span.transportBarStart | 0;
                const start =
                    perBarLen > 0
                        ? Math.max(0, Math.min(rawStart, perBarLen - 1))
                        : rawStart;
                return {
                    start: start,
                    rawStart: rawStart,
                    count: span.transportBarCount | 0,
                    span: span,
                    scoreStart: scoreStart,
                    scoreCount: scoreCount,
                };
            }
            const bar = resolveSwapBarCountForSlot(slot);
            if (!(bar > 0)) return null;
            return {
                start: scoreStart,
                rawStart: scoreStart,
                count: bar,
                span: null,
                scoreStart: scoreStart,
                scoreCount: scoreCount,
            };
        }

        const sideA = planSide(slotA, spanA, scoreStartA, scoreCountA);
        const sideB = planSide(slotB, spanB, scoreStartB, scoreCountB);

        if (!sideA || !sideB) {
            if (typeof window.musicalSlotDiagLog === 'function') {
                window.musicalSlotDiagLog('swap/planner/warn', {
                    reason: 'missing-transport-span',
                    spanA: spanA,
                    spanB: spanB,
                });
            }
            return {
                ok: false,
                reason: 'missing-transport-span',
                spanA: spanA,
                spanB: spanB,
                scoreStartA: scoreStartA,
                scoreStartB: scoreStartB,
            };
        }

        const barA = sideA.count | 0;
        const barB = sideB.count | 0;

        return {
            ok: true,
            startA: sideA.start,
            countA: barA,
            startB: sideB.start,
            countB: barB,
            rawStartA: sideA.rawStart,
            rawStartB: sideB.rawStart,
            transportSpanA: sideA.span,
            transportSpanB: sideB.span,
            scoreSpanA: {
                start: sideA.scoreStart,
                count: sideA.scoreCount,
                rehearsalSlotIndex:
                    slotA && slotA.musical ? slotA.musical.rehearsalSlotIndex | 0 : null,
            },
            scoreSpanB: {
                start: sideB.scoreStart,
                count: sideB.scoreCount,
                rehearsalSlotIndex:
                    slotB && slotB.musical ? slotB.musical.rehearsalSlotIndex | 0 : null,
            },
            coordMismatch:
                sideA.start !== sideA.scoreStart ||
                sideB.start !== sideB.scoreStart ||
                barA !== sideA.scoreCount ||
                barB !== sideB.scoreCount,
            barA: barA,
            barB: barB,
            asymmetric: barA !== barB,
        };
    }

    function resolveAsymmetricSwapNextCounts(specCounts, rehearsalIdxA, rehearsalIdxB, barA, barB) {
        const next = Array.isArray(specCounts) ? specCounts.slice() : [];
        const idxA = rehearsalIdxA | 0;
        const idxB = rehearsalIdxB | 0;
        if (
            idxA < 0 ||
            idxB < 0 ||
            idxA >= next.length ||
            idxB >= next.length
        ) {
            return next;
        }
        const countAtA = next[idxA] | 0;
        const countAtB = next[idxB] | 0;
        const sumBefore = next.reduce((a, c) => a + (c | 0), 0);
        next[idxA] = barB | 0;
        next[idxB] = barA | 0;
        const sumAfter = next.reduce((a, c) => a + (c | 0), 0);
        if (sumAfter !== sumBefore) {
            next[idxA] = countAtB;
            next[idxB] = countAtA;
        }
        return next;
    }

    /**
     * 同一 Rehearsal 内の部分無音↔リージョン（transport bar 基準）
     */
    function tryResolveSilentAudioPartialPlan(ctx) {
        const c = ctx && typeof ctx === 'object' ? ctx : {};
        const track = c.track;
        const silentSlot = c.silentSlot;
        const audioSlot = c.audioSlot;
        const specCounts = Array.isArray(c.specCounts) ? c.specCounts : [];
        const gap = c.gap;
        if (!gap || !audioSlot || !audioSlot.segmentRefs || !audioSlot.segmentRefs.length) {
            return null;
        }
        const rehearsalIdx = silentSlot.musical.rehearsalSlotIndex | 0;
        const audioRehearsalIdx = audioSlot.musical.rehearsalSlotIndex | 0;
        if (
            rehearsalIdx !== audioRehearsalIdx ||
            rehearsalIdx < 0 ||
            rehearsalIdx >= specCounts.length
        ) {
            return null;
        }
        const leader = audioSlot.segmentRefs[0].segmentIndex | 0;
        const placementFn = window.isSameRehearsalSlotPartialSilentGapPlacement;
        if (typeof placementFn !== 'function' || !placementFn(track, gap, leader)) {
            return null;
        }
        const eps = segmentBoundaryEps();
        const targetSec = Number.isFinite(gap.startSec) ? gap.startSec + eps * 2 : null;
        if (targetSec == null) return null;

        const barAudio = resolveSwapBarCountForSlot(audioSlot);
        const markRangeBars = resolveMarkRangeTransportBarCountForSlot(audioSlot);
        const needsShrink = markRangeBars > barAudio && barAudio > 0;

        if (needsShrink) {
            const next = specCounts.slice();
            next[rehearsalIdx] = barAudio;
            return {
                mode: 'silent-partial-shrink',
                nextCounts: next,
                audioDestRehearsalIdx: rehearsalIdx,
                silentDestRehearsalIdx: rehearsalIdx,
                audioTargetSec: targetSec,
                barAudio: barAudio,
                markRangeBars: markRangeBars,
            };
        }
        return {
            mode: 'silent-timeline-only',
            nextCounts: specCounts.slice(),
            audioDestRehearsalIdx: rehearsalIdx,
            silentDestRehearsalIdx: rehearsalIdx,
            audioTargetSec: targetSec,
            barAudio: barAudio,
            markRangeBars: markRangeBars,
        };
    }

    function classifyMusicalSlotPairSwap(ctx) {
        const c = ctx && typeof ctx === 'object' ? ctx : {};
        const slotA = c.slotA;
        const slotB = c.slotB;
        const specCounts = Array.isArray(c.specCounts) ? c.specCounts : [];
        const rehearsalIdxA = c.rehearsalIdxA | 0;
        const rehearsalIdxB = c.rehearsalIdxB | 0;
        const timelineOrderCanonical = !!c.timelineOrderCanonical;
        const eps = segmentBoundaryEps();

        const involvesSilent =
            !!(slotA && slotA.kind === 'silent') || !!(slotB && slotB.kind === 'silent');
        const spanA = resolveSwapTransportSpanForSlot(slotA);
        const spanB = resolveSwapTransportSpanForSlot(slotB);
        const barA = resolveSwapBarCountForSlot(slotA);
        const barB = resolveSwapBarCountForSlot(slotB);
        const transportAnchoredSwap = !involvesSilent && !timelineOrderCanonical;

        if (involvesSilent) {
            return {
                kind: 'silent-audio',
                barA: barA,
                barB: barB,
                spanA: spanA,
                spanB: spanB,
                involvesSilent: true,
                transportAnchoredSwap: false,
                partialRegionSwap: false,
                partialAsymmetric: barA !== barB,
            };
        }

        const specGroupCandidate =
            timelineOrderCanonical &&
            barA === barB &&
            barA > 0 &&
            rehearsalIdxA >= 0 &&
            rehearsalIdxB >= 0 &&
            rehearsalIdxA < specCounts.length &&
            rehearsalIdxB < specCounts.length &&
            slotCoversTransportMarkSpan(slotA, spanA, eps) &&
            slotCoversTransportMarkSpan(slotB, spanB, eps);

        if (specGroupCandidate) {
            return {
                kind: 'spec-group',
                barA: barA,
                barB: barB,
                spanA: spanA,
                spanB: spanB,
                involvesSilent: false,
                transportAnchoredSwap: false,
                partialRegionSwap: false,
                partialAsymmetric: false,
            };
        }

        const kind = barA === barB ? 'partial-symmetric' : 'partial-asymmetric';
        return {
            kind: kind,
            barA: barA,
            barB: barB,
            spanA: spanA,
            spanB: spanB,
            involvesSilent: false,
            transportAnchoredSwap: transportAnchoredSwap,
            partialRegionSwap: true,
            partialAsymmetric: barA !== barB,
        };
    }

    function planMusicalSlotPairSwap(ctx) {
        const c = ctx && typeof ctx === 'object' ? ctx : {};
        const classification = classifyMusicalSlotPairSwap(c);
        const specCounts = Array.isArray(c.specCounts) ? c.specCounts : [];
        const counts =
            Array.isArray(c.slotLevelCounts) && c.slotLevelCounts.length
                ? c.slotLevelCounts
                : specCounts;

        let meterPlan = null;
        if (classification.involvesSilent) {
            const silentSlot =
                c.slotA && c.slotA.kind === 'silent' ? c.slotA : c.slotB;
            const audioSlot =
                c.slotA && c.slotA.kind === 'silent' ? c.slotB : c.slotA;
            if (silentSlot && audioSlot) {
                meterPlan = buildSwapMeterBarPlanFromTransport(
                    silentSlot,
                    audioSlot,
                    counts,
                );
            }
        } else {
            meterPlan = buildSwapMeterBarPlanFromTransport(
                c.slotA,
                c.slotB,
                counts,
            );
        }

        let silentPartialPlan = null;
        if (classification.involvesSilent && c.track) {
            const silentSlot =
                c.slotA && c.slotA.kind === 'silent' ? c.slotA : c.slotB;
            const audioSlot =
                c.slotA && c.slotA.kind === 'silent' ? c.slotB : c.slotA;
            silentPartialPlan = tryResolveSilentAudioPartialPlan({
                track: c.track,
                silentSlot: silentSlot,
                audioSlot: audioSlot,
                specCounts: specCounts,
                gap: c.silentGap,
            });
        }

        let nextCounts = null;
        if (classification.kind === 'spec-group') {
            nextCounts = specCounts.slice();
            const tmp = nextCounts[c.rehearsalIdxA | 0];
            nextCounts[c.rehearsalIdxA | 0] = nextCounts[c.rehearsalIdxB | 0];
            nextCounts[c.rehearsalIdxB | 0] = tmp;
        } else if (classification.partialRegionSwap && classification.partialAsymmetric) {
            nextCounts = resolveAsymmetricSwapNextCounts(
                specCounts,
                c.rehearsalIdxA | 0,
                c.rehearsalIdxB | 0,
                classification.barA,
                classification.barB,
            );
        } else if (classification.partialRegionSwap) {
            nextCounts = specCounts.slice();
        } else if (silentPartialPlan) {
            nextCounts = silentPartialPlan.nextCounts;
        }

        const plan = {
            kind: classification.kind,
            barA: classification.barA,
            barB: classification.barB,
            spanA: classification.spanA,
            spanB: classification.spanB,
            involvesSilent: classification.involvesSilent,
            transportAnchoredSwap: classification.transportAnchoredSwap,
            partialRegionSwap: classification.partialRegionSwap,
            partialAsymmetric: classification.partialAsymmetric,
            meterPlan: meterPlan && meterPlan.ok !== false ? meterPlan : null,
            meterPlanError:
                meterPlan && meterPlan.ok === false ? meterPlan.reason : null,
            silentPartialPlan: silentPartialPlan,
            nextCounts: nextCounts,
        };

        if (typeof window.musicalSlotDiagLog === 'function') {
            window.musicalSlotDiagLog('swap/planner', {
                kind: plan.kind,
                barA: plan.barA,
                barB: plan.barB,
                asymmetric: plan.partialAsymmetric,
                transportAnchoredSwap: plan.transportAnchoredSwap,
                spanA: plan.spanA,
                spanB: plan.spanB,
                meterPlanOk: !!plan.meterPlan,
                coordMismatch: plan.meterPlan ? !!plan.meterPlan.coordMismatch : null,
                silentPartial: plan.silentPartialPlan
                    ? plan.silentPartialPlan.mode
                    : null,
            });
        }

        return plan;
    }

    function assertSwapPlannerReady() {
        return (
            typeof window.planMusicalSlotPairSwap === 'function' &&
            typeof window.resolveSwapBarCountForSlot === 'function' &&
            typeof window.buildSwapMeterBarPlanFromTransport === 'function' &&
            typeof window.resolveTransportMeterSpanForSwapSec === 'function'
        );
    }

    /** 非対称 partial swap の実行経路 — transport mark-draw span 基準の単一モード */
    function resolveAsymmetricSwapExecutionMode(ctx) {
        void ctx;
        return 'transport-swap';
    }

    window.resolveSwapTransportSpanForSlot = resolveSwapTransportSpanForSlot;
    window.resolveSwapBarCountForSlot = resolveSwapBarCountForSlot;
    window.syncSlotMusicalMetadataFromTransport = syncSlotMusicalMetadataFromTransport;
    window.buildSwapMeterBarPlanFromTransport = buildSwapMeterBarPlanFromTransport;
    window.classifyMusicalSlotPairSwap = classifyMusicalSlotPairSwap;
    window.resolveAsymmetricSwapNextCounts = resolveAsymmetricSwapNextCounts;
    window.tryResolveSilentAudioPartialPlanFromTransport =
        tryResolveSilentAudioPartialPlan;
    window.planMusicalSlotPairSwap = planMusicalSlotPairSwap;
    window.assertSwapPlannerReady = assertSwapPlannerReady;
    window.resolveAsymmetricSwapExecutionMode = resolveAsymmetricSwapExecutionMode;
})();
