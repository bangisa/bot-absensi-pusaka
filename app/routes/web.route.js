import { Router } from "express";

import { resolvePath } from "../helpers/index.js";

const router = Router();

const path = resolvePath(import.meta.url);

router.get("/", (req, res) => {
  res.sendFile(path.resolve("public", "index.html"));
});

export default router;
