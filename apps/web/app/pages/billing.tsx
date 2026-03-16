import {
  CreditCard,
  Calendar,
  CheckCircle2,
  TrendingUp,
  Download,
  MessageSquare,
} from "lucide-react";

const usageData = {
  plan: "Professional",
  price: 299,
  conversations: {
    used: 847,
    included: 1000,
    percentage: 84.7,
  },
  billingDate: "April 1, 2026",
  status: "Active",
};

const invoiceHistory = [
  {
    id: "INV-2026-003",
    date: "Mar 1, 2026",
    amount: 299.0,
    status: "Paid",
    period: "Mar 1 - Mar 31, 2026",
  },
  {
    id: "INV-2026-002",
    date: "Feb 1, 2026",
    amount: 299.0,
    status: "Paid",
    period: "Feb 1 - Feb 28, 2026",
  },
  {
    id: "INV-2026-001",
    date: "Jan 1, 2026",
    amount: 299.0,
    status: "Paid",
    period: "Jan 1 - Jan 31, 2026",
  },
  {
    id: "INV-2025-012",
    date: "Dec 1, 2025",
    amount: 199.0,
    status: "Paid",
    period: "Dec 1 - Dec 31, 2025",
  },
];

const plans = [
  {
    name: "Starter",
    price: 199,
    conversations: 500,
    features: [
      "500 AI conversations/month",
      "Basic SMS automation",
      "Email support",
      "Calendar integration",
      "Basic analytics",
    ],
    current: false,
  },
  {
    name: "Professional",
    price: 299,
    conversations: 1000,
    features: [
      "1,000 AI conversations/month",
      "Advanced SMS automation",
      "Priority phone support",
      "Calendar & CRM integration",
      "Advanced analytics",
      "Custom AI responses",
    ],
    current: true,
  },
  {
    name: "Enterprise",
    price: 499,
    conversations: 2500,
    features: [
      "2,500 AI conversations/month",
      "Enterprise automation",
      "Dedicated account manager",
      "Full API access",
      "White-label options",
      "Custom integrations",
      "Advanced reporting",
    ],
    current: false,
  },
];

export function Billing() {
  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#0F172A] mb-2">
          Billing & Subscription
        </h1>
        <p className="text-sm text-[#64748B]">
          Manage your subscription and billing information
        </p>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-8">
        {/* Current Plan */}
        <div className="col-span-2 bg-white rounded-lg border border-[#E5E7EB] p-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-[#0F172A] mb-1">
                Current Plan
              </h2>
              <p className="text-sm text-[#64748B]">
                Your subscription details and usage
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#ECFDF5] text-[#10B981] rounded-full text-xs font-medium">
              <CheckCircle2 className="w-3 h-3" />
              {usageData.status}
            </span>
          </div>

          <div className="mb-6 pb-6 border-b border-[#E5E7EB]">
            <div className="flex items-baseline gap-2 mb-2">
              <div className="text-3xl font-semibold text-[#0F172A]">
                ${usageData.price}
              </div>
              <div className="text-sm text-[#64748B]">/month</div>
            </div>
            <div className="text-lg font-medium text-[#0F172A] mb-1">
              {usageData.plan} Plan
            </div>
            <div className="text-sm text-[#64748B]">
              Up to {usageData.conversations.included} conversations per month
            </div>
          </div>

          {/* Usage */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-[#2563EB]" />
                <h3 className="text-sm font-medium text-[#0F172A]">
                  Conversation Usage
                </h3>
              </div>
              <div className="text-sm text-[#64748B]">
                {usageData.conversations.used} of{" "}
                {usageData.conversations.included} used
              </div>
            </div>
            <div className="relative w-full h-3 bg-[#F1F5F9] rounded-full overflow-hidden">
              <div
                className="absolute top-0 left-0 h-full bg-[#2563EB] rounded-full transition-all"
                style={{ width: `${usageData.conversations.percentage}%` }}
              ></div>
            </div>
            <div className="mt-2 text-xs text-[#64748B]">
              {usageData.conversations.percentage}% of monthly quota used
            </div>
          </div>

          {/* Next Billing */}
          <div className="flex items-center justify-between p-4 bg-[#F8FAFC] rounded-lg">
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-[#64748B]" />
              <div>
                <div className="text-sm font-medium text-[#0F172A]">
                  Next billing date
                </div>
                <div className="text-xs text-[#64748B]">
                  {usageData.billingDate}
                </div>
              </div>
            </div>
            <div className="text-sm font-medium text-[#0F172A]">
              ${usageData.price}.00
            </div>
          </div>
        </div>

        {/* Payment Method */}
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <h2 className="text-lg font-semibold text-[#0F172A] mb-6">
            Payment Method
          </h2>
          <div className="p-4 bg-[#F8FAFC] rounded-lg mb-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-8 bg-[#2563EB] rounded flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-[#0F172A] mb-1">
                  Visa ending in 4242
                </div>
                <div className="text-xs text-[#64748B]">Expires 12/2027</div>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs text-[#10B981]">
              <CheckCircle2 className="w-3 h-3" />
              Default payment method
            </div>
          </div>
          <button className="w-full px-4 py-2 border border-[#E5E7EB] text-[#0F172A] rounded-lg hover:bg-[#F8FAFC] transition-colors text-sm font-medium">
            Update Payment Method
          </button>
        </div>
      </div>

      {/* Available Plans */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 mb-8">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-6">
          Available Plans
        </h2>
        <div className="grid grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`border rounded-lg p-6 transition-all ${
                plan.current
                  ? "border-[#2563EB] bg-[#EFF6FF] ring-2 ring-[#2563EB]/20"
                  : "border-[#E5E7EB] hover:border-[#2563EB]"
              }`}
            >
              {plan.current && (
                <div className="inline-block px-2 py-1 bg-[#2563EB] text-white rounded text-xs font-medium mb-4">
                  Current Plan
                </div>
              )}
              <div className="mb-4">
                <div className="text-xl font-semibold text-[#0F172A] mb-2">
                  {plan.name}
                </div>
                <div className="flex items-baseline gap-2">
                  <div className="text-3xl font-semibold text-[#0F172A]">
                    ${plan.price}
                  </div>
                  <div className="text-sm text-[#64748B]">/month</div>
                </div>
              </div>
              <div className="text-sm text-[#64748B] mb-6">
                {plan.conversations} conversations/month
              </div>
              <ul className="space-y-3 mb-6">
                {plan.features.map((feature, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-[#10B981] flex-shrink-0 mt-0.5" />
                    <span className="text-[#0F172A]">{feature}</span>
                  </li>
                ))}
              </ul>
              {plan.current ? (
                <button className="w-full px-4 py-2 bg-[#F1F5F9] text-[#64748B] rounded-lg text-sm font-medium cursor-not-allowed">
                  Current Plan
                </button>
              ) : (
                <button className="w-full px-4 py-2 bg-[#2563EB] text-white rounded-lg hover:bg-[#1D4ED8] transition-colors text-sm font-medium">
                  {plan.price > usageData.price ? "Upgrade" : "Downgrade"}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Invoice History */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-[#0F172A]">
            Invoice History
          </h2>
          <button className="flex items-center gap-2 px-4 py-2 text-[#2563EB] hover:bg-[#EFF6FF] rounded-lg transition-colors text-sm font-medium">
            <Download className="w-4 h-4" />
            Download All
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#64748B] uppercase tracking-wider">
                  Invoice
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#64748B] uppercase tracking-wider">
                  Billing Period
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#64748B] uppercase tracking-wider">
                  Date
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#64748B] uppercase tracking-wider">
                  Amount
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#64748B] uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#64748B] uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {invoiceHistory.map((invoice) => (
                <tr
                  key={invoice.id}
                  className="hover:bg-[#F8FAFC] transition-colors"
                >
                  <td className="px-6 py-4">
                    <span className="text-sm font-medium text-[#0F172A]">
                      {invoice.id}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-[#64748B]">
                      {invoice.period}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-[#0F172A]">
                      {invoice.date}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-medium text-[#0F172A]">
                      ${invoice.amount.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-block px-2 py-1 bg-[#ECFDF5] text-[#10B981] rounded text-xs font-medium">
                      {invoice.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <button className="flex items-center gap-1 text-sm text-[#2563EB] hover:text-[#1D4ED8]">
                      <Download className="w-4 h-4" />
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
