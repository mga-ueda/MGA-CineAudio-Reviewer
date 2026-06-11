/**
 * layout-dock.js — ドッキング可能パネルレイアウト（U: 標準 ↔ ユーザーレイアウト、Shift+U: 編集 ↔ 表示）。
 */
(() => {
    const PANEL_IDS = ['header', 'player', 'playback', 'markers', 'waveform', 'transport', 'monitor', 'log', 'reading', 'footer'];

    const PANEL_LABELS = {
        header: 'Header',
        player: 'Video',
        playback: 'Transport',
        markers: 'Markers',
        waveform: 'Audio Tracks',
        transport: 'Options',
        monitor: 'Analyzer',
        log: 'Log',
        reading: 'Reading',
        footer: 'Footer',
    };

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

    const LAYOUT_MODES = ['default', 'custom', 'customView'];

    const LAYOUT_MODE_TOAST = {
        default: 'Default layout',
        custom: 'Custom layout (edit)',
        customView: 'Custom layout',
    };

    const PANEL_TOOLTIP_LABELS = {
        header: 'ヘッダー',
        player: '映像',
        playback: 'トランスポート',
        markers: 'マーカー',
        waveform: '音声トラック',
        transport: 'オプション',
        monitor: 'アナライザー',
        log: 'ログ',
        reading: 'リーディング',
        footer: 'フッター',
    };

    let layoutMode = 'default';
    /** ユーザーレイアウト編集モード中は true（レイアウト操作以外を一括無効化） */
    let layoutDockStructureEditing = false;
    let defaultLayoutTree = deepClone(DEFAULT_LAYOUT.root);
    let customLayoutTree = deepClone(DEFAULT_LAYOUT.root);
    let activeLayoutTree = deepClone(DEFAULT_LAYOUT.root);
    let panelSources = {};
    let dragState = null;

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

    function readLayoutFromNode(nodeEl) {
        if (!nodeEl) return null;
        if (nodeEl.classList.contains('layout-dock-panel')) {
            const id = nodeEl.dataset.layoutPanelHost;
            if (!PANEL_IDS.includes(id)) return null;
            return { type: 'panel', id };
        }
        if (nodeEl.classList.contains('layout-dock-split')) {
            const dir = nodeEl.dataset.layoutSplit === 'row' ? 'row' : 'column';
            const panes = nodeEl.querySelectorAll(':scope > .layout-dock-split__pane');
            const sizes = [];
            const children = [];
            panes.forEach((pane) => {
                sizes.push(readPaneFlexWeight(pane));
                const child = readLayoutFromNode(pane.firstElementChild);
                if (child) children.push(child);
            });
            if (!children.length) return null;
            return {
                type: 'split',
                dir,
                sizes: normalizeSizes(sizes),
                children,
            };
        }
        return null;
    }

    function syncActiveTreeFromDom() {
        if (!shellEl || !shellEl.firstElementChild) return;
        const tree = readLayoutFromNode(shellEl.firstElementChild);
        if (!tree) return;
        activeLayoutTree = tree;
        if (layoutMode === 'custom') {
            customLayoutTree = deepClone(tree);
        } else {
            defaultLayoutTree = mergeDefaultStructureWithSizes(tree);
        }
    }

    function mergeDefaultStructureWithSizes(resizedTree) {
        const base = deepClone(DEFAULT_LAYOUT.root);
        copySplitSizes(base, resizedTree);
        return base;
    }

    function copySplitSizes(target, source) {
        if (!target || !source) return;
        if (target.type === 'panel' || source.type === 'panel') return;
        if (target.dir === source.dir && target.children.length === source.children.length) {
            target.sizes = normalizeSizes(source.sizes || target.sizes);
            for (let i = 0; i < target.children.length; i++) {
                copySplitSizes(target.children[i], source.children[i]);
            }
        }
    }

    function validateLayoutNode(node) {
        if (!node || typeof node !== 'object') return null;
        if (node.type === 'panel') {
            if (!PANEL_IDS.includes(node.id)) return null;
            return { type: 'panel', id: node.id };
        }
        if (node.type === 'split') {
            const dir = node.dir === 'row' ? 'row' : 'column';
            const children = Array.isArray(node.children)
                ? node.children.map(validateLayoutNode).filter(Boolean)
                : [];
            if (!children.length) return null;
            let sizes = Array.isArray(node.sizes) ? node.sizes.slice(0, children.length) : [];
            while (sizes.length < children.length) sizes.push(1);
            sizes = normalizeSizes(sizes.slice(0, children.length));
            return { type: 'split', dir, sizes, children };
        }
        return null;
    }

    function collapseLayoutNode(node) {
        if (!node) return null;
        if (node.type === 'panel') return node;
        const children = (node.children || []).map(collapseLayoutNode).filter(Boolean);
        if (!children.length) return null;
        if (children.length === 1) return children[0];
        let sizes = (node.sizes || []).slice(0, children.length);
        while (sizes.length < children.length) sizes.push(1);
        return {
            type: 'split',
            dir: node.dir === 'row' ? 'row' : 'column',
            sizes: normalizeSizes(sizes),
            children,
        };
    }

    function findPanelLocation(root, panelId, parent, index) {
        if (!root) return null;
        if (root.type === 'panel') {
            if (root.id === panelId) return { parent, index, node: root };
            return null;
        }
        for (let i = 0; i < root.children.length; i++) {
            const hit = findPanelLocation(root.children[i], panelId, root, i);
            if (hit) return hit;
        }
        return null;
    }

    function extractPanel(root, panelId) {
        const tree = deepClone(root);
        const loc = findPanelLocation(tree, panelId);
        if (!loc || !loc.parent) return null;
        const panelNode = loc.parent.children.splice(loc.index, 1)[0];
        loc.parent.sizes.splice(loc.index, 1);
        if (loc.parent.sizes.length) {
            loc.parent.sizes = normalizeSizes(loc.parent.sizes);
        }
        const nextRoot = collapseLayoutNode(tree);
        return { root: nextRoot || panelNode, panelNode };
    }

    function swapPanels(root, panelA, panelB) {
        if (!panelA || !panelB || panelA === panelB) return root;
        const tree = deepClone(root);
        const locA = findPanelLocation(tree, panelA);
        const locB = findPanelLocation(tree, panelB);
        if (!locA || !locB || !locA.parent || !locB.parent) return root;
        const nodeA = locA.parent.children[locA.index];
        const nodeB = locB.parent.children[locB.index];
        locA.parent.children[locA.index] = nodeB;
        locB.parent.children[locB.index] = nodeA;
        return collapseLayoutNode(tree) || tree;
    }

    function dockPanelRelative(root, targetPanelId, movingPanelId, zone) {
        if (!targetPanelId || !movingPanelId || targetPanelId === movingPanelId) return root;
        const extracted = extractPanel(root, movingPanelId);
        if (!extracted) return root;
        let tree = extracted.root;
        const panelNode = extracted.panelNode;
        const loc = findPanelLocation(tree, targetPanelId);
        if (!loc || !loc.parent) {
            return collapseLayoutNode({
                type: 'split',
                dir: 'column',
                sizes: [0.5, 0.5],
                children: [tree.type === 'panel' ? tree : tree, panelNode],
            });
        }
        const { parent, index } = loc;
        const targetNode = parent.children[index];
        if (zone === 'left' || zone === 'right') {
            parent.children[index] = {
                type: 'split',
                dir: 'row',
                sizes: [0.5, 0.5],
                children: zone === 'left' ? [panelNode, targetNode] : [targetNode, panelNode],
            };
        } else {
            parent.children[index] = {
                type: 'split',
                dir: 'column',
                sizes: [0.5, 0.5],
                children: zone === 'top' ? [panelNode, targetNode] : [targetNode, panelNode],
            };
        }
        parent.sizes = normalizeSizes(parent.sizes);
        return collapseLayoutNode(tree) || tree;
    }

    function isCustomLayoutMode(mode) {
        return mode === 'custom' || mode === 'customView';
    }

    function syncShellModeClass() {
        if (!shellEl) return;
        shellEl.classList.toggle('layout-dock-shell--default', layoutMode === 'default');
        shellEl.classList.toggle('layout-dock-shell--custom', isCustomLayoutMode(layoutMode));
        shellEl.classList.toggle('layout-dock-shell--custom-edit', layoutMode === 'custom');
        shellEl.classList.toggle('layout-dock-shell--custom-view', layoutMode === 'customView');
        syncLayoutDockStructureEditingFlag();
    }

    function syncLayoutDockStructureEditingFlag() {
        const next = layoutMode === 'custom';
        if (layoutDockStructureEditing === next) return;
        layoutDockStructureEditing = next;
        document.body.classList.toggle('layout-dock-structure-editing', next);
        if (next) {
            try {
                const ae = document.activeElement;
                if (ae && ae !== document.body && typeof ae.blur === 'function') {
                    ae.blur();
                }
            } catch (_) {}
        }
        if (typeof refreshOperationBlockingControlLocks === 'function') {
            refreshOperationBlockingControlLocks();
        }
    }

    function isLayoutDockStructureEditing() {
        return layoutDockStructureEditing;
    }

    /** 指定パネル（player / monitor 等）とその直下ペインだけを hidden にする。 */
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

    /** 子ペインがすべて hidden の親ペインを折りたたむ（Video+Transport 列など）。 */
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

    /** lane 拡縮前に記録した、波形より上の split ペイン高さ（px） */
    let customLayoutAboveWaveformPinHeights = null;

    function getWaveformColumnSplitContext() {
        if (!shellEl || !isCustomLayoutMode(layoutMode)) return null;
        const panel = shellEl.querySelector('.layout-dock-panel[data-layout-panel-host="waveform"]');
        if (!panel) return null;
        const pane = panel.closest('.layout-dock-split__pane');
        if (!pane) return null;
        const split = pane.parentElement;
        if (!split?.classList.contains('layout-dock-split') || split.dataset.layoutSplit !== 'column') {
            return null;
        }
        const panes = [...split.querySelectorAll(':scope > .layout-dock-split__pane')].filter(
            (p) => !p.hidden,
        );
        const wfIdx = panes.indexOf(pane);
        if (wfIdx < 0) return null;
        return { panel, pane, split, panes, wfIdx };
    }

    function readPaneFlexWeight(pane) {
        if (!pane) return 1;
        const stored = parseFloat(pane.dataset.layoutFlexRatio || '');
        if (Number.isFinite(stored) && stored > 0) return stored;
        const inline = String(pane.style.flex || '').trim();
        if (inline) {
            const grow = parseFloat(inline.split(/\s+/)[0]);
            if (Number.isFinite(grow) && grow > 0) return grow;
        }
        const grow = parseFloat(window.getComputedStyle(pane).flexGrow);
        return Number.isFinite(grow) && grow > 0 ? grow : 1;
    }

    function applyPaneFlexRatio(pane, ratio) {
        if (!pane) return;
        const r = Number(ratio) > 0 ? Number(ratio) : 1;
        pane.style.flex = r + ' 1 0%';
        pane.dataset.layoutFlexRatio = String(r);
    }

    function layoutSectionGapPx() {
        const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--layout-section-gap');
        const n = parseFloat(String(raw || '').trim());
        return Number.isFinite(n) && n > 0 ? n : 7;
    }

    function positionSplitResizeHandles(splitEl) {
        if (!splitEl || layoutMode !== 'custom') return;
        const dir = splitEl.dataset.layoutSplit;
        const isRow = dir === 'row';
        const panes = [...splitEl.querySelectorAll(':scope > .layout-dock-split__pane')].filter(
            (pane) => !pane.hidden,
        );
        const gap = layoutSectionGapPx();
        const half = gap / 2;
        const rs = splitEl.getBoundingClientRect();
        splitEl.querySelectorAll(':scope > .layout-dock-resize-handle').forEach((handle) => {
            const index = Number(handle.dataset.layoutGutterIndex);
            const paneA = panes[index];
            const paneB = panes[index + 1];
            if (!paneA || !paneB) {
                handle.hidden = true;
                return;
            }
            handle.hidden = false;
            const ra = paneA.getBoundingClientRect();
            const rb = paneB.getBoundingClientRect();
            if (isRow) {
                const mid = (ra.right + rb.left) / 2 - rs.left;
                handle.style.left = Math.round(mid - half) + 'px';
                handle.style.top = '0';
                handle.style.bottom = '0';
                handle.style.width = gap + 'px';
                handle.style.height = '';
                handle.style.right = '';
            } else {
                const mid = (ra.bottom + rb.top) / 2 - rs.top;
                handle.style.top = Math.round(mid - half) + 'px';
                handle.style.left = '0';
                handle.style.right = '0';
                handle.style.height = gap + 'px';
                handle.style.width = '';
                handle.style.bottom = '';
            }
        });
    }

    function positionAllSplitResizeHandles() {
        if (!shellEl || layoutMode !== 'custom') return;
        shellEl.querySelectorAll('.layout-dock-split').forEach((split) => positionSplitResizeHandles(split));
    }

    function setSplitResizeHandleActive(handle, active) {
        if (!handle) return;
        if (active) {
            handle.classList.add('layout-dock-resize-handle--active');
            handle.dataset.layoutResizeActive = '1';
        } else {
            handle.classList.remove('layout-dock-resize-handle--active');
            delete handle.dataset.layoutResizeActive;
        }
    }

    function attachSplitResize(splitEl) {
        splitEl.querySelectorAll(':scope > .layout-dock-resize-handle').forEach((handle) => {
            if (handle.dataset.layoutResizeBound === '1') return;
            handle.dataset.layoutResizeBound = '1';
            handle.addEventListener('pointerdown', (e) => {
                if (layoutMode !== 'custom') return;
                if (e.button !== 0) return;
                e.preventDefault();
                const dir = handle.dataset.layoutGutter;
                const index = Number(handle.dataset.layoutGutterIndex);
                const panes = splitEl.querySelectorAll(':scope > .layout-dock-split__pane');
                const paneA = panes[index];
                const paneB = panes[index + 1];
                if (!paneA || !paneB) return;

                handle.setPointerCapture(e.pointerId);
                setSplitResizeHandleActive(handle, true);
                document.body.classList.add('layout-dock-resizing');
                document.body.classList.toggle('layout-dock-resizing--row', dir === 'column');

                const startPos = dir === 'row' ? e.clientX : e.clientY;
                const sizeA =
                    dir === 'row'
                        ? paneA.getBoundingClientRect().width
                        : paneA.getBoundingClientRect().height;
                const sizeB =
                    dir === 'row'
                        ? paneB.getBoundingClientRect().width
                        : paneB.getBoundingClientRect().height;
                const pairTotal = sizeA + sizeB;

                function onMove(ev) {
                    if (ev.pointerId !== e.pointerId) return;
                    setSplitResizeHandleActive(handle, true);
                    const pos = dir === 'row' ? ev.clientX : ev.clientY;
                    const delta = pos - startPos;
                    let nextA = sizeA + delta;
                    let nextB = sizeB - delta;
                    const minPx = 72;
                    if (nextA < minPx) {
                        nextB -= minPx - nextA;
                        nextA = minPx;
                    }
                    if (nextB < minPx) {
                        nextA -= minPx - nextB;
                        nextB = minPx;
                    }
                    if (dir === 'row' && !ev.altKey && pairTotal >= minPx * 2) {
                        const center = pairTotal / 2;
                        const snapPx = Math.max(12, pairTotal * 0.04);
                        if (Math.abs(nextA - center) <= snapPx) {
                            nextA = center;
                            nextB = center;
                        }
                    }
                    const ratioA = nextA / pairTotal;
                    const ratioB = nextB / pairTotal;
                    applyPaneFlexRatio(paneA, ratioA);
                    applyPaneFlexRatio(paneB, ratioB);
                    positionSplitResizeHandles(splitEl);
                }

                function onEnd(ev) {
                    if (ev.pointerId !== e.pointerId) return;
                    if (handle.hasPointerCapture(ev.pointerId)) {
                        handle.releasePointerCapture(ev.pointerId);
                    }
                    handle.removeEventListener('pointermove', onMove);
                    handle.removeEventListener('pointerup', onEnd);
                    handle.removeEventListener('pointercancel', onEnd);
                    setSplitResizeHandleActive(handle, false);
                    document.body.classList.remove('layout-dock-resizing');
                    document.body.classList.remove('layout-dock-resizing--row');
                    positionSplitResizeHandles(splitEl);
                    syncActiveTreeFromDom();
                    persistLayoutPrefs();
                    notifyLayoutChanged();
                }

                handle.addEventListener('pointermove', onMove);
                handle.addEventListener('pointerup', onEnd);
                handle.addEventListener('pointercancel', onEnd);
            });
        });
    }

    function ensureSplitResizeHandles(splitEl) {
        if (!splitEl || !isCustomLayoutMode(layoutMode)) return;
        splitEl.style.position = 'relative';
        const dir = splitEl.dataset.layoutSplit;
        const isRow = dir === 'row';
        const panes = splitEl.querySelectorAll(':scope > .layout-dock-split__pane');
        splitEl.querySelectorAll(':scope > .layout-dock-resize-handle').forEach((handle) => handle.remove());
        for (let i = 0; i < panes.length - 1; i++) {
            const handle = document.createElement('div');
            handle.className =
                'layout-dock-resize-handle layout-dock-resize-handle--' + (isRow ? 'col' : 'row');
            handle.dataset.layoutGutter = dir;
            handle.dataset.layoutGutterIndex = String(i);
            handle.title = isRow
                ? 'ドラッグで幅を変更（縦スプリッター）。中央付近でスナップ（Alt 押下中は無効）'
                : 'ドラッグで高さを変更（横スプリッター）';
            handle.setAttribute('role', 'separator');
            handle.setAttribute('aria-orientation', isRow ? 'vertical' : 'horizontal');
            splitEl.appendChild(handle);
        }
        attachSplitResize(splitEl);
        positionSplitResizeHandles(splitEl);
    }

    function computeWaveformCompositeContentHeight() {
        const composite = document.getElementById('audioWaveformComposite');
        if (!composite) return 0;
        const cs = window.getComputedStyle(composite);
        const padTop = parseFloat(cs.paddingTop || '0') || 0;
        const padBottom = parseFloat(cs.paddingBottom || '0') || 0;
        const laneCount = parseInt(cs.getPropertyValue('--wave-lane-count'), 10) || 1;
        const laneH =
            typeof getWaveformLaneHeightCss === 'function'
                ? getWaveformLaneHeightCss()
                : Math.round(92 * (parseFloat(cs.getPropertyValue('--wave-lane-height-scale')) || 1));
        const lanes = composite.querySelector('.audio-waveform-composite__lanes');
        const lanesCs = lanes ? window.getComputedStyle(lanes) : null;
        const scrollbarH = lanesCs
            ? parseFloat(lanesCs.getPropertyValue('--wave-lanes-scrollbar-h') || '0') || 0
            : 0;
        return Math.max(
            1,
            Math.round(padTop + padBottom + laneCount * laneH + scrollbarH),
        );
    }

    /** 拡張レイアウト: lane 拡縮の直前に呼び、上側ペインの現在高さを記録する */
    function captureCustomLayoutWaveformPaneHeights() {
        const ctx = getWaveformColumnSplitContext();
        if (!ctx) {
            customLayoutAboveWaveformPinHeights = null;
            return;
        }
        const heights = new Map();
        for (let i = 0; i < ctx.wfIdx; i++) {
            const h = Math.round(ctx.panes[i].getBoundingClientRect().height);
            if (h > 0) heights.set(ctx.panes[i], h);
        }
        customLayoutAboveWaveformPinHeights = heights;
    }

    /** 拡張レイアウト: 波形はコンテンツ高さ、上側は記録値で固定（下側 ratio flex が余白を吸収） */
    function syncCustomLayoutWaveformPaneHeight() {
        const ctx = getWaveformColumnSplitContext();
        if (!ctx) return;

        const { pane, panes, wfIdx } = ctx;
        const pins = customLayoutAboveWaveformPinHeights;
        const contentH = computeWaveformCompositeContentHeight();

        for (let i = 0; i < wfIdx; i++) {
            const pinned = pins?.get(panes[i]);
            if (pinned > 0) {
                panes[i].style.flex = '0 0 ' + pinned + 'px';
            }
        }

        pane.style.flex = '0 0 ' + contentH + 'px';
        pane.style.flexShrink = '0';
        delete pane.dataset.layoutFlexRatio;

        for (let i = wfIdx + 1; i < panes.length; i++) {
            applyPaneFlexRatio(panes[i], readPaneFlexWeight(panes[i]));
        }

        customLayoutAboveWaveformPinHeights = null;

        if (typeof applyWaveformTimelineZoomLayout === 'function') {
            applyWaveformTimelineZoomLayout();
        }

        if (layoutMode === 'custom') {
            requestAnimationFrame(() => positionAllSplitResizeHandles());
        }
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
        if (layoutMode === 'custom') {
            requestAnimationFrame(() => positionAllSplitResizeHandles());
        }
    }

    function persistLayoutPrefs() {
        if (typeof writePrefs === 'function') writePrefs();
    }

    function renderSplit(node, structureEditable) {
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
            childWrap.appendChild(renderNode(child, structureEditable));
            split.appendChild(childWrap);
        });
        if (isCustomLayoutMode(layoutMode)) ensureSplitResizeHandles(split);
        return split;
    }

    function renderPanel(id, structureEditable) {
        const panel = document.createElement('div');
        panel.className = 'layout-dock-panel';
        panel.dataset.layoutPanelHost = id;

        const body = document.createElement('div');
        body.className = 'layout-dock-panel__body';
        body.dataset.layoutPanelBody = id;
        body.title =
            structureEditable
                ? 'ドラッグで移動（' + (PANEL_TOOLTIP_LABELS[id] || PANEL_LABELS[id] || id) + '）'
                : '';
        body.addEventListener('dragstart', (e) => onPanelDragStart(e, id));
        body.addEventListener('dragend', onPanelDragEnd);
        if (isCustomLayoutMode(layoutMode)) {
            body.addEventListener('dragover', onPanelBodyDragOver);
            body.addEventListener('dragleave', onPanelBodyDragLeave);
            body.addEventListener('drop', onPanelBodyDrop);
        }

        const src = panelSources[id];
        if (src) {
            src.hidden = false;
            src.removeAttribute('aria-hidden');
            body.appendChild(src);
        }

        panel.appendChild(body);
        return panel;
    }

    function renderNode(node, structureEditable) {
        if (node.type === 'panel') return renderPanel(node.id, structureEditable);
        return renderSplit(node, structureEditable);
    }

    function scheduleCustomLayoutWaveformPaneSyncAfterRender() {
        if (!isCustomLayoutMode(layoutMode)) return;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (typeof syncCustomLayoutWaveformPaneHeight === 'function') {
                    syncCustomLayoutWaveformPaneHeight();
                }
            });
        });
    }

    function applyCustomLayoutEditState() {
        if (!shellEl || !isCustomLayoutMode(layoutMode)) return;
        const editing = layoutMode === 'custom';
        shellEl.querySelectorAll('.layout-dock-panel__body').forEach((body) => {
            body.draggable = editing;
        });
        if (editing) {
            shellEl.querySelectorAll('.layout-dock-split').forEach((split) => {
                if (!split.querySelector(':scope > .layout-dock-resize-handle')) {
                    ensureSplitResizeHandles(split);
                }
            });
            positionAllSplitResizeHandles();
        }
    }

    function renderLayoutTree(tree) {
        if (!shellEl) return;
        collectPanelSources();
        const structureEditable = layoutMode === 'custom';
        activeLayoutTree = collapseLayoutNode(deepClone(tree)) || deepClone(DEFAULT_LAYOUT.root);
        shellEl.replaceChildren();
        shellEl.appendChild(renderNode(activeLayoutTree, structureEditable));
        syncShellModeClass();
        applyCustomLayoutEditState();
        notifyLayoutChanged();
        scheduleCustomLayoutWaveformPaneSyncAfterRender();
    }

    function isLayoutDragExcludedTarget(target) {
        if (!target || typeof target.closest !== 'function') return true;
        if (target.closest('.layout-dock-resize-handle')) return true;
        return !!target.closest(
            'input, button, textarea, select, option, a, canvas, video, audio, summary, label, [contenteditable="true"], .audio-waveform-composite__lanes, .marker-table-wrap, .layout-dock-panel__body input, .layout-dock-panel__body button, .layout-dock-panel__body textarea, .layout-dock-panel__body select, .layout-dock-panel__body a, .layout-dock-panel__body canvas, .layout-dock-panel__body video',
        );
    }

    function isLayoutDockEditShortcutEvent(ev) {
        if (typeof matchUserShortcut !== 'function') return false;
        return (
            matchUserShortcut(ev, 'layoutEditToggle') || matchUserShortcut(ev, 'layoutModeToggle')
        );
    }

    function isLayoutDockEditAllowedInteraction(ev) {
        const target = ev && ev.target;
        if (!target || typeof target.closest !== 'function') return false;
        if (target.closest('.layout-dock-resize-handle')) return true;
        const body = target.closest('.layout-dock-panel__body');
        if (!body || body.draggable !== true) return false;
        const type = ev.type;
        if (type === 'dragstart') return !isLayoutDragExcludedTarget(target);
        if (
            type === 'dragover' ||
            type === 'dragenter' ||
            type === 'dragleave' ||
            type === 'drop' ||
            type === 'dragend'
        ) {
            return true;
        }
        if (type === 'pointerdown' || type === 'mousedown') {
            return !isLayoutDragExcludedTarget(target);
        }
        return false;
    }

    function blockAppInteractionForLayoutDockEdit(ev) {
        if (!layoutDockStructureEditing) return;
        if (ev.type === 'keydown' && isLayoutDockEditShortcutEvent(ev)) return;
        if (isLayoutDockEditAllowedInteraction(ev)) return;
        ev.preventDefault();
        ev.stopPropagation();
    }

    [
        'keydown',
        'pointerdown',
        'mousedown',
        'click',
        'dblclick',
        'contextmenu',
        'wheel',
        'touchstart',
        'touchmove',
        'dragstart',
        'dragover',
        'dragenter',
        'dragleave',
        'drop',
    ].forEach((type) => {
        document.addEventListener(type, blockAppInteractionForLayoutDockEdit, true);
    });

    function onPanelDragStart(e, panelId) {
        if (layoutMode !== 'custom') {
            e.preventDefault();
            return;
        }
        if (isLayoutDragExcludedTarget(e.target)) {
            e.preventDefault();
            return;
        }
        dragState = { panelId };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', panelId);
        shellEl?.classList.add('layout-dock-shell--dragging');
        e.currentTarget.closest('.layout-dock-panel')?.classList.add('layout-dock-panel--dragging');
    }

    function onPanelDragEnd() {
        dragState = null;
        shellEl?.classList.remove('layout-dock-shell--dragging');
        shellEl?.querySelectorAll('.layout-dock-panel__body--drop-active').forEach((el) => {
            el.classList.remove('layout-dock-panel__body--drop-active');
            el.dataset.layoutDropZone = '';
        });
        shellEl?.querySelectorAll('.layout-dock-panel--dragging').forEach((el) => {
            el.classList.remove('layout-dock-panel--dragging');
        });
    }

    function detectDropZone(bodyEl, clientX, clientY) {
        const rect = bodyEl.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) return null;
        const x = (clientX - rect.left) / rect.width;
        const y = (clientY - rect.top) / rect.height;
        const edge = 0.38;
        const distTop = y;
        const distBottom = 1 - y;
        const distLeft = x;
        const distRight = 1 - x;
        const min = Math.min(distTop, distBottom, distLeft, distRight);
        if (min > edge) return 'swap';
        if (min === distTop) return 'top';
        if (min === distBottom) return 'bottom';
        if (min === distLeft) return 'left';
        return 'right';
    }

    function onPanelBodyDragOver(e) {
        if (layoutMode !== 'custom' || !dragState) return;
        const targetId = e.currentTarget?.dataset?.layoutPanelBody;
        if (!targetId || targetId === dragState.panelId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const zone = detectDropZone(e.currentTarget, e.clientX, e.clientY);
        e.currentTarget.classList.add('layout-dock-panel__body--drop-active');
        e.currentTarget.dataset.layoutDropZone = zone || '';
    }

    function onPanelBodyDragLeave(e) {
        if (!e.currentTarget.contains(e.relatedTarget)) {
            e.currentTarget.classList.remove('layout-dock-panel__body--drop-active');
            e.currentTarget.dataset.layoutDropZone = '';
        }
    }

    function applyDockAction(movingId, targetId, zone) {
        if (!movingId || !targetId || movingId === targetId) return;
        if (zone === 'swap') {
            customLayoutTree = swapPanels(customLayoutTree, movingId, targetId);
        } else {
            customLayoutTree = dockPanelRelative(customLayoutTree, targetId, movingId, zone);
        }
        activeLayoutTree = deepClone(customLayoutTree);
        renderLayoutTree(activeLayoutTree);
        if (typeof writeLog === 'function') {
            writeLog(
                'Layout: ' +
                    (PANEL_LABELS[movingId] || movingId) +
                    ' → ' +
                    (PANEL_LABELS[targetId] || targetId) +
                    ' (' +
                    zone +
                    ')',
            );
        }
        syncActiveTreeFromDom();
        persistLayoutPrefs();
    }

    function onPanelBodyDrop(e) {
        if (layoutMode !== 'custom' || !dragState) return;
        e.preventDefault();
        const targetId = e.currentTarget?.dataset?.layoutPanelBody;
        const movingId = dragState.panelId;
        const zone = e.currentTarget.dataset.layoutDropZone || detectDropZone(e.currentTarget, e.clientX, e.clientY);
        e.currentTarget.classList.remove('layout-dock-panel__body--drop-active');
        e.currentTarget.dataset.layoutDropZone = '';
        if (!targetId || !movingId || !zone) return;
        applyDockAction(movingId, targetId, zone);
    }

    function setLayoutMode(mode, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const next = LAYOUT_MODES.includes(mode) ? mode : 'default';
        const prevMode = layoutMode;
        const changed = next !== prevMode;
        if (prevMode === 'custom' && next === 'customView') {
            syncActiveTreeFromDom();
        }
        layoutMode = next;
        if (isCustomLayoutMode(prevMode) && isCustomLayoutMode(next) && shellEl?.firstElementChild) {
            syncShellModeClass();
            applyCustomLayoutEditState();
            notifyLayoutChanged();
        } else if (isCustomLayoutMode(next)) {
            renderLayoutTree(customLayoutTree);
        } else {
            renderLayoutTree(defaultLayoutTree);
        }
        if (o.persist !== false && changed) persistLayoutPrefs();
        if (changed && o.log !== false) {
            const label = LAYOUT_MODE_TOAST[next] || next;
            if (typeof flashSeekHint === 'function') {
                flashSeekHint(label, '', 'notice');
            }
            if (typeof writeLog === 'function') {
                writeLog('Layout: ' + label);
            }
        }
    }

    function toggleLayoutDockMode() {
        if (layoutMode === 'default') {
            setLayoutMode('customView');
        } else if (layoutMode === 'customView') {
            setLayoutMode('default');
        } else {
            setLayoutMode('default');
        }
    }

    function toggleLayoutDockEditMode() {
        if (layoutMode === 'custom') {
            setLayoutMode('customView');
        } else {
            setLayoutMode('custom');
        }
    }

    function getLayoutDockMode() {
        return layoutMode;
    }

    function getLayoutDockPersistSnapshot() {
        return {
            mode: layoutMode,
            custom: deepClone(customLayoutTree),
            defaultTree: deepClone(defaultLayoutTree),
        };
    }

    function ensureAllPanelsInTree(root) {
        const present = new Set();
        function walk(node) {
            if (!node) return;
            if (node.type === 'panel') {
                present.add(node.id);
                return;
            }
            (node.children || []).forEach(walk);
        }
        walk(root);
        const missing = PANEL_IDS.filter((id) => !present.has(id));
        if (!missing.length) return root;
        const base =
            root && root.type === 'split' && root.dir === 'column'
                ? deepClone(root)
                : {
                      type: 'split',
                      dir: 'column',
                      sizes: [1],
                      children: [root || { type: 'panel', id: missing.shift() }],
                  };
        missing.forEach((id) => {
            base.children.push({ type: 'panel', id });
            base.sizes.push(1);
        });
        base.sizes = normalizeSizes(base.sizes);
        return collapseLayoutNode(base) || base;
    }

    function applyLayoutDockFromPrefs(prefs) {
        const p = prefs && typeof prefs === 'object' ? prefs : {};
        const dock = p.layoutDock && typeof p.layoutDock === 'object' ? p.layoutDock : {};
        let customNode = dock.custom;
        if (customNode && customNode.root) customNode = customNode.root;
        const validatedCustom = validateLayoutNode(customNode);
        if (validatedCustom) customLayoutTree = ensureAllPanelsInTree(validatedCustom);

        let defaultNode = dock.defaultTree;
        if (defaultNode && defaultNode.root) defaultNode = defaultNode.root;
        const validatedDefault = validateLayoutNode(defaultNode);
        if (validatedDefault) {
            defaultLayoutTree = ensureAllPanelsInTree(mergeDefaultStructureWithSizes(validatedDefault));
        }

        const mode = LAYOUT_MODES.includes(dock.mode) ? dock.mode : 'default';
        setLayoutMode(mode, { persist: false, log: false });
    }

    function initLayoutDockFromPrefs(prefs) {
        collectPanelSources();
        applyLayoutDockFromPrefs(prefs);
    }

    window.initLayoutDockFromPrefs = initLayoutDockFromPrefs;
    window.toggleLayoutDockMode = toggleLayoutDockMode;
    window.toggleLayoutDockEditMode = toggleLayoutDockEditMode;
    window.setLayoutDockMode = setLayoutMode;
    window.getLayoutDockMode = getLayoutDockMode;
    window.isLayoutDockStructureEditing = isLayoutDockStructureEditing;
    window.getLayoutDockPersistSnapshot = getLayoutDockPersistSnapshot;
    window.setLayoutDockPanelHostHidden = setLayoutDockPanelHostHidden;
    window.syncLayoutDockPaneCollapseFromHidden = syncLayoutDockPaneCollapseFromHidden;
    window.syncCustomLayoutWaveformPaneHeight = syncCustomLayoutWaveformPaneHeight;
    window.captureCustomLayoutWaveformPaneHeights = captureCustomLayoutWaveformPaneHeights;
})();
