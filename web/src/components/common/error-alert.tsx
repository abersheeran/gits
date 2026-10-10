import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
export function ErrorAlert({
  error,
  title = "操作失败",
  inset = false
}: {
  error?: string | null;
  title?: string;
  inset?: boolean;
}) {
  return error ? (
    <Alert
      variant="destructive"
      className={inset ? "rounded-none border-x-0 border-t-0" : undefined}
    >
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;
}
