/**
 * audio-waveform-scrub.js — スクラブ overview 描画
 */
    let waveformPeaks = null;
    /** 可視範囲のみの高解像度ピーク（拡大停止時） */
    let waveformViewportPeaks = null;
    /** マルチレゾピーク（ビューポート用スライスの元） */
    let waveformPeakPyramid = null;
    let waveformPeakPyramidGen = 0;
    /** スクラブ中の固定低解像度 overview（ピラミッドから一度だけ生成） */
    const WAVEFORM_SCRUB_OVERVIEW_BARS = 384;
    let waveformScrubOverviewPeaks = null;
    let waveformScrubOverviewDrawRaf = 0;
    /** スクラブ overview を描いた Canvas 窓（変わらなければ再描画しない） */
    let waveformScrubOverviewWindowKey = '';
    let waveformScrubOverviewDrawCommitted = false;

    function waveformCanvasWindowDrawKey(spec) {
        if (!spec) return '';
        const zoom =
            typeof waveformTimelineZoom !== 'undefined' ? waveformTimelineZoom : 1;
        return [
            spec.mode,
            Math.round(spec.canvasLeft),
            Math.round(spec.canvasW),
            Math.round(spec.contentW),
            Math.round(spec.scrollLeft),
            zoom,
        ].join('|');
    }

    function currentWaveformCanvasWindowDrawKey() {
        const spec =
            typeof getWaveformCanvasWindowSpec === 'function'
                ? getWaveformCanvasWindowSpec()
                : null;
        return waveformCanvasWindowDrawKey(spec);
    }

    function isWaveformScrubOverviewDrawActive() {
        return waveformScrubOverviewDrawCommitted;
    }

    /** スクラブ開始: 現在の表示窓を基準に記録（即 overview には切り替えない） */
    function beginWaveformScrubOverviewDrawState() {
        waveformScrubOverviewDrawCommitted = false;
        waveformScrubOverviewWindowKey = currentWaveformCanvasWindowDrawKey();
    }

    function resetWaveformScrubOverviewDrawState() {
        waveformScrubOverviewDrawCommitted = false;
        waveformScrubOverviewWindowKey = '';
    }

    function refreshWaveformScrubOverviewCache() {
        if (
            !waveformPeakPyramid ||
            typeof peaksOverviewFromPyramid !== 'function'
        ) {
            waveformScrubOverviewPeaks = null;
            return;
        }
        const overview = peaksOverviewFromPyramid(
            waveformPeakPyramid,
            WAVEFORM_SCRUB_OVERVIEW_BARS,
        );
        waveformScrubOverviewPeaks =
            overview && overview.length ? overview : null;
    }

    function scheduleWaveformScrubOverviewDraw() {
        if (waveformScrubOverviewDrawRaf) return;
        const runDraw = () => {
            waveformScrubOverviewDrawRaf = 0;
            tryDrawWaveformScrubOverviewIfNeeded();
        };
        if (typeof scheduleWorkAfterTransportUiFrame === 'function') {
            waveformScrubOverviewDrawRaf = scheduleWorkAfterTransportUiFrame(runDraw);
        } else {
            waveformScrubOverviewDrawRaf = requestAnimationFrame(runDraw);
        }
    }

    /** 表示窓が変わったとき: キャッシュ/preview タイル優先、無い場合のみ超荒 overview */
    function tryDrawWaveformScrubOverviewIfNeeded() {
        const playbackScrollFollow =
            typeof isWaveformPlaybackScrollFollowActive === 'function' &&
            isWaveformPlaybackScrollFollowActive();
        const scrubPriority =
            typeof isWaveformScrubPriorityActive === 'function' &&
            isWaveformScrubPriorityActive();
        if (!scrubPriority && !playbackScrollFollow) {
            return false;
        }
        const key = currentWaveformCanvasWindowDrawKey();
        if (key === waveformScrubOverviewWindowKey) return false;
        waveformScrubOverviewWindowKey = key;
        let coverage =
            typeof hydrateWaveformViewportCacheForScrub === 'function'
                ? hydrateWaveformViewportCacheForScrub()
                : 'none';
        if (coverage === 'partial') {
            if (typeof applyScrubPreviewWaveformViewportTiles === 'function') {
                applyScrubPreviewWaveformViewportTiles();
            }
            waveformScrubOverviewDrawCommitted = false;
        } else if (coverage === 'none') {
            waveformScrubOverviewDrawCommitted = !!(
                waveformScrubOverviewPeaks && waveformScrubOverviewPeaks.length
            );
        } else {
            waveformScrubOverviewDrawCommitted = false;
        }
        if (typeof drawAudioWaveformCanvas === 'function') {
            drawAudioWaveformCanvas();
        }
        if (typeof redrawAllExtraTrackWaveforms === 'function') {
            redrawAllExtraTrackWaveforms();
        }
        return true;
    }

    function drawWaveformScrubOverviewOnce() {
        tryDrawWaveformScrubOverviewIfNeeded();
    }

    window.scheduleWaveformScrubOverviewDraw = scheduleWaveformScrubOverviewDraw;
    window.drawWaveformScrubOverviewOnce = drawWaveformScrubOverviewOnce;
    window.tryDrawWaveformScrubOverviewIfNeeded = tryDrawWaveformScrubOverviewIfNeeded;
    window.beginWaveformScrubOverviewDrawState = beginWaveformScrubOverviewDrawState;
    window.resetWaveformScrubOverviewDrawState = resetWaveformScrubOverviewDrawState;
    window.isWaveformScrubOverviewDrawActive = isWaveformScrubOverviewDrawActive;
    let waveformAudioBuffer = null;
    let waveformBuildGen = 0;
    let waveformResizeObs = null;
    let waveformMetaListener = null;
    let waveformOffsetDragActive = false;
    let waveformOffsetDragSlot = -1;
    let waveformOffsetDragPointerId = null;
    let waveformOffsetDragStartClientX = 0;
    let waveformOffsetDragStartScrubW = NaN;
    let waveformOffsetDragStartPointerRatio = NaN;
    /** ドラッグ開始時のタイムライン内容座標（px）— scrubW 変動に追従する delta 計算用 */
    let waveformOffsetDragStartXContent = NaN;
    /** ドラッグ開始時のマスター尺 — 伸長中もポインタの秒換算を一定に保つ */
    let waveformOffsetDragStartMasterSec = NaN;
    let waveformOffsetDragStartTimelineSec = 0;
    let waveformOffsetDragPreserveInPadSec = 0;
    let waveformOffsetDragStartAnchorSec = 0;
    /** 直前フレームのポインタ位置（スナップ方向判定用） */
    let waveformOffsetDragLastProposedSec = NaN;
    let waveformOffsetDragGrabTransportOffsetSec = NaN;
    /** @type {{ slot: number, segmentIndex: number }[] | null} */
    let waveformOffsetDragGroupMembers = null;
    /** @type {Record<string, number> | null} */
    let waveformOffsetDragGroupStartTimelineByKey = null;
    /** @type {Record<string, number> | null} */
    let waveformOffsetDragGroupStartAnchorByKey = null;
    /** @type {Record<string, number> | null} */
    let waveformOffsetDragGroupStartRegionInByKey = null;
    let waveformOffsetDragDocMove = null;
    let waveformOffsetDragDocUp = null;
    let waveformPointerGestureId = null;
    let waveformPointerGestureStartX = 0;
    let waveformPointerGestureStartY = 0;
    let waveformPointerGestureDidMove = false;
    let waveformPointerGestureRegionHit = null;
    let waveformPointerGestureDocMove = null;
    let waveformPointerGestureDocUp = null;
    let waveformPointerGestureWasPlaying = false;
    let seekBarScrubWasPlaying = false;
    let seekBarScrubActive = false;
    let seekBarInputRaf = 0;
    let seekBarInputPendingSec = null;
    const WAVEFORM_POINTER_GESTURE_DRAG_PX = 5;
    const WAVEFORM_LANES_DBLCLICK_MS = 450;
    const WAVEFORM_LANES_DBLCLICK_SLOP_PX = 12;
    let waveformLanesClickState = null;
    let waveformLanesLastPointerX = null;
    let waveformLanesLastPointerY = null;
    let waveformTargetExtraSlot = -1;
    /** ミックス対象として最後にアクティブだった Ex スロット（スプリット等のフォールバック） */
    let lastActiveMixExtraSlot = -1;
    let waveformBuildTimer = 0;
    let waveformLoadKickTimer = 0;
    let waveformDecodeInFlight = false;
    let waveformPresenceWatchTimer = 0;
    let waveformPresenceWatchGen = 0;
    let waveformPauseBuildListener = null;
    const WAVEFORM_PRESENCE_WATCH_INTERVAL_MS = 1500;
    const WAVEFORM_PRESENCE_WATCH_MAX_TRIES = 40;
    const WAVEFORM_PRESENCE_WATCH_FIRST_MS = 300;
