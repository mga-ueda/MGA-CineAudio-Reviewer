const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcPath = path.join(__dirname, '../js/vendor/SignalsmithStretch.js');
const code = fs.readFileSync(srcPath, 'utf8');

const regStart = code.indexOf('function registerWorkletProcessor');
const regEnd =
    code.indexOf('registerProcessor(audioNodeKey, WasmProcessor);') +
    'registerProcessor(audioNodeKey, WasmProcessor);'.length;
const regSrc = code.slice(regStart, regEnd);

const factoryStart = code.indexOf('return (\nfunction(moduleArg');
const factoryEnd = code.indexOf('\n);\n})();', factoryStart);
const factoryInner = code.slice(
    factoryStart + 'return ('.length,
    factoryEnd + 1,
);

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
    'var ModuleFactory = ' + factoryInner + '; var registerWorkletProcessor = ' + regSrc.replace(/^function /, 'function ') + ';',
    sandbox,
);

const moduleCode =
    '(' +
    sandbox.registerWorkletProcessor.toString() +
    ')(' +
    sandbox.ModuleFactory.toString() +
    ',"signalsmith-stretch")';

console.log('moduleCode length:', moduleCode.length);
try {
    new vm.Script(moduleCode);
    console.log('parse: OK');
} catch (e) {
    console.log('parse FAILED:', e.message);
    console.log('near:', moduleCode.slice(Math.max(0, (e.stack || '').length), 200));
}

console.log('isSecureContext N/A in node');
