/**
 * waveform-region-render-canvas.js — Ex レーン波形キャンバス描画
 */
    function drawContinuousSegmentChainOverview(
        ctx,
        track,
        slot,
        wCss,
        hCss,
        mid,
        grad,
        vp,
        segments,
    ) {
        if (!trackSegmentsAreContinuousSameClipChain(track)) return false;
        for (let i = 0; i < segments.length; i++) {
            if (segmentHasViewportPeaksForDraw(vp, i)) return false;
        }
        const clipId = segments[0].clipId || getSegmentClipId(track, 0);
        const fullDur = getSegmentSourceDurationSec(track, segments[0]);
        const peaks = getSegmentPeaksForDraw(slot, clipId);
        if (!peaks || !peaks.length || !fullDur) return false;

        const chainStart = getSegmentTimelineStart(track, 0);
        const chainEnd = getSegmentTimelineEnd(track, segments.length - 1);
        const chainDur = chainEnd - chainStart;
        if (!(chainDur > 0.0005)) return false;

        const srcIn = segments[0].sourceInSec;
        const srcOut = segments[segments.length - 1].sourceOutSec;
        const chainPeaks = slicePeaksForRegion(peaks, fullDur, srcIn, srcOut);
        if (!chainPeaks || !chainPeaks.length) return false;

        const startX =
            typeof masterTimelineContentWidth === 'function'
                ? masterTimelineContentWidth(wCss, chainStart)
                : 0;
        const contentW =
            typeof masterTimelineContentWidth === 'function'
                ? masterTimelineContentWidth(wCss, chainDur)
                : wCss;
        const drawW = contentW > 0 ? contentW : wCss;
        const barW = drawW / chainPeaks.length;

        ctx.fillStyle = grad || '#ffffff';
        for (let p = 0; p < chainPeaks.length; p++) {
            const pk = chainPeaks[p];
            const x = startX + p * barW;
            const barTransport =
                chainStart + ((p + 0.5) / chainPeaks.length) * chainDur;
            const segIdx = segmentIndexAtMasterTransport(track, barTransport);
            const hideBefore = getSegmentWaveformHideBeforeTimeline(track, segIdx);
            if (barTransport < hideBefore - 0.0005) continue;
            if (viewportPeaksCoverMasterTime(vp, barTransport)) continue;
            drawWaveformBarAtTransport(
                ctx,
                track,
                slot,
                x,
                barW,
                mid,
                barTransport,
                pk,
                segIdx,
                vp ? { viewportPeaks: vp } : null,
            );
        }
        return true;
    }

    function drawExtraTrackWaveformRegions(ctx, wCss, hCss, slot, grad, drawOpt) {
        const track = { type: 'extra', slot };
        const tr =
            typeof extraTrackBySlot === 'function' ? extraTrackBySlot(slot) : null;
        const o = drawOpt && typeof drawOpt === 'object' ? drawOpt : {};
        const scrubOverview = !!o.scrubOverview;
        const scrubRedraw = !!o.scrubRedraw;
        const vpOverlay = scrubOverview ? null : tr ? tr.viewportPeaks : null;
        const vpSkip = scrubOverview || scrubRedraw ? null : vpOverlay;
        const t0 = getTrackTimelineStartSec(track);
        const layoutW = Number.isFinite(o.timelineLayoutW) && o.timelineLayoutW > 0
            ? o.timelineLayoutW
            : wCss;
        const xOffset = Number.isFinite(o.timelineXOffset) ? o.timelineXOffset : 0;
        const state = getPlaybackRegionsState(track);
        const hasConfiguredRegions =
            state &&
            state.active &&
            Array.isArray(state.segments) &&
            state.segments.length > 0;
        const segments = getTrackSegments(track);
        const mid = hCss * 0.5;
        const master =
            typeof getMasterTransportDurationSec === 'function'
                ? getMasterTransportDurationSec()
                : 0;

        ctx.clearRect(0, 0, wCss, hCss);
        ctx.fillStyle =
            typeof TIMELINE_LANE_TRACK_BG !== 'undefined'
                ? TIMELINE_LANE_TRACK_BG
                : '#161820';
        ctx.fillRect(0, 0, wCss, hCss);

        ctx.save();
        if (xOffset) ctx.translate(-xOffset, 0);

        if (!segments.length) {
            if (hasConfiguredRegions) {
                if (tr) {
                    tr.viewportPeaks = null;
                    vp = null;
                }
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(xOffset, mid);
                ctx.lineTo(xOffset + wCss, mid);
                ctx.stroke();
                ctx.restore();
                return;
            }
            const fullDur = getTrackSourceDurationSec(track);
            const peaks =
                scrubOverview && o.scrubOverviewPeaks && o.scrubOverviewPeaks.length
                    ? o.scrubOverviewPeaks
                    : tr
                      ? tr.peaks
                      : null;
            if (!peaks || !peaks.length || !fullDur) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(xOffset, mid);
                ctx.lineTo(xOffset + wCss, mid);
                ctx.stroke();
                ctx.restore();
                return;
            }
            if (typeof drawPeaksForMasterTimeline === 'function') {
                const peakDrawOpt = Object.assign({ timelineStartSec: t0 }, o);
                if (!scrubOverview) {
                    if (vpOverlay && vpOverlay.segments && vpOverlay.segments.length === 1) {
                        peakDrawOpt.viewportPeaks = vpOverlay.segments[0];
                    } else if (vpOverlay && vpOverlay.peaks) {
                        peakDrawOpt.viewportPeaks = vpOverlay;
                    } else if (vpOverlay && vpOverlay.tiles) {
                        peakDrawOpt.viewportPeaks = vpOverlay;
                    }
                }
                ctx.restore();
                drawPeaksForMasterTimeline(ctx, peaks, wCss, hCss, fullDur, grad, peakDrawOpt);
                return;
            }
            ctx.restore();
            return;
        }

        if (
            scrubOverview &&
            o.scrubOverviewPeaks &&
            o.scrubOverviewPeaks.length &&
            segments.length &&
            typeof drawPeaksForMasterTimeline === 'function'
        ) {
            const fullDur = getTrackSourceDurationSec(track);
            if (fullDur > 0) {
                const underlayOpt = Object.assign({ timelineStartSec: t0 }, o);
                delete underlayOpt.viewportPeaks;
                delete underlayOpt.scrubOverview;
                ctx.restore();
                drawPeaksForMasterTimeline(
                    ctx,
                    o.scrubOverviewPeaks,
                    wCss,
                    hCss,
                    fullDur,
                    grad,
                    underlayOpt,
                );
                ctx.save();
                if (xOffset) ctx.translate(-xOffset, 0);
            }
            drawRegionViewportPeaks(ctx, layoutW, hCss, master, vpOverlay, grad, track, o);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(xOffset, mid);
            ctx.lineTo(xOffset + wCss, mid);
            ctx.stroke();
            if (typeof drawTimelineVideoEndMarkerLine === 'function') {
                drawTimelineVideoEndMarkerLine(ctx, layoutW, hCss, o);
            }
            ctx.restore();
            return;
        }

        ctx.fillStyle = grad || '#ffffff';
        const chainOverviewDrawn = drawContinuousSegmentChainOverview(
            ctx,
            track,
            slot,
            layoutW,
            hCss,
            mid,
            grad,
            vpSkip,
            segments,
        );
        if (!chainOverviewDrawn) {
            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                const clipId = seg.clipId || getSegmentClipId(track, i);
                const fullDur = getSegmentSourceDurationSec(track, seg);
                if (segmentHasViewportPeaksForDraw(vpSkip, i)) continue;

                const peaks = getSegmentPeaksForDraw(slot, clipId);
                if (!peaks || !peaks.length || !fullDur) continue;
                const segPeaks = slicePeaksForRegion(
                    peaks,
                    fullDur,
                    seg.sourceInSec,
                    seg.sourceOutSec,
                );
                if (!segPeaks || !segPeaks.length) continue;
                const segT0 = getSegmentTimelineStart(track, i);
                const contentDur = seg.sourceOutSec - seg.sourceInSec;
                if (!(contentDur > 0.0005)) continue;
                const startX =
                    typeof masterTimelineContentWidth === 'function'
                        ? masterTimelineContentWidth(layoutW, segT0)
                        : 0;
                const contentW =
                    typeof masterTimelineContentWidth === 'function'
                        ? masterTimelineContentWidth(layoutW, contentDur)
                        : layoutW;
                const drawW = contentW > 0 ? contentW : layoutW;
                const barW = drawW / segPeaks.length;
                const waveformHideBefore = getSegmentWaveformHideBeforeTimeline(track, i);
                for (let p = 0; p < segPeaks.length; p++) {
                    const barTransport =
                        segT0 + ((p + 0.5) / segPeaks.length) * contentDur;
                    if (barTransport < waveformHideBefore - 0.0005) {
                        continue;
                    }
                    const x =
                        typeof masterTimelineContentWidth === 'function'
                            ? masterTimelineContentWidth(layoutW, barTransport) - barW * 0.5
                            : startX + p * barW;
                    if (viewportPeaksCoverMasterTime(vpSkip, barTransport)) {
                        continue;
                    }
                    drawWaveformBarAtTransport(
                        ctx,
                        track,
                        slot,
                        x,
                        barW,
                        mid,
                        barTransport,
                        segPeaks[p],
                        i,
                        vpSkip ? { viewportPeaks: vpSkip } : null,
                    );
                }
            }
        }

        drawRegionViewportPeaks(ctx, layoutW, hCss, master, vpOverlay, grad, track, o);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xOffset, mid);
        ctx.lineTo(xOffset + wCss, mid);
        ctx.stroke();
        if (typeof drawTimelineVideoEndMarkerLine === 'function') {
            drawTimelineVideoEndMarkerLine(ctx, layoutW, hCss, o);
        }
        ctx.restore();
    }
