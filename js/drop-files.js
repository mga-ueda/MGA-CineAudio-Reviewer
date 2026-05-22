    function assignVideoFiles(files) {
        const list = files ? Array.from(files) : [];
        const videos = pickVideoFiles(list);
        if (videos.length === 0) {
            writeLog('Drop (video area): no playable video in selection');
            return;
        }
        const f = videos[0];
        if (videos.length > 1) {
            writeLog('Multiple videos dropped; using first: ' + f.name);
        }
        loadVideoFile(f);
        writeLog('Loaded video: ' + f.name);
    }

    function assignAudioFiles(files, dropTarget) {
        const list = files ? Array.from(files) : [];
        const audios = pickAudioFiles(list);
        if (audios.length === 0) {
            writeLog('Drop (waveform area): no playable audio in selection');
            return;
        }
        if (typeof window.assignExtraAudioFilesFromDrop === 'function') {
            window.assignExtraAudioFilesFromDrop(audios, dropTarget);
        } else if (typeof window.assignExtraAudioFiles === 'function') {
            window.assignExtraAudioFiles(audios);
        } else {
            writeLog('Drop (waveform area): extra audio module not ready');
        }
    }

    function assignFiles(files) {
        const list = files ? Array.from(files) : [];
        const videos = pickVideoFiles(list);
        const audios = pickAudioFiles(list);

        if (videos.length === 0 && audios.length === 0) {
            writeLog('Open files: no playable video or audio in selection (ignored)');
            return;
        }

        if (videos.length > 0) {
            assignVideoFiles(videos);
        }

        if (audios.length > 0) {
            assignAudioFiles(audios);
        }
    }

    function bindFileDropTarget(el, opts) {
        if (!el) return;
        const o = opts || {};
        const kind = o.kind || 'both';
        const logLabel = o.logLabel || 'Drop target';
        let depth = 0;

        el.classList.add('file-drop-target');
        if (kind === 'video') el.classList.add('file-drop-target--video');
        else if (kind === 'audio') el.classList.add('file-drop-target--audio');
        else el.classList.add('file-drop-target--both');

        const onFiles = (files, dropTarget) => {
            if (kind === 'video') assignVideoFiles(files);
            else if (kind === 'audio') assignAudioFiles(files, dropTarget);
            else assignFiles(files);
        };

        el.addEventListener('dragenter', (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
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
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
            el.classList.add('file-drop-target--dragover');
        });
        el.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            depth = Math.max(0, depth - 1);
            if (depth === 0) {
                el.classList.remove('file-drop-target--dragover');
                writeLog(logLabel + ': drag leave');
            }
        });
        el.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            depth = 0;
            el.classList.remove('file-drop-target--dragover');
            const files = e.dataTransfer && e.dataTransfer.files;
            if (files && files.length) {
                const names = Array.from(files).map((f) => f.name).join(', ');
                writeLog(logLabel + ': dropped ' + files.length + ' item(s): ' + names);
            } else {
                writeLog(logLabel + ': drop with no files');
            }
            onFiles(files, e.target);
        });
    }

    bindFileDropTarget(dropZone, { kind: 'both', logLabel: 'Drop zone' });

    dropZone.addEventListener('click', () => {
        writeLog('Drop zone: click -> open file picker');
        filePicker.click();
    });
    dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            writeLog('Drop zone: Enter -> open file picker');
            filePicker.click();
        }
    });

    bindFileDropTarget(panelMain, { kind: 'video', logLabel: 'Video panel' });
    bindFileDropTarget(audioWaveformComposite, {
        kind: 'audio',
        logLabel: 'Waveform panel',
    });
    if (typeof audioWaveformTrack !== 'undefined' && audioWaveformTrack) {
        bindFileDropTarget(audioWaveformTrack, {
            kind: 'audio',
            logLabel: 'Video audio lane',
        });
    }
    const extraCount =
        typeof window.EXTRA_TRACK_COUNT === 'number' ? window.EXTRA_TRACK_COUNT : 3;
    for (let slot = 0; slot < extraCount; slot++) {
        const track = document.getElementById('extraAudioTrack' + slot);
        const meta = document.getElementById('extraAudioMeta' + slot);
        if (track) {
            bindFileDropTarget(track, {
                kind: 'audio',
                logLabel: 'Extra audio lane ' + (slot + 1),
            });
        }
        if (meta) {
            bindFileDropTarget(meta, {
                kind: 'audio',
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
        if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
            e.preventDefault();
        }
    });
    document.addEventListener('drop', (e) => {
        if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
        if (isTypingTarget(e.target)) return;
        if (dropZone && dropZone.contains(e.target)) return;
        if (panelMain && panelMain.contains(e.target)) return;
        if (audioWaveformComposite && audioWaveformComposite.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        const names = Array.from(e.dataTransfer.files).map((f) => f.name).join(', ');
        writeLog('Document drop: ' + e.dataTransfer.files.length + ' item(s): ' + names);
        assignFiles(e.dataTransfer.files);
    });
