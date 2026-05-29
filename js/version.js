/**
 * version.js — アプリ版番号・表示ラベル・changelog（About 表示用）。
 */
    const APP_VERSION = '0.02';
    const APP_VERSION_LABEL = 'v' + APP_VERSION;

    const APP_CHANGELOG = [
        {
            version: '0.02',
            date: '2026年5月30日',
            items: [
                'JS を責務別モジュールに分割（waveform-region / extra-audio / markers）',
                'crossfade-math・audio-decode・extra-audio-io で共通化',
                'Import Review の Ex トラック復元不具合を修正',
            ],
        },
        {
            version: '0.01',
            date: '2026年5月25日',
            items: [],
        },
    ];

    (function applyAppVersionToUi() {
        document.title = 'MGA CineAudio Reviewer · ' + APP_VERSION_LABEL;

        const badge = document.querySelector('.version-badge');
        if (badge) badge.textContent = APP_VERSION_LABEL;
    })();
