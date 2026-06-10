/**
 * waveform-peaks.js — 波形ピークのピラミッド構築とビューポート用キャッシュ（Worker 連携）。
 */
(function () {
    const PEAK_PYRAMID_MIN_BARS = 256;
    const PEAK_PYRAMID_MAX_BARS = 65536;
    /** 高ズーム viewport タイル向けに最細レベルを厚くする */
    const PEAK_PYRAMID_BARS_PER_SEC = 64;
    /** タイル単位スクロールでも再利用できるよう余裕を持たせる */
    const VIEWPORT_PEAK_CACHE_MAX = 256;

    /** @type {Map<string, { peaks: Array<{min:number,max:number}>, at: number }>} */
    const viewportPeakCache = new Map();

    function peaksFromChannelData(ch, barCount) {
        const len = ch.length;
        const bars = Math.max(1, barCount | 0);
        const block = Math.max(1, Math.floor(len / bars));
        const peaks = new Array(bars);
        for (let i = 0; i < bars; i++) {
            const start = i * block;
            const end = Math.min(len, start + block);
            let min = 0;
            let max = 0;
            for (let j = start; j < end; j++) {
                const v = ch[j];
                if (v < min) min = v;
                if (v > max) max = v;
            }
            peaks[i] = { min, max };
        }
        return peaks;
    }

    function mergePeaksHalf(peaks) {
        const n = peaks.length;
        const half = Math.max(1, Math.floor(n / 2));
        const out = new Array(half);
        for (let i = 0; i < half; i++) {
            const a = peaks[i * 2];
            const b = peaks[i * 2 + 1] || a;
            out[i] = {
                min: Math.min(a.min, b.min),
                max: Math.max(a.max, b.max),
            };
        }
        return out;
    }

    /**
     * @param {Float32Array} ch
     * @param {number} durationSec
     * @returns {{ durationSec: number, levels: Array<{ barCount: number, peaks: Array }> }}
     */
    function buildPeakPyramidFromChannel(ch, durationSec) {
        const dur = durationSec > 0 ? durationSec : ch.length / 48000;
        let finestBars = Math.round(dur * PEAK_PYRAMID_BARS_PER_SEC);
        finestBars = Math.max(
            PEAK_PYRAMID_MIN_BARS,
            Math.min(PEAK_PYRAMID_MAX_BARS, finestBars),
        );
        let cur = peaksFromChannelData(ch, finestBars);
        const levels = [{ barCount: cur.length, peaks: cur }];
        while (cur.length > PEAK_PYRAMID_MIN_BARS) {
            cur = mergePeaksHalf(cur);
            if (cur.length >= levels[levels.length - 1].barCount) break;
            levels.push({ barCount: cur.length, peaks: cur });
        }
        return { durationSec: dur, levels };
    }

    function buildPeakPyramidFromBuffer(buffer) {
        if (!buffer || buffer.numberOfChannels < 1) return null;
        return buildPeakPyramidFromChannel(
            buffer.getChannelData(0),
            buffer.duration,
        );
    }

    function pickPyramidLevel(pyramid, barCount, rangeDurSec) {
        const levels = pyramid.levels;
        if (!levels.length) return null;
        const fullDur = pyramid.durationSec;
        if (!(fullDur > 0) || !(rangeDurSec > 0)) return levels[0];
        const idealBars = barCount * (fullDur / rangeDurSec);
        for (let i = 0; i < levels.length; i++) {
            if (levels[i].barCount >= idealBars * 0.85) {
                return levels[i];
            }
        }
        // 要求解像度をピラミッドが満たせない場合は最粗ではなく最細を使う
        return levels[0];
    }

    function pyramidBarsInRange(pyramid, barCount, rangeDurSec) {
        const level = pickPyramidLevel(pyramid, barCount, rangeDurSec);
        if (!level || !(pyramid.durationSec > 0) || !(rangeDurSec > 0)) return 0;
        return Math.max(
            1,
            Math.floor(level.barCount * (rangeDurSec / pyramid.durationSec)),
        );
    }

    function isViewportPeakPyramidInsufficient(pyramid, barCount, rangeDurSec) {
        return pyramidBarsInRange(pyramid, barCount, rangeDurSec) < barCount * 0.85;
    }

    function resolveViewportPeakOpt(arg) {
        if (arg && typeof arg === 'object') {
            return {
                cacheOnly: !!arg.cacheOnly,
                peakPass: arg.peakPass === 'preview' ? 'preview' : 'full',
                force: !!arg.force,
                scrubPreview: !!arg.scrubPreview,
            };
        }
        return { cacheOnly: !!arg, peakPass: 'full', force: false, scrubPreview: false };
    }

    function resamplePeaks(peaks, barCount) {
        const n = peaks.length;
        const bars = Math.max(1, barCount | 0);
        if (n === bars) return peaks;
        const out = new Array(bars);
        for (let i = 0; i < bars; i++) {
            const f0 = (i / bars) * n;
            const f1 = ((i + 1) / bars) * n;
            const i0 = Math.floor(f0);
            const i1 = Math.max(i0 + 1, Math.ceil(f1));
            let min = 0;
            let max = 0;
            for (let j = i0; j < i1 && j < n; j++) {
                const pk = peaks[j];
                if (pk.min < min) min = pk.min;
                if (pk.max > max) max = pk.max;
            }
            out[i] = { min, max };
        }
        return out;
    }

    function peaksFromPyramidRange(pyramid, startSec, endSec, barCount) {
        if (!pyramid || !pyramid.levels.length) return [];
        const fullDur = pyramid.durationSec;
        const rangeDur = endSec - startSec;
        if (!(fullDur > 0) || rangeDur <= 1e-9) return [];
        const t0 = Math.max(0, startSec);
        const t1 = Math.min(fullDur, endSec);
        if (t1 <= t0 + 1e-9) return [];

        const level = pickPyramidLevel(pyramid, barCount, t1 - t0);
        if (!level || !level.peaks.length) return [];

        const n = level.barCount;
        const i0 = Math.max(0, Math.floor((t0 / fullDur) * n));
        const i1 = Math.min(n, Math.max(i0 + 1, Math.ceil((t1 / fullDur) * n)));
        const slice = level.peaks.slice(i0, i1);
        if (!slice.length) return [];
        return resamplePeaks(slice, barCount);
    }

    function peaksFromChannelRange(ch, sampleRate, startSec, endSec, barCount) {
        const sr = sampleRate > 0 ? sampleRate : 48000;
        const startSample = Math.max(0, Math.floor(startSec * sr));
        const endSample = Math.min(ch.length, Math.ceil(endSec * sr));
        if (endSample <= startSample) return [];
        const sub = ch.subarray(startSample, endSample);
        return peaksFromChannelData(sub, barCount);
    }

    const PCM_RANGE_WORKER_MIN_SAMPLES = 96000;

    /** 長い範囲の PCM 走査を Worker に逃がす（コールバック） */
    function peaksFromChannelRangeAsync(ch, sampleRate, startSec, endSec, barCount, callback) {
        const cb = typeof callback === 'function' ? callback : function () {};
        const sr = sampleRate > 0 ? sampleRate : 48000;
        const startSample = Math.max(0, Math.floor(startSec * sr));
        const endSample = Math.min(ch.length, Math.ceil(endSec * sr));
        const len = endSample - startSample;
        if (len <= 0) {
            cb([]);
            return;
        }
        const worker = len >= PCM_RANGE_WORKER_MIN_SAMPLES ? getPeakWorker() : null;
        if (!worker) {
            cb(peaksFromChannelRange(ch, sampleRate, startSec, endSec, barCount));
            return;
        }
        const id = ++peakWorkerReqId;
        const onMsg = (ev) => {
            if (!ev.data || ev.data.id !== id) return;
            if (ev.data.type !== 'rangeBuilt') return;
            worker.removeEventListener('message', onMsg);
            cb(ev.data.peaks || []);
        };
        worker.addEventListener('message', onMsg);
        try {
            const samples = ch.subarray(startSample, endSample);
            const copy = samples.slice();
            worker.postMessage(
                {
                    type: 'range',
                    id,
                    samples: copy,
                    barCount: Math.max(1, barCount | 0),
                    startSample: 0,
                    endSample: copy.length,
                },
                [copy.buffer],
            );
        } catch (_) {
            worker.removeEventListener('message', onMsg);
            cb(peaksFromChannelRange(ch, sampleRate, startSec, endSec, barCount));
        }
    }

    function viewportCacheKey(bufferId, startSec, endSec, barCount) {
        const tStep = 0.025;
        const s0 = Math.round(startSec / tStep) * tStep;
        const s1 = Math.round(endSec / tStep) * tStep;
        const bars = Math.max(1, Math.round(barCount / 16) * 16);
        return String(bufferId) + ':' + s0.toFixed(3) + ':' + s1.toFixed(3) + ':' + bars;
    }

    function trimViewportPeakCache() {
        let evicted = 0;
        while (viewportPeakCache.size > VIEWPORT_PEAK_CACHE_MAX) {
            const first = viewportPeakCache.keys().next().value;
            viewportPeakCache.delete(first);
            evicted++;
        }
        if (
            evicted > 0 &&
            typeof logWaveformViewportPeakCacheTrim === 'function'
        ) {
            logWaveformViewportPeakCacheTrim(
                evicted,
                viewportPeakCache.size,
                VIEWPORT_PEAK_CACHE_MAX,
            );
        }
    }

    /**
     * @returns {{ peaks: Array, peakQuality: 'preview'|'full', source: string }}
     */
    function peaksForViewportRangeWithQuality(
        buffer,
        pyramid,
        startSec,
        endSec,
        barCount,
        bufferId,
        optArg,
    ) {
        const rangeDur = endSec - startSec;
        if (!(rangeDur > 0)) {
            return { peaks: [], peakQuality: 'preview', source: 'none' };
        }

        const opt = resolveViewportPeakOpt(optArg);
        const cacheOnly = opt.cacheOnly;
        const peakPass = opt.peakPass;

        const key = viewportCacheKey(bufferId, startSec, endSec, barCount);
        const cached = viewportPeakCache.get(key);
        if (cached && cached.peaks && cached.peaks.length) {
            if (cacheOnly || peakPass === 'preview' || cached.quality === 'full') {
                if (typeof logWaveformViewportPeakCacheHit === 'function') {
                    logWaveformViewportPeakCacheHit(key, barCount, cacheOnly);
                }
                return {
                    peaks: cached.peaks,
                    peakQuality: cached.quality === 'full' ? 'full' : 'preview',
                    source: cached.source || 'cache',
                };
            }
        }
        if (cacheOnly) {
            if (typeof logWaveformViewportPeakCacheMiss === 'function') {
                logWaveformViewportPeakCacheMiss(key, barCount, 'cacheOnly', true);
            }
            return { peaks: [], peakQuality: 'preview', source: 'cacheOnly' };
        }

        if (
            typeof isWaveformScrubPriorityActive === 'function' &&
            isWaveformScrubPriorityActive() &&
            !opt.force &&
            !(peakPass === 'preview' && opt.scrubPreview && pyramid)
        ) {
            return { peaks: [], peakQuality: 'preview', source: 'scrubDefer' };
        }

        let peaks = [];
        let computeSource = 'none';
        let peakQuality = 'full';

        if (peakPass === 'preview') {
            peakQuality = 'preview';
            if (pyramid) {
                peaks = peaksFromPyramidRange(pyramid, startSec, endSec, barCount);
                computeSource = peaks.length ? 'pyramid' : 'none';
            }
        } else if (pyramid) {
            const needsPcm =
                buffer &&
                isViewportPeakPyramidInsufficient(pyramid, barCount, rangeDur);
            if (!needsPcm) {
                peaks = peaksFromPyramidRange(pyramid, startSec, endSec, barCount);
                computeSource = peaks.length ? 'pyramid' : 'none';
            }
            if ((!peaks.length || needsPcm) && buffer) {
                const ch = buffer.getChannelData(0);
                peaks = peaksFromChannelRange(
                    ch,
                    buffer.sampleRate,
                    startSec,
                    endSec,
                    barCount,
                );
                computeSource = 'pcm';
            }
            peakQuality = 'full';
        } else if (buffer) {
            const ch = buffer.getChannelData(0);
            peaks = peaksFromChannelRange(
                ch,
                buffer.sampleRate,
                startSec,
                endSec,
                barCount,
            );
            computeSource = 'pcm';
            peakQuality = 'full';
        }

        if (typeof logWaveformViewportPeakCacheMiss === 'function') {
            logWaveformViewportPeakCacheMiss(key, barCount, computeSource, false);
        }

        if (peaks.length) {
            viewportPeakCache.set(key, {
                peaks,
                at: performance.now(),
                quality: peakQuality,
                source: computeSource,
            });
            trimViewportPeakCache();
            if (typeof logWaveformViewportPeakCacheStore === 'function') {
                logWaveformViewportPeakCacheStore(
                    key,
                    barCount,
                    viewportPeakCache.size,
                    VIEWPORT_PEAK_CACHE_MAX,
                );
            }
        }
        return { peaks, peakQuality, source: computeSource };
    }

    function peaksForViewportRange(buffer, pyramid, startSec, endSec, barCount, bufferId, optArg) {
        return peaksForViewportRangeWithQuality(
            buffer,
            pyramid,
            startSec,
            endSec,
            barCount,
            bufferId,
            optArg,
        ).peaks;
    }

    function peaksOverviewFromPyramid(pyramid, barCount) {
        if (!pyramid || !pyramid.levels.length) return null;
        const coarse = pyramid.levels[pyramid.levels.length - 1];
        const bars = Math.max(1, barCount | 0);
        if (coarse.barCount === bars) return coarse.peaks;
        return resamplePeaks(coarse.peaks, bars);
    }

    function clearViewportPeakCache(reason, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const r = reason || 'unknown';
        if (
            !o.force &&
            typeof isWaveformViewportTileLoadActive === 'function' &&
            isWaveformViewportTileLoadActive()
        ) {
            if (typeof deferViewportPeakCacheClear === 'function') {
                deferViewportPeakCacheClear(r);
            }
            if (typeof logWaveformViewportPeakCacheClear === 'function') {
                logWaveformViewportPeakCacheClear(
                    r + '/deferred',
                    viewportPeakCache.size,
                );
            }
            return;
        }
        const count = viewportPeakCache.size;
        viewportPeakCache.clear();
        if (typeof logWaveformViewportPeakCacheClear === 'function') {
            logWaveformViewportPeakCacheClear(r, count);
        }
    }

    function bufferPeakId(buffer) {
        if (!buffer) return 0;
        return (buffer.length ^ (buffer.sampleRate * 1000)) | 0;
    }

    let peakWorker = null;
    let peakWorkerReqId = 0;

    function getPeakWorker() {
        if (peakWorker) return peakWorker;
        if (typeof Worker === 'undefined') return null;
        try {
            peakWorker = new Worker('js/waveform-peaks-worker.js');
        } catch (_) {
            peakWorker = null;
        }
        return peakWorker;
    }

    function pyramidFromFinestPeaks(finest, durationSec) {
        let cur = finest;
        const levels = [{ barCount: cur.length, peaks: cur }];
        while (cur.length > PEAK_PYRAMID_MIN_BARS) {
            cur = mergePeaksHalf(cur);
            if (cur.length >= levels[levels.length - 1].barCount) break;
            levels.push({ barCount: cur.length, peaks: cur });
        }
        return { durationSec, levels };
    }

    /** 長尺ファイルは Worker で最細レベルのみ生成（メインスレッド負荷軽減） */
    function buildPeakPyramidFromBufferAsync(buffer, callback) {
        if (!buffer || buffer.numberOfChannels < 1) {
            callback(null);
            return;
        }
        const ch = buffer.getChannelData(0);
        const dur = buffer.duration > 0 ? buffer.duration : ch.length / buffer.sampleRate;
        const worker = dur > 90 ? getPeakWorker() : null;
        let finestBars = Math.round(dur * PEAK_PYRAMID_BARS_PER_SEC);
        finestBars = Math.max(
            PEAK_PYRAMID_MIN_BARS,
            Math.min(PEAK_PYRAMID_MAX_BARS, finestBars),
        );

        if (!worker) {
            callback(buildPeakPyramidFromChannel(ch, dur));
            return;
        }

        const id = ++peakWorkerReqId;
        const samples = ch.slice();
        const onMsg = (ev) => {
            if (!ev.data || ev.data.id !== id) return;
            worker.removeEventListener('message', onMsg);
            callback(pyramidFromFinestPeaks(ev.data.peaks, dur));
        };
        worker.addEventListener('message', onMsg);
        try {
            worker.postMessage(
                { type: 'build', id, samples, barCount: finestBars },
                [samples.buffer],
            );
        } catch (_) {
            worker.removeEventListener('message', onMsg);
            callback(buildPeakPyramidFromChannel(ch, dur));
        }
    }

    window.peaksFromChannelRangeAsync = peaksFromChannelRangeAsync;
    window.buildPeakPyramidFromBuffer = buildPeakPyramidFromBuffer;
    window.buildPeakPyramidFromBufferAsync = buildPeakPyramidFromBufferAsync;
    window.peaksFromPyramidRange = peaksFromPyramidRange;
    window.peaksOverviewFromPyramid = peaksOverviewFromPyramid;
    window.peaksForViewportRange = peaksForViewportRange;
    window.peaksForViewportRangeWithQuality = peaksForViewportRangeWithQuality;
    window.isViewportPeakPyramidInsufficient = isViewportPeakPyramidInsufficient;
    window.clearViewportPeakCache = clearViewportPeakCache;
    window.bufferPeakId = bufferPeakId;
    window.peaksFromChannelData = peaksFromChannelData;
})();
