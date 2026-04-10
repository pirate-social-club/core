export function nowIso(date = new Date()): string {
  return date.toISOString();
}

export function plusSecondsEpoch(date: Date, seconds: number): number {
  return Math.floor(date.getTime() / 1000) + seconds;
}
