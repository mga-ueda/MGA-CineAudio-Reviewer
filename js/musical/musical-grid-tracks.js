/**
 * musical-grid-tracks.js — Tempo / Signature トラック（波形最上部）の表示・編集・小節グリッド
 */
(function musicalGridTracksModule() {
    const MUSICAL_TRACK_LANE_COUNT = 4;
    let activeEdit = null;
    let tempoBoundaryDragActive = false;
    let tempoBoundaryDragPointerId = null;
    let tempoBoundaryDragEventIndex = -1;
    let tempoBoundaryDragStartSec = 0;
    let tempoBoundaryDragStartClientX = 0;
    let tempoBoundaryDragEvents = null;
    let tempoBoundaryDragDocMove = null;
    let tempoBoundaryDragDocUp = null;
    let tempoTrackDblClickBound = false;
    let sigBoundaryDragActive = false;
    let sigBoundaryDragPointerId = null;
    let sigBoundaryDragEventIndex = -1;
    let sigBoundaryDragEvents = null;
    let sigBoundaryDragDocMove = null;
    let sigBoundaryDragDocUp = null;
    let signatureTrackDblClickBound = false;
    let selectedTrackEvent = null;
    let musicalTrackUndoStack = [];
    let musicalTrackRedoStack = [];
    let musicalTrackUndoPaused = false;
    let tempoBoundaryDragDidMove = false;
    let trackDragUndoSnap = null;
    let sigBoundaryDragDidMove = false;
    let sigBoundaryDragLastSec = NaN;
    const TRACK_VALUE_DRAG_SLOP_PX = 8;
    const MUSICAL_TRACK_EDIT_BLUR_GRACE_MS = 300;
    let musicalTrackEditOpenedAt = 0;
    let tempoValuePointerState = null;
    let tempoValuePointerDocMove = null;
    let tempoValuePointerDocUp = null;
    let sigValuePointerState = null;
    let sigValuePointerDocMove = null;
    let sigValuePointerDocUp = null;

    function captureMusicalTrackUndoSnapshot() {
        if (typeof getMusicalGridPersistSnapshot === 'function') {
            return getMusicalGridPersistSnapshot();
        }
        return null;
    }

    function musicalTrackSnapshotsEqual(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    function requestMusicalTrackUndoCapture() {
        if (musicalTrackUndoPaused) return;
        const snap = captureMusicalTrackUndoSnapshot();
        if (!snap) return;
        const top = musicalTrackUndoStack.length
            ? musicalTrackUndoStack[musicalTrackUndoStack.length - 1]
            : null;
        if (top && musicalTrackSnapshotsEqual(top, snap)) return;
        musicalTrackUndoStack.push(snap);
        musicalTrackRedoStack.length = 0;
    }

    function beginMusicalTrackUndoGesture() {
        if (musicalTrackUndoPaused) return;
        trackDragUndoSnap = captureMusicalTrackUndoSnapshot();
    }

    function commitMusicalTrackUndoGesture() {
        if (musicalTrackUndoPaused || !trackDragUndoSnap) return;
        const current = captureMusicalTrackUndoSnapshot();
        if (!musicalTrackSnapshotsEqual(trackDragUndoSnap, current)) {
            musicalTrackUndoStack.push(trackDragUndoSnap);
            musicalTrackRedoStack.length = 0;
        }
        trackDragUndoSnap = null;
    }

    function cancelMusicalTrackUndoGesture() {
        trackDragUndoSnap = null;
    }

    function restoreMusicalTrackUndoSnapshot(snap) {
        if (!snap || typeof applyMusicalGridPersistSnapshot !== 'function') return;
        musicalTrackUndoPaused = true;
        selectedTrackEvent = null;
        cancelMusicalTrackEdit();
        if (typeof clearRehearsalTrackOnMusicalUndoRestore === 'function') {
            clearRehearsalTrackOnMusicalUndoRestore();
        }
        applyMusicalGridPersistSnapshot(snap);
        if (typeof scheduleMusicalGridRedraw === 'function') {
            scheduleMusicalGridRedraw();
        } else {
            refreshMusicalGridTracks();
        }
        musicalTrackUndoPaused = false;
    }

    function undoMusicalTrackEdit() {
        if (!musicalTrackUndoStack.length) return false;
        const current = captureMusicalTrackUndoSnapshot();
        const prev = musicalTrackUndoStack.pop();
        if (current) musicalTrackRedoStack.push(current);
        restoreMusicalTrackUndoSnapshot(prev);
        return true;
    }

    function redoMusicalTrackEdit() {
        if (!musicalTrackRedoStack.length) return false;
        const current = captureMusicalTrackUndoSnapshot();
        const next = musicalTrackRedoStack.pop();
        if (current) musicalTrackUndoStack.push(current);
        restoreMusicalTrackUndoSnapshot(next);
        return true;
    }

    function handleMusicalTrackUndoKeydown(e) {
        if (typeof matchUserShortcut !== 'function' || !matchUserShortcut(e, 'regionUndo')) {
            return false;
        }
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return false;
        if (activeEdit) return false;
        if (tempoBoundaryDragActive || sigBoundaryDragActive) return false;
        if (typeof isRehearsalBoundaryDragActive === 'function' && isRehearsalBoundaryDragActive()) {
            return false;
        }
        if (!undoMusicalTrackEdit()) return false;
        e.preventDefault();
        return true;
    }

    function handleMusicalTrackRedoKeydown(e) {
        if (typeof matchUserShortcut !== 'function' || !matchUserShortcut(e, 'regionRedo')) {
            return false;
        }
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return false;
        if (activeEdit) return false;
        if (tempoBoundaryDragActive || sigBoundaryDragActive) return false;
        if (typeof isRehearsalBoundaryDragActive === 'function' && isRehearsalBoundaryDragActive()) {
            return false;
        }
        if (!redoMusicalTrackEdit()) return false;
        e.preventDefault();
        return true;
    }

    function handleMusicalTrackDeleteKeydown(e) {
        if (typeof matchUserShortcut !== 'function' || !matchUserShortcut(e, 'regionDelete')) {
            return false;
        }
        if (e.shiftKey) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return false;
        if (activeEdit) return false;
        if (typeof isRehearsalTrackEditActive === 'function' && isRehearsalTrackEditActive()) {
            return false;
        }
        if (tempoBoundaryDragActive || sigBoundaryDragActive) return false;
        if (typeof isRehearsalBoundaryDragActive === 'function' && isRehearsalBoundaryDragActive()) {
            return false;
        }
        if (!selectedTrackEvent) return false;
        if (selectedTrackEvent.field === 'rehearsal') {
            if (selectedTrackEvent.eventIndex < 0) return false;
        } else if (selectedTrackEvent.eventIndex < 1) {
            return false;
        }
        if (deleteSelectedTrackEvent()) {
            e.preventDefault();
            return true;
        }
        return false;
    }

    function selectTrackEvent(field, eventIndex) {
        selectedTrackEvent = { field: field, eventIndex: eventIndex | 0 };
        if (typeof syncRehearsalSelectionFromMusicalTrack === 'function') {
            syncRehearsalSelectionFromMusicalTrack(field, eventIndex);
        }
        syncTrackEventSelectionUi();
    }

    function clearTrackEventSelection() {
        if (!selectedTrackEvent) return;
        selectedTrackEvent = null;
        if (typeof syncRehearsalSelectionFromMusicalTrack === 'function') {
            syncRehearsalSelectionFromMusicalTrack('', -1);
        }
        syncTrackEventSelectionUi();
    }

    function syncTrackEventSelectionUi() {
        const mark = (container) => {
            if (!container) return;
            const nodes = container.querySelectorAll('.musical-track-lane__segment--selected');
            for (let i = 0; i < nodes.length; i++) {
                nodes[i].classList.remove('musical-track-lane__segment--selected');
            }
        };
        mark(musicalTempoSegments);
        mark(musicalSignatureSegments);
        mark(musicalRehearsalSegments);
        if (!selectedTrackEvent) return;
        const container =
            selectedTrackEvent.field === 'tempo'
                ? musicalTempoSegments
                : selectedTrackEvent.field === 'rehearsal'
                  ? musicalRehearsalSegments
                  : musicalSignatureSegments;
        if (!container) return;
        const el = container.querySelector(
            '[data-event-index="' + selectedTrackEvent.eventIndex + '"]',
        );
        if (el) el.classList.add('musical-track-lane__segment--selected');
    }

    function deleteTempoEventAtIndex(eventIndex, meterSpec, durationSec, opt) {
        if (eventIndex < 1) return false;
        const events =
            typeof getTempoTrackEvents === 'function'
                ? getTempoTrackEvents(meterSpec, durationSec).slice()
                : [];
        if (eventIndex < 1 || eventIndex >= events.length) return false;
        events.splice(eventIndex, 1);
        persistTempoTrackEvents(events, meterSpec, durationSec, opt);
        return true;
    }

    function deleteSignatureEventAtIndex(eventIndex, meterSpec, durationSec, opt) {
        if (eventIndex < 1) return false;
        const events =
            typeof getSignatureTrackEvents === 'function'
                ? getSignatureTrackEvents(meterSpec, durationSec).slice()
                : [];
        if (eventIndex < 1 || eventIndex >= events.length) return false;
        events.splice(eventIndex, 1);
        persistSignatureTrackEvents(events, meterSpec, durationSec, opt);
        return true;
    }

    function deleteSelectedTrackEvent() {
        if (!selectedTrackEvent) return false;
        if (selectedTrackEvent.field !== 'rehearsal' && selectedTrackEvent.eventIndex < 1) {
            return false;
        }
        if (selectedTrackEvent.field === 'rehearsal' && selectedTrackEvent.eventIndex < 0) {
            return false;
        }
        if (selectedTrackEvent.field === 'rehearsal') {
            if (typeof deleteSelectedRehearsalTrackEvent === 'function') {
                const ok = deleteSelectedRehearsalTrackEvent();
                if (ok) clearTrackEventSelection();
                return ok;
            }
            return false;
        }
        const settings =
            typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!settings || !settings.meterSpec || !(master > 0)) return false;
        requestMusicalTrackUndoCapture();
        let ok = false;
        if (selectedTrackEvent.field === 'tempo') {
            ok = deleteTempoEventAtIndex(
                selectedTrackEvent.eventIndex,
                settings.meterSpec,
                master,
                { skipUndo: true },
            );
        } else if (selectedTrackEvent.field === 'signature') {
            ok = deleteSignatureEventAtIndex(
                selectedTrackEvent.eventIndex,
                settings.meterSpec,
                master,
                { skipUndo: true },
            );
        }
        if (ok) {
            clearTrackEventSelection();
            refreshMusicalGridTracks();
        }
        return ok;
    }

    function getMusicalTrackLaneCount() {
        if (
            typeof getMusicalGridVisible === 'function' &&
            !getMusicalGridVisible()
        ) {
            return 0;
        }
        return MUSICAL_TRACK_LANE_COUNT;
    }

    function getWaveformAudioLaneCount() {
        let count = 0;
        const videoVizMetaEl =
            typeof videoVizMeta !== 'undefined' ? videoVizMeta : null;
        if (videoVizMetaEl && !videoVizMetaEl.hidden) count += 1;
        const videoMeta =
            typeof audioWaveformPanel !== 'undefined' ? audioWaveformPanel : null;
        if (videoMeta && !videoMeta.hidden) count += 1;
        const n = typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        for (let slot = 0; slot < n; slot++) {
            const meta = document.getElementById('extraAudioMeta' + slot);
            if (meta && !meta.hidden) count += 1;
        }
        return Math.max(1, count);
    }

    function getTotalTimelineLaneCount() {
        return getMusicalTrackLaneCount() + getWaveformAudioLaneCount();
    }

    function markMusicalTrackEditOpened() {
        musicalTrackEditOpenedAt = performance.now();
    }

    function shouldIgnoreMusicalTrackEditBlur() {
        return performance.now() - musicalTrackEditOpenedAt < MUSICAL_TRACK_EDIT_BLUR_GRACE_MS;
    }

    function isMusicalTrackEditInputActive(opt) {
        const inField = (el) => {
            if (!el || el.nodeType !== 1 || !el.closest) return false;
            return (
                !!el.closest('.musical-track-lane__add-input-wrap') ||
                !!el.closest('.musical-track-lane__segment-input')
            );
        };
        if (inField(opt && opt.target)) return true;
        return inField(document.activeElement);
    }

    function focusMusicalTrackEditInput(input, opt) {
        if (!input) return;
        const o = opt && typeof opt === 'object' ? opt : {};
        const applyCaret = () => {
            if (!input.isConnected) return;
            if (o.selectAll) {
                input.select();
                return;
            }
            if (o.caretAtStart) {
                if (typeof input.setSelectionRange === 'function') {
                    input.setSelectionRange(0, 0);
                }
                return;
            }
            const len = String(input.value || '').length;
            if (typeof input.setSelectionRange === 'function') {
                input.setSelectionRange(len, len);
            }
        };
        const run = () => {
            if (!input.isConnected) return;
            try {
                input.focus({ preventScroll: true });
            } catch (_e) {
                input.focus();
            }
            applyCaret();
        };
        run();
        window.setTimeout(run, 0);
    }

    function bindMusicalTrackEditInput(input, opt) {
        if (!input || input.dataset.musicalTrackImeBound === '1') return;
        input.dataset.musicalTrackImeBound = '1';
        const o = opt && typeof opt === 'object' ? opt : {};
        input.lang = 'en';
        input.setAttribute('lang', 'en');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('inputmode', o.inputmode || 'latin');
        input.addEventListener('keydown', (e) => {
            if (typeof o.onKeydown !== 'function') return;
            if (o.onKeydown(e)) e.preventDefault();
        });
        if (o.signatureAutoComplete) {
            input.addEventListener('input', onSignatureTrackInputMaybeAutoComplete);
        }
    }

    function bindMusicalTrackValueEditGesture(valueEl, openEditFn) {
        let openPending = false;
        const scheduleOpenEdit = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (openPending) return;
            openPending = true;
            const ev = e;
            window.setTimeout(() => {
                openPending = false;
                openEditFn(ev);
            }, 0);
        };
        valueEl.addEventListener('dblclick', scheduleOpenEdit);
        valueEl.addEventListener('click', (e) => {
            if (e.detail < 2) return;
            scheduleOpenEdit(e);
        });
    }

    function attachMusicalTrackEditBlurHandler(input, onCommit) {
        input.addEventListener('blur', () => {
            window.setTimeout(() => {
                if (shouldIgnoreMusicalTrackEditBlur()) return;
                onCommit();
            }, 0);
        });
    }

    function transportSecFromMusicalTrackPointer(clientX) {
        if (!Number.isFinite(clientX)) return NaN;
        if (typeof transportSecFromClientX === 'function') {
            return transportSecFromClientX(clientX);
        }
        return NaN;
    }

    function cancelMusicalTrackEdit() {
        if (!activeEdit) return;
        if (activeEdit.hostEl && activeEdit.hostEl.parentElement) {
            activeEdit.hostEl.remove();
        } else if (activeEdit.input && activeEdit.input.parentElement) {
            activeEdit.input.parentElement.remove();
        }
        if (activeEdit.trackEl) {
            activeEdit.trackEl.classList.remove('musical-track-lane__track--add-input-open');
        }
        activeEdit = null;
    }

    function bumpTempoTrackInputValue(input, delta) {
        if (!input) return;
        const raw = String(input.value || '').trim();
        let bpm = Number(raw);
        if (!Number.isFinite(bpm)) bpm = 120;
        bpm = Math.max(1, Math.min(999, Math.round(bpm + delta)));
        input.value =
            typeof formatBpmForMeter === 'function' ? formatBpmForMeter(bpm) : String(bpm);
        const len = input.value.length;
        if (typeof input.setSelectionRange === 'function') {
            input.setSelectionRange(len, len);
        }
    }

    function signatureFieldAtCaret(raw, caret) {
        const text = String(raw == null ? '' : raw);
        const pos = Math.max(0, Math.min(text.length, caret | 0));
        const delim =
            typeof meterSigPartDelimiter === 'function'
                ? meterSigPartDelimiter(text)
                : text.indexOf(':') >= 0
                  ? ':'
                  : text.indexOf('+') >= 0
                    ? '+'
                    : null;
        let segIdx = 0;
        let segStart = 0;
        const parts = delim ? text.split(delim) : [text];
        if (delim) {
            let acc = 0;
            for (let i = 0; i < parts.length; i++) {
                const end = acc + parts[i].length;
                if (pos <= end || i === parts.length - 1) {
                    segIdx = i;
                    segStart = acc;
                    break;
                }
                acc = end + delim.length;
            }
        }
        const segText = parts[segIdx] != null ? parts[segIdx] : text;
        const relInSeg = pos - segStart;
        const slash = segText.indexOf('/');
        if (slash < 0) return { field: 'num', segIdx: segIdx };
        if (relInSeg <= slash) return { field: 'num', segIdx: segIdx };
        return { field: 'den', segIdx: segIdx };
    }

    function caretPosForSignatureField(text, field, segIdx) {
        const delim =
            typeof meterSigPartDelimiter === 'function'
                ? meterSigPartDelimiter(text)
                : text.indexOf(':') >= 0
                  ? ':'
                  : text.indexOf('+') >= 0
                    ? '+'
                    : null;
        const parts = delim ? text.split(delim) : [text];
        const idx = Math.max(0, Math.min(parts.length - 1, segIdx | 0));
        let segStart = 0;
        for (let i = 0; i < idx; i++) {
            segStart += parts[i].length + (delim ? delim.length : 0);
        }
        const segText = parts[idx] || '4/4';
        const slash = segText.indexOf('/');
        if (field === 'num') return segStart;
        return segStart + (slash >= 0 ? slash + 1 : 1);
    }

    function maybeAutoCompleteSignatureTrailingDelimiter(input) {
        const hasTrailing =
            typeof meterSigPartHasTrailingDelimiter === 'function' &&
            meterSigPartHasTrailingDelimiter(input.value);
        if (!hasTrailing) return;
        const raw = String(input.value || '');
        const sig =
            typeof resolveMeterSigForBump === 'function' ? resolveMeterSigForBump(raw) : null;
        if (!sig || typeof formatMeterSigText !== 'function') return;
        const nextText = formatMeterSigText(sig);
        if (!nextText || nextText === raw) return;
        const delim =
            typeof meterSigPartDelimiter === 'function'
                ? meterSigPartDelimiter(raw) || '+'
                : /:\s*$/.test(raw)
                  ? ':'
                  : '+';
        const delimPos = raw.lastIndexOf(delim);
        input.value = nextText;
        const pos = delimPos >= 0 ? delimPos + delim.length : nextText.length;
        if (typeof input.setSelectionRange === 'function') {
            input.setSelectionRange(pos, pos);
        }
    }

    function onSignatureTrackInputMaybeAutoComplete(e) {
        const input = e && e.target;
        if (!input || !activeEdit || activeEdit.field !== 'signature' || activeEdit.input !== input) {
            return;
        }
        maybeAutoCompleteSignatureTrailingDelimiter(input);
    }

    function bumpSignatureTrackInputValue(input, dir, stepSize) {
        if (!input) return;
        const raw = input.value;
        const caret = input.selectionStart != null ? input.selectionStart : raw.length;
        let sig =
            typeof resolveMeterSigForBump === 'function'
                ? resolveMeterSigForBump(raw)
                : typeof parseMeterSigPart === 'function'
                  ? parseMeterSigPart(raw)
                  : null;
        if (!sig) {
            sig =
                typeof cloneMeterSig === 'function'
                    ? cloneMeterSig({ num: 4, den: 4 })
                    : { num: 4, den: 4 };
        } else if (typeof cloneMeterSig === 'function') {
            sig = cloneMeterSig(sig);
        }
        const loc = signatureFieldAtCaret(raw, caret);
        const mag = Math.max(1, Math.abs(stepSize != null ? stepSize : 1));
        const step = (dir > 0 ? 1 : -1) * mag;
        if (typeof bumpMeterSigField === 'function') {
            bumpMeterSigField(sig, loc.field, step, loc.segIdx);
        } else if (typeof clampMeterSigPart === 'function') {
            if (loc.field === 'num') {
                sig.num = clampMeterSigPart((sig.num || 4) + step);
            } else {
                sig.den = clampMeterSigPart((sig.den || 4) + step);
            }
        }
        const nextText =
            typeof formatMeterSigText === 'function' ? formatMeterSigText(sig) : '4/4';
        input.value = nextText;
        const pos = caretPosForSignatureField(nextText, loc.field, loc.segIdx);
        if (typeof input.setSelectionRange === 'function') {
            input.setSelectionRange(pos, pos);
        }
    }

    function onMusicalTrackAddInputKeydown(e, field) {
        if (e.key === 'Enter') {
            if (field === 'tempo') commitTempoTrackEdit();
            else commitSignatureTrackEdit();
            return true;
        }
        if (e.key === 'Escape') {
            cancelMusicalTrackEdit();
            refreshMusicalGridTracks();
            return true;
        }
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
        if (e.altKey || e.ctrlKey || e.metaKey) return false;
        const dir = e.key === 'ArrowUp' ? 1 : -1;
        const input = e.target;
        const shift =
            typeof isShiftModifierActive === 'function' ? isShiftModifierActive(e) : e.shiftKey;
        const step = shift ? 10 : 1;
        if (field === 'tempo') {
            bumpTempoTrackInputValue(input, step * dir);
            applyTempoTrackEditLive();
            return true;
        }
        bumpSignatureTrackInputValue(input, dir, step);
        applySignatureTrackEditLive();
        return true;
    }

    function positionMusicalTrackAddInputWrap(wrap, ev) {
        wrap.style.position = 'fixed';
        document.body.appendChild(wrap);
        const w = wrap.offsetWidth || 60;
        const h = wrap.offsetHeight || 20;
        let left = ev.clientX - w * 0.35;
        let top = ev.clientY + 4;
        left = Math.max(4, Math.min(window.innerWidth - w - 4, left));
        top = Math.max(4, Math.min(window.innerHeight - h - 4, top));
        wrap.style.left = Math.round(left) + 'px';
        wrap.style.top = Math.round(top) + 'px';
    }

    function showMusicalTrackAddInput(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        cancelMusicalTrackEdit();
        const trackEl = o.trackEl;
        const ev = o.ev;
        const field = o.field;
        const editState = o.editState;
        if (!trackEl || !ev || !editState) return;
        const wrap = document.createElement('div');
        wrap.className =
            'musical-track-lane__add-input-wrap' +
            (field === 'signature' ? ' musical-track-lane__add-input-wrap--signature' : '');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'musical-track-lane__add-input';
        input.value = o.initialValue != null ? String(o.initialValue) : '';
        bindMusicalTrackEditInput(input, {
            inputmode: field === 'tempo' ? 'decimal' : 'latin',
            signatureAutoComplete: field === 'signature',
            onKeydown: (e) => onMusicalTrackAddInputKeydown(e, field),
        });
        input.setAttribute('aria-label', field === 'tempo' ? 'Tempo' : 'Signature');
        wrap.appendChild(input);
        positionMusicalTrackAddInputWrap(wrap, ev);
        trackEl.classList.add('musical-track-lane__track--add-input-open');
        markMusicalTrackEditOpened();
        activeEdit = Object.assign({}, editState, {
            input: input,
            hostEl: wrap,
            trackEl: trackEl,
        });
        attachMusicalTrackEditBlurHandler(input, () => {
            if (!activeEdit || activeEdit.input !== input) return;
            if (field === 'tempo') commitTempoTrackEdit();
            else commitSignatureTrackEdit();
        });
        focusMusicalTrackEditInput(
            input,
            field === 'signature' ? { caretAtStart: true } : undefined,
        );
    }

    function prepareSignatureAddInput(ev, sec, meterSpec, durationSec) {
        let snapped = sec;
        if (typeof snapSecToMusicalGridBar === 'function') {
            snapped = snapSecToMusicalGridBar(sec, { addSnap: true });
        }
        const barIndex = barIndexForSec(snapped, meterSpec, durationSec);
        const events =
            typeof getSignatureTrackEvents === 'function'
                ? getSignatureTrackEvents(meterSpec, durationSec).slice()
                : [];
        let eventIndex = -1;
        let isNew = true;
        for (let i = 0; i < events.length; i++) {
            if (events[i].barIndex === barIndex) {
                eventIndex = i;
                isNew = false;
                break;
            }
        }
        let prevSig = { num: 4, den: 4 };
        for (let i = 0; i < events.length; i++) {
            if (events[i].barIndex <= barIndex) prevSig = cloneMeterSig(events[i].sig);
            else break;
        }
        const initialValue = isNew
            ? formatMeterSigText(prevSig)
            : formatMeterSigText(events[eventIndex].sig);
        const boundaries = collectBarBoundaries(meterSpec, durationSec);
        const anchorSec =
            boundaries[barIndex] != null ? boundaries[barIndex] : Math.max(0, snapped);
        showMusicalTrackAddInput({
            field: 'signature',
            trackEl: musicalSignatureTrack,
            ev: ev,
            initialValue: initialValue,
            editState: {
                field: 'signature',
                barIndex: barIndex,
                sec: anchorSec,
                eventIndex: eventIndex,
                isNew: isNew,
                meterSpec: meterSpec,
                durationSec: durationSec,
            },
        });
    }

    function snapSignatureTrackDragSec(sec, opt) {
        if (typeof snapSecToMusicalGridBar === 'function') {
            return snapSecToMusicalGridBar(sec, opt);
        }
        return Math.max(0, Number(sec) || 0);
    }

    function collectBarBoundaries(meterSpec, durationSec) {
        return typeof collectPlaybackAlignedBarBoundarySecs === 'function'
            ? collectPlaybackAlignedBarBoundarySecs(meterSpec, durationSec)
            : typeof collectBarBoundarySecs === 'function'
              ? collectBarBoundarySecs(meterSpec, durationSec)
              : [];
    }

    function barIndexForSec(sec, meterSpec, durationSec) {
        if (typeof barIndexForBoundarySec === 'function') {
            return barIndexForBoundarySec(sec, collectBarBoundaries(meterSpec, durationSec));
        }
        const boundaries = collectBarBoundaries(meterSpec, durationSec);
        const t = Number(sec);
        if (!Number.isFinite(t) || boundaries.length < 2) return 0;
        let barIndex = 0;
        for (let i = 0; i < boundaries.length - 1; i++) {
            if (t >= boundaries[i + 1] - 1e-9) barIndex = i + 1;
            else if (t >= boundaries[i] - 1e-9) return i;
        }
        return barIndex;
    }

    function collectSignatureTrackSegments(events, meterSpec, durationSec) {
        const segments = [];
        if (!(durationSec > 0) || !events || !events.length) return segments;
        const boundaries = collectBarBoundaries(meterSpec, durationSec);
        if (boundaries.length < 2) return segments;
        const maxBarIndex = boundaries.length - 2;
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            const next = events[i + 1];
            const startBar = ev.barIndex | 0;
            if (startBar > maxBarIndex) continue;
            const endBar = next ? next.barIndex : boundaries.length - 1;
            const startSec = boundaries[startBar];
            const endSec = boundaries[Math.min(endBar, boundaries.length - 1)];
            if (!(endSec > startSec + 1e-9)) continue;
            segments.push({
                eventIndex: i,
                barIndex: startBar,
                startSec: startSec,
                endSec: endSec,
                text: formatMeterSigText(ev.sig),
                sig: ev.sig,
                draggable: i > 0,
            });
        }
        return segments;
    }

    function persistSignatureTrackEvents(events, meterSpec, durationSec, opt) {
        const o = Object.assign(
            { skipDurationDefer: true },
            opt && typeof opt === 'object' ? opt : {},
        );
        if (typeof applySignatureTrackEvents === 'function') {
            applySignatureTrackEvents(events, meterSpec, durationSec, o);
        } else if (typeof setSignatureTrackEvents === 'function') {
            setSignatureTrackEvents(events, meterSpec);
        }
        if (typeof persistMusicalGridAndRedraw === 'function') {
            persistMusicalGridAndRedraw({ skipMeterCommit: true });
        } else if (typeof scheduleMusicalGridRedraw === 'function') {
            scheduleMusicalGridRedraw();
        }
        if (typeof drawMusicalGridOverlay === 'function') {
            drawMusicalGridOverlay();
        }
    }

    function updateSignatureTrackSegmentLayout(events, meterSpec, master) {
        if (!musicalSignatureSegments) return;
        const segments = collectSignatureTrackSegments(events, meterSpec, master);
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const el = musicalSignatureSegments.querySelector(
                '[data-event-index="' + seg.eventIndex + '"]',
            );
            if (!el) continue;
            const pos = segmentLeftWidthPct(seg.startSec, seg.endSec, master);
            el.style.left = pos.leftPct + '%';
            el.style.width = pos.widthPct + '%';
            const valueEl = el.querySelector('.musical-track-lane__segment-value');
            if (valueEl && valueEl.textContent !== seg.text) {
                valueEl.textContent = seg.text;
            }
        }
    }

    function endSignatureBoundaryDrag(cancelled) {
        sigBoundaryDragActive = false;
        sigBoundaryDragPointerId = null;
        sigBoundaryDragEventIndex = -1;
        sigBoundaryDragEvents = null;
        sigBoundaryDragDidMove = false;
        sigBoundaryDragLastSec = NaN;
        if (sigBoundaryDragDocMove) {
            document.removeEventListener('pointermove', sigBoundaryDragDocMove);
            sigBoundaryDragDocMove = null;
        }
        if (sigBoundaryDragDocUp) {
            document.removeEventListener('pointerup', sigBoundaryDragDocUp);
            document.removeEventListener('pointercancel', sigBoundaryDragDocUp);
            sigBoundaryDragDocUp = null;
        }
        if (musicalSignatureTrack) {
            musicalSignatureTrack.classList.remove(
                'musical-track-lane__track--signature-drag',
            );
        }
        if (cancelled) cancelMusicalTrackUndoGesture();
    }

    function clearSignatureValuePointerListeners() {
        if (sigValuePointerDocMove) {
            document.removeEventListener('pointermove', sigValuePointerDocMove);
            sigValuePointerDocMove = null;
        }
        if (sigValuePointerDocUp) {
            document.removeEventListener('pointerup', sigValuePointerDocUp);
            document.removeEventListener('pointercancel', sigValuePointerDocUp);
            sigValuePointerDocUp = null;
        }
    }

    function cancelSignatureValuePointerGesture() {
        sigValuePointerState = null;
        clearSignatureValuePointerListeners();
        endSignatureBoundaryDrag(true);
    }

    function signaturePointerMoveExceedsDragSlop(st, clientX, clientY) {
        const dx = clientX - st.startX;
        const dy = clientY - st.startY;
        return (
            Math.abs(dx) >= TRACK_VALUE_DRAG_SLOP_PX &&
            Math.abs(dx) >= Math.abs(dy)
        );
    }

    function beginSignatureBoundaryDrag(st) {
        if (!st || st.mode === 'drag') return;
        if (typeof endAudioWaveformScrub === 'function') {
            endAudioWaveformScrub({ force: true });
        }
        st.mode = 'drag';
        if (st.captureEl && st.captureEl.setPointerCapture) {
            try {
                st.captureEl.setPointerCapture(st.pointerId);
            } catch (_e) {}
        }
        beginMusicalTrackUndoGesture();
        sigBoundaryDragActive = true;
        sigBoundaryDragDidMove = false;
        sigBoundaryDragLastSec = NaN;
        sigBoundaryDragPointerId = st.pointerId;
        sigBoundaryDragEventIndex = st.eventIndex;
        sigBoundaryDragEvents = st.events;
        if (musicalSignatureTrack) {
            musicalSignatureTrack.classList.add(
                'musical-track-lane__track--signature-drag',
            );
        }
    }

    function openSignatureEventEditInput(eventIndex, ev) {
        cancelSignatureValuePointerGesture();
        const settings = ensureMeterSpecForTrackEdit();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!settings || !settings.meterSpec || !(master > 0)) return;
        const events =
            typeof getSignatureTrackEvents === 'function'
                ? getSignatureTrackEvents(settings.meterSpec, master)
                : [];
        const mark = events[eventIndex];
        if (!mark) return;
        const boundaries = collectBarBoundaries(settings.meterSpec, master);
        const anchorSec =
            boundaries[mark.barIndex] != null
                ? boundaries[mark.barIndex]
                : mark.barIndex >= 0
                  ? 0
                  : 0;
        showMusicalTrackAddInput({
            field: 'signature',
            trackEl: musicalSignatureTrack,
            ev: ev,
            initialValue: formatMeterSigText(mark.sig),
            editState: {
                field: 'signature',
                barIndex: mark.barIndex,
                sec: anchorSec,
                eventIndex: eventIndex,
                isNew: false,
                meterSpec: settings.meterSpec,
                durationSec: master,
            },
        });
    }

    function bindSignatureValueEditEvents(valueEl, eventIndex) {
        bindMusicalTrackValueEditGesture(valueEl, (e) => {
            openSignatureEventEditInput(eventIndex, e);
        });
    }

    function onSignatureSegmentDblClick(e, eventIndex) {
        if (e.target.closest('.musical-track-lane__add-input-wrap')) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.target.closest('.musical-track-lane__segment-value')) return;
        const sec = transportSecFromMusicalTrackPointer(e.clientX);
        if (!Number.isFinite(sec)) return;
        const settings = ensureMeterSpecForTrackEdit();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!settings || !settings.meterSpec || !(master > 0)) return;
        prepareSignatureAddInput(e, sec, settings.meterSpec, master);
    }

    function onSignatureSegmentValuePointerDown(ev, eventIndex, segment) {
        if (ev.button !== 0) return;
        if (!segment || eventIndex < 1) return;
        if (sigValuePointerState || sigBoundaryDragActive) return;
        const settings =
            typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
        if (!settings || !settings.meterSpec) return;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return;
        ev.stopPropagation();
        selectTrackEvent('signature', eventIndex);
        if (typeof endAudioWaveformScrub === 'function') {
            endAudioWaveformScrub({ force: true });
        }
        const events =
            typeof getSignatureTrackEvents === 'function'
                ? getSignatureTrackEvents(settings.meterSpec, master).slice()
                : [];
        if (eventIndex < 1 || eventIndex >= events.length) return;
        const maxBarIndex = Math.max(
            0,
            collectBarBoundaries(settings.meterSpec, master).length - 2,
        );
        sigValuePointerState = {
            mode: 'pending',
            pointerId: ev.pointerId,
            startX: ev.clientX,
            startY: ev.clientY,
            eventIndex: eventIndex,
            events: events,
            settings: settings,
            master: master,
            maxBarIndex: maxBarIndex,
            captureEl: ev.currentTarget,
        };
        sigValuePointerDocMove = (e) => {
            const st = sigValuePointerState;
            if (!st || e.pointerId !== st.pointerId) return;
            if (st.mode === 'pending') {
                if (!signaturePointerMoveExceedsDragSlop(st, e.clientX, e.clientY)) return;
                e.preventDefault();
                beginSignatureBoundaryDrag(st);
            }
            if (st.mode !== 'drag' || !sigBoundaryDragActive) return;
            e.preventDefault();
            const sec = transportSecFromMusicalTrackPointer(e.clientX);
            if (!Number.isFinite(sec)) return;
            sigBoundaryDragLastSec = sec;
            const idx = sigBoundaryDragEventIndex;
            const list = sigBoundaryDragEvents;
            if (!list || idx < 1 || idx >= list.length) return;
            const snappedSec = snapSignatureTrackDragSec(sec);
            let barIndex = barIndexForSec(snappedSec, st.settings.meterSpec, st.master);
            const minBar = list[idx - 1].barIndex + 1;
            const maxBar =
                idx + 1 < list.length ? list[idx + 1].barIndex - 1 : st.maxBarIndex;
            barIndex = Math.max(minBar, Math.min(maxBar, barIndex));
            if (list[idx].barIndex === barIndex) return;
            list[idx] = Object.assign({}, list[idx], { barIndex: barIndex });
            sigBoundaryDragDidMove = true;
            updateSignatureTrackSegmentLayout(list, st.settings.meterSpec, st.master);
        };
        sigValuePointerDocUp = (e) => {
            const st = sigValuePointerState;
            if (!st || e.pointerId !== st.pointerId) return;
            if (st.mode === 'drag' && sigBoundaryDragActive) {
                e.preventDefault();
                const list = sigBoundaryDragEvents;
                const didMove = sigBoundaryDragDidMove;
                const settingsNow = st.settings;
                const masterNow = st.master;
                if (didMove && list && settingsNow && settingsNow.meterSpec && masterNow > 0) {
                    const idx = sigBoundaryDragEventIndex;
                    const maxBarIndex = Math.max(
                        0,
                        collectBarBoundaries(settingsNow.meterSpec, masterNow).length - 2,
                    );
                    if (
                        idx >= 1 &&
                        idx < list.length &&
                        Number.isFinite(sigBoundaryDragLastSec)
                    ) {
                        const snappedSec = snapSignatureTrackDragSec(sigBoundaryDragLastSec, {
                            addSnap: true,
                        });
                        let barIndex = barIndexForSec(
                            snappedSec,
                            settingsNow.meterSpec,
                            masterNow,
                        );
                        const minBar = list[idx - 1].barIndex + 1;
                        const maxBar =
                            idx + 1 < list.length
                                ? list[idx + 1].barIndex - 1
                                : maxBarIndex;
                        barIndex = Math.max(minBar, Math.min(maxBar, barIndex));
                        list[idx] = Object.assign({}, list[idx], { barIndex: barIndex });
                    }
                    persistSignatureTrackEvents(list, settingsNow.meterSpec, masterNow);
                    commitMusicalTrackUndoGesture();
                    refreshMusicalGridTracks();
                } else {
                    cancelMusicalTrackUndoGesture();
                }
                endSignatureBoundaryDrag(false);
            } else {
                endSignatureBoundaryDrag(true);
            }
            sigValuePointerState = null;
            clearSignatureValuePointerListeners();
        };
        document.addEventListener('pointermove', sigValuePointerDocMove);
        document.addEventListener('pointerup', sigValuePointerDocUp);
        document.addEventListener('pointercancel', sigValuePointerDocUp);
    }

    function onSignatureSegmentPointerDown(ev, eventIndex) {
        if (ev.button !== 0) return;
        if (ev.target.closest('.musical-track-lane__segment-value--draggable')) return;
        ev.stopPropagation();
        selectTrackEvent('signature', eventIndex);
    }

    function commitSignatureTrackEdit() {
        if (!activeEdit || activeEdit.field !== 'signature') return;
        const { eventIndex, isNew, barIndex, input, meterSpec, durationSec } = activeEdit;
        const raw = input ? input.value : '';
        cancelMusicalTrackEdit();
        const sig =
            typeof resolveMeterSigForBump === 'function'
                ? resolveMeterSigForBump(String(raw || '').trim())
                : typeof parseMeterSigPart === 'function'
                  ? parseMeterSigPart(String(raw || '').trim())
                  : null;
        if (!sig || !meterSpec || !(durationSec > 0)) {
            refreshMusicalGridTracks();
            return;
        }
        const events =
            typeof getSignatureTrackEvents === 'function'
                ? getSignatureTrackEvents(meterSpec, durationSec).slice()
                : [];
        requestMusicalTrackUndoCapture();
        if (isNew) {
            if (barIndex > 0) {
                events.push({ barIndex: barIndex, sig: cloneMeterSig(sig) });
                events.sort((a, b) => a.barIndex - b.barIndex);
            } else if (events.length) {
                events[0] = Object.assign({}, events[0], {
                    barIndex: 0,
                    sig: cloneMeterSig(sig),
                });
            } else {
                events.push({ barIndex: 0, sig: cloneMeterSig(sig) });
            }
        } else if (eventIndex >= 0 && eventIndex < events.length) {
            events[eventIndex] = Object.assign({}, events[eventIndex], {
                sig: cloneMeterSig(sig),
            });
        }
        persistSignatureTrackEvents(events, meterSpec, durationSec);
        syncSignatureTrackVisuals(meterSpec, durationSec);
    }

    function syncSignatureTrackVisuals(meterSpec, durationSec) {
        if (!(durationSec > 0)) return;
        const settings =
            typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
        const spec = (settings && settings.meterSpec) || meterSpec;
        if (!spec) return;
        const sigEvents =
            typeof getSignatureTrackEvents === 'function'
                ? getSignatureTrackEvents(spec, durationSec)
                : [];
        if (!sigBoundaryDragActive && !sigValuePointerState) {
            renderSignatureTrackSegments(sigEvents, spec, durationSec);
        } else if (sigEvents.length) {
            updateSignatureTrackSegmentLayout(sigEvents, spec, durationSec);
        }
        const measureSegs = collectBarMeasureSegments(spec, durationSec);
        renderMusicalTrackSegments(musicalMeasureSegments, 'measure', measureSegs, durationSec, {
            editable: false,
        });
        if (settings) {
            drawMusicalTrackGridCanvas(musicalSignatureGridCanvas, durationSec, settings);
            drawMusicalTrackGridCanvas(musicalMeasureGridCanvas, durationSec, settings);
        }
    }

    function applySignatureTrackEditLive() {
        if (!activeEdit || activeEdit.field !== 'signature') return false;
        const { input, meterSpec, durationSec } = activeEdit;
        let { eventIndex, isNew, barIndex } = activeEdit;
        const sig =
            typeof resolveMeterSigForBump === 'function'
                ? resolveMeterSigForBump(String(input ? input.value : '').trim())
                : typeof parseMeterSigPart === 'function'
                  ? parseMeterSigPart(String(input ? input.value : '').trim())
                  : null;
        if (!meterSpec || !(durationSec > 0)) return false;
        if (!sig) return false;
        if (!activeEdit.undoCaptured) {
            requestMusicalTrackUndoCapture();
            activeEdit.undoCaptured = true;
        }
        const events =
            typeof getSignatureTrackEvents === 'function'
                ? getSignatureTrackEvents(meterSpec, durationSec).slice()
                : [];
        if (isNew) {
            if (barIndex > 0) {
                let found = false;
                for (let i = 0; i < events.length; i++) {
                    if (events[i].barIndex === barIndex) {
                        events[i] = Object.assign({}, events[i], {
                            sig: cloneMeterSig(sig),
                        });
                        activeEdit.eventIndex = i;
                        activeEdit.isNew = false;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    events.push({ barIndex: barIndex, sig: cloneMeterSig(sig) });
                    events.sort((a, b) => a.barIndex - b.barIndex);
                    for (let i = 0; i < events.length; i++) {
                        if (events[i].barIndex === barIndex) {
                            activeEdit.eventIndex = i;
                            break;
                        }
                    }
                    activeEdit.isNew = false;
                }
            } else if (events.length) {
                events[0] = Object.assign({}, events[0], {
                    barIndex: 0,
                    sig: cloneMeterSig(sig),
                });
                activeEdit.eventIndex = 0;
                activeEdit.isNew = false;
            } else {
                events.push({ barIndex: 0, sig: cloneMeterSig(sig) });
                activeEdit.eventIndex = 0;
                activeEdit.isNew = false;
            }
        } else if (eventIndex >= 0 && eventIndex < events.length) {
            events[eventIndex] = Object.assign({}, events[eventIndex], {
                sig: cloneMeterSig(sig),
            });
        }
        persistSignatureTrackEvents(events, meterSpec, durationSec);
        syncSignatureTrackVisuals(meterSpec, durationSec);
        return true;
    }

    function renderSignatureTrackSegments(events, meterSpec, master) {
        if (!musicalSignatureSegments) return;
        const segments = collectSignatureTrackSegments(events, meterSpec, master);
        musicalSignatureSegments.replaceChildren();
        musicalSignatureSegments.setAttribute(
            'aria-hidden',
            segments.length ? 'false' : 'true',
        );
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const pos = segmentLeftWidthPct(seg.startSec, seg.endSec, master);
            const el = document.createElement('div');
            el.className =
                'musical-track-lane__segment musical-track-lane__segment--signature';
            el.style.left = pos.leftPct + '%';
            el.style.width = pos.widthPct + '%';
            el.dataset.eventIndex = String(seg.eventIndex);
            el.title =
                seg.eventIndex > 0
                    ? 'Signature ' +
                      seg.text +
                      ' — 選択後 Del で削除、DblClk で編集、数値をドラッグで移動'
                    : 'Signature ' + seg.text + ' — DblClk で編集';
            const valueEl = document.createElement('span');
            valueEl.className = 'musical-track-lane__segment-value';
            valueEl.textContent = seg.text;
            valueEl.title = 'ダブルクリックで編集';
            bindSignatureValueEditEvents(valueEl, seg.eventIndex);
            if (seg.draggable) {
                valueEl.classList.add('musical-track-lane__segment-value--draggable');
                valueEl.title = 'ダブルクリックで編集、ドラッグで拍子変化位置を移動（小節線に吸着）';
                valueEl.addEventListener('pointerdown', (e) => {
                    onSignatureSegmentValuePointerDown(e, seg.eventIndex, seg);
                });
            }
            el.appendChild(valueEl);
            el.addEventListener('dblclick', (e) => {
                onSignatureSegmentDblClick(e, seg.eventIndex);
            });
            el.addEventListener('pointerdown', (e) => {
                onSignatureSegmentPointerDown(e, seg.eventIndex);
            });
            musicalSignatureSegments.appendChild(el);
        }
        syncTrackEventSelectionUi();
    }

    function bindTrackSelectionClear() {
        [musicalRehearsalTrack, musicalTempoTrack, musicalSignatureTrack].forEach((trackEl) => {
            if (!trackEl || trackEl.dataset.trackSelectClearBound === '1') return;
            trackEl.dataset.trackSelectClearBound = '1';
            trackEl.addEventListener('pointerdown', (e) => {
                if (e.target.closest('.musical-track-lane__segment')) return;
                if (e.target.closest('.musical-track-lane__add-input-wrap')) return;
                clearTrackEventSelection();
            });
        });
    }

    function ensureMeterSpecForTrackEdit() {
        const settings =
            typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
        if (settings && settings.meterSpec) return settings;
        if (typeof ensureMusicalGridMeterCommitted === 'function') {
            ensureMusicalGridMeterCommitted();
        }
        return typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
    }

    function bindSignatureTrackBackgroundEdit() {
        if (signatureTrackDblClickBound || !musicalSignatureTrack) return;
        signatureTrackDblClickBound = true;
        musicalSignatureTrack.addEventListener('dblclick', (e) => {
            if (e.target.closest('.musical-track-lane__add-input-wrap')) return;
            if (e.target.closest('.musical-track-lane__segment-value')) return;
            if (e.target.closest('.musical-track-lane__segment')) return;
            e.preventDefault();
            e.stopPropagation();
            const sec = transportSecFromMusicalTrackPointer(e.clientX);
            if (!Number.isFinite(sec)) return;
            const settings = ensureMeterSpecForTrackEdit();
            const master =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : 0;
            if (!settings || !settings.meterSpec || !(master > 0)) return;
            prepareSignatureAddInput(e, sec, settings.meterSpec, master);
        });
    }

    function transportSecFromTempoTrackPointer(clientX) {
        return transportSecFromMusicalTrackPointer(clientX);
    }

    function collectTempoTrackSegments(events, durationSec) {
        const segments = [];
        if (!(durationSec > 0) || !events || !events.length) return segments;
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            const next = events[i + 1];
            const endSec = next ? next.sec : durationSec;
            if (!(endSec > ev.sec + 1e-9)) continue;
            segments.push({
                eventIndex: i,
                startSec: ev.sec,
                endSec: endSec,
                text: formatBpmForMeter(ev.bpm),
                bpm: ev.bpm,
                draggable: i > 0,
            });
        }
        return segments;
    }

    function snapTempoTrackDragSec(sec) {
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        const settings =
            typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
        if (!settings || !settings.meterSpec) return Math.max(0, n);
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return Math.max(0, n);
        const zoom =
            typeof getWaveformTimelineZoom === 'function' ? getWaveformTimelineZoom() : 1;
        const showBeats = zoom >= 10;
        const lines = collectMusicalGridLines(settings.meterSpec, master, { showBeats });
        const stops = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line || !Number.isFinite(line.sec)) continue;
            if (line.kind === 'bar' || (showBeats && line.kind === 'beat')) {
                stops.push(line.sec);
            }
        }
        if (!stops.length) return Math.max(0, Math.min(master, n));
        const threshold =
            typeof getMusicalGridSnapThresholdSec === 'function'
                ? getMusicalGridSnapThresholdSec()
                : 0.05;
        if (typeof snapToNearestStop === 'function') {
            return Math.max(0, Math.min(master, snapToNearestStop(n, stops, threshold)));
        }
        let best = stops[0];
        let bestDist = Math.abs(n - best);
        for (let i = 1; i < stops.length; i++) {
            const d = Math.abs(n - stops[i]);
            if (d < bestDist) {
                bestDist = d;
                best = stops[i];
            }
        }
        return Math.max(0, Math.min(master, bestDist <= threshold ? best : n));
    }

    function persistTempoTrackEvents(events, meterSpec, durationSec, opt) {
        if (typeof applyTempoTrackEvents === 'function') {
            applyTempoTrackEvents(events, meterSpec, durationSec);
        } else if (typeof setTempoTrackEvents === 'function') {
            setTempoTrackEvents(events, meterSpec, durationSec);
        }
        if (typeof persistMusicalGridAndRedraw === 'function') {
            persistMusicalGridAndRedraw({ skipMeterCommit: true });
        } else if (typeof scheduleMusicalGridRedraw === 'function') {
            scheduleMusicalGridRedraw();
        }
    }

    function updateTempoTrackSegmentLayout(events, master) {
        if (!musicalTempoSegments) return;
        const segments = collectTempoTrackSegments(events, master);
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const el = musicalTempoSegments.querySelector(
                '[data-event-index="' + seg.eventIndex + '"]',
            );
            if (!el) continue;
            const pos = segmentLeftWidthPct(seg.startSec, seg.endSec, master);
            el.style.left = pos.leftPct + '%';
            el.style.width = pos.widthPct + '%';
        }
    }

    function prepareTempoAddInput(ev, sec, meterSpec, durationSec) {
        let snapped = sec;
        if (typeof snapSecToMusicalGridBar === 'function') {
            snapped = snapSecToMusicalGridBar(sec, { addSnap: true });
        }
        if (!Number.isFinite(snapped)) snapped = Math.max(0, sec);
        const events =
            typeof getTempoTrackEvents === 'function'
                ? getTempoTrackEvents(meterSpec, durationSec).slice()
                : [];
        let eventIndex = -1;
        let isNew = true;
        for (let i = 0; i < events.length; i++) {
            if (Math.abs(events[i].sec - snapped) < 1e-6) {
                eventIndex = i;
                isNew = false;
                break;
            }
        }
        let prevBpm = events.length ? events[0].bpm : 120;
        for (let i = 0; i < events.length; i++) {
            if (events[i].sec <= snapped + 1e-9) prevBpm = events[i].bpm;
            else break;
        }
        const initialValue = isNew
            ? formatBpmForMeter(prevBpm)
            : formatBpmForMeter(events[eventIndex].bpm);
        showMusicalTrackAddInput({
            field: 'tempo',
            trackEl: musicalTempoTrack,
            ev: ev,
            initialValue: initialValue,
            editState: {
                field: 'tempo',
                sec: snapped,
                eventIndex: eventIndex,
                isNew: isNew,
                meterSpec: meterSpec,
                durationSec: durationSec,
            },
        });
    }

    function endTempoBoundaryDrag(cancelled) {
        tempoBoundaryDragActive = false;
        tempoBoundaryDragPointerId = null;
        tempoBoundaryDragEventIndex = -1;
        tempoBoundaryDragEvents = null;
        tempoBoundaryDragDidMove = false;
        if (tempoBoundaryDragDocMove) {
            document.removeEventListener('pointermove', tempoBoundaryDragDocMove);
            tempoBoundaryDragDocMove = null;
        }
        if (tempoBoundaryDragDocUp) {
            document.removeEventListener('pointerup', tempoBoundaryDragDocUp);
            document.removeEventListener('pointercancel', tempoBoundaryDragDocUp);
            tempoBoundaryDragDocUp = null;
        }
        if (musicalTempoTrack) {
            musicalTempoTrack.classList.remove('musical-track-lane__track--tempo-drag');
        }
        if (cancelled) cancelMusicalTrackUndoGesture();
    }

    function clearTempoValuePointerListeners() {
        if (tempoValuePointerDocMove) {
            document.removeEventListener('pointermove', tempoValuePointerDocMove);
            tempoValuePointerDocMove = null;
        }
        if (tempoValuePointerDocUp) {
            document.removeEventListener('pointerup', tempoValuePointerDocUp);
            document.removeEventListener('pointercancel', tempoValuePointerDocUp);
            tempoValuePointerDocUp = null;
        }
    }

    function cancelTempoValuePointerGesture() {
        tempoValuePointerState = null;
        clearTempoValuePointerListeners();
        endTempoBoundaryDrag(true);
    }

    function tempoPointerMoveExceedsDragSlop(st, clientX, clientY) {
        const dx = clientX - st.startX;
        const dy = clientY - st.startY;
        return (
            Math.abs(dx) >= TRACK_VALUE_DRAG_SLOP_PX &&
            Math.abs(dx) >= Math.abs(dy)
        );
    }

    function beginTempoBoundaryDrag(st) {
        if (!st || st.mode === 'drag') return;
        if (typeof endAudioWaveformScrub === 'function') {
            endAudioWaveformScrub({ force: true });
        }
        st.mode = 'drag';
        if (st.captureEl && st.captureEl.setPointerCapture) {
            try {
                st.captureEl.setPointerCapture(st.pointerId);
            } catch (_e) {}
        }
        beginMusicalTrackUndoGesture();
        tempoBoundaryDragActive = true;
        tempoBoundaryDragDidMove = false;
        tempoBoundaryDragPointerId = st.pointerId;
        tempoBoundaryDragEventIndex = st.eventIndex;
        tempoBoundaryDragEvents = st.events;
        if (musicalTempoTrack) {
            musicalTempoTrack.classList.add('musical-track-lane__track--tempo-drag');
        }
    }

    function openTempoEventEditInput(eventIndex, ev) {
        cancelTempoValuePointerGesture();
        const settings = ensureMeterSpecForTrackEdit();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!settings || !settings.meterSpec || !(master > 0)) return;
        const events =
            typeof getTempoTrackEvents === 'function'
                ? getTempoTrackEvents(settings.meterSpec, master)
                : [];
        const mark = events[eventIndex];
        if (!mark) return;
        showMusicalTrackAddInput({
            field: 'tempo',
            trackEl: musicalTempoTrack,
            ev: ev,
            initialValue: formatBpmForMeter(mark.bpm),
            editState: {
                field: 'tempo',
                sec: mark.sec,
                eventIndex: eventIndex,
                isNew: false,
                meterSpec: settings.meterSpec,
                durationSec: master,
            },
        });
    }

    function bindTempoValueEditEvents(valueEl, eventIndex) {
        bindMusicalTrackValueEditGesture(valueEl, (e) => {
            openTempoEventEditInput(eventIndex, e);
        });
    }

    function onTempoSegmentDblClick(e, eventIndex) {
        if (e.target.closest('.musical-track-lane__add-input-wrap')) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.target.closest('.musical-track-lane__segment-value')) return;
        const sec = transportSecFromTempoTrackPointer(e.clientX);
        if (!Number.isFinite(sec)) return;
        const settings = ensureMeterSpecForTrackEdit();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!settings || !settings.meterSpec || !(master > 0)) return;
        prepareTempoAddInput(e, sec, settings.meterSpec, master);
    }

    function onTempoSegmentValuePointerDown(ev, eventIndex, segment) {
        if (ev.button !== 0) return;
        if (!segment || eventIndex < 1) return;
        if (tempoValuePointerState || tempoBoundaryDragActive) return;
        const settings =
            typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
        if (!settings || !settings.meterSpec) return;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return;
        ev.stopPropagation();
        selectTrackEvent('tempo', eventIndex);
        if (typeof endAudioWaveformScrub === 'function') {
            endAudioWaveformScrub({ force: true });
        }
        const events =
            typeof getTempoTrackEvents === 'function'
                ? getTempoTrackEvents(settings.meterSpec, master).slice()
                : [];
        if (eventIndex < 1 || eventIndex >= events.length) return;
        tempoValuePointerState = {
            mode: 'pending',
            pointerId: ev.pointerId,
            startX: ev.clientX,
            startY: ev.clientY,
            eventIndex: eventIndex,
            events: events,
            settings: settings,
            master: master,
            captureEl: ev.currentTarget,
        };
        tempoValuePointerDocMove = (e) => {
            const st = tempoValuePointerState;
            if (!st || e.pointerId !== st.pointerId) return;
            if (st.mode === 'pending') {
                if (!tempoPointerMoveExceedsDragSlop(st, e.clientX, e.clientY)) return;
                e.preventDefault();
                beginTempoBoundaryDrag(st);
            }
            if (st.mode !== 'drag' || !tempoBoundaryDragActive) return;
            e.preventDefault();
            const sec = transportSecFromTempoTrackPointer(e.clientX);
            if (!Number.isFinite(sec)) return;
            const idx = tempoBoundaryDragEventIndex;
            const list = tempoBoundaryDragEvents;
            const masterNow = st.master;
            if (!list || idx < 1 || idx >= list.length) return;
            const minSec = list[idx - 1].sec + 1e-6;
            const maxSec =
                idx + 1 < list.length ? list[idx + 1].sec - 1e-6 : masterNow - 1e-6;
            let next = snapTempoTrackDragSec(sec);
            next = Math.max(minSec, Math.min(maxSec, next));
            if (Math.abs(list[idx].sec - next) < 1e-9) return;
            const barIndex = barIndexForSec(next, st.settings.meterSpec, masterNow);
            list[idx] = Object.assign({}, list[idx], { sec: next, barIndex: barIndex });
            tempoBoundaryDragDidMove = true;
            updateTempoTrackSegmentLayout(list, masterNow);
        };
        tempoValuePointerDocUp = (e) => {
            const st = tempoValuePointerState;
            if (!st || e.pointerId !== st.pointerId) return;
            if (st.mode === 'drag' && tempoBoundaryDragActive) {
                e.preventDefault();
                const list = tempoBoundaryDragEvents;
                const didMove = tempoBoundaryDragDidMove;
                const settingsNow = st.settings;
                const masterNow = st.master;
                if (didMove && list && settingsNow && settingsNow.meterSpec && masterNow > 0) {
                    persistTempoTrackEvents(list, settingsNow.meterSpec, masterNow);
                    commitMusicalTrackUndoGesture();
                    refreshMusicalGridTracks();
                } else {
                    cancelMusicalTrackUndoGesture();
                }
                endTempoBoundaryDrag(false);
            } else {
                endTempoBoundaryDrag(true);
            }
            tempoValuePointerState = null;
            clearTempoValuePointerListeners();
        };
        document.addEventListener('pointermove', tempoValuePointerDocMove);
        document.addEventListener('pointerup', tempoValuePointerDocUp);
        document.addEventListener('pointercancel', tempoValuePointerDocUp);
    }

    function onTempoSegmentPointerDown(ev, eventIndex) {
        if (ev.button !== 0) return;
        if (ev.target.closest('.musical-track-lane__segment-value--draggable')) return;
        ev.stopPropagation();
        selectTrackEvent('tempo', eventIndex);
    }

    function syncTempoTrackVisuals(meterSpec, durationSec) {
        if (!(durationSec > 0)) return;
        const settings =
            typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
        const spec = (settings && settings.meterSpec) || meterSpec;
        if (!spec) return;
        const tempoEvents =
            typeof getTempoTrackEvents === 'function'
                ? getTempoTrackEvents(spec, durationSec)
                : [];
        if (!tempoBoundaryDragActive && !tempoValuePointerState) {
            renderTempoTrackSegments(tempoEvents, spec, durationSec);
        }
        const sigEvents =
            typeof getSignatureTrackEvents === 'function'
                ? getSignatureTrackEvents(spec, durationSec)
                : [];
        if (!sigBoundaryDragActive && !sigValuePointerState) {
            renderSignatureTrackSegments(sigEvents, spec, durationSec);
        } else if (sigEvents.length) {
            updateSignatureTrackSegmentLayout(sigEvents, spec, durationSec);
        }
        const measureSegs = collectBarMeasureSegments(spec, durationSec);
        renderMusicalTrackSegments(musicalMeasureSegments, 'measure', measureSegs, durationSec, {
            editable: false,
        });
        if (settings) {
            drawMusicalTrackGridCanvas(musicalTempoGridCanvas, durationSec, settings);
            drawMusicalTrackGridCanvas(musicalSignatureGridCanvas, durationSec, settings);
            drawMusicalTrackGridCanvas(musicalMeasureGridCanvas, durationSec, settings);
        }
        if (typeof drawMusicalGridOverlay === 'function') drawMusicalGridOverlay();
    }

    function applyTempoTrackEditLive() {
        if (!activeEdit || activeEdit.field !== 'tempo') return false;
        const { input, meterSpec, durationSec } = activeEdit;
        let { eventIndex, isNew, sec } = activeEdit;
        const bpm = Number(String(input ? input.value : '').trim());
        if (!meterSpec || !(durationSec > 0)) return false;
        if (!(bpm > 0 && bpm <= 999)) return false;
        if (!activeEdit.undoCaptured) {
            requestMusicalTrackUndoCapture();
            activeEdit.undoCaptured = true;
        }
        const events =
            typeof getTempoTrackEvents === 'function'
                ? getTempoTrackEvents(meterSpec, durationSec).slice()
                : [];
        if (isNew) {
            if (sec > 1e-9) {
                const barIndex = barIndexForSec(sec, meterSpec, durationSec);
                events.push({ sec: sec, bpm: bpm, barIndex: barIndex });
                events.sort((a, b) => {
                    const aBar = a.barIndex != null ? a.barIndex : a.sec;
                    const bBar = b.barIndex != null ? b.barIndex : b.sec;
                    return aBar - bBar;
                });
                for (let i = 0; i < events.length; i++) {
                    if (
                        (events[i].barIndex != null &&
                            events[i].barIndex === barIndex) ||
                        Math.abs(events[i].sec - sec) < 1e-6
                    ) {
                        activeEdit.eventIndex = i;
                        break;
                    }
                }
                activeEdit.isNew = false;
            } else if (events.length) {
                events[0] = Object.assign({}, events[0], { sec: 0, bpm: bpm, barIndex: 0 });
                activeEdit.eventIndex = 0;
                activeEdit.isNew = false;
            } else {
                events.push({ sec: 0, bpm: bpm, barIndex: 0 });
                activeEdit.eventIndex = 0;
                activeEdit.isNew = false;
            }
        } else if (eventIndex >= 0 && eventIndex < events.length) {
            events[eventIndex] = Object.assign({}, events[eventIndex], { bpm: bpm });
        }
        persistTempoTrackEvents(events, meterSpec, durationSec);
        syncTempoTrackVisuals(meterSpec, durationSec);
        return true;
    }

    function commitTempoTrackEdit() {
        if (!activeEdit || activeEdit.field !== 'tempo') return;
        applyTempoTrackEditLive();
        cancelMusicalTrackEdit();
        refreshMusicalGridTracks();
    }

    function renderTempoTrackSegments(events, meterSpec, master) {
        if (!musicalTempoSegments) return;
        const segments = collectTempoTrackSegments(events, master);
        musicalTempoSegments.replaceChildren();
        musicalTempoSegments.setAttribute(
            'aria-hidden',
            segments.length ? 'false' : 'true',
        );
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const pos = segmentLeftWidthPct(seg.startSec, seg.endSec, master);
            const el = document.createElement('div');
            el.className = 'musical-track-lane__segment musical-track-lane__segment--tempo';
            el.style.left = pos.leftPct + '%';
            el.style.width = pos.widthPct + '%';
            el.dataset.eventIndex = String(seg.eventIndex);
            el.title =
                seg.eventIndex > 0
                    ? 'Tempo ' +
                      seg.text +
                      ' — 選択後 Del で削除、DblClk で編集、数値をドラッグで移動'
                    : 'Tempo ' + seg.text + ' — DblClk で編集';
            const valueEl = document.createElement('span');
            valueEl.className = 'musical-track-lane__segment-value';
            valueEl.textContent = seg.text;
            valueEl.title = 'ダブルクリックで編集';
            bindTempoValueEditEvents(valueEl, seg.eventIndex);
            if (seg.draggable) {
                valueEl.classList.add('musical-track-lane__segment-value--draggable');
                valueEl.title = 'ダブルクリックで編集、ドラッグでテンポ変化位置を移動';
                valueEl.addEventListener('pointerdown', (e) => {
                    onTempoSegmentValuePointerDown(e, seg.eventIndex, seg);
                });
            }
            el.appendChild(valueEl);
            el.addEventListener('dblclick', (e) => {
                onTempoSegmentDblClick(e, seg.eventIndex);
            });
            el.addEventListener('pointerdown', (e) => {
                onTempoSegmentPointerDown(e, seg.eventIndex);
            });
            musicalTempoSegments.appendChild(el);
        }
        syncTrackEventSelectionUi();
    }

    function bindTempoTrackBackgroundEdit() {
        if (tempoTrackDblClickBound || !musicalTempoTrack) return;
        tempoTrackDblClickBound = true;
        musicalTempoTrack.addEventListener('dblclick', (e) => {
            if (e.target.closest('.musical-track-lane__add-input-wrap')) return;
            if (e.target.closest('.musical-track-lane__segment-value')) return;
            if (e.target.closest('.musical-track-lane__segment')) return;
            e.preventDefault();
            e.stopPropagation();
            const sec = transportSecFromTempoTrackPointer(e.clientX);
            if (!Number.isFinite(sec)) return;
            const settings = ensureMeterSpecForTrackEdit();
            const master =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : 0;
            if (!settings || !settings.meterSpec || !(master > 0)) return;
            prepareTempoAddInput(e, sec, settings.meterSpec, master);
        });
    }

    function collectMeterFieldSegments(meterSpec, durationSec, field) {
        const segments = [];
        if (!(durationSec > 0) || !meterSpec) return segments;
        const boundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(meterSpec, durationSec)
                : typeof collectBarBoundarySecs === 'function'
                  ? collectBarBoundarySecs(meterSpec, durationSec)
                  : [];
        if (boundaries.length < 2) return segments;
        let barStart = 0;
        let segStartSec = boundaries[0];
        let lastText = null;
        for (let barIndex = 0; barIndex < boundaries.length - 1; barIndex++) {
            const barEndSec = boundaries[barIndex + 1];
            const entry = getMeterEntryForBar(meterSpec, barIndex);
            if (!entry) break;
            const text =
                field === 'tempo'
                    ? formatBpmForMeter(entry.bpm)
                    : formatMeterSigText(entry.sig);
            if (lastText != null && text !== lastText) {
                segments.push({
                    barStart,
                    barCount: barIndex - barStart,
                    startSec: segStartSec,
                    endSec: boundaries[barIndex],
                    text: lastText,
                });
                barStart = barIndex;
                segStartSec = boundaries[barIndex];
            }
            lastText = text;
            if (barIndex === boundaries.length - 2) {
                segments.push({
                    barStart,
                    barCount: barIndex - barStart + 1,
                    startSec: segStartSec,
                    endSec: barEndSec,
                    text: lastText,
                });
            }
        }
        return segments;
    }

    /** Measure トラック小節番号 — 0.58rem 相当 */
    const MEASURE_TRACK_LABEL_FONT_PX = 9.3;
    /** Rehearsal Mark 区間小節番号 — 0.46rem 相当 */
    const REHEARSAL_MEASURE_LABEL_FONT_PX = 7.4;
    const MEASURE_LABEL_MIN_PAD_PX = 6;
    const MEASURE_LABEL_DIGIT_WIDTH_RATIO = 0.62;

    const MEASURE_LABEL_SEGMENT_PAD_PX = 2;
    const MEASURE_LABEL_MIN_GAP_PX = 1;

    function measureLabelMinWidthPxForBarNumber(barNumber, fontSizePx) {
        const digits = Math.max(1, String(Math.abs(barNumber | 0)).length);
        const fontPx = fontSizePx > 0 ? fontSizePx : MEASURE_TRACK_LABEL_FONT_PX;
        return Math.ceil(digits * fontPx * MEASURE_LABEL_DIGIT_WIDTH_RATIO + MEASURE_LABEL_MIN_PAD_PX);
    }

    function measureLabelXContentPx(startSec, master) {
        const pad = MEASURE_LABEL_SEGMENT_PAD_PX;
        if (typeof timelineSecToContentPx === 'function') {
            return timelineSecToContentPx(startSec) + pad;
        }
        const contentW =
            typeof masterTimelineWidthCss === 'function' ? masterTimelineWidthCss() : 0;
        if (contentW > 0 && master > 0) {
            return (startSec / master) * contentW + pad;
        }
        return pad;
    }

    function sortedMeasureLabelAnchors(anchorBarNumbers) {
        const raw = anchorBarNumbers && anchorBarNumbers.length ? anchorBarNumbers.slice() : [1];
        if (raw.indexOf(1) < 0) raw.unshift(1);
        raw.sort((a, b) => a - b);
        const out = [];
        for (let i = 0; i < raw.length; i++) {
            if (i === 0 || raw[i] !== raw[i - 1]) out.push(raw[i]);
        }
        return out;
    }

    function measureLabelAnchorForBar(barNumber1Based, sortedAnchors) {
        let anchor = sortedAnchors[0] || 1;
        for (let i = 0; i < sortedAnchors.length; i++) {
            if (sortedAnchors[i] <= barNumber1Based) anchor = sortedAnchors[i];
            else break;
        }
        return anchor;
    }

    /** 直前のアンカー（小節 1 またはリハーサルマーク）から step 間隔。アンカー小節は必ず表示。 */
    function shouldShowMeasureLabelAtBar(barNumber1Based, displayStep, anchorBarNumbers) {
        if (!(displayStep > 1)) return true;
        const n = barNumber1Based | 0;
        if (n < 1) return false;
        const anchors = sortedMeasureLabelAnchors(
            Array.isArray(anchorBarNumbers)
                ? anchorBarNumbers
                : anchorBarNumbers != null
                  ? [anchorBarNumbers]
                  : [1],
        );
        if (anchors.indexOf(n) >= 0) return true;
        const anchor = measureLabelAnchorForBar(n, anchors);
        return (n - anchor) % displayStep === 0;
    }

    function measureLabelAnchorsFromMandatoryBarIndices(mandatoryBarIndices) {
        const nums = [1];
        if (mandatoryBarIndices && mandatoryBarIndices.size) {
            mandatoryBarIndices.forEach((idx) => {
                const n = (idx | 0) + 1;
                if (n >= 1) nums.push(n);
            });
        }
        return sortedMeasureLabelAnchors(nums);
    }

    function visibleMeasureCandidatesForStep(candidates, displayStep, anchorBarNumbers) {
        if (!candidates || !candidates.length) return [];
        if (!(displayStep > 1)) return candidates.slice();
        return candidates.filter((c) =>
            shouldShowMeasureLabelAtBar(c.barNum, displayStep, anchorBarNumbers),
        );
    }

    /** 小節番号間引き — 全部 / 1つ飛ばし(2) / 3つ飛ばし(4) / 7つ飛ばし(8) の 4 段のみ */
    const MEASURE_LABEL_DISPLAY_STEPS = [1, 2, 4, 8];

    /** 左端 x + 推定幅が次のラベルと重なるか */
    function measureLabelPositionsWouldOverlap(visibleCandidates, fontSizePx, master) {
        if (!visibleCandidates || visibleCandidates.length < 2) return false;
        const sorted = visibleCandidates.slice().sort((a, b) => a.startSec - b.startSec);
        let prevRight = -Infinity;
        for (let i = 0; i < sorted.length; i++) {
            const c = sorted[i];
            const x = measureLabelXContentPx(c.startSec, master);
            const w = measureLabelMinWidthPxForBarNumber(c.barNum, fontSizePx);
            if (x < prevRight + MEASURE_LABEL_MIN_GAP_PX) return true;
            prevRight = x + w;
        }
        return false;
    }

    /** 重なり時のみ — 最小 step（1 → 2 → 4 → 8）を選ぶ。重ならなければ常に 1（全部表示） */
    function resolveMeasureLabelDisplayStepByOverlap(candidates, fontSizePx, anchorBarNumbers, master) {
        if (!candidates || !candidates.length) return 1;
        for (let si = 0; si < MEASURE_LABEL_DISPLAY_STEPS.length; si++) {
            const step = MEASURE_LABEL_DISPLAY_STEPS[si];
            const visible = visibleMeasureCandidatesForStep(candidates, step, anchorBarNumbers);
            if (!measureLabelPositionsWouldOverlap(visible, fontSizePx, master)) return step;
        }
        return MEASURE_LABEL_DISPLAY_STEPS[MEASURE_LABEL_DISPLAY_STEPS.length - 1];
    }

    function splitMeasureCandidatesByAnchorSegments(candidates, anchorBarNumbers) {
        const anchors = sortedMeasureLabelAnchors(anchorBarNumbers);
        const segments = [];
        for (let ai = 0; ai < anchors.length; ai++) {
            const anchorBar = anchors[ai];
            const nextAnchorBar = ai + 1 < anchors.length ? anchors[ai + 1] : Infinity;
            const segCandidates = [];
            for (let ci = 0; ci < candidates.length; ci++) {
                const c = candidates[ci];
                if (c.barNum >= anchorBar && c.barNum < nextAnchorBar) {
                    segCandidates.push(c);
                }
            }
            if (segCandidates.length) {
                segments.push({
                    anchorBarNumbers: [anchorBar],
                    candidates: segCandidates,
                });
            }
        }
        return segments;
    }

    function filterMeasureBarCandidatesForDisplay(candidates, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!candidates || !candidates.length) return [];
        const master = o.master;
        const fontSizePx = o.fontSizePx > 0 ? o.fontSizePx : MEASURE_TRACK_LABEL_FONT_PX;
        const anchorBarNumbers = sortedMeasureLabelAnchors(o.anchorBarNumbers || [1]);
        if (!(master > 0)) return candidates.slice();
        const anchorSegments = splitMeasureCandidatesByAnchorSegments(
            candidates,
            anchorBarNumbers,
        );
        const visible = [];
        for (let si = 0; si < anchorSegments.length; si++) {
            const seg = anchorSegments[si];
            const step = resolveMeasureLabelDisplayStepByOverlap(
                seg.candidates,
                fontSizePx,
                seg.anchorBarNumbers,
                master,
            );
            const segVisible = visibleMeasureCandidatesForStep(
                seg.candidates,
                step,
                seg.anchorBarNumbers,
            );
            for (let vi = 0; vi < segVisible.length; vi++) {
                visible.push(segVisible[vi]);
            }
        }
        visible.sort((a, b) => a.startSec - b.startSec);
        return visible;
    }

    function collectRehearsalMarkMandatoryBarIndices(boundaries, master, meterSpec) {
        const mandatory = new Set();
        if (
            !boundaries ||
            !boundaries.length ||
            typeof collectRehearsalMarkDrawRanges !== 'function' ||
            typeof barIndexForBoundarySec !== 'function'
        ) {
            return mandatory;
        }
        const ranges = collectRehearsalMarkDrawRanges(master, meterSpec);
        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];
            if (!range || !range.fromRehearsalEvent) continue;
            const barIdx = barIndexForBoundarySec(range.startSec, boundaries);
            if (barIdx >= 0) mandatory.add(barIdx);
        }
        return mandatory;
    }

    function collectBarMeasureSegments(meterSpec, durationSec) {
        const segments = [];
        if (!(durationSec > 0) || !meterSpec) return segments;
        const boundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(meterSpec, durationSec)
                : typeof collectBarBoundarySecs === 'function'
                  ? collectBarBoundarySecs(meterSpec, durationSec)
                  : [];
        const totalBars = boundaries.length - 1;
        if (totalBars <= 0) return segments;
        const candidates = [];
        for (let barIndex = 0; barIndex < totalBars; barIndex++) {
            candidates.push({
                barNum: barIndex + 1,
                barStart: barIndex,
                barCount: 1,
                startSec: boundaries[barIndex],
                endSec: boundaries[barIndex + 1],
            });
        }
        const mandatoryBarIndices = collectRehearsalMarkMandatoryBarIndices(
            boundaries,
            durationSec,
            meterSpec,
        );
        const labelAnchors = measureLabelAnchorsFromMandatoryBarIndices(mandatoryBarIndices);
        const visible = filterMeasureBarCandidatesForDisplay(candidates, {
            master: durationSec,
            fontSizePx: MEASURE_TRACK_LABEL_FONT_PX,
            anchorBarNumbers: labelAnchors,
        });
        for (let i = 0; i < visible.length; i++) {
            const c = visible[i];
            segments.push({
                barStart: c.barStart,
                barCount: c.barCount,
                startSec: c.startSec,
                endSec: c.endSec,
                text: String(c.barNum),
            });
        }
        return segments;
    }

    function segmentLeftWidthPct(startSec, endSec, master) {
        if (!(master > 0)) return { leftPct: 0, widthPct: 0 };
        const leftPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(startSec)
                : (startSec / master) * 100;
        const rightPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(endSec)
                : (endSec / master) * 100;
        return {
            leftPct,
            widthPct: Math.max(0.08, rightPct - leftPct),
        };
    }

    function cloneMeterSpecEntries(spec) {
        if (!spec || !spec.entries) return [];
        return spec.entries.map((entry) => ({
            bpm: entry.bpm,
            sig: cloneMeterSig(entry.sig),
        }));
    }

    function cloneMeterSig(sig) {
        if (!sig) return { num: 4, den: 4 };
        const out = { num: sig.num, den: sig.den };
        if (sig.alternates && sig.alternates.length) {
            out.alternates = sig.alternates.map((a) => ({ num: a.num, den: a.den }));
        }
        if (sig.segments && sig.segments.length) {
            out.segments = sig.segments.map((s) => ({ num: s.num, den: s.den }));
        }
        return out;
    }

    function updateMeterFieldForBarRange(field, barStart, barCount, rawValue) {
        if (typeof readMusicalGridFromInputs === 'function') readMusicalGridFromInputs();
        const spec = typeof getMeterSpec === 'function' ? getMeterSpec() : null;
        if (!spec || !spec.entries || !spec.entries.length || !(barCount > 0)) return false;
        const entries = cloneMeterSpecEntries(spec);
        const start = barStart | 0;
        const count = barCount | 0;
        if (field === 'tempo') {
            const bpm = Number(String(rawValue || '').trim());
            if (!(bpm > 0 && bpm <= 999)) return false;
            for (let i = 0; i < count; i++) {
                const idx = getRawMeterEntryIndexForBar(spec, start + i);
                if (idx < 0 || !entries[idx]) return false;
                entries[idx].bpm = bpm;
            }
        } else {
            const sig =
                typeof resolveMeterSigForBump === 'function'
                    ? resolveMeterSigForBump(String(rawValue || '').trim())
                    : typeof parseMeterSigPart === 'function'
                      ? parseMeterSigPart(String(rawValue || '').trim())
                      : null;
            if (!sig) return false;
            for (let i = 0; i < count; i++) {
                const idx = getRawMeterEntryIndexForBar(spec, start + i);
                if (idx < 0 || !entries[idx]) return false;
                entries[idx].sig = sig;
            }
        }
        const nextSpec = Object.assign({}, spec, {
            entries,
            mode:
                entries.length === 1
                    ? 'fixed'
                    : spec.mode === 'alternate'
                      ? 'alternate'
                      : 'sequence',
        });
        if (typeof setCommittedMeterSpec === 'function') {
            if (!setCommittedMeterSpec(nextSpec)) return false;
        }
        if (typeof clearTempoTrackEventsOverride === 'function') {
            clearTempoTrackEventsOverride();
        }
        if (typeof clearSignatureTrackEventsOverride === 'function') {
            clearSignatureTrackEventsOverride();
        }
        if (typeof clearMusicalGridPositionCache === 'function') clearMusicalGridPositionCache();
        if (typeof persistMusicalGridAndRedraw === 'function') {
            persistMusicalGridAndRedraw({ skipMeterCommit: true });
        } else if (typeof scheduleMusicalGridRedraw === 'function') {
            scheduleMusicalGridRedraw();
        }
        return true;
    }

    function commitMusicalTrackEdit() {
        if (!activeEdit) return;
        if (activeEdit.field === 'tempo') {
            commitTempoTrackEdit();
            return;
        }
        if (activeEdit.field === 'signature') {
            commitSignatureTrackEdit();
            return;
        }
        const { field, barStart, barCount, input } = activeEdit;
        const raw = input ? input.value : '';
        const ok = updateMeterFieldForBarRange(field, barStart, barCount, raw);
        cancelMusicalTrackEdit();
        if (ok) refreshMusicalGridTracks();
    }

    function beginMusicalTrackEdit(el, field, segment) {
        cancelMusicalTrackEdit();
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'musical-track-lane__segment-input';
        input.value = segment.text || '';
        bindMusicalTrackEditInput(input, {
            inputmode: field === 'tempo' ? 'decimal' : 'latin',
            onKeydown: (e) => {
                if (e.key === 'Enter') {
                    commitMusicalTrackEdit();
                    return true;
                }
                if (e.key === 'Escape') {
                    cancelMusicalTrackEdit();
                    refreshMusicalGridTracks();
                    return true;
                }
                if (field === 'tempo' || field === 'signature') {
                    return onMusicalTrackAddInputKeydown(e, field);
                }
                return false;
            },
        });
        input.setAttribute('aria-label', field === 'tempo' ? 'Tempo' : 'Signature');
        el.textContent = '';
        el.appendChild(input);
        focusMusicalTrackEditInput(input);
        activeEdit = {
            field,
            barStart: segment.barStart,
            barCount: segment.barCount,
            input,
            hostEl: el,
        };
        input.addEventListener('blur', () => {
            window.setTimeout(() => {
                if (activeEdit && activeEdit.input === input) commitMusicalTrackEdit();
            }, 0);
        });
    }

    function drawMeasureTrackNumberLabelsOnCanvas(ctx, h, master, settings, layoutW, xOffset) {
        if (!ctx || !(master > 0) || !settings || !settings.meterSpec || !(h > 0)) return;
        const segments = collectBarMeasureSegments(settings.meterSpec, master);
        if (!segments.length) return;
        const linePx =
            typeof timelineSecToContentLinePx === 'function'
                ? timelineSecToContentLinePx
                : (sec) => Math.round((sec / master) * layoutW) + 0.5;
        const visMin = xOffset - 0.5;
        const visMax = xOffset + layoutW + 0.5;
        const fontPx = MEASURE_TRACK_LABEL_FONT_PX;
        const pad = MEASURE_LABEL_SEGMENT_PAD_PX;
        ctx.save();
        ctx.font = '600 ' + fontPx + 'px system-ui, "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.fillStyle = '#e8ecf4';
        const y = h * 0.5;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const x = linePx(seg.startSec) + pad;
            if (x < visMin || x > visMax) continue;
            const label = seg.text || '';
            if (!label) continue;
            ctx.strokeText(label, x, y);
            ctx.fillText(label, x, y);
        }
        ctx.restore();
    }

    function renderMusicalTrackSegments(containerEl, field, segments, master, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!containerEl) return;
        if (field === 'measure') {
            containerEl.replaceChildren();
            containerEl.setAttribute('aria-hidden', segments.length ? 'false' : 'true');
            if (segments.length) {
                containerEl.setAttribute(
                    'aria-label',
                    'Measure ' + segments.map((s) => s.text).join(', '),
                );
            } else {
                containerEl.removeAttribute('aria-label');
            }
            return;
        }
        containerEl.replaceChildren();
        containerEl.setAttribute('aria-hidden', segments.length ? 'false' : 'true');
        const editable = o.editable !== false;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const pos = segmentLeftWidthPct(seg.startSec, seg.endSec, master);
            const el = document.createElement('div');
            el.className = 'musical-track-lane__segment';
            if (!editable) {
                el.classList.add('musical-track-lane__segment--readonly');
            }
            el.style.left = pos.leftPct + '%';
            el.style.width = pos.widthPct + '%';
            el.textContent = seg.text;
            if (editable) {
                el.title =
                    (field === 'tempo' ? 'Tempo ' : 'Signature ') +
                    seg.text +
                    ' — ダブルクリックで編集';
                el.dataset.barStart = String(seg.barStart);
                el.dataset.barCount = String(seg.barCount);
                el.addEventListener('dblclick', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    beginMusicalTrackEdit(el, field, seg);
                });
            } else {
                el.title = 'Measure ' + seg.text;
            }
            containerEl.appendChild(el);
        }
    }

    function drawMusicalTrackGridCanvas(canvasEl, master, settings) {
        function clearCanvas(el) {
            if (!el) return;
            const ctx0 = el.getContext('2d');
            if (ctx0) ctx0.clearRect(0, 0, el.width, el.height);
        }
        const suppressRehearsalFillsDuringRegionSwap =
            typeof window.isPlaybackRegionSwapRehearsalFillSuppressed === 'function' &&
            window.isPlaybackRegionSwapRehearsalFillSuppressed();
        const rehearsalFillOn =
            !suppressRehearsalFillsDuringRegionSwap &&
            typeof getMusicalGridRehearsalFillVisible === 'function' &&
            getMusicalGridRehearsalFillVisible();
        const gridOn =
            typeof getMusicalGridVisible === 'function' && getMusicalGridVisible();
        if (!canvasEl || !settings || !(master > 0)) {
            clearCanvas(canvasEl);
            return;
        }
        if (!rehearsalFillOn && !gridOn) {
            clearCanvas(canvasEl);
            return;
        }
        const track = canvasEl.closest('.audio-waveform-lane__track');
        const h = Math.max(1, track ? track.clientHeight | 0 : canvasEl.clientHeight | 0);
        if (h < 1) return;
        let ctx;
        let w;
        let layoutW;
        let xOffset = 0;
        if (typeof syncWaveformCanvasElement === 'function') {
            const sized = syncWaveformCanvasElement(canvasEl, h);
            if (!sized) return;
            ctx = sized.ctx;
            w = sized.wCss;
            const spec = sized.canvasSpec || {};
            layoutW = spec.contentW || sized.wCss;
            xOffset = spec.mode === 'window' ? spec.canvasLeft || 0 : 0;
        } else {
            w = Math.max(1, canvasEl.clientWidth | 0);
            layoutW = w;
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvasEl.width = Math.round(w * dpr);
            canvasEl.height = Math.round(h * dpr);
            canvasEl.style.width = w + 'px';
            canvasEl.style.height = h + 'px';
            ctx = canvasEl.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        ctx.clearRect(0, 0, w, h);
        const isMeasureCanvas =
            canvasEl === musicalMeasureGridCanvas ||
            (canvasEl && canvasEl.id === 'musicalMeasureGridCanvas');
        ctx.save();
        if (xOffset) ctx.translate(-xOffset, 0);
        if (
            rehearsalFillOn &&
            typeof drawRehearsalGroupFills === 'function'
        ) {
            drawRehearsalGroupFills(ctx, layoutW, h, master, settings);
        }
        if (gridOn && settings.meterSpec) {
            const zoom =
                typeof getWaveformTimelineZoom === 'function' ? getWaveformTimelineZoom() : 1;
            const showBeats = zoom >= 10;
            const lines = collectMusicalGridLines(settings.meterSpec, master, { showBeats });
            const linePx =
                typeof timelineSecToContentLinePx === 'function'
                    ? timelineSecToContentLinePx
                    : (sec) => Math.round((sec / master) * layoutW) + 0.5;
            const visMin = xOffset - 0.5;
            const visMax = xOffset + w + 0.5;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const xi = linePx(line.sec);
                if (xi < visMin || xi > visMax) continue;
                if (line.kind === 'bar') {
                    ctx.strokeStyle = 'rgba(120, 124, 134, 0.58)';
                    ctx.lineWidth = 1;
                    ctx.lineCap = 'butt';
                } else {
                    ctx.strokeStyle = 'rgba(0, 220, 255, 0.45)';
                    ctx.lineWidth = 1;
                }
                ctx.beginPath();
                ctx.moveTo(xi, 0);
                ctx.lineTo(xi, h);
                ctx.stroke();
            }
        }
        if (isMeasureCanvas) {
            drawMeasureTrackNumberLabelsOnCanvas(ctx, h, master, settings, layoutW, xOffset);
        }
        ctx.restore();
    }

    function refreshMusicalGridTracks(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const preserveActiveEdit =
            o.preserveActiveEdit === true || !!(activeEdit && activeEdit.hostEl);
        if (activeEdit && !preserveActiveEdit) cancelMusicalTrackEdit();
        const settings =
            typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!settings || !settings.meterSpec || !(master > 0)) {
            if (musicalTempoSegments) musicalTempoSegments.replaceChildren();
            if (musicalSignatureSegments) musicalSignatureSegments.replaceChildren();
            if (musicalMeasureSegments) musicalMeasureSegments.replaceChildren();
            drawMusicalTrackGridCanvas(musicalRehearsalGridCanvas, 0, null);
            drawMusicalTrackGridCanvas(musicalTempoGridCanvas, 0, null);
            drawMusicalTrackGridCanvas(musicalSignatureGridCanvas, 0, null);
            drawMusicalTrackGridCanvas(musicalMeasureGridCanvas, 0, null);
            if (typeof refreshRehearsalTrack === 'function') refreshRehearsalTrack();
            return;
        }
        const tempoEvents =
            typeof getTempoTrackEvents === 'function'
                ? getTempoTrackEvents(settings.meterSpec, master)
                : [];
        if (!tempoBoundaryDragActive && !tempoValuePointerState) {
            renderTempoTrackSegments(tempoEvents, settings.meterSpec, master);
        }
        const sigEvents =
            typeof getSignatureTrackEvents === 'function'
                ? getSignatureTrackEvents(settings.meterSpec, master)
                : [];
        if (!sigBoundaryDragActive && !sigValuePointerState) {
            renderSignatureTrackSegments(sigEvents, settings.meterSpec, master);
        }
        const measureSegs = collectBarMeasureSegments(settings.meterSpec, master);
        renderMusicalTrackSegments(musicalMeasureSegments, 'measure', measureSegs, master, {
            editable: false,
        });
        drawMusicalTrackGridCanvas(musicalRehearsalGridCanvas, master, settings);
        drawMusicalTrackGridCanvas(musicalTempoGridCanvas, master, settings);
        drawMusicalTrackGridCanvas(musicalSignatureGridCanvas, master, settings);
        drawMusicalTrackGridCanvas(musicalMeasureGridCanvas, master, settings);
        if (typeof refreshRehearsalTrack === 'function') refreshRehearsalTrack();
        if (typeof window.scheduleWaveformRegionOverlayRefresh === 'function') {
            window.scheduleWaveformRegionOverlayRefresh();
        }
    }

    function initMusicalGridTracks() {
        if (typeof initRehearsalTrack === 'function') initRehearsalTrack();
        bindTempoTrackBackgroundEdit();
        bindSignatureTrackBackgroundEdit();
        bindTrackSelectionClear();
        refreshMusicalGridTracks();
    }

    window.getMusicalTrackLaneCount = getMusicalTrackLaneCount;
    window.getWaveformAudioLaneCount = getWaveformAudioLaneCount;
    window.getTotalTimelineLaneCount = getTotalTimelineLaneCount;
    window.refreshMusicalGridTracks = refreshMusicalGridTracks;
    window.initMusicalGridTracks = initMusicalGridTracks;
    window.handleMusicalTrackUndoKeydown = handleMusicalTrackUndoKeydown;
    window.handleMusicalTrackRedoKeydown = handleMusicalTrackRedoKeydown;
    window.handleMusicalTrackDeleteKeydown = handleMusicalTrackDeleteKeydown;
    window.selectMusicalTrackEvent = selectTrackEvent;
    window.requestMusicalTrackUndoCapture = requestMusicalTrackUndoCapture;
    window.beginMusicalTrackUndoGesture = beginMusicalTrackUndoGesture;
    window.commitMusicalTrackUndoGesture = commitMusicalTrackUndoGesture;
    window.cancelMusicalTrackUndoGesture = cancelMusicalTrackUndoGesture;
    window.ensureMeterSpecForTrackEdit = ensureMeterSpecForTrackEdit;
    window.positionMusicalTrackAddInputWrap = positionMusicalTrackAddInputWrap;
    window.markMusicalTrackEditOpened = markMusicalTrackEditOpened;
    window.shouldIgnoreMusicalTrackEditBlur = shouldIgnoreMusicalTrackEditBlur;
    window.bindMusicalTrackValueEditGesture = bindMusicalTrackValueEditGesture;
    window.bindMusicalTrackEditInput = bindMusicalTrackEditInput;
    window.focusMusicalTrackEditInput = focusMusicalTrackEditInput;
    window.isMusicalTrackEditInputActive = isMusicalTrackEditInputActive;
    window.attachMusicalTrackEditBlurHandler = attachMusicalTrackEditBlurHandler;
    window.measureLabelMinWidthPxForBarNumber = measureLabelMinWidthPxForBarNumber;
    window.filterMeasureBarCandidatesForDisplay = filterMeasureBarCandidatesForDisplay;
    window.shouldShowMeasureLabelAtBar = shouldShowMeasureLabelAtBar;
    window.getRehearsalMeasureLabelFontPx = function getRehearsalMeasureLabelFontPx() {
        return REHEARSAL_MEASURE_LABEL_FONT_PX;
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMusicalGridTracks);
    } else {
        initMusicalGridTracks();
    }
})();
