/**
 * extra-audio-persist.js — 永続化・セッション復元・波形 ensure・動画 mix 準備
 */
    function applyExtraTrackPeaksPreview(slot, entry) {
        if (!entry || !(Number(entry.duration) > 0) || !entry.peaks || !entry.peaks.length) {
            return false;
        }
        const tr = extraTrackBySlot(slot);
        const ui = getExtraUi(slot);
        if (!tr || !ui) return false;
        setExtraTrackLaneUiOpen(slot, true);
        tr.peaks = entry.peaks;
        tr.restoreDurationHint = entry.duration;
        tr.timelineStartSec =
            Number.isFinite(entry.timelineStartSec) && entry.timelineStartSec > 0
                ? clampExtraTrackTimelineStartSec(slot, entry.timelineStartSec)
                : 0;
        tr.file = {
            name: entry.name || 'audio.wav',
            lastModified:
                typeof entry.lastModified === 'number' ? entry.lastModified : Date.now(),
        };
        setExtraTrackStatus(slot, 'Restoring…');
        if (ui.meta) ui.meta.classList.add('loaded');
        if (typeof refreshAudioWaveformCompositeLoadedState === 'function') {
            refreshAudioWaveformCompositeLoadedState();
        }
        if (typeof syncAudioOnlyMarkersUi === 'function') {
            syncAudioOnlyMarkersUi();
        }
        refreshExtraTrackUi(slot);
        scheduleExtraTrackWaveformRedraw(slot);
        if (typeof syncExtraTrackWaveformLoading === 'function') {
            syncExtraTrackWaveformLoading(slot);
        }
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        writeLog(
            'Extra audio ' +
                (slot + 1) +
                ': waveform preview restored (' +
                entry.peaks.length +
                ' bars)',
        );
        return true;
    }

    /** ページ終了時も即座に使える同期スナップショット（persistBlob キャッシュ） */
    function getExtraTracksPersistSnapshot() {
        const out = [];
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const entry = getExtraTrackPersistEntry(i);
            if (entry) out.push(entry);
        }
        return out.length ? out : null;
    }

    function schedulePersistExtraTrackSlot(slot) {
        const entry = getExtraTrackPersistEntry(slot);
        if (!entry) return;
        if (typeof persistExtraTrackEntryToSession === 'function') {
            void persistExtraTrackEntryToSession(entry).catch((e) => {
                writeLog(
                    'Session: extra ' +
                        (slot + 1) +
                        ' save failed — ' +
                        (e && e.message ? e.message : String(e)),
                );
            });
        } else if (typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
    }

    let extraTrackLayoutPersistTimer = null;

    /** 入れ替え・詰め替え後: 全 Ex スロットを原子的に保存（連続操作はデバウンス） */
    function schedulePersistExtraTrackLayout() {
        if (typeof isSessionRestoreInProgress === 'function' && isSessionRestoreInProgress()) {
            return;
        }
        clearTimeout(extraTrackLayoutPersistTimer);
        if (typeof setSessionSaveDebounceActive === 'function') {
            setSessionSaveDebounceActive('layout', true);
        }
        extraTrackLayoutPersistTimer = setTimeout(() => {
            extraTrackLayoutPersistTimer = null;
            if (typeof setSessionSaveDebounceActive === 'function') {
                setSessionSaveDebounceActive('layout', false);
            }
            if (typeof persistAllExtraTracksToSession === 'function') {
                void persistAllExtraTracksToSession().catch((e) => {
                    writeLog(
                        'Session: extra layout save failed — ' +
                            (e && e.message ? e.message : String(e)),
                    );
                });
            } else if (typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
        }, 400);
    }

    async function flushPendingExtraTrackLayoutPersist() {
        if (!extraTrackLayoutPersistTimer) return;
        clearTimeout(extraTrackLayoutPersistTimer);
        extraTrackLayoutPersistTimer = null;
        if (typeof setSessionSaveDebounceActive === 'function') {
            setSessionSaveDebounceActive('layout', false);
        }
        if (typeof persistAllExtraTracksToSession === 'function') {
            await persistAllExtraTracksToSession();
        }
    }

    function canBindReviewMixVideoMediaSource() {
        return !!(
            videoMain &&
            typeof urlMain !== 'undefined' &&
            urlMain &&
            typeof videoReady === 'function' &&
            videoReady()
        );
    }

    function releaseReviewMixVideoWebAudioTap(opt) {
        releaseReviewMixVideoMonitorTap();
        if (!videoMediaSrc) {
            reviewMixVideoWired = false;
            return;
        }
        try {
            videoMediaSrc.disconnect();
        } catch (_) {}
        videoMediaSrc = null;
        reviewMixVideoWired = false;
        reviewMixVideoWireFailed = false;
        if (opt && opt.resetElement) {
            resetReviewMixVideoElementForReviewMix();
        }
    }

    /** createMediaElementSource は要素につき1回。起動時の空要素で作ると以降ずっと無音になる。 */
    function resetReviewMixVideoElementForReviewMix() {
        const frame =
            typeof frameMain !== 'undefined' ? frameMain : document.getElementById('frameMain');
        const old =
            typeof videoMain !== 'undefined' ? videoMain : document.getElementById('videoMain');
        if (!frame || !old || !old.parentNode) return;
        const savedUrl = typeof urlMain !== 'undefined' && urlMain ? urlMain : '';
        try {
            if (videoMediaSrc) videoMediaSrc.disconnect();
        } catch (_) {}
        videoMediaSrc = null;
        reviewMixVideoWired = false;
        reviewMixVideoWireFailed = false;
        releaseReviewMixVideoMonitorTap();
        videoGainNode = null;
        videoAnalyser = null;
        const nv = document.createElement('video');
        nv.id = 'videoMain';
        nv.setAttribute('playsinline', '');
        nv.setAttribute('preload', 'auto');
        frame.replaceChild(nv, old);
        if (typeof setVideoMainElement === 'function') {
            setVideoMainElement(nv);
        }
        if (typeof rebindVideoMainListeners === 'function') {
            rebindVideoMainListeners(nv);
        }
        if (savedUrl) {
            nv.src = savedUrl;
            nv.load();
        }
        writeLog('Review mix: video element reset (Web Audio re-bind)');
    }

    function prepareReviewMixForNewVideoLoad() {
        reviewMixVideoWireFailed = false;
        reviewMixVideoBoostLogged = false;
        releaseReviewMixVideoMonitorTap();
        const hadLoadedVideo = typeof fileMain !== 'undefined' && !!fileMain;
        if (videoMediaSrc) {
            releaseReviewMixVideoWebAudioTap({ resetElement: !hadLoadedVideo });
        }
    }

    async function finalizeReviewMixAfterSessionRestore() {
        if (typeof applyReviewMixVideoGain === 'function') {
            applyReviewMixVideoGain();
        }
        const ctx = ensureReviewMixCtx();
        if (ctx && ctx.state === 'suspended') {
            try {
                await ctx.resume();
            } catch (_) {}
        }
        if (typeof applyVideoMixFromSessionRestore === 'function') {
            applyVideoMixFromSessionRestore();
        }
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            applyExtraSlotMixFromSessionRestore(i);
        }
        syncExtraLaneVisibilityAfterSessionRestore();
        refreshReviewMixUi();
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (typeof ensureExtraTrackWaveformsDrawn === 'function') {
            ensureExtraTrackWaveformsDrawn({ notifyMaster: true, maxFrames: 40 });
        }
        if (typeof ensureMainVideoWaveformAfterSessionRestore === 'function') {
            ensureMainVideoWaveformAfterSessionRestore();
        }
    }

    function hasExtraTrackWaveformPeaks(slot) {
        const tr = extraTrackBySlot(slot);
        return !!(tr && tr.peaks && tr.peaks.length > 0);
    }

    function rawMasterTimelineWidthCss() {
        const el =
            typeof audioWaveformLanesTracks !== 'undefined' && audioWaveformLanesTracks
                ? audioWaveformLanesTracks
                : null;
        if (el) return el.clientWidth | 0;
        if (typeof audioWaveformTrack !== 'undefined' && audioWaveformTrack) {
            return audioWaveformTrack.clientWidth | 0;
        }
        return 0;
    }

    function syncExtraTrackClipPeaksFromTrackOverview(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.peaks || !tr.clips || !tr.clips.length) return;
        for (let i = 0; i < tr.clips.length; i++) {
            const c = tr.clips[i];
            if (c && c.buffer === tr.buffer) c.peaks = tr.peaks;
        }
    }

    function rebuildExtraTrackPeaksIfNeeded(slot) {
        const tr = extraTrackBySlot(slot);
        const ui = getExtraUi(slot);
        if (!tr || !ui || !ui.track) return false;
        if (!tr.buffer) return hasExtraTrackWaveformPeaks(slot);
        const layoutW =
            typeof waveformTimelineViewportWidthCss === 'function'
                ? waveformTimelineViewportWidthCss()
                : rawMasterTimelineWidthCss();
        if (layoutW < EXTRA_WAVEFORM_LAYOUT_MIN_CSS) return false;
        const sized = syncExtraCanvasSize(ui);
        if (!sized) return false;
        if (!tr.peaks || tr.peaks.length !== sized.barCount) {
            if (tr.peakPyramid && typeof peaksOverviewFromPyramid === 'function') {
                const overview = peaksOverviewFromPyramid(tr.peakPyramid, sized.barCount);
                if (overview && overview.length) tr.peaks = overview;
            }
            if (!tr.peaks || tr.peaks.length !== sized.barCount) {
                tr.peaks = peaksFromBuffer(tr.buffer, Math.min(512, sized.barCount));
            }
        }
        syncExtraTrackClipPeaksFromTrackOverview(slot);
        return !!(tr.peaks && tr.peaks.length > 0);
    }

    function rebuildAllExtraTrackOverviewPeaksIfNeeded() {
        let any = false;
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (rebuildExtraTrackPeaksIfNeeded(i)) any = true;
        }
        return any;
    }

    function scheduleExtraTrackPeakPyramidBuild(slot, buffer, barCount) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !buffer) return;
        const gen = (tr.peakPyramidGen = (tr.peakPyramidGen || 0) + 1);
        const onBuilt = (pyramid) => {
            if (!tr.buffer || tr.buffer !== buffer || tr.peakPyramidGen !== gen) return;
            if (!pyramid) return;
            if (typeof clearViewportPeakCache === 'function') clearViewportPeakCache();
            tr.peakPyramid = pyramid;
            if (typeof peaksOverviewFromPyramid === 'function') {
                const overview = peaksOverviewFromPyramid(tr.peakPyramid, barCount);
                if (overview && overview.length) tr.peaks = overview;
            }
            syncExtraTrackClipPeaksFromTrackOverview(slot);
            drawExtraTrackWaveform(slot);
            if (typeof scheduleWaveformHiresRedrawAfterZoom === 'function') {
                scheduleWaveformHiresRedrawAfterZoom({ slots: [slot] });
            }
        };
        const run = () => {
            if (!tr.buffer || tr.buffer !== buffer || tr.peakPyramidGen !== gen) return;
            if (typeof buildPeakPyramidFromBufferAsync === 'function') {
                buildPeakPyramidFromBufferAsync(buffer, onBuilt);
            } else if (typeof buildPeakPyramidFromBuffer === 'function') {
                onBuilt(buildPeakPyramidFromBuffer(buffer));
            }
        };
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(run, { timeout: 3000 });
        } else {
            setTimeout(run, 16);
        }
    }

    /** 表示中かつ読み込み済みの Ex スロット */
    function getVisibleLoadedExtraTrackSlots() {
        const out = [];
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const meta = document.getElementById('extraAudioMeta' + i);
            if (meta && meta.hidden) continue;
            if (!isExtraTrackLoaded(i)) continue;
            const tr = extraTrackBySlot(i);
            if (!tr || !tr.buffer) continue;
            out.push(i);
        }
        return out;
    }

    function extraTrackWaveformDrawReady(slot) {
        if (!hasExtraTrackWaveformPeaks(slot) || !isExtraTrackLaneShown(slot)) return true;
        const tr = extraTrackBySlot(slot);
        const ui = getExtraUi(slot);
        if (!tr || !ui || !ui.canvas) return false;
        if (!tr.peaks || tr.peaks.length < 1) return false;
        const laneW =
            typeof waveformTimelineViewportWidthCss === 'function'
                ? waveformTimelineViewportWidthCss()
                : rawMasterTimelineWidthCss();
        if (laneW < EXTRA_WAVEFORM_LAYOUT_MIN_CSS) return false;
        const styleW = parseFloat(ui.canvas.style.width) || 0;
        return styleW >= EXTRA_WAVEFORM_LAYOUT_MIN_CSS;
    }

    function isExtraTrackWaveformPlacementReady(slot) {
        if (!isExtraTrackLoaded(slot) && !hasExtraTrackWaveformPeaks(slot)) return true;
        if (!isExtraTrackLaneShown(slot) && !isExtraTrackLoaded(slot)) return true;
        if (extraTrackStatusIndicatesDecoding(slot)) return false;
        const ui = getExtraUi(slot);
        const status = ui && ui.status ? ui.status.textContent || '' : '';
        if (/restoring/i.test(status) && !extraTrackWaveformDrawReady(slot)) return false;
        if (isExtraTrackLoaded(slot) && !extraTrackWaveformDrawReady(slot)) return false;
        if (hasExtraTrackWaveformPeaks(slot) && !extraTrackWaveformDrawReady(slot)) return false;
        if (
            ui &&
            ui.track &&
            typeof isWaveformTrackLkfsReady === 'function' &&
            !isWaveformTrackLkfsReady(ui.track)
        ) {
            return false;
        }
        return true;
    }

    /** レイアウト未確定時は rAF で再試行し、peaks 欠落時は再生成する。 */
    function extraTrackStatusIndicatesDecoding(slot) {
        const ui = getExtraUi(slot);
        if (!ui || !ui.status) return false;
        const text = ui.status.textContent || '';
        return /decoding/i.test(text);
    }

    function areExtraTrackWaveformsRestorePending() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackLoaded(i) && !hasExtraTrackWaveformPeaks(i)) continue;
            if (!isExtraTrackLaneShown(i) && !isExtraTrackLoaded(i)) continue;
            if (extraTrackStatusIndicatesDecoding(i)) return true;
            if (isExtraTrackLoaded(i) && !extraTrackWaveformDrawReady(i)) return true;
        }
        return false;
    }

    function ensureExtraTrackWaveformsDrawnAsync(opt) {
        return new Promise((resolve) => {
            const gen = ++extraWaveformEnsureGen;
            const maxFrames = opt && opt.maxFrames > 0 ? opt.maxFrames : 28;
            const slots =
                opt && Array.isArray(opt.slots) && opt.slots.length
                    ? opt.slots.filter((s) => s >= 0 && s < EXTRA_TRACK_COUNT)
                    : null;
            let frame = 0;

            const targets = () => {
                const out = [];
                for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
                    if (slots && slots.indexOf(i) < 0) continue;
                    if (isExtraTrackLoaded(i) || hasExtraTrackWaveformPeaks(i)) out.push(i);
                }
                return out;
            };

            const paintSlot = (slot) => {
                const layoutW =
                    typeof waveformTimelineViewportWidthCss === 'function'
                        ? waveformTimelineViewportWidthCss()
                        : rawMasterTimelineWidthCss();
                if (layoutW < EXTRA_WAVEFORM_LAYOUT_MIN_CSS) return;
                if (!rebuildExtraTrackPeaksIfNeeded(slot)) return;
                drawExtraTrackWaveform(slot);
            };

            const step = () => {
                if (gen !== extraWaveformEnsureGen) {
                    resolve();
                    return;
                }
                frame += 1;
                if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                    refreshWaveformCompositeLaneLayout();
                }
                const list = targets();
                let pending = false;
                for (let j = 0; j < list.length; j++) {
                    const slot = list[j];
                    if (!extraTrackWaveformDrawReady(slot)) {
                        pending = true;
                        paintSlot(slot);
                    }
                }
                if (typeof syncExtraTrackWaveformLoading === 'function') {
                    for (let j = 0; j < list.length; j++) {
                        syncExtraTrackWaveformLoading(list[j]);
                    }
                }
                if (pending && frame < maxFrames) {
                    requestAnimationFrame(step);
                    return;
                }
                if (pending && frame >= maxFrames) {
                    for (let j = 0; j < list.length; j++) paintSlot(list[j]);
                }
                if (opt && opt.notifyMaster && typeof notifyMasterTransportDurationChanged === 'function') {
                    notifyMasterTransportDurationChanged();
                }
                if (typeof syncExtraTrackWaveformLoading === 'function') {
                    for (let j = 0; j < list.length; j++) {
                        syncExtraTrackWaveformLoading(list[j]);
                    }
                }
                resolve();
            };

            requestAnimationFrame(step);
        });
    }

    function ensureExtraTrackWaveformsDrawn(opt) {
        const gen = ++extraWaveformEnsureGen;
        const maxFrames = opt && opt.maxFrames > 0 ? opt.maxFrames : 28;
        const slots =
            opt && Array.isArray(opt.slots) && opt.slots.length
                ? opt.slots.filter((s) => s >= 0 && s < EXTRA_TRACK_COUNT)
                : null;
        let frame = 0;

        const targets = () => {
            const out = [];
            for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
                if (slots && slots.indexOf(i) < 0) continue;
                if (isExtraTrackLoaded(i) || hasExtraTrackWaveformPeaks(i)) out.push(i);
            }
            return out;
        };

        const paintSlot = (slot) => {
            const layoutW =
                typeof waveformTimelineViewportWidthCss === 'function'
                    ? waveformTimelineViewportWidthCss()
                    : rawMasterTimelineWidthCss();
            if (layoutW < EXTRA_WAVEFORM_LAYOUT_MIN_CSS) return;
            if (!rebuildExtraTrackPeaksIfNeeded(slot)) return;
            drawExtraTrackWaveform(slot);
        };

        const step = () => {
            if (gen !== extraWaveformEnsureGen) return;
            frame += 1;
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
            const list = targets();
            let pending = false;
            for (let j = 0; j < list.length; j++) {
                const slot = list[j];
                if (!extraTrackWaveformDrawReady(slot)) {
                    pending = true;
                    paintSlot(slot);
                }
            }
            if (typeof syncExtraTrackWaveformLoading === 'function') {
                for (let j = 0; j < list.length; j++) {
                    syncExtraTrackWaveformLoading(list[j]);
                }
            }
            if (pending && frame < maxFrames) {
                requestAnimationFrame(step);
                return;
            }
            if (pending && frame >= maxFrames) {
                writeLog('Extra audio: waveform layout retry limit (redrawing anyway)');
                for (let j = 0; j < list.length; j++) paintSlot(list[j]);
            }
            if (opt && opt.notifyMaster && typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
            if (typeof syncExtraTrackWaveformLoading === 'function') {
                for (let j = 0; j < list.length; j++) {
                    syncExtraTrackWaveformLoading(list[j]);
                }
            }
        };

        requestAnimationFrame(step);
    }


    function syncExtraCanvasSize(ui) {
        if (!ui || !ui.canvas || !ui.track) return null;
        const layoutW =
            typeof waveformTimelineScrubWidthCss === 'function'
                ? waveformTimelineScrubWidthCss()
                : typeof masterTimelineWidthCss === 'function'
                  ? masterTimelineWidthCss()
                  : Math.max(1, ui.track.clientWidth | 0);
        const hCss = Math.max(1, ui.track.clientHeight | 0);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const lite =
            typeof isWaveformLiteDrawRestricted === 'function' &&
            isWaveformLiteDrawRestricted();
        let backingW =
            typeof getWaveformCanvasBackingWidthCss === 'function'
                ? getWaveformCanvasBackingWidthCss(layoutW, dpr, lite)
                : layoutW;
        let barCount = Math.min(4096, Math.max(64, layoutW));
        if (lite) {
            if (typeof getWaveformLiteOverviewBarCount === 'function') {
                barCount = getWaveformLiteOverviewBarCount();
            }
        }
        ui.canvas.width = Math.max(1, Math.round(backingW * dpr));
        ui.canvas.height = Math.max(1, Math.round(hCss * dpr));
        ui.canvas.style.width = layoutW + 'px';
        ui.canvas.style.height = hCss + 'px';
        const ctx = ui.canvas.getContext('2d');
        if (ctx) {
            if (typeof applyWaveformCanvasContextTransform === 'function') {
                applyWaveformCanvasContextTransform(ctx, layoutW, backingW, dpr);
            } else if (lite && typeof applyWaveformLiteCanvasTransform === 'function') {
                applyWaveformLiteCanvasTransform(ctx, layoutW, backingW, dpr);
            } else {
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
        }
        return { ctx, wCss: layoutW, hCss, barCount, backingW };
    }

