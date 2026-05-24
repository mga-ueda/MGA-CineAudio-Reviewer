(function videoLoadLockModule() {
    let lockGen = 0;
    let lockActive = false;
    let lockVideoReady = false;
    let lockAudioReady = false;
    let lockFileName = '';

    function overlayEl() {
        return document.getElementById('videoLoadLockOverlay');
    }

    function statusEl() {
        return document.getElementById('videoLoadLockStatus');
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
            overlay.hidden = !active;
            overlay.setAttribute('aria-hidden', active ? 'false' : 'true');
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
        lockActive = false;
        applyVideoLoadLockUi(false);
        if (typeof applyReviewMixVideoGain === 'function') {
            applyReviewMixVideoGain();
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
    }

    function beginVideoLoadLock(fileName) {
        lockGen += 1;
        lockActive = true;
        lockVideoReady = false;
        lockAudioReady = false;
        lockFileName = fileName ? String(fileName) : '';
        applyVideoLoadLockUi(true);
        writeLog(
            'Video load: started' +
                (lockFileName ? ' (“' + lockFileName + '”)' : ''),
        );
    }

    function cancelVideoLoadLock() {
        if (!lockActive) return;
        lockGen += 1;
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
        tryCompleteVideoLoadLock();
    }

    function notifyVideoLoadLockAudioReady() {
        if (!lockActive) return;
        if (lockAudioReady) return;
        lockAudioReady = true;
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
