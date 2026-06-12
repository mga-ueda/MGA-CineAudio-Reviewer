/**
 * async-utils.js — 非同期ユーティリティ（yieldToBrowser・永続化用 deepClone、Blob 保持）。
 */
(function asyncUtilsModule() {
    function yieldToBrowser() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    function clonePersistScalar(value) {
        if (value === null || value === undefined) return value;
        if (typeof Blob !== 'undefined' && value instanceof Blob) return value;
        if (typeof File !== 'undefined' && value instanceof File) return value;
        if (typeof value !== 'object') return value;
        return null;
    }

    /** 深い JSON 木でも stack overflow しないよう明示スタックで複製 */
    function clonePersistValue(value, seen) {
        const scalar = clonePersistScalar(value);
        if (scalar !== null || value === null || value === undefined) {
            return scalar;
        }
        if (!seen) seen = new WeakSet();
        if (seen.has(value)) return undefined;

        const root = Array.isArray(value) ? [] : {};
        seen.add(value);
        const stack = [{ src: value, dst: root }];

        while (stack.length) {
            const frame = stack.pop();
            const src = frame.src;
            const dst = frame.dst;
            if (Array.isArray(src)) {
                for (let i = 0; i < src.length; i++) {
                    const item = src[i];
                    const itemScalar = clonePersistScalar(item);
                    if (itemScalar !== null || item === null || item === undefined) {
                        dst[i] = itemScalar;
                        continue;
                    }
                    if (seen.has(item)) {
                        dst[i] = undefined;
                        continue;
                    }
                    const next = Array.isArray(item) ? [] : {};
                    seen.add(item);
                    dst[i] = next;
                    stack.push({ src: item, dst: next });
                }
                continue;
            }
            for (const key of Object.keys(src)) {
                const item = src[key];
                const itemScalar = clonePersistScalar(item);
                if (itemScalar !== null || item === null || item === undefined) {
                    dst[key] = itemScalar;
                    continue;
                }
                if (seen.has(item)) {
                    dst[key] = undefined;
                    continue;
                }
                const next = Array.isArray(item) ? [] : {};
                seen.add(item);
                dst[key] = next;
                stack.push({ src: item, dst: next });
            }
        }
        return root;
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
