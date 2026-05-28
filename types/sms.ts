// =============================================================================
// sms.ts — SMS Center Types
// =============================================================================
// TypeScript interfaces for the SMS Center CGI endpoint.
//
// Backend endpoint: GET/POST /cgi-bin/quecmanager/cellular/sms.sh
//
// Note: The SmsMessage shape is produced by the native shell + awk pipeline
// in scripts/www/cgi-bin/quecmanager/cellular/sms.sh (which calls
// scripts/usr/lib/qmanager/sms_pdu.awk for PDU decoding). See
// docs/superpowers/plans/2026-05-28-sms-inbox-backend.md for the full
// contract and field semantics.
// =============================================================================

/** A single (possibly merged multi-part) SMS message */
export interface SmsMessage {
  /** Storage indexes for all parts of this message (used for deletion + mark-as-read) */
  indexes: number[];
  /** Sender phone number or alphanumeric ID */
  sender: string;
  /** Message content (concatenated if multi-part) */
  content: string;
  /**
   * ISO 8601 timestamp with timezone offset, e.g. "2026-05-11T10:00:00+08:00".
   * Earliest part's timestamp for merged multi-part messages.
   * Lexicographic sort == chronological sort (assumes consistent SMSC timezone offset).
   */
  timestamp: string;
  /**
   * Read/unread status. "unread" if any part of a merged message is unread.
   * Mutated via POST { "action": "mark_read", "indexes": [...] }.
   */
  status: "read" | "unread";
}

/** Storage status info */
export interface SmsStorage {
  /** Number of messages currently stored */
  used: number;
  /** Maximum storage capacity */
  total: number;
}

/** Response from GET /cgi-bin/quecmanager/cellular/sms.sh */
export interface SmsInboxResponse {
  success: boolean;
  messages: SmsMessage[];
  storage: SmsStorage;
  error?: string;
  detail?: string;
}

/** Generic POST response */
export interface SmsActionResponse {
  success: boolean;
  error?: string;
  detail?: string;
}
