/**
 * messages/log.js — ログ出力用の固定・テンプレート文言（UI ダイアログと対になるもの中心）。
 */
(function messagesLogModule() {
    registerMessages({
        'log.weOnly.sampleWarn':
            'Test output: sample warning (W/E Only filter check)',
        'log.weOnly.sampleError':
            'Test output: sample error (W/E Only filter check)',
        'log.debug.enabled':
            'Debug Log enabled ([RegionRestore], [MusicalSlot], [KeyPlayback], [VideoAnalyzer], [WaveformViewport], etc.)',
        'log.debug.disabled': 'Debug Log disabled',

        'log.clipboard.copied': 'Log copied to clipboard',
        'log.clipboard.copyFailed': 'Log could not copy',
        'log.download.saved': (fileName) => 'Log downloaded (“' + fileName + '”)',
        'log.download.failed': 'Log download failed',
        'log.download.empty': 'Log download skipped (empty)',

        'log.export.webmCancelEsc': 'Export WebM: cancel requested (Esc)',
        'log.export.waveCancelEsc': 'Export Wave: cancel requested (Esc)',

        'log.videoLoad.started': (fileName) =>
            'Video load: started' + (fileName ? ' (“' + fileName + '”)' : ''),
        'log.videoLoad.ready': (fileName) =>
            'Video load: ready' + (fileName ? ' (“' + fileName + '”)' : ''),
        'log.videoLoad.playbackWaitTimeout':
            'Video load: playback wait timeout — releasing lock',

        'log.dialog.allClear.cancelled': 'All Clear: cancelled',
        'log.dialog.allClear.confirm':
            'All Clear: confirm — all loaded media, markers, and saved session will be removed',
        'log.dialog.videoClear.cancelled': 'Video Clear: cancelled',
        'log.dialog.videoClear.confirm':
            'Video Clear: confirm — loaded video will be unloaded',
        'log.dialog.markersClear.cancelled': 'Markers Clear: cancelled',
        'log.dialog.markersClear.confirm':
            'Markers Clear: confirm — all markers and memo will be removed',
        'log.dialog.markersPaste.cancelled': 'Markers Paste: cancelled',
        'log.dialog.markersPaste.confirm': (count) =>
            'Markers Paste: confirm — replace all markers with ' +
            count +
            ' pasted item(s)',

        'log.markers.pasteCancelledDialog': 'Marker: paste cancelled (dialog)',
        'log.markers.pasteFormatError': (message) => 'Marker: paste format error — ' + message,
        'log.markers.pasted': (parts) =>
            'Marker: pasted from clipboard (' + parts.join(', ') + ')',
        'log.markers.clipboardEmpty': 'Marker: clipboard empty — opening paste dialog',
        'log.markers.clipboardReadFailed': (errMsg) =>
            'Marker: clipboard read failed — ' + errMsg,
        'log.markers.clipboardUnavailable':
            'Marker: clipboard.readText unavailable — opening paste dialog',

        'log.exportWave.noTracks': 'Export Wave: no audio tracks loaded',
        'log.exportWave.includeAudioNotice':
            'Export Wave: Audio not included in export selection (check Include in export → Audio)',
        'log.exportWave.noSelection': 'Export Wave: no audio tracks selected for export',
        'log.exportWave.unavailable': 'Export Wave: unavailable in this browser',
        'log.exportWebm.noVideo': 'Export WebM: no video loaded',
        'log.exportWebm.includeVideoNotice':
            'Export WebM: Video not included in export selection (check Include in export → Video)',
        'log.exportWebm.unavailable': 'Export WebM: unavailable in this browser',

        'log.layout.mode': (label) => 'Layout: ' + label,
    });
})();
