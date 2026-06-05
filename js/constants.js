/**
 * constants.js — 共有定数（Ex トラック数・IndexedDB・localStorage キー・FPS・ログ上限）。
 */
    /** 共有グローバル（extra-audio-tracks.js で const 再宣言しない） */
    window.EXTRA_TRACK_COUNT = 16;

    const LS_PREFS_KEY = 'cineaudio_reviewer_prefs_v1';
    const IDB_NAME = 'cineaudio_reviewer_session_v1';
    const IDB_STORE = 'kv';
    const IDB_KEY_LAST = 'lastSession';
    const IDB_VER = 1;
    const DISPLAY_FPS = 60;
    const LOG_MAX_LINES = 500;
