/**
 * undo-history.js — アプリ全体の Undo/Redo 履歴（操作順の単一スタック）
 */
(function appUndoHistoryModule() {
    const undoStack = [];
    const redoStack = [];
    let undoPaused = false;

    function isUndoPaused() {
        return undoPaused;
    }

    function setAppUndoHistoryPaused(value) {
        undoPaused = !!value;
    }

    function entryKindCategory(kind) {
        if (kind === 'region') return 'Region';
        if (kind === 'rehearsal') return 'Rehearsal';
        return 'MusicalGrid';
    }

    function normalizeEntry(entry) {
        const e = {
            kind: entry.kind,
            snap: entry.snap,
            actionLabel: entry.actionLabel != null ? String(entry.actionLabel).trim() : '',
        };
        if (entry.regionSwapAnimHint) {
            e.regionSwapAnimHint = entry.regionSwapAnimHint;
        }
        return e;
    }

    function entriesEqual(a, b) {
        if (!a || !b || a.kind !== b.kind) return false;
        if (a.kind === 'region' && typeof window.regionUndoSnapshotsEqual === 'function') {
            return window.regionUndoSnapshotsEqual(a.snap, b.snap);
        }
        if (a.kind === 'musicalTrack') {
            return JSON.stringify(a.snap) === JSON.stringify(b.snap);
        }
        if (a.kind === 'rehearsal') {
            return a.snap === b.snap;
        }
        return false;
    }

    function captureCurrentEntry(kind) {
        if (kind === 'region' && typeof window.captureRegionUndoSnapshotForHistory === 'function') {
            const snap = window.captureRegionUndoSnapshotForHistory();
            return {
                kind: 'region',
                snap,
                actionLabel: snap && snap.actionLabel ? String(snap.actionLabel) : '',
            };
        }
        if (kind === 'musicalTrack' && typeof window.captureMusicalTrackUndoSnapshot === 'function') {
            return {
                kind: 'musicalTrack',
                snap: window.captureMusicalTrackUndoSnapshot(),
                actionLabel: '',
            };
        }
        if (kind === 'rehearsal' && typeof window.captureRehearsalUndoSnapshot === 'function') {
            return {
                kind: 'rehearsal',
                snap: window.captureRehearsalUndoSnapshot(),
                actionLabel: '',
            };
        }
        return null;
    }

    function getAppUndoStackTop() {
        return undoStack.length ? undoStack[undoStack.length - 1] : null;
    }

    function pushAppUndoEntry(entry, opt) {
        if (isUndoPaused() || !entry || !entry.kind) return;
        const forceCapture = !!(opt && opt.forceCapture);
        const top = getAppUndoStackTop();
        const normalized = normalizeEntry(entry);
        if (!forceCapture && top && entriesEqual(top, normalized)) return;
        undoStack.push(normalized);
        redoStack.length = 0;
    }

    function noteAppUndoActionLabel(label, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const text = label != null ? String(label).trim() : '';
        if (!text || !undoStack.length) return;
        if (o.kind) {
            for (let i = undoStack.length - 1; i >= 0; i--) {
                const entry = undoStack[i];
                if (entry.kind !== o.kind) continue;
                entry.actionLabel = text;
                return;
            }
            return;
        }
        undoStack[undoStack.length - 1].actionLabel = text;
    }

    function clearAppUndoHistory() {
        undoStack.length = 0;
        redoStack.length = 0;
    }

    function pruneAppUndoRegionEntries(filterFn) {
        let removed = 0;
        for (let i = undoStack.length - 1; i >= 0; i--) {
            const entry = undoStack[i];
            if (!entry || entry.kind !== 'region') continue;
            if (filterFn(entry.snap)) continue;
            undoStack.splice(i, 1);
            removed++;
        }
        if (removed > 0) redoStack.length = 0;
        return removed;
    }

    function defaultActionLabel(entry) {
        if (!entry) return '';
        if (entry.kind === 'musicalTrack') return 'musical grid edit';
        if (entry.kind === 'rehearsal') {
            const snap = entry.snap != null ? String(entry.snap) : '';
            return snap ? 'rehearsal ' + snap : 'rehearsal definition';
        }
        return '';
    }

    function logHistoryStep(direction, entry) {
        const category = entryKindCategory(entry.kind);
        const label = entry.actionLabel || defaultActionLabel(entry);
        const msg =
            typeof formatRegionHistoryActionMessage === 'function'
                ? formatRegionHistoryActionMessage(direction, label)
                : label
                  ? direction + ' — ' + label
                  : direction;
        if (typeof actionLog === 'function') {
            actionLog(category, msg);
        } else if (typeof writeActionLog === 'function') {
            writeActionLog(category, msg);
        } else if (typeof writeLog === 'function') {
            writeLog(category + ': ' + msg);
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(category, direction === 'redo' ? 'Redo' : 'Undo', 'notice');
        }
    }

    function dispatchHistoryStep(entry, direction) {
        if (!entry || !entry.kind) return false;
        if (entry.kind === 'region') {
            if (typeof window.dispatchRegionHistoryStep !== 'function') return false;
            return window.dispatchRegionHistoryStep(entry, direction, () => {
                logHistoryStep(direction, entry);
            });
        }
        if (entry.kind === 'musicalTrack') {
            if (typeof window.dispatchMusicalTrackHistoryStep !== 'function') return false;
            window.dispatchMusicalTrackHistoryStep(entry.snap);
            logHistoryStep(direction, entry);
            return true;
        }
        if (entry.kind === 'rehearsal') {
            if (typeof window.dispatchRehearsalHistoryStep !== 'function') return false;
            window.dispatchRehearsalHistoryStep(entry.snap);
            logHistoryStep(direction, entry);
            return true;
        }
        return false;
    }

    function undoAppHistory() {
        if (!undoStack.length) return false;
        const prev = undoStack.pop();
        const current = captureCurrentEntry(prev.kind);
        if (current) {
            if (
                prev.kind === 'region' &&
                typeof window.enrichRegionHistoryRedoEntry === 'function'
            ) {
                window.enrichRegionHistoryRedoEntry(current, prev);
            }
            redoStack.push(current);
        }
        return dispatchHistoryStep(prev, 'undo');
    }

    function redoAppHistory() {
        if (!redoStack.length) return false;
        const next = redoStack.pop();
        const current = captureCurrentEntry(next.kind);
        if (current) undoStack.push(current);
        return dispatchHistoryStep(next, 'redo');
    }

    function isUndoHistoryPaused() {
        return undoPaused;
    }

    function isAppUndoBlocked() {
        if (isUndoHistoryPaused()) return true;
        if (typeof window.isMusicalTrackEditBlockingUndo === 'function') {
            if (window.isMusicalTrackEditBlockingUndo()) return true;
        }
        if (typeof window.isRehearsalBoundaryDragActive === 'function') {
            if (window.isRehearsalBoundaryDragActive()) return true;
        }
        if (typeof regionUndoDragSnap !== 'undefined' && regionUndoDragSnap) return true;
        if (typeof regionHandleDragActive !== 'undefined' && regionHandleDragActive) return true;
        return false;
    }

    function handleAppUndoKeydown(e) {
        if (typeof matchUserShortcut !== 'function' || !matchUserShortcut(e, 'regionUndo')) {
            return false;
        }
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return false;
        if (isAppUndoBlocked()) return false;
        if (typeof guardRegionShortcutKeydown === 'function') {
            if (!guardRegionShortcutKeydown(e, { allowDuringDrag: false, allowDuringUndoDrag: false })) {
                return false;
            }
        }
        if (!undoAppHistory()) return false;
        e.preventDefault();
        return true;
    }

    function handleAppRedoKeydown(e) {
        if (typeof matchUserShortcut !== 'function' || !matchUserShortcut(e, 'regionRedo')) {
            return false;
        }
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return false;
        if (isAppUndoBlocked()) return false;
        if (typeof guardRegionShortcutKeydown === 'function') {
            if (!guardRegionShortcutKeydown(e, { allowDuringDrag: false, allowDuringUndoDrag: false })) {
                return false;
            }
        }
        if (!redoAppHistory()) return false;
        e.preventDefault();
        return true;
    }

    window.pushAppUndoEntry = pushAppUndoEntry;
    window.noteAppUndoActionLabel = noteAppUndoActionLabel;
    window.getAppUndoStackTop = getAppUndoStackTop;
    window.clearAppUndoHistory = clearAppUndoHistory;
    window.clearRegionUndoStack = clearAppUndoHistory;
    window.pruneAppUndoRegionEntries = pruneAppUndoRegionEntries;
    window.setAppUndoHistoryPaused = setAppUndoHistoryPaused;
    window.isUndoHistoryPaused = isUndoHistoryPaused;
    window.undoAppHistory = undoAppHistory;
    window.redoAppHistory = redoAppHistory;
    window.handleAppUndoKeydown = handleAppUndoKeydown;
    window.handleAppRedoKeydown = handleAppRedoKeydown;
})();
