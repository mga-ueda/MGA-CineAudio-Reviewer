/**
 * extra-audio-state.js — Ex トラック状態・クリップ・セグメントゲイン補助。
 */
    EXTRA_TRACK_COUNT = getExtraTrackCount();
    /**
     * false = 動画は video 要素のネイティブ出力（確実に聴ける）。
     * アナライザー／トラックメーターは captureStream タップ（ensureReviewMixVideoMonitorTap）。
     * true にすると MediaElementSource 経由（環境によっては接続後も無音になる）。
     */
    function getExtraTrackNumberPrefix(slot) {
        return slot + 1 + '.';
    }

    function getExtraTrackFileName(tr) {
        if (!tr) return '';
        if (tr.file && tr.file.name) return String(tr.file.name);
        if (Array.isArray(tr.clips)) {
            for (let i = 0; i < tr.clips.length; i++) {
                const c = tr.clips[i];
                if (!c) continue;
                const n = (c.file && c.file.name) || c.name || '';
                if (n) return String(n);
            }
        }
        return '';
    }

    function getExtraTrackDisplayLabel(slot, trOpt) {
        const tr = trOpt !== undefined ? trOpt : extraTrackBySlot(slot);
        const prefix = getExtraTrackNumberPrefix(slot);
        const name = getExtraTrackFileName(tr);
        return name ? prefix + ' ' + name : prefix;
    }

    function buildTrackTitleTooltip(label, file, statusText) {
        const parts = [label || ''];
        if (file && file.name) {
            const fn = String(file.name);
            if (!label || !label.includes(fn)) {
                parts.push(fn);
            }
            if (file.size > 0 && typeof formatByteSize === 'function') {
                const sz = formatByteSize(file.size);
                if (sz) parts.push(sz);
            }
        }
        const tip =
            typeof laneStatusTooltip === 'function' ? laneStatusTooltip(statusText) : '';
        if (tip) parts.push(tip);
        return parts.filter((p) => !!p).join(' — ');
    }

    /** クリアで閉じる／新規動画・ドロップで開く空き Ex レーン枠 */
    extraTrackUi = [];
    extraLaneUiOpen = Array.from({ length: EXTRA_TRACK_COUNT }, () => false);
    function createEmptyExtraTrackState() {
        return {
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
        };
    }
    extraTracks = Array.from({ length: EXTRA_TRACK_COUNT }, () =>
        createEmptyExtraTrackState(),
    );

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
        if (typeof ensureClipBackupState === 'function') {
            for (let ci = 0; ci < tr.clips.length; ci++) {
                ensureClipBackupState(tr.clips[ci]);
            }
        }
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
