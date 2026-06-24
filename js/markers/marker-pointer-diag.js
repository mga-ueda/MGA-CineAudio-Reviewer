/**
 * marker-pointer-diag.js — MARKERS ドラッグ vs リージョン In/Out/Fade vs シークの競合調査（F10）
 */
(function markerPointerDiagModule() {
    const DRAG_MOVE_MIN_MS = 220;

    let lastMoveKey = '';
    let lastMoveAt = 0;

    function enabled() {
        return (
            typeof window.isDebugLogCategoryEnabled === 'function' &&
            window.isDebugLogCategoryEnabled('MARKER_POINTER')
        );
    }

    function roundSec(v) {
        return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : v;
    }

    function fmtTc(sec) {
        if (!Number.isFinite(sec)) return null;
        if (typeof formatTimecodeForTransport === 'function') {
            return formatTimecodeForTransport(sec);
        }
        return sec.toFixed(4) + 's';
    }

    function log(stage, detail) {
        if (!enabled()) return;
        if (typeof writeDiagLog === 'function') {
            writeDiagLog('MARKER_POINTER', stage, detail);
            return;
        }
        if (typeof writeLog !== 'function') return;
        let tail = '';
        if (detail != null) {
            try {
                tail = ' | ' + JSON.stringify(detail);
            } catch (_) {
                tail = ' | ' + String(detail);
            }
        }
        writeLog('[MarkerPtr] ' + stage + tail);
    }

    function summarizeTarget(el) {
        if (!el || typeof el !== 'object') return null;
        const chain = [];
        const pushClosest = (sel, label) => {
            if (!el.closest) return;
            const node = el.closest(sel);
            if (node) chain.push(label);
        };
        pushClosest('.seek-bar-marker', 'marker');
        pushClosest('.seek-bar-marker__handle--in', 'marker-in-handle');
        pushClosest('.seek-bar-marker__handle--out', 'marker-out-handle');
        pushClosest('.audio-waveform-lane__playback-region__handle--in', 'region-in');
        pushClosest('.audio-waveform-lane__playback-region__handle--out', 'region-out');
        pushClosest('.audio-waveform-lane__playback-region__handle--fade-in', 'fade-in');
        pushClosest('.audio-waveform-lane__playback-region__handle--fade-out', 'fade-out');
        pushClosest('.audio-waveform-lane__playback-region', 'region-body');
        pushClosest('.audio-waveform-lane--musical', 'musical-lane');
        pushClosest('.musical-track-lane__segment', 'musical-segment');
        return {
            tag: el.tagName || null,
            id: el.id || null,
            classHint:
                typeof el.className === 'string'
                    ? el.className.split(/\s+/).slice(0, 4).join(' ')
                    : null,
            chain: chain,
        };
    }

    function collectRegionHandleHits(clientX, clientY) {
        const out = {
            ewZone: false,
            handles: [],
        };
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return out;
        if (
            typeof window.isPointerInRegionEwCursorHitZone === 'function' &&
            window.isPointerInRegionEwCursorHitZone(clientX, clientY)
        ) {
            out.ewZone = true;
        }
        if (typeof window.resolveRegionResizeHandleAtPointer !== 'function') return out;
        const n =
            typeof window.getExtraTrackCount === 'function' ? window.getExtraTrackCount() : 0;
        for (let slot = 0; slot < n; slot++) {
            const hit = window.resolveRegionResizeHandleAtPointer(
                { type: 'extra', slot },
                clientX,
                clientY,
            );
            if (!hit) continue;
            out.handles.push({
                ex: slot + 1,
                kind: hit.kind,
                segment: (hit.segmentIndex | 0) + 1,
            });
        }
        if (typeof window.collectVideoPlaybackRegionLaneContexts === 'function') {
            const contexts = window.collectVideoPlaybackRegionLaneContexts();
            for (let vi = 0; vi < contexts.length; vi++) {
                const hit = window.resolveRegionResizeHandleAtPointer(
                    contexts[vi].track,
                    clientX,
                    clientY,
                );
                if (!hit) continue;
                out.handles.push({
                    video: vi === 0 ? 'viz' : 'audio',
                    kind: hit.kind,
                    segment: (hit.segmentIndex | 0) + 1,
                });
            }
        }
        return out;
    }

    function collectPointerContext(ev) {
        const clientX = ev && Number.isFinite(ev.clientX) ? ev.clientX : null;
        const clientY = ev && Number.isFinite(ev.clientY) ? ev.clientY : null;
        const transportSec =
            clientX != null && typeof window.transportSecFromClientX === 'function'
                ? window.transportSecFromClientX(clientX)
                : null;
        let pointerContentPx = null;
        if (
            clientX != null &&
            typeof window.waveformPointerTimelineContentPx === 'function'
        ) {
            pointerContentPx = window.waveformPointerTimelineContentPx(clientX);
        } else if (
            clientX != null &&
            typeof window.waveformTimelineMetrics === 'function' &&
            typeof window.waveformScrubTargetEl === 'function'
        ) {
            const lanes = window.waveformScrubTargetEl();
            const m = window.waveformTimelineMetrics(lanes);
            if (m && m.scrubW > 0) {
                pointerContentPx =
                    clientX - m.contentLeft + (m.scrollable ? m.scrollLeft : 0);
            }
        }
        const inner =
            typeof window.audioWaveformLanesInner !== 'undefined'
                ? window.audioWaveformLanesInner
                : null;
        let inTimelineLanes = false;
        if (inner && clientX != null && clientY != null) {
            const r = inner.getBoundingClientRect();
            inTimelineLanes =
                clientX >= r.left &&
                clientX <= r.right &&
                clientY >= r.top &&
                clientY <= r.bottom;
        }
        const markersEl =
            typeof window.audioWaveformMarkers !== 'undefined'
                ? window.audioWaveformMarkers
                : null;
        return {
            clientX: clientX,
            clientY: clientY,
            transportSec: roundSec(transportSec),
            transportTc: fmtTc(transportSec),
            pointerContentPx:
                pointerContentPx != null ? Math.round(pointerContentPx * 10) / 10 : null,
            tempoOn:
                typeof window.getMusicalGridVisible === 'function'
                    ? window.getMusicalGridVisible()
                    : null,
            inTimelineLanes: inTimelineLanes,
            target: summarizeTarget(ev && ev.target),
            region: collectRegionHandleHits(clientX, clientY),
            markersHidden:
                typeof window.markersDisplayHidden !== 'undefined'
                    ? !!window.markersDisplayHidden
                    : null,
            markerCount:
                typeof window.currentMarkers !== 'undefined' && window.currentMarkers
                    ? window.currentMarkers.length
                    : null,
            markerLayerHidden: markersEl ? !!markersEl.hidden : null,
        };
    }

    function summarizeMarkerDragTarget(t) {
        if (!t || !t.m) return null;
        const m = t.m;
        return {
            id: m.id,
            edge: t.edge,
            type: m.type,
            label:
                typeof window.markerTimeLabel === 'function'
                    ? window.markerTimeLabel(m)
                    : null,
        };
    }

    function shouldLogDragMove(key) {
        const now = performance.now();
        if (key === lastMoveKey && now - lastMoveAt < DRAG_MOVE_MIN_MS) {
            return false;
        }
        lastMoveKey = key;
        lastMoveAt = now;
        return true;
    }

    function logResolve(ev, result, meta) {
        const stage = result ? 'resolve/hit' : 'resolve/miss';
        log(stage, Object.assign({}, collectPointerContext(ev), meta || {}, {
            marker: summarizeMarkerDragTarget(result),
        }));
    }

    function logCaptureWinner(ev, winner, note) {
        log('capture/' + winner, Object.assign({ note: note || null }, collectPointerContext(ev)));
    }

    function logMarkerBegin(ev, dragTarget, meta) {
        log(
            'marker/begin',
            Object.assign({}, collectPointerContext(ev), meta || {}, {
                marker: summarizeMarkerDragTarget(dragTarget),
            }),
        );
    }

    function logMarkerMove(st, meta) {
        if (!st || !st.m) return;
        const key =
            st.m.id +
            ':' +
            st.edge +
            ':' +
            String(st.lastAppliedSec != null ? st.lastAppliedSec : '');
        if (!shouldLogDragMove(key)) return;
        log('marker/move', Object.assign({}, meta || {}, {
            id: st.m.id,
            edge: st.edge,
            moved: !!st.moved,
            pointerSec: roundSec(st.lastPointerSec),
            appliedSec: roundSec(st.lastAppliedSec),
            pointerTc: fmtTc(st.lastPointerSec),
            appliedTc: fmtTc(st.lastAppliedSec),
            deltaSec:
                Number.isFinite(st.lastAppliedSec) && Number.isFinite(st.dragStartSec)
                    ? roundSec(st.lastAppliedSec - st.dragStartSec)
                    : null,
        }));
    }

    function logMarkerUp(st, meta) {
        if (!st) return;
        const o = meta && typeof meta === 'object' ? meta : {};
        log(
            'marker/up',
            Object.assign({}, o, {
                id: st.m && st.m.id,
                edge: st.edge,
                moved: !!st.moved,
                dragStart: st.dragStartLog || null,
                dragEnd:
                    o.dragEnd != null
                        ? o.dragEnd
                        : st.m && typeof window.markerTimeLabel === 'function'
                          ? window.markerTimeLabel(st.m)
                          : null,
            }),
        );
    }

    function logRegionHandleBegin(ev, hit, meta) {
        log(
            'region/begin',
            Object.assign({}, collectPointerContext(ev), meta || {}, {
                ex: hit && hit.track ? (hit.track.slot | 0) + 1 : null,
                kind: hit && hit.kind,
                segment: hit && Number.isFinite(hit.segmentIndex) ? hit.segmentIndex + 1 : null,
            }),
        );
    }

    window.markerPointerDiagLog = log;
    window.markerPointerDiagCollectPointerContext = collectPointerContext;
    window.markerPointerDiagLogResolve = logResolve;
    window.markerPointerDiagLogCaptureWinner = logCaptureWinner;
    window.markerPointerDiagLogMarkerBegin = logMarkerBegin;
    window.markerPointerDiagLogMarkerMove = logMarkerMove;
    window.markerPointerDiagLogMarkerUp = logMarkerUp;
    window.markerPointerDiagLogRegionHandleBegin = logRegionHandleBegin;
})();
