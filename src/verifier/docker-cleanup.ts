export function stopTimedOutContainer(name: string, run: (args: string[]) => {error?: unknown; status: number | null; stdout: string}) {
  run(['kill', name]);
  const remaining = run(['ps', '-aq', '--filter', 'name=^/' + name + '$']);
  if (remaining.error || remaining.status !== 0 || remaining.stdout.trim()) throw new Error('CONTAINER_TERMINATION_UNVERIFIED');
}
