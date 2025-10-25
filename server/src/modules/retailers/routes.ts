import { BaseRouter } from '../../utils/base';
import { RetailerController } from './controller';
import { authenticateToken, validateTenant, attachTenantContext } from '../../middleware/auth';
import { asyncHandler } from "../../utils/async-handler";

export class RetailerRouter extends BaseRouter {
  private retailerController: RetailerController;

  constructor() {
    super();
    this.retailerController = new RetailerController();
    this.setupRoutes();
  }

  private setupRoutes() {
    // GET /retailers - Get retailers (with pagination support)
    this.router.get('/retailers', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.retailerController, 'getAll')
    );

    // GET /retailers/stats - Get retailer statistics
    this.router.get('/retailers/stats',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.retailerController, 'getStats')
    );

    this.router.patch('/retailers/:id/favourite',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.retailerController, 'toggleFavourite')
    );

    // GET /retailers/:id - Get a specific retailer
    this.router.get('/retailers/:id', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.retailerController, 'getById')
    );

    // POST /retailers - Create a new retailer
    this.router.post('/retailers', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.retailerController, 'create')
    );

    // PUT /retailers/:id - Update a retailer
    this.router.put('/retailers/:id', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.retailerController, 'update')
    );

    // DELETE /retailers/:id - Delete a retailer (soft delete)
    this.router.delete('/retailers/:id', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.retailerController, 'delete')
    );

    // POST /retailers/:id/payments - Record retailer payment
    this.router.post('/retailers/:id/payments',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.retailerController, 'recordPayment')
    );

    // GET /retailers/:id/outstanding-invoices - Get outstanding invoices
    this.router.get('/retailers/:id/outstanding-invoices',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.retailerController, 'getOutstandingInvoices')
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
