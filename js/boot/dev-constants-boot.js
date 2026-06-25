/**
 * dev-constants-boot.js — F10 診断フラグを prefs-log 直後に localStorage から復元。
 * 以降のモジュール初期化（musical-grid 等）より前に DEBUG_LOG を有効化する。
 */
(function devConstantsBootModule() {
    function applyDevConstantsRuntimeSideEffects() {
        if (typeof window.applyDebugLogToggleSideEffects === 'function') {
            window.applyDebugLogToggleSideEffects();
        }
        if (typeof window.scheduleWaveformRegionOverlayRefresh === 'function') {
            window.scheduleWaveformRegionOverlayRefresh();
        }
    }

    function getDevConstantsPersistSnapshot() {
        const debugLog = {};
        if (window.DEBUG_LOG && typeof window.DEBUG_LOG === 'object') {
            for (const key of Object.keys(window.DEBUG_LOG)) {
                debugLog[key] = !!window.DEBUG_LOG[key];
            }
        }
        const verify =
            window.TEMPO_STRETCH_VERIFY && typeof window.TEMPO_STRETCH_VERIFY === 'object'
                ? window.TEMPO_STRETCH_VERIFY
                : null;
        return {
            debugLog,
            regionHandleHitDebug:
                typeof window.isRegionHandleHitDebugEnabled === 'function'
                    ? window.isRegionHandleHitDebugEnabled()
                    : !!window.REGION_HANDLE_HIT_DEBUG,
            tempoStretchSkipApply: !!(verify && verify.skipApply),
            actionLogWindowOpen:
                typeof window.isActionLogWindowEnabled === 'function'
                    ? window.isActionLogWindowEnabled()
                    : false,
        };
    }

    function applyDevConstantsFromStorage(prefs) {
        const block = prefs && prefs.devConstants;
        if (!block || typeof block !== 'object') return;

        if (block.debugLog && typeof block.debugLog === 'object' && window.DEBUG_LOG) {
            for (const key of Object.keys(block.debugLog)) {
                if (Object.prototype.hasOwnProperty.call(window.DEBUG_LOG, key)) {
                    window.DEBUG_LOG[key] = !!block.debugLog[key];
                }
            }
        }

        if (typeof block.regionHandleHitDebug === 'boolean') {
            window.REGION_HANDLE_HIT_DEBUG = block.regionHandleHitDebug;
            window.FADE_TRIANGLE_HIT_DEBUG = block.regionHandleHitDebug;
        }

        if (typeof block.tempoStretchSkipApply === 'boolean') {
            if (!window.TEMPO_STRETCH_VERIFY || typeof window.TEMPO_STRETCH_VERIFY !== 'object') {
                window.TEMPO_STRETCH_VERIFY = { skipApply: false };
            }
            window.TEMPO_STRETCH_VERIFY.skipApply = block.tempoStretchSkipApply;
        }

        if (
            typeof block.actionLogWindowOpen === 'boolean' &&
            typeof window.setActionLogWindowOpen === 'function'
        ) {
            window.setActionLogWindowOpen(block.actionLogWindowOpen, {
                silent: true,
                skipPersist: true,
            });
        }

        applyDevConstantsRuntimeSideEffects();
    }

    window.getDevConstantsPersistSnapshot = getDevConstantsPersistSnapshot;
    window.applyDevConstantsFromStorage = applyDevConstantsFromStorage;
    window.applyDevConstantsRuntimeSideEffects = applyDevConstantsRuntimeSideEffects;

    if (typeof readPrefs === 'function') {
        applyDevConstantsFromStorage(readPrefs());
    }
})();
