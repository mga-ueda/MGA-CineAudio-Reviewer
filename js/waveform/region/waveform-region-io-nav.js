/**
 * waveform-region-io-nav.js — リージョンナビ・リハーサル名ジャンプ
 */
    function sortRegionNavStops(stops) {
        stops.sort((a, b) => {
            if (a.sec !== b.sec) return a.sec - b.sec;
            const edgeRank = { in: 0, out: 1 };
            if (a.slot !== b.slot) return a.slot - b.slot;
            if (a.segmentIndex !== b.segmentIndex) return a.segmentIndex - b.segmentIndex;
            return (edgeRank[a.edge] || 0) - (edgeRank[b.edge] || 0);
        });
    }

    function appendRangeLoopNavStops(stops) {
        if (
            typeof isRangeLoopPlaybackActive !== 'function' ||
            !isRangeLoopPlaybackActive()
        ) {
            return;
        }
        const inSec =
            typeof getRangeLoopInSec === 'function' ? getRangeLoopInSec() : NaN;
        const outSec =
            typeof getRangeLoopOutSec === 'function' ? getRangeLoopOutSec() : NaN;
        if (Number.isFinite(inSec)) {
            stops.push({ sec: inSec, edge: 'in', slot: -1, segmentIndex: -1 });
        }
        if (Number.isFinite(outSec)) {
            stops.push({ sec: outSec, edge: 'out', slot: -1, segmentIndex: -1 });
        }
    }

    /** Ex リージョン In/Out（マーカー非表示時の ↑↓ ナビ用） */
    function buildRegionNavStops() {
        const stops = [];
        const trackCount =
            getExtraTrackCount();
        for (let slot = 0; slot < trackCount; slot++) {
            const track = { type: 'extra', slot };
            const segments = getTrackSegments(track);
            for (let i = 0; i < segments.length; i++) {
                const inSec = getSegmentRegionTimelineIn(track, i);
                const outSec = getSegmentTimelineEnd(track, i);
                if (Number.isFinite(inSec)) {
                    stops.push({ sec: inSec, edge: 'in', slot, segmentIndex: i });
                }
                if (Number.isFinite(outSec)) {
                    stops.push({ sec: outSec, edge: 'out', slot, segmentIndex: i });
                }
            }
        }
        if (!stops.length) {
            appendRangeLoopNavStops(stops);
        }
        sortRegionNavStops(stops);
        return stops;
    }

    function regionNavStopEpsilonSec() {
        if (typeof markerNavStopEpsilonSec === 'function') {
            return markerNavStopEpsilonSec();
        }
        return regionSnapThresholdSec();
    }

    function regionNavStopIndexForCurrent(stops, dir, fromSec) {
        if (!stops || stops.length === 0) return -1;
        const t = Number.isFinite(fromSec)
            ? fromSec
            : typeof getTransportSec === 'function'
              ? getTransportSec()
              : typeof videoMain !== 'undefined' && videoMain
                ? videoMain.currentTime || 0
                : 0;
        const eps = regionNavStopEpsilonSec();
        if (dir < 0) {
            for (let i = 0; i < stops.length; i++) {
                if (stops[i].sec > t - eps) return i;
            }
            let best = -1;
            for (let i = 0; i < stops.length; i++) {
                if (stops[i].sec <= t + eps) best = i;
                else break;
            }
            return best;
        }
        let best = -1;
        for (let i = 0; i < stops.length; i++) {
            if (stops[i].sec <= t + eps) best = i;
            else break;
        }
        return best;
    }

    function syncRegionNavSeekTransportUi(t) {
        if (typeof syncTransportSeekUi === 'function') {
            syncTransportSeekUi(t);
        }
    }

    function regionNavHintTitleForSlot(slot) {
        if (slot < 0) return 'Range loop';
        if (
            typeof extraTrackBySlot === 'function' &&
            typeof getExtraTrackFileName === 'function'
        ) {
            const name = getExtraTrackFileName(extraTrackBySlot(slot));
            if (name) return name;
        }
        return 'Ex ' + (slot + 1);
    }

    function seekToRegionNavStop(stop, opt) {
        if (!stop || !Number.isFinite(stop.sec)) return false;
        const resumeAfter = !!(opt && opt.resumeAfterSeek);
        let target = stop.sec;
        if (typeof clampTransportSec === 'function') {
            target = clampTransportSec(target);
        }
        if (typeof suppressRangeLoopSnapForExplicitSeek === 'function') {
            suppressRangeLoopSnapForExplicitSeek();
        }
        if (
            opt &&
            opt.discreteStopNav &&
            typeof applyDiscreteStopNavStep === 'function'
        ) {
            applyDiscreteStopNavStep(target, {
                resumeAfterSeek: resumeAfter,
                fromRepeat: opt.fromRepeat,
            });
            syncRegionNavSeekTransportUi(target);
            const edgeLabel = stop.edge === 'out' ? ' Out' : ' In';
            const hintTc =
                typeof formatTimecodeForTransport === 'function'
                    ? formatTimecodeForTransport(target)
                    : String(target);
            const hintTitle =
                opt && opt.hintTitle
                    ? opt.hintTitle
                    : regionNavHintTitleForSlot(stop.slot);
            if (!opt.fromRepeat) {
                writeLog('Region: seek to ' + hintTitle + ' ' + hintTc + edgeLabel);
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint(hintTitle, hintTc + edgeLabel);
                }
            }
            return true;
        }
        if (typeof applyJumpTransportSeek === 'function') {
            applyJumpTransportSeek(target, resumeAfter);
        } else if (typeof applyTransportAtSec === 'function') {
            applyTransportAtSec(target, { resumeAfter: resumeAfter });
        }
        syncRegionNavSeekTransportUi(target);
        const edgeLabel = stop.edge === 'out' ? ' Out' : ' In';
        const hintTc =
            typeof formatTimecodeForTransport === 'function'
                ? formatTimecodeForTransport(target)
                : String(target);
        const hintTitle =
            opt && opt.hintTitle
                ? opt.hintTitle
                : regionNavHintTitleForSlot(stop.slot);
        writeLog('Region: seek to ' + hintTitle + ' ' + hintTc + edgeLabel);
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(hintTitle, hintTc + edgeLabel);
        }
        return true;
    }

    /** 内部ラベル — リハーサル名なし区間（表示は空文字） */
    const REHEARSAL_MARK_UNLABELED = '_';

    /** Rehearsal スロット index（0 始まり）→ リハーサル名（A/B/… または REHEARSAL_MARK_UNLABELED） */
    function rehearsalMarkLabelForRehearsalSlotIndex(rehearsalSlotIndex) {
        const rehearsalSlot = rehearsalSlotIndex | 0;
        if (rehearsalSlot < 0) return REHEARSAL_MARK_UNLABELED;
        if (typeof getRehearsalGroupRangesForRegionRehearsalMarks === 'function') {
            const ranges = getRehearsalGroupRangesForRegionRehearsalMarks();
            const r = ranges[rehearsalSlot];
            if (r && r.fromRehearsalEvent === true) {
                const internal =
                    typeof normalizeRehearsalMarkLabel === 'function'
                        ? normalizeRehearsalMarkLabel(r.label)
                        : String(r.label == null ? '' : r.label).trim();
                if (internal && internal !== REHEARSAL_MARK_UNLABELED) return internal;
            }
        }
        if (typeof formatRegionRehearsalMarkLabel === 'function') {
            return formatRegionRehearsalMarkLabel(rehearsalSlot);
        }
        if (typeof rehearsalGroupLabelForIndex === 'function') {
            return rehearsalGroupLabelForIndex(rehearsalSlot);
        }
        return 'A';
    }

    /** 内部ラベル → UI 表示用文字（リハーサル名なしは空文字） */
    function rehearsalMarkDisplayLabel(internalLabel) {
        return internalLabel === REHEARSAL_MARK_UNLABELED ? '' : internalLabel;
    }

    /** キーボードリハーサル名 index（A=0）→ Rehearsal スロット index */
    function rehearsalSlotIndexForRehearsalMarkKeyIndex(markIndex) {
        return markIndex | 0;
    }

    /** リハーサルマーク表示文字列の先頭 1 文字（A–Z）。該当なしは null */
    function firstLetterOfRehearsalMarkLabel(label) {
        const s = String(label == null ? '' : label).trim();
        if (!s.length) return null;
        const ch = s.charAt(0).toUpperCase();
        return ch >= 'A' && ch <= 'Z' ? ch : null;
    }

    /** ジャンプ／UI と同じリハーサル名表示文字列 */
    function rehearsalMarkNavDisplayLabel(range, rangeIndex) {
        if (!range) return '';
        if (range.fromRehearsalEvent !== true) return '';
        const raw = range.label != null ? String(range.label).trim() : '';
        if (!raw) return '';
        const internal =
            typeof normalizeRehearsalMarkLabel === 'function'
                ? normalizeRehearsalMarkLabel(raw)
                : raw;
        if (!internal || internal === REHEARSAL_MARK_UNLABELED) return '';
        if (typeof rehearsalMarkDisplayLabel === 'function') {
            return rehearsalMarkDisplayLabel(internal) || '';
        }
        return internal;
    }

    function getRehearsalMarkJumpRanges() {
        if (typeof getRehearsalMarkNavRanges === 'function') {
            return getRehearsalMarkNavRanges();
        }
        return typeof getRehearsalGroupRangesForRegionRehearsalMarks === 'function'
            ? getRehearsalGroupRangesForRegionRehearsalMarks()
            : [];
    }

    function rehearsalMarkLabelLetterFromKey(e) {
        if (!e || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return null;
        const key = e.key;
        if (!key || key.length !== 1) return null;
        const code = key.toUpperCase().charCodeAt(0);
        if (code < 65 || code > 90) return null;
        return key.toUpperCase();
    }

    /** Shift+英文字 — 先頭文字が letter に一致する範囲 index を時系列順に列挙 */
    function collectRehearsalMarkRangeIndicesByLabelLetter(letter, ranges) {
        const list = ranges || getRehearsalMarkJumpRanges();
        if (!list.length || !letter) return [];
        const target = String(letter).toUpperCase();
        const out = [];
        for (let i = 0; i < list.length; i++) {
            const r = list[i];
            if (!r) continue;
            const display = rehearsalMarkNavDisplayLabel(r, i);
            if (firstLetterOfRehearsalMarkLabel(display) === target) out.push(i);
        }
        return out;
    }

    /**
     * transport が一致候補マークの範囲 [startSec, endSec) 内にある matches 配列上の index。該当なしは -1。
     */
    function rehearsalMarkMatchIndexAtTransportSec(ranges, matches, transportSec) {
        if (!ranges || !matches || !matches.length || !Number.isFinite(transportSec)) return -1;
        const eps = regionNavStopEpsilonSec();
        const t = Number(transportSec);
        for (let i = 0; i < matches.length; i++) {
            const r = ranges[matches[i]];
            if (!r || !Number.isFinite(r.startSec)) continue;
            const endSec = Number.isFinite(r.endSec) ? r.endSec : Infinity;
            if (t >= r.startSec - eps && t < endSec - eps) return i;
        }
        return -1;
    }

    function resolveSegmentIndexForRehearsalMarkRange(track, range, rangeIndex) {
        if (!range || !Number.isFinite(range.startSec)) return -1;
        const markSec = range.startSec;
        const eps = regionNavStopEpsilonSec();
        const maxMarkLeadGap = Math.max(eps, 0.25);

        if (typeof getTrackTimelineSlots === 'function') {
            const units = getTrackTimelineSlots(track, { writeCache: false });
            for (let ui = 0; ui < units.length; ui++) {
                const unit = units[ui];
                if (
                    !unit ||
                    unit.kind === 'silent' ||
                    !unit.segmentRefs ||
                    !unit.segmentRefs.length ||
                    !Number.isFinite(unit.timelineStartSec)
                ) {
                    continue;
                }
                if (Math.abs(unit.timelineStartSec - markSec) <= eps) {
                    return unit.segmentRefs[0].segmentIndex | 0;
                }
            }
            for (let ui = 0; ui < units.length; ui++) {
                const unit = units[ui];
                if (
                    !unit ||
                    unit.kind === 'silent' ||
                    !unit.segmentRefs ||
                    !unit.segmentRefs.length ||
                    !Number.isFinite(unit.timelineStartSec) ||
                    !Number.isFinite(unit.timelineEndSec)
                ) {
                    continue;
                }
                if (
                    markSec >= unit.timelineStartSec - eps &&
                    markSec < unit.timelineEndSec - eps
                ) {
                    return unit.segmentRefs[0].segmentIndex | 0;
                }
            }
            if (range.fromRehearsalEvent && range.label) {
                const want =
                    typeof normalizeRehearsalMarkLabel === 'function'
                        ? normalizeRehearsalMarkLabel(range.label)
                        : String(range.label).trim();
                if (want) {
                    let bestSeg = -1;
                    let bestDist = Infinity;
                    for (let ui = 0; ui < units.length; ui++) {
                        const unit = units[ui];
                        if (
                            !unit ||
                            unit.kind === 'silent' ||
                            !unit.segmentRefs ||
                            !unit.segmentRefs.length ||
                            !unit.musical ||
                            !Number.isFinite(unit.timelineStartSec) ||
                            !Number.isFinite(unit.timelineEndSec)
                        ) {
                            continue;
                        }
                        const lab =
                            typeof normalizeRehearsalMarkLabel === 'function'
                                ? normalizeRehearsalMarkLabel(unit.musical.rehearsalLabel)
                                : String(unit.musical.rehearsalLabel || '').trim();
                        if (!lab || lab !== want) continue;
                        if (
                            markSec >= unit.timelineStartSec - eps &&
                            markSec < unit.timelineEndSec - eps
                        ) {
                            return unit.segmentRefs[0].segmentIndex | 0;
                        }
                        const lead = unit.timelineStartSec - markSec;
                        if (lead >= -eps && lead <= maxMarkLeadGap) {
                            const dist = Math.abs(unit.timelineStartSec - markSec);
                            if (dist < bestDist) {
                                bestDist = dist;
                                bestSeg = unit.segmentRefs[0].segmentIndex | 0;
                            }
                        }
                    }
                    if (bestSeg >= 0) return bestSeg;
                }
            }
        }

        if (!range.fromRehearsalEvent) {
            const rehearsalSlot =
                range.paletteIndex != null && range.paletteIndex >= 0
                    ? range.paletteIndex | 0
                    : rangeIndex | 0;
            if (typeof resolveSegmentIndexForRehearsalSlot === 'function') {
                return resolveSegmentIndexForRehearsalSlot(track, rehearsalSlot);
            }
            return rehearsalSlot >= 0 ? rehearsalSlot : -1;
        }
        return -1;
    }

    function rehearsalMarkNavSeekSecForRange(track, range, rangeIndex) {
        if (!range || !Number.isFinite(range.startSec)) return NaN;
        const markSec = range.startSec;
        const eps = regionNavStopEpsilonSec();
        const segIdx = resolveSegmentIndexForRehearsalMarkRange(track, range, rangeIndex);
        if (
            segIdx >= 0 &&
            typeof getSegmentRegionTimelineIn === 'function'
        ) {
            const regionIn = getSegmentRegionTimelineIn(track, segIdx);
            if (Number.isFinite(regionIn) && regionIn >= markSec - eps) {
                return regionIn;
            }
        }
        if (typeof rehearsalNavStartSecForSlot === 'function' && !range.fromRehearsalEvent) {
            const rehearsalSlot =
                range.paletteIndex != null && range.paletteIndex >= 0
                    ? range.paletteIndex | 0
                    : rangeIndex | 0;
            const navSec = rehearsalNavStartSecForSlot(track, rehearsalSlot, markSec);
            if (Number.isFinite(navSec) && navSec >= markSec - eps) {
                return navSec;
            }
        }
        return markSec;
    }

    /**
     * Shift+英文字 のジャンプ先範囲 index。
     * 先頭文字が一致する候補を時系列順に列挙し、
     * 現在位置が候補マーク範囲内なら次の候補へ（末尾なら先頭へ循環）。
     * 範囲外なら時系列で最も早い候補へ。
     */
    function resolveRehearsalMarkJumpRangeIndex(labelLetter) {
        const ranges = getRehearsalMarkJumpRanges();
        const matches = collectRehearsalMarkRangeIndicesByLabelLetter(labelLetter, ranges);
        if (!matches.length) return -1;

        const t =
            typeof getTransportSec === 'function'
                ? getTransportSec()
                : typeof videoMain !== 'undefined' && videoMain
                  ? videoMain.currentTime || 0
                  : 0;

        const withinIdx = rehearsalMarkMatchIndexAtTransportSec(ranges, matches, t);
        if (withinIdx >= 0) {
            if (matches.length === 1) return matches[0];
            return matches[(withinIdx + 1) % matches.length];
        }

        return matches[0];
    }

    function resolveRegionRehearsalJumpTrack() {
        for (let i = 0; i < regionSelectionEntries.length; i++) {
            const entry = regionSelectionEntries[i];
            if (entry.segmentIndex >= 0) {
                return { type: 'extra', slot: entry.slot | 0 };
            }
        }
        const trackCount = getExtraTrackCount();
        for (let slot = 0; slot < trackCount; slot++) {
            const track = { type: 'extra', slot };
            if (isTrackRegionActive(track) && getSegmentCount(track) > 0) {
                return track;
            }
        }
        return null;
    }

    function jumpToRegionRehearsalMark(labelLetter, opt) {
        const track = resolveRegionRehearsalJumpTrack();
        if (!track || !isTrackRegionActive(track)) return false;
        const rangeIndex = resolveRehearsalMarkJumpRangeIndex(labelLetter);
        if (rangeIndex < 0) return false;
        const ranges = getRehearsalMarkJumpRanges();
        const r = ranges[rangeIndex];
        if (!r || !Number.isFinite(r.startSec)) return false;
        const markHint = rehearsalMarkNavDisplayLabel(r, rangeIndex);
        if (!markHint) return false;
        const markSec = r.startSec;
        const eps = regionNavStopEpsilonSec();
        const maxMarkLeadGap = Math.max(eps, 0.25);
        let seekSec = markSec;
        let segmentIndex = -1;
        if (r.fromRehearsalEvent) {
            segmentIndex = resolveSegmentIndexForRehearsalMarkRange(track, r, rangeIndex);
            if (
                segmentIndex >= 0 &&
                typeof getSegmentRegionTimelineIn === 'function'
            ) {
                const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
                if (
                    Number.isFinite(regionIn) &&
                    regionIn >= markSec - eps &&
                    regionIn <= markSec + maxMarkLeadGap
                ) {
                    seekSec = regionIn;
                }
            }
        } else {
            seekSec = rehearsalMarkNavSeekSecForRange(track, r, rangeIndex);
            segmentIndex = resolveSegmentIndexForRehearsalMarkRange(track, r, rangeIndex);
        }
        if (!Number.isFinite(seekSec)) return false;
        return seekToRegionNavStop(
            {
                sec: seekSec,
                edge: 'in',
                slot: track.slot,
                segmentIndex: segmentIndex,
            },
            {
                resumeAfterSeek: !!(opt && opt.resumeAfterSeek),
                hintTitle: markHint,
                discreteStopNav: true,
            },
        );
    }

    function handlePlaybackRegionRehearsalMarkJumpKeydown(e) {
        const labelLetter = rehearsalMarkLabelLetterFromKey(e);
        if (labelLetter == null) return false;
        if (e.repeat) return false;
        if (
            typeof transportControlsReady === 'function' &&
            !transportControlsReady()
        ) {
            return false;
        }
        if (!resolveRegionRehearsalJumpTrack()) return false;
        const wasPlaying =
            typeof isTransportPlaying === 'function'
                ? isTransportPlaying()
                : typeof videoMain !== 'undefined' && videoMain && !videoMain.paused;
        if (!jumpToRegionRehearsalMark(labelLetter, { resumeAfterSeek: wasPlaying })) {
            return false;
        }
        e.preventDefault();
        return true;
    }

    function resolveAdjacentRegionStopSec(dir, fromSec) {
        const stops = buildRegionNavStops();
        const n = stops.length;
        if (n === 0) return null;
        const t = Number.isFinite(fromSec)
            ? fromSec
            : typeof getCoalescedStopNavTransportSec === 'function'
              ? getCoalescedStopNavTransportSec()
              : typeof getTransportSec === 'function'
                ? getTransportSec()
                : typeof videoMain !== 'undefined' && videoMain
                  ? videoMain.currentTime || 0
                  : 0;
        const idx = regionNavStopIndexForCurrent(stops, dir, t);
        const eps = regionNavStopEpsilonSec();
        let next;
        if (idx < 0) {
            if (dir <= 0) return null;
            next = 0;
        } else if (dir < 0 && t > stops[idx].sec + eps) {
            next = idx;
        } else if (dir > 0 && t < stops[idx].sec - eps) {
            next = idx;
        } else {
            next = idx + dir;
            if (next < 0 || next >= n) return null;
        }
        const sec = stops[next].sec;
        return Number.isFinite(sec) ? sec : null;
    }

    function jumpToAdjacentRegionStop(dir, opt) {
        const targetSec = resolveAdjacentRegionStopSec(dir);
        if (targetSec == null) return false;
        const stops = buildRegionNavStops();
        const eps = regionNavStopEpsilonSec();
        const stop = stops.find((s) => Math.abs(s.sec - targetSec) <= eps);
        if (!stop) return false;
        return seekToRegionNavStop(stop, opt);
    }

    window.buildRegionNavStops = buildRegionNavStops;
    window.resolveAdjacentRegionStopSec = resolveAdjacentRegionStopSec;
    window.jumpToAdjacentRegionStop = jumpToAdjacentRegionStop;
    window.getTrackSegmentCount = function (slot) {
        return getSegmentCount({ type: 'extra', slot });
    };
    window.syncExtraLaneRegionsForSlot = function (slot) {
        syncExtraLaneRegionsClassForTrack({ type: 'extra', slot });
    };
    window.getActiveExtraSegmentsAtTransport = getActiveExtraSegmentsAtTransport;
    window.refreshSegmentHitAtTransport = refreshSegmentHitAtTransport;
    window.rehearsalSlotPlacementSec = rehearsalSlotPlacementSec;
    window.rehearsalSlotRegionInTargetSec = rehearsalSlotRegionInTargetSec;
    window.isSegmentBoundaryJoined = isSegmentBoundaryJoined;
    window.isSegmentBoundaryJoinableAtIndex = isSegmentBoundaryJoinableAtIndex;
    window.playbackRegionBoundaryJoinBlockReason = playbackRegionBoundaryJoinBlockReason;
    window.isAutoJoinedBoundaryCrossfadeEligible = isAutoJoinedBoundaryCrossfadeEligible;
    window.hasTimelineOverlapAtBoundary = hasTimelineOverlapAtBoundary;
    window.hasExtendedCrossfadeOverlapAtBoundary = hasExtendedCrossfadeOverlapAtBoundary;
    window.hasManualSegmentFadeAtJoinedBoundary = hasManualSegmentFadeAtJoinedBoundary;
    window.getManualJoinedBoundaryFadeZone = getManualJoinedBoundaryFadeZone;
    window.isTransportInManualJoinedBoundaryFadeZone =
        isTransportInManualJoinedBoundaryFadeZone;
    window.isSegmentSourceContinuousAtBoundary = isSegmentSourceContinuousAtBoundary;
    window.isSegmentSourceSplitAtBoundary = isSegmentSourceSplitAtBoundary;
    window.isSegmentMovableSplitBoundary = isSegmentMovableSplitBoundary;
    window.isRehearsalOffMovableSplitBoundaryEnabled =
        isRehearsalOffMovableSplitBoundaryEnabled;
    window.getContinuousJoinedSourceOutSec = getContinuousJoinedSourceOutSec;
    window.planIncomingSegmentStartAtJoinedBoundary =
        planIncomingSegmentStartAtJoinedBoundary;
    window.JOINED_BOUNDARY_CROSSFADE_SEC = JOINED_BOUNDARY_CROSSFADE_SEC;
    window.getSegmentGainDb = getSegmentGainDb;
    window.getSegmentGainLinear = getSegmentGainLinear;
    window.getSegmentFadeDurationSec = getSegmentFadeDurationSec;
    window.getSegmentPlaybackGainLinear = getSegmentPlaybackGainLinear;
    window.setSegmentGainDb = setSegmentGainDb;
    window.getSegmentRegionTimelineBounds = function (slot, segmentIndex) {
        const track = { type: 'extra', slot };
        if (!isTrackRegionActive(track)) return null;
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return null;
        const bounds = getSegmentRegionTimelineInterval(track, segmentIndex);
        return {
            startSec: bounds.start,
            endSec: bounds.end,
        };
    };
    window.handlePlaybackRegionGainWheel = handlePlaybackRegionGainWheel;
    window.handlePlaybackRegionPitchWheel = handlePlaybackRegionPitchWheel;
    window.ensureDefaultTrackRegion = ensureDefaultTrackRegion;
    window.updatePlaybackRegionHoverFromPointer = updatePlaybackRegionHoverFromPointer;
    window.addExtraTrackRegionForClip = function (slot, clipId, durationSec, timelineStartSec) {
        const track = { type: 'extra', slot };
        if (!regionUndoPaused) requestRegionUndoCapture();
        const state = getPlaybackRegionsState(track);
        const start = snapRegionTransportSec(timelineStartSec);
        const seg = {
            id: newRegionId(),
            clipId: clipId || 'main',
            sourceInSec: 0,
            sourceOutSec: durationSec,
            timelineStartSec: start,
        };
        const normalized = getTrackSegments(track).map((s) =>
            normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
        );
        normalized.push(normalizeSegmentEntry(seg, track, durationSec));
        state.active = true;
        applySegmentsToState(track, normalized, { silent: true, skipUndo: true });
    };
    window.getTrackSegments = getTrackSegments;
    window.getSegmentRegionTimelineIn = getSegmentRegionTimelineIn;
    window.getSegmentRegionTimelineOut = getSegmentRegionTimelineOut;
    window.getSegmentRegionGroupId = getSegmentRegionGroupId;
    window.resolveRegionSwapUnitSegmentIndices = resolveRegionSwapUnitSegmentIndices;
    window.repositionRegionSwapUnitToTimelineSec = repositionRegionSwapUnitToTimelineSec;
    window.syncTrackHeadPadFromFirstSegment = syncTrackHeadPadFromFirstSegment;
    window.syncTrackRegionHeadStateFromFirstSegment = syncTrackRegionHeadStateFromFirstSegment;
    window.reconcileSegmentSourceInWithRegionInTrim = reconcileSegmentSourceInWithRegionInTrim;
    window.segmentBoundaryJoinEpsilonSec = function segmentBoundaryJoinEpsilonSec() {
        return SEGMENT_BOUNDARY_JOIN_EPS_SEC;
    };
    window.getPlaybackRegionsState = getPlaybackRegionsState;
    window.requestRegionUndoCapture = requestRegionUndoCapture;
    window.attachRegionSwapAnimHintToUndoStackTop = attachRegionSwapAnimHintToUndoStackTop;
    window.attachHeadPadSwapPreMarksToUndoStackTop = attachHeadPadSwapPreMarksToUndoStackTop;
    window.previewTrackSegmentsFromUndoEntry = previewTrackSegmentsFromUndoEntry;
    window.captureTrackRegionOverlayIntervals = captureTrackRegionOverlayIntervals;
    window.redrawAfterRegionChange = redrawAfterRegionChange;
    window.REHEARSAL_MARK_UNLABELED = REHEARSAL_MARK_UNLABELED;
    window.rehearsalMarkLabelForRehearsalSlotIndex = rehearsalMarkLabelForRehearsalSlotIndex;
    window.rehearsalMarkDisplayLabel = rehearsalMarkDisplayLabel;
    window.rehearsalSlotIndexForRehearsalMarkKeyIndex = rehearsalSlotIndexForRehearsalMarkKeyIndex;

