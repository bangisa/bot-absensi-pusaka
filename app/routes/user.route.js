import { Router } from "express";
const router = Router();

import controller from "../controllers/user.controller.js";

// Public admin UI surface intentionally kept minimal:
// - create user
// - list users
// - delete user
// Editing uses PATCH; bulk creation remains unavailable.
router.patch("/:id", controller.update);
router.post("/", controller.create);
router.get("/", controller.findAll);
router.delete("/:id", controller.remove);

export default router;
