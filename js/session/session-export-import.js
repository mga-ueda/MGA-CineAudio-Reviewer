/**
 * session-export-import.js — .mgacr セッションパッケージの Export Review / Import Review。
 */
(function sessionExportImportModule() {
    const MGACR_MAGIC = new Uint8Array([0x4d, 0x47, 0x41, 0x43, 0x52, 0x01]);
    const EXPORT_FORMAT = 'mgacr-session-v1';
    const EXPORT_FILE_EXT = '.mgacr';

    function isMgacrReviewFile(file) {
        if (!file || !file.name) return false;
        return fileExtLower(file.name) === EXPORT_FILE_EXT;
    }

    function assertMgacrReviewFile(file) {
        if (!file || file.size < 1) {
            throw new Error('Empty file');
        }
        if (!isMgacrReviewFile(file)) {
            const name = file.name || 'unknown';
            throw new Error(
                'Import Review accepts .mgacr files only (selected: "' + name + '")',
            );
        }
    }

    function countMarkers(markers) {
        if (!Array.isArray(markers)) return { point: 0, range: 0, total: 0 };
        let point = 0;
        let range = 0;
        for (const m of markers) {
            if (m && m.type === 'range') range += 1;
            else point += 1;
        }
        return { point, range, total: point + range };
    }

    function formatTcForLog(sec) {
        if (typeof formatTimecodeForTransport === 'function') {
            return formatTimecodeForTransport(sec);
        }
        const s = Number(sec);
        return Number.isFinite(s) ? s.toFixed(3) + ' s' : '—';
    }

    function describeLaneUi(laneUi) {
        if (!laneUi || typeof laneUi !== 'object') return 'lane UI: (default)';
        const video =
            typeof laneUi.videoLaneOpen === 'boolean'
                ? laneUi.videoLaneOpen
                    ? 'open'
                    : 'closed'
                : '?';
        const extra = Array.isArray(laneUi.extraLanesOpen)
            ? laneUi.extraLanesOpen
                  .map((o, i) => 'Ex' + (i + 1) + '=' + (o ? 'open' : 'closed'))
                  .join(', ')
            : '';
        return 'lane UI: Video Audio ' + video + (extra ? '; ' + extra : '');
    }

    function formatMixVolDb(linear) {
        const v = Number(linear);
        if (!Number.isFinite(v) || v <= 0) return '-∞ dB';
        const db = 20 * Math.log10(Math.max(v, 1e-10));
        return (db > 0 ? '+' : '') + db.toFixed(1) + ' dB';
    }

    function logMixSnapshotDetails(mix, category) {
        const cat = category === 'Export' || category === 'Import' ? category : 'Import';
        const detail =
            typeof writeDetailLog === 'function'
                ? function (msg) {
                      writeDetailLog(cat, msg);
                  }
                : function (msg) {
                      writeLog(cat + ': ' + msg);
                  };
        if (!mix || typeof mix !== 'object') {
            detail('mix — (none)');
            return;
        }
        if (mix.video && typeof mix.video === 'object') {
            const v = mix.video;
            detail(
                'Video Audio — vol ' +
                    formatMixVolDb(v.vol) +
                    (v.muted ? ', muted' : '') +
                    (v.solo ? ', solo' : ''),
            );
        }
        if (Array.isArray(mix.extra) && mix.extra.length > 0) {
            for (const e of mix.extra) {
                if (!e || typeof e.slot !== 'number') continue;
                detail(
                    'Ex' +
                        (e.slot + 1) +
                        ' — vol ' +
                        formatMixVolDb(e.vol) +
                        (e.muted ? ', muted' : '') +
                        (e.solo ? ', solo' : ''),
                );
            }
        }
    }

    function logImportDetail(message) {
        if (typeof writeDetailLog === 'function') {
            writeDetailLog('Import', message);
        } else {
            writeLog('Import Review: ' + message);
        }
    }

    function logExportDetail(message) {
        if (typeof writeDetailLog === 'function') {
            writeDetailLog('Export', message);
        } else {
            writeLog('Export Review: ' + message);
        }
    }

    function logImportAction(message, opt) {
        if (typeof writeActionLog === 'function') {
            writeActionLog('Import', message, opt);
        } else if (typeof writeLogError === 'function' && opt && opt.level === 'error') {
            writeLogError('Import Review: ' + message, opt);
        } else {
            writeLog('Import Review: ' + message, opt);
        }
    }

    function logExportAction(message, opt) {
        if (typeof writeActionLog === 'function') {
            writeActionLog('Export', message, opt);
        } else if (typeof writeLogError === 'function' && opt && opt.level === 'error') {
            writeLogError('Export Review: ' + message, opt);
        } else {
            writeLog('Export Review: ' + message, opt);
        }
    }

    function describeMonitorPrefs(mp) {
        if (!mp || typeof mp !== 'object') return 'monitor: (default)';
        if (typeof mp.masterVol === 'number' && isFinite(mp.masterVol)) {
            return 'monitor: master vol ' + Math.round(mp.masterVol * 100) + '%';
        }
        return 'monitor: (default)';
    }

    function musicalGridVisibilityPrefsForExport(prefs, sessionRow) {
        if (typeof resolveMusicalGridVisibilityFromProjectSource === 'function') {
            const projectSrc =
                sessionRow && typeof sessionRow === 'object'
                    ? sessionRow
                    : prefs && typeof prefs === 'object'
                      ? prefs
                      : null;
            if (projectSrc) {
                const v = resolveMusicalGridVisibilityFromProjectSource(projectSrc);
                if (
                    typeof v.gridVisible === 'boolean' &&
                    typeof v.rehearsalFillVisible === 'boolean'
                ) {
                    return {
                        musicalGridVisible: v.gridVisible,
                        musicalGridRehearsalFillVisible: v.rehearsalFillVisible,
                    };
                }
            }
        }
        const p = prefs && typeof prefs === 'object' ? prefs : {};
        let musicalGridVisible = true;
        let musicalGridRehearsalFillVisible = false;
        if (typeof getMusicalGridVisible === 'function') {
            musicalGridVisible = getMusicalGridVisible();
        } else if (typeof p.musicalGridVisible === 'boolean') {
            musicalGridVisible = p.musicalGridVisible;
        }
        if (typeof getMusicalGridRehearsalFillVisible === 'function') {
            musicalGridRehearsalFillVisible = getMusicalGridRehearsalFillVisible();
        } else if (typeof p.musicalGridRehearsalFillVisible === 'boolean') {
            musicalGridRehearsalFillVisible = p.musicalGridRehearsalFillVisible;
        }
        return { musicalGridVisible, musicalGridRehearsalFillVisible };
    }

    function metronomeClickPrefsForExport(prefs, sessionRow) {
        if (sessionRow && typeof sessionRow.metronomeClickEnabled === 'boolean') {
            return sessionRow.metronomeClickEnabled;
        }
        if (typeof getMetronomeClickEnabled === 'function') {
            return getMetronomeClickEnabled();
        }
        const p = prefs && typeof prefs === 'object' ? prefs : {};
        if (typeof p.metronomeClickEnabled === 'boolean') {
            return p.metronomeClickEnabled;
        }
        return false;
    }

    function describeMusicalGridVisibilityPrefs(p) {
        const pref = p && typeof p === 'object' ? p : {};
        const tempo =
            typeof pref.musicalGridVisible === 'boolean'
                ? pref.musicalGridVisible
                    ? 'ON'
                    : 'OFF'
                : '?';
        const rehearsal =
            typeof pref.musicalGridRehearsalFillVisible === 'boolean'
                ? pref.musicalGridRehearsalFillVisible
                    ? 'ON'
                    : 'OFF'
                : '?';
        return 'Tempo/Sig ' + tempo + ', Rehearsal ' + rehearsal;
    }

    function applyMusicalGridVisibilityPrefs(p) {
        if (typeof applyMusicalGridVisibilityFromProjectSource === 'function') {
            applyMusicalGridVisibilityFromProjectSource(p, {
                persist: false,
                skipRegionRefresh: true,
            });
            return;
        }
        const pref = p && typeof p === 'object' ? p : {};
        const importOpt = { silent: true, persist: false, skipRegionRefresh: true, skipSessionPersist: true };
        if (typeof pref.musicalGridVisible === 'boolean' && typeof setMusicalGridVisible === 'function') {
            setMusicalGridVisible(pref.musicalGridVisible, importOpt);
        }
        if (
            typeof pref.musicalGridRehearsalFillVisible === 'boolean' &&
            typeof setMusicalGridRehearsalFillVisible === 'function'
        ) {
            setMusicalGridRehearsalFillVisible(pref.musicalGridRehearsalFillVisible, importOpt);
        }
    }

    function applyMetronomeClickPrefs(p) {
        if (typeof applyMetronomeClickFromProjectSource === 'function') {
            applyMetronomeClickFromProjectSource(p, {
                persist: false,
                skipSessionPersist: true,
            });
            return;
        }
        const pref = p && typeof p === 'object' ? p : {};
        if (typeof pref.metronomeClickEnabled === 'boolean' && typeof setMetronomeClickEnabled === 'function') {
            setMetronomeClickEnabled(pref.metronomeClickEnabled, {
                silent: true,
                persist: false,
                skipSessionPersist: true,
            });
        }
    }

    function reviewMonitorPrefsForExport() {
        if (typeof getMonitorUiPersistSnapshot !== 'function') return null;
        const snap = getMonitorUiPersistSnapshot();
        if (!snap || typeof snap.masterVol !== 'number' || !isFinite(snap.masterVol)) return null;
        return { masterVol: snap.masterVol };
    }

    function logExportReviewDetails(manifest, blobs, packedBuffer, downloadName) {
        logExportDetail(
            'output file "' + downloadName + '" (' + formatByteSize(packedBuffer.byteLength) + ' total)',
        );
        if (manifest.exportedAt) {
            logExportDetail('package timestamp ' + manifest.exportedAt);
        }
        if (manifest.appVersion) {
            logExportDetail(
                'app version ' + manifest.appVersion + ', format ' + manifest.format,
            );
        }
        const sess = manifest.session;
        if (!sess || !sess.videoBlobKey) {
            logExportDetail('no video in session (settings-only package)');
        } else {
            const videoBytes = blobs.video ? blobs.video.byteLength : 0;
            logExportDetail(
                'video "' + (sess.mName || 'video') + '" (' + formatByteSize(videoBytes) + ')',
            );
        }
        if (sess && Array.isArray(sess.extraTracks) && sess.extraTracks.length > 0) {
            for (const tr of sess.extraTracks) {
                const key = tr.blobKey || 'extra' + tr.slot;
                const bytes = blobs[key] ? blobs[key].byteLength : tr.byteLength || 0;
                const start =
                    Number.isFinite(tr.timelineStartSec) && tr.timelineStartSec > 0
                        ? ', timeline start ' + formatTcForLog(tr.timelineStartSec)
                        : '';
                logExportDetail(
                    'extra audio Ex' +
                        (tr.slot + 1) +
                        ' "' +
                        (tr.name || 'audio') +
                        '" (' +
                        formatByteSize(bytes) +
                        start +
                        describeExtraTrackRegionForLog(tr) +
                        ')',
                );
            }
        } else {
            logExportDetail('no extra audio tracks');
        }
        const mc = countMarkers(sess && sess.markers);
        logExportDetail(
            'markers ' +
                mc.total +
                (mc.total ? ' (' + mc.point + ' point, ' + mc.range + ' range)' : ''),
        );
        if (sess && sess.playbackRegion) {
            const pr = sess.playbackRegion;
            if (Array.isArray(pr.extra) && pr.extra.length) {
                logExportDetail('playback regions on ' + pr.extra.length + ' extra track(s)');
            } else if (Number.isFinite(pr.inSec)) {
                logExportDetail(
                    'playback region ' +
                        formatTcForLog(pr.inSec) +
                        ' – ' +
                        formatTcForLog(pr.outSec),
                );
            } else {
                logExportDetail('playback region off');
            }
        } else {
            logExportDetail('playback region off');
        }
        logExportDetail(describeLaneUi(manifest.prefs && manifest.prefs.laneUi));
        logExportDetail(describeMusicalGridVisibilityPrefs(manifest.prefs));
        logExportDetail(describeMonitorPrefs(manifest.monitorPrefs));
        logMixSnapshotDetails(sess && sess.mix, 'Export');
        if (manifest.timecodeOverlay) {
            const o = manifest.timecodeOverlay;
            logExportDetail(
                'timecode overlay position x=' +
                    (o.xRatio != null ? Number(o.xRatio).toFixed(3) : '—') +
                    ', bottom=' +
                    (o.bottomRatio != null ? Number(o.bottomRatio).toFixed(3) : '—') +
                    ', scale=' +
                    (o.scale != null ? Number(o.scale).toFixed(2) : '1') +
                    ', hidden=' +
                    (o.hidden ? 'yes' : 'no'),
            );
        }
        const exCount =
            sess && Array.isArray(sess.extraTracks) ? sess.extraTracks.length : 0;
        if (typeof writeActionLog === 'function') {
            writeActionLog(
                'Export',
                'completed — "' +
                    downloadName +
                    '" (' +
                    formatByteSize(packedBuffer.byteLength) +
                    '; ' +
                    exCount +
                    ' Ex; ' +
                    mc.total +
                    ' markers)',
            );
        } else {
            writeLog('Export Review: completed successfully');
        }
    }

    function logImportReviewSettingsOnly(manifest, sourceFile) {
        const fileName = sourceFile && sourceFile.name ? sourceFile.name : 'unknown';
        const fileSize = formatByteSize(sourceFile && sourceFile.size);
        logImportDetail('source file "' + fileName + '" (' + fileSize + ')');
        if (manifest.exportedAt) {
            logImportDetail('package exported at ' + manifest.exportedAt);
        }
        if (manifest.appVersion) {
            logImportDetail('package app version ' + manifest.appVersion);
        }
        logImportDetail(describeLaneUi(manifest.prefs && manifest.prefs.laneUi));
        logImportDetail(describeMusicalGridVisibilityPrefs(manifest.prefs));
        logImportDetail(describeMonitorPrefs(manifest.monitorPrefs));
        if (manifest.timecodeOverlay) {
            const o = manifest.timecodeOverlay;
            logImportDetail(
                'timecode overlay restored' +
                    (typeof o.hidden === 'boolean'
                        ? ' (hidden=' + (o.hidden ? 'yes' : 'no') + ')'
                        : ''),
            );
        }
        if (typeof writeActionLog === 'function') {
            writeActionLog(
                'Import',
                'completed (settings only) — "' + fileName + '" (' + fileSize + ')',
            );
        } else {
            writeLog('Import Review: completed (settings only, no video in package)');
        }
    }

    function logImportReviewSuccess(manifest, sourceFile, row) {
        const fileName = sourceFile && sourceFile.name ? sourceFile.name : 'unknown';
        const fileSize = formatByteSize(sourceFile && sourceFile.size);
        logImportDetail('source file "' + fileName + '" (' + fileSize + ')');
        if (manifest.exportedAt) {
            logImportDetail('package exported at ' + manifest.exportedAt);
        }
        if (manifest.appVersion) {
            logImportDetail('package app version ' + manifest.appVersion);
        }
        const videoBytes = row.mBlob ? row.mBlob.size || 0 : 0;
        if (videoBytes > 0) {
            logImportDetail(
                'restored video "' + (row.mName || 'video') + '" (' + formatByteSize(videoBytes) + ')',
            );
        } else {
            logImportDetail('no video in package (loaded video cleared if any)');
        }
        const extras = Array.isArray(row.extraTracks) ? row.extraTracks : [];
        if (extras.length > 0) {
            for (const tr of extras) {
                const bytes = tr.byteLength || (tr.blob && tr.blob.size) || 0;
                const start =
                    Number.isFinite(tr.timelineStartSec) && tr.timelineStartSec > 0
                        ? ', timeline start ' + formatTcForLog(tr.timelineStartSec)
                        : '';
                logImportDetail(
                    'restored extra audio Ex' +
                        (tr.slot + 1) +
                        ' "' +
                        (tr.name || 'audio') +
                        '" (' +
                        formatByteSize(bytes) +
                        start +
                        describeExtraTrackRegionForLog(tr) +
                        ')',
                );
            }
        } else {
            logImportDetail('no extra audio tracks in package');
        }
        const mc = countMarkers(row.markers);
        logImportDetail(
            'markers ' +
                mc.total +
                (mc.total ? ' (' + mc.point + ' point, ' + mc.range + ' range)' : ''),
        );
        if (row.markerMemo && String(row.markerMemo).trim()) {
            logImportDetail('session memo restored');
        }
        if (row.playbackRegion) {
            const pr = row.playbackRegion;
            if (Array.isArray(pr.extra) && pr.extra.length) {
                logImportDetail('playback regions on ' + pr.extra.length + ' extra track(s)');
            } else if (Number.isFinite(pr.inSec)) {
                logImportDetail(
                    'playback region ' +
                        formatTcForLog(pr.inSec) +
                        ' – ' +
                        formatTcForLog(pr.outSec),
                );
            }
        }
        logImportDetail('transport at head (seek position not imported)');
        logMixSnapshotDetails(row.mix, 'Import');
        logImportDetail('session saved to IndexedDB for reload');

        let exPart = extras.length ? extras.length + ' Ex' : 'no Ex';
        if (extras.length === 1) {
            exPart += describeExtraTrackRegionForLog(extras[0]).replace(/^,\s*/, ', ');
        }
        const mode = videoBytes > 0 ? 'with video' : 'audio-only';
        if (typeof writeActionLog === 'function') {
            writeActionLog(
                'Import',
                'completed — "' +
                    fileName +
                    '" (' +
                    fileSize +
                    '; ' +
                    mode +
                    '; ' +
                    exPart +
                    '; ' +
                    mc.total +
                    ' markers)',
            );
        } else {
            writeLog('Import Review: completed successfully');
        }
    }

    function defaultExportMediaOptions() {
        const count = getExtraTrackCount();
        return {
            includeVideo: true,
            includeAudio: true,
            includeExtra: Array.from({ length: count }, () => true),
        };
    }

    function normalizeExportMediaOptions(opt) {
        const base = defaultExportMediaOptions();
        if (!opt || typeof opt !== 'object') return base;
        const extra = Array.isArray(opt.includeExtra) ? opt.includeExtra : base.includeExtra;
        const includeAudio =
            typeof opt.includeAudio === 'boolean'
                ? opt.includeAudio
                : Array.isArray(opt.includeExtra)
                  ? opt.includeExtra.some(Boolean)
                  : base.includeAudio;
        const count = getExtraTrackCount();
        const includeExtra = [];
        for (let i = 0; i < count; i++) {
            includeExtra.push(!!extra[i]);
        }
        return {
            includeVideo: !!opt.includeVideo,
            includeAudio: !!includeAudio,
            includeExtra,
        };
    }

    function isExportVideoAvailable() {
        return typeof fileMain !== 'undefined' && !!fileMain;
    }

    function isExportExtraSlotAvailable(slot) {
        return typeof isExtraTrackLoaded === 'function' && isExtraTrackLoaded(slot);
    }

    function isAnyExportExtraAvailable() {
        const count = getExtraTrackCount();
        for (let i = 0; i < count; i++) {
            if (isExportExtraSlotAvailable(i)) return true;
        }
        return false;
    }

    function readExportMediaIncludePrefs() {
        if (typeof readPrefs !== 'function') return defaultExportMediaOptions();
        const p = readPrefs();
        return normalizeExportMediaOptions(p.exportMediaInclude);
    }

    function getExportMediaIncludePrefsSnapshot() {
        const opts = defaultExportMediaOptions();
        const videoEl = document.getElementById('sessionExportIncludeVideo');
        const audioEl = document.getElementById('sessionExportIncludeAudio');
        if (videoEl) opts.includeVideo = !!videoEl.checked;
        if (audioEl) opts.includeAudio = !!audioEl.checked;
        return opts;
    }

    function persistExportMediaIncludePrefs() {
        if (typeof readPrefs !== 'function' || typeof LS_PREFS_KEY === 'undefined') return;
        try {
            const prev = readPrefs();
            const payload = Object.assign({}, prev, {
                exportMediaInclude: getExportMediaIncludePrefsSnapshot(),
            });
            localStorage.setItem(LS_PREFS_KEY, JSON.stringify(payload));
        } catch (_) {}
    }

    function applyExportMediaIncludePrefs(saved) {
        const media = normalizeExportMediaOptions(saved);
        const videoEl = document.getElementById('sessionExportIncludeVideo');
        const audioEl = document.getElementById('sessionExportIncludeAudio');
        if (videoEl) videoEl.checked = media.includeVideo;
        if (audioEl) audioEl.checked = media.includeAudio;
    }

    /** Active export selection (loaded media only); not written to .mgacr. */
    function getExportMediaOptionsFromUi() {
        const saved = getExportMediaIncludePrefsSnapshot();
        const opts = defaultExportMediaOptions();
        if (isExportVideoAvailable()) {
            opts.includeVideo = saved.includeVideo;
        }
        const hasAnyExtra = isAnyExportExtraAvailable();
        if (hasAnyExtra) {
            opts.includeAudio = saved.includeAudio;
        } else {
            opts.includeAudio = false;
        }
        for (let i = 0; i < opts.includeExtra.length; i++) {
            opts.includeExtra[i] = !!opts.includeAudio && isExportExtraSlotAvailable(i);
        }
        return opts;
    }

    function refreshExportMediaOptionsUi() {
        const saved = readExportMediaIncludePrefs();
        const videoEl = document.getElementById('sessionExportIncludeVideo');
        const audioEl = document.getElementById('sessionExportIncludeAudio');
        const hasVideo = isExportVideoAvailable();
        const hasAnyExtra = isAnyExportExtraAvailable();
        if (videoEl) {
            const wasDisabled = videoEl.disabled;
            videoEl.disabled = !hasVideo;
            if (hasVideo && wasDisabled) {
                videoEl.checked = saved.includeVideo;
            }
        }
        if (audioEl) {
            const wasDisabled = audioEl.disabled;
            audioEl.disabled = !hasAnyExtra;
            if (hasAnyExtra && wasDisabled) {
                audioEl.checked = saved.includeAudio;
            }
            if (!hasAnyExtra) {
                audioEl.checked = false;
            }
        }
        if (typeof updateSessionAllClearButton === 'function') {
            updateSessionAllClearButton();
        }
        const exportVideoBtn = document.getElementById('sessionExportVideoBtn');
        const exportBtn = document.getElementById('sessionExportBtn');
        const importBtn = document.getElementById('sessionImportBtn');
        const exportLocked =
            (typeof isWebmExportActive === 'function' && isWebmExportActive()) ||
            (typeof isWaveformRestoreLockActive === 'function' &&
                isWaveformRestoreLockActive());
        const hasReviewContent =
            typeof sessionHasExportableReviewContent === 'function' &&
            sessionHasExportableReviewContent();
        const hasPlayableAudio =
            typeof hasPlayableWaveformTimeline === 'function' &&
            hasPlayableWaveformTimeline();
        const canMediaExport = hasVideo || hasPlayableAudio;
        const exportReviewEnabled = !exportLocked && hasReviewContent;
        const exportMediaEnabled = exportReviewEnabled && canMediaExport;
        updateSessionExportMediaBtnUi(hasVideo);
        if (exportBtn) {
            exportBtn.disabled = !exportReviewEnabled;
        }
        if (exportVideoBtn) {
            exportVideoBtn.disabled = !exportMediaEnabled;
        }
        if (importBtn) importBtn.disabled = exportLocked;
    }

    function bindExportMediaIncludeCheckboxPersistence() {
        const ids = ['sessionExportIncludeVideo', 'sessionExportIncludeAudio'];
        for (const id of ids) {
            const el = document.getElementById(id);
            if (!el || el.dataset.exportMediaPersistBound === '1') continue;
            el.dataset.exportMediaPersistBound = '1';
            el.addEventListener('change', persistExportMediaIncludePrefs);
        }
    }

    function extraClipBlobKey(slot, clipId) {
        return 'extra' + slot + '_clip_' + clipId;
    }

    function appendExtraTrackRegionFields(dst, entry) {
        if (!dst || !entry || typeof entry !== 'object') return;
        if (Array.isArray(entry.regionSegments) && entry.regionSegments.length) {
            dst.regionSegments = entry.regionSegments;
            if (Number.isFinite(entry.regionHeadPadSec)) {
                dst.regionHeadPadSec = entry.regionHeadPadSec;
            }
            if (Number.isFinite(entry.regionTimelineInSec)) {
                dst.regionTimelineInSec = entry.regionTimelineInSec;
            }
            if (Number.isFinite(entry.regionLeadPadSec)) {
                dst.regionLeadPadSec = entry.regionLeadPadSec;
            }
        }
        if (Array.isArray(entry.clips) && entry.clips.length > 1) {
            dst.clips = entry.clips
                .map((clip) => {
                    if (!clip || !clip.id || clip.id === 'main') return null;
                    return {
                        id: clip.id,
                        name: clip.name,
                        lastModified: clip.lastModified,
                        byteLength: clip.byteLength,
                        duration: clip.duration,
                        peaks: clip.peaks,
                        blobKey: extraClipBlobKey(entry.slot, clip.id),
                    };
                })
                .filter(Boolean);
            if (!dst.clips.length) delete dst.clips;
        }
    }

    function describeExtraTrackRegionForLog(entry) {
        if (!entry || !Array.isArray(entry.regionSegments) || !entry.regionSegments.length) {
            return '';
        }
        let detail = ', ' + entry.regionSegments.length + ' region(s)';
        if (Number.isFinite(entry.regionTimelineInSec)) {
            detail += ', region in ' + formatTcForLog(entry.regionTimelineInSec);
        }
        if (Number.isFinite(entry.regionLeadPadSec) && entry.regionLeadPadSec > 0) {
            detail += ', lead pad ' + formatTcForLog(entry.regionLeadPadSec);
        }
        if (Number.isFinite(entry.regionHeadPadSec) && entry.regionHeadPadSec > 0) {
            detail += ', head pad ' + formatTcForLog(entry.regionHeadPadSec);
        }
        return detail;
    }

    function sessionRowForManifest(row, exportMedia) {
        if (!row || typeof row !== 'object') return null;
        const media = normalizeExportMediaOptions(exportMedia);
        const out = {
            v: row.v,
            laneUi: row.laneUi,
            musicalGrid: row.musicalGrid,
            musicalGridVisible: row.musicalGridVisible,
            musicalGridRehearsalFillVisible: row.musicalGridRehearsalFillVisible,
            metronomeClickEnabled: row.metronomeClickEnabled,
            mName: row.mName,
            mLastModified: row.mLastModified,
            markers: row.markers,
            markerMemo: row.markerMemo,
            playbackRegion: row.playbackRegion,
            mix: row.mix,
            videoPreviewGamma: row.videoPreviewGamma,
            extraTracks: [],
        };
        if (Array.isArray(row.extraTracks)) {
            for (const entry of row.extraTracks) {
                if (!entry || typeof entry.slot !== 'number') continue;
                if (!media.includeExtra[entry.slot]) continue;
                const trackOut = {
                    slot: entry.slot,
                    name: entry.name,
                    lastModified: entry.lastModified,
                    byteLength: entry.byteLength,
                    duration: entry.duration,
                    peaks: entry.peaks,
                    timelineStartSec: entry.timelineStartSec,
                    blobKey: 'extra' + entry.slot,
                };
                appendExtraTrackRegionFields(trackOut, entry);
                out.extraTracks.push(trackOut);
            }
        }
        if (row.mBlob && media.includeVideo) out.videoBlobKey = 'video';
        return out;
    }

    async function blobToArrayBuffer(blob) {
        if (!blob) return null;
        if (blob instanceof ArrayBuffer) return blob;
        if (ArrayBuffer.isView(blob)) {
            return blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
        }
        return blob.arrayBuffer();
    }

    async function collectExportBlobs(sessionRow, exportMedia) {
        const blobs = {};
        const order = [];
        if (!sessionRow) return { blobs, order };
        const media = normalizeExportMediaOptions(exportMedia);
        if (sessionRow.mBlob && media.includeVideo) {
            blobs.video = await blobToArrayBuffer(sessionRow.mBlob);
            order.push('video');
        }
        if (Array.isArray(sessionRow.extraTracks)) {
            for (const entry of sessionRow.extraTracks) {
                if (!entry || !entry.blob || typeof entry.slot !== 'number') continue;
                if (!media.includeExtra[entry.slot]) continue;
                const key = 'extra' + entry.slot;
                blobs[key] = await blobToArrayBuffer(entry.blob);
                order.push(key);
                if (Array.isArray(entry.clips)) {
                    for (const clip of entry.clips) {
                        if (!clip || clip.id === 'main' || !clip.blob) continue;
                        const clipKey = extraClipBlobKey(entry.slot, clip.id);
                        blobs[clipKey] = await blobToArrayBuffer(clip.blob);
                        order.push(clipKey);
                    }
                }
            }
        }
        return { blobs, order };
    }

    async function buildExportManifest(exportMedia) {
        if (typeof flushPersistSessionNow === 'function') {
            await flushPersistSessionNow();
        }
        let sessionRow = null;
        if (typeof buildSessionPersistRow === 'function') {
            sessionRow = await buildSessionPersistRow();
        }
        if (
            sessionRow &&
            typeof fileMain !== 'undefined' &&
            fileMain &&
            typeof getMixPersistSnapshot === 'function'
        ) {
            sessionRow.mix = getMixPersistSnapshot();
        }
        if (
            sessionRow &&
            typeof fileMain !== 'undefined' &&
            fileMain &&
            typeof getVideoPreviewGammaPersistSnapshot === 'function'
        ) {
            sessionRow.videoPreviewGamma = getVideoPreviewGammaPersistSnapshot();
        }
        const prefs = typeof readPrefs === 'function' ? readPrefs() : {};
        const gridVisibility = musicalGridVisibilityPrefsForExport(prefs, sessionRow);
        const metronomeClickEnabled = metronomeClickPrefsForExport(prefs, sessionRow);
        /* マーカー HIDE 状態はエクスポートしない（表示のオンオフはセッション内のみ） */
        const manifest = {
            format: EXPORT_FORMAT,
            appVersion: typeof APP_VERSION_LABEL === 'string' ? APP_VERSION_LABEL : '',
            exportedAt: new Date().toISOString(),
            prefs: {
                laneUi:
                    sessionRow && sessionRow.laneUi
                        ? sessionRow.laneUi
                        : prefs.laneUi,
                musicalGrid:
                    sessionRow && sessionRow.musicalGrid
                        ? sessionRow.musicalGrid
                        : typeof getMusicalGridPersistSnapshot === 'function'
                          ? getMusicalGridPersistSnapshot()
                          : prefs.musicalGrid,
                musicalGridVisible: gridVisibility.musicalGridVisible,
                musicalGridRehearsalFillVisible: gridVisibility.musicalGridRehearsalFillVisible,
                metronomeClickEnabled,
            },
            monitorPrefs: reviewMonitorPrefsForExport(),
            timecodeOverlay:
                typeof getTimecodeOverlayPersistSnapshot === 'function'
                    ? getTimecodeOverlayPersistSnapshot()
                    : null,
            session: sessionRowForManifest(sessionRow, exportMedia),
            blobOrder: [],
        };
        const { blobs, order } = await collectExportBlobs(sessionRow, exportMedia);
        manifest.blobOrder = order;
        return { manifest, blobs };
    }

    function packMgacr(manifest, blobs) {
        const enc = new TextEncoder();
        const manifestUtf8 = enc.encode(JSON.stringify(manifest));
        let total = MGACR_MAGIC.length + 4 + manifestUtf8.length;
        const order = Array.isArray(manifest.blobOrder) ? manifest.blobOrder : [];
        const parts = [];
        for (const key of order) {
            const ab = blobs[key];
            if (!ab || ab.byteLength < 1) continue;
            parts.push({ key, ab });
            total += 4 + ab.byteLength;
        }
        const out = new Uint8Array(total);
        const view = new DataView(out.buffer);
        let off = 0;
        out.set(MGACR_MAGIC, off);
        off += MGACR_MAGIC.length;
        view.setUint32(off, manifestUtf8.length, true);
        off += 4;
        out.set(manifestUtf8, off);
        off += manifestUtf8.length;
        for (const { ab } of parts) {
            view.setUint32(off, ab.byteLength, true);
            off += 4;
            out.set(new Uint8Array(ab), off);
            off += ab.byteLength;
        }
        return out.buffer.slice(0, off);
    }

    function unpackMgacr(buffer) {
        const u8 = new Uint8Array(buffer);
        if (u8.length < MGACR_MAGIC.length + 4) {
            throw new Error('File too small');
        }
        for (let i = 0; i < MGACR_MAGIC.length; i++) {
            if (u8[i] !== MGACR_MAGIC[i]) throw new Error('Not a MGA CineAudio session file');
        }
        const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        let off = MGACR_MAGIC.length;
        const manifestLen = view.getUint32(off, true);
        off += 4;
        if (manifestLen < 1 || off + manifestLen > u8.length) {
            throw new Error('Invalid manifest length');
        }
        const manifestJson = new TextDecoder().decode(u8.subarray(off, off + manifestLen));
        off += manifestLen;
        const manifest = JSON.parse(manifestJson);
        if (!manifest || manifest.format !== EXPORT_FORMAT) {
            throw new Error('Unsupported export format');
        }
        const blobs = {};
        const order = Array.isArray(manifest.blobOrder) ? manifest.blobOrder : [];
        for (const key of order) {
            if (off + 4 > u8.length) throw new Error('Truncated blob header');
            const len = view.getUint32(off, true);
            off += 4;
            if (len < 1 || off + len > u8.length) throw new Error('Truncated blob data');
            blobs[key] = u8.buffer.slice(u8.byteOffset + off, u8.byteOffset + off + len);
            off += len;
        }
        return { manifest, blobs };
    }

    function manifestToSessionRow(manifest, blobs) {
        const sess = manifest.session;
        if (!sess || typeof sess !== 'object') return null;
        const row = {
            v: sess.v,
            laneUi: sess.laneUi,
            musicalGrid: sess.musicalGrid,
            musicalGridVisible: sess.musicalGridVisible,
            musicalGridRehearsalFillVisible: sess.musicalGridRehearsalFillVisible,
            metronomeClickEnabled: sess.metronomeClickEnabled,
            mName: sess.mName,
            mLastModified: sess.mLastModified,
            markers: sess.markers,
            markerMemo: sess.markerMemo,
            playbackRegion: sess.playbackRegion,
            mix: sess.mix,
            videoPreviewGamma: sess.videoPreviewGamma,
            extraTracks: [],
        };
        if (sess.videoBlobKey && blobs[sess.videoBlobKey]) {
            row.mBlob = new Blob([blobs[sess.videoBlobKey]]);
        }
        if (Array.isArray(sess.extraTracks)) {
            for (const e of sess.extraTracks) {
                if (!e || typeof e.slot !== 'number') continue;
                const key = e.blobKey || 'extra' + e.slot;
                const ab = blobs[key];
                if (!ab || ab.byteLength < 1) continue;
                const trackRow = {
                    slot: e.slot,
                    name: e.name,
                    lastModified: e.lastModified,
                    byteLength: typeof e.byteLength === 'number' ? e.byteLength : ab.byteLength,
                    duration: e.duration,
                    peaks: e.peaks,
                    timelineStartSec: e.timelineStartSec,
                    blob: new Blob([ab]),
                };
                appendExtraTrackRegionFields(trackRow, e);
                if (Array.isArray(e.clips) && e.clips.length) {
                    trackRow.clips = [];
                    for (const clip of e.clips) {
                        if (!clip || !clip.id || clip.id === 'main') continue;
                        const clipKey = clip.blobKey || extraClipBlobKey(e.slot, clip.id);
                        const clipAb = blobs[clipKey];
                        if (!clipAb || clipAb.byteLength < 1) continue;
                        trackRow.clips.push({
                            id: clip.id,
                            name: clip.name,
                            lastModified: clip.lastModified,
                            byteLength:
                                typeof clip.byteLength === 'number'
                                    ? clip.byteLength
                                    : clipAb.byteLength,
                            duration: clip.duration,
                            peaks: clip.peaks,
                            blob: new Blob([clipAb]),
                        });
                    }
                    if (!trackRow.clips.length) delete trackRow.clips;
                }
                row.extraTracks.push(trackRow);
            }
        }
        const hasVideo = row.mBlob && (row.mBlob.size || 0) > 0;
        const hasExtra =
            Array.isArray(row.extraTracks) &&
            row.extraTracks.some((e) => e && e.blob && (e.byteLength || e.blob.size || 0) > 0);
        const hasMarkers = Array.isArray(row.markers) && row.markers.length > 0;
        if (!hasVideo && !hasExtra && !hasMarkers) return null;
        if (!hasVideo) row.audioOnlySession = true;
        return row;
    }

    function packageManifestHasVideoBlob(manifest, blobs) {
        const sess = manifest && manifest.session;
        if (!sess || !sess.videoBlobKey) return false;
        const ab = blobs && blobs[sess.videoBlobKey];
        return !!(ab && ab.byteLength > 0);
    }

    async function clearLoadedVideoForImport(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (typeof haltTransportForSessionMutation === 'function') {
            haltTransportForSessionMutation({ silent: true, clearLoopAndRegion: false });
        }
        if (typeof videoPanelHasVideo === 'function' && videoPanelHasVideo()) {
            if (typeof revokeVideoOnly === 'function') {
                revokeVideoOnly();
            } else if (typeof clearVideoPanel === 'function') {
                clearVideoPanel();
            }
        }
    }

    async function prepareImportWithoutVideo(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        logImportDetail('package has no video; clearing loaded video before restore');
        await clearLoadedVideoForImport(o);
        if (o.clearExtras && typeof clearAllExtraTracks === 'function') {
            clearAllExtraTracks();
        }
        if (o.clearMarkers && typeof clearMarkersForRevoke === 'function') {
            clearMarkersForRevoke();
        }
    }

    function applyExportPrefs(manifest) {
        const p = manifest.prefs && typeof manifest.prefs === 'object' ? manifest.prefs : {};
        if (p.laneUi && typeof applyWaveformLaneUiPersistSnapshot === 'function') {
            applyWaveformLaneUiPersistSnapshot(p.laneUi);
        }
        /* スペクトラム／メーター床は Import に含めない（localStorage のユーザー設定を維持） */
        const mp = manifest.monitorPrefs;
        if (
            mp &&
            typeof mp.masterVol === 'number' &&
            isFinite(mp.masterVol) &&
            typeof applyMonitorUiPersistSnapshot === 'function'
        ) {
            applyMonitorUiPersistSnapshot({ masterVol: mp.masterVol });
        }
        if (manifest.timecodeOverlay && typeof applyTimecodeOverlayPersistSnapshot === 'function') {
            applyTimecodeOverlayPersistSnapshot(manifest.timecodeOverlay);
        }
        const mg =
            p.musicalGrid && typeof p.musicalGrid === 'object'
                ? p.musicalGrid
                : null;
        if (mg && typeof applyMusicalGridPersistSnapshot === 'function') {
            const mgWithoutVisibility =
                typeof musicalGridPersistSnapWithoutVisibility === 'function'
                    ? musicalGridPersistSnapWithoutVisibility(mg)
                    : mg;
            applyMusicalGridPersistSnapshot(mgWithoutVisibility);
        }
        applyMusicalGridVisibilityPrefs(p);
        applyMetronomeClickPrefs(p);
        if (typeof drawMusicalGridOverlay === 'function') {
            drawMusicalGridOverlay();
        } else if (typeof updateRehearsalBoundaryOverlay === 'function') {
            updateRehearsalBoundaryOverlay();
        }
        if (typeof writePrefs === 'function') writePrefs();
    }

    /** YYYYMMDDHHmmss (no separators) */
    function exportDateStamp() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return (
            d.getFullYear() +
            pad(d.getMonth() + 1) +
            pad(d.getDate()) +
            pad(d.getHours()) +
            pad(d.getMinutes()) +
            pad(d.getSeconds())
        );
    }

    function sanitizeExportPathChars(name) {
        const s = String(name || '').trim();
        if (!s) return '';
        return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    }

    /** Leaf name without extension, safe for download filenames. */
    function exportBasenameWithoutExtension(name) {
        const safe = sanitizeExportPathChars(name);
        if (!safe) return '';
        const leaf = safe.replace(/^.*[/\\]/, '');
        const dot = leaf.lastIndexOf('.');
        if (dot > 0) return leaf.slice(0, dot);
        return leaf;
    }

    /** First loaded extra track waveform file name (full name with extension). */
    function firstLoadedExtraTrackWaveformName() {
        const count = getExtraTrackCount();
        if (typeof isExtraTrackLoaded !== 'function') return '';
        for (let i = 0; i < count; i++) {
            if (!isExtraTrackLoaded(i)) continue;
            if (typeof getExtraTracksPersistSnapshot === 'function') {
                const snap = getExtraTracksPersistSnapshot();
                if (Array.isArray(snap)) {
                    const entry = snap.find((e) => e && e.slot === i);
                    if (entry && entry.name) return entry.name;
                }
            }
            if (typeof extraTrackBySlot === 'function') {
                const tr = extraTrackBySlot(i);
                if (tr && tr.file && tr.file.name) return String(tr.file.name);
            }
        }
        return '';
    }

    function buildExportDownloadFilename(manifest, extOverride) {
        const stamp = exportDateStamp();
        let videoName = '';
        if (typeof fileMain !== 'undefined' && fileMain && fileMain.name) {
            videoName = fileMain.name;
        } else if (manifest && manifest.session && manifest.session.mName) {
            videoName = manifest.session.mName;
        }
        let base = exportBasenameWithoutExtension(videoName);
        if (!base) {
            let trackName = firstLoadedExtraTrackWaveformName();
            if (!trackName && manifest && manifest.session) {
                const extras = manifest.session.extraTracks;
                if (Array.isArray(extras) && extras.length > 0) {
                    let first = null;
                    for (const tr of extras) {
                        if (!tr || typeof tr.slot !== 'number' || !tr.name) continue;
                        if (!first || tr.slot < first.slot) first = tr;
                    }
                    if (first) trackName = first.name;
                }
            }
            base = exportBasenameWithoutExtension(trackName);
        }
        const ext =
            typeof extOverride === 'string' && extOverride.trim()
                ? extOverride.trim()
                : EXPORT_FILE_EXT;
        if (base) return base + '_' + stamp + ext;
        return 'Review_' + stamp + ext;
    }

    function buildVideoExportDownloadFilename() {
        const manifest = {
            session: {
                mName:
                    typeof fileMain !== 'undefined' && fileMain && fileMain.name
                        ? fileMain.name
                        : '',
            },
        };
        return buildExportDownloadFilename(manifest, '.webm');
    }

    function buildWaveExportDownloadFilename() {
        return buildExportDownloadFilename({ session: {} }, '.wav');
    }

    function getSessionExportMediaMode() {
        return isExportVideoAvailable() ? 'webm' : 'wave';
    }

    function updateSessionExportMediaBtnUi(hasVideo) {
        const btn = document.getElementById('sessionExportVideoBtn');
        if (!btn) return;
        const mode = hasVideo ? 'webm' : 'wave';
        const label = hasVideo ? msg('ui.sessionExportMediaBtn.webm') : msg('ui.sessionExportMediaBtn.wave');
        const title = hasVideo ? msg('tooltip.sessionExportWebm') : msg('tooltip.sessionExportWave');
        btn.textContent = label;
        btn.title = title;
        btn.dataset.exportMediaMode = mode;
        btn.classList.toggle('session-io-btn--export-webm', mode === 'webm');
        btn.classList.toggle('session-io-btn--export-wave', mode === 'wave');
    }

    function triggerDownload(buffer, filename) {
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    async function exportSessionPackage() {
        const exportMedia = getExportMediaOptionsFromUi();
        const mediaSummary = [];
        if (exportMedia.includeVideo) mediaSummary.push('video');
        for (let i = 0; i < exportMedia.includeExtra.length; i++) {
            if (exportMedia.includeExtra[i]) mediaSummary.push('Ex' + (i + 1));
        }
        logExportDetail(
            'started (flushing session, building package…' +
                (mediaSummary.length
                    ? '; media: ' + mediaSummary.join(', ')
                    : '; media: none (settings only)') +
                ')',
        );
        const { manifest, blobs } = await buildExportManifest(exportMedia);
        const packed = packMgacr(manifest, blobs);
        const downloadName = buildExportDownloadFilename(manifest);
        triggerDownload(packed, downloadName);
        logExportReviewDetails(manifest, blobs, packed, downloadName);
    }

    function pauseTransportForImportReview() {
        const playing =
            typeof isTransportPlaying === 'function'
                ? isTransportPlaying()
                : !!(typeof videoMain !== 'undefined' && videoMain && !videoMain.paused);
        if (playing && typeof haltTransportForSessionMutation === 'function') {
            haltTransportForSessionMutation({ silent: true, clearLoopAndRegion: false });
        } else if (playing) {
            if (typeof transportPlayGeneration !== 'undefined') {
                transportPlayGeneration += 1;
            }
            if (typeof transportPlayInFlight !== 'undefined') {
                transportPlayInFlight = null;
            }
            if (typeof clearTransportTailPlayback === 'function') {
                clearTransportTailPlayback();
            }
            if (typeof videoMain !== 'undefined' && videoMain) {
                videoMain.pause();
            }
            if (typeof stopAllExtraTrackSources === 'function') {
                stopAllExtraTrackSources();
            }
            if (typeof setPlayingUi === 'function') setPlayingUi(false);
            if (typeof stopRaf === 'function') stopRaf();
        }
        if (typeof applySessionTransportAtHead === 'function') {
            applySessionTransportAtHead();
        } else if (typeof setTransportSec === 'function') {
            setTransportSec(0);
            if (typeof seekBar !== 'undefined' && seekBar) seekBar.value = '0';
            if (typeof updateSeekUiFromVideo === 'function') updateSeekUiFromVideo();
            if (typeof updateAllWaveformPlayheads === 'function') {
                updateAllWaveformPlayheads();
            }
        }
    }

    function refreshTransportControlsAfterImport() {
        const tick = () => {
            if (typeof updateControlsEnabled === 'function') {
                updateControlsEnabled();
            } else if (typeof updateSessionAllClearButton === 'function') {
                updateSessionAllClearButton();
            }
            if (typeof refreshExportMediaOptionsUi === 'function') {
                refreshExportMediaOptionsUi();
            }
            if (typeof ensureDefaultActiveMixExtraSlot === 'function') {
                ensureDefaultActiveMixExtraSlot();
            }
        };
        tick();
        requestAnimationFrame(tick);
        window.setTimeout(tick, 0);
        window.setTimeout(tick, 400);
    }

    async function importSessionPackage(file) {
        pauseTransportForImportReview();
        try {
            assertMgacrReviewFile(file);
            const maxBytes = 4 * 1024 * 1024 * 1024;
            if (file.size > maxBytes) {
                throw new Error('File exceeds 4 GB limit');
            }
            logImportDetail(
                'started — reading "' +
                    file.name +
                    '" (' +
                    formatByteSize(file.size) +
                    ')',
            );
            const buffer = await file.arrayBuffer();
            const { manifest, blobs } = unpackMgacr(buffer);
            logImportDetail(
                'package parsed (format ' +
                    manifest.format +
                    (manifest.appVersion ? ', exported with ' + manifest.appVersion : '') +
                    ')',
            );
            if (typeof validateImportManifest === 'function') {
                const check = validateImportManifest(manifest);
                if (!check.valid) {
                    if (typeof rejectInvalidSessionData === 'function') {
                        await rejectInvalidSessionData('import review package', check.reason);
                    }
                    return;
                }
            }
            const restoreWasActive =
                (typeof isSessionRestoreInProgress === 'function' &&
                    isSessionRestoreInProgress()) ||
                (typeof isSessionRestoreTeardownPending === 'function' &&
                    isSessionRestoreTeardownPending());
            if (typeof abortPendingSessionRestore === 'function') {
                if (restoreWasActive) {
                    logImportDetail('cancelling in-progress session restore…');
                }
                await abortPendingSessionRestore();
            }
            if (typeof clearEntireSession === 'function') {
                logImportDetail('All Clear before restore…');
                await clearEntireSession();
            }
            applyExportPrefs(manifest);

            const row = manifestToSessionRow(manifest, blobs);
            const packageHasVideo = packageManifestHasVideoBlob(manifest, blobs);
            if (!row) {
                if (!packageHasVideo) {
                    await clearLoadedVideoForImport();
                }
                if (typeof applySessionTransportAtHead === 'function') {
                    applySessionTransportAtHead();
                }
                logImportReviewSettingsOnly(manifest, file);
                return;
            }

            if (typeof importAndPersistSessionRow !== 'function') {
                throw new Error('Import handler unavailable');
            }
            const hasVideo = row.mBlob && (row.mBlob.size || 0) > 0;
            if (!hasVideo) {
                await prepareImportWithoutVideo({ clearExtras: true, clearMarkers: true });
                logImportDetail(
                    'restoring audio-only session' +
                        (Array.isArray(row.extraTracks) && row.extraTracks.length
                            ? ' (' + row.extraTracks.length + ' extra track(s))…'
                            : '…'),
                );
            } else {
                logImportDetail(
                    'restoring video "' +
                        (row.mName || 'video') +
                        '"' +
                        (Array.isArray(row.extraTracks) && row.extraTracks.length
                            ? ' and ' + row.extraTracks.length + ' extra audio track(s)…'
                            : '…'),
                );
            }
            await importAndPersistSessionRow(row, { importReview: true });
            if (typeof whenSessionRestoreIdle === 'function') {
                await whenSessionRestoreIdle();
            }
            logImportReviewSuccess(manifest, file, row);
        } finally {
            if (typeof whenSessionRestoreIdle === 'function') {
                try {
                    await whenSessionRestoreIdle();
                } catch (_) {}
            }
            if (typeof resetWaveformTimelineZoom === 'function') {
                resetWaveformTimelineZoom();
            }
            refreshTransportControlsAfterImport();
        }
    }

    function runImportReviewFromFile(file, opt) {
        if (!file) return Promise.resolve();
        if (!isMgacrReviewFile(file)) {
            const rejectMsg =
                'Import Review accepts .mgacr files only (selected: "' +
                (file.name || 'unknown') +
                '")';
            logImportAction('rejected — ' + rejectMsg, { level: 'error' });
            if (typeof showAppAlert === 'function') {
                showAppAlert(msg('dialog.import.cannotTitle'), rejectMsg, { log: false });
            }
            return Promise.resolve();
        }
        const importBtn =
            (opt && opt.importBtn) || document.getElementById('sessionImportBtn');
        if (importBtn) importBtn.disabled = true;
        return importSessionPackage(file)
            .catch((e) => {
                const errMsg = e && e.message ? e.message : String(e);
                const src = file.name + ' (' + formatByteSize(file.size) + ')';
                logImportAction('failed — ' + errMsg, { level: 'error' });
                logImportDetail('source was "' + src + '"');
                if (e && e.stack) {
                    logImportDetail('error detail — ' + String(e.stack).split('\n')[0]);
                }
                if (typeof showAppAlert === 'function') {
                    showAppAlert(msg('dialog.import.failedTitle'), errMsg, { log: false });
                }
            })
            .finally(() => {
                if (importBtn) importBtn.disabled = false;
                refreshTransportControlsAfterImport();
            });
    }

    window.exportSessionPackage = exportSessionPackage;
    window.importSessionPackage = importSessionPackage;
    window.runImportReviewFromFile = runImportReviewFromFile;
    window.refreshExportMediaOptionsUi = refreshExportMediaOptionsUi;
    window.buildVideoExportDownloadFilename = buildVideoExportDownloadFilename;
    window.buildWaveExportDownloadFilename = buildWaveExportDownloadFilename;
    window.getSessionExportMediaMode = getSessionExportMediaMode;
    window.updateSessionExportMediaBtnUi = updateSessionExportMediaBtnUi;
    window.getExportMediaOptionsFromUi = getExportMediaOptionsFromUi;

    function triggerExportVideo(exportVideoBtn) {
        const btn = exportVideoBtn || document.getElementById('sessionExportVideoBtn');
        if (!btn || btn.disabled) return;
        refreshExportMediaOptionsUi();
        const media = getExportMediaOptionsFromUi();
        const mode = getSessionExportMediaMode();
        if (mode === 'wave') {
            if (
                typeof hasPlayableWaveformTimeline !== 'function' ||
                !hasPlayableWaveformTimeline()
            ) {
                if (typeof showAppAlert === 'function') {
                    showAppAlert(
                        msg('dialog.exportWave.cannotTitle'),
                        msg('dialog.exportWave.noTracksBody'),
                        { logLine: msg('log.exportWave.noTracks') },
                    );
                }
                return;
            }
            if (!media.includeAudio) {
                const noticePromise =
                    typeof requestAppNotice === 'function'
                        ? requestAppNotice(
                              msg('dialog.exportWave.title'),
                              msg('dialog.exportWave.includeAudioNotice'),
                              {
                                  logLine: msg('log.exportWave.includeAudioNotice'),
                              },
                          )
                        : Promise.resolve(true);
                void noticePromise;
                return;
            }
            const hasIncludedExtra =
                Array.isArray(media.includeExtra) && media.includeExtra.some(Boolean);
            if (!hasIncludedExtra) {
                if (typeof showAppAlert === 'function') {
                    showAppAlert(
                        msg('dialog.exportWave.cannotTitle'),
                        msg('dialog.exportWave.noSelectionBody'),
                        { logLine: msg('log.exportWave.noSelection') },
                    );
                }
                return;
            }
            if (typeof exportReviewWavePackage !== 'function') {
                if (typeof showAppAlert === 'function') {
                    showAppAlert(
                        msg('dialog.exportWave.unavailableTitle'),
                        msg('dialog.exportWave.unavailableBody'),
                        { logLine: msg('log.exportWave.unavailable') },
                    );
                }
                return;
            }
            btn.disabled = true;
            exportReviewWavePackage({ exportMedia: media })
                .catch((e) => {
                    const errMsg = e && e.message ? e.message : String(e);
                    if (errMsg === 'Export cancelled') return;
                    logExportAction('Wave failed — ' + errMsg, { level: 'error' });
                    if (typeof showAppAlert === 'function') {
                        showAppAlert(msg('dialog.exportWave.failedTitle'), errMsg, { log: false });
                    }
                })
                .finally(() => {
                    if (typeof refreshExportMediaOptionsUi === 'function') {
                        refreshExportMediaOptionsUi();
                    } else {
                        btn.disabled = false;
                    }
                });
            return;
        }
        if (!isExportVideoAvailable()) {
            if (typeof showAppAlert === 'function') {
                showAppAlert(
                    msg('dialog.exportWebm.cannotTitle'),
                    msg('dialog.exportWebm.noVideoBody'),
                    { logLine: msg('log.exportWebm.noVideo') },
                );
            }
            return;
        }
        if (!media.includeVideo) {
            const noticePromise =
                typeof requestAppNotice === 'function'
                    ? requestAppNotice(
                          msg('dialog.exportWebm.title'),
                          msg('dialog.exportWebm.includeVideoNotice'),
                          {
                              logLine: msg('log.exportWebm.includeVideoNotice'),
                          },
                      )
                    : Promise.resolve(true);
            void noticePromise;
            return;
        }
        if (typeof exportReviewVideoPackage !== 'function') {
            if (typeof showAppAlert === 'function') {
                showAppAlert(
                    msg('dialog.exportWebm.unavailableTitle'),
                    msg('dialog.exportWebm.unavailableBody'),
                    { logLine: msg('log.exportWebm.unavailable') },
                );
            }
            return;
        }
        btn.disabled = true;
        exportReviewVideoPackage({ exportMedia: media })
            .catch((e) => {
                const errMsg = e && e.message ? e.message : String(e);
                if (errMsg === 'Export cancelled') return;
                logExportAction('WebM failed — ' + errMsg, { level: 'error' });
                if (typeof showAppAlert === 'function') {
                    showAppAlert(msg('dialog.exportWebm.failedTitle'), errMsg, { log: false });
                }
            })
            .finally(() => {
                if (typeof refreshExportMediaOptionsUi === 'function') {
                    refreshExportMediaOptionsUi();
                } else {
                    btn.disabled = false;
                }
            });
    }

    function triggerExportReview(exportBtn) {
        const btn = exportBtn || document.getElementById('sessionExportBtn');
        if (!btn || btn.disabled) return;
        refreshExportMediaOptionsUi();
        btn.disabled = true;
        exportSessionPackage()
            .catch((e) => {
                const errMsg = e && e.message ? e.message : String(e);
                logExportAction('failed — ' + errMsg, { level: 'error' });
                if (e && e.stack) {
                    logExportDetail('error detail — ' + String(e.stack).split('\n')[0]);
                }
                if (typeof showAppAlert === 'function') {
                    showAppAlert(msg('dialog.export.failedTitle'), errMsg, { log: false });
                }
            })
            .finally(() => {
                if (typeof refreshExportMediaOptionsUi === 'function') {
                    refreshExportMediaOptionsUi();
                } else {
                    btn.disabled = false;
                }
            });
    }

    function triggerImportReview(importBtn, importFile) {
        const btn = importBtn || document.getElementById('sessionImportBtn');
        const fileInput = importFile || document.getElementById('sessionImportFile');
        if (!btn || !fileInput || btn.disabled) return;
        pauseTransportForImportReview();
        fileInput.value = '';
        fileInput.click();
    }

    function triggerAllClear(allClearBtn, opt) {
        const btn = allClearBtn || document.getElementById('sessionAllClearBtn');
        const allowWhileRestoreLock =
            !!(opt && opt.allowWhileRestoreLock) &&
            typeof isWaveformRestoreLockActive === 'function' &&
            isWaveformRestoreLockActive();
        if (!btn || (!allowWhileRestoreLock && btn.disabled)) return;
        pauseTransportForImportReview();
        const confirmPromise =
            typeof requestAppConfirm === 'function'
                ? requestAppConfirm(
                      msg('dialog.allClear.title'),
                      msg('dialog.allClear.body'),
                      msg('log.dialog.allClear.cancelled'),
                      {
                          logLine: msg('log.dialog.allClear.confirm'),
                      },
                  )
                : Promise.resolve(false);
        void confirmPromise.then((confirmed) => {
            if (!confirmed) return;
            btn.disabled = true;
            const run =
                typeof clearEntireSession === 'function'
                    ? clearEntireSession()
                    : Promise.resolve();
            Promise.resolve(run)
                .catch((e) => {
                    const errMsg = e && e.message ? e.message : String(e);
                    if (typeof clearLog === 'function') clearLog();
                    if (typeof writeActionLog === 'function') {
                        writeActionLog('Session', 'All Clear failed — ' + errMsg, { level: 'error' });
                    } else {
                        writeLog('Session: All Clear failed — ' + errMsg);
                    }
                    if (typeof showAppAlert === 'function') {
                        showAppAlert(msg('dialog.allClear.failedTitle'), errMsg, { log: false });
                    }
                })
                .finally(() => {
                    if (typeof updateSessionAllClearButton === 'function') {
                        updateSessionAllClearButton();
                    }
                });
        });
    }

    function handleSessionIoShortcutKeydown(e) {
        if (!e || e.repeat) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return false;
        if (matchUserShortcut(e, 'sessionAllClear')) {
            e.preventDefault();
            const duringRestoreLock =
                typeof isWaveformRestoreLockActive === 'function' &&
                isWaveformRestoreLockActive();
            triggerAllClear(null, { allowWhileRestoreLock: duringRestoreLock });
            return true;
        }

        if (matchUserShortcut(e, 'sessionImport')) {
            e.preventDefault();
            triggerImportReview();
            return true;
        }
        if (matchUserShortcut(e, 'sessionExport')) {
            e.preventDefault();
            triggerExportReview();
            return true;
        }
        return false;
    }

    window.handleSessionIoShortcutKeydown = handleSessionIoShortcutKeydown;

    function bindSessionIoUi() {
        const exportBtn = document.getElementById('sessionExportBtn');
        const importBtn = document.getElementById('sessionImportBtn');
        const allClearBtn = document.getElementById('sessionAllClearBtn');
        const importFile = document.getElementById('sessionImportFile');
        const sessionIoRow = document.querySelector('.transport-bar__row--export');
        if (!exportBtn || !importBtn || !importFile) return;

        try {
            applyExportMediaIncludePrefs(readExportMediaIncludePrefs());
            refreshExportMediaOptionsUi();
            if (typeof updateSessionAllClearButton === 'function') {
                updateSessionAllClearButton();
            }
            bindExportMediaIncludeCheckboxPersistence();
        } catch (e) {
            const msg = e && e.message ? e.message : String(e);
            if (typeof writeDetailLog === 'function') {
                writeDetailLog('Session', 'IO UI init refresh incomplete — ' + msg);
            } else if (typeof writeLog === 'function') {
                writeLog('Session IO UI: init refresh incomplete — ' + msg);
            }
        }
        if (typeof whenSessionRestoreIdle === 'function') {
            void whenSessionRestoreIdle().then(() => {
                refreshExportMediaOptionsUi();
                if (typeof updateSessionAllClearButton === 'function') {
                    updateSessionAllClearButton();
                }
            });
        }
        if (sessionIoRow) {
            sessionIoRow.addEventListener('mouseenter', refreshExportMediaOptionsUi);
            sessionIoRow.addEventListener('focusin', refreshExportMediaOptionsUi);
        }
        const mediaOpts = document.getElementById('sessionExportMediaOpts');
        if (mediaOpts) {
            const mo = new MutationObserver(refreshExportMediaOptionsUi);
            const count = getExtraTrackCount();
            for (let i = 0; i < count; i++) {
                const meta = document.getElementById('extraAudioMeta' + i);
                if (meta) mo.observe(meta, { attributes: true, attributeFilter: ['hidden'] });
            }
            if (typeof nameMain !== 'undefined' && nameMain) {
                mo.observe(nameMain, { childList: true, characterData: true, subtree: true });
            }
        }

        if (allClearBtn) {
            allClearBtn.addEventListener('click', () => triggerAllClear(allClearBtn));
        }

        exportBtn.addEventListener('click', () => triggerExportReview(exportBtn));

        const exportVideoBtn = document.getElementById('sessionExportVideoBtn');
        if (exportVideoBtn) {
            exportVideoBtn.addEventListener('click', () => triggerExportVideo(exportVideoBtn));
        }

        importBtn.addEventListener('click', () => triggerImportReview(importBtn, importFile));

        importFile.addEventListener('change', () => {
            const f = importFile.files && importFile.files[0];
            if (!f) return;
            void runImportReviewFromFile(f, { importBtn }).finally(() => {
                importFile.value = '';
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindSessionIoUi);
    } else {
        bindSessionIoUi();
    }
})();
