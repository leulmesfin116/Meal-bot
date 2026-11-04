import { InlineKeyboard, Keyboard } from "grammy";
import { MenuItem, CartItem } from "../db/index";

/**
 * Phone number request reply keyboard
 */
export const contactReplyKeyboard = new Keyboard()
  .requestContact("📱 Share Phone Number")
  .row()
  .text("❌ Cancel Registration")
  .resized()
  .oneTime();

/**
 * Main persistent action buttons
 */
export const persistentMainMenuKeyboard = new Keyboard()
  .text("🍽️ Menu")
  .text("🛒 Cart")
  .row()
  .text("📜 My Orders")
  .text("👤 Profile")
  .resized();

/**
 * Main dashboard inline keyboard
 */
export function getDashboardKeyboard(cartCount: number = 0) {
  const cartLabel = cartCount > 0 ? `🛒 Cart (${cartCount})` : "🛒 View Cart";
  return new InlineKeyboard()
    .text("🍽️ View Full Menu", "action:show_menu")
    .text(cartLabel, "action:view_cart")
    .row()
    .text("📜 My Orders", "action:view_orders")
    .text("👤 My Profile", "action:view_profile")
    .row()
    .text("ℹ️ Payment Guide & Bank Info", "action:bank_info");
}

/**
 * Menu list with categories & add-to-cart buttons
 */
export function getMenuKeyboard(items: MenuItem[], cart: CartItem[]) {
  const keyboard = new InlineKeyboard();

  for (const item of items) {
    const inCart = cart.find((c) => c.id === item.id);
    const countBadge = inCart ? ` (${inCart.quantity} in cart)` : "";
    keyboard
      .text(`${item.emoji} ${item.name} - ${item.price} ETB${countBadge}`, `action:select_item:${item.id}`)
      .row();
  }

  const totalItems = cart.reduce((acc, cur) => acc + cur.quantity, 0);
  keyboard
    .text(totalItems > 0 ? `🛍️ Proceed to Checkout (${totalItems})` : "🛒 View Cart", "action:view_cart")
    .row()
    .text("🔙 Back to Main Dashboard", "action:dashboard");

  return keyboard;
}

/**
 * Item detail keyboard (Add to Cart, Increment, etc.)
 */
export function getItemDetailKeyboard(item: MenuItem, currentQuantity: number) {
  const keyboard = new InlineKeyboard();

  keyboard
    .text("➖", `action:cart_dec:${item.id}`)
    .text(`Qty: ${currentQuantity}`, `action:item_info:${item.id}`)
    .text("➕", `action:cart_inc:${item.id}`)
    .row();

  if (currentQuantity > 0) {
    keyboard
      .text("💳 Proceed to Payment", "action:checkout_order")
      .row();
  }

  keyboard
    .text("🍽️ Back to Menu", "action:show_menu")
    .text("🛒 View Cart", "action:view_cart");

  return keyboard;
}

/**
 * Cart view keyboard
 */
export function getCartKeyboard(cart: CartItem[]) {
  const keyboard = new InlineKeyboard();

  for (const item of cart) {
    keyboard
      .text(`❌`, `action:cart_del:${item.id}`)
      .text(`${item.name} (x${item.quantity})`, `action:item_info:${item.id}`)
      .text(`+1`, `action:cart_inc:${item.id}`)
      .row();
  }

  if (cart.length > 0) {
    keyboard
      .text("💳 Confirm Order & Pay", "action:checkout_order")
      .row()
      .text("➕ Add More Meals", "action:show_menu")
      .text("🗑️ Clear Cart", "action:clear_cart")
      .row();
  } else {
    keyboard.text("🍽️ Browse Menu", "action:show_menu").row();
  }

  keyboard.text("🔙 Back to Main Dashboard", "action:dashboard");
  return keyboard;
}

/**
 * Payment instructions keyboard
 */
export function getPaymentActionsKeyboard(orderCode: string) {
  return new InlineKeyboard()
    .text("🏦 View CBE Details", `action:pay_info_cbe:${orderCode}`)
    .text("📱 View Telebirr Details", `action:pay_info_telebirr:${orderCode}`)
    .row()
    .text("📩 Paste / Forward Bank SMS", `action:submit_sms:${orderCode}`)
    .row()
    .text("🔄 Check Payment Status", `action:check_status:${orderCode}`)
    .text("❌ Cancel Order", `action:cancel_order:${orderCode}`)
    .row()
    .text("🔙 Back to Dashboard", "action:dashboard");
}
