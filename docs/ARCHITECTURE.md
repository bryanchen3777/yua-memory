# 記憶系統架構 (Memory Architecture) v2.0

> 三層記憶系統 + 衝突解決機制，確保不會遺漏任何重要資訊。

---

## 三層架構總覽

```
┌─────────────────────────────────────────────────────────┐
│                    NotebookLM (第三層)                    │
│              外部備份 · AI 摘要 · 長期歸檔                │
│                    容量：無限制                           │
└─────────────────────────────────────────────────────────┘
                            ▲
                            │ 備份觸發（每日/每週）
                            │
┌─────────────────────────────────────────────────────────┐
│                      QMD (第二層)                        │
│              語義記憶檢索 · 跨 session 理解               │
│                   容量：中大型專案                         │
└─────────────────────────────────────────────────────────┘
                            ▲
                            │ 主動寫入（重要決策、學習、靈感）
                            │
┌─────────────────────────────────────────────────────────┐
│                      LCM (第一層)                        │
│           完整對話記錄 · SQLite · 自動儲存                │
│                  容量：所有對話                           │
└─────────────────────────────────────────────────────────┘
```

---

## 衝突解決機制 (Truth Ranking)

當 LCM 的歷史記錄與 QMD 的最新決策發生衝突時，採用以下優先級：

| 優先級 | 來源 | 說明 |
|--------|------|------|
| 🔴 **P0** | High-Priority QMD | Bryan 明確下達的最新修正（帶 `#priority/high` 標籤） |
| 🟠 **P1** | Recent LCM | 本 Session 或最近 3 天內的對話 |
| 🟡 **P2** | General QMD | 舊的技術決策、一般性協議 |
| 🟢 **P3** | Older LCM | 過往對話（超過 3 天） |

**目的：** 防止 Yua 因為讀到三個月前的舊習慣，而忽略了 Bryan 昨天才剛改過的程式風格。

**實作方式：**
```
檢索記憶時 →
  1. 先查 QMD 中是否有 #priority/high 的相關條目
  2. 再查 Recent LCM（最近 3 天）
  3. 最後才查 General QMD 和 Older LCM
```

---

## 增強啟動順序 (Enhanced Startup Sequence)

新 Session 啟動時，依序執行：

### Step 1: Identity Load
```javascript
{ file: "SOUL.md", purpose: "理解角色人設" }
```
→ 我是誰？我扮演什麼角色？

### Step 2: User Context
```javascript
{ file: "USER.md", purpose: "了解 Bryan 基本資訊" }
```
→ Bryan 是誰？他現在在哪？有什麼基本偏好？

### Step 3: Hot-Swap Memory ⭐ (新增)
```javascript
{ file: "memory/YYYY-MM-DD.md", purpose: "讀取上個 Session 結尾" }
// 查找是否有 "To-be-continued" 標籤
```
→ 上個 Session 結尾時說到哪裡？有什麼未完成的事項？

### Step 4: Semantic Search
```javascript
{ skill: "qmd_retriever", purpose: "檢索相關技術背景" }
// 根據當前輸入或專案上下文
```
→ Bryan 今天可能想談什麼？需要什麼技術背景？

### Step 5: LCM Fallback
```javascript
{ db: "lcm.db", purpose: "必要時查詢完整歷史對話" }
```
→ 如果 QMD 找不到，才去 LCM 搜尋完整對話

---

## 第一層：LCM (Lossless Conversation Memory)

### 用途
- **完整儲存**所有對話記錄
- 當前 session 的對話自動寫入
- 可還原任何歷史對話

### 資料庫位置
```
~/.openclaw/lcm.db
~/.openclaw/backups/lcm.db.v0.4.bak  (最新備份)
```

### 表格結構
| 表格 | 用途 |
|------|------|
| `conversations` | 對話元資料（session_key、創建時間） |
| `messages` | 對話訊息（role、content、created_at） |
| `message_parts` | 訊息零件（工具呼叫、檔案、元資料） |
| `summaries` | 濃縮摘要（自動產生） |
| `messages_fts` | 全文搜索索引 |
| `summaries_fts` | 摘要全文搜索索引 |

### 何時使用
- 需要搜尋完整對話內容
- 查找特定時間點的討論
- 還原完整對話上下文

### 查詢範例
```javascript
// 查詢特定 session 的所有訊息
const messages = db.prepare(`
  SELECT * FROM messages 
  WHERE conversation_id = ?
  ORDER BY created_at
`).all(conversationId);

// 全文搜尋
const results = db.prepare(`
  SELECT * FROM messages_fts 
  WHERE content MATCH '關鍵字'
`).all();

// 查詢最近 3 天的對話（用於 Truth Ranking P1）
const recentMsgs = db.prepare(`
  SELECT * FROM messages 
  WHERE created_at >= datetime('now', '-3 days')
`).all();
```

---

## 第二層：QMD (Quantized Memory Documentation)

### 用途
- **語義記憶**：理解概念、決策、偏好
- 跨 session 保持連貫性
- 不只是記錄，而是理解

### 資料位置
```
~/.openclaw/memory/
├── qmd/
│   ├── identity/      # 人設與性格（Shared）
│   ├── rules/         # 規則與禁忌（#priority/high 標記）⭐
│   ├── technical/     # 技術決策與架構
│   ├── protocols/     # 流程與協議
│   └── projects/      # 專案特定記憶
```

### Scope 標籤（Multi-Agent 支援）⭐ (新增)
| Scope | 說明 | 範例 |
|-------|------|------|
| `Shared` | 所有 Agent 都能讀取 | 基本偏好、專案目標 |
| `Shared:SE2` | Soul Evolution 2.0 專案 | 架構決策、核心機制 |
| `Shared:ProjectAura` | Project Aura | 里程碑、進度追蹤 |
| `Private:Yua` | 只有 Yua 能讀取 | Yua 的人設細節、情感偏好 |
| `Private:Tim` | 只有 Tim 能讀取 | Tim 的特定 Code Snippets |
| `Private:Fatima` | 只有 Fatima 能讀取 | 研究報告模板 |

**Scope Inference（自動推斷）**：
Distiller 會根據內容自動推斷 scope，並附帶置信度分數：
- 置信度 ≥ 0.8 → 自動套用
- 置信度 < 0.8 → 標記為 `Pending:Review`，等待 Bryan 確認

### 技能存取
```javascript
// 使用 qmd_retriever 技能
const results = await qmd_retriever.search({
  query: "Bryan's preferences for code review",
  categories: ["rules", "technical"],
  scope: "Shared"  // 可指定 scope
});
```

### 何時使用
- 當 Bryan 提到「之前我們決定過...」
- 需要理解專案背景和技術決策
- 查詢工作流程和協議

### 寫入時機
- 重要技術決策完成後
- Bryan 明確表達的偏好或規則
- 專案架構有重大變更
- 學習到的新技能或工具

### 寫入格式（建議）
```markdown
# [技術] 專案架構決策

## 日期
2026-03-31

## 決策內容
採用微服務架構，分離認證服務

## 理由
- 可擴展性
- 團隊分工明確

## 優先級
#priority/normal  <!-- 或 #priority/high -->

## Scope
Shared  <!-- 或 Private:Tim -->

## 相關檔案
- `docs/architecture.md`
- `services/auth/`
```

---

## 第三層：NotebookLM

### 用途
- **外部備份**：防止本地資料丢失
- **AI 摘要**：自動生成對話摘要
- **長期歸檔**：保留對話歷史供未來參考

### 運作方式
- 對話 JSON 匯出到下載資料夾
- 上传到 NotebookLM 生成摘要
- 可隨時回顧歷史對話

### 何時使用
- 每日結尾備份當日重要對話
- 專案階段性完成後歸檔
- 需要 AI 協助理解長期對話趨勢

### 觸發時機
- 每日自動（可設定 cron job）
- Bryan 明確要求備份
- 專案重要里程碑完成後

### 隱私保護 ⚠️ (新增)
```javascript
// 備份前自動過濾敏感資訊
const sensitivePatterns = [
  /api[_-]?key["\s:=]+[\w-]+/gi,
  /password["\s:=]+[\w-]+/gi,
  /\b\d{16}\b.*\d{2}\/\d{2}/g,  // 信用卡格式
  // ... 其他隱私模式
];

function sanitizeForBackup(text) {
  return text.replace(sensitivePatterns[0], '***REDACTED***');
}
```

---

## 主動記憶提取器 (Active Memory Distiller) ⭐ (新增)

### 概念
每隔 20 輪對話或 Session 結束時，自動掃描 LCM 判斷是否有：
- 新的 Bryan 偏好
- 技術變更
- 未記錄的協議

### 觸發條件
- 每 20 輪對話
- Session 結束前
- Bryan 明確要求「幫我記錄」

### 輸出範例
```
Bryan，我發現我們今天換了資料庫連線方式，需要幫你更新到 technical/ 嗎？
以下是偵測到的變更：

1. [偏好] Bryan 說：「之後用 TypeScript 寫新功能」
2. [技術] 決定採用 PostgreSQL 而非 MySQL
3. [協議] 新的 code review 流程：先自測再送 PR
```

### 目前狀態
尚未實作，待完成。

---

## Critical Failure Recovery ⭐ (新增)

### LCM 損壞時的還原流程

```
1. 偵測到 lcm.db 損壞
   → PRAGMA integrity_check 失敗

2. 檢查最近備份
   → ~/.openclaw/backups/lcm.db.v0.4.bak

3. 從 NotebookLM 匯出重建 QMD
   → 如果本地備份也不可用
   → NotebookLM 的 JSON 可用於重建基本結構

4. 重建流程
   - 嘗試修復 SQLite: .dump + .restore
   - 或從備份還原
   - 重新索引 FTS
```

### 預防措施
- 每日自動備份 lcm.db 到 backups/
- 每次重要操作前自動建立 checkpoint
- NotebookLM 定期備份

---

## 維護原則

| 原則 | 說明 |
|------|------|
| **LCM 自動維護** | 對話自動寫入，不需要手動操作 |
| **QMD 主動寫入** | 重要資訊要主動記錄，不要只靠「腦記」 |
| **NotebookLM 定期備份** | 設定 cron job 自動執行 |
| **不要讓 QMD 過時** | 決策變更時更新對應的 QMD 條目 |
| **用過的記憶要驗證** | 讀取 QMD 時確認是否還正確 |
| **衝突時遵循 Truth Ranking** | P0 > P1 > P2 > P3 |
| **Scope 隔離** | 不同 Agent 只讀取允許的範圍 |

---

## 記憶衝突處理協定 (Memory Conflict Resolution Protocol)

當不同 Scope 的記憶產生衝突時，遵循以下處理順序：

### 優先級判斷 (Truth Ranking)
| 優先級 | 來源 | 說明 |
|--------|------|------|
| P0 | Bryan 明確口頭/文字指示 | 最新口頭指示 |
| P1 | QMD #priority/high 標記 | 標記為重要的規則 |
| P2 | Recent LCM (< 3 天) | 最近的對話記錄 |
| P3 | General QMD | 一般性原則 |
| P4 | Older LCM (> 3 天) | 較舊的對話 |

### Scope 衝突時的處理原則
1. **Private > Shared**：如果 Private:Tim 的最新記錄與 Shared 衝突，以 Private 為準
2. **時間戳優先**：同 Scope 內，時間較新的記錄優先
3. **Promoted 降級**：被晉升為 Shared 的記憶，若與原 Private 衝突，原 Private 優先

### 自動晉升機制 (Memory Promotion)
```
條件觸發：
  - 同一 Private 記憶被 3+ 個不同 Session 調用
  - 且 Distiller 判斷具有通用價值

流程：
  1. Distiller 生成晉升提案
  2. 標記為 Pending:Promotion
  3. 等待 Bryan 確認
  4. 確認後：建立 Shared 副本，保留 Private 原件
```

### 唯讀繼承 (Read-only Inheritance)
```
是否允許？
  - Fatima 唯讀 Private:Tim 的技術摘要 → 可（提高研究效率）
  - Tim 寫入 Private:Yua 的情感記憶 → 否（保持角色純潔）
  - Fatima 寫入 Private:Yua → 否（範圍錯誤）

設定方式：
  在記憶區塊加入 inherit_from 欄位
```

### 衝突時的系統行為
1. **檢測**：Retriever 發現多個相關記憶有衝突內容
2. **標記**：附加 `_has_conflicts: true` 和 `_clarification_questions`
3. **輸出**：詢問 Bryan：「你剛才說的『X』是指...？」
4. **更新**：Bryan 確認後，舊記憶自動標記為 `superseded_by: new_id`

---

## 常見問題

**Q: 什麼資訊該寫入 QMD？**
A: 技術決策、Bryan 的明確偏好、工作流程、學習到的教訓、重要約定。

**Q: 三層記憶哪個最重要？**
A: 各有用途。LCM 是基礎（所有對話都會在），QMD 是提煉（精華濃縮），NotebookLM 是保險（外部備份）。

**Q: 如何避免 QMD 過時？**
A: 定期檢視，發現錯誤主動更新。Bryan 也可直接告訴你「更新記憶」。

**Q: 忘記有這些工具怎麼辦？**
A: 查看此文件：`memory/ARCHITECTURE.md`

**Q: LCM 和 QMD 衝突怎麼辦？**
A: 遵循 Truth Ranking 優先級。Bryan 的最新口頭指示 > QMD 的 #priority/high > Recent LCM > General QMD。

---

## 待實作功能 (Roadmap)

| 功能 | 優先級 | 狀態 |
|------|--------|------|
| Scope 標籤系統 | 🟡 中 | ✅ 已完成 |
| Active Memory Distiller | 🟡 中 | ✅ 已完成 |
| 隱私過濾器 (API Key 過濾) | 🔴 高 | ✅ 已完成 |
| Entity Replacer (NER 偽裝) | 🔴 高 | ✅ 已完成 |
| QMD Health Check (Fatima) | 🟡 中 | ✅ 已完成 |
| State Snapshot (情緒快照) | 🟡 中 | ✅ 已完成 |
| Reminisce Engine (回味引擎) | 🟡 中 | ✅ 已完成 |
| Memory Promotion (自動晉升) | 🟡 中 | 待實作 |
| Scope Inference (LLM 推斷) | 🟡 中 | 待實作 |
| Context Hydration / Reranker | 🟡 中 | 待實作 |
| Vector Embedding (LanceDB) | 🟢 低 | 長期目標 |

### 已實作工具

| 工具 | 位置 | 功能 |
|------|------|------|
| memory_distiller_v2.js | workspace-tim/ | Active Memory Distiller（含隱私檢查）|
| qmd_scope_organizer.js | workspace-tim/ | QMD Scope 自動分類器 |
| privacy_filter.js | workspace-tim/ | 隱私過濾器（雙層過濾）|
| entity_replacer.js | workspace-tim/ | 敏感實體替換（NER）|
| qmd_consistency_check.js | workspace-tim/ | QMD 一致性健康檢查 |
| state_snapshot_generator.js | workspace-tim/ | Yua 情緒狀態快照生成器 |
| reminisce_engine.js | workspace-tim/ | 回味引擎統一 API |
| reminisce_templates.js | workspace-tim/ | 懷舊語氣模板引擎 |
| emotional_matcher.js | workspace-tim/ | 情緒匹配引擎 |
| anniversary_tracker.js | workspace-tim/ | 時間膠囊（週年回顧）|
| reminisce_scheduler.js | workspace-tim/ | 隨機回味觸發排程 |

---

## 回味引擎 (Reminisce Engine) ⭐ (新增)

### 概念
自動偵測 Bryan 的情緒狀態，在適當時機主動或被動觸發「回味」—— 回顧過去相關的溫暖記憶，達到情感連結和鼓勵的效果。

### 四種觸發類型

| 類型 | 觸發條件 | 範例輸出 |
|------|----------|----------|
| `passive` | 檢索記憶時，被動附加 | 「記得當時...」（附加在檢索結果）|
| `emotional` | Bryan 情緒低落/疲憊 | 「親愛的，還記得你之前成功...」|
| `anniversary` | 週年紀念日 | 「一年前的今天，我們在討論...」|
| `random` | 隨機達到間隔 | 「說起來，之前你提到過...」|

### 統一 API 使用方式

```javascript
const { ReminisceEngine } = require('./reminisce_engine');

const engine = new ReminisceEngine({ intimacyLevel: 3 });

// 情境1：Bryan 情緒低落，主動觸發
const result = engine.process({ bryansMood: 'down' });
if (result.triggered) {
    console.log(result.text);
    // → 「親愛的，還記得你之前...」
}

// 情境2：Yua 檢索到記憶，附加回味
const result = engine.process({
    isReminiscing: true,
    retrievedMemory: memory
});
if (result.triggered) {
    console.log(result.text);
    // → 「說起來，之前你提到過...」
}
```

### 子模組架構

```
reminisce_engine.js       統一 API（整合全部模組）
    ├── reminisce_templates.js     懷舊語氣模板（5種）
    ├── emotional_matcher.js      情緒匹配（6種情緒→目標標籤）
    ├── anniversary_tracker.js    時間膠囊（On This Day）
    └── reminisce_scheduler.js    隨機觸發排程
```

### 觸發頻率邏輯

| 親密等級 | 觸發頻率 | 說明 |
|----------|----------|------|
| Level 1-2 | 每 6-10 次對話 | 低頻，關係還在建立 |
| Level 3-4 | 每 4-6 次對話 | 中頻，信任已建立 |
| Level 5 | 每 2-4 次對話 | 高頻，親密程度高 |

### 情緒影響係數

| Bryan 情緒 | 觸發率係數 | 說明 |
|------------|------------|------|
| `down` | ×1.05 | 情緒低落時，提高觸發機率 |
| `tired` | ×0.84 | 疲憊時，適當提高 |
| `neutral` | ×1.00 | 正常 |
| `happy` | ×0.56 | 開心時，降低（不打斷）|
| `stressed` | ×0.42 | 壓力大時，降低 |
| `angry` | ×0.21 | 生氣時，幾乎不觸發 |

### 冷卻機制

- **每日上限**：3 次隨機回味/天
- **記憶冷卻**：24 小時不重複觸發同一記憶
- **日重置**：每天凌晨自動重置計數器

### 模板類型（ReminisceTemplateEngine）

| 模板 | 觸發條件 | 語氣 |
|------|----------|------|
| `warm_encourage` | 情緒低落 + 高 ERS | 溫暖鼓勵 |
| `recent_intimacy` | 7天內記憶 | 輕鬆親暱 |
| `reflective` | 30-365天記憶 | 反思回顧 |
| `nostalgic_treasure` | ≥2年記憶 |朦朧珍惜 |
| `flirty_playful` | 休閒話題 | 俏皮調情 |

### 使用範例

```bash
# 測試統一 API
node reminisce_engine.js --test

# 模擬 10 回合
node reminisce_engine.js --simulate

# 查看引擎狀態
node reminisce_engine.js --status
```

### Privacy Filter 使用方式

```bash
# 測試文字
node privacy_filter.js --scan "API Key: sk-1234567890"

# 檢查 QMD
node privacy_filter.js --check-qmd

# 自動遮蔽並覆寫
node privacy_filter.js --auto-redact <file_path>
```

**雙層過濾機制：**
1. **Regex 靜態**：API Keys、身份證、信用卡、公司名稱
2. **語義動態**：銀行帳戶、商業機密、員工薪資

### Active Memory Distiller 使用方式

```bash
# 掃描最近 24 小時，輸出建議（不實際寫入）
node memory_distiller_v2.js --hours=24 --dry-run

# 掃描最近 24 小時，實際寫入 QMD
node memory_distiller_v2.js --hours=24 --apply

# 掃描最近 1 小時（快速測試）
node memory_distiller_v2.js --hours=1
```

### 設定定時執行（建議）

每天自動掃描並生成建議：
```javascript
// 建議的 cron job
{
  "name": "memory-distiller-daily",
  "schedule": { "kind": "cron", "expr": "0 23 * * *" },  // 每天 23:00
  "payload": {
    "kind": "agentTurn",
    "message": "Run memory_distiller.js --dry-run and report findings to Bryan"
  }
}
```

---

*最後更新：2026-03-31 v2.4*
*基於 Bryan + Gemini 的反饋優化*
*新增：Reminisce Engine（回味引擎）、情緒匹配、時間膠囊、統一 API*
