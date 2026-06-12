/**
 * messages/apply-static.js — index.html 上の静的オーバーレイ／ダイアログ文言をカタログから反映。
 */
(function messagesApplyStaticModule() {
    function setText(id, key) {
        const el = document.getElementById(id);
        if (el) el.textContent = msg(key);
    }

    function setHtml(id, key) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = msg(key);
    }

    function setTitle(id, key) {
        const el = document.getElementById(id);
        if (el) el.title = msg(key);
    }

    function setAriaLabel(id, key) {
        const el = document.getElementById(id);
        if (el) el.setAttribute('aria-label', msg(key));
    }

    function applyStaticUiMessages() {
        setText('exportBlockingTitle', 'overlay.export.webmTitle');
        setHtml('exportBlockingEscHint', 'overlay.export.escHint');
        setText('videoLoadLockPrimary', 'overlay.videoLoad.primary');
        setText('videoLoadLockStatus', 'overlay.videoLoad.loadingVideo');

        setText('markerPasteOverlayTitle', 'dialog.markersPaste.title');
        const pasteBody = document.querySelector('#markerPasteOverlay .app-confirm-overlay__body');
        if (pasteBody) pasteBody.textContent = msg('dialog.markersPaste.overlayBody');
        setAriaLabel('markerPasteTextarea', 'dialog.markersPaste.textareaLabel');
        setTitle('markerPasteTextarea', 'dialog.markersPaste.textareaTitle');
        setText('markerPasteCancel', 'dialog.common.cancel');
        setTitle('markerPasteCancel', 'dialog.markersPaste.cancelTitle');
        setText('markerPasteOk', 'dialog.common.ok');
        setTitle('markerPasteOk', 'dialog.markersPaste.okTitle');

        setText('appConfirmCancel', 'dialog.common.cancel');
        setTitle('appConfirmCancel', 'dialog.common.cancelTitle');
        setText('appConfirmOk', 'dialog.common.ok');
        setTitle('appConfirmOk', 'dialog.common.okTitle');

        setTitle('appVersionBadge', 'tooltip.versionBadge');
        setAriaLabel('appVersionBadge', 'tooltip.versionBadge');
        setTitle('panelMain', 'tooltip.fileDrop');
        setTitle('audioWaveformComposite', 'tooltip.fileDrop');
        setTitle('transportGuideLink', 'tooltip.guideLink');
        setTitle('transportShortcutsLink', 'tooltip.shortcutsLink');
        setTitle('musicalGridPlayheadPos', 'tooltip.musicalGridPlayheadPos');
        setTitle('spectrumFloorDbSelect', 'tooltip.spectrumFloorDb');
        setTitle('meterFloorDbSelect', 'tooltip.meterFloorDb');
        setTitle('sessionSaveIndicator', 'ui.sessionSave.idle');
    }

    window.applyStaticUiMessages = applyStaticUiMessages;
    applyStaticUiMessages();
})();
