import { Router } from "express";
import * as users from "../services/userService";

export const router = Router();

router.get("/users/:id", async (req, res) => {
  const user = await users.getUser(req.params.id);
  res.json(user);
});

router.post("/users", createUserHandler);

/** Create a user from the request body. */
export async function createUserHandler(req: { body: unknown }, res: { status(code: number): { json(v: unknown): void } }) {
  const user = await users.createUser(req.body);
  res.status(201).json(user);
}
