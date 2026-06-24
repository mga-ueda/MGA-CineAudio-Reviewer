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

    function handlePlaybackRegionSelectAllKeydown(e) {
        if (!matchUserShortcut(e, 'regionSelectAll')) return false;
        if (!guardRegionShortcutKeydown(e)) return false;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (typeof markRegionSelectAllSuppressPageSelection === 'function') {
            markRegionSelectAllSuppressPageSelection();
        }
        if (typeof document.getSelection === 'function') {
            const sel = document.getSelection();
            if (sel && sel.rangeCount > 0) sel.removeAllRanges();
        }
        selectAllRegionsOnTargetTrack();
        return true;
    }

    function resolveRegionSelectAtSeekbarEnterAdditive(e) {
        if (!e || e.repeat) return null;
        if (e.ctrlKey || e.metaKey || e.altKey) return null;
        if (e.key !== 'Enter') return null;
        return true;
    }

    function handlePlaybackRegionSelectAtSeekbarKeydown(e) {
        const additive = resolveRegionSelectAtSeekbarEnterAdditive(e);
        if (additive == null) return false;
        if (!guardRegionShortcutKeydown(e)) return false;
        if (
            !selectPlaybackRegionsAtActiveTrackEnter({
                additive: !!additive,
            })
        ) {
            return false;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
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

    function resolveRegionEdgeNudgeTargets() {
        const fromSelection =
            typeof expandRegionSegmentEditTargetsFromSelection === 'function'
                ? expandRegionSegmentEditTargetsFromSelection()
                : [];
        if (fromSelection.length) return fromSelection;
        if (typeof resolveRegionFadeTargets === 'function') {
            return resolveRegionFadeTargets();
        }
        return [];
    }

    function regionEdgeNudgeKeyLabel(kind) {
        const name = kind === 'in' ? 'regionInNudge' : 'regionOutNudge';
        if (
            typeof window.SHORTCUT_HINTS !== 'undefined' &&
            window.SHORTCUT_HINTS[name]
        ) {
            return window.SHORTCUT_HINTS[name];
        }
        if (typeof formatShortcutDef === 'function' && typeof getUserShortcut === 'function') {
            const def = getUserShortcut(name);
            if (def) return formatShortcutDef(def);
        }
        return kind === 'in' ? 'Alt+Shift+I' : 'Alt+Shift+O';
    }

    function notifyRegionEdgeNudgeMiss(kind, reason) {
        const edgeLabel = kind === 'in' ? 'In' : 'Out';
        const keyLabel = regionEdgeNudgeKeyLabel(kind);
        const msg =
            'Region ' +
            edgeLabel +
            ' nudge (' +
            keyLabel +
            '): ' +
            reason;
        if (typeof writeLog === 'function') writeLog(msg);
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Region', edgeLabel + ' nudge', 'error');
        }
    }

    function notifyRegionEdgeNudgeApplied(kind, count, deltaSec) {
        const edgeLabel = kind === 'in' ? 'In' : 'Out';
        const keyLabel = regionEdgeNudgeKeyLabel(kind);
        const ms = Math.round(Math.max(0, Number(deltaSec) || 0) * 1000);
        const amountLabel = '1 beat (' + ms + 'ms)';
        if (typeof writeLog === 'function') {
            writeLog(
                'Region ' +
                    edgeLabel +
                    ' nudge (' +
                    keyLabel +
                    '): ' +
                    (kind === 'in' ? '-' : '+') +
                    amountLabel +
                    ' (' +
                    count +
                    ' region' +
                    (count === 1 ? '' : 's') +
                    ')',
            );
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(
                'Region',
                edgeLabel + ' ' + (kind === 'in' ? '-' : '+') + amountLabel,
                'notice',
            );
        }
    }

    function nudgeSelectedRegionEdges(kind) {
        if (!isRegionEdgeKeyboardNudgeEnabled()) return false;
        const targets = resolveRegionEdgeNudgeTargets();
        if (!targets.length) {
            notifyRegionEdgeNudgeMiss(
                kind,
                'select or hover a region (Ctrl+click)',
            );
            return false;
        }
        if (!regionUndoPaused) requestRegionUndoCapture();
        let anyChanged = false;
        let blockedContinuous = 0;
        let blockedLimit = 0;
        let blockedNoMeter = 0;
        let appliedDeltaSec = NaN;
        const canNudge =
            kind === 'in' ? canNudgeRegionInByKeyboard : canNudgeRegionOutByKeyboard;
        for (let i = 0; i < targets.length; i++) {
            const { slot, segmentIndex } = targets[i];
            const track = { type: 'extra', slot };
            if (!isTrackRegionActive(track)) continue;
            if (!canNudge(track, segmentIndex)) {
                blockedContinuous += 1;
                continue;
            }
            const delta = regionEdgeKeyboardNudgeSecForSegment(
                track,
                segmentIndex,
                kind,
            );
            if (!(Number.isFinite(delta) && delta > 0.00001)) {
                blockedNoMeter += 1;
                continue;
            }
            let changed = false;
            if (kind === 'in') {
                changed = nudgeSegmentRegionInEarlierContentFixed(
                    track,
                    segmentIndex,
                    delta,
                    { skipUndo: true },
                );
            } else if (kind === 'out') {
                changed = nudgeSegmentRegionOutLaterContentFixed(
                    track,
                    segmentIndex,
                    delta,
                    { skipUndo: true },
                );
            }
            if (changed) {
                anyChanged = true;
                appliedDeltaSec = delta;
            } else blockedLimit += 1;
        }
        if (!anyChanged) {
            if (blockedNoMeter > 0 && blockedNoMeter >= targets.length) {
                notifyRegionEdgeNudgeMiss(
                    kind,
                    'set Tempo/Sig (Musical Grid meter) first',
                );
            } else if (blockedContinuous > 0 && blockedContinuous >= targets.length) {
                notifyRegionEdgeNudgeMiss(
                    kind,
                    'region content is continuous at this boundary',
                );
            } else {
                notifyRegionEdgeNudgeMiss(kind, 'already at limit');
            }
            return false;
        }
        notifyRegionEdgeNudgeApplied(kind, targets.length, appliedDeltaSec);
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        return true;
    }

    function handlePlaybackRegionInNudgeKeydown(e) {
        if (!matchUserShortcut(e, 'regionInNudge')) return false;
        if (e.repeat) return false;
        if (!guardRegionShortcutKeydown(e)) return false;
        e.preventDefault();
        nudgeSelectedRegionEdges('in');
        return true;
    }

    function handlePlaybackRegionOutNudgeKeydown(e) {
        if (!matchUserShortcut(e, 'regionOutNudge')) return false;
        if (e.repeat) return false;
        if (!guardRegionShortcutKeydown(e)) return false;
        e.preventDefault();
        nudgeSelectedRegionEdges('out');
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
        if (toggleRegionGroupFromSelection()) {
            e.preventDefault();
            return true;
        }
        if (
            typeof window.handleRegionBarJumpDialogKeydown === 'function' &&
            window.handleRegionBarJumpDialogKeydown(e)
        ) {
            return true;
        }
        return false;
    }

    function handlePlaybackRegionSwapKeydown(e) {
        if (!matchUserShortcut(e, 'regionSwap')) return false;
        if (e.repeat) return false;
        if (!guardRegionShortcutKeydown(e)) return false;
        if (
            typeof getMusicalGridRehearsalFillVisible !== 'function' ||
            !getMusicalGridRehearsalFillVisible()
        ) {
            return false;
        }
        e.preventDefault();
        swapSelectedPlaybackRegions();
        return true;
    }

    function handleRegionSelectionPointerDown(ev, regionHit) {
        if (!ev || !regionHit || !(regionHit.segmentIndex >= 0)) {
            return false;
        }
        if (!(ev.ctrlKey || ev.metaKey)) return false;
        if (
            typeof isVideoLinkedOffsetDragSlot === 'function' &&
            isVideoLinkedOffsetDragSlot(regionHit.slot)
        ) {
            ev.preventDefault();
            ev.stopPropagation();
            if (typeof toggleVideoLinkedRegionSelection === 'function') {
                toggleVideoLinkedRegionSelection(regionHit.segmentIndex);
            }
            return true;
        }
        if (!(regionHit.slot >= 0)) return false;
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
