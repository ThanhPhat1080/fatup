import { randomBytes } from 'node:crypto';

const token = randomBytes(32).toString('base64url');
console.log(token);
console.error('\nSave it on the Worker with:  npx wrangler secret put API_TOKEN');
