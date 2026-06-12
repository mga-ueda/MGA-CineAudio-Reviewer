/**

 * wave-export-offline-bounce.js — Wave 書き出し専用オフラインバウンス。

 * 再生スケジュール・videoExportAudioInclude・transport には一切触れない（読み取りのみ）。

 */

(function waveExportOfflineBounceModule() {

    const SAMPLE_RATE = 48000;

    const INV_SAMPLE_RATE = 1 / SAMPLE_RATE;

    /** 通常ブロック（mapAllSegmentsAtTransport はブロック中心で1回のみ） */

    const MIX_BLOCK_FRAMES = 2048;

    /** セグメント重なりありトラックは短めブロックでクロスフェード精度を確保 */

    const MIX_BLOCK_FINE_FRAMES = 256;

    const YIELD_EVERY_BLOCKS = 64;



    function readLaneGainForExport(slot, includeExtra) {

        if (!Array.isArray(includeExtra) || !includeExtra[slot]) return 0;

        if (typeof isExtraTrackAudible === 'function' && !isExtraTrackAudible(slot)) {

            return 0;

        }

        const tr = typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;

        if (!tr || !tr.buffer) return 0;

        const linear =

            typeof laneGainLinear === 'function' ? laneGainLinear(tr.volLinear) : tr.volLinear;

        return Math.max(0, Number(linear) || 0);

    }



    function readMasterGain() {

        if (typeof getReviewMixMasterLinearGain !== 'function') return 1;

        return Math.max(0, getReviewMixMasterLinearGain());

    }



    function resolveClipForHit(tr, hit) {

        if (typeof getExtraTrackClip === 'function') {

            const clipId =

                hit && hit.clipId

                    ? hit.clipId

                    : typeof getDefaultExtraClipId === 'function'

                      ? getDefaultExtraClipId()

                      : 'main';

            return getExtraTrackClip(tr, clipId);

        }

        if (typeof getExtraTrackClipBuffer === 'function') {

            const buf = getExtraTrackClipBuffer(tr, hit && hit.clipId);

            return buf ? { buffer: buf } : null;

        }

        return tr && tr.buffer ? { buffer: tr.buffer } : null;

    }



    function pitchSlicePrepTimeoutMs(track, segmentIndex) {

        let durSec = 30;

        if (typeof getTrackSegments === 'function' && typeof getSegmentTimelineEnd === 'function') {

            const segments = getTrackSegments(track);

            const seg = segments[segmentIndex];

            if (seg) {

                const span = Math.max(0, (seg.sourceOutSec || 0) - (seg.sourceInSec || 0));

                durSec = Math.max(span, 0.5);

            }

        }

        return Math.min(300000, Math.max(45000, Math.ceil(durSec * 8000)));

    }



    function awaitWithTimeout(promise, timeoutMs, label) {

        if (!promise || typeof promise.then !== 'function') return Promise.resolve();

        let timer = 0;

        const timeout = new Promise((_, reject) => {

            timer = setTimeout(

                () => reject(new Error((label || 'operation') + ' timed out')),

                Math.max(1000, timeoutMs | 0),

            );

        });

        return Promise.race([promise, timeout]).finally(() => {

            if (timer) clearTimeout(timer);

        });

    }



    function buildSegmentExportPlan(track, tr, segmentIndex) {

        if (typeof getTrackSegments !== 'function') return null;

        const segments = getTrackSegments(track);

        const seg = segments[segmentIndex];

        if (!seg) return null;

        const clip = resolveClipForHit(tr, { clipId: seg.clipId });

        if (!clip || !clip.buffer) return null;



        const playbackStart =

            typeof getSegmentPlaybackTimelineStart === 'function'

                ? getSegmentPlaybackTimelineStart(track, segmentIndex)

                : 0;

        const timelineEnd =

            typeof getSegmentTimelineEnd === 'function'

                ? getSegmentTimelineEnd(track, segmentIndex)

                : playbackStart;

        const pitch =

            typeof getSegmentPitchSemitones === 'function'

                ? getSegmentPitchSemitones(track, segmentIndex)

                : 0;



        const plan = {

            segmentIndex,

            playbackStart,

            timelineEnd,

            pitch,

            sourceInSec: seg.sourceInSec,

            sourceOutSec: seg.sourceOutSec,

            buffer: clip.buffer,

            usesPitchSlice: false,

            legacyPlaybackRate: false,

            pitchRate: 1,

        };



        if (pitch !== 0 && typeof resolveRegionSegmentPlaybackBuffer === 'function') {

            const resolved = resolveRegionSegmentPlaybackBuffer(

                track,

                segmentIndex,

                clip,

                seg.sourceInSec,

            );

            if (resolved && resolved.buffer) {

                plan.buffer = resolved.buffer;

                plan.usesPitchSlice = !!resolved.usesPitchSlice;

                plan.legacyPlaybackRate = !!resolved.legacyPlaybackRate;

                plan.pitchRate = Number.isFinite(resolved.pitchRate) ? resolved.pitchRate : 1;

            }

        }

        return plan;

    }



    function buildTrackExportPlans(track, tr) {

        const plans = new Map();

        if (typeof getTrackSegments !== 'function') return plans;

        const segments = getTrackSegments(track);

        for (let i = 0; i < segments.length; i++) {

            const plan = buildSegmentExportPlan(track, tr, i);

            if (plan) plans.set(i, plan);

        }

        return plans;

    }



    function isExportCancelled() {

        return (

            typeof isWebmExportCancelRequested === 'function' &&

            isWebmExportCancelRequested()

        );

    }



    async function preparePitchSlicesForExport(includeExtra) {

        const n = typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;

        let pendingCount = 0;

        for (let slot = 0; slot < n; slot++) {

            if (!includeExtra[slot]) continue;

            const track = { type: 'extra', slot };

            if (typeof getTrackSegments !== 'function') continue;

            const segments = getTrackSegments(track);

            for (let i = 0; i < segments.length; i++) {

                if (

                    typeof getSegmentPitchSemitones === 'function' &&

                    getSegmentPitchSemitones(track, i) !== 0

                ) {

                    pendingCount += 1;

                }

            }

        }

        if (!pendingCount) return;



        let doneCount = 0;

        for (let slot = 0; slot < n; slot++) {

            if (!includeExtra[slot]) continue;

            if (isExportCancelled()) throw new Error('Export cancelled');

            const track = { type: 'extra', slot };

            if (typeof getTrackSegments !== 'function') continue;

            const segments = getTrackSegments(track);

            for (let i = 0; i < segments.length; i++) {

                if (

                    typeof getSegmentPitchSemitones !== 'function' ||

                    getSegmentPitchSemitones(track, i) === 0 ||

                    typeof schedulePitchSliceRenderForSegment !== 'function'

                ) {

                    continue;

                }

                doneCount += 1;

                if (typeof updateExportBlockingSub === 'function') {

                    updateExportBlockingSub(

                        'Preparing pitch slices… (' + doneCount + '/' + pendingCount + ')',

                    );

                }

                const job = schedulePitchSliceRenderForSegment(track, i);

                if (!job || typeof job.then !== 'function') continue;

                try {

                    await awaitWithTimeout(

                        job,

                        pitchSlicePrepTimeoutMs(track, i),

                        'Pitch slice Ex' + (slot + 1) + ' seg ' + (i + 1),

                    );

                } catch (err) {

                    if (typeof writeLog === 'function') {

                        writeLog(

                            'Export Wave: pitch slice prep skipped — ' +

                                (err && err.message ? err.message : String(err)),

                        );

                    }

                }

                await new Promise((resolve) => setTimeout(resolve, 0));

            }

        }

    }



    function buildSlotMixContexts(includeExtra, masterGain, exportPlansBySlot) {

        const contexts = [];

        const trackCount = typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;

        for (let slot = 0; slot < trackCount; slot++) {

            if (!includeExtra[slot]) continue;

            const tr = typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;

            if (!tr || !tr.buffer) continue;

            const track = { type: 'extra', slot };

            const hasRegion =

                typeof isTrackRegionActive === 'function' && isTrackRegionActive(track);

            const hasOverlap =

                hasRegion &&

                typeof trackHasPlaybackSegmentOverlap === 'function' &&

                trackHasPlaybackSegmentOverlap(track);

            contexts.push({

                slot,

                tr,

                track,

                trackGain: readLaneGainForExport(slot, includeExtra) * masterGain,

                hasRegion,

                hasOverlap,

                slotPlans: exportPlansBySlot.get(slot) || null,

                blockFrames: hasOverlap ? MIX_BLOCK_FINE_FRAMES : MIX_BLOCK_FRAMES,

            });

        }

        return contexts;

    }



    function addInterpolatedSample(outL, outR, fi, ch0, ch1, maxIdx, sourceSec, srcRate, gain) {

        if (!(sourceSec >= 0) || gain < 1e-12) return;

        const pos = sourceSec * srcRate;

        if (pos > maxIdx) return;

        const i0 = pos < 0 ? 0 : Math.min(maxIdx, pos | 0);

        const i1 = i0 < maxIdx ? i0 + 1 : i0;

        const frac = pos - i0;

        const oml = 1 - frac;

        outL[fi] += (ch0[i0] * oml + ch0[i1] * frac) * gain;

        outR[fi] += (ch1[i0] * oml + ch1[i1] * frac) * gain;

    }



    function resolveReadSecForPlan(plan, track, t) {

        if (plan.pitch !== 0 && plan.usesPitchSlice) {

            return t - plan.playbackStart;

        }

        if (

            plan.pitch !== 0 &&

            plan.legacyPlaybackRate &&

            Math.abs((plan.pitchRate || 1) - 1) > 0.0001

        ) {

            const local = Math.max(0, t - plan.playbackStart);

            return Math.min(

                plan.buffer.duration - 0.0005,

                plan.sourceInSec + local * plan.pitchRate,

            );

        }

        if (typeof segmentSourceSecFromTransport === 'function') {

            return segmentSourceSecFromTransport(track, plan.segmentIndex, t);

        }

        return null;

    }



    function computeCrossfadeGainsForHits(track, hits, t) {

        if (!hits || hits.length <= 1) return new Map();

        if (typeof computeEqualPowerCrossfadeGainsForGroup !== 'function') {

            return new Map();

        }

        return computeEqualPowerCrossfadeGainsForGroup(hits, t, {

            groupBySlot: false,

            sameSlotOnly: false,

            trackRefFromHit: () => track,

        });

    }



    function computeHitGainAtTime(track, hits, cfGains, hit, t) {

        const cf = cfGains.get(hit.key) ?? 1;

        if (typeof segmentPlaybackGainLinear === 'function') {

            return segmentPlaybackGainLinear(hit, cf, t);

        }

        if (typeof getSegmentPlaybackGainLinear === 'function') {

            return cf * getSegmentPlaybackGainLinear(track, hit.segmentIndex, t);

        }

        return cf;

    }



    function mixFullTrackBlock(outL, outR, ctx, frameStart, frameCount) {

        const tr = ctx.tr;

        const buf = tr.buffer;

        if (!buf || !(buf.duration > 0)) return;

        const timelineStart =

            typeof getExtraTrackTimelineStartSec === 'function'

                ? getExtraTrackTimelineStartSec(ctx.slot)

                : 0;

        const srcRate = buf.sampleRate;

        const ch0 = buf.getChannelData(0);

        const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;

        const maxIdx = buf.length - 1;

        const gain = ctx.trackGain;

        const endSec = buf.duration;

        for (let i = 0; i < frameCount; i++) {

            const sourceSec = (frameStart + i) * INV_SAMPLE_RATE - timelineStart;

            if (sourceSec < 0 || sourceSec >= endSec) continue;

            addInterpolatedSample(outL, outR, frameStart + i, ch0, ch1, maxIdx, sourceSec, srcRate, gain);

        }

    }



    function mixRegionBlock(outL, outR, ctx, frameStart, frameCount) {

        const track = ctx.track;

        const tr = ctx.tr;

        const slotPlans = ctx.slotPlans;

        const tCenter = (frameStart + frameCount * 0.5) * INV_SAMPLE_RATE;

        const hits =

            typeof mapAllSegmentsAtTransport === 'function'

                ? mapAllSegmentsAtTransport(track, tCenter, { forPlayback: true })

                : [];

        if (!hits.length) return;



        const cfGains = computeCrossfadeGainsForHits(track, hits, tCenter);

        const usePerSampleGain = ctx.hasOverlap || hits.length > 1;



        for (let hi = 0; hi < hits.length; hi++) {

            const hit = hits[hi];

            const plan = slotPlans ? slotPlans.get(hit.segmentIndex) : null;

            if (!plan || !plan.buffer) continue;



            const buf = plan.buffer;

            const srcRate = buf.sampleRate;

            const ch0 = buf.getChannelData(0);

            const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;

            const maxIdx = buf.length - 1;



            if (!usePerSampleGain) {

                const gain = computeHitGainAtTime(track, hits, cfGains, hit, tCenter) * ctx.trackGain;

                if (gain < 1e-12) continue;

                for (let i = 0; i < frameCount; i++) {

                    const fi = frameStart + i;

                    const readSec = resolveReadSecForPlan(plan, track, fi * INV_SAMPLE_RATE);

                    if (readSec == null || readSec < 0) continue;

                    addInterpolatedSample(outL, outR, fi, ch0, ch1, maxIdx, readSec, srcRate, gain);

                }

                continue;

            }



            for (let i = 0; i < frameCount; i++) {

                const fi = frameStart + i;

                const t = fi * INV_SAMPLE_RATE;

                const gain = computeHitGainAtTime(track, hits, cfGains, hit, t) * ctx.trackGain;

                if (gain < 1e-12) continue;

                const readSec = resolveReadSecForPlan(plan, track, t);

                if (readSec == null || readSec < 0) continue;

                addInterpolatedSample(outL, outR, fi, ch0, ch1, maxIdx, readSec, srcRate, gain);

            }

        }

    }



    function buildExportPlansBySlot(includeExtra) {

        const plansBySlot = new Map();

        const trackCount = typeof getExtraTrackCount === 'function' ? getExtraTrackCount() : 0;

        for (let slot = 0; slot < trackCount; slot++) {

            if (!includeExtra[slot]) continue;

            const tr = typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;

            if (!tr || !tr.buffer) continue;

            const track = { type: 'extra', slot };

            if (typeof isTrackRegionActive === 'function' && isTrackRegionActive(track)) {

                plansBySlot.set(slot, buildTrackExportPlans(track, tr));

            }

        }

        return plansBySlot;

    }



    /**

     * @param {{ exportMedia: object, durationSec?: number, onProgress?: function }} opt

     * @returns {Promise<{ blob: Blob, sampleRate: number, durationSec: number }>}

     */

    async function bounceReviewMixOffline(opt) {

        const exportMedia =

            opt && opt.exportMedia

                ? opt.exportMedia

                : typeof getExportMediaOptionsFromUi === 'function'

                  ? getExportMediaOptionsFromUi()

                  : null;

        if (!exportMedia || !exportMedia.includeAudio) {

            throw new Error('Audio must be included in export');

        }

        const includeExtra = Array.isArray(exportMedia.includeExtra)

            ? exportMedia.includeExtra

            : [];

        if (!includeExtra.some(Boolean)) {

            throw new Error('No audio tracks selected for export');

        }



        const durationSec =

            opt && Number.isFinite(opt.durationSec) && opt.durationSec > 0

                ? opt.durationSec

                : typeof getVideoExportDurationSec === 'function'

                  ? getVideoExportDurationSec()

                  : 0;

        if (!durationSec || durationSec <= 0) {

            throw new Error('Could not determine audio duration');

        }



        if (typeof updateExportBlockingSub === 'function') {

            updateExportBlockingSub('Preparing offline bounce…');

        }

        await preparePitchSlicesForExport(includeExtra);

        if (isExportCancelled()) throw new Error('Export cancelled');



        const exportPlansBySlot = buildExportPlansBySlot(includeExtra);

        const masterGain = readMasterGain();

        const slotContexts = buildSlotMixContexts(includeExtra, masterGain, exportPlansBySlot);



        const totalFrames = Math.ceil(durationSec * SAMPLE_RATE);

        const left = new Float32Array(totalFrames);

        const right = new Float32Array(totalFrames);

        const onProgress = opt && typeof opt.onProgress === 'function' ? opt.onProgress : null;



        let blockIndex = 0;

        let frame = 0;

        while (frame < totalFrames) {

            if (isExportCancelled()) throw new Error('Export cancelled');



            let blockLen = MIX_BLOCK_FRAMES;

            for (let ci = 0; ci < slotContexts.length; ci++) {

                if (slotContexts[ci].blockFrames < blockLen) {

                    blockLen = slotContexts[ci].blockFrames;

                }

            }

            blockLen = Math.min(blockLen, totalFrames - frame);



            for (let ci = 0; ci < slotContexts.length; ci++) {

                const ctx = slotContexts[ci];

                if (ctx.trackGain <= 0) continue;

                if (ctx.hasRegion) {

                    mixRegionBlock(left, right, ctx, frame, blockLen);

                } else {

                    mixFullTrackBlock(left, right, ctx, frame, blockLen);

                }

            }



            frame += blockLen;

            blockIndex += 1;

            const doneSec = frame * INV_SAMPLE_RATE;

            if (onProgress) onProgress(doneSec, durationSec);

            if (

                blockIndex % YIELD_EVERY_BLOCKS === 0 &&

                typeof updateExportBlockingSub === 'function' &&

                typeof formatMediaExportProgressSub === 'function'

            ) {

                updateExportBlockingSub(

                    formatMediaExportProgressSub(Math.min(doneSec, durationSec), durationSec, 'wave'),

                );

                await new Promise((resolve) => setTimeout(resolve, 0));

            }

        }



        if (typeof encodeStereoWavBlob !== 'function') {

            throw new Error('WAV encoder unavailable');

        }

        if (typeof updateExportBlockingSub === 'function') {

            updateExportBlockingSub('Encoding WAV…');

        }

        const blob = encodeStereoWavBlob(left, right, SAMPLE_RATE);

        if (!blob || !blob.size) {

            throw new Error('No bounced audio data');

        }

        let outBlob = blob;
        if (typeof finalizeWaveExportBlobWithMarkers === 'function') {
            outBlob = await finalizeWaveExportBlobWithMarkers(
                blob,
                SAMPLE_RATE,
                totalFrames,
                opt && opt.markers,
            );
        }

        return { blob: outBlob, sampleRate: SAMPLE_RATE, durationSec };

    }



    window.bounceReviewMixOffline = bounceReviewMixOffline;

})();


