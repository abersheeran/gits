import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type SelectOption<TValue extends string> = {
  value: TValue;
  label: ReactNode;
};

type LabeledSelectFieldProps<TValue extends string> = {
  id: string;
  label: ReactNode;
  value: TValue;
  onValueChange: (value: TValue) => void;
  options: readonly SelectOption<TValue>[];
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
};

export function LabeledSelectField<TValue extends string>({
  id,
  label,
  value,
  onValueChange,
  options,
  placeholder,
  className,
  triggerClassName
}: LabeledSelectFieldProps<TValue>) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue as TValue)}>
        <SelectTrigger id={id} className={triggerClassName}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
