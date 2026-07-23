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

### ⚠️ TESTMODE Firebase 鐵則（絕不可違反）
**`TEST_MODE` 下任何程式碼都不能寫入 Firebase。**
- `fRef(path)` 在 TEST_MODE 下已是 mock（set/update/remove/transaction 全為 noop），絕對不能用 `db.ref(...)` 直接繞過 mock
- 若需要讓測試資料反映在 UI，改用 React state（`setMyCards`、`setUserPoints` 等）直接更新本地狀態
- `DB_PREFIX` 在 `?testmode` 下仍是 `"lunch"`（正式 DB），用 `db.ref(DB_PREFIX/...)` 就是寫正式資料

## 成就系統（ACHIEVEMENTS）
21 個可見成就 + 5 個隱藏成就，key / emoji / name / desc / rarity(1-5)：
- join50/100/300/1000 — 參與次數
- solo1/3/10 — 獨贏次數
- streak3/5/10 — 連勝（從 weekly 歷史重算，不依賴 r.streak 欄位）
- lose30/50/100 — 連敗（同上，重算）
- luckyDay — Lucky Day 中獎
- birthday — 生日當天中獎
- sharedWin — 與他人共同獨贏
- fatedTie — 開獎時與他人距離完全相同
- stealSteal / bloodyLeech / cardKing — 特殊事件（存 specialAchievements/）
- firstBlood 🩸 — 全遊戲首位獨贏者，唯一解鎖；用 gameFlags/firstBlood transaction 原子搶佔，得主存 specialAchievements/{key}/firstBlood=true
- obsessed / lateJustice / lateJusticeSolo — 隱藏成就三選一，開獎時依 `sameNumberStreak`（連續押同號碼次數 ≥10）+ 當天輸贏結果判定：沒贏→obsessed(3★)；贏了但非獨贏→lateJustice(4★)；獨贏→lateJusticeSolo(5★)，三者互斥（同一天只會拿到一個）

稱號設定：只能從 Header 名字按鈕 → MyProfileModal 設定，最多可同時選 **2 個**稱號（`userTitles/{key}` 存陣列，`getTitleKeys()` 相容舊資料的單一字串）。點擊已選的稱號取消，選滿 2 個再點第三個會跳 Toast 提示先取消一個。
顯示 badge 用共用元件 `TitleBadges`：窄版面（參加者名單、個人戰績）用 `mode="stack"` 上下疊放，寬版面（開獎排名）用 `mode="inline"` 同一行並排。
有新成就時，Header 名字按鈕發紫光（`.has-news` class）。
自動選：登入後若有解鎖成就且未選稱號，自動選稀有度最高的（只會補上 1 個，不會自動選滿 2 個）。

## 主題系統

### 架構概覽
- `THEMES` 常數（module-level）定義所有主題設定
- `applyTheme(themeId)` 套用主題：清除舊 CSS var → 寫入新 var → 切換 `dark-mode` class → 設定 body background → 設定 `data-theme` attribute
- `body[data-theme="xxx"]` 用於 CSS 針對特定主題 override 硬編碼顏色
- Firebase 路徑：`themeShopConfig/{id}`（上架/價格）、`userOwnedThemes/{key}/{id}`、`userActiveTheme/{key}`

### THEMES 欄位說明
```js
{
  name: "顯示名稱",
  emoji: "🏴‍☠️",
  desc: "簡短描述",
  free: true,           // 免費主題（日光/深夜），不設 defaultPrice
  defaultPrice: 500,    // 付費主題預設售價（管理員可在後台覆蓋）
  dark: false,          // true = 套用 body.dark-mode class（影響 card/input/button CSS）
  vars: { "--bg":"...", "--a":"...", ... },  // 覆蓋 CSS 變數（THEME_VAR_KEYS 範圍內）
  bg: "...",            // body.style.background shorthand（可含圖片、漸層）
  logoImg: "theme/xxx/logo.png",  // 有值時替換 header ◈ 圖示，文字仍保留
  headerWave: true,     // 有值時 SiteHeader 加 op-header class + op-wave 動畫條
  autoBgMode: true,     // 多背景主題：依選定背景圖亮度自動切深/淺 UI（見下方說明）
  backgrounds: ["bg_1.jpg","bg_2.jpg",...],  // 多背景主題的背景檔名清單（相對於 theme/{id}/ 目錄）
  varsDark: { ... },    // autoBgMode 且主模式為淺色時，提供深色那半色板（反之用 varsLight）
}
```

**多背景選擇（backgrounds 陣列）**
- `backgrounds` 列出所有可選的背景圖檔名（相對於 `theme/{id}/` 目錄，不含路徑前綴）。
- App 層用 `themeBgSelections` state（`{[themeId]: filename}`）記錄各主題目前選了哪張；預設為 `backgrounds[0]`。
- 使用者在 ThemeModal 點選縮圖時呼叫 `onBgSelect(themeId, filename)`，更新 `themeBgSelections` 並立即呼叫 `applyThemeAuto(themeId, filename)` 套用。
- 切換背景只更新本地 state，不寫 Firebase（關掉 Modal 後若不 Activate 就不會儲存）。
- ThemeModal 內的 `previewBgSel` 是獨立的 local state，僅管理「預覽時的背景選擇」，不影響 `themeBgSelections`。背景選擇器的顯示條件：`previewTheme` 存在時顯示（任何人都能預覽選圖）；沒有 previewTheme 時只有已擁有該主題才顯示。
- 新增多背景主題時，`backgrounds` 陣列第一張即為預設，建議選偏暗的圖作為 index 0（讓深色 UI 作為初見印象）。

**autoBgMode（依背景亮度自動切深/淺）**
- 三個背景圖主題（onepiece / aot / kimetsu）全部啟用。
- 機制：`detectBgDark(url)` 用 canvas 取背景圖中央區平均亮度（門檻 135），結果快取。`applyThemeAuto(themeId, bgFile)` 先用主模式同步套用，偵測完成再用 `applyTheme(id, bg, "dark"|"light")` 修正，並 `setBgDark()` 讓 `isDarkMode`（已改為 state）連動圖表/開獎頁。
- 主模式（= `dark` 欄位）保留手調 `vars`；相反模式用 `varsDark`/`varsLight`。
- **遮罩依模式（applyTheme bg 段）**：aot/kimetsu 的 `bg` 烤了深色遮罩，偵測的是原圖、實際顯示被壓暗。所以深色模式用主題原遮罩、深色主題翻成淺色時改用淡白罩（`rgba(255,255,255,.18)`）讓亮背景真的亮起來。onepiece 無遮罩兩模式皆不加。**這是 aot/kimetsu 能做 autoBgMode 的關鍵**——只加 `varsLight` 而不換遮罩，淺色 UI 會壓在暗背景上看不清。
- **寫死的 per-theme CSS 必須依 `.dark-mode` gating**：卡片 override 寫 `body[data-theme="xxx"]:not(.dark-mode) .card`（淺色半透明白）；深色交給通用 `body.dark-mode .card`。
- **語意色 `--c-*` 兩個模式都要補半透明版**：`:root`/`body` 預設與 `body.dark-mode` 的 `--c-*-bg` 都是**實心 hex**（不透明），背景圖主題淺色要補 `body[data-theme="xxx"]:not(.dark-mode)`、深色要補 `body.dark-mode[data-theme="xxx"]`，否則 banner（口渴卡/加號卡/壽星/卡牌等）變不透明色塊蓋住背景。
- **開獎頁 gc/oc**：aot/kimetsu 深色色板只在 `isDarkMode` 時用；淺色模式三主題共用半透明淺色（`imgTheme` 分支），避免實心 `#F0FDF4` 蓋住背景。
- kimetsu 只有 1 張背景偏亮、aot 有 4 張，門檻 135 已驗證能正確分類各背景。

### 新增客製化主題的完整清單

**1. 圖片資源**（若有）
- 放在 `theme/{主題名}/` 資料夾，commit 進 repo
- 建議壓縮：背景圖 ≤ 150KB（1280px wide, JPEG q82），logo ≤ 20KB（200×200 PNG）

**2. THEMES 常數**（`index.html` 約 445 行後）
- 加入主題 entry，設定 vars / bg / logoImg / headerWave

**3. 硬編碼顏色的 CSS override**（必須處理，否則卡片不透明）
這些元素有寫死的顏色，不受 CSS var 影響，需用 `body[data-theme="xxx"]` 補 override：
```css
/* 卡片背景（.card / .stat-card / .empty-state 寫死 #FFFFFF） */
body[data-theme="xxx"] .card,
body[data-theme="xxx"] .stat-card,
body[data-theme="xxx"] .empty-state { background: rgba(255,255,255,.62) !important; }

/* 語意色 banner（--c-*-bg 預設實心色，背景圖主題需改半透明） */
body[data-theme="xxx"] { --c-green-bg:rgba(220,252,231,.68); --c-pink-bg:...; ... }

/* 開獎大數字（.result-number 有自己的漸層） */
body[data-theme="xxx"] .result-number:not(.result-number-scorched) {
  background: linear-gradient(...); -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
```

**4. 深色 Header 主題（headerWave: true 時）**
```css
.site-header.op-header { background: rgba(...) !important; border-bottom: none !important; }
.site-header.op-header button.ghost { color: #E0F0FF !important; ... }
.site-header.op-header .logo-weather, .site-header.op-header .logo-weather span { color: #C8E0FF !important; }
.site-header.op-header .header-title-area div { color: #F0F8FF !important; }
```
> ⚠️ 目前 `op-header` / `op-wave` CSS 為航海王主題專用名稱。若未來多個主題需深色 Header，應改為通用 `.theme-dark-header` class。

**5. 開獎結果頁 JS inline 顏色（gc / oc 物件）**
開獎頁最接近/獨贏卡片用 JS 算出的顏色，CSS override 進不去，需在 App component 加條件：
```js
const gc = isDarkMode ? { ... } : activeTheme==="xxx" ? { bg:"rgba(...)", ... } : { bg:"#F0FDF4", ... };
const oc = isDarkMode ? { ... } : activeTheme==="xxx" ? { bg:"rgba(...)", ... } : { bg:"#FFF7ED", ... };
```

**6. 管理員後台上架**
- 主題寫進 `THEMES` 後，需到管理員面板 → 🎨 主題 Tab → 設定售價並上架，使用者才看得到（免費主題除外）

**7. TEST_MODE**
- `ownedThemes` 初始化時已包含所有主題，無需額外處理

## 卡牌系統
- extra_number（加號卡）、follow_rest（跟著我吃）、no_pay（免付卡）、thirsty_card（口渴卡 1 張）、streak_protect（連勝保護卡）
- birthday_card（生日卡）：生日當月 1 號自動發放（1 號當天無人上線則當月內首位上線者補發；2/29 平年視為 2/28），用 `userBirthdayCardIssued/{uid}` transaction 原子搶佔防止多 client 重複發卡。固定當月底到期（逾期作廢），效果同加號卡但多選 4 個號碼。不列入 `cardPool`/`CARD_DEFAULTS`，不可在點數商店上架，不可被盜牌卡偷取。
- 卡牌使用流程：doJoin 先以 transaction 原子認領（從 `userCards` 移除，防與盜牌卡競態），寫入 `pendingCardReturns/{date}`，開獎時 `reconcilePendingCardReturns` 統一還池（含補掃過去日期的滯留記錄）。商店購買的卡帶 `fromShop: true`，任何歸還路徑（reconcile / returnCardToPool / 離職回收）都不回 `cardPool`（商店庫存與卡牌池獨立）。
- 卡牌是否可用取決於 `hasUsedCard`（`myEntry?.cardUsed` 是否存在），不是單純看是否已加入（`myEntry`）。當天已加入但還沒用卡的人，回來編輯（`isEditing`）時仍可補選一張卡使用（號碼欄位鎖死，`NumberPicker` 用 `lockedKeys` 擋掉主號碼被更改，但加號卡/生日卡需要的額外號碼欄位仍可填寫）；已經用過卡的人編輯時卡牌選擇 UI 完全隱藏。
- 卡牌池還池／扣池一律走 `creditCardPool` / `debitCardPool`（index.html），兩者對稱處理 `cardPoolDebt/{type}`：管理員調低總量時，扣不夠池子的差額記成欠額，之後流通在外的卡陸續歸還時優先拿去扣債，扣完債才真的進池子，確保調低的總量最終確實生效而不會被歸還悄悄補回超標；調高總量則相反，先還清舊欠額，剩下才真的加進池子。
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
- **UI 改動鐵則**：每次改 UI 必須同時驗證 dark mode 是否正常。顏色一律用 CSS 變數（`var(--t1)`, `var(--t2)`, `var(--t3)`, `var(--s1)`, `var(--s2)`, `var(--s3)`, `var(--b1)`, `var(--b2)`, `var(--a)`, `var(--bg)` 等），絕不寫死 hex、rgba 或固定色。改完 inline style 或新元件，腦中過一遍：「這在 dark mode 長什麼樣？」
- **Permission 不要一直跳出來問**：讀檔、改 `index.html`、跑腳本、git add/commit/push 等常規操作直接執行，不需確認。只有真正破壞性或不可逆的操作（刪 branch、force push 等）才先確認。

## 離職封鎖
`userStatus/{uid} === "resigned"` → `authState = "resigned"` → 顯示封鎖畫面，無法使用任何功能。

## 說明同步原則（必須遵守）
任何卡牌、遊戲規則、或成就的改動，commit 前必須同步更新以下地方，不等使用者提醒：
1. `index.html` 的 `CardHelpModal`（卡牌說明彈窗）或 `HelpModal`（遊戲說明彈窗）
2. Notion 頁面（午餐大樂透，ID: `3618dfd5-5a4d-8085-a434-fa1f457cd47c`）
   - 卡牌或規則改動 → 更新對應說明段落
   - 成就新增/移除 → 更新「共 N 種成就」的數字
3. `index.html` 頂部的版號與 history（觸發紫光通知與 NEW 標籤）：
   - 卡牌說明改動 → `WHATSNEW_VERSION.cards` +1，並在 `WHATSNEW_CARDS_HISTORY` 加 `{ 新版號: ["card_key", ...] }`
   - 遊戲規則改動 → `WHATSNEW_VERSION.rules` +1，並在 `WHATSNEW_RULES_HISTORY` 加 `{ 新版號: ["section_key", ...] }`
   - NEW 標籤會顯示使用者「上次看過的版本到現在」所有版本的累積變動，確保長時間未上線的人看到所有缺席期間的更新
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
