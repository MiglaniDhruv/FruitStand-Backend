import { BaseRouter } from '../../utils/base';
import { DashboardController } from './controller';
import { authenticateToken, validateTenant, attachTenantContext } from '../../middleware/auth';
import { asyncHandler } from "../../utils/async-handler";

export class DashboardRouter extends BaseRouter {
  private dashboardController: DashboardController;

  constructor() {
    super();
    this.dashboardController = new DashboardController();
    this.setupRoutes();
  }

  private setupRoutes() {
    // GET /dashboard/kpis - Get dashboard KPIs
    this.router.get('/dashboard/kpis', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(this.dashboardController.getKPIs.bind(this.dashboardController))
    );
  }
}

// server/src/modules/users/routes.ts
import { Router } from "express";
const router = Router();

// Example route
router.get("/", (req, res) => {
  res.json({ message: "List of users" });
});

// Named export
export { router };
