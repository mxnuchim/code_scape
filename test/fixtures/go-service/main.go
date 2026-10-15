package main

import (
	"net/http"
)

func main() {
	http.HandleFunc("/products", listProducts)
	http.ListenAndServe(":8080", nil)
}
