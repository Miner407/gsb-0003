const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = 3000;

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

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function cycleMonths(cycle) {
  return { monthly: 1, quarterly: 3, yearly: 12 }[cycle] || 1;
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

app.listen(PORT, () => {
  console.log(`订阅账单管理应用已启动: http://localhost:${PORT}`);
});
