/** Public path serving the raw OpenAPI 3 JSON document. */
export const OPENAPI_JSON_PATH = '/openapi.json';

/** Public path serving the interactive Scalar reference UI. */
export const OPENAPI_REFERENCE_PATH = '/reference';

/** Security-scheme key referenced by operations requiring a JWT bearer token. */
export const BEARER_SCHEME_NAME = 'bearer';

export const API_TITLE = 'Cybernetics API';
export const API_VERSION = '1.0.0';
export const API_DESCRIPTION = [
  'HTTP API for the Cybernetics platform.',
  '',
  'Authenticate with a JWT bearer token (`Authorization: Bearer <token>`).',
  'Endpoints marked as public require no authentication.',
  'All errors share a single envelope shape (`ErrorEnvelope`).',
].join('\n');

/** One tag per feature module; drives Scalar's sidebar grouping. */
export const OPENAPI_TAGS: ReadonlyArray<{ name: string; description: string }> =
  [
    { name: 'Auth', description: 'Login, tokens, password reset, service credentials.' },
    { name: 'Users', description: 'User account management.' },
    { name: 'Search', description: 'Collections and record search (search-service).' },
    { name: 'Files', description: 'File upload, download, and processing.' },
    { name: 'Mailbox', description: 'Inbound mail ingestion and retrieval.' },
    { name: 'Agent', description: 'Mastra AI agent: chat, schedules, approvals.' },
    { name: 'System', description: 'SMTP/IMAP config, settings, integration credentials, audit.' },
  ];
