/**
 * events-video-bind.js — video・シークバー・ファイルピッカー・トランスポート UI のイベント登録。
 */
    window.scheduleSessionTransportRestoreRetry = function scheduleSessionTransportRestoreRetry() {
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
        if (typeof applyReviewMixVideoGain === 'function') {
            applyReviewMixVideoGain();
        }
        if (typeof tryWireReviewMixVideoAudioWhenReady === 'function') {
            tryWireReviewMixVideoAudioWhenReady();
        }
        syncSeekMax();
        updateControlsEnabled();
        if (
            typeof applyPendingPlaybackRegionRestore === 'function' &&
            !(typeof isSessionRestoreInProgress === 'function' && isSessionRestoreInProgress())
        ) {
            applyPendingPlaybackRegionRestore();
        }
        if (typeof ensureVideoFilmstripLoadingOverlay === 'function') {
            ensureVideoFilmstripLoadingOverlay();
        }
        if (typeof scheduleVideoTrackFilmstripBuild === 'function') {
            scheduleVideoTrackFilmstripBuild();
        }
        if (typeof syncVideoTrackRegionsPresentation === 'function') {
            const restoreBusy =
                typeof isSessionRestoreInProgress === 'function' &&
                isSessionRestoreInProgress();
            if (!restoreBusy) {
                syncVideoTrackRegionsPresentation();
            }
        } else if (typeof refreshVideoVizLaneVisibility === 'function') {
            refreshVideoVizLaneVisibility({ skipInit: true });
        }
        if (typeof showFirstVideoFrame === 'function') {
            showFirstVideoFrame();
        }
        if (typeof notifyVideoLoadLockVideoReady === 'function') {
            notifyVideoLoadLockVideoReady();
        }
        if (typeof notifyVideoAudioLoadSettledIfNoVideoAudio === 'function') {
            notifyVideoAudioLoadSettledIfNoVideoAudio();
        }
        if (
            typeof urlMain !== 'undefined' &&
            urlMain &&
            typeof refreshVideoAudioLaneVisibility === 'function'
        ) {
            refreshVideoAudioLaneVisibility();
        }
        if (typeof refreshVideoVizLaneVisibility === 'function') {
            refreshVideoVizLaneVisibility();
        }
        if (typeof kickMainVideoWaveformBuild === 'function') {
            kickMainVideoWaveformBuild({ allowSettle: false });
        }
        if (typeof scheduleMainVideoWaveformPresenceWatch === 'function') {
            scheduleMainVideoWaveformPresenceWatch();
        }
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        if (
            typeof isExtraTrackLoaded === 'function' &&
            (typeof hasAnyExtraTrackLoaded === 'function' && hasAnyExtraTrackLoaded()) &&
            typeof ensureExtraTrackWaveformsDrawn === 'function'
        ) {
            ensureExtraTrackWaveformsDrawn({ notifyMaster: true });
        }
        onVideoMediaReady();
    }

    let videoMainListenersAbort = null;

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

    function bindVideoMainElementListeners(el) {
        if (!el) return;
        if (videoMainListenersAbort) {
            videoMainListenersAbort.abort();
        }
        videoMainListenersAbort = new AbortController();
        const sig = videoMainListenersAbort.signal;

        el.addEventListener('loadedmetadata', onMeta, { signal: sig });
        el.addEventListener('loadeddata', onMeta, { signal: sig });
        el.addEventListener('durationchange', onMeta, { signal: sig });
        el.addEventListener('progress', onDurationMaybeProgress, { signal: sig });

        el.addEventListener(
            'pause',
            () => {
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
                if (el.paused) setPlayingUi(false);
                updateControlsEnabled();
                if (typeof syncExtraAudioToTransport === 'function') {
                    syncExtraAudioToTransport();
                }
                if (typeof tryScheduleWaveformBuildIfNeeded === 'function') {
                    tryScheduleWaveformBuildIfNeeded(600);
                }
            },
            { signal: sig },
        );
        el.addEventListener(
            'play',
            () => {
                setPlayingUi(true);
                updateControlsEnabled();
                if (typeof applyReviewMixVideoGain === 'function') {
                    applyReviewMixVideoGain();
                }
                if (!rafId && !el.paused) rafId = requestAnimationFrame(tick);
                if (typeof tryScheduleWaveformBuildIfNeeded === 'function') {
                    setTimeout(() => tryScheduleWaveformBuildIfNeeded(1500), 400);
                }
            },
            { signal: sig },
        );
        el.addEventListener(
            'playing',
            () => {
                if (typeof applyReviewMixVideoGain === 'function') {
                    const stale =
                        typeof consumeReviewMixVideoMonitorTapStale === 'function' &&
                        consumeReviewMixVideoMonitorTapStale();
                    const needsPlayRecapture =
                        typeof needsReviewMixVideoMonitorPlayRecapture === 'function' &&
                        needsReviewMixVideoMonitorPlayRecapture();
                    const forceRecapture = stale || needsPlayRecapture;
                    if (typeof window.videoAnalyzerDiagLog === 'function') {
                        window.videoAnalyzerDiagLog('transport/playing', {
                            stale,
                            needsPlayRecapture,
                            nativeTap:
                                typeof isVideoAudioPlaybackViaNativeElement === 'function' &&
                                isVideoAudioPlaybackViaNativeElement(),
                            forceRecapture,
                        });
                    }
                    applyReviewMixVideoGain(
                        forceRecapture ? { forceRecapture: true } : undefined,
                    );
                }
            },
            { signal: sig },
        );
        el.addEventListener(
            'timeupdate',
            () => {
                if (typeof onVideoTimeUpdate === 'function') onVideoTimeUpdate();
            },
            { signal: sig },
        );
        el.addEventListener(
            'waiting',
            () => {
                writeLog('Video: waiting for data (t=' + (el.currentTime || 0).toFixed(2) + ')');
            },
            { signal: sig },
        );
        el.addEventListener(
            'stalled',
            () => {
                writeLog('Video: stalled (t=' + (el.currentTime || 0).toFixed(2) + ')');
            },
            { signal: sig },
        );
        el.addEventListener(
            'error',
            () => {
                if (typeof cancelVideoLoadLock === 'function') {
                    cancelVideoLoadLock();
                }
                writeLog('Video: load/decode error');
                if (typeof updateControlsEnabled === 'function') {
                    updateControlsEnabled();
                }
            },
            { signal: sig },
        );
        el.addEventListener('ended', onVideoEnded, { signal: sig });
    }

    window.rebindVideoMainListeners = bindVideoMainElementListeners;
    bindVideoMainElementListeners(videoMain);

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
            if (typeof cancelTransportExplicitSeekTail === 'function') {
                cancelTransportExplicitSeekTail();
            }
            writeLog('Transport: pause (button)');
            if (typeof clearTransportTailPlayback === 'function') clearTransportTailPlayback();
            if (typeof clearVideoParkedForTail === 'function') clearVideoParkedForTail();
            videoMain.pause();
            setPlayingUi(false);
            stopRaf();
            if (typeof freezeTransportPlaybackClock === 'function') {
                freezeTransportPlaybackClock();
            }
            updateSeekUiFromVideo();
            if (typeof syncExtraAudioToTransport === 'function') {
                syncExtraAudioToTransport();
            }
            return;
        }
        if (typeof endAudioWaveformScrub === 'function') {
            endAudioWaveformScrub({ force: true });
        }
        isSeeking = false;
        writeLog('Transport: play (button)');
        transportPlayInFlight = null;
        const playGen = ++transportPlayGeneration;
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
        try {
            const runPlay =
                typeof window.runTransportPlay === 'function'
                    ? window.runTransportPlay
                    : typeof runTransportPlay === 'function'
                      ? runTransportPlay
                      : null;
            if (runPlay) {
                const ok = await runPlay(playGen);
                if (ok === false && playGen === transportPlayGeneration) {
                    writeLogWarn('Transport: play aborted (superseded or cancelled)');
                }
            } else if (typeof window.startVideoPlayback === 'function') {
                await window.startVideoPlayback({ force: true, playGen });
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

    async function onVideoEnded() {
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
            const handled = await handleMasterTransportEndReached();
            if (handled) return;
        }
        if (
            typeof getLoopPlaybackEnabled === 'function' &&
            !getLoopPlaybackEnabled() &&
            typeof stopPlaybackReturnTransportToHead === 'function'
        ) {
            stopPlaybackReturnTransportToHead();
            const returnSec =
                typeof transportPlaybackStartSec !== 'undefined' &&
                Number.isFinite(transportPlaybackStartSec)
                    ? transportPlaybackStartSec
                    : 0;
            writeLog(
                'Playback: end reached (returned to ' +
                    formatTimecodeForTransport(returnSec) +
                    ')',
            );
            return;
        }
        videoMain.pause();
        if (typeof stopAllExtraTrackSources === 'function') stopAllExtraTrackSources();
        stopRaf();
        setPlayingUi(false);
        updateSeekUiFromVideo();
        writeLog('Playback: end reached (transport stopped)');
    }

    document.addEventListener(
        'wheel',
        (ev) => {
            /** Export 中のみスクロールロック。 */
            if (typeof isWebmExportActive === 'function' && isWebmExportActive()) {
                ev.preventDefault();
            }
        },
        { passive: false, capture: true },
    );
    document.addEventListener(
        'touchmove',
        (ev) => {
            if (typeof isWebmExportActive === 'function' && isWebmExportActive()) {
                ev.preventDefault();
            }
        },
        { passive: false, capture: true },
    );
