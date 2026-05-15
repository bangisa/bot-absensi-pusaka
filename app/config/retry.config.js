import { env } from "./env.config.js";

export const retryConfig = {
  maxRetry: env.MAX_RETRY,

  retryDelay: env.RETRY_DELAY,
};
