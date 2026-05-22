    const EXTRA_TRACK_COUNT =
        typeof window.EXTRA_TRACK_COUNT === 'number' ? window.EXTRA_TRACK_COUNT : 3;
    const VIDEO_AUDIO_SLOT_LABEL = 'Video Audio Track';
    const EXTRA_TRACK_DEFAULT_LABELS = ['Ex 1 Track', 'Ex 2 Track', 'Ex 3 Track'];

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
    const EXTRA_AUDIO_DECODE_TIMEOUT_MS = 90000;
    const EXTRA_WAVEFORM_LAYOUT_MIN_CSS = 32;
    let extraWaveformEnsureGen = 0;
    /** Shared schedule lead for BufferSource.start (seconds). */
    const EXTRA_AUDIO_SCHEDULE_AHEAD_SEC = 0.05;
    /** Re-start extra sources when drift from master transport exceeds this (seconds). */
    const EXTRA_AUDIO_RESYNC_DRIFT_SEC = 0.045;

    const extraTrackUi = [];
    /** クリアで閉じる／新規動画・ドロップで開く空き Ex レーン枠 */
    const extraLaneUiOpen = [false, false, false];
    const extraTracks = [
        {
            file: null,
            buffer: null,
            peaks: null,
            persistBlob: null,
            restoreDurationHint: 0,
            muted: false,
            solo: false,
            volLinear: 1,
            source: null,
            gainNode: null,
            analyser: null,
            loadGen: 0,
            timelineStartSec: 0,
        },
        {
            file: null,
            buffer: null,
            peaks: null,
            persistBlob: null,
            restoreDurationHint: 0,
            muted: false,
            solo: false,
            volLinear: 1,
            source: null,
            gainNode: null,
            analyser: null,
            loadGen: 0,
            timelineStartSec: 0,
        },
        {
            file: null,
            buffer: null,
            peaks: null,
            persistBlob: null,
            restoreDurationHint: 0,
            muted: false,
            solo: false,
            volLinear: 1,
            source: null,
            gainNode: null,
            analyser: null,
            loadGen: 0,
            timelineStartSec: 0,
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

    function removeExtraSlotFromSessionMixRestore(slot) {
        if (typeof isSessionRestoreInProgress === 'function' && isSessionRestoreInProgress()) {
            return;
        }
        if (!sessionMixRestore || !Array.isArray(sessionMixRestore.extra)) return;
        sessionMixRestore.extra = sessionMixRestore.extra.filter((e) => !e || e.slot !== slot);
    }

    /** レーン削除時: フェーダーを 0 dB（線形 1）に戻し、復元用ミックス状態からも除外 */
    function resetExtraTrackMixToDefault(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return;
        tr.muted = false;
        tr.solo = false;
        tr.volLinear = 1;
        removeExtraSlotFromSessionMixRestore(slot);
        applyExtraTrackLaneGain(slot);
    }

    function resetVideoTrackMixToDefault() {
        videoMix.muted = false;
        videoMix.solo = false;
        videoMix.volLinear = 1;
        if (
            sessionMixRestore &&
            sessionMixRestore.video &&
            !(typeof isSessionRestoreInProgress === 'function' && isSessionRestoreInProgress())
        ) {
            sessionMixRestore.video = {
                muted: false,
                solo: false,
                vol: 1,
            };
        }
        refreshReviewMixUi();
    }

    window.resetVideoTrackMixToDefault = resetVideoTrackMixToDefault;

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

    /** 画面上に表示されているレーンだけ、上から 1〜4 番目（Video は枠表示中なら常に 1 枠目）。 */
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

    function isMixLaneDbAtUnity(db) {
        return Math.abs(db) <= 0.05;
    }

    function mixLaneVolumeDbAfterStep(currentDb, deltaDb) {
        const atUnity = isMixLaneDbAtUnity(currentDb);
        if (deltaDb > 0) {
            if (!atUnity && currentDb < 0 && currentDb + deltaDb > 0) return 0;
            return currentDb + deltaDb;
        }
        if (!atUnity && currentDb > 0 && currentDb + deltaDb < 0) return 0;
        return currentDb + deltaDb;
    }

    function adjustMixLaneVolumeByDisplayIndex(displayIndex, deltaDb) {
        if (
            typeof trackLaneLinearGainToDb !== 'function' ||
            typeof trackLaneLinearGainFromDb !== 'function'
        ) {
            return false;
        }
        const targets = getVisibleMixLaneTargets();
        const t = targets[displayIndex];
        if (!t) return false;
        let currentLinear;
        if (t.kind === 'video') {
            if (typeof videoReady !== 'function' || !videoReady()) return false;
            currentLinear = getVideoTrackVolLinear();
        } else {
            if (typeof isExtraTrackLoaded !== 'function' || !isExtraTrackLoaded(t.slot)) {
                return false;
            }
            currentLinear = getExtraTrackVolLinear(t.slot);
        }
        const currentDb = trackLaneLinearGainToDb(currentLinear);
        const atUnityBefore = isMixLaneDbAtUnity(currentDb);
        const nextDb = mixLaneVolumeDbAfterStep(currentDb, deltaDb);
        if (Math.abs(nextDb - currentDb) < 1e-6) {
            return false;
        }
        const next = trackLaneLinearGainFromDb(nextDb);
        if (t.kind === 'video') {
            setVideoTrackVolLinear(next);
        } else {
            setExtraTrackVolLinear(t.slot, next);
        }
        refreshReviewMixUi();
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        const stoppedAtUnity =
            isMixLaneDbAtUnity(nextDb) &&
            !atUnityBefore &&
            ((deltaDb > 0 && currentDb < 0) || (deltaDb < 0 && currentDb > 0));
        return stoppedAtUnity;
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

    function clampExtraTrackTimelineStartSec(slot, sec) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return 0;
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        return Math.max(0, Math.round(n / step) * step);
    }

    function getExtraTrackTimelineStartSec(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return 0;
        const n = Number(tr.timelineStartSec);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function extraTrackTimelineEndSec(slot) {
        const start = getExtraTrackTimelineStartSec(slot);
        const dur = extraTrackBufferDuration(slot);
        return start + (dur > 0 ? dur : 0);
    }

    function setExtraTrackTimelineStartSec(slot, sec, opt) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.buffer) return;
        const next = clampExtraTrackTimelineStartSec(slot, sec);
        if (Math.abs(next - getExtraTrackTimelineStartSec(slot)) < 0.0005) return;
        tr.timelineStartSec = next;
        if (opt && opt.skipRedraw) return;
        if (typeof drawExtraTrackWaveform === 'function') drawExtraTrackWaveform(slot);
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (!(opt && opt.skipPersist)) {
            if (typeof schedulePersistExtraTrackSlot === 'function') {
                schedulePersistExtraTrackSlot(slot);
            } else if (typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
        }
    }

    window.getExtraTrackTimelineStartSec = getExtraTrackTimelineStartSec;
    window.setExtraTrackTimelineStartSec = setExtraTrackTimelineStartSec;
    window.extraTrackTimelineEndSec = extraTrackTimelineEndSec;

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

    function expectedTransportSecForTrack(tr, ctx, slot) {
        if (
            !tr ||
            tr.source == null ||
            !Number.isFinite(tr.playbackAnchorTransportSec) ||
            !Number.isFinite(tr.playbackAnchorCtxTime)
        ) {
            return null;
        }
        let expected;
        if (ctx.currentTime < tr.playbackAnchorCtxTime) {
            expected = tr.playbackAnchorTransportSec;
        } else {
            expected =
                tr.playbackAnchorTransportSec + (ctx.currentTime - tr.playbackAnchorCtxTime);
        }
        if (slot >= 0 && slot < EXTRA_TRACK_COUNT) {
            const end = extraTrackPlayableTransportEndSec(slot);
            if (Number.isFinite(end) && end > 0) {
                expected = Math.min(expected, end);
            }
        }
        return expected;
    }

    function isExtraTrackSourceAudibleOnCtx(tr, ctx) {
        if (!tr || tr.source == null || !Number.isFinite(tr.playbackAnchorCtxTime)) {
            return false;
        }
        return ctx.currentTime >= tr.playbackAnchorCtxTime - 0.0005;
    }

    function extraTrackPlayableTransportEndSec(slot) {
        return getExtraTrackTimelineStartSec(slot) + extraTrackBufferDuration(slot);
    }

    function isExtraTrackWithinPlayableTimeline(slot, transportSec) {
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return false;
        const start = getExtraTrackTimelineStartSec(slot);
        const end = extraTrackPlayableTransportEndSec(slot);
        return t >= start - 0.0005 && t < end - 0.002;
    }

    function shouldExtraTrackSourceBePlaying(slot) {
        if (!isExtraTrackAudible(slot)) return false;
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.buffer) return false;
        if (!isTransportPlayingForExtra()) return false;
        const audioT = getAudioSyncTransportSec();
        if (!isExtraTrackWithinPlayableTimeline(slot, audioT)) {
            return false;
        }
        const ctx = ensureReviewMixCtx();
        if (tr.source && ctx && !isExtraTrackSourceAudibleOnCtx(tr, ctx)) {
            return true;
        }
        return true;
    }

    function stopExtraTrackSourceIfPastPlayableEnd(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.source) return;
        const audioT = getAudioSyncTransportSec();
        if (!isExtraTrackWithinPlayableTimeline(slot, audioT)) {
            stopExtraTrackSource(slot);
        }
    }

    function extraTrackRoutingMismatch() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const tr = extraTrackBySlot(i);
            const shouldPlay = shouldExtraTrackSourceBePlaying(i);
            const playing = !!(tr && tr.source);
            if (shouldPlay === playing) continue;
            if (!shouldPlay && playing) {
                stopExtraTrackSourceIfPastPlayableEnd(i);
                if (!tr || !tr.source) continue;
            }
            return true;
        }
        return false;
    }

    /** 再生中に Ex ソースの開始／停止がトランスポートとずれている */
    function reviewMixNeedsPlaybackSync() {
        if (!isTransportPlayingForExtra()) return false;
        return extraTrackRoutingMismatch();
    }

    window.reviewMixNeedsPlaybackSync = reviewMixNeedsPlaybackSync;

    function extraTracksNeedResync(targetSec, ctx) {
        if (extraTrackRoutingMismatch()) return true;
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackAudible(i)) continue;
            if (!shouldExtraTrackSourceBePlaying(i)) {
                const tr = extraTrackBySlot(i);
                if (tr && tr.source) return true;
                continue;
            }
            const tr = extraTrackBySlot(i);
            if (!tr || !tr.source) return true;
            if (!isExtraTrackSourceAudibleOnCtx(tr, ctx)) continue;
            const expected = expectedTransportSecForTrack(tr, ctx, i);
            if (
                expected == null ||
                Math.abs(expected - targetSec) > EXTRA_AUDIO_RESYNC_DRIFT_SEC
            ) {
                return true;
            }
        }
        return false;
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
        let anyActive = false;
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackAudible(i)) continue;
            if (!shouldExtraTrackSourceBePlaying(i)) continue;
            const tr = extraTrackBySlot(i);
            if (!tr || !tr.source) continue;
            if (!isExtraTrackSourceAudibleOnCtx(tr, ctx)) continue;
            anyActive = true;
            const expected = expectedTransportSecForTrack(tr, ctx, i);
            if (expected == null || !Number.isFinite(expected)) return null;
            if (best == null || expected > best) best = expected;
        }
        return anyActive ? best : null;
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

    function cacheExtraTrackPersistBlob(tr, file, ab) {
        if (!tr || !file || !ab || ab.byteLength < 1) {
            if (tr) tr.persistBlob = null;
            return null;
        }
        const type =
            file.type ||
            (typeof mimeTypeHintForAudioFileName === 'function'
                ? mimeTypeHintForAudioFileName(file.name)
                : 'application/octet-stream');
        tr.persistBlob = new Blob([ab.slice(0)], { type });
        return tr.persistBlob;
    }

    function getExtraTrackPersistEntry(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.file || !tr.buffer || !tr.persistBlob || tr.persistBlob.size < 1) {
            return null;
        }
        const peaks = clonePeaksForPersist(tr.peaks);
        const timelineStart = getExtraTrackTimelineStartSec(slot);
        return {
            slot,
            name: tr.file.name,
            lastModified: tr.file.lastModified,
            blob: tr.persistBlob,
            byteLength: tr.persistBlob.size,
            duration: tr.buffer.duration,
            peaks,
            timelineStartSec: timelineStart > 0 ? timelineStart : 0,
        };
    }

    /** Web Audio を使わず WAV から peaks のみ構築（復元時のデコード待ち回避） */
    function buildPeaksPreviewFromWavArrayBuffer(ab, barCount) {
        if (!ab || ab.byteLength < 44) return null;
        const view = new DataView(ab);
        const sig = String.fromCharCode(
            view.getUint8(0),
            view.getUint8(1),
            view.getUint8(2),
            view.getUint8(3),
        );
        if (sig !== 'RIFF') return null;
        let offset = 12;
        let numChannels = 0;
        let sampleRate = 0;
        let bitsPerSample = 0;
        let dataOffset = 0;
        let dataLen = 0;
        while (offset + 8 <= ab.byteLength) {
            const id = String.fromCharCode(
                view.getUint8(offset),
                view.getUint8(offset + 1),
                view.getUint8(offset + 2),
                view.getUint8(offset + 3),
            );
            const size = view.getUint32(offset + 4, true);
            if (id === 'fmt ') {
                numChannels = view.getUint16(offset + 10, true);
                sampleRate = view.getUint32(offset + 12, true);
                bitsPerSample = view.getUint16(offset + 22, true);
            } else if (id === 'data') {
                dataOffset = offset + 8;
                dataLen = size;
                break;
            }
            offset += 8 + size + (size & 1);
        }
        if (!dataOffset || !numChannels || !sampleRate || !bitsPerSample) return null;
        const bytesPerSample = bitsPerSample / 8;
        const frameSize = bytesPerSample * numChannels;
        if (frameSize < 1) return null;
        const totalFrames = Math.floor(dataLen / frameSize);
        if (totalFrames < 1) return null;
        const duration = totalFrames / sampleRate;
        const bars = Math.max(1, barCount | 0);
        const block = Math.max(1, Math.floor(totalFrames / bars));
        const peaks = new Array(bars);
        for (let i = 0; i < bars; i++) {
            let min = 0;
            let max = 0;
            const start = i * block;
            const end = Math.min(totalFrames, start + block);
            for (let f = start; f < end; f++) {
                const pos = dataOffset + f * frameSize;
                if (pos + bytesPerSample > ab.byteLength) break;
                let v = 0;
                if (bitsPerSample === 16) {
                    v = view.getInt16(pos, true) / 32768;
                } else if (bitsPerSample === 24) {
                    let sample = view.getUint8(pos) | (view.getUint8(pos + 1) << 8);
                    const hi = view.getInt8(pos + 2);
                    sample |= hi << 16;
                    v = sample / 8388608;
                } else if (bitsPerSample === 32) {
                    v = view.getFloat32(pos, true);
                    if (!Number.isFinite(v)) {
                        v = view.getInt32(pos, true) / 2147483648;
                    }
                } else {
                    return null;
                }
                if (v < min) min = v;
                if (v > max) max = v;
            }
            peaks[i] = { min, max };
        }
        return { peaks, duration };
    }

    async function buildExtraTrackPeaksPreviewFromWavBlob(slot, entry) {
        if (!entry || !entry.blob) return false;
        const name = entry.name || '';
        if (!/\.wav$/i.test(name) && !/\.wave$/i.test(name)) return false;
        try {
            const ab = await entry.blob.arrayBuffer();
            const w =
                typeof rawMasterTimelineWidthCss === 'function'
                    ? rawMasterTimelineWidthCss()
                    : 0;
            const barCount = Math.min(4096, Math.max(200, w > 0 ? w : 1200));
            const built = buildPeaksPreviewFromWavArrayBuffer(ab, barCount);
            if (!built || !built.peaks || !built.peaks.length) return false;
            return applyExtraTrackPeaksPreview(slot, {
                slot,
                name: entry.name,
                lastModified: entry.lastModified,
                duration: built.duration,
                peaks: built.peaks,
            });
        } catch (e) {
            writeLog(
                'Extra audio ' +
                    (slot + 1) +
                    ': WAV preview failed — ' +
                    (e && e.message ? e.message : String(e)),
            );
            return false;
        }
    }

    /** セッション復元: デコード完了前に保存済み peaks で波形だけ先に描画 */
    function applyExtraTrackPeaksPreview(slot, entry) {
        if (!entry || !(Number(entry.duration) > 0) || !entry.peaks || !entry.peaks.length) {
            return false;
        }
        const tr = extraTrackBySlot(slot);
        const ui = getExtraUi(slot);
        if (!tr || !ui) return false;
        setExtraTrackLaneUiOpen(slot, true);
        tr.peaks = entry.peaks;
        tr.restoreDurationHint = entry.duration;
        tr.timelineStartSec =
            Number.isFinite(entry.timelineStartSec) && entry.timelineStartSec > 0
                ? clampExtraTrackTimelineStartSec(slot, entry.timelineStartSec)
                : 0;
        tr.file = {
            name: entry.name || 'audio.wav',
            lastModified:
                typeof entry.lastModified === 'number' ? entry.lastModified : Date.now(),
        };
        setExtraTrackStatus(slot, 'Restoring…');
        if (ui.meta) ui.meta.classList.add('loaded');
        refreshExtraTrackUi(slot);
        scheduleExtraTrackWaveformRedraw(slot);
        writeLog(
            'Extra audio ' +
                (slot + 1) +
                ': waveform preview restored (' +
                entry.peaks.length +
                ' bars)',
        );
        return true;
    }

    /** ページ終了時も即座に使える同期スナップショット（persistBlob キャッシュ） */
    function getExtraTracksPersistSnapshot() {
        const out = [];
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const entry = getExtraTrackPersistEntry(i);
            if (entry) out.push(entry);
        }
        return out.length ? out : null;
    }

    function schedulePersistExtraTrackSlot(slot) {
        const entry = getExtraTrackPersistEntry(slot);
        if (!entry) return;
        if (typeof persistExtraTrackEntryToSession === 'function') {
            void persistExtraTrackEntryToSession(entry).catch((e) => {
                writeLog(
                    'Session: extra ' +
                        (slot + 1) +
                        ' save failed — ' +
                        (e && e.message ? e.message : String(e)),
                );
            });
        } else if (typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
    }

    function prepareReviewMixForNewVideoLoad() {
        reviewMixVideoWireFailed = false;
    }

    async function finalizeReviewMixAfterSessionRestore() {
        if (typeof ensureReviewMixVideoRouting === 'function') {
            ensureReviewMixVideoRouting();
        }
        const ctx = ensureReviewMixCtx();
        if (ctx && ctx.state === 'suspended') {
            try {
                await ctx.resume();
            } catch (_) {}
        }
        if (typeof applyVideoMixFromSessionRestore === 'function') {
            applyVideoMixFromSessionRestore();
        }
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            applyExtraSlotMixFromSessionRestore(i);
        }
        refreshReviewMixUi();
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (typeof ensureExtraTrackWaveformsDrawn === 'function') {
            ensureExtraTrackWaveformsDrawn({ notifyMaster: true, maxFrames: 40 });
        }
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
        const scheduleWhen = acquireExtraMixScheduleTime(ctx, opt);
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            stopExtraTrackSourceIfPastPlayableEnd(i);
            const tr = extraTrackBySlot(i);
            if (!shouldExtraTrackSourceBePlaying(i)) {
                stopExtraTrackSource(i);
                continue;
            }
            const timelineStart = getExtraTrackTimelineStartSec(i);
            const bufferOff = audioT - timelineStart;
            if (!tr || !tr.buffer || bufferOff < 0 || bufferOff >= tr.buffer.duration - 0.002) {
                stopExtraTrackSource(i);
                continue;
            }
            let needsStart = force || !tr.source;
            if (!needsStart && tr.source && isExtraTrackSourceAudibleOnCtx(tr, ctx)) {
                const expected = expectedTransportSecForTrack(tr, ctx, i);
                needsStart =
                    expected == null ||
                    Math.abs(expected - masterT) > EXTRA_AUDIO_RESYNC_DRIFT_SEC;
            }
            if (!needsStart) continue;
            startExtraTrackSource(i, bufferOff, {
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
        let decoded = ctx.decodeAudioData(copy);
        if (!decoded || typeof decoded.then !== 'function') {
            decoded = new Promise((resolve, reject) => {
                ctx.decodeAudioData(copy, resolve, reject);
            });
        }
        return Promise.race([
            decoded,
            new Promise((_, reject) => {
                setTimeout(
                    () => reject(new Error('decodeAudioData timeout')),
                    EXTRA_AUDIO_DECODE_TIMEOUT_MS,
                );
            }),
        ]);
    }

    function extraTrackContentDurationSec(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return 0;
        if (tr.buffer && tr.buffer.duration > 0) return tr.buffer.duration;
        const hint = Number(tr.restoreDurationHint);
        return Number.isFinite(hint) && hint > 0 ? hint : 0;
    }

    function hasExtraTrackWaveformPeaks(slot) {
        const tr = extraTrackBySlot(slot);
        return !!(tr && tr.peaks && tr.peaks.length > 0);
    }

    function clonePeaksForPersist(peaks) {
        if (!peaks || !peaks.length) return null;
        const out = new Array(peaks.length);
        for (let i = 0; i < peaks.length; i++) {
            const p = peaks[i];
            out[i] = {
                min: p && Number.isFinite(p.min) ? p.min : 0,
                max: p && Number.isFinite(p.max) ? p.max : 0,
            };
        }
        return out;
    }

    /** 再生用 reviewMixCtx とは別コンテキストでデコード（リロード直後のハング回避） */
    async function decodeExtraFileArrayBuffer(ab) {
        if (!ab || ab.byteLength < 1) throw new Error('empty file');
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (OfflineCtx) {
            try {
                const offline = new OfflineCtx(2, 2, 44100);
                return await decodeArrayBufferToAudioBuffer(offline, ab);
            } catch (err) {
                writeLog(
                    'Extra audio decode: OfflineAudioContext failed — ' +
                        (err && err.message ? err.message : String(err)),
                );
            }
        }
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) throw new Error('AudioContext unavailable');
        const decodeCtx = new Ctx();
        try {
            if (decodeCtx.state === 'suspended') {
                try {
                    await decodeCtx.resume();
                } catch (_) {}
            }
            return await decodeArrayBufferToAudioBuffer(decodeCtx, ab);
        } finally {
            if (decodeCtx.close) {
                try {
                    await decodeCtx.close();
                } catch (_) {}
            }
        }
    }

    function rawMasterTimelineWidthCss() {
        const el =
            typeof audioWaveformLanesTracks !== 'undefined' && audioWaveformLanesTracks
                ? audioWaveformLanesTracks
                : null;
        if (el) return el.clientWidth | 0;
        if (typeof audioWaveformTrack !== 'undefined' && audioWaveformTrack) {
            return audioWaveformTrack.clientWidth | 0;
        }
        return 0;
    }

    function rebuildExtraTrackPeaksIfNeeded(slot) {
        const tr = extraTrackBySlot(slot);
        const ui = getExtraUi(slot);
        if (!tr || !ui || !ui.track) return false;
        if (!tr.buffer) return hasExtraTrackWaveformPeaks(slot);
        if (rawMasterTimelineWidthCss() < EXTRA_WAVEFORM_LAYOUT_MIN_CSS) return false;
        const sized = syncExtraCanvasSize(ui);
        if (!sized) return false;
        if (!tr.peaks || tr.peaks.length !== sized.barCount) {
            tr.peaks = peaksFromBuffer(tr.buffer, sized.barCount);
        }
        return !!(tr.peaks && tr.peaks.length > 0);
    }

    function extraTrackWaveformDrawReady(slot) {
        if (!hasExtraTrackWaveformPeaks(slot) || !isExtraTrackLaneShown(slot)) return true;
        const tr = extraTrackBySlot(slot);
        const ui = getExtraUi(slot);
        if (!tr || !ui || !ui.canvas) return false;
        if (!tr.peaks || tr.peaks.length < 1) return false;
        const laneW = rawMasterTimelineWidthCss();
        if (laneW < EXTRA_WAVEFORM_LAYOUT_MIN_CSS) return false;
        const styleW = parseFloat(ui.canvas.style.width) || 0;
        return styleW >= EXTRA_WAVEFORM_LAYOUT_MIN_CSS;
    }

    /** レイアウト未確定時は rAF で再試行し、peaks 欠落時は再生成する。 */
    function ensureExtraTrackWaveformsDrawn(opt) {
        const gen = ++extraWaveformEnsureGen;
        const maxFrames = opt && opt.maxFrames > 0 ? opt.maxFrames : 28;
        const slots =
            opt && Array.isArray(opt.slots) && opt.slots.length
                ? opt.slots.filter((s) => s >= 0 && s < EXTRA_TRACK_COUNT)
                : null;
        let frame = 0;

        const targets = () => {
            const out = [];
            for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
                if (slots && slots.indexOf(i) < 0) continue;
                if (isExtraTrackLoaded(i) || hasExtraTrackWaveformPeaks(i)) out.push(i);
            }
            return out;
        };

        const paintSlot = (slot) => {
            if (rawMasterTimelineWidthCss() < EXTRA_WAVEFORM_LAYOUT_MIN_CSS) return;
            if (!rebuildExtraTrackPeaksIfNeeded(slot)) return;
            drawExtraTrackWaveform(slot);
        };

        const step = () => {
            if (gen !== extraWaveformEnsureGen) return;
            frame += 1;
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
            const list = targets();
            let pending = false;
            for (let j = 0; j < list.length; j++) {
                const slot = list[j];
                if (!extraTrackWaveformDrawReady(slot)) {
                    pending = true;
                    paintSlot(slot);
                }
            }
            if (pending && frame < maxFrames) {
                requestAnimationFrame(step);
                return;
            }
            if (pending && frame >= maxFrames) {
                writeLog('Extra audio: waveform layout retry limit (redrawing anyway)');
                for (let j = 0; j < list.length; j++) paintSlot(list[j]);
            }
            if (opt && opt.notifyMaster && typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
        };

        requestAnimationFrame(step);
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
        if (tr && tr.buffer && (!tr.peaks || tr.peaks.length < 1)) {
            rebuildExtraTrackPeaksIfNeeded(slot);
        }
        const sized = syncExtraCanvasSize(ui);
        if (!sized || !sized.ctx) return;
        const { ctx, wCss, hCss } = sized;
        const contentDur = extraTrackContentDurationSec(slot);
        const audible =
            typeof isExtraTrackAudible === 'function' ? isExtraTrackAudible(slot) : true;
        const grad =
            typeof timelineWaveformFillGradient === 'function'
                ? timelineWaveformFillGradient(ctx, hCss, 'extra', audible)
                : null;
        const endDrawOpt = {
            timelineStartSec: getExtraTrackTimelineStartSec(slot),
        };
        drawPeaksForMasterTimeline(ctx, tr ? tr.peaks : null, wCss, hCss, contentDur, grad, endDrawOpt);
    }

    function redrawAllExtraTrackWaveforms() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) drawExtraTrackWaveform(i);
    }

    /** レーン表示直後は clientWidth が 0 のことがあるため、レイアウト確定まで再試行する。 */
    function scheduleExtraTrackWaveformRedraw(slot, opt) {
        const ensureOpt = {
            notifyMaster: !!(opt && opt.notifyMaster),
            maxFrames: opt && opt.maxFrames > 0 ? opt.maxFrames : undefined,
        };
        if (slot >= 0 && slot < EXTRA_TRACK_COUNT) {
            ensureOpt.slots = [slot];
        }
        ensureExtraTrackWaveformsDrawn(ensureOpt);
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
    window.extraTrackBufferDuration = extraTrackBufferDuration;
    window.isExtraTrackLoaded = isExtraTrackLoaded;
    window.hasAnyExtraTrackLoaded = hasAnyExtraTrackLoaded;
    window.EXTRA_TRACK_COUNT = EXTRA_TRACK_COUNT;
    window.loadExtraTrackFile = loadExtraTrackFile;
    window.redrawAllExtraTrackWaveforms = redrawAllExtraTrackWaveforms;
    window.scheduleExtraTrackWaveformRedraw = scheduleExtraTrackWaveformRedraw;
    window.ensureExtraTrackWaveformsDrawn = ensureExtraTrackWaveformsDrawn;
    window.finalizeReviewMixAfterSessionRestore = finalizeReviewMixAfterSessionRestore;
    window.prepareReviewMixForNewVideoLoad = prepareReviewMixForNewVideoLoad;
    window.applyExtraTrackPeaksPreview = applyExtraTrackPeaksPreview;
    window.buildExtraTrackPeaksPreviewFromWavBlob = buildExtraTrackPeaksPreviewFromWavBlob;
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
            resetExtraTrackMixToDefault(slot);
            setExtraTrackLaneUiOpen(slot, false, { deferLayout: true });
            setExtraTrackStatus(slot, 'Not Loaded');
            refreshExtraTrackUi(slot);
            if (typeof refreshTrackLaneControlsUi === 'function') {
                refreshTrackLaneControlsUi();
            }
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
        tr.persistBlob = null;
        tr.restoreDurationHint = 0;
        tr.timelineStartSec = 0;
        resetExtraTrackMixToDefault(slot);
        try {
            if (tr.analyser) tr.analyser.disconnect();
        } catch (_) {}
        tr.analyser = null;
        setExtraTrackLaneUiOpen(slot, false, { deferLayout: true });
        setExtraTrackLoaded(slot, false);
        setExtraTrackStatus(slot, 'Not Loaded');
        refreshExtraTrackUi(slot);
        if (typeof refreshTrackLaneControlsUi === 'function') {
            refreshTrackLaneControlsUi();
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        if (typeof removeExtraTrackFromSession === 'function') {
            void removeExtraTrackFromSession(slot);
        } else if (typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        if (typeof refreshExportMediaOptionsUi === 'function') {
            refreshExportMediaOptionsUi();
        }
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

    async function loadExtraTrackFile(slot, file, opt) {
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
        setExtraTrackStatus(slot, 'Decoding…');
        let buffer = null;
        try {
            const ab = await file.arrayBuffer();
            if (gen !== tr.loadGen) {
                if (opt && opt.fromSessionRestore) {
                    writeLog('Extra audio ' + (slot + 1) + ': restore aborted (superseded)');
                }
                return;
            }
            if (!ab || ab.byteLength < 1) {
                throw new Error('empty file');
            }
            cacheExtraTrackPersistBlob(tr, file, ab);
            writeLog(
                'Extra audio ' +
                    (slot + 1) +
                    ': decoding ' +
                    (file.name || 'audio') +
                    ' (' +
                    Math.round(ab.byteLength / 1024) +
                    ' KB)…',
            );
            let decodeProgressTimer = 0;
            decodeProgressTimer = setInterval(() => {
                writeLog('Extra audio ' + (slot + 1) + ': still decoding…');
            }, 4000);
            try {
                buffer = await decodeExtraFileArrayBuffer(ab);
            } finally {
                if (decodeProgressTimer) clearInterval(decodeProgressTimer);
            }
            if (gen !== tr.loadGen) {
                if (opt && opt.fromSessionRestore) {
                    writeLog('Extra audio ' + (slot + 1) + ': restore aborted after decode');
                }
                return;
            }
            if (!buffer || !(buffer.duration > 0)) {
                throw new Error('decode returned no audio');
            }
        } catch (err) {
            if (gen !== tr.loadGen) {
                writeLog(
                    'Extra audio ' +
                        (slot + 1) +
                        ': decode aborted (superseded) — ' +
                        (err && err.message ? err.message : String(err)),
                );
                return;
            }
            tr.file = null;
            tr.buffer = null;
            tr.peaks = null;
            tr.persistBlob = null;
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
        tr.restoreDurationHint = 0;
        if (opt && opt.fromSessionRestore && Number.isFinite(opt.timelineStartSec)) {
            tr.timelineStartSec = clampExtraTrackTimelineStartSec(slot, opt.timelineStartSec);
        } else {
            tr.timelineStartSec = 0;
        }
        if (!(opt && opt.fromSessionRestore)) {
            tr.muted = false;
            tr.solo = false;
            tr.volLinear = 1;
        }

        try {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            if (gen !== tr.loadGen) {
                writeLog('Extra audio ' + (slot + 1) + ': load superseded (skipped waveform)');
                tr.file = null;
                tr.buffer = null;
                tr.peaks = null;
                tr.persistBlob = null;
                return;
            }
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
            if (opt && opt.fromSessionRestore) {
                applyExtraSlotMixFromSessionRestore(slot);
            } else {
                removeExtraSlotFromSessionMixRestore(slot);
                applyExtraTrackLaneGain(slot);
                refreshReviewMixUi();
            }
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
            schedulePersistExtraTrackSlot(slot);
            if (!(opt && opt.fromSessionRestore) && typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
            scheduleExtraTrackWaveformRedraw(slot, { notifyMaster: true });
            if (typeof refreshExportMediaOptionsUi === 'function') {
                refreshExportMediaOptionsUi();
            }
            if (typeof updateControlsEnabled === 'function') {
                updateControlsEnabled();
            }
        } catch (err) {
            if (gen !== tr.loadGen) return;
            writeLog(
                'Extra audio ' +
                    (slot + 1) +
                    ': loaded but waveform draw failed — ' +
                    (err && err.message ? err.message : String(err))
            );
            refreshExtraTrackUi(slot);
            scheduleExtraTrackWaveformRedraw(slot);
            if (typeof updateControlsEnabled === 'function') {
                updateControlsEnabled();
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
            writeLog('Extra audio: all Ex slots are full — drop ignored');
            return;
        }
        let ignored = 0;
        for (let i = 0; i < audios.length; i++) {
            while (slot < EXTRA_TRACK_COUNT && isExtraTrackLoaded(slot)) {
                slot += 1;
            }
            if (slot < 0 || slot >= EXTRA_TRACK_COUNT) {
                ignored += audios.length - i;
                break;
            }
            setExtraTrackLaneUiOpen(slot, true, { deferLayout: true });
            void loadExtraTrackFile(slot, audios[i]);
            slot += 1;
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        if (ignored > 0) {
            writeLog(
                'Extra audio: all Ex slots are full — ' +
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
        const lane2 = target.closest('#extraAudioLane2, #extraAudioMeta2');
        if (lane2) return 2;
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
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (isExtraTrackLoaded(i)) return true;
        }
        return false;
    }

    function hasAnyExtraTrackLoaded() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (isExtraTrackLoaded(i)) return true;
        }
        return false;
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
            writeLog('Extra audio: all Ex slots are full — drop ignored');
            return;
        }
        assignExtraAudioFiles(audios, slot);
    }

    window.assignExtraAudioFiles = assignExtraAudioFiles;
    window.assignExtraAudioFilesFromDrop = assignExtraAudioFilesFromDrop;

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
            const onLaneResize = () => {
                for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
                    if (!isExtraTrackLoaded(i)) continue;
                    rebuildExtraTrackPeaksIfNeeded(i);
                    drawExtraTrackWaveform(i);
                }
            };
            const obs = new ResizeObserver(onLaneResize);
            if (typeof audioWaveformLanesTracks !== 'undefined' && audioWaveformLanesTracks) {
                obs.observe(audioWaveformLanesTracks);
            }
            for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
                const ui = getExtraUi(i);
                if (ui && ui.track) obs.observe(ui.track);
            }
        }
        refreshVideoAudioLaneFileName();
    }
