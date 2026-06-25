/**
 * 動画リージョン In/Out 修正の数値シミュレーション（Node 単体実行）
 * node scripts/simulate-video-region-in-out.js
 */

const PLAYBACK_REGION_MIN_SEC = 0.05;

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

function getSegmentRegionTimelineOutFallback(playbackStart, sourceIn, sourceOut) {
    const sourceSpan = Math.max(PLAYBACK_REGION_MIN_SEC, sourceOut - sourceIn);
    return playbackStart + sourceSpan;
}

function syncRegionTimelineOutFromHandle(timelineEndSec, playbackStart, sourceIn, sourceOut) {
    const sourceSpan = Math.max(PLAYBACK_REGION_MIN_SEC, sourceOut - sourceIn);
    const sourceBasedOut = playbackStart + sourceSpan;
    const end = Number(timelineEndSec);
    if (!Number.isFinite(end)) return null;
    if (Math.abs(end - sourceBasedOut) <= 0.00001) {
        return null;
    }
    return end;
}

function resolveRegionOut(storedOut, playbackStart, sourceIn, sourceOut) {
    if (storedOut != null) return storedOut;
    return getSegmentRegionTimelineOutFallback(playbackStart, sourceIn, sourceOut);
}

function isTransportBeforeVideoRegionIn(transportSec, regionIn) {
    return transportSec < regionIn - 0.0005;
}

function isTransportInVideoPreRollHoldZone(transportSec, holdEnd) {
    return transportSec < holdEnd - 0.0005;
}

function videoSecFromMapping(transportSec, timelineStart, regionIn, sourceIn) {
    if (transportSec < regionIn - 0.0005) {
        return transportSec - timelineStart;
    }
    return sourceIn + (transportSec - regionIn);
}

// ログ carlog_20260625044035.txt の典型値
const anchor = 6.4;
const regionIn = 11;
const sourceIn = 4.6;
const sourceOut = 21.7167;
const playbackStart = regionIn;
const timelineStart = playbackStart - sourceIn; // 6.4
const holdEnd = timelineStart;

console.log('=== 1. Out フォールバック（In トリム後） ===');
const defaultOut = getSegmentRegionTimelineOutFallback(playbackStart, sourceIn, sourceOut);
assert(Math.abs(defaultOut - 28.1167) < 0.001, `defaultOut=${defaultOut}, expected 28.1167`);
console.log('OK defaultOut =', defaultOut.toFixed(4));

console.log('\n=== 2. Out ハンドル接触（transport 28.0166） ===');
const touchTransport = 28.0166;
const storedAfterTouch = syncRegionTimelineOutFromHandle(
    touchTransport,
    playbackStart,
    sourceIn,
    sourceOut,
);
const regionOutAfterTouch = resolveRegionOut(
    storedAfterTouch,
    playbackStart,
    sourceIn,
    sourceOut,
);
assert(
    Math.abs(regionOutAfterTouch - touchTransport) < 0.001,
    `regionOut jumped to ${regionOutAfterTouch}, expected ~${touchTransport}`,
);
assert(
    Math.abs(regionOutAfterTouch - 23.5167) > 1,
    `regression: regionOut still jumps to 23.5167`,
);
console.log('OK regionOut after touch =', regionOutAfterTouch.toFixed(4));

console.log('\n=== 3. Out 削除後フォールバック ===');
const regionOutAfterDelete = resolveRegionOut(
    null,
    playbackStart,
    sourceIn,
    sourceOut,
);
assert(
    Math.abs(regionOutAfterDelete - 28.1167) < 0.001,
    `deleted fallback=${regionOutAfterDelete}, expected 28.1167 not 23.5167`,
);
console.log('OK deleted fallback =', regionOutAfterDelete.toFixed(4));

console.log('\n=== 4. Out 1s 手前ドラッグ ===');
const dragOut = 27.1167;
const storedDrag = syncRegionTimelineOutFromHandle(
    dragOut,
    playbackStart,
    sourceIn,
    sourceOut,
);
const regionOutDrag = resolveRegionOut(
    storedDrag,
    playbackStart,
    sourceIn,
    sourceOut,
);
assert(Math.abs(regionOutDrag - dragOut) < 0.001, `drag out=${regionOutDrag}`);
assert(Math.abs(sourceOut - 21.7167) < 0.001, 'sourceOut must stay unchanged');
console.log('OK regionOut after 1s drag =', regionOutDrag.toFixed(4));

console.log('\n=== 5. 音声ミュート（regionIn 前） ===');
for (const t of [6.0, 9.5, 10.9]) {
    assert(
        isTransportBeforeVideoRegionIn(t, regionIn),
        `transport ${t} should be before regionIn`,
    );
    assert(
        !isTransportInVideoPreRollHoldZone(t, holdEnd) || t < holdEnd,
        `preRoll check at ${t}`,
    );
}
assert(!isTransportBeforeVideoRegionIn(11, regionIn), 'at regionIn audio audible');
assert(!isTransportBeforeVideoRegionIn(15, regionIn), 'after regionIn audio audible');
console.log('OK audio muted when transport <', regionIn);

console.log('\n=== 6. preRoll / 黒画面 / 映像秒 ===');
assert(isTransportInVideoPreRollHoldZone(5.65, holdEnd), 'preRoll at 5.65');
assert(!isTransportInVideoPreRollHoldZone(9.5, holdEnd), 'not preRoll at 9.5');
assert(isTransportBeforeVideoRegionIn(9.5, regionIn), 'blackout at 9.5');
const vs95 = videoSecFromMapping(9.5, timelineStart, regionIn, sourceIn);
assert(Math.abs(vs95 - 3.1) < 0.01, `videoSec at 9.5=${vs95}`);
const vs11 = videoSecFromMapping(11, timelineStart, regionIn, sourceIn);
assert(Math.abs(vs11 - 4.6) < 0.01, `videoSec at 11=${vs11}`);
console.log('OK preRoll until', holdEnd, ', videoSec 9.5→', vs95.toFixed(2), ', 11→', vs11.toFixed(2));

console.log('\n=== 7. 旧フォールバック式の退行確認 ===');
const oldWrongOut = regionIn + (anchor - regionIn + (sourceOut - sourceIn));
assert(Math.abs(oldWrongOut - 23.5167) < 0.001, 'old formula baseline');
assert(Math.abs(defaultOut - oldWrongOut) > 4, 'new formula must differ from old');
console.log('OK old wrong out =', oldWrongOut.toFixed(4), ', new =', defaultOut.toFixed(4));

console.log('\n=== 8. regionIn 通過時の音声ゲート復帰 ===');
function simulateAudioGateTicks(ticks, regionInSec) {
    let prevGate = null;
    const transitions = [];
    for (const t of ticks) {
        const gateMuted = isTransportBeforeVideoRegionIn(t, regionInSec);
        if (prevGate !== gateMuted) {
            transitions.push({ t, gateMuted, action: gateMuted ? 'mute' : 'unmute' });
        }
        prevGate = gateMuted;
    }
    return transitions;
}

// carlog_20260625044622.txt: regionIn=9.5, play from 8.0
const logRegionIn = 9.5;
const playTicks = [8.0, 8.5, 9.0, 9.4, 9.501, 10.0];
const gateTransitions = simulateAudioGateTicks(playTicks, logRegionIn);
assert(gateTransitions.length === 2, `expected 2 transitions, got ${gateTransitions.length}`);
assert(
    gateTransitions[0].t === 8.0 && gateTransitions[0].action === 'mute',
    'first transition should mute at play start',
);
assert(
    Math.abs(gateTransitions[1].t - 9.501) < 0.01 &&
        gateTransitions[1].action === 'unmute',
    `unmute should happen at regionIn crossing, got ${JSON.stringify(gateTransitions[1])}`,
);
assert(
    !gateTransitions.some((tr) => tr.t > logRegionIn + 0.1),
    'no late unmute after regionIn',
);
console.log('OK gate transitions:', gateTransitions.map((tr) => `${tr.t}s→${tr.action}`).join(', '));

console.log('\n=== 9. スプリット後半 + シークバー移動 + In 左ドラッグ（carlog_20260625075239） ===');
// 再現: split @ 33.319 → 前半削除 → Pause で regionIn=21.6809 に移動 → In 左ドラッグ
const t0 = 0;
const splitSourceIn = 33.3191;
const postSplitSourceOut = 60.6667;
const movedRegionIn = 21.6809;
const movedRegionOut = 49.0284;
const sourceSpan = postSplitSourceOut - splitSourceIn;

function simulateExtendSegmentAnchorLeftSeg0(state, seg, newRegionIn, audioEnd) {
    const newAnchor = newRegionIn;
    const newDur = audioEnd - newAnchor;
    seg.sourceInSec = Math.max(0, seg.sourceOutSec - newDur);
    state.headPadSec = Math.max(0, newAnchor - t0);
    delete state.regionLeadPadSec;
    delete seg.regionLeadPadSec;
    delete seg.timelineStartSec;
    if (state.headPadSec > 0.00001) {
        state.regionTimelineInSec = newAnchor;
        seg.regionTimelineInSec = newAnchor;
    } else {
        delete state.regionTimelineInSec;
        delete seg.regionTimelineInSec;
    }
}

function simulateSyncTrackRegionHeadStateFromFirstSegment(state, raw) {
    let anchor = Number.isFinite(raw.timelineStartSec)
        ? raw.timelineStartSec
        : t0 + Math.max(0, Number(state.headPadSec) || 0);
    delete state.regionLeadPadSec;
    delete raw.regionLeadPadSec;
    if (
        Number.isFinite(raw.regionTimelineInSec) &&
        raw.regionTimelineInSec >= anchor - 0.00001
    ) {
        const regionIn = Math.max(0, raw.regionTimelineInSec);
        raw.regionTimelineInSec = regionIn;
        state.regionTimelineInSec = regionIn;
    } else {
        delete state.regionTimelineInSec;
        delete raw.regionTimelineInSec;
    }
    const regionIn = Number.isFinite(state.regionTimelineInSec)
        ? state.regionTimelineInSec
        : anchor;
    state.headPadSec = Math.max(0, regionIn - t0);
    return regionIn;
}

function simulateLegacySyncZeroHeadPad(state, raw) {
    let anchor = Number.isFinite(raw.timelineStartSec) ? raw.timelineStartSec : t0;
    delete state.regionTimelineInSec;
    delete raw.regionTimelineInSec;
    const regionIn = anchor;
    state.headPadSec = Math.max(0, regionIn - t0);
    return regionIn;
}

function getAnchor(state) {
    return t0 + (Number(state.headPadSec) || 0);
}

// 移動後の初期状態（sourceIn は split 点のまま）
const stateAfterMove = { headPadSec: movedRegionIn - t0, regionTimelineInSec: movedRegionIn };
const segAfterMove = {
    sourceInSec: splitSourceIn,
    sourceOutSec: postSplitSourceOut,
    regionTimelineOutSec: movedRegionOut,
};
const audioEndAfterMove = movedRegionIn + sourceSpan;

// 旧バグ: extend 後 legacy sync が headPadSec=0 に戻す → 次フレーム sourceIn スパイク
const jitterState = { headPadSec: movedRegionIn - t0, regionTimelineInSec: movedRegionIn };
const jitterSeg = {
    sourceInSec: splitSourceIn,
    sourceOutSec: postSplitSourceOut,
    regionTimelineOutSec: movedRegionOut,
};
simulateExtendSegmentAnchorLeftSeg0(jitterState, jitterSeg, 21.5532, audioEndAfterMove);
const legacyRegionIn = simulateLegacySyncZeroHeadPad(jitterState, jitterSeg);
assert(Math.abs(getAnchor(jitterState)) < 0.001, `legacy sync zeroes headPad, got ${getAnchor(jitterState)}`);
assert(Math.abs(legacyRegionIn) < 0.001, `legacy sync zeroes regionIn`);
const spikedSourceIn = splitSourceIn + (21.5532 - legacyRegionIn);
assert(
    Math.abs(spikedSourceIn - 54.8723) < 0.05,
    `sourceIn spike after collapse expected ~54.87, got ${spikedSourceIn}`,
);
console.log(
    'OK legacy jitter reproduce: regionIn=',
    legacyRegionIn.toFixed(4),
    '→ spiked sourceIn≈',
    spikedSourceIn.toFixed(4),
);

// 修正後 sync — headPadSec 維持
const fixedSyncState = { headPadSec: movedRegionIn - t0, regionTimelineInSec: movedRegionIn };
const fixedSyncSeg = {
    sourceInSec: splitSourceIn,
    sourceOutSec: postSplitSourceOut,
    regionTimelineOutSec: movedRegionOut,
};
simulateExtendSegmentAnchorLeftSeg0(fixedSyncState, fixedSyncSeg, 21.5532, audioEndAfterMove);
const fixedSyncRegionIn = simulateSyncTrackRegionHeadStateFromFirstSegment(
    fixedSyncState,
    fixedSyncSeg,
);
assert(
    Math.abs(getAnchor(fixedSyncState) - 21.5532) < 0.001,
    `fixed sync anchor should stay 21.5532, got ${getAnchor(fixedSyncState)}`,
);
assert(
    Math.abs(fixedSyncSeg.sourceInSec - 33.1914) < 0.05,
    `fixed sync sourceIn expected ~33.19, got ${fixedSyncSeg.sourceInSec}`,
);
console.log(
    'OK fixed sync: anchor=',
    getAnchor(fixedSyncState).toFixed(4),
    'sourceIn=',
    fixedSyncSeg.sourceInSec.toFixed(4),
);

// 旧バグ再現（seg.regionTimelineInSec 残存）— 参考
const buggyState = { ...stateAfterMove };
const buggySeg = { ...segAfterMove, regionTimelineInSec: 21.766 };
simulateExtendSegmentAnchorLeftSeg0(buggyState, buggySeg, 20.0, audioEndAfterMove);
// 旧実装相当 — seg.regionTimelineInSec を残す
buggySeg.regionTimelineInSec = 21.766;
const buggyRegionIn = simulateSyncTrackRegionHeadStateFromFirstSegment(buggyState, buggySeg);
assert(
    Math.abs(getAnchor(buggyState) - 21.766) < 0.001,
    `buggy anchor should revert to 21.766, got ${getAnchor(buggyState)}`,
);
assert(
    Math.abs(buggySeg.sourceInSec - 31.638) < 0.05,
    `buggy sourceIn shifted without anchor move: ${buggySeg.sourceInSec}`,
);
console.log(
    'OK buggy reproduce: anchor=',
    getAnchor(buggyState).toFixed(4),
    'regionIn=',
    buggyRegionIn.toFixed(4),
    'sourceIn=',
    buggySeg.sourceInSec.toFixed(4),
);

// 修正後: seg.regionTimelineInSec も削除
const fixedState = { ...stateAfterMove };
const fixedSeg = { ...segAfterMove, regionTimelineInSec: 21.766 };
simulateExtendSegmentAnchorLeftSeg0(fixedState, fixedSeg, 20.0, audioEndAfterMove);
const fixedRegionIn = simulateSyncTrackRegionHeadStateFromFirstSegment(fixedState, fixedSeg);
assert(
    Math.abs(getAnchor(fixedState) - 20.0) < 0.001,
    `fixed anchor should be 20.0, got ${getAnchor(fixedState)}`,
);
assert(
    Math.abs(fixedRegionIn - 20.0) < 0.001,
    `fixed regionIn should be 20.0, got ${fixedRegionIn}`,
);
assert(
    Math.abs(fixedSeg.sourceInSec - 31.638) < 0.05,
    `fixed sourceIn expected ~31.638, got ${fixedSeg.sourceInSec}`,
);
const sourceTimelineOffset = fixedSeg.sourceInSec - fixedRegionIn;
assert(
    Math.abs(sourceTimelineOffset - 11.638) < 0.05,
    `sourceIn-regionIn offset should stay ~11.638, got ${sourceTimelineOffset}`,
);
assert(
    Math.abs(getAnchor(fixedState) - fixedRegionIn) < 0.001,
    `anchor should match regionIn after extend`,
);
console.log(
    'OK fixed extend: anchor=',
    getAnchor(fixedState).toFixed(4),
    'regionIn=',
    fixedRegionIn.toFixed(4),
    'sourceIn=',
    fixedSeg.sourceInSec.toFixed(4),
    'offset=',
    sourceTimelineOffset.toFixed(4),
);

// 連続左ドラッグ（18s まで）
let dragState = { headPadSec: movedRegionIn - t0, regionTimelineInSec: movedRegionIn };
let dragSeg = {
    sourceInSec: splitSourceIn,
    sourceOutSec: postSplitSourceOut,
    regionTimelineOutSec: movedRegionOut,
};
for (const targetIn of [19.0, 18.0]) {
    simulateExtendSegmentAnchorLeftSeg0(dragState, dragSeg, targetIn, audioEndAfterMove);
    const ri = simulateSyncTrackRegionHeadStateFromFirstSegment(dragState, dragSeg);
    assert(Math.abs(getAnchor(dragState) - targetIn) < 0.001, `anchor at ${targetIn}`);
    assert(Math.abs(ri - targetIn) < 0.001, `regionIn at ${targetIn}`);
    const offset = dragSeg.sourceInSec - ri;
    assert(Math.abs(offset - 11.638) < 0.05, `offset drift at ${targetIn}: ${offset}`);
}
console.log('OK sequential left drag to 18s');

console.log('\n=== 10. スプリット後半をド頭へ — regionTimelineOutSec 追従（carlog_20260625102237） ===');
// 再現: split @ 2.233 → 前半削除 → 後半を 00:00:00:00 へ平行移動
// t0 固定の applyParallelRegionOffsetDragViaTrackTimeline 確定で Out が追従しないと
// region-timeline-fit が 40.002/42.235 ≈ 0.947 倍速（ピッチ低下）になる。
const splitAtSec = 2.23333333333333;
const fullTimelineOut = 42.235416666666666;
const sourceSpanAfterSplit = fullTimelineOut - splitAtSec;
const regionInBeforeHeadMove = splitAtSec;

function simulateShiftSegmentRegionTimelineOutByDelta(seg, delta) {
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.00001) return;
    if (seg && Number.isFinite(seg.regionTimelineOutSec)) {
        seg.regionTimelineOutSec = Math.max(0, seg.regionTimelineOutSec + delta);
    }
}

function simulateParallelTrackTimelineCommit(state, seg, proposedHeadSec, headPad, oldT0, opt) {
    const headBeforeApply = regionInBeforeHeadMove;
    const finalRegionIn = Math.max(0, proposedHeadSec);
    const newT0 = Math.max(0, proposedHeadSec - headPad);
    const finalT0 = newT0;
    state.headPadSec = Math.max(0, finalRegionIn - finalT0);
    if (state.headPadSec > 0.00001) {
        state.regionTimelineInSec = finalRegionIn;
    } else {
        delete state.regionTimelineInSec;
    }
    const regionMoveDelta = finalRegionIn - headBeforeApply;
    if (
        !(opt && opt.skipOutShift) &&
        Math.abs(regionMoveDelta) > 0.00001 &&
        Math.abs(finalT0 - oldT0) < 0.00001
    ) {
        simulateShiftSegmentRegionTimelineOutByDelta(seg, regionMoveDelta);
    }
    return {
        playbackStart: finalRegionIn,
        regionOut: seg.regionTimelineOutSec,
        fitRate:
            seg.regionTimelineOutSec - finalRegionIn > sourceSpanAfterSplit + 0.001
                ? sourceSpanAfterSplit / (seg.regionTimelineOutSec - finalRegionIn)
                : 1,
    };
}

const headMoveBuggyState = { headPadSec: regionInBeforeHeadMove, regionTimelineInSec: regionInBeforeHeadMove };
const headMoveBuggySeg = {
    sourceInSec: splitAtSec,
    sourceOutSec: fullTimelineOut,
    regionTimelineOutSec: fullTimelineOut,
};
const buggy = simulateParallelTrackTimelineCommit(
    headMoveBuggyState,
    { ...headMoveBuggySeg },
    0,
    regionInBeforeHeadMove,
    0,
    { skipOutShift: true },
);
assert(
    Math.abs(buggy.regionOut - fullTimelineOut) < 0.001,
    `buggy out should stay stale at ${fullTimelineOut}, got ${buggy.regionOut}`,
);
assert(
    Math.abs(buggy.fitRate - sourceSpanAfterSplit / fullTimelineOut) < 0.001,
    `buggy fitRate expected ~0.947, got ${buggy.fitRate}`,
);
console.log(
    'OK buggy reproduce: playbackStart=',
    buggy.playbackStart.toFixed(4),
    'regionOut=',
    buggy.regionOut.toFixed(4),
    'fitRate≈',
    buggy.fitRate.toFixed(4),
);

const headMoveFixedState = { headPadSec: regionInBeforeHeadMove, regionTimelineInSec: regionInBeforeHeadMove };
const headMoveFixedSeg = {
    sourceInSec: splitAtSec,
    sourceOutSec: fullTimelineOut,
    regionTimelineOutSec: fullTimelineOut,
};
const fixed = simulateParallelTrackTimelineCommit(headMoveFixedState, headMoveFixedSeg, 0, regionInBeforeHeadMove, 0);
assert(
    Math.abs(fixed.regionOut - sourceSpanAfterSplit) < 0.001,
    `fixed out expected ${sourceSpanAfterSplit}, got ${fixed.regionOut}`,
);
assert(Math.abs(fixed.fitRate - 1) < 0.001, `fixed fitRate should be 1, got ${fixed.fitRate}`);
console.log(
    'OK fixed head move: playbackStart=',
    fixed.playbackStart.toFixed(4),
    'regionOut=',
    fixed.regionOut.toFixed(4),
    'fitRate=',
    fixed.fitRate.toFixed(4),
);

console.log('\n=== 10. スプリット2本 + タイムラインギャップ（carlog_20260626035738） ===');
function isTransportInVideoSegmentGapSim(track, transportSec) {
    const count = track.segments.length;
    if (count < 2) return false;
    const t = Number(transportSec);
    if (!Number.isFinite(t)) return false;
    for (let i = 0; i < count; i++) {
        const seg = track.segments[i];
        const start = seg.timelineStartSec;
        const end = start + (seg.sourceOutSec - seg.sourceInSec);
        if (t >= start - 0.0005 && t < end + 0.0005) return false;
    }
    const last = track.segments[count - 1];
    const segTimelineEnd =
        last.timelineStartSec + (last.sourceOutSec - last.sourceInSec);
    const regionOut = last.regionTimelineOutSec || segTimelineEnd;
    if (t >= segTimelineEnd - 0.0005 && t < regionOut + 0.0005) return false;
    if (t >= regionOut - 0.0005) return false;
    return true;
}

function videoSecForTransportSim(track, transportSec) {
    const t = Number(transportSec);
    for (let i = 0; i < track.segments.length; i++) {
        const seg = track.segments[i];
        const start = seg.timelineStartSec;
        const end = start + (seg.sourceOutSec - seg.sourceInSec);
        if (t >= start - 0.0005 && t < end + 0.0005) {
            return seg.sourceInSec + (t - start);
        }
    }
    if (isTransportInVideoSegmentGapSim(track, t)) return NaN;
    const last = track.segments[track.segments.length - 1];
    const segTimelineEnd =
        last.timelineStartSec + (last.sourceOutSec - last.sourceInSec);
    const regionOut = last.regionTimelineOutSec || segTimelineEnd;
    if (t >= segTimelineEnd - 0.0005 && t < regionOut + 0.0005) {
        return last.sourceOutSec - 1 / 24;
    }
    return NaN;
}

const splitTrack = {
    segments: [
        { timelineStartSec: 0, sourceInSec: 0, sourceOutSec: 6, regionTimelineOutSec: 6 },
        {
            timelineStartSec: 8,
            sourceInSec: 6,
            sourceOutSec: 21.7167,
            regionTimelineOutSec: 23.7166,
        },
    ],
};
assert(Math.abs(videoSecForTransportSim(splitTrack, 3) - 3) < 0.001, 'seg0 maps 1:1');
assert(Number.isNaN(videoSecForTransportSim(splitTrack, 7)), 'gap at 7s must not map to tail');
assert(
    isTransportInVideoSegmentGapSim(splitTrack, 7),
    'transport 7s is a segment gap',
);
assert(
    Math.abs(videoSecForTransportSim(splitTrack, 9) - 7) < 0.001,
    'seg1 at 9s maps to source 7',
);
assert(!isTransportInVideoSegmentGapSim(splitTrack, 3), 'inside seg0 is not a gap');
assert(isTransportInVideoSegmentGapSim(splitTrack, 6.5), 'between seg0 and seg1 is a gap');
console.log('OK split gap: 7s→blackout, 9s→source 7');

function isPastAllVideoPlaybackEndsSim(contentEndTransportSec, transportSec, eps) {
    const t = Number(transportSec);
    const vd = Number(contentEndTransportSec);
    return vd > 0 && t >= vd - eps;
}

const splitContentEnd = 23.7166;
assert(
    !isPastAllVideoPlaybackEndsSim(splitContentEnd, 6.5, 0.02),
    'gap mid-playback must not count as past all track ends',
);
assert(
    !isPastAllVideoPlaybackEndsSim(splitContentEnd, 6, 0.02),
    'seg0 end must not count as past all track ends',
);
assert(
    isPastAllVideoPlaybackEndsSim(splitContentEnd, 23.72, 0.02),
    'master content end should count as past all track ends',
);
console.log('OK split gap: end detection uses transport content end, not seg0 boundary');

console.log('\n=== 11. ギャップ中 video ended — テール誤進入防止（carlog_20260626042620） ===');
function shouldBeginExtraTransportTailSim(t, vd, inGap) {
    const eps = 0.02;
    if (inGap && t < vd - eps) return false;
    if (vd > 0 && t < vd - eps) return false;
    return true;
}

function handoffTailTransportSim(barT, fromMix) {
    if (fromMix != null && Number.isFinite(fromMix)) {
        return Math.max(barT, fromMix);
    }
    return barT;
}

const carlogVd = 45.7166;
assert(
    !shouldBeginExtraTransportTailSim(27.6, carlogVd, true),
    'gap playback at 27.6s must not enter post-video tail',
);
assert(
    shouldBeginExtraTransportTailSim(45.8, carlogVd, false),
    'past video content end should allow tail entry',
);
assert(
    Math.abs(handoffTailTransportSim(27.6, 26.02) - 27.6) < 0.0001,
    'tail handoff must not rewind transport behind bar clock',
);
console.log('OK gap ended: no tail before video content end, handoff never rewinds');

console.log('\nAll simulations passed.');
