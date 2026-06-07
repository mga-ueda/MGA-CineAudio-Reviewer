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

    function transportArrowSeekStepSec(e) {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey) return 10;
        if (e.shiftKey) return 1;
        return masterFrameSec;
    }

    function transportArrowSeekStepLabel(e) {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey) return 'Ctrl+Shift ±10s';
        if (e.shiftKey) return 'Shift ±1s';
        return 'Frame ±1f';
    }

    function transportArrowSeekResumeAfter(e) {
        if (!e.shiftKey) return false;
        return typeof isTransportPlaying === 'function'
            ? isTransportPlaying()
            : !videoMain.paused;
    }

    function flashTransportArrowSeekHint(dir, e) {
        if (typeof flashSeekHint !== 'function') return;
        const sym = dir > 0 ? '→' : '←';
        let deltaTxt;
        if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
            deltaTxt = dir > 0 ? '+10s' : '−10s';
        } else if (e.shiftKey) {
            deltaTxt = dir > 0 ? '+1s' : '−1s';
        } else {
            deltaTxt = dir > 0 ? '+1f' : '−1f';
        }
        flashSeekHint(sym, deltaTxt);
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

        // 入力欄フォーカス中はグローバルショートカットを抑止し、文字入力を優先する。
        // target 取りこぼし対策として activeElement も併用して判定する。
        // （例: Musical Grid の meter/phrase 入力で Del/Backspace や O/T/P が横取りされないようにする）
        if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;

        if (matchUserShortcut(e, 'transportOptionsToggle')) {
            if (!transportOptionsSection) return;
            e.preventDefault();
            const willHide = !transportOptionsSection.hidden;
            transportOptionsSection.hidden = willHide;
            if (logSection) logSection.hidden = willHide;
            writeLog(
                willHide
                    ? 'Transport options and log: hidden (O)'
                    : 'Transport options and log: shown (O)'
            );
            if (typeof scheduleMarkersUiRefreshAfterLayout === 'function') {
                scheduleMarkersUiRefreshAfterLayout();
            }
            return;
        }

        if (
            typeof handleVideoMarkersPanelsToggleKeydown === 'function' &&
            handleVideoMarkersPanelsToggleKeydown(e)
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

        const isArrowKey =
            matchUserShortcut(e, 'transportSeekArrowLeft', { allowRepeat: true }) ||
            matchUserShortcut(e, 'transportSeekArrowRight', { allowRepeat: true });
        if (e.repeat && !isArrowKey) return;

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

        if (
            matchUserShortcut(e, 'transportSeekArrowLeft', { allowRepeat: true }) ||
            matchUserShortcut(e, 'transportSeekArrowRight', { allowRepeat: true })
        ) {
            if (e.altKey) return;
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey) return;
            const lanesEl =
                typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
            // 波形レーンにフォーカスがあるときは ±1f をレーン側で処理する。
            // Shift+←/→（±1s）と Ctrl+Shift+←/→（±10s）はグローバル側で処理する。
            if (lanesEl && document.activeElement === lanesEl && !e.shiftKey) return;
            if (
                typeof transportControlsReady !== 'function' ||
                !transportControlsReady()
            ) {
                return;
            }
            e.preventDefault();
            const oneFrameStep = !e.shiftKey && !e.ctrlKey && !e.metaKey;
            const playingBeforeStep =
                typeof isTransportPlaying === 'function'
                    ? isTransportPlaying()
                    : !videoMain.paused;
            // 再生中の ±1f は1回だけ（キーリピート無効・keyup 確定も不要）
            if (oneFrameStep && playingBeforeStep && e.repeat) return;
            const useKeyboardScrubSession = !(oneFrameStep && playingBeforeStep);
            if (
                useKeyboardScrubSession &&
                typeof noteKeyboardTransportScrubBegin === 'function'
            ) {
                noteKeyboardTransportScrubBegin(e);
            }
            const dur =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : getDuration(videoMain);
            const dir = matchUserShortcut(e, 'transportSeekArrowRight', { allowRepeat: true }) ? 1 : -1;
            const stepSec = transportArrowSeekStepSec(e);
            const resumeAfter = transportArrowSeekResumeAfter(e);
            let t = (parseFloat(seekBar.value) || 0) + dir * stepSec;
            t = Math.max(0, Math.min(dur - 0.001, t));
            if (
                e.repeat &&
                useKeyboardScrubSession &&
                typeof applyKeyboardTransportScrubStep === 'function'
            ) {
                applyKeyboardTransportScrubStep(t, {
                    keyboardScrub: true,
                    fromRepeat: true,
                    resumeAfter: resumeAfter && !oneFrameStep,
                    pauseAfterSeek: oneFrameStep,
                });
                return;
            }
            if (!e.repeat) {
                flashTransportArrowSeekHint(dir, e);
            }
            const stepLabel = transportArrowSeekStepLabel(e);
            const arrow =
                dir > 0
                    ? (getUserShortcut('transportSeekArrowRight') || {}).code
                    : (getUserShortcut('transportSeekArrowLeft') || {}).code;
            void (async () => {
                if (typeof seekTransportToAndWait === 'function') {
                    await seekTransportToAndWait(t, {
                        resumeAfter: resumeAfter && !oneFrameStep,
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
            })();
        }
    });

    function isTransportSeekArrowKeyup(e) {
        return (
            matchUserShortcut(e, 'transportSeekArrowLeft', { allowRepeat: true }) ||
            matchUserShortcut(e, 'transportSeekArrowRight', { allowRepeat: true })
        );
    }

    window.addEventListener('keyup', (e) => {
        if (!isTransportSeekArrowKeyup(e)) return;
        const lanesEl =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        if (lanesEl && document.activeElement === lanesEl && !e.shiftKey) return;
        if (typeof flushKeyboardTransportScrubIfActive === 'function') {
            flushKeyboardTransportScrubIfActive();
        }
    });
