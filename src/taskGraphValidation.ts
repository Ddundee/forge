export interface PlannedTask {
  title: string;
  type: string;
  deps: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeDeps(value: unknown, index: number): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) {
    throw new Error(`Task graph item ${index + 1} has invalid deps; expected an array of titles.`);
  }
  return value
    .map((dep) => String(dep).trim())
    .filter(Boolean);
}

export function normalizeTaskGraph(value: unknown): PlannedTask[] {
  const rawTasks = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value["tasks"])
      ? value["tasks"]
      : undefined;

  if (!rawTasks) {
    throw new Error("Task graph must be a JSON array of tasks.");
  }

  return rawTasks.map((task, index) => {
    if (!isRecord(task)) {
      throw new Error(`Task graph item ${index + 1} must be an object.`);
    }

    const title =
      nonEmptyString(task["title"]) ??
      nonEmptyString(task["name"]) ??
      nonEmptyString(task["task"]);
    if (!title) {
      throw new Error(`Task graph item ${index + 1} is missing a title.`);
    }

    return {
      title,
      type: nonEmptyString(task["type"]) ?? "coding",
      deps: normalizeDeps(task["deps"] ?? task["dependencies"], index),
    };
  });
}
