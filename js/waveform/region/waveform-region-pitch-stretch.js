/**
 * waveform-region-pitch-stretch.js — Signalsmith Stretch によるオフラインピッチシフト
 * リージョン sourceIn〜Out スライスを事前レンダリングし playbackRate=1 で再生する。
 */
    const pitchSliceRenderPending = new Map();
    let pitchStretchCapable = null;

    function pitchPlaybackLog(step, data) {
        if (
            typeof isDebugLogCategoryEnabled === 'function' &&
            !isDebugLogCategoryEnabled('KEY_PLAYBACK')
        ) {
            return;
        }
        if (typeof writeDiagLog === 'function') {
            writeDiagLog('KEY_PLAYBACK', step, data);
            return;
        }
        if (typeof writeLog !== 'function') return;
        writeLog('[KeyPlayback] ' + step + ' | ' + JSON.stringify(data || {}));
    }

    function measurePeakFromChannels(getChannelData, channelCount) {
        let peak = 0;
        for (let c = 0; c < channelCount; c++) {
            const data = getChannelData(c);
            if (!data) continue;
            for (let i = 0; i < data.length; i++) {
                peak = Math.max(peak, Math.abs(data[i]));
            }
        }
        return peak;
    }

    function measureChannelArraysPeak(channelArrays) {
        if (!channelArrays || !channelArrays.length) return 0;
        return measurePeakFromChannels((c) => channelArrays[c], channelArrays.length);
    }

    function measureAudioBufferPeak(buffer) {
        if (!buffer) return 0;
        return measurePeakFromChannels(
            (c) => buffer.getChannelData(c),
            buffer.numberOfChannels,
        );
    }

    function isUsablePitchSliceBuffer(buffer, sourcePeak) {
        const peak = measureAudioBufferPeak(buffer);
        if (peak < 1e-5) return false;
        if (sourcePeak > 1e-4 && peak < sourcePeak * 0.002) return false;
        return true;
    }

    function findRenderedSignalOnsetSample(buffer, fromSample, maxScanSamples) {
        if (!buffer || !buffer.length) return fromSample;
        const channels = buffer.numberOfChannels;
        const threshold = 1e-5;
        const start = Math.max(0, fromSample | 0);
        const end = Math.min(
            buffer.length,
            start + Math.max(1, maxScanSamples | 0),
        );
        for (let i = start; i < end; i++) {
            for (let c = 0; c < channels; c++) {
                if (Math.abs(buffer.getChannelData(c)[i]) > threshold) {
                    return i;
                }
            }
        }
        return start;
    }

    function copySliceToBuffer(
        getChannelData,
        extractStart,
        outFrames,
        channels,
        sampleRate,
    ) {
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const scratch = new OfflineCtx(channels, 1, sampleRate);
        const outBuffer = scratch.createBuffer(channels, outFrames, sampleRate);
        for (let c = 0; c < channels; c++) {
            const src = getChannelData(c);
            const dst = outBuffer.getChannelData(c);
            for (let i = 0; i < outFrames; i++) {
                dst[i] = src[extractStart + i] || 0;
            }
        }
        return outBuffer;
    }

    function copyChannelArraysToBuffer(
        channelArrays,
        extractStart,
        outFrames,
        channels,
        sampleRate,
    ) {
        return copySliceToBuffer(
            (c) => channelArrays[c],
            extractStart,
            outFrames,
            channels,
            sampleRate,
        );
    }

    function copyRenderedSliceToBuffer(rendered, extractStart, outFrames, channels) {
        return copySliceToBuffer(
            (c) => rendered.getChannelData(c),
            extractStart,
            outFrames,
            channels,
            rendered.sampleRate,
        );
    }

    /** 結合境界で別 BufferSource（ピッチスライス）が必要 */
    function boundaryNeedsPitchPlaybackSplit(track, boundaryIndex) {
        if (!track || boundaryIndex < 0) return false;
        const leftPitch = getSegmentPitchSemitones(track, boundaryIndex);
        const rightPitch = getSegmentPitchSemitones(track, boundaryIndex + 1);
        return leftPitch !== 0 || rightPitch !== 0;
    }

    function isSignalsmithPitchStretchAvailable() {
        if (pitchStretchCapable === null) {
            const hasWorklet =
                typeof SignalsmithStretch === 'function' &&
                typeof AudioWorkletNode !== 'undefined';
            const hasMainThread =
                typeof renderSignalsmithStretchMainThread === 'function' &&
                typeof SignalsmithStretchWasmFactory === 'function';
            pitchStretchCapable =
                typeof OfflineAudioContext !== 'undefined' &&
                (hasWorklet || hasMainThread);
        }
        return pitchStretchCapable;
    }

    function pitchStretchUsesWorklet() {
        return (
            typeof canUsePitchStretchWorklet === 'function' &&
            canUsePitchStretchWorklet()
        );
    }

    function pitchSliceCacheKey(sourceInSec, sourceOutSec, semitones) {
        return (
            Number(sourceInSec).toFixed(6) +
            ':' +
            Number(sourceOutSec).toFixed(6) +
            ':' +
            (semitones | 0) +
            ':v11'
        );
    }

    function pitchSliceStretchRateForTimeline(inputDurationSec, timelineDurationSec) {
        const inputDur = Number(inputDurationSec);
        const timelineDur = Number(timelineDurationSec);
        if (!(inputDur > 0) || !(timelineDur > 0)) return 1;
        return inputDur / timelineDur;
    }

    function pitchSliceTargetFrameCount(timelineDurationSec, sampleRate) {
        return Math.max(
            1,
            Math.round(Number(timelineDurationSec) * Number(sampleRate)),
        );
    }

    function fitAudioBufferToTimelineDuration(buffer, durationSec) {
        if (!buffer || !(durationSec > 0)) return buffer;
        const sampleRate = buffer.sampleRate;
        const channels = buffer.numberOfChannels;
        const targetFrames = pitchSliceTargetFrameCount(durationSec, sampleRate);
        if (buffer.length === targetFrames) return buffer;
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const scratch = new OfflineCtx(channels, 1, sampleRate);
        const out = scratch.createBuffer(channels, targetFrames, sampleRate);
        const copyFrames = Math.min(buffer.length, targetFrames);
        for (let c = 0; c < channels; c++) {
            const src = buffer.getChannelData(c);
            const dst = out.getChannelData(c);
            for (let i = 0; i < copyFrames; i++) {
                dst[i] = src[i] || 0;
            }
        }
        return out;
    }

    function pitchSlicePlaybackFitRate(bufferRemainSec, timelineRemainSec) {
        const bufferRemain = Number(bufferRemainSec);
        const timelineRemain = Number(timelineRemainSec);
        if (!(bufferRemain > 0.001) || !(timelineRemain > 0.001)) return 1;
        return bufferRemain / timelineRemain;
    }

    /** 結合境界の入り口: 左セグメントはピッチ未変更、右セグメントはピッチ変更あり */
    function pitchSliceEnterBoundary(track, boundaryIndex) {
        if (!track || boundaryIndex == null || boundaryIndex < 0) return false;
        const left = getSegmentPitchSemitones(track, boundaryIndex);
        const right = getSegmentPitchSemitones(track, boundaryIndex + 1);
        return left === 0 && right !== 0;
    }

    /** 結合境界の出口: 左セグメントはピッチ変更あり、右セグメントはピッチ未変更 */
    function pitchSliceExitBoundary(track, boundaryIndex) {
        if (!track || boundaryIndex == null || boundaryIndex < 0) return false;
        const left = getSegmentPitchSemitones(track, boundaryIndex);
        const right = getSegmentPitchSemitones(track, boundaryIndex + 1);
        return left !== 0 && right === 0;
    }

    /** ピッチ分割境界ごとの handoff 重ね秒数（入り口 / 出口 / その他） */
    function pitchSplitBoundaryHandoffSec(track, boundaryIndex) {
        if (
            track != null &&
            boundaryIndex != null &&
            pitchSliceEnterBoundary(track, boundaryIndex)
        ) {
            return typeof PITCH_SLICE_ENTER_HANDOFF_SEC === 'number'
                ? PITCH_SLICE_ENTER_HANDOFF_SEC
                : 0.004;
        }
        if (
            track != null &&
            boundaryIndex != null &&
            pitchSliceExitBoundary(track, boundaryIndex)
        ) {
            return typeof PITCH_SLICE_EXIT_HANDOFF_SEC === 'number'
                ? PITCH_SLICE_EXIT_HANDOFF_SEC
                : 0.02;
        }
        return typeof PITCH_SPLIT_BOUNDARY_HANDOFF_SEC === 'number'
            ? PITCH_SPLIT_BOUNDARY_HANDOFF_SEC
            : 0.12;
    }

    function ensureClipPitchSliceCache(clip) {
        if (!clip.pitchSliceBuffers) {
            clip.pitchSliceBuffers = new Map();
        }
        return clip.pitchSliceBuffers;
    }

    function invalidateClipPitchSliceCache(clip, opt) {
        if (!clip || !clip.pitchSliceBuffers) return;
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.sourceInSec != null && o.sourceOutSec != null) {
            const prefix =
                Number(o.sourceInSec).toFixed(6) + ':' + Number(o.sourceOutSec).toFixed(6) + ':';
            for (const key of clip.pitchSliceBuffers.keys()) {
                if (key.startsWith(prefix)) {
                    clip.pitchSliceBuffers.delete(key);
                }
            }
            return;
        }
        clip.pitchSliceBuffers.clear();
    }

    function extractSliceChannelArrays(sourceBuffer, sourceInSec, sourceOutSec) {
        const sampleRate = sourceBuffer.sampleRate;
        const channels = sourceBuffer.numberOfChannels;
        const startSample = Math.max(
            0,
            Math.min(sourceBuffer.length, Math.floor(Number(sourceInSec) * sampleRate)),
        );
        const endSample = Math.max(
            startSample + 1,
            Math.min(sourceBuffer.length, Math.ceil(Number(sourceOutSec) * sampleRate)),
        );
        const frameCount = endSample - startSample;
        const channelArrays = [];
        for (let c = 0; c < channels; c++) {
            const ch = sourceBuffer.getChannelData(c);
            channelArrays.push(new Float32Array(ch.subarray(startSample, endSample)));
        }
        return { channelArrays, frameCount, sampleRate, channels };
    }

    async function renderPitchShiftedSliceOffline(
        sourceBuffer,
        sourceInSec,
        sourceOutSec,
        semitones,
        targetTimelineDurationSec,
    ) {
        if (!isSignalsmithPitchStretchAvailable()) return null;
        const pitch = clampRegionPitchSemitones(semitones);
        if (pitch === 0 || !sourceBuffer) return null;

        const slice = extractSliceChannelArrays(sourceBuffer, sourceInSec, sourceOutSec);
        if (!slice.frameCount) return null;

        const { channelArrays, frameCount, sampleRate, channels } = slice;
        const sourcePeak = measureChannelArraysPeak(channelArrays);
        const inputDurationSec = frameCount / sampleRate;
        const targetDurationSec =
            Number.isFinite(targetTimelineDurationSec) &&
            targetTimelineDurationSec > 0
                ? targetTimelineDurationSec
                : inputDurationSec;
        const targetFrames = pitchSliceTargetFrameCount(
            targetDurationSec,
            sampleRate,
        );
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;

        async function measureLatency(numberOfInputs) {
            const probe = new OfflineCtx(channels, 1, sampleRate);
            const probeStretch = await SignalsmithStretch(probe, {
                numberOfInputs,
                numberOfOutputs: 1,
                outputChannelCount: [channels],
            });
            const sec = await probeStretch.latency();
            probeStretch.disconnect();
            return Math.max(0, sec);
        }

        function copiedSliceChannelArrays() {
            return channelArrays.map((arr) => new Float32Array(arr));
        }

        async function renderWithAddBuffers(stretchRate) {
            const latency = await measureLatency(0);
            const latencySamples = Math.max(0, Math.ceil(latency * sampleRate));
            const offlineLength = Math.ceil(
                latencySamples + targetFrames + sampleRate * 2.0,
            );
            const offline = new OfflineCtx(channels, offlineLength, sampleRate);
            const stretch = await SignalsmithStretch(offline, {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [channels],
            });
            stretch.connect(offline.destination);
            const copied = copiedSliceChannelArrays();
            await stretch.addBuffers(copied, copied.map((arr) => arr.buffer));
            const playWhen = Math.max(0, latency);
            await stretch.start(playWhen, 0, undefined, stretchRate, pitch);
            const rendered = await offline.startRendering();
            return { rendered, extractStart: latencySamples, mode: 'addBuffers-start' };
        }

        async function renderWithLiveInput(stretchRate) {
            const latency = await measureLatency(1);
            const latencySamples = Math.max(0, Math.ceil(latency * sampleRate));
            const offlineLength = Math.ceil(
                latencySamples + targetFrames + sampleRate * 2.0,
            );
            const offline = new OfflineCtx(channels, offlineLength, sampleRate);
            const sliceBuffer = offline.createBuffer(channels, frameCount, sampleRate);
            for (let c = 0; c < channels; c++) {
                sliceBuffer.copyToChannel(channelArrays[c], c);
            }
            const stretch = await SignalsmithStretch(offline, {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [channels],
            });
            stretch.connect(offline.destination);
            const source = offline.createBufferSource();
            source.buffer = sliceBuffer;
            source.connect(stretch);
            const playWhen = Math.max(0, latency);
            await stretch.start(playWhen, 0, undefined, stretchRate, pitch);
            source.start(playWhen);
            const rendered = await offline.startRendering();
            return { rendered, extractStart: latencySamples, mode: 'live-input' };
        }

        async function renderWithMainThread(stretchRate) {
            if (typeof renderSignalsmithStretchMainThread !== 'function') {
                return null;
            }
            const mt = await renderSignalsmithStretchMainThread(
                channelArrays,
                sampleRate,
                stretchRate,
                pitch,
                targetFrames,
            );
            if (!mt || !mt.channelArrays || !mt.channelArrays.length) {
                return null;
            }
            const extractStart = Math.max(0, mt.extractStart | 0);
            const available = Math.max(
                0,
                mt.channelArrays[0].length - extractStart,
            );
            const outFrames = Math.min(targetFrames, available);
            if (outFrames <= 0) return null;
            const outBuffer = copyChannelArraysToBuffer(
                mt.channelArrays,
                extractStart,
                outFrames,
                channels,
                sampleRate,
            );
            return {
                rendered: outBuffer,
                extractStart: 0,
                mode: 'main-thread',
                outBuffer,
                outFrames,
            };
        }

        let stretchRate = pitchSliceStretchRateForTimeline(
            inputDurationSec,
            targetDurationSec,
        );
        const workletAttempts = pitchStretchUsesWorklet()
            ? [renderWithAddBuffers, renderWithLiveInput]
            : [];
        let renderResult = null;
        for (let rateAttempt = 0; rateAttempt < 4; rateAttempt++) {
            const lastRateAttempt = rateAttempt === 3;
            for (const attempt of workletAttempts) {
                try {
                    renderResult = await attempt(stretchRate);
                } catch (err) {
                    pitchPlaybackLog('render/attempt-no-output', {
                        semitones: pitch,
                        mode: attempt.name,
                        stretchRate,
                        message: err && err.message ? err.message : String(err),
                    });
                    renderResult = null;
                }
                if (!renderResult || !renderResult.rendered) continue;
                const useOnsetTrim = renderResult.mode === 'live-input';
                const extractStart = useOnsetTrim
                    ? findRenderedSignalOnsetSample(
                          renderResult.rendered,
                          Math.max(
                              0,
                              renderResult.extractStart -
                                  Math.ceil(sampleRate * 0.05),
                          ),
                          Math.ceil(sampleRate * 0.35),
                      )
                    : Math.max(0, renderResult.extractStart | 0);
                const available = Math.max(
                    0,
                    renderResult.rendered.length - extractStart,
                );
                const outFrames = Math.min(targetFrames, available);
                if (outFrames <= 0) continue;
                const outBuffer = copyRenderedSliceToBuffer(
                    renderResult.rendered,
                    extractStart,
                    outFrames,
                    channels,
                );
                if (!isUsablePitchSliceBuffer(outBuffer, sourcePeak)) {
                    pitchPlaybackLog('render/attempt-silent', {
                        semitones: pitch,
                        mode: renderResult.mode,
                        stretchRate,
                        outPeak: measureAudioBufferPeak(outBuffer),
                    });
                    continue;
                }
                const shortfallFrames = targetFrames - outFrames;
                if (shortfallFrames > Math.ceil(sampleRate * 0.002)) {
                    if (lastRateAttempt) {
                        pitchPlaybackLog('render/shortfall-accept', {
                            semitones: pitch,
                            stretchRate,
                            targetFrames,
                            outFrames,
                            shortfallSec: shortfallFrames / sampleRate,
                        });
                    } else {
                        pitchPlaybackLog('render/shortfall-retry', {
                            semitones: pitch,
                            stretchRate,
                            targetFrames,
                            outFrames,
                            shortfallSec: shortfallFrames / sampleRate,
                            inputDurSec: inputDurationSec,
                            targetDurSec: targetDurationSec,
                        });
                        stretchRate *=
                            Math.max(0.5, outFrames / Math.max(1, targetFrames));
                        renderResult = null;
                        break;
                    }
                }
                pitchPlaybackLog('render/done', {
                    semitones: pitch,
                    sourceInSec,
                    sourceOutSec,
                    inputFrames: frameCount,
                    outFrames,
                    targetFrames,
                    inputDurSec: inputDurationSec,
                    targetDurSec: targetDurationSec,
                    outDurSec: outBuffer.duration,
                    stretchRate,
                    extractStartSamples: extractStart,
                    sourcePeak,
                    outPeak: measureAudioBufferPeak(outBuffer),
                    renderMode: renderResult.mode,
                });
                return outBuffer;
            }

            if (!renderResult && typeof renderSignalsmithStretchMainThread === 'function') {
                try {
                    const mtResult = await renderWithMainThread(stretchRate);
                    if (mtResult && mtResult.outBuffer) {
                        const outBuffer = mtResult.outBuffer;
                        if (!isUsablePitchSliceBuffer(outBuffer, sourcePeak)) {
                            pitchPlaybackLog('render/main-thread-silent', {
                                semitones: pitch,
                                stretchRate,
                                outPeak: measureAudioBufferPeak(outBuffer),
                            });
                        } else {
                            const shortfallFrames = targetFrames - mtResult.outFrames;
                            if (
                                shortfallFrames > Math.ceil(sampleRate * 0.002) &&
                                !lastRateAttempt
                            ) {
                                pitchPlaybackLog('render/shortfall-retry', {
                                    semitones: pitch,
                                    stretchRate,
                                    targetFrames,
                                    outFrames: mtResult.outFrames,
                                    shortfallSec: shortfallFrames / sampleRate,
                                    inputDurSec: inputDurationSec,
                                    targetDurSec: targetDurationSec,
                                    renderMode: 'main-thread',
                                });
                                stretchRate *= Math.max(
                                    0.5,
                                    mtResult.outFrames / Math.max(1, targetFrames),
                                );
                            } else {
                                pitchPlaybackLog('render/done', {
                                    semitones: pitch,
                                    sourceInSec,
                                    sourceOutSec,
                                    inputFrames: frameCount,
                                    outFrames: mtResult.outFrames,
                                    targetFrames,
                                    inputDurSec: inputDurationSec,
                                    targetDurSec: targetDurationSec,
                                    outDurSec: outBuffer.duration,
                                    stretchRate,
                                    extractStartSamples: mtResult.extractStart,
                                    sourcePeak,
                                    outPeak: measureAudioBufferPeak(outBuffer),
                                    renderMode: 'main-thread',
                                });
                                return outBuffer;
                            }
                        }
                    }
                } catch (err) {
                    pitchPlaybackLog('render/main-thread-no-output', {
                        semitones: pitch,
                        stretchRate,
                        message: err && err.message ? err.message : String(err),
                    });
                }
            }

            if (renderResult) break;
        }

        pitchPlaybackLog('render/silent-reject', {
            semitones: pitch,
            sourceInSec,
            sourceOutSec,
            sourcePeak,
            targetDurSec: targetDurationSec,
            stretchRate,
            outPeak: 0,
        });
        return null;
    }

    function trimAudioBufferToDuration(buffer, durationSec) {
        if (!buffer || !(durationSec > 0)) return buffer;
        if (buffer.duration <= durationSec + 0.00001) return buffer;
        const sampleRate = buffer.sampleRate;
        const channels = buffer.numberOfChannels;
        const frames = Math.max(
            1,
            Math.min(buffer.length, Math.floor(durationSec * sampleRate)),
        );
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const scratch = new OfflineCtx(channels, 1, sampleRate);
        const out = scratch.createBuffer(channels, frames, sampleRate);
        for (let c = 0; c < channels; c++) {
            const src = buffer.getChannelData(c);
            const dst = out.getChannelData(c);
            for (let i = 0; i < frames; i++) {
                dst[i] = src[i] || 0;
            }
        }
        return out;
    }

    function pitchSliceTimelineDurationSec(track, segmentIndex) {
        if (typeof getSegmentPlaybackTimelineStart !== 'function') {
            return null;
        }
        const playbackStart = getSegmentPlaybackTimelineStart(track, segmentIndex);
        if (!Number.isFinite(playbackStart)) return null;

        let timelineEnd = null;
        if (
            typeof isSegmentBoundaryJoined === 'function' &&
            typeof getTrackSegments === 'function' &&
            typeof getSegmentTimelineStart === 'function'
        ) {
            const segments = getTrackSegments(track);
            if (
                segments &&
                segmentIndex >= 0 &&
                segmentIndex < segments.length - 1 &&
                isSegmentBoundaryJoined(track, segmentIndex)
            ) {
                const nextStart = getSegmentTimelineStart(track, segmentIndex + 1);
                if (Number.isFinite(nextStart)) {
                    timelineEnd = nextStart;
                }
            }
        }
        if (
            timelineEnd == null &&
            typeof getSegmentTimelineEnd === 'function'
        ) {
            timelineEnd = getSegmentTimelineEnd(track, segmentIndex);
        }
        if (
            !Number.isFinite(timelineEnd) ||
            timelineEnd <= playbackStart + 0.00001
        ) {
            return null;
        }
        return timelineEnd - playbackStart;
    }

    function pitchSlicePlaybackSourceBounds(track, segmentIndex) {
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return null;
        const timelineDur = pitchSliceTimelineDurationSec(track, segmentIndex);
        if (
            timelineDur != null &&
            typeof getSegmentPlaybackTimelineStart === 'function' &&
            typeof segmentSourceSecFromTransport === 'function'
        ) {
            const playbackStart = getSegmentPlaybackTimelineStart(
                track,
                segmentIndex,
            );
            return {
                sourceInSec: segmentSourceSecFromTransport(
                    track,
                    segmentIndex,
                    playbackStart,
                ),
                sourceOutSec: segmentSourceSecFromTransport(
                    track,
                    segmentIndex,
                    playbackStart + timelineDur,
                ),
                timelineDur,
            };
        }
        return {
            sourceInSec: seg.sourceInSec,
            sourceOutSec: seg.sourceOutSec,
            timelineDur:
                timelineDur != null
                    ? timelineDur
                    : Math.max(0, seg.sourceOutSec - seg.sourceInSec),
        };
    }

    function schedulePitchSliceRenderForSegment(track, segmentIndex) {
        if (!isSignalsmithPitchStretchAvailable()) return null;
        const pitch = getSegmentPitchSemitones(track, segmentIndex);
        if (pitch === 0) return null;

        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg || !isExtraTrackRef(track)) return null;

        const tr = typeof extraTrackBySlot === 'function' ? extraTrackBySlot(track.slot) : null;
        if (!tr) return null;
        const clip = getExtraTrackClip(tr, seg.clipId || 'main');
        if (!clip || !clip.buffer) return null;

        const bounds = pitchSlicePlaybackSourceBounds(track, segmentIndex);
        if (!bounds) return null;

        const cache = ensureClipPitchSliceCache(clip);
        const key = pitchSliceCacheKey(
            bounds.sourceInSec,
            bounds.sourceOutSec,
            pitch,
        );
        if (cache.has(key)) return Promise.resolve(cache.get(key));

        const pendingKey = track.slot + ':' + key;
        if (pitchSliceRenderPending.has(pendingKey)) {
            return pitchSliceRenderPending.get(pendingKey);
        }

        const job = renderPitchShiftedSliceOffline(
            clip.buffer,
            bounds.sourceInSec,
            bounds.sourceOutSec,
            pitch,
            bounds.timelineDur,
        )
            .then((buf) => {
                if (buf) {
                    const timelineDur = bounds.timelineDur;
                    if (timelineDur != null) {
                        const fitted = fitAudioBufferToTimelineDuration(
                            buf,
                            timelineDur,
                        );
                        if (fitted !== buf) {
                            pitchPlaybackLog('render/fit-to-timeline', {
                                segmentIndex,
                                pitch,
                                beforeSec: buf.duration,
                                afterSec: fitted.duration,
                                timelineDurSec: timelineDur,
                                targetFrames: pitchSliceTargetFrameCount(
                                    timelineDur,
                                    fitted.sampleRate,
                                ),
                            });
                            buf = fitted;
                        }
                    }
                    cache.set(key, buf);
            if (typeof logRegionAction === 'function') {
                logRegionAction(
                    formatExTrack(track.slot) +
                        ' key ready (' +
                        (pitch > 0 ? '+' : '') +
                        pitch +
                        ' semitones, R' +
                        (segmentIndex + 1) +
                        ')',
                );
            } else if (typeof writeLog === 'function') {
                writeLog(
                    'Ex ' +
                        (track.slot + 1) +
                        ' key ready (' +
                        (pitch > 0 ? '+' : '') +
                        pitch +
                        ')',
                );
            }
                    if (typeof syncExtraAudioToTransport === 'function') {
                        syncExtraAudioToTransport({ force: true });
                    }
                }
                return buf;
            })
            .catch((err) => {
                if (typeof writeLog === 'function') {
                    writeLog(
                        'Key shift not ready: ' +
                            (err && err.message ? err.message : err),
                    );
                }
                return null;
            })
            .finally(() => {
                pitchSliceRenderPending.delete(pendingKey);
            });

        pitchSliceRenderPending.set(pendingKey, job);
        return job;
    }

    function schedulePitchSliceRenderForTrack(track) {
        if (!track || !isExtraTrackRef(track)) return;
        const segments = getTrackSegments(track);
        for (let i = 0; i < segments.length; i++) {
            if (getSegmentPitchSemitones(track, i) !== 0) {
                schedulePitchSliceRenderForSegment(track, i);
            }
        }
    }

    /**
     * 再生用バッファを解決する。
     * @returns {{ buffer: AudioBuffer, bufferOff: number, pitchRate: number, legacyPlaybackRate: boolean }}
     */
    function resolveRegionSegmentPlaybackBuffer(track, segmentIndex, clip, absoluteBufferOff) {
        const empty = { buffer: null, bufferOff: 0, pitchRate: 1, legacyPlaybackRate: false };
        if (!clip || !clip.buffer) return empty;

        const pitch = getSegmentPitchSemitones(track, segmentIndex);
        if (pitch === 0) {
            return {
                buffer: clip.buffer,
                bufferOff: Math.max(0, Number(absoluteBufferOff) || 0),
                pitchRate: 1,
                legacyPlaybackRate: false,
                usesPitchSlice: false,
            };
        }

        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) {
            return {
                buffer: clip.buffer,
                bufferOff: Math.max(0, Number(absoluteBufferOff) || 0),
                pitchRate: segmentPitchPlaybackRate(pitch),
                legacyPlaybackRate: true,
            };
        }

        if (isSignalsmithPitchStretchAvailable()) {
            const bounds = pitchSlicePlaybackSourceBounds(track, segmentIndex);
            const cache = ensureClipPitchSliceCache(clip);
            const key = bounds
                ? pitchSliceCacheKey(bounds.sourceInSec, bounds.sourceOutSec, pitch)
                : pitchSliceCacheKey(seg.sourceInSec, seg.sourceOutSec, pitch);
            const cached = cache.get(key);
            if (cached && bounds) {
                const sourceSlice = extractSliceChannelArrays(
                    clip.buffer,
                    bounds.sourceInSec,
                    bounds.sourceOutSec,
                );
                const sourcePeak = measureChannelArraysPeak(sourceSlice.channelArrays);
                if (!isUsablePitchSliceBuffer(cached, sourcePeak)) {
                    cache.delete(key);
                    pitchPlaybackLog('resolve/slice-cache-reject', {
                        segmentIndex,
                        pitch,
                        sourcePeak,
                        cachedPeak: measureAudioBufferPeak(cached),
                    });
                } else {
                    const sliceOff = Math.max(
                        0,
                        (Number(absoluteBufferOff) || 0) - bounds.sourceInSec,
                    );
                    const resolved = {
                        buffer: cached,
                        bufferOff: Math.min(sliceOff, Math.max(0, cached.duration - 0.002)),
                        pitchRate: 1,
                        legacyPlaybackRate: false,
                        usesPitchSlice: true,
                    };
                    pitchPlaybackLog('resolve/slice-cache', {
                        segmentIndex,
                        pitch,
                        absoluteBufferOff: Number(absoluteBufferOff) || 0,
                        sliceOff: resolved.bufferOff,
                        sliceDurSec: cached.duration,
                        sourceInSec: bounds.sourceInSec,
                        sourceOutSec: bounds.sourceOutSec,
                        timelineDurSec: bounds.timelineDur,
                        cachedPeak: measureAudioBufferPeak(cached),
                    });
                    return resolved;
                }
            }
            pitchPlaybackLog('resolve/slice-pending', {
                segmentIndex,
                pitch,
                absoluteBufferOff: Number(absoluteBufferOff) || 0,
            });
            schedulePitchSliceRenderForSegment(track, segmentIndex);
        }

        const legacy = {
            buffer: clip.buffer,
            bufferOff: Math.max(0, Number(absoluteBufferOff) || 0),
            pitchRate: segmentPitchPlaybackRate(pitch),
            legacyPlaybackRate: true,
            usesPitchSlice: false,
        };
        pitchPlaybackLog('resolve/legacy-rate', {
            segmentIndex,
            pitch,
            pitchRate: legacy.pitchRate,
            absoluteBufferOff: legacy.bufferOff,
            stretchAvailable: isSignalsmithPitchStretchAvailable(),
        });
        return legacy;
    }

    function invalidatePitchSliceCacheForSegment(track, segmentIndex) {
        if (!track || !isExtraTrackRef(track)) return;
        const segments = getTrackSegments(track);
        const seg = segments[segmentIndex];
        if (!seg) return;
        const tr = typeof extraTrackBySlot === 'function' ? extraTrackBySlot(track.slot) : null;
        if (!tr) return;
        const clip = getExtraTrackClip(tr, seg.clipId || 'main');
        if (!clip) return;
        invalidateClipPitchSliceCache(clip, {
            sourceInSec: seg.sourceInSec,
            sourceOutSec: seg.sourceOutSec,
        });
    }

    let pitchStretchWorkletWarmPromise = null;

    function markPitchStretchWarmSkipped(reason) {
        pitchStretchWorkletWarmPromise = null;
        if (typeof writeLog === 'function') {
            writeLog(
                '[KeyPlayback] stretch warmup skipped: ' +
                    (reason && reason.message ? reason.message : String(reason)),
            );
        }
    }

    /** 本番 AudioContext 上で Worklet/WASM を先行ロード（初回 Stretch 生成を短縮） */
    function warmupPitchStretchWorklet(ctx) {
        if (!isSignalsmithPitchStretchAvailable() || !ctx) {
            return Promise.resolve(false);
        }
        if (!pitchStretchUsesWorklet()) {
            return Promise.resolve(false);
        }
        if (pitchStretchWorkletWarmPromise) {
            return pitchStretchWorkletWarmPromise;
        }
        pitchStretchWorkletWarmPromise = (async () => {
            if (ctx.state === 'suspended') {
                try {
                    await ctx.resume();
                } catch (_) {}
            }
            try {
                const node = await SignalsmithStretch(ctx, {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    outputChannelCount: [2],
                });
                try {
                    node.disconnect();
                } catch (_) {}
                return true;
            } catch (err) {
                markPitchStretchWarmSkipped(err);
                return false;
            }
        })();
        return pitchStretchWorkletWarmPromise;
    }

    function extractBufferSliceChannelArrays(buffer, startSec, durationSec) {
        if (!buffer || !(durationSec > 0)) return null;
        const sampleRate = buffer.sampleRate;
        const channels = buffer.numberOfChannels;
        const startSample = Math.max(
            0,
            Math.min(buffer.length, Math.floor(Number(startSec) * sampleRate)),
        );
        const endSample = Math.max(
            startSample + 1,
            Math.min(
                buffer.length,
                Math.ceil((Number(startSec) + Number(durationSec)) * sampleRate),
            ),
        );
        const channelArrays = [];
        for (let c = 0; c < channels; c++) {
            channelArrays.push(
                new Float32Array(
                    buffer.getChannelData(c).subarray(startSample, endSample),
                ),
            );
        }
        return {
            channelArrays,
            frameCount: endSample - startSample,
            sampleRate,
            channels,
        };
    }

    function createLivePitchStretchNode(ctx, channelCount) {
        const channels = Math.max(1, channelCount | 0);
        return SignalsmithStretch(ctx, {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [channels],
        });
    }

    window.pitchPlaybackLog = pitchPlaybackLog;
    window.boundaryNeedsPitchPlaybackSplit = boundaryNeedsPitchPlaybackSplit;
    window.pitchSliceEnterBoundary = pitchSliceEnterBoundary;
    window.pitchSliceExitBoundary = pitchSliceExitBoundary;
    window.pitchSplitBoundaryHandoffSec = pitchSplitBoundaryHandoffSec;
    window.pitchSliceTimelineDurationSec = pitchSliceTimelineDurationSec;
    window.pitchSlicePlaybackFitRate = pitchSlicePlaybackFitRate;
    window.isSignalsmithPitchStretchAvailable = isSignalsmithPitchStretchAvailable;
    window.warmupPitchStretchWorklet = warmupPitchStretchWorklet;
    window.createLivePitchStretchNode = createLivePitchStretchNode;
    window.extractBufferSliceChannelArrays = extractBufferSliceChannelArrays;
    window.schedulePitchSliceRenderForSegment = schedulePitchSliceRenderForSegment;
    window.schedulePitchSliceRenderForTrack = schedulePitchSliceRenderForTrack;
    window.resolveRegionSegmentPlaybackBuffer = resolveRegionSegmentPlaybackBuffer;
    window.invalidatePitchSliceCacheForSegment = invalidatePitchSliceCacheForSegment;
