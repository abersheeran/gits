export const appStyles = `
  :root {
    --background: hsl(36 33% 96%);
    --foreground: hsl(20 18% 15%);
    --card: hsl(0 0% 100% / 88%);
    --card-foreground: hsl(20 18% 15%);
    --popover: hsl(0 0% 100%);
    --popover-foreground: hsl(20 18% 15%);
    --primary: hsl(19 88% 44%);
    --primary-foreground: hsl(0 0% 100%);
    --secondary: hsl(40 38% 91%);
    --secondary-foreground: hsl(20 18% 15%);
    --muted: hsl(35 18% 90%);
    --muted-foreground: hsl(24 12% 38%);
    --accent: hsl(40 56% 86%);
    --accent-foreground: hsl(20 18% 15%);
    --destructive: hsl(5 84% 47%);
    --destructive-foreground: hsl(0 0% 100%);
    --border: hsl(30 22% 82%);
    --input: hsl(30 22% 82%);
    --ring: hsl(19 88% 44%);
    --radius: 14px;
    --font-sans: "DM Sans", "Avenir Next", "Helvetica Neue", "Noto Sans", sans-serif;
    --font-serif: "Iowan Old Style", "Book Antiqua", "Palatino Linotype", serif;
    --font-mono: "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace;
  }

  * {
    box-sizing: border-box;
  }

  html,
  body {
    margin: 0;
    min-height: 100%;
  }

  body {
    color: var(--foreground);
    background:
      radial-gradient(circle at 0% 0%, hsl(26 95% 88%) 0%, transparent 33%),
      radial-gradient(circle at 100% 10%, hsl(39 95% 84%) 0%, transparent 30%),
      linear-gradient(180deg, hsl(43 44% 95%) 0%, hsl(32 35% 93%) 60%, hsl(40 44% 96%) 100%);
    font-family: var(--font-sans);
    line-height: 1.55;
  }

  a {
    color: inherit;
  }

  code {
    font-family: var(--font-mono);
    font-size: 0.86rem;
    background: hsl(34 36% 90%);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.08rem 0.34rem;
  }

  .container {
    width: min(1080px, 92vw);
    margin: 0 auto;
  }

  .stack {
    display: grid;
    gap: 1rem;
  }

  .topbar-wrap {
    position: sticky;
    top: 0;
    z-index: 30;
    backdrop-filter: blur(8px);
    background: hsl(42 50% 96% / 0.75);
    border-bottom: 1px solid var(--border);
  }

  .topbar {
    min-height: 68px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
    color: var(--foreground);
  }

  .brand-mark {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    background: var(--primary);
    color: var(--primary-foreground);
    font-size: 0.85rem;
    font-weight: 700;
    font-family: var(--font-mono);
  }

  .brand-text {
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .nav-row {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  .card {
    background: var(--card);
    color: var(--card-foreground);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 12px 28px hsl(26 29% 40% / 0.08);
  }

  .card-header {
    padding: 1.1rem 1.1rem 0.7rem;
  }

  .card-content {
    padding: 0 1.1rem 1.1rem;
  }

  .card-footer {
    padding: 0 1.1rem 1.1rem;
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  .card-title {
    margin: 0;
    font-family: var(--font-serif);
    font-size: 1.24rem;
    line-height: 1.2;
    letter-spacing: 0.01em;
  }

  .card-description {
    margin: 0.35rem 0 0;
    color: var(--muted-foreground);
    font-size: 0.95rem;
  }

  .btn {
    -webkit-appearance: none;
    appearance: none;
    border: 1px solid transparent;
    border-radius: calc(var(--radius) - 6px);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    padding: 0.48rem 0.9rem;
    min-height: 2.2rem;
    text-decoration: none;
    font-size: 0.92rem;
    font-weight: 600;
    transition: transform 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
  }

  .btn:hover {
    transform: translateY(-1px);
  }

  .btn[data-copied=\"1\"]::after {
    content: \"已复制\";
    font-size: 0.77rem;
    margin-left: 0.2rem;
    opacity: 0.82;
  }

  .btn:focus-visible,
  .input:focus-visible,
  .textarea:focus-visible,
  .select:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }

  .btn-default {
    background: var(--primary);
    color: var(--primary-foreground);
  }

  .btn-secondary {
    background: var(--secondary);
    border-color: var(--border);
    color: var(--secondary-foreground);
  }

  .btn-ghost {
    background: transparent;
    border-color: var(--border);
    color: var(--foreground);
  }

  .btn-danger {
    background: var(--destructive);
    color: var(--destructive-foreground);
  }

  .field {
    display: grid;
    gap: 0.4rem;
  }

  .field + .field {
    margin-top: 0.8rem;
  }

  .label {
    font-size: 0.9rem;
    font-weight: 600;
  }

  .input,
  .textarea,
  .select {
    width: 100%;
    border: 1px solid var(--input);
    border-radius: calc(var(--radius) - 8px);
    background: hsl(40 60% 98%);
    color: var(--foreground);
    padding: 0.52rem 0.72rem;
    font-size: 0.95rem;
    font-family: inherit;
  }

  .textarea {
    resize: vertical;
    min-height: 6.8rem;
  }

  .hint {
    margin: 0;
    color: var(--muted-foreground);
    font-size: 0.84rem;
  }

  .alert {
    border-radius: calc(var(--radius) - 5px);
    border: 1px solid var(--border);
    padding: 0.66rem 0.78rem;
    font-size: 0.92rem;
    line-height: 1.4;
  }

  .alert-info {
    background: hsl(45 75% 95%);
  }

  .alert-success {
    background: hsl(120 35% 94%);
    border-color: hsl(120 28% 80%);
  }

  .alert-error {
    background: hsl(6 79% 95%);
    border-color: hsl(6 58% 80%);
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 0.86rem;
  }

  .muted {
    color: var(--muted-foreground);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    border: 1px solid var(--border);
    padding: 0.08rem 0.58rem;
    font-size: 0.77rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    background: hsl(0 0% 100% / 0.7);
  }

  .badge-private {
    background: hsl(18 88% 90%);
    border-color: hsl(18 62% 74%);
    color: hsl(12 72% 30%);
  }

  .badge-public {
    background: hsl(130 42% 92%);
    border-color: hsl(126 30% 78%);
    color: hsl(120 46% 26%);
  }

  .grid-two {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  }

  .grid-three {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .table-wrap {
    width: 100%;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) - 5px);
    background: hsl(0 0% 100% / 0.75);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92rem;
  }

  th,
  td {
    text-align: left;
    border-bottom: 1px solid var(--border);
    padding: 0.62rem 0.74rem;
    vertical-align: top;
  }

  th {
    color: var(--muted-foreground);
    font-size: 0.81rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    font-weight: 700;
  }

  tr:last-child td {
    border-bottom: none;
  }

  .hero {
    padding: 1.35rem;
    border-radius: calc(var(--radius) + 4px);
    border: 1px solid hsl(29 54% 78%);
    background:
      linear-gradient(135deg, hsl(26 95% 92%), hsl(43 80% 92%));
  }

  .hero h1 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: clamp(1.6rem, 3.3vw, 2.35rem);
    line-height: 1.15;
  }

  .hero p {
    margin: 0.6rem 0 0;
    color: hsl(22 20% 28%);
    max-width: 68ch;
  }

  .section-title {
    margin: 0;
    font-size: 1rem;
    letter-spacing: 0.01em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }

  .repo-row {
    display: grid;
    gap: 0.4rem;
  }

  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .hr {
    height: 1px;
    border: 0;
    background: var(--border);
    margin: 0.35rem 0 0.8rem;
  }

  .danger-zone {
    border-color: hsl(8 46% 76%);
    background: hsl(6 80% 96% / 0.8);
  }

  .empty {
    border: 1px dashed var(--border);
    border-radius: calc(var(--radius) - 6px);
    padding: 0.9rem;
    color: var(--muted-foreground);
    background: hsl(0 0% 100% / 0.5);
  }

  .footer {
    padding: 1.2rem 0 2rem;
    color: var(--muted-foreground);
    font-size: 0.84rem;
  }

  .check-row {
    display: inline-flex;
    align-items: center;
    gap: 0.48rem;
    font-size: 0.9rem;
  }

  @media (max-width: 640px) {
    .topbar {
      min-height: 58px;
    }

    .container {
      width: min(1080px, 94vw);
    }
  }
`;
