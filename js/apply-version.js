    (function applyAppVersionToUi() {
        document.title = 'MGA CineAudio Reviewer · ' + APP_VERSION_LABEL;

        const badge = document.querySelector('.version-badge');
        if (badge) badge.textContent = APP_VERSION_LABEL;

        if (logEl) {
            logEl.innerText = '> System Ready. (' + APP_VERSION_LABEL + ')';
        }
    })();
