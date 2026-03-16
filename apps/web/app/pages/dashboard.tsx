import {
  DollarSign,
  Calendar,
  PhoneIncoming,
  MessageSquare,
  TrendingUp,
  CheckCircle2,
  ArrowUpRight,
  Bot,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const stats = [
  {
    name: "Recovered Revenue",
    value: "$24,580",
    change: "+18.2%",
    trend: "up" as const,
    icon: DollarSign,
    color: "text-[#10B981]",
    bgColor: "bg-[#ECFDF5]",
  },
  {
    name: "AI Booked Appointments",
    value: "127",
    change: "+12.5%",
    trend: "up" as const,
    icon: Calendar,
    color: "text-[#2563EB]",
    bgColor: "bg-[#EFF6FF]",
  },
  {
    name: "Missed Calls Captured",
    value: "94.2%",
    change: "+5.1%",
    trend: "up" as const,
    icon: PhoneIncoming,
    color: "text-[#F59E0B]",
    bgColor: "bg-[#FFFBEB]",
  },
  {
    name: "Active Conversations",
    value: "43",
    change: "12 today",
    trend: "neutral" as const,
    icon: MessageSquare,
    color: "text-[#8B5CF6]",
    bgColor: "bg-[#F5F3FF]",
  },
];

const revenueData = [
  { date: "Mar 10", revenue: 8200 },
  { date: "Mar 11", revenue: 9800 },
  { date: "Mar 12", revenue: 11200 },
  { date: "Mar 13", revenue: 10500 },
  { date: "Mar 14", revenue: 13800 },
  { date: "Mar 15", revenue: 15200 },
  { date: "Mar 16", revenue: 24580 },
];

const liveConversations = [
  {
    id: 1,
    customer: "John Martinez",
    phone: "(512) 555-0198",
    status: "AI Handling",
    statusColor: "bg-[#EFF6FF] text-[#2563EB]",
    message: "Interested in oil change appointment",
    time: "2 min ago",
  },
  {
    id: 2,
    customer: "Sarah Johnson",
    phone: "(512) 555-0142",
    status: "Booking",
    statusColor: "bg-[#ECFDF5] text-[#10B981]",
    message: "Requesting brake inspection quote",
    time: "5 min ago",
  },
  {
    id: 3,
    customer: "Mike Chen",
    phone: "(512) 555-0187",
    status: "AI Handling",
    statusColor: "bg-[#EFF6FF] text-[#2563EB]",
    message: "Following up on transmission service",
    time: "8 min ago",
  },
];

const todayAppointments = [
  {
    id: 1,
    time: "9:00 AM",
    customer: "Robert Williams",
    service: "Oil Change & Inspection",
    status: "confirmed",
    source: "AI",
  },
  {
    id: 2,
    time: "10:30 AM",
    customer: "Lisa Anderson",
    service: "Brake Replacement",
    status: "confirmed",
    source: "AI",
  },
  {
    id: 3,
    time: "2:00 PM",
    customer: "David Thompson",
    service: "Transmission Diagnostic",
    status: "pending",
    source: "Phone",
  },
  {
    id: 4,
    time: "3:30 PM",
    customer: "Jennifer Davis",
    service: "Tire Rotation",
    status: "confirmed",
    source: "AI",
  },
];

const systemStatus = [
  { service: "AI Receptionist", status: "operational", uptime: "99.8%" },
  { service: "SMS Gateway", status: "operational", uptime: "100%" },
  { service: "Calendar Sync", status: "operational", uptime: "99.9%" },
  { service: "Analytics Engine", status: "operational", uptime: "100%" },
];

export function Dashboard() {
  return (
    <div className="p-10 max-w-[1400px] mx-auto">
      {/* Page Header */}
      <div className="mb-10">
        <p className="text-xs font-semibold tracking-widest uppercase text-[#2563EB] mb-2">
          Texas Demo Shop
        </p>
        <h1 className="text-[28px] font-semibold text-[#0F172A] tracking-tight mb-2">
          Revenue Intelligence Dashboard
        </h1>
        <p className="text-[15px] text-[#64748B] leading-relaxed">
          Real-time performance metrics and AI-driven customer engagement
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-5 mb-10">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.name}
              className="bg-white rounded-xl border border-[#E5E7EB]/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-6 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-shadow"
            >
              <div className="flex items-center justify-between mb-5">
                <div className={`${stat.bgColor} ${stat.color} p-2.5 rounded-lg`}>
                  <Icon className="w-[18px] h-[18px]" />
                </div>
                {stat.trend === "up" && (
                  <div className="flex items-center gap-1 text-[#10B981]">
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    <span className="text-xs font-semibold">{stat.change}</span>
                  </div>
                )}
                {stat.trend === "neutral" && (
                  <span className="text-xs font-medium text-[#64748B]">{stat.change}</span>
                )}
              </div>
              <div className="text-[32px] font-bold text-[#0F172A] tracking-tight leading-none mb-1.5">
                {stat.value}
              </div>
              <div className="text-[13px] text-[#94A3B8] font-medium">{stat.name}</div>
            </div>
          );
        })}
      </div>

      {/* Second Row: Conversations + Appointments */}
      <div className="grid grid-cols-5 gap-5 mb-10">
        {/* Live Conversations */}
        <div className="col-span-3 bg-white rounded-xl border border-[#E5E7EB]/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-[15px] font-semibold text-[#0F172A]">
              Live Conversations
            </h2>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#ECFDF5] text-[#10B981] rounded-full text-xs font-medium">
              <span className="w-1.5 h-1.5 bg-[#10B981] rounded-full animate-pulse" />
              3 Active
            </span>
          </div>
          <div className="space-y-3">
            {liveConversations.map((conv) => (
              <div
                key={conv.id}
                className="flex items-start gap-3.5 p-4 bg-[#FAFBFC] rounded-lg border border-[#F1F5F9] hover:border-[#E2E8F0] transition-colors cursor-pointer"
              >
                <div className="w-9 h-9 bg-[#2563EB] rounded-full flex items-center justify-center text-white font-semibold text-xs flex-shrink-0 mt-0.5">
                  {conv.customer.split(' ').map(n => n[0]).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-semibold text-[#0F172A] text-[13px]">
                      {conv.customer}
                    </span>
                    <span className="text-[11px] text-[#94A3B8]">{conv.time}</span>
                  </div>
                  <div className="text-[11px] text-[#94A3B8] mb-1.5">
                    {conv.phone}
                  </div>
                  <div className="text-[13px] text-[#475569] mb-2.5 leading-relaxed">
                    {conv.message}
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${conv.statusColor}`}>
                    <Bot className="w-3 h-3" />
                    {conv.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Today's Appointments */}
        <div className="col-span-2 bg-white rounded-xl border border-[#E5E7EB]/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-[15px] font-semibold text-[#0F172A]">
              Today's Appointments
            </h2>
            <span className="text-xs text-[#94A3B8] font-medium">
              {todayAppointments.length} scheduled
            </span>
          </div>
          <div className="space-y-1">
            {todayAppointments.map((apt) => (
              <div
                key={apt.id}
                className="flex items-start gap-3 py-3.5 border-b border-[#F1F5F9] last:border-0"
              >
                <div className="w-1 h-full self-stretch rounded-full bg-[#2563EB] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] font-semibold text-[#0F172A]">
                      {apt.time}
                    </span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                        apt.status === "confirmed"
                          ? "bg-[#ECFDF5] text-[#10B981]"
                          : "bg-[#FEF3C7] text-[#D97706]"
                      }`}
                    >
                      {apt.status}
                    </span>
                  </div>
                  <div className="text-[13px] font-medium text-[#334155] mb-0.5">
                    {apt.customer}
                  </div>
                  <div className="text-[12px] text-[#94A3B8]">{apt.service}</div>
                  <div className="flex items-center gap-1 mt-1">
                    {apt.source === "AI" ? (
                      <Bot className="w-3 h-3 text-[#2563EB]" />
                    ) : null}
                    <span className="text-[11px] font-medium text-[#2563EB]">
                      {apt.source === "AI" ? "AI Booked" : "Phone"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Third Row: Revenue Analytics + System Status */}
      <div className="grid grid-cols-5 gap-5">
        {/* Revenue Analytics */}
        <div className="col-span-3 bg-white rounded-xl border border-[#E5E7EB]/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-[15px] font-semibold text-[#0F172A]">
              Revenue Analytics
            </h2>
            <div className="flex items-center gap-1.5 text-[13px] text-[#10B981] font-medium">
              <TrendingUp className="w-4 h-4" />
              +18.2% vs last week
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={revenueData}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563EB" stopOpacity={0.08} />
                  <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "#94A3B8", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#94A3B8", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#FFFFFF",
                  border: "1px solid #E5E7EB",
                  borderRadius: "10px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  fontSize: 13,
                }}
                formatter={(value: number) => [`$${value.toLocaleString()}`, "Revenue"]}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#2563EB"
                strokeWidth={2}
                fill="url(#colorRevenue)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* System Status */}
        <div className="col-span-2 bg-white rounded-xl border border-[#E5E7EB]/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-6">
          <h2 className="text-[15px] font-semibold text-[#0F172A] mb-5">
            System Status
          </h2>
          <div className="space-y-0">
            {systemStatus.map((system) => (
              <div
                key={system.service}
                className="flex items-center justify-between py-3.5 border-b border-[#F1F5F9] last:border-0"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-2 h-2 rounded-full bg-[#10B981]" />
                  <span className="text-[13px] font-medium text-[#334155]">
                    {system.service}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-[#94A3B8]">
                    {system.uptime}
                  </span>
                  <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
