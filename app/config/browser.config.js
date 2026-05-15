import { env } from "./env.config.js";

export const browserConfig = {
  headless: env.HEADLESS,

  baseUrl: env.BASE_URL,

  botDelay: env.BOT_DELAY,

  navigationTimeout: env.NAVIGATION_TIMEOUT,

  elementTimeout: env.ELEMENT_TIMEOUT,
};
