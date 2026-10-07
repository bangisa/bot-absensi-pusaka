import { env } from "./env.config.js";

export const geoConfig = {
  defaultLat: env.DEFAULT_LAT,

  defaultLng: env.DEFAULT_LNG,

  radiusMeters: Math.max(0, env.GEO_RADIUS_METERS),
};
