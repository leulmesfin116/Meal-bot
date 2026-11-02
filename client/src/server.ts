import dotenv from "dotenv";
dotenv.config();

import path from "node:path";
import express, { Request, Response } from "express";
import {
  seedInitialMenuIfEmpty,
  getAllMenuItems,
  getAllOrdersWithUsers,
  getOrderByCode,
  updateOrderStatus,
  getAdminStats,
} from "../db/index";
import { parseBankSMS, verifyPaymentSms } from "../utilis/smsParser";
import { createBot } from "./bot";

// 1. Initialize Database & Seed Menu
seedInitialMenuIfEmpty();
console.log("✅ Database initialized and meal menu seeded successfully.");

// 2. Initialize Express Server for Web Dashboard & API
const app = express();
app.use(express.json());

// Serve static frontend files from public/
const publicDir = path.resolve(__dirname, "../public");
app.use(express.static(publicDir));

const PORT = process.env.PORT || 3000;
const botToken = process.env.BOT_TOKEN;

// API: Stats endpoint
app.get("/api/admin/stats", (req: Request, res: Response) => {
  const stats = getAdminStats();
  res.json({ success: true, data: stats });
});

// API: Orders endpoint
app.get("/api/orders", (req: Request, res: Response) => {
  const orders = getAllOrdersWithUsers();
  res.json({ success: true, count: orders.length, data: orders });
});

// API: Update order status
app.post("/api/orders/:code/status", (req: Request, res: Response) => {
  const { code } = req.params;
  const { status } = req.body;
  const order = getOrderByCode(code);

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  updateOrderStatus(order.id, status);
  res.json({ success: true, orderCode: code, newStatus: status });
});

// API: Menu endpoint
app.get("/api/menu", (req: Request, res: Response) => {
  const menu = getAllMenuItems();
  res.json({ success: true, count: menu.length, data: menu });
});

// API: Test SMS Parser endpoint
app.post("/api/test-sms", (req: Request, res: Response) => {
  const { smsText, expectedAmount } = req.body;
  if (!smsText) {
    res.status(400).json({ error: "smsText body parameter is required" });
    return;
  }

  const parsed = parseBankSMS(smsText);
  let verification = null;
  if (expectedAmount) {
    verification = verifyPaymentSms(smsText, Number(expectedAmount));
  }

  res.json({
    parsed,
    verification,
  });
});

// Start Express server
app.listen(PORT, () => {
  console.log(`🌐 Web/API server listening on http://localhost:${PORT}`);
});

// 3. Start Telegram Bot
if (!botToken || botToken === "YOUR_TELEGRAM_BOT_TOKEN_HERE") {
  console.log("\n========================================================");
  console.log("⚠️  TELEGRAM BOT TOKEN NOT CONFIGURED YET!");
  console.log("👉 Please create a bot with @BotFather on Telegram");
  console.log("👉 Copy your bot token and paste it into client/.env");
  console.log("   BOT_TOKEN=123456789:ABCdefGHIjklmnoPQRstuvWXYZ");
  console.log("========================================================\n");
} else {
  const bot = createBot(botToken);

  bot.start({
    onStart: (botInfo) => {
      console.log(`🤖 Telegram Bot @${botInfo.username} is running and ready for orders!`);
      console.log(`   - Username & Phone collection: ENABLED`);
      console.log(`   - Interactive Meal Menu: ENABLED`);
      console.log(`   - Bank SMS Payment Authentication: ENABLED`);
    },
  });
}
