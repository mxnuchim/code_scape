import { main } from "./index";

main().catch((err) => {
  console.error("[codescape]", err instanceof Error ? err.message : err);
  process.exit(1);
});
