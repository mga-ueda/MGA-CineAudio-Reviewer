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
        if (typeof applyPendingRangeLoopRestore === 'function') {
            applyPendingRangeLoopRestore();
        }
        if (
            typeof applyPendingPlaybackRegionRestore === 'function' &&
            !(typeof isSessionRestoreInProgress === 'function' && isSessionRestoreInProgress())
        ) {
            applyPendingPlaybackRegionRestore();
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
                    applyReviewMixVideoGain({ forceRecapture: true });
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
        if (typeof requestScrollToPlayerStageOnNextPlay === 'function') {
            requestScrollToPlayerStageOnNextPlay();
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
            writeLog('Playback: end reached (returned to head)');
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

    window.addEventListener('keydown', (e) => {
        if (typeof isWebmExportActive === 'function' && isWebmExportActive()) {
            if (e.code === 'Escape') {
                e.preventDefault();
                if (typeof tryCancelWebmExportFromEsc === 'function') {
                    tryCancelWebmExportFromEsc();
                }
                return;
            }
            e.preventDefault();
            return;
        }

        if (
            typeof handleMarkerPendingRangeEscapeKeydown === 'function' &&
            handleMarkerPendingRangeEscapeKeydown(e)
        ) {
            return;
        }

        if (typeof handleRangeLoopEscapeKeydown === 'function' && handleRangeLoopEscapeKeydown(e)) {
            return;
        }

        if (
            typeof handlePlaybackRegionEscapeKeydown === 'function' &&
            handlePlaybackRegionEscapeKeydown(e)
        ) {
            return;
        }

        if (
            typeof handleMarkerSelectionEscapeKeydown === 'function' &&
            handleMarkerSelectionEscapeKeydown(e)
        ) {
            return;
        }

        if (
            typeof handlePlaybackRegionUndoKeydown === 'function' &&
            handlePlaybackRegionUndoKeydown(e)
        ) {
            return;
        }

        if (
            typeof handlePlaybackRegionRedoKeydown === 'function' &&
            handlePlaybackRegionRedoKeydown(e)
        ) {
            return;
        }

        if (
            typeof handlePlaybackRegionCopyKeydown === 'function' &&
            handlePlaybackRegionCopyKeydown(e)
        ) {
            return;
        }

        if (
            typeof handlePlaybackRegionPasteKeydown === 'function' &&
            handlePlaybackRegionPasteKeydown(e)
        ) {
            return;
        }

        if (typeof handleMarkerBracketKeydown === 'function' && handleMarkerBracketKeydown(e)) {
            return;
        }

        if (
            (typeof handlePlaybackRegionSplitKeydown === 'function' &&
                handlePlaybackRegionSplitKeydown(e)) ||
            (typeof handlePlaybackRegionSlashKeydown === 'function' &&
                handlePlaybackRegionSlashKeydown(e))
        ) {
            return;
        }

        if (
            typeof handlePlaybackRegionJoinKeydown === 'function' &&
            handlePlaybackRegionJoinKeydown(e)
        ) {
            return;
        }

        if (isTypingTarget(e.target)) return;

        if (
            typeof handleSessionIoShortcutKeydown === 'function' &&
            handleSessionIoShortcutKeydown(e)
        ) {
            return;
        }

        if (
            typeof handleMasterVolShortcutKeydown === 'function' &&
            handleMasterVolShortcutKeydown(e)
        ) {
            return;
        }

        if (
            typeof handleAnalyzeShortcutKeydown === 'function' &&
            handleAnalyzeShortcutKeydown(e)
        ) {
            return;
        }

        if (
            typeof handlePlaybackRegionDeleteKeydown === 'function' &&
            handlePlaybackRegionDeleteKeydown(e)
        ) {
            return;
        }

        if (typeof handleMarkerDeleteKeydown === 'function' && handleMarkerDeleteKeydown(e)) {
            return;
        }

        if (
            typeof handleActiveMixLaneVolumeKeydown === 'function' &&
            handleActiveMixLaneVolumeKeydown(e)
        ) {
            return;
        }

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
                e.code === 'KeyS' ||
                e.code === 'KeyV' ||
                e.code === 'KeyX' ||
                e.code === 'KeyB' ||
                e.code === 'KeyF' ||
                e.code === 'KeyZ' ||
                e.code === 'Insert' ||
                e.code === 'IntlYen' ||
                e.code === 'Backslash' ||
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
                e.code === 'KeyS' ||
                e.code === 'KeyV' ||
                e.code === 'KeyF' ||
                e.code === 'KeyZ' ||
                e.code === 'Insert' ||
                e.code === 'IntlYen' ||
                e.code === 'Backslash' ||
                e.code === 'Equal' ||
                e.code === 'Minus' ||
                e.code === 'NumpadAdd' ||
                e.code === 'NumpadSubtract' ||
                e.code === 'KeyX' ||
                e.code === 'KeyB' ||
                e.code === 'PageUp' ||
                e.code === 'PageDown';
            if (appKey && waveFocus) waveFocus.blur();
        }

        if (
            typeof handlePlaybackRegionMixKeydown === 'function' &&
            handlePlaybackRegionMixKeydown(e)
        ) {
            return;
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

        if (typeof handleMarkerKeydown === 'function' && handleMarkerKeydown(e)) {
            return;
        }

        if (typeof handleMarkerHideViewKeydown === 'function' && handleMarkerHideViewKeydown(e)) {
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
            if (
                typeof transportControlsReady !== 'function' ||
                !transportControlsReady()
            ) {
                return;
            }
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
                    await seekTransportToAndWait(target, { resumeAfter: wasPlaying });
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
            })();
            return;
        }

        if (
            (e.code === 'Enter' || e.code === 'NumpadEnter') &&
            e.altKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.shiftKey
        ) {
            if (e.repeat) return;
            if (
                typeof transportControlsReady !== 'function' ||
                !transportControlsReady()
            ) {
                return;
            }
            if (
                typeof transportPlaybackStartSec === 'undefined' ||
                !Number.isFinite(transportPlaybackStartSec)
            ) {
                return;
            }
            e.preventDefault();
            void (typeof replayTransportFromPlaybackStart === 'function'
                ? replayTransportFromPlaybackStart()
                : Promise.resolve());
            return;
        }

        if (
            e.code === 'Space' &&
            (e.ctrlKey || e.metaKey) &&
            !e.altKey &&
            !e.shiftKey
        ) {
            if (e.repeat) return;
            if (
                typeof transportControlsReady !== 'function' ||
                !transportControlsReady()
            ) {
                return;
            }
            e.preventDefault();
            const cur =
                typeof getTransportSec === 'function'
                    ? getTransportSec()
                    : parseFloat(seekBar.value) || 0;
            const target = Math.max(0, cur - 1);
            void (async () => {
                if (typeof seekTransportToAndWait === 'function') {
                    await seekTransportToAndWait(target, { resumeAfter: false });
                } else if (typeof applyTimeToVideo === 'function') {
                    applyTimeToVideo(target);
                }
                schedulePersistSession();
                writeLog(
                    'Keyboard: Ctrl+Space -> preroll play from ' +
                        formatTimecodeForTransport(target)
                );
                playStopBtn.click();
            })();
            return;
        }

        if (e.code === 'Space') {
            if (e.repeat) return;
            if (
                typeof transportControlsReady !== 'function' ||
                !transportControlsReady()
            ) {
                return;
            }
            e.preventDefault();
            writeLog('Keyboard: Space -> transport toggle');
            playStopBtn.click();
            return;
        }

        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
            if (
                typeof transportControlsReady !== 'function' ||
                !transportControlsReady()
            ) {
                return;
            }
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
            let t = (parseFloat(seekBar.value) || 0) + dir * stepSec;
            t = Math.max(0, Math.min(dur - 0.001, t));
            void (async () => {
                if (typeof seekTransportToAndWait === 'function') {
                    await seekTransportToAndWait(t, {
                        resumeAfter: wasPlaying && !oneFrameStep,
                    });
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
            })();
        }
    });

    document.addEventListener(
        'keydown',
        (e) => {
            if (e.key === 'Alt' && typeof setAltKeySnapSuppressed === 'function') {
                setAltKeySnapSuppressed(true);
                if (typeof window.refreshPlaybackRegionHoverCursorLine === 'function') {
                    window.refreshPlaybackRegionHoverCursorLine();
                }
            }
        },
        true,
    );
    document.addEventListener(
        'keyup',
        (e) => {
            if (e.key === 'Alt' && typeof setAltKeySnapSuppressed === 'function') {
                setAltKeySnapSuppressed(false);
                if (typeof window.refreshPlaybackRegionHoverCursorLine === 'function') {
                    window.refreshPlaybackRegionHoverCursorLine();
                }
            }
        },
        true,
    );
    window.addEventListener('blur', () => {
        if (typeof setAltKeySnapSuppressed === 'function') {
            setAltKeySnapSuppressed(false);
        }
    });

    window.addEventListener('keyup', (e) => {
        if (typeof handleMarkerKeyup === 'function' && handleMarkerKeyup(e)) {
            return;
        }

        if (e.code !== 'PageUp' && e.code !== 'PageDown') return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        if (typeof window.clearExtraTrackVolumeUnityHold === 'function') {
            window.clearExtraTrackVolumeUnityHold();
        }
    });

    function persistOnPageExit() {
        if (typeof haltTransportOnPageExit === 'function') {
            haltTransportOnPageExit();
        }
        writePrefs();
        if (typeof flushPersistSessionNow === 'function') {
            flushPersistSessionNow().catch(() => {});
        } else {
            persistSessionToStorage().catch(() => {});
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            if (typeof haltTransportOnPageExit === 'function') {
                haltTransportOnPageExit();
            }
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

    function bindTransportDocPopupLink(linkEl, windowName, width, height) {
        if (!linkEl) return;
        linkEl.addEventListener('click', (e) => {
            e.preventDefault();
            const features = [
                'noopener',
                'noreferrer',
                'width=' + width,
                'height=' + height,
                'menubar=no',
                'toolbar=no',
                'location=no',
                'status=no',
                'scrollbars=yes',
                'resizable=yes',
            ].join(',');
            const win = window.open(linkEl.href, windowName, features);
            if (win) win.opener = null;
        });
    }

    bindTransportDocPopupLink(
        document.getElementById('transportGuideLink'),
        'mgaCineAudioGuide',
        960,
        820,
    );
    bindTransportDocPopupLink(
        document.getElementById('transportShortcutsLink'),
        'mgaKeyboardShortcuts',
        820,
        720,
    );

    (async function boot() {
        if (typeof initTimecodeOverlay === 'function') {
            initTimecodeOverlay();
        }
        if (typeof initMarkers === 'function') {
            initMarkers();
        }
        if (typeof initExtraAudioTracksUi === 'function') {
            initExtraAudioTracksUi();
        }
        try {
            await restoreSessionFromStorage();
        } catch (e) {
            writeLog('Session restore: ' + (e && e.message ? e.message : String(e)));
        }
        if (typeof whenSessionRestoreIdle === 'function') {
            await whenSessionRestoreIdle();
        }
        if (typeof updateSessionAllClearButton === 'function') {
            updateSessionAllClearButton();
        }
        if (!fileMain && typeof applySavedWaveformLaneUi === 'function') {
            applySavedWaveformLaneUi(null);
        }
        syncSeekMax();
        updateControlsEnabled();
        if (!fileMain && typeof syncAudioOnlyMarkersUi === 'function') {
            syncAudioOnlyMarkersUi();
        }
        onVideoMediaReady();
        if (typeof finalizeReviewMixAfterSessionRestore === 'function') {
            await finalizeReviewMixAfterSessionRestore();
        } else if (typeof ensureMainVideoWaveformAfterSessionRestore === 'function') {
            ensureMainVideoWaveformAfterSessionRestore();
        }
        if (
            typeof fileMain !== 'undefined' &&
            fileMain &&
            typeof scheduleMainVideoWaveformPresenceWatch === 'function'
        ) {
            scheduleMainVideoWaveformPresenceWatch({ firstDelayMs: 800 });
        }
        if (typeof refreshExportMediaOptionsUi === 'function') {
            refreshExportMediaOptionsUi();
        }
        if (typeof scheduleMarkersUiRefreshAfterLayout === 'function') {
            scheduleMarkersUiRefreshAfterLayout();
        }
    })();
