import { describe, it, expect, vi, beforeEach } from "vitest";
import { TranscriptMerger } from "../../src/transcribe/merger";
import Groq from "groq-sdk";
import testCases from "./samples/merger_test_cases.json";
import { loadConfig } from "../../src/config/loader";
import { logError } from "../../src/utils/logger";

const mockGroqCreate = vi.fn();
vi.mock("groq-sdk", () => {
  return {
    default: class {
      chat = {
        completions: {
          create: mockGroqCreate,
        },
      };
    },
  };
});

vi.mock("../../src/config/loader", () => ({
  loadConfig: vi.fn().mockReturnValue({
    apiKeys: { groq: "gsk_test_key_12345" },
    transcription: { language: "en" },
  }),
}));

vi.mock("../../src/utils/logger", () => ({
  logError: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("TranscriptMerger Integration", () => {
  let merger: TranscriptMerger;

  beforeEach(() => {
    vi.clearAllMocks();
    merger = new TranscriptMerger();
  });

  it("should initialize with correct API key from config", () => {
    expect(loadConfig).toHaveBeenCalled();
  });

  describe("Sample Transcripts Merging", () => {
    testCases.forEach((tc) => {
      it(`should correctly merge sample: ${tc.name}`, async () => {
        mockGroqCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: tc.ideal,
              },
            },
          ],
        });

        const result = await merger.merge(tc.groq, tc.deepgram);

        expect(result).toBe(tc.ideal);

        expect(mockGroqCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: "llama-3.3-70b-versatile",
            temperature: 0.1,
            messages: expect.arrayContaining([
              expect.objectContaining({
                role: "system",
                content: expect.stringContaining("Trust Transcript 1 for specific words"),
              }),
              expect.objectContaining({
                role: "user",
                content: expect.stringContaining(tc.groq),
              }),
              expect.objectContaining({
                role: "user",
                content: expect.stringContaining(tc.deepgram),
              }),
            ]),
          }),
          expect.objectContaining({
            timeout: 30000,
          })
        );
      });
    });
  });

  describe("Integration Logic & Edge Cases", () => {
    it("should handle parallel-ready execution flow (idempotent)", async () => {
      mockGroqCreate.mockResolvedValue({
        choices: [{ message: { content: "Merged Result" } }],
      });

      const promise1 = merger.merge("groq1", "deepgram1");
      const promise2 = merger.merge("groq2", "deepgram2");

      const [res1, res2] = await Promise.all([promise1, promise2]);

      expect(res1).toBe("Merged Result");
      expect(res2).toBe("Merged Result");
      expect(mockGroqCreate).toHaveBeenCalledTimes(2);
    });

    it("should fallback to Deepgram transcript when LLM fails after retries", async () => {
      const error: any = new Error("API Overloaded");
      error.status = 429;
      mockGroqCreate.mockRejectedValue(error);

      const groqText = "technical word";
      const deepgramText = "Technical word.";
      
      const result = await merger.merge(groqText, deepgramText);

      expect(result).toBe(deepgramText);
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining("LLM merge skipped (Rate Limit exceeded after retries)"),
        expect.any(Error)
      );
    });

    it("should fallback to Groq transcript when Deepgram is empty and LLM fails", async () => {
      mockGroqCreate.mockRejectedValue(new Error("Fatal Error"));
      
      const groqText = "Only Groq has this.";
      const deepgramText = "";
      
      const result = await merger.merge(groqText, deepgramText);

      expect(result).toBe(groqText);
    });

    it("should skip LLM call if transcripts are identical", async () => {
      const text = "Same text on both sides.";
      const result = await merger.merge(text, text);

      expect(result).toBe(text);
      expect(mockGroqCreate).not.toHaveBeenCalled();
    });

    it("should skip LLM call if one transcript is empty", async () => {
      const text = "Some text.";
      
      expect(await merger.merge(text, "")).toBe(text);
      expect(await merger.merge("", text)).toBe(text);
      expect(mockGroqCreate).not.toHaveBeenCalled();
    });

    it("should retry exactly 2 times (total 3 attempts) for server errors (500)", async () => {
      const error: any = new Error("Server Error");
      error.status = 500;
      mockGroqCreate.mockRejectedValue(error);

      await merger.merge("g", "d");

      expect(mockGroqCreate).toHaveBeenCalledTimes(3);
    });

    it("should NOT retry for authentication errors (401)", async () => {
      const error: any = new Error("Unauthorized");
      error.status = 401;
      mockGroqCreate.mockRejectedValue(error);

      await merger.merge("g", "d");

      expect(mockGroqCreate).toHaveBeenCalledTimes(1);
    });
  });
});
