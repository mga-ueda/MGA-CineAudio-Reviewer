/**
 * musical-grid-rehearsal.js — Rehearsal Mark トラック（波形最上部）と背景着色
 */
(function musicalGridRehearsalModule() {
    let activeRehearsalEdit = null;
    let rehearsalBoundaryDragActive = false;
    let rehearsalBoundaryDragPointerId = null;
    let rehearsalBoundaryDragEventIndex = -1;
    let rehearsalBoundaryDragEvents = null;
    let rehearsalBoundaryDragDidMove = false;
    let rehearsalBoundaryDragLastSec = NaN;
    let rehearsalBoundaryDragStartSec = NaN;
    let rehearsalPointerDocMove = null;
    let rehearsalPointerDocUp = null;
    let rehearsalPointerState = null;
    const REHEARSAL_DRAG_SLOP_PX = 8;
    let rehearsalBoundaryDragDocMove = null;
    let rehearsalBoundaryDragDocUp = null;
    let rehearsalTrackDblClickBound = false;
    let selectedRehearsalEventIndex = -1;

    function rehearsalMasterDurationSec() {
        return typeof getMasterTransportDurationSec === 'function'
            ? getMasterTransportDurationSec()
            : 0;
    }

    function rehearsalTrackEditSettings() {
        if (typeof ensureMeterSpecForTrackEdit === 'function') {
            const ensured = ensureMeterSpecForTrackEdit();
            if (ensured) return ensured;
        }
        return typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
    }

    function firstAlphaCharOfRehearsalLabel(label) {
        const s = String(label == null ? '' : label).trim();
        const m = s.match(/[A-Za-z]/);
        return m ? m[0].toUpperCase() : null;
    }

    function isSingleLetterRehearsalLabel(label) {
        return /^[A-Za-z]$/.test(String(label == null ? '' : label).trim());
    }

    function rehearsalMarkLabelCompareKey(label) {
        const normalized =
            typeof normalizeRehearsalMarkLabel === 'function'
                ? normalizeRehearsalMarkLabel(label)
                : String(label == null ? '' : label).trim();
        return normalized ? normalized.toUpperCase() : '';
    }

    function rehearsalMarkLabelsInUse(events) {
        const used = new Set();
        const list = events || [];
        for (let i = 0; i < list.length; i++) {
            const key = rehearsalMarkLabelCompareKey(list[i].label);
            if (key) used.add(key);
        }
        return used;
    }

    /** A→…→Z→AA→AB→…（Excel 列名と同様） */
    function nextRehearsalMarkLetterAfter(letter) {
        const s = String(letter == null ? '' : letter).trim().toUpperCase();
        if (!s) return 'A';
        if (/^[A-Z]$/.test(s)) {
            if (s === 'Z') return 'AA';
            return String.fromCharCode(s.charCodeAt(0) + 1);
        }
        if (/^[A-Z]+$/.test(s)) {
            const chars = s.split('');
            for (let i = chars.length - 1; i >= 0; i--) {
                const code = chars[i].charCodeAt(0);
                if (code < 90) {
                    chars[i] = String.fromCharCode(code + 1);
                    return chars.join('');
                }
                chars[i] = 'A';
            }
            return 'A' + chars.join('');
        }
        return 'A';
    }

    function resolveUnusedRehearsalMarkLabel(preferred, usedLabels) {
        let candidate =
            preferred && String(preferred).trim()
                ? String(preferred).trim().toUpperCase()
                : 'A';
        const used = usedLabels || new Set();
        let guard = 0;
        while (used.has(rehearsalMarkLabelCompareKey(candidate)) && guard < 10000) {
            candidate = nextRehearsalMarkLetterAfter(candidate);
            guard += 1;
        }
        return candidate;
    }

    function prevRehearsalMarkLetterBefore(letter) {
        if (!letter) return 'A';
        const code = letter.toUpperCase().charCodeAt(0);
        if (code > 65) return String.fromCharCode(code - 1);
        return 'A';
    }

    function bumpRehearsalMarkLabelFirstLetter(label) {
        const s = String(label == null ? '' : label).trim();
        const first = firstAlphaCharOfRehearsalLabel(s);
        if (!first) return s;
        const next = nextRehearsalMarkLetterAfter(first);
        const idx = s.search(/[A-Za-z]/);
        return s.slice(0, idx) + next + s.slice(idx + 1);
    }

    function rehearsalMarkInsertContext(events, rawSec, master, anchorEventIndex) {
        const list = events || [];
        if (!list.length) return { prev: null, next: null };
        if (anchorEventIndex >= 0 && anchorEventIndex < list.length) {
            return {
                prev: list[anchorEventIndex],
                next:
                    anchorEventIndex + 1 < list.length
                        ? list[anchorEventIndex + 1]
                        : null,
            };
        }
        if (!Number.isFinite(rawSec) || !(master > 0)) {
            return {
                prev: list[list.length - 1],
                next: null,
            };
        }
        for (let i = 0; i < list.length; i++) {
            const startSec = list[i].sec;
            const endSec = i + 1 < list.length ? list[i + 1].sec : master;
            if (rawSec >= startSec - 1e-6 && rawSec < endSec - 1e-6) {
                return {
                    prev: list[i],
                    next: i + 1 < list.length ? list[i + 1] : null,
                };
            }
        }
        if (rawSec < list[0].sec + 1e-6) {
            return { prev: null, next: list[0] };
        }
        return {
            prev: list[list.length - 1],
            next: null,
        };
    }

    /** 追加時のデフォルトラベル（直前マークの先頭英字+1。次が D2 等ならその先頭英字-1。既存名と重複する場合は未使用の英字へ） */
    function defaultRehearsalMarkLabelForInsert(events, rawSec, master, anchorEventIndex) {
        const neighbors = rehearsalMarkInsertContext(
            events,
            rawSec,
            master,
            anchorEventIndex != null ? anchorEventIndex | 0 : -1,
        );
        let candidate = 'A';
        const nextMark = neighbors.next;
        if (nextMark && !isSingleLetterRehearsalLabel(nextMark.label)) {
            const nextFirst = firstAlphaCharOfRehearsalLabel(nextMark.label);
            if (nextFirst) candidate = prevRehearsalMarkLetterBefore(nextFirst);
        } else {
            const prevMark = neighbors.prev;
            if (prevMark) {
                const prevFirst = firstAlphaCharOfRehearsalLabel(prevMark.label);
                if (prevFirst) candidate = nextRehearsalMarkLetterAfter(prevFirst);
            }
        }
        return resolveUnusedRehearsalMarkLabel(candidate, rehearsalMarkLabelsInUse(events));
    }

    function shiftRehearsalMarkLabelsAfterDuplicate(events, changedIndex) {
        if (!events || changedIndex < 0 || changedIndex >= events.length - 1) return;
        const label = events[changedIndex].label;
        if (events[changedIndex + 1].label !== label) return;
        for (let j = changedIndex + 1; j < events.length; j++) {
            events[j] = Object.assign({}, events[j], {
                label: bumpRehearsalMarkLabelFirstLetter(events[j].label),
            });
        }
    }

    function rehearsalMarkDragSecCollidesWithNeighbor(list, idx, sec, meterSpec, master) {
        if (!list || idx < 0 || idx >= list.length || !Number.isFinite(sec)) return false;
        const bar =
            meterSpec && master > 0
                ? rehearsalBarIndexForSec(sec, meterSpec, master)
                : null;
        for (let i = 0; i < list.length; i++) {
            if (i === idx) continue;
            if (Math.abs(list[i].sec - sec) < 1e-6) return true;
            if (bar != null && meterSpec && master > 0) {
                const otherBar = rehearsalBarIndexForSec(list[i].sec, meterSpec, master);
                if (otherBar != null && otherBar === bar) return true;
            }
        }
        return false;
    }

    function resolveRehearsalMarkDragSec(list, idx, pointerSec, master, meterSpec, snapOpt) {
        if (!list || idx < 0 || idx >= list.length || !Number.isFinite(pointerSec)) {
            return { sec: NaN, valid: false };
        }
        const minSec = idx > 0 ? list[idx - 1].sec + 1e-6 : 0;
        const maxSec =
            idx + 1 < list.length ? list[idx + 1].sec - 1e-6 : master - 1e-6;
        if (minSec > maxSec + 1e-9) {
            return { sec: NaN, valid: false };
        }
        let next = snapRehearsalTrackDragSec(pointerSec, snapOpt);
        next = Math.max(minSec, Math.min(maxSec, next));
        if (rehearsalMarkDragSecCollidesWithNeighbor(list, idx, next, meterSpec, master)) {
            return { sec: next, valid: false };
        }
        return { sec: next, valid: true };
    }

    function collectRehearsalMarkDrawRanges(master, meterSpec) {
        if (!(master > 0)) return [];
        const events =
            typeof getRehearsalMarkTrackEvents === 'function'
                ? getRehearsalMarkTrackEvents(meterSpec, master)
                : [];
        if (!events.length) return [];
        const ranges = [];
        let paletteIndex = 0;
        const firstStart = events[0].sec;
        if (firstStart > 1e-6) {
            const unlabeled =
                typeof REHEARSAL_MARK_UNLABELED !== 'undefined' ? REHEARSAL_MARK_UNLABELED : '_';
            ranges.push({
                startSec: 0,
                endSec: firstStart,
                paletteIndex: paletteIndex,
                label: unlabeled,
                fromRehearsalEvent: false,
            });
            paletteIndex += 1;
        }
        for (let i = 0; i < events.length; i++) {
            const startSec = events[i].sec;
            const endSec = i + 1 < events.length ? events[i + 1].sec : master;
            if (!(endSec > startSec + 1e-9)) continue;
            ranges.push({
                startSec: startSec,
                endSec: endSec,
                paletteIndex: paletteIndex,
                label: events[i].label,
                fromRehearsalEvent: true,
            });
            paletteIndex += 1;
        }
        return ranges;
    }

    function drawRehearsalMarkFills(ctx, w, h, master, meterSpec) {
        const ranges = collectRehearsalMarkDrawRanges(master, meterSpec);
        if (!ranges.length) return;
        const secToX = (sec) => (sec / master) * w;
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            const x0 = secToX(r.startSec);
            const x1 = secToX(r.endSec);
            if (x1 <= x0 + 0.25) continue;
            ctx.fillStyle =
                r.paletteIndex % 2 === 0
                    ? typeof BAR_GROUP_FILL_A !== 'undefined'
                        ? BAR_GROUP_FILL_A
                        : 'rgba(200, 48, 58, 0.14)'
                    : typeof BAR_GROUP_FILL_B !== 'undefined'
                      ? BAR_GROUP_FILL_B
                      : 'rgba(48, 110, 220, 0.14)';
            ctx.fillRect(x0, 0, x1 - x0, h);
        }
    }

    function snapRehearsalTrackDragSec(sec, opt) {
        if (typeof snapSecToMusicalGridBar === 'function') {
            return snapSecToMusicalGridBar(sec, opt);
        }
        return Math.max(0, Number(sec) || 0);
    }

    function transportSecFromRehearsalTrackPointer(clientX) {
        if (typeof transportSecFromMusicalTrackPointer === 'function') {
            return transportSecFromMusicalTrackPointer(clientX);
        }
        if (typeof transportSecFromClientX === 'function') {
            return transportSecFromClientX(clientX);
        }
        return NaN;
    }

    function segmentLeftPct(sec, master) {
        if (!(master > 0)) return 0;
        return typeof transportSecToTimelineLeftPercent === 'function'
            ? transportSecToTimelineLeftPercent(sec)
            : (sec / master) * 100;
    }

    function segmentLeftWidthPct(startSec, endSec, master) {
        if (!(master > 0)) return { leftPct: 0, widthPct: 0 };
        const leftPct = segmentLeftPct(startSec, master);
        const rightPct = segmentLeftPct(endSec, master);
        return {
            leftPct,
            widthPct: Math.max(0.08, rightPct - leftPct),
        };
    }

    function rehearsalSegmentRange(events, index, master) {
        const startSec = events[index].sec;
        const endSec = index + 1 < events.length ? events[index + 1].sec : master;
        return { startSec, endSec };
    }

    function rehearsalSnapSecForAdd(sec) {
        let snapped = snapRehearsalTrackDragSec(sec, { addSnap: true });
        if (!Number.isFinite(snapped)) snapped = Math.max(0, Number(sec) || 0);
        return snapped;
    }

    function rehearsalBarBoundaries(meterSpec, master) {
        if (!meterSpec || !(master > 0)) return null;
        if (typeof collectPlaybackAlignedBarBoundarySecs === 'function') {
            return collectPlaybackAlignedBarBoundarySecs(meterSpec, master);
        }
        if (typeof collectBarBoundarySecs === 'function') {
            return collectBarBoundarySecs(meterSpec, master);
        }
        return null;
    }

    function rehearsalBarIndexForSec(sec, meterSpec, master) {
        const boundaries = rehearsalBarBoundaries(meterSpec, master);
        if (!boundaries || boundaries.length < 2) return null;
        if (typeof barIndexForBoundarySec !== 'function') return null;
        return barIndexForBoundarySec(sec, boundaries);
    }

    /** 既存マーク編集: クリック位置の小節とマークの小節が一致するときのみ（隣接小節の追加を誤編集しない） */
    function findRehearsalMarkEditIndexAtPointer(events, rawSec, snappedSec, meterSpec, master) {
        if (!events || !events.length || !Number.isFinite(rawSec)) return -1;
        const rawBar = rehearsalBarIndexForSec(rawSec, meterSpec, master);
        if (rawBar != null) {
            for (let i = 0; i < events.length; i++) {
                const markBar = rehearsalBarIndexForSec(events[i].sec, meterSpec, master);
                if (markBar != null && markBar === rawBar) return i;
            }
            return -1;
        }
        for (let i = 0; i < events.length; i++) {
            if (Math.abs(events[i].sec - snappedSec) < 1e-6) return i;
        }
        return -1;
    }

    function showRehearsalNewMarkInput(
        ev,
        snappedSec,
        meterSpec,
        durationSec,
        events,
        anchorEventIndex,
        rawSec,
    ) {
        const list = events || [];
        const refSec = Number.isFinite(rawSec) ? rawSec : snappedSec;
        showRehearsalTrackAddInput({
            trackEl: musicalRehearsalTrack,
            ev: ev,
            initialValue: defaultRehearsalMarkLabelForInsert(
                list,
                refSec,
                durationSec,
                anchorEventIndex != null ? anchorEventIndex | 0 : -1,
            ),
            editState: {
                sec: snappedSec,
                eventIndex: -1,
                isNew: true,
                meterSpec: meterSpec,
                durationSec: durationSec,
            },
        });
    }

    function rehearsalPointerMoveExceedsDragSlop(st, clientX, clientY) {
        const dx = clientX - st.startX;
        const dy = clientY - st.startY;
        return (
            Math.abs(dx) >= REHEARSAL_DRAG_SLOP_PX &&
            Math.abs(dx) >= Math.abs(dy)
        );
    }

    function persistRehearsalMarkTrackEvents(events, meterSpec, durationSec) {
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('rehearsal/persist/begin', {
                durationSec: durationSec,
                events:
                    typeof musicalTrackPersistDiagSummarizeRehearsalEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeRehearsalEvents(events)
                        : { count: Array.isArray(events) ? events.length : 0 },
                before:
                    typeof musicalTrackPersistDiagLiveState === 'function'
                        ? musicalTrackPersistDiagLiveState()
                        : null,
            });
        }
        if (typeof setRehearsalMarkTrackEvents === 'function') {
            setRehearsalMarkTrackEvents(events, meterSpec, durationSec);
        }
        if (typeof writePrefs === 'function') {
            writePrefs();
        }
        if (typeof persistMusicalGridAndRedraw === 'function') {
            persistMusicalGridAndRedraw({ skipMeterCommit: true });
        } else if (typeof scheduleMusicalGridRedraw === 'function') {
            scheduleMusicalGridRedraw();
        }
        if (typeof flushPersistSessionNow === 'function') {
            void flushPersistSessionNow()
                .then(() => {
                    if (typeof musicalTrackPersistDiagLog === 'function') {
                        musicalTrackPersistDiagLog('rehearsal/persist/flush-ok', {
                            after:
                                typeof musicalTrackPersistDiagLiveState === 'function'
                                    ? musicalTrackPersistDiagLiveState()
                                    : null,
                        });
                    }
                })
                .catch((err) => {
                    if (typeof musicalTrackPersistDiagLog === 'function') {
                        musicalTrackPersistDiagLog('rehearsal/persist/flush-fail', {
                            err: err && err.message ? err.message : String(err),
                        });
                    }
                });
        } else if (typeof schedulePersistSession === 'function') {
            schedulePersistSession();
            if (typeof musicalTrackPersistDiagLog === 'function') {
                musicalTrackPersistDiagLog('rehearsal/persist/scheduled', {
                    after:
                        typeof musicalTrackPersistDiagLiveState === 'function'
                            ? musicalTrackPersistDiagLiveState()
                            : null,
                });
            }
        }
        if (typeof refreshAllRegionRehearsalMarkLabels === 'function') {
            refreshAllRegionRehearsalMarkLabels();
        }
    }

    function selectRehearsalTrackEvent(eventIndex) {
        selectedRehearsalEventIndex = eventIndex | 0;
        if (typeof selectMusicalTrackEvent === 'function') {
            selectMusicalTrackEvent('rehearsal', selectedRehearsalEventIndex);
        }
        syncRehearsalTrackSelectionUi();
    }

    function clearRehearsalTrackSelection() {
        if (selectedRehearsalEventIndex < 0) return;
        selectedRehearsalEventIndex = -1;
        syncRehearsalTrackSelectionUi();
    }

    function syncRehearsalTrackSelectionUi() {
        if (!musicalRehearsalSegments) return;
        const nodes = musicalRehearsalSegments.querySelectorAll(
            '.musical-track-lane__segment--selected',
        );
        for (let i = 0; i < nodes.length; i++) {
            nodes[i].classList.remove('musical-track-lane__segment--selected');
        }
        if (selectedRehearsalEventIndex < 0) return;
        const el = musicalRehearsalSegments.querySelector(
            '[data-event-index="' + selectedRehearsalEventIndex + '"]',
        );
        if (el) el.classList.add('musical-track-lane__segment--selected');
    }

    function cancelRehearsalTrackEdit() {
        if (!activeRehearsalEdit) return;
        if (activeRehearsalEdit.hostEl && activeRehearsalEdit.hostEl.parentElement) {
            activeRehearsalEdit.hostEl.remove();
        }
        if (activeRehearsalEdit.trackEl) {
            activeRehearsalEdit.trackEl.classList.remove(
                'musical-track-lane__track--add-input-open',
            );
        }
        activeRehearsalEdit = null;
    }

    function showRehearsalTrackAddInput(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        cancelRehearsalTrackEdit();
        const trackEl = o.trackEl;
        const ev = o.ev;
        const editState = o.editState;
        if (!trackEl || !ev || !editState) return;
        const wrap = document.createElement('div');
        wrap.className =
            'musical-track-lane__add-input-wrap musical-track-lane__add-input-wrap--rehearsal';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'musical-track-lane__add-input';
        input.value = o.initialValue != null ? String(o.initialValue) : '';
        if (typeof bindMusicalTrackEditInput === 'function') {
            bindMusicalTrackEditInput(input);
        }
        input.setAttribute('aria-label', 'Rehearsal Mark');
        wrap.appendChild(input);
        if (typeof positionMusicalTrackAddInputWrap === 'function') {
            positionMusicalTrackAddInputWrap(wrap, ev);
        } else {
            wrap.style.position = 'fixed';
            wrap.style.left = Math.round(ev.clientX) + 'px';
            wrap.style.top = Math.round(ev.clientY + 4) + 'px';
            document.body.appendChild(wrap);
        }
        trackEl.classList.add('musical-track-lane__track--add-input-open');
        if (typeof markMusicalTrackEditOpened === 'function') {
            markMusicalTrackEditOpened();
        }
        activeRehearsalEdit = Object.assign({}, editState, {
            input: input,
            hostEl: wrap,
            trackEl: trackEl,
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commitRehearsalTrackEdit();
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                cancelRehearsalTrackEdit();
                refreshRehearsalTrack();
            }
        });
        if (typeof attachMusicalTrackEditBlurHandler === 'function') {
            attachMusicalTrackEditBlurHandler(input, () => {
                if (!activeRehearsalEdit || activeRehearsalEdit.input !== input) return;
                commitRehearsalTrackEdit();
            });
        } else {
            input.addEventListener('blur', () => {
                window.setTimeout(() => {
                    if (!activeRehearsalEdit || activeRehearsalEdit.input !== input) return;
                    commitRehearsalTrackEdit();
                }, 0);
            });
        }
        if (typeof focusMusicalTrackEditInput === 'function') {
            focusMusicalTrackEditInput(input);
        } else {
            input.focus();
            input.select();
        }
    }

    function prepareRehearsalAddInput(ev, sec, meterSpec, durationSec) {
        const events =
            typeof getRehearsalMarkTrackEvents === 'function'
                ? getRehearsalMarkTrackEvents(meterSpec, durationSec).slice()
                : [];
        const snapped = rehearsalSnapSecForAdd(sec);
        const editIndex = findRehearsalMarkEditIndexAtPointer(
            events,
            sec,
            snapped,
            meterSpec,
            durationSec,
        );
        if (editIndex >= 0) {
            openRehearsalMarkEditInput(editIndex, ev, durationSec);
            return;
        }
        showRehearsalNewMarkInput(ev, snapped, meterSpec, durationSec, events, -1, sec);
    }

    function onRehearsalSegmentDblClick(e, eventIndex, events, master) {
        if (e.target.closest('.musical-track-lane__add-input-wrap')) return;
        e.preventDefault();
        e.stopPropagation();
        const settings = rehearsalTrackEditSettings();
        if (!(master > 0)) return;
        if (e.target.closest('.musical-track-lane__segment-value--rehearsal-mark')) return;
        const sec = transportSecFromRehearsalTrackPointer(e.clientX);
        if (!Number.isFinite(sec)) return;
        const snapped = rehearsalSnapSecForAdd(sec);
        const meterSpec = settings && settings.meterSpec;
        const editIndex = findRehearsalMarkEditIndexAtPointer(
            events,
            sec,
            snapped,
            meterSpec,
            master,
        );
        if (editIndex >= 0) {
            openRehearsalMarkEditInput(editIndex, e, master);
            return;
        }
        showRehearsalNewMarkInput(e, snapped, meterSpec, master, events, eventIndex, sec);
    }

    function commitRehearsalTrackEdit() {
        if (!activeRehearsalEdit) return;
        let { input, meterSpec, durationSec } = activeRehearsalEdit;
        let { eventIndex, isNew, sec } = activeRehearsalEdit;
        const label =
            typeof normalizeRehearsalMarkLabel === 'function'
                ? normalizeRehearsalMarkLabel(input ? input.value : '')
                : String(input ? input.value : '').trim();
        if (!(durationSec > 0)) {
            if (typeof musicalTrackPersistDiagLog === 'function') {
                musicalTrackPersistDiagLog('rehearsal/commit/abort-no-duration', {
                    durationSec: durationSec,
                });
            }
            cancelRehearsalTrackEdit();
            return;
        }
        if (!meterSpec) {
            const settings = rehearsalTrackEditSettings();
            meterSpec = settings && settings.meterSpec;
        }
        if (!label) {
            cancelRehearsalTrackEdit();
            refreshRehearsalTrack();
            return;
        }
        if (!activeRehearsalEdit.undoCaptured && typeof requestMusicalTrackUndoCapture === 'function') {
            requestMusicalTrackUndoCapture();
            activeRehearsalEdit.undoCaptured = true;
        }
        const events =
            typeof getRehearsalMarkTrackEvents === 'function'
                ? getRehearsalMarkTrackEvents(meterSpec, durationSec).slice()
                : [];
        if (isNew) {
            events.push({ sec: sec, label: label });
            events.sort((a, b) => a.sec - b.sec);
            for (let i = 0; i < events.length; i++) {
                if (Math.abs(events[i].sec - sec) < 1e-6) {
                    eventIndex = i;
                    break;
                }
            }
        } else if (eventIndex >= 0 && eventIndex < events.length) {
            events[eventIndex] = Object.assign({}, events[eventIndex], { label: label });
        }
        if (eventIndex >= 0 && eventIndex < events.length) {
            shiftRehearsalMarkLabelsAfterDuplicate(events, eventIndex);
        }
        if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('rehearsal/commit/begin', {
                isNew: !!isNew,
                sec: sec,
                label: label,
                durationSec: durationSec,
                events:
                    typeof musicalTrackPersistDiagSummarizeRehearsalEvents === 'function'
                        ? musicalTrackPersistDiagSummarizeRehearsalEvents(events)
                        : { count: events.length },
            });
        }
        persistRehearsalMarkTrackEvents(events, meterSpec, durationSec);
        if (
            isNew &&
            typeof syncExtraTrackRegionsForRehearsalMarkChange === 'function'
        ) {
            syncExtraTrackRegionsForRehearsalMarkChange({ splitAtSec: sec, silent: true });
        }
        cancelRehearsalTrackEdit();
        refreshRehearsalTrack();
    }

    function deleteRehearsalEventAtIndex(eventIndex, meterSpec, durationSec) {
        if (eventIndex < 0) return false;
        const events =
            typeof getRehearsalMarkTrackEvents === 'function'
                ? getRehearsalMarkTrackEvents(meterSpec, durationSec).slice()
                : [];
        if (eventIndex < 0 || eventIndex >= events.length) return false;
        const deletedSec = events[eventIndex].sec;
        events.splice(eventIndex, 1);
        persistRehearsalMarkTrackEvents(events, meterSpec, durationSec);
        if (typeof syncExtraTrackRegionsForRehearsalMarkChange === 'function') {
            syncExtraTrackRegionsForRehearsalMarkChange({
                bondAtSec: deletedSec,
                silent: true,
            });
        }
        return true;
    }

    /** transport 冒頭（0s 付近）のリハーサルマークを削除 — head pad swap undo 用 */
    function removeRehearsalMarkAtTransportHead(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const settings = rehearsalTrackEditSettings();
        const master = rehearsalMasterDurationSec();
        if (!(master > 0)) return false;
        const meterSpec = settings && settings.meterSpec;
        const events =
            typeof getRehearsalMarkTrackEvents === 'function'
                ? getRehearsalMarkTrackEvents(meterSpec, master).slice()
                : [];
        const eps = rehearsalMarkSlotSecMatchEps();
        let headIdx = -1;
        for (let i = 0; i < events.length; i++) {
            const sec = Number(events[i].sec);
            if (Number.isFinite(sec) && Math.abs(sec) < eps) {
                headIdx = i;
                break;
            }
        }
        if (headIdx < 0) return false;
        if (!o.skipUndo && typeof requestMusicalTrackUndoCapture === 'function') {
            requestMusicalTrackUndoCapture();
        }
        const ok = deleteRehearsalEventAtIndex(headIdx, meterSpec, master);
        if (ok) {
            selectedRehearsalEventIndex = -1;
            refreshRehearsalTrack();
        }
        return ok;
    }

    function deleteSelectedRehearsalTrackEvent() {
        if (selectedRehearsalEventIndex < 0) return false;
        const settings = rehearsalTrackEditSettings();
        const master = rehearsalMasterDurationSec();
        if (!(master > 0)) return false;
        if (typeof requestMusicalTrackUndoCapture === 'function') {
            requestMusicalTrackUndoCapture();
        }
        const meterSpec = settings && settings.meterSpec;
        const ok = deleteRehearsalEventAtIndex(
            selectedRehearsalEventIndex,
            meterSpec,
            master,
        );
        if (ok) {
            selectedRehearsalEventIndex = -1;
            refreshRehearsalTrack();
        }
        return ok;
    }

    function updateRehearsalTrackSegmentLayout(events, master) {
        if (!musicalRehearsalSegments || !(master > 0) || !events || !events.length) {
            return;
        }
        for (let i = 0; i < events.length; i++) {
            const el = musicalRehearsalSegments.querySelector(
                '[data-event-index="' + i + '"]',
            );
            if (!el) continue;
            const range = rehearsalSegmentRange(events, i, master);
            const pos = segmentLeftWidthPct(range.startSec, range.endSec, master);
            el.style.left = pos.leftPct + '%';
            el.style.width = pos.widthPct + '%';
        }
        const settings = rehearsalTrackEditSettings();
        const meterSpec = settings && settings.meterSpec;
        if (meterSpec) {
            renderRehearsalTrackMeasureNumbers(meterSpec, master);
        } else if (musicalRehearsalMeasureSegments) {
            musicalRehearsalMeasureSegments.replaceChildren();
            musicalRehearsalMeasureSegments.setAttribute('aria-hidden', 'true');
        }
    }

    function clearRehearsalPointerListeners() {
        if (rehearsalPointerDocMove) {
            document.removeEventListener('pointermove', rehearsalPointerDocMove);
            rehearsalPointerDocMove = null;
        }
        if (rehearsalPointerDocUp) {
            document.removeEventListener('pointerup', rehearsalPointerDocUp);
            document.removeEventListener('pointercancel', rehearsalPointerDocUp);
            rehearsalPointerDocUp = null;
        }
    }

    function cancelRehearsalValuePointerGesture() {
        rehearsalPointerState = null;
        clearRehearsalPointerListeners();
        endRehearsalBoundaryDrag(true);
    }

    function endRehearsalBoundaryDrag(cancelled) {
        rehearsalBoundaryDragActive = false;
        rehearsalBoundaryDragPointerId = null;
        rehearsalBoundaryDragEventIndex = -1;
        rehearsalBoundaryDragEvents = null;
        rehearsalBoundaryDragDidMove = false;
        rehearsalBoundaryDragLastSec = NaN;
        rehearsalBoundaryDragStartSec = NaN;
        rehearsalPointerState = null;
        clearRehearsalPointerListeners();
        if (rehearsalBoundaryDragDocMove) {
            document.removeEventListener('pointermove', rehearsalBoundaryDragDocMove);
            rehearsalBoundaryDragDocMove = null;
        }
        if (rehearsalBoundaryDragDocUp) {
            document.removeEventListener('pointerup', rehearsalBoundaryDragDocUp);
            document.removeEventListener('pointercancel', rehearsalBoundaryDragDocUp);
            rehearsalBoundaryDragDocUp = null;
        }
        if (musicalRehearsalTrack) {
            musicalRehearsalTrack.classList.remove('musical-track-lane__track--rehearsal-drag');
        }
        if (cancelled && typeof cancelMusicalTrackUndoGesture === 'function') {
            cancelMusicalTrackUndoGesture();
        }
    }

    function openRehearsalMarkEditInput(eventIndex, ev, master) {
        cancelRehearsalValuePointerGesture();
        if (!(master > 0)) return;
        const settings = rehearsalTrackEditSettings();
        const meterSpec = settings && settings.meterSpec;
        const events =
            typeof getRehearsalMarkTrackEvents === 'function'
                ? getRehearsalMarkTrackEvents(meterSpec, master)
                : [];
        const mark = events[eventIndex];
        if (!mark) return;
        showRehearsalTrackAddInput({
            trackEl: musicalRehearsalTrack,
            ev: ev,
            initialValue: mark.label,
            editState: {
                sec: mark.sec,
                eventIndex: eventIndex,
                isNew: false,
                meterSpec: meterSpec,
                durationSec: master,
            },
        });
    }

    function beginRehearsalMarkDrag(st) {
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
        if (typeof beginMusicalTrackUndoGesture === 'function') {
            beginMusicalTrackUndoGesture();
        }
        rehearsalBoundaryDragActive = true;
        rehearsalBoundaryDragDidMove = false;
        rehearsalBoundaryDragLastSec = NaN;
        const idx = st.eventIndex;
        const list = st.events;
        rehearsalBoundaryDragStartSec =
            list && idx >= 0 && idx < list.length && Number.isFinite(list[idx].sec)
                ? list[idx].sec
                : NaN;
        rehearsalBoundaryDragPointerId = st.pointerId;
        rehearsalBoundaryDragEventIndex = st.eventIndex;
        rehearsalBoundaryDragEvents = st.events;
        if (musicalRehearsalTrack) {
            musicalRehearsalTrack.classList.add('musical-track-lane__track--rehearsal-drag');
        }
    }

    function attachRehearsalDragPointerMoveListener() {
        if (rehearsalPointerDocMove) return;
        rehearsalPointerDocMove = (e) => {
            const st = rehearsalPointerState;
            if (!st || e.pointerId !== st.pointerId) return;
            if (st.mode === 'pending') {
                if (!rehearsalPointerMoveExceedsDragSlop(st, e.clientX, e.clientY)) return;
                e.preventDefault();
                beginRehearsalMarkDrag(st);
            }
            if (st.mode !== 'drag' || !rehearsalBoundaryDragActive) return;
            e.preventDefault();
            const sec = transportSecFromRehearsalTrackPointer(e.clientX);
            if (!Number.isFinite(sec)) return;
            rehearsalBoundaryDragLastSec = sec;
            const idx = rehearsalBoundaryDragEventIndex;
            const list = rehearsalBoundaryDragEvents;
            if (!list || idx < 0 || idx >= list.length) return;
            const meterSpec = st.settings && st.settings.meterSpec;
            const resolved = resolveRehearsalMarkDragSec(
                list,
                idx,
                sec,
                st.master,
                meterSpec,
                null,
            );
            if (!resolved.valid || !Number.isFinite(resolved.sec)) return;
            if (Math.abs(list[idx].sec - resolved.sec) < 1e-9) return;
            list[idx] = Object.assign({}, list[idx], { sec: resolved.sec });
            rehearsalBoundaryDragDidMove = true;
            updateRehearsalTrackSegmentLayout(list, st.master);
        };
        document.addEventListener('pointermove', rehearsalPointerDocMove);
    }

    function onRehearsalMarkValuePointerDown(ev, eventIndex) {
        if (ev.button !== 0) return;
        if (rehearsalPointerState || rehearsalBoundaryDragActive) return;
        const master = rehearsalMasterDurationSec();
        if (!(master > 0)) return;
        const settings = rehearsalTrackEditSettings();
        const meterSpec = settings && settings.meterSpec;
        ev.stopPropagation();
        selectRehearsalTrackEvent(eventIndex);
        if (typeof endAudioWaveformScrub === 'function') {
            endAudioWaveformScrub({ force: true });
        }
        const events =
            typeof getRehearsalMarkTrackEvents === 'function'
                ? getRehearsalMarkTrackEvents(meterSpec, master).slice()
                : [];
        if (eventIndex < 0 || eventIndex >= events.length) return;
        rehearsalPointerState = {
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
        attachRehearsalDragPointerMoveListener();
        rehearsalPointerDocUp = (e) => {
            const st = rehearsalPointerState;
            if (!st || e.pointerId !== st.pointerId) return;
            if (st.mode === 'drag' && rehearsalBoundaryDragActive) {
                e.preventDefault();
                const list = rehearsalBoundaryDragEvents;
                const didMove = rehearsalBoundaryDragDidMove;
                const settingsNow = st.settings;
                const masterNow = st.master;
                if (didMove && list && masterNow > 0) {
                    const idx = rehearsalBoundaryDragEventIndex;
                    const meterNow = settingsNow && settingsNow.meterSpec;
                    let moveAccepted = false;
                    if (
                        idx >= 0 &&
                        idx < list.length &&
                        Number.isFinite(rehearsalBoundaryDragLastSec)
                    ) {
                        const resolved = resolveRehearsalMarkDragSec(
                            list,
                            idx,
                            rehearsalBoundaryDragLastSec,
                            masterNow,
                            meterNow,
                            { addSnap: true },
                        );
                        if (resolved.valid && Number.isFinite(resolved.sec)) {
                            list[idx] = Object.assign({}, list[idx], { sec: resolved.sec });
                            moveAccepted = true;
                        } else if (Number.isFinite(rehearsalBoundaryDragStartSec)) {
                            list[idx] = Object.assign({}, list[idx], {
                                sec: rehearsalBoundaryDragStartSec,
                            });
                        }
                    }
                    if (moveAccepted) {
                        const movedNewSec =
                            idx >= 0 && idx < list.length ? list[idx].sec : NaN;
                        persistRehearsalMarkTrackEvents(list, meterNow, masterNow);
                        if (
                            typeof syncExtraTrackRegionsForRehearsalMarkChange === 'function'
                        ) {
                            syncExtraTrackRegionsForRehearsalMarkChange({
                                bondAtSec: rehearsalBoundaryDragStartSec,
                                splitAtSec: movedNewSec,
                                silent: true,
                            });
                        }
                        if (typeof commitMusicalTrackUndoGesture === 'function') {
                            commitMusicalTrackUndoGesture();
                        }
                    } else if (typeof cancelMusicalTrackUndoGesture === 'function') {
                        cancelMusicalTrackUndoGesture();
                    }
                } else if (typeof cancelMusicalTrackUndoGesture === 'function') {
                    cancelMusicalTrackUndoGesture();
                }
                endRehearsalBoundaryDrag(false);
                rehearsalPointerState = null;
                clearRehearsalPointerListeners();
                refreshRehearsalTrack();
                return;
            }
            endRehearsalBoundaryDrag(true);
            rehearsalPointerState = null;
            clearRehearsalPointerListeners();
        };
        document.addEventListener('pointerup', rehearsalPointerDocUp);
        document.addEventListener('pointercancel', rehearsalPointerDocUp);
    }

    function onRehearsalSegmentPointerDown(ev, eventIndex) {
        if (ev.button !== 0) return;
        if (ev.target.closest('.musical-track-lane__segment-value--rehearsal-mark')) return;
        ev.stopPropagation();
        selectRehearsalTrackEvent(eventIndex);
    }

    function collectRehearsalMarkLocalMeasureSegments(meterSpec, master) {
        const segments = [];
        if (!(master > 0) || !meterSpec) return segments;
        const boundaries = rehearsalBarBoundaries(meterSpec, master);
        if (!boundaries || boundaries.length < 2) return segments;
        const ranges = collectRehearsalMarkDrawRanges(master, meterSpec);
        const labelFontPx =
            typeof getRehearsalMeasureLabelFontPx === 'function'
                ? getRehearsalMeasureLabelFontPx()
                : 7.4;
        for (let ri = 0; ri < ranges.length; ri++) {
            const range = ranges[ri];
            if (!range.fromRehearsalEvent) continue;
            const startBarIdx = rehearsalBarIndexForSec(range.startSec, meterSpec, master);
            if (startBarIdx == null) continue;
            const rangeBarSpans = [];
            for (let bi = startBarIdx; bi < boundaries.length - 1; bi++) {
                const barStart = boundaries[bi];
                if (barStart >= range.endSec - 1e-9) break;
                rangeBarSpans.push({
                    startSec: barStart,
                    endSec: boundaries[bi + 1],
                    localBarNum: bi - startBarIdx + 1,
                });
            }
            if (!rangeBarSpans.length) continue;
            const candidates = rangeBarSpans.map((span) => ({
                barNum: span.localBarNum,
                startSec: span.startSec,
                endSec: span.endSec,
            }));
            const visible =
                typeof filterMeasureBarCandidatesForDisplay === 'function'
                    ? filterMeasureBarCandidatesForDisplay(candidates, {
                          master,
                          fontSizePx: labelFontPx,
                          anchorBarNumbers: [1],
                      })
                    : candidates;
            for (let vi = 0; vi < visible.length; vi++) {
                const c = visible[vi];
                segments.push({
                    startSec: c.startSec,
                    endSec: c.endSec,
                    text: String(c.barNum),
                });
            }
        }
        return segments;
    }

    function renderRehearsalTrackMeasureNumbers(meterSpec, master) {
        if (!musicalRehearsalMeasureSegments) return;
        musicalRehearsalMeasureSegments.replaceChildren();
        if (!(master > 0) || !meterSpec) {
            musicalRehearsalMeasureSegments.setAttribute('aria-hidden', 'true');
            return;
        }
        const segs = collectRehearsalMarkLocalMeasureSegments(meterSpec, master);
        musicalRehearsalMeasureSegments.setAttribute(
            'aria-hidden',
            segs.length ? 'false' : 'true',
        );
        for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            const pos = segmentLeftWidthPct(seg.startSec, seg.endSec, master);
            const el = document.createElement('div');
            el.className =
                'musical-track-lane__segment musical-track-lane__segment--readonly musical-track-lane__segment--rehearsal-measure';
            el.style.left = pos.leftPct + '%';
            el.style.width = pos.widthPct + '%';
            el.textContent = seg.text;
            el.title = 'Measure ' + seg.text;
            musicalRehearsalMeasureSegments.appendChild(el);
        }
    }

    function renderRehearsalTrackSegments(events, master) {
        if (!musicalRehearsalSegments) return;
        musicalRehearsalSegments.replaceChildren();
        musicalRehearsalSegments.setAttribute(
            'aria-hidden',
            events && events.length ? 'false' : 'true',
        );
        if (!events || !events.length || !(master > 0)) {
            syncRehearsalTrackSelectionUi();
            return;
        }
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            const range = rehearsalSegmentRange(events, i, master);
            const pos = segmentLeftWidthPct(range.startSec, range.endSec, master);
            const el = document.createElement('div');
            el.className = 'musical-track-lane__segment musical-track-lane__segment--rehearsal';
            el.style.left = pos.leftPct + '%';
            el.style.width = pos.widthPct + '%';
            el.dataset.eventIndex = String(i);
            el.title =
                'Rehearsal Mark ' +
                ev.label +
                ' — 選択後 Del で削除、DblClk で編集、ドラッグで移動、区間 DblClk / Ctrl+Shift+R で追加';
            const valueEl = document.createElement('span');
            valueEl.className =
                'musical-track-lane__segment-value musical-track-lane__segment-value--rehearsal-mark rehearsal-mark__text';
            valueEl.textContent = ev.label;
            valueEl.title = 'ダブルクリックで編集、ドラッグで移動';
            if (typeof bindMusicalTrackValueEditGesture === 'function') {
                bindMusicalTrackValueEditGesture(valueEl, (e) => {
                    openRehearsalMarkEditInput(i, e, master);
                });
            }
            valueEl.addEventListener('pointerdown', (e) => {
                onRehearsalMarkValuePointerDown(e, i);
            });
            el.appendChild(valueEl);
            el.addEventListener('dblclick', (e) => {
                onRehearsalSegmentDblClick(e, i, events, master);
            });
            el.addEventListener('pointerdown', (e) => {
                onRehearsalSegmentPointerDown(e, i);
            });
            musicalRehearsalSegments.appendChild(el);
        }
        syncRehearsalTrackSelectionUi();
        const settings = rehearsalTrackEditSettings();
        const meterSpec = settings && settings.meterSpec;
        if (meterSpec) {
            renderRehearsalTrackMeasureNumbers(meterSpec, master);
        } else if (musicalRehearsalMeasureSegments) {
            musicalRehearsalMeasureSegments.replaceChildren();
            musicalRehearsalMeasureSegments.setAttribute('aria-hidden', 'true');
        }
    }

    function bindRehearsalTrackBackgroundEdit() {
        if (rehearsalTrackDblClickBound || !musicalRehearsalTrack) return;
        rehearsalTrackDblClickBound = true;
        musicalRehearsalTrack.addEventListener('dblclick', (e) => {
            if (e.target.closest('.musical-track-lane__add-input-wrap')) return;
            if (e.target.closest('.musical-track-lane__segment-value')) return;
            if (e.target.closest('.musical-track-lane__segment')) return;
            e.preventDefault();
            e.stopPropagation();
            const sec = transportSecFromRehearsalTrackPointer(e.clientX);
            if (!Number.isFinite(sec)) return;
            const settings = rehearsalTrackEditSettings();
            const master = rehearsalMasterDurationSec();
            if (!(master > 0)) return;
            const meterSpec = settings && settings.meterSpec;
            prepareRehearsalAddInput(e, sec, meterSpec, master);
        });
    }

    function refreshRehearsalTrack() {
        if (activeRehearsalEdit && activeRehearsalEdit.hostEl) return;
        const master = rehearsalMasterDurationSec();
        if (!(master > 0)) {
            if (musicalRehearsalSegments) musicalRehearsalSegments.replaceChildren();
            if (musicalRehearsalMeasureSegments) {
                musicalRehearsalMeasureSegments.replaceChildren();
                musicalRehearsalMeasureSegments.setAttribute('aria-hidden', 'true');
            }
            return;
        }
        const settings = rehearsalTrackEditSettings();
        const meterSpec = settings && settings.meterSpec;
        const events =
            typeof getRehearsalMarkTrackEvents === 'function'
                ? getRehearsalMarkTrackEvents(meterSpec, master)
                : [];
        if (!rehearsalBoundaryDragActive && !rehearsalPointerState) {
            renderRehearsalTrackSegments(events, master);
        } else if (meterSpec && master > 0) {
            renderRehearsalTrackMeasureNumbers(meterSpec, master);
        }
    }

    function initRehearsalTrack() {
        bindRehearsalTrackBackgroundEdit();
        refreshRehearsalTrack();
    }

    function isRehearsalBoundaryDragActive() {
        return rehearsalBoundaryDragActive || !!rehearsalPointerState;
    }

    function insertRehearsalMarkAtSec(rawSec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (activeRehearsalEdit) return false;
        if (rehearsalBoundaryDragActive || rehearsalPointerState) return false;
        const master = rehearsalMasterDurationSec();
        if (!(master > 0)) return false;
        const settings = rehearsalTrackEditSettings();
        const meterSpec = settings && settings.meterSpec;
        const transportSec = Number.isFinite(rawSec)
            ? rawSec
            : typeof getTransportSec === 'function'
              ? getTransportSec()
              : NaN;
        if (!Number.isFinite(transportSec)) return false;
        const snapped = rehearsalSnapSecForAdd(transportSec);
        const events =
            typeof getRehearsalMarkTrackEvents === 'function'
                ? getRehearsalMarkTrackEvents(meterSpec, master).slice()
                : [];
        const editIndex = findRehearsalMarkEditIndexAtPointer(
            events,
            transportSec,
            snapped,
            meterSpec,
            master,
        );
        if (editIndex >= 0) {
            selectRehearsalTrackEvent(editIndex);
            if (!o.silent && typeof writeLog === 'function') {
                writeLog(
                    'Rehearsal mark: already at this measure (' + events[editIndex].label + ')',
                );
            }
            return true;
        }
        const label = defaultRehearsalMarkLabelForInsert(events, transportSec, master, -1);
        if (!o.skipUndo && typeof requestMusicalTrackUndoCapture === 'function') {
            requestMusicalTrackUndoCapture();
        }
        events.push({ sec: snapped, label: label });
        events.sort((a, b) => a.sec - b.sec);
        let eventIndex = -1;
        for (let i = 0; i < events.length; i++) {
            if (Math.abs(events[i].sec - snapped) < 1e-6) {
                eventIndex = i;
                break;
            }
        }
        if (eventIndex >= 0) {
            shiftRehearsalMarkLabelsAfterDuplicate(events, eventIndex);
        }
        persistRehearsalMarkTrackEvents(events, meterSpec, master);
        if (typeof syncExtraTrackRegionsForRehearsalMarkChange === 'function') {
            syncExtraTrackRegionsForRehearsalMarkChange({ splitAtSec: snapped, silent: true });
        }
        refreshRehearsalTrack();
        if (eventIndex >= 0) {
            selectRehearsalTrackEvent(eventIndex);
        }
        if (!o.silent) {
            const tc =
                typeof formatTimecodeForTransport === 'function'
                    ? formatTimecodeForTransport(snapped)
                    : String(snapped);
            if (typeof writeLog === 'function') {
                writeLog('Rehearsal mark: ' + label + ' @ ' + tc);
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Rehearsal Mark ' + label, tc);
            }
        }
        return true;
    }

    function handleRehearsalMarkInsertShortcutKeydown(e) {
        if (typeof matchUserShortcut !== 'function' || !matchUserShortcut(e, 'rehearsalMarkInsert')) {
            return false;
        }
        if (e.repeat) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return false;
        if (typeof isMusicalTrackEditInputActive === 'function' && isMusicalTrackEditInputActive()) {
            return false;
        }
        if (!insertRehearsalMarkAtSec(null)) return false;
        e.preventDefault();
        return true;
    }

    function handleRehearsalTrackDeleteKeydown(e) {
        if (typeof matchUserShortcut !== 'function' || !matchUserShortcut(e, 'regionDelete')) {
            return false;
        }
        if (e.shiftKey) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return false;
        if (activeRehearsalEdit) return false;
        if (rehearsalBoundaryDragActive) return false;
        if (selectedRehearsalEventIndex < 0) return false;
        if (deleteSelectedRehearsalTrackEvent()) {
            e.preventDefault();
            return true;
        }
        return false;
    }

    function syncRehearsalSelectionFromMusicalTrack(field, eventIndex) {
        if (field === 'rehearsal') {
            selectedRehearsalEventIndex = eventIndex | 0;
            syncRehearsalTrackSelectionUi();
            return;
        }
        if (selectedRehearsalEventIndex >= 0) {
            selectedRehearsalEventIndex = -1;
            syncRehearsalTrackSelectionUi();
        }
    }

    function clearRehearsalTrackOnMusicalUndoRestore() {
        selectedRehearsalEventIndex = -1;
        cancelRehearsalTrackEdit();
    }

    function isRehearsalTrackEditActive() {
        return !!activeRehearsalEdit;
    }

    function markerCountsAsRangeForRehearsalSync(m) {
        return !!(m && m.type === 'range' && Number.isFinite(m.endSec));
    }

    function markerSecForRehearsalSync(m) {
        if (!m) return NaN;
        if (m.type === 'range') return Number(m.startSec);
        return Number(m.timeSec);
    }

    function defaultRehearsalLabelForMarkerSync(index) {
        const code = 65 + (Math.max(0, index | 0) % 26);
        return String.fromCharCode(code);
    }

    function rehearsalLabelFromMarkerForSync(m, fallbackIndex) {
        const comment = m && typeof m.comment === 'string' ? m.comment.trim() : '';
        if (comment) {
            return typeof normalizeRehearsalMarkLabel === 'function'
                ? normalizeRehearsalMarkLabel(comment)
                : comment;
        }
        return defaultRehearsalLabelForMarkerSync(fallbackIndex);
    }

    function buildRehearsalMarkEventsFromMarkers(markers, durationSec) {
        const list = Array.isArray(markers) ? markers : [];
        if (!list.length) return [];
        const hasAnyRange = list.some(markerCountsAsRangeForRehearsalSync);
        const sources = list.filter((m) => {
            if (!m) return false;
            if (hasAnyRange) return !markerCountsAsRangeForRehearsalSync(m);
            return true;
        });
        const events = [];
        let unlabeledIndex = 0;
        for (let i = 0; i < sources.length; i++) {
            const m = sources[i];
            const sec = markerSecForRehearsalSync(m);
            if (!Number.isFinite(sec)) continue;
            const comment = m && typeof m.comment === 'string' ? m.comment.trim() : '';
            const label = rehearsalLabelFromMarkerForSync(
                m,
                comment ? 0 : unlabeledIndex,
            );
            if (!comment) unlabeledIndex += 1;
            events.push({ sec, label });
        }
        if (typeof normalizeRehearsalMarkTrackEvents === 'function') {
            return normalizeRehearsalMarkTrackEvents(events, durationSec);
        }
        return events;
    }

    /** WAV 等からマーカー読み込み時 — マーカーリストはそのまま、リハーサルマークを同期 */
    function syncRehearsalMarksFromLoadedMarkers(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.skip) return false;
        const markers = Array.isArray(o.markers)
            ? o.markers
            : typeof getMarkersSnapshot === 'function'
              ? getMarkersSnapshot()
              : [];
        if (!markers.length) return false;
        const masterSec =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const fileDur = Number(o.fileDurationSec);
        const durationSec = Math.max(
            masterSec > 0 ? masterSec : 0,
            Number.isFinite(fileDur) && fileDur > 0 ? fileDur : 0,
            Number(o.durationSec) > 0 ? Number(o.durationSec) : 0,
        );
        const events = buildRehearsalMarkEventsFromMarkers(markers, durationSec);
        if (!events.length) return false;
        if (typeof setRehearsalMarkTrackEvents === 'function') {
            setRehearsalMarkTrackEvents(events, null, durationSec);
        }
        if (typeof refreshMusicalGridTracks === 'function') {
            refreshMusicalGridTracks();
        }
        if (typeof refreshAllRegionRehearsalMarkLabels === 'function') {
            refreshAllRegionRehearsalMarkLabels();
        }
        if (typeof writeLog === 'function' && !o.silent) {
            const label = o.logLabel ? o.logLabel + ': ' : '';
            const hasRange = markers.some(markerCountsAsRangeForRehearsalSync);
            writeLog(
                label +
                    'rehearsal marks from markers — ' +
                    events.length +
                    ' mark(s)' +
                    (hasRange ? ' (non-range only)' : ' (all markers)'),
            );
        }
        return true;
    }

    function rehearsalMarkSlotSecMatchEps() {
        return 1e-3;
    }

    function collectRehearsalGroupRangesFromCountsArray(counts) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0) || !Array.isArray(counts) || !counts.length) return [];
        const settings =
            typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        if (
            !meterSpec ||
            typeof collectRehearsalGroupRangesFromBarCounts !== 'function'
        ) {
            return [];
        }
        return collectRehearsalGroupRangesFromBarCounts(meterSpec, master, counts);
    }

    function slotLabelsFromMarkEventsAndCountRanges(events, ranges) {
        const labels = [];
        if (!Array.isArray(ranges) || !ranges.length || !Array.isArray(events) || !events.length) {
            return labels;
        }
        const eps = rehearsalMarkSlotSecMatchEps();
        for (let si = 0; si < ranges.length; si++) {
            const startSec = ranges[si] && ranges[si].startSec;
            if (!Number.isFinite(startSec)) continue;
            let matched = null;
            for (let ei = 0; ei < events.length; ei++) {
                if (Math.abs(Number(events[ei].sec) - startSec) <= eps) {
                    matched = events[ei].label;
                    break;
                }
            }
            if (matched == null && si < events.length && events.length === ranges.length) {
                matched = events[si].label;
            }
            if (matched == null) continue;
            const normalized =
                typeof normalizeRehearsalMarkLabel === 'function'
                    ? normalizeRehearsalMarkLabel(matched)
                    : String(matched).trim();
            if (normalized) labels[si] = normalized;
        }
        return labels;
    }

    function slotLabelsFromRehearsalMarkDrawRanges(ranges) {
        const labels = [];
        if (!Array.isArray(ranges) || !ranges.length) return labels;
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (!r || r.fromRehearsalEvent !== true) continue;
            const normalized =
                typeof normalizeRehearsalMarkLabel === 'function'
                    ? normalizeRehearsalMarkLabel(r.label)
                    : String(r.label == null ? '' : r.label).trim();
            if (normalized) labels[i] = normalized;
        }
        return labels;
    }

    function markEventsFromSlotLabelsAndRanges(slotLabels, ranges) {
        const out = [];
        if (!Array.isArray(ranges) || !ranges.length || !slotLabels) return out;
        for (let si = 0; si < ranges.length; si++) {
            const label = slotLabels[si];
            if (!label) continue;
            const startSec = ranges[si] && ranges[si].startSec;
            if (!Number.isFinite(startSec)) continue;
            out.push({ sec: startSec, label: label });
        }
        return out;
    }

    /**
     * 非対称 Rehearsal 入れ替え — markSecs + transport 小節数でマーク label/sec を ripple 再配置。
     * spec counts（例: 7,6,18）と mark 列（A,B,C,D…）が非一致でも動作する。
     */
    function findRehearsalMarkEventIndexBySec(events, sec, eps) {
        const s = Number(sec);
        if (!Number.isFinite(s) || !events || !events.length) return -1;
        const e = eps > 0 ? eps : rehearsalMarkSlotSecMatchEps();
        for (let i = 0; i < events.length; i++) {
            if (Math.abs(Number(events[i].sec) - s) <= e) return i;
        }
        return -1;
    }

    /** markSecs と event index の対応 — idxLo/idxHi 並べ替え後のリップル起点 sec 用 */
    function resolveMarkSecForEventIndex(snapshot, eventIndex, markSecs, eps) {
        const idx = eventIndex | 0;
        if (!snapshot || idx < 0 || idx >= snapshot.length) return NaN;
        if (markSecs && markSecs.length) {
            for (let i = 0; i < markSecs.length; i++) {
                const m = Number(markSecs[i]);
                if (!Number.isFinite(m)) continue;
                if (findRehearsalMarkEventIndexBySec(snapshot, m, eps) === idx) return m;
            }
        }
        return Number(snapshot[idx].sec);
    }

    function captureMarkSectionTransportBarCounts(snapshot, master, meterSpec) {
        const counts = [];
        if (!snapshot || !snapshot.length || !(master > 0) || !meterSpec) return counts;
        const drawRanges =
            typeof collectRehearsalMarkDrawRanges === 'function'
                ? collectRehearsalMarkDrawRanges(master, meterSpec)
                : [];
        const boundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(meterSpec, master)
                : typeof collectBarBoundarySecs === 'function'
                  ? collectBarBoundarySecs(meterSpec, master)
                  : [];
        if (!drawRanges.length || boundaries.length < 2) return counts;
        const eps = rehearsalMarkSlotSecMatchEps();
        const barIndexForSec =
            typeof barIndexForBoundarySec === 'function' ? barIndexForBoundarySec : null;
        if (!barIndexForSec) return counts;

        for (let ei = 0; ei < snapshot.length; ei++) {
            const sec = Number(snapshot[ei].sec);
            if (!Number.isFinite(sec)) continue;
            let matched = null;
            for (let ri = 0; ri < drawRanges.length; ri++) {
                const r = drawRanges[ri];
                if (!r || !r.fromRehearsalEvent) continue;
                if (Math.abs(r.startSec - sec) <= eps) {
                    matched = r;
                    break;
                }
            }
            if (!matched) continue;
            const barStart = barIndexForSec(matched.startSec, boundaries);
            const barEnd = barIndexForSec(Math.max(matched.startSec, matched.endSec - eps), boundaries);
            counts[ei] = Math.max(1, barEnd - barStart + 1);
        }
        return counts;
    }

    function recomposeRehearsalMarksAfterPairSwap(rehearsalIdxA, rehearsalIdxB, postCounts, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (typeof getRehearsalMarkTrackEventsPersistSnapshot !== 'function') return false;
        if (typeof setRehearsalMarkTrackEvents !== 'function') return false;

        const snapshot = getRehearsalMarkTrackEventsPersistSnapshot();
        if (!snapshot.length) return false;

        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return false;

        if (typeof readMusicalGridFromInputs === 'function') readMusicalGridFromInputs();
        const settings =
            typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        if (!meterSpec) return false;

        const markSecs = Array.isArray(o.markSecs) ? o.markSecs : null;
        const countA = o.countA != null ? o.countA | 0 : 0;
        const countB = o.countB != null ? o.countB | 0 : 0;
        const eps = rehearsalMarkSlotSecMatchEps();
        let headPadSwap =
            !!o.headPadSwapPair ||
            (markSecs &&
                markSecs.length >= 2 &&
                Math.abs(Number(markSecs[0])) < eps &&
                ((rehearsalIdxA | 0) === 0 || (rehearsalIdxB | 0) === 0));

        let idxLo = -1;
        let idxHi = -1;
        let headMarkIdx = -1;
        if (headPadSwap) {
            for (let mi = 0; mi < snapshot.length; mi++) {
                const sec = Number(snapshot[mi].sec);
                if (Number.isFinite(sec) && Math.abs(sec) < eps) {
                    headMarkIdx = mi;
                    break;
                }
            }
        }
        if (
            headPadSwap &&
            headMarkIdx >= 0 &&
            markSecs &&
            markSecs.length >= 2
        ) {
            // 冒頭マークあり — 通常ペア swap（ラベル交換 + ripple）
            idxLo = headMarkIdx;
            idxHi = findRehearsalMarkEventIndexBySec(snapshot, markSecs[1], eps);
            headPadSwap = false;
        } else if (headPadSwap) {
            idxLo = findRehearsalMarkEventIndexBySec(snapshot, markSecs[1], eps);
            idxHi = idxLo;
        } else if (markSecs && markSecs.length >= 2) {
            idxLo = findRehearsalMarkEventIndexBySec(snapshot, markSecs[0], eps);
            idxHi = findRehearsalMarkEventIndexBySec(snapshot, markSecs[1], eps);
        }
        if (idxLo < 0 || idxHi < 0 || (!headPadSwap && idxLo === idxHi)) {
            const lo = rehearsalIdxA | 0;
            const hi = rehearsalIdxB | 0;
            if (
                !headPadSwap &&
                lo >= 0 &&
                hi >= 0 &&
                lo < snapshot.length &&
                hi < snapshot.length &&
                lo !== hi
            ) {
                idxLo = lo;
                idxHi = hi;
            }
        }
        if (idxLo < 0 || idxHi < 0 || (!headPadSwap && idxLo === idxHi)) {
            if (typeof window.regionSwapDiagLog === 'function') {
                window.regionSwapDiagLog('rehearsal-mark/recompose/rejected', {
                    reason: 'mark-index-not-found',
                    markSecs: markSecs,
                    snapshotLen: snapshot.length,
                    headPadSwap: !!headPadSwap,
                });
            }
            return false;
        }
        if (typeof window.regionSwapDiagLog === 'function') {
            window.regionSwapDiagLog('rehearsal-mark/recompose/begin', {
                idxLo: idxLo + 1,
                idxHi: idxHi + 1,
                countA: countA | 0,
                countB: countB | 0,
                before: snapshot.map((e) => ({
                    sec: e.sec,
                    label: e.label,
                })),
                preBarCounts: Array.isArray(o.preMarkBarCounts)
                    ? o.preMarkBarCounts.slice(0, 12)
                    : undefined,
            });
        }
        if (idxLo > idxHi) {
            const tmp = idxLo;
            idxLo = idxHi;
            idxHi = tmp;
        }

        const labels = snapshot.map((e) =>
            typeof normalizeRehearsalMarkLabel === 'function'
                ? normalizeRehearsalMarkLabel(e.label)
                : String(e.label == null ? '' : e.label).trim(),
        );
        if (!headPadSwap) {
            const tmpLabel = labels[idxLo];
            labels[idxLo] = labels[idxHi];
            labels[idxHi] = tmpLabel;
        }

        let barCounts = Array.isArray(o.preMarkBarCounts) ? o.preMarkBarCounts.slice() : [];
        if (!barCounts.length) {
            barCounts = captureMarkSectionTransportBarCounts(snapshot, master, meterSpec);
        }
        if (headPadSwap && countA > 0 && countB > 0) {
            barCounts[idxLo] = countB;
        } else if (countA > 0 && countB > 0) {
            barCounts[idxLo] = countB;
            barCounts[idxHi] = countA;
        } else if (barCounts[idxLo] > 0 && barCounts[idxHi] > 0) {
            const tmpBars = barCounts[idxLo];
            barCounts[idxLo] = barCounts[idxHi];
            barCounts[idxHi] = tmpBars;
        }

        const boundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(meterSpec, master)
                : typeof collectBarBoundarySecs === 'function'
                  ? collectBarBoundarySecs(meterSpec, master)
                  : [];
        if (boundaries.length < 2) return false;
        const barIndexForSec =
            typeof barIndexForBoundarySec === 'function' ? barIndexForBoundarySec : null;
        if (!barIndexForSec) return false;

        const newSecs = new Array(snapshot.length);
        let secLo = NaN;
        if (headPadSwap) {
            return false;
        } else {
            secLo = resolveMarkSecForEventIndex(snapshot, idxLo, markSecs, eps);
            if (!Number.isFinite(secLo)) return false;
            const barLo = barIndexForSec(secLo, boundaries);

            for (let mi = 0; mi < idxLo; mi++) {
                newSecs[mi] = Number(snapshot[mi].sec);
            }
            newSecs[idxLo] = secLo;
            let barCursor = barLo;
            for (let mi = idxLo + 1; mi < snapshot.length; mi++) {
                barCursor += barCounts[mi - 1] | 0;
                if (barCursor < 0) barCursor = 0;
                if (barCursor >= boundaries.length) barCursor = boundaries.length - 1;
                newSecs[mi] = boundaries[barCursor];
            }
        }

        const nextEvents = [];
        for (let mi = 0; mi < snapshot.length; mi++) {
            const label = labels[mi];
            const sec = newSecs[mi];
            if (!label || !Number.isFinite(sec) || sec < 0 || sec >= master - 1e-6) continue;
            nextEvents.push({ sec: sec, label: label });
        }
        if (!nextEvents.length) return false;

        nextEvents.sort((a, b) => a.sec - b.sec);
        for (let i = 1; i < nextEvents.length; i++) {
            if (nextEvents[i].sec <= nextEvents[i - 1].sec + eps) {
                nextEvents[i].sec = Math.min(master - 1e-6, nextEvents[i - 1].sec + eps * 4);
            }
        }

        setRehearsalMarkTrackEvents(nextEvents, meterSpec, master);
        if (typeof writePrefs === 'function') writePrefs();
        if (typeof window.regionSwapDiagLog === 'function') {
            window.regionSwapDiagLog('rehearsal-mark/recompose', {
                markIdxLo: idxLo + 1,
                markIdxHi: idxHi + 1,
                secLo: secLo,
                barCounts: barCounts.slice(0, 12),
                postCounts: Array.isArray(postCounts) ? postCounts.slice(0, 12) : [],
                before: snapshot.map((e) => ({ sec: e.sec, label: e.label })),
                after: nextEvents.map((e) => ({
                    sec: e.sec,
                    label: e.label,
                })),
                events: nextEvents.map((e) => ({
                    sec: e.sec,
                    label: e.label,
                })),
            });
        }
        return true;
    }

    function rehearsalMarkLabelFromSlotMusical(musical, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!musical) return '';
        if (musical.rehearsalLabel) {
            const fromLabel =
                typeof normalizeRehearsalMarkLabel === 'function'
                    ? normalizeRehearsalMarkLabel(musical.rehearsalLabel)
                    : String(musical.rehearsalLabel).trim();
            if (fromLabel) return fromLabel;
        }
        if (o.skipStaleIndexFallback) return '';
        const idx = musical.rehearsalSlotIndex | 0;
        if (idx >= 0 && typeof window.rehearsalMarkLabelForRehearsalSlotIndex === 'function') {
            const fromIdx = window.rehearsalMarkLabelForRehearsalSlotIndex(idx);
            if (fromIdx) {
                return typeof normalizeRehearsalMarkLabel === 'function'
                    ? normalizeRehearsalMarkLabel(fromIdx)
                    : String(fromIdx).trim();
            }
        }
        return '';
    }

    /** リージョン実配置（segment in/out）と所属 label — 範囲マーカー追従位置と揃える */
    function collectRegionInLabelsFromSlots(track, slots, segments, eps, segmentLabelMap, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const entries = [];
        if (!Array.isArray(slots) || !slots.length) return entries;
        const e = eps > 0 ? eps : rehearsalMarkSlotSecMatchEps();
        const labelMap =
            segmentLabelMap && typeof segmentLabelMap === 'object' ? segmentLabelMap : null;
        for (let si = 0; si < slots.length; si++) {
            const slot = slots[si];
            if (!slot || slot.kind === 'silent' || !slot.segmentRefs || !slot.segmentRefs.length) {
                continue;
            }
            const refs = slot.segmentRefs;
            for (let ri = 0; ri < refs.length; ri++) {
                const segIdx = refs[ri].segmentIndex | 0;
                let label = '';
                if (labelMap && labelMap[segIdx]) {
                    label = labelMap[segIdx];
                } else {
                    label = rehearsalMarkLabelFromSlotMusical(slot.musical, o);
                }
                if (!label) continue;
                let inSec = NaN;
                let outSec = NaN;
                if (
                    track &&
                    typeof window.getSegmentRegionTimelineIn === 'function' &&
                    typeof window.getSegmentRegionTimelineOut === 'function'
                ) {
                    inSec = window.getSegmentRegionTimelineIn(track, segIdx);
                    outSec = window.getSegmentRegionTimelineOut(track, segIdx);
                } else if (segments && segIdx >= 0 && segIdx < segments.length) {
                    const seg = segments[segIdx];
                    if (seg && typeof window.segmentCopyRegionIn === 'function') {
                        inSec = window.segmentCopyRegionIn(seg);
                    } else if (seg && Number.isFinite(seg.regionTimelineInSec)) {
                        inSec = seg.regionTimelineInSec;
                    }
                    if (seg && typeof window.segmentCopyRegionOut === 'function') {
                        outSec = window.segmentCopyRegionOut(seg);
                    } else if (seg && Number.isFinite(seg.regionTimelineOutSec)) {
                        outSec = seg.regionTimelineOutSec;
                    }
                }
                if (!Number.isFinite(inSec)) continue;
                const span =
                    Number.isFinite(outSec) && outSec > inSec + e ? outSec - inSec : 0;
                entries.push({ inSec, outSec, span, label, slotIndex: si });
            }
        }
        return entries;
    }

    function resolveRehearsalMarkLabelForDrawRange(range, regionEntries, eps) {
        if (!range || !regionEntries || !regionEntries.length) return '';
        const e = eps > 0 ? eps : rehearsalMarkSlotSecMatchEps();
        let best = null;
        let bestSpan = -1;
        let bestDist = Infinity;
        for (let i = 0; i < regionEntries.length; i++) {
            const entry = regionEntries[i];
            const inSec = entry.inSec;
            if (!Number.isFinite(inSec)) continue;
            if (inSec < range.startSec - e || inSec >= range.endSec - e) continue;
            const dist = Math.abs(inSec - range.startSec);
            const span = entry.span > 0 ? entry.span : 0;
            if (
                span > bestSpan ||
                (span === bestSpan && dist < bestDist) ||
                best == null
            ) {
                bestSpan = span;
                bestDist = dist;
                best = entry;
            }
        }
        return best ? best.label : '';
    }

    /**
     * 部分リージョンスワップ後 — 各 Rehearsal グリッド区間先頭に載るリージョンの所属 label でマークを同期。
     * 時刻は counts 境界（draw ranges）を維持。範囲マーカーはリージョン in/out に追従するため in 位置で照合する。
     */
    function realignRehearsalMarksFromTimelineSlots(slots, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!Array.isArray(slots) || !slots.length) return false;
        if (typeof getRehearsalMarkTrackEventsPersistSnapshot !== 'function') return false;
        if (typeof setRehearsalMarkTrackEvents !== 'function') return false;

        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return false;

        if (typeof readMusicalGridFromInputs === 'function') readMusicalGridFromInputs();
        const settings =
            typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        if (!meterSpec) return false;

        const markDrawRanges =
            typeof collectRehearsalMarkDrawRanges === 'function'
                ? collectRehearsalMarkDrawRanges(master, meterSpec)
                : [];
        if (!markDrawRanges.length) return false;

        const track = o.track || null;
        const segments =
            track && typeof window.getTrackSegments === 'function'
                ? window.getTrackSegments(track)
                : null;

        const snapshot = getRehearsalMarkTrackEventsPersistSnapshot();
        const eps = rehearsalMarkSlotSecMatchEps();
        let slotLabels = slotLabelsFromRehearsalMarkDrawRanges(markDrawRanges);
        if (!slotLabels.length) {
            slotLabels = slotLabelsFromMarkEventsAndCountRanges(snapshot, markDrawRanges);
        }

        const regionEntries = collectRegionInLabelsFromSlots(
            track,
            slots,
            segments,
            eps,
            o.segmentRehearsalLabels,
        );

        let aligned = 0;
        for (let ri = 0; ri < markDrawRanges.length; ri++) {
            const r = markDrawRanges[ri];
            if (!r || r.fromRehearsalEvent !== true) continue;
            if (!Number.isFinite(r.startSec) || !Number.isFinite(r.endSec)) continue;

            let label = resolveRehearsalMarkLabelForDrawRange(r, regionEntries, eps);

            if (!label) {
                let bestSlot = null;
                let bestDist = Infinity;
                for (let si = 0; si < slots.length; si++) {
                    const slot = slots[si];
                    if (!slot || slot.kind === 'silent') continue;
                    const sec = slot.timelineStartSec;
                    if (!Number.isFinite(sec)) continue;
                    if (sec < r.startSec - eps || sec >= r.endSec - eps) continue;
                    const dist = Math.abs(sec - r.startSec);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestSlot = slot;
                    }
                }
                if (bestSlot) {
                    label = rehearsalMarkLabelFromSlotMusical(bestSlot.musical);
                }
            }

            if (!label) continue;
            slotLabels[ri] = label;
            aligned += 1;
        }

        if (!aligned) return false;

        const nextEvents = markEventsFromSlotLabelsAndRanges(slotLabels, markDrawRanges);
        if (!nextEvents.length) return false;

        setRehearsalMarkTrackEvents(nextEvents, meterSpec, master);
        if (typeof writePrefs === 'function') writePrefs();
        if (typeof refreshRehearsalTrack === 'function') {
            refreshRehearsalTrack();
        }
        if (typeof window.refreshAllRegionRehearsalMarkLabels === 'function') {
            window.refreshAllRegionRehearsalMarkLabels();
        }
        if (typeof window.regionSwapDiagLog === 'function') {
            window.regionSwapDiagLog('rehearsal-mark/realign-slots', {
                aligned,
                transportAnchored: !!o.transportAnchored,
                afterSwap: !!o.afterSwap,
                phase1Finalize: !!o.phase1Finalize,
                regionEntries: regionEntries.length,
                events: nextEvents.map((e) => ({ sec: e.sec, label: e.label })),
            });
        }
        return true;
    }

    /**
     * リージョン入れ替え（E）— 2 つの Rehearsal スロットに紐づくリハーサルマーク label を入れ替え、
     * postCounts があれば小節数変更後の区間先頭 sec へ再配置する。
     * useMarkDrawLayout — リハーサルマーク区間（draw ranges）基準で label のみ入れ替え（部分入れ替え用）。
     */
    function swapRehearsalMarkLabelsForRegionSwap(rehearsalIdxA, rehearsalIdxB, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const lo = rehearsalIdxA | 0;
        const hi = rehearsalIdxB | 0;
        if (lo < 0 || hi < 0 || lo === hi) return false;
        if (typeof getRehearsalMarkTrackEventsPersistSnapshot !== 'function') return false;
        if (typeof setRehearsalMarkTrackEvents !== 'function') return false;

        const snapshot = getRehearsalMarkTrackEventsPersistSnapshot();
        if (!snapshot.length) return false;

        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return false;
        const settings =
            typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;

        let layoutRanges = null;
        let slotLabels = null;
        const markDrawRanges =
            typeof collectRehearsalMarkDrawRanges === 'function'
                ? collectRehearsalMarkDrawRanges(master, meterSpec)
                : [];
        const preCounts = Array.isArray(o.preCounts) ? o.preCounts : null;
        const postCounts = Array.isArray(o.postCounts) ? o.postCounts : preCounts;
        const countsChanged =
            preCounts &&
            postCounts &&
            (preCounts.length !== postCounts.length ||
                preCounts.some((n, i) => (preCounts[i] | 0) !== (postCounts[i] | 0)));

        if (o.transportAnchored) {
            const markSecs = Array.isArray(o.markSecs) ? o.markSecs : null;
            const eps = rehearsalMarkSlotSecMatchEps();
            const nextEvents = snapshot.map((e) => ({
                sec: e.sec,
                label: e.label,
            }));
            let iLo = -1;
            let iHi = -1;
            if (markSecs && markSecs.length >= 2) {
                for (let i = 0; i < nextEvents.length; i++) {
                    if (Math.abs(nextEvents[i].sec - markSecs[0]) <= eps) iLo = i;
                    if (Math.abs(nextEvents[i].sec - markSecs[1]) <= eps) iHi = i;
                }
            }
            if (iLo < 0 || iHi < 0) {
                const preRanges = preCounts
                    ? collectRehearsalGroupRangesFromCountsArray(preCounts)
                    : [];
                if (preRanges.length > lo && preRanges.length > hi) {
                    const secLo = preRanges[lo].startSec;
                    const secHi = preRanges[hi].startSec;
                    for (let i = 0; i < nextEvents.length; i++) {
                        if (Math.abs(nextEvents[i].sec - secLo) <= eps) iLo = i;
                        if (Math.abs(nextEvents[i].sec - secHi) <= eps) iHi = i;
                    }
                }
            }
            if (iLo >= 0 && iHi >= 0) {
                const tmp = nextEvents[iLo].label;
                nextEvents[iLo].label = nextEvents[iHi].label;
                nextEvents[iHi].label = tmp;
                setRehearsalMarkTrackEvents(nextEvents, meterSpec, master);
                if (typeof writePrefs === 'function') writePrefs();
                if (typeof window.clearMusicalGridPositionCache === 'function') {
                    window.clearMusicalGridPositionCache();
                }
                if (typeof refreshRehearsalTrack === 'function') {
                    refreshRehearsalTrack();
                }
                if (typeof window.refreshAllRegionRehearsalMarkLabels === 'function') {
                    window.refreshAllRegionRehearsalMarkLabels();
                }
                if (typeof window.regionSwapDiagLog === 'function') {
                    window.regionSwapDiagLog('rehearsal-mark/swap', {
                        lo: lo + 1,
                        hi: hi + 1,
                        labelLo: nextEvents[iLo].label,
                        labelHi: nextEvents[iHi].label,
                        events: nextEvents.map((e) => ({ sec: e.sec, label: e.label })),
                        transportAnchored: true,
                        countsChanged: !!countsChanged,
                    });
                }
                return true;
            }
        }

        if (countsChanged && postCounts && postCounts.length) {
            const preRanges = preCounts.length
                ? collectRehearsalGroupRangesFromCountsArray(preCounts)
                : [];
            layoutRanges = collectRehearsalGroupRangesFromCountsArray(postCounts);
            if (!layoutRanges.length) return false;
            if (preRanges.length) {
                slotLabels = slotLabelsFromMarkEventsAndCountRanges(snapshot, preRanges);
            }
            if (!slotLabels || (!slotLabels[lo] && !slotLabels[hi])) {
                slotLabels = slotLabelsFromRehearsalMarkDrawRanges(markDrawRanges);
            }
            if (!slotLabels || (!slotLabels[lo] && !slotLabels[hi])) {
                slotLabels = slotLabelsFromMarkEventsAndCountRanges(snapshot, layoutRanges);
            }
        } else if (o.useMarkDrawLayout && markDrawRanges.length > hi) {
            layoutRanges = markDrawRanges;
            slotLabels = slotLabelsFromRehearsalMarkDrawRanges(markDrawRanges);
            if (!slotLabels[lo] || !slotLabels[hi]) {
                slotLabels = slotLabelsFromMarkEventsAndCountRanges(snapshot, markDrawRanges);
            }
        } else {
            const countsForLayout =
                postCounts && postCounts.length ? postCounts : preCounts;
            if (!countsForLayout || !countsForLayout.length) return false;
            if (lo >= countsForLayout.length || hi >= countsForLayout.length) return false;

            layoutRanges = collectRehearsalGroupRangesFromCountsArray(countsForLayout);
            if (!layoutRanges.length) return false;

            if (markDrawRanges.length) {
                slotLabels = slotLabelsFromRehearsalMarkDrawRanges(markDrawRanges);
            }
            if (!slotLabels || (!slotLabels[lo] && !slotLabels[hi])) {
                const preRanges = preCounts
                    ? collectRehearsalGroupRangesFromCountsArray(preCounts)
                    : layoutRanges;
                slotLabels = slotLabelsFromMarkEventsAndCountRanges(snapshot, preRanges);
            }
        }

        if (!layoutRanges || !layoutRanges.length) return false;
        if (!slotLabels || !slotLabels[lo] || !slotLabels[hi]) return false;

        const labelLo = slotLabels[lo];
        const labelHi = slotLabels[hi];
        slotLabels[lo] = labelHi;
        slotLabels[hi] = labelLo;

        const nextEvents = markEventsFromSlotLabelsAndRanges(slotLabels, layoutRanges);
        if (!nextEvents.length) return false;

        setRehearsalMarkTrackEvents(nextEvents, meterSpec, master);
        if (typeof writePrefs === 'function') writePrefs();
        if (typeof window.clearMusicalGridPositionCache === 'function') {
            window.clearMusicalGridPositionCache();
        }
        if (typeof refreshRehearsalTrack === 'function') {
            refreshRehearsalTrack();
        }
        if (typeof window.refreshAllRegionRehearsalMarkLabels === 'function') {
            window.refreshAllRegionRehearsalMarkLabels();
        }
        if (typeof window.regionSwapDiagLog === 'function') {
            window.regionSwapDiagLog('rehearsal-mark/swap', {
                lo: lo + 1,
                hi: hi + 1,
                labelLo: labelHi,
                labelHi: labelLo,
                events: nextEvents.map((e) => ({ sec: e.sec, label: e.label })),
                markDrawLayout: !!o.useMarkDrawLayout,
                countsChanged: !!countsChanged,
            });
        }
        return true;
    }

    /**
     * postCounts 区間先頭 sec + slot 所属 label でリハーサルマークを再構築。
     * 非対称 swap 後の counts-anchored 配置向け。
     */
    function syncRehearsalMarksFromCountsAndSlots(slots, counts, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const fail = (reason, detail) => {
            if (typeof window.regionSwapDiagLog === 'function') {
                window.regionSwapDiagLog('rehearsal-mark/sync-counts-slots', {
                    ok: false,
                    reason,
                    detail: detail || undefined,
                });
            }
            return false;
        };
        if (!Array.isArray(slots) || !slots.length || !Array.isArray(counts) || !counts.length) {
            return fail('invalid-args');
        }
        if (typeof setRehearsalMarkTrackEvents !== 'function') return fail('no-setter');

        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return fail('no-master');

        if (typeof readMusicalGridFromInputs === 'function') readMusicalGridFromInputs();
        const settings =
            typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        if (!meterSpec) return fail('no-meter-spec');

        const layoutRanges = collectRehearsalGroupRangesFromCountsArray(counts);
        if (!layoutRanges.length) return fail('no-layout-ranges');

        const track = o.track || null;
        const eps = rehearsalMarkSlotSecMatchEps();
        const slotLabels = [];
        const snapshot =
            typeof getRehearsalMarkTrackEventsPersistSnapshot === 'function'
                ? getRehearsalMarkTrackEventsPersistSnapshot()
                : [];
        const preCounts = Array.isArray(o.preCounts) ? o.preCounts : null;
        const preRanges = preCounts
            ? collectRehearsalGroupRangesFromCountsArray(preCounts)
            : [];

        const regionEntries = track
            ? collectRegionInLabelsFromSlots(track, slots, null, eps, null, {
                  skipStaleIndexFallback: true,
              })
            : [];

        for (let i = 0; i < layoutRanges.length; i++) {
            if (
                i === 0 &&
                (counts[0] | 0) === 1 &&
                layoutRanges[i] &&
                layoutRanges[i].startSec < eps
            ) {
                continue;
            }
            let label = '';
            for (let si = 0; si < slots.length; si++) {
                const slot = slots[si];
                if (!slot || slot.kind === 'silent' || !slot.musical) continue;
                const idx = slot.musical.rehearsalSlotIndex | 0;
                if (idx !== i) continue;
                if (slot.musical.rehearsalLabel) {
                    const fromLabel =
                        typeof normalizeRehearsalMarkLabel === 'function'
                            ? normalizeRehearsalMarkLabel(slot.musical.rehearsalLabel)
                            : String(slot.musical.rehearsalLabel).trim();
                    if (fromLabel) label = fromLabel;
                }
                if (!label) {
                    label = rehearsalMarkLabelFromSlotMusical(slot.musical, {
                        skipStaleIndexFallback: true,
                    });
                }
                if (label) break;
            }
            if (!label && track && regionEntries.length) {
                const range = layoutRanges[i];
                label = resolveRehearsalMarkLabelForDrawRange(range, regionEntries, eps);
            }
            if (
                !label &&
                !o.skipPreSnapshotFallback &&
                snapshot.length &&
                preRanges.length > i
            ) {
                const preStart = preRanges[i].startSec;
                for (let ei = 0; ei < snapshot.length; ei++) {
                    if (Math.abs(snapshot[ei].sec - preStart) <= eps) {
                        const fromSnap =
                            typeof normalizeRehearsalMarkLabel === 'function'
                                ? normalizeRehearsalMarkLabel(snapshot[ei].label)
                                : String(snapshot[ei].label || '').trim();
                        if (fromSnap) label = fromSnap;
                        break;
                    }
                }
            }
            if (label) slotLabels[i] = label;
        }

        const nextEvents = markEventsFromSlotLabelsAndRanges(slotLabels, layoutRanges);
        if (!nextEvents.length) {
            return fail('no-events-built', {
                labelSlots: slotLabels.filter(Boolean).length,
                rangeLen: layoutRanges.length,
            });
        }

        setRehearsalMarkTrackEvents(nextEvents, meterSpec, master);
        if (typeof writePrefs === 'function') writePrefs();
        if (typeof window.clearMusicalGridPositionCache === 'function') {
            window.clearMusicalGridPositionCache();
        }
        if (typeof refreshRehearsalTrack === 'function') {
            refreshRehearsalTrack();
        }
        if (typeof window.refreshAllRegionRehearsalMarkLabels === 'function') {
            window.refreshAllRegionRehearsalMarkLabels();
        }
        if (typeof window.regionSwapDiagLog === 'function') {
            window.regionSwapDiagLog('rehearsal-mark/sync-counts-slots', {
                ok: true,
                countsHead: counts.slice(0, 12),
                events: nextEvents.map((e) => ({ sec: e.sec, label: e.label })),
            });
        }
        return true;
    }

    /**
     * sync 後 — rehearsalSlotIndex ごとに mark event label を slot.rehearsalLabel へ反映。
     * 古い draw range 由来の index フォールバックで slot label が壊れた場合の復元用。
     */
    function alignSlotRehearsalLabelsFromSyncedMarks(slots, counts, markEvents) {
        if (!Array.isArray(slots) || !slots.length || !Array.isArray(counts) || !counts.length) {
            return 0;
        }
        if (!Array.isArray(markEvents) || !markEvents.length) return 0;
        const layoutRanges = collectRehearsalGroupRangesFromCountsArray(counts);
        if (!layoutRanges.length) return 0;
        const eps = rehearsalMarkSlotSecMatchEps();
        let aligned = 0;
        for (let si = 0; si < slots.length; si++) {
            const slot = slots[si];
            if (!slot || slot.kind === 'silent' || !slot.musical) continue;
            const idx = slot.musical.rehearsalSlotIndex | 0;
            if (idx < 0 || idx >= layoutRanges.length) continue;
            if (
                Number.isFinite(slot.timelineStartSec) &&
                slot.timelineStartSec < eps &&
                layoutRanges[idx] &&
                layoutRanges[idx].startSec < eps
            ) {
                continue;
            }
            const range = layoutRanges[idx];
            if (!range || !Number.isFinite(range.startSec)) continue;
            let label = '';
            for (let ei = 0; ei < markEvents.length; ei++) {
                if (Math.abs(Number(markEvents[ei].sec) - range.startSec) <= eps) {
                    const raw = markEvents[ei].label;
                    label =
                        typeof normalizeRehearsalMarkLabel === 'function'
                            ? normalizeRehearsalMarkLabel(raw)
                            : String(raw || '').trim();
                    break;
                }
            }
            if (!label) continue;
            if (!slot.musical) slot.musical = {};
            slot.musical.rehearsalLabel = label;
            aligned += 1;
        }
        if (aligned && typeof window.regionSwapDiagLog === 'function') {
            window.regionSwapDiagLog('rehearsal-mark/align-slot-labels', { aligned });
        }
        return aligned;
    }

    /** Rehearsal 着色 ON 時 — リハーサルマークが無ければ先頭 0s に A を 1 件追加 */
    function ensureDefaultRehearsalMarkForRehearsalTint(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const master = rehearsalMasterDurationSec();
        const settings = rehearsalTrackEditSettings();
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        const existing =
            typeof getRehearsalMarkTrackEvents === 'function'
                ? getRehearsalMarkTrackEvents(meterSpec, master)
                : [];
        if (existing.length) return false;
        const events = [{ sec: 0, label: 'A' }];
        if (typeof setRehearsalMarkTrackEvents === 'function') {
            setRehearsalMarkTrackEvents(events, meterSpec, master > 0 ? master : 0);
        }
        if (typeof writePrefs === 'function') writePrefs();
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        refreshRehearsalTrack();
        if (!o.silent && typeof writeLog === 'function') {
            writeLog('Rehearsal mark: A at start (Rehearsal tint)');
        }
        return true;
    }

    window.collectRehearsalMarkDrawRanges = collectRehearsalMarkDrawRanges;
    window.ensureDefaultRehearsalMarkForRehearsalTint = ensureDefaultRehearsalMarkForRehearsalTint;
    window.drawRehearsalMarkFills = drawRehearsalMarkFills;
    window.refreshRehearsalTrack = refreshRehearsalTrack;
    window.initRehearsalTrack = initRehearsalTrack;
    window.isRehearsalBoundaryDragActive = isRehearsalBoundaryDragActive;
    window.handleRehearsalTrackDeleteKeydown = handleRehearsalTrackDeleteKeydown;
    window.handleRehearsalMarkInsertShortcutKeydown = handleRehearsalMarkInsertShortcutKeydown;
    window.insertRehearsalMarkAtSec = insertRehearsalMarkAtSec;
    window.removeRehearsalMarkAtTransportHead = removeRehearsalMarkAtTransportHead;
    window.deleteSelectedRehearsalTrackEvent = deleteSelectedRehearsalTrackEvent;
    window.clearRehearsalTrackSelection = clearRehearsalTrackSelection;
    window.syncRehearsalSelectionFromMusicalTrack = syncRehearsalSelectionFromMusicalTrack;
    window.clearRehearsalTrackOnMusicalUndoRestore = clearRehearsalTrackOnMusicalUndoRestore;
    window.cancelRehearsalTrackEdit = cancelRehearsalTrackEdit;
    window.isRehearsalTrackEditActive = isRehearsalTrackEditActive;
    window.syncRehearsalMarksFromLoadedMarkers = syncRehearsalMarksFromLoadedMarkers;
    window.buildRehearsalMarkEventsFromMarkers = buildRehearsalMarkEventsFromMarkers;
    window.swapRehearsalMarkLabelsForRegionSwap = swapRehearsalMarkLabelsForRegionSwap;
    window.syncRehearsalMarksFromCountsAndSlots = syncRehearsalMarksFromCountsAndSlots;
    window.alignSlotRehearsalLabelsFromSyncedMarks = alignSlotRehearsalLabelsFromSyncedMarks;
    window.realignRehearsalMarksFromTimelineSlots = realignRehearsalMarksFromTimelineSlots;
    window.recomposeRehearsalMarksAfterPairSwap = recomposeRehearsalMarksAfterPairSwap;
    window.captureMarkSectionTransportBarCounts = captureMarkSectionTransportBarCounts;
})();
