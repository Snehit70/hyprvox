import { describe, it, expect, mock } from "bun:test";
import { withRetry } from "../src/utils/retry";

describe("withRetry", () => {
  it("should return result if operation succeeds", async () => {
    const operation = mock(async () => "success");
    const result = await withRetry(operation);
    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should retry on failure", async () => {
    let attempts = 0;
    const operation = mock(async () => {
      attempts++;
      if (attempts === 1) throw new Error("fail");
      return "success";
    });

    const result = await withRetry(operation, { maxRetries: 1, backoffs: [1] });
    expect(result).toBe("success");
    expect(attempts).toBe(2);
  });

  it("should fail after max retries", async () => {
    const operation = mock(async () => {
      throw new Error("fail");
    });

    try {
      await withRetry(operation, { maxRetries: 1, backoffs: [1] });
    } catch (e) {
      expect(e).toBeDefined();
    }
    expect(operation).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });

  it("should timeout if operation takes too long", async () => {
    const operation = mock(async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      return "success";
    });

    try {
      await withRetry(operation, { timeout: 10, maxRetries: 0 });
      // Should not reach here
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toContain("timed out");
    }
  });
});
