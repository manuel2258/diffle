//! `GET /api/threads/wait`, the request a live review's agent holds until a thread needs it.
mod common;

use std::time::{Duration, Instant};

use common::eventually;
use common::server::TestServer;
use serde_json::{Value, json};

/// A held wait on its own client, so the test can write threads while it is parked or drop it.
fn hold(s: &TestServer, timeout: u64) -> tokio::task::JoinHandle<reqwest::Result<Value>> {
    let url = format!("{}api/threads/wait?timeout={timeout}", s.base);
    tokio::spawn(async move { reqwest::get(url).await?.json::<Value>().await })
}

async fn parked(s: &TestServer) {
    let hub = s.hub.clone();
    eventually("the wait to subscribe", async || hub.listener_count() == 1).await;
}

async fn thread(s: &TestServer, body: Value) -> Value {
    let res = s.json("POST", "/api/threads", body).await;
    assert_eq!(res.status, 201, "{}", res.body);
    res.json()[0].clone()
}

#[tokio::test]
async fn answers_at_once_with_a_thread_that_waits_and_with_none_once_the_agent_replied() {
    let s = TestServer::start().await;
    let t = thread(&s, json!({ "path": "a.txt", "body": "Why a?" })).await;
    let waiting = s.get("/api/threads/wait?timeout=5").await.json();
    assert_eq!(waiting.as_array().unwrap().iter().map(|t| t["id"].clone()).collect::<Vec<_>>(), [t["id"].clone()]);

    let id = t["id"].as_str().unwrap();
    let replied =
        s.json("POST", &format!("/api/threads/{id}/replies"), json!({ "body": "It is.", "author": "agent" })).await;
    assert_eq!(replied.status, 201);
    let authors: Vec<Value> =
        replied.json()["messages"].as_array().unwrap().iter().map(|m| m["author"].clone()).collect();
    assert_eq!(authors, [Value::Null, json!("agent")]);
    assert_eq!(s.get("/api/threads/wait?timeout=1").await.json(), json!([]));
    s.close().await;
}

#[tokio::test]
async fn holds_the_request_until_the_reviewer_writes_then_returns_that_thread() {
    let s = TestServer::start().await;
    let t = thread(&s, json!({ "path": "a.txt", "body": "Worth a test?", "author": "agent" })).await;
    let waiting = hold(&s, 30);
    // Reply only once the wait is parked on the hub, so the wake path answers it, not the first read.
    parked(&s).await;
    let id = t["id"].as_str().unwrap();
    s.json("POST", &format!("/api/threads/{id}/replies"), json!({ "body": "Yes, add one." })).await;
    let answered = waiting.await.unwrap().unwrap();
    assert_eq!(answered[0]["messages"][1]["body"], "Yes, add one.");
    s.close().await;
}

#[tokio::test]
async fn stops_listening_when_the_caller_disconnects() {
    let s = TestServer::start().await;
    let waiting = hold(&s, 60);
    parked(&s).await;
    waiting.abort();
    let hub = s.hub.clone();
    eventually("the wait to unsubscribe", async || hub.listener_count() == 0).await;
    s.close().await;
}

#[tokio::test]
async fn lets_the_server_close_while_a_wait_is_held() {
    let s = TestServer::start().await;
    let waiting = hold(&s, 600);
    parked(&s).await;
    let started = Instant::now();
    tokio::time::timeout(Duration::from_secs(10), s.close()).await.expect("close waits for the held request");
    assert!(started.elapsed() < Duration::from_secs(10));
    assert_eq!(waiting.await.unwrap().unwrap(), json!([]));
}

#[tokio::test]
async fn rejects_a_timeout_outside_one_second_to_an_hour_and_an_unknown_author() {
    let s = TestServer::start().await;
    for timeout in ["0", "3601", "soon"] {
        let res = s.get(&format!("/api/threads/wait?timeout={timeout}")).await;
        assert_eq!(res.status, 400, "timeout={timeout}: {}", res.body);
    }
    let t = thread(&s, json!({ "path": "a.txt", "body": "Why a?" })).await;
    let id = t["id"].as_str().unwrap();
    let res = s.json("POST", &format!("/api/threads/{id}/replies"), json!({ "body": "x", "author": "robot" })).await;
    assert_eq!(res.status, 400, "{}", res.body);
    s.close().await;
}

#[tokio::test]
async fn hiding_a_thread_keeps_it_waiting_on_the_agent() {
    let s = TestServer::start().await;
    let t = thread(&s, json!({ "path": "a.txt", "body": "Why a?" })).await;
    let id = t["id"].as_str().unwrap();
    let res = s.json("PUT", &format!("/api/threads/{id}/hidden"), json!({ "hidden": true })).await;
    assert_eq!((res.status, res.json()["hidden"].clone()), (200, json!(true)));
    let waiting = s.get("/api/threads/wait?timeout=5").await.json();
    assert_eq!(waiting[0]["id"], t["id"]);
    assert_eq!(s.json("PUT", &format!("/api/threads/{id}/hidden"), json!({ "hidden": "yes" })).await.status, 400);
    s.close().await;
}
