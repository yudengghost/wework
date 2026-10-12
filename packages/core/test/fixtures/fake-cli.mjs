const args = process.argv.slice(2);

const flagValue = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const has = (name) => args.includes(name);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const dumpIndex = args.indexOf("--dump-args");
  if (dumpIndex !== -1) {
    process.stdout.write(`${JSON.stringify(args.slice(dumpIndex + 1))}\n`);
  }

  const stderrText = flagValue("--stderr");
  if (stderrText !== undefined) {
    process.stderr.write(`${stderrText}\n`);
  }

  const captureTo = flagValue("--capture-to");
  const wantsStdin = captureTo !== undefined || has("--echo-stdin");

  if (wantsStdin) {
    let input = "";
    process.stdin.setEncoding("utf8");
    await new Promise((resolve) => {
      process.stdin.on("data", (chunk) => {
        input += chunk;
      });
      process.stdin.on("end", resolve);
    });

    if (captureTo !== undefined) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(captureTo, JSON.stringify({ argv: args, stdin: input }, null, 2), "utf8");
    }
    if (has("--echo-stdin")) {
      process.stdout.write(`${JSON.stringify({ stdin: input })}\n`);
    }
  }

  const lineCount = Number(flagValue("--lines") ?? 0);
  const lineDelay = Number(flagValue("--line-delay") ?? 0);
  for (let index = 1; index <= lineCount; index += 1) {
    process.stdout.write(`${JSON.stringify({ type: "line", n: index })}\n`);
    if (lineDelay > 0) await sleep(lineDelay);
  }

  const fixturePath = flagValue("--emit-fixture");
  if (fixturePath !== undefined) {
    const { readFile } = await import("node:fs/promises");
    const contents = await readFile(fixturePath, "utf8");
    process.stdout.write(contents.endsWith("\n") ? contents : `${contents}\n`);
  }

  const slowMs = Number(flagValue("--sleep") ?? 0);
  if (slowMs > 0) await sleep(slowMs);

  process.exit(Number(flagValue("--exit") ?? 0));
}

void main();
