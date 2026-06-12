/**
 * messages/registry.js — メッセージカタログの登録 API と msg() 参照ヘルパ。
 */
(function messagesRegistryModule() {
    const MESSAGES = Object.create(null);

    /**
     * @param {Record<string, string | ((arg: unknown) => string)>} entries
     */
    function registerMessages(entries) {
        for (const key of Object.keys(entries)) {
            if (Object.prototype.hasOwnProperty.call(MESSAGES, key)) {
                console.warn('[messages] duplicate key:', key);
            }
            MESSAGES[key] = entries[key];
        }
    }

    /**
     * @param {string} key
     * @param {Record<string, string | number> | unknown} [arg]
     * @returns {string}
     */
    function msg(key, arg) {
        const val = MESSAGES[key];
        if (val == null) {
            console.warn('[messages] missing key:', key);
            return key;
        }
        if (typeof val === 'function') {
            return val(arg);
        }
        if (
            typeof val === 'string' &&
            arg != null &&
            typeof arg === 'object' &&
            !Array.isArray(arg)
        ) {
            return val.replace(/\{(\w+)\}/g, (_, k) =>
                arg[k] != null ? String(arg[k]) : '{' + k + '}',
            );
        }
        return val;
    }

    function msgKeys() {
        return Object.keys(MESSAGES).sort();
    }

    window.registerMessages = registerMessages;
    window.msg = msg;
    window.msgKeys = msgKeys;
})();
