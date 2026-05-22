    const EXTRA_TRACK_COUNT = 2;
    const VIDEO_AUDIO_SLOT_LABEL = 'Video Audio Track';
    const EXTRA_TRACK_DEFAULT_LABELS = ['Ex 1 Track', 'Ex 2 Track'];

    function setLaneWaveformFileNameEl(el, name, tip) {
        if (!el) return;
        const n = name ? String(name) : '';
        if (!n) {
            el.textContent = '';
            el.hidden = true;
            el.setAttribute('aria-hidden', 'true');
            return;
        }
        el.textContent = n;
        el.title = tip || n;
        el.hidden = false;
        el.setAttribute('aria-hidden', 'false');
    }

    function refreshVideoAudioLaneFileName() {
        const el = document.getElementById('audioWaveformFileName');
        if (!el) return;
        const laneShown =
            typeof isVideoAudioLaneShown === 'function' && isVideoAudioLaneShown();
        const hasVideo = typeof videoReady === 'function' && videoReady();
        if (!laneShown || !hasVideo || typeof fileMain === 'undefined' || !fileMain || !fileMain.name) {
            setLaneWaveformFileNameEl(el, '');
            return;
        }
        const st =
            typeof audioWaveformStatus !== 'undefined' && audioWaveformStatus
                ? audioWaveformStatus.textContent || ''
                : '';
        const statusTip =
            typeof laneStatusTooltip === 'function' ? laneStatusTooltip(st) : '';
        const full = fileMain.name;
        setLaneWaveformFileNameEl(el, full, statusTip ? full + ' — ' + statusTip : full);
    }

    window.VIDEO_AUDIO_SLOT_LABEL = VIDEO_AUDIO_SLOT_LABEL;
    window.refreshVideoAudioLaneFileName = refreshVideoAudioLaneFileName;
    const EXTRA_AUDIO_DECODE_MAX_BYTES = 1024 * 1024 * 1024;
    /** Shared schedule lead for BufferSource.start (seconds). */
    const EXTRA_AUDIO_SCHEDULE_AHEAD_SEC = 0.05;
    /** Re-start extra sources when drift from master transport exceeds this (seconds). */
    const EXTRA_AUDIO_RESYNC_DRIFT_SEC = 0.045;

    const EXTRA_AUDIO_FILE_EXT = new Set([
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

    const extraTrackUi = [];
    /** クリアで閉じる／新規動画・ドロップで開く空き Ex レーン枠 */
    const extraLaneUiOpen = [false, false];
    const extraTracks = [
        {
            file: null,
            buffer: null,
            peaks: null,
            muted: false,
            solo: false,
            volLinear: 1,
            source: null,
            gainNode: null,
            analyser: null,
            loadGen: 0,
        },
        {
            file: null,
            buffer: null,
            peaks: null,
            muted: false,
            solo: false,
            volLinear: 1,
            source: null,
            gainNode: null,
            analyser: null,
            loadGen: 0,
        },
    ];

    const videoMix = { muted: false, solo: false, volLinear: 1 };
    let sessionMixRestore = null;
    let reviewMixCtx = null;
    let reviewMixMaster = null;
    let videoMediaSrc = null;
    let videoGainNode = null;
    let videoAnalyser = null;
    let reviewMixVideoDelayNode = null;
    let reviewMixVideoWired = false;
    let reviewMixVideoWireFailed = false;
    let extraMixScheduleCtxTime = 0;
    let videoAudioSoloBtn = null;
    let videoAudioMuteBtn = null;

    function setMixBtnState(btn, on) {
        if (!btn) return;
        btn.classList.toggle('track-mix-btn--on', !!on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    function clampTrackLaneGainLinear(v) {
        if (typeof trackLaneClampGainLinear === 'function') {
            return trackLaneClampGainLinear(v);
        }
        const n = Number(v);
        if (!isFinite(n) || n <= 0) return 1;
        return n;
    }

    function ensureVideoTrackAnalyser(ctx) {
        if (!ctx) return null;
        if (!videoAnalyser) {
            videoAnalyser = ctx.createAnalyser();
            videoAnalyser.fftSize = 256;
            videoAnalyser.smoothingTimeConstant = 0.65;
        }
        return videoAnalyser;
    }

    function ensureExtraTrackAnalyser(ctx, tr) {
        if (!ctx || !tr) return null;
        if (!tr.analyser) {
            tr.analyser = ctx.createAnalyser();
            tr.analyser.fftSize = 256;
            tr.analyser.smoothingTimeConstant = 0.65;
        }
        return tr.analyser;
    }

    function getVideoTrackEffectiveGain() {
        if (!isVideoMixOutputActive()) return 0;
        return clampTrackLaneGainLinear(videoMix.volLinear);
    }

    function getExtraTrackEffectiveGain(slot) {
        if (!isExtraTrackAudible(slot)) return 0;
        const tr = extraTrackBySlot(slot);
        if (!tr) return 0;
        return clampTrackLaneGainLinear(tr.volLinear);
    }

    function applyExtraTrackLaneGain(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.gainNode) return;
        const ctx = ensureReviewMixCtx();
        if (!ctx) return;
        const g = getExtraTrackEffectiveGain(slot);
        try {
            tr.gainNode.gain.setTargetAtTime(g, ctx.currentTime, 0.02);
        } catch (_) {
            tr.gainNode.gain.value = g;
        }
    }

    function applyAllTrackLaneGains() {
        applyReviewMixVideoGain();
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            applyExtraTrackLaneGain(i);
        }
    }

    function getVideoTrackVolLinear() {
        return videoMix.volLinear;
    }

    function setVideoTrackVolLinear(v) {
        videoMix.volLinear = clampTrackLaneGainLinear(v);
        applyReviewMixVideoGain();
    }

    function getExtraTrackVolLinear(slot) {
        const tr = extraTrackBySlot(slot);
        return tr ? tr.volLinear : 1;
    }

    function setExtraTrackVolLinear(slot, v) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return;
        tr.volLinear = clampTrackLaneGainLinear(v);
        applyExtraTrackLaneGain(slot);
    }

    function getVideoTrackAnalyser() {
        return videoAnalyser;
    }

    function getExtraTrackAnalyser(slot) {
        const tr = extraTrackBySlot(slot);
        return tr ? tr.analyser : null;
    }

    function isVideoTrackLaneMeterSilent() {
        return !isVideoMixOutputActive();
    }

    function isExtraTrackLaneMeterSilent(slot) {
        return !isExtraTrackAudible(slot);
    }

    function anyMixSoloActive() {
        if (videoMix.solo) return true;
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (extraTracks[i].solo) return true;
        }
        return false;
    }

    function isVideoAudioAudible() {
        if (typeof videoReady !== 'function' || !videoReady()) return false;
        if (containerHasAudio.main === false) return false;
        if (videoMix.muted) return false;
        if (anyMixSoloActive()) return videoMix.solo;
        return true;
    }

    function isExtraTrackAudible(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.buffer) return false;
        if (tr.muted) return false;
        if (anyMixSoloActive()) return !!tr.solo;
        return true;
    }

    function getVideoTransportDurationSecForMix() {
        if (typeof getVideoPlaybackEndSec === 'function') {
            return getVideoPlaybackEndSec();
        }
        if (typeof getVideoTransportDurationSec === 'function') {
            return getVideoTransportDurationSec();
        }
        return typeof getDuration === 'function' ? getDuration(videoMain) : 0;
    }

    function isVideoMixOutputActive() {
        if (!isVideoAudioAudible()) return false;
        if (
            videoMain &&
            isTransportPlayingForExtra() &&
            typeof transportPlaybackIsInMasterTail === 'function' &&
            transportPlaybackIsInMasterTail()
        ) {
            return false;
        }
        const vd = getVideoTransportDurationSecForMix();
        if (vd > 0) {
            const t = getMasterTransportSecForAudioSync();
            if (t >= vd - 0.001) return false;
        }
        return true;
    }

    function ensureReviewMixMasterBus(ctx) {
        if (!ctx) return null;
        if (!reviewMixMaster) {
            reviewMixMaster = ctx.createGain();
            reviewMixMaster.gain.value = 1;
        }
        if (typeof ensureReviewMixMonitorOutput === 'function') {
            const monitorWired =
                typeof isReviewMixMonitorAnalyzersWired === 'function' &&
                isReviewMixMonitorAnalyzersWired();
            if (!monitorWired) {
                ensureReviewMixMonitorOutput(ctx, reviewMixMaster);
            }
        } else {
            try {
                reviewMixMaster.disconnect(ctx.destination);
            } catch (_) {}
            reviewMixMaster.connect(ctx.destination);
        }
        return reviewMixMaster;
    }

    /** Route video element audio through the same AudioContext as extra tracks. */
    function ensureReviewMixVideoRouting() {
        if (reviewMixVideoWireFailed || !videoMain) return false;
        const ctx = ensureReviewMixCtx();
        if (!ctx) return false;
        const master = ensureReviewMixMasterBus(ctx);
        if (!master) return false;
        if (!reviewMixVideoDelayNode) {
            reviewMixVideoDelayNode = ctx.createDelay(120);
            reviewMixVideoDelayNode.delayTime.value = 0;
        }
        if (!videoGainNode) {
            videoGainNode = ctx.createGain();
        }
        const vMeter = ensureVideoTrackAnalyser(ctx);
        try {
            videoGainNode.disconnect();
        } catch (_) {}
        try {
            if (vMeter) vMeter.disconnect();
        } catch (_) {}
        if (vMeter) {
            videoGainNode.connect(vMeter);
            vMeter.connect(reviewMixVideoDelayNode);
        } else {
            videoGainNode.connect(reviewMixVideoDelayNode);
        }
        try {
            reviewMixVideoDelayNode.disconnect();
        } catch (_) {}
        reviewMixVideoDelayNode.connect(master);
        applyReviewMixVideoDelay();
        if (!videoMediaSrc) {
            try {
                videoMediaSrc = ctx.createMediaElementSource(videoMain);
                videoMediaSrc.connect(videoGainNode);
                reviewMixVideoWired = true;
                videoMain.muted = true;
                writeLog('Review mix: video audio routed via Web Audio');
            } catch (err) {
                reviewMixVideoWireFailed = true;
                reviewMixVideoWired = false;
                writeLog(
                    'Review mix: video Web Audio routing unavailable — ' +
                        (err && err.message ? err.message : String(err)),
                );
                return false;
            }
        }
        return reviewMixVideoWired;
    }

    function applyReviewMixVideoDelay() {
        if (!reviewMixVideoDelayNode) return;
        try {
            reviewMixVideoDelayNode.delayTime.value = 0;
        } catch (_) {}
    }

    function applyReviewMixVideoGain() {
        if (!videoMain) return;
        if (ensureReviewMixVideoRouting()) {
            videoMain.muted = true;
            applyReviewMixVideoDelay();
            if (videoGainNode) {
                const g = getVideoTrackEffectiveGain();
                try {
                    videoGainNode.gain.setTargetAtTime(
                        g,
                        ensureReviewMixCtx() ? ensureReviewMixCtx().currentTime : 0,
                        0.02,
                    );
                } catch (_) {
                    videoGainNode.gain.value = g;
                }
            }
            return;
        }
        videoMain.muted = !isVideoAudioAudible();
    }

    function applyVideoMixToElement() {
        applyReviewMixVideoGain();
    }

    function refreshReviewMixUi() {
        const videoReadyNow = typeof videoReady === 'function' && videoReady();
        const videoLaneShown =
            typeof isVideoAudioLaneShown === 'function' && isVideoAudioLaneShown();
        if (videoAudioSoloBtn) {
            videoAudioSoloBtn.disabled = !videoReadyNow || !videoLaneShown;
            setMixBtnState(videoAudioSoloBtn, videoMix.solo);
        }
        if (videoAudioMuteBtn) {
            videoAudioMuteBtn.disabled = !videoReadyNow || !videoLaneShown;
            setMixBtnState(videoAudioMuteBtn, videoMix.muted);
        }
        const videoAudioClearBtn = document.getElementById('videoAudioClearBtn');
        if (videoAudioClearBtn) {
            videoAudioClearBtn.disabled = !videoReadyNow;
        }
        applyAllTrackLaneGains();
        applyVideoMixToElement();
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) refreshExtraTrackUi(i);
        if (typeof refreshTrackLaneControlsUi === 'function') refreshTrackLaneControlsUi();
        if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
    }

    function getMixPersistSnapshot() {
        const extra = [];
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const tr = extraTrackBySlot(i);
            if (!tr || !tr.buffer) continue;
            extra.push({
                slot: i,
                muted: !!tr.muted,
                solo: !!tr.solo,
                vol: tr.volLinear,
            });
        }
        return {
            video: {
                muted: !!videoMix.muted,
                solo: !!videoMix.solo,
                vol: videoMix.volLinear,
            },
            extra,
        };
    }

    function setSessionMixRestore(mix) {
        sessionMixRestore = mix && typeof mix === 'object' ? mix : null;
    }

    function applyVideoMixFromSessionRestore() {
        if (!sessionMixRestore || !sessionMixRestore.video || !videoReady()) return false;
        videoMix.muted = !!sessionMixRestore.video.muted;
        videoMix.solo = !!sessionMixRestore.video.solo;
        if (typeof sessionMixRestore.video.vol === 'number' && isFinite(sessionMixRestore.video.vol)) {
            videoMix.volLinear = clampTrackLaneGainLinear(sessionMixRestore.video.vol);
        }
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        return true;
    }

    function applyExtraSlotMixFromSessionRestore(slot) {
        if (!sessionMixRestore || !Array.isArray(sessionMixRestore.extra)) return;
        const entry = sessionMixRestore.extra.find((e) => e && e.slot === slot);
        if (!entry) return;
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.buffer) return;
        tr.muted = !!entry.muted;
        tr.solo = !!entry.solo;
        if (typeof entry.vol === 'number' && isFinite(entry.vol)) {
            tr.volLinear = clampTrackLaneGainLinear(entry.vol);
        }
        refreshExtraTrackUi(slot);
        refreshReviewMixUi();
        syncExtraAudioToTransport();
    }

    function applyVideoMixFromSessionRestoreIfPending() {
        return applyVideoMixFromSessionRestore();
    }

    function toggleVideoSolo() {
        if (!videoReady()) return;
        videoMix.solo = !videoMix.solo;
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        writeLog('Video audio: ' + (videoMix.solo ? 'solo on' : 'solo off'));
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
    }

    function toggleVideoMute() {
        if (!videoReady()) return;
        videoMix.muted = !videoMix.muted;
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        writeLog('Video audio: ' + (videoMix.muted ? 'muted' : 'unmuted'));
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
    }

    function toggleExtraSolo(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.buffer) return;
        tr.solo = !tr.solo;
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        writeLog('Extra audio ' + (slot + 1) + ': ' + (tr.solo ? 'solo on' : 'solo off'));
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
    }

    function toggleExtraMute(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.buffer) return;
        tr.muted = !tr.muted;
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        writeLog('Extra audio ' + (slot + 1) + ': ' + (tr.muted ? 'muted' : 'unmuted'));
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
    }

    /** 画面上に表示されているレーンだけ、上から 1・2・3 番目（Video は枠表示中なら常に 1 枠目）。 */
    function getVisibleMixLaneTargets() {
        const out = [];
        if (typeof isVideoAudioLaneShown === 'function' && isVideoAudioLaneShown()) {
            out.push({ kind: 'video' });
        }
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            if (isExtraTrackLaneShown(slot)) {
                out.push({ kind: 'extra', slot: slot });
            }
        }
        return out;
    }

    function toggleMixSoloByDisplayIndex(displayIndex) {
        const targets = getVisibleMixLaneTargets();
        const t = targets[displayIndex];
        if (!t) return;
        if (t.kind === 'video') toggleVideoSolo();
        else toggleExtraSolo(t.slot);
    }

    function toggleMixMuteByDisplayIndex(displayIndex) {
        const targets = getVisibleMixLaneTargets();
        const t = targets[displayIndex];
        if (!t) return;
        if (t.kind === 'video') toggleVideoMute();
        else toggleExtraMute(t.slot);
    }

    function isUsableAudioFile(f) {
        const type = (f.type || '').toLowerCase();
        if (type.startsWith('audio/')) return true;
        const name = String(f.name || '').toLowerCase();
        const dot = name.lastIndexOf('.');
        const ext = dot >= 0 ? name.slice(dot) : '';
        return EXTRA_AUDIO_FILE_EXT.has(ext);
    }

    function pickAudioFiles(fileList) {
        return Array.from(fileList).filter(isUsableAudioFile);
    }

    function ensureReviewMixCtx() {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        if (!reviewMixCtx) reviewMixCtx = new Ctx();
        ensureReviewMixMasterBus(reviewMixCtx);
        if (reviewMixCtx.state === 'suspended') {
            void reviewMixCtx.resume();
        }
        return reviewMixCtx;
    }

    function extraTrackBySlot(slot) {
        return extraTracks[slot] || null;
    }

    function getExtraUi(slot) {
        return extraTrackUi[slot] || null;
    }

    function clearExtraTrackPlaybackAnchor(tr) {
        if (!tr) return;
        tr.playbackAnchorTransportSec = null;
        tr.playbackAnchorCtxTime = null;
    }

    function resetExtraMixScheduleTime() {
        extraMixScheduleCtxTime = 0;
    }

    function isTransportPlayingForExtra() {
        return typeof isTransportPlaying === 'function'
            ? isTransportPlaying()
            : !!(videoMain && !videoMain.paused);
    }

    /** スケジュール位置 = 音声マスター（シークバーと同じ）。正オフセットの遅延は映像側 Web Audio で処理。 */
    function getAudioSyncTransportSec() {
        return Math.max(0, getMasterTransportSecForAudioSync());
    }

    /** 音声マスター位置（transportPlaybackSec / シークバー）。 */
    function getMasterTransportSecForAudioSync() {
        if (
            isTransportPlayingForExtra() &&
            typeof transportPlaybackSec === 'number' &&
            Number.isFinite(transportPlaybackSec)
        ) {
            return transportPlaybackSec;
        }
        if (typeof getTransportSec === 'function') {
            return getTransportSec();
        }
        return 0;
    }

    function expectedTransportSecForTrack(tr, ctx) {
        if (
            !tr ||
            tr.source == null ||
            !Number.isFinite(tr.playbackAnchorTransportSec) ||
            !Number.isFinite(tr.playbackAnchorCtxTime)
        ) {
            return null;
        }
        return tr.playbackAnchorTransportSec + (ctx.currentTime - tr.playbackAnchorCtxTime);
    }

    function extraTrackRoutingMismatch() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const tr = extraTrackBySlot(i);
            const shouldPlay = isExtraTrackAudible(i) && tr && tr.buffer;
            const playing = !!(tr && tr.source);
            if (shouldPlay !== playing) return true;
        }
        return false;
    }

    function extraTracksNeedResync(targetSec, ctx) {
        if (extraTrackRoutingMismatch()) return true;
        let anyAudible = false;
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackAudible(i)) continue;
            anyAudible = true;
            const tr = extraTrackBySlot(i);
            if (!tr || !tr.source) return true;
            const expected = expectedTransportSecForTrack(tr, ctx);
            if (
                expected == null ||
                Math.abs(expected - targetSec) > EXTRA_AUDIO_RESYNC_DRIFT_SEC
            ) {
                return true;
            }
        }
        return !anyAudible;
    }

    function acquireExtraMixScheduleTime(ctx, opt) {
        if (opt && opt.when != null && Number.isFinite(opt.when)) {
            return opt.when;
        }
        const when = Math.max(
            ctx.currentTime + EXTRA_AUDIO_SCHEDULE_AHEAD_SEC,
            extraMixScheduleCtxTime || 0,
        );
        extraMixScheduleCtxTime = when;
        return when;
    }

    function stopExtraTrackSource(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.source) return;
        try {
            tr.source.stop();
        } catch (_) {}
        try {
            tr.source.disconnect();
        } catch (_) {}
        tr.source = null;
        clearExtraTrackPlaybackAnchor(tr);
    }

    function stopAllExtraTrackSources() {
        resetExtraMixScheduleTime();
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) stopExtraTrackSource(i);
    }

    function extraAudioSourcesActive() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const tr = extraTrackBySlot(i);
            if (tr && tr.source && isExtraTrackAudible(i)) return true;
        }
        return false;
    }

    /** Transport position implied by running extra BufferSources (AudioContext clock). */
    function getTransportSecFromActiveExtraMix(ctx) {
        let best = null;
        let anyAudible = false;
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackAudible(i)) continue;
            anyAudible = true;
            const tr = extraTrackBySlot(i);
            if (!tr || !tr.source) return null;
            const expected = expectedTransportSecForTrack(tr, ctx);
            if (expected == null || !Number.isFinite(expected)) return null;
            if (best == null || expected > best) best = expected;
        }
        return anyAudible ? best : null;
    }

    /**
     * Enter post-video tail without restarting extra sources (avoids a gap at video end).
     * @returns {number} transport seconds to use for the tail clock
     */
    function handoffReviewMixToTransportTail() {
        ensureReviewMixVideoRouting();
        applyReviewMixVideoGain();
        const ctx = ensureReviewMixCtx();
        const barT =
            typeof getTransportSec === 'function'
                ? getTransportSec()
                : videoMain
                  ? videoMain.currentTime || 0
                  : 0;
        const vd = getVideoTransportDurationSecForMix();
        if (ctx) {
            const fromMix = getTransportSecFromActiveExtraMix(ctx);
            if (fromMix != null && Number.isFinite(fromMix)) {
                return fromMix;
            }
        }
        const startAt = vd > 0 ? Math.max(barT, vd) : barT;
        if (
            typeof extraAudioSourcesActive !== 'function' ||
            !extraAudioSourcesActive()
        ) {
            syncReviewMixToTransport({ force: true });
        }
        return startAt;
    }

    function mimeTypeHintForAudioFileName(name) {
        const s = String(name || '').toLowerCase();
        const dot = s.lastIndexOf('.');
        const ext = dot >= 0 ? s.slice(dot) : '';
        const map = {
            '.wav': 'audio/wav',
            '.wave': 'audio/wav',
            '.flac': 'audio/flac',
            '.ogg': 'audio/ogg',
            '.oga': 'audio/ogg',
            '.mp3': 'audio/mpeg',
            '.m4a': 'audio/mp4',
            '.aac': 'audio/aac',
            '.aif': 'audio/aiff',
            '.aiff': 'audio/aiff',
            '.wma': 'audio/x-ms-wma',
            '.opus': 'audio/opus',
            '.webm': 'audio/webm',
        };
        return map[ext] || 'application/octet-stream';
    }

    function getExtraTracksPersistSnapshot() {
        const out = [];
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const tr = extraTrackBySlot(i);
            if (!tr || !tr.file || !tr.buffer) continue;
            out.push({
                slot: i,
                name: tr.file.name,
                lastModified: tr.file.lastModified,
                blob: tr.file,
            });
        }
        return out.length ? out : null;
    }

    function startExtraTrackSource(slot, offsetSec, opt) {
        const tr = extraTrackBySlot(slot);
        stopExtraTrackSource(slot);
        if (!tr || !tr.buffer || !isExtraTrackAudible(slot)) return;
        const ctx = ensureReviewMixCtx();
        if (!ctx) return;
        const master = ensureReviewMixMasterBus(ctx);
        if (!tr.gainNode) {
            tr.gainNode = ctx.createGain();
        }
        const meter = ensureExtraTrackAnalyser(ctx, tr);
        try {
            tr.gainNode.disconnect();
        } catch (_) {}
        try {
            if (meter) meter.disconnect();
        } catch (_) {}
        const bus = master || ctx.destination;
        if (meter) {
            tr.gainNode.connect(meter);
            meter.connect(bus);
        } else {
            tr.gainNode.connect(bus);
        }
        applyExtraTrackLaneGain(slot);
        const off = Math.max(0, Number(offsetSec) || 0);
        const maxOff = Math.max(0, tr.buffer.duration - 0.002);
        const startAt = Math.min(off, maxOff);
        const remain = tr.buffer.duration - startAt;
        if (remain <= 0.002) return;
        const scheduleWhen = acquireExtraMixScheduleTime(ctx, opt);
        const src = ctx.createBufferSource();
        src.buffer = tr.buffer;
        src.connect(tr.gainNode);
        src.start(scheduleWhen, startAt, remain);
        tr.source = src;
        const transportAnchor =
            opt && Number.isFinite(opt.transportSec) ? opt.transportSec : off;
        tr.playbackAnchorTransportSec = transportAnchor;
        tr.playbackAnchorCtxTime = scheduleWhen;
        src.onended = () => {
            if (tr.source === src) {
                tr.source = null;
                clearExtraTrackPlaybackAnchor(tr);
            }
        };
    }

    function extraTrackBufferDuration(slot) {
        const tr = extraTrackBySlot(slot);
        return tr && tr.buffer && tr.buffer.duration > 0 ? tr.buffer.duration : 0;
    }

    function isExtraTrackLoaded(slot) {
        return extraTrackBufferDuration(slot) > 0;
    }

    function syncReviewMixToTransport(opt) {
        const force = !!(opt && opt.force);
        const playing = isTransportPlayingForExtra();
        const masterT = getMasterTransportSecForAudioSync();
        const audioT = getAudioSyncTransportSec();
        ensureReviewMixVideoRouting();
        applyReviewMixVideoGain();
        if (!playing) {
            stopAllExtraTrackSources();
            return;
        }
        const ctx = ensureReviewMixCtx();
        if (!ctx) return;
        if (!force && !extraTracksNeedResync(masterT, ctx) && extraAudioSourcesActive()) {
            return;
        }
        resetExtraMixScheduleTime();
        stopAllExtraTrackSources();
        const scheduleWhen = acquireExtraMixScheduleTime(ctx, opt);
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            startExtraTrackSource(i, audioT, {
                when: scheduleWhen,
                transportSec: masterT,
            });
        }
    }

    function syncExtraAudioToTransport(opt) {
        syncReviewMixToTransport(opt);
    }

    /** Schedule the full mix (video element + extras) before video.play(). */
    function primeReviewMixForPlayback() {
        ensureReviewMixVideoRouting();
        syncReviewMixToTransport({ force: true });
    }

    function primeExtraAudioForPlayback() {
        primeReviewMixForPlayback();
    }

    function decodeArrayBufferToAudioBuffer(ctx, ab) {
        if (!ctx || !ab) throw new Error('decodeAudioData: no context or data');
        const copy = ab.slice(0);
        const decoded = ctx.decodeAudioData(copy);
        if (decoded && typeof decoded.then === 'function') {
            return decoded;
        }
        return new Promise((resolve, reject) => {
            ctx.decodeAudioData(copy, resolve, reject);
        });
    }

    function peaksFromBuffer(buffer, barCount) {
        if (!buffer || buffer.numberOfChannels < 1) {
            return null;
        }
        const ch = buffer.getChannelData(0);
        const len = ch.length;
        const bars = Math.max(1, barCount | 0);
        const block = Math.max(1, Math.floor(len / bars));
        const peaks = new Array(bars);
        for (let i = 0; i < bars; i++) {
            const start = i * block;
            const end = Math.min(len, start + block);
            let min = 0;
            let max = 0;
            for (let j = start; j < end; j++) {
                const v = ch[j];
                if (v < min) min = v;
                if (v > max) max = v;
            }
            peaks[i] = { min, max };
        }
        return peaks;
    }

    function syncExtraCanvasSize(ui) {
        if (!ui || !ui.canvas || !ui.track) return null;
        const wCss =
            typeof masterTimelineWidthCss === 'function'
                ? masterTimelineWidthCss()
                : Math.max(1, ui.track.clientWidth | 0);
        const hCss = Math.max(1, ui.track.clientHeight | 0);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        ui.canvas.width = Math.max(1, Math.round(wCss * dpr));
        ui.canvas.height = Math.max(1, Math.round(hCss * dpr));
        ui.canvas.style.width = wCss + 'px';
        ui.canvas.style.height = hCss + 'px';
        const ctx = ui.canvas.getContext('2d');
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { ctx, wCss, hCss, barCount: Math.min(4096, wCss) };
    }

    function drawExtraTrackWaveform(slot) {
        const ui = getExtraUi(slot);
        const tr = extraTrackBySlot(slot);
        if (!ui || !ui.canvas) return;
        const sized = syncExtraCanvasSize(ui);
        if (!sized || !sized.ctx) return;
        const { ctx, wCss, hCss } = sized;
        const contentDur = tr && tr.buffer ? tr.buffer.duration : 0;
        const audible =
            typeof isExtraTrackAudible === 'function' ? isExtraTrackAudible(slot) : true;
        const grad =
            typeof timelineWaveformFillGradient === 'function'
                ? timelineWaveformFillGradient(ctx, hCss, 'extra', audible)
                : null;
        const endDrawOpt =
            typeof timelineContentEndDrawOpt === 'function'
                ? timelineContentEndDrawOpt()
                : null;
        drawPeaksForMasterTimeline(ctx, tr ? tr.peaks : null, wCss, hCss, contentDur, grad, endDrawOpt);
    }

    function redrawAllExtraTrackWaveforms() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) drawExtraTrackWaveform(i);
    }

    /** レーン表示直後は clientWidth が 0 のことがあるため、レイアウト確定後に再描画する。 */
    function scheduleExtraTrackWaveformRedraw(slot) {
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        const redraw = () => {
            if (slot >= 0 && slot < EXTRA_TRACK_COUNT) drawExtraTrackWaveform(slot);
            else redrawAllExtraTrackWaveforms();
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
        };
        requestAnimationFrame(() => requestAnimationFrame(redraw));
    }

    function setExtraTrackStatus(slot, text) {
        const ui = getExtraUi(slot);
        if (ui && ui.status) {
            if (typeof applyLaneStatusEl === 'function') {
                applyLaneStatusEl(ui.status, text);
            } else {
                ui.status.textContent = text || '';
                ui.status.hidden = true;
            }
        }
        const tr = extraTrackBySlot(slot);
        const label = EXTRA_TRACK_DEFAULT_LABELS[slot] || 'Ex';
        const tip =
            typeof laneStatusTooltip === 'function' ? laneStatusTooltip(text) : '';
        if (ui && ui.title) {
            ui.title.textContent = label;
            ui.title.title = tip ? label + ' — ' + tip : label;
        }
        if (ui && ui.fileName) {
            if (tr && tr.file && tr.file.name) {
                const full = tr.file.name;
                setLaneWaveformFileNameEl(ui.fileName, full, tip ? full + ' — ' + tip : full);
            } else {
                setLaneWaveformFileNameEl(ui.fileName, '');
            }
        }
    }

    function setExtraTrackLoaded(slot, loaded, opt) {
        const ui = getExtraUi(slot);
        if (ui && ui.meta) ui.meta.classList.toggle('loaded', !!loaded);
        applyExtraTrackLaneVisibility(slot);
        if (!opt || !opt.skipLayoutRefresh) {
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
        }
    }

    function isExtraTrackLaneShown(slot) {
        return !!(extraLaneUiOpen[slot] || isExtraTrackLoaded(slot));
    }

    function applyExtraTrackLaneVisibility(slot) {
        const ui = getExtraUi(slot);
        const show = isExtraTrackLaneShown(slot);
        const laneEl = document.getElementById('extraAudioLane' + slot);
        if (ui && ui.meta) {
            ui.meta.hidden = !show;
            ui.meta.setAttribute('aria-hidden', show ? 'false' : 'true');
        }
        if (laneEl) {
            laneEl.hidden = !show;
            laneEl.setAttribute('aria-hidden', show ? 'false' : 'true');
        }
    }

    function setExtraTrackLaneUiOpen(slot, open, opt) {
        if (slot < 0 || slot >= EXTRA_TRACK_COUNT) return;
        extraLaneUiOpen[slot] = !!open;
        applyExtraTrackLaneVisibility(slot);
        if (!open && typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
        if (!opt || !opt.deferLayout) {
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
        }
        if (!opt || !opt.skipPersist) {
            if (typeof schedulePersistSession === 'function') schedulePersistSession();
        }
    }

    /** 表示レーンが 0 のとき空きドロップ枠として Ex レーンを 1 つ再表示 */
    function reviveOneEmptyExtraLane() {
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            if (!isExtraTrackLaneShown(slot)) {
                setExtraTrackLaneUiOpen(slot, true, { deferLayout: true });
                setExtraTrackStatus(slot, 'Not Loaded');
                refreshExtraTrackUi(slot);
                return slot;
            }
        }
        setExtraTrackLaneUiOpen(0, true, { deferLayout: true });
        setExtraTrackStatus(0, 'Not Loaded');
        refreshExtraTrackUi(0);
        return 0;
    }

    window.reviveOneEmptyExtraLane = reviveOneEmptyExtraLane;

    function getWaveformLaneUiPersistSnapshot() {
        const extraLanesOpen = extraLaneUiOpen.slice(0, EXTRA_TRACK_COUNT);
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (isExtraTrackLoaded(i)) extraLanesOpen[i] = true;
        }
        return {
            videoLaneOpen:
                typeof getVideoLaneUiOpen === 'function' ? !!getVideoLaneUiOpen() : true,
            extraLanesOpen,
        };
    }

    function applyWaveformLaneUiPersistSnapshot(snap, opt) {
        if (!snap || typeof snap !== 'object') return false;
        if (typeof setVideoLaneUiOpenFromPersist === 'function') {
            setVideoLaneUiOpenFromPersist(
                typeof snap.videoLaneOpen === 'boolean' ? snap.videoLaneOpen : true,
                { skipRefresh: true },
            );
        }
        if (Array.isArray(snap.extraLanesOpen)) {
            for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
                if (typeof snap.extraLanesOpen[i] === 'boolean') {
                    setExtraTrackLaneUiOpen(i, snap.extraLanesOpen[i], {
                        deferLayout: true,
                        skipPersist: true,
                    });
                }
            }
        }
        refreshAllExtraTrackLaneVisibility();
        if (!opt || !opt.skipRefresh) {
            if (typeof refreshVideoAudioLaneVisibility === 'function') {
                refreshVideoAudioLaneVisibility();
            }
        }
        if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
        return true;
    }

    function applySavedWaveformLaneUi(sessionSnap) {
        let snap = sessionSnap;
        if (!snap && typeof readPrefs === 'function') {
            const p = readPrefs();
            if (p && p.laneUi) snap = p.laneUi;
        }
        if (snap) {
            applyWaveformLaneUiPersistSnapshot(snap);
        } else if (typeof restoreExtraTrackLanesForNewVideo === 'function') {
            restoreExtraTrackLanesForNewVideo();
        }
        if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
    }

    window.getWaveformLaneUiPersistSnapshot = getWaveformLaneUiPersistSnapshot;
    window.applyWaveformLaneUiPersistSnapshot = applyWaveformLaneUiPersistSnapshot;
    window.applySavedWaveformLaneUi = applySavedWaveformLaneUi;

    function refreshExtraTrackLaneVisibility(slot) {
        applyExtraTrackLaneVisibility(slot);
    }

    function refreshAllExtraTrackLaneVisibility() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            refreshExtraTrackLaneVisibility(i);
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
    }

    /** 新規動画読み込み時: クリアで隠した Ex レーンを空きドロップ枠として再表示 */
    function restoreExtraTrackLanesForNewVideo() {
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            setExtraTrackLaneUiOpen(slot, true, { deferLayout: true });
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        if (typeof restoreVideoAudioLaneForNewVideo === 'function') {
            restoreVideoAudioLaneForNewVideo();
        }
        if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
    }

    window.restoreExtraTrackLanesForNewVideo = restoreExtraTrackLanesForNewVideo;
    window.loadExtraTrackFile = loadExtraTrackFile;
    window.redrawAllExtraTrackWaveforms = redrawAllExtraTrackWaveforms;
    window.refreshAllExtraTrackLaneVisibility = refreshAllExtraTrackLaneVisibility;

    function refreshExtraTrackUi(slot) {
        const ui = getExtraUi(slot);
        const tr = extraTrackBySlot(slot);
        if (!ui) return;
        if (ui.title) {
            const label = EXTRA_TRACK_DEFAULT_LABELS[slot] || 'Ex';
            const st = ui.status ? ui.status.textContent || '' : '';
            const tip =
                typeof laneStatusTooltip === 'function' ? laneStatusTooltip(st) : '';
            ui.title.textContent = label;
            ui.title.title = tip ? label + ' — ' + tip : label;
        }
        if (ui.fileName) {
            if (tr && tr.file && tr.file.name) {
                const st = ui.status ? ui.status.textContent || '' : '';
                const tip =
                    typeof laneStatusTooltip === 'function' ? laneStatusTooltip(st) : '';
                const full = tr.file.name;
                setLaneWaveformFileNameEl(ui.fileName, full, tip ? full + ' — ' + tip : full);
            } else {
                setLaneWaveformFileNameEl(ui.fileName, '');
            }
        }
        const hasBuf = !!(tr && tr.buffer);
        if (ui.meta) ui.meta.classList.toggle('loaded', hasBuf);
        if (ui.soloBtn) {
            ui.soloBtn.disabled = !hasBuf;
            setMixBtnState(ui.soloBtn, !!(tr && tr.solo));
        }
        if (ui.muteBtn) {
            ui.muteBtn.disabled = !hasBuf;
            setMixBtnState(ui.muteBtn, !!(tr && tr.muted));
        }
        if (ui.clearBtn) ui.clearBtn.disabled = false;
        drawExtraTrackWaveform(slot);
        if (typeof refreshTrackLaneControlsUi === 'function') refreshTrackLaneControlsUi();
        refreshExtraTrackLaneVisibility(slot);
    }

    function clearExtraTrack(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return;
        if (!tr.buffer) {
            setExtraTrackLaneUiOpen(slot, false, { deferLayout: true });
            setExtraTrackStatus(slot, 'Not Loaded');
            refreshExtraTrackUi(slot);
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
            if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
                ensureAtLeastOneWaveformLaneVisible();
            }
            return;
        }
        stopExtraTrackSource(slot);
        tr.loadGen += 1;
        tr.file = null;
        tr.buffer = null;
        tr.peaks = null;
        tr.muted = false;
        tr.solo = false;
        tr.volLinear = 1;
        try {
            if (tr.analyser) tr.analyser.disconnect();
        } catch (_) {}
        tr.analyser = null;
        setExtraTrackLaneUiOpen(slot, false, { deferLayout: true });
        setExtraTrackLoaded(slot, false);
        setExtraTrackStatus(slot, 'Not Loaded');
        refreshExtraTrackUi(slot);
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
    }

    function clearAllExtraTracks() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) clearExtraTrack(i);
        if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
    }

    function resetVideoMix() {
        videoMix.muted = false;
        videoMix.solo = false;
        videoMix.volLinear = 1;
        if (videoGainNode) videoGainNode.gain.value = 0;
        if (videoMain) {
            videoMain.muted = reviewMixVideoWired ? true : false;
        }
        refreshReviewMixUi();
    }

    async function loadExtraTrackFile(slot, file) {
        if (slot < 0 || slot >= EXTRA_TRACK_COUNT || !file) return;
        setExtraTrackLaneUiOpen(slot, true);
        const tr = extraTrackBySlot(slot);
        const gen = ++tr.loadGen;
        const n = file.size || 0;
        if (n > EXTRA_AUDIO_DECODE_MAX_BYTES) {
            const mb = Math.round((n / (1024 * 1024)) * 10) / 10;
            const limitMb = Math.round(EXTRA_AUDIO_DECODE_MAX_BYTES / (1024 * 1024));
            writeLog('Extra audio ' + (slot + 1) + ': file too large — ' + mb + ' MB');
            if (typeof showAppAlert === 'function') {
                showAppAlert(
                    'Cannot load extra audio',
                    'File size (' +
                        mb +
                        ' MB) exceeds the limit (' +
                        limitMb +
                        ' MB).'
                );
            }
            return;
        }
        const ctx = ensureReviewMixCtx();
        if (!ctx) {
            setExtraTrackStatus(slot, 'AudioContext unavailable');
            return;
        }
        setExtraTrackStatus(slot, 'Decoding…');
        let buffer = null;
        try {
            if (ctx.state === 'suspended') {
                try {
                    await ctx.resume();
                } catch (_) {}
            }
            const ab = await file.arrayBuffer();
            if (gen !== tr.loadGen) return;
            if (!ab || ab.byteLength < 1) {
                throw new Error('empty file');
            }
            buffer = await decodeArrayBufferToAudioBuffer(ctx, ab);
            if (gen !== tr.loadGen) return;
            if (!buffer || !(buffer.duration > 0)) {
                throw new Error('decode returned no audio');
            }
        } catch (err) {
            if (gen !== tr.loadGen) return;
            tr.file = null;
            tr.buffer = null;
            tr.peaks = null;
            setExtraTrackLoaded(slot, false, { skipLayoutRefresh: true });
            setExtraTrackStatus(slot, 'Decode failed');
            refreshExtraTrackUi(slot);
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
            writeLog(
                'Extra audio ' +
                    (slot + 1) +
                    ': decode failed — ' +
                    (err && err.message ? err.message : String(err))
            );
            return;
        }

        tr.file = file;
        tr.buffer = buffer;
        tr.muted = false;
        tr.solo = false;

        try {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            if (gen !== tr.loadGen) return;
            const ui = getExtraUi(slot);
            const sized = ui && ui.track ? syncExtraCanvasSize(ui) : null;
            const barCount = sized ? sized.barCount : 1200;
            tr.peaks = peaksFromBuffer(buffer, barCount);
            const ch = buffer.numberOfChannels;
            const rate = buffer.sampleRate | 0;
            setExtraTrackStatus(
                slot,
                ch +
                    ' ch · ' +
                    (rate ? rate + ' Hz' : '') +
                    ' · ' +
                    buffer.duration.toFixed(2) +
                    ' s'
            );
            setExtraTrackLoaded(slot, true, { skipLayoutRefresh: true });
            refreshExtraTrackUi(slot);
            applyExtraSlotMixFromSessionRestore(slot);
            writeLog(
                'Extra audio ' +
                    (slot + 1) +
                    ': loaded ' +
                    file.name +
                    ' (synced to video head)'
            );
            syncExtraAudioToTransport();
            if (typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
            if (typeof schedulePersistSession === 'function') schedulePersistSession();
            scheduleExtraTrackWaveformRedraw(slot);
        } catch (err) {
            if (gen !== tr.loadGen) return;
            writeLog(
                'Extra audio ' +
                    (slot + 1) +
                    ': loaded but waveform draw failed — ' +
                    (err && err.message ? err.message : String(err))
            );
            refreshExtraTrackUi(slot);
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
        }
    }

    function firstEmptyExtraSlot() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackLoaded(i)) return i;
        }
        return -1;
    }

    function assignExtraAudioFiles(files, startSlot) {
        const audios = pickAudioFiles(files);
        if (audios.length === 0) {
            writeLog('Extra audio: no playable audio in selection');
            return;
        }
        let slot =
            typeof startSlot === 'number' && startSlot >= 0
                ? startSlot
                : firstEmptyExtraSlot();
        if (slot < 0) {
            writeLog('Extra audio: Ex 1 and Ex 2 are full — drop ignored');
            return;
        }
        let ignored = 0;
        for (let i = 0; i < audios.length; i++) {
            if (slot < 0 || slot >= EXTRA_TRACK_COUNT) {
                ignored += audios.length - i;
                break;
            }
            setExtraTrackLaneUiOpen(slot, true, { deferLayout: true });
            void loadExtraTrackFile(slot, audios[i]);
            slot = firstEmptyExtraSlot();
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        if (ignored > 0) {
            writeLog(
                'Extra audio: Ex 1 and Ex 2 are full — ' +
                    ignored +
                    ' file(s) ignored',
            );
        }
    }

    function extraSlotFromDropTarget(target) {
        if (!target || !target.closest) return -1;
        const lane0 = target.closest('#extraAudioLane0, #extraAudioMeta0');
        if (lane0) return 0;
        const lane1 = target.closest('#extraAudioLane1, #extraAudioMeta1');
        if (lane1) return 1;
        return -1;
    }

    function isVideoAudioLaneDropTarget(target) {
        if (!target || !target.closest) return false;
        return !!target.closest(
            '#audioWaveformLaneVideo, #audioWaveformTrack, #audioWaveformPanel',
        );
    }

    function videoAudioLaneOccupiedForExtraDrop() {
        if (typeof videoReady !== 'function' || !videoReady()) return false;
        if (typeof isVideoAudioLaneShown === 'function' && isVideoAudioLaneShown()) {
            return true;
        }
        return isExtraTrackLoaded(0) || isExtraTrackLoaded(1);
    }

    function resolveExtraSlotForAudioDrop(target) {
        const hit = extraSlotFromDropTarget(target);
        if (hit >= 0) {
            if (!isExtraTrackLoaded(hit)) return hit;
            const next = firstEmptyExtraSlot();
            if (next < 0) return -1;
            writeLog(
                'Extra audio: Ex ' +
                    (hit + 1) +
                    ' already has audio — loading into Ex ' +
                    (next + 1),
            );
            return next;
        }
        if (isVideoAudioLaneDropTarget(target) && videoAudioLaneOccupiedForExtraDrop()) {
            const next = firstEmptyExtraSlot();
            if (next < 0) return -1;
            writeLog(
                'Extra audio: Video Audio lane already in use — loading into Ex ' +
                    (next + 1),
            );
            return next;
        }
        return firstEmptyExtraSlot();
    }

    function assignExtraAudioFilesFromDrop(files, dropTarget) {
        const audios = pickAudioFiles(files);
        if (audios.length === 0) {
            writeLog('Extra audio: no playable audio in selection');
            return;
        }
        const slot = resolveExtraSlotForAudioDrop(dropTarget);
        if (slot < 0) {
            writeLog('Extra audio: Ex 1 and Ex 2 are full — drop ignored');
            return;
        }
        assignExtraAudioFiles(audios, slot);
    }

    function initExtraAudioTracksUi() {
        videoAudioSoloBtn = document.getElementById('videoAudioSoloBtn');
        videoAudioMuteBtn = document.getElementById('videoAudioMuteBtn');
        if (videoAudioSoloBtn) {
            videoAudioSoloBtn.addEventListener('click', () => toggleVideoSolo());
        }
        if (videoAudioMuteBtn) {
            videoAudioMuteBtn.addEventListener('click', () => toggleVideoMute());
        }

        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            const meta = document.getElementById('extraAudioMeta' + slot);
            if (!meta) continue;
            const ui = {
                slot,
                meta,
                track: document.getElementById('extraAudioTrack' + slot),
                canvas: document.getElementById('extraAudioCanvas' + slot),
                status: document.getElementById('extraAudioStatus' + slot),
                title: document.getElementById('extraAudioTitle' + slot),
                fileName: document.getElementById('extraAudioFileName' + slot),
                soloBtn: document.getElementById('extraAudioSoloBtn' + slot),
                muteBtn: document.getElementById('extraAudioMuteBtn' + slot),
                clearBtn: document.getElementById('extraAudioClearBtn' + slot),
            };
            extraTrackUi[slot] = ui;
            refreshExtraTrackUi(slot);
            refreshExtraTrackLaneVisibility(slot);

            if (ui.clearBtn) {
                ui.clearBtn.addEventListener('click', () => {
                    clearExtraTrack(slot);
                    writeLog('Extra audio ' + (slot + 1) + ': cleared');
                });
            }
            if (ui.soloBtn) {
                ui.soloBtn.addEventListener('click', () => toggleExtraSolo(slot));
            }
            if (ui.muteBtn) {
                ui.muteBtn.addEventListener('click', () => toggleExtraMute(slot));
            }
        }

        refreshAllExtraTrackLaneVisibility();
        refreshReviewMixUi();
        if (typeof initTrackLaneControlsUi === 'function') {
            initTrackLaneControlsUi();
        }
        if (videoReady && videoReady()) {
            ensureReviewMixVideoRouting();
        }

        if (typeof ResizeObserver !== 'undefined') {
            const obs = new ResizeObserver(() => {
                for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
                    const tr = extraTrackBySlot(i);
                    if (tr && tr.buffer) {
                        const ui = getExtraUi(i);
                        const sized = ui ? syncExtraCanvasSize(ui) : null;
                        if (sized && tr.buffer) {
                            tr.peaks = peaksFromBuffer(tr.buffer, sized.barCount);
                        }
                        drawExtraTrackWaveform(i);
                    }
                }
            });
            for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
                const ui = getExtraUi(i);
                if (ui && ui.track) obs.observe(ui.track);
            }
        }
        refreshVideoAudioLaneFileName();
    }
