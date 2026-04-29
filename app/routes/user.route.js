const express = require("express");
const router = express.Router();

const controller = require("../controllers/user.controller");

router.post("/", controller.create);
router.get("/", controller.getAll);
router.post("/bulk", controller.bulkCreate);
router.delete("/:id", controller.remove);

module.exports = router;
