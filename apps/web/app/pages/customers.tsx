import { Search, Car, Calendar, MessageSquare, MoreVertical } from "lucide-react";

const customers = [
  {
    id: 1,
    name: "Robert Williams",
    phone: "(512) 555-0144",
    email: "robert.w@email.com",
    vehicle: "2020 Toyota Camry",
    lastVisit: "Mar 12, 2026",
    appointments: 8,
    status: "Active",
    totalSpent: "$2,340",
  },
  {
    id: 2,
    name: "Lisa Anderson",
    phone: "(512) 555-0193",
    email: "lisa.anderson@email.com",
    vehicle: "2018 Ford F-150",
    lastVisit: "Mar 10, 2026",
    appointments: 12,
    status: "Active",
    totalSpent: "$4,250",
  },
  {
    id: 3,
    name: "John Martinez",
    phone: "(512) 555-0198",
    email: "john.martinez@email.com",
    vehicle: "2019 Honda Accord",
    lastVisit: "Mar 8, 2026",
    appointments: 5,
    status: "Active",
    totalSpent: "$1,580",
  },
  {
    id: 4,
    name: "Sarah Johnson",
    phone: "(512) 555-0142",
    email: "sarah.j@email.com",
    vehicle: "2021 Chevrolet Silverado",
    lastVisit: "Feb 28, 2026",
    appointments: 6,
    status: "Active",
    totalSpent: "$1,920",
  },
  {
    id: 5,
    name: "Michael Brown",
    phone: "(512) 555-0165",
    email: "m.brown@email.com",
    vehicle: "2017 Nissan Altima",
    lastVisit: "Feb 24, 2026",
    appointments: 15,
    status: "Active",
    totalSpent: "$5,640",
  },
  {
    id: 6,
    name: "Jennifer Davis",
    phone: "(512) 555-0177",
    email: "jdavis@email.com",
    vehicle: "2019 Mazda CX-5",
    lastVisit: "Feb 20, 2026",
    appointments: 7,
    status: "Active",
    totalSpent: "$2,180",
  },
  {
    id: 7,
    name: "David Thompson",
    phone: "(512) 555-0156",
    email: "david.t@email.com",
    vehicle: "2022 Tesla Model 3",
    lastVisit: "Feb 15, 2026",
    appointments: 3,
    status: "New",
    totalSpent: "$890",
  },
  {
    id: 8,
    name: "Amanda White",
    phone: "(512) 555-0189",
    email: "amanda.white@email.com",
    vehicle: "2020 Subaru Outback",
    lastVisit: "Feb 10, 2026",
    appointments: 9,
    status: "Active",
    totalSpent: "$3,120",
  },
  {
    id: 9,
    name: "Christopher Lee",
    phone: "(512) 555-0203",
    email: "chris.lee@email.com",
    vehicle: "2018 Honda CR-V",
    lastVisit: "Jan 28, 2026",
    appointments: 11,
    status: "Active",
    totalSpent: "$4,560",
  },
  {
    id: 10,
    name: "Patricia Garcia",
    phone: "(512) 555-0211",
    email: "p.garcia@email.com",
    vehicle: "2021 Kia Sorento",
    lastVisit: "Jan 15, 2026",
    appointments: 4,
    status: "Active",
    totalSpent: "$1,340",
  },
];

const statusColors: Record<string, { bg: string; text: string }> = {
  Active: { bg: "bg-[#ECFDF5]", text: "text-[#10B981]" },
  New: { bg: "bg-[#EFF6FF]", text: "text-[#2563EB]" },
  Inactive: { bg: "bg-[#F1F5F9]", text: "text-[#64748B]" },
};

export function Customers() {
  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#0F172A] mb-2">
          Customers
        </h1>
        <p className="text-sm text-[#64748B]">
          Manage your customer database and service history
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <div className="text-2xl font-semibold text-[#0F172A] mb-1">342</div>
          <div className="text-sm text-[#64748B] mb-2">Total Customers</div>
          <div className="text-xs text-[#10B981] font-medium">
            +23 this month
          </div>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <div className="text-2xl font-semibold text-[#0F172A] mb-1">89%</div>
          <div className="text-sm text-[#64748B] mb-2">Retention Rate</div>
          <div className="text-xs text-[#10B981] font-medium">+2.1% increase</div>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <div className="text-2xl font-semibold text-[#0F172A] mb-1">
            $2,840
          </div>
          <div className="text-sm text-[#64748B] mb-2">Avg Lifetime Value</div>
          <div className="text-xs text-[#2563EB] font-medium">Per customer</div>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <div className="text-2xl font-semibold text-[#0F172A] mb-1">7.2</div>
          <div className="text-sm text-[#64748B] mb-2">Avg Visits</div>
          <div className="text-xs text-[#64748B] font-medium">Per year</div>
        </div>
      </div>

      {/* Customer List */}
      <div className="bg-white rounded-lg border border-[#E5E7EB]">
        {/* Search and Filters */}
        <div className="p-6 border-b border-[#E5E7EB]">
          <div className="flex items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
              <input
                type="text"
                placeholder="Search customers..."
                className="w-full pl-9 pr-4 py-2 bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>
            <div className="flex items-center gap-3">
              <select className="px-4 py-2 bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]">
                <option>All Customers</option>
                <option>Active</option>
                <option>New</option>
                <option>Inactive</option>
              </select>
              <button className="px-4 py-2 bg-[#2563EB] text-white rounded-lg hover:bg-[#1D4ED8] transition-colors text-sm font-medium">
                Add Customer
              </button>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#64748B] uppercase tracking-wider">
                  Customer
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#64748B] uppercase tracking-wider">
                  Vehicle
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#64748B] uppercase tracking-wider">
                  Last Visit
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#64748B] uppercase tracking-wider">
                  Appointments
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#64748B] uppercase tracking-wider">
                  Total Spent
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
              {customers.map((customer) => (
                <tr
                  key={customer.id}
                  className="hover:bg-[#F8FAFC] transition-colors"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[#2563EB] rounded-full flex items-center justify-center text-white font-medium text-sm">
                        {customer.name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-medium text-[#0F172A]">
                          {customer.name}
                        </div>
                        <div className="text-sm text-[#64748B]">
                          {customer.phone}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Car className="w-4 h-4 text-[#64748B]" />
                      <span className="text-sm text-[#0F172A]">
                        {customer.vehicle}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-[#64748B]" />
                      <span className="text-sm text-[#0F172A]">
                        {customer.lastVisit}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-[#64748B]" />
                      <span className="text-sm text-[#0F172A]">
                        {customer.appointments}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-medium text-[#0F172A]">
                      {customer.totalSpent}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                        statusColors[customer.status].bg
                      } ${statusColors[customer.status].text}`}
                    >
                      {customer.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <button className="p-2 hover:bg-[#F1F5F9] rounded-lg transition-colors">
                      <MoreVertical className="w-4 h-4 text-[#64748B]" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-6 py-4 border-t border-[#E5E7EB] flex items-center justify-between">
          <div className="text-sm text-[#64748B]">
            Showing 1 to 10 of 342 customers
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 border border-[#E5E7EB] rounded-lg text-sm text-[#64748B] hover:bg-[#F8FAFC] transition-colors">
              Previous
            </button>
            <button className="px-3 py-1.5 bg-[#2563EB] text-white rounded-lg text-sm">
              1
            </button>
            <button className="px-3 py-1.5 border border-[#E5E7EB] rounded-lg text-sm text-[#64748B] hover:bg-[#F8FAFC] transition-colors">
              2
            </button>
            <button className="px-3 py-1.5 border border-[#E5E7EB] rounded-lg text-sm text-[#64748B] hover:bg-[#F8FAFC] transition-colors">
              3
            </button>
            <button className="px-3 py-1.5 border border-[#E5E7EB] rounded-lg text-sm text-[#64748B] hover:bg-[#F8FAFC] transition-colors">
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
