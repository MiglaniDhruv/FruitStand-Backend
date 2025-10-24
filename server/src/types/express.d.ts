import 'express';
import { AuthUser, Tenant } from './index'; // adjust path if needed

declare module 'express' {
  interface Request {
    user?: AuthUser;
    tenantId?: string;
    tenant?: Tenant;
    requestId?: string;
    slugProvided?: boolean;
  }
}
