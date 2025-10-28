import { db } from './db';
import { sql } from 'drizzle-orm';
import schema from './shared/schema';

const { 
  tenants, 
  users, 
  vendors, 
  items, 
  bankAccounts, 
  retailers, 
  expenseCategories,
  purchaseInvoices,
  invoiceItems,
  payments,
  stock,
  stockMovements,
  salesInvoices,
  salesInvoiceItems,
  salesPayments,
  crateTransactions,
  expenses,
  cashbook,
  bankbook
} = schema;

import { ROLE_PERMISSIONS } from "./shared/permissions";
import { ensureTenantInsert, withTenant } from './src/utils/tenant-scope';
import { LedgerModel } from './src/modules/ledgers/model';
import bcrypt from 'bcrypt';

// Tenant configurations
const TENANT_CONFIGS = [
  {
    slug: 'mumbai-fruits',
    name: 'Mumbai Fruit Market',
    description: 'Established fruit trading business in Mumbai APMC',
    scenario: 'established',
    settings: {
      companyName: 'Mumbai Fruit Market Pvt Ltd',
      address: 'Shop 45, Mumbai APMC Market, Vashi, Navi Mumbai - 400703',
      phone: '+91-9876543210',
      email: 'info@mumbaifruits.com',
      commissionRate: '8.5',
      currency: 'INR',
      dateFormat: 'DD/MM/YYYY',
      cashBalance: '75000.00',
      notifications: {
        emailNotifications: true,
        smsNotifications: true,
        lowStockAlerts: true,
        paymentReminders: true
      },
      backup: {
        autoBackup: true,
        backupFrequency: 'daily',
        retentionDays: 30
      },
      business: {
        crateDepositRate: 50,
        defaultPaymentTerms: 7,
        defaultCommissionRate: 8.5
      },
      whatsapp: {
        enabled: false,
        creditBalance: 500,
        lowCreditThreshold: 100,
        scheduler: {
          enabled: true,
          preferredSendHour: 9, // 9 AM
          reminderFrequency: 'daily', // Send reminders every day
          sendOnWeekends: true,
        },
        defaultTemplates: {
          paymentReminder: 'Dear {vendorName}, your payment of ₹{amount} for invoice {invoiceNumber} is due. Please clear the dues at the earliest.',
          invoiceNotification: 'Dear {vendorName}, invoice {invoiceNumber} for ₹{amount} has been generated. Please review and confirm.',
          welcomeMessage: 'Welcome to Mumbai Fruit Market! We are pleased to work with you.'
        }
      }
    }
  },
  {
    slug: 'pune-fresh',
    name: 'Pune Fresh Produce',
    description: 'Growing fresh produce distributor in Pune market',
    scenario: 'growing',
    settings: {
      companyName: 'Pune Fresh Produce Co',
      address: 'Unit 12, Pune Agricultural Market, Market Yard, Pune - 411037',
      phone: '+91-9876543211',
      email: 'contact@punefresh.com',
      commissionRate: '7.0',
      currency: 'INR',
      dateFormat: 'DD/MM/YYYY',
      cashBalance: '35000.00',
      notifications: {
        emailNotifications: true,
        smsNotifications: false,
        lowStockAlerts: true,
        paymentReminders: true
      },
      backup: {
        autoBackup: true,
        backupFrequency: 'weekly',
        retentionDays: 15
      },
      business: {
        crateDepositRate: 40,
        defaultPaymentTerms: 15,
        defaultCommissionRate: 7.0
      },
      whatsapp: {
        enabled: false,
        creditBalance: 200,
        lowCreditThreshold: 50,
        scheduler: {
          enabled: true,
          preferredSendHour: 10, // 10 AM
          reminderFrequency: 'weekly', // Send reminders once per week (Mondays)
          sendOnWeekends: false, // Don't send on weekends
        },
        defaultTemplates: {
          paymentReminder: 'Hi {vendorName}, gentle reminder about payment of ₹{amount} for invoice {invoiceNumber}. Thank you!',
          invoiceNotification: 'New invoice {invoiceNumber} for ₹{amount} has been generated. Please check your account.',
          welcomeMessage: 'Welcome to Pune Fresh Produce! Looking forward to a great partnership.'
        }
      }
    }
  },
  {
    slug: 'nashik-organic',
    name: 'Nashik Organic Hub',
    description: 'Premium organic produce supplier in Nashik region',
    scenario: 'new',
    settings: {
      companyName: 'Nashik Organic Hub LLP',
      address: 'Plot 8, Nashik Organic Market, Nashik - 422003',
      phone: '+91-9876543212',
      email: 'hello@nashikorganic.com',
      commissionRate: '10.0',
      currency: 'INR',
      dateFormat: 'DD/MM/YYYY',
      cashBalance: '10000.00',
      notifications: {
        emailNotifications: true,
        smsNotifications: true,
        lowStockAlerts: false,
        paymentReminders: false
      },
      backup: {
        autoBackup: false,
        backupFrequency: 'weekly',
        retentionDays: 7
      },
      business: {
        crateDepositRate: 60,
        defaultPaymentTerms: 30,
        defaultCommissionRate: 10.0
      },
      whatsapp: {
        enabled: false,
        creditBalance: 100,
        lowCreditThreshold: 25,
        scheduler: {
          enabled: false, // Disabled by default for new tenant
          preferredSendHour: 14, // 2 PM
          reminderFrequency: 'monthly', // Send reminders once per month (1st of month)
          sendOnWeekends: true,
        },
        defaultTemplates: {
          paymentReminder: 'Dear Partner, payment of ₹{amount} for invoice {invoiceNumber} is pending. Kindly settle at earliest.',
          invoiceNotification: 'Invoice {invoiceNumber} of ₹{amount} generated for your account. Please review.',
          welcomeMessage: 'Welcome to Nashik Organic Hub! Excited to provide you with premium organic produce.'
        }
      }
    }
  }
];

// User configurations for each tenant
const USER_CONFIGS = [
  { role: 'Admin', email: 'admin@{domain}', name: 'Admin User', permissions: ROLE_PERMISSIONS.Admin },
  { role: 'Operator', email: 'operator@{domain}', name: 'Operations Manager', permissions: ROLE_PERMISSIONS.Operator },
  { role: 'Accountant', email: 'accounts@{domain}', name: 'Account Manager', permissions: ROLE_PERMISSIONS.Accountant }
];

// Sample vendor data templates
const VENDOR_TEMPLATES = [
  { name: 'Green Valley Farms', specialty: 'Seasonal Fruits', phone: '+91-9876501001' },
  { name: 'Fresh Harvest Co', specialty: 'Citrus Fruits', phone: '+91-9876501002' },
  { name: 'Organic Growers Ltd', specialty: 'Organic Produce', phone: '+91-9876501003' },
  { name: 'Mountain Fresh Supplies', specialty: 'Apples & Pears', phone: '+91-9876501004' },
  { name: 'Tropical Fruit Traders', specialty: 'Exotic Fruits', phone: '+91-9876501005' }
];

// Sample item data templates
const ITEM_TEMPLATES = [
  { name: 'Apple - Shimla', category: 'Fruits', unit: 'KG', quality: 'Premium' },
  { name: 'Orange - Nagpur', category: 'Fruits', unit: 'KG', quality: 'Standard' },
  { name: 'Banana - Robusta', category: 'Fruits', unit: 'Dozen', quality: 'Premium' },
  { name: 'Mango - Alphonso', category: 'Fruits', unit: 'KG', quality: 'Premium' },
  { name: 'Grapes - Green', category: 'Fruits', unit: 'KG', quality: 'Standard' },
  { name: 'Pomegranate', category: 'Fruits', unit: 'KG', quality: 'Premium' },
  { name: 'Watermelon', category: 'Fruits', unit: 'KG', quality: 'Standard' },
  { name: 'Pineapple', category: 'Fruits', unit: 'Piece', quality: 'Standard' }
];

// Sample retailer templates
const RETAILER_TEMPLATES = [
  { name: 'City Fresh Mart', type: 'Supermarket', creditLimit: 50000 },
  { name: 'Local Fruit Shop', type: 'Retail', creditLimit: 15000 },
  { name: 'Wholesale Distributors', type: 'Wholesale', creditLimit: 100000 },
  { name: 'Organic Store Chain', type: 'Premium', creditLimit: 75000 }
];

// Expense categories
const EXPENSE_CATEGORIES = [
  'Transportation',
  'Labour Charges',
  'Market Fees',
  'Storage Rent',
  'Office Expenses',
  'Utilities',
  'Insurance',
  'Maintenance'
];

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

async function createTenant(config: typeof TENANT_CONFIGS[0]) {
  console.log(`Creating tenant: ${config.name}`);
  
  // Insert tenant
  const [tenant] = await db.insert(tenants).values({
    name: config.name,
    slug: config.slug,
    settings: config.settings,
    isActive: true
  }).returning({ id: tenants.id });

  // Create cashbook opening entry if cashBalance is set
  if (config.settings.cashBalance) {
    const cashBalance = parseFloat(config.settings.cashBalance);
    if (cashBalance > 0) {
      console.log(`   Creating cashbook opening entry: ${config.settings.cashBalance}`);
      await LedgerModel.initializeCashbook(tenant.id, cashBalance);
    }
  }

  return tenant.id;
}

async function createTenantUsers(tenantId: string, config: typeof TENANT_CONFIGS[0]) {
  console.log(`Creating users for tenant: ${config.name}`);
  
  const domain = config.slug.replace('-', '') + '.com';
  const createdUsers = [];
  
  for (const userConfig of USER_CONFIGS) {
    const username = userConfig.email.replace('{domain}', domain);
    const hashedPassword = await hashPassword('password123');
    
    const [user] = await db.insert(users).values(
      ensureTenantInsert({
        tenantId,
        username,
        name: userConfig.name,
        password: hashedPassword,
        role: userConfig.role,
        permissions: [...userConfig.permissions],
        isActive: true
      }, tenantId)
    ).returning({ id: users.id, username: users.username, role: users.role });
    
    createdUsers.push(user);
  }
  
  return createdUsers;
}

// async function createTenantVendors(tenantId: string, scenario: string) {
//   console.log(`Creating vendors for tenant scenario: ${scenario}`);
  
//   const vendorCount = scenario === 'established' ? 5 : scenario === 'growing' ? 3 : 2;
//   const vendorData = VENDOR_TEMPLATES.slice(0, vendorCount);
//   const createdVendors = [];
  
//   for (let i = 0; i < vendorData.length; i++) {
//     const vendor = vendorData[i];
//     const balance = scenario === 'established' ? 
//       Math.random() * 50000 - 25000 : // Can have positive or negative balance
//       scenario === 'growing' ? 
//       Math.random() * 30000 - 10000 : // Mostly positive, some negative
//       Math.random() * 5000; // Small positive balances for new business
    
//     const [createdVendor] = await db.insert(vendors).values(
//       ensureTenantInsert({
//         tenantId,
//         name: vendor.name,
//         phone: vendor.phone,
//         address: `${vendor.name} Farm, ${scenario === 'established' ? 'Maharashtra' : scenario === 'growing' ? 'Pune Region' : 'Nashik Region'}`,
//         balance: Math.round(balance).toString(),
//         isActive: true
//       }, tenantId)
//     ).returning({ id: vendors.id });
    
//     createdVendors.push(createdVendor);
//   }
  
//   return createdVendors;
// }

// async function createTenantItems(tenantId: string, scenario: string) {
//   console.log(`Creating items for tenant scenario: ${scenario}`);
  
//   const itemCount = scenario === 'established' ? 8 : scenario === 'growing' ? 6 : 4;
//   const itemData = ITEM_TEMPLATES.slice(0, itemCount);
//   const createdItems = [];
  
//   for (const item of itemData) {
//     const [createdItem] = await db.insert(items).values(
//       ensureTenantInsert({
//         tenantId,
//         name: item.name,
//         category: item.category,
//         unit: item.unit,
//         quality: item.quality,
//         currentStock: scenario === 'established' ? 
//           Math.floor(Math.random() * 1000) + 100 :
//           scenario === 'growing' ?
//           Math.floor(Math.random() * 500) + 50 :
//           Math.floor(Math.random() * 100) + 10,
//         isActive: true
//       }, tenantId)
//     ).returning({ id: items.id });
    
//     createdItems.push(createdItem);
//   }
  
//   return createdItems;
// }

// async function createTenantBankAccounts(tenantId: string, scenario: string) {
//   console.log(`Creating bank accounts for tenant scenario: ${scenario}`);
  
//   const accounts = [
//     {
//       name: 'Current Account - SBI',
//       accountNumber: '1234567890',
//       bankName: 'State Bank of India',
//       ifscCode: 'SBIN0001234'
//     },
//     {
//       name: 'Savings Account - HDFC',
//       accountNumber: '9876543210',
//       bankName: 'HDFC Bank',
//       ifscCode: 'HDFC0001234'
//     }
//   ];
  
//   const accountCount = scenario === 'new' ? 1 : 2;
//   const createdAccounts = [];
  
//   for (let i = 0; i < accountCount; i++) {
//     const account = accounts[i];
//     const balance = scenario === 'established' ? 
//       Math.random() * 500000 + 100000 :
//       scenario === 'growing' ?
//       Math.random() * 200000 + 50000 :
//       Math.random() * 50000 + 10000;
    
//     const [createdAccount] = await db.insert(bankAccounts).values(
//       ensureTenantInsert({
//         tenantId,
//         name: account.name,
//         accountNumber: account.accountNumber,
//         bankName: account.bankName,
//         ifscCode: account.ifscCode,
//         balance: Math.round(balance).toString(),
//         isActive: true
//       }, tenantId)
//     ).returning({ id: bankAccounts.id });
    
//     createdAccounts.push(createdAccount);
//   }
  
//   return createdAccounts;
// }

// async function createTenantRetailers(tenantId: string, scenario: string) {
//   console.log(`Creating retailers for tenant scenario: ${scenario}`);
  
//   const retailerCount = scenario === 'established' ? 4 : scenario === 'growing' ? 3 : 1;
//   const createdRetailers = [];
  
//   for (let i = 0; i < retailerCount; i++) {
//     const retailer = RETAILER_TEMPLATES[i];
//     const balance = scenario === 'established' ? 
//       Math.random() * 20000 - 10000 : // Mixed balances
//       scenario === 'growing' ?
//       Math.random() * 10000 - 2000 : // Mostly small balances
//       Math.random() * 1000; // Very small balances
    
//     const [createdRetailer] = await db.insert(retailers).values(
//       ensureTenantInsert({
//         tenantId,
//         name: retailer.name,
//         phone: `+91-987654${3300 + i}`,
//         address: `${retailer.name}, Market Area`,
//         balance: Math.round(balance).toString(),
//         isActive: true
//       }, tenantId)
//     ).returning({ id: retailers.id });
    
//     createdRetailers.push(createdRetailer);
//   }
  
//   return createdRetailers;
// }

// async function createTenantExpenseCategories(tenantId: string) {
//   console.log(`Creating expense categories for tenant`);
  
//   const createdCategories = [];
  
//   for (const categoryName of EXPENSE_CATEGORIES) {
//     const [category] = await db.insert(expenseCategories).values(
//       ensureTenantInsert({
//         tenantId,
//         name: categoryName,
//         isActive: true
//       }, tenantId)
//     ).returning({ id: expenseCategories.id });
    
//     createdCategories.push(category);
//   }
  
//   return createdCategories;
// }

// async function createTransactionalData(
//   tenantId: string, 
//   scenario: string, 
//   vendorIds: { id: string }[], 
//   itemIds: { id: string }[], 
//   bankAccountIds: { id: string }[], 
//   retailerIds: { id: string }[],
//   expenseCategoryIds: { id: string }[]
// ) {
//   console.log(`Creating transactional data for scenario: ${scenario}`);
  
//   // Determine transaction volumes based on scenario
//   const volumes = {
//     established: { purchases: 15, sales: 12, expenses: 8, crates: 6 },
//     growing: { purchases: 8, sales: 6, expenses: 5, crates: 4 },
//     new: { purchases: 3, sales: 2, expenses: 2, crates: 1 }
//   };
  
//   const vol = volumes[scenario as keyof typeof volumes];
  
//   // Create purchase invoices with items and payments
//   const createdPurchaseInvoices = [];
//   for (let i = 0; i < vol.purchases; i++) {
//     const vendorId = vendorIds[Math.floor(Math.random() * vendorIds.length)].id;
//     const invoiceDate = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);
//     const invoiceNumber = `PI${String(i + 1).padStart(4, '0')}`;
    
//     // Calculate realistic amounts based on scenario
//     const baseAmount = scenario === 'established' ? 25000 : scenario === 'growing' ? 15000 : 8000;
//     const totalSelling = baseAmount + (Math.random() * baseAmount * 0.5);
//     const totalExpense = totalSelling * 0.15; // 15% expenses
//     const netAmount = totalSelling - totalExpense;
//     const paidAmount = Math.random() < 0.7 ? netAmount : Math.random() * netAmount;
//     const balanceAmount = netAmount - paidAmount;
    
//     const [invoice] = await db.insert(purchaseInvoices).values(
//       ensureTenantInsert({
//         tenantId,
//         vendorId,
//         invoiceNumber,
//         invoiceDate,
//         commission: (totalSelling * 0.08).toFixed(2), // 8% commission
//         labour: (totalSelling * 0.03).toFixed(2), // 3% labour
//         truckFreight: (totalSelling * 0.02).toFixed(2), // 2% freight
//         crateFreight: (totalSelling * 0.01).toFixed(2), // 1% crate freight
//         postExpenses: (totalSelling * 0.005).toFixed(2), // 0.5% post expenses
//         draftExpenses: (totalSelling * 0.005).toFixed(2), // 0.5% draft expenses
//         vatav: "0.00",
//         otherExpenses: "0.00",
//         advance: "0.00",
//         totalExpense: totalExpense.toFixed(2),
//         totalSelling: totalSelling.toFixed(2),
//         totalLessExpenses: netAmount.toFixed(2),
//         netAmount: netAmount.toFixed(2),
//         paidAmount: paidAmount.toFixed(2),
//         balanceAmount: balanceAmount.toFixed(2),
//         status: balanceAmount <= 0 ? 'Paid' : paidAmount > 0 ? 'Partially Paid' : 'Unpaid'
//       }, tenantId)
//     ).returning({ id: purchaseInvoices.id });
    
//     createdPurchaseInvoices.push({ ...invoice, vendorId, netAmount, paidAmount, invoiceDate, invoiceNumber });
    
//     // Create 1-3 invoice items per purchase
//     const itemCount = Math.floor(Math.random() * 3) + 1;
//     let remainingAmount = totalSelling;
    
//     for (let j = 0; j < itemCount; j++) {
//       const itemId = itemIds[Math.floor(Math.random() * itemIds.length)].id;
//       const weight = (Math.random() * 200 + 50).toFixed(1); // 50-250 kg
//       const crates = Math.floor(parseFloat(weight) / 20); // ~20 kg per crate
//       const boxes = Math.floor(Math.random() * 10);
//       const itemAmount = j === itemCount - 1 ? remainingAmount : remainingAmount / (itemCount - j) * (0.7 + Math.random() * 0.6);
//       const rate = (itemAmount / parseFloat(weight)).toFixed(2);
      
//       await db.insert(invoiceItems).values(
//         ensureTenantInsert({
//           tenantId,
//           invoiceId: invoice.id,
//           itemId,
//           weight,
//           crates: crates.toString(),
//           boxes: boxes.toString(),
//           rate,
//           amount: itemAmount.toFixed(2)
//         }, tenantId)
//       );
      
//       // Create stock movements for purchased items
//       await db.insert(stockMovements).values(
//         ensureTenantInsert({
//           tenantId,
//           itemId,
//           movementType: 'IN',
//           quantityInCrates: crates.toString(),
//           quantityInBoxes: boxes.toString(),
//           quantityInKgs: weight,
//           referenceType: 'PURCHASE_INVOICE',
//           referenceId: invoice.id,
//           referenceNumber: invoiceNumber,
//           vendorId,
//           movementDate: invoiceDate,
//           notes: `Stock received from purchase - ${invoiceNumber}`
//         }, tenantId)
//       );
      
//       remainingAmount -= itemAmount;
//     }
    
//     // Create payments if invoice is paid
//     if (paidAmount > 0) {
//       const paymentCount = paidAmount === netAmount ? 1 : Math.floor(Math.random() * 2) + 1;
//       let remainingPayment = paidAmount;
      
//       for (let k = 0; k < paymentCount; k++) {
//         const paymentAmount = k === paymentCount - 1 ? remainingPayment : remainingPayment / 2;
//         const paymentMode = ['Cash', 'Bank', 'UPI', 'Cheque'][Math.floor(Math.random() * 4)];
//         const paymentDate = new Date(invoiceDate.getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000);
        
//         await db.insert(payments).values(
//           ensureTenantInsert({
//             tenantId,
//             vendorId,
//             invoiceId: invoice.id,
//             amount: paymentAmount.toFixed(2),
//             paymentMode,
//             paymentDate,
//             bankAccountId: paymentMode === 'Bank' || paymentMode === 'Cheque' ? 
//               bankAccountIds[Math.floor(Math.random() * bankAccountIds.length)].id : null,
//             chequeNumber: paymentMode === 'Cheque' ? `CHQ${Math.random().toString().substr(2, 6)}` : null,
//             upiReference: paymentMode === 'UPI' ? `UPI${Math.random().toString().substr(2, 9)}` : null,
//             notes: `${paymentMode} payment for ${invoiceNumber}`
//           }, tenantId)
//         );
        
//         remainingPayment -= paymentAmount;
//       }
//     }
//   }
  
//   // Create sales invoices with items and payments
//   const createdSalesInvoices = [];
//   for (let i = 0; i < vol.sales; i++) {
//     const retailerId = retailerIds[Math.floor(Math.random() * retailerIds.length)].id;
//     const invoiceDate = new Date(Date.now() - Math.random() * 25 * 24 * 60 * 60 * 1000);
//     const invoiceNumber = `SI${String(i + 1).padStart(4, '0')}`;
    
//     const baseAmount = scenario === 'established' ? 15000 : scenario === 'growing' ? 9000 : 4000;
//     const totalAmount = baseAmount + (Math.random() * baseAmount * 0.4);
//     const paidAmount = Math.random() < 0.8 ? totalAmount : Math.random() * totalAmount;
//     const balanceAmount = totalAmount - paidAmount;
    
//     const [salesInvoice] = await db.insert(salesInvoices).values(
//       ensureTenantInsert({
//         tenantId,
//         retailerId,
//         invoiceNumber,
//         invoiceDate,
//         totalAmount: totalAmount.toFixed(2),
//         paidAmount: paidAmount.toFixed(2),
//         balanceAmount: balanceAmount.toFixed(2),
//         udhaaarAmount: Math.random() < 0.3 ? (totalAmount * 0.1).toFixed(2) : "0.00",
//         shortfallAmount: Math.random() < 0.2 ? (totalAmount * 0.05).toFixed(2) : "0.00",
//         status: balanceAmount <= 0 ? 'Paid' : paidAmount > 0 ? 'Partially Paid' : 'Unpaid',
//         notes: `Sales to ${retailerId}`
//       }, tenantId)
//     ).returning({ id: salesInvoices.id });
    
//     createdSalesInvoices.push({ ...salesInvoice, retailerId, totalAmount, paidAmount, invoiceDate, invoiceNumber });
    
//     // Create 1-2 sales invoice items
//     const itemCount = Math.floor(Math.random() * 2) + 1;
//     let remainingAmount = totalAmount;
    
//     for (let j = 0; j < itemCount; j++) {
//       const itemId = itemIds[Math.floor(Math.random() * itemIds.length)].id;
//       const weight = (Math.random() * 100 + 20).toFixed(1); // 20-120 kg
//       const crates = Math.floor(parseFloat(weight) / 20);
//       const boxes = Math.floor(Math.random() * 5);
//       const itemAmount = j === itemCount - 1 ? remainingAmount : remainingAmount / (itemCount - j) * (0.8 + Math.random() * 0.4);
//       const rate = (itemAmount / parseFloat(weight)).toFixed(2);
      
//       await db.insert(salesInvoiceItems).values(
//         ensureTenantInsert({
//           tenantId,
//           invoiceId: salesInvoice.id,
//           itemId,
//           weight,
//           crates: crates.toString(),
//           boxes: boxes.toString(),
//           rate,
//           amount: itemAmount.toFixed(2)
//         }, tenantId)
//       );
      
//       // Create stock movements for sold items (OUT)
//       await db.insert(stockMovements).values(
//         ensureTenantInsert({
//           tenantId,
//           itemId,
//           movementType: 'OUT',
//           quantityInCrates: crates.toString(),
//           quantityInBoxes: boxes.toString(),
//           quantityInKgs: weight,
//           referenceType: 'SALES_INVOICE',
//           referenceId: salesInvoice.id,
//           referenceNumber: invoiceNumber,
//           retailerId,
//           rate,
//           movementDate: invoiceDate,
//           notes: `Stock sold - ${invoiceNumber}`
//         }, tenantId)
//       );
      
//       remainingAmount -= itemAmount;
//     }
    
//     // Create sales payments if invoice is paid
//     if (paidAmount > 0) {
//       const paymentCount = paidAmount === totalAmount ? 1 : Math.floor(Math.random() * 2) + 1;
//       let remainingPayment = paidAmount;
      
//       for (let k = 0; k < paymentCount; k++) {
//         const paymentAmount = k === paymentCount - 1 ? remainingPayment : remainingPayment / 2;
//         const paymentMode = ['Cash', 'Bank', 'UPI'][Math.floor(Math.random() * 3)];
//         const paymentDate = new Date(invoiceDate.getTime() + Math.random() * 5 * 24 * 60 * 60 * 1000);
        
//         await db.insert(salesPayments).values(
//           ensureTenantInsert({
//             tenantId,
//             invoiceId: salesInvoice.id,
//             retailerId,
//             amount: paymentAmount.toFixed(2),
//             paymentMode,
//             paymentDate,
//             bankAccountId: paymentMode === 'Bank' ? 
//               bankAccountIds[Math.floor(Math.random() * bankAccountIds.length)].id : null,
//             upiReference: paymentMode === 'UPI' ? `UPI${Math.random().toString().substr(2, 9)}` : null,
//             notes: `${paymentMode} payment for ${invoiceNumber}`
//           }, tenantId)
//         );
        
//         remainingPayment -= paymentAmount;
//       }
//     }
//   }
  
//   // Create expenses
//   for (let i = 0; i < vol.expenses; i++) {
//     const categoryId = expenseCategoryIds[Math.floor(Math.random() * expenseCategoryIds.length)].id;
//     const amount = scenario === 'established' ? 
//       Math.random() * 8000 + 2000 : 
//       scenario === 'growing' ? 
//       Math.random() * 5000 + 1000 : 
//       Math.random() * 2000 + 500;
//     const paymentDate = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);
//     const paymentMode = ['Cash', 'Bank', 'UPI', 'Cheque'][Math.floor(Math.random() * 4)];
    
//     await db.insert(expenses).values(
//       ensureTenantInsert({
//         tenantId,
//         categoryId,
//         amount: amount.toFixed(2),
//         description: `Monthly expense - Category ${i + 1}`,
//         paymentDate,
//         paymentMode,
//         bankAccountId: paymentMode === 'Bank' || paymentMode === 'Cheque' ? 
//           bankAccountIds[Math.floor(Math.random() * bankAccountIds.length)].id : null,
//         chequeNumber: paymentMode === 'Cheque' ? `CHQ${Math.random().toString().substr(2, 6)}` : null,
//         upiReference: paymentMode === 'UPI' ? `UPI${Math.random().toString().substr(2, 9)}` : null,
//         notes: `Business expense payment`
//       }, tenantId)
//     );
//   }
  
//   // Create crate transactions
//   for (let i = 0; i < vol.crates; i++) {
//     const retailerId = retailerIds[Math.floor(Math.random() * retailerIds.length)].id;
//     const transactionType = Math.random() < 0.7 ? 'Issue' : 'Return';
//     const quantity = Math.floor(Math.random() * 20) + 5; // 5-25 crates
//     const depositAmount = (quantity * 10).toFixed(2); // ₹10 per crate
//     const transactionDate = new Date(Date.now() - Math.random() * 20 * 24 * 60 * 60 * 1000);
    
//     await db.insert(crateTransactions).values(
//       ensureTenantInsert({
//         tenantId,
//         retailerId,
//         transactionType,
//         quantity,
//         depositAmount,
//         transactionDate,
//         notes: `Crate ${transactionType.toLowerCase()} - ${quantity} units`
//       }, tenantId)
//     );
//   }
  
//   // Update stock levels based on movements
//   for (const item of itemIds) {
//     // Calculate current stock from movements
//     const movements = await db.select()
//       .from(stockMovements)
//       .where(sql`${stockMovements.tenantId} = ${tenantId} AND ${stockMovements.itemId} = ${item.id}`);
    
//     let totalCrates = 0, totalBoxes = 0, totalKgs = 0;
    
//     movements.forEach(movement => {
//       const multiplier = movement.movementType === 'IN' ? 1 : -1;
//       totalCrates += parseFloat(movement.quantityInCrates || '0') * multiplier;
//       totalBoxes += parseFloat(movement.quantityInBoxes || '0') * multiplier;
//       totalKgs += parseFloat(movement.quantityInKgs || '0') * multiplier;
//     });
    
//     // Ensure no negative stock
//     totalCrates = Math.max(0, totalCrates);
//     totalBoxes = Math.max(0, totalBoxes);
//     totalKgs = Math.max(0, totalKgs);
    
//     await db.insert(stock).values(
//       ensureTenantInsert({
//         tenantId,
//         itemId: item.id,
//         quantityInCrates: totalCrates.toFixed(2),
//         quantityInBoxes: totalBoxes.toFixed(2),
//         quantityInKgs: totalKgs.toFixed(2)
//       }, tenantId)
//     );
//   }
  
//   // Create cashbook entries from cash transactions
//   let cashBalance = 0;
//   const cashTransactions = [];
  
//   // Add cash sales
//   for (const invoice of createdSalesInvoices) {
//     if (invoice.paidAmount > 0 && Math.random() < 0.6) { // 60% cash sales
//       const amount = invoice.paidAmount * 0.7; // 70% of payment in cash
//       cashBalance += amount;
//       cashTransactions.push({
//         date: invoice.invoiceDate,
//         description: `Cash sales - ${invoice.invoiceNumber}`,
//         inflow: amount.toFixed(2),
//         outflow: "0.00",
//         balance: cashBalance.toFixed(2),
//         referenceType: 'Sales Invoice',
//         referenceId: invoice.id
//       });
//     }
//   }
  
//   // Add cash expenses
//   for (let i = 0; i < Math.floor(vol.expenses * 0.6); i++) {
//     const amount = Math.random() * 3000 + 500;
//     cashBalance -= amount;
//     const date = new Date(Date.now() - Math.random() * 25 * 24 * 60 * 60 * 1000);
//     cashTransactions.push({
//       date,
//       description: `Cash expense - ${EXPENSE_CATEGORIES[Math.floor(Math.random() * EXPENSE_CATEGORIES.length)]}`,
//       inflow: "0.00",
//       outflow: amount.toFixed(2),
//       balance: cashBalance.toFixed(2),
//       referenceType: 'Expense',
//       referenceId: null
//     });
//   }
  
//   // Sort and insert cashbook entries
//   cashTransactions.sort((a, b) => a.date.getTime() - b.date.getTime());
//   for (const transaction of cashTransactions) {
//     await db.insert(cashbook).values(
//       ensureTenantInsert({
//         tenantId,
//         date: transaction.date,
//         description: transaction.description,
//         inflow: transaction.inflow,
//         outflow: transaction.outflow,
//         balance: transaction.balance,
//         referenceType: transaction.referenceType,
//         referenceId: transaction.referenceId
//       }, tenantId)
//     );
//   }
  
//   // Create bankbook entries for each bank account
//   for (const bankAccount of bankAccountIds) {
//     let bankBalance = 50000; // Starting balance
//     const bankTransactions = [];
    
//     // Add bank payments
//     for (const invoice of createdPurchaseInvoices) {
//       if (invoice.paidAmount > 0 && Math.random() < 0.4) { // 40% bank payments
//         const amount = invoice.paidAmount * 0.8; // 80% of payment via bank
//         bankBalance -= amount;
//         bankTransactions.push({
//           date: new Date(invoice.invoiceDate.getTime() + Math.random() * 3 * 24 * 60 * 60 * 1000),
//           description: `Payment to vendor - ${invoice.invoiceNumber}`,
//           debit: "0.00",
//           credit: amount.toFixed(2),
//           balance: bankBalance.toFixed(2),
//           referenceType: 'Payment',
//           referenceId: invoice.id
//         });
//       }
//     }
    
//     // Sort and insert bankbook entries
//     bankTransactions.sort((a, b) => a.date.getTime() - b.date.getTime());
//     for (const transaction of bankTransactions) {
//       await db.insert(bankbook).values(
//         ensureTenantInsert({
//           tenantId,
//           bankAccountId: bankAccount.id,
//           date: transaction.date,
//           description: transaction.description,
//           debit: transaction.debit,
//           credit: transaction.credit,
//           balance: transaction.balance,
//           referenceType: transaction.referenceType,
//           referenceId: transaction.referenceId
//         }, tenantId)
//       );
//     }
//   }
  
//   console.log(`   ✅ Created ${vol.purchases} purchase invoices with items and payments`);
//   console.log(`   ✅ Created ${vol.sales} sales invoices with items and payments`);
//   console.log(`   ✅ Created ${vol.expenses} expense entries`);
//   console.log(`   ✅ Created ${vol.crates} crate transactions`);
//   console.log(`   ✅ Created stock movements and current stock levels`);
//   console.log(`   ✅ Created cashbook and bankbook entries`);
// }

async function seedTenantData() {
  console.log('🌱 Starting comprehensive tenant data seeding...\n');
  
  try {
    for (const config of TENANT_CONFIGS) {
      console.log(`\n📋 Processing tenant: ${config.name} (${config.slug})`);
      console.log(`   Scenario: ${config.scenario}`);
      console.log('   ─────────────────────────────────────────');
      
      // Create tenant
      const tenantId = await createTenant(config);
      console.log(`   ✅ Tenant created with ID: ${tenantId}`);
      
      // Create users
      const users = await createTenantUsers(tenantId, config);
      console.log(`   ✅ Created ${users.length} users`);
      
      // // Create vendors
      // const vendors = await createTenantVendors(tenantId, config.scenario);
      // console.log(`   ✅ Created ${vendors.length} vendors`);
      
      // // Create items
      // const items = await createTenantItems(tenantId, config.scenario);
      // console.log(`   ✅ Created ${items.length} items`);
      
      // // Create bank accounts
      // const bankAccounts = await createTenantBankAccounts(tenantId, config.scenario);
      // console.log(`   ✅ Created ${bankAccounts.length} bank accounts`);
      
      // // Create retailers
      // const retailers = await createTenantRetailers(tenantId, config.scenario);
      // console.log(`   ✅ Created ${retailers.length} retailers`);
      
      // // Create expense categories
      // const expenseCategories = await createTenantExpenseCategories(tenantId);
      // console.log(`   ✅ Created ${expenseCategories.length} expense categories`);
      
      // // Create comprehensive transactional data
      // await createTransactionalData(tenantId, config.scenario, vendors, items, bankAccounts, retailers, expenseCategories);
      // console.log(`   ✅ Created comprehensive transactional data`);
      
      console.log(`   🎉 Completed setup for ${config.name}\n`);
    }
    
    console.log('\n🎊 Tenant data seeding completed successfully!');
    console.log('\n📖 Available test tenants:');
    console.log('   • Mumbai Fruit Market (mumbai-fruits) - Established business');
    console.log('   • Pune Fresh Produce (pune-fresh) - Growing business');
    console.log('   • Nashik Organic Hub (nashik-organic) - New business');
    console.log('\n🔑 All users have password: password123');
    console.log('\n🌐 Access via: http://localhost:8000/{tenant-slug}');
    
  } catch (error) {
    console.error('❌ Error seeding tenant data:', error);
    throw error;
  }
}

// Run the seeding if this script is executed directly
if (import.meta.url.endsWith(process.argv[1])) {
  seedTenantData()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { seedTenantData };