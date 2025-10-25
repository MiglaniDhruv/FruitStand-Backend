import { BaseRouter } from '../../utils/base';
import { SalesInvoiceController } from './controller';
import { authenticateToken, validateTenant, attachTenantContext } from '../../middleware/auth';
import { asyncHandler } from "../../utils/async-handler";

export class SalesInvoiceRouter extends BaseRouter {
  private salesInvoiceController: SalesInvoiceController;

  constructor() {
    super();
    this.salesInvoiceController = new SalesInvoiceController();
    this.setupRoutes();
  }

  private setupRoutes() {
    // GET /sales-invoices - Get sales invoices (with pagination support)
    this.router.get('/sales-invoices', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.salesInvoiceController, 'getSalesInvoicesPaginated')
    );
    
    this.router.get('/sales-invoices/paginated', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.salesInvoiceController, 'getSalesInvoicesPaginated')
    );

    // GET /sales-invoices/:id - Get a specific sales invoice
    this.router.get('/sales-invoices/:id', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.salesInvoiceController, 'getSalesInvoice')
    );

    // POST /sales-invoices - Create a new sales invoice
    this.router.post('/sales-invoices', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.salesInvoiceController, 'createSalesInvoice')
    );

    // PUT /sales-invoices/:id - Update a sales invoice
    this.router.put('/sales-invoices/:id', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.salesInvoiceController, 'updateSalesInvoice')
    );

    // PUT /sales-invoices/:id/mark-paid - Mark sales invoice as paid
    this.router.put('/sales-invoices/:id/mark-paid', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.salesInvoiceController, 'markSalesInvoiceAsPaid')
    );

    // POST /sales-invoices/:id/share-link - Create share link for sales invoice
    this.router.post('/sales-invoices/:id/share-link', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.salesInvoiceController, 'createShareLink')
    );

    // GET /sales-invoices/:id/pdf - Download sales invoice as PDF
    this.router.get('/sales-invoices/:id/pdf', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.salesInvoiceController, 'downloadPDF')
    );

    // DELETE /sales-invoices/:id - Delete a sales invoice
    this.router.delete('/sales-invoices/:id', 
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.salesInvoiceController, 'delete')
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
