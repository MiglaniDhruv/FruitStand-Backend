import { BaseRouter } from '../../utils/base';
import { CrateController } from './controller';
import { authenticateToken, validateTenant, attachTenantContext } from '../../middleware/auth';
import { asyncHandler } from "../../utils/async-handler";

export class CrateRouter extends BaseRouter {
  private crateController: CrateController;

  constructor() {
    super();
    this.crateController = new CrateController();
    this.setupRoutes();
  }

  private setupRoutes() {
    // GET /crate-transactions - Get crate transactions (with pagination support and filtering)
    this.router.get('/crate-transactions', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.crateController, 'getAll')
    );

    // GET /crate-transactions/retailer/:retailerId - Get crate transactions by retailer
    this.router.get('/crate-transactions/retailer/:retailerId', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.crateController, 'getByRetailer')
    );

    // GET /crate-transactions/vendor/:vendorId - Get crate transactions by vendor
    this.router.get('/crate-transactions/vendor/:vendorId', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.crateController, 'getByVendor')
    );

    // POST /crate-transactions - Create a new crate transaction
    this.router.post('/crate-transactions', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.crateController, 'create')
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
