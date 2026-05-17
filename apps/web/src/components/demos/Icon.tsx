// Ported from kc:frontend/src/components/Icon.jsx (JSX → TSX).
// Local to the demos directory so each demo stays self-contained.

export type IconName =
  | "search"
  | "arrow-right"
  | "arrow-left"
  | "check"
  | "check-circle"
  | "x"
  | "plus"
  | "sparkle"
  | "shield"
  | "code"
  | "box"
  | "star"
  | "github"
  | "git-branch"
  | "zap"
  | "users"
  | "inbox"
  | "wallet";

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  stroke?: number;
}

export default function Icon({
  name,
  size = 16,
  color = "currentColor",
  stroke = 1.6,
}: IconProps) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: color,
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (name) {
    case "search":
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg {...props}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case "arrow-left":
      return (
        <svg {...props}>
          <path d="M19 12H5M11 6l-6 6 6 6" />
        </svg>
      );
    case "check":
      return (
        <svg {...props}>
          <path d="M5 12l4 4 10-10" />
        </svg>
      );
    case "check-circle":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12l3 3 5-5" />
        </svg>
      );
    case "x":
      return (
        <svg {...props}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case "plus":
      return (
        <svg {...props}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "sparkle":
      return (
        <svg {...props}>
          <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
        </svg>
      );
    case "shield":
      return (
        <svg {...props}>
          <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
        </svg>
      );
    case "code":
      return (
        <svg {...props}>
          <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" />
        </svg>
      );
    case "box":
      return (
        <svg {...props}>
          <path d="M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4M21 7v10l-9 4" />
        </svg>
      );
    case "star":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill={color}>
          <path d="M12 2l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-7z" />
        </svg>
      );
    case "github":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill={color}>
          <path d="M12 1.5C6.2 1.5 1.5 6.2 1.5 12c0 4.6 3 8.6 7.2 10 .5.1.7-.2.7-.5v-1.9c-2.9.6-3.6-1.4-3.6-1.4-.5-1.2-1.2-1.6-1.2-1.6-1-.7.1-.6.1-.6 1 .1 1.6 1.1 1.6 1.1 1 1.6 2.5 1.2 3.1.9 0-.7.4-1.2.7-1.5-2.3-.3-4.8-1.2-4.8-5.2 0-1.2.4-2.1 1.1-2.9-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 2.9 1.1.8-.2 1.7-.3 2.6-.3.9 0 1.8.1 2.6.3 2-1.4 2.9-1.1 2.9-1.1.6 1.5.2 2.6.1 2.9.7.8 1.1 1.7 1.1 2.9 0 4-2.5 4.9-4.8 5.2.4.3.7.9.7 1.8v2.7c0 .3.2.6.7.5 4.2-1.4 7.2-5.4 7.2-10 0-5.8-4.7-10.5-10.5-10.5z" />
        </svg>
      );
    case "git-branch":
      return (
        <svg {...props}>
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 01-9 9" />
        </svg>
      );
    case "zap":
      return (
        <svg {...props}>
          <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
        </svg>
      );
    case "users":
      return (
        <svg {...props}>
          <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 00-3-3.87" />
          <path d="M16 3.13a4 4 0 010 7.75" />
        </svg>
      );
    case "inbox":
      return (
        <svg {...props}>
          <path d="M3 13h4l2 3h6l2-3h4M3 13l3-8h12l3 8M3 13v6h18v-6" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...props}>
          <path d="M3 7h14a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM3 7V5a2 2 0 012-2h11" />
          <circle cx="16" cy="13" r="1.3" fill={color} />
        </svg>
      );
    default:
      return null;
  }
}
