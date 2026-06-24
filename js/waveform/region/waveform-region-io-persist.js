/**
 * waveform-region-io-persist.js — セッション復元・永続化
 */
    function applyPlaybackRegionSegmentsRaw(track, segments, opt) {
        if (!isExtraTrackRef(track) || !Array.isArray(segments) || !segments.length) {
            return false;
        }
        const state = getPlaybackRegionsState(track);
        if (!state) return false;
        state.segments = segments.map((seg) => {
            const copy =
                seg && typeof seg === 'object' ? Object.assign({}, seg) : { sourceInSec: 0 };
            if (!copy.id) copy.id = newRegionId();
            return copy;
        });
        state.active = true;
        if (typeof extraTrackBySlot === 'function') {
            const tr = extraTrackBySlot(track.slot);
            if (tr) tr.viewportPeaks = null;
        }
        if (opt && Number.isFinite(opt.regionHeadPadSec)) {
            state.headPadSec = Math.max(0, opt.regionHeadPadSec);
        }
        if (opt && Number.isFinite(opt.regionTimelineInSec) && state.segments[0]) {
            state.segments[0].regionTimelineInSec = opt.regionTimelineInSec;
        }
        if (opt && Number.isFinite(opt.regionLeadPadSec) && opt.regionLeadPadSec > 0 && state.segments[0]) {
            state.segments[0].regionLeadPadSec = Math.max(0, opt.regionLeadPadSec);
        }
        if (typeof syncTrackRegionHeadStateFromFirstSegment === 'function') {
            syncTrackRegionHeadStateFromFirstSegment(track);
        }
        if (!(opt && opt.skipOverlay) && typeof updateTrackRegionOverlays === 'function') {
            updateTrackRegionOverlays(track);
        }
        return true;
    }

    /** Ex 1 本のデコード完了後: 生セグメントを正規化して波形へ反映 */
    function finalizePlaybackRegionsForExtraSlot(slot) {
        if (!(slot >= 0) || !isExtraTrackRef({ type: 'extra', slot })) return false;
        const track = { type: 'extra', slot };
        const diagEx = { ex: slot + 1 };
        const diagRun =
            typeof window.regionRestoreDiagRunStep === 'function'
                ? window.regionRestoreDiagRunStep
                : function (_label, fn) {
                      return fn();
                  };
        const diagLog =
            typeof window.regionRestoreDiagLog === 'function'
                ? window.regionRestoreDiagLog
                : function () {};
        const diagSummarize =
            typeof window.regionRestoreDiagSummarizeTrack === 'function'
                ? window.regionRestoreDiagSummarizeTrack
                : function () {
                      return {};
                  };

        const state = getPlaybackRegionsState(track);
        if (!state || !state.active || !state.segments || !state.segments.length) {
            diagLog('finalize/skip-empty', diagEx);
            return false;
        }

        diagLog('finalize/begin', Object.assign({}, diagEx, diagSummarize(track)));

        const raw = state.segments.map((s) => Object.assign({}, s));
        const hasTimelineSlots =
            Array.isArray(state.timelineSlots) && state.timelineSlots.length > 0;
        const usableTimelineSlots =
            hasTimelineSlots &&
            typeof window.persistedTimelineSlotsAreUsable === 'function' &&
            window.persistedTimelineSlotsAreUsable(state.timelineSlots);

        diagLog('finalize/prep', {
            ex: slot + 1,
            rawSegCount: raw.length,
            usableTimelineSlots,
            geometryOnly: usableTimelineSlots,
        });

        const ok = diagRun(
            'finalize/setTrackSegments',
            () =>
                setTrackSegments(track, raw, {
                    silent: true,
                    skipUndo: true,
                    keepPendingRestore: true,
                    geometryOnly: usableTimelineSlots,
                    deferRedraw: true,
                    skipMusicalRefresh: true,
                    skipOverlay: true,
                }),
            diagEx,
        );
        if (!ok && raw.length) {
            state.segments = raw;
            state.active = true;
            diagLog('finalize/setTrackSegments-fallback-raw', diagEx);
        }

        diagRun(
            'finalize/refreshMusicalSlots',
            () => {
                if (typeof window.refreshTrackTimelineMusicalSlots === 'function') {
                    window.refreshTrackTimelineMusicalSlots(track, {
                        preserveStored: usableTimelineSlots,
                    });
                }
            },
            diagEx,
        );

        const restoreBusy =
            typeof isSessionRestoreBusy === 'function' && isSessionRestoreBusy();
        if (!restoreBusy) {
            diagRun(
                'finalize/updateOverlays',
                () => updateTrackRegionOverlays(track),
                diagEx,
            );
        } else {
            diagLog('finalize/skip-overlay-deferred', diagEx);
        }

        if (!restoreBusy) {
            diagRun(
                'finalize/redrawWaveform',
                () => redrawAfterRegionChange(slot, { invalidatePeakCache: true }),
                diagEx,
            );
        } else {
            diagLog('finalize/skip-redraw-deferred', diagEx);
        }

        const segCount = diagRun(
            'finalize/getTrackSegments',
            () => getTrackSegments(track).length,
            diagEx,
        );

        diagLog('finalize/done', Object.assign({}, diagEx, { segCount: segCount || raw.length }));
        return !!(segCount || raw.length);
    }

    function finalizeAllPlaybackRegionsAfterSessionRestore() {
        if (typeof window.regionRestoreDiagLog === 'function') {
            window.regionRestoreDiagLog('finalizeAll/begin', {
                extraCount: getExtraTrackCount(),
            });
        }
        const n = getExtraTrackCount();
        let any = false;
        for (let i = 0; i < n; i++) {
            if (typeof isExtraTrackLoaded === 'function' && !isExtraTrackLoaded(i)) {
                if (typeof window.regionRestoreDiagLog === 'function') {
                    window.regionRestoreDiagLog('finalizeAll/skip-not-loaded', { ex: i + 1 });
                }
                continue;
            }
            try {
                if (finalizePlaybackRegionsForExtraSlot(i)) any = true;
            } catch (err) {
                writeLog(
                    'Extra audio ' +
                        (i + 1) +
                        ': region finalize incomplete — ' +
                        (err && err.message ? err.message : String(err)),
                );
            }
        }
        if (typeof window.regionRestoreDiagLog === 'function') {
            window.regionRestoreDiagLog('finalizeAll/done', { any });
        }
        return any;
    }

    function buildPlaybackRegionPersistEntryForTrack(track) {
        if (!isPlaybackRegionTrackRef(track)) return null;
        const segments = getTrackSegments(track);
        if (!segments.length) return null;
        const headPad = getHeadPadSec(track);
        const state = getPlaybackRegionsState(track);
        const regionIn =
            state && Number.isFinite(state.regionTimelineInSec)
                ? state.regionTimelineInSec
                : typeof getSegmentRegionTimelineIn === 'function'
                  ? getSegmentRegionTimelineIn(track, 0)
                  : undefined;
        const regionLead =
            state && Number.isFinite(state.regionLeadPadSec) && state.regionLeadPadSec > 0
                ? state.regionLeadPadSec
                : typeof getSegmentRegionLeadPadSec === 'function' &&
                    getSegmentRegionLeadPadSec(track, 0) > 0.00001
                  ? getSegmentRegionLeadPadSec(track, 0)
                  : undefined;
        const entry = {
            headPadSec: headPad > 0 ? headPad : undefined,
            regionTimelineInSec: regionIn,
            regionLeadPadSec: regionLead,
            segments: segments.map((seg, segIndex) => {
                const raw = getRawSegmentEntry(track, segIndex);
                const out = {
                    id: seg.id,
                    clipId: seg.clipId,
                    sourceInSec: seg.sourceInSec,
                    sourceOutSec: seg.sourceOutSec,
                };
                const timelineStart =
                    raw && Number.isFinite(raw.timelineStartSec)
                        ? raw.timelineStartSec
                        : typeof getSegmentTimelineStart === 'function'
                          ? getSegmentTimelineStart(track, segIndex)
                          : undefined;
                if (Number.isFinite(timelineStart)) {
                    out.timelineStartSec = timelineStart;
                }
                const segRegionIn =
                    raw && Number.isFinite(raw.regionTimelineInSec)
                        ? raw.regionTimelineInSec
                        : typeof getSegmentRegionTimelineIn === 'function'
                          ? getSegmentRegionTimelineIn(track, segIndex)
                          : undefined;
                if (Number.isFinite(segRegionIn)) {
                    out.regionTimelineInSec = segRegionIn;
                }
                const segLeadPad =
                    typeof getSegmentRegionLeadPadSec === 'function'
                        ? getSegmentRegionLeadPadSec(track, segIndex)
                        : raw && Number.isFinite(raw.regionLeadPadSec)
                          ? raw.regionLeadPadSec
                          : 0;
                if (segLeadPad > 0.00001) {
                    out.regionLeadPadSec = segLeadPad;
                }
                if (raw && Number.isFinite(raw.gainDb) && Math.abs(raw.gainDb) > 0.0005) {
                    out.gainDb = raw.gainDb;
                }
                if (raw && Number.isFinite(raw.pitchSemitones) && raw.pitchSemitones !== 0) {
                    out.pitchSemitones = Math.round(raw.pitchSemitones);
                }
                if (raw && Number.isFinite(raw.fadeInSec) && raw.fadeInSec > 0.0005) {
                    out.fadeInSec = raw.fadeInSec;
                }
                if (raw && Number.isFinite(raw.fadeOutSec) && raw.fadeOutSec > 0.0005) {
                    out.fadeOutSec = raw.fadeOutSec;
                }
                if (raw && raw.regionGroupId) {
                    out.regionGroupId = raw.regionGroupId;
                }
                return out;
            }),
        };
        if (isExtraTrackRef(track)) {
            entry.slot = track.slot;
            let timelineSlots;
            if (typeof window.timelineSlotsPersistSlice === 'function') {
                try {
                    timelineSlots = window.timelineSlotsPersistSlice(track);
                } catch (_) {
                    timelineSlots = undefined;
                }
            }
            if (timelineSlots) entry.timelineSlots = timelineSlots;
        }
        return entry;
    }

    function getPlaybackRegionPersistSnapshot() {
        const extras = [];
        const n =
            getExtraTrackCount();
        for (let i = 0; i < n; i++) {
            const track = { type: 'extra', slot: i };
            const entry = buildPlaybackRegionPersistEntryForTrack(track);
            if (entry) extras.push(entry);
        }
        let video = null;
        if (typeof getVideoTrackRef === 'function') {
            const videoEntry = buildPlaybackRegionPersistEntryForTrack(getVideoTrackRef());
            if (videoEntry) video = videoEntry;
        }
        if (typeof window.videoRegionDiagLogPersist === 'function') {
            window.videoRegionDiagLogPersist('save', {
                extraCount: extras.length,
                hasVideo: !!video,
                videoRegionIn: video && Number.isFinite(video.regionTimelineInSec)
                    ? video.regionTimelineInSec
                    : video &&
                        video.segments &&
                        video.segments[0] &&
                        Number.isFinite(video.segments[0].regionTimelineInSec)
                      ? video.segments[0].regionTimelineInSec
                      : undefined,
            });
        }
        if (!extras.length && !video) return null;
        const out = {};
        if (extras.length) out.extra = extras;
        if (video) out.video = video;
        return out;
    }

    function restoreVideoPlaybackRegionFromPersistEntry(entry, opt) {
        if (
            !entry ||
            !Array.isArray(entry.segments) ||
            !entry.segments.length ||
            typeof getVideoTrackRef !== 'function'
        ) {
            return { ok: false, deferred: false };
        }
        const videoLoaded =
            (typeof getVideoTrackSourceDurationSec === 'function' &&
                getVideoTrackSourceDurationSec() > 0) ||
            (typeof videoReady === 'function' && videoReady());
        if (!videoLoaded) {
            if (typeof window.videoRegionDiagLogPersist === 'function') {
                window.videoRegionDiagLogPersist('restore/deferred', {
                    segCount: entry.segments.length,
                });
            }
            return { ok: false, deferred: true };
        }
        const track = getVideoTrackRef();
        const segOpt = Object.assign(
            {
                silent: true,
                skipUndo: true,
                deferRedraw: !!(opt && opt.batchRestore),
                skipMusicalRefresh: !!(opt && opt.batchRestore),
                skipOverlay: !!(opt && opt.batchRestore),
            },
            opt || {},
        );
        const ok = setTrackSegments(track, entry.segments, segOpt);
        if (!ok) {
            if (typeof writeLog === 'function') {
                writeLog('Session: video region restore setTrackSegments failed');
            }
            return { ok: false, deferred: false };
        }
        const state = getPlaybackRegionsState(track);
        if (state) {
            const entrySeg0 = entry.segments[0];
            const raw0 = state.segments[0];
            if (Number.isFinite(entry.headPadSec)) {
                state.headPadSec = Math.max(0, entry.headPadSec);
            }
            if (raw0 && entrySeg0 && Number.isFinite(entrySeg0.timelineStartSec)) {
                raw0.timelineStartSec = entrySeg0.timelineStartSec;
            }
            if (Number.isFinite(entry.regionTimelineInSec)) {
                state.regionTimelineInSec = entry.regionTimelineInSec;
                if (raw0) raw0.regionTimelineInSec = entry.regionTimelineInSec;
            } else if (raw0 && Number.isFinite(raw0.regionTimelineInSec)) {
                state.regionTimelineInSec = raw0.regionTimelineInSec;
            }
            if (
                Number.isFinite(entry.regionLeadPadSec) &&
                entry.regionLeadPadSec > 0 &&
                raw0
            ) {
                state.regionLeadPadSec = Math.max(0, entry.regionLeadPadSec);
                raw0.regionLeadPadSec = Math.max(0, entry.regionLeadPadSec);
            }
            if (typeof syncTrackRegionHeadStateFromFirstSegment === 'function') {
                syncTrackRegionHeadStateFromFirstSegment(track);
            }
            const restoredIn = Number.isFinite(entry.regionTimelineInSec)
                ? entry.regionTimelineInSec
                : entrySeg0 && Number.isFinite(entrySeg0.timelineStartSec)
                  ? entrySeg0.timelineStartSec
                  : entrySeg0 && Number.isFinite(entrySeg0.regionTimelineInSec)
                    ? entrySeg0.regionTimelineInSec
                    : null;
            if (raw0 && Number.isFinite(restoredIn) && restoredIn > 0.0005) {
                if (Number.isFinite(entrySeg0?.timelineStartSec)) {
                    raw0.timelineStartSec = entrySeg0.timelineStartSec;
                }
                state.regionTimelineInSec = restoredIn;
                raw0.regionTimelineInSec = restoredIn;
                state.headPadSec = Number.isFinite(entry.headPadSec)
                    ? Math.max(0, entry.headPadSec)
                    : Math.max(
                          0,
                          restoredIn -
                              (typeof getTrackTimelineStartSec === 'function'
                                  ? getTrackTimelineStartSec(track)
                                  : 0),
                      );
                if (typeof reconcileSegmentSourceInWithRegionInTrim === 'function') {
                    reconcileSegmentSourceInWithRegionInTrim(track, 0);
                }
            }
            if (!(opt && opt.batchRestore)) {
                updateTrackRegionOverlays(track);
                if (typeof syncVideoTrackRegionsPresentation === 'function') {
                    syncVideoTrackRegionsPresentation();
                }
                if (typeof notifyMasterTransportDurationChanged === 'function') {
                    notifyMasterTransportDurationChanged();
                }
                if (typeof drawAudioWaveformCanvas === 'function') {
                    drawAudioWaveformCanvas();
                }
                if (
                    typeof applyVideoTimeForTransportSec === 'function' &&
                    typeof getTransportSec === 'function'
                ) {
                    applyVideoTimeForTransportSec(getTransportSec());
                }
            }
        }
        if (typeof window.videoRegionDiagLogPersist === 'function') {
            window.videoRegionDiagLogPersist('restore/applied', {
                segCount: entry.segments.length,
                regionTimelineInSec: entry.regionTimelineInSec,
            });
        }
        return { ok: true, deferred: false };
    }

    function restorePlaybackRegionFromPersist(data, opt) {
        if (!data || typeof data !== 'object') return false;
        let restoreFailed = false;
        let restoreDeferred = false;
        const batchRestore = !!(opt && opt.batchRestore);
        regionUndoPaused = true;
        try {
        if (Array.isArray(data.extra)) {
            for (const entry of data.extra) {
                if (!entry || typeof entry.slot !== 'number') continue;
                const track = { type: 'extra', slot: entry.slot };
                if (Array.isArray(entry.segments) && entry.segments.length) {
                    const loaded =
                        typeof isExtraTrackLoaded === 'function' &&
                        isExtraTrackLoaded(entry.slot);
                    if (!loaded) {
                        restoreDeferred = true;
                        continue;
                    }
                    const hasTimelineSlots =
                        Array.isArray(entry.timelineSlots) && entry.timelineSlots.length > 0;
                    const usableTimelineSlots =
                        hasTimelineSlots &&
                        typeof window.persistedTimelineSlotsAreUsable === 'function' &&
                        window.persistedTimelineSlotsAreUsable(entry.timelineSlots);
                    if (
                        usableTimelineSlots &&
                        typeof window.restoreTimelineSlotsForTrack === 'function'
                    ) {
                        window.restoreTimelineSlotsForTrack(track, entry.timelineSlots);
                    }
                    const segOpt = Object.assign(
                        {
                            silent: true,
                            skipUndo: true,
                            deferRedraw: batchRestore,
                            skipMusicalRefresh: batchRestore,
                            skipOverlay: batchRestore,
                        },
                        opt || {},
                    );
                    if (usableTimelineSlots) {
                        segOpt.geometryOnly = true;
                    }
                    const ok = setTrackSegments(track, entry.segments, segOpt);
                    if (!ok) {
                        restoreFailed = true;
                        continue;
                    }
                    const state = getPlaybackRegionsState(track);
                    if (state) {
                        if (Number.isFinite(entry.headPadSec)) {
                            state.headPadSec = Math.max(0, entry.headPadSec);
                        }
                        if (Number.isFinite(entry.regionTimelineInSec) && state.segments[0]) {
                            state.segments[0].regionTimelineInSec = entry.regionTimelineInSec;
                        }
                        if (
                            Number.isFinite(entry.regionLeadPadSec) &&
                            entry.regionLeadPadSec > 0 &&
                            state.segments[0]
                        ) {
                            state.segments[0].regionLeadPadSec = Math.max(
                                0,
                                entry.regionLeadPadSec,
                            );
                        }
                        if (typeof syncTrackRegionHeadStateFromFirstSegment === 'function') {
                            syncTrackRegionHeadStateFromFirstSegment(track);
                        }
                        if (!batchRestore) {
                            if (typeof window.refreshTrackTimelineMusicalSlots === 'function') {
                                window.refreshTrackTimelineMusicalSlots(track, {
                                    preserveStored: usableTimelineSlots,
                                });
                            }
                            updateTrackRegionOverlays(track);
                            redrawAfterRegionChange(entry.slot);
                        }
                    }
                } else if (
                    Number.isFinite(entry.sourceInSec) &&
                    Number.isFinite(entry.sourceOutSec)
                ) {
                    const loaded =
                        typeof isExtraTrackLoaded === 'function' &&
                        isExtraTrackLoaded(entry.slot);
                    if (!loaded) continue;
                    const ok = setTrackSegments(
                        track,
                        [{ sourceInSec: entry.sourceInSec, sourceOutSec: entry.sourceOutSec }],
                        Object.assign({ silent: true, skipUndo: true }, opt || {}),
                    );
                    if (!ok) restoreFailed = true;
                }
            }
        }
        if (data.video && typeof data.video === 'object') {
            const videoResult = restoreVideoPlaybackRegionFromPersistEntry(data.video, opt);
            if (videoResult.deferred) restoreDeferred = true;
            else if (!videoResult.ok) restoreFailed = true;
        }
        if (
            Number.isFinite(data.inSec) &&
            Number.isFinite(data.outSec) &&
            !data.extra &&
            typeof isExtraTrackLoaded === 'function' &&
            isExtraTrackLoaded(0)
        ) {
            const ok = setTrackSegments(
                { type: 'extra', slot: 0 },
                [{ sourceInSec: data.inSec, sourceOutSec: data.outSec }],
                Object.assign({ silent: true, skipUndo: true }, opt || {}),
            );
            if (!ok) restoreFailed = true;
        }
        updateAllPlaybackRegionOverlays();
        if (!(opt && opt.keepUndoHistory)) {
            clearRegionUndoStack();
        }
        return !restoreFailed && !restoreDeferred;
        } finally {
            regionUndoPaused = false;
        }
    }

    function setPendingPlaybackRegionRestore(data) {
        pendingPlaybackRegionRestore =
            data && typeof data === 'object' ? data : null;
    }

    function getPendingPlaybackRegionRestoreVideoEntry() {
        if (
            !pendingPlaybackRegionRestore ||
            !pendingPlaybackRegionRestore.video ||
            typeof pendingPlaybackRegionRestore.video !== 'object'
        ) {
            return null;
        }
        return pendingPlaybackRegionRestore.video;
    }

    window.getPendingPlaybackRegionRestoreVideoEntry =
        getPendingPlaybackRegionRestoreVideoEntry;

    function applyPendingPlaybackRegionRestore() {
        if (!pendingPlaybackRegionRestore) return false;
        const data = pendingPlaybackRegionRestore;
        const ok = restorePlaybackRegionFromPersist(data, { silent: true });
        if (ok && data.video && typeof writeLog === 'function') {
            let inSec = Number.isFinite(data.video.regionTimelineInSec)
                ? data.video.regionTimelineInSec
                : null;
            if (inSec == null && data.video.segments && data.video.segments[0]) {
                const s0 = data.video.segments[0];
                if (Number.isFinite(s0.regionTimelineInSec)) inSec = s0.regionTimelineInSec;
                else if (Number.isFinite(s0.timelineStartSec)) inSec = s0.timelineStartSec;
            }
            if (Number.isFinite(inSec) && inSec > 0.0005) {
                writeLog('Session: video region restored (in=' + inSec.toFixed(2) + 's)');
            }
        }
        if (!ok && data.video && typeof writeLog === 'function') {
            let inSec = Number.isFinite(data.video.regionTimelineInSec)
                ? data.video.regionTimelineInSec
                : null;
            if (inSec == null && data.video.segments && data.video.segments[0]) {
                const s0 = data.video.segments[0];
                if (Number.isFinite(s0.regionTimelineInSec)) inSec = s0.regionTimelineInSec;
                else if (Number.isFinite(s0.timelineStartSec)) inSec = s0.timelineStartSec;
            }
            writeLog(
                'Session: video region restore deferred or failed' +
                    (Number.isFinite(inSec) ? ' (in=' + inSec.toFixed(2) + 's)' : ''),
            );
        }
        if (ok) pendingPlaybackRegionRestore = null;
        return ok;
    }

