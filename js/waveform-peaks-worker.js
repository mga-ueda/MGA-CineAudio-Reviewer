/**
 * waveform-peaks-worker.js — 波形ピーク計算 Web Worker（最細レベル生成、waveform-peaks から起動）。
 */
self.onmessage = function (ev) {
    const data = ev.data;
    if (!data) return;

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
