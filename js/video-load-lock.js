/**
 * video-load-lock.js — 動画読込中のローディングロック表示と完了待ち。
 */
(function videoLoadLockModule() {
    const LOCK_MIN_VISIBLE_MS = 350;
    /** 波形デコードは待たない。メタデータ／再生準備のフォールバック用。 */
    const LOCK_PLAYBACK_WAIT_TIMEOUT_MS = 45000;
    let lockGen = 0;
    let lockActive = false;
    let lockVideoReady = false;
    let lockAudioReady = false;
    let lockFileName = '';
    let lockShownAt = 0;
    let lockFinishTimer = 0;
    let lockPlaybackWaitTimer = 0;

    function overlayEl() {
        return document.getElementById('videoLoadLockOverlay');
    }

    function statusEl() {
        return document.getElementById('videoLoadLockStatus');
    }

    function containerReportsNoVideoAudio() {
        return (
            typeof containerHasAudio !== 'undefined' &&
            containerHasAudio &&
            containerHasAudio.main === false
        );
    }

    function maybeMarkAudioReadyForNoContainerAudio() {
        if (!lockActive || lockAudioReady) return;
        if (!containerReportsNoVideoAudio()) return;
        lockAudioReady = true;
    }

    function clearLockPlaybackWaitTimer() {
        if (lockPlaybackWaitTimer) {
            clearTimeout(lockPlaybackWaitTimer);
            lockPlaybackWaitTimer = 0;
        }
    }

    /** 動画メタデータ準備完了時点で再生可能とみなし、波形はバックグラウンドで構築する。 */
    function markLockAudioReadyForPlayback() {
        if (!lockActive || lockAudioReady) return;
        clearLockPlaybackWaitTimer();
        lockAudioReady = true;
    }

    function finishVideoLoadLock() {
        if (!lockActive || !lockVideoReady || !lockAudioReady) return;
        lockActive = false;
        clearLockPlaybackWaitTimer();
        if (lockFinishTimer) {
            clearTimeout(lockFinishTimer);
            lockFinishTimer = 0;
        }
        applyVideoLoadLockUi(false);
        if (typeof applyReviewMixVideoGain === 'function') {
            applyReviewMixVideoGain();
        }
        if (typeof tryWireReviewMixVideoAudioWhenReady === 'function') {
            tryWireReviewMixVideoAudioWhenReady();
        }
        const ctx =
            typeof ensureReviewMixCtx === 'function' ? ensureReviewMixCtx() : null;
        if (ctx && ctx.state === 'suspended') {
            void ctx.resume();
        }
        writeLog(
            'Video load: ready' +
                (lockFileName ? ' (“' + lockFileName + '”)' : ''),
        );
        if (typeof kickMainVideoWaveformAfterLoadLock === 'function') {
            kickMainVideoWaveformAfterLoadLock();
        }
    }

    function refreshLockStatusText() {
        const status = statusEl();
        if (!status) return;
        if (!lockActive) return;
        if (!lockVideoReady) {
            status.textContent = 'Loading video…';
            return;
        }
        if (!lockAudioReady) {
            status.textContent = 'Loading Video Audio…';
            return;
        }
        status.textContent = 'Ready';
    }

    function applyVideoLoadLockUi(active) {
        const overlay = overlayEl();
        if (overlay) {
            if (active) {
                overlay.hidden = false;
                overlay.setAttribute('aria-hidden', 'false');
                if (!overlay.classList.contains('seek-flash--visible')) {
                    requestAnimationFrame(() => {
                        overlay.classList.add('seek-flash--visible');
                    });
                } else {
                    overlay.classList.add('seek-flash--visible');
                }
            } else {
                overlay.classList.remove('seek-flash--visible');
                overlay.hidden = true;
                overlay.setAttribute('aria-hidden', 'true');
            }
        }
        document.body.classList.toggle('video-load-lock-active', !!active);
        refreshLockStatusText();
        if (typeof updateControlsEnabled === 'function') {
            updateControlsEnabled();
        }
    }

    function tryCompleteVideoLoadLock() {
        if (!lockActive || !lockVideoReady || !lockAudioReady) {
            refreshLockStatusText();
            return;
        }
        const remain = LOCK_MIN_VISIBLE_MS - (performance.now() - lockShownAt);
        if (remain > 0) {
            if (lockFinishTimer) clearTimeout(lockFinishTimer);
            const gen = lockGen;
            lockFinishTimer = setTimeout(() => {
                lockFinishTimer = 0;
                if (gen !== lockGen) return;
                finishVideoLoadLock();
            }, remain);
            return;
        }
        finishVideoLoadLock();
    }

    function beginVideoLoadLock(fileName) {
        lockGen += 1;
        if (lockFinishTimer) {
            clearTimeout(lockFinishTimer);
            lockFinishTimer = 0;
        }
        clearLockPlaybackWaitTimer();
        lockActive = true;
        lockVideoReady = false;
        lockAudioReady = false;
        lockFileName = fileName ? String(fileName) : '';
        lockShownAt = performance.now();
        applyVideoLoadLockUi(true);
        const waitGen = lockGen;
        lockPlaybackWaitTimer = setTimeout(() => {
            lockPlaybackWaitTimer = 0;
            if (waitGen !== lockGen || !lockActive) return;
            if (lockVideoReady && lockAudioReady) return;
            writeLog('Video load: playback wait timeout — releasing lock');
            lockVideoReady = true;
            lockAudioReady = true;
            tryCompleteVideoLoadLock();
        }, LOCK_PLAYBACK_WAIT_TIMEOUT_MS);
        writeLog(
            'Video load: started' +
                (lockFileName ? ' (“' + lockFileName + '”)' : ''),
        );
    }

    function cancelVideoLoadLock() {
        if (!lockActive) return;
        lockGen += 1;
        clearLockPlaybackWaitTimer();
        if (lockFinishTimer) {
            clearTimeout(lockFinishTimer);
            lockFinishTimer = 0;
        }
        lockActive = false;
        lockVideoReady = false;
        lockAudioReady = false;
        lockFileName = '';
        applyVideoLoadLockUi(false);
    }

    function notifyVideoLoadLockVideoReady() {
        if (!lockActive) return;
        if (typeof videoReady === 'function' && !videoReady()) return;
        if (lockVideoReady) return;
        lockVideoReady = true;
        maybeMarkAudioReadyForNoContainerAudio();
        if (!lockAudioReady) {
            markLockAudioReadyForPlayback();
        }
        tryCompleteVideoLoadLock();
    }

    function notifyVideoLoadLockAudioReady() {
        if (!lockActive) return;
        if (lockAudioReady) return;
        markLockAudioReadyForPlayback();
        tryCompleteVideoLoadLock();
    }

    function isVideoLoadLockActive() {
        return lockActive;
    }

    window.beginVideoLoadLock = beginVideoLoadLock;
    window.cancelVideoLoadLock = cancelVideoLoadLock;
    window.notifyVideoLoadLockVideoReady = notifyVideoLoadLockVideoReady;
    window.notifyVideoLoadLockAudioReady = notifyVideoLoadLockAudioReady;
    window.isVideoLoadLockActive = isVideoLoadLockActive;
})();
