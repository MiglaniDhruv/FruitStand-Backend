// Export model and router
export { AuthModel } from "./model";
export { AuthController } from "./controller";
export { AuthRouter } from "./routes";

// Export router instance for use in main server
import { AuthRouter as Router } from "./routes";
export const authRouter = new Router();
