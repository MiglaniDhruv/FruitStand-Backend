import { BaseRouter } from '../../utils/base';
import { PaymentController } from './controller';
import { authenticateToken, requireRole, validateTenant, attachTenantContext } from '../../middleware/auth';
import { UserRole } from '../../types';
import { asyncHandler } from "../../utils/async-handler";

export class PaymentRouter extends BaseRouter {
  private paymentController: PaymentController;

  constructor() {
    super();
    this.paymentController = new PaymentController();
    this.setupRoutes();
  }

  private setupRoutes() {
    // GET /payments - Get all payments
    this.router.get('/payments', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.paymentController, 'getAll')
    );

    // GET /payments/invoice/:invoiceId - Get payments by invoice
    this.router.get('/payments/invoice/:invoiceId', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.paymentController, 'getByInvoice')
    );

    // POST /payments - Create a new payment (Admin/Accountant/Operator only)
    this.router.post('/payments', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requireRole([UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.OPERATOR])), 
      this.ah(this.paymentController, 'create')
    );

    // DELETE /payments/:id - Delete a payment
    this.router.delete('/payments/:id',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requireRole([UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.OPERATOR])),
      this.ah(this.paymentController, 'deletePayment')
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