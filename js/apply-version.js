/**
 * apply-version.js — version.js の定数をページ UI（タイトル・バッジ・ログ・changelog）へ反映。
 */
(function applyAppVersionToUi() {
    document.title = 'MGA CineAudio Reviewer · ' + APP_VERSION_LABEL;

    const badge = document.getElementById('appVersionBadge') || document.querySelector('.version-badge');
    if (badge) badge.textContent = APP_VERSION_LABEL;

    if (typeof logEl !== 'undefined' && logEl) {
        logEl.innerText = '> System Ready. (' + APP_VERSION_LABEL + ')';
    }

    const changelogRoot = document.getElementById('appVersionChangelog');
    if (changelogRoot && APP_CHANGELOG && APP_CHANGELOG.length) {
        const frag = document.createDocumentFragment();
        APP_CHANGELOG.forEach((entry) => {
            const h3 = document.createElement('h3');
            h3.textContent = 'v' + entry.version + ' - ' + entry.date;
            frag.appendChild(h3);
            const ul = document.createElement('ul');
            (entry.items || []).forEach((text) => {
                const li = document.createElement('li');
                li.textContent = text;
                ul.appendChild(li);
            });
            frag.appendChild(ul);
        });
        changelogRoot.appendChild(frag);
    }

    function revealVersionInfo() {
        const root = document.getElementById('appVersionChangelog');
        const details = root && root.closest('details');
        if (!details) return;
        details.open = true;
        details.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const summary = details.querySelector('summary');
        if (summary && typeof summary.focus === 'function') {
            summary.focus({ preventScroll: true });
        }
    }

    if (badge) badge.addEventListener('click', revealVersionInfo);
})();
