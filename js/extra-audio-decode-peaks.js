/**
 * extra-audio-decode-peaks.js — WAV/AudioBuffer デコードと peaks 生成
 */
    function buildPeaksPreviewFromWavArrayBuffer(ab, barCount) {
        if (!ab || ab.byteLength < 44) return null;
        const view = new DataView(ab);
        const sig = String.fromCharCode(
            view.getUint8(0),
            view.getUint8(1),
            view.getUint8(2),
            view.getUint8(3),
        );
        if (sig !== 'RIFF') return null;
        let offset = 12;
        let numChannels = 0;
        let sampleRate = 0;
        let bitsPerSample = 0;
        let dataOffset = 0;
        let dataLen = 0;
        while (offset + 8 <= ab.byteLength) {
            const id = String.fromCharCode(
                view.getUint8(offset),
                view.getUint8(offset + 1),
                view.getUint8(offset + 2),
                view.getUint8(offset + 3),
            );
            const size = view.getUint32(offset + 4, true);
            if (id === 'fmt ') {
                numChannels = view.getUint16(offset + 10, true);
                sampleRate = view.getUint32(offset + 12, true);
                bitsPerSample = view.getUint16(offset + 22, true);
            } else if (id === 'data') {
                dataOffset = offset + 8;
                dataLen = size;
                break;
            }
            offset += 8 + size + (size & 1);
        }
        if (!dataOffset || !numChannels || !sampleRate || !bitsPerSample) return null;
        const bytesPerSample = bitsPerSample / 8;
        const frameSize = bytesPerSample * numChannels;
        if (frameSize < 1) return null;
        const totalFrames = Math.floor(dataLen / frameSize);
        if (totalFrames < 1) return null;
        const duration = totalFrames / sampleRate;
        const bars = Math.max(1, barCount | 0);
        const block = Math.max(1, Math.floor(totalFrames / bars));
        const peaks = new Array(bars);
        for (let i = 0; i < bars; i++) {
            let min = 0;
            let max = 0;
            const start = i * block;
            const end = Math.min(totalFrames, start + block);
            for (let f = start; f < end; f++) {
                const pos = dataOffset + f * frameSize;
                if (pos + bytesPerSample > ab.byteLength) break;
                let v = 0;
                if (bitsPerSample === 16) {
                    v = view.getInt16(pos, true) / 32768;
                } else if (bitsPerSample === 24) {
                    let sample = view.getUint8(pos) | (view.getUint8(pos + 1) << 8);
                    const hi = view.getInt8(pos + 2);
                    sample |= hi << 16;
                    v = sample / 8388608;
                } else if (bitsPerSample === 32) {
                    v = view.getFloat32(pos, true);
                    if (!Number.isFinite(v)) {
                        v = view.getInt32(pos, true) / 2147483648;
                    }
                } else {
                    return null;
                }
                if (v < min) min = v;
                if (v > max) max = v;
            }
            peaks[i] = { min, max };
        }
        return { peaks, duration };
    }

    async function buildExtraTrackPeaksPreviewFromWavBlob(slot, entry) {
        if (!entry || !entry.blob) return false;
        const name = entry.name || '';
        if (!/\.wav$/i.test(name) && !/\.wave$/i.test(name)) return false;
        try {
            const ab = await entry.blob.arrayBuffer();
            const w =
                typeof rawMasterTimelineWidthCss === 'function'
                    ? rawMasterTimelineWidthCss()
                    : 0;
            const barCount = Math.min(4096, Math.max(200, w > 0 ? w : 1200));
            const built = buildPeaksPreviewFromWavArrayBuffer(ab, barCount);
            if (!built || !built.peaks || !built.peaks.length) return false;
            return applyExtraTrackPeaksPreview(slot, {
                slot,
                name: entry.name,
                lastModified: entry.lastModified,
                duration: built.duration,
                peaks: built.peaks,
            });
        } catch (e) {
            writeLog(
                'Extra audio ' +
                    (slot + 1) +
                    ': WAV preview failed — ' +
                    (e && e.message ? e.message : String(e)),
            );
            return false;
        }
    }

    function clonePeaksForPersist(peaks) {
        if (!peaks || !peaks.length) return null;
        const out = new Array(peaks.length);
        for (let i = 0; i < peaks.length; i++) {
            const p = peaks[i];
            out[i] = {
                min: p && Number.isFinite(p.min) ? p.min : 0,
                max: p && Number.isFinite(p.max) ? p.max : 0,
            };
        }
        return out;
    }

    /** 再生用 reviewMixCtx とは別コンテキストでデコード（リロード直後のハング回避） */
    async function decodeExtraFileArrayBuffer(ab) {
        if (!ab || ab.byteLength < 1) throw new Error('empty file');
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (OfflineCtx) {
            try {
                const offline = new OfflineCtx(2, 2, 48000);
                return await decodeArrayBufferToAudioBuffer(
                    offline,
                    ab,
                    EXTRA_AUDIO_DECODE_TIMEOUT_MS,
                );
            } catch (err) {
                writeLog(
                    'Extra audio decode: OfflineAudioContext failed — ' +
                        (err && err.message ? err.message : String(err)),
                );
            }
        }
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) throw new Error('AudioContext unavailable');
        const decodeCtx = new Ctx();
        try {
            if (decodeCtx.state === 'suspended') {
                try {
                    await decodeCtx.resume();
                } catch (_) {}
            }
            return await decodeArrayBufferToAudioBuffer(
                decodeCtx,
                ab,
                EXTRA_AUDIO_DECODE_TIMEOUT_MS,
            );
        } finally {
            if (decodeCtx.close) {
                try {
                    await decodeCtx.close();
                } catch (_) {}
            }
        }
    }

    function peaksFromBuffer(buffer, barCount) {
        if (!buffer || buffer.numberOfChannels < 1) {
            return null;
        }
        const ch = buffer.getChannelData(0);
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

    function peaksFromBufferRange(buffer, startSec, endSec, barCount) {
        if (!buffer || buffer.numberOfChannels < 1) return [];
        const ch = buffer.getChannelData(0);
        const sr = buffer.sampleRate;
        const startSample = Math.max(0, Math.floor(startSec * sr));
        const endSample = Math.min(ch.length, Math.ceil(endSec * sr));
        if (endSample <= startSample) return [];
        const len = endSample - startSample;
        const bars = Math.max(1, barCount | 0);
        const block = Math.max(1, Math.floor(len / bars));
        const peaks = new Array(bars);
        for (let i = 0; i < bars; i++) {
            const blockStart = startSample + i * block;
            const blockEnd = Math.min(endSample, blockStart + block);
            let min = 0;
            let max = 0;
            for (let j = blockStart; j < blockEnd; j++) {
                const v = ch[j];
                if (v < min) min = v;
                if (v > max) max = v;
            }
            peaks[i] = { min, max };
        }
        return peaks;
    }

    function getExtraTrackClipBuffer(tr, clipId) {
        const clip = getExtraTrackClip(tr, clipId || 'main');
        if (clip && clip.buffer) return clip.buffer;
        return tr && tr.buffer ? tr.buffer : null;
    }

