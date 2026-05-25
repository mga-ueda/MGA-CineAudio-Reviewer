    let waveformPeaks = null;
    let waveformAudioBuffer = null;
    let waveformBuildGen = 0;
    let waveformResizeObs = null;
    let waveformMetaListener = null;
    let waveformOffsetDragActive = false;
    let waveformOffsetDragSlot = -1;
    let waveformOffsetDragPointerId = null;
    let waveformOffsetDragStartClientX = 0;
    let waveformOffsetDragStartTimelineSec = 0;
    let waveformOffsetDragPreserveInPadSec = 0;
    let waveformOffsetDragStartAnchorSec = 0;
    let waveformOffsetDragDocMove = null;
    let waveformOffsetDragDocUp = null;
    let waveformPointerGestureId = null;
    let waveformPointerGestureStartX = 0;
    let waveformPointerGestureStartY = 0;
    let waveformPointerGestureDidMove = false;
    let waveformPointerGestureRegionHit = null;
    let waveformPointerGestureDocMove = null;
    let waveformPointerGestureDocUp = null;
    const WAVEFORM_POINTER_GESTURE_DRAG_PX = 5;
    let waveformLanesLastPointerX = null;
    let waveformLanesLastPointerY = null;
    let waveformTargetExtraSlot = -1;
    /** ミックス対象として最後にアクティブだった Ex スロット（スプリット等のフォールバック） */
    let lastActiveMixExtraSlot = -1;
    let waveformBuildTimer = 0;
    let waveformLoadKickTimer = 0;
    let waveformDecodeInFlight = false;
    let waveformPresenceWatchTimer = 0;
    let waveformPresenceWatchGen = 0;
    let waveformPauseBuildListener = null;
    const WAVEFORM_PRESENCE_WATCH_INTERVAL_MS = 1500;
    const WAVEFORM_PRESENCE_WATCH_MAX_TRIES = 40;
    const WAVEFORM_PRESENCE_WATCH_FIRST_MS = 300;
    /** MP4 は先頭スライスでは decode できないため、フルファイルのみ（上限あり） */
    const WAVEFORM_DECODE_MAX_BYTES = 1024 * 1024 * 1024;
    const WAVEFORM_DECODE_TIMEOUT_MS = 90000;
    const WAVEFORM_BG_BUILD_DELAY_MS = 3500;

    function yieldToBrowser() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

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
            showAppAlert(title, body);
        } else {
            window.alert(title + '\n\n' + body);
        }
        setAudioWaveformLoaded(true);
        setAudioWaveformStatus('Too large (max ' + limitMb + ' MB)');
        drawAudioWaveformCanvas();
        if (audioWaveformPlayheadWrap) audioWaveformPlayheadWrap.hidden = true;
        notifyVideoAudioLoadSettled();
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
            titleEl.title = tip ? slotLabel + ' — ' + tip : slotLabel;
        }
        if (typeof refreshVideoAudioLaneFileName === 'function') {
            refreshVideoAudioLaneFileName();
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

    function containerReportsVideoAudioTrack() {
        return containerHasAudio.main === true;
    }

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

    function mainVideoHasAudioTrack() {
        return containerReportsVideoAudioTrack();
    }

    /** 新規動画読み込み時に Video Audio 枠を再表示可能にする */
    function restoreVideoAudioLaneForNewVideo() {
        videoLaneUiOpen = true;
        if (!refreshingVideoAudioLaneVisibility) {
            refreshVideoAudioLaneVisibility();
        }
    }

    /** @deprecated 互換: 枠を開いて visibility を更新 */
    function showVideoAudioLane() {
        restoreVideoAudioLaneForNewVideo();
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
        if (typeof refreshVideoAudioLaneFileName === 'function') {
            refreshVideoAudioLaneFileName();
        }
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
        return typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 3;
    }

    function countVisibleWaveformLanes() {
        const metas = [audioWaveformPanel];
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
        if (typeof refreshVideoAudioLaneFileName === 'function') {
            refreshVideoAudioLaneFileName();
        }
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
    }

    /**
     * 表示中のレーン（Video + Ex）に 1 から連番の grid-row を割り当てる。
     * 固定 CSS（Ex1=1, Ex2=2…）のまま途中スロットを閉じると行数とずれて波形が画面外になる。
     */
    function syncVisibleWaveformLaneGridRows() {
        if (!audioWaveformComposite) return;
        let row = 1;
        const assignRow = (meta, lane, show) => {
            const rowStr = show ? String(row) : '';
            if (meta) meta.style.gridRow = rowStr;
            if (lane) lane.style.gridRow = rowStr;
            if (show) row += 1;
        };
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
    }

    /** マーカー・プレイヘッド等を全レーン上に重ねる（レーンのみ grid-row 指定時の押し出し防止） */
    function syncTimelineOverlayGridPlacement(laneCount) {
        const n = Math.max(1, laneCount | 0);
        const span = '1 / ' + (n + 1);
        const overlays = [
            audioWaveformMarkers,
            audioWaveformMarkerLabels,
            audioWaveformRangeLoop,
            audioWaveformSeekTrail,
            audioWaveformPlayheadWrap,
            audioWaveformHoverPlayhead,
        ];
        for (let i = 0; i < overlays.length; i++) {
            const el = overlays[i];
            if (!el) continue;
            el.style.gridRow = span;
            el.style.gridColumn = '1';
        }
    }

    /** 表示中のレーン数に合わせてグリッド高さとコメントラベル帯位置を更新 */
    function refreshWaveformCompositeLaneLayout() {
        if (!audioWaveformComposite) return;
        ensureLaneScrubHitLayers();
        const metas = [audioWaveformPanel];
        for (let i = 0; i < extraTrackSlotCount(); i++) {
            metas.push(document.getElementById('extraAudioMeta' + i));
        }
        let count = 0;
        for (let i = 0; i < metas.length; i++) {
            if (metas[i] && !metas[i].hidden) count += 1;
        }
        const laneCount = Math.max(1, count);
        audioWaveformComposite.style.setProperty('--wave-lane-count', String(laneCount));
        syncVisibleWaveformLaneGridRows();
        syncTimelineOverlayGridPlacement(laneCount);

        requestAnimationFrame(() => {
            const laneH =
                parseFloat(
                    getComputedStyle(audioWaveformComposite).getPropertyValue('--wave-lane-h'),
                ) || 92;
            const laneIds = ['audioWaveformLaneVideo'];
            for (let i = 0; i < extraTrackSlotCount(); i++) {
                laneIds.push('extraAudioLane' + i);
            }
            let firstTop = 0;
            for (let i = 0; i < laneIds.length; i++) {
                const lane = document.getElementById(laneIds[i]);
                if (lane && !lane.hidden) {
                    firstTop = lane.offsetTop;
                    break;
                }
            }
            audioWaveformComposite.style.setProperty('--marker-labels-top', firstTop + 'px');
            if (audioWaveformMarkerLabels) {
                audioWaveformMarkerLabels.style.top = firstTop + 'px';
                audioWaveformMarkerLabels.style.height = laneH + 'px';
            }
            if (typeof drawSeekPlaybackTrail === 'function') drawSeekPlaybackTrail();
            if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
            if (typeof redrawAllExtraTrackWaveforms === 'function') {
                redrawAllExtraTrackWaveforms();
            }
            if (typeof renderAudioWaveformMarkers === 'function') {
                renderAudioWaveformMarkers();
            }
            refreshAudioWaveformCompositeLoadedState();
        });
    }

    window.showVideoAudioLane = showVideoAudioLane;
    window.restoreVideoAudioLaneForNewVideo = restoreVideoAudioLaneForNewVideo;
    window.isVideoAudioLaneShown = isVideoAudioLaneShown;
    window.dismissVideoAudioLane = dismissVideoAudioLane;
    window.refreshVideoAudioLaneVisibility = refreshVideoAudioLaneVisibility;
    window.notifyVideoAudioLoadSettledIfNoVideoAudio = notifyVideoAudioLoadSettledIfNoVideoAudio;
    window.refreshWaveformCompositeLaneLayout = refreshWaveformCompositeLaneLayout;

    function getWaveformAudioDurationSec() {
        if (waveformAudioBuffer && waveformAudioBuffer.duration > 0) {
            return waveformAudioBuffer.duration;
        }
        return getVideoTransportDurationSec();
    }

    function getMainVideoAudioBuffer() {
        return waveformAudioBuffer && waveformAudioBuffer.duration > 0.002
            ? waveformAudioBuffer
            : null;
    }

    function getMainWaveformPeaksForDraw() {
        return waveformPeaks;
    }

    window.getWaveformAudioDurationSec = getWaveformAudioDurationSec;
    window.getMainVideoAudioBuffer = getMainVideoAudioBuffer;
    window.getMainWaveformPeaksForDraw = getMainWaveformPeaksForDraw;

    function isAudioWaveformScrubActive() {
        return waveformOffsetDragActive || waveformPointerGestureId != null;
    }

    function detachWaveformOffsetDragDocListeners() {
        if (waveformOffsetDragDocMove) {
            document.removeEventListener('pointermove', waveformOffsetDragDocMove);
            waveformOffsetDragDocMove = null;
        }
        if (waveformOffsetDragDocUp) {
            document.removeEventListener('pointerup', waveformOffsetDragDocUp);
            document.removeEventListener('pointercancel', waveformOffsetDragDocUp);
            waveformOffsetDragDocUp = null;
        }
    }

    function endWaveformTrackOffsetDrag(opt) {
        if (!waveformOffsetDragActive && !(opt && opt.force)) return;
        detachWaveformOffsetDragDocListeners();
        waveformOffsetDragActive = false;
        waveformOffsetDragSlot = -1;
        waveformOffsetDragSegmentIndex = -1;
        waveformOffsetDragPointerId = null;
        const lanes = waveformScrubTargetEl();
        if (lanes) lanes.classList.remove('audio-waveform-composite__lanes--offset-drag');
    }

    function waveformExtraLaneSlotFromTarget(target) {
        if (!target || !target.closest) return -1;
        const lane = target.closest('.audio-waveform-lane--extra');
        if (!lane || !lane.id) return -1;
        const m = /^extraAudioLane(\d+)$/.exec(lane.id);
        return m ? parseInt(m[1], 10) : -1;
    }

    function waveformExtraLaneSlotFromClientY(clientY) {
        const lanes = waveformScrubTargetEl();
        if (!lanes || !Number.isFinite(clientY)) return -1;
        const laneEls = lanes.querySelectorAll('.audio-waveform-lane--extra');
        for (let i = 0; i < laneEls.length; i++) {
            const lane = laneEls[i];
            if (lane.hidden) continue;
            const rect = lane.getBoundingClientRect();
            if (clientY >= rect.top && clientY <= rect.bottom) {
                const m = /^extraAudioLane(\d+)$/.exec(lane.id);
                if (m) return parseInt(m[1], 10);
            }
        }
        return -1;
    }

    window.waveformExtraLaneSlotFromClientY = waveformExtraLaneSlotFromClientY;

    /** ポインタ Y 座標直下のミックス対象レーン（Video / Ex）。リージョンは見ない。 */
    function resolveMixTargetFromPointer(clientY) {
        if (!Number.isFinite(clientY)) return null;
        const videoLane = document.getElementById('audioWaveformLaneVideo');
        if (videoLane && !videoLane.hidden) {
            const rect = videoLane.getBoundingClientRect();
            if (clientY >= rect.top && clientY <= rect.bottom) {
                return { kind: 'video' };
            }
        }
        const slot = waveformExtraLaneSlotFromClientY(clientY);
        if (slot >= 0) return { kind: 'extra', slot };
        return null;
    }

    window.resolveMixTargetFromPointer = resolveMixTargetFromPointer;

    function isPointerOverVideoAudioLane(clientY) {
        if (!Number.isFinite(clientY)) return false;
        const target = resolveMixTargetFromPointer(clientY);
        return !!(target && target.kind === 'video');
    }

    /** 波形レーン上の直近ポインタが Video Audio 行上か */
    function pointerTargetsVideoAudioLane() {
        let clientY = null;
        if (typeof getWaveformLanesPointerClientY === 'function') {
            clientY = getWaveformLanesPointerClientY();
        }
        if (clientY == null && typeof getWaveformPointerClientY === 'function') {
            clientY = getWaveformPointerClientY();
        }
        return isPointerOverVideoAudioLane(clientY);
    }

    window.isPointerOverVideoAudioLane = isPointerOverVideoAudioLane;
    window.pointerTargetsVideoAudioLane = pointerTargetsVideoAudioLane;

    function isMixLaneTargetMatch(entry, target) {
        if (!target || !entry || !entry.el || entry.el.hidden) return false;
        if (target.kind === 'video') return entry.kind === 'video';
        if (target.kind === 'extra') {
            return entry.kind === 'extra' && entry.slot === target.slot;
        }
        return false;
    }

    function forEachWaveformLaneMeta(onMeta) {
        if (audioWaveformPanel) {
            onMeta({ kind: 'video', el: audioWaveformPanel });
        }
        for (let slot = 0; slot < extraTrackSlotCount(); slot++) {
            const meta = document.getElementById('extraAudioMeta' + slot);
            if (meta) onMeta({ kind: 'extra', slot, el: meta });
        }
    }

    function refreshActiveMixLaneHighlight(clientY) {
        const target =
            Number.isFinite(clientY) && typeof resolveMixTargetFromPointer === 'function'
                ? resolveMixTargetFromPointer(clientY)
                : null;
        if (target && target.kind === 'extra') {
            lastActiveMixExtraSlot = target.slot;
        }
        forEachWaveformLaneMeta((entry) => {
            entry.el.classList.toggle(
                'audio-waveform-lane-meta--active',
                isMixLaneTargetMatch(entry, target),
            );
        });
    }

    function getLastActiveMixExtraSlot() {
        return lastActiveMixExtraSlot;
    }

    window.refreshActiveMixLaneHighlight = refreshActiveMixLaneHighlight;
    window.getLastActiveMixExtraSlot = getLastActiveMixExtraSlot;

    /** マーカー帯の上でも Y 座標で Ex レーンを判定 */
    function waveformExtraLaneSlotFromPointer(ev) {
        if (!ev) return -1;
        const slot = waveformExtraLaneSlotFromTarget(ev.target);
        if (slot >= 0) return slot;
        const lanes = waveformScrubTargetEl();
        if (!lanes || !ev.target || !lanes.contains(ev.target)) return -1;
        return waveformExtraLaneSlotFromClientY(ev.clientY);
    }

    function canDragWaveformTrackTimelineStart(slot) {
        return (
            slot >= 0 &&
            typeof isExtraTrackLoaded === 'function' &&
            isExtraTrackLoaded(slot) &&
            typeof setExtraTrackTimelineStartSec === 'function'
        );
    }

    function timelineSecDeltaFromClientXDelta(clientX, startClientX) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const el = typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        const m =
            typeof waveformTimelineMetrics === 'function' ? waveformTimelineMetrics(el) : null;
        if (!master || !m || !m.scrubW) return 0;
        return ((clientX - startClientX) / m.scrubW) * master;
    }

    function waveformMarkerSnapThresholdSec() {
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const el = typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        const m =
            typeof waveformTimelineMetrics === 'function' ? waveformTimelineMetrics(el) : null;
        if (!master || !m || !m.scrubW) {
            return Math.max(step * 6, 0.05);
        }
        const SNAP_PX = 14;
        return Math.max(step, (SNAP_PX / m.scrubW) * master);
    }

    function snapWaveformTimelineStartSec(sec) {
        if (typeof snapSecToMarkerInOut !== 'function') return sec;
        return snapSecToMarkerInOut(sec, { thresholdSec: waveformMarkerSnapThresholdSec() });
    }

    function applyWaveformTimelineStartFromDrag(slot, sec, opt) {
        if (typeof applyRegionTrackTimelineStart === 'function') {
            applyRegionTrackTimelineStart(slot, sec, opt);
            return;
        }
        const snapped = snapWaveformTimelineStartSec(sec);
        if (typeof setExtraTrackTimelineStartSec === 'function') {
            setExtraTrackTimelineStartSec(slot, snapped, opt);
        }
    }

    function detachWaveformPointerGestureDocListeners() {
        if (waveformPointerGestureDocMove) {
            document.removeEventListener('pointermove', waveformPointerGestureDocMove);
            waveformPointerGestureDocMove = null;
        }
        if (waveformPointerGestureDocUp) {
            document.removeEventListener('pointerup', waveformPointerGestureDocUp);
            document.removeEventListener('pointercancel', waveformPointerGestureDocUp);
            waveformPointerGestureDocUp = null;
        }
    }

    function cancelWaveformPointerGesture() {
        detachWaveformPointerGestureDocListeners();
        waveformPointerGestureId = null;
        waveformPointerGestureRegionHit = null;
        waveformPointerGestureDidMove = false;
    }

    /** Ex トラック先頭オフセット位置（ビューポート X）。ピクセル基準で空白判定に使う */
    function extraTrackTimelineStartClientX(slot) {
        if (!Number.isFinite(slot) || slot < 0) return null;
        const lanes = waveformScrubTargetEl();
        const m =
            typeof waveformTimelineMetrics === 'function'
                ? waveformTimelineMetrics(lanes)
                : null;
        if (!m || !m.scrubW) return null;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const t0 =
            typeof getTrackTimelineStartSec === 'function'
                ? getTrackTimelineStartSec({ type: 'extra', slot })
                : typeof getExtraTrackTimelineStartSec === 'function'
                  ? getExtraTrackTimelineStartSec(slot)
                  : 0;
        if (!(master > 0) || !(t0 > 0.0005)) return null;
        const inner =
            typeof waveformTimelineInnerEl === 'function' ? waveformTimelineInnerEl() : null;
        const ref = inner || lanes;
        if (!ref) return null;
        return ref.getBoundingClientRect().left + (t0 / master) * m.scrubW;
    }

    /** トラック開始より前のタイムライン空白（オフセット後の左側）か */
    function clickIsInPreTrackTimelineGap(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        const slot = waveformExtraLaneSlotFromClientY(clientY);
        if (slot < 0) return false;
        const x0 = extraTrackTimelineStartClientX(slot);
        if (x0 != null && clientX < x0 - 1) return true;
        const sec =
            typeof transportSecFromClientX === 'function'
                ? transportSecFromClientX(clientX)
                : null;
        if (!Number.isFinite(sec)) return false;
        const t0 =
            typeof getTrackTimelineStartSec === 'function'
                ? getTrackTimelineStartSec({ type: 'extra', slot })
                : typeof getExtraTrackTimelineStartSec === 'function'
                  ? getExtraTrackTimelineStartSec(slot)
                  : 0;
        return sec < t0 - 0.0005;
    }

    function shouldSkipWaveformPointerGesture(ev) {
        if (!ev || ev.button !== 0) return true;
        if (ev.ctrlKey || ev.altKey || ev.metaKey) return true;
        if (clickIsInPreTrackTimelineGap(ev.clientX, ev.clientY)) return false;
        const t = ev.target;
        if (!t || !t.closest) return true;
        if (t.closest('.seek-bar-marker')) return true;
        if (t.closest('.audio-waveform-composite__seek-input')) return true;
        if (
            typeof isPointerOnAnyRegionResizeHandle === 'function' &&
            isPointerOnAnyRegionResizeHandle(ev.clientX, ev.clientY)
        ) {
            return true;
        }
        const regionHandle = t.closest('.audio-waveform-lane__playback-region__handle');
        if (regionHandle) {
            if (clickIsInPreTrackTimelineGap(ev.clientX, ev.clientY)) return false;
            if (
                regionHandle.classList.contains(
                    'audio-waveform-lane__playback-region__handle--split',
                )
            ) {
                return true;
            }
            const region = regionHandle.closest('.audio-waveform-lane__playback-region');
            if (
                region &&
                typeof isPointerOnRegionResizeHandle === 'function' &&
                !isPointerOnRegionResizeHandle(region, ev.clientX)
            ) {
                return false;
            }
            return true;
        }
        return false;
    }

    function finishWaveformPointerSeek(ev) {
        if (!ev || !Number.isFinite(ev.clientX)) return;
        isSeeking = true;
        seekFromWaveformPointer(ev.clientX, { logInput: true, flash: true });
        const t =
            typeof getTransportSec === 'function'
                ? getTransportSec()
                : parseFloat(seekBar.value) || 0;
        if (typeof transportPlaybackSec !== 'undefined') {
            transportPlaybackSec = t;
            transportPlaybackLastTs = performance.now();
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (typeof updateAllWaveformPlayheads === 'function') updateAllWaveformPlayheads();
        setHoverPlayheadAtClientX(ev.clientX, ev.clientY);
        writeLog('Waveform: seek at ' + formatTimecodeForTransport(t));
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Seek', formatTimecodeForTransport(t));
        }
        isSeeking = false;
        updateSeekUiFromVideo();
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
    }

    function onWaveformLanesPointerDownCapture(ev) {
        if (shouldSkipWaveformPointerGesture(ev)) return;
        const ready =
            (typeof videoReady === 'function' && videoReady()) ||
            (typeof hasAnyExtraTrackLoaded === 'function' && hasAnyExtraTrackLoaded());
        if (!ready) return;

        const regionHit =
            typeof resolveRegionSegmentFromPointer === 'function'
                ? resolveRegionSegmentFromPointer(ev.clientX, ev.clientY)
                : null;

        cancelWaveformPointerGesture();
        isSeeking = true;
        waveformPointerGestureId = ev.pointerId;
        waveformPointerGestureStartX = ev.clientX;
        waveformPointerGestureStartY = ev.clientY;
        waveformPointerGestureDidMove = false;
        const inPreTrackGap = clickIsInPreTrackTimelineGap(ev.clientX, ev.clientY);
        waveformPointerGestureRegionHit =
            !inPreTrackGap &&
            regionHit &&
            canDragWaveformTrackTimelineStart(regionHit.slot)
                ? regionHit
                : null;

        if (!waveformPointerGestureRegionHit) {
            seekFromWaveformPointer(ev.clientX, { scrubbing: true });
            if (typeof updateAllWaveformPlayheads === 'function') {
                updateAllWaveformPlayheads();
            }
            if (currentTimeEl && typeof formatTimecodeForTransport === 'function') {
                const t =
                    typeof getTransportSec === 'function'
                        ? getTransportSec()
                        : parseFloat(seekBar && seekBar.value) || 0;
                currentTimeEl.textContent = formatTimecodeForTransport(t);
            }
        }

        waveformPointerGestureDocMove = (e) => {
            if (e.pointerId !== waveformPointerGestureId) return;
            const dx = e.clientX - waveformPointerGestureStartX;
            const dy = e.clientY - waveformPointerGestureStartY;
            if (
                dx * dx + dy * dy <=
                WAVEFORM_POINTER_GESTURE_DRAG_PX * WAVEFORM_POINTER_GESTURE_DRAG_PX
            ) {
                return;
            }
            waveformPointerGestureDidMove = true;
            if (waveformPointerGestureRegionHit && !waveformOffsetDragActive) {
                onWaveformTrackOffsetPointerDown(
                    e,
                    waveformPointerGestureRegionHit.slot,
                    waveformPointerGestureRegionHit.segmentIndex,
                );
            } else if (!waveformOffsetDragActive) {
                seekFromWaveformPointer(e.clientX, { scrubbing: true });
                if (typeof updateAllWaveformPlayheads === 'function') {
                    updateAllWaveformPlayheads();
                }
            }
        };
        waveformPointerGestureDocUp = (e) => {
            if (e.pointerId !== waveformPointerGestureId) return;
            if (!waveformOffsetDragActive) {
                finishWaveformPointerSeek(e);
            } else {
                isSeeking = false;
            }
            cancelWaveformPointerGesture();
        };
        document.addEventListener('pointermove', waveformPointerGestureDocMove);
        document.addEventListener('pointerup', waveformPointerGestureDocUp);
        document.addEventListener('pointercancel', waveformPointerGestureDocUp);
    }

    function endAudioWaveformScrub(opt) {
        cancelWaveformPointerGesture();
        endWaveformTrackOffsetDrag(opt);
    }

    let waveformLastHoverClientX = null;
    let waveformLastHoverClientY = null;

    function setHoverPlayheadAtClientX(clientX, clientY) {
        if (audioWaveformHoverPlayhead) audioWaveformHoverPlayhead.hidden = true;
        if (Number.isFinite(clientX)) {
            waveformLastHoverClientX = clientX;
            waveformLastHoverClientY = Number.isFinite(clientY) ? clientY : null;
        }
    }

    function refreshHoverPlayheadFromLastPointer() {
        if (waveformLastHoverClientX == null) return;
        if (!audioWaveformHoverPlayhead || audioWaveformHoverPlayhead.hidden) return;
        setHoverPlayheadAtClientX(waveformLastHoverClientX, waveformLastHoverClientY);
    }

    function hideHoverPlayhead() {
        waveformLastHoverClientX = null;
        waveformLastHoverClientY = null;
        if (audioWaveformHoverPlayhead) audioWaveformHoverPlayhead.hidden = true;
    }

    window.refreshHoverPlayheadFromLastPointer = refreshHoverPlayheadFromLastPointer;

    function getWaveformPointerClientX() {
        return waveformLastHoverClientX;
    }

    function getWaveformPointerClientY() {
        return waveformLastHoverClientY;
    }

    window.getWaveformPointerClientX = getWaveformPointerClientX;
    window.getWaveformPointerClientY = getWaveformPointerClientY;

    function getWaveformLanesPointerClientX() {
        return waveformLanesLastPointerX;
    }

    function getWaveformLanesPointerClientY() {
        return waveformLanesLastPointerY;
    }

    function getWaveformTargetExtraSlot() {
        return waveformTargetExtraSlot;
    }

    window.getWaveformLanesPointerClientX = getWaveformLanesPointerClientX;
    window.getWaveformLanesPointerClientY = getWaveformLanesPointerClientY;
    window.getWaveformTargetExtraSlot = getWaveformTargetExtraSlot;

    function clearAudioWaveform() {
        stopMainVideoWaveformPresenceWatch();
        waveformBuildGen += 1;
        waveformPeaks = null;
        waveformAudioBuffer = null;
        waveformAudioBuffer = null;
        endAudioWaveformScrub({ force: true });
        setAudioWaveformLoaded(false);
        setAudioWaveformStatus('Not Loaded');
        if (audioWaveformPlayheadWrap) audioWaveformPlayheadWrap.hidden = true;
        hideHoverPlayhead();
        if (audioWaveformMarkers) {
            audioWaveformMarkers.replaceChildren();
            audioWaveformMarkers.hidden = true;
        }
        const ctx = audioWaveformCanvas && audioWaveformCanvas.getContext('2d');
        if (ctx && audioWaveformCanvas) {
            ctx.clearRect(0, 0, audioWaveformCanvas.width, audioWaveformCanvas.height);
        }
    }

    function peaksFromAudioBuffer(buffer, barCount) {
        const ch = buffer.getChannelData(0);
        const len = ch.length;
        const bars = Math.max(1, barCount | 0);
        const block = Math.max(1, Math.floor(len / bars));
        const peaks = new Array(bars);
        for (let i = 0; i < bars; i++) {
            const start = i * block;
            const end = Math.min(len, start + block);
            let min = 0;
            let max = 0;
            for (let j = start; j < end; j++) {
                const v = ch[j];
                if (v < min) min = v;
                if (v > max) max = v;
            }
            peaks[i] = { min, max };
        }
        return peaks;
    }

    function syncAudioWaveformCanvasSize() {
        if (!audioWaveformCanvas || !audioWaveformTrack) return null;
        const wCss =
            typeof waveformTimelineScrubWidthCss === 'function'
                ? waveformTimelineScrubWidthCss()
                : typeof masterTimelineWidthCss === 'function'
                  ? masterTimelineWidthCss()
                  : Math.max(1, audioWaveformTrack.clientWidth | 0);
        const hCss = Math.max(1, audioWaveformTrack.clientHeight | 0);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        audioWaveformCanvas.width = Math.max(1, Math.round(wCss * dpr));
        audioWaveformCanvas.height = Math.max(1, Math.round(hCss * dpr));
        audioWaveformCanvas.style.width = wCss + 'px';
        audioWaveformCanvas.style.height = hCss + 'px';
        const ctx = audioWaveformCanvas.getContext('2d');
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { ctx, wCss, hCss, barCount: Math.min(4096, wCss) };
    }

    function drawAudioWaveformCanvas() {
        if (!audioWaveformCanvas) return;
        const sized = syncAudioWaveformCanvasSize();
        if (!sized || !sized.ctx) return;
        const { ctx, wCss, hCss } = sized;
        const contentDur = getWaveformAudioDurationSec();
        const audible =
            typeof isVideoAudioAudible === 'function' ? isVideoAudioAudible() : true;
        const grad =
            typeof timelineWaveformFillGradient === 'function'
                ? timelineWaveformFillGradient(ctx, hCss, 'video', audible)
                : (() => {
                      const g = ctx.createLinearGradient(0, 0, 0, hCss);
                      g.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
                      g.addColorStop(0.5, 'rgba(255, 255, 255, 0.96)');
                      g.addColorStop(1, 'rgba(255, 255, 255, 0.42)');
                      return g;
                  })();
        drawPeaksForMasterTimeline(ctx, waveformPeaks, wCss, hCss, contentDur, grad);
    }

    function seekFromWaveformPointer(clientX, opt) {
        if (typeof applyTransportAtRatio === 'function') {
            applyTransportAtRatio(transportRatioFromClientX(clientX), opt);
        }
    }

    let waveformOffsetDragSegmentIndex = -1;

    function applyWaveformSegmentTimelineStartFromDrag(slot, segmentIndex, sec, opt) {
        if (typeof setSegmentTimelineStartSec === 'function') {
            setSegmentTimelineStartSec(
                { type: 'extra', slot },
                segmentIndex,
                sec,
                Object.assign(
                    {
                        skipPersist: true,
                        forceAudio: true,
                        skipUndo: true,
                        dragStartRegionIn: waveformOffsetDragStartTimelineSec,
                        dragStartAnchor: waveformOffsetDragStartAnchorSec,
                        preserveInPadSec: waveformOffsetDragPreserveInPadSec,
                    },
                    opt || {},
                ),
            );
        }
    }

    function onWaveformTrackOffsetPointerDown(ev, slot, segmentIndex) {
        if (typeof syncSnapSuppressionFromPointerEvent === 'function') {
            syncSnapSuppressionFromPointerEvent(ev);
        }
        endAudioWaveformScrub({ force: true });
        isSeeking = false;
        if (typeof beginRegionUndoGesture === 'function') beginRegionUndoGesture();
        waveformOffsetDragActive = true;
        waveformOffsetDragSlot = slot;
        waveformOffsetDragSegmentIndex =
            typeof segmentIndex === 'number' && segmentIndex >= 0 ? segmentIndex : -1;
        waveformOffsetDragPointerId = ev.pointerId;
        waveformOffsetDragStartClientX = ev.clientX;
        if (waveformOffsetDragSegmentIndex >= 0) {
            waveformOffsetDragStartTimelineSec =
                typeof getSegmentTimelineStartForAltDrag === 'function'
                    ? getSegmentTimelineStartForAltDrag(slot, waveformOffsetDragSegmentIndex)
                    : 0;
            waveformOffsetDragStartAnchorSec =
                typeof getSegmentAnchorForAltDrag === 'function'
                    ? getSegmentAnchorForAltDrag(slot, waveformOffsetDragSegmentIndex)
                    : waveformOffsetDragStartTimelineSec;
            waveformOffsetDragPreserveInPadSec =
                typeof getSegmentRegionInPadForAltDrag === 'function'
                    ? getSegmentRegionInPadForAltDrag(slot, waveformOffsetDragSegmentIndex)
                    : Math.max(
                          0,
                          waveformOffsetDragStartTimelineSec -
                              waveformOffsetDragStartAnchorSec,
                      );
        } else {
            waveformOffsetDragStartTimelineSec =
                typeof getExtraTrackTimelineStartSec === 'function'
                    ? getExtraTrackTimelineStartSec(slot)
                    : 0;
        }
        hideHoverPlayhead();
        const lanes = waveformScrubTargetEl();
        if (lanes) lanes.classList.add('audio-waveform-composite__lanes--offset-drag');
        if (waveformOffsetDragSegmentIndex >= 0) {
            writeLog(
                'Waveform: drag region ' +
                    (waveformOffsetDragSegmentIndex + 1) +
                    ' start (Ex ' +
                    (slot + 1) +
                    ')',
            );
        } else {
            writeLog('Waveform: drag track offset start (Ex ' + (slot + 1) + ')');
        }

        waveformOffsetDragDocMove = (e) => {
            if (!waveformOffsetDragActive || e.pointerId !== waveformOffsetDragPointerId) return;
            if (typeof syncSnapSuppressionFromPointerEvent === 'function') {
                syncSnapSuppressionFromPointerEvent(e);
            }
            const delta = timelineSecDeltaFromClientXDelta(
                e.clientX,
                waveformOffsetDragStartClientX,
            );
            const next = waveformOffsetDragStartTimelineSec + delta;
            if (waveformOffsetDragSegmentIndex >= 0) {
                applyWaveformSegmentTimelineStartFromDrag(
                    slot,
                    waveformOffsetDragSegmentIndex,
                    next,
                    { skipPersist: true },
                );
            } else {
                applyWaveformTimelineStartFromDrag(slot, next, { skipPersist: true });
            }
        };
        waveformOffsetDragDocUp = (e) => {
            if (!waveformOffsetDragActive || e.pointerId !== waveformOffsetDragPointerId) return;
            const delta = timelineSecDeltaFromClientXDelta(
                e.clientX,
                waveformOffsetDragStartClientX,
            );
            const next = waveformOffsetDragStartTimelineSec + delta;
            if (waveformOffsetDragSegmentIndex >= 0) {
                applyWaveformSegmentTimelineStartFromDrag(
                    slot,
                    waveformOffsetDragSegmentIndex,
                    next,
                );
            } else {
                applyWaveformTimelineStartFromDrag(slot, next);
            }
            const t =
                waveformOffsetDragSegmentIndex >= 0 &&
                typeof getSegmentTimelineStartForAltDrag === 'function'
                    ? getSegmentTimelineStartForAltDrag(slot, waveformOffsetDragSegmentIndex)
                    : typeof getExtraTrackTimelineStartSec === 'function'
                      ? getExtraTrackTimelineStartSec(slot)
                      : 0;
            endWaveformTrackOffsetDrag({ force: true, event: e });
            setHoverPlayheadAtClientX(e.clientX, e.clientY);
            const tc =
                typeof formatTimecodeForTransport === 'function'
                    ? formatTimecodeForTransport(t)
                    : t.toFixed(2) + ' s';
            if (waveformOffsetDragSegmentIndex >= 0) {
                writeLog(
                    'Waveform: Ex ' +
                        (slot + 1) +
                        ' region ' +
                        (waveformOffsetDragSegmentIndex + 1) +
                        ' at ' +
                        tc,
                );
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint('Region start', tc);
                }
            } else {
                writeLog('Waveform: Ex ' + (slot + 1) + ' audio start at ' + tc);
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint('Audio start', tc);
                }
            }
            if (typeof commitRegionUndoGesture === 'function') commitRegionUndoGesture();
            if (typeof schedulePersistSession === 'function') schedulePersistSession();
        };
        document.addEventListener('pointermove', waveformOffsetDragDocMove);
        document.addEventListener('pointerup', waveformOffsetDragDocUp);
        document.addEventListener('pointercancel', waveformOffsetDragDocUp);
    }

    function onWaveformPointerMove(ev) {
        if (waveformOffsetDragActive) return;
        setHoverPlayheadAtClientX(ev.clientX, ev.clientY);
    }

    function clipAudioBufferToDuration(buffer, maxSec) {
        if (!buffer || !(maxSec > 0)) return buffer;
        const maxLen = Math.min(buffer.length, Math.ceil(maxSec * buffer.sampleRate));
        if (maxLen >= buffer.length) return buffer;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return buffer;
        const ctx = new Ctx();
        try {
            const out = ctx.createBuffer(buffer.numberOfChannels, maxLen, buffer.sampleRate);
            for (let c = 0; c < buffer.numberOfChannels; c++) {
                out.copyToChannel(buffer.getChannelData(c).subarray(0, maxLen), c, 0);
            }
            return out;
        } catch (_) {
            return buffer;
        } finally {
            try {
                if (typeof ctx.close === 'function') ctx.close();
            } catch (_) {}
        }
    }

    async function readArrayBufferForWaveformDecode() {
        if (fileMain && typeof fileMain.arrayBuffer === 'function') {
            const n = fileMain.size || 0;
            if (n > WAVEFORM_DECODE_MAX_BYTES) {
                throw new Error(
                    'file too large (' + Math.round(n / (1024 * 1024)) + ' MB; max ' +
                        Math.round(WAVEFORM_DECODE_MAX_BYTES / (1024 * 1024)) +
                        ' MB)'
                );
            }
            setAudioWaveformStatus('Reading audio…');
            await yieldToBrowser();
            return await fileMain.arrayBuffer();
        }
        const res = await fetch(urlMain);
        if (!res.ok) throw new Error('fetch failed');
        const ab = await res.arrayBuffer();
        if (ab.byteLength > WAVEFORM_DECODE_MAX_BYTES) {
            const e = new Error('blob too large for waveform decode');
            e.byteLength = ab.byteLength;
            throw e;
        }
        return ab;
    }

    function decodeArrayBufferToAudioBuffer(ctx, ab) {
        const copy = ab.slice(0);
        return Promise.race([
            ctx.decodeAudioData(copy),
            new Promise((_, reject) => {
                setTimeout(
                    () => reject(new Error('decodeAudioData timeout')),
                    WAVEFORM_DECODE_TIMEOUT_MS
                );
            }),
        ]);
    }

    async function buildAudioWaveformForCurrentVideo() {
        const gen = ++waveformBuildGen;
        if (!urlMain) {
            clearAudioWaveform();
            return;
        }
        if (!videoReady()) {
            scheduleWaveformBuildRetryIfNeeded();
            return;
        }
        waveformDecodeInFlight = true;
        if (containerHasAudio.main === false) {
            waveformDecodeInFlight = false;
            waveformPeaks = null;
            setAudioWaveformLoaded(false);
            setAudioWaveformStatus('Not Loaded');
            drawAudioWaveformCanvas();
            updateAllWaveformPlayheads();
            if (typeof renderAudioWaveformMarkers === 'function') renderAudioWaveformMarkers();
            showExtraLaneForNoVideoAudio();
            notifyVideoAudioLoadSettled();
            return;
        }

        if (fileMain && fileMain.size > WAVEFORM_DECODE_MAX_BYTES) {
            waveformDecodeInFlight = false;
            reportWaveformFileTooLarge(fileMain.size);
            return;
        }

        setAudioWaveformLoaded(true);
        setAudioWaveformStatus('Decoding audio…');
        await yieldToBrowser();

        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) {
            waveformDecodeInFlight = false;
            setAudioWaveformStatus('AudioContext unavailable');
            notifyVideoAudioLoadSettled();
            return;
        }

        let buffer;
        const ctx = new Ctx();
        try {
            let ab = await readArrayBufferForWaveformDecode();
            if (waveformBuildGenerationStale(gen)) return;
            setAudioWaveformStatus('Decoding audio…');
            await yieldToBrowser();
            if (waveformBuildGenerationStale(gen)) return;
            try {
                buffer = await decodeArrayBufferToAudioBuffer(ctx, ab);
            } catch (err1) {
                if (!urlMain) throw err1;
                const res = await fetch(urlMain);
                if (!res.ok) throw err1;
                ab = await res.arrayBuffer();
                if (waveformBuildGenerationStale(gen)) return;
                await yieldToBrowser();
                buffer = await decodeArrayBufferToAudioBuffer(ctx, ab);
            }
            if (waveformBuildGenerationStale(gen)) return;
            const videoDur = getDuration(videoMain);
            if (videoDur > 0 && buffer.duration > videoDur + 0.5) {
                buffer = clipAudioBufferToDuration(buffer, videoDur);
            }
        } catch (err) {
            if (waveformBuildGenerationStale(gen)) return;
            if (isWaveformFileTooLargeError(err)) {
                const n =
                    fileMain && fileMain.size
                        ? fileMain.size
                        : err && err.byteLength
                          ? err.byteLength
                          : 0;
                reportWaveformFileTooLarge(n);
                return;
            }
            waveformPeaks = null;
            const msg = err && err.message ? err.message : String(err);
            writeLog('Waveform: decode failed — ' + msg);
            setAudioWaveformStatus('Waveform unavailable');
            drawAudioWaveformCanvas();
            notifyVideoAudioLoadSettled();
            return;
        } finally {
            waveformDecodeInFlight = false;
            try {
                if (typeof ctx.close === 'function') await ctx.close();
            } catch (_) {
                /* ignore */
            }
        }

        if (waveformBuildGenerationStale(gen)) return;

        waveformAudioBuffer = buffer;
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport();
        }
        const sized = syncAudioWaveformCanvasSize();
        const barCount = sized ? sized.barCount : 1200;
        waveformPeaks = peaksFromAudioBuffer(buffer, barCount);
        const ch = buffer.numberOfChannels;
        const rate = buffer.sampleRate | 0;
        const dur = buffer.duration;
        setAudioWaveformStatus(
            ch +
                ' ch · ' +
                (rate ? rate + ' Hz' : '') +
                (dur > 0 ? ' · ' + dur.toFixed(2) + ' s' : ''),
        );
        drawAudioWaveformCanvas();
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        notifyVideoAudioLoadSettled();
        stopMainVideoWaveformPresenceWatch();
    }

    function onContainerMetaReadyForWaveform() {
        if (!urlMain) return;
        if (containerHasAudio.main === false) {
            waveformBuildGen += 1;
            notifyVideoAudioLoadSettled();
            waveformPeaks = null;
            waveformAudioBuffer = null;
            setAudioWaveformLoaded(false);
            setAudioWaveformStatus('Not Loaded');
            drawAudioWaveformCanvas();
            updateAllWaveformPlayheads();
            if (typeof renderAudioWaveformMarkers === 'function') renderAudioWaveformMarkers();
            if (typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
            showExtraLaneForNoVideoAudio();
            return;
        }
        refreshVideoAudioLaneVisibility();
    }

    function detachWaveformPauseBuildListener() {
        if (waveformPauseBuildListener) {
            videoMain.removeEventListener('pause', waveformPauseBuildListener);
            waveformPauseBuildListener = null;
        }
    }

    function abortWaveformDecodeInFlight() {
        waveformBuildGen += 1;
        waveformDecodeInFlight = false;
    }

    function abortWaveformSchedule() {
        if (waveformBuildTimer) {
            clearTimeout(waveformBuildTimer);
            waveformBuildTimer = 0;
        }
        if (waveformLoadKickTimer) {
            clearTimeout(waveformLoadKickTimer);
            waveformLoadKickTimer = 0;
        }
        detachWaveformPauseBuildListener();
    }

    function abortWaveformBuildInFlight() {
        abortWaveformDecodeInFlight();
        abortWaveformSchedule();
    }

    function cancelDeferredWaveformBuild() {
        abortWaveformBuildInFlight();
    }

    function shouldBuildMainVideoWaveform() {
        if (containerHasAudio.main === false) return false;
        if (isVideoAudioLaneShown()) return true;
        return containerHasAudio.main === true || containerHasAudio.main === null;
    }

    function waitForVideoReadyThenBuild() {
        if (!videoMain || !urlMain) return;
        const retry = () => {
            videoMain.removeEventListener('loadedmetadata', retry);
            videoMain.removeEventListener('durationchange', retry);
            videoMain.removeEventListener('loadeddata', retry);
            startWaveformBuildWhenReady();
        };
        videoMain.addEventListener('loadedmetadata', retry, { once: true });
        videoMain.addEventListener('durationchange', retry, { once: true });
        videoMain.addEventListener('loadeddata', retry, { once: true });
    }

    function startWaveformBuildWhenReady() {
        if (!urlMain) return;
        if (containerHasAudio.main === false) {
            notifyVideoAudioLoadSettled();
            return;
        }
        if (!videoReady()) {
            waitForVideoReadyThenBuild();
            return;
        }
        if (!shouldBuildMainVideoWaveform()) {
            if (containerHasAudio.main === false) {
                notifyVideoAudioLoadSettled();
            }
            return;
        }
        if (waveformPeaks && waveformPeaks.length > 0) {
            notifyVideoAudioLoadSettled();
            return;
        }

        const run = () => {
            if (!urlMain) return;
            if (!videoReady()) {
                waitForVideoReadyThenBuild();
                return;
            }
            if (waveformPeaks && waveformPeaks.length > 0) {
                notifyVideoAudioLoadSettled();
                return;
            }
            void buildAudioWaveformForCurrentVideo();
        };

        if (videoMain.readyState < 2) {
            const onMeta = () => {
                videoMain.removeEventListener('loadeddata', onMeta);
                startWaveformBuildWhenReady();
            };
            videoMain.addEventListener('loadeddata', onMeta, { once: true });
            return;
        }

        setTimeout(run, 0);
    }

    function scheduleBackgroundWaveformBuild(delayMs) {
        abortWaveformSchedule();
        if (!urlMain) return;
        let delay = delayMs > 0 ? delayMs : WAVEFORM_BG_BUILD_DELAY_MS;
        if (typeof isVideoLoadLockActive === 'function' && isVideoLoadLockActive()) {
            delay =
                typeof videoReady === 'function' && videoReady()
                    ? Math.min(delay, 80)
                    : 0;
        }
        setAudioWaveformLoaded(true);
        setAudioWaveformStatus('Loading waveform…');
        drawAudioWaveformCanvas();
        const run = () => {
            waveformBuildTimer = 0;
            startWaveformBuildWhenReady();
        };
        if (delay <= 0) {
            run();
            return;
        }
        waveformBuildTimer = setTimeout(run, delay);
    }

    /** 動画メタ／コンテナ解析後に波形ビルドを開始（重複キックはまとめる）。 */
    function ensureMainVideoWaveformAfterSessionRestore() {
        if (!urlMain) return;
        if (containerHasAudio.main === false) return;
        kickMainVideoWaveformBuild({ allowSettle: false });
    }

    function kickMainVideoWaveformBuild(opt) {
        if (!urlMain) return;
        if (containerHasAudio.main === false) {
            stopMainVideoWaveformPresenceWatch();
            if (!opt || opt.allowSettle) notifyVideoAudioLoadSettled();
            return;
        }
        if (waveformPeaks && waveformPeaks.length > 0) {
            stopMainVideoWaveformPresenceWatch();
            if (!opt || opt.allowSettle) notifyVideoAudioLoadSettled();
            return;
        }
        if (waveformDecodeInFlight) {
            scheduleWaveformBuildRetryIfNeeded();
            scheduleMainVideoWaveformPresenceWatch();
            return;
        }
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
            startWaveformBuildWhenReady();
        }, 0);
        scheduleMainVideoWaveformPresenceWatch();
    }

    /** 読み込みロック中のみキック（ロック解除待ちの波形用）。 */
    function ensureMainVideoWaveformBuildForLoad() {
        if (!isVideoLoadLockWaitingForAudio()) return;
        kickMainVideoWaveformBuild({ allowSettle: true });
    }

    /** ロック解除後も波形が未完了なら再キック。 */
    function kickMainVideoWaveformAfterLoadLock() {
        kickMainVideoWaveformBuild({ allowSettle: false });
    }

    function resetAudioWaveformForNewVideo(opt) {
        stopMainVideoWaveformPresenceWatch();
        abortWaveformSchedule();
        abortWaveformDecodeInFlight();
        waveformDecodeInFlight = false;
        waveformPeaks = null;
        waveformAudioBuffer = null;
        refreshVideoAudioLaneVisibility();
        setAudioWaveformLoaded(!!urlMain);
        if (!urlMain) {
            setAudioWaveformStatus('Not Loaded');
            drawAudioWaveformCanvas();
            if (audioWaveformPlayheadWrap) audioWaveformPlayheadWrap.hidden = true;
            return;
        }
        setAudioWaveformStatus('Loading waveform…');
        drawAudioWaveformCanvas();
        if (audioWaveformPlayheadWrap) audioWaveformPlayheadWrap.hidden = true;
        if (!opt || !opt.skipScheduleBuild) {
            scheduleBackgroundWaveformBuild(WAVEFORM_BG_BUILD_DELAY_MS);
        }
    }

    /** @deprecated 互換用 */
    function scheduleAudioWaveformBuild() {
        resetAudioWaveformForNewVideo();
    }

    function scheduleAudioWaveformBuildAfterPlayback() {
        scheduleBackgroundWaveformBuild(400);
    }

    function tryScheduleWaveformBuildIfNeeded(delayMs) {
        if (!urlMain || !videoReady()) return;
        if (waveformPeaks && waveformPeaks.length > 0) return;
        const label = audioWaveformStatus ? audioWaveformStatus.textContent || '' : '';
        if (label === 'No audio track' || label === 'Waveform unavailable') return;
        if (label.indexOf(' ch · ') >= 0) return;
        if (waveformBuildTimer) return;
        if (label.indexOf('Decoding') >= 0 && waveformDecodeInFlight) return;
        scheduleBackgroundWaveformBuild(delayMs > 0 ? delayMs : 600);
    }

    function ensureLaneScrubHitLayers() {
        const laneIds = ['audioWaveformLaneVideo'];
        for (let i = 0; i < extraTrackSlotCount(); i++) {
            laneIds.push('extraAudioLane' + i);
        }
        for (let i = 0; i < laneIds.length; i++) {
            const lane = document.getElementById(laneIds[i]);
            if (!lane) continue;
            if (lane.querySelector(':scope > .audio-waveform-lane__scrub-hit')) continue;
            const hit = document.createElement('div');
            hit.className = 'audio-waveform-lane__scrub-hit';
            hit.setAttribute('aria-hidden', 'true');
            lane.insertBefore(hit, lane.firstChild);
        }
    }

    function initAudioWaveformUi() {
        const lanes = waveformScrubTargetEl();
        if (!lanes) return;
        ensureLaneScrubHitLayers();
        if (typeof initWaveformTimelineZoomUi === 'function') initWaveformTimelineZoomUi();

        const videoAudioClearBtn = document.getElementById('videoAudioClearBtn');
        if (videoAudioClearBtn) {
            videoAudioClearBtn.disabled = true;
        }

        if (typeof ResizeObserver !== 'undefined') {
            waveformResizeObs = new ResizeObserver(() => {
                if (typeof applyWaveformTimelineZoomLayout === 'function') {
                    applyWaveformTimelineZoomLayout();
                }
                if (!waveformAudioBuffer) {
                    drawAudioWaveformCanvas();
                    updateAllWaveformPlayheads();
                    return;
                }
                const sized = syncAudioWaveformCanvasSize();
                if (!sized) return;
                waveformPeaks = peaksFromAudioBuffer(waveformAudioBuffer, sized.barCount);
                drawAudioWaveformCanvas();
                updateAllWaveformPlayheads();
                if (typeof renderAudioWaveformMarkers === 'function') {
                    renderAudioWaveformMarkers();
                }
            });
            waveformResizeObs.observe(lanes);
        } else {
            window.addEventListener('resize', () => {
                drawAudioWaveformCanvas();
                updateAllWaveformPlayheads();
            });
        }

        lanes.addEventListener('pointerdown', onWaveformLanesPointerDownCapture, true);

        if (typeof seekBar !== 'undefined' && seekBar) {
            const onSeekBarInput = () => {
                if (seekBar.disabled) return;
                const t = parseFloat(seekBar.value);
                if (!Number.isFinite(t)) return;
                isSeeking = true;
                if (typeof applyTransportAtSec === 'function') {
                    applyTransportAtSec(t, { scrubbing: true, logInput: true, flash: true });
                }
                if (typeof updateAllWaveformPlayheads === 'function') {
                    updateAllWaveformPlayheads();
                }
            };
            const onSeekBarChange = () => {
                if (seekBar.disabled) return;
                const t = parseFloat(seekBar.value);
                if (!Number.isFinite(t)) return;
                if (typeof applyTransportAtSec === 'function') {
                    applyTransportAtSec(t, { logInput: true, flash: true, markers: true });
                }
                if (typeof syncExtraAudioToTransport === 'function') {
                    syncExtraAudioToTransport({ force: true });
                }
                isSeeking = false;
                if (typeof updateSeekUiFromVideo === 'function') updateSeekUiFromVideo();
                if (typeof schedulePersistSession === 'function') schedulePersistSession();
            };
            seekBar.addEventListener('pointerdown', (ev) => {
                ev.stopPropagation();
            });
            seekBar.addEventListener('input', onSeekBarInput);
            seekBar.addEventListener('change', onSeekBarChange);
        }

        lanes.addEventListener('pointermove', (ev) => {
            waveformLanesLastPointerX = ev.clientX;
            waveformLanesLastPointerY = ev.clientY;
            const exSlot = waveformExtraLaneSlotFromClientY(ev.clientY);
            if (exSlot >= 0) {
                waveformTargetExtraSlot = exSlot;
            } else if (isPointerOverVideoAudioLane(ev.clientY)) {
                waveformTargetExtraSlot = -1;
            }
            if (typeof updatePlaybackRegionHoverFromPointer === 'function') {
                updatePlaybackRegionHoverFromPointer(ev.clientX, ev.clientY);
            }
            onWaveformPointerMove(ev);
        });
        lanes.addEventListener('pointerleave', () => {
            waveformLanesLastPointerX = null;
            waveformLanesLastPointerY = null;
            if (typeof updatePlaybackRegionHoverFromPointer === 'function') {
                updatePlaybackRegionHoverFromPointer(null, null);
            }
            if (!waveformOffsetDragActive) hideHoverPlayhead();
        });

        if (audioWaveformComposite) {
            audioWaveformComposite.addEventListener('pointermove', (ev) => {
                refreshActiveMixLaneHighlight(ev.clientY);
            });
            audioWaveformComposite.addEventListener('pointerleave', () => {
                refreshActiveMixLaneHighlight(null);
            });
        }

        lanes.addEventListener('keydown', (ev) => {
            if (
                (typeof handlePlaybackRegionSplitKeydown === 'function' &&
                    handlePlaybackRegionSplitKeydown(ev)) ||
                (typeof handlePlaybackRegionSlashKeydown === 'function' &&
                    handlePlaybackRegionSlashKeydown(ev)) ||
                (typeof handlePlaybackRegionJoinKeydown === 'function' &&
                    handlePlaybackRegionJoinKeydown(ev))
            ) {
                return;
            }
            const master =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : 0;
            if (!master) return;
            let ratio = transportRatioFromMasterSec(
                typeof getTransportSec === 'function' ? getTransportSec() : 0,
            );
            if (ev.code === 'Home') ratio = 0;
            else if (ev.code === 'End') ratio = 1;
            else if (ev.code === 'ArrowLeft')
                ratio = Math.max(0, ratio - masterFrameSec / master);
            else if (ev.code === 'ArrowRight')
                ratio = Math.min(1, ratio + masterFrameSec / master);
            else return;
            ev.preventDefault();
            applyTransportAtRatio(ratio, { logInput: true, flash: true });
        });
    }

    window.onContainerMetaReadyForWaveform = onContainerMetaReadyForWaveform;
    window.ensureMainVideoWaveformBuildForLoad = ensureMainVideoWaveformBuildForLoad;
    window.kickMainVideoWaveformBuild = kickMainVideoWaveformBuild;
    window.kickMainVideoWaveformAfterLoadLock = kickMainVideoWaveformAfterLoadLock;
    window.ensureMainVideoWaveformAfterSessionRestore = ensureMainVideoWaveformAfterSessionRestore;
    window.scheduleMainVideoWaveformPresenceWatch = scheduleMainVideoWaveformPresenceWatch;

    initAudioWaveformUi();
    refreshVideoAudioLaneVisibility();
