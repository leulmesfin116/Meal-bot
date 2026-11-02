import { Context, SessionFlavor } from "grammy";
import { Conversation, ConversationFlavor } from "@grammyjs/conversations";
import { CartItem } from "../db/index";

export interface SessionData {
  cart: CartItem[];
  pendingOrderCode?: string | null;
}

export type MyContext = Context &
  SessionFlavor<SessionData> &
  ConversationFlavor<Context & SessionFlavor<SessionData>>;

export type MyConversation = Conversation<MyContext, MyContext>;
