    function scheduleSessionTransportRestoreRetry() {
        if (sessionRestoreListenersArmed) return;
        sessionRestoreListenersArmed = true;
        let tries = 0;
        const tick = () => {
            if (!videoReady()) return;
            if (pendingRestoreTime == null) {
                sessionRestoreListenersArmed = false;
                return;
            }
            primePendingRestoreTransportUi();
            if (!applyPendingTransportRestore()) {
                if (tries++ < 24) requestAnimationFrame(tick);
                return;
            }
            writeLog(
                'Restored transport to ' + formatTimecodeForTransport(parseFloat(seekBar.value) || 0)
            );
            sessionRestoreListenersArmed = false;
        };
        tick();
        videoMain.addEventListener('canplay', tick, { once: true });
    }

    function onVideoMediaReady() {
        if (!videoReady()) return;
        if (pendingRestoreTime != null) {
            primePendingRestoreTransportUi();
            if (applyPendingTransportRestore()) {
                writeLog(
                    'Restored transport to ' + formatTimecodeForTransport(parseFloat(seekBar.value) || 0)
                );
            } else {
                scheduleSessionTransportRestoreRetry();
            }
            return;
        }
        if (typeof applyVideoMixFromSessionRestoreIfPending === 'function') {
            applyVideoMixFromSessionRestoreIfPending();
        }
    }

    function onMeta() {
        inferContainerFpsForSide('main');
        reconcileContainerSampleCountForSide('main');
        updatePanelInfoLine();
        if (typeof ensureReviewMixVideoRouting === 'function') {
            ensureReviewMixVideoRouting();
        }
        if (typeof applyReviewMixVideoGain === 'function') {
            applyReviewMixVideoGain();
        }
        syncSeekMax();
        updateControlsEnabled();
        if (typeof applyPendingRangeLoopRestore === 'function') {
            applyPendingRangeLoopRestore();
        }
        if (typeof showFirstVideoFrame === 'function') {
            showFirstVideoFrame();
        }
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        if (
            typeof isExtraTrackLoaded === 'function' &&
            (isExtraTrackLoaded(0) || isExtraTrackLoaded(1)) &&
            typeof ensureExtraTrackWaveformsDrawn === 'function'
        ) {
            ensureExtraTrackWaveformsDrawn({ notifyMaster: true });
        }
        onVideoMediaReady();
    }

    videoMain.addEventListener('loadedmetadata', onMeta);
    videoMain.addEventListener('loadeddata', onMeta);
    videoMain.addEventListener('durationchange', onMeta);

    let durationProgressRaf = 0;
    function onDurationMaybeProgress() {
        if (durationProgressRaf) return;
        durationProgressRaf = requestAnimationFrame(() => {
            durationProgressRaf = 0;
            syncSeekMax();
            updateControlsEnabled();
            updatePanelInfoLine();
            updateTimecodeOverlay();
        });
    }
    videoMain.addEventListener('progress', onDurationMaybeProgress);

    if (loopPlaybackCheckbox) {
        loopPlaybackCheckbox.addEventListener('change', () => {
            logAndPersistLoopPlayback();
        });
    }

    playStopBtn.addEventListener('click', async () => {
        const ready =
            typeof transportControlsReady === 'function'
                ? transportControlsReady()
                : videoReady();
        if (!ready) return;
        const playing =
            typeof isTransportPlaying === 'function'
                ? isTransportPlaying()
                : !videoMain.paused;
        if (playing) {
            transportPlayGeneration += 1;
            transportPlayInFlight = null;
            writeLog('Transport: pause (button)');
            if (typeof clearTransportTailPlayback === 'function') clearTransportTailPlayback();
            videoMain.pause();
            setPlayingUi(false);
            stopRaf();
            updateSeekUiFromVideo();
            if (typeof syncExtraAudioToTransport === 'function') {
                syncExtraAudioToTransport();
            }
            schedulePersistSession();
            return;
        }
        if (typeof endAudioWaveformScrub === 'function') {
            endAudioWaveformScrub({ force: true });
        }
        isSeeking = false;
        writeLog('Transport: play (button)');
        transportPlayInFlight = null;
        const playGen = ++transportPlayGeneration;
        try {
            if (typeof runTransportPlay === 'function') {
                await runTransportPlay(playGen);
            } else if (typeof startVideoPlayback === 'function') {
                await startVideoPlayback({ force: true, playGen });
            }
        } catch (err) {
            if (playGen !== transportPlayGeneration) return;
            if (typeof isPlayInterruptedError === 'function' && isPlayInterruptedError(err)) {
                return;
            }
            if (typeof logVideoTransportState === 'function') {
                logVideoTransportState('Transport: play failed');
            }
            writeLog(
                'Transport: play failed — ' + (err && err.message ? err.message : String(err))
            );
            videoMain.pause();
            setPlayingUi(false);
            stopRaf();
        }
    });

    videoMain.addEventListener('pause', () => {
        if (
            typeof isWaveformScrubSuppressPause === 'function' &&
            isWaveformScrubSuppressPause()
        ) {
            return;
        }
        if (
            (typeof shouldHoldTransportPastVideoPause === 'function' &&
                shouldHoldTransportPastVideoPause()) ||
            (typeof shouldKeepPlayingPastVideoEnd === 'function' &&
                shouldKeepPlayingPastVideoEnd())
        ) {
            pendingRestoreTime = null;
            if (typeof parkVideoAtTransportTail === 'function') parkVideoAtTransportTail();
            if (typeof forceTransportRafLoop === 'function') forceTransportRafLoop();
            else if (!rafId && typeof tick === 'function') rafId = requestAnimationFrame(tick);
            if (typeof updateSeekUiFromVideo === 'function') updateSeekUiFromVideo();
            return;
        }
        if (typeof clearTransportTailPlayback === 'function') clearTransportTailPlayback();
        stopRaf();
        if (videoMain.paused) setPlayingUi(false);
        updateControlsEnabled();
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport();
        }
        if (typeof tryScheduleWaveformBuildIfNeeded === 'function') {
            tryScheduleWaveformBuildIfNeeded(600);
        }
    });
    videoMain.addEventListener('play', () => {
        setPlayingUi(true);
        updateControlsEnabled();
        if (!rafId && !videoMain.paused) rafId = requestAnimationFrame(tick);
        if (typeof tryScheduleWaveformBuildIfNeeded === 'function') {
            setTimeout(() => tryScheduleWaveformBuildIfNeeded(1500), 400);
        }
    });
    videoMain.addEventListener('timeupdate', () => {
        if (typeof onVideoTimeUpdate === 'function') onVideoTimeUpdate();
    });
    videoMain.addEventListener('waiting', () => {
        writeLog('Video: waiting for data (t=' + (videoMain.currentTime || 0).toFixed(2) + ')');
    });
    videoMain.addEventListener('stalled', () => {
        writeLog('Video: stalled (t=' + (videoMain.currentTime || 0).toFixed(2) + ')');
    });

    function onVideoEnded() {
        if (
            typeof beginExtraTransportTailIfNeeded === 'function' &&
            beginExtraTransportTailIfNeeded()
        ) {
            return;
        }
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : getDuration(videoMain);
        const t =
            typeof getTransportSec === 'function' ? getTransportSec() : videoMain.currentTime || 0;
        if (t < master - 0.05) {
            return;
        }
        if (typeof handleMasterTransportEndReached === 'function') {
            void handleMasterTransportEndReached();
            return;
        }
        videoMain.pause();
        if (typeof stopAllExtraTrackSources === 'function') stopAllExtraTrackSources();
        stopRaf();
        setPlayingUi(false);
        updateSeekUiFromVideo();
        writeLog('Playback: end reached (transport stopped)');
    }
    videoMain.addEventListener('ended', onVideoEnded);

    const MIX_VOL_REPEAT_INITIAL_MS = 400;
    const MIX_VOL_REPEAT_MS = 50;
    const mixVolActiveKeys = new Map();
    let mixVolRepeatTimer = null;

    function mixVolHasActiveRepeat() {
        for (const hold of mixVolActiveKeys.values()) {
            if (!hold.unityPaused) return true;
        }
        return false;
    }

    function mixVolRepeatTick() {
        mixVolRepeatTimer = null;
        if (mixVolActiveKeys.size === 0) return;
        if (typeof adjustMixLaneVolumeByDisplayIndex !== 'function') return;
        for (const hold of mixVolActiveKeys.values()) {
            if (hold.unityPaused) continue;
            const stopped = adjustMixLaneVolumeByDisplayIndex(
                hold.displayIndex,
                hold.deltaDb,
            );
            if (stopped) hold.unityPaused = true;
        }
        if (mixVolHasActiveRepeat()) {
            mixVolRepeatTimer = setTimeout(mixVolRepeatTick, MIX_VOL_REPEAT_MS);
        }
    }

    function scheduleMixVolRepeat() {
        if (mixVolRepeatTimer != null) return;
        mixVolRepeatTimer = setTimeout(mixVolRepeatTick, MIX_VOL_REPEAT_INITIAL_MS);
    }

    function stopMixVolRepeat() {
        if (mixVolRepeatTimer != null) {
            clearTimeout(mixVolRepeatTimer);
            mixVolRepeatTimer = null;
        }
    }

    function handleMixVolKeydown(e, displayIndex, deltaDb) {
        if (e.repeat) return;
        e.preventDefault();
        if (mixVolActiveKeys.has(e.code)) return;
        mixVolActiveKeys.set(e.code, {
            displayIndex,
            deltaDb,
            unityPaused: false,
        });
        if (typeof adjustMixLaneVolumeByDisplayIndex === 'function') {
            const stopped = adjustMixLaneVolumeByDisplayIndex(displayIndex, deltaDb);
            if (stopped) mixVolActiveKeys.get(e.code).unityPaused = true;
        }
        if (!mixVolActiveKeys.get(e.code).unityPaused) {
            scheduleMixVolRepeat();
        }
    }

    function handleMixVolKeyup(e) {
        if (!mixVolActiveKeys.has(e.code)) return;
        mixVolActiveKeys.delete(e.code);
        if (mixVolActiveKeys.size === 0) stopMixVolRepeat();
    }

    function clearMixVolActiveKeys() {
        mixVolActiveKeys.clear();
        stopMixVolRepeat();
    }

    window.addEventListener('keydown', (e) => {
        if (typeof handleMarkerEscapeKeydown === 'function' && handleMarkerEscapeKeydown(e)) {
            return;
        }

        if (typeof handleRangeLoopEscapeKeydown === 'function' && handleRangeLoopEscapeKeydown(e)) {
            return;
        }

        if (typeof handleMarkerBracketKeydown === 'function' && handleMarkerBracketKeydown(e)) {
            return;
        }

        if (isTypingTarget(e.target)) return;

        if (typeof handleWaveformTimelineKeydown === 'function' && handleWaveformTimelineKeydown(e)) {
            return;
        }

        if (typeof isAudioWaveformScrubActive === 'function' && isAudioWaveformScrubActive()) {
            const appKey =
                e.code === 'Space' ||
                e.code === 'ArrowLeft' ||
                e.code === 'ArrowRight' ||
                /^Numpad[0-9]$/.test(e.code) ||
                e.code === 'KeyL' ||
                e.code === 'KeyA' ||
                e.code === 'KeyM' ||
                e.code === 'Digit1' ||
                e.code === 'Digit2' ||
                e.code === 'Digit3' ||
                e.code === 'KeyQ' ||
                e.code === 'KeyW' ||
                e.code === 'KeyE' ||
                e.code === 'KeyS' ||
                e.code === 'KeyD' ||
                e.code === 'KeyZ' ||
                e.code === 'KeyX' ||
                e.code === 'KeyC' ||
                e.code === 'KeyR' ||
                e.code === 'Equal' ||
                e.code === 'Minus' ||
                e.code === 'NumpadAdd' ||
                e.code === 'NumpadSubtract' ||
                e.code === 'PageUp' ||
                e.code === 'PageDown';
            if (appKey && typeof endAudioWaveformScrub === 'function') endAudioWaveformScrub();
        }
        const waveFocus = audioWaveformLanesTracks || audioWaveformTrack;
        if (waveFocus && document.activeElement === waveFocus) {
            const appKey =
                e.code === 'Space' ||
                e.code === 'ArrowLeft' ||
                e.code === 'ArrowRight' ||
                /^Numpad[0-9]$/.test(e.code) ||
                e.code === 'KeyL' ||
                e.code === 'KeyA' ||
                e.code === 'KeyM' ||
                e.code === 'Digit1' ||
                e.code === 'Digit2' ||
                e.code === 'Digit3' ||
                e.code === 'KeyQ' ||
                e.code === 'KeyW' ||
                e.code === 'KeyE' ||
                e.code === 'KeyS' ||
                e.code === 'KeyD' ||
                e.code === 'KeyZ' ||
                e.code === 'KeyX' ||
                e.code === 'KeyC' ||
                e.code === 'KeyR' ||
                e.code === 'Equal' ||
                e.code === 'Minus' ||
                e.code === 'NumpadAdd' ||
                e.code === 'NumpadSubtract' ||
                e.code === 'PageUp' ||
                e.code === 'PageDown';
            if (appKey && waveFocus) waveFocus.blur();
        }

        const isArrowKey = e.code === 'ArrowLeft' || e.code === 'ArrowRight';
        if (e.repeat && !isArrowKey) return;

        if (
            !e.repeat &&
            !e.ctrlKey &&
            !e.altKey &&
            !e.metaKey &&
            !e.shiftKey &&
            e.code === 'KeyL'
        ) {
            if (!loopPlaybackCheckbox) return;
            e.preventDefault();
            loopPlaybackCheckbox.checked = !loopPlaybackCheckbox.checked;
            logAndPersistLoopPlayback();
            return;
        }

        if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
            const mixVolUpByKey = {
                KeyA: 0,
                KeyS: 1,
                KeyD: 2,
            };
            const mixVolDownByKey = {
                KeyZ: 0,
                KeyX: 1,
                KeyC: 2,
            };
            if (Object.prototype.hasOwnProperty.call(mixVolUpByKey, e.code)) {
                handleMixVolKeydown(e, mixVolUpByKey[e.code], 1);
                return;
            }
            if (Object.prototype.hasOwnProperty.call(mixVolDownByKey, e.code)) {
                handleMixVolKeydown(e, mixVolDownByKey[e.code], -1);
                return;
            }

            if (!e.repeat) {
                const mixSoloByDigit = {
                    Digit1: 0,
                    Digit2: 1,
                    Digit3: 2,
                };
                const mixMuteByKey = {
                    KeyQ: 0,
                    KeyW: 1,
                    KeyE: 2,
                };
                if (Object.prototype.hasOwnProperty.call(mixSoloByDigit, e.code)) {
                    e.preventDefault();
                    const displayIndex = mixSoloByDigit[e.code];
                    if (typeof toggleMixSoloByDisplayIndex === 'function') {
                        toggleMixSoloByDisplayIndex(displayIndex);
                    }
                    return;
                }
                if (Object.prototype.hasOwnProperty.call(mixMuteByKey, e.code)) {
                    e.preventDefault();
                    const displayIndex = mixMuteByKey[e.code];
                    if (typeof toggleMixMuteByDisplayIndex === 'function') {
                        toggleMixMuteByDisplayIndex(displayIndex);
                    }
                    return;
                }
            }
        }

        if (typeof handleMarkerKeydown === 'function' && handleMarkerKeydown(e)) {
            return;
        }

        const numpadSeekDigit = {
            Numpad0: 0,
            Numpad1: 1,
            Numpad2: 2,
            Numpad3: 3,
            Numpad4: 4,
            Numpad5: 5,
            Numpad6: 6,
            Numpad7: 7,
            Numpad8: 8,
            Numpad9: 9,
        };
        if (Object.prototype.hasOwnProperty.call(numpadSeekDigit, e.code)) {
            if (e.repeat) return;
            if (!videoReady()) return;
            e.preventDefault();
            const d = numpadSeekDigit[e.code];
            const dur =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : getDuration(videoMain);
            const target = Math.max(0, Math.min(dur - 0.001, (d / 10) * dur));
            const wasPlaying =
                typeof isTransportPlaying === 'function'
                    ? isTransportPlaying()
                    : !videoMain.paused;
            void (async () => {
                if (typeof seekTransportToAndWait === 'function') {
                    await seekTransportToAndWait(target);
                } else {
                    applyTimeToVideo(target);
                }
                schedulePersistSession();
                writeLog(
                    'Seek keyboard: Numpad ' +
                        d +
                        ' -> ' +
                        formatTimecodeForTransport(target) +
                        ' (decile ' +
                        d +
                        '/10)'
                );
                flashSeekHint('Jump ' + d + '/10', formatTimecodeForTransport(target));
                if (wasPlaying && typeof startVideoPlayback === 'function') {
                    await startVideoPlayback({ force: true });
                }
            })();
            return;
        }

        if (e.code === 'Space') {
            if (e.repeat) return;
            if (!videoReady()) return;
            e.preventDefault();
            const playingNow =
                typeof isTransportPlaying === 'function'
                    ? isTransportPlaying()
                    : !videoMain.paused;
            if (!playingNow && typeof requestScrollToPlayerStageOnNextPlay === 'function') {
                requestScrollToPlayerStageOnNextPlay();
            }
            writeLog('Keyboard: Space -> transport toggle');
            playStopBtn.click();
            return;
        }

        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
            if (!videoReady()) return;
            e.preventDefault();
            const wasPlaying =
                typeof isTransportPlaying === 'function'
                    ? isTransportPlaying()
                    : !videoMain.paused;
            const dur =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : getDuration(videoMain);
            const dir = e.code === 'ArrowRight' ? 1 : -1;
            let stepSec;
            if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
                stepSec = 10;
            } else if (e.ctrlKey || e.metaKey) {
                stepSec = 5;
            } else if (e.shiftKey) {
                stepSec = 1;
            } else {
                stepSec = masterFrameSec;
            }
            const oneFrameStep = !e.shiftKey && !e.ctrlKey && !e.metaKey;
            if (oneFrameStep && wasPlaying) {
                transportPlayGeneration += 1;
                transportPlayInFlight = null;
                videoMain.pause();
                setPlayingUi(false);
                stopRaf();
                updateSeekUiFromVideo();
                if (typeof syncExtraAudioToTransport === 'function') {
                    syncExtraAudioToTransport();
                }
            }
            let t = (parseFloat(seekBar.value) || 0) + dir * stepSec;
            t = Math.max(0, Math.min(dur - 0.001, t));
            void (async () => {
                if (typeof seekTransportToAndWait === 'function') {
                    await seekTransportToAndWait(t);
                } else {
                    applyTimeToVideo(t);
                    currentTimeEl.textContent = formatTimecodeForTransport(t);
                    updateTimecodeOverlay();
                }
                schedulePersistSession();
                let stepLabel;
                if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
                    stepLabel = 'Ctrl+Shift ±10s';
                } else if (e.ctrlKey || e.metaKey) {
                    stepLabel = 'Ctrl ±5s';
                } else if (e.shiftKey) {
                    stepLabel = 'Shift ±1s';
                } else {
                    stepLabel = 'Frame ±1f';
                }
                const arrow = e.code === 'ArrowRight' ? 'ArrowRight' : 'ArrowLeft';
                const line =
                    'Seek keyboard: ' +
                    arrow +
                    ' (' +
                    stepLabel +
                    ') -> ' +
                    formatTimecodeForTransport(t) +
                    (e.repeat ? ' (repeat)' : '');
                if (!e.repeat) {
                    writeLog(line);
                } else {
                    logArrowSeekDebounced(line);
                }
                const sym = dir > 0 ? '→' : '←';
                let deltaTxt;
                if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
                    deltaTxt = dir > 0 ? '+10s' : '−10s';
                } else if (e.ctrlKey || e.metaKey) {
                    deltaTxt = dir > 0 ? '+5s' : '−5s';
                } else if (e.shiftKey) {
                    deltaTxt = dir > 0 ? '+1s' : '−1s';
                } else {
                    deltaTxt = dir > 0 ? '+1f' : '−1f';
                }
                flashSeekHint(sym, deltaTxt);
                if (!oneFrameStep && wasPlaying && typeof startVideoPlayback === 'function') {
                    await startVideoPlayback({ force: true });
                }
            })();
        }
    });

    window.addEventListener('keyup', (e) => {
        handleMixVolKeyup(e);
    });
    window.addEventListener('blur', clearMixVolActiveKeys);

    function persistOnPageExit() {
        writePrefs();
        if (typeof flushPersistSessionNow === 'function') {
            flushPersistSessionNow().catch(() => {});
        } else {
            persistSessionToStorage().catch(() => {});
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            writePrefs();
            const p =
                typeof flushPersistSessionNow === 'function'
                    ? flushPersistSessionNow()
                    : persistSessionToStorage();
            p.then(() => writeLog('Session: persisted (tab hidden)'))
                .catch((err) =>
                    writeLog(
                        'Session: persist failed — ' +
                            (err && err.message ? err.message : String(err))
                    )
                );
        }
    });
    window.addEventListener('pagehide', persistOnPageExit);
    window.addEventListener('beforeunload', persistOnPageExit);

    (async function boot() {
        if (typeof initTimecodeOverlay === 'function') {
            initTimecodeOverlay();
        }
        if (typeof initMarkers === 'function') {
            initMarkers();
        }
        if (typeof initPlayerSplitter === 'function') {
            initPlayerSplitter();
        }
        if (typeof initExtraAudioTracksUi === 'function') {
            initExtraAudioTracksUi();
        }
        try {
            await restoreSessionFromStorage();
        } catch (e) {
            writeLog('Session restore: ' + (e && e.message ? e.message : String(e)));
        }
        if (!fileMain && typeof applySavedWaveformLaneUi === 'function') {
            applySavedWaveformLaneUi(null);
        }
        syncSeekMax();
        updateControlsEnabled();
        onVideoMediaReady();
        if (typeof finalizeReviewMixAfterSessionRestore === 'function') {
            await finalizeReviewMixAfterSessionRestore();
        }
    })();
