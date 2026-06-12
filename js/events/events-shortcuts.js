/**
 * events-shortcuts.js — キーボードショートカット（再生・シーク・マーカー・Ex 操作など）。
 */
    function callWindowShortcut(name, e) {
        const fn = window[name];
        return typeof fn === 'function' && fn(e);
    }

    function dispatchShortcutHandlers(specs, e) {
        for (let i = 0; i < specs.length; i++) {
            const spec = specs[i];
            if (typeof spec === 'function') {
                if (spec(e)) return true;
                continue;
            }
            if (callWindowShortcut(spec, e)) return true;
        }
        return false;
    }

    function isTransportSeekArrowEvent(e) {
        return (
            matchUserShortcut(e, 'transportSeekArrowLeft', { allowRepeat: true }) ||
            matchUserShortcut(e, 'transportSeekArrowRight', { allowRepeat: true })
        );
    }

    function isTransportSeekPageEvent(e) {
        return (
            matchUserShortcut(e, 'transportSeekPageUp', { allowRepeat: true }) ||
            matchUserShortcut(e, 'transportSeekPageDown', { allowRepeat: true }) ||
            matchUserShortcut(e, 'transportSeekPageUp10', { allowRepeat: true }) ||
            matchUserShortcut(e, 'transportSeekPageDown10', { allowRepeat: true })
        );
    }

    function isTransportSeekStepEvent(e) {
        return isTransportSeekArrowEvent(e) || isTransportSeekPageEvent(e);
    }

    function transportSeekDirection(e) {
        if (
            matchUserShortcut(e, 'transportSeekArrowRight', { allowRepeat: true }) ||
            matchUserShortcut(e, 'transportSeekPageDown', { allowRepeat: true }) ||
            matchUserShortcut(e, 'transportSeekPageDown10', { allowRepeat: true })
        ) {
            return 1;
        }
        return -1;
    }

    function transportSeekStepSec(e) {
        if (isTransportSeekPageEvent(e)) {
            if (
                matchUserShortcut(e, 'transportSeekPageUp10', { allowRepeat: true }) ||
                matchUserShortcut(e, 'transportSeekPageDown10', { allowRepeat: true })
            ) {
                return 10;
            }
            return 1;
        }
        return masterFrameSec;
    }

    function transportSeekStepLabel(e) {
        if (isTransportSeekPageEvent(e)) {
            if (
                matchUserShortcut(e, 'transportSeekPageUp10', { allowRepeat: true }) ||
                matchUserShortcut(e, 'transportSeekPageDown10', { allowRepeat: true })
            ) {
                return 'Shift PgUp/PgDn ±10s';
            }
            return 'PgUp/PgDn ±1s';
        }
        return 'Frame ±1f';
    }

    function transportSeekResumeAfter(e) {
        if (!isTransportSeekPageEvent(e)) return false;
        return typeof isTransportPlaying === 'function'
            ? isTransportPlaying()
            : !videoMain.paused;
    }

    function transportSeekKeyLabel(e) {
        if (matchUserShortcut(e, 'transportSeekPageUp10', { allowRepeat: true })) return 'PgUp';
        if (matchUserShortcut(e, 'transportSeekPageDown10', { allowRepeat: true })) return 'PgDn';
        if (matchUserShortcut(e, 'transportSeekPageUp', { allowRepeat: true })) return 'PgUp';
        if (matchUserShortcut(e, 'transportSeekPageDown', { allowRepeat: true })) return 'PgDn';
        return transportSeekDirection(e) > 0
            ? (getUserShortcut('transportSeekArrowRight') || {}).code
            : (getUserShortcut('transportSeekArrowLeft') || {}).code;
    }

    function flashTransportSeekHint(dir, e) {
        if (typeof flashSeekHint !== 'function') return;
        const sym = dir > 0 ? '→' : '←';
        let deltaTxt;
        if (isTransportSeekPageEvent(e)) {
            const sec = transportSeekStepSec(e);
            deltaTxt = dir > 0 ? '+' + sec + 's' : '−' + sec + 's';
        } else {
            deltaTxt = dir > 0 ? '+1f' : '−1f';
        }
        flashSeekHint(sym, deltaTxt);
    }

    function isTransportSeekPageExtremeEvent(e) {
        return (
            matchUserShortcut(e, 'transportSeekPageStart') ||
            matchUserShortcut(e, 'transportSeekPageEnd')
        );
    }

    function handleTransportSeekPageExtremeKeydown(e) {
        if (!isTransportSeekPageExtremeEvent(e)) return false;
        if (e.repeat) return true;
        if (
            typeof transportControlsReady !== 'function' ||
            !transportControlsReady()
        ) {
            return true;
        }
        e.preventDefault();
        const dur =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : getDuration(videoMain);
        const toStart = matchUserShortcut(e, 'transportSeekPageStart');
        const target = toStart ? 0 : Math.max(0, dur - 0.001);
        const seekHintTitle = toStart ? 'Start' : 'End';
        const keyLabel = toStart ? 'Ctrl+PgUp' : 'Ctrl+PgDn';
        const wasPlaying =
            typeof isTransportPlaying === 'function'
                ? isTransportPlaying()
                : !videoMain.paused;
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(seekHintTitle, formatTimecodeForTransport(target));
        }
        if (typeof applyDiscreteStopNavStep === 'function') {
            applyDiscreteStopNavStep(target, { resumeAfterSeek: wasPlaying });
            writeLog(
                'Seek keyboard: ' + keyLabel + ' -> ' + formatTimecodeForTransport(target),
            );
            return true;
        }
        void (async () => {
            if (typeof seekTransportToAndWait === 'function') {
                await seekTransportToAndWait(target, { resumeAfter: wasPlaying });
            } else {
                applyTimeToVideo(target);
                currentTimeEl.textContent = formatTimecodeForTransport(target);
                updateTimecodeOverlay();
            }
            writeLog(
                'Seek keyboard: ' + keyLabel + ' -> ' + formatTimecodeForTransport(target),
            );
        })();
        return true;
    }

    window.addEventListener('keydown', (e) => {
        const isCodeInGroup =
            typeof window.isShortcutCodeInGroup === 'function'
                ? window.isShortcutCodeInGroup
                : () => false;
        const getNumpadSeekDigit =
            typeof window.getNumpadSeekDigit === 'function'
                ? window.getNumpadSeekDigit
                : () => null;
        const getRegionBarJumpDigit =
            typeof window.getRegionBarJumpDigit === 'function'
                ? window.getRegionBarJumpDigit
                : typeof window.getShiftSeekDigit === 'function'
                  ? window.getShiftSeekDigit
                  : () => null;
        const isBarJumpShiftHeld =
            typeof window.isBarJumpShiftHeld === 'function'
                ? window.isBarJumpShiftHeld
                : typeof window.isShiftModifierActive === 'function'
                  ? window.isShiftModifierActive
                  : (ev) => !!(ev && ev.shiftKey);
        const isTopRowDigitKeyCode =
            typeof window.isTopRowDigitKeyCode === 'function'
                ? window.isTopRowDigitKeyCode
                : (code) => /^Digit[0-9]$/.test(code || '');
        const isNumpadDigitKeyCode =
            typeof window.isNumpadDigitKeyCode === 'function'
                ? window.isNumpadDigitKeyCode
                : (code) => /^Numpad[0-9]$/.test(code || '');

        // マーカー Comment / Memo 等の入力中は文字・修飾キーを編集優先（U/T/P 等の横取り防止）
        if (
            typeof isGlobalShortcutBlockedForTextInput === 'function' &&
            isGlobalShortcutBlockedForTextInput(e)
        ) {
            return;
        }

        if (matchUserShortcut(e, 'layoutEditToggle')) {
            if (typeof toggleLayoutDockEditMode === 'function') {
                e.preventDefault();
                toggleLayoutDockEditMode();
            }
            return;
        }

        if (matchUserShortcut(e, 'layoutModeToggle')) {
            if (typeof toggleLayoutDockMode === 'function') {
                e.preventDefault();
                toggleLayoutDockMode();
            }
            return;
        }

        if (typeof isOperationBlockingActive === 'function' && isOperationBlockingActive()) {
            if (
                typeof isWebmExportActive === 'function' &&
                isWebmExportActive() &&
                matchUserShortcut(e, 'regionEscape')
            ) {
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
            matchUserShortcut(e, 'musicalGridMeterFocus') &&
            callWindowShortcut('focusMusicalGridMeterEditor', e)
        ) {
            e.preventDefault();
            return;
        }

        if (
            matchUserShortcut(e, 'musicalGridPhraseFocus') &&
            callWindowShortcut('focusMusicalGridPhraseEditor', e)
        ) {
            e.preventDefault();
            return;
        }

        if (
            dispatchShortcutHandlers(
                ['handlePlaybackRegionFadeInKeydown', 'handlePlaybackRegionFadeOutKeydown'],
                e,
            )
        ) {
            return;
        }

        if (
            dispatchShortcutHandlers(
                ['handlePlaybackRegionInNudgeKeydown', 'handlePlaybackRegionOutNudgeKeydown'],
                e,
            )
        ) {
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
            dispatchShortcutHandlers(
                [
                    'handleMusicalGridPhraseUndoKeydown',
                    'handleMusicalGridPhraseRedoKeydown',
                    'handlePlaybackRegionUndoKeydown',
                    'handlePlaybackRegionRedoKeydown',
                    'handlePlaybackRegionCopyKeydown',
                    'handlePlaybackRegionPasteKeydown',
                    'handlePlaybackRegionFadeInKeydown',
                    'handlePlaybackRegionFadeOutKeydown',
                    'handlePlaybackRegionInNudgeKeydown',
                    'handlePlaybackRegionOutNudgeKeydown',
                    'handleMarkerBracketKeydown',
                    (ev) =>
                        callWindowShortcut('handleMusicalGridPhraseSplitKeydown', ev) ||
                        callWindowShortcut('handlePlaybackRegionSplitKeydown', ev) ||
                        callWindowShortcut('handlePlaybackRegionSlashKeydown', ev),
                    'handleMusicalGridPhraseJoinKeydown',
                    'handlePlaybackRegionJoinKeydown',
                    'handlePlaybackRegionGroupKeydown',
                    'handlePlaybackRegionSwapKeydown',
                    'handlePlaybackRegionRehearsalMarkJumpKeydown',
                ],
                e,
            )
        ) {
            return;
        }

        if (
            typeof handleSessionIoShortcutKeydown === 'function' &&
            handleSessionIoShortcutKeydown(e)
        ) {
            return;
        }

        if (
            typeof handleExtraTrackAddShortcutKeydown === 'function' &&
            handleExtraTrackAddShortcutKeydown(e)
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
            typeof handleMetronomeClickShortcutKeydown === 'function' &&
            handleMetronomeClickShortcutKeydown(e)
        ) {
            return;
        }

        if (
            typeof handleAnalyzeShortcutKeydown === 'function' &&
            handleAnalyzeShortcutKeydown(e)
        ) {
            return;
        }

        if (matchUserShortcut(e, 'musicalGridToggle') && callWindowShortcut('toggleMusicalGridVisible', e)) {
            e.preventDefault();
            return;
        }

        if (
            matchUserShortcut(e, 'musicalGridPhraseToggle') &&
            callWindowShortcut('toggleMusicalGridPhraseFillVisible', e)
        ) {
            e.preventDefault();
            return;
        }

        if (
            matchUserShortcut(e, 'rehearsalMarkOffsetToggle') &&
            callWindowShortcut('toggleRehearsalMarkOffset', e)
        ) {
            e.preventDefault();
            return;
        }

        if (
            typeof handleMusicalGridPhraseDeleteKeydown === 'function' &&
            handleMusicalGridPhraseDeleteKeydown(e)
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
            const appKey = isCodeInGroup(e.code, 'scrubStopCodes');
            if (appKey && typeof endAudioWaveformScrub === 'function') endAudioWaveformScrub();
        }
        const waveFocus = audioWaveformLanesTracks || audioWaveformTrack;
        if (waveFocus && document.activeElement === waveFocus) {
            const appKey = isCodeInGroup(e.code, 'scrubStopCodes');
            if (appKey && waveFocus) waveFocus.blur();
        }

        if (
            typeof handlePlaybackRegionMixKeydown === 'function' &&
            handlePlaybackRegionMixKeydown(e)
        ) {
            return;
        }

        const isArrowKey = isTransportSeekArrowEvent(e);
        const isPageSeekKey = isTransportSeekPageEvent(e);
        if (e.repeat && !isArrowKey && !isPageSeekKey) return;

        if (matchUserShortcut(e, 'loopToggle')) {
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

        if (getRegionBarJumpDigit(e) != null) {
            if (callWindowShortcut('handleRegionBarNumberJumpKeydown', e)) {
                return;
            }
            // Shift + 上段数字は小節ジャンプ専用。条件未成立時は % ジャンプへフォールバックしない。
            if (isTopRowDigitKeyCode(e.code) && isBarJumpShiftHeld(e)) {
                e.preventDefault();
                return;
            }
        }

        const seekDigit = getNumpadSeekDigit(e.code);
        const topRowDecileJump =
            seekDigit != null &&
            isTopRowDigitKeyCode(e.code) &&
            !isBarJumpShiftHeld(e);
        const numpadDecileFallback = seekDigit != null && isNumpadDigitKeyCode(e.code);
        if (
            (topRowDecileJump || numpadDecileFallback) &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey
        ) {
            if (e.repeat) return;
            if (
                typeof transportControlsReady !== 'function' ||
                !transportControlsReady()
            ) {
                return;
            }
            e.preventDefault();
            const d = seekDigit;
            const dur =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : getDuration(videoMain);
            const target = Math.max(0, Math.min(dur - 0.001, (d / 10) * dur));
            const seekHintTitle = 'Jump ' + d + '/10';
            const seekLogSuffix = ' (decile ' + d + '/10)';
            const wasPlaying =
                typeof isTransportPlaying === 'function'
                    ? isTransportPlaying()
                    : !videoMain.paused;
            if (typeof flashSeekHint === 'function') {
                flashSeekHint(seekHintTitle, formatTimecodeForTransport(target));
            }
            if (typeof applyDiscreteStopNavStep === 'function') {
                applyDiscreteStopNavStep(target, { resumeAfterSeek: wasPlaying });
                writeLog(
                    'Seek keyboard: ' +
                        d +
                        ' -> ' +
                        formatTimecodeForTransport(target) +
                        seekLogSuffix
                );
                return;
            }
            void (async () => {
                if (typeof seekTransportToAndWait === 'function') {
                    await seekTransportToAndWait(target, { resumeAfter: wasPlaying });
                } else {
                    applyTimeToVideo(target);
                }
                writeLog(
                    'Seek keyboard: ' +
                        d +
                        ' -> ' +
                        formatTimecodeForTransport(target) +
                        seekLogSuffix
                );
            })();
            return;
        }

        if (matchUserShortcut(e, 'replayFromPlaybackStart')) {
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

        if (matchUserShortcut(e, 'prerollPlay')) {
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
            const target = Math.max(0, cur - 3);
            void (async () => {
                if (typeof seekTransportToAndWait === 'function') {
                    await seekTransportToAndWait(target, { resumeAfter: false });
                } else if (typeof applyTimeToVideo === 'function') {
                    applyTimeToVideo(target);
                }
                writeLog(
                    'Keyboard: Ctrl+Space -> preroll play from ' +
                        formatTimecodeForTransport(target)
                );
                if (typeof playTransportAfterKeyboardSeek === 'function') {
                    await playTransportAfterKeyboardSeek();
                } else if (playStopBtn) {
                    playStopBtn.click();
                }
            })();
            return;
        }

        if (matchUserShortcut(e, 'transportToggle')) {
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

        if (handleTransportSeekPageExtremeKeydown(e)) {
            return;
        }

        if (isTransportSeekStepEvent(e)) {
            if (isArrowKey) {
                if (e.altKey || e.shiftKey) return;
                if (e.ctrlKey || e.metaKey) return;
                const lanesEl =
                    typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
                if (lanesEl && document.activeElement === lanesEl) return;
            } else if (isPageSeekKey) {
                if (e.altKey || e.ctrlKey || e.metaKey) return;
            }
            if (
                typeof transportControlsReady !== 'function' ||
                !transportControlsReady()
            ) {
                return;
            }
            e.preventDefault();
            const oneFrameStep = isArrowKey;
            const pageSeekStep = isPageSeekKey;
            const playingBeforeStep =
                typeof isTransportPlaying === 'function'
                    ? isTransportPlaying()
                    : !videoMain.paused;
            if (oneFrameStep && playingBeforeStep && e.repeat) return;
            const dur =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : getDuration(videoMain);
            const dir = transportSeekDirection(e);
            const stepSec = transportSeekStepSec(e);
            const resumeAfter = pageSeekStep
                ? false
                : transportSeekResumeAfter(e);
            const baseSec =
                typeof getTransportSec === 'function'
                    ? getTransportSec()
                    : parseFloat(seekBar.value) || 0;
            let t = baseSec + dir * stepSec;
            t = Math.max(0, Math.min(dur - 0.001, t));
            if (pageSeekStep && typeof applyDiscreteStopNavStep === 'function') {
                applyDiscreteStopNavStep(t, {
                    resumeAfterSeek: playingBeforeStep,
                    fromRepeat: e.repeat,
                });
                if (!e.repeat) {
                    flashTransportSeekHint(dir, e);
                    writeLog(
                        'Seek keyboard: ' +
                            transportSeekKeyLabel(e) +
                            ' (' +
                            transportSeekStepLabel(e) +
                            ') -> ' +
                            formatTimecodeForTransport(t),
                    );
                }
                return;
            }
            const useKeyboardScrubSession =
                isArrowKey && !(oneFrameStep && playingBeforeStep);
            if (useKeyboardScrubSession) {
                if (typeof cancelKeyboardScrubFlushTimer === 'function') {
                    cancelKeyboardScrubFlushTimer();
                }
                if (
                    typeof isKeyboardTransportScrubActive === 'function' &&
                    !isKeyboardTransportScrubActive() &&
                    typeof beginKeyboardTransportScrub === 'function'
                ) {
                    beginKeyboardTransportScrub(e);
                }
            }
            if (useKeyboardScrubSession && typeof applyKeyboardTransportScrubStep === 'function') {
                applyKeyboardTransportScrubStep(t, {
                    keyboardScrub: true,
                    fromRepeat: e.repeat,
                    resumeAfter: resumeAfter && !oneFrameStep,
                    pauseAfterSeek: oneFrameStep,
                });
                if (!e.repeat) {
                    flashTransportSeekHint(dir, e);
                }
                return;
            }
            if (!e.repeat) {
                flashTransportSeekHint(dir, e);
            }
            const stepLabel = transportSeekStepLabel(e);
            const keyLabel = transportSeekKeyLabel(e);
            void (async () => {
                if (typeof seekTransportToAndWait === 'function') {
                    await seekTransportToAndWait(t, {
                        resumeAfter: pageSeekStep
                            ? false
                            : resumeAfter && !oneFrameStep,
                        pauseAfterSeek: oneFrameStep,
                        keyboardScrub: useKeyboardScrubSession,
                        fromRepeat: e.repeat,
                    });
                } else {
                    applyTimeToVideo(t);
                    currentTimeEl.textContent = formatTimecodeForTransport(t);
                    updateTimecodeOverlay();
                }
                const line =
                    'Seek keyboard: ' +
                    keyLabel +
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
            })();
            return;
        }
    });

    function isMarkerStopJumpKeyup(e) {
        if (!e || e.altKey || e.shiftKey) return false;
        return (
            matchUserShortcut(e, 'markerStopJumpPrev', { allowRepeat: true }) ||
            matchUserShortcut(e, 'markerStopJumpNext', { allowRepeat: true })
        );
    }

    function isTransportSeekStepKeyup(e) {
        return isTransportSeekStepEvent(e);
    }

    window.addEventListener('keyup', (e) => {
        if (isMarkerStopJumpKeyup(e)) {
            if (typeof flushDiscreteStopNavIfActive === 'function') {
                flushDiscreteStopNavIfActive({ immediate: true });
            }
            return;
        }
        if (isTransportSeekPageEvent(e)) {
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            if (typeof flushDiscreteStopNavIfActive === 'function') {
                flushDiscreteStopNavIfActive({ immediate: true });
            }
            return;
        }
        if (!isTransportSeekStepKeyup(e)) return;
        if (isTransportSeekArrowEvent(e)) {
            const lanesEl =
                typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
            if (lanesEl && document.activeElement === lanesEl) return;
        }
        if (typeof flushKeyboardTransportScrubIfActive === 'function') {
            flushKeyboardTransportScrubIfActive();
        }
    });
