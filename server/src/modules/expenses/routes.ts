import { BaseRouter } from '../../utils/base';
import { ExpenseController } from './controller';
import { authenticateToken, validateTenant, attachTenantContext } from '../../middleware/auth';
import { asyncHandler } from "../../utils/async-handler";

export class ExpenseRouter extends BaseRouter {
  private expenseController: ExpenseController;

  constructor() {
    super();
    this.expenseController = new ExpenseController();
    this.setupRoutes();
  }

  private setupRoutes() {
    // Expense category routes  
    // GET /expense-categories - Get all expense categories
    this.router.get('/expense-categories', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.expenseController, 'getAllCategories')
    );

    // GET /expense-categories/:id - Get a specific expense category
    this.router.get('/expense-categories/:id', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.expenseController, 'getCategoryById')
    );

    // POST /expense-categories - Create a new expense category
    this.router.post('/expense-categories', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.expenseController, 'createCategory')
    );

    // PUT /expense-categories/:id - Update an expense category
    this.router.put('/expense-categories/:id', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.expenseController, 'updateCategory')
    );

    // DELETE /expense-categories/:id - Delete an expense category (soft delete)
    this.router.delete('/expense-categories/:id', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.expenseController, 'deleteCategory')
    );

    // Expense routes
    // GET /expenses - Get all expenses
    this.router.get('/expenses', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.expenseController, 'getAllExpenses')
    );

    // GET /expenses/:id - Get a specific expense
    this.router.get('/expenses/:id', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.expenseController, 'getExpenseById')
    );

    // POST /expenses - Create a new expense
    this.router.post('/expenses', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.expenseController, 'createExpense')
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
