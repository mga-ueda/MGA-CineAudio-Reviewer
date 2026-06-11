/**
 * drop-files.js — ドラッグ＆ドロップ（ページ全体・波形レーン）とファイル割当。
 */
    const MGACR_REVIEW_FILE_EXT = '.mgacr';

    function pickMgacrReviewFiles(fileList) {
        return Array.from(fileList || []).filter(
            (f) => f && f.name && fileExtLower(f.name) === MGACR_REVIEW_FILE_EXT,
        );
    }

    function tryAssignMgacrReviewFiles(files) {
        const list = Array.from(files || []);
        const mgacr = pickMgacrReviewFiles(list);
        if (mgacr.length === 0) return false;
        const f = mgacr[0];
        const ignored = list.filter(
            (file) => file !== f && fileExtLower(file.name) !== MGACR_REVIEW_FILE_EXT,
        );
        if (mgacr.length > 1) {
            writeLog('Multiple .mgacr dropped; using first: ' + f.name);
        }
        if (ignored.length > 0) {
            const names = ignored.map((file) => file.name).join(', ');
            writeLog(
                'Drop: mixed selection — Import Review only (.mgacr). Ignored ' +
                    ignored.length +
                    ' other file(s): ' +
                    names,
            );
        }
        writeLog('Drop: Import Review — ' + f.name);
        if (typeof window.runImportReviewFromFile === 'function') {
            void window.runImportReviewFromFile(f);
        } else if (typeof window.importSessionPackage === 'function') {
            void window.importSessionPackage(f).catch((e) => {
                const msg = e && e.message ? e.message : String(e);
                writeLog('Import Review: failed — ' + msg);
                if (typeof showAppAlert === 'function') {
                    showAppAlert('インポートに失敗しました', msg, { log: false });
                }
            });
        } else {
            writeLog('Drop (.mgacr): Import Review module not ready');
        }
        return true;
    }

    function resolveAudioLaneDropTarget(el) {
        if (!el || typeof el.closest !== 'function') return null;
        const track = el.closest(
            '#audioWaveformTrack, [id^="extraAudioTrack"], .audio-waveform-lane__track, .extra-audio-lane__track',
        );
        if (track) return track;
        const meta = el.closest('[id^="extraAudioMeta"], .extra-audio-lane-meta');
        return meta || null;
    }

    function assignDroppedAudioFiles(audios, dropTarget, logLabel) {
        if (!audios || audios.length === 0) return;
        if (dropTarget && typeof window.assignExtraAudioFilesFromDrop === 'function') {
            window.assignExtraAudioFilesFromDrop(audios, dropTarget);
            return;
        }
        if (typeof window.assignExtraAudioFiles === 'function') {
            window.assignExtraAudioFiles(audios, undefined, { oneFilePerTrack: true });
            return;
        }
        writeLog((logLabel || 'Drop') + ': extra audio module not ready');
    }

    function handleDroppedFiles(files, opt) {
        const o = opt || {};
        const logLabel = o.logLabel || 'Drop';
        const list = files ? Array.from(files) : [];
        if (list.length === 0) {
            writeLog(logLabel + ': drop with no files');
            return;
        }

        if (tryAssignMgacrReviewFiles(files)) return;

        const videos = pickVideoFiles(list);
        const audios = pickAudioFiles(list);

        if (videos.length === 0 && audios.length === 0) {
            writeLog(logLabel + ': no supported files in selection (ignored)');
            return;
        }

        if (videos.length > 0) {
            const f = videos[0];
            if (videos.length > 1) {
                writeLog('Multiple videos dropped; using first: ' + f.name);
            }
            loadVideoFile(f);
            writeLog('Loaded video: ' + f.name);
        }

        assignDroppedAudioFiles(audios, o.dropTarget, logLabel);
    }

    function assignFiles(files) {
        handleDroppedFiles(files, { logLabel: 'Open files' });
    }

    function bindFileDropTarget(el, opts) {
        if (!el) return;
        const o = opts || {};
        const logLabel = o.logLabel || 'Drop target';
        let depth = 0;

        el.classList.add('file-drop-target');
        if (o.laneHighlight) el.classList.add('file-drop-target--audio');
        else el.classList.add('file-drop-target--both');

        el.addEventListener('dragenter', (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) {
                return;
            }
            e.preventDefault();
            depth += 1;
            if (depth === 1) {
                el.classList.add('file-drop-target--dragover');
                writeLog(logLabel + ': drag enter');
            }
        });
        el.addEventListener('dragover', (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) {
                return;
            }
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            el.classList.add('file-drop-target--dragover');
        });
        el.addEventListener('dragleave', (e) => {
            e.preventDefault();
            depth = Math.max(0, depth - 1);
            if (depth === 0) {
                el.classList.remove('file-drop-target--dragover');
                writeLog(logLabel + ': drag leave');
            }
        });
        el.addEventListener('drop', () => {
            depth = 0;
            el.classList.remove('file-drop-target--dragover');
        });
    }

    function pauseTransportBeforeOpenFilePicker() {
        if (typeof pauseTransportBeforeSeek === 'function') {
            pauseTransportBeforeSeek();
        }
    }

    function openFilePickerFromDropArea(label) {
        pauseTransportBeforeOpenFilePicker();
        writeLog(label + ': open file picker');
        filePicker.click();
    }

    bindFileDropTarget(panelMain, { logLabel: 'Video panel' });
    if (frameMain) {
        frameMain.addEventListener('click', () => {
            if (panelMain && panelMain.classList.contains('loaded')) return;
            openFilePickerFromDropArea('Video area');
        });
    }
    bindFileDropTarget(audioWaveformComposite, { logLabel: 'Waveform panel' });
    if (typeof audioWaveformTrack !== 'undefined' && audioWaveformTrack) {
        bindFileDropTarget(audioWaveformTrack, {
            laneHighlight: true,
            logLabel: 'Video audio lane',
        });
    }
    const extraCount = getExtraTrackCount();
    for (let slot = 0; slot < extraCount; slot++) {
        const track = document.getElementById('extraAudioTrack' + slot);
        const meta = document.getElementById('extraAudioMeta' + slot);
        if (track) {
            bindFileDropTarget(track, {
                laneHighlight: true,
                logLabel: 'Extra audio lane ' + (slot + 1),
            });
        }
        if (meta) {
            bindFileDropTarget(meta, {
                laneHighlight: true,
                logLabel: 'Extra audio meta ' + (slot + 1),
            });
        }
    }

    filePicker.addEventListener('change', () => {
        if (filePicker.files && filePicker.files.length) {
            const names = Array.from(filePicker.files).map((f) => f.name).join(', ');
            writeLog('File picker: selected ' + filePicker.files.length + ' file(s): ' + names);
            assignFiles(filePicker.files);
        }
        filePicker.value = '';
    });

    document.addEventListener('dragover', (e) => {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
        if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener(
        'drop',
        (e) => {
            if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
            if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return;
            e.preventDefault();
            e.stopPropagation();
            const names = Array.from(e.dataTransfer.files).map((f) => f.name).join(', ');
            writeLog('Document drop: ' + e.dataTransfer.files.length + ' item(s): ' + names);
            handleDroppedFiles(e.dataTransfer.files, {
                logLabel: 'Document drop',
                dropTarget: resolveAudioLaneDropTarget(e.target),
            });
        },
        true,
    );
