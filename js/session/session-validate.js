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
        'rehearsalMark',
        'musicalGridPhraseFillVisible',
    ]);

    const ALLOWED_SESSION_ROW_KEYS = new Set([
        'v',
        'laneUi',
        'musicalGrid',
        'musicalGridVisible',
        'musicalGridRehearsalFillVisible',
        'loopPlayback',
        'mName',
        'mLastModified',
        'mBlob',
        'markers',
        'markerMemo',
        'markersDisplayHidden',
        'playbackRegion',
        'mix',
        'videoPreviewGamma',
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

    const MUSICAL_GRID_SNAP_KEYS = new Set([
        'rehearsal',
        'rehearsalGroupBarCounts',
        'gridVisible',
        'rehearsalFillVisible',
        'stretchDelta',
        'tempoTrackEvents',
        'signatureTrackEvents',
        'rehearsalMarkTrackEvents',
    ]);

    const MUSICAL_GRID_LEGACY_SNAP_KEYS = new Set([
        'meter',
        'tempo',
        'timeSignature',
        'bars',
        'phrase',
        'phraseFillVisible',
        'phraseGroupBarCounts',
    ]);

    const REGION_SEGMENT_EPS = 1e-6;

    function isLegacyGridOnlyRegionSegment(seg) {
        if (!seg || typeof seg !== 'object') return false;
        const inS = Number(seg.sourceInSec) || 0;
        const outS = Number(seg.sourceOutSec) || 0;
        return outS - inS <= REGION_SEGMENT_EPS;
    }

    function validateRegionSegmentEntry(seg, pathPrefix) {
        if (!seg || typeof seg !== 'object') {
            return pathPrefix + ' (not an object)';
        }
        if (isLegacyGridOnlyRegionSegment(seg)) {
            return pathPrefix + ' (legacy grid-only segment)';
        }
        const lead = Number(seg.regionLeadPadSec) || 0;
        const regionIn = Number(seg.regionTimelineInSec);
        const anchor = Number(seg.timelineStartSec);
        if (
            lead <= REGION_SEGMENT_EPS &&
            Number.isFinite(regionIn) &&
            Number.isFinite(anchor) &&
            regionIn < anchor - REGION_SEGMENT_EPS
        ) {
            return pathPrefix + ' (legacy implicit lead pad)';
        }
        return null;
    }

    function validateRegionSegmentList(segments, pathPrefix) {
        if (segments == null) return null;
        if (!Array.isArray(segments)) return pathPrefix + ' (not an array)';
        for (let i = 0; i < segments.length; i++) {
            const err = validateRegionSegmentEntry(segments[i], pathPrefix + '[' + i + ']');
            if (err) return err;
        }
        return null;
    }

    function validateExtraTrackEntry(entry, pathPrefix) {
        if (!entry || typeof entry !== 'object') {
            return pathPrefix + ' (not an object)';
        }
        if ('regionSegments' in entry) {
            const segErr = validateRegionSegmentList(entry.regionSegments, pathPrefix + '.regionSegments');
            if (segErr) return segErr;
        }
        return null;
    }

    function validatePlaybackRegionBlock(playbackRegion, pathPrefix) {
        if (playbackRegion == null) return null;
        if (typeof playbackRegion !== 'object') return pathPrefix + ' (not an object)';
        if ('extra' in playbackRegion) {
            if (!Array.isArray(playbackRegion.extra)) {
                return pathPrefix + '.extra (not an array)';
            }
            for (let i = 0; i < playbackRegion.extra.length; i++) {
                const extra = playbackRegion.extra[i];
                const base = pathPrefix + '.extra[' + i + ']';
                if (extra && typeof extra === 'object' && 'segments' in extra) {
                    const segErr = validateRegionSegmentList(extra.segments, base + '.segments');
                    if (segErr) return segErr;
                }
            }
        }
        if ('video' in playbackRegion) {
            const video = playbackRegion.video;
            if (video == null || typeof video !== 'object') {
                return pathPrefix + '.video (not an object)';
            }
            if ('segments' in video) {
                const segErr = validateRegionSegmentList(
                    video.segments,
                    pathPrefix + '.video.segments',
                );
                if (segErr) return segErr;
            }
        }
        return null;
    }

    function validateMusicalGridSnap(snap, pathPrefix) {
        if (snap == null) return null;
        if (typeof snap !== 'object') return pathPrefix + ' (not an object)';
        for (const key of Object.keys(snap)) {
            if (MUSICAL_GRID_LEGACY_SNAP_KEYS.has(key)) {
                return pathPrefix + '.' + key + ' (legacy field)';
            }
            if (!MUSICAL_GRID_SNAP_KEYS.has(key)) {
                return pathPrefix + '.' + key;
            }
        }
        if ('gridVisible' in snap && typeof snap.gridVisible !== 'boolean') {
            return pathPrefix + '.gridVisible';
        }
        if ('rehearsalFillVisible' in snap && typeof snap.rehearsalFillVisible !== 'boolean') {
            return pathPrefix + '.rehearsalFillVisible';
        }
        if ('stretchDelta' in snap && !Number.isFinite(Number(snap.stretchDelta))) {
            return pathPrefix + '.stretchDelta';
        }
        if ('rehearsalGroupBarCounts' in snap) {
            if (!Array.isArray(snap.rehearsalGroupBarCounts)) {
                return pathPrefix + '.rehearsalGroupBarCounts';
            }
            for (let i = 0; i < snap.rehearsalGroupBarCounts.length; i++) {
                const n = Number(snap.rehearsalGroupBarCounts[i]);
                if (!(Number.isFinite(n) && n > 0)) {
                    return pathPrefix + '.rehearsalGroupBarCounts[' + i + ']';
                }
            }
        }
        if ('tempoTrackEvents' in snap) {
            if (!Array.isArray(snap.tempoTrackEvents)) {
                return pathPrefix + '.tempoTrackEvents';
            }
        }
        if ('signatureTrackEvents' in snap) {
            if (!Array.isArray(snap.signatureTrackEvents)) {
                return pathPrefix + '.signatureTrackEvents';
            }
        }
        if ('rehearsalMarkTrackEvents' in snap) {
            if (!Array.isArray(snap.rehearsalMarkTrackEvents)) {
                return pathPrefix + '.rehearsalMarkTrackEvents';
            }
        }
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

        if ('musicalGridVisible' in row && typeof row.musicalGridVisible !== 'boolean') {
            return { valid: false, reason: 'invalid musicalGridVisible' };
        }
        if (
            'musicalGridRehearsalFillVisible' in row &&
            typeof row.musicalGridRehearsalFillVisible !== 'boolean'
        ) {
            return { valid: false, reason: 'invalid musicalGridRehearsalFillVisible' };
        }

        if (Array.isArray(row.extraTracks)) {
            for (let i = 0; i < row.extraTracks.length; i++) {
                const exErr = validateExtraTrackEntry(row.extraTracks[i], 'extraTracks[' + i + ']');
                if (exErr) return { valid: false, reason: 'invalid extraTracks: ' + exErr };
            }
        }

        if (row.playbackRegion != null) {
            const prErr = validatePlaybackRegionBlock(row.playbackRegion, 'playbackRegion');
            if (prErr) return { valid: false, reason: 'invalid playbackRegion: ' + prErr };
        }

        if ('markersDisplayHidden' in row && typeof row.markersDisplayHidden !== 'boolean') {
            return { valid: false, reason: 'invalid markersDisplayHidden' };
        }

        if ('videoPreviewGamma' in row) {
            const g = row.videoPreviewGamma;
            if (typeof g !== 'number' || !isFinite(g) || g < 0.52 || g > 1.0) {
                return { valid: false, reason: 'invalid videoPreviewGamma' };
            }
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
            if ('musicalGridVisible' in prefs && typeof prefs.musicalGridVisible !== 'boolean') {
                return { valid: false, reason: 'invalid prefs.musicalGridVisible' };
            }
            if (
                'musicalGridRehearsalFillVisible' in prefs &&
                typeof prefs.musicalGridRehearsalFillVisible !== 'boolean'
            ) {
                return { valid: false, reason: 'invalid prefs.musicalGridRehearsalFillVisible' };
            }
            if (prefs.devConstants != null) {
                if (typeof prefs.devConstants !== 'object') {
                    return { valid: false, reason: 'invalid prefs.devConstants' };
                }
                if (
                    prefs.devConstants.debugLog != null &&
                    typeof prefs.devConstants.debugLog !== 'object'
                ) {
                    return { valid: false, reason: 'invalid prefs.devConstants.debugLog' };
                }
                if (
                    'regionHandleHitDebug' in prefs.devConstants &&
                    typeof prefs.devConstants.regionHandleHitDebug !== 'boolean'
                ) {
                    return { valid: false, reason: 'invalid prefs.devConstants.regionHandleHitDebug' };
                }
                if (
                    'tempoStretchSkipApply' in prefs.devConstants &&
                    typeof prefs.devConstants.tempoStretchSkipApply !== 'boolean'
                ) {
                    return { valid: false, reason: 'invalid prefs.devConstants.tempoStretchSkipApply' };
                }
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
