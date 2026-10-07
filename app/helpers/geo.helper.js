const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

/**
 * Menghasilkan titik acak yang tersebar merata di dalam lingkaran radius
 * tertentu dari koordinat pusat.
 *
 * Math.sqrt(Math.random()) dipakai agar distribusi titik merata berdasarkan
 * luas area, bukan menumpuk di sekitar titik pusat.
 */
export function randomPointInRadius(latitude, longitude, radiusMeters = 0) {
  const centerLat = Number(latitude);
  const centerLng = Number(longitude);
  const radius = Math.max(0, Number(radiusMeters) || 0);

  if (!Number.isFinite(centerLat) || centerLat < -90 || centerLat > 90) {
    throw new Error(`Latitude tidak valid: ${latitude}`);
  }

  if (!Number.isFinite(centerLng) || centerLng < -180 || centerLng > 180) {
    throw new Error(`Longitude tidak valid: ${longitude}`);
  }

  if (radius === 0) {
    return {
      latitude: centerLat,
      longitude: centerLng,
      distanceMeters: 0,
    };
  }

  const distanceMeters = Math.sqrt(Math.random()) * radius;
  const bearing = Math.random() * 2 * Math.PI;
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;

  const lat1 = toRadians(centerLat);
  const lng1 = toRadians(centerLng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );

  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  // Normalisasi longitude ke rentang -180..180.
  const normalizedLng = ((toDegrees(lng2) + 540) % 360) - 180;

  return {
    latitude: toDegrees(lat2),
    longitude: normalizedLng,
    distanceMeters,
  };
}
