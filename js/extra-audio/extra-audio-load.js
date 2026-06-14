/**
 * extra-audio-load.js — ファイル読込・ドロップ割当。
 */
    async function loadExtraTrackFile(slot, file, opt) {
        if (slot < 0 || slot >= EXTRA_TRACK_COUNT || !file) return;
        if (typeof clearRegionUndoStack === 'function') {
            clearRegionUndoStack();
        }
        setExtraTrackLaneUiOpen(slot, true);
        const tr = extraTrackBySlot(slot);
        const gen = ++tr.loadGen;
        const replacingTrack = !(opt && opt.addClip);
        if (replacingTrack) {
            tr.playbackRegions = { active: false, segments: [], headPadSec: 0 };
            delete tr.region;
            if (typeof bumpRegionPersistEpoch === 'function') {
                bumpRegionPersistEpoch(slot);
            }
            if (
                !(opt && opt.fromSessionRestore) &&
                typeof setPendingPlaybackRegionRestore === 'function'
            ) {
                setPendingPlaybackRegionRestore(null);
            }
        }
        const n = file.size || 0;
        if (n > EXTRA_AUDIO_DECODE_MAX_BYTES) {
            const mb = Math.round((n / (1024 * 1024)) * 10) / 10;
            const limitMb = Math.round(EXTRA_AUDIO_DECODE_MAX_BYTES / (1024 * 1024));
            writeLog('Extra audio ' + (slot + 1) + ': file too large — ' + mb + ' MB');
            if (typeof showAppAlert === 'function') {
                showAppAlert(
                    msg('dialog.extraAudio.cannotLoadTitle'),
                    msg('dialog.extraAudio.tooLargeBody', { mb, limitMb }),
                    { log: false },
                );
            }
            return;
        }
        const addClipEarly = !!(opt && opt.addClip) && isExtraTrackLoaded(slot);
        setExtraTrackStatus(slot, 'Decoding…');
        if (typeof syncExtraTrackWaveformLoading === 'function') {
            syncExtraTrackWaveformLoading(slot);
        }
        let buffer = null;
        let fileArrayBuffer = null;
        try {
            const ab = await file.arrayBuffer();
            fileArrayBuffer = ab;
            if (gen !== tr.loadGen) {
                if (opt && opt.fromSessionRestore) {
                    writeLog('Extra audio ' + (slot + 1) + ': restore aborted (superseded)');
                }
                setExtraTrackStatus(slot, '');
                return;
            }
            if (!ab || ab.byteLength < 1) {
                throw new Error('empty file');
            }
            if (!addClipEarly) {
                cacheExtraTrackPersistBlob(tr, file, ab);
            }
            if (typeof detailLog === 'function') {
                detailLog(
                    'ExAudio',
                    formatExTrack(slot) +
                        ' decoding "' +
                        (file.name || 'audio') +
                        '" (' +
                        Math.round(ab.byteLength / 1024) +
                        ' KB)…',
                );
            } else {
                writeLog(
                    'Extra audio ' +
                        (slot + 1) +
                        ': decoding ' +
                        (file.name || 'audio') +
                        ' (' +
                        Math.round(ab.byteLength / 1024) +
                        ' KB)…',
                );
            }
            let decodeProgressTimer = 0;
            decodeProgressTimer = setInterval(() => {
                writeLog('Extra audio ' + (slot + 1) + ': still decoding…');
            }, 4000);
            try {
                buffer = await decodeExtraFileArrayBuffer(ab);
            } finally {
                if (decodeProgressTimer) clearInterval(decodeProgressTimer);
            }
            if (gen !== tr.loadGen) {
                if (opt && opt.fromSessionRestore) {
                    writeLog('Extra audio ' + (slot + 1) + ': restore aborted after decode');
                }
                setExtraTrackStatus(slot, '');
                return;
            }
            if (!buffer || !(buffer.duration > 0)) {
                throw new Error('decode returned no audio');
            }
        } catch (err) {
            if (gen !== tr.loadGen) {
                writeLog(
                    'Extra audio ' +
                        (slot + 1) +
                        ': decode aborted (superseded) — ' +
                        (err && err.message ? err.message : String(err)),
                );
                return;
            }
            tr.file = null;
            tr.buffer = null;
            tr.peaks = null;
            tr.peakPyramid = null;
            tr.viewportPeaks = null;
            tr.persistBlob = null;
            setExtraTrackLoaded(slot, false, { skipLayoutRefresh: true });
            setExtraTrackStatus(slot, 'Could not decode');
            const uiDecodeFail = getExtraUi(slot);
            if (typeof clearWaveformTrackLkfs === 'function' && uiDecodeFail && uiDecodeFail.track) {
                clearWaveformTrackLkfs(uiDecodeFail.track);
            }
            refreshExtraTrackUi(slot);
            if (typeof syncExtraTrackWaveformLoading === 'function') {
                syncExtraTrackWaveformLoading(slot);
            }
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
            writeLog(
                'Extra audio ' +
                    (slot + 1) +
                    ': could not decode — ' +
                    (err && err.message ? err.message : String(err))
            );
            return;
        }

        const addClip = addClipEarly;
        const clipId =
            opt && opt.preservedClipId
                ? String(opt.preservedClipId)
                : addClip
                  ? newExtraClipId()
                  : 'main';
        ensureExtraTrackClips(tr);
        if (addClip) {
            const clipEntry = {
                id: clipId,
                file,
                buffer,
                peaks: null,
                persistBlob: null,
                name: file.name || 'audio',
            };
            cacheExtraClipPersistBlob(clipEntry, file, ab);
            tr.clips.push(clipEntry);
        } else {
            tr.clips = [
                {
                    id: 'main',
                    file,
                    buffer,
                    peaks: null,
                    persistBlob: tr.persistBlob,
                    name: file.name || 'audio',
                },
            ];
            tr.segmentSources = {};
            tr.restoreDurationHint = 0;
            if (opt && opt.fromSessionRestore && Number.isFinite(opt.timelineStartSec)) {
                tr.timelineStartSec = clampExtraTrackTimelineStartSec(slot, opt.timelineStartSec);
            } else if (!(opt && opt.fromSessionRestore)) {
                tr.timelineStartSec = 0;
            }
        }
        tr.file = file;
        tr.buffer = buffer;
        syncExtraTrackPrimaryFromFirstClip(tr);
        const clipRef = getExtraTrackClip(tr, clipId);
        if (clipRef) {
            clipRef.buffer = buffer;
            clipRef.file = file;
            if (typeof bindClipBackupOnLoad === 'function') {
                bindClipBackupOnLoad(clipRef, buffer, {
                    backupBuffer: opt && opt.backupBuffer,
                    backupPersistBlob: opt && opt.backupPersistBlob,
                    stretchedPersist: !!(opt && opt.stretchedPersist),
                });
            } else {
                clipRef.backupBuffer = buffer;
            }
        }
        if (
            opt &&
            opt.fromSessionRestore &&
            opt.backupPersistBlob &&
            opt.backupPersistBlob.size > 0 &&
            clipRef
        ) {
            try {
                const backupAb = await opt.backupPersistBlob.arrayBuffer();
                const backupBuffer = await decodeExtraFileArrayBuffer(backupAb);
                if (backupBuffer && backupBuffer.duration > 0) {
                    bindClipBackupOnLoad(clipRef, buffer, {
                        backupBuffer,
                        backupPersistBlob: opt.backupPersistBlob,
                        stretchedPersist: true,
                    });
                }
            } catch (backupErr) {
                writeLog(
                    'Extra audio ' +
                        (slot + 1) +
                        ': backup decode failed — ' +
                        (backupErr && backupErr.message
                            ? backupErr.message
                            : String(backupErr)),
                );
            }
        }
        if (
            !(opt && opt.fromSessionRestore) &&
            typeof parseMeterSpec === 'function' &&
            typeof isTempoStretchActiveForSpec === 'function' &&
            typeof applyTempoStretchForMeterSpec === 'function' &&
            typeof getCommittedMusicalGridMeterText === 'function' &&
            !(typeof isTempoStretchApplySkipped === 'function' && isTempoStretchApplySkipped())
        ) {
            const meterSpec = parseMeterSpec(getCommittedMusicalGridMeterText());
            if (meterSpec && isTempoStretchActiveForSpec(meterSpec)) {
                const prevSpec = {
                    mode: meterSpec.mode,
                    entries: meterSpec.entries,
                    stretchDelta: 0,
                };
                await applyTempoStretchForMeterSpec(meterSpec, {
                    prevSpec,
                    force: true,
                });
                buffer = tr.buffer;
                if (clipRef) clipRef.buffer = buffer;
            }
        }
        if (opt && opt.fromSessionRestore) {
            const track = { type: 'extra', slot };
            if (
                Array.isArray(opt.regionSegments) &&
                opt.regionSegments.length &&
                typeof applyPlaybackRegionSegmentsRaw === 'function'
            ) {
                applyPlaybackRegionSegmentsRaw(track, opt.regionSegments, {
                    skipOverlay: true,
                    regionHeadPadSec: opt.regionHeadPadSec,
                    regionTimelineInSec: opt.regionTimelineInSec,
                    regionLeadPadSec: opt.regionLeadPadSec,
                });
            } else if (
                Number.isFinite(opt.regionSourceInSec) &&
                Number.isFinite(opt.regionSourceOutSec) &&
                typeof applyPlaybackRegionSegmentsRaw === 'function'
            ) {
                applyPlaybackRegionSegmentsRaw(
                    track,
                    [
                        {
                            sourceInSec: opt.regionSourceInSec,
                            sourceOutSec: opt.regionSourceOutSec,
                        },
                    ],
                    {
                        skipOverlay: true,
                        regionHeadPadSec: opt.regionHeadPadSec,
                        regionTimelineInSec: opt.regionTimelineInSec,
                        regionLeadPadSec: opt.regionLeadPadSec,
                    },
                );
            }
        }
        if (!(opt && opt.fromSessionRestore)) {
            tr.muted = false;
            tr.solo = false;
            tr.volLinear = 1;
        }

        try {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            if (gen !== tr.loadGen) {
                writeLog('Extra audio ' + (slot + 1) + ': load superseded (skipped waveform)');
                tr.file = null;
                tr.buffer = null;
                tr.peaks = null;
                tr.persistBlob = null;
                setExtraTrackStatus(slot, '');
                const uiAbort = getExtraUi(slot);
                if (typeof clearWaveformTrackLkfs === 'function' && uiAbort && uiAbort.track) {
                    clearWaveformTrackLkfs(uiAbort.track);
                }
                return;
            }
            const ui = getExtraUi(slot);
            const sized = ui && ui.track ? syncExtraCanvasSize(ui) : null;
            const barCount = sized ? sized.barCount : 1200;
            tr.peakPyramid = null;
            const peaks = peaksFromBuffer(buffer, Math.min(512, barCount));
            tr.peaks = peaks;
            if (clipRef) clipRef.peaks = peaks;
            scheduleExtraTrackPeakPyramidBuild(slot, buffer, barCount);
            if (!(opt && opt.fromSessionRestore)) {
                if (
                    addClip &&
                    typeof addExtraTrackRegionForClip === 'function'
                ) {
                    const place =
                        opt && Number.isFinite(opt.placeAtTransportSec)
                            ? opt.placeAtTransportSec
                            : typeof getTransportSec === 'function'
                              ? getTransportSec()
                              : 0;
                    addExtraTrackRegionForClip(slot, clipId, buffer.duration, place);
                } else if (typeof ensureDefaultTrackRegion === 'function') {
                    ensureDefaultTrackRegion({ type: 'extra', slot }, { silent: true });
                }
            }
            if (
                !(opt && opt.fromSessionRestore) &&
                fileArrayBuffer &&
                typeof importWavMarkersOnWaveformLoad === 'function'
            ) {
                let timelineOffsetSec = 0;
                if (typeof getTrackSegments === 'function') {
                    const trackRef = { type: 'extra', slot };
                    const segs = getTrackSegments(trackRef);
                    for (let si = 0; si < segs.length; si++) {
                        const seg = segs[si];
                        if (clipId && seg.clipId !== clipId) continue;
                        const sourceIn = Number(seg.sourceInSec) || 0;
                        let timelineIn = Number(seg.timelineStartSec);
                        if (
                            !Number.isFinite(timelineIn) &&
                            typeof getSegmentRegionTimelineIn === 'function'
                        ) {
                            timelineIn = getSegmentRegionTimelineIn(trackRef, si);
                        }
                        if (Number.isFinite(timelineIn)) {
                            timelineOffsetSec = timelineIn - sourceIn;
                            break;
                        }
                    }
                }
                importWavMarkersOnWaveformLoad(fileArrayBuffer, {
                    timelineOffsetSec,
                    fileDurationSec: buffer.duration,
                    logLabel: 'Extra audio ' + (slot + 1),
                });
            }
            const ch = buffer.numberOfChannels;
            const rate = buffer.sampleRate | 0;
            setExtraTrackStatus(
                slot,
                ch +
                    ' ch · ' +
                    (rate ? rate + ' Hz' : '') +
                    ' · ' +
                    buffer.duration.toFixed(2) +
                    ' s'
            );
            const trackEl = ui && ui.track ? ui.track : null;
            if (typeof scheduleWaveformTrackLkfsMeasure === 'function' && trackEl) {
                void scheduleWaveformTrackLkfsMeasure(trackEl, buffer);
            }
            setExtraTrackLoaded(slot, true, { skipLayoutRefresh: true });
            const restoreLoad = !!(opt && opt.fromSessionRestore);
            refreshExtraTrackUi(slot, {
                skipRegionOverlay: restoreLoad,
                skipDraw: restoreLoad,
            });
            if (restoreLoad) {
                applyExtraSlotMixFromSessionRestore(slot);
            } else {
                removeExtraSlotFromSessionMixRestore(slot);
                applyExtraTrackLaneGain(slot);
                refreshReviewMixUi();
            }
            const durLabel =
                buffer && buffer.duration > 0
                    ? typeof formatActionTc === 'function'
                        ? formatActionTc(buffer.duration)
                        : buffer.duration.toFixed(1) + ' s'
                    : '';
            const loadMsg =
                'loaded "' +
                (file.name || 'audio') +
                '" on ' +
                formatExTrack(slot) +
                (durLabel ? ' (' + durLabel + ')' : '') +
                (restoreLoad ? ', session restore' : ', synced to video head');
            if (typeof logExAudioAction === 'function') {
                logExAudioAction(loadMsg);
            } else {
                writeLog(
                    'Extra audio ' +
                        (slot + 1) +
                        ': loaded ' +
                        file.name +
                        (restoreLoad ? '' : ' (synced to video head)'),
                );
            }
            syncExtraAudioToTransport();
            if (!restoreLoad && typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
            if (!restoreLoad) {
                schedulePersistExtraTrackSlot(slot);
            }
            if (restoreLoad) {
                scheduleExtraTrackWaveformRedraw(slot);
            } else {
                scheduleExtraTrackWaveformRedraw(slot, { notifyMaster: true });
            }
            if (typeof syncExtraTrackWaveformLoading === 'function') {
                syncExtraTrackWaveformLoading(slot);
            }
            if (typeof refreshExportMediaOptionsUi === 'function') {
                refreshExportMediaOptionsUi();
            }
            if (typeof updateControlsEnabled === 'function') {
                updateControlsEnabled();
            }
        } catch (err) {
            if (gen !== tr.loadGen) return;
            writeLog(
                'Extra audio ' +
                    (slot + 1) +
                    ': loaded but waveform not drawn — ' +
                    (err && err.message ? err.message : String(err))
            );
            refreshExtraTrackUi(slot);
            scheduleExtraTrackWaveformRedraw(slot);
            if (typeof syncExtraTrackWaveformLoading === 'function') {
                syncExtraTrackWaveformLoading(slot);
            }
            if (typeof updateControlsEnabled === 'function') {
                updateControlsEnabled();
            }
        }
    }


    function firstEmptyExtraSlot() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackLoaded(i)) return i;
        }
        return -1;
    }

    function assignExtraAudioFiles(files, startSlot, opt) {
        const audios = pickAudioFiles(files);
        if (audios.length === 0) {
            writeLog('Extra audio: no playable audio in selection');
            return;
        }
        const oneFilePerTrack = !!(opt && opt.oneFilePerTrack);
        let slot =
            typeof startSlot === 'number' && startSlot >= 0
                ? startSlot
                : firstEmptyExtraSlot();
        if (slot < 0 && !(opt && opt.addClip)) {
            writeLog('Extra audio: all Ex slots are full — drop ignored');
            return;
        }
        if (slot < 0) slot = 0;
        let ignored = 0;
        for (let i = 0; i < audios.length; i++) {
            if (oneFilePerTrack || !(opt && opt.addClip)) {
                while (slot < EXTRA_TRACK_COUNT && isExtraTrackLoaded(slot)) {
                    slot += 1;
                }
            }
            if (slot < 0 || slot >= EXTRA_TRACK_COUNT) {
                ignored += audios.length - i;
                break;
            }
            const addClip =
                !oneFilePerTrack && (!!(opt && opt.addClip) || isExtraTrackLoaded(slot));
            setExtraTrackLaneUiOpen(slot, true, { deferLayout: true });
            void loadExtraTrackFile(slot, audios[i], {
                addClip,
                placeAtTransportSec:
                    typeof getTransportSec === 'function' ? getTransportSec() : 0,
            });
            if (!addClip) slot += 1;
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        if (ignored > 0) {
            writeLog(
                'Extra audio: all Ex slots are full — ' +
                    ignored +
                    ' file(s) ignored',
            );
        }
    }

    function extraSlotFromDropTarget(target) {
        if (!target || !target.closest) return -1;
        const lane0 = target.closest('#extraAudioLane0, #extraAudioMeta0');
        if (lane0) return 0;
        const lane1 = target.closest('#extraAudioLane1, #extraAudioMeta1');
        if (lane1) return 1;
        const lane2 = target.closest('#extraAudioLane2, #extraAudioMeta2');
        if (lane2) return 2;
        return -1;
    }

    function isVideoAudioLaneDropTarget(target) {
        if (!target || !target.closest) return false;
        return !!target.closest(
            '#audioWaveformLaneVideo, #audioWaveformTrack, #audioWaveformPanel',
        );
    }

    function videoAudioLaneOccupiedForExtraDrop() {
        if (typeof videoReady !== 'function' || !videoReady()) return false;
        if (typeof isVideoAudioLaneShown === 'function' && isVideoAudioLaneShown()) {
            return true;
        }
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (isExtraTrackLoaded(i)) return true;
        }
        return false;
    }

    function hasAnyExtraTrackLoaded() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (isExtraTrackLoaded(i)) return true;
        }
        return false;
    }


    /** デコード前の peaks プレビュー（restoreDurationHint）もタイムライン有効とみなす */
    function hasAnyExtraTrackTimelineContent() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (isExtraTrackLoaded(i)) return true;
            const tr = extraTrackBySlot(i);
            if (!tr || !tr.peaks || !tr.peaks.length) continue;
            if (tr.buffer && tr.buffer.duration > 0) return true;
            const hint = Number(tr.restoreDurationHint);
            if (Number.isFinite(hint) && hint > 0) return true;
        }
        return false;
    }


    /** 波形エリア全体へのドロップ（Ex レーン指定なし）— 複数ファイルはトラックごとに割当 */
    function isBulkOneFilePerTrackDropTarget(target) {
        if (!target || !target.closest) return false;
        if (extraSlotFromDropTarget(target) >= 0) return false;
        return !!target.closest(
            '#audioWaveformComposite, #audioWaveformLanesTracks, #audioWaveformLanesInner, #audioWaveformLaneVideo, #audioWaveformTrack, #audioWaveformPanel',
        );
    }

    function resolveExtraSlotForAudioDrop(target) {
        const hit = extraSlotFromDropTarget(target);
        if (hit >= 0) {
            if (!isExtraTrackLoaded(hit)) return { slot: hit, addClip: false };
            return { slot: hit, addClip: true };
        }
        if (isVideoAudioLaneDropTarget(target) && videoAudioLaneOccupiedForExtraDrop()) {
            const next = firstEmptyExtraSlot();
            if (next < 0) return { slot: -1, addClip: false };
            writeLog(
                'Extra audio: Video Audio lane already in use — loading into Ex ' +
                    (next + 1),
            );
            return { slot: next, addClip: false };
        }
        const next = firstEmptyExtraSlot();
        return { slot: next, addClip: false };
    }

    function assignExtraAudioFilesFromDrop(files, dropTarget) {
        const audios = pickAudioFiles(files);
        if (audios.length === 0) {
            writeLog('Extra audio: no playable audio in selection');
            return;
        }
        if (isBulkOneFilePerTrackDropTarget(dropTarget)) {
            const start = firstEmptyExtraSlot();
            if (start < 0) {
                writeLog('Extra audio: all Ex slots are full — drop ignored');
                return;
            }
            writeLog(
                'Extra audio: waveform area — ' +
                    audios.length +
                    ' file(s) → one track each',
            );
            assignExtraAudioFiles(audios, start, { oneFilePerTrack: true });
            return;
        }
        const resolved = resolveExtraSlotForAudioDrop(dropTarget);
        if (resolved.slot < 0) {
            writeLog('Extra audio: all Ex slots are full — drop ignored');
            return;
        }
        if (resolved.addClip) {
            writeLog(
                'Extra audio: adding clip to Ex ' + (resolved.slot + 1) + ' lane',
            );
        }
        assignExtraAudioFiles(audios, resolved.slot, { addClip: resolved.addClip });
    }


