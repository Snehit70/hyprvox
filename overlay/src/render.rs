use crate::waveform::WaveformState;
use tiny_skia::{Color, Paint, PathBuilder, Pixmap, Rect, Transform};

const BAR_WIDTH: f32 = 4.0;
const BAR_SPACING: f32 = 3.0;
const BAR_RADIUS: f32 = 2.0;
const CONTAINER_RADIUS: f32 = 24.0;
const CONTAINER_PADDING: f32 = 12.0;

pub fn draw_waveform(pixmap: &mut Pixmap, state: &WaveformState, width: u32, height: u32) {
    pixmap.fill(Color::TRANSPARENT);

    if !state.is_recording() {
        return;
    }

    draw_pill_background(pixmap, width, height);
    draw_bars(pixmap, state, width, height);
}

fn draw_pill_background(pixmap: &mut Pixmap, width: u32, height: u32) {
    let mut paint = Paint::default();
    paint.set_color(Color::from_rgba8(20, 20, 25, 220));
    paint.anti_alias = true;

    const PILL_WIDTH: f32 = 400.0;
    let pill_width = PILL_WIDTH.min(width as f32);
    let pill_x = (width as f32 - pill_width) / 2.0;

    let rect = Rect::from_xywh(pill_x, 0.0, pill_width, height as f32).unwrap();
    let mut pb = PathBuilder::new();

    let r = CONTAINER_RADIUS
        .min(pill_width / 2.0)
        .min(height as f32 / 2.0);
    let (x, y, w, h) = (rect.x(), rect.y(), rect.width(), rect.height());

    pb.move_to(x + r, y);
    pb.line_to(x + w - r, y);
    pb.quad_to(x + w, y, x + w, y + r);
    pb.line_to(x + w, y + h - r);
    pb.quad_to(x + w, y + h, x + w - r, y + h);
    pb.line_to(x + r, y + h);
    pb.quad_to(x, y + h, x, y + h - r);
    pb.line_to(x, y + r);
    pb.quad_to(x, y, x + r, y);
    pb.close();

    if let Some(path) = pb.finish() {
        pixmap.fill_path(
            &path,
            &paint,
            tiny_skia::FillRule::Winding,
            Transform::identity(),
            None,
        );
    }
}

fn draw_bars(pixmap: &mut Pixmap, state: &WaveformState, width: u32, height: u32) {
    let history = state.get_history();
    if history.is_empty() {
        return;
    }

    let bar_total_width = BAR_WIDTH + BAR_SPACING;
    let available_width = width as f32 - (2.0 * CONTAINER_PADDING);
    let max_bars = (available_width / bar_total_width).floor() as usize;
    let num_bars = history.len().min(max_bars);

    let total_bars_width = num_bars as f32 * bar_total_width - BAR_SPACING;
    let start_x = (width as f32 - total_bars_width) / 2.0;

    let max_bar_height = height as f32 - (2.0 * CONTAINER_PADDING);
    let min_bar_height = 4.0;

    for (i, &amplitude) in history.iter().rev().take(num_bars).enumerate() {
        let x = start_x + (i as f32 * bar_total_width);
        let bar_height = (amplitude * max_bar_height).max(min_bar_height);
        let y = (height as f32 - bar_height) / 2.0;

        let color = amplitude_to_color(amplitude);
        draw_rounded_bar(pixmap, x, y, BAR_WIDTH, bar_height, BAR_RADIUS, color);
    }
}

fn amplitude_to_color(amplitude: f32) -> Color {
    let a = amplitude.clamp(0.0, 1.0);

    if a < 0.4 {
        let t = a / 0.4;
        Color::from_rgba8(
            (80.0 + 100.0 * t) as u8,
            (200.0 + 55.0 * t) as u8,
            (120.0 - 20.0 * t) as u8,
            255,
        )
    } else if a < 0.7 {
        let t = (a - 0.4) / 0.3;
        Color::from_rgba8(
            (180.0 + 75.0 * t) as u8,
            (255.0 - 55.0 * t) as u8,
            (100.0 - 50.0 * t) as u8,
            255,
        )
    } else {
        let t = (a - 0.7) / 0.3;
        Color::from_rgba8(255, (200.0 - 120.0 * t) as u8, (50.0 + 30.0 * t) as u8, 255)
    }
}

fn draw_rounded_bar(
    pixmap: &mut Pixmap,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    radius: f32,
    color: Color,
) {
    let mut paint = Paint::default();
    paint.set_color(color);
    paint.anti_alias = true;

    let r = radius.min(width / 2.0).min(height / 2.0);
    let mut pb = PathBuilder::new();

    pb.move_to(x + r, y);
    pb.line_to(x + width - r, y);
    pb.quad_to(x + width, y, x + width, y + r);
    pb.line_to(x + width, y + height - r);
    pb.quad_to(x + width, y + height, x + width - r, y + height);
    pb.line_to(x + r, y + height);
    pb.quad_to(x, y + height, x, y + height - r);
    pb.line_to(x, y + r);
    pb.quad_to(x, y, x + r, y);
    pb.close();

    if let Some(path) = pb.finish() {
        pixmap.fill_path(
            &path,
            &paint,
            tiny_skia::FillRule::Winding,
            Transform::identity(),
            None,
        );
    }
}
