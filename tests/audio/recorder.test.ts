import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { AudioRecorder } from '../../src/audio/recorder';
import { EventEmitter } from 'events';
import { record } from 'node-record-lpcm16';

mock.module('../../src/utils/logger', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  logError: () => {},
}));

mock.module('../../src/config/loader', () => ({
  loadConfig: () => ({
    behavior: {
      audioDevice: 'default'
    }
  })
}));

const mockStream = new EventEmitter();
const mockStop = mock(() => {});

mock.module('node-record-lpcm16', () => {
  return {
    record: mock(() => {
        return {
            stream: () => mockStream,
            stop: mockStop,
        };
    }),
  };
});

describe('AudioRecorder', () => {
  let recorder: AudioRecorder;

  beforeEach(() => {
    recorder = new AudioRecorder();
    mockStop.mockClear();
    // @ts-ignore
    record.mockClear();
    mockStream.removeAllListeners();
  });

  it('should start recording successfully', async () => {
    await recorder.start();
    // @ts-ignore
    expect(record).toHaveBeenCalled();
    expect(recorder.isRecording()).toBe(true);
  });

  it('should throw error if already recording', async () => {
    await recorder.start();
    let error: Error | undefined;
    try {
        await recorder.start();
    } catch (e) {
        error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error?.message).toBe('Already recording');
  });

  it('should stop recording and return audio buffer', async () => {
    await recorder.start();
    
    mockStream.emit('data', Buffer.from('chunk1'));
    mockStream.emit('data', Buffer.from('chunk2'));

    const realDateNow = Date.now;
    const startTime = realDateNow();
    Date.now = () => startTime + 1000;

    const buffer = await recorder.stop();
    
    Date.now = realDateNow;

    expect(mockStop).toHaveBeenCalled();
    expect(recorder.isRecording()).toBe(false);
    expect(buffer).not.toBeNull();
    expect(buffer?.toString()).toBe('chunk1chunk2');
  });

  it('should return null if recording is too short', async () => {
    await recorder.start();
    
    const realDateNow = Date.now;
    const startTime = realDateNow();
    Date.now = () => startTime + 100;

    recorder.on('error', () => {});

    const buffer = await recorder.stop();
    
    Date.now = realDateNow;

    expect(buffer).toBeNull();
  });

  it('should detect silence', async () => {
    await recorder.start();
    
    const silentBuffer = Buffer.alloc(1000); 
    mockStream.emit('data', silentBuffer);
    
    const realDateNow = Date.now;
    const startTime = realDateNow();
    Date.now = () => startTime + 1000;

    let warningMsg = '';
    recorder.on('warning', (msg) => {
        warningMsg = msg;
    });

    await recorder.stop();
    
    Date.now = realDateNow;

    expect(warningMsg).toBe('No audio detected');
  });
});
