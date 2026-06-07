/**
 * Phase 2: silent-gaps / fade-gain / snap-split modules + phrase extensions.
 * ALREADY APPLIED — DO NOT RE-RUN (fixed line numbers; re-run would corrupt files).
 * Run: node scripts/refactor-split-phase2.js
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

function removeLineRanges(lines, ranges) {
    const remove = new Set();
    for (const [start, end] of ranges) {
        for (let i = start - 1; i < end; i++) remove.add(i);
    }
    return lines.filter((_, i) => !remove.has(i));
}

function sliceLines(lines, start, end) {
    return lines.slice(start - 1, end);
}

function appendToPhrase(phraseLines, coreLines, ranges) {
    const chunks = [];
    for (const [s, e] of ranges) chunks.push(...sliceLines(coreLines, s, e));
    const insertAt = phraseLines.findIndex((l) => l.includes('window.logSessionRestoreRegionPhraseSnapshot'));
    if (insertAt < 0) throw new Error('phrase export anchor not found');
    return [
        ...phraseLines.slice(0, insertAt),
        '',
        ...chunks,
        '',
        ...phraseLines.slice(insertAt),
    ];
}

// --- 1. Extend waveform-region-phrase.js ---
{
    const core = readLines('waveform-region-core.js');
    let phrase = readLines('waveform-region-phrase.js');
    phrase = appendToPhrase(phrase, core, [
        [1570, 1722],
        [1970, 2032],
    ]);
    if (!phrase.some((l) => l.includes('window.phraseSlotRangesSnapshot'))) {
        const exportLines = [
            '    window.phraseSlotRangesSnapshot = phraseSlotRangesSnapshot;',
            '    window.phraseSlotIndexAtRegionInSec = phraseSlotIndexAtRegionInSec;',
            '    window.phraseSlotIndexForSilentGap = phraseSlotIndexForSilentGap;',
            '    window.phraseSlotStartSec = phraseSlotStartSec;',
            '    window.collectPhraseSlotJoinedSegmentIndices = collectPhraseSlotJoinedSegmentIndices;',
            '    window.silentGapSegmentSwapPlan = silentGapSegmentSwapPlan;',
            '    window.resolveSilentGapSwapSegmentIndices = resolveSilentGapSwapSegmentIndices;',
        ];
        phrase = [...phrase.slice(0, -1), ...exportLines];
    }
    writeFile('waveform-region-phrase.js', phrase);
    console.log('Extended waveform-region-phrase.js');
}

// --- 2. waveform-region-silent-gaps.js ---
{
    const core = readLines('waveform-region-core.js');
    const body = sliceLines(core, 951, 1376);
    const file = [
        '/**',
        ' * waveform-region-silent-gaps.js — 無音 gap 収集・選択・メタデータ',
        ' */',
        ...body,
        '    window.collectTrackSilentGaps = collectTrackSilentGaps;',
        '    window.resolveSilentGapListIndexAtTransport = resolveSilentGapListIndexAtTransport;',
        '    window.resolveSilentGapSelectionAtPointer = resolveSilentGapSelectionAtPointer;',
        '    window.explainSilentGapSelectionAtPointer = explainSilentGapSelectionAtPointer;',
        '    window.logSilentGapSelectionDiag = logSilentGapSelectionDiag;',
        '    window.silentGapMoveTargetSec = silentGapMoveTargetSec;',
    ];
    writeFile('waveform-region-silent-gaps.js', file);
    console.log('Created waveform-region-silent-gaps.js');
}

// --- 3. waveform-region-fade-gain.js ---
{
    const core = readLines('waveform-region-core.js');
    const body = sliceLines(core, 2234, 2446);
    const file = [
        '/**',
        ' * waveform-region-fade-gain.js — リージョン Gain / Fade',
        ' */',
        ...body,
    ];
    writeFile('waveform-region-fade-gain.js', file);
    console.log('Created waveform-region-fade-gain.js');
}

// --- 4. waveform-region-snap-split.js ---
{
    const core = readLines('waveform-region-core.js');
    const body = sliceLines(core, 2448, 3498);
    const file = [
        '/**',
        ' * waveform-region-snap-split.js — スナップ・分割・ハンドル判定',
        ' */',
        ...body,
        '    window.isPlaybackRegionSplitForbiddenAtTransport =',
        '        isPlaybackRegionSplitForbiddenAtTransport;',
    ];
    writeFile('waveform-region-snap-split.js', file);
    console.log('Created waveform-region-snap-split.js');
}

// --- 5. Slim core ---
{
    const core = readLines('waveform-region-core.js');
    let slim = removeLineRanges(core, [
        [951, 1376],
        [1570, 1722],
        [1970, 2032],
        [2234, 3498],
    ]);
    slim = slim.filter(
        (l) =>
            !l.includes('window.isPlaybackRegionSplitForbiddenAtTransport =') &&
            l.trim() !== 'isPlaybackRegionSplitForbiddenAtTransport;',
    );
    writeFile('waveform-region-core.js', slim);
    console.log('Slimmed waveform-region-core.js');
}

// --- 6. index.html ---
{
    const htmlPath = path.join(ROOT, 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const inserts = [
        [
            'waveform-region-silent-gaps.js',
            '    <script src="js/waveform-region-phrase.js"></script>\n',
            '    <script src="js/waveform-region-phrase.js"></script>\n    <script src="js/waveform-region-silent-gaps.js"></script>\n',
        ],
        [
            'waveform-region-fade-gain.js',
            '    <script src="js/waveform-region-silent-gaps.js"></script>\n',
            '    <script src="js/waveform-region-silent-gaps.js"></script>\n    <script src="js/waveform-region-fade-gain.js"></script>\n',
        ],
        [
            'waveform-region-snap-split.js',
            '    <script src="js/waveform-region-fade-gain.js"></script>\n',
            '    <script src="js/waveform-region-fade-gain.js"></script>\n    <script src="js/waveform-region-snap-split.js"></script>\n',
        ],
    ];
    for (const [name, needle, repl] of inserts) {
        if (!html.includes(name)) html = html.replace(needle, repl);
    }
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log('Updated index.html');
}

console.log('Phase 2 done.');
