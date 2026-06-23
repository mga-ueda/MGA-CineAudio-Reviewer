/**
 * log-action-format.js — Actions（tier=action）向けログの共通フォーマットと出力。
 */
(function logActionFormatModule() {
    function actionLog(category, message, opt) {
        const msg = message != null ? String(message) : '';
        if (typeof writeActionLog === 'function') {
            writeActionLog(category, msg, opt);
        } else if (typeof writeLog === 'function') {
            writeLog(msg, opt);
        }
    }

    function detailLog(category, message, opt) {
        const msg = message != null ? String(message) : '';
        if (typeof writeDetailLog === 'function') {
            writeDetailLog(category, msg, opt);
        } else if (typeof writeLog === 'function') {
            writeLog(msg, opt);
        }
    }

    function formatActionTc(sec) {
        if (typeof formatTimecodeForTransport === 'function') {
            return formatTimecodeForTransport(sec);
        }
        const s = Number(sec);
        return Number.isFinite(s) ? s.toFixed(3) + ' s' : '—';
    }

    function formatExTrack(slot) {
        return 'Ex' + ((slot | 0) + 1);
    }

    function formatRegionRef(slot, segmentIndex) {
        return formatExTrack(slot) + ' R' + ((segmentIndex | 0) + 1);
    }

    function formatRehearsalLabelForActionLog(rehearsalSlotIndex) {
        const i = rehearsalSlotIndex | 0;
        if (i < 0) return '?';
        if (typeof window.rehearsalMarkLabelForRehearsalSlotIndex === 'function') {
            return window.rehearsalMarkLabelForRehearsalSlotIndex(i);
        }
        if (typeof window.rehearsalGroupLabelForIndex === 'function') {
            return window.rehearsalGroupLabelForIndex(i);
        }
        return String(i + 1);
    }

    function formatSwapUnitActionLabel(slot, unitIndex, countsOpt) {
        if (!slot) return 'unit ' + ((unitIndex | 0) + 1);
        const parts = [];
        if (slot.kind === 'silent') {
            parts.push('silent gap ' + ((slot.silentGapIndex | 0) + 1));
        } else if (slot.segmentRefs && slot.segmentRefs.length) {
            parts.push(
                slot.segmentRefs
                    .map((r) => 'R' + ((r.segmentIndex | 0) + 1))
                    .join('+'),
            );
        } else {
            parts.push('unit ' + ((unitIndex | 0) + 1));
        }
        const m = slot.musical || {};
        const rehearsalIdx = m.rehearsalSlotIndex | 0;
        if (rehearsalIdx >= 0) {
            parts.push('Rehearsal ' + formatRehearsalLabelForActionLog(rehearsalIdx));
        }
        let bars = m.rehearsalBarCount | 0;
        if (!(bars > 0) && countsOpt && rehearsalIdx >= 0 && rehearsalIdx < countsOpt.length) {
            bars = countsOpt[rehearsalIdx] | 0;
        }
        if (bars > 0) parts.push(bars + ' bars');
        return parts.join(', ');
    }

    function formatRegionSwapActionMessage(track, slotA, slotB, idxA, idxB, swapMode, counts) {
        const ex = formatExTrack(track.slot);
        const labelA = formatSwapUnitActionLabel(slotA, idxA, counts);
        const labelB = formatSwapUnitActionLabel(slotB, idxB, counts);
        return 'swapped ' + labelA + ' ↔ ' + labelB + ' on ' + ex + ' (' + swapMode + ')';
    }

    function formatRegionHistoryActionMessage(direction, actionLabel) {
        const dir = direction === 'redo' ? 'redo' : 'undo';
        const label = actionLabel != null ? String(actionLabel).trim() : '';
        return label ? dir + ' — ' + label : dir;
    }

    function logRegionAction(message, opt) {
        const msg = message != null ? String(message) : '';
        if (typeof window.noteRegionUndoActionLabel === 'function') {
            window.noteRegionUndoActionLabel(msg);
        }
        actionLog('Region', msg, opt);
    }

    function logMarkerAction(message, opt) {
        actionLog('Marker', message, opt);
    }

    function logRehearsalAction(message, opt) {
        actionLog('Rehearsal', message, opt);
    }

    function logExAudioAction(message, opt) {
        actionLog('ExAudio', message, opt);
    }

    function logMixAction(message, opt) {
        actionLog('Mix', message, opt);
    }

    function logVideoAction(message, opt) {
        actionLog('Video', message, opt);
    }

    function logSessionAction(message, opt) {
        actionLog('Session', message, opt);
    }

    /** Tempo/Sig 先頭接頭辞（±N BPM）を Actions 向けに要約する */
    function formatTempoStretchActionSummary(spec) {
        if (!spec || !spec.entries || !spec.entries.length) return 'no tempo offset';
        const delta = spec.stretchDelta || 0;
        if (!delta) return 'no tempo offset';
        const sourceBpm = spec.entries[0].bpm;
        const effectiveBpm = sourceBpm + delta;
        const parts = [];
        if (delta < 0) {
            parts.push('lowered by ' + (-delta) + ' BPM');
        } else {
            parts.push('raised by ' + delta + ' BPM');
        }
        if (sourceBpm > 0 && effectiveBpm > 0) {
            parts.push('(' + sourceBpm + '\u2192' + effectiveBpm + ')');
        }
        const rate =
            typeof window.computeTempoStretchRateFromSpec === 'function'
                ? window.computeTempoStretchRateFromSpec(spec)
                : sourceBpm > 0 && effectiveBpm > 0
                  ? effectiveBpm / sourceBpm
                  : 1;
        if (Math.abs(rate - 1) > 0.00001) {
            parts.push('\u00d7' + rate.toFixed(4));
        }
        return parts.join(', ');
    }

    function logTempoAction(message, opt) {
        actionLog('Tempo', message, opt);
    }

    window.actionLog = actionLog;
    window.detailLog = detailLog;
    window.formatActionTc = formatActionTc;
    window.formatExTrack = formatExTrack;
    window.formatRegionRef = formatRegionRef;
    window.formatRehearsalLabelForActionLog = formatRehearsalLabelForActionLog;
    window.formatSwapUnitActionLabel = formatSwapUnitActionLabel;
    window.formatRegionSwapActionMessage = formatRegionSwapActionMessage;
    window.formatRegionHistoryActionMessage = formatRegionHistoryActionMessage;
    window.logRegionAction = logRegionAction;
    window.logMarkerAction = logMarkerAction;
    window.logRehearsalAction = logRehearsalAction;
    window.logExAudioAction = logExAudioAction;
    window.logMixAction = logMixAction;
    window.logVideoAction = logVideoAction;
    window.logSessionAction = logSessionAction;
    window.formatTempoStretchActionSummary = formatTempoStretchActionSummary;
    window.logTempoAction = logTempoAction;
})();
