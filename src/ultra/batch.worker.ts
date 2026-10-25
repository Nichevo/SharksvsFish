/// <reference lib="webworker" />
import type { UltraSettings } from "../engine/ultra";
import { runJob, type BatchJob } from "./batch";

interface Request {
  base: Omit<UltraSettings, "seed">;
  maxTicks: number;
  jobs: BatchJob[];
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { base, maxTicks, jobs } = e.data;
  for (const job of jobs) self.postMessage(runJob(base, maxTicks, job));
  self.postMessage("done");
};
