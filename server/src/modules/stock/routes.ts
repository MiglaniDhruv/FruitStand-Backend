import { BaseRouter } from "../../utils/base";
import { StockController } from "./controller";
import { authenticateToken, requireRole, validateTenant, attachTenantContext } from "../../middleware/auth";
import { UserRole } from "../../types";
import { asyncHandler } from "../../utils/async-handler";

export class StockRouter extends BaseRouter {
  private stockController: StockController;

  constructor() {
    super();
    this.stockController = new StockController();
    this.setupRoutes();
  }

  private setupRoutes() {
    // GET /stock - List stock with pagination and filtering support
    this.router.get("/stock", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.stockController, 'getAll')
    );

    // PUT /stock/:itemId - Update stock
    this.router.put("/stock/:itemId", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requireRole([UserRole.ADMIN, UserRole.OPERATOR])), 
      this.ah(this.stockController, 'updateStock')
    );

    // GET /stock-movements - List stock movements
    this.router.get("/stock-movements", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.stockController, 'getMovements')
    );

    // GET /stock-movements/item/:itemId - Get stock movements by item
    this.router.get("/stock-movements/item/:itemId", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.stockController, 'getMovementsByItem')
    );

    // GET /stock-movements/vendor/:vendorId/available - Get available stock out entries by vendor
    this.router.get("/stock-movements/vendor/:vendorId/available", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.stockController, 'getAvailableOutEntriesByVendor')
    );

    // POST /stock-movements - Create stock movement
    this.router.post("/stock-movements", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requireRole([UserRole.ADMIN, UserRole.OPERATOR])), 
      this.ah(this.stockController, 'createMovement')
    );

    // GET /stock/balance/:itemId - Calculate stock balance
    this.router.get("/stock/balance/:itemId", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.stockController, 'calculateBalance')
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
