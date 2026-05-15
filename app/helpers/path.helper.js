import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

export function resolvePath(metaUrl) {
  const __filename = fileURLToPath(metaUrl);
  const __dirname = dirname(__filename);

  return {
    __filename,
    __dirname,

    resolve: (...paths) => resolve(__dirname, ...paths),
  };
}
