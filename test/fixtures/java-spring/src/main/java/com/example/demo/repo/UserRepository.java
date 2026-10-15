package com.example.demo.repo;

import com.example.demo.model.User;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class UserRepository {
  private final JdbcTemplate jdbc;

  public UserRepository(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public long insert(String name) {
    return jdbc.queryForObject("insert into users (name) values (?) returning id", Long.class, name);
  }

  public User findById(long id) {
    return jdbc.queryForObject("select id, name from users where id = ?", (rs, n) -> new User(rs.getLong("id"), rs.getString("name")), id);
  }
}
