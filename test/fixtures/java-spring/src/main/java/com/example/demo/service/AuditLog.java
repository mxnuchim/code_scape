package com.example.demo.service;

/** Where user events are recorded; the implementation is wired at runtime. */
public interface AuditLog {
  void record(String event);
}
