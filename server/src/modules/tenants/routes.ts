import { Router } from "express";
import { BaseRouter } from "../../utils/base";
import { TenantController } from "./controller";
import { authenticateToken, requirePermission, validateTenant, attachTenantContext } from "../../middleware/auth";
import { asyncHandler } from "../../utils/async-handler";

export class TenantRouter extends BaseRouter {
  private tenantController: TenantController;

  constructor() {
    super();
    this.tenantController = new TenantController();
    this.setupRoutes();
  }

  protected setupRoutes(): void {
    // GET /tenants/slug/:slug - Public endpoint for tenant validation by slug
    this.router.get('/tenants/slug/:slug',
      asyncHandler(this.tenantController.getBySlug.bind(this.tenantController))
    );

    // GET /tenants/current - Get current user's tenant
    this.router.get('/tenants/current', 
      authenticateToken, 
      asyncHandler(this.tenantController.getCurrent.bind(this.tenantController))
    );

    // GET /tenants/accessible - Get tenants accessible to current user
    this.router.get('/tenants/accessible', 
      authenticateToken, 
      asyncHandler(this.tenantController.getAccessible.bind(this.tenantController))
    );

    // GET /tenants/current/settings - Get current tenant's settings
    this.router.get('/tenants/current/settings', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(this.tenantController.getSettings.bind(this.tenantController))
    );

    // PUT /tenants/current/settings - Update current tenant's settings
    this.router.put('/tenants/current/settings', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requirePermission(['Admin'])),
      asyncHandler(this.tenantController.updateSettings.bind(this.tenantController))
    );
  }
}

// server/src/modules/users/routes.ts
const router = Router();

// Example route
router.get("/", (req, res) => {
  res.json({ message: "List of users" });
});

// Named export
export { router };
