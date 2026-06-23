/**
 * region-restore-diag.js — セッション復元 / overlay / All Clear の段階診断ログ
 * constants.js の DEBUG_LOG.REGION_RESTORE が true のときのみ出力
 */
(function regionRestoreDiagModule() {
    const LOG_PREFIX = '[RegionRestore] ';

    function enabled() {
        return (
            typeof window.isDebugLogCategoryEnabled === 'function' &&
            window.isDebugLogCategoryEnabled('REGION_RESTORE')
        );
    }

    function fmtDetail(detail) {
        if (detail == null) return '';
        try {
            return JSON.stringify(detail);
        } catch (_) {
            return String(detail);
        }
    }

    function log(stage, detail) {
        if (!enabled()) return;
        if (typeof writeDiagLog === 'function') {
            writeDiagLog('REGION_RESTORE', stage, detail);
            return;
        }
        if (typeof writeLog !== 'function') return;
        const tail = detail != null ? ' | ' + fmtDetail(detail) : '';
        writeLog(LOG_PREFIX + stage + tail);
    }

    function exLabel(trackOrSlot) {
        if (typeof trackOrSlot === 'number') return (trackOrSlot | 0) + 1;
        if (trackOrSlot && Number.isFinite(trackOrSlot.slot)) {
            return (trackOrSlot.slot | 0) + 1;
        }
        return '?';
    }

    let stepDepth = 0;

    function runStepShouldLog(detail, opt) {
        const options = opt && typeof opt === 'object' ? opt : {};
        if (options.silent) return false;
        if (options.forceLog) return true;
        return stepDepth === 0;
    }

    function runStep(label, fn, detail, opt) {
        if (!enabled()) return fn();
        const shouldLog = runStepShouldLog(detail, opt);
        stepDepth += 1;
        if (shouldLog) {
            log('step/start', Object.assign({ step: label }, detail || null));
        }
        try {
            const result = fn();
            if (shouldLog) {
                log('step/ok', Object.assign({ step: label }, detail || null));
            }
            return result;
        } catch (err) {
            log('step/error', {
                step: label,
                err: err && err.message ? err.message : String(err),
                detail: detail || null,
            });
            throw err;
        } finally {
            stepDepth -= 1;
            if (stepDepth < 0) stepDepth = 0;
        }
    }

    async function runStepAsync(label, fn, detail, opt) {
        if (!enabled()) return await fn();
        const shouldLog = runStepShouldLog(detail, opt);
        stepDepth += 1;
        if (shouldLog) {
            log('step/start', Object.assign({ step: label }, detail || null));
        }
        try {
            const result = await fn();
            if (shouldLog) {
                log('step/ok', Object.assign({ step: label }, detail || null));
            }
            return result;
        } catch (err) {
            log('step/error', {
                step: label,
                err: err && err.message ? err.message : String(err),
                detail: detail || null,
            });
            throw err;
        } finally {
            stepDepth -= 1;
            if (stepDepth < 0) stepDepth = 0;
        }
    }

    function summarizeTrackRegionState(track) {
        if (typeof getPlaybackRegionsState !== 'function') return {};
        const state = getPlaybackRegionsState(track);
        if (!state) return { active: false };
        const segs = Array.isArray(state.segments) ? state.segments : [];
        let tStart = null;
        if (typeof getExtraTrackTimelineStartSec === 'function' && track && track.slot >= 0) {
            tStart = getExtraTrackTimelineStartSec(track.slot);
        }
        const slots = Array.isArray(state.timelineSlots) ? state.timelineSlots.length : 0;
        let usable = false;
        if (
            slots > 0 &&
            typeof window.persistedTimelineSlotsAreUsable === 'function'
        ) {
            usable = window.persistedTimelineSlotsAreUsable(state.timelineSlots);
        }
        return {
            active: !!state.active,
            segCount: segs.length,
            timelineStartSec: tStart,
            timelineSlots: slots,
            usableTimelineSlots: usable,
            regionTimelineInSec: state.regionTimelineInSec,
            regionLeadPadSec: state.regionLeadPadSec,
            headPadSec: state.headPadSec,
        };
    }

    window.regionRestoreDiagLog = log;
    window.regionRestoreDiagRunStep = runStep;
    window.regionRestoreDiagRunStepAsync = runStepAsync;
    window.regionRestoreDiagExLabel = exLabel;
    window.regionRestoreDiagSummarizeTrack = summarizeTrackRegionState;
})();
