/**
 * Backend i18n helper for tenant-locale-aware string localization.
 *
 * Usage:
 *   import { t } from "../utils/i18n";
 *   t("appointment.action_needed", "lt-LT") → "Reikalingas veiksmas"
 *   t("appointment.action_needed", "en-US") → "Action Needed"
 *   t("appointment.action_needed")           → "Action Needed" (default)
 *
 * Fallback chain: locale → en-US → raw key
 */

export type Locale = "en-US" | "lt-LT";

const STRINGS: Record<string, Record<Locale, string>> = {
  // Appointment statuses
  "appointment.pending_manual_confirmation": {
    "en-US": "Needs Manual Confirmation",
    "lt-LT": "Reikalingas rankinis patvirtinimas",
  },
  "appointment.action_needed": {
    "en-US": "Action Needed",
    "lt-LT": "Reikalingas veiksmas",
  },
  "appointment.confirmed": {
    "en-US": "Appointment confirmed",
    "lt-LT": "Vizitas patvirtintas",
  },
  "appointment.cancelled": {
    "en-US": "Appointment cancelled",
    "lt-LT": "Vizitas atšauktas",
  },
  "appointment.calendar_sync_failed": {
    "en-US": "Calendar sync failed — confirm this booking manually.",
    "lt-LT": "Kalendoriaus sinchronizacija nepavyko — patvirtinkite vizitą rankiniu būdu.",
  },

  // Booking statuses
  "status.booked": { "en-US": "Booked", "lt-LT": "Rezervuota" },
  "status.resolved": { "en-US": "Resolved", "lt-LT": "Išspręsta" },
  "status.active": { "en-US": "Active", "lt-LT": "Aktyvus" },
  "status.no_reply": { "en-US": "No Reply", "lt-LT": "Be atsakymo" },
  "status.lost": { "en-US": "Lost", "lt-LT": "Prarastas" },
  "status.pending": { "en-US": "Pending", "lt-LT": "Laukiama" },
  "status.completed": { "en-US": "Completed", "lt-LT": "Užbaigtas" },
  "status.cancelled": { "en-US": "Cancelled", "lt-LT": "Atšauktas" },

  // Actions
  "action.confirm": { "en-US": "Confirm", "lt-LT": "Patvirtinti" },
  "action.cancel": { "en-US": "Cancel", "lt-LT": "Atšaukti" },
  "action.reschedule": { "en-US": "Reschedule", "lt-LT": "Perkelti" },

  // Notifications
  "notification.sms_sent": { "en-US": "SMS sent", "lt-LT": "SMS išsiųsta" },
  "notification.booking_detected": {
    "en-US": "Booking detected",
    "lt-LT": "Aptiktas vizitas",
  },
};

/**
 * Translate a key to the given locale.
 * Falls back to en-US, then to the raw key if not found.
 */
export function t(key: string, locale: Locale = "en-US"): string {
  return STRINGS[key]?.[locale] ?? STRINGS[key]?.["en-US"] ?? key;
}

/**
 * Check if a locale string is a valid supported locale.
 */
export function isValidLocale(locale: string): locale is Locale {
  return locale === "en-US" || locale === "lt-LT";
}
