// server/src/app.ts
import express from "express";

const app = express();

// Middleware
app.use(express.json());

// Example route
app.get("/hello", (req, res) => {
  res.json({ message: "Hello from backend!" });
});

// Export app to be used by serverless handler
export default app;
