import express from "express";

// Import all module routers (named exports from each routes.ts)
import { router as userRoutes } from "./modules/users/routes";
import { router as paymentRoutes } from "./modules/payments/routes";
import { router as authRoutes } from "./modules/auth/routes";
import { router as bankaccountRoutes } from "./modules/bank-accounts/routes";
import { router as cratesRoutes } from "./modules/crates/routes";
import { router as dashboardRoutes } from "./modules/dashboard/routes";
import { router as expensesRoutes } from "./modules/expenses/routes";
import { router as itemsRoutes } from "./modules/items/routes";
import { router as ledgersRoutes } from "./modules/ledgers/routes";
import { router as purchaseinvoiceRoutes } from "./modules/purchase-invoices/routes";
import { router as reportsRoutes } from "./modules/reports/routes";
import { router as retailersRoutes } from "./modules/retailers/routes";
import { router as salesinvoiceRoutes } from "./modules/sales-invoices/routes";
import { router as salespaymentRoutes } from "./modules/sales-payments/routes";
import { router as stockRoutes } from "./modules/stock/routes";
import { router as tenantsRoutes } from "./modules/tenants/routes";
import { router as vendorRoutes } from "./modules/vendors/routes";

const app = express();
app.use(express.json());

// Mount all routes
app.use("/users", userRoutes);
app.use("/payments", paymentRoutes);
app.use("/auth", authRoutes);
app.use("/bank-accounts", bankaccountRoutes);
app.use("/crates", cratesRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/expenses", expensesRoutes);
app.use("/items", itemsRoutes);
app.use("/ledgers", ledgersRoutes);
app.use("/purchase-invoices", purchaseinvoiceRoutes);
app.use("/reports", reportsRoutes);
app.use("/retailers", retailersRoutes);
app.use("/sales-invoices", salesinvoiceRoutes);
app.use("/sales-payments", salespaymentRoutes);
app.use("/stock", stockRoutes);
app.use("/tenants", tenantsRoutes);
app.use("/vendors", vendorRoutes);

export default app;
