/**
 * events-lifecycle.js — ページライフサイクル（Alt スナップ修飾・pagehide・永続化トリガ）。
 */
    document.addEventListener(
        'keydown',
        (e) => {
            if (
                typeof isGlobalShortcutBlockedForTextInput === 'function' &&
                isGlobalShortcutBlockedForTextInput(e)
            ) {
                return;
            }
            if (matchUserShortcut(e, 'altSnapModifier', { allowRepeat: true }) && typeof setAltKeySnapSuppressed === 'function') {
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
            if (
                typeof isGlobalShortcutBlockedForTextInput === 'function' &&
                isGlobalShortcutBlockedForTextInput(e)
            ) {
                return;
            }
            if (matchUserShortcut(e, 'altSnapModifier', { allowRepeat: true }) && typeof setAltKeySnapSuppressed === 'function') {
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
        if (typeof flushKeyboardTransportScrubIfActive === 'function') {
            flushKeyboardTransportScrubIfActive({ immediate: true });
        }
    });

    window.addEventListener('keyup', (e) => {
        if (
            typeof isGlobalShortcutBlockedForTextInput === 'function' &&
            isGlobalShortcutBlockedForTextInput(e)
        ) {
            return;
        }
        if (typeof handleMarkerKeyup === 'function' && handleMarkerKeyup(e)) {
            return;
        }

        if (
            typeof matchMixLaneVolumeKey === 'function' &&
            matchMixLaneVolumeKey(e, { allowRepeat: true })
        ) {
            if (typeof window.clearExtraTrackVolumeUnityHold === 'function') {
                window.clearExtraTrackVolumeUnityHold();
            }
        }
    });

    function persistOnPageExit() {
        if (typeof haltTransportOnPageExit === 'function') {
            haltTransportOnPageExit();
        }
        writePrefs();
        if (
            typeof isSessionRestoreInProgress === 'function' &&
            isSessionRestoreInProgress()
        ) {
            writeLog('Session: skip persist on exit (restore in progress)');
            return;
        }
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
            if (
                typeof isSessionRestoreInProgress === 'function' &&
                isSessionRestoreInProgress()
            ) {
                writeLog('Session: skip persist (tab hidden during restore)');
                return;
            }
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
            return;
        }
        if (document.visibilityState !== 'visible') return;
        void (async () => {
            try {
                if (typeof whenSessionRestoreIdle === 'function') {
                    await whenSessionRestoreIdle();
                }
            } catch (_) {}
            if (typeof finalizeAllPlaybackRegionsAfterSessionRestore === 'function') {
                try {
                    finalizeAllPlaybackRegionsAfterSessionRestore();
                } catch (_) {}
            } else if (typeof applyPendingPlaybackRegionRestore === 'function') {
                applyPendingPlaybackRegionRestore();
            }
            if (typeof invalidateWaveformViewportHiresSpec === 'function') {
                invalidateWaveformViewportHiresSpec();
            }
            if (typeof flushWaveformVisualRefresh === 'function') {
                flushWaveformVisualRefresh();
            } else {
                if (typeof redrawAllExtraTrackWaveforms === 'function') {
                    redrawAllExtraTrackWaveforms();
                }
                if (typeof drawAudioWaveformCanvas === 'function') {
                    drawAudioWaveformCanvas();
                }
            }
            if (typeof updateAllPlaybackRegionOverlays === 'function') {
                updateAllPlaybackRegionOverlays();
            }
        })();
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

    bindTransportDocPopupLink(transportGuideLink, 'mgaCineAudioGuide', 960, 820);
    bindTransportDocPopupLink(transportShortcutsLink, 'mgaKeyboardShortcuts', 820, 720);

    if (typeof initWaveformFocusRestore === 'function') {
        initWaveformFocusRestore();
    }
