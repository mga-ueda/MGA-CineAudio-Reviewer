/**
 * waveform-region-core.js — コア（Undo・セグメント・スナップ・ゲイン）
 */
    const PLAYBACK_REGION_MIN_SEC = 0.05;
    const MIN_CROSSFADE_OVERLAP_SEC =
        typeof window.MIN_CROSSFADE_OVERLAP_SEC === 'number'
            ? window.MIN_CROSSFADE_OVERLAP_SEC
            : 0.005;
    const SEGMENT_BOUNDARY_JOIN_EPS_SEC = 0.002;
    /** 結合境界のクロスフェード幅（分割点の手前のみ、境界以降は伸ばさない） */
    const JOINED_BOUNDARY_CROSSFADE_SEC = 1;
    const REGION_GAIN_DB_MIN = -96;
    const REGION_GAIN_DB_MAX = 10;

    const regionUndoStack = [];
    const regionRedoStack = [];
    let regionUndoPaused = false;
    let regionUndoDragSnap = null;
    let lastRegionSplitShortcutAtMs = -Infinity;
    const REGION_SPLIT_SHORTCUT_DEDUP_MS = 120;

    let pendingPlaybackRegionRestore = null;
    /** @type {{ slot: number, segment: object } | null} */
    let regionSegmentClipboard = null;
    const regionPersistEpochBySlot = {};
    const regionShrinkPersistIntentUntilBySlot = {};
    const REGION_SHRINK_PERSIST_INTENT_MS = 6000;

    function noteRegionShrinkPersistIntent(slot) {
        if (!(slot >= 0)) return;
        regionShrinkPersistIntentUntilBySlot[slot] =
            performance.now() + REGION_SHRINK_PERSIST_INTENT_MS;
    }

    function canPersistRegionShrink(slot) {
        if (!(slot >= 0)) return false;
        const until = Number(regionShrinkPersistIntentUntilBySlot[slot] || 0);
        return until > 0 && performance.now() <= until;
    }

    function bumpRegionPersistEpoch(slot) {
        if (!(slot >= 0)) return;
        regionPersistEpochBySlot[slot] = (regionPersistEpochBySlot[slot] || 0) + 1;
    }

    window.bumpRegionPersistEpoch = bumpRegionPersistEpoch;

    function getRegionPersistEpoch(slot) {
        if (!(slot >= 0)) return 0;
        return Number(regionPersistEpochBySlot[slot] || 0);
    }

    function swapRegionPersistEpochBetweenSlots(aSlot, bSlot) {
        if (!(aSlot >= 0) || !(bSlot >= 0) || aSlot === bSlot) return;
        const tmp = regionPersistEpochBySlot[aSlot] || 0;
        regionPersistEpochBySlot[aSlot] = regionPersistEpochBySlot[bSlot] || 0;
        regionPersistEpochBySlot[bSlot] = tmp;
        const tmpShrink = regionShrinkPersistIntentUntilBySlot[aSlot] || 0;
        regionShrinkPersistIntentUntilBySlot[aSlot] =
            regionShrinkPersistIntentUntilBySlot[bSlot] || 0;
        regionShrinkPersistIntentUntilBySlot[bSlot] = tmpShrink;
    }

    window.canPersistRegionShrink = canPersistRegionShrink;
    window.getRegionPersistEpoch = getRegionPersistEpoch;
    window.swapRegionPersistEpochBetweenSlots = swapRegionPersistEpochBetweenSlots;

    function emptyPlaybackRegionsState() {
        return { active: false, segments: [], headPadSec: 0 };
    }

    function regionUndoSnapshotIncludePhrase(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!o.includePhrase) return false;
        return (
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible() &&
            typeof capturePhraseUndoSnapshot === 'function'
        );
    }

    function normalizeRegionUndoSnapshot(snap) {
        if (Array.isArray(snap)) {
            return { tracks: snap, phrase: null };
        }
        if (snap && Array.isArray(snap.tracks)) {
            return { tracks: snap.tracks, phrase: snap.phrase != null ? snap.phrase : null };
        }
        return { tracks: [], phrase: null };
    }

    function captureRegionUndoSnapshot(opt) {
        const tracks = [];
        const n = getExtraTrackCount();
        for (let i = 0; i < n; i++) {
            const tr =
                typeof extraTrackBySlot === 'function' ? extraTrackBySlot(i) : null;
            let playbackRegions = emptyPlaybackRegionsState();
            if (tr && tr.playbackRegions) {
                playbackRegions = deepCloneJson(tr.playbackRegions);
            }
            const timelineStartSec =
                typeof getExtraTrackTimelineStartSec === 'function'
                    ? getExtraTrackTimelineStartSec(i)
                    : 0;
            tracks.push({ slot: i, playbackRegions, timelineStartSec });
        }
        let phrase = null;
        if (regionUndoSnapshotIncludePhrase(opt)) {
            phrase = capturePhraseUndoSnapshot();
        }
        return { tracks, phrase };
    }

    function regionUndoSnapshotsEqual(a, b) {
        return (
            JSON.stringify(normalizeRegionUndoSnapshot(a)) ===
            JSON.stringify(normalizeRegionUndoSnapshot(b))
        );
    }

    function clearRegionRedoStack() {
        regionRedoStack.length = 0;
    }

    function requestRegionUndoCapture(opt) {
        if (regionUndoPaused) return;
        const snap = captureRegionUndoSnapshot(opt);
        const top = regionUndoStack.length
            ? regionUndoStack[regionUndoStack.length - 1]
            : null;
        if (top && regionUndoSnapshotsEqual(top, snap)) return;
        regionUndoStack.push(snap);
        clearRegionRedoStack();
    }

    function restoreRegionUndoSnapshot(snap) {
        regionUndoPaused = true;
        const normalized = normalizeRegionUndoSnapshot(snap);
        const n = getExtraTrackCount();
        for (let i = 0; i < n; i++) {
            const entry = normalized.tracks.find((e) => e.slot === i);
            const tr =
                typeof extraTrackBySlot === 'function' ? extraTrackBySlot(i) : null;
            if (!tr) continue;
            if (entry) {
                tr.playbackRegions = deepCloneJson(entry.playbackRegions);
                if (typeof setExtraTrackTimelineStartSec === 'function') {
                    setExtraTrackTimelineStartSec(entry.slot, entry.timelineStartSec, {
                        skipPersist: true,
                    });
                }
            } else {
                tr.playbackRegions = emptyPlaybackRegionsState();
            }
            updateTrackRegionOverlays({ type: 'extra', slot: i });
            redrawAfterRegionChange(i);
        }
        updateAllPlaybackRegionOverlays();
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        if (
            normalized.phrase != null &&
            typeof restorePhraseUndoSnapshot === 'function'
        ) {
            restorePhraseUndoSnapshot(normalized.phrase);
        }
        regionUndoPaused = false;
    }

    function captureRegionUndoSnapshotForHistory() {
        return captureRegionUndoSnapshot({ includePhrase: true });
    }

    function undoPlaybackRegion() {
        if (!regionUndoStack.length) return false;
        const current = captureRegionUndoSnapshotForHistory();
        const prev = regionUndoStack.pop();
        regionRedoStack.push(current);
        restoreRegionUndoSnapshot(prev);
        writeLog('Playback region: undo');
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Region', 'Undo', 'notice');
        }
        return true;
    }

    function redoPlaybackRegion() {
        if (!regionRedoStack.length) return false;
        const current = captureRegionUndoSnapshotForHistory();
        const next = regionRedoStack.pop();
        regionUndoStack.push(current);
        restoreRegionUndoSnapshot(next);
        writeLog('Playback region: redo');
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Region', 'Redo', 'notice');
        }
        return true;
    }

    function clearRegionUndoStack() {
        regionUndoStack.length = 0;
        clearRegionRedoStack();
        regionUndoDragSnap = null;
    }

    function beginRegionUndoGesture() {
        if (regionUndoPaused) return;
        regionUndoDragSnap = captureRegionUndoSnapshot();
    }

    function commitRegionUndoGesture() {
        if (regionUndoPaused || !regionUndoDragSnap) return;
        const current = captureRegionUndoSnapshot();
        if (!regionUndoSnapshotsEqual(regionUndoDragSnap, current)) {
            regionUndoStack.push(regionUndoDragSnap);
            clearRegionRedoStack();
        }
        regionUndoDragSnap = null;
    }

    function cancelRegionUndoGesture() {
        regionUndoDragSnap = null;
    }

    function trackKey(track) {
        return track && track.type === 'extra' ? 'extra:' + track.slot : '';
    }

    function parseTrackKey(key) {
        const m = /^extra:(\d+)$/.exec(key);
        if (m) return { type: 'extra', slot: parseInt(m[1], 10) };
        return null;
    }

    function isExtraTrackRef(track) {
        return !!(track && track.type === 'extra' && Number.isFinite(track.slot));
    }

    function isSessionRestoreBusy() {
        return (
            (typeof isSessionRestoreInProgress === 'function' &&
                isSessionRestoreInProgress()) ||
            (typeof isSessionRestoreTeardownPending === 'function' &&
                isSessionRestoreTeardownPending())
        );
    }

    function normalizeSegment(sourceInSec, sourceOutSec, fullDur) {
        let inS = Number(sourceInSec);
        let outS = Number(sourceOutSec);
        if (!Number.isFinite(inS)) inS = 0;
        if (!Number.isFinite(outS)) outS = fullDur;
        if (outS < inS) {
            const t = inS;
            inS = outS;
            outS = t;
        }
        inS = Math.max(0, Math.min(inS, fullDur));
        outS = Math.max(inS + PLAYBACK_REGION_MIN_SEC, Math.min(fullDur, outS));
        return { sourceInSec: inS, sourceOutSec: outS };
    }

    function newRegionId() {
        return (
            'reg-' +
            Date.now().toString(36) +
            '-' +
            Math.random().toString(36).slice(2, 9)
        );
    }

    function newRegionGroupId() {
        return (
            'rgrp-' +
            Date.now().toString(36) +
            '-' +
            Math.random().toString(36).slice(2, 7)
        );
    }

    function getSegmentRegionGroupId(track, segmentIndex) {
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (!raw || !raw.regionGroupId) return '';
        return String(raw.regionGroupId);
    }

    function regionGroupMemberKey(slot, segmentIndex) {
        return slot + ':' + segmentIndex;
    }

    /** 同一 groupId のリージョンを全 Ex トラックから列挙 */
    function collectRegionGroupMembers(track, segmentIndex) {
        const gid = getSegmentRegionGroupId(track, segmentIndex);
        if (!gid) {
            return [{ slot: track.slot, segmentIndex }];
        }
        const members = [];
        const n = getExtraTrackCount();
        for (let s = 0; s < n; s++) {
            const t = { type: 'extra', slot: s };
            const count = getSegmentCount(t);
            for (let i = 0; i < count; i++) {
                if (getSegmentRegionGroupId(t, i) === gid) {
                    members.push({ slot: s, segmentIndex: i });
                }
            }
        }
        return members.length
            ? members
            : [{ slot: track.slot, segmentIndex }];
    }

    function collectRegionGroupMemberIndices(track, segmentIndex) {
        return collectRegionGroupMembers(track, segmentIndex)
            .filter((m) => m.slot === track.slot)
            .map((m) => m.segmentIndex);
    }

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
        for (let i = 0; i < regionSelectionEntries.length; i++) {
            const e = regionSelectionEntries[i];
            if (e.slot === slot && e.segmentIndex === segmentIndex) return true;
        }
        return false;
    }

    function syncRegionSelectionClasses() {
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

    function addRegionSelectionEntry(slot, segmentIndex) {
        if (!(slot >= 0) || !(segmentIndex >= 0)) return;
        if (isRegionEntrySelected(slot, segmentIndex)) return;
        regionSelectionEntries.push({ slot, segmentIndex });
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

    function swapSegmentContentFields(a, b) {
        if (!a || !b) return;
        const keys = [
            'id',
            'clipId',
            'sourceInSec',
            'sourceOutSec',
            'gainDb',
            'fadeInSec',
            'fadeOutSec',
            'regionGroupId',
        ];
        for (let k = 0; k < keys.length; k++) {
            const key = keys[k];
            const tmp = a[key];
            if (b[key] === undefined) delete a[key];
            else a[key] = b[key];
            if (tmp === undefined) delete b[key];
            else b[key] = tmp;
        }
    }

    /** 入れ替え後: 先頭アンカーを保ち、全リージョンを隙間なく並べ直す */
    function compactSwappedSegmentTimeline(segments, track) {
        if (!segments.length) return;
        const t0 = getTrackTimelineStartSec(track);
        let anchor = getSegmentTimelineStart(track, 0);
        if (!Number.isFinite(anchor)) anchor = t0 + getHeadPadSec(track);
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            seg.timelineStartSec = anchor;
            delete seg.regionTimelineInSec;
            delete seg.regionLeadPadSec;
            anchor = segmentEntryTimelineEnd(seg);
        }
        const state = getPlaybackRegionsState(track);
        if (state) {
            delete state.regionTimelineInSec;
            delete state.regionLeadPadSec;
            state.headPadSec = Math.max(
                0,
                (Number(segments[0].timelineStartSec) || t0) - t0,
            );
        }
    }

    function phraseGroupIndexForSegmentSwap(track, segmentIndex) {
        if (segmentIndex < 0) return segmentIndex;
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const regionEnd = getSegmentTimelineEnd(track, segmentIndex);
        const mid = (regionIn + regionEnd) * 0.5;
        if (typeof resolvePhraseGroupIndexAtTransportSec === 'function') {
            const phraseIdx = resolvePhraseGroupIndexAtTransportSec(mid);
            if (phraseIdx != null && phraseIdx >= 0) return phraseIdx;
        }
        if (
            typeof resolvePhraseGroupAtTransportSec === 'function' &&
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible()
        ) {
            const hit = resolvePhraseGroupAtTransportSec(mid);
            if (hit && Number.isFinite(hit.paletteIndex) && hit.paletteIndex >= 0) {
                return hit.paletteIndex;
            }
        }
        return segmentIndex;
    }

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

    function playbackRegionSwapBlockReason() {
        if (
            typeof getMusicalGridPhraseFillVisible !== 'function' ||
            !getMusicalGridPhraseFillVisible()
        ) {
            return 'phrase tint off';
        }
        if (regionSelectionEntries.length !== 2) {
            return 'select exactly 2 regions';
        }
        if (selectionHasGroupedRegions()) {
            return 'grouped regions';
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
        if (a.segmentIndex === b.segmentIndex) {
            return 'select 2 different regions';
        }
        return null;
    }

    function notifyCannotSwapPlaybackRegions(reason) {
        writeLog('Playback region: cannot swap (' + reason + ')');
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Region', "Can't swap regions", 'error');
        }
    }

    function swapSelectedPlaybackRegions() {
        const reason = playbackRegionSwapBlockReason();
        if (reason) {
            notifyCannotSwapPlaybackRegions(reason);
            return false;
        }
        const slotNum = regionSelectionEntries[0].slot;
        const track = { type: 'extra', slot: slotNum };
        const idxA = regionSelectionEntries[0].segmentIndex;
        const idxB = regionSelectionEntries[1].segmentIndex;
        const lo = Math.min(idxA, idxB);
        const hi = Math.max(idxA, idxB);

        const phraseLo = phraseGroupIndexForSegmentSwap(track, lo);
        const phraseHi = phraseGroupIndexForSegmentSwap(track, hi);

        if (!regionUndoPaused) requestRegionUndoCapture({ includePhrase: true });

        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        if (!segments[lo] || !segments[hi]) {
            notifyCannotSwapPlaybackRegions('invalid region');
            return false;
        }

        swapSegmentContentFields(segments[lo], segments[hi]);
        compactSwappedSegmentTimeline(segments, track);

        const normalized = segments.map((s) =>
            normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
        );
        const affected = [];
        for (let i = 0; i < normalized.length; i++) affected.push(i);
        const ok = !!setTrackSegments(track, normalized, {
            silent: true,
            skipUndo: true,
            affectedSegmentIndices: affected,
            segmentStructureChanged: true,
        });
        if (!ok) {
            notifyCannotSwapPlaybackRegions('apply failed');
            return false;
        }
        if (typeof schedulePersistExtraTrackSlot === 'function') {
            schedulePersistExtraTrackSlot(track.slot);
        }
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        if (typeof swapPhraseGroupsAtIndices === 'function') {
            swapPhraseGroupsAtIndices(phraseLo, phraseHi, { skipUndo: true });
        }
        writeLog(
            'Playback region: swapped regions ' + (lo + 1) + ' and ' + (hi + 1),
        );
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Region', 'Swapped', 'notice');
        }
        clearRegionSelection();
        return true;
    }

    function normalizeSegmentEntry(seg, track, fullDur) {
        const base = normalizeSegment(seg.sourceInSec, seg.sourceOutSec, fullDur);
        base.id = seg && seg.id ? seg.id : newRegionId();
        if (seg && seg.clipId) {
            base.clipId = seg.clipId;
        } else if (typeof getDefaultExtraClipId === 'function' && track) {
            base.clipId = getDefaultExtraClipId(track.slot);
        } else {
            base.clipId = 'main';
        }
        if (seg && Number.isFinite(seg.timelineStartSec)) {
            base.timelineStartSec = seg.timelineStartSec;
        }
        if (seg && Number.isFinite(seg.regionTimelineInSec)) {
            base.regionTimelineInSec = Math.max(0, seg.regionTimelineInSec);
        }
        if (seg && Number.isFinite(seg.regionLeadPadSec)) {
            base.regionLeadPadSec = Math.max(0, seg.regionLeadPadSec);
        }
        if (seg && Number.isFinite(seg.gainDb)) {
            const db = Math.max(
                REGION_GAIN_DB_MIN,
                Math.min(REGION_GAIN_DB_MAX, seg.gainDb),
            );
            if (Math.abs(db) > 0.0005) base.gainDb = db;
        }
        if (seg && Number.isFinite(seg.fadeInSec)) {
            base.fadeInSec = Math.max(0, seg.fadeInSec);
        }
        if (seg && Number.isFinite(seg.fadeOutSec)) {
            base.fadeOutSec = Math.max(0, seg.fadeOutSec);
        }
        if (seg && seg.regionGroupId) {
            base.regionGroupId = String(seg.regionGroupId);
        }
        return base;
    }

    function clampRegionGainDb(db) {
        const n = Number(db);
        if (!Number.isFinite(n)) return 0;
        return Math.max(REGION_GAIN_DB_MIN, Math.min(REGION_GAIN_DB_MAX, n));
    }

    function getSegmentGainDb(track, segmentIndex) {
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (!raw || !Number.isFinite(raw.gainDb)) return 0;
        return clampRegionGainDb(raw.gainDb);
    }

    function getSegmentGainLinear(track, segmentIndex) {
        const db = getSegmentGainDb(track, segmentIndex);
        if (Math.abs(db) < 0.0005) return 1;
        if (typeof trackLaneLinearGainFromDb === 'function') {
            return trackLaneLinearGainFromDb(db);
        }
        return Math.pow(10, db / 20);
    }

    /** Fade In: 序盤ゆっくり→終盤急上昇 / Fade Out: 序盤急降下→終盤ゆっくり（二次 ease） */
    const SEGMENT_FADE_EASE_POWER = 2;

    function clampFadeNorm(norm) {
        return Math.max(0, Math.min(1, Number(norm) || 0));
    }

    function segmentFadeEaseIn(norm) {
        const p = clampFadeNorm(norm);
        return Math.pow(p, SEGMENT_FADE_EASE_POWER);
    }

    function segmentFadeEaseOut(norm) {
        const p = clampFadeNorm(norm);
        return Math.pow(p, SEGMENT_FADE_EASE_POWER);
    }

    /** リージョン端 Fade In/Out（fadeIn=進行度 p、fadeOut=残量 remaining に適用） */
    function segmentFadeCurve(norm) {
        return segmentFadeEaseIn(norm);
    }

    /** 結合境界の手動 Fade Out/In（二次 ease） */
    function manualJoinedBoundaryFadeOutGain(p) {
        const x = clampFadeNorm(p);
        return segmentFadeEaseOut(1 - x);
    }

    function manualJoinedBoundaryFadeInGain(p) {
        return segmentFadeEaseIn(p);
    }

    function getSegmentFadeOverlapWindow(track, segmentIndex) {
        const segStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const segEnd = getSegmentTimelineEnd(track, segmentIndex);
        let earliestOverlapStart = segEnd;
        let latestOverlapEnd = segStart;
        const segments = getTrackSegments(track);
        for (let i = 0; i < segments.length; i++) {
            if (i === segmentIndex) continue;
            const otherStart = getSegmentPlaybackTimelineStart(track, i);
            const otherEnd = getSegmentTimelineEnd(track, i);
            const overlapStart = Math.max(segStart, otherStart);
            const overlapEnd = Math.min(segEnd, otherEnd);
            if (overlapEnd - overlapStart < MIN_CROSSFADE_OVERLAP_SEC) continue;
            if (overlapStart < earliestOverlapStart) earliestOverlapStart = overlapStart;
            if (overlapEnd > latestOverlapEnd) latestOverlapEnd = overlapEnd;
        }
        return { segStart, segEnd, earliestOverlapStart, latestOverlapEnd };
    }

    /** 保存値のフェード秒（上限クランプ・重なり計算なし） */
    function getRawSegmentFadeSec(track, segmentIndex, kind) {
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (!raw) return 0;
        const key = kind === 'out' ? 'fadeOutSec' : 'fadeInSec';
        return Math.max(0, Number(raw[key]) || 0);
    }

    function getSegmentFadeDurationLimit(track, segmentIndex, kind) {
        const win = getSegmentFadeOverlapWindow(track, segmentIndex);
        if (kind === 'in') {
            return Math.max(0, win.earliestOverlapStart - win.segStart);
        }
        if (kind === 'out') {
            return Math.max(0, win.segEnd - win.latestOverlapEnd);
        }
        return 0;
    }

    function getSegmentFadeDurationSec(track, segmentIndex, kind) {
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (!raw) return 0;
        const key = kind === 'out' ? 'fadeOutSec' : 'fadeInSec';
        const stored = Math.max(0, Number(raw[key]) || 0);
        const maxAllowed = getSegmentFadeDurationLimit(track, segmentIndex, kind);
        return Math.max(0, Math.min(stored, maxAllowed));
    }

    function setSegmentFadeDurationSec(track, segmentIndex, kind, sec, opt) {
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return false;
        const raw = state.segments[segmentIndex];
        const key = kind === 'out' ? 'fadeOutSec' : 'fadeInSec';
        const maxAllowed = getSegmentFadeDurationLimit(track, segmentIndex, kind);
        const next = Math.max(0, Math.min(maxAllowed, Number(sec) || 0));
        const prev = getSegmentFadeDurationSec(track, segmentIndex, kind);
        if (Math.abs(next - prev) < 0.0005) return false;
        if (!(opt && opt.skipUndo) && !regionUndoPaused) {
            requestRegionUndoCapture();
        }
        if (next <= 0.0005) delete raw[key];
        else raw[key] = next;
        if (opt && opt.geometryOnly) {
            refreshTrackRegionOverlayGeometry(track);
        } else {
            updateTrackRegionOverlays(track);
        }
        redrawAfterRegionChange(track.slot, { segmentIndex });
        if (!(opt && opt.skipPersist) && typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        return true;
    }

    function computeSegmentFadeLinearAtTransport(track, segmentIndex, transportSec) {
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return 1;
        const manualFade = computeManualJoinedBoundaryFadeLinear(
            track,
            segmentIndex,
            transportSec,
        );
        if (manualFade != null) return manualFade;
        const start = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const end = getSegmentTimelineEnd(track, segmentIndex);
        if (!(end > start + 0.0005)) return 1;
        const fadeInSec = getSegmentFadeDurationSec(track, segmentIndex, 'in');
        const fadeOutSec = getSegmentFadeDurationSec(track, segmentIndex, 'out');
        let gIn = 1;
        let gOut = 1;
        if (fadeInSec > 0.0005 && t <= start + fadeInSec) {
            gIn = segmentFadeCurve((t - start) / fadeInSec);
        }
        if (fadeOutSec > 0.0005 && t >= end - fadeOutSec) {
            gOut = segmentFadeCurve((end - t) / fadeOutSec);
        }
        return Math.max(0, Math.min(1, gIn * gOut));
    }

    function getSegmentPlaybackGainLinear(track, segmentIndex, transportSec) {
        return (
            getSegmentGainLinear(track, segmentIndex) *
            computeSegmentFadeLinearAtTransport(track, segmentIndex, transportSec)
        );
    }

    function formatRegionGainDbDisplay(db) {
        const n = clampRegionGainDb(db);
        if (Math.abs(n) < 0.0005) return '';
        if (typeof trackLaneFormatDbValue === 'function') {
            return trackLaneFormatDbValue(n) + ' dB';
        }
        const s = n.toFixed(1);
        return (n > 0 ? '+' : '') + s + ' dB';
    }

    function setSegmentGainDb(track, segmentIndex, gainDb, opt) {
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return false;
        const next = clampRegionGainDb(gainDb);
        const prev = getSegmentGainDb(track, segmentIndex);
        if (Math.abs(next - prev) < 0.0005) return false;
        if (!(opt && opt.skipUndo) && !regionUndoPaused) {
            requestRegionUndoCapture();
        }
        const raw = state.segments[segmentIndex];
        if (Math.abs(next) < 0.0005) {
            delete raw.gainDb;
        } else {
            raw.gainDb = next;
        }
        updateTrackRegionOverlays(track);
        redrawAfterRegionChange(track.slot);
        if (!(opt && opt.skipPersist) && typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (
            !(opt && opt.skipVolumeMarker) &&
            typeof syncMarkerForRegionVolumeChange === 'function'
        ) {
            syncMarkerForRegionVolumeChange(track, segmentIndex, next, prev);
        }
        if (
            Math.abs(next) < 0.0005 &&
            typeof tryRejoinVolumeSplitBoundariesAtSegment === 'function'
        ) {
            tryRejoinVolumeSplitBoundariesAtSegment(track, segmentIndex, {
                skipUndo: !!(opt && opt.skipUndo),
            });
        }
        return true;
    }

    function transportBoundaryEpsilonSec() {
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        return Math.max(1e-6, step * 0.5);
    }

    /** 分割禁止マージン（最短リージョン長と同じ。クランプで無音片ができるのを防ぐ） */
    function playbackRegionSplitForbiddenMarginSec() {
        return PLAYBACK_REGION_MIN_SEC;
    }

    function isNearPlaybackRegionUncuttableTransport(track, transportSec, marginSec) {
        const segments = getTrackSegments(track);
        if (!segments.length) return false;
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return true;
        const margin = Math.max(
            playbackRegionSplitForbiddenMarginSec(),
            Number(marginSec) || 0,
        );
        const eps = transportBoundaryEpsilonSec();
        for (let i = 0; i < segments.length; i++) {
            const regionIn = getSegmentRegionTimelineIn(track, i);
            const segEnd = getSegmentTimelineEnd(track, i);
            if (Math.abs(regionIn - t) <= margin + eps) return true;
            if (Math.abs(segEnd - t) <= margin + eps) return true;
            if (i < segments.length - 1) {
                const nextAnchor = getSegmentTimelineStart(track, i + 1);
                if (Math.abs(nextAnchor - t) <= margin + eps) return true;
            }
        }
        const t0 = getTrackTimelineStartSec(track);
        const trackEnd = getTrackTimelineEndSec(track);
        if (Math.abs(t0 - t) <= margin + eps) return true;
        if (Math.abs(trackEnd - t) <= margin + eps) return true;
        return false;
    }

    function isSourceSecAtExistingSegmentBoundary(track, sourceSec) {
        const segments = getTrackSegments(track);
        if (!segments.length) return false;
        const s = Number(sourceSec);
        if (!Number.isFinite(s)) return true;
        const eps = Math.max(1e-5, PLAYBACK_REGION_MIN_SEC * 0.05);
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (Math.abs(seg.sourceInSec - s) <= eps) return true;
            if (Math.abs(seg.sourceOutSec - s) <= eps) return true;
        }
        return false;
    }

    function resolvePlaybackRegionSplitPlacement(track, transportSec) {
        if (!isExtraTrackRef(track)) return null;
        const splitTransport = clampRegionEditTransportSec(track, transportSec);
        if (
            isNearPlaybackRegionUncuttableTransport(
                track,
                splitTransport,
                playbackRegionSplitForbiddenMarginSec(),
            )
        ) {
            return null;
        }
        const hit = mapTransportToSegment(track, splitTransport);
        if (!hit) return null;

        const segments = getTrackSegments(track);
        const splitIndex = hit.segmentIndex;
        const seg = segments[splitIndex];
        if (!seg) return null;
        const fullDur = getSegmentSourceDurationSec(track, seg);
        if (!fullDur) return null;

        const clipId = hit.clipId || getSegmentClipId(track, splitIndex);
        const sourceSplit = segmentSourceSecFromTransport(
            track,
            splitIndex,
            splitTransport,
        );
        const minSplit = seg.sourceInSec + PLAYBACK_REGION_MIN_SEC;
        const maxSplit = seg.sourceOutSec - PLAYBACK_REGION_MIN_SEC;
        if (!(maxSplit > minSplit)) return null;

        const eps = transportBoundaryEpsilonSec();
        if (sourceSplit < minSplit - eps || sourceSplit > maxSplit + eps) {
            return null;
        }
        if (isSourceSecAtExistingSegmentBoundary(track, sourceSplit)) {
            return null;
        }

        const margin = playbackRegionSplitForbiddenMarginSec();
        const regionIn = getSegmentRegionTimelineIn(track, splitIndex);
        const segEnd = getSegmentTimelineEnd(track, splitIndex);
        const playStart = getSegmentPlaybackTimelineStart(track, splitIndex);
        if (splitTransport - regionIn < margin - eps) return null;
        if (segEnd - splitTransport < margin - eps) return null;
        if (splitTransport - playStart < margin - eps) return null;

        return {
            splitTransport,
            splitIndex,
            sourceSplit,
            clipId,
            seg,
        };
    }

    function isPlaybackRegionSplitForbiddenAtTransport(track, transportSec) {
        return !resolvePlaybackRegionSplitPlacement(track, transportSec);
    }
    window.isPlaybackRegionSplitForbiddenAtTransport =
        isPlaybackRegionSplitForbiddenAtTransport;

    function isTimelineBoundaryAtTransport(track, transportSec) {
        const segments = getTrackSegments(track);
        if (!segments.length) return false;
        const t = snapRegionTransportSec(transportSec, { sameSlotOnly: track.slot });
        return isNearPlaybackRegionUncuttableTransport(
            track,
            t,
            playbackRegionSplitForbiddenMarginSec(),
        );
    }

    function splitPlaybackRegionAtTransportSec(track, transportSec, opt) {
        if (!isExtraTrackRef(track)) return false;
        const placement = resolvePlaybackRegionSplitPlacement(track, transportSec);
        if (!placement) return false;

        const { splitIndex, sourceSplit, clipId, seg } = placement;
        let segments = getTrackSegments(track);

        const leftStart = getSegmentTimelineStart(track, splitIndex);
        const leftSourceDur = sourceSplit - seg.sourceInSec;
        const splitTimelineSec = leftStart + leftSourceDur;
        const left = {
            id: newRegionId(),
            clipId: seg.clipId || clipId,
            sourceInSec: seg.sourceInSec,
            sourceOutSec: sourceSplit,
            timelineStartSec: leftStart,
        };
        const right = {
            id: newRegionId(),
            clipId: seg.clipId || clipId,
            sourceInSec: sourceSplit,
            sourceOutSec: seg.sourceOutSec,
            timelineStartSec: splitTimelineSec,
        };
        if (Number.isFinite(seg.gainDb) && Math.abs(seg.gainDb) > 0.0005) {
            left.gainDb = seg.gainDb;
            right.gainDb = seg.gainDb;
        }
        if (Number.isFinite(seg.fadeInSec) && seg.fadeInSec > 0.0005) {
            left.fadeInSec = seg.fadeInSec;
        }
        if (Number.isFinite(seg.fadeOutSec) && seg.fadeOutSec > 0.0005) {
            right.fadeOutSec = seg.fadeOutSec;
        }
        const next = segments.slice();
        next.splice(splitIndex, 1, left, right);
        const ok = !!setTrackSegments(track, next, {
            silent: true,
            skipUndo: !!(opt && opt.skipUndo),
            affectedSegmentIndices: [splitIndex, splitIndex + 1],
        });
        if (ok && typeof schedulePersistExtraTrackSlot === 'function') {
            schedulePersistExtraTrackSlot(track.slot);
        }
        if (
            ok &&
            !(opt && opt.skipPersistFlush) &&
            typeof flushPersistSessionNow === 'function'
        ) {
            void flushPersistSessionNow().catch(() => {});
        }
        return ok;
    }

    function resolveMarkerRegionTargetSlot() {
        if (typeof getWaveformTargetExtraSlot === 'function') {
            const slot = getWaveformTargetExtraSlot();
            if (slot >= 0 && isExtraSlotUsableForRegion(slot)) return slot;
        }
        const domSlot = getActiveMixExtraSlotFromDom();
        if (domSlot >= 0 && isExtraSlotUsableForRegion(domSlot)) return domSlot;
        if (typeof getLastActiveMixExtraSlot === 'function') {
            const slot = getLastActiveMixExtraSlot();
            if (slot >= 0 && isExtraSlotUsableForRegion(slot)) return slot;
        }
        const n =
            getExtraTrackCount();
        for (let i = 0; i < n; i++) {
            if (isExtraSlotUsableForRegion(i)) return i;
        }
        return -1;
    }

    function ensureIndependentRegionForMarkerRange(track, startSec, endSec, opt) {
        if (!isExtraTrackRef(track)) {
            return { segmentIndex: -1, created: false };
        }
        ensureDefaultTrackRegion(track, { skipOverlay: true, silent: true });
        if (!isTrackRegionActive(track)) {
            return { segmentIndex: -1, created: false };
        }

        let start = snapRegionTransportSec(startSec, { sameSlotOnly: track.slot });
        let end = snapRegionTransportSec(endSec, { sameSlotOnly: track.slot });
        if (end < start) {
            const swap = start;
            start = end;
            end = swap;
        }
        if (end - start < PLAYBACK_REGION_MIN_SEC * 2) {
            return { segmentIndex: -1, created: false };
        }

        let created = false;
        if (!(opt && opt.skipUndo) && !regionUndoPaused) {
            requestRegionUndoCapture();
        }

        const splitPoints = [start, end].sort((a, b) => b - a);
        for (let i = 0; i < splitPoints.length; i++) {
            const t = splitPoints[i];
            if (isTimelineBoundaryAtTransport(track, t)) continue;
            if (
                splitPlaybackRegionAtTransportSec(track, t, {
                    silent: true,
                    skipUndo: true,
                })
            ) {
                created = true;
            }
        }

        const mid = (start + end) * 0.5;
        let hit = mapTransportToSegment(track, mid);
        if (!hit) {
            return { segmentIndex: -1, created };
        }

        let idx = hit.segmentIndex;
        const eps = transportBoundaryEpsilonSec();
        const regionIn = getSegmentRegionTimelineIn(track, idx);
        if (regionIn > start + eps) {
            setSegmentRegionTimelineIn(track, idx, start);
            created = true;
        }

        let segEnd = getSegmentTimelineEnd(track, idx);
        if (segEnd > end + eps) {
            if (
                splitPlaybackRegionAtTransportSec(track, end, {
                    silent: true,
                    skipUndo: true,
                })
            ) {
                created = true;
            }
            hit = mapTransportToSegment(track, mid);
            if (!hit) {
                return { segmentIndex: -1, created };
            }
            idx = hit.segmentIndex;
            segEnd = getSegmentTimelineEnd(track, idx);
        }

        if (segEnd < end - eps) {
            return { segmentIndex: -1, created };
        }

        if (created) {
            updateTrackRegionOverlays(track);
            redrawAfterRegionChange(track.slot);
            if (typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
            if (typeof syncExtraAudioToTransport === 'function') {
                syncExtraAudioToTransport({ force: true });
            }
        }

        return { segmentIndex: idx, created };
    }

    function adjustSegmentGainDbAtPointer(clientX, clientY, deltaDb) {
        const hit =
            typeof resolveRegionSegmentFromPointer === 'function'
                ? resolveRegionSegmentFromPointer(clientX, clientY)
                : null;
        if (!hit || hit.segmentIndex < 0) return false;
        const track = hit.track || { type: 'extra', slot: hit.slot };
        if (!isTrackRegionActive(track)) return false;
        const step = Number(deltaDb);
        if (!Number.isFinite(step) || Math.abs(step) < 0.0005) return false;
        const next = clampRegionGainDb(
            getSegmentGainDb(track, hit.segmentIndex) + step,
        );
        if (
            !setSegmentGainDb(track, hit.segmentIndex, next, { skipPersist: true })
        ) {
            return false;
        }
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        const label = formatRegionGainDbDisplay(next);
        writeLog(
            'Ex ' +
                (hit.slot + 1) +
                ' region ' +
                (hit.segmentIndex + 1) +
                ' gain: ' +
                (label || '0.0 dB'),
        );
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(
                'Ex ' + (hit.slot + 1) + ' R' + (hit.segmentIndex + 1),
                label || '0.0 dB',
                'notice',
            );
        }
        return true;
    }

    function adjustPlaybackRegionGainForTransportRange(startSec, endSec, deltaDb, meta) {
        const slot = resolveMarkerRegionTargetSlot();
        if (slot < 0) {
            const loadMsg =
                meta && meta.loadLog
                    ? meta.loadLog
                    : 'Playback region: load an Ex track to adjust volume from a range marker';
            writeLog(loadMsg);
            if (typeof flashSeekHint === 'function') {
                flashSeekHint(
                    (meta && meta.loadHintTitle) || 'Region',
                    (meta && meta.loadHintDetail) || 'Load Ex audio',
                    'notice',
                );
            }
            return { handled: true, ok: false };
        }
        const track = { type: 'extra', slot };
        const ensured = ensureIndependentRegionForMarkerRange(track, startSec, endSec);
        if (ensured.segmentIndex < 0) {
            const failDetail =
                (meta && meta.failHintDetail) || 'Region isolate failed';
            writeLog(
                'Ex ' +
                    (slot + 1) +
                    ': could not isolate region' +
                    (meta && meta.failLogSuffix ? meta.failLogSuffix : ' for range marker'),
            );
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Ex ' + (slot + 1), failDetail, 'notice');
            }
            return { handled: true, ok: false };
        }
        const next = clampRegionGainDb(
            getSegmentGainDb(track, ensured.segmentIndex) + deltaDb,
        );
        if (
            !setSegmentGainDb(track, ensured.segmentIndex, next, {
                skipPersist: true,
                skipUndo: ensured.created,
            })
        ) {
            return { handled: true, ok: false };
        }
        if (typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        const label = formatRegionGainDbDisplay(next);
        const gainSuffix = (meta && meta.gainLogSuffix) || ' (marker)';
        writeLog(
            'Ex ' +
                (slot + 1) +
                ' region ' +
                (ensured.segmentIndex + 1) +
                ' gain' +
                gainSuffix +
                ': ' +
                (label || '0.0 dB'),
        );
        if (typeof flashSeekHint === 'function') {
            const hintTitle =
                (meta && meta.hintTitle) ||
                'Ex ' + (slot + 1) + ' R' + (ensured.segmentIndex + 1);
            flashSeekHint(hintTitle, label || '0.0 dB', 'notice');
        }
        return { handled: true, ok: true };
    }

    function handlePlaybackRegionGainWheel(ev) {
        if (!ev || !ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) {
            return false;
        }
        const lanes =
            typeof getWaveformLanesEl === 'function' ? getWaveformLanesEl() : null;
        if (!lanes) return false;
        let over = false;
        if (typeof ev.composedPath === 'function') {
            over = ev.composedPath().includes(lanes);
        } else if (ev.target) {
            over = lanes.contains(ev.target);
        }
        if (!over) return false;
        const delta = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;
        if (!delta) return false;
        const deltaDb = delta > 0 ? -1 : 1;

        if (typeof resolveRangeMarkerAtPointer === 'function') {
            const markerHit = resolveRangeMarkerAtPointer(ev.clientX, ev.clientY);
            if (markerHit) {
                const result = adjustPlaybackRegionGainForTransportRange(
                    markerHit.startSec,
                    markerHit.endSec,
                    deltaDb,
                    {
                        gainLogSuffix: ' (marker)',
                    },
                );
                if (result.handled) {
                    ev.preventDefault();
                    return true;
                }
            }
        }

        if (typeof resolvePhraseGroupAtTransportSec === 'function') {
            const transportSec =
                typeof transportSecFromClientX === 'function'
                    ? transportSecFromClientX(ev.clientX)
                    : NaN;
            const phraseHit = resolvePhraseGroupAtTransportSec(transportSec);
            if (phraseHit) {
                const result = adjustPlaybackRegionGainForTransportRange(
                    phraseHit.startSec,
                    phraseHit.endSec,
                    deltaDb,
                    {
                        gainLogSuffix: ' (phrase ' + phraseHit.label + ')',
                        hintTitle: 'Phrase ' + phraseHit.label,
                        loadLog:
                            'Playback region: load an Ex track to adjust volume from a phrase',
                        loadHintTitle: 'Phrase',
                        loadHintDetail: 'Load Ex audio',
                        failLogSuffix: ' for phrase',
                        failHintDetail: 'Phrase region isolate failed',
                    },
                );
                if (result.handled) {
                    ev.preventDefault();
                    return true;
                }
            }
        }

        if (!adjustSegmentGainDbAtPointer(ev.clientX, ev.clientY, deltaDb)) {
            return false;
        }
        ev.preventDefault();
        return true;
    }

    function getSegmentSourceDurationSec(track, seg) {
        const clipId = seg && seg.clipId ? seg.clipId : 'main';
        if (isExtraTrackRef(track) && typeof getExtraTrackClipDurationSec === 'function') {
            const d = getExtraTrackClipDurationSec(track.slot, clipId);
            if (d > 0) return d;
        }
        const trackDur = getTrackSourceDurationSec(track);
        if (trackDur > 0) return trackDur;
        const inS = Number(seg && seg.sourceInSec);
        const outS = Number(seg && seg.sourceOutSec);
        if (Number.isFinite(outS) && outS > inS + 1e-6) return outS;
        return 0;
    }

    function getSegmentClipId(track, segmentIndex) {
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return 'main';
        const raw = state.segments[segmentIndex];
        return raw.clipId || 'main';
    }

    function snapTimelineSec(sec, opt) {
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            return Math.max(0, n);
        }
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        return Math.max(0, Math.round(n / step) * step);
    }

    function regionSnapThresholdSec() {
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const el =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        const m =
            typeof waveformTimelineMetrics === 'function' ? waveformTimelineMetrics(el) : null;
        if (!master || !m || !m.scrubW) {
            return Math.max(step * 6, 0.05);
        }
        const SNAP_PX = 14;
        return Math.max(step, (SNAP_PX / m.scrubW) * master);
    }

    function snapToNearestStop(sec, stops, threshold, opt) {
        const n = Number(sec);
        if (!Number.isFinite(n) || !stops || !stops.length) return n;
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            return n;
        }
        const th = Number.isFinite(threshold) && threshold > 0 ? threshold : regionSnapThresholdSec();
        let best = n;
        let bestDist = th + 1;
        for (let i = 0; i < stops.length; i++) {
            const s = stops[i];
            if (!Number.isFinite(s)) continue;
            const d = Math.abs(s - n);
            if (d <= th && d < bestDist) {
                bestDist = d;
                best = s;
            }
        }
        return best;
    }

    function isRegionSnapStopExcluded(exclude, slot, segmentIndex) {
        if (!exclude || exclude.slot !== slot) return false;
        if (Array.isArray(exclude.segmentIndices)) {
            return exclude.segmentIndices.indexOf(segmentIndex) >= 0;
        }
        return exclude.segmentIndex === segmentIndex;
    }

    function collectRegionSnapStops(exclude, sameSlotOnly) {
        const stops = [];
        const n =
            getExtraTrackCount();
        const limitSlot =
            typeof sameSlotOnly === 'number' && sameSlotOnly >= 0 ? sameSlotOnly : -1;
        for (let slot = 0; slot < n; slot++) {
            if (limitSlot >= 0 && slot !== limitSlot) continue;
            const track = { type: 'extra', slot };
            if (!isTrackRegionActive(track)) continue;
            const segs = getTrackSegments(track);
            for (let i = 0; i < segs.length; i++) {
                if (isRegionSnapStopExcluded(exclude, slot, i)) {
                    continue;
                }
                stops.push(getSegmentRegionTimelineIn(track, i));
                stops.push(getSegmentTimelineEnd(track, i));
            }
        }
        return stops;
    }

    function resolveTimelineSnapPriorityMode() {
        const markerActive =
            typeof hasVisibleMarkersOnTimeline === 'function' &&
            hasVisibleMarkersOnTimeline();
        if (markerActive) return 'marker';
        const musicalActive =
            typeof hasMusicalGridSnapStops === 'function' && hasMusicalGridSnapStops();
        if (musicalActive) return 'musical';
        return 'region';
    }

    function snapRegionTransportSec(sec, opt) {
        let n = snapTimelineSec(sec, opt);
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            return Math.max(0, n);
        }
        const threshold = regionSnapThresholdSec();
        const exclude = opt && opt.exclude ? opt.exclude : null;
        const sameSlotOnly =
            opt && typeof opt.sameSlotOnly === 'number' ? opt.sameSlotOnly : -1;
        if (sameSlotOnly >= 0) {
            const snappedSameSlot = snapToNearestStop(
                n,
                collectRegionSnapStops(exclude, sameSlotOnly),
                threshold,
                opt,
            );
            if (Math.abs(snappedSameSlot - n) > 1e-9) {
                return Math.max(0, snappedSameSlot);
            }
        }
        const priority = resolveTimelineSnapPriorityMode();
        if (priority === 'marker' && typeof collectMarkerVideoEndSnapStops === 'function') {
            n = snapToNearestStop(n, collectMarkerVideoEndSnapStops(), threshold, opt);
        } else if (priority === 'musical' && typeof collectMusicalGridSnapStops === 'function') {
            n = snapToNearestStop(n, collectMusicalGridSnapStops(), threshold, opt);
        } else {
            n = snapToNearestStop(
                n,
                collectRegionSnapStops(exclude, sameSlotOnly),
                threshold,
                opt,
            );
        }
        return Math.max(0, n);
    }

    /** In/Out ハンドル: 全 Ex のリージョン In/Out を常に候補にし、マーカー／グリッドも併用 */
    function snapRegionHandleTransportSec(sec, opt) {
        let n = snapTimelineSec(sec, opt);
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            return Math.max(0, n);
        }
        const threshold = regionSnapThresholdSec();
        const exclude = opt && opt.exclude ? opt.exclude : null;
        const stops = collectRegionSnapStops(exclude, -1);
        const priority = resolveTimelineSnapPriorityMode();
        if (priority === 'marker' && typeof collectMarkerVideoEndSnapStops === 'function') {
            const markerStops = collectMarkerVideoEndSnapStops();
            for (let i = 0; i < markerStops.length; i++) {
                stops.push(markerStops[i]);
            }
        } else if (priority === 'musical' && typeof collectMusicalGridSnapStops === 'function') {
            const gridStops = collectMusicalGridSnapStops();
            for (let i = 0; i < gridStops.length; i++) {
                stops.push(gridStops[i]);
            }
        }
        return Math.max(0, snapToNearestStop(n, stops, threshold, opt));
    }

    /** 波形クリック／シークバー: リージョン In/Out（またはマーカー表示時はマーカー）へスナップ */
    function snapTransportSecForWaveformSeek(sec, opt) {
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            return Math.max(0, n);
        }
        const thresholdSec = regionSnapThresholdSec();
        const markersShownOnWaveform =
            typeof audioWaveformMarkers !== 'undefined' &&
            audioWaveformMarkers &&
            !audioWaveformMarkers.hidden;
        if (markersShownOnWaveform && typeof snapSecToMarkerInOut === 'function') {
            return snapSecToMarkerInOut(n, {
                thresholdSec,
                altKey: !!(opt && opt.altKey),
            });
        }
        if (typeof snapRegionTransportSec === 'function') {
            return snapRegionTransportSec(n, {
                sameSlotOnly: -1,
                altKey: !!(opt && opt.altKey),
            });
        }
        return Math.max(0, n);
    }

    /** マーカードラッグ: 全 Ex トラックのリージョン In/Out へスナップ */
    function snapSecToPlaybackRegionInOut(sec, opt) {
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            const n = Number(sec);
            return Number.isFinite(n) ? Math.max(0, n) : 0;
        }
        const threshold =
            opt && Number.isFinite(opt.thresholdSec) && opt.thresholdSec > 0
                ? opt.thresholdSec
                : regionSnapThresholdSec();
        return Math.max(
            0,
            snapToNearestStop(sec, collectRegionSnapStops(null, -1), threshold, opt),
        );
    }

    /** transportRatioFromClientX は 0–1 クランプのため、Out ドラッグでは未クランプ比率を使う */
    function scrubRatioUnclampedFromClientX(clientX, scrubWCss) {
        const inner =
            typeof waveformTimelineInnerEl === 'function' ? waveformTimelineInnerEl() : null;
        const lanes =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        const ref = inner || lanes;
        const w = Number(scrubWCss);
        if (!ref || !(w > 0) || !Number.isFinite(clientX)) return 0;
        const left = ref.getBoundingClientRect().left;
        return (Number(clientX) - left) / w;
    }

    function collectRegionMoveSnapStops(exclude) {
        const priority = resolveTimelineSnapPriorityMode();
        if (priority === 'marker' && typeof collectMarkerVideoEndSnapStops === 'function') {
            return collectMarkerVideoEndSnapStops();
        }
        if (priority === 'musical' && typeof collectMusicalGridSnapStops === 'function') {
            return collectMusicalGridSnapStops();
        }
        return collectRegionSnapStops(exclude, -1);
    }

    /** リージョン平行移動: In/Out 両端のうち近い方でマーカー・他トラック In/Out・動画終端へスナップ */
    function snapRegionMoveRegionInSec(desiredRegionIn, track, segmentIndex, opt) {
        const raw = Number(desiredRegionIn) || 0;
        if (typeof isSnapSuppressedByAlt === 'function' && isSnapSuppressedByAlt(opt)) {
            return Math.max(REGION_IN_MIN_TRANSPORT_SEC, raw);
        }
        const n = snapTimelineSec(raw, opt);
        const threshold = regionSnapThresholdSec();
        const exclude =
            opt && opt.exclude
                ? opt.exclude
                : { slot: track.slot, segmentIndex };
        const baseRegionIn =
            opt && Number.isFinite(opt.dragStartRegionIn)
                ? opt.dragStartRegionIn
                : getSegmentRegionTimelineIn(track, segmentIndex);
        const baseAnchor =
            opt && Number.isFinite(opt.dragStartAnchor)
                ? opt.dragStartAnchor
                : getSegmentTimelineStart(track, segmentIndex);
        const seg = getTrackSegments(track)[segmentIndex];
        if (!seg) return snapRegionTransportSec(n, { exclude, sameSlotOnly: -1 });

        const segDur = Math.max(
            PLAYBACK_REGION_MIN_SEC,
            seg.sourceOutSec - seg.sourceInSec,
        );
        const outOffsetFromIn = baseAnchor - baseRegionIn + segDur;
        const rawOut = n + outOffsetFromIn;
        const stops = collectRegionMoveSnapStops(exclude);

        let bestRegionIn = n;
        let bestDist = threshold + 1;
        for (let i = 0; i < stops.length; i++) {
            const stop = stops[i];
            if (!Number.isFinite(stop)) continue;
            const dIn = Math.abs(stop - n);
            if (dIn <= threshold && dIn < bestDist) {
                bestDist = dIn;
                bestRegionIn = stop;
            }
            const dOut = Math.abs(stop - rawOut);
            if (dOut <= threshold && dOut < bestDist) {
                bestDist = dOut;
                bestRegionIn = stop - outOffsetFromIn;
            }
        }
        return Math.max(REGION_IN_MIN_TRANSPORT_SEC, snapTimelineSec(bestRegionIn, opt));
    }

    function maxSegmentSourceOutSec(track, segmentIndex) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return 0;
        const clipDur = getSegmentSourceDurationSec(track, seg);
        return Math.max(seg.sourceInSec + PLAYBACK_REGION_MIN_SEC, clipDur);
    }

    function maxSegmentTimelineEndSec(track, segmentIndex) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return 0;
        const start = getSegmentTimelineStart(track, segmentIndex);
        const span = Math.max(
            PLAYBACK_REGION_MIN_SEC,
            maxSegmentSourceOutSec(track, segmentIndex) - seg.sourceInSec,
        );
        return start + span;
    }

    function getAllRegionTimelineIntervals(exclude) {
        const list = [];
        const n =
            getExtraTrackCount();
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            if (!isTrackRegionActive(track)) continue;
            const segs = getTrackSegments(track);
            for (let i = 0; i < segs.length; i++) {
                if (
                    exclude &&
                    exclude.slot === slot &&
                    exclude.segmentIndex === i
                ) {
                    continue;
                }
                const start = getSegmentTimelineStart(track, i);
                const end = getSegmentTimelineEnd(track, i);
                list.push({ slot, segmentIndex: i, start, end });
            }
        }
        return list;
    }

    function intervalsOverlapTimeline(aStart, aEnd, bStart, bEnd) {
        return (
            aStart < bEnd - SEGMENT_BOUNDARY_JOIN_EPS_SEC &&
            aEnd > bStart + SEGMENT_BOUNDARY_JOIN_EPS_SEC
        );
    }

    function clampSegmentTimelineStart(_track, _segmentIndex, desiredStart) {
        return Math.max(0, Number(desiredStart) || 0);
    }

    function clampSegmentTimelineEnd(track, segmentIndex, desiredEnd) {
        const start = getSegmentTimelineStart(track, segmentIndex);
        return Math.max(start + PLAYBACK_REGION_MIN_SEC, Number(desiredEnd) || 0);
    }

    const REGION_RESIZE_HANDLE_HIT_PX = 7;

    /** リージョン移動時、絶対位置の regionTimelineInSec をアンカーと同量だけ追従させる */
    function shiftSegmentRegionTimelineInByDelta(track, segmentIndex, delta) {
        if (!Number.isFinite(delta) || Math.abs(delta) < 0.00001) return;
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            if (!state || !Number.isFinite(state.regionTimelineInSec)) return;
            state.regionTimelineInSec = Math.max(0, state.regionTimelineInSec + delta);
            return;
        }
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (raw && Number.isFinite(raw.regionTimelineInSec)) {
            raw.regionTimelineInSec = Math.max(0, raw.regionTimelineInSec + delta);
        }
    }

    function shiftTrackAbsoluteRegionInsByDelta(track, delta) {
        if (!Number.isFinite(delta) || Math.abs(delta) < 0.00001) return;
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments || !state.segments.length) return;
        for (let i = 0; i < state.segments.length; i++) {
            shiftSegmentRegionTimelineInByDelta(track, i, delta);
        }
    }

    const REGION_HANDLE_HIT_PAD_PX = 4;
    /** 見た目 8px の三角に対し、操作判定だけ下方向に倍 */
    const FADE_HANDLE_HIT_HEIGHT_MUL = 2;

    function fadeHandleHitTestRect(visualRect) {
        if (!visualRect || !(visualRect.width > 0) || !(visualRect.height > 0)) {
            return null;
        }
        const w = visualRect.width;
        const h = visualRect.height * FADE_HANDLE_HIT_HEIGHT_MUL;
        return {
            left: visualRect.left,
            top: visualRect.top,
            right: visualRect.left + w,
            bottom: visualRect.top + h,
            width: w,
            height: h,
        };
    }

    function isPointerOnFadeHandleTriangle(kind, rect, clientX, clientY) {
        if (!rect || !(rect.width > 0) || !(rect.height > 0)) return false;
        if (
            clientX < rect.left ||
            clientX > rect.right ||
            clientY < rect.top ||
            clientY > rect.bottom
        ) {
            return false;
        }
        const lx = clientX - rect.left;
        const ly = clientY - rect.top;
        const w = rect.width;
        const h = rect.height;
        if (kind === 'fade-in') {
            return lx / w + ly / h <= 1 + 1e-6;
        }
        if (kind === 'fade-out') {
            return (w - lx) / w + ly / h <= 1 + 1e-6;
        }
        return false;
    }

    function getFadeHandleHitRect(regionEl, edgeKind) {
        if (!regionEl) return null;
        const sel =
            edgeKind === 'in'
                ? '.audio-waveform-lane__playback-region__handle--fade-in'
                : edgeKind === 'out'
                  ? '.audio-waveform-lane__playback-region__handle--fade-out'
                  : null;
        if (!sel) return null;
        const handleEl = regionEl.querySelector(sel);
        if (!handleEl || handleEl.hidden) return null;
        return fadeHandleHitTestRect(handleEl.getBoundingClientRect());
    }

    /** In/Out とフェード三角の操作帯が重なるとき、端リサイズ判定から除外する */
    function isPointerInFadeHandleHitZone(regionEl, edgeKind, clientX, clientY) {
        const hitRect = getFadeHandleHitRect(regionEl, edgeKind);
        if (!hitRect || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
            return false;
        }
        return (
            clientX >= hitRect.left &&
            clientX <= hitRect.right &&
            clientY >= hitRect.top &&
            clientY <= hitRect.bottom
        );
    }

    function isPointerOnRegionEdgeResizeHandle(regionEl, edgeKind, clientX, clientY) {
        if (!regionEl || !Number.isFinite(clientX)) return false;
        const pad = REGION_HANDLE_HIT_PAD_PX;
        const sel =
            edgeKind === 'in'
                ? '.audio-waveform-lane__playback-region__handle--in'
                : edgeKind === 'out'
                  ? '.audio-waveform-lane__playback-region__handle--out'
                  : null;
        if (!sel) return false;
        const handleEl = regionEl.querySelector(sel);
        if (!handleEl) return false;
        const r = handleEl.getBoundingClientRect();
        if (clientX < r.left - pad || clientX > r.right + pad) return false;
        if (
            Number.isFinite(clientY) &&
            isPointerInFadeHandleHitZone(regionEl, edgeKind, clientX, clientY)
        ) {
            return false;
        }
        return true;
    }

    function isPointerOnRegionResizeHandle(regionEl, clientX, clientY) {
        if (!regionEl || !Number.isFinite(clientX)) return false;
        return (
            isPointerOnRegionEdgeResizeHandle(regionEl, 'in', clientX, clientY) ||
            isPointerOnRegionEdgeResizeHandle(regionEl, 'out', clientX, clientY)
        );
    }

    /** 重なり／クロスフェード部でも、DOM 前面のリージョン本体に隠れた In/Out を拾う */
    function resolveRegionResizeHandleAtPointer(track, clientX, clientY) {
        if (!isExtraTrackRef(track) || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
            return null;
        }
        const lane = document.getElementById('extraAudioLane' + track.slot);
        if (!lane || lane.hidden) return null;
        const laneRect = lane.getBoundingClientRect();
        if (
            clientY < laneRect.top ||
            clientY > laneRect.bottom ||
            clientX < laneRect.left ||
            clientX > laneRect.right
        ) {
            return null;
        }
        const container = getPlaybackRegionsContainerEl(track);
        if (!container || container.hidden) return null;

        const pad = REGION_HANDLE_HIT_PAD_PX;
        let bestFade = null;
        let bestFadeDist = Infinity;
        let best = null;
        let bestDist = Infinity;
        const regions = container.querySelectorAll('.audio-waveform-lane__playback-region');
        for (let r = 0; r < regions.length; r++) {
            const regionEl = regions[r];
            const segmentIndex = Number(regionEl.dataset.segmentIndex);
            if (!Number.isFinite(segmentIndex)) continue;
            const fadeCandidates = [
                {
                    kind: 'fade-in',
                    el: regionEl.querySelector(
                        '.audio-waveform-lane__playback-region__handle--fade-in',
                    ),
                },
                {
                    kind: 'fade-out',
                    el: regionEl.querySelector(
                        '.audio-waveform-lane__playback-region__handle--fade-out',
                    ),
                },
            ];
            for (let c = 0; c < fadeCandidates.length; c++) {
                const handleEl = fadeCandidates[c].el;
                if (!handleEl || handleEl.hidden) continue;
                const kind = fadeCandidates[c].kind;
                const fadeEdgeKind = kind === 'fade-in' ? 'in' : 'out';
                if (
                    !isPointerInFadeHandleHitZone(
                        regionEl,
                        fadeEdgeKind,
                        clientX,
                        clientY,
                    )
                ) {
                    continue;
                }
                const hitRect = getFadeHandleHitRect(regionEl, fadeEdgeKind);
                if (!hitRect) continue;
                const cx = (hitRect.left + hitRect.right) * 0.5;
                const cy = (hitRect.top + hitRect.bottom) * 0.5;
                const dist = Math.hypot(clientX - cx, clientY - cy);
                if (dist < bestFadeDist) {
                    bestFadeDist = dist;
                    bestFade = { segmentIndex, kind, regionEl };
                }
            }
            const edgeCandidates = [
                {
                    kind: 'in',
                    el: regionEl.querySelector(
                        '.audio-waveform-lane__playback-region__handle--in',
                    ),
                },
                {
                    kind: 'out',
                    el: regionEl.querySelector(
                        '.audio-waveform-lane__playback-region__handle--out',
                    ),
                },
            ];
            for (let c = 0; c < edgeCandidates.length; c++) {
                const kind = edgeCandidates[c].kind;
                const handleEl = edgeCandidates[c].el;
                if (!handleEl) continue;
                const rect = handleEl.getBoundingClientRect();
                if (clientX < rect.left - pad || clientX > rect.right + pad) continue;
                if (isPointerInFadeHandleHitZone(regionEl, kind, clientX, clientY)) {
                    continue;
                }
                const cx = (rect.left + rect.right) * 0.5;
                const dist = Math.abs(clientX - cx);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = { segmentIndex, kind, regionEl };
                }
            }
        }
        return bestFade || best;
    }

    /** カーソル表示用（↔）。操作判定そのものは resolveRegionResizeHandleAtPointer の三角テスト */
    function isPointerOnAnyRegionFadeHandle(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        const n = getExtraTrackCount();
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            const lane = document.getElementById('extraAudioLane' + track.slot);
            if (!lane || lane.hidden) continue;
            const container = getPlaybackRegionsContainerEl(track);
            if (!container || container.hidden) continue;
            const regions = container.querySelectorAll(
                '.audio-waveform-lane__playback-region',
            );
            for (let r = 0; r < regions.length; r++) {
                const regionEl = regions[r];
                if (
                    isPointerInFadeHandleHitZone(regionEl, 'in', clientX, clientY) ||
                    isPointerInFadeHandleHitZone(regionEl, 'out', clientX, clientY)
                ) {
                    return true;
                }
            }
        }
        return false;
    }

    function isPointerOnAnyRegionResizeHandle(clientX, clientY, opt) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        const slots = [];
        if (opt && Number.isFinite(opt.slot)) {
            slots.push(opt.slot);
        } else {
            const n =
                getExtraTrackCount();
            for (let i = 0; i < n; i++) slots.push(i);
        }
        for (let i = 0; i < slots.length; i++) {
            if (
                resolveRegionResizeHandleAtPointer(
                    { type: 'extra', slot: slots[i] },
                    clientX,
                    clientY,
                )
            ) {
                return true;
            }
        }
        return false;
    }

    function getPlaybackRegionsState(track) {
        if (!isExtraTrackRef(track)) return null;
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(track.slot) : null;
        if (!tr) return null;
        if (!tr.playbackRegions) {
            if (tr.region && tr.region.active) {
                const fullDur =
                    typeof extraTrackContentDurationSec === 'function'
                        ? extraTrackContentDurationSec(track.slot)
                        : 0;
                const out =
                    Number.isFinite(tr.region.sourceOutSec) && tr.region.sourceOutSec > 0
                        ? tr.region.sourceOutSec
                        : fullDur;
                tr.playbackRegions = {
                    active: true,
                    headPadSec: 0,
                    segments: [
                        normalizeSegment(tr.region.sourceInSec, out, fullDur),
                    ],
                };
                delete tr.region;
            } else {
                tr.playbackRegions = { active: false, segments: [], headPadSec: 0 };
            }
        }
        if (!Number.isFinite(tr.playbackRegions.headPadSec)) {
            tr.playbackRegions.headPadSec = 0;
        }
        return tr.playbackRegions;
    }

    function getHeadPadSec(track) {
        const state = getPlaybackRegionsState(track);
        if (!state) return 0;
        return Math.max(0, Number(state.headPadSec) || 0);
    }

    /** リージョン左端（In ハンドル） */
    function getSegmentRegionTimelineIn(track, segmentIndex) {
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            if (state && Number.isFinite(state.regionTimelineInSec)) {
                const regionIn = Math.max(0, state.regionTimelineInSec);
                return regionIn < anchor - 0.00001 ? anchor : regionIn;
            }
            return anchor;
        }
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (raw && Number.isFinite(raw.regionTimelineInSec)) {
            const regionIn = Math.max(0, raw.regionTimelineInSec);
            return regionIn < anchor - 0.00001 ? anchor : regionIn;
        }
        return anchor;
    }

    /**
     * リージョン右端（Out ハンドル）。
     * カスタム In があるとき Out は segment 先頭 + 長さのまま固定され、
     * regionIn + (anchor - regionIn + segDur) で In オフセットを反映する。
     */
    function getSegmentRegionTimelineOut(track, segmentIndex) {
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        const timelineEnd = getSegmentTimelineEnd(track, segmentIndex);
        const segDur = Math.max(0, timelineEnd - anchor);
        return regionIn + (anchor - regionIn + segDur);
    }

    /** オーバーレイ描画・外周 □ 判定と同じ [In, Out] 区間 */
    function getSegmentRegionOverlayTimelineInterval(track, segmentIndex) {
        const trackStart = getTrackTimelineStartSec(track);
        const start = Math.max(trackStart, getSegmentRegionTimelineIn(track, segmentIndex));
        const end = getSegmentRegionTimelineOut(track, segmentIndex);
        return { start, end };
    }

    /** マーカー等: trackStart でクランプしない In〜Out */
    function getSegmentRegionTimelineInterval(track, segmentIndex) {
        return {
            start: getSegmentRegionTimelineIn(track, segmentIndex),
            end: getSegmentRegionTimelineOut(track, segmentIndex),
        };
    }

    /** アンカーと regionTimelineInSec の差（ドラッグ移動で維持する In オフセット） */
    function getSegmentRegionInPadSec(track, segmentIndex) {
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        let stored = null;
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            if (state && Number.isFinite(state.regionTimelineInSec)) {
                stored = state.regionTimelineInSec;
            }
        } else {
            const raw = getRawSegmentEntry(track, segmentIndex);
            if (raw && Number.isFinite(raw.regionTimelineInSec)) {
                stored = raw.regionTimelineInSec;
            }
        }
        if (stored == null) return 0;
        return Math.max(0, stored - anchor);
    }

    function applySegmentAnchorAndRegionInForDrag(
        track,
        segmentIndex,
        desiredAnchor,
        desiredRegionIn,
        t0,
        inPad,
    ) {
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return;
        state.segments[segmentIndex].timelineStartSec = desiredAnchor;
        if (segmentIndex === 0) {
            if (inPad > 0.00001) {
                state.regionTimelineInSec = desiredRegionIn;
            } else {
                delete state.regionTimelineInSec;
                delete state.regionLeadPadSec;
                state.headPadSec = Math.max(0, desiredAnchor - t0);
            }
            return;
        }
        const raw = state.segments[segmentIndex];
        if (inPad > 0.00001) {
            raw.regionTimelineInSec = desiredRegionIn;
        } else {
            delete raw.regionTimelineInSec;
            delete raw.regionLeadPadSec;
        }
    }

    function getSegmentRegionLeadPadSec(track, segmentIndex) {
        let lead = 0;
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            lead = Math.max(0, Number(state && state.regionLeadPadSec) || 0);
        } else {
            const raw = getRawSegmentEntry(track, segmentIndex);
            lead = Math.max(0, Number(raw && raw.regionLeadPadSec) || 0);
        }
        if (lead <= 0.00001) return 0;
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        if (regionIn > anchor + 0.00001) {
            return 0;
        }
        return lead;
    }

    /** 波形描画のタイムライン左端（リージョン In / 再生開始と同一） */
    function getSegmentWaveformDrawTimelineStart(track, segmentIndex) {
        return getSegmentWaveformVisibleTimelineStart(track, segmentIndex);
    }

    /** 波形を表示するタイムライン左端（リージョン In 以降） */
    function getSegmentWaveformVisibleTimelineStart(track, segmentIndex) {
        const segT0 = getSegmentTimelineStart(track, segmentIndex);
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        let start = regionIn > segT0 + 0.00001 ? regionIn : playbackStart;
        return start;
    }

    /** 再生上の音声開始（リージョン内先頭ギャップの後） */
    function getSegmentPlaybackTimelineStart(track, segmentIndex) {
        const regionIn = getSegmentRegionTimelineIn(track, segmentIndex);
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        if (regionIn > anchor + 0.00001) {
            return regionIn;
        }
        const leadPad = getSegmentRegionLeadPadSec(track, segmentIndex);
        if (leadPad > 0.00001) {
            return regionIn + leadPad;
        }
        return anchor;
    }

    /** タイムライン位置をクリップ内ソース秒へ（実再生開始基準） */
    function segmentSourceSecFromTransport(track, segmentIndex, transportSec) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return 0;
        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const t = Number(transportSec);
        const span = Math.max(0, seg.sourceOutSec - seg.sourceInSec);
        const local = Math.max(0, Math.min(span, t - playbackStart));
        return seg.sourceInSec + local;
    }

    function setSegmentRegionLeadPadSec(track, segmentIndex, sec) {
        const lead = Math.max(0, Number(sec) || 0);
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            if (!state) return;
            if (lead <= 0.00001) {
                delete state.regionLeadPadSec;
            } else {
                state.regionLeadPadSec = lead;
            }
            return;
        }
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return;
        const raw = state.segments[segmentIndex];
        if (lead <= 0.00001) {
            delete raw.regionLeadPadSec;
        } else {
            raw.regionLeadPadSec = lead;
        }
    }

    function setSegmentRegionTimelineIn(track, segmentIndex, regionIn) {
        const audioEnd = getSegmentTimelineEnd(track, segmentIndex);
        const maxIn = audioEnd - PLAYBACK_REGION_MIN_SEC;
        const clamped = Math.max(0, Math.min(Number(regionIn) || 0, maxIn));
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        if (segmentIndex === 0) {
            const state = getPlaybackRegionsState(track);
            if (!state) return;
            if (Math.abs(clamped - anchor) < 0.00001) {
                delete state.regionTimelineInSec;
            } else {
                state.regionTimelineInSec = clamped;
            }
            return;
        }
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return;
        const raw = state.segments[segmentIndex];
        if (Math.abs(clamped - anchor) < 0.00001) {
            delete raw.regionTimelineInSec;
        } else {
            raw.regionTimelineInSec = clamped;
        }
    }

    function extendSegmentAnchorLeft(track, segmentIndex, regionIn, audioEnd, t0) {
        const segments = getTrackSegments(track).map((s) => ({ ...s }));
        const seg = segments[segmentIndex];
        const state = getPlaybackRegionsState(track);
        if (!seg || !state) return;

        const newAnchor = regionIn;
        const newDur = audioEnd - newAnchor;
        seg.sourceInSec = Math.max(0, seg.sourceOutSec - newDur);
        if (segmentIndex === 0) {
            state.headPadSec = Math.max(0, newAnchor - t0);
            delete state.regionTimelineInSec;
            delete state.regionLeadPadSec;
        } else {
            seg.timelineStartSec = newAnchor;
            delete seg.regionTimelineInSec;
            delete seg.regionLeadPadSec;
        }
        applySegmentsToState(
            track,
            segments.map((s) =>
                normalizeSegmentEntry(s, track, getSegmentSourceDurationSec(track, s)),
            ),
            { silent: true, skipUndo: true },
        );
    }

    function applySegmentRegionInFromTransport(track, segmentIndex, transportSec) {
        const anchor = getSegmentTimelineStart(track, segmentIndex);
        const audioEnd = getSegmentTimelineEnd(track, segmentIndex);
        const t0 = getTrackTimelineStartSec(track);
        let regionIn = Math.max(
            0,
            Math.min(audioEnd - PLAYBACK_REGION_MIN_SEC, transportSec),
        );
        if (segmentIndex === 0) {
            regionIn = Math.max(t0, regionIn);
        }
        regionIn = clampSegmentTimelineStart(track, segmentIndex, regionIn);

        const maxPadIn = audioEnd - PLAYBACK_REGION_MIN_SEC;

        if (regionIn < anchor - 0.00001) {
            if (
                segmentIndex > 0 &&
                isSegmentBoundaryJoined(track, segmentIndex - 1)
            ) {
                setSplitBoundaryFromTransport(track, segmentIndex - 1, regionIn);
                return;
            }
            extendSegmentAnchorLeft(track, segmentIndex, regionIn, audioEnd, t0);
            return;
        }

        if (regionIn <= anchor + 0.00001) {
            setSegmentRegionTimelineIn(track, segmentIndex, anchor);
            setSegmentRegionLeadPadSec(track, segmentIndex, 0);
            updateTrackRegionOverlays(track);
            redrawAfterRegionChange(track.slot, { segmentIndex });
            return;
        }

        if (regionIn <= maxPadIn + 0.00001) {
            setSegmentRegionTimelineIn(track, segmentIndex, regionIn);
            setSegmentRegionLeadPadSec(track, segmentIndex, 0);
            updateTrackRegionOverlays(track);
            redrawAfterRegionChange(track.slot, { segmentIndex });
            return;
        }

        extendSegmentAnchorLeft(track, segmentIndex, regionIn, audioEnd, t0);
    }

    function getTrackSourceDurationSec(track) {
        if (!isExtraTrackRef(track)) return 0;
        if (typeof getExtraTrackMaxClipDurationSec === 'function') {
            const d = getExtraTrackMaxClipDurationSec(track.slot);
            if (d > 0) return d;
        }
        if (typeof extraTrackBufferDuration === 'function') {
            const d = extraTrackBufferDuration(track.slot);
            if (d > 0) return d;
        }
        return 0;
    }

    /** マスター尺用: 各セグメントがクリップ長まで伸ばせるタイムライン終端 */
    function getExtraTrackMaxTimelineEndSec(track) {
        if (!isExtraTrackRef(track)) return 0;
        const t0 = getTrackTimelineStartSec(track);
        const segments = getTrackSegments(track);
        if (!segments.length) {
            const buf = getTrackSourceDurationSec(track);
            return t0 + (buf > 0 ? buf : 0);
        }
        let end = t0;
        for (let i = 0; i < segments.length; i++) {
            end = Math.max(end, getSegmentTimelineEnd(track, i));
            end = Math.max(end, maxSegmentTimelineEndSec(track, i));
        }
        return end;
    }

    function getTrackTimelineStartSec(track) {
        if (!isExtraTrackRef(track)) return 0;
        if (typeof getExtraTrackTimelineStartSec === 'function') {
            return getExtraTrackTimelineStartSec(track.slot);
        }
        return 0;
    }

    function getPrimaryClipIdForTrack(track) {
        if (!isExtraTrackRef(track)) return 'main';
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(track.slot) : null;
        if (tr && tr.clips && tr.clips.length && tr.clips[0].id) {
            return tr.clips[0].id;
        }
        return 'main';
    }

    function ensureDefaultTrackRegion(track, opt) {
        if (!isExtraTrackRef(track)) return false;
        const state = getPlaybackRegionsState(track);
        if (!state || (state.active && state.segments && state.segments.length)) {
            return false;
        }
        const fullDur = getTrackSourceDurationSec(track);
        if (!fullDur) return false;
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(track.slot) : null;
        const segments = [];
        if (tr && tr.clips && tr.clips.length > 1) {
            for (const c of tr.clips) {
                if (!c.buffer || c.buffer.duration <= 0) continue;
                segments.push({
                    id: newRegionId(),
                    clipId: c.id || 'main',
                    sourceInSec: 0,
                    sourceOutSec: c.buffer.duration,
                });
            }
        }
        if (!segments.length) {
            segments.push({
                id: newRegionId(),
                clipId: getPrimaryClipIdForTrack(track),
                sourceInSec: 0,
                sourceOutSec: fullDur,
            });
        }
        state.segments = segments;
        state.active = true;
        state.headPadSec = Math.max(0, Number(state.headPadSec) || 0);
        if (!(opt && opt.skipOverlay) && typeof updateTrackRegionOverlays === 'function') {
            updateTrackRegionOverlays(track);
        }
        if (!(opt && opt.silent) && typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        return true;
    }

    function getTrackSegments(track) {
        const state = getPlaybackRegionsState(track);
        if (!state) return [];
        if (
            !isSessionRestoreBusy() &&
            (!state.active || !state.segments || !state.segments.length)
        ) {
            ensureDefaultTrackRegion(track, { skipOverlay: true, silent: true });
        }
        if (!state.active || !state.segments || !state.segments.length) {
            return [];
        }
        const normalized = [];
        for (let i = 0; i < state.segments.length; i++) {
            const raw = state.segments[i];
            const fullDur = getSegmentSourceDurationSec(track, raw);
            if (!fullDur) continue;
            normalized.push(normalizeSegmentEntry(raw, track, fullDur));
        }
        return normalized;
    }

    function getSegmentCount(track) {
        return getTrackSegments(track).length;
    }

    function getRawSegmentEntry(track, segmentIndex) {
        const state = getPlaybackRegionsState(track);
        if (!state || !state.segments[segmentIndex]) return null;
        return state.segments[segmentIndex];
    }

    function getTrackRegionBounds(track) {
        const fullDur = getTrackSourceDurationSec(track);
        const segments = getTrackSegments(track);
        if (!fullDur || !segments.length) {
            return { sourceInSec: 0, sourceOutSec: 0, fullDurSec: fullDur, active: false };
        }
        return {
            sourceInSec: segments[0].sourceInSec,
            sourceOutSec: segments[segments.length - 1].sourceOutSec,
            fullDurSec: fullDur,
            active: true,
        };
    }

    function isTrackRegionActive(track) {
        return getTrackSegments(track).length > 0;
    }

    function isPlaybackRegionActive() {
        const n =
            getExtraTrackCount();
        for (let i = 0; i < n; i++) {
            if (isTrackRegionActive({ type: 'extra', slot: i })) return true;
        }
        return false;
    }

    function getCompactSegmentTimelineStart(track, segmentIndex) {
        const t0 = getTrackTimelineStartSec(track);
        const segments = getTrackSegments(track);
        let offset = getHeadPadSec(track);
        for (let i = 0; i < segmentIndex && i < segments.length; i++) {
            offset += segments[i].sourceOutSec - segments[i].sourceInSec;
        }
        return t0 + offset;
    }

    function getSegmentTimelineStart(track, segmentIndex) {
        const raw = getRawSegmentEntry(track, segmentIndex);
        if (raw && Number.isFinite(raw.timelineStartSec)) {
            return raw.timelineStartSec;
        }
        return getCompactSegmentTimelineStart(track, segmentIndex);
    }

    function getSegmentTimelineEnd(track, segmentIndex) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return getTrackTimelineStartSec(track);
        return getSegmentTimelineStart(track, segmentIndex) + (seg.sourceOutSec - seg.sourceInSec);
    }

    function segmentBoundaryJoinEpsilonSec() {
        const frame =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        return Math.max(SEGMENT_BOUNDARY_JOIN_EPS_SEC, frame * 0.5);
    }

    function isSegmentBoundaryJoined(track, boundaryIndex) {
        const segments = getTrackSegments(track);
        if (boundaryIndex < 0 || boundaryIndex >= segments.length - 1) return false;
        const leftEnd = getSegmentTimelineEnd(track, boundaryIndex);
        const rightStart = getSegmentTimelineStart(track, boundaryIndex + 1);
        return Math.abs(leftEnd - rightStart) <= segmentBoundaryJoinEpsilonSec();
    }

    /** B 結合: 波形内容が連続している隣接境界のみ（分割直後相当） */
    function isSegmentBoundaryJoinableAtIndex(track, boundaryIndex) {
        if (!isSegmentSourceContinuousAtBoundary(track, boundaryIndex)) return false;
        if (hasManualSegmentFadeAtJoinedBoundary(track, boundaryIndex)) return false;
        if (hasExtendedCrossfadeOverlapAtBoundary(track, boundaryIndex)) return false;
        return true;
    }

    function playbackRegionBoundaryJoinBlockReason(track, boundaryIndex) {
        const segments = getTrackSegments(track);
        if (boundaryIndex < 0 || boundaryIndex >= segments.length - 1) {
            return 'invalid boundary';
        }
        if (!isSegmentSourceContinuousAtBoundary(track, boundaryIndex)) {
            if (!isSegmentBoundaryJoined(track, boundaryIndex)) {
                return 'timeline gap or overlap at boundary';
            }
            const left = segments[boundaryIndex];
            const right = segments[boundaryIndex + 1];
            if (!left || !right) return 'invalid boundary';
            const leftClip =
                left.clipId || getSegmentClipId(track, boundaryIndex);
            const rightClip =
                right.clipId || getSegmentClipId(track, boundaryIndex + 1);
            if (leftClip !== rightClip) return 'different clips at boundary';
            return 'source not continuous at boundary';
        }
        if (hasManualSegmentFadeAtJoinedBoundary(track, boundaryIndex)) {
            return 'crossfade at boundary';
        }
        if (hasExtendedCrossfadeOverlapAtBoundary(track, boundaryIndex)) {
            return 'crossfade overlap at boundary';
        }
        return 'unknown block reason';
    }

    /**
     * 結合アンカーは維持したまま、リージョン In/Out で重なりを広げた手動クロス。
     * 結合境界専用の 1 秒ハンドオフより長い／手前からの重なりがある。
     */
    function hasExtendedCrossfadeOverlapAtBoundary(track, boundaryIndex) {
        if (!isSegmentBoundaryJoined(track, boundaryIndex)) return false;
        const boundaryT = getSegmentTimelineStart(track, boundaryIndex + 1);
        const rightPlay = getSegmentPlaybackTimelineStart(track, boundaryIndex + 1);
        const leftPlay = getSegmentPlaybackTimelineStart(track, boundaryIndex);
        const leftEnd = getSegmentTimelineEnd(track, boundaryIndex);
        const rightEnd = getSegmentTimelineEnd(track, boundaryIndex + 1);
        const overlapStart = Math.max(leftPlay, rightPlay);
        const overlapEnd = Math.min(leftEnd, rightEnd);
        const overlapDur = overlapEnd - overlapStart;
        if (overlapDur < MIN_CROSSFADE_OVERLAP_SEC) return false;
        if (
            rightPlay <
            boundaryT - JOINED_BOUNDARY_CROSSFADE_SEC + SEGMENT_BOUNDARY_JOIN_EPS_SEC
        ) {
            return true;
        }
        return (
            overlapDur >
            JOINED_BOUNDARY_CROSSFADE_SEC + SEGMENT_BOUNDARY_JOIN_EPS_SEC
        );
    }

    /** 結合境界で手動 Fade In/Out が設定されている（自動 1 秒ハンドオフは使わない） */
    function hasManualSegmentFadeAtJoinedBoundary(track, boundaryIndex) {
        if (!isSegmentBoundaryJoined(track, boundaryIndex)) return false;
        const fadeOut = getRawSegmentFadeSec(track, boundaryIndex, 'out');
        const fadeIn = getRawSegmentFadeSec(track, boundaryIndex + 1, 'in');
        return fadeOut > 0.0005 || fadeIn > 0.0005;
    }

    /** 結合境界の自動 1 秒ハンドオフ（現状未使用: ペースト/分割は境界ぴったり） */
    function isAutoJoinedBoundaryCrossfadeEligible(_track, _boundaryIndex) {
        return false;
    }

    /** 結合境界の手動フェード重なり区間（左 FadeOut + 右 FadeIn） */
    function getManualJoinedBoundaryFadeZone(track, boundaryIndex) {
        if (!hasManualSegmentFadeAtJoinedBoundary(track, boundaryIndex)) return null;
        const fadeOut = getRawSegmentFadeSec(track, boundaryIndex, 'out');
        const fadeIn = getRawSegmentFadeSec(track, boundaryIndex + 1, 'in');
        if (fadeOut <= 0.0005 && fadeIn <= 0.0005) return null;
        const boundaryT = getSegmentTimelineStart(track, boundaryIndex + 1);
        const totalSec = fadeOut + fadeIn;
        return {
            boundaryT,
            fadeOut,
            fadeIn,
            startSec: boundaryT - fadeOut,
            endSec: boundaryT + fadeIn,
            totalSec,
        };
    }

    function findManualJoinedBoundaryFadeAtTransport(track, segmentIndex, transportSec) {
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return null;
        const segments = getTrackSegments(track);
        if (segmentIndex > 0) {
            const boundaryIndex = segmentIndex - 1;
            const zone = getManualJoinedBoundaryFadeZone(track, boundaryIndex);
            if (
                zone &&
                zone.fadeIn > 0.0005 &&
                t >= zone.startSec - 0.0005 &&
                t <= zone.endSec + 0.0005
            ) {
                return { zone, boundaryIndex, role: 'right' };
            }
        }
        if (segmentIndex < segments.length - 1) {
            const boundaryIndex = segmentIndex;
            const zone = getManualJoinedBoundaryFadeZone(track, boundaryIndex);
            if (
                zone &&
                zone.fadeOut > 0.0005 &&
                t >= zone.startSec - 0.0005 &&
                t <= zone.endSec + 0.0005
            ) {
                return { zone, boundaryIndex, role: 'left' };
            }
        }
        return null;
    }

    /**
     * 結合境界の手動フェード（再生）: 二次 ease。左は境界より後は 0、右は境界より前は 0。
     */
    function computeManualJoinedBoundaryFadeLinear(track, segmentIndex, transportSec) {
        const hit = findManualJoinedBoundaryFadeAtTransport(
            track,
            segmentIndex,
            transportSec,
        );
        if (!hit) return null;
        const { zone, role } = hit;
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return null;
        if (role === 'left') {
            if (!(zone.fadeOut > 0.0005)) return null;
            if (t >= zone.boundaryT - 0.0005) return 0;
            const p = Math.max(
                0,
                Math.min(1, (t - zone.startSec) / zone.fadeOut),
            );
            return manualJoinedBoundaryFadeOutGain(p);
        }
        if (!(zone.fadeIn > 0.0005)) return null;
        if (t < zone.boundaryT - 0.0005) return 0;
        const p = Math.max(
            0,
            Math.min(1, (t - zone.boundaryT) / zone.fadeIn),
        );
        return manualJoinedBoundaryFadeInGain(p);
    }

    /** 波形表示: リージョン内のみ（タイムライン外へは伸ばさない） */
    function computeManualJoinedBoundaryFadeLinearForDisplay(
        track,
        segmentIndex,
        transportSec,
    ) {
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return null;
        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const absEnd = getSegmentTimelineEnd(track, segmentIndex);
        if (t < playbackStart - 0.0005 || t > absEnd + 0.0005) return null;
        return computeManualJoinedBoundaryFadeLinear(track, segmentIndex, transportSec);
    }

    function segmentSourceSecForManualJoinedCrossfade(
        track,
        segmentIndex,
        transportSec,
        boundaryIndex,
    ) {
        const zone = getManualJoinedBoundaryFadeZone(track, boundaryIndex);
        const segments = getTrackSegments(track);
        const left = segments[boundaryIndex];
        const right = segments[boundaryIndex + 1];
        if (!zone || !left || !right) {
            return segmentSourceSecFromTransport(track, segmentIndex, transportSec);
        }
        if (isSegmentSourceContinuousAtBoundary(track, boundaryIndex)) {
            const sourceAtB = Number(left.sourceOutSec) || 0;
            const src = sourceAtB + (Number(transportSec) - zone.boundaryT);
            if (segmentIndex === boundaryIndex) {
                return Math.max(
                    left.sourceInSec,
                    Math.min(left.sourceOutSec, src),
                );
            }
            return Math.max(
                right.sourceInSec,
                Math.min(right.sourceOutSec, src),
            );
        }
        return segmentSourceSecFromTransport(track, segmentIndex, transportSec);
    }

    function isTransportInManualJoinedBoundaryFadeZone(track, segmentIndex, transportSec) {
        return !!findManualJoinedBoundaryFadeAtTransport(
            track,
            segmentIndex,
            transportSec,
        );
    }

    /** タイムライン結合かつクリップ内ソースが連続（分割直後・B結合可能な境界） */
    function isSegmentSourceContinuousAtBoundary(track, boundaryIndex) {
        if (!isSegmentBoundaryJoined(track, boundaryIndex)) return false;
        const segments = getTrackSegments(track);
        const left = segments[boundaryIndex];
        const right = segments[boundaryIndex + 1];
        if (!left || !right) return false;
        const leftClip =
            left.clipId || getSegmentClipId(track, boundaryIndex);
        const rightClip =
            right.clipId || getSegmentClipId(track, boundaryIndex + 1);
        if (leftClip !== rightClip) return false;
        return (
            Math.abs(
                (Number(left.sourceOutSec) || 0) - (Number(right.sourceInSec) || 0),
            ) <= segmentBoundaryJoinEpsilonSec()
        );
    }

    /** 同一クリップ連続結合チェーンのソース終端（再生ではリージョン境界を跨いで1本） */
    function getContinuousJoinedSourceOutSec(track, segmentIndex) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return 0;
        let outSec = Number(seg.sourceOutSec) || 0;
        for (let b = segmentIndex; b < segments.length - 1; b++) {
            if (!isSegmentBoundaryJoined(track, b)) break;
            if (!isSegmentSourceContinuousAtBoundary(track, b)) break;
            const next = segments[b + 1];
            if (!next) break;
            outSec = Number(next.sourceOutSec) || outSec;
        }
        return outSec;
    }

    /**
     * 結合境界: 入側をフェード開始位置から再生する計画（ソース連続時は左の BufferSource クロックに同期）
     * @returns {{ whenCtx: number, bufferOff: number, remain: number, transportAnchor: number } | null}
     */
    function planIncomingSegmentStartAtJoinedBoundary(track, segmentIndex, ctx, opt) {
        if (!ctx || segmentIndex < 1) return null;
        const boundaryIndex = segmentIndex - 1;
        if (!isSegmentBoundaryJoined(track, boundaryIndex)) return null;
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return null;
        const boundaryT = getSegmentTimelineStart(track, segmentIndex);
        const fadeTransportSec = boundaryT - JOINED_BOUNDARY_CROSSFADE_SEC;
        const mapT =
            opt && Number.isFinite(opt.mapTransportSec)
                ? opt.mapTransportSec
                : fadeTransportSec;
        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        const sourceContinuous = isSegmentSourceContinuousAtBoundary(
            track,
            boundaryIndex,
        );
        const liveHit = mapAllSegmentsAtTransport(track, mapT, {
            forPlayback: true,
        }).find((h) => h.segmentIndex === segmentIndex);
        if (!liveHit || liveHit.remain <= 0.002) return null;
        const bufferOff = liveHit.bufferOff;
        const remain = liveHit.remain;
        let whenCtx = ctx.currentTime + 0.0005;
        const leftEntry = opt && opt.leftEntry ? opt.leftEntry : null;
        const inCrossfadeLeadIn = mapT < playbackStart - 0.0005;
        if (
            inCrossfadeLeadIn &&
            sourceContinuous &&
            leftEntry &&
            leftEntry.src &&
            Number.isFinite(leftEntry.playbackAnchorCtxTime) &&
            Number.isFinite(leftEntry.bufferOff)
        ) {
            const fadeBuf = segmentSourceSecFromTransport(
                track,
                segmentIndex - 1,
                fadeTransportSec,
            );
            whenCtx =
                leftEntry.playbackAnchorCtxTime +
                Math.max(0, fadeBuf - leftEntry.bufferOff);
        } else if (inCrossfadeLeadIn && mapT < fadeTransportSec) {
            whenCtx = ctx.currentTime + Math.max(0.0005, fadeTransportSec - mapT);
        }
        if (whenCtx < ctx.currentTime) {
            whenCtx = ctx.currentTime + 0.0005;
        }
        return {
            whenCtx,
            bufferOff,
            remain,
            transportAnchor: mapT,
        };
    }

    function shouldShowSegmentInHandle(track, segmentIndex) {
        if (segmentIndex === 0) return true;
        return !isSegmentBoundaryJoined(track, segmentIndex - 1);
    }

    function shouldShowSegmentOutHandle(track, segmentIndex) {
        const segments = getTrackSegments(track);
        if (segmentIndex >= segments.length - 1) return true;
        return !isSegmentBoundaryJoined(track, segmentIndex);
    }

    function getTrackTimelineEndSec(track) {
        const segments = getTrackSegments(track);
        if (!segments.length) {
            const fullDur = getTrackSourceDurationSec(track);
            return getTrackTimelineStartSec(track) + (fullDur || 0);
        }
        let end = getTrackTimelineStartSec(track);
        for (let i = 0; i < segments.length; i++) {
            end = Math.max(end, getSegmentTimelineEnd(track, i));
        }
        return end;
    }

    function projectedTrackTimelineEndSec(track, segmentIndex, segmentTimelineEndSec) {
        const segments = getTrackSegments(track);
        if (!segments.length) {
            return getTrackTimelineStartSec(track) + (Number(segmentTimelineEndSec) || 0);
        }
        let end = getTrackTimelineStartSec(track);
        for (let i = 0; i < segments.length; i++) {
            const t =
                i === segmentIndex
                    ? Number(segmentTimelineEndSec) || 0
                    : getSegmentTimelineEnd(track, i);
            end = Math.max(end, t);
        }
        return end;
    }

    function mapTransportToSegment(track, transportSec) {
        const hits = mapAllSegmentsAtTransport(track, transportSec);
        return hits.length ? hits[0] : null;
    }

    function mapAllSegmentsAtTransport(track, transportSec, opt) {
        const segments = getTrackSegments(track);
        if (!segments.length) return [];
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return [];
        const forPlayback = !!(opt && opt.forPlayback);
        const hits = [];
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const regionIn = getSegmentRegionTimelineIn(track, i);
            const playbackStart = getSegmentPlaybackTimelineStart(track, i);
            const absEnd = getSegmentTimelineEnd(track, i);
            const absStart = forPlayback ? playbackStart : regionIn;

            const joinedNext =
                forPlayback &&
                i < segments.length - 1 &&
                isSegmentBoundaryJoined(track, i);
            const joinedPrev =
                forPlayback && i > 0 && isSegmentBoundaryJoined(track, i - 1);
            const boundaryNext = joinedNext ? absEnd : null;
            const boundaryPrev = joinedPrev ? getSegmentTimelineStart(track, i) : null;
            const manualFadePrev =
                joinedPrev &&
                i > 0 &&
                hasManualSegmentFadeAtJoinedBoundary(track, i - 1);
            const manualFadeNext =
                joinedNext &&
                i < segments.length - 1 &&
                hasManualSegmentFadeAtJoinedBoundary(track, i);
            const continuousPrev =
                forPlayback &&
                joinedPrev &&
                isSegmentSourceContinuousAtBoundary(track, i - 1);
            const continuousNext =
                forPlayback &&
                joinedNext &&
                isSegmentSourceContinuousAtBoundary(track, i);
            const autoCrossfadePrev =
                joinedPrev &&
                i > 0 &&
                isAutoJoinedBoundaryCrossfadeEligible(track, i - 1);
            const autoCrossfadeNext =
                joinedNext &&
                i < segments.length - 1 &&
                isAutoJoinedBoundaryCrossfadeEligible(track, i);
            const inHandoffFromPrev =
                autoCrossfadePrev &&
                !manualFadePrev &&
                !continuousPrev &&
                boundaryPrev != null &&
                t >= boundaryPrev - JOINED_BOUNDARY_CROSSFADE_SEC &&
                t < boundaryPrev + 0.00001;
            const inHandoffToNext =
                autoCrossfadeNext &&
                !manualFadeNext &&
                !continuousNext &&
                boundaryNext != null &&
                t >= boundaryNext - JOINED_BOUNDARY_CROSSFADE_SEC &&
                t < boundaryNext + 0.00001;
            let inManualCrossfade = false;
            if (forPlayback && manualFadePrev) {
                const zone = getManualJoinedBoundaryFadeZone(track, i - 1);
                if (
                    zone &&
                    t >= zone.startSec - 0.0005 &&
                    t <= zone.endSec + 0.0005
                ) {
                    inManualCrossfade = true;
                }
            }
            if (forPlayback && manualFadeNext) {
                const zone = getManualJoinedBoundaryFadeZone(track, i);
                if (
                    zone &&
                    t >= zone.startSec - 0.0005 &&
                    t <= zone.endSec + 0.0005
                ) {
                    inManualCrossfade = true;
                }
            }

            if (
                t < regionIn - 0.0005 &&
                !(
                    forPlayback &&
                    (inHandoffFromPrev || inManualCrossfade)
                )
            ) {
                continue;
            }
            if (forPlayback) {
                if (t < playbackStart - 0.0005 && !inHandoffFromPrev && !inManualCrossfade) {
                    continue;
                }
                const playbackEndCutoff =
                    joinedNext && continuousNext
                        ? absEnd + 0.00001
                        : absEnd - 0.0005;
                if (t >= playbackEndCutoff && !inHandoffToNext && !inManualCrossfade) {
                    continue;
                }
            } else if (t >= absEnd - 0.002) {
                continue;
            }

            let sourceSec;
            if (
                forPlayback &&
                inHandoffFromPrev &&
                i > 0 &&
                isSegmentSourceContinuousAtBoundary(track, i - 1)
            ) {
                /** 同一クリップ連続: 左セグメントのソース位置をそのまま使う（sourceInSec へクランプすると境界で飛ぶ） */
                sourceSec = segmentSourceSecFromTransport(track, i - 1, t);
                sourceSec = Math.min(seg.sourceOutSec, sourceSec);
            } else if (forPlayback && inHandoffFromPrev && t < playbackStart + 0.00001) {
                const fadeStart = boundaryPrev - JOINED_BOUNDARY_CROSSFADE_SEC;
                sourceSec = seg.sourceInSec + Math.max(0, t - fadeStart);
            } else if (t < playbackStart - 0.0005) {
                sourceSec = seg.sourceInSec;
            } else {
                sourceSec = segmentSourceSecFromTransport(track, i, t);
            }
            if (forPlayback && inManualCrossfade) {
                const boundaryIndex = manualFadePrev ? i - 1 : i;
                const zone = getManualJoinedBoundaryFadeZone(track, boundaryIndex);
                if (zone && isSegmentSourceContinuousAtBoundary(track, boundaryIndex)) {
                    sourceSec = segmentSourceSecForManualJoinedCrossfade(
                        track,
                        i,
                        t,
                        boundaryIndex,
                    );
                }
            }

            let timelineStart = absStart;
            let timelineEnd = absEnd;
            const skipJoinedCrossfadeClamp =
                forPlayback &&
                ((i > 0 &&
                    isSegmentBoundaryJoined(track, i - 1) &&
                    (hasExtendedCrossfadeOverlapAtBoundary(track, i - 1) ||
                        hasManualSegmentFadeAtJoinedBoundary(track, i - 1))) ||
                    (i < segments.length - 1 &&
                        isSegmentBoundaryJoined(track, i) &&
                        (hasExtendedCrossfadeOverlapAtBoundary(track, i) ||
                            hasManualSegmentFadeAtJoinedBoundary(track, i))));
            if (forPlayback && !skipJoinedCrossfadeClamp && joinedPrev && boundaryPrev != null) {
                timelineStart = Math.min(
                    timelineStart,
                    boundaryPrev - JOINED_BOUNDARY_CROSSFADE_SEC,
                );
                timelineEnd = boundaryPrev;
            } else if (
                forPlayback &&
                !skipJoinedCrossfadeClamp &&
                joinedNext &&
                boundaryNext != null
            ) {
                timelineStart = Math.min(
                    timelineStart,
                    boundaryNext - JOINED_BOUNDARY_CROSSFADE_SEC,
                );
                timelineEnd = boundaryNext;
            }

            hits.push({
                slot: track.slot,
                segmentIndex: i,
                segmentId: seg.id,
                clipId: seg.clipId || getSegmentClipId(track, i),
                sourceSec,
                bufferOff: sourceSec,
                remain: Math.max(0, seg.sourceOutSec - sourceSec),
                timelineStart,
                timelineEnd,
                transportSec: t,
                key: track.slot + ':' + (seg.id || 'i' + i),
            });
        }
        return hits;
    }

    function mapTransportToSegmentForPlayback(track, transportSec) {
        const hits = mapAllSegmentsAtTransport(track, transportSec, { forPlayback: true });
        return hits.length ? hits[0] : null;
    }

    function refreshSegmentHitAtTransport(track, hit, transportSec) {
        const fresh = mapAllSegmentsAtTransport(track, transportSec, {
            forPlayback: true,
        }).find((h) => h.segmentIndex === hit.segmentIndex);
        return fresh || null;
    }

    function getActiveExtraSegmentsAtTransport(transportSec) {
        const all = [];
        const seen = new Set();
        const n =
            getExtraTrackCount();
        let t = Number(transportSec);
        if (!Number.isFinite(t)) return all;
        const scheduleAhead =
            typeof window.EXTRA_AUDIO_SCHEDULE_AHEAD_SEC === 'number'
                ? window.EXTRA_AUDIO_SCHEDULE_AHEAD_SEC
                : 0.02;
        /** 先読みはスケジュール余裕のみ（フェード幅ぶん早く拾うと bufferOff が未来のままになる） */
        const lookahead = scheduleAhead + 0.01;
        const probes = [t, t + lookahead];
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            if (!isTrackRegionActive(track)) continue;
            for (let p = 0; p < probes.length; p++) {
                const hits = mapAllSegmentsAtTransport(track, probes[p], {
                    forPlayback: true,
                });
                for (let i = 0; i < hits.length; i++) {
                    const hit = hits[i];
                    if (seen.has(hit.key)) continue;
                    const refreshed = refreshSegmentHitAtTransport(track, hit, t);
                    if (!refreshed) continue;
                    seen.add(hit.key);
                    all.push(refreshed);
                }
            }
        }
        return all;
    }

    function transportSecToSegmentSourceSec(track, segmentIndex, transportSec) {
        return segmentSourceSecFromTransport(track, segmentIndex, transportSec);
    }

    function isTrackTransportAudible(track, transportSec) {
        return !!mapTransportToSegment(track, transportSec);
    }

    function slicePeaksForRegion(peaks, fullDurSec, sourceInSec, sourceOutSec) {
        if (!peaks || !peaks.length || !fullDurSec) return peaks;
        const inS = Math.max(0, Number(sourceInSec) || 0);
        const outS = Math.min(fullDurSec, Number(sourceOutSec) || fullDurSec);
        if (outS <= inS + 0.0005) return [];
        const i0 = Math.floor((inS / fullDurSec) * peaks.length);
        const i1 = Math.ceil((outS / fullDurSec) * peaks.length);
        return peaks.slice(Math.max(0, i0), Math.min(peaks.length, Math.max(i0 + 1, i1)));
    }

    function samplePeakAtSourceSec(peaks, fullDurSec, sourceSec) {
        if (!peaks || !peaks.length || !(fullDurSec > 0)) {
            return { max: 0, min: 0 };
        }
        const s = Math.max(0, Math.min(fullDurSec, Number(sourceSec) || 0));
        const pos = (s / fullDurSec) * peaks.length;
        const i0 = Math.max(0, Math.min(peaks.length - 1, Math.floor(pos)));
        const i1 = Math.min(peaks.length - 1, i0 + 1);
        if (i0 === i1) return peaks[i0];
        const f = pos - i0;
        return {
            max: peaks[i0].max * (1 - f) + peaks[i1].max * f,
            min: peaks[i0].min * (1 - f) + peaks[i1].min * f,
        };
    }

    /** 再生 map と同じソース秒（結合境界クロスフェードの先行区間を含む） */
    function segmentWaveformSourceSecAtTransport(track, segmentIndex, transportSec) {
        const hits = mapAllSegmentsAtTransport(track, transportSec, {
            forPlayback: true,
        });
        const hit = hits.find((h) => h.segmentIndex === segmentIndex);
        if (hit) return hit.sourceSec;
        return segmentSourceSecFromTransport(track, segmentIndex, transportSec);
    }

    function getSegmentWaveformHideBeforeTimeline(track, segmentIndex) {
        return Math.min(
            getSegmentWaveformVisibleTimelineStart(track, segmentIndex),
            getSegmentWaveformDrawTimelineStart(track, segmentIndex),
        );
    }

    /** 再生区間と同じ基準でセグメント同士のタイムライン重なりがあるか */
    function trackHasPlaybackSegmentOverlap(track) {
        const segments = getTrackSegments(track);
        for (let i = 0; i < segments.length; i++) {
            for (let j = i + 1; j < segments.length; j++) {
                const oStart = Math.max(
                    getSegmentPlaybackTimelineStart(track, i),
                    getSegmentPlaybackTimelineStart(track, j),
                );
                const oEnd = Math.min(
                    getSegmentTimelineEnd(track, i),
                    getSegmentTimelineEnd(track, j),
                );
                if (oEnd - oStart >= MIN_CROSSFADE_OVERLAP_SEC) return true;
            }
        }
        return false;
    }

    function computeWaveformSegmentCrossfadeLinear(track, hits, transportSec) {
        if (!hits || hits.length <= 1) return new Map();
        if (typeof computeEqualPowerCrossfadeGainsForGroup !== 'function') {
            return new Map();
        }
        return computeEqualPowerCrossfadeGainsForGroup(hits, transportSec, {
            groupBySlot: false,
            sameSlotOnly: false,
            trackRefFromHit: () => track,
        });
    }

    /**
     * 再生ミックスと同じゲイン（等パワー × segmentPlaybackGainLinear）でピークを合成。
     * 複数セグメントが同時に鳴る区間専用（単一セグメントは localPeak を使う）。
     */
    function lookupViewportPeakAtTransport(vp, segmentIndex, transportSec) {
        if (!vp || !vp.segments || !vp.segments.length) return null;
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return null;
        for (let i = 0; i < vp.segments.length; i++) {
            const s = vp.segments[i];
            if (s.segmentIndex !== segmentIndex) continue;
            if (t + 1e-9 < s.masterStartSec || t - 1e-9 > s.masterEndSec) continue;
            if (!s.peaks || !s.peaks.length) return null;
            const segDur = s.masterEndSec - s.masterStartSec;
            if (!(segDur > 1e-9)) return null;
            const pos = ((t - s.masterStartSec) / segDur) * s.peaks.length;
            const i0 = Math.max(0, Math.min(s.peaks.length - 1, Math.floor(pos)));
            const i1 = Math.min(s.peaks.length - 1, i0 + 1);
            if (i0 === i1) return s.peaks[i0];
            const f = pos - i0;
            return {
                max: s.peaks[i0].max * (1 - f) + s.peaks[i1].max * f,
                min: s.peaks[i0].min * (1 - f) + s.peaks[i1].min * f,
            };
        }
        return null;
    }

    function waveformPeakForHitAtTransport(track, slot, hit, transportSec, opt) {
        const vp = opt && opt.viewportPeaks;
        if (vp) {
            const vpPk = lookupViewportPeakAtTransport(
                vp,
                hit.segmentIndex,
                transportSec,
            );
            if (vpPk) return vpPk;
        }
        const segments = getTrackSegments(track);
        const seg = segments[hit.segmentIndex];
        if (!seg) return null;
        const fullDur = getSegmentSourceDurationSec(track, seg);
        const peaks = getSegmentPeaksForDraw(slot, hit.clipId);
        if (!peaks || !peaks.length || !(fullDur > 0)) return null;
        return samplePeakAtSourceSec(peaks, fullDur, hit.sourceSec);
    }

    function waveformPlaybackGainForHit(track, hit, hits, transportSec) {
        const cfGains = computeWaveformSegmentCrossfadeLinear(track, hits, transportSec);
        const cf = cfGains.get(hit.key) ?? 1;
        return cf * getSegmentPlaybackGainLinear(track, hit.segmentIndex, transportSec);
    }

    function computeWaveformMixPeakAtTransport(track, slot, transportSec, opt) {
        const hits = mapAllSegmentsAtTransport(track, transportSec, {
            forPlayback: false,
        });
        if (hits.length <= 1) return null;
        let sumMax = 0;
        let sumMin = 0;
        let any = false;
        for (let h = 0; h < hits.length; h++) {
            const hit = hits[h];
            const pk = waveformPeakForHitAtTransport(
                track,
                slot,
                hit,
                transportSec,
                opt,
            );
            if (!pk) continue;
            const gain = waveformPlaybackGainForHit(track, hit, hits, transportSec);
            sumMax += pk.max * gain;
            sumMin += pk.min * gain;
            any = true;
        }
        if (!any) return null;
        return { max: sumMax, min: sumMin };
    }

    function waveformGainForLocalSegment(track, hits, localSegmentIndex, barTransport) {
        const localHit = hits.find((h) => h.segmentIndex === localSegmentIndex);
        if (localHit) {
            return waveformPlaybackGainForHit(track, localHit, hits, barTransport);
        }
        return getSegmentPlaybackGainLinear(track, localSegmentIndex, barTransport);
    }

    function drawLocalWaveformBarAtTransport(
        ctx,
        track,
        hits,
        x,
        barW,
        mid,
        barTransport,
        localPeak,
        localSegmentIndex,
    ) {
        if (!localPeak) return;
        const gain = waveformGainForLocalSegment(
            track,
            hits,
            localSegmentIndex,
            barTransport,
        );
        fillWaveformBarFromPeak(ctx, x, barW, mid, localPeak, gain);
    }

    /** タイムライン位置の波形バー（重なり時は合成、それ以外は localPeak を使用） */
    function drawWaveformBarAtTransport(
        ctx,
        track,
        slot,
        x,
        barW,
        mid,
        barTransport,
        localPeak,
        localSegmentIndex,
        opt,
    ) {
        const hits = mapAllSegmentsAtTransport(track, barTransport, {
            forPlayback: false,
        });
        const hasLocal =
            typeof localSegmentIndex === 'number' &&
            localSegmentIndex >= 0 &&
            localPeak;

        if (hits.length > 1) {
            const mix = computeWaveformMixPeakAtTransport(track, slot, barTransport, opt);
            if (mix) {
                fillWaveformBarFromPeak(ctx, x, barW, mid, mix, 1);
                return;
            }
            if (hasLocal) {
                drawLocalWaveformBarAtTransport(
                    ctx,
                    track,
                    hits,
                    x,
                    barW,
                    mid,
                    barTransport,
                    localPeak,
                    localSegmentIndex,
                );
            }
            return;
        }

        if (hasLocal) {
            drawLocalWaveformBarAtTransport(
                ctx,
                track,
                hits,
                x,
                barW,
                mid,
                barTransport,
                localPeak,
                localSegmentIndex,
            );
            return;
        }

        if (hits.length === 1) {
            const hit = hits[0];
            const gain = waveformPlaybackGainForHit(track, hit, hits, barTransport);
            const pk = waveformPeakForHitAtTransport(
                track,
                slot,
                hit,
                barTransport,
                opt,
            );
            if (pk) fillWaveformBarFromPeak(ctx, x, barW, mid, pk, gain);
        }
    }

    function fillWaveformBarFromPeak(ctx, x, barW, mid, pk, gainScale) {
        const g = Number.isFinite(gainScale) ? gainScale : 1;
        const top = mid - Math.max(0.5, pk.max * g * (mid - 2));
        const bot = mid - Math.min(-0.5, pk.min * g * (mid - 2));
        ctx.fillRect(x, top, Math.max(1, barW + 0.5), Math.max(1, bot - top));
    }

    function trackWaveformNeedsCrossfadeVisualMap(track) {
        if (trackHasPlaybackSegmentOverlap(track)) return true;
        const segments = getTrackSegments(track);
        for (let b = 0; b < segments.length - 1; b++) {
            if (hasManualSegmentFadeAtJoinedBoundary(track, b)) return true;
            if (hasExtendedCrossfadeOverlapAtBoundary(track, b)) return true;
            if (isAutoJoinedBoundaryCrossfadeEligible(track, b)) return true;
        }
        return false;
    }

    function trackSegmentsAreContinuousSameClipChain(track) {
        const segments = getTrackSegments(track);
        if (segments.length <= 1) return false;
        const clip0 = segments[0].clipId || getSegmentClipId(track, 0);
        for (let i = 1; i < segments.length; i++) {
            const clip = segments[i].clipId || getSegmentClipId(track, i);
            if (clip !== clip0) return false;
            if (!isSegmentBoundaryJoined(track, i - 1)) return false;
            if (!isSegmentSourceContinuousAtBoundary(track, i - 1)) return false;
        }
        return true;
    }

    function segmentIndexAtMasterTransport(track, transportSec) {
        const segments = getTrackSegments(track);
        const t = Number(transportSec);
        if (!Number.isFinite(t) || !segments.length) return 0;
        for (let i = segments.length - 1; i >= 0; i--) {
            const start = getSegmentPlaybackTimelineStart(track, i);
            const end = getSegmentTimelineEnd(track, i);
            if (t >= start - 0.0005 && t < end + 0.0005) return i;
        }
        return 0;
    }

    /**
     * 波形 1 パス分の gain を前計算（バーごとの mapAllSegmentsAtTransport を避ける）。
     */
    function createWaveformVisualGainState(track) {
        const segments = getTrackSegments(track);
        const n = segments.length;
        if (!n) {
            return { simple: true, uniform: 1, at: () => 1 };
        }

        const segGain = [];
        const playStart = [];
        const playEnd = [];
        const fadeInSec = [];
        const fadeOutSec = [];
        const needsCrossfade = trackWaveformNeedsCrossfadeVisualMap(track);
        let needsManualDisplay = false;
        let uniformGain = null;

        for (let i = 0; i < n; i++) {
            const g = getSegmentGainLinear(track, i);
            segGain.push(g);
            playStart.push(getSegmentPlaybackTimelineStart(track, i));
            playEnd.push(getSegmentTimelineEnd(track, i));
            fadeInSec.push(getSegmentFadeDurationSec(track, i, 'in'));
            fadeOutSec.push(getSegmentFadeDurationSec(track, i, 'out'));
            if (fadeInSec[i] > 0.0005 || fadeOutSec[i] > 0.0005) {
                needsManualDisplay = true;
            }
            if (uniformGain === null) uniformGain = g;
            else if (Math.abs(uniformGain - g) > 0.001) uniformGain = NaN;
        }
        for (let b = 0; b < n - 1; b++) {
            if (hasManualSegmentFadeAtJoinedBoundary(track, b)) {
                needsManualDisplay = true;
                break;
            }
        }

        const simple =
            !needsCrossfade && !needsManualDisplay && Number.isFinite(uniformGain);

        if (simple) {
            return {
                simple: true,
                uniform: uniformGain,
                at: () => uniformGain,
            };
        }

        const crossfadeCache = new Map();

        function crossfadeAt(segmentIndex, transportSec) {
            if (!needsCrossfade) return 1;
            const bucket = Math.round(Number(transportSec) * 500);
            const key = segmentIndex + ':' + bucket;
            if (crossfadeCache.has(key)) return crossfadeCache.get(key);
            const hits = mapAllSegmentsAtTransport(track, transportSec, {
                forPlayback: true,
            });
            let v = 1;
            if (hits.length > 1) {
                const pos = hits.findIndex((h) => h.segmentIndex === segmentIndex);
                if (
                    pos >= 0 &&
                    typeof computeEqualPowerCrossfadeGainsForGroup === 'function'
                ) {
                    const gains = computeEqualPowerCrossfadeGainsForGroup(
                        hits,
                        transportSec,
                        {
                            groupBySlot: false,
                            sameSlotOnly: false,
                            trackRefFromHit: () => track,
                        },
                    );
                    v = Math.max(0, gains.get(hits[pos].key) ?? 1);
                }
            }
            crossfadeCache.set(key, v);
            return v;
        }

        return {
            simple: false,
            uniform: null,
            at(segmentIndex, transportSec) {
                const manualG = computeManualJoinedBoundaryFadeLinearForDisplay(
                    track,
                    segmentIndex,
                    transportSec,
                );
                if (manualG != null) return manualG * segGain[segmentIndex];
                let gIn = 1;
                let gOut = 1;
                const t = transportSec;
                const i = segmentIndex;
                if (fadeInSec[i] > 0.0005 && t <= playStart[i] + fadeInSec[i]) {
                    gIn = segmentFadeCurve((t - playStart[i]) / fadeInSec[i]);
                }
                if (fadeOutSec[i] > 0.0005 && t >= playEnd[i] - fadeOutSec[i]) {
                    gOut = segmentFadeCurve((playEnd[i] - t) / fadeOutSec[i]);
                }
                return crossfadeAt(i, t) * gIn * gOut * segGain[i];
            },
        };
    }

    /** 再生ミックスと同じ等パワー・重なり（波形振幅表示用） */
    function computeSegmentCrossfadeVisualGain(track, segmentIndex, transportSec) {
        const manualG = computeManualJoinedBoundaryFadeLinearForDisplay(
            track,
            segmentIndex,
            transportSec,
        );
        if (manualG != null) return manualG;
        if (!trackWaveformNeedsCrossfadeVisualMap(track)) return 1;
        const hits = mapAllSegmentsAtTransport(track, transportSec, {
            forPlayback: true,
        });
        if (hits.length <= 1) return 1;
        const pos = hits.findIndex((h) => h.segmentIndex === segmentIndex);
        if (pos < 0) return 1;
        if (typeof computeEqualPowerCrossfadeGainsForGroup !== 'function') return 1;
        const gains = computeEqualPowerCrossfadeGainsForGroup(hits, transportSec, {
            groupBySlot: false,
            sameSlotOnly: false,
            trackRefFromHit: () => track,
        });
        return Math.max(0, gains.get(hits[pos].key) ?? 1);
    }

    function getSegmentPeaksForDraw(slot, clipId) {
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        const tp = tr && tr.peaks ? tr.peaks : null;
        if (typeof getExtraTrackClipPeaks === 'function') {
            const cp = getExtraTrackClipPeaks(slot, clipId);
            if (cp && cp.length) {
                if (!tp || cp.length >= tp.length) return cp;
            }
        }
        return tp;
    }

    function viewportPeaksCoverMasterTime(vp, masterSec) {
        if (!vp) return false;
        if (masterSec + 1e-9 < vp.masterStartSec || masterSec - 1e-9 > vp.masterEndSec) {
            return false;
        }
        if (!vp.segments || !vp.segments.length) {
            return !!(vp.peaks && vp.peaks.length);
        }
        for (let i = 0; i < vp.segments.length; i++) {
            const s = vp.segments[i];
            if (
                masterSec + 1e-9 >= s.masterStartSec &&
                masterSec - 1e-9 <= s.masterEndSec &&
                s.peaks &&
                s.peaks.length
            ) {
                return true;
            }
        }
        return false;
    }

    function drawRegionViewportPeaks(ctx, wCss, hCss, master, vp, grad, track) {
        if (!vp || !vp.segments || !vp.segments.length || !(master > 0) || !track) {
            return;
        }
        const slot = track.slot;
        const mid = hCss * 0.5;
        const bg =
            typeof TIMELINE_LANE_TRACK_BG !== 'undefined'
                ? TIMELINE_LANE_TRACK_BG
                : '#161820';
        const gradFill = grad || '#ffffff';
        const drawOpt = { viewportPeaks: vp };

        for (let si = 0; si < vp.segments.length; si++) {
            const s = vp.segments[si];
            if (!s.peaks || !s.peaks.length) continue;
            const segDur = s.masterEndSec - s.masterStartSec;
            if (!(segDur > 1e-9)) continue;
            const x0 = (s.masterStartSec / master) * wCss;
            const x1 = (s.masterEndSec / master) * wCss;
            const drawW = x1 - x0;
            if (!(drawW > 0.5)) continue;
            ctx.fillStyle = bg;
            ctx.fillRect(x0, 0, drawW, hCss);
        }

        ctx.fillStyle = gradFill;
        for (let si = 0; si < vp.segments.length; si++) {
            const s = vp.segments[si];
            if (!s.peaks || !s.peaks.length) continue;
            const segDur = s.masterEndSec - s.masterStartSec;
            if (!(segDur > 1e-9)) continue;
            const x0 = (s.masterStartSec / master) * wCss;
            const x1 = (s.masterEndSec / master) * wCss;
            const drawW = x1 - x0;
            if (!(drawW > 0.5)) continue;
            const barW = drawW / s.peaks.length;
            const segIdx =
                typeof s.segmentIndex === 'number' && s.segmentIndex >= 0 ? s.segmentIndex : si;
            for (let p = 0; p < s.peaks.length; p++) {
                const x = x0 + p * barW;
                const barTransport =
                    s.masterStartSec + ((p + 0.5) / s.peaks.length) * segDur;
                const hideBefore = getSegmentWaveformHideBeforeTimeline(track, segIdx);
                if (barTransport < hideBefore - 0.0005) continue;
                drawWaveformBarAtTransport(
                    ctx,
                    track,
                    slot,
                    x,
                    barW,
                    mid,
                    barTransport,
                    s.peaks[p],
                    segIdx,
                    drawOpt,
                );
            }
        }
    }

    function buildSegmentViewportPeakEntry(track, tr, segmentIndex, spec, viewportDur) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return null;
        const segT0 = getSegmentTimelineStart(track, segmentIndex);
        const segEnd = getSegmentTimelineEnd(track, segmentIndex);
        // 表示はリージョン In 以降（結合境界のクロスフェード手前は含めない）
        let t0 = Math.max(
            spec.masterStartSec,
            getSegmentWaveformVisibleTimelineStart(track, segmentIndex),
        );
        let t1 = Math.min(segEnd, spec.masterEndSec);
        if (t1 <= t0 + 1e-9) return null;

        const srcStart = segmentWaveformSourceSecAtTransport(track, segmentIndex, t0);
        const srcEnd = segmentWaveformSourceSecAtTransport(track, segmentIndex, t1);
        const clipId = seg.clipId || getSegmentClipId(track, segmentIndex);
        let buf = tr.buffer;
        if (typeof getExtraTrackClipBuffer === 'function') {
            buf = getExtraTrackClipBuffer(tr, clipId) || buf;
        }
        if (!buf) return null;

        const bars = Math.max(1, Math.round(spec.barCount * ((t1 - t0) / viewportDur)));
        let peaks = [];
        if (typeof peaksForViewportRange === 'function') {
            const bufId =
                (typeof bufferPeakId === 'function' ? bufferPeakId(buf) : 0) +
                (track && track.slot >= 0 ? (track.slot + 1) * 1000003 : 0);
            peaks = peaksForViewportRange(
                buf,
                tr.peakPyramid,
                srcStart,
                srcEnd,
                bars,
                bufId,
            );
        } else if (typeof peaksFromBufferRange === 'function') {
            peaks = peaksFromBufferRange(buf, srcStart, srcEnd, bars);
        }
        if (!peaks.length) return null;
        return { masterStartSec: t0, masterEndSec: t1, peaks, segmentIndex };
    }

    function segmentHasViewportPeaksForDraw(vp, segmentIndex) {
        if (!vp || !vp.segments || !vp.segments.length) return false;
        for (let j = 0; j < vp.segments.length; j++) {
            const s = vp.segments[j];
            if (
                s.segmentIndex === segmentIndex &&
                s.peaks &&
                s.peaks.length > 0 &&
                s.masterEndSec > s.masterStartSec + 1e-9
            ) {
                return true;
            }
        }
        return false;
    }

    function resolveRegionEditViewportPeakIndices(opt) {
        if (opt && Array.isArray(opt.affectedSegmentIndices) && opt.affectedSegmentIndices.length) {
            return opt.affectedSegmentIndices.filter(
                (i) => typeof i === 'number' && i >= 0,
            );
        }
        if (opt && typeof opt.segmentIndex === 'number' && opt.segmentIndex >= 0) {
            return [opt.segmentIndex];
        }
        return null;
    }

    /** viewport peaks が現在のセグメント境界をはみ出していないか */
    function viewportPeaksMatchTrackSegments(track, vp) {
        const segments = getTrackSegments(track);
        if (!segments.length) {
            return !(vp && vp.segments && vp.segments.length);
        }
        if (!vp || !vp.segments || !vp.segments.length) return false;
        const crossfadeSlack = JOINED_BOUNDARY_CROSSFADE_SEC + 0.05;
        for (let i = 0; i < vp.segments.length; i++) {
            const s = vp.segments[i];
            if (!s.peaks || !s.peaks.length) continue;
            if (!(s.masterEndSec > s.masterStartSec + 1e-9)) continue;
            const idx =
                typeof s.segmentIndex === 'number' && s.segmentIndex >= 0
                    ? s.segmentIndex
                    : i;
            if (idx >= segments.length) return false;
            const segEnd = getSegmentTimelineEnd(track, idx);
            const visibleStart = getSegmentWaveformVisibleTimelineStart(track, idx);
            if (s.masterEndSec > segEnd + 0.02) return false;
            if (s.masterStartSec < visibleStart - crossfadeSlack) return false;
        }
        return true;
    }

    /** リージョン編集中: 変更セグメントだけピラミッドから高解像度ピークを即時更新 */
    function refreshExtraTrackViewportPeaksForRegionEdit(slot, opt) {
        if (!(slot >= 0)) return false;
        if (typeof getWaveformViewportHiresSpec !== 'function') return false;
        const spec = getWaveformViewportHiresSpec();
        if (!spec) return false;
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        if (!tr || !tr.buffer) return false;
        const track = { type: 'extra', slot };
        const only = resolveRegionEditViewportPeakIndices(opt);
        const structureChanged = !!(opt && opt.segmentStructureChanged);
        rebuildExtraTrackRegionViewportPeaks(slot, spec, {
            onlySegmentIndices: only,
            merge: !!only && !structureChanged,
        });
        if (!tr.viewportPeaks || !tr.viewportPeaks.segments || !tr.viewportPeaks.segments.length) {
            return false;
        }
        return viewportPeaksMatchTrackSegments(track, tr.viewportPeaks);
    }

    window.refreshExtraTrackViewportPeaksForRegionEdit =
        refreshExtraTrackViewportPeaksForRegionEdit;

    function rebuildExtraTrackRegionViewportPeaks(slot, spec, opt) {
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        if (!tr) return;
        const merge = !!(opt && opt.merge);
        if (!merge) {
            tr.viewportPeaks = null;
        }
        if (!spec) return;

        const track = { type: 'extra', slot };
        const viewportDur = spec.masterEndSec - spec.masterStartSec;
        if (!(viewportDur > 1e-9)) return;
        if (typeof peaksFromBufferRange !== 'function') return;

        const segments = getTrackSegments(track);
        const onlyIndices =
            opt && Array.isArray(opt.onlySegmentIndices) ? opt.onlySegmentIndices : null;

        if (onlyIndices && onlyIndices.length && segments.length) {
            let outSegs =
                merge && tr.viewportPeaks && tr.viewportPeaks.segments
                    ? tr.viewportPeaks.segments.slice()
                    : [];
            for (let k = 0; k < onlyIndices.length; k++) {
                const segIdx = onlyIndices[k];
                const entry = buildSegmentViewportPeakEntry(
                    track,
                    tr,
                    segIdx,
                    spec,
                    viewportDur,
                );
                const existing = outSegs.findIndex((s) => s.segmentIndex === segIdx);
                if (entry) {
                    if (existing >= 0) outSegs[existing] = entry;
                    else outSegs.push(entry);
                } else if (existing >= 0) {
                    outSegs.splice(existing, 1);
                }
            }
            outSegs = outSegs.filter((s) => {
                const idx =
                    typeof s.segmentIndex === 'number' && s.segmentIndex >= 0
                        ? s.segmentIndex
                        : -1;
                return idx >= 0 && idx < segments.length;
            });
            if (outSegs.length) {
                tr.viewportPeaks = {
                    masterStartSec: spec.masterStartSec,
                    masterEndSec: spec.masterEndSec,
                    segments: outSegs,
                };
            } else {
                tr.viewportPeaks = null;
            }
            return;
        }

        if (!segments.length) {
            const t0Track = getTrackTimelineStartSec(track);
            const fullDur = getTrackSourceDurationSec(track);
            if (!fullDur || !tr.buffer) return;
            const trackEnd = t0Track + fullDur;
            const t0 = Math.max(t0Track, spec.masterStartSec);
            const t1 = Math.min(trackEnd, spec.masterEndSec);
            if (t1 <= t0 + 1e-9) return;
            const srcStart = t0 - t0Track;
            const srcEnd = t1 - t0Track;
            const bars = Math.max(1, Math.round(spec.barCount * ((t1 - t0) / viewportDur)));
            let peaks = [];
            if (typeof peaksForViewportRange === 'function') {
                const bufId =
                    (typeof bufferPeakId === 'function' ? bufferPeakId(tr.buffer) : 0) +
                    (slot >= 0 ? (slot + 1) * 1000003 : 0);
                peaks = peaksForViewportRange(
                    tr.buffer,
                    tr.peakPyramid,
                    srcStart,
                    srcEnd,
                    bars,
                    bufId,
                );
            } else if (typeof peaksFromBufferRange === 'function') {
                peaks = peaksFromBufferRange(tr.buffer, srcStart, srcEnd, bars);
            }
            if (!peaks.length) return;
            tr.viewportPeaks = {
                masterStartSec: spec.masterStartSec,
                masterEndSec: spec.masterEndSec,
                segments: [{ masterStartSec: t0, masterEndSec: t1, peaks }],
            };
            return;
        }

        const outSegs = [];
        for (let i = 0; i < segments.length; i++) {
            const entry = buildSegmentViewportPeakEntry(track, tr, i, spec, viewportDur);
            if (entry) outSegs.push(entry);
        }

        if (outSegs.length) {
            tr.viewportPeaks = {
                masterStartSec: spec.masterStartSec,
                masterEndSec: spec.masterEndSec,
                segments: outSegs,
            };
        } else {
            tr.viewportPeaks = null;
        }
    }

