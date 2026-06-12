const fs = require('fs');
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['index.html', 'guide.html'];
let failed = false;
for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    const re = /src="(js\/[^"]+)"/g;
    const bad = [];
    let m;
    while ((m = re.exec(html))) {
        if (!fs.existsSync(m[1])) bad.push(m[1]);
    }
    if (bad.length) {
        console.error(file + ' MISSING:', bad.join(', '));
        failed = true;
    } else {
        console.log(file + ': OK');
    }
}
if (failed) process.exit(1);
