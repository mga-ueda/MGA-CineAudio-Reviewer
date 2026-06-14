/**
 * dev-constants-panel.js — js/core/constants.js の診断フラグを実行中に切り替えるフローティングメニュー（F10）。
 */
(function devConstantsPanelModule() {
    const DEBUG_LOG_ORDER = [
        'REGION_RESTORE',
        'MUSICAL_SLOT',
        'WAVEFORM_VIEWPORT',
        'VIDEO_ANALYZER',
        'KEY_PLAYBACK',
        'TEMPO_STRETCH',
        'SILENT_GAP_DELETE',
    ];

    const DEBUG_LOG_META = {
        REGION_RESTORE: {
            label: 'セッション復元',
            tag: '[RegionRestore]',
            desc: 'F5 復元・overlay 再描画・All Clear の段階追跡。リージョン欠落・二重表示・slots 空の調査。',
        },
        MUSICAL_SLOT: {
            label: 'Musical / Phrase スロット',
            tag: '[MusicalSlot]',
            desc: 'SwapUnit バインディング・入れ替え・無音選択。Phrase 着色時の番号ずれ・binding 不整合の調査。',
        },
        WAVEFORM_VIEWPORT: {
            label: '波形ビューポート',
            tag: '[WaveformViewport]',
            desc: '128px タイル描画・ピークキャッシュの内部動作。ズーム/スクロール時の欠け・チラつきの調査。',
        },
        VIDEO_ANALYZER: {
            label: '動画 Analyze',
            tag: '[VideoAnalyzer]',
            desc: 'MediaElement タップ・Analyze 再接続・キャプチャ経路。スペクトラム/メーター/LKFS 不更新の調査。',
        },
        KEY_PLAYBACK: {
            label: 'キー / ピッチ再生',
            tag: '[KeyPlayback]',
            desc: 'キーシフト・境界分割・ライブストレッチ・ハンドオフ。クリック途切れ・クロスフェード競合の調査。',
        },
        TEMPO_STRETCH: {
            label: 'テンポストレッチ',
            tag: '[TempoStretch/A]',
            desc: 'Ex 波形のオフラインストレッチ・clip/applied・失敗ログ。無音・尺異常の調査に。KEY_PLAYBACK と併用可。',
        },
        SILENT_GAP_DELETE: {
            label: '無音 gap 削除',
            tag: '[SilentGapDel]',
            desc: 'Ctrl+クリック無音選択・Delete 経路。削除効かない・フレーズ定義崩れの調査。',
        },
    };

    const REGION_HIT_DEBUG_META = {
        label: 'リージョン操作帯',
        tag: 'overlay',
        desc:
            'Fade 三角・In/Out・Split・クロスフェード重なり・Phrase 境界・上端 fade 予約帯を色分け表示（ログとは別）。',
    };

    let overlayEl = null;
    let panelEl = null;
    let bodyEl = null;
    let open = false;
    let checkboxByKey = new Map();
    let skipApplyCheckbox = null;

    function ensureTempoStretchVerify() {
        if (!window.TEMPO_STRETCH_VERIFY || typeof window.TEMPO_STRETCH_VERIFY !== 'object') {
            window.TEMPO_STRETCH_VERIFY = { skipApply: false };
        }
        return window.TEMPO_STRETCH_VERIFY;
    }

    function setTempoStretchSkipApply(on) {
        ensureTempoStretchVerify().skipApply = !!on;
        if (skipApplyCheckbox) skipApplyCheckbox.checked = !!on;
        if (typeof writeLog === 'function') {
            writeLog(
                '[TempoStretch/Verify] skipApply ' + (on ? 'ON' : 'OFF'),
            );
        }
    }

    function debugLogKeysInPanelOrder() {
        const flags = window.DEBUG_LOG;
        if (!flags || typeof flags !== 'object') return [];
        const keys = DEBUG_LOG_ORDER.filter((k) =>
            Object.prototype.hasOwnProperty.call(flags, k),
        );
        for (const k of Object.keys(flags)) {
            if (!keys.includes(k)) keys.push(k);
        }
        return keys;
    }

    function metaForDebugLogKey(key) {
        const m = DEBUG_LOG_META[key];
        if (m) return m;
        return {
            label: key.replace(/_/g, ' '),
            tag: key,
            desc: 'constants.js の DEBUG_LOG.' + key,
        };
    }

    function applyDebugLogSideEffects() {
        if (typeof window.applyDebugLogToggleSideEffects === 'function') {
            window.applyDebugLogToggleSideEffects();
        }
        if (typeof window.scheduleWaveformRegionOverlayRefresh === 'function') {
            window.scheduleWaveformRegionOverlayRefresh();
        }
    }

    function setDebugLogFlag(key, on) {
        if (!window.DEBUG_LOG || !Object.prototype.hasOwnProperty.call(window.DEBUG_LOG, key)) {
            return;
        }
        window.DEBUG_LOG[key] = !!on;
        applyDebugLogSideEffects();
    }

    function setRegionHandleHitDebug(on) {
        const v = !!on;
        window.REGION_HANDLE_HIT_DEBUG = v;
        window.FADE_TRIANGLE_HIT_DEBUG = v;
        applyDebugLogSideEffects();
    }

    function setAllOff() {
        if (window.DEBUG_LOG && typeof window.DEBUG_LOG === 'object') {
            for (const key of Object.keys(window.DEBUG_LOG)) {
                window.DEBUG_LOG[key] = false;
            }
        }
        window.REGION_HANDLE_HIT_DEBUG = false;
        window.FADE_TRIANGLE_HIT_DEBUG = false;
        setTempoStretchSkipApply(false);
        syncCheckboxesFromState();
        applyDebugLogSideEffects();
    }

    function buildActionButton(label, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dev-constants-panel__action-btn';
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        return btn;
    }

    function buildVerifySection() {
        const block = buildSection(
            '検証（タイムストレッチ / 再生）',
            '無音・尺異常の切り分け用。ログは [TempoStretch/Verify] または [TempoStretch/A]（診断 ON 時）でフィルタ。',
            'dev-constants-panel__list--actions',
        );

        const skipRow = document.createElement('label');
        skipRow.className = 'dev-constants-panel__row dev-constants-panel__row--verify';

        skipApplyCheckbox = document.createElement('input');
        skipApplyCheckbox.type = 'checkbox';
        skipApplyCheckbox.className = 'dev-constants-panel__checkbox';
        skipApplyCheckbox.addEventListener('change', () => {
            setTempoStretchSkipApply(skipApplyCheckbox.checked);
        });

        const skipText = document.createElement('span');
        skipText.className = 'dev-constants-panel__row-text';
        skipText.innerHTML =
            '<span class="dev-constants-panel__row-head">' +
            '<span class="dev-constants-panel__row-label">ストレッチ適用をスキップ</span>' +
            '<span class="dev-constants-panel__row-tag">A/B</span></span>' +
            '<span class="dev-constants-panel__row-desc">読込・Tempo/Sig Enter 時のストレッチを抑止。72-4/4 で無音か切り分ける。</span>';

        skipRow.appendChild(skipApplyCheckbox);
        skipRow.appendChild(skipText);
        block.list.appendChild(skipRow);

        const btnRow = document.createElement('div');
        btnRow.className = 'dev-constants-panel__action-row';
        btnRow.appendChild(
            buildActionButton('状態をログに出力', () => {
                if (typeof window.dumpTempoStretchVerifyState === 'function') {
                    window.dumpTempoStretchVerifyState();
                } else if (typeof writeLog === 'function') {
                    writeLog('[TempoStretch/Verify] dump API unavailable');
                }
            }),
        );
        btnRow.appendChild(
            buildActionButton('バックアップから復元', () => {
                if (typeof window.restoreAllExtraTracksFromBackup === 'function') {
                    void window.restoreAllExtraTracksFromBackup();
                } else if (typeof writeLog === 'function') {
                    writeLog('[TempoStretch/Verify] restore API unavailable');
                }
            }),
        );
        block.list.appendChild(btnRow);

        const note = document.createElement('p');
        note.className = 'dev-constants-panel__verify-note';
        note.textContent =
            '併用推奨: テンポストレッチ + キー/ピッチ再生ログ。セッション復元は [RegionRestore]。';
        block.section.appendChild(note);

        return block.section;
    }

    function syncCheckboxesFromState() {
        checkboxByKey.forEach((input, key) => {
            if (key === 'REGION_HANDLE_HIT_DEBUG') {
                input.checked =
                    typeof window.isRegionHandleHitDebugEnabled === 'function'
                        ? window.isRegionHandleHitDebugEnabled()
                        : !!window.REGION_HANDLE_HIT_DEBUG;
                return;
            }
            input.checked = !!(
                window.DEBUG_LOG &&
                Object.prototype.hasOwnProperty.call(window.DEBUG_LOG, key) &&
                window.DEBUG_LOG[key]
            );
        });
        if (skipApplyCheckbox) {
            skipApplyCheckbox.checked = !!ensureTempoStretchVerify().skipApply;
        }
    }

    function buildSection(title, note, listClass) {
        const section = document.createElement('section');
        section.className = 'dev-constants-panel__section';

        const head = document.createElement('div');
        head.className = 'dev-constants-panel__section-head';

        const heading = document.createElement('h3');
        heading.className = 'dev-constants-panel__section-title';
        heading.textContent = title;

        head.appendChild(heading);
        if (note) {
            const noteEl = document.createElement('p');
            noteEl.className = 'dev-constants-panel__section-note';
            noteEl.textContent = note;
            head.appendChild(noteEl);
        }
        section.appendChild(head);

        const list = document.createElement('div');
        list.className = 'dev-constants-panel__list' + (listClass ? ' ' + listClass : '');
        section.appendChild(list);
        return { section, list };
    }

    function buildToggleRow(key, meta, kind) {
        const row = document.createElement('label');
        row.className = 'dev-constants-panel__row';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'dev-constants-panel__checkbox';
        input.dataset.toggleKey = key;
        input.dataset.toggleKind = kind;
        input.addEventListener('change', () => {
            if (kind === 'regionHitDebug') {
                setRegionHandleHitDebug(input.checked);
            } else {
                setDebugLogFlag(key, input.checked);
            }
        });

        const text = document.createElement('span');
        text.className = 'dev-constants-panel__row-text';

        const head = document.createElement('span');
        head.className = 'dev-constants-panel__row-head';

        const label = document.createElement('span');
        label.className = 'dev-constants-panel__row-label';
        label.textContent = meta.label;

        const tag = document.createElement('span');
        tag.className = 'dev-constants-panel__row-tag';
        tag.textContent = meta.tag;

        head.appendChild(label);
        head.appendChild(tag);

        const desc = document.createElement('span');
        desc.className = 'dev-constants-panel__row-desc';
        desc.textContent = meta.desc || '';

        text.appendChild(head);
        if (meta.desc) text.appendChild(desc);
        row.appendChild(input);
        row.appendChild(text);
        checkboxByKey.set(key, input);
        return row;
    }

    function buildPanelBody() {
        bodyEl.replaceChildren();
        checkboxByKey = new Map();

        const logBlock = buildSection(
            '診断ログ（DEBUG_LOG）',
            '調査用の冗長ログのみ。通常ログ（読み込み・エクスポート・Warning/Error）は常に出力。',
            'dev-constants-panel__list--grid',
        );
        const keys = debugLogKeysInPanelOrder();
        for (let i = 0; i < keys.length; i++) {
            logBlock.list.appendChild(
                buildToggleRow(keys[i], metaForDebugLogKey(keys[i]), 'debugLog'),
            );
        }
        bodyEl.appendChild(logBlock.section);

        const drawBlock = buildSection(
            'デバッグ描画',
            'ログではなく波形 overlay 上への色付き表示。',
            null,
        );
        drawBlock.list.appendChild(
            buildToggleRow('REGION_HANDLE_HIT_DEBUG', REGION_HIT_DEBUG_META, 'regionHitDebug'),
        );
        bodyEl.appendChild(drawBlock.section);

        bodyEl.appendChild(buildVerifySection());
    }

    function ensureOverlay() {
        if (overlayEl) return;

        overlayEl = document.createElement('div');
        overlayEl.id = 'devConstantsOverlay';
        overlayEl.className = 'dev-constants-overlay';
        overlayEl.hidden = true;
        overlayEl.setAttribute('aria-hidden', 'true');

        panelEl = document.createElement('div');
        panelEl.className = 'dev-constants-panel';
        panelEl.setAttribute('role', 'dialog');
        panelEl.setAttribute('aria-modal', 'true');
        panelEl.setAttribute('aria-labelledby', 'devConstantsPanelTitle');
        panelEl.tabIndex = -1;

        const header = document.createElement('header');
        header.className = 'dev-constants-panel__header';

        const headerText = document.createElement('div');
        headerText.className = 'dev-constants-panel__header-text';

        const title = document.createElement('h2');
        title.id = 'devConstantsPanelTitle';
        title.className = 'dev-constants-panel__title';
        title.textContent = '開発者向け定数（constants.js）';

        const hint = document.createElement('p');
        hint.className = 'dev-constants-panel__hint';
        hint.textContent =
            '実行中のみ有効。再読み込みで初期値に戻ります。いずれか ON の間はログ行数が無制限（OFF で 500 行上限）。';

        headerText.appendChild(title);
        headerText.appendChild(hint);

        const allOffBtn = document.createElement('button');
        allOffBtn.type = 'button';
        allOffBtn.className = 'dev-constants-panel__all-off-btn';
        allOffBtn.textContent = '全オフ';
        allOffBtn.addEventListener('click', () => setAllOff());

        header.appendChild(headerText);
        header.appendChild(allOffBtn);

        bodyEl = document.createElement('div');
        bodyEl.className = 'dev-constants-panel__body';
        buildPanelBody();

        const footer = document.createElement('p');
        footer.className = 'dev-constants-panel__footer';
        footer.innerHTML = '<kbd>F10</kbd> 開閉 · <kbd>Esc</kbd> / 枠外クリックで閉じる';

        panelEl.appendChild(header);
        panelEl.appendChild(bodyEl);
        panelEl.appendChild(footer);
        overlayEl.appendChild(panelEl);

        overlayEl.addEventListener('mousedown', (e) => {
            if (e.target === overlayEl) closeDevConstantsPanel();
        });

        document.body.appendChild(overlayEl);
    }

    function openDevConstantsPanel() {
        ensureOverlay();
        syncCheckboxesFromState();
        open = true;
        overlayEl.hidden = false;
        overlayEl.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => {
            if (panelEl) panelEl.focus();
        });
    }

    function closeDevConstantsPanel() {
        if (!open) return;
        open = false;
        if (overlayEl) {
            overlayEl.hidden = true;
            overlayEl.setAttribute('aria-hidden', 'true');
        }
        if (typeof scheduleWaveformFocusRestore === 'function') {
            scheduleWaveformFocusRestore();
        }
    }

    function toggleDevConstantsPanel() {
        if (open) closeDevConstantsPanel();
        else openDevConstantsPanel();
    }

    function handleDevConstantsPanelKeydown(e) {
        if (!e || e.type !== 'keydown') return false;
        if (open && e.code === 'Escape') {
            e.preventDefault();
            closeDevConstantsPanel();
            return true;
        }
        if (typeof matchUserShortcut === 'function' && matchUserShortcut(e, 'devConstantsPanelToggle')) {
            e.preventDefault();
            toggleDevConstantsPanel();
            return true;
        }
        return false;
    }

    window.handleDevConstantsPanelKeydown = handleDevConstantsPanelKeydown;
    window.toggleDevConstantsPanel = toggleDevConstantsPanel;
    window.closeDevConstantsPanel = closeDevConstantsPanel;
})();
