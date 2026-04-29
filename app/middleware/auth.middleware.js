function authMiddleware(req, res, next) {
  // 🔐 cek session
  if (req.session && req.session.isLogin) {
    return next();
  }

  // 🔥 bedakan API vs browser
  const isApi = req.originalUrl.startsWith("/api");

  if (isApi) {
    return res.status(401).json({
      error: "Unauthorized",
    });
  }

  // default: redirect ke login page
  return res.redirect("/login.html");
}

module.exports = {
  authMiddleware,
};
