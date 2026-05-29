/**
 * markers-state.js — マーカー状態・キャッシュ・セッション復元。
 */
    // マーカー（点・範囲）とコメント、表一覧・シークバー表示
    markersByVideoKey = new Map();
    markerMemoByVideoKey = new Map();

    function nextMarkerId() {
        markerIdSeq += 1;
        return 'm' + Date.now().toString(36) + '_' + markerIdSeq;
    }

    const MARKER_SESSION_AUDIO_ONLY_KEY = '\0mga-marker-session-audio-only';

    function getVideoMarkerKey() {
        if (fileMain) {
            return String(fileMain.name) + '\0' + String(fileMain.lastModified);
        }
        const audioOnlyCached = markersByVideoKey.get(MARKER_SESSION_AUDIO_ONLY_KEY);
        if (audioOnlyCached && audioOnlyCached.length > 0) {
            return MARKER_SESSION_AUDIO_ONLY_KEY;
        }
        if (currentMarkers.length > 0) {
            return MARKER_SESSION_AUDIO_ONLY_KEY;
        }
        const memoCached = markerMemoByVideoKey.get(MARKER_SESSION_AUDIO_ONLY_KEY);
        if ((memoCached && String(memoCached).trim()) || hasMarkerMemoText()) {
            return MARKER_SESSION_AUDIO_ONLY_KEY;
        }
        if (
            typeof hasPlayableWaveformTimeline === 'function' &&
            hasPlayableWaveformTimeline()
        ) {
            return MARKER_SESSION_AUDIO_ONLY_KEY;
        }
        return null;
    }

    /** 復元直後など、波形タイムライン未準備でもセッション付きマーカーを紐づける */
    function resolveMarkerCacheKey(savedFromSession) {
        if (fileMain) {
            return String(fileMain.name) + '\0' + String(fileMain.lastModified);
        }
        const k = getVideoMarkerKey();
        if (k) return k;
        if (Array.isArray(savedFromSession) && savedFromSession.length > 0) {
            return MARKER_SESSION_AUDIO_ONLY_KEY;
        }
        const cached = markersByVideoKey.get(MARKER_SESSION_AUDIO_ONLY_KEY);
        if (cached && cached.length > 0) {
            return MARKER_SESSION_AUDIO_ONLY_KEY;
        }
        return null;
    }

    function stashSessionMarkersRestorePayload(arr) {
        if (!Array.isArray(arr) || arr.length < 1) return;
        sessionMarkersRestorePayload = arr.map(normalizeMarker).filter(Boolean);
    }

    function hasSessionMarkersPendingRestore() {
        if (currentMarkers.length > 0 || pendingRangeStartSec != null) return true;
        if (sessionMarkersRestorePayload && sessionMarkersRestorePayload.length > 0) {
            return true;
        }
        if (
            pendingSessionMarkersForRestore &&
            pendingSessionMarkersForRestore.length > 0
        ) {
            return true;
        }
        const cached = markersByVideoKey.get(MARKER_SESSION_AUDIO_ONLY_KEY);
        return !!(cached && cached.length > 0);
    }

    window.hasSessionMarkersPendingRestore = hasSessionMarkersPendingRestore;

    function ensureMarkersRestoredFromSession() {
        if (currentMarkers.length > 0) {
            saveMarkersToCache();
            return true;
        }
        if (sessionMarkersRestorePayload && sessionMarkersRestorePayload.length > 0) {
            applyMarkersSnapshotToMemory(
                sessionMarkersRestorePayload,
                MARKER_SESSION_AUDIO_ONLY_KEY,
            );
            if (currentMarkers.length > 0) {
                sessionMarkersRestorePayload = null;
                return true;
            }
        }
        if (
            pendingSessionMarkersForRestore &&
            pendingSessionMarkersForRestore.length > 0
        ) {
            const snap = pendingSessionMarkersForRestore;
            pendingSessionMarkersForRestore = null;
            applyMarkersSnapshotToMemory(snap, MARKER_SESSION_AUDIO_ONLY_KEY);
            if (currentMarkers.length > 0) {
                sessionMarkersRestorePayload = null;
                return true;
            }
        }
        const keys = [];
        const k = getVideoMarkerKey();
        if (k) keys.push(k);
        if (k !== MARKER_SESSION_AUDIO_ONLY_KEY) {
            keys.push(MARKER_SESSION_AUDIO_ONLY_KEY);
        }
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (!markersByVideoKey.has(key)) continue;
            currentMarkers = markersByVideoKey.get(key).map(cloneMarker).filter(Boolean);
            sortMarkersInPlace();
            if (currentMarkers.length > 0) {
                sessionMarkersRestorePayload = null;
                saveMarkersToCache();
                return true;
            }
        }
        return false;
    }

    window.ensureMarkersRestoredFromSession = ensureMarkersRestoredFromSession;

    function flushPendingSessionMarkersRestore() {
        if (ensureMarkersRestoredFromSession()) {
            renderMarkerList();
            renderSeekBarMarkers();
            updateMarkerRangeHint();
            updateMarkerCommentOverlay();
            if (typeof updateSessionAllClearButton === 'function') {
                updateSessionAllClearButton();
            }
            return;
        }
        if (pendingSessionMarkersForRestore) {
            const snap = pendingSessionMarkersForRestore;
            pendingSessionMarkersForRestore = null;
            loadMarkersForCurrentVideo(snap);
            return;
        }
        const k = getVideoMarkerKey();
        if (!k || currentMarkers.length > 0) return;
        if (markersByVideoKey.has(k)) {
            loadMarkersForCurrentVideo();
        }
    }

    window.flushPendingSessionMarkersRestore = flushPendingSessionMarkersRestore;

    let waveformMarkersRenderRetryRaf = 0;

    function scheduleWaveformMarkersRenderRetry() {
        if (waveformMarkersRenderRetryRaf) {
            cancelAnimationFrame(waveformMarkersRenderRetryRaf);
            waveformMarkersRenderRetryRaf = 0;
        }
        let attempts = 0;
        const run = () => {
            waveformMarkersRenderRetryRaf = 0;
            if (!currentMarkers.length) return;
            if (typeof applyWaveformTimelineZoomLayout === 'function') {
                applyWaveformTimelineZoomLayout();
            }
            renderAudioWaveformMarkers();
            const lanes =
                typeof audioWaveformLanesTracks !== 'undefined' && audioWaveformLanesTracks
                    ? audioWaveformLanesTracks
                    : null;
            const laneReady = !lanes || (lanes.clientWidth | 0) > 0;
            const markersVisible =
                audioWaveformMarkers && !audioWaveformMarkers.hidden;
            if (laneReady && markersVisible) {
                if (typeof updateSessionAllClearButton === 'function') {
                    updateSessionAllClearButton();
                }
                return;
            }
            attempts += 1;
            if (attempts >= 72) return;
            waveformMarkersRenderRetryRaf = requestAnimationFrame(run);
        };
        waveformMarkersRenderRetryRaf = requestAnimationFrame(run);
    }

    function adoptMarkersForAudioOnlySession() {
        if (!currentMarkers.length) {
            const cached = markersByVideoKey.get(MARKER_SESSION_AUDIO_ONLY_KEY);
            if (cached && cached.length > 0) {
                currentMarkers = cached.map(cloneMarker).filter(Boolean);
                sortMarkersInPlace();
            }
        }
        if (!currentMarkers.length) {
            flushPendingSessionMarkersRestore();
            if (!currentMarkers.length) return;
        }
        const snap = getMarkersSnapshot();
        markersByVideoKey.set(MARKER_SESSION_AUDIO_ONLY_KEY, snap);
        currentMarkers = snap.map(cloneMarker).filter(Boolean);
        sortMarkersInPlace();
        renderMarkerList();
        renderSeekBarMarkers();
        updateMarkerRangeHint();
        updateMarkerCommentOverlay();
    }

    window.adoptMarkersForAudioOnlySession = adoptMarkersForAudioOnlySession;

    function cloneMarker(m) {
        if (!m || typeof m !== 'object') return null;
        const c = {
            id: String(m.id || nextMarkerId()),
            type: m.type === 'range' ? 'range' : 'point',
            comment: typeof m.comment === 'string' ? m.comment : '',
        };
        if (c.type === 'range') {
            c.startSec = Number(m.startSec);
            c.endSec = Number(m.endSec);
            if (!Number.isFinite(c.startSec)) c.startSec = 0;
            if (!Number.isFinite(c.endSec)) c.endSec = c.startSec;
        } else {
            c.timeSec = Number(m.timeSec);
            if (!Number.isFinite(c.timeSec)) c.timeSec = 0;
        }
        return c;
    }

    function normalizeMarker(m) {
        const c = cloneMarker(m);
        if (!c) return null;
        if (c.type === 'range' && c.endSec < c.startSec) {
            const t = c.startSec;
            c.startSec = c.endSec;
            c.endSec = t;
        }
        return c;
    }

    function getMarkersSnapshot() {
        return currentMarkers.map((m) => {
            if (m.type === 'range') {
                return {
                    id: m.id,
                    type: 'range',
                    startSec: m.startSec,
                    endSec: m.endSec,
                    comment: m.comment || '',
                };
            }
            return {
                id: m.id,
                type: 'point',
                timeSec: m.timeSec,
                comment: m.comment || '',
            };
        });
    }

    function setMarkersFromSnapshot(arr) {
        if (!Array.isArray(arr)) {
            currentMarkers = [];
        } else {
            currentMarkers = arr.map(normalizeMarker).filter(Boolean);
        }
        normalizeAllMarkerRanges({ silent: true });
        sortMarkersInPlace();
        saveMarkersToCache();
        renderMarkerList();
        renderSeekBarMarkers();
        updateMarkerRangeHint();
        updateMarkerCommentOverlay();
    }

    function saveMarkersToCache() {
        const k = getVideoMarkerKey() || resolveMarkerCacheKey();
        if (k) markersByVideoKey.set(k, getMarkersSnapshot());
    }

    /** 動画差し替え前: 現行マーカーをキャッシュへ退避し、表示中リストだけ空にする */
    function resetInsertMarkerPressState() {
        if (insertMarkerLongPressTimer != null) {
            clearTimeout(insertMarkerLongPressTimer);
            insertMarkerLongPressTimer = null;
        }
        insertMarkerPressAtMs = null;
        insertMarkerPressSec = null;
        insertMarkerLongPressStarted = false;
    }

    function loadMarkerMemoForCurrentVideo(savedFromSession) {
        const k = resolveMarkerCacheKey(
            typeof savedFromSession === 'string' ? undefined : savedFromSession,
        );
        if (typeof savedFromSession === 'string') {
            currentMarkerMemo = savedFromSession;
            sessionMarkerMemoRestorePayload = null;
            if (k) markerMemoByVideoKey.set(k, currentMarkerMemo);
        } else if (k && markerMemoByVideoKey.has(k)) {
            currentMarkerMemo = markerMemoByVideoKey.get(k) || '';
            sessionMarkerMemoRestorePayload = null;
        } else if (
            sessionMarkerMemoRestorePayload != null &&
            String(sessionMarkerMemoRestorePayload)
        ) {
            currentMarkerMemo = String(sessionMarkerMemoRestorePayload);
            if (k) markerMemoByVideoKey.set(k, currentMarkerMemo);
            sessionMarkerMemoRestorePayload = null;
        } else {
            currentMarkerMemo = '';
        }
        syncMarkerMemoTextarea();
        updateMarkerClearAllButton();
    }

    window.loadMarkerMemoForCurrentVideo = loadMarkerMemoForCurrentVideo;

    function prepareMarkersForVideoSwitch() {
        saveMarkersToCache();
        saveMarkerMemoToCache();
        resetInsertMarkerPressState();
        pendingRangeStartSec = null;
        activeMarkerId = null;
        currentMarkers = [];
    }

    window.saveMarkersToCache = saveMarkersToCache;
    window.prepareMarkersForVideoSwitch = prepareMarkersForVideoSwitch;

    function applyMarkersSnapshotToMemory(arr, cacheKey) {
        if (!Array.isArray(arr)) {
            currentMarkers = [];
            return;
        }
        stashSessionMarkersRestorePayload(arr);
        currentMarkers = arr.map(normalizeMarker).filter(Boolean);
        sortMarkersInPlace();
        const k =
            cacheKey ||
            resolveMarkerCacheKey(arr) ||
            MARKER_SESSION_AUDIO_ONLY_KEY;
        if (k) markersByVideoKey.set(k, getMarkersSnapshot());
        pendingSessionMarkersForRestore = null;
    }

    /** セッション行の markers / markerMemo をメモリへ（音声のみ復元の本命パス） */
    function restoreMarkersFromSessionRow(row) {
        let did = false;
        const arr =
            row && Array.isArray(row.markers) && row.markers.length > 0
                ? row.markers
                : null;
        if (arr) {
            stashSessionMarkersRestorePayload(arr);
            applyMarkersSnapshotToMemory(arr, MARKER_SESSION_AUDIO_ONLY_KEY);
            did = true;
        }
        if (row && typeof row.markerMemo === 'string') {
            sessionMarkerMemoRestorePayload = row.markerMemo;
            loadMarkerMemoForCurrentVideo(row.markerMemo);
            did = true;
        } else {
            loadMarkerMemoForCurrentVideo();
        }
        if (!did) return false;
        if (typeof syncAudioOnlyMarkersUi === 'function') {
            syncAudioOnlyMarkersUi();
        } else {
            renderMarkerList();
            renderSeekBarMarkers();
            updateMarkerRangeHint();
            updateMarkerCommentOverlay();
        }
        if (typeof updateSessionAllClearButton === 'function') {
            updateSessionAllClearButton();
        }
        return true;
    }

    window.restoreMarkersFromSessionRow = restoreMarkersFromSessionRow;

    function loadMarkersForCurrentVideo(savedFromSession) {
        resetInsertMarkerPressState();
        pendingRangeStartSec = null;
        activeMarkerId = null;
        const k = resolveMarkerCacheKey(savedFromSession);
        if (!k) {
            if (Array.isArray(savedFromSession) && savedFromSession.length > 0) {
                pendingSessionMarkersForRestore = savedFromSession;
                applyMarkersSnapshotToMemory(
                    savedFromSession,
                    MARKER_SESSION_AUDIO_ONLY_KEY,
                );
            } else {
                pendingSessionMarkersForRestore = null;
                const cacheKey = resolveMarkerCacheKey();
                if (cacheKey && markersByVideoKey.has(cacheKey)) {
                    currentMarkers = markersByVideoKey
                        .get(cacheKey)
                        .map(cloneMarker)
                        .filter(Boolean);
                    sortMarkersInPlace();
                } else if (
                    currentMarkers.length === 0 &&
                    !ensureMarkersRestoredFromSession()
                ) {
                    currentMarkers = [];
                }
            }
            renderMarkerList();
            renderSeekBarMarkers();
            updateMarkerRangeHint();
            updateMarkerCommentOverlay();
            loadMarkerMemoForCurrentVideo();
            if (typeof updateSessionAllClearButton === 'function') {
                updateSessionAllClearButton();
            }
            return;
        }
        pendingSessionMarkersForRestore = null;
        if (Array.isArray(savedFromSession)) {
            currentMarkers = savedFromSession.map(normalizeMarker).filter(Boolean);
            markersByVideoKey.set(k, getMarkersSnapshot());
        } else if (markersByVideoKey.has(k)) {
            currentMarkers = markersByVideoKey.get(k).map(cloneMarker).filter(Boolean);
        } else {
            const fallbackKey = resolveMarkerCacheKey();
            if (fallbackKey && markersByVideoKey.has(fallbackKey)) {
                currentMarkers = markersByVideoKey
                    .get(fallbackKey)
                    .map(cloneMarker)
                    .filter(Boolean);
                markersByVideoKey.set(k, getMarkersSnapshot());
            } else if (currentMarkers.length > 0) {
                markersByVideoKey.set(k, getMarkersSnapshot());
            } else if (!ensureMarkersRestoredFromSession()) {
                currentMarkers = [];
            }
        }
        sortMarkersInPlace();
        renderMarkerList();
        renderSeekBarMarkers();
        updateMarkerRangeHint();
        updateMarkerCommentOverlay();
        loadMarkerMemoForCurrentVideo();
        if (typeof updateSessionAllClearButton === 'function') {
            updateSessionAllClearButton();
        }
    }

    /** 映像なしセッション: マーカー一覧・波形マーカーをレイアウト確定後も再同期 */
    function syncAudioOnlyMarkersUi() {
        if (typeof videoReady === 'function' && videoReady()) return;

        ensureMarkersRestoredFromSession();
        adoptMarkersForAudioOnlySession();
        if (!currentMarkers.length) {
            if (typeof updateSessionAllClearButton === 'function') {
                updateSessionAllClearButton();
            }
            return;
        }
        sessionMarkersRestorePayload = null;

        if (typeof applyWaveformTimelineZoomLayout === 'function') {
            applyWaveformTimelineZoomLayout();
        }
        if (isMarkerTcInputFocused()) {
            renderSeekBarMarkers();
            updateMarkerRangeHint();
        } else {
            refreshMarkerUi();
        }
        updateMarkerClearAllButton();
        if (typeof updateSessionAllClearButton === 'function') {
            updateSessionAllClearButton();
        }
        scheduleWaveformMarkersRenderRetry();
    }

    window.syncAudioOnlyMarkersUi = syncAudioOnlyMarkersUi;

    function sortMarkersInPlace() {
        currentMarkers.sort((a, b) => {
            const ta = a.type === 'range' ? a.startSec : a.timeSec;
            const tb = b.type === 'range' ? b.startSec : b.timeSec;
            return ta - tb;
        });
    }

    function currentTransportSec() {
        if (typeof getTransportSec === 'function') return getTransportSec();
        if (typeof videoReady === 'function' && videoReady()) {
            return videoMain.currentTime || 0;
        }
        return 0;
    }

