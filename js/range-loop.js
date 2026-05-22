    let loopRangeActive = false;
    let loopRangeInSec = 0;
    let loopRangeOutSec = 0;
    let loopRangeDragActive = false;
    let loopRangeDragPointerId = null;
    let loopRangeDragStartSec = 0;
    let loopRangeDragEndSec = 0;
    let loopRangeDragDocMove = null;
    let loopRangeDragDocUp = null;
    let loopRangeRightPressActive = false;
    let loopRangeRightPressPointerId = null;
    let loopRangeRightPressStartX = 0;
    let loopRangeRightPressStartY = 0;
    let loopRangeRightPressDidDrag = false;
    /** 右ドラッグで範囲ループを確定した直後の contextmenu で解除しない */
    let suppressRangeLoopContextMenuDismiss = false;

    const RANGE_LOOP_MIN_SEC = 0.05;
    const RANGE_LOOP_CLICK_MOVE_PX = 5;
    let pendingRangeLoopRestore = null;

    function isRangeLoopPlaybackActive() {
        return (
            loopRangeActive &&
            Number.isFinite(loopRangeInSec) &&
            Number.isFinite(loopRangeOutSec) &&
            loopRangeOutSec > loopRangeInSec
        );
    }

    function getRangeLoopInSec() {
        return loopRangeInSec;
    }

    function getRangeLoopOutSec() {
        return loopRangeOutSec;
    }

    function normalizeRangeLoopBounds(aSec, bSec) {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!master) return null;
        let a = Number(aSec);
        let b = Number(bSec);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        let inSec = Math.min(a, b);
        let outSec = Math.max(a, b);
        inSec = Math.max(0, Math.min(inSec, master));
        outSec = Math.max(0, Math.min(outSec, master));
        if (outSec - inSec < RANGE_LOOP_MIN_SEC) return null;
        return { inSec, outSec };
    }

    function updateRangeLoopOverlay() {
        const el =
            typeof audioWaveformRangeLoop !== 'undefined' && audioWaveformRangeLoop
                ? audioWaveformRangeLoop
                : document.getElementById('audioWaveformRangeLoop');
        if (!el) return;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const show =
            (loopRangeDragActive || isRangeLoopPlaybackActive()) &&
            master > 0 &&
            Number.isFinite(loopRangeInSec) &&
            Number.isFinite(loopRangeOutSec) &&
            loopRangeOutSec > loopRangeInSec;
        if (!show) {
            el.hidden = true;
            return;
        }
        const leftPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(loopRangeInSec)
                : (loopRangeInSec / master) * 100;
        const rightPct =
            typeof transportSecToTimelineLeftPercent === 'function'
                ? transportSecToTimelineLeftPercent(loopRangeOutSec)
                : (loopRangeOutSec / master) * 100;
        const wPct = Math.max(0.05, rightPct - leftPct);
        el.style.left = leftPct + '%';
        el.style.width = wPct + '%';
        el.hidden = false;
    }

    function clearRangeLoopPlayback(opt) {
        const was = isRangeLoopPlaybackActive();
        pendingRangeLoopRestore = null;
        loopRangeActive = false;
        loopRangeInSec = 0;
        loopRangeOutSec = 0;
        loopRangeDragActive = false;
        loopRangeRightPressActive = false;
        updateRangeLoopOverlay();
        if (was && !(opt && opt.silent)) {
            writeLog('Range loop: off');
            flashSeekHint('Range loop', 'Off', 'notice');
        }
        if (was && typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
    }

    function getRangeLoopPersistSnapshot() {
        if (!isRangeLoopPlaybackActive()) return null;
        return {
            inSec: loopRangeInSec,
            outSec: loopRangeOutSec,
        };
    }

    function setPendingRangeLoopRestore(data) {
        pendingRangeLoopRestore =
            data &&
            Number.isFinite(data.inSec) &&
            Number.isFinite(data.outSec) &&
            data.outSec > data.inSec
                ? { inSec: data.inSec, outSec: data.outSec }
                : null;
    }

    function restoreRangeLoopFromPersist(data, opt) {
        if (!data) return false;
        const bounds = normalizeRangeLoopBounds(data.inSec, data.outSec);
        if (!bounds) return false;
        loopRangeInSec = bounds.inSec;
        loopRangeOutSec = bounds.outSec;
        loopRangeActive = true;
        updateRangeLoopOverlay();
        if (!(opt && opt.skipJump)) {
            jumpToRangeLoopInSec();
        }
        if (!(opt && opt.silent)) {
            writeLog(
                'Range loop: ' +
                    formatTimecodeForTransport(loopRangeInSec) +
                    ' – ' +
                    formatTimecodeForTransport(loopRangeOutSec),
            );
            flashSeekHint(
                'Range loop',
                formatTimecodeForTransport(loopRangeInSec) +
                    ' – ' +
                    formatTimecodeForTransport(loopRangeOutSec),
                'notice',
            );
        }
        return true;
    }

    function applyPendingRangeLoopRestore() {
        if (!pendingRangeLoopRestore) return false;
        const data = pendingRangeLoopRestore;
        pendingRangeLoopRestore = null;
        const ok = restoreRangeLoopFromPersist(data, { silent: true, skipJump: true });
        if (ok) {
            writeLog(
                'Range loop: restored ' +
                    formatTimecodeForTransport(loopRangeInSec) +
                    ' – ' +
                    formatTimecodeForTransport(loopRangeOutSec),
            );
        }
        return ok;
    }

    /** Escape / 右クリック contextmenu と同じ解除 */
    function dismissRangeLoopLikeEscape() {
        if (loopRangeDragActive || loopRangeRightPressActive) {
            endRangeLoopDrag();
            if (!isRangeLoopPlaybackActive()) {
                loopRangeInSec = 0;
                loopRangeOutSec = 0;
                updateRangeLoopOverlay();
            }
            return true;
        }
        if (!isRangeLoopPlaybackActive()) return false;
        clearRangeLoopPlayback();
        return true;
    }

    function handleRangeLoopEscapeKeydown(e) {
        if (e.code !== 'Escape' || e.ctrlKey || e.altKey || e.metaKey) return false;
        if (e.repeat) return false;
        if (!dismissRangeLoopLikeEscape()) return false;
        e.preventDefault();
        return true;
    }

    function onRangeLoopContextMenu(ev) {
        if (
            !loopRangeDragActive &&
            !loopRangeRightPressActive &&
            !isRangeLoopPlaybackActive()
        ) {
            return;
        }
        ev.preventDefault();
        if (suppressRangeLoopContextMenuDismiss) {
            suppressRangeLoopContextMenuDismiss = false;
            return;
        }
        dismissRangeLoopLikeEscape();
    }

    function jumpToRangeLoopInSec() {
        if (!isRangeLoopPlaybackActive()) return false;
        const inSec = loopRangeInSec;
        if (typeof transportPlaybackSec !== 'undefined') {
            transportPlaybackSec = inSec;
            transportPlaybackLastTs = performance.now();
        }
        if (typeof setTransportSec === 'function') {
            setTransportSec(inSec);
        }
        const vd =
            typeof getVideoPlaybackEndSec === 'function'
                ? getVideoPlaybackEndSec()
                : typeof getVideoTransportDurationSec === 'function'
                  ? getVideoTransportDurationSec()
                  : 0;
        if (vd > 0 && inSec < vd - 0.001) {
            if (typeof clearVideoParkedForTail === 'function') clearVideoParkedForTail();
        }
        if (typeof applyVideoTimeForTransportSec === 'function') {
            applyVideoTimeForTransportSec(inSec, { force: true });
        } else if (videoMain) {
            try {
                const vt =
                    typeof videoSecForTransportSec === 'function'
                        ? videoSecForTransportSec(inSec)
                        : inSec;
                videoMain.currentTime = vt;
            } catch (_) {}
        }
        if (typeof resetExtraMixScheduleTime === 'function') {
            resetExtraMixScheduleTime();
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        const resume =
            (typeof isTransportPlaying === 'function' && isTransportPlaying()) ||
            (typeof isTransportUiClockActive === 'function' && isTransportUiClockActive());
        if (
            resume &&
            videoMain &&
            videoMain.paused &&
            vd > 0 &&
            inSec < vd - 0.001
        ) {
            const p = videoMain.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        }
        if (typeof updateSeekUiFromVideo === 'function') {
            updateSeekUiFromVideo();
        } else if (typeof updateAllWaveformPlayheads === 'function') {
            updateAllWaveformPlayheads();
        }
        return true;
    }

    let suppressLoopSnapUntil = 0;

    /** マーカー等の明示シーク直後はループへ戻すスナップを抑止する */
    function suppressRangeLoopSnapForExplicitSeek(ms) {
        suppressLoopSnapUntil = performance.now() + (Number(ms) > 0 ? ms : 900);
    }

    function snapRangeLoopPlaybackIfNeeded() {
        if (performance.now() < suppressLoopSnapUntil) return false;
        if (!isRangeLoopPlaybackActive()) return false;
        const t =
            typeof transportPlaybackSec === 'number' && Number.isFinite(transportPlaybackSec)
                ? transportPlaybackSec
                : typeof getTransportSec === 'function'
                  ? getTransportSec()
                  : 0;
        if (t < loopRangeInSec || t >= loopRangeOutSec) {
            jumpToRangeLoopInSec();
            return true;
        }
        return false;
    }

    function activateRangeLoopPlayback(inSec, outSec) {
        const bounds = normalizeRangeLoopBounds(inSec, outSec);
        if (!bounds) return false;
        loopRangeInSec = bounds.inSec;
        loopRangeOutSec = bounds.outSec;
        loopRangeActive = true;
        updateRangeLoopOverlay();
        jumpToRangeLoopInSec();
        writeLog(
            'Range loop: ' +
                formatTimecodeForTransport(loopRangeInSec) +
                ' – ' +
                formatTimecodeForTransport(loopRangeOutSec),
        );
        flashSeekHint(
            'Range loop',
            formatTimecodeForTransport(loopRangeInSec) +
                ' – ' +
                formatTimecodeForTransport(loopRangeOutSec),
            'notice',
        );
        if (typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        return true;
    }

    /** @returns {boolean} true if transport was wrapped to range In */
    function enforceRangeLoopPlaybackPosition() {
        return snapRangeLoopPlaybackIfNeeded();
    }

    function rangeLoopAudioTimeInSpan(audioT) {
        return (
            Number.isFinite(audioT) &&
            audioT >= loopRangeInSec - 0.001 &&
            audioT < loopRangeOutSec
        );
    }

    /** @deprecated 互換。範囲は音声マスター秒で保持する。 */
    function rangeLoopVideoTimeInSpan(vt) {
        const audioT =
            typeof audioSecFromVideoSec === 'function'
                ? audioSecFromVideoSec(vt)
                : vt;
        return rangeLoopAudioTimeInSpan(audioT);
    }

    /**
     * 範囲ループ中の tick で毎フレーム video.currentTime を書き換えると再生が途切れる。
     * ループ区間内の通常再生では動画に追従し、巻き戻しシーク中・テール部のみ同期する。
     */
    function shouldApplyVideoTimeDuringRangeLoopTick(t) {
        if (!isRangeLoopPlaybackActive()) return true;
        if (typeof videoMain === 'undefined' || !videoMain) return true;
        if (videoMain.seeking) return false;
        const vd =
            typeof getVideoPlaybackEndSec === 'function'
                ? getVideoPlaybackEndSec()
                : typeof getVideoTransportDurationSec === 'function'
                  ? getVideoTransportDurationSec()
                  : 0;
        const x = Number(t);
        if (!Number.isFinite(x)) return true;
        if (vd > 0 && x >= vd - 0.0005) return true;
        if (!videoMain.paused && !videoMain.ended && x >= loopRangeInSec && x < loopRangeOutSec) {
            return false;
        }
        return true;
    }

    /**
     * 範囲ループ中のトランスポート時計。
     * 通常は再生中の video に追従。Out 巻き戻しシーク中は In で固定し UI のカクつきを防ぐ。
     * @returns {boolean}
     */
    function advanceRangeLoopPlaybackClock() {
        if (!isRangeLoopPlaybackActive()) return false;
        if (typeof transportPlaybackSec !== 'number' || !Number.isFinite(transportPlaybackSec)) {
            return false;
        }
        if (typeof videoMain !== 'undefined' && videoMain && videoMain.seeking) {
            transportPlaybackSec = loopRangeInSec;
            transportPlaybackLastTs = performance.now();
            return true;
        }
        const now = performance.now();
        if (transportPlaybackLastTs > 0) {
            transportPlaybackSec += (now - transportPlaybackLastTs) / 1000;
        }
        transportPlaybackLastTs = now;
        if (transportPlaybackSec >= loopRangeOutSec) {
            snapRangeLoopPlaybackIfNeeded();
        }
        return true;
    }

    function detachRangeLoopDragDocListeners() {
        if (loopRangeDragDocMove) {
            document.removeEventListener('pointermove', loopRangeDragDocMove);
            loopRangeDragDocMove = null;
        }
        if (loopRangeDragDocUp) {
            document.removeEventListener('pointerup', loopRangeDragDocUp);
            document.removeEventListener('pointercancel', loopRangeDragDocUp);
            loopRangeDragDocUp = null;
        }
    }

    function endRangeLoopDrag() {
        loopRangeDragActive = false;
        loopRangeDragPointerId = null;
        loopRangeRightPressActive = false;
        detachRangeLoopDragDocListeners();
        const lanes =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        if (lanes) lanes.classList.remove('audio-waveform-composite__lanes--range-loop-drag');
    }

    function setRangeLoopDragPreview(aSec, bSec) {
        const bounds = normalizeRangeLoopBounds(aSec, bSec);
        if (!bounds) {
            if (!isRangeLoopPlaybackActive()) {
                loopRangeInSec = 0;
                loopRangeOutSec = 0;
            }
            updateRangeLoopOverlay();
            return false;
        }
        loopRangeInSec = bounds.inSec;
        loopRangeOutSec = bounds.outSec;
        updateRangeLoopOverlay();
        return true;
    }

    function beginRangeLoopDragVisual() {
        loopRangeDragActive = true;
        const lanes =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        if (lanes) lanes.classList.add('audio-waveform-composite__lanes--range-loop-drag');
    }

    function onRangeLoopPointerDown(ev) {
        if (ev.button !== 2) return;
        const ready =
            (typeof videoReady === 'function' && videoReady()) ||
            (typeof hasAnyExtraTrackLoaded === 'function' && hasAnyExtraTrackLoaded());
        if (!ready) return;
        if (ev.target.closest && ev.target.closest('.seek-bar-marker')) return;
        ev.preventDefault();
        if (typeof endAudioWaveformScrub === 'function') {
            endAudioWaveformScrub({ force: true });
        }
        const startSec =
            typeof transportSecFromClientX === 'function'
                ? transportSecFromClientX(ev.clientX)
                : 0;
        loopRangeRightPressActive = true;
        loopRangeRightPressPointerId = ev.pointerId;
        loopRangeRightPressStartX = ev.clientX;
        loopRangeRightPressStartY = ev.clientY;
        loopRangeRightPressDidDrag = false;
        loopRangeDragStartSec = startSec;
        loopRangeDragEndSec = startSec;
        loopRangeDragPointerId = ev.pointerId;
        if (!isRangeLoopPlaybackActive()) {
            beginRangeLoopDragVisual();
            setRangeLoopDragPreview(startSec, startSec);
        }
        if (typeof hideHoverPlayhead === 'function') hideHoverPlayhead();

        loopRangeDragDocMove = (e) => {
            if (!loopRangeRightPressActive || e.pointerId !== loopRangeRightPressPointerId) {
                return;
            }
            e.preventDefault();
            const dx = e.clientX - loopRangeRightPressStartX;
            const dy = e.clientY - loopRangeRightPressStartY;
            if (
                !loopRangeRightPressDidDrag &&
                Math.hypot(dx, dy) >= RANGE_LOOP_CLICK_MOVE_PX
            ) {
                loopRangeRightPressDidDrag = true;
                if (!loopRangeDragActive) {
                    beginRangeLoopDragVisual();
                }
            }
            if (loopRangeRightPressDidDrag) {
                loopRangeDragEndSec =
                    typeof transportSecFromClientX === 'function'
                        ? transportSecFromClientX(e.clientX)
                        : loopRangeDragStartSec;
                setRangeLoopDragPreview(loopRangeDragStartSec, loopRangeDragEndSec);
            }
        };
        loopRangeDragDocUp = (e) => {
            if (!loopRangeRightPressActive || e.pointerId !== loopRangeRightPressPointerId) {
                return;
            }
            e.preventDefault();
            if (loopRangeRightPressDidDrag) {
                loopRangeDragEndSec =
                    typeof transportSecFromClientX === 'function'
                        ? transportSecFromClientX(e.clientX)
                        : loopRangeDragStartSec;
            }
            endRangeLoopDrag();
            if (loopRangeRightPressDidDrag) {
                if (activateRangeLoopPlayback(loopRangeDragStartSec, loopRangeDragEndSec)) {
                    suppressRangeLoopContextMenuDismiss = true;
                    const resume =
                        typeof isTransportPlaying === 'function'
                            ? isTransportPlaying()
                            : !!(videoMain && !videoMain.paused);
                    if (resume && typeof startVideoPlayback === 'function') {
                        void startVideoPlayback({ force: true });
                    }
                }
            }
        };
        document.addEventListener('pointermove', loopRangeDragDocMove);
        document.addEventListener('pointerup', loopRangeDragDocUp);
        document.addEventListener('pointercancel', loopRangeDragDocUp);
    }

    function initRangeLoopUi() {
        const lanes =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        if (!lanes) return;
        lanes.addEventListener('pointerdown', onRangeLoopPointerDown);
        lanes.addEventListener('contextmenu', onRangeLoopContextMenu);
        const composite = document.getElementById('audioWaveformComposite');
        if (composite) {
            composite.addEventListener('contextmenu', onRangeLoopContextMenu);
        }
    }

    initRangeLoopUi();
