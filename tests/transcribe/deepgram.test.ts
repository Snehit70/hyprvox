import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mocks must be defined before imports in Bun (hoisting handles this, but good to be explicit in intent)

const mockTranscribeFile = mock(() => Promise.resolve({
  result: {
    results: {
      channels: [{
        alternatives: [{ transcript: "Mock transcript" }]
      }]
    }
  },
  error: null
}));

mock.module("@deepgram/sdk", () => ({
  createClient: () => ({
    listen: {
      prerecorded: {
        transcribeFile: mockTranscribeFile
      }
    }
  })
}));

mock.module("../../src/config/loader", () => ({
  loadConfig: () => ({
    apiKeys: {
      deepgram: "4b5c1234567890abcdef1234567890abcdef12"
    }
  })
}));

mock.module("../../src/utils/logger", () => ({
  logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
  logError: () => {}
}));

import { DeepgramTranscriber } from "../../src/transcribe/deepgram";

describe("DeepgramTranscriber", () => {
  beforeEach(() => {
    mockTranscribeFile.mockClear();
    // Default success response
    mockTranscribeFile.mockImplementation(() => Promise.resolve({
      result: {
        results: {
          channels: [{
            alternatives: [{ transcript: "Mock transcript" }]
          }]
        }
      },
      error: null
    }));
  });

  test("should transcribe successfully with Nova-3", async () => {
    const transcriber = new DeepgramTranscriber();
    const result = await transcriber.transcribe(Buffer.from("fake audio"));
    
    expect(result).toBe("Mock transcript");
    expect(mockTranscribeFile).toHaveBeenCalledTimes(1);
    
    const callArgs = mockTranscribeFile.mock.calls[0];
    // @ts-ignore
    const buffer = callArgs[0];
    // @ts-ignore
    const options = callArgs[1];
    
    expect(buffer).toBeDefined();
    expect((options as any).model).toBe("nova-3");
    expect((options as any).language).toBe("en");
    expect((options as any).smart_format).toBe(true);
  });

  test("should use provided language and boost words", async () => {
    const transcriber = new DeepgramTranscriber();
    await transcriber.transcribe(Buffer.from("audio"), "es", ["keyword1"]);
    
    // @ts-ignore
    const options = mockTranscribeFile.mock.calls[0][1];
    expect((options as any).language).toBe("es");
    expect((options as any).keywords).toEqual(["keyword1"]);
  });

  test("should fallback to Nova-2 on failure", async () => {
     const MAX_RETRIES = 2;
     const INITIAL_ATTEMPT = 1;
     const TOTAL_ATTEMPTS_BEFORE_FALLBACK = MAX_RETRIES + INITIAL_ATTEMPT;

     for (let i = 0; i < TOTAL_ATTEMPTS_BEFORE_FALLBACK; i++) {
        mockTranscribeFile.mockImplementationOnce(() => Promise.resolve({ error: { message: `Error ${i}` } } as any));
     }
     
     mockTranscribeFile.mockImplementationOnce(() => Promise.resolve({
        result: { results: { channels: [{ alternatives: [{ transcript: "Fallback transcript" }] }] } },
        error: null
     } as any));

     const transcriber = new DeepgramTranscriber();
     const result = await transcriber.transcribe(Buffer.from("fake audio"));

     expect(result).toBe("Fallback transcript");
     expect(mockTranscribeFile).toHaveBeenCalledTimes(TOTAL_ATTEMPTS_BEFORE_FALLBACK + 1);
     
     // @ts-ignore
     expect(mockTranscribeFile.mock.calls[0][1].model).toBe("nova-3");
     // @ts-ignore
     expect(mockTranscribeFile.mock.calls[TOTAL_ATTEMPTS_BEFORE_FALLBACK - 1][1].model).toBe("nova-3");
     
     // @ts-ignore
     expect(mockTranscribeFile.mock.calls[TOTAL_ATTEMPTS_BEFORE_FALLBACK][1].model).toBe("nova-2");
  });

  test("should throw specific error on 401 (Invalid API Key)", async () => {
     // Simulate 401 error
     mockTranscribeFile.mockResolvedValue({ error: { status: 401, message: "Unauthorized" } } as any);
     
     const transcriber = new DeepgramTranscriber();
     
     await expect(transcriber.transcribe(Buffer.from("audio"))).rejects.toThrow("Deepgram: Invalid API Key");
     // Should not retry on 401
     expect(mockTranscribeFile).toHaveBeenCalledTimes(1);
  });

  test("should throw specific error on 429 (Rate Limit)", async () => {
     // Simulate 429 error
     mockTranscribeFile.mockResolvedValue({ error: { status: 429, message: "Too Many Requests" } } as any);
     
     const transcriber = new DeepgramTranscriber();
     
     await expect(transcriber.transcribe(Buffer.from("audio"))).rejects.toThrow("Deepgram: Rate limit exceeded");
     // Should not retry on 429
     expect(mockTranscribeFile).toHaveBeenCalledTimes(1);
  });
});
