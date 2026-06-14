/**
 * tempo-stretch.js — Tempo/Sig 先頭接頭辞による Ex トラック波形タイムストレッチ
 * オリジナルは backupBuffer / backupPersistBlob に保持し、clip.buffer を置換する。
 */
(function tempoStretchModule() {
    let tempoStretchApplyGen = 0;
    let tempoStretchInFlight = false;
    /** ストレッチ適用/解除直後 — リージョン再配置までバッファ尺をマスターに使う */
    let tempoStretchPendingRelayout = false;

    function tempoStretchDiagLog(step, data) {
        if (
            typeof isDebugLogCategoryEnabled === 'function' &&
            !isDebugLogCategoryEnabled('TEMPO_STRETCH')
        ) {
            return;
        }
        if (typeof writeDiagLog === 'function') {
            writeDiagLog('TEMPO_STRETCH', step, data);
            return;
        }
        if (typeof writeLog !== 'function') return;
        writeLog('[TempoStretch/A] ' + step + ' | ' + JSON.stringify(data || {}));
    }

    function isTempoStretchApplySkipped() {
        return !!(
            window.TEMPO_STRETCH_VERIFY &&
            window.TEMPO_STRETCH_VERIFY.skipApply
        );
    }

    function measureBufferPeak(buffer) {
        if (!buffer) return 0;
        let peak = 0;
        for (let c = 0; c < buffer.numberOfChannels; c++) {
            const data = buffer.getChannelData(c);
            for (let i = 0; i < data.length; i++) {
                peak = Math.max(peak, Math.abs(data[i]));
            }
        }
        return peak;
    }

    function dumpTempoStretchVerifyState() {
        const meterText =
            typeof getCommittedMusicalGridMeterText === 'function'
                ? getCommittedMusicalGridMeterText()
                : '';
        const spec =
            typeof parseMeterSpec === 'function' ? parseMeterSpec(meterText) : null;
        const rate = spec ? computeTempoStretchRateFromSpec(spec) : 1;
        const header = {
            meterText,
            stretchDelta: spec ? spec.stretchDelta || 0 : 0,
            stretchRate: rate,
            stretchActive: spec ? isTempoStretchActiveForSpec(spec) : false,
            skipApply: isTempoStretchApplySkipped(),
            inFlight:
                typeof isTempoStretchInFlight === 'function'
                    ? isTempoStretchInFlight()
                    : false,
            signalsmith:
                typeof isSignalsmithPitchStretchAvailable === 'function'
                    ? isSignalsmithPitchStretchAvailable()
                    : null,
            transportPlaying:
                typeof isTransportPlayingForExtra === 'function'
                    ? isTransportPlayingForExtra()
                    : typeof isTransportPlaying === 'function'
                      ? isTransportPlaying()
                      : null,
            transportSec:
                typeof getTransportSec === 'function' ? getTransportSec() : null,
            videoReady:
                typeof videoReady === 'function' ? videoReady() : null,
            audioOnlyTransport:
                typeof isAudioOnlyTransportPlayback === 'function'
                    ? isAudioOnlyTransportPlayback()
                    : null,
            hasPlayableWaveform:
                typeof hasPlayableWaveformTimeline === 'function'
                    ? hasPlayableWaveformTimeline()
                    : null,
            reviewMixCtxState:
                typeof ensureReviewMixCtx === 'function'
                    ? (ensureReviewMixCtx() || {}).state
                    : null,
        };
        tempoStretchDiagLog('verify/dump-header', header);
        if (typeof writeLog === 'function') {
            writeLog('[TempoStretch/Verify] ' + JSON.stringify(header));
        }

        const n = typeof EXTRA_TRACK_COUNT !== 'undefined' ? EXTRA_TRACK_COUNT : 0;
        const transportT =
            typeof getTransportSec === 'function' ? getTransportSec() : 0;
        const ctx =
            typeof ensureReviewMixCtx === 'function' ? ensureReviewMixCtx() : null;
        for (let slot = 0; slot < n; slot++) {
            const tr =
                typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
            const ui = typeof getExtraUi === 'function' ? getExtraUi(slot) : null;
            const track = { type: 'extra', slot };
            const segments =
                typeof getTrackSegments === 'function' ? getTrackSegments(track) : [];
            const clips =
                tr && typeof ensureExtraTrackClips === 'function'
                    ? ensureExtraTrackClips(tr)
                    : tr && tr.clips
                      ? tr.clips
                      : [];
            if (typeof ensureClipBackupState === 'function' && clips[0]) {
                ensureClipBackupState(clips[0]);
            }
            const row = {
                slot: slot + 1,
                loaded:
                    typeof isExtraTrackLoaded === 'function'
                        ? isExtraTrackLoaded(slot)
                        : !!(tr && tr.buffer),
                status: ui && ui.status ? ui.status.textContent || '' : '',
                muted: tr ? !!tr.muted : null,
                solo: tr ? !!tr.solo : null,
                bufferSec: tr && tr.buffer ? tr.buffer.duration : 0,
                bufferPeak: tr && tr.buffer ? measureBufferPeak(tr.buffer) : 0,
                backupSec:
                    clips[0] && clips[0].backupBuffer
                        ? clips[0].backupBuffer.duration
                        : 0,
                backupPeak:
                    clips[0] && clips[0].backupBuffer
                        ? measureBufferPeak(clips[0].backupBuffer)
                        : 0,
                sameRef: !!(
                    clips[0] &&
                    clips[0].backupBuffer &&
                    clips[0].buffer === clips[0].backupBuffer
                ),
                stretchedPersist: !!(clips[0] && clips[0].stretchedPersist),
                clipCount: clips.length,
                segmentCount: segments.length,
            };
            if (
                (typeof isExtraTrackLoaded === 'function'
                    ? isExtraTrackLoaded(slot)
                    : !!(tr && tr.buffer)) &&
                tr
            ) {
                row.regionActive =
                    typeof isTrackRegionActive === 'function'
                        ? isTrackRegionActive(track)
                        : null;
                row.timelineStartSec =
                    typeof getTrackTimelineStartSec === 'function'
                        ? getTrackTimelineStartSec(track)
                        : null;
                row.timelineEndSec =
                    typeof getTrackTimelineEndSec === 'function'
                        ? getTrackTimelineEndSec(track)
                        : null;
                row.shouldPlay =
                    typeof shouldExtraTrackSourceBePlaying === 'function'
                        ? shouldExtraTrackSourceBePlaying(slot)
                        : null;
                row.withinPlayable =
                    typeof isExtraTrackWithinPlayableTimeline === 'function'
                        ? isExtraTrackWithinPlayableTimeline(slot, transportT)
                        : null;
                row.audible =
                    typeof isExtraTrackAudible === 'function'
                        ? isExtraTrackAudible(slot)
                        : null;
                const activeHits =
                    typeof getActiveExtraSegmentsAtTransport === 'function'
                        ? getActiveExtraSegmentsAtTransport(transportT).filter(
                              (h) => h.slot === slot,
                          )
                        : [];
                row.activeSegmentHits = activeHits.length;
                row.fallbackMapHit = !!(
                    !activeHits.length &&
                    typeof mapTransportToSegmentForPlayback === 'function' &&
                    mapTransportToSegmentForPlayback(track, transportT)
                );
                row.sourcesScheduled =
                    tr && ctx && typeof extraTrackSourcesScheduledOrAudibleOnCtx === 'function'
                        ? extraTrackSourcesScheduledOrAudibleOnCtx(tr, ctx)
                        : !!(tr && tr.source);
                row.segmentSourceKeys =
                    tr && tr.segmentSources
                        ? Object.keys(tr.segmentSources).length
                        : 0;
                row.effectiveGain =
                    typeof getExtraTrackEffectiveGain === 'function'
                        ? getExtraTrackEffectiveGain(slot)
                        : null;
            }
            if (segments.length) {
                const seg = segments[0];
                row.seg0 = {
                    sourceInSec: seg.sourceInSec,
                    sourceOutSec: seg.sourceOutSec,
                    pitch:
                        typeof getSegmentPitchSemitones === 'function'
                            ? getSegmentPitchSemitones(track, 0)
                            : seg.pitchSemitones,
                    gainDb:
                        typeof getSegmentGainDb === 'function'
                            ? getSegmentGainDb(track, 0)
                            : seg.gainDb,
                };
            }
            tempoStretchDiagLog('verify/dump-track', row);
            if (typeof writeLog === 'function') {
                writeLog('[TempoStretch/Verify] Ex ' + (slot + 1) + ' | ' + JSON.stringify(row));
            }
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Verify', 'Tempo stretch state dumped to log', 'notice');
        }
    }

    async function restoreAllExtraTracksFromBackup(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const n = typeof EXTRA_TRACK_COUNT !== 'undefined' ? EXTRA_TRACK_COUNT : 0;
        let restoredClips = 0;
        for (let slot = 0; slot < n; slot++) {
            const tr =
                typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
            if (!tr) continue;
            const clips =
                typeof ensureExtraTrackClips === 'function'
                    ? ensureExtraTrackClips(tr)
                    : tr.clips || [];
            let slotChanged = false;
            for (let ci = 0; ci < clips.length; ci++) {
                const clip = clips[ci];
                if (!clip || !clip.backupBuffer) continue;
                if (clip.buffer === clip.backupBuffer) continue;
                clip.buffer = clip.backupBuffer;
                delete clip.stretchedPersist;
                if (clip.backupPersistBlob) {
                    clip.persistBlob = clip.backupPersistBlob;
                }
                invalidateClipStretchDerivedState(clip);
                restoredClips++;
                slotChanged = true;
            }
            if (slotChanged) {
                syncExtraTrackPrimaryAfterStretch(slot);
            }
        }
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        tempoStretchDiagLog('verify/restore-backup', { restoredClips });
        if (typeof writeLog === 'function') {
            writeLog(
                '[TempoStretch/Verify] restored ' + restoredClips + ' clip(s) from backup',
            );
        }
        if (!o.silent && typeof flashSeekHint === 'function') {
            flashSeekHint(
                'Verify',
                restoredClips
                    ? 'Restored ' + restoredClips + ' clip(s) from backup'
                    : 'No backup clips to restore',
                'notice',
            );
        }
        return restoredClips;
    }

    function computeTempoStretchRateFromSpec(spec) {
        if (!spec || !spec.entries || !spec.entries.length) return 1;
        const delta = spec.stretchDelta || 0;
        if (!delta) return 1;
        const sourceBpm = spec.entries[0].bpm;
        const effectiveBpm = sourceBpm + delta;
        if (!(sourceBpm > 0) || !(effectiveBpm > 0)) return 1;
        return effectiveBpm / sourceBpm;
    }

    function isTempoStretchActiveForSpec(spec) {
        const rate = computeTempoStretchRateFromSpec(spec);
        return Math.abs(rate - 1) > 0.00001;
    }

    function isExtraTrackTempoStretched(slot) {
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        if (!tr) return false;
        const clips =
            typeof ensureExtraTrackClips === 'function'
                ? ensureExtraTrackClips(tr)
                : tr.clips || [];
        for (let i = 0; i < clips.length; i++) {
            if (clips[i] && clips[i].stretchedPersist) return true;
        }
        return false;
    }

    function ensureClipBackupState(clip) {
        if (!clip || !clip.buffer) return;
        if (!clip.backupBuffer) {
            clip.backupBuffer = clip.buffer;
        }
        if (!clip.backupPersistBlob && clip.persistBlob && clip.persistBlob.size > 0) {
            clip.backupPersistBlob = clip.persistBlob;
        }
    }

    async function audioBufferToWavArrayBuffer(buffer) {
        if (!buffer || !buffer.length) return null;
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const numFrames = buffer.length;
        const bytesPerSample = 2;
        const blockAlign = numChannels * bytesPerSample;
        const dataSize = numFrames * blockAlign;
        const ab = new ArrayBuffer(44 + dataSize);
        const view = new DataView(ab);
        const writeStr = (offset, str) => {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        };
        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true);
        writeStr(36, 'data');
        view.setUint32(40, dataSize, true);
        let offset = 44;
        const yieldEveryFrames = 48000;
        for (let i = 0; i < numFrames; i++) {
            if (i > 0 && i % yieldEveryFrames === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            for (let c = 0; c < numChannels; c++) {
                const sample = buffer.getChannelData(c)[i] || 0;
                const clamped = Math.max(-1, Math.min(1, sample));
                const int16 =
                    clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
                view.setInt16(offset, int16, true);
                offset += 2;
            }
        }
        return ab;
    }

    async function syncClipPersistBlobFromBuffer(clip, buffer, fileName) {
        if (!clip || !buffer) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
        const ab = await audioBufferToWavArrayBuffer(buffer);
        if (!ab) return;
        const type = 'audio/wav';
        clip.persistBlob = new Blob([ab], { type });
        clip.stretchedPersist = true;
    }

    function invalidateClipStretchDerivedState(clip) {
        if (!clip) return;
        if (clip.pitchSliceBuffers) clip.pitchSliceBuffers.clear();
        clip.peaks = null;
        clip.peakPyramid = null;
    }

    /** この秒数超のフル波形は OfflineAudioContext ではなく WASM メインスレッドで処理 */
    const TEMPO_STRETCH_MAIN_THREAD_MIN_SEC = 30;

    async function renderTimeStretchedBufferOffline(sourceBuffer, stretchRate) {
        const rate = Number(stretchRate);
        if (!sourceBuffer || !(rate > 0) || Math.abs(rate - 1) < 0.00001) {
            return sourceBuffer;
        }
        if (typeof isSignalsmithPitchStretchAvailable === 'function' &&
            !isSignalsmithPitchStretchAvailable()) {
            throw new Error('Signalsmith Stretch unavailable');
        }
        const sampleRate = sourceBuffer.sampleRate;
        const channels = sourceBuffer.numberOfChannels;
        const inputDurationSec = sourceBuffer.duration;
        const targetDurationSec = inputDurationSec / rate;
        const targetFrames = Math.max(
            1,
            Math.round(targetDurationSec * sampleRate),
        );
        const channelArrays = [];
        for (let c = 0; c < channels; c++) {
            channelArrays.push(new Float32Array(sourceBuffer.getChannelData(c)));
        }

        tempoStretchDiagLog('render/begin', {
            inputDurationSec,
            targetDurationSec,
            rate,
            targetFrames,
            channels,
            sampleRate,
        });
        if (typeof writeLog === 'function') {
            writeLog(
                'Tempo stretch: rendering ' +
                    inputDurationSec.toFixed(1) +
                    's → ' +
                    targetDurationSec.toFixed(1) +
                    's (×' +
                    rate.toFixed(4) +
                    ')…',
            );
        }

        async function renderWithMainThread() {
            if (typeof renderSignalsmithStretchMainThread !== 'function') return null;
            const mt = await renderSignalsmithStretchMainThread(
                channelArrays,
                sampleRate,
                rate,
                0,
                targetFrames,
            );
            if (!mt || !mt.channelArrays || !mt.channelArrays.length) return null;
            const extractStart = Math.max(0, mt.extractStart | 0);
            const available = Math.max(0, mt.channelArrays[0].length - extractStart);
            const outFrames = Math.min(targetFrames, available);
            if (outFrames <= 0) return null;
            const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            const scratch = new OfflineCtx(channels, 1, sampleRate);
            const out = scratch.createBuffer(channels, outFrames, sampleRate);
            for (let c = 0; c < channels; c++) {
                const src = mt.channelArrays[c];
                const dst = out.getChannelData(c);
                for (let i = 0; i < outFrames; i++) {
                    dst[i] = src[extractStart + i] || 0;
                }
            }
            return out;
        }

        async function renderWithAddBuffers() {
            const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            const probe = new OfflineCtx(channels, 1, sampleRate);
            const probeStretch = await SignalsmithStretch(probe, {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [channels],
            });
            const latency = Math.max(0, await probeStretch.latency());
            probeStretch.disconnect();
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
            const copied = channelArrays.map((arr) => new Float32Array(arr));
            await stretch.addBuffers(copied, copied.map((arr) => arr.buffer));
            const playWhen = Math.max(0, latency);
            await stretch.start(playWhen, 0, undefined, rate, 0);
            const rendered = await offline.startRendering();
            const extractStart = latencySamples;
            const outFrames = Math.min(targetFrames, Math.max(0, rendered.length - extractStart));
            const out = offline.createBuffer(channels, outFrames, sampleRate);
            for (let c = 0; c < channels; c++) {
                const src = rendered.getChannelData(c);
                const dst = out.getChannelData(c);
                for (let i = 0; i < outFrames; i++) {
                    dst[i] = src[extractStart + i] || 0;
                }
            }
            return out;
        }

        const preferMainThread = inputDurationSec > TEMPO_STRETCH_MAIN_THREAD_MIN_SEC;
        if (preferMainThread) {
            const mtBuf = await renderWithMainThread();
            if (mtBuf && mtBuf.duration > 0) {
                tempoStretchDiagLog('render/done-main-thread', {
                    outDurSec: mtBuf.duration,
                });
                return mtBuf;
            }
            tempoStretchDiagLog('render/main-thread-failed', {});
        }

        const workletOk =
            typeof pitchStretchUsesWorklet === 'function' && pitchStretchUsesWorklet();
        if (workletOk) {
            try {
                const buf = await renderWithAddBuffers();
                if (buf && buf.duration > 0) return buf;
            } catch (err) {
                tempoStretchDiagLog('render/worklet-failed', {
                    message: err && err.message ? err.message : String(err),
                });
            }
        }
        const mtBuf = await renderWithMainThread();
        if (mtBuf && mtBuf.duration > 0) return mtBuf;
        throw new Error('tempo stretch render failed');
    }

    async function applyTempoStretchToClip(clip, stretchRate, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!clip || !clip.buffer) return false;
        ensureClipBackupState(clip);
        const source = clip.backupBuffer || clip.buffer;
        const rate = Number(stretchRate);
        let nextBuffer = source;
        if (rate > 0 && Math.abs(rate - 1) > 0.00001) {
            nextBuffer = await renderTimeStretchedBufferOffline(source, rate);
        }
        if (!nextBuffer || !(nextBuffer.duration > 0)) return false;
        clip.buffer = nextBuffer;
        clip.stretchedPersist = Math.abs(rate - 1) > 0.00001;
        invalidateClipStretchDerivedState(clip);
        if (clip.stretchedPersist) {
            await syncClipPersistBlobFromBuffer(
                clip,
                nextBuffer,
                clip.file && clip.file.name ? clip.file.name : 'audio.wav',
            );
        } else if (clip.backupPersistBlob) {
            clip.persistBlob = clip.backupPersistBlob;
            delete clip.stretchedPersist;
        }
        tempoStretchDiagLog('clip/applied', {
            rate,
            sourceDurSec: source.duration,
            outDurSec: nextBuffer.duration,
            clipId: clip.id || 'main',
            silent: !!o.silent,
        });
        return true;
    }

    function syncExtraTrackPrimaryAfterStretch(slot) {
        const tr = typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        if (!tr) return;
        if (typeof syncExtraTrackPrimaryFromFirstClip === 'function') {
            syncExtraTrackPrimaryFromFirstClip(tr);
        }
        tr.peakPyramid = null;
        tr.peaks = null;
        tr.viewportPeaks = null;
        if (typeof rebuildExtraTrackPeaksIfNeeded === 'function') {
            rebuildExtraTrackPeaksIfNeeded(slot);
        }
        if (typeof scheduleExtraTrackPeakPyramidBuild === 'function' && tr.buffer) {
            const ui = typeof getExtraUi === 'function' ? getExtraUi(slot) : null;
            const sized = ui && ui.track && typeof syncExtraCanvasSize === 'function'
                ? syncExtraCanvasSize(ui)
                : null;
            const barCount = sized ? sized.barCount : 1200;
            scheduleExtraTrackPeakPyramidBuild(slot, tr.buffer, barCount);
        }
        if (typeof drawExtraTrackWaveform === 'function') {
            drawExtraTrackWaveform(slot);
        }
        if (typeof scheduleWaveformHiresRedrawAfterZoom === 'function') {
            scheduleWaveformHiresRedrawAfterZoom({ slots: [slot] });
        }
        if (typeof schedulePitchSliceRenderForTrack === 'function') {
            schedulePitchSliceRenderForTrack({ type: 'extra', slot });
        }
    }

    function setTempoStretchLoadingForSlots(slots, visible, message) {
        const msg = message || 'Time Stretching';
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (typeof setExtraTrackWaveformLoading === 'function') {
                setExtraTrackWaveformLoading(slot, visible);
            }
            if (typeof setExtraTrackWaveformLoadingMessage === 'function') {
                setExtraTrackWaveformLoadingMessage(slot, visible ? msg : '');
            }
            if (typeof setExtraTrackStatus === 'function') {
                setExtraTrackStatus(slot, visible ? 'Time Stretching' : 'Ready');
            }
        }
        if (typeof syncAllLoadingOverlayPlacement === 'function') {
            syncAllLoadingOverlayPlacement();
        }
    }

    function loadedExtraSlotsForStretch() {
        const out = [];
        const n = typeof EXTRA_TRACK_COUNT !== 'undefined' ? EXTRA_TRACK_COUNT : 0;
        for (let slot = 0; slot < n; slot++) {
            if (typeof isExtraTrackLoaded === 'function' && !isExtraTrackLoaded(slot)) {
                continue;
            }
            const tr = typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
            if (!tr || !tr.buffer) continue;
            out.push(slot);
        }
        return out;
    }

    async function applyTempoStretchForMeterSpec(spec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (isTempoStretchApplySkipped()) {
            tempoStretchDiagLog('apply/skipped', {
                reason: 'TEMPO_STRETCH_VERIFY.skipApply',
                stretchDelta: spec ? spec.stretchDelta || 0 : 0,
            });
            if (typeof writeLog === 'function') {
                writeLog('[TempoStretch/Verify] apply skipped (skipApply ON)');
            }
            return true;
        }
        const rate = computeTempoStretchRateFromSpec(spec);
        const prevRate = o.prevSpec ? computeTempoStretchRateFromSpec(o.prevSpec) : 1;
        const rateChanged = Math.abs(rate - prevRate) > 0.00001;
        const activeChanged =
            isTempoStretchActiveForSpec(spec) !==
            (o.prevSpec ? isTempoStretchActiveForSpec(o.prevSpec) : false);
        if (!rateChanged && !activeChanged && !o.force) {
            tempoStretchDiagLog('apply/no-op', { rate, prevRate, rateChanged, activeChanged });
            return true;
        }

        const gen = ++tempoStretchApplyGen;
        tempoStretchInFlight = true;
        const slots = loadedExtraSlotsForStretch();
        const stretchSummary =
            typeof formatTempoStretchActionSummary === 'function'
                ? formatTempoStretchActionSummary(spec)
                : '\u00d7' + rate.toFixed(4);
        const prevStretchSummary =
            typeof formatTempoStretchActionSummary === 'function' && o.prevSpec
                ? formatTempoStretchActionSummary(o.prevSpec)
                : '\u00d7' + prevRate.toFixed(4);
        const prevPart =
            prevStretchSummary !== 'no tempo offset'
                ? 'prev ' + prevStretchSummary
                : 'prev none';
        const beginMsg =
            'begin \u2014 ' +
            stretchSummary +
            ' \u2014 ' +
            prevPart +
            ' \u2014 ' +
            slots.length +
            ' Ex track(s)';
        if (typeof logTempoAction === 'function') {
            logTempoAction(beginMsg);
        } else if (typeof writeActionLog === 'function') {
            writeActionLog('Tempo', beginMsg);
        } else if (typeof writeLog === 'function') {
            writeLog('Tempo stretch: ' + beginMsg);
        }
        if (slots.length) {
            setTempoStretchLoadingForSlots(slots, true);
        }

        try {
            const n = typeof EXTRA_TRACK_COUNT !== 'undefined' ? EXTRA_TRACK_COUNT : 0;
            for (let slot = 0; slot < n; slot++) {
                if (gen !== tempoStretchApplyGen) return false;
                const tr = typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
                if (!tr || !tr.buffer) continue;
                const clips =
                    typeof ensureExtraTrackClips === 'function'
                        ? ensureExtraTrackClips(tr)
                        : tr.clips || [];
                for (let ci = 0; ci < clips.length; ci++) {
                    const clip = clips[ci];
                    if (!clip || !clip.buffer) continue;
                    await applyTempoStretchToClip(clip, rate, { silent: true });
                }
                syncExtraTrackPrimaryAfterStretch(slot);
            }
            if (typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
            if (slots.length) {
                const appliedSummary =
                    typeof formatTempoStretchActionSummary === 'function'
                        ? formatTempoStretchActionSummary(spec)
                        : '\u00d7' + rate.toFixed(4);
                let doneMsg;
                if (isTempoStretchActiveForSpec(spec)) {
                    doneMsg =
                        'applied \u2014 ' +
                        appliedSummary +
                        ' \u2014 ' +
                        slots.length +
                        ' Ex track(s)';
                } else {
                    const wasSummary =
                        o.prevSpec &&
                        typeof formatTempoStretchActionSummary === 'function'
                            ? formatTempoStretchActionSummary(o.prevSpec)
                            : '';
                    doneMsg =
                        'cleared' +
                        (wasSummary && wasSummary !== 'no tempo offset'
                            ? ' \u2014 was ' + wasSummary
                            : '') +
                        ' \u2014 ' +
                        slots.length +
                        ' Ex track(s)';
                }
                if (typeof logTempoAction === 'function') {
                    logTempoAction(doneMsg);
                } else if (typeof writeActionLog === 'function') {
                    writeActionLog('Tempo', doneMsg);
                } else if (typeof writeLog === 'function') {
                    writeLog('Tempo stretch: ' + doneMsg);
                }
            }
            return true;
        } catch (err) {
            if (typeof writeLog === 'function') {
                writeLog(
                    'Tempo stretch failed: ' +
                        (err && err.message ? err.message : String(err)),
                );
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Tempo/Sig', 'Time stretch failed', 'notice');
            }
            return false;
        } finally {
            tempoStretchInFlight = false;
            if (slots.length) {
                setTempoStretchLoadingForSlots(slots, false);
            }
            if (typeof syncAllTrackWaveformLoading === 'function') {
                syncAllTrackWaveformLoading();
            }
            if (typeof syncExtraAudioToTransport === 'function') {
                syncExtraAudioToTransport({ force: true });
            }
        }
    }

    function tempoStretchRegionScaleFactor(prevSpec, nextSpec) {
        const prevRate =
            prevSpec && typeof computeTempoStretchRateFromSpec === 'function'
                ? computeTempoStretchRateFromSpec(prevSpec)
                : 1;
        const nextRate =
            nextSpec && typeof computeTempoStretchRateFromSpec === 'function'
                ? computeTempoStretchRateFromSpec(nextSpec)
                : 1;
        if (!(prevRate > 0) || !(nextRate > 0)) return 1;
        return prevRate / nextRate;
    }

    function scaleSegmentTimesForTempoStretch(seg, scale) {
        if (!seg || !(scale > 0) || Math.abs(scale - 1) <= 0.00001) {
            return seg ? Object.assign({}, seg) : seg;
        }
        const s = Object.assign({}, seg);
        const mul = (v) => (Number.isFinite(v) ? v * scale : v);
        if (Number.isFinite(s.timelineStartSec)) s.timelineStartSec = mul(s.timelineStartSec);
        if (Number.isFinite(s.regionTimelineInSec)) {
            s.regionTimelineInSec = mul(s.regionTimelineInSec);
        }
        if (Number.isFinite(s.regionLeadPadSec)) {
            s.regionLeadPadSec = mul(s.regionLeadPadSec);
        }
        if (Number.isFinite(s.sourceInSec)) s.sourceInSec = mul(s.sourceInSec);
        if (Number.isFinite(s.sourceOutSec)) s.sourceOutSec = mul(s.sourceOutSec);
        if (Number.isFinite(s.fadeInSec)) s.fadeInSec = mul(s.fadeInSec);
        if (Number.isFinite(s.fadeOutSec)) s.fadeOutSec = mul(s.fadeOutSec);
        return s;
    }

    /** Tempo/Sig 接頭辞のみ変更時 — Phrase 再配置せず region 列を比例スケール */
    function scaleAllExtraTrackRegionsForTempoStretch(prevSpec, nextSpec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const scale = tempoStretchRegionScaleFactor(prevSpec, nextSpec);
        if (!(scale > 0) || Math.abs(scale - 1) <= 0.00001) return 0;
        if (typeof getExtraTrackCount !== 'function') return 0;
        const n = getExtraTrackCount();
        let scaledTracks = 0;
        for (let slot = 0; slot < n; slot++) {
            const track = { type: 'extra', slot };
            if (
                typeof isTrackRegionActive !== 'function' ||
                !isTrackRegionActive(track) ||
                typeof getTrackSegments !== 'function' ||
                typeof setTrackSegments !== 'function'
            ) {
                continue;
            }
            const segments = getTrackSegments(track).map((seg) =>
                scaleSegmentTimesForTempoStretch(seg, scale),
            );
            if (!segments.length) continue;
            const state =
                typeof getPlaybackRegionsState === 'function'
                    ? getPlaybackRegionsState(track)
                    : null;
            if (state) {
                if (Number.isFinite(state.headPadSec)) state.headPadSec *= scale;
                if (Number.isFinite(state.regionTimelineInSec)) {
                    state.regionTimelineInSec *= scale;
                }
                if (Number.isFinite(state.regionLeadPadSec)) {
                    state.regionLeadPadSec *= scale;
                }
                delete state.timelineSlots;
            }
            if (
                setTrackSegments(track, segments, {
                    silent: true,
                    skipUndo: !!o.skipUndo,
                    segmentStructureChanged: false,
                    affectedSegmentIndices: segments.map((_, i) => i),
                })
            ) {
                scaledTracks++;
            }
        }
        tempoStretchDiagLog('regions/scaled', {
            scale,
            tracks: scaledTracks,
            prevRate: computeTempoStretchRateFromSpec(prevSpec),
            nextRate: computeTempoStretchRateFromSpec(nextSpec),
        });
        if (scaledTracks > 0) {
            if (typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
            if (typeof syncExtraAudioToTransport === 'function') {
                syncExtraAudioToTransport({ force: true });
            }
        }
        return scaledTracks;
    }

    async function applyTempoStretchForCurrentMeter(opt) {
        if (typeof parseMeterSpec !== 'function') return true;
        const text =
            typeof getCommittedMusicalGridMeterText === 'function'
                ? getCommittedMusicalGridMeterText()
                : '';
        const spec = parseMeterSpec(text);
        if (!spec) return false;
        return applyTempoStretchForMeterSpec(spec, opt);
    }

    function bindClipBackupOnLoad(clip, buffer, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (!clip || !buffer) return;
        if (o.backupBuffer && o.backupBuffer !== buffer) {
            clip.backupBuffer = o.backupBuffer;
            clip.buffer = buffer;
        } else {
            clip.backupBuffer = buffer;
        }
        if (o.backupPersistBlob) {
            clip.backupPersistBlob = o.backupPersistBlob;
        }
        if (o.stretchedPersist) {
            clip.stretchedPersist = true;
        } else {
            delete clip.stretchedPersist;
        }
    }

    window.computeTempoStretchRateFromSpec = computeTempoStretchRateFromSpec;
    window.isTempoStretchActiveForSpec = isTempoStretchActiveForSpec;
    window.isExtraTrackTempoStretched = isExtraTrackTempoStretched;
    window.applyTempoStretchForMeterSpec = applyTempoStretchForMeterSpec;
    window.applyTempoStretchForCurrentMeter = applyTempoStretchForCurrentMeter;
    window.bindClipBackupOnLoad = bindClipBackupOnLoad;
    window.ensureClipBackupState = ensureClipBackupState;
    window.tempoStretchDiagLog = tempoStretchDiagLog;
    window.isTempoStretchInFlight = function isTempoStretchInFlight() {
        return tempoStretchInFlight;
    };
    window.isTempoStretchPendingRelayout = function isTempoStretchPendingRelayout() {
        return tempoStretchPendingRelayout;
    };
    window.setTempoStretchPendingRelayout = function setTempoStretchPendingRelayout(on) {
        tempoStretchPendingRelayout = !!on;
    };
    window.clearTempoStretchPendingRelayout = function clearTempoStretchPendingRelayout() {
        tempoStretchPendingRelayout = false;
    };
    window.isTempoStretchApplySkipped = isTempoStretchApplySkipped;
    window.dumpTempoStretchVerifyState = dumpTempoStretchVerifyState;
    window.restoreAllExtraTracksFromBackup = restoreAllExtraTracksFromBackup;
    window.audioBufferToWavArrayBuffer = audioBufferToWavArrayBuffer;
    window.tempoStretchRegionScaleFactor = tempoStretchRegionScaleFactor;
    window.scaleAllExtraTrackRegionsForTempoStretch = scaleAllExtraTrackRegionsForTempoStretch;
})();
