const err = { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } }
const json = (d) => ({ description: d, content: { 'application/json': { schema: { type: 'object' } } } })
export const OPENAPI = {
  openapi: '3.0.3',
  info: { title: 'Disciplr API', version: '0.1.0', description: 'Commitment vaults on Stellar: lock funds against milestones; a verifier validates progress; funds release on success or redirect on failure.' },
  servers: [{ url: '/api' }],
  paths: {
    '/health': { get: { summary: 'Health check and active data store', responses: { 200: json('OK') } } },
    '/vaults': {
      get: { summary: 'List vaults', parameters: [{ name: 'creator', in: 'query', schema: { type: 'string' } }, { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'completed', 'failed'] } }], responses: { 200: json('Vault list') } },
      post: { summary: 'Create a vault', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['creator', 'verifier', 'amount', 'endDate', 'milestones'], properties: { name: { type: 'string' }, creator: { type: 'string' }, verifier: { type: 'string' }, amount: { type: 'number' }, startDate: { type: 'string', format: 'date-time' }, endDate: { type: 'string', format: 'date-time' }, successDestination: { type: 'string' }, failureDestination: { type: 'string' }, milestones: { type: 'array', items: { type: 'object', required: ['title', 'amount'], properties: { title: { type: 'string' }, amount: { type: 'number' }, dueDate: { type: 'string', format: 'date-time' } } } } } } } } }, responses: { 201: json('Created'), 400: err } },
    },
    '/vaults/{id}': { get: { summary: 'Get a vault with its activity', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: json('Vault'), 404: err } } },
    '/vaults/{id}/milestones/{mid}/validate': { post: { summary: 'Verifier validates a milestone (body: {verifier})', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'mid', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: json('Updated vault'), 403: err, 409: err } } },
    '/vaults/{id}/fail': { post: { summary: 'Verifier fails a vault; funds redirect (body: {verifier})', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: json('Updated vault'), 403: err, 409: err } } },
    '/vaults/{id}/onchain/stake': { post: { summary: 'Build the unsigned stake XDR for the creator to sign (requires SOROBAN_ENABLED=1 and a confirmed create_vault)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: json('Vault and {onChain: {xdr, networkPassphrase, operation}}'), 400: err, 404: err, 409: err } } },
    '/vaults/{id}/onchain/submit': { post: { summary: 'Submit the creator-signed create_vault or stake XDR; verified against the stored vault, relayed, and recorded with the real hash and ledger. Idempotent by tx hash. 202 = still pending, 422 = failed on-chain', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['signedXdr'], properties: { signedXdr: { type: 'string' }, networkPassphrase: { type: 'string' } } } } } }, responses: { 200: json('Confirmed'), 202: json('Pending'), 400: err, 404: err, 409: err, 422: json('Failed on-chain') } } },
    '/transactions': { get: { summary: 'Activity feed (create / validate / release / redirect)', parameters: [{ name: 'vaultId', in: 'query', schema: { type: 'string' } }], responses: { 200: json('Activity') } } },
    '/stats': { get: { summary: 'Aggregate statistics', parameters: [{ name: 'creator', in: 'query', schema: { type: 'string' } }], responses: { 200: json('Stats') } } },
  },
}
