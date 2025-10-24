export { AuthModel } from "./model";
export * as AuthController from "./controller"; // namespace import
export { AuthRouter } from "./routes";

// Router instance
import { AuthRouter as Router } from "./routes";
export const authRouter = new Router();
