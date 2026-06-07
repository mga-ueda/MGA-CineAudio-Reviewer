/**
 * loudness-lkfs.js — ITU-R BS.1770 系 LKFS/LUFS 計測（AudioBuffer からインテグレーテッドラウドネス）。
 */
(function loudnessLkfsModule() {
    const TARGET_RATE = 48000;
    const BLOCK_SEC = 0.4;
    const HOP_SEC = 0.1;
    const ABS_GATE_LKFS = -70;
    const REL_OFFSET_LU = 10;

    const K_SHELF_B = [1.53512485958697, -2.69169618940638, 1.19839281085285];
    const K_SHELF_A = [1.0, -1.69065929318241, 0.73248077421585];
    const K_HP_B = [1.0, -2.0, 1.0];
    const K_HP_A = [1.0, -1.99004745483398, 0.99007225036621];

    const measureGenByTrack = new WeakMap();
    const lkfsPendingByTrack = new WeakMap();
    const lkfsValueByTrack = new WeakMap();

    function isWaveformTrackLkfsDisplaySuppressed() {
        if (typeof getMusicalGridVisible === 'function' && getMusicalGridVisible()) {
            return true;
        }
        if (
            typeof getMusicalGridPhraseFillVisible === 'function' &&
            getMusicalGridPhraseFillVisible()
        ) {
            return true;
        }
        return false;
    }

    function refreshAllWaveformTrackLkfsVisibility() {
        const suppressed = isWaveformTrackLkfsDisplaySuppressed();
        const trackEls = [];
        const main = document.getElementById('audioWaveformTrack');
        if (main) trackEls.push(main);
        const n = typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        for (let slot = 0; slot < n; slot++) {
            const el = document.getElementById('extraAudioTrack' + slot);
            if (el) trackEls.push(el);
        }
        for (let i = 0; i < trackEls.length; i++) {
            const trackEl = trackEls[i];
            const el = getTrackLkfsEl(trackEl);
            if (!el) continue;
            if (suppressed) {
                el.hidden = true;
                continue;
            }
            const lkfs = lkfsValueByTrack.get(trackEl);
            if (Number.isFinite(lkfs)) {
                el.textContent = formatLkfsDisplay(lkfs);
                el.hidden = false;
            }
        }
    }

    function channelWeights(channelCount) {
        switch (channelCount | 0) {
            case 1:
                return [1.0];
            case 2:
                return [1.0, 1.0];
            case 3:
                return [1.0, 1.0, 1.0];
            case 4:
                return [1.0, 1.0, 1.41, 1.41];
            case 5:
                return [1.0, 1.0, 1.0, 1.41, 1.41];
            case 6:
                return [1.0, 1.0, 1.0, 0.0, 1.41, 1.41];
            default: {
                const w = new Array(channelCount);
                for (let i = 0; i < channelCount; i++) w[i] = 1.0;
                return w;
            }
        }
    }

    function biquadProcess(src, dst, b, a) {
        const b0 = b[0];
        const b1 = b[1];
        const b2 = b[2];
        const a1 = a[1];
        const a2 = a[2];
        let z1 = 0;
        let z2 = 0;
        for (let i = 0; i < src.length; i++) {
            const x = src[i];
            const y = b0 * x + z1;
            z1 = b1 * x - a1 * y + z2;
            z2 = b2 * x - a2 * y;
            dst[i] = y;
        }
    }

    function resampleChannelLinear(src, srcRate, dstRate) {
        if (srcRate === dstRate) return src;
        const ratio = dstRate / srcRate;
        const dstLen = Math.max(1, Math.floor(src.length * ratio));
        const out = new Float32Array(dstLen);
        const maxSrc = src.length - 1;
        for (let i = 0; i < dstLen; i++) {
            const pos = i / ratio;
            const i0 = pos | 0;
            const i1 = i0 < maxSrc ? i0 + 1 : maxSrc;
            const frac = pos - i0;
            out[i] = src[i0] * (1 - frac) + src[i1] * frac;
        }
        return out;
    }

    function prepareKWeightedChannels(buffer) {
        const chCount = buffer.numberOfChannels | 0;
        if (chCount < 1) return [];
        const srcRate = buffer.sampleRate | 0;
        const out = [];
        for (let c = 0; c < chCount; c++) {
            const raw = buffer.getChannelData(c);
            const resampled = resampleChannelLinear(raw, srcRate, TARGET_RATE);
            const tmpA = new Float32Array(resampled.length);
            const tmpB = new Float32Array(resampled.length);
            biquadProcess(resampled, tmpA, K_SHELF_B, K_SHELF_A);
            biquadProcess(tmpA, tmpB, K_HP_B, K_HP_A);
            out.push(tmpB);
        }
        return out;
    }

    function blockLoudnessFromPower(meanWeightedPower) {
        if (!(meanWeightedPower > 0)) return -Infinity;
        return -0.691 + 10 * Math.log10(meanWeightedPower);
    }

    function measureIntegratedLkfsFromKWeightedChannels(channels, weights) {
        const len = channels[0] ? channels[0].length : 0;
        if (len < 1) return null;
        const blockSamples = Math.max(1, Math.round(BLOCK_SEC * TARGET_RATE));
        const hopSamples = Math.max(1, Math.round(HOP_SEC * TARGET_RATE));
        const blockLoudness = [];
        for (let start = 0; start + blockSamples <= len; start += hopSamples) {
            let weightedPower = 0;
            for (let c = 0; c < channels.length; c++) {
                const w = weights[c] || 0;
                if (w <= 0) continue;
                const data = channels[c];
                let sumSq = 0;
                const end = start + blockSamples;
                for (let i = start; i < end; i++) {
                    const s = data[i];
                    sumSq += s * s;
                }
                weightedPower += (w * sumSq) / blockSamples;
            }
            blockLoudness.push(blockLoudnessFromPower(weightedPower));
        }
        if (!blockLoudness.length) return null;
        return integratedLkfsFromBlockLoudness(blockLoudness);
    }

    function integratedLkfsFromBlockLoudness(blockLoudness) {
        if (!blockLoudness || !blockLoudness.length) return null;

        let linSum = 0;
        for (let i = 0; i < blockLoudness.length; i++) {
            linSum += Math.pow(10, blockLoudness[i] / 10);
        }
        const ungatedLkfs = blockLoudnessFromPower(linSum / blockLoudness.length);
        const relGate = ungatedLkfs - REL_OFFSET_LU;
        const gateAt = Math.max(ABS_GATE_LKFS, relGate);

        let gatedLin = 0;
        let gatedCount = 0;
        for (let i = 0; i < blockLoudness.length; i++) {
            if (blockLoudness[i] <= gateAt) continue;
            gatedLin += Math.pow(10, blockLoudness[i] / 10);
            gatedCount += 1;
        }
        if (!gatedCount) return null;
        return blockLoudnessFromPower(gatedLin / gatedCount);
    }

    function measureAudioBufferIntegratedLkfs(buffer) {
        if (!buffer || buffer.numberOfChannels < 1 || buffer.length < 1) return null;
        try {
            const channels = prepareKWeightedChannels(buffer);
            const weights = channelWeights(buffer.numberOfChannels);
            const lkfs = measureIntegratedLkfsFromKWeightedChannels(channels, weights);
            return Number.isFinite(lkfs) ? lkfs : null;
        } catch (err) {
            if (typeof writeLog === 'function') {
                writeLog(
                    'LKFS: measure failed — ' +
                        (err && err.message ? err.message : String(err)),
                );
            }
            return null;
        }
    }

    function formatLkfsDisplay(lkfs) {
        if (!Number.isFinite(lkfs)) return '';
        return lkfs.toFixed(1) + ' LKFS';
    }

    function formatSessionLkfsDisplay(lkfs) {
        if (!Number.isFinite(lkfs)) return '----- LKFS';
        return lkfs.toFixed(1) + ' LKFS';
    }

    function biquadStep(x, b, a, state) {
        const b0 = b[0];
        const b1 = b[1];
        const b2 = b[2];
        const a1 = a[1];
        const a2 = a[2];
        const y = b0 * x + state.z1;
        state.z1 = b1 * x - a1 * y + state.z2;
        state.z2 = b2 * x - a2 * y;
        return y;
    }

    function kWeightSample(x, filt) {
        let y = biquadStep(x, K_SHELF_B, K_SHELF_A, filt.shelf);
        y = biquadStep(y, K_HP_B, K_HP_A, filt.hp);
        return y;
    }

    /** 再生開始からの ITU-R BS.1770 インテグレーテッド LKFS 計測（400 ms / 100 ms hop、48 kHz 基準）。 */
    function createSessionIntegratedLkfsMeter(sourceSampleRate) {
        let srcSr = sourceSampleRate > 0 ? sourceSampleRate | 0 : TARGET_RATE;
        const sr = TARGET_RATE;
        let blockSamples = Math.max(1, Math.round(BLOCK_SEC * sr));
        let hopSamples = Math.max(1, Math.round(HOP_SEC * sr));
        let ringL = new Float32Array(blockSamples);
        let ringR = new Float32Array(blockSamples);
        let writeIdx = 0;
        let totalKwSamples = 0;
        const blockLoudness = [];
        const filtL = {
            shelf: { z1: 0, z2: 0 },
            hp: { z1: 0, z2: 0 },
        };
        const filtR = {
            shelf: { z1: 0, z2: 0 },
            hp: { z1: 0, z2: 0 },
        };

        function clearMeterState() {
            writeIdx = 0;
            totalKwSamples = 0;
            blockLoudness.length = 0;
            ringL.fill(0);
            ringR.fill(0);
            filtL.shelf.z1 = filtL.shelf.z2 = filtL.hp.z1 = filtL.hp.z2 = 0;
            filtR.shelf.z1 = filtR.shelf.z2 = filtR.hp.z1 = filtR.hp.z2 = 0;
        }

        function computeBlockLoudnessFromRing() {
            let sumL = 0;
            let sumR = 0;
            for (let i = 0; i < blockSamples; i++) {
                const idx = (writeIdx + i) % blockSamples;
                const l = ringL[idx];
                const r = ringR[idx];
                sumL += l * l;
                sumR += r * r;
            }
            return blockLoudnessFromPower((sumL + sumR) / blockSamples);
        }

        function pushSample(rawL, rawR) {
            const l = kWeightSample(rawL, filtL);
            const r = kWeightSample(rawR, filtR);
            ringL[writeIdx] = l;
            ringR[writeIdx] = r;
            writeIdx = (writeIdx + 1) % blockSamples;
            totalKwSamples++;
            if (
                totalKwSamples >= blockSamples &&
                (totalKwSamples - blockSamples) % hopSamples === 0
            ) {
                blockLoudness.push(computeBlockLoudnessFromRing());
            }
        }

        function pushResampledPairAtSourceRate(lBuf, rBuf, i0, i1, frac) {
            const l = lBuf[i0] * (1 - frac) + lBuf[i1] * frac;
            const r = rBuf[i0] * (1 - frac) + rBuf[i1] * frac;
            pushSample(l, r);
        }

        function pushBlockAtSourceRate(lBuf, rBuf, count) {
            const n = Math.min(count | 0, lBuf.length, rBuf.length);
            if (n <= 0) return;
            if (srcSr === sr) {
                for (let i = 0; i < n; i++) {
                    pushSample(lBuf[i], rBuf[i]);
                }
                return;
            }
            const ratio = sr / srcSr;
            const outLen = Math.max(1, Math.floor(n * ratio));
            const maxSrc = n - 1;
            for (let i = 0; i < outLen; i++) {
                const pos = i / ratio;
                const i0 = pos | 0;
                const i1 = i0 < maxSrc ? i0 + 1 : maxSrc;
                const frac = pos - i0;
                pushResampledPairAtSourceRate(lBuf, rBuf, i0, i1, frac);
            }
        }

        function getSessionIntegratedLkfs() {
            return integratedLkfsFromBlockLoudness(blockLoudness);
        }

        function reset(nextSourceRate) {
            if (
                typeof nextSourceRate === 'number' &&
                isFinite(nextSourceRate) &&
                (nextSourceRate | 0) !== srcSr
            ) {
                srcSr = nextSourceRate | 0;
            }
            clearMeterState();
        }

        clearMeterState();

        return {
            getSourceSampleRate: () => srcSr,
            pushBlockAtSourceRate,
            getSessionIntegratedLkfs,
            reset,
        };
    }

    function getTrackLkfsEl(trackEl) {
        if (!trackEl) return null;
        return trackEl.querySelector('.audio-waveform-lane__lkfs');
    }

    function setWaveformTrackLkfsDisplay(trackEl, lkfs) {
        const el = getTrackLkfsEl(trackEl);
        if (!el) return;
        const text = formatLkfsDisplay(lkfs);
        if (!text) {
            if (trackEl) lkfsValueByTrack.delete(trackEl);
            el.textContent = '';
            el.hidden = true;
            return;
        }
        if (trackEl) lkfsValueByTrack.set(trackEl, lkfs);
        el.textContent = text;
        el.hidden = isWaveformTrackLkfsDisplaySuppressed();
    }

    function setWaveformTrackLkfsPending(trackEl, pending) {
        if (!trackEl) return;
        if (pending) lkfsPendingByTrack.set(trackEl, true);
        else lkfsPendingByTrack.delete(trackEl);
    }

    function syncLoadingForTrackEl(trackEl) {
        if (!trackEl || !trackEl.id) return;
        if (trackEl.id === 'audioWaveformTrack') {
            if (typeof syncVideoTrackWaveformLoading === 'function') {
                syncVideoTrackWaveformLoading();
            }
            return;
        }
        const m = /^extraAudioTrack(\d+)$/.exec(trackEl.id);
        if (m && typeof syncExtraTrackWaveformLoading === 'function') {
            syncExtraTrackWaveformLoading(parseInt(m[1], 10));
        }
    }

    function isWaveformTrackLkfsReady(trackEl) {
        if (!trackEl) return true;
        return !lkfsPendingByTrack.get(trackEl);
    }

    function clearWaveformTrackLkfs(trackEl) {
        if (trackEl) {
            measureGenByTrack.set(trackEl, (measureGenByTrack.get(trackEl) || 0) + 1);
        }
        setWaveformTrackLkfsPending(trackEl, false);
        setWaveformTrackLkfsDisplay(trackEl, null);
    }

    async function scheduleWaveformTrackLkfsMeasure(trackEl, buffer, opt) {
        if (!trackEl || !buffer) return;
        const gen = (measureGenByTrack.get(trackEl) || 0) + 1;
        measureGenByTrack.set(trackEl, gen);
        const lkfsEl = getTrackLkfsEl(trackEl);
        if (!lkfsEl) return;
        setWaveformTrackLkfsPending(trackEl, true);
        syncLoadingForTrackEl(trackEl);
        if (!isWaveformTrackLkfsDisplaySuppressed()) {
            lkfsEl.textContent = '…';
            lkfsEl.hidden = false;
        } else {
            lkfsEl.hidden = true;
        }

        if (!(opt && opt.skipYield)) {
            await yieldToBrowser();
        }
        if (measureGenByTrack.get(trackEl) !== gen) return;

        const lkfs = measureAudioBufferIntegratedLkfs(buffer);
        if (measureGenByTrack.get(trackEl) !== gen) return;
        setWaveformTrackLkfsDisplay(trackEl, lkfs);
        setWaveformTrackLkfsPending(trackEl, false);
        syncLoadingForTrackEl(trackEl);
    }

    window.measureAudioBufferIntegratedLkfs = measureAudioBufferIntegratedLkfs;
    window.createSessionIntegratedLkfsMeter = createSessionIntegratedLkfsMeter;
    window.formatLkfsDisplay = formatLkfsDisplay;
    window.formatSessionLkfsDisplay = formatSessionLkfsDisplay;
    window.setWaveformTrackLkfsDisplay = setWaveformTrackLkfsDisplay;
    window.clearWaveformTrackLkfs = clearWaveformTrackLkfs;
    window.scheduleWaveformTrackLkfsMeasure = scheduleWaveformTrackLkfsMeasure;
    window.isWaveformTrackLkfsReady = isWaveformTrackLkfsReady;
    window.refreshAllWaveformTrackLkfsVisibility = refreshAllWaveformTrackLkfsVisibility;

    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => refreshAllWaveformTrackLkfsVisibility());
    }
})();
