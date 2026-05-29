/**
 * async-utils.js — 非同期ユーティリティ（yieldToBrowser・永続化用 deepClone、Blob 保持）。
 */
(function asyncUtilsModule() {
    function yieldToBrowser() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    function clonePersistValue(value) {
        if (value === null || value === undefined) return value;
        if (typeof Blob !== 'undefined' && value instanceof Blob) return value;
        if (typeof File !== 'undefined' && value instanceof File) return value;
        if (Array.isArray(value)) return value.map(clonePersistValue);
        if (typeof value !== 'object') return value;
        const out = {};
        for (const key of Object.keys(value)) {
            out[key] = clonePersistValue(value[key]);
        }
        return out;
    }

    function deepCloneJson(value, opt) {
        const failSoft = !!(opt && opt.failSoft);
        if (opt && opt.preserveBlobs) {
            try {
                return clonePersistValue(value);
            } catch (err) {
                if (failSoft) return value;
                throw err;
            }
        }
        if (value === null || value === undefined) return value;
        if (typeof value !== 'object') return value;
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (err) {
            if (failSoft) return value;
            throw err;
        }
    }

    function deepCloneForPersist(value) {
        return deepCloneJson(value, { failSoft: true, preserveBlobs: true });
    }

    window.yieldToBrowser = yieldToBrowser;
    window.deepCloneJson = deepCloneJson;
    window.deepCloneForPersist = deepCloneForPersist;
})();
