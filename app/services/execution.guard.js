const executed = new Map();
const TTL = 60 * 1000;

function shouldRun(userId, type) {
  const key = `${userId}-${type}`;
  const currentTime = Date.now();

  if (executed.has(key)) {
    const lastRun = executed.get(key);

    if (currentTime - lastRun < TTL) {
      console.log(`[GUARD] Skip ${key}`);
      return false;
    }
  }

  executed.set(key, currentTime);
  return true;
}

export { shouldRun };
