package main

import (
	"encoding/json"
	"net/http"

	"example.com/shop/internal/store"
)

// listProducts writes every product as JSON.
func listProducts(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(store.All())
}
