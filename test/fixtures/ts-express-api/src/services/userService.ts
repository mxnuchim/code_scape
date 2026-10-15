import { db } from "@/db/client";
import { validateUser } from "../lib/validate";
import type { User } from "../lib/types";

export async function getUser(id: string): Promise<User | undefined> {
  return db.findUser(id);
}

export async function createUser(input: unknown): Promise<User> {
  const user = validateUser(input);
  return db.insertUser(user);
}
