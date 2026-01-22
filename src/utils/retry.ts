import { logError } from "./logger";

interface RetryOptions {
  maxRetries?: number;
  backoffs?: number[];
  operationName?: string;
  timeout?: number;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const backoffs = options.backoffs ?? [100, 200];
  const opName = options.operationName ?? "Operation";
  const timeoutMs = options.timeout;
  
  let lastError: any;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      if (timeoutMs) {
        return await new Promise<T>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(`${opName} timed out after ${timeoutMs}ms`));
          }, timeoutMs);

          operation()
            .then((result) => {
              clearTimeout(timer);
              resolve(result);
            })
            .catch((err) => {
              clearTimeout(timer);
              reject(err);
            });
        });
      }
      return await operation();
    } catch (error) {
      lastError = error;
      const attempt = i + 1;
      const totalAttempts = maxRetries + 1;
      
      if (i < maxRetries) {
        logError(`${opName} attempt ${attempt}/${totalAttempts} failed`, error);
        const delay = backoffs[i] ?? backoffs[backoffs.length - 1] ?? 200;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  logError(`${opName} failed after ${maxRetries} retries`, lastError);
  throw lastError;
}
