'use strict';

require('dotenv').config();

const { createApp } = require('./src/app');
const { createLogger } = require('./src/lib/logger');

const log  = createLogger('server');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

createApp()
  .then((app) => {
    app.listen(port, host, () => {
      log.info(`GHL Voice AI Copilot listening on http://${host}:${port}`);
    });
  })
  .catch((err) => {
    // Fatal startup error (e.g. DB unreachable) — log and exit
    console.error('[FATAL] Server failed to start:', err.message);
    process.exit(1);
  });
