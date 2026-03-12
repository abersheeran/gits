import animate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          canvas: "var(--color-surface-canvas)",
          base: "var(--color-surface-base)",
          elevated: "var(--color-surface-elevated)",
          focus: "var(--color-surface-focus)",
          glass: "var(--color-surface-glass)",
          hover: "var(--color-surface-hover)",
          overlay: "var(--color-surface-overlay)",
          glassBright: "var(--color-surface-glass-bright)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
          supporting: "var(--text-supporting)",
          supportingStrong: "var(--text-supporting-strong)",
          inverse: "var(--text-inverse)",
        },
        border: {
          DEFAULT: "var(--border-default)",
          subtle: "var(--border-subtle)",
          muted: "var(--border-muted)",
          strong: "var(--border-strong)",
        },
        fill: {
          primary: "var(--color-fill-primary)",
          secondary: "var(--color-fill-secondary)",
          tertiary: "var(--color-fill-tertiary)",
        },
        action: {
          primaryBg: "var(--color-action-primary-bg)",
        },
        danger: {
          DEFAULT: "var(--color-danger-bg)",
          foreground: "var(--text-inverse)",
          surface: "var(--color-danger-surface)",
          border: "var(--border-danger)",
          text: "var(--text-danger)",
        },
        success: {
          DEFAULT: "var(--color-status-success)",
          foreground: "var(--text-inverse)",
          surface: "var(--color-status-success-muted)",
        },
        background: "var(--color-surface-canvas)",
        foreground: "var(--text-primary)",
        input: "var(--border-default)",
        ring: "var(--color-surface-focus)",
        primary: {
          DEFAULT: "var(--color-action-primary-bg)",
          foreground: "var(--text-inverse)",
        },
        secondary: {
          DEFAULT: "var(--color-fill-primary)",
          foreground: "var(--text-primary)",
        },
        muted: {
          DEFAULT: "var(--color-surface-focus)",
          foreground: "var(--text-supporting)",
        },
        accent: {
          DEFAULT: "var(--color-surface-hover)",
          foreground: "var(--text-primary)",
        },
        popover: {
          DEFAULT: "var(--color-surface-elevated)",
          foreground: "var(--text-primary)",
        },
        card: {
          DEFAULT: "var(--color-surface-base)",
          foreground: "var(--text-primary)",
        },
        destructive: {
          DEFAULT: "var(--color-danger-bg)",
          foreground: "var(--text-inverse)",
        },
      },
      boxShadow: {
        container:
          "inset 0 0 0 0.5px rgba(15,14,13,0.06), 0 1px 2px rgba(15,14,13,0.02)",
        "container-elevated":
          "0 18px 40px -24px rgba(15,14,13,0.25), 0 6px 18px rgba(15,14,13,0.06), inset 0 0 0 0.5px rgba(15,14,13,0.04)",
        button:
          "0 6px 16px -10px rgba(15,14,13,0.25), inset 0 0 0 0.5px rgba(255,255,255,0.16)",
        popover:
          "0 28px 48px -28px rgba(15,14,13,0.25), 0 10px 24px rgba(15,14,13,0.12), inset 0 0 0 0.5px rgba(15,14,13,0.04)",
        "button-elevated":
          "0 16px 24px -16px rgba(15,14,13,0.3), inset 0 -2px 8px rgba(255,255,255,0.2)",
      },
      spacing: {
        "page-gutter": "var(--layout-gutter-mobile)",
        "layout-mobile-gutter": "var(--layout-gutter-mobile)",
        "layout-mobile-content": "var(--layout-content-mobile)",
        "layout-mobile-inset": "var(--layout-content-mobile-inset)",
        "layout-mobile-footer": "var(--layout-content-mobile-footer)",
      },
      maxWidth: {
        page: "73rem",
      },
      fontFamily: {
        display: ["Onest", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "hero-display": ["48px", { lineHeight: "64px", fontWeight: "400" }],
        "section-heading": ["36px", { lineHeight: "42px", fontWeight: "300" }],
        "section-heading-mobile": ["24px", { lineHeight: "42px", fontWeight: "400" }],
        "card-heading-mobile": ["26px", { lineHeight: "36px", fontWeight: "400" }],
        "card-title": [
          "18px",
          {
            lineHeight: "26px",
            fontWeight: "400",
            letterSpacing: "0.18px",
          },
        ],
        "heading-3-16": [
          "16px",
          { lineHeight: "24px", fontWeight: "400", letterSpacing: "0.16px" },
        ],
        "heading-3-16-semibold": [
          "16px",
          { lineHeight: "24px", fontWeight: "600", letterSpacing: "0.16px" },
        ],
        "heading-3-15": [
          "15px",
          { lineHeight: "22px", fontWeight: "600", letterSpacing: "0.15px" },
        ],
        "heading-4": [
          "15px",
          { lineHeight: "22px", fontWeight: "400", letterSpacing: "0.15px" },
        ],
        "button-lg": ["16px", { lineHeight: "24px", fontWeight: "600" }],
        "button-md": ["15px", { lineHeight: "20px", fontWeight: "600" }],
        "button-sm": ["14px", { lineHeight: "20px", fontWeight: "600" }],
        "body-md": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "body-sm": ["15px", { lineHeight: "20px", fontWeight: "400" }],
        "body-xs": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "body-micro": ["12px", { lineHeight: "16px", fontWeight: "400" }],
        "body-tiny": ["10px", { lineHeight: "12px", fontWeight: "400" }],
        "label-md": ["15px", { lineHeight: "20px", fontWeight: "600" }],
        "label-sm": ["14px", { lineHeight: "20px", fontWeight: "600" }],
        "label-xs": ["12px", { lineHeight: "16px", fontWeight: "600" }],
        "label-xs-tight": ["12px", { lineHeight: "12px", fontWeight: "600" }],
        "item-compact": ["13px", { lineHeight: "18px", fontWeight: "600" }],
        "link-sm": ["14px", { lineHeight: "21px", fontWeight: "600" }],
        "link-md": [
          "18px",
          { lineHeight: "26px", fontWeight: "400", letterSpacing: "0.18px" },
        ],
        "link-underline": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "code-sm": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "blog-heading-1": ["36px", { lineHeight: "42px", fontWeight: "400" }],
        "blog-heading-2": ["26px", { lineHeight: "36px", fontWeight: "400" }],
        "blog-heading-3": [
          "18px",
          { lineHeight: "26px", fontWeight: "600", letterSpacing: "0.18px" },
        ],
        "blog-heading-4": ["16px", { lineHeight: "24px", fontWeight: "600" }],
        "blog-content": ["16px", { lineHeight: "28px", fontWeight: "400" }],
      },
      height: {
        "control-mobile": "var(--control-height-mobile)",
        "control-compact": "var(--control-height-compact)",
      },
      borderRadius: {
        lg: "var(--radius-lg)",
        md: "calc(var(--radius-lg) - 4px)",
        sm: "calc(var(--radius-lg) - 10px)",
        pill: "var(--radius-pill)",
        xl: "var(--radius-xl)",
      },
    },
  },
  plugins: [animate],
};
