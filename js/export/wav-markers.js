/**
 * wav-markers.js — WAV cue / LIST(adtl) / plst マーカー・リージョン、iXML メタデータの読み取りと書き込み。
 * Sound Forge 等互換: fmt → cue → LIST(adtl) → plst → data の順（書き込み時は data より前に配置）。
 * 日本語ラベルは js/vendor/tiny-sjis-encoder.js（MIT, t-kouyama）で CP932 エンコード。
 * 読み込み時は labl/note/ltxt の生バイトと ltxt の code page から文字コードを推定（UTF-8 / CP932 / UTF-16 LE 等）。
 * Logic Pro 等の UTF-8 書き出しでは chunk 末尾の欠損バイトも補正してからデコードする。
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
        const listed = listWaveRiffChunks(wavBytes);
        if (!listed) return null;
        const fmt = listed.find((c) => c.id === 'fmt ');
        const data = listed.find((c) => c.id === 'data');
        if (!fmt || !data) return null;
        return { fmt, data, all: listed };
    }

    /** RIFF / RF64 のチャンク列（data 以降も走査） */
    function listWaveRiffChunks(wavBytes, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const bytes =
            wavBytes instanceof Uint8Array ? wavBytes : new Uint8Array(wavBytes);
        if (bytes.length < 12) return null;
        const container = readFourCc(bytes, 0);
        if (container !== 'RIFF' && container !== 'RF64') return null;
        if (readFourCc(bytes, 8) !== 'WAVE') return null;

        const chunks = [];
        let off = 12;
        let ds64DataSize = null;
        const dv = (pos) =>
            new DataView(bytes.buffer, bytes.byteOffset + pos, bytes.byteLength - pos);

        while (off + 8 <= bytes.length) {
            const id = readFourCc(bytes, off);
            let size = dv(off).getUint32(4, true);

            if (id === 'ds64' && size >= 28) {
                const body = bytes.subarray(off + 8, off + 8 + size);
                const bodyView = new DataView(
                    body.buffer,
                    body.byteOffset,
                    body.byteLength,
                );
                const lo = bodyView.getUint32(20, true);
                const hi = bodyView.getUint32(24, true);
                ds64DataSize = hi * 4294967296 + lo;
            }

            if (id === 'data' && size === 0xffffffff && ds64DataSize != null) {
                size = ds64DataSize;
            }

            if (size === 0xffffffff && id !== 'data') {
                chunks.push({
                    id,
                    start: off,
                    end: Math.min(off + 8, bytes.length),
                    bytes: bytes.subarray(off, Math.min(off + 8, bytes.length)),
                });
                break;
            }

            const total = 8 + size + (size % 2);
            if (off + total > bytes.length) {
                chunks.push({
                    id,
                    start: off,
                    end: bytes.length,
                    bytes: bytes.subarray(off, bytes.length),
                });
                break;
            }
            chunks.push({
                id,
                start: off,
                end: off + total,
                bytes: bytes.subarray(off, off + total),
            });
            off += total;
            if (id === 'data' && !o.scanPastData) break;
        }
        return chunks.length ? chunks : null;
    }

    function listWaveRiffChunkIds(wavBytes) {
        const chunks = listWaveRiffChunks(wavBytes, { scanPastData: true });
        if (!chunks) return [];
        return chunks.map((c) => c.id);
    }

    function scanWaveRiffChunkById(wavBytes, chunkId) {
        const bytes =
            wavBytes instanceof Uint8Array ? wavBytes : new Uint8Array(wavBytes);
        if (!bytes.length || !chunkId || chunkId.length !== 4) return null;
        const chunks = listWaveRiffChunks(bytes, { scanPastData: true });
        if (chunks) {
            const found = chunks.find((c) => c.id === chunkId);
            if (found) return found;
        }
        return scanTrailingWaveRiffChunkById(bytes, chunkId);
    }

    /** data より後（ファイル末尾付近）に置かれた RIFF チャンク */
    function scanTrailingWaveRiffChunkById(bytes, chunkId) {
        if (!bytes || bytes.length < 16 || !chunkId || chunkId.length !== 4) return null;
        const c0 = chunkId.charCodeAt(0);
        const c1 = chunkId.charCodeAt(1);
        const c2 = chunkId.charCodeAt(2);
        const c3 = chunkId.charCodeAt(3);
        const maxChunkBody = 16 * 1024 * 1024;
        const searchFrom = Math.max(12, bytes.length - maxChunkBody - 8);
        for (let off = bytes.length - 12; off >= searchFrom; off--) {
            if (
                bytes[off] !== c0 ||
                bytes[off + 1] !== c1 ||
                bytes[off + 2] !== c2 ||
                bytes[off + 3] !== c3
            ) {
                continue;
            }
            const size = new DataView(
                bytes.buffer,
                bytes.byteOffset + off,
                bytes.byteLength - off,
            ).getUint32(4, true);
            if (!size || size > maxChunkBody) continue;
            const total = 8 + size + (size % 2);
            if (off + total > bytes.length) continue;
            return {
                id: chunkId,
                start: off,
                end: off + total,
                bytes: bytes.subarray(off, off + total),
            };
        }
        return null;
    }

    function findWaveChunks(chunks, ids) {
        if (!chunks || !ids || !ids.length) return [];
        const out = [];
        for (let i = 0; i < chunks.length; i++) {
            if (ids.indexOf(chunks[i].id) >= 0) out.push(chunks[i]);
        }
        return out;
    }

    function findWaveChunk(chunks, ids) {
        if (!chunks || !ids || !ids.length) return null;
        for (let i = 0; i < ids.length; i++) {
            const want = ids[i];
            const found = chunks.find((c) => c.id === want);
            if (found) return found;
        }
        return null;
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

    const WAV_MARKER_CODE_PAGE_LABELS = {
        65001: 'utf-8',
        1200: 'utf-16le',
        932: 'ms932',
        1252: 'windows-1252',
        28591: 'iso-8859-1',
    };

    const MARKER_TEXT_IMPORT_ENCODING_CANDIDATES = ['utf-8', 'ms932'];

    const MARKER_TEXT_WESTERN_ENCODING_CANDIDATES = ['windows-1252', 'iso-8859-1'];

    const MARKER_TEXT_IMPORT_ENCODING_LABELS = {
        'utf-8': ['utf-8'],
        ms932: ['ms932', 'shift_jis', 'windows-31j', 'shift-jis'],
        'utf-16le': ['utf-16le'],
        'utf-16be': ['utf-16be'],
        'windows-1252': ['windows-1252'],
        'iso-8859-1': ['iso-8859-1', 'latin1'],
    };

    const markerTextDecoderCache = new Map();

    function resolveMarkerTextDecoderLabel(encodingKey) {
        const key = encodingKey || 'ms932';
        const labels =
            MARKER_TEXT_IMPORT_ENCODING_LABELS[key] ||
            MARKER_TEXT_IMPORT_ENCODING_LABELS.ms932;
        for (let i = 0; i < labels.length; i++) {
            if (markerTextDecoderCache.has(labels[i])) {
                return labels[i];
            }
            try {
                const dec = new TextDecoder(labels[i]);
                dec.decode(new Uint8Array([0x41]));
                markerTextDecoderCache.set(labels[i], dec);
                return labels[i];
            } catch (_) {}
        }
        return null;
    }

    function getMarkerTextDecoder(encodingKey) {
        const resolved = resolveMarkerTextDecoderLabel(encodingKey);
        if (resolved && markerTextDecoderCache.has(resolved)) {
            return markerTextDecoderCache.get(resolved);
        }
        return null;
    }

    function extractNullTerminatedMarkerBytes(bytes, start, end) {
        if (!bytes || start >= end) return new Uint8Array(0);
        let term = start;
        while (term < end && bytes[term] !== 0) term += 1;
        return bytes.subarray(start, term);
    }

    function hasUtf16LeBom(bytes, offset) {
        const off = offset || 0;
        return bytes.length >= off + 2 && bytes[off] === 0xff && bytes[off + 1] === 0xfe;
    }

    function extractNullTerminatedUtf16LeBytes(bytes, start, end) {
        if (!bytes || start >= end) return new Uint8Array(0);
        if (hasUtf16LeBom(bytes, start)) start += 2;
        let term = start;
        while (term + 1 < end) {
            if (bytes[term] === 0 && bytes[term + 1] === 0) break;
            term += 2;
        }
        if (term <= start && end > start) {
            return bytes.subarray(start, end - (end & 1));
        }
        return bytes.subarray(start, term);
    }

    /** UTF-16 LE は BOM または ASCII が (char,0x00) 連続のときだけ（UTF-8 日本語を誤判定しない） */
    function looksLikeUtf16LeMarkerBytes(bytes) {
        if (!bytes || bytes.length < 4) return false;
        if (hasUtf16LeBom(bytes, 0)) return true;
        if (bytes.length % 2 !== 0) return false;
        let pairs = 0;
        let asciiNullPairs = 0;
        for (let i = 1; i < bytes.length; i += 2) {
            pairs += 1;
            const lo = bytes[i - 1];
            const hi = bytes[i];
            if (hi === 0 && lo >= 0x20 && lo <= 0x7e) asciiNullPairs += 1;
        }
        return pairs >= 4 && asciiNullPairs / pairs >= 0.85;
    }

    function extractMarkerTextBytes(bytes, start, end) {
        if (!bytes || start >= end) return new Uint8Array(0);
        const range = bytes.subarray(start, end);
        if (hasUtf16LeBom(bytes, start) || looksLikeUtf16LeMarkerBytes(range)) {
            return extractNullTerminatedUtf16LeBytes(bytes, start, end);
        }
        let raw = extractNullTerminatedMarkerBytes(bytes, start, end);
        if (!raw.length && end > start) {
            raw = bytes.subarray(start, end);
        }
        return stripTrailingNullBytes(raw);
    }

    function stripTrailingNullBytes(bytes) {
        let end = bytes.length;
        while (end > 0 && bytes[end - 1] === 0) end -= 1;
        return bytes.subarray(0, end);
    }

    function stripUtf8Bom(bytes) {
        if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
            return bytes.subarray(3);
        }
        return bytes;
    }

    /** 末尾の未完成 UTF-8 バイト列を落とす（Logic 等で chunk サイズが 1 バイト短いケース） */
    function trimIncompleteUtf8Tail(bytes) {
        if (!bytes.length) return bytes;
        for (let end = bytes.length; end > 0; end--) {
            if (isValidUtf8ByteSequence(bytes.subarray(0, end))) {
                return bytes.subarray(0, end);
            }
        }
        return new Uint8Array(0);
    }

    function isCjkCodePoint(cp) {
        return (
            (cp >= 0x3040 && cp <= 0x30ff) ||
            (cp >= 0x4e00 && cp <= 0x9fff) ||
            (cp >= 0x3400 && cp <= 0x4dbf) ||
            cp === 0xff01 ||
            cp === 0x3001 ||
            cp === 0x3002
        );
    }

    /** Logic 等: chunk 末尾に混ざる孤立 ASCII（0x45 'E' 等）。有効 UTF-8 でも除去する */
    function trimTrailingStrayAsciiMarkerByte(bytes) {
        if (!bytes || bytes.length < 2) return bytes;
        const utf8Dec = getMarkerTextDecoder('utf-8');
        if (!utf8Dec) return bytes;
        let out = bytes;
        while (out.length >= 2) {
            const last = out[out.length - 1];
            if (last < 0x41 || last > 0x7a) break;
            const without = out.subarray(0, out.length - 1);
            if (!isValidUtf8ByteSequence(without)) break;
            const withText = utf8Dec.decode(out);
            const withoutText = utf8Dec.decode(without);
            if (withoutText.includes('\uFFFD')) break;
            const lastCp = withText.charCodeAt(withText.length - 1);
            const prevCp = withText.length >= 2 ? withText.charCodeAt(withText.length - 2) : 0;
            const strayAfterCjk =
                lastCp >= 0x41 &&
                lastCp <= 0x7a &&
                (isCjkCodePoint(prevCp) ||
                    prevCp === 0xfffd ||
                    prevCp === 0x29 ||
                    prevCp === 0xff01);
            if (!strayAfterCjk) break;
            out = without;
        }
        return out;
    }

    /** chunk 境界の余分な 1 バイト（例: �E / ！E）を除去 */
    function trimTrailingMarkerGarbageBytes(bytes) {
        let out = stripUtf8Bom(bytes);
        out = trimIncompleteUtf8Tail(out);
        out = trimTrailingStrayAsciiMarkerByte(out);
        if (!out.length) return out;
        const utf8Dec = getMarkerTextDecoder('utf-8');
        if (!utf8Dec) return out;
        while (out.length > 0) {
            const trimmed = trimIncompleteUtf8Tail(out);
            if (trimmed.length !== out.length) {
                out = trimmed;
                out = trimTrailingStrayAsciiMarkerByte(out);
                continue;
            }
            if (out.length < 2) break;
            const withoutLast = out.subarray(0, out.length - 1);
            if (!isValidUtf8ByteSequence(withoutLast)) break;
            const withText = utf8Dec.decode(out);
            const withoutText = utf8Dec.decode(withoutLast);
            if (withoutText.includes('\uFFFD')) break;
            const lastCp = withText.charCodeAt(withText.length - 1);
            const prevCp = withText.charCodeAt(withText.length - 2);
            const strayAsciiTail =
                lastCp >= 0x41 &&
                lastCp <= 0x7a &&
                (prevCp === 0xfffd ||
                    isCjkCodePoint(prevCp) ||
                    (prevCp >= 0x41 && prevCp <= 0x7a && withoutText.length < withText.length - 1));
            const replacementAsciiTail =
                withText.endsWith('\uFFFD' + String.fromCharCode(lastCp)) ||
                /\uFFFD[A-Za-z0-9]$/.test(withText);
            if (strayAsciiTail || replacementAsciiTail) {
                out = withoutLast;
                continue;
            }
            break;
        }
        return out;
    }

    function sanitizeMarkerTextBytes(bytes, encodingKey) {
        const slice = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
        if (!slice.length) return slice;
        if (encodingKey === 'utf-16le' || encodingKey === 'utf-16be') return slice;
        let out = stripUtf8Bom(slice);
        if (encodingKey === 'utf-8') {
            out = trimTrailingStrayAsciiMarkerByte(out);
            if (isValidUtf8ByteSequence(out)) return out;
            out = trimIncompleteUtf8Tail(out);
            out = trimTrailingStrayAsciiMarkerByte(out);
            if (isValidUtf8ByteSequence(out)) return out;
            return trimTrailingMarkerGarbageBytes(out);
        }
        return out;
    }

    function cleanupMarkerDecodedText(text) {
        let out = String(text == null ? '' : text);
        if (out.indexOf('\uFFFD') >= 0) {
            out = out.replace(/^[A-Za-z]\uFFFD[A-Za-z]?(?=[\u3040-\u9fff\u4e00-\u9fff])/u, '');
            out = out.replace(/^\uFFFD+/, '');
            out = out.replace(/\uFFFD+$/g, '');
            out = out.replace(
                /([\u3040-\u9fff\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])\uFFFD?([A-Za-z0-9])$/u,
                '$1',
            );
        }
        out = out.replace(/([\u3040-\u9fff\u4e00-\u9fff\uff00-\uffef])([A-Za-z])$/u, '$1');
        return out.trim();
    }

    function markerCommentCorruptionPenalty(text) {
        if (!text) return 0;
        let penalty = 0;
        if (text.indexOf('\uFFFD') >= 0) penalty += 5000;
        if (/[\u3040-\u9fff\u4e00-\u9fff\uff00-\uffef][A-Za-z]$/.test(text)) penalty += 800;
        return penalty;
    }

    function markerDecodedTextQuality(text) {
        const cleaned = cleanupMarkerDecodedText(text);
        if (!cleaned) return -10000;
        let score = cleaned.length;
        score -= markerCommentCorruptionPenalty(cleaned);
        score -= countUtf8AsLatin1MojibakeSignals(cleaned) * 8;
        score -= countUtf8AsSjisMojibakeSignals(cleaned) * 8;
        score += countCjkChars(cleaned) * 3;
        return score;
    }

    function isValidUtf8ByteSequence(bytes, allowTruncatedTail) {
        let i = 0;
        while (i < bytes.length) {
            const b = bytes[i];
            if (b <= 0x7f) {
                i += 1;
                continue;
            }
            let need = 0;
            if ((b & 0xe0) === 0xc0) need = 1;
            else if ((b & 0xf0) === 0xe0) need = 2;
            else if ((b & 0xf8) === 0xf0) need = 3;
            else return false;
            if (i + need >= bytes.length) return !!allowTruncatedTail;
            for (let j = 1; j <= need; j++) {
                if ((bytes[i + j] & 0xc0) !== 0x80) return false;
            }
            i += need + 1;
        }
        return true;
    }

    function isMostlyValidUtf8ByteSequence(bytes) {
        return isValidUtf8ByteSequence(bytes, true);
    }

    function bytesLookLikeUtf8Structure(bytes) {
        let i = 0;
        let structured = 0;
        let high = 0;
        while (i < bytes.length) {
            const b = bytes[i];
            if (b <= 0x7f) {
                i += 1;
                continue;
            }
            high += 1;
            let need = 0;
            if ((b & 0xe0) === 0xc0) need = 1;
            else if ((b & 0xf0) === 0xe0) need = 2;
            else if ((b & 0xf8) === 0xf0) need = 3;
            else return false;
            if (i + need >= bytes.length) {
                structured += 1;
                break;
            }
            let ok = true;
            for (let j = 1; j <= need; j++) {
                if ((bytes[i + j] & 0xc0) !== 0x80) {
                    ok = false;
                    break;
                }
            }
            if (!ok) return false;
            structured += need + 1;
            i += need + 1;
        }
        return high > 0 && structured >= high;
    }

    function markerBytesLookLikeShiftJis(bytes) {
        for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i];
            if (b <= 0x7f || (b >= 0xa1 && b <= 0xdf)) continue;
            if ((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc)) {
                if (i + 1 >= bytes.length) return false;
                const b2 = bytes[i + 1];
                if ((b2 >= 0x40 && b2 <= 0x7e) || (b2 >= 0x80 && b2 <= 0xfc)) {
                    i += 1;
                    continue;
                }
                return false;
            }
            return false;
        }
        return true;
    }

    /** UTF-8 バイト列を Latin-1 / Windows-1252 として読んだときに出やすい文字（例: æˆ¦é—˜ãŒ…） */
    function countUtf8AsLatin1MojibakeSignals(text) {
        if (!text) return 0;
        let signals = 0;
        for (let i = 0; i < text.length; i++) {
            const cp = text.charCodeAt(i);
            if (
                cp === 0x00e3 ||
                cp === 0x00e6 ||
                cp === 0x00e9 ||
                cp === 0x00e5 ||
                cp === 0x00e7 ||
                cp === 0x00ef ||
                cp === 0x00ee
            ) {
                signals += 4;
            } else if (cp >= 0x00c0 && cp <= 0x00ff) {
                signals += 1;
            }
        }
        return signals;
    }

    function countCjkChars(text) {
        if (!text) return 0;
        let count = 0;
        for (let i = 0; i < text.length; i++) {
            const cp = text.charCodeAt(i);
            if (
                (cp >= 0x3040 && cp <= 0x30ff) ||
                (cp >= 0x4e00 && cp <= 0x9fff) ||
                (cp >= 0x3400 && cp <= 0x4dbf)
            ) {
                count += 1;
            }
        }
        return count;
    }

    /** UTF-8 バイト列を CP932 として読んだときに出やすい文字（例: 縺｣…） */
    function countUtf8AsSjisMojibakeSignals(text) {
        if (!text) return 0;
        let signals = 0;
        for (let i = 0; i < text.length; i++) {
            const cp = text.charCodeAt(i);
            if (cp >= 0x7e00 && cp <= 0x7eff) signals += 3;
            if (cp === 0x2032 || cp === 0x222a) signals += 2;
        }
        return signals;
    }

    function markerSliceHasHighBytes(bytes) {
        for (let i = 0; i < bytes.length; i++) {
            if (bytes[i] > 0x7f) return true;
        }
        return false;
    }

    function scoreMarkerDecodedText(text, bytes, encodingKey) {
        if (!text) return -1000;
        let score = 0;
        const replacementCount = text.split('\uFFFD').length - 1;
        if (replacementCount > 1) score -= 10000;
        else if (replacementCount === 1) score -= 120;
        const sjisMojibakeSignals = countUtf8AsSjisMojibakeSignals(text);
        const latinMojibakeSignals = countUtf8AsLatin1MojibakeSignals(text);
        if (encodingKey === 'ms932') score -= sjisMojibakeSignals * 25;
        if (encodingKey === 'windows-1252' || encodingKey === 'iso-8859-1') {
            score -= latinMojibakeSignals * 30;
        }
        for (let i = 0; i < text.length; i++) {
            const cp = text.charCodeAt(i);
            if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) score -= 40;
            if (
                (cp >= 0x3040 && cp <= 0x30ff) ||
                (cp >= 0x4e00 && cp <= 0x9fff) ||
                (cp >= 0x3400 && cp <= 0x4dbf)
            ) {
                score += 4;
            }
        }
        const hasHighBytes = markerSliceHasHighBytes(bytes);
        const validUtf8 = isValidUtf8ByteSequence(bytes);
        const mostlyValidUtf8 = isMostlyValidUtf8ByteSequence(bytes);
        const looksUtf8 = bytesLookLikeUtf8Structure(bytes);
        if (encodingKey === 'utf-8') {
            if (validUtf8 || mostlyValidUtf8 || looksUtf8) {
                score += hasHighBytes ? 500 : 40;
            } else if (countCjkChars(text) > 0 && replacementCount <= 1) {
                score += 280;
            } else {
                score -= 5000;
            }
        } else if (encodingKey === 'ms932') {
            if ((validUtf8 || mostlyValidUtf8 || looksUtf8) && hasHighBytes) {
                score -= 800;
            } else if (!validUtf8 && !mostlyValidUtf8 && markerBytesLookLikeShiftJis(bytes)) {
                score += hasHighBytes ? 220 : 20;
            }
        } else if (hasHighBytes && (validUtf8 || mostlyValidUtf8 || looksUtf8)) {
            score -= 900;
        } else if (hasHighBytes && !validUtf8 && !mostlyValidUtf8) {
            score += 40;
        }
        return score;
    }

    function codePageHintToEncodingKey(codePage) {
        const cp = Number(codePage);
        if (!Number.isFinite(cp) || cp <= 0) return null;
        return WAV_MARKER_CODE_PAGE_LABELS[cp] || null;
    }

    function buildMarkerTextImportCandidates(uniqueHints) {
        const candidates = MARKER_TEXT_IMPORT_ENCODING_CANDIDATES.slice();
        for (let i = 0; i < MARKER_TEXT_WESTERN_ENCODING_CANDIDATES.length; i++) {
            const key = MARKER_TEXT_WESTERN_ENCODING_CANDIDATES[i];
            if (uniqueHints.indexOf(key) >= 0 && candidates.indexOf(key) < 0) {
                candidates.push(key);
            }
        }
        return candidates;
    }

    function shouldPreferUtf8MarkerEncoding(slices) {
        const utf8Dec = getMarkerTextDecoder('utf-8');
        if (!utf8Dec) return false;
        for (let i = 0; i < slices.length; i++) {
            const slice = slices[i];
            if (!markerSliceHasHighBytes(slice)) continue;
            if (
                isValidUtf8ByteSequence(slice) ||
                isMostlyValidUtf8ByteSequence(slice) ||
                bytesLookLikeUtf8Structure(slice)
            ) {
                return true;
            }
            const text = utf8Dec.decode(slice);
            if (countCjkChars(text) > 0 && text.split('\uFFFD').length - 1 <= 1) {
                return true;
            }
        }
        return false;
    }

    /** 外部 WAV 向け: labl/note/ltxt の生バイト列と ltxt の code page から文字コードを推定 */
    function detectMarkerTextImportEncoding(rawSlices, codePageHints) {
        const slices = Array.isArray(rawSlices)
            ? rawSlices.filter((s) => s && s.length)
            : [];
        const hintedKeys = [];
        if (Array.isArray(codePageHints)) {
            for (let i = 0; i < codePageHints.length; i++) {
                const key = codePageHintToEncodingKey(codePageHints[i]);
                if (key) hintedKeys.push(key);
            }
        }
        const uniqueHints = Array.from(new Set(hintedKeys));

        if (!slices.length) {
            return uniqueHints.length === 1 ? uniqueHints[0] : 'ms932';
        }

        if (uniqueHints.indexOf('utf-16le') >= 0) {
            return 'utf-16le';
        }
        for (let i = 0; i < slices.length; i++) {
            if (hasUtf16LeBom(slices[i], 0) || looksLikeUtf16LeMarkerBytes(slices[i])) {
                return 'utf-16le';
            }
        }

        const nonAsciiSlices = slices.filter((s) => markerSliceHasHighBytes(s));
        if (nonAsciiSlices.length > 0 && shouldPreferUtf8MarkerEncoding(nonAsciiSlices)) {
            return 'utf-8';
        }

        const candidates = buildMarkerTextImportCandidates(uniqueHints);
        let bestKey = 'ms932';
        let bestScore = -Infinity;
        for (let i = 0; i < candidates.length; i++) {
            const key = candidates[i];
            const dec = getMarkerTextDecoder(key);
            if (!dec) continue;
            let total = 0;
            for (let j = 0; j < slices.length; j++) {
                let text = '';
                try {
                    text = dec.decode(slices[j]);
                } catch (_) {
                    total -= 10000;
                    continue;
                }
                total += scoreMarkerDecodedText(text, slices[j], key);
            }
            if (uniqueHints.indexOf(key) >= 0) total += 40;
            if (total > bestScore) {
                bestScore = total;
                bestKey = key;
            }
        }
        return bestKey;
    }

    function decodeMarkerTextBytesRaw(bytes, encodingKey) {
        const slice =
            bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
        if (!slice.length) return '';
        const dec = getMarkerTextDecoder(encodingKey);
        if (dec) {
            try {
                return String(dec.decode(slice));
            } catch (_) {}
        }
        let out = '';
        for (let i = 0; i < slice.length; i++) {
            const cp = slice[i];
            out += cp <= 0x7f ? String.fromCharCode(cp) : '?';
        }
        return out;
    }

    function decodeMarkerTextBytes(bytes, encodingKey) {
        const key = encodingKey || 'ms932';
        const sanitized = sanitizeMarkerTextBytes(bytes, key);
        return cleanupMarkerDecodedText(decodeMarkerTextBytesRaw(sanitized, key));
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
            return {
                labl: new Map(),
                note: new Map(),
                ltxt: new Map(),
                encodingLabel: 'ms932',
            };
        }
        const lablRaw = new Map();
        const noteRaw = new Map();
        const ltxtRaw = new Map();
        const rawTextSlices = [];
        const codePageHints = [];
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
                    const raw = extractMarkerTextBytes(body, dataStart + 4, dataEnd);
                    lablRaw.set(cueId, raw);
                    if (raw.length) rawTextSlices.push(raw);
                } else if (id === 'note') {
                    const raw = extractMarkerTextBytes(body, dataStart + 4, dataEnd);
                    noteRaw.set(cueId, raw);
                    if (raw.length) rawTextSlices.push(raw);
                } else if (id === 'ltxt' && dataEnd - dataStart >= 20) {
                    const sampleLength = view.getUint32(dataStart + 4, true);
                    const codePage = view.getUint16(dataStart + 18, true);
                    const textRaw = extractMarkerTextBytes(body, dataStart + 20, dataEnd);
                    ltxtRaw.set(cueId, { sampleLength, codePage, textRaw });
                    if (codePage) codePageHints.push(codePage);
                    if (textRaw.length) rawTextSlices.push(textRaw);
                }
            }
            off += 8 + size + (size & 1);
        }

        const encodingLabel = detectMarkerTextImportEncoding(rawTextSlices, codePageHints);
        const labl = new Map();
        const note = new Map();
        const ltxt = new Map();
        lablRaw.forEach((raw, cueId) => {
            labl.set(cueId, decodeMarkerTextBytes(raw, encodingLabel));
        });
        noteRaw.forEach((raw, cueId) => {
            note.set(cueId, decodeMarkerTextBytes(raw, encodingLabel));
        });
        ltxtRaw.forEach((entry, cueId) => {
            ltxt.set(cueId, {
                sampleLength: entry.sampleLength,
                comment: decodeMarkerTextBytes(entry.textRaw, encodingLabel),
            });
        });
        return { labl, note, ltxt, encodingLabel };
    }

    function markerCommentFromAdtl(cueId, adtl) {
        const candidates = [];
        const noteText = adtl.note.get(cueId);
        if (typeof noteText === 'string' && noteText.trim()) {
            candidates.push({ text: noteText.trim(), kind: 'note' });
        }
        const lablText = adtl.labl.get(cueId);
        if (typeof lablText === 'string' && lablText.trim()) {
            candidates.push({ text: lablText.trim(), kind: 'labl' });
        }
        const ltxtEntry = adtl.ltxt.get(cueId);
        if (ltxtEntry && typeof ltxtEntry.comment === 'string' && ltxtEntry.comment.trim()) {
            candidates.push({ text: ltxtEntry.comment.trim(), kind: 'ltxt' });
        }
        if (!candidates.length) return '';

        let best = candidates[0].text;
        let bestScore = markerDecodedTextQuality(best);
        for (let i = 1; i < candidates.length; i++) {
            const score = markerDecodedTextQuality(candidates[i].text);
            if (score > bestScore) {
                bestScore = score;
                best = candidates[i].text;
                continue;
            }
            if (score === bestScore && candidates[i].kind === 'note') {
                best = candidates[i].text;
            }
        }
        return best;
    }

    function sampleOffsetToSec(sampleOffset, sampleRate, frameCount) {
        if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 0;
        let frame = Math.max(0, Math.round(Number(sampleOffset) || 0));
        if (frameCount > 0) frame = Math.min(frame, frameCount - 1);
        return frame / sampleRate;
    }

    function readWavChunkBodyBytes(chunkBytes) {
        if (!chunkBytes || chunkBytes.length < 8) return new Uint8Array(0);
        const size = new DataView(
            chunkBytes.buffer,
            chunkBytes.byteOffset,
            chunkBytes.byteLength,
        ).getUint32(4, true);
        const end = Math.min(8 + size, chunkBytes.length);
        return chunkBytes.subarray(8, end);
    }

    function normalizeIxmlEncodingLabel(label) {
        const enc = String(label || '')
            .trim()
            .toLowerCase()
            .replace(/[-_]/g, '');
        if (!enc) return null;
        if (enc === 'utf8') return 'utf-8';
        if (enc.indexOf('utf16') >= 0) {
            return enc.indexOf('be') >= 0 && enc.indexOf('le') < 0 ? 'utf-16be' : 'utf-16le';
        }
        if (enc === 'shiftjis' || enc === 'sjis' || enc === 'cp932' || enc === 'windows31j') {
            return 'ms932';
        }
        if (enc === 'iso88591' || enc === 'latin1') return 'iso-8859-1';
        if (enc === 'windows1252' || enc === 'cp1252') return 'windows-1252';
        return null;
    }

    function detectIxmlTextEncoding(bytes) {
        if (!bytes || !bytes.length) return 'utf-8';
        if (hasUtf16LeBom(bytes, 0) || looksLikeUtf16LeMarkerBytes(bytes)) {
            return 'utf-16le';
        }
        const utf8Dec = getMarkerTextDecoder('utf-8');
        if (utf8Dec) {
            const head = utf8Dec.decode(bytes.subarray(0, Math.min(bytes.length, 512)));
            const encMatch = head.match(/<\?xml[^>]*encoding=["']([^"']+)["']/i);
            if (encMatch) {
                const normalized = normalizeIxmlEncodingLabel(encMatch[1]);
                if (normalized) return normalized;
            }
        }
        return 'utf-8';
    }

    function decodeIxmlBodyBytes(bodyBytes) {
        let raw = stripTrailingNullBytes(bodyBytes);
        if (!raw.length) return '';

        const tryDecode = (bytes, encodingKey) => {
            const dec = getMarkerTextDecoder(encodingKey);
            if (!dec) return '';
            let text = dec.decode(bytes).replace(/\0/g, '');
            if (encodingKey === 'utf-16le' || encodingKey === 'utf-16be') {
                text = text.replace(/^\uFEFF/, '');
            }
            return text.trim();
        };

        const candidates = [];
        const primaryEnc = detectIxmlTextEncoding(raw);
        candidates.push(primaryEnc);
        candidates.push('utf-8', 'utf-16le', 'utf-16be', 'ms932', 'windows-1252', 'iso-8859-1');
        const seen = new Set();
        let fallbackText = '';
        for (let i = 0; i < candidates.length; i++) {
            const enc = candidates[i];
            if (!enc || seen.has(enc)) continue;
            seen.add(enc);
            const text = tryDecode(stripUtf8Bom(raw), enc);
            if (!text) continue;
            if (
                text.indexOf('<') >= 0 ||
                text.indexOf('BWFXML') >= 0 ||
                text.indexOf('STEINBERG') >= 0
            ) {
                return text;
            }
            if (!fallbackText) fallbackText = text;
        }
        return fallbackText || tryDecode(stripUtf8Bom(raw), primaryEnc);
    }

    const WAV_INFO_LIST_LABELS = {
        INAM: 'Name',
        ICMT: 'Comment',
        ICRD: 'Created',
        ISFT: 'Software',
        IART: 'Artist',
        IPRD: 'Product',
        ISBJ: 'Subject',
        IGNR: 'Genre',
    };

    function decodeInfoListTextField(bytes, start, end) {
        const raw = extractMarkerTextBytes(bytes, start, end);
        if (!raw.length) return '';
        const enc = detectMarkerTextImportEncoding([raw], []);
        return decodeMarkerTextBytes(raw, enc);
    }

    function parseInfoListChunkBody(listChunkBytes) {
        const body = readWavChunkBodyBytes(listChunkBytes);
        if (body.length < 4 || readFourCc(body, 0) !== 'INFO') return null;
        const lines = [];
        let off = 4;
        while (off + 8 <= body.length) {
            const id = readFourCc(body, off);
            const size = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(
                off + 4,
                true,
            );
            const dataStart = off + 8;
            const dataEnd = Math.min(body.length, dataStart + size);
            const label = WAV_INFO_LIST_LABELS[id] || ixmlElementLabel(id);
            const text = decodeInfoListTextField(body, dataStart, dataEnd);
            if (text) lines.push(label + ': ' + text);
            off += 8 + size + (size & 1);
        }
        if (!lines.length) return null;
        return {
            source: 'info',
            formattedText: ['[WAV INFO]', lines.join('\n')].join('\n'),
        };
    }

    function parseInfoListsFromWavBytes(wavBytes) {
        const chunks = listWaveRiffChunks(wavBytes, { scanPastData: true });
        if (!chunks) return null;
        const listChunks = findWaveChunks(chunks, ['LIST']);
        const lines = [];
        for (let i = 0; i < listChunks.length; i++) {
            const parsed = parseInfoListChunkBody(listChunks[i].bytes);
            if (!parsed || !parsed.formattedText) continue;
            const bodyLines = parsed.formattedText.split('\n').slice(1);
            for (let j = 0; j < bodyLines.length; j++) lines.push(bodyLines[j]);
        }
        if (!lines.length) return null;
        return {
            source: 'info',
            formattedText: ['[WAV INFO]', lines.join('\n')].join('\n'),
        };
    }

    function scanEmbeddedXmlMetadataInWavBytes(wavBytes) {
        const bytes =
            wavBytes instanceof Uint8Array ? wavBytes : new Uint8Array(wavBytes);
        const xmlChunkIds = ['iXML', 'IXML', 'axml', 'AXML'];
        for (let i = 0; i < xmlChunkIds.length; i++) {
            const chunk = scanWaveRiffChunkById(bytes, xmlChunkIds[i]);
            if (!chunk) continue;
            const parsed = parseXmlMetadataFromChunk(
                chunk,
                chunk.id.toLowerCase() === 'axml' ? 'axml' : 'ixml',
            );
            if (parsed && parsed.formattedText) return parsed;
        }
        return null;
    }

    function parseXmlMetadataFromChunk(chunk, sourceDefault) {
        if (!chunk) return null;
        const bodyBytes = readWavChunkBodyBytes(chunk.bytes);
        const xmlText = decodeIxmlBodyBytes(bodyBytes);
        if (!xmlText) {
            return {
                source: sourceDefault,
                chunkId: chunk.id,
                decodeFailed: true,
                bodySize: bodyBytes.length,
            };
        }
        const formattedText = formatIxmlXmlToMarkerMemo(xmlText);
        if (!formattedText) return null;
        const header =
            sourceDefault === 'axml'
                ? '[AXML]'
                : sourceDefault === 'ixml'
                  ? '[iXML]'
                  : '[' + chunk.id + ']';
        return {
            source: sourceDefault,
            xmlText,
            formattedText: formattedText.replace('[iXML]', header),
            chunkId: chunk.id,
        };
    }

    const IXML_FIELD_LABELS = {
        IXML_VERSION: 'iXML Version',
        PROJECT: 'Project',
        SCENE: 'Scene',
        TAKE: 'Take',
        TAPE: 'Tape',
        TAKE_TYPE: 'Take Type',
        NOTE: 'Note',
        FILE_UID: 'File UID',
        CIRCLED: 'Circled',
        UBITS: 'User Bits',
    };

    function ixmlElementLabel(tagName) {
        const tag = String(tagName || '').toUpperCase();
        if (IXML_FIELD_LABELS[tag]) return IXML_FIELD_LABELS[tag];
        return tag
            .toLowerCase()
            .split('_')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }

    function ixmlElementTextContent(el) {
        if (!el) return '';
        const parts = [];
        for (let i = 0; i < el.childNodes.length; i++) {
            const node = el.childNodes[i];
            if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
                const t = node.textContent;
                if (t) parts.push(t);
            }
        }
        return parts.join('').trim();
    }

    function ixmlFirstChildElementByTag(el, tagNames) {
        if (!el) return null;
        const want = tagNames.map((t) => String(t || '').toUpperCase());
        for (let i = 0; i < el.childNodes.length; i++) {
            const node = el.childNodes[i];
            if (
                node.nodeType === Node.ELEMENT_NODE &&
                want.indexOf(String(node.tagName || '').toUpperCase()) >= 0
            ) {
                return node;
            }
        }
        return null;
    }

    function formatSteinbergAttrElement(attrEl, indent) {
        if (!attrEl) return [];
        const nameEl = ixmlFirstChildElementByTag(attrEl, ['NAME']);
        const valueEl = ixmlFirstChildElementByTag(attrEl, ['VALUE']);
        const typeEl = ixmlFirstChildElementByTag(attrEl, ['TYPE']);
        const name = nameEl ? ixmlElementTextContent(nameEl) : '';
        const value = valueEl ? ixmlElementTextContent(valueEl) : '';
        if (name && value) return [indent + name + ': ' + value];
        if (name) return [indent + name + ':'];
        if (value) return [indent + 'Value: ' + value];
        const type = typeEl ? ixmlElementTextContent(typeEl) : '';
        if (type) return [indent + 'Attr (' + type + ')'];
        return [];
    }

    function formatIxmlElementLines(el, indent) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return [];
        const lines = [];
        const stack = [{ el, indent }];
        while (stack.length) {
            const item = stack.pop();
            const node = item.el;
            const ind = item.indent;
            if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
            const tag = String(node.tagName || '').toUpperCase();
            if (tag === 'ATTR') {
                const attrLines = formatSteinbergAttrElement(node, ind);
                for (let i = 0; i < attrLines.length; i++) lines.push(attrLines[i]);
                continue;
            }

            const childElements = [];
            for (let i = 0; i < node.childNodes.length; i++) {
                const child = node.childNodes[i];
                if (child.nodeType === Node.ELEMENT_NODE) childElements.push(child);
            }
            if (!childElements.length) {
                const text = ixmlElementTextContent(node);
                if (text) lines.push(ind + ixmlElementLabel(tag) + ': ' + text);
                continue;
            }

            lines.push(ind + ixmlElementLabel(tag) + ':');
            const childIndent = ind + '  ';
            for (let i = childElements.length - 1; i >= 0; i--) {
                stack.push({ el: childElements[i], indent: childIndent });
            }
        }
        return lines;
    }

    function formatIxmlXmlToMarkerMemo(xmlText) {
        const raw = String(xmlText || '').trim();
        if (!raw) return '';
        if (typeof DOMParser !== 'function') return raw;
        try {
            const doc = new DOMParser().parseFromString(raw, 'application/xml');
            if (doc.getElementsByTagName('parsererror').length) return raw;
            const root = doc.documentElement;
            if (!root) return raw;
            const lines = ['[iXML]'];
            const rootChildren = [];
            for (let i = 0; i < root.childNodes.length; i++) {
                const node = root.childNodes[i];
                if (node.nodeType === Node.ELEMENT_NODE) rootChildren.push(node);
            }
            for (let i = 0; i < rootChildren.length; i++) {
                const childLines = formatIxmlElementLines(rootChildren[i], '');
                for (let j = 0; j < childLines.length; j++) lines.push(childLines[j]);
            }
            const out = lines.join('\n').trim();
            return out.length > 6 ? out : raw;
        } catch (_) {
            return raw;
        }
    }

    function decodeBextAsciiField(bytes, offset, length) {
        if (!bytes || offset >= bytes.length) return '';
        const end = Math.min(bytes.length, offset + length);
        const slice = bytes.subarray(offset, end);
        const dec = getMarkerTextDecoder('utf-8') || getMarkerTextDecoder('iso-8859-1');
        if (!dec) return '';
        return dec
            .decode(slice)
            .replace(/\0/g, '')
            .trim();
    }

    function parseBextFromWavBytes(wavBytes) {
        const chunks = listWaveRiffChunks(wavBytes, { scanPastData: true });
        if (!chunks) return null;
        const bextChunk = findWaveChunk(chunks, ['bext']);
        if (!bextChunk) return null;
        const body = readWavChunkBodyBytes(bextChunk.bytes);
        if (body.length < 602) return null;
        const description = decodeBextAsciiField(body, 256, 256);
        const originator = decodeBextAsciiField(body, 0, 32);
        const originationDate = decodeBextAsciiField(body, 32, 10);
        const originationTime = decodeBextAsciiField(body, 42, 8);
        const lines = [];
        if (description) lines.push('Description: ' + description);
        if (originator) lines.push('Originator: ' + originator);
        if (originationDate || originationTime) {
            lines.push(
                'Origination: ' +
                    [originationDate, originationTime].filter(Boolean).join(' '),
            );
        }
        if (!lines.length) return null;
        return {
            source: 'bext',
            formattedText: ['[BWF bext]', lines.join('\n')].join('\n'),
        };
    }

    function parseEmbeddedXmlMetadataFromWavBytes(wavBytes) {
        const bytes =
            wavBytes instanceof Uint8Array ? wavBytes : new Uint8Array(wavBytes);

        const ixmlChunk =
            scanWaveRiffChunkById(bytes, 'iXML') || scanWaveRiffChunkById(bytes, 'IXML');
        if (ixmlChunk) {
            const parsed = parseXmlMetadataFromChunk(ixmlChunk, 'ixml');
            if (parsed && parsed.formattedText) return parsed;
            if (parsed && parsed.decodeFailed && parsed.bodySize > 0) {
                return {
                    source: 'ixml',
                    chunkId: ixmlChunk.id,
                    formattedText:
                        '[iXML]\n(chunk found, ' +
                        parsed.bodySize +
                        ' bytes — could not decode as text)',
                };
            }
        }

        const axmlChunk =
            scanWaveRiffChunkById(bytes, 'axml') || scanWaveRiffChunkById(bytes, 'AXML');
        if (axmlChunk) {
            const parsed = parseXmlMetadataFromChunk(axmlChunk, 'axml');
            if (parsed && parsed.formattedText) return parsed;
        }

        const embedded = scanEmbeddedXmlMetadataInWavBytes(bytes);
        if (embedded && embedded.formattedText) return embedded;

        const bext = parseBextFromWavBytes(bytes);
        if (bext && bext.formattedText) return bext;

        return parseInfoListsFromWavBytes(bytes);
    }

    /** RIFF WAVE の iXML チャンクを読み取り（Tempo/Sig・F10 診断ログ用） */
    function parseIxmlFromWavBytes(wavBytes) {
        const parsed = parseEmbeddedXmlMetadataFromWavBytes(wavBytes);
        if (!parsed) return null;
        return {
            xmlText: parsed.xmlText || '',
            formattedText: parsed.formattedText,
            source: parsed.source || 'ixml',
        };
    }

    function shouldSkipWavIxmlImport(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.fromSessionRestore || o.skipWavMarkerImport) return true;
        return false;
    }

    function shouldSkipWavFileMetadataImport(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.fromSessionRestore || o.skipWavMarkerImport) return true;
        if (
            typeof hasSessionMarkersPendingRestore === 'function' &&
            hasSessionMarkersPendingRestore()
        ) {
            return true;
        }
        return false;
    }

    /** F10 診断（DEBUG_LOG.IXML）— iXML / AXML / BWF / INFO 全文をログへ */
    function ixmlDiagLogFormattedMetadata(parsed, logLabel) {
        if (
            typeof window.isDebugLogCategoryEnabled !== 'function' ||
            !window.isDebugLogCategoryEnabled('IXML')
        ) {
            return;
        }
        if (!parsed || !parsed.formattedText) return;
        const prefix = logLabel ? String(logLabel) + ': ' : '';
        const source =
            parsed.source === 'axml'
                ? 'AXML'
                : parsed.source === 'bext'
                  ? 'BWF bext'
                  : parsed.source === 'info'
                    ? 'WAV INFO'
                    : 'iXML';
        if (typeof window.writeDiagLog === 'function') {
            window.writeDiagLog('IXML', prefix + 'import/' + source, {
                chunk: parsed.chunkId || '',
                lines: parsed.formattedText.split('\n').length,
            });
        }
        const lines = parsed.formattedText.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (typeof window.appendLogEntry === 'function') {
                window.appendLogEntry(lines[i], { tier: 'diag', category: 'iXML' });
            }
        }
    }

    function importWavIxmlOnWaveformLoad(ab, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (shouldSkipWavIxmlImport(o)) return null;
        const label = o.logLabel ? o.logLabel + ': ' : '';
        let parsed = null;
        try {
            parsed = parseIxmlFromWavBytes(ab);
        } catch (err) {
            if (typeof writeLog === 'function') {
                writeLog(
                    label +
                        'iXML import failed — ' +
                        (err && err.message ? err.message : String(err)),
                );
            }
            return null;
        }
        if (!parsed || !parsed.formattedText) {
            if (typeof writeLog === 'function') {
                const ids = listWaveRiffChunkIds(ab);
                if (ids.length) {
                    writeLog(
                        label +
                            'WAV metadata scan — chunks: ' +
                            ids.join(', ') +
                            ' (no iXML/INFO metadata imported)',
                    );
                } else {
                    writeLog(label + 'WAV metadata scan — not a readable RIFF/WAVE file');
                }
            }
            return parsed;
        }
        ixmlDiagLogFormattedMetadata(parsed, label.replace(/: $/, ''));
        return parsed;
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
        const adtl = listChunk
            ? parseAdtlListChunk(listChunk.bytes)
            : {
                labl: new Map(),
                note: new Map(),
                ltxt: new Map(),
                encodingLabel: 'ms932',
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

        adtl.ltxt.forEach((entry, cueId) => {
            if (regionCueIds.has(cueId)) return;
            const startFrame = cueMap.get(cueId);
            if (!Number.isFinite(startFrame)) return;
            const len = Math.max(1, Number(entry.sampleLength) || 0);
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
            markerTextEncoding: adtl.encodingLabel || 'ms932',
        };
    }

    function importWavMarkersOnWaveformLoad(ab, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (shouldSkipWavFileMetadataImport(o)) return null;
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
            const enc =
                parsed.markerTextEncoding && parsed.markerTextEncoding !== 'ms932'
                    ? ' (' + parsed.markerTextEncoding + ')'
                    : '';
            writeLog(
                label +
                    'imported WAV markers — ' +
                    parsed.pointCount +
                    ' marker(s), ' +
                    parsed.regionCount +
                    ' region(s)' +
                    enc,
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
    window.parseIxmlFromWavBytes = parseIxmlFromWavBytes;
    window.importWavMarkersOnWaveformLoad = importWavMarkersOnWaveformLoad;
    window.importWavIxmlOnWaveformLoad = importWavIxmlOnWaveformLoad;
    window.finalizeWaveExportBlobWithMarkers = finalizeWaveExportBlobWithMarkers;
})();
