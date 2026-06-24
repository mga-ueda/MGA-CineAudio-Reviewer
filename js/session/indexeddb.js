/**
 * indexeddb.js — IndexedDB セッション保存・起動復元・Ex 逐次マージ・Import 直列化キュー。
 */
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
    let regionPersistEpochVideoSaved = 0;

    function shiftSlotKeyedPersistMetadata(obj, clearedSlot, maxSlot) {
        if (!obj || typeof obj !== 'object' || !(clearedSlot >= 0)) return;
        for (let slot = clearedSlot; slot < maxSlot; slot++) {
            const src = slot + 1;
            if (Object.prototype.hasOwnProperty.call(obj, src)) {
                obj[slot] = obj[src];
            } else {
                delete obj[slot];
            }
        }
        delete obj[maxSlot];
    }

    function swapSlotKeyedPersistMetadata(obj, aSlot, bSlot) {
        if (!obj || typeof obj !== 'object' || aSlot === bSlot) return;
        const tmp = obj[aSlot];
        if (Object.prototype.hasOwnProperty.call(obj, bSlot)) {
            obj[aSlot] = obj[bSlot];
        } else {
            delete obj[aSlot];
        }
        if (tmp !== undefined) {
            obj[bSlot] = tmp;
        } else {
            delete obj[bSlot];
        }
    }

    function swapStringSlotKeyedObject(obj, aSlot, bSlot) {
        if (!obj || typeof obj !== 'object' || aSlot === bSlot) return;
        const keyA = String(aSlot);
        const keyB = String(bSlot);
        const tmp = obj[keyA];
        if (Object.prototype.hasOwnProperty.call(obj, keyB)) {
            obj[keyA] = obj[keyB];
        } else {
            delete obj[keyA];
        }
        if (tmp !== undefined) {
            obj[keyB] = tmp;
        } else {
            delete obj[keyB];
        }
    }

    /** Ex レーン入れ替え後: スロット番号に紐づくリージョン永続化メタデータを追従させる */
    function swapRegionPersistMetadataBetweenExtraTrackSlots(aSlot, bSlot) {
        if (aSlot === bSlot) return;
        swapSlotKeyedPersistMetadata(regionPersistFloorBySlot, aSlot, bSlot);
        swapSlotKeyedPersistMetadata(regionPersistFloorPayloadBySlot, aSlot, bSlot);
        swapSlotKeyedPersistMetadata(regionPersistEpochSavedBySlot, aSlot, bSlot);
        if (lastSessionRowSnapshot && lastSessionRowSnapshot.__regionPinnedBySlot) {
            swapStringSlotKeyedObject(
                lastSessionRowSnapshot.__regionPinnedBySlot,
                aSlot,
                bSlot,
            );
        }
        if (typeof swapRegionPersistEpochBetweenSlots === 'function') {
            swapRegionPersistEpochBetweenSlots(aSlot, bSlot);
        }
        if (typeof bumpRegionPersistEpoch === 'function') {
            bumpRegionPersistEpoch(aSlot);
            bumpRegionPersistEpoch(bSlot);
        }
    }

    window.swapRegionPersistMetadataBetweenExtraTrackSlots =
        swapRegionPersistMetadataBetweenExtraTrackSlots;

    /** Ex レーン詰め替え後: スロット番号に紐づくリージョン永続化メタデータを追従させる */
    function remapRegionPersistMetadataAfterExtraTrackCompaction(clearedSlot) {
        const maxExtra = getExtraTrackCount();
        if (!(clearedSlot >= 0) || clearedSlot >= maxExtra) return;
        const lastSlot = maxExtra - 1;
        shiftSlotKeyedPersistMetadata(regionPersistFloorBySlot, clearedSlot, lastSlot);
        shiftSlotKeyedPersistMetadata(regionPersistFloorPayloadBySlot, clearedSlot, lastSlot);
        shiftSlotKeyedPersistMetadata(regionPersistEpochSavedBySlot, clearedSlot, lastSlot);
        if (lastSessionRowSnapshot && lastSessionRowSnapshot.__regionPinnedBySlot) {
            for (let slot = clearedSlot; slot < maxExtra; slot++) {
                delete lastSessionRowSnapshot.__regionPinnedBySlot[String(slot)];
            }
        }
        for (let slot = clearedSlot; slot < maxExtra; slot++) {
            if (typeof bumpRegionPersistEpoch === 'function') {
                bumpRegionPersistEpoch(slot);
            }
        }
    }

    window.remapRegionPersistMetadataAfterExtraTrackCompaction =
        remapRegionPersistMetadataAfterExtraTrackCompaction;

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

    function upsertPlaybackRegionVideoFromSnapshot(row) {
        if (!row || typeof getPlaybackRegionPersistSnapshot !== 'function') return false;
        const snap = getPlaybackRegionPersistSnapshot();
        if (!snap || !snap.video || typeof snap.video !== 'object') return false;
        if (!row.playbackRegion || typeof row.playbackRegion !== 'object') {
            row.playbackRegion = { extra: [] };
        }
        if (!Array.isArray(row.playbackRegion.extra)) {
            row.playbackRegion.extra = [];
        }
        row.playbackRegion.video = deepCloneForPersist(snap.video);
        return true;
    }

    function hasFreshRegionPersistEdit(slot) {
        if (!(slot >= 0)) return false;
        const curEpoch =
            typeof getRegionPersistEpoch === 'function' ? getRegionPersistEpoch(slot) : 0;
        const savedEpoch = Number(regionPersistEpochSavedBySlot[slot] || 0);
        return curEpoch > savedEpoch;
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
            if (hasFreshRegionPersistEdit(slot)) continue;
            const nextIdx = row.extraTracks.findIndex((e) => e && e.slot === slot);
            if (nextIdx < 0) continue;
            const next = row.extraTracks[nextIdx];
            const prevMatchesTrack =
                next &&
                prev.name === next.name &&
                Number(prev.byteLength || prev.blob?.size || 0) ===
                    Number(next.byteLength || next.blob?.size || 0);
            if (!prevMatchesTrack) continue;
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
            const prevMatchesTrack =
                prev.name === next.name &&
                Number(prev.byteLength || prev.blob?.size || 0) ===
                    Number(next.byteLength || next.blob?.size || 0);
            if (!prevMatchesTrack) continue;
            const nextCount = regionSegmentsCountFromEntry(next);
            const prevCount = regionSegmentsCountFromEntry(prev);
            if (nextCount === prevCount) continue;
            if (prevCount < nextCount) continue;
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

    function extraTrackPersistEntriesMatch(a, b) {
        if (!a || !b) return false;
        return (
            a.name === b.name &&
            Number(a.byteLength || a.blob?.size || 0) ===
                Number(b.byteLength || b.blob?.size || 0)
        );
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
            if (hasFreshRegionPersistEdit(slot)) continue;
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
                if (!extraTrackPersistEntriesMatch(floorPayload.entry, next)) {
                    regionPersistFloorBySlot[slot] = nextCount;
                    regionPersistFloorPayloadBySlot[slot] = {
                        entry: deepCloneForPersist(next),
                        playback: deepCloneForPersist(getPlaybackRegionExtraBySlot(row, slot)),
                    };
                    continue;
                }
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
        const parts = slots.map((slot) => {
            const c = counts[slot];
            return 'Ex' + (slot + 1) + ' ' + c.entry + '/' + c.playback;
        });
        if (row && row.playbackRegion && row.playbackRegion.video) {
            const v = row.playbackRegion.video;
            let inSec = Number.isFinite(v.regionTimelineInSec) ? v.regionTimelineInSec : null;
            if (inSec == null && v.segments && v.segments[0]) {
                const s0 = v.segments[0];
                if (Number.isFinite(s0.regionTimelineInSec)) inSec = s0.regionTimelineInSec;
                else if (Number.isFinite(s0.timelineStartSec)) inSec = s0.timelineStartSec;
            }
            parts.push(
                'Video' +
                    (Array.isArray(v.segments) ? ' ' + v.segments.length + 'seg' : '') +
                    (Number.isFinite(inSec) && inSec > 0.0005
                        ? ' in=' + inSec.toFixed(2) + 's'
                        : ''),
            );
        }
        if (!parts.length) return 'none';
        return parts.join(' ');
    }

    function videoPlaybackRegionInSec(entry) {
        if (!entry || typeof entry !== 'object') return null;
        if (Number.isFinite(entry.regionTimelineInSec)) return entry.regionTimelineInSec;
        if (entry.segments && entry.segments[0]) {
            const s0 = entry.segments[0];
            if (Number.isFinite(s0.regionTimelineInSec)) return s0.regionTimelineInSec;
            if (Number.isFinite(s0.timelineStartSec)) return s0.timelineStartSec;
        }
        if (Number.isFinite(entry.headPadSec) && entry.headPadSec > 0.0005) {
            return entry.headPadSec;
        }
        return null;
    }

    function hasFreshVideoRegionPersistEdit() {
        const curEpoch =
            typeof getVideoRegionPersistEpoch === 'function'
                ? getVideoRegionPersistEpoch()
                : 0;
        return curEpoch > regionPersistEpochVideoSaved;
    }

    function sessionMainVideoFileKey(row) {
        if (!row || !row.mName) return '';
        const size = Number(row.mBlob?.size || row.mByteLength || 0);
        const lm = Number(row.mLastModified || 0);
        return String(row.mName) + '\0' + lm + '\0' + size;
    }

    function sessionMainVideoFileChanged(row, prevRow) {
        if (!row || !prevRow) return false;
        const cur = sessionMainVideoFileKey(row);
        const prev = sessionMainVideoFileKey(prevRow);
        if (!cur || !prev) return false;
        return cur !== prev;
    }

    /** ライブ snapshot に Video ブロックが無いときだけ、直前 IDB 行の Video 平行移動を維持 */
    function mergeVideoPlaybackRegionFromPrevRow(row, prevRow) {
        if (!row || !prevRow || !prevRow.playbackRegion || !prevRow.playbackRegion.video) {
            return;
        }
        if (sessionMainVideoFileChanged(row, prevRow)) return;
        if (hasFreshVideoRegionPersistEdit()) return;
        const prevIn = videoPlaybackRegionInSec(prevRow.playbackRegion.video);
        if (!(Number.isFinite(prevIn) && prevIn > 0.0005)) return;
        const liveVideo =
            row.playbackRegion && row.playbackRegion.video ? row.playbackRegion.video : null;
        if (
            liveVideo &&
            Array.isArray(liveVideo.segments) &&
            liveVideo.segments.length
        ) {
            return;
        }
        const liveIn = videoPlaybackRegionInSec(liveVideo);
        if (Number.isFinite(liveIn) && liveIn > 0.0005) return;
        if (!row.playbackRegion || typeof row.playbackRegion !== 'object') {
            row.playbackRegion = { extra: [] };
        }
        if (!Array.isArray(row.playbackRegion.extra)) {
            row.playbackRegion.extra = Array.isArray(prevRow.playbackRegion.extra)
                ? deepCloneForPersist(prevRow.playbackRegion.extra)
                : [];
        }
        row.playbackRegion.video = deepCloneForPersist(prevRow.playbackRegion.video);
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
        if (sessionRestoreInProgress || sessionRestoreTeardownPending) return;
        clearTimeout(persistSessionTimer);
        if (typeof setSessionSaveDebounceActive === 'function') {
            setSessionSaveDebounceActive('session', true);
        }
        persistSessionTimer = setTimeout(() => {
            persistSessionTimer = null;
            if (typeof setSessionSaveDebounceActive === 'function') {
                setSessionSaveDebounceActive('session', false);
            }
            persistSessionToStorage().catch((e) => {
                writeLog('Session save failed: ' + (e && e.message ? e.message : String(e)));
            });
        }, 450);
    }

    async function flushPersistSessionNow() {
        clearTimeout(persistSessionTimer);
        persistSessionTimer = null;
        if (typeof setSessionSaveDebounceActive === 'function') {
            setSessionSaveDebounceActive('session', false);
        }
        if (typeof flushPendingExtraTrackLayoutPersist === 'function') {
            await flushPendingExtraTrackLayoutPersist();
        }
        await whenSessionRestoreIdle();
        await persistSessionToStorage();
        await whenSessionStorageWriteIdle();
    }

    /** 起動復元・Import Review などセッション復元を直列化 */
    let sessionRestoreQueue = Promise.resolve();
    /** apply 完了後の Ex デコード待ち・ロック解除中 */
    let sessionRestoreTeardownPending = false;
    /** Import / All Clear で中断された復元を識別 */
    let sessionRestoreWorkToken = 0;
    /** runSerializedSessionRestore 内で実行中タスクの workToken（ループ先頭でスナップショットする） */
    let currentSessionRestoreWorkToken = null;
    /** sessionRestoreInProgress の現在の所有者 */
    let sessionRestoreActiveWorkToken = null;

    function whenSessionRestoreIdle() {
        return sessionRestoreQueue;
    }

    function isSessionRestoreWorkCancelled(workToken) {
        return workToken !== sessionRestoreWorkToken;
    }

    /** 進行中の起動復元・teardown を打ち切り、Import / All Clear を先に進める */
    async function abortPendingSessionRestore() {
        const pending = sessionRestoreQueue;
        sessionRestoreWorkToken += 1;
        sessionRestoreListenersArmed = false;
        sessionRestoreInProgress = false;
        sessionRestoreTeardownPending = false;
        sessionRestoreActiveWorkToken = null;
        if (typeof cancelExtraTrackWaveformEnsure === 'function') {
            cancelExtraTrackWaveformEnsure();
        }
        if (typeof clearStaleExtraTrackDecodingStatus === 'function') {
            clearStaleExtraTrackDecodingStatus();
        }
        await pending.catch(() => {});
    }

    function runSerializedSessionRestore(task) {
        const workToken = sessionRestoreWorkToken;
        const run = async () => {
            if (isSessionRestoreWorkCancelled(workToken)) return;
            sessionRestoreListenersArmed = false;
            sessionRestoreActiveWorkToken = workToken;
            currentSessionRestoreWorkToken = workToken;
            sessionRestoreInProgress = true;
            try {
                return await task();
            } finally {
                if (currentSessionRestoreWorkToken === workToken) {
                    currentSessionRestoreWorkToken = null;
                }
                if (sessionRestoreActiveWorkToken === workToken) {
                    sessionRestoreActiveWorkToken = null;
                }
                if (typeof updateSessionAllClearButton === 'function') {
                    updateSessionAllClearButton();
                }
            }
        };
        const p = sessionRestoreQueue.then(async () => {
            if (isSessionRestoreWorkCancelled(workToken)) return;
            try {
                return await run();
            } finally {
                if (isSessionRestoreWorkCancelled(workToken)) return;
                sessionRestoreTeardownPending = true;
                sessionRestoreInProgress = false;
                try {
                    if (typeof waitForSessionWaveformsAndEndRestoreLock === 'function') {
                        await waitForSessionWaveformsAndEndRestoreLock();
                    }
                } finally {
                    sessionRestoreTeardownPending = false;
                    if (typeof rebuildAllTrackTimelineSlots === 'function') {
                        try {
                            rebuildAllTrackTimelineSlots({
                                infer: true,
                                preserveStored: true,
                                skipPresentationRefresh: true,
                            });
                        } catch (err) {
                            writeLog(
                                'Session: musical slot rebuild after restore skipped — ' +
                                    (err && err.message ? err.message : String(err)),
                            );
                        }
                    }
                    if (typeof refreshRehearsalMarkTrackEventsAfterMasterDurationReady === 'function') {
                        try {
                            refreshRehearsalMarkTrackEventsAfterMasterDurationReady();
                        } catch (_) {}
                    } else if (typeof refreshAllRegionRehearsalMarkLabels === 'function') {
                        try {
                            refreshAllRegionRehearsalMarkLabels();
                        } catch (_) {}
                    }
                    if (typeof refreshMusicalGridTrackEventsAfterMasterDurationReady === 'function') {
                        try {
                            refreshMusicalGridTrackEventsAfterMasterDurationReady();
                        } catch (_) {}
                    }
                    if (typeof updateAllPlaybackRegionOverlays === 'function') {
                        try {
                            updateAllPlaybackRegionOverlays();
                        } catch (err) {
                            writeLog(
                                'Session: overlay refresh after restore skipped — ' +
                                    (err && err.message ? err.message : String(err)),
                            );
                        }
                    }
                }
            }
        });
        sessionRestoreQueue = p.catch(() => {});
        return p;
    }

    window.whenSessionRestoreIdle = whenSessionRestoreIdle;
    window.abortPendingSessionRestore = abortPendingSessionRestore;
    window.flushPersistSessionNow = flushPersistSessionNow;
    window.isSessionRestoreInProgress = function () {
        return !!sessionRestoreInProgress;
    };
    window.isSessionRestoreTeardownPending = function () {
        return !!sessionRestoreTeardownPending;
    };

    const extraTrackPersistReqSeqBySlot = {};
    let sessionStorageWriteQueue = Promise.resolve();

    function enqueueSessionStorageWrite(task) {
        if (typeof noteSessionSaveWriteStart === 'function') {
            noteSessionSaveWriteStart();
        }
        const run = async () => {
            try {
                return await task();
            } finally {
                if (typeof noteSessionSaveWriteEnd === 'function') {
                    noteSessionSaveWriteEnd();
                }
            }
        };
        sessionStorageWriteQueue = sessionStorageWriteQueue.then(run, run);
        return sessionStorageWriteQueue;
    }

    function whenSessionStorageWriteIdle() {
        return sessionStorageWriteQueue;
    }

    window.whenSessionStorageWriteIdle = whenSessionStorageWriteIdle;

    async function readSessionRowForWrite() {
        let row;
        try {
            row = await idbGet(IDB_KEY_LAST);
        } catch (_) {
            row = null;
        }
        if ((!row || typeof row !== 'object') && lastSessionRowSnapshot) {
            row = deepCloneForPersist(lastSessionRowSnapshot);
        }
        return row;
    }

    function normalizeExtraTracksEntriesBySlot(entries) {
        if (!Array.isArray(entries)) return [];
        const bySlot = new Map();
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            if (!e || !(e.slot >= 0)) continue;
            const prev = bySlot.get(e.slot);
            if (!prev) {
                bySlot.set(e.slot, e);
                continue;
            }
            const prevBytes = Number(prev.byteLength || prev.blob?.size || 0);
            const nextBytes = Number(e.byteLength || e.blob?.size || 0);
            const prevRegions = regionSegmentsCountFromEntry(prev);
            const nextRegions = regionSegmentsCountFromEntry(e);
            if (
                nextBytes > prevBytes ||
                (nextBytes === prevBytes && nextRegions >= prevRegions)
            ) {
                bySlot.set(e.slot, e);
            }
        }
        return Array.from(bySlot.values()).sort((a, b) => a.slot - b.slot);
    }

    function buildPlaybackRegionFromExtraTrackEntries(entries) {
        if (!Array.isArray(entries) || !entries.length) return null;
        const extras = [];
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (!entry || !(entry.slot >= 0)) continue;
            const segs = Array.isArray(entry.regionSegments) ? entry.regionSegments : [];
            if (!segs.length) continue;
            const out = {
                slot: entry.slot,
                segments: segs.map((seg) =>
                    seg && typeof seg === 'object' ? { ...seg } : seg,
                ),
            };
            if (Number.isFinite(entry.regionHeadPadSec) && entry.regionHeadPadSec > 0) {
                out.headPadSec = entry.regionHeadPadSec;
            }
            if (Number.isFinite(entry.regionTimelineInSec)) {
                out.regionTimelineInSec = entry.regionTimelineInSec;
            }
            if (Number.isFinite(entry.regionLeadPadSec) && entry.regionLeadPadSec > 0) {
                out.regionLeadPadSec = entry.regionLeadPadSec;
            }
            extras.push(out);
        }
        return extras.length ? { extra: extras } : null;
    }

    function dedupeExtraTrackEntriesForRestore(entries) {
        return normalizeExtraTracksEntriesBySlot(entries);
    }

    function finalizeExtraTrackRowAfterPersist(row) {
        cacheLastSessionRow(row);
        updateRegionPersistFloorFromRow(row);
        if (Array.isArray(row.extraTracks)) {
            for (let i = 0; i < row.extraTracks.length; i++) {
                const e = row.extraTracks[i];
                if (!e || !(e.slot >= 0)) continue;
                regionPersistEpochSavedBySlot[e.slot] =
                    typeof getRegionPersistEpoch === 'function'
                        ? getRegionPersistEpoch(e.slot)
                        : regionPersistEpochSavedBySlot[e.slot] || 0;
            }
        }
    }

    /** Ex 全スロットを一括置換（入れ替え・詰め替え後の原子的保存） */
    async function persistAllExtraTracksToSessionImpl() {
        if (!window.indexedDB || sessionRestoreInProgress) return;
        const snapshot =
            typeof getExtraTracksPersistSnapshot === 'function'
                ? getExtraTracksPersistSnapshot()
                : null;
        if (!snapshot || !snapshot.length) {
            writeLog('Session: extra layout save skipped (no loaded tracks)');
            return;
        }
        let row = await readSessionRowForWrite();
        if (!row || typeof row !== 'object') {
            row = { v: SESSION_ROW_VERSION, audioOnlySession: true, extraTracks: [] };
        }
        const nextStamp = sessionSaveStampSeq + 1;
        row.__saveStamp = nextStamp;
        row.v = SESSION_ROW_VERSION;
        if (!row.mBlob) row.audioOnlySession = true;
        if (typeof getMarkersSnapshot === 'function') {
            const mem = getMarkersSnapshot();
            if (mem && mem.length) {
                row.markers = mem;
            } else if (!sessionRowHasMarkers(row)) {
                delete row.markers;
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
        attachMarkersDisplayHiddenToRow(row);
        if (typeof getMixPersistSnapshot === 'function') {
            row.mix = getMixPersistSnapshot();
        }
        if (typeof getWaveformLaneUiPersistSnapshot === 'function') {
            row.laneUi = getWaveformLaneUiPersistSnapshot();
        }
        row.extraTracks = normalizeExtraTracksEntriesBySlot(
            snapshot.map((e) => deepCloneForPersist(e)),
        );
        if (typeof getPlaybackRegionPersistSnapshot === 'function') {
            const snap = getPlaybackRegionPersistSnapshot();
            if (snap) {
                row.playbackRegion = deepCloneForPersist(snap);
            } else {
                const playbackRegion = buildPlaybackRegionFromExtraTrackEntries(row.extraTracks);
                if (playbackRegion) row.playbackRegion = playbackRegion;
                else delete row.playbackRegion;
            }
        } else {
            const playbackRegion = buildPlaybackRegionFromExtraTrackEntries(row.extraTracks);
            if (playbackRegion) row.playbackRegion = playbackRegion;
            else delete row.playbackRegion;
        }
        if (Array.isArray(row.extraTracks)) {
            for (let i = 0; i < row.extraTracks.length; i++) {
                const e = row.extraTracks[i];
                if (!e || !(e.slot >= 0)) continue;
                rememberRegionPersistFloorFromEntry(
                    e.slot,
                    e,
                    getPlaybackRegionExtraBySlot(row, e.slot),
                );
            }
        }
        if (!sessionRowHasRestorableContent(row)) return;
        await idbPut(IDB_KEY_LAST, row);
        finalizeExtraTrackRowAfterPersist(row);
        writeLog(
            'Session: extra tracks layout saved (' +
                snapshot.length +
                ' track(s), ' +
                formatRegionCountsForLog(row) +
                ')',
        );
    }

    async function persistAllExtraTracksToSession() {
        return enqueueSessionStorageWrite(() => persistAllExtraTracksToSessionImpl());
    }

    window.persistAllExtraTracksToSession = persistAllExtraTracksToSession;

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
        return enqueueSessionStorageWrite(() =>
            mergeExtraTrackEntryIntoSessionRow(entry, slot, reqSeq),
        );
    }

    async function mergeExtraTrackEntryIntoSessionRow(entry, slot, reqSeq) {
        if (extraTrackPersistReqSeqBySlot[slot] !== reqSeq) return;
        if (typeof getExtraTrackPersistEntry === 'function') {
            const fresh = getExtraTrackPersistEntry(slot);
            if (fresh) entry = fresh;
            else return;
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
            'Session: pre-merge rgn ' + formatRegionCountsForLog(row),
        );
        if (extraTrackPersistReqSeqBySlot[slot] !== reqSeq) return;
        if (!row || typeof row !== 'object') {
            row = { v: SESSION_ROW_VERSION, audioOnlySession: true, extraTracks: [] };
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
        attachMarkersDisplayHiddenToRow(row);
        let persistedRegionSegments = 0;
        if (typeof getPlaybackRegionPersistSnapshot === 'function') {
            upsertPlaybackRegionVideoFromSnapshot(row);
            const playbackRegion = getPlaybackRegionPersistSnapshot();
            if (playbackRegion && Array.isArray(playbackRegion.extra)) {
                const hit = playbackRegion.extra.find(
                    (e) =>
                        e &&
                        e.slot === slot &&
                        Array.isArray(e.segments) &&
                        e.segments.length,
                );
                if (hit) {
                    upsertPlaybackRegionExtraForSlot(row, deepCloneForPersist(hit));
                    persistedRegionSegments = hit.segments.length;
                }
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
        const regionEpochSaved = Number(regionPersistEpochSavedBySlot[slot] || 0);
        const regionEpochCurrent =
            typeof getRegionPersistEpoch === 'function' ? getRegionPersistEpoch(slot) : 0;
        const hasFreshRegionEdit = regionEpochCurrent > regionEpochSaved;
        const prevEntryMatchesTrack =
            prevEntry &&
            entry &&
            prevEntry.name === entry.name &&
            Number(prevEntry.byteLength || prevEntry.blob?.size || 0) ===
                Number(entry.byteLength || entry.blob?.size || 0);
        if (
            prevEntryMatchesTrack &&
            prevRegionSegments > entryRegionSegments &&
            typeof canPersistRegionShrink === 'function' &&
            !canPersistRegionShrink(slot) &&
            !hasFreshRegionEdit
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
            row.v = SESSION_ROW_VERSION;
            if (extraTrackPersistReqSeqBySlot[slot] !== reqSeq) return;
            await idbPut(IDB_KEY_LAST, row);
            cacheLastSessionRow(row);
            updateRegionPersistFloorFromRow(row);
            updatePinnedRegionBySlot(row, slot, entry, getPlaybackRegionExtraBySlot(row, slot));
            writeLog(
                'Session: post-merge rgn ' + formatRegionCountsForLog(row),
            );
            writeLog('Session: saved stamp = ' + nextStamp);
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
        row.v = SESSION_ROW_VERSION;
        if (extraTrackPersistReqSeqBySlot[slot] !== reqSeq) return;
        await idbPut(IDB_KEY_LAST, row);
        cacheLastSessionRow(row);
        updateRegionPersistFloorFromRow(row);
        updatePinnedRegionBySlot(row, slot, entry, getPlaybackRegionExtraBySlot(row, slot));
        writeLog(
            'Session: post-merge rgn ' + formatRegionCountsForLog(row),
        );
        writeLog('Session: saved stamp = ' + nextStamp);
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
        return enqueueSessionStorageWrite(async () => {
            let row;
            try {
                row = await idbGet(IDB_KEY_LAST);
            } catch (_) {
                return;
            }
            if (!row || !Array.isArray(row.extraTracks)) return;
            row.extraTracks = row.extraTracks.filter((e) => !e || e.slot !== slot);
            if (row.playbackRegion && Array.isArray(row.playbackRegion.extra)) {
                row.playbackRegion.extra = row.playbackRegion.extra.filter(
                    (e) => !e || e.slot !== slot,
                );
            }
            if (row.__regionPinnedBySlot && typeof row.__regionPinnedBySlot === 'object') {
                delete row.__regionPinnedBySlot[String(slot)];
            }
            await idbPut(IDB_KEY_LAST, row);
            cacheLastSessionRow(row);
        });
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

    function attachMarkersDisplayHiddenToRow(row) {
        if (!row || typeof row !== 'object') return;
        if (typeof areMarkersHiddenOnTimeline === 'function') {
            row.markersDisplayHidden = areMarkersHiddenOnTimeline();
        }
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
        attachMarkersDisplayHiddenToRow(row);
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
            }
        }
        /* スペクトラム・メーター床は localStorage のユーザー設定のみ（セッションに含めない） */
    }

    async function buildSessionPersistRow(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        writePrefs();
        const row = {
            v: SESSION_ROW_VERSION,
            loopPlayback: getLoopPlaybackEnabled(),
        };
        attachMarkersDisplayHiddenToRow(row);
        if (typeof getMusicalGridPersistSnapshot === 'function') {
            row.musicalGrid = getMusicalGridPersistSnapshot();
        }
        if (typeof musicalTrackPersistDiagLog === 'function' && row.musicalGrid) {
            const mg = row.musicalGrid;
            musicalTrackPersistDiagLog('session/save-row', {
                hasMusicalGrid: true,
                meter:
                    typeof getCommittedMusicalGridMeterText === 'function'
                        ? getCommittedMusicalGridMeterText()
                        : '',
                tempoTrackEvents:
                    typeof musicalTrackPersistDiagSummarizeTempoEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeTempoEvents(mg.tempoTrackEvents)
                        : {
                              count: Array.isArray(mg.tempoTrackEvents) ? mg.tempoTrackEvents.length : 0,
                              missing: !Array.isArray(mg.tempoTrackEvents),
                          },
                signatureTrackEvents:
                    typeof musicalTrackPersistDiagSummarizeSignatureEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeSignatureEvents(mg.signatureTrackEvents)
                        : {
                              count: Array.isArray(mg.signatureTrackEvents)
                                  ? mg.signatureTrackEvents.length
                                  : 0,
                              missing: !Array.isArray(mg.signatureTrackEvents),
                          },
                rehearsalMarkTrackEvents:
                    typeof musicalTrackPersistDiagSummarizeRehearsalEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeRehearsalEvents(mg.rehearsalMarkTrackEvents)
                        : {
                              count: Array.isArray(mg.rehearsalMarkTrackEvents)
                                  ? mg.rehearsalMarkTrackEvents.length
                                  : 0,
                              missing: !Array.isArray(mg.rehearsalMarkTrackEvents),
                          },
                state:
                    typeof musicalTrackPersistDiagLiveState === 'function'
                        ? musicalTrackPersistDiagLiveState()
                        : null,
            });
        }
        if (typeof getWaveformLaneUiPersistSnapshot === 'function') {
            row.laneUi = getWaveformLaneUiPersistSnapshot();
        }
        if (fileMain) {
            row.mName = fileMain.name;
            row.mLastModified = fileMain.lastModified;
            row.mBlob = fileMain;
            if (typeof getVideoPreviewGammaPersistSnapshot === 'function') {
                row.videoPreviewGamma = getVideoPreviewGammaPersistSnapshot();
            }
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

    function clearSessionPersistMemoryState() {
        lastSessionRowSnapshot = null;
        for (const slot of Object.keys(regionPersistFloorBySlot)) {
            delete regionPersistFloorBySlot[slot];
        }
        for (const slot of Object.keys(regionPersistFloorPayloadBySlot)) {
            delete regionPersistFloorPayloadBySlot[slot];
        }
        for (const slot of Object.keys(regionPersistEpochSavedBySlot)) {
            delete regionPersistEpochSavedBySlot[slot];
        }
        regionPersistEpochVideoSaved = 0;
    }

    /** All Clear 等: 保存セッションを IndexedDB から完全削除 */
    async function deleteStoredSession() {
        clearTimeout(persistSessionTimer);
        persistSessionTimer = null;
        if (typeof setSessionSaveDebounceActive === 'function') {
            setSessionSaveDebounceActive('session', false);
        }
        clearSessionPersistMemoryState();
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
        return enqueueSessionStorageWrite(() => persistSessionToStorageImpl());
    }

    async function persistSessionToStorageImpl() {
        if (!window.indexedDB) return;
        const row = await buildSessionPersistRow();
        const nextStamp = sessionSaveStampSeq + 1;
        row.__saveStamp = nextStamp;
        writeLog('Session: persist row ' + formatRegionCountsForLog(row));
        let prevRow = null;
        try {
            prevRow = await idbGet(IDB_KEY_LAST);
        } catch (_) {
            prevRow = null;
        }
        if ((!prevRow || typeof prevRow !== 'object') && lastSessionRowSnapshot) {
            prevRow = deepCloneForPersist(lastSessionRowSnapshot);
        }
        writeLog('Session: persist prev ' + formatRegionCountsForLog(prevRow));
        keepPreviousRegionsWhenNoNewRegionEdit(row, prevRow);
        mergeVideoPlaybackRegionFromPrevRow(row, prevRow);
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
        writeLog('Session: persist saved ' + formatRegionCountsForLog(row));
        writeLog('Session: periodic saved stamp = ' + nextStamp);
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
        const restoreWorkToken =
            currentSessionRestoreWorkToken != null
                ? currentSessionRestoreWorkToken
                : sessionRestoreActiveWorkToken;
        const restoreAborted = () =>
            restoreWorkToken != null && isSessionRestoreWorkCancelled(restoreWorkToken);
        let loadApiMissingLogged = false;
        if (!Array.isArray(row.extraTracks) || row.extraTracks.length < 1) {
            if (typeof finalizeReviewMixAfterSessionRestore === 'function') {
                await finalizeReviewMixAfterSessionRestore();
            }
            return;
        }
        writeLog('Restoring ' + row.extraTracks.length + ' extra audio track(s)...');
        const restoreEntries = dedupeExtraTrackEntriesForRestore(row.extraTracks);
        if (restoreEntries.length !== row.extraTracks.length) {
            writeLog(
                'Extra audio restore: deduped stored entries ' +
                    row.extraTracks.length +
                    ' -> ' +
                    restoreEntries.length,
            );
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        if (typeof ensureExtraTrackWaveformsDrawn === 'function') {
            ensureExtraTrackWaveformsDrawn({ maxFrames: 8 });
        }
        let restoredCount = 0;
        for (const entry of restoreEntries) {
            if (restoreAborted()) return;
            const maxExtraRestore = getExtraTrackCount();
            if (!entry || entry.slot < 0 || entry.slot >= maxExtraRestore) {
                writeLog(
                    'Extra audio restore: skipped invalid entry (slot=' +
                        (entry && entry.slot != null ? entry.slot : '—') +
                        ', max=' +
                        maxExtraRestore +
                        ')',
                );
                continue;
            }
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
            const loadExtraTrackFileFn = window.loadExtraTrackFile;
            const isExtraTrackLoadedFn = window.isExtraTrackLoaded;
            const applyExtraTrackPeaksPreviewFn = window.applyExtraTrackPeaksPreview;
            const buildExtraTrackPeaksPreviewFromWavBlobFn =
                window.buildExtraTrackPeaksPreviewFromWavBlob;
            if (typeof loadExtraTrackFileFn !== 'function') {
                if (!loadApiMissingLogged) {
                    loadApiMissingLogged = true;
                    writeLog(
                        'Extra audio restore: loadExtraTrackFile unavailable — check that extra-audio-load.js loaded',
                    );
                }
                continue;
            }
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
            if (typeof applyExtraTrackPeaksPreviewFn === 'function') {
                previewOk = applyExtraTrackPeaksPreviewFn(entry.slot, entry);
            }
            if (!previewOk && typeof buildExtraTrackPeaksPreviewFromWavBlobFn === 'function') {
                previewOk = await buildExtraTrackPeaksPreviewFromWavBlobFn(entry.slot, entry);
            }
            if (restoreAborted()) return;
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
                const hasMultipleClips =
                    Array.isArray(entry.clips) && entry.clips.length > 1;
                await loadExtraTrackFileFn(entry.slot, af, {
                    fromSessionRestore: true,
                    deferRegionFinalize: hasMultipleClips,
                    timelineStartSec: entry.timelineStartSec,
                    regionSegments: restoreRegionSegments,
                    regionHeadPadSec: restoreRegionHeadPadSec,
                    regionTimelineInSec: restoreRegionTimelineInSec,
                    regionLeadPadSec: restoreRegionLeadPadSec,
                    regionSourceInSec: entry.regionSourceInSec,
                    regionSourceOutSec: entry.regionSourceOutSec,
                    backupPersistBlob:
                        entry.backupBlob && entry.backupBlob.size > 0
                            ? entry.backupBlob
                            : null,
                    stretchedPersist: !!(entry.backupBlob && entry.backupBlob.size > 0),
                });
                if (restoreAborted()) return;
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
                            await loadExtraTrackFileFn(entry.slot, clipAf, {
                                addClip: true,
                                fromSessionRestore: true,
                                preservedClipId: clipEntry.id,
                                backupPersistBlob:
                                    clipEntry.backupBlob && clipEntry.backupBlob.size > 0
                                        ? clipEntry.backupBlob
                                        : null,
                                stretchedPersist: !!(
                                    clipEntry.backupBlob && clipEntry.backupBlob.size > 0
                                ),
                            });
                        } catch (clipErr) {
                            writeLog(
                                'Extra audio ' +
                                    (entry.slot + 1) +
                                    ': clip could not restore — ' +
                                    (clipErr && clipErr.message
                                        ? clipErr.message
                                        : String(clipErr)),
                            );
                        }
                    }
                }
                if (
                    prEntry &&
                    Array.isArray(prEntry.timelineSlots) &&
                    prEntry.timelineSlots.length &&
                    typeof window.restoreTimelineSlotsForTrack === 'function'
                ) {
                    window.restoreTimelineSlotsForTrack(
                        { type: 'extra', slot: entry.slot },
                        prEntry.timelineSlots,
                    );
                }
                if (
                    typeof isExtraTrackLoadedFn === 'function' &&
                    isExtraTrackLoadedFn(entry.slot)
                ) {
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
            if (!restoreAborted()) {
                writeLog(
                    'Extra audio restore: no tracks loaded — load Ex audio again, then check for "Session: extra audio N saved" in log before reload',
                );
            }
        } else {
            writeLog('Extra audio restore: ' + restoredCount + ' track(s) decoded');
        }
        if (restoreAborted()) return;
        if (typeof finalizeAllPlaybackRegionsAfterSessionRestore === 'function') {
            try {
                finalizeAllPlaybackRegionsAfterSessionRestore();
            } catch (err) {
                writeLog(
                    'Extra audio restore: region finalize incomplete — ' +
                        (err && err.message ? err.message : String(err)),
                );
            }
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

    function syncRegionPersistEpochSavedFromLiveState() {
        if (typeof getRegionPersistEpoch === 'function') {
            const n = getExtraTrackCount();
            for (let slot = 0; slot < n; slot++) {
                regionPersistEpochSavedBySlot[slot] = getRegionPersistEpoch(slot) || 0;
            }
        }
        if (typeof getVideoRegionPersistEpoch === 'function') {
            regionPersistEpochVideoSaved = getVideoRegionPersistEpoch() || 0;
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
        if (typeof applyMarkersDisplayHiddenFromSession === 'function') {
            applyMarkersDisplayHiddenFromSession(row);
        } else if (typeof resetMarkersDisplayHidden === 'function') {
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
        if (typeof applyPendingPlaybackRegionRestore === 'function') {
            applyPendingPlaybackRegionRestore();
        }
        if (typeof syncVideoTrackRegionsPresentation === 'function') {
            syncVideoTrackRegionsPresentation({ force: true });
        }
        syncRegionPersistEpochSavedFromLiveState();
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
        if (typeof scheduleTransportUiRefreshAfterLayout === 'function') {
            scheduleTransportUiRefreshAfterLayout();
        }
        if (typeof refreshExportMediaOptionsUi === 'function') {
            refreshExportMediaOptionsUi();
        }
        if (typeof updateVideoClearButton === 'function') updateVideoClearButton();
        if (typeof updateSessionAllClearButton === 'function') updateSessionAllClearButton();
        if (typeof fileMain !== 'undefined' && fileMain) {
            if (typeof applyVideoPreviewGammaFromSession === 'function') {
                applyVideoPreviewGammaFromSession(row && row.videoPreviewGamma);
            }
        } else if (typeof resetVideoPreviewGamma === 'function') {
            resetVideoPreviewGamma({ skipPersist: true });
        }
        if (typeof logSessionRestoreRegionRehearsalSnapshot === 'function') {
            requestAnimationFrame(() => {
                logSessionRestoreRegionRehearsalSnapshot();
            });
        }
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
            if (typeof musicalTrackPersistDiagLog === 'function') {
                const mg = row.musicalGrid;
                musicalTrackPersistDiagLog('session/apply-row/begin', {
                    hasMusicalGrid: true,
                    meter:
                    typeof getCommittedMusicalGridMeterText === 'function'
                        ? getCommittedMusicalGridMeterText()
                        : '',
                    tempoTrackEvents:
                        typeof musicalTrackPersistDiagSummarizeTempoEvents === 'function'
                            ? musicalTrackPersistDiagSummarizeTempoEvents(mg.tempoTrackEvents)
                            : {
                                  count: Array.isArray(mg.tempoTrackEvents)
                                      ? mg.tempoTrackEvents.length
                                      : 0,
                                  missing: !Array.isArray(mg.tempoTrackEvents),
                              },
                    signatureTrackEvents:
                        typeof musicalTrackPersistDiagSummarizeSignatureEvents === 'function'
                            ? musicalTrackPersistDiagSummarizeSignatureEvents(mg.signatureTrackEvents)
                            : {
                                  count: Array.isArray(mg.signatureTrackEvents)
                                      ? mg.signatureTrackEvents.length
                                      : 0,
                                  missing: !Array.isArray(mg.signatureTrackEvents),
                              },
                    rehearsalMarkTrackEvents:
                        typeof musicalTrackPersistDiagSummarizeRehearsalEvents === 'function'
                            ? musicalTrackPersistDiagSummarizeRehearsalEvents(
                                  mg.rehearsalMarkTrackEvents,
                              )
                            : {
                                  count: Array.isArray(mg.rehearsalMarkTrackEvents)
                                      ? mg.rehearsalMarkTrackEvents.length
                                      : 0,
                                  missing: !Array.isArray(mg.rehearsalMarkTrackEvents),
                              },
                    before:
                        typeof musicalTrackPersistDiagLiveState === 'function'
                            ? musicalTrackPersistDiagLiveState()
                            : null,
                });
            }
            applyMusicalGridPersistSnapshot(row.musicalGrid);
            if (typeof musicalTrackPersistDiagLog === 'function') {
                musicalTrackPersistDiagLog('session/apply-row/done', {
                    after:
                        typeof musicalTrackPersistDiagLiveState === 'function'
                            ? musicalTrackPersistDiagLiveState()
                            : null,
                });
            }
        }
        if (typeof drawMusicalGridOverlay === 'function') {
            drawMusicalGridOverlay();
        } else         if (typeof updateRehearsalBoundaryOverlay === 'function') {
            updateRehearsalBoundaryOverlay();
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
            playbackRegion: row.playbackRegion || undefined,
        });
        writeLog(
            'Restored video: ' +
                f.name +
                (restoreTransportSec != null
                    ? ' (transport restore pending)'
                    : ' (transport at head)'),
        );
        await restoreExtraTracksFromRow(row);
        if (typeof waitForVideoReadyForSessionRestore === 'function') {
            const metaOk = await waitForVideoReadyForSessionRestore();
            if (!metaOk) {
                writeLog('Session restore: video metadata not ready');
            }
        }
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
            writeLog('Session: restore rgn ' + formatRegionCountsForLog(row));
            writeLog(
                'Session: restore row stamp = ' +
                    (Number.isFinite(row && row.__saveStamp) ? row.__saveStamp : 'none'),
            );
            if (row && typeof row === 'object' && typeof validateStoredSessionRow === 'function') {
                const check = validateStoredSessionRow(row);
                if (!check.valid) {
                    const prefs = readPrefs();
                    applySavedLoopPlayback(prefs.loopPlayback);
                    if (typeof applyUserMonitorDisplayPrefsFromStorage === 'function') {
                        applyUserMonitorDisplayPrefsFromStorage(prefs);
                    } else if (typeof applyTransportPrefsFromStorage === 'function') {
                        applyTransportPrefsFromStorage(prefs);
                    }
                    await rejectInvalidSessionData('stored session', check.reason);
                    return;
                }
            }
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
