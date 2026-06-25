/**
 * audio-waveform-lanes.js — レーン表示・高さ・Video Audio 可視性
 */
    /** MP4 は先頭スライスでは decode できないため、フルファイルのみ（上限あり） */
    const WAVEFORM_DECODE_MAX_BYTES = 1024 * 1024 * 1024;
    const WAVEFORM_DECODE_TIMEOUT_MS = 90000;
    const WAVEFORM_BG_BUILD_DELAY_MS = 3500;

    function notifyVideoAudioLoadSettled() {
        if (typeof notifyVideoLoadLockAudioReady === 'function') {
            notifyVideoLoadLockAudioReady();
        }
    }

    function isVideoLoadLockWaitingForAudio() {
        return (
            typeof isVideoLoadLockActive === 'function' && isVideoLoadLockActive()
        );
    }

    function shouldRetryMainVideoWaveformBuild() {
        if (!urlMain || containerHasAudio.main === false) return false;
        if (waveformPeaks && waveformPeaks.length > 0) return false;
        if (waveformDecodeInFlight) return false;
        if (typeof videoReady !== 'function' || !videoReady()) return false;
        const status = audioWaveformStatus ? audioWaveformStatus.textContent || '' : '';
        if (status === 'No audio track' || status === 'Waveform unavailable') return false;
        if (status.indexOf(' ch · ') >= 0) return false;
        return true;
    }

    function stopMainVideoWaveformPresenceWatch() {
        waveformPresenceWatchGen += 1;
        if (waveformPresenceWatchTimer) {
            clearTimeout(waveformPresenceWatchTimer);
            waveformPresenceWatchTimer = 0;
        }
    }

    /** 波形が未描画のままキックが失われた場合の自動再試行（セッション復元・競合対策）。 */
    function scheduleMainVideoWaveformPresenceWatch(opt) {
        if (!urlMain || containerHasAudio.main === false) return;
        if (waveformPeaks && waveformPeaks.length > 0) return;
        stopMainVideoWaveformPresenceWatch();
        const watchGen = waveformPresenceWatchGen;
        const intervalMs =
            opt && opt.intervalMs > 0 ? opt.intervalMs : WAVEFORM_PRESENCE_WATCH_INTERVAL_MS;
        const maxTries = opt && opt.maxTries > 0 ? opt.maxTries : WAVEFORM_PRESENCE_WATCH_MAX_TRIES;
        const firstDelayMs =
            opt && opt.firstDelayMs !== undefined ? opt.firstDelayMs : WAVEFORM_PRESENCE_WATCH_FIRST_MS;
        let tries = 0;

        const tick = () => {
            waveformPresenceWatchTimer = 0;
            if (watchGen !== waveformPresenceWatchGen) return;
            if (!urlMain || containerHasAudio.main === false) return;
            if (waveformPeaks && waveformPeaks.length > 0) return;
            tries += 1;
            if (typeof videoReady === 'function' && videoReady()) {
                kickMainVideoWaveformBuild({ allowSettle: false });
            }
            if (waveformPeaks && waveformPeaks.length > 0) return;
            if (tries >= maxTries) {
                writeLog('Waveform: auto-retry stopped after ' + tries + ' attempts');
                return;
            }
            waveformPresenceWatchTimer = setTimeout(tick, intervalMs);
        };

        waveformPresenceWatchTimer = setTimeout(tick, firstDelayMs);
    }

    function scheduleWaveformBuildRetryIfNeeded() {
        if (!shouldRetryMainVideoWaveformBuild()) return;
        if (waveformDecodeInFlight) return;
        if (waveformLoadKickTimer) {
            scheduleMainVideoWaveformPresenceWatch();
            return;
        }
        if (waveformBuildTimer) {
            clearTimeout(waveformBuildTimer);
            waveformBuildTimer = 0;
        }
        waveformLoadKickTimer = setTimeout(() => {
            waveformLoadKickTimer = 0;
            kickMainVideoWaveformBuild({ allowSettle: false });
        }, 60);
    }

    function waveformBuildGenerationStale(gen) {
        if (gen === waveformBuildGen) return false;
        scheduleWaveformBuildRetryIfNeeded();
        return true;
    }

    function waveformDecodeLimitMb() {
        return Math.round(WAVEFORM_DECODE_MAX_BYTES / (1024 * 1024));
    }

    function formatWaveformSizeMb(bytes) {
        return Math.round((bytes / (1024 * 1024)) * 10) / 10;
    }

    function isWaveformFileTooLargeError(err) {
        const msg = err && err.message ? err.message : String(err || '');
        return /too large|blob too large/i.test(msg);
    }

    function reportWaveformFileTooLarge(fileBytes) {
        const mb = formatWaveformSizeMb(fileBytes > 0 ? fileBytes : 0);
        const limitMb = waveformDecodeLimitMb();
        const title = 'Cannot build waveform';
        const body =
            'File size (' +
            mb +
            ' MB) exceeds the waveform limit (' +
            limitMb +
            ' MB).\n' +
            'Video playback and markers still work.';
        writeLog('Waveform: file too large — ' + mb + ' MB (limit ' + limitMb + ' MB)');
        if (typeof showAppAlert === 'function') {
            showAppAlert(title, body, { log: false });
        } else {
            window.alert(title + '\n\n' + body);
        }
        setAudioWaveformLoaded(true);
        setAudioWaveformStatus('ファイルが大きすぎます（上限 ' + limitMb + ' MB）');
        drawAudioWaveformCanvas();
        if (audioWaveformPlayheadWrap) audioWaveformPlayheadWrap.hidden = true;
        notifyVideoAudioLoadSettled();
        if (typeof syncVideoTrackWaveformLoading === 'function') {
            syncVideoTrackWaveformLoading();
        }
    }

    function setAudioWaveformStatus(text) {
        if (typeof applyLaneStatusEl === 'function') {
            applyLaneStatusEl(audioWaveformStatus, text);
        } else if (audioWaveformStatus) {
            audioWaveformStatus.textContent = text || '';
            audioWaveformStatus.hidden = true;
        }
        const titleEl = document.getElementById('audioWaveformTitle');
        if (titleEl) {
            const slotLabel =
                typeof window.VIDEO_AUDIO_SLOT_LABEL === 'string'
                    ? window.VIDEO_AUDIO_SLOT_LABEL
                    : 'Video Audio';
            titleEl.textContent = slotLabel;
            const tip =
                typeof laneStatusTooltip === 'function' ? laneStatusTooltip(text) : '';
            const parts = [slotLabel];
            if (typeof fileMain !== 'undefined' && fileMain && fileMain.name) {
                parts.push(fileMain.name);
                const bytes = Number(fileMain.size || 0);
                if (bytes > 0) {
                    parts.push((bytes / (1024 * 1024)).toFixed(2) + ' MB');
                }
            }
            if (tip) parts.push(tip);
            titleEl.title = parts.join(' — ');
        }
    }

    /** Video Audio 行の loaded。composite の赤枠は refreshAudioWaveformCompositeLoadedState で別管理。 */
    function setAudioWaveformLoaded(loaded) {
        if (audioWaveformPanel) audioWaveformPanel.classList.toggle('loaded', !!loaded);
        refreshAudioWaveformCompositeLoadedState();
    }

    /** 映像なしでも Ex 等のタイムラインが有効なら composite を赤枠にする。 */
    function refreshAudioWaveformCompositeLoadedState() {
        if (!audioWaveformComposite) return;
        const videoLaneLoaded =
            !!(audioWaveformPanel && audioWaveformPanel.classList.contains('loaded'));
        const extraTimelineActive =
            typeof hasPlayableWaveformTimeline === 'function' &&
            hasPlayableWaveformTimeline();
        const shouldLoad = videoLaneLoaded || extraTimelineActive;
        audioWaveformComposite.classList.toggle('loaded', shouldLoad);
        if (shouldLoad && !fileMain && typeof syncAudioOnlyMarkersUi === 'function') {
            syncAudioOnlyMarkersUi();
        }
    }

    window.refreshAudioWaveformCompositeLoadedState =
        refreshAudioWaveformCompositeLoadedState;

    /** × で閉じていない限り表示。動画なし／解析待ちは枠のみ、音声なし確定時のみ非表示。 */
    let videoLaneUiOpen = true;
    let refreshingVideoAudioLaneVisibility = false;

    function notifyVideoAudioLoadSettledIfNoVideoAudio() {
        if (containerHasAudio.main === false) {
            notifyVideoAudioLoadSettled();
        }
    }

    function isVideoAudioLaneShown() {
        if (!videoLaneUiOpen) return false;
        const hasVideo = typeof videoReady === 'function' && videoReady();
        if (!hasVideo) return false;
        if (containerHasAudio.main === false) return false;
        return true;
    }

    /** 新規動画読み込み時に Video Audio 枠を再表示可能にする */
    function restoreVideoAudioLaneForNewVideo() {
        videoLaneUiOpen = true;
        if (!refreshingVideoAudioLaneVisibility) {
            refreshVideoAudioLaneVisibility();
        }
    }

    /** × で Video Audio レーンのみ非表示（動画ファイルはそのまま） */
    function dismissVideoAudioLane() {
        videoLaneUiOpen = false;
        abortWaveformBuildInFlight();
        waveformPeaks = null;
        waveformAudioBuffer = null;
        if (typeof resetVideoTrackMixToDefault === 'function') {
            resetVideoTrackMixToDefault();
        }
        refreshVideoAudioLaneVisibility();
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
    }

    function getVideoLaneUiOpen() {
        return videoLaneUiOpen;
    }

    function setVideoLaneUiOpenFromPersist(open, opt) {
        videoLaneUiOpen = !!open;
        if (!opt || !opt.skipRefresh) {
            refreshVideoAudioLaneVisibility();
        }
    }

    window.getVideoLaneUiOpen = getVideoLaneUiOpen;
    window.setVideoLaneUiOpenFromPersist = setVideoLaneUiOpenFromPersist;

    function extraTrackSlotCount() {
        return getExtraTrackCount();
    }

    function countVisibleWaveformLanes() {
        const metas = [videoVizMeta, audioWaveformPanel];
        for (let i = 0; i < extraTrackSlotCount(); i++) {
            metas.push(document.getElementById('extraAudioMeta' + i));
        }
        let count = 0;
        for (let i = 0; i < metas.length; i++) {
            if (metas[i] && !metas[i].hidden) count += 1;
        }
        return count;
    }

    function hasAnyVisibleExtraWaveformLane() {
        for (let i = 0; i < extraTrackSlotCount(); i++) {
            const meta = document.getElementById('extraAudioMeta' + i);
            if (meta && !meta.hidden) return true;
        }
        return false;
    }

    function hasMainVideoSourcePendingOrReady() {
        return (
            (typeof fileMain !== 'undefined' && !!fileMain) ||
            (typeof urlMain !== 'undefined' && !!urlMain)
        );
    }

    /** 動画に音声トラックが無いときは Video Audio を閉じ、空き Ex 1 を表示する */
    function showExtraLaneForNoVideoAudio() {
        if (containerHasAudio.main !== false) return;
        videoLaneUiOpen = false;
        if (!hasAnyVisibleExtraWaveformLane()) {
            if (typeof reviveOneEmptyExtraLane === 'function') {
                reviveOneEmptyExtraLane();
            }
        }
        refreshVideoAudioLaneVisibility({ skipEnsureAtLeastOne: true });
    }

    /** 表示レーンが 0 になったら Video Audio または空き Ex スロットを 1 つ復活させる */
    function ensureAtLeastOneWaveformLaneVisible() {
        const videoPending = hasMainVideoSourcePendingOrReady();
        if (containerHasAudio.main === false) {
            showExtraLaneForNoVideoAudio();
            return;
        }
        if (countVisibleWaveformLanes() > 0) return;
        const hasVideo = typeof videoReady === 'function' && videoReady();
        if ((hasVideo || videoPending) && containerHasAudio.main !== false) {
            restoreVideoAudioLaneForNewVideo();
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
            return;
        }
        if (typeof reviveOneEmptyExtraLane === 'function') {
            reviveOneEmptyExtraLane();
        } else {
            restoreVideoAudioLaneForNewVideo();
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
    }

    function canHideAnyWaveformLane() {
        return countVisibleWaveformLanes() > 1;
    }

    window.ensureAtLeastOneWaveformLaneVisible = ensureAtLeastOneWaveformLaneVisible;
    window.showExtraLaneForNoVideoAudio = showExtraLaneForNoVideoAudio;
    window.countVisibleWaveformLanes = countVisibleWaveformLanes;
    window.canHideAnyWaveformLane = canHideAnyWaveformLane;

    /** containerHasAudio と手動クリア状態を踏まえ Video Audio レーンの表示を反映 */
    function refreshVideoAudioLaneVisibility(opt) {
        if (refreshingVideoAudioLaneVisibility) return;
        refreshingVideoAudioLaneVisibility = true;
        try {
            refreshVideoAudioLaneVisibilityCore(opt);
        } finally {
            refreshingVideoAudioLaneVisibility = false;
        }
    }

    function refreshVideoAudioLaneVisibilityCore(opt) {
        const show = isVideoAudioLaneShown();
        if (audioWaveformPanel) {
            audioWaveformPanel.hidden = !show;
            audioWaveformPanel.setAttribute('aria-hidden', show ? 'false' : 'true');
        }
        if (audioWaveformLaneVideo) {
            audioWaveformLaneVideo.hidden = !show;
            audioWaveformLaneVideo.setAttribute('aria-hidden', show ? 'false' : 'true');
        }
        if (audioWaveformComposite) {
            audioWaveformComposite.classList.toggle(
                'audio-waveform-composite--no-video-audio',
                !show,
            );
        }
        if (typeof refreshReviewMixUi === 'function') refreshReviewMixUi();
        if (typeof refreshExtraTrackAddLaneButtons === 'function') {
            refreshExtraTrackAddLaneButtons();
        }
        if (!opt || !opt.skipEnsureAtLeastOne) {
            ensureAtLeastOneWaveformLaneVisible();
        }
        if (
            show &&
            typeof hideEmptyExtraLanesWhenVideoAudioVisible === 'function'
        ) {
            hideEmptyExtraLanesWhenVideoAudioVisible();
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        if (typeof refreshVideoVizLaneVisibility === 'function') {
            refreshVideoVizLaneVisibility({ skipInit: true });
        }
    }

    /**
     * 表示中のレーン（Video + Ex）に 1 から連番の grid-row を割り当てる。
     * 固定 CSS（Ex1=1, Ex2=2…）のまま途中スロットを閉じると行数とずれて波形が画面外になる。
     */
    function syncVisibleWaveformLaneGridRows() {
        const composite =
            typeof audioWaveformComposite !== 'undefined' && audioWaveformComposite
                ? audioWaveformComposite
                : document.getElementById('audioWaveformComposite');
        if (!composite) return;
        let row = 1;
        const assignRow = (meta, lane, show) => {
            const rowStr = show ? String(row) : '';
            if (meta) meta.style.gridRow = rowStr;
            if (lane) lane.style.gridRow = rowStr;
            if (show) row += 1;
        };
        const showMusical =
            typeof getMusicalGridVisible === 'function' && getMusicalGridVisible();
        assignRow(
            document.getElementById('musicalRehearsalMeta'),
            document.getElementById('musicalRehearsalLane'),
            showMusical,
        );
        assignRow(
            document.getElementById('musicalTempoMeta'),
            document.getElementById('musicalTempoLane'),
            showMusical,
        );
        assignRow(
            document.getElementById('musicalSignatureMeta'),
            document.getElementById('musicalSignatureLane'),
            showMusical,
        );
        assignRow(
            document.getElementById('musicalMeasureMeta'),
            document.getElementById('musicalMeasureLane'),
            showMusical,
        );
        assignRow(
            videoVizMeta,
            videoVizLane,
            !!(videoVizMeta && !videoVizMeta.hidden),
        );
        assignRow(
            audioWaveformPanel,
            audioWaveformLaneVideo,
            !!(audioWaveformPanel && !audioWaveformPanel.hidden),
        );
        for (let slot = 0; slot < extraTrackSlotCount(); slot++) {
            const meta = document.getElementById('extraAudioMeta' + slot);
            const lane = document.getElementById('extraAudioLane' + slot);
            assignRow(meta, lane, !!(meta && !meta.hidden));
        }
        if (typeof syncWaveformLanesViewportWidthCss === 'function') {
            syncWaveformLanesViewportWidthCss();
        }
        if (typeof syncAllLoadingOverlayPlacement === 'function') {
            syncAllLoadingOverlayPlacement();
        }
    }

    /** タイムラインオーバーレイの grid-row（Musical 行は fullSpan、コメントラベル等は波形行のみ） */
    function syncTimelineOverlayGridPlacement(laneCount) {
        const musicalCount =
            typeof getMusicalTrackLaneCount === 'function' ? getMusicalTrackLaneCount() : 3;
        const n = Math.max(1, laneCount | 0);
        const endRow = musicalCount + n + 1;
        const fullSpan = '1 / ' + endRow;
        const waveSpan = musicalCount + 1 + ' / ' + endRow;
        const waveOverlays = [audioWaveformMarkerLabels, audioWaveformRangeLoop];
        const fullOverlays = [
            audioWaveformMarkers,
            audioWaveformSeekTrail,
            audioWaveformPlayheadWrap,
            audioWaveformHoverPlayhead,
        ];
        for (let i = 0; i < waveOverlays.length; i++) {
            const el = waveOverlays[i];
            if (!el) continue;
            el.style.gridRow = waveSpan;
            el.style.gridColumn = '1';
        }
        for (let i = 0; i < fullOverlays.length; i++) {
            const el = fullOverlays[i];
            if (!el) continue;
            el.style.gridRow = fullSpan;
            el.style.gridColumn = '1';
        }
    }

    /** 波形レーンの基準高さ（100% = 92px） */
    const WAVEFORM_LANE_HEIGHT_BASE_PX = 92;
    const WAVEFORM_LANE_HEIGHT_SCALE_MIN = 1;
    const WAVEFORM_LANE_HEIGHT_SCALE_MAX = 4;
    const WAVEFORM_LANE_HEIGHT_SCALE_STEP = 0.25;
    /** 映像トラック: 100%→1×、400%→2×（基準 20px、最大 40px） */
    const VIDEO_VIZ_LANE_HEIGHT_BASE_PX = 20;
    const VIDEO_VIZ_LANE_HEIGHT_SCALE_MAX = 2;
    let waveformLaneHeightScale = 1;

    function clampWaveformLaneHeightScale(scale) {
        const n = Number(scale);
        if (!Number.isFinite(n)) return WAVEFORM_LANE_HEIGHT_SCALE_MIN;
        return Math.max(
            WAVEFORM_LANE_HEIGHT_SCALE_MIN,
            Math.min(WAVEFORM_LANE_HEIGHT_SCALE_MAX, n),
        );
    }

    function snapWaveformLaneHeightScale(scale) {
        const c = clampWaveformLaneHeightScale(scale);
        const steps = Math.round((c - WAVEFORM_LANE_HEIGHT_SCALE_MIN) / WAVEFORM_LANE_HEIGHT_SCALE_STEP);
        return clampWaveformLaneHeightScale(
            WAVEFORM_LANE_HEIGHT_SCALE_MIN + steps * WAVEFORM_LANE_HEIGHT_SCALE_STEP,
        );
    }

    function getWaveformLaneHeightScale() {
        return waveformLaneHeightScale;
    }

    function waveformLaneHeightScaleHintLabel(scale) {
        return Math.round(snapWaveformLaneHeightScale(scale) * 100) + '%';
    }

    function getWaveformLaneHeightCss() {
        return Math.max(1, Math.round(WAVEFORM_LANE_HEIGHT_BASE_PX * waveformLaneHeightScale));
    }

    function getVideoVizLaneHeightScale() {
        const waveSpan = WAVEFORM_LANE_HEIGHT_SCALE_MAX - WAVEFORM_LANE_HEIGHT_SCALE_MIN;
        const raw =
            WAVEFORM_LANE_HEIGHT_SCALE_MIN +
            ((waveformLaneHeightScale - WAVEFORM_LANE_HEIGHT_SCALE_MIN) / waveSpan) *
                (VIDEO_VIZ_LANE_HEIGHT_SCALE_MAX - WAVEFORM_LANE_HEIGHT_SCALE_MIN);
        return Math.min(VIDEO_VIZ_LANE_HEIGHT_SCALE_MAX, raw);
    }

    function getVideoVizLaneHeightCss() {
        return Math.max(
            1,
            Math.round(VIDEO_VIZ_LANE_HEIGHT_BASE_PX * getVideoVizLaneHeightScale()),
        );
    }

    function getMusicalLaneHeightCss() {
        const composite =
            typeof audioWaveformComposite !== 'undefined' && audioWaveformComposite
                ? audioWaveformComposite
                : document.getElementById('audioWaveformComposite');
        if (composite) {
            const raw = getComputedStyle(composite).getPropertyValue('--musical-lane-h').trim();
            if (raw.endsWith('px')) {
                const n = parseFloat(raw);
                if (n > 0) return n;
            }
        }
        return 20;
    }

    window.getMusicalLaneHeightCss = getMusicalLaneHeightCss;

    function resolveWaveformTrackHeightCss() {
        return getWaveformLaneHeightCss();
    }

    function applyWaveformLaneHeightScaleToDom() {
        const val = String(waveformLaneHeightScale);
        document.documentElement.style.setProperty('--wave-lane-height-scale', val);
        document.documentElement.style.removeProperty('--wave-lane-h');
        if (typeof audioWaveformComposite !== 'undefined' && audioWaveformComposite) {
            audioWaveformComposite.style.setProperty('--wave-lane-height-scale', val);
            audioWaveformComposite.style.removeProperty('--wave-lane-h');
        }
    }

    let lastWaveformCompositeLaneCount = null;

    function refreshWaveformLaneHeightLayout() {
        applyWaveformLaneHeightScaleToDom();
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
    }

    function flashWaveformLaneHeightScaleHint(scale, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.silent) return;
        if (typeof flashSeekHint !== 'function') return;
        flashSeekHint('Track-H', waveformLaneHeightScaleHintLabel(scale), 'notice');
    }

    function setWaveformLaneHeightScale(nextScale, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const z = snapWaveformLaneHeightScale(nextScale);
        const changed = Math.abs(z - waveformLaneHeightScale) >= 0.001;
        waveformLaneHeightScale = z;
        if (changed && o.persist !== false && typeof writePrefs === 'function') {
            writePrefs();
        }
        refreshWaveformLaneHeightLayout();
        if (changed) {
            flashWaveformLaneHeightScaleHint(z, o);
        } else if (!o.silent) {
            flashWaveformLaneHeightScaleHint(z, o);
        }
        return true;
    }

    function stepWaveformLaneHeightScale(dir) {
        const d = dir > 0 ? 1 : dir < 0 ? -1 : 0;
        if (!d) return waveformLaneHeightScale;
        return snapWaveformLaneHeightScale(
            waveformLaneHeightScale + d * WAVEFORM_LANE_HEIGHT_SCALE_STEP,
        );
    }

    function applyUserWaveformLaneHeightFromStorage(prefs) {
        const p = prefs && typeof prefs === 'object' ? prefs : {};
        const scale =
            typeof p.waveformLaneHeightScale === 'number'
                ? p.waveformLaneHeightScale
                : WAVEFORM_LANE_HEIGHT_SCALE_MIN;
        waveformLaneHeightScale = snapWaveformLaneHeightScale(scale);
        applyWaveformLaneHeightScaleToDom();
    }

    /** セッション復元・波形再描画時に prefs と DOM の倍率を同期（レイアウト全体は走らせない） */
    function reapplyUserWaveformLaneHeightFromStorage() {
        if (typeof readPrefs === 'function') {
            applyUserWaveformLaneHeightFromStorage(readPrefs());
        } else {
            applyWaveformLaneHeightScaleToDom();
        }
    }

    /** 表示中のレーン数に合わせてグリッド高さとコメントラベル帯位置を更新 */
    function refreshWaveformCompositeLaneLayout(opt) {
        const composite =
            typeof audioWaveformComposite !== 'undefined' && audioWaveformComposite
                ? audioWaveformComposite
                : document.getElementById('audioWaveformComposite');
        if (!composite) return;
        const o = opt && typeof opt === 'object' ? opt : {};
        applyWaveformLaneHeightScaleToDom();
        if (typeof syncWaveformLanesViewportWidthCss === 'function') {
            syncWaveformLanesViewportWidthCss();
        }
        ensureLaneScrubHitLayers();
        const metas = [videoVizMeta, audioWaveformPanel];
        for (let i = 0; i < extraTrackSlotCount(); i++) {
            metas.push(document.getElementById('extraAudioMeta' + i));
        }
        let videoVizCount = 0;
        let waveCount = 0;
        for (let i = 0; i < metas.length; i++) {
            const meta = metas[i];
            if (!meta || meta.hidden) continue;
            if (meta === videoVizMeta) {
                if (typeof isVideoVizLaneShown === 'function' && !isVideoVizLaneShown()) continue;
                videoVizCount += 1;
            } else {
                waveCount += 1;
            }
        }
        waveCount = Math.max(1, waveCount);
        const laneCount = videoVizCount + waveCount;
        lastWaveformCompositeLaneCount = laneCount;
        composite.style.setProperty('--video-viz-lane-count', String(videoVizCount));
        composite.style.setProperty('--wave-lane-count', String(waveCount));
        composite.style.setProperty(
            '--musical-lane-count',
            String(typeof getMusicalTrackLaneCount === 'function' ? getMusicalTrackLaneCount() : 3),
        );
        syncVisibleWaveformLaneGridRows();
        syncTimelineOverlayGridPlacement(laneCount);

        requestAnimationFrame(() => {
            const laneH = getWaveformLaneHeightCss();
            const videoVizLaneH =
                typeof getVideoVizLaneHeightCss === 'function'
                    ? getVideoVizLaneHeightCss()
                    : VIDEO_VIZ_LANE_HEIGHT_BASE_PX;
            const audioLaneH = videoVizCount * videoVizLaneH + waveCount * laneH;
            const laneIds = ['videoVizLane', 'audioWaveformLaneVideo'];
            for (let i = 0; i < extraTrackSlotCount(); i++) {
                laneIds.push('extraAudioLane' + i);
            }
            if (audioWaveformMarkerLabels) {
                audioWaveformMarkerLabels.style.top = '0px';
                audioWaveformMarkerLabels.style.height = audioLaneH + 'px';
            }
            const refreshLaneOverlays = () => {
                if (typeof refreshAllRegionMusicalMetaPresentation === 'function') {
                    refreshAllRegionMusicalMetaPresentation();
                } else if (typeof refreshAllRegionPitchGainOverlay === 'function') {
                    refreshAllRegionPitchGainOverlay();
                    if (typeof refreshAllRegionRehearsalMarkLabels === 'function') {
                        refreshAllRegionRehearsalMarkLabels();
                    }
                }
                if (typeof renderAudioWaveformMarkers === 'function') {
                    renderAudioWaveformMarkers();
                }
                if (typeof refreshVideoVizRegionThumbnails === 'function') {
                    refreshVideoVizRegionThumbnails();
                }
            };
            refreshLaneOverlays();
            requestAnimationFrame(refreshLaneOverlays);
            if (typeof drawSeekPlaybackTrail === 'function') drawSeekPlaybackTrail();
            if (typeof scheduleMusicalGridRedraw === 'function') scheduleMusicalGridRedraw();
            if (typeof refreshMusicalGridTracks === 'function') refreshMusicalGridTracks();
            if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
            if (typeof redrawAllExtraTrackWaveforms === 'function') {
                redrawAllExtraTrackWaveforms();
            }
            refreshAudioWaveformCompositeLoadedState();
            if (typeof syncAllTrackWaveformLoading === 'function') {
                syncAllTrackWaveformLoading();
            }
            if (typeof scheduleWaveformRegionOverlayRefresh === 'function') {
                scheduleWaveformRegionOverlayRefresh();
            }
        });
    }

    const VIDEO_WAVEFORM_LAYOUT_MIN_CSS = 32;

    function isVideoWaveformPlacementReady() {
        if (!urlMain) return true;
        if (containerHasAudio.main === false) return true;
        const status = audioWaveformStatus ? audioWaveformStatus.textContent || '' : '';
        if (status === 'No audio track' || status === 'Waveform unavailable') return true;
        if (/too large/i.test(status)) return true;
        if (waveformDecodeInFlight) return false;
        if (!waveformPeaks || waveformPeaks.length < 1) return false;
        const laneW =
            typeof waveformTimelineViewportWidthCss === 'function'
                ? waveformTimelineViewportWidthCss()
                : typeof rawMasterTimelineWidthCss === 'function'
                  ? rawMasterTimelineWidthCss()
                  : 0;
        if (laneW < VIDEO_WAVEFORM_LAYOUT_MIN_CSS) return false;
        if (!audioWaveformCanvas) return false;
        const styleW = parseFloat(audioWaveformCanvas.style.width) || 0;
        if (styleW < VIDEO_WAVEFORM_LAYOUT_MIN_CSS) return false;
        if (
            typeof audioWaveformTrack !== 'undefined' &&
            audioWaveformTrack &&
            typeof isWaveformTrackLkfsReady === 'function' &&
            !isWaveformTrackLkfsReady(audioWaveformTrack)
        ) {
            return false;
        }
        return true;
    }

    window.restoreVideoAudioLaneForNewVideo = restoreVideoAudioLaneForNewVideo;
    window.isVideoAudioLaneShown = isVideoAudioLaneShown;
    window.dismissVideoAudioLane = dismissVideoAudioLane;
    window.refreshVideoAudioLaneVisibility = refreshVideoAudioLaneVisibility;
    window.notifyVideoAudioLoadSettledIfNoVideoAudio = notifyVideoAudioLoadSettledIfNoVideoAudio;
    window.refreshWaveformCompositeLaneLayout = refreshWaveformCompositeLaneLayout;
    window.getWaveformLaneHeightScale = getWaveformLaneHeightScale;
    window.getWaveformLaneHeightCss = getWaveformLaneHeightCss;
    window.getVideoVizLaneHeightCss = getVideoVizLaneHeightCss;
    window.setWaveformLaneHeightScale = setWaveformLaneHeightScale;
    window.stepWaveformLaneHeightScale = stepWaveformLaneHeightScale;
    window.applyUserWaveformLaneHeightFromStorage = applyUserWaveformLaneHeightFromStorage;
    window.applyWaveformLaneHeightScaleToDom = applyWaveformLaneHeightScaleToDom;
    window.reapplyUserWaveformLaneHeightFromStorage = reapplyUserWaveformLaneHeightFromStorage;
