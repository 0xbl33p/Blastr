/**
 * Fetch the latest Printr Anchor IDL from on-chain and update the pinned copy
 * at src/printr/idl.json. Surfaces a diff so we never silently absorb breaking
 * changes — if the on-chain IDL added/removed/renamed instructions, this prints
 * a summary and you decide whether to commit the new file.
 *
 * Usage: npm run update-idl
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { inflate } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const inflateAsync = promisify(inflate);

const PROGRAM_ID = new PublicKey('T8HsGYv7sMk3kTnyaRqZrbRPuntYzdh12evXBkprint');
const RPC_URL =
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const IDL_PATH = resolve('src', 'printr', 'idl.json');

interface IxArg { name: string; type: unknown }
interface IxAccount { name: string }
interface AnchorIx { name: string; args: IxArg[]; accounts: IxAccount[] }
interface AnchorIdl {
  instructions: AnchorIx[];
  accounts?: { name: string }[];
  types?: { name: string }[];
}

/**
 * Anchor IDL is stored at a deterministic PDA: createWithSeed(base, "anchor:idl", programId)
 * where base is the program's no-seed PDA.
 */
async function deriveIdlAddress(programId: PublicKey): Promise<PublicKey> {
  const [base] = PublicKey.findProgramAddressSync([], programId);
  return PublicKey.createWithSeed(base, 'anchor:idl', programId);
}

async function fetchOnChainIdl(): Promise<AnchorIdl> {
  const idlAddr = await deriveIdlAddress(PROGRAM_ID);
  console.log(`fetching IDL from ${idlAddr.toBase58()}`);

  const conn = new Connection(RPC_URL, 'confirmed');
  const acc = await conn.getAccountInfo(idlAddr);
  if (!acc) throw new Error(`no account at ${idlAddr.toBase58()}`);

  // Anchor IDL account layout:
  //   [0..8]   discriminator
  //   [8..40]  authority pubkey
  //   [40..44] data length (u32 LE)
  //   [44..]   zlib-deflated JSON
  const dataLen = acc.data.readUInt32LE(40);
  const compressed = acc.data.subarray(44, 44 + dataLen);
  const decompressed = await inflateAsync(compressed);
  return JSON.parse(decompressed.toString('utf-8')) as AnchorIdl;
}

function summarizeIxs(idl: AnchorIdl): Map<string, string> {
  const m = new Map<string, string>();
  for (const ix of idl.instructions ?? []) {
    const sig = `args=[${ix.args.map((a) => a.name).join(',')}] accounts=${ix.accounts.length}`;
    m.set(ix.name, sig);
  }
  return m;
}

function diff(local: AnchorIdl, remote: AnchorIdl): { changes: string[]; breaking: boolean } {
  const localIxs = summarizeIxs(local);
  const remoteIxs = summarizeIxs(remote);
  const changes: string[] = [];
  let breaking = false;

  for (const [name, sig] of remoteIxs) {
    const oldSig = localIxs.get(name);
    if (!oldSig) {
      changes.push(`  + new instruction: ${name} (${sig})`);
    } else if (oldSig !== sig) {
      changes.push(`  ~ changed: ${name}\n      was: ${oldSig}\n      now: ${sig}`);
      breaking = true;
    }
  }
  for (const [name] of localIxs) {
    if (!remoteIxs.has(name)) {
      changes.push(`  - removed instruction: ${name}`);
      breaking = true;
    }
  }
  return { changes, breaking };
}

async function main() {
  const remote = await fetchOnChainIdl();
  let local: AnchorIdl | null = null;
  try {
    local = JSON.parse(await readFile(IDL_PATH, 'utf-8')) as AnchorIdl;
  } catch {
    console.log(`no existing IDL at ${IDL_PATH} — saving fresh copy`);
  }

  if (local) {
    const { changes, breaking } = diff(local, remote);
    if (changes.length === 0) {
      console.log('✓ IDL unchanged. Nothing to do.');
      return;
    }
    console.log(`\n${breaking ? '⚠️  BREAKING' : '·'} ${changes.length} change(s) detected:\n`);
    for (const c of changes) console.log(c);
    console.log();
  }

  await writeFile(IDL_PATH, JSON.stringify(remote, null, 2) + '\n', 'utf-8');
  console.log(`✓ wrote ${IDL_PATH}`);
  console.log(`  instructions: ${remote.instructions.length}`);
  console.log(`  accounts:     ${(remote.accounts ?? []).length}`);
  console.log(`  types:        ${(remote.types ?? []).length}`);
  console.log(`\nReview the diff (\`git diff src/printr/idl.json\`), then commit.`);
}

main().catch((err) => {
  console.error('failed to update IDL:', err.message);
  process.exit(1);
});
