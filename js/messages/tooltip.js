/**
 * messages/tooltip.js — title 属性・ツールチップ（ショートカットヒント込みテンプレート）。
 */
(function messagesTooltipModule() {
    registerMessages({
        'tooltip.playStop': (h) =>
            '再生/停止（' +
            h.playStop +
            '、' +
            h.preroll +
            ' でプリロール、' +
            h.replayFromStart +
            ' で再生開始位置から再生し直し）',
        'tooltip.loop': (h) => '再生をループ（' + h.loop + '）',
        'tooltip.markerMemo': (h) =>
            '追加コメント — セッション全体の追加メモ（' + h.cancelEdit + ' でフォーカス解除）',
        'tooltip.markerCopy':
            'マーカー一覧をタブ区切りでコピー（時刻は 00:00:00.000 形式・Length 列なし）',
        'tooltip.markerPaste':
            'マーカー一覧を貼り付けて全置換（Copy と同形式・ms TC を FPS で最寄りフレームへ合わせて秒として配置）',
        'tooltip.solo': (h) =>
            'Solo（このレーンのみ再生・' + h.solo + '。ソロ中に再度押すと解除）',
        'tooltip.mute': (h) =>
            'Mute（このレーンをミュート・' + h.mute + '、' + h.muteClearAll + ' で全ミュート解除）',
        'tooltip.laneVolume': (h) => '音量を調整（レーン上で ' + h.laneVolume + ' は ±1 dB）',
        'tooltip.addExtraTrack': (h) => '次の Audio Track を表示（' + h.addExtraTrack + '）',
        'tooltip.waveformLanes': (h) =>
            'クリック/ドラッグでシーク。レーン上で ' +
            h.solo +
            '/' +
            h.mute +
            '/' +
            h.laneVolume +
            ' はミックス。' +
            h.waveformZoom +
            ' またはホイール上/下で横倍率変更（' +
            h.waveformZoomExtreme +
            ' または Ctrl+ホイール上/下で最大/全体表示）、' +
            h.waveformVerticalZoom +
            ' で振幅倍率変更、' +
            h.waveformLaneHeight +
            ' または Shift+Ctrl+ホイール上/下でトラック高さ変更（100%〜400%）、Shift+ホイールで横スクロール。' +
            h.waveformTimelineCenterSeekbar +
            ' で再生ヘッドを画面中央へ（一瞬センターロック）。',
        'tooltip.musicalGrid': (h) => '小節・拍グリッドの表示（' + h.musicalGrid + '）',
        'tooltip.musicalPhrase': (h) => 'フレーズ着色と番号（' + h.musicalPhrase + '）',
        'tooltip.musicalGridMeterInput': (h) =>
            'Tempo/Sig — BPM-拍子（例: 140-4/4、変拍子 140-3/8+5/8、拍子繰り返し 140-3/4:5/4）。1 要素内で + と : は併用不可（確定時は直前の有効値）。' +
            h.musicalGridMeterFocus +
            ' で編集、Tab で Phrase 欄へ、Enter/Esc で確定',
        'tooltip.musicalGridPhraseInput': (h) =>
            'Phrase 小節数（例: 8 / 1,8）。' +
            h.musicalGridPhraseFocus +
            ' で編集、Tab で Tempo/Sig 欄へ、Enter/Esc で確定',
        'tooltip.analyzeCheckbox': (h) =>
            'Live のオン/オフ（' + h.analyze + ' でも Live ↔ 解析停止を切替）',
        'tooltip.analyzeWrap': (h) =>
            'Analyze — スペクトラムとレベルメーター（常時表示。チェックで Live、' +
            h.analyze +
            ' で Live/解析停止の切替）。解析停止中も CLIP PROTECT は有効。',
        'tooltip.metronomeClickCheckbox': (h) =>
            'メトロノームクリック音（' + h.metronomeClick + ' で切替）。Click ON かつ再生中のみ鳴ります。',
        'tooltip.metronomeClickWrap': (h) =>
            'Click — 再生中に BPM/拍子グリッドへ同期したクリック音（' +
            h.metronomeClick +
            ' で切替）。音量はミックス RMS に連動（楽曲より大きく、Analyze 不要）。設定は次回起動時に復元。',
        'tooltip.rehearsalMarkOffset': (h) =>
            'R. Offset — 冒頭小節をアウフタクトとしてリハーサル名を付けない（' +
            h.rehearsalMarkOffset +
            ' で切替）。Import/Export Review およびセッション復元に保存。',
        'tooltip.masterVolSlider': (h) =>
            'ダブルクリックまたは ' + h.masterVolReset + ' で 100%',
        'tooltip.masterVolWrap': (h) =>
            'Master Vol — ミックス後のマスター音量（ダブルクリックまたは ' +
            h.masterVolReset +
            ' で 100%）。LKFS は再生開始からのインテグレーテッド値（停止後も保持、再再生で計測し直し）。クリップ時は CLIP PROTECT で自動減衰。',
        'tooltip.sessionAllClear': (h) =>
            '動画・追加音声・マーカー・保存済みセッションをアンロード（' + h.sessionAllClear + '）',
        'tooltip.sessionImport': (h) =>
            '.mgacr を Import Review で復元（ドロップ可・' + h.sessionImport + '）',
        'tooltip.sessionExport': (h) =>
            '選択中のメディア・マーカー・ミックス・表示設定を1ファイルに保存（' + h.sessionExport + '）',
        'tooltip.sessionExportWave':
            'レビューミックスを 48 kHz / 24-bit ステレオ WAV で書き出し（オフラインバウンス・マーカー/リージョン埋め込み・書き出し中は Esc でキャンセル）',
        'tooltip.exportIncludeVideo': 'Export Review に Video を含める',
        'tooltip.exportIncludeAudio':
            'Export Review に追加音声（読み込み済みの全 Audio Track）を含める',
        'tooltip.videoClear': '動画だけをアンロード（追加音声・マーカーは残る場合あり）',
        'tooltip.videoAudioClear': 'Video Audio レーンは非表示にできません（最後の1トラック）',
        'tooltip.markerClearAll': 'すべてのマーカーを削除',
        'tooltip.seekBar': '再生ヘッド位置をシーク',
        'tooltip.logCopy': 'ログ全文をクリップボードへコピー',
        'tooltip.logClear': 'ログを消去',
        'tooltip.logWeOnly': '警告・エラーのみ表示（再読み込みで OFF に戻る）',
        'tooltip.logOpsOnly':
            '操作の結果のみ表示（詳細手順・診断ログは除く。警告/エラーは常に表示。再読み込みで OFF に戻る）',
        'tooltip.logDebug':
            '診断用の詳細ログ（F10 の開発者向け定数パネル内。再読み込みで OFF）',
        'tooltip.extraAudioMoveUp':
            '直上の Audio Track と入れ替え（読み込み内容・ミックス設定ごと）',
        'tooltip.extraAudioMoveDown':
            '直下の Audio Track と入れ替え（読み込み内容・ミックス設定ごと）',

        'tooltip.versionBadge': 'バージョン情報を表示',
        'tooltip.fileDrop':
            '動画・追加音声・.mgacr をドロップして読み込み（ページ内どこでも可）',
        'tooltip.guideLink': 'How To を新しいウィンドウで開く',
        'tooltip.shortcutsLink': 'Shortcut 一覧を新しいウィンドウで開く',
        'tooltip.musicalGridPlayheadPos': '現在地（小節・拍・ms）',
        'tooltip.spectrumFloorDb': 'スペクトラム表示の下限 dB',
        'tooltip.meterFloorDb': 'レベルメーター目盛りの下限 dB',

        'tooltip.markerHideView.noMarkers': 'マーカーを追加すると Hide/View が使えます',
        'tooltip.markerHideView.show': (h) =>
            'タイムラインと映像上のマーカーを表示（' + h.markerHide + '）',
        'tooltip.markerHideView.hide': (h) =>
            'タイムラインと映像上のマーカーを非表示（' + h.markerHide + '）',

        'tooltip.videoTcHide.notReady':
            '動画または追加音声を読み込むと TC Hide / TC View が使えます',
        'tooltip.videoTcHide.show':
            '映像上のタイムコードを表示（設定は Export Review / Import Review に保存）',
        'tooltip.videoTcHide.hide':
            '映像上のタイムコードを非表示（設定は Export Review / Import Review に保存）',

        'tooltip.markerTc.in': (h) =>
            'In TC: ' +
            h.tcFrame +
            ' で ±1f、' +
            h.tcSec +
            ' で ±1s（' +
            h.tcDone +
            ' で終了）',
        'tooltip.markerTc.outRange': (h) =>
            'Out TC: ' +
            h.tcFrame +
            ' で ±1f、' +
            h.tcSec +
            ' で ±1s、' +
            h.tcDel +
            ' で Out クリア（' +
            h.tcDone +
            ' で終了）',
        'tooltip.markerTc.outPoint': (h) =>
            'Out TC: ' +
            h.tcFrame +
            ' で range Out を設定（±1f / ' +
            h.tcSec +
            ' で ±1s）',
    });
})();
