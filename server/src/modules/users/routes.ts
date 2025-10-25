import { BaseRouter } from "../../utils/base";
import { UserController } from "./controller";
import { authenticateToken, requirePermission, validateTenant, attachTenantContext } from "../../middleware/auth";
import { asyncHandler } from "../../utils/async-handler";

export class UserRouter extends BaseRouter {
  private userController: UserController;

  constructor() {
    super();
    this.userController = new UserController();
    this.setupRoutes();
  }

  private setupRoutes() {
    // GET /users - List users with pagination support
    this.router.get("/users", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requirePermission(['Admin'])), 
      asyncHandler(this.userController.getAll.bind(this.userController))
    );

    // GET /users/:id - Get user by ID
    this.router.get("/users/:id", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requirePermission(['Admin'])), 
      asyncHandler(this.userController.getById.bind(this.userController))
    );

    // POST /users - Create new user
    this.router.post("/users", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requirePermission(['Admin'])), 
      asyncHandler(this.userController.create.bind(this.userController))
    );

    // PUT /users/:id - Update user
    this.router.put("/users/:id", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requirePermission(['Admin'])), 
      asyncHandler(this.userController.update.bind(this.userController))
    );

    // DELETE /users/:id - Delete user
    this.router.delete("/users/:id", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requirePermission(['Admin'])), 
      asyncHandler(this.userController.delete.bind(this.userController))
    );

    // PUT /users/:id/permissions - Update user permissions
    this.router.put("/users/:id/permissions", 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requirePermission(['Admin'])), 
      asyncHandler(this.userController.updatePermissions.bind(this.userController))
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