/**
 * waveform-region-core-shared.js — 共有定数・モジュール状態
 */
/**
 * waveform-region-core-shared.js — 共有定数・モジュール状態
 */
    const PLAYBACK_REGION_MIN_SEC = 0.05;
    const MIN_CROSSFADE_OVERLAP_SEC =
        typeof window.MIN_CROSSFADE_OVERLAP_SEC === 'number'
            ? window.MIN_CROSSFADE_OVERLAP_SEC
            : 0.005;
    const SEGMENT_BOUNDARY_JOIN_EPS_SEC = 0.002;
    /** 結合境界のクロスフェード幅（分割点の手前のみ、境界以降は伸ばさない） */
    const JOINED_BOUNDARY_CROSSFADE_SEC = 1;
    const REGION_GAIN_DB_MIN = -96;
    const REGION_GAIN_DB_MAX = 10;
    const REGION_PITCH_SEMITONES_MIN = -12;
    const REGION_PITCH_SEMITONES_MAX = 12;
    const regionUndoStack = [];
    const regionRedoStack = [];
    let regionUndoPaused = false;
    let regionUndoDragSnap = null;
    let lastRegionSplitShortcutAtMs = -Infinity;
    const REGION_SPLIT_SHORTCUT_DEDUP_MS = 120;
    let pendingPlaybackRegionRestore = null;
    /** @type {{ slot: number, segment: object } | null} */
    let regionSegmentClipboard = null;
    const regionPersistEpochBySlot = {};
    const regionShrinkPersistIntentUntilBySlot = {};
    const REGION_SHRINK_PERSIST_INTENT_MS = 6000;
