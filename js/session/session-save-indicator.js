/**
 * session-save-indicator.js — セッション保存状態（HDD アクセスランプ風）
 */
    let sessionSaveDebounceSession = false;
    let sessionSaveDebounceLayout = false;
    let sessionSaveWriteActive = 0;
    let sessionSaveFadeTimer = null;
    const SESSION_SAVE_FADE_MS = 1000;

    function syncSessionSaveIndicator() {
        const el = document.getElementById('sessionSaveIndicator');
        if (!el) return;
        const pending = sessionSaveDebounceSession || sessionSaveDebounceLayout;
        const busy = sessionSaveWriteActive > 0;
        const fading = el.classList.contains('session-save-indicator-chip--fade-out');
        el.classList.toggle('session-save-indicator-chip--pending', pending && !busy && !fading);
        el.classList.toggle('session-save-indicator-chip--busy', busy);
        const textEl = el.querySelector('.session-save-indicator__text');
        if (textEl) textEl.textContent = (busy || fading) ? 'SAVING' : 'SAVED';
        if (busy) {
            el.title = msg('ui.sessionSave.busy');
        } else if (pending) {
            el.title = msg('ui.sessionSave.pending');
        } else {
            el.title = msg('ui.sessionSave.idle');
        }
    }

    function setSessionSaveDebounceActive(kind, active) {
        const on = !!active;
        if (kind === 'layout') {
            sessionSaveDebounceLayout = on;
        } else {
            sessionSaveDebounceSession = on;
        }
        syncSessionSaveIndicator();
    }

    function noteSessionSaveWriteStart() {
        const el = document.getElementById('sessionSaveIndicator');
        if (el) {
            clearTimeout(sessionSaveFadeTimer);
            sessionSaveFadeTimer = null;
            el.classList.remove('session-save-indicator-chip--fade-out');
        }
        sessionSaveWriteActive += 1;
        syncSessionSaveIndicator();
    }

    function noteSessionSaveWriteEnd() {
        sessionSaveWriteActive = Math.max(0, sessionSaveWriteActive - 1);
        const el = document.getElementById('sessionSaveIndicator');
        if (sessionSaveWriteActive > 0 || !el) {
            syncSessionSaveIndicator();
            return;
        }
        el.classList.remove('session-save-indicator-chip--busy');
        el.classList.add('session-save-indicator-chip--fade-out');
        syncSessionSaveIndicator();
        clearTimeout(sessionSaveFadeTimer);
        sessionSaveFadeTimer = setTimeout(() => {
            sessionSaveFadeTimer = null;
            el.classList.remove('session-save-indicator-chip--fade-out');
            syncSessionSaveIndicator();
        }, SESSION_SAVE_FADE_MS);
    }

    window.setSessionSaveDebounceActive = setSessionSaveDebounceActive;
    window.noteSessionSaveWriteStart = noteSessionSaveWriteStart;
    window.noteSessionSaveWriteEnd = noteSessionSaveWriteEnd;
    window.syncSessionSaveIndicator = syncSessionSaveIndicator;
