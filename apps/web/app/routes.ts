import { createBrowserRouter } from "react-router";
import { Layout } from "./components/layout";
import { Dashboard } from "./pages/dashboard";
import { Conversations } from "./pages/conversations";
import { Appointments } from "./pages/appointments";
import { Customers } from "./pages/customers";
import { Analytics } from "./pages/analytics";
import { Billing } from "./pages/billing";
import { Settings } from "./pages/settings";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Dashboard },
      { path: "conversations", Component: Conversations },
      { path: "appointments", Component: Appointments },
      { path: "customers", Component: Customers },
      { path: "analytics", Component: Analytics },
      { path: "billing", Component: Billing },
      { path: "settings", Component: Settings },
    ],
  },
]);
