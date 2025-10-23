// Export the main Excel generator service
export { ExcelGenerator, excelGenerator } from './excel-generator';

// Export template rendering functions for potential direct use
export { 
  renderTurnoverReportTemplate,
  renderProfitLossReportTemplate,
  renderCommissionReportTemplate,
  renderShortfallReportTemplate,
  renderExpensesSummaryTemplate,
  renderVendorsListTemplate,
  renderRetailersListTemplate
} from './excel-templates';

// Export relevant TypeScript types for report data structures
import schema from '../../../shared/schema.js';

export type TurnoverReportData = typeof schema.TurnoverReportData;
export type ProfitLossReportData = typeof schema.ProfitLossReportData;
export type CommissionReportData = typeof schema.CommissionReportData;
export type ShortfallReportData = typeof schema.ShortfallReportData;
export type ExpensesSummaryData = typeof schema.ExpensesSummaryData;
export type VendorsListData = typeof schema.VendorsListData;
export type RetailersListData = typeof schema.RetailersListData;

// Default export is the service instance
export { excelGenerator as default } from './excel-generator';