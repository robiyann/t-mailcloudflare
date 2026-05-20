const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ZYVENOX API',
      version: '1.0.0',
      description: 'Private temporary email service. Token-based secure access only.',
    },
    components: {
      securitySchemes: {
        api_key: {
          type: 'apiKey',
          name: 'X-API-Key',
          in: 'header',
        },
      },
    },
    servers: [
      {
        url: 'https://mail.zyvenox.my.id/api',
        description: 'Production',
      },
      {
        url: '/api',
        description: 'Current host',
      },
    ],
    tags: [
      { name: 'Mailboxes', description: 'Create inboxes and read emails' },
      { name: 'Domains', description: 'List available domains' },
    ],
  },
  apis: ['./src/routes/*.js'],
};

const fullSpecs = swaggerJsdoc(options);

// Filter out internal/admin paths (Inbound webhook - only for Cloudflare Worker)
const publicPaths = {};
for (const [path, methods] of Object.entries(fullSpecs.paths || {})) {
  const filteredMethods = {};
  for (const [method, op] of Object.entries(methods)) {
    const tags = op.tags || [];
    if (!tags.includes('Inbound')) {
      filteredMethods[method] = op;
    }
  }
  if (Object.keys(filteredMethods).length > 0) {
    publicPaths[path] = filteredMethods;
  }
}

fullSpecs.paths = publicPaths;

module.exports = fullSpecs;
