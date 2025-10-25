import { BaseRouter } from '../../utils/base';
import { SalesPaymentController } from './controller';
import { authenticateToken, validateTenant, attachTenantContext } from '../../middleware/auth';
import { asyncHandler } from "../../utils/async-handler";

export class SalesPaymentRouter extends BaseRouter {
  private salesPaymentController: SalesPaymentController;

  constructor() {
    super();
    this.salesPaymentController = new SalesPaymentController();
    this.setupRoutes();
  }

  private setupRoutes() {
    // GET /sales-payments - Get all sales payments
    this.router.get('/sales-payments', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.salesPaymentController, 'getSalesPayments')
    );

    // GET /sales-payments/invoice/:invoiceId - Get sales payments by invoice
    this.router.get('/sales-payments/invoice/:invoiceId', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.salesPaymentController, 'getSalesPaymentsByInvoice')
    );

    // POST /sales-payments - Create a new sales payment
    this.router.post('/sales-payments', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.salesPaymentController, 'createSalesPayment')
    );

    // DELETE /sales-payments/:id - Delete a sales payment
    this.router.delete('/sales-payments/:id',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.salesPaymentController, 'deleteSalesPayment')
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
