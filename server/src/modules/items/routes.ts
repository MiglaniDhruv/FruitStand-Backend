import { BaseRouter } from "../../utils/base";
import { ItemController } from "./controller";
import { authenticateToken, requireRole, validateTenant, attachTenantContext } from "../../middleware/auth";
import { UserRole } from "../../types";
import { asyncHandler } from "../../utils/async-handler";

export class ItemRouter extends BaseRouter {
  private itemController: ItemController;

  constructor() {
    super();
    this.itemController = new ItemController();
    this.setupRoutes();
  }

  private setupRoutes() {
    // GET /items - List items with pagination support
    this.router.get("/items", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.itemController, 'getAll')
    );

    // GET /items/vendor/:vendorId - Get items by vendor
    this.router.get("/items/vendor/:vendorId", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.itemController, 'getByVendor')
    );

    // GET /items/:id - Get item by ID
    this.router.get("/items/:id", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.itemController, 'getById')
    );

    // POST /items - Create new item
    this.router.post("/items", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requireRole([UserRole.ADMIN, UserRole.OPERATOR])), 
      this.ah(this.itemController, 'create')
    );

    // PUT /items/:id - Update item
    this.router.put("/items/:id", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requireRole([UserRole.ADMIN, UserRole.OPERATOR])), 
      this.ah(this.itemController, 'update')
    );

    // DELETE /items/:id - Delete item (Admin only)
    this.router.delete("/items/:id", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requireRole([UserRole.ADMIN])), 
      this.ah(this.itemController, 'delete')
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
