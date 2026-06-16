const colors: Record<string, string> = {
  done: "bg-green-400",
  needs_fix: "bg-yellow-400",
  in_progress: "bg-blue-400",
  blocked: "bg-red-400",
  deferred: "bg-gray-500",
};

export function StatusDot({ status }: { status: string }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${colors[status] || "bg-gray-600"}`} />
  );
}
