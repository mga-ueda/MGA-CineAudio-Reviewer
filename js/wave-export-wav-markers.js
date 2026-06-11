/**
 * wave-export-wav-markers.js — Wave 書き出し後の cue / LIST(adtl) マーカー・リージョン埋め込み。
 * Sound Forge 等互換: fmt → cue → LIST(adtl) → plst → data の順（data より前に配置）。
 * 日本語ラベルは js/vendor/tiny-sjis-encoder.js（MIT, t-kouyama）で CP932 エンコード。
 */
(function waveExportWavMarkersModule() {
    const DATA_FCC = 0x61746164; /* 'data' */

    function writeFourCc(target, offset, str) {
        for (let i = 0; i < 4; i++) {
            target[offset + i] = str.charCodeAt(i) & 0xff;
        }
    }

    function readFourCc(bytes, offset) {
        let s = '';
        for (let i = 0; i < 4; i++) s += String.fromCharCode(bytes[offset + i] || 0);
        return s;
    }

    function padToEvenBytes(bytes) {
        if (bytes.length % 2 === 0) return bytes;
        const out = new Uint8Array(bytes.length + 1);
        out.set(bytes);
        return out;
    }

    /** Sound Forge / Windows 日本語環境向け CP932（Shift_JIS）。labl/note は code page なし＝ANSI 扱い */
    const WAV_MARKER_TEXT_CODE_PAGE = 932;
    const WAV_MARKER_TEXT_COUNTRY = 81; /* RIFF: Japan */
    const WAV_MARKER_TEXT_LANGUAGE = 17; /* Japanese */
    const WAV_MARKER_TEXT_DIALECT = 1;

    function encodeAsciiNullTerminated(str) {
        const text = String(str == null ? '' : str);
        const out = new Uint8Array(text.length + 1);
        for (let i = 0; i < text.length; i++) {
            const cp = text.charCodeAt(i);
            out[i] = cp <= 0x7f ? cp : 0x3f;
        }
        return out;
    }

    function encodeMarkerTextNullTerminated(str) {
        if (typeof encodeMs932Bytes === 'function') {
            const encoded = encodeMs932Bytes(str);
            if (encoded && encoded.length) {
                const out = new Uint8Array(encoded.length + 1);
                out.set(encoded);
                return out;
            }
        }
        return encodeAsciiNullTerminated(str);
    }

    function wrapWavChunk(fourCc, bodyBytes) {
        const body = padToEvenBytes(bodyBytes);
        const out = new Uint8Array(8 + body.length);
        writeFourCc(out, 0, fourCc);
        new DataView(out.buffer).setUint32(4, body.length, true);
        out.set(body, 8);
        return out;
    }

    function buildLablSubChunk(cueId, text) {
        const textBytes = padToEvenBytes(encodeMarkerTextNullTerminated(text));
        const body = new Uint8Array(4 + textBytes.length);
        new DataView(body.buffer).setUint32(0, cueId, true);
        body.set(textBytes, 4);
        return wrapWavChunk('labl', body);
    }

    function buildNoteSubChunk(cueId, text) {
        const textBytes = padToEvenBytes(encodeMarkerTextNullTerminated(text));
        const body = new Uint8Array(4 + textBytes.length);
        new DataView(body.buffer).setUint32(0, cueId, true);
        body.set(textBytes, 4);
        return wrapWavChunk('note', body);
    }

    /** WAVLTXT: 20-byte fixed header + null-terminated text (Sound Forge / mmreg.h) */
    function buildLtxtSubChunk(cueId, sampleLength, text) {
        const textBytes = padToEvenBytes(encodeMarkerTextNullTerminated(text));
        const body = new ArrayBuffer(20 + textBytes.length);
        const view = new DataView(body);
        view.setUint32(0, cueId, true);
        view.setUint32(4, sampleLength, true);
        view.setUint32(8, 0, true);
        view.setUint16(12, WAV_MARKER_TEXT_COUNTRY, true);
        view.setUint16(14, WAV_MARKER_TEXT_LANGUAGE, true);
        view.setUint16(16, WAV_MARKER_TEXT_DIALECT, true);
        view.setUint16(18, WAV_MARKER_TEXT_CODE_PAGE, true);
        new Uint8Array(body, 20).set(textBytes);
        return wrapWavChunk('ltxt', new Uint8Array(body));
    }

    function buildCueChunk(cuePoints) {
        const body = new ArrayBuffer(4 + cuePoints.length * 24);
        const view = new DataView(body);
        view.setUint32(0, cuePoints.length, true);
        let off = 4;
        for (let i = 0; i < cuePoints.length; i++) {
            const cp = cuePoints[i];
            view.setUint32(off, cp.id, true);
            view.setUint32(off + 4, cp.sampleOffset, true);
            view.setUint32(off + 8, DATA_FCC, true);
            view.setUint32(off + 12, 0, true);
            view.setUint32(off + 16, 0, true);
            view.setUint32(off + 20, cp.sampleOffset, true);
            off += 24;
        }
        return wrapWavChunk('cue ', new Uint8Array(body));
    }

    /** Sound Forge 等: リージョンは plst（cue ID + 長さ）が必要な場合がある */
    function buildPlstChunk(segments) {
        if (!segments || !segments.length) return null;
        const body = new ArrayBuffer(4 + segments.length * 12);
        const view = new DataView(body);
        view.setUint32(0, segments.length, true);
        let off = 4;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            view.setUint32(off, seg.cueId, true);
            view.setUint32(off + 4, seg.sampleLength, true);
            view.setUint32(off + 8, 0, true);
            off += 12;
        }
        return wrapWavChunk('plst', new Uint8Array(body));
    }

    function buildAdtlListChunk(subChunks) {
        let bodyLen = 4;
        for (let i = 0; i < subChunks.length; i++) bodyLen += subChunks[i].length;
        const body = new Uint8Array(bodyLen);
        writeFourCc(body, 0, 'adtl');
        let off = 4;
        for (let i = 0; i < subChunks.length; i++) {
            body.set(subChunks[i], off);
            off += subChunks[i].length;
        }
        return wrapWavChunk('LIST', body);
    }

    function clampSampleFrame(sec, sampleRate, frameCount) {
        const s = Number(sec);
        if (!Number.isFinite(s)) return 0;
        const frame = Math.round(s * sampleRate);
        if (frameCount <= 0) return Math.max(0, frame);
        return Math.max(0, Math.min(frameCount - 1, frame));
    }

    function cloneMarkerForExport(m) {
        if (!m || typeof m !== 'object') return null;
        if (m.type === 'range') {
            return {
                type: 'range',
                startSec: Number(m.startSec),
                endSec: Number(m.endSec),
                comment: typeof m.comment === 'string' ? m.comment : '',
            };
        }
        return {
            type: 'point',
            timeSec: Number(m.timeSec),
            comment: typeof m.comment === 'string' ? m.comment : '',
        };
    }

    function resolveWaveExportMarkers(markersOpt) {
        if (Array.isArray(markersOpt) && markersOpt.length) {
            return markersOpt.map(cloneMarkerForExport).filter(Boolean);
        }
        if (typeof getMarkersSnapshot === 'function') {
            const snap = getMarkersSnapshot();
            if (Array.isArray(snap) && snap.length) return snap;
        }
        if (typeof currentMarkers !== 'undefined' && Array.isArray(currentMarkers) && currentMarkers.length) {
            return currentMarkers.map(cloneMarkerForExport).filter(Boolean);
        }
        return [];
    }

    function markerSortSec(m) {
        if (!m) return 0;
        if (m.type === 'range') return Number(m.startSec) || 0;
        return Number(m.timeSec) || 0;
    }

    function normalizeExportComment(str) {
        return String(str == null ? '' : str).trim();
    }

    /** 同一位置・同一範囲の重複コメントを「 / 」で結合（空行・完全一致は省略） */
    function mergeExportComments(comments) {
        const seen = new Set();
        const parts = [];
        for (let i = 0; i < comments.length; i++) {
            const c = normalizeExportComment(comments[i]);
            if (!c || seen.has(c)) continue;
            seen.add(c);
            parts.push(c);
        }
        return parts.join(' / ');
    }

    function resolveRangeExportFrames(m, sampleRate, frameCount) {
        const startSec = Number(m.startSec);
        const endSec = Number(m.endSec);
        if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return null;
        let startFrame = clampSampleFrame(startSec, sampleRate, frameCount);
        let endFrame = clampSampleFrame(endSec, sampleRate, frameCount);
        if (endFrame <= startFrame) {
            endFrame = Math.min(
                frameCount > 0 ? frameCount - 1 : startFrame + 1,
                startFrame + 1,
            );
        }
        return { startFrame, endFrame, sampleLength: Math.max(1, endFrame - startFrame) };
    }

    /** 書き込み先が同一サンプル位置の点マーカーを 1 件にまとめる */
    function coalescePointMarkersForExport(list, sampleRate, frameCount) {
        const order = [];
        const byFrame = new Map();
        for (let i = 0; i < list.length; i++) {
            const m = list[i];
            if (!m || m.type !== 'point') continue;
            const sampleOffset = clampSampleFrame(m.timeSec, sampleRate, frameCount);
            const key = String(sampleOffset);
            if (!byFrame.has(key)) {
                byFrame.set(key, { sampleOffset, comments: [] });
                order.push(key);
            }
            byFrame.get(key).comments.push(m.comment);
        }
        const out = [];
        for (let i = 0; i < order.length; i++) {
            const g = byFrame.get(order[i]);
            out.push({
                type: 'point',
                timeSec: g.sampleOffset / sampleRate,
                comment: mergeExportComments(g.comments),
            });
        }
        return out;
    }

    /** 書き込み先が同一 In/Out（サンプルフレーム）のリージョンを 1 件にまとめる */
    function coalesceRangeMarkersForExport(list, sampleRate, frameCount) {
        const order = [];
        const byBounds = new Map();
        for (let i = 0; i < list.length; i++) {
            const m = list[i];
            if (!m || m.type !== 'range') continue;
            const bounds = resolveRangeExportFrames(m, sampleRate, frameCount);
            if (!bounds) continue;
            const key = bounds.startFrame + ':' + bounds.endFrame;
            if (!byBounds.has(key)) {
                byBounds.set(key, {
                    startFrame: bounds.startFrame,
                    endFrame: bounds.endFrame,
                    comments: [],
                });
                order.push(key);
            }
            byBounds.get(key).comments.push(m.comment);
        }
        const out = [];
        for (let i = 0; i < order.length; i++) {
            const g = byBounds.get(order[i]);
            out.push({
                type: 'range',
                startSec: g.startFrame / sampleRate,
                endSec: g.endFrame / sampleRate,
                comment: mergeExportComments(g.comments),
            });
        }
        return out;
    }

    function coalesceMarkersForWaveExport(list, sampleRate, frameCount) {
        const points = coalescePointMarkersForExport(list, sampleRate, frameCount);
        const ranges = coalesceRangeMarkersForExport(list, sampleRate, frameCount);
        return points.concat(ranges).sort((a, b) => markerSortSec(a) - markerSortSec(b));
    }

    function buildWavMarkerChunks(markers, sampleRate, frameCount) {
        const list = coalesceMarkersForWaveExport(
            resolveWaveExportMarkers(markers)
                .filter((m) => m && (m.type === 'point' || m.type === 'range'))
                .slice()
                .sort((a, b) => markerSortSec(a) - markerSortSec(b)),
            sampleRate,
            frameCount,
        );

        if (!list.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
            return {
                cueChunk: null,
                listChunk: null,
                plstChunk: null,
                pointCount: 0,
                regionCount: 0,
            };
        }

        const cuePoints = [];
        const adtlSubChunks = [];
        const plstSegments = [];
        let nextCueId = 1;
        let pointCount = 0;
        let regionCount = 0;

        for (let i = 0; i < list.length; i++) {
            const m = list[i];
            const comment = typeof m.comment === 'string' ? m.comment : '';

            if (m.type === 'point') {
                const sampleOffset = clampSampleFrame(m.timeSec, sampleRate, frameCount);
                const cueId = nextCueId++;
                cuePoints.push({ id: cueId, sampleOffset });
                adtlSubChunks.push(buildLablSubChunk(cueId, comment));
                adtlSubChunks.push(buildNoteSubChunk(cueId, comment));
                pointCount += 1;
                continue;
            }

            if (m.type === 'range') {
                const bounds = resolveRangeExportFrames(m, sampleRate, frameCount);
                if (!bounds) continue;
                const { startFrame, sampleLength } = bounds;
                const cueId = nextCueId++;
                cuePoints.push({ id: cueId, sampleOffset: startFrame });
                adtlSubChunks.push(buildLtxtSubChunk(cueId, sampleLength, comment));
                adtlSubChunks.push(buildLablSubChunk(cueId, comment));
                plstSegments.push({ cueId, sampleLength });
                regionCount += 1;
            }
        }

        if (!cuePoints.length) {
            return {
                cueChunk: null,
                listChunk: null,
                plstChunk: null,
                pointCount: 0,
                regionCount: 0,
            };
        }

        return {
            cueChunk: buildCueChunk(cuePoints),
            listChunk: buildAdtlListChunk(adtlSubChunks),
            plstChunk: buildPlstChunk(plstSegments),
            pointCount,
            regionCount,
        };
    }

    function parsePcmWavChunks(wavBytes) {
        const bytes =
            wavBytes instanceof Uint8Array ? wavBytes : new Uint8Array(wavBytes);
        if (bytes.length < 12) return null;
        if (readFourCc(bytes, 0) !== 'RIFF' || readFourCc(bytes, 8) !== 'WAVE') {
            return null;
        }

        const chunks = [];
        let off = 12;
        while (off + 8 <= bytes.length) {
            const id = readFourCc(bytes, off);
            const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
                off + 4,
                true,
            );
            const total = 8 + size + (size % 2);
            if (off + total > bytes.length) break;
            chunks.push({
                id,
                start: off,
                end: off + total,
                bytes: bytes.subarray(off, off + total),
            });
            off += total;
        }

        const fmt = chunks.find((c) => c.id === 'fmt ');
        const data = chunks.find((c) => c.id === 'data');
        if (!fmt || !data) return null;
        return { fmt, data, all: chunks };
    }

    function rebuildWavWithMarkerChunks(wavBytes, cueChunk, listChunk, plstChunk) {
        const parsed = parsePcmWavChunks(wavBytes);
        if (!parsed) return null;

        const bodyParts = [parsed.fmt.bytes, cueChunk, listChunk];
        if (plstChunk) bodyParts.push(plstChunk);
        bodyParts.push(parsed.data.bytes);
        let bodyLen = 0;
        for (let i = 0; i < bodyParts.length; i++) bodyLen += bodyParts[i].length;

        const out = new Uint8Array(12 + bodyLen);
        writeFourCc(out, 0, 'RIFF');
        new DataView(out.buffer).setUint32(4, 4 + bodyLen, true);
        writeFourCc(out, 8, 'WAVE');
        let writeOff = 12;
        for (let i = 0; i < bodyParts.length; i++) {
            out.set(bodyParts[i], writeOff);
            writeOff += bodyParts[i].length;
        }
        return out;
    }

    function embedMarkerChunksInWavBytes(wavBytes, markersOpt, sampleRate, frameCount) {
        const built = buildWavMarkerChunks(markersOpt, sampleRate, frameCount);
        if (!built.cueChunk || !built.listChunk) {
            return { bytes: wavBytes, embedded: false, pointCount: 0, regionCount: 0 };
        }

        const src =
            wavBytes instanceof Uint8Array ? wavBytes : new Uint8Array(wavBytes);
        const rebuilt = rebuildWavWithMarkerChunks(
            src,
            built.cueChunk,
            built.listChunk,
            built.plstChunk,
        );
        if (!rebuilt) {
            return { bytes: src, embedded: false, pointCount: 0, regionCount: 0 };
        }

        return {
            bytes: rebuilt,
            embedded: true,
            pointCount: built.pointCount,
            regionCount: built.regionCount,
        };
    }

    function estimateWaveFrameCountFromBytes(wavBytes, channels, bitsPerSample) {
        const bytes =
            wavBytes instanceof Uint8Array ? wavBytes : new Uint8Array(wavBytes || 0);
        if (!bytes.length || bytes.length <= 44) return 0;
        const parsed = parsePcmWavChunks(bytes);
        if (!parsed || !parsed.data) return 0;
        const dataSize = parsed.data.bytes.length - 8;
        const blockAlign = channels * (bitsPerSample / 8);
        if (!(blockAlign > 0)) return 0;
        return Math.floor(dataSize / blockAlign);
    }

    async function wavBytesFromBlob(blob) {
        if (blob instanceof ArrayBuffer) return new Uint8Array(blob);
        if (blob instanceof Uint8Array) return blob;
        if (!blob || typeof blob.arrayBuffer !== 'function') return new Uint8Array(0);
        return new Uint8Array(await blob.arrayBuffer());
    }

    async function finalizeWaveExportBlobWithMarkers(blob, sampleRate, frameCount, markersOpt) {
        if (!blob) return blob;
        const blobSize = blob.size != null ? blob.size : blob.byteLength;
        if (!blobSize) return blob;

        const sr = Number(sampleRate);
        let frames = Number(frameCount);
        const wavBytes = await wavBytesFromBlob(blob);
        if (!Number.isFinite(frames) || frames <= 0) {
            frames = estimateWaveFrameCountFromBytes(wavBytes, 2, 24);
        }
        if (!Number.isFinite(sr) || sr <= 0 || !Number.isFinite(frames) || frames <= 0) {
            return blob;
        }

        const markers = resolveWaveExportMarkers(markersOpt);
        if (!markers.length) {
            if (typeof writeLog === 'function') {
                writeLog('Export Wave: no markers to embed in WAV');
            }
            return blob;
        }

        const result = embedMarkerChunksInWavBytes(wavBytes, markers, sr, frames);
        if (!result.embedded) {
            if (typeof writeLog === 'function') {
                writeLog('Export Wave: WAV marker embed failed (invalid WAV layout)');
            }
            return blob;
        }

        if (typeof writeLog === 'function') {
            writeLog(
                'Export Wave: embedded WAV markers — ' +
                    result.pointCount +
                    ' marker(s), ' +
                    result.regionCount +
                    ' region(s)',
            );
        }
        return new Blob([result.bytes], { type: 'audio/wav' });
    }

    window.resolveWaveExportMarkers = resolveWaveExportMarkers;
    window.coalesceMarkersForWaveExport = coalesceMarkersForWaveExport;
    window.buildWavMarkerCueChunks = buildWavMarkerChunks;
    window.embedMarkerChunksInWavBytes = embedMarkerChunksInWavBytes;
    window.finalizeWaveExportBlobWithMarkers = finalizeWaveExportBlobWithMarkers;
})();
