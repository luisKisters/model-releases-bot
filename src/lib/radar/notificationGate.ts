export function isBaselinePollRun(lastContentHash: string | null | undefined): boolean {
  return !lastContentHash;
}

export function shouldSendNotification(
  isBaseline: boolean,
  signalShouldNotify: boolean,
): boolean {
  return !isBaseline && signalShouldNotify;
}
