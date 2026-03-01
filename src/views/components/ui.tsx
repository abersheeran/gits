import type { JSX } from "hono/jsx";

type ClassValue = string | Promise<string> | false | null | undefined;

function cx(...values: ClassValue[]): string {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
}

type ButtonVariant = "default" | "secondary" | "ghost" | "danger";

type ButtonProps = JSX.IntrinsicElements["button"] & {
  variant?: ButtonVariant;
};

export function Button(props: ButtonProps) {
  const { variant = "default", class: className, type, ...rest } = props;
  return (
    <button
      type={type ?? "button"}
      class={cx("btn", `btn-${variant}`, className)}
      {...rest}
    />
  );
}

type LinkButtonProps = JSX.IntrinsicElements["a"] & {
  variant?: ButtonVariant;
};

export function LinkButton(props: LinkButtonProps) {
  const { variant = "default", class: className, ...rest } = props;
  return <a class={cx("btn", `btn-${variant}`, className)} {...rest} />;
}

export function Card(props: JSX.IntrinsicElements["section"]) {
  const { class: className, ...rest } = props;
  return <section class={cx("card", className)} {...rest} />;
}

export function CardHeader(props: JSX.IntrinsicElements["header"]) {
  const { class: className, ...rest } = props;
  return <header class={cx("card-header", className)} {...rest} />;
}

export function CardContent(props: JSX.IntrinsicElements["div"]) {
  const { class: className, ...rest } = props;
  return <div class={cx("card-content", className)} {...rest} />;
}

export function CardFooter(props: JSX.IntrinsicElements["footer"]) {
  const { class: className, ...rest } = props;
  return <footer class={cx("card-footer", className)} {...rest} />;
}

export function CardTitle(props: JSX.IntrinsicElements["h2"]) {
  const { class: className, ...rest } = props;
  return <h2 class={cx("card-title", className)} {...rest} />;
}

export function CardDescription(props: JSX.IntrinsicElements["p"]) {
  const { class: className, ...rest } = props;
  return <p class={cx("card-description", className)} {...rest} />;
}

export function Label(props: JSX.IntrinsicElements["label"]) {
  const { class: className, ...rest } = props;
  return <label class={cx("label", className)} {...rest} />;
}

export function Input(props: JSX.IntrinsicElements["input"]) {
  const { class: className, ...rest } = props;
  return <input class={cx("input", className)} {...rest} />;
}

export function Textarea(props: JSX.IntrinsicElements["textarea"]) {
  const { class: className, ...rest } = props;
  return <textarea class={cx("textarea", className)} {...rest} />;
}

export function Select(props: JSX.IntrinsicElements["select"]) {
  const { class: className, ...rest } = props;
  return <select class={cx("select", className)} {...rest} />;
}

type BadgeProps = JSX.IntrinsicElements["span"] & {
  tone?: "private" | "public" | "neutral";
};

export function Badge(props: BadgeProps) {
  const { class: className, tone = "neutral", ...rest } = props;
  return (
    <span
      class={cx(
        "badge",
        tone === "private" && "badge-private",
        tone === "public" && "badge-public",
        className
      )}
      {...rest}
    />
  );
}

type AlertProps = JSX.IntrinsicElements["div"] & {
  tone?: "info" | "success" | "error";
};

export function Alert(props: AlertProps) {
  const { class: className, tone = "info", ...rest } = props;
  return <div role="status" class={cx("alert", `alert-${tone}`, className)} {...rest} />;
}

export function TableWrap(props: JSX.IntrinsicElements["div"]) {
  const { class: className, ...rest } = props;
  return <div class={cx("table-wrap", className)} {...rest} />;
}

export function Field(props: JSX.IntrinsicElements["div"]) {
  const { class: className, ...rest } = props;
  return <div class={cx("field", className)} {...rest} />;
}

export function Empty(props: JSX.IntrinsicElements["div"]) {
  const { class: className, ...rest } = props;
  return <div class={cx("empty", className)} {...rest} />;
}
