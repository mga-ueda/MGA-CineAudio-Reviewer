/**
 * Load index.html scripts in order with minimal DOM; report first error.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((m) => m[1]);

function el(id) {
    const node = {
        id,
        hidden: false,
        disabled: false,
        value: '',
        checked: true,
        files: null,
        textContent: '',
        innerHTML: '',
        className: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        dataset: {},
        style: {},
        parentElement: null,
        childNodes: [],
        setAttribute() {},
        getAttribute: () => null,
        addEventListener() {},
        removeEventListener() {},
        appendChild(c) {
            node.childNodes.push(c);
            c.parentElement = node;
            return c;
        },
        replaceChildren(...kids) {
            node.childNodes.length = 0;
            for (const k of kids) node.appendChild(k);
        },
        replaceWith(...kids) {
            for (const k of kids) node.appendChild(k);
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        observe() {},
        blur() {},
        focus() {},
        click() {},
        contains: () => false,
        clientWidth: 100,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 20 }),
        childList: false,
        characterData: false,
        subtree: false,
    };
    return node;
}

const elements = new Map();
const document = {
    readyState: 'complete',
    body: {},
    activeElement: null,
    getElementById(id) {
        if (!elements.has(id)) {
            const e = el(id);
            if (id.startsWith('extraAudioMeta')) {
                e.hidden = true;
            }
            elements.set(id, e);
        }
        return elements.get(id);
    },
    querySelector(sel) {
        if (sel === '.transport-bar__row--export') return el('sessionIoRow');
        return null;
    },
    addEventListener() {},
    createElement() {
        return el('dynamic');
    },
    createDocumentFragment() {
        const nodes = [];
        return {
            appendChild(n) {
                nodes.push(n);
                return n;
            },
            childNodes: nodes,
        };
    },
    elementFromPoint: () => null,
};

const sandbox = {
    console,
    document,
    window: null,
    globalThis: null,
    performance: { now: () => 0 },
    requestAnimationFrame: (fn) => {
        fn();
        return 0;
    },
    cancelAnimationFrame: () => {},
    requestIdleCallback: (fn) => {
        fn();
        return 0;
    },
    setTimeout: (fn) => {
        fn();
        return 0;
    },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    navigator: { clipboard: null },
    localStorage: {
        getItem: () => null,
        setItem: () => {},
    },
    URL: {
        createObjectURL: () => 'blob:mock',
        revokeObjectURL: () => {},
    },
    Blob: class Blob {},
    File: class File {},
    FileReader: class FileReader {},
    AudioContext: class AudioContext {},
    webkitAudioContext: undefined,
    MediaRecorder: class MediaRecorder {},
    ResizeObserver: class ResizeObserver {
        observe() {}
    },
    MutationObserver: class MutationObserver {
        observe() {}
    },
    Map,
    Set,
    Promise,
    Uint8Array,
    ArrayBuffer,
    DataView,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    parseInt,
    parseFloat,
    isFinite,
    isNaN,
    Infinity,
    NaN,
    undefined,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
};
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.dispatchEvent = () => true;
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

for (const name of scripts) {
    const file = path.join(root, 'js', name);
    const code = fs.readFileSync(file, 'utf8');
    try {
        vm.runInContext(code, ctx, { filename: name, timeout: 10000 });
    } catch (e) {
        console.error('FAIL', name);
        console.error(e.message);
        if (e.stack) console.error(String(e.stack).split('\n').slice(0, 6).join('\n'));
        process.exit(1);
    }
}

console.log('OK scripts:', scripts.length);
console.log(
    'handleSessionIoShortcutKeydown:',
    typeof sandbox.handleSessionIoShortcutKeydown,
);
console.log('importSessionPackage:', typeof sandbox.importSessionPackage);
