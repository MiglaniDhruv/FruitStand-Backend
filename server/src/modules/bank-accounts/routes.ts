import { BaseRouter } from '../../utils/base';
import { BankAccountController } from './controller';
import { authenticateToken, requireRole, validateTenant, attachTenantContext } from '../../middleware/auth';
import { UserRole } from '../../types';
import { asyncHandler } from "../../utils/async-handler";

import { Router } from 'express';

const router = Router();
const controller = new BankAccountController();

router.get('/bank-accounts', controller.getAll.bind(controller));
router.post('/bank-accounts', controller.create.bind(controller));

export default router;

export class BankAccountRouter extends BaseRouter {
  private bankAccountController: BankAccountController;

  constructor() {
    super();
    this.bankAccountController = new BankAccountController();
    this.setupRoutes();
  }

  private setupRoutes() {
    // GET /bank-accounts - List bank accounts with pagination support
    this.router.get('/bank-accounts', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.bankAccountController, 'getAll')
    );

    // GET /bank-accounts/:id - Get bank account by ID
    this.router.get('/bank-accounts/:id', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.bankAccountController, 'getById')
    );

    // POST /bank-accounts - Create new bank account
    this.router.post('/bank-accounts', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requireRole([UserRole.ADMIN, UserRole.OPERATOR])),
      this.ah(this.bankAccountController, 'create')
    );

    // PUT /bank-accounts/:id - Update bank account
    this.router.put('/bank-accounts/:id', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requireRole([UserRole.ADMIN, UserRole.OPERATOR])),
      this.ah(this.bankAccountController, 'update')
    );

    // DELETE /bank-accounts/:id - Delete bank account (Admin only)
    this.router.delete('/bank-accounts/:id', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requireRole([UserRole.ADMIN])),
      this.ah(this.bankAccountController, 'delete')
    );

    // POST /bank-accounts/:id/deposit - Record bank deposit (Admin/Operator only)
    this.router.post('/bank-accounts/:id/deposit', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requireRole([UserRole.ADMIN, UserRole.OPERATOR])),
      this.ah(this.bankAccountController, 'deposit')
    );

    // POST /bank-accounts/:id/withdrawal - Record bank withdrawal (Admin/Operator only)
    this.router.post('/bank-accounts/:id/withdrawal', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requireRole([UserRole.ADMIN, UserRole.OPERATOR])),
      this.ah(this.bankAccountController, 'withdrawal')
    );

    // DELETE /bank-accounts/:id/transactions/:transactionId - Delete manual transaction (Admin/Operator only)
    this.router.delete('/bank-accounts/:id/transactions/:transactionId', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requireRole([UserRole.ADMIN, UserRole.OPERATOR])),
      this.ah(this.bankAccountController, 'deleteTransaction')
    );
  }
}
