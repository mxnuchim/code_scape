mod routes;

use axum::routing::{get, post};
use axum::Router;
use storage::UserStore;

/// Starts the HTTP server.
#[tokio::main]
async fn main() {
    let store = UserStore::connect("postgres://localhost/app").await;
    let app = Router::new()
        .route("/users", post(routes::create_user))
        .route("/users/:id", get(routes::get_user))
        .with_state(store);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
