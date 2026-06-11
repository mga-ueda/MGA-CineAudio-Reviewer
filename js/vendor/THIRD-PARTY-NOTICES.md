# Third-Party Notices

MGA CineAudio Reviewer bundles the following third-party software.
When you **distribute or fork the source**, include this file together with the
license files referenced below (MIT License requires retaining copyright and
permission notices).

## Signalsmith Stretch

| | |
|---|---|
| **Purpose** | Pitch / time-stretch for region key changes (Web Audio / WASM) |
| **Files** | `js/vendor/SignalsmithStretch.js`, `js/vendor/signalsmith-stretch-worklet.js` |
| **Copyright** | Copyright (c) Signalsmith Audio and contributors |
| **License** | MIT License — [LICENSE-SignalsmithStretch.txt](LICENSE-SignalsmithStretch.txt) |
| **Source** | https://github.com/Signalsmith-Audio/signalsmith-stretch |

## tiny-sjis-encoder

| | |
|---|---|
| **Purpose** | CP932 (Shift_JIS / Windows-31J) encoding for WAV export marker / region labels |
| **Files** | `js/vendor/tiny-sjis-encoder.js` |
| **Copyright** | Copyright (c) 2025 t-kouyama |
| **License** | MIT License — [LICENSE-tiny-sjis-encoder.txt](LICENSE-tiny-sjis-encoder.txt) |
| **Source** | https://github.com/t-kouyama/tiny-sjis-encoder (npm: `tiny-sjis-encoder` v1.0.1) |
| **Modifications** | Wrapped for browser use (`encodeMs932Bytes` global); added fallback `TextDecoder` labels (`ms932`, `shift_jis`, `windows-31j`, `shift-jis`). Algorithm unchanged. |

---

This application's own source (`index.html`, `css/`, most of `js/`, etc.) is
licensed under the repository [LICENSE](../../LICENSE) (MIT, MIYABI GAME AUDIO INC.).
