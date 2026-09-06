const fs = require('node:fs');
const path = require('node:path');

const swcConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '.swcrc'), 'utf-8'),
);

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': ['@swc/jest', swcConfig] },
  testEnvironment: 'node',
};
