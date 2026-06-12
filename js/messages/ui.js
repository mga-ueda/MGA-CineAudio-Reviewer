/**
 * messages/ui.js — ボタンラベル等、ツールチップ以外の固定 UI 文言。
 */
(function messagesUiModule() {
    registerMessages({
        'ui.sessionExportMediaBtn.webm': 'Export WebM',
        'ui.sessionExportMediaBtn.wave': 'Export Wave',
        'ui.sessionSave.busy': 'データを保存しています…',
        'ui.sessionSave.pending': 'データ保存中はランプが明るく光ります（保存待ち）',
        'ui.sessionSave.idle': 'データ保存中はランプが明るく光ります',
        'tooltip.sessionExportWebm':
            'タイムコードとマーカーコメントを焼き込んだ WebM を書き出し（実時間・書き出し中は Esc でキャンセル）',
    });
})();
