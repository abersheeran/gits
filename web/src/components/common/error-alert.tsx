import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
export function ErrorAlert({ error }: { error?: string | null }) {
  return error ? (
    <Alert variant="destructive">
      <AlertTitle>操作失败</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;
}
