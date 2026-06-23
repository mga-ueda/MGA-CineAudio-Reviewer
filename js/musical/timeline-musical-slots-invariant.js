/**
 * timeline-musical-slots-invariant.js — Phase 3 回帰 invariant 診断
 *
 * 設計原則の検証層: postCounts / mark-draw / slot timeline の整合。
 * 不具合修正後は必ず本チェックと swap/verify-transport-swap が通ること。
 * 詳細: docs/region-swap-engine-phases.txt「設計原則」
 *
 * DEBUG_LOG.MUSICAL_SLOT が true のとき swap/finalize 後に自動実行。
 * 手動: runMusicalSlotSwapInvariantChecks(track, slots, { counts })
 */
(function timelineMusicalSlotsInvariantModule() {
    function invariantEps() {
        if (typeof window.segmentBoundaryJoinEpsilonSec === 'function') {
            return window.segmentBoundaryJoinEpsilonSec();
        }
        return 0.002;
    }

    function invariantFmtSec(v) {
        if (typeof window.musicalSlotDiagFmtSec === 'function') {
            return window.musicalSlotDiagFmtSec(v);
        }
        return Number.isFinite(v) ? v.toFixed(4) + 's' : String(v);
    }

    function invariantLog(stage, payload) {
        if (typeof window.musicalSlotDiagLog === 'function') {
            window.musicalSlotDiagLog(stage, payload);
        }
    }

    function countsDiffer(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return true;
        for (let i = 0; i < a.length; i++) {
            if ((a[i] | 0) !== (b[i] | 0)) return true;
        }
        return false;
    }

    function normalizeMarkLabel(label) {
        if (typeof window.normalizeRehearsalMarkLabel === 'function') {
            return window.normalizeRehearsalMarkLabel(label);
        }
        return String(label == null ? '' : label).trim();
    }

    function regionLabelFromMusical(musical) {
        if (!musical) return '';
        if (musical.rehearsalLabel) {
            const fromLabel = normalizeMarkLabel(musical.rehearsalLabel);
            if (fromLabel) return fromLabel;
        }
        const idx = musical.rehearsalSlotIndex | 0;
        if (idx >= 0 && typeof window.rehearsalMarkLabelForRehearsalSlotIndex === 'function') {
            return normalizeMarkLabel(window.rehearsalMarkLabelForRehearsalSlotIndex(idx));
        }
        return '';
    }

    function checkRegionBoundsWithinMaster(track, master, eps, issues, details) {
        if (!(master > 0) || typeof window.getTrackSegments !== 'function') return;
        const segments = window.getTrackSegments(track);
        const rows = [];
        for (let si = 0; si < segments.length; si++) {
            let inSec = NaN;
            let outSec = NaN;
            if (typeof window.getSegmentRegionTimelineIn === 'function') {
                inSec = window.getSegmentRegionTimelineIn(track, si);
            }
            if (typeof window.getSegmentRegionTimelineOut === 'function') {
                outSec = window.getSegmentRegionTimelineOut(track, si);
            }
            const row = { region: si + 1, in: inSec, out: outSec };
            rows.push(row);
            if (!Number.isFinite(inSec) || inSec < -eps) {
                issues.push('region ' + (si + 1) + ': in < 0 (' + invariantFmtSec(inSec) + ')');
            }
            if (Number.isFinite(outSec) && outSec > master + eps) {
                issues.push(
                    'region ' +
                        (si + 1) +
                        ': out past master (' +
                        invariantFmtSec(outSec) +
                        ' > ' +
                        invariantFmtSec(master) +
                        ')',
                );
            }
            if (
                Number.isFinite(inSec) &&
                Number.isFinite(outSec) &&
                outSec < inSec - eps
            ) {
                issues.push(
                    'region ' +
                        (si + 1) +
                        ': out < in (' +
                        invariantFmtSec(outSec) +
                        ' < ' +
                        invariantFmtSec(inSec) +
                        ')',
                );
            }
        }
        details.regionBounds = rows;
    }

    function checkUserMarkersInsideRegions(track, eps, issues, details) {
        const markers =
            typeof window.getMarkersSnapshot === 'function'
                ? window.getMarkersSnapshot()
                : [];
        if (!markers.length) {
            details.userMarkers = { count: 0 };
            return;
        }
        if (typeof window.getSegmentRegionTimelineBounds !== 'function') return;

        const rows = [];
        let checked = 0;
        for (let mi = 0; mi < markers.length; mi++) {
            const m = markers[mi];
            if (!m) continue;
            const comment = m.comment != null ? String(m.comment) : '';
            if (
                typeof window.isRegionVolumeMarkerComment === 'function' &&
                window.isRegionVolumeMarkerComment(comment)
            ) {
                continue;
            }
            if (
                typeof window.isRegionPitchMarkerComment === 'function' &&
                window.isRegionPitchMarkerComment(comment)
            ) {
                continue;
            }
            checked += 1;
            let markerStart = NaN;
            let markerEnd = NaN;
            if (m.type === 'point' && Number.isFinite(m.timeSec)) {
                markerStart = m.timeSec;
                markerEnd = m.timeSec;
            } else if (m.type === 'range') {
                markerStart = Number.isFinite(m.startSec) ? m.startSec : NaN;
                markerEnd = Number.isFinite(m.endSec) ? m.endSec : NaN;
            }
            if (!Number.isFinite(markerStart)) continue;

            let ownerSeg = -1;
            let ownerBounds = null;
            const segCount =
                typeof window.getTrackSegments === 'function'
                    ? window.getTrackSegments(track).length
                    : 0;
            for (let si = 0; si < segCount; si++) {
                const bounds = window.getSegmentRegionTimelineBounds(track.slot, si);
                if (
                    !bounds ||
                    !Number.isFinite(bounds.startSec) ||
                    !Number.isFinite(bounds.endSec)
                ) {
                    continue;
                }
                const insideStart = markerStart >= bounds.startSec - eps;
                const insideEnd =
                    m.type === 'point'
                        ? markerStart <= bounds.endSec + eps
                        : Number.isFinite(markerEnd) &&
                          markerEnd <= bounds.endSec + eps &&
                          markerEnd >= bounds.startSec - eps;
                if (insideStart && insideEnd) {
                    const span = bounds.endSec - bounds.startSec;
                    if (!ownerBounds || span < ownerBounds.endSec - ownerBounds.startSec) {
                        ownerSeg = si;
                        ownerBounds = bounds;
                    }
                }
            }
            const row = {
                marker: mi + 1,
                type: m.type,
                start: invariantFmtSec(markerStart),
                end: m.type === 'range' ? invariantFmtSec(markerEnd) : undefined,
                ownerRegion: ownerSeg >= 0 ? ownerSeg + 1 : null,
            };
            rows.push(row);
            if (ownerSeg < 0) {
                issues.push(
                    'user marker ' +
                        (mi + 1) +
                        ' (' +
                        m.type +
                        ' @ ' +
                        invariantFmtSec(markerStart) +
                        ') not inside any region',
                );
            }
        }
        details.userMarkers = { checked, rows };
    }

    function checkSlotTimelineVsSegments(track, slots, eps, issues, details) {
        if (!Array.isArray(slots) || !slots.length) return;
        const rows = [];
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
            const leader = slot.segmentRefs[0].segmentIndex | 0;
            let regionIn = NaN;
            if (typeof window.getSegmentRegionTimelineIn === 'function') {
                regionIn = window.getSegmentRegionTimelineIn(track, leader);
            }
            const slotStart = slot.timelineStartSec;
            const slotEnd = slot.timelineEndSec;
            const deltaStart =
                Number.isFinite(regionIn) && Number.isFinite(slotStart)
                    ? regionIn - slotStart
                    : NaN;
            const row = {
                unit: si + 1,
                region: leader + 1,
                slotStart: invariantFmtSec(slotStart),
                slotEnd: invariantFmtSec(slotEnd),
                regionIn: invariantFmtSec(regionIn),
                deltaStart,
            };
            rows.push(row);
            if (Number.isFinite(deltaStart) && Math.abs(deltaStart) > eps * 4) {
                issues.push(
                    'swapUnit ' +
                        (si + 1) +
                        ' (R' +
                        (leader + 1) +
                        '): slot start ' +
                        invariantFmtSec(slotStart) +
                        ' != region in ' +
                        invariantFmtSec(regionIn) +
                        ' (Δ' +
                        invariantFmtSec(deltaStart) +
                        ')',
                );
            }
        }
        details.slotVsRegion = rows;
    }

    function checkCountsRangesVsDrawRanges(master, meterSpec, counts, eps, issues, details) {
        if (
            !(master > 0) ||
            !counts ||
            !counts.length ||
            typeof window.collectRehearsalGroupRangesFromBarCounts !== 'function'
        ) {
            return;
        }
        const countRanges = window.collectRehearsalGroupRangesFromBarCounts(
            meterSpec,
            master,
            counts,
        );
        const drawRanges =
            typeof window.collectRehearsalMarkDrawRanges === 'function'
                ? window.collectRehearsalMarkDrawRanges(master, meterSpec)
                : [];
        const labeledDraw = drawRanges.filter((r) => r && r.fromRehearsalEvent);
        const rows = [];
        let countOffset = 0;
        if (
            countRanges.length > labeledDraw.length &&
            Array.isArray(counts) &&
            (counts[0] | 0) === 1 &&
            countRanges[0] &&
            countRanges[0].startSec < eps
        ) {
            countOffset = 1;
        }
        const n = Math.min(countRanges.length - countOffset, labeledDraw.length, 12);
        for (let i = 0; i < n; i++) {
            const cr = countRanges[i + countOffset];
            const dr = labeledDraw[i];
            if (!cr || !dr) continue;
            const startDelta = cr.startSec - dr.startSec;
            const endDelta = cr.endSec - dr.endSec;
            const row = {
                rehearsal: i + 1 + countOffset,
                countsStart: invariantFmtSec(cr.startSec),
                countsEnd: invariantFmtSec(cr.endSec),
                drawStart: invariantFmtSec(dr.startSec),
                drawEnd: invariantFmtSec(dr.endSec),
                drawLabel: dr.label,
                startDelta,
                endDelta,
            };
            rows.push(row);
            if (Math.abs(startDelta) > eps * 4) {
                issues.push(
                    'rehearsal ' +
                        (i + 1 + countOffset) +
                        ': counts start ' +
                        invariantFmtSec(cr.startSec) +
                        ' != draw start ' +
                        invariantFmtSec(dr.startSec),
                );
            }
            if (Math.abs(endDelta) > eps * 4) {
                issues.push(
                    'rehearsal ' +
                        (i + 1 + countOffset) +
                        ': counts end ' +
                        invariantFmtSec(cr.endSec) +
                        ' != draw end ' +
                        invariantFmtSec(dr.endSec),
                );
            }
        }
        details.countsVsDraw = {
            countRangeLen: countRanges.length,
            drawRangeLen: labeledDraw.length,
            rows,
        };
    }

    function checkMarkLabelsVsRegionLeaders(track, slots, master, meterSpec, counts, eps, issues, details) {
        if (
            !(master > 0) ||
            !counts ||
            !counts.length ||
            typeof window.collectRehearsalGroupRangesFromBarCounts !== 'function'
        ) {
            return;
        }
        const countRanges = window.collectRehearsalGroupRangesFromBarCounts(
            meterSpec,
            master,
            counts,
        );
        const markEvents =
            typeof window.getRehearsalMarkTrackEventsPersistSnapshot === 'function'
                ? window.getRehearsalMarkTrackEventsPersistSnapshot()
                : [];
        const rows = [];
        for (let ri = 0; ri < countRanges.length && ri < 12; ri++) {
            const range = countRanges[ri];
            if (!range || !Number.isFinite(range.startSec)) continue;
            let markLabel = '';
            for (let ei = 0; ei < markEvents.length; ei++) {
                if (Math.abs(markEvents[ei].sec - range.startSec) <= eps * 4) {
                    markLabel = normalizeMarkLabel(markEvents[ei].label);
                    break;
                }
            }
            let regionLabel = '';
            let leaderRegion = null;
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
                const rehearsalIdx = slot.musical && (slot.musical.rehearsalSlotIndex | 0);
                if (rehearsalIdx !== ri) continue;
                const leader = slot.segmentRefs[0].segmentIndex | 0;
                let inSec = NaN;
                if (typeof window.getSegmentRegionTimelineIn === 'function') {
                    inSec = window.getSegmentRegionTimelineIn(track, leader);
                }
                if (
                    !Number.isFinite(inSec) ||
                    Math.abs(inSec - range.startSec) > eps * 8
                ) {
                    continue;
                }
                regionLabel = regionLabelFromMusical(slot.musical);
                leaderRegion = leader + 1;
                break;
            }
            const row = {
                rehearsal: ri + 1,
                rangeStart: invariantFmtSec(range.startSec),
                markLabel: markLabel || null,
                regionLabel: regionLabel || null,
                leaderRegion,
            };
            rows.push(row);
            if (markLabel && regionLabel && markLabel !== regionLabel) {
                issues.push(
                    'rehearsal ' +
                        (ri + 1) +
                        ': mark label "' +
                        markLabel +
                        '" != region label "' +
                        regionLabel +
                        '" (R' +
                        (leaderRegion || '?') +
                        ')',
                );
            }
            if (markLabel && !regionLabel) {
                issues.push(
                    'rehearsal ' +
                        (ri + 1) +
                        ': mark label "' +
                        markLabel +
                        '" but no matching region leader',
                );
            }
        }
        details.markVsRegionLabels = rows;
    }

    function checkSlotTimelineVsCountsRanges(slots, master, meterSpec, counts, eps, issues, details) {
        if (
            !(master > 0) ||
            !counts ||
            !counts.length ||
            typeof window.collectRehearsalGroupRangesFromBarCounts !== 'function'
        ) {
            return;
        }
        const countRanges = window.collectRehearsalGroupRangesFromBarCounts(
            meterSpec,
            master,
            counts,
        );
        const rows = [];
        for (let si = 0; si < slots.length; si++) {
            const slot = slots[si];
            if (!slot || !slot.musical) continue;
            const rehearsalIdx = slot.musical.rehearsalSlotIndex | 0;
            if (rehearsalIdx < 0 || rehearsalIdx >= countRanges.length) continue;
            const cr = countRanges[rehearsalIdx];
            if (!cr) continue;
            const startDelta = Number.isFinite(slot.timelineStartSec)
                ? slot.timelineStartSec - cr.startSec
                : NaN;
            const endDelta = Number.isFinite(slot.timelineEndSec)
                ? slot.timelineEndSec - cr.endSec
                : NaN;
            const row = {
                unit: si + 1,
                rehearsal: rehearsalIdx + 1,
                slotStart: invariantFmtSec(slot.timelineStartSec),
                slotEnd: invariantFmtSec(slot.timelineEndSec),
                countsStart: invariantFmtSec(cr.startSec),
                countsEnd: invariantFmtSec(cr.endSec),
                startDelta,
                endDelta,
            };
            rows.push(row);
            if (Number.isFinite(startDelta) && Math.abs(startDelta) > eps * 8) {
                issues.push(
                    'swapUnit ' +
                        (si + 1) +
                        ' rehearsal ' +
                        (rehearsalIdx + 1) +
                        ': slot start != counts start (Δ' +
                        invariantFmtSec(startDelta) +
                        ')',
                );
            }
            if (Number.isFinite(endDelta) && Math.abs(endDelta) > eps * 8) {
                issues.push(
                    'swapUnit ' +
                        (si + 1) +
                        ' rehearsal ' +
                        (rehearsalIdx + 1) +
                        ': slot end != counts end (Δ' +
                        invariantFmtSec(endDelta) +
                        ')',
                );
            }
        }
        details.slotVsCounts = rows;
    }

    function resolveTransportSpanForSlot(slot, eps) {
        if (
            !slot ||
            !Number.isFinite(slot.timelineStartSec) ||
            typeof window.resolveSwapTransportSpanForSlot !== 'function'
        ) {
            return null;
        }
        return window.resolveSwapTransportSpanForSlot(slot, {
            eps: eps,
            endSec: slot.timelineEndSec,
        });
    }

    function segmentSourceSpanSec(track, segmentIndex) {
        if (typeof window.getTrackSegments !== 'function') return NaN;
        const segments = window.getTrackSegments(track);
        const seg = segments && segments[segmentIndex | 0];
        if (!seg) return NaN;
        const minSec =
            typeof window.PLAYBACK_REGION_MIN_SEC === 'number'
                ? window.PLAYBACK_REGION_MIN_SEC
                : 0.01;
        const sourceIn = Number(seg.sourceInSec) || 0;
        const sourceOut = Number(seg.sourceOutSec) || 0;
        return Math.max(minSec, sourceOut - sourceIn);
    }

    function checkTransportSwapMeterSlicePurity(
        slots,
        swapPair,
        captured,
        meterSpec,
        master,
        issues,
        details,
    ) {
        if (
            !captured ||
            !swapPair ||
            swapPair.length < 2 ||
            !meterSpec ||
            !(master > 0) ||
            typeof window.resolveTempoBpmAtSec !== 'function' ||
            typeof window.getTempoTrackEvents !== 'function'
        ) {
            return;
        }
        const tempoEvents = window.getTempoTrackEvents(meterSpec, master);
        const pairs = [
            {
                slotIdx: swapPair[0] | 0,
                slice: captured.sliceB,
                tag: 'slotA',
            },
            {
                slotIdx: swapPair[1] | 0,
                slice: captured.sliceA,
                tag: 'slotB',
            },
        ];
        const rows = [];
        for (let pi = 0; pi < pairs.length; pi++) {
            const pair = pairs[pi];
            const slot = slots[pair.slotIdx];
            if (!slot || !Array.isArray(pair.slice) || !pair.slice.length) continue;
            if (
                !Number.isFinite(slot.timelineStartSec) ||
                !Number.isFinite(slot.timelineEndSec) ||
                slot.timelineEndSec <= slot.timelineStartSec + 1e-6
            ) {
                continue;
            }
            const slotStart = slot.timelineStartSec;
            const spanDur = slot.timelineEndSec - slotStart;
            const mismatches = [];
            for (let bi = 0; bi < pair.slice.length; bi++) {
                const expected = pair.slice[bi];
                const sec = slotStart + (spanDur * (bi + 0.5)) / pair.slice.length;
                const actualBpm = window.resolveTempoBpmAtSec(sec, meterSpec, tempoEvents);
                const expectedBpm = expected && Number.isFinite(expected.bpm) ? expected.bpm : NaN;
                if (
                    Number.isFinite(expectedBpm) &&
                    Number.isFinite(actualBpm) &&
                    Math.abs(actualBpm - expectedBpm) > 0.5
                ) {
                    mismatches.push({
                        bar: bi,
                        sec: invariantFmtSec(sec),
                        expected: expectedBpm,
                        actual: actualBpm,
                    });
                }
            }
            rows.push({
                tag: pair.tag,
                unit: pair.slotIdx + 1,
                sliceLen: pair.slice.length,
                mismatches: mismatches.slice(0, 8),
            });
            if (mismatches.length) {
                issues.push(
                    'transport-swap meter ' +
                        pair.tag +
                        ' unit ' +
                        (pair.slotIdx + 1) +
                        ': ' +
                        mismatches.length +
                        ' bar(s) with unexpected BPM (first @ ' +
                        mismatches[0].sec +
                        ' expected ' +
                        mismatches[0].expected +
                        ' got ' +
                        mismatches[0].actual +
                        ')',
                );
            }
        }
        if (rows.length) {
            details.transportSwapMeter = rows;
        }
    }

    function checkTransportSwapFinalize(track, slots, opt, eps, issues, details) {
        if (!opt || !opt.transportSwap) return;
        const swapPair = Array.isArray(opt.swapPairIndices) ? opt.swapPairIndices : null;
        const destTimelines = opt.destTimelines;
        const swapBarCounts = opt.swapBarCounts;
        const pairRows = [];
        const tol = eps * 4;

        if (swapPair && swapPair.length >= 2) {
            for (let pi = 0; pi < swapPair.length; pi++) {
                const slotIdx = swapPair[pi] | 0;
                const slot = slots[slotIdx];
                if (!slot || slot.kind === 'silent') continue;
                const m = slot.musical || {};
                const leader =
                    slot.segmentRefs && slot.segmentRefs.length
                        ? slot.segmentRefs[0].segmentIndex | 0
                        : -1;
                let regionIn = NaN;
                let regionOut = NaN;
                if (leader >= 0) {
                    if (typeof window.getSegmentRegionTimelineIn === 'function') {
                        regionIn = window.getSegmentRegionTimelineIn(track, leader);
                    }
                    if (typeof window.getSegmentRegionTimelineOut === 'function') {
                        regionOut = window.getSegmentRegionTimelineOut(track, leader);
                    }
                }
                const span = resolveTransportSpanForSlot(slot, eps);
                const slotStart = slot.timelineStartSec;
                const slotEnd = slot.timelineEndSec;
                const slotDur =
                    Number.isFinite(slotStart) && Number.isFinite(slotEnd)
                        ? slotEnd - slotStart
                        : NaN;
                const sourceDur = leader >= 0 ? segmentSourceSpanSec(track, leader) : NaN;
                const destKey =
                    (slotIdx | 0) === (swapPair[0] | 0)
                        ? 'a'
                        : (slotIdx | 0) === (swapPair[1] | 0)
                          ? 'b'
                          : null;
                const dest = destKey && destTimelines ? destTimelines[destKey] : null;
                const row = {
                    unit: slotIdx + 1,
                    region: leader >= 0 ? leader + 1 : null,
                    slotStart: invariantFmtSec(slotStart),
                    slotEnd: invariantFmtSec(slotEnd),
                    regionIn: invariantFmtSec(regionIn),
                    regionOut: invariantFmtSec(regionOut),
                    contentBars: m.contentBarCount | 0,
                    rehearsalBars: m.rehearsalBarCount | 0,
                    meterBarStart: m.meterBarStart | 0,
                    transportSpan: span
                        ? {
                              label: span.label,
                              barCount: span.transportBarCount | 0,
                              barStart: span.transportBarStart | 0,
                              start: invariantFmtSec(span.startSec),
                              end: invariantFmtSec(span.endSec),
                          }
                        : null,
                    extendedOut:
                        leader >= 0 &&
                        typeof window.getTrackSegments === 'function'
                            ? !!window.getTrackSegments(track)[leader]?.regionTimelineOutSec
                            : false,
                };
                pairRows.push(row);

                if (dest && Number.isFinite(dest.start) && Number.isFinite(dest.end)) {
                    if (Number.isFinite(slotStart) && Math.abs(slotStart - dest.start) > tol) {
                        issues.push(
                            'transport-swap unit ' +
                                (slotIdx + 1) +
                                ': slot start ' +
                                invariantFmtSec(slotStart) +
                                ' != dest start ' +
                                invariantFmtSec(dest.start),
                        );
                    }
                    if (Number.isFinite(slotEnd) && Math.abs(slotEnd - dest.end) > tol) {
                        issues.push(
                            'transport-swap unit ' +
                                (slotIdx + 1) +
                                ': slot end ' +
                                invariantFmtSec(slotEnd) +
                                ' != dest end ' +
                                invariantFmtSec(dest.end),
                        );
                    }
                }

                if (span) {
                    if (
                        Number.isFinite(slotStart) &&
                        Math.abs(slotStart - span.startSec) > tol
                    ) {
                        issues.push(
                            'transport-swap unit ' +
                                (slotIdx + 1) +
                                ': slot start != transport span start (Δ' +
                                invariantFmtSec(slotStart - span.startSec) +
                                ')',
                        );
                    }
                    if (Number.isFinite(slotEnd) && Math.abs(slotEnd - span.endSec) > tol) {
                        issues.push(
                            'transport-swap unit ' +
                                (slotIdx + 1) +
                                ': slot end != transport span end (Δ' +
                                invariantFmtSec(slotEnd - span.endSec) +
                                ')',
                        );
                    }
                    const expectedBars =
                        swapBarCounts && swapPair && swapPair.length >= 2
                            ? (slotIdx | 0) === (swapPair[0] | 0)
                                ? swapBarCounts.barB | 0
                                : (slotIdx | 0) === (swapPair[1] | 0)
                                  ? swapBarCounts.barA | 0
                                  : span.transportBarCount | 0
                            : span.transportBarCount | 0;
                    if ((m.contentBarCount | 0) !== expectedBars) {
                        issues.push(
                            'transport-swap unit ' +
                                (slotIdx + 1) +
                                ' (R' +
                                (leader + 1) +
                                '): contentBarCount ' +
                                (m.contentBarCount | 0) +
                                ' != expected swapped barCount ' +
                                expectedBars,
                        );
                    }
                    if ((m.rehearsalBarCount | 0) !== expectedBars) {
                        issues.push(
                            'transport-swap unit ' +
                                (slotIdx + 1) +
                                ': rehearsalBarCount ' +
                                (m.rehearsalBarCount | 0) +
                                ' != expected swapped barCount ' +
                                expectedBars,
                        );
                    }
                } else if (Number.isFinite(slotStart)) {
                    issues.push(
                        'transport-swap unit ' +
                            (slotIdx + 1) +
                            ': no transport span at ' +
                            invariantFmtSec(slotStart),
                    );
                }

                if (Number.isFinite(regionIn) && Number.isFinite(slotStart)) {
                    const deltaIn = regionIn - slotStart;
                    if (Math.abs(deltaIn) > tol) {
                        issues.push(
                            'transport-swap unit ' +
                                (slotIdx + 1) +
                                ' (R' +
                                (leader + 1) +
                                '): region in != slot start (Δ' +
                                invariantFmtSec(deltaIn) +
                                ')',
                        );
                    }
                }
                if (Number.isFinite(regionOut) && Number.isFinite(slotEnd)) {
                    const deltaOut = regionOut - slotEnd;
                    if (Math.abs(deltaOut) > tol) {
                        issues.push(
                            'transport-swap unit ' +
                                (slotIdx + 1) +
                                ' (R' +
                                (leader + 1) +
                                '): region out != slot end (Δ' +
                                invariantFmtSec(deltaOut) +
                                ')',
                        );
                    }
                }
                if (
                    Number.isFinite(slotDur) &&
                    Number.isFinite(sourceDur) &&
                    sourceDur > tol &&
                    slotDur > sourceDur * 1.1
                ) {
                    const seg =
                        leader >= 0 && typeof window.getTrackSegments === 'function'
                            ? window.getTrackSegments(track)[leader]
                            : null;
                    if (seg && Number.isFinite(seg.regionTimelineOutSec)) {
                        const ratio = slotDur / sourceDur;
                        if (ratio > 1.15) {
                            issues.push(
                                'transport-swap unit ' +
                                    (slotIdx + 1) +
                                    ' (R' +
                                    (leader + 1) +
                                    '): stretch ratio ' +
                                    ratio.toFixed(2) +
                                    ' (source may not be swapped)',
                            );
                        }
                    }
                }
            }
        }

        checkTransportSwapMeterSlicePurity(
            slots,
            swapPair,
            opt.preSwapMeterSlices,
            opt.meterSpec,
            opt.master,
            issues,
            details,
        );

        let silentUnits = 0;
        for (let si = 0; si < slots.length; si++) {
            const slot = slots[si];
            if (!slot || slot.kind === 'silent') continue;
            if (
                typeof window.isHeadPadAnchoredSwapSlot === 'function' &&
                window.isHeadPadAnchoredSwapSlot(track, slot)
            ) {
                const start = slot.timelineStartSec;
                const end = slot.timelineEndSec;
                if (Number.isFinite(start) && start > tol * 4) {
                    issues.push(
                        'transport-swap head-pad unit ' +
                            (si + 1) +
                            ': start ' +
                            invariantFmtSec(start) +
                            ' != transport head (~0)',
                    );
                }
                if (Number.isFinite(end) && end > 2 + tol * 4) {
                    issues.push(
                        'transport-swap head-pad unit ' +
                            (si + 1) +
                            ': end ' +
                            invariantFmtSec(end) +
                            ' beyond pickup span',
                    );
                }
            }
        }
        for (let si = 0; si < slots.length; si++) {
            if (slots[si] && slots[si].kind === 'silent') silentUnits++;
        }
        if (swapPair && swapPair.length >= 2) {
            const seenSpans = new Map();
            for (let si = 0; si < slots.length; si++) {
                const slot = slots[si];
                if (!slot || slot.kind === 'silent') continue;
                const start = slot.timelineStartSec;
                const end = slot.timelineEndSec;
                if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
                const key = invariantFmtSec(start) + '–' + invariantFmtSec(end);
                const prev = seenSpans.get(key);
                if (prev != null) {
                    issues.push(
                        'transport-swap overlap: unit ' +
                            (prev + 1) +
                            ' and unit ' +
                            (si + 1) +
                            ' share span ' +
                            key,
                    );
                } else {
                    seenSpans.set(key, si);
                }
            }
        }
        if (silentUnits > 0) {
            issues.push(
                'transport-swap: unexpected silent unit count ' + silentUnits + ' (expected 0)',
            );
        }

        details.transportSwap = {
            swapPairIndices: swapPair,
            silentUnits,
            pairRows,
        };
    }

    /**
     * @returns {{ ok: boolean, issues: string[], details: object }}
     */
    function runMusicalSlotSwapInvariantChecks(trackOrSlot, slots, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const track =
            trackOrSlot != null && typeof trackOrSlot === 'object' && trackOrSlot.type === 'extra'
                ? trackOrSlot
                : { type: 'extra', slot: (trackOrSlot | 0) };
        const issues = [];
        const details = {};
        const eps = invariantEps();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const settings =
            typeof window.musicalGridDrawSettings === 'function'
                ? window.musicalGridDrawSettings()
                : null;
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;

        let slotList = Array.isArray(slots) ? slots : null;
        if (!slotList && typeof getTrackTimelineSlots === 'function') {
            slotList = getTrackTimelineSlots(track, {
                writeCache: false,
                preserveStored: true,
            });
        }
        if (!slotList) slotList = [];

        let counts = Array.isArray(o.counts) ? o.counts : null;
        if (!counts || !counts.length) {
            counts =
                typeof window.getExpandedRehearsalGroupBarCountsSnapshot === 'function'
                    ? window.getExpandedRehearsalGroupBarCountsSnapshot()
                    : [];
        }

        checkRegionBoundsWithinMaster(track, master, eps, issues, details);
        checkUserMarkersInsideRegions(track, eps, issues, details);
        checkSlotTimelineVsSegments(track, slotList, eps, issues, details);
        if (meterSpec && counts.length && !o.skipFillPartialCountsChecks) {
            checkCountsRangesVsDrawRanges(master, meterSpec, counts, eps, issues, details);
            checkSlotTimelineVsCountsRanges(slotList, master, meterSpec, counts, eps, issues, details);
            checkMarkLabelsVsRegionLeaders(
                track,
                slotList,
                master,
                meterSpec,
                counts,
                eps,
                issues,
                details,
            );
        }
        if (o.transportSwap) {
            checkTransportSwapFinalize(
                track,
                slotList,
                Object.assign({}, o, { master: master, meterSpec: meterSpec }),
                eps,
                issues,
                details,
            );
        }

        const report = {
            ok: !issues.length,
            issueCount: issues.length,
            issues: issues.slice(0, 24),
            ex: (track.slot | 0) + 1,
            stage: o.stage || 'manual',
            master: invariantFmtSec(master),
            countsHead: counts.slice(0, 12),
            details,
        };

        if (o.countsBefore && countsDiffer(o.countsBefore, counts)) {
            report.countsChanged = true;
        }

        const logStage = o.logStage || 'swap/invariant-check';
        invariantLog(logStage, report);

        if (o.transportSwap) {
            const transportIssues = issues.filter((msg) => msg.indexOf('transport-swap') === 0);
            const transportReport = {
                ok: !transportIssues.length,
                issueCount: transportIssues.length,
                ex: report.ex,
                pairRows: details.transportSwap ? details.transportSwap.pairRows : undefined,
                silentUnits: details.transportSwap ? details.transportSwap.silentUnits : undefined,
            };
            if (transportIssues.length) {
                transportReport.issues = transportIssues.slice(0, 16);
            }
            invariantLog('swap/verify-transport-swap', transportReport);
            if (!transportReport.ok && typeof writeLog === 'function') {
                writeLog(
                    '[MusicalSlot] swap/verify-transport-swap Ex' +
                        report.ex +
                        ' **FAIL** (' +
                        transportReport.issueCount +
                        ' issue(s))',
                );
                for (let ti = 0; ti < Math.min(transportReport.issues.length, 12); ti++) {
                    writeLog('[MusicalSlot]   ! ' + transportReport.issues[ti]);
                }
            } else if (typeof writeLog === 'function') {
                writeLog('[MusicalSlot] swap/verify-transport-swap Ex' + report.ex + ' OK');
            }
        }

        if (issues.length && typeof writeLog === 'function') {
            writeLog(
                '[MusicalSlot] ' +
                    logStage +
                    ' Ex' +
                    report.ex +
                    ' **' +
                    issues.length +
                    ' issue(s)**',
            );
            for (let i = 0; i < Math.min(issues.length, 12); i++) {
                writeLog('[MusicalSlot]   ! ' + issues[i]);
            }
        }

        return { ok: report.ok, issues, details };
    }

    window.runMusicalSlotSwapInvariantChecks = runMusicalSlotSwapInvariantChecks;
})();
