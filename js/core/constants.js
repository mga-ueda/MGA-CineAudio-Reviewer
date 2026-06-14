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

    /** Fade 三角掴み帯（8×16px）と重ならない上端 inset — Phrase / スプリット / In/Out 共通 */
    window.REGION_FADE_RESERVE_TOP_INSET_PX = 18;

    /**
     * 開発者向け・診断ログ / デバッグ描画の説明（既定値は下記 DEBUG_TOGGLES。実行中は F10 の Dev constants パネルでも切替可）。
     *
     * 通常ログ（読み込み完了・エクスポート結果・確認ダイアログの記録・[Warning]/[Error]）は
     * 本フラグに関係なく常に出力される。ここで制御するのは調査用の冗長ログのみ。
     *
     * 各モジュールは window.isDebugLogCategoryEnabled('REGION_RESTORE') 等で参照する。
     * ログ行の先頭タグ（例: [MusicalSlot]）でフィルタしやすい。
     *
     * 運用のヒント:
     * - 本番・通常レビューではすべて false のままにする。
     * - 調査時は当該カテゴリだけ true にし、再読み込みして再現操作する。
     * - 大量出力時はログ枠の W/E Only で [Warning]/[Error] だけに絞ると見やすい。
     * - いずれか 1 つでも true の間はログ行数が無制限になる（すべて false で LOG_MAX_LINES に戻る）。
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
     * [TempoStretch/A] — メトロノーム連動テンポストレッチ（主に各 Ex トラックのリージョン1）。
     * モジュール: js/waveform/region/waveform-region-pitch-stretch.js（tempoStretchDiagLog）
     * 主な内容: sub-master/ready・failed、cache/hit・miss、kickoff/*、start/resolved、upgrade/*。
     *           ログ接頭辞は [TempoStretch/A]（segmentIndex===0 のとき直接 writeLog）。
     * 有効化の目安: Tempo/Sig 変更後にリージョン1の音程・長さがおかしい、sub-master 待ちで再生が遅れる。
     *
     * --- SILENT_GAP_DELETE ---
     * [SilentGapDel] — 無音リージョン削除・Ctrl+クリック無音選択・Delete キー経路の追跡。
     * モジュール: js/waveform/region/waveform-region-core-undo.js（silentGapDeleteDiagLog）、
     *           waveform-region-edit-ops.js、waveform-region-io-keyboard.js、musical-grid-ops.js
     * 主な内容: region-delete/begin・gap-attempt・segment-attempt・done、keydown/begin・handled、
     *           grid/phrase-delete/*。併せて [MusicalSlot] silent-del/* へも転送（MUSICAL_SLOT 要）。
     * 有効化の目安: 無音 gap 削除後にフレーズ定義が崩れる、Delete が効かない/別リージョンが消える。
     *
     * --- FADE_TRIANGLE_HIT_DEBUG ---
     * Fade In/Out 三角の掴み判定領域を波形上に色付き表示（診断ログ DEBUG_LOG とは別）。
     */
    const DEBUG_TOGGLES = {
        /** 診断ログ — isDebugLogCategoryEnabled() が参照 */
        DEBUG_LOG: {
            REGION_RESTORE: false,
            MUSICAL_SLOT: false,
            WAVEFORM_VIEWPORT: false,
            VIDEO_ANALYZER: false,
            KEY_PLAYBACK: false,
            TEMPO_STRETCH: false,
            SILENT_GAP_DELETE: false,
        },
        /** 波形 overlay の Fade 掴み帯デバッグ描画 */
        FADE_TRIANGLE_HIT_DEBUG: false,
    };

    window.DEBUG_LOG = DEBUG_TOGGLES.DEBUG_LOG;
    window.FADE_TRIANGLE_HIT_DEBUG = DEBUG_TOGGLES.FADE_TRIANGLE_HIT_DEBUG;

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
