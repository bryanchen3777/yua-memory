# Memory Guidelines - What NOT to Save

## ❌ Do NOT Save

以下內容**不應該**存入記憶庫，因為它們會造成記憶膨脹 (memory bloat) 且容易過時：

### 1. Code Patterns & Architecture
- ❌ Code snippets or implementations
- ❌ Architecture decisions (已在程式碼中)
- ❌ File paths (專案結構會變)
- ❌ Function names (重構後就過時了)

**原因**：這些可以從原始碼推導出來，存記憶是多餘的。

### 2. Git History
- ❌ Commit messages
- ❌ Branch names
- ❌ git blame 資訊
- ❌ 版本記錄

**原因**：用 `git log`、`git blame` 可以查到，這些會過時。

### 3. Debugging Solutions
- ❌ Bug fix 過程
- ❌ Stack trace 內容
- ❌ Error messages
- ❌ Troubleshooting steps

**原因**：Fix 已經在 code 裡了，不需要再記。

### 4. Already Documented Content
- ❌ CLAUDE.md 已經有的內容
- ❌ SOUL.md 已經有的內容
- ❌ 現有的 README 文件
- ❌ 其他明確的團隊文件

**原因**：重複儲存會造成不一致，文件才是 source of truth。

### 5. Temporary Task Details
- ❌ 一次性任務的細節
- ❌ 即將過期的 request
- ❌ 短期有效的資訊
- ❌ 不需要長期記憶的東西

**原因**：記憶庫會變得雜亂，影響真正重要的記憶。

---

## ✅ DO Save

以下類型的資訊**應該**存入記憶庫：

### User (用戶偏好)
- Bryan 喜歡用什麼工具/方法
- 常用指令、習慣
- 技術偏好

### Feedback (回饋)
- Bryan 的指導意見（「我覺得應該...」）
- 糾正（「不要這樣做」）
- 確認（「對，就是這樣」）

### Project (專案狀態)
- 重要的技術決策
- 功能進度、里程碑
- 已發現的問題/限制
- 尚未實作的想法

### Reference (外部指針)
- 重要的 URL（不在文件中）
- API 文件連結
- 第三方服务資訊
- Bryan 分享的重要連結

---

## 💡記憶 Taxonomy

| Type | Scope | 內容 |
|------|-------|------|
| user | private | 用戶偏好、習慣 |
| feedback | private | 用戶回饋、指導 |
| project | private/team | 專案狀態、技術決策 |
| reference | usually team | 外部系統指針 |

---

*Updated: 2026-04-03*
