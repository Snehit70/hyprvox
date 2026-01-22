declare module 'node-record-lpcm16' {
  import { Readable } from 'stream';
  import { ChildProcess } from 'child_process';

  export interface RecordOptions {
    sampleRate?: number;
    channels?: number;
    compress?: boolean;
    threshold?: number;
    thresholdStart?: number | null;
    thresholdEnd?: number | null;
    silence?: string;
    recorder?: 'sox' | 'rec' | 'arecord';
    endOnSilence?: boolean;
    audioType?: string;
    device?: string;
    [key: string]: any;
  }

  export interface Recording {
    process: ChildProcess;
    stream(): Readable;
    stop(): void;
    pause(): void;
    resume(): void;
    isPaused(): boolean;
  }

  export function record(options?: RecordOptions): Recording;
}
