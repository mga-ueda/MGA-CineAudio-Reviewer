(function videoExportReviewModule() {
    const EXPORT_FPS = 30;
    const VIDEO_BITRATE = 8_000_000;

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
        const tc = exportBurnInTimecodeText(transportSec);
        drawTcBurnIn(ctx, w, h, tc);
        if (typeof getVideoExportMarkerBurnIns === 'function') {
            const burn = getVideoExportMarkerBurnIns(transportSec);
            if (burn.point) drawMarkerBurnIn(ctx, w, h, burn.point);
            if (burn.range) drawMarkerBurnIn(ctx, w, h, burn.range);
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
                  : { includeVideo: true, includeExtra: [false, false, false] };
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

        const analyzeWasOn =
            typeof getAnalyzeOn === 'function' ? getAnalyzeOn() : false;
        if (analyzeWasOn && typeof setAnalyzeOn === 'function') {
            setAnalyzeOn(false, { silent: true });
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
            if (analyzeWasOn && typeof setAnalyzeOn === 'function') {
                setAnalyzeOn(true, { silent: true });
            }
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
            if (analyzeWasOn && typeof setAnalyzeOn === 'function') {
                setAnalyzeOn(true, { silent: true });
            }
            throw e;
        }

        const chunks = [];
        let exportActive = true;
        let finished = false;
        let lastProgressUiMs = 0;

        if (typeof beginWebmExportLock === 'function') {
            beginWebmExportLock({ durationSec });
        }

        const cleanup = () => {
            exportActive = false;
            if (typeof endReviewMixExportCapture === 'function') endReviewMixExportCapture();
            if (typeof endVideoExportAudioFilter === 'function') endVideoExportAudioFilter();
            if (analyzeWasOn && typeof setAnalyzeOn === 'function') {
                setAnalyzeOn(true, { silent: true });
            }
            videoMain.removeEventListener('ended', onVideoEnded);
            if (typeof setWebmExportEmergencyCleanup === 'function') {
                setWebmExportEmergencyCleanup(null);
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
            if (analyzeWasOn && typeof setAnalyzeOn === 'function') {
                setAnalyzeOn(true, { silent: true });
            }
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

    window.exportReviewVideoPackage = exportReviewVideoPackage;
})();
