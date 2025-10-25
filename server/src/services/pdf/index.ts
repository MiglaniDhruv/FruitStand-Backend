// Export the main invoice generator service
export { InvoiceGenerator, invoiceGenerator } from './invoice-generator';

// Export template rendering functions for potential direct use
export { 
  renderSalesInvoiceTemplate,
  renderPurchaseInvoiceTemplate,
  renderTurnoverReportTemplate,
  renderProfitLossReportTemplate,
  renderCommissionReportTemplate,
  renderShortfallReportTemplate,
  renderExpensesSummaryTemplate,
  renderVendorsListTemplate,
  renderRetailersListTemplate,
  drawHeader,
  drawInvoiceDetails,
  drawPartyDetails,
  drawItemsTable,
  drawFinancialSummary,
  drawPaymentHistory,
  drawFooter,
  type PurchaseInvoiceWithPayments,
  type SalesInvoiceWithDetails
} from './pdf-templates';

// Default export is the service instance
export { invoiceGenerator as default } from './invoice-generator';

