/**
 * session-validate.js — セッション行・Import Review マニフェストの厳密検証。
 * 削除済みオプションや旧スキーマを含むデータは不正として拒否する。
 */
(function sessionValidateModule() {
    const SESSION_ROW_VERSION = 4;

    const DEPRECATED_OPTION_KEYS = new Set([
        'playheadCenterLock',
        'waveformLiteMode',
        'centerLock',
        'liteWaveform',
        'waveformLite',
        'rangeLoop',
    ]);

    const ALLOWED_SESSION_ROW_KEYS = new Set([
        'v',
        'laneUi',
        'musicalGrid',
        'loopPlayback',
        'mName',
        'mLastModified',
        'mBlob',
        'markers',
        'markerMemo',
        'playbackRegion',
        'mix',
        'extraTracks',
        'audioOnlySession',
        '__saveStamp',
        '__regionPinnedBySlot',
    ]);

    const ALLOWED_IMPORT_SESSION_KEYS = new Set([
        ...ALLOWED_SESSION_ROW_KEYS,
        'videoBlobKey',
    ]);

    function findDeprecatedKey(obj, pathPrefix) {
        if (!obj || typeof obj !== 'object') return null;
        for (const key of Object.keys(obj)) {
            if (DEPRECATED_OPTION_KEYS.has(key)) {
                return pathPrefix ? pathPrefix + '.' + key : key;
            }
        }
        return null;
    }

    function validateMusicalGridSnap(snap, pathPrefix) {
        if (snap == null) return null;
        if (typeof snap !== 'object') return pathPrefix + ' (not an object)';
        return null;
    }

    function validateLaneUiSnap(snap, pathPrefix) {
        if (snap == null) return null;
        if (typeof snap !== 'object') return pathPrefix + ' (not an object)';
        for (const key of Object.keys(snap)) {
            if (key !== 'videoLaneOpen' && key !== 'extraLanesOpen') {
                return pathPrefix + '.' + key;
            }
        }
        if ('videoLaneOpen' in snap && typeof snap.videoLaneOpen !== 'boolean') {
            return pathPrefix + '.videoLaneOpen';
        }
        if ('extraLanesOpen' in snap) {
            if (!Array.isArray(snap.extraLanesOpen)) return pathPrefix + '.extraLanesOpen';
            for (let i = 0; i < snap.extraLanesOpen.length; i++) {
                if (typeof snap.extraLanesOpen[i] !== 'boolean') {
                    return pathPrefix + '.extraLanesOpen[' + i + ']';
                }
            }
        }
        return null;
    }

    function validateSessionRow(row, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const allowedKeys = o.importSession ? ALLOWED_IMPORT_SESSION_KEYS : ALLOWED_SESSION_ROW_KEYS;

        if (!row || typeof row !== 'object') {
            return { valid: false, reason: 'session row missing or not an object' };
        }

        const deprecated = findDeprecatedKey(row);
        if (deprecated) {
            return { valid: false, reason: 'deprecated option "' + deprecated + '"' };
        }

        if (row.v !== SESSION_ROW_VERSION) {
            return {
                valid: false,
                reason: 'unsupported session version (expected v=' + SESSION_ROW_VERSION + ')',
            };
        }

        for (const key of Object.keys(row)) {
            if (!allowedKeys.has(key)) {
                return { valid: false, reason: 'unknown session field "' + key + '"' };
            }
        }

        if (row.laneUi != null) {
            const laneErr = validateLaneUiSnap(row.laneUi, 'laneUi');
            if (laneErr) return { valid: false, reason: 'invalid laneUi: ' + laneErr };
        }

        if (row.musicalGrid != null) {
            const mgErr = validateMusicalGridSnap(row.musicalGrid, 'musicalGrid');
            if (mgErr) return { valid: false, reason: 'invalid musicalGrid: ' + mgErr };
        }

        return { valid: true, reason: '' };
    }

    function validateImportManifest(manifest) {
        if (!manifest || typeof manifest !== 'object') {
            return { valid: false, reason: 'manifest missing or not an object' };
        }

        const prefs = manifest.prefs;
        if (prefs && typeof prefs === 'object') {
            const deprecated = findDeprecatedKey(prefs, 'prefs');
            if (deprecated) {
                return { valid: false, reason: 'deprecated prefs option "' + deprecated + '"' };
            }
            if (prefs.musicalGrid != null) {
                const mgErr = validateMusicalGridSnap(prefs.musicalGrid, 'prefs.musicalGrid');
                if (mgErr) {
                    return { valid: false, reason: 'invalid prefs.musicalGrid: ' + mgErr };
                }
            }
            if (prefs.laneUi != null) {
                const laneErr = validateLaneUiSnap(prefs.laneUi, 'prefs.laneUi');
                if (laneErr) return { valid: false, reason: 'invalid prefs.laneUi: ' + laneErr };
            }
        }

        if (manifest.session != null) {
            if (typeof manifest.session !== 'object') {
                return { valid: false, reason: 'session block is not an object' };
            }
            return validateSessionRow(manifest.session, { importSession: true });
        }

        return { valid: true, reason: '' };
    }

    async function rejectInvalidSessionData(source, reason) {
        const src = String(source || 'session');
        const detail = String(reason || 'invalid data');
        if (typeof writeLog === 'function') {
            writeLog('Session: rejected ' + src + ' — ' + detail);
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Session', 'Invalid data', 'error');
        }
        if (typeof clearEntireSession === 'function') {
            await clearEntireSession({ silentToast: true, preserveLog: true, force: true });
        }
    }

    window.SESSION_ROW_VERSION = SESSION_ROW_VERSION;
    window.validateStoredSessionRow = validateSessionRow;
    window.validateImportManifest = validateImportManifest;
    window.rejectInvalidSessionData = rejectInvalidSessionData;
})();
