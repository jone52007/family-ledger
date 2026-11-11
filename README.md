# 家庭記帳本（Firebase 同步版）

家華與太太的家庭記帳 App：即時同步、離線可記帳、Google 登入。

- 網站：https://family-expence-413ad.web.app （Firebase Hosting，push 到 main 後由 GitHub Actions 自動部署）
- 資料：Firebase Firestore（`households/main`）
- 每日備份：私人儲存庫 `family-ledger-backup`

## 修改程式
程式碼在 `src/app.js`，改完執行 `./build.sh` 重新打包成 `app.js`。
