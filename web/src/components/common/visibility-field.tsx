import { Globe, Lock } from "lucide-react";
import { useId } from "react";

type Visibility = "private" | "public";
export function VisibilityField({
  value,
  onChange,
  name
}: {
  value: Visibility;
  onChange: (value: Visibility) => void;
  name?: string;
}) {
  const id = useId();
  return (
    <fieldset className="space-y-3">
      <legend className="font-sans text-label-sm text-text-primary">可见性</legend>
      {(
        [
          ["private", "私有", "只有你和协作者可以访问", Lock],
          ["public", "公开", "任何人都可以浏览和克隆", Globe]
        ] as const
      ).map(([option, title, description, Icon]) => (
        <label key={option} className="flex cursor-pointer items-center gap-3">
          <input
            type="radio"
            name={name ?? id}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
            className="accent-action-primaryBg"
          />
          <Icon className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
          <span>
            <span className="block text-body-xs font-medium">{title}</span>
            <span className="block text-body-micro text-text-tertiary">{description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
