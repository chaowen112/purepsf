# 新加坡版「樂居」— 房產成交事實視覺化工具

> Approved plan, 2026-05-14. Source: `~/.claude/plans/fizzy-cuddling-whistle.md`.

## Context

新加坡房市資訊不缺，缺的是**乾淨、可空間對比的「成交事實」**。99.co / PropertyGuru 充斥房仲開價（asking price），而 URA / HDB 公開的真實成交資料以表格形式散落、難以比較。本專案目標：

- 以**成交價（transaction price）**為核心，排除開價噪聲。
- **空間視覺化**：地圖呈現建案 PSF，而非清單。
- **新房動態**：追蹤 URA 每月發布的開發商銷售數據（units launched / sold / unsold），掌握去化節奏。

部署情境：**個人本地起步，未來可能分享給朋友/小群體** — 影響認證設計與 URA 資料再發布合規。

---

## 資料來源驗證結果

| 來源 | 端點/格式 | 認證 | 用途 |
|---|---|---|---|
| URA 私宅成交 | `https://eservice.ura.gov.sg/uraDataService/invokeUraDS/v1?service=PMI_Resi_Transaction&batch=1` (JSON, 過去 5 年, **回傳含 x/y SVY21 座標**) | access key + token | 私宅成交主資料 |
| HDB 轉售 | `data.gov.sg/api/action/datastore_search?resource_id=d_8b84c4ee58e3cfc0ece0d773c8ca6abc` (JSON) | 無 | 組屋轉售（只有 block + street，需 geocode） |
| URA 開發商銷售 | 月度 Excel/PDF 報表（`ura.gov.sg/Corporate/Property/Property-Data`）；每月 15 號發布上月資料 | 公開下載 | 新房 units launched/sold/unsold |
| OneMap `/search` | `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=...&returnGeom=Y&getAddrDetails=Y` | token, 15k/hr | HDB block+street → 經緯度 |

✅ **註冊建議走 `developer.tech.gov.sg/products/categories/data-and-apis/ura-apis`** — 與 `ura.gov.sg/maps` 是同一支 API、同一把 access key，但走政府開發者入口註冊流程比較順、有統一的文件中心。最終 API 端點仍是 `eservice.ura.gov.sg/uraDataService/...`。

### 免費 Data Service API vs REALIS 訂閱（S$1,960/年）

兩者**不是同一東西**，但對本專案來說**完全用免費 API 就夠**。差異：

| 資料類別 | 免費 Data Service API | REALIS 訂閱 |
|---|---|---|
| 私宅成交（unit level） | ✅ PMI_Resi_Transaction，過去 5 年，每週二/五更新 | ✅ 更長歷史、可在 UI 內搜尋與篩選、Annual plan 可下載 Excel |
| 私宅租賃 | ✅ PMI_Resi_Rental + Median Rental endpoints | ✅ 同上 + 商用/Shophouse/HDB Sold Shop 租賃 |
| **開發商銷售（每月 units launched/sold/unsold）** | ❌ **API 不含** — 只能爬 URA 月度 Excel 報表 | ✅ Developers' Sales DB，UI 直接查 |
| Project DB（建商名、施工狀態、戶型 mix） | ❌ 部分可從月度 Excel 拼出 | ✅ Project DB，季更 |
| 商用/工業成交 | ❌ | ✅ Transaction DB 含 Office/Retail/Factory/Warehouse/Business Park |
| Stock & Vacancy 時序 | ⚠️ 可從 data.gov.sg 的 URA 季度 dataset 補 | ✅ Stock DB，季更，可篩 location/property type |
| 500+ 時間序列（PPI、租金指數等） | ⚠️ data.gov.sg 提供大部分為 CSV dataset，需自行拼 | ✅ Timeseries DB，含內建 charting / 公式運算 |
| UI / Dashboard / Excel 匯出 | ❌（純 API） | ✅ Annual plan 才能下載 |
| 歷史深度 | 過去 5 年 | 數十年（PPI 可回到 1975） |

**結論**：你拿到的 API key 就是 free Data Service API。本專案的全部需求（unit-level 成交、PSF 散佈、空間查詢、5 年歷史、新房 launched/sold）都能用「free API + 月度 Excel 爬蟲 + data.gov.sg dataset 補歷史」完成，**不需要 REALIS 訂閱**。

REALIS 訂閱真正值得買的情境：(a) 要做商用/工業房地產分析、(b) 要回看 10 年以上歷史長期趨勢、(c) 自己分析時直接用 UI 比寫程式快。本專案三者都不命中。

✅ **授權非常寬鬆**（Singapore Open Data Licence，見 `ura.gov.sg/ms/eservices/Maps/acceptance-grant-licence`）：
> "You can use, access, download, copy, distribute, transmit, modify and adapt the datasets, or any derived analyses or applications, whether commercially or non-commercially."

允許再發布、轉授權給使用者、商用，**不需要每使用者自帶 key**。必須做到：
- 頁尾放醒目歸屬聲明（例：`Data © URA, HDB · Singapore Open Data Licence` + 連結到 licence 頁）
- 不可暗示官方背書或官方身分
- 標準免責 / 賠償條款（不為 URA 招攬法律責任）

---

## 技術棧推薦（含取捨）

**架構切分：ETL 與 Web Backend 完全分離，共用 Postgres**

| 層 | 技術 | 理由 |
|---|---|---|
| ETL（資料處理） | **Python 3.12** + `httpx` + `pandas` + `openpyxl` + `pdfplumber` + `pyproj` + `apscheduler` | 月報 Excel/PDF 解析、SVY21→WGS84 轉換、fuzzy geocoding，這些在 Python 生態壓倒性勝出。獨立程序，產出寫入 Postgres，不對外開 port。 |
| Web Backend | **Go 1.23+** + `chi` (router) + `pgx` + `sqlc` | 一次到位、不重做。Web 端的工作只是 PostGIS query 翻成 JSON，Go 寫得乾淨且部署成單一 binary。`sqlc` 生成 type-safe query code，配 PostGIS 查詢非常順手。 |
| 資料庫 | **PostgreSQL 16 + PostGIS 3** | 空間索引（GiST）+ `ST_DWithin` 是「找 1km 內所有成交」的標準解。ETL 與 Backend 唯一的介面。 |
| 排程 | **APScheduler**（Python ETL 內嵌） | 個人尺度不需要 Airflow。每日抓 URA 增量、每月 15 號抓開發商銷售。 |
| 前端 | **React + Vite + TypeScript + Tailwind** | 純 SPA + REST 即可，不需要 SSR。Vite 啟動快。 |
| 地圖 | **MapLibre GL JS** | 避開 Mapbox 計費 — 分享給朋友時 Mapbox API key 用量會爆。MapLibre 完全免費，配 OneMap raster tiles。重資料量再疊 Deck.gl。 |
| Tiles | **OneMap raster tiles** | 官方、免費、新加坡細節最好。 |
| 部署 | docker-compose（本地）→ 單一 VM + Caddy 反代（共享階段） | 過度設計是大忌。 |

**為什麼這樣切**：ETL 是 batch、寫多讀少；Web 是 stateless、讀多寫零。兩邊需求完全不同，硬塞同一個進程會被互相拖累（Python 的 GIL 不利併發 read query、Go 的 PDF 生態不利寫 ETL）。Postgres 作為唯一耦合點，未來想換掉任一邊都容易。

---

## MVP（4–6 週）

**核心問題：能不能在地圖上看到 10 個追蹤的新建案，每個都有「真實成交 PSF 散佈圖 + 周邊 500m 轉售均價 + 新房溢價率」？**

### M0 — 基礎設施（3 天）
- `docker-compose.yml`：Postgres 16 + PostGIS、backend、(dev) frontend
- 申請 URA API key、OneMap token
- 專案骨架：`backend/`、`frontend/`、`etl/`、`infra/`

### M1 — ETL 與資料庫（1.5 週）
- Schema（從 v1 角度設計，MVP 只填子集）：
  - `projects` (project_id, name, district, market_segment, lat/lng, geom, source: 'URA'/'HDB')
  - `transactions` (id, project_id, contract_date, area_sqm, price, psf, tenure, floor_range, property_type, type_of_sale, source)
  - `developer_sales_snapshots` (project_id, snapshot_month, units_launched, units_sold, units_unsold)
  - `tracked_projects` (project_id, notes) — MVP 的 10 個追蹤標的
  - `geocode_cache` (query_string PK, lat, lng, source: 'onemap'/'manual', confidence, geocoded_at) — 避免重打 OneMap
- ETL 任務（全部 Python）：
  - `etl/ura_transactions.py`：分頁拉 4 季 batch (1–4)，URA 已回傳 SVY21 x/y → `pyproj` 轉 WGS84，upsert
  - `etl/hdb_resale.py`：data.gov.sg API 分頁拉取，呼叫 `geocode.py`
  - `etl/ura_developer_sales.py`：**MVP 先手動下載 Excel 放進 `data/` 目錄 + 寫一個解析 script**；自動下載 parser 留 v1。（這是免費 API 唯一無法直接覆蓋、必須走 Excel 的部分，但也是專案的「秘方」）
  - `etl/geocode.py`：見下節「Geocoding 策略」
- 驗證：抽 10 筆 URA 成交，比對 URA 官網 e-service 顯示值（價格、PSF、樓層區段都吻合）

### Geocoding 策略

**URA 私宅完全不需要 geocode** — API 回傳已含 SVY21 x/y 座標，只需 `pyproj.Transformer.from_crs("EPSG:3414", "EPSG:4326")` 一行轉換。

**HDB 需要 geocode（只有 block + street）**，但實務上沒想像中麻煩。Medium 那篇文章記錄 12,877 筆 HDB 紀錄只有 3 筆完全失敗，主要痛點是 **disambiguation**（不是 lookup 失敗）。策略：

1. **正規化 query**：`f"{block} {street}"`，街名按 OneMap 慣例改大寫並展開縮寫（`ST` → `STREET`、`RD` → `ROAD` 等，少數規則）。
2. **打 OneMap `/search`**（`returnGeom=Y&getAddrDetails=Y`），結果用 `(BLK_NO, ROAD_NAME)` 精確比對 query；命中即用。
3. **多筆候選的處理**：對「大型混合用途建築」（一個地址有 N 個 OneMap 結果），取 `BUILDING` 欄位包含 `HDB` 或 `BLK` 的那筆；都沒有就取第一個（樣本顯示這對 HDB 影響很小）。
4. **完全失敗的處理**（< 0.1% 案例）：寫進 `geocode_cache` 標 `confidence='failed'`，跑完整批後印出清單，人工查 Google Maps 補上 lat/lng、`source='manual'`。
5. **快取**：以 `f"{block}|{street}"` 為 key，HDB 是同一棟樓的所有交易共用結果。12k 個 unique block-street，一次跑完 < 15 分鐘，遠低於 OneMap 15k/hr 上限。
6. **不採用 Medium 文章的「全 postal code 反查」方案** — 該方法只 15% 有結果，計算量大且更不穩定。

**收益**：MVP 階段預期 ≥99.9% 自動成功率，剩下幾十筆人工點一下就解決，後續 incremental ETL 也只需要 geocode 新出現的 block-street 組合。

### M2 — Backend API（1 週，Go）
- `GET /api/projects?bbox=lng1,lat1,lng2,lat2` — 地圖視窗內建案
- `GET /api/projects/{id}/transactions?from=&to=` — 該建案成交序列
- `GET /api/projects/{id}/comparison` — 周邊 500m 轉售均價 + 自身均價 + 新房溢價率
- `GET /api/tracked` — 10 個追蹤標的的最新狀態（含 developer sales snapshot）
- 所有查詢寫成 `queries/*.sql` 由 sqlc 生成 type-safe Go code；handler 只負責 bbox/date 參數解析與 JSON 編碼
- 全部 PostGIS spatial query；`go test` 覆蓋 handler + query 邏輯

### M3 — 前端（1.5 週）
- MapLibre 地圖 + OneMap tiles
- Layer 1：所有建案點（按 PSF 分色）
- 點擊建案 → 側欄：
  - 該建案 PSF 散佈圖（recharts；x = contract_date, y = psf, color = property_type/BR）
  - 同郵區（District）平均 PSF 水平參考線
  - 周邊 500m 轉售均價
  - 若是追蹤標的 → 額外顯示 units launched / sold / unsold 折線
- 篩選列：district、tenure、property_type、日期區間

### M4 — 驗證與打磨（3 天）
- 跑「驗證計畫」章節列的測試
- 寫一頁 README，主要記錄資料來源與限制

**MVP 不做**：認證、租金回報、學區、自動 PDF 解析、行動裝置最佳化、新案 alert。

---

## v1 路線圖（MVP 後 2–3 個月）

依價值順序：

1. **URA 月報自動解析** — `pdfplumber` + 結構化規則 + 抽樣人工校對；每月 16 號排程；落入 `developer_sales_snapshots`。
2. **全島覆蓋** — schema 已預留，只需擴大 ETL 範圍與索引調優。
3. **認證**（決定要分享給朋友時）— 授權允許再發布，所以不為合規而做認證，只為控管流量/濫用：
   - 最輕：Cloudflare Tunnel + Cloudflare Access（Google 登入白名單），完全不寫 auth code
   - 重：自建 email magic link
   - 若完全公開：套個 Cloudflare 免費版做 rate limit + bot 防護就好
4. **租金回報率圖層** — URA 也有 PMI_Resi_Rental API，結構類似。
5. **學區圖層** — data.gov.sg 有小學/中學 geo dataset。
6. **新案 alert** — 訂閱「某建案去化率變化超過 5%」推 email/Telegram。

---

## 驗證計畫

MVP 完成時須通過：

1. **資料正確性** — 隨機抽 10 筆 `transactions`，比對 URA Property Data e-Service 官網顯示的合約日、area、price、PSF；HDB 抽 10 筆比對 `services2.hdb.gov.sg/webapp/BB33RTIS/`。
2. **空間查詢正確** — 用 QGIS 載入 PostGIS、人眼確認 5 個建案的「500m 內鄰居」清單合理。
3. **API 契約** — 每個 endpoint 有 pytest/go test，覆蓋空 bbox、不存在 project_id、跨日期邊界。
4. **端對端** — 瀏覽器開地圖、平移到 D9、點 Marina One Residences → 出現 PSF 散佈、區內平均線、若在追蹤清單則出現 sold/launched 數字。
5. **新房溢價率合理性** — 自選一個近期新案，手算「新案均價 / 周邊轉售均價 - 1」與 UI 顯示值一致。
6. **歸屬聲明檢查** — 頁尾必須顯示資料來源與 Singapore Open Data Licence 連結，且網頁文案不暗示官方身分或背書。

---

## 主要風險與緩解

| 風險 | 緩解 |
|---|---|
| URA 月報 PDF/Excel 格式變動 → parser 壞 | MVP 階段半手動，v1 寫 parser 時搭配「結構檢查 + 失敗時降級到上月資料 + email 警告」 |
| OneMap rate limit (15k/hr) | 地理編碼結果永久存進 `geocode_cache`，只有新出現的 block-street 才打 API |
| URA API 只回過去 5 年 | MVP 接受此限制；歷史資料可從 data.gov.sg 的 URA 季度 dataset 補（已驗證存在） |
| Mapbox 帳單 | 用 MapLibre + OneMap tiles 從根本上規避 |
| 看起來像 URA 官方 | UI 文案明確標「Independent project, data sourced from URA/HDB under Singapore Open Data Licence」 |
