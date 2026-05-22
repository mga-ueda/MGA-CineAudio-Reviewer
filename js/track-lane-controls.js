(function trackLaneControlsModule() {
    const TRACK_LANE_METER_BUF = new Uint8Array(128);

    const laneUi = {
        video: {
            meterBar: document.getElementById('trackLaneMeterVideo'),
            meterDb: document.getElementById('trackLaneMeterDbVideo'),
            fader: document.getElementById('trackLaneFaderVideo'),
            faderDb: document.getElementById('trackLaneFaderDbVideo'),
        },
        extra: [
            {
                meterBar: document.getElementById('trackLaneMeter0'),
                meterDb: document.getElementById('trackLaneMeterDb0'),
                fader: document.getElementById('trackLaneFader0'),
                faderDb: document.getElementById('trackLaneFaderDb0'),
            },
            {
                meterBar: document.getElementById('trackLaneMeter1'),
                meterDb: document.getElementById('trackLaneMeterDb1'),
                fader: document.getElementById('trackLaneFader1'),
                faderDb: document.getElementById('trackLaneFaderDb1'),
            },
        ],
    };

    function defaultFaderPos() {
        return typeof TRACK_LANE_FADER_POS_UNITY === 'number'
            ? TRACK_LANE_FADER_POS_UNITY
            : 700;
    }

    function readFaderLinear(el) {
        if (!el || typeof trackLaneLinearGainFromFaderPos !== 'function') {
            return typeof trackLaneClampGainLinear === 'function'
                ? trackLaneClampGainLinear(1)
                : 1;
        }
        return trackLaneLinearGainFromFaderPos(el.value);
    }

    function formatLaneMeterDbFromPct(pct) {
        const p = Math.max(0, Math.min(100, pct)) / 100;
        const db = p <= 1e-8 ? -96 : 20 * Math.log10(p);
        if (typeof trackLaneFormatDbValue === 'function') {
            return trackLaneFormatDbValue(db) + ' dB';
        }
        const digits = Math.abs(db) >= 10 ? 0 : 1;
        const s = db.toFixed(digits);
        const v = db > 0 ? '+' + s : s;
        return v + ' dB';
    }

    function formatFaderDbLabel(linear) {
        if (typeof trackLaneFormatFaderDb === 'function') {
            return trackLaneFormatFaderDb(linear);
        }
        return '0.0 dB';
    }

    function syncFaderFromVol(el, vol) {
        if (!el) return;
        const pos =
            typeof trackLaneFaderPosFromLinearGain === 'function'
                ? trackLaneFaderPosFromLinearGain(vol)
                : defaultFaderPos();
        el.value = String(pos);
        syncFaderDbLabel(el);
    }

    function syncFaderDbLabel(faderEl) {
        if (!faderEl) return;
        const dbEl = document.getElementById(
            faderEl.id.replace('trackLaneFader', 'trackLaneFaderDb'),
        );
        if (dbEl) {
            dbEl.textContent = formatFaderDbLabel(readFaderLinear(faderEl));
        }
    }

    function setMeterBarPct(barEl, pct) {
        if (!barEl) return 0;
        const p = Math.max(0, Math.min(100, pct));
        barEl.style.width = p + '%';
        return p;
    }

    function meterLevelFromAnalyser(analyser, silent) {
        if (silent || !analyser) {
            return { pct: 0, dbText: formatLaneMeterDbFromPct(0) };
        }
        analyser.getByteFrequencyData(TRACK_LANE_METER_BUF);
        let max = 0;
        for (let i = 0; i < TRACK_LANE_METER_BUF.length; i++) {
            if (TRACK_LANE_METER_BUF[i] > max) max = TRACK_LANE_METER_BUF[i];
        }
        const pct = (max / 255) * 100;
        return { pct, dbText: formatLaneMeterDbFromPct(pct) };
    }

    function isVideoLaneMeterSilent() {
        if (typeof isVideoTrackLaneMeterSilent === 'function') {
            return isVideoTrackLaneMeterSilent();
        }
        return true;
    }

    function isExtraLaneMeterSilent(slot) {
        if (typeof isExtraTrackLaneMeterSilent === 'function') {
            return isExtraTrackLaneMeterSilent(slot);
        }
        return true;
    }

    function updateLaneMeter(ui, analyser, silent) {
        const m = meterLevelFromAnalyser(analyser, silent);
        setMeterBarPct(ui.meterBar, m.pct);
        if (ui.meterDb) ui.meterDb.textContent = m.dbText;
    }

    function updateTrackLaneMeters() {
        const vAna =
            typeof getVideoTrackAnalyser === 'function' ? getVideoTrackAnalyser() : null;
        updateLaneMeter(laneUi.video, vAna, isVideoLaneMeterSilent());

        for (let slot = 0; slot < laneUi.extra.length; slot++) {
            const ana =
                typeof getExtraTrackAnalyser === 'function'
                    ? getExtraTrackAnalyser(slot)
                    : null;
            updateLaneMeter(laneUi.extra[slot], ana, isExtraLaneMeterSilent(slot));
        }
    }

    function extinguishTrackLaneMeters() {
        updateLaneMeter(laneUi.video, null, true);
        for (let i = 0; i < laneUi.extra.length; i++) {
            updateLaneMeter(laneUi.extra[i], null, true);
        }
    }

    function refreshFaderDbLabels() {
        if (laneUi.video.fader) syncFaderDbLabel(laneUi.video.fader);
        for (let i = 0; i < laneUi.extra.length; i++) {
            if (laneUi.extra[i].fader) syncFaderDbLabel(laneUi.extra[i].fader);
        }
    }

    function refreshTrackLaneControlsUi() {
        const videoReadyNow = typeof videoReady === 'function' && videoReady();
        if (laneUi.video.fader) {
            laneUi.video.fader.disabled = !videoReadyNow;
            if (typeof getVideoTrackVolLinear === 'function') {
                syncFaderFromVol(laneUi.video.fader, getVideoTrackVolLinear());
            } else {
                syncFaderDbLabel(laneUi.video.fader);
            }
        }

        for (let slot = 0; slot < laneUi.extra.length; slot++) {
            const ui = laneUi.extra[slot];
            const loaded =
                typeof isExtraTrackLoaded === 'function' && isExtraTrackLoaded(slot);
            if (ui.fader) {
                ui.fader.disabled = !loaded;
                if (typeof getExtraTrackVolLinear === 'function') {
                    syncFaderFromVol(ui.fader, getExtraTrackVolLinear(slot));
                } else {
                    syncFaderDbLabel(ui.fader);
                }
            }
        }
    }

    function applyFaderLinearFromElement(faderEl, extraSlot) {
        if (!faderEl) return;
        const v = readFaderLinear(faderEl);
        syncFaderDbLabel(faderEl);
        if (extraSlot === 'video') {
            if (typeof setVideoTrackVolLinear === 'function') {
                setVideoTrackVolLinear(v);
            }
        } else if (typeof extraSlot === 'number') {
            if (typeof setExtraTrackVolLinear === 'function') {
                setExtraTrackVolLinear(extraSlot, v);
            }
        }
        if (typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
    }

    function resetLaneFaderToZeroDb(faderEl, extraSlot) {
        if (!faderEl || faderEl.disabled) return;
        faderEl.value = String(defaultFaderPos());
        applyFaderLinearFromElement(faderEl, extraSlot);
    }

    function bindLaneFaderInputAndReset(faderEl, extraSlot) {
        if (!faderEl || faderEl.dataset.bound === '1') return;
        faderEl.dataset.bound = '1';
        faderEl.addEventListener('input', () => {
            applyFaderLinearFromElement(faderEl, extraSlot);
        });
        faderEl.addEventListener('dblclick', (ev) => {
            ev.preventDefault();
            resetLaneFaderToZeroDb(faderEl, extraSlot);
        });
    }

    function bindTrackLaneFaders() {
        bindLaneFaderInputAndReset(laneUi.video.fader, 'video');
        for (let slot = 0; slot < laneUi.extra.length; slot++) {
            bindLaneFaderInputAndReset(laneUi.extra[slot].fader, slot);
        }
    }

    function initTrackLaneControlsUi() {
        bindTrackLaneFaders();
        refreshTrackLaneControlsUi();
        refreshFaderDbLabels();
        extinguishTrackLaneMeters();
    }

    window.updateTrackLaneMeters = updateTrackLaneMeters;
    window.extinguishTrackLaneMeters = extinguishTrackLaneMeters;
    window.refreshTrackLaneControlsUi = refreshTrackLaneControlsUi;
    window.initTrackLaneControlsUi = initTrackLaneControlsUi;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTrackLaneControlsUi);
    } else {
        initTrackLaneControlsUi();
    }
})();
