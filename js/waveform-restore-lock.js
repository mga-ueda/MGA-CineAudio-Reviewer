(function waveformRestoreLockModule() {
    const POLL_MS = 120;
    /** Ex デコード待ちの上限（メイン動画波形は待たない） */
    const WAIT_TIMEOUT_MS = 15000;

    function logRestoreDetail(message) {
        if (typeof logNowLoadingDetail === 'function') {
            logNowLoadingDetail('restore — ' + message);
        } else if (typeof writeLog === 'function') {
            writeLog('Now Loading: restore — ' + message);
        }
    }

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

    function formatExtraDecodePendingSummary() {
        const extraCount =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        const pending = [];
        for (let i = 0; i < extraCount; i++) {
            if (
                typeof extraTrackStatusIndicatesDecoding === 'function' &&
                extraTrackStatusIndicatesDecoding(i)
            ) {
                pending.push('Ex' + (i + 1));
            }
        }
        return pending.length ? pending.join(', ') : 'none';
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
        logRestoreDetail('preparing lane layout before decode wait');
        if (typeof syncExtraLaneVisibilityAfterSessionRestore === 'function') {
            syncExtraLaneVisibilityAfterSessionRestore();
            logRestoreDetail('synced extra lane visibility');
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
            logRestoreDetail('refreshed waveform composite layout');
        }
        if (
            typeof pendingLaneUiRestore !== 'undefined' &&
            pendingLaneUiRestore &&
            typeof applySavedWaveformLaneUi === 'function'
        ) {
            applySavedWaveformLaneUi(pendingLaneUiRestore);
            pendingLaneUiRestore = null;
            logRestoreDetail('applied saved lane UI snapshot');
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
            logRestoreDetail('skipped — Now Loading disabled');
            return false;
        }
        if (!sessionRowNeedsWaveformRestoreLock(row)) {
            logRestoreDetail('skipped — session row needs no waveform lock');
            return false;
        }
        if (
            typeof isWaveformRestoreLockActive === 'function' &&
            isWaveformRestoreLockActive()
        ) {
            logRestoreDetail('lock already active');
            return true;
        }
        if (typeof beginWaveformRestoreLock !== 'function') return false;
        const o = opt && typeof opt === 'object' ? opt : {};
        const reason = o.importReview ? 'import' : 'reload';
        const extraN = Array.isArray(row.extraTracks) ? row.extraTracks.length : 0;
        const hasVideo = row.mBlob && (row.mBlob.size || 0) > 0;
        logRestoreDetail(
            'begin lock (' +
                reason +
                ', video=' +
                (hasVideo ? 'yes' : 'no') +
                ', extraTracks=' +
                extraN +
                ')',
        );
        beginWaveformRestoreLock({ reason: reason });
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

        logRestoreDetail(
            'waitForEnd entered (lockActive=' +
                lockActive +
                ', bootShell=' +
                bootShell +
                ')',
        );

        if (!lockActive && !bootShell) {
            logRestoreDetail('waitForEnd — nothing to dismiss');
            return;
        }

        try {
            if (lockActive) {
                prepareLayoutBeforeWaveformRestoreWait();

                const deadline = performance.now() + WAIT_TIMEOUT_MS;
                let pollCount = 0;
                while (performance.now() < deadline) {
                    pollCount += 1;
                    if (
                        typeof isWaveformRestoreLockActive === 'function' &&
                        !isWaveformRestoreLockActive()
                    ) {
                        logRestoreDetail(
                            'decode wait stopped — lock dismissed externally (poll #' +
                                pollCount +
                                ')',
                        );
                        break;
                    }
                    if (!sessionExtraDecodeRestorePending()) {
                        logRestoreDetail(
                            'decode wait finished — no Ex tracks decoding (poll #' +
                                pollCount +
                                ')',
                        );
                        break;
                    }
                    if (pollCount === 1 || pollCount % 25 === 0) {
                        logRestoreDetail(
                            'waiting for Ex decode: ' +
                                formatExtraDecodePendingSummary() +
                                ' (poll #' +
                                pollCount +
                                ')',
                        );
                    }
                    if (
                        typeof touchNowLoadingIdleDeadline === 'function' &&
                        (pollCount === 1 || pollCount % 25 === 0)
                    ) {
                        touchNowLoadingIdleDeadline();
                    }
                    await delay(POLL_MS);
                }

                if (sessionExtraDecodeRestorePending()) {
                    logRestoreDetail(
                        'decode wait timed out after ' +
                            WAIT_TIMEOUT_MS / 1000 +
                            's — still decoding: ' +
                            formatExtraDecodePendingSummary(),
                    );
                }
            }
        } finally {
            logRestoreDetail('finalize — clearing stale decoding status');
            if (typeof clearStaleExtraTrackDecodingStatus === 'function') {
                clearStaleExtraTrackDecodingStatus();
            }
            logRestoreDetail('finalize — refreshing region overlays');
            if (typeof refreshExtraTrackRegionOverlaysAfterSessionRestore === 'function') {
                try {
                    refreshExtraTrackRegionOverlaysAfterSessionRestore();
                } catch (e) {
                    logRestoreDetail(
                        'region overlay refresh failed — ' +
                            (e && e.message ? e.message : String(e)),
                    );
                }
            }
            logRestoreDetail('finalize — dismissing lock UI');
            if (typeof ensureWaveformRestoreLockDismissed === 'function') {
                await ensureWaveformRestoreLockDismissed();
            } else if (typeof endWaveformRestoreLock === 'function') {
                await endWaveformRestoreLock();
            }
            logRestoreDetail('finalize — drawing extra waveforms');
            if (typeof ensureExtraTrackWaveformsDrawnAsync === 'function') {
                try {
                    await ensureExtraTrackWaveformsDrawnAsync({
                        notifyMaster: true,
                        maxFrames: 40,
                    });
                } catch (e) {
                    logRestoreDetail(
                        'extra waveform draw failed — ' +
                            (e && e.message ? e.message : String(e)),
                    );
                }
            }
            logRestoreDetail('waitForEnd complete');
        }
    }

    window.sessionRowNeedsWaveformRestoreLock = sessionRowNeedsWaveformRestoreLock;
    window.maybeBeginWaveformRestoreLock = maybeBeginWaveformRestoreLock;
    window.waitForSessionWaveformsAndEndRestoreLock =
        waitForSessionWaveformsAndEndRestoreLock;
})();
