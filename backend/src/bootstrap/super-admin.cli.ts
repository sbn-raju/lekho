/**
 * npm run iam:bootstrap-super-admin
 *
 * Reads BOOTSTRAP_SUPER_ADMIN_{EMAIL,FIRST_NAME,LAST_NAME,PASSWORD} from the environment (inject
 * them from your deployment's secret store), or prompts for anything missing when run in a
 * terminal. Never put these values in a committed file.
 */
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { BootstrapError, bootstrapSuperAdmin } from './super-admin.bootstrap.js';

function ask(question: string, { hidden = false } = {}): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // Suppress echo of typed characters while still showing the prompt.
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
      if (s.startsWith(question)) write(s);
    };
  }
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    }),
  );
}

async function value(envKey: string, prompt: string, hidden = false): Promise<string> {
  const fromEnv = process.env[envKey];
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) throw new BootstrapError(`${envKey} is not set and no terminal is available to prompt for it.`);
  return ask(prompt, { hidden });
}

async function main() {
  const email = await value('BOOTSTRAP_SUPER_ADMIN_EMAIL', 'Super Admin email: ');
  const firstName = await value('BOOTSTRAP_SUPER_ADMIN_FIRST_NAME', 'First name: ');
  const lastName = await value('BOOTSTRAP_SUPER_ADMIN_LAST_NAME', 'Last name: ');
  let password = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
  if (!password) {
    password = await value('BOOTSTRAP_SUPER_ADMIN_PASSWORD', 'Password (min 12 chars): ', true);
    if ((await ask('Confirm password: ', { hidden: true })) !== password) throw new BootstrapError('Passwords do not match.');
  }

  await connectDatabase();
  try {
    const { userId } = await bootstrapSuperAdmin({ email, firstName, lastName, password });
    console.log(`\nSuper Admin created (user ${userId}). Store the credentials in your password manager and remove BOOTSTRAP_* variables from the environment.`);
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err) => {
  if (err instanceof BootstrapError) console.error(`\nBootstrap failed: ${err.message}`);
  else if (err instanceof z.ZodError) console.error('\nBootstrap failed:', z.flattenError(err).fieldErrors);
  else console.error('\nBootstrap failed:', err);
  process.exit(1);
});
