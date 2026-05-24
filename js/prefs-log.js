    const LOG_MAX_LINES = 500;

    function showAppAlert(title, body) {
        const t = title != null ? String(title) : '';
        const b = body != null && body !== '' ? String(body) : '';
        writeLog(b ? t + ' — ' + b : t);
        window.alert(b ? t + '\n\n' + b : t);
    }

    let appConfirmResolve = null;

    function closeAppConfirm(result) {
        const root = document.getElementById('appConfirmOverlay');
        if (root) {
            root.hidden = true;
            root.setAttribute('aria-hidden', 'true');
        }
        if (appConfirmResolve) {
            appConfirmResolve(!!result);
            appConfirmResolve = null;
        }
    }

    function showAppConfirm(title, body) {
        const root = document.getElementById('appConfirmOverlay');
        const titleEl = document.getElementById('appConfirmTitle');
        const bodyEl = document.getElementById('appConfirmBody');
        const cancelBtn = document.getElementById('appConfirmCancel');
        if (!root || !titleEl || !bodyEl || !cancelBtn) return Promise.resolve(false);

        const t = title != null ? String(title) : '';
        const b = body != null && body !== '' ? String(body) : '';
        writeLog(b ? t + ' — ' + b : t);

        titleEl.textContent = t;
        bodyEl.textContent = b;
        root.hidden = false;
        root.setAttribute('aria-hidden', 'false');

        return new Promise((resolve) => {
            appConfirmResolve = resolve;
            requestAnimationFrame(() => {
                cancelBtn.focus();
            });
        });
    }

    window.showAppConfirm = showAppConfirm;

    function requestAppConfirm(title, body, cancelLogMsg) {
        const promise =
            typeof showAppConfirm === 'function'
                ? showAppConfirm(title, body)
                : Promise.resolve(
                      window.confirm(
                          (title != null ? String(title) : '') +
                              (body != null && body !== '' ? '\n\n' + String(body) : ''),
                      ),
                  );
        return promise.then((confirmed) => {
            if (!confirmed && cancelLogMsg) writeLog(cancelLogMsg);
            return confirmed;
        });
    }

    window.requestAppConfirm = requestAppConfirm;

    (function initAppConfirmOverlay() {
        const root = document.getElementById('appConfirmOverlay');
        const cancelBtn = document.getElementById('appConfirmCancel');
        const okBtn = document.getElementById('appConfirmOk');
        if (!root || !cancelBtn || !okBtn) return;

        cancelBtn.addEventListener('click', () => closeAppConfirm(false));
        okBtn.addEventListener('click', () => closeAppConfirm(true));
        root.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeAppConfirm(false);
            }
        });
    })();

    function clearLog() {
        if (!logEl) return;
        logEl.innerText = '';
        logEl.scrollTop = 0;
    }

    function writeLog(m) {
        if (!logEl) return;
        const now = new Date();
        const time =
            '[' +
            String(now.getHours()).padStart(2, '0') +
            ':' +
            String(now.getMinutes()).padStart(2, '0') +
            ':' +
            String(now.getSeconds()).padStart(2, '0') +
            ']';
        const cur = logEl.innerText;
        const lines = cur ? cur.split('\n') : [];
        lines.push(time + ' - ' + m);
        if (lines.length > LOG_MAX_LINES) {
            lines.splice(0, lines.length - LOG_MAX_LINES);
        }
        logEl.innerText = lines.join('\n');
        logEl.scrollTop = logEl.scrollHeight;
    }

    window.clearLog = clearLog;

    function logArrowSeekDebounced(msg) {
        const now = performance.now();
        if (now - lastArrowSeekLogAt < 220) return;
        lastArrowSeekLogAt = now;
        writeLog(msg);
    }

    function logSeekBarInputThrottled(t) {
        const now = performance.now();
        if (now - lastSeekBarInputLogAt < 160) return;
        lastSeekBarInputLogAt = now;
        writeLog('Seek bar: scrub to ' + formatTimecodeForTransport(t));
    }

    let seekFlashHideTimer = 0;
    let seekFlashAriaTimer = 0;

    function flashSeekHint(primary, secondary, kind) {
        const root = document.getElementById('seekFlashOverlay');
        const pEl = document.getElementById('seekFlashPrimary');
        const sEl = document.getElementById('seekFlashSecondary');
        if (!root || !pEl || !sEl) return;
        clearTimeout(seekFlashHideTimer);
        clearTimeout(seekFlashAriaTimer);

        pEl.textContent = primary != null ? String(primary) : '';
        const sec = secondary != null && secondary !== '' ? String(secondary) : '';
        sEl.textContent = sec;
        sEl.hidden = !sec;

        root.setAttribute('aria-hidden', 'false');
        if (!root.classList.contains('seek-flash--visible')) {
            requestAnimationFrame(() => {
                root.classList.add('seek-flash--visible');
            });
        } else {
            root.classList.add('seek-flash--visible');
        }

        const isNotice = kind === 'notice';
        const holdMs = isNotice ? 2100 : 680;
        const fadeOutMs = 820;
        seekFlashHideTimer = setTimeout(() => {
            root.classList.remove('seek-flash--visible');
        }, holdMs);
        seekFlashAriaTimer = setTimeout(() => {
            seekFlashAriaTimer = 0;
            root.setAttribute('aria-hidden', 'true');
        }, holdMs + fadeOutMs + 40);
    }

    function flashSeekScrubThrottled(t) {
        const now = performance.now();
        if (now - lastSeekFlashScrubAt < 200) return;
        lastSeekFlashScrubAt = now;
        flashSeekHint('Scrub', formatTimecodeForTransport(t));
    }

    function readPrefs() {
        try {
            const raw = localStorage.getItem(LS_PREFS_KEY);
            if (!raw) return {};
            const j = JSON.parse(raw);
            return j && typeof j === 'object' ? j : {};
        } catch (_) {
            return {};
        }
    }

    function writePrefs() {
        try {
            const prev = readPrefs();
            const payload = {
                loopPlayback: getLoopPlaybackEnabled(),
                frameDelayFrames: getVideoFrameDelayFrames(),
            };
            if (prev.exportMediaInclude && typeof prev.exportMediaInclude === 'object') {
                payload.exportMediaInclude = prev.exportMediaInclude;
            }
            if (typeof getWaveformLaneUiPersistSnapshot === 'function') {
                payload.laneUi = getWaveformLaneUiPersistSnapshot();
            }
            localStorage.setItem(LS_PREFS_KEY, JSON.stringify(payload));
        } catch (_) {}
    }
