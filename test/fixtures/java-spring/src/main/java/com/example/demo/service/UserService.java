package com.example.demo.service;

import com.example.demo.model.User;
import com.example.demo.repo.UserRepository;
import org.springframework.stereotype.Service;

@Service
public class UserService {
  private final UserRepository repository;
  private final AuditLog audit;

  public UserService(UserRepository repository, AuditLog audit) {
    this.repository = repository;
    this.audit = audit;
  }

  /** Normalises the name and stores a new user. */
  public User register(String name) {
    String clean = normalize(name);
    long id = repository.insert(clean);
    audit.record("user.created");
    return new User(id, clean);
  }

  public User find(long id) {
    return repository.findById(id);
  }

  private String normalize(String name) {
    return name.trim().toLowerCase();
  }
}
