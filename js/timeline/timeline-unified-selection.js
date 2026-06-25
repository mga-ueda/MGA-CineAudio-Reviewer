/**
 * timeline-unified-selection.js — Ctrl+Shift+A でタイムライン全要素を選択し、←/→ で小節移動
 */
(function timelineUnifiedSelectionModule() {
    /**
     * @type {null | {
     *   mode: 'all',
     *   regions: Array<{ slot: number, segmentIndex: number }>,
     *   tempo: number[],
     *   signature: number[],
     *   rehearsal: number[],
     *   markers: Array<{ markerId: string, edge: string }>
     * }}
     */
    let timelineUnifiedSelection = null;

    /**
     * Ctrl+クリックで蓄積する複数選択（リージョンは regionSelectionEntries を参照）
     * @type {null | {
     *   tempo: number[],
     *   signature: number[],
     *   rehearsal: number[],
     *   markers: Array<{ markerId: string, edge: string }>
     * }}
     */
    let timelineCtrlMultiSelection = null;

    const SEC_EPS = 1e-4;

    function musicalGridSettings() {
        return typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
    }

    function masterDurationSec() {
        return typeof getMasterTransportDurationSec === 'function'
            ? getMasterTransportDurationSec()
            : 0;
    }

    function isTempoSigGridOn() {
        return typeof getMusicalGridVisible === 'function' ? getMusicalGridVisible() : false;
    }

    function isRehearsalFillOff() {
        return typeof getMusicalGridRehearsalFillVisible === 'function'
            ? !getMusicalGridRehearsalFillVisible()
            : true;
    }

    /** Tempo/Sig（T）ON かつ Rehearsal 表示（R）OFF のときのみ全選択・リージョン一括移動可 */
    function isTimelineUnifiedSelectAllAllowed() {
        return isTempoSigGridOn() && isRehearsalFillOff();
    }

    /** Tempo / Signature / Rehearsal Mark の ←/→ 小節移動 — Tempo/Sig（T）ON なら R ON でも可 */
    function isMusicalTrackBarMoveAllowed() {
        return isTempoSigGridOn();
    }

    function notifyTimelineSelectAllBlocked() {
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(
                'Timeline',
                'Select All requires Tempo/Sig (T) ON and Rehearsal (R) OFF',
                'error',
            );
        }
    }

    function barBoundaries(meterSpec, master) {
        if (typeof collectPlaybackAlignedBarBoundarySecs === 'function') {
            return collectPlaybackAlignedBarBoundarySecs(meterSpec, master);
        }
        if (typeof collectBarBoundarySecs === 'function') {
            return collectBarBoundarySecs(meterSpec, master);
        }
        return [];
    }

    function collectBarLineStops(meterSpec, master) {
        return barBoundaries(meterSpec, master);
    }

    function findStopIndexAtSec(stops, sec) {
        if (!stops || !stops.length || !Number.isFinite(sec)) return -1;
        let best = 0;
        for (let i = 0; i < stops.length; i++) {
            if (stops[i] <= sec + SEC_EPS) best = i;
            else break;
        }
        for (let i = 0; i < stops.length; i++) {
            if (Math.abs(stops[i] - sec) <= SEC_EPS) return i;
        }
        return best;
    }

    function cloneMeterSigLocal(sig) {
        if (typeof cloneMeterSig === 'function') return cloneMeterSig(sig);
        if (!sig || typeof sig !== 'object') return { num: 4, den: 4 };
        return { num: sig.num | 0, den: sig.den | 0 };
    }

    function barIndexForSecLocal(sec, meterSpec, master) {
        if (typeof barIndexForSec === 'function') {
            return barIndexForSec(sec, meterSpec, master);
        }
        if (typeof barIndexForBoundarySec === 'function') {
            return barIndexForBoundarySec(sec, barBoundaries(meterSpec, master));
        }
        const boundaries = barBoundaries(meterSpec, master);
        const t = Number(sec);
        if (!Number.isFinite(t) || boundaries.length < 2) return 0;
        for (let i = 0; i < boundaries.length - 1; i++) {
            if (t >= boundaries[i] - SEC_EPS && t < boundaries[i + 1] - SEC_EPS) return i;
        }
        return Math.max(0, boundaries.length - 2);
    }

    function collectAllRegionSelectionEntries() {
        const entries = [];
        const pushTrack = (track, slot) => {
            if (!track || typeof isTrackRegionActive !== 'function' || !isTrackRegionActive(track)) {
                return;
            }
            const canonicalSlot =
                typeof canonicalRegionSelectionDragSlot === 'function'
                    ? canonicalRegionSelectionDragSlot(slot)
                    : slot;
            const count =
                typeof getSegmentCount === 'function' ? getSegmentCount(track) : 0;
            for (let i = 0; i < count; i++) {
                entries.push({ slot: canonicalSlot, segmentIndex: i });
            }
        };
        if (typeof getVideoTrackRef === 'function') {
            const videoTrack = getVideoTrackRef();
            const slot =
                typeof getTrackOffsetDragSlot === 'function'
                    ? getTrackOffsetDragSlot(videoTrack)
                    : typeof VIDEO_WAVEFORM_OFFSET_DRAG_SLOT !== 'undefined'
                      ? VIDEO_WAVEFORM_OFFSET_DRAG_SLOT
                      : -2;
            pushTrack(videoTrack, slot);
        }
        const n = typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        for (let slot = 0; slot < n; slot++) {
            pushTrack({ type: 'extra', slot }, slot);
        }
        return entries;
    }

    function collectAllMusicalTempoIndices(events) {
        const out = [];
        if (!events || !events.length) return out;
        for (let i = 1; i < events.length; i++) out.push(i);
        return out;
    }

    function collectAllMusicalSignatureIndices(events) {
        const out = [];
        if (!events || !events.length) return out;
        for (let i = 1; i < events.length; i++) out.push(i);
        return out;
    }

    function collectAllRehearsalIndices(events) {
        const out = [];
        if (!events || !events.length) return out;
        for (let i = 0; i < events.length; i++) out.push(i);
        return out;
    }

    function collectAllMarkerSelectionTargets() {
        if (typeof window.collectMarkerTimelineSelectAllTargets === 'function') {
            return window.collectMarkerTimelineSelectAllTargets();
        }
        return [];
    }

    function collectPartialMarkerSelectionTargets() {
        if (
            timelineCtrlMultiSelection &&
            timelineCtrlMultiSelection.markers &&
            timelineCtrlMultiSelection.markers.length
        ) {
            return timelineCtrlMultiSelection.markers.map((t) => ({
                markerId: t.markerId,
                edge: t.edge || 'in',
            }));
        }
        if (typeof window.collectMarkerTimelineSelectionTargetsForActiveMarker === 'function') {
            return window.collectMarkerTimelineSelectionTargetsForActiveMarker();
        }
        return [];
    }

    function toggleIndexInArray(arr, idx) {
        const i = arr.indexOf(idx);
        if (i >= 0) arr.splice(i, 1);
        else arr.push(idx);
        arr.sort((a, b) => a - b);
    }

    function toggleMarkerTargetInList(list, target) {
        const edge = target.edge || 'in';
        const i = list.findIndex(
            (t) => t.markerId === target.markerId && (t.edge || 'in') === edge,
        );
        if (i >= 0) list.splice(i, 1);
        else list.push({ markerId: target.markerId, edge: edge });
    }

    function hasTimelineCtrlMultiMusicalOrMarkers() {
        if (!timelineCtrlMultiSelection) return false;
        return !!(
            timelineCtrlMultiSelection.tempo.length ||
            timelineCtrlMultiSelection.rehearsal.length ||
            timelineCtrlMultiSelection.signature.length ||
            timelineCtrlMultiSelection.markers.length
        );
    }

    function ensureTimelineCtrlMultiSelection() {
        if (!timelineCtrlMultiSelection) {
            timelineCtrlMultiSelection = {
                tempo: [],
                signature: [],
                rehearsal: [],
                markers: [],
            };
        }
        return timelineCtrlMultiSelection;
    }

    function syncTimelineCtrlMultiSelectionUi() {
        clearMusicalTimelineUnifiedSelectUi();
        if (typeof activeMarkerId !== 'undefined') {
            activeMarkerId = null;
        }
        if (typeof updateMarkerListRowClasses === 'function') {
            updateMarkerListRowClasses();
        }
        if (typeof renderSeekBarMarkers === 'function') {
            renderSeekBarMarkers();
        }
        const root =
            typeof audioWaveformMarkers !== 'undefined' ? audioWaveformMarkers : null;
        if (root) {
            root.querySelectorAll('.seek-bar-marker--timeline-unified-selected').forEach((el) => {
                el.classList.remove('seek-bar-marker--timeline-unified-selected');
            });
        }
        if (!timelineCtrlMultiSelection || !hasTimelineCtrlMultiMusicalOrMarkers()) return;
        markMusicalTimelineUnifiedSelectUi(
            musicalTempoSegments,
            timelineCtrlMultiSelection.tempo,
        );
        markMusicalTimelineUnifiedSelectUi(
            musicalSignatureSegments,
            timelineCtrlMultiSelection.signature,
        );
        markMusicalTimelineUnifiedSelectUi(
            musicalRehearsalSegments,
            timelineCtrlMultiSelection.rehearsal,
        );
        if (root && timelineCtrlMultiSelection.markers.length) {
            for (let i = 0; i < timelineCtrlMultiSelection.markers.length; i++) {
                const id = timelineCtrlMultiSelection.markers[i].markerId;
                root
                    .querySelectorAll('[data-marker-id="' + id + '"]')
                    .forEach((el) =>
                        el.classList.add('seek-bar-marker--timeline-unified-selected'),
                    );
            }
        }
    }

    function clearTimelineCtrlMultiSelection() {
        if (!timelineCtrlMultiSelection) return;
        timelineCtrlMultiSelection = null;
        clearMusicalTimelineUnifiedSelectUi();
        if (typeof renderSeekBarMarkers === 'function') {
            renderSeekBarMarkers();
        }
        if (typeof updateMarkerListRowClasses === 'function') {
            updateMarkerListRowClasses();
        }
        if (typeof syncRehearsalTrackSelectionUi === 'function') {
            syncRehearsalTrackSelectionUi();
        }
    }

    function dismissTimelineUnifiedSelectAll() {
        if (!timelineUnifiedSelection) return;
        timelineUnifiedSelection = null;
        clearMusicalTimelineUnifiedSelectUi();
        syncMarkerAllSelectUi([]);
        if (timelineCtrlMultiSelection && hasTimelineCtrlMultiMusicalOrMarkers()) {
            syncTimelineCtrlMultiSelectionUi();
        } else if (typeof window.getSelectedMusicalTrackEvent === 'function') {
            const trackSel = window.getSelectedMusicalTrackEvent();
            if (trackSel && typeof window.selectMusicalTrackEvent === 'function') {
                window.selectMusicalTrackEvent(trackSel.field, trackSel.eventIndex);
            }
        }
    }

    function notifyTimelineCtrlMultiChanged() {
        dismissTimelineUnifiedSelectAll();
        if (timelineCtrlMultiSelection && !hasTimelineCtrlMultiMusicalOrMarkers()) {
            timelineCtrlMultiSelection = null;
        }
        syncTimelineCtrlMultiSelectionUi();
    }

    function handleTimelineCtrlMultiMusicalPointerDown(ev, field, eventIndex) {
        if (!ev || !(ev.ctrlKey || ev.metaKey)) return false;
        if (field === 'tempo' && eventIndex < 1) return false;
        if (field === 'signature' && eventIndex < 1) return false;
        if (field === 'rehearsal' && eventIndex < 0) return false;
        const sel = ensureTimelineCtrlMultiSelection();
        const arr =
            field === 'tempo'
                ? sel.tempo
                : field === 'signature'
                  ? sel.signature
                  : sel.rehearsal;
        toggleIndexInArray(arr, eventIndex | 0);
        if (typeof clearMusicalTrackEventSelection === 'function') {
            clearMusicalTrackEventSelection();
        }
        notifyTimelineCtrlMultiChanged();
        ev.preventDefault();
        ev.stopPropagation();
        return true;
    }

    function handleTimelineCtrlMultiMarkerPointerDown(ev, markerId, edge) {
        if (!ev || !(ev.ctrlKey || ev.metaKey) || !markerId) return false;
        const sel = ensureTimelineCtrlMultiSelection();
        toggleMarkerTargetInList(sel.markers, {
            markerId: markerId,
            edge: edge || 'in',
        });
        if (typeof clearMusicalTrackEventSelection === 'function') {
            clearMusicalTrackEventSelection();
        }
        notifyTimelineCtrlMultiChanged();
        ev.preventDefault();
        ev.stopPropagation();
        return true;
    }

    function syncTimelineCtrlMultiAfterMusicalMove(field, indices) {
        if (!timelineCtrlMultiSelection) return;
        if (field === 'tempo') timelineCtrlMultiSelection.tempo = indices.slice();
        else if (field === 'signature') timelineCtrlMultiSelection.signature = indices.slice();
        else if (field === 'rehearsal') timelineCtrlMultiSelection.rehearsal = indices.slice();
        syncTimelineCtrlMultiSelectionUi();
    }

    function syncTimelineCtrlMultiAfterMarkerMove(markers) {
        if (!timelineCtrlMultiSelection) return;
        timelineCtrlMultiSelection.markers = markers.map((t) => ({
            markerId: t.markerId,
            edge: t.edge || 'in',
        }));
        syncTimelineCtrlMultiSelectionUi();
    }

    function buildPartialTimelineSelection() {
        const sel = {
            mode: 'partial',
            regions: [],
            tempo: [],
            signature: [],
            rehearsal: [],
            markers: [],
        };
        if (typeof regionSelectionEntries !== 'undefined') {
            for (let i = 0; i < regionSelectionEntries.length; i++) {
                const e = regionSelectionEntries[i];
                if (e.segmentIndex >= 0) {
                    sel.regions.push({ slot: e.slot, segmentIndex: e.segmentIndex });
                }
            }
        }
        if (timelineCtrlMultiSelection && hasTimelineCtrlMultiMusicalOrMarkers()) {
            sel.tempo = timelineCtrlMultiSelection.tempo.slice();
            sel.signature = timelineCtrlMultiSelection.signature.slice();
            sel.rehearsal = timelineCtrlMultiSelection.rehearsal.slice();
        } else {
            const trackSel =
                typeof window.getSelectedMusicalTrackEvent === 'function'
                    ? window.getSelectedMusicalTrackEvent()
                    : null;
            if (trackSel) {
                if (trackSel.field === 'tempo' && trackSel.eventIndex >= 1) {
                    sel.tempo.push(trackSel.eventIndex);
                } else if (trackSel.field === 'signature' && trackSel.eventIndex >= 1) {
                    sel.signature.push(trackSel.eventIndex);
                } else if (trackSel.field === 'rehearsal' && trackSel.eventIndex >= 0) {
                    sel.rehearsal.push(trackSel.eventIndex);
                }
            }
        }
        sel.markers = collectPartialMarkerSelectionTargets();
        return sel;
    }

    function hasMusicalTrackSelection(sel) {
        if (!sel) return false;
        return !!(
            (sel.tempo && sel.tempo.length) ||
            (sel.signature && sel.signature.length) ||
            (sel.rehearsal && sel.rehearsal.length)
        );
    }

    function hasRegionTimelineSelection(sel) {
        return !!(sel && sel.regions && sel.regions.length);
    }

    function syncMusicalSelectionAfterMove(sel, field, mappedIndices) {
        if (!sel || sel.mode === 'all') return;
        if (!mappedIndices || !mappedIndices.length) return;
        if (timelineCtrlMultiSelection && hasTimelineCtrlMultiMusicalOrMarkers()) {
            syncTimelineCtrlMultiAfterMusicalMove(field, mappedIndices);
            return;
        }
        if (mappedIndices.length === 1 && typeof window.selectMusicalTrackEvent === 'function') {
            window.selectMusicalTrackEvent(field, mappedIndices[0]);
        }
    }

    function mapMovedIndices(original, indexMap) {
        const out = [];
        for (let i = 0; i < original.length; i++) {
            const old = original[i];
            out.push(indexMap[old] !== undefined ? indexMap[old] : old);
        }
        return out;
    }

    function countTimelineUnifiedSelection(sel) {
        if (!sel) return 0;
        return (
            (sel.regions ? sel.regions.length : 0) +
            (sel.tempo ? sel.tempo.length : 0) +
            (sel.signature ? sel.signature.length : 0) +
            (sel.rehearsal ? sel.rehearsal.length : 0) +
            (sel.markers ? sel.markers.length : 0)
        );
    }

    const MUSICAL_UNIFIED_SELECT_CLASS =
        'musical-track-lane__segment--timeline-unified-selected';

    function clearMusicalTimelineUnifiedSelectUi() {
        const containers = [
            musicalTempoSegments,
            musicalSignatureSegments,
            musicalRehearsalSegments,
        ];
        for (let c = 0; c < containers.length; c++) {
            const container = containers[c];
            if (!container) continue;
            container
                .querySelectorAll('.' + MUSICAL_UNIFIED_SELECT_CLASS)
                .forEach((el) => {
                    el.classList.remove(MUSICAL_UNIFIED_SELECT_CLASS);
                });
        }
    }

    function markMusicalTimelineUnifiedSelectUi(container, indices) {
        if (!container || !indices || !indices.length) return;
        for (let i = 0; i < indices.length; i++) {
            const el = container.querySelector('[data-event-index="' + indices[i] + '"]');
            if (el) el.classList.add(MUSICAL_UNIFIED_SELECT_CLASS);
        }
    }

    function syncAllMusicalMultiSelectUi(sel) {
        if (typeof window.clearMusicalTrackEventSelection === 'function') {
            window.clearMusicalTrackEventSelection();
        }
        clearMusicalTimelineUnifiedSelectUi();
        markMusicalTimelineUnifiedSelectUi(musicalTempoSegments, sel.tempo);
        markMusicalTimelineUnifiedSelectUi(musicalSignatureSegments, sel.signature);
        markMusicalTimelineUnifiedSelectUi(musicalRehearsalSegments, sel.rehearsal);
    }

    function resyncTimelineUnifiedMusicalSelectUi() {
        if (timelineUnifiedSelection && timelineUnifiedSelection.mode === 'all') {
            syncAllMusicalMultiSelectUi(timelineUnifiedSelection);
            return;
        }
        if (timelineCtrlMultiSelection && hasTimelineCtrlMultiMusicalOrMarkers()) {
            syncTimelineCtrlMultiSelectionUi();
        }
    }

    function syncRegionAllSelectUi(entries) {
        if (typeof clearRegionSelection === 'function') clearRegionSelection();
        if (!entries || !entries.length) return;
        if (typeof regionSelectionEntries !== 'undefined') {
            regionSelectionEntries.length = 0;
            for (let i = 0; i < entries.length; i++) {
                regionSelectionEntries.push({
                    slot: entries[i].slot,
                    segmentIndex: entries[i].segmentIndex,
                });
            }
            if (typeof syncRegionSelectionClasses === 'function') {
                syncRegionSelectionClasses();
            }
        }
    }

    function syncMarkerAllSelectUi(targets) {
        if (typeof activeMarkerId !== 'undefined') {
            activeMarkerId = null;
        }
        if (typeof updateMarkerListRowClasses === 'function') {
            updateMarkerListRowClasses();
        }
        if (typeof renderSeekBarMarkers === 'function') {
            renderSeekBarMarkers();
        }
        const root =
            typeof audioWaveformMarkers !== 'undefined' ? audioWaveformMarkers : null;
        if (root) {
            root.querySelectorAll('.seek-bar-marker--timeline-unified-selected').forEach((el) => {
                el.classList.remove('seek-bar-marker--timeline-unified-selected');
            });
        }
        if (!targets || !targets.length || !root) {
            return;
        }
        for (let i = 0; i < targets.length; i++) {
            const id = targets[i].markerId;
            root
                .querySelectorAll('[data-marker-id="' + id + '"]')
                .forEach((el) => el.classList.add('seek-bar-marker--timeline-unified-selected'));
        }
    }

    function syncAllTimelineSelectionUi(sel) {
        syncRegionAllSelectUi(sel.regions);
        syncAllMusicalMultiSelectUi(sel);
        syncMarkerAllSelectUi(sel.markers);
    }

    function buildAllTimelineSelection() {
        const settings = musicalGridSettings();
        const master = masterDurationSec();
        const regions = collectAllRegionSelectionEntries();
        let tempo = [];
        let signature = [];
        let rehearsal = [];
        if (settings && settings.meterSpec && master > 0) {
            if (typeof getTempoTrackEvents === 'function') {
                tempo = collectAllMusicalTempoIndices(
                    getTempoTrackEvents(settings.meterSpec, master),
                );
            }
            if (typeof getSignatureTrackEvents === 'function') {
                signature = collectAllMusicalSignatureIndices(
                    getSignatureTrackEvents(settings.meterSpec, master),
                );
            }
            if (typeof getRehearsalMarkTrackEvents === 'function') {
                rehearsal = collectAllRehearsalIndices(
                    getRehearsalMarkTrackEvents(settings.meterSpec, master),
                );
            }
        }
        const markers = collectAllMarkerSelectionTargets();
        return {
            mode: 'all',
            regions,
            tempo,
            signature,
            rehearsal,
            markers,
        };
    }

    function setTimelineUnifiedSelection(sel) {
        timelineUnifiedSelection = sel;
        if (!sel) return;
        syncAllTimelineSelectionUi(sel);
    }

    function clearTimelineUnifiedSelection() {
        if (!timelineUnifiedSelection) return false;
        timelineUnifiedSelection = null;
        if (typeof clearRegionSelection === 'function') clearRegionSelection();
        if (typeof window.clearMusicalTrackEventSelection === 'function') {
            window.clearMusicalTrackEventSelection();
        }
        clearMusicalTimelineUnifiedSelectUi();
        syncMarkerAllSelectUi([]);
        return true;
    }

    function selectAllTimelineItems() {
        if (!isTimelineUnifiedSelectAllAllowed()) {
            notifyTimelineSelectAllBlocked();
            return false;
        }
        clearTimelineCtrlMultiSelection();
        const sel = buildAllTimelineSelection();
        if (countTimelineUnifiedSelection(sel) < 1) {
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Timeline', 'Nothing to select', 'notice');
            }
            return false;
        }
        setTimelineUnifiedSelection(sel);
        if (typeof writeLog === 'function') {
            writeLog(
                'Timeline: selected all (' +
                    sel.regions.length +
                    ' region(s), ' +
                    sel.tempo.length +
                    ' tempo, ' +
                    sel.signature.length +
                    ' signature, ' +
                    sel.rehearsal.length +
                    ' rehearsal, ' +
                    sel.markers.length +
                    ' marker stop(s))',
            );
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Timeline', 'All selected', 'notice');
        }
        return true;
    }

    /** 移動先で重複したとき — 移動元を優先。冒頭 (index 0) は削除不可のため値をマージ */
    function applyTempoMoveWithOverlap(events, moveIdx, targetSec, meterSpec, master) {
        const list = events.slice();
        let idx = moveIdx;
        if (idx < 1 || idx >= list.length) return null;
        const moved = list[idx];
        let collideIdx = -1;
        for (let i = 0; i < list.length; i++) {
            if (i === idx) continue;
            if (Math.abs(list[i].sec - targetSec) <= SEC_EPS) {
                collideIdx = i;
                break;
            }
        }
        if (collideIdx < 0) {
            list[idx] = Object.assign({}, list[idx], {
                sec: targetSec,
                barIndex: barIndexForSecLocal(targetSec, meterSpec, master),
            });
            return { events: list, newIndex: idx };
        }
        if (collideIdx === 0) {
            list[0] = Object.assign({}, list[0], { bpm: moved.bpm });
            list.splice(idx, 1);
            return { events: list, newIndex: 0 };
        }
        list.splice(collideIdx, 1);
        if (idx > collideIdx) idx -= 1;
        list[idx] = Object.assign({}, list[idx], {
            sec: targetSec,
            barIndex: barIndexForSecLocal(targetSec, meterSpec, master),
        });
        return { events: list, newIndex: idx };
    }

    function applySignatureMoveWithOverlap(events, moveIdx, targetBarIndex) {
        const list = events.slice();
        let idx = moveIdx;
        if (idx < 1 || idx >= list.length) return null;
        const moved = list[idx];
        let collideIdx = -1;
        for (let i = 0; i < list.length; i++) {
            if (i === idx) continue;
            if ((list[i].barIndex | 0) === (targetBarIndex | 0)) {
                collideIdx = i;
                break;
            }
        }
        if (collideIdx < 0) {
            list[idx] = Object.assign({}, list[idx], { barIndex: targetBarIndex | 0 });
            return { events: list, newIndex: idx };
        }
        if (collideIdx === 0) {
            list[0] = Object.assign({}, list[0], { sig: cloneMeterSigLocal(moved.sig) });
            list.splice(idx, 1);
            return { events: list, newIndex: 0 };
        }
        list.splice(collideIdx, 1);
        if (idx > collideIdx) idx -= 1;
        list[idx] = Object.assign({}, list[idx], { barIndex: targetBarIndex | 0 });
        return { events: list, newIndex: idx };
    }

    function applyRehearsalMoveWithOverlap(events, moveIdx, targetSec) {
        const list = events.slice();
        let idx = moveIdx;
        if (idx < 0 || idx >= list.length) return null;
        const moved = list[idx];
        let collideIdx = -1;
        for (let i = 0; i < list.length; i++) {
            if (i === idx) continue;
            if (Math.abs(list[i].sec - targetSec) <= SEC_EPS) {
                collideIdx = i;
                break;
            }
        }
        if (collideIdx < 0) {
            const movedLabel = moved.label;
            list[idx] = Object.assign({}, list[idx], { sec: targetSec });
            list.sort((a, b) => a.sec - b.sec);
            const newIndex = list.findIndex(
                (e) => Math.abs(e.sec - targetSec) <= SEC_EPS && e.label === movedLabel,
            );
            return { events: list, newIndex: newIndex >= 0 ? newIndex : idx };
        }
        if (collideIdx === 0) {
            list[0] = Object.assign({}, list[0], { label: moved.label, sec: targetSec });
            list.splice(idx, 1);
            return { events: list, newIndex: 0 };
        }
        list.splice(collideIdx, 1);
        if (idx > collideIdx) idx -= 1;
        list[idx] = Object.assign({}, list[idx], { sec: targetSec });
        list.sort((a, b) => a.sec - b.sec);
        const newIndex = list.findIndex(
            (e) => Math.abs(e.sec - targetSec) <= SEC_EPS && e.label === moved.label,
        );
        return { events: list, newIndex: newIndex >= 0 ? newIndex : idx };
    }

    function persistTempoEvents(events, meterSpec, master) {
        if (typeof window.applyTempoTrackEvents === 'function') {
            window.applyTempoTrackEvents(events, meterSpec, master);
        }
        if (typeof scheduleMusicalGridRedraw === 'function') {
            scheduleMusicalGridRedraw();
        } else if (typeof refreshMusicalGridTracks === 'function') {
            refreshMusicalGridTracks();
        }
    }

    function persistSignatureEvents(events, meterSpec, master) {
        if (typeof window.applySignatureTrackEvents === 'function') {
            window.applySignatureTrackEvents(events, meterSpec, master);
        }
        if (typeof scheduleMusicalGridRedraw === 'function') {
            scheduleMusicalGridRedraw();
        } else if (typeof refreshMusicalGridTracks === 'function') {
            refreshMusicalGridTracks();
        }
    }

    function persistRehearsalEvents(events, meterSpec, master) {
        if (typeof window.persistRehearsalMarkTrackEvents === 'function') {
            window.persistRehearsalMarkTrackEvents(events, meterSpec, master);
            return;
        }
        if (typeof setRehearsalMarkTrackEvents === 'function') {
            setRehearsalMarkTrackEvents(events, meterSpec, master);
        }
        if (typeof window.finalizeRehearsalMarkTrackPresentation === 'function') {
            window.finalizeRehearsalMarkTrackPresentation();
        }
    }

    function moveAllTempo(dir, sel) {
        if (!sel.tempo.length) return false;
        const settings = musicalGridSettings();
        const master = masterDurationSec();
        if (!settings || !settings.meterSpec || !(master > 0)) return false;
        let events =
            typeof getTempoTrackEvents === 'function'
                ? getTempoTrackEvents(settings.meterSpec, master).slice()
                : [];
        const stops = collectBarLineStops(settings.meterSpec, master);
        if (!stops.length) return false;
        const order = sel.tempo.slice().sort((a, b) => (dir > 0 ? b - a : a - b));
        let changed = false;
        const indexMap = {};
        if (typeof window.requestMusicalTrackUndoCapture === 'function') {
            window.requestMusicalTrackUndoCapture();
        }
        for (let i = 0; i < order.length; i++) {
            const idx = order[i];
            if (idx < 1 || idx >= events.length) continue;
            const stopIdx = findStopIndexAtSec(stops, events[idx].sec);
            const nextStopIdx = stopIdx + dir;
            if (nextStopIdx < 0 || nextStopIdx >= stops.length) continue;
            const targetSec = stops[nextStopIdx];
            const minSec = events[idx - 1].sec + 1e-6;
            const maxSec =
                idx + 1 < events.length ? events[idx + 1].sec - 1e-6 : master - 1e-6;
            if (targetSec < minSec - SEC_EPS || targetSec > maxSec + SEC_EPS) continue;
            const result = applyTempoMoveWithOverlap(
                events,
                idx,
                targetSec,
                settings.meterSpec,
                master,
            );
            if (!result) continue;
            events = result.events;
            indexMap[idx] = result.newIndex;
            changed = true;
        }
        if (!changed) return false;
        persistTempoEvents(events, settings.meterSpec, master);
        if (sel.mode === 'all') {
            sel.tempo = collectAllMusicalTempoIndices(events);
            syncAllMusicalMultiSelectUi(sel);
        } else {
            sel.tempo = mapMovedIndices(sel.tempo, indexMap);
            syncMusicalSelectionAfterMove(sel, 'tempo', sel.tempo);
        }
        if (typeof logMusicalGridAction === 'function') {
            logMusicalGridAction('moved all tempo changes (keyboard)');
        }
        return true;
    }

    function moveAllSignature(dir, sel) {
        if (!sel.signature.length) return false;
        const settings = musicalGridSettings();
        const master = masterDurationSec();
        if (!settings || !settings.meterSpec || !(master > 0)) return false;
        let events =
            typeof getSignatureTrackEvents === 'function'
                ? getSignatureTrackEvents(settings.meterSpec, master).slice()
                : [];
        const boundaries = barBoundaries(settings.meterSpec, master);
        if (boundaries.length < 2) return false;
        const maxBarIndex = Math.max(0, boundaries.length - 2);
        const order = sel.signature.slice().sort((a, b) => (dir > 0 ? b - a : a - b));
        let changed = false;
        const indexMap = {};
        if (typeof window.requestMusicalTrackUndoCapture === 'function') {
            window.requestMusicalTrackUndoCapture();
        }
        for (let i = 0; i < order.length; i++) {
            const idx = order[i];
            if (idx < 1 || idx >= events.length) continue;
            const currentBar = events[idx].barIndex | 0;
            const targetBar = currentBar + dir;
            const minBar = (events[idx - 1].barIndex | 0) + 1;
            const maxBar =
                idx + 1 < events.length ? (events[idx + 1].barIndex | 0) - 1 : maxBarIndex;
            if (targetBar < minBar || targetBar > maxBar) continue;
            const result = applySignatureMoveWithOverlap(events, idx, targetBar);
            if (!result) continue;
            events = result.events;
            indexMap[idx] = result.newIndex;
            changed = true;
        }
        if (!changed) return false;
        persistSignatureEvents(events, settings.meterSpec, master);
        if (sel.mode === 'all') {
            sel.signature = collectAllMusicalSignatureIndices(events);
            syncAllMusicalMultiSelectUi(sel);
        } else {
            sel.signature = mapMovedIndices(sel.signature, indexMap);
            syncMusicalSelectionAfterMove(sel, 'signature', sel.signature);
        }
        if (typeof logMusicalGridAction === 'function') {
            logMusicalGridAction('moved all signature changes (keyboard)');
        }
        return true;
    }

    function moveAllRehearsal(dir, sel) {
        if (!sel.rehearsal.length) return false;
        const settings = musicalGridSettings();
        const master = masterDurationSec();
        if (!settings || !settings.meterSpec || !(master > 0)) return false;
        let events =
            typeof getRehearsalMarkTrackEvents === 'function'
                ? getRehearsalMarkTrackEvents(settings.meterSpec, master).slice()
                : [];
        const stops = collectBarLineStops(settings.meterSpec, master);
        if (!stops.length) return false;
        const order = sel.rehearsal.slice().sort((a, b) => (dir > 0 ? b - a : a - b));
        let changed = false;
        const relocatePairs = [];
        const indexMap = {};
        if (typeof window.requestMusicalTrackUndoCapture === 'function') {
            window.requestMusicalTrackUndoCapture();
        }
        for (let i = 0; i < order.length; i++) {
            const idx = order[i];
            if (idx < 0 || idx >= events.length) continue;
            const oldSec = events[idx].sec;
            const stopIdx = findStopIndexAtSec(stops, events[idx].sec);
            const nextStopIdx = stopIdx + dir;
            if (nextStopIdx < 0 || nextStopIdx >= stops.length) continue;
            let targetSec = stops[nextStopIdx];
            if (typeof snapSecToMusicalGridBar === 'function') {
                targetSec = snapSecToMusicalGridBar(targetSec);
            }
            const minSec = idx > 0 ? events[idx - 1].sec + 1e-6 : 0;
            const maxSec =
                idx + 1 < events.length ? events[idx + 1].sec - 1e-6 : master - 1e-6;
            if (targetSec < minSec - SEC_EPS || targetSec > maxSec + SEC_EPS) continue;
            const result = applyRehearsalMoveWithOverlap(events, idx, targetSec);
            if (!result) continue;
            events = result.events;
            indexMap[idx] = result.newIndex;
            const newIdx = result.newIndex;
            const newSec =
                newIdx >= 0 && newIdx < events.length && Number.isFinite(events[newIdx].sec)
                    ? events[newIdx].sec
                    : targetSec;
            if (Number.isFinite(oldSec) || Number.isFinite(newSec)) {
                relocatePairs.push({ oldSec: oldSec, newSec: newSec });
            }
            changed = true;
        }
        if (!changed) return false;
        if (typeof window.persistRehearsalMarkTrackEvents === 'function') {
            window.persistRehearsalMarkTrackEvents(events, settings.meterSpec, master);
        } else if (typeof setRehearsalMarkTrackEvents === 'function') {
            setRehearsalMarkTrackEvents(events, settings.meterSpec, master);
            if (typeof window.finalizeRehearsalMarkTrackPresentation === 'function') {
                window.finalizeRehearsalMarkTrackPresentation();
            }
        }
        if (typeof window.syncExtraTrackRegionsForRehearsalMarkRelocateBatch === 'function') {
            window.syncExtraTrackRegionsForRehearsalMarkRelocateBatch(relocatePairs, {
                silent: true,
            });
        }
        if (sel.mode === 'all') {
            sel.rehearsal = collectAllRehearsalIndices(events);
            syncAllMusicalMultiSelectUi(sel);
        } else {
            sel.rehearsal = mapMovedIndices(sel.rehearsal, indexMap);
            syncMusicalSelectionAfterMove(sel, 'rehearsal', sel.rehearsal);
        }
        if (
            typeof scheduleWaveformHiresRedrawAfterZoom === 'function' &&
            typeof requestAnimationFrame === 'function'
        ) {
            requestAnimationFrame(() => scheduleWaveformHiresRedrawAfterZoom());
        }
        if (typeof logRehearsalMarkAction === 'function') {
            logRehearsalMarkAction('moved all rehearsal marks (keyboard)');
        } else if (typeof logMusicalGridAction === 'function') {
            logMusicalGridAction('moved all rehearsal marks (keyboard)');
        }
        return true;
    }

    function collectUniqueRegionMoveUnits(entries) {
        const seen = new Set();
        const units = [];
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            const track =
                typeof trackRefFromWaveformOffsetDragSlot === 'function'
                    ? trackRefFromWaveformOffsetDragSlot(e.slot)
                    : { type: 'extra', slot: e.slot };
            if (!track || typeof isTrackRegionActive !== 'function' || !isTrackRegionActive(track)) {
                continue;
            }
            const members =
                typeof collectRegionGroupMembers === 'function'
                    ? collectRegionGroupMembers(track, e.segmentIndex)
                    : [{ slot: e.slot, segmentIndex: e.segmentIndex }];
            const key = members
                .map((m) =>
                    typeof regionGroupMemberKey === 'function'
                        ? regionGroupMemberKey(m.slot, m.segmentIndex)
                        : m.slot + ':' + m.segmentIndex,
                )
                .sort()
                .join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            units.push({ members, primary: e });
        }
        return units;
    }

    function moveAllRegions(dir, sel) {
        if (!sel.regions.length) return false;
        if (
            typeof isPlaybackRegionOffsetDragForbidden === 'function' &&
            isPlaybackRegionOffsetDragForbidden()
        ) {
            return false;
        }
        const settings = musicalGridSettings();
        const master = masterDurationSec();
        if (!settings || !settings.meterSpec || !(master > 0)) return false;
        const stops = collectBarLineStops(settings.meterSpec, master);
        if (!stops.length) return false;
        const units = collectUniqueRegionMoveUnits(sel.regions);
        if (!units.length) return false;
        let changed = false;
        if (typeof regionUndoPaused !== 'undefined' && !regionUndoPaused) {
            if (typeof requestRegionUndoCapture === 'function') requestRegionUndoCapture();
        }
        for (let u = 0; u < units.length; u++) {
            const unit = units[u];
            const primary = unit.primary;
            const track =
                typeof trackRefFromWaveformOffsetDragSlot === 'function'
                    ? trackRefFromWaveformOffsetDragSlot(primary.slot)
                    : { type: 'extra', slot: primary.slot };
            const headSec = getSegmentRegionTimelineIn(track, primary.segmentIndex);
            if (!Number.isFinite(headSec)) continue;
            const stopIdx = findStopIndexAtSec(stops, headSec);
            const nextStopIdx = stopIdx + dir;
            if (nextStopIdx < 0 || nextStopIdx >= stops.length) continue;
            const delta = stops[nextStopIdx] - headSec;
            if (Math.abs(delta) < SEC_EPS) continue;
            if (typeof applyRegionGroupMoveDelta === 'function') {
                applyRegionGroupMoveDelta(unit.members, delta, {
                    skipUndo: true,
                    parallelRegionOffsetDrag: true,
                });
                changed = true;
            }
        }
        if (!changed) return false;
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        if (sel.mode === 'all') {
            sel.regions = collectAllRegionSelectionEntries();
            syncRegionAllSelectUi(sel.regions);
        } else if (typeof syncRegionSelectionClasses === 'function') {
            syncRegionSelectionClasses();
        }
        if (typeof logRegionAction === 'function') {
            logRegionAction('moved all regions (keyboard)');
        }
        return true;
    }

    function moveAllMarkers(dir, sel) {
        if (!sel.markers.length) return false;
        if (typeof window.moveAllMarkerTimelineSelectionsByDir !== 'function') return false;
        const ok = window.moveAllMarkerTimelineSelectionsByDir(sel.markers, dir);
        if (ok) {
            if (sel.mode === 'all') {
                sel.markers = collectAllMarkerSelectionTargets();
                syncMarkerAllSelectUi(sel.markers);
            } else if (timelineCtrlMultiSelection) {
                syncTimelineCtrlMultiAfterMarkerMove(sel.markers);
            } else {
                if (typeof updateMarkerListRowClasses === 'function') {
                    updateMarkerListRowClasses();
                }
                if (typeof renderSeekBarMarkers === 'function') {
                    renderSeekBarMarkers();
                }
            }
        }
        return ok;
    }

    function moveTimelineSelection(sel, dir) {
        if (!sel) return false;
        const hasMusical = hasMusicalTrackSelection(sel);
        const hasRegions = hasRegionTimelineSelection(sel);
        const hasMarkers = !!(sel.markers && sel.markers.length);
        if (!hasMusical && !hasRegions && !hasMarkers) return false;
        let any = false;
        if (hasMusical && isMusicalTrackBarMoveAllowed()) {
            any = moveAllTempo(dir, sel) || any;
            any = moveAllSignature(dir, sel) || any;
            any = moveAllRehearsal(dir, sel) || any;
        }
        if (hasRegions && isTimelineUnifiedSelectAllAllowed()) {
            any = moveAllRegions(dir, sel) || any;
        }
        if (hasMarkers) {
            if (typeof markerTimelineReady === 'function' && !markerTimelineReady()) {
                return any;
            }
            any = moveAllMarkers(dir, sel) || any;
        }
        return any;
    }

    function guardTimelineShortcutKeydown(e) {
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return false;
        if (typeof isMusicalTrackEditInputActive === 'function' && isMusicalTrackEditInputActive()) {
            return false;
        }
        if (typeof isRehearsalTrackEditActive === 'function' && isRehearsalTrackEditActive()) {
            return false;
        }
        return true;
    }

    function handleTimelineSelectAtSeekbarKeydown(e) {
        if (typeof matchUserShortcut !== 'function' || !matchUserShortcut(e, 'timelineSelectAtSeekbar')) {
            return false;
        }
        if (!guardTimelineShortcutKeydown(e)) return false;
        if (!isTimelineUnifiedSelectAllAllowed()) {
            notifyTimelineSelectAllBlocked();
            e.preventDefault();
            e.stopImmediatePropagation();
            return true;
        }
        if (!selectAllTimelineItems()) return false;
        e.preventDefault();
        e.stopImmediatePropagation();
        return true;
    }

    function handleTimelineSelectionMoveKeydown(e) {
        if (e.repeat) return false;
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
        if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return false;
        if (!guardTimelineShortcutKeydown(e)) return false;
        const dir = e.code === 'ArrowRight' ? 1 : -1;
        if (timelineUnifiedSelection) {
            if (!moveTimelineSelection(timelineUnifiedSelection, dir)) return false;
            e.preventDefault();
            e.stopPropagation();
            return true;
        }
        const partial = buildPartialTimelineSelection();
        if (countTimelineUnifiedSelection(partial) < 1) return false;
        if (!moveTimelineSelection(partial, dir)) return false;
        e.preventDefault();
        e.stopPropagation();
        return true;
    }

    function handleTimelineSelectionEscapeKeydown(e) {
        if (!matchUserShortcut(e, 'regionEscape')) return false;
        if (timelineUnifiedSelection) {
            clearTimelineUnifiedSelection();
            e.preventDefault();
            return true;
        }
        if (timelineCtrlMultiSelection && hasTimelineCtrlMultiMusicalOrMarkers()) {
            clearTimelineCtrlMultiSelection();
            e.preventDefault();
            return true;
        }
        return false;
    }

    function hasTimelineUnifiedSelection() {
        return !!timelineUnifiedSelection;
    }

    window.handleTimelineSelectAtSeekbarKeydown = handleTimelineSelectAtSeekbarKeydown;
    window.handleTimelineSelectionMoveKeydown = handleTimelineSelectionMoveKeydown;
    window.handleTimelineSelectionEscapeKeydown = handleTimelineSelectionEscapeKeydown;
    window.hasTimelineUnifiedSelection = hasTimelineUnifiedSelection;
    window.clearTimelineUnifiedSelection = clearTimelineUnifiedSelection;
    window.resyncTimelineUnifiedMusicalSelectUi = resyncTimelineUnifiedMusicalSelectUi;
    window.handleTimelineCtrlMultiMusicalPointerDown = handleTimelineCtrlMultiMusicalPointerDown;
    window.handleTimelineCtrlMultiMarkerPointerDown = handleTimelineCtrlMultiMarkerPointerDown;
    window.dismissTimelineUnifiedSelectAll = dismissTimelineUnifiedSelectAll;
    window.clearTimelineCtrlMultiSelection = clearTimelineCtrlMultiSelection;
})();
