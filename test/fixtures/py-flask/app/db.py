import sqlite3


def query(sql):
    conn = sqlite3.connect("inventory.db")
    return conn.execute(sql).fetchall()
