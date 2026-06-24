/**
 * video-region-diag.js — Video 映像トラックリージョン・再生同期の診断（F10 VIDEO_REGION）
 */
(function videoRegionDiagModule() {
    const LOG_PREFIX = '[VideoRegion] ';

    function enabled() {
        return (
            typeof window.isDebugLogCategoryEnabled === 'function' &&
            window.isDebugLogCategoryEnabled('VIDEO_REGION')
        );
    }

    function roundSec(v) {
        return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : v;
    }

    function fmtTc(sec) {
        if (!Number.isFinite(sec)) return null;
        if (typeof formatTimecodeForTransport === 'function') {
            return formatTimecodeForTransport(sec);
        }
        return sec.toFixed(4) + 's';
    }

    function log(stage, detail) {
        if (!enabled()) return;
        if (typeof writeDiagLog === 'function') {
            writeDiagLog('VIDEO_REGION', stage, detail);
            return;
        }
        if (typeof writeLog !== 'function') return;
        let tail = '';
        if (detail != null) {
            try {
                tail = ' | ' + JSON.stringify(detail);
            } catch (_) {
                tail = ' | ' + String(detail);
            }
        }
        writeLog(LOG_PREFIX + stage + tail);
    }

    function summarizeVideoTrackRegions() {
        if (typeof getVideoTrackRef !== 'function' || typeof getTrackSegments !== 'function') {
            return null;
        }
        const track = getVideoTrackRef();
        const segments = getTrackSegments(track);
        const regionIn =
            typeof getSegmentRegionTimelineIn === 'function'
                ? getSegmentRegionTimelineIn(track, 0)
                : null;
        const regionOut =
            segments.length && typeof getSegmentRegionTimelineOut === 'function'
                ? getSegmentRegionTimelineOut(track, segments.length - 1)
                : null;
        return {
            segCount: segments.length,
            regionIn: roundSec(regionIn),
            regionOut: roundSec(regionOut),
            regionInTc: fmtTc(regionIn),
            regionOutTc: fmtTc(regionOut),
        };
    }

    function videoRegionDiagLog(stage, detail) {
        log(stage, detail);
    }

    let lastTransportMapKey = '';
    let lastTransportMapAt = 0;
    const TRANSPORT_MAP_MIN_MS = 400;

    function videoRegionDiagLogTransportMap(transportSec, videoSec, opt) {
        if (!enabled()) return;
        const o = opt && typeof opt === 'object' ? opt : {};
        const force = !!o.force;
        const now = performance.now();
        const key =
            roundSec(transportSec) +
            '|' +
            roundSec(videoSec) +
            '|' +
            (o.applied ? '1' : '0');
        if (!force && key === lastTransportMapKey && now - lastTransportMapAt < TRANSPORT_MAP_MIN_MS) {
            return;
        }
        lastTransportMapKey = key;
        lastTransportMapAt = now;
        log('transport/map', {
            transportSec: roundSec(transportSec),
            transportTc: fmtTc(transportSec),
            videoSec: roundSec(videoSec),
            videoTc: fmtTc(videoSec),
            regionTransportSync: o.regionTransportSync,
            beforeRegionIn: o.beforeRegionIn,
            oneToOneAfterIn: o.oneToOneAfterIn,
            preRollHold: o.preRollHold,
            force: o.force,
            playing: o.playing,
            drift: Number.isFinite(o.drift) ? roundSec(o.drift) : undefined,
            applied: o.applied,
            regions: summarizeVideoTrackRegions(),
        });
    }

    function videoRegionDiagLogPlaybackSync(transportSec, hit, sourceSec) {
        if (!enabled()) return;
        log('playback/sync', {
            transportSec: roundSec(transportSec),
            transportTc: fmtTc(transportSec),
            hitSegmentIndex: hit ? hit.segmentIndex : null,
            sourceSec: roundSec(sourceSec),
            sourceTc: fmtTc(sourceSec),
            regions: summarizeVideoTrackRegions(),
        });
    }

    function videoRegionDiagLogPersist(stage, detail) {
        if (!enabled()) return;
        log('persist/' + stage, detail);
    }

    window.videoRegionDiagLog = videoRegionDiagLog;
    window.videoRegionDiagLogTransportMap = videoRegionDiagLogTransportMap;
    window.videoRegionDiagLogPlaybackSync = videoRegionDiagLogPlaybackSync;
    window.videoRegionDiagLogPersist = videoRegionDiagLogPersist;
})();
