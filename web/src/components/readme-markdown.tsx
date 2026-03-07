import { MarkdownBody } from "@/components/repository/markdown-body";

type ReadmeMarkdownProps = {
  content: string;
};

export function ReadmeMarkdown({ content }: ReadmeMarkdownProps) {
  return <MarkdownBody content={content} />;
}
