/**
 * waveform-region-shared.js — リージョン編集の共有状態（分割スクリプト間）。
 */
    var regionHandleDragActive = false;
    var regionHandleDragTrack = null;
    var regionHandleDragSegmentIndex = -1;
    var regionHandleDragBoundaryIndex = -1;
    var regionHandleDragKind = null;
    var regionHandleDragPointerId = null;
    var regionHandleDragStartClientX = NaN;
    var regionHandleDragDocMove = null;
    var regionHandleDragDocUp = null;
    var regionOutDragExtendSlot = -1;
    var regionOutDragStartOutTransportSec = NaN;
    var regionOutDragStartMasterSec = NaN;
    var regionOutDragStartScrubW = NaN;
    var regionOutDragStartScrubRatio = NaN;
    var regionOutDragExtentSec = NaN;

    var hoveredPlaybackRegionEl = null;
    /** @type {HTMLElement[]} */
    var hoveredPlaybackRegionEls = [];
    var lastRegionHoverClientX = null;
    var lastRegionHoverClientY = null;

    /** @type {{ slot: number, segmentIndex: number }[]} */
    var regionSelectionEntries = [];
