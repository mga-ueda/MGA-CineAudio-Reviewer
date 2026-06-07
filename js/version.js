/**
 * version.js — アプリ版番号・表示ラベル・changelog（About 表示用）。
 */
    const APP_VERSION = '0.05';
    const APP_VERSION_LABEL = 'v' + APP_VERSION;

    const APP_CHANGELOG = [
        {
            version: '0.05',
            date: '2026年6月7日',
            items: [
                'Playback Region をタイムラインスロット・無音区間・Phrase 練習番号付きオーバーレイへ拡張し、関連 JS を責務別に分割。複数 Ex 同時ドロップ時のリージョン縮小とセッション保存競合を修正。P. Offset（フレーズオフセット）・Debug Log・Alt+T / Alt+P（Tempo / Phrase 編集）を追加。',
            ],
        },
        {
            version: '0.04',
            date: '2026年6月6日',
            items: [
                'Phrase 着色 ON 時に2リージョンを E で入れ替え（フレーズ定義の小節数も連動）。Ctrl+V のペースト先をコピー元直後に変更。セッション復元・Import 直後は最初の Audio Track を自動アクティブ化。入れ替えの Undo でリージョンと Phrase 定義を1回で復元。',
            ],
        },
        {
            version: '0.03',
            date: '2026年6月5日',
            items: [
                '波形ズームを 1×/32× 切替に簡素化し Lite Waveform と Center lock を削除。タイムライン描画をモジュール分割してセッション復元時の不具合を修正し、キーボードスクラブと ± 音量ショートカットを改善。',
            ],
        },
        {
            version: '0.02',
            date: '2026年5月30日',
            items: [
                '波形・追加音声・マーカーなど多岐にわたる JS を責務別モジュールへ再構成し、Import Review の Ex トラック復元不具合を修正。',
            ],
        },
        {
            version: '0.01',
            date: '2026年5月25日',
            items: ['初稿（初版リリース）'],
        },
    ];
