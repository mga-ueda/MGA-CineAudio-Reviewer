(() => {
    /**
     * ============================================================
     * ショートカット設定ファイル（ここだけ編集すれば OK）
     * ============================================================
     *
     * ■ まずはここだけ編集してください:
     *   1) USER_SHORTCUTS のみを変更
     *   2) INTERNAL_SHORTCUTS / 関数は基本そのまま
     *
     * ■ 変更のコツ:
     *   - 単体キー: { code: 'KeyO' } / { code: 'Space' } / { key: '[' }
     *   - 複数候補: { codes: ['Delete', 'Backspace'] }
     *   - Ctrl/Cmd 両対応: { primary: true, code: 'KeyZ' }
     *   - Shift 必須: { shift: true, ... }
     *   - Shift 禁止: { shift: false, ... }
     *
     * ■ code と key の違い:
     *   - code: キーボード上の物理位置（配列差を受けにくい）
     *   - key : 入力文字そのもの（例 '[' や ']'）
     *
     * ■ 迷ったら:
     *   - 既存行を1つコピーして code だけ書き換えるのが安全です。
     */

    const USER_SHORTCUTS = {
        // ---------- 再生・移動 ----------
        transportOptionsToggle: { code: 'KeyO' }, // オプション表示切替
        transportToggle: { code: 'Space' }, // 再生/停止
        prerollPlay: { code: 'Space', primary: true, alt: false, shift: false }, // Ctrl/Cmd + Space
        replayFromPlaybackStart: { codes: ['Enter', 'NumpadEnter'], alt: true, ctrl: false, meta: false, shift: false }, // Alt + Enter
        transportSeekArrowLeft: { code: 'ArrowLeft' },
        transportSeekArrowRight: { code: 'ArrowRight' },
        loopToggle: { code: 'KeyL' },

        // ---------- 表示 ----------
        musicalGridToggle: { code: 'KeyT' },
        musicalGridPhraseToggle: { code: 'KeyP' },
        playheadCenterLockToggle: {
            code: 'KeyC',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
        },
        videoMarkersPanelsToggle: {
            code: 'KeyF',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
        },
        analyzeToggle: { code: 'KeyA', primary: false, ctrl: false, meta: false, alt: false },

        // ---------- セッション I/O ----------
        sessionAllClear: { code: 'Delete', primary: true, shift: true, alt: true },
        sessionImport: { code: 'KeyI', primary: true, shift: true, alt: true },
        sessionExport: { code: 'KeyE', primary: true, shift: true, alt: true },

        // ---------- マーカー ----------
        markerInsert: { code: 'Insert' }, // 押すとポイント、長押しでレンジ開始
        markerHideToggle: {
            code: 'KeyV',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
        }, // マーカーの Hide/View（修飾キーなし V のみ）
        markerRangeStart: { key: '[' },
        markerRangeEnd: { key: ']' },
        markerNavigateUp: { code: 'ArrowUp' },
        markerNavigateDown: { code: 'ArrowDown' },
        submitEditing: { key: 'Enter' },
        cancelEditing: { key: 'Escape' },

        // ---------- リージョン編集 ----------
        regionSplit: { code: 'KeyX' },
        regionJoin: { code: 'KeyB' },
        regionUndo: { code: 'KeyZ', primary: true, shift: false, alt: false },
        regionRedo: { code: 'KeyZ', primary: true, shift: true, alt: false },
        regionDelete: { codes: ['Delete', 'Backspace'] },
        regionCopy: { code: 'KeyC', primary: true, shift: false, alt: false },
        regionPaste: { code: 'KeyV', primary: true, shift: false, alt: false },
        regionEscape: { code: 'Escape', ctrl: false, alt: false, meta: false },

        // ---------- ミックス ----------
        mixLaneSoloToggle: { code: 'KeyS', ctrl: false, alt: false, meta: false, shift: false },
        mixLaneSoloExclusive: { code: 'KeyS', ctrl: false, alt: true, meta: false, shift: false },
        mixLaneMuteToggle: { code: 'KeyM', ctrl: false, alt: false, meta: false, shift: false },
        mixLaneMuteClearAll: { code: 'KeyM', ctrl: false, alt: true, meta: false, shift: false },
        mixLaneVolumeUp: { code: 'PageUp', ctrl: false, alt: false, meta: false, shift: false },
        mixLaneVolumeDown: { code: 'PageDown', ctrl: false, alt: false, meta: false, shift: false },
        masterVolumeResetUnity: { code: 'KeyV', primary: true, shift: true, alt: false },
        addExtraTrack: { code: 'KeyN', primary: true, shift: false, alt: false },
        releaseExtraTrackUnityHold: { codes: ['PageUp', 'PageDown'], ctrl: false, alt: false, meta: false },

        // ---------- 波形タイムライン ----------
        waveformTimelineZoomIn: { codes: ['Equal', 'NumpadAdd'] },
        waveformTimelineZoomOut: { codes: ['Minus', 'NumpadSubtract'] },
        waveformTimelineFit: {
            code: 'KeyZ',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
        },
        waveformTimelineScrollBack: { code: 'PageUp' },
        waveformTimelineScrollForward: { code: 'PageDown' },
        waveformLaneSeekHome: { code: 'Home' },
        waveformLaneSeekEnd: { code: 'End' },
        waveformLaneSeekPrev: { code: 'ArrowLeft' },
        waveformLaneSeekNext: { code: 'ArrowRight' },

        // ---------- マーカー時刻入力 ----------
        markerPanelTcNudgePlus: { codes: ['NumpadAdd'], keys: ['+'] },
        markerPanelTcNudgeMinus: { codes: ['NumpadSubtract', 'Minus'], keys: ['-'] },
        // 補足: US 配列では Shift+Equal が '+'。この組み合わせのみ別扱い。
        markerPanelTcNudgePlusShiftUsLayout: { code: 'Equal' },
        markerPanelTcDeleteOut: { codes: ['Delete', 'Backspace'], ctrl: false, alt: false, meta: false, shift: false },

        // ---------- 修飾キー ----------
        altSnapModifier: { key: 'Alt' },

        // ---------- Musical Grid 入力欄 ----------
        musicalGridInputArrowUp: { key: 'ArrowUp' },
        musicalGridInputArrowDown: { key: 'ArrowDown' },
    };

    // 内部で使う確定値。通常は編集不要。
    const INTERNAL_SHORTCUTS = {};
    const SHORTCUTS = Object.freeze({ ...USER_SHORTCUTS, ...INTERNAL_SHORTCUTS });

    // 補助マップ: Numpad 0-9 は「全体を10分割した位置」へジャンプ。
    const NUMPAD_SEEK_DIGITS = Object.freeze({
        Numpad0: 0,
        Numpad1: 1,
        Numpad2: 2,
        Numpad3: 3,
        Numpad4: 4,
        Numpad5: 5,
        Numpad6: 6,
        Numpad7: 7,
        Numpad8: 8,
        Numpad9: 9,
    });

    const SHORTCUT_GROUPS = {
        // ここは「スクラブ中に押されたらスクラブを終了するキー群」。
        // 挙動安定のため、編集系(X/B/Z)・日本語配列向けキーも含めています。
        scrubStopCodes: [
            'Space',
            'ArrowLeft',
            'ArrowRight',
            'KeyL',
            'KeyA',
            'KeyM',
            'KeyS',
            'KeyV',
            'KeyX',
            'KeyB',
            'KeyF',
            'KeyZ',
            'Insert',
            'IntlYen',
            'Backslash',
            'Equal',
            'Minus',
            'NumpadAdd',
            'NumpadSubtract',
            'PageUp',
            'PageDown',
        ],
    };

    function valueOr(def, key, fallback) {
        return Object.prototype.hasOwnProperty.call(def, key) ? def[key] : fallback;
    }

    function matchesShortcut(event, def, opt) {
        if (!event || !def) return false;
        if (!valueOr(opt || {}, 'allowRepeat', false) && event.repeat) return false;

        if (def.code && event.code !== def.code) return false;
        if (def.key && event.key !== def.key) return false;
        if (def.codes && !def.codes.includes(event.code)) return false;
        if (def.keys && !def.keys.includes(event.key)) return false;

        if (Object.prototype.hasOwnProperty.call(def, 'primary')) {
            const hasPrimary = !!(event.ctrlKey || event.metaKey);
            if (hasPrimary !== !!def.primary) return false;
        }
        if (Object.prototype.hasOwnProperty.call(def, 'ctrl') && event.ctrlKey !== !!def.ctrl) {
            return false;
        }
        if (Object.prototype.hasOwnProperty.call(def, 'meta') && event.metaKey !== !!def.meta) {
            return false;
        }
        if (Object.prototype.hasOwnProperty.call(def, 'alt') && event.altKey !== !!def.alt) {
            return false;
        }
        if (Object.prototype.hasOwnProperty.call(def, 'shift') && event.shiftKey !== !!def.shift) {
            return false;
        }
        return true;
    }

    function getNumpadSeekDigit(code) {
        return Object.prototype.hasOwnProperty.call(NUMPAD_SEEK_DIGITS, code)
            ? NUMPAD_SEEK_DIGITS[code]
            : null;
    }

    function isShortcutCodeInGroup(code, groupName) {
        if (!code || !groupName) return false;
        const group = SHORTCUT_GROUPS[groupName];
        if (!group) return false;
        if (group.codes && group.codes.includes(code)) return true;
        if (groupName === 'scrubStopCodes' && /^Numpad[0-9]$/.test(code)) return true;
        return false;
    }

    const CODE_LABELS = Object.freeze({
        Space: 'Space',
        Insert: 'Ins',
        Delete: 'Del',
        Backspace: 'Backspace',
        ArrowLeft: '←',
        ArrowRight: '→',
        ArrowUp: '↑',
        ArrowDown: '↓',
        PageUp: 'PgUp',
        PageDown: 'PgDn',
        Home: 'Home',
        End: 'End',
        Equal: '+',
        Minus: '−',
        NumpadAdd: '+',
        NumpadSubtract: '−',
        Escape: 'Esc',
        Enter: 'Enter',
    });

    function shortcutKeyLabel(def) {
        if (!def) return '';
        if (def.key) {
            const k = def.key;
            if (k === ' ') return 'Space';
            if (k.length === 1) return k;
            return k;
        }
        if (def.code) return CODE_LABELS[def.code] || def.code.replace(/^Key/, '');
        if (def.codes && def.codes.length) {
            const labels = def.codes.map((c) => CODE_LABELS[c] || c.replace(/^Key/, ''));
            return [...new Set(labels)].join('/');
        }
        if (def.keys && def.keys.length) {
            const labels = def.keys.map((k) => (k.length === 1 ? k : k));
            return [...new Set(labels)].join('/');
        }
        return '';
    }

    /** ツールチップ用の修飾キー+キー表記（Mac では Ctrl を Cmd と読み替え）。 */
    function formatShortcutDef(def) {
        if (!def) return '';
        const mods = [];
        if (def.primary) mods.push('Ctrl');
        if (def.ctrl) mods.push('Ctrl');
        if (def.meta) mods.push('Cmd');
        if (def.alt) mods.push('Alt');
        if (def.shift) mods.push('Shift');
        const key = shortcutKeyLabel(def);
        if (key) mods.push(key);
        return mods.join('+');
    }

    function chordWithArrows(prefixMods, upCode, downCode) {
        const up = CODE_LABELS[upCode] || upCode;
        const down = CODE_LABELS[downCode] || downCode;
        const mods = prefixMods.length ? prefixMods.join('+') + '+' : '';
        return mods + up + '/' + down;
    }

    function buildShortcutHints() {
        const s = USER_SHORTCUTS;
        return Object.freeze({
            playStop: formatShortcutDef(s.transportToggle),
            preroll: formatShortcutDef(s.prerollPlay),
            replayFromStart: formatShortcutDef(s.replayFromPlaybackStart),
            loop: formatShortcutDef(s.loopToggle),
            solo: formatShortcutDef(s.mixLaneSoloToggle),
            soloExclusive: formatShortcutDef(s.mixLaneSoloExclusive),
            mute: formatShortcutDef(s.mixLaneMuteToggle),
            muteClearAll: formatShortcutDef(s.mixLaneMuteClearAll),
            laneVolume: chordWithArrows([], 'PageUp', 'PageDown'),
            addExtraTrack: formatShortcutDef(s.addExtraTrack),
            markerHide: formatShortcutDef(s.markerHideToggle),
            analyze: formatShortcutDef(s.analyzeToggle),
            centerLock: formatShortcutDef(s.playheadCenterLockToggle),
            musicalGrid: formatShortcutDef(s.musicalGridToggle),
            musicalPhrase: formatShortcutDef(s.musicalGridPhraseToggle),
            sessionImport: formatShortcutDef(s.sessionImport),
            sessionExport: formatShortcutDef(s.sessionExport),
            sessionAllClear: formatShortcutDef(s.sessionAllClear),
            masterVolReset: formatShortcutDef(s.masterVolumeResetUnity),
            markerDelete: formatShortcutDef(s.regionDelete),
            feedbackRowNav: chordWithArrows(['Alt'], 'ArrowUp', 'ArrowDown'),
            markerRowNav: chordWithArrows(['Shift'], 'ArrowUp', 'ArrowDown'),
            cancelEdit: formatShortcutDef(s.cancelEditing),
            submitEdit: formatShortcutDef(s.submitEditing),
            zoomIn: shortcutKeyLabel(s.waveformTimelineZoomIn),
            zoomOut: shortcutKeyLabel(s.waveformTimelineZoomOut),
            zoomFit: formatShortcutDef(s.waveformTimelineFit),
            tcNudgeFrame: chordWithArrows([], 'NumpadAdd', 'NumpadSubtract'),
            tcNudgeSec: chordWithArrows(['Shift'], 'NumpadAdd', 'NumpadSubtract'),
            tcClearOut: formatShortcutDef(s.markerPanelTcDeleteOut),
        });
    }

    const SHORTCUT_HINTS = buildShortcutHints();

    function setElementTitle(el, text) {
        if (el && text) el.title = text;
    }

    function applyShortcutTooltips() {
        const h = SHORTCUT_HINTS;
        const playTitle = `再生／停止（${h.playStop}、${h.preroll} でプリロール、${h.replayFromStart} で再生開始位置から再生し直し）`;
        setElementTitle(document.getElementById('playStopBtn'), playTitle);

        const loopTitle = `再生をループ（${h.loop}）`;
        const loopChk = document.getElementById('loopPlaybackCheckbox');
        setElementTitle(loopChk, loopTitle);
        if (loopChk) {
            const loopLbl = loopChk.closest('label');
            setElementTitle(loopLbl, loopTitle);
        }

        setElementTitle(
            document.getElementById('markerMemoTextarea'),
            `セッション全体の追加メモを入力（${h.cancelEdit} でフォーカス解除）`,
        );

        const soloTitle = `Solo（このレーンのみ再生・${h.solo}、${h.soloExclusive} で対象のみソロ）`;
        const muteTitle = `Mute（このレーンをミュート・${h.mute}、${h.muteClearAll} で全ミュート解除）`;
        const volTitle = `音量を調整（レーン上で ${h.laneVolume} は ±1 dB）`;
        const addTrackTitle = `次の extra audio track を表示（${h.addExtraTrack}）`;

        setElementTitle(document.getElementById('videoAudioSoloBtn'), soloTitle);
        setElementTitle(document.getElementById('videoAudioMuteBtn'), muteTitle);
        setElementTitle(document.getElementById('trackLaneFaderVideo'), volTitle);
        setElementTitle(document.getElementById('videoAudioAddTrackBtn'), addTrackTitle);

        const trackCount =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        for (let slot = 0; slot < trackCount; slot++) {
            setElementTitle(document.getElementById('extraAudioSoloBtn' + slot), soloTitle);
            setElementTitle(document.getElementById('extraAudioMuteBtn' + slot), muteTitle);
            setElementTitle(document.getElementById('trackLaneFader' + slot), volTitle);
            const addBtn = document.getElementById('extraAudioAddTrackBtn' + slot);
            if (addBtn) setElementTitle(addBtn, addTrackTitle);
        }

        const lanes = document.getElementById('audioWaveformLanesTracks');
        setElementTitle(
            lanes,
            `クリック／ドラッグでシーク。ホイールまたは ${h.zoomIn}/${h.zoomOut} でズーム、${h.zoomFit} で全体表示、Ctrl+ホイールで高速ズーム（3倍）、Shift+ホイールで横スクロール、Shift+Ctrl+ホイールで高速スクロール（3倍）。`,
        );

        const gridTitle = `小節・拍グリッドの表示（${h.musicalGrid}）`;
        const gridChk = document.getElementById('musicalGridVisibleCheckbox');
        setElementTitle(gridChk, gridTitle);
        if (gridChk) {
            const gridLbl = gridChk.closest('label');
            setElementTitle(gridLbl, gridTitle);
        }

        const phraseTitle = `フレーズ着色と番号（${h.musicalPhrase}）`;
        const phraseChk = document.getElementById('musicalGridPhraseFillCheckbox');
        setElementTitle(phraseChk, phraseTitle);
        if (phraseChk) {
            const phraseLbl = phraseChk.closest('label');
            setElementTitle(phraseLbl, phraseTitle);
        }

        const centerExplain =
            'ズームや横スクロール時、波形ビュー内のシークバー（再生位置）を常に中央に固定する';
        const centerTitle = `Center lock — ${centerExplain}（${h.centerLock} で ON/OFF）`;
        setElementTitle(document.getElementById('playheadCenterLockCheckbox'), centerTitle);
        const centerWrap = document.querySelector('.playhead-center-lock-options');
        setElementTitle(centerWrap, centerTitle);
        const centerLbl = document.getElementById('playheadCenterLockLabel');
        setElementTitle(centerLbl, centerTitle);

        const analyzeTitle = `スペクトラムとレベルメーターを表示（${h.analyze} で切替）`;
        setElementTitle(document.getElementById('analyzeOnCheckbox'), analyzeTitle);
        setElementTitle(
            document.getElementById('analyzeToggleWrap'),
            `Analyze — スペクトラムとレベルメーター（${h.analyze} で切替）。OFF でも CLIP PROTECT は有効。`,
        );

        setElementTitle(
            document.getElementById('masterVolSlider'),
            `ダブルクリックまたは ${h.masterVolReset} で 100%`,
        );
        setElementTitle(
            document.getElementById('masterVolWrap'),
            `Master volume（ダブルクリックまたは ${h.masterVolReset} で 100%）。LKFS は再生開始からのインテグレーテッド値（停止後も保持、再再生で計測し直し）。`,
        );
    }

    window.SHORTCUTS = SHORTCUTS;
    window.SHORTCUT_HINTS = SHORTCUT_HINTS;
    window.formatShortcutDef = formatShortcutDef;
    window.matchesShortcut = matchesShortcut;
    window.getNumpadSeekDigit = getNumpadSeekDigit;
    window.isShortcutCodeInGroup = isShortcutCodeInGroup;
    window.applyShortcutTooltips = applyShortcutTooltips;
})();
