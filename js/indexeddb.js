    // IndexedDB による動画セッション保存
    function openIdb() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                reject(new Error('IndexedDB not supported'));
                return;
            }
            const req = indexedDB.open(IDB_NAME, IDB_VER);
            req.onerror = () => reject(req.error || new Error('IDB open error'));
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE);
                }
            };
        });
    }

    let lastSessionRowSnapshot = null;
    let sessionSaveStampSeq = 0;
    const regionPersistFloorBySlot = {};
    const regionPersistFloorPayloadBySlot = {};
    const regionPersistEpochSavedBySlot = {};

    function cacheLastSessionRow(row) {
        if (!row || typeof row !== 'object') return;
        lastSessionRowSnapshot = deepCloneForPersist(row);
        if (Number.isFinite(row.__saveStamp)) {
            sessionSaveStampSeq = Math.max(sessionSaveStampSeq, Number(row.__saveStamp) || 0);
        }
    }

    function rememberRegionPersistFloorFromEntry(slot, entry, playbackEntry) {
        if (!(slot >= 0) || !entry) return;
        const count = regionSegmentsCountFromEntry(entry);
        const prev = Number(regionPersistFloorBySlot[slot] || 0);
        if (count < prev) return;
        regionPersistFloorBySlot[slot] = count;
        regionPersistFloorPayloadBySlot[slot] = {
            entry: deepCloneForPersist(entry),
            playback: deepCloneForPersist(playbackEntry || null),
        };
    }

    function updateRegionPersistFloorFromRow(row) {
        if (!row || !Array.isArray(row.extraTracks)) return;
        for (let i = 0; i < row.extraTracks.length; i++) {
            const entry = row.extraTracks[i];
            if (!entry || !(entry.slot >= 0)) continue;
            const playbackEntry = getPlaybackRegionExtraBySlot(row, entry.slot);
            rememberRegionPersistFloorFromEntry(entry.slot, entry, playbackEntry);
        }
    }

    function idbPut(key, val) {
        return openIdb().then(
            (db) =>
                new Promise((resolve, reject) => {
                    const tx = db.transaction(IDB_STORE, 'readwrite');
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error || new Error('IDB put'));
                    tx.objectStore(IDB_STORE).put(val, key);
                })
        );
    }

    function idbGet(key) {
        return openIdb().then(
            (db) =>
                new Promise((resolve, reject) => {
                    const tx = db.transaction(IDB_STORE, 'readonly');
                    const r = tx.objectStore(IDB_STORE).get(key);
                    r.onsuccess = () => resolve(r.result);
                    r.onerror = () => reject(r.error || new Error('IDB get'));
                })
        );
    }

    function deepCloneForPersist(value) {
        if (!value || typeof value !== 'object') return value;
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return value;
        }
    }

    function regionSegmentsCountFromEntry(entry) {
        return Array.isArray(entry && entry.regionSegments) ? entry.regionSegments.length : 0;
    }

    function getPlaybackRegionExtraBySlot(row, slot) {
        if (
            !row ||
            !row.playbackRegion ||
            !Array.isArray(row.playbackRegion.extra) ||
            !(slot >= 0)
        ) {
            return null;
        }
        return row.playbackRegion.extra.find((e) => e && e.slot === slot) || null;
    }

    function upsertPlaybackRegionExtraForSlot(row, entry) {
        if (!row || !entry || !(entry.slot >= 0)) return;
        if (!row.playbackRegion || typeof row.playbackRegion !== 'object') {
            row.playbackRegion = { extra: [] };
        }
        if (!Array.isArray(row.playbackRegion.extra)) {
            row.playbackRegion.extra = [];
        }
        row.playbackRegion.extra = row.playbackRegion.extra.filter(
            (e) => !e || e.slot !== entry.slot,
        );
        row.playbackRegion.extra.push(entry);
    }

    function protectRegionShrinkOnPersist(row, prevRow) {
        if (
            !row ||
            !Array.isArray(row.extraTracks) ||
            !prevRow ||
            !Array.isArray(prevRow.extraTracks)
        ) {
            return;
        }
        for (let i = 0; i < prevRow.extraTracks.length; i++) {
            const prev = prevRow.extraTracks[i];
            if (!prev || !(prev.slot >= 0)) continue;
            const slot = prev.slot;
            const nextIdx = row.extraTracks.findIndex((e) => e && e.slot === slot);
            if (nextIdx < 0) continue;
            const next = row.extraTracks[nextIdx];
            const prevCount = regionSegmentsCountFromEntry(prev);
            const nextCount = regionSegmentsCountFromEntry(next);
            const floorCount = Number(regionPersistFloorBySlot[slot] || 0);
            if (prevCount <= nextCount) continue;
            const allowShrink =
                typeof canPersistRegionShrink === 'function' && canPersistRegionShrink(slot);
            if (allowShrink) continue;
            row.extraTracks[nextIdx] = deepCloneForPersist(prev);
            const prevPr = getPlaybackRegionExtraBySlot(prevRow, slot);
            if (prevPr) {
                upsertPlaybackRegionExtraForSlot(row, deepCloneForPersist(prevPr));
            }
            if (floorCount > prevCount) {
                const floorPayload = regionPersistFloorPayloadBySlot[slot];
                if (floorPayload && floorPayload.entry) {
                    row.extraTracks[nextIdx] = deepCloneForPersist(floorPayload.entry);
                    if (floorPayload.playback) {
                        upsertPlaybackRegionExtraForSlot(
                            row,
                            deepCloneForPersist(floorPayload.playback),
                        );
                    }
                }
            }
        }
    }

    function keepPreviousRegionsWhenNoNewRegionEdit(row, prevRow) {
        if (
            !row ||
            !Array.isArray(row.extraTracks) ||
            !prevRow ||
            !Array.isArray(prevRow.extraTracks)
        ) {
            return;
        }
        for (let i = 0; i < row.extraTracks.length; i++) {
            const next = row.extraTracks[i];
            if (!next || !(next.slot >= 0)) continue;
            const slot = next.slot;
            const prev = prevRow.extraTracks.find((e) => e && e.slot === slot);
            if (!prev) continue;
            const curEpoch =
                typeof getRegionPersistEpoch === 'function' ? getRegionPersistEpoch(slot) : 0;
            const savedEpoch = Number(regionPersistEpochSavedBySlot[slot] || 0);
            const hasNewRegionEdit = curEpoch > savedEpoch;
            if (hasNewRegionEdit) continue;
            const nextCount = regionSegmentsCountFromEntry(next);
            const prevCount = regionSegmentsCountFromEntry(prev);
            if (nextCount === prevCount) continue;
            const prevSegments = Array.isArray(prev.regionSegments)
                ? deepCloneForPersist(prev.regionSegments)
                : null;
            if (prevSegments && prevSegments.length) {
                next.regionSegments = prevSegments;
            } else {
                delete next.regionSegments;
            }
            if (Number.isFinite(prev.regionHeadPadSec)) {
                next.regionHeadPadSec = prev.regionHeadPadSec;
            } else {
                delete next.regionHeadPadSec;
            }
            if (Number.isFinite(prev.regionTimelineInSec)) {
                next.regionTimelineInSec = prev.regionTimelineInSec;
            } else {
                delete next.regionTimelineInSec;
            }
            if (Number.isFinite(prev.regionLeadPadSec)) {
                next.regionLeadPadSec = prev.regionLeadPadSec;
            } else {
                delete next.regionLeadPadSec;
            }
            const prevPr = getPlaybackRegionExtraBySlot(prevRow, slot);
            if (prevPr) {
                upsertPlaybackRegionExtraForSlot(row, deepCloneForPersist(prevPr));
            }
        }
    }

    function enforceRegionPersistFloor(row) {
        if (!row || !Array.isArray(row.extraTracks)) return;
        for (let i = 0; i < row.extraTracks.length; i++) {
            const next = row.extraTracks[i];
            if (!next || !(next.slot >= 0)) continue;
            const slot = next.slot;
            const floorCount = Number(regionPersistFloorBySlot[slot] || 0);
            if (!(floorCount > 0)) continue;
            const nextCount = regionSegmentsCountFromEntry(next);
            if (nextCount >= floorCount) continue;
            const allowShrink =
                typeof canPersistRegionShrink === 'function' && canPersistRegionShrink(slot);
            if (allowShrink) {
                regionPersistFloorBySlot[slot] = nextCount;
                const playback = getPlaybackRegionExtraBySlot(row, slot);
                regionPersistFloorPayloadBySlot[slot] = {
                    entry: deepCloneForPersist(next),
                    playback: deepCloneForPersist(playback),
                };
                continue;
            }
            const floorPayload = regionPersistFloorPayloadBySlot[slot];
            if (floorPayload && floorPayload.entry) {
                row.extraTracks[i] = deepCloneForPersist(floorPayload.entry);
                if (floorPayload.playback) {
                    upsertPlaybackRegionExtraForSlot(row, deepCloneForPersist(floorPayload.playback));
                }
            }
        }
    }

    function regionCountsBySlotFromRow(row) {
        const out = {};
        if (!row || typeof row !== 'object') return out;
        if (Array.isArray(row.extraTracks)) {
            for (let i = 0; i < row.extraTracks.length; i++) {
                const e = row.extraTracks[i];
                if (!e || !(e.slot >= 0)) continue;
                if (!out[e.slot]) out[e.slot] = { entry: 0, playback: 0 };
                out[e.slot].entry = regionSegmentsCountFromEntry(e);
            }
        }
        if (row.playbackRegion && Array.isArray(row.playbackRegion.extra)) {
            for (let i = 0; i < row.playbackRegion.extra.length; i++) {
                const e = row.playbackRegion.extra[i];
                if (!e || !(e.slot >= 0)) continue;
                if (!out[e.slot]) out[e.slot] = { entry: 0, playback: 0 };
                out[e.slot].playback = Array.isArray(e.segments) ? e.segments.length : 0;
            }
        }
        return out;
    }

    function formatRegionCountsForLog(row) {
        const counts = regionCountsBySlotFromRow(row);
        const slots = Object.keys(counts)
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n))
            .sort((a, b) => a - b);
        if (!slots.length) return 'none';
        return slots
            .map((slot) => {
                const c = counts[slot];
                return 'Ex' + (slot + 1) + '(entry ' + c.entry + ', playback ' + c.playback + ')';
            })
            .join(', ');
    }

    function getPinnedRegionBySlot(row, slot) {
        if (!row || !row.__regionPinnedBySlot || !(slot >= 0)) return null;
        const key = String(slot);
        const pin = row.__regionPinnedBySlot[key];
        if (!pin || !Array.isArray(pin.entrySegments) || !pin.entrySegments.length) return null;
        return pin;
    }

    function updatePinnedRegionBySlot(row, slot, entry, playbackEntry) {
        if (!row || !(slot >= 0) || !entry) return;
        const segs = Array.isArray(entry.regionSegments) ? entry.regionSegments : null;
        if (!segs || !segs.length) return;
        if (!row.__regionPinnedBySlot || typeof row.__regionPinnedBySlot !== 'object') {
            row.__regionPinnedBySlot = {};
        }
        row.__regionPinnedBySlot[String(slot)] = {
            entrySegments: deepCloneForPersist(segs),
            entryRegionHeadPadSec: Number.isFinite(entry.regionHeadPadSec)
                ? entry.regionHeadPadSec
                : undefined,
            entryRegionTimelineInSec: Number.isFinite(entry.regionTimelineInSec)
                ? entry.regionTimelineInSec
                : undefined,
            entryRegionLeadPadSec: Number.isFinite(entry.regionLeadPadSec)
                ? entry.regionLeadPadSec
                : undefined,
            playback: deepCloneForPersist(playbackEntry || null),
            count: segs.length,
        };
    }

    function applyPinnedRegionIfNeeded(row, slot, entry, allowShrink) {
        if (!row || !entry || !(slot >= 0)) return;
        const pin = getPinnedRegionBySlot(row, slot);
        if (!pin) return;
        const nextCount = regionSegmentsCountFromEntry(entry);
        const pinCount = Number(pin.count || 0);
        if (!(pinCount > nextCount) || allowShrink) return;
        entry.regionSegments = deepCloneForPersist(pin.entrySegments);
        if (Number.isFinite(pin.entryRegionHeadPadSec)) {
            entry.regionHeadPadSec = pin.entryRegionHeadPadSec;
        } else {
            delete entry.regionHeadPadSec;
        }
        if (Number.isFinite(pin.entryRegionTimelineInSec)) {
            entry.regionTimelineInSec = pin.entryRegionTimelineInSec;
        } else {
            delete entry.regionTimelineInSec;
        }
        if (Number.isFinite(pin.entryRegionLeadPadSec)) {
            entry.regionLeadPadSec = pin.entryRegionLeadPadSec;
        } else {
            delete entry.regionLeadPadSec;
        }
        if (pin.playback) {
            upsertPlaybackRegionExtraForSlot(row, deepCloneForPersist(pin.playback));
        }
    }

    function schedulePersistSession() {
        if (sessionRestoreInProgress) return;
        clearTimeout(persistSessionTimer);
        persistSessionTimer = setTimeout(() => {
            persistSessionTimer = null;
            persistSessionToStorage().catch((e) => {
                writeLog('Session save failed: ' + (e && e.message ? e.message : String(e)));
            });
        }, 450);
    }

    async function flushPersistSessionNow() {
        clearTimeout(persistSessionTimer);
        persistSessionTimer = null;
        await whenSessionRestoreIdle();
        await persistSessionToStorage();
    }

    /** 起動復元・Import Review などセッション復元を直列化 */
    let sessionRestoreQueue = Promise.resolve();
    /** apply 完了後の Ex デコード待ち・ロック解除中 */
    let sessionRestoreTeardownPending = false;

    function whenSessionRestoreIdle() {
        return sessionRestoreQueue;
    }

    function runSerializedSessionRestore(task) {
        const run = async () => {
            sessionRestoreListenersArmed = false;
            sessionRestoreInProgress = true;
            try {
                return await task();
            } finally {
                sessionRestoreInProgress = false;
                if (typeof updateSessionAllClearButton === 'function') {
                    updateSessionAllClearButton();
                }
                if (typeof schedulePersistSession === 'function') {
                    schedulePersistSession();
                }
            }
        };
        const p = sessionRestoreQueue.then(async () => {
            try {
                return await run();
            } finally {
                sessionRestoreTeardownPending = true;
                try {
                    if (typeof waitForSessionWaveformsAndEndRestoreLock === 'function') {
                        await waitForSessionWaveformsAndEndRestoreLock();
                    }
                } finally {
                    sessionRestoreTeardownPending = false;
                }
            }
        });
        sessionRestoreQueue = p.catch(() => {});
        return p;
    }

    window.whenSessionRestoreIdle = whenSessionRestoreIdle;
    window.flushPersistSessionNow = flushPersistSessionNow;
    window.isSessionRestoreInProgress = function () {
        return !!sessionRestoreInProgress;
    };
    window.isSessionRestoreTeardownPending = function () {
        return !!sessionRestoreTeardownPending;
    };

    const extraTrackPersistReqSeqBySlot = {};

    /** Ex トラック1本を即時マージ保存（リロード直前の欠落防止） */
    async function persistExtraTrackEntryToSession(entry) {
        const maxExtra = getExtraTrackCount();
        if (!window.indexedDB || !entry || entry.slot < 0 || entry.slot >= maxExtra) return;
        const slot = entry.slot;
        const reqSeq = (extraTrackPersistReqSeqBySlot[slot] || 0) + 1;
        extraTrackPersistReqSeqBySlot[slot] = reqSeq;
        if (typeof getExtraTrackPersistEntry === 'function') {
            const fresh = getExtraTrackPersistEntry(slot);
            if (fresh) entry = fresh;
        }
        if (!entry || !entry.blob || (entry.byteLength || entry.blob.size || 0) < 1) return;
        let row;
        try {
            row = await idbGet(IDB_KEY_LAST);
        } catch (e) {
            row = null;
        }
        if ((!row || typeof row !== 'object') && lastSessionRowSnapshot) {
            row = deepCloneForPersist(lastSessionRowSnapshot);
        }
        writeLog(
            'Session debug: pre-merge row regions = ' + formatRegionCountsForLog(row),
        );
        if (extraTrackPersistReqSeqBySlot[slot] !== reqSeq) return;
        if (!row || typeof row !== 'object') {
            row = { v: 4, audioOnlySession: true, extraTracks: [] };
        }
        const nextStamp = sessionSaveStampSeq + 1;
        row.__saveStamp = nextStamp;
        if (typeof getMarkersSnapshot === 'function') {
            const mem = getMarkersSnapshot();
            if (mem && mem.length) {
                row.markers = mem;
            } else if (sessionRowHasMarkers(row)) {
                /* 既存行の markers は維持（Ex 単体保存で消さない） */
            } else {
                delete row.markers;
            }
        }
        if (typeof getMarkerMemoSnapshot === 'function') {
            const memo = getMarkerMemoSnapshot();
            if (String(memo || '').trim()) {
                row.markerMemo = memo;
            } else if (sessionRowHasMarkerMemo(row)) {
                /* 既存行の markerMemo は維持 */
            } else {
                delete row.markerMemo;
            }
        }
        let persistedRegionSegments = 0;
        if (typeof getPlaybackRegionPersistSnapshot === 'function') {
            const playbackRegion = getPlaybackRegionPersistSnapshot();
            if (playbackRegion) {
                row.playbackRegion = playbackRegion;
                if (Array.isArray(playbackRegion.extra)) {
                    const hit = playbackRegion.extra.find(
                        (e) => e && e.slot === entry.slot && Array.isArray(e.segments),
                    );
                    if (hit) persistedRegionSegments = hit.segments.length;
                }
            } else {
                delete row.playbackRegion;
            }
        }
        const entryRegionSegments = Array.isArray(entry.regionSegments)
            ? entry.regionSegments.length
            : 0;
        if (entryRegionSegments > 0) {
            if (!row.playbackRegion || typeof row.playbackRegion !== 'object') {
                row.playbackRegion = { extra: [] };
            }
            if (!Array.isArray(row.playbackRegion.extra)) {
                row.playbackRegion.extra = [];
            }
            const forced = {
                slot,
                segments: entry.regionSegments.map((seg) =>
                    seg && typeof seg === 'object' ? { ...seg } : seg,
                ),
            };
            if (Number.isFinite(entry.regionHeadPadSec)) {
                forced.headPadSec = entry.regionHeadPadSec;
            }
            if (Number.isFinite(entry.regionTimelineInSec)) {
                forced.regionTimelineInSec = entry.regionTimelineInSec;
            }
            if (Number.isFinite(entry.regionLeadPadSec)) {
                forced.regionLeadPadSec = entry.regionLeadPadSec;
            }
            row.playbackRegion.extra = row.playbackRegion.extra.filter(
                (e) => !e || e.slot !== slot,
            );
            row.playbackRegion.extra.push(forced);
            persistedRegionSegments = forced.segments.length;
        }
        const currentPlayback = getPlaybackRegionExtraBySlot(row, slot);
        rememberRegionPersistFloorFromEntry(slot, entry, currentPlayback);
        enforceRegionPersistFloor(row);
        let prevRegionSegments = 0;
        let prevEntry = null;
        if (Array.isArray(row.extraTracks)) {
            prevEntry = row.extraTracks.find((e) => e && e.slot === slot) || null;
            prevRegionSegments = Array.isArray(prevEntry && prevEntry.regionSegments)
                ? prevEntry.regionSegments.length
                : 0;
        }
        if (
            prevRegionSegments > entryRegionSegments &&
            typeof canPersistRegionShrink === 'function' &&
            !canPersistRegionShrink(slot)
        ) {
            entry = prevEntry || entry;
        }
        const allowShrinkNow =
            typeof canPersistRegionShrink === 'function' && canPersistRegionShrink(slot);
        applyPinnedRegionIfNeeded(row, slot, entry, allowShrinkNow);
        if (!row.mBlob) {
            row.audioOnlySession = true;
            if (!Array.isArray(row.extraTracks)) row.extraTracks = [];
            row.extraTracks = row.extraTracks.filter((e) => !e || e.slot !== entry.slot);
            row.extraTracks.push(entry);
            row.v = typeof row.v === 'number' ? row.v : 4;
            if (extraTrackPersistReqSeqBySlot[slot] !== reqSeq) return;
            await idbPut(IDB_KEY_LAST, row);
            cacheLastSessionRow(row);
            updateRegionPersistFloorFromRow(row);
            updatePinnedRegionBySlot(row, slot, entry, getPlaybackRegionExtraBySlot(row, slot));
            writeLog(
                'Session debug: post-merge row regions = ' + formatRegionCountsForLog(row),
            );
            writeLog('Session debug: saved stamp = ' + nextStamp);
            if (extraTrackPersistReqSeqBySlot[slot] !== reqSeq) return;
            writeLog(
                'Session: extra audio ' +
                    (entry.slot + 1) +
                    ' saved (' +
                    (entry.byteLength || entry.blob.size || 0) +
                    ' bytes, entry regions ' +
                    entryRegionSegments +
                    ', playback regions ' +
                    persistedRegionSegments +
                    ')',
            );
            return;
        }
        if (!Array.isArray(row.extraTracks)) row.extraTracks = [];
        row.extraTracks = row.extraTracks.filter((e) => !e || e.slot !== entry.slot);
        row.extraTracks.push(entry);
        row.v = typeof row.v === 'number' ? row.v : 4;
        if (extraTrackPersistReqSeqBySlot[slot] !== reqSeq) return;
        await idbPut(IDB_KEY_LAST, row);
        cacheLastSessionRow(row);
        updateRegionPersistFloorFromRow(row);
        updatePinnedRegionBySlot(row, slot, entry, getPlaybackRegionExtraBySlot(row, slot));
        writeLog(
            'Session debug: post-merge row regions = ' + formatRegionCountsForLog(row),
        );
        writeLog('Session debug: saved stamp = ' + nextStamp);
        if (extraTrackPersistReqSeqBySlot[slot] !== reqSeq) return;
        writeLog(
            'Session: extra audio ' +
                (entry.slot + 1) +
                ' saved (' +
                (entry.byteLength || entry.blob.size || 0) +
                ' bytes, entry regions ' +
                entryRegionSegments +
                ', playback regions ' +
                persistedRegionSegments +
                ')',
        );
    }

    async function removeExtraTrackFromSession(slot) {
        const maxExtra = getExtraTrackCount();
        if (!window.indexedDB || slot < 0 || slot >= maxExtra) return;
        let row;
        try {
            row = await idbGet(IDB_KEY_LAST);
        } catch (_) {
            return;
        }
        if (!row || !Array.isArray(row.extraTracks)) return;
        row.extraTracks = row.extraTracks.filter((e) => !e || e.slot !== slot);
        await idbPut(IDB_KEY_LAST, row);
    }

    window.persistExtraTrackEntryToSession = persistExtraTrackEntryToSession;
    window.removeExtraTrackFromSession = removeExtraTrackFromSession;

    function extraTrackEntryHasBlob(entry) {
        if (!entry || !entry.blob) return false;
        const n =
            typeof entry.byteLength === 'number'
                ? entry.byteLength
                : entry.blob.size || 0;
        return n > 0;
    }

    function sessionRowHasMarkers(row) {
        return Array.isArray(row.markers) && row.markers.length > 0;
    }

    function sessionRowHasMarkerMemo(row) {
        return !!(row && typeof row.markerMemo === 'string' && row.markerMemo.trim());
    }

    function sessionRowHasRestorableContent(row) {
        if (!row || typeof row !== 'object') return false;
        if (row.mBlob && (row.mBlob.size || 0) > 0) return true;
        if (
            Array.isArray(row.extraTracks) &&
            row.extraTracks.some(extraTrackEntryHasBlob)
        ) {
            return true;
        }
        return sessionRowHasMarkers(row) || sessionRowHasMarkerMemo(row);
    }

    async function mergePrevExtraTracksDuringRestore(row) {
        if (!sessionRestoreInProgress) return;
        try {
            const prev = await idbGet(IDB_KEY_LAST);
            if (prev && Array.isArray(prev.extraTracks) && prev.extraTracks.length > 0) {
                row.extraTracks = prev.extraTracks;
            }
        } catch (_) {}
    }

    async function mergePrevMarkersDuringRestore(row) {
        if (!sessionRestoreInProgress) return;
        if (sessionRowHasMarkers(row)) return;
        try {
            const prev = await idbGet(IDB_KEY_LAST);
            if (prev && sessionRowHasMarkers(prev)) {
                row.markers = prev.markers;
            }
        } catch (_) {}
    }

    async function mergePrevMarkerMemoDuringRestore(row) {
        if (!sessionRestoreInProgress) return;
        if (sessionRowHasMarkerMemo(row)) return;
        try {
            const prev = await idbGet(IDB_KEY_LAST);
            if (prev && sessionRowHasMarkerMemo(prev)) {
                row.markerMemo = prev.markerMemo;
            }
        } catch (_) {}
    }

    async function attachWaveformSessionFieldsToRow(row) {
        if (typeof getMarkersSnapshot === 'function') {
            const mem = getMarkersSnapshot();
            if (mem && mem.length) {
                row.markers = mem;
            } else if (!sessionRowHasMarkers(row)) {
                row.markers = [];
            }
        }
        if (typeof getMarkerMemoSnapshot === 'function') {
            const memo = getMarkerMemoSnapshot();
            if (String(memo || '').trim()) {
                row.markerMemo = memo;
            } else if (!sessionRowHasMarkerMemo(row)) {
                delete row.markerMemo;
            }
        }
        await mergePrevMarkersDuringRestore(row);
        await mergePrevMarkerMemoDuringRestore(row);
        if (typeof getRangeLoopPersistSnapshot === 'function') {
            const rangeLoop = getRangeLoopPersistSnapshot();
            if (rangeLoop) row.rangeLoop = rangeLoop;
        }
        if (typeof getPlaybackRegionPersistSnapshot === 'function') {
            const playbackRegion = getPlaybackRegionPersistSnapshot();
            if (playbackRegion) row.playbackRegion = playbackRegion;
        }
        if (typeof getMixPersistSnapshot === 'function') {
            row.mix = getMixPersistSnapshot();
        }
        if (typeof getExtraTracksPersistSnapshot === 'function') {
            const extra = getExtraTracksPersistSnapshot();
            if (extra && extra.length > 0) {
                row.extraTracks = extra;
            } else {
                await mergePrevExtraTracksDuringRestore(row);
            }
        }
        /* スペクトラム・メーター床は localStorage のユーザー設定のみ（セッションに含めない） */
    }

    async function buildSessionPersistRow(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        writePrefs();
        const row = {
            v: 4,
            loopPlayback: getLoopPlaybackEnabled(),
        };
        if (typeof getMusicalGridPersistSnapshot === 'function') {
            row.musicalGrid = getMusicalGridPersistSnapshot();
        }
        if (typeof getWaveformLaneUiPersistSnapshot === 'function') {
            row.laneUi = getWaveformLaneUiPersistSnapshot();
        }
        if (fileMain) {
            row.mName = fileMain.name;
            row.mLastModified = fileMain.lastModified;
            row.mBlob = fileMain;
            await attachWaveformSessionFieldsToRow(row);
        } else {
            const extra =
                typeof getExtraTracksPersistSnapshot === 'function'
                    ? getExtraTracksPersistSnapshot()
                    : null;
            const markersSnap =
                typeof getMarkersSnapshot === 'function' ? getMarkersSnapshot() : [];
            const hasExtra = extra && extra.length > 0;
            const hasMarkers = Array.isArray(markersSnap) && markersSnap.length > 0;
            if (hasExtra || hasMarkers) {
                row.audioOnlySession = true;
                if (hasExtra) row.extraTracks = extra;
                await attachWaveformSessionFieldsToRow(row);
            }
        }
        return row;
    }

    window.buildSessionPersistRow = buildSessionPersistRow;

    /** All Clear 等: 保存セッションを IndexedDB から完全削除 */
    async function deleteStoredSession() {
        clearTimeout(persistSessionTimer);
        persistSessionTimer = null;
        if (!window.indexedDB) return;
        try {
            const db = await openIdb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.objectStore(IDB_STORE).delete(IDB_KEY_LAST);
            });
        } catch (_) {}
    }

    window.deleteStoredSession = deleteStoredSession;

    async function persistSessionToStorage() {
        if (!window.indexedDB) return;
        const row = await buildSessionPersistRow();
        const nextStamp = sessionSaveStampSeq + 1;
        row.__saveStamp = nextStamp;
        writeLog('Session debug: periodic row regions = ' + formatRegionCountsForLog(row));
        let prevRow = null;
        try {
            prevRow = await idbGet(IDB_KEY_LAST);
        } catch (_) {
            prevRow = null;
        }
        if ((!prevRow || typeof prevRow !== 'object') && lastSessionRowSnapshot) {
            prevRow = deepCloneForPersist(lastSessionRowSnapshot);
        }
        writeLog('Session debug: periodic prev regions = ' + formatRegionCountsForLog(prevRow));
        keepPreviousRegionsWhenNoNewRegionEdit(row, prevRow);
        protectRegionShrinkOnPersist(row, prevRow);
        enforceRegionPersistFloor(row);
        if (Array.isArray(row.extraTracks)) {
            for (let i = 0; i < row.extraTracks.length; i++) {
                const e = row.extraTracks[i];
                if (!e || !(e.slot >= 0)) continue;
                const allowShrinkNow =
                    typeof canPersistRegionShrink === 'function' && canPersistRegionShrink(e.slot);
                applyPinnedRegionIfNeeded(row, e.slot, e, allowShrinkNow);
                if (!allowShrinkNow) {
                    updatePinnedRegionBySlot(
                        row,
                        e.slot,
                        e,
                        getPlaybackRegionExtraBySlot(row, e.slot),
                    );
                }
            }
        }
        if (!sessionRowHasRestorableContent(row)) {
            try {
                const db = await openIdb();
                await new Promise((resolve, reject) => {
                    const tx = db.transaction(IDB_STORE, 'readwrite');
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                    tx.objectStore(IDB_STORE).delete(IDB_KEY_LAST);
                });
            } catch (_) {}
            return;
        }
        await idbPut(IDB_KEY_LAST, row);
        cacheLastSessionRow(row);
        updateRegionPersistFloorFromRow(row);
        if (Array.isArray(row.extraTracks)) {
            for (let i = 0; i < row.extraTracks.length; i++) {
                const e = row.extraTracks[i];
                if (!e || !(e.slot >= 0)) continue;
                const slot = e.slot;
                regionPersistEpochSavedBySlot[slot] =
                    typeof getRegionPersistEpoch === 'function'
                        ? getRegionPersistEpoch(slot)
                        : regionPersistEpochSavedBySlot[slot] || 0;
            }
        }
        writeLog('Session debug: periodic saved regions = ' + formatRegionCountsForLog(row));
        writeLog('Session debug: periodic saved stamp = ' + nextStamp);
    }

    function prepareLaneUiRestoreFromRow(row) {
        pendingLaneUiRestore = row.laneUi && typeof row.laneUi === 'object' ? row.laneUi : null;
        if (!Array.isArray(row.extraTracks) || row.extraTracks.length < 1) return;
        const defaultExtraLaneOpen = () => {
            const n = getExtraTrackCount();
            return Array(n).fill(false);
        };
        if (!pendingLaneUiRestore || typeof pendingLaneUiRestore !== 'object') {
            pendingLaneUiRestore = {
                videoLaneOpen: true,
                extraLanesOpen: defaultExtraLaneOpen(),
            };
        }
        if (!Array.isArray(pendingLaneUiRestore.extraLanesOpen)) {
            pendingLaneUiRestore.extraLanesOpen = defaultExtraLaneOpen();
        }
        for (const entry of row.extraTracks) {
            const maxExtra = getExtraTrackCount();
            if (entry && entry.slot >= 0 && entry.slot < maxExtra) {
                pendingLaneUiRestore.extraLanesOpen[entry.slot] = true;
            }
        }
    }

    async function restoreExtraTracksFromRow(row) {
        if (!Array.isArray(row.extraTracks) || row.extraTracks.length < 1) {
            if (typeof finalizeReviewMixAfterSessionRestore === 'function') {
                await finalizeReviewMixAfterSessionRestore();
            }
            return;
        }
        writeLog('Restoring ' + row.extraTracks.length + ' extra audio track(s)...');
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        if (typeof ensureExtraTrackWaveformsDrawn === 'function') {
            ensureExtraTrackWaveformsDrawn({ maxFrames: 8 });
        }
        let restoredCount = 0;
        for (const entry of row.extraTracks) {
            const maxExtraRestore = getExtraTrackCount();
            if (!entry || entry.slot < 0 || entry.slot >= maxExtraRestore) continue;
            const blobBytes =
                typeof entry.byteLength === 'number'
                    ? entry.byteLength
                    : entry.blob
                      ? entry.blob.size || 0
                      : 0;
            if (!entry.blob || blobBytes < 1) {
                writeLog(
                    'Extra audio ' +
                        (entry.slot + 1) +
                        ': restore skipped (missing or empty stored audio, ' +
                        blobBytes +
                        ' bytes)',
                );
                continue;
            }
            if (typeof loadExtraTrackFile !== 'function') continue;
            const prEntry = playbackRegionEntryForSlot(row, entry.slot);
            const restoreRegionSegments =
                prEntry && Array.isArray(prEntry.segments)
                    ? prEntry.segments
                    : entry.regionSegments;
            const restoreRegionHeadPadSec =
                prEntry && Number.isFinite(prEntry.headPadSec)
                    ? prEntry.headPadSec
                    : entry.regionHeadPadSec;
            const restoreRegionTimelineInSec =
                prEntry && Number.isFinite(prEntry.regionTimelineInSec)
                    ? prEntry.regionTimelineInSec
                    : entry.regionTimelineInSec;
            const restoreRegionLeadPadSec =
                prEntry && Number.isFinite(prEntry.regionLeadPadSec)
                    ? prEntry.regionLeadPadSec
                    : entry.regionLeadPadSec;
            let previewOk = false;
            if (typeof applyExtraTrackPeaksPreview === 'function') {
                previewOk = applyExtraTrackPeaksPreview(entry.slot, entry);
            }
            if (!previewOk && typeof buildExtraTrackPeaksPreviewFromWavBlob === 'function') {
                previewOk = await buildExtraTrackPeaksPreviewFromWavBlob(entry.slot, entry);
            }
            const af = new File([entry.blob], entry.name || 'audio.wav', {
                type:
                    typeof mimeTypeHintForAudioFileName === 'function'
                        ? mimeTypeHintForAudioFileName(entry.name || 'audio.wav')
                        : 'application/octet-stream',
                lastModified:
                    typeof entry.lastModified === 'number' ? entry.lastModified : Date.now(),
            });
            try {
                writeLog(
                    'Extra audio ' +
                        (entry.slot + 1) +
                        ': restore payload regions ' +
                        (Array.isArray(restoreRegionSegments) ? restoreRegionSegments.length : 0),
                );
                writeLog('Extra audio ' + (entry.slot + 1) + ': restore decode start');
                await loadExtraTrackFile(entry.slot, af, {
                    fromSessionRestore: true,
                    timelineStartSec: entry.timelineStartSec,
                    regionSegments: restoreRegionSegments,
                    regionHeadPadSec: restoreRegionHeadPadSec,
                    regionTimelineInSec: restoreRegionTimelineInSec,
                    regionLeadPadSec: restoreRegionLeadPadSec,
                    regionSourceInSec: entry.regionSourceInSec,
                    regionSourceOutSec: entry.regionSourceOutSec,
                });
                if (Array.isArray(entry.clips) && entry.clips.length > 1) {
                    for (const clipEntry of entry.clips) {
                        if (!clipEntry || clipEntry.id === 'main' || !clipEntry.blob) continue;
                        const clipBytes =
                            typeof clipEntry.byteLength === 'number'
                                ? clipEntry.byteLength
                                : clipEntry.blob.size || 0;
                        if (clipBytes < 1) continue;
                        const clipAf = new File(
                            [clipEntry.blob],
                            clipEntry.name || 'audio.wav',
                            {
                                type:
                                    typeof mimeTypeHintForAudioFileName === 'function'
                                        ? mimeTypeHintForAudioFileName(
                                              clipEntry.name || 'audio.wav',
                                          )
                                        : 'application/octet-stream',
                                lastModified:
                                    typeof clipEntry.lastModified === 'number'
                                        ? clipEntry.lastModified
                                        : Date.now(),
                            },
                        );
                        try {
                            await loadExtraTrackFile(entry.slot, clipAf, {
                                addClip: true,
                                fromSessionRestore: true,
                                preservedClipId: clipEntry.id,
                            });
                        } catch (clipErr) {
                            writeLog(
                                'Extra audio ' +
                                    (entry.slot + 1) +
                                    ': clip restore failed — ' +
                                    (clipErr && clipErr.message
                                        ? clipErr.message
                                        : String(clipErr)),
                            );
                        }
                    }
                    if (
                        Array.isArray(restoreRegionSegments) &&
                        restoreRegionSegments.length &&
                        typeof setTrackSegments === 'function'
                    ) {
                        setTrackSegments(
                            { type: 'extra', slot: entry.slot },
                            restoreRegionSegments,
                            { silent: true },
                        );
                    }
                }
                if (typeof isExtraTrackLoaded === 'function' && isExtraTrackLoaded(entry.slot)) {
                    restoredCount += 1;
                } else {
                    writeLog(
                        'Extra audio ' +
                            (entry.slot + 1) +
                            ': restore finished without audio buffer',
                    );
                }
            } catch (e) {
                writeLog(
                    'Extra audio ' +
                        (entry.slot + 1) +
                        ': restore failed — ' +
                        (e && e.message ? e.message : String(e)),
                );
            }
        }
        if (restoredCount === 0) {
            writeLog(
                'Extra audio restore: no tracks loaded — load Ex audio again, then check for "Session: extra audio N saved" in log before reload',
            );
        } else {
            writeLog('Extra audio restore: ' + restoredCount + ' track(s) decoded');
        }
        if (typeof refreshAllExtraTrackLaneVisibility === 'function') {
            refreshAllExtraTrackLaneVisibility();
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        if (typeof finalizeReviewMixAfterSessionRestore === 'function') {
            await finalizeReviewMixAfterSessionRestore();
        } else if (typeof ensureExtraTrackWaveformsDrawn === 'function') {
            ensureExtraTrackWaveformsDrawn({ notifyMaster: true, maxFrames: 40 });
        }
        if (typeof ensureMarkersRestoredFromSession === 'function') {
            ensureMarkersRestoredFromSession();
        }
        if (typeof syncAudioOnlyMarkersUi === 'function') {
            syncAudioOnlyMarkersUi();
        }
        if (typeof updateSessionAllClearButton === 'function') {
            updateSessionAllClearButton();
        }
    }

    function applyRangeLoopRestoreFromRow(row) {
        if (
            row.rangeLoop &&
            Number.isFinite(row.rangeLoop.inSec) &&
            Number.isFinite(row.rangeLoop.outSec) &&
            typeof setPendingRangeLoopRestore === 'function'
        ) {
            setPendingRangeLoopRestore(row.rangeLoop);
        }
    }

    function applyPlaybackRegionRestoreFromRow(row) {
        if (row.playbackRegion && typeof setPendingPlaybackRegionRestore === 'function') {
            setPendingPlaybackRegionRestore(row.playbackRegion);
        }
    }

    function playbackRegionEntryForSlot(row, slot) {
        if (
            !row ||
            !row.playbackRegion ||
            !Array.isArray(row.playbackRegion.extra) ||
            !(slot >= 0)
        ) {
            return null;
        }
        const hit = row.playbackRegion.extra.find(
            (e) => e && e.slot === slot && Array.isArray(e.segments),
        );
        return hit || null;
    }

    async function finishSessionRestoreFromRow(row, opt) {
        if (typeof resetMarkersDisplayHidden === 'function') {
            resetMarkersDisplayHidden();
        }
        const o = opt && typeof opt === 'object' ? opt : {};
        const restoreTransportSec =
            typeof o.restoreTransportSec === 'number' && Number.isFinite(o.restoreTransportSec)
                ? Math.max(0, o.restoreTransportSec)
                : null;

        if (typeof syncExtraLaneVisibilityAfterSessionRestore === 'function') {
            syncExtraLaneVisibilityAfterSessionRestore();
        } else if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
        if (restoreTransportSec != null) {
            if (typeof primePendingRestoreTransportUi === 'function') {
                primePendingRestoreTransportUi();
            }
            if (typeof scheduleSessionTransportRestoreRetry === 'function') {
                scheduleSessionTransportRestoreRetry();
            }
            if (typeof applyPendingTransportRestore === 'function') {
                applyPendingTransportRestore();
            }
        } else if (typeof applySessionTransportAtHead === 'function') {
            applySessionTransportAtHead();
        }
        if (typeof applyPendingRangeLoopRestore === 'function') {
            applyPendingRangeLoopRestore();
        }
        if (typeof applyPendingPlaybackRegionRestore === 'function') {
            applyPendingPlaybackRegionRestore();
        }
        if (typeof syncSeekMax === 'function') syncSeekMax();
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        if (typeof updateControlsEnabled === 'function') updateControlsEnabled();
        if (typeof updateTimecodeOverlay === 'function') updateTimecodeOverlay();
        if (typeof updateMarkerCommentOverlay === 'function') updateMarkerCommentOverlay();
        if (typeof scheduleMarkersUiRefreshAfterLayout === 'function') {
            scheduleMarkersUiRefreshAfterLayout();
        } else if (typeof refreshMarkerUi === 'function') {
            refreshMarkerUi();
        } else if (typeof flushPendingSessionMarkersRestore === 'function') {
            flushPendingSessionMarkersRestore();
        }
        if (typeof refreshExportMediaOptionsUi === 'function') {
            refreshExportMediaOptionsUi();
        }
        if (typeof updateVideoClearButton === 'function') updateVideoClearButton();
        if (typeof updateSessionAllClearButton === 'function') updateSessionAllClearButton();
        requestAnimationFrame(() => {
            if (typeof updateControlsEnabled === 'function') updateControlsEnabled();
        });
    }

    async function applyAudioOnlySessionPersistRow(row, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!sessionRowHasRestorableContent(row)) return false;

        const storedExtraCount = Array.isArray(row.extraTracks) ? row.extraTracks.length : 0;
        writeLog(
            'Restoring audio-only session (' +
                storedExtraCount +
                ' stored extra track' +
                (storedExtraCount === 1 ? '' : 's') +
                ')...',
        );

        prepareLaneUiRestoreFromRow(row);
        applyRangeLoopRestoreFromRow(row);
        if (typeof setPendingPlaybackRegionRestore === 'function') {
            setPendingPlaybackRegionRestore(null);
        }

        const restoreTransportSec =
            typeof o.restoreTransportSec === 'number' && Number.isFinite(o.restoreTransportSec)
                ? Math.max(0, o.restoreTransportSec)
                : null;
        if (restoreTransportSec != null) {
            pendingRestoreTime = restoreTransportSec;
        }

        if (typeof restoreMarkersFromSessionRow === 'function') {
            restoreMarkersFromSessionRow(row);
        } else if (typeof loadMarkersForCurrentVideo === 'function') {
            loadMarkersForCurrentVideo(
                Array.isArray(row.markers) ? row.markers : undefined,
            );
        }

        await restoreExtraTracksFromRow(row);

        if (typeof applySavedWaveformLaneUi === 'function') {
            const laneSnap =
                typeof pendingLaneUiRestore !== 'undefined' && pendingLaneUiRestore
                    ? pendingLaneUiRestore
                    : null;
            applySavedWaveformLaneUi(laneSnap);
            pendingLaneUiRestore = null;
        }
        if (typeof syncAudioOnlyMarkersUi === 'function') {
            syncAudioOnlyMarkersUi();
        } else if (typeof adoptMarkersForAudioOnlySession === 'function') {
            adoptMarkersForAudioOnlySession();
        }
        if (typeof scheduleMarkersUiRefreshAfterLayout === 'function') {
            scheduleMarkersUiRefreshAfterLayout();
        } else if (typeof refreshMarkerUi === 'function') {
            refreshMarkerUi();
        } else if (typeof flushPendingSessionMarkersRestore === 'function') {
            flushPendingSessionMarkersRestore();
        }

        if (typeof setPendingPlaybackRegionRestore === 'function') {
            setPendingPlaybackRegionRestore(null);
        }
        await finishSessionRestoreFromRow(row, {
            restoreTransportSec: restoreTransportSec,
        });
        writeLog('Restored audio-only session');
        return true;
    }

    async function applySessionPersistRow(row, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!row || typeof row !== 'object') return false;
        if (typeof row.loopPlayback === 'boolean') applySavedLoopPlayback(row.loopPlayback);
        if (row.musicalGrid && typeof applyMusicalGridPersistSnapshot === 'function') {
            applyMusicalGridPersistSnapshot(row.musicalGrid);
        }
        if (typeof setSessionMixRestore === 'function') {
            setSessionMixRestore(row.mix);
        }
        if (!row.mBlob) {
            return applyAudioOnlySessionPersistRow(row, opt);
        }

        const storedExtraCount = Array.isArray(row.extraTracks) ? row.extraTracks.length : 0;
        writeLog(
            storedExtraCount > 0
                ? 'Session data: ' + storedExtraCount + ' stored extra track(s)'
                : 'Session data: no stored extra tracks',
        );

        prepareLaneUiRestoreFromRow(row);
        applyRangeLoopRestoreFromRow(row);
        applyPlaybackRegionRestoreFromRow(row);

        const restoreTransportSec =
            typeof o.restoreTransportSec === 'number' && Number.isFinite(o.restoreTransportSec)
                ? Math.max(0, o.restoreTransportSec)
                : null;
        if (restoreTransportSec != null) {
            pendingRestoreTime = restoreTransportSec;
        }

        const f = new File([row.mBlob], row.mName || 'video.mp4', {
            type: mimeTypeHintForVideoFileName(row.mName || 'video.mp4'),
            lastModified: typeof row.mLastModified === 'number' ? row.mLastModified : Date.now(),
        });
        loadVideoFile(f, {
            skipPersist: true,
            markers: Array.isArray(row.markers) ? row.markers : undefined,
            markerMemo: typeof row.markerMemo === 'string' ? row.markerMemo : undefined,
            rangeLoop:
                row.rangeLoop &&
                Number.isFinite(row.rangeLoop.inSec) &&
                Number.isFinite(row.rangeLoop.outSec)
                    ? row.rangeLoop
                    : undefined,
            playbackRegion: row.playbackRegion || undefined,
        });
        writeLog(
            'Restored video: ' +
                f.name +
                (restoreTransportSec != null
                    ? ' (transport restore pending)'
                    : ' (transport at head)'),
        );
        if (typeof waitForVideoReadyForSessionRestore === 'function') {
            const metaOk = await waitForVideoReadyForSessionRestore();
            if (!metaOk) {
                writeLog('Session restore: video metadata not ready (extra tracks deferred)');
            }
        }
        await restoreExtraTracksFromRow(row);
        await finishSessionRestoreFromRow(row, {
            restoreTransportSec: restoreTransportSec,
        });
        if (typeof ensureMainVideoWaveformAfterSessionRestore === 'function') {
            ensureMainVideoWaveformAfterSessionRestore();
        }
        return true;
    }

    window.applySessionPersistRow = applySessionPersistRow;

    async function importAndPersistSessionRow(row, opt) {
        return runSerializedSessionRestore(async () => {
            await applySessionPersistRow(row, opt);
            if (row && sessionRowHasRestorableContent(row) && window.indexedDB) {
                await idbPut(IDB_KEY_LAST, row);
            }
        });
    }

    window.importAndPersistSessionRow = importAndPersistSessionRow;

    async function restoreSessionFromStorage() {
        return runSerializedSessionRestore(async () => {
            if (!window.indexedDB) {
                const prefs = readPrefs();
                applySavedLoopPlayback(prefs.loopPlayback);
                if (typeof applyUserMonitorDisplayPrefsFromStorage === 'function') {
                    applyUserMonitorDisplayPrefsFromStorage(prefs);
                } else if (typeof applyTransportPrefsFromStorage === 'function') {
                    applyTransportPrefsFromStorage(prefs);
                }
                writeLog('IndexedDB unavailable; skipped video blob restore.');
                return;
            }
            let row;
            try {
                row = await idbGet(IDB_KEY_LAST);
            } catch (e) {
                writeLog('Session read failed: ' + (e && e.message ? e.message : String(e)));
                return;
            }
            cacheLastSessionRow(row);
            updateRegionPersistFloorFromRow(row);
            writeLog('Session debug: restore row regions = ' + formatRegionCountsForLog(row));
            writeLog(
                'Session debug: restore row stamp = ' +
                    (Number.isFinite(row && row.__saveStamp) ? row.__saveStamp : 'none'),
            );
            if (!sessionRowHasRestorableContent(row)) {
                const prefs = readPrefs();
                applySavedLoopPlayback(prefs.loopPlayback);
                if (typeof applyUserMonitorDisplayPrefsFromStorage === 'function') {
                    applyUserMonitorDisplayPrefsFromStorage(prefs);
                } else if (typeof applyTransportPrefsFromStorage === 'function') {
                    applyTransportPrefsFromStorage(prefs);
                }
                writeLog('No stored session (user display prefs from localStorage).');
                return;
            }
            const prefs = readPrefs();
            applySavedLoopPlayback(prefs.loopPlayback);
            if (typeof applyUserMonitorDisplayPrefsFromStorage === 'function') {
                applyUserMonitorDisplayPrefsFromStorage(prefs);
            } else if (typeof applyTransportPrefsFromStorage === 'function') {
                applyTransportPrefsFromStorage(prefs);
            }
            await applySessionPersistRow(row);
            if (typeof applyUserMonitorDisplayPrefsFromStorage === 'function') {
                applyUserMonitorDisplayPrefsFromStorage(prefs);
            }
        });
    }
