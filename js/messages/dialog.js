/**
 * messages/dialog.js — 確認ダイアログ・アラート・静的オーバーレイ本文。
 */
(function messagesDialogModule() {
    registerMessages({
        'dialog.common.cancel': 'Cansel',
        'dialog.common.ok': 'OK',
        'dialog.common.cancelTitle': '確認ダイアログを閉じる',
        'dialog.common.okTitle': 'この内容で確定',

        'dialog.import.failedTitle': 'インポートに失敗しました',
        'dialog.import.cannotTitle': 'インポートできません',
        'dialog.export.failedTitle': 'エクスポートに失敗しました',

        'dialog.exportWave.title': 'Export Wave',
        'dialog.exportWave.cannotTitle': '音声をエクスポートできません',
        'dialog.exportWave.noTracksBody':
            'エクスポートする追加音声（Audio Track）を読み込んでください。',
        'dialog.exportWave.includeAudioNotice':
            'WAV をエクスポートするには、Include in export の Audio にチェックを入れてください。',
        'dialog.exportWave.noSelectionBody':
            'Include in export の Audio にチェックを入れ、書き出す Audio Track を読み込んでください。',
        'dialog.exportWave.unavailableTitle': 'WAV エクスポート不可',
        'dialog.exportWave.unavailableBody':
            'このブラウザでは WAV エクスポート機能を利用できません。',
        'dialog.exportWave.failedTitle': 'WAV のエクスポートに失敗しました',

        'dialog.exportWebm.title': 'Export WebM',
        'dialog.exportWebm.cannotTitle': '動画をエクスポートできません',
        'dialog.exportWebm.noVideoBody': 'エクスポートする動画を読み込んでください。',
        'dialog.exportWebm.includeVideoNotice':
            'WebM をエクスポートするには、Include in export の Video にチェックを入れてください。',
        'dialog.exportWebm.unavailableTitle': 'WebM エクスポート不可',
        'dialog.exportWebm.unavailableBody':
            'このブラウザでは WebM エクスポート機能を利用できません。',
        'dialog.exportWebm.failedTitle': 'WebM のエクスポートに失敗しました',

        'dialog.allClear.title': 'All Clear',
        'dialog.allClear.body':
            '読み込んだ動画・追加音声・マーカーなど、すべての読み込み情報が失われます。よろしいですか？',
        'dialog.allClear.failedTitle': 'All Clear に失敗しました',

        'dialog.videoClear.title': 'Video Clear',
        'dialog.videoClear.body':
            '読み込んだ動画をアンロードします。映像に関する情報が失われますが、よろしいですか？',

        'dialog.markersClear.title': 'Markers Clear',
        'dialog.markersClear.body':
            'すべてのマーカーと Memo が削除されます。よろしいですか？',

        'dialog.markersPaste.title': 'Markers Paste',
        'dialog.markersPaste.overlayBody':
            'Copy と同じ形式（# / In / Out / Feedback、時刻は 00:00:00.000）の表を貼り付けて OK を押してください。',
        'dialog.markersPaste.textareaLabel': 'Marker table text',
        'dialog.markersPaste.textareaTitle': 'Markers の表データを貼り付け',
        'dialog.markersPaste.cancelTitle': '貼り付けをキャンセル',
        'dialog.markersPaste.okTitle': '貼り付け内容を反映',
        'dialog.markersPaste.confirmBody': (count) =>
            'マーカー ' + count + ' 件で、現在のマーカー一覧をすべて置き換えます。よろしいですか？',

        'dialog.extraAudio.cannotLoadTitle': 'Cannot load extra audio',
        'dialog.extraAudio.tooLargeBody': (p) =>
            'File size (' + p.mb + ' MB) exceeds the limit (' + p.limitMb + ' MB).',

        'dialog.regionBarJump.title': 'Go to Measure',
        'dialog.regionBarJump.inputLabel': 'Measure number',
    });
})();
