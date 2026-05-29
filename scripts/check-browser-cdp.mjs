import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const debugPort = 9333;

const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
    let p = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const file = path.join(root, p.replace(/^\//, ''));
    if (!fs.existsSync(file)) {
        res.writeHead(404);
        res.end('missing ' + p);
        return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const appPort = server.address().port;
const pageUrl = `http://127.0.0.1:${appPort}/index.html`;

const chromeProc = spawn(chrome, [
    `--remote-debugging-port=${debugPort}`,
    '--headless=new',
    '--disable-gpu',
    'about:blank',
]);

await new Promise((r) => setTimeout(r, 1500));

const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json());
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const consoleMsgs = [];
const exceptions = [];
const failedReqs = [];

ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
        const args = (msg.params.args || [])
            .map((a) => a.value ?? a.description ?? '')
            .join(' ');
        consoleMsgs.push(`[${msg.params.type}] ${args}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        const stack = (d.stackTrace?.callFrames || [])
            .slice(0, 3)
            .map((f) => `${f.functionName || '(anon)'} ${f.url}:${f.lineNumber}`)
            .join(' <- ');
        const desc = d.exception?.description || d.text || '';
        exceptions.push(`${desc} @ ${d.url || ''}:${d.lineNumber} ${stack}`);
    }
    if (msg.method === 'Network.responseReceived') {
        const r = msg.params.response;
        if (r.status >= 400) failedReqs.push(`${r.status} ${r.url}`);
    }
});

function send(method, params = {}) {
    const msgId = ++id;
    return new Promise((resolve) => {
        pending.set(msgId, resolve);
        ws.send(JSON.stringify({ id: msgId, method, params }));
    });
}

await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
await send('Network.enable');
await send('Page.enable');
await send('Page.navigate', { url: pageUrl });
await new Promise((r) => setTimeout(r, 6000));

const evalState = await send('Runtime.evaluate', {
    expression: `({
      importBtn: !!document.getElementById('sessionImportBtn'),
      exportBtn: !!document.getElementById('sessionExportBtn'),
      importFile: !!document.getElementById('sessionImportFile'),
      importDisabled: document.getElementById('sessionImportBtn')?.disabled,
      handleSessionIo: typeof window.handleSessionIoShortcutKeydown,
      importPkg: typeof window.importSessionPackage,
      title: document.title,
      bodyLen: document.body?.innerHTML?.length || 0
    })`,
    returnByValue: true,
});

console.log('pageUrl', pageUrl);
console.log('state', evalState.result?.result?.value);
if (failedReqs.length) {
    console.log('failed requests:');
    failedReqs.forEach((r) => console.log(' ', r));
}
if (exceptions.length) {
    console.log('exceptions:');
    exceptions.forEach((e) => console.log(' ', e));
}
if (consoleMsgs.length) {
    console.log('console (last 20):');
    consoleMsgs.slice(-20).forEach((m) => console.log(' ', m));
}

ws.close();
chromeProc.kill();
server.close();
