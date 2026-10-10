import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import type { CollaboratorPermission } from "@/lib/api";
export function PermissionSelect({
  value,
  onChange,
  disabled,
  id,
  label = "权限"
}: {
  value: CollaboratorPermission;
  onChange: (value: CollaboratorPermission) => void;
  disabled?: boolean;
  id?: string;
  label?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(value) => onChange(value as CollaboratorPermission)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="read">只读</SelectItem>
        <SelectItem value="write">读写</SelectItem>
        <SelectItem value="admin">管理</SelectItem>
      </SelectContent>
    </Select>
  );
}
