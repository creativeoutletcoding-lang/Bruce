export type TaskStepStatus = "pending" | "working" | "done" | "error" | "cancelled";

export interface TaskStep {
  id: string;
  label: string;
  status: TaskStepStatus;
  detail?: string;
  error?: string;
}

export interface TaskProgressData {
  task: string;
  steps: TaskStep[];
}

export function extractLatestTaskProgress(text: string): TaskProgressData | null {
  const re = /<task_progress>([\s\S]*?)<\/task_progress>/g;
  let latest: TaskProgressData | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      latest = JSON.parse(m[1]) as TaskProgressData;
    } catch {
      // malformed JSON — skip
    }
  }
  return latest;
}

export function stripTaskProgressTags(text: string): string {
  // Remove complete blocks
  let result = text.replace(/<task_progress>[\s\S]*?<\/task_progress>/g, "");
  // Remove any partial block (opening tag without closing tag)
  result = result.replace(/<task_progress>[\s\S]*/g, "");
  return result;
}
