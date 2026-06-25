/**
 * musical-grid-ui.js — グリッド UI・永続化・描画
 */
    function clearMusicalGridPositionCache() {
        musicalGridPosCache = null;
        invalidateMusicalGridNavStopsCache();
    }
    function invalidateMusicalGridNavStopsCache() {
        musicalGridNavStopsCache = null;
        musicalGridNavStopsCacheKey = '';
    }
    function musicalGridNavStopsCacheKeyNow() {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        return [
            typeof getCommittedMusicalGridMeterText === 'function'
                ? getCommittedMusicalGridMeterText()
                : '',
            musicalGridRehearsalText || '',
            getMusicalGridVisible() ? '1' : '0',
            getMusicalGridRehearsalFillVisible() ? '1' : '0',
            Number(master).toFixed(4),
        ].join('\0');
    }
    function dedupeSortedMusicalGridStops(stops) {
        if (!stops.length) return stops;
        stops.sort((a, b) => a - b);
        const deduped = [];
        for (let i = 0; i < stops.length; i++) {
            if (!deduped.length || Math.abs(stops[i] - deduped[deduped.length - 1]) > 1e-6) {
                deduped.push(stops[i]);
            }
        }
        return deduped;
    }
    function clampMusicalGridSec(sec, maxSec) {
        const s = Number(sec);
        if (!Number.isFinite(s)) return 0;
        if (!(maxSec > 0)) return Math.max(0, s);
        return Math.max(0, Math.min(maxSec, s));
    }
    function meterBarDurationSecForWalk(meterSpec, barIndex, barStartSec, maxSec, entry) {
        const tempoEvents =
            typeof getTempoTrackEvents === 'function'
                ? getTempoTrackEvents(meterSpec, maxSec)
                : null;
        if (
            tempoEvents &&
            tempoEvents.length > 1 &&
            typeof barDurationSecWithTempoEvents === 'function'
        ) {
            return barDurationSecWithTempoEvents(
                barStartSec,
                barIndex,
                meterSpec,
                tempoEvents,
                maxSec,
            );
        }
        return meterBarDurationSec(entry);
    }

    function collectMusicalGridBarBoundarySecs(meterSpec, maxSec) {
        if (!(maxSec > 0) || !meterSpec) return [];
        return typeof collectPlaybackAlignedBarBoundarySecs === 'function'
            ? collectPlaybackAlignedBarBoundarySecs(meterSpec, maxSec)
            : typeof collectBarBoundarySecs === 'function'
              ? collectBarBoundarySecs(meterSpec, maxSec)
              : [];
    }

    function meterSpecForBarBoundaryWalk(meterSpec) {
        const playbackAligned =
            typeof isAnyExtraTrackTempoStretched === 'function' &&
            isAnyExtraTrackTempoStretched();
        const rate =
            playbackAligned && typeof currentTempoStretchPlaybackRate === 'function'
                ? currentTempoStretchPlaybackRate()
                : 1;
        if (playbackAligned && Math.abs(rate - 1) > 0.00001) {
            return Object.assign({}, meterSpec, { stretchDelta: 0 });
        }
        return meterSpec;
    }

    function resolveMusicalGridBarBySecFromBoundaries(meterSpec, t, maxSec) {
        const boundaries = collectMusicalGridBarBoundarySecs(meterSpec, maxSec);
        if (boundaries.length < 2) return null;
        let barIndex = 0;
        while (
            barIndex < boundaries.length - 2 &&
            t >= boundaries[barIndex + 1] - 1e-9
        ) {
            barIndex += 1;
        }
        const barStartSec = boundaries[barIndex];
        const barEndSec = boundaries[barIndex + 1];
        let entry = getMeterEntryForBar(meterSpecForBarBoundaryWalk(meterSpec), barIndex);
        if (!entry) return null;
        const tempoEvents =
            typeof getTempoTrackEvents === 'function'
                ? getTempoTrackEvents(meterSpec, maxSec)
                : null;
        if (tempoEvents && tempoEvents.length) {
            const bpm = resolveTempoBpmAtSec(t, meterSpec, tempoEvents);
            entry = { bpm: bpm, sig: entry.sig };
        }
        return {
            barIndex,
            barStartSec,
            barEndSec,
            entry,
            sec: t,
        };
    }

    function getMusicalGridBarBySec(meterSpec, sec, maxSec) {
        const t = clampMusicalGridSec(sec, maxSec);
        const meterKey =
            typeof getCommittedMusicalGridMeterText === 'function'
                ? getCommittedMusicalGridMeterText()
                : '';
        const fromBoundaries = resolveMusicalGridBarBySecFromBoundaries(
            meterSpec,
            t,
            maxSec,
        );
        if (fromBoundaries) {
            musicalGridPosCache = {
                meterKey,
                barIndex: fromBoundaries.barIndex,
                barStartSec: fromBoundaries.barStartSec,
                barEndSec: fromBoundaries.barEndSec,
                entry: fromBoundaries.entry,
            };
            return fromBoundaries;
        }
        if (!musicalGridPosCache || musicalGridPosCache.meterKey !== meterKey) {
            musicalGridPosCache = {
                meterKey,
                barIndex: 0,
                barStartSec: 0,
                barEndSec: 0,
                entry: null,
            };
        }
        let barIndex = musicalGridPosCache.barIndex | 0;
        let barStartSec = Number.isFinite(musicalGridPosCache.barStartSec)
            ? musicalGridPosCache.barStartSec
            : 0;
        let barEndSec = Number.isFinite(musicalGridPosCache.barEndSec)
            ? musicalGridPosCache.barEndSec
            : 0;
        let entry = musicalGridPosCache.entry;
        if (!entry || !(barEndSec > barStartSec + 1e-9) || t < barStartSec - 1e-9) {
            barIndex = 0;
            barStartSec = 0;
            entry = null;
            barEndSec = 0;
        }
        if (!entry) {
            entry = getMeterEntryForBar(meterSpec, barIndex);
            if (!entry) return null;
            barEndSec = barStartSec + meterBarDurationSecForWalk(meterSpec, barIndex, barStartSec, maxSec, entry);
        }
        const maxBars = 48000;
        let guard = 0;
        while (t >= barEndSec - 1e-9 && guard < maxBars) {
            barStartSec = barEndSec;
            barIndex += 1;
            entry = getMeterEntryForBar(meterSpec, barIndex);
            if (!entry) break;
            barEndSec = barStartSec + meterBarDurationSecForWalk(meterSpec, barIndex, barStartSec, maxSec, entry);
            guard += 1;
            if (barStartSec >= maxSec - 1e-9) break;
        }
        if (!entry) return null;
        const tempoEvents =
            typeof getTempoTrackEvents === 'function'
                ? getTempoTrackEvents(meterSpec, maxSec)
                : null;
        if (tempoEvents && tempoEvents.length) {
            const bpm = resolveTempoBpmAtSec(t, meterSpec, tempoEvents);
            entry = { bpm: bpm, sig: entry.sig };
        }
        musicalGridPosCache = {
            meterKey,
            barIndex,
            barStartSec,
            barEndSec,
            entry,
        };
        return {
            barIndex,
            barStartSec,
            barEndSec,
            entry,
            sec: t,
        };
    }
    function formatMusicalGridPlayheadPosition(pos) {
        if (!pos) return '---:--';
        const beat = resolveMeterBeatAtSec(pos.barStartSec, pos.entry, pos.sec);
        const barText = String(pos.barIndex + 1).padStart(3, '0');
        const beatText = beat
            ? String(beat.beatInBar1).padStart(2, '0')
            : '01';
        return barText + ':' + beatText;
    }
    function resolveMusicalGridPlayheadDisplay(sec) {
        const empty = {
            position: '---:--',
            tempo: '---',
            signature: '---',
        };
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return empty;
        const maxSec =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(maxSec > 0)) return empty;
        const pos = getMusicalGridBarBySec(settings.meterSpec, sec, maxSec);
        if (!pos || !pos.entry) return empty;
        const tempoEvents =
            typeof getTempoTrackEvents === 'function'
                ? getTempoTrackEvents(settings.meterSpec, maxSec)
                : null;
        const bpm =
            tempoEvents && tempoEvents.length
                ? resolveTempoBpmAtSec(sec, settings.meterSpec, tempoEvents)
                : pos.entry.bpm;
        return {
            position: formatMusicalGridPlayheadPosition(pos),
            tempo: formatBpmForMeter(bpm),
            signature: formatMeterSigText(pos.entry.sig),
        };
    }
    function formatMusicalGridPlayheadDisplayText(display) {
        const d = display && typeof display === 'object' ? display : {};
        return (
            (d.tempo != null ? d.tempo : '---') +
            ' ' +
            (d.signature != null ? d.signature : '---') +
            ' ' +
            (d.position != null ? d.position : '---:--')
        );
    }
    function resolveMusicalGridPlayheadPositionText(sec) {
        return formatMusicalGridPlayheadDisplayText(resolveMusicalGridPlayheadDisplay(sec));
    }
    /** 指定 transport の拍位置における 1 拍の秒数（Tempo/Sig・変拍子の各拍長に追従） */
    function meterBeatDurationSecAtTransport(transportSec) {
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return NaN;
        const maxSec =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(maxSec > 0)) return NaN;
        const pos = getMusicalGridBarBySec(settings.meterSpec, transportSec, maxSec);
        if (!pos || !pos.entry) return NaN;
        const beat = resolveMeterBeatAtSec(pos.barStartSec, pos.entry, pos.sec);
        if (beat && beat.beatDur > 0.00001) return beat.beatDur;
        const segments = getMeterSigSegments(pos.entry.sig);
        const firstSeg = segments && segments.length ? segments[0] : pos.entry.sig;
        const beatDur = beatDurationSec(firstSeg, pos.entry.bpm);
        return beatDur > 0.00001 ? beatDur : NaN;
    }
    /** transport 秒を最寄りの 4 分音符（拍）グリッドへ丸める。メーター未設定時はそのまま返す。 */
    function snapSecToMusicalGridQuarterNote(sec) {
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return Math.max(0, n);
        const maxSec =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(maxSec > 0)) return Math.max(0, n);
        const pos = getMusicalGridBarBySec(settings.meterSpec, n, maxSec);
        if (!pos || !pos.entry) return Math.max(0, n);
        const beat = resolveMeterBeatAtSec(pos.barStartSec, pos.entry, n);
        if (!beat || !(beat.beatDur > 1e-9)) return Math.max(0, n);
        const quarterDur = beat.beatDur;
        const snapped =
            beat.sec + Math.round((n - beat.sec) / quarterDur) * quarterDur;
        return clampMusicalGridSec(snapped, maxSec);
    }
    /** 小節頭スナップの吸着半径（秒）。ズームに追従し、Signature / Rehearsal トラック向けに広め。 */
    function getMusicalGridBarSnapThresholdSec(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        const el =
            typeof waveformScrubTargetEl === 'function' ? waveformScrubTargetEl() : null;
        const m =
            typeof waveformTimelineMetrics === 'function' ? waveformTimelineMetrics(el) : null;
        const SNAP_PX = o.commitSnap ? 52 : o.addSnap ? 44 : 36;
        if (!(master > 0) || !m || !m.scrubW) {
            return Math.max(step * 8, 0.12);
        }
        let scrubW = m.scrubW;
        if (
            typeof waveformOffsetDragActive !== 'undefined' &&
            waveformOffsetDragActive &&
            typeof waveformOffsetDragStartScrubW === 'number' &&
            waveformOffsetDragStartScrubW > 0
        ) {
            scrubW = waveformOffsetDragStartScrubW;
        }
        return Math.max(step, (SNAP_PX / scrubW) * master);
    }

    function collectMusicalGridBarSnapStops(meterSpec, maxSec) {
        const lines = collectMusicalGridLines(meterSpec, maxSec, { showBeats: false });
        const stops = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line && line.kind === 'bar' && Number.isFinite(line.sec)) {
                stops.push(line.sec);
            }
        }
        return stops;
    }

    function snapSecToNearestMusicalGridBar(sec, meterSpec, maxSec) {
        const n = Number(sec);
        if (!Number.isFinite(n) || !meterSpec || !(maxSec > 0)) return Math.max(0, n);
        const stops = collectMusicalGridBarSnapStops(meterSpec, maxSec);
        if (!stops.length) return clampMusicalGridSec(n, maxSec);
        let best = stops[0];
        let bestDist = Math.abs(n - best);
        for (let i = 1; i < stops.length; i++) {
            const d = Math.abs(n - stops[i]);
            if (d < bestDist) {
                bestDist = d;
                best = stops[i];
            }
        }
        return clampMusicalGridSec(best, maxSec);
    }

    /** transport 秒を最寄りの小節線へ丸める。 */
    function snapSecToMusicalGridBar(sec, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return Math.max(0, n);
        const maxSec =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(maxSec > 0)) return Math.max(0, n);
        if (o.forceNearest || o.addSnap) {
            return snapSecToNearestMusicalGridBar(n, settings.meterSpec, maxSec);
        }
        const stops = collectMusicalGridBarSnapStops(settings.meterSpec, maxSec);
        if (!stops.length) return clampMusicalGridSec(n, maxSec);
        const threshold = getMusicalGridBarSnapThresholdSec(o);
        if (typeof snapToNearestStop === 'function') {
            return clampMusicalGridSec(
                snapToNearestStop(n, stops, threshold, o),
                maxSec,
            );
        }
        let best = stops[0];
        let bestDist = Math.abs(n - best);
        for (let i = 1; i < stops.length; i++) {
            const d = Math.abs(n - stops[i]);
            if (d < bestDist) {
                bestDist = d;
                best = stops[i];
            }
        }
        const snapped = bestDist <= threshold ? best : n;
        return clampMusicalGridSec(snapped, maxSec);
    }
    function musicalGridDrawSettings() {
        readMusicalGridFromInputs();
        const meterSpec = typeof getMeterSpec === 'function' ? getMeterSpec() : null;
        if (!meterSpec) return null;
        const rehearsalSpec = parseRehearsalGroupingSpec(musicalGridRehearsalText);
        return { meterSpec, rehearsalSpec };
    }
    function musicalGridPersistSnapshot() {
        readMusicalGridFromInputs();
        const meterSpec = typeof getMeterSpec === 'function' ? getMeterSpec() : null;
        const snap = {
            rehearsal: musicalGridRehearsalText,
            gridVisible: getMusicalGridVisible(),
            rehearsalFillVisible: getMusicalGridRehearsalFillVisible(),
            stretchDelta: meterSpec && meterSpec.stretchDelta ? meterSpec.stretchDelta | 0 : 0,
        };
        if (rehearsalGroupBarCountsOverride && rehearsalGroupBarCountsOverride.length) {
            snap.rehearsalGroupBarCounts = rehearsalGroupBarCountsOverride.slice();
        }
        const maxSec =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (meterSpec && maxSec > 0) {
            if (typeof getTempoTrackEvents === 'function') {
                const tempoEvents = getTempoTrackEvents(meterSpec, maxSec);
                if (tempoEvents && tempoEvents.length) {
                    snap.tempoTrackEvents = tempoEvents.map((e) => ({
                        sec: e.sec,
                        bpm: e.bpm,
                        barIndex: e.barIndex != null ? e.barIndex : undefined,
                    }));
                }
            }
            if (typeof getSignatureTrackEvents === 'function') {
                const sigEvents = getSignatureTrackEvents(meterSpec, maxSec);
                if (sigEvents && sigEvents.length) {
                    snap.signatureTrackEvents =
                        typeof mapSignatureTrackEventsForPersist === 'function'
                            ? mapSignatureTrackEventsForPersist(sigEvents)
                            : sigEvents.map((e) => ({
                                  barIndex: e.barIndex,
                                  sig:
                                      typeof cloneMeterSigForTempoSync === 'function'
                                          ? cloneMeterSigForTempoSync(e.sig)
                                          : e.sig,
                              }));
                }
            }
        }
        if (typeof getRehearsalMarkTrackEventsPersistSnapshot === 'function') {
            snap.rehearsalMarkTrackEvents = getRehearsalMarkTrackEventsPersistSnapshot();
        }
        return snap;
    }
    function getMusicalGridVisible() {
        return musicalGridVisible !== false;
    }
    const MUSICAL_TRACK_LANE_DOM_IDS = [
        ['musicalRehearsalMeta', 'musicalRehearsalLane'],
        ['musicalTempoMeta', 'musicalTempoLane'],
        ['musicalSignatureMeta', 'musicalSignatureLane'],
        ['musicalMeasureMeta', 'musicalMeasureLane'],
    ];
    function syncMusicalTrackLanesDomVisibility() {
        const show = getMusicalGridVisible();
        for (let i = 0; i < MUSICAL_TRACK_LANE_DOM_IDS.length; i++) {
            const meta = document.getElementById(MUSICAL_TRACK_LANE_DOM_IDS[i][0]);
            const lane = document.getElementById(MUSICAL_TRACK_LANE_DOM_IDS[i][1]);
            if (meta) meta.hidden = !show;
            if (lane) lane.hidden = !show;
        }
        const composite = document.getElementById('audioWaveformComposite');
        if (composite) {
            composite.style.setProperty(
                '--musical-lane-count',
                String(
                    typeof getMusicalTrackLaneCount === 'function'
                        ? getMusicalTrackLaneCount()
                        : show
                          ? 4
                          : 0,
                ),
            );
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
    }
    function syncMusicalGridVisibilityUi() {
        if (musicalGridVisibleCheckbox) {
            musicalGridVisibleCheckbox.checked = getMusicalGridVisible();
        }
        const composite = document.getElementById('audioWaveformComposite');
        if (composite) {
            composite.classList.toggle(
                'audio-waveform-composite--rehearsal-fill',
                getMusicalGridRehearsalFillVisible(),
            );
            composite.classList.toggle(
                'audio-waveform-composite--musical-tracks-hidden',
                !getMusicalGridVisible(),
            );
        }
        syncMusicalTrackLanesDomVisibility();
        if (typeof refreshVideoVizLaneVisibility === 'function') {
            refreshVideoVizLaneVisibility({ skipInit: true });
        }
        const regionDragForbidden = getMusicalGridRehearsalFillVisible();
        const lanes =
            typeof getWaveformLanesEl === 'function' ? getWaveformLanesEl() : null;
        if (lanes) {
            lanes.classList.toggle(
                'audio-waveform-composite__lanes--region-drag-forbidden',
                regionDragForbidden,
            );
        }
    }
    function setMusicalGridVisible(visible, opt) {
        musicalGridVisible = visible !== false;
        const o = opt && typeof opt === 'object' ? opt : {};
        syncMusicalGridVisibilityUi();
        if (typeof refreshMusicalGridTracks === 'function') {
            refreshMusicalGridTracks({ preserveActiveEdit: true });
        }
        if (typeof drawMusicalGridOverlay === 'function') drawMusicalGridOverlay();
        if (!o.skipRegionRefresh) {
            if (typeof refreshAllWaveformTrackLkfsVisibility === 'function') {
                refreshAllWaveformTrackLkfsVisibility();
            }
            if (typeof refreshAllRegionMusicalMetaPresentation === 'function') {
                refreshAllRegionMusicalMetaPresentation();
            }
        }
        if (o.persist !== false) {
            if (typeof writePrefs === 'function') writePrefs();
            if (!o.skipSessionPersist && typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
        }
        if (!o.silent) {
            if (typeof writeLog === 'function') {
                writeLog('Musical Grid: ' + (musicalGridVisible ? 'ON' : 'OFF'));
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Tempo/Sig', musicalGridVisible ? 'ON' : 'OFF', 'notice');
            }
        }
    }
    function toggleMusicalGridVisible() {
        setMusicalGridVisible(!getMusicalGridVisible());
        return true;
    }
    function getMusicalGridRehearsalFillVisible() {
        return musicalGridRehearsalFillVisible !== false;
    }
    function setMusicalGridRehearsalFillVisible(visible, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const nextVisible = visible !== false;
        if (nextVisible && !getMusicalGridRehearsalFillVisible()) {
            if (typeof window.ensureDefaultRehearsalMarkForRehearsalTint === 'function') {
                window.ensureDefaultRehearsalMarkForRehearsalTint({ silent: !!o.silent });
            }
        }
        musicalGridRehearsalFillVisible = nextVisible;
        syncMusicalGridVisibilityUi();
        if (!musicalGridRehearsalFillVisible) endRehearsalBoundaryDrag();
        if (typeof drawMusicalGridOverlay === 'function') drawMusicalGridOverlay();
        else updateRehearsalBoundaryOverlay();
        if (!o.skipRegionRefresh) {
            if (typeof refreshAllRegionBoundaryPresentation === 'function') {
                refreshAllRegionBoundaryPresentation();
            }
            if (typeof refreshAllWaveformTrackLkfsVisibility === 'function') {
                refreshAllWaveformTrackLkfsVisibility();
            }
            if (typeof refreshAllRegionMusicalMetaPresentation === 'function') {
                refreshAllRegionMusicalMetaPresentation();
            } else if (typeof refreshAllRegionRehearsalMarkLabels === 'function') {
                refreshAllRegionRehearsalMarkLabels();
            }
        }
        if (o.persist !== false) {
            if (typeof writePrefs === 'function') writePrefs();
            if (!o.skipSessionPersist && typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
        }
        if (!o.silent) {
            if (typeof writeLog === 'function') {
                writeLog('Rehearsal tint: ' + (musicalGridRehearsalFillVisible ? 'ON' : 'OFF'));
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Rehearsal', musicalGridRehearsalFillVisible ? 'ON' : 'OFF', 'notice');
            }
        }
    }
    function toggleMusicalGridRehearsalFillVisible() {
        setMusicalGridRehearsalFillVisible(!getMusicalGridRehearsalFillVisible());
        return true;
    }
    function musicalGridPersistSnapWithoutVisibility(snap) {
        if (!snap || typeof snap !== 'object') return snap;
        const out = Object.assign({}, snap);
        delete out.gridVisible;
        delete out.rehearsalFillVisible;
        return out;
    }
    /** プロジェクト設定（セッション行・Import manifest）から T/R 表示状態を解決。トップレベルキーを優先。 */
    function resolveMusicalGridVisibilityFromProjectSource(src) {
        const s = src && typeof src === 'object' ? src : {};
        const mg = s.musicalGrid && typeof s.musicalGrid === 'object' ? s.musicalGrid : null;
        let gridVisible;
        let rehearsalFillVisible;
        if (typeof s.musicalGridVisible === 'boolean') {
            gridVisible = s.musicalGridVisible !== false;
        } else if (mg && typeof mg.gridVisible === 'boolean') {
            gridVisible = mg.gridVisible !== false;
        }
        if (typeof s.musicalGridRehearsalFillVisible === 'boolean') {
            rehearsalFillVisible = s.musicalGridRehearsalFillVisible !== false;
        } else if (mg && typeof mg.rehearsalFillVisible === 'boolean') {
            rehearsalFillVisible = mg.rehearsalFillVisible !== false;
        }
        return { gridVisible, rehearsalFillVisible };
    }
    function applyMusicalGridVisibilityFromProjectSource(src, opt) {
        const v = resolveMusicalGridVisibilityFromProjectSource(src);
        const o = opt && typeof opt === 'object' ? opt : {};
        const applyOpt = {
            silent: true,
            persist: o.persist !== false,
            skipRegionRefresh: o.skipRegionRefresh !== false,
            skipSessionPersist: true,
        };
        if (typeof v.gridVisible === 'boolean') {
            setMusicalGridVisible(v.gridVisible, applyOpt);
        }
        if (typeof v.rehearsalFillVisible === 'boolean') {
            setMusicalGridRehearsalFillVisible(v.rehearsalFillVisible, applyOpt);
        }
    }
    function applyMusicalGridPersistSnapshot(snap) {
        const s = snap && typeof snap === 'object' ? snap : {};
        if (typeof applyMusicalGridMeterFromPersistSnap === 'function') {
            applyMusicalGridMeterFromPersistSnap(s);
        }
        const rehearsalRaw = s.rehearsal != null ? s.rehearsal : '';
        musicalGridRehearsalText = normalizeMusicalGridRehearsalText(rehearsalRaw);
        if (Array.isArray(s.rehearsalGroupBarCounts) && s.rehearsalGroupBarCounts.length) {
            setRehearsalGroupBarCountsOverride(s.rehearsalGroupBarCounts);
        } else {
            clearRehearsalGroupBarCountsOverride();
        }
        clearMusicalGridPositionCache();
        if (typeof s.gridVisible === 'boolean') {
            musicalGridVisible = s.gridVisible !== false;
        }
        if (typeof s.rehearsalFillVisible === 'boolean') {
            musicalGridRehearsalFillVisible = s.rehearsalFillVisible !== false;
            if (
                musicalGridRehearsalFillVisible &&
                typeof window.ensureDefaultRehearsalMarkForRehearsalTint === 'function'
            ) {
                window.ensureDefaultRehearsalMarkForRehearsalTint({ silent: true });
            }
        }
        if (typeof applyMusicalGridTrackEventsFromPersistSnap === 'function') {
            applyMusicalGridTrackEventsFromPersistSnap(s, { skipBaseline: true });
        } else {
            if (Array.isArray(s.signatureTrackEvents) && s.signatureTrackEvents.length) {
                const meterSpec = typeof getMeterSpec === 'function' ? getMeterSpec() : null;
                const maxSec =
                    typeof getMasterTransportDurationSec === 'function'
                        ? getMasterTransportDurationSec()
                        : 0;
                if (
                    meterSpec &&
                    maxSec > 0 &&
                    typeof applySignatureTrackEvents === 'function'
                ) {
                    applySignatureTrackEvents(s.signatureTrackEvents, meterSpec, maxSec, {
                        skipBaseline: true,
                    });
                }
            } else if (typeof clearSignatureTrackEventsOverride === 'function') {
                clearSignatureTrackEventsOverride();
            }
            if (Array.isArray(s.tempoTrackEvents) && s.tempoTrackEvents.length) {
                const meterSpec = typeof getMeterSpec === 'function' ? getMeterSpec() : null;
                const maxSec =
                    typeof getMasterTransportDurationSec === 'function'
                        ? getMasterTransportDurationSec()
                        : 0;
                if (
                    meterSpec &&
                    maxSec > 0 &&
                    typeof applyTempoTrackEvents === 'function'
                ) {
                    applyTempoTrackEvents(s.tempoTrackEvents, meterSpec, maxSec, {
                        skipBaseline: true,
                    });
                }
            } else if (typeof clearTempoTrackEventsOverride === 'function') {
                clearTempoTrackEventsOverride();
            }
        }
        if (Array.isArray(s.rehearsalMarkTrackEvents)) {
            const maxSec =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : 0;
            if (typeof musicalTrackPersistDiagLog === 'function') {
                musicalTrackPersistDiagLog('grid/apply/begin', {
                    source: 'applyMusicalGridPersistSnapshot',
                    maxSec: maxSec,
                    meter:
                        typeof getCommittedMusicalGridMeterText === 'function'
                            ? getCommittedMusicalGridMeterText()
                            : '',
                    tempoTrackEvents:
                        typeof musicalTrackPersistDiagSummarizeTempoEvents === 'function'
                            ? musicalTrackPersistDiagSummarizeTempoEvents(s.tempoTrackEvents)
                            : {
                                  count: Array.isArray(s.tempoTrackEvents)
                                      ? s.tempoTrackEvents.length
                                      : 0,
                              },
                    signatureTrackEvents:
                        typeof musicalTrackPersistDiagSummarizeSignatureEvents === 'function'
                            ? musicalTrackPersistDiagSummarizeSignatureEvents(s.signatureTrackEvents)
                            : {
                                  count: Array.isArray(s.signatureTrackEvents)
                                      ? s.signatureTrackEvents.length
                                      : 0,
                              },
                    incomingRehearsal:
                        typeof musicalTrackPersistDiagSummarizeRehearsalEvents === 'function'
                            ? musicalTrackPersistDiagSummarizeRehearsalEvents(s.rehearsalMarkTrackEvents)
                            : { count: s.rehearsalMarkTrackEvents.length },
                    before:
                        typeof musicalTrackPersistDiagLiveState === 'function'
                            ? musicalTrackPersistDiagLiveState()
                            : null,
                });
            }
            if (typeof applyRehearsalMarkTrackEventsFromPersist === 'function') {
                if (s.rehearsalMarkTrackEvents.length > 0) {
                    applyRehearsalMarkTrackEventsFromPersist(
                        s.rehearsalMarkTrackEvents,
                        maxSec,
                    );
                } else if (typeof getRehearsalMarkTrackEventsPersistSnapshot === 'function') {
                    const current = getRehearsalMarkTrackEventsPersistSnapshot();
                    if (!current.length) {
                        applyRehearsalMarkTrackEventsFromPersist([], maxSec);
                    } else if (typeof musicalTrackPersistDiagLog === 'function') {
                        musicalTrackPersistDiagLog('rehearsal/apply/skip-empty', {
                            maxSec: maxSec,
                            keptCurrent:
                                typeof musicalTrackPersistDiagSummarizeRehearsalEvents === 'function'
                                    ? musicalTrackPersistDiagSummarizeRehearsalEvents(current)
                                    : { count: current.length },
                        });
                    }
                } else {
                    applyRehearsalMarkTrackEventsFromPersist([], maxSec);
                }
            }
            if (typeof musicalTrackPersistDiagLog === 'function') {
                musicalTrackPersistDiagLog('grid/apply/done', {
                    maxSec: maxSec,
                    after:
                        typeof musicalTrackPersistDiagLiveState === 'function'
                            ? musicalTrackPersistDiagLiveState()
                            : null,
                });
            }
        } else if (typeof musicalTrackPersistDiagLog === 'function') {
            musicalTrackPersistDiagLog('rehearsal/apply/skip-no-key', {
                source: 'applyMusicalGridPersistSnapshot',
                hasKey: Object.prototype.hasOwnProperty.call(s, 'rehearsalMarkTrackEvents'),
            });
        }
        syncMusicalGridVisibilityUi();
        if (typeof tryApplyPendingRehearsalMarkTrackEvents === 'function') {
            tryApplyPendingRehearsalMarkTrackEvents();
        }
        if (typeof tryApplyPendingMusicalGridTrackEvents === 'function') {
            tryApplyPendingMusicalGridTrackEvents();
        }
        scheduleMusicalGridRedraw();
        if (typeof refreshRehearsalTrack === 'function') refreshRehearsalTrack();
    }
    function resetMusicalGridToDefaults(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (typeof resetCommittedMeterSpecToDefault === 'function') {
            resetCommittedMeterSpecToDefault();
        } else if (typeof importMeterSpecFromText === 'function') {
            importMeterSpecFromText('120-4/4');
        }
        applyMusicalGridPersistSnapshot({
            rehearsal: '',
            stretchDelta: 0,
            tempoTrackEvents: [],
            signatureTrackEvents: [],
            rehearsalMarkTrackEvents: [],
            gridVisible: true,
            rehearsalFillVisible: false,
        });
        if (typeof clearRehearsalMarkTrackEventsOverride === 'function') {
            clearRehearsalMarkTrackEventsOverride();
        }
        if (typeof applyRehearsalMarkTrackEventsFromPersist === 'function') {
            applyRehearsalMarkTrackEventsFromPersist([], 0);
        }
        setMusicalGridVisible(true, {
            silent: !!o.silent,
            persist: false,
            skipRegionRefresh: !!o.skipRegionRefresh,
        });
        setMusicalGridRehearsalFillVisible(false, {
            silent: !!o.silent,
            persist: false,
            skipRegionRefresh: !!o.skipRegionRefresh,
        });
        if (typeof refreshMusicalGridTracks === 'function') {
            refreshMusicalGridTracks();
        }
        scheduleMusicalGridRedraw();
        if (typeof refreshRehearsalTrack === 'function') refreshRehearsalTrack();
        if (o.persist !== false) {
            if (typeof writePrefs === 'function') writePrefs();
        }
    }
    function persistMusicalGridToStorage(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        if (typeof writePrefs === 'function') writePrefs();
        if (!o.skipSessionPersist && typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
    }
    /** P ON だけではリージョン自動切り直ししない（Rehearsal 欄確定・境界ドラッグ確定時のみ relayoutRegions を渡す） */
    function canCommitRehearsalCompositionLayout() {
        return false;
    }
    function relayoutExtraTrackRegionsToRehearsalComposition(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        readMusicalGridFromInputs();
        if (!o.preserveRehearsalBarCountsOverride) {
            clearRehearsalGroupBarCountsOverride();
        }
        clearMusicalGridPositionCache();
        if (typeof window.applyRehearsalCompositionToAllExtraTrackRegions !== 'function') {
            if (typeof writeLog === 'function') {
                writeLog('Rehearsal: region relayout skipped (core API not loaded)');
            }
            return 0;
        }
        return window.applyRehearsalCompositionToAllExtraTrackRegions(o);
    }
    /** 波形側 Rehearsal 境界操作確定 — Rehearsal 欄へ反映後、構成どおりにリージョンを切り直す */
    function persistRehearsalWaveformEditAndRedraw(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        persistMusicalGridAndRedraw({
            skipUndo: !!o.skipUndo,
            relayoutRegions: true,
            relayoutSilent: o.relayoutSilent !== false,
            // applyExplicitRehearsalGroupBarCounts 直後 — 展開 counts を relayout で消さない
            preserveRehearsalBarCountsOverride: o.preserveRehearsalBarCountsOverride !== false,
        });
    }
    function persistMusicalGridAndRedraw(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const meterCommit = { accepted: true, changed: false };
        if (!musicalGridRehearsalText || !parseRehearsalGroupingSpec(musicalGridRehearsalText)) {
            const master =
                typeof getMasterTransportDurationSec === 'function'
                    ? getMasterTransportDurationSec()
                    : 0;
            const settings =
                typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
            if (
                settings &&
                master > 0 &&
                shouldPreferRehearsalMarksForRehearsalFill(settings, master)
            ) {
                clearRehearsalGroupBarCountsOverride();
            } else {
                musicalGridRehearsalText = MUSICAL_GRID_DEFAULT_REHEARSAL_SPEC_TEXT;
            }
        }
        const shouldRelayout = !!o.relayoutRegions;
        const shouldRelayoutFromMeter = !!(
            o.relayoutSlotsFromMeter &&
            (meterCommit.changed || o.forceRelayoutFromMeter) &&
            !shouldRelayout
        );
        const shouldRelayoutRegions = shouldRelayout || shouldRelayoutFromMeter;
        const shouldCompressRehearsal = !!(
            o.compressRehearsal ||
            (shouldRelayoutFromMeter && !o.preserveRehearsalTextOnMeterRelayout)
        );
        if (shouldCompressRehearsal) {
            compressRehearsalDefinitionFromExpandedCounts({ skipUndo: !!o.skipUndo });
        }
        clearMusicalGridPositionCache();
        persistMusicalGridToStorage();
        scheduleMusicalGridRedraw();
        const shouldScaleRegionsForTempoStretch = !!(
            shouldRelayoutFromMeter &&
            o.preserveRehearsalTextOnMeterRelayout &&
            o.stretchPrevSpec &&
            o.stretchNextSpec &&
            typeof window.scaleAllExtraTrackRegionsForTempoStretch === 'function'
        );
        if (shouldScaleRegionsForTempoStretch) {
            window.scaleAllExtraTrackRegionsForTempoStretch(
                o.stretchPrevSpec,
                o.stretchNextSpec,
                {
                    silent: o.relayoutSilent !== false,
                    skipUndo: !!o.skipUndo,
                },
            );
        } else if (shouldRelayoutRegions) {
            relayoutExtraTrackRegionsToRehearsalComposition({
                silent: o.relayoutSilent !== false,
                preserveRehearsalBarCountsOverride:
                    !!o.preserveRehearsalBarCountsOverride ||
                    !!o.preserveRehearsalTextOnMeterRelayout ||
                    (shouldRelayoutFromMeter && !shouldCompressRehearsal),
                skipUndo: !!o.skipUndo,
            });
        }
        if (!o.skipTimelineSlotRebuild && typeof rebuildAllTrackTimelineSlots === 'function') {
            rebuildAllTrackTimelineSlots({
                infer: true,
                preserveStored: false,
            });
        } else if (
            !o.skipTimelineSlotRebuild &&
            typeof refreshAllRegionMusicalMetaPresentation === 'function'
        ) {
            refreshAllRegionMusicalMetaPresentation();
        } else if (
            !o.skipTimelineSlotRebuild &&
            typeof refreshAllRegionRehearsalMarkLabels === 'function'
        ) {
            refreshAllRegionRehearsalMarkLabels();
        }
        if (
            (shouldRelayoutRegions || shouldScaleRegionsForTempoStretch) &&
            typeof flushPersistSessionNow === 'function'
        ) {
            return flushPersistSessionNow().catch((err) => {
                if (typeof writeLog === 'function') {
                    writeLog(
                        'Session save failed after musical region relayout: ' +
                            (err && err.message ? err.message : String(err)),
                    );
                }
            });
        }
        return null;
    }
    /** comma 区切りリストでキャレットが属する要素インデックス（0 始まり）。alternate の () はラップのみ扱う。 */
    function commaListEntryIndexAtCaret(raw, caret) {
        const s = String(raw == null ? '' : raw).trim();
        const c = Math.max(0, Math.min(s.length, caret | 0));
        let inner = s;
        let lead = 0;
        const alt = /^\((.*)\)$/.exec(s);
        if (alt) {
            const open = s.indexOf('(');
            const close = s.lastIndexOf(')');
            lead = open + 1;
            inner = alt[1];
            if (c <= open) return 0;
            if (c > close) {
                let index = 0;
                for (let i = 0; i < inner.length; i++) {
                    if (inner[i] === ',') index++;
                }
                return index;
            }
            caret = c - lead;
        } else {
            caret = c;
        }
        const pos = Math.max(0, Math.min(inner.length, caret));
        let index = 0;
        for (let i = 0; i < pos; i++) {
            if (inner[i] === ',') index++;
        }
        return index;
    }
    function commaListCaretPosForEntry(raw, entryIndex) {
        const s = String(raw == null ? '' : raw).trim();
        let inner = s;
        let lead = 0;
        const alt = /^\((.*)\)$/.exec(s);
        if (alt) {
            lead = s.indexOf('(') + 1;
            inner = alt[1];
        }
        let idx = Math.max(0, entryIndex | 0);
        let pos = 0;
        while (idx > 0) {
            const comma = inner.indexOf(',', pos);
            if (comma < 0) break;
            pos = comma + 1;
            idx--;
        }
        return lead + pos;
    }
    /** @returns {{ start: number, end: number, text: string }} */
    function commaListEntrySpan(raw, entryIndex) {
        const s = String(raw == null ? '' : raw).trim();
        let inner = s;
        let lead = 0;
        const alt = /^\((.*)\)$/.exec(s);
        if (alt) {
            lead = s.indexOf('(') + 1;
            inner = alt[1];
        }
        let idx = Math.max(0, entryIndex | 0);
        let start = 0;
        let i = 0;
        while (i < idx) {
            const comma = inner.indexOf(',', start);
            if (comma < 0) break;
            start = comma + 1;
            i++;
        }
        let end = inner.length;
        const comma = inner.indexOf(',', start);
        if (comma >= 0) end = comma;
        return { start: lead + start, end: lead + end, text: inner.slice(start, end) };
    }
    function bumpMeterSigField(sig, field, step, segIdx) {
        if (!sig) return;
        if (sig.alternates && sig.alternates.length) {
            const idx = Math.max(0, Math.min(sig.alternates.length - 1, segIdx | 0));
            if (field === 'num') {
                sig.alternates[idx].num = clampMeterSigPart(sig.alternates[idx].num + step);
            } else if (field === 'den') {
                sig.alternates[idx].den = clampMeterSigPart(sig.alternates[idx].den + step);
            }
            return;
        }
        if (sig.segments && sig.segments.length) {
            const idx = Math.max(0, Math.min(sig.segments.length - 1, segIdx | 0));
            if (field === 'num') {
                sig.segments[idx].num = clampMeterSigPart(sig.segments[idx].num + step);
            } else if (field === 'den') {
                sig.segments[idx].den = clampMeterSigPart(sig.segments[idx].den + step);
            }
            return;
        }
        if (field === 'num') {
            sig.num = clampMeterSigPart(sig.num + step);
        } else if (field === 'den') {
            sig.den = clampMeterSigPart(sig.den + step);
        }
    }
    function clampMeterSigPart(n) {
        return Math.max(1, Math.min(32, n | 0));
    }

    let musicalGridRedrawRaf = 0;
    let musicalGridAutosaveTimer = 0;

    function scheduleMusicalGridAutosave() {
        if (musicalGridAutosaveTimer) {
            clearTimeout(musicalGridAutosaveTimer);
        }
        musicalGridAutosaveTimer = setTimeout(() => {
            musicalGridAutosaveTimer = 0;
            readMusicalGridFromInputs();
            clearMusicalGridPositionCache();
            persistMusicalGridToStorage();
        }, 400);
    }

    function scheduleMusicalGridRedraw() {
        if (
            typeof window.isPlaybackRegionSwapAnimActive === 'function' &&
            window.isPlaybackRegionSwapAnimActive()
        ) {
            return;
        }
        if (
            typeof isWaveformScrubPriorityActive === 'function' &&
            isWaveformScrubPriorityActive()
        ) {
            return;
        }
        if (musicalGridRedrawRaf) return;
        musicalGridRedrawRaf = requestAnimationFrame(() => {
            musicalGridRedrawRaf = 0;
            if (typeof tryApplyPendingRehearsalMarkTrackEvents === 'function') {
                tryApplyPendingRehearsalMarkTrackEvents();
            }
            if (typeof tryApplyPendingMusicalGridTrackEvents === 'function') {
                tryApplyPendingMusicalGridTrackEvents();
            }
            drawMusicalGridOverlay();
            if (typeof refreshMusicalGridTracks === 'function') refreshMusicalGridTracks();
            if (typeof refreshAllRegionRehearsalMarkLabels === 'function') {
                refreshAllRegionRehearsalMarkLabels();
            }
        });
    }

    function getRehearsalFillCanvasEl() {
        if (typeof audioWaveformRehearsalFill !== 'undefined' && audioWaveformRehearsalFill) {
            return audioWaveformRehearsalFill;
        }
        return document.getElementById('audioWaveformRehearsalFill');
    }

    function getBarLinesCanvasEl() {
        if (typeof audioWaveformBarLines !== 'undefined' && audioWaveformBarLines) {
            return audioWaveformBarLines;
        }
        return document.getElementById('audioWaveformBarLines');
    }

    function ensureWaveformOverlayCanvasSized(canvasEl) {
        if (!canvasEl) return null;
        const lanes =
            typeof audioWaveformLanesTracks !== 'undefined' && audioWaveformLanesTracks
                ? audioWaveformLanesTracks
                : typeof waveformScrubTargetEl === 'function'
                  ? waveformScrubTargetEl()
                  : null;
        if (!lanes) return null;
        const h = Math.max(1, lanes.clientHeight | 0);
        if (h < 1) return null;
        if (typeof syncWaveformCanvasElement === 'function') {
            const sized = syncWaveformCanvasElement(canvasEl, h);
            if (!sized) return null;
            const spec = sized.canvasSpec || {};
            return {
                ctx: sized.ctx,
                w: sized.wCss,
                h: sized.hCss,
                layoutW: spec.contentW || sized.wCss,
                xOffset: spec.mode === 'window' ? spec.canvasLeft || 0 : 0,
            };
        }
        const inner =
            typeof audioWaveformLanesInner !== 'undefined' && audioWaveformLanesInner
                ? audioWaveformLanesInner
                : typeof waveformTimelineInnerEl === 'function'
                  ? waveformTimelineInnerEl()
                  : canvasEl.parentElement;
        if (!inner) return null;
        const w = Math.max(1, inner.clientWidth | 0);
        if (w < 1) return null;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const bw = Math.round(w * dpr);
        const bh = Math.round(h * dpr);
        if (canvasEl.width !== bw || canvasEl.height !== bh) {
            canvasEl.width = bw;
            canvasEl.height = bh;
            canvasEl.style.width = w + 'px';
            canvasEl.style.height = h + 'px';
        }
        const ctx = canvasEl.getContext('2d');
        if (!ctx) return null;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { ctx, w, h, layoutW: w, xOffset: 0 };
    }

    function ensureMusicalGridCanvasSized() {
        return ensureWaveformOverlayCanvasSized(musicalGridCanvas);
    }

    function clearRehearsalFillCanvas() {
        const canvas = getRehearsalFillCanvasEl();
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function drawRehearsalFillOverlay() {
        const canvas = getRehearsalFillCanvasEl();
        if (!canvas) return;
        const sized = ensureWaveformOverlayCanvasSized(canvas);
        if (!sized) {
            clearRehearsalFillCanvas();
            return;
        }
        const { ctx, w, h, layoutW, xOffset } = sized;
        ctx.clearRect(0, 0, w, h);
        const suppressRehearsalFillsDuringRegionSwap =
            typeof window.isPlaybackRegionSwapRehearsalFillSuppressed === 'function' &&
            window.isPlaybackRegionSwapRehearsalFillSuppressed();
        if (suppressRehearsalFillsDuringRegionSwap || !getMusicalGridRehearsalFillVisible()) {
            return;
        }
        const settings = musicalGridDrawSettings();
        if (!settings) return;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return;
        ctx.save();
        if (xOffset) ctx.translate(-xOffset, 0);
        drawRehearsalGroupFills(ctx, layoutW, h, master, settings);
        ctx.restore();
    }

    function clearBarLinesCanvas() {
        const canvas = getBarLinesCanvasEl();
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    /** スワップアニメ開始 — キャプチャ後に Rehearsal 着色・小節線オーバーレイを消去 */
    function clearRegionSwapWaveformGridOverlays() {
        clearRehearsalFillCanvas();
        clearBarLinesCanvas();
    }

    function drawBarLinesOverlay() {
        const canvas = getBarLinesCanvasEl();
        if (!canvas) return;
        const sized = ensureWaveformOverlayCanvasSized(canvas);
        if (!sized) {
            clearBarLinesCanvas();
            return;
        }
        const { ctx, w, h, layoutW, xOffset } = sized;
        ctx.clearRect(0, 0, w, h);
        const suppressOverlaysDuringRegionSwap =
            typeof window.isPlaybackRegionSwapRehearsalFillSuppressed === 'function' &&
            window.isPlaybackRegionSwapRehearsalFillSuppressed();
        if (suppressOverlaysDuringRegionSwap || !getMusicalGridVisible()) return;
        const settings = musicalGridDrawSettings();
        if (!settings) return;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return;
        ctx.save();
        if (xOffset) ctx.translate(-xOffset, 0);
        ctx.globalCompositeOperation = 'source-over';
        const lines = collectMusicalGridLines(settings.meterSpec, master, {
            showBeats: false,
        });
        const linePx =
            typeof timelineSecToContentLinePx === 'function'
                ? timelineSecToContentLinePx
                : (sec) => Math.round((sec / master) * layoutW) + 0.5;
        const visMin = xOffset - 0.5;
        const visMax = xOffset + w + 0.5;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.kind !== 'bar') continue;
            const xi = linePx(line.sec);
            if (xi < visMin || xi > visMax) continue;
            ctx.strokeStyle = 'rgba(120, 124, 134, 0.58)';
            ctx.lineWidth = 1;
            ctx.lineCap = 'butt';
            ctx.beginPath();
            ctx.moveTo(xi, 0);
            ctx.lineTo(xi, h);
            ctx.stroke();
        }
        ctx.restore();
    }

    /** 展開 Rehearsal スロット index（0 始まり）→ A, B … Z, AA … */
    function rehearsalGroupLabelForIndex(index) {
        let n = (index | 0) + 1;
        if (n < 1) return 'A';
        let out = '';
        while (n > 0) {
            n--;
            out = String.fromCharCode(65 + (n % 26)) + out;
            n = (n / 26) | 0;
        }
        return out;
    }

    /** Rehearsal スロット index → リハーサル名表示（リハーサル名なし区間は空文字） */
    function rehearsalRehearsalDisplayMarkForSlot(rehearsalSlotIndex) {
        if (typeof rehearsalMarkLabelForRehearsalSlotIndex === 'function') {
            const internal = rehearsalMarkLabelForRehearsalSlotIndex(rehearsalSlotIndex);
            if (typeof rehearsalMarkDisplayLabel === 'function') {
                return rehearsalMarkDisplayLabel(internal);
            }
            const unlabeled =
                typeof REHEARSAL_MARK_UNLABELED !== 'undefined'
                    ? REHEARSAL_MARK_UNLABELED
                    : '_';
            return internal && internal !== unlabeled ? internal : '';
        }
        return rehearsalGroupLabelForIndex(rehearsalSlotIndex);
    }

    /** リハーサルマーク同期済みで Rehearsal 欄が未設定/デフォルトのみのとき — 小節数 Rehearsal よりリハーサル区間を優先 */
    function shouldPreferRehearsalMarksForRehearsalFill(settings, master) {
        if (!(master > 0) || !settings || !settings.meterSpec) return false;
        if (typeof collectRehearsalMarkDrawRanges !== 'function') return false;
        const rehearsalRanges = collectRehearsalMarkDrawRanges(master, settings.meterSpec);
        if (!rehearsalRanges.length) return false;
        readMusicalGridFromInputs();
        const normalized = normalizeMusicalGridRehearsalText(musicalGridRehearsalText);
        return !normalized || normalized === MUSICAL_GRID_DEFAULT_REHEARSAL_SPEC_TEXT;
    }

    function resolveRehearsalGroupRanges(opt) {
        const requireFillVisible = !!(opt && opt.requireFillVisible);
        if (requireFillVisible && !getMusicalGridRehearsalFillVisible()) return [];
        if (!requireFillVisible) readMusicalGridFromInputs();
        const settings = musicalGridDrawSettings();
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return [];
        if (requireFillVisible) {
            const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
            if (typeof collectRehearsalMarkDrawRanges === 'function') {
                return collectRehearsalMarkDrawRanges(master, meterSpec);
            }
            return [];
        }
        if (!settings || !settings.meterSpec) return [];
        const layoutDuration =
            typeof resolveRehearsalLayoutDurationSec === 'function'
                ? resolveRehearsalLayoutDurationSec(
                      settings.meterSpec,
                      master,
                      settings.rehearsalSpec,
                  )
                : master;
        if (rehearsalBoundaryDragCounts && rehearsalBoundaryDragCounts.length) {
            return collectRehearsalGroupRangesFromBarCounts(
                settings.meterSpec,
                layoutDuration,
                rehearsalBoundaryDragCounts,
            );
        }
        if (shouldPreferRehearsalMarksForRehearsalFill(settings, master)) {
            return collectRehearsalMarkDrawRanges(master, settings.meterSpec);
        }
        const counts = resolveRehearsalGroupBarCounts(
            settings.meterSpec,
            layoutDuration,
            settings.rehearsalSpec,
        );
        if (!counts.length) return [];
        return collectRehearsalGroupRangesFromBarCounts(
            settings.meterSpec,
            layoutDuration,
            counts,
        );
    }

    /** リハーサルマークトラックから展開した範囲（Rehearsal 定義着色は使用しない） */
    function getRehearsalGroupRangesForRegionRehearsalMarks() {
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return [];
        const settings = musicalGridDrawSettings();
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        if (typeof collectRehearsalMarkDrawRanges === 'function') {
            return collectRehearsalMarkDrawRanges(master, meterSpec);
        }
        return [];
    }

    /** Rehearsal 定義から展開した範囲（着色表示の ON/OFF は問わない） */
    function getRehearsalGroupRangesForRehearsalNav() {
        return resolveRehearsalGroupRanges({ requireFillVisible: false });
    }

    /**
     * Shift+英文字ジャンプ用 — Rehearsal Mark トラック優先、未設定時は Rehearsal 定義範囲。
     */
    function getRehearsalMarkNavRanges() {
        const fromTrack = getRehearsalGroupRangesForRegionRehearsalMarks();
        if (fromTrack.length) return fromTrack;
        return getRehearsalGroupRangesForRehearsalNav();
    }

    function getRehearsalGroupRangesSnapshot() {
        return resolveRehearsalGroupRanges({ requireFillVisible: true });
    }

    /** Rehearsal 着色 ON 時、transport 秒が属する Rehearsal 範囲。該当なしは null。 */
    function resolveRehearsalGroupAtTransportSec(sec) {
        if (!getMusicalGridRehearsalFillVisible()) return null;
        const s = Number(sec);
        if (!Number.isFinite(s)) return null;
        const ranges = getRehearsalGroupRangesSnapshot();
        if (!ranges.length) return null;
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (s >= r.startSec - 1e-9 && s < r.endSec + 1e-9) {
                return {
                    startSec: r.startSec,
                    endSec: r.endSec,
                    paletteIndex: r.paletteIndex,
                    label: rehearsalGroupLabelForIndex(r.paletteIndex),
                };
            }
        }
        return null;
    }

    /** Rehearsal 着色 — リハーサルマーク区間のみ（Rehearsal 小節数定義は使わない） */
    function collectRehearsalGroupDrawRanges(settings, master) {
        if (!getMusicalGridRehearsalFillVisible()) return [];
        if (!(master > 0)) return [];
        const meterSpec = settings && settings.meterSpec ? settings.meterSpec : null;
        if (typeof collectRehearsalMarkDrawRanges !== 'function') return [];
        return collectRehearsalMarkDrawRanges(master, meterSpec);
    }

    function drawRehearsalGroupFills(ctx, w, h, master, settings) {
        const ranges = collectRehearsalGroupDrawRanges(settings, master);
        if (!ranges.length) return;
        const secToX = (sec) => (sec / master) * w;
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            const x0 = secToX(r.startSec);
            const x1 = secToX(r.endSec);
            if (x1 <= x0 + 0.25) continue;
            ctx.fillStyle = r.paletteIndex % 2 === 0 ? BAR_GROUP_FILL_A : BAR_GROUP_FILL_B;
            ctx.fillRect(x0, 0, x1 - x0, h);
        }
    }

    function formatRehearsalSlotMusicalMetaText(meter, rehearsalBars, contentBars) {
        const m = String(meter == null ? '' : meter).trim();
        const rehearsal = rehearsalBars | 0;
        const content = contentBars | 0;
        let barPart = '';
        if (content > 0 && rehearsal > 0 && content !== rehearsal) {
            barPart = content + '→' + rehearsal;
        } else if (rehearsal > 0) {
            barPart = String(rehearsal);
        } else if (content > 0) {
            barPart = String(content);
        }
        if (m && barPart) return m + ' · ' + barPart;
        if (m) return m;
        return barPart;
    }

    function getMusicalGridMeterDisplayText() {
        readMusicalGridFromInputs();
        return getCommittedMusicalGridMeterText();
    }

    function collectPlaybackRegionSpansForBarLabels() {
        const spans = [];
        if (
            typeof getExtraTrackCount !== 'function' ||
            typeof isTrackRegionActive !== 'function' ||
            typeof getSegmentCount !== 'function'
        ) {
            return spans;
        }
        const trackCount = getExtraTrackCount();
        for (let slot = 0; slot < trackCount; slot++) {
            const track = { type: 'extra', slot };
            if (!isTrackRegionActive(track)) continue;
            const segCount = getSegmentCount(track);
            for (let si = 0; si < segCount; si++) {
                let startSec = null;
                let endSec = null;
                if (typeof getSegmentRegionTimelineInterval === 'function') {
                    const iv = getSegmentRegionTimelineInterval(track, si);
                    startSec = iv && Number.isFinite(iv.start) ? iv.start : null;
                    endSec = iv && Number.isFinite(iv.end) ? iv.end : null;
                } else if (
                    typeof getSegmentRegionTimelineIn === 'function' &&
                    typeof getSegmentRegionTimelineOut === 'function'
                ) {
                    startSec = getSegmentRegionTimelineIn(track, si);
                    endSec = getSegmentRegionTimelineOut(track, si);
                }
                if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;
                if (endSec <= startSec + 1e-9) continue;
                spans.push({ slot, segmentIndex: si, startSec, endSec });
            }
        }
        return spans;
    }

    function regionBarStartBoundarySec(regionInSec, barBoundaries) {
        const idx = barIndexForBoundarySec(regionInSec, barBoundaries);
        return barBoundaries[idx];
    }

    function barLineIndexForSec(sec, barBoundaries) {
        const eps = 1e-4;
        for (let i = 0; i < barBoundaries.length - 1; i++) {
            if (Math.abs(sec - barBoundaries[i]) < eps) return i;
        }
        return -1;
    }

    function localBarNumberForRegionBarLine(regionInSec, barSec, barBoundaries) {
        const lineIdx = barLineIndexForSec(barSec, barBoundaries);
        if (lineIdx < 0) return null;
        const regionBarStart = regionBarStartBoundarySec(regionInSec, barBoundaries);
        const regionBarStartIdx = barLineIndexForSec(regionBarStart, barBoundaries);
        if (regionBarStartIdx < 0) return null;
        const localBar = lineIdx - regionBarStartIdx + 1;
        return localBar >= 1 ? localBar : null;
    }

    function barLineBelongsToRegionSpan(span, barSec, barBoundaries, spans) {
        const eps = 1e-4;
        if (!Number.isFinite(barSec) || !span) return false;
        if (barSec >= span.endSec - eps) return false;
        if (spans) {
            for (let i = 0; i < spans.length; i++) {
                const other = spans[i];
                if (other.slot !== span.slot) continue;
                if (other.segmentIndex <= span.segmentIndex) continue;
                if (barSec >= other.startSec - eps && barSec < other.endSec - eps) {
                    return false;
                }
            }
        }
        if (barSec >= span.startSec - eps) return true;
        const regionBarStart = regionBarStartBoundarySec(span.startSec, barBoundaries);
        return (
            Number.isFinite(regionBarStart) &&
            Math.abs(barSec - regionBarStart) < eps &&
            regionBarStart <= span.startSec + eps
        );
    }

    function regionSpanHasBarOneLabelAtIn(span, barLines, barBoundaries, spans) {
        const eps = 1e-4;
        for (let i = 0; i < barLines.length; i++) {
            const line = barLines[i];
            if (!line || line.kind !== 'bar' || !Number.isFinite(line.sec)) continue;
            if (!barLineBelongsToRegionSpan(span, line.sec, barBoundaries, spans)) continue;
            if (localBarNumberForRegionBarLine(span.startSec, line.sec, barBoundaries) !== 1) {
                continue;
            }
            if (Math.abs(line.sec - span.startSec) < eps) return true;
            const regionBarStart = regionBarStartBoundarySec(span.startSec, barBoundaries);
            if (Math.abs(line.sec - regionBarStart) < eps) return true;
        }
        return false;
    }

    function findPlaybackRegionSpanForBarLine(spans, barSec, barBoundaries) {
        const activeSlot =
            typeof getActiveMixExtraSlotFromDom === 'function'
                ? getActiveMixExtraSlotFromDom()
                : -1;
        let best = null;
        for (let i = 0; i < spans.length; i++) {
            const span = spans[i];
            if (!barLineBelongsToRegionSpan(span, barSec, barBoundaries, spans)) continue;
            if (!best) {
                best = span;
                continue;
            }
            if (span.startSec > best.startSec + 1e-9) {
                best = span;
                continue;
            }
            if (Math.abs(span.startSec - best.startSec) <= 1e-9) {
                if (activeSlot >= 0) {
                    if (span.slot === activeSlot && best.slot !== activeSlot) {
                        best = span;
                        continue;
                    }
                    if (best.slot === activeSlot && span.slot !== activeSlot) {
                        continue;
                    }
                }
                if (span.slot === best.slot && span.segmentIndex > best.segmentIndex) {
                    best = span;
                }
            }
        }
        return best;
    }

    function playbackRegionSpanContainsTransport(span, transportSec, barBoundaries, spans) {
        const eps = 1e-4;
        const t = Number(transportSec);
        if (!Number.isFinite(t) || !span) return false;
        if (t >= span.endSec - eps) return false;
        if (t >= span.startSec - eps) {
            if (spans) {
                for (let i = 0; i < spans.length; i++) {
                    const other = spans[i];
                    if (other.slot !== span.slot) continue;
                    if (other.segmentIndex <= span.segmentIndex) continue;
                    if (t >= other.startSec - eps && t < other.endSec - eps) return false;
                }
            }
            return true;
        }
        const regionBarStart = regionBarStartBoundarySec(span.startSec, barBoundaries);
        return (
            Number.isFinite(regionBarStart) &&
            t >= regionBarStart - eps &&
            regionBarStart <= span.startSec + eps
        );
    }

    function findPlaybackRegionSpanForTransportSec(spans, transportSec, barBoundaries) {
        const activeSlot =
            typeof getActiveMixExtraSlotFromDom === 'function'
                ? getActiveMixExtraSlotFromDom()
                : -1;
        let best = null;
        for (let i = 0; i < spans.length; i++) {
            const span = spans[i];
            if (!playbackRegionSpanContainsTransport(span, transportSec, barBoundaries, spans)) {
                continue;
            }
            if (!best) {
                best = span;
                continue;
            }
            if (span.startSec > best.startSec + 1e-9) {
                best = span;
                continue;
            }
            if (Math.abs(span.startSec - best.startSec) <= 1e-9) {
                if (activeSlot >= 0) {
                    if (span.slot === activeSlot && best.slot !== activeSlot) {
                        best = span;
                        continue;
                    }
                    if (best.slot === activeSlot && span.slot !== activeSlot) continue;
                }
                if (span.slot === best.slot && span.segmentIndex > best.segmentIndex) {
                    best = span;
                }
            }
        }
        return best;
    }

    function playbackRegionSpanForTrackSegment(spans, slot, segmentIndex, startSec, endSec) {
        for (let i = 0; i < spans.length; i++) {
            const span = spans[i];
            if (span.slot === slot && span.segmentIndex === segmentIndex) return span;
        }
        return { slot, segmentIndex, startSec, endSec };
    }

    /** 指定トラック上で seek 秒が Region In〜Out 内にあるセグメント（後続セグメント優先） */
    function resolveRegionSegmentAtTransportForTrack(track, transportSec) {
        const t = Number(transportSec);
        if (!Number.isFinite(t) || !track) return null;
        if (typeof isTrackRegionActive !== 'function' || !isTrackRegionActive(track)) {
            return null;
        }
        const segCount =
            typeof getSegmentCount === 'function' ? getSegmentCount(track) : 0;
        let best = null;
        const eps = 1e-4;
        for (let si = 0; si < segCount; si++) {
            let startSec = null;
            let endSec = null;
            if (typeof getSegmentRegionTimelineIn === 'function') {
                startSec = getSegmentRegionTimelineIn(track, si);
            }
            if (typeof getSegmentRegionTimelineOut === 'function') {
                endSec = getSegmentRegionTimelineOut(track, si);
            }
            if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;
            if (endSec <= startSec + eps) continue;
            if (t < startSec - eps || t >= endSec - eps) continue;
            if (!best || si > best.segmentIndex) {
                best = { slot: track.slot | 0, segmentIndex: si, startSec, endSec };
            }
        }
        return best;
    }

    function collectRegionBarJumpSlotPriority() {
        const slots = [];
        const pushSlot = (slot) => {
            const s = slot | 0;
            if (s < 0 || slots.indexOf(s) >= 0) return;
            slots.push(s);
        };
        if (typeof window.resolveTargetExtraSlot === 'function') {
            pushSlot(window.resolveTargetExtraSlot());
        }
        if (typeof getActiveMixExtraSlotFromDom === 'function') {
            pushSlot(getActiveMixExtraSlotFromDom());
        }
        if (typeof window.getLastActiveMixExtraSlot === 'function') {
            pushSlot(window.getLastActiveMixExtraSlot());
        }
        const trackCount =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;
        for (let slot = 0; slot < trackCount; slot++) {
            pushSlot(slot);
        }
        return slots;
    }

    /** シークバー現在地が属するリージョン（小節番号ラベルと同じ In〜Out 基準） */
    function resolvePlaybackRegionSpanAtSeekbar(spans, transportSec, barBoundaries) {
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return null;
        const slotOrder = collectRegionBarJumpSlotPriority();
        for (let i = 0; i < slotOrder.length; i++) {
            const slot = slotOrder[i];
            const track = { type: 'extra', slot };
            const hit = resolveRegionSegmentAtTransportForTrack(track, t);
            if (!hit) continue;
            return playbackRegionSpanForTrackSegment(
                spans,
                hit.slot,
                hit.segmentIndex,
                hit.startSec,
                hit.endSec,
            );
        }
        return findPlaybackRegionSpanForTransportSec(spans, t, barBoundaries);
    }

    function regionBarStartIndexForSpan(span, barBoundaries) {
        const regionBarStart = regionBarStartBoundarySec(span.startSec, barBoundaries);
        let idx = barLineIndexForSec(regionBarStart, barBoundaries);
        if (idx < 0) {
            idx = barIndexForBoundarySec(span.startSec, barBoundaries);
        }
        return idx;
    }

    function secForRegionLocalBarNumber(span, localBar, barBoundaries, spans) {
        const n = localBar | 0;
        if (!span || n < 1 || !barBoundaries || !barBoundaries.length) return null;
        const regionBarStartIdx = regionBarStartIndexForSpan(span, barBoundaries);
        if (n === 1) {
            const sec = span.startSec;
            return sec < span.endSec - 1e-4 ? sec : null;
        }
        const targetIdx = regionBarStartIdx + n - 1;
        if (targetIdx < 0 || targetIdx >= barBoundaries.length - 1) return null;
        const sec = barBoundaries[targetIdx];
        if (!barLineBelongsToRegionSpan(span, sec, barBoundaries, spans)) return null;
        if (sec >= span.endSec - 1e-4) return null;
        return sec;
    }

    /** Rehearsal Mark 区間内の localBar 小節の開始秒 */
    function secForRehearsalMarkLocalBarNumber(rehearsalRange, localBar, barBoundaries) {
        const n = localBar | 0;
        if (!rehearsalRange || n < 1 || !barBoundaries || !barBoundaries.length) return null;
        const eps = 1e-4;
        if (n === 1) {
            const sec = rehearsalRange.startSec;
            return sec < rehearsalRange.endSec - eps ? sec : null;
        }
        const rehearsalStartIdx = barIndexForBoundarySec(rehearsalRange.startSec, barBoundaries);
        if (rehearsalStartIdx < 0) return null;
        const targetIdx = rehearsalStartIdx + n - 1;
        if (targetIdx < 0 || targetIdx >= barBoundaries.length - 1) return null;
        const sec = barBoundaries[targetIdx];
        if (sec >= rehearsalRange.endSec - eps) return null;
        return sec;
    }

    function seekToRegionLocalBarSec(targetSec, localBar, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const resumeAfter = !!o.resumeAfterSeek;
        let target = targetSec;
        if (typeof clampTransportSec === 'function') {
            target = clampTransportSec(target);
        }
        if (typeof suppressRangeLoopSnapForExplicitSeek === 'function') {
            suppressRangeLoopSnapForExplicitSeek();
        }
        const hintTc =
            typeof formatTimecodeForTransport === 'function'
                ? formatTimecodeForTransport(target)
                : String(target);
        const hintTitle =
            o.localBarJumpHintTitle != null && String(o.localBarJumpHintTitle).trim() !== ''
                ? String(o.localBarJumpHintTitle).trim()
                : o.measureTrackHint && typeof musicalGridSeekToastPrimary === 'function'
                  ? musicalGridSeekToastPrimary(target)
                  : 'Measure ' + (localBar | 0);
        if (
            o.discreteStopNav !== false &&
            typeof applyDiscreteStopNavStep === 'function'
        ) {
            applyDiscreteStopNavStep(target, {
                resumeAfterSeek: resumeAfter,
                fromRepeat: o.fromRepeat,
            });
            if (!o.fromRepeat && typeof writeLog === 'function') {
                writeLog('Measure jump: ' + hintTitle + ' @ ' + hintTc);
            }
            if (o.measureTrackHint && typeof flashMusicalGridSeekHint === 'function') {
                flashMusicalGridSeekHint(target, hintTc);
            } else if (typeof flashSeekHint === 'function') {
                flashSeekHint(hintTitle, hintTc);
            }
            return true;
        }
        if (typeof applyJumpTransportSeek === 'function') {
            applyJumpTransportSeek(target, resumeAfter);
        } else if (typeof applyTransportAtSec === 'function') {
            applyTransportAtSec(target, { resumeAfter: resumeAfter });
        } else if (typeof applyTimeToVideo === 'function') {
            applyTimeToVideo(target);
        }
        if (typeof syncTransportSeekUi === 'function') {
            syncTransportSeekUi(target);
        } else if (typeof setTransportSec === 'function') {
            setTransportSec(target);
        }
        if (typeof updateAllWaveformPlayheads === 'function') {
            updateAllWaveformPlayheads();
        }
        if (typeof writeLog === 'function') {
            writeLog('Measure jump: ' + hintTitle + ' @ ' + hintTc);
        }
        if (o.measureTrackHint && typeof flashMusicalGridSeekHint === 'function') {
            flashMusicalGridSeekHint(target, hintTc);
        } else if (typeof flashSeekHint === 'function') {
            flashSeekHint(hintTitle, hintTc);
        }
        return true;
    }

    function regionBarJumpDiagLog(step, detail) {
        if (typeof writeDiagLog === 'function') {
            writeDiagLog('REGION_BAR_JUMP', step, detail);
        }
    }

    /** Measure トラック（collectBarMeasureSegments）と同じタイムライン全体の小節番号 → 小節開始秒 */
    function secForMeasureTrackBarNumber(measureNumber, meterSpec, master) {
        const n = measureNumber | 0;
        if (n < 1 || !(master > 0) || !meterSpec) return null;
        const boundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(meterSpec, master)
                : collectBarBoundarySecs(meterSpec, master);
        if (!boundaries || boundaries.length < 2) return null;
        const barIndex = n - 1;
        if (barIndex < 0 || barIndex >= boundaries.length - 1) return null;
        return boundaries[barIndex];
    }

    function jumpToMeasureTrackBarNumber(measureNumber, opt) {
        if (!getMusicalGridVisible()) return false;
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return false;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return false;
        const n = measureNumber | 0;
        const targetSec = secForMeasureTrackBarNumber(n, settings.meterSpec, master);
        const t =
            typeof getTransportSec === 'function'
                ? getTransportSec()
                : typeof videoMain !== 'undefined' && videoMain
                  ? videoMain.currentTime || 0
                  : 0;
        if (!Number.isFinite(targetSec)) {
            regionBarJumpDiagLog('resolve/miss', {
                measureNumber: n,
                transportSec: t,
                reason: 'measure out of timeline range',
                scope: 'measure-track',
            });
            return false;
        }
        regionBarJumpDiagLog('resolve/hit', {
            measureNumber: n,
            transportSec: t,
            targetSec,
            scope: 'measure-track',
        });
        const seekOpt = Object.assign({}, opt || {}, { measureTrackHint: true });
        return seekToRegionLocalBarSec(targetSec, n, seekOpt);
    }

    function rehearsalLocalBarJumpGroupLabel(rehearsalRange) {
        if (!rehearsalRange) return 'Rehearsal';
        const fromMark =
            typeof rehearsalRehearsalMarkFromRange === 'function'
                ? rehearsalRehearsalMarkFromRange(rehearsalRange)
                : '';
        if (fromMark) return fromMark;
        const rawLabel =
            rehearsalRange.label != null ? String(rehearsalRange.label).trim() : '';
        if (rawLabel) return rawLabel;
        if (rehearsalRange.paletteIndex != null) {
            return rehearsalGroupLabelForIndex(rehearsalRange.paletteIndex);
        }
        return 'Rehearsal';
    }

    function localBarJumpToastTitle(localBar, rehearsalRange, scope) {
        const n = localBar | 0;
        if (scope === 'rehearsal-mark') {
            return rehearsalLocalBarJumpGroupLabel(rehearsalRange) + ' · ' + n;
        }
        if (scope === 'region') {
            return 'M' + n;
        }
        return 'Measure ' + n;
    }

    function maxLocalBarNumberForRehearsalRange(rehearsalRange, barBoundaries) {
        if (!rehearsalRange || !barBoundaries || !barBoundaries.length) return 0;
        let maxLocal = 0;
        for (let b = 1; b <= 999; b++) {
            if (
                Number.isFinite(
                    secForRehearsalMarkLocalBarNumber(rehearsalRange, b, barBoundaries),
                )
            ) {
                maxLocal = b;
            } else {
                break;
            }
        }
        return maxLocal;
    }

    let regionBarJumpLastSkipDetail = null;

    function buildRegionBarJumpSkipDetail(measureNumber, reason, rehearsalRange, barBoundaries) {
        const n = measureNumber | 0;
        if (reason === 'no-rehearsal-at-playhead') {
            return { title: 'Rehearsal · ' + n, detail: 'No rehearsal here' };
        }
        if (rehearsalRange) {
            const title = localBarJumpToastTitle(n, rehearsalRange, 'rehearsal-mark');
            const maxLocal = maxLocalBarNumberForRehearsalRange(rehearsalRange, barBoundaries);
            if (maxLocal > 0) {
                return { title, detail: 'Out of range (1–' + maxLocal + ')' };
            }
            return { title, detail: 'Out of range' };
        }
        return { title: localBarJumpToastTitle(n, null, 'region'), detail: 'Unavailable' };
    }

    /** Shift+数字 / テンキー — Rehearsal 区間内、または Rehearsal 未定義時はリージョン内のローカル小節番号へ */
    function jumpToRegionLocalBarNumber(localBar, opt) {
        regionBarJumpLastSkipDetail = null;
        if (!getMusicalGridVisible()) return false;
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return false;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return false;
        const spans = collectPlaybackRegionSpansForBarLabels();
        if (!spans.length) return false;
        const barBoundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(settings.meterSpec, master)
                : collectBarBoundarySecs(settings.meterSpec, master);
        if (!barBoundaries.length) return false;
        const t =
            typeof getTransportSec === 'function'
                ? getTransportSec()
                : typeof videoMain !== 'undefined' && videoMain
                  ? videoMain.currentTime || 0
                  : 0;
        const measureNumber = localBar | 0;
        const rehearsalRanges =
            typeof getRehearsalMarkNavRanges === 'function'
                ? getRehearsalMarkNavRanges()
                : resolveRehearsalGroupRanges({ requireFillVisible: false });
        if (rehearsalRanges.length) {
            const rehearsalRange = rehearsalRangeAfterGridBoundarySec(t);
            if (!rehearsalRange) {
                regionBarJumpDiagLog('resolve/miss', {
                    measureNumber,
                    transportSec: t,
                    reason: 'no rehearsal at playhead',
                    scope: 'rehearsal-mark',
                });
                regionBarJumpLastSkipDetail = buildRegionBarJumpSkipDetail(
                    measureNumber,
                    'no-rehearsal-at-playhead',
                    null,
                    barBoundaries,
                );
                return false;
            }
            const rehearsalTargetSec = secForRehearsalMarkLocalBarNumber(
                rehearsalRange,
                measureNumber,
                barBoundaries,
            );
            if (Number.isFinite(rehearsalTargetSec)) {
                regionBarJumpDiagLog('resolve/hit', {
                    measureNumber,
                    transportSec: t,
                    targetSec: rehearsalTargetSec,
                    scope: 'rehearsal-mark',
                });
                const seekOpt = Object.assign({}, opt || {}, {
                    localBarJumpHintTitle: localBarJumpToastTitle(
                        measureNumber,
                        rehearsalRange,
                        'rehearsal-mark',
                    ),
                });
                return seekToRegionLocalBarSec(rehearsalTargetSec, measureNumber, seekOpt);
            }
            regionBarJumpDiagLog('resolve/miss', {
                measureNumber,
                transportSec: t,
                reason: 'bar out of rehearsal range',
                scope: 'rehearsal-mark',
            });
            regionBarJumpLastSkipDetail = buildRegionBarJumpSkipDetail(
                measureNumber,
                'bar out of rehearsal range',
                rehearsalRange,
                barBoundaries,
            );
            return false;
        }
        const span = resolvePlaybackRegionSpanAtSeekbar(spans, t, barBoundaries);
        if (!span) {
            regionBarJumpDiagLog('resolve/miss', {
                measureNumber,
                transportSec: t,
                reason: 'no region at seekbar',
            });
            regionBarJumpLastSkipDetail = buildRegionBarJumpSkipDetail(
                measureNumber,
                'no region at seekbar',
                null,
                barBoundaries,
            );
            return false;
        }
        const targetSec = secForRegionLocalBarNumber(span, measureNumber, barBoundaries, spans);
        if (!Number.isFinite(targetSec)) {
            regionBarJumpDiagLog('resolve/miss', {
                measureNumber,
                transportSec: t,
                reason: 'bar out of region range',
            });
            regionBarJumpLastSkipDetail = buildRegionBarJumpSkipDetail(
                measureNumber,
                'bar out of region range',
                null,
                barBoundaries,
            );
            return false;
        }
        regionBarJumpDiagLog('resolve/hit', {
            measureNumber,
            transportSec: t,
            targetSec,
            scope: 'region',
        });
        const seekOpt = Object.assign({}, opt || {}, {
            localBarJumpHintTitle: localBarJumpToastTitle(measureNumber, null, 'region'),
        });
        return seekToRegionLocalBarSec(targetSec, measureNumber, seekOpt);
    }

    function logMeasureTrackJumpSkipped(barNum) {
        regionBarJumpDiagLog('resolve/skipped', {
            measureNumber: barNum | 0,
            reason: 'grid off or measure number out of range',
            scope: 'measure-track',
        });
        if (typeof writeLog !== 'function') return;
        writeLog(
            'Measure track jump skipped (Measure ' + (barNum | 0) + ' — out of timeline range)',
        );
    }

    function notifyRegionBarJumpSkipped(barNum, skipDetail) {
        const n = barNum | 0;
        const detail =
            skipDetail && typeof skipDetail === 'object'
                ? skipDetail
                : buildRegionBarJumpSkipDetail(n, 'unknown', null, null);
        regionBarJumpDiagLog('resolve/skipped', {
            measureNumber: n,
            reason: detail.detail,
            title: detail.title,
        });
        if (typeof writeLog === 'function') {
            writeLog('Measure jump skipped: ' + detail.title + ' — ' + detail.detail);
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint(detail.title, detail.detail, 'error');
        }
    }

    let regionBarJumpDigitBuf = '';
    let regionBarJumpDigitTimer = null;
    const REGION_BAR_JUMP_DIGIT_TIMEOUT_MS = 300;
    const REGION_BAR_JUMP_MAX_DIGITS = 3;

    function flushRegionBarJumpDigitBuffer() {
        const buf = regionBarJumpDigitBuf;
        regionBarJumpDigitBuf = '';
        regionBarJumpDigitTimer = null;
        const barNum = parseInt(buf, 10);
        if (!Number.isFinite(barNum) || barNum < 1) return;
        const wasPlaying =
            typeof isTransportPlaying === 'function'
                ? isTransportPlaying()
                : typeof videoMain !== 'undefined' && videoMain && !videoMain.paused;
        if (!jumpToRegionLocalBarNumber(barNum, { resumeAfterSeek: wasPlaying })) {
            notifyRegionBarJumpSkipped(barNum, regionBarJumpLastSkipDetail);
        }
    }

    function scheduleRegionBarJumpFromBuffer() {
        if (regionBarJumpDigitTimer != null) {
            clearTimeout(regionBarJumpDigitTimer);
        }
        regionBarJumpDigitTimer = setTimeout(
            flushRegionBarJumpDigitBuffer,
            REGION_BAR_JUMP_DIGIT_TIMEOUT_MS,
        );
    }

    function handleRegionBarNumberJumpKeydown(e) {
        const digit =
            typeof window.getRegionBarJumpDigit === 'function'
                ? window.getRegionBarJumpDigit(e)
                : typeof window.getShiftSeekDigit === 'function'
                  ? window.getShiftSeekDigit(e)
                  : null;
        if (digit == null) return false;
        if (e.repeat) return false;
        if (
            typeof transportControlsReady === 'function' &&
            !transportControlsReady()
        ) {
            return false;
        }
        if (!getMusicalGridVisible()) return false;

        if (regionBarJumpDigitBuf !== '' && regionBarJumpDigitTimer != null) {
            const composed = regionBarJumpDigitBuf + String(digit);
            if (composed.length > REGION_BAR_JUMP_MAX_DIGITS) {
                regionBarJumpDigitBuf = String(digit);
            } else {
                regionBarJumpDigitBuf = composed;
            }
        } else {
            regionBarJumpDigitBuf = String(digit);
        }

        const pendingBar = parseInt(regionBarJumpDigitBuf, 10);
        if (!Number.isFinite(pendingBar) || pendingBar < 1) {
            regionBarJumpDigitBuf = '';
            if (regionBarJumpDigitTimer != null) {
                clearTimeout(regionBarJumpDigitTimer);
                regionBarJumpDigitTimer = null;
            }
            return false;
        }

        e.preventDefault();
        scheduleRegionBarJumpFromBuffer();
        return true;
    }

    let regionBarJumpDialogOpen = false;

    function parseRegionBarJumpDialogNumber(raw) {
        const text = raw != null ? String(raw).trim() : '';
        if (!/^\d+$/.test(text)) return null;
        const barNum = parseInt(text, 10);
        if (!Number.isFinite(barNum) || barNum < 0) return null;
        return barNum;
    }

    function readRegionBarJumpNumberFromOverlay() {
        return new Promise((resolve) => {
            const root = regionBarJumpOverlay;
            const input = regionBarJumpInput;
            if (!root || !input) {
                resolve(null);
                return;
            }
            input.value = '';
            root.hidden = false;
            root.setAttribute('aria-hidden', 'false');
            const finish = (value) => {
                root.hidden = true;
                root.setAttribute('aria-hidden', 'true');
                input.removeEventListener('keydown', onInputKey);
                if (input === document.activeElement && input.blur) input.blur();
                if (typeof scheduleWaveformFocusRestore === 'function') {
                    scheduleWaveformFocusRestore();
                }
                resolve(value);
            };
            const cancelBarJumpDialog = () => {
                if (typeof writeLog === 'function') {
                    writeLog('Measure jump cancelled');
                }
                finish(null);
            };
            const onInputKey = (e) => {
                if (matchUserShortcut(e, 'cancelEditing', { allowRepeat: true })) {
                    e.preventDefault();
                    cancelBarJumpDialog();
                    return;
                }
                if (matchUserShortcut(e, 'submitEditing', { allowRepeat: true })) {
                    e.preventDefault();
                    const barNum = parseRegionBarJumpDialogNumber(input.value);
                    if (barNum == null) {
                        cancelBarJumpDialog();
                        return;
                    }
                    finish(barNum);
                }
            };
            input.addEventListener('keydown', onInputKey);
            requestAnimationFrame(() => {
                input.focus();
                input.select();
            });
        });
    }

    async function openRegionBarJumpDialog() {
        if (regionBarJumpDialogOpen) return;
        regionBarJumpDialogOpen = true;
        try {
            const barNum = await readRegionBarJumpNumberFromOverlay();
            if (barNum == null) return;
            const wasPlaying =
                typeof isTransportPlaying === 'function'
                    ? isTransportPlaying()
                    : typeof videoMain !== 'undefined' && videoMain && !videoMain.paused;
            if (!jumpToMeasureTrackBarNumber(barNum, { resumeAfterSeek: wasPlaying })) {
                logMeasureTrackJumpSkipped(barNum);
                if (typeof flashSeekHint === 'function') {
                    flashSeekHint('Measure ' + barNum, 'Unavailable', 'error');
                }
            }
        } finally {
            regionBarJumpDialogOpen = false;
        }
    }

    function handleRegionBarJumpDialogKeydown(e) {
        if (e.repeat) return false;
        if (
            typeof transportControlsReady === 'function' &&
            !transportControlsReady()
        ) {
            return false;
        }
        if (!getMusicalGridVisible()) return false;
        if (regionBarJumpDialogOpen) return false;
        e.preventDefault();
        void openRegionBarJumpDialog();
        return true;
    }

    /** Tempo/Sig ON 時 — 小節線（赤）の右に、リージョン内の 1 小節目からの番号を描画（Rehearsal 定義あり時は小節線の属するRehearsal 区間基準） */
    const REGION_BAR_NUMBER_LABEL_FONT_PX = 10;
    const REGION_BAR_NUMBER_LABEL_Y = 8;
    const REGION_BAR_NUMBER_LABEL_X_OFFSET = 3;

    function localBarNumberLabelForBarLine(lineSec, barBoundaries, rehearsalRanges, span) {
        if (rehearsalRanges && rehearsalRanges.length) {
            const rehearsalRange = rehearsalRangeAfterGridBoundarySec(lineSec);
            if (!rehearsalRange) return null;
            return localBarNumberForRehearsalAtSec(rehearsalRange.startSec, lineSec, barBoundaries);
        }
        if (!span) return null;
        return localBarNumberForRegionBarLine(span.startSec, lineSec, barBoundaries);
    }

    function drawRegionBarNumberLabels(ctx, w, _h, master, barLines, meterSpec) {
        if (!getMusicalGridVisible() || !barLines.length || !meterSpec) return;
        const spans = collectPlaybackRegionSpansForBarLabels();
        if (!spans.length) return;
        const barBoundaries =
            typeof collectPlaybackAlignedBarBoundarySecs === 'function'
                ? collectPlaybackAlignedBarBoundarySecs(meterSpec, master)
                : collectBarBoundarySecs(meterSpec, master);
        if (!barBoundaries.length) return;
        const rehearsalRanges =
            typeof getRehearsalMarkNavRanges === 'function'
                ? getRehearsalMarkNavRanges()
                : resolveRehearsalGroupRanges({ requireFillVisible: false });
        const useRehearsalBarNumbers = rehearsalRanges.length > 0;
        const secToX = (sec) => (sec / master) * w;
        const fontPx = REGION_BAR_NUMBER_LABEL_FONT_PX;
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = '400 ' + fontPx + 'px system-ui, "Segoe UI", sans-serif';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
        ctx.fillStyle = 'rgba(255, 230, 80, 0.95)';

        function drawLabelAtSec(sec, label) {
            const x = secToX(sec);
            if (x < -0.5 || x > w + 0.5) return;
            const xi = Math.round(x) + 0.5;
            const labelX = xi + REGION_BAR_NUMBER_LABEL_X_OFFSET;
            const labelY = REGION_BAR_NUMBER_LABEL_Y;
            ctx.strokeText(label, labelX, labelY);
            ctx.fillText(label, labelX, labelY);
        }

        for (let i = 0; i < barLines.length; i++) {
            const line = barLines[i];
            if (!line || line.kind !== 'bar' || !Number.isFinite(line.sec)) continue;
            const span = findPlaybackRegionSpanForBarLine(spans, line.sec, barBoundaries);
            if (!span) continue;
            const localBar = localBarNumberLabelForBarLine(
                line.sec,
                barBoundaries,
                useRehearsalBarNumbers ? rehearsalRanges : null,
                span,
            );
            if (!localBar) continue;
            drawLabelAtSec(line.sec, String(localBar));
        }

        if (!useRehearsalBarNumbers) {
            for (let si = 0; si < spans.length; si++) {
                const span = spans[si];
                if (regionSpanHasBarOneLabelAtIn(span, barLines, barBoundaries, spans)) continue;
                if (
                    span.startSec < span.endSec - 1e-6 &&
                    span.startSec >= 0 &&
                    span.startSec < master - 1e-6
                ) {
                    drawLabelAtSec(span.startSec, '1');
                }
            }
        }
        ctx.restore();
    }

    function drawMusicalGridOverlay() {
        drawRehearsalFillOverlay();
        drawBarLinesOverlay();
        const sized = ensureMusicalGridCanvasSized();
        if (!sized || !musicalGridCanvas) {
            if (musicalGridCanvas) {
                const ctx = musicalGridCanvas.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, musicalGridCanvas.width, musicalGridCanvas.height);
            }
            return;
        }
        const { ctx, w, h, layoutW, xOffset } = sized;
        ctx.clearRect(0, 0, w, h);
        const settings = musicalGridDrawSettings();
        if (!settings) return;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;
        if (!(master > 0)) return;
        ctx.save();
        if (xOffset) ctx.translate(-xOffset, 0);
        if (getMusicalGridVisible()) {
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            const zoom =
                typeof getWaveformTimelineZoom === 'function' ? getWaveformTimelineZoom() : 1;
            const showBeats = zoom >= 10;
            const lines = collectMusicalGridLines(settings.meterSpec, master, {
                showBeats,
            });
            const linePx =
                typeof timelineSecToContentLinePx === 'function'
                    ? timelineSecToContentLinePx
                    : (sec) => Math.round((sec / master) * layoutW) + 0.5;
            const visMin = xOffset - 0.5;
            const visMax = xOffset + w + 0.5;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.kind === 'bar') continue;
                const xi = linePx(line.sec);
                if (xi < visMin || xi > visMax) continue;
                ctx.strokeStyle = 'rgba(0, 220, 255, 0.45)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(xi, 0);
                ctx.lineTo(xi, h);
                ctx.stroke();
            }
            ctx.restore();
        }
        ctx.restore();
        if (!rehearsalBoundaryDragActive) updateRehearsalBoundaryOverlay();
        if (typeof refreshMusicalGridTracks === 'function') refreshMusicalGridTracks();
    }
