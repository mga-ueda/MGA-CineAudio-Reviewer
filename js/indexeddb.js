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

    function schedulePersistSession() {
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
            }
        };
        const p = sessionRestoreQueue.then(run, run);
        sessionRestoreQueue = p.catch(() => {});
        return p;
    }

    window.whenSessionRestoreIdle = whenSessionRestoreIdle;
    window.flushPersistSessionNow = flushPersistSessionNow;
    window.isSessionRestoreInProgress = function () {
        return !!sessionRestoreInProgress;
    };

    /** Ex トラック1本を即時マージ保存（リロード直前の欠落防止） */
    async function persistExtraTrackEntryToSession(entry) {
        const maxExtra =
            typeof window.EXTRA_TRACK_COUNT === 'number' ? window.EXTRA_TRACK_COUNT : 3;
        if (!window.indexedDB || !entry || entry.slot < 0 || entry.slot >= maxExtra) return;
        if (!entry.blob || (entry.byteLength || entry.blob.size || 0) < 1) return;
        let row;
        try {
            row = await idbGet(IDB_KEY_LAST);
        } catch (e) {
            throw e;
        }
        if (!row || !row.mBlob) return;
        if (!Array.isArray(row.extraTracks)) row.extraTracks = [];
        row.extraTracks = row.extraTracks.filter((e) => !e || e.slot !== entry.slot);
        row.extraTracks.push(entry);
        row.v = typeof row.v === 'number' ? row.v : 4;
        await idbPut(IDB_KEY_LAST, row);
        writeLog(
            'Session: extra audio ' +
                (entry.slot + 1) +
                ' saved (' +
                (entry.byteLength || entry.blob.size || 0) +
                ' bytes)',
        );
    }

    async function removeExtraTrackFromSession(slot) {
        const maxExtra =
            typeof window.EXTRA_TRACK_COUNT === 'number' ? window.EXTRA_TRACK_COUNT : 3;
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

    async function buildSessionPersistRow(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        writePrefs();
        const row = {
            v: 4,
            loopPlayback: getLoopPlaybackEnabled(),
        };
        if (typeof getWaveformLaneUiPersistSnapshot === 'function') {
            row.laneUi = getWaveformLaneUiPersistSnapshot();
        }
        if (fileMain) {
            row.mName = fileMain.name;
            row.mLastModified = fileMain.lastModified;
            row.mBlob = fileMain;
            row.markers = getMarkersSnapshot();
            if (typeof getRangeLoopPersistSnapshot === 'function') {
                const rangeLoop = getRangeLoopPersistSnapshot();
                if (rangeLoop) row.rangeLoop = rangeLoop;
            }
            if (typeof getMixPersistSnapshot === 'function') {
                row.mix = getMixPersistSnapshot();
            }
            if (typeof getExtraTracksPersistSnapshot === 'function') {
                const extra = getExtraTracksPersistSnapshot();
                if (extra && extra.length > 0) {
                    row.extraTracks = extra;
                } else if (sessionRestoreInProgress) {
                    try {
                        const prev = await idbGet(IDB_KEY_LAST);
                        if (prev && Array.isArray(prev.extraTracks) && prev.extraTracks.length > 0) {
                            row.extraTracks = prev.extraTracks;
                        }
                    } catch (_) {}
                }
            }
        }
        return row;
    }

    window.buildSessionPersistRow = buildSessionPersistRow;

    async function persistSessionToStorage() {
        if (!window.indexedDB) return;
        const row = await buildSessionPersistRow();
        if (!row.mBlob) {
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
    }

    function prepareLaneUiRestoreFromRow(row) {
        pendingLaneUiRestore = row.laneUi && typeof row.laneUi === 'object' ? row.laneUi : null;
        if (!Array.isArray(row.extraTracks) || row.extraTracks.length < 1) return;
        const defaultExtraLaneOpen = () => {
            const n =
                typeof window.EXTRA_TRACK_COUNT === 'number' ? window.EXTRA_TRACK_COUNT : 3;
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
            const maxExtra =
                typeof window.EXTRA_TRACK_COUNT === 'number' ? window.EXTRA_TRACK_COUNT : 3;
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
            const maxExtraRestore =
                typeof window.EXTRA_TRACK_COUNT === 'number' ? window.EXTRA_TRACK_COUNT : 3;
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
                writeLog('Extra audio ' + (entry.slot + 1) + ': restore decode start');
                await loadExtraTrackFile(entry.slot, af, {
                    fromSessionRestore: true,
                    timelineStartSec: entry.timelineStartSec,
                });
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
        if (typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
    }

    async function applySessionPersistRow(row, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!row || typeof row !== 'object') return false;
        if (typeof row.loopPlayback === 'boolean') applySavedLoopPlayback(row.loopPlayback);
        if (typeof setSessionMixRestore === 'function') {
            setSessionMixRestore(row.mix);
        }
        if (!row.mBlob) return false;

        const storedExtraCount = Array.isArray(row.extraTracks) ? row.extraTracks.length : 0;
        writeLog(
            storedExtraCount > 0
                ? 'Session data: ' + storedExtraCount + ' stored extra track(s)'
                : 'Session data: no stored extra tracks',
        );

        prepareLaneUiRestoreFromRow(row);

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
            rangeLoop:
                row.rangeLoop &&
                Number.isFinite(row.rangeLoop.inSec) &&
                Number.isFinite(row.rangeLoop.outSec)
                    ? row.rangeLoop
                    : undefined,
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
        if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
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
        return true;
    }

    window.applySessionPersistRow = applySessionPersistRow;

    async function importAndPersistSessionRow(row, opt) {
        return runSerializedSessionRestore(async () => {
            await applySessionPersistRow(row, opt);
            if (row && row.mBlob && window.indexedDB) {
                await idbPut(IDB_KEY_LAST, row);
            }
        });
    }

    window.importAndPersistSessionRow = importAndPersistSessionRow;

    async function restoreSessionFromStorage() {
        return runSerializedSessionRestore(async () => {
            const prefs = readPrefs();
            applySavedLoopPlayback(prefs.loopPlayback);

            if (!window.indexedDB) {
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
            if (!row || !row.mBlob) {
                writeLog('No stored video session (playback prefs may still apply).');
                return;
            }
            await applySessionPersistRow(row);
        });
    }
