/**
 * ui-helpers.js — UI 補助（トランスポートオプションの glow、レーンステータス文言、シークヒント）。
 */
    const transportOptGlowClearTimers = { playback: 0, analyze: 0, masterVol: 0 };
    let videoPanelDriftGlowTimer = 0;

    const LANE_STATUS_HIDE_RE =
        /^(Not Loaded|No audio track|Loading waveform|Reading audio|Decoding)/i;

    function shouldShowLaneStatus(text) {
        if (!text || !String(text).trim()) return false;
        const t = String(text).trim();
        if (LANE_STATUS_HIDE_RE.test(t)) return false;
        if (/too large|failed|unavailable|could not decode/i.test(t)) return true;
        return false;
    }

    function applyLaneStatusEl(el, text) {
        if (!el) return;
        const t = text ? String(text).trim() : '';
        el.textContent = t;
        el.hidden = !shouldShowLaneStatus(t);
    }

    function laneStatusTooltip(text) {
        if (!text || !String(text).trim()) return '';
        const t = String(text).trim();
        if (LANE_STATUS_HIDE_RE.test(t)) return '';
        return t;
    }

    function isPlayInterruptedError(err) {
        if (!err) return false;
        if (err.name === 'AbortError') return true;
        const msg = String(err.message || err);
        return /interrupted by a call to pause/i.test(msg);
    }

    const TRANSPORT_OPT_BOX_SELECTOR = {
        playback:
            '.transport-bar--playback .transport-opt-box--playback, .transport-opt-box--playback',
        analyze:
            '.transport-bar #analyzeToggleWrap.transport-opt-chip, #analyzeToggleWrap.transport-opt-chip',
        metronomeClick:
            '.transport-bar #metronomeClickToggleWrap.transport-opt-chip, #metronomeClickToggleWrap',
        masterVol:
            '.transport-bar .master-vol-container, #masterVolWrap',
    };

    function flashVideoPanelDrift() {
        if (!panelMain) return;
        panelMain.classList.remove('video-panel--drift-glow');
        if (videoPanelDriftGlowTimer) {
            clearTimeout(videoPanelDriftGlowTimer);
            videoPanelDriftGlowTimer = 0;
        }
        void panelMain.offsetWidth;
        panelMain.classList.add('video-panel--drift-glow');
        videoPanelDriftGlowTimer = setTimeout(() => {
            panelMain.classList.remove('video-panel--drift-glow');
            videoPanelDriftGlowTimer = 0;
        }, 900);
    }

    function flashTransportOptBox(which) {
        const sel =
            TRANSPORT_OPT_BOX_SELECTOR[which] || TRANSPORT_OPT_BOX_SELECTOR.playback;
        const box = document.querySelector(sel);
        if (!box) return;
        const glowClass = box.classList.contains('transport-opt-box')
            ? 'transport-opt-box--glow'
            : 'transport-opt-chip--glow';
        box.classList.remove('transport-opt-box--glow', 'transport-opt-chip--glow');
        if (transportOptGlowClearTimers[which]) {
            clearTimeout(transportOptGlowClearTimers[which]);
            transportOptGlowClearTimers[which] = 0;
        }
        void box.offsetWidth;
        box.classList.add(glowClass);
        transportOptGlowClearTimers[which] = setTimeout(() => {
            box.classList.remove(glowClass);
            transportOptGlowClearTimers[which] = 0;
        }, 900);
    }

    let altKeySnapSuppressed = false;

    /** Alt 押下中はタイムライン／マーカー／リージョン等のスナップを無効化 */
    function isSnapSuppressedByAlt(opt) {
        if (opt && opt.altKey) return true;
        if (opt && opt.noSnap) return true;
        return altKeySnapSuppressed;
    }

    function setAltKeySnapSuppressed(v) {
        altKeySnapSuppressed = !!v;
    }

    function syncSnapSuppressionFromPointerEvent(ev) {
        if (!ev) return;
        if (typeof ev.getModifierState === 'function') {
            altKeySnapSuppressed = ev.getModifierState('Alt');
        } else if ('altKey' in ev) {
            altKeySnapSuppressed = !!ev.altKey;
        }
    }

    /** 明示シーク後のトランスポート UI（タイムコード・プレイヘッド・ループ／マーカーオーバーレイ） */
    function syncTransportSeekUi(t, opt) {
        if (!Number.isFinite(t)) return;
        if (typeof setTransportSec === 'function') {
            setTransportSec(t);
        } else if (typeof seekBar !== 'undefined' && seekBar) {
            seekBar.value = String(t);
        }
        if (typeof currentTimeEl !== 'undefined' && currentTimeEl) {
            if (typeof formatTimecodeForTransport === 'function') {
                currentTimeEl.textContent = formatTimecodeForTransport(t);
            }
        }
        if (typeof updateTimecodeOverlay === 'function') updateTimecodeOverlay();
        if (typeof updateAllWaveformPlayheads === 'function') updateAllWaveformPlayheads();
        if (typeof updateRangeLoopOverlay === 'function') updateRangeLoopOverlay();
        if (typeof updateMarkerCommentOverlay === 'function') {
            updateMarkerCommentOverlay();
        } else if (opt && opt.markerHighlight && typeof updateTransportMarkerHighlight === 'function') {
            updateTransportMarkerHighlight(t);
        }
    }

    function focusWaveformDrawingArea() {
        const waveFocus =
            typeof audioWaveformLanesTracks !== 'undefined' && audioWaveformLanesTracks
                ? audioWaveformLanesTracks
                : typeof audioWaveformTrack !== 'undefined' && audioWaveformTrack
                  ? audioWaveformTrack
                  : null;
        if (!waveFocus || typeof waveFocus.focus !== 'function') return;
        requestAnimationFrame(() => {
            try {
                waveFocus.focus({ preventScroll: true });
            } catch (_) {
                waveFocus.focus();
            }
        });
    }

    const MODAL_OVERLAY_IDS = [
        'appConfirmOverlay',
        'markerPasteOverlay',
        'regionBarJumpOverlay',
        'exportBlockingOverlay',
    ];

    function isModalOverlayOpen() {
        for (const id of MODAL_OVERLAY_IDS) {
            const el = document.getElementById(id);
            if (el && !el.hidden) return true;
        }
        return false;
    }

    function getOpenModalOverlayRoot() {
        for (const id of MODAL_OVERLAY_IDS) {
            const el = document.getElementById(id);
            if (el && !el.hidden) return el;
        }
        return null;
    }

    function getOverlayFocusableElements(root) {
        if (!root) return [];
        const nodes = root.querySelectorAll(
            'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])',
        );
        return Array.from(nodes).filter((el) => {
            if (el.disabled || el.hidden) return false;
            if (el.closest('[hidden]')) return false;
            const style = window.getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none') return false;
            return true;
        });
    }

    function handleModalOverlayFocusTrapKeydown(e) {
        if (!e || e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
        const root = getOpenModalOverlayRoot();
        if (!root) return;
        const focusable = getOverlayFocusableElements(root);
        if (focusable.length === 0) return;
        e.preventDefault();
        if (focusable.length === 1) {
            focusable[0].focus();
            return;
        }
        const active = document.activeElement;
        const idx = focusable.indexOf(active);
        const nextIdx = e.shiftKey
            ? idx <= 0
              ? focusable.length - 1
              : idx - 1
            : idx < 0 || idx >= focusable.length - 1
              ? 0
              : idx + 1;
        focusable[nextIdx].focus();
    }

    function handleModalOverlayFocusTrapFocusin(e) {
        const root = getOpenModalOverlayRoot();
        if (!root || !e || !e.target) return;
        if (root.contains(e.target)) return;
        const focusable = getOverlayFocusableElements(root);
        if (focusable.length === 0) return;
        const active = document.activeElement;
        const idx = focusable.indexOf(active);
        const fallback = idx >= 0 ? focusable[idx] : focusable[0];
        requestAnimationFrame(() => {
            if (getOpenModalOverlayRoot() !== root) return;
            fallback.focus();
        });
    }

    function initModalOverlayFocusTrap() {
        document.addEventListener('keydown', handleModalOverlayFocusTrapKeydown, true);
        document.addEventListener('focusin', handleModalOverlayFocusTrapFocusin, true);
    }

    function isElementInsideHiddenModal(el) {
        if (!el || el.nodeType !== 1 || !el.closest) return false;
        for (const id of MODAL_OVERLAY_IDS) {
            const root = document.getElementById(id);
            if (root && root.hidden && root.contains(el)) return true;
        }
        return false;
    }

    function isMarkerIntentionalFocusTarget(el) {
        if (!el || el.nodeType !== 1 || !el.closest) return false;
        if (isElementInsideHiddenModal(el)) return false;
        if (el.closest('.marker-table__tc-input')) return true;
        if (el.closest('.marker-table__comment')) return true;
        if (el.closest('#markerMemoTextarea')) return true;
        if (el.id === 'markerPasteTextarea') return true;
        if (el.id === 'regionBarJumpInput') return true;
        if (el.closest('.musical-track-lane__add-input-wrap')) return true;
        if (el.closest('.musical-track-lane__segment-input')) return true;
        return false;
    }

    function isInsideWaveformDrawingArea(el) {
        return !!(el && el.closest && el.closest('#audioWaveformLanesTracks'));
    }

    function shouldSkipWaveformFocusRestore(opt) {
        if (isModalOverlayOpen()) return true;
        const target = opt && opt.target;
        const related = opt && opt.relatedTarget;
        const isBlur = opt && opt.event === 'blur';
        if (isMarkerIntentionalFocusTarget(target)) {
            if (isBlur) {
                if (related && isMarkerIntentionalFocusTarget(related)) return true;
            } else {
                return true;
            }
        }
        if (related && isMarkerIntentionalFocusTarget(related)) return true;
        const active = document.activeElement;
        if (active && isMarkerIntentionalFocusTarget(active)) return true;
        return false;
    }

    let waveformFocusRestoreRaf = 0;

    function scheduleWaveformFocusRestore(opt) {
        if (shouldSkipWaveformFocusRestore(opt)) return;
        if (waveformFocusRestoreRaf) cancelAnimationFrame(waveformFocusRestoreRaf);
        waveformFocusRestoreRaf = requestAnimationFrame(() => {
            waveformFocusRestoreRaf = 0;
            if (shouldSkipWaveformFocusRestore(opt)) return;
            focusWaveformDrawingArea();
        });
    }

    function initWaveformFocusRestore() {
        document.addEventListener('click', (e) => {
            const t = e.target;
            if (!t || t.nodeType !== 1) return;
            if (isInsideWaveformDrawingArea(t)) return;
            const btn = t.closest('button');
            if (btn) {
                scheduleWaveformFocusRestore({ target: btn });
                return;
            }
            const cb = t.closest('input[type="checkbox"]');
            if (cb) {
                scheduleWaveformFocusRestore({ target: cb });
                return;
            }
            const label = t.closest('label');
            if (label && label.querySelector('input[type="checkbox"]')) {
                scheduleWaveformFocusRestore({ target: t });
            }
        });

        document.addEventListener('change', (e) => {
            const t = e.target;
            if (!t || t.nodeType !== 1) return;
            if (isInsideWaveformDrawingArea(t)) return;
            const tag = t.nodeName;
            if (tag === 'SELECT') {
                scheduleWaveformFocusRestore({ target: t });
                return;
            }
            if (tag === 'INPUT') {
                const type = (t.type || '').toLowerCase();
                if (type === 'checkbox' || type === 'range') {
                    scheduleWaveformFocusRestore({ target: t });
                }
            }
        });

        document.addEventListener(
            'pointerup',
            (e) => {
                const t = e.target;
                if (!t || t.nodeType !== 1) return;
                if (t.nodeName !== 'INPUT') return;
                if ((t.type || '').toLowerCase() !== 'range') return;
                if (isInsideWaveformDrawingArea(t)) return;
                scheduleWaveformFocusRestore({ target: t });
            },
            true,
        );

        document.addEventListener(
            'blur',
            (e) => {
                const t = e.target;
                if (!t || typeof isTypingTarget !== 'function' || !isTypingTarget(t)) return;
                if (isInsideWaveformDrawingArea(t)) return;
                const related = e.relatedTarget;
                if (isMarkerIntentionalFocusTarget(t)) {
                    if (related && isMarkerIntentionalFocusTarget(related)) return;
                }
                scheduleWaveformFocusRestore({
                    target: t,
                    relatedTarget: related,
                    event: 'blur',
                });
            },
            true,
        );
    }

    window.focusWaveformDrawingArea = focusWaveformDrawingArea;
    window.scheduleWaveformFocusRestore = scheduleWaveformFocusRestore;
    window.initWaveformFocusRestore = initWaveformFocusRestore;
    window.initModalOverlayFocusTrap = initModalOverlayFocusTrap;

    window.isSnapSuppressedByAlt = isSnapSuppressedByAlt;
    window.setAltKeySnapSuppressed = setAltKeySnapSuppressed;
    window.syncSnapSuppressionFromPointerEvent = syncSnapSuppressionFromPointerEvent;
    window.syncTransportSeekUi = syncTransportSeekUi;

    function scrollAppDocFoldIntoView(fold) {
        if (!fold) return;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                fold.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    window.scrollAppDocFoldIntoView = scrollAppDocFoldIntoView;

    (function bindAppDocFoldAccordion() {
        const folds = document.querySelectorAll('details.app-doc-fold');
        if (!folds.length) return;

        folds.forEach((d) => {
            d.addEventListener('toggle', () => {
                if (d.open) {
                    folds.forEach((other) => {
                        if (other !== d) other.removeAttribute('open');
                    });
                    scrollAppDocFoldIntoView(d);
                }
            });
        });
    })();
