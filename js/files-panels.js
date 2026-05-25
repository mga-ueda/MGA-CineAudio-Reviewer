    const VIDEO_FILE_EXT = new Set([
        '.mp4', '.m4v', '.webm', '.ogv', '.mov', '.qt', '.avi', '.mkv', '.wmv', '.flv',
        '.ts', '.mts', '.m2ts', '.mpg', '.mpeg', '.m1v', '.m2v', '.3gp', '.3g2', '.asf', '.f4v',
    ]);

    function fileExtLower(name) {
        const s = String(name || '').toLowerCase();
        const dot = s.lastIndexOf('.');
        if (dot < 0) return '';
        return s.slice(dot);
    }

    function mimeTypeHintForVideoFileName(name) {
        const ext = fileExtLower(name);
        const map = {
            '.webm': 'video/webm',
            '.mp4': 'video/mp4',
            '.m4v': 'video/mp4',
            '.mov': 'video/quicktime',
            '.qt': 'video/quicktime',
            '.ogv': 'video/ogg',
            '.avi': 'video/x-msvideo',
            '.mkv': 'video/x-matroska',
            '.wmv': 'video/x-ms-wmv',
            '.flv': 'video/x-flv',
            '.ts': 'video/mp2t',
            '.mts': 'video/mp2t',
            '.m2ts': 'video/mp2t',
            '.mpg': 'video/mpeg',
            '.mpeg': 'video/mpeg',
            '.m1v': 'video/mpeg',
            '.m2v': 'video/mpeg',
            '.3gp': 'video/3gpp',
            '.3g2': 'video/3gpp2',
            '.asf': 'video/x-ms-asf',
            '.f4v': 'video/mp4',
        };
        return map[ext] || 'application/octet-stream';
    }

    function isUsableVideoFile(f) {
        const type = (f.type || '').toLowerCase();
        if (type.startsWith('video/')) return true;
        if (type === 'application/mp4' || type === 'application/x-mp4') return true;
        if (type.startsWith('audio/') || type.startsWith('image/') || type.startsWith('text/')) {
            return false;
        }
        const ext = fileExtLower(f.name);
        if (!ext || !VIDEO_FILE_EXT.has(ext)) return false;
        return !type || type === 'application/octet-stream' || type.startsWith('application/');
    }

    function pickVideoFiles(fileList) {
        return Array.from(fileList).filter(isUsableVideoFile);
    }

    const AUDIO_FILE_EXT = new Set([
        '.wav',
        '.wave',
        '.flac',
        '.ogg',
        '.oga',
        '.mp3',
        '.m4a',
        '.aac',
        '.aif',
        '.aiff',
        '.wma',
        '.opus',
        '.webm',
    ]);

    function isUsableAudioFile(f) {
        const type = (f.type || '').toLowerCase();
        if (type.startsWith('audio/')) return true;
        const ext = fileExtLower(f.name);
        if (ext && AUDIO_FILE_EXT.has(ext)) return true;
        if (
            !type ||
            type === 'application/octet-stream' ||
            type.startsWith('application/')
        ) {
            return !!(ext && AUDIO_FILE_EXT.has(ext));
        }
        return false;
    }

    function pickAudioFiles(fileList) {
        return Array.from(fileList).filter(isUsableAudioFile);
    }

    function formatFileDateEn(ms) {
        try {
            return new Date(ms).toLocaleString('en-CA', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
            });
        } catch (_) {
            return '';
        }
    }

    function setInfoMainMetaText(text) {
        if (infoMainMeta) {
            infoMainMeta.textContent = text;
        } else if (infoMain) {
            infoMain.textContent = text;
        }
    }

    function updatePanelInfoLine() {
        if (!fileMain) {
            infoMain.hidden = true;
            setInfoMainMetaText('');
            if (typeof refreshVideoDriftPanelStat === 'function') {
                refreshVideoDriftPanelStat();
            }
            return;
        }
        const mod = 'Modified: ' + formatFileDateEn(fileMain.lastModified);
        const d = getDuration(videoMain);
        if (!d) {
            infoMain.hidden = false;
            setInfoMainMetaText(mod);
            if (typeof refreshVideoDriftPanelStat === 'function') {
                refreshVideoDriftPanelStat();
            }
            return;
        }
        const c = containerFps.main;
        const totalF = totalFrameCountForSide('main');
        let fpsStr;
        if (c != null && c > 0) {
            fpsStr = c + ' fps';
        } else {
            fpsStr = 'FPS n/a (~' + DISPLAY_FPS + ' est.)';
        }
        infoMain.hidden = false;
        setInfoMainMetaText(mod + ' · ' + fpsStr + ' · Total: ' + totalF + ' f');
        if (typeof refreshVideoDriftPanelStat === 'function') {
            refreshVideoDriftPanelStat();
        }
    }

    function revokeVideoMediaCore() {
        if (typeof cancelVideoLoadLock === 'function') {
            cancelVideoLoadLock();
        }
        containerFps.main = null;
        containerSampleCount.main = null;
        containerStszSampleCount.main = null;
        containerTimelineFrameOffset.main = 0;
        containerMediaDurationSec.main = null;
        containerHasAudio.main = null;
        infoMain.hidden = true;
        setInfoMainMetaText('');
        if (videoDriftPanelStat) videoDriftPanelStat.textContent = '';
        if (urlMain) URL.revokeObjectURL(urlMain);
        urlMain = null;
        fileMain = null;
        videoMain.removeAttribute('src');
        videoMain.load();
        nameMain.textContent = 'Not Loaded';
        setLoaded(panelMain, false);
    }

    /** Unload video only; markers and waveform lanes (incl. extra tracks) stay. */
    function revokeVideoOnly() {
        revokeVideoMediaCore();
        if (typeof resetAudioWaveformForNewVideo === 'function') {
            resetAudioWaveformForNewVideo();
        }
        if (typeof resetVideoMix === 'function') resetVideoMix();
        if (typeof dismissVideoAudioLane === 'function') {
            dismissVideoAudioLane();
        } else if (typeof refreshVideoAudioLaneVisibility === 'function') {
            refreshVideoAudioLaneVisibility();
        }
        if (typeof refreshVideoDriftPanelStat === 'function') {
            refreshVideoDriftPanelStat();
        }
        if (typeof refreshExportMediaOptionsUi === 'function') {
            refreshExportMediaOptionsUi();
        }
        if (typeof updateTimecodeOverlay === 'function') updateTimecodeOverlay();
        if (typeof updateMarkerCommentOverlay === 'function') updateMarkerCommentOverlay();
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        updateVideoClearButton();
    }

    function revokeAll() {
        revokeVideoMediaCore();
        if (typeof clearMarkersForRevoke === 'function') clearMarkersForRevoke();
        if (typeof clearAudioWaveform === 'function') clearAudioWaveform();
        if (typeof clearAllExtraTracks === 'function') clearAllExtraTracks();
        if (typeof resetVideoMix === 'function') resetVideoMix();
        if (typeof dismissVideoAudioLane === 'function') {
            dismissVideoAudioLane();
        } else if (typeof showVideoAudioLane === 'function') {
            showVideoAudioLane();
        }
        if (typeof refreshExportMediaOptionsUi === 'function') {
            refreshExportMediaOptionsUi();
        }
        if (typeof refreshVideoDriftPanelStat === 'function') {
            refreshVideoDriftPanelStat();
        }
        if (typeof updateTimecodeOverlay === 'function') updateTimecodeOverlay();
        if (typeof updateMarkerCommentOverlay === 'function') updateMarkerCommentOverlay();
        updateVideoClearButton();
        if (typeof updateSessionAllClearButton === 'function') updateSessionAllClearButton();
    }

    function sessionHasClearableContent() {
        if (
            typeof window.hasSessionMarkersPendingRestore === 'function' &&
            window.hasSessionMarkersPendingRestore()
        ) {
            return true;
        }
        if (
            typeof window.hasMarkerContentToClear === 'function' &&
            window.hasMarkerContentToClear()
        ) {
            return true;
        }
        if (
            typeof hasPlayableWaveformTimeline === 'function' &&
            hasPlayableWaveformTimeline()
        ) {
            return true;
        }
        if (
            typeof window.hasAnyExtraTrackTimelineContent === 'function' &&
            window.hasAnyExtraTrackTimelineContent()
        ) {
            return true;
        }
        if (
            typeof transportControlsReady === 'function' &&
            transportControlsReady()
        ) {
            return true;
        }
        if (typeof fileMain !== 'undefined' && !!fileMain) {
            return true;
        }
        return false;
    }

    function updateSessionAllClearButton() {
        const btn = document.getElementById('sessionAllClearBtn');
        if (!btn) return;
        btn.disabled = !sessionHasClearableContent();
    }

    async function clearEntireSession() {
        if (!sessionHasClearableContent()) {
            if (typeof clearLog === 'function') clearLog();
            writeLog('Session: nothing to clear');
            return;
        }
        if (typeof haltTransportForSessionMutation === 'function') {
            haltTransportForSessionMutation({ silent: true });
        }
        if (typeof pendingRestoreTime !== 'undefined') pendingRestoreTime = null;
        if (typeof pendingLaneUiRestore !== 'undefined') pendingLaneUiRestore = null;
        if (typeof setSessionMixRestore === 'function') setSessionMixRestore(null);
        if (typeof resetTransportPlaybackClock === 'function') {
            resetTransportPlaybackClock();
        }
        if (typeof deleteStoredSession === 'function') {
            await deleteStoredSession();
        }
        if (typeof resetMasterVolumeForSessionClear === 'function') {
            resetMasterVolumeForSessionClear();
        }
        revokeAll();
        if (typeof resetVideoDriftMonitorSchedule === 'function') {
            resetVideoDriftMonitorSchedule();
        }
        if (typeof refreshVideoDriftPanelStat === 'function') {
            refreshVideoDriftPanelStat();
        }
        if (typeof syncSeekMax === 'function') syncSeekMax();
        if (typeof updateControlsEnabled === 'function') updateControlsEnabled();
        if (typeof refreshExportMediaOptionsUi === 'function') {
            refreshExportMediaOptionsUi();
        }
        updateSessionAllClearButton();
        if (typeof clearLog === 'function') clearLog();
        writeLog('Session: all cleared (video, audio tracks, markers, saved session)');
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Session', 'All cleared', 'notice');
        }
    }

    window.clearEntireSession = clearEntireSession;
    window.updateSessionAllClearButton = updateSessionAllClearButton;

    function videoPanelHasVideo() {
        return typeof fileMain !== 'undefined' && !!fileMain;
    }

    function updateVideoClearButton() {
        const btn = document.getElementById('videoClearBtn');
        if (!btn) return;
        btn.disabled = !videoPanelHasVideo();
    }

    function clearVideoPanel() {
        if (!videoPanelHasVideo()) {
            writeLog('Video: nothing to clear');
            return;
        }
        const name = fileMain && fileMain.name ? fileMain.name : 'video';
        if (typeof haltTransportForSessionMutation === 'function') {
            haltTransportForSessionMutation({ silent: true });
        }
        revokeVideoOnly();
        if (typeof syncSeekMax === 'function') syncSeekMax();
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        if (typeof syncAudioOnlyMarkersUi === 'function') {
            syncAudioOnlyMarkersUi();
        } else if (typeof adoptMarkersForAudioOnlySession === 'function') {
            adoptMarkersForAudioOnlySession();
        } else if (typeof refreshMarkerUi === 'function') {
            refreshMarkerUi();
        }
        if (typeof updateControlsEnabled === 'function') updateControlsEnabled();
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        if (typeof updateTimecodeOverlay === 'function') updateTimecodeOverlay();
        if (typeof updateMarkerCommentOverlay === 'function') updateMarkerCommentOverlay();
        updateVideoClearButton();
        writeLog('Video: cleared (“' + name + '” unloaded); markers and waveform tracks kept');
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Video', 'Cleared', 'notice');
        }
    }

    /** 動画ファイル差し替えのみ（マーカー・Ex トラック・ミックスは維持） */
    function replaceVideoMediaForLoad() {
        revokeVideoMediaCore();
    }

    window.updateVideoClearButton = updateVideoClearButton;
    window.clearVideoPanel = clearVideoPanel;
    window.videoPanelHasVideo = videoPanelHasVideo;
    window.revokeVideoOnly = revokeVideoOnly;
    window.replaceVideoMediaForLoad = replaceVideoMediaForLoad;

    function setLoaded(panel, loaded) {
        panel.classList.toggle('loaded', !!loaded);
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function fpsFloatForSide(side) {
        const c = containerFps[side];
        return c != null && c > 0 ? c : DISPLAY_FPS;
    }

    function masterFpsFloatForTransport() {
        return fpsFloatForSide('main');
    }

    function ntscFrameRateKind(fps) {
        const f = fps;
        if (Math.abs(f - 23.976) < 0.02 || Math.abs(f - 29.97) < 0.02 || Math.abs(f - 59.94) < 0.02) {
            return 'drop';
        }
        return 'integer';
    }

    function tcModulusFps(fpsFloat) {
        return ntscFrameRateKind(fpsFloat) === 'drop' ? 30 : Math.max(1, Math.round(fpsFloat));
    }

    function linearFrameIndexFromSec(sec, fpsFloat) {
        const fMod = tcModulusFps(fpsFloat);
        const s = Math.max(0, sec);
        if (ntscFrameRateKind(fpsFloat) === 'drop') {
            const totalSec = Math.floor(s);
            const ff = Math.round((s - totalSec) * fMod);
            const h = Math.floor(totalSec / 3600);
            const m = Math.floor((totalSec % 3600) / 60);
            const secPart = totalSec % 60;
            return h * 108000 + m * 1800 + secPart * 30 + Math.min(ff, fMod - 1);
        }
        return Math.round(s * fpsFloat);
    }

    function lastFrameIndexFromDurationSec(sec, fpsFloat) {
        const d = Math.max(0, sec);
        if (d <= 0) return 0;
        return Math.max(0, linearFrameIndexFromSec(d - 1 / fpsFloat, fpsFloat));
    }

    function frameCountFromDurationSec(sec, fpsFloat) {
        return lastFrameIndexFromDurationSec(sec, fpsFloat) + 1;
    }

    function clampFrameIndexToClip(idx, side) {
        const maxIdx = Math.max(0, totalFrameCountForSide(side) - 1);
        return Math.max(0, Math.min(idx | 0, maxIdx));
    }

    function mediaDurationSecForSide(side) {
        const md = containerMediaDurationSec[side];
        if (md != null && md > 0) return md;
        return getDuration(videoMain);
    }

    function playbackFrameIndexForSide(sec, side) {
        const off = containerTimelineFrameOffset[side] || 0;
        const idx = linearFrameIndexFromSec(sec, fpsFloatForSide(side)) + off;
        return clampFrameIndexToClip(idx, side);
    }

    function masterTimelineDurationSecForSide(side) {
        if (side !== 'main') return 0;
        if (typeof getMasterTransportDurationSec !== 'function') return 0;
        const m = getMasterTransportDurationSec();
        return m > 0.01 ? m : 0;
    }

    function totalFrameCountForSide(side) {
        const stsz = containerStszSampleCount[side];
        if (stsz != null && stsz > 0) return stsz | 0;
        const sc = containerSampleCount[side];
        if (sc != null && sc > 0) return sc | 0;
        const md = mediaDurationSecForSide(side);
        if (md > 0) return frameCountFromDurationSec(md, fpsFloatForSide(side));
        const d = getDuration(videoMain);
        if (d > 0) return frameCountFromDurationSec(d, fpsFloatForSide(side));
        const masterDur = masterTimelineDurationSecForSide(side);
        if (masterDur > 0) {
            return frameCountFromDurationSec(masterDur, fpsFloatForSide(side));
        }
        return 0;
    }

    function reconcileContainerSampleCountForSide(side) {
        const d = getDuration(videoMain);
        if (d > 0 && (containerSampleCount[side] == null || containerSampleCount[side] <= 0)) {
            containerSampleCount[side] = frameCountFromDurationSec(d, fpsFloatForSide(side));
        }
    }

    function inferContainerFpsForSide(side) {
        if (containerFps[side] != null && containerFps[side] > 0) return;
        const d = getDuration(videoMain);
        if (d > 0 && videoMain.webkitDecodedFrameCount > 0) {
            /* no reliable webkit count in all browsers */
        }
    }

    function roundedFpsForSide(side) {
        const c = containerFps[side];
        if (c != null && c > 0) return Math.max(1, Math.min(240, Math.round(c)));
        return DISPLAY_FPS;
    }

    function masterFpsIntForTransport() {
        return roundedFpsForSide('main');
    }

    function refreshMasterFrameSec() {
        masterFrameSec = 1 / masterFpsIntForTransport();
    }

    function formatTimecodeFromFrameIndex(frameIndex, fpsFloat) {
        const fMod = tcModulusFps(fpsFloat);
        const totalFrames = Math.max(0, frameIndex | 0);
        const ff = totalFrames % fMod;
        const secFromFrames = Math.floor(totalFrames / fMod);
        const s = secFromFrames % 60;
        const m = Math.floor(secFromFrames / 60) % 60;
        const h = Math.floor(secFromFrames / 3600);
        return pad2(h) + ':' + pad2(m) + ':' + pad2(s) + ':' + pad2(ff);
    }

    function formatTimecodeForSide(sec, side) {
        return formatTimecodeFromFrameIndex(
            playbackFrameIndexForSide(sec, side),
            fpsFloatForSide(side)
        );
    }

    function formatTimecodeForTransport(sec) {
        return formatTimecodeFromFrameIndex(
            playbackFrameIndexForSide(sec, 'main'),
            masterFpsFloatForTransport()
        );
    }

    function parseTimecodeStringToClipFrameIndex(tcStr, fpsFloat) {
        const m = String(tcStr || '')
            .trim()
            .match(/^(\d+):(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
        if (!m) return null;
        const h = parseInt(m[1], 10);
        const mi = parseInt(m[2], 10);
        const s = parseInt(m[3], 10);
        const ff = parseInt(m[4], 10);
        if (![h, mi, s, ff].every((n) => Number.isFinite(n) && n >= 0)) return null;
        const fMod = tcModulusFps(fpsFloat);
        if (ff >= fMod || mi >= 60 || s >= 60) return null;
        const secFromFrames = h * 3600 + mi * 60 + s;
        return secFromFrames * fMod + ff;
    }

    function parseTimecodeToTransportSec(tcStr) {
        if (!transportControlsReady()) return null;
        const fps = masterFpsFloatForTransport();
        const targetIdx = parseTimecodeStringToClipFrameIndex(tcStr, fps);
        if (targetIdx == null || !Number.isFinite(targetIdx)) return null;
        if (videoReady()) {
            reconcileContainerSampleCountForSide('main');
        }
        const dur =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : getDuration(videoMain);
        if (!dur || dur <= 0) return 0;
        let lo = 0;
        let hi = dur - 0.001;
        for (let i = 0; i < 48; i++) {
            const mid = (lo + hi) * 0.5;
            if (playbackFrameIndexForSide(mid, 'main') < targetIdx) lo = mid;
            else hi = mid;
        }
        let sec = hi;
        if (playbackFrameIndexForSide(sec, 'main') < targetIdx) {
            sec = Math.min(dur - 0.001, sec + masterFrameSec);
        }
        return Math.max(0, Math.min(dur - 0.001, sec));
    }

    function getSeekableEnd(v) {
        try {
            if (!v.seekable || v.seekable.length === 0) return 0;
            const end = v.seekable.end(v.seekable.length - 1);
            return Number.isFinite(end) && end > 0 ? end : 0;
        } catch (_) {
            return 0;
        }
    }

    function getBufferedEnd(v) {
        try {
            if (!v.buffered || v.buffered.length === 0) return 0;
            const end = v.buffered.end(v.buffered.length - 1);
            return Number.isFinite(end) && end > 0 ? end : 0;
        } catch (_) {
            return 0;
        }
    }

    function getDuration(v) {
        const d = v.duration;
        let best = Number.isFinite(d) && d > 0 ? d : 0;
        const md = containerMediaDurationSec.main;
        if (md != null && md > 0 && md > best) best = md;
        if (best > 0) return best;
        const seekEnd = getSeekableEnd(v);
        if (seekEnd > 0) return seekEnd;
        const src = typeof v.src === 'string' ? v.src : '';
        if (src.startsWith('blob:')) {
            const bufEnd = getBufferedEnd(v);
            if (bufEnd > 0) return bufEnd;
        }
        return 0;
    }

    /** 実際に seek / 再生できる上限（誤った長尺で seek して固まるのを防ぐ） */
    function getPlaybackCapSec(v) {
        const seekEnd = getSeekableEnd(v);
        if (seekEnd > 0) return seekEnd;
        const d = v.duration;
        if (Number.isFinite(d) && d > 0) return d;
        const bufEnd = getBufferedEnd(v);
        if (bufEnd > 0) return bufEnd;
        const md = containerMediaDurationSec.main;
        if (md != null && md > 0) return md;
        return 0;
    }

    function videoReady() {
        return getDuration(videoMain) > 0;
    }

    function videoHasFrameData() {
        return videoMain.readyState >= 2;
    }

    function hasPlayableWaveformTimeline() {
        if (
            typeof hasAnyExtraTrackTimelineContent === 'function' &&
            hasAnyExtraTrackTimelineContent()
        ) {
            return true;
        }
        return (
            typeof hasAnyExtraTrackLoaded === 'function' && hasAnyExtraTrackLoaded()
        );
    }

    function transportControlsReady() {
        return videoReady() || hasPlayableWaveformTimeline();
    }

    window.hasPlayableWaveformTimeline = hasPlayableWaveformTimeline;
    window.transportControlsReady = transportControlsReady;
    window.parseTimecodeStringToClipFrameIndex = parseTimecodeStringToClipFrameIndex;

    function timecodeOverlayDisplaySec() {
        if (videoReady()) return videoMain.currentTime || 0;
        if (typeof getTransportSecForDisplay === 'function') {
            return getTransportSecForDisplay();
        }
        if (typeof getTransportSec === 'function') return getTransportSec();
        return 0;
    }

    function updateTimecodeOverlay() {
        if (!timecodeOverlayMain) return;
        const textEl = timecodeOverlayMain.querySelector('.video-timecode__text');
        const show = transportControlsReady();
        if (!show) {
            timecodeOverlayMain.classList.add('video-timecode--idle');
            timecodeOverlayMain.style.visibility = 'hidden';
            if (textEl) textEl.textContent = '00:00:00:00';
            if (typeof refreshTimecodeOverlayInteractive === 'function') {
                refreshTimecodeOverlayInteractive();
            }
            if (typeof updateMarkerCommentOverlay === 'function') updateMarkerCommentOverlay();
            return;
        }
        timecodeOverlayMain.classList.remove('video-timecode--idle');
        timecodeOverlayMain.style.visibility = 'visible';
        const displaySec = timecodeOverlayDisplaySec();
        /* 動画あり: 焼き込み TC（video.currentTime）。動画なし: トランスポートマスター位置。 */
        const tc = videoReady()
            ? formatTimecodeForSide(displaySec, 'main')
            : formatTimecodeForTransport(displaySec);
        if (textEl) textEl.textContent = tc;
        if (typeof refreshTimecodeOverlayInteractive === 'function') {
            refreshTimecodeOverlayInteractive();
            if (typeof applyTcOverlayPosition === 'function') applyTcOverlayPosition();
        }
        if (typeof updateMarkerCommentOverlay === 'function') updateMarkerCommentOverlay();
    }

    (function bindVideoClearButton() {
        const btn = document.getElementById('videoClearBtn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            const confirmPromise =
                typeof requestAppConfirm === 'function'
                    ? requestAppConfirm(
                          'Video Clear',
                          '読み込んだ動画をアンロードします。映像に関する情報が失われますが、よろしいですか？',
                          'Video Clear: cancelled',
                      )
                    : Promise.resolve(false);
            void confirmPromise.then((confirmed) => {
                if (!confirmed) return;
                clearVideoPanel();
            });
        });
        updateVideoClearButton();
        if (typeof updateSessionAllClearButton === 'function') updateSessionAllClearButton();
    })();
