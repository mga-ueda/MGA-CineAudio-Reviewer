/**
 * One-off splitter for markers / extra-audio-tracks / waveform-region.
 * Run: node scripts/split-large-js.mjs
 */
import fs from 'fs';
import path from 'path';

const jsDir = path.join(process.cwd(), 'js');

function read(name) {
    return fs.readFileSync(path.join(jsDir, name), 'utf8');
}

function write(name, content) {
    fs.writeFileSync(path.join(jsDir, name), content, 'utf8');
    const lines = content.split('\n').length;
    console.log(`  wrote ${name} (${lines} lines)`);
}

function sliceLines(text, start1, end1) {
    const lines = text.split('\n');
    return lines.slice(start1 - 1, end1).join('\n');
}

function markersSplit() {
    const src = read('markers.js');
    if (src.includes('markers-state.js')) {
        console.log('markers.js already split — skip');
        return;
    }
    const chunks = [
        [
            'markers-state.js',
            1,
            545,
            'markers-state.js — マーカー状態・キャッシュ・セッション復元。',
        ],
        [
            'markers-overlay.js',
            546,
            1238,
            'markers-overlay.js — コメントオーバーレイ・表示切替・メモ。',
        ],
        [
            'markers-copy-paste.js',
            1239,
            1866,
            'markers-copy-paste.js — マーカー Copy/Paste（TSV・クリップボード）。',
        ],
        [
            'markers-ops.js',
            1867,
            2827,
            'markers-ops.js — マーカー追加・削除・TC 編集・ナビ補助。',
        ],
        [
            'markers-list-waveform.js',
            2828,
            4984,
            'markers-list-waveform.js — 一覧 UI・波形マーカー描画・ショートカット。',
        ],
        [
            'markers-init.js',
            4985,
            5152,
            'markers-init.js — initMarkers と DOM イベント登録。',
        ],
    ];
    console.log('markers.js →');
    for (const [name, start, end, header] of chunks) {
        const body = sliceLines(src, start, end);
        write(
            name,
            `/**\n * ${header}\n */\n${body}\n`,
        );
    }
    write(
        'markers.js',
        `/**\n * markers.js — マーカーモジュール（分割ファイルのエントリ・互換用）。\n * 実装: markers-state.js … markers-init.js\n */\n`,
    );
}

function extraAudioSplit() {
    if (fs.existsSync(path.join(jsDir, 'extra-audio-crossfade.js'))) {
        console.log('extra-audio modules already split — skip');
        return;
    }
    const src = read('extra-audio-tracks.js');
    if (!src || src.length < 500) {
        console.log('extra-audio-tracks.js missing or stub — skip');
        return;
    }
    const chunks = [
        [
            'extra-audio-state.js',
            1,
            838,
            'extra-audio-state.js — Ex トラック状態・クリップ・セグメントゲイン補助。',
        ],
        [
            'extra-audio-mix.js',
            839,
            2126,
            'extra-audio-mix.js — レビューミックス（Web Audio ルーティング・Solo/Mute）。',
        ],
        [
            'extra-audio-playback.js',
            2127,
            3019,
            'extra-audio-playback.js — 再生スケジュール・トランスポート同期。',
        ],
        [
            'extra-audio-persist.js',
            3020,
            4021,
            'extra-audio-persist.js — 永続化スナップショット・WAV peaks プレビュー・デコード。',
        ],
        [
            'extra-audio-waveform.js',
            4022,
            4902,
            'extra-audio-waveform.js — Ex 波形描画・レーン表示・可視性。',
        ],
        [
            'extra-audio-load.js',
            4903,
            5396,
            'extra-audio-load.js — ファイル読込・ドロップ割当。',
        ],
        [
            'extra-audio-init.js',
            5397,
            5499,
            'extra-audio-init.js — initExtraAudioTracksUi と DOM バインド。',
        ],
    ];
    console.log('extra-audio-tracks.js →');
    for (const [name, start, end, header] of chunks) {
        const body = sliceLines(src, start, end);
        write(
            name,
            `/**\n * ${header}\n */\n${body}\n`,
        );
    }
    write(
        'extra-audio-tracks.js',
        `/**\n * extra-audio-tracks.js — Ex 音声（分割ファイルのエントリ・互換用）。\n * 実装: extra-audio-state.js … extra-audio-init.js\n */\n`,
    );
}

function stripDuplicateFileHeader(text, oldHeaderLine) {
    const lines = text.split('\n');
    const out = [];
    let i = 0;
    let sawNewHeader = false;
    while (i < lines.length) {
        const line = lines[i];
        if (
            sawNewHeader &&
            line.trim() === '/**' &&
            i + 1 < lines.length &&
            lines[i + 1].includes(oldHeaderLine)
        ) {
            i++;
            while (i < lines.length && !lines[i].includes('*/')) i++;
            if (i < lines.length) i++;
            while (i < lines.length && lines[i].trim() === '') i++;
            continue;
        }
        if (line.includes(oldHeaderLine) && line.trim().startsWith('*')) {
            // skip legacy header lines if any remain
            i++;
            continue;
        }
        if (line.trim() === '/**' && out.length === 0) sawNewHeader = true;
        out.push(line);
        i++;
    }
    return out.join('\n');
}

function findBodyLine(bodyLines, needle) {
    const idx = bodyLines.findIndex((line) => line.includes(needle));
    if (idx < 0) throw new Error('waveform-region split anchor not found: ' + needle);
    return idx + 1;
}

function waveformRegionSplit() {
    let src = read('waveform-region.js');
    if (src.includes('waveform-region-core.js')) {
        console.log('waveform-region.js already split — skip');
        return;
    }
    const normalized = src.replace(/\r\n/g, '\n');
    const m = normalized.match(
        /^(\/\*\*[\s\S]*?\*\/)\s*\(function waveformRegionModule\(\) \{\n([\s\S]*)\n\}\)\(\);\s*$/,
    );
    if (!m) throw new Error('waveform-region.js IIFE structure not recognized');
    const [, header, body] = m;
    const bodyLines = body.split('\n');
    const drawLine = findBodyLine(
        bodyLines,
        'function drawExtraTrackWaveformRegions(',
    );
    const overlayLine = findBodyLine(
        bodyLines,
        'function updateAllPlaybackRegionOverlays(',
    );
    const splitKeyLine = findBodyLine(
        bodyLines,
        'function handlePlaybackRegionSplitKeydown(',
    );
    const parts = [
        ['waveform-region-core.js', 1, drawLine - 1, 'コア（Undo・セグメント・スナップ・ゲイン）'],
        [
            'waveform-region-render.js',
            drawLine,
            overlayLine - 1,
            '波形リージョン描画',
        ],
        [
            'waveform-region-ui.js',
            overlayLine,
            splitKeyLine - 1,
            'オーバーレイ・ドラッグ・ホバー',
        ],
        [
            'waveform-region-io.js',
            splitKeyLine,
            bodyLines.length,
            'キーボード・永続化・公開 API',
        ],
    ];
    console.log('waveform-region.js →', { drawLine, overlayLine, splitKeyLine });
    for (const [name, start, end, desc] of parts) {
        const chunk = bodyLines.slice(start - 1, end).join('\n');
        write(name, `/**\n * ${name} — ${desc}\n */\n${chunk}\n`);
    }
    const stub =
        header.replace(/\s*\*\/\s*$/, '') +
        '\n * 実装: waveform-region-core.js … waveform-region-io.js\n */\n';
    write('waveform-region.js', stub);
}

function cleanSplitHeaders() {
    const pairs = [
        ['markers-state.js', 'markers.js'],
        ['markers-overlay.js', 'markers.js'],
        ['markers-copy-paste.js', 'markers.js'],
        ['markers-ops.js', 'markers.js'],
        ['markers-list-waveform.js', 'markers.js'],
        ['extra-audio-state.js', 'extra-audio-tracks.js'],
        ['extra-audio-mix.js', 'extra-audio-tracks.js'],
        ['extra-audio-playback.js', 'extra-audio-tracks.js'],
        ['extra-audio-persist.js', 'extra-audio-tracks.js'],
        ['extra-audio-waveform.js', 'extra-audio-tracks.js'],
        ['extra-audio-load.js', 'extra-audio-tracks.js'],
    ];
    for (const [file, oldRef] of pairs) {
        const p = path.join(jsDir, file);
        if (!fs.existsSync(p)) continue;
        const text = fs.readFileSync(p, 'utf8');
        const cleaned = stripDuplicateFileHeader(text, oldRef);
        fs.writeFileSync(p, cleaned, 'utf8');
    }
}

const only = process.argv[2];
if (!only || only === 'clean') {
    cleanSplitHeaders();
    console.log('headers cleaned');
} else {
    if (only === 'markers') markersSplit();
    else if (only === 'extra') extraAudioSplit();
    else if (only === 'waveform') waveformRegionSplit();
    else if (only === 'all') {
        markersSplit();
        extraAudioSplit();
        waveformRegionSplit();
        cleanSplitHeaders();
    } else {
        throw new Error('usage: node split-large-js.mjs [markers|extra|waveform|all|clean]');
    }
    console.log('done');
}
