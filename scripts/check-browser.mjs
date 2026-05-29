import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const chrome =
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const mime = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
};

const server = http.createServer((req, res) => {
    let p = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const file = path.join(root, p.replace(/^\//, ''));
    if (!fs.existsSync(file)) {
        res.writeHead(404);
        res.end();
        return;
    }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/index.html`;

const chromeProc = spawn(
    chrome,
    [
        '--headless=new',
        '--disable-gpu',
        '--enable-logging=stderr',
        '--v=1',
        `--virtual-time-budget=8000`,
        url,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
);

let stderr = '';
chromeProc.stderr.on('data', (d) => {
    stderr += d.toString();
});

await new Promise((resolve) => chromeProc.on('close', resolve));
server.close();

const errLines = stderr
    .split('\n')
    .filter(
        (l) =>
            /error|Error|Uncaught|SyntaxError|ReferenceError|TypeError/i.test(l) &&
            !/ERROR:headless/i.test(l),
    );
console.log('URL', url);
console.log('Error lines:', errLines.length ? errLines.slice(0, 20).join('\n') : '(none in stderr)');
