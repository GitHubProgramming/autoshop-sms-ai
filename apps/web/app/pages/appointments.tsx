import { Calendar as CalendarIcon, Clock, Phone, Bot, User } from "lucide-react";

const todayAppointments = [
  {
    id: 1,
    time: "9:00 AM",
    customer: "Robert Williams",
    phone: "(512) 555-0144",
    service: "Oil Change & Inspection",
    status: "Confirmed",
    source: "AI",
    duration: "45 min",
  },
  {
    id: 2,
    time: "10:30 AM",
    customer: "Lisa Anderson",
    phone: "(512) 555-0193",
    service: "Brake Replacement",
    status: "Confirmed",
    source: "AI",
    duration: "2 hours",
  },
  {
    id: 3,
    time: "2:00 PM",
    customer: "John Martinez",
    phone: "(512) 555-0198",
    service: "Oil Change",
    status: "Confirmed",
    source: "AI",
    duration: "30 min",
  },
  {
    id: 4,
    time: "3:30 PM",
    customer: "Jennifer Davis",
    phone: "(512) 555-0177",
    service: "Tire Rotation",
    status: "Confirmed",
    source: "AI",
    duration: "45 min",
  },
];

const upcomingAppointments = [
  {
    id: 5,
    date: "Mar 17, 2026",
    time: "10:00 AM",
    customer: "Michael Brown",
    phone: "(512) 555-0165",
    service: "Transmission Service",
    status: "Confirmed",
    source: "Phone",
  },
  {
    id: 6,
    date: "Mar 17, 2026",
    time: "1:00 PM",
    customer: "Amanda White",
    phone: "(512) 555-0189",
    service: "AC Repair",
    status: "Confirmed",
    source: "AI",
  },
  {
    id: 7,
    date: "Mar 18, 2026",
    time: "9:30 AM",
    customer: "Christopher Lee",
    phone: "(512) 555-0203",
    service: "Battery Replacement",
    status: "Pending",
    source: "AI",
  },
  {
    id: 8,
    date: "Mar 18, 2026",
    time: "11:00 AM",
    customer: "Patricia Garcia",
    phone: "(512) 555-0211",
    service: "Engine Diagnostic",
    status: "Confirmed",
    source: "Manual",
  },
  {
    id: 9,
    date: "Mar 19, 2026",
    time: "2:00 PM",
    customer: "Daniel Rodriguez",
    phone: "(512) 555-0228",
    service: "Wheel Alignment",
    status: "Confirmed",
    source: "AI",
  },
  {
    id: 10,
    date: "Mar 19, 2026",
    time: "3:30 PM",
    customer: "Elizabeth Martinez",
    phone: "(512) 555-0245",
    service: "Oil Change & Filter",
    status: "Confirmed",
    source: "AI",
  },
];

const statusColors: Record<string, { bg: string; text: string }> = {
  Confirmed: { bg: "bg-[#ECFDF5]", text: "text-[#10B981]" },
  Pending: { bg: "bg-[#FEF3C7]", text: "text-[#F59E0B]" },
  Completed: { bg: "bg-[#F1F5F9]", text: "text-[#64748B]" },
  Cancelled: { bg: "bg-[#FEE2E2]", text: "text-[#DC2626]" },
};

const sourceIcons: Record<string, any> = {
  AI: Bot,
  Phone: Phone,
  Manual: User,
};

export function Appointments() {
  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#0F172A] mb-2">
          Appointments
        </h1>
        <p className="text-sm text-[#64748B]">
          Manage and track all customer appointments
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <div className="text-2xl font-semibold text-[#0F172A] mb-1">4</div>
          <div className="text-sm text-[#64748B] mb-2">Today's Bookings</div>
          <div className="text-xs text-[#10B981] font-medium">All confirmed</div>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <div className="text-2xl font-semibold text-[#0F172A] mb-1">12</div>
          <div className="text-sm text-[#64748B] mb-2">This Week</div>
          <div className="text-xs text-[#2563EB] font-medium">
            +3 vs last week
          </div>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <div className="text-2xl font-semibold text-[#0F172A] mb-1">83%</div>
          <div className="text-sm text-[#64748B] mb-2">AI Booked</div>
          <div className="text-xs text-[#10B981] font-medium">+12% increase</div>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <div className="text-2xl font-semibold text-[#0F172A] mb-1">97%</div>
          <div className="text-sm text-[#64748B] mb-2">Show-up Rate</div>
          <div className="text-xs text-[#10B981] font-medium">Above target</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Today's Appointments */}
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-[#0F172A]">
              Today - March 16, 2026
            </h2>
            <button className="px-3 py-1.5 bg-[#2563EB] text-white rounded-lg hover:bg-[#1D4ED8] transition-colors text-sm font-medium">
              Add Appointment
            </button>
          </div>
          <div className="space-y-4">
            {todayAppointments.map((apt) => {
              const SourceIcon = sourceIcons[apt.source];
              return (
                <div
                  key={apt.id}
                  className="p-4 bg-[#F8FAFC] rounded-lg hover:bg-[#F1F5F9] transition-colors cursor-pointer border border-[#E5E7EB]"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <div className="w-12 h-12 bg-[#2563EB] rounded-lg flex items-center justify-center text-white font-semibold">
                        {apt.time.split(":")[0]}
                        <span className="text-xs ml-0.5">
                          {apt.time.includes("AM") ? "AM" : "PM"}
                        </span>
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="font-medium text-[#0F172A] mb-1">
                            {apt.customer}
                          </div>
                          <div className="text-sm text-[#64748B]">
                            {apt.service}
                          </div>
                        </div>
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            statusColors[apt.status].bg
                          } ${statusColors[apt.status].text}`}
                        >
                          {apt.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-[#64748B] mt-3">
                        <div className="flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {apt.phone}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {apt.duration}
                        </div>
                        <div className="flex items-center gap-1">
                          <SourceIcon className="w-3 h-3" />
                          {apt.source}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Upcoming Appointments */}
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <h2 className="text-lg font-semibold text-[#0F172A] mb-6">
            Upcoming Appointments
          </h2>
          <div className="space-y-3">
            {upcomingAppointments.map((apt) => {
              const SourceIcon = sourceIcons[apt.source];
              return (
                <div
                  key={apt.id}
                  className="p-4 border border-[#E5E7EB] rounded-lg hover:border-[#2563EB] transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <CalendarIcon className="w-4 h-4 text-[#64748B]" />
                        <span className="text-sm font-medium text-[#0F172A]">
                          {apt.date}
                        </span>
                        <span className="text-sm text-[#64748B]">
                          at {apt.time}
                        </span>
                      </div>
                      <div className="font-medium text-[#0F172A] mb-1">
                        {apt.customer}
                      </div>
                      <div className="text-sm text-[#64748B] mb-2">
                        {apt.service}
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            statusColors[apt.status].bg
                          } ${statusColors[apt.status].text}`}
                        >
                          {apt.status}
                        </span>
                        <div className="flex items-center gap-1 text-xs text-[#64748B]">
                          <SourceIcon className="w-3 h-3" />
                          {apt.source}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
