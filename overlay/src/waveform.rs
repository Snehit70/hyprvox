use std::collections::VecDeque;

pub const HISTORY_SIZE: usize = 60;

pub struct WaveformState {
    history: VecDeque<f32>,
    recording: bool,
}

impl WaveformState {
    pub fn new() -> Self {
        Self {
            history: VecDeque::with_capacity(HISTORY_SIZE),
            recording: false,
        }
    }

    pub fn update(&mut self, amplitude: f32, recording: bool) {
        self.recording = recording;

        // Add new amplitude to history
        if self.history.len() >= HISTORY_SIZE {
            self.history.pop_front();
        }
        self.history.push_back(amplitude.clamp(0.0, 1.0));
    }

    pub fn get_history(&self) -> &VecDeque<f32> {
        &self.history
    }

    pub fn is_recording(&self) -> bool {
        self.recording
    }

    #[allow(dead_code)]
    pub fn clear(&mut self) {
        self.history.clear();
        self.recording = false;
    }
}
