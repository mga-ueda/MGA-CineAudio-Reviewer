/**
 * video-preview-gamma.js — 動画プレビューのガンマ補正（ホイール・明るくする方向のみ）。
 */
(function videoPreviewGammaModule() {
    const FILTER_ID = 'videoPreviewGammaFilter';
    const FILMSTRIP_BLUR_FILTER_ID = 'videoFilmstripMotionBlurFilter';
    const GAMMA_MIN = 0.52;
    const GAMMA_MAX = 1.0;
    const GAMMA_STEP = 0.04;

    let videoPreviewGamma = GAMMA_MAX;
    let pendingVideoPreviewGammaFromSession = null;
    let filterInstalled = false;
    let funcR = null;
    let funcG = null;
    let funcB = null;
    let pendingGammaFilterApply = false;
    let gammaFilterRepaintGen = 0;
    let gammaFilterNudgeDoneForUrl = '';
    let gammaVideoListenersAbort = null;

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

    function getVideoPreviewGammaPanelStatEl() {
        return document.getElementById('videoPreviewGammaPanelStat');
    }

    function refreshVideoPreviewGammaPanelStat() {
        const el = getVideoPreviewGammaPanelStatEl();
        if (!el) return;
        if (
            !isVideoPreviewGammaNonDefault() ||
            (typeof videoReady === 'function' && !videoReady())
        ) {
            el.hidden = true;
            el.textContent = '';
            el.setAttribute('aria-hidden', 'true');
            return;
        }
        el.textContent = formatVideoPreviewGammaPanelLabel(videoPreviewGamma);
        el.hidden = false;
        el.setAttribute('aria-hidden', 'false');
    }

    function notifyVideoPreviewPresentationReady() {
        applyVideoPreviewGamma({ force: true });
    }

    function buildVideoPreviewFilterString(includeMotionBlur) {
        const parts = [];
        if (videoPreviewGamma < GAMMA_MAX - 1e-6) {
            ensureGammaFilter();
            const exp = String(videoPreviewGamma);
            funcR.setAttribute('exponent', exp);
            funcG.setAttribute('exponent', exp);
            funcB.setAttribute('exponent', exp);
            parts.push('url(#' + FILTER_ID + ')');
        }
        if (includeMotionBlur) {
            if (typeof ensureVideoFilmstripMotionBlurFilter === 'function') {
                ensureVideoFilmstripMotionBlurFilter();
            }
            parts.push('url(#' + FILMSTRIP_BLUR_FILTER_ID + ')');
        }
        return parts.join(' ');
    }

    /** 一時停止中 video への SVG filter が環境によって描画されない問題への対処 */
    function setVideoFilterWithRepaint(v, filterStr) {
        if (!v) return;
        const next = filterStr || '';
        const prev = v.style.filter || '';
        if (next === prev) {
            if (!next) return;
            v.style.filter = 'none';
            requestAnimationFrame(() => {
                if (getVideoEl() !== v) return;
                v.style.filter = next;
            });
            return;
        }
        v.style.filter = next;
    }

    function nudgeVideoCompositorForGammaFilter(v) {
        if (!v || !v.paused || v.readyState < 2) return false;
        const url =
            typeof urlMain !== 'undefined' && urlMain
                ? urlMain
                : v.currentSrc || v.src || '';
        if (url && gammaFilterNudgeDoneForUrl === url) return false;
        const t0 = v.currentTime || 0;
        const cap =
            typeof getPlaybackCapSec === 'function'
                ? getPlaybackCapSec(v)
                : v.duration && isFinite(v.duration)
                  ? v.duration
                  : 0;
        if (!cap) return false;
        const step = Math.max(
            typeof masterFrameSec !== 'undefined' && masterFrameSec > 0 ? masterFrameSec : 1 / 24,
            0.001,
        );
        const kick = Math.min(Math.max(step * 2, 0.02), Math.max(cap - step, step));
        if (kick <= 0 || t0 >= kick * 0.5) {
            if (url) gammaFilterNudgeDoneForUrl = url;
            return false;
        }
        if (url) gammaFilterNudgeDoneForUrl = url;
        let restored = false;
        const finish = () => {
            if (restored) return;
            restored = true;
            applyVideoPreviewGamma({ force: true, skipRepaintSchedule: true });
        };
        const restore = () => {
            if (Math.abs((v.currentTime || 0) - kick) < 0.05) {
                const ct = v.currentTime || 0;
                if (Math.abs(ct - t0) >= 0.0001) {
                    v.addEventListener('seeked', finish, { once: true });
                    try {
                        v.currentTime = t0;
                    } catch (_) {
                        finish();
                    }
                } else {
                    finish();
                }
            } else {
                finish();
            }
        };
        v.addEventListener('seeked', restore, { once: true });
        setTimeout(finish, 600);
        try {
            v.currentTime = kick;
        } catch (_) {
            finish();
        }
        return true;
    }

    function scheduleVideoPreviewGammaFilterRepaint(v) {
        if (!isVideoPreviewGammaNonDefault()) return;
        v = v || getVideoEl();
        if (!v) return;
        const gen = ++gammaFilterRepaintGen;
        const reapply = () => {
            if (gen !== gammaFilterRepaintGen) return;
            applyVideoPreviewGamma({ force: true, skipRepaintSchedule: true });
        };
        requestAnimationFrame(reapply);
        if (typeof v.requestVideoFrameCallback === 'function') {
            try {
                v.requestVideoFrameCallback(reapply);
            } catch (_) {}
        }
        v.addEventListener('seeked', reapply, { once: true });
        v.addEventListener('loadeddata', reapply, { once: true });
        if (v.paused) {
            nudgeVideoCompositorForGammaFilter(v);
        }
    }

    function applyVideoPreviewGamma(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const v = getVideoEl();
        if (!v) {
            if (isVideoPreviewGammaNonDefault()) {
                pendingGammaFilterApply = true;
            }
            return;
        }
        pendingGammaFilterApply = false;
        const includeMotionBlur =
            typeof isVideoFilmstripLoadingActive === 'function' &&
            isVideoFilmstripLoadingActive();
        setVideoFilterWithRepaint(v, buildVideoPreviewFilterString(includeMotionBlur));
        if (!o.skipRepaintSchedule && isVideoPreviewGammaNonDefault() && !includeMotionBlur) {
            scheduleVideoPreviewGammaFilterRepaint(v);
        }
    }

    function reapplyVideoPreviewGammaIfPending() {
        if (
            pendingGammaFilterApply ||
            (isVideoPreviewGammaNonDefault() &&
                typeof isVideoFilmstripLoadingActive === 'function' &&
                !isVideoFilmstripLoadingActive())
        ) {
            applyVideoPreviewGamma({ force: true });
        }
    }

    function setVideoPreviewGammaValue(gamma, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        let next = typeof gamma === 'number' && isFinite(gamma) ? gamma : GAMMA_MAX;
        next = Math.max(GAMMA_MIN, Math.min(GAMMA_MAX, next));
        const unchanged = Math.abs(next - videoPreviewGamma) < 1e-6;
        if (unchanged) {
            if (o.forceApply) {
                applyVideoPreviewGamma({ force: true });
                refreshVideoPreviewGammaPanelStat();
            }
            return !!o.forceApply;
        }
        videoPreviewGamma = next;
        applyVideoPreviewGamma({ force: !!o.forceApply });
        refreshVideoPreviewGammaPanelStat();
        if (!o.skipPersist) {
            if (typeof flushPersistSessionNow === 'function') {
                void flushPersistSessionNow();
            } else if (typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
        }
        return true;
    }

    function resetVideoPreviewGamma(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const changed = Math.abs(videoPreviewGamma - GAMMA_MAX) >= 1e-6;
        videoPreviewGamma = GAMMA_MAX;
        pendingGammaFilterApply = false;
        applyVideoPreviewGamma({ force: true });
        refreshVideoPreviewGammaPanelStat();
        if (changed && !o.skipPersist) {
            if (typeof flushPersistSessionNow === 'function') {
                void flushPersistSessionNow();
            } else if (typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
        }
    }

    function setPendingVideoPreviewGammaFromSession(gamma) {
        if (typeof gamma !== 'number' || !isFinite(gamma)) return false;
        pendingVideoPreviewGammaFromSession = Math.max(
            GAMMA_MIN,
            Math.min(GAMMA_MAX, gamma),
        );
        return true;
    }

    function applyPendingVideoPreviewGammaFromSession() {
        if (pendingVideoPreviewGammaFromSession == null) return false;
        const g = pendingVideoPreviewGammaFromSession;
        setVideoPreviewGammaValue(g, { skipPersist: true, forceApply: true });
        return true;
    }

    function clearPendingVideoPreviewGammaFromSession() {
        pendingVideoPreviewGammaFromSession = null;
    }

    function isSessionRestoreGammaBusy() {
        return (
            (typeof isSessionRestoreInProgress === 'function' &&
                isSessionRestoreInProgress()) ||
            (typeof isSessionRestoreTeardownPending === 'function' &&
                isSessionRestoreTeardownPending())
        );
    }

    function applyVideoPreviewGammaFromSession(gamma) {
        if (typeof gamma === 'number' && isFinite(gamma)) {
            setPendingVideoPreviewGammaFromSession(gamma);
            setVideoPreviewGammaValue(gamma, { skipPersist: true, forceApply: true });
            return;
        }
        if (isSessionRestoreGammaBusy()) return;
        resetVideoPreviewGamma({ skipPersist: true });
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

    function formatVideoPreviewGammaPanelLabel(gamma) {
        if (typeof gamma !== 'number' || !isFinite(gamma)) return '';
        return 'Gamma=' + gamma.toFixed(2);
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

    function bindVideoPreviewGammaVideoListeners(el) {
        if (gammaVideoListenersAbort) {
            gammaVideoListenersAbort.abort();
        }
        if (!el) return;
        gammaVideoListenersAbort = new AbortController();
        const sig = gammaVideoListenersAbort.signal;
        el.addEventListener(
            'loadedmetadata',
            () => {
                gammaFilterNudgeDoneForUrl = '';
            },
            { signal: sig },
        );
        const onFrame = () => {
            if (!isVideoPreviewGammaNonDefault()) return;
            applyVideoPreviewGamma({ force: true, skipRepaintSchedule: true });
        };
        el.addEventListener('seeked', onFrame, { signal: sig });
        el.addEventListener('loadeddata', onFrame, { signal: sig });
        el.addEventListener('playing', onFrame, { signal: sig });
    }

    window.resetVideoPreviewGamma = resetVideoPreviewGamma;
    window.applyVideoPreviewGamma = applyVideoPreviewGamma;
    window.applyVideoPreviewGammaFromSession = applyVideoPreviewGammaFromSession;
    window.setPendingVideoPreviewGammaFromSession = setPendingVideoPreviewGammaFromSession;
    window.applyPendingVideoPreviewGammaFromSession = applyPendingVideoPreviewGammaFromSession;
    window.clearPendingVideoPreviewGammaFromSession = clearPendingVideoPreviewGammaFromSession;
    window.getVideoPreviewGammaPersistSnapshot = getVideoPreviewGammaPersistSnapshot;
    window.notifyVideoPreviewPresentationReady = notifyVideoPreviewPresentationReady;
    window.reapplyVideoPreviewGammaIfPending = reapplyVideoPreviewGammaIfPending;
    window.bindVideoPreviewGammaVideoListeners = bindVideoPreviewGammaVideoListeners;
    window.refreshVideoPreviewGammaPanelStat = refreshVideoPreviewGammaPanelStat;
    window.getVideoPreviewGamma = function getVideoPreviewGamma() {
        return videoPreviewGamma;
    };

    bindVideoPreviewGammaWheel();
    bindVideoPreviewGammaVideoListeners(getVideoEl());
    refreshVideoPreviewGammaPanelStat();
})();
