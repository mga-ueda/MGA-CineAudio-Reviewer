/**
 * markers-shared.js — マーカーモジュールの共有状態（分割スクリプト間で参照）。
 */
    var markersByVideoKey;
    var markerMemoByVideoKey;
    var currentMarkerMemo = '';
    var sessionMarkerMemoRestorePayload = null;
    var MARKER_MEMO_COPY_DELIMITER = '---MEMO---';
    var MARKER_MEMO_TABLE_ROW_LABEL = 'Additional Comments';
    var currentMarkers = [];
    var pendingRangeStartSec = null;
    var activeMarkerId = null;
    var markerPanelPointerInside = false;
    var markerPanelHoverId = null;
    var waveformLanesPointerInside = false;
    var waveformMarkerHoverId = null;
    var transportMarkerHighlightId = null;
    var lastTransportSecForMarkerHighlight = null;
    var markerHighlightCrossQueue = [];
    var markerHighlightCrossRaf = 0;
    var MARKER_HIGHLIGHT_CROSS_QUEUE_MAX = 32;
    var lastMarkerListHighlightScrollId = null;
    var markerActiveTcEdge = 'in';
    var markerIdSeq = 0;
    var markersDisplayHidden = false;
    var suppressMarkerRowHoverSeekUntil = 0;
    var MARKER_COMMENT_POINT_HOLD_SEC = 1;
    var MARKER_INSERT_RANGE_HOLD_MS = 200;
    var insertMarkerPressAtMs = null;
    var insertMarkerPressSec = null;
    var insertMarkerLongPressTimer = null;
    var insertMarkerLongPressStarted = false;
    var pendingSessionMarkersForRestore = null;
    var sessionMarkersRestorePayload = null;
