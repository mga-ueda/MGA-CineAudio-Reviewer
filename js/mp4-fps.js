    // MP4 コンテナから FPS を推定
    function rU32(u8, o) {
        return ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0;
    }
    function fourcc(u8, o) {
        return String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
    }
    function rU64FromU32(u8, o) {
        const hi = rU32(u8, o);
        const lo = rU32(u8, o + 4);
        return hi * 0x100000000 + lo;
    }
    function eachChildBox(u8, bodyStart, bodyEnd, fn) {
        let p = bodyStart;
        while (p + 8 <= bodyEnd) {
            let sz = rU32(u8, p);
            const typ = fourcc(u8, p + 4);
            if (sz < 8) break;
            let h = 8;
            if (sz === 1) {
                if (p + 16 > bodyEnd) break;
                sz = rU64FromU32(u8, p + 8);
                h = 16;
            }
            const boxEnd = sz === 0 ? bodyEnd : p + sz;
            if (boxEnd > bodyEnd || boxEnd <= p + h) break;
            const inner0 = p + h;
            fn(typ, inner0, boxEnd);
            if (sz === 0) break;
            p = boxEnd;
        }
    }
    function locateMoovRangeInBuffer(u8, start, end) {
        let out = null;
        eachChildBox(u8, start, end, (typ, b0, b1) => {
            if (typ === 'moov') out = [b0, b1];
        });
        return out;
    }

    /** トップレベル走査で見つからない moov をバイト列から探索 */
    function locateMoovRangeByScan(u8) {
        const len = u8.byteLength;
        for (let p = 0; p + 8 <= len; p++) {
            if (fourcc(u8, p + 4) !== 'moov') continue;
            let sz = rU32(u8, p);
            let h = 8;
            if (sz === 1) {
                if (p + 16 > len) continue;
                sz = rU64FromU32(u8, p + 8);
                h = 16;
            }
            if (sz < 8) continue;
            const boxEnd = sz === 0 ? len : p + sz;
            if (boxEnd > len || boxEnd <= p + h) continue;
            return [p + h, boxEnd];
        }
        return null;
    }
    async function readFileSliceToUint8(file, begin, end) {
        const b = file.slice(begin, end);
        return new Uint8Array(await b.arrayBuffer());
    }
    async function readMp4BufferForMoov(file) {
        const n = file.size;
        if (n < 16) return null;
        const headLen = Math.min(12 * 1024 * 1024, n);
        const head = await readFileSliceToUint8(file, 0, headLen);
        let moov = locateMoovRangeInBuffer(head, 0, head.byteLength);
        if (!moov) moov = locateMoovRangeByScan(head);
        if (moov) return { buf: head, moov0: moov[0], moov1: moov[1] };
        const tailLen = Math.min(24 * 1024 * 1024, n);
        const tail = await readFileSliceToUint8(file, n - tailLen, n);
        moov = locateMoovRangeInBuffer(tail, 0, tail.byteLength);
        if (!moov) moov = locateMoovRangeByScan(tail);
        if (moov) return { buf: tail, moov0: moov[0], moov1: moov[1] };
        if (n <= 48 * 1024 * 1024) {
            const whole = await readFileSliceToUint8(file, 0, n);
            moov = locateMoovRangeInBuffer(whole, 0, whole.byteLength);
            if (!moov) moov = locateMoovRangeByScan(whole);
            if (moov) return { buf: whole, moov0: moov[0], moov1: moov[1] };
        }
        return null;
    }
    function parseSttsAverageDelta(u8, b0, b1) {
        if (b1 - b0 < 8) return null;
        const ec = rU32(u8, b0 + 4);
        let off = b0 + 8;
        let sumC = 0;
        let sumDur = 0;
        for (let i = 0; i < ec; i++) {
            if (off + 8 > b1) break;
            const sc = rU32(u8, off);
            const sd = rU32(u8, off + 4);
            sumC += sc;
            sumDur += sc * sd;
            off += 8;
        }
        if (sumC === 0) return null;
        return sumDur / sumC;
    }

    /** stts の sample_count 合計（映像フレーム数の目安。stsz より信頼できることが多い） */
    function parseSttsTotalSampleCount(u8, b0, b1) {
        if (b1 - b0 < 8) return null;
        const ec = rU32(u8, b0 + 4);
        let off = b0 + 8;
        let sumC = 0;
        for (let i = 0; i < ec; i++) {
            if (off + 8 > b1) break;
            const sc = rU32(u8, off);
            sumC += sc;
            off += 8;
        }
        return sumC > 0 ? sumC : null;
    }

    function parseStcoOrCo64EntryCount(u8, b0, b1) {
        if (b1 - b0 < 8) return null;
        return rU32(u8, b0 + 4);
    }

    function pushSampleCountCandidate(n, c) {
        if (c == null || c < 1) return n;
        const v = c | 0;
        return n == null ? v : Math.max(n, v);
    }

    function frameCountFromDurationSec(sec, fps) {
        if (!Number.isFinite(sec) || sec <= 0 || !(fps > 0)) return null;
        const ntsc2997 = Math.abs(fps - 30000 / 1001) < 0.04;
        const ntsc2398 = Math.abs(fps - 24000 / 1001) < 0.04;
        const ntsc5994 = Math.abs(fps - 60000 / 1001) < 0.04;
        if (ntsc5994) {
            return Math.max(1, Math.floor(sec * 60 + 1e-9));
        }
        if (ntsc2997) {
            return Math.max(1, Math.floor((sec * 30000) / 1001 + 1e-9) + 1);
        }
        if (ntsc2398) {
            return Math.max(1, Math.floor((sec * 24000) / 1001 + 1e-9) + 1);
        }
        const fpsInt = Math.max(1, Math.round(fps));
        if (Math.abs(fps - fpsInt) < 0.05) {
            return Math.max(1, Math.round(sec * fpsInt));
        }
        return Math.max(1, Math.floor(sec * fps + 1e-9) + 1);
    }

    /** stsz があればそれを基準（stts が大きいときのみ補正）。なければ stts / 尺から推定 */
    function resolveVideoSampleCount(stszCount, sttsCount, stcoCount, mdhdTd, mvhdTd, fps) {
        if (stszCount != null && stszCount > 0) {
            let n = stszCount | 0;
            if (sttsCount != null && sttsCount > n) n = sttsCount | 0;
            return n;
        }
        let n = null;
        n = pushSampleCountCandidate(n, sttsCount);
        n = pushSampleCountCandidate(n, stcoCount);
        const mdhdList = mdhdTd ? [mdhdTd] : [];
        if (mvhdTd) mdhdList.push(mvhdTd);
        if (!(fps > 0)) {
            return n != null && n > 0 ? n : null;
        }
        for (let i = 0; i < mdhdList.length; i++) {
            const td = mdhdList[i];
            if (!td || td.timescale < 1 || td.duration < 1) continue;
            const ts = td.timescale | 0;
            const durTicks = td.duration;
            const fpsInt = Math.max(1, Math.round(fps));
            const ntsc2997 = Math.abs(fps - 30000 / 1001) < 0.04;
            const ntsc2398 = Math.abs(fps - 24000 / 1001) < 0.04;
            const ntsc5994 = Math.abs(fps - 60000 / 1001) < 0.04;
            const ntsc = ntsc2997 || ntsc2398 || ntsc5994;
            if (!ntsc && Math.abs(ts - fpsInt) <= 2) {
                n = pushSampleCountCandidate(n, durTicks);
            }
            const sec = durTicks / ts;
            const fromSec = frameCountFromDurationSec(sec, fps);
            if (fromSec != null) n = pushSampleCountCandidate(n, fromSec);
        }
        return n != null && n > 0 ? n : null;
    }
    function parseStszSampleCount(u8, b0, b1) {
        if (b1 - b0 < 12) return null;
        return rU32(u8, b0 + 8);
    }

    function parseMvhdTimescaleDuration(u8, moov0, moov1) {
        let out = null;
        eachChildBox(u8, moov0, moov1, (typ, b0, b1) => {
            if (typ !== 'mvhd') return;
            const p = parseMdhdTimescaleDuration(u8, b0, b1);
            if (p && p.timescale > 0 && p.duration > 0) out = p;
        });
        return out;
    }

    function isElstMediaTimeEmpty(mediaTime) {
        if (mediaTime == null || !Number.isFinite(mediaTime)) return true;
        if (mediaTime < 0) return true;
        if (mediaTime === 0xffffffff) return true;
        if (mediaTime >= 0x100000000 && (mediaTime & 0xffffffff) === 0xffffffff) return true;
        return false;
    }

    /** edts/elst の先頭オフセットをフレーム数に換算（編集タイムライン基準） */
    function parseElstTimelineOffsetFrames(u8, b0, b1, timescale, fps) {
        if (b1 - b0 < 8 || timescale < 1 || !(fps > 0)) return 0;
        const ver = u8[b0];
        const ec = rU32(u8, b0 + 4);
        let off = b0 + 8;
        let movieTicks = 0;
        for (let i = 0; i < ec; i++) {
            let segDur;
            let mediaTime;
            if (ver === 1) {
                if (off + 16 > b1) break;
                segDur = rU64FromU32(u8, off);
                mediaTime = rU64FromU32(u8, off + 8);
                off += 16;
            } else {
                if (off + 8 > b1) break;
                segDur = rU32(u8, off);
                mediaTime = rU32(u8, off + 4);
                off += 8;
            }
            if (isElstMediaTimeEmpty(mediaTime)) {
                movieTicks += segDur;
                continue;
            }
            if (mediaTime > 0) {
                movieTicks += mediaTime;
            }
            break;
        }
        if (movieTicks <= 0) return 0;
        const sec = movieTicks / timescale;
        const ntsc5994 = Math.abs(fps - 60000 / 1001) < 0.04;
        if (ntsc5994 || Math.abs(fps - 60) < 0.06) {
            return Math.max(0, Math.round(sec * 60));
        }
        const fpsInt = Math.max(1, Math.round(fps));
        if (Math.abs(fps - fpsInt) < 0.05) {
            return Math.max(0, Math.round(sec * fpsInt));
        }
        return Math.max(0, Math.floor(sec * fps + 1e-9));
    }

    function parseMdhdTimescaleDuration(u8, b0, b1) {
        if (b1 - b0 < 20) return null;
        const ver = u8[b0];
        if (ver === 1) {
            if (b1 - b0 < 36) return null;
            return {
                timescale: rU32(u8, b0 + 20),
                duration: rU64FromU32(u8, b0 + 24),
            };
        }
        return {
            timescale: rU32(u8, b0 + 12),
            duration: rU32(u8, b0 + 16),
        };
    }
    function parseTrakHandlerType(u8, trakBody0, trakBody1) {
        let handler = null;
        function walkMdia(a, b) {
            eachChildBox(u8, a, b, (typ, b0, b1) => {
                if (typ === 'hdlr' && b1 - b0 >= 12) {
                    handler = fourcc(u8, b0 + 8);
                }
            });
        }
        eachChildBox(u8, trakBody0, trakBody1, (typ, b0, b1) => {
            if (typ === 'mdia') walkMdia(b0, b1);
        });
        return handler;
    }

    function parseMp4HasAudioTrackFromMoov(u8, moov0, moov1) {
        let hasAudio = false;
        eachChildBox(u8, moov0, moov1, (typ, b0, b1) => {
            if (typ === 'trak' && parseTrakHandlerType(u8, b0, b1) === 'soun') {
                hasAudio = true;
            }
        });
        return hasAudio;
    }

    function parseTrakVideoFpsFromMoovChildren(u8, trakBody0, trakBody1, mvhdTd) {
        let isVideo = false;
        let mdhdTd = null;
        let avgDelta = null;
        let sampleCountStsz = null;
        let sampleCountStts = null;
        let sampleCountStco = null;
        let timelineFrameOffset = 0;

        function walkStbl(a, b) {
            eachChildBox(u8, a, b, (typ, b0, b1) => {
                if (typ === 'stts') {
                    const d = parseSttsAverageDelta(u8, b0, b1);
                    if (d != null) avgDelta = d;
                    const tc = parseSttsTotalSampleCount(u8, b0, b1);
                    if (tc != null) {
                        sampleCountStts =
                            sampleCountStts == null ? tc : Math.max(sampleCountStts, tc);
                    }
                } else if (typ === 'stsz' || typ === 'stz2') {
                    const c = parseStszSampleCount(u8, b0, b1);
                    if (c != null) {
                        sampleCountStsz =
                            sampleCountStsz == null ? c : Math.max(sampleCountStsz, c);
                    }
                } else if (typ === 'stco' || typ === 'co64') {
                    const c = parseStcoOrCo64EntryCount(u8, b0, b1);
                    if (c != null) sampleCountStco = c;
                }
            });
        }
        function walkStblDeep(a, b) {
            eachChildBox(u8, a, b, (typ, b0, b1) => {
                if (typ === 'stbl') walkStbl(b0, b1);
                else if (typ === 'stsd' || typ === 'sgpd' || typ === 'sbgp') {
                    walkStblDeep(b0, b1);
                }
            });
        }
        function walkMinf(a, b) {
            eachChildBox(u8, a, b, (typ, b0, b1) => {
                if (typ === 'stbl') walkStbl(b0, b1);
                else walkStblDeep(b0, b1);
            });
        }
        function walkMdia(a, b) {
            eachChildBox(u8, a, b, (typ, b0, b1) => {
                if (typ === 'hdlr') {
                    if (b1 - b0 >= 12) {
                        const ht = fourcc(u8, b0 + 8);
                        if (ht === 'vide' || ht === 'pict') isVideo = true;
                    }
                } else if (typ === 'mdhd') {
                    const p = parseMdhdTimescaleDuration(u8, b0, b1);
                    if (p && p.timescale) mdhdTd = p;
                } else if (typ === 'minf') walkMinf(b0, b1);
            });
        }

        eachChildBox(u8, trakBody0, trakBody1, (typ, b0, b1) => {
            if (typ === 'mdia') walkMdia(b0, b1);
            else if (typ === 'mdhd') {
                const p = parseMdhdTimescaleDuration(u8, b0, b1);
                if (p && p.timescale) mdhdTd = p;
            }
        });
        const hasSampleTables =
            (sampleCountStsz != null && sampleCountStsz > 0) ||
            (sampleCountStts != null && sampleCountStts > 0);
        if (!mdhdTd || !mdhdTd.timescale) return null;
        if (!isVideo && !hasSampleTables) return null;
        if (!isVideo && hasSampleTables) isVideo = true;

        let fps = null;
        if (avgDelta && avgDelta > 0) {
            fps = mdhdTd.timescale / avgDelta;
        }
        const samplesResolved = resolveVideoSampleCount(
            sampleCountStsz,
            sampleCountStts,
            sampleCountStco,
            mdhdTd,
            mvhdTd,
            fps
        );
        if (
            (fps == null || !Number.isFinite(fps) || fps <= 0) &&
            samplesResolved != null &&
            samplesResolved > 0 &&
            mdhdTd.duration > 0
        ) {
            const sec = mdhdTd.duration / mdhdTd.timescale;
            if (sec > 1e-6) fps = samplesResolved / sec;
        }
        if (fps == null || !Number.isFinite(fps) || fps <= 0) return null;
        const fpsRounded = Math.round(Math.min(240, Math.max(1, fps)) * 100) / 100;
        const samples = resolveVideoSampleCount(
            sampleCountStsz,
            sampleCountStts,
            sampleCountStco,
            mdhdTd,
            mvhdTd,
            fpsRounded
        );
        const mediaDurationSec =
            mdhdTd.timescale > 0 && mdhdTd.duration > 0
                ? mdhdTd.duration / mdhdTd.timescale
                : null;
        eachChildBox(u8, trakBody0, trakBody1, (typ, b0, b1) => {
            if (typ === 'edts') {
                eachChildBox(u8, b0, b1, (typ2, b2, b3) => {
                    if (typ2 === 'elst') {
                        timelineFrameOffset = parseElstTimelineOffsetFrames(
                            u8,
                            b2,
                            b3,
                            mdhdTd.timescale,
                            fpsRounded
                        );
                    }
                });
            }
        });
        return {
            fps: fpsRounded,
            sampleCount: samples,
            sampleCountStsz: sampleCountStsz,
            mediaDurationSec: mediaDurationSec,
            timelineFrameOffset: timelineFrameOffset,
        };
    }

    function parseBestVideoTrackMetaFromMoov(u8, moov0, moov1) {
        const mvhdTd = parseMvhdTimescaleDuration(u8, moov0, moov1);
        let best = null;
        eachChildBox(u8, moov0, moov1, (typ, b0, b1) => {
            if (typ !== 'trak') return;
            const meta = parseTrakVideoFpsFromMoovChildren(u8, b0, b1, mvhdTd);
            if (meta == null) return;
            if (
                best == null ||
                (meta.sampleCount | 0) > (best.sampleCount | 0) ||
                ((meta.sampleCount | 0) === (best.sampleCount | 0) &&
                    (meta.mediaDurationSec || 0) > (best.mediaDurationSec || 0))
            ) {
                best = meta;
            }
        });
        if (best == null) return null;
        if (mvhdTd && mvhdTd.timescale > 0 && mvhdTd.duration > 0) {
            const mvSec = mvhdTd.duration / mvhdTd.timescale;
            if (mvSec > (best.mediaDurationSec || 0)) {
                best.mediaDurationSec = mvSec;
            }
        }
        return best;
    }

    function parseFirstVideoTrackMetaFromMoov(u8, moov0, moov1) {
        return parseBestVideoTrackMetaFromMoov(u8, moov0, moov1);
    }

    function parseFirstVideoTrackFpsFromMoov(u8, moov0, moov1) {
        const meta = parseFirstVideoTrackMetaFromMoov(u8, moov0, moov1);
        return meta ? meta.fps : null;
    }
    async function extractMp4ContainerFpsFromFile(file) {
        try {
            const loc = await readMp4BufferForMoov(file);
            if (!loc) return null;
            return parseFirstVideoTrackFpsFromMoov(loc.buf, loc.moov0, loc.moov1);
        } catch (_) {
            return null;
        }
    }

    /** @returns {boolean|null} true/false = 判定済み、null = moov 未取得 */
    async function extractMp4HasAudioTrackFromFile(file) {
        try {
            const loc = await readMp4BufferForMoov(file);
            if (!loc) return null;
            return parseMp4HasAudioTrackFromMoov(loc.buf, loc.moov0, loc.moov1);
        } catch (_) {
            return null;
        }
    }

    async function refreshContainerMetaForSide(side, file) {
        if (!file) {
            containerFps[side] = null;
            containerSampleCount[side] = null;
            containerStszSampleCount[side] = null;
            containerTimelineFrameOffset[side] = 0;
            containerMediaDurationSec[side] = null;
            containerHasAudio[side] = null;
            return;
        }
        try {
            const loc = await readMp4BufferForMoov(file);
            if (!loc) {
                containerFps[side] = null;
                containerSampleCount[side] = null;
                containerStszSampleCount[side] = null;
                containerTimelineFrameOffset[side] = 0;
                containerMediaDurationSec[side] = null;
                if (containerHasAudio[side] !== false) {
                    containerHasAudio[side] = null;
                }
                return;
            }
            const meta = parseFirstVideoTrackMetaFromMoov(loc.buf, loc.moov0, loc.moov1);
            containerFps[side] = meta ? meta.fps : null;
            containerStszSampleCount[side] =
                meta && meta.sampleCountStsz != null && meta.sampleCountStsz > 0
                    ? meta.sampleCountStsz | 0
                    : null;
            containerSampleCount[side] = meta && meta.sampleCount != null ? meta.sampleCount : null;
            containerTimelineFrameOffset[side] = 0;
            containerMediaDurationSec[side] =
                meta && meta.mediaDurationSec != null && meta.mediaDurationSec > 0
                    ? meta.mediaDurationSec
                    : null;
            containerHasAudio[side] = parseMp4HasAudioTrackFromMoov(loc.buf, loc.moov0, loc.moov1);
        } catch (_) {
            containerFps[side] = null;
            containerSampleCount[side] = null;
            containerStszSampleCount[side] = null;
            containerTimelineFrameOffset[side] = 0;
            containerMediaDurationSec[side] = null;
            if (containerHasAudio[side] !== false) {
                containerHasAudio[side] = null;
            }
        }
    }

    async function refreshContainerFpsForCurrentFiles() {
        const fileForParse = fileMain;
        if (fileForParse) {
            await refreshContainerMetaForSide('main', fileForParse);
            if (fileMain !== fileForParse) return;
        } else {
            containerFps.main = null;
            containerSampleCount.main = null;
            containerStszSampleCount.main = null;
            containerTimelineFrameOffset.main = 0;
            containerMediaDurationSec.main = null;
            containerHasAudio.main = null;
        }
        refreshMasterFrameSec();
        inferContainerFpsForSide('main');
        reconcileContainerSampleCountForSide('main');
        updatePanelInfoLine();
        syncSeekMax();
        updateSeekUiFromVideo();
        const onWaveformContainerMeta =
            typeof window.onContainerMetaReadyForWaveform === 'function'
                ? window.onContainerMetaReadyForWaveform
                : typeof onContainerMetaReadyForWaveform === 'function'
                  ? onContainerMetaReadyForWaveform
                  : null;
        if (onWaveformContainerMeta) {
            onWaveformContainerMeta();
        } else if (typeof refreshVideoAudioLaneVisibility === 'function') {
            refreshVideoAudioLaneVisibility();
        }
    }

