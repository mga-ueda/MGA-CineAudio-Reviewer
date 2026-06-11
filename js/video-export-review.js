/**
 * video-export-review.js — レビュー用 WebM 書き出し（MediaRecorder・ミックスタップ・進捗 UI）。
 */
(function videoExportReviewModule() {
    const EXPORT_FPS = 30;
    const VIDEO_BITRATE = 8_000_000;
    const EXPORT_WAVE_SAMPLE_RATE = 48000;
    const EXPORT_WAVE_BITS = 24;

    function chooseRecorderMimeType() {
        if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
            return '';
        }
        const candidates = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp8,vorbis',
            'video/webm',
        ];
        for (const m of candidates) {
            if (MediaRecorder.isTypeSupported(m)) return m;
        }
        return '';
    }

    function waitForVideoFrameReady(video, timeoutMs) {
        return new Promise((resolve, reject) => {
            if (!video) {
                reject(new Error('No video element'));
                return;
            }
            if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
                resolve();
                return;
            }
            let done = false;
            const finish = (fn) => {
                if (done) return;
                done = true;
                video.removeEventListener('loadeddata', onReady);
                video.removeEventListener('error', onErr);
                fn();
            };
            const onReady = () => finish(() => resolve());
            const onErr = () => finish(() => reject(new Error('Video failed to load for export')));
            video.addEventListener('loadeddata', onReady, { once: true });
            video.addEventListener('error', onErr, { once: true });
            setTimeout(() => finish(() => reject(new Error('Video load timeout for export'))), timeoutMs || 12000);
        });
    }

    function captureWebmExportUiState() {
        return {
            analyzeWasLive:
                typeof getAnalyzeOn === 'function' ? !!getAnalyzeOn() : false,
        };
    }

    function applyWebmExportUiPrep() {
        if (typeof setAnalyzeOn === 'function') {
            setAnalyzeOn(false, { silent: true });
        }
        if (typeof resetWaveformTimelineZoom === 'function') {
            resetWaveformTimelineZoom({ silent: true });
        }
    }

    function restoreWebmExportUiState(state) {
        if (!state || typeof state !== 'object') return;
        if (state.analyzeWasLive && typeof setAnalyzeOn === 'function') {
            setAnalyzeOn(true, { silent: true });
        }
    }

    function getVideoExportDurationSec() {
        if (typeof getMasterTransportDurationSec === 'function') {
            const master = getMasterTransportDurationSec();
            if (Number.isFinite(master) && master > 0) return master;
        }
        if (typeof getVideoPlaybackEndSec === 'function') {
            const end = getVideoPlaybackEndSec();
            if (Number.isFinite(end) && end > 0) return end;
        }
        if (typeof videoMain !== 'undefined' && videoMain && typeof getDuration === 'function') {
            const d = getDuration(videoMain);
            if (Number.isFinite(d) && d > 0) return d;
        }
        return 0;
    }

    function exportBurnInTimecodeText(transportSec) {
        const t = Number(transportSec);
        const vd =
            typeof getVideoPlaybackEndSec === 'function' ? getVideoPlaybackEndSec() : 0;
        if (vd > 0 && Number.isFinite(t) && t >= vd) {
            if (typeof formatTimecodeForTransport === 'function') {
                return formatTimecodeForTransport(t);
            }
        }
        if (typeof formatTimecodeForSide === 'function' && Number.isFinite(t)) {
            return formatTimecodeForSide(t, 'main');
        }
        return '00:00:00:00';
    }

    function tcBurnInRoundRectPath(ctx, x, y, bw, bh, r) {
        const rad = Math.max(0, Math.min(r, bw / 2, bh / 2));
        ctx.beginPath();
        ctx.moveTo(x + rad, y);
        ctx.lineTo(x + bw - rad, y);
        ctx.quadraticCurveTo(x + bw, y, x + bw, y + rad);
        ctx.lineTo(x + bw, y + bh - rad);
        ctx.quadraticCurveTo(x + bw, y + bh, x + bw - rad, y + bh);
        ctx.lineTo(x + rad, y + bh);
        ctx.quadraticCurveTo(x, y + bh, x, y + bh - rad);
        ctx.lineTo(x, y + rad);
        ctx.quadraticCurveTo(x, y, x + rad, y);
        ctx.closePath();
    }

    function drawMarkerBurnIn(ctx, w, h, item) {
        if (!item || !item.text) return;
        const metrics =
            typeof getMarkerCommentBurnInMetrics === 'function'
                ? getMarkerCommentBurnInMetrics(h, !!item.isRange)
                : null;
        const fontPx = metrics
            ? metrics.fontPx
            : Math.max(12, Math.min(22, Math.round(w * 0.021)));
        const lineH = fontPx * (metrics ? metrics.lineHeightRatio : 1.3);
        const strokePx = metrics ? metrics.strokePx : Math.max(1.5, fontPx * 0.1);
        const alpha = Math.max(0, Math.min(1, item.opacity));
        ctx.save();
        if (alpha < 0.999) ctx.globalAlpha = alpha;
        ctx.font = '800 ' + fontPx + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        const x = w * 0.5;
        const y = h - (h * item.bottomPct) / 100;
        const lines = String(item.text).split('\n');
        const startY = y - (lines.length - 1) * lineH;
        const fillColor = item.isRange ? '#2a7fd4' : '#e41c24';
        ctx.lineWidth = strokePx;
        ctx.strokeStyle = '#fff';
        ctx.fillStyle = fillColor;
        for (let i = 0; i < lines.length; i++) {
            const ly = startY + i * lineH;
            ctx.strokeText(lines[i], x, ly);
            ctx.fillText(lines[i], x, ly);
        }
        ctx.restore();
    }

    function drawTcBurnIn(ctx, w, h, tcText) {
        if (!tcText || typeof getTcOverlayBurnInDrawMetrics !== 'function') return;
        const m = getTcOverlayBurnInDrawMetrics(w, h, tcText, ctx);
        if (!m) return;
        const boxLeft = m.left;
        const boxTop = h - m.bottom - m.boxH;
        const textX = boxLeft + (m.textCenterX != null ? m.textCenterX : m.boxW / 2);
        const textY = boxTop + m.textCenterY;
        ctx.save();
        ctx.font =
            '700 ' +
            m.fontPx +
            'px Consolas, Monaco, "Cascadia Mono", monospace';
        try {
            if ('letterSpacing' in ctx) ctx.letterSpacing = '0.04em';
        } catch (_) {}
        ctx.fillStyle = 'rgba(8, 10, 18, 0.55)';
        tcBurnInRoundRectPath(ctx, boxLeft, boxTop, m.boxW, m.boxH, m.borderRadius);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = Math.max(1, Math.round(m.layoutScale));
        tcBurnInRoundRectPath(ctx, boxLeft, boxTop, m.boxW, m.boxH, m.borderRadius);
        ctx.stroke();
        ctx.fillStyle = '#fff4e8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.95)';
        ctx.shadowBlur = Math.max(2, Math.round(m.fontPx * 0.2));
        ctx.fillText(tcText, textX, textY);
        ctx.restore();
    }

    function drawVideoExportFrame(ctx, w, h, video, transportSec) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        const pastEnd =
            typeof shouldBlackoutVideoPicture === 'function' &&
            shouldBlackoutVideoPicture(transportSec);
        if (!pastEnd && video && video.readyState >= 2) {
            try {
                ctx.drawImage(video, 0, 0, w, h);
            } catch (_) {}
        }
        const tc =
            typeof isTimecodeOverlayUserHidden === 'function' && isTimecodeOverlayUserHidden()
                ? null
                : exportBurnInTimecodeText(transportSec);
        if (tc) drawTcBurnIn(ctx, w, h, tc);
        if (typeof getVideoExportMarkerBurnIns === 'function') {
            const burn = getVideoExportMarkerBurnIns(transportSec);
            const pointItems = Array.isArray(burn.point)
                ? burn.point
                : burn.point
                  ? [burn.point]
                  : [];
            for (let pi = 0; pi < pointItems.length; pi++) {
                drawMarkerBurnIn(ctx, w, h, pointItems[pi]);
            }
            const rangeItems = Array.isArray(burn.range)
                ? burn.range
                : burn.range
                  ? [burn.range]
                  : [];
            for (let ri = 0; ri < rangeItems.length; ri++) {
                drawMarkerBurnIn(ctx, w, h, rangeItems[ri]);
            }
        }
    }

    function triggerBlobDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    async function exportReviewVideoPackage(opt) {
        if (typeof MediaRecorder === 'undefined') {
            throw new Error('MediaRecorder is not supported in this browser');
        }
        const mimeType = chooseRecorderMimeType();
        if (!mimeType) {
            throw new Error('No supported WebM recording format in this browser');
        }
        if (typeof videoMain === 'undefined' || !videoMain) {
            throw new Error('No video loaded');
        }
        if (typeof videoReady === 'function' && !videoReady()) {
            throw new Error('Video is not ready');
        }

        const exportMedia =
            opt && opt.exportMedia
                ? opt.exportMedia
                : typeof getExportMediaOptionsFromUi === 'function'
                  ? getExportMediaOptionsFromUi()
                  : {
                        includeVideo: true,
                        includeExtra: Array.from({ length: getExtraTrackCount() }, () => false),
                    };
        if (!exportMedia.includeVideo) {
            throw new Error('Video must be included in export');
        }

        await waitForVideoFrameReady(videoMain, 15000);
        const vw = videoMain.videoWidth;
        const vh = videoMain.videoHeight;
        if (!vw || !vh) {
            throw new Error('Video has no frame dimensions');
        }
        const durationSec = getVideoExportDurationSec();
        if (!durationSec || durationSec <= 0) {
            throw new Error('Could not determine video duration');
        }

        const exportUiState = captureWebmExportUiState();
        applyWebmExportUiPrep();

        if (
            typeof isRangeLoopPlaybackActive === 'function' &&
            isRangeLoopPlaybackActive() &&
            typeof clearRangeLoopPlayback === 'function'
        ) {
            const rangeInSec =
                typeof getRangeLoopInSec === 'function' ? getRangeLoopInSec() : NaN;
            const rangeOutSec =
                typeof getRangeLoopOutSec === 'function' ? getRangeLoopOutSec() : NaN;
            clearRangeLoopPlayback({ silent: true });
            if (typeof writeLog === 'function') {
                writeLog(
                    'Export WebM: range loop off (' +
                        (typeof formatTimecodeForTransport === 'function' &&
                        Number.isFinite(rangeInSec) &&
                        Number.isFinite(rangeOutSec)
                            ? formatTimecodeForTransport(rangeInSec) +
                              ' – ' +
                              formatTimecodeForTransport(rangeOutSec)
                            : 'active') +
                        ')',
                );
            }
        }

        if (typeof haltTransportForSessionMutation === 'function') {
            haltTransportForSessionMutation({ silent: true, clearLoopAndRegion: false });
        } else if (videoMain && !videoMain.paused) {
            videoMain.pause();
        }
        if (typeof applySessionTransportAtHead === 'function') {
            applySessionTransportAtHead();
        } else if (typeof setTransportSec === 'function') {
            setTransportSec(0);
        }

        const canvas = document.createElement('canvas');
        canvas.width = vw;
        canvas.height = vh;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
            restoreWebmExportUiState(exportUiState);
            throw new Error('Canvas 2D is not available');
        }

        if (typeof beginVideoExportAudioFilter === 'function') {
            beginVideoExportAudioFilter(exportMedia);
        }
        const mixCtx =
            typeof ensureReviewMixCtx === 'function' ? ensureReviewMixCtx() : null;
        if (mixCtx && mixCtx.state === 'suspended') {
            try {
                await mixCtx.resume();
            } catch (_) {}
        }
        if (typeof primeReviewMixForPlayback === 'function') {
            await primeReviewMixForPlayback();
        }

        const audioStream =
            typeof beginReviewMixExportCapture === 'function'
                ? beginReviewMixExportCapture()
                : null;
        const videoStream = canvas.captureStream(EXPORT_FPS);
        const combinedTracks = [...videoStream.getVideoTracks()];
        if (audioStream) {
            for (const t of audioStream.getAudioTracks()) combinedTracks.push(t);
        }
        const combined = new MediaStream(combinedTracks);

        const recorderOpts = { mimeType, videoBitsPerSecond: VIDEO_BITRATE };
        let recorder;
        try {
            recorder = new MediaRecorder(combined, recorderOpts);
        } catch (e) {
            if (typeof endVideoExportAudioFilter === 'function') endVideoExportAudioFilter();
            if (typeof endReviewMixExportCapture === 'function') endReviewMixExportCapture();
            restoreWebmExportUiState(exportUiState);
            throw e;
        }

        const chunks = [];
        let exportActive = true;
        let finished = false;
        let lastProgressUiMs = 0;

        if (typeof beginWebmExportLock === 'function') {
            beginWebmExportLock({ durationSec, kind: 'webm' });
        }

        const cleanup = () => {
            exportActive = false;
            if (typeof endReviewMixExportCapture === 'function') endReviewMixExportCapture();
            if (typeof endVideoExportAudioFilter === 'function') endVideoExportAudioFilter();
            restoreWebmExportUiState(exportUiState);
            videoMain.removeEventListener('ended', onVideoEnded);
            if (typeof setWebmExportEmergencyCleanup === 'function') {
                setWebmExportEmergencyCleanup(null);
            }
            if (typeof applySessionTransportAtHead === 'function') {
                applySessionTransportAtHead();
            } else if (typeof stopPlaybackReturnTransportToHead === 'function') {
                stopPlaybackReturnTransportToHead();
            }
            if (typeof endWebmExportLock === 'function') endWebmExportLock();
        };

        const finishExport = () => {
            if (finished) return;
            finished = true;
            exportActive = false;
            if (typeof transportPlayGeneration !== 'undefined') {
                transportPlayGeneration += 1;
            }
            if (typeof haltTransportForSessionMutation === 'function') {
                haltTransportForSessionMutation({ silent: true, clearLoopAndRegion: false });
            } else if (videoMain && !videoMain.paused) {
                videoMain.pause();
            }
            if (typeof refreshVideoPastEndBlackoutUi === 'function') refreshVideoPastEndBlackoutUi();
            try {
                if (recorder.state === 'recording') recorder.stop();
            } catch (_) {}
        };

        if (typeof setWebmExportEmergencyCleanup === 'function') {
            setWebmExportEmergencyCleanup(finishExport);
        }

        const onVideoEnded = () => {
            if (finished) return;
            if (
                typeof beginExtraTransportTailIfNeeded === 'function' &&
                beginExtraTransportTailIfNeeded()
            ) {
                return;
            }
            finishExport();
        };

        const recordPromise = new Promise((resolve, reject) => {
            recorder.ondataavailable = (ev) => {
                if (ev.data && ev.data.size > 0) chunks.push(ev.data);
            };
            recorder.onerror = (ev) => {
                cleanup();
                reject(ev.error || new Error('MediaRecorder error'));
            };
            recorder.onstop = () => {
                const cancelled =
                    typeof isWebmExportCancelRequested === 'function' &&
                    isWebmExportCancelRequested();
                cleanup();
                if (cancelled) {
                    reject(new Error('Export cancelled'));
                    return;
                }
                if (!chunks.length) {
                    reject(new Error('No recorded data'));
                    return;
                }
                resolve(new Blob(chunks, { type: mimeType.split(';')[0] || 'video/webm' }));
            };
        });

        const mediaSummary = ['video'];
        const extraFlags = Array.isArray(exportMedia.includeExtra)
            ? exportMedia.includeExtra
            : [];
        for (let i = 0; i < extraFlags.length; i++) {
            if (extraFlags[i]) mediaSummary.push('Ex' + (i + 1));
        }
        if (typeof writeLog === 'function') {
            writeLog(
                'Export WebM: started (real-time, ' +
                    durationSec.toFixed(2) +
                    ' s; audio: ' +
                    mediaSummary.join(', ') +
                    ')',
            );
        }

        videoMain.addEventListener('ended', onVideoEnded);
        setTimeout(
            () => {
                if (!finished) finishExport();
            },
            Math.ceil((durationSec + 8) * 1000),
        );

        const drawLoop = () => {
            if (!exportActive) return;
            if (
                typeof isWebmExportCancelRequested === 'function' &&
                isWebmExportCancelRequested()
            ) {
                finishExport();
                return;
            }
            const transportSec =
                typeof getTransportSecForVideoExport === 'function'
                    ? getTransportSecForVideoExport()
                    : typeof getTransportSec === 'function'
                      ? getTransportSec()
                      : videoMain.currentTime || 0;
            const nowMs = performance.now();
            if (
                nowMs - lastProgressUiMs >= 120 &&
                typeof updateExportBlockingSub === 'function' &&
                typeof formatWebmExportProgressSub === 'function'
            ) {
                lastProgressUiMs = nowMs;
                updateExportBlockingSub(
                    formatWebmExportProgressSub(transportSec, durationSec),
                );
            }
            drawVideoExportFrame(ctx, vw, vh, videoMain, transportSec);
            if (transportSec >= durationSec - 0.04) {
                finishExport();
                return;
            }
            const useRvfc =
                typeof videoMain.requestVideoFrameCallback === 'function' &&
                !videoMain.ended &&
                !videoMain.paused;
            if (useRvfc) {
                videoMain.requestVideoFrameCallback(() => drawLoop());
            } else {
                requestAnimationFrame(drawLoop);
            }
        };

        try {
            recorder.start(1000);
        } catch (e) {
            cleanup();
            throw e;
        }

        if (typeof updateExportBlockingSub === 'function') {
            updateExportBlockingSub('Starting playback…');
        }
        drawLoop();

        if (typeof startVideoPlayback === 'function') {
            const ok = await startVideoPlayback({ force: true });
            if (!ok) {
                finishExport();
                throw new Error('Playback failed to start for export');
            }
        } else {
            await videoMain.play();
        }
        if (typeof forceTransportRafLoop === 'function') forceTransportRafLoop();

        let blob;
        try {
            blob = await recordPromise;
        } catch (e) {
            const cancelled =
                (typeof isWebmExportCancelRequested === 'function' &&
                    isWebmExportCancelRequested()) ||
                (e && e.message === 'Export cancelled');
            if (cancelled && typeof writeLog === 'function') {
                writeLog('Export WebM: cancelled');
            }
            throw e;
        }
        if (typeof updateExportBlockingSub === 'function') {
            updateExportBlockingSub('Finalizing…');
        }
        const filename =
            typeof buildVideoExportDownloadFilename === 'function'
                ? buildVideoExportDownloadFilename()
                : 'export.webm';
        triggerBlobDownload(blob, filename);
        if (typeof writeLog === 'function') {
            writeLog(
                'Export WebM: completed — "' +
                    filename +
                    '" (' +
                    (typeof formatByteSize === 'function'
                        ? formatByteSize(blob.size)
                        : blob.size + ' bytes') +
                    ')',
            );
        }
        return blob;
    }

    function mergeFloat32Chunks(chunks) {
        let len = 0;
        for (let i = 0; i < chunks.length; i++) len += chunks[i].length;
        const out = new Float32Array(len);
        let off = 0;
        for (let i = 0; i < chunks.length; i++) {
            out.set(chunks[i], off);
            off += chunks[i].length;
        }
        return out;
    }

    function encodeStereoWavBlob(left, right, sampleRate) {
        const channels = 2;
        const frameCount = Math.min(left.length, right.length);
        const bitsPerSample = EXPORT_WAVE_BITS;
        const bytesPerSample = bitsPerSample / 8;
        const blockAlign = channels * bytesPerSample;
        const dataSize = frameCount * blockAlign;
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);
        const writeStr = (offset, str) => {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        };
        const writeInt24 = (offset, sample) => {
            let v = Math.max(-8388608, Math.min(8388607, sample));
            view.setUint8(offset, v & 0xff);
            view.setUint8(offset + 1, (v >> 8) & 0xff);
            view.setUint8(offset + 2, (v >> 16) & 0xff);
        };
        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, channels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        writeStr(36, 'data');
        view.setUint32(40, dataSize, true);
        let offset = 44;
        for (let i = 0; i < frameCount; i++) {
            const l = Math.max(-1, Math.min(1, left[i]));
            const r = Math.max(-1, Math.min(1, right[i]));
            const li = l < 0 ? Math.round(l * 0x800000) : Math.round(l * 0x7fffff);
            const ri = r < 0 ? Math.round(r * 0x800000) : Math.round(r * 0x7fffff);
            writeInt24(offset, li);
            offset += 3;
            writeInt24(offset, ri);
            offset += 3;
        }
        return new Blob([buffer], { type: 'audio/wav' });
    }

    async function resampleStereoPcmToRate(left, right, sourceRate, targetRate) {
        const srcRate = Number(sourceRate);
        const dstRate = Number(targetRate);
        if (
            !Number.isFinite(srcRate) ||
            srcRate <= 0 ||
            !Number.isFinite(dstRate) ||
            dstRate <= 0 ||
            Math.abs(srcRate - dstRate) < 0.5
        ) {
            return { left, right, sampleRate: srcRate };
        }
        const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!Ctx) {
            return { left, right, sampleRate: srcRate };
        }
        const frameCount = Math.min(left.length, right.length);
        if (frameCount <= 0) {
            return { left, right, sampleRate: srcRate };
        }
        const durationSec = frameCount / srcRate;
        const outFrames = Math.max(1, Math.ceil(durationSec * dstRate));
        const offline = new Ctx(2, outFrames, dstRate);
        const buf = offline.createBuffer(2, frameCount, srcRate);
        buf.copyToChannel(left.subarray(0, frameCount), 0);
        buf.copyToChannel(right.subarray(0, frameCount), 1);
        const source = offline.createBufferSource();
        source.buffer = buf;
        source.connect(offline.destination);
        source.start(0);
        const rendered = await offline.startRendering();
        return {
            left: rendered.getChannelData(0),
            right: rendered.getChannelData(1),
            sampleRate: dstRate,
        };
    }

    function createReviewMixPcmCapture(ctx, audioStream) {
        if (!ctx || !audioStream) return null;
        const sampleRate = ctx.sampleRate;
        const leftChunks = [];
        const rightChunks = [];
        let capturing = true;
        const bufferSize = 4096;
        const processor = ctx.createScriptProcessor(bufferSize, 2, 2);
        const silent = ctx.createGain();
        silent.gain.value = 0;
        const source = ctx.createMediaStreamSource(audioStream);
        source.connect(processor);
        processor.connect(silent);
        silent.connect(ctx.destination);
        processor.onaudioprocess = (e) => {
            if (!capturing) return;
            const ib = e.inputBuffer;
            leftChunks.push(new Float32Array(ib.getChannelData(0)));
            const r =
                ib.numberOfChannels > 1
                    ? ib.getChannelData(1)
                    : ib.getChannelData(0);
            rightChunks.push(new Float32Array(r));
        };
        return {
            sampleRate,
            stop() {
                capturing = false;
                try {
                    source.disconnect();
                } catch (_) {}
                try {
                    processor.disconnect();
                } catch (_) {}
                try {
                    silent.disconnect();
                } catch (_) {}
            },
            toWavBlob() {
                const left = mergeFloat32Chunks(leftChunks);
                const right = mergeFloat32Chunks(rightChunks);
                return { left, right, captureSampleRate: sampleRate };
            },
            async buildWavBlob() {
                const raw = this.toWavBlob();
                const resampled = await resampleStereoPcmToRate(
                    raw.left,
                    raw.right,
                    raw.captureSampleRate,
                    EXPORT_WAVE_SAMPLE_RATE,
                );
                return {
                    blob: encodeStereoWavBlob(
                        resampled.left,
                        resampled.right,
                        resampled.sampleRate,
                    ),
                    captureSampleRate: raw.captureSampleRate,
                    outputSampleRate: resampled.sampleRate,
                };
            },
        };
    }

    function waveExportMediaSummary(extraFlags) {
        const mediaSummary = [];
        for (let i = 0; i < extraFlags.length; i++) {
            if (extraFlags[i]) mediaSummary.push('Ex' + (i + 1));
        }
        return mediaSummary;
    }

    async function exportReviewWavePackageOffline(opt) {
        if (
            typeof hasPlayableWaveformTimeline !== 'function' ||
            !hasPlayableWaveformTimeline()
        ) {
            throw new Error('No audio tracks loaded');
        }

        const exportMedia =
            opt && opt.exportMedia
                ? opt.exportMedia
                : typeof getExportMediaOptionsFromUi === 'function'
                  ? getExportMediaOptionsFromUi()
                  : {
                        includeVideo: false,
                        includeExtra: Array.from({ length: getExtraTrackCount() }, () => false),
                    };
        if (!exportMedia.includeAudio) {
            throw new Error('Audio must be included in export');
        }
        const extraFlags = Array.isArray(exportMedia.includeExtra)
            ? exportMedia.includeExtra
            : [];
        if (!extraFlags.some(Boolean)) {
            throw new Error('No audio tracks selected for export');
        }

        const durationSec = getVideoExportDurationSec();
        if (!durationSec || durationSec <= 0) {
            throw new Error('Could not determine audio duration');
        }

        const exportUiState = captureWebmExportUiState();
        applyWebmExportUiPrep();

        if (
            typeof isRangeLoopPlaybackActive === 'function' &&
            isRangeLoopPlaybackActive() &&
            typeof clearRangeLoopPlayback === 'function'
        ) {
            clearRangeLoopPlayback({ silent: true });
        }

        if (typeof haltTransportForSessionMutation === 'function') {
            haltTransportForSessionMutation({ silent: true, clearLoopAndRegion: false });
        }
        if (typeof applySessionTransportAtHead === 'function') {
            applySessionTransportAtHead();
        } else if (typeof setTransportSec === 'function') {
            setTransportSec(0);
        }

        if (typeof beginWebmExportLock === 'function') {
            beginWebmExportLock({ durationSec, kind: 'wave' });
        }
        if (typeof setWebmExportEmergencyCleanup === 'function') {
            setWebmExportEmergencyCleanup(null);
        }

        const mediaSummary = waveExportMediaSummary(extraFlags);
        if (typeof writeLog === 'function') {
            writeLog(
                'Export Wave: started (offline, ' +
                    durationSec.toFixed(2) +
                    ' s → ' +
                    EXPORT_WAVE_SAMPLE_RATE +
                    ' Hz ' +
                    EXPORT_WAVE_BITS +
                    '-bit; audio: ' +
                    mediaSummary.join(', ') +
                    ')',
            );
        }

        try {
            if (typeof bounceReviewMixOffline !== 'function') {
                throw new Error('Offline bounce unavailable');
            }
            const markersForExport =
                typeof resolveWaveExportMarkers === 'function'
                    ? resolveWaveExportMarkers()
                    : typeof getMarkersSnapshot === 'function'
                      ? getMarkersSnapshot()
                      : [];
            const result = await bounceReviewMixOffline({
                exportMedia,
                durationSec,
                markers: markersForExport,
            });
            if (
                typeof isWebmExportCancelRequested === 'function' &&
                isWebmExportCancelRequested()
            ) {
                if (typeof writeLog === 'function') {
                    writeLog('Export Wave: cancelled');
                }
                throw new Error('Export cancelled');
            }
            if (typeof updateExportBlockingSub === 'function') {
                updateExportBlockingSub('Finalizing…');
            }
            const blob = result.blob;
            const filename =
                typeof buildWaveExportDownloadFilename === 'function'
                    ? buildWaveExportDownloadFilename()
                    : 'export.wav';
            triggerBlobDownload(blob, filename);
            if (typeof writeLog === 'function') {
                writeLog(
                    'Export Wave: completed — "' +
                        filename +
                        '" (' +
                        (typeof formatByteSize === 'function'
                            ? formatByteSize(blob.size)
                            : blob.size + ' bytes') +
                        '; ' +
                        result.sampleRate +
                        ' Hz ' +
                        EXPORT_WAVE_BITS +
                        '-bit stereo; offline bounce)',
                );
            }
            return blob;
        } finally {
            restoreWebmExportUiState(exportUiState);
            if (typeof applySessionTransportAtHead === 'function') {
                applySessionTransportAtHead();
            } else if (typeof stopPlaybackReturnTransportToHead === 'function') {
                stopPlaybackReturnTransportToHead();
            }
            if (typeof endWebmExportLock === 'function') endWebmExportLock();
        }
    }

    async function exportReviewWavePackageRealtime(opt) {
        if (
            typeof hasPlayableWaveformTimeline !== 'function' ||
            !hasPlayableWaveformTimeline()
        ) {
            throw new Error('No audio tracks loaded');
        }

        const exportMedia =
            opt && opt.exportMedia
                ? opt.exportMedia
                : typeof getExportMediaOptionsFromUi === 'function'
                  ? getExportMediaOptionsFromUi()
                  : {
                        includeVideo: false,
                        includeExtra: Array.from({ length: getExtraTrackCount() }, () => false),
                    };
        if (!exportMedia.includeAudio) {
            throw new Error('Audio must be included in export');
        }
        const extraFlags = Array.isArray(exportMedia.includeExtra)
            ? exportMedia.includeExtra
            : [];
        if (!extraFlags.some(Boolean)) {
            throw new Error('No audio tracks selected for export');
        }

        const durationSec = getVideoExportDurationSec();
        if (!durationSec || durationSec <= 0) {
            throw new Error('Could not determine audio duration');
        }

        const exportUiState = captureWebmExportUiState();
        applyWebmExportUiPrep();

        if (
            typeof isRangeLoopPlaybackActive === 'function' &&
            isRangeLoopPlaybackActive() &&
            typeof clearRangeLoopPlayback === 'function'
        ) {
            clearRangeLoopPlayback({ silent: true });
        }

        if (typeof haltTransportForSessionMutation === 'function') {
            haltTransportForSessionMutation({ silent: true, clearLoopAndRegion: false });
        }
        if (typeof applySessionTransportAtHead === 'function') {
            applySessionTransportAtHead();
        } else if (typeof setTransportSec === 'function') {
            setTransportSec(0);
        }

        if (typeof beginVideoExportAudioFilter === 'function') {
            beginVideoExportAudioFilter(Object.assign({}, exportMedia, { includeVideo: false }));
        }
        const mixCtx =
            typeof ensureReviewMixCtx === 'function' ? ensureReviewMixCtx() : null;
        if (mixCtx && mixCtx.state === 'suspended') {
            try {
                await mixCtx.resume();
            } catch (_) {}
        }
        if (typeof primeReviewMixForPlayback === 'function') {
            await primeReviewMixForPlayback();
        }

        const audioStream =
            typeof beginReviewMixExportCapture === 'function'
                ? beginReviewMixExportCapture()
                : null;
        if (!audioStream || !mixCtx) {
            if (typeof endVideoExportAudioFilter === 'function') endVideoExportAudioFilter();
            restoreWebmExportUiState(exportUiState);
            throw new Error('Review mix audio capture unavailable');
        }

        const pcmCapture = createReviewMixPcmCapture(mixCtx, audioStream);
        if (!pcmCapture) {
            if (typeof endReviewMixExportCapture === 'function') endReviewMixExportCapture();
            if (typeof endVideoExportAudioFilter === 'function') endVideoExportAudioFilter();
            restoreWebmExportUiState(exportUiState);
            throw new Error('PCM capture unavailable');
        }

        let exportActive = true;
        let finished = false;
        let lastProgressUiMs = 0;

        if (typeof beginWebmExportLock === 'function') {
            beginWebmExportLock({ durationSec, kind: 'wave' });
        }

        const cleanup = () => {
            exportActive = false;
            pcmCapture.stop();
            if (typeof endReviewMixExportCapture === 'function') endReviewMixExportCapture();
            if (typeof endVideoExportAudioFilter === 'function') endVideoExportAudioFilter();
            restoreWebmExportUiState(exportUiState);
            if (typeof setWebmExportEmergencyCleanup === 'function') {
                setWebmExportEmergencyCleanup(null);
            }
            if (typeof applySessionTransportAtHead === 'function') {
                applySessionTransportAtHead();
            } else if (typeof stopPlaybackReturnTransportToHead === 'function') {
                stopPlaybackReturnTransportToHead();
            }
            if (typeof endWebmExportLock === 'function') endWebmExportLock();
        };

        const finishExport = () => {
            if (finished) return;
            finished = true;
            exportActive = false;
            if (typeof transportPlayGeneration !== 'undefined') {
                transportPlayGeneration += 1;
            }
            if (typeof haltTransportForSessionMutation === 'function') {
                haltTransportForSessionMutation({ silent: true, clearLoopAndRegion: false });
            }
            if (typeof refreshVideoPastEndBlackoutUi === 'function') refreshVideoPastEndBlackoutUi();
        };

        if (typeof setWebmExportEmergencyCleanup === 'function') {
            setWebmExportEmergencyCleanup(finishExport);
        }

        const mediaSummary = waveExportMediaSummary(extraFlags);
        if (typeof writeLog === 'function') {
            writeLog(
                'Export Wave: started (real-time, ' +
                    durationSec.toFixed(2) +
                    ' s → ' +
                    EXPORT_WAVE_SAMPLE_RATE +
                    ' Hz ' +
                    EXPORT_WAVE_BITS +
                    '-bit; audio: ' +
                    mediaSummary.join(', ') +
                    ')',
            );
        }

        setTimeout(
            () => {
                if (!finished) finishExport();
            },
            Math.ceil((durationSec + 8) * 1000),
        );

        const monitorLoop = () => {
            if (!exportActive) return;
            if (
                typeof isWebmExportCancelRequested === 'function' &&
                isWebmExportCancelRequested()
            ) {
                finishExport();
                return;
            }
            const transportSec =
                typeof getTransportSecForVideoExport === 'function'
                    ? getTransportSecForVideoExport()
                    : typeof getTransportSec === 'function'
                      ? getTransportSec()
                      : 0;
            const nowMs = performance.now();
            if (
                nowMs - lastProgressUiMs >= 120 &&
                typeof updateExportBlockingSub === 'function' &&
                typeof formatMediaExportProgressSub === 'function'
            ) {
                lastProgressUiMs = nowMs;
                updateExportBlockingSub(
                    formatMediaExportProgressSub(transportSec, durationSec, 'wave'),
                );
            }
            if (transportSec >= durationSec - 0.04) {
                finishExport();
                return;
            }
            requestAnimationFrame(monitorLoop);
        };

        if (typeof updateExportBlockingSub === 'function') {
            updateExportBlockingSub('Starting playback…');
        }
        monitorLoop();

        if (typeof startVideoPlayback === 'function') {
            const ok = await startVideoPlayback({ force: true });
            if (!ok) {
                finishExport();
                cleanup();
                throw new Error('Playback failed to start for export');
            }
        } else {
            finishExport();
            cleanup();
            throw new Error('Playback unavailable for export');
        }
        if (typeof forceTransportRafLoop === 'function') forceTransportRafLoop();

        await new Promise((resolve) => {
            const waitDone = () => {
                if (finished) {
                    resolve();
                    return;
                }
                requestAnimationFrame(waitDone);
            };
            waitDone();
        });

        exportActive = false;
        const cancelled =
            typeof isWebmExportCancelRequested === 'function' &&
            isWebmExportCancelRequested();
        pcmCapture.stop();
        if (typeof endReviewMixExportCapture === 'function') endReviewMixExportCapture();
        if (typeof endVideoExportAudioFilter === 'function') endVideoExportAudioFilter();
        restoreWebmExportUiState(exportUiState);
        if (typeof setWebmExportEmergencyCleanup === 'function') {
            setWebmExportEmergencyCleanup(null);
        }
        if (typeof applySessionTransportAtHead === 'function') {
            applySessionTransportAtHead();
        } else if (typeof stopPlaybackReturnTransportToHead === 'function') {
            stopPlaybackReturnTransportToHead();
        }

        if (cancelled) {
            if (typeof endWebmExportLock === 'function') endWebmExportLock();
            if (typeof writeLog === 'function') {
                writeLog('Export Wave: cancelled');
            }
            throw new Error('Export cancelled');
        }

        if (typeof updateExportBlockingSub === 'function') {
            updateExportBlockingSub('Finalizing…');
        }
        const wavResult = await pcmCapture.buildWavBlob();
        let blob = wavResult.blob;
        if (!blob || !blob.size) {
            if (typeof endWebmExportLock === 'function') endWebmExportLock();
            throw new Error('No recorded audio data');
        }
        if (typeof finalizeWaveExportBlobWithMarkers === 'function') {
            const markersForExport =
                typeof resolveWaveExportMarkers === 'function'
                    ? resolveWaveExportMarkers()
                    : typeof getMarkersSnapshot === 'function'
                      ? getMarkersSnapshot()
                      : [];
            blob = await finalizeWaveExportBlobWithMarkers(
                blob,
                wavResult.outputSampleRate,
                durationSec * wavResult.outputSampleRate,
                markersForExport,
            );
        }
        const filename =
            typeof buildWaveExportDownloadFilename === 'function'
                ? buildWaveExportDownloadFilename()
                : 'export.wav';
        triggerBlobDownload(blob, filename);
        if (typeof endWebmExportLock === 'function') endWebmExportLock();
        if (typeof writeLog === 'function') {
            const rateNote =
                Math.abs(wavResult.captureSampleRate - wavResult.outputSampleRate) >= 0.5
                    ? '; resampled from ' + Math.round(wavResult.captureSampleRate) + ' Hz'
                    : '';
            writeLog(
                'Export Wave: completed — "' +
                    filename +
                    '" (' +
                    (typeof formatByteSize === 'function'
                        ? formatByteSize(blob.size)
                        : blob.size + ' bytes') +
                    '; ' +
                    wavResult.outputSampleRate +
                    ' Hz ' +
                    EXPORT_WAVE_BITS +
                    '-bit stereo' +
                    rateNote +
                    ')',
            );
        }
        return blob;
    }

    async function exportReviewWavePackage(opt) {
        if (typeof bounceReviewMixOffline === 'function') {
            try {
                return await exportReviewWavePackageOffline(opt);
            } catch (err) {
                const msg = err && err.message ? err.message : String(err);
                if (msg === 'Export cancelled') throw err;
                if (typeof writeLog === 'function') {
                    writeLog(
                        'Export Wave: offline bounce failed — ' +
                            msg +
                            '; falling back to real-time capture',
                    );
                }
            }
        }
        return exportReviewWavePackageRealtime(opt);
    }

    window.exportReviewVideoPackage = exportReviewVideoPackage;
    window.exportReviewWavePackage = exportReviewWavePackage;
    window.exportReviewWavePackageOffline = exportReviewWavePackageOffline;
    window.exportReviewWavePackageRealtime = exportReviewWavePackageRealtime;
    window.getVideoExportDurationSec = getVideoExportDurationSec;
    window.encodeStereoWavBlob = encodeStereoWavBlob;
})();
