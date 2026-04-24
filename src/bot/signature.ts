export const BLASTR_TAG = 'launched via @printrblastrbot on Telegram';

/** Always append the blastr signature to a user's description before submission. */
export function appendBlastrTag(userDescription: string | undefined): string {
  const trimmed = (userDescription ?? '').trim();
  return trimmed ? `${trimmed} | ${BLASTR_TAG}` : BLASTR_TAG;
}
