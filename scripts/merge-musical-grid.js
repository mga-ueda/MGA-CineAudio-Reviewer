/**
 * Re-merge musical-grid split modules back into musical-grid.js (IIFE cannot span files).
 */
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', 'js');

function read(file) {
    return fs.readFileSync(path.join(JS, file), 'utf8').split(/\r?\n/);
}

function bodyLines(file) {
    const lines = read(file);
    let start = 0;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('*/')) {
            start = i + 1;
            break;
        }
    }
    return lines.slice(start).filter((l) => l.trim() !== '})();');
}

const main = read('musical-grid.js');
const parse = bodyLines('musical-grid-parse.js');
const edit = bodyLines('musical-grid-phrase-edit.js');
const drag = bodyLines('musical-grid-phrase-boundary-drag.js');

const readIdx = main.findIndex((l) => l.includes('function readMusicalGridFromInputs'));
const drawIdx = main.findIndex((l) => l.includes('function drawMusicalGridOverlay'));
const orphanIdx = main.findIndex((l) => l.includes('function endPhraseBoundaryDrag'));

if (readIdx < 0 || drawIdx < 0 || orphanIdx < 0) {
    throw new Error('merge anchor not found');
}

const merged = [
    ...main.slice(0, readIdx),
    ...parse,
    '',
    ...main.slice(readIdx, drawIdx),
    ...edit,
    '',
    ...main.slice(drawIdx, orphanIdx),
    ...drag,
    '})();',
    '',
];

fs.writeFileSync(path.join(JS, 'musical-grid.js'), merged.join('\n'), 'utf8');
for (const f of [
    'musical-grid-parse.js',
    'musical-grid-phrase-edit.js',
    'musical-grid-phrase-boundary-drag.js',
]) {
    fs.unlinkSync(path.join(JS, f));
}
console.log('Merged musical-grid.js (' + merged.length + ' lines)');
