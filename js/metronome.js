/**
 * metronome.js — Click ON かつ再生中、BPM/拍子グリッドに同期したクリックを鳴らす。
 */
(function metronomeModule() {
    const METRONOME_SCHEDULE_AHEAD_SEC = 3;
    const METRONOME_MIN_BEAT_GAP_SEC = 0.02;
    const METRONOME_SCHEDULE_MIN_LEAD_SEC = 0.004;
    /**
     * RMS 未取得時のフォールバック（Master Vol × 基準）。
     * 通常はミックス RMS + METRONOME_DB_ABOVE_MIX_RMS で決まる。
     */
    const METRONOME_BASE_GAIN_LEVEL = 0.08;
    /** ミックス RMS よりクリックを何 dB 大きく聴こえるか */
    const METRONOME_DB_ABOVE_MIX_RMS = 12;
    /** クリック出力の上限（フルスケール線形） */
    const METRONOME_MAX_GAIN_LEVEL = 0.5;
    const METRONOME_MIN_GAIN_DB = -30;
    const METRONOME_MIN_GAIN_LINEAR = Math.pow(10, METRONOME_MIN_GAIN_DB / 20);
    /** Master Vol 変更への追従を遅くする（秒）。 */
    const METRONOME_GAIN_SMOOTH_SEC = 0.85;
    const METRONOME_GAIN_TARGET_EPS = 0.0004;
    /** RAF がバックグラウンドで止まっても先読みを維持（Chrome は約 1 Hz に間引く） */
    const METRONOME_SYNC_INTERVAL_MS = 400;
    /** 連続再生中の transport 更新幅より大きい変化 = シーク／ジャンプ */
    const METRONOME_TRANSPORT_JUMP_SEC =
        METRONOME_SYNC_INTERVAL_MS / 1000 + METRONOME_MIN_BEAT_GAP_SEC + 0.2;

    const METRONOME_WAV = {
        accent: 'wav/High.wav',
        beat: 'wav/Low.wav',
    };

    let metronomeGain = null;
    let metronomeRoutingCtx = null;
    let metronomeClickBuffers = null;
    let metronomeWavBytesPromise = null;
    let metronomeDecodePromise = null;
    let metronomeLastScheduledBeatSec = -Infinity;
    let metronomeMeterKey = '';
    let metronomeActive = false;
    let metronomeScan = { meterKey: '', barIndex: 0, barStartSec: 0 };
    let metronomeSyncTimerId = 0;
    const metronomeScheduledBeatKeys = new Set();
    let metronomeLastSeenTransportSec = -Infinity;
    /** Click チェックあり = メトロノーム ON。初期は OFF。 */
    let metronomeClickEnabled = false;
    let metronomeGainTargetLevel = NaN;

    const metronomeClickCheckbox = document.getElementById('metronomeClickCheckbox');

    function beatDurationSec(sig, bpm) {
        return ((4 / sig.den) * 60) / bpm;
    }

    function getMeterEntryForBar(spec, barIndex) {
        if (!spec || !spec.entries || !spec.entries.length) return null;
        const entries = spec.entries;
        if (spec.mode === 'fixed') return entries[0];
        if (spec.mode === 'alternate') {
            return entries[((barIndex % entries.length) + entries.length) % entries.length];
        }
        if (barIndex < entries.length) return entries[barIndex];
        return entries[entries.length - 1];
    }

    function getMetronomeMeterKey() {
        if (typeof getMusicalGridPersistSnapshot === 'function') {
            const snap = getMusicalGridPersistSnapshot();
            if (snap && snap.meter != null) return String(snap.meter).trim();
        }
        if (typeof musicalGridDrawSettings !== 'function') return '';
        const settings = musicalGridDrawSettings();
        if (!settings || !settings.meterSpec) return '';
        return JSON.stringify(settings.meterSpec);
    }

    function shouldMetronomeRun() {
        if (!metronomeClickEnabled) {
            return false;
        }
        if (typeof videoExportAudioInclude !== 'undefined' && videoExportAudioInclude) {
            return false;
        }
        if (typeof isTransportPlayingForExtra === 'function') {
            return isTransportPlayingForExtra();
        }
        if (typeof isTransportPlaying === 'function') {
            return isTransportPlaying();
        }
        return !!(typeof videoMain !== 'undefined' && videoMain && !videoMain.paused);
    }

    function getMetronomeTransportSec() {
        if (typeof getAudioSyncTransportSec === 'function') {
            return getAudioSyncTransportSec();
        }
        if (typeof getTransportSec === 'function') {
            return getTransportSec();
        }
        return 0;
    }

    function getMasterVolLinearForMetronome() {
        if (typeof getReviewMixMasterLinearGain === 'function') {
            return getReviewMixMasterLinearGain();
        }
        return 1;
    }

    function getMetronomeEffectiveGainLevel() {
        const mixRmsDb =
            typeof getReviewMixMonitorRmsDbForMetronome === 'function'
                ? getReviewMixMonitorRmsDbForMetronome()
                : null;
        let clickLinear;
        if (mixRmsDb != null && isFinite(mixRmsDb)) {
            const clickDb = mixRmsDb + METRONOME_DB_ABOVE_MIX_RMS;
            clickLinear = Math.pow(10, clickDb / 20);
        } else {
            clickLinear =
                METRONOME_BASE_GAIN_LEVEL * getMasterVolLinearForMetronome();
        }
        clickLinear = Math.min(METRONOME_MAX_GAIN_LEVEL, clickLinear);
        return Math.max(METRONOME_MIN_GAIN_LINEAR, clickLinear);
    }

    function applyMetronomeOutputGain(ctx, level, instant) {
        if (!metronomeGain || !ctx || metronomeGain.context !== ctx) return;
        const target = Math.max(0, level);
        if (
            !instant &&
            isFinite(metronomeGainTargetLevel) &&
            Math.abs(target - metronomeGainTargetLevel) < METRONOME_GAIN_TARGET_EPS
        ) {
            return;
        }
        metronomeGainTargetLevel = target;
        const t = ctx.currentTime;
        metronomeGain.gain.cancelScheduledValues(t);
        if (instant || target === 0) {
            metronomeGain.gain.setValueAtTime(target, t);
            return;
        }
        metronomeGain.gain.setValueAtTime(metronomeGain.gain.value, t);
        metronomeGain.gain.setTargetAtTime(target, t, METRONOME_GAIN_SMOOTH_SEC);
    }

    function syncMetronomeOutputGain(ctx, opt) {
        if (!metronomeGain || !ctx || metronomeGain.context !== ctx) return;
        if (!metronomeClickEnabled || !metronomeActive) return;
        const o = opt && typeof opt === 'object' ? opt : {};
        applyMetronomeOutputGain(
            ctx,
            getMetronomeEffectiveGainLevel(),
            !!o.instant,
        );
    }

    function wireMetronomeOutputIfNeeded(ctx) {
        if (!ctx) return null;
        if (ctx.state === 'suspended') {
            void ctx.resume();
        }
        if (!metronomeGain || metronomeGain.context !== ctx) {
            try {
                if (metronomeGain) metronomeGain.disconnect();
            } catch (_) {}
            metronomeGain = ctx.createGain();
            metronomeGain.gain.value = 0;
            metronomeGainTargetLevel = NaN;
            metronomeRoutingCtx = null;
        }
        if (metronomeRoutingCtx !== ctx) {
            metronomeGain.connect(ctx.destination);
            metronomeRoutingCtx = ctx;
        }
        return metronomeGain;
    }

    function setMetronomeOutputAudible(ctx, audible) {
        wireMetronomeOutputIfNeeded(ctx);
        if (!audible) {
            metronomeGainTargetLevel = NaN;
            muteMetronomeOutput(ctx);
            return;
        }
        syncMetronomeOutputGain(ctx);
    }

    function metronomeBeatScheduleKey(transportSec) {
        return Math.round(transportSec * 1000) / 1000;
    }

    function clearMetronomeScheduledBeatKeys() {
        metronomeScheduledBeatKeys.clear();
    }

    function pruneMetronomeScheduledBeatKeys(beforeSec) {
        if (!(beforeSec > 0)) return;
        const cutoff = beforeSec - 2;
        for (const key of metronomeScheduledBeatKeys) {
            if (key < cutoff) metronomeScheduledBeatKeys.delete(key);
        }
    }

    function isMetronomeSyncTimerActive() {
        return !!metronomeSyncTimerId;
    }

    function ensureMetronomeRouting(ctx) {
        return wireMetronomeOutputIfNeeded(ctx);
    }

    function ensureMetronomeOutputRouting(ctx) {
        if (!ctx && typeof ensureReviewMixCtx === 'function') {
            ctx = ensureReviewMixCtx();
        }
        const node = wireMetronomeOutputIfNeeded(ctx);
        syncMetronomeOutputGain(ctx);
        return node;
    }

    function muteMetronomeOutput(ctx) {
        if (!metronomeGain || !ctx) return;
        metronomeGainTargetLevel = NaN;
        metronomeGain.gain.cancelScheduledValues(0);
        metronomeGain.gain.value = 0;
    }

    function resetMetronomeScan(meterKey) {
        metronomeScan = { meterKey: meterKey || '', barIndex: 0, barStartSec: 0 };
    }

    function flushMetronomeScheduledAudio(ctx) {
        if (!ctx) return;
        try {
            if (metronomeGain) metronomeGain.disconnect();
        } catch (_) {}
        metronomeGain = null;
        metronomeRoutingCtx = null;
        wireMetronomeOutputIfNeeded(ctx);
        if (metronomeClickEnabled && metronomeActive) {
            syncMetronomeOutputGain(ctx, { instant: true });
        }
    }

    function resetMetronomeSchedule(ctx, transportSec, meterKey) {
        metronomeActive = true;
        metronomeMeterKey = meterKey || '';
        metronomeLastScheduledBeatSec = transportSec - METRONOME_MIN_BEAT_GAP_SEC;
        metronomeLastSeenTransportSec = transportSec;
        clearMetronomeScheduledBeatKeys();
        resetMetronomeScan(metronomeMeterKey);
        flushMetronomeScheduledAudio(ctx);
    }

    function isMetronomeTransportPlaybackCatchUp(delta) {
        if (!(delta > METRONOME_TRANSPORT_JUMP_SEC)) return false;
        if (typeof isTransportPlaying === 'function' && isTransportPlaying()) {
            return true;
        }
        if (typeof isTransportUiClockActive === 'function' && isTransportUiClockActive()) {
            return true;
        }
        return false;
    }

    function syncMetronomeAnchor(ctx, transportSec, force, meterKey) {
        if (!metronomeActive || meterKey !== metronomeMeterKey) {
            resetMetronomeSchedule(ctx, transportSec, meterKey);
            return;
        }
        if (Number.isFinite(metronomeLastSeenTransportSec)) {
            const delta = transportSec - metronomeLastSeenTransportSec;
            if (Math.abs(delta) > METRONOME_TRANSPORT_JUMP_SEC) {
                if (!isMetronomeTransportPlaybackCatchUp(delta)) {
                    resetMetronomeSchedule(ctx, transportSec, meterKey);
                    return;
                }
            }
        }
        if (force) {
            resetMetronomeSchedule(ctx, transportSec, meterKey);
            return;
        }
        metronomeLastSeenTransportSec = transportSec;
    }

    function transportSecToCtxTime(ctx, transportSec, transportNowSec) {
        const nowTransport = Number.isFinite(transportNowSec)
            ? transportNowSec
            : getMetronomeTransportSec();
        const when = ctx.currentTime + (transportSec - nowTransport);
        return Math.max(when, ctx.currentTime + METRONOME_SCHEDULE_MIN_LEAD_SEC);
    }

    async function fetchMetronomeWav(url) {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error('Metronome WAV fetch failed: ' + url + ' (' + res.status + ')');
        }
        return res.arrayBuffer();
    }

    function prefetchMetronomeWavFiles() {
        if (!metronomeWavBytesPromise) {
            metronomeWavBytesPromise = Promise.all([
                fetchMetronomeWav(METRONOME_WAV.accent),
                fetchMetronomeWav(METRONOME_WAV.beat),
            ]).then(([accentAb, beatAb]) => ({ accentAb, beatAb }));
        }
        return metronomeWavBytesPromise;
    }

    function ensureMetronomeClickBuffers(ctx) {
        if (metronomeClickBuffers) return Promise.resolve(metronomeClickBuffers);
        if (!ctx) return Promise.reject(new Error('Metronome: no AudioContext'));
        if (!metronomeDecodePromise) {
            metronomeDecodePromise = (async () => {
                const decode =
                    typeof decodeArrayBufferToAudioBuffer === 'function'
                        ? decodeArrayBufferToAudioBuffer
                        : null;
                if (!decode) {
                    throw new Error('Metronome: decodeArrayBufferToAudioBuffer unavailable');
                }
                const { accentAb, beatAb } = await prefetchMetronomeWavFiles();
                const [accent, beat] = await Promise.all([
                    decode(ctx, accentAb),
                    decode(ctx, beatAb),
                ]);
                metronomeClickBuffers = { accent, beat };
                if (typeof writeLog === 'function') {
                    writeLog(
                        'Metronome: WAV loaded (' +
                            METRONOME_WAV.accent +
                            ', ' +
                            METRONOME_WAV.beat +
                            ')',
                    );
                }
                return metronomeClickBuffers;
            })().catch((err) => {
                metronomeDecodePromise = null;
                if (typeof writeLog === 'function') {
                    writeLog(
                        'Metronome: WAV load failed — ' +
                            (err && err.message ? err.message : String(err)),
                    );
                }
                throw err;
            });
        }
        return metronomeDecodePromise;
    }

    function scheduleMetronomeClick(ctx, transportSec, accent, buffers, transportNowSec) {
        const beatKey = metronomeBeatScheduleKey(transportSec);
        if (metronomeScheduledBeatKeys.has(beatKey)) {
            return false;
        }
        const when = transportSecToCtxTime(ctx, transportSec, transportNowSec);
        if (!buffers || !buffers.accent || !buffers.beat) return false;
        const gainNode = metronomeGain;
        if (!gainNode || gainNode.context !== ctx) return false;
        const buffer = accent ? buffers.accent : buffers.beat;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        connectMonoAudioCentered(src, gainNode, buffer.numberOfChannels);
        src.start(when);
        metronomeScheduledBeatKeys.add(beatKey);
        return true;
    }

    function positionMetronomeScanAtSec(meterSpec, meterKey, targetSec, maxSec) {
        if (typeof getMusicalGridBarBySec === 'function') {
            const pos = getMusicalGridBarBySec(meterSpec, targetSec, maxSec);
            if (!pos || !pos.entry) return null;
            metronomeScan.meterKey = meterKey;
            metronomeScan.barIndex = pos.barIndex;
            metronomeScan.barStartSec = pos.barStartSec;
            return { entry: pos.entry, barEndSec: pos.barEndSec };
        }
        if (
            metronomeScan.meterKey !== meterKey ||
            targetSec < metronomeScan.barStartSec - 1e-9
        ) {
            resetMetronomeScan(meterKey);
        } else {
            metronomeScan.meterKey = meterKey;
        }
        let guard = 0;
        while (guard < 48000) {
            const entry = getMeterEntryForBar(meterSpec, metronomeScan.barIndex);
            if (!entry) return null;
            const barDur = entry.sig.num * beatDurationSec(entry.sig, entry.bpm);
            const barEndSec = metronomeScan.barStartSec + barDur;
            if (targetSec < barEndSec - 1e-9 || barEndSec >= maxSec - 1e-9) {
                return { entry, barEndSec };
            }
            metronomeScan.barStartSec = barEndSec;
            metronomeScan.barIndex += 1;
            guard += 1;
        }
        return null;
    }

    function scheduleMetronomeBeatsInRange(
        ctx,
        meterSpec,
        meterKey,
        fromSec,
        endSec,
        maxSec,
        buffers,
        transportNowSec,
    ) {
        const synced = positionMetronomeScanAtSec(meterSpec, meterKey, fromSec, maxSec);
        if (!synced) return;

        let barStartSec = metronomeScan.barStartSec;
        let barIndex = metronomeScan.barIndex;
        let entry = synced.entry;

        let guard = 0;
        while (barStartSec < endSec - 1e-9 && guard < 48000) {
            if (!entry) break;
            const beatDur = beatDurationSec(entry.sig, entry.bpm);
            const barDur = entry.sig.num * beatDur;

            if (barStartSec >= fromSec - 1e-9 && barStartSec < endSec + 1e-9) {
                if (
                    scheduleMetronomeClick(
                        ctx,
                        barStartSec,
                        true,
                        buffers,
                        transportNowSec,
                    )
                ) {
                    metronomeLastScheduledBeatSec = barStartSec;
                }
            }
            for (let beat = 1; beat < entry.sig.num; beat++) {
                const beatSec = barStartSec + beat * beatDur;
                if (beatSec >= endSec - 1e-9) break;
                if (beatSec < fromSec - 1e-9) continue;
                if (
                    scheduleMetronomeClick(
                        ctx,
                        beatSec,
                        false,
                        buffers,
                        transportNowSec,
                    )
                ) {
                    metronomeLastScheduledBeatSec = beatSec;
                }
            }

            barStartSec += barDur;
            barIndex += 1;
            entry = getMeterEntryForBar(meterSpec, barIndex);
            guard += 1;
        }

        metronomeScan.barIndex = barIndex;
        metronomeScan.barStartSec = barStartSec;
        metronomeScan.meterKey = meterKey;
    }

    function startMetronomeSyncTimer() {
        if (metronomeSyncTimerId) return;
        metronomeSyncTimerId = setInterval(() => {
            if (!shouldMetronomeRun()) {
                stopMetronome();
                return;
            }
            syncMetronomeToTransport();
        }, METRONOME_SYNC_INTERVAL_MS);
    }

    function stopMetronomeSyncTimer() {
        if (!metronomeSyncTimerId) return;
        clearInterval(metronomeSyncTimerId);
        metronomeSyncTimerId = 0;
    }

    function stopMetronome() {
        metronomeActive = false;
        metronomeLastScheduledBeatSec = -Infinity;
        metronomeLastSeenTransportSec = -Infinity;
        metronomeMeterKey = '';
        resetMetronomeScan('');
        stopMetronomeSyncTimer();
        clearMetronomeScheduledBeatKeys();
        const ctx =
            typeof ensureReviewMixCtx === 'function' ? ensureReviewMixCtx() : null;
        if (ctx) muteMetronomeOutput(ctx);
    }

    function runMetronomeSchedule(ctx, opt) {
        const settings =
            typeof musicalGridDrawSettings === 'function' ? musicalGridDrawSettings() : null;
        if (!settings || !settings.meterSpec) {
            stopMetronome();
            return;
        }

        startMetronomeSyncTimer();
        ensureMetronomeRouting(ctx);
        if (metronomeClickEnabled && metronomeActive && !isFinite(metronomeGainTargetLevel)) {
            syncMetronomeOutputGain(ctx, { instant: true });
        }
        const transportSec = getMetronomeTransportSec();
        pruneMetronomeScheduledBeatKeys(transportSec);
        const force = !!(opt && opt.force);
        const meterKey = getMetronomeMeterKey();
        syncMetronomeAnchor(ctx, transportSec, force, meterKey);

        const masterDur =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : transportSec + METRONOME_SCHEDULE_AHEAD_SEC;
        const scheduleEnd = Math.min(
            masterDur > 0 ? masterDur : transportSec + METRONOME_SCHEDULE_AHEAD_SEC,
            transportSec + METRONOME_SCHEDULE_AHEAD_SEC,
        );
        if (!(scheduleEnd > transportSec + 0.001)) return;

        const fromSec = Math.max(
            transportSec - 0.01,
            metronomeLastScheduledBeatSec + METRONOME_MIN_BEAT_GAP_SEC,
        );
        scheduleMetronomeBeatsInRange(
            ctx,
            settings.meterSpec,
            meterKey,
            fromSec,
            scheduleEnd,
            masterDur > 0 ? masterDur : scheduleEnd,
            metronomeClickBuffers,
            transportSec,
        );
        syncMetronomeOutputGain(ctx);
    }

    function syncMetronomeToTransport(opt) {
        if (!shouldMetronomeRun()) {
            stopMetronome();
            return;
        }
        const ctx =
            typeof ensureReviewMixCtx === 'function' ? ensureReviewMixCtx() : null;
        if (!ctx) return;

        if (metronomeClickBuffers) {
            runMetronomeSchedule(ctx, opt);
            return;
        }

        void ensureMetronomeClickBuffers(ctx).then(() => {
            if (!shouldMetronomeRun()) return;
            runMetronomeSchedule(ctx, opt);
        });
    }

    function applyMetronomeClickUi() {
        if (metronomeClickCheckbox) metronomeClickCheckbox.checked = !!metronomeClickEnabled;
    }

    function getMetronomeClickEnabled() {
        return !!metronomeClickEnabled;
    }

    function setMetronomeClickEnabled(next, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const prev = metronomeClickEnabled;
        metronomeClickEnabled = !!next;
        applyMetronomeClickUi();
        if (metronomeClickEnabled) {
            syncMetronomeToTransport({ force: true });
        } else {
            stopMetronome();
        }
        if (o.persist !== false && typeof writePrefs === 'function') writePrefs();
        if (!o.silent) {
            if (typeof writeLog === 'function') {
                writeLog('Click: ' + (metronomeClickEnabled ? 'ON' : 'OFF'));
            }
            if (typeof flashSeekHint === 'function') {
                flashSeekHint('Click', metronomeClickEnabled ? 'ON' : 'OFF', 'notice');
            }
            if (metronomeClickEnabled !== prev && typeof flashTransportOptBox === 'function') {
                flashTransportOptBox('metronomeClick');
            }
        }
    }

    function toggleMetronomeClickEnabled() {
        setMetronomeClickEnabled(!metronomeClickEnabled);
        return true;
    }

    function bindMetronomeClickCheckbox() {
        if (!metronomeClickCheckbox || metronomeClickCheckbox.dataset.bound === '1') return;
        metronomeClickCheckbox.dataset.bound = '1';
        applyMetronomeClickUi();
        metronomeClickCheckbox.addEventListener('change', () => {
            setMetronomeClickEnabled(!!metronomeClickCheckbox.checked);
        });
    }

    function handleMetronomeClickShortcutKeydown(e) {
        if (typeof matchUserShortcut !== 'function') return false;
        if (!matchUserShortcut(e, 'metronomeClickToggle')) return false;
        e.preventDefault();
        toggleMetronomeClickEnabled();
        return true;
    }

    function initMetronomeClickUi() {
        try {
            const prefs = typeof readPrefs === 'function' ? readPrefs() : {};
            if (typeof prefs.metronomeClickEnabled === 'boolean') {
                metronomeClickEnabled = prefs.metronomeClickEnabled;
            }
        } catch (_) {}
        applyMetronomeClickUi();
        bindMetronomeClickCheckbox();
    }

    initMetronomeClickUi();

    void prefetchMetronomeWavFiles().catch(() => {});

    window.syncMetronomeToTransport = syncMetronomeToTransport;
    window.stopMetronome = stopMetronome;
    window.ensureMetronomeOutputRouting = ensureMetronomeOutputRouting;
    window.isMetronomeSyncTimerActive = isMetronomeSyncTimerActive;
    window.getMetronomeClickEnabled = getMetronomeClickEnabled;
    window.setMetronomeClickEnabled = setMetronomeClickEnabled;
    window.toggleMetronomeClickEnabled = toggleMetronomeClickEnabled;
    window.handleMetronomeClickShortcutKeydown = handleMetronomeClickShortcutKeydown;
})();
