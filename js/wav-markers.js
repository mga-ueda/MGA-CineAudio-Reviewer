/**
 * wav-markers.js — WAV cue / LIST(adtl) / plst マーカー・リージョンの読み取りと書き込み。
 * Sound Forge 等互換: fmt → cue → LIST(adtl) → plst → data の順（書き込み時は data より前に配置）。
 * 日本語ラベルは js/vendor/tiny-sjis-encoder.js（MIT, t-kouyama）で CP932 エンコード。
 */
(function wavMarkersModule() {
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

    let wavMarkerTextDecoder = null;

    function resolveWavMarkerTextDecoder() {
        if (wavMarkerTextDecoder) return wavMarkerTextDecoder;
        const labels = ['ms932', 'shift_jis', 'windows-31j', 'shift-jis'];
        for (let i = 0; i < labels.length; i++) {
            try {
                wavMarkerTextDecoder = new TextDecoder(labels[i]);
                return wavMarkerTextDecoder;
            } catch (_) {
                wavMarkerTextDecoder = null;
            }
        }
        return null;
    }

    function decodeWavMarkerTextBytes(bytes, start, end) {
        if (!bytes || start >= end) return '';
        let term = start;
        while (term < end && bytes[term] !== 0) term += 1;
        const slice = bytes.subarray(start, term);
        if (!slice.length) return '';
        const dec = resolveWavMarkerTextDecoder();
        if (dec) {
            try {
                return String(dec.decode(slice)).trim();
            } catch (_) {}
        }
        let out = '';
        for (let i = 0; i < slice.length; i++) {
            const cp = slice[i];
            out += cp <= 0x7f ? String.fromCharCode(cp) : '?';
        }
        return out.trim();
    }

    function readFmtSampleRate(fmtChunkBytes) {
        const body = fmtChunkBytes.subarray(8);
        if (body.length < 8) return 0;
        const rate = new DataView(
            body.buffer,
            body.byteOffset,
            body.byteLength,
        ).getUint32(4, true);
        return rate > 0 ? rate : 0;
    }

    function estimateFrameCountFromWavParsed(parsed) {
        if (!parsed || !parsed.fmt || !parsed.data) return 0;
        const body = parsed.fmt.bytes.subarray(8);
        if (body.length < 16) return 0;
        const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
        const channels = view.getUint16(2, true);
        const bitsPerSample = view.getUint16(14, true);
        const dataSize = parsed.data.bytes.length - 8;
        const blockAlign = channels * (bitsPerSample / 8);
        if (!(blockAlign > 0)) return 0;
        return Math.floor(dataSize / blockAlign);
    }

    function parseCueChunkMap(cueChunkBytes) {
        const body = cueChunkBytes.subarray(8);
        if (body.length < 4) return new Map();
        const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
        const count = view.getUint32(0, true);
        const out = new Map();
        let off = 4;
        for (let i = 0; i < count; i++) {
            if (off + 24 > body.length) break;
            const id = view.getUint32(off, true);
            const sampleOffset = view.getUint32(off + 4, true);
            out.set(id, sampleOffset);
            off += 24;
        }
        return out;
    }

    function parsePlstSegments(plstChunkBytes) {
        const body = plstChunkBytes.subarray(8);
        if (body.length < 4) return [];
        const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
        const count = view.getUint32(0, true);
        const out = [];
        let off = 4;
        for (let i = 0; i < count; i++) {
            if (off + 12 > body.length) break;
            out.push({
                cueId: view.getUint32(off, true),
                sampleLength: view.getUint32(off + 4, true),
            });
            off += 12;
        }
        return out;
    }

    function parseAdtlListChunk(listChunkBytes) {
        const body = listChunkBytes.subarray(8);
        if (body.length < 4 || readFourCc(body, 0) !== 'adtl') {
            return { labl: new Map(), note: new Map(), ltxt: new Map() };
        }
        const labl = new Map();
        const note = new Map();
        const ltxt = new Map();
        let off = 4;
        while (off + 8 <= body.length) {
            const id = readFourCc(body, off);
            const size = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(
                off + 4,
                true,
            );
            const dataStart = off + 8;
            const dataEnd = Math.min(body.length, dataStart + size);
            if (dataEnd - dataStart >= 4) {
                const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
                const cueId = view.getUint32(dataStart, true);
                if (id === 'labl') {
                    labl.set(cueId, decodeWavMarkerTextBytes(body, dataStart + 4, dataEnd));
                } else if (id === 'note') {
                    note.set(cueId, decodeWavMarkerTextBytes(body, dataStart + 4, dataEnd));
                } else if (id === 'ltxt' && dataEnd - dataStart >= 20) {
                    ltxt.set(cueId, view.getUint32(dataStart + 4, true));
                }
            }
            off += 8 + size + (size & 1);
        }
        return { labl, note, ltxt };
    }

    function markerCommentFromAdtl(cueId, adtl) {
        const fromLabl = adtl.labl.get(cueId);
        if (typeof fromLabl === 'string' && fromLabl.trim()) return fromLabl.trim();
        const fromNote = adtl.note.get(cueId);
        if (typeof fromNote === 'string' && fromNote.trim()) return fromNote.trim();
        return '';
    }

    function sampleOffsetToSec(sampleOffset, sampleRate, frameCount) {
        if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 0;
        let frame = Math.max(0, Math.round(Number(sampleOffset) || 0));
        if (frameCount > 0) frame = Math.min(frame, frameCount - 1);
        return frame / sampleRate;
    }

    /** RIFF WAVE の cue / LIST(adtl) / plst から点マーカー・リージョンを読み取る */
    function parseMarkersFromWavBytes(wavBytes) {
        const parsed = parsePcmWavChunks(wavBytes);
        if (!parsed) {
            return {
                markers: [],
                sampleRate: 0,
                durationSec: 0,
                pointCount: 0,
                regionCount: 0,
            };
        }
        const cueChunk = parsed.all.find((c) => c.id === 'cue ');
        if (!cueChunk) {
            return {
                markers: [],
                sampleRate: readFmtSampleRate(parsed.fmt.bytes),
                durationSec: 0,
                pointCount: 0,
                regionCount: 0,
            };
        }
        const sampleRate = readFmtSampleRate(parsed.fmt.bytes);
        const frameCount = estimateFrameCountFromWavParsed(parsed);
        const durationSec =
            sampleRate > 0 && frameCount > 0 ? frameCount / sampleRate : 0;
        const cueMap = parseCueChunkMap(cueChunk.bytes);
        const plstChunk = parsed.all.find((c) => c.id === 'plst');
        const plstSegments = plstChunk ? parsePlstSegments(plstChunk.bytes) : [];
        const listChunk = parsed.all.find((c) => c.id === 'LIST');
        const adtl = listChunk ? parseAdtlListChunk(listChunk.bytes) : {
            labl: new Map(),
            note: new Map(),
            ltxt: new Map(),
        };

        const regionCueIds = new Set();
        const markers = [];
        let regionCount = 0;

        for (let i = 0; i < plstSegments.length; i++) {
            const seg = plstSegments[i];
            const startFrame = cueMap.get(seg.cueId);
            if (!Number.isFinite(startFrame)) continue;
            const sampleLength = Math.max(1, Number(seg.sampleLength) || 0);
            const startSec = sampleOffsetToSec(startFrame, sampleRate, frameCount);
            const endSec = sampleOffsetToSec(
                startFrame + sampleLength,
                sampleRate,
                frameCount,
            );
            if (endSec <= startSec) continue;
            regionCueIds.add(seg.cueId);
            markers.push({
                type: 'range',
                startSec,
                endSec,
                comment: markerCommentFromAdtl(seg.cueId, adtl),
            });
            regionCount += 1;
        }

        adtl.ltxt.forEach((sampleLength, cueId) => {
            if (regionCueIds.has(cueId)) return;
            const startFrame = cueMap.get(cueId);
            if (!Number.isFinite(startFrame)) return;
            const len = Math.max(1, Number(sampleLength) || 0);
            const startSec = sampleOffsetToSec(startFrame, sampleRate, frameCount);
            const endSec = sampleOffsetToSec(startFrame + len, sampleRate, frameCount);
            if (endSec <= startSec) return;
            regionCueIds.add(cueId);
            markers.push({
                type: 'range',
                startSec,
                endSec,
                comment: markerCommentFromAdtl(cueId, adtl),
            });
            regionCount += 1;
        });

        let pointCount = 0;
        cueMap.forEach((startFrame, cueId) => {
            if (regionCueIds.has(cueId)) return;
            markers.push({
                type: 'point',
                timeSec: sampleOffsetToSec(startFrame, sampleRate, frameCount),
                comment: markerCommentFromAdtl(cueId, adtl),
            });
            pointCount += 1;
        });

        markers.sort((a, b) => markerSortSec(a) - markerSortSec(b));
        return {
            markers,
            sampleRate,
            durationSec,
            pointCount,
            regionCount,
        };
    }

    function importWavMarkersOnWaveformLoad(ab, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.fromSessionRestore || o.skipWavMarkerImport) return null;
        if (
            typeof hasSessionMarkersPendingRestore === 'function' &&
            hasSessionMarkersPendingRestore()
        ) {
            return null;
        }
        const parsed = parseMarkersFromWavBytes(ab);
        if (!parsed || !parsed.markers.length) return parsed;
        if (typeof applyImportedFileMarkers !== 'function') return parsed;
        const applied = applyImportedFileMarkers(parsed.markers, {
            timelineOffsetSec: o.timelineOffsetSec,
            fileDurationSec: o.fileDurationSec != null ? o.fileDurationSec : parsed.durationSec,
            merge: o.merge,
            replace: o.replace,
            logLabel: o.logLabel,
        });
        if (applied > 0 && typeof writeLog === 'function') {
            const label = o.logLabel ? o.logLabel + ': ' : '';
            writeLog(
                label +
                    'imported WAV markers — ' +
                    parsed.pointCount +
                    ' marker(s), ' +
                    parsed.regionCount +
                    ' region(s)',
            );
        }
        return parsed;
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
    window.parseMarkersFromWavBytes = parseMarkersFromWavBytes;
    window.importWavMarkersOnWaveformLoad = importWavMarkersOnWaveformLoad;
    window.finalizeWaveExportBlobWithMarkers = finalizeWaveExportBlobWithMarkers;
})();
