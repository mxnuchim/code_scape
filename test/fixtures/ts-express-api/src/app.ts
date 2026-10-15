import express from "express";
import { router as userRoutes } from "./routes/users";

/** Build the Express application with every route mounted. */
export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(userRoutes);
  return app;
}
