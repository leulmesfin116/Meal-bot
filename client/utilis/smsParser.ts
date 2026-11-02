import { isTxIdUsed } from "../db/index";

export interface ParsedBankSMS {
  bankName: string;
  txId: string | null;
  amount: number | null;
  senderAccount?: string | null;
  receiver?: string | null;
  dateStr?: string | null;
  raw: string;
}

export interface VerificationResult {
  isValid: boolean;
  bankName?: string;
  txId?: string;
  amount?: number;
  expectedAmount?: number;
  reason?: string;
}

/**
 * Identify the bank provider from the message text
 */
export function identifyBank(text: string): string {
  const upper = text.toUpperCase();

  if (upper.includes("TELEBIRR") || upper.includes("CI24") || upper.includes("ETHIO TELECOM")) {
    return "Telebirr";
  }
  if (
    upper.includes("COMMERCIAL BANK OF ETHIOPIA") ||
    upper.includes("CBE") ||
    upper.includes("CBE BIRR") ||
    /\bFT[0-9A-Z]{8,}\b/i.test(upper)
  ) {
    return "Commercial Bank of Ethiopia (CBE)";
  }
  if (upper.includes("ABYSSINIA") || upper.includes("BOA") || upper.includes("BOAPAY")) {
    return "Bank of Abyssinia";
  }
  if (upper.includes("AWASH")) {
    return "Awash Bank";
  }
  if (upper.includes("DASHEN") || upper.includes("AMOLE")) {
    return "Dashen Bank";
  }
  if (upper.includes("HIBRET") || upper.includes("UNITED BANK")) {
    return "Hibret Bank";
  }
  if (upper.includes("COOP") || upper.includes("COOPERATIVE BANK")) {
    return "Cooperative Bank of Oromia";
  }
  if (upper.includes("ZEMEN")) {
    return "Zemen Bank";
  }
  if (upper.includes("WEGAGEN")) {
    return "Wegagen Bank";
  }

  return "Mobile Banking / Bank Transfer";
}

/**
 * Extract Transaction ID / Reference code from SMS text
 */
export function extractTransactionId(text: string): string | null {
  // Check common patterns in priority order:
  // 1. CBE format: FT24... or FT followed by digits/letters
  const cbeMatch = text.match(/\b(FT[0-9A-Za-z]{6,24})\b/i);
  if (cbeMatch) return cbeMatch[1].toUpperCase();

  // 2. Telebirr format: CI... or numerical/dot sequence (e.g. CI241030.1830.B12345 or numbers)
  const telebirrMatch = text.match(
    /(?:transaction\s*(?:number|id|no)?\s*(?:is|:)?\s*)([A-Za-z0-9._-]{8,30})/i
  );
  if (telebirrMatch) {
    const rawId = telebirrMatch[1].trim();
    return rawId.replace(/[.,:;]+$/, "");
  }

  // 3. Labeled Transaction ID / Ref / Txn ID
  const labeledPatterns = [
    /(?:transaction\s*id|txn\s*id|txid|trans\s*id)[:\s]+([A-Za-z0-9_-]{6,30})/i,
    /(?:ref(?:erence)?\s*(?:no|number|id|code)?|trans\s*ref)[:\s]+([A-Za-z0-9_-]{6,30})/i,
    /(?:receipt\s*(?:no|number|#)?|invoice\s*#)[:\s]+([A-Za-z0-9_-]{6,30})/i,
    /\b(TXN[0-9A-Za-z]{6,24})\b/i,
    /\b(CR[0-9A-Za-z]{6,24})\b/i,
  ];

  for (const regex of labeledPatterns) {
    const match = text.match(regex);
    if (match && match[1]) {
      return match[1].trim().replace(/[.,:;]+$/, "");
    }
  }

  // 4. Standalone alphanumeric reference token (e.g. at the end of message "Ref: XYZ123" or code)
  const refKeywordMatch = text.match(/ref[.:\s]+([A-Za-z0-9]{6,25})/i);
  if (refKeywordMatch) return refKeywordMatch[1].trim().replace(/[.,:;]+$/, "");

  return null;
}

/**
 * Extract numerical payment amount from SMS text
 */
export function extractAmount(text: string): number | null {
  // Patterns like:
  // "debited with ETB 350.00"
  // "transferred 350.00 Birr"
  // "ETB 350.00"
  // "350.00 ETB"
  // "amount of 350.00"
  const patterns = [
    /(?:debited\s*(?:with|by)?|transferred|paid|credited\s*(?:with|by)?)\s*(?:ETB|Birr|\$)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i,
    /(?:ETB|Birr|\$)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i,
    /([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\s*(?:ETB|Birr|USD)/i,
    /(?:amount|total)[:\s]*(?:ETB|Birr|\$)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i,
  ];

  for (const regex of patterns) {
    const match = text.match(regex);
    if (match && match[1]) {
      const cleanNum = match[1].replace(/,/g, "");
      const val = parseFloat(cleanNum);
      if (!isNaN(val) && val > 0) {
        return val;
      }
    }
  }

  return null;
}

/**
 * Comprehensive parser for Bank SMS
 */
export function parseBankSMS(text: string): ParsedBankSMS {
  const bankName = identifyBank(text);
  const txId = extractTransactionId(text);
  const amount = extractAmount(text);

  return {
    bankName,
    txId,
    amount,
    raw: text.trim(),
  };
}

/**
 * Validates a Bank SMS against an order and performs security checks
 */
export function verifyPaymentSms(
  smsText: string,
  expectedAmount: number
): VerificationResult {
  if (!smsText || smsText.trim().length < 15) {
    return {
      isValid: false,
      reason: "The message is too short to be a valid bank confirmation SMS. Please send the complete SMS received from your bank.",
    };
  }

  const parsed = parseBankSMS(smsText);

  // 1. Transaction ID verification
  if (!parsed.txId) {
    return {
      isValid: false,
      bankName: parsed.bankName,
      reason: "Could not find a valid Transaction Reference ID (e.g. FT..., CI..., or Ref No) in the SMS. Please ensure you copied the full message text from your bank.",
    };
  }

  // 2. Anti-fraud: Check if this transaction ID was already registered
  if (isTxIdUsed(parsed.txId)) {
    return {
      isValid: false,
      txId: parsed.txId,
      bankName: parsed.bankName,
      reason: `⚠️ Duplicate Transaction ID Detected!\nTransaction reference \`${parsed.txId}\` has already been submitted and verified for another order. Reusing previous receipts is not permitted.`,
    };
  }

  // 3. Amount verification
  if (parsed.amount === null) {
    return {
      isValid: false,
      txId: parsed.txId,
      bankName: parsed.bankName,
      reason: "Could not determine the payment amount from the SMS. Please make sure the SMS mentions the transferred ETB/Birr amount.",
    };
  }

  if (parsed.amount < expectedAmount) {
    return {
      isValid: false,
      txId: parsed.txId,
      amount: parsed.amount,
      expectedAmount,
      bankName: parsed.bankName,
      reason: `❌ Insufficient Payment: The SMS confirms a transfer of **${parsed.amount.toFixed(
        2
      )} ETB**, but your order total is **${expectedAmount.toFixed(
        2
      )} ETB**.\nPlease transfer the remaining balance or verify the transaction.`,
    };
  }

  // All checks passed!
  return {
    isValid: true,
    txId: parsed.txId,
    amount: parsed.amount,
    expectedAmount,
    bankName: parsed.bankName,
  };
}
