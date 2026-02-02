use crate::ipc::AmplitudeMessage;
use crate::render;
use crate::waveform::WaveformState;
use anyhow::Result;
use layershellev::reexport::{wl_shm, Anchor, Layer};
use layershellev::{DispatchMessage, LayerShellEvent, ReturnData, WindowState};
use std::os::fd::AsFd;
use std::sync::mpsc;
use std::time::Instant;
use tiny_skia::Pixmap;

const OVERLAY_HEIGHT: u32 = 48;
const MARGIN_BOTTOM: i32 = 40;
const TARGET_FPS: u64 = 30;

struct RenderState {
    pixmap: Pixmap,
    width: u32,
    height: u32,
    file: Option<std::fs::File>,
}

pub fn run(rx: mpsc::Receiver<AmplitudeMessage>) -> Result<()> {
    let mut waveform_state = WaveformState::new();
    let mut render_state = RenderState {
        pixmap: Pixmap::new(1, 1).unwrap(),
        width: 1,
        height: OVERLAY_HEIGHT,
        file: None,
    };

    let mut last_refresh = Instant::now();
    let refresh_interval = std::time::Duration::from_millis(1000 / TARGET_FPS);

    let ev: WindowState<()> = WindowState::new("voice-cli-overlay")
        .with_allscreens()
        .with_size((0, OVERLAY_HEIGHT))
        .with_layer(Layer::Overlay)
        .with_anchor(Anchor::Bottom | Anchor::Left | Anchor::Right)
        .with_margin((0, 0, MARGIN_BOTTOM, 0))
        .with_exclusive_zone(0)
        .with_events_transparent(true)
        .build()?;

    ev.running(move |event, _ev, _index| match event {
        LayerShellEvent::InitRequest => {
            println!("[Window] InitRequest");
            ReturnData::RequestBind
        }

        LayerShellEvent::BindProvide(_globals, _qh) => ReturnData::None,

        LayerShellEvent::RequestBuffer(file, shm, qh, init_w, init_h) => {
            println!("[Window] RequestBuffer: {}x{}", init_w, init_h);

            render_state.width = init_w.max(1);
            render_state.height = init_h.max(1);
            render_state.pixmap = Pixmap::new(render_state.width, render_state.height)
                .unwrap_or_else(|| Pixmap::new(1, 1).unwrap());

            match file.try_clone() {
                Ok(cloned_file) => render_state.file = Some(cloned_file),
                Err(e) => {
                    eprintln!("[Window] Failed to clone file descriptor: {}", e);
                    return ReturnData::None;
                }
            }

            render::draw_waveform(
                &mut render_state.pixmap,
                &waveform_state,
                render_state.width,
                render_state.height,
            );
            write_pixmap_to_file(
                &render_state.pixmap,
                file,
                render_state.width,
                render_state.height,
            );

            let pool = shm.create_pool(file.as_fd(), (init_w * init_h * 4) as i32, qh, ());

            ReturnData::WlBuffer(pool.create_buffer(
                0,
                init_w as i32,
                init_h as i32,
                (init_w * 4) as i32,
                wl_shm::Format::Argb8888,
                qh,
                (),
            ))
        }

        LayerShellEvent::RequestMessages(DispatchMessage::RequestRefresh {
            width, height, ..
        }) => {
            println!("[Window] RequestRefresh: {}x{}", width, height);
            let width = *width.max(&1);
            let height = *height.max(&1);
            if render_state.width != width || render_state.height != height {
                render_state.width = width;
                render_state.height = height;
                render_state.pixmap =
                    Pixmap::new(width, height).unwrap_or_else(|| Pixmap::new(1, 1).unwrap());
            }

            if let Some(file) = render_state.file.as_ref() {
                render::draw_waveform(&mut render_state.pixmap, &waveform_state, width, height);
                write_pixmap_to_file(&render_state.pixmap, file, width, height);
            }

            ReturnData::None
        }

        LayerShellEvent::RequestMessages(DispatchMessage::MouseButton { .. }) => ReturnData::None,

        LayerShellEvent::RequestMessages(DispatchMessage::Closed) => ReturnData::RequestExit,

        LayerShellEvent::NormalDispatch => {
            let mut received = false;
            while let Ok(msg) = rx.try_recv() {
                println!(
                    "[Window] Update: amp={:.2}, recording={}",
                    msg.amplitude, msg.recording
                );
                waveform_state.update(msg.amplitude, msg.recording);
                received = true;
            }

            if received {
                if let Some(file) = render_state.file.as_ref() {
                    render::draw_waveform(
                        &mut render_state.pixmap,
                        &waveform_state,
                        render_state.width,
                        render_state.height,
                    );
                    write_pixmap_to_file(
                        &render_state.pixmap,
                        file,
                        render_state.width,
                        render_state.height,
                    );
                    println!("[Window] Drew frame");
                }
            }

            if received || last_refresh.elapsed() >= refresh_interval {
                last_refresh = Instant::now();
                if let Some(id) = _index {
                    return ReturnData::RedrawIndexRequest(id);
                }
            }

            ReturnData::None
        }

        _ => ReturnData::None,
    })
    .map_err(|e| anyhow::anyhow!("Window error: {:?}", e))
}

fn write_pixmap_to_file(pixmap: &Pixmap, file: &std::fs::File, width: u32, height: u32) {
    use std::os::unix::io::AsRawFd;

    let fd = file.as_raw_fd();
    let data = pixmap.data();
    let size = (width * height * 4) as usize;

    unsafe {
        if libc::ftruncate(fd, size as libc::off_t) != 0 {
            eprintln!("[Window] ftruncate failed");
            return;
        }

        let ptr = libc::mmap(
            std::ptr::null_mut(),
            size,
            libc::PROT_READ | libc::PROT_WRITE,
            libc::MAP_SHARED,
            fd,
            0,
        );

        if ptr == libc::MAP_FAILED {
            eprintln!("[Window] mmap failed");
            return;
        }

        std::ptr::copy_nonoverlapping(data.as_ptr(), ptr as *mut u8, size);

        if libc::munmap(ptr, size) != 0 {
            eprintln!("[Window] munmap failed");
        }
    }
}
