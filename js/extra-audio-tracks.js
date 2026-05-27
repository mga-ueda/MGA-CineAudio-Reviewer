    const EXTRA_TRACK_COUNT =
        typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 3;
    const VIDEO_AUDIO_SLOT_LABEL = 'Video Audio';
    /**
     * false = 動画は video 要素のネイティブ出力（確実に聴ける）。
     * アナライザー／トラックメーターは captureStream タップ（ensureReviewMixVideoMonitorTap）。
     * true にすると MediaElementSource 経由（環境によっては接続後も無音になる）。
     */
    const ROUTE_VIDEO_AUDIO_VIA_WEB_AUDIO = false;
    const EXTRA_TRACK_DEFAULT_LABELS = ['Ex 1 Track', 'Ex 2 Track', 'Ex 3 Track'];

    function setLaneWaveformFileNameEl(el, name, tip) {
        if (!el) return;
        const n = name ? String(name) : '';
        if (!n) {
            el.textContent = '';
            el.hidden = true;
            el.setAttribute('aria-hidden', 'true');
            return;
        }
        el.textContent = n;
        el.title = tip || n;
        el.hidden = false;
        el.setAttribute('aria-hidden', 'false');
    }

    function refreshVideoAudioLaneFileName() {
        const el = document.getElementById('audioWaveformFileName');
        if (!el) return;
        const laneShown =
            typeof isVideoAudioLaneShown === 'function' && isVideoAudioLaneShown();
        const hasVideo = typeof videoReady === 'function' && videoReady();
        if (!laneShown || !hasVideo || typeof fileMain === 'undefined' || !fileMain || !fileMain.name) {
            setLaneWaveformFileNameEl(el, '');
            return;
        }
        const st =
            typeof audioWaveformStatus !== 'undefined' && audioWaveformStatus
                ? audioWaveformStatus.textContent || ''
                : '';
        const statusTip =
            typeof laneStatusTooltip === 'function' ? laneStatusTooltip(st) : '';
        const full = fileMain.name;
        setLaneWaveformFileNameEl(el, full, statusTip ? full + ' — ' + statusTip : full);
    }

    window.VIDEO_AUDIO_SLOT_LABEL = VIDEO_AUDIO_SLOT_LABEL;
    window.refreshVideoAudioLaneFileName = refreshVideoAudioLaneFileName;
    const EXTRA_AUDIO_DECODE_MAX_BYTES = 1024 * 1024 * 1024;
    const EXTRA_AUDIO_DECODE_TIMEOUT_MS = 90000;
    const EXTRA_WAVEFORM_LAYOUT_MIN_CSS = 32;
    let extraWaveformEnsureGen = 0;
    /** Shared schedule lead for BufferSource.start (seconds). */
    const EXTRA_AUDIO_SCHEDULE_AHEAD_SEC = 0.02;
    /** 既に再生中の Ex へセグメントを足すときの先行スケジュール（秒） */
    const EXTRA_AUDIO_SEGMENT_ADD_AHEAD_SEC = 0.003;
    /** Re-start extra sources when drift from master transport exceeds this (seconds). */
    const EXTRA_AUDIO_RESYNC_DRIFT_SEC = 0.045;

    const extraTrackUi = [];
    /** クリアで閉じる／新規動画・ドロップで開く空き Ex レーン枠 */
    const extraLaneUiOpen = [false, false, false];
    const extraTracks = [
        {
            file: null,
            buffer: null,
            peaks: null,
            peakPyramid: null,
            persistBlob: null,
            restoreDurationHint: 0,
            muted: false,
            solo: false,
            volLinear: 1,
            source: null,
            gainNode: null,
            analyser: null,
            loadGen: 0,
            timelineStartSec: 0,
            clips: [],
            segmentSources: {},
        },
        {
            file: null,
            buffer: null,
            peaks: null,
            peakPyramid: null,
            persistBlob: null,
            restoreDurationHint: 0,
            muted: false,
            solo: false,
            volLinear: 1,
            source: null,
            gainNode: null,
            analyser: null,
            loadGen: 0,
            timelineStartSec: 0,
            clips: [],
            segmentSources: {},
        },
        {
            file: null,
            buffer: null,
            peaks: null,
            peakPyramid: null,
            persistBlob: null,
            restoreDurationHint: 0,
            muted: false,
            solo: false,
            volLinear: 1,
            source: null,
            gainNode: null,
            analyser: null,
            loadGen: 0,
            timelineStartSec: 0,
            clips: [],
            segmentSources: {},
        },
    ];

    function newExtraClipId() {
        return (
            'clip-' +
            Date.now().toString(36) +
            '-' +
            Math.random().toString(36).slice(2, 9)
        );
    }

    function ensureExtraTrackClips(tr) {
        if (!tr.clips) {
            tr.clips = [];
            if (tr.buffer && tr.buffer.duration > 0) {
                tr.clips.push({
                    id: 'main',
                    file: tr.file,
                    buffer: tr.buffer,
                    peaks: tr.peaks,
                    persistBlob: tr.persistBlob,
                    name: tr.file ? tr.file.name : '',
                });
            }
        }
        if (!tr.segmentSources) tr.segmentSources = {};
        return tr.clips;
    }

    function syncExtraTrackPrimaryFromFirstClip(tr) {
        const clips = ensureExtraTrackClips(tr);
        const c = clips[0];
        if (!c) return;
        tr.file = c.file;
        tr.buffer = c.buffer;
        tr.peaks = c.peaks;
        tr.persistBlob = c.persistBlob;
    }

    function getExtraTrackClip(tr, clipId) {
        const clips = ensureExtraTrackClips(tr);
        if (!clipId || clipId === 'main') {
            return clips.find((c) => c.id === 'main') || clips[0] || null;
        }
        return clips.find((c) => c.id === clipId) || clips[0] || null;
    }

    /** 意図したクロスフェードとみなす最小重なり（境界接触のみは除外） */
    const MIN_CROSSFADE_OVERLAP_SEC = 0.005;
    /** 入側がこの等パワー係数に達するまで出側のフェードアウトを抑える（結合境界の途切れ防止） */
    const INCOMING_CROSSFADE_AUDIBLE_FLOOR = 0.18;

    /** 重なりペアのフェードアウト／イン: タイムライン上で先に始まった方が cos（アウト）、後から始まった方が sin（イン）。 */
    function crossfadeOutInIndices(active, i, j) {
        const a = active[i];
        const b = active[j];
        if (a.timelineStart < b.timelineStart - 0.0005) {
            return { out: i, in: j };
        }
        if (b.timelineStart < a.timelineStart - 0.0005) {
            return { out: j, in: i };
        }
        if (a.timelineEnd < b.timelineEnd - 0.0005) {
            return { out: i, in: j };
        }
        if (b.timelineEnd < a.timelineEnd - 0.0005) {
            return { out: j, in: i };
        }
        return { out: i, in: j };
    }

    function segmentRegionGainLinear(segHit) {
        if (!segHit || typeof getSegmentGainLinear !== 'function') return 1;
        const track = { type: 'extra', slot: segHit.slot };
        return getSegmentGainLinear(track, segHit.segmentIndex);
    }

    function segmentPlaybackGainLinear(segHit, crossfadeLinear) {
        const cf = Number.isFinite(crossfadeLinear) ? crossfadeLinear : 1;
        return cf * segmentRegionGainLinear(segHit);
    }

    function computeEqualPowerCrossfadeGains(active, transportSec) {
        const gains = new Map();
        if (!active.length) return gains;
        if (active.length === 1) {
            gains.set(active[0].key, 1);
            return gains;
        }
        const weights = active.map(() => 1);
        const t = Number(transportSec);
        for (let i = 0; i < active.length; i++) {
            for (let j = i + 1; j < active.length; j++) {
                if (active[i].slot !== active[j].slot) continue;
                const oStart = Math.max(active[i].timelineStart, active[j].timelineStart);
                const oEnd = Math.min(active[i].timelineEnd, active[j].timelineEnd);
                if (
                    oEnd - oStart < MIN_CROSSFADE_OVERLAP_SEC ||
                    t < oStart ||
                    t > oEnd
                ) {
                    continue;
                }
                const p = (t - oStart) / (oEnd - oStart);
                const gOut = Math.cos(p * Math.PI * 0.5);
                const gIn = Math.sin(p * Math.PI * 0.5);
                const { out, in: inIdx } = crossfadeOutInIndices(active, i, j);
                weights[out] *= gOut;
                weights[inIdx] *= gIn;
            }
        }
        let sumSq = 0;
        for (let i = 0; i < weights.length; i++) sumSq += weights[i] * weights[i];
        const norm = sumSq > 0 ? 1 / Math.sqrt(sumSq) : 1;
        for (let i = 0; i < active.length; i++) {
            gains.set(active[i].key, weights[i] * norm);
        }
        return gains;
    }

    /**
     * 結合境界: 入側 BufferSource がまだ ctx 上で鳴り始めていない間は出側をフェードアウトしない。
     * （先に左だけ下げると、右の開始まで一瞬途切れて聞こえる）
     */
    function withCrossfadeGainsDeferredUntilIncomingAudible(ctx, active, transportSec, gains) {
        if (!ctx || !active || active.length < 2 || !gains) return gains;
        const out = new Map(gains);
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return out;
        for (let i = 0; i < active.length; i++) {
            for (let j = i + 1; j < active.length; j++) {
                if (active[i].slot !== active[j].slot) continue;
                const oStart = Math.max(
                    active[i].timelineStart,
                    active[j].timelineStart,
                );
                const oEnd = Math.min(active[i].timelineEnd, active[j].timelineEnd);
                if (
                    oEnd - oStart < MIN_CROSSFADE_OVERLAP_SEC ||
                    t < oStart ||
                    t > oEnd
                ) {
                    continue;
                }
                const { out: outIdx, in: inIdx } = crossfadeOutInIndices(active, i, j);
                const inHit = active[inIdx];
                const outHit = active[outIdx];
                const tr = extraTrackBySlot(inHit.slot);
                const inEntry =
                    tr && tr.segmentSources ? tr.segmentSources[inHit.key] : null;
                if (!inEntry || !inEntry.src) continue;
                const inCf = out.get(inHit.key) ?? gains.get(inHit.key) ?? 0;
                if (!isSegmentSourceAudibleOnCtx(inEntry, ctx)) {
                    out.set(outHit.key, 1);
                    out.set(inHit.key, 0);
                    continue;
                }
                if (inCf >= INCOMING_CROSSFADE_AUDIBLE_FLOOR) continue;
                const outCf = gains.get(outHit.key) ?? 1;
                const blend = inCf / INCOMING_CROSSFADE_AUDIBLE_FLOOR;
                out.set(outHit.key, Math.max(outCf, 1 - (1 - outCf) * blend));
                out.set(inHit.key, Math.min(inCf, INCOMING_CROSSFADE_AUDIBLE_FLOOR * blend));
            }
        }
        return out;
    }

    function stopExtraTrackSegmentSourceEntry(entry) {
        if (!entry) return;
        try {
            if (entry.src) entry.src.stop();
        } catch (_) {}
        try {
            if (entry.src) entry.src.disconnect();
        } catch (_) {}
        try {
            if (entry.segGain) entry.segGain.disconnect();
        } catch (_) {}
        entry.lastAppliedGain = null;
    }

    function isSegmentSourceAudibleOnCtx(entry, ctx) {
        if (
            !entry ||
            entry.src == null ||
            !Number.isFinite(entry.playbackAnchorCtxTime)
        ) {
            return false;
        }
        return ctx.currentTime >= entry.playbackAnchorCtxTime - 0.0005;
    }

    function applySegmentEntryGain(entry, gainLinear, ctx, opt) {
        if (!entry || !entry.segGain) return;
        const now = ctx.currentTime;
        const g = Math.max(0, gainLinear);
        if (
            entry.lastAppliedGain != null &&
            Math.abs(entry.lastAppliedGain - g) < 0.002
        ) {
            return;
        }
        entry.lastAppliedGain = g;
        const rampSec =
            opt && Number.isFinite(opt.rampSec) ? Math.max(0.001, opt.rampSec) : 0.05;
        entry.segGain.gain.setTargetAtTime(g, now, rampSec);
    }

    function extraTrackSourcesAudibleOnCtx(tr, ctx) {
        if (!tr || !ctx) return false;
        if (tr.source && isExtraTrackSourceAudibleOnCtx(tr, ctx)) return true;
        if (!tr.segmentSources) return false;
        for (const k of Object.keys(tr.segmentSources)) {
            if (isSegmentSourceAudibleOnCtx(tr.segmentSources[k], ctx)) {
                return true;
            }
        }
        return false;
    }

    function wantedSegmentKeysForSlot(slot, allActiveAtT) {
        const keys = new Set();
        if (!allActiveAtT) return keys;
        for (const segHit of allActiveAtT) {
            if (segHit.slot === slot) keys.add(segHit.key);
        }
        return keys;
    }

    function extraTrackSegmentSourcesMatchActive(slot, allActiveAtT) {
        const tr = extraTrackBySlot(slot);
        const track = { type: 'extra', slot };
        const regionActive =
            typeof isTrackRegionActive === 'function'
                ? isTrackRegionActive(track)
                : false;
        if (!regionActive) return true;
        const wanted = wantedSegmentKeysForSlot(slot, allActiveAtT);
        if (!wanted.size) {
            return !tr || !tr.segmentSources || !Object.keys(tr.segmentSources).length;
        }
        if (!tr || !tr.segmentSources) return false;
        for (const k of wanted) {
            const entry = tr.segmentSources[k];
            if (!entry || !entry.src) return false;
        }
        for (const k of Object.keys(tr.segmentSources)) {
            if (!wanted.has(k)) return false;
        }
        return true;
    }

    function shouldHoldOutgoingSegmentSource(slot, outgoingKey, allActiveAtT, ctx) {
        if (!ctx) return false;
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.segmentSources || !tr.segmentSources[outgoingKey]) return false;
        if (wantedSegmentKeysForSlot(slot, allActiveAtT).has(outgoingKey)) return false;
        for (let h = 0; h < allActiveAtT.length; h++) {
            const segHit = allActiveAtT[h];
            if (segHit.slot !== slot || segHit.key === outgoingKey) continue;
            const incoming = tr.segmentSources[segHit.key];
            if (!incoming || !incoming.src) return true;
            if (!isSegmentSourceAudibleOnCtx(incoming, ctx)) return true;
        }
        return false;
    }

    function pruneExtraSegmentSourcesToActive(allActiveAtT, ctx) {
        const mixCtx = ctx || ensureReviewMixCtx();
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const tr = extraTrackBySlot(i);
            if (!tr || !tr.segmentSources) continue;
            const wanted = wantedSegmentKeysForSlot(i, allActiveAtT);
            for (const k of Object.keys(tr.segmentSources)) {
                if (!wanted.has(k)) {
                    if (
                        mixCtx &&
                        shouldHoldOutgoingSegmentSource(i, k, allActiveAtT, mixCtx)
                    ) {
                        continue;
                    }
                    stopExtraTrackSegmentSourceEntry(tr.segmentSources[k]);
                    delete tr.segmentSources[k];
                }
            }
        }
    }

    function stopExtraTrackAllSources(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return;
        if (tr.segmentSources) {
            for (const k of Object.keys(tr.segmentSources)) {
                stopExtraTrackSegmentSourceEntry(tr.segmentSources[k]);
            }
            tr.segmentSources = {};
        }
        tr.mixRoutingReady = false;
        stopExtraTrackSource(slot);
    }

    function ensureExtraTrackMixRouting(slot, ctx) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !ctx) return null;
        const master = ensureReviewMixMasterBus(ctx);
        if (!tr.gainNode) tr.gainNode = ctx.createGain();
        if (tr.mixRoutingReady) {
            applyExtraTrackLaneGain(slot);
            return tr;
        }
        const meter = ensureExtraTrackAnalyser(ctx, tr);
        try {
            tr.gainNode.disconnect();
        } catch (_) {}
        try {
            if (meter) meter.disconnect();
        } catch (_) {}
        const bus = master || ctx.destination;
        if (meter) {
            tr.gainNode.connect(meter);
            meter.connect(bus);
        } else {
            tr.gainNode.connect(bus);
        }
        tr.mixRoutingReady = true;
        applyExtraTrackLaneGain(slot);
        return tr;
    }

    function startExtraTrackSegmentSource(slot, segHit, gainLinear, scheduleWhen, ctx, opt) {
        const tr = extraTrackBySlot(slot);
        const clip = getExtraTrackClip(tr, segHit.clipId);
        if (!tr || !clip || !clip.buffer || !isExtraTrackAudible(slot)) return;
        if (!tr.segmentSources) tr.segmentSources = {};
        const key = segHit.key;
        const existing = tr.segmentSources[key];
        if (existing && existing.src && !opt.force) {
            applySegmentEntryGain(existing, gainLinear, ctx);
            return;
        }
        ensureExtraTrackMixRouting(slot, ctx);
        const syncT =
            typeof getSegmentMappingTransportSec === 'function'
                ? getSegmentMappingTransportSec()
                : typeof getAudioSyncTransportSec === 'function'
                  ? getAudioSyncTransportSec()
                  : 0;
        const anchorT = Number.isFinite(opt.transportSec) ? opt.transportSec : syncT;
        stopExtraTrackSegmentSourceEntry(existing);
        const trackRef = { type: 'extra', slot };
        let when = Number.isFinite(scheduleWhen)
            ? scheduleWhen
            : acquireExtraMixScheduleTime(ctx, opt);
        let playTransportSec = anchorT;
        let startAt = Math.max(0, segHit.bufferOff);
        let remain = Math.max(0, segHit.remain);
        let usedJoinedPlan = false;
        const othersPlaying =
            tr.segmentSources &&
            Object.keys(tr.segmentSources).some((k) => {
                if (k === key) return false;
                const e = tr.segmentSources[k];
                return e && e.src;
            });
        if (
            othersPlaying &&
            segHit.segmentIndex > 0 &&
            typeof planIncomingSegmentStartAtJoinedBoundary === 'function'
        ) {
            let leftEntry = null;
            for (const k of Object.keys(tr.segmentSources)) {
                if (k === key) continue;
                const e = tr.segmentSources[k];
                if (e && e.src) {
                    leftEntry = e;
                    break;
                }
            }
            const plan = planIncomingSegmentStartAtJoinedBoundary(
                trackRef,
                segHit.segmentIndex,
                ctx,
                { leftEntry, mapTransportSec: anchorT },
            );
            if (plan) {
                when = plan.whenCtx;
                startAt = plan.bufferOff;
                remain = plan.remain;
                playTransportSec = plan.transportAnchor;
                usedJoinedPlan = true;
            }
        }
        if (!usedJoinedPlan) {
            if (othersPlaying) {
                when = Math.min(
                    when,
                    ctx.currentTime + EXTRA_AUDIO_SEGMENT_ADD_AHEAD_SEC,
                );
            }
            if (
                Number.isFinite(segHit.timelineStart) &&
                Number.isFinite(anchorT) &&
                anchorT < segHit.timelineStart - 0.0005
            ) {
                const leadSec = segHit.timelineStart - anchorT;
                const alignedWhen = ctx.currentTime + Math.max(0.002, leadSec - 0.001);
                when = Math.min(when, alignedWhen);
            }
            playTransportSec = anchorT + Math.max(0, when - ctx.currentTime);
            let liveHit = segHit;
            if (typeof refreshSegmentHitAtTransport === 'function') {
                const refreshed = refreshSegmentHitAtTransport(
                    trackRef,
                    segHit,
                    playTransportSec,
                );
                if (refreshed) liveHit = refreshed;
            }
            startAt = Math.max(0, liveHit.bufferOff);
            remain = Math.max(0, liveHit.remain);
        }
        if (remain <= 0.002) return;
        const maxOff = Math.max(0, clip.buffer.duration - 0.002);
        startAt = Math.min(startAt, maxOff);
        const src = ctx.createBufferSource();
        src.buffer = clip.buffer;
        const segGain = ctx.createGain();
        segGain.gain.value = Math.max(0, gainLinear);
        src.connect(segGain);
        segGain.connect(tr.gainNode);
        src.start(when, startAt, Math.min(remain, clip.buffer.duration - startAt));
        tr.segmentSources[key] = {
            src,
            segGain,
            transportAnchor: playTransportSec,
            playbackAnchorCtxTime: when,
            bufferOff: startAt,
            lastAppliedGain: Math.max(0, gainLinear),
        };
        tr.source = src;
        tr.playbackAnchorTransportSec = playTransportSec;
        tr.playbackAnchorCtxTime = when;
        src.onended = () => {
            if (tr.segmentSources[key] && tr.segmentSources[key].src === src) {
                delete tr.segmentSources[key];
                if (tr.source === src) {
                    tr.source = null;
                    clearExtraTrackPlaybackAnchor(tr);
                }
            }
            scheduleMasterPlaybackFinishCheck();
        };
    }

    const videoMix = { muted: false, solo: false, volLinear: 1 };
    /** @type {{ includeVideo: boolean, includeExtra: boolean[] }|null} */
    let videoExportAudioInclude = null;
    let sessionMixRestore = null;
    let reviewMixCtx = null;
    let reviewMixMaster = null;
    let videoMediaSrc = null;
    let videoGainNode = null;
    let videoAnalyser = null;
    let reviewMixVideoWired = false;
    let reviewMixVideoWireFailed = false;
    /** 0 dB 超: captureStream → GainNode → master（MediaElementSource は使わない） */
    let reviewMixVideoBoostPlayback = false;
    let reviewMixVideoBoostLogged = false;
    let videoMonitorStream = null;
    let videoMonitorStreamSrc = null;
    let videoMonitorSinkGain = null;
    let nativeVideoMixModeLogged = false;
    let extraMixScheduleCtxTime = 0;
    let videoAudioSoloBtn = null;
    let videoAudioMuteBtn = null;

    function setMixBtnState(btn, on) {
        if (!btn) return;
        btn.classList.toggle('track-mix-btn--on', !!on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    function clampTrackLaneGainLinear(v) {
        if (typeof trackLaneClampGainLinear === 'function') {
            return trackLaneClampGainLinear(v);
        }
        const n = Number(v);
        if (!isFinite(n) || n < 0) return 1;
        if (n === 0) return 0;
        return n;
    }

    function ensureVideoTrackAnalyser(ctx) {
        if (!ctx) return null;
        if (!videoAnalyser) {
            videoAnalyser = ctx.createAnalyser();
            videoAnalyser.fftSize = 256;
            videoAnalyser.smoothingTimeConstant = 0.65;
        }
        return videoAnalyser;
    }

    function ensureExtraTrackAnalyser(ctx, tr) {
        if (!ctx || !tr) return null;
        if (!tr.analyser) {
            tr.analyser = ctx.createAnalyser();
            tr.analyser.fftSize = 256;
            tr.analyser.smoothingTimeConstant = 0.65;
        }
        return tr.analyser;
    }

    function getVideoTrackEffectiveGain() {
        if (videoExportAudioInclude && !videoExportAudioInclude.includeVideo) return 0;
        if (!isVideoAudioAudible()) return 0;
        if (!isVideoMixOutputActive()) return 0;
        return clampTrackLaneGainLinear(videoMix.volLinear);
    }

    function getExtraTrackEffectiveGain(slot) {
        if (
            videoExportAudioInclude &&
            (!Array.isArray(videoExportAudioInclude.includeExtra) ||
                !videoExportAudioInclude.includeExtra[slot])
        ) {
            return 0;
        }
        if (!isExtraTrackAudible(slot)) return 0;
        const tr = extraTrackBySlot(slot);
        if (!tr) return 0;
        return clampTrackLaneGainLinear(tr.volLinear);
    }

    function applyExtraTrackLaneGain(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.gainNode) return;
        const ctx = ensureReviewMixCtx();
        if (!ctx) return;
        const g = getExtraTrackEffectiveGain(slot);
        try {
            tr.gainNode.gain.setTargetAtTime(g, ctx.currentTime, 0.02);
        } catch (_) {
            tr.gainNode.gain.value = g;
        }
    }

    function applyAllTrackLaneGains() {
        applyReviewMixVideoGain();
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            applyExtraTrackLaneGain(i);
        }
    }

    function getVideoTrackVolLinear() {
        return videoMix.volLinear;
    }

    function setVideoTrackVolLinear(v) {
        videoMix.volLinear = clampTrackLaneGainLinear(v);
        applyReviewMixVideoGain();
    }

    function getExtraTrackVolLinear(slot) {
        const tr = extraTrackBySlot(slot);
        return tr ? tr.volLinear : 1;
    }

    function setExtraTrackVolLinear(slot, v) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return;
        tr.volLinear = clampTrackLaneGainLinear(v);
        applyExtraTrackLaneGain(slot);
    }

    function getVideoTrackAnalyser() {
        return videoAnalyser;
    }

    function getExtraTrackAnalyser(slot) {
        const tr = extraTrackBySlot(slot);
        return tr ? tr.analyser : null;
    }

    function isVideoTrackLaneMeterSilent() {
        if (!isVideoAudioAudible()) return true;
        if (reviewMixVideoWired || reviewMixVideoBoostPlayback) {
            return getVideoTrackEffectiveGain() <= 0;
        }
        return !videoMonitorStreamSrc;
    }

    /** モニタータップ用ゲイン（ブースト／MES／buffer 時はフェーダー線形値、ネイティブ時は video.volume）。 */
    function getVideoMonitorTapGainLinear() {
        if (!isVideoAudioAudible()) return 0;
        if (reviewMixVideoWired || reviewMixVideoBoostPlayback) {
            return getVideoTrackEffectiveGain();
        }
        if (!videoMain || videoMain.muted) return 0;
        const vol = videoMain.volume;
        return Number.isFinite(vol) && vol > 0 ? vol : 0;
    }

    function isExtraTrackLaneMeterSilent(slot) {
        return !isExtraTrackAudible(slot);
    }

    function anyMixSoloActive() {
        if (videoMix.solo) return true;
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (extraTracks[i].solo) return true;
        }
        return false;
    }

    function isVideoAudioAudible() {
        if (typeof videoReady !== 'function' || !videoReady()) return false;
        if (containerHasAudio.main === false) return false;
        if (videoMix.muted) return false;
        if (anyMixSoloActive()) return videoMix.solo;
        return true;
    }

    function isExtraTrackAudible(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.buffer) return false;
        if (tr.muted) return false;
        if (anyMixSoloActive()) return !!tr.solo;
        return true;
    }

    function getVideoTransportDurationSecForMix() {
        if (typeof getVideoPlaybackEndSec === 'function') {
            return getVideoPlaybackEndSec();
        }
        if (typeof getVideoTransportDurationSec === 'function') {
            return getVideoTransportDurationSec();
        }
        return typeof getDuration === 'function' ? getDuration(videoMain) : 0;
    }

    function isVideoMixOutputActive() {
        if (!isVideoAudioAudible()) return false;
        if (
            videoMain &&
            isTransportPlayingForExtra() &&
            typeof transportPlaybackIsInMasterTail === 'function' &&
            transportPlaybackIsInMasterTail()
        ) {
            return false;
        }
        const vd = getVideoTransportDurationSecForMix();
        if (vd <= 0) return true;
        const t = getMasterTransportSecForAudioSync();
        if (Number.isFinite(t) && t < vd - 0.001) return true;
        if (videoMain && typeof videoReady === 'function' && videoReady()) {
            const vt = videoMain.currentTime || 0;
            if (Number.isFinite(vt) && vt < vd - 0.05) return true;
        }
        return false;
    }

    function useReviewMixVideoWebAudioRouting() {
        return ROUTE_VIDEO_AUDIO_VIA_WEB_AUDIO && !reviewMixVideoWireFailed;
    }

    function videoMixNeedsWebAudioBoost() {
        if (!isVideoAudioAudible()) return false;
        return clampTrackLaneGainLinear(videoMix.volLinear) > 1.0001;
    }

    /** ROUTE_VIDEO_AUDIO_VIA_WEB_AUDIO 時のみ MediaElementSource 経由。 */
    function shouldPlayVideoAudioViaWebAudio() {
        if (reviewMixVideoWireFailed) return false;
        if (!videoMediaSrc) return useReviewMixVideoWebAudioRouting();
        return useReviewMixVideoWebAudioRouting() || reviewMixVideoWired;
    }

    function clearStaleReviewMixVideoWiredFlag() {
        if (reviewMixVideoWired && !videoMediaSrc) {
            reviewMixVideoWired = false;
        }
    }

    /** 0 dB 超のブースト（captureStream → master、要素のネイティブ出力は止める）。 */
    function shouldPlayVideoAudioViaCaptureBoost() {
        if (reviewMixVideoWireFailed || useReviewMixVideoWebAudioRouting()) return false;
        return videoMixNeedsWebAudioBoost();
    }

    /** 動画音声が video 要素のスピーカー直出力（Web Audio 未接続時のみ）。 */
    function isVideoAudioPlaybackViaNativeElement() {
        return !reviewMixVideoWired && !reviewMixVideoBoostPlayback;
    }

    function getVideoCaptureStreamFn() {
        if (!videoMain) return null;
        if (typeof videoMain.captureStream === 'function') {
            return videoMain.captureStream.bind(videoMain);
        }
        if (typeof videoMain.mozCaptureStream === 'function') {
            return videoMain.mozCaptureStream.bind(videoMain);
        }
        return null;
    }

    /**
     * MES 経由時は video.muted=true だと無音になる実装がある。
     * ブースト時は capture 用に muted=false・volume=0（スピーカーは Web Audio のみ）。
     * ネイティブ時は video.volume（最大 1.0 = 0 dB）でミックスする。
     */
    function syncVideoElementOutputForReviewMix() {
        if (!videoMain) return;
        if (reviewMixVideoWired || reviewMixVideoBoostPlayback) {
            videoMain.muted = false;
            videoMain.volume = 0;
            return;
        }
        const g =
            isVideoMixOutputActive() && isVideoAudioAudible()
                ? clampTrackLaneGainLinear(videoMix.volLinear)
                : 0;
        if (g > 0) {
            videoMain.muted = false;
            videoMain.volume = Math.min(1, g);
            return;
        }
        videoMain.volume = 0;
        videoMain.muted = true;
    }

    function applyNativeVideoElementMix() {
        releaseReviewMixVideoBoostPlayback();
        if (videoMediaSrc) {
            releaseReviewMixVideoWebAudioTap({ resetElement: true });
        } else if (reviewMixVideoWired) {
            reviewMixVideoWired = false;
            reviewMixVideoWireFailed = false;
        }
        syncVideoElementOutputForReviewMix();
        applyReviewMixVideoMonitorTapGain();
        if (!nativeVideoMixModeLogged) {
            nativeVideoMixModeLogged = true;
            writeLog('Review mix: video audio via element (native output)');
        }
    }

    function ensureReviewMixMasterBus(ctx) {
        if (!ctx) return null;
        if (!reviewMixMaster) {
            reviewMixMaster = ctx.createGain();
            reviewMixMaster.gain.value = 1;
        }
        if (typeof ensureReviewMixMonitorOutput === 'function') {
            ensureReviewMixMonitorOutput(ctx, reviewMixMaster);
        } else {
            try {
                reviewMixMaster.disconnect(ctx.destination);
            } catch (_) {}
            reviewMixMaster.connect(ctx.destination);
        }
        return reviewMixMaster;
    }

    /** Route video element audio through the same AudioContext as extra tracks. */
    function ensureReviewMixVideoRouting() {
        if (!shouldPlayVideoAudioViaWebAudio() || !videoMain) return false;
        const ctx = ensureReviewMixCtx();
        if (!ctx) return false;
        const master = ensureReviewMixMasterBus(ctx);
        if (!master) return false;
        if (!videoGainNode) {
            videoGainNode = ctx.createGain();
        }
        const vMeter = ensureVideoTrackAnalyser(ctx);
        try {
            videoGainNode.disconnect();
        } catch (_) {}
        try {
            if (vMeter) vMeter.disconnect();
        } catch (_) {}
        if (vMeter) {
            videoGainNode.connect(vMeter);
            vMeter.connect(master);
        } else {
            videoGainNode.connect(master);
        }
        if (!videoMediaSrc) {
            if (!canBindReviewMixVideoMediaSource()) {
                return false;
            }
            try {
                videoMediaSrc = ctx.createMediaElementSource(videoMain);
                videoMediaSrc.connect(videoGainNode);
                reviewMixVideoWired = true;
                syncVideoElementOutputForReviewMix();
                writeLog('Review mix: video audio routed via Web Audio');
            } catch (err) {
                reviewMixVideoWireFailed = true;
                reviewMixVideoWired = false;
                writeLog(
                    'Review mix: video Web Audio routing unavailable — ' +
                        (err && err.message ? err.message : String(err)),
                );
                syncVideoElementOutputForReviewMix();
                return false;
            }
        }
        if (reviewMixVideoWired) {
            syncVideoElementOutputForReviewMix();
        }
        return reviewMixVideoWired;
    }

    function releaseReviewMixVideoCaptureGraph() {
        reviewMixVideoBoostPlayback = false;
        if (videoMonitorStreamSrc) {
            try {
                videoMonitorStreamSrc.disconnect();
            } catch (_) {}
            videoMonitorStreamSrc = null;
        }
        videoMonitorStream = null;
        if (videoMonitorSinkGain) {
            try {
                videoMonitorSinkGain.disconnect();
            } catch (_) {}
        }
        if (videoGainNode) {
            try {
                videoGainNode.disconnect();
            } catch (_) {}
        }
        if (videoAnalyser) {
            try {
                videoAnalyser.disconnect();
            } catch (_) {}
        }
    }

    function releaseReviewMixVideoBoostPlayback() {
        if (!reviewMixVideoBoostPlayback) return;
        releaseReviewMixVideoCaptureGraph();
    }

    function releaseReviewMixVideoMonitorTap() {
        releaseReviewMixVideoCaptureGraph();
    }

    function applyReviewMixVideoCapturePlaybackGain() {
        if (!videoGainNode || !videoMonitorStreamSrc) return;
        const g = getVideoTrackEffectiveGain();
        const ctx = ensureReviewMixCtx();
        try {
            if (ctx && ctx.state === 'running') {
                videoGainNode.gain.setTargetAtTime(g, ctx.currentTime, 0.02);
            } else {
                videoGainNode.gain.value = g;
            }
        } catch (_) {
            videoGainNode.gain.value = g;
        }
        if (ctx && ctx.state === 'suspended') {
            void ctx.resume().catch(() => {});
        }
    }

    function applyReviewMixVideoMonitorTapGain() {
        if (!videoGainNode || !videoMonitorStreamSrc) return;
        const g = getVideoMonitorTapGainLinear();
        const ctx = ensureReviewMixCtx();
        try {
            if (ctx && ctx.state === 'running') {
                videoGainNode.gain.setTargetAtTime(g, ctx.currentTime, 0.02);
            } else {
                videoGainNode.gain.value = g;
            }
        } catch (_) {
            videoGainNode.gain.value = g;
        }
    }

    /**
     * ネイティブ再生のまま captureStream でアナライザーへタップ（スピーカー二重出力なし）。
     * Analyser は destination へ gain=0 で接続しないとグラフが進まないブラウザがある。
     */
    function ensureReviewMixVideoMonitorTap(opt) {
        if (
            !videoMain ||
            shouldPlayVideoAudioViaWebAudio() ||
            shouldPlayVideoAudioViaCaptureBoost()
        ) {
            return false;
        }
        if (containerHasAudio.main === false) {
            releaseReviewMixVideoCaptureGraph();
            return false;
        }
        if (typeof canBindReviewMixVideoMediaSource === 'function' && !canBindReviewMixVideoMediaSource()) {
            return false;
        }
        const captureFn = getVideoCaptureStreamFn();
        if (!captureFn) return false;
        const ctx = ensureReviewMixCtx();
        if (!ctx) return false;
        if (!videoGainNode) videoGainNode = ctx.createGain();
        if (!videoMonitorSinkGain) {
            videoMonitorSinkGain = ctx.createGain();
            videoMonitorSinkGain.gain.value = 0;
        }
        const vMeter = ensureVideoTrackAnalyser(ctx);
        const forceRecapture = !!(opt && opt.forceRecapture);
        try {
            if (videoMonitorStreamSrc && forceRecapture) {
                try {
                    videoMonitorStreamSrc.disconnect();
                } catch (_) {}
                videoMonitorStreamSrc = null;
                videoMonitorStream = null;
            }
            if (!videoMonitorStreamSrc) {
                videoMonitorStream = captureFn();
                if (!videoMonitorStream || !videoMonitorStream.getAudioTracks().length) {
                    videoMonitorStream = null;
                    return false;
                }
                videoMonitorStreamSrc = ctx.createMediaStreamSource(videoMonitorStream);
            }
            try {
                videoMonitorStreamSrc.disconnect();
            } catch (_) {}
            try {
                videoGainNode.disconnect();
            } catch (_) {}
            try {
                if (vMeter) vMeter.disconnect();
            } catch (_) {}
            try {
                videoMonitorSinkGain.disconnect();
            } catch (_) {}
            videoMonitorStreamSrc.connect(videoGainNode);
            if (vMeter) {
                videoGainNode.connect(vMeter);
                vMeter.connect(videoMonitorSinkGain);
                videoMonitorSinkGain.connect(ctx.destination);
            } else {
                videoGainNode.connect(videoMonitorSinkGain);
                videoMonitorSinkGain.connect(ctx.destination);
            }
            reviewMixVideoBoostPlayback = false;
            applyReviewMixVideoMonitorTapGain();
            return true;
        } catch (err) {
            releaseReviewMixVideoCaptureGraph();
            writeLog(
                'Review mix: video monitor tap failed — ' +
                    (err && err.message ? err.message : String(err)),
            );
            return false;
        }
    }

    /**
     * 0 dB 超: captureStream を master へ（MediaElementSource は無音になりやすいため使わない）。
     */
    function ensureReviewMixVideoBoostPlayback(opt) {
        if (!videoMain || !shouldPlayVideoAudioViaCaptureBoost()) {
            return false;
        }
        if (containerHasAudio.main === false) {
            releaseReviewMixVideoBoostPlayback();
            return false;
        }
        if (typeof canBindReviewMixVideoMediaSource === 'function' && !canBindReviewMixVideoMediaSource()) {
            return false;
        }
        const captureFn = getVideoCaptureStreamFn();
        if (!captureFn) return false;
        const ctx = ensureReviewMixCtx();
        if (!ctx) return false;
        const master = ensureReviewMixMasterBus(ctx);
        if (!master) return false;
        if (!videoGainNode) videoGainNode = ctx.createGain();
        const vMeter = ensureVideoTrackAnalyser(ctx);
        const forceRecapture = !!(opt && opt.forceRecapture);
        try {
            if (videoMonitorStreamSrc && forceRecapture) {
                try {
                    videoMonitorStreamSrc.disconnect();
                } catch (_) {}
                videoMonitorStreamSrc = null;
                videoMonitorStream = null;
            }
            if (!videoMonitorStreamSrc) {
                videoMonitorStream = captureFn();
                if (!videoMonitorStream || !videoMonitorStream.getAudioTracks().length) {
                    videoMonitorStream = null;
                    return false;
                }
                videoMonitorStreamSrc = ctx.createMediaStreamSource(videoMonitorStream);
            }
            try {
                videoMonitorStreamSrc.disconnect();
            } catch (_) {}
            try {
                videoGainNode.disconnect();
            } catch (_) {}
            try {
                if (vMeter) vMeter.disconnect();
            } catch (_) {}
            try {
                if (videoMonitorSinkGain) videoMonitorSinkGain.disconnect();
            } catch (_) {}
            videoMonitorStreamSrc.connect(videoGainNode);
            if (vMeter) {
                videoGainNode.connect(vMeter);
                vMeter.connect(master);
            } else {
                videoGainNode.connect(master);
            }
            reviewMixVideoBoostPlayback = true;
            syncVideoElementOutputForReviewMix();
            applyReviewMixVideoCapturePlaybackGain();
            if (!reviewMixVideoBoostLogged) {
                reviewMixVideoBoostLogged = true;
                writeLog('Review mix: video boost via captureStream → master');
            }
            return true;
        } catch (err) {
            releaseReviewMixVideoBoostPlayback();
            writeLog(
                'Review mix: video capture boost failed — ' +
                    (err && err.message ? err.message : String(err)),
            );
            return false;
        }
    }

    function applyReviewMixVideoGain(opt) {
        if (!videoMain) {
            return;
        }
        clearStaleReviewMixVideoWiredFlag();

        if (!ROUTE_VIDEO_AUDIO_VIA_WEB_AUDIO && videoMediaSrc) {
            releaseReviewMixVideoWebAudioTap({ resetElement: true });
            reviewMixVideoWired = false;
            reviewMixVideoWireFailed = false;
        }
        const forceRecapture = !!(opt && opt.forceRecapture);

        if (shouldPlayVideoAudioViaCaptureBoost()) {
            if (ensureReviewMixVideoBoostPlayback({ forceRecapture })) {
                return;
            }
            writeLog('Review mix: video boost unavailable — output limited to 0 dB');
            releaseReviewMixVideoBoostPlayback();
        } else {
            releaseReviewMixVideoBoostPlayback();
        }

        if (shouldPlayVideoAudioViaWebAudio()) {
            releaseReviewMixVideoCaptureGraph();
            if (ensureReviewMixVideoRouting()) {
                syncVideoElementOutputForReviewMix();
                if (videoGainNode) {
                    const g = getVideoTrackEffectiveGain();
                    const ctx = ensureReviewMixCtx();
                    try {
                        if (ctx && ctx.state === 'running') {
                            videoGainNode.gain.setTargetAtTime(g, ctx.currentTime, 0.02);
                        } else {
                            videoGainNode.gain.value = g;
                        }
                    } catch (_) {
                        videoGainNode.gain.value = g;
                    }
                }
                return;
            }
            writeLog('Review mix: video Web Audio (MES) routing unavailable');
        }

        applyNativeVideoElementMix();
        ensureReviewMixVideoMonitorTap({ forceRecapture });
        applyReviewMixVideoMonitorTapGain();
    }

    /** メタデータ準備後: Web Audio ルートまたはモニタータップを接続。 */
    function tryWireReviewMixVideoAudioWhenReady() {
        if (!videoMain || reviewMixVideoWireFailed) return false;
        if (typeof canBindReviewMixVideoMediaSource === 'function' && !canBindReviewMixVideoMediaSource()) {
            return false;
        }
        applyReviewMixVideoGain();
        if (reviewMixVideoWired || reviewMixVideoBoostPlayback) return true;
        return !!videoMonitorStreamSrc;
    }

    function applyVideoMixToElement() {
        applyReviewMixVideoGain();
    }

    function refreshReviewMixUi() {
        const videoReadyNow = typeof videoReady === 'function' && videoReady();
        const videoLaneShown =
            typeof isVideoAudioLaneShown === 'function' && isVideoAudioLaneShown();
        if (videoAudioSoloBtn) {
            videoAudioSoloBtn.disabled = !videoReadyNow || !videoLaneShown;
            setMixBtnState(videoAudioSoloBtn, videoMix.solo);
        }
        if (videoAudioMuteBtn) {
            videoAudioMuteBtn.disabled = !videoReadyNow || !videoLaneShown;
            setMixBtnState(videoAudioMuteBtn, videoMix.muted);
        }
        const videoAudioClearBtn = document.getElementById('videoAudioClearBtn');
        if (videoAudioClearBtn) {
            videoAudioClearBtn.disabled = true;
        }
        applyAllTrackLaneGains();
        applyVideoMixToElement();
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) refreshExtraTrackUi(i);
        if (typeof refreshTrackLaneControlsUi === 'function') refreshTrackLaneControlsUi();
        if (typeof drawAudioWaveformCanvas === 'function') drawAudioWaveformCanvas();
    }

    function getMixPersistSnapshot() {
        const extra = [];
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const tr = extraTrackBySlot(i);
            if (!tr || !tr.buffer) continue;
            extra.push({
                slot: i,
                muted: !!tr.muted,
                solo: !!tr.solo,
                vol: tr.volLinear,
            });
        }
        return {
            video: {
                muted: !!videoMix.muted,
                solo: !!videoMix.solo,
                vol: videoMix.volLinear,
            },
            extra,
        };
    }

    function beginVideoExportAudioFilter(opts) {
        const count =
            typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : EXTRA_TRACK_COUNT;
        const includeExtra = [];
        for (let i = 0; i < count; i++) {
            includeExtra.push(
                !!(opts && Array.isArray(opts.includeExtra) && opts.includeExtra[i]),
            );
        }
        videoExportAudioInclude = {
            includeVideo: !!(opts && opts.includeVideo),
            includeExtra,
        };
        applyAllTrackLaneGains();
    }

    function endVideoExportAudioFilter() {
        videoExportAudioInclude = null;
        applyAllTrackLaneGains();
    }

    function setSessionMixRestore(mix) {
        sessionMixRestore = mix && typeof mix === 'object' ? mix : null;
    }

    function applyVideoMixFromSessionRestore() {
        if (!sessionMixRestore || !sessionMixRestore.video || !videoReady()) return false;
        videoMix.muted = !!sessionMixRestore.video.muted;
        videoMix.solo = !!sessionMixRestore.video.solo;
        if (typeof sessionMixRestore.video.vol === 'number' && isFinite(sessionMixRestore.video.vol)) {
            videoMix.volLinear = clampTrackLaneGainLinear(sessionMixRestore.video.vol);
        }
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        return true;
    }

    function removeExtraSlotFromSessionMixRestore(slot) {
        if (typeof isSessionRestoreInProgress === 'function' && isSessionRestoreInProgress()) {
            return;
        }
        if (!sessionMixRestore || !Array.isArray(sessionMixRestore.extra)) return;
        sessionMixRestore.extra = sessionMixRestore.extra.filter((e) => !e || e.slot !== slot);
    }

    /** レーン削除時: フェーダーを 0 dB（線形 1）に戻し、復元用ミックス状態からも除外 */
    function resetExtraTrackMixToDefault(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return;
        tr.muted = false;
        tr.solo = false;
        tr.volLinear = 1;
        removeExtraSlotFromSessionMixRestore(slot);
        applyExtraTrackLaneGain(slot);
    }

    function resetVideoTrackMixToDefault() {
        videoMix.muted = false;
        videoMix.solo = false;
        videoMix.volLinear = 1;
        if (
            sessionMixRestore &&
            sessionMixRestore.video &&
            !(typeof isSessionRestoreInProgress === 'function' && isSessionRestoreInProgress())
        ) {
            sessionMixRestore.video = {
                muted: false,
                solo: false,
                vol: 1,
            };
        }
        refreshReviewMixUi();
    }

    window.resetVideoTrackMixToDefault = resetVideoTrackMixToDefault;

    function applyExtraSlotMixFromSessionRestore(slot) {
        if (!sessionMixRestore || !Array.isArray(sessionMixRestore.extra)) return;
        const entry = sessionMixRestore.extra.find((e) => e && e.slot === slot);
        if (!entry) return;
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.buffer) return;
        tr.muted = !!entry.muted;
        tr.solo = !!entry.solo;
        if (typeof entry.vol === 'number' && isFinite(entry.vol)) {
            tr.volLinear = clampTrackLaneGainLinear(entry.vol);
        }
        refreshExtraTrackUi(slot);
        refreshReviewMixUi();
        syncExtraAudioToTransport();
    }

    function applyVideoMixFromSessionRestoreIfPending() {
        return applyVideoMixFromSessionRestore();
    }

    function toggleVideoSolo() {
        if (!videoReady()) return;
        videoMix.solo = !videoMix.solo;
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        writeLog('Video audio: ' + (videoMix.solo ? 'solo on' : 'solo off'));
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
    }

    function toggleVideoMute() {
        if (!videoReady()) return;
        videoMix.muted = !videoMix.muted;
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        writeLog('Video audio: ' + (videoMix.muted ? 'muted' : 'unmuted'));
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
    }

    function toggleExtraSolo(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.buffer) return;
        tr.solo = !tr.solo;
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        writeLog('Extra audio ' + (slot + 1) + ': ' + (tr.solo ? 'solo on' : 'solo off'));
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
    }

    function toggleExtraMute(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.buffer) return;
        tr.muted = !tr.muted;
        refreshReviewMixUi();
        syncExtraAudioToTransport();
        writeLog('Extra audio ' + (slot + 1) + ': ' + (tr.muted ? 'muted' : 'unmuted'));
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
    }

    /** 画面上に表示されているレーンだけ、上から 1〜4 番目（Video は枠表示中なら常に 1 枠目）。 */
    function getVisibleMixLaneTargets() {
        const out = [];
        if (typeof isVideoAudioLaneShown === 'function' && isVideoAudioLaneShown()) {
            out.push({ kind: 'video' });
        }
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            if (isExtraTrackLaneShown(slot)) {
                out.push({ kind: 'extra', slot: slot });
            }
        }
        return out;
    }

    function toggleMixSoloByDisplayIndex(displayIndex) {
        const targets = getVisibleMixLaneTargets();
        const t = targets[displayIndex];
        if (!t) return;
        if (t.kind === 'video') toggleVideoSolo();
        else toggleExtraSolo(t.slot);
    }

    function toggleMixMuteByDisplayIndex(displayIndex) {
        const targets = getVisibleMixLaneTargets();
        const t = targets[displayIndex];
        if (!t) return;
        if (t.kind === 'video') toggleVideoMute();
        else toggleExtraMute(t.slot);
    }

    function isMixLaneDbAtUnity(db) {
        return Math.abs(db) <= 0.05;
    }

    function mixLaneVolumeDbAfterStep(currentDb, deltaDb) {
        const atUnity = isMixLaneDbAtUnity(currentDb);
        if (deltaDb > 0) {
            if (!atUnity && currentDb < 0 && currentDb + deltaDb > 0) return 0;
            return currentDb + deltaDb;
        }
        if (!atUnity && currentDb > 0 && currentDb + deltaDb < 0) return 0;
        return currentDb + deltaDb;
    }

    function resolveActiveMixLaneDisplayIndex(clientX, clientY) {
        const targets = getVisibleMixLaneTargets();
        if (!targets.length) return -1;

        const pointerTarget =
            typeof resolveMixTargetFromPointer === 'function'
                ? resolveMixTargetFromPointer(clientY)
                : null;
        if (pointerTarget) {
            if (pointerTarget.kind === 'video') {
                const vi = targets.findIndex((t) => t.kind === 'video');
                if (vi >= 0) return vi;
            }
            if (pointerTarget.kind === 'extra') {
                const ei = targets.findIndex(
                    (t) => t.kind === 'extra' && t.slot === pointerTarget.slot,
                );
                if (ei >= 0) return ei;
            }
        }

        return -1;
    }

    function handleActiveMixLaneVolumeKeydown(e) {
        const shortcuts = window.SHORTCUTS || {};
        const matches =
            typeof window.matchesShortcut === 'function'
                ? window.matchesShortcut
                : () => false;
        const isUp = matches(e, shortcuts.mixLaneVolumeUp, { allowRepeat: true });
        const isDown = matches(e, shortcuts.mixLaneVolumeDown, { allowRepeat: true });
        if (!isUp && !isDown) return false;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
            return false;
        }

        let clientX = null;
        let clientY = null;
        if (typeof getWaveformLanesPointerClientX === 'function') {
            clientX = getWaveformLanesPointerClientX();
        }
        if (typeof getWaveformLanesPointerClientY === 'function') {
            clientY = getWaveformLanesPointerClientY();
        }
        if (clientX == null && typeof getWaveformPointerClientX === 'function') {
            clientX = getWaveformPointerClientX();
        }
        if (clientY == null && typeof getWaveformPointerClientY === 'function') {
            clientY = getWaveformPointerClientY();
        }

        const idx = resolveActiveMixLaneDisplayIndex(clientX, clientY);
        if (idx < 0) return false;

        e.preventDefault();
        const deltaDb = isUp ? 1 : -1;
        adjustMixLaneVolumeByDisplayIndex(idx, deltaDb);
        return true;
    }

    window.handleActiveMixLaneVolumeKeydown = handleActiveMixLaneVolumeKeydown;

    const mixLaneVolumeUnityHoldDir = {};

    function mixLaneVolumeUnityHoldKey(t) {
        return t.kind === 'video' ? 'video' : t.slot;
    }

    function adjustMixLaneVolumeByDisplayIndex(displayIndex, deltaDb) {
        if (
            typeof trackLaneLinearGainToDb !== 'function' ||
            typeof trackLaneLinearGainFromDb !== 'function'
        ) {
            return false;
        }
        const targets = getVisibleMixLaneTargets();
        const t = targets[displayIndex];
        if (!t) return false;
        const holdKey = mixLaneVolumeUnityHoldKey(t);
        const hold = mixLaneVolumeUnityHoldDir[holdKey] || 0;
        if (hold !== 0 && ((hold > 0 && deltaDb > 0) || (hold < 0 && deltaDb < 0))) {
            return false;
        }
        let currentLinear;
        if (t.kind === 'video') {
            if (typeof videoReady !== 'function' || !videoReady()) return false;
            currentLinear = getVideoTrackVolLinear();
        } else {
            if (typeof isExtraTrackLoaded !== 'function' || !isExtraTrackLoaded(t.slot)) {
                return false;
            }
            currentLinear = getExtraTrackVolLinear(t.slot);
        }
        const currentDb = trackLaneLinearGainToDb(currentLinear);
        const atUnityBefore = isMixLaneDbAtUnity(currentDb);
        const nextDb = mixLaneVolumeDbAfterStep(currentDb, deltaDb);
        if (Math.abs(nextDb - currentDb) < 1e-6) {
            return false;
        }
        const next = trackLaneLinearGainFromDb(nextDb);
        if (t.kind === 'video') {
            setVideoTrackVolLinear(next);
        } else {
            setExtraTrackVolLinear(t.slot, next);
        }
        refreshReviewMixUi();
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        const stoppedAtUnity =
            isMixLaneDbAtUnity(nextDb) &&
            !atUnityBefore &&
            ((deltaDb > 0 && currentDb < 0) || (deltaDb < 0 && currentDb > 0));
        if (stoppedAtUnity) {
            mixLaneVolumeUnityHoldDir[holdKey] = deltaDb > 0 ? 1 : -1;
        } else {
            delete mixLaneVolumeUnityHoldDir[holdKey];
        }
        return stoppedAtUnity;
    }

    function clearExtraTrackVolumeUnityHold(slot) {
        if (slot === 'video') {
            delete mixLaneVolumeUnityHoldDir.video;
            return;
        }
        if (Number.isFinite(slot)) {
            delete mixLaneVolumeUnityHoldDir[slot];
        } else {
            for (const k of Object.keys(mixLaneVolumeUnityHoldDir)) {
                delete mixLaneVolumeUnityHoldDir[k];
            }
        }
    }

    function adjustExtraTrackVolumeDb(slot, deltaDb) {
        if (
            typeof trackLaneLinearGainToDb !== 'function' ||
            typeof trackLaneLinearGainFromDb !== 'function'
        ) {
            return false;
        }
        if (typeof isExtraTrackLoaded !== 'function' || !isExtraTrackLoaded(slot)) {
            return false;
        }
        const hold = mixLaneVolumeUnityHoldDir[slot] || 0;
        if (hold !== 0 && ((hold > 0 && deltaDb > 0) || (hold < 0 && deltaDb < 0))) {
            return false;
        }
        const currentLinear = getExtraTrackVolLinear(slot);
        const currentDb = trackLaneLinearGainToDb(currentLinear);
        const atUnityBefore = isMixLaneDbAtUnity(currentDb);
        const nextDb = mixLaneVolumeDbAfterStep(currentDb, deltaDb);
        if (Math.abs(nextDb - currentDb) < 1e-6) {
            return false;
        }
        setExtraTrackVolLinear(slot, trackLaneLinearGainFromDb(nextDb));
        refreshReviewMixUi();
        if (typeof schedulePersistSession === 'function') schedulePersistSession();
        const stoppedAtUnity =
            isMixLaneDbAtUnity(nextDb) &&
            !atUnityBefore &&
            ((deltaDb > 0 && currentDb < 0) || (deltaDb < 0 && currentDb > 0));
        if (stoppedAtUnity) {
            mixLaneVolumeUnityHoldDir[slot] = deltaDb > 0 ? 1 : -1;
        } else {
            delete mixLaneVolumeUnityHoldDir[slot];
        }
        return stoppedAtUnity;
    }

    function ensureReviewMixCtx() {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        if (!reviewMixCtx) reviewMixCtx = new Ctx();
        ensureReviewMixMasterBus(reviewMixCtx);
        if (reviewMixCtx.state === 'suspended') {
            void reviewMixCtx.resume();
        }
        return reviewMixCtx;
    }

    function extraTrackBySlot(slot) {
        return extraTracks[slot] || null;
    }

    function clampExtraTrackTimelineStartSec(slot, sec) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return 0;
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        const step =
            typeof masterFrameSec === 'number' && masterFrameSec > 0
                ? masterFrameSec
                : 1 / 24;
        return Math.max(0, Math.round(n / step) * step);
    }

    function getExtraTrackTimelineStartSec(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return 0;
        const n = Number(tr.timelineStartSec);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function extraTrackTimelineEndSec(slot) {
        if (typeof getTrackTimelineEndSec === 'function') {
            return getTrackTimelineEndSec({ type: 'extra', slot });
        }
        const start = getExtraTrackTimelineStartSec(slot);
        const dur = extraTrackContentDurationSec(slot);
        return start + (dur > 0 ? dur : 0);
    }

    function setExtraTrackTimelineStartSec(slot, sec, opt) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.buffer) return;
        const next = clampExtraTrackTimelineStartSec(slot, sec);
        if (Math.abs(next - getExtraTrackTimelineStartSec(slot)) < 0.0005) return;
        tr.timelineStartSec = next;
        if (typeof updateTrackRegionOverlay === 'function') {
            updateTrackRegionOverlay({ type: 'extra', slot });
        }
        if (opt && opt.skipRedraw) return;
        if (typeof drawExtraTrackWaveform === 'function') drawExtraTrackWaveform(slot);
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (!(opt && opt.skipPersist)) {
            if (typeof schedulePersistExtraTrackSlot === 'function') {
                schedulePersistExtraTrackSlot(slot);
            } else if (typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
        }
    }

    window.getExtraTrackTimelineStartSec = getExtraTrackTimelineStartSec;
    window.setExtraTrackTimelineStartSec = setExtraTrackTimelineStartSec;
    window.extraTrackTimelineEndSec = extraTrackTimelineEndSec;
    window.extraTrackContentDurationSec = extraTrackContentDurationSec;
    window.getDefaultExtraClipId = function () {
        return 'main';
    };
    window.getExtraTrackClipDurationSec = function (slot, clipId) {
        const tr = extraTrackBySlot(slot);
        const clip = getExtraTrackClip(tr, clipId);
        return clip && clip.buffer && clip.buffer.duration > 0 ? clip.buffer.duration : 0;
    };
    window.getExtraTrackClipPeaks = function (slot, clipId) {
        const tr = extraTrackBySlot(slot);
        const clip = getExtraTrackClip(tr, clipId);
        return clip && clip.peaks ? clip.peaks : null;
    };
    window.getExtraTrackMaxClipDurationSec = function (slot) {
        return extraTrackBufferDuration(slot);
    };

    function getExtraUi(slot) {
        return extraTrackUi[slot] || null;
    }

    function clearExtraTrackPlaybackAnchor(tr) {
        if (!tr) return;
        tr.playbackAnchorTransportSec = null;
        tr.playbackAnchorCtxTime = null;
    }

    function resetExtraMixScheduleTime() {
        extraMixScheduleCtxTime = 0;
    }

    function isTransportPlayingForExtra() {
        return typeof isTransportPlaying === 'function'
            ? isTransportPlaying()
            : !!(videoMain && !videoMain.paused);
    }

    /** スケジュール位置 = 音声マスター（シークバーと同じ）。正オフセットの遅延は映像側 Web Audio で処理。 */
    function getAudioSyncTransportSec() {
        return Math.max(0, getMasterTransportSecForAudioSync());
    }

    /** 音声マスター位置（transportPlaybackSec / シークバー）。 */
    function getMasterTransportSecForAudioSync() {
        if (
            isTransportPlayingForExtra() &&
            typeof transportPlaybackSec === 'number' &&
            Number.isFinite(transportPlaybackSec)
        ) {
            return transportPlaybackSec;
        }
        if (typeof getTransportSec === 'function') {
            return getTransportSec();
        }
        return 0;
    }

    function expectedTransportSecForSegmentEntry(entry, ctx) {
        if (
            !entry ||
            !Number.isFinite(entry.transportAnchor) ||
            !Number.isFinite(entry.playbackAnchorCtxTime)
        ) {
            return null;
        }
        if (ctx.currentTime < entry.playbackAnchorCtxTime) {
            return entry.transportAnchor;
        }
        return (
            entry.transportAnchor + (ctx.currentTime - entry.playbackAnchorCtxTime)
        );
    }

    function expectedTransportSecForTrack(tr, ctx, slot) {
        if (
            !tr ||
            tr.source == null ||
            !Number.isFinite(tr.playbackAnchorTransportSec) ||
            !Number.isFinite(tr.playbackAnchorCtxTime)
        ) {
            return null;
        }
        let expected;
        if (ctx.currentTime < tr.playbackAnchorCtxTime) {
            expected = tr.playbackAnchorTransportSec;
        } else {
            expected =
                tr.playbackAnchorTransportSec + (ctx.currentTime - tr.playbackAnchorCtxTime);
        }
        if (slot >= 0 && slot < EXTRA_TRACK_COUNT) {
            const end = extraTrackPlayableTransportEndSec(slot);
            if (Number.isFinite(end) && end > 0) {
                expected = Math.min(expected, end);
            }
        }
        return expected;
    }

    function isExtraTrackSourceAudibleOnCtx(tr, ctx) {
        if (!tr || tr.source == null || !Number.isFinite(tr.playbackAnchorCtxTime)) {
            return false;
        }
        return ctx.currentTime >= tr.playbackAnchorCtxTime - 0.0005;
    }

    function extraTrackPlayableTransportEndSec(slot) {
        if (typeof getTrackTimelineEndSec === 'function') {
            return getTrackTimelineEndSec({ type: 'extra', slot });
        }
        return getExtraTrackTimelineStartSec(slot) + extraTrackBufferDuration(slot);
    }

    /** 読み込み済み・可聴トラックの再生終端をすべて過ぎたか（映像なしセッション向け） */
    function isPastAllLoadedTrackPlaybackEnds(transportSec) {
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return false;
        const eps =
            typeof masterTransportTailEpsilonSec === 'function'
                ? masterTransportTailEpsilonSec()
                : 0.02;
        let any = false;
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackLoaded(i)) continue;
            if (!isExtraTrackAudible(i)) continue;
            any = true;
            const end = extraTrackPlayableTransportEndSec(i);
            if (!(end > 0) || t < end - eps) return false;
        }
        if (any) return true;
        if (typeof videoReady === 'function' && videoReady()) {
            const vd =
                typeof getVideoPlaybackEndSec === 'function'
                    ? getVideoPlaybackEndSec()
                    : typeof getVideoTransportDurationSec === 'function'
                      ? getVideoTransportDurationSec()
                      : 0;
            return vd > 0 && t >= vd - eps;
        }
        return false;
    }

    function scheduleMasterPlaybackFinishCheck() {
        const run = () => {
            if (typeof maybeFinishMasterTransportPlayback === 'function') {
                maybeFinishMasterTransportPlayback();
            }
        };
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(run);
        } else {
            setTimeout(run, 0);
        }
    }

    function isExtraTrackWithinPlayableTimeline(slot, transportSec) {
        const track = { type: 'extra', slot };
        if (
            typeof isTrackRegionActive === 'function' &&
            isTrackRegionActive(track) &&
            typeof getActiveExtraSegmentsAtTransport === 'function'
        ) {
            return getActiveExtraSegmentsAtTransport(transportSec).some((s) => s.slot === slot);
        }
        if (typeof isTrackTransportAudible === 'function') {
            return isTrackTransportAudible(track, transportSec);
        }
        const t = Number(transportSec);
        if (!Number.isFinite(t)) return false;
        const start = getExtraTrackTimelineStartSec(slot);
        const end = extraTrackPlayableTransportEndSec(slot);
        return t >= start - 0.0005 && t < end - 0.002;
    }

    function shouldExtraTrackSourceBePlaying(slot) {
        if (!isExtraTrackAudible(slot)) return false;
        if (!isExtraTrackLoaded(slot)) return false;
        const tr = extraTrackBySlot(slot);
        if (!tr) return false;
        if (!isTransportPlayingForExtra()) return false;
        const audioT = getAudioSyncTransportSec();
        if (!isExtraTrackWithinPlayableTimeline(slot, audioT)) {
            return false;
        }
        const ctx = ensureReviewMixCtx();
        if (tr.source && ctx && !isExtraTrackSourceAudibleOnCtx(tr, ctx)) {
            return true;
        }
        return true;
    }

    function stopExtraTrackSourceIfPastPlayableEnd(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return;
        const audioT = getAudioSyncTransportSec();
        if (!isExtraTrackWithinPlayableTimeline(slot, audioT)) {
            stopExtraTrackAllSources(slot);
        }
    }

    function extraTrackRoutingMismatch() {
        const ctx = ensureReviewMixCtx();
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const tr = extraTrackBySlot(i);
            const shouldPlay = shouldExtraTrackSourceBePlaying(i);
            const playing = extraTrackSourcesAudibleOnCtx(tr, ctx);
            if (shouldPlay === playing) continue;
            if (!shouldPlay && playing) {
                stopExtraTrackSourceIfPastPlayableEnd(i);
                if (!tr || !tr.source) continue;
            }
            return true;
        }
        return false;
    }

    function reviewMixHasCrossfadeAtTransport(transportSec) {
        if (typeof getActiveExtraSegmentsAtTransport !== 'function') return false;
        const active = getActiveExtraSegmentsAtTransport(transportSec);
        if (active.length < 2) return false;
        const gains = computeEqualPowerCrossfadeGains(active, transportSec);
        for (let i = 0; i < active.length; i++) {
            const g = gains.get(active[i].key) ?? 1;
            if (g < 0.97) return true;
        }
        return false;
    }

    function segmentSourcesReadyForActive(active) {
        if (!active || !active.length) return false;
        for (const segHit of active) {
            const tr = extraTrackBySlot(segHit.slot);
            const entry =
                tr && tr.segmentSources ? tr.segmentSources[segHit.key] : null;
            if (!entry || !entry.src) return false;
        }
        return true;
    }

    function applySegmentCrossfadeGains(ctx, active, transportSec) {
        if (!ctx || !active || active.length < 2) return;
        const gains = withCrossfadeGainsDeferredUntilIncomingAudible(
            ctx,
            active,
            transportSec,
            computeEqualPowerCrossfadeGains(active, transportSec),
        );
        const rampSec = 0.012;
        for (const segHit of active) {
            const tr = extraTrackBySlot(segHit.slot);
            const entry =
                tr && tr.segmentSources ? tr.segmentSources[segHit.key] : null;
            if (entry && entry.segGain) {
                const g = segmentPlaybackGainLinear(
                    segHit,
                    gains.get(segHit.key) ?? 1,
                );
                applySegmentEntryGain(entry, g, ctx, { rampSec });
            }
        }
    }

    function reviewMixNeedsPlaybackSync() {
        if (!isTransportPlayingForExtra()) return false;
        if (extraTrackRoutingMismatch()) return true;
        const audioT = getAudioSyncTransportSec();
        const mapT =
            typeof getSegmentMappingTransportSec === 'function'
                ? getSegmentMappingTransportSec()
                : audioT;
        const active =
            typeof getActiveExtraSegmentsAtTransport === 'function'
                ? getActiveExtraSegmentsAtTransport(mapT)
                : [];
        if (active.length > 1) {
            return !segmentSourcesReadyForActive(active);
        }
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const trackRef = { type: 'extra', slot: i };
            if (
                typeof isTrackRegionActive === 'function' &&
                isTrackRegionActive(trackRef) &&
                !extraTrackSegmentSourcesMatchActive(i, active)
            ) {
                return true;
            }
        }
        return false;
    }

    function applyReviewMixCrossfadeGainsIfNeeded() {
        if (!isTransportPlayingForExtra()) return;
        const ctx = ensureReviewMixCtx();
        if (!ctx) return;
        const mapT =
            typeof getSegmentMappingTransportSec === 'function'
                ? getSegmentMappingTransportSec()
                : getAudioSyncTransportSec();
        const active =
            typeof getActiveExtraSegmentsAtTransport === 'function'
                ? getActiveExtraSegmentsAtTransport(mapT)
                : [];
        if (active.length < 2 || !segmentSourcesReadyForActive(active)) return;
        applySegmentCrossfadeGains(ctx, active, mapT);
    }

    window.reviewMixNeedsPlaybackSync = reviewMixNeedsPlaybackSync;
    window.applyReviewMixCrossfadeGainsIfNeeded = applyReviewMixCrossfadeGainsIfNeeded;
    window.getSegmentMappingTransportSec = getSegmentMappingTransportSec;
    window.EXTRA_AUDIO_SCHEDULE_AHEAD_SEC = EXTRA_AUDIO_SCHEDULE_AHEAD_SEC;
    window.beginVideoExportAudioFilter = beginVideoExportAudioFilter;
    window.endVideoExportAudioFilter = endVideoExportAudioFilter;
    window.ensureReviewMixCtx = ensureReviewMixCtx;
    window.primeReviewMixForPlayback = primeReviewMixForPlayback;

    function extraTrackSegmentSourcesDrifted(slot, allActiveAtT, targetSec, ctx) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.segmentSources) return false;
        const wanted = wantedSegmentKeysForSlot(slot, allActiveAtT);
        for (const k of wanted) {
            const entry = tr.segmentSources[k];
            if (!entry || !entry.src || !isSegmentSourceAudibleOnCtx(entry, ctx)) {
                continue;
            }
            const expected = expectedTransportSecForSegmentEntry(entry, ctx);
            if (
                expected == null ||
                Math.abs(expected - targetSec) > EXTRA_AUDIO_RESYNC_DRIFT_SEC
            ) {
                return true;
            }
        }
        return false;
    }

    function canTryIncrementalRegionSegmentSync(targetSec, ctx, allActiveAtT) {
        if (extraTrackRoutingMismatch()) return false;
        let needsWork = false;
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const trackRef = { type: 'extra', slot: i };
            if (
                typeof isTrackRegionActive !== 'function' ||
                !isTrackRegionActive(trackRef)
            ) {
                continue;
            }
            if (extraTrackSegmentSourcesDrifted(i, allActiveAtT, targetSec, ctx)) {
                return false;
            }
            if (!extraTrackSegmentSourcesMatchActive(i, allActiveAtT)) {
                needsWork = true;
            }
        }
        return needsWork;
    }

    function applyIncrementalRegionSegmentSync(ctx, masterT, mapT, allActiveAtT, opt) {
        const scheduleWhen = acquireExtraMixScheduleTime(ctx, opt);
        const crossfadeGains = withCrossfadeGainsDeferredUntilIncomingAudible(
            ctx,
            allActiveAtT,
            mapT,
            computeEqualPowerCrossfadeGains(allActiveAtT, mapT),
        );
        const crossfadeActive = reviewMixHasCrossfadeAtTransport(mapT);
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const trackRef = { type: 'extra', slot: i };
            const regionActive =
                typeof isTrackRegionActive === 'function'
                    ? isTrackRegionActive(trackRef)
                    : false;
            if (!regionActive) continue;
            const tr = extraTrackBySlot(i);
            if (!tr || !shouldExtraTrackSourceBePlaying(i)) continue;
            ensureExtraTrackMixRouting(i, ctx);
            const activeAtT = allActiveAtT
                .filter((s) => s.slot === i)
                .sort((a, b) => a.segmentIndex - b.segmentIndex);
            for (const segHit of activeAtT) {
                const g = segmentPlaybackGainLinear(
                    segHit,
                    crossfadeGains.get(segHit.key) ?? 1,
                );
                const existing = tr.segmentSources && tr.segmentSources[segHit.key];
                if (!existing || !existing.src) {
                    if (
                        segHit.segmentIndex > 0 &&
                        typeof isSegmentSourceContinuousAtBoundary === 'function' &&
                        isSegmentSourceContinuousAtBoundary(
                            trackRef,
                            segHit.segmentIndex - 1,
                        ) &&
                        typeof refreshSegmentHitAtTransport === 'function'
                    ) {
                        const priorAudible = Object.keys(
                            tr.segmentSources || {},
                        ).filter(
                            (k) =>
                                tr.segmentSources[k] &&
                                tr.segmentSources[k].src,
                        );
                        if (priorAudible.length === 1) {
                            const leftHit = activeAtT.find(
                                (s) =>
                                    s.segmentIndex === segHit.segmentIndex - 1,
                            );
                            const refreshedLeft = leftHit
                                ? refreshSegmentHitAtTransport(
                                      trackRef,
                                      leftHit,
                                      mapT,
                                  )
                                : null;
                            if (refreshedLeft) {
                                const gLeft = segmentPlaybackGainLinear(
                                    refreshedLeft,
                                    crossfadeGains.get(refreshedLeft.key) ?? 1,
                                );
                                startExtraTrackSegmentSource(
                                    i,
                                    refreshedLeft,
                                    gLeft,
                                    ctx.currentTime + 0.001,
                                    ctx,
                                    {
                                        force: true,
                                        transportSec: mapT,
                                    },
                                );
                            }
                        }
                    }
                    startExtraTrackSegmentSource(i, segHit, g, scheduleWhen, ctx, {
                        force: false,
                        transportSec: mapT,
                    });
                } else {
                    const rampSec = crossfadeActive && activeAtT.length > 1 ? 0.012 : 0.05;
                    applySegmentEntryGain(existing, g, ctx, { rampSec });
                }
            }
        }
        pruneExtraSegmentSourcesToActive(allActiveAtT, ctx);
        if (crossfadeActive && allActiveAtT.length > 1) {
            applySegmentCrossfadeGains(ctx, allActiveAtT, mapT);
        }
    }

    function extraTracksNeedResync(targetSec, ctx) {
        if (extraTrackRoutingMismatch()) return true;
        const mapT =
            typeof getSegmentMappingTransportSec === 'function'
                ? getSegmentMappingTransportSec()
                : targetSec;
        const allActiveAtT =
            typeof getActiveExtraSegmentsAtTransport === 'function'
                ? getActiveExtraSegmentsAtTransport(mapT)
                : [];
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackAudible(i)) continue;
            if (!shouldExtraTrackSourceBePlaying(i)) {
                const tr = extraTrackBySlot(i);
                if (tr && tr.source) return true;
                continue;
            }
            const trackRef = { type: 'extra', slot: i };
            const regionActive =
                typeof isTrackRegionActive === 'function'
                    ? isTrackRegionActive(trackRef)
                    : false;
            if (regionActive) {
                if (extraTrackSegmentSourcesDrifted(i, allActiveAtT, targetSec, ctx)) {
                    return true;
                }
                if (!extraTrackSegmentSourcesMatchActive(i, allActiveAtT)) {
                    return false;
                }
                continue;
            }
            const tr = extraTrackBySlot(i);
            if (!tr || !tr.source) return true;
            if (!isExtraTrackSourceAudibleOnCtx(tr, ctx)) continue;
            const expected = expectedTransportSecForTrack(tr, ctx, i);
            if (
                expected == null ||
                Math.abs(expected - targetSec) > EXTRA_AUDIO_RESYNC_DRIFT_SEC
            ) {
                return true;
            }
        }
        return false;
    }

    function acquireExtraMixScheduleTime(ctx, opt) {
        if (opt && opt.when != null && Number.isFinite(opt.when)) {
            return opt.when;
        }
        const when = Math.max(
            ctx.currentTime + EXTRA_AUDIO_SCHEDULE_AHEAD_SEC,
            extraMixScheduleCtxTime || 0,
        );
        extraMixScheduleCtxTime = when;
        return when;
    }

    function stopExtraTrackSource(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.source) return;
        try {
            tr.source.stop();
        } catch (_) {}
        try {
            tr.source.disconnect();
        } catch (_) {}
        tr.source = null;
        clearExtraTrackPlaybackAnchor(tr);
    }

    function stopAllExtraTrackSources() {
        resetExtraMixScheduleTime();
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) stopExtraTrackAllSources(i);
    }

    function extraAudioSourcesActive() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const tr = extraTrackBySlot(i);
            if (!tr || !isExtraTrackAudible(i)) continue;
            if (tr.source) return true;
            if (tr.segmentSources) {
                for (const k of Object.keys(tr.segmentSources)) {
                    if (tr.segmentSources[k] && tr.segmentSources[k].src) return true;
                }
            }
        }
        return false;
    }

    /** Transport position implied by running mix BufferSources (AudioContext clock). */
    function getTransportSecFromActiveExtraMix(ctx) {
        let best = null;
        let anyActive = false;
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackAudible(i)) continue;
            if (!shouldExtraTrackSourceBePlaying(i)) continue;
            const tr = extraTrackBySlot(i);
            if (!tr) continue;
            if (tr.segmentSources && Object.keys(tr.segmentSources).length) {
                for (const k of Object.keys(tr.segmentSources)) {
                    const entry = tr.segmentSources[k];
                    if (!entry || !entry.src || !isSegmentSourceAudibleOnCtx(entry, ctx)) {
                        continue;
                    }
                    anyActive = true;
                    const expected = expectedTransportSecForSegmentEntry(entry, ctx);
                    if (expected == null || !Number.isFinite(expected)) return null;
                    if (best == null || expected > best) best = expected;
                }
                continue;
            }
            if (!tr.source || !isExtraTrackSourceAudibleOnCtx(tr, ctx)) continue;
            anyActive = true;
            const expected = expectedTransportSecForTrack(tr, ctx, i);
            if (expected == null || !Number.isFinite(expected)) return null;
            if (best == null || expected > best) best = expected;
        }
        return anyActive ? best : null;
    }

    /** リージョン境界のセグメント判定に使うタイムライン秒（実際に鳴っている位置を優先） */
    function getSegmentMappingTransportSec() {
        const barT = getAudioSyncTransportSec();
        if (!isTransportPlayingForExtra()) return barT;
        const ctx = ensureReviewMixCtx();
        if (!ctx) return barT;
        const fromMix = getTransportSecFromActiveExtraMix(ctx);
        if (fromMix != null && Number.isFinite(fromMix)) return fromMix;
        return barT;
    }

    /**
     * Enter post-video tail without restarting extra sources (avoids a gap at video end).
     * @returns {number} transport seconds to use for the tail clock
     */
    function handoffReviewMixToTransportTail() {
        applyReviewMixVideoGain();
        const ctx = ensureReviewMixCtx();
        const barT =
            typeof getTransportSec === 'function'
                ? getTransportSec()
                : videoMain
                  ? videoMain.currentTime || 0
                  : 0;
        const vd = getVideoTransportDurationSecForMix();
        if (ctx) {
            const fromMix = getTransportSecFromActiveExtraMix(ctx);
            if (fromMix != null && Number.isFinite(fromMix)) {
                return fromMix;
            }
        }
        const startAt = vd > 0 ? Math.max(barT, vd) : barT;
        if (
            typeof extraAudioSourcesActive !== 'function' ||
            !extraAudioSourcesActive()
        ) {
            syncReviewMixToTransport({ force: true });
        }
        return startAt;
    }

    function mimeTypeHintForAudioFileName(name) {
        const s = String(name || '').toLowerCase();
        const dot = s.lastIndexOf('.');
        const ext = dot >= 0 ? s.slice(dot) : '';
        const map = {
            '.wav': 'audio/wav',
            '.wave': 'audio/wav',
            '.flac': 'audio/flac',
            '.ogg': 'audio/ogg',
            '.oga': 'audio/ogg',
            '.mp3': 'audio/mpeg',
            '.m4a': 'audio/mp4',
            '.aac': 'audio/aac',
            '.aif': 'audio/aiff',
            '.aiff': 'audio/aiff',
            '.wma': 'audio/x-ms-wma',
            '.opus': 'audio/opus',
            '.webm': 'audio/webm',
        };
        return map[ext] || 'application/octet-stream';
    }

    function cacheExtraTrackPersistBlob(tr, file, ab) {
        if (!tr || !file || !ab || ab.byteLength < 1) {
            if (tr) tr.persistBlob = null;
            return null;
        }
        const type =
            file.type ||
            (typeof mimeTypeHintForAudioFileName === 'function'
                ? mimeTypeHintForAudioFileName(file.name)
                : 'application/octet-stream');
        tr.persistBlob = new Blob([ab.slice(0)], { type });
        return tr.persistBlob;
    }

    function cacheExtraClipPersistBlob(clip, file, ab) {
        if (!clip || !file || !ab || ab.byteLength < 1) {
            if (clip) clip.persistBlob = null;
            return null;
        }
        const type =
            file.type ||
            (typeof mimeTypeHintForAudioFileName === 'function'
                ? mimeTypeHintForAudioFileName(file.name)
                : 'application/octet-stream');
        clip.persistBlob = new Blob([ab.slice(0)], { type });
        return clip.persistBlob;
    }

    function getExtraTrackPersistEntry(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !tr.file || !tr.buffer || !tr.persistBlob || tr.persistBlob.size < 1) {
            return null;
        }
        const peaks = clonePeaksForPersist(tr.peaks);
        const timelineStart = getExtraTrackTimelineStartSec(slot);
        const entry = {
            slot,
            name: tr.file.name,
            lastModified: tr.file.lastModified,
            blob: tr.persistBlob,
            byteLength: tr.persistBlob.size,
            duration: tr.buffer.duration,
            peaks,
            timelineStartSec: timelineStart > 0 ? timelineStart : 0,
        };
        if (typeof getPlaybackRegionPersistSnapshot === 'function') {
            const snap = getPlaybackRegionPersistSnapshot();
            const reg =
                snap && snap.extra
                    ? snap.extra.find((e) => e && e.slot === slot)
                    : null;
            if (reg && Array.isArray(reg.segments) && reg.segments.length) {
                entry.regionSegments = reg.segments;
                if (Number.isFinite(reg.headPadSec) && reg.headPadSec > 0) {
                    entry.regionHeadPadSec = reg.headPadSec;
                }
                if (Number.isFinite(reg.regionTimelineInSec)) {
                    entry.regionTimelineInSec = reg.regionTimelineInSec;
                }
                if (Number.isFinite(reg.regionLeadPadSec) && reg.regionLeadPadSec > 0) {
                    entry.regionLeadPadSec = reg.regionLeadPadSec;
                }
            }
        }
        const clips = ensureExtraTrackClips(tr);
        if (clips.length > 1) {
            entry.clips = clips
                .map((c) => {
                    if (!c.persistBlob || c.persistBlob.size < 1) return null;
                    return {
                        id: c.id,
                        name: c.file ? c.file.name : c.name || 'audio',
                        lastModified: c.file ? c.file.lastModified : Date.now(),
                        blob: c.persistBlob,
                        byteLength: c.persistBlob.size,
                        duration: c.buffer && c.buffer.duration > 0 ? c.buffer.duration : 0,
                        peaks: clonePeaksForPersist(c.peaks),
                    };
                })
                .filter(Boolean);
        }
        return entry;
    }

    /** Web Audio を使わず WAV から peaks のみ構築（復元時のデコード待ち回避） */
    function buildPeaksPreviewFromWavArrayBuffer(ab, barCount) {
        if (!ab || ab.byteLength < 44) return null;
        const view = new DataView(ab);
        const sig = String.fromCharCode(
            view.getUint8(0),
            view.getUint8(1),
            view.getUint8(2),
            view.getUint8(3),
        );
        if (sig !== 'RIFF') return null;
        let offset = 12;
        let numChannels = 0;
        let sampleRate = 0;
        let bitsPerSample = 0;
        let dataOffset = 0;
        let dataLen = 0;
        while (offset + 8 <= ab.byteLength) {
            const id = String.fromCharCode(
                view.getUint8(offset),
                view.getUint8(offset + 1),
                view.getUint8(offset + 2),
                view.getUint8(offset + 3),
            );
            const size = view.getUint32(offset + 4, true);
            if (id === 'fmt ') {
                numChannels = view.getUint16(offset + 10, true);
                sampleRate = view.getUint32(offset + 12, true);
                bitsPerSample = view.getUint16(offset + 22, true);
            } else if (id === 'data') {
                dataOffset = offset + 8;
                dataLen = size;
                break;
            }
            offset += 8 + size + (size & 1);
        }
        if (!dataOffset || !numChannels || !sampleRate || !bitsPerSample) return null;
        const bytesPerSample = bitsPerSample / 8;
        const frameSize = bytesPerSample * numChannels;
        if (frameSize < 1) return null;
        const totalFrames = Math.floor(dataLen / frameSize);
        if (totalFrames < 1) return null;
        const duration = totalFrames / sampleRate;
        const bars = Math.max(1, barCount | 0);
        const block = Math.max(1, Math.floor(totalFrames / bars));
        const peaks = new Array(bars);
        for (let i = 0; i < bars; i++) {
            let min = 0;
            let max = 0;
            const start = i * block;
            const end = Math.min(totalFrames, start + block);
            for (let f = start; f < end; f++) {
                const pos = dataOffset + f * frameSize;
                if (pos + bytesPerSample > ab.byteLength) break;
                let v = 0;
                if (bitsPerSample === 16) {
                    v = view.getInt16(pos, true) / 32768;
                } else if (bitsPerSample === 24) {
                    let sample = view.getUint8(pos) | (view.getUint8(pos + 1) << 8);
                    const hi = view.getInt8(pos + 2);
                    sample |= hi << 16;
                    v = sample / 8388608;
                } else if (bitsPerSample === 32) {
                    v = view.getFloat32(pos, true);
                    if (!Number.isFinite(v)) {
                        v = view.getInt32(pos, true) / 2147483648;
                    }
                } else {
                    return null;
                }
                if (v < min) min = v;
                if (v > max) max = v;
            }
            peaks[i] = { min, max };
        }
        return { peaks, duration };
    }

    async function buildExtraTrackPeaksPreviewFromWavBlob(slot, entry) {
        if (!entry || !entry.blob) return false;
        const name = entry.name || '';
        if (!/\.wav$/i.test(name) && !/\.wave$/i.test(name)) return false;
        try {
            const ab = await entry.blob.arrayBuffer();
            const w =
                typeof rawMasterTimelineWidthCss === 'function'
                    ? rawMasterTimelineWidthCss()
                    : 0;
            const barCount = Math.min(4096, Math.max(200, w > 0 ? w : 1200));
            const built = buildPeaksPreviewFromWavArrayBuffer(ab, barCount);
            if (!built || !built.peaks || !built.peaks.length) return false;
            return applyExtraTrackPeaksPreview(slot, {
                slot,
                name: entry.name,
                lastModified: entry.lastModified,
                duration: built.duration,
                peaks: built.peaks,
            });
        } catch (e) {
            writeLog(
                'Extra audio ' +
                    (slot + 1) +
                    ': WAV preview failed — ' +
                    (e && e.message ? e.message : String(e)),
            );
            return false;
        }
    }

    /** セッション復元: デコード完了前に保存済み peaks で波形だけ先に描画 */
    function applyExtraTrackPeaksPreview(slot, entry) {
        if (!entry || !(Number(entry.duration) > 0) || !entry.peaks || !entry.peaks.length) {
            return false;
        }
        const tr = extraTrackBySlot(slot);
        const ui = getExtraUi(slot);
        if (!tr || !ui) return false;
        setExtraTrackLaneUiOpen(slot, true);
        tr.peaks = entry.peaks;
        tr.restoreDurationHint = entry.duration;
        tr.timelineStartSec =
            Number.isFinite(entry.timelineStartSec) && entry.timelineStartSec > 0
                ? clampExtraTrackTimelineStartSec(slot, entry.timelineStartSec)
                : 0;
        tr.file = {
            name: entry.name || 'audio.wav',
            lastModified:
                typeof entry.lastModified === 'number' ? entry.lastModified : Date.now(),
        };
        setExtraTrackStatus(slot, 'Restoring…');
        if (ui.meta) ui.meta.classList.add('loaded');
        if (typeof refreshAudioWaveformCompositeLoadedState === 'function') {
            refreshAudioWaveformCompositeLoadedState();
        }
        if (typeof syncAudioOnlyMarkersUi === 'function') {
            syncAudioOnlyMarkersUi();
        }
        refreshExtraTrackUi(slot);
        scheduleExtraTrackWaveformRedraw(slot);
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        writeLog(
            'Extra audio ' +
                (slot + 1) +
                ': waveform preview restored (' +
                entry.peaks.length +
                ' bars)',
        );
        return true;
    }

    /** ページ終了時も即座に使える同期スナップショット（persistBlob キャッシュ） */
    function getExtraTracksPersistSnapshot() {
        const out = [];
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const entry = getExtraTrackPersistEntry(i);
            if (entry) out.push(entry);
        }
        return out.length ? out : null;
    }

    function schedulePersistExtraTrackSlot(slot) {
        const entry = getExtraTrackPersistEntry(slot);
        if (!entry) return;
        if (typeof persistExtraTrackEntryToSession === 'function') {
            void persistExtraTrackEntryToSession(entry).catch((e) => {
                writeLog(
                    'Session: extra ' +
                        (slot + 1) +
                        ' save failed — ' +
                        (e && e.message ? e.message : String(e)),
                );
            });
        } else if (typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
    }

    function canBindReviewMixVideoMediaSource() {
        return !!(
            videoMain &&
            typeof urlMain !== 'undefined' &&
            urlMain &&
            typeof videoReady === 'function' &&
            videoReady()
        );
    }

    function releaseReviewMixVideoWebAudioTap(opt) {
        releaseReviewMixVideoMonitorTap();
        if (!videoMediaSrc) {
            reviewMixVideoWired = false;
            return;
        }
        try {
            videoMediaSrc.disconnect();
        } catch (_) {}
        videoMediaSrc = null;
        reviewMixVideoWired = false;
        reviewMixVideoWireFailed = false;
        if (opt && opt.resetElement) {
            resetReviewMixVideoElementForReviewMix();
        }
    }

    /** createMediaElementSource は要素につき1回。起動時の空要素で作ると以降ずっと無音になる。 */
    function resetReviewMixVideoElementForReviewMix() {
        const frame =
            typeof frameMain !== 'undefined' ? frameMain : document.getElementById('frameMain');
        const old =
            typeof videoMain !== 'undefined' ? videoMain : document.getElementById('videoMain');
        if (!frame || !old || !old.parentNode) return;
        const savedUrl = typeof urlMain !== 'undefined' && urlMain ? urlMain : '';
        try {
            if (videoMediaSrc) videoMediaSrc.disconnect();
        } catch (_) {}
        videoMediaSrc = null;
        reviewMixVideoWired = false;
        reviewMixVideoWireFailed = false;
        releaseReviewMixVideoMonitorTap();
        videoGainNode = null;
        videoAnalyser = null;
        const nv = document.createElement('video');
        nv.id = 'videoMain';
        nv.setAttribute('playsinline', '');
        nv.setAttribute('preload', 'auto');
        frame.replaceChild(nv, old);
        if (typeof setVideoMainElement === 'function') {
            setVideoMainElement(nv);
        }
        if (typeof rebindVideoMainListeners === 'function') {
            rebindVideoMainListeners(nv);
        }
        if (savedUrl) {
            nv.src = savedUrl;
            nv.load();
        }
        writeLog('Review mix: video element reset (Web Audio re-bind)');
    }

    function prepareReviewMixForNewVideoLoad() {
        reviewMixVideoWireFailed = false;
        reviewMixVideoBoostLogged = false;
        releaseReviewMixVideoMonitorTap();
        const hadLoadedVideo = typeof fileMain !== 'undefined' && !!fileMain;
        if (videoMediaSrc) {
            releaseReviewMixVideoWebAudioTap({ resetElement: !hadLoadedVideo });
        }
    }

    async function finalizeReviewMixAfterSessionRestore() {
        if (typeof applyReviewMixVideoGain === 'function') {
            applyReviewMixVideoGain();
        }
        const ctx = ensureReviewMixCtx();
        if (ctx && ctx.state === 'suspended') {
            try {
                await ctx.resume();
            } catch (_) {}
        }
        if (typeof applyVideoMixFromSessionRestore === 'function') {
            applyVideoMixFromSessionRestore();
        }
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            applyExtraSlotMixFromSessionRestore(i);
        }
        syncExtraLaneVisibilityAfterSessionRestore();
        refreshReviewMixUi();
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (typeof ensureExtraTrackWaveformsDrawn === 'function') {
            ensureExtraTrackWaveformsDrawn({ notifyMaster: true, maxFrames: 40 });
        }
        if (typeof ensureMainVideoWaveformAfterSessionRestore === 'function') {
            ensureMainVideoWaveformAfterSessionRestore();
        }
    }

    function startExtraTrackSource(slot, offsetSec, opt) {
        const tr = extraTrackBySlot(slot);
        stopExtraTrackSource(slot);
        if (!tr || !tr.buffer || !isExtraTrackAudible(slot)) return;
        const ctx = ensureReviewMixCtx();
        if (!ctx) return;
        const master = ensureReviewMixMasterBus(ctx);
        if (!tr.gainNode) {
            tr.gainNode = ctx.createGain();
        }
        const meter = ensureExtraTrackAnalyser(ctx, tr);
        try {
            tr.gainNode.disconnect();
        } catch (_) {}
        try {
            if (meter) meter.disconnect();
        } catch (_) {}
        const bus = master || ctx.destination;
        if (meter) {
            tr.gainNode.connect(meter);
            meter.connect(bus);
        } else {
            tr.gainNode.connect(bus);
        }
        applyExtraTrackLaneGain(slot);
        const off = Math.max(0, Number(offsetSec) || 0);
        const maxOff = Math.max(0, tr.buffer.duration - 0.002);
        const startAt = Math.min(off, maxOff);
        let remain = tr.buffer.duration - startAt;
        if (opt && Number.isFinite(opt.playRemainSec)) {
            remain = Math.min(remain, Math.max(0, opt.playRemainSec));
        }
        if (remain <= 0.002) return;
        const scheduleWhen = acquireExtraMixScheduleTime(ctx, opt);
        const src = ctx.createBufferSource();
        src.buffer = tr.buffer;
        src.connect(tr.gainNode);
        src.start(scheduleWhen, startAt, remain);
        tr.source = src;
        const transportAnchor =
            opt && Number.isFinite(opt.transportSec) ? opt.transportSec : off;
        tr.playbackAnchorTransportSec = transportAnchor;
        tr.playbackAnchorCtxTime = scheduleWhen;
        src.onended = () => {
            if (tr.source === src) {
                tr.source = null;
                clearExtraTrackPlaybackAnchor(tr);
            }
            scheduleMasterPlaybackFinishCheck();
        };
    }

    function extraTrackBufferDuration(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return 0;
        let max = 0;
        const clips = ensureExtraTrackClips(tr);
        for (const c of clips) {
            if (c.buffer && c.buffer.duration > max) max = c.buffer.duration;
        }
        if (max > 0) return max;
        return tr.buffer && tr.buffer.duration > 0 ? tr.buffer.duration : 0;
    }

    function isExtraTrackLoaded(slot) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return false;
        const clips = ensureExtraTrackClips(tr);
        for (const c of clips) {
            if (c.buffer && c.buffer.duration > 0) return true;
        }
        return extraTrackBufferDuration(slot) > 0;
    }

    function syncReviewMixToTransport(opt) {
        const force = !!(opt && opt.force);
        const playing = isTransportPlayingForExtra();
        const masterT = getMasterTransportSecForAudioSync();
        const audioT = getAudioSyncTransportSec();
        const mapT =
            typeof getSegmentMappingTransportSec === 'function'
                ? getSegmentMappingTransportSec()
                : audioT;
        applyReviewMixVideoGain();
        if (!playing) {
            stopAllExtraTrackSources();
            return;
        }
        const ctx = ensureReviewMixCtx();
        if (!ctx) return;
        const allActiveAtT =
            typeof getActiveExtraSegmentsAtTransport === 'function'
                ? getActiveExtraSegmentsAtTransport(mapT)
                : [];
        const crossfadeActive = reviewMixHasCrossfadeAtTransport(mapT);
        if (
            !force &&
            canTryIncrementalRegionSegmentSync(masterT, ctx, allActiveAtT)
        ) {
            applyIncrementalRegionSegmentSync(ctx, masterT, mapT, allActiveAtT, opt);
            applyReviewMixVideoGain();
            return;
        }
        if (
            !force &&
            crossfadeActive &&
            segmentSourcesReadyForActive(allActiveAtT) &&
            !extraTracksNeedResync(masterT, ctx)
        ) {
            applySegmentCrossfadeGains(ctx, allActiveAtT, mapT);
            pruneExtraSegmentSourcesToActive(allActiveAtT, ctx);
            applyReviewMixVideoGain();
            return;
        }
        if (
            !force &&
            !crossfadeActive &&
            !extraTracksNeedResync(masterT, ctx) &&
            extraAudioSourcesActive()
        ) {
            pruneExtraSegmentSourcesToActive(allActiveAtT, ctx);
            applyReviewMixVideoGain();
            return;
        }
        resetExtraMixScheduleTime();
        const scheduleWhen = acquireExtraMixScheduleTime(ctx, opt);
        const crossfadeGains = withCrossfadeGainsDeferredUntilIncomingAudible(
            ctx,
            allActiveAtT,
            mapT,
            computeEqualPowerCrossfadeGains(allActiveAtT, mapT),
        );
        if (crossfadeActive) {
            applySegmentCrossfadeGains(ctx, allActiveAtT, mapT);
        }
        applyReviewMixVideoGain();
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            stopExtraTrackSourceIfPastPlayableEnd(i);
            const tr = extraTrackBySlot(i);
            if (!shouldExtraTrackSourceBePlaying(i)) {
                stopExtraTrackAllSources(i);
                continue;
            }
            const trackRef = { type: 'extra', slot: i };
            const regionActive =
                typeof isTrackRegionActive === 'function'
                    ? isTrackRegionActive(trackRef)
                    : false;
            const activeAtT = allActiveAtT.filter((s) => s.slot === i);

            if (regionActive && activeAtT.length) {
                ensureExtraTrackMixRouting(i, ctx);
                for (const segHit of activeAtT) {
                    const g = segmentPlaybackGainLinear(
                        segHit,
                        crossfadeGains.get(segHit.key) ?? 1,
                    );
                    startExtraTrackSegmentSource(i, segHit, g, scheduleWhen, ctx, {
                        force,
                        transportSec: mapT,
                    });
                }
                pruneExtraSegmentSourcesToActive(allActiveAtT, ctx);
                continue;
            }

            if (regionActive) {
                stopExtraTrackAllSources(i);
                continue;
            }

            const timelineStart = getExtraTrackTimelineStartSec(i);
            let bufferOff = audioT - timelineStart;
            if (
                !tr ||
                !tr.buffer ||
                bufferOff < -0.0005 ||
                bufferOff >= tr.buffer.duration - 0.002
            ) {
                stopExtraTrackAllSources(i);
                continue;
            }
            let needsStart = force || !tr.source;
            if (!needsStart && tr.source && isExtraTrackSourceAudibleOnCtx(tr, ctx)) {
                const expected = expectedTransportSecForTrack(tr, ctx, i);
                needsStart =
                    expected == null ||
                    Math.abs(expected - masterT) > EXTRA_AUDIO_RESYNC_DRIFT_SEC;
            }
            if (!needsStart) continue;
            if (tr.segmentSources && Object.keys(tr.segmentSources).length) {
                stopExtraTrackAllSources(i);
            }
            startExtraTrackSource(i, bufferOff, {
                when: scheduleWhen,
                transportSec: masterT,
                playRemainSec: tr.buffer.duration - bufferOff,
            });
        }
    }

    function syncExtraAudioToTransport(opt) {
        syncReviewMixToTransport(opt);
    }

    /** Schedule the full mix (video element + extras) before video.play(). */
    async function primeReviewMixForPlayback() {
        const ctx = ensureReviewMixCtx();
        if (ctx && ctx.state === 'suspended') {
            try {
                await ctx.resume();
            } catch (_) {}
        }
        applyReviewMixVideoGain({ forceRecapture: true });
        if (ctx) {
            const mode = reviewMixVideoBoostPlayback
                ? 'capture boost'
                : reviewMixVideoWired
                  ? 'Web Audio (MES)'
                  : videoMonitorStreamSrc
                    ? 'native + monitor tap'
                    : 'native element';
            const g =
                reviewMixVideoBoostPlayback ||
                reviewMixVideoWired
                    ? getVideoTrackEffectiveGain()
                    : videoMain
                      ? videoMain.volume
                      : 0;
            writeLog(
                'Review mix: play — ctx=' +
                    ctx.state +
                    ' video=' +
                    (Number(g).toFixed ? Number(g).toFixed(3) : String(g)) +
                    ' (' +
                    mode +
                    ')',
            );
        }
        syncReviewMixToTransport({ force: true });
    }

    async function primeExtraAudioForPlayback() {
        return primeReviewMixForPlayback();
    }

    function decodeArrayBufferToAudioBuffer(ctx, ab) {
        if (!ctx || !ab) throw new Error('decodeAudioData: no context or data');
        const copy = ab.slice(0);
        let decoded = ctx.decodeAudioData(copy);
        if (!decoded || typeof decoded.then !== 'function') {
            decoded = new Promise((resolve, reject) => {
                ctx.decodeAudioData(copy, resolve, reject);
            });
        }
        return Promise.race([
            decoded,
            new Promise((_, reject) => {
                setTimeout(
                    () => reject(new Error('decodeAudioData timeout')),
                    EXTRA_AUDIO_DECODE_TIMEOUT_MS,
                );
            }),
        ]);
    }

    function extraTrackContentDurationSec(slot) {
        const track = { type: 'extra', slot };
        if (
            typeof isTrackRegionActive === 'function' &&
            isTrackRegionActive(track) &&
            typeof getTrackTimelineEndSec === 'function'
        ) {
            const end = getTrackTimelineEndSec(track);
            const start =
                typeof getExtraTrackTimelineStartSec === 'function'
                    ? getExtraTrackTimelineStartSec(slot)
                    : 0;
            return Math.max(0, end - start);
        }
        const tr = extraTrackBySlot(slot);
        if (!tr) return 0;
        if (tr.buffer && tr.buffer.duration > 0) return tr.buffer.duration;
        const hint = Number(tr.restoreDurationHint);
        return Number.isFinite(hint) && hint > 0 ? hint : 0;
    }

    function hasExtraTrackWaveformPeaks(slot) {
        const tr = extraTrackBySlot(slot);
        return !!(tr && tr.peaks && tr.peaks.length > 0);
    }

    function clonePeaksForPersist(peaks) {
        if (!peaks || !peaks.length) return null;
        const out = new Array(peaks.length);
        for (let i = 0; i < peaks.length; i++) {
            const p = peaks[i];
            out[i] = {
                min: p && Number.isFinite(p.min) ? p.min : 0,
                max: p && Number.isFinite(p.max) ? p.max : 0,
            };
        }
        return out;
    }

    /** 再生用 reviewMixCtx とは別コンテキストでデコード（リロード直後のハング回避） */
    async function decodeExtraFileArrayBuffer(ab) {
        if (!ab || ab.byteLength < 1) throw new Error('empty file');
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (OfflineCtx) {
            try {
                const offline = new OfflineCtx(2, 2, 44100);
                return await decodeArrayBufferToAudioBuffer(offline, ab);
            } catch (err) {
                writeLog(
                    'Extra audio decode: OfflineAudioContext failed — ' +
                        (err && err.message ? err.message : String(err)),
                );
            }
        }
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) throw new Error('AudioContext unavailable');
        const decodeCtx = new Ctx();
        try {
            if (decodeCtx.state === 'suspended') {
                try {
                    await decodeCtx.resume();
                } catch (_) {}
            }
            return await decodeArrayBufferToAudioBuffer(decodeCtx, ab);
        } finally {
            if (decodeCtx.close) {
                try {
                    await decodeCtx.close();
                } catch (_) {}
            }
        }
    }

    function rawMasterTimelineWidthCss() {
        const el =
            typeof audioWaveformLanesTracks !== 'undefined' && audioWaveformLanesTracks
                ? audioWaveformLanesTracks
                : null;
        if (el) return el.clientWidth | 0;
        if (typeof audioWaveformTrack !== 'undefined' && audioWaveformTrack) {
            return audioWaveformTrack.clientWidth | 0;
        }
        return 0;
    }

    function rebuildExtraTrackPeaksIfNeeded(slot) {
        const tr = extraTrackBySlot(slot);
        const ui = getExtraUi(slot);
        if (!tr || !ui || !ui.track) return false;
        if (!tr.buffer) return hasExtraTrackWaveformPeaks(slot);
        const layoutW =
            typeof waveformTimelineViewportWidthCss === 'function'
                ? waveformTimelineViewportWidthCss()
                : rawMasterTimelineWidthCss();
        if (layoutW < EXTRA_WAVEFORM_LAYOUT_MIN_CSS) return false;
        const sized = syncExtraCanvasSize(ui);
        if (!sized) return false;
        if (!tr.peaks || tr.peaks.length !== sized.barCount) {
            if (tr.peakPyramid && typeof peaksOverviewFromPyramid === 'function') {
                const overview = peaksOverviewFromPyramid(tr.peakPyramid, sized.barCount);
                if (overview && overview.length) tr.peaks = overview;
            }
            if (!tr.peaks || tr.peaks.length !== sized.barCount) {
                tr.peaks = peaksFromBuffer(tr.buffer, Math.min(512, sized.barCount));
            }
        }
        return !!(tr.peaks && tr.peaks.length > 0);
    }

    function scheduleExtraTrackPeakPyramidBuild(slot, buffer, barCount) {
        const tr = extraTrackBySlot(slot);
        if (!tr || !buffer) return;
        const gen = (tr.peakPyramidGen = (tr.peakPyramidGen || 0) + 1);
        const onBuilt = (pyramid) => {
            if (!tr.buffer || tr.buffer !== buffer || tr.peakPyramidGen !== gen) return;
            if (!pyramid) return;
            if (typeof clearViewportPeakCache === 'function') clearViewportPeakCache();
            tr.peakPyramid = pyramid;
            if (typeof peaksOverviewFromPyramid === 'function') {
                const overview = peaksOverviewFromPyramid(tr.peakPyramid, barCount);
                if (overview && overview.length) tr.peaks = overview;
            }
            drawExtraTrackWaveform(slot);
            if (typeof scheduleWaveformHiresRedrawAfterZoom === 'function') {
                scheduleWaveformHiresRedrawAfterZoom({ slots: [slot] });
            }
        };
        const run = () => {
            if (!tr.buffer || tr.buffer !== buffer || tr.peakPyramidGen !== gen) return;
            if (typeof buildPeakPyramidFromBufferAsync === 'function') {
                buildPeakPyramidFromBufferAsync(buffer, onBuilt);
            } else if (typeof buildPeakPyramidFromBuffer === 'function') {
                onBuilt(buildPeakPyramidFromBuffer(buffer));
            }
        };
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(run, { timeout: 3000 });
        } else {
            setTimeout(run, 16);
        }
    }

    /** 表示中かつ読み込み済みの Ex スロット */
    function getVisibleLoadedExtraTrackSlots() {
        const out = [];
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const meta = document.getElementById('extraAudioMeta' + i);
            if (meta && meta.hidden) continue;
            if (!isExtraTrackLoaded(i)) continue;
            const tr = extraTrackBySlot(i);
            if (!tr || !tr.buffer) continue;
            out.push(i);
        }
        return out;
    }

    window.getVisibleLoadedExtraTrackSlots = getVisibleLoadedExtraTrackSlots;

    function extraTrackWaveformDrawReady(slot) {
        if (!hasExtraTrackWaveformPeaks(slot) || !isExtraTrackLaneShown(slot)) return true;
        const tr = extraTrackBySlot(slot);
        const ui = getExtraUi(slot);
        if (!tr || !ui || !ui.canvas) return false;
        if (!tr.peaks || tr.peaks.length < 1) return false;
        const laneW =
            typeof waveformTimelineViewportWidthCss === 'function'
                ? waveformTimelineViewportWidthCss()
                : rawMasterTimelineWidthCss();
        if (laneW < EXTRA_WAVEFORM_LAYOUT_MIN_CSS) return false;
        const styleW = parseFloat(ui.canvas.style.width) || 0;
        return styleW >= EXTRA_WAVEFORM_LAYOUT_MIN_CSS;
    }

    /** レイアウト未確定時は rAF で再試行し、peaks 欠落時は再生成する。 */
    function ensureExtraTrackWaveformsDrawn(opt) {
        const gen = ++extraWaveformEnsureGen;
        const maxFrames = opt && opt.maxFrames > 0 ? opt.maxFrames : 28;
        const slots =
            opt && Array.isArray(opt.slots) && opt.slots.length
                ? opt.slots.filter((s) => s >= 0 && s < EXTRA_TRACK_COUNT)
                : null;
        let frame = 0;

        const targets = () => {
            const out = [];
            for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
                if (slots && slots.indexOf(i) < 0) continue;
                if (isExtraTrackLoaded(i) || hasExtraTrackWaveformPeaks(i)) out.push(i);
            }
            return out;
        };

        const paintSlot = (slot) => {
            const layoutW =
                typeof waveformTimelineViewportWidthCss === 'function'
                    ? waveformTimelineViewportWidthCss()
                    : rawMasterTimelineWidthCss();
            if (layoutW < EXTRA_WAVEFORM_LAYOUT_MIN_CSS) return;
            if (!rebuildExtraTrackPeaksIfNeeded(slot)) return;
            drawExtraTrackWaveform(slot);
        };

        const step = () => {
            if (gen !== extraWaveformEnsureGen) return;
            frame += 1;
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
            const list = targets();
            let pending = false;
            for (let j = 0; j < list.length; j++) {
                const slot = list[j];
                if (!extraTrackWaveformDrawReady(slot)) {
                    pending = true;
                    paintSlot(slot);
                }
            }
            if (pending && frame < maxFrames) {
                requestAnimationFrame(step);
                return;
            }
            if (pending && frame >= maxFrames) {
                writeLog('Extra audio: waveform layout retry limit (redrawing anyway)');
                for (let j = 0; j < list.length; j++) paintSlot(list[j]);
            }
            if (opt && opt.notifyMaster && typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
        };

        requestAnimationFrame(step);
    }

    function peaksFromBuffer(buffer, barCount) {
        if (!buffer || buffer.numberOfChannels < 1) {
            return null;
        }
        const ch = buffer.getChannelData(0);
        const len = ch.length;
        const bars = Math.max(1, barCount | 0);
        const block = Math.max(1, Math.floor(len / bars));
        const peaks = new Array(bars);
        for (let i = 0; i < bars; i++) {
            const start = i * block;
            const end = Math.min(len, start + block);
            let min = 0;
            let max = 0;
            for (let j = start; j < end; j++) {
                const v = ch[j];
                if (v < min) min = v;
                if (v > max) max = v;
            }
            peaks[i] = { min, max };
        }
        return peaks;
    }

    function peaksFromBufferRange(buffer, startSec, endSec, barCount) {
        if (!buffer || buffer.numberOfChannels < 1) return [];
        const ch = buffer.getChannelData(0);
        const sr = buffer.sampleRate;
        const startSample = Math.max(0, Math.floor(startSec * sr));
        const endSample = Math.min(ch.length, Math.ceil(endSec * sr));
        if (endSample <= startSample) return [];
        const len = endSample - startSample;
        const bars = Math.max(1, barCount | 0);
        const block = Math.max(1, Math.floor(len / bars));
        const peaks = new Array(bars);
        for (let i = 0; i < bars; i++) {
            const blockStart = startSample + i * block;
            const blockEnd = Math.min(endSample, blockStart + block);
            let min = 0;
            let max = 0;
            for (let j = blockStart; j < blockEnd; j++) {
                const v = ch[j];
                if (v < min) min = v;
                if (v > max) max = v;
            }
            peaks[i] = { min, max };
        }
        return peaks;
    }

    function getExtraTrackClipBuffer(tr, clipId) {
        const clip = getExtraTrackClip(tr, clipId || 'main');
        if (clip && clip.buffer) return clip.buffer;
        return tr && tr.buffer ? tr.buffer : null;
    }

    window.getExtraTrackClipBuffer = getExtraTrackClipBuffer;
    window.peaksFromBufferRange = peaksFromBufferRange;

    function syncExtraCanvasSize(ui) {
        if (!ui || !ui.canvas || !ui.track) return null;
        const wCss =
            typeof waveformTimelineScrubWidthCss === 'function'
                ? waveformTimelineScrubWidthCss()
                : typeof masterTimelineWidthCss === 'function'
                  ? masterTimelineWidthCss()
                  : Math.max(1, ui.track.clientWidth | 0);
        const hCss = Math.max(1, ui.track.clientHeight | 0);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        ui.canvas.width = Math.max(1, Math.round(wCss * dpr));
        ui.canvas.height = Math.max(1, Math.round(hCss * dpr));
        ui.canvas.style.width = wCss + 'px';
        ui.canvas.style.height = hCss + 'px';
        const ctx = ui.canvas.getContext('2d');
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { ctx, wCss, hCss, barCount: Math.min(4096, Math.max(64, wCss)) };
    }

    function drawExtraTrackWaveform(slot) {
        const ui = getExtraUi(slot);
        const tr = extraTrackBySlot(slot);
        if (!ui || !ui.canvas) return;
        if (tr && tr.buffer && (!tr.peaks || tr.peaks.length < 1)) {
            rebuildExtraTrackPeaksIfNeeded(slot);
        }
        const sized = syncExtraCanvasSize(ui);
        if (!sized || !sized.ctx) return;
        const { ctx, wCss, hCss } = sized;
        const audible =
            typeof isExtraTrackAudible === 'function' ? isExtraTrackAudible(slot) : true;
        const grad =
            typeof timelineWaveformFillGradient === 'function'
                ? timelineWaveformFillGradient(ctx, hCss, 'extra', audible)
                : null;
        const timelineStartSec = getExtraTrackTimelineStartSec(slot);
        const drawOpt = { timelineStartSec };
        if (tr && tr.viewportPeaks) {
            if (tr.viewportPeaks.segments && tr.viewportPeaks.segments.length === 1) {
                drawOpt.viewportPeaks = tr.viewportPeaks.segments[0];
            } else if (tr.viewportPeaks.peaks) {
                drawOpt.viewportPeaks = tr.viewportPeaks;
            }
        }
        if (typeof drawExtraTrackWaveformRegions === 'function') {
            drawExtraTrackWaveformRegions(ctx, wCss, hCss, slot, grad);
        } else {
            drawPeaksForMasterTimeline(
                ctx,
                tr ? tr.peaks : null,
                wCss,
                hCss,
                extraTrackContentDurationSec(slot),
                grad,
                drawOpt,
            );
        }
    }

    function redrawAllExtraTrackWaveforms() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) drawExtraTrackWaveform(i);
    }

    function clearAllExtraWaveformViewportPeaks() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            const tr = extraTrackBySlot(i);
            if (tr) tr.viewportPeaks = null;
        }
    }

    function rebuildAllExtraWaveformViewportPeaks(spec, opt) {
        if (!spec) {
            clearAllExtraWaveformViewportPeaks();
            return;
        }
        const slots =
            opt && Array.isArray(opt.slots) && opt.slots.length
                ? opt.slots
                : getVisibleLoadedExtraTrackSlots();
        for (let j = 0; j < slots.length; j++) {
            const i = slots[j];
            if (typeof rebuildExtraTrackRegionViewportPeaks === 'function') {
                rebuildExtraTrackRegionViewportPeaks(i, spec);
            } else {
                const tr = extraTrackBySlot(i);
                if (tr) tr.viewportPeaks = null;
            }
        }
    }

    window.clearAllExtraWaveformViewportPeaks = clearAllExtraWaveformViewportPeaks;
    window.rebuildAllExtraWaveformViewportPeaks = rebuildAllExtraWaveformViewportPeaks;

    /** レーン表示直後は clientWidth が 0 のことがあるため、レイアウト確定まで再試行する。 */
    function scheduleExtraTrackWaveformRedraw(slot, opt) {
        const ensureOpt = {
            notifyMaster: !!(opt && opt.notifyMaster),
            maxFrames: opt && opt.maxFrames > 0 ? opt.maxFrames : undefined,
        };
        if (slot >= 0 && slot < EXTRA_TRACK_COUNT) {
            ensureOpt.slots = [slot];
        }
        ensureExtraTrackWaveformsDrawn(ensureOpt);
    }

    function setExtraTrackStatus(slot, text) {
        const ui = getExtraUi(slot);
        if (ui && ui.status) {
            if (typeof applyLaneStatusEl === 'function') {
                applyLaneStatusEl(ui.status, text);
            } else {
                ui.status.textContent = text || '';
                ui.status.hidden = true;
            }
        }
        const tr = extraTrackBySlot(slot);
        const label = EXTRA_TRACK_DEFAULT_LABELS[slot] || 'Ex';
        const tip =
            typeof laneStatusTooltip === 'function' ? laneStatusTooltip(text) : '';
        if (ui && ui.title) {
            ui.title.textContent = label;
            ui.title.title = tip ? label + ' — ' + tip : label;
        }
        if (ui && ui.fileName) {
            const hasRegions =
                typeof isTrackRegionActive === 'function' &&
                isTrackRegionActive({ type: 'extra', slot });
            if (hasRegions) {
                if (typeof syncExtraLaneFileNameForRegions === 'function') {
                    syncExtraLaneFileNameForRegions(slot);
                } else {
                    ui.fileName.hidden = true;
                    ui.fileName.textContent = '';
                }
            } else if (tr && tr.file && tr.file.name) {
                const full = tr.file.name;
                setLaneWaveformFileNameEl(ui.fileName, full, tip ? full + ' — ' + tip : full);
            } else {
                setLaneWaveformFileNameEl(ui.fileName, '');
            }
        }
    }

    function setExtraTrackLoaded(slot, loaded, opt) {
        const ui = getExtraUi(slot);
        if (ui && ui.meta) ui.meta.classList.toggle('loaded', !!loaded);
        if (typeof refreshAudioWaveformCompositeLoadedState === 'function') {
            refreshAudioWaveformCompositeLoadedState();
        }
        if (loaded && typeof syncAudioOnlyMarkersUi === 'function') {
            syncAudioOnlyMarkersUi();
        }
        applyExtraTrackLaneVisibility(slot);
        if (!opt || !opt.skipLayoutRefresh) {
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
        }
    }

    function extraTrackSlotHasContent(slot) {
        if (isExtraTrackLoaded(slot)) return true;
        const track = { type: 'extra', slot };
        if (
            typeof isTrackRegionActive === 'function' &&
            isTrackRegionActive(track)
        ) {
            return true;
        }
        const tr = extraTrackBySlot(slot);
        if (!tr) return false;
        const clips = tr.clips;
        if (clips && clips.length) {
            for (const c of clips) {
                if (c.buffer && c.buffer.duration > 0) return true;
            }
        }
        if (tr.peaks && tr.peaks.length) {
            const hint = Number(tr.restoreDurationHint);
            if (Number.isFinite(hint) && hint > 0) return true;
            if (tr.buffer && tr.buffer.duration > 0) return true;
        }
        return false;
    }

    function isExtraTrackLaneShown(slot) {
        if (extraTrackSlotHasContent(slot)) return true;
        return !!extraLaneUiOpen[slot];
    }

    /** リロード後: 波形・リージョンのない Ex レーンを閉じ、最低 1 レーンは残す */
    function syncExtraLaneVisibilityAfterSessionRestore() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (!extraTrackSlotHasContent(i)) {
                extraLaneUiOpen[i] = false;
            } else {
                extraLaneUiOpen[i] = true;
            }
            applyExtraTrackLaneVisibility(i);
        }
        if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        refreshExtraTrackAddLaneButtons();
    }

    function canRevealNextExtraTrackLane(fromSlot) {
        for (let i = fromSlot + 1; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackLaneShown(i)) return true;
        }
        return false;
    }

    function revealNextExtraTrackLane(fromSlot) {
        for (let i = fromSlot + 1; i < EXTRA_TRACK_COUNT; i++) {
            if (!isExtraTrackLaneShown(i)) {
                setExtraTrackLaneUiOpen(i, true);
                setExtraTrackStatus(i, 'Not Loaded');
                refreshExtraTrackUi(i);
                writeLog('Ex ' + (i + 1) + ': track lane opened');
                return i;
            }
        }
        writeLog('Extra audio: maximum track count reached');
        return -1;
    }

    function handleExtraTrackAddShortcutKeydown(e) {
        const shortcuts = window.SHORTCUTS || {};
        const matches =
            typeof window.matchesShortcut === 'function'
                ? window.matchesShortcut
                : () => false;
        if (!matches(e, shortcuts.addExtraTrack)) {
            return false;
        }
        e.preventDefault();
        revealNextExtraTrackLane(-1);
        refreshExtraTrackAddLaneButtons();
        return true;
    }

    function refreshVideoAudioAddTrackButton() {
        const btn = document.getElementById('videoAudioAddTrackBtn');
        if (!btn) return;
        const videoLaneShown =
            typeof isVideoAudioLaneShown === 'function' && isVideoAudioLaneShown();
        const canAdd = canRevealNextExtraTrackLane(-1);
        btn.hidden = !videoLaneShown || !canAdd;
        btn.disabled = !canAdd;
    }

    const EXTRA_CLEAR_TITLE_ENABLED = 'Clear (hide lane)';
    const EXTRA_CLEAR_TITLE_DISABLED = '最後の1トラックは非表示にできません';

    function refreshExtraTrackClearButtons() {
        const canClear =
            typeof canHideAnyWaveformLane === 'function' && canHideAnyWaveformLane();
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            const ui = getExtraUi(slot);
            if (!ui || !ui.clearBtn) continue;
            const laneShown = isExtraTrackLaneShown(slot);
            ui.clearBtn.disabled = !laneShown || !canClear;
            ui.clearBtn.title =
                canClear && laneShown ? EXTRA_CLEAR_TITLE_ENABLED : EXTRA_CLEAR_TITLE_DISABLED;
        }
    }

    function refreshExtraTrackAddLaneButtons() {
        refreshVideoAudioAddTrackButton();
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            const ui = getExtraUi(slot);
            if (!ui || !ui.addTrackBtn) continue;
            const canAdd = canRevealNextExtraTrackLane(slot);
            ui.addTrackBtn.disabled = !canAdd;
            ui.addTrackBtn.hidden = slot >= EXTRA_TRACK_COUNT - 1 && !canAdd;
        }
        refreshExtraTrackClearButtons();
    }

    function applyExtraTrackLaneVisibility(slot) {
        const ui = getExtraUi(slot);
        const show = isExtraTrackLaneShown(slot);
        const laneEl = document.getElementById('extraAudioLane' + slot);
        if (ui && ui.meta) {
            ui.meta.hidden = !show;
            ui.meta.setAttribute('aria-hidden', show ? 'false' : 'true');
        }
        if (laneEl) {
            laneEl.hidden = !show;
            laneEl.setAttribute('aria-hidden', show ? 'false' : 'true');
        }
    }

    function setExtraTrackLaneUiOpen(slot, open, opt) {
        if (slot < 0 || slot >= EXTRA_TRACK_COUNT) return;
        extraLaneUiOpen[slot] = !!open;
        applyExtraTrackLaneVisibility(slot);
        if (!open && typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
        if (!opt || !opt.deferLayout) {
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
        }
        refreshExtraTrackAddLaneButtons();
        if (!opt || !opt.skipPersist) {
            if (typeof schedulePersistSession === 'function') schedulePersistSession();
        }
    }

    /** 表示レーンが 0 のとき空きドロップ枠として Ex レーンを 1 つ再表示 */
    function reviveOneEmptyExtraLane() {
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            if (!isExtraTrackLaneShown(slot)) {
                setExtraTrackLaneUiOpen(slot, true, { deferLayout: true });
                setExtraTrackStatus(slot, 'Not Loaded');
                refreshExtraTrackUi(slot);
                return slot;
            }
        }
        setExtraTrackLaneUiOpen(0, true, { deferLayout: true });
        setExtraTrackStatus(0, 'Not Loaded');
        refreshExtraTrackUi(0);
        return 0;
    }

    window.reviveOneEmptyExtraLane = reviveOneEmptyExtraLane;

    function getWaveformLaneUiPersistSnapshot() {
        const extraLanesOpen = [];
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            extraLanesOpen[i] = isExtraTrackLaneShown(i);
        }
        return {
            videoLaneOpen:
                typeof getVideoLaneUiOpen === 'function' ? !!getVideoLaneUiOpen() : true,
            extraLanesOpen,
        };
    }

    function applyWaveformLaneUiPersistSnapshot(snap, opt) {
        if (!snap || typeof snap !== 'object') return false;
        if (typeof setVideoLaneUiOpenFromPersist === 'function') {
            setVideoLaneUiOpenFromPersist(
                typeof snap.videoLaneOpen === 'boolean' ? snap.videoLaneOpen : true,
                { skipRefresh: true },
            );
        }
        if (Array.isArray(snap.extraLanesOpen)) {
            for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
                if (typeof snap.extraLanesOpen[i] === 'boolean') {
                    setExtraTrackLaneUiOpen(i, snap.extraLanesOpen[i], {
                        deferLayout: true,
                        skipPersist: true,
                    });
                }
            }
        }
        refreshAllExtraTrackLaneVisibility();
        if (!opt || !opt.skipRefresh) {
            if (typeof refreshVideoAudioLaneVisibility === 'function') {
                refreshVideoAudioLaneVisibility();
            }
        }
        if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
        return true;
    }

    function applySavedWaveformLaneUi(sessionSnap) {
        let snap = sessionSnap;
        if (!snap && typeof readPrefs === 'function') {
            const p = readPrefs();
            if (p && p.laneUi) snap = p.laneUi;
        }
        if (snap) {
            applyWaveformLaneUiPersistSnapshot(snap);
        } else if (typeof restoreExtraTrackLanesForNewVideo === 'function') {
            restoreExtraTrackLanesForNewVideo();
        }
        if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
    }

    window.getWaveformLaneUiPersistSnapshot = getWaveformLaneUiPersistSnapshot;
    window.applyWaveformLaneUiPersistSnapshot = applyWaveformLaneUiPersistSnapshot;
    window.applySavedWaveformLaneUi = applySavedWaveformLaneUi;

    function refreshExtraTrackLaneVisibility(slot) {
        applyExtraTrackLaneVisibility(slot);
    }

    function refreshAllExtraTrackLaneVisibility() {
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            refreshExtraTrackLaneVisibility(i);
        }
        refreshExtraTrackClearButtons();
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
    }

    /** 新規動画読み込み時: 空き Ex レーンは閉じる（追加は + Add Track またはドロップ） */
    function restoreExtraTrackLanesForNewVideo() {
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            setExtraTrackLaneUiOpen(slot, false, {
                deferLayout: true,
                skipPersist: true,
            });
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        if (typeof restoreVideoAudioLaneForNewVideo === 'function') {
            restoreVideoAudioLaneForNewVideo();
        }
        if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
    }

    /** Video Audio 表示中は中身のない Ex レーンを閉じる（誤って開いた空レーンの後片付け） */
    function hideEmptyExtraLanesWhenVideoAudioVisible() {
        if (typeof isVideoAudioLaneShown !== 'function' || !isVideoAudioLaneShown()) {
            return;
        }
        let changed = false;
        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            if (extraTrackSlotHasContent(slot)) continue;
            if (!extraLaneUiOpen[slot]) continue;
            setExtraTrackLaneUiOpen(slot, false, { deferLayout: true, skipPersist: true });
            changed = true;
        }
        if (changed && typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
    }

    window.hideEmptyExtraLanesWhenVideoAudioVisible = hideEmptyExtraLanesWhenVideoAudioVisible;

    window.restoreExtraTrackLanesForNewVideo = restoreExtraTrackLanesForNewVideo;
    window.extraTrackBufferDuration = extraTrackBufferDuration;
    window.toggleExtraTrackSolo = toggleExtraSolo;
    window.toggleExtraTrackMute = toggleExtraMute;
    window.resolveActiveMixLaneDisplayIndex = resolveActiveMixLaneDisplayIndex;
    window.toggleMixSoloByDisplayIndex = toggleMixSoloByDisplayIndex;
    window.toggleMixMuteByDisplayIndex = toggleMixMuteByDisplayIndex;
    window.adjustExtraTrackVolumeDb = adjustExtraTrackVolumeDb;
    window.clearExtraTrackVolumeUnityHold = clearExtraTrackVolumeUnityHold;
    window.isExtraTrackLoaded = isExtraTrackLoaded;
    window.isPastAllLoadedTrackPlaybackEnds = isPastAllLoadedTrackPlaybackEnds;
    window.hasAnyExtraTrackTimelineContent = hasAnyExtraTrackTimelineContent;
    window.extraTrackSlotHasContent = extraTrackSlotHasContent;
    window.isExtraTrackLaneShown = isExtraTrackLaneShown;
    window.EXTRA_TRACK_COUNT = EXTRA_TRACK_COUNT;
    window.loadExtraTrackFile = loadExtraTrackFile;
    window.redrawAllExtraTrackWaveforms = redrawAllExtraTrackWaveforms;
    window.scheduleExtraTrackWaveformRedraw = scheduleExtraTrackWaveformRedraw;
    window.ensureExtraTrackWaveformsDrawn = ensureExtraTrackWaveformsDrawn;
    window.finalizeReviewMixAfterSessionRestore = finalizeReviewMixAfterSessionRestore;
    window.prepareReviewMixForNewVideoLoad = prepareReviewMixForNewVideoLoad;
    window.tryWireReviewMixVideoAudioWhenReady = tryWireReviewMixVideoAudioWhenReady;
    window.ensureReviewMixVideoMonitorTap = ensureReviewMixVideoMonitorTap;
    window.applyReviewMixVideoMonitorTapGain = applyReviewMixVideoMonitorTapGain;
    window.isVideoAudioPlaybackViaNativeElement = isVideoAudioPlaybackViaNativeElement;
    window.applyExtraTrackPeaksPreview = applyExtraTrackPeaksPreview;
    window.buildExtraTrackPeaksPreviewFromWavBlob = buildExtraTrackPeaksPreviewFromWavBlob;
    window.refreshAllExtraTrackLaneVisibility = refreshAllExtraTrackLaneVisibility;

    function refreshExtraTrackUi(slot) {
        const ui = getExtraUi(slot);
        const tr = extraTrackBySlot(slot);
        if (!ui) return;
        if (ui.title) {
            const label = EXTRA_TRACK_DEFAULT_LABELS[slot] || 'Ex';
            const st = ui.status ? ui.status.textContent || '' : '';
            const tip =
                typeof laneStatusTooltip === 'function' ? laneStatusTooltip(st) : '';
            ui.title.textContent = label;
            ui.title.title = tip ? label + ' — ' + tip : label;
        }
        if (ui.fileName) {
            const hasRegions =
                typeof isTrackRegionActive === 'function' &&
                isTrackRegionActive({ type: 'extra', slot });
            if (hasRegions) {
                if (typeof syncExtraLaneFileNameForRegions === 'function') {
                    syncExtraLaneFileNameForRegions(slot);
                } else {
                    ui.fileName.hidden = true;
                    ui.fileName.textContent = '';
                }
            } else if (tr && tr.file && tr.file.name) {
                const st = ui.status ? ui.status.textContent || '' : '';
                const tip =
                    typeof laneStatusTooltip === 'function' ? laneStatusTooltip(st) : '';
                const full = tr.file.name;
                setLaneWaveformFileNameEl(ui.fileName, full, tip ? full + ' — ' + tip : full);
            } else {
                setLaneWaveformFileNameEl(ui.fileName, '');
            }
        }
        const hasBuf = !!(tr && tr.buffer);
        if (ui.meta) ui.meta.classList.toggle('loaded', hasBuf);
        if (typeof refreshAudioWaveformCompositeLoadedState === 'function') {
            refreshAudioWaveformCompositeLoadedState();
        }
        if (ui.soloBtn) {
            ui.soloBtn.disabled = !hasBuf;
            setMixBtnState(ui.soloBtn, !!(tr && tr.solo));
        }
        if (ui.muteBtn) {
            ui.muteBtn.disabled = !hasBuf;
            setMixBtnState(ui.muteBtn, !!(tr && tr.muted));
        }
        drawExtraTrackWaveform(slot);
        if (hasBuf && typeof updateTrackRegionOverlay === 'function') {
            updateTrackRegionOverlay({ type: 'extra', slot });
        }
        if (typeof refreshTrackLaneControlsUi === 'function') refreshTrackLaneControlsUi();
        refreshExtraTrackLaneVisibility(slot);
        refreshExtraTrackAddLaneButtons();
    }

    function extraSlotHasShownLanesAbove(slot) {
        for (let i = slot + 1; i < EXTRA_TRACK_COUNT; i++) {
            if (isExtraTrackLaneShown(i)) return true;
        }
        return false;
    }

    function cloneExtraTrackClips(clips) {
        if (!clips || !clips.length) return [];
        return clips.map((c) => ({
            id: c.id,
            file: c.file,
            buffer: c.buffer,
            peaks: c.peaks,
            persistBlob: c.persistBlob,
            name: c.name,
        }));
    }

    function transferSessionMixRestoreEntry(fromSlot, toSlot) {
        if (!sessionMixRestore || !Array.isArray(sessionMixRestore.extra)) return;
        const entry = sessionMixRestore.extra.find((e) => e && e.slot === fromSlot);
        sessionMixRestore.extra = sessionMixRestore.extra.filter(
            (e) => !e || e.slot !== toSlot,
        );
        if (entry) entry.slot = toSlot;
    }

    function transferExtraTrackPlaybackRegions(fromSlot, toSlot) {
        const srcTr = extraTrackBySlot(fromSlot);
        const dstTr = extraTrackBySlot(toSlot);
        const toTrack = { type: 'extra', slot: toSlot };
        if (typeof clearTrackRegion === 'function') {
            clearTrackRegion(toTrack, { silent: true, skipUndo: true });
        }
        if (
            !srcTr ||
            !dstTr ||
            !srcTr.playbackRegions ||
            !srcTr.playbackRegions.active ||
            !srcTr.playbackRegions.segments.length
        ) {
            return;
        }
        dstTr.playbackRegions = JSON.parse(JSON.stringify(srcTr.playbackRegions));
        delete dstTr.region;
        if (typeof updateTrackRegionOverlay === 'function') {
            updateTrackRegionOverlay(toTrack);
        }
    }

    function transferExtraTrackSlotContent(fromSlot, toSlot) {
        if (fromSlot === toSlot) return;
        const src = extraTrackBySlot(fromSlot);
        const dst = extraTrackBySlot(toSlot);
        if (!src || !dst) return;

        stopExtraTrackAllSources(fromSlot);
        stopExtraTrackAllSources(toSlot);
        dst.loadGen += 1;

        dst.file = src.file;
        dst.buffer = src.buffer;
        dst.peaks = src.peaks;
        dst.persistBlob = src.persistBlob;
        dst.restoreDurationHint = src.restoreDurationHint;
        dst.timelineStartSec = src.timelineStartSec;
        dst.clips = cloneExtraTrackClips(src.clips);
        dst.segmentSources = {};
        dst.muted = src.muted;
        dst.solo = src.solo;
        dst.volLinear = src.volLinear;
        transferSessionMixRestoreEntry(fromSlot, toSlot);
        transferExtraTrackPlaybackRegions(fromSlot, toSlot);
        applyExtraTrackLaneGain(toSlot);

        const loaded = extraTrackSlotHasContent(toSlot);
        setExtraTrackLoaded(toSlot, loaded, { skipLayoutRefresh: true });
        if (loaded) {
            setExtraTrackStatus(toSlot, 'Ready');
        } else {
            setExtraTrackStatus(toSlot, 'Not Loaded');
        }
        refreshExtraTrackUi(toSlot);
    }

    function wipeExtraTrackSlotContent(slot, opt) {
        const tr = extraTrackBySlot(slot);
        if (!tr) return false;
        const hadContent = extraTrackSlotHasContent(slot);
        stopExtraTrackAllSources(slot);
        tr.loadGen += 1;
        if (typeof clearTrackRegion === 'function') {
            clearTrackRegion({ type: 'extra', slot }, { silent: true, skipUndo: true });
        }
        tr.clips = [];
        tr.segmentSources = {};
        tr.file = null;
        tr.buffer = null;
        tr.peaks = null;
        tr.peakPyramid = null;
        tr.viewportPeaks = null;
        tr.persistBlob = null;
        tr.restoreDurationHint = 0;
        tr.timelineStartSec = 0;
        tr.playbackRegions = { active: false, segments: [], headPadSec: 0 };
        delete tr.region;
        if (!opt || !opt.keepMix) {
            resetExtraTrackMixToDefault(slot);
        }
        try {
            if (tr.analyser) tr.analyser.disconnect();
        } catch (_) {}
        tr.analyser = null;
        setExtraTrackLoaded(slot, false, { skipLayoutRefresh: true });
        setExtraTrackStatus(slot, 'Not Loaded');
        refreshExtraTrackUi(slot);
        return hadContent;
    }

    function compactExtraTracksAfterClear(clearedSlot) {
        stopAllExtraTrackSources();
        let dest = clearedSlot;
        for (let src = clearedSlot + 1; src < EXTRA_TRACK_COUNT; src++) {
            if (!isExtraTrackLaneShown(src)) continue;
            if (dest !== src) {
                if (extraTrackSlotHasContent(src)) {
                    transferExtraTrackSlotContent(src, dest);
                }
                extraLaneUiOpen[dest] = extraLaneUiOpen[src];
            }
            dest++;
        }
        for (let i = dest; i < EXTRA_TRACK_COUNT; i++) {
            wipeExtraTrackSlotContent(i);
            extraLaneUiOpen[i] = false;
            setExtraTrackLaneUiOpen(i, false, { deferLayout: true, skipPersist: true });
        }
        for (let i = clearedSlot; i < dest; i++) {
            setExtraTrackLaneUiOpen(i, true, { deferLayout: true, skipPersist: true });
        }
        if (typeof clearExtraTrackVolumeUnityHold === 'function') {
            clearExtraTrackVolumeUnityHold();
        }
    }

    function clearExtraTrack(slot) {
        if (typeof canHideAnyWaveformLane === 'function' && !canHideAnyWaveformLane()) {
            return;
        }
        const tr = extraTrackBySlot(slot);
        if (!tr) return;
        const hadContent = extraTrackSlotHasContent(slot);
        const shouldCompact = extraSlotHasShownLanesAbove(slot);

        if (shouldCompact) {
            compactExtraTracksAfterClear(slot);
            if (typeof refreshTrackLaneControlsUi === 'function') {
                refreshTrackLaneControlsUi();
            }
            if (typeof refreshReviewMixUi === 'function') {
                refreshReviewMixUi();
            }
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
            if (typeof syncExtraAudioToTransport === 'function') {
                syncExtraAudioToTransport({ force: true });
            }
            if (hadContent && typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
            for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
                if (extraTrackSlotHasContent(i)) {
                    if (typeof schedulePersistExtraTrackSlot === 'function') {
                        schedulePersistExtraTrackSlot(i);
                    }
                } else if (typeof removeExtraTrackFromSession === 'function') {
                    void removeExtraTrackFromSession(i);
                }
            }
            if (typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
        } else {
            wipeExtraTrackSlotContent(slot);
            extraLaneUiOpen[slot] = false;
            setExtraTrackLaneUiOpen(slot, false, { deferLayout: true, skipPersist: false });
            if (typeof refreshTrackLaneControlsUi === 'function') {
                refreshTrackLaneControlsUi();
            }
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
            if (hadContent && typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
            if (hadContent && typeof removeExtraTrackFromSession === 'function') {
                void removeExtraTrackFromSession(slot);
            } else if (hadContent && typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
        }

        refreshExtraTrackAddLaneButtons();
        if (typeof refreshExportMediaOptionsUi === 'function') {
            refreshExportMediaOptionsUi();
        }
    }

    function clearAllExtraTracks() {
        stopAllExtraTrackSources();
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            wipeExtraTrackSlotContent(i);
            extraLaneUiOpen[i] = false;
            setExtraTrackLaneUiOpen(i, false, { deferLayout: true, skipPersist: true });
        }
        if (typeof clearExtraTrackVolumeUnityHold === 'function') {
            clearExtraTrackVolumeUnityHold();
        }
        if (typeof refreshTrackLaneControlsUi === 'function') {
            refreshTrackLaneControlsUi();
        }
        if (typeof refreshReviewMixUi === 'function') {
            refreshReviewMixUi();
        }
        if (typeof refreshWaveformCompositeLaneLayout === 'function') {
            refreshWaveformCompositeLaneLayout();
        }
        if (typeof syncExtraAudioToTransport === 'function') {
            syncExtraAudioToTransport({ force: true });
        }
        if (typeof notifyMasterTransportDurationChanged === 'function') {
            notifyMasterTransportDurationChanged();
        }
        for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
            if (typeof removeExtraTrackFromSession === 'function') {
                void removeExtraTrackFromSession(i);
            }
        }
        if (typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        refreshExtraTrackAddLaneButtons();
        if (typeof refreshExportMediaOptionsUi === 'function') {
            refreshExportMediaOptionsUi();
        }
        if (typeof ensureAtLeastOneWaveformLaneVisible === 'function') {
            ensureAtLeastOneWaveformLaneVisible();
        }
    }

    function resetVideoMix() {
        videoMix.muted = false;
        videoMix.solo = false;
        videoMix.volLinear = 1;
        refreshReviewMixUi();
    }

    async function loadExtraTrackFile(slot, file, opt) {
        if (slot < 0 || slot >= EXTRA_TRACK_COUNT || !file) return;
        if (typeof clearRegionUndoStack === 'function') {
            clearRegionUndoStack();
        }
        setExtraTrackLaneUiOpen(slot, true);
        const tr = extraTrackBySlot(slot);
        const gen = ++tr.loadGen;
        const n = file.size || 0;
        if (n > EXTRA_AUDIO_DECODE_MAX_BYTES) {
            const mb = Math.round((n / (1024 * 1024)) * 10) / 10;
            const limitMb = Math.round(EXTRA_AUDIO_DECODE_MAX_BYTES / (1024 * 1024));
            writeLog('Extra audio ' + (slot + 1) + ': file too large — ' + mb + ' MB');
            if (typeof showAppAlert === 'function') {
                showAppAlert(
                    'Cannot load extra audio',
                    'File size (' +
                        mb +
                        ' MB) exceeds the limit (' +
                        limitMb +
                        ' MB).'
                );
            }
            return;
        }
        const addClipEarly = !!(opt && opt.addClip) && isExtraTrackLoaded(slot);
        setExtraTrackStatus(slot, 'Decoding…');
        let buffer = null;
        try {
            const ab = await file.arrayBuffer();
            if (gen !== tr.loadGen) {
                if (opt && opt.fromSessionRestore) {
                    writeLog('Extra audio ' + (slot + 1) + ': restore aborted (superseded)');
                }
                return;
            }
            if (!ab || ab.byteLength < 1) {
                throw new Error('empty file');
            }
            if (!addClipEarly) {
                cacheExtraTrackPersistBlob(tr, file, ab);
            }
            writeLog(
                'Extra audio ' +
                    (slot + 1) +
                    ': decoding ' +
                    (file.name || 'audio') +
                    ' (' +
                    Math.round(ab.byteLength / 1024) +
                    ' KB)…',
            );
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
            setExtraTrackStatus(slot, 'Decode failed');
            refreshExtraTrackUi(slot);
            if (typeof refreshWaveformCompositeLaneLayout === 'function') {
                refreshWaveformCompositeLaneLayout();
            }
            writeLog(
                'Extra audio ' +
                    (slot + 1) +
                    ': decode failed — ' +
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
        }
        if (opt && opt.fromSessionRestore && typeof setTrackSegments === 'function') {
            const track = { type: 'extra', slot };
            if (Array.isArray(opt.regionSegments) && opt.regionSegments.length) {
                setTrackSegments(track, opt.regionSegments, { silent: true });
                if (
                    Number.isFinite(opt.regionHeadPadSec) ||
                    Number.isFinite(opt.regionTimelineInSec) ||
                    Number.isFinite(opt.regionLeadPadSec)
                ) {
                    const trRestored = extraTrackBySlot(slot);
                    if (trRestored && trRestored.playbackRegions) {
                        if (Number.isFinite(opt.regionHeadPadSec)) {
                            trRestored.playbackRegions.headPadSec = Math.max(
                                0,
                                opt.regionHeadPadSec,
                            );
                        }
                        if (Number.isFinite(opt.regionTimelineInSec)) {
                            trRestored.playbackRegions.regionTimelineInSec = Math.max(
                                0,
                                opt.regionTimelineInSec,
                            );
                        }
                        if (Number.isFinite(opt.regionLeadPadSec)) {
                            trRestored.playbackRegions.regionLeadPadSec = Math.max(
                                0,
                                opt.regionLeadPadSec,
                            );
                        }
                    }
                    if (typeof updateTrackRegionOverlay === 'function') {
                        updateTrackRegionOverlay({ type: 'extra', slot });
                    }
                    drawExtraTrackWaveform(slot);
                }
            } else if (
                Number.isFinite(opt.regionSourceInSec) &&
                Number.isFinite(opt.regionSourceOutSec)
            ) {
                setTrackSegments(
                    track,
                    [
                        {
                            sourceInSec: opt.regionSourceInSec,
                            sourceOutSec: opt.regionSourceOutSec,
                        },
                    ],
                    { silent: true },
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
            setExtraTrackLoaded(slot, true, { skipLayoutRefresh: true });
            refreshExtraTrackUi(slot);
            if (opt && opt.fromSessionRestore) {
                applyExtraSlotMixFromSessionRestore(slot);
            } else {
                removeExtraSlotFromSessionMixRestore(slot);
                applyExtraTrackLaneGain(slot);
                refreshReviewMixUi();
            }
            writeLog(
                'Extra audio ' +
                    (slot + 1) +
                    ': loaded ' +
                    file.name +
                    ' (synced to video head)'
            );
            syncExtraAudioToTransport();
            if (typeof notifyMasterTransportDurationChanged === 'function') {
                notifyMasterTransportDurationChanged();
            }
            schedulePersistExtraTrackSlot(slot);
            if (!(opt && opt.fromSessionRestore) && typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
            scheduleExtraTrackWaveformRedraw(slot, { notifyMaster: true });
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
                    ': loaded but waveform draw failed — ' +
                    (err && err.message ? err.message : String(err))
            );
            refreshExtraTrackUi(slot);
            scheduleExtraTrackWaveformRedraw(slot);
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

    window.hasAnyExtraTrackLoaded = hasAnyExtraTrackLoaded;

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

    window.assignExtraAudioFiles = assignExtraAudioFiles;
    window.assignExtraAudioFilesFromDrop = assignExtraAudioFilesFromDrop;
    window.isBulkOneFilePerTrackDropTarget = isBulkOneFilePerTrackDropTarget;
    window.revealNextExtraTrackLane = revealNextExtraTrackLane;
    window.handleExtraTrackAddShortcutKeydown = handleExtraTrackAddShortcutKeydown;
    window.syncExtraLaneVisibilityAfterSessionRestore =
        syncExtraLaneVisibilityAfterSessionRestore;

    function initExtraAudioTracksUi() {
        videoAudioSoloBtn = document.getElementById('videoAudioSoloBtn');
        videoAudioMuteBtn = document.getElementById('videoAudioMuteBtn');
        if (videoAudioSoloBtn) {
            videoAudioSoloBtn.addEventListener('click', () => toggleVideoSolo());
        }
        if (videoAudioMuteBtn) {
            videoAudioMuteBtn.addEventListener('click', () => toggleVideoMute());
        }
        const videoAddTrackBtn = document.getElementById('videoAudioAddTrackBtn');
        if (videoAddTrackBtn) {
            videoAddTrackBtn.addEventListener('click', () => {
                revealNextExtraTrackLane(-1);
                refreshExtraTrackAddLaneButtons();
            });
        }

        for (let slot = 0; slot < EXTRA_TRACK_COUNT; slot++) {
            const meta = document.getElementById('extraAudioMeta' + slot);
            if (!meta) continue;
            const ui = {
                slot,
                meta,
                track: document.getElementById('extraAudioTrack' + slot),
                canvas: document.getElementById('extraAudioCanvas' + slot),
                status: document.getElementById('extraAudioStatus' + slot),
                title: document.getElementById('extraAudioTitle' + slot),
                fileName: document.getElementById('extraAudioFileName' + slot),
                soloBtn: document.getElementById('extraAudioSoloBtn' + slot),
                muteBtn: document.getElementById('extraAudioMuteBtn' + slot),
                clearBtn: document.getElementById('extraAudioClearBtn' + slot),
                addTrackBtn: document.getElementById('extraAudioAddTrackBtn' + slot),
            };
            extraTrackUi[slot] = ui;
            refreshExtraTrackUi(slot);
            refreshExtraTrackLaneVisibility(slot);

            if (ui.addTrackBtn) {
                ui.addTrackBtn.addEventListener('click', () => {
                    revealNextExtraTrackLane(slot);
                    refreshExtraTrackAddLaneButtons();
                });
            }
            if (ui.clearBtn) {
                ui.clearBtn.addEventListener('click', () => {
                    if (
                        typeof canHideAnyWaveformLane === 'function' &&
                        !canHideAnyWaveformLane()
                    ) {
                        return;
                    }
                    clearExtraTrack(slot);
                    writeLog('Extra audio ' + (slot + 1) + ': cleared');
                });
            }
            if (ui.soloBtn) {
                ui.soloBtn.addEventListener('click', () => toggleExtraSolo(slot));
            }
            if (ui.muteBtn) {
                ui.muteBtn.addEventListener('click', () => toggleExtraMute(slot));
            }
        }

        refreshAllExtraTrackLaneVisibility();
        refreshExtraTrackAddLaneButtons();
        refreshReviewMixUi();
        if (typeof refreshTrackLaneControlsUi === 'function') {
            refreshTrackLaneControlsUi();
        } else if (typeof initTrackLaneControlsUi === 'function') {
            initTrackLaneControlsUi();
        }

        if (typeof ResizeObserver !== 'undefined') {
            const onLaneResize = () => {
                for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
                    if (!isExtraTrackLoaded(i)) continue;
                    rebuildExtraTrackPeaksIfNeeded(i);
                    drawExtraTrackWaveform(i);
                }
            };
            const obs = new ResizeObserver(onLaneResize);
            if (typeof audioWaveformLanesTracks !== 'undefined' && audioWaveformLanesTracks) {
                obs.observe(audioWaveformLanesTracks);
            }
            for (let i = 0; i < EXTRA_TRACK_COUNT; i++) {
                const ui = getExtraUi(i);
                if (ui && ui.track) obs.observe(ui.track);
            }
        }
        refreshVideoAudioLaneFileName();
    }
