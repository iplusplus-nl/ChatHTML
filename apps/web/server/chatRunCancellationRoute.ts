import type { Request, Response } from "express";
import {
  waitForChatRunCancellationResponse,
  type ChatRunTerminalResult
} from "./chatRunTerminalCoordinator.js";

export type ChatRunCancellationTarget = {
  runId: string;
  requestId: string;
  cancel(): ChatRunTerminalResult;
};

export function createChatRunCancellationHandler(options: {
  findRun(runId: string): ChatRunCancellationTarget | undefined;
  registerUnknownRunCancellation?(runId: string): boolean;
  warn?(message: string, error: unknown): void;
}) {
  return async function handleCancelChatRun(
    req: Request,
    res: Response
  ): Promise<void> {
    const rawRunId = req.params.runId;
    const runId = typeof rawRunId === "string"
      ? rawRunId.trim().slice(0, 160)
      : "";
    const run = options.findRun(runId);
    if (!run) {
      if (runId && options.registerUnknownRunCancellation) {
        try {
          const transitioned = options.registerUnknownRunCancellation(runId);
          res.json({ runId, outcome: "cancelled", transitioned });
        } catch (error) {
          (options.warn ?? console.warn)(
            `[chat:${runId}] could not register cancellation intent`,
            error
          );
          res.status(500).json({ error: "Could not register chat cancellation." });
        }
        return;
      }
      res.status(404).json({ error: "Chat run not found." });
      return;
    }

    try {
      res.json(
        await waitForChatRunCancellationResponse(run.runId, run.cancel())
      );
    } catch (error) {
      (options.warn ?? console.warn)(
        `[chat:${run.requestId}] could not persist cancellation`,
        error
      );
      res.status(500).json({ error: "Could not persist chat cancellation." });
    }
  };
}
