import type { Workbook, Worksheet } from 'exceljs';
import schema from '../../../shared/schema.js';

type Tenant = typeof schema.tenants.$inferSelect;
type TurnoverReportData = typeof schema.TurnoverReportData;
type ProfitLossReportData = typeof schema.ProfitLossReportData;
type CommissionReportData = typeof schema.CommissionReportData;
type ShortfallReportData = typeof schema.ShortfallReportData;
type ExpensesSummaryData = typeof schema.ExpensesSummaryData;
type VendorsListData = typeof schema.VendorsListData;
type RetailersListData = typeof schema.RetailersListData;


// Styling constants
const EXCEL_STYLES = {
  header: {
    font: { bold: true, size: 16, color: { argb: 'FF1f2937' } },
    fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFf3f4f6' } },
    border: {
      top: { style: 'thin' as const },
      left: { style: 'thin' as const },
      bottom: { style: 'thin' as const },
      right: { style: 'thin' as const }
    }
  },
  title: {
    font: { bold: true, size: 20, color: { argb: 'FF1f2937' } }
  },
  data: {
    font: { size: 10 },
    border: {
      top: { style: 'thin' as const },
      left: { style: 'thin' as const },
      bottom: { style: 'thin' as const },
      right: { style: 'thin' as const }
    }
  },
  currency: {
    numFmt: '₹#,##0.00'
  },
  date: {
    numFmt: 'dd/mm/yyyy'
  }
};

// Column width constants
const COLUMN_WIDTHS = {
  narrow: 10,
  medium: 15,
  wide: 20,
  extraWide: 25
};

/**
 * Add company header with tenant name and details
 */
export function addHeaderRow(worksheet: Worksheet, tenant: Tenant, reportTitle: string): number {
  let currentRow = 1;

  // Company name
  worksheet.getCell(`A${currentRow}`).value = tenant.name || 'Company Name';
  worksheet.getCell(`A${currentRow}`).style = EXCEL_STYLES.title;
  currentRow += 2;

  // Report title
  worksheet.getCell(`A${currentRow}`).value = reportTitle;
  worksheet.getCell(`A${currentRow}`).style = EXCEL_STYLES.header;
  currentRow += 2;

  return currentRow;
}

/**
 * Add report metadata (date range and generation timestamp)
 */
export function addReportMetadata(worksheet: Worksheet, fromDate?: string, toDate?: string, rowIndex?: number): number {
  let currentRow = rowIndex || 1;

  if (fromDate || toDate) {
    const dateRange = `Date Range: ${fromDate || 'Beginning'} to ${toDate || 'Present'}`;
    worksheet.getCell(`A${currentRow}`).value = dateRange;
    currentRow++;
  }

  const timestamp = `Generated on: ${new Date().toLocaleString()}`;
  worksheet.getCell(`A${currentRow}`).value = timestamp;
  currentRow += 2;

  return currentRow;
}

/**
 * Apply currency formatting to a cell
 */
export function formatCurrencyCell(cell: any, value: number | string): void {
  const num = typeof value === 'string' ? Number(value) : value;
  cell.value = isNaN(num) ? 0 : num;
  cell.numFmt = EXCEL_STYLES.currency.numFmt;
}

/**
 * Apply date formatting to a cell
 */
export function formatDateCell(cell: any, value: Date | string): void {
  cell.value = value;
  cell.numFmt = EXCEL_STYLES.date.numFmt;
}

/**
 * Auto-adjust column widths based on content
 */
export function autoSizeColumns(worksheet: Worksheet): void {
  worksheet.columns.forEach((column: any) => {
    if (column.values) {
      const lengths = column.values.map((v: any) => v ? v.toString().length : 0);
      const maxLength = Math.max(...lengths.filter((v: any) => typeof v === 'number'));
      column.width = Math.min(Math.max(maxLength + 2, COLUMN_WIDTHS.narrow), COLUMN_WIDTHS.extraWide);
    }
  });
}

/**
 * Render turnover report template
 */
export function renderTurnoverReportTemplate(workbook: Workbook, reportData: TurnoverReportData, tenant: Tenant, fromDate?: string, toDate?: string): void {
  const worksheet = workbook.addWorksheet('Turnover Report');
  
  let currentRow = addHeaderRow(worksheet, tenant, 'Turnover Report');
  currentRow = addReportMetadata(worksheet, fromDate, toDate, currentRow);

  // Column headers
  worksheet.getCell(`A${currentRow}`).value = 'Metric';
  worksheet.getCell(`B${currentRow}`).value = 'Amount';
  
  // Apply header styling
  ['A', 'B'].forEach(col => {
    worksheet.getCell(`${col}${currentRow}`).style = EXCEL_STYLES.header;
  });
  
  currentRow++;
  
  // Data rows
  worksheet.getCell(`A${currentRow}`).value = 'Total Sales';
  formatCurrencyCell(worksheet.getCell(`B${currentRow}`), reportData.totalSales || 0);
  currentRow++;
  
  worksheet.getCell(`A${currentRow}`).value = 'Total Purchases';
  formatCurrencyCell(worksheet.getCell(`B${currentRow}`), reportData.totalPurchases || 0);
  currentRow++;
  
  // Total row with styling
  worksheet.getCell(`A${currentRow}`).value = 'Net Turnover';
  worksheet.getCell(`A${currentRow}`).style = EXCEL_STYLES.header;
  formatCurrencyCell(worksheet.getCell(`B${currentRow}`), reportData.netTurnover || 0);
  worksheet.getCell(`B${currentRow}`).style = EXCEL_STYLES.header;
  
  autoSizeColumns(worksheet);
}

/**
 * Render profit & loss report template
 */
export function renderProfitLossReportTemplate(workbook: Workbook, reportData: ProfitLossReportData, tenant: Tenant, fromDate?: string, toDate?: string): void {
  const worksheet = workbook.addWorksheet('Profit & Loss');
  
  let currentRow = addHeaderRow(worksheet, tenant, 'Profit & Loss Report');
  currentRow = addReportMetadata(worksheet, fromDate, toDate, currentRow);

  // Revenue section
  worksheet.getCell(`A${currentRow}`).value = 'REVENUE';
  worksheet.getCell(`A${currentRow}`).style = EXCEL_STYLES.header;
  currentRow++;
  
  worksheet.getCell(`A${currentRow}`).value = 'Total Revenue';
  formatCurrencyCell(worksheet.getCell(`B${currentRow}`), reportData.revenue || 0);
  currentRow += 2;
  
  // Costs section
  worksheet.getCell(`A${currentRow}`).value = 'COSTS';
  worksheet.getCell(`A${currentRow}`).style = EXCEL_STYLES.header;
  currentRow++;
  
  worksheet.getCell(`A${currentRow}`).value = 'Total Costs';
  formatCurrencyCell(worksheet.getCell(`B${currentRow}`), reportData.costs || 0);
  currentRow += 2;
  
  // Gross profit
  worksheet.getCell(`A${currentRow}`).value = 'Gross Profit';
  formatCurrencyCell(worksheet.getCell(`B${currentRow}`), reportData.grossProfit || 0);
  currentRow += 2;
  
  // Expenses section
  worksheet.getCell(`A${currentRow}`).value = 'EXPENSES';
  worksheet.getCell(`A${currentRow}`).style = EXCEL_STYLES.header;
  currentRow++;
  
  worksheet.getCell(`A${currentRow}`).value = 'Total Expenses';
  formatCurrencyCell(worksheet.getCell(`B${currentRow}`), reportData.expenses || 0);
  currentRow += 2;
  
  // Net profit
  worksheet.getCell(`A${currentRow}`).value = 'NET PROFIT';
  worksheet.getCell(`A${currentRow}`).style = EXCEL_STYLES.header;
  formatCurrencyCell(worksheet.getCell(`B${currentRow}`), reportData.netProfit || 0);
  worksheet.getCell(`B${currentRow}`).style = EXCEL_STYLES.header;
  
  autoSizeColumns(worksheet);
}

/**
 * Render commission report template
 */
export function renderCommissionReportTemplate(workbook: Workbook, reportData: CommissionReportData, tenant: Tenant, fromDate?: string, toDate?: string): void {
  const worksheet = workbook.addWorksheet('Commission Report');
  
  let currentRow = addHeaderRow(worksheet, tenant, 'Commission Report');
  currentRow = addReportMetadata(worksheet, fromDate, toDate, currentRow);

  // Column headers
  worksheet.getCell(`A${currentRow}`).value = 'Invoice No.';
  worksheet.getCell(`B${currentRow}`).value = 'Date';
  worksheet.getCell(`C${currentRow}`).value = 'Vendor';
  worksheet.getCell(`D${currentRow}`).value = 'Amount';
  worksheet.getCell(`E${currentRow}`).value = 'Rate';
  worksheet.getCell(`F${currentRow}`).value = 'Commission';
  
  // Apply header styling
  ['A', 'B', 'C', 'D', 'E', 'F'].forEach(col => {
    worksheet.getCell(`${col}${currentRow}`).style = EXCEL_STYLES.header;
  });
  
  currentRow++;
  
  // Data rows - using the entries format from shared schema
  if (reportData.entries && Array.isArray(reportData.entries)) {
    reportData.entries.forEach((entry) => {
      worksheet.getCell(`A${currentRow}`).value = entry.invoiceNumber || '';
      const dateVal = entry.invoiceDate ? new Date(entry.invoiceDate) : '';
      formatDateCell(worksheet.getCell(`B${currentRow}`), dateVal);
      worksheet.getCell(`C${currentRow}`).value = entry.vendorName || '';
      formatCurrencyCell(worksheet.getCell(`D${currentRow}`), entry.totalAmount || 0);
      worksheet.getCell(`E${currentRow}`).value = `${entry.commissionRate || 0}%`;
      formatCurrencyCell(worksheet.getCell(`F${currentRow}`), entry.commissionAmount || 0);
      currentRow++;
    });
  }
  
  // Total row
  currentRow++;
  worksheet.getCell(`A${currentRow}`).value = 'TOTAL COMMISSION';
  worksheet.getCell(`A${currentRow}`).style = EXCEL_STYLES.header;
  formatCurrencyCell(worksheet.getCell(`F${currentRow}`), reportData.totalCommission || 0);
  worksheet.getCell(`F${currentRow}`).style = EXCEL_STYLES.header;
  
  autoSizeColumns(worksheet);
}

/**
 * Render shortfall report template
 */
export function renderShortfallReportTemplate(workbook: Workbook, reportData: ShortfallReportData, tenant: Tenant, fromDate?: string, toDate?: string): void {
  const worksheet = workbook.addWorksheet('Shortfall Report');
  
  let currentRow = addHeaderRow(worksheet, tenant, 'Shortfall Report');
  currentRow = addReportMetadata(worksheet, fromDate, toDate, currentRow);

  // Column headers
  worksheet.getCell(`A${currentRow}`).value = 'Retailer Name';
  worksheet.getCell(`B${currentRow}`).value = 'Shortfall Balance';
  worksheet.getCell(`C${currentRow}`).value = 'Last Transaction';
  
  // Apply header styling
  ['A', 'B', 'C'].forEach(col => {
    worksheet.getCell(`${col}${currentRow}`).style = EXCEL_STYLES.header;
  });
  
  currentRow++;

  // Add data rows
  reportData.entries?.forEach((entry) => {
    worksheet.getCell(`A${currentRow}`).value = entry.retailerName;
    formatCurrencyCell(worksheet.getCell(`B${currentRow}`), entry.shortfallBalance);
    
    const dateVal = entry.lastTransactionDate ? new Date(entry.lastTransactionDate) : '';
    if (dateVal) {
      formatDateCell(worksheet.getCell(`C${currentRow}`), dateVal);
    } else {
      worksheet.getCell(`C${currentRow}`).value = '-';
    }
    
    // Apply data styling
    ['A', 'B', 'C'].forEach(col => {
      worksheet.getCell(`${col}${currentRow}`).style = EXCEL_STYLES.data;
    });
    
    currentRow++;
  });

  // Add blank row
  currentRow++;

  // Add totals row
  worksheet.getCell(`A${currentRow}`).value = 'Total Shortfall';
  worksheet.getCell(`A${currentRow}`).style = EXCEL_STYLES.header;
  formatCurrencyCell(worksheet.getCell(`B${currentRow}`), reportData.totalShortfall);
  worksheet.getCell(`B${currentRow}`).style = EXCEL_STYLES.header;
  
  autoSizeColumns(worksheet);
}

/**
 * Render expenses summary template
 */
export function renderExpensesSummaryTemplate(workbook: Workbook, reportData: ExpensesSummaryData, tenant: Tenant, fromDate?: string, toDate?: string): void {
  const worksheet = workbook.addWorksheet('Expenses Summary');
  
  let currentRow = addHeaderRow(worksheet, tenant, 'Expenses Summary');
  currentRow = addReportMetadata(worksheet, fromDate, toDate, currentRow);

  // Column headers
  worksheet.getCell(`A${currentRow}`).value = 'Category';
  worksheet.getCell(`B${currentRow}`).value = 'Amount';
  worksheet.getCell(`C${currentRow}`).value = 'Count';
  worksheet.getCell(`D${currentRow}`).value = 'Percentage';
  
  // Apply header styling
  ['A', 'B', 'C', 'D'].forEach(col => {
    worksheet.getCell(`${col}${currentRow}`).style = EXCEL_STYLES.header;
  });
  
  currentRow++;

  // Add data rows
  reportData.entries?.forEach((entry) => {
    worksheet.getCell(`A${currentRow}`).value = entry.category;
    formatCurrencyCell(worksheet.getCell(`B${currentRow}`), entry.amount);
    worksheet.getCell(`C${currentRow}`).value = entry.count;
    worksheet.getCell(`D${currentRow}`).value = entry.percentage + '%';
    
    // Apply data styling
    ['A', 'B', 'C', 'D'].forEach(col => {
      worksheet.getCell(`${col}${currentRow}`).style = EXCEL_STYLES.data;
    });
    
    currentRow++;
  });

  // Add blank row
  currentRow++;

  // Add totals row
  worksheet.getCell(`A${currentRow}`).value = 'Total Expenses';
  worksheet.getCell(`A${currentRow}`).style = EXCEL_STYLES.header;
  formatCurrencyCell(worksheet.getCell(`B${currentRow}`), reportData.totalExpenses);
  worksheet.getCell(`B${currentRow}`).style = EXCEL_STYLES.header;
  
  autoSizeColumns(worksheet);
}

/**
 * Render vendors list template
 */
export function renderVendorsListTemplate(workbook: Workbook, reportData: VendorsListData, tenant: Tenant): void {
  const worksheet = workbook.addWorksheet('Vendors List');
  
  let currentRow = addHeaderRow(worksheet, tenant, 'Vendors List');
  currentRow = addReportMetadata(worksheet, undefined, undefined, currentRow);

  // Column headers
  worksheet.getCell(`A${currentRow}`).value = 'Vendor Name';
  worksheet.getCell(`B${currentRow}`).value = 'Phone';
  worksheet.getCell(`C${currentRow}`).value = 'Address';
  worksheet.getCell(`D${currentRow}`).value = 'Amount Payable';
  
  // Apply header styling
  ['A', 'B', 'C', 'D'].forEach(col => {
    worksheet.getCell(`${col}${currentRow}`).style = EXCEL_STYLES.header;
  });
  
  currentRow++;

  // Add data rows
  reportData.entries?.forEach((entry) => {
    worksheet.getCell(`A${currentRow}`).value = entry.vendorName;
    worksheet.getCell(`B${currentRow}`).value = entry.phone || '-';
    worksheet.getCell(`C${currentRow}`).value = entry.address || '-';
    formatCurrencyCell(worksheet.getCell(`D${currentRow}`), entry.balance);
    
    // Apply data styling
    ['A', 'B', 'C', 'D'].forEach(col => {
      worksheet.getCell(`${col}${currentRow}`).style = EXCEL_STYLES.data;
    });
    
    currentRow++;
  });

  // Add blank row
  currentRow++;

  // Add totals row
  worksheet.getCell(`C${currentRow}`).value = 'Total Payable';
  worksheet.getCell(`C${currentRow}`).style = EXCEL_STYLES.header;
  worksheet.getCell(`C${currentRow}`).alignment = { horizontal: 'right' };
  formatCurrencyCell(worksheet.getCell(`D${currentRow}`), reportData.totalPayable);
  worksheet.getCell(`D${currentRow}`).style = EXCEL_STYLES.header;
  
  autoSizeColumns(worksheet);
}

/**
 * Render retailers list template
 */
export function renderRetailersListTemplate(workbook: Workbook, reportData: RetailersListData, tenant: Tenant): void {
  const worksheet = workbook.addWorksheet('Retailers List');
  
  let currentRow = addHeaderRow(worksheet, tenant, 'Retailers List');
  currentRow = addReportMetadata(worksheet, undefined, undefined, currentRow);

  // Column headers
  worksheet.getCell(`A${currentRow}`).value = 'Retailer Name';
  worksheet.getCell(`B${currentRow}`).value = 'Phone';
  worksheet.getCell(`C${currentRow}`).value = 'Address';
  worksheet.getCell(`D${currentRow}`).value = 'Amount Receivable';
  
  // Apply header styling
  ['A', 'B', 'C', 'D'].forEach(col => {
    worksheet.getCell(`${col}${currentRow}`).style = EXCEL_STYLES.header;
  });
  
  currentRow++;

  // Add data rows
  reportData.entries?.forEach((entry) => {
    worksheet.getCell(`A${currentRow}`).value = entry.retailerName;
    worksheet.getCell(`B${currentRow}`).value = entry.phone || '-';
    worksheet.getCell(`C${currentRow}`).value = entry.address || '-';
    formatCurrencyCell(worksheet.getCell(`D${currentRow}`), entry.udhaaarBalance);
    
    // Apply data styling
    ['A', 'B', 'C', 'D'].forEach(col => {
      worksheet.getCell(`${col}${currentRow}`).style = EXCEL_STYLES.data;
    });
    
    currentRow++;
  });

  // Add blank row
  currentRow++;

  // Add totals row
  worksheet.getCell(`C${currentRow}`).value = 'Total Receivable';
  worksheet.getCell(`C${currentRow}`).style = EXCEL_STYLES.header;
  worksheet.getCell(`C${currentRow}`).alignment = { horizontal: 'right' };
  formatCurrencyCell(worksheet.getCell(`D${currentRow}`), reportData.totalReceivable);
  worksheet.getCell(`D${currentRow}`).style = EXCEL_STYLES.header;
  
  autoSizeColumns(worksheet);
}