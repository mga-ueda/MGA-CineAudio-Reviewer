/**
 * extra-audio-init.js — initExtraAudioTracksUi と DOM バインド。
 */
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
                soloBtn: document.getElementById('extraAudioSoloBtn' + slot),
                muteBtn: document.getElementById('extraAudioMuteBtn' + slot),
                clearBtn: document.getElementById('extraAudioClearBtn' + slot),
                moveUpBtn: document.getElementById('extraAudioMoveUpBtn' + slot),
                moveDownBtn: document.getElementById('extraAudioMoveDownBtn' + slot),
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
                    if (typeof logExAudioAction === 'function') {
                        logExAudioAction(formatExTrack(slot) + ' cleared');
                    } else {
                        writeLog('Extra audio ' + (slot + 1) + ': cleared');
                    }
                });
            }
            if (ui.moveUpBtn) {
                ui.moveUpBtn.addEventListener('click', () => {
                    moveExtraTrackSlot(slot, -1);
                    refreshExtraTrackAddLaneButtons();
                });
            }
            if (ui.moveDownBtn) {
                ui.moveDownBtn.addEventListener('click', () => {
                    moveExtraTrackSlot(slot, 1);
                    refreshExtraTrackAddLaneButtons();
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
    }
