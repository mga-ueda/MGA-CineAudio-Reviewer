/**
 * waveform-region-segment-copy.js — セグメントコピー列の Region In/Out/Dur 計算
 */
    /** セグメントコピー上の Region In（setTrackSegments 前） */
    function segmentCopyRegionIn(seg) {
        if (!seg) return 0;
        return Number.isFinite(seg.regionTimelineInSec)
            ? seg.regionTimelineInSec
            : Number.isFinite(seg.timelineStartSec)
              ? seg.timelineStartSec
              : 0;
    }

    function segmentCopySourceDurSec(seg) {
        if (!seg) return 0;
        return Math.max(
            0,
            (Number(seg.sourceOutSec) || 0) - (Number(seg.sourceInSec) || 0),
        );
    }

    function segmentCopyRegionOut(seg) {
        if (!seg) return 0;
        const anchor = Number.isFinite(seg.timelineStartSec) ? seg.timelineStartSec : 0;
        const regionIn = segmentCopyRegionIn(seg);
        return regionIn + (anchor - regionIn + segmentCopySourceDurSec(seg));
    }

    window.segmentCopyRegionIn = segmentCopyRegionIn;
    window.segmentCopyRegionOut = segmentCopyRegionOut;
    window.segmentCopySourceDurSec = segmentCopySourceDurSec;
