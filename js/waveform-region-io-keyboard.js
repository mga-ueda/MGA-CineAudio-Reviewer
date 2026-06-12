/**
 * waveform-region-io-keyboard.js — リージョン keyboard / 選択 pointer
 */
    function guardRegionShortcutKeydown(e, opt) {
        opt = opt || {};
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }
        if (!opt.allowDuringDrag && regionHandleDragActive) return false;
        if (!opt.allowDuringUndoDrag && regionUndoDragSnap) return false;
        return true;
    }

    function handlePlaybackRegionSplitKeydown(e) {
        if (!isPlaybackRegionSplitKeyEvent(e)) return false;
        if (e.repeat) return false;
        if (suppressInvalidRegionOpNoticeForVideoAudio()) return false;
        const nowMs =
            Number.isFinite(e && e.timeStamp) && e.timeStamp >= 0
                ? e.timeStamp
                : performance.now();
        if (nowMs - lastRegionSplitShortcutAtMs < REGION_SPLIT_SHORTCUT_DEDUP_MS) {
            e.preventDefault();
            return true;
        }
        lastRegionSplitShortcutAtMs = nowMs;
        e.preventDefault();
        splitPlaybackRegionAtTargetSec();
        return true;
    }

    function isPlaybackRegionSplitKeyEvent(e) {
        return matchUserShortcut(e, 'regionSplit');
    }

    function handlePlaybackRegionSlashKeydown(e) {
        return handlePlaybackRegionSplitKeydown(e);
    }

    function handlePlaybackRegionUndoKeydown(e) {
        if (!matchUserShortcut(e, 'regionUndo')) return false;
        if (!guardRegionShortcutKeydown(e)) return false;
        if (!undoPlaybackRegion()) return false;
        e.preventDefault();
        return true;
    }

    function handlePlaybackRegionRedoKeydown(e) {
        if (!matchUserShortcut(e, 'regionRedo')) return false;
        if (!guardRegionShortcutKeydown(e)) return false;
        if (!redoPlaybackRegion()) return false;
        e.preventDefault();
        return true;
    }

    function handlePlaybackRegionDeleteKeydown(e) {
        if (!matchUserShortcut(e, 'regionDelete')) return false;
        if (e.shiftKey) return false;
        if (!guardRegionShortcutKeydown(e)) return false;
        if (typeof window.silentGapDeleteDiagLog === 'function') {
            window.silentGapDeleteDiagLog('keydown/begin', { handler: 'region-delete' });
        }
        if (!deleteRegionSegmentUnderCursor()) {
            if (typeof window.silentGapDeleteDiagLog === 'function') {
                window.silentGapDeleteDiagLog('keydown/miss', { handler: 'region-delete' });
            }
            return false;
        }
        if (typeof window.silentGapDeleteDiagLog === 'function') {
            window.silentGapDeleteDiagLog('keydown/handled', { handler: 'region-delete' });
        }
        e.preventDefault();
        return true;
    }

    function handlePlaybackRegionCopyKeydown(e) {
        if (!e.ctrlKey && !e.metaKey) return false;
        if (!matchUserShortcut(e, 'regionCopy')) return false;
        if (!guardRegionShortcutKeydown(e)) return false;
        e.preventDefault();
        e.stopPropagation();
        copyRegionSegmentUnderCursor();
        return true;
    }

    function handlePlaybackRegionPasteKeydown(e) {
        if (!e.ctrlKey && !e.metaKey) return false;
        if (!matchUserShortcut(e, 'regionPaste')) return false;
        if (!guardRegionShortcutKeydown(e)) return false;
        e.preventDefault();
        e.stopPropagation();
        pasteRegionSegmentToTrackEnd();
        return true;
    }

    function handlePlaybackRegionFadeInKeydown(e) {
        if (!matchUserShortcut(e, 'regionFadeIn')) return false;
        if (e.repeat) return false;
        if (!guardRegionShortcutKeydown(e)) return false;
        if (suppressInvalidRegionOpNoticeForVideoAudio()) return false;
        e.preventDefault();
        applyRegionFadeAtSeekbar('fade-in');
        return true;
    }

    function handlePlaybackRegionFadeOutKeydown(e) {
        if (!matchUserShortcut(e, 'regionFadeOut')) return false;
        if (e.repeat) return false;
        if (!guardRegionShortcutKeydown(e)) return false;
        if (suppressInvalidRegionOpNoticeForVideoAudio()) return false;
        e.preventDefault();
        applyRegionFadeAtSeekbar('fade-out');
        return true;
    }

    function handlePlaybackRegionEscapeKeydown(e) {
        if (!matchUserShortcut(e, 'regionEscape')) return false;
        if (regionHandleDragActive) {
            endRegionHandleDrag({ cancelled: true });
            return true;
        }
        if (getRegionSelectionCount() > 0) {
            clearRegionSelection();
            e.preventDefault();
            return true;
        }
        return false;
    }

    function handlePlaybackRegionGroupKeydown(e) {
        if (!guardRegionShortcutKeydown(e)) return false;
        if (!matchUserShortcut(e, 'regionGroup')) return false;
        if (!toggleRegionGroupFromSelection()) return false;
        e.preventDefault();
        return true;
    }

    function handlePlaybackRegionSwapKeydown(e) {
        if (!matchUserShortcut(e, 'regionSwap')) return false;
        if (e.repeat) return false;
        if (!guardRegionShortcutKeydown(e)) return false;
        if (
            typeof getMusicalGridPhraseFillVisible !== 'function' ||
            !getMusicalGridPhraseFillVisible()
        ) {
            return false;
        }
        e.preventDefault();
        swapSelectedPlaybackRegions();
        return true;
    }

    function handleRegionSelectionPointerDown(ev, regionHit) {
        if (!ev || !regionHit || !(regionHit.slot >= 0) || !(regionHit.segmentIndex >= 0)) {
            return false;
        }
        if (!(ev.ctrlKey || ev.metaKey)) return false;
        ev.preventDefault();
        ev.stopPropagation();
        toggleRegionSelection(regionHit.slot, regionHit.segmentIndex);
        return true;
    }

    function handleSilentGapSelectionPointerDown(ev) {
        if (!ev || ev.button !== 0) return false;
        if (!(ev.ctrlKey || ev.metaKey)) return false;

        const hit =
            typeof resolveSilentGapSelectionAtPointer === 'function'
                ? resolveSilentGapSelectionAtPointer(ev.clientX, ev.clientY)
                : null;
        if (hit) {
            ev.preventDefault();
            ev.stopPropagation();
            toggleSilentGapSelection(hit.slot, hit.gapIndex);
            return true;
        }

        let gapEl = null;
        if (
            typeof findSilentGapElAtPointer === 'function' &&
            Number.isFinite(ev.clientX) &&
            Number.isFinite(ev.clientY)
        ) {
            gapEl = findSilentGapElAtPointer(ev.clientX, ev.clientY);
        }
        if (
            !gapEl &&
            ev.target &&
            ev.target.closest &&
            !ev.target.closest('.audio-waveform-lane__playback-region')
        ) {
            gapEl = ev.target.closest('.audio-waveform-lane__playback-silent-gap');
        }
        if (gapEl) {
            const lane = gapEl.closest('.audio-waveform-lane--extra');
            const m = lane && lane.id ? /^extraAudioLane(\d+)$/.exec(lane.id) : null;
            if (m) {
                const gapIndex = Number(gapEl.dataset.silentGapIndex);
                if (Number.isFinite(gapIndex) && gapIndex >= 0) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    toggleSilentGapSelection(parseInt(m[1], 10), gapIndex);
                    return true;
                }
            }
        }

        if (
            typeof explainSilentGapSelectionAtPointer === 'function' &&
            typeof logSilentGapSelectionDiag === 'function' &&
            Number.isFinite(ev.clientX) &&
            Number.isFinite(ev.clientY) &&
            extraSlotFromPointerY(ev.clientY) >= 0
        ) {
            const diag = explainSilentGapSelectionAtPointer(ev.clientX, ev.clientY);
            logSilentGapSelectionDiag('miss', {
                ...diag,
                target: ev.target && ev.target.className ? String(ev.target.className) : null,
                hadGapEl: !!gapEl,
            });
        }
        return false;
    }

    /** 復元デコード直後: クリップ未揃いでも永続化セグメントを state に載せる（正規化は後） */
