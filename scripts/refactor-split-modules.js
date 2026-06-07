/**
 * One-shot refactor: split diag / swap-anim / phrase modules from monoliths.
 * ALREADY APPLIED — DO NOT RE-RUN (fixed line numbers; re-run would corrupt files).
 * Run: node scripts/refactor-split-modules.js
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

// --- 1. timeline-musical-slots-diag.js ---
{
    const lines = readLines('timeline-musical-slots.js');
    const diagRanges = [
        [25, 207],
        [209, 227],
        [245, 622],
        [814, 844],
        [2469, 2541],
    ];
    const diagBody = [];
    for (const [s, e] of diagRanges) {
        diagBody.push(...sliceLines(lines, s, e));
    }
    const diagFile = [
        '/**',
        ' * timeline-musical-slots-diag.js — [MusicalSlot] 診断ログ（入れ替え調査用）',
        ' *',
        ' * 無効化: window.musicalSlotDiagEnabled = false',
        ' * 手動: musicalSlotDiagDumpOriginBindings(0) / musicalSlotDiagDumpTrack(0)',
        ' */',
        '(function timelineMusicalSlotsDiagModule() {',
        "    const LOG_PREFIX = '[MusicalSlot]';",
        '',
        ...diagBody,
        '',
        '    window.musicalSlotDiagLog = musicalSlotDiagLog;',
        '    window.musicalSlotDiagDumpTrack = musicalSlotDiagDumpTrack;',
        '    window.musicalSlotDiagDumpOriginBindings = musicalSlotDiagDumpOriginBindings;',
        '    window.musicalSlotDiagLogOriginReport = musicalSlotDiagLogOriginReport;',
        '    window.musicalSlotDiagDumpSelectionTracks = musicalSlotDiagDumpSelectionTracks;',
        '    window.logSessionRestoreMusicalSlotSnapshot = logSessionRestoreMusicalSlotSnapshot;',
        '    window.regionSwapDiagLog = musicalSlotDiagLog;',
        '    window.regionSwapDiagDumpTrack = musicalSlotDiagDumpTrack;',
        '    window.regionSwapDiagDumpSelectionTracks = musicalSlotDiagDumpSelectionTracks;',
        '})();',
    ];
    writeFile('timeline-musical-slots-diag.js', diagFile);

    let main = removeLineRanges(lines, diagRanges);
    // Remove duplicate window exports at end (diag exports)
    const exportStrip = [
        '    window.musicalSlotDiagLog = musicalSlotDiagLog;',
        '    window.musicalSlotDiagDumpTrack = musicalSlotDiagDumpTrack;',
        '    window.musicalSlotDiagDumpOriginBindings = musicalSlotDiagDumpOriginBindings;',
        '    window.musicalSlotDiagLogOriginReport = musicalSlotDiagLogOriginReport;',
        '    window.musicalSlotDiagDumpSelectionTracks = musicalSlotDiagDumpSelectionTracks;',
        '    window.logSessionRestoreMusicalSlotSnapshot = logSessionRestoreMusicalSlotSnapshot;',
        '    window.regionSwapDiagLog = musicalSlotDiagLog;',
        '    window.regionSwapDiagDumpTrack = musicalSlotDiagDumpTrack;',
        '    window.regionSwapDiagDumpSelectionTracks = musicalSlotDiagDumpSelectionTracks;',
    ];
    main = main.filter((l) => !exportStrip.includes(l.trimEnd()));
    // Replace slotLog with musicalSlotDiagLog in main
    main = main.map((l) =>
        l.includes('slotLog(') ? l.replace(/slotLog\(/g, 'window.musicalSlotDiagLog(') : l,
    );
    writeFile('timeline-musical-slots.js', main);
    console.log('Created timeline-musical-slots-diag.js');
}

// --- 2. waveform-region-swap-anim.js ---
{
    const lines = readLines('waveform-region-render.js');
    const animStart = lines.findIndex((l) => l.includes('const REGION_SWAP_ANIM_MS'));
    const animEnd = lines.findIndex((l) =>
        l.includes('window.isPlaybackRegionSwapAnimActive'),
    );
    if (animStart < 0 || animEnd < 0) throw new Error('swap anim block not found');
    const animBody = lines.slice(animStart, animEnd + 1);
    const animFile = [
        '/**',
        ' * waveform-region-swap-anim.js — リージョン入れ替えアニメーション',
        ' */',
        ...animBody,
        '    window.playPlaybackRegionSwapAnimation = playPlaybackRegionSwapAnimation;',
        '    window.isPlaybackRegionSwapAnimActive = isPlaybackRegionSwapAnimActive;',
    ];
    writeFile('waveform-region-swap-anim.js', animFile);

    const render = [...lines.slice(0, animStart), ...lines.slice(animEnd + 1)];
    const cleaned = render.filter(
        (l) =>
            !l.includes('window.playPlaybackRegionSwapAnimation') &&
            !l.includes('window.isPlaybackRegionSwapAnimActive'),
    );
    writeFile('waveform-region-render.js', cleaned);
    console.log('Created waveform-region-swap-anim.js');
}

// --- 3. waveform-region-phrase.js ---
{
    const lines = readLines('waveform-region-core.js');
    const phraseRanges = [
        [432, 511],
        [519, 1159],
        [2280, 2574],
        [2986, 3007],
    ];
    const deadRanges = [[1617, 1624]];
    const phraseBody = [];
    for (const [s, e] of phraseRanges) {
        phraseBody.push(...sliceLines(lines, s, e));
    }
    const phraseFile = [
        '/**',
        ' * waveform-region-phrase.js — Phrase スロット解決・無音 gap・Phrase 欄レイアウト',
        ' */',
        ...phraseBody,
        '    window.logSessionRestoreRegionPhraseSnapshot = logSessionRestoreRegionPhraseSnapshot;',
        '    window.applyPhraseCompositionToTrackRegions = applyPhraseCompositionToTrackRegions;',
        '    window.applyPhraseCompositionToAllExtraTrackRegions =',
        '        applyPhraseCompositionToAllExtraTrackRegions;',
        '    window.expandedPhraseGroupBarCountsSnapshot = expandedPhraseGroupBarCountsSnapshot;',
    ];
    writeFile('waveform-region-phrase.js', phraseFile);

    let core = removeLineRanges(lines, [...phraseRanges, ...deadRanges]);
    // Remove phrase window exports now owned by waveform-region-phrase.js
    const coreExportStrip = [
        '    window.logSessionRestoreRegionPhraseSnapshot = logSessionRestoreRegionPhraseSnapshot;',
        '    window.applyPhraseCompositionToTrackRegions = applyPhraseCompositionToTrackRegions;',
        '    window.applyPhraseCompositionToAllExtraTrackRegions =',
        '        applyPhraseCompositionToAllExtraTrackRegions;',
    ];
    core = core.filter(
        (l) =>
            !coreExportStrip.includes(l.trimEnd()) &&
            l.trim() !== 'applyPhraseCompositionToAllExtraTrackRegions;',
    );
    writeFile('waveform-region-core.js', core);
    console.log('Created waveform-region-phrase.js');
}

// --- 4. index.html script tags ---
{
    const htmlPath = path.join(ROOT, 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    if (!html.includes('waveform-region-phrase.js')) {
        html = html.replace(
            '    <script src="js/waveform-region-core.js"></script>\n',
            '    <script src="js/waveform-region-core.js"></script>\n    <script src="js/waveform-region-phrase.js"></script>\n',
        );
    }
    if (!html.includes('waveform-region-swap-anim.js')) {
        html = html.replace(
            '    <script src="js/waveform-region-render.js"></script>\n',
            '    <script src="js/waveform-region-render.js"></script>\n    <script src="js/waveform-region-swap-anim.js"></script>\n',
        );
    }
    if (!html.includes('timeline-musical-slots-diag.js')) {
        html = html.replace(
            '    <script src="js/timeline-musical-slots.js"></script>\n',
            '    <script src="js/timeline-musical-slots-diag.js"></script>\n    <script src="js/timeline-musical-slots.js"></script>\n',
        );
    }
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log('Updated index.html');
}

console.log('Done.');
