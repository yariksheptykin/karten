'use strict';
// Gemeinsame Testwerte. Alles erfunden, keine echten Zugangsdaten.
const path = require('path');

module.exports = {
  PORT: 8765,
  BASE_URL: 'http://localhost:8765/',
  API_URL: 'http://localhost:8765/exec',
  READ_TOKEN: 'TEST-READ-TOKEN-0123456789abcdef',
  WRITE_SECRET: 'test-write-secret',
  PERSONAL_TOKEN: 'NRA234', // aus tests/fixtures/zugaenge.csv, gehört zu "Nora"
  DATA_DIR: path.join(__dirname, '..', '..', '.mock-data'),
};
