import * as schema from '../shared/schema.js';

console.log('Keys:', Object.keys(schema).slice(0, 20));
console.log('Has tenants?', 'tenants' in schema);
console.log('Has whatsappCreditTransactions?', 'whatsappCreditTransactions' in schema);