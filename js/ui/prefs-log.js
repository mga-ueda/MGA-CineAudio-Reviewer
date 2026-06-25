/**
 * prefs-log.js — localStorage 設定、ログパネル UI、確認ダイアログ。
 * ログデータモデル・表示形式は log-core.js。
 */
    let logLines = [];
    /** W/E Only フィルタ（セッション内のみ。デフォルト OFF、保存しない） */
    let logWeOnlyFilter = false;
    /** Actions — tier=action のみ（セッション内のみ。デフォルト OFF、保存しない） */
    let logActionsOnlyFilter = false;

    const LOG_LEVEL_TAG = { warn: '[Warning]', error: '[Error]' };

    function logEntryLevel(entry) {
        if (entry && entry.level) return entry.level;
        if (typeof window.classifyLogLevel === 'function') {
            return window.classifyLogLevel(entry && entry.message != null ? entry.message : '');
        }
        return 'info';
    }

    function isLogEntryWarnOrError(entry) {
        const level = logEntryLevel(entry);
        return level === 'warn' || level === 'error';
    }

    /** F10 の DEBUG_LOG が 1 つでも ON の間は diag tier を UI に出さない（内部蓄積・DL は全行）。 */
    function isDiagLogUiSuppressed() {
        return (
            typeof window.isAnyDebugLogCategoryEnabled === 'function' &&
            window.isAnyDebugLogCategoryEnabled()
        );
    }

    function isLogEntryDiagTier(entry) {
        return !!(entry && entry.tier === 'diag');
    }

    window.isDiagLogUiSuppressed = isDiagLogUiSuppressed;

    function getLogEntriesForDisplay() {
        let entries = logLines;
        if (isDiagLogUiSuppressed()) {
            entries = entries.filter((e) => !isLogEntryDiagTier(e));
        }
        if (logWeOnlyFilter) {
            entries = entries.filter(isLogEntryWarnOrError);
        }
        if (logActionsOnlyFilter) {
            entries = entries.filter(
                typeof window.isLogEntryVisibleInOpsFilter === 'function'
                    ? window.isLogEntryVisibleInOpsFilter
                    : (e) => e && e.tier === 'action',
            );
        }
        return entries;
    }

    function getActionLogWindowEntries() {
        let entries = logLines;
        if (isDiagLogUiSuppressed()) {
            entries = entries.filter((e) => !isLogEntryDiagTier(e));
        }
        return entries.filter(
            typeof window.isLogEntryVisibleInOpsFilter === 'function'
                ? window.isLogEntryVisibleInOpsFilter
                : (e) => e && e.tier === 'action',
        );
    }

    window.getActionLogWindowEntries = getActionLogWindowEntries;

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
        const m = String(message).replace(/^\[(?:Warning|Error)\]\s+/i, '');
        if (
            /Session (save|read) failed\b/i.test(m) ||
            /\brestore failed\b/i.test(m) ||
            /\bfailed —/i.test(m) ||
            /Import(?: Review)?: failed/i.test(m) ||
            /^Import\s+failed/i.test(m) ||
            /^Import\s+rejected/i.test(m) ||
            /Export WebM: failed/i.test(m) ||
            /Export Wave: failed/i.test(m) ||
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
        if (typeof window.normalizeStoredLogEntry === 'function') {
            return window.normalizeStoredLogEntry(raw);
        }
        const text = raw && raw.text != null ? String(raw.text) : String(raw);
        return { timeMs: Date.now(), time: '00:00:00', tier: 'detail', category: 'System', message: text, level: 'info' };
    }

    function logEntryPlainText(entry) {
        if (typeof window.formatLogEntryPlainText === 'function') {
            return window.formatLogEntryPlainText(entry);
        }
        return entry && entry.message != null ? String(entry.message) : String(entry);
    }

    function getEffectiveLogMaxLines() {
        if (
            typeof window.isAnyDebugLogCategoryEnabled === 'function' &&
            window.isAnyDebugLogCategoryEnabled()
        ) {
            return 0;
        }
        const n = window.LOG_MAX_LINES;
        return typeof n === 'number' && n > 0 ? Math.floor(n) : 500;
    }

    function trimLogLinesToMax() {
        const max = getEffectiveLogMaxLines();
        if (max > 0 && logLines.length > max) {
            logLines.splice(0, logLines.length - max);
            if (typeof window.notifyActionLogWindowResync === 'function') {
                window.notifyActionLogWindowResync();
            }
        }
    }

    function isLogWeOnlyFilterEnabled() {
        return !!logWeOnlyFilter;
    }

    function syncLogWeOnlyCheckbox() {
        const cb = document.getElementById('logWeOnlyCheckbox');
        if (cb) cb.checked = !!logWeOnlyFilter;
    }

    function setLogWeOnlyFilter(on) {
        logWeOnlyFilter = !!on;
        syncLogWeOnlyCheckbox();
        syncLogEl();
    }

    function isLogActionsOnlyFilterEnabled() {
        return !!logActionsOnlyFilter;
    }

    function syncLogActionsOnlyCheckbox() {
        const cb = document.getElementById('logOpsOnlyCheckbox');
        if (cb) cb.checked = !!logActionsOnlyFilter;
    }

    function setLogActionsOnlyFilter(on) {
        logActionsOnlyFilter = !!on;
        syncLogActionsOnlyCheckbox();
        syncLogEl();
    }

    window.isLogWeOnlyFilterEnabled = isLogWeOnlyFilterEnabled;
    window.setLogWeOnlyFilter = setLogWeOnlyFilter;
    window.isLogActionsOnlyFilterEnabled = isLogActionsOnlyFilterEnabled;
    window.setLogActionsOnlyFilter = setLogActionsOnlyFilter;
    window.isLogOpsOnlyFilterEnabled = isLogActionsOnlyFilterEnabled;
    window.setLogOpsOnlyFilter = setLogActionsOnlyFilter;
    window.classifyLogLevel = classifyLogLevel;

    /** Dev constants パネル — DEBUG_LOG 変更後にログ行上限を再適用 */
    window.applyDebugLogToggleSideEffects = function applyDebugLogToggleSideEffects() {
        trimLogLinesToMax();
        syncLogEl();
    };

    function syncLogEl() {
        if (!logEl) return;
        logEl.replaceChildren();
        const visible = getLogEntriesForDisplay();
        for (let i = 0; i < visible.length; i++) {
            const entry = visible[i];
            const line = document.createElement('div');
            const level = logEntryLevel(entry);
            line.className =
                'log-line log-line--' +
                level +
                ' log-line--tier-' +
                (entry.tier || 'detail');

            const timeEl = document.createElement('span');
            timeEl.className = 'log-line__time';
            timeEl.textContent = '[' + (entry.time || '00:00:00') + ']';

            const catEl = document.createElement('span');
            catEl.className = 'log-line__cat';
            catEl.textContent = entry.category || 'System';

            const msgEl = document.createElement('span');
            msgEl.className = 'log-line__msg';
            if (level === 'warn' || level === 'error') {
                const tag = document.createElement('span');
                tag.className = 'log-line__level-tag';
                tag.textContent = LOG_LEVEL_TAG[level] + ' ';
                msgEl.appendChild(tag);
            }
            msgEl.appendChild(document.createTextNode(entry.message || ''));

            line.appendChild(timeEl);
            line.appendChild(catEl);
            line.appendChild(msgEl);
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
        if (typeof window.notifyActionLogWindowResync === 'function') {
            window.notifyActionLogWindowResync();
        }
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
        if (typeof window.notifyActionLogWindowClear === 'function') {
            window.notifyActionLogWindowClear();
        }
    }

    async function copyLogToClipboard() {
        const text = logLines.map(logEntryPlainText).join('\n');
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

    function logDownloadFilename() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return (
            'carlog_' +
            d.getFullYear() +
            pad(d.getMonth() + 1) +
            pad(d.getDate()) +
            pad(d.getHours()) +
            pad(d.getMinutes()) +
            pad(d.getSeconds()) +
            '.txt'
        );
    }

    function downloadLogToFile() {
        const text = logLines.map(logEntryPlainText).join('\n');
        if (!text) return null;
        const fileName = logDownloadFilename();
        try {
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            return fileName;
        } catch (_) {
            return null;
        }
    }

    function appendLogEntry(message, opt) {
        if (!logEl) return null;
        const entry =
            typeof window.createLogEntry === 'function'
                ? window.createLogEntry(message, opt)
                : normalizeLogEntry({ message: String(message), level: opt && opt.level });
        logLines.push(entry);
        trimLogLinesToMax();
        if (!isDiagLogUiSuppressed() || !isLogEntryDiagTier(entry)) {
            syncLogEl();
        }
        if (typeof window.notifyActionLogWindowEntry === 'function') {
            window.notifyActionLogWindowEntry(entry);
        }
        return entry;
    }

    window.appendLogEntry = appendLogEntry;

    function writeLog(m, opt) {
        appendLogEntry(m, opt);
    }

    function writeLogWarn(m, opt) {
        writeLog(m, Object.assign({}, opt, { level: 'warn' }));
    }

    function writeLogError(m, opt) {
        writeLog(m, Object.assign({}, opt, { level: 'error' }));
    }

    window.writeLogWarn = writeLogWarn;
    window.writeLogError = writeLogError;

    function triggerLogDownload() {
        if (!logLines.length) {
            if (typeof writeMetaLog === 'function') {
                writeMetaLog('Log', msg('log.download.empty'));
            } else {
                writeLog(msg('log.download.empty'));
            }
            return;
        }
        const fileName = downloadLogToFile();
        if (fileName) {
            if (typeof writeMetaLog === 'function') {
                writeMetaLog('Log', msg('log.download.saved', fileName));
            } else {
                writeLog(msg('log.download.saved', fileName));
            }
        } else {
            if (typeof writeMetaLog === 'function') {
                writeMetaLog('Log', msg('log.download.failed'));
            } else {
                writeLog(msg('log.download.failed'));
            }
        }
    }

    window.clearLog = clearLog;
    window.copyLogToClipboard = copyLogToClipboard;
    window.downloadLogToFile = downloadLogToFile;
    window.triggerLogDownload = triggerLogDownload;

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
                    if (typeof writeMetaLog === 'function') {
                        writeMetaLog('Log', msg('log.clipboard.copied'));
                    } else {
                        writeLog(msg('log.clipboard.copied'));
                    }
                } else {
                    if (typeof writeMetaLog === 'function') {
                        writeMetaLog('Log', msg('log.clipboard.copyFailed'));
                    } else {
                        writeLog(msg('log.clipboard.copyFailed'));
                    }
                }
            });
        }
        const downloadBtn = document.getElementById('logDownloadBtn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                triggerLogDownload();
            });
        }
        const weOnlyCb = document.getElementById('logWeOnlyCheckbox');
        if (weOnlyCb) {
            syncLogWeOnlyCheckbox();
            weOnlyCb.addEventListener('change', () => {
                setLogWeOnlyFilter(weOnlyCb.checked);
            });
        }
        const opsOnlyCb = document.getElementById('logOpsOnlyCheckbox');
        if (opsOnlyCb) {
            syncLogActionsOnlyCheckbox();
            opsOnlyCb.addEventListener('change', () => {
                setLogActionsOnlyFilter(opsOnlyCb.checked);
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
     * @param {{ center?: boolean }} [opt] center: true で画面中央に表示
     */
    function flashSeekHint(primary, secondary, kind, opt) {
        const root = document.getElementById('seekFlashOverlay');
        const pEl = document.getElementById('seekFlashPrimary');
        const sEl = document.getElementById('seekFlashSecondary');
        if (!root || !pEl || !sEl) return;
        clearTimeout(seekFlashHideTimer);
        clearTimeout(seekFlashAriaTimer);
        const gen = ++seekFlashShowGen;
        const o = opt && typeof opt === 'object' ? opt : {};

        root.classList.remove('seek-flash--notice', 'seek-flash--error', 'seek-flash--center');
        if (kind === 'notice') {
            root.classList.add('seek-flash--notice');
        } else if (kind === 'error') {
            root.classList.add('seek-flash--error');
        }
        if (o.center) {
            root.classList.add('seek-flash--center');
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
            root.classList.remove('seek-flash--notice', 'seek-flash--error', 'seek-flash--center');
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
            if (typeof getMusicalGridRehearsalFillVisible === 'function') {
                payload.musicalGridRehearsalFillVisible = getMusicalGridRehearsalFillVisible();
            } else if (typeof prev.musicalGridRehearsalFillVisible === 'boolean') {
                payload.musicalGridRehearsalFillVisible = prev.musicalGridRehearsalFillVisible;
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
            if (typeof getDevConstantsPersistSnapshot === 'function') {
                payload.devConstants = getDevConstantsPersistSnapshot();
            } else if (prev.devConstants && typeof prev.devConstants === 'object') {
                payload.devConstants = prev.devConstants;
            }
            localStorage.setItem(LS_PREFS_KEY, JSON.stringify(payload));
        } catch (_) {}
    }
