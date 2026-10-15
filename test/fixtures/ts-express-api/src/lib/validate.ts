import type { User } from "./types";

export function validateUser(input: unknown): User {
  const candidate = input as Partial<User>;
  if (!candidate.id || !candidate.name) throw new Error("id and name are required");
  return { id: candidate.id, name: candidate.name };
}
