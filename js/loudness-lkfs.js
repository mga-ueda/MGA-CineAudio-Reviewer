/**
 * ITU-R BS.1770 系のインテグレーテッドラウドネス（LKFS / LUFS）を AudioBuffer から計測する。
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

    function getTrackLkfsEl(trackEl) {
        if (!trackEl) return null;
        return trackEl.querySelector('.audio-waveform-lane__lkfs');
    }

    function setWaveformTrackLkfsDisplay(trackEl, lkfs) {
        const el = getTrackLkfsEl(trackEl);
        if (!el) return;
        const text = formatLkfsDisplay(lkfs);
        if (!text) {
            el.textContent = '';
            el.hidden = true;
            return;
        }
        el.textContent = text;
        el.hidden = false;
    }

    function clearWaveformTrackLkfs(trackEl) {
        if (trackEl) {
            measureGenByTrack.set(trackEl, (measureGenByTrack.get(trackEl) || 0) + 1);
        }
        setWaveformTrackLkfsDisplay(trackEl, null);
    }

    function yieldToBrowser() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    async function scheduleWaveformTrackLkfsMeasure(trackEl, buffer, opt) {
        if (!trackEl || !buffer) return;
        const gen = (measureGenByTrack.get(trackEl) || 0) + 1;
        measureGenByTrack.set(trackEl, gen);
        const lkfsEl = getTrackLkfsEl(trackEl);
        if (!lkfsEl) return;
        lkfsEl.textContent = '…';
        lkfsEl.hidden = false;

        if (!(opt && opt.skipYield)) {
            await yieldToBrowser();
        }
        if (measureGenByTrack.get(trackEl) !== gen) return;

        const lkfs = measureAudioBufferIntegratedLkfs(buffer);
        if (measureGenByTrack.get(trackEl) !== gen) return;
        setWaveformTrackLkfsDisplay(trackEl, lkfs);
    }

    window.measureAudioBufferIntegratedLkfs = measureAudioBufferIntegratedLkfs;
    window.formatLkfsDisplay = formatLkfsDisplay;
    window.setWaveformTrackLkfsDisplay = setWaveformTrackLkfsDisplay;
    window.clearWaveformTrackLkfs = clearWaveformTrackLkfs;
    window.scheduleWaveformTrackLkfsMeasure = scheduleWaveformTrackLkfsMeasure;
})();
