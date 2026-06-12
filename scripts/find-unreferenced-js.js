const fs = require('fs');
const path = require('path');

const htmlFiles = ['index.html', 'guide.html', 'shortcuts.html'];
const referenced = new Set();

for (const file of htmlFiles) {
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    const re = /src="(js\/[^"]+)"/g;
    let m;
    while ((m = re.exec(html))) referenced.add(m[1].replace(/\\/g, '/'));
}

function walk(dir, acc = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, acc);
        else if (e.name.endsWith('.js')) acc.push(p.replace(/\\/g, '/'));
    }
    return acc;
}

const allJs = walk('js');
const allContent = new Map();
for (const f of allJs) allContent.set(f, fs.readFileSync(f, 'utf8'));

const unreferenced = [];
for (const f of allJs) {
    const norm = f.replace(/\\/g, '/');
    if (referenced.has(norm)) continue;
    const base = path.basename(f);
    let dynamic = false;
    for (const [jf, content] of allContent) {
        if (jf === f) continue;
        if (content.includes(base) || content.includes(norm)) {
            dynamic = true;
            break;
        }
    }
    unreferenced.push({ file: norm, dynamic });
}

// Old flat duplicates: js/foo.js vs js/category/foo.js
const flatOnly = allJs.filter((f) => f.split('/').length === 2 || f.split('\\').length === 2);
const duplicates = [];
for (const flat of flatOnly) {
    const base = path.basename(flat);
    const matches = allJs.filter((f) => f !== flat && path.basename(f) === base);
    if (matches.length) duplicates.push({ flat, moved: matches });
}

console.log('=== HTML referenced:', referenced.size);
console.log('=== Total js files:', allJs.length);
console.log('\n=== Not referenced from HTML ===');
unreferenced.sort((a, b) => a.file.localeCompare(b.file)).forEach((u) => {
    console.log((u.dynamic ? '[dynamic] ' : '[UNUSED]  ') + u.file);
});
console.log('\n=== Flat js/ duplicates (same basename in subfolder) ===');
duplicates.sort((a, b) => a.flat.localeCompare(b.flat)).forEach((d) => {
    console.log(d.flat + ' -> ' + d.moved.join(', '));
});
