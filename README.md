# 🍽️ Meal Bot — Telegram Food Ordering with Bank SMS Payment Authentication

A full-featured Telegram bot built with **TypeScript**, **grammY**, **Express**, and **SQLite**.

## 🌟 Key Features

1. 👤 **User Registration**: Prompts for Full Name and Phone Number (with native Telegram "Share Contact" button or text fallback).
2. 🍱 **Interactive Menu & Cart**: Browse categories, adjust quantities with inline `➕` / `➖` buttons, and checkout.
3. 💳 **Bank SMS Payment Authentication**: Generates an order, provides Bank details (CBE, Telebirr, etc.), and authenticates payment by parsing and verifying the user's forwarded or pasted **Bank confirmation SMS**.
4. 📸 **Dual-Layer Payment Verification**:
   - **Instant Automated SMS Parsing**: Instant verification of transaction code, amount, and duplicate check.
   - **Screenshot / Photo Receipt Fallback**: Customers can upload receipt screenshots; the bot forwards them to the admin with 1-click `[✅ Approve]` and `[❌ Reject]` buttons!
5. 👨‍🍳 **Real-Time Kitchen Notifications**: When the kitchen or admin changes the status to `PREPARING`, `OUT_FOR_DELIVERY`, or `COMPLETED`, the customer receives an instant push message in Telegram!
6. 🖥️ **Live Web Dashboard**: A visual kitchen and order pipeline dashboard at `http://localhost:3000` with live metrics and an interactive Bank SMS simulator.
7. 🛡️ **Anti-Fraud Security**: Prevents replay attacks (duplicate transaction IDs cannot be reused) and verifies that the transferred amount matches or exceeds the order total.

---

## 🚀 Quick Start Guide

### 1. Configure Telegram Bot Token
1. Open Telegram and search for [@BotFather](https://t.me/botfather).
2. Send `/newbot`, choose a name and username (e.g. `my_meal_ordering_bot`).
3. Copy the HTTP API token provided by BotFather.
4. Open [client/.env](file:///c:/Users/danme/Desktop/meal/client/.env) and paste your token:
   ```env
   BOT_TOKEN=123456789:ABCdefGHIjklmnoPQRstuvWXYZ
   ```

### 2. Configure Bank Transfer Accounts
In [client/.env](file:///c:/Users/danme/Desktop/meal/client/.env), configure your recipient accounts:
```env
ACCOUNT_NAME=Matiyas Mahmud
CBE_ACCOUNT=1000511676208
TELEBIRR_ACCOUNT=0900055363
ADMIN_TELEGRAM_ID=  # Optional: your numeric Telegram ID for instant paid order alerts
```

### 3. Start the Bot
```bash
cd client
npm run dev
```

---

## 📱 Bot Workflow

```mermaid
graph TD
    A["User sends /start"] --> B{"Is user registered?"}
    B -- No --> C["Ask for Full Name / Username"]
    C --> D["Request Phone Number (Share Contact Button)"]
    D --> E["Save User in SQLite"]
    B -- Yes --> F["Welcome Back! Show Dashboard"]
    E --> F
    F --> G["Browse /menu"]
    G --> H["Add meals to /cart"]
    H --> I["Click 'Confirm Order & Pay'"]
    I --> J["Create Order #ORD-XXXX (PENDING_PAYMENT)"]
    J --> K["Display Bank Accounts (CBE & Telebirr)"]
    K --> L["User transfers money and pastes Bank SMS"]
    L --> M["Validate SMS (Extract Tx ID & Amount)"]
    M --> N{"Is Tx ID duplicate or Amount insufficient?"}
    N -- Yes --> O["Reject & Display Specific Error"]
    N -- No --> P["Mark Order as PAID & Record Payment"]
    P --> Q["Issue Official Digital Receipt to User"]
    P --> R["Notify Admin Telegram ID"]
```

---

## 🧪 Testing Bank SMS Authentication

You can test payment verification right in Telegram by placing an order and pasting sample bank SMS messages:

### Sample CBE SMS:
```text
Dear Customer, your account 100012345678 has been debited with ETB 380.00 on 30-10-2026. Reason: Transfer to MATIYAS MAHMUD. Transaction ID: FT241030ABCD987.
```

### Sample Telebirr SMS:
```text
Dear customer, you have transferred 380.00 Birr to Matiyas Mahmud (0900055363) on 30/10/2026 18:30:15. Transaction number is CI241030.1830.B12345.
```

The bot will automatically:
- Recognize the bank (CBE / Telebirr / BOA / Awash / etc.)
- Extract the unique transaction code (`FT241030ABCD987` or `CI241030.1830.B12345`)
- Check that this code hasn't been used before
- Check that the amount is `>=` order total
- Mark the order as **PAID** and send the confirmation receipt.

---

## 🛠️ Project Structure

- [client/src/server.ts](file:///c:/Users/danme/Desktop/meal/client/src/server.ts): Application entry point, Express server & Bot launcher.
- [client/src/bot.ts](file:///c:/Users/danme/Desktop/meal/client/src/bot.ts): Main grammY bot setup, commands (`/start`, `/menu`, `/cart`, `/orders`, `/profile`, `/help`), and inline callback query router.
- [client/src/conversations/register.ts](file:///c:/Users/danme/Desktop/meal/client/src/conversations/register.ts): 2-step user onboarding flow.
- [client/src/conversations/payment.ts](file:///c:/Users/danme/Desktop/meal/client/src/conversations/payment.ts): Bank SMS ingestion and instant verification flow.
- [client/src/keyboards.ts](file:///c:/Users/danme/Desktop/meal/client/src/keyboards.ts): Inline keyboards and custom reply keyboards.
- [client/utilis/smsParser.ts](file:///c:/Users/danme/Desktop/meal/client/utilis/smsParser.ts): Robust Bank SMS regex parser & fraud detection engine.
- [client/db/index.ts](file:///c:/Users/danme/Desktop/meal/client/db/index.ts): Synchronous SQLite database models (`users`, `menu_items`, `orders`, `payments`).

---

## 🚀 Deployment Guide

### Prerequisites
- **Node.js**: Version **22+** (required for `node:sqlite` DatabaseSync)
- **Telegram Bot Token**: From [@BotFather](https://t.me/botfather)

---

### Option 1: Docker & Docker Compose (Recommended - Quickest & Most Reliable)

1. Create your environment file:
   ```bash
   cp client/.env.example .env
   # Edit .env with your BOT_TOKEN and bank details
   ```

2. Start the container in background:
   ```bash
   docker compose up -d --build
   ```

3. Check logs:
   ```bash
   docker compose logs -f
   ```

> SQLite database is automatically persisted safely inside the `meal_bot_data` volume.

---

### Option 2: Linux VPS (Ubuntu / Debian with PM2 + Nginx)

1. **Install Node.js 22 & PM2**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs
   sudo npm install -g pm2
   ```

2. **Clone & Install**:
   ```bash
   git clone <YOUR_REPO_URL> meal
   cd meal/client
   npm install
   cp .env.example .env
   nano .env # Paste your BOT_TOKEN and settings
   ```

3. **Start with PM2 (Auto-restart on crash & reboot)**:
   ```bash
   pm2 start "npm start" --name "meal-bot"
   pm2 save
   pm2 startup
   ```

4. **(Optional) Expose Web Dashboard with Nginx & SSL**:
   ```nginx
   server {
       server_name meals.yourdomain.com;
       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```
   Run `sudo certbot --nginx -d meals.yourdomain.com` for free HTTPS.

---

### Option 3: Cloud Hosting (Railway, Fly.io, or Render)

#### **Railway** (Zero config + Persistent Volume):
1. Push code to GitHub.
2. Link your repository in [Railway.app](https://railway.app).
3. Set **Root Directory** to `client` (or use the root Dockerfile).
4. Add Environment Variables (`BOT_TOKEN`, `ACCOUNT_NAME`, `CBE_ACCOUNT`, `TELEBIRR_ACCOUNT`).
5. Under Settings -> **Volumes**, add a persistent volume mounted to `/app/data` and set `DB_PATH=/app/data/meal_bot.db`.
6. Railway will automatically keep the bot running 24/7!

