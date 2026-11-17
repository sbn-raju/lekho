/**
 * npm run keys:generate
 *
 * Prints a new RSA-2048 key pair formatted for .env / a secret store. Rotation: deploy the new
 * private key as JWT_PRIVATE_KEY with a new JWT_KEY_ID, and move the old public key into
 * JWT_PREVIOUS_PUBLIC_KEYS until the last token it signed has expired (ACCESS_TOKEN_TTL_SECONDS).
 */
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const oneLine = (pem: string) => pem.trim().replace(/\n/g, '\\n');
const kid = `lekho-${new Date().toISOString().slice(0, 10)}`;

console.log(`JWT_KEY_ID=${kid}`);
console.log(`JWT_PRIVATE_KEY="${oneLine(privateKey)}"`);
console.log(`\n# Public key (for JWT_PREVIOUS_PUBLIC_KEYS after the next rotation):\n# ${oneLine(publicKey)}`);
