import { useState } from "react";
import {
  Search,
  MoreVertical,
  Phone,
  Mail,
  MapPin,
  Car,
  Send,
  Paperclip,
} from "lucide-react";

const conversations = [
  {
    id: 1,
    customer: "John Martinez",
    phone: "(512) 555-0198",
    lastMessage: "Thanks! I'll be there at 2pm tomorrow.",
    timestamp: "2 min ago",
    status: "Booked",
    unread: false,
  },
  {
    id: 2,
    customer: "Sarah Johnson",
    phone: "(512) 555-0142",
    lastMessage: "How much would brake pads cost?",
    timestamp: "5 min ago",
    status: "AI",
    unread: true,
  },
  {
    id: 3,
    customer: "Mike Chen",
    phone: "(512) 555-0187",
    lastMessage: "Is the shop open on weekends?",
    timestamp: "8 min ago",
    status: "Resolved",
    unread: false,
  },
  {
    id: 4,
    customer: "Emily Rodriguez",
    phone: "(512) 555-0221",
    lastMessage: "I need help with my transmission",
    timestamp: "15 min ago",
    status: "Needs Operator",
    unread: true,
  },
  {
    id: 5,
    customer: "David Thompson",
    phone: "(512) 555-0156",
    lastMessage: "Appointment confirmed, thank you!",
    timestamp: "1 hour ago",
    status: "Booked",
    unread: false,
  },
  {
    id: 6,
    customer: "Lisa Anderson",
    phone: "(512) 555-0193",
    lastMessage: "What time do you close today?",
    timestamp: "2 hours ago",
    status: "Resolved",
    unread: false,
  },
];

const messages = [
  {
    id: 1,
    sender: "customer",
    text: "Hi, I need to schedule an oil change",
    timestamp: "2:45 PM",
  },
  {
    id: 2,
    sender: "ai",
    text: "Hello! I'd be happy to help you schedule an oil change. What day works best for you?",
    timestamp: "2:45 PM",
  },
  {
    id: 3,
    sender: "customer",
    text: "How about tomorrow afternoon?",
    timestamp: "2:46 PM",
  },
  {
    id: 4,
    sender: "ai",
    text: "Tomorrow afternoon works great! We have availability at 2:00 PM, 3:30 PM, or 4:00 PM. Which time would you prefer?",
    timestamp: "2:46 PM",
  },
  {
    id: 5,
    sender: "customer",
    text: "2pm would be perfect",
    timestamp: "2:47 PM",
  },
  {
    id: 6,
    sender: "ai",
    text: "Perfect! I've scheduled your oil change for tomorrow at 2:00 PM. You should receive a confirmation text shortly. Is there anything else I can help you with?",
    timestamp: "2:47 PM",
  },
  {
    id: 7,
    sender: "customer",
    text: "Thanks! I'll be there at 2pm tomorrow.",
    timestamp: "2:48 PM",
  },
];

const statusColors: Record<string, { bg: string; text: string }> = {
  AI: { bg: "bg-[#EFF6FF]", text: "text-[#2563EB]" },
  Booked: { bg: "bg-[#ECFDF5]", text: "text-[#10B981]" },
  "Needs Operator": { bg: "bg-[#FEF3C7]", text: "text-[#F59E0B]" },
  Resolved: { bg: "bg-[#F1F5F9]", text: "text-[#64748B]" },
};

export function Conversations() {
  const [selectedConversation, setSelectedConversation] = useState(
    conversations[0]
  );

  return (
    <div className="h-screen flex bg-[#F8FAFC]">
      {/* Conversation List */}
      <div className="w-80 bg-white border-r border-[#E5E7EB] flex flex-col">
        <div className="p-4 border-b border-[#E5E7EB]">
          <h1 className="text-xl font-semibold text-[#0F172A] mb-4">
            Conversations
          </h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
            <input
              type="text"
              placeholder="Search conversations..."
              className="w-full pl-9 pr-4 py-2 bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => setSelectedConversation(conv)}
              className={`p-4 border-b border-[#E5E7EB] cursor-pointer transition-colors ${
                selectedConversation.id === conv.id
                  ? "bg-[#EFF6FF]"
                  : "hover:bg-[#F8FAFC]"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-[#2563EB] rounded-full flex items-center justify-center text-white font-medium text-sm flex-shrink-0">
                  {conv.customer.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-medium text-sm text-[#0F172A] truncate">
                      {conv.customer}
                    </div>
                    <div className="text-xs text-[#64748B] flex-shrink-0 ml-2">
                      {conv.timestamp}
                    </div>
                  </div>
                  <div className="text-xs text-[#64748B] mb-2 truncate">
                    {conv.phone}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className={`text-xs text-[#64748B] truncate ${
                        conv.unread ? "font-medium text-[#0F172A]" : ""
                      }`}
                    >
                      {conv.lastMessage}
                    </div>
                    {conv.unread && (
                      <div className="w-2 h-2 bg-[#2563EB] rounded-full flex-shrink-0"></div>
                    )}
                  </div>
                  <div className="mt-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        statusColors[conv.status].bg
                      } ${statusColors[conv.status].text}`}
                    >
                      {conv.status}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Message Thread */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Thread Header */}
        <div className="p-4 border-b border-[#E5E7EB] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#2563EB] rounded-full flex items-center justify-center text-white font-medium">
              {selectedConversation.customer.charAt(0)}
            </div>
            <div>
              <div className="font-medium text-[#0F172A]">
                {selectedConversation.customer}
              </div>
              <div className="text-sm text-[#64748B]">
                {selectedConversation.phone}
              </div>
            </div>
          </div>
          <button className="p-2 hover:bg-[#F8FAFC] rounded-lg transition-colors">
            <MoreVertical className="w-5 h-5 text-[#64748B]" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.sender === "customer" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-md ${
                  message.sender === "customer"
                    ? "bg-[#2563EB] text-white"
                    : "bg-[#F8FAFC] text-[#0F172A]"
                } rounded-lg p-3`}
              >
                {message.sender === "ai" && (
                  <div className="text-xs text-[#2563EB] font-medium mb-1">
                    AutoShop AI
                  </div>
                )}
                <div className="text-sm">{message.text}</div>
                <div
                  className={`text-xs mt-1 ${
                    message.sender === "customer"
                      ? "text-blue-200"
                      : "text-[#64748B]"
                  }`}
                >
                  {message.timestamp}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Message Input */}
        <div className="p-4 border-t border-[#E5E7EB]">
          <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-[#F8FAFC] rounded-lg transition-colors">
              <Paperclip className="w-5 h-5 text-[#64748B]" />
            </button>
            <input
              type="text"
              placeholder="Type a message..."
              className="flex-1 px-4 py-2 bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
            <button className="px-4 py-2 bg-[#2563EB] text-white rounded-lg hover:bg-[#1D4ED8] transition-colors flex items-center gap-2">
              <Send className="w-4 h-4" />
              <span className="text-sm font-medium">Send</span>
            </button>
          </div>
        </div>
      </div>

      {/* Customer Details Panel */}
      <div className="w-80 bg-white border-l border-[#E5E7EB] p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-6">
          Customer Details
        </h2>

        <div className="space-y-6">
          {/* Contact Info */}
          <div>
            <h3 className="text-sm font-medium text-[#64748B] mb-3">
              Contact Information
            </h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-[#64748B]" />
                <span className="text-sm text-[#0F172A]">
                  {selectedConversation.phone}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-[#64748B]" />
                <span className="text-sm text-[#0F172A]">
                  john.martinez@email.com
                </span>
              </div>
              <div className="flex items-center gap-3">
                <MapPin className="w-4 h-4 text-[#64748B]" />
                <span className="text-sm text-[#0F172A]">Austin, TX</span>
              </div>
            </div>
          </div>

          {/* Vehicle Info */}
          <div className="pt-6 border-t border-[#E5E7EB]">
            <h3 className="text-sm font-medium text-[#64748B] mb-3">
              Vehicle Information
            </h3>
            <div className="bg-[#F8FAFC] rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Car className="w-5 h-5 text-[#2563EB] mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-[#0F172A] mb-1">
                    2019 Honda Accord
                  </div>
                  <div className="text-xs text-[#64748B]">VIN: 1HGCV1F3XKA...</div>
                  <div className="text-xs text-[#64748B]">52,341 miles</div>
                </div>
              </div>
            </div>
          </div>

          {/* Appointment History */}
          <div className="pt-6 border-t border-[#E5E7EB]">
            <h3 className="text-sm font-medium text-[#64748B] mb-3">
              Recent Appointments
            </h3>
            <div className="space-y-3">
              <div className="text-sm">
                <div className="font-medium text-[#0F172A]">Oil Change</div>
                <div className="text-xs text-[#64748B]">Mar 17, 2026 - 2:00 PM</div>
                <span className="inline-block mt-1 px-2 py-0.5 bg-[#ECFDF5] text-[#10B981] rounded text-xs">
                  Upcoming
                </span>
              </div>
              <div className="text-sm">
                <div className="font-medium text-[#0F172A]">
                  Tire Rotation
                </div>
                <div className="text-xs text-[#64748B]">Jan 15, 2026</div>
                <span className="inline-block mt-1 px-2 py-0.5 bg-[#F1F5F9] text-[#64748B] rounded text-xs">
                  Completed
                </span>
              </div>
              <div className="text-sm">
                <div className="font-medium text-[#0F172A]">
                  Brake Inspection
                </div>
                <div className="text-xs text-[#64748B]">Nov 3, 2025</div>
                <span className="inline-block mt-1 px-2 py-0.5 bg-[#F1F5F9] text-[#64748B] rounded text-xs">
                  Completed
                </span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="pt-6 border-t border-[#E5E7EB]">
            <h3 className="text-sm font-medium text-[#64748B] mb-3">Notes</h3>
            <textarea
              placeholder="Add notes about this customer..."
              className="w-full px-3 py-2 bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] resize-none"
              rows={4}
            ></textarea>
          </div>
        </div>
      </div>
    </div>
  );
}
