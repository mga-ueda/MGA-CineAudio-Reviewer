/**
 * layout-dock.js — 標準ドッキングレイアウト（固定構造、スプリッターなし）。
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

    const DEFAULT_LAYOUT = {
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

    const shellEl = document.getElementById('appLayoutShell');
    let panelSources = {};

    function deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
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
        window.dispatchEvent(new CustomEvent('layoutdockchange'));
    }

    function renderLayoutTree(tree) {
        if (!shellEl) return;
        collectPanelSources();
        shellEl.replaceChildren();
        shellEl.appendChild(renderNode(deepClone(tree)));
        notifyLayoutChanged();
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
        return { mode: 'default' };
    }

    function initLayoutDockFromPrefs(_prefs) {
        collectPanelSources();
        renderLayoutTree(DEFAULT_LAYOUT.root);
    }

    window.initLayoutDockFromPrefs = initLayoutDockFromPrefs;
    window.getLayoutDockPersistSnapshot = getLayoutDockPersistSnapshot;
    window.setLayoutDockPanelHostHidden = setLayoutDockPanelHostHidden;
    window.syncLayoutDockPaneCollapseFromHidden = syncLayoutDockPaneCollapseFromHidden;
})();
