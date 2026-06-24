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

console.log('\nAll simulations passed.');
