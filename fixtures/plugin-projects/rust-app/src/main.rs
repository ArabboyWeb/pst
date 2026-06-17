use actix_web::{web, App, HttpServer, HttpResponse};

async fn index() -> HttpResponse {
    HttpResponse::Ok().body("Hello from rust-app")
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    println!("Listening on :{}", port);
    HttpServer::new(|| App::new().route("/", web::get().to(index)))
        .bind(format!("0.0.0.0:{}", port))?
        .run()
        .await
}
