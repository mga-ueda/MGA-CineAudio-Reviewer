/**
 * waveform-region-shared.js — リージョン編集の共有状態（分割スクリプト間）。
 */
    var regionHandleDragActive = false;
    var regionHandleDragTrack = null;
    var regionHandleDragSegmentIndex = -1;
    var regionHandleDragBoundaryIndex = -1;
    var regionHandleDragKind = null;
    /** スプリット境界移動ドラッグ中（クロスフェードプレビューを抑止） */
    var regionHandleDragSplitBoundary = false;
    /** Phrase 着色 ON — フレーズグループ境界をリージョンハンドルでドラッグ中 */
    var regionHandleDragPhraseBoundary = false;
    var regionHandleDragPhraseBoundaryCtx = null;
    var regionHandleDragPhraseBoundaryLatestCounts = null;
    var regionHandleDragPointerId = null;
    var regionHandleDragStartClientX = NaN;
    var regionHandleDragDidMove = false;
    var regionHandleDragCaptureEl = null;
    var regionHandleDragDocMove = null;
    var regionHandleDragDocUp = null;
    var regionOutDragExtendSlot = -1;
    var regionOutDragStartOutTransportSec = NaN;
    var regionOutDragStartMasterSec = NaN;
    var regionOutDragStartScrubW = NaN;
    var regionOutDragStartScrubRatio = NaN;
    var regionOutDragExtentSec = NaN;
    /** リージョン平行移動ドラッグ中の表示用マスター尺（ドラッグ中は縮まない／右延長時のみ拡大） */
    var regionOffsetDragMasterFreezeSec = NaN;
    /** ドラッグ中スナップのヒステリシス用 — 一度吸着した頭位置（秒） */
    var regionOffsetDragStickyHeadSec = NaN;

    var hoveredPlaybackRegionEl = null;
    /** @type {HTMLElement[]} */
    var hoveredPlaybackRegionEls = [];
    var lastRegionHoverClientX = null;
    var lastRegionHoverClientY = null;

    /** @type {{ slot: number, segmentIndex: number }[]} */
    var regionSelectionEntries = [];
