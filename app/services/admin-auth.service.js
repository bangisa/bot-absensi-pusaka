import bcrypt from 'bcrypt';
import { authConfig } from '../config/index.js';

function isAdminAuthenticated(req) {
  return Boolean(req.session?.admin?.authenticated === true);
}

async function verifyAdminCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') {
    return false;
  }

  const usernameMatches = username.trim() === authConfig.adminUsername;
  if (!usernameMatches) return false;

  return bcrypt.compare(password, authConfig.adminPasswordHash);
}

function establishAdminSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);

      req.session.admin = {
        authenticated: true,
        username: authConfig.adminUsername,
        authenticatedAt: new Date().toISOString(),
      };

      req.session.save((saveErr) => {
        if (saveErr) return reject(saveErr);
        resolve();
      });
    });
  });
}

function destroyAdminSession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export {
  destroyAdminSession,
  establishAdminSession,
  isAdminAuthenticated,
  verifyAdminCredentials,
};
