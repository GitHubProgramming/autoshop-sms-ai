/**
 * Canonical plan pricing and limits.
 *
 * This is the SINGLE SOURCE OF TRUTH for plan metadata used across
 * the API (admin MRR, dashboard, webhook limit assignment).
 *
 * Actual billing is still managed by Stripe — these values are for
 * display, reporting, and fallback calculations only.
 */

export interface PlanConfig {
  /** Display name */
  name: string;
  /** Monthly price in whole USD */
  priceDollars: number;
  /** Monthly price in cents (priceDollars * 100) */
  priceCents: number;
  /** Included AI conversations per month */
  convLimit: number;
  /** Feature bullet points shown on billing page */
  features: string[];
}

export const PLANS: Record<string, PlanConfig> = {
  starter: {
    name: "Starter",
    priceDollars: 199,
    priceCents: 19_900,
    convLimit: 150,
    features: [
      "Up to 150 AI conversations/mo",
      "Basic SMS automation",
      "Email support",
      "Calendar integration",
      "Basic analytics",
    ],
  },
  pro: {
    name: "Professional",
    priceDollars: 299,
    priceCents: 29_900,
    convLimit: 400,
    features: [
      "Up to 400 AI conversations/mo",
      "Advanced SMS automation",
      "Priority phone support",
      "Calendar & CRM integration",
      "Advanced analytics",
      "Custom AI responses",
    ],
  },
  premium: {
    name: "Enterprise",
    priceDollars: 499,
    priceCents: 49_900,
    convLimit: 1000,
    features: [
      "Up to 1,000 AI conversations/mo",
      "Enterprise automation",
      "Dedicated account manager",
      "Full API access",
      "White-label options",
      "Custom integrations",
      "Advanced reporting",
    ],
  },
};

/** Serializable plan list for API responses (frontend consumption) */
export function getAvailablePlans() {
  return Object.entries(PLANS).map(([key, p]) => ({
    key,
    name: p.name,
    price_dollars: p.priceDollars,
    price_cents: p.priceCents,
    conv_limit: p.convLimit,
    features: p.features,
  }));
}

/** Default fallback price in whole USD */
export const DEFAULT_PLAN_PRICE_DOLLARS = 199;
/** Default fallback price in cents */
export const DEFAULT_PLAN_PRICE_CENTS = 19_900;
