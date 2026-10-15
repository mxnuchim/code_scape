use sqlx::PgPool;

#[derive(Clone, Debug)]
pub struct User {
    pub id: i64,
    pub name: String,
}

#[derive(Clone)]
pub struct UserStore {
    pool: PgPool,
}

impl UserStore {
    pub async fn connect(url: &str) -> Self {
        let pool = PgPool::connect(url).await.unwrap();
        UserStore { pool }
    }

    /// Inserts a user and returns it with its id.
    pub async fn insert(&self, name: &str) -> User {
        let id: i64 = sqlx::query_scalar("insert into users (name) values ($1) returning id")
            .bind(name)
            .fetch_one(&self.pool)
            .await
            .unwrap();
        User { id, name: name.to_string() }
    }

    pub async fn find(&self, id: i64) -> Option<User> {
        sqlx::query_as::<_, (i64, String)>("select id, name from users where id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .unwrap()
            .map(|(id, name)| User { id, name })
    }
}
