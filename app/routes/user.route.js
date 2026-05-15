import { Router } from "express";
const router = Router();

import controller from "../controllers/user.controller.js";

router.post("/", controller.create);
router.get("/", controller.findAll);
router.post("/bulk", controller.bulkCreate);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);

export default router;
