import { Pool } from "pg";
import type { User } from "../lib/types";

const pool = new Pool();

/** Thin wrapper around the users table. */
export class Database {
  async findUser(id: string): Promise<User | undefined> {
    const result = await pool.query("select * from users where id = $1", [id]);
    return result.rows[0];
  }

  async insertUser(user: User): Promise<User> {
    await pool.query("insert into users (id, name) values ($1, $2)", [user.id, user.name]);
    return user;
  }
}

export const db = new Database();
