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

    /** グループ平行移動: いずれかが TC0 手前に出ないよう delta を共有クランプ */
    function clampRegionGroupMoveDelta(members, deltaRaw, startRegionInByKey) {
        if (!Number.isFinite(deltaRaw)) return 0;
        if (!members || !members.length) return deltaRaw;
        let minStart = Infinity;
        for (let i = 0; i < members.length; i++) {
            const m = members[i];
            const key = regionGroupMemberKey(m.slot, m.segmentIndex);
            const rin =
                startRegionInByKey && Number.isFinite(startRegionInByKey[key])
                    ? startRegionInByKey[key]
                    : getSegmentRegionTimelineIn(
                          { type: 'extra', slot: m.slot },
                          m.segmentIndex,
                      );
            if (Number.isFinite(rin)) minStart = Math.min(minStart, rin);
        }
        if (!Number.isFinite(minStart) || minStart === Infinity) return deltaRaw;
        return Math.max(deltaRaw, -minStart);
    }

    function isRegionEntrySelected(slot, segmentIndex) {
        if (!(segmentIndex >= 0)) return false;
        for (let i = 0; i < regionSelectionEntries.length; i++) {
            const e = regionSelectionEntries[i];
            if (e.slot === slot && e.segmentIndex === segmentIndex) return true;
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
                const lane = el.closest('.audio-waveform-lane--extra');
                const m = lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
                if (!m) return;
                const slot = parseInt(m[1], 10);
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

    function removeSilentGapSelectionEntry(slot, gapIndex) {
        const idx = regionSelectionEntries.findIndex(
            (e) =>
                e.slot === slot &&
                e.segmentIndex < 0 &&
                e.silentGapIndex === gapIndex,
        );
        if (idx >= 0) regionSelectionEntries.splice(idx, 1);
    }

    function addRegionSelectionEntry(slot, segmentIndex) {
        if (!(slot >= 0) || !(segmentIndex >= 0)) return;
        if (isRegionEntrySelected(slot, segmentIndex)) return;
        regionSelectionEntries.push({ slot, segmentIndex });
    }

    function addSilentGapSelectionEntry(slot, gapIndex) {
        if (!(slot >= 0) || !(gapIndex >= 0)) return;
        if (isSilentGapEntrySelected(slot, gapIndex)) return;
        regionSelectionEntries.push({ slot, segmentIndex: -1, silentGapIndex: gapIndex });
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
            phraseSlot:
                gap && Number.isFinite(gap.phraseIndex) ? (gap.phraseIndex | 0) + 1 : null,
            partial: !!(gap && gap.partial),
            start: gap ? regionSwapDiagFmtSec(gap.startSec) : null,
            end: gap ? regionSwapDiagFmtSec(gap.endSec) : null,
        });
        return true;
    }

    function toggleRegionSelection(slot, segmentIndex) {
        if (!(slot >= 0) || !(segmentIndex >= 0)) return;
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


