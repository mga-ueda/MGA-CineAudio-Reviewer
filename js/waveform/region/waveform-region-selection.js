/**
 * waveform-region-selection.js — リージョン選択・グループ化
 */
    const REGION_GROUP_EDGE_TOP = 'audio-waveform-lane__playback-region--group-edge-top';
    const REGION_GROUP_EDGE_RIGHT = 'audio-waveform-lane__playback-region--group-edge-right';
    const REGION_GROUP_EDGE_BOTTOM = 'audio-waveform-lane__playback-region--group-edge-bottom';
    const REGION_GROUP_EDGE_LEFT = 'audio-waveform-lane__playback-region--group-edge-left';
    const REGION_GROUP_EDGE_CLASSES = [
        REGION_GROUP_EDGE_TOP,
        REGION_GROUP_EDGE_RIGHT,
        REGION_GROUP_EDGE_BOTTOM,
        REGION_GROUP_EDGE_LEFT,
    ];
    const REGION_GROUP_OUTER_EDGE_EPS_SEC = 0.002;

    function clearRegionGroupEdgeClasses(el) {
        if (!el) return;
        for (let i = 0; i < REGION_GROUP_EDGE_CLASSES.length; i++) {
            el.classList.remove(REGION_GROUP_EDGE_CLASSES[i]);
        }
    }

    function applyRegionGroupEdgeClasses(el, edges) {
        if (!el || !edges) return;
        el.classList.toggle(REGION_GROUP_EDGE_TOP, !!edges.top);
        el.classList.toggle(REGION_GROUP_EDGE_RIGHT, !!edges.right);
        el.classList.toggle(REGION_GROUP_EDGE_BOTTOM, !!edges.bottom);
        el.classList.toggle(REGION_GROUP_EDGE_LEFT, !!edges.left);
    }

    /** 同一グループ内で隣接しない内側の辺を除き、外周 □ のみ色付けする */
    function computeRegionGroupOuterEdges(members) {
        const result = new Map();
        if (!members || !members.length) return result;
        const bySlot = new Map();
        for (let i = 0; i < members.length; i++) {
            const m = members[i];
            if (!bySlot.has(m.slot)) bySlot.set(m.slot, []);
            bySlot.get(m.slot).push(m);
        }
        bySlot.forEach((slotMembers, slot) => {
            const track = { type: 'extra', slot };
            const intervals = [];
            for (let i = 0; i < slotMembers.length; i++) {
                const m = slotMembers[i];
                const bounds = getSegmentRegionOverlayTimelineInterval(track, m.segmentIndex);
                intervals.push({
                    slot: m.slot,
                    segmentIndex: m.segmentIndex,
                    start: bounds.start,
                    end: bounds.end,
                });
            }
            for (let i = 0; i < intervals.length; i++) {
                const item = intervals[i];
                let leftOuter = true;
                let rightOuter = true;
                for (let j = 0; j < intervals.length; j++) {
                    if (j === i) continue;
                    const other = intervals[j];
                    if (
                        Math.abs(other.end - item.start) <= REGION_GROUP_OUTER_EDGE_EPS_SEC
                    ) {
                        leftOuter = false;
                    }
                    if (
                        Math.abs(other.start - item.end) <= REGION_GROUP_OUTER_EDGE_EPS_SEC
                    ) {
                        rightOuter = false;
                    }
                }
                result.set(regionGroupMemberKey(item.slot, item.segmentIndex), {
                    top: true,
                    bottom: true,
                    left: leftOuter,
                    right: rightOuter,
                });
            }
        });
        return result;
    }

    function getPlaybackRegionOverlayEl(slot, segmentIndex) {
        const lane = document.getElementById('extraAudioLane' + slot);
        if (!lane) return null;
        const container = lane.querySelector('.audio-waveform-lane__playback-regions');
        if (!container) return null;
        return container.querySelector(
            '.audio-waveform-lane__playback-region[data-segment-index="' +
                segmentIndex +
                '"]',
        );
    }

    /** グループ平行移動: 各メンバーが移動下限（lead pad 時は再生開始≧0）を下回らないよう delta をクランプ */
    function clampRegionGroupMoveDelta(members, deltaRaw, startRegionInByKey, opt) {
        if (!Number.isFinite(deltaRaw)) return 0;
        if (!members || !members.length) return deltaRaw;
        const useCurrent = !!(opt && opt.useCurrentRegionInBase);
        let limitDelta = Infinity;
        for (let i = 0; i < members.length; i++) {
            const m = members[i];
            const track = { type: 'extra', slot: m.slot };
            const key = regionGroupMemberKey(m.slot, m.segmentIndex);
            const rin = useCurrent
                ? getSegmentRegionTimelineIn(track, m.segmentIndex)
                : startRegionInByKey && Number.isFinite(startRegionInByKey[key])
                  ? startRegionInByKey[key]
                  : getSegmentRegionTimelineIn(track, m.segmentIndex);
            if (!Number.isFinite(rin)) continue;
            const floor =
                typeof getSegmentRegionMoveMinTransportSec === 'function'
                    ? getSegmentRegionMoveMinTransportSec(track, m.segmentIndex)
                    : 0;
            limitDelta = Math.min(limitDelta, floor - rin);
        }
        if (!Number.isFinite(limitDelta) || limitDelta === Infinity) return deltaRaw;
        return Math.max(deltaRaw, limitDelta);
    }

    function isRegionEntrySelected(slot, segmentIndex) {
        if (!(segmentIndex >= 0)) return false;
        const canonicalSlot =
            typeof isVideoLinkedOffsetDragSlot === 'function' &&
            isVideoLinkedOffsetDragSlot(slot)
                ? VIDEO_WAVEFORM_OFFSET_DRAG_SLOT
                : slot;
        for (let i = 0; i < regionSelectionEntries.length; i++) {
            const e = regionSelectionEntries[i];
            const entrySlot =
                typeof isVideoLinkedOffsetDragSlot === 'function' &&
                isVideoLinkedOffsetDragSlot(e.slot)
                    ? VIDEO_WAVEFORM_OFFSET_DRAG_SLOT
                    : e.slot;
            if (entrySlot === canonicalSlot && e.segmentIndex === segmentIndex) return true;
        }
        return false;
    }

    function isSilentGapEntrySelected(slot, gapIndex) {
        if (!(gapIndex >= 0)) return false;
        for (let i = 0; i < regionSelectionEntries.length; i++) {
            const e = regionSelectionEntries[i];
            if (e.slot === slot && e.segmentIndex < 0 && e.silentGapIndex === gapIndex) {
                return true;
            }
        }
        return false;
    }

    function hasSilentGapRegionSelection() {
        for (let i = 0; i < regionSelectionEntries.length; i++) {
            const e = regionSelectionEntries[i];
            if (e.segmentIndex < 0 && e.silentGapIndex >= 0) return true;
        }
        return false;
    }

    function syncRegionSelectionClasses() {
        pruneInvalidSilentGapSelectionEntries();
        document
            .querySelectorAll('.audio-waveform-lane__playback-silent-gap')
            .forEach((el) => {
                const lane = el.closest('.audio-waveform-lane--extra');
                const m = lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
                if (!m) return;
                const slot = parseInt(m[1], 10);
                const gapIndex = Number(el.dataset.silentGapIndex);
                if (!Number.isFinite(gapIndex)) return;
                el.classList.toggle(
                    'audio-waveform-lane__playback-silent-gap--selected',
                    isSilentGapEntrySelected(slot, gapIndex),
                );
            });

        document
            .querySelectorAll('.audio-waveform-lane__playback-region')
            .forEach((el) => {
                const videoLane = el.closest('.audio-waveform-lane--video-viz');
                const videoAudioLane = el.closest('.audio-waveform-lane--video');
                const lane = el.closest('.audio-waveform-lane--extra');
                let slot = -1;
                if (videoLane) {
                    slot =
                        typeof VIDEO_WAVEFORM_OFFSET_DRAG_SLOT !== 'undefined'
                            ? VIDEO_WAVEFORM_OFFSET_DRAG_SLOT
                            : -2;
                } else if (
                    videoAudioLane &&
                    el.classList.contains('audio-waveform-lane__playback-region--video-audio-mirror')
                ) {
                    slot =
                        typeof VIDEO_WAVEFORM_OFFSET_DRAG_SLOT !== 'undefined'
                            ? VIDEO_WAVEFORM_OFFSET_DRAG_SLOT
                            : -2;
                } else {
                    const m = lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
                    if (!m) return;
                    slot = parseInt(m[1], 10);
                }
                const segmentIndex = Number(el.dataset.segmentIndex);
                if (!Number.isFinite(segmentIndex)) return;
                const selected = isRegionEntrySelected(slot, segmentIndex);
                el.classList.toggle(
                    'audio-waveform-lane__playback-region--selected',
                    selected,
                );
                if (!selected) {
                    if (
                        !el.classList.contains(
                            'audio-waveform-lane__playback-region--group-flash',
                        ) &&
                        !el.classList.contains(
                            'audio-waveform-lane__playback-region--group-ungroup-flash',
                        )
                    ) {
                        clearRegionGroupEdgeClasses(el);
                    }
                }
            });

        const selectedByGroup = new Map();
        for (let i = 0; i < regionSelectionEntries.length; i++) {
            const e = regionSelectionEntries[i];
            const track = { type: 'extra', slot: e.slot };
            const gid = getSegmentRegionGroupId(track, e.segmentIndex);
            if (!gid) continue;
            if (!selectedByGroup.has(gid)) selectedByGroup.set(gid, []);
            selectedByGroup.get(gid).push(e);
        }
        selectedByGroup.forEach((members) => {
            const edgeMap = computeRegionGroupOuterEdges(members);
            for (let i = 0; i < members.length; i++) {
                const m = members[i];
                const el = getPlaybackRegionOverlayEl(m.slot, m.segmentIndex);
                if (!el) continue;
                applyRegionGroupEdgeClasses(
                    el,
                    edgeMap.get(regionGroupMemberKey(m.slot, m.segmentIndex)),
                );
            }
        });

        if (
            typeof updatePlaybackRegionHoverFromPointer === 'function' &&
            Number.isFinite(lastRegionHoverClientX) &&
            Number.isFinite(lastRegionHoverClientY)
        ) {
            updatePlaybackRegionHoverFromPointer(
                lastRegionHoverClientX,
                lastRegionHoverClientY,
                false,
            );
        }
    }

    function clearRegionSelection() {
        if (!regionSelectionEntries.length) return;
        regionSelectionEntries.length = 0;
        syncRegionSelectionClasses();
    }

    function removeRegionSelectionEntry(slot, segmentIndex) {
        const idx = regionSelectionEntries.findIndex(
            (e) => e.slot === slot && e.segmentIndex === segmentIndex,
        );
        if (idx >= 0) regionSelectionEntries.splice(idx, 1);
    }

    function addRegionSelectionEntry(slot, segmentIndex) {
        if (!(segmentIndex >= 0)) return;
        if (
            typeof isVideoLinkedOffsetDragSlot === 'function' &&
            isVideoLinkedOffsetDragSlot(slot)
        ) {
            slot = VIDEO_WAVEFORM_OFFSET_DRAG_SLOT;
        } else if (!(slot >= 0)) {
            return;
        }
        if (isRegionEntrySelected(slot, segmentIndex)) return;
        regionSelectionEntries.push({ slot, segmentIndex });
    }

    function toggleSilentGapSelection(slot, gapIndex) {
        if (!(slot >= 0) || !(gapIndex >= 0)) return false;
        const track = { type: 'extra', slot };
        const gaps = collectTrackSilentGaps(track);
        if (gapIndex >= gaps.length) {
            logSilentGapSelectionDiag('rejected', {
                ex: slot + 1,
                gapIndex,
                gapCount: gaps.length,
                reason: 'gap-index-out-of-range',
            });
            return false;
        }
        const idx = regionSelectionEntries.findIndex(
            (e) =>
                e.slot === slot &&
                e.segmentIndex < 0 &&
                e.silentGapIndex === gapIndex,
        );
        const selected = idx >= 0;
        if (selected) regionSelectionEntries.splice(idx, 1);
        else {
            regionSelectionEntries.push({ slot, segmentIndex: -1, silentGapIndex: gapIndex });
        }
        syncRegionSelectionClasses();
        const gap = gaps[gapIndex];
        logSilentGapSelectionDiag(selected ? 'deselected' : 'selected', {
            ex: slot + 1,
            gapIndex,
            rehearsalSlot:
                gap && Number.isFinite(gap.rehearsalIndex) ? (gap.rehearsalIndex | 0) + 1 : null,
            partial: !!(gap && gap.partial),
            start: gap ? regionSwapDiagFmtSec(gap.startSec) : null,
            end: gap ? regionSwapDiagFmtSec(gap.endSec) : null,
        });
        return true;
    }

    function toggleRegionSelection(slot, segmentIndex) {
        if (!(segmentIndex >= 0)) return;
        if (
            typeof isVideoLinkedOffsetDragSlot === 'function' &&
            isVideoLinkedOffsetDragSlot(slot)
        ) {
            if (isRegionEntrySelected(VIDEO_WAVEFORM_OFFSET_DRAG_SLOT, segmentIndex)) {
                removeRegionSelectionEntry(VIDEO_WAVEFORM_OFFSET_DRAG_SLOT, segmentIndex);
            } else {
                addRegionSelectionEntry(VIDEO_WAVEFORM_OFFSET_DRAG_SLOT, segmentIndex);
            }
            syncRegionSelectionClasses();
            return;
        }
        if (!(slot >= 0)) return;
        const track = { type: 'extra', slot };
        const gid = getSegmentRegionGroupId(track, segmentIndex);
        if (gid) {
            const members = collectRegionGroupMembers(track, segmentIndex);
            const allSelected =
                members.length > 0 &&
                members.every((m) => isRegionEntrySelected(m.slot, m.segmentIndex));
            if (allSelected) {
                for (let i = 0; i < members.length; i++) {
                    removeRegionSelectionEntry(
                        members[i].slot,
                        members[i].segmentIndex,
                    );
                }
            } else {
                for (let i = 0; i < members.length; i++) {
                    addRegionSelectionEntry(
                        members[i].slot,
                        members[i].segmentIndex,
                    );
                }
            }
        } else {
            const idx = regionSelectionEntries.findIndex(
                (e) => e.slot === slot && e.segmentIndex === segmentIndex,
            );
            if (idx >= 0) regionSelectionEntries.splice(idx, 1);
            else regionSelectionEntries.push({ slot, segmentIndex });
        }
        syncRegionSelectionClasses();
    }

    function getRegionSelectionCount() {
        return regionSelectionEntries.length;
    }

    /** 対象 Audio Track（アクティブ/ポインタ下）の全リージョンを選択 */
    function selectAllRegionsOnTargetTrack() {
        if (typeof resolveTargetExtraSlot !== 'function') return false;
        const slot = resolveTargetExtraSlot();
        if (slot < 0) {
            if (typeof writeLog === 'function') {
                writeLog('Playback region: no target Audio Track for select all');
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'No target track', 'notice');
            }
            return false;
        }
        const track = { type: 'extra', slot };
        if (!isTrackRegionActive(track)) {
            if (typeof writeLog === 'function') {
                writeLog('Playback region: target Audio Track has no regions');
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'No regions', 'notice');
            }
            return false;
        }
        const count = getSegmentCount(track);
        if (count < 1) {
            if (typeof writeLog === 'function') {
                writeLog('Playback region: target Audio Track has no regions');
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'No regions', 'notice');
            }
            return false;
        }
        regionSelectionEntries.length = 0;
        for (let i = 0; i < count; i++) {
            regionSelectionEntries.push({ slot, segmentIndex: i });
        }
        syncRegionSelectionClasses();
        if (typeof writeLog === 'function') {
            writeLog(
                'Playback region: selected all ' +
                    count +
                    ' region(s) on Ex' +
                    (slot + 1),
            );
        }
        return true;
    }

    /** 選択中セグメント + regionGroupId グループメンバーを重複排除して列挙 */
    function expandRegionSegmentEditTargetsFromSelection() {
        const segEntries = regionSelectionEntries.filter((e) => e.segmentIndex >= 0);
        if (!segEntries.length) return [];
        const seen = new Set();
        const out = [];
        for (let i = 0; i < segEntries.length; i++) {
            const e = segEntries[i];
            const track = { type: 'extra', slot: e.slot };
            const members = collectRegionGroupMembers(track, e.segmentIndex);
            for (let j = 0; j < members.length; j++) {
                const m = members[j];
                const key = regionGroupMemberKey(m.slot, m.segmentIndex);
                if (seen.has(key)) continue;
                seen.add(key);
                const mTrack = { type: 'extra', slot: m.slot };
                if (!isTrackRegionActive(mTrack)) continue;
                out.push({ slot: m.slot, segmentIndex: m.segmentIndex });
            }
        }
        return out;
    }

    function selectionHasGroupedRegions() {
        for (let i = 0; i < regionSelectionEntries.length; i++) {
            const e = regionSelectionEntries[i];
            if (getSegmentRegionGroupId({ type: 'extra', slot: e.slot }, e.segmentIndex)) {
                return true;
            }
        }
        return false;
    }

    function toggleRegionGroupFromSelection() {
        if (!regionSelectionEntries.length) {
            return false;
        }
        if (selectionHasGroupedRegions()) {
            return ungroupSelectedPlaybackRegions();
        }
        return groupSelectedPlaybackRegions();
    }

    function groupSelectedPlaybackRegions() {
        if (regionSelectionEntries.length < 2) {
            return false;
        }
        if (!regionUndoPaused) requestRegionUndoCapture();
        const gid = newRegionGroupId();
        const touchedSlots = new Set();
        const unique = new Map();
        for (let i = 0; i < regionSelectionEntries.length; i++) {
            const e = regionSelectionEntries[i];
            unique.set(regionGroupMemberKey(e.slot, e.segmentIndex), e);
        }
        for (const e of unique.values()) {
            const track = { type: 'extra', slot: e.slot };
            const raw = getRawSegmentEntry(track, e.segmentIndex);
            if (raw) raw.regionGroupId = gid;
            touchedSlots.add(e.slot);
        }
        const groupedMembers = Array.from(unique.values());
        for (const slot of touchedSlots) {
            if (typeof refreshTrackTimelineMusicalSlots === 'function') {
                refreshTrackTimelineMusicalSlots(
                    { type: 'extra', slot },
                    { preserveStored: false },
                );
            }
            if (typeof updateTrackRegionOverlays === 'function') {
                updateTrackRegionOverlays({ type: 'extra', slot });
            }
        }
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        clearRegionSelection();
        if (typeof flashRegionGroupMembers === 'function') {
            flashRegionGroupMembers(groupedMembers);
        }
        writeLog(
            'Regions grouped across ' +
                unique.size +
                ' region(s) on ' +
                touchedSlots.size +
                ' track(s)',
        );
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Region', 'Grouped', 'notice');
        }
        return true;
    }

    function ungroupSelectedPlaybackRegions() {
        if (!regionSelectionEntries.length) {
            writeLog('Playback region: select grouped region(s), then G');
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'Select region(s)', 'notice');
            }
            return false;
        }
        const gids = new Set();
        const ungroupFlashMembers = new Map();
        const seenUngroupFlashGids = new Set();
        for (let i = 0; i < regionSelectionEntries.length; i++) {
            const e = regionSelectionEntries[i];
            const track = { type: 'extra', slot: e.slot };
            const gid = getSegmentRegionGroupId(track, e.segmentIndex);
            if (gid) {
                gids.add(gid);
                if (!seenUngroupFlashGids.has(gid)) {
                    seenUngroupFlashGids.add(gid);
                    const members = collectRegionGroupMembers(track, e.segmentIndex);
                    for (let j = 0; j < members.length; j++) {
                        const m = members[j];
                        ungroupFlashMembers.set(
                            regionGroupMemberKey(m.slot, m.segmentIndex),
                            m,
                        );
                    }
                }
            }
        }
        let ungrouped = false;
        if (!regionUndoPaused) requestRegionUndoCapture();
        const n = getExtraTrackCount();
        for (let s = 0; s < n; s++) {
            const track = { type: 'extra', slot: s };
            const count = getSegmentCount(track);
            let cleared = 0;
            for (let i = 0; i < count; i++) {
                const raw = getRawSegmentEntry(track, i);
                if (raw && raw.regionGroupId && gids.has(raw.regionGroupId)) {
                    delete raw.regionGroupId;
                    cleared++;
                }
            }
            if (cleared) {
                ungrouped = true;
                if (typeof refreshTrackTimelineMusicalSlots === 'function') {
                    refreshTrackTimelineMusicalSlots(track, { preserveStored: false });
                }
                if (typeof updateTrackRegionOverlays === 'function') {
                    updateTrackRegionOverlays(track);
                }
            }
        }
        if (ungrouped) {
            writeLog('Region group cleared (' + gids.size + ' group(s))');
        }
        if (!ungrouped) {
            writeLog('Playback region: selection is not in a group');
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Region', 'Not grouped', 'notice');
            }
            return false;
        }
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        clearRegionSelection();
        if (typeof flashRegionGroupMembers === 'function') {
            flashRegionGroupMembers(Array.from(ungroupFlashMembers.values()), {
                kind: 'ungroup',
            });
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Region', 'Ungrouped', 'notice');
        }
        return true;
    }

    function resolveActiveExtraSlotForRegionEnter() {
        if (typeof getActiveMixExtraSlotFromDom === 'function') {
            const domSlot = getActiveMixExtraSlotFromDom();
            if (
                domSlot >= 0 &&
                typeof isExtraSlotUsableForRegion === 'function' &&
                isExtraSlotUsableForRegion(domSlot)
            ) {
                return domSlot;
            }
        }
        if (typeof getWaveformTargetExtraSlot === 'function') {
            const slot = getWaveformTargetExtraSlot();
            if (
                slot >= 0 &&
                typeof isExtraSlotUsableForRegion === 'function' &&
                isExtraSlotUsableForRegion(slot)
            ) {
                return slot;
            }
        }
        return -1;
    }

    function regionSelectTransportEpsilonSec() {
        if (typeof transportBoundaryEpsilonSec === 'function') {
            return transportBoundaryEpsilonSec();
        }
        return 1e-4;
    }

    /** リージョン長に対する選択重なりの最小比率（境界付近の誤ヒット除外） */
    function regionEnterSelectMinOverlapRatio() {
        return 0.1;
    }

    /** 選択区間がリージョン内に占める割合（0〜1）。点選択時は境界からの内側深さで算出 */
    function regionSelectedFraction(track, segmentIndex, inSec, outSec) {
        const interval = getSegmentRegionInteractiveTimelineInterval(track, segmentIndex);
        const start = interval.startSec;
        const end = interval.endSec;
        if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
        const dur = end - start;
        const eps = regionSelectTransportEpsilonSec();
        if (!(dur > eps)) return 0;

        const inT = Number(inSec);
        const outT = Number(outSec);
        if (!Number.isFinite(inT) || !Number.isFinite(outT)) return 0;

        if (Math.abs(outT - inT) <= eps) {
            const t = inT;
            if (t < start - eps || t >= end - eps) return 0;
            return (2 * Math.min(t - start, end - t)) / dur;
        }

        const overlap = Math.max(0, Math.min(end, outT) - Math.max(start, inT));
        return overlap / dur;
    }

    function isRegionMeaningfullySelectedByRange(track, segmentIndex, inSec, outSec) {
        return (
            regionSelectedFraction(track, segmentIndex, inSec, outSec) >=
            regionEnterSelectMinOverlapRatio()
        );
    }

    /** 隣接リージョン間のスプリット境界上か（トラック端の In/Out は除く） */
    function isTransportAtSplitBoundary(track, transportSec) {
        const segments = getTrackSegments(track);
        if (segments.length < 2) return false;
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return false;
        const eps = regionSelectTransportEpsilonSec();
        for (let b = 0; b < segments.length - 1; b++) {
            const leftEnd = getSegmentTimelineEnd(track, b);
            const rightStart = getSegmentTimelineStart(track, b + 1);
            if (Math.abs(t - leftEnd) <= eps) return true;
            if (Math.abs(t - rightStart) <= eps) return true;
            const mid = (leftEnd + rightStart) * 0.5;
            if (Math.abs(t - mid) <= eps) return true;
        }
        return false;
    }

    function regionIntervalOverlapsTransportRange(track, segmentIndex, inSec, outSec) {
        const interval = getSegmentRegionInteractiveTimelineInterval(track, segmentIndex);
        const start = interval.startSec;
        const end = interval.endSec;
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
        const eps = regionSelectTransportEpsilonSec();
        return start < outSec - eps && end > inSec + eps;
    }

    function collectRegionIndicesOverlappingTransportRange(track, inSec, outSec) {
        const count = getSegmentCount(track);
        const eps = regionSelectTransportEpsilonSec();
        const isPoint = Math.abs(Number(outSec) - Number(inSec)) <= eps;
        const indices = [];
        let bestIndex = -1;
        let bestFraction = 0;
        for (let i = 0; i < count; i++) {
            if (!isRegionMeaningfullySelectedByRange(track, i, inSec, outSec)) continue;
            if (isPoint) {
                const frac = regionSelectedFraction(track, i, inSec, outSec);
                if (frac > bestFraction) {
                    bestFraction = frac;
                    bestIndex = i;
                }
                continue;
            }
            if (regionIntervalOverlapsTransportRange(track, i, inSec, outSec)) {
                indices.push(i);
            }
        }
        if (isPoint) {
            return bestIndex >= 0 ? [bestIndex] : [];
        }
        return indices;
    }

    function setRegionSelectionOnTrack(slot, segmentIndices) {
        if (!(slot >= 0) || !segmentIndices || !segmentIndices.length) return false;
        regionSelectionEntries.length = 0;
        for (let i = 0; i < segmentIndices.length; i++) {
            const segmentIndex = segmentIndices[i];
            if (!(segmentIndex >= 0)) continue;
            regionSelectionEntries.push({ slot, segmentIndex });
        }
        if (!regionSelectionEntries.length) return false;
        syncRegionSelectionClasses();
        return true;
    }

    function addRegionSelectionEntriesForIndex(slot, segmentIndex) {
        if (!(slot >= 0) || !(segmentIndex >= 0)) return;
        const track = { type: 'extra', slot };
        const gid = getSegmentRegionGroupId(track, segmentIndex);
        if (gid) {
            const members = collectRegionGroupMembers(track, segmentIndex);
            for (let i = 0; i < members.length; i++) {
                addRegionSelectionEntry(members[i].slot, members[i].segmentIndex);
            }
            return;
        }
        addRegionSelectionEntry(slot, segmentIndex);
    }

    function addRegionSelectionOnTrack(slot, segmentIndices) {
        if (!(slot >= 0) || !segmentIndices || !segmentIndices.length) return false;
        for (let i = 0; i < segmentIndices.length; i++) {
            addRegionSelectionEntriesForIndex(slot, segmentIndices[i]);
        }
        syncRegionSelectionClasses();
        return true;
    }

    function resolveRegionSegmentIndexAtSeekbar(track) {
        const seekSec =
            typeof transportSecFromSeekbar === 'function'
                ? transportSecFromSeekbar()
                : typeof getTransportSec === 'function'
                  ? getTransportSec()
                  : 0;
        const hits = collectRegionIndicesOverlappingTransportRange(track, seekSec, seekSec);
        return hits.length ? hits[0] : -1;
    }

    /** Enter — アクティブ Audio Track でシークバー直下、または範囲ループ区間のリージョンを追加選択 */
    function selectPlaybackRegionsAtActiveTrackEnter(opt) {
        opt = opt || {};
        const slot = resolveActiveExtraSlotForRegionEnter();
        if (slot < 0) return false;
        const track = { type: 'extra', slot };
        if (!isTrackRegionActive(track)) return false;

        const applySelection = opt.additive
            ? addRegionSelectionOnTrack
            : setRegionSelectionOnTrack;

        const rangeActive =
            typeof isRangeLoopPlaybackActive === 'function' &&
            isRangeLoopPlaybackActive();
        if (rangeActive) {
            const inSec =
                typeof getRangeLoopInSec === 'function' ? getRangeLoopInSec() : NaN;
            const outSec =
                typeof getRangeLoopOutSec === 'function' ? getRangeLoopOutSec() : NaN;
            if (!Number.isFinite(inSec) || !Number.isFinite(outSec) || outSec <= inSec) {
                return false;
            }

            const inAtBoundary = isTransportAtSplitBoundary(track, inSec);
            const outAtBoundary = isTransportAtSplitBoundary(track, outSec);
            const eps = regionSelectTransportEpsilonSec();

            if (inAtBoundary && outAtBoundary) {
                if (Math.abs(inSec - outSec) <= eps) {
                    return false;
                }
                const between = collectRegionIndicesOverlappingTransportRange(
                    track,
                    inSec,
                    outSec,
                );
                return applySelection(slot, between);
            }

            const overlapping = collectRegionIndicesOverlappingTransportRange(
                track,
                inSec,
                outSec,
            );
            return applySelection(slot, overlapping);
        }

        const segmentIndex = resolveRegionSegmentIndexAtSeekbar(track);
        if (segmentIndex < 0) return false;
        return applySelection(slot, [segmentIndex]);
    }


