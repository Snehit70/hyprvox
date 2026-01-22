import { describe, expect, test } from "vitest";
import { ApiKeysSchema } from "../src/config/schema";

describe("API Key Validation (ApiKeysSchema)", () => {
  describe("Groq API Key", () => {
    test("should accept valid Groq API key", () => {
      const validKey = "gsk_1234567890abcdef";
      const result = ApiKeysSchema.safeParse({
        groq: validKey,
        deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab"
      });
      expect(result.success).toBe(true);
    });

    test("should reject Groq API key not starting with gsk_", () => {
      const invalidKey = "key_1234567890";
      const result = ApiKeysSchema.safeParse({
        groq: invalidKey,
        deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab"
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("Groq API key must start with 'gsk_'");
      }
    });

    test("should reject Groq API key that is too short", () => {
      const shortKey = "gsk_123";
      const result = ApiKeysSchema.safeParse({
        groq: shortKey,
        deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab"
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("Groq API key is too short");
      }
    });
  });

  describe("Deepgram API Key", () => {
    test("should accept valid Deepgram UUID key", () => {
      const validKey = "4b5c1234-5678-90ab-cdef-1234567890ab";
      const result = ApiKeysSchema.safeParse({
        groq: "gsk_1234567890",
        deepgram: validKey
      });
      expect(result.success).toBe(true);
    });

    test("should reject Deepgram key with invalid UUID format", () => {
      const invalidKey = "4b5c1234-5678-90ab-cdef-1234567890ag";
      const result = ApiKeysSchema.safeParse({
        groq: "gsk_1234567890",
        deepgram: invalidKey
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("Deepgram API key must be a valid UUID format");
      }
    });

    test("should reject Deepgram key without hyphens", () => {
      const invalidKey = "4b5c1234567890abcdef1234567890ab";
      const result = ApiKeysSchema.safeParse({
        groq: "gsk_1234567890",
        deepgram: invalidKey
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("Deepgram API key must be a valid UUID format");
      }
    });

    test("should reject Deepgram key that is too short", () => {
      const shortKey = "4b5c1234-5678-90ab-cdef";
      const result = ApiKeysSchema.safeParse({
        groq: "gsk_1234567890",
        deepgram: shortKey
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("Deepgram API key is too short");
      }
    });

    test("should reject Deepgram key that is too long", () => {
      const longKey = "4b5c1234-5678-90ab-cdef-1234567890ab-extra";
      const result = ApiKeysSchema.safeParse({
        groq: "gsk_1234567890",
        deepgram: longKey
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("Deepgram API key is too long");
      }
    });
  });
});
