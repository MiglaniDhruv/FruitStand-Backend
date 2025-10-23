import ExcelJS from 'exceljs';
import schema from '../../../shared/schema.js';

type Tenant = typeof schema.tenants.$inferSelect;
type TurnoverReportData = schema.TurnoverReportData;
type ProfitLossReportData = schema.ProfitLossReportData;
type CommissionReportData = schema.CommissionReportData;
type ShortfallReportData = schema.ShortfallReportData;
type ExpensesSummaryData = schema.ExpensesSummaryData;
type VendorsListData = schema.VendorsListData;
type RetailersListData = schema.RetailersListData;

import {
  renderTurnoverReportTemplate,
  renderProfitLossReportTemplate,
  renderCommissionReportTemplate,
  renderShortfallReportTemplate,
  renderExpensesSummaryTemplate,
  renderVendorsListTemplate,
  renderRetailersListTemplate
} from './excel-templates';

export class ExcelGenerator {
  private async generateReport<T>(
    renderFn: (workbook: ExcelJS.Workbook, data: T, tenant: Tenant, fromDate?: string, toDate?: string) => void,
    reportData: T,
    tenant: Tenant,
    fromDate?: string,
    toDate?: string
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    renderFn(workbook, reportData, tenant, fromDate, toDate);
    return await workbook.xlsx.writeBuffer();
  }

  generateTurnoverReport(reportData: TurnoverReportData, tenant: Tenant): Promise<Buffer> {
    return this.generateReport(renderTurnoverReportTemplate, reportData, tenant, reportData.fromDate, reportData.toDate);
  }

  generateProfitLossReport(reportData: ProfitLossReportData, tenant: Tenant): Promise<Buffer> {
    return this.generateReport(renderProfitLossReportTemplate, reportData, tenant, reportData.fromDate, reportData.toDate);
  }

  generateCommissionReport(reportData: CommissionReportData, tenant: Tenant): Promise<Buffer> {
    return this.generateReport(renderCommissionReportTemplate, reportData, tenant, reportData.fromDate, reportData.toDate);
  }

  generateShortfallReport(reportData: ShortfallReportData, tenant: Tenant): Promise<Buffer> {
    return this.generateReport(renderShortfallReportTemplate, reportData, tenant, reportData.fromDate, reportData.toDate);
  }

  generateExpensesSummary(reportData: ExpensesSummaryData, tenant: Tenant): Promise<Buffer> {
    return this.generateReport(renderExpensesSummaryTemplate, reportData, tenant, reportData.fromDate, reportData.toDate);
  }

  generateVendorsList(reportData: VendorsListData, tenant: Tenant): Promise<Buffer> {
    return this.generateReport(renderVendorsListTemplate, reportData, tenant);
  }

  generateRetailersList(reportData: RetailersListData, tenant: Tenant): Promise<Buffer> {
    return this.generateReport(renderRetailersListTemplate, reportData, tenant);
  }
}

// Export singleton instance for easy import
export const excelGenerator = new ExcelGenerator();
