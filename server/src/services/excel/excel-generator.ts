import ExcelJS from 'exceljs';
import schema from '../../../shared/schema.js';

type Tenant = typeof schema.tenants.$inferSelect;
type TurnoverReportData = typeof schema.TurnoverReportData;
type ProfitLossReportData = typeof schema.ProfitLossReportData;
type CommissionReportData = typeof schema.CommissionReportData;
type ShortfallReportData = typeof schema.ShortfallReportData;
type ExpensesSummaryData = typeof schema.ExpensesSummaryData;
type VendorsListData = typeof schema.VendorsListData;
type RetailersListData = typeof schema.RetailersListData;

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
  async generateTurnoverReport(reportData: TurnoverReportData, tenant: Tenant): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    renderTurnoverReportTemplate(workbook, reportData, tenant, reportData.fromDate, reportData.toDate);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async generateProfitLossReport(reportData: ProfitLossReportData, tenant: Tenant): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    renderProfitLossReportTemplate(workbook, reportData, tenant, reportData.fromDate, reportData.toDate);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async generateCommissionReport(reportData: CommissionReportData, tenant: Tenant): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    renderCommissionReportTemplate(workbook, reportData, tenant, reportData.fromDate, reportData.toDate);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async generateShortfallReport(reportData: ShortfallReportData, tenant: Tenant): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    renderShortfallReportTemplate(workbook, reportData, tenant, reportData.fromDate, reportData.toDate);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async generateExpensesSummary(reportData: ExpensesSummaryData, tenant: Tenant): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    renderExpensesSummaryTemplate(workbook, reportData, tenant, reportData.fromDate, reportData.toDate);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async generateVendorsList(reportData: VendorsListData, tenant: Tenant): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    renderVendorsListTemplate(workbook, reportData, tenant);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async generateRetailersList(reportData: RetailersListData, tenant: Tenant): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    renderRetailersListTemplate(workbook, reportData, tenant);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}

// Export singleton instance for easy import
export const excelGenerator = new ExcelGenerator();