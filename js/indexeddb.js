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

    async function persistSessionToStorage() {
        writePrefs();
        if (!window.indexedDB) return;
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
                if (extra) row.extraTracks = extra;
            }
        }
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

    async function restoreSessionFromStorage() {
        sessionRestoreListenersArmed = false;
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

        if (typeof row.loopPlayback === 'boolean') applySavedLoopPlayback(row.loopPlayback);
        if (typeof setSessionMixRestore === 'function') {
            setSessionMixRestore(row.mix);
        }
        pendingLaneUiRestore =
            row.laneUi && typeof row.laneUi === 'object' ? row.laneUi : null;
        if (Array.isArray(row.extraTracks) && row.extraTracks.length > 0) {
            if (!pendingLaneUiRestore || typeof pendingLaneUiRestore !== 'object') {
                pendingLaneUiRestore = { videoLaneOpen: true, extraLanesOpen: [false, false] };
            }
            if (!Array.isArray(pendingLaneUiRestore.extraLanesOpen)) {
                pendingLaneUiRestore.extraLanesOpen = [false, false];
            }
            for (const entry of row.extraTracks) {
                if (entry && entry.slot >= 0 && entry.slot < 2) {
                    pendingLaneUiRestore.extraLanesOpen[entry.slot] = true;
                }
            }
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
        pendingRestoreTime = 0;
        writeLog('Restored video: ' + f.name + ' (transport at head)');
        if (Array.isArray(row.extraTracks) && row.extraTracks.length > 0) {
            writeLog('Restoring ' + row.extraTracks.length + ' extra audio track(s)...');
            const restoreJobs = [];
            for (const entry of row.extraTracks) {
                if (
                    !entry ||
                    !entry.blob ||
                    entry.slot < 0 ||
                    entry.slot >= 2 ||
                    typeof loadExtraTrackFile !== 'function'
                ) {
                    continue;
                }
                const af = new File([entry.blob], entry.name || 'audio.wav', {
                    type:
                        typeof mimeTypeHintForAudioFileName === 'function'
                            ? mimeTypeHintForAudioFileName(entry.name || 'audio.wav')
                            : 'application/octet-stream',
                    lastModified:
                        typeof entry.lastModified === 'number' ? entry.lastModified : Date.now(),
                });
                restoreJobs.push(loadExtraTrackFile(entry.slot, af));
            }
            try {
                await Promise.all(restoreJobs);
            } catch (e) {
                writeLog(
                    'Extra audio restore: ' + (e && e.message ? e.message : String(e)),
                );
            }
            if (typeof refreshAllExtraTrackLaneVisibility === 'function') {
                refreshAllExtraTrackLaneVisibility();
            }
            if (typeof redrawAllExtraTrackWaveforms === 'function') {
                redrawAllExtraTrackWaveforms();
            }
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
            if (typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
        }
        if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
    }
