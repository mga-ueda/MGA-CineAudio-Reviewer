(function waveformRestoreLockModule() {
    const POLL_MS = 120;
    const WAIT_TIMEOUT_MS = 120000;

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

    function sessionWaveformsRestorePending() {
        if (
            typeof isMainVideoWaveformBuildPending === 'function' &&
            isMainVideoWaveformBuildPending()
        ) {
            return true;
        }
        if (
            typeof areExtraTrackWaveformsRestorePending === 'function' &&
            areExtraTrackWaveformsRestorePending()
        ) {
            return true;
        }
        return false;
    }

    function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function maybeBeginWaveformRestoreLock(row, opt) {
        if (!sessionRowNeedsWaveformRestoreLock(row)) return false;
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
        if (
            typeof isWaveformRestoreLockActive !== 'function' ||
            !isWaveformRestoreLockActive()
        ) {
            return;
        }

        if (typeof ensureExtraTrackWaveformsDrawnAsync === 'function') {
            try {
                await ensureExtraTrackWaveformsDrawnAsync({ notifyMaster: true, maxFrames: 48 });
            } catch (_) {}
        } else if (typeof ensureExtraTrackWaveformsDrawn === 'function') {
            ensureExtraTrackWaveformsDrawn({ notifyMaster: true, maxFrames: 48 });
        }

        const deadline = performance.now() + WAIT_TIMEOUT_MS;
        while (performance.now() < deadline) {
            if (
                typeof kickMainVideoWaveformBuild === 'function' &&
                typeof isMainVideoWaveformBuildPending === 'function' &&
                isMainVideoWaveformBuildPending()
            ) {
                kickMainVideoWaveformBuild({ allowSettle: false });
            }
            if (!sessionWaveformsRestorePending()) break;
            await delay(POLL_MS);
        }

        if (sessionWaveformsRestorePending() && typeof writeLog === 'function') {
            writeLog('Waveform restore lock: timed out — releasing lock');
        }

        if (typeof endWaveformRestoreLock === 'function') {
            await endWaveformRestoreLock();
        }
        if (typeof writeLog === 'function') {
            writeLog('Waveform restore lock: released');
        }
    }

    window.sessionRowNeedsWaveformRestoreLock = sessionRowNeedsWaveformRestoreLock;
    window.maybeBeginWaveformRestoreLock = maybeBeginWaveformRestoreLock;
    window.waitForSessionWaveformsAndEndRestoreLock =
        waitForSessionWaveformsAndEndRestoreLock;
})();
