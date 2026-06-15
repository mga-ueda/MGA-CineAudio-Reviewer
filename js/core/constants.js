/**
 * constants.js — 共有定数（Ex トラック数・IndexedDB・localStorage キー・FPS・ログ上限・診断ログフラグ）。
 */
    /** 共有グローバル（extra-audio-tracks.js で const 再宣言しない） */
    window.EXTRA_TRACK_COUNT = 16;

    const LS_PREFS_KEY = 'cineaudio_reviewer_prefs_v1';
    const IDB_NAME = 'cineaudio_reviewer_session_v1';
    const IDB_STORE = 'kv';
    const IDB_KEY_LAST = 'lastSession';
    const IDB_VER = 1;

    /** コンテナ FPS 未検出時の推定 FPS（±1f シーク・タイムコード表示のフォールバック） */
    window.DISPLAY_FPS = 60;

    /**
     * ログ枠に保持する最大行数。超過分は古い行から削除される。
     * DEBUG_LOG のいずれかが true のときは無制限（trim なし）。
     */
    window.LOG_MAX_LINES = 500;

    /**
     * リージョン平行移動スナップ — 隣接境界がこの秒数未満なら「密集」扱い（誤吸着防止）。
     * 密集時の幅は REGION_MOVE_SNAP_DENSE_GAP_RATIO × 隣接間隔。
     */
    window.REGION_MOVE_SNAP_DENSE_GAP_SEC = 2.5;
    window.REGION_MOVE_SNAP_DENSE_GAP_RATIO = 0.15;

    /** Fade 三角掴み帯（8×16px）と重ならない上端 inset — Phrase / スプリット / In/Out 共通 */
    window.REGION_FADE_RESERVE_TOP_INSET_PX = 18;

    /**
     * ログ tier（js/ui/log-core.js）と診断ログ（DEBUG_LOG）の説明。
     *
     * --- ログ tier（表示フィルタ）---
     * action — ユーザー操作の結果。Actions チェック ON 時は action + 警告/エラーのみ表示。
     * detail — 操作の内部步骤（読込進行・永続化・シーク等）。通常ログに表示。
     * meta   — 起動メッセージ・ログ UI 操作（コピー/ダウンロード）等。
     * diag   — 調査用診断。DEBUG_LOG の当該カテゴリが true のときのみ writeDiagLog 経由で記録。
     *
     * 表示形式: [HH:MM:SS] Category message（Category は 8 文字幅）
     * 未移行の writeLog() は LEGACY_LOG_RULES で tier/category を推定する。
     * ユーザー操作の Actions ログは js/ui/log-action-format.js の actionLog / logRegionAction 等で
     * 操作内容が再現できるよう具体的に書く（例: swapped Phrase A ↔ Phrase B on Ex1）。
     *
     * --- DEBUG_LOG（診断カテゴリ）---
     * 通常の action/detail/meta ログは本フラグに関係なく出力される。
     * ここで制御するのは diag tier の冗長ログのみ。
     *
     * 各モジュールは window.isDebugLogCategoryEnabled('REGION_RESTORE') 等で参照する。
     * writeDiagLog('REGION_RESTORE', step, payload) → カテゴリ Restore として記録。
     *
     * 運用のヒント:
     * - 本番・通常レビューでは DEBUG_LOG はすべて false のまま。
     * - 調査時は当該カテゴリだけ true にし、再読み込みして再現操作する。
     * - Actions ON で操作結果だけに絞る。W/E Only で警告/エラーだけに絞る。
     * - いずれか 1 つでも DEBUG_LOG が true の間はログ行数が無制限（すべて false で LOG_MAX_LINES に戻る）。
     *
     * --- REGION_RESTORE ---
     * [RegionRestore] — セッション復元・overlay 再描画・All Clear の段階追跡。
     * モジュール: js/waveform/region-restore-diag.js
     * 主な内容: step/start・step/ok・step/error、トラックごとの region 状態スナップショット、
     *           getTrackSegments の再入検知（region-restore-diag.js / core-geometry 経由）。
     * 有効化の目安: F5 後にリージョン欠落・二重表示・タイムライン slots が空になる。
     *
     * --- MUSICAL_SLOT ---
     * [MusicalSlot] — タイムライン SwapUnit・Phrase バインディング・入れ替え操作の追跡。
     * モジュール: js/musical/timeline-musical-slots-diag.js（phrase/* は musical-grid-meter.js 経由）
     * 主な内容: session/restore スナップショット、swap/rejected・swap/applied、
     *           origin/cache-merge の identity 不一致警告、Ctrl+クリック無音選択（select/silent-gap/*）、
     *           phrase/slots・phrase/spec-blocked など。regionSwapDiagLog もここへ集約。
     * 手動: コンソールから musicalSlotDiagDumpOriginBindings(0) 等も利用可。
     * 有効化の目安: Phrase 着色 ON 時の入れ替え後に練習番号・無音区間がずれる、セッション復元直後の binding 不整合。
     *
     * --- WAVEFORM_VIEWPORT ---
     * [WaveformViewport] — 波形 128px タイル描画・ピークキャッシュの内部動作。
     * モジュール: js/waveform/waveform-viewport-diag.js
     * 主な内容: tile/plan・tile/schedule・tile/merge・tile/load・tile/cancel、
     *           peakCache/hit・miss・store・trim・clear、invalidate/*。
     * 有効化の目安: ズーム/スクロール時の波形欠け・チラつき・ピーク再計算の異常。
     *
     * --- VIDEO_ANALYZER ---
     * [VideoAnalyzer] — 動画モニターの MediaElement タップ・Analyze パイプライン。
     * モジュール: js/export/video-analyzer-diag.js、js/extra-audio/extra-audio-review-mix.js（キャプチャプローブ）
     * 主な内容: monitor/transport、connected / recapture、キャプチャストリームの audioTracks プローブ。
     * 有効化の目安: ネイティブ動画再生時にスペクトラム/メーター/LKFS が更新されない、Analyze 再接続の失敗。
     *
     * --- KEY_PLAYBACK ---
     * [KeyPlayback] — キーシフト・ピッチ境界分割・ライブストレッチ・ハンドオフ再生。
     * モジュール: js/waveform/region/waveform-region-pitch-stretch.js（pitchPlaybackLog）、
     *           js/extra-audio/extra-audio-lane-mix.js、extra-audio-crossfade.js、extra-audio-transport-sync.js
     * 主な内容: start/new-source・start/keep-existing・start/pitch-split-*、
     *           live-stretch/begin・handoff/stop-left-at-when、onended/skip-*、sync/full-resync など。
     * tempo/* ステップも pitchPlaybackLog 経由で本タグに出る（TEMPO_STRETCH とは別）。
     * 有効化の目安: キー変更後のクリック・境界での途切れ、クロスフェードとピッチ分割の競合。
     *
     * --- TEMPO_STRETCH ---
     * [TempoStretch/A] — Tempo/Sig 先頭接頭辞（+N,）による Ex 波形タイムストレッチ。
     * モジュール: js/waveform/tempo-stretch.js（tempoStretchDiagLog）
     * 主な内容: clip/applied、render/worklet-failed、stretch failed、状態ダンプ（F10 検証ボタン）。
     * 有効化の目安: ストレッチ後の無音・尺異常・Enter 確定後のリージョンずれ。KEY_PLAYBACK と併用可。
     *
     * --- TEMPO_STRETCH_VERIFY（F10 検証オプション）---
     * window.TEMPO_STRETCH_VERIFY.skipApply — ストレッチ適用をスキップ（A/B 比較）。
     * dumpTempoStretchVerifyState / restoreAllExtraTracksFromBackup — F10 の検証ボタン。
     *
     * --- REGION_SNAP ---
     * [RegionSnap] — リージョン平行移動のスナップ診断（ポインタ位置・スナップ後・確定位置）。
     * モジュール: js/waveform/region-snap-diag.js
     * 主な内容: move/commit（pointer / snapped / actual の TC と秒、edge・stop）。
     * 有効化の目安: 他トラック境界へのスナップが意図とずれる・ドラッグ完了後に位置が飛ぶ。
     *
     * --- SILENT_GAP_DELETE ---
     * [SilentGapDel] — 無音リージョン削除・Ctrl+クリック無音選択・Delete キー経路の追跡。
     * モジュール: js/waveform/region/waveform-region-core-undo.js（silentGapDeleteDiagLog）、
     *           waveform-region-edit-ops.js、waveform-region-io-keyboard.js、musical-grid-ops.js
     * 主な内容: region-delete/begin・gap-attempt・segment-attempt・done、keydown/begin・handled、
     *           grid/phrase-delete/*。併せて [MusicalSlot] silent-del/* へも転送（MUSICAL_SLOT 要）。
     * 有効化の目安: 無音 gap 削除後にフレーズ定義が崩れる、Delete が効かない/別リージョンが消える。
     *
     * --- IXML ---
     * [iXML] — WAV 読込時の iXML / AXML / BWF / INFO メタデータ全文（F10 診断ログ）。
     * モジュール: js/export/wav-markers.js
     * 有効化の目安: Nuendo 書き出しの ATTR・MusicalUpbeat 等の取り込み内容をログで確認する。
     *
     * --- REGION_HANDLE_HIT_DEBUG ---
     * リージョン操作帯（Fade/In/Out/Split/クロスフェード/Phrase 境界）を波形上に色分け表示。
     * 診断ログ DEBUG_LOG とは別。FADE_TRIANGLE_HIT_DEBUG は後方互換エイリアス。
     */
    const DEBUG_TOGGLES = {
        /** 診断ログ — isDebugLogCategoryEnabled() が参照 */
        DEBUG_LOG: {
            REGION_RESTORE: false,
            REGION_SNAP: false,
            MUSICAL_SLOT: false,
            WAVEFORM_VIEWPORT: false,
            VIDEO_ANALYZER: false,
            KEY_PLAYBACK: false,
            TEMPO_STRETCH: false,
            SILENT_GAP_DELETE: false,
            IXML: false,
        },
        /** 波形 overlay — リージョン操作帯デバッグ描画 */
        REGION_HANDLE_HIT_DEBUG: false,
    };

    window.DEBUG_LOG = DEBUG_TOGGLES.DEBUG_LOG;
    window.REGION_HANDLE_HIT_DEBUG = DEBUG_TOGGLES.REGION_HANDLE_HIT_DEBUG;
    window.FADE_TRIANGLE_HIT_DEBUG = DEBUG_TOGGLES.REGION_HANDLE_HIT_DEBUG;

    window.isRegionHandleHitDebugEnabled = function () {
        return !!(window.REGION_HANDLE_HIT_DEBUG || window.FADE_TRIANGLE_HIT_DEBUG);
    };

    /** F10 検証用 — 実行中のみ。再読み込みで skipApply は false に戻る。 */
    window.TEMPO_STRETCH_VERIFY = {
        /** true = 読込・Enter 確定時のストレッチ適用を抑止（バックアップは維持） */
        skipApply: false,
    };

    /**
     * DEBUG_LOG の指定カテゴリが有効か。category は DEBUG_LOG のキー名（例: 'REGION_RESTORE'）。
     */
    window.isDebugLogCategoryEnabled = function (category) {
        const flags = window.DEBUG_LOG;
        return !!(flags && flags[category]);
    };

    /** DEBUG_LOG のいずれか 1 つでも true なら true（ログ行数無制限の判定に使用）。 */
    window.isAnyDebugLogCategoryEnabled = function () {
        const flags = window.DEBUG_LOG;
        if (!flags || typeof flags !== 'object') return false;
        for (const key in flags) {
            if (Object.prototype.hasOwnProperty.call(flags, key) && flags[key]) {
                return true;
            }
        }
        return false;
    };
