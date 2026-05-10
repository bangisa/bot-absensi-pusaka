import { Router } from "express";
const router = Router();

import controller from "../controllers/user.controller.js";

router.post("/", controller.create);
router.get("/", controller.getAll);
router.post("/bulk", controller.bulkCreate);
router.delete("/:id", controller.remove);

export { router };
