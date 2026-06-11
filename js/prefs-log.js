/**
 * prefs-log.js — localStorage 設定の読み書き、ログパネル、確認ダイアログ、writeLog。
 */
    let logLines = [];
    let debugLogEnabled = false;
    /** W/E Only フィルタ（localStorage のユーザー設定。Import/Export 対象外） */
    let logWeOnlyFilter = false;

    const LOG_LEVEL_TAG = { warn: '[Warning]', error: '[Error]' };

    function stripLogLevelTag(message) {
        return String(message).replace(/^\[(?:Warning|Error)\]\s+/i, '');
    }

    function formatLogMessageBody(message, level) {
        const body = stripLogLevelTag(message);
        const tag = LOG_LEVEL_TAG[level];
        return tag ? tag + ' ' + body : body;
    }

    function logEntryLevel(entry) {
        if (entry && entry.level) return entry.level;
        const raw = logEntryPlainText(entry);
        const msg = raw.replace(/^\[[\d:]+\]\s*-\s*/, '');
        return classifyLogLevel(stripLogLevelTag(msg));
    }

    function isLogEntryWarnOrError(entry) {
        const level = logEntryLevel(entry);
        return level === 'warn' || level === 'error';
    }

    function getLogEntriesForDisplay() {
        if (!logWeOnlyFilter) return logLines;
        return logLines.filter(isLogEntryWarnOrError);
    }

    /** @typedef {'info'|'warn'|'error'} LogLevel */

    /**
     * ログ行の重大度（明示指定がなければメッセージ内容から推定）。
     * info: 通常操作・状態通知
     * warn: フォールバック・スキップ・制約による未適用（動作は継続）
     * error: 保存/読込/デコード/再生など、操作またはデータが成立しなかった
     */
    function classifyLogLevel(message, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (o.level === 'info' || o.level === 'warn' || o.level === 'error') {
            return o.level;
        }
        const m = stripLogLevelTag(String(message));
        if (
            /Session (save|read) failed\b/i.test(m) ||
            /\brestore failed\b/i.test(m) ||
            /\bfailed —/i.test(m) ||
            /Import Review: failed/i.test(m) ||
            /Export WebM: failed/i.test(m) ||
            /Export Review: failed/i.test(m) ||
            /All Clear failed/i.test(m) ||
            /Transport: play failed/i.test(m) ||
            /\bdecode failed\b/i.test(m) ||
            /WAV load failed/i.test(m) ||
            /clipboard (copy|read) failed/i.test(m) ||
            /\bpaste failed\b/i.test(m) ||
            /Session: rejected/i.test(m) ||
            /\[RegionRestore\] step\/error/i.test(m) ||
            /\bpersist failed\b/i.test(m) ||
            /\bsave failed\b/i.test(m)
        ) {
            return 'error';
        }
        if (
            /\bskipped\b/i.test(m) ||
            /\bunavailable\b/i.test(m) ||
            /\bincomplete\b/i.test(m) ||
            /\bnot applied\b/i.test(m) ||
            /\bnot ready\b/i.test(m) ||
            /\bnot drawn\b/i.test(m) ||
            /\busing embedded\b/i.test(m) ||
            /\bfallback\b/i.test(m) ||
            /\btimeout\b/i.test(m) ||
            /\btoo large\b/i.test(m) ||
            /\bcould not copy\b/i.test(m) ||
            /\bcould not measure\b/i.test(m) ||
            /\bcould not restore\b/i.test(m) ||
            /\bcould not complete\b/i.test(m) ||
            /\bmaximum track count\b/i.test(m) ||
            /\bmodule not ready\b/i.test(m) ||
            /\bcancel requested\b/i.test(m) ||
            /\bauto-retry stopped\b/i.test(m) ||
            /\bcannot (swap|join|bond)\b/i.test(m) ||
            /\bplayback wait timeout\b/i.test(m) ||
            /\b   ! /i.test(m) ||
            /Key shift not ready/i.test(m) ||
            /warmup skipped/i.test(m) ||
            /output limited to 0 dB/i.test(m) ||
            /no supported files/i.test(m)
        ) {
            return 'warn';
        }
        return 'info';
    }

    function normalizeLogEntry(raw) {
        if (raw && typeof raw === 'object' && raw.text != null) {
            const text = String(raw.text);
            const level = raw.level || logEntryLevel({ text, level: raw.level });
            return { text, level };
        }
        const text = String(raw);
        return { text, level: classifyLogLevel(text) };
    }

    function logEntryPlainText(entry) {
        return entry && entry.text != null ? String(entry.text) : String(entry);
    }

    function isDebugLogEnabled() {
        return !!debugLogEnabled;
    }

    function getEffectiveLogMaxLines() {
        return debugLogEnabled ? 0 : LOG_MAX_LINES;
    }

    function trimLogLinesToMax() {
        const max = getEffectiveLogMaxLines();
        if (max > 0 && logLines.length > max) {
            logLines.splice(0, logLines.length - max);
        }
    }

    function isLogWeOnlyFilterEnabled() {
        return !!logWeOnlyFilter;
    }

    function syncLogWeOnlyCheckbox() {
        const cb = document.getElementById('logWeOnlyCheckbox');
        if (cb) cb.checked = !!logWeOnlyFilter;
    }

    function setLogWeOnlyFilter(on, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        logWeOnlyFilter = !!on;
        syncLogWeOnlyCheckbox();
        syncLogEl();
        if (o.persist !== false && typeof writePrefs === 'function') {
            writePrefs();
        }
    }

    function applyLogWeOnlyFromPrefs(prefs) {
        const p = prefs && typeof prefs === 'object' ? prefs : {};
        setLogWeOnlyFilter(p.logWeOnlyFilter === true, { persist: false });
    }

    function syncDebugLogCheckbox() {
        const cb = document.getElementById('logDebugCheckbox');
        if (cb) cb.checked = !!debugLogEnabled;
    }

    function applyDebugLogFromPrefs(prefs) {
        const p = prefs && typeof prefs === 'object' ? prefs : {};
        setDebugLogEnabled(p.debugLogEnabled === true, { persist: false, logChange: false });
    }

    function setDebugLogEnabled(on, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const next = !!on;
        const changed = next !== debugLogEnabled;
        debugLogEnabled = next;
        syncDebugLogCheckbox();
        if (o.persist !== false && typeof writePrefs === 'function') {
            writePrefs();
        }
        if (!next) {
            trimLogLinesToMax();
            syncLogEl();
        }
        if (changed && o.logChange !== false && typeof writeLog === 'function') {
            if (next) {
                if (typeof writeLogWarn === 'function') {
                    writeLogWarn(
                        'Test: sample warning (for W/E Only filter and [Warning] tag check)',
                    );
                }
                if (typeof writeLogError === 'function') {
                    writeLogError(
                        'Test: sample error (for W/E Only filter and [Error] tag check)',
                    );
                }
                writeLog(
                    'Debug Log enabled ([RegionRestore], [MusicalSlot], [KeyPlayback], [VideoAnalyzer], [WaveformViewport], etc.)',
                );
            } else {
                writeLog('Debug Log disabled');
            }
        }
    }

    window.isDebugLogEnabled = isDebugLogEnabled;
    window.setDebugLogEnabled = setDebugLogEnabled;
    window.applyDebugLogFromPrefs = applyDebugLogFromPrefs;
    window.isLogWeOnlyFilterEnabled = isLogWeOnlyFilterEnabled;
    window.setLogWeOnlyFilter = setLogWeOnlyFilter;
    window.applyLogWeOnlyFromPrefs = applyLogWeOnlyFromPrefs;
    window.classifyLogLevel = classifyLogLevel;

    function syncLogEl() {
        if (!logEl) return;
        logEl.replaceChildren();
        const visible = getLogEntriesForDisplay();
        for (let i = 0; i < visible.length; i++) {
            const entry = visible[i];
            const line = document.createElement('div');
            const level = logEntryLevel(entry);
            line.className = 'log-line log-line--' + level;
            line.textContent = logEntryPlainText(entry);
            logEl.appendChild(line);
        }
        logEl.scrollTop = logEl.scrollHeight;
    }

    function seedLogLines(lines) {
        if (Array.isArray(lines)) {
            logLines = lines.map(normalizeLogEntry);
        } else if (lines != null && lines !== '') {
            logLines = [normalizeLogEntry(lines)];
        } else {
            logLines = [];
        }
        syncLogEl();
    }

    window.seedLogLines = seedLogLines;

    function showAppAlert(title, body, options) {
        const opts = options && typeof options === 'object' ? options : {};
        const t = title != null ? String(title) : '';
        const b = body != null && body !== '' ? String(body) : '';
        if (opts.log !== false) {
            const logLine =
                opts.logLine != null && String(opts.logLine).trim() !== ''
                    ? String(opts.logLine)
                    : b
                      ? t + ' — ' + b
                      : t;
            writeLog(logLine);
        }
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
        logEl.replaceChildren();
        logEl.scrollTop = 0;
    }

    async function copyLogToClipboard() {
        const text = getLogEntriesForDisplay().map(logEntryPlainText).join('\n');
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
        const level = classifyLogLevel(m, opt);
        const formattedLine = time + ' - ' + formatLogMessageBody(m, level);
        logLines.push({ text: formattedLine, level });
        trimLogLinesToMax();
        syncLogEl();
    }

    function writeLogWarn(m, opt) {
        writeLog(m, Object.assign({}, opt, { level: 'warn' }));
    }

    function writeLogError(m, opt) {
        writeLog(m, Object.assign({}, opt, { level: 'error' }));
    }

    window.writeLogWarn = writeLogWarn;
    window.writeLogError = writeLogError;

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
                    writeLog('Log could not copy');
                }
            });
        }
        const debugCb = document.getElementById('logDebugCheckbox');
        if (debugCb) {
            syncDebugLogCheckbox();
            debugCb.addEventListener('change', () => {
                setDebugLogEnabled(debugCb.checked);
            });
        }
        const weOnlyCb = document.getElementById('logWeOnlyCheckbox');
        if (weOnlyCb) {
            syncLogWeOnlyCheckbox();
            weOnlyCb.addEventListener('change', () => {
                setLogWeOnlyFilter(weOnlyCb.checked);
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
    let seekFlashShowGen = 0;

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
        const gen = ++seekFlashShowGen;

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
        root.classList.remove('seek-flash--visible');
        requestAnimationFrame(() => {
            if (gen !== seekFlashShowGen) return;
            root.classList.add('seek-flash--visible');
        });

        const isNotice = kind === 'notice';
        const isError = kind === 'error';
        const holdMs = isNotice ? 2100 : isError ? 2600 : 680;
        const fadeOutMs = 820;
        seekFlashHideTimer = setTimeout(() => {
            if (gen !== seekFlashShowGen) return;
            root.classList.remove('seek-flash--visible');
        }, holdMs);
        seekFlashAriaTimer = setTimeout(() => {
            if (gen !== seekFlashShowGen) return;
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
            if (typeof getMetronomeClickEnabled === 'function') {
                payload.metronomeClickEnabled = getMetronomeClickEnabled();
            } else if (typeof prev.metronomeClickEnabled === 'boolean') {
                payload.metronomeClickEnabled = prev.metronomeClickEnabled;
            }
            if (typeof window.isTimecodeOverlayUserHidden === 'function') {
                payload.timecodeOverlayHidden = window.isTimecodeOverlayUserHidden();
            } else             if (typeof prev.timecodeOverlayHidden === 'boolean') {
                payload.timecodeOverlayHidden = prev.timecodeOverlayHidden;
            }
            payload.debugLogEnabled = isDebugLogEnabled();
            payload.logWeOnlyFilter = isLogWeOnlyFilterEnabled();
            if (typeof getWaveformLaneHeightScale === 'function') {
                payload.waveformLaneHeightScale = getWaveformLaneHeightScale();
            } else             if (typeof prev.waveformLaneHeightScale === 'number') {
                payload.waveformLaneHeightScale = prev.waveformLaneHeightScale;
            }
            if (typeof getLayoutDockPersistSnapshot === 'function') {
                payload.layoutDock = getLayoutDockPersistSnapshot();
            } else if (prev.layoutDock && typeof prev.layoutDock === 'object') {
                payload.layoutDock = prev.layoutDock;
            }
            localStorage.setItem(LS_PREFS_KEY, JSON.stringify(payload));
        } catch (_) {}
    }
