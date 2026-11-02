import { MyConversation, MyContext } from "../types";
import { saveUser, getUserByTelegramId } from "../../db/index";
import { contactReplyKeyboard, persistentMainMenuKeyboard, getDashboardKeyboard } from "../keyboards";

export async function registrationConversation(
  conversation: MyConversation,
  ctx: MyContext
) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const existingUser = getUserByTelegramId(telegramId);
  const promptIntro = existingUser
    ? "✏️ **Update Your Profile**\nLet's update your account details."
    : "👋 **Welcome to Meal Bot!**\nBefore placing your first order, let's complete a quick 1-minute registration.";

  await ctx.reply(
    `${promptIntro}\n\n👉 **Step 1 of 2:** Please enter your **Full Name / Username**:\n*(Or send /cancel to exit)*`,
    { reply_markup: { remove_keyboard: true } }
  );

  // 1. Wait for Full Name
  const nameCtx = await conversation.wait();
  if (nameCtx.message?.text === "/cancel" || nameCtx.message?.text === "❌ Cancel Registration") {
    await nameCtx.reply("❌ Registration cancelled.", {
      reply_markup: persistentMainMenuKeyboard,
    });
    return;
  }

  const fullName = nameCtx.message?.text?.trim();
  if (!fullName || fullName.length < 2) {
    await nameCtx.reply("⚠️ Please provide a valid name (at least 2 characters). Let's restart registration.", {
      reply_markup: persistentMainMenuKeyboard,
    });
    return;
  }

  // 2. Wait for Phone Number
  await nameCtx.reply(
    `Great to meet you, **${fullName}**! 🎉\n\n👉 **Step 2 of 2:** Please share your **Phone Number** so we can coordinate your meal delivery and verify bank payments:\n\n*Tap the button below or type your phone number (e.g. 0911223344 or +251911223344)*:`,
    { reply_markup: contactReplyKeyboard }
  );

  const phoneCtx = await conversation.wait();
  if (phoneCtx.message?.text === "/cancel" || phoneCtx.message?.text === "❌ Cancel Registration") {
    await phoneCtx.reply("❌ Registration cancelled.", {
      reply_markup: persistentMainMenuKeyboard,
    });
    return;
  }

  let phoneNumber: string | undefined;

  if (phoneCtx.message?.contact?.phone_number) {
    phoneNumber = phoneCtx.message.contact.phone_number;
  } else if (phoneCtx.message?.text) {
    const rawText = phoneCtx.message.text.trim();
    // Validate phone number format (at least 9 digits)
    const digitsOnly = rawText.replace(/\D/g, "");
    if (digitsOnly.length >= 9 && digitsOnly.length <= 15) {
      phoneNumber = rawText;
    }
  }

  if (!phoneNumber) {
    await phoneCtx.reply(
      "⚠️ That doesn't look like a valid phone number. You can update your phone anytime with `/profile`.",
      { reply_markup: persistentMainMenuKeyboard }
    );
    return;
  }

  // Save to database
  const savedUser = saveUser({
    telegram_id: telegramId,
    username: ctx.from?.username || null,
    full_name: fullName,
    phone_number: phoneNumber,
  });

  await phoneCtx.reply(
    `✅ **Registration Complete!**\n\n👤 **Name:** ${savedUser.full_name}\n📱 **Phone:** \`${savedUser.phone_number}\`\n\nYou're all set! Check out today's delicious menu and place your order below:`,
    {
      parse_mode: "Markdown",
      reply_markup: persistentMainMenuKeyboard,
    }
  );

  await phoneCtx.reply("🍽️ What would you like to eat today?", {
    reply_markup: getDashboardKeyboard(phoneCtx.session?.cart?.length || 0),
  });
}
