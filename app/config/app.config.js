import { env } from "./env.config.js";

export const appConfig = {
  port: env.PORT,

  env: env.NODE_ENV,

  secret: env.APP_SECRET,

  autoStart: env.AUTO_START,

  isProduction: env.NODE_ENV === "production",

  sessionMaxAge: env.SESSION_MAX_AGE_MS,
};
