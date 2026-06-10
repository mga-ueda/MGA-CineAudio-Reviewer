/**
 * waveform-peaks-worker.js — 波形ピーク計算 Web Worker（最細レベル生成、waveform-peaks から起動）。
 */
self.onmessage = function (ev) {
    const data = ev.data;
    if (!data) return;

    if (data.type === 'range') {
        const samples = data.samples;
        const barCount = Math.max(1, data.barCount | 0);
        const startSample = Math.max(0, data.startSample | 0);
        const endSample = Math.min(samples.length, data.endSample | 0);
        const len = Math.max(0, endSample - startSample);
        if (len <= 0) {
            self.postMessage({ type: 'rangeBuilt', id: data.id, peaks: [] }, []);
            return;
        }
        const block = Math.max(1, Math.floor(len / barCount));
        const peaks = new Array(barCount);
        for (let i = 0; i < barCount; i++) {
            const start = startSample + i * block;
            const end = Math.min(endSample, start + block);
            let min = 0;
            let max = 0;
            for (let j = start; j < end; j++) {
                const v = samples[j];
                if (v < min) min = v;
                if (v > max) max = v;
            }
            peaks[i] = { min, max };
        }
        self.postMessage({ type: 'rangeBuilt', id: data.id, peaks }, []);
        return;
    }

    if (data.type !== 'build') return;
    const samples = data.samples;
    const barCount = Math.max(1, data.barCount | 0);
    const len = samples.length;
    const block = Math.max(1, Math.floor(len / barCount));
    const peaks = new Array(barCount);
    for (let i = 0; i < barCount; i++) {
        const start = i * block;
        const end = Math.min(len, start + block);
        let min = 0;
        let max = 0;
        for (let j = start; j < end; j++) {
            const v = samples[j];
            if (v < min) min = v;
            if (v > max) max = v;
        }
        peaks[i] = { min, max };
    }
    self.postMessage({ type: 'built', id: data.id, peaks }, []);
};
