import { env } from "./env.config.js";

export const schedulerConfig = {
  defaultMasuk: process.env.DEFAULT_MASUK,

  defaultPulang: process.env.DEFAULT_PULANG,

  defaultJumat: process.env.DEFAULT_JUMAT,

  defaultSabtu: process.env.DEFAULT_SABTU,
};
