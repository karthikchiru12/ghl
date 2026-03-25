'use strict';

const { decryptUserData } = require('../services/context');
const { getInstalledLocations } = require('../services/installations');

async function resolveRequestContext(req, _res, next) {
  const headerValue = req.get('x-ghl-context');

  if (!headerValue) {
    req.ghlContext = null;
    return next();
  }

  try {
    const user = decryptUserData(headerValue);
    const installedLocations = await getInstalledLocations({ companyId: user.companyId || null });
    req.ghlContext = {
      user,
      installedLocations,
      activeLocationId: user.activeLocation || null,
    };
    return next();
  } catch (error) {
    return next(Object.assign(error, { status: error.status || 401 }));
  }
}

function requireLocationAccess(req, res, next) {
  const requestedLocationId = req.params.locationId;
  const context = req.ghlContext;

  if (!requestedLocationId) {
    return next();
  }

  if (!context) {
    if (process.env.ALLOW_UNSCOPED_DEV === 'true') {
      return next();
    }
    return res.status(401).json({ ok: false, error: 'Missing embedded HighLevel context' });
  }

  const allowedLocationIds = new Set(
    (context.installedLocations || []).map((location) => location.location_id)
  );

  if (context.activeLocationId && requestedLocationId !== context.activeLocationId) {
    return res.status(403).json({ ok: false, error: 'Cross-location access is not allowed for this session' });
  }

  if (!allowedLocationIds.has(requestedLocationId)) {
    return res.status(403).json({ ok: false, error: 'This location is not installed for the current session' });
  }

  return next();
}

module.exports = { resolveRequestContext, requireLocationAccess };
