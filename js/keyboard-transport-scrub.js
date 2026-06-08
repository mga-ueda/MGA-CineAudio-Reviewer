/**
 * keyboard-transport-scrub.js — キーボード ←/→ スクラブ（拡大中は zoom-lite: 位置のみ、離したら描画）。
 */
(function keyboardTransportScrubModule() {
    let keyboardTransportScrubActive = false;
    let keyboardScrubPendingSec = null;
    let keyboardScrubRafId = 0;
    let keyboardScrubResumeAfter = false;
    let keyboardScrubPauseAfter = false;

    function isPageTransportSeek(ev) {
        if (typeof matchUserShortcut !== 'function') return false;
        return (
            matchUserShortcut(ev, 'transportSeekPageUp', { allowRepeat: true }) ||
            matchUserShortcut(ev, 'transportSeekPageDown', { allowRepeat: true }) ||
            matchUserShortcut(ev, 'transportSeekPageUp10', { allowRepeat: true }) ||
            matchUserShortcut(ev, 'transportSeekPageDown10', { allowRepeat: true })
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
     * @param {{ keyboardScrub?: boolean, fromRepeat?: boolean }|undefined} opt
     */
    function isKeyboardScrubLightweight(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!(o.keyboardScrub || keyboardTransportScrubActive)) return false;
        // セッション中は flush まで UI のみ更新（coalesce 確定と競合しない）
        if (keyboardTransportScrubActive) return true;
        return !!(o.fromRepeat || isKeyboardScrubZoomed());
    }

    /** 拡大中は rAF キューで UI のみ更新 */
    function shouldQueueKeyboardScrubUi(opt) {
        return isKeyboardScrubLightweight(opt) && isKeyboardScrubZoomed();
    }

    function beginKeyboardTransportScrub(ev) {
        if (keyboardTransportScrubActive) return;
        const wasActive =
            typeof captureTransportWasActive === 'function' &&
            captureTransportWasActive();
        const oneFrame = isOneFrameTransportArrowSeek(ev);
        const pageSeek = isPageTransportSeek(ev);
        if (wasActive && oneFrame) {
            keyboardScrubPauseAfter = true;
        } else if (wasActive && (pageSeek || !oneFrame)) {
            keyboardScrubResumeAfter = true;
            transportExplicitSeekResumeIntent = true;
            if (typeof pauseTransportBeforeSeek === 'function') {
                pauseTransportBeforeSeek();
            }
        }
        keyboardTransportScrubActive = true;
    }

    function scheduleKeyboardScrubUiFrame() {
        if (keyboardScrubRafId) return;
        keyboardScrubRafId = requestAnimationFrame(() => {
            keyboardScrubRafId = 0;
            if (!keyboardTransportScrubActive) return;
            const x = keyboardScrubPendingSec;
            if (x == null || !Number.isFinite(x)) return;
            if (typeof currentTimeEl !== 'undefined' && currentTimeEl) {
                currentTimeEl.textContent = formatTimecodeForTransport(x);
            }
            if (typeof updateAllWaveformPlayheads === 'function') {
                updateAllWaveformPlayheads({ keyboardScrub: true });
            }
        });
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
        scheduleKeyboardScrubUiFrame();
        return true;
    }

    function refreshTransportAfterKeyboardScrub() {
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (typeof updateTimecodeOverlay === 'function') updateTimecodeOverlay();
        if (typeof scheduleWaveformVisualRefresh === 'function') {
            scheduleWaveformVisualRefresh({ sync: true });
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
        const o = opt && typeof opt === 'object' ? opt : {};
        transportExplicitSeekTargetSec = sec;
        if (!isKeyboardScrubLightweight(o)) {
            if (typeof seekTransportToAndWait === 'function') {
                void seekTransportToAndWait(sec, o);
            }
            return true;
        }
        if (shouldQueueKeyboardScrubUi(o)) {
            queueKeyboardScrubUiUpdate(sec);
        } else if (typeof applyTransportUiImmediate === 'function') {
            applyTransportUiImmediate(sec, { lightweight: true, keyboardScrub: true });
        }
        return true;
    }

    async function flushKeyboardTransportScrub() {
        if (!keyboardTransportScrubActive) return false;
        keyboardTransportScrubActive = false;
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
        let ok = false;
        if (target != null && Number.isFinite(target)) {
            if (typeof applyTransportAtSec === 'function') {
                applyTransportAtSec(target, { markers: true, resumeAfter: false });
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
        }
        refreshTransportAfterKeyboardScrub();
        return ok;
    }

    function flushKeyboardTransportScrubIfActive() {
        if (!keyboardTransportScrubActive) return false;
        void flushKeyboardTransportScrub();
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
    window.isWaveformLaneSeekShortcut = isWaveformLaneSeekShortcut;
})();
