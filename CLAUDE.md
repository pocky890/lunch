# 午餐大樂透 — CLAUDE.md

## 專案概述
單一 HTML 檔案（`index.html`）的午餐抽獎 Web App。
- React 18.2.0 via CDN + Babel standalone，無 build step
- Firebase Realtime Database（REST + SDK）
- 部署於 GitHub Pages：`https://pocky890.github.io/lunch/`

## 技術架構

### Firebase 資料結構
```
participants/           每日參與紀錄
weekly/{date}/          每週開獎紀錄（winner, soloWin, streak, specialDay, birthdayWinner）
userStatus/{uid}        "resigned" 表示離職封鎖
userBirthdays/{uid}     MM-DD 格式生日
userTitles/{sanitizedName}  使用者選擇的成就稱號 key
participationCount/{sanitizedName}  累計參與次數
session/                當日設定（numMax 等）
```

### 關鍵函式
- `sanitizeKey(str)` — Firebase path 安全化
- `computeAchievements(name, weeklyData, participationCount)` — 從歷史重算成就
- `computeStreak(weekly, name, today, ptCount)` — 計算連勝
- `fGet(path)` / `fSet(path, val)` / `fRef(path)` — Firebase 封裝

### 測試模式
- `?testmode` — 啟用測試功能
- `?testmode&testresult` — 直接顯示假開獎結果（跳過 Firebase listener）
- testresult 模式下 `userTitles` listener 不執行，避免蓋掉假資料

## 成就系統（ACHIEVEMENTS）
15 個成就，key / emoji / name / desc / rarity(1-5)：
- join50/100/300/1000 — 參與次數
- solo1/3/10 — 獨贏次數
- streak3/5/10 — 連勝（從 weekly 歷史重算，不依賴 r.streak 欄位）
- lose30/50/100 — 連敗（同上，重算）
- luckyDay — Lucky Day 中獎
- birthday — 生日當天中獎

稱號設定：只能從 Header 名字按鈕 → MyProfileModal 設定。
有新成就時，Header 名字按鈕發紫光（`.has-news` class）。
自動選：登入後若有解鎖成就且未選稱號，自動選稀有度最高的。

## 卡牌系統
- extra_number（加號卡）、follow_rest（跟著我吃）、no_pay（免付卡）、thirsty_card（口渴卡 1 張）、streak_protect（連勝保護卡）
- 卡牌設定存 Firebase `cardConfig/`

## 版本顯示
`BUILD_TIME` 常數硬編碼在 index.html 頂部，每次 push 時手動更新，顯示於管理員面板標題旁。

## 協作偏好（User Preferences）
- 使用者：Pocky（管理員），公司午餐抽獎使用
- 回應語言：繁體中文
- 風格：簡潔，不要多餘解釋，確認後直接動手
- commit 訊息：中文，附上功能描述
- 每次 push 前記得更新 `BUILD_TIME`，時間用台灣時間（UTC+8），指令：`[System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'Taipei Standard Time').ToString('yyyy-MM-dd HH:mm')`
- 不要加不必要的 comment 或 console.log
- UI 改動要同時考慮亮色/深色模式（用 CSS 變數，不寫死顏色）

## 離職封鎖
`userStatus/{uid} === "resigned"` → `authState = "resigned"` → 顯示封鎖畫面，無法使用任何功能。

## 說明同步原則（必須遵守）
任何卡牌或遊戲規則的改動，commit 前必須同步更新以下四個地方，不等使用者提醒：
1. `index.html` 的 `CardHelpModal`（卡牌說明彈窗）或 `HelpModal`（遊戲說明彈窗）
2. Notion 頁面（午餐大樂透，ID: `3618dfd5-5a4d-8085-a434-fa1f457cd47c`）
3. `index.html` 頂部的 `WHATSNEW_VERSION`：卡牌說明改動 → `cards` +1，遊戲規則改動 → `rules` +1（觸發紫光通知）
4. `CLAUDE.md` 的卡牌系統描述（若有新增/移除卡種）

## 注意事項
- Firebase Security Rules 目前為 public read/write（測試環境），正式上線前需要加 Auth 驗證
- 多租戶架構已討論但**尚未實作**（討論方向：URL `?org=xxx`，DB path `lunch_{orgId}/`）

---

## 行為準則

Behavioral guidelines to reduce common LLM coding mistakes.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## Rule 5 — Use the model only for judgment calls
Use me for: classification, drafting, summarization, extraction.
Do NOT use me for: routing, retries, deterministic transforms.
If code can answer, code answers.

## Rule 6 — Token budgets are not advisory
Per-task: 4,000 tokens. Per-session: 30,000 tokens.
If approaching budget, summarize and start fresh.
Surface the breach. Do not silently overrun.

## Rule 7 — Surface conflicts, don't average them
If two patterns contradict, pick one (more recent / more tested).
Explain why. Flag the other for cleanup.
Don't blend conflicting patterns.

## Rule 8 — Read before you write
Before adding code, read exports, immediate callers, shared utilities.
"Looks orthogonal" is dangerous. If unsure why code is structured a way, ask.

## Rule 9 — Tests verify intent, not just behavior
Tests must encode WHY behavior matters, not just WHAT it does.
A test that can't fail when business logic changes is wrong.

## Rule 10 — Checkpoint after every significant step
Summarize what was done, what's verified, what's left.
Don't continue from a state you can't describe back.
If you lose track, stop and restate.

## Rule 11 — Match the codebase's conventions, even if you disagree
Conformance > taste inside the codebase.
If you genuinely think a convention is harmful, surface it. Don't fork silently.

## Rule 12 — Fail loud
"Completed" is wrong if anything was skipped silently.
"Tests pass" is wrong if any were skipped.
Default to surfacing uncertainty, not hiding it.
