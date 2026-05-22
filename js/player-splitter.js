    // 動画エリアとマーカー一覧のスプリッター（幅調整・保存）
    const SPLITTER_WIDTH_PX = 7;
    const MARKER_PANEL_MIN_PX = 200;
    const PLAYER_MAIN_MIN_PX = 240;
    const MARKER_PANEL_DEFAULT_PX = 360;
    const SPLITTER_CENTER_SNAP_PX = 24;

    let splitterDragState = null;
    let markerPanelHeightRo = null;

    function syncMarkerPanelHeightToVideo() {
        if (!playerStageMain || !markerPanel) return;
        if (window.matchMedia('(max-width: 960px)').matches) {
            markerPanel.style.removeProperty('height');
            markerPanel.style.removeProperty('max-height');
            if (playerSplitter) playerSplitter.style.removeProperty('min-height');
            return;
        }
        const h = Math.max(200, Math.round(playerStageMain.offsetHeight));
        markerPanel.style.height = h + 'px';
        markerPanel.style.maxHeight = h + 'px';
        if (playerSplitter) playerSplitter.style.minHeight = h + 'px';
    }

    function initMarkerPanelHeightSync() {
        if (!playerStageMain || !markerPanel) return;
        syncMarkerPanelHeightToVideo();
        window.addEventListener('resize', syncMarkerPanelHeightToVideo);
        if (typeof ResizeObserver === 'function') {
            if (markerPanelHeightRo) markerPanelHeightRo.disconnect();
            markerPanelHeightRo = new ResizeObserver(syncMarkerPanelHeightToVideo);
            markerPanelHeightRo.observe(playerStageMain);
        }
    }

    function defaultMarkerPanelWidthPx() {
        if (!playerStage) return MARKER_PANEL_DEFAULT_PX;
        const stageW = playerStage.clientWidth || 1300;
        const half = (stageW - SPLITTER_WIDTH_PX) / 2;
        return clampMarkerPanelWidth(half);
    }

    function clampMarkerPanelWidth(px) {
        if (!playerStage) return MARKER_PANEL_DEFAULT_PX;
        const stageW = playerStage.clientWidth || 1300;
        const maxMarker = Math.max(
            MARKER_PANEL_MIN_PX,
            stageW - PLAYER_MAIN_MIN_PX - SPLITTER_WIDTH_PX - 8
        );
        return Math.max(MARKER_PANEL_MIN_PX, Math.min(maxMarker, px));
    }

    function applyMarkerPanelWidth(px, opt) {
        if (!playerStage || !markerPanel) return;
        const w = clampMarkerPanelWidth(px);
        playerStage.style.setProperty('--marker-panel-width', w + 'px');
        markerPanel.style.flex = '0 0 ' + w + 'px';
        markerPanel.style.width = w + 'px';
        if (!opt || !opt.skipSave) {
            try {
                const p = readPrefs();
                p.markerPanelWidthPx = w;
                localStorage.setItem(
                    LS_PREFS_KEY,
                    JSON.stringify({
                        loopPlayback:
                            typeof p.loopPlayback === 'boolean'
                                ? p.loopPlayback
                                : getLoopPlaybackEnabled(),
                        markerPanelWidthPx: w,
                    })
                );
            } catch (_) {}
        }
    }

    function applySavedMarkerPanelWidth(saved) {
        const n = Number(saved);
        if (Number.isFinite(n) && n >= MARKER_PANEL_MIN_PX) {
            applyMarkerPanelWidth(n, { skipSave: true });
        } else {
            applyMarkerPanelWidth(defaultMarkerPanelWidthPx(), { skipSave: true });
        }
    }

    function resetMarkerPanelWidthToDefault() {
        applyMarkerPanelWidth(defaultMarkerPanelWidthPx());
    }

    function markerPanelWidthFromClientX(clientX, stageRect) {
        const x = clientX - stageRect.left;
        return stageRect.width - x - SPLITTER_WIDTH_PX / 2;
    }

    function centerMarkerPanelWidthPx(stageRect) {
        const stageW = stageRect ? stageRect.width : playerStage.clientWidth || 1300;
        return clampMarkerPanelWidth((stageW - SPLITTER_WIDTH_PX) / 2);
    }

    function snapMarkerPanelWidthIfNearCenter(markerW, stageRect) {
        const centerW = centerMarkerPanelWidthPx(stageRect);
        const w = clampMarkerPanelWidth(markerW);
        if (Math.abs(w - centerW) <= SPLITTER_CENTER_SNAP_PX) return centerW;
        return w;
    }

    function onSplitterPointerMove(ev) {
        if (!splitterDragState || ev.pointerId !== splitterDragState.pointerId) return;
        if (!playerStage) return;
        const rect = playerStage.getBoundingClientRect();
        const markerW = snapMarkerPanelWidthIfNearCenter(
            markerPanelWidthFromClientX(ev.clientX, rect),
            rect
        );
        applyMarkerPanelWidth(markerW, { skipSave: true });
    }

    function onSplitterPointerUp(ev) {
        if (!splitterDragState || ev.pointerId !== splitterDragState.pointerId) return;
        if (playerStage) {
            const rect = playerStage.getBoundingClientRect();
            const markerW = snapMarkerPanelWidthIfNearCenter(
                markerPanelWidthFromClientX(ev.clientX, rect),
                rect
            );
            applyMarkerPanelWidth(markerW);
        }
        if (playerSplitter) playerSplitter.classList.remove('player-splitter--dragging');
        try {
            splitterDragState.target.releasePointerCapture(ev.pointerId);
        } catch (_) {}
        splitterDragState = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }

    function initPlayerSplitter() {
        if (!playerSplitter || !playerStage) return;
        const prefs = readPrefs();
        applySavedMarkerPanelWidth(prefs.markerPanelWidthPx);

        playerSplitter.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;
            if (window.matchMedia('(max-width: 960px)').matches) return;
            ev.preventDefault();
            const rect = playerStage.getBoundingClientRect();
            splitterDragState = {
                pointerId: ev.pointerId,
                target: playerSplitter,
                stageRect: rect,
            };
            playerSplitter.classList.add('player-splitter--dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            try {
                playerSplitter.setPointerCapture(ev.pointerId);
            } catch (_) {}
        });
        playerSplitter.addEventListener('pointermove', onSplitterPointerMove);
        playerSplitter.addEventListener('pointerup', onSplitterPointerUp);
        playerSplitter.addEventListener('pointercancel', onSplitterPointerUp);

        playerSplitter.addEventListener('dblclick', (ev) => {
            if (window.matchMedia('(max-width: 960px)').matches) return;
            ev.preventDefault();
            resetMarkerPanelWidthToDefault();
        });

        window.addEventListener('resize', () => {
            const cur = markerPanel ? parseFloat(markerPanel.style.width) : NaN;
            applyMarkerPanelWidth(
                Number.isFinite(cur) ? cur : defaultMarkerPanelWidthPx(),
                { skipSave: true }
            );
            syncMarkerPanelHeightToVideo();
        });
        initMarkerPanelHeightSync();
    }
