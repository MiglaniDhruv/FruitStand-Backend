import { db } from "./db";
import bcrypt from "bcrypt";
import schema from './shared/schema';

const { 
  tenants,
  users
} = schema;
import { ROLE_PERMISSIONS } from "./shared/permissions";
import { ensureTenantInsert } from "./src/utils/tenant-scope";
import { seedTenantData } from "./seedTenantData";

export async function initializeDatabase() {
  try {
    // Check if tenants exist
    const existingTenants = await db.select().from(tenants).limit(1);
    if (existingTenants.length > 0) {
      console.log("Database already initialized with tenant data");
      return;
    }

    console.log("Initializing database with demo tenant...");

    await seedTenantData();
  } catch (error) {
    console.error("Error initializing database:", error);
    throw error;
  }
}