    const APP_VERSION = '0.01';
    const APP_VERSION_LABEL = 'v' + APP_VERSION;

    const APP_CHANGELOG = [
        {
            version: '0.01',
            date: '2026年5月25日',
            items: [],
        },
    ];

    (function applyAppVersionToUi() {
        document.title = 'MGA CineAudio Reviewer · ' + APP_VERSION_LABEL;

        const badge = document.querySelector('.version-badge');
        if (badge) badge.textContent = APP_VERSION_LABEL;
    })();
