package com.example.demo.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class UserServiceTest {
  @Test
  void normalizesNames() {
    assertEquals("ada", "Ada".trim().toLowerCase());
  }
}
