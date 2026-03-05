# 抽獎數據分析系統 (Lottery Analysis System)

這是一個全棧 Web 應用程式，旨在幫助論壇或社群媒體管理員分析抽獎貼文的數據，包括中獎率統計、符合資格者篩選、以及重複中獎者（超級幸運兒）的追蹤。

## 🌟 核心功能

- **JSON 數據匯入與驗證**：支援匯入結構化的抽獎數據，並在前端進行實時結構驗證。
- **整體中獎率分析**：透過 MongoDB 聚合分析，計算所有歷史貼文的平均中獎率。
- **留言內容洞察**：分析特定關鍵字（如「抽」）與中獎機率之間的關聯。
- **個人紀錄查詢**：使用者可輸入姓名與主頁連結，查詢在所有貼文中的參與及中獎歷史。
- **重複中獎者追蹤**：自動辨識並列出在多個活動中重複幸運中獎的使用者。

## 🛠️ 技術架構

### 前端 (Frontend)
- **Vanilla JavaScript (ES6+)**
- **Fetch API** (與後端通訊)
- **CSS3 Flexbox** (自適應佈局)

### 後端 (Backend)
- **Python / Flask**
- **PyMongo** (MongoDB 驅動)
- **Flask-CORS**

### 資料庫 (Database)
- **MongoDB** (使用 Aggregation Pipeline 進行複雜數據處理)

## 🚀 快速開始

### 1. 環境設定

在 `backend` 資料夾下：
- 安裝套件：`pip install -r requirements.txt`
- 複製 `.env.example` 並更名為 `.env`，填入你的 MongoDB 連線字串。

### 2. 啟動後端

```bash
cd backend
python app.py
```

### 3. 啟動前端

直接在瀏覽器打開 `Frontend/index.html`，或使用 VS Code 的 Live Server 插件啟動。

---

## 📄 專案結構

```text
midterm-project/
├── Frontend/           # 前端介面與邏輯
│   ├── index.html
│   ├── script.js
│   └── style.css
├── backend/            # Flask API 伺服器
│   ├── app.py
│   ├── .env.example
│   └── requirements.txt
├── .gitignore          # Git 忽略設定
└── README.md           # 專案說明文件
```
