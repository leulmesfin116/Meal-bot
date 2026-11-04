import { MyConversation, MyContext } from "../types";
import {
  getLatestPendingOrder,
  getOrderByCode,
  updateOrderStatus,
  recordPayment,
  getUserByTelegramId,
  Order,
  CartItem,
} from "../../db/index";
import { verifyPaymentSms } from "../../utilis/smsParser";
import { getDashboardKeyboard, getPaymentActionsKeyboard } from "../keyboards";

export async function paymentSmsConversation(
  conversation: MyConversation,
  ctx: MyContext
) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const targetCode = ctx.session.pendingOrderCode;
  let order: Order | null = null;

  if (targetCode) {
    order = getOrderByCode(targetCode);
  }
  if (!order || order.status !== "PENDING_PAYMENT") {
    order = getLatestPendingOrder(telegramId);
  }

  if (!order || order.status !== "PENDING_PAYMENT") {
    await ctx.reply(
      "ℹ️ You do not have any pending orders waiting for payment right now.\nBrowse our menu to create a fresh order!",
      {
        reply_markup: getDashboardKeyboard(ctx.session?.cart?.length || 0),
      }
    );
    return;
  }

  const items: CartItem[] = JSON.parse(order.items_json);
  const itemsSummary = items
    .map((i) => `• ${i.name} (x${i.quantity}) - ${(i.price * i.quantity).toFixed(2)} ETB`)
    .join("\n");

  const cbeAccount = process.env.CBE_ACCOUNT || "1000511676208";
  const telebirrAccount = process.env.TELEBIRR_ACCOUNT || "0900055363";
  const accountHolder = process.env.ACCOUNT_NAME || "Matiyas Mahmud";

  await ctx.reply(
    `💳 **Payment Authentication for Order #${order.order_code}**\n\n` +
      `🧾 **Order Summary:**\n${itemsSummary}\n\n` +
      `💰 **Total Due:** **${order.total_amount.toFixed(2)} ETB**\n\n` +
      `──────────────────────────────\n` +
      `🏦 **Transfer Account Details:**\n` +
      `• **CBE (Commercial Bank):** \`${cbeAccount}\`\n` +
      `• **Telebirr:** \`${telebirrAccount}\`\n` +
      `• **Account Name:** ${accountHolder}\n` +
      `──────────────────────────────\n\n` +
      `📲 **How to authenticate:**\n` +
      `1. Make a transfer of **${order.total_amount.toFixed(2)} ETB** to the account above.\n` +
      `2. Copy the **SMS confirmation** you received from your bank.\n` +
      `3. **Paste or forward the SMS message here**:\n\n` +
      `*(Send /cancel to return without verifying now)*`,
    { parse_mode: "Markdown" }
  );

  // Await SMS message or screenshot photo
  const smsCtx = await conversation.wait();

  // 1. Handle user cancellation
  if (smsCtx.message?.text === "/cancel") {
    await smsCtx.reply(
      `⏸️ Payment authentication paused. Your order **#${order.order_code}** remains saved as **PENDING**.\nYou can authenticate anytime using /orders or by clicking below:`,
      {
        reply_markup: getPaymentActionsKeyboard(order.order_code),
      }
    );
    return;
  }

  let inputSmsText: string | undefined = smsCtx.message?.text?.trim();

  // 2. Handle Receipt Photo / Screenshot
  const adminId = process.env.ADMIN_TELEGRAM_ID;
  if (smsCtx.message?.photo && smsCtx.message.photo.length > 0) {
    const photo = smsCtx.message.photo[smsCtx.message.photo.length - 1];
    const caption = smsCtx.message.caption?.trim() || "";

    // If caption contains SMS text, try verifying caption first
    if (caption.length >= 15) {
      const parsed = verifyPaymentSms(caption, order.total_amount);
      if (parsed.isValid) {
        inputSmsText = caption;
      }
    }

    if (!inputSmsText) {
      if (adminId && !isNaN(Number(adminId))) {
        try {
          const { InlineKeyboard } = await import("grammy");
          const adminApproveKb = new InlineKeyboard()
            .text("✅ Approve Payment", `admin:approve_order:${order.order_code}`)
            .text("❌ Reject Payment", `admin:reject_order:${order.order_code}`);

          await smsCtx.api.sendPhoto(Number(adminId), photo.file_id, {
            caption:
              `📸 **Receipt Screenshot Submitted for Review!**\n\n` +
              `• **Order:** #${order.order_code}\n` +
              `• **Amount Due:** ${order.total_amount.toFixed(2)} ETB\n` +
              `• **Items:**\n${itemsSummary}\n\n` +
              `Click below to approve or reject:`,
            parse_mode: "Markdown",
            reply_markup: adminApproveKb,
          });

          await smsCtx.reply(
            `📸 **Receipt Screenshot Received!**\n\n` +
              `Your payment screenshot for Order **#${order.order_code}** has been forwarded to our admin team for instant review.\n` +
              `You will receive a notification here as soon as it is approved!`,
            {
              parse_mode: "Markdown",
              reply_markup: getDashboardKeyboard(0),
            }
          );
          return;
        } catch (err) {
          console.warn("Could not forward screenshot to admin:", err);
        }
      }

      await smsCtx.reply(
        `📸 We received your screenshot! For instant automatic verification, please copy and paste the text of the Bank SMS here, or wait for admin confirmation.`,
        {
          reply_markup: getPaymentActionsKeyboard(order.order_code),
        }
      );
      return;
    }
  }

  if (!inputSmsText) {
    await smsCtx.reply(
      "⚠️ Please paste the bank SMS message text. You can try again below:",
      { reply_markup: getPaymentActionsKeyboard(order.order_code) }
    );
    return;
  }

  // Show verification in progress
  await smsCtx.reply("🔍 *Authenticating Bank SMS with payment ledger...*", {
    parse_mode: "Markdown",
  });

  // Verify SMS
  const result = verifyPaymentSms(inputSmsText, order.total_amount);

  if (!result.isValid) {
    await smsCtx.reply(
      `❌ **Payment Authentication Failed!**\n\n` +
        `**Reason:** ${result.reason}\n\n` +
        `💡 *Make sure you paste the full, unedited SMS received from CBE, Telebirr, or your mobile banking.*`,
      {
        parse_mode: "Markdown",
        reply_markup: getPaymentActionsKeyboard(order.order_code),
      }
    );
    return;
  }

  // Payment is valid! Record in database
  recordPayment({
    order_id: order.id,
    bank_name: result.bankName || "Bank Transfer",
    tx_id: result.txId!,
    amount: result.amount!,
    raw_sms: inputSmsText,
    verified_status: "VALID",
  });

  updateOrderStatus(order.id, "PAID", result.txId!);

  // Clear user's cart now that order is paid
  smsCtx.session.cart = [];
  smsCtx.session.pendingOrderCode = null;

  const user = getUserByTelegramId(telegramId);

  // Send receipt
  await smsCtx.reply(
    `🎉 **PAYMENT AUTHENTICATED SUCCESSFULLY!** ✅\n\n` +
      `🧾 **Official Payment Receipt:**\n` +
      `──────────────────────────────\n` +
      `📋 **Order:** #${order.order_code}\n` +
      `👤 **Customer:** ${user?.full_name || "Valued Customer"}\n` +
      `📱 **Phone:** \`${user?.phone_number || "N/A"}\`\n` +
      `🏦 **Bank:** ${result.bankName}\n` +
      `🔢 **Transaction ID:** \`${result.txId}\`\n` +
      `💰 **Amount Paid:** ${result.amount?.toFixed(2)} ETB\n` +
      `📅 **Paid At:** ${new Date().toLocaleString()}\n` +
      `📦 **Status:** **PAID & PREPARING 👨‍🍳**\n` +
      `──────────────────────────────\n\n` +
      `🍽️ Our kitchen has received your order and is preparing it now! We'll notify you as soon as it's ready.`,
    {
      parse_mode: "Markdown",
      reply_markup: getDashboardKeyboard(0),
    }
  );

  // Notify admin if configured, with kitchen status progression buttons
  if (adminId && !isNaN(Number(adminId))) {
    try {
      const { InlineKeyboard } = await import("grammy");
      const kitchenKb = new InlineKeyboard()
        .text("👨‍🍳 Preparing", `kitchen:status:${order.order_code}:PREPARING`)
        .text("🛵 Out for Delivery", `kitchen:status:${order.order_code}:DELIVERING`)
        .row()
        .text("✅ Completed", `kitchen:status:${order.order_code}:COMPLETED`);

      await smsCtx.api.sendMessage(
        Number(adminId),
        `🔔 **New Verified Paid Order!**\n\n` +
          `• **Order:** #${order.order_code}\n` +
          `• **Customer:** ${user?.full_name} (\`${user?.phone_number}\`)\n` +
          `• **Total:** ${order.total_amount.toFixed(2)} ETB\n` +
          `• **Bank:** ${result.bankName}\n` +
          `• **Tx ID:** \`${result.txId}\`\n` +
          `• **Items:**\n${itemsSummary}\n\n` +
          `Manage kitchen progress:`,
        { parse_mode: "Markdown", reply_markup: kitchenKb }
      );
    } catch (err) {
      console.warn("Could not send admin notification:", err);
    }
  }
}
