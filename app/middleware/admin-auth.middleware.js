import { isAdminAuthenticated } from '../services/index.js';

const PUBLIC_PATHS = new Set([
  '/login',
  '/privacy',
  '/privacy.html',
  '/forgot-password',
  '/forgot-password.html',
  '/auth/login',
  '/favicon.svg',
  '/api/system/live',
  '/api/system/ready',
]);

function isPublicAsset(pathname) {
  return (
    pathname.startsWith('/css/') ||
    pathname === '/js/login.js' ||
    pathname === '/js/auth-ui.js'
  );
}

function wantsHtml(req) {
  const accept = req.headers.accept || '';
  return req.method === 'GET' && accept.includes('text/html');
}

function requireAdmin(req, res, next) {
  if (PUBLIC_PATHS.has(req.path) || isPublicAsset(req.path)) {
    return next();
  }

  if (isAdminAuthenticated(req)) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({
      error: 'Authentication required',
      code: 'ADMIN_AUTH_REQUIRED',
    });
  }

  if (wantsHtml(req) || req.path.endsWith('.html') || req.path === '/') {
    const nextUrl = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/login?next=${nextUrl}`);
  }

  return res.status(401).send('Authentication required');
}

export { requireAdmin };
