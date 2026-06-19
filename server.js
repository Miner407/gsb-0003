const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new Database(path.join(__dirname, "subscriptions.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    cycle TEXT NOT NULL CHECK(cycle IN ('monthly','quarterly','yearly')),
    next_billing_date TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL UNIQUE,
    budget_limit REAL NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function cycleMonths(cycle) {
  return { monthly: 1, quarterly: 3, yearly: 12 }[cycle] || 1;
}

function computeMonthlyAmount(amount, cycle) {
  const months = cycleMonths(cycle);
  return amount / months;
}

function computeCategoryMonthlyUsage() {
  const rows = db
    .prepare(
      `SELECT category, amount, cycle
       FROM subscriptions
       WHERE status = 'active'`
    )
    .all();
  const map = {};
  for (const r of rows) {
    if (!map[r.category]) map[r.category] = 0;
    map[r.category] += computeMonthlyAmount(r.amount, r.cycle);
  }
  return map;
}

function computeCalendarEvents(dbInst, category, days) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const limitDate = new Date(today);
  limitDate.setDate(limitDate.getDate() + days);
  const limitDateStr = limitDate.toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  let rows;
  if (category && category !== "all") {
    rows = dbInst
      .prepare(
        `SELECT * FROM subscriptions
         WHERE status = 'active' AND category = ?
         ORDER BY next_billing_date ASC`
      )
      .all(category);
  } else {
    rows = dbInst
      .prepare(
        `SELECT * FROM subscriptions
         WHERE status = 'active'
         ORDER BY next_billing_date ASC`
      )
      .all();
  }

  const events = [];
  for (const sub of rows) {
    let currentDate = sub.next_billing_date;
    let guard = 0;
    while (currentDate <= limitDateStr && guard < 100) {
      if (currentDate >= todayStr) {
        events.push({
          subscription_id: sub.id,
          name: sub.name,
          amount: sub.amount,
          cycle: sub.cycle,
          category: sub.category,
          status: sub.status,
          billing_date: currentDate,
        });
      }
      currentDate = addMonths(currentDate, cycleMonths(sub.cycle));
      guard++;
    }
  }
  events.sort((a, b) => (a.billing_date > b.billing_date ? 1 : -1));
  return { events, todayStr, limitDateStr, limitDate };
}

app.get("/api/subscriptions", (req, res) => {
  const status = req.query.status;
  let rows;
  if (!status || status === "all") {
    rows = db
      .prepare("SELECT * FROM subscriptions ORDER BY next_billing_date ASC")
      .all();
  } else {
    rows = db
      .prepare(
        "SELECT * FROM subscriptions WHERE status = ? ORDER BY next_billing_date ASC"
      )
      .all(status);
  }
  res.json(rows);
});

app.get("/api/subscriptions/:id", (req, res) => {
  const row = db
    .prepare("SELECT * FROM subscriptions WHERE id = ?")
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: "未找到该订阅记录" });
  res.json(row);
});

app.post("/api/subscriptions", (req, res) => {
  const { name, amount, cycle, next_billing_date, category } = req.body;
  if (!name || amount == null || !cycle || !next_billing_date || !category) {
    return res.status(400).json({ error: "缺少必填字段" });
  }
  if (!["monthly", "quarterly", "yearly"].includes(cycle)) {
    return res.status(400).json({ error: "cycle 必须为 monthly/quarterly/yearly" });
  }
  const info = db
    .prepare(
      `INSERT INTO subscriptions (name, amount, cycle, next_billing_date, category)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(name, amount, cycle, next_billing_date, category);
  const row = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json(row);
});

app.put("/api/subscriptions/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM subscriptions WHERE id = ?")
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: "未找到该订阅记录" });

  const { name, amount, cycle, next_billing_date, category, status } = req.body;
  const updated = {
    name: name ?? existing.name,
    amount: amount ?? existing.amount,
    cycle: cycle ?? existing.cycle,
    next_billing_date: next_billing_date ?? existing.next_billing_date,
    category: category ?? existing.category,
    status: status ?? existing.status,
  };

  db.prepare(
    `UPDATE subscriptions SET name=?, amount=?, cycle=?, next_billing_date=?, category=?, status=?, updated_at=datetime('now','localtime') WHERE id=?`
  ).run(
    updated.name,
    updated.amount,
    updated.cycle,
    updated.next_billing_date,
    updated.category,
    updated.status,
    req.params.id
  );
  const row = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(req.params.id);
  res.json(row);
});

app.put("/api/subscriptions/:id/deactivate", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM subscriptions WHERE id = ?")
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: "未找到该订阅记录" });
  db.prepare(
    `UPDATE subscriptions SET status='inactive', updated_at=datetime('now','localtime') WHERE id=?`
  ).run(req.params.id);
  const row = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(req.params.id);
  res.json(row);
});

app.put("/api/subscriptions/:id/renew", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM subscriptions WHERE id = ?")
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: "未找到该订阅记录" });
  const nextDate = addMonths(
    existing.next_billing_date,
    cycleMonths(existing.cycle)
  );
  db.prepare(
    `UPDATE subscriptions SET next_billing_date=?, status='active', updated_at=datetime('now','localtime') WHERE id=?`
  ).run(nextDate, req.params.id);
  const row = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(req.params.id);
  res.json(row);
});

app.delete("/api/subscriptions/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM subscriptions WHERE id = ?")
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: "未找到该订阅记录" });
  db.prepare("DELETE FROM subscriptions WHERE id = ?").run(req.params.id);
  res.json({ message: "已删除" });
});

app.get("/api/stats/monthly", (req, res) => {
  const rows = db
    .prepare("SELECT amount, cycle FROM subscriptions WHERE status = 'active'")
    .all();
  let total = 0;
  for (const r of rows) {
    const months = cycleMonths(r.cycle);
    total += r.amount / months;
  }
  res.json({ monthly_estimated: Math.round(total * 100) / 100 });
});

app.get("/api/stats/upcoming", (req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM subscriptions
       WHERE status = 'active' AND next_billing_date <= date('now','+30 days','localtime')
       ORDER BY next_billing_date ASC`
    )
    .all();
  res.json(rows);
});

app.get("/api/stats/category", (req, res) => {
  const rows = db
    .prepare(
      `SELECT category,
              SUM(CASE cycle WHEN 'monthly' THEN amount WHEN 'quarterly' THEN amount/3.0 WHEN 'yearly' THEN amount/12.0 END) AS monthly_amount
       FROM subscriptions WHERE status = 'active'
       GROUP BY category ORDER BY monthly_amount DESC`
    )
    .all();
  const totalMonthly = rows.reduce((s, r) => s + r.monthly_amount, 0);
  const result = rows.map((r) => ({
    category: r.category,
    monthly_amount: Math.round(r.monthly_amount * 100) / 100,
    percentage:
      totalMonthly > 0
        ? Math.round((r.monthly_amount / totalMonthly) * 10000) / 100
        : 0,
  }));
  res.json(result);
});

app.get("/api/budgets", (req, res) => {
  const rows = db.prepare("SELECT * FROM budgets ORDER BY category ASC").all();
  res.json(rows);
});

app.put("/api/budgets", (req, res) => {
  const { category, budget_limit } = req.body;
  if (!category || budget_limit == null) {
    return res.status(400).json({ error: "缺少必填字段 category 或 budget_limit" });
  }
  const limit = parseFloat(budget_limit);
  if (isNaN(limit) || limit < 0) {
    return res.status(400).json({ error: "budget_limit 必须为非负数" });
  }
  const existing = db.prepare("SELECT * FROM budgets WHERE category = ?").get(category);
  if (existing) {
    db.prepare(
      `UPDATE budgets SET budget_limit=?, updated_at=datetime('now','localtime') WHERE category=?`
    ).run(limit, category);
  } else {
    db.prepare(
      `INSERT INTO budgets (category, budget_limit) VALUES (?, ?)`
    ).run(category, limit);
  }
  const row = db.prepare("SELECT * FROM budgets WHERE category = ?").get(category);
  res.json(row);
});

app.delete("/api/budgets/:category", (req, res) => {
  const existing = db.prepare("SELECT * FROM budgets WHERE category = ?").get(req.params.category);
  if (!existing) return res.status(404).json({ error: "未找到该分类的预算记录" });
  db.prepare("DELETE FROM budgets WHERE category = ?").run(req.params.category);
  res.json({ message: "已删除预算" });
});

app.get("/api/budgets/usage", (req, res) => {
  const usageMap = computeCategoryMonthlyUsage();
  const budgets = db.prepare("SELECT * FROM budgets ORDER BY category ASC").all();
  const allCategories = new Set([...Object.keys(usageMap), ...budgets.map((b) => b.category)]);
  const budgetMap = {};
  for (const b of budgets) budgetMap[b.category] = b.budget_limit;

  const result = [];
  for (const cat of allCategories) {
    const used = Math.round((usageMap[cat] || 0) * 100) / 100;
    const limit = budgetMap[cat] != null ? Math.round(budgetMap[cat] * 100) / 100 : 0;
    let percentage = 0;
    if (limit > 0) percentage = Math.round((used / limit) * 10000) / 100;
    let level = "normal";
    if (limit > 0) {
      if (percentage >= 100) level = "danger";
      else if (percentage >= 80) level = "warning";
    }
    result.push({
      category: cat,
      budget_limit: limit,
      used,
      percentage,
      level,
    });
  }
  result.sort((a, b) => b.percentage - a.percentage);
  res.json(result);
});

app.get("/api/calendar", (req, res) => {
  const days = parseInt(req.query.days || "60", 10);
  const category = req.query.category || "all";
  const { events, todayStr, limitDateStr, limitDate } = computeCalendarEvents(db, category, days);

  const byDate = {};
  for (const ev of events) {
    if (!byDate[ev.billing_date]) byDate[ev.billing_date] = [];
    byDate[ev.billing_date].push(ev);
  }

  const dateRange = [];
  const cur = new Date(todayStr);
  while (cur <= limitDate) {
    dateRange.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  const dateSummaries = dateRange.map((d) => ({
    date: d,
    items: byDate[d] || [],
    total: (byDate[d] || []).reduce((s, x) => s + x.amount, 0),
  }));

  res.json({
    range: { from: todayStr, to: limitDateStr, days },
    category_filter: category,
    total_events: events.length,
    total_amount: Math.round(events.reduce((s, x) => s + x.amount, 0) * 100) / 100,
    events,
    dates: dateSummaries,
  });
});

app.get("/api/export/csv", (req, res) => {
  const days = parseInt(req.query.days || "60", 10);
  const category = req.query.category || "all";

  const { events } = computeCalendarEvents(db, category, days);

  const header = ["订阅名称", "金额(元)", "扣费日期", "分类", "状态"];
  const lines = [header.join(",")];
  for (const ev of events) {
    const line = [
      `"${(ev.name || "").replace(/"/g, '""')}"`,
      ev.amount.toFixed(2),
      ev.billing_date,
      `"${(ev.category || "").replace(/"/g, '""')}"`,
      ev.status === "active" ? "活跃" : "停用",
    ];
    lines.push(line.join(","));
  }
  const csv = "\ufeff" + lines.join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  const filename = `subscriptions_${days}_days_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});

app.get("/api/categories", (req, res) => {
  const rows = db
    .prepare("SELECT DISTINCT category FROM subscriptions ORDER BY category ASC")
    .all();
  const budgets = db.prepare("SELECT DISTINCT category FROM budgets").all();
  const set = new Set();
  rows.forEach((r) => set.add(r.category));
  budgets.forEach((b) => set.add(b.category));
  const defaults = ["影音娱乐", "工具软件", "云存储", "学习教育", "游戏", "其他"];
  defaults.forEach((d) => set.add(d));
  res.json([...set]);
});

app.listen(PORT, () => {
  console.log(`订阅账单管理应用已启动: http://localhost:${PORT}`);
});
