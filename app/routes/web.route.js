import { Router } from "express";

import { resolvePath } from "../helpers/index.js";

const router = Router();

const path = resolvePath(import.meta.url);

router.get("/login", (req, res) => {
  res.sendFile(path.resolve("../../public", "login.html"));
});


router.get("/privacy", (req, res) => {
  res.sendFile(path.resolve("../../public", "privacy.html"));
});

router.get("/forgot-password", (req, res) => {
  res.sendFile(path.resolve("../../public", "forgot-password.html"));
});

router.get("/", (req, res) => {
  res.sendFile(path.resolve("../../public", "index.html"));
});

export default router;
