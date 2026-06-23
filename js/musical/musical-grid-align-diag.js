/**
 * musical-grid-align-diag.js — マーカーと小節境界の位置差診断
 * constants.js の DEBUG_LOG.GRID_ALIGN が true のときのみ出力
 */
(function musicalGridAlignDiagModule() {
    const LOG_PREFIX = '[GridAlign] ';

    function enabled() {
        return (
            typeof window.isDebugLogCategoryEnabled === 'function' &&
            window.isDebugLogCategoryEnabled('GRID_ALIGN')
        );
    }

    function oneFrameSec() {
        if (typeof markerOneFrameSec === 'function') return markerOneFrameSec();
        return 1 / 60;
    }

    function nearestBarBoundary(boundaries, sec) {
        if (!boundaries || !boundaries.length) return null;
        const s = Number(sec);
        if (!Number.isFinite(s)) return null;
        let bestIdx = 0;
        let best = boundaries[0];
        let bestDist = Math.abs(s - best);
        for (let i = 1; i < boundaries.length; i++) {
            const b = boundaries[i];
            const d = Math.abs(s - b);
            if (d < bestDist) {
                bestDist = d;
                best = b;
                bestIdx = i;
            }
        }
        return { sec: best, barIndex: bestIdx, distSec: s - best };
    }

    function markerEdgeSecs(m) {
        if (!m) return [];
        if (m.type === 'range') {
            return [
                { edge: 'in', sec: Number(m.startSec) },
                { edge: 'out', sec: Number(m.endSec) },
            ];
        }
        return [{ edge: 'point', sec: Number(m.timeSec) }];
    }

    function logGridAlignAfterMarkerImport(opt) {
        if (!enabled()) return;
        const o = opt && typeof opt === 'object' ? opt : {};
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const markerDur =
            typeof masterDurForTimelineMarkers === 'function'
                ? masterDurForTimelineMarkers()
                : master;
        const settings =
            typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
        const meterSpec = settings && settings.meterSpec;
        const sampleRate =
            typeof resolveTimelineMusicalSampleRate === 'function'
                ? resolveTimelineMusicalSampleRate()
                : 0;
        const boundaries =
            meterSpec && master > 0 && typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(meterSpec, master)
                : [];
        const markers =
            typeof getMarkersSnapshot === 'function' ? getMarkersSnapshot() : [];
        const frameSec = oneFrameSec();
        const contentW =
            typeof masterTimelineWidthCss === 'function'
                ? Math.max(0, masterTimelineWidthCss() | 0)
                : 0;

        const summary = {
            masterSec: master,
            markerLayoutDurSec: markerDur,
            durMismatchSec: markerDur - master,
            sampleRate,
            barCount: Math.max(0, boundaries.length - 1),
            markerCount: markers.length,
            contentW,
        };

        if (typeof writeDiagLog === 'function') {
            writeDiagLog('GRID_ALIGN', 'import/summary', summary);
        } else if (typeof writeLog === 'function') {
            writeLog(LOG_PREFIX + 'summary ' + JSON.stringify(summary));
        }

        const maxRows = 24;
        for (let mi = 0; mi < markers.length && mi < maxRows; mi++) {
            const m = markers[mi];
            const label =
                (m.comment && String(m.comment).trim()) ||
                (m.type === 'range' ? 'range' : 'point');
            const edges = markerEdgeSecs(m);
            for (let ei = 0; ei < edges.length; ei++) {
                const edge = edges[ei];
                if (!Number.isFinite(edge.sec)) continue;
                const near = nearestBarBoundary(boundaries, edge.sec);
                if (!near) continue;
                const markerPx =
                    typeof timelineSecToContentPx === 'function'
                        ? timelineSecToContentPx(edge.sec)
                        : null;
                const barPx =
                    typeof timelineSecToContentLinePx === 'function'
                        ? timelineSecToContentLinePx(near.sec)
                        : null;
                const row = {
                    marker: label,
                    edge: edge.edge,
                    markerSec: edge.sec,
                    barSec: near.sec,
                    barIndex: near.barIndex,
                    deltaSec: near.distSec,
                    deltaFrames: near.distSec / frameSec,
                    markerPx,
                    barPx,
                    deltaPx:
                        markerPx != null && barPx != null ? markerPx - barPx : null,
                };
                if (typeof writeDiagLog === 'function') {
                    writeDiagLog('GRID_ALIGN', 'import/marker', row);
                } else if (typeof writeLog === 'function') {
                    writeLog(LOG_PREFIX + JSON.stringify(row));
                }
            }
        }
        if (markers.length > maxRows && typeof writeDiagLog === 'function') {
            writeDiagLog('GRID_ALIGN', 'import/truncated', {
                shown: maxRows,
                total: markers.length,
            });
        }
    }

    window.logGridAlignAfterMarkerImport = logGridAlignAfterMarkerImport;
})();
