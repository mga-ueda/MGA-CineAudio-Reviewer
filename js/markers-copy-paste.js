/**
 * markers-copy-paste.js — マーカー Copy/Paste（TSV・クリップボード）。
 */
    function markerCopyCellText(raw) {
        return String(raw ?? '')
            .replace(/\t/g, ' ')
            .replace(/\r\n/g, '\n')
            .replace(/\n+/g, ' ')
            .trim();
    }

    function markerCopyPad2(n) {
        return String(Math.max(0, n | 0)).padStart(2, '0');
    }

    function markerCopyPad3ms(n) {
        return String(Math.max(0, n | 0)).padStart(3, '0');
    }

    /** Copy / Paste 用: 映像秒 → 00:00:00.000（ミリ秒は常に 3 桁） */
    function formatMarkerCopyTimeMsFromVideoSec(videoSec) {
        const sec = Math.max(0, Number(videoSec) || 0);
        const totalMs = Math.round(sec * 1000);
        const ms = totalMs % 1000;
        const totalSec = Math.floor(totalMs / 1000);
        const s = totalSec % 60;
        const m = Math.floor(totalSec / 60) % 60;
        const h = Math.floor(totalSec / 3600);
        return (
            markerCopyPad2(h) +
            ':' +
            markerCopyPad2(m) +
            ':' +
            markerCopyPad2(s) +
            '.' +
            markerCopyPad3ms(ms)
        );
    }

    function markerTcHoursPartIsZero(tcLabel) {
        const m = String(tcLabel ?? '')
            .trim()
            .match(/^(\d+):(\d{2}):(\d{2})\.(\d{3})$/);
        if (!m) return false;
        return parseInt(m[1], 10) === 0;
    }

    /** Copy 時: 全マーカーの In/Out TC の「時」が 00 なら MM:SS.mmm へ短縮する */
    function allMarkerCopyTcsHaveZeroHours() {
        if (!currentMarkers.length) return false;
        for (let i = 0; i < currentMarkers.length; i++) {
            const m = currentMarkers[i];
            if (!markerTcHoursPartIsZero(markerTcLabelForCopy(markerInSec(m)))) {
                return false;
            }
            const outLabel = markerOutLabelForCopy(m);
            if (outLabel && !markerTcHoursPartIsZero(outLabel)) return false;
        }
        return true;
    }

    function markerTcLabelForCopy(transportSec, opt) {
        const videoSec = markerVideoSecForTransportSec(transportSec);
        const full = formatMarkerCopyTimeMsFromVideoSec(videoSec);
        if (opt && opt.omitZeroHours && markerTcHoursPartIsZero(full)) {
            return full.replace(/^00:/, '');
        }
        return full;
    }

    function markerOutLabelForCopy(m, opt) {
        if (!m || m.type !== 'range' || !markerHasOutTc(m)) return '';
        return markerTcLabelForCopy(m.endSec, opt);
    }

    const MARKER_PASTE_TC_MS_RE = /^(\d+):(\d{2}):(\d{2})\.(\d{3})$/;
    const MARKER_PASTE_TC_MS_SHORT_RE = /^(\d{2}):(\d{2})\.(\d{3})$/;

    function isMarkerPasteTcString(s) {
        const t = String(s ?? '').trim();
        return MARKER_PASTE_TC_MS_RE.test(t) || MARKER_PASTE_TC_MS_SHORT_RE.test(t);
    }

    /** Copy で「時」を省略した MM:SS.mmm → 00:MM:SS.mmm へ復元 */
    function normalizeMarkerPasteTcString(tcStr) {
        const t = String(tcStr ?? '').trim();
        if (MARKER_PASTE_TC_MS_SHORT_RE.test(t) && !MARKER_PASTE_TC_MS_RE.test(t)) {
            return '00:' + t;
        }
        return t;
    }

    /** Paste: 00:00:00.000 → 合計ミリ秒 */
    function markerPasteParseMsTcToTotalMs(tcStr) {
        const tc = normalizeMarkerPasteTcString(String(tcStr ?? '').trim());
        const m = tc.match(MARKER_PASTE_TC_MS_RE);
        if (!m) return null;
        const h = parseInt(m[1], 10);
        const mi = parseInt(m[2], 10);
        const s = parseInt(m[3], 10);
        const ms = parseInt(m[4], 10);
        if (![h, mi, s, ms].every((n) => Number.isFinite(n) && n >= 0)) return null;
        if (mi >= 60 || s >= 60 || ms >= 1000) return null;
        return (h * 3600 + mi * 60 + s) * 1000 + ms;
    }

    /** Paste: ミリ秒 TC → フレーム → トランスポート秒 */
    function transportSecFromMarkerCopyTcString(tcStr) {
        const totalMs = markerPasteParseMsTcToTotalMs(tcStr);
        if (totalMs == null || !markerTimelineReady()) return null;
        const videoSec = totalMs / 1000;
        const targetIdx = playbackFrameIndexForSide(videoSec, 'main');
        if (targetIdx == null || !Number.isFinite(targetIdx)) return null;
        const transportSec = transportSecFromPlaybackFrameIndex(targetIdx);
        if (transportSec == null) return null;
        return clampMarkerSec(transportSec);
    }

    function normalizeMarkersCopyPasteText(text) {
        return String(text ?? '')
            .replace(/^\uFEFF/, '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');
    }

    /** Copy 形式の ---MEMO--- 区切り位置（CRLF や先頭のみメモにも対応） */
    function findMarkerMemoDelimiterSplit(raw) {
        const text = normalizeMarkersCopyPasteText(raw);
        const inline = '\n' + MARKER_MEMO_COPY_DELIMITER + '\n';
        const idx = text.indexOf(inline);
        if (idx >= 0) {
            return {
                markersText: text.slice(0, idx),
                memoText: text.slice(idx + inline.length),
            };
        }
        const memoOnlyPrefix = MARKER_MEMO_COPY_DELIMITER + '\n';
        if (text.startsWith(memoOnlyPrefix)) {
            return {
                markersText: '',
                memoText: text.slice(memoOnlyPrefix.length),
            };
        }
        return { markersText: text, memoText: null };
    }

    function splitMarkersCopyPasteText(text) {
        return findMarkerMemoDelimiterSplit(text);
    }

    /** マーカー一覧表（Length 列なし）をタブ区切り文字列にする */
    function buildMarkersCopyTsvText() {
        const headers = ['#', 'In', 'Out', 'Feedback'];
        const lines = [headers.map(markerCopyCellText).join('\t')];
        const copyOpt = allMarkerCopyTcsHaveZeroHours() ? { omitZeroHours: true } : null;
        currentMarkers.forEach((m, idx) => {
            const row = [
                String(idx + 1),
                markerTcLabelForCopy(markerInSec(m), copyOpt),
                markerOutLabelForCopy(m, copyOpt),
                m.comment || '',
            ];
            lines.push(row.map(markerCopyCellText).join('\t'));
        });
        return lines.join('\n');
    }

    function buildMarkerMemoTableRowText(memo) {
        const memoText = markerCopyCellText(memo);
        if (!memoText) return '';
        const row = ['', '', '', memoText];
        return row.map(markerCopyCellText).join('\t');
    }

    function buildMarkersCopyClipboardText() {
        const memo = getCurrentMarkerMemoText();
        const memoTrim = String(memo || '').trim();
        if (!currentMarkers.length && !memoTrim) return '';
        let text = buildMarkersCopyTsvText();
        if (memoTrim) {
            const memoRow = buildMarkerMemoTableRowText(memo);
            if (memoRow) text += '\n' + memoRow;
        }
        return text;
    }

    async function copyMarkersToClipboard() {
        const text = buildMarkersCopyClipboardText();
        if (!text) {
            writeLog('Marker: nothing to copy');
            return;
        }
        try {
            if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
                throw new Error('clipboard unavailable');
            }
            await navigator.clipboard.writeText(text);
            const parts = [];
            if (currentMarkers.length) {
                parts.push(currentMarkers.length + ' row(s)');
            }
            if (hasMarkerMemoText()) parts.push('memo');
            writeLog('Marker: copied to clipboard (' + parts.join(', ') + ')');
            flashSeekHint('Markers', 'Copied', 'notice');
        } catch (err) {
            writeLog('Marker: clipboard copy failed');
            flashSeekHint('Markers', 'Copy failed', 'error');
        }
    }

    const MARKERS_PASTE_HEADERS = ['#', 'in', 'out', 'feedback'];

    function normalizeMarkersPasteHeaderCell(raw) {
        return String(raw ?? '')
            .replace(/^\uFEFF/, '')
            .trim()
            .toLowerCase();
    }

    function normalizeMarkersPasteColumns(parts) {
        const p = Array.from(parts || []);
        while (p.length < 4) p.push('');
        if (p.length > 4) {
            return [p[0], p[1], p[2], p.slice(3).join('\t')];
        }
        return p;
    }

    function splitMarkersPasteLine(line) {
        const s = String(line ?? '');
        if (s.includes('\t')) {
            return normalizeMarkersPasteColumns(s.split('\t'));
        }
        const trimmed = s.trim();
        const rowMatch = trimmed.match(
            /^(\S+)\s+(\d+:\d{1,2}:\d{1,2}:\d{1,2})(?:\s+(\d+:\d{1,2}:\d{1,2}:\d{1,2}))?(?:\s+(.*))?$/,
        );
        if (rowMatch) {
            return normalizeMarkersPasteColumns([
                rowMatch[1],
                rowMatch[2],
                rowMatch[3] || '',
                rowMatch[4] || '',
            ]);
        }
        const parts = trimmed.split(/\s+/);
        if (parts[0] === '#' && parts.length >= 4) {
            return normalizeMarkersPasteColumns([
                parts[0],
                parts[1],
                parts[2],
                parts.slice(3).join(' '),
            ]);
        }
        return normalizeMarkersPasteColumns([trimmed]);
    }

    function isMarkersPasteHeaderRow(cells) {
        if (!cells || cells.length < 4) return false;
        const h = cells.map((c) => normalizeMarkersPasteHeaderCell(c));
        if (h.some((x) => x === 'length')) return false;
        for (let i = 0; i < MARKERS_PASTE_HEADERS.length; i++) {
            if (h[i] !== MARKERS_PASTE_HEADERS[i]) return false;
        }
        return true;
    }

    function isMarkersPasteDataRow(cells) {
        return cells && cells.length >= 2 && isMarkerPasteTcString(cells[1]);
    }

    function markerMemoTableRowFeedbackText(cols) {
        return String(cols[3] ?? '')
            .replace(/^\uFEFF/, '')
            .trim();
    }

    function markerMemoTableRowLabelPrefixRe() {
        return new RegExp('^' + MARKER_MEMO_TABLE_ROW_LABEL + '\\s*:\\s*', 'i');
    }

    /** 表末尾メモ行: # / In / Out がすべて空で Feedback のみ */
    function isBareMarkerMemoTableRow(cols) {
        const num = String(cols[0] ?? '').trim();
        const inTc = String(cols[1] ?? '').trim();
        const outTc = String(cols[2] ?? '').trim();
        if (num || inTc || outTc) return false;
        return !!markerMemoTableRowFeedbackText(cols);
    }

    /** 従来形式: Additional Comments: …（In/Out 空） */
    function isLabeledMarkerMemoTableRow(cols) {
        const inTc = String(cols[1] ?? '').trim();
        const outTc = String(cols[2] ?? '').trim();
        if (inTc || outTc) return false;
        return markerMemoTableRowLabelPrefixRe().test(markerMemoTableRowFeedbackText(cols));
    }

    /** 末尾に連続するメモ行ブロックの先頭行インデックス（なければ lines.length） */
    function findTrailingMarkerMemoTableStartRow(lines, dataStartRow) {
        let start = lines.length;
        for (let row = lines.length - 1; row >= dataStartRow; row--) {
            const cols = splitMarkersPasteLine(lines[row]);
            if (cols.length < 4) break;
            if (isBareMarkerMemoTableRow(cols) || isLabeledMarkerMemoTableRow(cols)) {
                start = row;
            } else {
                break;
            }
        }
        return start;
    }

    function parseMarkerMemoFromTableRow(cols, opt) {
        const inTc = String(cols[1] ?? '').trim();
        const outTc = String(cols[2] ?? '').trim();
        if (inTc || outTc) return null;
        const feedback = markerMemoTableRowFeedbackText(cols);
        if (!feedback) return null;
        const labelRe = markerMemoTableRowLabelPrefixRe();
        if (labelRe.test(feedback)) return feedback.replace(labelRe, '').trim();
        if (opt && opt.allowBareMemoRow && isBareMarkerMemoTableRow(cols)) {
            return feedback;
        }
        return null;
    }

    /** Copy と同じ TSV（# / In / Out / Feedback、Length なし）を解析 */
    function parseMarkersPasteTsv(text) {
        const raw = String(text ?? '').trim();
        if (!raw) {
            return {
                ok: false,
                error: 'クリップボードが空です。Copy でコピーしたマーカー表を貼り付けてください。',
            };
        }
        const lines = raw.split(/\r?\n/).filter((line) => String(line).trim() !== '');
        if (!lines.length) {
            return {
                ok: false,
                error: '貼り付けデータに行がありません。',
            };
        }
        if (!markerTimelineReady()) {
            return {
                ok: false,
                error: '動画または追加音声を読み込んでから貼り付けてください。',
            };
        }
        const firstCells = splitMarkersPasteLine(lines[0]);
        let dataStartRow = 0;
        if (isMarkersPasteHeaderRow(firstCells)) {
            dataStartRow = 1;
            if (lines.length < 2) {
                return {
                    ok: false,
                    error: 'マーカー行がありません（見出し行の下に 1 行以上必要です）。',
                };
            }
        } else if (isMarkersPasteDataRow(firstCells)) {
            dataStartRow = 0;
        } else {
            const norm0 = firstCells.map((c) => normalizeMarkersPasteHeaderCell(c));
            if (norm0.some((h) => h === 'length')) {
                return {
                    ok: false,
                    error:
                        'Length 列は含めない形式です。# / In / Out / Feedback の 4 列（Copy と同じ）にしてください。',
                };
            }
            return {
                ok: false,
                error:
                    '見出し行は「#」「In」「Out」「Feedback」である必要があります（Copy と同じ形式）。先頭行に In のタイムコード（00:00:00.000 形式）が必要です。',
            };
        }
        const markers = [];
        const memoRows = [];
        const memoTableStartRow = findTrailingMarkerMemoTableStartRow(lines, dataStartRow);
        for (let row = dataStartRow; row < lines.length; row++) {
            const lineTrim = String(lines[row] ?? '')
                .replace(/^\uFEFF/, '')
                .trim();
            if (lineTrim === MARKER_MEMO_COPY_DELIMITER) {
                break;
            }
            const cols = splitMarkersPasteLine(lines[row]);
            if (cols.length < 4) {
                return {
                    ok: false,
                    error:
                        '行 ' +
                        row +
                        ' の列数が不足しています（# / In / Out / Feedback の 4 列、タブ区切り推奨）。',
                };
            }
            const memoFromTableRow = parseMarkerMemoFromTableRow(cols, {
                allowBareMemoRow: row >= memoTableStartRow,
            });
            if (memoFromTableRow != null) {
                if (memoFromTableRow) memoRows.push(memoFromTableRow);
                continue;
            }
            const inTc = String(cols[1] ?? '').trim();
            const outTc = String(cols[2] ?? '').trim();
            const comment = String(cols[3] ?? '');
            if (!inTc) {
                return {
                    ok: false,
                    error: '行 ' + row + ' の In タイムコードが空です。',
                };
            }
            if (!isMarkerPasteTcString(inTc)) {
                return {
                    ok: false,
                    error:
                        '行 ' +
                        row +
                        ' の In タイムコードが不正です（00:00:00.000 形式、ミリ秒 3 桁）: ' +
                        inTc,
                };
            }
            const inSec = transportSecFromMarkerCopyTcString(inTc);
            if (inSec == null) {
                return {
                    ok: false,
                    error:
                        '行 ' +
                        row +
                        ' の In を Copy と同じ形式で解釈できません: ' +
                        inTc +
                        '（タイムライン長・FPS を確認）',
                };
            }
            if (!outTc) {
                markers.push({
                    id: nextMarkerId(),
                    type: 'point',
                    timeSec: inSec,
                    comment,
                });
                continue;
            }
            if (!isMarkerPasteTcString(outTc)) {
                return {
                    ok: false,
                    error:
                        '行 ' +
                        row +
                        ' の Out タイムコードが不正です（00:00:00.000 形式、ミリ秒 3 桁）: ' +
                        outTc,
                };
            }
            const outSec = transportSecFromMarkerCopyTcString(outTc);
            if (outSec == null) {
                return {
                    ok: false,
                    error:
                        '行 ' +
                        row +
                        ' の Out を Copy と同じ形式で解釈できません: ' +
                        outTc,
                };
            }
            markers.push({
                id: nextMarkerId(),
                type: 'range',
                startSec: inSec,
                endSec: outSec,
                comment,
            });
        }
        if (!markers.length) {
            const memoTextOnly = memoRows.join('\n').trim();
            if (memoTextOnly) {
                return { ok: true, markers: [], memoText: memoTextOnly };
            }
            return {
                ok: false,
                error: 'マーカー行がありません。',
            };
        }
        return {
            ok: true,
            markers,
            memoText: memoRows.length ? memoRows.join('\n') : undefined,
        };
    }

    function applyMarkerMemoPasteText(memoText, opt) {
        if (memoText == null) return;
        setMarkerMemoText(memoText);
        saveMarkerMemoToCache();
        if (!(opt && opt.skipPersist)) {
            if (typeof schedulePersistSession === 'function') {
                schedulePersistSession();
            }
            if (typeof flushPersistSessionNow === 'function') {
                void flushPersistSessionNow().catch(() => {});
            }
        }
        updateMarkerClearAllButton();
    }

    function applyMarkersPasteSnapshot(arr, opt) {
        pendingRangeStartSec = null;
        activeMarkerId = null;
        sessionMarkersRestorePayload = null;
        resetInsertMarkerPressState();
        if (markersDisplayHidden) {
            markersDisplayHidden = false;
            applyMarkersDisplayVisibility();
        }
        setMarkersFromSnapshot(arr);
        if (opt && opt.memoText != null) {
            applyMarkerMemoPasteText(opt.memoText, { skipPersist: true });
        }
        if (typeof schedulePersistSession === 'function') {
            schedulePersistSession();
        }
        if (typeof flushPersistSessionNow === 'function') {
            void flushPersistSessionNow().catch(() => {});
        }
        updateMarkerClearAllButton();
        const parts = [arr.length + ' item(s)'];
        if (opt && opt.memoText != null && String(opt.memoText).trim()) {
            parts.push('memo');
        }
        writeLog('Marker: pasted from clipboard (' + parts.join(', ') + ')');
        flashSeekHint('Markers', 'Pasted', 'notice');
    }

    function showMarkersPasteFormatError(message) {
        writeLog('Marker: paste format error — ' + message);
        if (typeof showAppAlert === 'function') {
            showAppAlert('Markers Paste', message);
        } else {
            window.alert('Markers Paste\n\n' + message);
        }
        if (typeof flashSeekHint === 'function') {
            flashSeekHint('Markers', 'Paste failed', 'error');
        }
    }

    function readMarkersPasteTextFromOverlay() {
        return new Promise((resolve) => {
            const root = markerPasteOverlay;
            const textarea = markerPasteTextarea;
            const okBtn = markerPasteOk;
            const cancelBtn = markerPasteCancel;
            if (!root || !textarea || !okBtn || !cancelBtn) {
                resolve(null);
                return;
            }
            textarea.value = '';
            root.hidden = false;
            root.setAttribute('aria-hidden', 'false');
            const finish = (value) => {
                root.hidden = true;
                root.setAttribute('aria-hidden', 'true');
                okBtn.removeEventListener('click', onOk);
                cancelBtn.removeEventListener('click', onCancel);
                root.removeEventListener('keydown', onKey);
                resolve(value);
            };
            const onOk = () => finish(textarea.value);
            const onCancel = () => {
                writeLog('Marker: paste cancelled (dialog)');
                finish(null);
            };
            const onKey = (e) => {
                if (matchUserShortcut(e, 'cancelEditing', { allowRepeat: true })) {
                    e.preventDefault();
                    onCancel();
                }
            };
            okBtn.addEventListener('click', onOk);
            cancelBtn.addEventListener('click', onCancel);
            root.addEventListener('keydown', onKey);
            requestAnimationFrame(() => textarea.focus());
        });
    }

    async function readMarkersPasteClipboardText() {
        if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
            try {
                const text = await navigator.clipboard.readText();
                if (String(text ?? '').trim()) {
                    return text;
                }
                writeLog('Marker: clipboard empty — opening paste dialog');
            } catch (err) {
                writeLog(
                    'Marker: clipboard read failed — ' +
                        (err && err.message ? err.message : String(err)),
                );
            }
        } else {
            writeLog('Marker: clipboard.readText unavailable — opening paste dialog');
        }
        return readMarkersPasteTextFromOverlay();
    }

    async function confirmMarkersPasteReplace(count) {
        const body =
            'マーカー ' +
            count +
            ' 件で、現在のマーカー一覧をすべて置き換えます。よろしいですか？';
        if (typeof requestAppConfirm === 'function') {
            return requestAppConfirm('Markers Paste', body, 'Markers Paste: cancelled');
        }
        return window.confirm('Markers Paste\n\n' + body);
    }

    async function pasteMarkersFromClipboard() {
        try {
            if (!markerTimelineReady()) {
                showMarkersPasteFormatError(
                    '動画または追加音声を読み込んでから貼り付けてください。',
                );
                return;
            }
            writeLog('Marker: paste started');
            const text = await readMarkersPasteClipboardText();
            if (text == null) return;
            if (!String(text).trim()) {
                showMarkersPasteFormatError(
                    '貼り付けデータが空です。Copy でコピーした表を貼り付けてください。',
                );
                return;
            }
            const split = splitMarkersCopyPasteText(text);
            const markersPart = String(split.markersText || '').trim();
            const memoPart = split.memoText;
            if (!markersPart && memoPart == null) {
                showMarkersPasteFormatError(
                    '貼り付けデータが空です。Copy でコピーした表を貼り付けてください。',
                );
                return;
            }
            if (!markersPart && memoPart != null) {
                const confirmedMemo = await confirmMarkersPasteReplace(0);
                if (!confirmedMemo) return;
                applyMarkerMemoPasteText(memoPart);
                writeLog('Marker: memo pasted from clipboard');
                flashSeekHint('Markers', 'Memo pasted', 'notice');
                return;
            }
            const parsed = parseMarkersPasteTsv(split.markersText);
            if (!parsed.ok) {
                showMarkersPasteFormatError(parsed.error);
                return;
            }
            const mergedMemoText = memoPart != null ? memoPart : parsed.memoText;
            if (!parsed.markers.length && mergedMemoText != null) {
                const confirmedMemo = await confirmMarkersPasteReplace(0);
                if (!confirmedMemo) return;
                applyMarkerMemoPasteText(mergedMemoText);
                writeLog('Marker: memo pasted from clipboard');
                flashSeekHint('Markers', 'Memo pasted', 'notice');
                return;
            }
            const confirmed = await confirmMarkersPasteReplace(parsed.markers.length);
            if (!confirmed) return;
            applyMarkersPasteSnapshot(parsed.markers, {
                memoText: mergedMemoText != null ? mergedMemoText : undefined,
            });
        } catch (err) {
            writeLog(
                'Marker: paste failed — ' + (err && err.message ? err.message : String(err)),
            );
            showMarkersPasteFormatError(
                '貼り付け処理中にエラーが発生しました。ログを確認してください。',
            );
        }
    }

