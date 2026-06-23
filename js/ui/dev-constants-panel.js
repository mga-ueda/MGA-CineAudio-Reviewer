/**
 * dev-constants-panel.js — js/core/constants.js の診断フラグを実行中に切り替えるフローティングメニュー（F10）。
 */
(function devConstantsPanelModule() {
    const DEBUG_LOG_ORDER = [
        'REGION_RESTORE',
        'REGION_SNAP',
        'MUSICAL_SLOT',
        'WAVEFORM_VIEWPORT',
        'VIDEO_ANALYZER',
        'KEY_PLAYBACK',
        'TEMPO_STRETCH',
        'SILENT_GAP_DELETE',
        'IXML',
        'MUSICAL_TRACK_PERSIST',
        'REGION_BAR_JUMP',
        'GRID_ALIGN',
        'MARKER_POINTER',
    ];

    const DEBUG_LOG_META = {
        REGION_RESTORE: {
            label: 'セッション復元',
            tag: '[RegionRestore]',
            desc: 'F5 復元・overlay 再描画・All Clear の段階追跡。リージョン欠落・二重表示・slots 空の調査。',
        },
        REGION_SNAP: {
            label: 'リージョン移動スナップ',
            tag: '[RegionSnap]',
            desc: '平行移動ドラッグ確定時のポインタ位置・スナップ後・実際の region In。境界ずれの調査に。',
        },
        MUSICAL_SLOT: {
            label: 'Musical / Rehearsal スロット',
            tag: '[MusicalSlot]',
            desc: 'SwapUnit バインディング・入れ替え・無音選択。Rehearsal 着色時の番号ずれ・binding 不整合の調査。',
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
            desc: 'Ctrl+クリック無音選択・Delete 経路。削除効かない・Rehearsal 定義崩れの調査。',
        },
        IXML: {
            label: 'iXML / WAV メタデータ',
            tag: '[iXML]',
            desc: 'WAV 読込時の iXML・AXML・BWF bext・INFO 全文をログへ。',
        },
        MUSICAL_TRACK_PERSIST: {
            label: 'Musical トラック保存/復元',
            tag: '[MusicalTrack]',
            desc:
                'Rehearsal / Tempo / Signature トラックの set・persist・snapshot・apply・pending・セッション IDB 経路をログ。テンポ定義・拍子変化・リハーサルマークの保存・復元不具合の調査用。',
        },
        REGION_BAR_JUMP: {
            label: 'Measure ジャンプ (G / 数字)',
            tag: 'BarJump',
            desc:
                'G ダイアログ Measure ジャンプの resolve/hit・miss・skipped。Measure 1 = タイムライン先頭。',
        },
        GRID_ALIGN: {
            label: 'マーカー ↔ 小節線',
            tag: 'GridAln',
            desc:
                'WAV 読込後 — 各マーカー In/Out と最寄り小節境界の秒差・フレーム差・描画 px 差。累積ドリフト調査用。',
        },
        MARKER_POINTER: {
            label: 'MARKERS / 操作帯 pointer',
            tag: 'MrkPtr',
            desc:
                '波形 capture — リージョン In/Out/Fade vs MARKERS ドラッグ vs シークの採否、resolve 成否、ドラッグ適用秒。T ON で動かない調査用。',
        },
    };

    const REGION_HIT_DEBUG_META = {
        label: '操作帯デバッグ描画',
        tag: 'overlay',
        desc:
            'リージョン（Fade/In/Out/Split/x-fade/Rehearsal）と Musical トラック（Rehearsal 枠/文字、Tempo/Sig ドラッグ・編集）の当たり判定を色分け表示（ログとは別）。',
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

    function persistDevConstantsPrefs() {
        if (typeof writePrefs === 'function') writePrefs();
    }

    function setTempoStretchSkipApply(on, options) {
        const silent = options && options.silent;
        ensureTempoStretchVerify().skipApply = !!on;
        if (skipApplyCheckbox) skipApplyCheckbox.checked = !!on;
        if (!silent && typeof writeLog === 'function') {
            writeLog(
                '[TempoStretch/Verify] skipApply ' + (on ? 'ON' : 'OFF'),
            );
        }
        persistDevConstantsPrefs();
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
        if (typeof window.applyDevConstantsRuntimeSideEffects === 'function') {
            window.applyDevConstantsRuntimeSideEffects();
        }
    }

    function setDebugLogFlag(key, on) {
        if (!window.DEBUG_LOG || !Object.prototype.hasOwnProperty.call(window.DEBUG_LOG, key)) {
            return;
        }
        window.DEBUG_LOG[key] = !!on;
        applyDebugLogSideEffects();
        persistDevConstantsPrefs();
    }

    function setRegionHandleHitDebug(on) {
        const v = !!on;
        window.REGION_HANDLE_HIT_DEBUG = v;
        window.FADE_TRIANGLE_HIT_DEBUG = v;
        applyDebugLogSideEffects();
        persistDevConstantsPrefs();
    }

    function setAllOff() {
        if (window.DEBUG_LOG && typeof window.DEBUG_LOG === 'object') {
            for (const key of Object.keys(window.DEBUG_LOG)) {
                window.DEBUG_LOG[key] = false;
            }
        }
        window.REGION_HANDLE_HIT_DEBUG = false;
        window.FADE_TRIANGLE_HIT_DEBUG = false;
        setTempoStretchSkipApply(false, { silent: true });
        syncCheckboxesFromState();
        applyDebugLogSideEffects();
        persistDevConstantsPrefs();
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
            '調査用のみ（通常ログは常に表示）。ON 中はログ欄非表示・内部蓄積・行数無制限（コピー/DL で全文）。',
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
            'ログではなく波形 overlay 上への色付き当たり判定表示（リージョン + Musical トラック）。',
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
            '設定は localStorage に保存（Import/Export 対象外）。';

        headerText.appendChild(title);
        headerText.appendChild(hint);

        const headerActions = document.createElement('div');
        headerActions.className = 'dev-constants-panel__header-actions';

        const allOffBtn = document.createElement('button');
        allOffBtn.type = 'button';
        allOffBtn.className = 'dev-constants-panel__all-off-btn';
        allOffBtn.textContent = '全オフ';
        allOffBtn.addEventListener('click', () => setAllOff());

        const logCopyBtn = document.createElement('button');
        logCopyBtn.type = 'button';
        logCopyBtn.className = 'dev-constants-panel__all-off-btn';
        logCopyBtn.textContent = 'ログコピー';
        if (typeof msg === 'function') {
            logCopyBtn.title = msg('tooltip.logCopy');
        }
        logCopyBtn.addEventListener('click', async () => {
            if (typeof window.copyLogToClipboard !== 'function') {
                if (typeof writeLog === 'function') {
                    writeLog('Log copy unavailable');
                }
                return;
            }
            const ok = await window.copyLogToClipboard();
            if (ok) {
                if (typeof writeMetaLog === 'function') {
                    writeMetaLog('Log', msg('log.clipboard.copied'));
                } else if (typeof writeLog === 'function') {
                    writeLog(msg('log.clipboard.copied'));
                }
            } else if (typeof writeMetaLog === 'function') {
                writeMetaLog('Log', msg('log.clipboard.copyFailed'));
            } else if (typeof writeLog === 'function') {
                writeLog(msg('log.clipboard.copyFailed'));
            }
        });

        const logDownloadBtn = document.createElement('button');
        logDownloadBtn.type = 'button';
        logDownloadBtn.className = 'dev-constants-panel__all-off-btn';
        logDownloadBtn.textContent = 'ログダウンロード';
        if (typeof msg === 'function') {
            logDownloadBtn.title = msg('tooltip.logDownload');
        }
        logDownloadBtn.addEventListener('click', () => {
            if (typeof window.triggerLogDownload === 'function') {
                window.triggerLogDownload();
                return;
            }
            if (typeof writeLog === 'function') {
                writeLog('Log download unavailable');
            }
        });

        const logClearBtn = document.createElement('button');
        logClearBtn.type = 'button';
        logClearBtn.className = 'dev-constants-panel__all-off-btn';
        logClearBtn.textContent = 'ログクリア';
        if (typeof msg === 'function') {
            logClearBtn.title = msg('tooltip.logClear');
        }
        logClearBtn.addEventListener('click', () => {
            if (typeof clearLog === 'function') clearLog();
        });

        headerActions.appendChild(allOffBtn);
        headerActions.appendChild(logCopyBtn);
        headerActions.appendChild(logDownloadBtn);
        headerActions.appendChild(logClearBtn);

        header.appendChild(headerText);
        header.appendChild(headerActions);

        bodyEl = document.createElement('div');
        bodyEl.className = 'dev-constants-panel__body';
        buildPanelBody();

        const footer = document.createElement('p');
        footer.className = 'dev-constants-panel__footer';
        footer.innerHTML =
            '<kbd>F10</kbd> 開閉 · <kbd>Esc</kbd> / 枠外クリックで閉じる · ' +
            'いずれか ON 時 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> ログ DL';

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

    function isAnyDevConstantsPanelCheckboxEnabled() {
        if (
            typeof window.isAnyDebugLogCategoryEnabled === 'function' &&
            window.isAnyDebugLogCategoryEnabled()
        ) {
            return true;
        }
        if (
            typeof window.isRegionHandleHitDebugEnabled === 'function' &&
            window.isRegionHandleHitDebugEnabled()
        ) {
            return true;
        }
        const verify = window.TEMPO_STRETCH_VERIFY;
        return !!(verify && verify.skipApply);
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
        if (
            typeof matchUserShortcut === 'function' &&
            matchUserShortcut(e, 'logDownload') &&
            isAnyDevConstantsPanelCheckboxEnabled()
        ) {
            e.preventDefault();
            if (typeof window.triggerLogDownload === 'function') {
                window.triggerLogDownload();
            }
            return true;
        }
        return false;
    }

    window.isAnyDevConstantsPanelCheckboxEnabled = isAnyDevConstantsPanelCheckboxEnabled;
    window.handleDevConstantsPanelKeydown = handleDevConstantsPanelKeydown;
    window.toggleDevConstantsPanel = toggleDevConstantsPanel;
    window.closeDevConstantsPanel = closeDevConstantsPanel;
})();
