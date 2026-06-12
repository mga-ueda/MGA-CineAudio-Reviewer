/**
 * One-shot: move js/*.js into domain subfolders and update path references.
 * Usage: node scripts/reorganize-js.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const jsRoot = path.join(root, 'js');

function targetDir(filename) {
    if (filename === 'waveform-lane-height-boot.js' || filename === 'export-blocking-lock.js') {
        return 'boot';
    }
    if (filename.startsWith('waveform-region-')) return 'waveform/region';
    if (
        filename.startsWith('waveform-') ||
        filename === 'audio-waveform.js' ||
        filename === 'lane-waveform-loading.js' ||
        filename.startsWith('track-lane-') ||
        filename === 'crossfade-math.js' ||
        filename === 'region-restore-diag.js'
    ) {
        return 'waveform';
    }
    if (filename.startsWith('extra-audio-') || filename === 'extra-lanes-dom.js') {
        return 'extra-audio';
    }
    if (filename.startsWith('markers-')) return 'markers';
    if (
        filename.startsWith('session-') ||
        filename === 'indexeddb.js' ||
        filename === 'boot-prefs.js' ||
        filename === 'waveform-restore-lock.js'
    ) {
        return 'session';
    }
    if (filename.startsWith('events-')) return 'events';
    if (
        filename.startsWith('transport-') ||
        filename === 'keyboard-transport-scrub.js' ||
        filename === 'range-loop.js' ||
        filename === 'timecode-seek.js' ||
        filename === 'player-timecode-overlay.js'
    ) {
        return 'transport';
    }
    if (
        filename === 'musical-grid.js' ||
        filename.startsWith('timeline-musical-slots') ||
        filename === 'mp4-fps.js'
    ) {
        return 'musical';
    }
    if (
        filename.startsWith('audio-') ||
        filename === 'loudness-lkfs.js' ||
        filename.startsWith('metronome') ||
        filename === 'signalsmith-stretch-main-thread.js'
    ) {
        return 'audio';
    }
    if (
        filename === 'video-export-review.js' ||
        filename === 'wave-export-offline-bounce.js' ||
        filename === 'wav-markers.js' ||
        filename === 'video-analyzer-diag.js'
    ) {
        return 'export';
    }
    if (filename === 'drop-files.js') return 'media';
    if (filename === 'guide-nav.js') return 'guide';
    if (
        [
            'version.js',
            'constants.js',
            'dom-refs.js',
            'app-runtime.js',
            'format-utils.js',
            'async-utils.js',
            'apply-version.js',
        ].includes(filename)
    ) {
        return 'core';
    }
    if (
        [
            'layout-dock.js',
            'ui-helpers.js',
            'view-panels.js',
            'prefs-log.js',
            'files-panels.js',
            'video-load-lock.js',
        ].includes(filename)
    ) {
        return 'ui';
    }
    if (filename === 'shortcut-defs.js') return 'shortcuts';
    return null;
}

const files = fs.readdirSync(jsRoot).filter((f) => f.endsWith('.js'));
const moves = [];
for (const file of files) {
    const dir = targetDir(file);
    if (!dir) {
        console.error('Unmapped file:', file);
        process.exit(1);
    }
    moves.push({ file, dir, from: `js/${file}`, to: `js/${dir}/${file}` });
}

moves.sort((a, b) => b.from.length - a.from.length);

for (const { dir } of moves) {
    fs.mkdirSync(path.join(jsRoot, ...dir.split('/')), { recursive: true });
}

for (const { from, to } of moves) {
    const fromPath = path.join(root, from.replace(/\//g, path.sep));
    const toPath = path.join(root, to.replace(/\//g, path.sep));
    if (!fs.existsSync(fromPath)) {
        console.warn('Skip missing:', from);
        continue;
    }
    execSync(`git mv "${fromPath}" "${toPath}"`, { cwd: root, stdio: 'inherit' });
}

function replacePathsInFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    let text = fs.readFileSync(filePath, 'utf8');
    let changed = false;
    for (const { from, to } of moves) {
        if (text.includes(from)) {
            text = text.split(from).join(to);
            changed = true;
        }
    }
    if (changed) {
        fs.writeFileSync(filePath, text, 'utf8');
        console.log('Updated paths:', path.relative(root, filePath));
    }
}

const updateTargets = [
    'index.html',
    'guide.html',
    'README.md',
    'tools/sync-docs.py',
    'tools/_manual_fragment.html',
    path.join('js', 'waveform', 'waveform-peaks.js'),
];

for (const rel of updateTargets) {
    replacePathsInFile(path.join(root, rel));
}

console.log(`Moved ${moves.length} files.`);
