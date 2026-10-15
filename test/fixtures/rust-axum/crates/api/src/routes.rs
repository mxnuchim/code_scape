use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use storage::{User, UserStore};

#[derive(Deserialize)]
pub struct NewUser {
    pub name: String,
}

/// POST /users: normalises the name and stores the user.
pub async fn create_user(State(store): State<UserStore>, Json(input): Json<NewUser>) -> Json<User> {
    let name = normalize(&input.name);
    let user = store.insert(&name).await;
    Json(user)
}

pub async fn get_user(State(store): State<UserStore>, Path(id): Path<i64>) -> Json<Option<User>> {
    Json(store.find(id).await)
}

fn normalize(name: &str) -> String {
    name.trim().to_lowercase()
}
