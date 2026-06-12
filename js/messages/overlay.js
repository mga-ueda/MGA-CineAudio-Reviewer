/**
 * messages/overlay.js — 全画面ロック・ローディング等のオーバーレイ文言。
 */
(function messagesOverlayModule() {
    registerMessages({
        'overlay.export.webmTitle': 'WebM を書き出し中',
        'overlay.export.waveTitle': 'WAV を書き出し中',
        'overlay.export.escHint':
            '操作はロックされています。<kbd>Esc</kbd> キーで書き出しをキャンセルできます。',
        'overlay.export.canceling': 'キャンセルしています…',
        'overlay.export.preparing': 'Preparing export…',
        'overlay.export.exportingWebm': 'Exporting WebM…',
        'overlay.export.exportingWave': 'Exporting WAV…',

        'overlay.videoLoad.primary': 'Loading',
        'overlay.videoLoad.loadingVideo': 'Loading video…',
        'overlay.videoLoad.loadingVideoAudio': 'Loading Video Audio…',
        'overlay.videoLoad.ready': 'Ready',
    });
})();
