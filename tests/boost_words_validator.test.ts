import { describe, expect, it } from "vitest";
import { boostWordsValidator } from "../src/config/schema";

describe("boostWordsValidator", () => {
  it("should return true for undefined words", () => {
    expect(boostWordsValidator(undefined)).toBe(true);
  });

  it("should return true for empty array", () => {
    expect(boostWordsValidator([])).toBe(true);
  });

  it("should return true for words within the 450 limit", () => {
    const words = ["hello", "world", "this is a test"];
    expect(boostWordsValidator(words)).toBe(true);
  });

  it("should count words correctly across multiple entries", () => {
    const words = ["one two three", "four five", "six"];
    expect(boostWordsValidator(words)).toBe(true);
  });

  it("should handle extra whitespace and newlines", () => {
    const words = ["  one   two  \n three  ", "\t four \r\n five "];
    expect(boostWordsValidator(words)).toBe(true);
  });

  it("should return true for exactly 450 words", () => {
    const words = Array(450).fill("word");
    expect(boostWordsValidator(words)).toBe(true);
  });

  it("should return true for exactly 450 words spread across entries", () => {
    const words = Array(150).fill("one two three");
    expect(boostWordsValidator(words)).toBe(true);
  });

  it("should return false for more than 450 words", () => {
    const words = Array(451).fill("word");
    expect(boostWordsValidator(words)).toBe(false);
  });

  it("should return false for more than 450 words spread across entries", () => {
    const words = [...Array(150).fill("one two three"), "extra"];
    expect(boostWordsValidator(words)).toBe(false);
  });

  it("should handle mixed content entries correctly", () => {
    const words = [
      "AI ML",
      "LLM",
      "Deep Learning",
      "Natural Language Processing",
      "Sisyphus voice-cli Groq Deepgram"
    ];
    expect(boostWordsValidator(words)).toBe(true);
  });
});
