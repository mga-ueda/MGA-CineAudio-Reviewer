/**
 * view-panels.js — 動画パネル／マーカーパネルの表示・非表示（レビュー用レイアウト）。
 */
    let videoMarkersPanelsHidden = false;

    function applyVideoMarkersPanelsHidden(hidden) {
        videoMarkersPanelsHidden = !!hidden;
        if (playerStage) {
            playerStage.classList.toggle(
                'player-stage--video-markers-panels-hidden',
                videoMarkersPanelsHidden,
            );
        }
        if (panelMain) {
            panelMain.setAttribute('aria-hidden', videoMarkersPanelsHidden ? 'true' : 'false');
        }
        if (markerPanel) {
            markerPanel.setAttribute('aria-hidden', videoMarkersPanelsHidden ? 'true' : 'false');
        }
        if (typeof scheduleMarkersUiRefreshAfterLayout === 'function') {
            scheduleMarkersUiRefreshAfterLayout();
        }
        return videoMarkersPanelsHidden;
    }

    function toggleVideoMarkersPanelsHidden() {
        const hidden = applyVideoMarkersPanelsHidden(!videoMarkersPanelsHidden);
        writeLog(
            hidden
                ? 'Video and Markers panels: hidden (F)'
                : 'Video and Markers panels: shown (F)',
        );
        flashSeekHint('Video + Markers', hidden ? 'Hidden' : 'Shown', 'notice');
        return hidden;
    }

    function handleVideoMarkersPanelsToggleKeydown(e) {
        if (!matchUserShortcut(e, 'videoMarkersPanelsToggle')) return false;
        e.preventDefault();
        toggleVideoMarkersPanelsHidden();
        return true;
    }

    window.handleVideoMarkersPanelsToggleKeydown = handleVideoMarkersPanelsToggleKeydown;
