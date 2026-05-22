    const LOG_MAX_LINES = 500;

    function syncLogPanelHeightToShortcutGuide() {
        const guide = document.querySelector('.bottom-info .shortcut-guide');
        if (!guide || !logEl) return;
        const h = Math.max(148, guide.offsetHeight);
        logEl.style.height = h + 'px';
        logEl.style.minHeight = h + 'px';
        logEl.style.maxHeight = h + 'px';
    }

    function showAppAlert(title, body) {
        const t = title != null ? String(title) : '';
        const b = body != null && body !== '' ? String(body) : '';
        writeLog(b ? t + ' — ' + b : t);
        window.alert(b ? t + '\n\n' + b : t);
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
        syncLogPanelHeightToShortcutGuide();
    }

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
        const holdMs = isNotice ? 2100 : 340;
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

    (function initLogShortcutHeightSync() {
        const g = document.querySelector('.bottom-info .shortcut-guide');
        const scheduleSync = () => {
            requestAnimationFrame(() => {
                syncLogPanelHeightToShortcutGuide();
                requestAnimationFrame(syncLogPanelHeightToShortcutGuide);
            });
        };
        if (g && typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(() => syncLogPanelHeightToShortcutGuide()).observe(g);
        }
        scheduleSync();
        window.addEventListener('load', scheduleSync);
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(scheduleSync).catch(() => {});
        }
    })();

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
            };
            if (typeof getWaveformLaneUiPersistSnapshot === 'function') {
                payload.laneUi = getWaveformLaneUiPersistSnapshot();
            }
            localStorage.setItem(LS_PREFS_KEY, JSON.stringify(payload));
        } catch (_) {}
    }
