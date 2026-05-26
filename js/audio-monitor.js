(function reviewMixAudioMonitorModule() {
    const DISPLAY_ANALYSIS_FLOOR_DB = Object.freeze([-50, -60, -70, -80, -96]);
    const DEFAULT_SPECTRUM_FLOOR_DB = -50;
    const DEFAULT_METER_FLOOR_DB = -50;

    const UI_PREFS_STORAGE_KEY =
        typeof LS_MONITOR_PREFS_LEGACY_KEY === 'string'
            ? LS_MONITOR_PREFS_LEGACY_KEY
            : 'mga_cineaudio_reviewer_monitor_prefs_v1';
    const DEFAULT_MASTER_VOL_LINEAR = 1;
    const MASTER_VOL_UNITY_LINEAR = 1;
    const MASTER_VOL_SLIDER_STEP = 0.01;

    /** スライダー刻みに合わせ、0 dB（1.0）付近は厳密に 1.0 へスナップ */
    function normalizeMasterVolLinear(raw) {
        const g = parseFloat(raw);
        const safe = isFinite(g) ? g : DEFAULT_MASTER_VOL_LINEAR;
        const clamped = Math.max(0, Math.min(2, safe));
        const stepped =
            Math.round(clamped / MASTER_VOL_SLIDER_STEP) * MASTER_VOL_SLIDER_STEP;
        if (Math.abs(stepped - MASTER_VOL_UNITY_LINEAR) < MASTER_VOL_SLIDER_STEP * 0.51) {
            return MASTER_VOL_UNITY_LINEAR;
        }
        return Math.round(stepped * 100) / 100;
    }

    /**
     * マスター線形ゲイン g（スライダー値＝GainNode.gain）に対し、100%=1.0 を 0 dB とした振幅比表示。
     */
    function formatMasterVolDisplayText(linearGain) {
        const safeG = normalizeMasterVolLinear(linearGain);
        const pct = Math.round(safeG * 100);
        if (safeG <= 0) return `${pct}% (−∞ dB)`;
        const db = 20 * Math.log10(safeG);
        const dbStr = db > 0 ? `+${db.toFixed(1)}` : db.toFixed(1);
        return `${pct}% (${dbStr} dB)`;
    }

    function readMasterVolSliderLinear() {
        const el = document.getElementById('masterVolSlider');
        if (!el) return normalizeMasterVolLinear(DEFAULT_MASTER_VOL_LINEAR);
        return normalizeMasterVolLinear(el.value);
    }

    function syncMasterVolDisplay(linearGain) {
        const disp = document.getElementById('masterVolDisp');
        if (disp) disp.textContent = formatMasterVolDisplayText(linearGain);
    }

    function applyMasterVolToMix(linearGain, smooth, ctxOpt) {
        const safeG = normalizeMasterVolLinear(linearGain);
        reviewMixMasterLinearGain = safeG;
        const slider = document.getElementById('masterVolSlider');
        const sliderStr = safeG.toFixed(2);
        if (slider && slider.value !== sliderStr) {
            slider.value = sliderStr;
        }
        syncMasterVolDisplay(safeG);
        const ctx = ctxOpt || getReviewMixAudioCtx();
        if (reviewMixMasterNode && ctx) {
            if (smooth) {
                reviewMixMasterNode.gain.setTargetAtTime(safeG, ctx.currentTime, 0.05);
            } else {
                reviewMixMasterNode.gain.setValueAtTime(safeG, ctx.currentTime);
            }
        }
    }

    let reviewMixMasterNode = null;
    let reviewMixMonitorSplitter = null;
    let reviewMixMasterLinearGain = 1;
    let masterAnalyserConnected = false;

    let spectrumDisplayDbMin = DISPLAY_ANALYSIS_FLOOR_DB.includes(DEFAULT_SPECTRUM_FLOOR_DB)
        ? DEFAULT_SPECTRUM_FLOOR_DB
        : -50;
    let meterDisplayDbMin = DISPLAY_ANALYSIS_FLOOR_DB.includes(DEFAULT_METER_FLOOR_DB)
        ? DEFAULT_METER_FLOOR_DB
        : -50;
    /** チェックあり = Analyze ON（スペクトラム／メーター表示）。初期は OFF。 */
    let analyzeOn = false;

    const analyzeOnCheckbox = document.getElementById('analyzeOnCheckbox');
    const reviewMixMonitorEl = document.getElementById('reviewMixMonitor');
    const monitorFloorOptionsEl = document.querySelector('.monitor-floor-options');

    function applyAnalyzeUiVisibility() {
        if (analyzeOnCheckbox) analyzeOnCheckbox.checked = !!analyzeOn;
        if (reviewMixMonitorEl) reviewMixMonitorEl.hidden = !analyzeOn;
        if (monitorFloorOptionsEl) monitorFloorOptionsEl.hidden = !analyzeOn;
    }

    function setAnalyzeOn(next, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const prev = analyzeOn;
        analyzeOn = !!next;
        applyAnalyzeUiVisibility();
        syncMasterAnalyserConnectionForAnalyzeState();
        if (!analyzeOn && prev) extinguishMonitorDisplays();
        else if (analyzeOn && !prev && !requestAnimId) paintSpectrumIdle();
        if (!o.skipSave) saveUiPrefsToLocalStorage();
        if (!o.silent && typeof writeLog === 'function') {
            writeLog('Analyze: ' + (analyzeOn ? 'ON' : 'OFF'));
        }
    }

    function toggleAnalyzeOn() {
        setAnalyzeOn(!analyzeOn);
    }

    function readAnalyzeOnFromPrefsSnap(snap) {
        if (!snap || typeof snap !== 'object') return;
        if (typeof snap.analyzeOn === 'boolean') {
            analyzeOn = snap.analyzeOn;
        } else if (typeof snap.analyzeOff === 'boolean') {
            analyzeOn = !snap.analyzeOff;
        }
    }
    
    function getMonitorUiPersistSnapshot() {
        return {
            spectrumFloor: spectrumDisplayDbMin,
            meterFloor: meterDisplayDbMin,
            analyzeOn: !!analyzeOn,
            masterVol: normalizeMasterVolLinear(reviewMixMasterLinearGain),
        };
    }

    function applyMonitorUiPersistSnapshot(snap) {
        if (!snap || typeof snap !== 'object') return;
        if (
            typeof snap.spectrumFloor === 'number' &&
            DISPLAY_ANALYSIS_FLOOR_DB.includes(snap.spectrumFloor)
        ) {
            spectrumDisplayDbMin = snap.spectrumFloor;
        }
        if (typeof snap.meterFloor === 'number' && DISPLAY_ANALYSIS_FLOOR_DB.includes(snap.meterFloor)) {
            meterDisplayDbMin = snap.meterFloor;
        }
        readAnalyzeOnFromPrefsSnap(snap);
        const specSel = document.getElementById('spectrumFloorDbSelect');
        const metSel = document.getElementById('meterFloorDbSelect');
        if (specSel) specSel.value = String(spectrumDisplayDbMin);
        if (metSel) metSel.value = String(meterDisplayDbMin);
        if (typeof snap.masterVol === 'number' && isFinite(snap.masterVol)) {
            applyMasterVolToMix(snap.masterVol, false);
        }
        applyAnalyzeUiVisibility();
        syncMasterAnalyserConnectionForAnalyzeState();
        saveUiPrefsToLocalStorage();
    }

    window.getMonitorUiPersistSnapshot = getMonitorUiPersistSnapshot;
    window.applyMonitorUiPersistSnapshot = applyMonitorUiPersistSnapshot;

    function saveUiPrefsToLocalStorage() {
        if (typeof writePrefs === 'function') {
            writePrefs();
            return;
        }
        try {
            localStorage.setItem(
                UI_PREFS_STORAGE_KEY,
                JSON.stringify({
                    spectrumFloor: spectrumDisplayDbMin,
                    meterFloor: meterDisplayDbMin,
                    analyzeOn: !!analyzeOn,
                    masterVol: normalizeMasterVolLinear(reviewMixMasterLinearGain),
                }),
            );
        } catch (_) {}
    }

    (function syncInitialTransportAndMonitorControls() {
        let loadedMasterVolFromStorage = false;
        try {
            if (typeof readPrefs === 'function') {
                const prefs = readPrefs();
                if (prefs.monitorPrefs && typeof prefs.monitorPrefs === 'object') {
                    if (
                        typeof prefs.monitorPrefs.masterVol === 'number' &&
                        isFinite(prefs.monitorPrefs.masterVol)
                    ) {
                        loadedMasterVolFromStorage = true;
                    }
                    applyMonitorUiPersistSnapshot(prefs.monitorPrefs);
                }
            } else {
                const raw = localStorage.getItem(UI_PREFS_STORAGE_KEY);
                if (raw) {
                    const o = JSON.parse(raw);
                    if (o && typeof o === 'object') {
                        applyMonitorUiPersistSnapshot(o);
                        if (typeof o.masterVol === 'number' && isFinite(o.masterVol)) {
                            loadedMasterVolFromStorage = true;
                        }
                    }
                }
            }
        } catch (_) {}
        if (!loadedMasterVolFromStorage) {
            applyMasterVolToMix(DEFAULT_MASTER_VOL_LINEAR, false);
        }
        applyAnalyzeUiVisibility();
    })();

    let masterAnalyser = null;
    let anaL = null, anaR = null;
    
    let clipTimers = {};
    let gainReduceGlowTimer = null;
    const METER_DB_MAX = 0;
    const PEAK_HOLD_SEC = 1.0;
    const PEAK_RELEASE_DB_PER_SEC = 10;
    const METER_BAR_INST_TRACK = 0.48;
    /** RMS ホールド線: 上方向だけ係数を弱くしてバーに食い込みにくくする EMA。 */
    const RMS_HOLD_MARK_UP_SMOOTH = 0.010;
    const RMS_HOLD_MARK_DN_SMOOTH = 0.034;
    
    let meterChState = {
        l: {
            lastT: 0,
            visPeakDb: meterDisplayDbMin,
            visRmsDb: meterDisplayDbMin,
            peakHeldDb: meterDisplayDbMin,
            peakHoldUntil: -1e9,
            rmsHeldDb: meterDisplayDbMin,
            rmsHoldUntil: -1e9,
            rmsHoldLineDb: meterDisplayDbMin
        },
        r: {
            lastT: 0,
            visPeakDb: meterDisplayDbMin,
            visRmsDb: meterDisplayDbMin,
            peakHeldDb: meterDisplayDbMin,
            peakHoldUntil: -1e9,
            rmsHeldDb: meterDisplayDbMin,
            rmsHoldUntil: -1e9,
            rmsHoldLineDb: meterDisplayDbMin
        },
        /* Native <video> analyser merge — must not share 'l' with anaL */
        v: {
            lastT: 0,
            visPeakDb: meterDisplayDbMin,
            visRmsDb: meterDisplayDbMin,
            peakHeldDb: meterDisplayDbMin,
            peakHoldUntil: -1e9,
            rmsHeldDb: meterDisplayDbMin,
            rmsHoldUntil: -1e9,
            rmsHoldLineDb: meterDisplayDbMin
        }
    };
    function resetMeterChState() {
        const z = () => ({
            lastT: 0,
            visPeakDb: meterDisplayDbMin,
            visRmsDb: meterDisplayDbMin,
            peakHeldDb: meterDisplayDbMin,
            peakHoldUntil: -1e9,
            rmsHeldDb: meterDisplayDbMin,
            rmsHoldUntil: -1e9,
            rmsHoldLineDb: meterDisplayDbMin
        });
        meterChState = { l: z(), r: z(), v: z() };
    }
    let lastReductionTime = 0;
    const REDUCTION_COOLDOWN = 450;
    
    let monitorTransportActive = false;
    let requestAnimId = null;
    let spectrumBandEnv = null;
    let spectrumPeakHoldDb = null;
    let spectrumPeakHoldUntil = null;
    let lastSpectrumDrawT = 0;
    /* drawSpectrum: FFT/帯域/ぼかし用の再利用バッファ（長さは analyser / 帯本数に追随。中身は毎フレーム再計算） */
    let spectrumScratchFloat = null;
    let spectrumScratchFloatLen = 0;
    let spectrumScratchTdL = null;
    let spectrumScratchTdR = null;
    let spectrumScratchTdLen = 0;
    let spectrumScratchBandNb = 0;
    let spectrumScratchBandDb = null;
    let spectrumScratchBandLin = null;
    let spectrumScratchDisplayDb = null;
    let spectrumScratchBlurredLin = null;
    let spectrumScratchVideoFloat = null;
    let spectrumScratchVideoFloatLen = 0;
    /** スペクトラム帯域グリッドの下限 Hz（ラベル・帯境界の基準） */
    const SPECTRUM_GRID_FLOOR_HZ = 20;
    const SPECTRUM_INSET_LEFT_PX = 12;
    const SPECTRUM_INSET_RIGHT_PX = 4;
    const SPECTRUM_BAR_GUTTER_PX = 1;
    /**
     * 列方向ガウスぼかし（σ）と SPEC_SKIRT_* のバランスで山形が決まる。
     * 隣列だけ強めると単音で肩が平らになりやすいので、外周リングの倍率で調整する想定。
     */
    const SPEC_BLUR_SIGMA = 0.45;
    const SPEC_SKIRT_NEIGHBOR_ATTEN = 1.52;
    const SPEC_SKIRT_OUTER_BOOST = 4.15;
    const SPEC_SKIRT_RING3_MULT = 1.38;
    const SPEC_SKIRT_RING4PLUS_MULT = 0.78;
    const SPEC_SKIRT_MIN_PEAK_LIN = 1e-14;
    const SPEC_SPECT_PEAK_HOLD_CENTER_SEC = 2.0;
    const SPEC_PEAK_HOLD_NEIGHBOR_SEC = 0.38;
    const SPEC_PEAK_HOLD_OUTER_SEC = 0.14;
    const SPEC_PEAK_RELEASE_DB_PER_SEC = 5.25;
    const SPEC_PEAK_RELEASE_MULT_NEIGHBOR = 1.22;
    const SPEC_PEAK_RELEASE_MULT_OUTER = 1.55;
    const SPEC_FFT_CAL_DB_MAX = 12;
    const SPEC_BELL_CALIB_MIN_DOMINANCE_DB = 3;
    const SPEC_SPECT_QP_RISE_SEC = 0.001;
    const SPEC_SPECT_QP_FALL_SEC = 0.7;
    const MONITOR_CHROME_FONT_PX = 8;
    
    const canvas = document.getElementById('spectrumCanvas');
    const canvasCtx = canvas ? canvas.getContext('2d') : null;

    function getReviewMixAudioCtx() {
        return typeof ensureReviewMixCtx === 'function' ? ensureReviewMixCtx() : null;
    }

    function isReviewMixMonitorActive() {
        return monitorTransportActive;
    }

    function ensureReviewMixMonitorOutput(ctx, masterGainNode) {
        if (!ctx || !masterGainNode) return false;
        reviewMixMasterNode = masterGainNode;
        // auto-gain 判定（CLIP PROTECT）は time-domain の anaL/anaR を使うので、
        // Analyze OFF でも anaL/anaR の音声送りは維持する（CLIP PROTECT 用）。
        if (!reviewMixMonitorSplitter || !anaL || !anaR) {
            reviewMixMonitorSplitter = ctx.createChannelSplitter(2);
            anaL = ctx.createAnalyser();
            anaR = ctx.createAnalyser();
            anaL.fftSize = 1024;
            anaR.fftSize = 1024;
            anaL.smoothingTimeConstant = 0.62;
            anaR.smoothingTimeConstant = 0.62;
            masterGainNode.connect(reviewMixMonitorSplitter);
            reviewMixMonitorSplitter.connect(anaL, 0);
            reviewMixMonitorSplitter.connect(anaR, 1);
        }

        // スペクトラム描画側（frequency-domain）の masterAnalyser は Analyze ON のときのみ接続。
        if (analyzeOn) {
            if (!masterAnalyser) {
                masterAnalyser = ctx.createAnalyser();
                masterAnalyser.fftSize = 2048;
                masterAnalyser.smoothingTimeConstant = 0.14;
                masterAnalyser.minDecibels = -100;
                masterAnalyser.maxDecibels = 0;
            }
            if (!masterAnalyserConnected) {
                masterGainNode.connect(masterAnalyser);
                masterAnalyserConnected = true;
            }
        } else if (masterAnalyser && masterAnalyserConnected) {
            try {
                masterGainNode.disconnect(masterAnalyser);
            } catch (_) {}
            masterAnalyserConnected = false;
        }
        try {
            masterGainNode.disconnect(ctx.destination);
        } catch (_) {}
        masterGainNode.connect(ctx.destination);
        applyMasterVolToMix(reviewMixMasterLinearGain, false, ctx);
        if (monitorTransportActive && !requestAnimId) {
            requestAnimationFrame(updateUIFrame);
        }
        return true;
    }

    function syncMasterAnalyserConnectionForAnalyzeState() {
        const ctx = getReviewMixAudioCtx();
        if (!ctx || !reviewMixMasterNode) return;
        if (analyzeOn) {
            if (!masterAnalyser) {
                masterAnalyser = ctx.createAnalyser();
                masterAnalyser.fftSize = 2048;
                masterAnalyser.smoothingTimeConstant = 0.14;
                masterAnalyser.minDecibels = -100;
                masterAnalyser.maxDecibels = 0;
            }
            if (!masterAnalyserConnected) {
                try {
                    reviewMixMasterNode.connect(masterAnalyser);
                    masterAnalyserConnected = true;
                } catch (_) {}
            }
        } else if (masterAnalyser && masterAnalyserConnected) {
            try {
                reviewMixMasterNode.disconnect(masterAnalyser);
            } catch (_) {}
            masterAnalyserConnected = false;
        }
    }

    function resetReviewMixMonitorGain() {
        applyMasterVolToMix(DEFAULT_MASTER_VOL_LINEAR, true);
        const mvWrap = document.querySelector('.master-vol-container');
        if (mvWrap) mvWrap.classList.remove('gain-reduce-glow');
    }

    function bindMasterVolSlider() {
        const slider = document.getElementById('masterVolSlider');
        if (!slider || slider.dataset.bound === '1') return;
        slider.dataset.bound = '1';
        slider.addEventListener('input', () => {
            const val = readMasterVolSliderLinear();
            applyMasterVolToMix(val, true);
            saveUiPrefsToLocalStorage();
        });
        slider.addEventListener('dblclick', (ev) => {
            ev.preventDefault();
            applyMasterVolToMix(DEFAULT_MASTER_VOL_LINEAR, true);
            saveUiPrefsToLocalStorage();
        });
    }
    bindMasterVolSlider();

    function bindAnalyzeOnCheckbox() {
        if (!analyzeOnCheckbox || analyzeOnCheckbox.dataset.bound === '1') return;
        analyzeOnCheckbox.dataset.bound = '1';
        applyAnalyzeUiVisibility();
        analyzeOnCheckbox.addEventListener('change', () => {
            setAnalyzeOn(!!analyzeOnCheckbox.checked);
        });
    }
    bindAnalyzeOnCheckbox();

    function setReviewMixMonitorTransportActive(active) {
        monitorTransportActive = !!active;
        if (monitorTransportActive) {
            const ctx = getReviewMixAudioCtx();
            if (ctx && ctx.state === 'suspended') void ctx.resume();
            if (ctx && reviewMixMasterNode && !masterAnalyser && typeof ensureReviewMixMonitorOutput === 'function') {
                ensureReviewMixMonitorOutput(ctx, reviewMixMasterNode);
            }
            if (!requestAnimId) requestAnimationFrame(updateUIFrame);
        } else {
            if (requestAnimId) {
                cancelAnimationFrame(requestAnimId);
                requestAnimId = null;
            }
            extinguishMonitorDisplays();
            if (typeof extinguishTrackLaneMeters === 'function') {
                extinguishTrackLaneMeters();
            }
        }
    }

    const METER_KNEE_DB = -20;
    const METER_LO_SEGMENT_FRAC = 0.4;
    
    const meterDbToNorm = (db) => {
        if (!isFinite(db)) return 0;
        const lo = meterDisplayDbMin;
        const c = Math.max(lo, Math.min(METER_DB_MAX, db));
        if (c <= METER_KNEE_DB) {
            return ((c - lo) / (METER_KNEE_DB - lo)) * METER_LO_SEGMENT_FRAC;
        }
        return METER_LO_SEGMENT_FRAC + ((c - METER_KNEE_DB) / (METER_DB_MAX - METER_KNEE_DB)) * (1 - METER_LO_SEGMENT_FRAC);
    };
    
    const meterDbToHeightPct = (db) => meterDbToNorm(db) * 100;
    
    /** メーターとスペクトラム列で共有する段階 RGB（t は meterDbToNorm 等の 0〜1）。 */
    function meterLevelColorLerp(t) {
        t = Math.max(0, Math.min(1, t));
        const stops = [
            { p: 0, r: 2, g: 24, b: 32 },
            { p: 0.26, r: 13, g: 74, b: 98 },
            { p: 0.55, r: 58, g: 184, b: 232 },
            { p: 0.82, r: 200, g: 239, b: 255 },
            { p: 1, r: 248, g: 254, b: 255 },
        ];
        let i = 0;
        for (; i < stops.length - 2; i++) {
            if (t <= stops[i + 1].p) break;
        }
        const a = stops[i];
        const b = stops[i + 1];
        const denom = b.p - a.p;
        const w = denom < 1e-9 ? 1 : (t - a.p) / denom;
        const r = Math.round(a.r + (b.r - a.r) * w);
        const g = Math.round(a.g + (b.g - a.g) * w);
        const bl = Math.round(a.b + (b.b - a.b) * w);
        return `rgb(${r},${g},${bl})`;
    }
    
    const METER_GRAD_DEEP = '#021820';
    const METER_GRAD_MID = '#0d4a62';
    const METER_GRAD_LIT = '#3ab8e8';
    const METER_GRAD_PALE = '#c8efff';
    const METER_GRAD_WHITE = '#f8feff';
    
    function masterMeterBarBackgroundImage() {
        return (
            `linear-gradient(to top, ${METER_GRAD_DEEP} 0%, ${METER_GRAD_MID} 26%, ` +
            `${METER_GRAD_LIT} 55%, ${METER_GRAD_PALE} 82%, ${METER_GRAD_WHITE} 100%)`
        );
    }
    
    /** メーターバー 4 本に同一グラデを貼り、見かけの高さは要素の height% のみで変える。 */
    function syncMasterMeterBarBackgroundStyles(pxHeight) {
        const img = masterMeterBarBackgroundImage();
        const h = Math.max(48, pxHeight | 0);
        for (const id of ['m-peak-l', 'm-rms-l', 'm-peak-r', 'm-rms-r']) {
            const el = document.getElementById(id);
            if (!el) continue;
            el.style.backgroundImage = img;
            el.style.backgroundSize = `100% ${h}px`;
            el.style.backgroundPosition = 'center bottom';
            el.style.backgroundRepeat = 'no-repeat';
            el.style.backgroundColor = 'transparent';
        }
    }
    
    function masterMeterLineColorForDb(db) {
        if (!isFinite(db)) return meterLevelColorLerp(0);
        return meterLevelColorLerp(meterDbToNorm(db));
    }
    
    function masterMeterHoldBorderColorForDb(db) {
        return '#000000';
    }
    
    const formatMeterDbReadout = (db) => {
        if (!isFinite(db) || db <= meterDisplayDbMin) return `${meterDisplayDbMin}.0`;
        return Math.min(METER_DB_MAX, db).toFixed(1);
    };
    
    function meterScaleLabelListForFloor(floorDb) {
        const base = [0, -5, -10, -15, -20];
        const seen = new Set(base);
        const tail = [];
        for (let d = -30; d > floorDb; d -= 10) {
            if (!seen.has(d)) {
                tail.push(d);
                seen.add(d);
            }
        }
        if (!seen.has(floorDb)) tail.push(floorDb);
        return [...base, ...tail];
    }
    
    function buildMasterMeterTickBackground() {
        const layers = [];
        const usedY = new Set();
        for (const d of meterScaleLabelListForFloor(meterDisplayDbMin)) {
            const y = (1 - meterDbToNorm(d)) * 100;
            const yKey = Math.round(y * 1e4) / 1e4;
            if (usedY.has(yKey)) continue;
            usedY.add(yKey);
            const col = 'rgba(255, 255, 255, 0.22)';
            const half = 0.16;
            const t1 = Math.max(0, y - half);
            const t2 = Math.min(100, y + half);
            layers.push(`linear-gradient(to bottom, transparent ${t1}%, ${col} ${t1}%, ${col} ${t2}%, transparent ${t2}%)`);
        }
        return layers.join(', ');
    }
    
    function installMasterMeterScaleUI() {
        const floor = meterDisplayDbMin;
        const mkSpan = (db) => {
            const span = document.createElement('span');
            span.textContent = db === 0 ? '0' : String(db);
            if (db === floor) {
                span.style.top = '100%';
                span.style.transform = 'translateY(-100%)';
            } else if (db === METER_DB_MAX) {
                span.style.top = '0%';
                span.style.transform = 'translateY(calc(-50% + 3px))';
            } else {
                const pct = (1 - meterDbToNorm(db)) * 100;
                span.style.top = `${Math.round(pct * 1000) / 1000}%`;
                span.style.transform = 'translateY(calc(-50% + 3px))';
            }
            return span;
        };
        const left = document.getElementById('m-scale-labels-left');
        const right = document.getElementById('m-scale-labels-right');
        if (!left || !right) return;
        left.textContent = '';
        right.textContent = '';
        for (const db of meterScaleLabelListForFloor(floor)) {
            left.appendChild(mkSpan(db));
            right.appendChild(mkSpan(db));
        }
        const bg = buildMasterMeterTickBackground();
        document.querySelectorAll('.m-meter-ticks').forEach((el) => {
            el.style.backgroundImage = bg;
        });
        syncMonitorAnalysisLayoutHeights();
    }
    
    function bindMonitorFloorControls() {
        const specSel = document.getElementById('spectrumFloorDbSelect');
        const metSel = document.getElementById('meterFloorDbSelect');
        if (!specSel || !metSel) return;
        specSel.value = String(spectrumDisplayDbMin);
        metSel.value = String(meterDisplayDbMin);
        specSel.addEventListener('change', () => {
            const v = parseInt(specSel.value, 10);
            if (!Number.isFinite(v) || !DISPLAY_ANALYSIS_FLOOR_DB.includes(v)) return;
            spectrumDisplayDbMin = v;
            spectrumBandEnv = null;
            spectrumPeakHoldDb = null;
            spectrumPeakHoldUntil = null;
            lastSpectrumDrawT = 0;
            if (analyzeOn && !requestAnimId) paintSpectrumIdle();
            writeLog(`Spectrum display floor: ${v} dB`);
            saveUiPrefsToLocalStorage();
        });
        metSel.addEventListener('change', () => {
            const v = parseInt(metSel.value, 10);
            if (!Number.isFinite(v) || !DISPLAY_ANALYSIS_FLOOR_DB.includes(v)) return;
            meterDisplayDbMin = v;
            installMasterMeterScaleUI();
            resetMeterChState();
            if (!requestAnimId) extinguishMonitorDisplays();
            writeLog(`Level meter floor: ${v} dB`);
            saveUiPrefsToLocalStorage();
        });
    }
    bindMonitorFloorControls();
    
requestAnimationFrame(() => {
    if (analyzeOn) paintSpectrumIdle();
});
window.addEventListener('resize', () => {
    if (analyzeOn && !requestAnimId) paintSpectrumIdle();
    else syncMonitorAnalysisLayoutHeights();
});
    
    const getMeterValues = (analyser, side, ctxNow) => {
        const empty = () => ({
            pPct: 0,
            rPct: 0,
            peakHoldBottomPct: 0,
            rmsHoldBottomPct: 0,
            peakDb: meterDisplayDbMin,
            peakHeldDb: meterDisplayDbMin,
            instPeakDb: meterDisplayDbMin,
            rmsDb: meterDisplayDbMin,
            rmsHeldDb: meterDisplayDbMin,
            instRmsDb: meterDisplayDbMin,
            rmsDbDisp: meterDisplayDbMin,
            rawPeak: 0,
            showPeakHoldLine: false,
            showRmsHoldLine: false,
            peakHoldLineColor: meterLevelColorLerp(0),
            rmsHoldLineColor: meterLevelColorLerp(0),
            peakHoldBorderColor: masterMeterHoldBorderColorForDb(meterDisplayDbMin),
            rmsHoldBorderColor: masterMeterHoldBorderColorForDb(meterDisplayDbMin)
        });
        const audioCtx = getReviewMixAudioCtx();
        if (!analyser || !audioCtx) return empty();
    
        const st = meterChState[side];
        const dt = st.lastT > 0 ? Math.min(0.12, Math.max(0, ctxNow - st.lastT)) : (1 / 60);
        st.lastT = ctxNow;
    
        const bufferLength = analyser.fftSize;
        const timeData = new Float32Array(bufferLength);
        analyser.getFloatTimeDomainData(timeData);
        let peak = 0;
        let sumSquares = 0;
        for (let i = 0; i < bufferLength; i++) {
            const val = Math.abs(timeData[i]);
            if (val > peak) peak = val;
            sumSquares += val * val;
        }
        const rms = Math.sqrt(sumSquares / bufferLength);
    
        const instPeakDb = 20 * Math.log10(Math.max(peak, 1e-8));
        const instRmsDb = 20 * Math.log10(Math.max(rms, 1e-8));
    
        st.visPeakDb += (instPeakDb - st.visPeakDb) * METER_BAR_INST_TRACK;
        st.visRmsDb += (instRmsDb - st.visRmsDb) * METER_BAR_INST_TRACK;
        st.visPeakDb = Math.max(meterDisplayDbMin, Math.min(METER_DB_MAX, st.visPeakDb));
        st.visRmsDb = Math.max(meterDisplayDbMin, Math.min(METER_DB_MAX, st.visRmsDb));
    
        let peakHeldDb = st.peakHeldDb;
        if (instPeakDb > peakHeldDb) {
            peakHeldDb = instPeakDb;
            st.peakHoldUntil = ctxNow + PEAK_HOLD_SEC;
        } else if (ctxNow >= st.peakHoldUntil) {
            peakHeldDb = Math.max(instPeakDb, peakHeldDb - PEAK_RELEASE_DB_PER_SEC * dt);
        }
        peakHeldDb = Math.max(meterDisplayDbMin, Math.min(METER_DB_MAX, peakHeldDb));
        st.peakHeldDb = peakHeldDb;
    
        let rmsHeldDb = st.rmsHeldDb;
        if (instRmsDb > rmsHeldDb) {
            rmsHeldDb = instRmsDb;
            st.rmsHoldUntil = ctxNow + PEAK_HOLD_SEC;
        } else if (ctxNow >= st.rmsHoldUntil) {
            rmsHeldDb = Math.max(instRmsDb, rmsHeldDb - PEAK_RELEASE_DB_PER_SEC * dt);
        }
        rmsHeldDb = Math.max(meterDisplayDbMin, Math.min(METER_DB_MAX, rmsHeldDb));
        st.rmsHeldDb = rmsHeldDb;
    
        const tgt = rmsHeldDb;
        let lineDb = st.rmsHoldLineDb;
        if (!isFinite(lineDb)) lineDb = tgt;
        const k = tgt > lineDb + 1e-6 ? RMS_HOLD_MARK_UP_SMOOTH : RMS_HOLD_MARK_DN_SMOOTH;
        lineDb += (tgt - lineDb) * k;
        st.rmsHoldLineDb = Math.max(meterDisplayDbMin, Math.min(METER_DB_MAX, lineDb));
    
        const pInstPct = meterDbToHeightPct(st.visPeakDb);
        const rInstPct = meterDbToHeightPct(st.visRmsDb);
    
        return {
            pPct: pInstPct,
            rPct: rInstPct,
            peakHoldBottomPct: meterDbToHeightPct(peakHeldDb),
            rmsHoldBottomPct: meterDbToHeightPct(st.rmsHoldLineDb),
            peakDb: peakHeldDb,
            peakHeldDb,
            instPeakDb,
            rmsDb: instRmsDb,
            rmsHeldDb,
            instRmsDb,
            rmsDbDisp: rmsHeldDb,
            rawPeak: peak,
            showPeakHoldLine: peakHeldDb > instPeakDb + 0.05,
            showRmsHoldLine: rmsHeldDb > instRmsDb + 0.05,
            peakHoldLineColor: masterMeterLineColorForDb(peakHeldDb),
            rmsHoldLineColor: masterMeterLineColorForDb(st.rmsHoldLineDb),
            peakHoldBorderColor: masterMeterHoldBorderColorForDb(peakHeldDb),
            rmsHoldBorderColor: masterMeterHoldBorderColorForDb(st.rmsHoldLineDb)
        };
    };
    
    const triggerGainReduceGlow = () => {
        const mvWrap = document.querySelector('.master-vol-container');
        if (!mvWrap) return;
        mvWrap.classList.remove('gain-reduce-glow');
        void mvWrap.offsetWidth;
        mvWrap.classList.add('gain-reduce-glow');
        if (gainReduceGlowTimer) clearTimeout(gainReduceGlowTimer);
        gainReduceGlowTimer = setTimeout(() => {
            mvWrap.classList.remove('gain-reduce-glow');
            gainReduceGlowTimer = null;
        }, 1000);
    };

    const autoReduceGain = (excessDb) => {
        const now = Date.now();
        if (
            !isReviewMixMonitorActive() ||
            excessDb < 0.2 ||
            isNaN(excessDb) ||
            now - lastReductionTime < REDUCTION_COOLDOWN
        ) {
            return;
        }
        const audioCtx = getReviewMixAudioCtx();
        if (!audioCtx || !reviewMixMasterNode) return;
        const currentGain = readMasterVolSliderLinear();
        const reductionFactor = Math.max(0.93, Math.pow(10, -excessDb / 48));
        const newGain = Math.max(0.01, currentGain * reductionFactor);
        const didReduce = newGain < currentGain - 0.0005;
        lastReductionTime = now;
        applyMasterVolToMix(newGain, true);
        if (typeof writeLog === 'function') {
            writeLog('! CLIP PROTECT: -' + excessDb.toFixed(1) + 'dB reduction.');
        }
        saveUiPrefsToLocalStorage();
        if (didReduce) triggerGainReduceGlow();
    };
    
    const triggerClipLamp = (id) => {
        const lamp = document.getElementById(id);
        if (!lamp) return;
        lamp.classList.add('clip-on');
        if (clipTimers[id]) clearTimeout(clipTimers[id]);
        clipTimers[id] = setTimeout(() => {
            lamp.classList.remove('clip-on');
        }, 2000); 
    };
    
    // Analyze OFF 時は UI 更新・スペクトラム描画を止め、
    // auto-gain 判定に必要なピーク検出だけを軽量に回す。
    let peakScratchL = null;
    let peakScratchR = null;
    let peakScratchV = null;

    function peakDbFromAnalyser(analyser, scratch) {
        if (!analyser) return { peakDb: -Infinity, scratch: scratch };
        const len = analyser.fftSize | 0;
        if (len <= 0) return { peakDb: -Infinity, scratch: scratch };
        if (!scratch || !(scratch instanceof Float32Array) || scratch.length !== len) {
            scratch = new Float32Array(len);
        }
        analyser.getFloatTimeDomainData(scratch);
        let peak = 0;
        for (let i = 0; i < scratch.length; i++) {
            const v = Math.abs(scratch[i]);
            if (v > peak) peak = v;
        }
        const instPeakDb = 20 * Math.log10(Math.max(peak, 1e-8));
        return { peakDb: instPeakDb, scratch };
    }

    const updateUIFrame = () => {
        if (!isReviewMixMonitorActive()) return;
        const audioCtx = getReviewMixAudioCtx();
        if (!audioCtx) return;
        const ctxNow = audioCtx.currentTime;

        if (!analyzeOn) {
            let maxPeakDb = -Infinity;
            if (anaL) {
                const res = peakDbFromAnalyser(anaL, peakScratchL);
                peakScratchL = res.scratch;
                maxPeakDb = Math.max(maxPeakDb, res.peakDb);
            }
            if (anaR) {
                const res = peakDbFromAnalyser(anaR, peakScratchR);
                peakScratchR = res.scratch;
                maxPeakDb = Math.max(maxPeakDb, res.peakDb);
            }

            if (
                typeof isVideoAudioPlaybackViaNativeElement === 'function' &&
                isVideoAudioPlaybackViaNativeElement() &&
                typeof getVideoTrackAnalyser === 'function'
            ) {
                const vAna = getVideoTrackAnalyser();
                if (vAna) {
                    const res = peakDbFromAnalyser(vAna, peakScratchV);
                    peakScratchV = res.scratch;
                    maxPeakDb = Math.max(maxPeakDb, res.peakDb);
                }
            }

            if (isFinite(maxPeakDb) && maxPeakDb > 0.15) {
                autoReduceGain(maxPeakDb);
            }

            if (typeof updateTrackLaneMeters === 'function') {
                updateTrackLaneMeters();
            }

            requestAnimId = requestAnimationFrame(updateUIFrame);
            return;
        }

        let l = getMeterValues(anaL, 'l', ctxNow);
        let r = getMeterValues(anaR, 'r', ctxNow);
        if (
            typeof isVideoAudioPlaybackViaNativeElement === 'function' &&
            isVideoAudioPlaybackViaNativeElement() &&
            typeof getVideoTrackAnalyser === 'function'
        ) {
            const vAna = getVideoTrackAnalyser();
            if (vAna) {
                const vm = getMeterValues(vAna, 'v', ctxNow);
                l = mergeVideoAnalyserMeterIntoChannel(l, vm);
                r = mergeVideoAnalyserMeterIntoChannel(r, vm);
            }
        }

        const maxPeakDb = Math.max(l.instPeakDb, r.instPeakDb);
        if (isFinite(maxPeakDb) && maxPeakDb > 0.15) {
            autoReduceGain(maxPeakDb);
        }
    
        const mCont0 = document.querySelector('.m-meter-container');
        const meterStackH = mCont0 && mCont0.clientHeight > 8 ? mCont0.clientHeight : defaultSpectrumLedTrackHeightPx();
        const meterHoldHpx = meterStackH / Math.abs(METER_DB_MAX - meterDisplayDbMin);
        syncMasterMeterBarBackgroundStyles(meterStackH);
    
        const applyM = (s, d) => {
            const elPk = document.getElementById(`m-peak-${s}`);
            const elRms = document.getElementById(`m-rms-${s}`);
            if (!elPk || !elRms) return;
            elPk.style.height = d.pPct + '%';
            elRms.style.height = d.rPct + '%';
            const phl = document.getElementById(`m-peak-${s}-hold`);
            if (phl) {
                phl.style.height = `${meterHoldHpx}px`;
                phl.style.bottom = d.peakHoldBottomPct + '%';
                phl.style.opacity = d.showPeakHoldLine ? '1' : '0';
                phl.style.background = d.peakHoldLineColor;
                phl.style.borderColor = d.peakHoldBorderColor;
            }
            const rhl = document.getElementById(`m-rms-${s}-hold`);
            if (rhl) {
                rhl.style.height = `${meterHoldHpx}px`;
                rhl.style.bottom = d.rmsHoldBottomPct + '%';
                rhl.style.opacity = d.showRmsHoldLine ? '1' : '0';
                rhl.style.background = d.rmsHoldLineColor;
                rhl.style.borderColor = d.rmsHoldBorderColor;
            }
            const valPk = document.getElementById(`val-peak-${s}`);
            const valRms = document.getElementById(`val-rms-${s}`);
            if (valPk) {
                valPk.innerText = formatMeterDbReadout(d.peakDb);
                valPk.style.color = '#ffffff';
            }
            if (valRms) {
                valRms.innerText = formatMeterDbReadout(d.rmsDbDisp);
                valRms.style.color = '#ffffff';
            }
    
            if (d.instPeakDb >= 0) triggerClipLamp(`clip-peak-${s}`);
        };
        applyM('l', l);
        applyM('r', r);

        if (typeof updateTrackLaneMeters === 'function') {
            updateTrackLaneMeters();
        }

        drawSpectrum();
        requestAnimId = requestAnimationFrame(updateUIFrame);
    };
    
    const SPECTRUM_DB_MAX = 0;
    const SPEC_DISPLAY_PEAK_SOFT_KNEE_DB = -6;
    const SPEC_DISPLAY_PEAK_SOFT_GAMMA = 1.24;
    const SPEC_LED_DIM_GREEN = '#13181e';
    const SPEC_GRID_BLACK = '#000000';
    const SPEC_LED_CELL_HEIGHT_PX = 5;
    const SPEC_LED_HLINE_PX = 1;
    const SPEC_PAD_TOP_PX = 14;
    const SPEC_FREQ_LABELS_BELOW_PX = 40;
    
    function spectrumDbNormLinear(db) {
        if (!isFinite(db)) return 0;
        const lo = spectrumDisplayDbMin;
        const hi = SPECTRUM_DB_MAX;
        const range = hi - lo;
        if (range <= 0) return 0;
        const c = Math.max(lo, Math.min(hi, db));
        return (c - lo) / range;
    }
    
    /** 膝より上だけ γ>1 で圧縮（0 dB は維持）。 */
    function spectrumDisplayPeakSoften(db) {
        if (!isFinite(db)) return spectrumDisplayDbMin;
        const hi = SPECTRUM_DB_MAX;
        const x = Math.max(spectrumDisplayDbMin, Math.min(hi, db));
        const knee = SPEC_DISPLAY_PEAK_SOFT_KNEE_DB;
        const g = SPEC_DISPLAY_PEAK_SOFT_GAMMA;
        if (x <= knee || g <= 1.0001) return x;
        const span = hi - knee;
        if (span <= 0) return x;
        const t = (x - knee) / span;
        const u = Math.max(0, Math.min(1, t));
        return knee + span * Math.pow(u, g);
    }
    
    /** メーターと同色の縦グラデ（スペクトラム列の塗り）。 */
    function spectrumMeterLikeGradient(canvasCtx, plotY, plotH) {
        const y0 = plotY + plotH;
        const y1 = plotY;
        const g = canvasCtx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, METER_GRAD_DEEP);
        g.addColorStop(0.26, METER_GRAD_MID);
        g.addColorStop(0.55, METER_GRAD_LIT);
        g.addColorStop(0.82, METER_GRAD_PALE);
        g.addColorStop(1, METER_GRAD_WHITE);
        return g;
    }
    
    const SPECTRUM_GRID_LABEL_TOP_ROW = [
        [20, '20'], [31.5, '31.5'], [50, '50'], [80, '80'], [125, '125'], [200, '200'], [315, '315'], [500, '500'], [800, '800'],
        [1250, '1k25'], [2000, '2k'], [3150, '3k15'], [5000, '5k'], [8000, '8k'], [12500, '12k5'], [20000, '20k']
    ];
    const SPECTRUM_GRID_LABEL_BOT_ROW = [
        [25, '25'], [40, '40'], [63, '63'], [100, '100'], [160, '160'], [250, '250'], [400, '400'], [630, '630'],
        [1000, '1k'], [1600, '1k6'], [2500, '2k5'], [4000, '4k'], [6300, '6k3'], [10000, '10k'], [16000, '16k']
    ];
    
    function collectSpectrumGridFreqs(nyquist) {
        const maxF = nyquist * 0.995;
        const s = new Set();
        for (const [f] of SPECTRUM_GRID_LABEL_TOP_ROW) if (f <= maxF) s.add(f);
        for (const [f] of SPECTRUM_GRID_LABEL_BOT_ROW) if (f <= maxF) s.add(f);
        return [...s].sort((a, b) => a - b);
    }
    
    function spectrumGridBandsForNyquist(nyquist, fLo) {
        const fHi = nyquist * 0.995;
        const grid = collectSpectrumGridFreqs(nyquist);
        const centersList = grid.filter((fc) => fc >= fLo - 1e-9 && fc <= fHi);
        const n = centersList.length;
        const low = new Float32Array(n);
        const high = new Float32Array(n);
        const centers = Float32Array.from(centersList);
        const gLo = Math.pow(2, -1 / 6);
        const gHi = Math.pow(2, 1 / 6);
        for (let i = 0; i < n; i++) {
            const c = centersList[i];
            let loB = i === 0 ? fLo : Math.sqrt(centersList[i - 1] * c);
            let hiB = i === n - 1 ? fHi : Math.sqrt(c * centersList[i + 1]);
            loB = Math.max(fLo, loB);
            hiB = Math.min(fHi, hiB);
            if (!(loB < hiB)) {
                low[i] = Math.max(fLo, c * gLo);
                high[i] = Math.min(fHi, c * gHi);
                if (low[i] >= high[i]) low[i] = Math.max(fLo, high[i] * 0.7);
            } else {
                low[i] = loB;
                high[i] = hiB;
            }
        }
        return { centers, low, high, n };
    }
    
    function spectrumBarRectsUniformGutter(plotX, plotW, nBands, gutterPx) {
        const plotR = plotX + plotW;
        const rects = new Array(nBands);
        if (nBands <= 0) return rects;
        const gutterTotal = (nBands - 1) * gutterPx;
        const avail = Math.max(0, plotR - plotX - gutterTotal);
        const base = Math.floor(avail / nBands);
        let rem = avail - base * nBands;
        let x = plotX;
        for (let b = 0; b < nBands; b++) {
            const bw = base + (rem > 0 ? 1 : 0);
            if (rem > 0) rem--;
            rects[b] = { x1: x, barW: bw };
            x += bw + (b < nBands - 1 ? gutterPx : 0);
        }
        return rects;
    }
    
    function spectrumBarCenterXForFreqHz(bands, rects, fHz) {
        const tol = Math.max(5e-4, Math.abs(fHz) * 1e-12);
        for (let b = 0; b < bands.n; b++) {
            if (Math.abs(bands.centers[b] - fHz) <= tol) {
                return rects[b].x1 + rects[b].barW * 0.5;
            }
        }
        return null;
    }
    
    function bandDbToLinearPow(db) {
        if (!isFinite(db) || db < -120) return 0;
        return Math.pow(10, db / 10);
    }
    
    /**
     * 線形パワー列へのガウスぼかし（正規化畳み込み）。σ≈0 はコピーのみ。
     * outReuse: 長さ n 以上の Float32Array を渡すとその先頭 n 要素に書き込み、同一参照を返す。
     */
    function blurBandsLinearGaussian(bandLin, sigma, outReuse) {
        const n = bandLin.length;
        if (!(sigma > 1e-6)) return Float32Array.from(bandLin);
        const out = outReuse && outReuse.length >= n ? outReuse : new Float32Array(n);
        const r = Math.ceil(sigma * 4);
        for (let b = 0; b < n; b++) {
            let s = 0, w = 0;
            for (let k = -r; k <= r; k++) {
                const bk = b + k;
                if (bk < 0 || bk >= n) continue;
                const g = Math.exp(-(k * k) / (2 * sigma * sigma));
                s += bandLin[bk] * g;
                w += g;
            }
            out[b] = w > 0 ? s / w : 0;
        }
        return out;
    }
    
    function spectrumYAtDb(plotY, plotH, db) {
        return plotY + plotH * (1 - spectrumDbNormLinear(db));
    }
    
    function spectrumLedRowCount(loDb) {
        const loInt = Math.ceil(loDb - 1e-9);
        return Math.max(1, -loInt);
    }
    
    function spectrumLedPlotInnerHeightPx(loDb) {
        const n = spectrumLedRowCount(loDb);
        return n * SPEC_LED_CELL_HEIGHT_PX + Math.max(0, n - 1) * SPEC_LED_HLINE_PX;
    }
    
    function spectrumCanvasOuterHeightPx() {
        return SPEC_PAD_TOP_PX + spectrumLedPlotInnerHeightPx(spectrumDisplayDbMin) + SPEC_FREQ_LABELS_BELOW_PX;
    }
    
    function defaultSpectrumLedTrackHeightPx() {
        return Math.max(48, spectrumLedPlotInnerHeightPx(spectrumDisplayDbMin));
    }
    
    /** --spectrum-led-track-px / canvas 外周とメーターバーグラデの高さを同期。 */
    function syncMonitorAnalysisLayoutHeights() {
        const trackPx = defaultSpectrumLedTrackHeightPx();
        const outerPx = spectrumCanvasOuterHeightPx();
        document.documentElement.style.setProperty('--spectrum-led-track-px', `${trackPx}px`);
        document.documentElement.style.setProperty('--spectrum-canvas-outer-px', `${outerPx}px`);
        syncMasterMeterBarBackgroundStyles(trackPx);
        const wrap = document.querySelector('.spectrum-canvas-wrap');
        if (wrap) wrap.style.minHeight = `${outerPx}px`;
    }
    
    installMasterMeterScaleUI();
    
    /** LED 1 行 = 1 dB。y は canvas 座標（下向き正）。 */
    function spectrumBuildLedCells(plotY, plotH, loDb) {
        const loInt = Math.ceil(loDb - 1e-9);
        const n = spectrumLedRowCount(loDb);
        const CELL = SPEC_LED_CELL_HEIGHT_PX;
        const LINE = SPEC_LED_HLINE_PX;
        const bot = new Array(n);
        const top = new Array(n);
        const yBottom = plotY + plotH;
        bot[0] = yBottom;
        top[0] = bot[0] - CELL;
        for (let i = 1; i < n; i++) {
            bot[i] = top[i - 1] - LINE;
            top[i] = bot[i] - CELL;
        }
        return { n, loInt, bot, top };
    }
    
    function spectrumLedDimCellColor(cellDbLoInt) {
        return SPEC_LED_DIM_GREEN;
    }
    
    function spectrumAxisDbText(db) {
        if (db === 0) return '+0';
        return String(db);
    }
    
    /** 行間の黒帯。続けてピークドットを描くので順序固定。 */
    function spectrumDrawLedInterRowBlack(plotX, plotY, plotW, plotH, loDb) {
        const cells = spectrumBuildLedCells(plotY, plotH, loDb);
        const n = cells.n;
        if (n < 2) return;
        canvasCtx.fillStyle = SPEC_GRID_BLACK;
        canvasCtx.shadowBlur = 0;
        canvasCtx.shadowColor = 'transparent';
        const x0 = Math.round(plotX);
        const wPx = Math.max(0, Math.round(plotX + plotW) - x0);
        for (let i = 0; i < n - 1; i++) {
            const y = cells.bot[i + 1];
            const hh = cells.top[i] - cells.bot[i + 1];
            if (hh > 0) canvasCtx.fillRect(x0, y, wPx, hh);
        }
    }
    
    function defaultSpectrumNyquistHz() {
        const audioCtx = getReviewMixAudioCtx();
        return audioCtx && audioCtx.sampleRate ? audioCtx.sampleRate * 0.5 : 22050;
    }
    
    function spectrumComputeGeometry(nyquist, w, h) {
        const padL = 44;
        const padR = 44;
        const padT = SPEC_PAD_TOP_PX;
        const plotH = spectrumLedPlotInnerHeightPx(spectrumDisplayDbMin);
        const plotX = padL + SPECTRUM_INSET_LEFT_PX;
        const plotY = padT;
        const plotW = w - padL - padR - SPECTRUM_INSET_LEFT_PX - SPECTRUM_INSET_RIGHT_PX;
        const fLo = SPECTRUM_GRID_FLOOR_HZ;
        const fHi = nyquist * 0.995;
        const freqToXLog = (f) => {
            const ff = Math.max(fLo, Math.min(fHi, f));
            const t = Math.log(ff / fLo) / Math.log(fHi / fLo);
            return plotX + t * plotW;
        };
        const maxFLbl = nyquist * 0.995;
        return { plotX, plotY, plotW, plotH, padT, nyquist, fLo, fHi, freqToXLog, maxFLbl };
    }
    
    function spectrumDrawChrome(w, h, g) {
        const { plotX, plotY, plotW, plotH, freqToXLog, maxFLbl } = g;
        canvasCtx.shadowBlur = 0;
        canvasCtx.shadowColor = 'transparent';
        canvasCtx.fillStyle = '#242629';
        canvasCtx.fillRect(0, 0, w, h);
        /* プロット内は黒ベース（帯域間ガターや罫線まわりに #242629 が挟まらない） */
        canvasCtx.fillStyle = SPEC_GRID_BLACK;
        canvasCtx.fillRect(plotX, plotY, plotW, plotH);
    
        canvasCtx.lineWidth = 1;
        const dbMin = spectrumDisplayDbMin;
        canvasCtx.font = `normal ${MONITOR_CHROME_FONT_PX}px "Courier New", Courier, monospace`;
        canvasCtx.textBaseline = 'middle';
        canvasCtx.fillStyle = '#ffffff';
        const labelSet = new Set();
        for (let db = 0; db >= dbMin; db -= 10) labelSet.add(db);
        labelSet.add(dbMin);
        for (const db of [...labelSet].sort((a, b) => b - a)) {
            const y = plotY + plotH * (1 - spectrumDbNormLinear(db));
            const t = spectrumAxisDbText(db);
            canvasCtx.textAlign = 'right';
            canvasCtx.fillText(t, plotX - 5, y);
            canvasCtx.textAlign = 'left';
            canvasCtx.fillText(t, plotX + plotW + 5, y);
        }
    
        const gridLines = collectSpectrumGridFreqs(g.nyquist);
        const py = Math.round(plotY);
        const ph = Math.max(0, Math.round(plotY + plotH) - py);
        canvasCtx.fillStyle = SPEC_GRID_BLACK;
        canvasCtx.shadowBlur = 0;
        canvasCtx.shadowColor = 'transparent';
        for (const f of gridLines) {
            const x = Math.round(freqToXLog(f));
            if (ph > 0) canvasCtx.fillRect(x, py, 1, ph);
        }
        canvasCtx.fillStyle = '#ffffff';
        canvasCtx.font = `normal ${MONITOR_CHROME_FONT_PX}px "Courier New", Courier, monospace`;
        canvasCtx.textBaseline = 'top';
        canvasCtx.textAlign = 'center';
        const row1y = plotY + plotH + 5;
        const row2y = plotY + plotH + 14;
        const bandsLbl = spectrumGridBandsForNyquist(g.nyquist, SPECTRUM_GRID_FLOOR_HZ);
        const rectsLbl = spectrumBarRectsUniformGutter(
            plotX,
            plotW,
            bandsLbl.n,
            SPECTRUM_BAR_GUTTER_PX
        );
        for (const [f, text] of SPECTRUM_GRID_LABEL_TOP_ROW) {
            if (f > maxFLbl) continue;
            const cx = spectrumBarCenterXForFreqHz(bandsLbl, rectsLbl, f);
            const x = cx !== null ? cx : freqToXLog(f);
            canvasCtx.fillText(text, x, row1y);
        }
        for (const [f, text] of SPECTRUM_GRID_LABEL_BOT_ROW) {
            if (f > maxFLbl) continue;
            const cx = spectrumBarCenterXForFreqHz(bandsLbl, rectsLbl, f);
            const x = cx !== null ? cx : freqToXLog(f);
            canvasCtx.fillText(text, x, row2y);
        }
    }
    
    function spectrumDrawBarsFromEnv(bands, plotX, plotY, plotW, plotH, cellsOpt) {
        const nBands = bands.n;
        const rects = spectrumBarRectsUniformGutter(plotX, plotW, nBands, SPECTRUM_BAR_GUTTER_PX);
        const loDb = spectrumDisplayDbMin;
        const cells = cellsOpt || spectrumBuildLedCells(plotY, plotH, loDb);
        const { n: nLedRows, loInt } = cells;
        const specMeterGrad = spectrumMeterLikeGradient(canvasCtx, plotY, plotH);
        canvasCtx.shadowBlur = 0;
        canvasCtx.shadowColor = 'transparent';
        for (let b = 0; b < nBands; b++) {
            const raw = spectrumBandEnv[b];
            const barDb = Math.max(
                spectrumDisplayDbMin,
                Math.min(SPECTRUM_DB_MAX, isFinite(raw) ? raw : spectrumDisplayDbMin)
            );
            const norm = spectrumDbNormLinear(barDb);
            const { x1, barW } = rects[b];
            const barHeight = norm * plotH;
    
            for (let i = 0; i < nLedRows; i++) {
                const yTop = cells.top[i];
                const yBot = cells.bot[i];
                const hCell = yBot - yTop;
                if (hCell <= 0) continue;
                const n = loInt + i;
                canvasCtx.fillStyle = spectrumLedDimCellColor(n);
                canvasCtx.fillRect(x1, yTop, barW, hCell);
            }
    
            if (barHeight > 0.25) {
                canvasCtx.fillStyle = specMeterGrad;
                for (let i = 0; i < nLedRows; i++) {
                    const n = loInt + i;
                    const segLo = n;
                    const segHi = n + 1;
                    if (!(segLo < barDb && segHi > loDb)) continue;
                    const yTop = cells.top[i];
                    const yBot = cells.bot[i];
                    const hLit = yBot - yTop;
                    if (hLit <= 0) continue;
                    canvasCtx.fillRect(x1, yTop, barW, hLit);
                }
            }
        }
        return { rects, nBands };
    }
    
    function spectrumDrawSpectrumColumnGutters(plotX, plotY, plotW, plotH, rects, nBands) {
        const y0 = Math.round(plotY);
        const hPx = Math.max(0, Math.round(plotY + plotH) - y0);
        if (hPx <= 0 || nBands <= 0) return;
        canvasCtx.fillStyle = SPEC_GRID_BLACK;
        const xPlotL = Math.round(plotX);
        const xPlotR = Math.round(plotX + plotW) - 1;
        canvasCtx.fillRect(xPlotL, y0, 1, hPx);
        for (let b = 0; b < nBands - 1; b++) {
            const xSep = rects[b].x1 + rects[b].barW;
            canvasCtx.fillRect(xSep, y0, 1, hPx);
        }
        if (xPlotR !== xPlotL) {
            canvasCtx.fillRect(xPlotR, y0, 1, hPx);
        }
    }
    
    function spectrumDrawSpectrumLedPeaks(bands, plotY, plotH, rects, cellsOpt) {
        const nBands = bands.n;
        const loDb = spectrumDisplayDbMin;
        const cells = cellsOpt || spectrumBuildLedCells(plotY, plotH, loDb);
        canvasCtx.shadowBlur = 0;
        canvasCtx.shadowColor = 'transparent';
        for (let b = 0; b < nBands; b++) {
            const rawPk = spectrumPeakHoldDb[b];
            const pkDb = Math.max(
                spectrumDisplayDbMin,
                Math.min(SPECTRUM_DB_MAX, isFinite(rawPk) ? rawPk : spectrumDisplayDbMin)
            );
            if (!(pkDb > loDb + 1e-4)) continue;
            const iPk = Math.max(
                0,
                Math.min(cells.n - 1, Math.floor(pkDb) - cells.loInt)
            );
            const yTop = cells.top[iPk];
            const yBot = cells.bot[iPk];
            const { x1, barW } = rects[b];
            canvasCtx.fillStyle = meterLevelColorLerp(spectrumDbNormLinear(pkDb));
            canvasCtx.fillRect(x1, yTop, barW, yBot - yTop);
        }
    }
    
    /** HiDPI でラベルが滲まないようバッキングストアを DPR 倍にする（描画は CSS ピクセル座標のまま） */
    function spectrumResizeCanvasBackingStore() {
        if (!canvas || !canvasCtx) return null;
        const wCss = canvas.clientWidth | 0;
        if (wCss < 2) return null;
        const hCss = spectrumCanvasOuterHeightPx();
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        canvas.width = Math.max(1, Math.round(wCss * dpr));
        canvas.height = Math.max(1, Math.round(hCss * dpr));
        canvas.style.width = `${wCss}px`;
        canvas.style.height = `${hCss}px`;
        canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        canvasCtx.imageSmoothingEnabled = false;
        return { w: wCss, h: hCss };
    }
    
    function paintSpectrumIdle() {
        if (!canvas || !canvasCtx) return;
        const sized = spectrumResizeCanvasBackingStore();
        if (!sized) return;
        const w = sized.w;
        const hSpec = sized.h;
        const audioCtxIdle = getReviewMixAudioCtx();
        const nyquist =
            audioCtxIdle && audioCtxIdle.sampleRate
                ? audioCtxIdle.sampleRate * 0.5
                : defaultSpectrumNyquistHz();
        const g = spectrumComputeGeometry(nyquist, w, hSpec);
        spectrumDrawChrome(w, hSpec, g);
        const bands = spectrumGridBandsForNyquist(nyquist, SPECTRUM_GRID_FLOOR_HZ);
        const nBands = bands.n;
        const { plotX, plotY, plotW, plotH } = g;
        const floor = spectrumDisplayDbMin;
        if (!spectrumBandEnv || spectrumBandEnv.length !== nBands) {
            spectrumBandEnv = new Float32Array(nBands).fill(floor);
        } else {
            for (let b = 0; b < nBands; b++) spectrumBandEnv[b] = floor;
        }
        if (!spectrumPeakHoldDb || spectrumPeakHoldDb.length !== nBands) {
            spectrumPeakHoldDb = new Float32Array(nBands).fill(floor);
            spectrumPeakHoldUntil = new Float32Array(nBands).fill(-1e9);
        } else {
            for (let b = 0; b < nBands; b++) {
                spectrumPeakHoldDb[b] = floor;
                spectrumPeakHoldUntil[b] = -1e9;
            }
        }
        const cellsIdle = spectrumBuildLedCells(plotY, plotH, floor);
        const { rects } = spectrumDrawBarsFromEnv(bands, plotX, plotY, plotW, plotH, cellsIdle);
        spectrumDrawLedInterRowBlack(plotX, plotY, plotW, plotH, spectrumDisplayDbMin);
        spectrumDrawSpectrumColumnGutters(plotX, plotY, plotW, plotH, rects, nBands);
        spectrumDrawSpectrumLedPeaks(bands, plotY, plotH, rects, cellsIdle);
        syncMonitorAnalysisLayoutHeights();
    }
    
    function mergeVideoAnalyserMeterIntoChannel(base, video) {
        if (!video || !base) return base;
        if (video.pPct <= base.pPct && video.rPct <= base.rPct && video.instPeakDb <= base.instPeakDb) {
            return base;
        }
        return {
            pPct: Math.max(base.pPct, video.pPct),
            rPct: Math.max(base.rPct, video.rPct),
            peakHoldBottomPct: Math.max(base.peakHoldBottomPct, video.peakHoldBottomPct),
            rmsHoldBottomPct: Math.max(base.rmsHoldBottomPct, video.rmsHoldBottomPct),
            peakDb: Math.max(base.peakDb, video.peakDb),
            peakHeldDb: Math.max(base.peakHeldDb, video.peakHeldDb),
            instPeakDb: Math.max(base.instPeakDb, video.instPeakDb),
            rmsDb: Math.max(base.rmsDb, video.rmsDb),
            rmsHeldDb: Math.max(base.rmsHeldDb, video.rmsHeldDb),
            instRmsDb: Math.max(base.instRmsDb, video.instRmsDb),
            rmsDbDisp: Math.max(base.rmsDbDisp, video.rmsDbDisp),
            rawPeak: Math.max(base.rawPeak, video.rawPeak),
            showPeakHoldLine: base.showPeakHoldLine || video.showPeakHoldLine,
            showRmsHoldLine: base.showRmsHoldLine || video.showRmsHoldLine,
            peakHoldLineColor: video.instPeakDb > base.instPeakDb ? video.peakHoldLineColor : base.peakHoldLineColor,
            rmsHoldLineColor: video.instRmsDb > base.instRmsDb ? video.rmsHoldLineColor : base.rmsHoldLineColor,
            peakHoldBorderColor:
                video.instPeakDb > base.instPeakDb ? video.peakHoldBorderColor : base.peakHoldBorderColor,
            rmsHoldBorderColor:
                video.instRmsDb > base.instRmsDb ? video.rmsHoldBorderColor : base.rmsHoldBorderColor,
        };
    }

    function mergeNativeVideoAnalyserIntoSpectrum(floatData, audioCtx) {
        if (
            typeof isVideoAudioPlaybackViaNativeElement !== 'function' ||
            !isVideoAudioPlaybackViaNativeElement()
        ) {
            return;
        }
        const vAna =
            typeof getVideoTrackAnalyser === 'function' ? getVideoTrackAnalyser() : null;
        if (!vAna || !audioCtx) return;
        const vLen = vAna.frequencyBinCount;
        if (!spectrumScratchVideoFloat || spectrumScratchVideoFloatLen !== vLen) {
            spectrumScratchVideoFloatLen = vLen;
            spectrumScratchVideoFloat = new Float32Array(vLen);
        }
        const vData = spectrumScratchVideoFloat;
        vAna.getFloatFrequencyData(vData);
        const masterLen = floatData.length;
        const nyquist = audioCtx.sampleRate / 2;
        for (let i = 0; i < masterLen; i++) {
            const f = (i / masterLen) * nyquist;
            const vi = Math.min(vLen - 1, Math.max(0, Math.round((f / nyquist) * vLen)));
            if (vData[vi] > floatData[i]) floatData[i] = vData[vi];
        }
    }

    function drawSpectrum() {
        const audioCtx = getReviewMixAudioCtx();
        if (!masterAnalyser || !audioCtx || !canvasCtx) return;
        const ctxNow = audioCtx.currentTime;
        const dtSp = lastSpectrumDrawT > 0 ? Math.min(0.12, Math.max(0, ctxNow - lastSpectrumDrawT)) : (1 / 60);
        lastSpectrumDrawT = ctxNow;
    
        const bufferLength = masterAnalyser.frequencyBinCount;
        if (!spectrumScratchFloat || spectrumScratchFloatLen !== bufferLength) {
            spectrumScratchFloatLen = bufferLength;
            spectrumScratchFloat = new Float32Array(bufferLength);
        }
        const floatData = spectrumScratchFloat;
        masterAnalyser.getFloatFrequencyData(floatData);
        mergeNativeVideoAnalyserIntoSpectrum(floatData, audioCtx);
    
        let tdPeakLin = 0;
        if (anaL && anaR) {
            const tdLen = anaL.fftSize;
            if (!spectrumScratchTdL || spectrumScratchTdLen !== tdLen) {
                spectrumScratchTdLen = tdLen;
                spectrumScratchTdL = new Float32Array(tdLen);
                spectrumScratchTdR = new Float32Array(tdLen);
            }
            const tdl = spectrumScratchTdL;
            const tdr = spectrumScratchTdR;
            anaL.getFloatTimeDomainData(tdl);
            anaR.getFloatTimeDomainData(tdr);
            for (let i = 0; i < tdl.length; i++) {
                tdPeakLin = Math.max(tdPeakLin, Math.abs(tdl[i]), Math.abs(tdr[i]));
            }
        }
        let fftBinMax = -300;
        for (let i = 0; i < bufferLength; i++) {
            if (floatData[i] > fftBinMax) fftBinMax = floatData[i];
        }
        if (anaL && anaR && tdPeakLin > 1e-8) {
            const tdPeakDb = 20 * Math.log10(tdPeakLin);
            if (isFinite(tdPeakDb) && isFinite(fftBinMax) && fftBinMax > -115) {
                let dCal = tdPeakDb - fftBinMax;
                dCal = Math.max(-2, Math.min(SPEC_FFT_CAL_DB_MAX, dCal));
                if (Math.abs(dCal) > 0.05) {
                    for (let i = 0; i < bufferLength; i++) {
                        if (isFinite(floatData[i])) floatData[i] += dCal;
                    }
                }
            }
        }
    
        const sized = spectrumResizeCanvasBackingStore();
        if (!sized) return;
        const w = sized.w;
        const hSpec = sized.h;
    
        const nyquist = audioCtx.sampleRate / 2;
        const g = spectrumComputeGeometry(nyquist, w, hSpec);
        const { plotX, plotY, plotW, plotH, fLo } = g;
        spectrumDrawChrome(w, hSpec, g);
    
        const bands = spectrumGridBandsForNyquist(nyquist, SPECTRUM_GRID_FLOOR_HZ);
        const nBands = bands.n;
        if (!spectrumScratchBandDb || spectrumScratchBandNb !== nBands) {
            spectrumScratchBandNb = nBands;
            spectrumScratchBandDb = new Float32Array(nBands);
            spectrumScratchBandLin = new Float32Array(nBands);
            spectrumScratchDisplayDb = new Float32Array(nBands);
            spectrumScratchBlurredLin = new Float32Array(nBands);
        }
        const bandDb = spectrumScratchBandDb;
        const bandLin = spectrumScratchBandLin;
        const displayDb = spectrumScratchDisplayDb;
        bandLin.fill(0);
        const binW = nyquist / bufferLength;
        for (let i = 0; i < bufferLength; i++) {
            const fLeft = i * binW;
            const fRight = (i + 1) * binW;
            if (fRight <= fLo) continue;
            const db = floatData[i];
            if (!isFinite(db)) continue;
            const pBin = bandDbToLinearPow(db);
            const bw = fRight - fLeft;
            if (bw <= 0) continue;
            for (let b = 0; b < nBands; b++) {
                const bLow = bands.low[b];
                const bHigh = bands.high[b];
                const o0 = Math.max(fLeft, bLow);
                const o1 = Math.min(fRight, bHigh);
                if (o1 <= o0) continue;
                bandLin[b] += pBin * ((o1 - o0) / bw);
            }
        }
        for (let b = 0; b < nBands; b++) {
            bandDb[b] = bandLin[b] > 1e-15 ? 10 * Math.log10(bandLin[b]) : -200;
        }
    
        if (SPEC_BLUR_SIGMA > 1e-6) {
            let bMxLin = 0;
            let mxLin = -1;
            for (let b = 0; b < nBands; b++) {
                if (bandLin[b] > mxLin) {
                    mxLin = bandLin[b];
                    bMxLin = b;
                }
            }
            const useSkirtShape = mxLin > SPEC_SKIRT_MIN_PEAK_LIN;
            const blurredLin = blurBandsLinearGaussian(bandLin, SPEC_BLUR_SIGMA, spectrumScratchBlurredLin);
            for (let b = 0; b < nBands; b++) {
                let mult = 1;
                if (useSkirtShape) {
                    const d = Math.abs(b - bMxLin);
                    if (d === 1) mult = SPEC_SKIRT_NEIGHBOR_ATTEN;
                    else if (d === 2) mult = SPEC_SKIRT_OUTER_BOOST;
                    else if (d === 3) mult = SPEC_SKIRT_RING3_MULT;
                    else mult = SPEC_SKIRT_RING4PLUS_MULT;
                }
                const shapedLin = blurredLin[b] * mult;
                const mergedLin = Math.max(bandLin[b], shapedLin);
                displayDb[b] = mergedLin > 1e-18 ? 10 * Math.log10(mergedLin) : -200;
            }
        } else {
            for (let b = 0; b < nBands; b++) displayDb[b] = bandDb[b];
        }
    
        let bMx = -1;
        let mxDisp = -300;
        for (let b = 0; b < nBands; b++) {
            if (displayDb[b] > mxDisp) {
                mxDisp = displayDb[b];
                bMx = b;
            }
        }
        let secondDisp = -300;
        for (let b = 0; b < nBands; b++) {
            if (b !== bMx && displayDb[b] > secondDisp) secondDisp = displayDb[b];
        }
        if (
            anaL &&
            anaR &&
            tdPeakLin > 1e-8 &&
            mxDisp > -115 &&
            isFinite(secondDisp) &&
            mxDisp - secondDisp >= SPEC_BELL_CALIB_MIN_DOMINANCE_DB
        ) {
            const tdPeakDb = 20 * Math.log10(tdPeakLin);
            if (isFinite(tdPeakDb)) {
                let dBell = tdPeakDb - mxDisp;
                dBell = Math.max(0, Math.min(SPEC_FFT_CAL_DB_MAX, dBell));
                if (dBell > 0.04) {
                    for (let b = 0; b < nBands; b++) {
                        if (displayDb[b] > -199) {
                            displayDb[b] = Math.min(SPECTRUM_DB_MAX, displayDb[b] + dBell);
                        }
                    }
                }
            }
        }
    
        if (!spectrumBandEnv || spectrumBandEnv.length !== nBands) {
            spectrumBandEnv = new Float32Array(nBands).fill(spectrumDisplayDbMin);
        }
        const qpUp =
            SPEC_SPECT_QP_RISE_SEC > 1e-9
                ? Math.min(1, 1 - Math.exp(-dtSp / SPEC_SPECT_QP_RISE_SEC))
                : 1;
        const qpDn = Math.min(1, 1 - Math.exp(-dtSp / SPEC_SPECT_QP_FALL_SEC));
        for (let b = 0; b < nBands; b++) {
            const rawTgt = Math.max(
                spectrumDisplayDbMin,
                Math.min(SPECTRUM_DB_MAX, isFinite(displayDb[b]) ? displayDb[b] : spectrumDisplayDbMin)
            );
            const tgt = spectrumDisplayPeakSoften(rawTgt);
            let env = spectrumBandEnv[b];
            if (!isFinite(env)) env = spectrumDisplayDbMin;
            const k = tgt >= env ? qpUp : qpDn;
            env += (tgt - env) * k;
            spectrumBandEnv[b] = Math.max(
                spectrumDisplayDbMin,
                Math.min(SPECTRUM_DB_MAX, env)
            );
        }
    
        if (!spectrumPeakHoldDb || spectrumPeakHoldDb.length !== nBands) {
            spectrumPeakHoldDb = new Float32Array(nBands).fill(spectrumDisplayDbMin);
            spectrumPeakHoldUntil = new Float32Array(nBands).fill(-1e9);
        }
        let bPkHold = 0;
        let vPkHold = spectrumDisplayDbMin;
        for (let b = 0; b < nBands; b++) {
            const v = spectrumBandEnv[b];
            if (isFinite(v) && v > vPkHold) {
                vPkHold = v;
                bPkHold = b;
            }
        }
        for (let b = 0; b < nBands; b++) {
            const inst = Math.max(
                spectrumDisplayDbMin,
                Math.min(SPECTRUM_DB_MAX, isFinite(spectrumBandEnv[b]) ? spectrumBandEnv[b] : spectrumDisplayDbMin)
            );
            const distPk = Math.abs(b - bPkHold);
            const holdSec =
                distPk === 0
                    ? SPEC_SPECT_PEAK_HOLD_CENTER_SEC
                    : distPk === 1
                      ? SPEC_PEAK_HOLD_NEIGHBOR_SEC
                      : SPEC_PEAK_HOLD_OUTER_SEC;
            let held = spectrumPeakHoldDb[b];
            if (inst > held) {
                held = inst;
                spectrumPeakHoldUntil[b] = ctxNow + holdSec;
            } else if (ctxNow >= spectrumPeakHoldUntil[b]) {
                let rel = SPEC_PEAK_RELEASE_DB_PER_SEC * dtSp;
                if (distPk === 1) rel *= SPEC_PEAK_RELEASE_MULT_NEIGHBOR;
                else if (distPk >= 2) rel *= SPEC_PEAK_RELEASE_MULT_OUTER;
                held = Math.max(inst, held - rel);
            }
            spectrumPeakHoldDb[b] = Math.max(
                spectrumDisplayDbMin,
                Math.min(SPECTRUM_DB_MAX, held)
            );
        }
    
        const cellsDraw = spectrumBuildLedCells(plotY, plotH, spectrumDisplayDbMin);
        const { rects } = spectrumDrawBarsFromEnv(bands, plotX, plotY, plotW, plotH, cellsDraw);
        spectrumDrawLedInterRowBlack(plotX, plotY, plotW, plotH, spectrumDisplayDbMin);
        spectrumDrawSpectrumColumnGutters(plotX, plotY, plotW, plotH, rects, nBands);
        spectrumDrawSpectrumLedPeaks(bands, plotY, plotH, rects, cellsDraw);
        syncMonitorAnalysisLayoutHeights();
    }
    
    function extinguishMonitorDisplays() {
        document.querySelectorAll('.clip-lamp').forEach((l) => {
            l.classList.remove('clip-on');
            if (clipTimers[l.id]) clearTimeout(clipTimers[l.id]);
        });
        const mvWrapEx = document.querySelector('.master-vol-container');
        if (mvWrapEx) mvWrapEx.classList.remove('gain-reduce-glow');
        if (gainReduceGlowTimer) { clearTimeout(gainReduceGlowTimer); gainReduceGlowTimer = null; }
        const mEx = document.querySelector('.m-meter-container');
        const mExH = mEx && mEx.clientHeight > 8 ? mEx.clientHeight : defaultSpectrumLedTrackHeightPx();
        const exHoldHpx = mExH / Math.abs(METER_DB_MAX - meterDisplayDbMin);
        syncMasterMeterBarBackgroundStyles(mExH);
        for (const s of ['l', 'r']) {
            const elPk = document.getElementById(`m-peak-${s}`);
            const elRms = document.getElementById(`m-rms-${s}`);
            if (elPk) {
                elPk.style.height = '0%';
            }
            if (elRms) {
                elRms.style.height = '0%';
            }
            const phl = document.getElementById(`m-peak-${s}-hold`);
            if (phl) {
                phl.style.height = `${exHoldHpx}px`;
                phl.style.bottom = '0%';
                phl.style.opacity = '0';
                phl.style.background = meterLevelColorLerp(0);
                phl.style.borderColor = masterMeterHoldBorderColorForDb(meterDisplayDbMin);
            }
            const rhl = document.getElementById(`m-rms-${s}-hold`);
            if (rhl) {
                rhl.style.height = `${exHoldHpx}px`;
                rhl.style.bottom = '0%';
                rhl.style.opacity = '0';
                rhl.style.background = meterLevelColorLerp(0);
                rhl.style.borderColor = masterMeterHoldBorderColorForDb(meterDisplayDbMin);
            }
            const vp = document.getElementById(`val-peak-${s}`);
            const vr = document.getElementById(`val-rms-${s}`);
            if (vp) {
                vp.innerText = formatMeterDbReadout(meterDisplayDbMin);
                vp.style.color = '#ffffff';
            }
            if (vr) {
                vr.innerText = formatMeterDbReadout(meterDisplayDbMin);
                vr.style.color = '#ffffff';
            }
        }
        spectrumBandEnv = null;
        spectrumPeakHoldDb = null;
        spectrumPeakHoldUntil = null;
        lastSpectrumDrawT = 0;
        if (analyzeOn) paintSpectrumIdle();
    }
    function isReviewMixMonitorAnalyzersWired() {
        return !!masterAnalyser;
    }

    window.ensureReviewMixMonitorOutput = ensureReviewMixMonitorOutput;
    window.isReviewMixMonitorAnalyzersWired = isReviewMixMonitorAnalyzersWired;
    window.setReviewMixMonitorTransportActive = setReviewMixMonitorTransportActive;
    window.resetReviewMixMonitorGain = resetReviewMixMonitorGain;

    /** All Clear 後: マスター音量を 0 dB（線形ゲイン 1.0）にリセット */
    function resetMasterVolumeForSessionClear() {
        applyMasterVolToMix(MASTER_VOL_UNITY_LINEAR, false);
        saveUiPrefsToLocalStorage();
    }

    function handleMasterVolShortcutKeydown(e) {
        if (!e || e.repeat) return false;
        if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return false;
        if (e.code !== 'KeyV') return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return false;
        e.preventDefault();
        applyMasterVolToMix(MASTER_VOL_UNITY_LINEAR, true);
        saveUiPrefsToLocalStorage();
        return true;
    }

    function handleAnalyzeShortcutKeydown(e) {
        if (!e || e.repeat) return false;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
        if (e.code !== 'KeyA') return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return false;
        e.preventDefault();
        toggleAnalyzeOn();
        return true;
    }

    window.resetMasterVolumeForSessionClear = resetMasterVolumeForSessionClear;
    window.handleMasterVolShortcutKeydown = handleMasterVolShortcutKeydown;
    window.handleAnalyzeShortcutKeydown = handleAnalyzeShortcutKeydown;
    window.handleAnalyzeOffShortcutKeydown = handleAnalyzeShortcutKeydown;
})();
