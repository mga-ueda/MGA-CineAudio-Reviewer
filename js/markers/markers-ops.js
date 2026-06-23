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
        if (typeof logMarkerAction === 'function') {
            logMarkerAction('all cleared (' + parts.join(', ') + ')');
        } else {
            writeLog('Marker: all cleared (' + parts.join(', ') + ')');
        }
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

    /** マーカー一覧パネルとの操作中（表示中かつポインタ／フォーカスがパネル内） */
    function isMarkerPanelInteractionActive() {
        if (markersDisplayHidden) return false;
        if (markerPanelPointerInside) return true;
        if (isMarkerAreaKeyboardActive()) return true;
        if (isMarkerListEditableFieldActive()) return true;
        return false;
    }

    window.isMarkerPanelInteractionActive = isMarkerPanelInteractionActive;

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
        if (typeof logMarkerAction === 'function') {
            logMarkerAction('point at ' + tcLabelForSec(t));
        } else {
            writeLog('Marker: point at ' + tcLabelForSec(t));
        }
        flashSeekHint('Marker', tcLabelForSec(t), 'notice');
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
        if (typeof logMarkerAction === 'function') {
            logMarkerAction('range In at ' + tcLabelForSec(t));
        } else {
            writeLog('Marker: range In at ' + tcLabelForSec(t));
        }
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
            if (typeof logMarkerAction === 'function') {
                logMarkerAction(
                    'range ' + tcLabelForSec(start) + ' – ' + tcLabelForSec(end),
                );
            } else {
                writeLog(
                    'Marker: range ' + tcLabelForSec(start) + ' – ' + tcLabelForSec(end),
                );
            }
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

            const rawGainDb =
                typeof getSegmentGainDb === 'function' ? getSegmentGainDb(track, i) : 0;
            let gainDb = rawGainDb;
            if (volM) {
                const markerGain = parseGainDbFromRegionVolumeMarkerComment(volM.comment);
                if (
                    Math.abs(markerGain) > 0.0005 ||
                    Math.abs(rawGainDb) < 0.0005
                ) {
                    gainDb = markerGain;
                }
            }
            const rawPitch =
                typeof getSegmentPitchSemitones === 'function'
                    ? getSegmentPitchSemitones(track, i)
                    : 0;
            let pitch = rawPitch;
            if (pitchM) {
                const markerPitch = parsePitchFromRegionPitchMarkerComment(pitchM.comment);
                if (markerPitch !== 0 || rawPitch === 0) {
                    pitch = markerPitch;
                }
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

    /** タイムライン区間 [gapStart, gapEnd) 削除に伴い、マーカー／コメント位置をリップル */
    function ripplePointSecForRemovedTimelineInterval(sec, gapStart, gapEnd, removeDur, eps) {
        if (!Number.isFinite(sec)) return sec;
        if (sec >= gapEnd - eps) return sec - removeDur;
        if (sec >= gapStart - eps) return null;
        return sec;
    }

    function rippleMarkersForRemovedTimelineInterval(gapStartSec, gapEndSec, opt) {
        if (!markerTimelineReady()) return false;
        const gapStart = Number(gapStartSec);
        const gapEnd = Number(gapEndSec);
        if (
            !Number.isFinite(gapStart) ||
            !Number.isFinite(gapEnd) ||
            !(gapEnd > gapStart + 1e-9)
        ) {
            return false;
        }
        const removeDur = gapEnd - gapStart;
        const eps = markerOneFrameSec();
        let changed = false;
        const kept = [];

        for (let i = 0; i < currentMarkers.length; i++) {
            const m = currentMarkers[i];
            if (m.type === 'range') {
                let start = Number(m.startSec);
                let end = Number(m.endSec);
                if (!Number.isFinite(start) || !Number.isFinite(end)) {
                    kept.push(m);
                    continue;
                }
                if (end <= gapStart + eps) {
                    kept.push(m);
                    continue;
                }
                if (start >= gapEnd - eps) {
                    start -= removeDur;
                    end -= removeDur;
                    m.startSec = clampMarkerSec(start, opt);
                    m.endSec = clampMarkerSec(end, opt);
                    collapseRangeMarkerToPointIfNarrow(m, { silent: true });
                    kept.push(m);
                    changed = true;
                    continue;
                }
                if (start >= gapStart - eps && end <= gapEnd + eps) {
                    if (activeMarkerId === m.id) activeMarkerId = null;
                    changed = true;
                    continue;
                }
                if (start < gapStart - eps && end > gapEnd - eps) {
                    end -= removeDur;
                    m.endSec = clampMarkerSec(end, opt);
                    collapseRangeMarkerToPointIfNarrow(m, { silent: true });
                    kept.push(m);
                    changed = true;
                    continue;
                }
                if (start < gapStart - eps && end <= gapEnd + eps) {
                    if (activeMarkerId === m.id) activeMarkerId = null;
                    changed = true;
                    continue;
                }
                if (start >= gapStart - eps && start < gapEnd && end > gapEnd - eps) {
                    start = gapStart;
                    end -= removeDur;
                    m.startSec = clampMarkerSec(start, opt);
                    m.endSec = clampMarkerSec(end, opt);
                    collapseRangeMarkerToPointIfNarrow(m, { silent: true });
                    kept.push(m);
                    changed = true;
                    continue;
                }
                kept.push(m);
            } else {
                const shifted = ripplePointSecForRemovedTimelineInterval(
                    Number(m.timeSec),
                    gapStart,
                    gapEnd,
                    removeDur,
                    eps,
                );
                if (shifted == null) {
                    if (activeMarkerId === m.id) activeMarkerId = null;
                    changed = true;
                    continue;
                }
                if (Math.abs(shifted - m.timeSec) > 1e-9) {
                    m.timeSec = clampMarkerSec(shifted, opt);
                    changed = true;
                }
                kept.push(m);
            }
        }

        if (pendingRangeStartSec != null && Number.isFinite(pendingRangeStartSec)) {
            const shifted = ripplePointSecForRemovedTimelineInterval(
                pendingRangeStartSec,
                gapStart,
                gapEnd,
                removeDur,
                eps,
            );
            if (shifted == null) {
                pendingRangeStartSec = null;
                changed = true;
            } else if (Math.abs(shifted - pendingRangeStartSec) > 1e-9) {
                pendingRangeStartSec = clampMarkerSec(shifted, opt);
                changed = true;
            }
        }

        if (!changed) return false;
        currentMarkers = kept;
        normalizeAllMarkerRanges({ silent: true });
        sortMarkersInPlace();
        saveMarkersToCache();
        if (!(opt && opt.skipPersist) && typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        if (!(opt && opt.skipUiRefresh)) {
            if (typeof refreshMarkerUi === 'function') refreshMarkerUi();
            if (typeof updateMarkerCommentOverlay === 'function') {
                updateMarkerCommentOverlay();
            }
            if (typeof renderSeekBarMarkers === 'function') renderSeekBarMarkers();
        }
        return true;
    }

    function markerSecInsideTimelineRange(sec, range, eps) {
        const t = Number(sec);
        if (!Number.isFinite(t)) return false;
        return t >= range.startSec - eps && t <= range.endSec + eps;
    }

    function markerRangeFullyInsideTimelineRange(m, range, eps) {
        if (!m || m.type !== 'range') return false;
        const start = Number(m.startSec);
        const end = Number.isFinite(m.endSec) ? Number(m.endSec) : start;
        if (!Number.isFinite(start)) return false;
        return start >= range.startSec - eps && end <= range.endSec + eps;
    }

    function mapMarkerSecAcrossSwapRanges(sec, fromRange, toRange) {
        const t = Number(sec);
        if (!Number.isFinite(t)) return t;
        const fromSpan = fromRange.endSec - fromRange.startSec;
        if (!(fromSpan > 1e-9)) return toRange.startSec;
        const u = (t - fromRange.startSec) / fromSpan;
        const toSpan = toRange.endSec - toRange.startSec;
        return toRange.startSec + u * toSpan;
    }

    function clampMarkerRangeToTimelineBounds(m, range) {
        if (!m || !range || !Number.isFinite(range.startSec) || !Number.isFinite(range.endSec)) {
            return;
        }
        const lo = range.startSec;
        const hi = range.endSec;
        if (m.type === 'point' && Number.isFinite(m.timeSec)) {
            m.timeSec = Math.max(lo, Math.min(m.timeSec, hi));
            return;
        }
        if (m.type === 'range' && Number.isFinite(m.startSec)) {
            m.startSec = Math.max(lo, Math.min(m.startSec, hi));
            if (Number.isFinite(m.endSec)) {
                m.endSec = Math.max(m.startSec, Math.min(m.endSec, hi));
            }
        }
    }

    function markerTimelineSpan(m) {
        if (!m || m.type === 'point') return 0;
        const start = Number(m.startSec);
        const end = Number.isFinite(m.endSec) ? Number(m.endSec) : start;
        if (!Number.isFinite(start)) return 0;
        return Math.max(0, end - start);
    }

    function markerOverlapWithBoundsRange(m, bounds) {
        if (!m || !bounds) return 0;
        const start =
            m.type === 'point'
                ? Number(m.timeSec)
                : Number.isFinite(m.startSec)
                  ? Number(m.startSec)
                  : NaN;
        const end =
            m.type === 'range' && Number.isFinite(m.endSec)
                ? Number(m.endSec)
                : start;
        if (!Number.isFinite(start)) return 0;
        const lo = Math.max(start, bounds.startSec);
        const hi = Math.min(end, bounds.endSec);
        return Math.max(0, hi - lo);
    }

    function markerNearlyAlignsWithBounds(m, bounds, eps) {
        if (!m || !bounds) return false;
        const e = eps > 0 ? eps : markerOneFrameSec();
        if (m.type === 'point') {
            return markerSecNearlyEqual(m.timeSec, bounds.startSec);
        }
        if (m.type === 'range') {
            return (
                markerSecNearlyEqual(m.startSec, bounds.startSec) &&
                markerSecNearlyEqual(m.endSec, bounds.endSec)
            );
        }
        return false;
    }

    function isUserTimelineMarker(m) {
        if (!m) return false;
        const comment = m.comment != null ? String(m.comment) : '';
        return (
            !isRegionVolumeMarkerComment(comment) &&
            !isRegionPitchMarkerComment(comment)
        );
    }

    function markerSortSec(m) {
        if (!m) return 0;
        if (m.type === 'point') return Number(m.timeSec);
        return Number.isFinite(m.startSec) ? Number(m.startSec) : 0;
    }

    function collectUserTimelineMarkersSorted() {
        const out = [];
        for (let i = 0; i < currentMarkers.length; i++) {
            const m = currentMarkers[i];
            if (isUserTimelineMarker(m)) out.push(m);
        }
        out.sort((a, b) => markerSortSec(a) - markerSortSec(b));
        return out;
    }

    function scoreMarkerSegmentOwnership(m, oldBounds, eps) {
        if (!m || !oldBounds) return -1;
        if (markerNearlyAlignsWithBounds(m, oldBounds, eps)) {
            return 1e6 + (oldBounds.endSec - oldBounds.startSec);
        }
        const overlap = markerOverlapWithBoundsRange(m, oldBounds);
        if (overlap <= eps) return -1;
        const segSpan = oldBounds.endSec - oldBounds.startSec;
        if (!(segSpan > eps)) return -1;
        const overlapRatio = overlap / segSpan;
        const mSpan = markerTimelineSpan(m);
        const mOverlapRatio =
            mSpan > eps ? overlap / mSpan : overlap / segSpan;
        if (overlapRatio >= 0.85 && mOverlapRatio >= 0.85) {
            return overlap + segSpan * 10;
        }
        if (overlapRatio >= 0.5 && mOverlapRatio >= 0.85) {
            return overlap;
        }
        return -1;
    }

    function scoreMarkerSegmentAssignment(m, oldBounds, eps) {
        return scoreMarkerSegmentOwnership(m, oldBounds, eps);
    }

    function findSegmentIndexContainingTimelineSec(sec, boundsMap, eps) {
        if (!boundsMap || !Number.isFinite(sec)) return -1;
        let best = -1;
        let bestSpan = Infinity;
        const keys = Object.keys(boundsMap);
        for (let ki = 0; ki < keys.length; ki++) {
            const segIdx = keys[ki] | 0;
            const bounds = boundsMap[segIdx];
            if (
                !bounds ||
                !Number.isFinite(bounds.startSec) ||
                !Number.isFinite(bounds.endSec)
            ) {
                continue;
            }
            if (sec < bounds.startSec - eps || sec > bounds.endSec + eps) continue;
            const span = bounds.endSec - bounds.startSec;
            if (span < bestSpan) {
                bestSpan = span;
                best = segIdx;
            }
        }
        return best;
    }

    function mapTimelineSecAcrossSegmentLayoutChange(sec, segIdx, beforeBoundsMap, track) {
        const oldBounds = beforeBoundsMap[segIdx];
        const newBounds = getSegmentRegionTimelineBounds(track.slot, segIdx);
        if (
            !oldBounds ||
            !newBounds ||
            !Number.isFinite(oldBounds.startSec) ||
            !Number.isFinite(oldBounds.endSec) ||
            !Number.isFinite(newBounds.startSec) ||
            !Number.isFinite(newBounds.endSec) ||
            boundsPairNearlyEqual(oldBounds, newBounds)
        ) {
            return sec;
        }
        return mapMarkerSecAcrossSwapRanges(sec, oldBounds, newBounds);
    }

    function applyMarkerEndpointLayoutMapping(m, beforeBoundsMap, track, opt) {
        if (!m || !beforeBoundsMap) return false;
        const eps = markerOneFrameSec();
        let changed = false;
        if (m.type === 'point' && Number.isFinite(m.timeSec)) {
            const segIdx = findSegmentIndexContainingTimelineSec(
                m.timeSec,
                beforeBoundsMap,
                eps,
            );
            if (segIdx < 0) return false;
            const next = clampMarkerSec(
                mapTimelineSecAcrossSegmentLayoutChange(
                    m.timeSec,
                    segIdx,
                    beforeBoundsMap,
                    track,
                ),
                opt,
            );
            if (Math.abs(next - m.timeSec) > 1e-9) {
                m.timeSec = next;
                changed = true;
            }
            return changed;
        }
        if (m.type !== 'range' || !Number.isFinite(m.startSec)) return false;
        const endSec = Number.isFinite(m.endSec) ? Number(m.endSec) : m.startSec;
        const startSeg = findSegmentIndexContainingTimelineSec(
            m.startSec,
            beforeBoundsMap,
            eps,
        );
        const endSeg = findSegmentIndexContainingTimelineSec(endSec, beforeBoundsMap, eps);
        if (startSeg >= 0) {
            const nextStart = clampMarkerSec(
                mapTimelineSecAcrossSegmentLayoutChange(
                    m.startSec,
                    startSeg,
                    beforeBoundsMap,
                    track,
                ),
                opt,
            );
            if (Math.abs(nextStart - m.startSec) > 1e-9) {
                m.startSec = nextStart;
                changed = true;
            }
        }
        if (endSeg >= 0) {
            const nextEnd = clampMarkerSec(
                mapTimelineSecAcrossSegmentLayoutChange(
                    endSec,
                    endSeg,
                    beforeBoundsMap,
                    track,
                ),
                opt,
            );
            if (Math.abs(nextEnd - m.endSec) > 1e-9) {
                m.endSec = nextEnd;
                changed = true;
            }
        }
        if (
            changed &&
            Number.isFinite(m.endSec) &&
            Number.isFinite(m.startSec) &&
            m.endSec < m.startSec
        ) {
            const lo = Math.min(m.startSec, m.endSec);
            const hi = Math.max(m.startSec, m.endSec);
            m.startSec = lo;
            m.endSec = hi;
        }
        return changed;
    }

    function applyMarkerRegionSwapMapping(m, fromRange, toRange, opt) {
        if (!m || !fromRange || !toRange) return false;
        const o = opt && typeof opt === 'object' ? opt : {};
        const clampToTarget = o.clampToTargetRange !== false;
        if (m.type === 'point') {
            const next = clampMarkerSec(
                mapMarkerSecAcrossSwapRanges(m.timeSec, fromRange, toRange),
                opt,
            );
            if (Math.abs(next - m.timeSec) <= 1e-9) return false;
            m.timeSec = next;
            if (clampToTarget) clampMarkerRangeToTimelineBounds(m, toRange);
            return true;
        }
        if (m.type !== 'range' || !Number.isFinite(m.startSec)) return false;
        const nextStart = clampMarkerSec(
            mapMarkerSecAcrossSwapRanges(m.startSec, fromRange, toRange),
            opt,
        );
        let changed = Math.abs(nextStart - m.startSec) > 1e-9;
        m.startSec = nextStart;
        if (Number.isFinite(m.endSec)) {
            const nextEnd = clampMarkerSec(
                mapMarkerSecAcrossSwapRanges(m.endSec, fromRange, toRange),
                opt,
            );
            if (Math.abs(nextEnd - m.endSec) > 1e-9) changed = true;
            m.endSec = nextEnd;
            if (!o.skipCollapse) {
                collapseRangeMarkerToPointIfNarrow(m, { silent: true });
            }
        }
        if (clampToTarget) clampMarkerRangeToTimelineBounds(m, toRange);
        return changed;
    }

    function markerFullyInsideSegmentBounds(m, bounds, eps) {
        if (!m || !bounds) return false;
        const range = { startSec: bounds.startSec, endSec: bounds.endSec };
        if (m.type === 'point') {
            return markerSecInsideTimelineRange(m.timeSec, range, eps);
        }
        if (m.type === 'range') {
            return markerRangeFullyInsideTimelineRange(m, range, eps);
        }
        return false;
    }

    /** リージョン再配置後 — ユーザーマーカーを旧 bounds 所属で新 bounds へ追従 */
    function relocateUserTimelineMarkersAfterRegionLayout(track, beforeBoundsMap, opt) {
        if (!markerTimelineReady() || !currentMarkers.length) return false;
        if (
            !track ||
            track.type !== 'extra' ||
            !Number.isFinite(track.slot) ||
            !beforeBoundsMap ||
            typeof getSegmentRegionTimelineBounds !== 'function'
        ) {
            return false;
        }
        const o = opt && typeof opt === 'object' ? opt : {};
        const eps = markerOneFrameSec();
        const segCount =
            typeof getTrackSegments === 'function' ? getTrackSegments(track).length : 0;
        if (!segCount) return false;

        const userMarkers = collectUserTimelineMarkersSorted();
        let changed = false;
        let moved = 0;
        const movedSegments = [];
        const assignedMarkerIds = new Set();
        const assignedSegmentIndices = new Set();
        const snapEps =
            typeof window.segmentBoundaryJoinEpsilonSec === 'function'
                ? window.segmentBoundaryJoinEpsilonSec() * 0.25
                : 1e-6;
        const boundsEps =
            typeof window.segmentBoundaryJoinEpsilonSec === 'function'
                ? window.segmentBoundaryJoinEpsilonSec()
                : snapEps;

        const assignments = [];
        for (let si = 0; si < segCount; si++) {
            const oldBounds = beforeBoundsMap[si];
            if (
                !oldBounds ||
                !Number.isFinite(oldBounds.startSec) ||
                !Number.isFinite(oldBounds.endSec)
            ) {
                continue;
            }
            for (let mi = 0; mi < userMarkers.length; mi++) {
                const m = userMarkers[mi];
                if (!m) continue;
                const score = scoreMarkerSegmentOwnership(m, oldBounds, eps);
                if (score < eps) continue;
                assignments.push({ si, m, score });
            }
        }
        assignments.sort((a, b) => b.score - a.score);

        for (let ai = 0; ai < assignments.length; ai++) {
            const { si, m } = assignments[ai];
            if (assignedMarkerIds.has(m.id) || assignedSegmentIndices.has(si)) continue;
            const newBounds = getSegmentRegionTimelineBounds(track.slot, si);
            if (
                !newBounds ||
                !Number.isFinite(newBounds.startSec) ||
                !Number.isFinite(newBounds.endSec)
            ) {
                continue;
            }
            assignedMarkerIds.add(m.id);
            assignedSegmentIndices.add(si);
            if (
                markerNearlyAlignsWithBounds(m, newBounds, snapEps) &&
                markerFullyInsideSegmentBounds(m, newBounds, boundsEps)
            ) {
                continue;
            }
            const beforeStart = m.type === 'point' ? m.timeSec : m.startSec;
            const beforeEnd = m.type === 'range' ? m.endSec : beforeStart;
            applyRegionMarkerBounds(m, newBounds.startSec, newBounds.endSec);
            const afterStart = m.type === 'point' ? m.timeSec : m.startSec;
            const afterEnd = m.type === 'range' ? m.endSec : afterStart;
            if (
                Math.abs(beforeStart - afterStart) > 1e-9 ||
                Math.abs(beforeEnd - afterEnd) > 1e-9
            ) {
                changed = true;
                moved += 1;
                if (movedSegments.indexOf(si) < 0) movedSegments.push(si);
            }
        }

        if (!changed) return false;
        persistMarkersAfterChange({
            silent: o.silent !== false,
            skipSessionFlush: !!o.skipSessionFlush,
        });
        if (typeof window.regionSwapDiagLog === 'function') {
            window.regionSwapDiagLog('marker/relayout', {
                moved,
                mode: 'region-ownership',
                segments: movedSegments.map((i) => (i | 0) + 1),
            });
        }
        return true;
    }

    /** リージョン再配置後 — 全ユーザーマーカーを所属 region bounds 内へクランプ */
    function findSegmentIndexForMarkerClamp(m, track, segCount, eps) {
        if (!m || !Number.isFinite(track.slot)) return -1;
        let bestSeg = -1;
        let bestScore = -1;
        const boundsEps =
            typeof window.segmentBoundaryJoinEpsilonSec === 'function'
                ? window.segmentBoundaryJoinEpsilonSec()
                : eps;
        for (let si = 0; si < segCount; si++) {
            const bounds = getSegmentRegionTimelineBounds(track.slot, si);
            if (
                !bounds ||
                !Number.isFinite(bounds.startSec) ||
                !Number.isFinite(bounds.endSec)
            ) {
                continue;
            }
            const overlap = markerOverlapWithBoundsRange(m, bounds);
            if (overlap <= boundsEps) continue;
            let score = overlap;
            if (markerNearlyAlignsWithBounds(m, bounds, boundsEps)) {
                score += 1e6;
            }
            const mSpan = markerTimelineSpan(m);
            const segSpan = bounds.endSec - bounds.startSec;
            if (mSpan > boundsEps && Math.abs(mSpan - segSpan) <= boundsEps * 4) {
                score += segSpan * 100;
            } else if (mSpan > boundsEps) {
                score += (overlap / mSpan) * segSpan;
            }
            if (score > bestScore) {
                bestScore = score;
                bestSeg = si;
            }
        }
        return bestSeg;
    }

    function clampUserTimelineMarkersToTrackRegions(track, opt) {
        if (!markerTimelineReady() || !currentMarkers.length) return false;
        if (
            !track ||
            track.type !== 'extra' ||
            !Number.isFinite(track.slot) ||
            typeof getSegmentRegionTimelineBounds !== 'function'
        ) {
            return false;
        }
        const o = opt && typeof opt === 'object' ? opt : {};
        const eps = markerOneFrameSec();
        let changed = false;
        const segCount =
            typeof window.getTrackSegments === 'function'
                ? window.getTrackSegments(track).length
                : 0;
        for (let mi = 0; mi < currentMarkers.length; mi++) {
            const m = currentMarkers[mi];
            if (!m) continue;
            const comment = m.comment != null ? String(m.comment) : '';
            if (
                isRegionVolumeMarkerComment(comment) ||
                isRegionPitchMarkerComment(comment)
            ) {
                continue;
            }
            let ownerSeg = -1;
            let ownerBounds = null;
            ownerSeg = findSegmentIndexForMarkerClamp(m, track, segCount, eps);
            if (ownerSeg >= 0) {
                ownerBounds = getSegmentRegionTimelineBounds(track.slot, ownerSeg);
            }
            if (ownerSeg < 0 || !ownerBounds) continue;
            const beforeStart = m.type === 'point' ? m.timeSec : m.startSec;
            const beforeEnd = m.type === 'range' ? m.endSec : beforeStart;
            const mSpan = markerTimelineSpan(m);
            const ownerSpan = ownerBounds.endSec - ownerBounds.startSec;
            const overlap = markerOverlapWithBoundsRange(m, ownerBounds);
            const boundsEps =
                typeof window.segmentBoundaryJoinEpsilonSec === 'function'
                    ? window.segmentBoundaryJoinEpsilonSec()
                    : eps;
            if (
                m.type === 'range' &&
                mSpan > boundsEps &&
                overlap / mSpan < 0.5
            ) {
                continue;
            }
            if (
                m.type === 'range' &&
                mSpan > eps &&
                Math.abs(mSpan - ownerSpan) <= boundsEps * 4
            ) {
                applyRegionMarkerBounds(
                    m,
                    ownerBounds.startSec,
                    ownerBounds.endSec,
                );
            } else {
                clampMarkerRangeToTimelineBounds(m, ownerBounds);
            }
            const afterStart = m.type === 'point' ? m.timeSec : m.startSec;
            const afterEnd = m.type === 'range' ? m.endSec : afterStart;
            if (
                Math.abs(beforeStart - afterStart) > 1e-9 ||
                Math.abs(beforeEnd - afterEnd) > 1e-9
            ) {
                changed = true;
            }
        }
        if (!changed) return false;
        persistMarkersAfterChange({ silent: o.silent !== false, skipSessionFlush: !!o.skipSessionFlush });
        if (typeof window.regionSwapDiagLog === 'function') {
            window.regionSwapDiagLog('marker/clamp-to-regions', { track: (track.slot | 0) + 1 });
        }
        return true;
    }

    window.captureTrackSegmentRegionBoundsMap = captureTrackSegmentRegionBoundsMap;
    window.relocateRegionVolumePitchMarkersAfterLayout =
        relocateRegionVolumePitchMarkersAfterLayout;
    window.syncSegmentVolumePitchAfterRegionLayout = syncSegmentVolumePitchAfterRegionLayout;
    window.rippleMarkersForRemovedTimelineInterval = rippleMarkersForRemovedTimelineInterval;
    window.relocateUserTimelineMarkersAfterRegionLayout =
        relocateUserTimelineMarkersAfterRegionLayout;
    window.clampUserTimelineMarkersToTrackRegions = clampUserTimelineMarkersToTrackRegions;

    /** リージョン入れ替え — 旧所属でペアに紐づく範囲マーカーの comment を交差スワップ */
    function swapUserTimelineMarkerCommentsForRegionPair(
        track,
        segmentIndexA,
        segmentIndexB,
        beforeBoundsMap,
        opt,
    ) {
        if (!markerTimelineReady() || !currentMarkers.length) return false;
        if (
            !beforeBoundsMap ||
            !Number.isFinite(segmentIndexA) ||
            !Number.isFinite(segmentIndexB)
        ) {
            return false;
        }
        const o = opt && typeof opt === 'object' ? opt : {};
        const eps = markerOneFrameSec();
        const segA = segmentIndexA | 0;
        const segB = segmentIndexB | 0;
        const userMarkers = collectUserTimelineMarkersSorted();
        const markersA = [];
        const markersB = [];
        const boundsA = beforeBoundsMap[segA];
        const boundsB = beforeBoundsMap[segB];
        if (!boundsA || !boundsB) return false;

        for (let mi = 0; mi < userMarkers.length; mi++) {
            const m = userMarkers[mi];
            if (!m) continue;
            if (scoreMarkerSegmentOwnership(m, boundsA, eps) >= eps) markersA.push(m);
            if (scoreMarkerSegmentOwnership(m, boundsB, eps) >= eps) markersB.push(m);
        }
        const n = Math.min(markersA.length, markersB.length);
        if (n <= 0) return false;

        let changed = false;
        for (let i = 0; i < n; i++) {
            const tmp = markersA[i].comment;
            markersA[i].comment = markersB[i].comment;
            markersB[i].comment = tmp;
            changed = true;
        }
        if (!changed) return false;
        persistMarkersAfterChange({
            silent: o.silent !== false,
            skipSessionFlush: !!o.skipSessionFlush,
        });
        if (typeof window.regionSwapDiagLog === 'function') {
            window.regionSwapDiagLog('marker/swap-comments', {
                track: (track.slot | 0) + 1,
                regionA: segA + 1,
                regionB: segB + 1,
                count: n,
            });
        }
        return true;
    }

    window.swapUserTimelineMarkerCommentsForRegionPair =
        swapUserTimelineMarkerCommentsForRegionPair;

    function completePendingRangeAtCurrentTime(opt) {
        if (!markerTimelineReady() || pendingRangeStartSec == null) return;
        const start = pendingRangeStartSec;
        pendingRangeStartSec = null;
        updateMarkerRangeHint();
        const o = opt && typeof opt === 'object' ? opt : {};
        const end = Number.isFinite(o.endSec) ? o.endSec : currentTransportSec();
        addRangeMarkerBetweenSecs(start, end);
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
            if (typeof logMarkerAction === 'function') {
                logMarkerAction('range collapsed to point at ' + tcLabelForSec(t));
            } else {
                writeLog('Marker: range collapsed to point at ' + tcLabelForSec(t));
            }
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
        if (typeof logMarkerAction === 'function') {
            logMarkerAction('Out TC cleared → point at ' + tcLabelForSec(t));
        } else {
            writeLog('Marker: Out TC cleared -> point at ' + tcLabelForSec(t));
        }
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
        if (typeof logMarkerAction === 'function') {
            logMarkerAction('TC updated ' + markerTimeLabel(m));
        } else {
            writeLog('Marker: TC updated ' + markerTimeLabel(m));
        }
        flashSeekHint('Marker TC', tcLabelForSec(t));
        return true;
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
        } else if (
            typeof isMarkerPanelInteractionActive === 'function' &&
            isMarkerPanelInteractionActive() &&
            activeMarkerId
        ) {
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
        const removed = currentMarkers[idx];
        currentMarkers = currentMarkers.filter((m) => m.id !== id);
        if (activeMarkerId === id) activeMarkerId = null;
        persistMarkersAfterChange();
        const kind = removed && removed.type === 'range' ? 'range' : 'point';
        const tc =
            typeof markerTimeLabel === 'function'
                ? markerTimeLabel(removed)
                : tcLabelForSec(removed.timeSec || removed.startSec);
        let msg = 'removed ' + kind + ' at ' + tc;
        if (removed && removed.comment && String(removed.comment).trim()) {
            msg += ' — "' + String(removed.comment).trim() + '"';
        }
        if (typeof logMarkerAction === 'function') {
            logMarkerAction(msg);
        } else {
            writeLog('Marker: ' + msg);
        }
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

