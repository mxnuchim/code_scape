package store

// Product is something we sell.
type Product struct {
	Name string
}

// All returns every product.
func All() []Product {
	return []Product{{Name: "lamp"}}
}
