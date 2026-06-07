/**
 * Phase 3: large-file splits (render / core / io / extra-audio).
 * Anchor-based — DO NOT RE-RUN if splits already applied (musical-grid was re-merged; IIFE cannot span files).
 * Run: node scripts/refactor-split-phase3.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');

function readLines(file) {
    return fs.readFileSync(path.join(JS, file), 'utf8').split(/\r?\n/);
}

function writeFile(file, lines) {
    fs.writeFileSync(path.join(JS, file), lines.join('\n') + '\n', 'utf8');
}

function findFunctionLine(lines, name, fromIndex = 0) {
    const re = new RegExp(`^\\s*function ${name}\\b`);
    for (let i = fromIndex; i < lines.length; i++) {
        if (re.test(lines[i])) return i;
    }
    return -1;
}

function findHeaderEnd(lines) {
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
        if (lines[i].includes('*/')) return i + 1;
    }
    return 0;
}

function findLineContaining(lines, text, fromIndex = 0) {
    for (let i = fromIndex; i < lines.length; i++) {
        if (lines[i].includes(text)) return i;
    }
    return -1;
}

function extractFromLine(lines, startIdx, endIdx) {
    return lines.slice(startIdx, endIdx);
}

function removeLineIndices(lines, indicesSet) {
    return lines.filter((_, i) => !indicesSet.has(i));
}

function indicesForRanges(lines, ranges) {
    const set = new Set();
    for (const [start, end] of ranges) {
        for (let i = start; i < end && i < lines.length; i++) set.add(i);
    }
    return set;
}

function makeModule(header, bodyLines, extraLines = []) {
    return [header, ...bodyLines, ...extraLines].filter((l) => l !== undefined);
}

function insertScriptAfter(html, afterSrc, newSrc) {
    if (html.includes(newSrc)) return html;
    const needle = `    <script src="js/${afterSrc}"></script>\n`;
    const insert = `${needle}    <script src="js/${newSrc}"></script>\n`;
    return html.replace(needle, insert);
}

function splitByAnchors(sourceFile, parts, opts = {}) {
    const lines = readLines(sourceFile);
    const headerEnd = findHeaderEnd(lines);
    const removeSet = new Set();

    for (const part of parts) {
        const chunks = [];
        for (const anchor of part.anchors) {
            let startIdx;
            if (anchor.startLineContains) {
                startIdx = findLineContaining(lines, anchor.startLineContains);
            } else {
                startIdx = findFunctionLine(lines, anchor.start);
            }
            if (startIdx < 0) {
                throw new Error(`${sourceFile}: anchor "${anchor.start || anchor.startLineContains}" not found`);
            }
            let endIdx = lines.length;
            if (anchor.endBefore) {
                for (const name of anchor.endBefore) {
                    const idx = findFunctionLine(lines, name, startIdx + 1);
                    if (idx >= 0 && idx < endIdx) endIdx = idx;
                }
            } else if (anchor.endLineContains) {
                const idx = findLineContaining(lines, anchor.endLineContains, startIdx + 1);
                if (idx >= 0) endIdx = idx;
            }
            chunks.push(...lines.slice(startIdx, endIdx));
            for (let i = startIdx; i < endIdx; i++) removeSet.add(i);
        }
        const moduleLines = makeModule(part.header, chunks, part.footer || []);
        writeFile(part.out, moduleLines);
        console.log(`Created ${part.out} (${moduleLines.length} lines)`);
    }

    if (opts.keepStub) {
        const stub = [
            `/**`,
            ` * ${sourceFile} — slim stub (split into submodules)`,
            ` */`,
        ];
        writeFile(sourceFile, stub);
    } else {
        const kept = removeLineIndices(lines, removeSet);
        const trimmed = kept.slice(0, headerEnd).concat(
            kept.slice(headerEnd).filter((l) => l.trim() !== ''),
        );
        if (trimmed.length <= headerEnd + 1) {
            fs.unlinkSync(path.join(JS, sourceFile));
            console.log(`Removed empty ${sourceFile}`);
        } else {
            writeFile(sourceFile, trimmed);
            console.log(`Slimmed ${sourceFile} (${trimmed.length} lines)`);
        }
    }
    return [];
}

// --- 1. waveform-region-render.js ---
{
    const renderParts = [
        {
            out: 'waveform-region-render-meta.js',
            header:
                '/**\n * waveform-region-render-meta.js — 練習番号・フェード三角・dense 境界表示\n */',
            anchors: [
                {
                    startLineContains: 'const REGION_OVERLAY_NARROW_PX',
                    endBefore: ['drawContinuousSegmentChainOverview'],
                },
            ],
        },
        {
            out: 'waveform-region-render-segments.js',
            header:
                '/**\n * waveform-region-render-segments.js — 描画・分割・コピー・overlay 構築\n */',
            anchors: [
                { start: 'drawContinuousSegmentChainOverview', endBefore: ['getWaveformLanesEl'] },
                { start: 'refreshTrackRegionOverlayGeometry', endBefore: ['updateTrackRegionOverlays'] },
                { start: 'updateTrackRegionOverlays', endBefore: [] },
            ],
        },
        {
            out: 'waveform-region-render-hover.js',
            header:
                '/**\n * waveform-region-render-hover.js — ポインタ hover・カーソル・要素検出\n */',
            anchors: [
                { start: 'getWaveformLanesEl', endBefore: ['refreshTrackRegionOverlayGeometry'] },
            ],
        },
    ];

    splitByAnchors('waveform-region-render.js', renderParts, { keepStub: false });
}

// --- 2. waveform-region-core.js ---
{
    const coreParts = [
        {
            out: 'waveform-region-selection.js',
            header:
                '/**\n * waveform-region-selection.js — リージョン選択・グループ化\n */',
            anchors: [
                {
                    startLineContains: 'const REGION_GROUP_EDGE_TOP',
                    endBefore: ['segmentEntryTimelineEnd'],
                },
            ],
        },
        {
            out: 'waveform-region-boundary-join.js',
            header:
                '/**\n * waveform-region-boundary-join.js — セグメント境界結合・クロスフェード\n */',
            anchors: [
                {
                    start: 'segmentBoundaryJoinEpsilonSec',
                    endBefore: ['getTrackTimelineEndSec'],
                },
            ],
        },
        {
            out: 'waveform-region-playback-map.js',
            header:
                '/**\n * waveform-region-playback-map.js — transport マッピング・viewport peaks\n */',
            anchors: [{ start: 'getTrackTimelineEndSec', endBefore: [] }],
        },
    ];
    splitByAnchors('waveform-region-core.js', coreParts, { keepStub: false });
}

// --- 3. waveform-region-io.js ---
{
    const ioParts = [
        {
            out: 'waveform-region-io-keyboard.js',
            header:
                '/**\n * waveform-region-io-keyboard.js — リージョン keyboard / 選択 pointer\n */',
            anchors: [
                {
                    start: 'guardRegionShortcutKeydown',
                    endBefore: ['applyPlaybackRegionSegmentsRaw'],
                },
            ],
        },
        {
            out: 'waveform-region-io-persist.js',
            header:
                '/**\n * waveform-region-io-persist.js — セッション復元・永続化\n */',
            anchors: [
                {
                    start: 'applyPlaybackRegionSegmentsRaw',
                    endBefore: ['initPlaybackRegionHoverUi'],
                },
            ],
        },
        {
            out: 'waveform-region-io-nav.js',
            header:
                '/**\n * waveform-region-io-nav.js — リージョンナビ・練習番号ジャンプ\n */',
            anchors: [{ start: 'sortRegionNavStops', endBefore: [] }],
        },
    ];
    splitByAnchors('waveform-region-io.js', ioParts, { keepStub: false });
}

// --- 4. musical-grid.js ---
{
    const gridParts = [
        {
            out: 'musical-grid-parse.js',
            header: '/**\n * musical-grid-parse.js — Tempo/Meter/Phrase パース・grid 線\n */',
            anchors: [
                {
                    start: 'normalizeMusicalGridTempoText',
                    endBefore: ['readMusicalGridFromInputs'],
                },
            ],
        },
        {
            out: 'musical-grid-phrase-edit.js',
            header:
                '/**\n * musical-grid-phrase-edit.js — Phrase 欄編集・Undo・bump\n */',
            anchors: [
                {
                    start: 'bumpPhraseSizeBy',
                    endBefore: ['drawMusicalGridOverlay'],
                },
            ],
        },
        {
            out: 'musical-grid-phrase-boundary-drag.js',
            header:
                '/**\n * musical-grid-phrase-boundary-drag.js — Phrase 境界ハンドル drag\n */',
            anchors: [{ start: 'onPhraseBoundaryHandlePointerDown', endBefore: [] }],
        },
    ];
    splitByAnchors('musical-grid.js', gridParts, { keepStub: false });
}

// --- 5. extra-audio-mix.js ---
{
    const mixParts = [
        {
            out: 'extra-audio-lane-mix.js',
            header: '/**\n * extra-audio-lane-mix.js — Ex レーン gain / solo / mute\n */',
            anchors: [
                {
                    start: 'ensureExtraTrackMixRouting',
                    endBefore: ['getVideoTransportDurationSecForMix'],
                },
            ],
        },
        {
            out: 'extra-audio-review-mix.js',
            header:
                '/**\n * extra-audio-review-mix.js — Review mix WebAudio routing\n */',
            anchors: [{ start: 'getVideoTransportDurationSecForMix', endBefore: [] }],
        },
    ];
    splitByAnchors('extra-audio-mix.js', mixParts, { keepStub: false });
}

// --- 6. extra-audio-waveform.js ---
{
    const wfParts = [
        {
            out: 'extra-audio-lane-ui.js',
            header:
                '/**\n * extra-audio-lane-ui.js — Ex レーン表示・ボタン・可視性\n */',
            anchors: [
                {
                    start: 'drawExtraTrackWaveform',
                    endBefore: ['extraSlotHasShownLanesAbove'],
                },
            ],
        },
        {
            out: 'extra-audio-slot-transfer.js',
            header:
                '/**\n * extra-audio-slot-transfer.js — スロット入替・データ移行\n */',
            anchors: [{ start: 'extraSlotHasShownLanesAbove', endBefore: [] }],
        },
    ];
    splitByAnchors('extra-audio-waveform.js', wfParts, { keepStub: false });
}

// --- 7. index.html ---
{
    const htmlPath = path.join(ROOT, 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const inserts = [
        ['waveform-region-selection.js', 'waveform-region-segment-copy.js'],
        ['waveform-region-boundary-join.js', 'waveform-region-selection.js'],
        ['waveform-region-playback-map.js', 'waveform-region-boundary-join.js'],
        ['waveform-region-render-meta.js', 'waveform-region-snap-split.js'],
        ['waveform-region-render-segments.js', 'waveform-region-render-meta.js'],
        ['waveform-region-render-hover.js', 'waveform-region-render-segments.js'],
        ['waveform-region-io-keyboard.js', 'waveform-region-render-hover.js'],
        ['waveform-region-io-persist.js', 'waveform-region-io-keyboard.js'],
        ['waveform-region-io-nav.js', 'waveform-region-io-persist.js'],
        ['musical-grid-parse.js', 'waveform-timeline-zoom.js'],
        ['musical-grid-phrase-edit.js', 'musical-grid-parse.js'],
        ['musical-grid-phrase-boundary-drag.js', 'musical-grid-phrase-edit.js'],
        ['extra-audio-lane-mix.js', 'extra-audio-shared.js'],
        ['extra-audio-review-mix.js', 'extra-audio-lane-mix.js'],
        ['extra-audio-lane-ui.js', 'extra-audio-decode-peaks.js'],
        ['extra-audio-slot-transfer.js', 'extra-audio-lane-ui.js'],
    ];
    for (const [name, after] of inserts) {
        html = insertScriptAfter(html, after, name);
    }
    html = html.replace(
        '    <script src="js/waveform-region-render.js"></script>\n',
        '',
    );
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log('Updated index.html');
}

console.log('Phase 3 done.');
