import { describe, expect, it } from "vitest";
import { createUser } from "../src/services/userService";

describe("createUser", () => {
  it("rejects input without a name", async () => {
    await expect(createUser({ id: "1" })).rejects.toThrow();
  });
});
