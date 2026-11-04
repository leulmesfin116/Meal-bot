import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

// Initialize SQLite database (supports process.env.DB_PATH for persistent volume mounts)
const dbPath = process.env.DB_PATH || path.join(path.resolve(__dirname), "meal_bot.db");
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
export const db = new DatabaseSync(dbPath);

// Enable WAL mode for better concurrency and performance
db.exec("PRAGMA journal_mode = WAL;");

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    full_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    price REAL NOT NULL,
    emoji TEXT DEFAULT '🍽️',
    is_available INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_code TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    telegram_id INTEGER NOT NULL,
    items_json TEXT NOT NULL,
    total_amount REAL NOT NULL,
    status TEXT DEFAULT 'PENDING_PAYMENT',
    payment_method TEXT DEFAULT 'BANK_TRANSFER',
    bank_tx_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    bank_name TEXT NOT NULL,
    tx_id TEXT UNIQUE NOT NULL,
    amount REAL NOT NULL,
    raw_sms TEXT NOT NULL,
    verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    verified_status TEXT DEFAULT 'VALID',
    FOREIGN KEY(order_id) REFERENCES orders(id)
  );
`);

export interface User {
  id: number;
  telegram_id: number;
  username: string | null;
  full_name: string;
  phone_number: string;
  created_at: string;
}

export interface MenuItem {
  id: number;
  name: string;
  category: string;
  description: string;
  price: number;
  emoji: string;
  is_available: number;
}

export interface CartItem {
  id: number;
  name: string;
  price: number;
  quantity: number;
  emoji?: string;
}

export interface Order {
  id: number;
  order_code: string;
  user_id: number;
  telegram_id: number;
  items_json: string;
  total_amount: number;
  status: "PENDING_PAYMENT" | "PAID" | "PREPARING" | "COMPLETED" | "CANCELLED";
  payment_method: string;
  bank_tx_id: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface PaymentRecord {
  id: number;
  order_id: number;
  bank_name: string;
  tx_id: string;
  amount: number;
  raw_sms: string;
  verified_at: string;
  verified_status: string;
}

// User Helpers
export function getUserByTelegramId(telegramId: number): User | null {
  const stmt = db.prepare("SELECT * FROM users WHERE telegram_id = ?");
  const result = stmt.get(telegramId) as unknown as User | undefined;
  return result || null;
}

export function saveUser(data: {
  telegram_id: number;
  username?: string | null;
  full_name: string;
  phone_number: string;
}): User {
  const existing = getUserByTelegramId(data.telegram_id);
  if (existing) {
    const updateStmt = db.prepare(
      "UPDATE users SET full_name = ?, phone_number = ?, username = ? WHERE telegram_id = ?"
    );
    updateStmt.run(
      data.full_name,
      data.phone_number,
      data.username || null,
      data.telegram_id
    );
    return getUserByTelegramId(data.telegram_id)!;
  }

  const insertStmt = db.prepare(
    "INSERT INTO users (telegram_id, username, full_name, phone_number) VALUES (?, ?, ?, ?)"
  );
  insertStmt.run(
    data.telegram_id,
    data.username || null,
    data.full_name,
    data.phone_number
  );
  return getUserByTelegramId(data.telegram_id)!;
}

// Menu Helpers
export function getAllMenuItems(): MenuItem[] {
  const stmt = db.prepare(
    "SELECT * FROM menu_items WHERE is_available = 1 ORDER BY category, id"
  );
  return (stmt.all() as unknown as MenuItem[]) || [];
}

export function getMenuItemById(id: number): MenuItem | null {
  const stmt = db.prepare("SELECT * FROM menu_items WHERE id = ?");
  const result = stmt.get(id) as unknown as MenuItem | undefined;
  return result || null;
}

export function seedInitialMenuIfEmpty(): void {
  // Reset menu items so only the current active menu items are available
  db.exec("DELETE FROM menu_items");

  const insertStmt = db.prepare(
    "INSERT INTO menu_items (name, category, description, price, emoji, is_available) VALUES (?, ?, ?, ?, ?, 1)"
  );

  const initialMenu = [
    {
      name: "ሩዝ በቴስቲ ሶያ፣ አትክልትና እንቁላል",
      category: "ሩዝ (Rice)",
      description: "ሩዝ በቴስቲ ሶያ፣ አትክልትና እንቁላል",
      price: 210,
      emoji: "🍚",
    },
    {
      name: "ሩዝ በቴስቲ ሶያና አትክልት",
      category: "ሩዝ (Rice)",
      description: "ሩዝ በቴስቲ ሶያና አትክልት",
      price: 160,
      emoji: "🍚",
    },
    {
      name: "ሩዝ በቴስቲ ሶያ",
      category: "ሩዝ (Rice)",
      description: "ሩዝ በቴስቲ ሶያ",
      price: 150,
      emoji: "🍚",
    },
    {
      name: "ፓስታ በቴስቲ ሶያ፣ አትክልትና እንቁላል",
      category: "ፓስታ (Pasta)",
      description: "ፓስታ በቴስቲ ሶያ፣ አትክልትና እንቁላል",
      price: 230,
      emoji: "🍝",
    },
  ];

  for (const item of initialMenu) {
    insertStmt.run(item.name, item.category, item.description, item.price, item.emoji);
  }
}

// Order Helpers
export function createOrder(data: {
  user_id: number;
  telegram_id: number;
  items: CartItem[];
  total_amount: number;
}): Order {
  const orderCode = `ORD-${Date.now().toString().slice(-6)}`;
  const itemsJson = JSON.stringify(data.items);

  const stmt = db.prepare(
    "INSERT INTO orders (order_code, user_id, telegram_id, items_json, total_amount, status) VALUES (?, ?, ?, ?, ?, 'PENDING_PAYMENT')"
  );
  stmt.run(orderCode, data.user_id, data.telegram_id, itemsJson, data.total_amount);

  return getOrderByCode(orderCode)!;
}

export function getOrderByCode(orderCode: string): Order | null {
  const stmt = db.prepare("SELECT * FROM orders WHERE order_code = ?");
  const result = stmt.get(orderCode) as unknown as Order | undefined;
  return result || null;
}

export function getOrderById(orderId: number): Order | null {
  const stmt = db.prepare("SELECT * FROM orders WHERE id = ?");
  const result = stmt.get(orderId) as unknown as Order | undefined;
  return result || null;
}

export function getLatestPendingOrder(telegramId: number): Order | null {
  const stmt = db.prepare(
    "SELECT * FROM orders WHERE telegram_id = ? AND status = 'PENDING_PAYMENT' ORDER BY id DESC LIMIT 1"
  );
  const result = stmt.get(telegramId) as unknown as Order | undefined;
  return result || null;
}

export interface OrderWithUser extends Order {
  customer_name: string;
  customer_phone: string;
}

export function getAllOrdersWithUsers(): OrderWithUser[] {
  const stmt = db.prepare(`
    SELECT o.*, u.full_name as customer_name, u.phone_number as customer_phone
    FROM orders o
    JOIN users u ON o.user_id = u.id
    ORDER BY o.id DESC
  `);
  return (stmt.all() as unknown as OrderWithUser[]) || [];
}

export function getUserOrders(telegramId: number): Order[] {
  const stmt = db.prepare(
    "SELECT * FROM orders WHERE telegram_id = ? ORDER BY id DESC LIMIT 10"
  );
  return (stmt.all(telegramId) as unknown as Order[]) || [];
}

export function updateOrderStatus(
  orderId: number,
  status: Order["status"],
  bankTxId?: string
): void {
  if (status === "PAID") {
    const stmt = db.prepare(
      "UPDATE orders SET status = ?, bank_tx_id = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?"
    );
    stmt.run(status, bankTxId || null, orderId);
  } else {
    const stmt = db.prepare("UPDATE orders SET status = ? WHERE id = ?");
    stmt.run(status, orderId);
  }
}

// Payment Helpers
export function isTxIdUsed(txId: string): boolean {
  const cleanTx = txId.trim().toUpperCase();
  const stmt = db.prepare("SELECT id FROM payments WHERE UPPER(tx_id) = ?");
  const res = stmt.get(cleanTx);
  return Boolean(res);
}

export function recordPayment(data: {
  order_id: number;
  bank_name: string;
  tx_id: string;
  amount: number;
  raw_sms: string;
  verified_status?: string;
}): PaymentRecord {
  const stmt = db.prepare(
    "INSERT INTO payments (order_id, bank_name, tx_id, amount, raw_sms, verified_status) VALUES (?, ?, ?, ?, ?, ?)"
  );
  stmt.run(
    data.order_id,
    data.bank_name,
    data.tx_id.trim().toUpperCase(),
    data.amount,
    data.raw_sms,
    data.verified_status || "VALID"
  );

  const getStmt = db.prepare("SELECT * FROM payments WHERE tx_id = ?");
  return getStmt.get(data.tx_id.trim().toUpperCase()) as unknown as PaymentRecord;
}

// Admin Helpers
export interface AdminStats {
  totalUsers: number;
  totalOrders: number;
  totalPaidOrders: number;
  totalRevenue: number;
  pendingCount: number;
}

export function getAdminStats(): AdminStats {
  const usersCount = (db.prepare("SELECT COUNT(*) as count FROM users").get() as unknown as { count: number }).count;
  const ordersCount = (db.prepare("SELECT COUNT(*) as count FROM orders").get() as unknown as { count: number }).count;
  const paidOrders = (db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status = 'PAID'").get() as unknown as { count: number; total: number });
  const pendingCount = (db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'PENDING_PAYMENT'").get() as unknown as { count: number }).count;

  return {
    totalUsers: usersCount,
    totalOrders: ordersCount,
    totalPaidOrders: paidOrders.count,
    totalRevenue: paidOrders.total,
    pendingCount: pendingCount,
  };
}
