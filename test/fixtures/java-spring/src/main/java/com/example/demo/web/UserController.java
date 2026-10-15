package com.example.demo.web;

import com.example.demo.model.User;
import com.example.demo.service.UserService;
import org.springframework.web.bind.annotation.*;

/** HTTP API for users. */
@RestController
@RequestMapping("/users")
public class UserController {
  private final UserService users;

  public UserController(UserService users) {
    this.users = users;
  }

  @PostMapping
  public User create(@RequestBody User input) {
    return users.register(input.name());
  }

  @GetMapping("/{id}")
  public User get(@PathVariable long id) {
    return users.find(id);
  }
}
