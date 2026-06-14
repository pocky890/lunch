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
- 每次 push 前記得更新 `BUILD_TIME`
- 不要加不必要的 comment 或 console.log
- UI 改動要同時考慮亮色/深色模式（用 CSS 變數，不寫死顏色）

## 離職封鎖
`userStatus/{uid} === "resigned"` → `authState = "resigned"` → 顯示封鎖畫面，無法使用任何功能。

## 注意事項
- Firebase Security Rules 目前為 public read/write（測試環境），正式上線前需要加 Auth 驗證
- 多租戶架構已討論但**尚未實作**（討論方向：URL `?org=xxx`，DB path `lunch_{orgId}/`）
