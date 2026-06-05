/**
 * prefs-log.js — localStorage 設定の読み書き、ログパネル、確認ダイアログ、writeLog。
 */
    let logLines = [];

    function syncLogEl() {
        if (!logEl) return;
        logEl.innerText = logLines.join('\n');
        logEl.scrollTop = logEl.scrollHeight;
    }

    function seedLogLines(lines) {
        logLines = Array.isArray(lines) ? lines.slice() : lines != null && lines !== '' ? [String(lines)] : [];
        syncLogEl();
    }

    window.seedLogLines = seedLogLines;

    function showAppAlert(title, body) {
        const t = title != null ? String(title) : '';
        const b = body != null && body !== '' ? String(body) : '';
        writeLog(b ? t + ' — ' + b : t);
        window.alert(b ? t + '\n\n' + b : t);
    }

    let appConfirmResolve = null;
    let appConfirmOkOnly = false;

    function closeAppConfirm(result) {
        const root = document.getElementById('appConfirmOverlay');
        const cancelBtn = document.getElementById('appConfirmCancel');
        if (root) {
            root.hidden = true;
            root.setAttribute('aria-hidden', 'true');
        }
        if (cancelBtn) cancelBtn.hidden = false;
        appConfirmOkOnly = false;
        if (appConfirmResolve) {
            appConfirmResolve(!!result);
            appConfirmResolve = null;
        }
        if (typeof scheduleWaveformFocusRestore === 'function') {
            scheduleWaveformFocusRestore();
        }
    }

    function showAppConfirm(title, body, options) {
        const root = document.getElementById('appConfirmOverlay');
        const titleEl = document.getElementById('appConfirmTitle');
        const bodyEl = document.getElementById('appConfirmBody');
        const cancelBtn = document.getElementById('appConfirmCancel');
        const okBtn = document.getElementById('appConfirmOk');
        if (!root || !titleEl || !bodyEl || !cancelBtn || !okBtn) return Promise.resolve(false);

        const opts = options && typeof options === 'object' ? options : {};
        const okOnly = !!opts.okOnly;
        const t = title != null ? String(title) : '';
        const b = body != null && body !== '' ? String(body) : '';
        const logLine =
            opts.logLine != null && String(opts.logLine).trim() !== ''
                ? String(opts.logLine)
                : b
                  ? t + ' — ' + b
                  : t;
        writeLog(logLine);

        titleEl.textContent = t;
        bodyEl.textContent = b;
        cancelBtn.hidden = okOnly;
        appConfirmOkOnly = okOnly;
        root.hidden = false;
        root.setAttribute('aria-hidden', 'false');

        return new Promise((resolve) => {
            appConfirmResolve = resolve;
            requestAnimationFrame(() => {
                (okOnly ? okBtn : cancelBtn).focus();
            });
        });
    }

    function requestAppNotice(title, body, options) {
        const opts = Object.assign({}, options, { okOnly: true });
        return showAppConfirm(title, body, opts).then(() => true);
    }

    window.showAppConfirm = showAppConfirm;
    window.requestAppNotice = requestAppNotice;

    function requestAppConfirm(title, body, cancelLogMsg, options) {
        const promise =
            typeof showAppConfirm === 'function'
                ? showAppConfirm(title, body, options)
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
            if (matchUserShortcut(e, 'cancelEditing', { allowRepeat: true })) {
                e.preventDefault();
                closeAppConfirm(appConfirmOkOnly);
            }
        });
    })();

    function clearLog() {
        logLines = [];
        if (!logEl) return;
        logEl.innerText = '';
        logEl.scrollTop = 0;
    }

    async function copyLogToClipboard() {
        const text = logLines.join('\n');
        if (!text) return false;
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) {}
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (_) {
            ok = false;
        }
        document.body.removeChild(ta);
        return ok;
    }

    function writeLog(m, opt) {
        let formattedLine = null;
        if (logEl) {
            const now = new Date();
            const time =
                '[' +
                String(now.getHours()).padStart(2, '0') +
                ':' +
                String(now.getMinutes()).padStart(2, '0') +
                ':' +
                String(now.getSeconds()).padStart(2, '0') +
                ']';
            formattedLine = time + ' - ' + m;
            logLines.push(formattedLine);
            if (logLines.length > LOG_MAX_LINES) {
                logLines.splice(0, logLines.length - LOG_MAX_LINES);
            }
            syncLogEl();
        }
    }

    window.clearLog = clearLog;

    (function bindLogActionButtons() {
        const clearBtn = document.getElementById('logClearBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                clearLog();
            });
        }
        const copyBtn = document.getElementById('logCopyBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                const ok = await copyLogToClipboard();
                if (ok) {
                    writeLog('Log copied to clipboard');
                } else {
                    writeLog('Log copy failed');
                }
            });
        }
    })();

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

    /**
     * @param {string} [kind] 'notice' = 長め表示, 'error' = 赤トースト, 省略 = 通常（短い・白）
     */
    function flashSeekHint(primary, secondary, kind) {
        const root = document.getElementById('seekFlashOverlay');
        const pEl = document.getElementById('seekFlashPrimary');
        const sEl = document.getElementById('seekFlashSecondary');
        if (!root || !pEl || !sEl) return;
        clearTimeout(seekFlashHideTimer);
        clearTimeout(seekFlashAriaTimer);

        root.classList.remove('seek-flash--notice', 'seek-flash--error');
        if (kind === 'notice') {
            root.classList.add('seek-flash--notice');
        } else if (kind === 'error') {
            root.classList.add('seek-flash--error');
        }

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
        const isError = kind === 'error';
        const holdMs = isNotice ? 2100 : isError ? 2600 : 680;
        const fadeOutMs = 820;
        seekFlashHideTimer = setTimeout(() => {
            root.classList.remove('seek-flash--visible');
        }, holdMs);
        seekFlashAriaTimer = setTimeout(() => {
            seekFlashAriaTimer = 0;
            root.setAttribute('aria-hidden', 'true');
            root.classList.remove('seek-flash--notice', 'seek-flash--error');
        }, holdMs + fadeOutMs + 40);
    }

    /** シークバースクラブ用（通常トースト: kind 省略） */
    function flashSeekScrubThrottled(t) {
        const now = performance.now();
        if (now - lastSeekFlashScrubAt < 200) return;
        lastSeekFlashScrubAt = now;
        flashSeekHint('Scrub', formatTimecodeForTransport(t), undefined);
    }

    /** ブラウザ内ユーザー設定（モニター床・Loop 等）。Import/Export・IndexedDB セッションとは別。 */
    function readPrefs() {
        try {
            const raw = localStorage.getItem(LS_PREFS_KEY);
            let j = {};
            if (raw) {
                const parsed = JSON.parse(raw);
                j = parsed && typeof parsed === 'object' ? parsed : {};
            }
            return j;
        } catch (_) {
            return {};
        }
    }

    function writePrefs() {
        try {
            const prev = readPrefs();
            const payload = {
                loopPlayback: getLoopPlaybackEnabled(),
            };
            if (prev.exportMediaInclude && typeof prev.exportMediaInclude === 'object') {
                payload.exportMediaInclude = prev.exportMediaInclude;
            }
            if (typeof getWaveformLaneUiPersistSnapshot === 'function') {
                payload.laneUi = getWaveformLaneUiPersistSnapshot();
            }
            if (typeof getMonitorUiPersistSnapshot === 'function') {
                payload.monitorPrefs = getMonitorUiPersistSnapshot();
            } else if (prev.monitorPrefs && typeof prev.monitorPrefs === 'object') {
                payload.monitorPrefs = prev.monitorPrefs;
            }
            if (typeof getMusicalGridPersistSnapshot === 'function') {
                payload.musicalGrid = getMusicalGridPersistSnapshot();
            } else if (prev.musicalGrid && typeof prev.musicalGrid === 'object') {
                payload.musicalGrid = prev.musicalGrid;
            }
            if (typeof getMusicalGridVisible === 'function') {
                payload.musicalGridVisible = getMusicalGridVisible();
            } else if (typeof prev.musicalGridVisible === 'boolean') {
                payload.musicalGridVisible = prev.musicalGridVisible;
            }
            if (typeof getMusicalGridPhraseFillVisible === 'function') {
                payload.musicalGridPhraseFillVisible = getMusicalGridPhraseFillVisible();
            } else if (typeof prev.musicalGridPhraseFillVisible === 'boolean') {
                payload.musicalGridPhraseFillVisible = prev.musicalGridPhraseFillVisible;
            }
            if (typeof window.isTimecodeOverlayUserHidden === 'function') {
                payload.timecodeOverlayHidden = window.isTimecodeOverlayUserHidden();
            } else if (typeof prev.timecodeOverlayHidden === 'boolean') {
                payload.timecodeOverlayHidden = prev.timecodeOverlayHidden;
            }
            localStorage.setItem(LS_PREFS_KEY, JSON.stringify(payload));
        } catch (_) {}
    }
