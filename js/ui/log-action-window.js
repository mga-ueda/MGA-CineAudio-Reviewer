/**
 * log-action-window.js — F10 から Action ログのみを別ウィンドウ表示。
 * メインログの Actions フィルタと同じ行（tier=action および Warning/Error）。
 */
(function actionLogWindowModule() {
    const WINDOW_NAME = 'MGAActionLogWindow';
    const LOG_LEVEL_TAG = { warn: '[Warning]', error: '[Error]' };

    let enabled = false;
    let popupWin = null;
    let popupLogEl = null;
    let closePollId = null;

    const POPUP_STYLES =
        'html,body{margin:0;height:100%;background:#1e2128;color:#c4cad6;' +
        'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;}' +
        '#actionLog{box-sizing:border-box;height:100vh;overflow-y:auto;padding:8px 10px;' +
        'display:flex;flex-direction:column;gap:1px;}' +
        '.log-line{display:flex;align-items:baseline;gap:6px;white-space:pre-wrap;word-break:break-word;line-height:1.35;}' +
        '.log-line__time{flex:0 0 auto;color:#9aa3b5;font-variant-numeric:tabular-nums;}' +
        '.log-line__cat{flex:0 0 4.5rem;color:#8ec8ff;font-weight:600;letter-spacing:.02em;}' +
        '.log-line__msg{flex:1 1 auto;min-width:0;}' +
        '.log-line__level-tag{font-weight:700;}' +
        '.log-line--tier-action .log-line__msg{color:#f4f6fb;}' +
        '.log-line--warn .log-line__msg,.log-line--warn .log-line__level-tag{color:#f0c060;}' +
        '.log-line--error .log-line__msg,.log-line--error .log-line__level-tag{color:#ff7a7a;}';

    function isActionEntry(entry) {
        if (typeof window.isLogEntryVisibleInOpsFilter === 'function') {
            return window.isLogEntryVisibleInOpsFilter(entry);
        }
        return !!(entry && entry.tier === 'action');
    }

    function logEntryLevel(entry) {
        if (entry && entry.level) return entry.level;
        if (typeof window.classifyLogLevel === 'function') {
            return window.classifyLogLevel(entry && entry.message != null ? entry.message : '');
        }
        return 'info';
    }

    function syncPanelCheckbox() {
        if (typeof window.syncActionLogWindowCheckbox === 'function') {
            window.syncActionLogWindowCheckbox();
        }
    }

    function stopClosePoll() {
        if (closePollId != null) {
            clearInterval(closePollId);
            closePollId = null;
        }
    }

    function startClosePoll() {
        stopClosePoll();
        closePollId = setInterval(() => {
            if (enabled && popupWin && popupWin.closed) {
                handlePopupClosed();
            }
        }, 400);
    }

    function handlePopupClosed() {
        popupWin = null;
        popupLogEl = null;
        stopClosePoll();
        if (!enabled) return;
        enabled = false;
        syncPanelCheckbox();
        if (typeof writePrefs === 'function') writePrefs();
    }

    function createLogLineElement(doc, entry) {
        const line = doc.createElement('div');
        const level = logEntryLevel(entry);
        line.className =
            'log-line log-line--' +
            level +
            ' log-line--tier-' +
            (entry.tier || 'detail');

        const timeEl = doc.createElement('span');
        timeEl.className = 'log-line__time';
        timeEl.textContent = '[' + (entry.time || '00:00:00') + ']';

        const catEl = doc.createElement('span');
        catEl.className = 'log-line__cat';
        catEl.textContent = entry.category || 'System';

        const msgEl = doc.createElement('span');
        msgEl.className = 'log-line__msg';
        if (level === 'warn' || level === 'error') {
            const tag = doc.createElement('span');
            tag.className = 'log-line__level-tag';
            tag.textContent = LOG_LEVEL_TAG[level] + ' ';
            msgEl.appendChild(tag);
        }
        msgEl.appendChild(doc.createTextNode(entry.message || ''));

        line.appendChild(timeEl);
        line.appendChild(catEl);
        line.appendChild(msgEl);
        return line;
    }

    function initPopupDocument(win) {
        const doc = win.document;
        doc.open();
        doc.write(
            '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">' +
            '<title>Action Log — MGA CineAudio Reviewer</title>' +
            '<style>' +
            POPUP_STYLES +
            '</style></head><body><div id="actionLog"></div></body></html>',
        );
        doc.close();
        return doc.getElementById('actionLog');
    }

    function closePopup() {
        stopClosePoll();
        if (popupWin && !popupWin.closed) {
            try {
                popupWin.close();
            } catch (_) {}
        }
        popupWin = null;
        popupLogEl = null;
    }

    function getActionEntries() {
        if (typeof window.getActionLogWindowEntries === 'function') {
            return window.getActionLogWindowEntries();
        }
        return [];
    }

    function syncAllEntries() {
        if (!popupLogEl || !popupWin || popupWin.closed) return;
        popupLogEl.replaceChildren();
        const entries = getActionEntries();
        const doc = popupWin.document;
        for (let i = 0; i < entries.length; i++) {
            popupLogEl.appendChild(createLogLineElement(doc, entries[i]));
        }
        popupLogEl.scrollTop = popupLogEl.scrollHeight;
    }

    function openPopup() {
        if (popupWin && !popupWin.closed) {
            popupWin.focus();
            return true;
        }
        const features =
            'width=760,height=420,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes';
        const win = window.open('about:blank', WINDOW_NAME, features);
        if (!win) return false;
        popupWin = win;
        popupLogEl = initPopupDocument(win);
        win.addEventListener('beforeunload', handlePopupClosed);
        startClosePoll();
        syncAllEntries();
        return true;
    }

    function setActionLogWindowOpen(on, options) {
        const opts = options && typeof options === 'object' ? options : {};
        const silent = !!opts.silent;
        const skipPersist = !!opts.skipPersist;
        const want = !!on;

        if (want === enabled && (!want || (popupWin && !popupWin.closed))) {
            syncPanelCheckbox();
            return;
        }

        enabled = want;
        if (want) {
            const ok = openPopup();
            if (!ok) {
                enabled = false;
                if (!silent && typeof writeLog === 'function') {
                    writeLog(
                        '[ActionLogWindow] popup blocked — allow popups for this site, then toggle again',
                    );
                }
            }
        } else {
            closePopup();
        }

        syncPanelCheckbox();
        if (!skipPersist && typeof writePrefs === 'function') writePrefs();
    }

    function appendEntryToPopup(entry) {
        if (!popupLogEl || !popupWin || popupWin.closed) return;
        popupLogEl.appendChild(createLogLineElement(popupWin.document, entry));
        popupLogEl.scrollTop = popupLogEl.scrollHeight;
    }

    window.isActionLogWindowEnabled = function isActionLogWindowEnabled() {
        return !!enabled;
    };
    window.setActionLogWindowOpen = setActionLogWindowOpen;

    window.notifyActionLogWindowEntry = function notifyActionLogWindowEntry(entry) {
        if (!enabled || !isActionEntry(entry)) return;
        if (!popupWin || popupWin.closed) {
            if (!openPopup()) {
                setActionLogWindowOpen(false, { silent: true });
                return;
            }
        }
        appendEntryToPopup(entry);
    };

    window.notifyActionLogWindowClear = function notifyActionLogWindowClear() {
        if (popupLogEl) popupLogEl.replaceChildren();
    };

    window.notifyActionLogWindowResync = function notifyActionLogWindowResync() {
        if (enabled) syncAllEntries();
    };
})();
