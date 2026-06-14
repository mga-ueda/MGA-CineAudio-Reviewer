/**
 * layout-dock.js — ドッキングレイアウト（縦型デフォルト / 横型 H 切替、スプリッターなし）。
 */
(() => {
    const PANEL_IDS = [
        'header',
        'player',
        'playback',
        'markers',
        'waveform',
        'transport',
        'monitor',
        'log',
        'reading',
        'footer',
    ];

    const LAYOUT_MODES = {
        default: 'default',
        horizontal: 'horizontal',
    };

    /** 縦型（デフォルト） */
    const VERTICAL_LAYOUT = {
        version: 1,
        root: {
            type: 'split',
            dir: 'column',
            sizes: [0.06, 0.33, 0.14, 0.12, 0.11, 0.09, 0.13, 0.02],
            children: [
                { type: 'panel', id: 'header' },
                {
                    type: 'split',
                    dir: 'row',
                    sizes: [0.5, 0.5],
                    children: [
                        {
                            type: 'split',
                            dir: 'column',
                            sizes: [0.88, 0.12],
                            children: [
                                { type: 'panel', id: 'player' },
                                { type: 'panel', id: 'playback' },
                            ],
                        },
                        { type: 'panel', id: 'markers' },
                    ],
                },
                { type: 'panel', id: 'waveform' },
                { type: 'panel', id: 'transport' },
                { type: 'panel', id: 'monitor' },
                { type: 'panel', id: 'log' },
                { type: 'panel', id: 'reading' },
                { type: 'panel', id: 'footer' },
            ],
        },
    };

    /**
     * 横型 — 1段目: アナライザー列（ヘッダー / スペクトラム / 再生トランスポート）・ビデオ・マーカー
     * 2段目: 波形 / 3段目: オプション / 4段目: ドキュメント・ログ / 5段目: フッター
     */
    const HORIZONTAL_LAYOUT = {
        version: 1,
        root: {
            type: 'split',
            dir: 'column',
            sizes: [0.38, 0.26, 0.12, 0.20, 0.04],
            children: [
                {
                    type: 'split',
                    dir: 'row',
                    sizes: [0.45, 0.5, 0.5],
                    children: [
                        {
                            type: 'split',
                            dir: 'column',
                            sizes: [0.10, 0.72, 0.18],
                            children: [
                                { type: 'panel', id: 'header' },
                                { type: 'panel', id: 'monitor' },
                                { type: 'panel', id: 'playback' },
                            ],
                        },
                        { type: 'panel', id: 'player' },
                        { type: 'panel', id: 'markers' },
                    ],
                },
                { type: 'panel', id: 'waveform' },
                { type: 'panel', id: 'transport' },
                {
                    type: 'split',
                    dir: 'row',
                    sizes: [0.4, 0.6],
                    children: [
                        { type: 'panel', id: 'log' },
                        { type: 'panel', id: 'reading' },
                    ],
                },
                { type: 'panel', id: 'footer' },
            ],
        },
    };

    const shellEl = document.getElementById('appLayoutShell');
    let panelSources = {};
    let currentLayoutMode = LAYOUT_MODES.default;

    function deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function normalizeLayoutMode(mode) {
        return mode === LAYOUT_MODES.horizontal ? LAYOUT_MODES.horizontal : LAYOUT_MODES.default;
    }

    function normalizeSizes(sizes) {
        if (!Array.isArray(sizes) || !sizes.length) return [1];
        const sum = sizes.reduce((a, b) => a + (Number(b) > 0 ? Number(b) : 0), 0);
        if (sum <= 0) {
            const even = 1 / sizes.length;
            return sizes.map(() => even);
        }
        return sizes.map((s) => (Number(s) > 0 ? Number(s) : 0) / sum);
    }

    function collectPanelSources() {
        PANEL_IDS.forEach((id) => {
            if (panelSources[id] && panelSources[id].isConnected) return;
            const el = document.querySelector('[data-layout-panel="' + id + '"]');
            if (el) panelSources[id] = el;
        });
    }

    function applyPaneFlexRatio(pane, ratio) {
        if (!pane) return;
        const r = Number(ratio) > 0 ? Number(ratio) : 1;
        pane.style.flex = r + ' 1 0%';
        pane.style.flexShrink = '';
        pane.style.height = '';
        pane.style.maxHeight = '';
        pane.dataset.layoutFlexRatio = String(r);
    }

    function renderSplit(node) {
        const split = document.createElement('div');
        split.className =
            'layout-dock-split layout-dock-split--' + (node.dir === 'row' ? 'row' : 'column');
        split.dataset.layoutSplit = node.dir;
        const sizes = normalizeSizes(node.sizes || node.children.map(() => 1));
        node.children.forEach((child, i) => {
            const childWrap = document.createElement('div');
            childWrap.className = 'layout-dock-split__pane';
            applyPaneFlexRatio(childWrap, sizes[i]);
            childWrap.dataset.layoutPaneIndex = String(i);
            childWrap.appendChild(renderNode(child));
            split.appendChild(childWrap);
        });
        return split;
    }

    function renderPanel(id) {
        const panel = document.createElement('div');
        panel.className = 'layout-dock-panel';
        panel.dataset.layoutPanelHost = id;

        const body = document.createElement('div');
        body.className = 'layout-dock-panel__body';
        body.dataset.layoutPanelBody = id;

        const src = panelSources[id];
        if (src) {
            src.hidden = false;
            src.removeAttribute('aria-hidden');
            body.appendChild(src);
        }

        panel.appendChild(body);
        return panel;
    }

    function renderNode(node) {
        if (node.type === 'panel') return renderPanel(node.id);
        return renderSplit(node);
    }

    function notifyLayoutChanged() {
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        if (typeof applyWaveformTimelineZoomLayout === 'function') {
            applyWaveformTimelineZoomLayout();
        }
        if (typeof scheduleMarkersUiRefreshAfterLayout === 'function') {
            scheduleMarkersUiRefreshAfterLayout();
        }
        scheduleHorizontalLogDocHeightSync();
        window.dispatchEvent(new CustomEvent('layoutdockchange'));
    }

    const HORIZONTAL_LOG_DOC_ROW_SEL =
        '#appLayoutShell > .layout-dock-split--column > .layout-dock-split__pane:nth-child(4) > .layout-dock-split--row';

    function getHorizontalLogDocRowPanes() {
        const row = document.querySelector(HORIZONTAL_LOG_DOC_ROW_SEL);
        if (!row) return null;
        const panes = row.querySelectorAll(':scope > .layout-dock-split__pane');
        if (panes.length < 2) return null;
        return { row, logPane: panes[0], docPane: panes[1] };
    }

    function clearHorizontalLogDocHeightSync() {
        const panes = getHorizontalLogDocRowPanes();
        if (!panes) return;
        panes.logPane.style.minHeight = '';
        panes.logPane.style.height = '';
    }

    function syncHorizontalLogDocHeights() {
        if (currentLayoutMode !== LAYOUT_MODES.horizontal) {
            clearHorizontalLogDocHeightSync();
            return;
        }
        const panes = getHorizontalLogDocRowPanes();
        if (!panes) return;
        const { logPane, docPane } = panes;
        logPane.style.minHeight = '';
        logPane.style.height = '';
        const docH = Math.ceil(docPane.getBoundingClientRect().height);
        if (docH > 0) {
            logPane.style.minHeight = docH + 'px';
        }
    }

    let horizontalLogDocHeightRaf = 0;
    let horizontalLogDocHeightObs = null;

    function scheduleHorizontalLogDocHeightSync() {
        if (horizontalLogDocHeightRaf) cancelAnimationFrame(horizontalLogDocHeightRaf);
        horizontalLogDocHeightRaf = requestAnimationFrame(() => {
            horizontalLogDocHeightRaf = requestAnimationFrame(() => {
                horizontalLogDocHeightRaf = 0;
                syncHorizontalLogDocHeights();
            });
        });
    }

    function installHorizontalLogDocHeightSync() {
        window.addEventListener('resize', scheduleHorizontalLogDocHeightSync);
        const reading = document.getElementById('appReadingArea');
        if (reading) {
            reading.addEventListener('toggle', scheduleHorizontalLogDocHeightSync, true);
            if (typeof ResizeObserver !== 'undefined') {
                if (horizontalLogDocHeightObs) horizontalLogDocHeightObs.disconnect();
                horizontalLogDocHeightObs = new ResizeObserver(scheduleHorizontalLogDocHeightSync);
                horizontalLogDocHeightObs.observe(reading);
            }
        }
        scheduleHorizontalLogDocHeightSync();
    }

    function renderLayoutTree(tree) {
        if (!shellEl) return;
        collectPanelSources();
        shellEl.replaceChildren();
        shellEl.appendChild(renderNode(deepClone(tree)));
        notifyLayoutChanged();
    }

    function layoutTreeForMode(mode) {
        return normalizeLayoutMode(mode) === LAYOUT_MODES.horizontal
            ? HORIZONTAL_LAYOUT.root
            : VERTICAL_LAYOUT.root;
    }

    function applyLayoutModeBodyClass() {
        const horizontal = currentLayoutMode === LAYOUT_MODES.horizontal;
        document.body.classList.toggle('layout-mode-horizontal', horizontal);
        if (shellEl) {
            shellEl.dataset.layoutMode = horizontal ? 'horizontal' : 'vertical';
        }
        if (!horizontal) {
            clearHorizontalLogDocHeightSync();
        } else {
            scheduleHorizontalLogDocHeightSync();
        }
    }

    function layoutModeLabel(mode) {
        const horizontal = normalizeLayoutMode(mode) === LAYOUT_MODES.horizontal;
        if (typeof msg === 'function') {
            return horizontal
                ? msg('toast.layout.horizontalView')
                : msg('toast.layout.defaultView');
        }
        return horizontal ? 'Horizontal View' : 'Default View';
    }

    function renderCurrentLayout() {
        renderLayoutTree(layoutTreeForMode(currentLayoutMode));
    }

    function setLayoutDockMode(mode, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const next = normalizeLayoutMode(mode);
        if (next === currentLayoutMode && !o.force) return;
        currentLayoutMode = next;
        applyLayoutModeBodyClass();
        renderCurrentLayout();
        if (!o.skipSave && typeof writePrefs === 'function') writePrefs();
        if (!o.silent) {
            const label = layoutModeLabel(next);
            if (typeof writeLog === 'function') {
                if (typeof msg === 'function') {
                    writeLog(msg('log.layout.mode', label));
                } else {
                    writeLog('Layout: ' + label);
                }
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint(label, '', 'notice', { center: true });
            }
        }
    }

    function toggleLayoutDockMode(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const next =
            currentLayoutMode === LAYOUT_MODES.horizontal
                ? LAYOUT_MODES.default
                : LAYOUT_MODES.horizontal;
        setLayoutDockMode(next, o);
        return true;
    }

    function handleLayoutModeShortcutKeydown(e) {
        if (typeof matchUserShortcut !== 'function' || !matchUserShortcut(e, 'layoutModeToggle')) {
            return false;
        }
        e.preventDefault();
        toggleLayoutDockMode();
        return true;
    }

    function setLayoutDockPanelHostHidden(panelId, hidden) {
        if (!shellEl || !PANEL_IDS.includes(panelId)) return;
        const panel = shellEl.querySelector(
            '.layout-dock-panel[data-layout-panel-host="' + panelId + '"]',
        );
        if (!panel) return;
        panel.hidden = !!hidden;
        const pane = panel.parentElement;
        if (!pane?.classList.contains('layout-dock-split__pane')) return;
        pane.hidden = !!hidden;
        if (!hidden) {
            let ancestor = pane.parentElement;
            while (ancestor && ancestor !== shellEl) {
                if (ancestor.classList.contains('layout-dock-split__pane')) {
                    ancestor.hidden = false;
                }
                ancestor = ancestor.parentElement;
            }
        }
    }

    function syncLayoutDockPaneCollapseFromHidden() {
        if (!shellEl) return;
        shellEl.querySelectorAll('.layout-dock-split__pane').forEach((pane) => {
            const directPanel = pane.querySelector(':scope > .layout-dock-panel[data-layout-panel-host]');
            if (directPanel?.hidden) {
                pane.hidden = true;
                return;
            }
            const childSplit = pane.querySelector(':scope > .layout-dock-split');
            if (!childSplit) return;
            const subPanes = childSplit.querySelectorAll(':scope > .layout-dock-split__pane');
            if (subPanes.length && [...subPanes].every((p) => p.hidden)) {
                pane.hidden = true;
            }
        });
    }

    function getLayoutDockPersistSnapshot() {
        return { mode: currentLayoutMode };
    }

    function getLayoutDockMode() {
        return currentLayoutMode;
    }

    function initLayoutDockFromPrefs(prefs) {
        collectPanelSources();
        const dock =
            prefs && prefs.layoutDock && typeof prefs.layoutDock === 'object' ? prefs.layoutDock : {};
        currentLayoutMode = normalizeLayoutMode(dock.mode);
        applyLayoutModeBodyClass();
        renderCurrentLayout();
    }

    window.initLayoutDockFromPrefs = initLayoutDockFromPrefs;
    window.getLayoutDockPersistSnapshot = getLayoutDockPersistSnapshot;
    window.getLayoutDockMode = getLayoutDockMode;
    window.setLayoutDockMode = setLayoutDockMode;
    window.toggleLayoutDockMode = toggleLayoutDockMode;
    window.handleLayoutModeShortcutKeydown = handleLayoutModeShortcutKeydown;
    window.setLayoutDockPanelHostHidden = setLayoutDockPanelHostHidden;
    window.syncLayoutDockPaneCollapseFromHidden = syncLayoutDockPaneCollapseFromHidden;
    installHorizontalLogDocHeightSync();
})();
