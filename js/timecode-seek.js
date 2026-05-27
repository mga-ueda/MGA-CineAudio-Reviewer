    function syncSeekMax() {
        refreshMasterFrameSec();
        const dur =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : getDuration(videoMain);
        if (!seekBar) return;
        seekBar.max = String(Math.max(dur, 0.01));
        seekBar.step = String(masterFrameSec);
        totalTimeEl.textContent = formatTimecodeForTransport(dur);
        updateSeekUiFromVideo();
        if (typeof refreshMarkerUi === 'function') refreshMarkerUi();
        if (typeof updateLaneContentEndMarkers === 'function') updateLaneContentEndMarkers();
    }

    function getTransportSec() {
        if (
            (typeof isTransportTailPlaybackActive === 'function' &&
                isTransportTailPlaybackActive()) ||
            (typeof isTransportPlaying === 'function' && isTransportPlaying())
        ) {
            if (typeof getTransportPlaybackClockSec === 'function') {
                return getTransportPlaybackClockSec();
            }
            if (
                typeof transportPlaybackSec === 'number' &&
                Number.isFinite(transportPlaybackSec)
            ) {
                return transportPlaybackSec;
            }
        }
        if (!seekBar) return videoMain.currentTime || 0;
        const t = parseFloat(seekBar.value);
        return Number.isFinite(t) ? t : videoMain.currentTime || 0;
    }

    /** WebM 書き出し描画用: マスタークロックを進めつつ正しいトランスポート秒を返す。 */
    function getTransportSecForVideoExport() {
        if (
            typeof syncTransportPlaybackClockFromAudio === 'function' &&
            typeof isTransportUiClockActive === 'function' &&
            isTransportUiClockActive()
        ) {
            syncTransportPlaybackClockFromAudio();
        }
        if (typeof getTransportPlaybackClockSec === 'function') {
            const clockActive =
                (typeof isTransportUiClockActive === 'function' &&
                    isTransportUiClockActive()) ||
                (typeof isTransportTailPlaybackActive === 'function' &&
                    isTransportTailPlaybackActive()) ||
                (typeof isTransportPlaying === 'function' && isTransportPlaying());
            if (clockActive) return getTransportPlaybackClockSec();
        }
        return getTransportSec();
    }

    function setTransportSec(t) {
        if (!seekBar) return;
        const n = Number(t);
        if (!Number.isFinite(n)) return;
        seekBar.value = String(n);
    }

    function transportTargetSec(t) {
        if (typeof clampTransportSec === 'function') {
            return clampTransportSec(t);
        }
        const d = getDuration(videoMain);
        if (!d) return null;
        let n = Number(t);
        if (!Number.isFinite(n)) n = getTransportSec();
        return Math.max(0, Math.min(d, n));
    }

    /** @returns {boolean} true when currentTime was changed (seek started) */
    function applyTimeToVideoIfNeeded(t) {
        const x = transportTargetSec(t);
        if (x == null) return false;
        setTransportSec(x);
        if (typeof applyVideoTimeForTransportSec === 'function') {
            return applyVideoTimeForTransportSec(x, { force: true });
        }
        const cur = videoMain.currentTime || 0;
        const needs =
            videoMain.ended || !Number.isFinite(cur) || Math.abs(cur - x) > 0.001;
        if (needs) videoMain.currentTime = x;
        return needs;
    }

    function applyTimeToVideo(t, opt) {
        if (typeof applyTransportAtSec === 'function') {
            applyTransportAtSec(t, Object.assign({ resumeAfter: false }, opt || {}));
            return;
        }
        const x = transportTargetSec(t);
        if (x == null) return;
        videoMain.currentTime = x;
        setTransportSec(x);
        if (typeof syncExtraAudioToTransport === 'function') syncExtraAudioToTransport();
    }

    let firstFramePrimedForUrl = '';

    /** セッション復元: 動画メタデータが揃ってから Ex 音声を復元する */
    function waitForVideoReadyForSessionRestore(timeoutMs) {
        const ms = timeoutMs > 0 ? timeoutMs : 15000;
        return new Promise((resolve) => {
            if (typeof videoReady === 'function' && videoReady()) {
                resolve(true);
                return;
            }
            let settled = false;
            const finish = (ok) => {
                if (settled) return;
                settled = true;
                videoMain.removeEventListener('loadedmetadata', onReady);
                videoMain.removeEventListener('loadeddata', onReady);
                videoMain.removeEventListener('durationchange', onReady);
                videoMain.removeEventListener('error', onErr);
                clearTimeout(timer);
                resolve(!!ok);
            };
            const onReady = () => {
                finish(typeof videoReady === 'function' && videoReady());
            };
            const onErr = () => finish(false);
            videoMain.addEventListener('loadedmetadata', onReady);
            videoMain.addEventListener('loadeddata', onReady);
            videoMain.addEventListener('durationchange', onReady);
            videoMain.addEventListener('error', onErr, { once: true });
            const timer = setTimeout(
                () => finish(typeof videoReady === 'function' && videoReady()),
                ms,
            );
        });
    }

    window.waitForVideoReadyForSessionRestore = waitForVideoReadyForSessionRestore;

    /** セッション復元後は常に先頭（シーク位置は記憶しない） */
    function applySessionTransportAtHead() {
        pendingRestoreTime = null;
        if (typeof resetTransportPlaybackClock === 'function') resetTransportPlaybackClock();
        if (typeof clearTransportTailPlayback === 'function') clearTransportTailPlayback();
        if (typeof setTransportSec === 'function') setTransportSec(0);
        if (seekBar) seekBar.value = '0';
        if (currentTimeEl) currentTimeEl.textContent = formatTimecodeForTransport(0);
        if (videoMain && videoReady()) {
            videoMain.pause();
            if (typeof applyTimeToVideoIfNeeded === 'function') {
                applyTimeToVideoIfNeeded(0);
            } else {
                try {
                    videoMain.currentTime = 0;
                } catch (_) {}
            }
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (typeof updateSeekUiFromVideo === 'function') updateSeekUiFromVideo();
        if (typeof updateAllWaveformPlayheads === 'function') updateAllWaveformPlayheads();
        if (typeof refreshVideoPastEndBlackoutUi === 'function') refreshVideoPastEndBlackoutUi();
    }
    window.applySessionTransportAtHead = applySessionTransportAtHead;
    window.primePendingRestoreTransportUi = primePendingRestoreTransportUi;
    window.applyPendingTransportRestore = applyPendingTransportRestore;
    window.getTransportSec = getTransportSec;
    window.getTransportSecForVideoExport = getTransportSecForVideoExport;
    window.forceTransportRafLoop = forceTransportRafLoop;
    window.startVideoPlayback = startVideoPlayback;

    function rememberTransportPlaybackStartSec(sec) {
        let n = Number(sec);
        if (!Number.isFinite(n)) return;
        if (typeof clampTransportSec === 'function') {
            n = clampTransportSec(n);
        } else {
            n = Math.max(0, n);
        }
        transportPlaybackStartSec = n;
    }

    function clearTransportPlaybackStartSec() {
        transportPlaybackStartSec = null;
    }

    async function replayTransportFromPlaybackStart() {
        if (!Number.isFinite(transportPlaybackStartSec)) return false;
        const ready =
            typeof transportControlsReady === 'function'
                ? transportControlsReady()
                : typeof videoReady === 'function' && videoReady();
        if (!ready) return false;
        const target = transportPlaybackStartSec;
        if (typeof seekTransportToAndWait === 'function') {
            await seekTransportToAndWait(target, { resumeAfter: false });
        } else {
            applyTimeToVideo(target);
            if (typeof updateSeekUiFromVideo === 'function') updateSeekUiFromVideo();
        }
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        writeLog(
            'Keyboard: Alt+Enter -> replay from ' + formatTimecodeForTransport(target)
        );
        await playTransportAfterKeyboardSeek();
        return true;
    }

    window.rememberTransportPlaybackStartSec = rememberTransportPlaybackStartSec;
    window.clearTransportPlaybackStartSec = clearTransportPlaybackStartSec;
    window.replayTransportFromPlaybackStart = replayTransportFromPlaybackStart;
    window.playTransportAfterKeyboardSeek = playTransportAfterKeyboardSeek;

    /** リロード直後の黒画面回避（軽いシークで1フレーム目を描画） */
    function showFirstVideoFrame() {
        if (!videoMain || !videoReady()) return;
        if (videoMain.readyState < 2) return;
        if (firstFramePrimedForUrl && firstFramePrimedForUrl === urlMain) return;
        const cap =
            typeof getPlaybackCapSec === 'function' ? getPlaybackCapSec(videoMain) : 0;
        if (!cap) return;
        const step = Math.max(masterFrameSec > 0 ? masterFrameSec : 1 / 24, 0.001);
        const kick = Math.min(0.08, Math.max(step * 2, 0.02), cap - step);
        if (kick <= 0) return;
        const t0 = videoMain.currentTime || 0;
        if (t0 >= kick * 0.5) {
            firstFramePrimedForUrl = urlMain || '';
            return;
        }
        firstFramePrimedForUrl = urlMain || '';
        const restore = () => {
            if (Math.abs((videoMain.currentTime || 0) - kick) < 0.05) {
                videoMain.currentTime = t0;
            }
        };
        videoMain.addEventListener('seeked', restore, { once: true });
        videoMain.currentTime = kick;
    }

    function logVideoTransportState(tag) {
        let buf = '';
        try {
            const b = videoMain.buffered;
            for (let i = 0; i < b.length; i++) {
                buf +=
                    (i ? '; ' : '') +
                    b.start(i).toFixed(2) +
                    '-' +
                    b.end(i).toFixed(2);
            }
        } catch (_) {}
        writeLog(
            tag +
                ' paused=' +
                videoMain.paused +
                ' t=' +
                (videoMain.currentTime || 0).toFixed(3) +
                ' dur=' +
                videoMain.duration +
                ' rs=' +
                videoMain.readyState +
                ' seek=' +
                videoMain.seeking +
                ' ended=' +
                videoMain.ended +
                (buf ? ' buf=' + buf : '') +
                ' vw=' +
                videoMain.videoWidth +
                'x' +
                videoMain.videoHeight
        );
    }

    function playbackKickSec() {
        const cap =
            typeof getPlaybackCapSec === 'function' ? getPlaybackCapSec(videoMain) : 0;
        const step = Math.max(masterFrameSec > 0 ? masterFrameSec : 1 / 24, 0.001);
        const kick = Math.max(step * 2, 0.04);
        if (cap > 0.15) return Math.min(kick, cap - step);
        return kick;
    }

    async function startMasterTransportTailPlayback(playGen) {
        if (typeof markTransportTailPlaybackActive === 'function') {
            markTransportTailPlaybackActive();
        }
        const t0 =
            typeof clampTransportSec === 'function'
                ? clampTransportSec(getTransportSec())
                : getTransportSec();
        rememberTransportPlaybackStartSec(t0);
        transportPlaybackSec = t0;
        transportPlaybackLastTs = performance.now();
        setTransportSec(t0);
        if (typeof parkVideoAtTransportTail === 'function') parkVideoAtTransportTail();
        else if (typeof applyVideoTimeForTransportSec === 'function') {
            applyVideoTimeForTransportSec(t0, { force: true });
        }
        try {
            videoMain.pause();
        } catch (_) {}
        if (playGen != null && playGen !== transportPlayGeneration) return false;
        pendingRestoreTime = null;
        setPlayingUi(true);
        if (!rafId) rafId = requestAnimationFrame(tick);
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        writeLog(
            'Transport: playback from master tail @ ' + formatTimecodeForTransport(t0)
        );
        return true;
    }

    async function prepareVideoForPlayback() {
        const transportT = getTransportSec();
        if (
            typeof shouldStartMasterTransportTailPlayback === 'function' &&
            shouldStartMasterTransportTailPlayback(transportT)
        ) {
            const t0 =
                typeof clampTransportSec === 'function'
                    ? clampTransportSec(transportT)
                    : transportT;
            transportPlaybackSec = t0;
            transportPlaybackLastTs = performance.now();
            setTransportSec(t0);
            if (typeof parkVideoAtTransportTail === 'function') parkVideoAtTransportTail();
            else if (typeof applyVideoTimeForTransportSec === 'function') {
                applyVideoTimeForTransportSec(t0, { force: true });
            }
            try {
                videoMain.pause();
            } catch (_) {}
            return;
        }
        releaseStuckEnded();
        if (typeof clearVideoParkedForTail === 'function') clearVideoParkedForTail();
        const didSeek = applyTimeToVideoIfNeeded(transportT);
        if (didSeek || videoMain.seeking) {
            await waitForVideoSeekIdle(3000);
        }
        transportPlaybackSec = getTransportSec();
        transportPlaybackLastTs = performance.now();

        const cap =
            typeof getPlaybackCapSec === 'function' ? getPlaybackCapSec(videoMain) : 0;
        const kick = playbackKickSec();
        if (cap > 0 && transportT < kick * 0.5) {
            const cur = videoMain.currentTime || 0;
            if (cur < kick * 0.5) {
                const savedAudio = transportPlaybackSec;
                videoMain.currentTime = kick;
                await waitForVideoSeekIdle(3000);
                if (typeof applyVideoTimeForTransportSec === 'function') {
                    applyVideoTimeForTransportSec(transportT, { force: true });
                } else {
                    videoMain.currentTime = transportT;
                }
                transportPlaybackSec = savedAudio;
                setTransportSec(savedAudio);
            }
        }
    }

    async function tryUnstickPlaybackAtTransport() {
        const cap =
            typeof getPlaybackCapSec === 'function' ? getPlaybackCapSec(videoMain) : 0;
        if (!cap) return false;
        const base = Math.max(0, Math.min(getTransportSec(), cap - 0.02));
        const nudges = [0, masterFrameSec, playbackKickSec(), 0.12, 0.25];
        const seen = new Set();
        for (const off of nudges) {
            const t = Math.max(0, Math.min(cap - 0.02, base + off));
            if (seen.has(t.toFixed(3))) continue;
            seen.add(t.toFixed(3));
            videoMain.pause();
            applyTimeToVideo(t);
            await waitForVideoSeekIdle(3000);
            try {
                await videoMain.play();
            } catch (_) {
                continue;
            }
            if (await waitUntilVideoTimeAdvances(1800)) {
                transportPlaybackSec = getTransportSec();
                transportPlaybackLastTs = performance.now();
                return true;
            }
            videoMain.pause();
        }
        return false;
    }

    function ensureVideoCanPlayForTransport(maxMs) {
        const limit = maxMs > 0 ? maxMs : 8000;
        if (videoMain.readyState >= 3) return Promise.resolve();
        return new Promise((resolve) => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                videoMain.removeEventListener('canplay', finish);
                videoMain.removeEventListener('loadeddata', finish);
                clearTimeout(timer);
                resolve();
            };
            const timer = setTimeout(finish, limit);
            if (videoMain.readyState >= 2) {
                finish();
                return;
            }
            videoMain.addEventListener('canplay', finish, { once: true });
            videoMain.addEventListener('loadeddata', finish, { once: true });
        });
    }

    async function waitUntilVideoPlaying(maxFrames) {
        const limit = maxFrames > 0 ? maxFrames : 90;
        for (let i = 0; i < limit; i++) {
            if (!videoMain.paused && !videoMain.seeking) return true;
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        return !videoMain.paused;
    }

    function waitUntilVideoTimeAdvances(timeoutMs) {
        const limit = timeoutMs > 0 ? timeoutMs : 2500;
        const t0 = videoMain.currentTime || 0;
        if (videoMain.paused) return Promise.resolve(false);
        return new Promise((resolve) => {
            let done = false;
            const finish = (ok) => {
                if (done) return;
                done = true;
                videoMain.removeEventListener('timeupdate', onTime);
                clearTimeout(timer);
                resolve(ok);
            };
            const onTime = () => {
                if ((videoMain.currentTime || 0) > t0 + 0.00001) finish(true);
            };
            const timer = setTimeout(() => finish(false), limit);
            videoMain.addEventListener('timeupdate', onTime);
            if ((videoMain.currentTime || 0) > t0 + 0.00001) finish(true);
        });
    }

    function releaseStuckEnded() {
        const t = getTransportSec();
        if (typeof applyVideoTimeForTransportSec === 'function') {
            applyVideoTimeForTransportSec(t, { force: true });
            return;
        }
        const d = getDuration(videoMain);
        if (d && videoMain.ended) {
            videoMain.currentTime = Math.max(0, Math.min(t, d - masterFrameSec));
        }
    }

    function waitForVideoSeekIdle(maxMs) {
        const limit = maxMs > 0 ? maxMs : 2500;
        return new Promise((resolve) => {
            if (!videoMain.seeking) {
                resolve();
                return;
            }
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                videoMain.removeEventListener('seeked', finish);
                clearTimeout(timer);
                resolve();
            };
            const timer = setTimeout(finish, limit);
            videoMain.addEventListener('seeked', finish, { once: true });
        });
    }

    /** 再生中・トランスポート時計稼働中か（明示シーク前の判定用） */
    function captureTransportWasActive() {
        if (
            typeof isTransportUiClockActive === 'function' &&
            isTransportUiClockActive()
        ) {
            return true;
        }
        if (typeof isTransportPlaying === 'function' && isTransportPlaying()) {
            return true;
        }
        return !!(videoMain && !videoMain.paused);
    }

    /** シーク・ジャンプ前に一度トランスポートを止める */
    function pauseTransportBeforeSeek() {
        const active = captureTransportWasActive();
        if (!active && !(videoMain && !videoMain.paused)) return false;
        if (typeof transportPlayGeneration !== 'undefined') {
            transportPlayGeneration += 1;
        }
        if (typeof transportPlayInFlight !== 'undefined') {
            transportPlayInFlight = null;
        }
        if (typeof clearTransportTailPlayback === 'function') {
            clearTransportTailPlayback();
        }
        if (videoMain) {
            try {
                videoMain.pause();
            } catch (_) {}
        }
        if (typeof stopAllExtraTrackSources === 'function') {
            stopAllExtraTrackSources();
        }
        if (typeof setPlayingUi === 'function') setPlayingUi(false);
        if (typeof stopRaf === 'function') stopRaf();
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport();
        }
        return active;
    }

    async function resumeTransportAfterExplicitSeek(sec) {
        const t =
            sec != null && typeof transportTargetSec === 'function'
                ? transportTargetSec(sec)
                : typeof getTransportSec === 'function'
                  ? getTransportSec()
                  : sec;
        if (
            typeof shouldStartMasterTransportTailPlayback === 'function' &&
            shouldStartMasterTransportTailPlayback(t) &&
            typeof startMasterTransportTailPlayback === 'function'
        ) {
            await startMasterTransportTailPlayback();
            return;
        }
        if (typeof startVideoPlayback === 'function') {
            await startVideoPlayback({ force: true });
        }
    }

    async function seekTransportToAndWait(sec, opt) {
        const wantResume = !(opt && opt.resumeAfter === false);
        const wasActive = wantResume ? captureTransportWasActive() : false;
        if (wasActive || (videoMain && !videoMain.paused)) {
            pauseTransportBeforeSeek();
        }
        applyTimeToVideo(sec);
        if (typeof videoReady === 'function' && videoReady()) {
            await waitForVideoSeekIdle(3000);
        }
        updateSeekUiFromVideo();
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (wasActive && wantResume) {
            await resumeTransportAfterExplicitSeek(sec);
        }
    }

    function isAudioOnlyTransportPlayback() {
        const hasVideo = typeof videoReady === 'function' && videoReady();
        if (hasVideo) return false;
        return (
            typeof hasPlayableWaveformTimeline === 'function' &&
            hasPlayableWaveformTimeline()
        );
    }

    async function runTransportPlay(playGen) {
        if (isAudioOnlyTransportPlayback()) {
            if (typeof primeReviewMixForPlayback === 'function') {
                await primeReviewMixForPlayback();
            } else if (typeof primeExtraAudioForPlayback === 'function') {
                await primeExtraAudioForPlayback();
            }
            return startMasterTransportTailPlayback(playGen);
        }
        await ensureVideoCanPlayForTransport();
        if (playGen != null && playGen !== transportPlayGeneration) return false;
        await prepareVideoForPlayback();
        if (playGen != null && playGen !== transportPlayGeneration) return false;
        if (
            typeof shouldStartMasterTransportTailPlayback === 'function' &&
            shouldStartMasterTransportTailPlayback(getTransportSec())
        ) {
            return startMasterTransportTailPlayback(playGen);
        }
        if (typeof primeReviewMixForPlayback === 'function') {
            await primeReviewMixForPlayback();
        } else if (typeof primeExtraAudioForPlayback === 'function') {
            await primeExtraAudioForPlayback();
        }
        const startT = getTransportSec();
        rememberTransportPlaybackStartSec(startT);
        transportPlaybackSec = startT;
        transportPlaybackLastTs = performance.now();
        setTransportSec(startT);
        if (typeof applyVideoTimeForTransportSec === 'function') {
            applyVideoTimeForTransportSec(startT, { force: true });
        }
        setPlayingUi(true);
        if (!rafId) rafId = requestAnimationFrame(tick);
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        const playPromise = videoMain.play();
        if (playPromise && typeof playPromise.then === 'function') {
            await playPromise;
        }
        if (playGen != null && playGen !== transportPlayGeneration) return false;
        if (videoMain.paused) {
            throw new Error('video remains paused after play()');
        }
        if (!(await waitUntilVideoPlaying(60))) {
            throw new Error('video stuck while starting playback');
        }
        if (!(await waitUntilVideoTimeAdvances(2500))) {
            const vd =
                typeof getVideoPlaybackEndSec === 'function'
                    ? getVideoPlaybackEndSec()
                    : typeof getVideoTransportDurationSec === 'function'
                      ? getVideoTransportDurationSec()
                      : getDuration(videoMain);
            const master =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : vd;
            const tNow =
                typeof getTransportSec === 'function' ? getTransportSec() : videoMain.currentTime || 0;
            const tailEps =
                typeof masterTransportTailEpsilonSec === 'function'
                    ? masterTransportTailEpsilonSec()
                    : 0.02;
            if (master > vd + tailEps && tNow >= vd - tailEps * 2) {
                transportPlaybackSec = tNow;
                transportPlaybackLastTs = performance.now();
                pendingRestoreTime = null;
                setPlayingUi(true);
                if (!rafId) rafId = requestAnimationFrame(tick);
                if (typeof syncExtraAudioToTransport === 'function') {
                    syncExtraAudioToTransport({ force: true });
                }
                writeLog('Transport: extra-only tail (video at end)');
                return true;
            }
            logVideoTransportState('Transport: no time advance after play');
            if (await tryUnstickPlaybackAtTransport()) {
                pendingRestoreTime = null;
                setPlayingUi(true);
                if (!rafId) rafId = requestAnimationFrame(tick);
                if (typeof scheduleAudioWaveformBuildAfterPlayback === 'function') {
                    scheduleAudioWaveformBuildAfterPlayback();
                }
                writeLog('Transport: playback recovered after transport nudge');
                return true;
            }
            throw new Error('playback time did not advance');
        }
        pendingRestoreTime = null;
        transportPlaybackSec =
            typeof getTransportSec === 'function' ? getTransportSec() : videoMain.currentTime || 0;
        transportPlaybackLastTs = performance.now();
        setPlayingUi(true);
        if (!rafId) rafId = requestAnimationFrame(tick);
        if (typeof scheduleAudioWaveformBuildAfterPlayback === 'function') {
            scheduleAudioWaveformBuildAfterPlayback();
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport();
        }
        return true;
    }

    async function startVideoPlayback(opt) {
        if (!videoReady() && !isAudioOnlyTransportPlayback()) return false;
        const force = !!(opt && opt.force);
        const playGen =
            opt && opt.playGen != null ? opt.playGen : (transportPlayGeneration += 1);
        if (force) transportPlayInFlight = null;
        if (transportPlayInFlight && !force) return transportPlayInFlight;

        transportPlayInFlight = (async () => {
            try {
                await runTransportPlay(playGen);
                return true;
            } catch (err) {
                if (playGen !== transportPlayGeneration) return false;
                if (typeof isPlayInterruptedError === 'function' && isPlayInterruptedError(err)) {
                    return false;
                }
                logVideoTransportState('Transport: play failed');
                writeLog(
                    'Transport: play failed — ' + (err && err.message ? err.message : String(err))
                );
                videoMain.pause();
                setPlayingUi(false);
                stopRaf();
                return false;
            } finally {
                transportPlayInFlight = null;
            }
        })();

        return transportPlayInFlight;
    }

    /** キーボードのジャンプ後に必ず再生する（Play ボタンのトグルは使わない） */
    async function playTransportAfterKeyboardSeek() {
        const ready =
            typeof transportControlsReady === 'function'
                ? transportControlsReady()
                : typeof videoReady === 'function' && videoReady();
        if (!ready) return false;
        if (typeof requestScrollToPlayerStageOnNextPlay === 'function') {
            requestScrollToPlayerStageOnNextPlay();
        }
        if (typeof endAudioWaveformScrub === 'function') {
            endAudioWaveformScrub({ force: true });
        }
        isSeeking = false;
        const mixCtx =
            typeof ensureReviewMixCtx === 'function' ? ensureReviewMixCtx() : null;
        if (mixCtx && mixCtx.state === 'suspended') {
            try {
                await mixCtx.resume();
            } catch (_) {}
        }
        if (typeof applyReviewMixVideoGain === 'function') {
            applyReviewMixVideoGain();
        }
        if (typeof startVideoPlayback === 'function') {
            return startVideoPlayback({ force: true });
        }
        return false;
    }

    async function resumeTransportPlaybackAfterSeek() {
        return startVideoPlayback({ force: true });
    }

    function updateSeekUiFromVideo() {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : getDuration(videoMain);
        const transportPlayingUi =
            typeof isTransportUiClockActive === 'function'
                ? isTransportUiClockActive()
                : typeof isTransportPlaying === 'function' && isTransportPlaying();
        if (
            !isSeeking &&
            !transportPlayingUi &&
            pendingRestoreTime != null &&
            Number.isFinite(pendingRestoreTime) &&
            typeof videoReady === 'function' &&
            videoReady() &&
            videoMain.paused
        ) {
            const t = Math.max(0, Math.min(pendingRestoreTime, master - 0.001));
            setTransportSec(t);
            currentTimeEl.textContent = formatTimecodeForTransport(t);
            updateTimecodeOverlay();
            return;
        }
        const scrubUi =
            typeof isAudioWaveformScrubActive === 'function' && isAudioWaveformScrubActive();
        if (!isSeeking || scrubUi) {
            let t;
            if (scrubUi && seekBar) {
                const fromBar = parseFloat(seekBar.value);
                t = Number.isFinite(fromBar) ? fromBar : transportPlaybackSec;
            } else {
                const transportActive =
                    typeof isTransportUiClockActive === 'function'
                        ? isTransportUiClockActive()
                        : typeof isTransportPlaying === 'function'
                          ? isTransportPlaying()
                          : !videoMain.paused;
                if (transportActive) {
                    if (typeof syncTransportPlaybackClockFromAudio === 'function') {
                        syncTransportPlaybackClockFromAudio();
                    } else if (typeof syncTransportPlaybackClockFromVideo === 'function') {
                        syncTransportPlaybackClockFromVideo();
                    }
                    t = transportPlaybackSec;
                } else {
                    t = getTransportSec();
                }
            }
            const clamped = Math.max(0, Math.min(t, master));
            setTransportSec(clamped);
            /* マスター上の時刻（動画終端以降のトランスポート区間も表示）。焼き込み TC は別仕様。 */
            currentTimeEl.textContent = formatTimecodeForTransport(clamped);
        }
        updateTimecodeOverlay();
        if (typeof updateMarkerCommentOverlay === 'function') updateMarkerCommentOverlay();
        if (
            typeof markersNeedTimelineRefreshOnTransport === 'function' &&
            markersNeedTimelineRefreshOnTransport() &&
            typeof renderAudioWaveformMarkers === 'function'
        ) {
            renderAudioWaveformMarkers();
        }
        if (typeof updateAllWaveformPlayheads === 'function') updateAllWaveformPlayheads();
    }

    function primePendingRestoreTransportUi() {
        if (pendingRestoreTime == null || !Number.isFinite(pendingRestoreTime)) return;
        const t = Math.max(0, pendingRestoreTime);
        setTransportSec(t);
        currentTimeEl.textContent = formatTimecodeForTransport(t);
    }

    function applyPendingTransportRestore() {
        if (pendingRestoreTime == null || !Number.isFinite(pendingRestoreTime)) return false;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : getDuration(videoMain);
        if (!videoReady()) {
            if (
                !(typeof hasPlayableWaveformTimeline === 'function' &&
                    hasPlayableWaveformTimeline()) ||
                !(master > 0)
            ) {
                return false;
            }
            const t = Math.max(0, Math.min(pendingRestoreTime, master - 0.001));
            if (typeof applyTransportAtSec === 'function') {
                applyTransportAtSec(t, { markers: true });
            } else {
                setTransportSec(t);
            }
            if (typeof syncExtraAudioToTransport === 'function') {
                syncExtraAudioToTransport({ force: true });
            }
            currentTimeEl.textContent = formatTimecodeForTransport(t);
            updateTimecodeOverlay();
            pendingRestoreTime = null;
            return true;
        }
        if (videoMain.readyState < 2) return false;
        const t = Math.max(0, Math.min(pendingRestoreTime, master - 0.001));
        applyTimeToVideoIfNeeded(t);
        currentTimeEl.textContent = formatTimecodeForTransport(t);
        updateTimecodeOverlay();
        const expected =
            typeof videoSecForTransportSec === 'function' ? videoSecForTransportSec(t) : t;
        const drift = Math.abs((videoMain.currentTime || 0) - expected);
        if (t > 0.02 && drift > 0.2) return false;
        pendingRestoreTime = null;
        return true;
    }

    function stopRaf() {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
        }
    }

    function forceTransportRafLoop() {
        stopRaf();
        rafId = requestAnimationFrame(tick);
    }

    function tick() {
        const transportActive =
            typeof isTransportUiClockActive === 'function'
                ? isTransportUiClockActive()
                : typeof isTransportPlaying === 'function'
                  ? isTransportPlaying()
                  : !videoMain.paused;
        const scrubbing =
            typeof isAudioWaveformScrubActive === 'function' && isAudioWaveformScrubActive();
        if (transportActive && !scrubbing && !isSeeking) {
            if (typeof syncTransportPlaybackClockFromAudio === 'function') {
                syncTransportPlaybackClockFromAudio();
            } else if (typeof syncTransportPlaybackClockFromVideo === 'function') {
                syncTransportPlaybackClockFromVideo();
            }
            const t = transportPlaybackSec;
            setTransportSec(t);
            if (typeof refreshVideoPastEndBlackoutUi === 'function') {
                refreshVideoPastEndBlackoutUi();
            }
            const inTailPark =
                typeof isVideoParkedForTransportTail === 'function' &&
                isVideoParkedForTransportTail();
            const vdEnd =
                typeof getVideoPlaybackEndSec === 'function'
                    ? getVideoPlaybackEndSec()
                    : typeof getVideoTransportDurationSec === 'function'
                      ? getVideoTransportDurationSec()
                      : getDuration(videoMain);
            const pastVideoEnd = vdEnd > 0 && t >= vdEnd - 0.02;
            const rangeLoopBlocksVideo =
                typeof shouldApplyVideoTimeDuringRangeLoopTick === 'function' &&
                !shouldApplyVideoTimeDuringRangeLoopTick(t);
            const videoRolling = !videoMain.paused && !videoMain.ended && !videoMain.seeking;
            const mayApplyVideo =
                typeof applyVideoTimeForTransportSec === 'function' &&
                (inTailPark ||
                    pastVideoEnd ||
                    !videoRolling ||
                    !rangeLoopBlocksVideo);
            if (mayApplyVideo) {
                applyVideoTimeForTransportSec(t);
            } else if (
                videoRolling &&
                typeof sampleVideoDriftForPlayback === 'function' &&
                typeof refreshVideoDriftMonitorFromSample === 'function'
            ) {
                const signed = sampleVideoDriftForPlayback(t);
                if (signed != null) refreshVideoDriftMonitorFromSample(t, signed);
            }
        }
        updateSeekUiFromVideo();
        const anySeeking = videoMain.seeking;
        if (transportActive || anySeeking) {
            rafId = requestAnimationFrame(tick);
        } else {
            rafId = 0;
        }
    }

    function onVideoTimeUpdate() {
        if (videoMain.paused || isSeeking) return;
        if (pendingRestoreTime != null) pendingRestoreTime = null;
        if (typeof snapRangeLoopPlaybackIfNeeded === 'function') {
            snapRangeLoopPlaybackIfNeeded();
        }
        updateSeekUiFromVideo();
    }

    function setPlayingUi(playing) {
        const wasPlaying =
            typeof isTransportPlaying === 'function' && isTransportPlaying();
        if (typeof setTransportSessionPlaying === 'function') {
            setTransportSessionPlaying(playing);
        }
        if (typeof setReviewMixMonitorTransportActive === 'function') {
            setReviewMixMonitorTransportActive(playing);
        }
        if (playing && !wasPlaying) {
            if (typeof clearSeekPlaybackTrail === 'function') clearSeekPlaybackTrail();
            if (typeof scrollToPlayerStageOnPlaybackStart === 'function') {
                scrollToPlayerStageOnPlaybackStart();
            }
        }
        if (!playing) {
            if (typeof clearSeekPlaybackTrail === 'function') clearSeekPlaybackTrail();
            if (typeof resetVideoDriftMonitorSchedule === 'function') {
                resetVideoDriftMonitorSchedule();
            }
        }
        if (audioWaveformComposite) {
            audioWaveformComposite.classList.toggle(
                'audio-waveform-composite--playing',
                !!playing,
            );
        }
        if (playing) {
            playStopBtn.textContent = 'Pause';
            playStopBtn.classList.add('transport-toggle--stop');
        } else {
            playStopBtn.textContent = 'Play';
            playStopBtn.classList.remove('transport-toggle--stop');
        }
    }

    function beginExtraTransportTailIfNeeded() {
        if (
            typeof hasMasterTransportTailBeyondVideo !== 'function' ||
            !hasMasterTransportTailBeyondVideo()
        ) {
            return false;
        }
        if (typeof enterPostVideoTransportTail === 'function') {
            return enterPostVideoTransportTail();
        }
        return false;
    }

    let handlingMasterTransportEnd = false;

    function stopPlaybackReturnTransportToHead() {
        isSeeking = false;
        clearTransportPlaybackStartSec();
        if (typeof resetTransportPlaybackClock === 'function') {
            resetTransportPlaybackClock();
        } else {
            transportPlaybackSec = 0;
            transportPlaybackLastTs = 0;
        }
        if (typeof clearTransportTailPlayback === 'function') clearTransportTailPlayback();
        if (typeof clearVideoParkedForTail === 'function') clearVideoParkedForTail();
        if (typeof clearSeekPlaybackTrail === 'function') clearSeekPlaybackTrail();
        setPlayingUi(false);
        stopRaf();
        if (videoMain) videoMain.pause();
        if (typeof stopAllExtraTrackSources === 'function') stopAllExtraTrackSources();
        if (typeof applyTransportAtSec === 'function') {
            applyTransportAtSec(0, { markers: true, resumeAfter: false });
        } else {
            applyTimeToVideo(0);
        }
        setTransportSec(0);
        updateSeekUiFromVideo();
        if (typeof updateAllWaveformPlayheads === 'function') updateAllWaveformPlayheads();
        schedulePersistSession();
    }

    window.stopPlaybackReturnTransportToHead = stopPlaybackReturnTransportToHead;
    window.pauseTransportBeforeSeek = pauseTransportBeforeSeek;

    async function handleMasterTransportEndReached() {
        if (typeof isWebmExportActive === 'function' && isWebmExportActive()) {
            return false;
        }
        if (handlingMasterTransportEnd) return false;
        const clockActive =
            typeof isTransportUiClockActive === 'function'
                ? isTransportUiClockActive()
                : typeof isTransportPlaying === 'function' && isTransportPlaying();
        const atMaster =
            typeof isAtMasterTransportEnd === 'function' && isAtMasterTransportEnd();
        if (!clockActive && !atMaster) {
            return false;
        }
        handlingMasterTransportEnd = true;
        try {
            const master =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : getDuration(videoMain);
            if (
                typeof isRangeLoopPlaybackActive === 'function' &&
                isRangeLoopPlaybackActive()
            ) {
                const inSec =
                    typeof getRangeLoopInSec === 'function' ? getRangeLoopInSec() : 0;
                writeLog(
                    'Playback: range loop restart @ ' + formatTimecodeForTransport(inSec),
                );
                if (typeof clearVideoParkedForTail === 'function') clearVideoParkedForTail();
                if (typeof clearSeekPlaybackTrail === 'function') clearSeekPlaybackTrail();
                if (typeof jumpToRangeLoopInSec === 'function') {
                    await jumpToRangeLoopInSec({ resumeAfter: true });
                } else if (typeof seekTransportToAndWait === 'function') {
                    await seekTransportToAndWait(inSec, { resumeAfter: true });
                } else if (typeof applyTransportAtSec === 'function') {
                    applyTransportAtSec(inSec, { markers: true, resumeAfter: true });
                } else {
                    applyTimeToVideo(inSec);
                    if (typeof startVideoPlayback === 'function') {
                        await startVideoPlayback({ force: true });
                    }
                }
                schedulePersistSession();
                return true;
            }
            if (typeof getLoopPlaybackEnabled === 'function' && getLoopPlaybackEnabled()) {
                writeLog('Playback: loop restart (head)');
                if (typeof resetTransportPlaybackClock === 'function') {
                    resetTransportPlaybackClock();
                }
                if (typeof clearVideoParkedForTail === 'function') clearVideoParkedForTail();
                if (typeof clearSeekPlaybackTrail === 'function') clearSeekPlaybackTrail();
                if (typeof seekTransportToAndWait === 'function') {
                    await seekTransportToAndWait(0, { resumeAfter: true });
                } else {
                    applyTimeToVideo(0);
                    setPlayingUi(true);
                    if (typeof startVideoPlayback === 'function') {
                        await startVideoPlayback({ force: true });
                    }
                }
                schedulePersistSession();
                return true;
            }
            stopPlaybackReturnTransportToHead();
            writeLog('Playback: end reached (returned to head)');
            return true;
        } finally {
            handlingMasterTransportEnd = false;
        }
    }

    function updateControlsEnabled() {
        const locked =
            (typeof isVideoLoadLockActive === 'function' && isVideoLoadLockActive()) ||
            (typeof isWebmExportActive === 'function' && isWebmExportActive());
        const ready =
            !locked &&
            (typeof transportControlsReady === 'function'
                ? transportControlsReady()
                : videoReady());
        if (seekBar) seekBar.disabled = !ready;
        playStopBtn.disabled = !ready;
        if (!ready) {
            const exportPlaybackActive =
                typeof isWebmExportActive === 'function' &&
                isWebmExportActive() &&
                typeof isTransportPlaying === 'function' &&
                isTransportPlaying();
            if (!exportPlaybackActive) {
                setPlayingUi(false);
                stopRaf();
            }
        } else {
            updateTimecodeOverlay();
            if (
                typeof videoReady === 'function' &&
                !videoReady() &&
                typeof syncAudioOnlyMarkersUi === 'function'
            ) {
                syncAudioOnlyMarkersUi();
            } else if (typeof refreshMarkerUi === 'function') {
                refreshMarkerUi();
            }
            if (typeof refreshReviewMixUi === 'function') refreshReviewMixUi();
        }
        if (typeof updateVideoClearButton === 'function') updateVideoClearButton();
        if (typeof updateSessionAllClearButton === 'function') updateSessionAllClearButton();
    }

    window.updateControlsEnabled = updateControlsEnabled;

    function loadVideoFile(f, opt) {
        if (typeof prepareReviewMixForNewVideoLoad === 'function') {
            prepareReviewMixForNewVideoLoad();
        }
        if (typeof clearRegionUndoStack === 'function') {
            clearRegionUndoStack();
        }
        if (typeof prepareMarkersForVideoSwitch === 'function') {
            prepareMarkersForVideoSwitch();
        } else if (typeof saveMarkersToCache === 'function') {
            saveMarkersToCache();
        }
        if (typeof replaceVideoMediaForLoad === 'function') {
            replaceVideoMediaForLoad();
        } else {
            revokeAll();
        }
        firstFramePrimedForUrl = '';
        if (opt && opt.rangeLoop && typeof setPendingRangeLoopRestore === 'function') {
            setPendingRangeLoopRestore(opt.rangeLoop);
        }
        if (opt && opt.playbackRegion && typeof setPendingPlaybackRegionRestore === 'function') {
            setPendingPlaybackRegionRestore(opt.playbackRegion);
        }
        fileMain = f;
        urlMain = URL.createObjectURL(f);
        if (typeof beginVideoLoadLock === 'function') {
            beginVideoLoadLock(f && f.name ? f.name : '');
        }
        videoMain.src = urlMain;
        videoMain.load();
        if (typeof resetTransportPlaybackClock === 'function') {
            resetTransportPlaybackClock();
        } else {
            transportPlaybackSec = 0;
            transportPlaybackLastTs = 0;
        }
        clearTransportPlaybackStartSec();
        if (typeof setTransportSec === 'function') {
            setTransportSec(0);
        }
        nameMain.textContent = f.name;
        updatePanelInfoLine();
        setLoaded(panelMain, true);
        if (
            typeof pendingLaneUiRestore !== 'undefined' &&
            pendingLaneUiRestore &&
            typeof applySavedWaveformLaneUi === 'function'
        ) {
            applySavedWaveformLaneUi(pendingLaneUiRestore);
            pendingLaneUiRestore = null;
        } else if (typeof restoreExtraTrackLanesForNewVideo === 'function') {
            restoreExtraTrackLanesForNewVideo();
        } else if (typeof restoreVideoAudioLaneForNewVideo === 'function') {
            restoreVideoAudioLaneForNewVideo();
        }
        if (typeof resetAudioWaveformForNewVideo === 'function') {
            resetAudioWaveformForNewVideo({ skipScheduleBuild: true });
        }
        void refreshContainerFpsForCurrentFiles()
            .then(() => {
                if (typeof notifyVideoAudioLoadSettledIfNoVideoAudio === 'function') {
                    notifyVideoAudioLoadSettledIfNoVideoAudio();
                }
                if (typeof notifyVideoLoadLockVideoReady === 'function') {
                    notifyVideoLoadLockVideoReady();
                }
                if (typeof tryWireReviewMixVideoAudioWhenReady === 'function') {
                    tryWireReviewMixVideoAudioWhenReady();
                }
                if (typeof kickMainVideoWaveformBuild === 'function') {
                    kickMainVideoWaveformBuild({ allowSettle: true });
                } else if (typeof ensureMainVideoWaveformBuildForLoad === 'function') {
                    ensureMainVideoWaveformBuildForLoad();
                }
                if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
                    ensureAtLeastOneWaveformLaneVisible();
                }
                if (typeof refreshVideoAudioLaneVisibility === 'function') {
                    refreshVideoAudioLaneVisibility();
                }
            })
            .catch(() => {
                if (typeof notifyVideoLoadLockVideoReady === 'function') {
                    notifyVideoLoadLockVideoReady();
                }
                if (typeof tryWireReviewMixVideoAudioWhenReady === 'function') {
                    tryWireReviewMixVideoAudioWhenReady();
                }
                if (typeof kickMainVideoWaveformBuild === 'function') {
                    kickMainVideoWaveformBuild({ allowSettle: true });
                }
            });
        loadMarkersForCurrentVideo(opt && opt.markers);
        if (typeof loadMarkerMemoForCurrentVideo === 'function') {
            loadMarkerMemoForCurrentVideo(
                opt && typeof opt.markerMemo === 'string' ? opt.markerMemo : undefined,
            );
        }
        if (!opt || !opt.skipPersist) {
            schedulePersistSession();
        }
        if (typeof refreshExportMediaOptionsUi === 'function') {
            refreshExportMediaOptionsUi();
        }
        if (typeof updateVideoClearButton === 'function') updateVideoClearButton();
        if (typeof updateSessionAllClearButton === 'function') updateSessionAllClearButton();
    }
