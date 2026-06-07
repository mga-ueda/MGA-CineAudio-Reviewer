/**
 * extra-audio-shared.js — Ex 音声モジュールの共有状態（分割スクリプト間で参照）。
 */
    var EXTRA_TRACK_COUNT;
    var VIDEO_AUDIO_SLOT_LABEL = 'Video Audio';
    var ROUTE_VIDEO_AUDIO_VIA_WEB_AUDIO = false;
    var EXTRA_AUDIO_DECODE_MAX_BYTES = 1024 * 1024 * 1024;
    var EXTRA_AUDIO_DECODE_TIMEOUT_MS = 90000;
    var EXTRA_WAVEFORM_LAYOUT_MIN_CSS = 32;
    var extraWaveformEnsureGen = 0;
    var EXTRA_AUDIO_SCHEDULE_AHEAD_SEC = 0.02;
    var EXTRA_AUDIO_SEGMENT_ADD_AHEAD_SEC = 0.003;
    /** BufferSource 終了をトランスポート壁時計のわずかな先行に合わせる余裕 */
    var EXTRA_AUDIO_SEGMENT_DURATION_PAD_SEC = 0.08;
    /** onended 後に再開する最小 remain（これ未満はビビビッ連打の原因になる） */
    var EXTRA_AUDIO_SEGMENT_MIN_CONTINUE_REMAIN_SEC = 0.04;
    var EXTRA_AUDIO_RESYNC_DRIFT_SEC = 0.045;
    var extraTrackUi;
    var extraLaneUiOpen;
    var extraTracks;
    var videoMix = { muted: false, solo: false, volLinear: 1 };
    var videoExportAudioInclude = null;
    var sessionMixRestore = null;
    var reviewMixCtx = null;
    var reviewMixMaster = null;
    var videoMediaSrc = null;
    var videoGainNode = null;
    var videoAnalyser = null;
    var reviewMixVideoWired = false;
    var reviewMixVideoWireFailed = false;
    var reviewMixVideoBoostPlayback = false;
    var reviewMixVideoBoostLogged = false;
    var videoMonitorStream = null;
    var videoMonitorStreamSrc = null;
    var videoMonitorSinkGain = null;
    /** 明示シーク後に captureStream タップを一度だけ張り直す */
    var reviewMixVideoMonitorTapStale = false;
    /** captureStream に音声トラックがまだ無いときのモニタータップ再試行 */
    var reviewMixVideoMonitorTapRetryTimer = 0;
    var reviewMixVideoMonitorTapRetryCount = 0;
    var reviewMixVideoMonitorTapMediaRetryArmed = false;
    /** 再生開始時 captureStream を張り直した URL（未設定なら playing で再取得） */
    var reviewMixVideoMonitorTapPrimedUrl = '';
    var nativeVideoMixModeLogged = false;
    var extraMixScheduleCtxTime = 0;
    var videoAudioSoloBtn = null;
    var videoAudioMuteBtn = null;
