import { BaseRouter } from '../../utils/base';
import { ReportController } from './controller';
import { authenticateToken, validateTenant, attachTenantContext } from '../../middleware/auth';
import { asyncHandler } from "../../utils/async-handler";

export class ReportRouter extends BaseRouter {
  private reportController: ReportController;

  constructor() {
    super();
    this.reportController = new ReportController();
    this.setupRoutes();
  }

  private setupRoutes() {
    // GET /reports/turnover - Turnover report with date range query params
    this.router.get('/reports/turnover', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.reportController, 'getTurnoverReport')
    );

    // GET /reports/profit-loss - P&L report with date range query params
    this.router.get('/reports/profit-loss', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.reportController, 'getProfitLossReport')
    );

    // GET /reports/commission - Commission report with date range query params
    this.router.get('/reports/commission', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.reportController, 'getCommissionReport')
    );

    // GET /reports/shortfall - Shortfall report with date range query params
    this.router.get('/reports/shortfall', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.reportController, 'getShortfallReport')
    );

    // GET /reports/expenses - Expenses summary with date range query params
    this.router.get('/reports/expenses', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.reportController, 'getExpensesSummary')
    );

    // GET /reports/vendors - Vendors list with amount payable
    this.router.get('/reports/vendors', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.reportController, 'getVendorsList')
    );

    // GET /reports/retailers - Retailers list with amount receivable
    this.router.get('/reports/retailers', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      this.ah(this.reportController, 'getRetailersList')
    );

    // PDF Downloads
    this.router.get('/reports/turnover/pdf', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(this.reportController.downloadTurnoverReportPdf.bind(this.reportController))
    );

    this.router.get('/reports/profit-loss/pdf', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(this.reportController.downloadProfitLossReportPdf.bind(this.reportController))
    );

    this.router.get('/reports/commission/pdf', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(this.reportController.downloadCommissionReportPdf.bind(this.reportController))
    );

    // Excel Downloads
    this.router.get('/reports/turnover/excel', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(this.reportController.downloadTurnoverReportExcel.bind(this.reportController))
    );

    this.router.get('/reports/profit-loss/excel', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(this.reportController.downloadProfitLossReportExcel.bind(this.reportController))
    );

    this.router.get('/reports/commission/excel', 
      authenticateToken, 
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(this.reportController.downloadCommissionReportExcel.bind(this.reportController))
    );

    // Shortfall Report Routes
    this.router.get('/reports/shortfall/pdf',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(this.reportController.downloadShortfallReportPdf.bind(this.reportController))
    );

    this.router.get('/reports/shortfall/excel',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(this.reportController.downloadShortfallReportExcel.bind(this.reportController))
    );

    // Expenses Summary Routes
    this.router.get('/reports/expenses/pdf',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(this.reportController.downloadExpensesSummaryPdf.bind(this.reportController))
    );

    this.router.get('/reports/expenses/excel',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(this.reportController.downloadExpensesSummaryExcel.bind(this.reportController))
    );

    // Vendors List Routes
    this.router.get('/reports/vendors/pdf',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(this.reportController.downloadVendorsListPdf.bind(this.reportController))
    );

    this.router.get('/reports/vendors/excel',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(this.reportController.downloadVendorsListExcel.bind(this.reportController))
    );

    // Retailers List Routes
    this.router.get('/reports/retailers/pdf',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(this.reportController.downloadRetailersListPdf.bind(this.reportController))
    );

    this.router.get('/reports/retailers/excel',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(this.reportController.downloadRetailersListExcel.bind(this.reportController))
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
