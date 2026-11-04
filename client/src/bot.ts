import { Bot, session, InlineKeyboard } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { MyContext, SessionData } from "./types";
import { registrationConversation } from "./conversations/register";
import { paymentSmsConversation } from "./conversations/payment";
import {
  getUserByTelegramId,
  getAllMenuItems,
  getMenuItemById,
  createOrder,
  getUserOrders,
  getOrderByCode,
  updateOrderStatus,
  getAdminStats,
  recordPayment,
} from "../db/index";
import {
  getDashboardKeyboard,
  getMenuKeyboard,
  getItemDetailKeyboard,
  getCartKeyboard,
  getPaymentActionsKeyboard,
  persistentMainMenuKeyboard,
} from "./keyboards";

export function createBot(token: string): Bot<MyContext> {
  const bot = new Bot<MyContext>(token);

  // 1. Session middleware
  bot.use(
    session({
      initial: (): SessionData => ({
        cart: [],
        pendingOrderCode: null,
      }),
    })
  );

  // 2. Conversation plugins
  bot.use(conversations());
  bot.use(createConversation(registrationConversation));
  bot.use(createConversation(paymentSmsConversation));

  // Middleware: check registration for commands (except start & help)
  async function ensureRegistered(ctx: MyContext): Promise<boolean> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return false;

    const user = getUserByTelegramId(telegramId);
    if (!user) {
      await ctx.conversation.enter("registrationConversation");
      return false;
    }
    return true;
  }

  // --- COMMAND HANDLERS ---

  // /admin
  bot.command("admin", async (ctx) => {
    const telegramId = ctx.from?.id;
    const adminId = process.env.ADMIN_TELEGRAM_ID;

    if (!adminId || telegramId?.toString() !== adminId.trim()) {
      await ctx.reply("⛔ Access restricted: You are not authorized as an administrator.");
      return;
    }

    const stats = getAdminStats();
    await ctx.reply(
      `📊 **Restaurant Admin Dashboard**\n\n` +
        `• 👥 **Total Registered Users:** ${stats.totalUsers}\n` +
        `• 📦 **Total Orders:** ${stats.totalOrders}\n` +
        `• ✅ **Completed/Paid Orders:** ${stats.totalPaidOrders}\n` +
        `• 💰 **Total Revenue:** **${stats.totalRevenue.toFixed(2)} ETB**\n` +
        `• ⏳ **Pending Payment Orders:** ${stats.pendingCount}\n\n` +
        `*Live kitchen alerts & receipt approval requests will appear here in real time.*`,
      { parse_mode: "Markdown" }
    );
  });

  // /start
  bot.command("start", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = getUserByTelegramId(telegramId);
    if (!user) {
      await ctx.conversation.enter("registrationConversation");
      return;
    }

    await ctx.reply(
      `🍽️ **Welcome to Mati Meals!**\n\n` +
        `We're delighted to have you, ${user.full_name}! 😊\n` +
        `Tap the button below to browse our menu and place your order.`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().text("Order", "action:show_menu"),
      }
    );
  });

  // /menu
  bot.command("menu", async (ctx) => {
    if (!(await ensureRegistered(ctx))) return;
    const items = getAllMenuItems();
    await ctx.reply("🍽️ **Today's Fresh Menu**\nTap any meal to select quantity and add to cart:", {
      parse_mode: "Markdown",
      reply_markup: getMenuKeyboard(items, ctx.session.cart),
    });
  });

  // /cart
  bot.command("cart", async (ctx) => {
    if (!(await ensureRegistered(ctx))) return;
    await showCartMessage(ctx);
  });

  // /orders
  bot.command("orders", async (ctx) => {
    if (!(await ensureRegistered(ctx))) return;
    await showOrdersMessage(ctx);
  });

  // /profile
  bot.command("profile", async (ctx) => {
    if (!(await ensureRegistered(ctx))) return;
    await showProfileMessage(ctx);
  });

  // /help
  bot.command("help", async (ctx) => {
    await ctx.reply(
      `📖 **Meal Bot Guide & Help**\n\n` +
        `1️⃣ **Registration:** We only ask for your name and phone number once so we can contact you for delivery.\n\n` +
        `2️⃣ **Ordering:** Browse /menu, select your favorite meals, and view your /cart.\n\n` +
        `3️⃣ **Bank Transfer & SMS Authentication:**\n` +
        `• Once you checkout, we provide our CBE and Telebirr account numbers.\n` +
        `• Transfer the exact total from your mobile banking app.\n` +
        `• When you receive the SMS from your bank, copy and paste it into this bot.\n` +
        `• Our bot instantly verifies the **Transaction Reference ID** and **Amount** against our records.\n` +
        `• As soon as authenticated, your order moves to kitchen preparation! 👨‍🍳\n\n` +
        `Commands:\n` +
        `/menu - Browse meals\n` +
        `/cart - View current cart\n` +
        `/orders - View order history & pay pending orders\n` +
        `/profile - View your saved details\n` +
        `/cancel - Cancel current conversation`,
      { parse_mode: "Markdown" }
    );
  });

  // Reply Keyboard text shortcuts
  bot.hears("🍽️ Menu", async (ctx) => {
    if (!(await ensureRegistered(ctx))) return;
    const items = getAllMenuItems();
    await ctx.reply("🍽️ **Today's Fresh Menu**:", {
      parse_mode: "Markdown",
      reply_markup: getMenuKeyboard(items, ctx.session.cart),
    });
  });

  bot.hears("🛒 Cart", async (ctx) => {
    if (!(await ensureRegistered(ctx))) return;
    await showCartMessage(ctx);
  });

  bot.hears("📜 My Orders", async (ctx) => {
    if (!(await ensureRegistered(ctx))) return;
    await showOrdersMessage(ctx);
  });

  bot.hears("👤 Profile", async (ctx) => {
    if (!(await ensureRegistered(ctx))) return;
    await showProfileMessage(ctx);
  });

  // --- CALLBACK QUERY HANDLERS ---

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    // Dashboard
    if (data === "action:dashboard") {
      await ctx.answerCallbackQuery();
      const cartCount = ctx.session.cart.reduce((a, b) => a + b.quantity, 0);
      await ctx.editMessageText("🏠 **Main Dashboard**\nChoose an action below:", {
        parse_mode: "Markdown",
        reply_markup: getDashboardKeyboard(cartCount),
      });
      return;
    }

    // Show Menu
    if (data === "action:show_menu") {
      await ctx.answerCallbackQuery();
      const items = getAllMenuItems();
      await ctx.editMessageText("🍽️ **Select an item to customize quantity:**", {
        reply_markup: getMenuKeyboard(items, ctx.session.cart),
      });
      return;
    }

    // Select specific item
    if (data.startsWith("action:select_item:")) {
      const itemId = parseInt(data.replace("action:select_item:", ""), 10);
      const item = getMenuItemById(itemId);
      if (!item) {
        await ctx.answerCallbackQuery({ text: "Item not found!" });
        return;
      }

      await ctx.answerCallbackQuery();
      const inCart = ctx.session.cart.find((c) => c.id === itemId);
      const currentQty = inCart ? inCart.quantity : 0;

      await ctx.editMessageText(
        `🍱 **${item.emoji} ${item.name}**\n\n` +
          `📂 *Category:* ${item.category}\n` +
          `📝 *Description:* ${item.description}\n` +
          `💰 *Price:* **${item.price.toFixed(2)} ETB**\n\n` +
          `🛒 *Currently in your cart:* **${currentQty}**\n\n` +
          `Use the buttons below to add or remove:`,
        {
          parse_mode: "Markdown",
          reply_markup: getItemDetailKeyboard(item, currentQty),
        }
      );
      return;
    }

    // Cart Increment
    if (data.startsWith("action:cart_inc:")) {
      const itemId = parseInt(data.replace("action:cart_inc:", ""), 10);
      const item = getMenuItemById(itemId);
      if (!item) {
        await ctx.answerCallbackQuery({ text: "Item not found!" });
        return;
      }

      const existing = ctx.session.cart.find((c) => c.id === itemId);
      if (existing) {
        existing.quantity += 1;
      } else {
        ctx.session.cart.push({
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: 1,
          emoji: item.emoji,
        });
      }

      await ctx.answerCallbackQuery({ text: `Added 1x ${item.name}!` });
      const currentQty = ctx.session.cart.find((c) => c.id === itemId)?.quantity || 0;
      await ctx.editMessageReplyMarkup({
        reply_markup: getItemDetailKeyboard(item, currentQty),
      });
      return;
    }

    // Cart Decrement
    if (data.startsWith("action:cart_dec:")) {
      const itemId = parseInt(data.replace("action:cart_dec:", ""), 10);
      const item = getMenuItemById(itemId);
      if (!item) {
        await ctx.answerCallbackQuery({ text: "Item not found!" });
        return;
      }

      const existingIndex = ctx.session.cart.findIndex((c) => c.id === itemId);
      if (existingIndex !== -1) {
        if (ctx.session.cart[existingIndex].quantity > 1) {
          ctx.session.cart[existingIndex].quantity -= 1;
        } else {
          ctx.session.cart.splice(existingIndex, 1);
        }
        await ctx.answerCallbackQuery({ text: `Removed 1x ${item.name}` });
      } else {
        await ctx.answerCallbackQuery({ text: "None in cart!" });
      }

      const currentQty = ctx.session.cart.find((c) => c.id === itemId)?.quantity || 0;
      await ctx.editMessageReplyMarkup({
        reply_markup: getItemDetailKeyboard(item, currentQty),
      });
      return;
    }

    // Cart Delete item
    if (data.startsWith("action:cart_del:")) {
      const itemId = parseInt(data.replace("action:cart_del:", ""), 10);
      ctx.session.cart = ctx.session.cart.filter((c) => c.id !== itemId);
      await ctx.answerCallbackQuery({ text: "Item removed from cart" });
      await showCartMessage(ctx, true);
      return;
    }

    // Clear cart
    if (data === "action:clear_cart") {
      ctx.session.cart = [];
      await ctx.answerCallbackQuery({ text: "Cart cleared" });
      await showCartMessage(ctx, true);
      return;
    }

    // View Cart
    if (data === "action:view_cart") {
      await ctx.answerCallbackQuery();
      await showCartMessage(ctx, true);
      return;
    }

    // Checkout Order
    if (data === "action:checkout_order") {
      if (!ctx.session.cart || ctx.session.cart.length === 0) {
        await ctx.answerCallbackQuery({ text: "Your cart is empty!" });
        return;
      }

      const telegramId = ctx.from?.id;
      if (!telegramId) return;

      const user = getUserByTelegramId(telegramId);
      if (!user) {
        await ctx.answerCallbackQuery();
        await ctx.conversation.enter("registrationConversation");
        return;
      }

      const totalAmount = ctx.session.cart.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      // Create pending order
      const order = createOrder({
        user_id: user.id,
        telegram_id: telegramId,
        items: [...ctx.session.cart],
        total_amount: totalAmount,
      });

      ctx.session.pendingOrderCode = order.order_code;
      await ctx.answerCallbackQuery({ text: "Order created!" });

      // Start the payment SMS authentication conversation
      await ctx.conversation.enter("paymentSmsConversation");
      return;
    }

    // Submit SMS for a specific order
    if (data.startsWith("action:submit_sms:")) {
      const orderCode = data.replace("action:submit_sms:", "");
      ctx.session.pendingOrderCode = orderCode;
      await ctx.answerCallbackQuery();
      await ctx.conversation.enter("paymentSmsConversation");
      return;
    }

    // Check payment status
    if (data.startsWith("action:check_status:")) {
      const orderCode = data.replace("action:check_status:", "");
      const order = getOrderByCode(orderCode);
      await ctx.answerCallbackQuery();

      if (!order) {
        await ctx.reply("❌ Order not found.");
        return;
      }

      if (order.status === "PAID") {
        await ctx.reply(
          `✅ **Order #${order.order_code} is PAID!**\nTransaction Reference: \`${order.bank_tx_id}\`\nStatus: Being prepared in kitchen 👨‍🍳`,
          { parse_mode: "Markdown" }
        );
      } else {
        await ctx.reply(
          `⏳ **Order #${order.order_code} is still PENDING PAYMENT.**\nAmount: ${order.total_amount} ETB\nPlease transfer and submit the bank SMS to verify.`,
          {
            parse_mode: "Markdown",
            reply_markup: getPaymentActionsKeyboard(order.order_code),
          }
        );
      }
      return;
    }

    // Cancel pending order
    if (data.startsWith("action:cancel_order:")) {
      const orderCode = data.replace("action:cancel_order:", "");
      const order = getOrderByCode(orderCode);
      if (order && order.status === "PENDING_PAYMENT") {
        updateOrderStatus(order.id, "CANCELLED");
        await ctx.answerCallbackQuery({ text: "Order cancelled." });
        await ctx.editMessageText(`🚫 Order **#${order.order_code}** has been cancelled.`, {
          parse_mode: "Markdown",
          reply_markup: getDashboardKeyboard(ctx.session.cart.length),
        });
      } else {
        await ctx.answerCallbackQuery({ text: "Cannot cancel this order." });
      }
      return;
    }

    // View orders
    if (data === "action:view_orders") {
      await ctx.answerCallbackQuery();
      await showOrdersMessage(ctx, true);
      return;
    }

    // View profile
    if (data === "action:view_profile") {
      await ctx.answerCallbackQuery();
      await showProfileMessage(ctx, true);
      return;
    }

    // Edit profile
    if (data === "action:edit_profile") {
      await ctx.answerCallbackQuery();
      await ctx.conversation.enter("registrationConversation");
      return;
    }

    // Bank account information
    if (data === "action:bank_info") {
      await ctx.answerCallbackQuery();
      const cbeAccount = process.env.CBE_ACCOUNT || "1000511676208";
      const telebirrAccount = process.env.TELEBIRR_ACCOUNT || "0900055363";
      const accountHolder = process.env.ACCOUNT_NAME || "Matiyas Mahmud";

      await ctx.editMessageText(
        `🏦 **Official Bank & Mobile Transfer Accounts**\n\n` +
          `• **Commercial Bank of Ethiopia (CBE):**\n  Account: \`${cbeAccount}\`\n\n` +
          `• **Telebirr:**\n  Number: \`${telebirrAccount}\`\n\n` +
          `• **Account Name:** ${accountHolder}\n\n` +
          `*Note: Always copy and paste the bank SMS message after transferring to instantly authenticate your payment!*`,
        {
          parse_mode: "Markdown",
          reply_markup: getDashboardKeyboard(ctx.session.cart.length),
        }
      );
      return;
    }

    // Admin: Approve Receipt
    if (data.startsWith("admin:approve_order:")) {
      const orderCode = data.replace("admin:approve_order:", "");
      const order = getOrderByCode(orderCode);

      if (!order) {
        await ctx.answerCallbackQuery({ text: "Order not found!" });
        return;
      }

      if (order.status === "PAID") {
        await ctx.answerCallbackQuery({ text: "Already approved!" });
        return;
      }

      const manualTxId = `ADMIN_VERIFIED_${Date.now()}`;
      recordPayment({
        order_id: order.id,
        bank_name: "Manual Review (Admin Approved)",
        tx_id: manualTxId,
        amount: order.total_amount,
        raw_sms: "Approved via Admin Telegram Screenshot Review",
        verified_status: "ADMIN_APPROVED",
      });

      updateOrderStatus(order.id, "PAID", manualTxId);
      await ctx.answerCallbackQuery({ text: "Order Approved!" });

      try {
        await ctx.editMessageCaption({
          caption:
            `✅ **Order #${order.order_code} APPROVED by Admin!**\n\n` +
            `• **Amount:** ${order.total_amount.toFixed(2)} ETB\n` +
            `• **Reference:** \`${manualTxId}\`\n` +
            `• **Status:** PAID & Moved to Kitchen 👨‍🍳`,
          parse_mode: "Markdown",
        });
      } catch {
        // Caption edit fallback
      }

      // Notify customer directly
      try {
        await ctx.api.sendMessage(
          order.telegram_id,
          `🎉 **Payment Approved!** ✅\n\n` +
            `Your payment for Order **#${order.order_code}** (${order.total_amount.toFixed(
              2
            )} ETB) has been verified and approved by the restaurant!\n\n` +
            `👨‍🍳 Our kitchen has started preparing your fresh meal. We will notify you when it's on the way!`,
          { parse_mode: "Markdown" }
        );
      } catch (err) {
        console.warn("Could not notify customer of payment approval:", err);
      }
      return;
    }

    // Admin: Reject Receipt
    if (data.startsWith("admin:reject_order:")) {
      const orderCode = data.replace("admin:reject_order:", "");
      const order = getOrderByCode(orderCode);

      if (!order) {
        await ctx.answerCallbackQuery({ text: "Order not found!" });
        return;
      }

      await ctx.answerCallbackQuery({ text: "Order Payment Rejected" });

      try {
        await ctx.editMessageCaption({
          caption: `❌ **Order #${order.order_code} Payment REJECTED.**\nCustomer has been notified to re-submit proof.`,
          parse_mode: "Markdown",
        });
      } catch {
        // Caption edit fallback
      }

      // Notify customer
      try {
        await ctx.api.sendMessage(
          order.telegram_id,
          `⚠️ **Payment Verification Update for Order #${order.order_code}**\n\n` +
            `The restaurant could not verify your receipt screenshot.\n` +
            `Please make sure you transferred **${order.total_amount.toFixed(
              2
            )} ETB** and paste the text of the **Bank SMS** message using /orders to re-verify.`,
          {
            parse_mode: "Markdown",
            reply_markup: getPaymentActionsKeyboard(order.order_code),
          }
        );
      } catch (err) {
        console.warn("Could not notify customer of rejection:", err);
      }
      return;
    }

    // Kitchen Status Updates
    if (data.startsWith("kitchen:status:")) {
      const parts = data.split(":");
      const orderCode = parts[2];
      const newStatus = parts[3];
      const order = getOrderByCode(orderCode);

      if (!order) {
        await ctx.answerCallbackQuery({ text: "Order not found!" });
        return;
      }

      let statusLabel = newStatus;
      let customerMsg = "";

      if (newStatus === "PREPARING") {
        updateOrderStatus(order.id, "PREPARING");
        statusLabel = "👨‍🍳 PREPARING";
        customerMsg = `👨‍🍳 **Kitchen Update:** Your meal for Order **#${order.order_code}** is now on the stove and being freshly prepared!`;
      } else if (newStatus === "DELIVERING") {
        updateOrderStatus(order.id, "PREPARING"); // or delivery
        statusLabel = "🛵 OUT FOR DELIVERY";
        customerMsg = `🛵 **Delivery Update:** Driver is on the way with your delicious order **#${order.order_code}**! Keep your phone ready.`;
      } else if (newStatus === "COMPLETED") {
        updateOrderStatus(order.id, "COMPLETED");
        statusLabel = "✅ DELIVERED & COMPLETED";
        customerMsg = `🎉 **Delivered!** Order **#${order.order_code}** has arrived. Thank you for dining with Meal Bot! Enjoy your meal! 🍽️`;
      }

      await ctx.answerCallbackQuery({ text: `Status updated to ${statusLabel}` });

      // Notify customer
      try {
        await ctx.api.sendMessage(order.telegram_id, customerMsg, {
          parse_mode: "Markdown",
        });
      } catch (err) {
        console.warn("Could not notify customer of kitchen update:", err);
      }
      return;
    }

    await ctx.answerCallbackQuery();
  });

  // --- HELPER RENDERING FUNCTIONS ---

  async function showCartMessage(ctx: MyContext, isEdit = false) {
    const cart = ctx.session.cart || [];
    let text = "🛒 **Your Order Cart**\n\n";

    if (cart.length === 0) {
      text += "Your cart is currently empty! 🍽️\nBrowse our menu and pick delicious meals.";
    } else {
      let subtotal = 0;
      for (const item of cart) {
        const itemTotal = item.price * item.quantity;
        subtotal += itemTotal;
        text += `• **${item.name}**\n  Qty: ${item.quantity} × ${item.price} = **${itemTotal.toFixed(2)} ETB**\n`;
      }
      text += `\n──────────────────────────────\n`;
      text += `💰 **Total Amount:** **${subtotal.toFixed(2)} ETB**\n\n`;
      text += `Ready to eat? Click **Confirm Order & Pay** to receive transfer details and authenticate via Bank SMS.`;
    }

    if (isEdit) {
      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: getCartKeyboard(cart),
      });
    } else {
      await ctx.reply(text, {
        parse_mode: "Markdown",
        reply_markup: getCartKeyboard(cart),
      });
    }
  }

  async function showOrdersMessage(ctx: MyContext, isEdit = false) {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const orders = getUserOrders(telegramId);
    let text = "📜 **Your Recent Orders**\n\n";

    if (orders.length === 0) {
      text += "You haven't placed any orders yet. Start with /menu!";
    } else {
      for (const o of orders) {
        const statusEmoji =
          o.status === "PAID"
            ? "✅ PAID"
            : o.status === "PENDING_PAYMENT"
            ? "⏳ PENDING PAYMENT"
            : o.status === "CANCELLED"
            ? "🚫 CANCELLED"
            : o.status;

        text += `📋 **#${o.order_code}** — ${o.total_amount.toFixed(2)} ETB\n`;
        text += `Status: **${statusEmoji}**\n`;
        if (o.bank_tx_id) {
          text += `Tx ID: \`${o.bank_tx_id}\`\n`;
        }
        text += `Date: ${new Date(o.created_at).toLocaleDateString()}\n`;
        text += `────────────────────\n`;
      }
    }

    const pending = orders.find((o) => o.status === "PENDING_PAYMENT");
    const keyboard = pending
      ? getPaymentActionsKeyboard(pending.order_code)
      : getDashboardKeyboard(ctx.session.cart.length);

    if (isEdit) {
      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    } else {
      await ctx.reply(text, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    }
  }

  async function showProfileMessage(ctx: MyContext, isEdit = false) {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = getUserByTelegramId(telegramId);
    if (!user) return;

    const text =
      `👤 **Customer Profile**\n\n` +
      `• **Name:** ${user.full_name}\n` +
      `• **Phone:** \`${user.phone_number}\`\n` +
      `• **Telegram Username:** ${user.username ? `@${user.username}` : "None"}\n` +
      `• **Member Since:** ${new Date(user.created_at).toLocaleDateString()}\n\n` +
      `Your contact details are used for order confirmation and delivery dispatch.`;

    const keyboard = getDashboardKeyboard(ctx.session.cart.length);

    if (isEdit) {
      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    } else {
      await ctx.reply(text, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    }
  }

  return bot;
}
