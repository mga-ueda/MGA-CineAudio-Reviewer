/**
 * markers-init.js — initMarkers と DOM イベント登録。
 */
    function initMarkers() {
        const markerPanelEl = document.getElementById('markerPanel');
        if (markerPanelEl) {
            markerPanelEl.addEventListener('pointerenter', () => {
                markerPanelPointerInside = true;
                updateMarkerListRowClasses();
            });
            markerPanelEl.addEventListener('pointerleave', () => {
                markerPanelPointerInside = false;
                markerPanelHoverId = null;
                updateMarkerListRowClasses();
            });
            markerPanelEl.addEventListener(
                'keydown',
                (e) => {
                    // テキスト入力中は編集を最優先し、TCナッジの横取りを防ぐ。
                    // ただし TC 欄は readOnly 入力としてナッジ対象にするため除外する。
                    const target = e.target;
                    const inMarkerTcInput =
                        target &&
                        target.closest &&
                        target.closest('.marker-table__tc-input');
                    if (
                        !inMarkerTcInput &&
                        typeof isTypingTarget === 'function' &&
                        (isTypingTarget(target) || isTypingTarget(document.activeElement))
                    ) {
                        return;
                    }
                    if (handleMarkerPanelTcNudgeKeydown(e)) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                    }
                },
                true,
            );
        }
        window.addEventListener(
            'keydown',
            (e) => {
                // 入力中はマーカー系グローバルショートカットを無効化する。
                // Alt+↑↓ の Feedback 行移動は編集中も有効にする。
                if (
                    !isMarkerFeedbackRowNavKeydown(e) &&
                    typeof isTypingTarget === 'function' &&
                    (isTypingTarget(e.target) || isTypingTarget(document.activeElement))
                ) {
                    return;
                }
                if (handleMarkerHideViewKeydown(e)) {
                    e.preventDefault();
                    e.stopPropagation();
                } else if (handleMarkerNavigationKeydown(e)) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            },
            true,
        );
        if (markerHideViewBtn) {
            markerHideViewBtn.addEventListener('click', () => {
                toggleMarkersDisplayHidden();
            });
        }
        if (markerCopyBtn) {
            markerCopyBtn.addEventListener('click', () => {
                copyMarkersToClipboard();
            });
        }
        if (markerPasteBtn) {
            markerPasteBtn.addEventListener('click', () => {
                if (markerPasteBtn.disabled) {
                    showMarkersPasteFormatError(
                        '動画または追加音声を読み込んでから貼り付けてください。',
                    );
                    return;
                }
                void pasteMarkersFromClipboard();
            });
        }
        if (markerClearAllBtn) {
            markerClearAllBtn.addEventListener('click', () => {
                if (markerClearAllBtn.disabled) return;
                const confirmPromise =
                    typeof requestAppConfirm === 'function'
                        ? requestAppConfirm(
                              'Markers Clear',
                              'すべてのマーカーと Memo が削除されます。よろしいですか？',
                              'Markers Clear: cancelled',
                          )
                        : Promise.resolve(false);
                void confirmPromise.then((confirmed) => {
                    if (!confirmed) return;
                    clearAllMarkers();
                });
            });
        }
        if (markerMemoTextarea) {
            markerMemoTextarea.addEventListener('input', () => {
                currentMarkerMemo = markerMemoTextarea.value;
                saveMarkerMemoToCache();
                updateMarkerClearAllButton();
                if (typeof schedulePersistSession === 'function') {
                    schedulePersistSession();
                }
            });
            markerMemoTextarea.addEventListener('keydown', (e) => {
                if (!matchUserShortcut(e, 'cancelEditing', { allowRepeat: true })) return;
                e.preventDefault();
                e.stopPropagation();
                markerMemoTextarea.blur();
                focusWaveformDrawingArea();
            });
        }
        updateMarkerHideViewButton();
        syncMarkerMemoTextarea();
        if (audioWaveformMarkers) {
            audioWaveformMarkers.replaceChildren();
            audioWaveformMarkers.style.display = 'none';
            audioWaveformMarkers.hidden = true;
        }
        renderMarkerList();
        renderSeekBarMarkers();
        updateMarkerRangeHint();
        updateMarkerCommentOverlay();

        const lanes =
            typeof audioWaveformLanesTracks !== 'undefined'
                ? audioWaveformLanesTracks
                : null;
        if (lanes) {
            let markerListPointerMoveRaf = 0;
            lanes.addEventListener('pointerenter', () => setWaveformLanesPointerInside(true));
            lanes.addEventListener('pointerleave', () => setWaveformLanesPointerInside(false));
            lanes.addEventListener('pointermove', () => {
                if (
                    !isWaveformMarkerHighlightEnabled() ||
                    isMarkerListPlaybackActive() ||
                    !waveformLanesPointerInside
                ) {
                    return;
                }
                if (markerListPointerMoveRaf) return;
                markerListPointerMoveRaf = requestAnimationFrame(() => {
                    markerListPointerMoveRaf = 0;
                    updateMarkerListRowClasses();
                });
            });
        }
        if (lanes && typeof ResizeObserver !== 'undefined') {
            let markerResizeRaf = 0;
            const obs = new ResizeObserver(() => {
                if (markerResizeRaf) return;
                markerResizeRaf = requestAnimationFrame(() => {
                    markerResizeRaf = 0;
                    if ((lanes.clientWidth | 0) > 0) {
                        if (typeof applyWaveformTimelineZoomLayout === 'function') {
                            applyWaveformTimelineZoomLayout();
                        }
                        renderSeekBarMarkers();
                    }
                });
            });
            obs.observe(lanes);
        }
    }

    window.initMarkers = initMarkers;
