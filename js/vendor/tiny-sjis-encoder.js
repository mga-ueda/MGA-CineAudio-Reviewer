/**
 * tiny-sjis-encoder — CP932 (Shift_JIS) string encoder for browser use.
 *
 * Based on tiny-sjis-encoder v1.0.1 by t-kouyama (MIT License).
 *   https://github.com/t-kouyama/tiny-sjis-encoder
 *
 * Copyright (c) 2025 t-kouyama
 * Full license text: js/vendor/LICENSE-tiny-sjis-encoder.txt
 * Third-party summary: js/vendor/THIRD-PARTY-NOTICES.md
 *
 * Modifications in this copy:
 *   - Browser IIFE exposing global encodeMs932Bytes()
 *   - TextDecoder label fallbacks (ms932 / shift_jis / windows-31j / shift-jis)
 */
(function tinySjisEncoderModule(global) {
    let TABLE;
    let decoder = null;

    function resolveMs932Decoder() {
        if (decoder) return decoder;
        const labels = ['ms932', 'shift_jis', 'windows-31j', 'shift-jis'];
        for (let i = 0; i < labels.length; i++) {
            try {
                decoder = new TextDecoder(labels[i]);
                decoder.decode(new Uint8Array([0x82, 0xa0]));
                return decoder;
            } catch (_) {
                decoder = null;
            }
        }
        return null;
    }

    function sjis(str) {
        const text = String(str == null ? '' : str);
        const dec = resolveMs932Decoder();
        if (!dec) return null;

        if (TABLE === undefined) {
            TABLE = new Uint16Array(0x10000);
            const a1 = new Uint8Array(1);
            const a2 = new Uint8Array(2);

            for (const [s, e] of [
                [0x00, 0x7f],
                [0xa1, 0xdf],
            ]) {
                for (let i = s; i <= e; i++) {
                    try {
                        a1[0] = i;
                        TABLE[dec.decode(a1).charCodeAt(0)] = i;
                    } catch (_) {}
                }
            }

            for (const [s1, e1] of [
                [0x81, 0x9f],
                [0xe0, 0xfc],
            ]) {
                for (let i = s1; i <= e1; i++) {
                    a2[0] = i;
                    for (const [s2, e2] of [
                        [0x40, 0x7e],
                        [0x80, 0xfc],
                    ]) {
                        for (let j = s2; j <= e2; j++) {
                            a2[1] = j;
                            try {
                                TABLE[dec.decode(a2).charCodeAt(0)] = (i << 8) | j;
                            } catch (_) {}
                        }
                    }
                }
            }
        }

        const len = text.length;
        const res = new Uint8Array(len * 2);
        let pos = 0;

        for (let i = 0; i < len; i++) {
            const code = TABLE[text.charCodeAt(i)] || 0x3f;
            if (code > 0xff) {
                res[pos++] = code >> 8;
                res[pos++] = code & 0xff;
            } else {
                res[pos++] = code;
            }
        }

        return res.subarray(0, pos);
    }

    global.encodeMs932Bytes = sjis;
})(typeof window !== 'undefined' ? window : globalThis);
