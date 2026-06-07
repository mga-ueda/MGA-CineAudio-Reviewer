# Timeline Musical Slots — 設計

Tempo/Sig・Phrase ON 時のリージョン／無音区間を **SwapUnit（論理スロット）** として統一管理し、
入れ替え・レイアウト・エディタ同期の単一経路を提供する。

## 原則

1. **SwapUnit** — 入れ替え最小単位（単一リージョン / `regionGroupId` グループ / 無音スロット）
2. **音楽メタデータは SwapUnit が保持** — `contentBarCount`（音源の小節数）、`phraseBarCount`（タイムライン上の枠幅）
3. **拒否しない** — 非対称（8↔16 等）は counts 再計算 + レイアウト + 補正で必ず完了
4. **エディタは派生** — slot 列 → Phrase 欄。ユーザーが Phrase/Tempo を編集したら `rebind` で覚え直す

## データモデル

```javascript
// 1 トラック = timelineSlots[]（左→右）
{
  id: 'tslot-...',
  kind: 'audio-single' | 'audio-group' | 'silent',
  segmentRefs: [{ slot, segmentIndex }],  // kind !== 'silent'
  silentGapIndex: -1,                     // kind === 'silent' 時
  regionGroupId: '...',                   // 任意
  timelineStartSec, timelineEndSec,       // layout 後
  musical: {
    contentBarCount: 8,    // 音源の小節数（入れ替えでも不変）
    phraseBarCount: 8,     // この枠の Phrase 小節数（layout の源）
    meterBarStart: 32,     // マスター上の開始小節 index
    phraseSlotIndex: 2,    // 展開 Phrase index（現在の枠・レイアウト用）
    originPhraseSlotIndex: 1, // 初回割当時の枠（入れ替え後も不変・左下表示用）
  }
}
```

## レイヤ

| 層 | 責務 |
|---|---|
| `timeline-musical-slots.js` | slot 列の build / infer / layout / swap / persist |
| `musical-grid.js` | meterSpec、counts→秒、エディタ反映 API |
| `waveform-region-core.js` | segment 物理配置、選択、Undo |

## 処理フロー

### 入れ替え（E）

1. 選択 2 件 → SwapUnit → timeline slot index
2. `contentBarCount` は維持、`phraseBarCount` と配置先を交換ルールで更新
3. `layoutTimelineSlotsFromBarCounts` → 各 slot の秒位置
4. segment 列を unit 単位で移動（音源 in/out は不変）
5. `syncEditorsFromTimelineSlots` → Phrase 欄
6. `resolveLayoutCorrections`（Phase 4）— 端数 snap・短クロスフェード・隣接整列

### Tempo/Sig 変更（Phase 5）

1. Meter エディタ確定（Enter / change）→ `persistMusicalGridAndRedraw({ relayoutSlotsFromMeter: true })`
2. 各トラック: 保存済み `timelineSlots` の musical 绑定を維持
3. `refreshSlotsMusicalFromCounts` → `refreshSlotTimelineBoundsFromPhraseCounts`（新 meter で秒再計算）
4. `applySlotLayoutToSegments` → segment 移動（音源 in/out 不変）
5. `rebind/meter-change` 診断ログ

Phrase 欄確定（`relayoutRegions: true`）は従来どおり破壊的リレイアウト。Meter のみの変更は slot 経路。

### 非対称 8↔16

- 長い方（16）→ 短い方の phrase slot へ移動、`counts[i]=16`
- 短い方（8）→ **更新後 counts** の次スロットへ（例: index 4 = 68.68s）
- Phrase 欄: `1,8,16,8` → `1,8,16,16,8`

### セッション復元

1. segments 復元
2. `timelineSlots` なし → `inferMusicalBindingsFromGrid`
3. あり → そのまま cache

## 永続化

`playbackRegion.extra[].timelineSlots` に slot 列（musical 含む）を保存。

## 診断ログ

ログパネルで **`[MusicalSlot]`** をフィルタする。

| 操作 | 内容 |
|---|---|
| 無効化（本番） | `window.musicalSlotDiagEnabled = false` |
| 手動ダンプ | `musicalSlotDiagDumpOriginBindings(0)` — 読み取り用サマリー行つき |
| E キー | `origin/swap/before`（サマリー行）→ `swap/apply` → `origin/swap/after` → `origin/dump/swap/E-key` |
| セッション復元 | `session/restore ===` サマリー行 → `session/restore/origin ExN` → `session/restore/done` |
| セッション復元 | `session/restore` + `dump/session-restore`（SwapUnit 列付き） |

### stage 命名（`[MusicalSlot] <stage> | {json}`）

| プレフィックス | 例 | 意味 |
|---|---|---|
| `dump/*` | `dump/swap/E-key`, `dump/session-restore` | トラック状態スナップショット（swapUnits, phrase, selection） |
| `swap/*` | `swap/start`, `swap/apply`, `swap/done`, `swap/rejected` | 入れ替え本体（slot-engine / legacy 共通） |
| `swap/animation` | — | 入れ替えアニメーション（region / silent-gap） |
| `layout/*` | `layout/corrections-applied` | 端数 snap・重なり解消（Phase 4） |
| `swap/plan/*` | `swap/plan/phrase-bar-layout`, `swap/plan/start` | レイアウト計画 |
| `phrase/*` | `phrase/layout-applied`, `phrase/swap/applied` | Phrase 欄・counts 更新（musical-grid 経由） |
| `rebuild/*`, `sync-editors` | — | slot 再構築・エディタ同期 |
| `rebind/meter-change` | — | Tempo/Sig 変更後の非破壊 slot リレイアウト |
| `origin/*` | `origin/swap/before`, `origin/swap/after`, `origin/cache-merge`, `origin/dump/*` | 練習番号（origin）の保持・表示・cache マージ診断 |
| `session/restore/*` | `session/restore/phrase`, `session/restore/origin`, `session/restore/done` | 復元直後の全 Ex トラック origin レポート（`=== 読み取り用サマリー ===` 行） |

`dump/*` の swapUnits 各行: `kind`, `regions`, `musical.contentBars/phraseBars/phraseIdx`, `timeline.in/out`

## 実装フェーズ

| Phase | 内容 |
|---|---|
| 1 | slot モデル、infer/sync、persist、復元 hook（本 PR） |
| 2 | layout エンジン、導出 gaps 廃止 |
| 3 | E キーを slot swap に統一、旧 RegionSwap 削除 ✅ |
| 4 | 端数 snap・自動クロスフェード（`resolveLayoutCorrections`） ✅ |
| 5 | Tempo 途中変更（`relayoutAllTracksFromTimelineSlots`） ✅ |
