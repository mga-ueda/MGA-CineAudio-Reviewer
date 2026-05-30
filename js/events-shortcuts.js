/**
 * events-shortcuts.js — キーボードショートカット（再生・シーク・マーカー・Ex 操作など）。
 */
    window.addEventListener('keydown', (e) => {
        const isCodeInGroup =
            typeof window.isShortcutCodeInGroup === 'function'
                ? window.isShortcutCodeInGroup
                : () => false;
        const getNumpadSeekDigit =
            typeof window.getNumpadSeekDigit === 'function'
                ? window.getNumpadSeekDigit
                : () => null;
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

        if (
            typeof handlePlaybackRegionGroupKeydown === 'function' &&
            handlePlaybackRegionGroupKeydown(e)
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

        if (
            matchUserShortcut(e, 'musicalGridToggle') &&
            typeof toggleMusicalGridVisible === 'function'
        ) {
            e.preventDefault();
            toggleMusicalGridVisible();
            return;
        }

        if (
            matchUserShortcut(e, 'musicalGridPhraseToggle') &&
            typeof toggleMusicalGridPhraseFillVisible === 'function'
        ) {
            e.preventDefault();
            toggleMusicalGridPhraseFillVisible();
            return;
        }

        if (
            matchUserShortcut(e, 'playheadCenterLockToggle') &&
            typeof togglePlayheadCenterLock === 'function'
        ) {
            if (
                typeof isWaveformTimelineInteractionReady === 'function' &&
                !isWaveformTimelineInteractionReady()
            ) {
                return;
            }
            e.preventDefault();
            togglePlayheadCenterLock();
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

        const numpadDigit = getNumpadSeekDigit(e.code);
        if (numpadDigit != null) {
            if (e.repeat) return;
            if (
                typeof transportControlsReady !== 'function' ||
                !transportControlsReady()
            ) {
                return;
            }
            e.preventDefault();
            const d = numpadDigit;
            const dur =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : getDuration(videoMain);
            const phraseTintActive =
                typeof getMusicalGridPhraseFillVisible === 'function' &&
                getMusicalGridPhraseFillVisible() &&
                typeof getPhraseGroupRangesSnapshot === 'function' &&
                getPhraseGroupRangesSnapshot().length > 0;
            let target = null;
            let seekHintTitle = 'Jump ' + d + '/10';
            let seekLogSuffix = ' (decile ' + d + '/10)';
            if (phraseTintActive && typeof resolveMusicalGridNumpadSeekSec === 'function') {
                const phraseSec = resolveMusicalGridNumpadSeekSec(d);
                if (phraseSec == null || !Number.isFinite(phraseSec)) {
                    return;
                }
                target = Math.max(0, Math.min(dur - 0.001, phraseSec));
                seekHintTitle = 'Phrase ' + d;
                seekLogSuffix = ' (phrase ' + d + ')';
            } else if (!phraseTintActive) {
                target = Math.max(0, Math.min(dur - 0.001, (d / 10) * dur));
            } else {
                return;
            }
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
                writeLog(
                    'Seek keyboard: Numpad ' +
                        d +
                        ' -> ' +
                        formatTimecodeForTransport(target) +
                        seekLogSuffix
                );
                flashSeekHint(seekHintTitle, formatTimecodeForTransport(target));
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
            const target = Math.max(0, cur - 1);
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
            const dir = matchUserShortcut(e, 'transportSeekArrowRight', { allowRepeat: true }) ? 1 : -1;
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
                const arrow =
                    dir > 0 ? (getUserShortcut('transportSeekArrowRight') || {}).code : (getUserShortcut('transportSeekArrowLeft') || {}).code;
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
