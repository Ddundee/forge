import { createInterface } from "readline";

type OnInterrupt = (redirect: string) => Promise<void>;
type OnSessionInfo = () => void;

export class InterruptHandler {
  private running = false;

  constructor(
    private onInterrupt: OnInterrupt,
    private onSessionInfo?: OnSessionInfo,
  ) {}

  start(): void {
    if (!process.stdin.isTTY) return;
    this.running = true;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", this.handleKey);
  }

  stop(): void {
    this.running = false;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
    process.stdin.off("data", this.handleKey);
  }

  private handleKey = async (key: string): Promise<void> => {
    if (!this.running) return;
    if (key === "i") {
      process.stdin.setRawMode(false);
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question("\nRedirect (or Enter to skip): ", async (answer) => {
        rl.close();
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        if (answer.trim()) await this.onInterrupt(answer.trim());
      });
    } else if (key === "s") {
      this.onSessionInfo?.();
    } else if (key === "q" || key === "Q") {
      process.stdin.setRawMode(false);
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question("\nSave and quit? [y/N]: ", (answer) => {
        rl.close();
        if (answer.toLowerCase() === "y") process.exit(0);
        else if (process.stdin.isTTY) process.stdin.setRawMode(true);
      });
    } else if (key === "") {
      process.exit(0);
    }
  };
}
