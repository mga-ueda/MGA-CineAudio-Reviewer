    let waveformPeaks = null;
    let waveformAudioBuffer = null;
    let waveformBuildGen = 0;
    let waveformResizeObs = null;
    let waveformMetaListener = null;
    let waveformScrubActive = false;
    let waveformScrubPointerId = null;
    let waveformScrubDocMove = null;
    let waveformScrubDocUp = null;
    let waveformOffsetDragActive = false;
    let waveformOffsetDragSlot = -1;
    let waveformOffsetDragPointerId = null;
    let waveformOffsetDragStartClientX = 0;
    let waveformOffsetDragStartTimelineSec = 0;
    let waveformOffsetDragDocMove = null;
    let waveformOffsetDragDocUp = null;
    let waveformAltModifierHeld = false;
    let waveformLanesLastPointerX = null;
    let waveformLanesLastPointerY = null;
    let waveformBuildTimer = 0;
    let waveformPauseBuildListener = null;
    /** MP4 は先頭スライスでは decode できないため、フルファイルのみ（上限あり） */
    const WAVEFORM_DECODE_MAX_BYTES = 1024 * 1024 * 1024;
    const WAVEFORM_DECODE_TIMEOUT_MS = 90000;
    const WAVEFORM_BG_BUILD_DELAY_MS = 3500;

    function yieldToBrowser() {
        return new Promise((resolve) => setTimeout(resolve, 0));
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
                    : 'Video Audio Track';
            titleEl.textContent = slotLabel;
            const tip =
                typeof laneStatusTooltip === 'function' ? laneStatusTooltip(text) : '';
            titleEl.title = tip ? slotLabel + ' — ' + tip : slotLabel;
        }
        if (typeof refreshVideoAudioLaneFileName === 'function') {
            refreshVideoAudioLaneFileName();
        }
    }

    function setAudioWaveformLoaded(loaded) {
        if (audioWaveformPanel) audioWaveformPanel.classList.toggle('loaded', !!loaded);
        if (audioWaveformComposite) audioWaveformComposite.classList.toggle('loaded', !!loaded);
    }

    /** × で閉じていない限り表示。動画なし／解析待ちは枠のみ、音声なし確定時のみ非表示。 */
    let videoLaneUiOpen = true;

    function containerReportsVideoAudioTrack() {
        return containerHasAudio.main === true;
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
        refreshVideoAudioLaneVisibility();
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
        const n = window.EXTRA_TRACK_COUNT;
        return typeof n === 'number' && n > 0 ? n : 3;
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

    /** 表示レーンが 0 になったら空き Ex スロットを 1 つ復活させる */
    function ensureAtLeastOneWaveformLaneVisible() {
        if (containerHasAudio.main === false && !hasAnyVisibleExtraWaveformLane()) {
            if (typeof reviveOneEmptyExtraLane === 'function') {
                reviveOneEmptyExtraLane();
            }
        }
        if (countVisibleWaveformLanes() > 0) return;
        if (typeof reviveOneEmptyExtraLane === 'function') {
            reviveOneEmptyExtraLane();
        } else {
            restoreVideoAudioLaneForNewVideo();
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
    }

    window.ensureAtLeastOneWaveformLaneVisible = ensureAtLeastOneWaveformLaneVisible;
    window.countVisibleWaveformLanes = countVisibleWaveformLanes;

    /** containerHasAudio と手動クリア状態を踏まえ Video Audio レーンの表示を反映 */
    function refreshVideoAudioLaneVisibility() {
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
        ensureAtLeastOneWaveformLaneVisible();
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

    /** 表示中のレーン数に合わせてグリッド高さとコメントラベル帯位置を更新 */
    function refreshWaveformCompositeLaneLayout() {
        if (!audioWaveformComposite) return;
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
            if (typeof renderAudioWaveformMarkers === 'function') {
                renderAudioWaveformMarkers();
            }
            if (typeof drawSeekPlaybackTrail === 'function') drawSeekPlaybackTrail();
            if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
            if (typeof redrawAllExtraTrackWaveforms === 'function') {
                redrawAllExtraTrackWaveforms();
            }
        });
    }

    window.showVideoAudioLane = showVideoAudioLane;
    window.restoreVideoAudioLaneForNewVideo = restoreVideoAudioLaneForNewVideo;
    window.isVideoAudioLaneShown = isVideoAudioLaneShown;
    window.dismissVideoAudioLane = dismissVideoAudioLane;
    window.refreshVideoAudioLaneVisibility = refreshVideoAudioLaneVisibility;
    window.refreshWaveformCompositeLaneLayout = refreshWaveformCompositeLaneLayout;

    function getWaveformAudioDurationSec() {
        if (waveformAudioBuffer && waveformAudioBuffer.duration > 0) {
            return waveformAudioBuffer.duration;
        }
        return getVideoTransportDurationSec();
    }

    function isAudioWaveformScrubActive() {
        return waveformScrubActive;
    }

    function isWaveformScrubSuppressPause() {
        return waveformScrubSuppressPause;
    }

    function getWaveformScrubResumePlayback() {
        return waveformScrubResumePlayback;
    }

    function detachWaveformScrubDocListeners() {
        if (waveformScrubDocMove) {
            document.removeEventListener('pointermove', waveformScrubDocMove);
            waveformScrubDocMove = null;
        }
        if (waveformScrubDocUp) {
            document.removeEventListener('pointerup', waveformScrubDocUp);
            document.removeEventListener('pointercancel', waveformScrubDocUp);
            waveformScrubDocUp = null;
        }
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

    function clearWaveformAltCursorClasses() {
        const lanes = waveformScrubTargetEl();
        if (!lanes) return;
        lanes.classList.remove('audio-waveform-composite__lanes--alt-offset-ready');
        lanes.classList.remove('audio-waveform-composite__lanes--offset-drag');
    }

    function syncWaveformAltModifierFromPointerEvent(ev) {
        if (ev && 'altKey' in ev) {
            waveformAltModifierHeld = !!ev.altKey;
        }
    }

    function endWaveformTrackOffsetDrag(opt) {
        if (!waveformOffsetDragActive && !(opt && opt.force)) return;
        detachWaveformOffsetDragDocListeners();
        waveformOffsetDragActive = false;
        waveformOffsetDragSlot = -1;
        waveformOffsetDragPointerId = null;
        const lanes = waveformScrubTargetEl();
        if (lanes) lanes.classList.remove('audio-waveform-composite__lanes--offset-drag');
        syncWaveformAltModifierFromPointerEvent(opt && opt.event);
        const ev = opt && opt.event;
        updateWaveformAltOffsetCursor(
            ev && Number.isFinite(ev.clientX) ? ev.clientX : waveformLanesLastPointerX,
            ev && Number.isFinite(ev.clientY) ? ev.clientY : waveformLanesLastPointerY,
        );
    }

    function updateWaveformAltOffsetCursor(clientX, clientY) {
        const lanes = waveformScrubTargetEl();
        if (!lanes) return;
        if (waveformOffsetDragActive) {
            lanes.classList.remove('audio-waveform-composite__lanes--alt-offset-ready');
            return;
        }
        if (!waveformAltModifierHeld) {
            lanes.classList.remove('audio-waveform-composite__lanes--alt-offset-ready');
            return;
        }
        let show = false;
        if (waveformAltModifierHeld) {
            const x =
                Number.isFinite(clientX) ? clientX : waveformLanesLastPointerX;
            const y =
                Number.isFinite(clientY) ? clientY : waveformLanesLastPointerY;
            if (Number.isFinite(x) && Number.isFinite(y)) {
                const lr = lanes.getBoundingClientRect();
                if (
                    x >= lr.left &&
                    x <= lr.right &&
                    y >= lr.top &&
                    y <= lr.bottom
                ) {
                    const slot = waveformExtraLaneSlotFromClientY(y);
                    show = canDragWaveformTrackTimelineStart(slot);
                }
            }
        }
        lanes.classList.toggle('audio-waveform-composite__lanes--alt-offset-ready', show);
    }

    function setWaveformAltModifierHeld(down) {
        waveformAltModifierHeld = !!down;
        if (!waveformAltModifierHeld) {
            clearWaveformAltCursorClasses();
            return;
        }
        updateWaveformAltOffsetCursor(waveformLanesLastPointerX, waveformLanesLastPointerY);
    }

    function bindWaveformAltOffsetCursorUi(lanes) {
        if (!lanes || lanes.dataset.altOffsetCursorBound === '1') return;
        lanes.dataset.altOffsetCursorBound = '1';

        const isAltKeyEvent = (ev) =>
            ev &&
            (ev.key === 'Alt' || ev.code === 'AltLeft' || ev.code === 'AltRight');

        document.addEventListener(
            'keydown',
            (ev) => {
                if (!isAltKeyEvent(ev) || waveformAltModifierHeld) return;
                setWaveformAltModifierHeld(true);
            },
            true,
        );
        document.addEventListener(
            'keyup',
            (ev) => {
                if (!isAltKeyEvent(ev)) return;
                setWaveformAltModifierHeld(false);
            },
            true,
        );
        window.addEventListener('blur', () => setWaveformAltModifierHeld(false));
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') setWaveformAltModifierHeld(false);
        });

        document.addEventListener(
            'pointermove',
            (ev) => {
                if (waveformOffsetDragActive) return;
                if (!ev.altKey) {
                    if (waveformAltModifierHeld) {
                        waveformAltModifierHeld = false;
                        clearWaveformAltCursorClasses();
                    }
                    return;
                }
                waveformAltModifierHeld = true;
                const lr = lanes.getBoundingClientRect();
                if (
                    ev.clientX < lr.left ||
                    ev.clientX > lr.right ||
                    ev.clientY < lr.top ||
                    ev.clientY > lr.bottom
                ) {
                    lanes.classList.remove('audio-waveform-composite__lanes--alt-offset-ready');
                    return;
                }
                waveformLanesLastPointerX = ev.clientX;
                waveformLanesLastPointerY = ev.clientY;
                updateWaveformAltOffsetCursor(ev.clientX, ev.clientY);
            },
            true,
        );
        document.addEventListener(
            'pointerup',
            (ev) => {
                if (waveformOffsetDragActive) return;
                syncWaveformAltModifierFromPointerEvent(ev);
                updateWaveformAltOffsetCursor(ev.clientX, ev.clientY);
            },
            true,
        );
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
        if (!master || !m || !m.contentW) return 0;
        return ((clientX - startClientX) / m.contentW) * master;
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
        if (!master || !m || !m.contentW) {
            return Math.max(step * 6, 0.05);
        }
        const SNAP_PX = 14;
        return Math.max(step, (SNAP_PX / m.contentW) * master);
    }

    function snapWaveformTimelineStartSec(sec) {
        if (typeof snapSecToMarkerInOut !== 'function') return sec;
        return snapSecToMarkerInOut(sec, { thresholdSec: waveformMarkerSnapThresholdSec() });
    }

    function applyWaveformTimelineStartFromDrag(slot, sec, opt) {
        const snapped = snapWaveformTimelineStartSec(sec);
        if (typeof setExtraTrackTimelineStartSec === 'function') {
            setExtraTrackTimelineStartSec(slot, snapped, opt);
        }
    }

    function endAudioWaveformScrub(opt) {
        endWaveformTrackOffsetDrag(opt);
        if (!waveformScrubActive && !(opt && opt.force)) return;
        detachWaveformScrubDocListeners();
        waveformScrubActive = false;
        waveformScrubPointerId = null;
        isSeeking = false;
        const lanes = waveformScrubTargetEl();
        if (lanes) lanes.classList.remove('audio-waveform-composite__lanes--scrubbing');
        if (typeof clearSeekPlaybackTrail === 'function') clearSeekPlaybackTrail();
    }

    let waveformLastHoverClientX = null;

    function setHoverPlayheadAtClientX(clientX) {
        if (!audioWaveformHoverPlayhead || waveformScrubActive) {
            hideHoverPlayhead();
            return;
        }
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!master) {
            hideHoverPlayhead();
            return;
        }
        const lanes = waveformScrubTargetEl();
        if (!lanes) {
            hideHoverPlayhead();
            return;
        }
        waveformLastHoverClientX = clientX;
        const pct =
            typeof waveformTimelineHoverLeftPercent === 'function'
                ? waveformTimelineHoverLeftPercent(clientX)
                : transportRatioFromClientX(clientX) * 100;
        audioWaveformHoverPlayhead.style.left = pct + '%';
        audioWaveformHoverPlayhead.hidden = false;
    }

    function refreshHoverPlayheadFromLastPointer() {
        if (waveformLastHoverClientX == null) return;
        if (!audioWaveformHoverPlayhead || audioWaveformHoverPlayhead.hidden) return;
        setHoverPlayheadAtClientX(waveformLastHoverClientX);
    }

    function hideHoverPlayhead() {
        waveformLastHoverClientX = null;
        if (audioWaveformHoverPlayhead) audioWaveformHoverPlayhead.hidden = true;
    }

    window.refreshHoverPlayheadFromLastPointer = refreshHoverPlayheadFromLastPointer;

    function clearAudioWaveform() {
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
            typeof masterTimelineWidthCss === 'function'
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

    function onWaveformTrackOffsetPointerDown(ev, slot) {
        endAudioWaveformScrub({ force: true });
        waveformOffsetDragActive = true;
        waveformOffsetDragSlot = slot;
        waveformOffsetDragPointerId = ev.pointerId;
        waveformOffsetDragStartClientX = ev.clientX;
        waveformOffsetDragStartTimelineSec =
            typeof getExtraTrackTimelineStartSec === 'function'
                ? getExtraTrackTimelineStartSec(slot)
                : 0;
        hideHoverPlayhead();
        const lanes = waveformScrubTargetEl();
        if (lanes) lanes.classList.add('audio-waveform-composite__lanes--offset-drag');
        writeLog('Waveform: Alt+drag track offset start (Ex ' + (slot + 1) + ')');

        waveformOffsetDragDocMove = (e) => {
            if (!waveformOffsetDragActive || e.pointerId !== waveformOffsetDragPointerId) return;
            const delta = timelineSecDeltaFromClientXDelta(
                e.clientX,
                waveformOffsetDragStartClientX,
            );
            const next = waveformOffsetDragStartTimelineSec + delta;
            applyWaveformTimelineStartFromDrag(slot, next, { skipPersist: true });
        };
        waveformOffsetDragDocUp = (e) => {
            if (!waveformOffsetDragActive || e.pointerId !== waveformOffsetDragPointerId) return;
            const delta = timelineSecDeltaFromClientXDelta(
                e.clientX,
                waveformOffsetDragStartClientX,
            );
            const next = waveformOffsetDragStartTimelineSec + delta;
            applyWaveformTimelineStartFromDrag(slot, next);
            const t =
                typeof getExtraTrackTimelineStartSec === 'function'
                    ? getExtraTrackTimelineStartSec(slot)
                    : 0;
            endWaveformTrackOffsetDrag({ force: true, event: e });
            setHoverPlayheadAtClientX(e.clientX);
            const tc =
                typeof formatTimecodeForTransport === 'function'
                    ? formatTimecodeForTransport(t)
                    : t.toFixed(2) + ' s';
            writeLog('Waveform: Ex ' + (slot + 1) + ' audio start at ' + tc);
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Audio start', tc);
            }
            if (typeof schedulePersistSession === 'function') schedulePersistSession();
        };
        document.addEventListener('pointermove', waveformOffsetDragDocMove);
        document.addEventListener('pointerup', waveformOffsetDragDocUp);
        document.addEventListener('pointercancel', waveformOffsetDragDocUp);
    }

    function onWaveformAltOffsetPointerDownCapture(ev) {
        if (!ev.altKey || ev.button !== 0) return;
        const ready =
            (typeof videoReady === 'function' && videoReady()) ||
            (typeof hasAnyExtraTrackLoaded === 'function' && hasAnyExtraTrackLoaded());
        if (!ready) return;
        const slot = waveformExtraLaneSlotFromPointer(ev);
        if (!canDragWaveformTrackTimelineStart(slot)) return;
        ev.preventDefault();
        ev.stopPropagation();
        onWaveformTrackOffsetPointerDown(ev, slot);
    }

    function onWaveformScrubPointerDown(ev) {
        if (ev.altKey) return;
        const ready =
            (typeof videoReady === 'function' && videoReady()) ||
            (typeof hasAnyExtraTrackLoaded === 'function' && hasAnyExtraTrackLoaded());
        if (!ready || ev.button !== 0) return;
        if (ev.target.closest && ev.target.closest('.seek-bar-marker')) return;
        endAudioWaveformScrub({ force: true });
        waveformScrubActive = true;
        waveformScrubPointerId = ev.pointerId;
        hideHoverPlayhead();
        const lanes = waveformScrubTargetEl();
        if (lanes) lanes.classList.add('audio-waveform-composite__lanes--scrubbing');
        if (typeof clearSeekPlaybackTrail === 'function') clearSeekPlaybackTrail();
        writeLog('Waveform: grab (scrub start)');

        waveformScrubDocMove = (e) => {
            if (!waveformScrubActive || e.pointerId !== waveformScrubPointerId) return;
            isSeeking = true;
            seekFromWaveformPointer(e.clientX, { logInput: true, flash: true });
        };
        waveformScrubDocUp = (e) => {
            if (!waveformScrubActive || e.pointerId !== waveformScrubPointerId) return;
            isSeeking = true;
            seekFromWaveformPointer(e.clientX, { logInput: true, flash: true });
            const t =
                typeof getTransportSec === 'function'
                    ? getTransportSec()
                    : parseFloat(seekBar.value) || 0;
            endAudioWaveformScrub({ force: true });
            setHoverPlayheadAtClientX(e.clientX);
            writeLog('Waveform: seek at ' + formatTimecodeForTransport(t));
            flashSeekHint('Seek', formatTimecodeForTransport(t));
            updateSeekUiFromVideo();
            if (!videoMain.paused && !rafId) rafId = requestAnimationFrame(tick);
            schedulePersistSession();
        };
        document.addEventListener('pointermove', waveformScrubDocMove);
        document.addEventListener('pointerup', waveformScrubDocUp);
        document.addEventListener('pointercancel', waveformScrubDocUp);
    }

    function onWaveformPointerMove(ev) {
        if (waveformScrubActive || waveformOffsetDragActive || waveformAltModifierHeld) return;
        setHoverPlayheadAtClientX(ev.clientX);
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
        if (!urlMain || !videoReady()) {
            clearAudioWaveform();
            return;
        }
        if (containerHasAudio.main === false) {
            waveformPeaks = null;
            setAudioWaveformLoaded(true);
            setAudioWaveformStatus('No audio track');
            drawAudioWaveformCanvas();
            updateAllWaveformPlayheads();
            if (typeof renderAudioWaveformMarkers === 'function') renderAudioWaveformMarkers();
            refreshVideoAudioLaneVisibility();
            if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
                ensureAtLeastOneWaveformLaneVisible();
            }
            return;
        }

        if (fileMain && fileMain.size > WAVEFORM_DECODE_MAX_BYTES) {
            reportWaveformFileTooLarge(fileMain.size);
            return;
        }

        setAudioWaveformLoaded(true);
        setAudioWaveformStatus('Decoding audio…');
        await yieldToBrowser();

        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) {
            setAudioWaveformStatus('AudioContext unavailable');
            return;
        }

        let buffer;
        const ctx = new Ctx();
        try {
            let ab = await readArrayBufferForWaveformDecode();
            if (gen !== waveformBuildGen) return;
            setAudioWaveformStatus('Decoding audio…');
            await yieldToBrowser();
            if (gen !== waveformBuildGen) return;
            try {
                buffer = await decodeArrayBufferToAudioBuffer(ctx, ab);
            } catch (err1) {
                if (!urlMain) throw err1;
                const res = await fetch(urlMain);
                if (!res.ok) throw err1;
                ab = await res.arrayBuffer();
                if (gen !== waveformBuildGen) return;
                await yieldToBrowser();
                buffer = await decodeArrayBufferToAudioBuffer(ctx, ab);
            }
            if (gen !== waveformBuildGen) return;
            const videoDur = getDuration(videoMain);
            if (videoDur > 0 && buffer.duration > videoDur + 0.5) {
                buffer = clipAudioBufferToDuration(buffer, videoDur);
            }
        } catch (err) {
            if (gen !== waveformBuildGen) return;
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
            return;
        } finally {
            try {
                if (typeof ctx.close === 'function') await ctx.close();
            } catch (_) {
                /* ignore */
            }
        }

        if (gen !== waveformBuildGen) return;

        waveformAudioBuffer = buffer;
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
    }

    function onContainerMetaReadyForWaveform() {
        if (!urlMain) return;
        refreshVideoAudioLaneVisibility();
        if (containerHasAudio.main !== false) return;
        waveformBuildGen += 1;
        waveformPeaks = null;
        waveformAudioBuffer = null;
        setAudioWaveformLoaded(true);
        setAudioWaveformStatus('No audio track');
        drawAudioWaveformCanvas();
        updateAllWaveformPlayheads();
        if (typeof renderAudioWaveformMarkers === 'function') renderAudioWaveformMarkers();
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
    }

    function detachWaveformPauseBuildListener() {
        if (waveformPauseBuildListener) {
            videoMain.removeEventListener('pause', waveformPauseBuildListener);
            waveformPauseBuildListener = null;
        }
    }

    function abortWaveformDecodeInFlight() {
        waveformBuildGen += 1;
    }

    function abortWaveformSchedule() {
        if (waveformBuildTimer) {
            clearTimeout(waveformBuildTimer);
            waveformBuildTimer = 0;
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

    function startWaveformBuildWhenReady() {
        if (!urlMain || !videoReady()) return;
        if (!isVideoAudioLaneShown()) return;
        if (waveformPeaks && waveformPeaks.length > 0) return;

        const run = () => {
            if (!urlMain || !videoReady()) return;
            if (waveformPeaks && waveformPeaks.length > 0) return;
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

        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(run, { timeout: 6000 });
        } else {
            setTimeout(run, 0);
        }
    }

    function scheduleBackgroundWaveformBuild(delayMs) {
        abortWaveformSchedule();
        if (!urlMain) return;
        const delay = delayMs > 0 ? delayMs : WAVEFORM_BG_BUILD_DELAY_MS;
        setAudioWaveformLoaded(true);
        setAudioWaveformStatus('Loading waveform…');
        drawAudioWaveformCanvas();
        waveformBuildTimer = setTimeout(() => {
            waveformBuildTimer = 0;
            startWaveformBuildWhenReady();
        }, delay);
    }

    function resetAudioWaveformForNewVideo() {
        abortWaveformSchedule();
        abortWaveformDecodeInFlight();
        waveformPeaks = null;
        waveformAudioBuffer = null;
        restoreVideoAudioLaneForNewVideo();
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
        scheduleBackgroundWaveformBuild(WAVEFORM_BG_BUILD_DELAY_MS);
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
        if (label.indexOf('Decoding') >= 0) return;
        scheduleBackgroundWaveformBuild(delayMs > 0 ? delayMs : 600);
    }

    function initAudioWaveformUi() {
        const lanes = waveformScrubTargetEl();
        if (!lanes) return;
        if (typeof initWaveformTimelineZoomUi === 'function') initWaveformTimelineZoomUi();

        const videoAudioClearBtn = document.getElementById('videoAudioClearBtn');
        if (videoAudioClearBtn) {
            videoAudioClearBtn.addEventListener('click', () => {
                dismissVideoAudioLane();
                writeLog('Video audio: lane cleared (hidden)');
            });
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

        lanes.addEventListener('pointerdown', onWaveformAltOffsetPointerDownCapture, true);
        lanes.addEventListener('pointerdown', onWaveformScrubPointerDown);
        bindWaveformAltOffsetCursorUi(lanes);

        lanes.addEventListener('pointermove', (ev) => {
            waveformLanesLastPointerX = ev.clientX;
            waveformLanesLastPointerY = ev.clientY;
            if (waveformAltModifierHeld || ev.altKey) {
                if (ev.altKey) waveformAltModifierHeld = true;
                updateWaveformAltOffsetCursor(ev.clientX, ev.clientY);
            }
            onWaveformPointerMove(ev);
        });
        lanes.addEventListener('pointerleave', () => {
            waveformLanesLastPointerX = null;
            waveformLanesLastPointerY = null;
            updateWaveformAltOffsetCursor();
            if (!waveformScrubActive) hideHoverPlayhead();
        });

        lanes.addEventListener('keydown', (ev) => {
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

    initAudioWaveformUi();
    refreshVideoAudioLaneVisibility();
