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
        mixLaneMuteToggle: { code: 'KeyM', ctrl: false, alt: false, meta: false, shift: false },
        mixLaneVolumeUp: { code: 'PageUp', ctrl: false, alt: false, meta: false, shift: false },
        mixLaneVolumeDown: { code: 'PageDown', ctrl: false, alt: false, meta: false, shift: false },
        masterVolumeResetUnity: { code: 'KeyV', primary: true, shift: true, alt: false },
        addExtraTrack: { code: 'KeyN', primary: true, shift: false, alt: false },
        releaseExtraTrackUnityHold: { codes: ['PageUp', 'PageDown'], ctrl: false, alt: false, meta: false },

        // ---------- 波形タイムライン ----------
        waveformTimelineZoomIn: { codes: ['Equal', 'NumpadAdd'] },
        waveformTimelineZoomOut: { codes: ['Minus', 'NumpadSubtract'] },
        waveformTimelineFit: { code: 'KeyF', shift: false, ctrl: false, alt: false, meta: false },
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

    window.SHORTCUTS = SHORTCUTS;
    window.matchesShortcut = matchesShortcut;
    window.getNumpadSeekDigit = getNumpadSeekDigit;
    window.isShortcutCodeInGroup = isShortcutCodeInGroup;
})();
