(function waveformRestoreLockModule() {
    const POLL_MS = 120;
    /** Ex デコード待ちの上限（メイン動画波形は待たない） */
    const WAIT_TIMEOUT_MS = 15000;

    function sessionRowNeedsWaveformRestoreLock(row) {
        if (!row || typeof row !== 'object') return false;
        const hasVideo = row.mBlob && (row.mBlob.size || 0) > 0;
        const hasExtra =
            Array.isArray(row.extraTracks) &&
            row.extraTracks.some(
                (e) => e && e.blob && (e.byteLength || e.blob.size || 0) > 0,
            );
        return hasVideo || hasExtra;
    }

    /** Now Loading 解除判定: Ex のデコード中のみ（描画・メイン動画波形は待たない） */
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

    function maybeBeginWaveformRestoreLock(row, opt) {
        if (
            typeof isNowLoadingEnabled === 'function' &&
            !isNowLoadingEnabled()
        ) {
            return false;
        }
        if (!sessionRowNeedsWaveformRestoreLock(row)) return false;
        if (
            typeof isWaveformRestoreLockActive === 'function' &&
            isWaveformRestoreLockActive()
        ) {
            return true;
        }
        if (typeof beginWaveformRestoreLock !== 'function') return false;
        const o = opt && typeof opt === 'object' ? opt : {};
        beginWaveformRestoreLock({ reason: o.importReview ? 'import' : 'reload' });
        if (typeof writeLog === 'function') {
            writeLog(
                'Waveform restore lock: started (' +
                    (o.importReview ? 'import' : 'reload') +
                    ')',
            );
        }
        return true;
    }

    async function waitForSessionWaveformsAndEndRestoreLock() {
        const lockActive =
            typeof isWaveformRestoreLockActive === 'function' &&
            isWaveformRestoreLockActive();
        let bootShell = false;
        try {
            bootShell =
                document.documentElement.classList.contains(
                    'waveform-restore-boot-pending',
                );
        } catch (_) {}

        if (!lockActive && !bootShell) return;

        try {
            if (lockActive) {
                prepareLayoutBeforeWaveformRestoreWait();

                const deadline = performance.now() + WAIT_TIMEOUT_MS;
                while (performance.now() < deadline) {
                    if (!sessionExtraDecodeRestorePending()) break;
                    await delay(POLL_MS);
                }

                if (sessionExtraDecodeRestorePending() && typeof writeLog === 'function') {
                    writeLog(
                        'Waveform restore lock: extra decode wait timed out — releasing lock',
                    );
                }
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
            if (typeof ensureWaveformRestoreLockDismissed === 'function') {
                await ensureWaveformRestoreLockDismissed();
            } else if (typeof endWaveformRestoreLock === 'function') {
                await endWaveformRestoreLock();
            }
            if (typeof ensureExtraTrackWaveformsDrawnAsync === 'function') {
                try {
                    await ensureExtraTrackWaveformsDrawnAsync({
                        notifyMaster: true,
                        maxFrames: 40,
                    });
                } catch (_) {}
            }
            if (typeof writeLog === 'function') {
                writeLog('Waveform restore lock: released');
            }
        }
    }

    window.sessionRowNeedsWaveformRestoreLock = sessionRowNeedsWaveformRestoreLock;
    window.maybeBeginWaveformRestoreLock = maybeBeginWaveformRestoreLock;
    window.waitForSessionWaveformsAndEndRestoreLock =
        waitForSessionWaveformsAndEndRestoreLock;
})();
