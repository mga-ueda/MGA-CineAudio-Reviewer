/**
 * events-boot.js — アプリ起動シーケンス（prefs・マーカー・Ex UI・IDB 復元・初期レイアウト）。
 */

    (async function boot() {
        if (typeof initPrefsFromStorage === 'function') {
            initPrefsFromStorage();
        }
        if (typeof initTimecodeOverlay === 'function') {
            initTimecodeOverlay();
        }
        if (typeof initMarkers === 'function') {
            initMarkers();
        }
        if (typeof initExtraAudioTracksUi === 'function') {
            initExtraAudioTracksUi();
        }
        try {
            await restoreSessionFromStorage();
        } catch (_) {}
        try {
            if (typeof whenSessionRestoreIdle === 'function') {
                await Promise.race([
                    whenSessionRestoreIdle(),
                    new Promise((resolve) => setTimeout(resolve, 120000)),
                ]);
            }
        } catch (_) {}
        if (
            typeof fileMain !== 'undefined' &&
            fileMain &&
            typeof finalizeVideoTrackPresentationAfterSessionRestore === 'function'
        ) {
            try {
                await finalizeVideoTrackPresentationAfterSessionRestore();
            } catch (_) {}
        }
        if (typeof applyVideoPreviewGamma === 'function') {
            applyVideoPreviewGamma({ force: true });
        }
        if (typeof updateSessionAllClearButton === 'function') {
            updateSessionAllClearButton();
        }
        if (!fileMain && typeof applySavedWaveformLaneUi === 'function') {
            applySavedWaveformLaneUi(null);
        }
        syncSeekMax();
        updateControlsEnabled();
        if (!fileMain && typeof syncAudioOnlyMarkersUi === 'function') {
            syncAudioOnlyMarkersUi();
        }
        onVideoMediaReady();
        if (typeof finalizeReviewMixAfterSessionRestore === 'function') {
            await finalizeReviewMixAfterSessionRestore();
        } else if (typeof ensureMainVideoWaveformAfterSessionRestore === 'function') {
            ensureMainVideoWaveformAfterSessionRestore();
        }
        if (
            typeof fileMain !== 'undefined' &&
            fileMain &&
            typeof scheduleMainVideoWaveformPresenceWatch === 'function'
        ) {
            scheduleMainVideoWaveformPresenceWatch({ firstDelayMs: 800 });
        }
        if (typeof refreshExportMediaOptionsUi === 'function') {
            refreshExportMediaOptionsUi();
        }
        if (typeof scheduleMarkersUiRefreshAfterLayout === 'function') {
            scheduleMarkersUiRefreshAfterLayout();
        }
        if (typeof scheduleTransportUiRefreshAfterLayout === 'function') {
            scheduleTransportUiRefreshAfterLayout();
        }
        if (typeof applyShortcutTooltips === 'function') {
            applyShortcutTooltips();
        }
    })();
