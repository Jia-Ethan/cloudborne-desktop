//! 小丑斗地主: one WebSocket to the relay's table. It is opened here rather
//! than in the page so the login token never reaches the webview and the CSP
//! stays closed. The relay sends a whole table snapshot on every change; each
//! message goes to the UI as is. A dropped line reconnects by itself, with a
//! refreshed token if the old one expired.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{header, HeaderValue, StatusCode};
use tokio_tungstenite::tungstenite::{Error as WsError, Message};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use crate::api::Client;
use crate::error::{Error, Result};
use crate::session::Session;

/// What the UI hears on the channel.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// The line: `connecting`, `open`, `auth` (signed out, given up) or
    /// `unavailable` (this relay has no tables).
    Conn { state: &'static str },
    /// A message from the relay: `{ type: "table", table }` or `{ type: "error", message }`.
    Relay { data: Value },
}

/// The one open line, if any.
#[derive(Default)]
pub struct Line {
    cur: Mutex<Option<Handle>>,
}

struct Handle {
    out: mpsc::UnboundedSender<String>,
    stop: oneshot::Sender<()>,
}

pub type SharedLine = Arc<Line>;

/// No message (the relay pings every 25 s) for this long means the line is dead.
const SILENCE: Duration = Duration::from_secs(70);
const BACKOFF_MAX: Duration = Duration::from_secs(15);

type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

/// Opens the line, replacing any open one; events go to `channel`.
pub async fn connect(app: AppHandle, line: &Line, channel: Channel<Event>) {
    let (out_tx, out_rx) = mpsc::unbounded_channel();
    let (stop_tx, stop_rx) = oneshot::channel();
    if let Some(old) = line.cur.lock().await.replace(Handle { out: out_tx, stop: stop_tx }) {
        let _ = old.stop.send(());
    }
    tauri::async_runtime::spawn(run(app, out_rx, stop_rx, channel));
}

/// Sends one action (`src/ddz.ts` Action) to the relay.
pub async fn send(line: &Line, action: &Value) -> Result<()> {
    let offline = || Error::Other(crate::lang::tr("牌桌未连接", "Not connected to the table").to_string());
    let cur = line.cur.lock().await;
    let h = cur.as_ref().ok_or_else(offline)?;
    h.out.send(action.to_string()).map_err(|_| offline())
}

/// Closes the line.
pub async fn close(line: &Line) {
    if let Some(h) = line.cur.lock().await.take() {
        let _ = h.stop.send(());
    }
}

fn ws_url(origin: &str) -> String {
    let base = if let Some(rest) = origin.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = origin.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        origin.to_string()
    };
    format!("{base}/api/v1/ddz/ws")
}

enum OpenError {
    Unauthorized,
    Unavailable,
    Other,
}

async fn open(c: &Client, access: &str) -> std::result::Result<Socket, OpenError> {
    let mut req = ws_url(c.origin()).into_client_request().map_err(|_| OpenError::Other)?;
    let h = req.headers_mut();
    h.insert(header::AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {access}")).map_err(|_| OpenError::Other)?);
    h.insert(header::USER_AGENT, HeaderValue::from_str(c.user_agent()).map_err(|_| OpenError::Other)?);
    match tokio::time::timeout(Duration::from_secs(15), tokio_tungstenite::connect_async(req)).await {
        Ok(Ok((ws, _))) => Ok(ws),
        Ok(Err(WsError::Http(resp))) => Err(match resp.status() {
            StatusCode::UNAUTHORIZED => OpenError::Unauthorized,
            StatusCode::NOT_FOUND => OpenError::Unavailable,
            _ => OpenError::Other,
        }),
        _ => Err(OpenError::Other),
    }
}

async fn run(app: AppHandle, mut out: mpsc::UnboundedReceiver<String>, mut stop: oneshot::Receiver<()>, channel: Channel<Event>) {
    let session = app.state::<Session>();
    let mut backoff = Duration::from_secs(1);
    loop {
        let _ = channel.send(Event::Conn { state: "connecting" });
        let c = &session.client;
        // A 401 handshake refreshes the token once and tries again.
        let opened = session
            .authed(|a| async move {
                match open(c, &a).await {
                    Ok(ws) => Ok(Ok(ws)),
                    Err(OpenError::Unauthorized) => Err(Error::Unauthorized),
                    Err(e) => Ok(Err(e)),
                }
            })
            .await;
        let ws = match opened {
            Ok(Ok(ws)) => ws,
            Err(Error::Unauthorized) => {
                let _ = channel.send(Event::Conn { state: "auth" });
                return;
            }
            Ok(Err(OpenError::Unavailable)) => {
                let _ = channel.send(Event::Conn { state: "unavailable" });
                return;
            }
            _ => {
                tokio::select! {
                    _ = &mut stop => return,
                    _ = tokio::time::sleep(backoff) => {}
                }
                backoff = (backoff * 2).min(BACKOFF_MAX);
                continue;
            }
        };

        backoff = Duration::from_secs(1);
        let _ = channel.send(Event::Conn { state: "open" });
        let (mut tx, mut rx) = ws.split();
        loop {
            tokio::select! {
                _ = &mut stop => {
                    let _ = tx.send(Message::Close(None)).await;
                    return;
                }
                msg = out.recv() => match msg {
                    Some(m) => if tx.send(Message::Text(m.into())).await.is_err() { break },
                    None => return,
                },
                next = tokio::time::timeout(SILENCE, rx.next()) => match next {
                    Ok(Some(Ok(Message::Text(t)))) => {
                        if let Ok(data) = serde_json::from_str::<Value>(t.as_str()) {
                            let _ = channel.send(Event::Relay { data });
                        }
                    }
                    Ok(Some(Ok(Message::Close(_)))) | Ok(Some(Err(_))) | Ok(None) | Err(_) => break,
                    Ok(Some(Ok(_))) => {}
                },
            }
        }
        // Actions typed while the line was down would land on a table that
        // has moved on; drop them.
        while out.try_recv().is_ok() {}
        tokio::select! {
            _ = &mut stop => return,
            _ = tokio::time::sleep(Duration::from_millis(500)) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn socket_url_follows_the_origin_scheme() {
        assert_eq!(ws_url("https://api.cloudborne.cn"), "wss://api.cloudborne.cn/api/v1/ddz/ws");
        assert_eq!(ws_url("http://127.0.0.1:8080"), "ws://127.0.0.1:8080/api/v1/ddz/ws");
    }
}
