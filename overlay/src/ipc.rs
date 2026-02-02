use anyhow::{Context, Result};
use serde::Deserialize;
use std::sync::mpsc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::watch;
use tokio::time::{sleep, Duration};

#[derive(Debug, Deserialize)]
pub struct AmplitudeMessage {
    pub amplitude: f32,
    pub recording: bool,
}

pub async fn listen(
    socket_path: &str,
    tx: mpsc::Sender<AmplitudeMessage>,
    mut shutdown: watch::Receiver<bool>,
) -> Result<()> {
    loop {
        if *shutdown.borrow() {
            return Ok(());
        }

        match connect_and_read(socket_path, tx.clone(), shutdown.clone()).await {
            Ok(_) => {
                println!("[IPC] Connection closed gracefully");
            }
            Err(e) => {
                eprintln!("[IPC] Error: {}. Retrying in 2s...", e);
                tokio::select! {
                    _ = sleep(Duration::from_secs(2)) => {}
                    _ = shutdown.changed() => {
                        if *shutdown.borrow() {
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
}

async fn connect_and_read(
    socket_path: &str,
    tx: mpsc::Sender<AmplitudeMessage>,
    mut shutdown: watch::Receiver<bool>,
) -> Result<()> {
    println!("[IPC] Connecting to {}", socket_path);
    
    let stream = UnixStream::connect(socket_path)
        .await
        .context("Failed to connect to Unix socket")?;

    println!("[IPC] Connected successfully");

    let reader = BufReader::new(stream);
    let mut lines = reader.lines();

    loop {
        tokio::select! {
            _ = shutdown.changed() => {
                if *shutdown.borrow() {
                    return Ok(());
                }
            }
            line = lines.next_line() => {
                match line? {
                    Some(line) => {
                        match serde_json::from_str::<AmplitudeMessage>(&line) {
                            Ok(msg) => {
                                println!("[IPC] Received: amp={:.2}, recording={}", msg.amplitude, msg.recording);
                                if tx.send(msg).is_err() {
                                    eprintln!("[IPC] Receiver dropped, shutting down");
                                    return Ok(());
                                }
                            }
                            Err(e) => {
                                eprintln!("[IPC] Failed to parse message: {} (line: {})", e, line);
                            }
                        }
                    }
                    None => return Ok(()),
                }
            }
        }
    }
}
