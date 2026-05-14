# 進度

> 對照 [PLAN.md](./PLAN.md) 的里程碑。

## 狀態總覽 (2026-05-14)

| 里程碑 | 狀態 | 備註 |
|---|---|---|
| M0 — 基礎設施 | ✅ Done | 三層 (Go / Python / Vite) 都可獨立 build 並通過基礎測試 |
| M1a — URA transactions ETL | ✅ Code complete | 12 個 unit tests 綠燈；端對端 smoke test 待跑（需 URA key + Postgres） |
| M1b — HDB resale ETL + geocoding | ⏳ Pending | 需先跑通 M1a 與 OneMap 帳號 |
| M1c — Developer sales 半手動 parser | ⏳ Pending | 需一份 URA 月度 Excel 樣本 |
| M2 — Go backend (chi + pgx + sqlc) | ⏳ Pending | router skeleton 已就位，4 個 handler 為 501 stub |
| M3 — Frontend (React + MapLibre) | ⏳ Pending | App 殼+歸屬聲明已就位 |
| M4 — 驗證 + README | ⏳ Pending | 等所有資料 + 端點上線後一起跑 |

## 已驗證可運作

- `cd backend && go build ./...` — clean
- `cd etl && .venv/bin/pytest -q` — 12 passed
  - SVY21 (28001.642, 38744.572) → WGS84 (103.833333°, 1.366667°) — SVY21 原點正確還原
  - URA contractDate "0524" / "1223" 解析、`typeOfSale` 1/2/3 → New Sale/Sub Sale/Resale
- `cd frontend && npx tsc --noEmit` — clean
- 全部 secret 走 `.env`，`.env.example` 列出所有變數

## 接下來要由你做的（M1a smoke test 解鎖後續）

1. **裝 container runtime**：`brew install --cask orbstack`（推薦，比 Docker Desktop 輕）或 Docker Desktop。
   - 不想用 container 的替代方案：`brew install postgis` 走 native；要手動 `psql -f infra/schema.sql`。
2. **`cp .env.example .env`** 並填：
   - `URA_ACCESS_KEY`（你已申請）
   - `ONEMAP_EMAIL` / `ONEMAP_PASSWORD`（M1b 需要 — https://www.onemap.gov.sg 註冊）
   - `POSTGRES_PASSWORD`（自選）
3. **啟動資料庫**：`make up`（自動套 schema）。
4. **跑 URA ETL**：
   ```bash
   cd etl && source ../.env && .venv/bin/purepsf-etl ura-transactions
   ```
   首跑約 1–2 分鐘，會 upsert 約 1.5k 建案、數萬筆交易（過去 5 年）。
5. **驗證**：`psql` 進去抽 10 筆對 https://eservice.ura.gov.sg/property-market-information/pmiResidentialTransactionSearch 比對。

跑通後告知，繼續 M1b → M1c → M2 → M3。

## 開發指令速查

```bash
make help              # 列出全部 targets
make up                # docker compose up postgres (+ schema)
make backend-build     # go build ./...
make backend-run       # 用 .env 跑 server (localhost:8080)
make backend-test      # go test ./...
make sqlc-gen          # M2 開工後用，從 queries/*.sql 產 type-safe code
make etl-install       # 建 venv + 裝 dependencies
make etl-test          # pytest
make frontend-dev      # Vite dev server (localhost:5173, proxy /api → 8080)
make frontend-build    # 產出 frontend/dist/
```

## 關鍵設計決策（決策 + 原因，避免之後忘記為什麼）

- **ETL Python / Web Go 拆兩個程序**：URA 月報是 Excel/PDF，Python 的 pandas + pdfplumber 生態壓倒性勝出；Web 端只是 PostGIS query → JSON，Go 寫得乾淨且部署單一 binary。耦合點只有 Postgres，未來換掉任一邊都容易。
- **MapLibre 而非 Mapbox**：分享給朋友時 Mapbox API key 用量會爆，MapLibre 完全免費，配 OneMap raster tiles。
- **不需要 REALIS 訂閱（S$1,960/年）**：免費 Data Service API 提供 unit-level 私宅成交（含 SVY21 座標、5 年歷史、每週二/五更新），加上 URA 月度 Excel + data.gov.sg 補 HDB 與更長歷史，覆蓋 MVP/v1 所有需求。REALIS 真正值錢的部份是商用/工業資料、10 年以上歷史、UI dashboard — 本專案三者都不需要。
- **PSF 用 generated column 算**：`price / (area_sqm * 10.7639)` STORED；ETL 不必算，索引可直接用。
- **transactions.dedup_key 是 ETL 唯一邊界**：URA API 無穩定 row id，用 `URA|name|date|area|price|floor|type|sale` 組合 key 確保重跑冪等。
- **geocoding 只服務 HDB**：URA API 已含 SVY21 x/y；HDB 需要 OneMap `/search` + disambiguation；結果存 `geocode_cache` 永久重用。
- **Singapore Open Data Licence 是寬鬆授權**：允許再發布、商用、modify、sub-license；只要做歸屬聲明 + 不暗示官方身分。所以**分享給朋友不需要每人帶自己的 URA key**。
