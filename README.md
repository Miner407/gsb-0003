# 订阅账单管理应用

基于 Node.js + Express + SQLite 构建的订阅账单管理系统，帮助你管理各种会员订阅，自动计算每月支出并提供扣费提醒。

## 功能特性

- ✅ **订阅管理**：新增、编辑、删除订阅记录
- ✅ **状态控制**：支持启用/停用订阅
- ✅ **续费更新**：一键续费，自动按周期计算下次扣费日
- ✅ **统计分析**：
  - 本月预计支出（按周期折算月均）
  - 未来 30 天扣费提醒
  - 分类月均占比可视化
- ✅ **支持的扣费周期**：每月 (monthly) / 每季 (quarterly) / 每年 (yearly)

## 技术栈

- **后端**：Node.js + Express 5
- **数据库**：SQLite (better-sqlite3)
- **前端**：原生 HTML + CSS + JavaScript

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务

```bash
npm start
```

服务启动后访问：**http://localhost:3000**

## 数据库结构

表名：`subscriptions`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| name | TEXT | 会员名称 (必填) |
| amount | REAL | 扣费金额 (必填) |
| cycle | TEXT | 扣费周期：monthly/quarterly/yearly (必填) |
| next_billing_date | TEXT | 下次扣费日 YYYY-MM-DD (必填) |
| category | TEXT | 分类，如影音娱乐、工具软件等 |
| status | TEXT | 状态：active(活跃)/inactive(停用)，默认 active |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

## API 接口文档

### 基础路径：`/api`

---

### 1. 获取订阅列表

**GET** `/api/subscriptions?status={status}`

查询参数：
- `status`（可选）：`active` / `inactive` / `all`，默认全部

**响应示例：**
```json
[
  {
    "id": 1,
    "name": "Netflix",
    "amount": 68,
    "cycle": "monthly",
    "next_billing_date": "2026-06-25",
    "category": "影音娱乐",
    "status": "active",
    "created_at": "2026-06-19 10:00:00",
    "updated_at": "2026-06-19 10:00:00"
  }
]
```

---

### 2. 获取单个订阅

**GET** `/api/subscriptions/:id`

---

### 3. 新增订阅

**POST** `/api/subscriptions`

请求体：
```json
{
  "name": "iCloud",
  "amount": 21,
  "cycle": "monthly",
  "next_billing_date": "2026-07-01",
  "category": "云存储"
}
```

---

### 4. 更新订阅

**PUT** `/api/subscriptions/:id`

请求体（支持部分字段更新）：
```json
{
  "name": "iCloud+",
  "amount": 68,
  "cycle": "monthly",
  "next_billing_date": "2026-07-01",
  "category": "云存储",
  "status": "active"
}
```

---

### 5. 停用订阅

**PUT** `/api/subscriptions/:id/deactivate`

将订阅状态改为 `inactive`，不再计入统计。

---

### 6. 续费订阅

**PUT** `/api/subscriptions/:id/renew`

自动根据扣费周期计算下次扣费日：
- monthly → 加 1 个月
- quarterly → 加 3 个月
- yearly → 加 12 个月

状态恢复为 `active`。

---

### 7. 删除订阅

**DELETE** `/api/subscriptions/:id`

---

### 8. 本月预计支出

**GET** `/api/stats/monthly`

按周期折算所有活跃订阅的月均金额：
- 月费：全额
- 季费：÷ 3
- 年费：÷ 12

**响应示例：**
```json
{
  "monthly_estimated": 258.50
}
```

---

### 9. 未来 30 天扣费提醒

**GET** `/api/stats/upcoming`

返回所有未来 30 天内需要扣费的活跃订阅列表。

---

### 10. 分类占比统计

**GET** `/api/stats/category`

按分类汇总月均金额，并计算百分比。

**响应示例：**
```json
[
  {
    "category": "影音娱乐",
    "monthly_amount": 128,
    "percentage": 49.51
  },
  {
    "category": "云存储",
    "monthly_amount": 68,
    "percentage": 26.30
  }
]
```

---

## 接口验证命令

以下命令可在 PowerShell 或 CMD 中执行（需先启动服务 `npm start`）：

### ✅ 命令 1：新增订阅
```powershell
curl -X POST http://localhost:3000/api/subscriptions -H "Content-Type: application/json" -d "{\"name\":\"Netflix\",\"amount\":68,\"cycle\":\"monthly\",\"next_billing_date\":\"2026-06-25\",\"category\":\"影音娱乐\"}"
```

### ✅ 命令 2：获取本月预计支出
```powershell
curl http://localhost:3000/api/stats/monthly
```

### ✅ 命令 3：获取未来 30 天扣费提醒
```powershell
curl http://localhost:3000/api/stats/upcoming
```

### （可选）命令 4：获取分类占比
```powershell
curl http://localhost:3000/api/stats/category
```

### （可选）命令 5：新增年费订阅
```powershell
curl -X POST http://localhost:3000/api/subscriptions -H "Content-Type: application/json" -d "{\"name\":\"JetBrains全家桶\",\"amount\":1299,\"cycle\":\"yearly\",\"next_billing_date\":\"2026-08-15\",\"category\":\"工具软件\"}"
```

### （可选）命令 6：续费订阅（自动更新日期，将 :id 替换为实际 ID）
```powershell
curl -X PUT http://localhost:3000/api/subscriptions/1/renew
```

---

## 页面操作说明

1. **新增订阅**：点击页面顶部「＋ 新增订阅」按钮，填写表单后保存
2. **停用订阅**：在活跃订阅行点击「停用」按钮，该订阅不再计入统计
3. **续费操作**：在已停用订阅行点击「续费」按钮，系统自动按周期计算下次扣费日
4. **编辑订阅**：点击「编辑」按钮可修改订阅的任意信息
5. **删除订阅**：点击「删除」按钮永久移除记录
6. **状态筛选**：使用列表上方的「活跃 / 已停用 / 全部」按钮筛选记录
7. **查看统计**：页面顶部展示本月预计支出、未来 30 天扣费提醒，下方展示分类占比可视化图表
