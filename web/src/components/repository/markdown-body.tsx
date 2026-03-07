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
    <article className={cn("text-[14px] leading-7 text-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => <h1 className="mb-3 mt-6 text-2xl font-semibold first:mt-0" {...props} />,
          h2: (props) => <h2 className="mb-2 mt-6 border-b pb-1 text-xl font-semibold" {...props} />,
          h3: (props) => <h3 className="mb-2 mt-5 text-lg font-semibold" {...props} />,
          p: (props) => <p className="mb-3" {...props} />,
          a: (props) => (
            <a
              className="text-[#0969da] underline-offset-2 hover:underline"
              target="_blank"
              rel="noreferrer"
              {...props}
            />
          ),
          ul: (props) => <ul className="mb-3 list-disc space-y-1 pl-6" {...props} />,
          ol: (props) => <ol className="mb-3 list-decimal space-y-1 pl-6" {...props} />,
          li: (props) => <li className="leading-7" {...props} />,
          blockquote: (props) => (
            <blockquote className="mb-3 border-l-4 border-border pl-4 text-muted-foreground" {...props} />
          ),
          pre: (props) => <pre className="mb-3 overflow-x-auto rounded-md bg-[#f6f8fa] p-3" {...props} />,
          code: (props) => {
            const className = props.className ?? "";
            const inline = !className.includes("language-");
            if (inline) {
              return (
                <code
                  className="rounded bg-[#f6f8fa] px-1.5 py-0.5 font-mono text-[12px] text-[#24292f]"
                  {...props}
                />
              );
            }
            return <code className="font-mono text-[12px] leading-6" {...props} />;
          },
          table: (props) => (
            <div className="mb-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm" {...props} />
            </div>
          ),
          thead: (props) => <thead className="bg-muted/30" {...props} />,
          th: (props) => <th className="border px-3 py-2 text-left font-medium" {...props} />,
          td: (props) => <td className="border px-3 py-2 align-top" {...props} />
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
