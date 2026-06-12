/**
 * markers-ops.js — マーカー追加・削除・TC 編集・ナビ補助。
 */
    function clearAllMarkers() {
        if (!hasMarkerContentToClear()) {
            writeLog('Marker: nothing to clear');
            return;
        }
        const n = currentMarkers.length;
        const hadMemo = hasMarkerMemoText();
        resetInsertMarkerPressState();
        pendingRangeStartSec = null;
        activeMarkerId = null;
        sessionMarkerMemoRestorePayload = null;
        clearMarkerRestoreStateAfterUserClear();
        currentMarkers = [];
        setMarkerMemoText('');
        if (markersDisplayHidden) {
            markersDisplayHidden = false;
            applyMarkersDisplayVisibility();
        }
        const k = getVideoMarkerKey();
        if (k) {
            markersByVideoKey.set(k, []);
            markerMemoByVideoKey.set(k, '');
        }
        persistMarkersAfterChange();
        saveMarkerMemoToCache();
        const parts = [];
        if (n) parts.push(n + ' item(s)');
        if (hadMemo) parts.push('memo');
        writeLog('Marker: all cleared (' + parts.join(', ') + ')');
        flashSeekHint('Markers', 'Cleared', 'notice');
    }

    function cancelPendingRange() {
        if (pendingRangeStartSec == null) return false;
        pendingRangeStartSec = null;
        updateMarkerRangeHint();
        renderSeekBarMarkers();
        writeLog('Marker: range IN cancelled');
        flashSeekHint('Range', 'Cancelled', 'notice');
        return true;
    }

    function clearActiveMarkerTarget() {
        const hadActive = activeMarkerId != null;
        const ae = document.activeElement;
        const inComment =
            ae && ae.closest && ae.closest('.marker-table__comment');
        const inTcInput =
            ae && ae.closest && ae.closest('.marker-table__tc-input');
        activeMarkerId = null;
        if ((inComment || inTcInput) && ae.blur) ae.blur();
        refreshMarkerUi();
        const dismissed = hadActive || inComment || inTcInput;
        if (dismissed) {
            writeLog('Marker: target cleared (Esc)');
            flashSeekHint('Marker', 'None', 'notice');
            if (typeof scheduleWaveformFocusRestore === 'function') scheduleWaveformFocusRestore();
        }
        return dismissed;
    }

    function isMarkerAreaKeyboardActive(opt) {
        const inPanel = (el) =>
            el && el.nodeType === 1 && el.closest && el.closest('#markerPanel');
        if (inPanel(opt && opt.target)) return true;
        return inPanel(document.activeElement);
    }

    /** マーカー一覧の TC 欄・コメント欄を編集中（フォーカス中） */
    function isMarkerListEditableFieldActive(opt) {
        const inField = (el) => {
            if (!el || el.nodeType !== 1 || !el.closest) return false;
            return (
                !!el.closest('.marker-table__tc-input') ||
                !!el.closest('.marker-table__comment[data-marker-comment]')
            );
        };
        if (inField(opt && opt.target)) return true;
        return inField(document.activeElement);
    }

    window.isMarkerListEditableFieldActive = isMarkerListEditableFieldActive;

    function isWaveformDrawingAreaActive(opt) {
        const inWaveform = (el) =>
            el &&
            el.nodeType === 1 &&
            el.closest &&
            (el.closest('#audioWaveformComposite') ||
                el.closest('#audioWaveformLanesTracks') ||
                el.closest('#audioWaveformLanesInner'));
        if (inWaveform(opt && opt.target)) return true;
        if (waveformLanesPointerInside) return true;
        return inWaveform(document.activeElement);
    }

    function handleMarkerPendingRangeEscapeKeydown(e) {
        if (e.code !== 'Escape' || e.ctrlKey || e.altKey || e.metaKey) return false;
        if (e.repeat) return false;
        if (pendingRangeStartSec == null) return false;
        cancelPendingRange();
        e.preventDefault();
        if (typeof scheduleWaveformFocusRestore === 'function') scheduleWaveformFocusRestore();
        return true;
    }

    function handleMarkerSelectionEscapeKeydown(e) {
        if (e.code !== 'Escape' || e.ctrlKey || e.altKey || e.metaKey) return false;
        if (e.repeat) return false;

        const el = e.target;
        const inMarkerPanel = isMarkerAreaKeyboardActive({ target: el });
        const inComment = el && el.closest && el.closest('.marker-table__comment');
        const hadActive = activeMarkerId != null;

        if (!hadActive && !inComment && !inMarkerPanel) return false;

        if (clearActiveMarkerTarget()) {
            e.preventDefault();
            return true;
        }
        return false;
    }

    function handleMarkerEscapeKeydown(e) {
        return (
            handleMarkerPendingRangeEscapeKeydown(e) ||
            handleMarkerSelectionEscapeKeydown(e)
        );
    }

    function persistMarkersAfterChange(opt) {
        normalizeAllMarkerRanges({ silent: true });
        sortMarkersInPlace();
        saveMarkersToCache();
        if (
            !(opt && opt.skipMarkerList) &&
            (!isMarkerTcInputFocused() || (opt && opt.forceMarkerList))
        ) {
            renderMarkerList();
        }
        renderSeekBarMarkers();
        if (typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        if (!(opt && opt.skipSessionFlush) && typeof flushPersistSessionNow === 'function') {
            void flushPersistSessionNow().catch(() => {});
        }
    }

    function addPointMarkerAtSec(sec) {
        const t = Math.max(0, sec);
        const m = {
            id: nextMarkerId(),
            type: 'point',
            timeSec: t,
            comment: '',
        };
        currentMarkers.push(m);
        sortMarkersInPlace();
        activeMarkerId = m.id;
        persistMarkersAfterChange();
        writeLog('Marker: point at ' + tcLabelForSec(t));
        flashSeekHint('Marker', tcLabelForSec(t), 'notice');
    }

    function addPointMarkerAtCurrentTime() {
        if (!markerTimelineReady()) {
            writeLog('Marker: load a video first');
            return;
        }
        addPointMarkerAtSec(currentTransportSec());
    }

    function beginPendingRangeAtSec(sec) {
        if (!markerTimelineReady()) {
            writeLog('Marker: load a video first');
            return;
        }
        const t = clampMarkerSec(sec);
        pendingRangeStartSec = t;
        updateMarkerRangeHint();
        updateMarkerClearAllButton();
        renderSeekBarMarkers();
        writeLog('Marker: range In at ' + tcLabelForSec(t));
        flashSeekHint('Range In', tcLabelForSec(t), 'notice');
    }

    function beginPendingRangeAtCurrentTime() {
        beginPendingRangeAtSec(currentTransportSec());
    }

    function addRangeMarkerBetweenSecs(startSec, endSec, opt) {
        let start = startSec;
        let end = endSec;
        if (end < start) {
            const swap = start;
            start = end;
            end = swap;
        }
        const oneFrame = markerOneFrameSec();
        const span = end - start;
        const comment =
            opt && opt.comment != null ? String(opt.comment) : '';
        const m =
            span > oneFrame + 1e-9
                ? {
                      id: nextMarkerId(),
                      type: 'range',
                      startSec: start,
                      endSec: end,
                      comment,
                  }
                : {
                      id: nextMarkerId(),
                      type: 'point',
                      timeSec: clampMarkerSec(start),
                      comment,
                  };
        currentMarkers.push(m);
        sortMarkersInPlace();
        activeMarkerId = m.id;
        persistMarkersAfterChange(opt);
        if (!(opt && opt.silent)) {
            writeLog('Marker: range ' + tcLabelForSec(start) + ' – ' + tcLabelForSec(end));
            flashSeekHint('Range', tcLabelForSec(start) + ' – ' + tcLabelForSec(end), 'notice');
        }
    }

    function formatRegionVolumeDbToken(db) {
        if (typeof trackLaneFormatDbValue === 'function') {
            return trackLaneFormatDbValue(db);
        }
        const s = db.toFixed(1);
        return db > 0 ? '+' + s : s;
    }

    function isRegionPitchMarkerComment(comment) {
        return /^(?:ピッチ|キー|Key|Pitch)\b/i.test(String(comment || ''));
    }

    function isRegionVolumeMarkerComment(comment) {
        const c = String(comment || '');
        if (isRegionPitchMarkerComment(c)) return false;
        return /dB/i.test(c);
    }

    function formatRegionVolumeMarkerComment(gainDb, _prevGainDb) {
        let db = Number(gainDb);
        if (!Number.isFinite(db)) db = 0;
        const token = formatRegionVolumeDbToken(db);
        return token + ' dB';
    }

    function markerSecNearlyEqual(a, b) {
        const frame = markerOneFrameSec();
        const eps = Math.max(1e-6, frame * 0.5);
        return Math.abs(Number(a) - Number(b)) <= eps;
    }

    function findRegionVolumeMarker(startSec, endSec) {
        const oneFrame = markerOneFrameSec();
        const narrow = endSec - startSec <= oneFrame + 1e-9;
        for (let i = currentMarkers.length - 1; i >= 0; i--) {
            const m = currentMarkers[i];
            if (!isRegionVolumeMarkerComment(m.comment)) continue;
            if (m.type === 'range') {
                if (
                    markerSecNearlyEqual(m.startSec, startSec) &&
                    markerSecNearlyEqual(m.endSec, endSec)
                ) {
                    return m;
                }
            } else if (narrow && m.type === 'point') {
                if (markerSecNearlyEqual(m.timeSec, startSec)) {
                    return m;
                }
            }
        }
        return null;
    }

    function formatRegionPitchToken(semitones) {
        const n = Math.round(Number(semitones));
        if (!Number.isFinite(n) || n === 0) return '0';
        return (n > 0 ? '+' : '') + n;
    }

    function formatRegionPitchMarkerComment(pitchSemitones) {
        const token = formatRegionPitchToken(pitchSemitones);
        return 'Key ' + token;
    }

    function findRegionPitchMarker(startSec, endSec) {
        const oneFrame = markerOneFrameSec();
        const narrow = endSec - startSec <= oneFrame + 1e-9;
        for (let i = currentMarkers.length - 1; i >= 0; i--) {
            const m = currentMarkers[i];
            if (!isRegionPitchMarkerComment(m.comment)) continue;
            if (m.type === 'range') {
                if (
                    markerSecNearlyEqual(m.startSec, startSec) &&
                    markerSecNearlyEqual(m.endSec, endSec)
                ) {
                    return m;
                }
            } else if (narrow && m.type === 'point') {
                if (markerSecNearlyEqual(m.timeSec, startSec)) {
                    return m;
                }
            }
        }
        return null;
    }

    function removeRegionPitchMarkerAtBounds(startSec, endSec, opt) {
        let start = startSec;
        let end = endSec;
        if (end < start) {
            const swap = start;
            start = end;
            end = swap;
        }
        start = clampMarkerSec(start);
        end = clampMarkerSec(end);
        const m = findRegionPitchMarker(start, end);
        if (!m) return;
        currentMarkers = currentMarkers.filter((x) => x.id !== m.id);
        if (activeMarkerId === m.id) activeMarkerId = null;
        persistMarkersAfterChange(opt);
    }

    function upsertRegionPitchMarker(startSec, endSec, pitchSemitones, opt) {
        if (!markerTimelineReady()) return;
        let start = startSec;
        let end = endSec;
        if (end < start) {
            const swap = start;
            start = end;
            end = swap;
        }
        start = clampMarkerSec(start);
        end = clampMarkerSec(end);
        const pitch = Math.round(Number(pitchSemitones));
        if (!Number.isFinite(pitch) || pitch === 0) {
            removeRegionPitchMarkerAtBounds(start, end, opt);
            return;
        }
        const comment = formatRegionPitchMarkerComment(pitch);
        const oneFrame = markerOneFrameSec();
        const span = end - start;
        const makeRange = span > oneFrame + 1e-9;

        let m = findRegionPitchMarker(start, end);
        if (m) {
            if (makeRange) {
                m.type = 'range';
                m.startSec = start;
                m.endSec = end;
                delete m.timeSec;
            } else {
                m.type = 'point';
                m.timeSec = start;
                delete m.startSec;
                delete m.endSec;
            }
            m.comment = comment;
            activeMarkerId = m.id;
            persistMarkersAfterChange(opt);
            return;
        }

        addRangeMarkerBetweenSecs(start, end, {
            comment,
            silent: true,
            ...(opt || {}),
        });
    }

    function syncMarkerForRegionPitchChange(track, segmentIndex, pitchSemitones, prevPitchSemitones) {
        if (!track || track.type !== 'extra' || !Number.isFinite(track.slot)) return;
        if (typeof getSegmentRegionTimelineBounds !== 'function') return;
        const bounds = getSegmentRegionTimelineBounds(track.slot, segmentIndex);
        if (!bounds || !Number.isFinite(bounds.startSec) || !Number.isFinite(bounds.endSec)) {
            return;
        }
        upsertRegionPitchMarker(bounds.startSec, bounds.endSec, pitchSemitones, {
            silent: true,
            prevPitchSemitones,
        });
    }

    window.syncMarkerForRegionPitchChange = syncMarkerForRegionPitchChange;

    function removeRegionVolumeMarkerAtBounds(startSec, endSec, opt) {
        let start = startSec;
        let end = endSec;
        if (end < start) {
            const swap = start;
            start = end;
            end = swap;
        }
        start = clampMarkerSec(start);
        end = clampMarkerSec(end);
        const m = findRegionVolumeMarker(start, end);
        if (!m) return;
        currentMarkers = currentMarkers.filter((x) => x.id !== m.id);
        if (activeMarkerId === m.id) activeMarkerId = null;
        persistMarkersAfterChange(opt);
    }

    function upsertRegionVolumeMarker(startSec, endSec, gainDb, opt) {
        if (!markerTimelineReady()) return;
        let start = startSec;
        let end = endSec;
        if (end < start) {
            const swap = start;
            start = end;
            end = swap;
        }
        start = clampMarkerSec(start);
        end = clampMarkerSec(end);
        const db = Number(gainDb);
        if (!Number.isFinite(db) || Math.abs(db) < 0.0005) {
            removeRegionVolumeMarkerAtBounds(start, end, opt);
            return;
        }
        const comment = formatRegionVolumeMarkerComment(
            gainDb,
            opt && opt.prevGainDb,
        );
        const oneFrame = markerOneFrameSec();
        const span = end - start;
        const makeRange = span > oneFrame + 1e-9;

        let m = findRegionVolumeMarker(start, end);
        if (m) {
            if (makeRange) {
                m.type = 'range';
                m.startSec = start;
                m.endSec = end;
                delete m.timeSec;
            } else {
                m.type = 'point';
                m.timeSec = start;
                delete m.startSec;
                delete m.endSec;
            }
            m.comment = comment;
            activeMarkerId = m.id;
            persistMarkersAfterChange(opt);
            return;
        }

        addRangeMarkerBetweenSecs(start, end, {
            comment,
            silent: true,
            ...(opt || {}),
        });
    }

    function syncMarkerForRegionVolumeChange(track, segmentIndex, gainDb, prevGainDb) {
        if (!track || track.type !== 'extra' || !Number.isFinite(track.slot)) return;
        if (typeof getSegmentRegionTimelineBounds !== 'function') return;
        const bounds = getSegmentRegionTimelineBounds(track.slot, segmentIndex);
        if (!bounds || !Number.isFinite(bounds.startSec) || !Number.isFinite(bounds.endSec)) {
            return;
        }
        upsertRegionVolumeMarker(bounds.startSec, bounds.endSec, gainDb, {
            silent: true,
            prevGainDb,
        });
    }

    window.syncMarkerForRegionVolumeChange = syncMarkerForRegionVolumeChange;

    function parseGainDbFromRegionVolumeMarkerComment(comment) {
        const c = String(comment || '');
        const match = c.match(/([+-]?\d+(?:\.\d+)?)\s*dB/i);
        if (!match) return 0;
        const db = Number(match[1]);
        return Number.isFinite(db) ? db : 0;
    }

    function parsePitchFromRegionPitchMarkerComment(comment) {
        const c = String(comment || '');
        let match = c.match(/^Key\s*([+-]?\d+)/i);
        if (!match) match = c.match(/^Pitch\s*([+-]?\d+)/i);
        if (!match) match = c.match(/(?:ピッチ|キー)を\s*([+-]?\d+)/);
        if (!match) return 0;
        const pitch = Math.round(Number(match[1]));
        return Number.isFinite(pitch) ? pitch : 0;
    }

    function markerMatchesSegmentBounds(m, startSec, endSec) {
        if (!m) return false;
        if (m.type === 'range') {
            return (
                markerSecNearlyEqual(m.startSec, startSec) &&
                markerSecNearlyEqual(m.endSec, endSec)
            );
        }
        if (m.type === 'point') {
            const t = Number(m.timeSec);
            if (!Number.isFinite(t)) return false;
            if (markerSecNearlyEqual(t, startSec)) return true;
            const frame = markerOneFrameSec();
            const eps = Math.max(1e-6, frame * 0.5);
            return t >= startSec - eps && t <= endSec + eps;
        }
        return false;
    }

    function findRegionVolumeMarkerAtSegmentBounds(startSec, endSec) {
        const direct = findRegionVolumeMarker(startSec, endSec);
        if (direct) return direct;
        for (let i = currentMarkers.length - 1; i >= 0; i--) {
            const m = currentMarkers[i];
            if (!isRegionVolumeMarkerComment(m.comment)) continue;
            if (markerMatchesSegmentBounds(m, startSec, endSec)) return m;
        }
        return null;
    }

    function findRegionPitchMarkerAtSegmentBounds(startSec, endSec) {
        const direct = findRegionPitchMarker(startSec, endSec);
        if (direct) return direct;
        for (let i = currentMarkers.length - 1; i >= 0; i--) {
            const m = currentMarkers[i];
            if (!isRegionPitchMarkerComment(m.comment)) continue;
            if (markerMatchesSegmentBounds(m, startSec, endSec)) return m;
        }
        return null;
    }

    function captureTrackSegmentRegionBoundsMap(track) {
        const map = {};
        if (!track || track.type !== 'extra' || !Number.isFinite(track.slot)) return map;
        if (typeof getSegmentRegionTimelineBounds !== 'function') return map;
        const count =
            typeof getTrackSegments === 'function' ? getTrackSegments(track).length : 0;
        for (let i = 0; i < count; i++) {
            const bounds = getSegmentRegionTimelineBounds(track.slot, i);
            if (
                bounds &&
                Number.isFinite(bounds.startSec) &&
                Number.isFinite(bounds.endSec)
            ) {
                map[i] = { startSec: bounds.startSec, endSec: bounds.endSec };
            }
        }
        return map;
    }

    function boundsPairNearlyEqual(a, b) {
        return (
            a &&
            b &&
            markerSecNearlyEqual(a.startSec, b.startSec) &&
            markerSecNearlyEqual(a.endSec, b.endSec)
        );
    }

    function applyRegionMarkerBounds(m, newStartSec, newEndSec) {
        if (!m) return;
        const newStart = clampMarkerSec(newStartSec);
        const newEnd = clampMarkerSec(newEndSec);
        const oneFrame = markerOneFrameSec();
        const span = newEnd - newStart;
        const makeRange = span > oneFrame + 1e-9;
        if (makeRange) {
            m.type = 'range';
            m.startSec = newStart;
            m.endSec = newEnd;
            delete m.timeSec;
        } else {
            m.type = 'point';
            m.timeSec = newStart;
            delete m.startSec;
            delete m.endSec;
        }
    }

    function removeStrayRegionVolumePitchMarkersAtBounds(startSec, endSec, keepIds) {
        const keep = keepIds && typeof keepIds.has === 'function' ? keepIds : null;
        let changed = false;
        for (let i = currentMarkers.length - 1; i >= 0; i--) {
            const m = currentMarkers[i];
            if (keep && keep.has(m.id)) continue;
            const isVol = isRegionVolumeMarkerComment(m.comment);
            const isPitch = isRegionPitchMarkerComment(m.comment);
            if (!isVol && !isPitch) continue;
            if (!markerMatchesSegmentBounds(m, startSec, endSec)) continue;
            currentMarkers.splice(i, 1);
            if (activeMarkerId === m.id) activeMarkerId = null;
            changed = true;
        }
        return changed;
    }

    function resolveRegionVolumeDbForSegmentMove(track, segmentIndex, markerRef) {
        let gainDb =
            typeof getSegmentGainDb === 'function' ? getSegmentGainDb(track, segmentIndex) : 0;
        if (Math.abs(gainDb) > 0.0005) return gainDb;
        if (markerRef && isRegionVolumeMarkerComment(markerRef.comment)) {
            gainDb = parseGainDbFromRegionVolumeMarkerComment(markerRef.comment);
        }
        return Math.abs(gainDb) > 0.0005 ? gainDb : 0;
    }

    function resolveRegionPitchForSegmentMove(track, segmentIndex, markerRef) {
        let pitch =
            typeof getSegmentPitchSemitones === 'function'
                ? getSegmentPitchSemitones(track, segmentIndex)
                : 0;
        if (pitch !== 0) return pitch;
        if (markerRef && isRegionPitchMarkerComment(markerRef.comment)) {
            pitch = parsePitchFromRegionPitchMarkerComment(markerRef.comment);
        }
        return pitch !== 0 ? pitch : 0;
    }

    function relocateRegionVolumePitchMarkersAfterLayout(track, beforeBoundsMap, opt) {
        if (!markerTimelineReady()) return false;
        const o = opt && typeof opt === 'object' ? opt : {};
        const before =
            beforeBoundsMap && typeof beforeBoundsMap === 'object' ? beforeBoundsMap : {};
        if (typeof getSegmentRegionTimelineBounds !== 'function') return false;
        const count =
            typeof getTrackSegments === 'function' ? getTrackSegments(track).length : 0;

        const plans = [];
        for (let i = 0; i < count; i++) {
            const oldBounds = before[i];
            if (!oldBounds) continue;
            const newBounds = getSegmentRegionTimelineBounds(track.slot, i);
            if (!newBounds) continue;
            if (boundsPairNearlyEqual(oldBounds, newBounds)) continue;
            const volM = findRegionVolumeMarkerAtSegmentBounds(
                oldBounds.startSec,
                oldBounds.endSec,
            );
            const pitchM = findRegionPitchMarkerAtSegmentBounds(
                oldBounds.startSec,
                oldBounds.endSec,
            );
            plans.push({
                segmentIndex: i,
                oldBounds,
                newBounds,
                volM,
                pitchM,
            });
        }
        if (!plans.length) return false;

        const touchedMarkerIds = new Set();
        let changed = false;

        for (let pi = 0; pi < plans.length; pi++) {
            const plan = plans[pi];
            if (plan.volM && !touchedMarkerIds.has(plan.volM.id)) {
                applyRegionMarkerBounds(
                    plan.volM,
                    plan.newBounds.startSec,
                    plan.newBounds.endSec,
                );
                touchedMarkerIds.add(plan.volM.id);
                changed = true;
            }
            if (plan.pitchM && !touchedMarkerIds.has(plan.pitchM.id)) {
                applyRegionMarkerBounds(
                    plan.pitchM,
                    plan.newBounds.startSec,
                    plan.newBounds.endSec,
                );
                touchedMarkerIds.add(plan.pitchM.id);
                changed = true;
            }
        }

        for (let pi = 0; pi < plans.length; pi++) {
            const plan = plans[pi];
            let volAtNew = findRegionVolumeMarkerAtSegmentBounds(
                plan.newBounds.startSec,
                plan.newBounds.endSec,
            );
            if (!volAtNew && plan.volM && !touchedMarkerIds.has(plan.volM.id)) {
                applyRegionMarkerBounds(
                    plan.volM,
                    plan.newBounds.startSec,
                    plan.newBounds.endSec,
                );
                touchedMarkerIds.add(plan.volM.id);
                volAtNew = plan.volM;
                changed = true;
            }
            if (!volAtNew) {
                const strayVol = findRegionVolumeMarkerAtSegmentBounds(
                    plan.oldBounds.startSec,
                    plan.oldBounds.endSec,
                );
                if (strayVol && !touchedMarkerIds.has(strayVol.id)) {
                    applyRegionMarkerBounds(
                        strayVol,
                        plan.newBounds.startSec,
                        plan.newBounds.endSec,
                    );
                    touchedMarkerIds.add(strayVol.id);
                    volAtNew = strayVol;
                    changed = true;
                }
            }
            if (!volAtNew) {
                const gainDb = resolveRegionVolumeDbForSegmentMove(
                    track,
                    plan.segmentIndex,
                    plan.volM,
                );
                if (Math.abs(gainDb) > 0.0005) {
                    upsertRegionVolumeMarker(
                        plan.newBounds.startSec,
                        plan.newBounds.endSec,
                        gainDb,
                        { silent: true, prevGainDb: gainDb },
                    );
                    volAtNew = findRegionVolumeMarkerAtSegmentBounds(
                        plan.newBounds.startSec,
                        plan.newBounds.endSec,
                    );
                    if (volAtNew) touchedMarkerIds.add(volAtNew.id);
                    changed = true;
                }
            }

            let pitchAtNew = findRegionPitchMarkerAtSegmentBounds(
                plan.newBounds.startSec,
                plan.newBounds.endSec,
            );
            if (!pitchAtNew && plan.pitchM && !touchedMarkerIds.has(plan.pitchM.id)) {
                applyRegionMarkerBounds(
                    plan.pitchM,
                    plan.newBounds.startSec,
                    plan.newBounds.endSec,
                );
                touchedMarkerIds.add(plan.pitchM.id);
                pitchAtNew = plan.pitchM;
                changed = true;
            }
            if (!pitchAtNew) {
                const strayPitch = findRegionPitchMarkerAtSegmentBounds(
                    plan.oldBounds.startSec,
                    plan.oldBounds.endSec,
                );
                if (strayPitch && !touchedMarkerIds.has(strayPitch.id)) {
                    applyRegionMarkerBounds(
                        strayPitch,
                        plan.newBounds.startSec,
                        plan.newBounds.endSec,
                    );
                    touchedMarkerIds.add(strayPitch.id);
                    pitchAtNew = strayPitch;
                    changed = true;
                }
            }
            if (!pitchAtNew) {
                const pitch = resolveRegionPitchForSegmentMove(
                    track,
                    plan.segmentIndex,
                    plan.pitchM,
                );
                if (pitch !== 0) {
                    upsertRegionPitchMarker(
                        plan.newBounds.startSec,
                        plan.newBounds.endSec,
                        pitch,
                        { silent: true },
                    );
                    pitchAtNew = findRegionPitchMarkerAtSegmentBounds(
                        plan.newBounds.startSec,
                        plan.newBounds.endSec,
                    );
                    if (pitchAtNew) touchedMarkerIds.add(pitchAtNew.id);
                    changed = true;
                }
            }

            if (volAtNew || pitchAtNew) {
                if (
                    removeStrayRegionVolumePitchMarkersAtBounds(
                        plan.oldBounds.startSec,
                        plan.oldBounds.endSec,
                        touchedMarkerIds,
                    )
                ) {
                    changed = true;
                }
            }
        }

        if (!changed) return false;
        persistMarkersAfterChange({ silent: o.silent !== false });
        if (typeof renderSeekBarMarkers === 'function') renderSeekBarMarkers();
        if (typeof renderMarkerList === 'function') renderMarkerList();
        if (typeof updateMarkerCommentOverlay === 'function') updateMarkerCommentOverlay();
        if (typeof refreshAllRegionPitchGainOverlay === 'function') {
            refreshAllRegionPitchGainOverlay();
        }
        return true;
    }

    function syncSegmentVolumePitchAfterRegionLayout(track, beforeBoundsMap, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const before =
            beforeBoundsMap && typeof beforeBoundsMap === 'object' ? beforeBoundsMap : {};
        if (typeof getSegmentRegionTimelineBounds !== 'function') return false;
        const count =
            typeof getTrackSegments === 'function' ? getTrackSegments(track).length : 0;
        let changed = false;
        for (let i = 0; i < count; i++) {
            const oldBounds = before[i];
            if (!oldBounds) continue;
            const newBounds = getSegmentRegionTimelineBounds(track.slot, i);
            if (!newBounds || boundsPairNearlyEqual(oldBounds, newBounds)) continue;

            const volM = findRegionVolumeMarkerAtSegmentBounds(
                newBounds.startSec,
                newBounds.endSec,
            );
            const pitchM = findRegionPitchMarkerAtSegmentBounds(
                newBounds.startSec,
                newBounds.endSec,
            );

            let gainDb =
                typeof getSegmentGainDb === 'function' ? getSegmentGainDb(track, i) : 0;
            if (volM) {
                gainDb = parseGainDbFromRegionVolumeMarkerComment(volM.comment);
            }
            let pitch =
                typeof getSegmentPitchSemitones === 'function'
                    ? getSegmentPitchSemitones(track, i)
                    : 0;
            if (pitchM) {
                pitch = parsePitchFromRegionPitchMarkerComment(pitchM.comment);
            }

            const segOpt = {
                skipUndo: true,
                skipVolumeMarker: true,
                skipPitchMarker: true,
                skipPersist: true,
            };
            if (
                typeof setSegmentGainDb === 'function' &&
                setSegmentGainDb(track, i, gainDb, segOpt)
            ) {
                changed = true;
            }
            if (
                typeof setSegmentPitchSemitones === 'function' &&
                setSegmentPitchSemitones(track, i, pitch, segOpt)
            ) {
                changed = true;
            }
        }
        if (!changed) return false;
        if (!(o.skipPersist) && typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (typeof refreshAllRegionPitchGainOverlay === 'function') {
            refreshAllRegionPitchGainOverlay();
        }
        return true;
    }

    window.captureTrackSegmentRegionBoundsMap = captureTrackSegmentRegionBoundsMap;
    window.relocateRegionVolumePitchMarkersAfterLayout =
        relocateRegionVolumePitchMarkersAfterLayout;
    window.syncSegmentVolumePitchAfterRegionLayout = syncSegmentVolumePitchAfterRegionLayout;

    function completePendingRangeAtCurrentTime() {
        if (!markerTimelineReady() || pendingRangeStartSec == null) return;
        const start = pendingRangeStartSec;
        pendingRangeStartSec = null;
        updateMarkerRangeHint();
        addRangeMarkerBetweenSecs(start, currentTransportSec());
    }

    function clampMarkerSec(sec, opt) {
        const dur = masterDurForTimelineMarkers(opt);
        if (!dur || dur <= 0) return 0;
        return Math.max(0, Math.min(dur - 0.001, sec));
    }

    function markerOneFrameSec() {
        const fps = Math.max(1, masterFpsFloatForTransport());
        return 1 / fps;
    }

    /** Out が In 以前（同時刻含む）なら点マーカーへ（Out 削除と同義） */
    function collapseRangeMarkerToPointIfNarrow(m, opt) {
        if (!m || m.type !== 'range') return false;
        const start = Number(m.startSec);
        const end = Number(m.endSec);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
        if (end > start + 1e-9) return false;
        const t = clampMarkerSec(start);
        m.type = 'point';
        m.timeSec = t;
        delete m.startSec;
        delete m.endSec;
        if (!(opt && opt.silent)) {
            writeLog('Marker: range collapsed to point at ' + tcLabelForSec(t));
        }
        return true;
    }

    function normalizeAllMarkerRanges(opt) {
        let changed = false;
        for (let i = 0; i < currentMarkers.length; i++) {
            if (collapseRangeMarkerToPointIfNarrow(currentMarkers[i], { silent: true })) {
                changed = true;
            }
        }
        if (changed && !(opt && opt.silent)) {
            sortMarkersInPlace();
        }
        return changed;
    }

    function transportSecFromWaveformClientX(clientX) {
        if (typeof transportSecFromClientX === 'function') {
            return transportSecFromClientX(clientX);
        }
        const dur = masterDurForTimelineMarkers();
        if (typeof transportRatioFromClientX === 'function') {
            return transportRatioFromClientX(clientX) * dur;
        }
        return 0;
    }

    function transportSecFromPlaybackFrameIndex(targetIdx) {
        if (!markerTimelineReady()) return null;
        const dur = masterDurForTimelineMarkers();
        if (!dur || dur <= 0) return 0;
        if (typeof videoReady === 'function' && videoReady()) {
            const durVideo = getDuration(videoMain);
            if (durVideo > 0) {
                let lo = 0;
                let hi = durVideo - 0.001;
                for (let i = 0; i < 48; i++) {
                    const mid = (lo + hi) * 0.5;
                    if (playbackFrameIndexForSide(mid, 'main') < targetIdx) lo = mid;
                    else hi = mid;
                }
                let sec = hi;
                if (playbackFrameIndexForSide(sec, 'main') < targetIdx) {
                    sec = Math.min(durVideo - 0.001, sec + masterFrameSec);
                }
                const videoSec = Math.max(0, Math.min(durVideo - 0.001, sec));
                return typeof audioSecFromVideoSec === 'function'
                    ? audioSecFromVideoSec(videoSec)
                    : videoSec;
            }
        }
        let lo = 0;
        let hi = dur - 0.001;
        const fps = masterFpsFloatForTransport();
        for (let i = 0; i < 48; i++) {
            const mid = (lo + hi) * 0.5;
            if (linearFrameIndexFromSec(mid, fps) < targetIdx) lo = mid;
            else hi = mid;
        }
        let sec = hi;
        if (linearFrameIndexFromSec(sec, fps) < targetIdx) {
            sec = Math.min(dur - 0.001, sec + masterFrameSec);
        }
        return Math.max(0, Math.min(dur - 0.001, sec));
    }

    function transportSecFromMarkerTcString(tcStr) {
        if (!markerTimelineReady()) return null;
        const targetIdx = parseTimecodeStringToClipFrameIndex(
            String(tcStr || '').trim(),
            masterFpsFloatForTransport(),
        );
        if (targetIdx == null || !Number.isFinite(targetIdx)) return null;
        return transportSecFromPlaybackFrameIndex(targetIdx);
    }

    function applyMarkerOutFrameOffset(markerId, frameDelta) {
        const m = currentMarkers.find((x) => x.id === markerId);
        if (!m || !markerTimelineReady() || !Number.isFinite(frameDelta)) return false;
        const inIdx = playbackFrameIndexForSide(
            markerVideoSecForTransportSec(markerInSec(m)),
            'main',
        );
        const outIdx = clampFrameIndexToClip(inIdx + frameDelta, 'main');
        const startSec = transportSecFromPlaybackFrameIndex(inIdx);
        const endSec = transportSecFromPlaybackFrameIndex(outIdx);
        if (startSec == null || endSec == null) return false;
        if (m.type === 'point') {
            m.type = 'range';
            delete m.timeSec;
        }
        m.startSec = startSec;
        m.endSec = endSec;
        if (m.endSec < m.startSec) {
            const swap = m.startSec;
            m.startSec = m.endSec;
            m.endSec = swap;
        }
        sortMarkersInPlace();
        activeMarkerId = m.id;
        persistMarkersAfterChange();
        writeLog(
            'Marker: Out ' +
                (frameDelta >= 0 ? '+' : '') +
                frameDelta +
                'f -> ' +
                markerTimeLabel(m)
        );
        flashSeekHint('Range Out', tcLabelForSec(m.endSec));
        return true;
    }

    /** Out 欄: 絶対 TC または In からのフレーム相対（例 +120） */
    function parseMarkerOutTcInput(raw, m) {
        const trimmed = String(raw || '').trim();
        if (!trimmed) return null;
        const rel = trimmed.match(/^([+-])(\d+)$/);
        if (rel) {
            if (!markerTimelineReady() || !m) return null;
            const sign = rel[1] === '+' ? 1 : -1;
            const frameDelta = parseInt(rel[2], 10);
            if (!Number.isFinite(frameDelta)) return null;
            return { kind: 'frames', frameDelta: sign * frameDelta };
        }
        const sec = transportSecFromMarkerTcString(trimmed);
        if (sec == null) return null;
        return { kind: 'sec', sec: sec };
    }

    /** 範囲マーカーの Out TC を削除し、同じ In 位置の点マーカーに戻す */
    function clearMarkerOutTc(markerId, opt) {
        const m = currentMarkers.find((x) => x.id === markerId);
        if (!m || m.type !== 'range') return false;
        const t = clampMarkerSec(m.startSec);
        m.type = 'point';
        m.timeSec = t;
        delete m.startSec;
        delete m.endSec;
        sortMarkersInPlace();
        activeMarkerId = m.id;
        persistMarkersAfterChange({ ...opt, forceMarkerList: true });
        writeLog('Marker: Out TC cleared -> point at ' + tcLabelForSec(t));
        flashSeekHint('Marker', 'Out cleared', 'notice');
        return true;
    }

    function applyMarkerTcEdit(markerId, edge, sec, opt) {
        const m = currentMarkers.find((x) => x.id === markerId);
        if (!m) return false;
        const clampSec = opt && opt.clampSec;
        const t = clampMarkerSec(sec, clampSec);
        const oneFrame = markerOneFrameSec();
        if (m.type === 'point') {
            if (edge === 'in') {
                m.timeSec = t;
            } else if (edge === 'out') {
                const start = clampMarkerSec(m.timeSec, clampSec);
                m.type = 'range';
                m.startSec = start;
                m.endSec = Math.max(start + oneFrame, t);
                delete m.timeSec;
            } else {
                return false;
            }
        } else if (m.type === 'range') {
            if (edge === 'in') {
                m.startSec = Math.max(0, Math.min(t, m.endSec - oneFrame));
            } else if (edge === 'out') {
                m.endSec = Math.max(m.startSec + oneFrame, t);
            } else {
                return false;
            }
            if (m.endSec <= m.startSec) {
                m.endSec = m.startSec + oneFrame;
            }
        } else {
            return false;
        }
        collapseRangeMarkerToPointIfNarrow(m, { silent: true });
        sortMarkersInPlace();
        activeMarkerId = m.id;
        persistMarkersAfterChange(opt);
        writeLog('Marker: TC updated ' + markerTimeLabel(m));
        flashSeekHint('Marker TC', tcLabelForSec(t));
        return true;
    }

    function markerTcFrameIndexForEdge(m, edge) {
        const sec = markerTcSecForEdge(m, edge);
        if (sec == null || !Number.isFinite(sec)) return null;
        return playbackFrameIndexForSide(markerVideoSecForTransportSec(sec), 'main');
    }

    /** +/- 用: Out が空の点マーカーは In 位置を基準にする（従来どおり） */
    function markerVideoSecForTcInputRaw(raw, m, edge) {
        const trimmed = String(raw || '').trim();
        if (trimmed) {
            const transportSec = transportSecFromMarkerTcString(trimmed);
            if (transportSec != null) {
                return markerVideoSecForTransportSec(transportSec);
            }
        }
        const transportSec = markerTcSecForEdge(m, edge);
        if (transportSec != null) {
            return markerVideoSecForTransportSec(transportSec);
        }
        if (edge === 'out' && m.type === 'point') {
            return markerVideoSecForTransportSec(markerInSec(m));
        }
        return markerVideoSecForTransportSec(currentTransportSec());
    }

    function frameIndexFromMarkerTcInputRaw(raw, m, edge) {
        return playbackFrameIndexForSide(markerVideoSecForTcInputRaw(raw, m, edge), 'main');
    }

    function isMarkerTcInputElement(el) {
        return !!(el && el.classList && el.classList.contains('marker-table__tc-input'));
    }

    function isMarkerTcInputFocused() {
        return isMarkerTcInputElement(document.activeElement);
    }

    function effectiveMarkerTcEdge(m, edge) {
        if (edge === 'out') return 'out';
        if (m && m.id === activeMarkerId && markerActiveTcEdge === 'out') {
            return 'out';
        }
        return 'in';
    }

    function refreshMarkerTcInputDisplay(input, m, edge) {
        if (!input || !m) return;
        const eff = edge === 'out' ? 'out' : effectiveMarkerTcEdge(m, edge);
        input.value = markerListRowTcValueForEdge(m, eff);
    }

    /** +/- 用: モデルのトランスポート秒を基準にする（映像終端以降のマスター尺も移動可） */
    function markerTransportSecForNudge(m, edge, inputOpt) {
        const effEdge = effectiveMarkerTcEdge(m, edge);
        let sec = markerTcSecForEdge(m, effEdge);
        if (sec != null && Number.isFinite(sec)) return sec;
        if (effEdge === 'out') {
            sec = markerInSec(m);
            if (Number.isFinite(sec)) return sec;
        }
        if (inputOpt && inputOpt.value) {
            const fromTc = transportSecFromMarkerTcString(String(inputOpt.value).trim());
            if (fromTc != null) return fromTc;
        }
        return null;
    }

    function nudgeMarkerTcByEdge(m, edge, sign, bySeconds, inputOpt) {
        if (!m || !markerTimelineReady() || !Number.isFinite(sign) || sign === 0) return false;
        const effEdge = effectiveMarkerTcEdge(m, edge);
        const currentSec = markerTransportSecForNudge(m, edge, inputOpt);
        if (currentSec == null) return false;
        const delta = bySeconds ? sign : sign * markerOneFrameSec();
        const rawNewSec = currentSec + delta;
        const clampSec = { pendingSec: rawNewSec };
        const newSec = clampMarkerSec(rawNewSec, clampSec);
        if (
            !applyMarkerTcEdit(m.id, effEdge, newSec, {
                skipMarkerList: true,
                clampSec,
            })
        ) {
            return false;
        }
        const t = commitMarkerTransportSeek(newSec);
        syncMarkerSeekTransportUi(t);
        const input =
            inputOpt ||
            (markerTableBody
                ? markerTableBody.querySelector(
                      '.marker-table__tc-input[data-marker-for="' +
                          m.id +
                          '"][data-marker-tc-edge="' +
                          effEdge +
                          '"]',
                  )
                : null);
        if (input) {
            refreshMarkerTcInputDisplay(input, m, effEdge);
            input.focus();
        }
        if (markerTableBody && m.id === activeMarkerId) {
            const outInput = markerTableBody.querySelector(
                '.marker-table__tc-input[data-marker-for="' +
                    m.id +
                    '"][data-marker-tc-edge="out"]',
            );
            if (outInput && outInput !== input && m.type === 'range') {
                outInput.value = tcLabelForSec(m.endSec);
            }
        }
        renderSeekBarMarkers();
        updateMarkerCommentOverlay();
        if (typeof syncWaveformTimelineScrollToTransport === 'function') {
            syncWaveformTimelineScrollToTransport();
        } else if (typeof centerWaveformTimelineOnTransport === 'function') {
            centerWaveformTimelineOnTransport();
        }
        return true;
    }

    function markerTcNudgeShiftHeld(ev) {
        return !!(
            ev.shiftKey ||
            (typeof ev.getModifierState === 'function' && ev.getModifierState('Shift'))
        );
    }

    /** Shift+Equal は US 配列で「+」文字のための Shift。±1秒ではなく ±1f として扱う */
    function markerTcNudgeBySeconds(ev, plus) {
        if (!markerTcNudgeShiftHeld(ev)) return false;
        if (plus && matchUserShortcut(ev, 'markerPanelTcNudgePlusShiftUsLayout', { allowRepeat: true })) return false;
        return true;
    }

    function handleMarkerPanelTcNudgeKeydown(ev) {
        if (ev.ctrlKey || ev.altKey || ev.metaKey) return false;
        const plus = matchUserShortcut(ev, 'markerPanelTcNudgePlus', { allowRepeat: true });
        const minus = matchUserShortcut(ev, 'markerPanelTcNudgeMinus', { allowRepeat: true });
        if (!plus && !minus) return false;
        if (!markerTimelineReady()) return false;

        const ae = document.activeElement;
        if (ae && ae.closest && ae.closest('.marker-table__comment')) return false;

        let m = null;
        let edge = markerActiveTcEdge;
        let input = null;

        if (isMarkerTcInputElement(ae)) {
            input = ae;
            m = currentMarkers.find((x) => x.id === ae.dataset.markerFor);
            edge = effectiveMarkerTcEdge(m, ae.dataset.markerTcEdge || edge);
        } else if (activeMarkerId) {
            m = currentMarkers.find((x) => x.id === activeMarkerId);
            if (m && markerTableBody) {
                edge = effectiveMarkerTcEdge(m, edge);
                input = markerTableBody.querySelector(
                    '.marker-table__tc-input[data-marker-for="' +
                        m.id +
                        '"][data-marker-tc-edge="' +
                        edge +
                        '"]',
                );
            }
        }
        if (!m) return false;

        const sign = plus ? 1 : -1;
        const bySeconds = markerTcNudgeBySeconds(ev, plus);
        if (nudgeMarkerTcByEdge(m, edge, sign, bySeconds, input)) {
            ev.preventDefault();
            return true;
        }
        return false;
    }

    function handleMarkerTcInputNudgeKey(ev, input, m, edge) {
        return handleMarkerPanelTcNudgeKeydown(ev);
    }

    function focusMarkerTcInput(markerId, edge) {
        if (!markerTableBody) return;
        const input = markerTableBody.querySelector(
            '.marker-table__tc-input[data-marker-for="' +
                markerId +
                '"][data-marker-tc-edge="' +
                edge +
                '"]',
        );
        if (input && input.focus) input.focus();
    }

    function markerTcFieldTooltip(edge, isRange) {
        const th = typeof window.SHORTCUT_HINTS !== 'undefined' ? window.SHORTCUT_HINTS : {};
        const tcFrame = th.tcNudgeFrame || '+/−';
        const tcSec = th.tcNudgeSec || 'Shift++/−';
        const tcDel = th.tcClearOut || 'Del';
        const tcDone = (th.submitEdit || 'Enter') + '/' + (th.cancelEdit || 'Esc');
        const h = { tcFrame, tcSec, tcDel, tcDone };
        if (edge === 'in') {
            return msg('tooltip.markerTc.in', h);
        }
        if (isRange) {
            return msg('tooltip.markerTc.outRange', h);
        }
        return msg('tooltip.markerTc.outPoint', h);
    }

    function createMarkerTcInput(m, edge) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'marker-table__tc-input';
        input.dataset.markerFor = m.id;
        input.dataset.markerTcEdge = edge;
        input.readOnly = true;
        input.spellcheck = false;
        input.autocomplete = 'off';
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('autocapitalize', 'off');
        input.addEventListener('paste', (ev) => ev.preventDefault());
        input.addEventListener('drop', (ev) => ev.preventDefault());
        input.value = markerListRowTcValueForEdge(m, edge);
        input.title = markerTcFieldTooltip(edge, m.type === 'range');
        const restoreDisplayedTc = () => {
            input.value = markerListRowTcValueForEdge(m, edge);
        };
        let tcEditRevert = null;
        const applyTcEditRevert = () => {
            if (!tcEditRevert) return;
            if (tcEditRevert.type === 'range') {
                m.type = 'range';
                m.startSec = tcEditRevert.startSec;
                m.endSec = tcEditRevert.endSec;
                delete m.timeSec;
            } else {
                m.type = 'point';
                m.timeSec = tcEditRevert.timeSec;
                delete m.startSec;
                delete m.endSec;
            }
            tcEditRevert = null;
            sortMarkersInPlace();
            persistMarkersAfterChange();
            restoreDisplayedTc();
            renderMarkerList();
            renderSeekBarMarkers();
        };
        input.addEventListener('keydown', (ev) => {
            if (handleMarkerTcInputNudgeKey(ev, input, m, edge)) return;
            if (
                edge === 'out' &&
                matchUserShortcut(ev, 'markerPanelTcDeleteOut', { allowRepeat: true })
            ) {
                if (clearMarkerOutTc(m.id)) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    tcEditRevert = null;
                    const t = commitMarkerTransportSeek(clampMarkerSec(m.timeSec));
                    syncMarkerSeekTransportUi(t);
                    updateMarkerCommentOverlay();
                    requestAnimationFrame(() => focusMarkerTcInput(m.id, 'out'));
                }
                return;
            }
            if (matchUserShortcut(ev, 'submitEditing', { allowRepeat: true })) {
                ev.preventDefault();
                ev.stopPropagation();
                tcEditRevert = null;
                input.blur();
                if (typeof scheduleWaveformFocusRestore === 'function') scheduleWaveformFocusRestore();
            } else if (matchUserShortcut(ev, 'cancelEditing', { allowRepeat: true })) {
                ev.preventDefault();
                ev.stopPropagation();
                applyTcEditRevert();
                if (typeof scheduleWaveformFocusRestore === 'function') scheduleWaveformFocusRestore();
            }
        });
        input.addEventListener('mousedown', (ev) => {
            if (ev.button !== 0) return;
            suppressMarkerRowHoverSeek(800);
        });
        input.addEventListener('blur', (ev) => {
            tcEditRevert = null;
            if (isMarkerTcInputElement(ev.relatedTarget)) return;
            if (typeof endMarkerTcEditWaveformZoom === 'function') {
                endMarkerTcEditWaveformZoom();
            }
        });
        input.addEventListener('dblclick', (ev) => {
            ev.preventDefault();
            if (edge === 'out' && m.type === 'range') {
                seekToMarker(m, { seekEnd: true });
            } else {
                seekToMarker(m);
            }
        });
        input.addEventListener('focus', () => {
            suppressMarkerRowHoverSeek(800);
            markerActiveTcEdge = edge === 'out' ? 'out' : 'in';
            activeMarkerId = m.id;
            updateMarkerListRowClasses();
            if (m.type === 'range') {
                tcEditRevert = {
                    type: 'range',
                    startSec: m.startSec,
                    endSec: m.endSec,
                };
            } else {
                tcEditRevert = { type: 'point', timeSec: m.timeSec };
            }
            syncSeekToMarkerRow(m, {
                quiet: true,
                seekIn: edge === 'in' || (edge === 'out' && !markerHasOutTc(m)),
                seekEnd: edge === 'out' && markerHasOutTc(m),
            });
            if (typeof beginMarkerTcEditWaveformZoom === 'function') {
                beginMarkerTcEditWaveformZoom();
            }
        });
        return input;
    }

    function removeMarker(id) {
        const idx = currentMarkers.findIndex((m) => m.id === id);
        if (idx < 0) return;
        currentMarkers = currentMarkers.filter((m) => m.id !== id);
        if (activeMarkerId === id) activeMarkerId = null;
        persistMarkersAfterChange();
        writeLog('Marker: removed');
    }

    function updateMarkerComment(id, text) {
        const m = currentMarkers.find((x) => x.id === id);
        if (!m) return;
        m.comment = String(text);
        saveMarkersToCache();
        schedulePersistSession();
        renderSeekBarMarkers();
        updateMarkerCommentOverlay();
    }

