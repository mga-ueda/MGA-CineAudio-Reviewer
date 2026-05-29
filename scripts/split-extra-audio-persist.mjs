/**
 * Split extra-audio-persist.js into decode-peaks / transport-sync / persist (waveform restore).
 */
import fs from 'fs';
import path from 'path';

const jsDir = path.join(process.cwd(), 'js');
const src = fs.readFileSync(path.join(jsDir, 'extra-audio-persist.js'), 'utf8');
const lines = src.split(/\r?\n/);

function slice(start1, end1) {
    return lines.slice(start1 - 1, end1).join('\n');
}

function write(name, header, chunks) {
    const body = chunks.map(([s, e]) => slice(s, e)).join('\n\n');
    const content = `/**\n * ${header}\n */\n${body}\n`;
    fs.writeFileSync(path.join(jsDir, name), content, 'utf8');
    console.log('wrote', name, content.split('\n').length, 'lines');
}

write(
    'extra-audio-decode-peaks.js',
    'extra-audio-decode-peaks.js — WAV/AudioBuffer デコードと peaks 生成',
    [
        [5, 111],
        [562, 580],
        [613, 658],
        [935, 992],
    ],
);

write(
    'extra-audio-transport-sync.js',
    'extra-audio-transport-sync.js — レビューミックスとトランスポート同期',
    [
        [289, 360],
        [363, 560],
        [582, 606],
    ],
);

write(
    'extra-audio-persist.js',
    'extra-audio-persist.js — 永続化・セッション復元・波形 ensure・動画 mix 準備',
    [
        [114, 287],
        [608, 626],
        [660, 934],
        [994, 1011],
    ],
);

console.log('done');
