import { BaseRouter } from '../../utils/base';
import { LedgerController } from './controller';
import { authenticateToken, validateTenant, attachTenantContext } from '../../middleware/auth';
import { asyncHandler } from "../../utils/async-handler";
import { Request, Response, NextFunction } from 'express';

export class LedgerRouter extends BaseRouter {
  private ledgerController: LedgerController;

  constructor() {
    super();
    this.ledgerController = new LedgerController();
    this.setupRoutes();
  }

  /**
   * Legacy route wrapper middleware
   * Maps path parameter vendorId to query parameter for backward compatibility
   * @deprecated Use query parameter instead. This route will be removed in a future version.
   */
  private mapVendorIdParamToQuery(req: Request, res: Response, next: NextFunction) {
    if (req.params.vendorId) {
      req.query.vendorId = req.params.vendorId;
    }
    next();
  }

  /**
   * Legacy route wrapper middleware for retailer ledger
   * Maps path parameter retailerId to query parameter for backward compatibility
   * @deprecated Use query parameter instead. This route will be removed in a future version.
   */
  private mapRetailerIdParamToQuery(req: Request, res: Response, next: NextFunction) {
    if (req.params.retailerId) {
      req.query.retailerId = req.params.retailerId;
    }
    next();
  }

  private setupRoutes() {
    // GET /ledger/vendor - Get vendor ledger (NEW - recommended)
    this.router.get('/ledger/vendor', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.ledgerController, 'getVendorLedger')
    );

    // GET /ledger/vendor/:vendorId - Get vendor ledger (LEGACY - deprecated)
    // @deprecated Use GET /ledger/vendor?vendorId=xxx instead. This route will be removed in v2.0.
    // Migration timeline: Deprecation notice added 2025-01, removal scheduled for 2025-06.
    this.router.get('/ledger/vendor/:vendorId', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.mapVendorIdParamToQuery.bind(this),
      this.ah(this.ledgerController, 'getVendorLedger')
    );

    // GET /cashbook - Get cashbook entries
    this.router.get('/cashbook', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.ledgerController, 'getCashbook')
    );

    // GET /bankbook - Get bankbook entries (with optional bankAccountId filter)
    this.router.get('/bankbook', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.ledgerController, 'getBankbook')
    );

    // GET /ledgers/retailer - Get retailer ledger (NEW - recommended)
    this.router.get('/ledgers/retailer', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.ledgerController, 'getRetailerLedger')
    );

    // GET /ledgers/retailer/:retailerId - Get retailer ledger (LEGACY - deprecated)
    // @deprecated Use GET /ledgers/retailer?retailerId=xxx instead. This route will be removed in v2.0.
    // Migration timeline: Deprecation notice added 2025-01, removal scheduled for 2025-06.
    this.router.get('/ledgers/retailer/:retailerId', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.mapRetailerIdParamToQuery.bind(this),
      this.ah(this.ledgerController, 'getRetailerLedger')
    );

    // GET /ledgers/udhaar - Get udhaar book
    this.router.get('/ledgers/udhaar', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.ledgerController, 'getUdhaaarBook')
    );

    // GET /ledgers/kpi - Get KPI data (cash and bank balances)
    this.router.get('/ledgers/kpi', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.ledgerController, 'getKpi')
    );

    // GET /ledgers/crates - Get crate ledger (with optional retailerId filter)
    this.router.get('/ledgers/crates', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.ledgerController, 'getCrateLedger')
    );

    // GET /ledgers/cashbook/status - Get cashbook status
    this.router.get('/ledgers/cashbook/status', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.ledgerController, 'getCashbookStatus')
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
