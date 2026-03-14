import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type MarkdownBodyProps = {
  content: string;
  emptyText?: string;
  className?: string;
};

export function MarkdownBody({
  content,
  emptyText = "(no content)",
  className
}: MarkdownBodyProps) {
  const normalized = content.trim();

  if (!normalized) {
    return <p className={cn("text-sm text-muted-foreground", className)}>{emptyText}</p>;
  }

  return (
    <article className={cn("text-blog-content text-text-primary", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => (
            <h1 className="mb-4 mt-8 font-display text-blog-heading-2 text-text-primary first:mt-0" {...props} />
          ),
          h2: (props) => (
            <h2
              className="mb-3 mt-8 border-b border-border-subtle pb-2 font-display text-heading-3-16-semibold text-text-primary"
              {...props}
            />
          ),
          h3: (props) => (
            <h3 className="mb-2 mt-6 font-display text-heading-3-16 text-text-primary" {...props} />
          ),
          p: (props) => <p className="mb-4 text-body-sm text-text-secondary md:text-body-md" {...props} />,
          a: (props) => (
            <a
              className="gh-link"
              target="_blank"
              rel="noreferrer"
              {...props}
            />
          ),
          ul: (props) => <ul className="mb-4 list-disc space-y-1.5 pl-6 text-body-sm text-text-secondary md:text-body-md" {...props} />,
          ol: (props) => <ol className="mb-4 list-decimal space-y-1.5 pl-6 text-body-sm text-text-secondary md:text-body-md" {...props} />,
          li: (props) => <li className="leading-7" {...props} />,
          blockquote: (props) => (
            <blockquote className="mb-4 border-l-2 border-fill-secondary pl-4 text-body-sm text-text-secondary md:text-body-md" {...props} />
          ),
          pre: (props) => (
            <pre
              className="mb-4 overflow-x-auto rounded-[16px] border border-border-subtle bg-surface-focus p-4"
              {...props}
            />
          ),
          code: (props) => {
            const className = props.className ?? "";
            const inline = !className.includes("language-");
            if (inline) {
              return (
                <code
                  className="rounded-xl border border-border-subtle bg-surface-focus px-1.5 py-0.5 font-mono text-body-micro text-text-primary"
                  {...props}
                />
              );
            }
            return <code className="font-mono text-code-sm leading-6 text-text-primary" {...props} />;
          },
          table: (props) => (
            <div className="mb-4 overflow-x-auto rounded-[16px] border border-border-subtle">
              <table className="w-full border-collapse text-body-sm" {...props} />
            </div>
          ),
          thead: (props) => <thead className="bg-surface-focus" {...props} />,
          th: (props) => <th className="border border-border-subtle px-3 py-2 text-left font-sans text-label-sm text-text-supporting" {...props} />,
          td: (props) => <td className="border border-border-subtle px-3 py-2 align-top text-body-sm text-text-secondary" {...props} />
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
