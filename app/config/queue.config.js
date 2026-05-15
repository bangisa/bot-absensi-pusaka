import { env } from "./env.config.js";

export const queueConfig = {
  maxConcurrent: env.MAX_CONCURRENT,

  taskTimeout: env.TASK_TIMEOUT,
};
