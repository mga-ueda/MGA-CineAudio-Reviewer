(function waveformRestoreLockModule() {
    const POLL_MS = 120;
    /** Ex デコード待ちの上限（メイン動画波形は待たない） */
    const WAIT_TIMEOUT_MS = 15000;

    /** 解除判定: Ex のデコード中のみ（描画・メイン動画波形は待たない） */
    function sessionExtraDecodeRestorePending() {
        const extraCount =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        for (let i = 0; i < extraCount; i++) {
            if (
                typeof extraTrackStatusIndicatesDecoding === 'function' &&
                extraTrackStatusIndicatesDecoding(i)
            ) {
                return true;
            }
        }
        return false;
    }

    function prepareLayoutBeforeWaveformRestoreWait() {
        if (typeof syncExtraLaneVisibilityAfterSessionRestore === 'function') {
            syncExtraLaneVisibilityAfterSessionRestore();
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        if (
            typeof pendingLaneUiRestore !== 'undefined' &&
            pendingLaneUiRestore &&
            typeof applySavedWaveformLaneUi === 'function'
        ) {
            applySavedWaveformLaneUi(pendingLaneUiRestore);
            pendingLaneUiRestore = null;
        }
    }

    function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function waitForSessionWaveformsAndEndRestoreLock() {
        try {
            prepareLayoutBeforeWaveformRestoreWait();

            const deadline = performance.now() + WAIT_TIMEOUT_MS;
            let pollCount = 0;
            while (performance.now() < deadline) {
                pollCount += 1;
                if (!sessionExtraDecodeRestorePending()) break;
                await delay(POLL_MS);
            }
        } finally {
            if (typeof clearStaleExtraTrackDecodingStatus === 'function') {
                clearStaleExtraTrackDecodingStatus();
            }
            if (typeof refreshExtraTrackRegionOverlaysAfterSessionRestore === 'function') {
                try {
                    refreshExtraTrackRegionOverlaysAfterSessionRestore();
                } catch (_) {}
            }
            if (typeof ensureExtraTrackWaveformsDrawnAsync === 'function') {
                try {
                    await ensureExtraTrackWaveformsDrawnAsync({
                        notifyMaster: true,
                        maxFrames: 40,
                    });
                } catch (_) {}
            }
        }
    }

    window.waitForSessionWaveformsAndEndRestoreLock =
        waitForSessionWaveformsAndEndRestoreLock;
})();
