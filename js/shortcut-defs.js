/**
 * shortcut-defs.js — キーボードショートカット定義（USER_SHORTCUTS）と matchUserShortcut。
 */
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
        layoutModeToggle: {
            code: 'KeyU',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
        }, // レイアウト: 標準 ↔ ユーザーレイアウト
        layoutEditToggle: {
            code: 'KeyU',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: true,
        }, // ユーザーレイアウト編集 ↔ 表示
        transportToggle: { code: 'Space' }, // 再生/停止
        prerollPlay: { code: 'Space', primary: true, alt: false, shift: false }, // Ctrl/Cmd + Space
        replayFromPlaybackStart: { codes: ['Enter', 'NumpadEnter'], alt: true, ctrl: false, meta: false, shift: false }, // Alt + Enter
        transportSeekArrowLeft: { code: 'ArrowLeft' },
        transportSeekArrowRight: { code: 'ArrowRight' },
        transportSeekPageUp: {
            code: 'PageUp',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
        },
        transportSeekPageDown: {
            code: 'PageDown',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
        },
        transportSeekPageUp10: {
            code: 'PageUp',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: true,
        },
        transportSeekPageDown10: {
            code: 'PageDown',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: true,
        },
        transportSeekPageStart: {
            code: 'PageUp',
            primary: true,
            shift: false,
            alt: false,
        },
        transportSeekPageEnd: {
            code: 'PageDown',
            primary: true,
            shift: false,
            alt: false,
        },
        loopToggle: { code: 'KeyL', primary: false, ctrl: false, meta: false, alt: false, shift: false },

        // ---------- 表示 ----------
        musicalGridToggle: {
            code: 'KeyT',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
        },
        musicalGridPhraseToggle: {
            code: 'KeyP',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
        },
        musicalGridMeterFocus: {
            code: 'KeyT',
            primary: false,
            ctrl: false,
            meta: false,
            alt: true,
            shift: false,
        },
        musicalGridPhraseFocus: {
            code: 'KeyP',
            primary: false,
            ctrl: false,
            meta: false,
            alt: true,
            shift: false,
        },
        analyzeToggle: { code: 'KeyA', primary: false, ctrl: false, meta: false, alt: false },
        metronomeClickToggle: {
            code: 'KeyC',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
        },
        rehearsalMarkOffsetToggle: {
            code: 'KeyR',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
        },

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
        regionSplit: { code: 'KeyX', shift: false },
        regionJoin: { code: 'KeyB', shift: false },
        regionGroup: {
            code: 'KeyG',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
        },
        regionSwap: {
            code: 'KeyE',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
        },
        regionUndo: { code: 'KeyZ', primary: true, shift: false, alt: false },
        regionRedo: { code: 'KeyZ', primary: true, shift: true, alt: false },
        regionDelete: { codes: ['Delete', 'Backspace'] },
        regionCopy: { code: 'KeyC', primary: true, shift: false, alt: false },
        regionPaste: { code: 'KeyV', primary: true, shift: false, alt: false },
        regionFadeIn: { code: 'KeyI', ctrl: false, meta: false, alt: true, shift: false },
        regionFadeOut: { code: 'KeyO', ctrl: false, meta: false, alt: true, shift: false },
        regionEscape: { code: 'Escape', ctrl: false, alt: false, meta: false },

        // ---------- ミックス ----------
        mixLaneSoloToggle: { code: 'KeyS', ctrl: false, alt: false, meta: false, shift: false },
        mixLaneMuteToggle: { code: 'KeyM', ctrl: false, alt: false, meta: false, shift: false },
        mixLaneMuteClearAll: { code: 'KeyM', ctrl: false, alt: true, meta: false, shift: false },
        mixLaneVolumeUp: {
            codes: ['NumpadAdd'],
            keys: ['+'],
            ctrl: false,
            alt: false,
            meta: false,
            shift: false,
        },
        mixLaneVolumeUpUsLayout: {
            code: 'Equal',
            shift: true,
            ctrl: false,
            alt: false,
            meta: false,
        },
        mixLaneVolumeDown: {
            codes: ['NumpadSubtract', 'Minus'],
            keys: ['-'],
            ctrl: false,
            alt: false,
            meta: false,
            shift: false,
        },
        masterVolumeResetUnity: { code: 'KeyV', primary: true, shift: true, alt: false },
        addExtraTrack: { code: 'KeyN', primary: true, shift: false, alt: false },

        // ---------- 波形タイムライン ----------
        waveformTimelineZoomIn: {
            code: 'ArrowUp',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
        },
        waveformTimelineZoomOut: {
            code: 'ArrowDown',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
        },
        waveformTimelineZoomMax: {
            code: 'ArrowUp',
            primary: true,
            alt: false,
            shift: false,
        },
        waveformTimelineZoomFit: {
            code: 'ArrowDown',
            primary: true,
            alt: false,
            shift: false,
        },
        waveformVerticalZoomIn: {
            code: 'ArrowUp',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: true,
        },
        waveformVerticalZoomOut: {
            code: 'ArrowDown',
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: true,
        },
        waveformLaneHeightExpand: {
            code: 'ArrowDown',
            primary: true,
            alt: false,
            shift: true,
        },
        waveformLaneHeightShrink: {
            code: 'ArrowUp',
            primary: true,
            alt: false,
            shift: true,
        },
        markerStopJumpPrev: {
            code: 'ArrowLeft',
            primary: true,
            alt: false,
            shift: false,
        },
        markerStopJumpNext: {
            code: 'ArrowRight',
            primary: true,
            alt: false,
            shift: false,
        },
        waveformLaneSeekHome: { code: 'Home' },
        waveformLaneSeekEnd: { code: 'End' },
        waveformLaneSeekPrev: { code: 'ArrowLeft' },
        waveformLaneSeekNext: { code: 'ArrowRight' },
        waveformTimelineCenterSeekbar: {
            codes: ['Period', 'NumpadDecimal', 'Comma'],
            keys: ['.', ','],
            primary: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
        },

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

    // 補助マップ: 0-9（テンキー／数字キー）は「全体を10分割した位置」へジャンプ。
    const NUMPAD_SEEK_DIGITS = Object.freeze({
        Digit0: 0,
        Digit1: 1,
        Digit2: 2,
        Digit3: 3,
        Digit4: 4,
        Digit5: 5,
        Digit6: 6,
        Digit7: 7,
        Digit8: 8,
        Digit9: 9,
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
            'PageUp',
            'PageDown',
            'KeyL',
            'KeyA',
            'KeyQ',
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
        ],
    };

    function valueOr(def, key, fallback) {
        return Object.prototype.hasOwnProperty.call(def, key) ? def[key] : fallback;
    }

    function readAltModifierFromEvent(event) {
        if (!event) return false;
        if (event.altKey) return true;
        if (typeof event.getModifierState === 'function') {
            return event.getModifierState('Alt');
        }
        return false;
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
        if (Object.prototype.hasOwnProperty.call(def, 'alt')) {
            const hasAlt = readAltModifierFromEvent(event);
            if (hasAlt !== !!def.alt) return false;
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

    /** OS の Shift 状態（テンキー等で event.shiftKey が false になる環境向け） */
    let keyboardShiftHeld = false;
    let shiftPhysicalDownCount = 0;

    function isNumpadDigitKeyCode(code) {
        return /^Numpad[0-9]$/.test(code || '');
    }

    function isTopRowDigitKeyCode(code) {
        return /^Digit[0-9]$/.test(code || '');
    }

    function readShiftModifierFromEvent(event) {
        if (!event) return false;
        if (event.shiftKey) return true;
        if (typeof event.getModifierState === 'function') {
            return event.getModifierState('Shift');
        }
        return false;
    }

    function syncShiftModifierFromEvent(event) {
        if (!event) return keyboardShiftHeld;
        const isShiftKey = event.code === 'ShiftLeft' || event.code === 'ShiftRight';
        if (isShiftKey) {
            if (event.type === 'keydown') {
                if (!event.repeat) shiftPhysicalDownCount += 1;
                keyboardShiftHeld = true;
            } else if (event.type === 'keyup') {
                shiftPhysicalDownCount = Math.max(0, shiftPhysicalDownCount - 1);
                keyboardShiftHeld = shiftPhysicalDownCount > 0;
            }
            return keyboardShiftHeld;
        }
        if (event.type === 'keydown' && readShiftModifierFromEvent(event)) {
            keyboardShiftHeld = true;
        }
        return keyboardShiftHeld;
    }

    function isShiftModifierActive(event) {
        if (shiftPhysicalDownCount > 0) return true;
        if (!event) return keyboardShiftHeld;
        syncShiftModifierFromEvent(event);
        if (event.shiftKey) return true;
        return keyboardShiftHeld;
    }

    /** 小節ジャンプ用 Shift 判定（テンキーは shiftKey が付かないことがある） */
    function isBarJumpShiftHeld(event) {
        if (shiftPhysicalDownCount > 0) return true;
        if (keyboardShiftHeld) return true;
        if (!event) return false;
        if (event.shiftKey) return true;
        if (typeof event.getModifierState === 'function' && event.getModifierState('Shift')) {
            return true;
        }
        return isShiftModifierActive(event);
    }

    function resetShiftModifierTracking() {
        keyboardShiftHeld = false;
        shiftPhysicalDownCount = 0;
    }

    function initShiftModifierTracking() {
        if (initShiftModifierTracking.done) return;
        initShiftModifierTracking.done = true;
        window.addEventListener(
            'keydown',
            (e) => {
                syncShiftModifierFromEvent(e);
            },
            { capture: true },
        );
        window.addEventListener(
            'keyup',
            (e) => {
                syncShiftModifierFromEvent(e);
            },
            { capture: true },
        );
        window.addEventListener('blur', resetShiftModifierTracking);
    }

    /**
     * リージョン内小節ジャンプ用の数字。
     * - テンキー: Shift 不要（OS が Shift を付与しないため）
     * - 上段数字キー: Shift 必須（修飾なしは % ジャンプ）
     */
    function getRegionBarJumpDigit(event) {
        if (!event || event.ctrlKey || event.metaKey || event.altKey) return null;
        const digit = getNumpadSeekDigit(event.code);
        if (digit == null) return null;
        if (isNumpadDigitKeyCode(event.code)) return digit;
        if (isTopRowDigitKeyCode(event.code) && isBarJumpShiftHeld(event)) return digit;
        return null;
    }

    /** Shift + 0–9 — getRegionBarJumpDigit のエイリアス（後方互換） */
    function getShiftSeekDigit(event) {
        return getRegionBarJumpDigit(event);
    }

    initShiftModifierTracking();

    function isShortcutCodeInGroup(code, groupName) {
        if (!code || !groupName) return false;
        const group = SHORTCUT_GROUPS[groupName];
        if (!group) return false;
        if (group.codes && group.codes.includes(code)) return true;
        if (
            groupName === 'scrubStopCodes' &&
            (/^Numpad[0-9]$/.test(code) || /^Digit[0-9]$/.test(code))
        ) {
            return true;
        }
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
        Period: '.',
        NumpadDecimal: '.',
        Comma: ',',
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
            mute: formatShortcutDef(s.mixLaneMuteToggle),
            muteClearAll: formatShortcutDef(s.mixLaneMuteClearAll),
            laneVolume: chordWithArrows([], 'NumpadAdd', 'NumpadSubtract'),
            addExtraTrack: formatShortcutDef(s.addExtraTrack),
            markerHide: formatShortcutDef(s.markerHideToggle),
            analyze: formatShortcutDef(s.analyzeToggle),
            metronomeClick: formatShortcutDef(s.metronomeClickToggle),
            rehearsalMarkOffset: formatShortcutDef(s.rehearsalMarkOffsetToggle),
            musicalGrid: formatShortcutDef(s.musicalGridToggle),
            musicalPhrase: formatShortcutDef(s.musicalGridPhraseToggle),
            musicalGridMeterFocus: formatShortcutDef(s.musicalGridMeterFocus),
            musicalGridPhraseFocus: formatShortcutDef(s.musicalGridPhraseFocus),
            sessionImport: formatShortcutDef(s.sessionImport),
            sessionExport: formatShortcutDef(s.sessionExport),
            sessionAllClear: formatShortcutDef(s.sessionAllClear),
            masterVolReset: formatShortcutDef(s.masterVolumeResetUnity),
            markerDelete: formatShortcutDef(s.regionDelete),
            feedbackRowNav: chordWithArrows(['Alt'], 'ArrowUp', 'ArrowDown'),
            cancelEdit: formatShortcutDef(s.cancelEditing),
            submitEdit: formatShortcutDef(s.submitEditing),
            waveformZoom: chordWithArrows([], 'ArrowUp', 'ArrowDown'),
            waveformZoomExtreme: chordWithArrows(['Ctrl'], 'ArrowUp', 'ArrowDown'),
            waveformVerticalZoom: chordWithArrows(['Shift'], 'ArrowUp', 'ArrowDown'),
            waveformLaneHeight: chordWithArrows(['Shift', 'Ctrl'], 'ArrowUp', 'ArrowDown'),
            waveformTimelineCenterSeekbar: formatShortcutDef(s.waveformTimelineCenterSeekbar),
            markerStopJump: chordWithArrows(['Ctrl'], 'ArrowLeft', 'ArrowRight'),
            tcNudgeFrame: chordWithArrows([], 'NumpadAdd', 'NumpadSubtract'),
            tcNudgeSec: chordWithArrows(['Shift'], 'NumpadAdd', 'NumpadSubtract'),
            tcClearOut: formatShortcutDef(s.markerPanelTcDeleteOut),
            regionFadeIn: formatShortcutDef(s.regionFadeIn),
            regionFadeOut: formatShortcutDef(s.regionFadeOut),
            layoutModeToggle: formatShortcutDef(s.layoutModeToggle),
            layoutEditToggle: formatShortcutDef(s.layoutEditToggle),
        });
    }

    const SHORTCUT_HINTS = buildShortcutHints();

    function setElementTitle(el, text) {
        if (el && text) el.title = text;
    }

    function applyShortcutTooltips() {
        const h = SHORTCUT_HINTS;
        const playTitle = `再生/停止（${h.playStop}、${h.preroll} でプリロール、${h.replayFromStart} で再生開始位置から再生し直し）`;
        setElementTitle(document.getElementById('playStopBtn'), playTitle);

        const loopTitle = `再生をループ（${h.loop}）`;
        const loopChk = document.getElementById('loopPlaybackCheckbox');
        setElementTitle(loopChk, loopTitle);
        if (loopChk) {
            const loopLbl = loopChk.closest('label');
            setElementTitle(loopLbl, loopTitle);
        }

        const memoTitle = `追加コメント — セッション全体の追加メモ（${h.cancelEdit} でフォーカス解除）`;
        setElementTitle(document.getElementById('markerMemoTextarea'), memoTitle);
        const memoLbl = document.querySelector('label[for="markerMemoTextarea"]');
        setElementTitle(memoLbl, memoTitle);
        setElementTitle(
            document.getElementById('markerCopyBtn'),
            'マーカー一覧をタブ区切りでコピー（時刻は 00:00:00.000 形式・Length 列なし）',
        );
        setElementTitle(
            document.getElementById('markerPasteBtn'),
            'マーカー一覧を貼り付けて全置換（Copy と同形式・ms TC を FPS で最寄りフレームへ合わせて秒として配置）',
        );

        const soloTitle = `Solo（このレーンのみ再生・${h.solo}。ソロ中に再度押すと解除）`;
        const muteTitle = `Mute（このレーンをミュート・${h.mute}、${h.muteClearAll} で全ミュート解除）`;
        const volTitle = `音量を調整（レーン上で ${h.laneVolume} は ±1 dB）`;
        const addTrackTitle = `次の Audio Track を表示（${h.addExtraTrack}）`;

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
            `クリック/ドラッグでシーク。レーン上で ${h.solo}/${h.mute}/${h.laneVolume} はミックス。${h.waveformZoom} またはホイール上/下で横倍率変更（${h.waveformZoomExtreme} または Ctrl+ホイール上/下で最大/全体表示）、${h.waveformVerticalZoom} で振幅倍率変更、${h.waveformLaneHeight} または Shift+Ctrl+ホイール上/下でトラック高さ変更（100%〜400%）、Shift+ホイールで横スクロール。${h.waveformTimelineCenterSeekbar} で再生ヘッドを画面中央へ（一瞬センターロック）。`,
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

        const meterInputTitle = `Tempo/Sig — BPM-拍子（例: 140-4/4）。${h.musicalGridMeterFocus} で編集、Enter/Esc で確定`;
        setElementTitle(document.getElementById('musicalGridMeterInput'), meterInputTitle);
        const phraseInputTitle = `Phrase 小節数（例: 8 / 1,8）。${h.musicalGridPhraseFocus} で編集、Enter/Esc で確定`;
        setElementTitle(document.getElementById('musicalGridPhraseInput'), phraseInputTitle);

        const analyzeTitle = `Live のオン/オフ（${h.analyze} でも Live ↔ 解析停止を切替）`;
        setElementTitle(document.getElementById('analyzeOnCheckbox'), analyzeTitle);
        setElementTitle(
            document.getElementById('analyzeToggleWrap'),
            `Analyze — スペクトラムとレベルメーター（常時表示。チェックで Live、${h.analyze} で Live/解析停止の切替）。解析停止中も CLIP PROTECT は有効。`,
        );

        const clickTitle = `メトロノームクリック音（${h.metronomeClick} で切替）。Click ON かつ再生中のみ鳴ります。`;
        setElementTitle(document.getElementById('metronomeClickCheckbox'), clickTitle);
        setElementTitle(
            document.getElementById('metronomeClickToggleWrap'),
            `Click — 再生中に BPM/拍子グリッドへ同期したクリック音（${h.metronomeClick} で切替）。音量はミックス RMS に連動（楽曲より大きく、Analyze 不要）。設定は次回起動時に復元。`,
        );

        const offsetTitle = `R. Offset — 冒頭小節をアウフタクトとして練習番号を付けない（${h.rehearsalMarkOffset} で切替）。Import/Export Review およびセッション復元に保存。`;
        setElementTitle(document.getElementById('rehearsalMarkOffsetWrap'), offsetTitle);
        const offsetChk = document.getElementById('rehearsalMarkOffsetCheckbox');
        setElementTitle(offsetChk, offsetTitle);
        if (offsetChk) {
            const offsetLbl = offsetChk.closest('label');
            setElementTitle(offsetLbl, offsetTitle);
        }

        setElementTitle(
            document.getElementById('masterVolSlider'),
            `ダブルクリックまたは ${h.masterVolReset} で 100%`,
        );
        setElementTitle(
            document.getElementById('masterVolWrap'),
            `Master Vol — ミックス後のマスター音量（ダブルクリックまたは ${h.masterVolReset} で 100%）。LKFS は再生開始からのインテグレーテッド値（停止後も保持、再再生で計測し直し）。クリップ時は CLIP PROTECT で自動減衰。`,
        );

        setElementTitle(
            document.getElementById('sessionAllClearBtn'),
            `動画・追加音声・マーカー・保存済みセッションをアンロード（${h.sessionAllClear}）`,
        );
        setElementTitle(
            document.getElementById('sessionImportBtn'),
            `.mgacr を Import Review で復元（ドロップ可・${h.sessionImport}）`,
        );
        setElementTitle(
            document.getElementById('sessionExportBtn'),
            `選択中のメディア・マーカー・ミックス・表示設定を1ファイルに保存（${h.sessionExport}）`,
        );
        if (typeof updateSessionExportMediaBtnUi === 'function') {
            updateSessionExportMediaBtnUi(
                typeof fileMain !== 'undefined' && !!fileMain,
            );
        } else {
            setElementTitle(
                document.getElementById('sessionExportVideoBtn'),
                'レビューミックスを 48 kHz / 24-bit ステレオ WAV で書き出し（オフラインバウンス・マーカー/リージョン埋め込み・書き出し中は Esc でキャンセル）',
            );
        }

        const exportVideoChk = document.getElementById('sessionExportIncludeVideo');
        const exportAudioChk = document.getElementById('sessionExportIncludeAudio');
        const exportVideoTitle = 'Export Review に Video を含める';
        const exportAudioTitle = 'Export Review に追加音声（読み込み済みの全 Audio Track）を含める';
        setElementTitle(exportVideoChk, exportVideoTitle);
        setElementTitle(exportAudioChk, exportAudioTitle);
        if (exportVideoChk) setElementTitle(exportVideoChk.closest('label'), exportVideoTitle);
        if (exportAudioChk) setElementTitle(exportAudioChk.closest('label'), exportAudioTitle);

        setElementTitle(document.getElementById('videoClearBtn'), '動画だけをアンロード（追加音声・マーカーは残る場合あり）');
        setElementTitle(
            document.getElementById('videoAudioClearBtn'),
            'Video Audio レーンは非表示にできません（最後の1トラック）',
        );
        setElementTitle(document.getElementById('markerClearAllBtn'), 'すべてのマーカーを削除');
        setElementTitle(document.getElementById('seekBar'), '再生ヘッド位置をシーク');

        setElementTitle(document.getElementById('logCopyBtn'), 'ログ全文をクリップボードへコピー');
        setElementTitle(document.getElementById('logClearBtn'), 'ログを消去');
        const logWeOnlyTitle =
            '警告・エラーのみ表示（次回起動時に復元。Import/Export 対象外）';
        const logWeOnlyCb = document.getElementById('logWeOnlyCheckbox');
        setElementTitle(logWeOnlyCb, logWeOnlyTitle);
        if (logWeOnlyCb) {
            const logWeOnlyLbl = logWeOnlyCb.closest('label');
            setElementTitle(logWeOnlyLbl, logWeOnlyTitle);
        }
        const logDebugTitle =
            '診断用の詳細ログを出力（次回起動時に復元。Import/Export 対象外）';
        const logDebugCb = document.getElementById('logDebugCheckbox');
        setElementTitle(logDebugCb, logDebugTitle);
        if (logDebugCb) {
            const logDebugLbl = logDebugCb.closest('label');
            setElementTitle(logDebugLbl, logDebugTitle);
        }

        const moveUpTitle = '直上の Audio Track と入れ替え（読み込み内容・ミックス設定ごと）';
        const moveDownTitle = '直下の Audio Track と入れ替え（読み込み内容・ミックス設定ごと）';
        for (let slot = 0; slot < trackCount; slot++) {
            setElementTitle(document.getElementById('extraAudioMoveUpBtn' + slot), moveUpTitle);
            setElementTitle(document.getElementById('extraAudioMoveDownBtn' + slot), moveDownTitle);
        }
    }

    function matchUserShortcut(event, shortcutName, opt) {
        const def = SHORTCUTS[shortcutName];
        if (!def) return false;
        return matchesShortcut(event, def, opt);
    }

    function matchMixLaneVolumeUp(event, opt) {
        return (
            matchUserShortcut(event, 'mixLaneVolumeUp', opt) ||
            matchUserShortcut(event, 'mixLaneVolumeUpUsLayout', opt)
        );
    }

    function matchMixLaneVolumeDown(event, opt) {
        return matchUserShortcut(event, 'mixLaneVolumeDown', opt);
    }

    function matchMixLaneVolumeKey(event, opt) {
        return matchMixLaneVolumeUp(event, opt) || matchMixLaneVolumeDown(event, opt);
    }

    function getUserShortcut(shortcutName) {
        return SHORTCUTS[shortcutName] || null;
    }

    window.SHORTCUTS = SHORTCUTS;
    window.SHORTCUT_HINTS = SHORTCUT_HINTS;
    window.formatShortcutDef = formatShortcutDef;
    window.matchesShortcut = matchesShortcut;
    window.matchUserShortcut = matchUserShortcut;
    window.matchMixLaneVolumeUp = matchMixLaneVolumeUp;
    window.matchMixLaneVolumeDown = matchMixLaneVolumeDown;
    window.matchMixLaneVolumeKey = matchMixLaneVolumeKey;
    window.getUserShortcut = getUserShortcut;
    window.getNumpadSeekDigit = getNumpadSeekDigit;
    window.getRegionBarJumpDigit = getRegionBarJumpDigit;
    window.getShiftSeekDigit = getShiftSeekDigit;
    window.isShiftModifierActive = isShiftModifierActive;
    window.isBarJumpShiftHeld = isBarJumpShiftHeld;
    window.isNumpadDigitKeyCode = isNumpadDigitKeyCode;
    window.isTopRowDigitKeyCode = isTopRowDigitKeyCode;
    window.isShortcutCodeInGroup = isShortcutCodeInGroup;
    window.applyShortcutTooltips = applyShortcutTooltips;
})();
