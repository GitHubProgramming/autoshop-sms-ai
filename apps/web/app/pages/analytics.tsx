import { TrendingUp, DollarSign, Phone, Calendar, MessageSquare } from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const revenueData = [
  { month: "Oct", revenue: 52000, target: 50000 },
  { month: "Nov", revenue: 58000, target: 55000 },
  { month: "Dec", revenue: 64000, target: 60000 },
  { month: "Jan", revenue: 71000, target: 65000 },
  { month: "Feb", revenue: 78000, target: 70000 },
  { month: "Mar", revenue: 89000, target: 75000 },
];

const conversionData = [
  { week: "Week 1", calls: 45, captured: 42, converted: 38 },
  { week: "Week 2", calls: 52, captured: 49, converted: 44 },
  { week: "Week 3", calls: 48, captured: 46, converted: 42 },
  { week: "Week 4", calls: 56, captured: 53, converted: 48 },
];

const conversationVolumeData = [
  { date: "Mar 10", volume: 28 },
  { date: "Mar 11", volume: 35 },
  { date: "Mar 12", volume: 42 },
  { date: "Mar 13", volume: 38 },
  { date: "Mar 14", volume: 51 },
  { date: "Mar 15", volume: 47 },
  { date: "Mar 16", volume: 43 },
];

const sourceDistribution = [
  { name: "AI Booked", value: 68, color: "#2563EB" },
  { name: "Phone", value: 22, color: "#10B981" },
  { name: "Manual", value: 10, color: "#F59E0B" },
];

const kpiData = [
  {
    name: "Missed Call Recovery",
    value: "94.2%",
    change: "+5.1%",
    trend: "up",
    icon: Phone,
    color: "text-[#10B981]",
    bgColor: "bg-[#ECFDF5]",
  },
  {
    name: "AI Conversion Rate",
    value: "87.3%",
    change: "+3.8%",
    trend: "up",
    icon: MessageSquare,
    color: "text-[#2563EB]",
    bgColor: "bg-[#EFF6FF]",
  },
  {
    name: "Revenue Per Booking",
    value: "$193",
    change: "+8.2%",
    trend: "up",
    icon: DollarSign,
    color: "text-[#F59E0B]",
    bgColor: "bg-[#FEF3C7]",
  },
  {
    name: "Avg Response Time",
    value: "2.4s",
    change: "-0.8s",
    trend: "up",
    icon: TrendingUp,
    color: "text-[#8B5CF6]",
    bgColor: "bg-[#F3E8FF]",
  },
];

export function Analytics() {
  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#0F172A] mb-2">
          Analytics & Reporting
        </h1>
        <p className="text-sm text-[#64748B]">
          Track performance metrics and business insights
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-6 mb-8">
        {kpiData.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.name}
              className="bg-white rounded-lg border border-[#E5E7EB] p-6"
            >
              <div className="flex items-start justify-between mb-4">
                <div className={`${kpi.bgColor} ${kpi.color} p-3 rounded-lg`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
              <div className="text-2xl font-semibold text-[#0F172A] mb-1">
                {kpi.value}
              </div>
              <div className="text-sm text-[#64748B] mb-2">{kpi.name}</div>
              <div className="text-xs font-medium text-[#10B981]">
                {kpi.change} vs last period
              </div>
            </div>
          );
        })}
      </div>

      {/* Revenue Trend */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 mb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-[#0F172A] mb-1">
              Revenue Trend
            </h2>
            <p className="text-sm text-[#64748B]">
              Monthly revenue vs target performance
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-[#10B981]">
            <TrendingUp className="w-4 h-4" />
            <span className="font-medium">+18.7% vs target</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={revenueData}>
            <defs>
              <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563EB" stopOpacity={0.1} />
                <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorTarget" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10B981" stopOpacity={0.1} />
                <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="month"
              tick={{ fill: "#64748B", fontSize: 12 }}
              axisLine={{ stroke: "#E5E7EB" }}
            />
            <YAxis
              tick={{ fill: "#64748B", fontSize: 12 }}
              axisLine={{ stroke: "#E5E7EB" }}
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#FFFFFF",
                border: "1px solid #E5E7EB",
                borderRadius: "8px",
              }}
            />
            <Legend />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#2563EB"
              strokeWidth={2}
              fill="url(#colorRevenue)"
              name="Actual Revenue"
            />
            <Area
              type="monotone"
              dataKey="target"
              stroke="#10B981"
              strokeWidth={2}
              strokeDasharray="5 5"
              fill="url(#colorTarget)"
              name="Target"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-8">
        {/* Conversion Funnel */}
        <div className="col-span-2 bg-white rounded-lg border border-[#E5E7EB] p-6">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-[#0F172A] mb-1">
              AI Performance & Conversion
            </h2>
            <p className="text-sm text-[#64748B]">
              Weekly call capture and booking conversion rates
            </p>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={conversionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="week"
                tick={{ fill: "#64748B", fontSize: 12 }}
                axisLine={{ stroke: "#E5E7EB" }}
              />
              <YAxis
                tick={{ fill: "#64748B", fontSize: 12 }}
                axisLine={{ stroke: "#E5E7EB" }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#FFFFFF",
                  border: "1px solid #E5E7EB",
                  borderRadius: "8px",
                }}
              />
              <Legend />
              <Bar
                dataKey="calls"
                fill="#F59E0B"
                radius={[4, 4, 0, 0]}
                name="Total Calls"
              />
              <Bar
                dataKey="captured"
                fill="#2563EB"
                radius={[4, 4, 0, 0]}
                name="Captured by AI"
              />
              <Bar
                dataKey="converted"
                fill="#10B981"
                radius={[4, 4, 0, 0]}
                name="Converted to Booking"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Appointment Source Distribution */}
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-[#0F172A] mb-1">
              Booking Sources
            </h2>
            <p className="text-sm text-[#64748B]">Distribution this month</p>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={sourceDistribution}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
              >
                {sourceDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-6 space-y-3">
            {sourceDistribution.map((source) => (
              <div key={source.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: source.color }}
                  ></div>
                  <span className="text-sm text-[#0F172A]">{source.name}</span>
                </div>
                <span className="text-sm font-medium text-[#0F172A]">
                  {source.value}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Conversation Volume */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-[#0F172A] mb-1">
              Conversation Volume
            </h2>
            <p className="text-sm text-[#64748B]">
              Daily AI conversation activity
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#64748B]">Avg per day:</span>
            <span className="text-sm font-medium text-[#0F172A]">40.6</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={conversationVolumeData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#64748B", fontSize: 12 }}
              axisLine={{ stroke: "#E5E7EB" }}
            />
            <YAxis
              tick={{ fill: "#64748B", fontSize: 12 }}
              axisLine={{ stroke: "#E5E7EB" }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#FFFFFF",
                border: "1px solid #E5E7EB",
                borderRadius: "8px",
              }}
            />
            <Line
              type="monotone"
              dataKey="volume"
              stroke="#2563EB"
              strokeWidth={3}
              dot={{ fill: "#2563EB", r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
