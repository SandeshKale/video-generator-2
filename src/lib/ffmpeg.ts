/** Thin wrapper around Bun.spawn for ffmpeg/ffprobe -- no fluent-ffmpeg
 * dependency needed, Bun's own spawn covers everything this pipeline uses. */

/** `-loglevel error` by default -- ffmpeg's normal stderr output (codec
 * banners, per-frame progress) drowns out real errors and floods test/CI
 * logs. Pass `verbose: true` when you actually want to see progress
 * (e.g. a long soak-test render run by hand). */
export async function runFfmpeg(args: string[], opts: { verbose?: boolean } = {}): Promise<void> {
  const logArgs = opts.verbose ? [] : ["-loglevel", "error"];
  const proc = Bun.spawn(["ffmpeg", "-y", ...logArgs, ...args], { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ffmpeg exited ${code}: ffmpeg ${args.join(" ")}`);
}

export async function runFfprobeJson(args: string[]): Promise<any> {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-of", "json", ...args], { stdout: "pipe", stderr: "inherit" });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ffprobe exited ${code}: ffprobe ${args.join(" ")}`);
  return JSON.parse(out);
}
