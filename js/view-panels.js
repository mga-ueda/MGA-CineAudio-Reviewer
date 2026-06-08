/**
 * view-panels.js — 動画パネル／マーカーパネル／マニュアル折りたたみの表示・非表示（レビュー用レイアウト）。
 */
    let videoMarkersPanelsHidden = false;

    function applyManualDocFoldsHidden(hidden) {
        document.querySelectorAll('details.app-doc-fold').forEach((el) => {
            el.hidden = !!hidden;
        });
    }

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

    function revealManualDocFold(fold) {
        if (!fold) return;
        fold.hidden = false;
        if (fold.open) {
            if (typeof scrollAppDocFoldIntoView === 'function') {
                scrollAppDocFoldIntoView(fold);
            }
        } else {
            fold.open = true;
        }
    }

    window.revealManualDocFold = revealManualDocFold;
    window.applyManualDocFoldsHidden = applyManualDocFoldsHidden;

    window.handleVideoMarkersPanelsToggleKeydown = handleVideoMarkersPanelsToggleKeydown;
