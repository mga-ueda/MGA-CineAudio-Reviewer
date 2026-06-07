/**
 * timeline-musical-slots-diag.js — [MusicalSlot] 診断ログ（入れ替え調査用）
 *
 * ログ枠の Debug Log が ON のときのみ出力（localStorage に保存）
 * 手動: musicalSlotDiagDumpOriginBindings(0) / musicalSlotDiagDumpTrack(0)
 */
(function timelineMusicalSlotsDiagModule() {
    const LOG_PREFIX = '[MusicalSlot]';

    function musicalSlotDiagEnabled() {
        if (typeof window.isDebugLogEnabled === 'function') {
            return window.isDebugLogEnabled();
        }
        if (typeof window !== 'undefined' && typeof window.musicalSlotDiagEnabled === 'boolean') {
            return window.musicalSlotDiagEnabled;
        }
        if (
            typeof window !== 'undefined' &&
            typeof window.regionSwapDiagEnabled === 'boolean'
        ) {
            return window.regionSwapDiagEnabled;
        }
        return false;
    }

    function musicalSlotDiagFmtSec(v) {
        return Number.isFinite(v) ? ((v | 0) === v ? String(v) : v.toFixed(4) + 's') : String(v);
    }

    function musicalSlotDiagFmtPayload(payload) {
        if (payload == null) return '';
        if (typeof payload === 'string') return payload;
        return JSON.stringify(payload, (_, v) =>
            Number.isFinite(v) && Math.abs(v) < 1e6 && Math.abs(v) > 0.0001
                ? Math.round(v * 10000) / 10000
                : v,
        );
    }

    function musicalSlotDiagLog(stage, payload) {
        if (!musicalSlotDiagEnabled() || typeof writeLog !== 'function') return;
        const tail = musicalSlotDiagFmtPayload(payload);
        writeLog(LOG_PREFIX + ' ' + stage + (tail ? ' | ' + tail : ''));
    }

    function musicalSlotDiagPhraseSnapshot() {
        let text = '';
        let meter = '';
        if (typeof getMusicalGridPersistSnapshot === 'function') {
            const snap = getMusicalGridPersistSnapshot();
            if (snap) {
                if (snap.phrase != null) text = String(snap.phrase);
                if (snap.meter != null) meter = String(snap.meter);
            }
        }
        const fill =
            typeof window.getMusicalGridPhraseFillVisible === 'function' &&
            window.getMusicalGridPhraseFillVisible();
        const counts =
            typeof window.getExpandedPhraseGroupBarCountsSnapshot === 'function'
                ? window.getExpandedPhraseGroupBarCountsSnapshot()
                : [];
        return { text, meter, fill: !!fill, counts, countsHead: counts.slice(0, 12) };
    }

    function musicalSlotDiagSummarizeSwapUnit(slot, unitIndex) {
        if (!slot) return null;
        const m = slot.musical || {};
        const row = {
            unit: (unitIndex | 0) + 1,
            kind: slot.kind,
            musical: {
                contentBars: m.contentBarCount | 0,
                phraseBars: m.phraseBarCount | 0,
                phraseIdx:
                    m.phraseSlotIndex >= 0
                        ? phraseSlotLabelForDiagnostics(m.phraseSlotIndex)
                        : null,
                originIdx:
                    m.originPhraseSlotIndex >= 0
                        ? phraseSlotLabelForDiagnostics(m.originPhraseSlotIndex)
                        : null,
                meterBarStart: m.meterBarStart | 0,
            },
            timeline: {
                in: musicalSlotDiagFmtSec(slot.timelineStartSec),
                out: musicalSlotDiagFmtSec(slot.timelineEndSec),
            },
        };
        if (slot.kind === 'silent') {
            row.silentGapIndex = (slot.silentGapIndex | 0) + 1;
        } else if (slot.segmentRefs && slot.segmentRefs.length) {
            row.regions = slot.segmentRefs.map((r) => (r.segmentIndex | 0) + 1);
            if (slot.regionGroupId) row.groupId = slot.regionGroupId;
        }
        return row;
    }

    function musicalSlotDiagSummarizeSelectionEntry(entry, track, slots) {
        if (!entry) return null;
        if (entry.segmentIndex < 0) {
            return {
                kind: 'silent',
                silentGapIndex: (entry.silentGapIndex | 0) + 1,
                ex: (entry.slot | 0) + 1,
            };
        }
        const unitIdx =
            typeof window.resolveTimelineSlotIndexForSelection === 'function'
                ? window.resolveTimelineSlotIndexForSelection(track, entry, slots)
                : -1;
        const unit =
            unitIdx >= 0 && slots[unitIdx]
                ? musicalSlotDiagSummarizeSwapUnit(slots[unitIdx], unitIdx)
                : null;
        return {
            kind: 'audio',
            region: (entry.segmentIndex | 0) + 1,
            ex: (entry.slot | 0) + 1,
            swapUnit: unitIdx >= 0 ? unitIdx + 1 : null,
            unit,
        };
    }

    function resolveMusicalSlotDiagTrackRef(trackOrSlot) {
        if (trackOrSlot != null && typeof trackOrSlot === 'object' && trackOrSlot.type === 'extra') {
            return trackOrSlot;
        }
        if (typeof trackOrSlot === 'number' && trackOrSlot >= 0) {
            return { type: 'extra', slot: trackOrSlot | 0 };
        }
        return null;
    }

    function musicalSlotDiagDumpTrack(trackOrSlot, label) {
        const track = resolveMusicalSlotDiagTrackRef(trackOrSlot);
        if (!track) {
            musicalSlotDiagLog('dump/error', { label, error: 'invalid track' });
            return;
        }
        const phrase = musicalSlotDiagPhraseSnapshot();
        const slots =
            typeof getTrackTimelineSlots === 'function'
                ? getTrackTimelineSlots(track, { writeCache: false })
                : [];
        const swapUnits = slots.map((s, i) => musicalSlotDiagSummarizeSwapUnit(s, i));
        const ranges =
            typeof window.getPhraseGroupRangesSnapshot === 'function'
                ? window.getPhraseGroupRangesSnapshot()
                : [];
        const rangePreview = [];
        for (let i = 0; i < Math.min(ranges.length, 12); i++) {
            rangePreview.push({
                phrase: i + 1,
                start: musicalSlotDiagFmtSec(ranges[i].startSec),
                end: musicalSlotDiagFmtSec(ranges[i].endSec),
            });
        }
        const selection =
            typeof regionSelectionEntries !== 'undefined' && regionSelectionEntries.length
                ? regionSelectionEntries.map((e) =>
                      musicalSlotDiagSummarizeSelectionEntry(e, track, slots),
                  )
                : [];
        const engine = isTimelineSlotRegionSwapEnabled() ? 'slot' : 'legacy';
        musicalSlotDiagLog('dump/' + (label || 'snapshot'), {
            ex: track.slot + 1,
            engine,
            phrase: {
                text: phrase.text,
                meter: phrase.meter,
                fill: phrase.fill,
                countsHead: phrase.countsHead,
                countLen: phrase.counts.length,
            },
            swapUnits,
            unitCount: swapUnits.length,
            selection,
            phraseRanges: rangePreview,
            rangeCount: ranges.length,
        });
    }

    function musicalSlotDiagDumpSelectionTracks(label) {
        const slots = new Set();
        if (typeof regionSelectionEntries !== 'undefined') {
            for (let i = 0; i < regionSelectionEntries.length; i++) {
                slots.add(regionSelectionEntries[i].slot);
            }
        }
        if (!slots.size) slots.add(0);
        for (const slot of slots) {
            musicalSlotDiagDumpTrack({ type: 'extra', slot }, label);
        }
    }

    function phraseSlotLabelForDiagnostics(phraseSlotIndex) {
        const i = phraseSlotIndex | 0;
        if (i < 0) return null;
        if (typeof window.rehearsalMarkLabelForPhraseSlotIndex === 'function') {
            return window.rehearsalMarkLabelForPhraseSlotIndex(i);
        }
        if (typeof window.phraseGroupLabelForIndex === 'function') {
            return window.phraseGroupLabelForIndex(i);
        }
        return String(i + 1);
    }

    function originLabelForPhraseSlotIndex(idx) {
        return phraseSlotLabelForDiagnostics(idx);
    }
    function musicalSlotDiagSummarizeMusicalOrigin(m) {
        const binding = m && typeof m === 'object' ? m : {};
        const phraseIdx = binding.phraseSlotIndex | 0;
        const originIdx =
            Number.isFinite(binding.originPhraseSlotIndex) && binding.originPhraseSlotIndex >= 0
                ? binding.originPhraseSlotIndex | 0
                : null;
        return {
            phraseSlotIndex: phraseIdx >= 0 ? phraseIdx : null,
            phraseLabel: phraseIdx >= 0 ? originLabelForPhraseSlotIndex(phraseIdx) : null,
            originPhraseSlotIndex: originIdx,
            originLabel: originIdx != null ? originLabelForPhraseSlotIndex(originIdx) : null,
            moved: originIdx != null && phraseIdx >= 0 && originIdx !== phraseIdx,
        };
    }

    function musicalSlotDiagDescribeOriginRef(track, ref, label) {
        const r = ref && typeof ref === 'object' ? ref : {};
        const slots =
            typeof getTrackTimelineSlots === 'function'
                ? getTrackTimelineSlots(track, { writeCache: false })
                : [];
        let unitIdx = -1;
        if (
            Number.isFinite(r.segmentIndex) &&
            (r.segmentIndex | 0) >= 0 &&
            typeof window.resolveTimelineSlotIndexForSelection === 'function'
        ) {
            unitIdx = window.resolveTimelineSlotIndexForSelection(
                track,
                { segmentIndex: r.segmentIndex | 0 },
                slots,
            );
        } else if (Number.isFinite(r.silentGapIndex) && (r.silentGapIndex | 0) >= 0) {
            unitIdx = slots.findIndex(
                (s) =>
                    s.kind === 'silent' && (s.silentGapIndex | 0) === (r.silentGapIndex | 0),
            );
        }
        const slot = unitIdx >= 0 ? slots[unitIdx] : null;
        const binding =
            typeof resolveSwapUnitMusicalBinding === 'function'
                ? resolveSwapUnitMusicalBinding(track, r)
                : slot && slot.musical && typeof window.cloneMusicalBinding === 'function'
                  ? window.cloneMusicalBinding(slot.musical)
                  : null;
        const originIdx =
            typeof resolveSwapUnitOriginPhraseSlotIndex === 'function'
                ? resolveSwapUnitOriginPhraseSlotIndex(track, r)
                : null;
        const row = {
            label: label || null,
            ref: Number.isFinite(r.segmentIndex)
                ? { region: (r.segmentIndex | 0) + 1 }
                : Number.isFinite(r.silentGapIndex)
                  ? { silentGap: (r.silentGapIndex | 0) + 1 }
                  : r,
            entitySegmentIndex:
                Number.isFinite(r.segmentIndex) && (r.segmentIndex | 0) >= 0
                    ? r.segmentIndex | 0
                    : undefined,
            unitIdx: unitIdx >= 0 ? unitIdx + 1 : null,
            slotId: slot ? slot.id : null,
            identity:
                slot && typeof window.swapUnitIdentityKey === 'function'
                    ? window.swapUnitIdentityKey(slot)
                    : null,
            musical: musicalSlotDiagSummarizeMusicalOrigin(binding),
            displayLabel:
                typeof formatSwapUnitOriginLabelText === 'function'
                    ? formatSwapUnitOriginLabelText(track, r)
                    : null,
            bindingResolved: !!binding,
        };
        if (!binding) row.resolveError = 'no musical binding';
        return row;
    }

    function musicalSlotDiagCollectOriginBindings(track) {
        const rows = [];
        if (
            typeof window.getTrackSegments !== 'function' ||
            typeof window.resolveRegionSwapUnitSegmentIndices !== 'function'
        ) {
            return rows;
        }
        const segments = window.getTrackSegments(track);
        const leaders = new Set();
        for (let si = 0; si < segments.length; si++) {
            const unit = window.resolveRegionSwapUnitSegmentIndices(track, si);
            const leader = unit && unit.length ? unit[0] | 0 : si;
            if (leaders.has(leader)) continue;
            leaders.add(leader);
            rows.push(
                musicalSlotDiagDescribeOriginRef(
                    track,
                    { segmentIndex: leader },
                    'region ' + (leader + 1),
                ),
            );
        }
        if (typeof window.collectTrackSilentGaps === 'function') {
            const gaps = window.collectTrackSilentGaps(track);
            for (let gi = 0; gi < gaps.length; gi++) {
                rows.push(
                    musicalSlotDiagDescribeOriginRef(
                        track,
                        { silentGapIndex: gi },
                        'silent ' + (gi + 1),
                    ),
                );
            }
        }
        return rows;
    }

    function musicalSlotDiagOriginReadableLine(row) {
        if (!row) return '(empty)';
        const m = row.musical || {};
        const parts = [
            row.label || '?',
            '左下表示=' + (row.displayLabel || '—'),
            '保持origin=' + (m.originLabel || '—'),
            '現在枠=' + (m.phraseLabel || '—'),
        ];
        if (m.moved) parts.push('枠移動あり');
        if (!row.bindingResolved) parts.push('**musical未解決**');
        if (row.identity) parts.push('entity=' + row.identity);
        if (row.unitIdx != null) parts.push('swapUnit#' + row.unitIdx);
        if (row.slotId) parts.push('slotId=' + row.slotId);
        return parts.join(' | ');
    }

    function musicalSlotDiagAnalyzeOriginIssues(bindings) {
        const issues = [];
        if (!bindings || !bindings.length) {
            issues.push('リージョン／無音の origin 行が 0 件');
            return issues;
        }
        for (let i = 0; i < bindings.length; i++) {
            const row = bindings[i];
            const label = row.label || 'item ' + (i + 1);
            const m = row.musical || {};
            if (!row.bindingResolved) {
                issues.push(label + ': SwapUnit musical 绑定が取れない → 左下ラベル不可');
                continue;
            }
            if (!m.originLabel) {
                issues.push(label + ': originPhraseSlotIndex 未設定');
            }
            if (!row.displayLabel) {
                issues.push(label + ': 左下表示ラベルが空');
            }
            if (
                row.displayLabel &&
                m.originLabel &&
                row.displayLabel !== m.originLabel
            ) {
                issues.push(
                    label +
                        ': 左下表示(' +
                        row.displayLabel +
                        ') ≠ 保持origin(' +
                        m.originLabel +
                        ')',
                );
            }
            if (
                row.displayLabel &&
                m.phraseLabel &&
                !m.moved &&
                row.displayLabel !== m.phraseLabel &&
                row.displayLabel === m.originLabel
            ) {
                issues.push(
                    label +
                        ': 未移動なのに左下(' +
                        row.displayLabel +
                        ') ≠ 現在枠(' +
                        m.phraseLabel +
                        ') — 要確認',
                );
            }
            if (m.moved && row.displayLabel && row.displayLabel === m.phraseLabel) {
                issues.push(
                    label +
                        ': 枠移動済みなのに左下が現在枠(' +
                        m.phraseLabel +
                        ')と同じ — origin(' +
                        (m.originLabel || '?') +
                        ')が表示されていない疑い',
                );
            }
            if (Number.isFinite(row.entitySegmentIndex)) {
                const entityLabel = originLabelForPhraseSlotIndex(row.entitySegmentIndex | 0);
                if (
                    entityLabel &&
                    m.phraseLabel &&
                    m.originLabel &&
                    entityLabel !== m.phraseLabel &&
                    m.originLabel === m.phraseLabel &&
                    !m.moved
                ) {
                    issues.push(
                        label +
                            ': 初回番号が失われている — entity=' +
                            entityLabel +
                            ' だが origin=現在枠=' +
                            m.phraseLabel +
                            '（入替後は origin=' +
                            entityLabel +
                            ', 現在枠=' +
                            m.phraseLabel +
                            ' が正しい）',
                    );
                }
                if (
                    entityLabel &&
                    m.originLabel &&
                    m.phraseLabel &&
                    entityLabel !== m.phraseLabel &&
                    entityLabel === m.originLabel &&
                    !m.moved
                ) {
                    issues.push(
                        label +
                            ': 枠移動ありだが moved=false — origin=' +
                            m.originLabel +
                            ', 現在枠=' +
                            m.phraseLabel,
                    );
                }
            }
        }
        return issues;
    }

    function musicalSlotDiagWriteReadableLines(stage, lines) {
        if (!musicalSlotDiagEnabled() || typeof writeLog !== 'function' || !lines || !lines.length) {
            return;
        }
        writeLog(LOG_PREFIX + ' ' + stage + ' === 読み取り用サマリー ===');
        for (let i = 0; i < lines.length; i++) {
            writeLog(LOG_PREFIX + '   ' + lines[i]);
        }
    }

    function musicalSlotDiagLogOriginReport(track, stage, opt) {
        const o = opt && typeof opt === 'object' ? opt : {};
        const bindings = musicalSlotDiagCollectOriginBindings(track);
        const summary = bindings.map(musicalSlotDiagOriginReadableLine);
        const issues = musicalSlotDiagAnalyzeOriginIssues(bindings);
        const ex = (track.slot | 0) + 1;
        if (o.writeLines !== false) {
            musicalSlotDiagWriteReadableLines(stage + ' Ex' + ex, summary);
            if (issues.length) {
                writeLog(LOG_PREFIX + ' ' + stage + ' Ex' + ex + ' === 検出した問題 ===');
                for (let i = 0; i < issues.length; i++) {
                    writeLog(LOG_PREFIX + '   ! ' + issues[i]);
                }
            } else {
                writeLog(
                    LOG_PREFIX +
                        ' ' +
                        stage +
                        ' Ex' +
                        ex +
                        ': OK — 左下=保持origin、入替済みは origin≠現在枠',
                );
            }
        }
        musicalSlotDiagLog(stage, {
            ex,
            summary,
            issues: issues.length ? issues : undefined,
            ok: !issues.length,
            bindings,
        });
        return { bindings, summary, issues };
    }

    function musicalSlotDiagLogPersistCacheMerge(track, units, persisted, mergeByIdentity) {
        if (!persisted || !units || !units.length || !persisted.length) {
            return;
        }
        const rows = [];
        let mismatchCount = 0;
        const persistedByIdentity = new Map();
        for (let p = 0; p < persisted.length; p++) {
            const slot = persisted[p];
            if (!slot) continue;
            const key =
                typeof window.swapUnitIdentityKey === 'function'
                    ? window.swapUnitIdentityKey(slot)
                    : null;
            if (key != null && !persistedByIdentity.has(key)) persistedByIdentity.set(key, slot);
        }
        for (let i = 0; i < units.length; i++) {
            const built = units[i];
            const builtKey =
                typeof window.swapUnitIdentityKey === 'function'
                    ? window.swapUnitIdentityKey(built)
                    : null;
            const cached = mergeByIdentity
                ? builtKey != null
                    ? persistedByIdentity.get(builtKey) || null
                    : null
                : persisted[i];
            const cachedKey =
                cached && typeof window.swapUnitIdentityKey === 'function'
                    ? window.swapUnitIdentityKey(cached)
                    : null;
            const match = !!cached && builtKey === cachedKey;
            if (!match) mismatchCount++;
            rows.push({
                index: i,
                identityMatch: match,
                built: {
                    identity: builtKey,
                    kind: built && built.kind,
                    regions:
                        built && built.segmentRefs
                            ? built.segmentRefs.map((r) => (r.segmentIndex | 0) + 1)
                            : null,
                    silentGap:
                        built && built.kind === 'silent'
                            ? (built.silentGapIndex | 0) + 1
                            : null,
                },
                cached: {
                    identity: cachedKey,
                    id: cached && cached.id,
                    kind: cached && cached.kind,
                    regions:
                        cached && cached.segmentRefs
                            ? cached.segmentRefs.map((r) => (r.segmentIndex | 0) + 1)
                            : null,
                    silentGap:
                        cached && cached.kind === 'silent'
                            ? (cached.silentGapIndex | 0) + 1
                            : null,
                    musical: musicalSlotDiagSummarizeMusicalOrigin(cached && cached.musical),
                },
                mergedMusical: musicalSlotDiagSummarizeMusicalOrigin(cached && cached.musical),
            });
        }
        if (!musicalSlotDiagEnabled()) return;
        const ex = (track.slot | 0) + 1;
        if (mismatchCount > 0 && typeof writeLog === 'function') {
            writeLog(
                LOG_PREFIX +
                    ' origin/cache-merge Ex' +
                    ex +
                    ': **警告** index不一致 ' +
                    mismatchCount +
                    '/' +
                    units.length +
                    ' — 別ユニットの origin が付いた可能性',
            );
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                if (r.identityMatch) continue;
                writeLog(
                    LOG_PREFIX +
                        '   [' +
                        r.index +
                        '] built=' +
                        r.built.identity +
                        ' (R' +
                        (r.built.regions || '—') +
                        ') ← cache=' +
                        r.cached.identity +
                        ' origin=' +
                        (r.cached.musical && r.cached.musical.originLabel
                            ? r.cached.musical.originLabel
                            : '?') +
                        ' phrase=' +
                        (r.cached.musical && r.cached.musical.phraseLabel
                            ? r.cached.musical.phraseLabel
                            : '?'),
                );
            }
        }
        musicalSlotDiagLog('origin/cache-merge', {
            ex,
            unitCount: units.length,
            persistedCount: persisted.length,
            mergeMode: mergeByIdentity ? 'identity' : 'index',
            identityMismatchCount: mismatchCount,
            allMatch: mismatchCount === 0,
            warning:
                mismatchCount > 0
                    ? mergeByIdentity
                        ? 'rebuild entity が cache に無い、または identity 不一致'
                        : 'cache index と rebuild 順が一致しない — origin が別ユニットに付く可能性'
                    : undefined,
            rows,
        });
    }
    function musicalSlotDiagDumpOriginBindings(trackOrSlot, label) {
        const track = resolveMusicalSlotDiagTrackRef(trackOrSlot);
        if (!track) {
            musicalSlotDiagLog('origin/dump/error', { label, error: 'invalid track' });
            return;
        }
        const slots =
            typeof getTrackTimelineSlots === 'function'
                ? getTrackTimelineSlots(track, { writeCache: false })
                : [];
        const state =
            typeof window.getPlaybackRegionsState === 'function'
                ? window.getPlaybackRegionsState(track)
                : null;
        const cached = state && Array.isArray(state.timelineSlots) ? state.timelineSlots : [];
        const bindings = musicalSlotDiagCollectOriginBindings(track);
        const summary = bindings.map(musicalSlotDiagOriginReadableLine);
        const issues = musicalSlotDiagAnalyzeOriginIssues(bindings);
        musicalSlotDiagLog('origin/dump/' + (label || 'manual'), {
            ex: track.slot + 1,
            summary,
            issues: issues.length ? issues : undefined,
            bindings,
            swapUnits: slots.map((s, i) => musicalSlotDiagSummarizeSwapUnit(s, i)),
            cachedOrder: cached.map((s, i) => ({
                index: i,
                id: s && s.id,
                identity:
                    typeof window.swapUnitIdentityKey === 'function'
                        ? window.swapUnitIdentityKey(s)
                        : null,
                musical: musicalSlotDiagSummarizeMusicalOrigin(s && s.musical),
            })),
            legend:
                '左下表示=波形左下ラベル | 保持origin=初回番号(不変) | 現在枠=タイムライン上の枠 | 枠移動あり=入れ替え後正常',
        });
    }
    function logSessionRestoreMusicalSlotSnapshot() {
        if (!musicalSlotDiagEnabled()) return;
        const phrase = musicalSlotDiagPhraseSnapshot();
        const n =
            typeof window.getExtraTrackCount === 'function' ? window.getExtraTrackCount() : 0;
        if (typeof writeLog === 'function') {
            writeLog(
                LOG_PREFIX +
                    ' session/restore === 開始 === Phrase="' +
                    (phrase.text || '') +
                    '" fill=' +
                    (phrase.fill ? 'ON' : 'OFF') +
                    ' counts=' +
                    JSON.stringify(phrase.countsHead),
            );
        }
        musicalSlotDiagLog('session/restore/phrase', {
            phraseText: phrase.text,
            phraseMeter: phrase.meter,
            phraseFill: phrase.fill,
            countsHead: phrase.countsHead,
            countLen: phrase.counts.length,
        });
        const allIssues = [];
        let reportedTracks = 0;
        for (let slot = 0; slot < n; slot++) {
            const track = resolveMusicalSlotDiagTrackRef(slot);
            if (
                typeof window.isTrackRegionActive !== 'function' ||
                !window.isTrackRegionActive(track)
            ) {
                continue;
            }
            reportedTracks++;
            const report = musicalSlotDiagLogOriginReport(
                track,
                'session/restore/origin',
                { writeLines: true },
            );
            musicalSlotDiagDumpTrack(track, 'session-restore');
            musicalSlotDiagDumpOriginBindings(track, 'session-restore');
            for (let i = 0; i < report.issues.length; i++) {
                allIssues.push('Ex' + (slot + 1) + ': ' + report.issues[i]);
            }
        }
        if (typeof writeLog === 'function') {
            if (!reportedTracks) {
                writeLog(LOG_PREFIX + ' session/restore: アクティブな Ex トラックなし');
            } else if (allIssues.length) {
                writeLog(
                    LOG_PREFIX +
                        ' session/restore === 完了 **問題 ' +
                        allIssues.length +
                        ' 件** ===',
                );
                for (let i = 0; i < allIssues.length; i++) {
                    writeLog(LOG_PREFIX + '   ! ' + allIssues[i]);
                }
            } else {
                writeLog(
                    LOG_PREFIX +
                        ' session/restore === 完了 OK === ' +
                        reportedTracks +
                        ' トラック — 全リージョンで左下=保持origin',
                );
            }
        }
        musicalSlotDiagLog('session/restore/done', {
            reportedTracks,
            issues: allIssues.length ? allIssues : undefined,
            ok: !allIssues.length,
        });
    }

    window.musicalSlotDiagLog = musicalSlotDiagLog;
    window.musicalSlotDiagFmtSec = musicalSlotDiagFmtSec;
    window.musicalSlotDiagPhraseSnapshot = musicalSlotDiagPhraseSnapshot;
    window.musicalSlotDiagSummarizeSwapUnit = musicalSlotDiagSummarizeSwapUnit;
    window.musicalSlotDiagSummarizeMusicalOrigin = musicalSlotDiagSummarizeMusicalOrigin;
    window.musicalSlotDiagWriteReadableLines = musicalSlotDiagWriteReadableLines;
    window.musicalSlotDiagLogPersistCacheMerge = musicalSlotDiagLogPersistCacheMerge;
    window.musicalSlotDiagDumpTrack = musicalSlotDiagDumpTrack;
    window.musicalSlotDiagDumpOriginBindings = musicalSlotDiagDumpOriginBindings;
    window.musicalSlotDiagLogOriginReport = musicalSlotDiagLogOriginReport;
    window.musicalSlotDiagDumpSelectionTracks = musicalSlotDiagDumpSelectionTracks;
    window.logSessionRestoreMusicalSlotSnapshot = logSessionRestoreMusicalSlotSnapshot;
    window.regionSwapDiagLog = musicalSlotDiagLog;
    window.regionSwapDiagDumpTrack = musicalSlotDiagDumpTrack;
    window.regionSwapDiagDumpSelectionTracks = musicalSlotDiagDumpSelectionTracks;
})();
