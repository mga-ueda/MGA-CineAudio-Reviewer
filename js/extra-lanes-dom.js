/**
 * Ex 音声レーンのサイドバー・波形を EXTRA_TRACK_COUNT 分生成する。
 * dom-refs / app-runtime 直後、他スクリプトより先に同期実行する。
 */
(function buildExtraLanesDom() {
    const count = getExtraTrackCount();

    function buildExtraLaneMeta(slot) {
        const n = slot + 1;
        const isLast = slot >= count - 1;
        const addAttrs = isLast ? ' hidden disabled' : '';
        const wrap = document.createElement('div');
        wrap.className = 'audio-waveform-lane-meta audio-waveform-lane-meta--extra';
        wrap.id = 'extraAudioMeta' + slot;
        wrap.hidden = true;
        wrap.innerHTML =
            '<div class="audio-waveform-lane-meta__row">' +
            '<span class="audio-waveform-lane-meta__title" id="extraAudioTitle' +
            slot +
            '">Ex ' +
            n +
            ' Track</span>' +
            '<div class="track-mix-actions">' +
            '<button type="button" class="track-mix-btn track-mix-btn--solo" id="extraAudioSoloBtn' +
            slot +
            '" disabled title="Solo（このレーンのみ再生）" aria-pressed="false">S</button>' +
            '<button type="button" class="track-mix-btn track-mix-btn--mute" id="extraAudioMuteBtn' +
            slot +
            '" disabled title="Mute（このレーンをミュート）" aria-pressed="false">M</button>' +
            '<button type="button" class="track-mix-btn track-mix-btn--clear" id="extraAudioClearBtn' +
            slot +
            '" title="Clear（レーンを非表示）">×</button>' +
            '</div></div>' +
            '<div class="track-lane-controls">' +
            '<div class="track-lane-meter-row">' +
            '<div class="track-lane-meter" aria-hidden="true">' +
            '<div class="track-lane-meter__bar" id="trackLaneMeter' +
            slot +
            '"></div></div>' +
            '<span class="track-lane-meter-db" id="trackLaneMeterDb' +
            slot +
            '" aria-hidden="true">-96.0 dB</span></div>' +
            '<div class="track-lane-fader-row">' +
            '<input type="range" class="track-lane-fader" id="trackLaneFader' +
            slot +
            '" min="0" max="1000" step="1" value="828" disabled aria-label="Extra audio ' +
            n +
            ' volume" title="Ex ' +
            n +
            ' volume を調整">' +
            '<span class="track-lane-fader-db" id="trackLaneFaderDb' +
            slot +
            '">0.0 dB</span></div></div>' +
            '<span class="audio-waveform-lane-meta__status" id="extraAudioStatus' +
            slot +
            '" hidden></span>' +
            '<div class="track-lane-bottom-actions">' +
            '<button type="button" class="track-lane-move-btn" id="extraAudioMoveUpBtn' +
            slot +
            '" title="このトラックを上へ移動" aria-label="Move this track up">▲</button>' +
            '<button type="button" class="track-lane-move-btn" id="extraAudioMoveDownBtn' +
            slot +
            '" title="このトラックを下へ移動" aria-label="Move this track down">▼</button>' +
            '<button type="button" class="track-lane-add-btn" id="extraAudioAddTrackBtn' +
            slot +
            '" title="次の extra audio track を表示"' +
            addAttrs +
            '>+ Add Track</button>' +
            '</div>';
        return wrap;
    }

    function buildExtraLaneTrack(slot) {
        const wrap = document.createElement('div');
        wrap.className = 'audio-waveform-lane audio-waveform-lane--extra';
        wrap.id = 'extraAudioLane' + slot;
        wrap.hidden = true;
        wrap.innerHTML =
            '<div class="audio-waveform-lane__track" id="extraAudioTrack' +
            slot +
            '" title="追加音声（波形枠へドロップして読み込み）">' +
            '<div class="audio-waveform-lane__track-bg" aria-hidden="true"></div>' +
            '<canvas id="extraAudioCanvas' +
            slot +
            '" class="audio-waveform-lane__canvas" aria-hidden="true"></canvas>' +
            '<span class="audio-waveform-lane__file-name" id="extraAudioFileName' +
            slot +
            '" hidden aria-hidden="true"></span>' +
            '<div class="audio-waveform-lane__content-end" id="extraAudioContentEnd' +
            slot +
            '" hidden aria-hidden="true"></div></div>' +
            '<div class="audio-waveform-lane__playback-regions" data-track="extra:' +
            slot +
            '" hidden aria-hidden="true"></div>';
        return wrap;
    }

    const metaMount = document.getElementById('extraLaneMetaMount');
    if (metaMount) {
        const frag = document.createDocumentFragment();
        for (let slot = 0; slot < count; slot++) {
            frag.appendChild(buildExtraLaneMeta(slot));
        }
        metaMount.replaceWith(frag);
    }

    const tracksMount = document.getElementById('extraLaneTracksMount');
    if (tracksMount) {
        const frag = document.createDocumentFragment();
        for (let slot = 0; slot < count; slot++) {
            frag.appendChild(buildExtraLaneTrack(slot));
        }
        tracksMount.replaceWith(frag);
    }

})();
