/**
 * waveform-viewport-diag.js — 128px タイル取得 / ピークキャッシュの診断ログ
 * constants.js の DEBUG_LOG.WAVEFORM_VIEWPORT が true のときのみ出力
 */
(function waveformViewportDiagModule() {
    const LOG_PREFIX = '[WaveformViewport] ';

    function enabled() {
        return (
            typeof window.isDebugLogCategoryEnabled === 'function' &&
            window.isDebugLogCategoryEnabled('WAVEFORM_VIEWPORT')
        );
    }

    function fmtDetail(detail) {
        if (detail == null) return '';
        try {
            return JSON.stringify(detail);
        } catch (_) {
            return String(detail);
        }
    }

    function log(stage, detail) {
        if (!enabled() || typeof writeLog !== 'function') return;
        const tail = detail != null ? ' | ' + fmtDetail(detail) : '';
        writeLog(LOG_PREFIX + stage + tail);
    }

    function logTilePlan(plan, extra) {
        if (!enabled() || !plan) return;
        const tiles = plan.tiles || [];
        log('tile/plan', Object.assign(
            {
                scrollLeft: plan.scrollLeft | 0,
                viewportW: plan.viewportW | 0,
                canvasLeft: plan.canvasLeft | 0,
                canvasW: plan.canvasW | 0,
                tileCount: tiles.length,
                tilePx: (extra && extra.tilePx) || 128,
                zoom:
                    typeof getWaveformTimelineZoom === 'function'
                        ? getWaveformTimelineZoom()
                        : null,
                tiles: tiles.map((t) => ({
                    id: t.id,
                    absLeft: t.absLeft | 0,
                    width: t.width | 0,
                    bars: t.barCount | 0,
                })),
            },
            extra || null,
        ));
    }

    function logTileSchedule(detail) {
        log('tile/schedule', detail);
    }

    function logTileMerge(track, reused, fresh, total) {
        log('tile/merge', {
            track,
            reused: reused | 0,
            fresh: fresh | 0,
            total: total | 0,
        });
    }

    function logTileLoad(phase, tile, detail) {
        if (!enabled() || !tile) return;
        log('tile/' + phase, Object.assign(
            {
                id: tile.id,
                absLeft: tile.absLeft | 0,
                width: tile.width | 0,
                bars: tile.barCount | 0,
            },
            detail || null,
        ));
    }

    function logTileCancel(fromGen, reason) {
        log('tile/cancel', { fromGen: fromGen | 0, reason: reason || 'unknown' });
    }

    function logPeakCacheHit(key, barCount, cacheOnly) {
        log('peakCache/hit', {
            key,
            bars: barCount | 0,
            cacheOnly: !!cacheOnly,
        });
    }

    function logPeakCacheMiss(key, barCount, source, cacheOnly) {
        log('peakCache/miss', {
            key,
            bars: barCount | 0,
            source: source || 'unknown',
            cacheOnly: !!cacheOnly,
        });
    }

    function logPeakCacheStore(key, barCount, cacheSize, maxSize) {
        log('peakCache/store', {
            key,
            bars: barCount | 0,
            size: cacheSize | 0,
            max: maxSize | 0,
        });
    }

    function logPeakCacheTrim(evicted, cacheSize, maxSize) {
        log('peakCache/trim', {
            evicted: evicted | 0,
            size: cacheSize | 0,
            max: maxSize | 0,
        });
    }

    function logPeakCacheClear(reason, count) {
        log('peakCache/clear', { reason: reason || 'unknown', count: count | 0 });
    }

    function logInvalidate(kind, detail) {
        log('invalidate/' + kind, detail || null);
    }

    window.logWaveformViewportTilePlan = logTilePlan;
    window.logWaveformViewportTileSchedule = logTileSchedule;
    window.logWaveformViewportTileMerge = logTileMerge;
    window.logWaveformViewportTileLoad = logTileLoad;
    window.logWaveformViewportTileCancel = logTileCancel;
    window.logWaveformViewportPeakCacheHit = logPeakCacheHit;
    window.logWaveformViewportPeakCacheMiss = logPeakCacheMiss;
    window.logWaveformViewportPeakCacheStore = logPeakCacheStore;
    window.logWaveformViewportPeakCacheTrim = logPeakCacheTrim;
    window.logWaveformViewportPeakCacheClear = logPeakCacheClear;
    window.logWaveformViewportInvalidate = logInvalidate;
})();
