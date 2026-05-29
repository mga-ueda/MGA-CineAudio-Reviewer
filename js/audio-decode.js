/**
 * audio-decode.js — AudioContext.decodeAudioData（動画波形・Ex トラック共通）。
 */
(function audioDecodeModule() {
    const DEFAULT_DECODE_TIMEOUT_MS = 90000;

    function decodeArrayBufferToAudioBuffer(ctx, ab, timeoutMs) {
        if (!ctx || !ab) throw new Error('decodeAudioData: no context or data');
        const ms = Number.isFinite(timeoutMs)
            ? timeoutMs
            : typeof EXTRA_AUDIO_DECODE_TIMEOUT_MS === 'number'
              ? EXTRA_AUDIO_DECODE_TIMEOUT_MS
              : DEFAULT_DECODE_TIMEOUT_MS;
        const copy = ab.slice(0);
        let decoded = ctx.decodeAudioData(copy);
        if (!decoded || typeof decoded.then !== 'function') {
            decoded = new Promise((resolve, reject) => {
                ctx.decodeAudioData(copy, resolve, reject);
            });
        }
        return Promise.race([
            decoded,
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('decodeAudioData timeout')), ms);
            }),
        ]);
    }

    window.decodeArrayBufferToAudioBuffer = decodeArrayBufferToAudioBuffer;
})();
