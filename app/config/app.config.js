import { env } from "./env.config.js";

export const appConfig = {
  port: env.PORT,

  env: env.NODE_ENV,

  secret: env.APP_SECRET,

  autoStart: env.AUTO_START,

  isProduction: env.NODE_ENV === "production",

  sessionMaxAge: 1000 * 60 * 60 * 8,
};
