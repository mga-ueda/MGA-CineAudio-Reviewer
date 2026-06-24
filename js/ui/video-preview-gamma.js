/**
 * video-preview-gamma.js — 動画プレビューのガンマ補正（ホイール・明るくする方向のみ）。
 */
(function videoPreviewGammaModule() {
    const FILTER_ID = 'videoPreviewGammaFilter';
    const GAMMA_MIN = 0.52;
    const GAMMA_MAX = 1.0;
    const GAMMA_STEP = 0.04;
    const GAMMA_NOTICE_HOLD_MS = 1800;
    const GAMMA_NOTICE_FADE_MS = 1100;

    let videoPreviewGamma = GAMMA_MAX;
    let filterInstalled = false;
    let funcR = null;
    let funcG = null;
    let funcB = null;
    let gammaNoticeHideTimer = 0;
    let gammaNoticeShowGen = 0;
    let pendingGammaNotice = false;

    function ensureGammaFilter() {
        if (filterInstalled) return;
        const NS = 'http://www.w3.org/2000/svg';
        let root = document.getElementById('videoPreviewGammaDefs');
        if (!root) {
            root = document.createElementNS(NS, 'svg');
            root.id = 'videoPreviewGammaDefs';
            root.setAttribute('aria-hidden', 'true');
            root.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
            const filter = document.createElementNS(NS, 'filter');
            filter.id = FILTER_ID;
            filter.setAttribute('color-interpolation-filters', 'sRGB');
            const transfer = document.createElementNS(NS, 'feComponentTransfer');
            funcR = document.createElementNS(NS, 'feFuncR');
            funcG = document.createElementNS(NS, 'feFuncG');
            funcB = document.createElementNS(NS, 'feFuncB');
            for (const fn of [funcR, funcG, funcB]) {
                fn.setAttribute('type', 'gamma');
                fn.setAttribute('amplitude', '1');
                fn.setAttribute('exponent', '1');
                fn.setAttribute('offset', '0');
                transfer.appendChild(fn);
            }
            filter.appendChild(transfer);
            root.appendChild(filter);
            document.body.appendChild(root);
        }
        filterInstalled = true;
    }

    function getVideoEl() {
        return typeof videoMain !== 'undefined' ? videoMain : document.getElementById('videoMain');
    }

    function isVideoPreviewGammaNonDefault() {
        return videoPreviewGamma < GAMMA_MAX - 1e-6;
    }

    function getVideoPreviewGammaNoticeEl() {
        return document.getElementById('videoPreviewGammaNotice');
    }

    function getVideoPreviewGammaNoticeValueEl() {
        return document.getElementById('videoPreviewGammaNoticeValue');
    }

    function hideVideoPreviewGammaNotice() {
        clearTimeout(gammaNoticeHideTimer);
        gammaNoticeHideTimer = 0;
        gammaNoticeShowGen += 1;
        const el = getVideoPreviewGammaNoticeEl();
        if (!el) return;
        el.classList.remove('video-frame__gamma-notice--visible');
        el.hidden = true;
        el.setAttribute('aria-hidden', 'true');
    }

    function showVideoPreviewGammaNotice() {
        if (!isVideoPreviewGammaNonDefault()) {
            hideVideoPreviewGammaNotice();
            return;
        }
        if (typeof videoReady !== 'function' || !videoReady()) return;
        const el = getVideoPreviewGammaNoticeEl();
        const valueEl = getVideoPreviewGammaNoticeValueEl();
        if (!el || !valueEl) return;
        clearTimeout(gammaNoticeHideTimer);
        const gen = ++gammaNoticeShowGen;
        valueEl.textContent = formatVideoPreviewGammaNoticeMessage(videoPreviewGamma);
        el.hidden = false;
        el.setAttribute('aria-hidden', 'false');
        el.classList.remove('video-frame__gamma-notice--visible');
        requestAnimationFrame(() => {
            if (gen !== gammaNoticeShowGen) return;
            el.classList.add('video-frame__gamma-notice--visible');
        });
        gammaNoticeHideTimer = setTimeout(() => {
            if (gen !== gammaNoticeShowGen) return;
            el.classList.remove('video-frame__gamma-notice--visible');
            gammaNoticeHideTimer = setTimeout(() => {
                if (gen !== gammaNoticeShowGen) return;
                el.hidden = true;
                el.setAttribute('aria-hidden', 'true');
                gammaNoticeHideTimer = 0;
            }, GAMMA_NOTICE_FADE_MS);
        }, GAMMA_NOTICE_HOLD_MS);
    }

    function tryShowVideoPreviewGammaNotice() {
        if (!pendingGammaNotice) return;
        if (!isVideoPreviewGammaNonDefault()) {
            pendingGammaNotice = false;
            return;
        }
        if (typeof isVideoFilmstripLoadingActive === 'function' && isVideoFilmstripLoadingActive()) {
            return;
        }
        pendingGammaNotice = false;
        showVideoPreviewGammaNotice();
    }

    function scheduleVideoPreviewGammaNotice() {
        if (!isVideoPreviewGammaNonDefault()) {
            pendingGammaNotice = false;
            hideVideoPreviewGammaNotice();
            return;
        }
        pendingGammaNotice = true;
        tryShowVideoPreviewGammaNotice();
    }

    function notifyVideoPreviewPresentationReady() {
        tryShowVideoPreviewGammaNotice();
    }

    function applyVideoPreviewGamma() {
        const v = getVideoEl();
        if (!v) return;
        if (
            typeof isVideoFilmstripLoadingActive === 'function' &&
            isVideoFilmstripLoadingActive()
        ) {
            return;
        }
        if (videoPreviewGamma >= GAMMA_MAX - 1e-6) {
            v.style.filter = '';
            return;
        }
        ensureGammaFilter();
        const exp = String(videoPreviewGamma);
        funcR.setAttribute('exponent', exp);
        funcG.setAttribute('exponent', exp);
        funcB.setAttribute('exponent', exp);
        v.style.filter = 'url(#' + FILTER_ID + ')';
    }

    function setVideoPreviewGammaValue(gamma, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        let next = typeof gamma === 'number' && isFinite(gamma) ? gamma : GAMMA_MAX;
        next = Math.max(GAMMA_MIN, Math.min(GAMMA_MAX, next));
        if (Math.abs(next - videoPreviewGamma) < 1e-6) return false;
        videoPreviewGamma = next;
        applyVideoPreviewGamma();
        if (!o.skipPersist && typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        return true;
    }

    function resetVideoPreviewGamma(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        pendingGammaNotice = false;
        hideVideoPreviewGammaNotice();
        const changed = Math.abs(videoPreviewGamma - GAMMA_MAX) >= 1e-6;
        videoPreviewGamma = GAMMA_MAX;
        applyVideoPreviewGamma();
        if (changed && !o.skipPersist && typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
    }

    function applyVideoPreviewGammaFromSession(gamma) {
        if (typeof gamma !== 'number' || !isFinite(gamma)) {
            resetVideoPreviewGamma({ skipPersist: true });
            return;
        }
        setVideoPreviewGammaValue(gamma, { skipPersist: true });
        scheduleVideoPreviewGammaNotice();
    }

    function getVideoPreviewGammaPersistSnapshot() {
        const g = videoPreviewGamma;
        if (typeof g !== 'number' || !isFinite(g)) return GAMMA_MAX;
        return Math.max(GAMMA_MIN, Math.min(GAMMA_MAX, g));
    }

    function formatVideoPreviewGammaToast(gamma) {
        if (gamma >= GAMMA_MAX - 1e-6) return 'γ 1.00';
        return 'γ ' + gamma.toFixed(2);
    }

    function formatVideoPreviewGammaNoticeMessage(gamma) {
        return 'Gamma set to ' + formatVideoPreviewGammaToast(gamma);
    }

    function adjustVideoPreviewGamma(wheelDir) {
        const before = videoPreviewGamma;
        const next = Math.max(GAMMA_MIN, Math.min(GAMMA_MAX, before + wheelDir * GAMMA_STEP));
        if (Math.abs(next - before) < 1e-6) return false;
        setVideoPreviewGammaValue(next);
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Video', formatVideoPreviewGammaToast(next), 'notice');
        }
        return true;
    }

    function wheelOverVideoPreview(ev) {
        const frame =
            typeof frameMain !== 'undefined' ? frameMain : document.getElementById('frameMain');
        if (!frame || !ev) return false;
        if (typeof ev.composedPath === 'function') {
            return ev.composedPath().includes(frame);
        }
        return !!(ev.target && frame.contains(ev.target));
    }

    function handleVideoPreviewGammaWheel(ev) {
        if (!ev || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return false;
        if (typeof videoReady !== 'function' || !videoReady()) return false;
        if (!wheelOverVideoPreview(ev)) return false;
        const delta = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;
        if (!delta) return false;
        ev.preventDefault();
        ev.stopPropagation();
        const magnitude = Math.min(4, Math.max(1, Math.round(Math.abs(delta) / 40)));
        const wheelDir = delta > 0 ? 1 : -1;
        adjustVideoPreviewGamma(wheelDir * magnitude);
        return true;
    }

    function bindVideoPreviewGammaWheel() {
        const frame =
            typeof frameMain !== 'undefined' ? frameMain : document.getElementById('frameMain');
        if (!frame || frame.dataset.gammaWheelBound === '1') return;
        frame.dataset.gammaWheelBound = '1';
        frame.addEventListener(
            'wheel',
            (ev) => {
                handleVideoPreviewGammaWheel(ev);
            },
            { passive: false, capture: true },
        );
    }

    window.resetVideoPreviewGamma = resetVideoPreviewGamma;
    window.applyVideoPreviewGamma = applyVideoPreviewGamma;
    window.applyVideoPreviewGammaFromSession = applyVideoPreviewGammaFromSession;
    window.getVideoPreviewGammaPersistSnapshot = getVideoPreviewGammaPersistSnapshot;
    window.notifyVideoPreviewPresentationReady = notifyVideoPreviewPresentationReady;
    window.getVideoPreviewGamma = function getVideoPreviewGamma() {
        return videoPreviewGamma;
    };

    bindVideoPreviewGammaWheel();
})();
