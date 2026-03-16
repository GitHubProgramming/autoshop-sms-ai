import { useState } from "react";
import {
  Save,
  Phone,
  Clock,
  MessageSquare,
  Calendar,
  Bot,
  Bell,
  Mail,
} from "lucide-react";

export function Settings() {
  const [activeTab, setActiveTab] = useState("shop");

  const tabs = [
    { id: "shop", name: "Shop Profile", icon: Phone },
    { id: "hours", name: "Business Hours", icon: Clock },
    { id: "sms", name: "SMS Configuration", icon: MessageSquare },
    { id: "calendar", name: "Calendar", icon: Calendar },
    { id: "ai", name: "AI Behavior", icon: Bot },
    { id: "notifications", name: "Notifications", icon: Bell },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#0F172A] mb-2">Settings</h1>
        <p className="text-sm text-[#64748B]">
          Configure your AutoShop AI settings and preferences
        </p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar Tabs */}
        <div className="w-64 bg-white rounded-lg border border-[#E5E7EB] p-2 h-fit">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-left ${
                  activeTab === tab.id
                    ? "bg-[#EFF6FF] text-[#2563EB]"
                    : "text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#0F172A]"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-sm font-medium">{tab.name}</span>
              </button>
            );
          })}
        </div>

        {/* Content Area */}
        <div className="flex-1">
          {activeTab === "shop" && (
            <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-[#0F172A] mb-1">
                  Shop Profile
                </h2>
                <p className="text-sm text-[#64748B]">
                  Update your shop information and contact details
                </p>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-[#0F172A] mb-2">
                      Shop Name
                    </label>
                    <input
                      type="text"
                      defaultValue="Texas Demo Shop"
                      className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#0F172A] mb-2">
                      Phone Number
                    </label>
                    <input
                      type="text"
                      defaultValue="(512) 555-0100"
                      className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#0F172A] mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    defaultValue="contact@texasdemoshop.com"
                    className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#0F172A] mb-2">
                    Address
                  </label>
                  <input
                    type="text"
                    defaultValue="1234 Repair Lane, Austin, TX 78701"
                    className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#0F172A] mb-2">
                    Shop Description
                  </label>
                  <textarea
                    rows={4}
                    defaultValue="Full-service automotive repair shop specializing in brake service, oil changes, transmission repair, and general maintenance."
                    className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] resize-none"
                  />
                </div>

                <button className="flex items-center gap-2 px-6 py-2 bg-[#2563EB] text-white rounded-lg hover:bg-[#1D4ED8] transition-colors">
                  <Save className="w-4 h-4" />
                  Save Changes
                </button>
              </div>
            </div>
          )}

          {activeTab === "hours" && (
            <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-[#0F172A] mb-1">
                  Business Hours
                </h2>
                <p className="text-sm text-[#64748B]">
                  Set your operating hours for appointment scheduling
                </p>
              </div>

              <div className="space-y-4">
                {[
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                  "Sunday",
                ].map((day) => (
                  <div
                    key={day}
                    className="flex items-center gap-4 p-4 border border-[#E5E7EB] rounded-lg"
                  >
                    <div className="w-32">
                      <span className="text-sm font-medium text-[#0F172A]">
                        {day}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 flex-1">
                      <input
                        type="time"
                        defaultValue={
                          day === "Sunday" ? "" : "08:00"
                        }
                        disabled={day === "Sunday"}
                        className="px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] disabled:bg-[#F8FAFC] disabled:text-[#64748B]"
                      />
                      <span className="text-[#64748B]">to</span>
                      <input
                        type="time"
                        defaultValue={
                          day === "Sunday" ? "" : "17:00"
                        }
                        disabled={day === "Sunday"}
                        className="px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] disabled:bg-[#F8FAFC] disabled:text-[#64748B]"
                      />
                    </div>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        defaultChecked={day === "Sunday"}
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <span className="text-sm text-[#64748B]">Closed</span>
                    </label>
                  </div>
                ))}
              </div>

              <button className="flex items-center gap-2 px-6 py-2 bg-[#2563EB] text-white rounded-lg hover:bg-[#1D4ED8] transition-colors mt-6">
                <Save className="w-4 h-4" />
                Save Hours
              </button>
            </div>
          )}

          {activeTab === "sms" && (
            <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-[#0F172A] mb-1">
                  SMS Configuration
                </h2>
                <p className="text-sm text-[#64748B]">
                  Configure SMS messaging settings and templates
                </p>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-[#0F172A] mb-2">
                    SMS From Number
                  </label>
                  <input
                    type="text"
                    defaultValue="(512) 555-0100"
                    className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#0F172A] mb-2">
                    Welcome Message Template
                  </label>
                  <textarea
                    rows={3}
                    defaultValue="Thanks for contacting Texas Demo Shop! How can we help you today?"
                    className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#0F172A] mb-2">
                    Appointment Confirmation Template
                  </label>
                  <textarea
                    rows={3}
                    defaultValue="Your appointment is confirmed for {date} at {time}. We look forward to seeing you!"
                    className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] resize-none"
                  />
                </div>

                <div className="border-t border-[#E5E7EB] pt-6">
                  <h3 className="text-sm font-medium text-[#0F172A] mb-4">
                    Messaging Options
                  </h3>
                  <div className="space-y-3">
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        defaultChecked
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <span className="text-sm text-[#0F172A]">
                        Send appointment reminders 24 hours before
                      </span>
                    </label>
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        defaultChecked
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <span className="text-sm text-[#0F172A]">
                        Allow customers to reschedule via SMS
                      </span>
                    </label>
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        defaultChecked
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <span className="text-sm text-[#0F172A]">
                        Send follow-up messages after service
                      </span>
                    </label>
                  </div>
                </div>

                <button className="flex items-center gap-2 px-6 py-2 bg-[#2563EB] text-white rounded-lg hover:bg-[#1D4ED8] transition-colors">
                  <Save className="w-4 h-4" />
                  Save Configuration
                </button>
              </div>
            </div>
          )}

          {activeTab === "calendar" && (
            <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-[#0F172A] mb-1">
                  Calendar Integration
                </h2>
                <p className="text-sm text-[#64748B]">
                  Connect your calendar for automatic appointment syncing
                </p>
              </div>

              <div className="space-y-6">
                <div className="p-4 border border-[#E5E7EB] rounded-lg">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[#2563EB] rounded-lg flex items-center justify-center">
                        <Calendar className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <div className="font-medium text-[#0F172A]">
                          Google Calendar
                        </div>
                        <div className="text-xs text-[#64748B]">
                          contact@texasdemoshop.com
                        </div>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#ECFDF5] text-[#10B981] rounded-full text-xs font-medium">
                      Connected
                    </span>
                  </div>
                  <button className="px-4 py-2 border border-[#E5E7EB] text-[#0F172A] rounded-lg hover:bg-[#F8FAFC] transition-colors text-sm">
                    Disconnect
                  </button>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-[#0F172A] mb-4">
                    Sync Settings
                  </h3>
                  <div className="space-y-3">
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        defaultChecked
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <span className="text-sm text-[#0F172A]">
                        Two-way sync (updates in both directions)
                      </span>
                    </label>
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        defaultChecked
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <span className="text-sm text-[#0F172A]">
                        Block time slots that are unavailable
                      </span>
                    </label>
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        defaultChecked
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <span className="text-sm text-[#0F172A]">
                        Include customer details in calendar events
                      </span>
                    </label>
                  </div>
                </div>

                <button className="flex items-center gap-2 px-6 py-2 bg-[#2563EB] text-white rounded-lg hover:bg-[#1D4ED8] transition-colors">
                  <Save className="w-4 h-4" />
                  Save Settings
                </button>
              </div>
            </div>
          )}

          {activeTab === "ai" && (
            <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-[#0F172A] mb-1">
                  AI Behavior Settings
                </h2>
                <p className="text-sm text-[#64748B]">
                  Configure how your AI receptionist responds to customers
                </p>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-[#0F172A] mb-2">
                    AI Personality
                  </label>
                  <select className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]">
                    <option>Professional & Friendly</option>
                    <option>Casual & Conversational</option>
                    <option>Formal & Business-like</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#0F172A] mb-2">
                    Custom Instructions
                  </label>
                  <textarea
                    rows={4}
                    defaultValue="Always mention our same-day service availability. Be helpful and patient with customers who may not know technical terms. Emphasize our warranty on all parts and labor."
                    className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] resize-none"
                  />
                </div>

                <div className="border-t border-[#E5E7EB] pt-6">
                  <h3 className="text-sm font-medium text-[#0F172A] mb-4">
                    Automation Level
                  </h3>
                  <div className="space-y-3">
                    <label className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="automation"
                        defaultChecked
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <div>
                        <div className="text-sm font-medium text-[#0F172A]">
                          Full Automation
                        </div>
                        <div className="text-xs text-[#64748B]">
                          AI handles everything including booking appointments
                        </div>
                      </div>
                    </label>
                    <label className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="automation"
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <div>
                        <div className="text-sm font-medium text-[#0F172A]">
                          Assisted Mode
                        </div>
                        <div className="text-xs text-[#64748B]">
                          AI helps but requires confirmation for bookings
                        </div>
                      </div>
                    </label>
                    <label className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="automation"
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <div>
                        <div className="text-sm font-medium text-[#0F172A]">
                          Information Only
                        </div>
                        <div className="text-xs text-[#64748B]">
                          AI answers questions but doesn't book appointments
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="border-t border-[#E5E7EB] pt-6">
                  <h3 className="text-sm font-medium text-[#0F172A] mb-4">
                    Escalation Rules
                  </h3>
                  <div className="space-y-3">
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        defaultChecked
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <span className="text-sm text-[#0F172A]">
                        Escalate when customer requests human operator
                      </span>
                    </label>
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        defaultChecked
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <span className="text-sm text-[#0F172A]">
                        Escalate for complex diagnostic questions
                      </span>
                    </label>
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <span className="text-sm text-[#0F172A]">
                        Escalate if customer seems frustrated
                      </span>
                    </label>
                  </div>
                </div>

                <button className="flex items-center gap-2 px-6 py-2 bg-[#2563EB] text-white rounded-lg hover:bg-[#1D4ED8] transition-colors">
                  <Save className="w-4 h-4" />
                  Save AI Settings
                </button>
              </div>
            </div>
          )}

          {activeTab === "notifications" && (
            <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-[#0F172A] mb-1">
                  Notification Settings
                </h2>
                <p className="text-sm text-[#64748B]">
                  Choose how and when you want to be notified
                </p>
              </div>

              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-[#0F172A] mb-4">
                    Email Notifications
                  </h3>
                  <div className="space-y-3">
                    <label className="flex items-center justify-between p-3 border border-[#E5E7EB] rounded-lg">
                      <div className="flex items-center gap-3">
                        <Mail className="w-4 h-4 text-[#64748B]" />
                        <span className="text-sm text-[#0F172A]">
                          New appointment booked
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        defaultChecked
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#2563EB]"
                      />
                    </label>
                    <label className="flex items-center justify-between p-3 border border-[#E5E7EB] rounded-lg">
                      <div className="flex items-center gap-3">
                        <Mail className="w-4 h-4 text-[#64748B]" />
                        <span className="text-sm text-[#0F172A]">
                          Conversation needs operator
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        defaultChecked
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#2563EB]"
                      />
                    </label>
                    <label className="flex items-center justify-between p-3 border border-[#E5E7EB] rounded-lg">
                      <div className="flex items-center gap-3">
                        <Mail className="w-4 h-4 text-[#64748B]" />
                        <span className="text-sm text-[#0F172A]">
                          Daily summary report
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        defaultChecked
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#2563EB]"
                      />
                    </label>
                    <label className="flex items-center justify-between p-3 border border-[#E5E7EB] rounded-lg">
                      <div className="flex items-center gap-3">
                        <Mail className="w-4 h-4 text-[#64748B]" />
                        <span className="text-sm text-[#0F172A]">
                          Weekly analytics report
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#2563EB]"
                      />
                    </label>
                  </div>
                </div>

                <div className="border-t border-[#E5E7EB] pt-6">
                  <h3 className="text-sm font-medium text-[#0F172A] mb-4">
                    SMS Notifications
                  </h3>
                  <div className="space-y-3">
                    <label className="flex items-center justify-between p-3 border border-[#E5E7EB] rounded-lg">
                      <div className="flex items-center gap-3">
                        <MessageSquare className="w-4 h-4 text-[#64748B]" />
                        <span className="text-sm text-[#0F172A]">
                          Urgent escalations only
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        defaultChecked
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#2563EB]"
                      />
                    </label>
                    <label className="flex items-center justify-between p-3 border border-[#E5E7EB] rounded-lg">
                      <div className="flex items-center gap-3">
                        <MessageSquare className="w-4 h-4 text-[#64748B]" />
                        <span className="text-sm text-[#0F172A]">
                          System alerts
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        defaultChecked
                        className="w-4 h-4 text-[#2563EB] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#2563EB]"
                      />
                    </label>
                  </div>
                </div>

                <button className="flex items-center gap-2 px-6 py-2 bg-[#2563EB] text-white rounded-lg hover:bg-[#1D4ED8] transition-colors">
                  <Save className="w-4 h-4" />
                  Save Preferences
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
