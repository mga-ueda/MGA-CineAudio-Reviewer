/**
 * keyboard-transport-scrub.js — キーボード ←/→ スクラブ（拡大中は zoom-lite: 位置のみ、離したら描画）。
 */
(function keyboardTransportScrubModule() {
    let keyboardTransportScrubActive = false;
    let keyboardScrubPendingSec = null;
    let keyboardScrubRafId = 0;
    let keyboardScrubResumeAfter = false;
    let keyboardScrubPauseAfter = false;
    let keyboardScrubFlushTimer = 0;
    /** 単押し連打をまとめてから確定（keyup 直後の同期 flush が毎回重い） */
    const KEYBOARD_SCRUB_FLUSH_DELAY_MS = 120;

    let discreteStopNavActive = false;
    let discreteStopNavTargetSec = null;
    let discreteStopNavResumeAfter = false;
    let discreteStopNavFinalizeTimer = 0;

    function cancelDiscreteStopNavTimer() {
        if (discreteStopNavFinalizeTimer) {
            clearTimeout(discreteStopNavFinalizeTimer);
            discreteStopNavFinalizeTimer = 0;
        }
    }

    function scheduleDiscreteStopNavFinalize() {
        cancelDiscreteStopNavTimer();
        discreteStopNavFinalizeTimer = setTimeout(() => {
            discreteStopNavFinalizeTimer = 0;
            void flushDiscreteStopNav();
        }, KEYBOARD_SCRUB_FLUSH_DELAY_MS);
    }

    function clearDiscreteStopNavState() {
        cancelDiscreteStopNavTimer();
        discreteStopNavActive = false;
        discreteStopNavTargetSec = null;
        discreteStopNavResumeAfter = false;
    }

    /** Ctrl+←→ 等: スクラブセッションなしで UI のみ即更新、確定は coalesce */
    function applyDiscreteStopNavStep(sec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        cancelKeyboardScrubFlushTimer();
        const x =
            typeof clampTransportSec === 'function'
                ? clampTransportSec(sec)
                : Number.isFinite(Number(sec))
                  ? Number(sec)
                  : null;
        if (x == null || !Number.isFinite(x)) return false;
        if (!discreteStopNavActive) {
            discreteStopNavActive = true;
            discreteStopNavResumeAfter = !!o.resumeAfterSeek;
            if (
                discreteStopNavResumeAfter &&
                typeof pauseTransportBeforeSeek === 'function'
            ) {
                pauseTransportBeforeSeek();
            }
        }
        transportExplicitSeekTargetSec = x;
        transportPlaybackSec = x;
        transportPlaybackLastTs =
            typeof isTransportPlaying === 'function' && isTransportPlaying()
                ? performance.now()
                : 0;
        if (typeof setTransportSec === 'function') setTransportSec(x);
        if (typeof applyTransportScrubPositionImmediate === 'function') {
            applyTransportScrubPositionImmediate(x);
        } else if (typeof currentTimeEl !== 'undefined' && currentTimeEl) {
            currentTimeEl.textContent = formatTimecodeForTransport(x);
        }
        discreteStopNavTargetSec = x;
        scheduleDiscreteStopNavFinalize();
        return true;
    }

    async function flushDiscreteStopNav() {
        cancelDiscreteStopNavTimer();
        if (!discreteStopNavActive) return false;
        const target = discreteStopNavTargetSec;
        const shouldResume = discreteStopNavResumeAfter;
        clearDiscreteStopNavState();
        if (target == null || !Number.isFinite(target)) return false;
        if (
            typeof hasMasterTransportTailBeyondVideo === 'function' &&
            hasMasterTransportTailBeyondVideo()
        ) {
            const vd =
                typeof getVideoPlaybackEndSec === 'function' ? getVideoPlaybackEndSec() : 0;
            const eps =
                typeof masterTransportTailEpsilonSec === 'function'
                    ? masterTransportTailEpsilonSec()
                    : 0.02;
            if (vd > 0 && target < vd - eps) {
                if (typeof clearTransportTailPlayback === 'function') {
                    clearTransportTailPlayback();
                }
                if (typeof clearVideoParkedForTail === 'function') {
                    clearVideoParkedForTail();
                }
            }
        }
        transportPlaybackSec = target;
        transportPlaybackLastTs = 0;
        if (typeof setTransportSec === 'function') setTransportSec(target);
        if (typeof applyVideoTimeForTransportSec === 'function') {
            applyVideoTimeForTransportSec(target, { force: true });
        }
        if (typeof refreshVideoPastEndBlackoutUi === 'function') {
            refreshVideoPastEndBlackoutUi();
        }
        if (typeof updateTimecodeOverlay === 'function') updateTimecodeOverlay();
        if (shouldResume && typeof resumeTransportAfterExplicitSeek === 'function') {
            await resumeTransportAfterExplicitSeek(target);
            if (
                typeof forceTransportRafLoop === 'function' &&
                typeof isTransportUiClockActive === 'function' &&
                isTransportUiClockActive()
            ) {
                forceTransportRafLoop();
            }
        } else if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        const viewportCurrent =
            typeof isWaveformViewportDisplayCurrent === 'function' &&
            isWaveformViewportDisplayCurrent();
        if (viewportCurrent) {
            if (typeof drawWaveformChromeOverlays === 'function') {
                drawWaveformChromeOverlays();
            }
        } else if (typeof flushWaveformVisualRefresh === 'function') {
            flushWaveformVisualRefresh({ playbackScroll: true });
            if (typeof renderAudioWaveformMarkers === 'function') {
                renderAudioWaveformMarkers();
            }
            if (typeof updateAllWaveformPlayheads === 'function') {
                updateAllWaveformPlayheads();
            }
        }
        return true;
    }

    function flushDiscreteStopNavIfActive(opt) {
        if (!discreteStopNavActive) return false;
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.immediate) {
            cancelDiscreteStopNavTimer();
            void flushDiscreteStopNav();
        } else {
            scheduleDiscreteStopNavFinalize();
        }
        return true;
    }

    function cancelKeyboardScrubFlushTimer() {
        if (keyboardScrubFlushTimer) {
            clearTimeout(keyboardScrubFlushTimer);
            keyboardScrubFlushTimer = 0;
        }
    }

    function scheduleKeyboardScrubFlush() {
        cancelKeyboardScrubFlushTimer();
        keyboardScrubFlushTimer = setTimeout(() => {
            keyboardScrubFlushTimer = 0;
            void flushKeyboardTransportScrub();
        }, KEYBOARD_SCRUB_FLUSH_DELAY_MS);
    }

    function isPageTransportSeek(ev) {
        if (typeof matchUserShortcut !== 'function') return false;
        return (
            matchUserShortcut(ev, 'transportSeekPageUp', { allowRepeat: true }) ||
            matchUserShortcut(ev, 'transportSeekPageDown', { allowRepeat: true }) ||
            matchUserShortcut(ev, 'transportSeekPageUp10', { allowRepeat: true }) ||
            matchUserShortcut(ev, 'transportSeekPageDown10', { allowRepeat: true })
        );
    }

    function isMarkerStopJumpSeek(ev) {
        if (!ev || ev.altKey || ev.shiftKey) return false;
        if (typeof matchUserShortcut !== 'function') return false;
        return (
            matchUserShortcut(ev, 'markerStopJumpPrev', { allowRepeat: true }) ||
            matchUserShortcut(ev, 'markerStopJumpNext', { allowRepeat: true })
        );
    }

    function isOneFrameTransportArrowSeek(ev) {
        if (!ev || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
        if (typeof matchUserShortcut !== 'function') return false;
        return (
            matchUserShortcut(ev, 'transportSeekArrowLeft', { allowRepeat: true }) ||
            matchUserShortcut(ev, 'transportSeekArrowRight', { allowRepeat: true })
        );
    }

    function isKeyboardTransportScrubActive() {
        return keyboardTransportScrubActive;
    }

    function isKeyboardScrubZoomed() {
        return (
            typeof isWaveformTimelineAtFitZoom === 'function' &&
            !isWaveformTimelineAtFitZoom()
        );
    }

    /** 拡大中のキーボードスクラブセッション中 */
    function isKeyboardScrubZoomLite() {
        return keyboardTransportScrubActive && isKeyboardScrubZoomed();
    }

    /**
     * 映像シーク・波形再描画を省略する軽量ステップか。
     * @param {{ keyboardScrub?: boolean, fromRepeat?: boolean, seekFinalize?: boolean }|undefined} opt
     */
    function isKeyboardScrubLightweight(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.seekFinalize) return false;
        if (!(o.keyboardScrub || keyboardTransportScrubActive)) return false;
        // セッション中は flush まで UI のみ更新（coalesce 確定と競合しない）
        if (keyboardTransportScrubActive) return true;
        return !!(o.fromRepeat || isKeyboardScrubZoomed());
    }

    /** 拡大中は rAF キューで UI のみ更新 */
    function shouldQueueKeyboardScrubUi(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.seekFinalize) return false;
        return isKeyboardScrubLightweight(o) && isKeyboardScrubZoomed();
    }

    function beginKeyboardTransportScrub(ev) {
        cancelKeyboardScrubFlushTimer();
        cancelDiscreteStopNavTimer();
        clearDiscreteStopNavState();
        if (typeof prioritizeWaveformScrub === 'function') {
            prioritizeWaveformScrub('keyboardScrub');
        }
        if (keyboardTransportScrubActive) return;
        const wasActive =
            typeof captureTransportWasActive === 'function' &&
            captureTransportWasActive();
        const oneFrame = isOneFrameTransportArrowSeek(ev);
        const pageSeek = isPageTransportSeek(ev);
        const markerStopJump = isMarkerStopJumpSeek(ev);
        if (wasActive && oneFrame) {
            keyboardScrubPauseAfter = true;
        } else if (wasActive && (pageSeek || markerStopJump || !oneFrame)) {
            keyboardScrubResumeAfter = true;
            transportExplicitSeekResumeIntent = true;
            if (typeof pauseTransportBeforeSeek === 'function') {
                pauseTransportBeforeSeek();
            }
        }
        keyboardTransportScrubActive = true;
        if (
            isKeyboardScrubZoomed() &&
            typeof beginWaveformVisualRefreshDefer === 'function'
        ) {
            beginWaveformVisualRefreshDefer();
        }
        if (typeof beginWaveformScrubOverviewDrawState === 'function') {
            beginWaveformScrubOverviewDrawState();
        }
    }

    function applyKeyboardScrubUiNow() {
        const x = keyboardScrubPendingSec;
        if (x == null || !Number.isFinite(x)) return;
        if (typeof applyTransportScrubPositionImmediate === 'function') {
            applyTransportScrubPositionImmediate(x);
            return;
        }
        if (typeof currentTimeEl !== 'undefined' && currentTimeEl) {
            currentTimeEl.textContent = formatTimecodeForTransport(x);
        }
        if (typeof updateAllWaveformPlayheads === 'function') {
            updateAllWaveformPlayheads({ keyboardScrub: true });
        }
    }

    function queueKeyboardScrubUiUpdate(sec) {
        const x =
            typeof clampTransportSec === 'function'
                ? clampTransportSec(sec)
                : Number.isFinite(Number(sec))
                  ? Number(sec)
                  : null;
        if (x == null || !Number.isFinite(x)) return false;
        keyboardScrubPendingSec = x;
        transportExplicitSeekTargetSec = x;
        transportPlaybackSec = x;
        transportPlaybackLastTs = performance.now();
        if (typeof setTransportSec === 'function') setTransportSec(x);
        applyKeyboardScrubUiNow();
        return true;
    }

    function refreshTransportAfterKeyboardScrub() {
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (typeof updateTimecodeOverlay === 'function') updateTimecodeOverlay();
        if (
            typeof endWaveformVisualRefreshDefer === 'function' &&
            typeof isWaveformVisualRefreshDeferred === 'function'
        ) {
            while (isWaveformVisualRefreshDeferred()) {
                endWaveformVisualRefreshDefer({ cancelPending: true });
            }
        }
        if (typeof flushWaveformVisualRefresh === 'function') {
            flushWaveformVisualRefresh({ playbackScroll: true });
        } else if (typeof scheduleWaveformVisualRefresh === 'function') {
            scheduleWaveformVisualRefresh();
        } else if (typeof applyWaveformViewportPeaksImmediate === 'function') {
            applyWaveformViewportPeaksImmediate();
            if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
            if (typeof redrawAllExtraTrackWaveforms === 'function') {
                redrawAllExtraTrackWaveforms();
            }
        }
        if (typeof renderAudioWaveformMarkers === 'function') {
            renderAudioWaveformMarkers();
        }
        if (typeof updateAllWaveformPlayheads === 'function') {
            updateAllWaveformPlayheads();
        }
    }

    function applyKeyboardTransportScrubStep(sec, opt) {
        cancelKeyboardScrubFlushTimer();
        const o = opt && typeof opt === 'object' ? opt : {};
        transportExplicitSeekTargetSec = sec;
        if (!isKeyboardScrubLightweight(o)) {
            if (typeof seekTransportToAndWait === 'function') {
                void seekTransportToAndWait(sec, o);
            }
            return true;
        }
        const x =
            typeof clampTransportSec === 'function'
                ? clampTransportSec(sec)
                : Number.isFinite(Number(sec))
                  ? Number(sec)
                  : null;
        if (x == null || !Number.isFinite(x)) return false;
        keyboardScrubPendingSec = x;
        transportPlaybackSec = x;
        transportPlaybackLastTs = performance.now();
        if (typeof setTransportSec === 'function') setTransportSec(x);
        if (typeof applyTransportScrubPositionImmediate === 'function') {
            applyTransportScrubPositionImmediate(x);
        } else if (shouldQueueKeyboardScrubUi(o)) {
            queueKeyboardScrubUiUpdate(sec);
        } else if (typeof applyTransportUiImmediate === 'function') {
            applyTransportUiImmediate(sec, { lightweight: true, keyboardScrub: true });
        }
        return true;
    }

    async function flushKeyboardTransportScrub() {
        cancelKeyboardScrubFlushTimer();
        if (!keyboardTransportScrubActive) return false;
        if (keyboardScrubRafId) {
            cancelAnimationFrame(keyboardScrubRafId);
            keyboardScrubRafId = 0;
        }
        if (transportExplicitSeekFinalizeTimer) {
            clearTimeout(transportExplicitSeekFinalizeTimer);
            transportExplicitSeekFinalizeTimer = 0;
        }
        if (typeof rejectExplicitSeekWaiters === 'function') {
            rejectExplicitSeekWaiters();
        }
        if (typeof transportExplicitSeekSerial === 'number') {
            transportExplicitSeekSerial += 1;
        }
        const shouldResume = keyboardScrubResumeAfter || transportExplicitSeekResumeIntent;
        const pauseAfter = keyboardScrubPauseAfter;
        keyboardScrubResumeAfter = false;
        keyboardScrubPauseAfter = false;
        transportExplicitSeekResumeIntent = false;
        transportExplicitSeekPauseAfterIntent = false;
        keyboardScrubPendingSec = null;
        const target =
            transportExplicitSeekTargetSec != null &&
            Number.isFinite(transportExplicitSeekTargetSec)
                ? transportExplicitSeekTargetSec
                : typeof getTransportSec === 'function'
                  ? getTransportSec()
                  : null;
        if (target == null || !Number.isFinite(target)) {
            keyboardTransportScrubActive = false;
            if (typeof resetWaveformScrubOverviewDrawState === 'function') {
                resetWaveformScrubOverviewDrawState();
            }
            return false;
        }
        requestAnimationFrame(() => {
            void (async () => {
                let ok = false;
                if (typeof applyTransportAtSec === 'function') {
                    applyTransportAtSec(target, {
                        markers: true,
                        resumeAfter: false,
                        seekFinalize: true,
                    });
                    ok = true;
                } else if (typeof finalizeExplicitTransportSeek === 'function') {
                    ok = await finalizeExplicitTransportSeek();
                }
                if (
                    ok &&
                    shouldResume &&
                    !pauseAfter &&
                    typeof resumeTransportAfterExplicitSeek === 'function'
                ) {
                    await resumeTransportAfterExplicitSeek(target);
                } else if (
                    ok &&
                    pauseAfter &&
                    typeof pauseTransportBeforeSeek === 'function'
                ) {
                    pauseTransportBeforeSeek();
                }
                keyboardTransportScrubActive = false;
                if (typeof resetWaveformScrubOverviewDrawState === 'function') {
                    resetWaveformScrubOverviewDrawState();
                }
                refreshTransportAfterKeyboardScrub();
            })();
        });
        return true;
    }

    function flushKeyboardTransportScrubIfActive(opt) {
        if (!keyboardTransportScrubActive) return false;
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.immediate) {
            cancelKeyboardScrubFlushTimer();
            void flushKeyboardTransportScrub();
        } else {
            scheduleKeyboardScrubFlush();
        }
        return true;
    }

    function isWaveformLaneSeekShortcut(ev) {
        return (
            matchUserShortcut(ev, 'waveformLaneSeekHome', { allowRepeat: true }) ||
            matchUserShortcut(ev, 'waveformLaneSeekEnd', { allowRepeat: true }) ||
            matchUserShortcut(ev, 'waveformLaneSeekPrev', { allowRepeat: true }) ||
            matchUserShortcut(ev, 'waveformLaneSeekNext', { allowRepeat: true })
        );
    }

    function noteKeyboardTransportScrubBegin(ev) {
        if (!ev || !ev.repeat) beginKeyboardTransportScrub(ev);
    }

    window.isKeyboardTransportScrubActive = isKeyboardTransportScrubActive;
    window.isKeyboardScrubZoomLite = isKeyboardScrubZoomLite;
    window.isKeyboardScrubLightweight = isKeyboardScrubLightweight;
    window.shouldQueueKeyboardScrubUi = shouldQueueKeyboardScrubUi;
    window.beginKeyboardTransportScrub = beginKeyboardTransportScrub;
    window.noteKeyboardTransportScrubBegin = noteKeyboardTransportScrubBegin;
    window.queueKeyboardScrubUiUpdate = queueKeyboardScrubUiUpdate;
    window.applyKeyboardTransportScrubStep = applyKeyboardTransportScrubStep;
    window.flushKeyboardTransportScrub = flushKeyboardTransportScrub;
    window.flushKeyboardTransportScrubIfActive = flushKeyboardTransportScrubIfActive;
    window.cancelKeyboardScrubFlushTimer = cancelKeyboardScrubFlushTimer;
    window.applyDiscreteStopNavStep = applyDiscreteStopNavStep;
    window.flushDiscreteStopNav = flushDiscreteStopNav;
    window.flushDiscreteStopNavIfActive = flushDiscreteStopNavIfActive;
    window.cancelDiscreteStopNavTimer = cancelDiscreteStopNavTimer;
    window.isWaveformLaneSeekShortcut = isWaveformLaneSeekShortcut;
})();
