/**
 * 共有ランタイム: トラック数・オプショナル window API 呼び出し・トランスポート停止。
 * dom-refs 直後に読み込み、他モジュールより先に利用可能にする。
 */
(function () {
    const DEFAULT_EXTRA_TRACK_COUNT = 16;

    function getExtraTrackCount() {
        const n = window.EXTRA_TRACK_COUNT;
        return typeof n === 'number' && n > 0 ? Math.floor(n) : DEFAULT_EXTRA_TRACK_COUNT;
    }

    /** window 上の関数があれば呼ぶ（未定義モジュール境界用） */
    function callIf(name, ...args) {
        const fn = window[name];
        if (typeof fn === 'function') return fn(...args);
        return undefined;
    }

    /**
     * セッション変更・クリア・Import 前に再生を止める。
     * ループ／リージョンは既定で silent 解除（UI ログを抑える）。
     */
    function haltTransportForSessionMutation(opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const loopRegionOpt = { silent: o.silent !== false };

        if (typeof pauseTransportBeforeSeek === 'function') {
            pauseTransportBeforeSeek();
        } else {
            if (typeof transportPlayGeneration !== 'undefined') {
                transportPlayGeneration += 1;
            }
            if (typeof transportPlayInFlight !== 'undefined') {
                transportPlayInFlight = null;
            }
            callIf('clearTransportTailPlayback');
            if (typeof videoMain !== 'undefined' && videoMain) {
                try {
                    videoMain.pause();
                } catch (_) {}
            }
            callIf('stopAllExtraTrackSources');
            callIf('setPlayingUi', false);
            callIf('stopRaf');
        }

        if (o.clearLoopAndRegion !== false) {
            callIf('clearRangeLoopPlayback', loopRegionOpt);
            callIf('clearPlaybackRegion', loopRegionOpt);
        }
    }

    /** タブ非表示・pagehide 前: 再生のみ停止（永続化は呼び出し側） */
    function haltTransportOnPageExit() {
        haltTransportForSessionMutation({ silent: true });
    }

    window.getExtraTrackCount = getExtraTrackCount;
    window.callIf = callIf;
    window.haltTransportForSessionMutation = haltTransportForSessionMutation;
    window.haltTransportOnPageExit = haltTransportOnPageExit;
})();
