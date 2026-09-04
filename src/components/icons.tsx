import type { SVGProps } from "react";

export type IconName =
  | "home" | "tickets" | "team" | "clients" | "truck" | "warehouse" | "catalog"
  | "users" | "settings" | "chart" | "more" | "plus" | "back" | "logout" | "search" | "close" | "user" | "shield" | "print" | "download";

const paths: Record<IconName, string> = {
  home: "M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10",
  tickets: "M4 6h16M4 12h16M4 18h10",
  team: "M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Zm-9 9a5 5 0 0 1 10 0M20 8v6M17 11h6",
  clients: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M15 10h.01M9 14h.01M15 14h.01",
  truck: "M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  warehouse: "M3 9 12 4l9 5v11H3zM8 20v-6h8v6M8 14h8",
  catalog: "M4 5h16v4H4zM4 10h16v4H4zM4 15h16v4H4z",
  users: "M17 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7 9v-1a4 4 0 0 0-3-3.87M14.5 4.13a3.5 3.5 0 0 1 0 6.74",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5A7.4 7.4 0 0 0 4.6 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2Z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  plus: "M12 5v14M5 12h14",
  back: "M15 5l-7 7 7 7",
  logout: "M10 17l5-5-5-5M15 12H3M13 3h6v18h-6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.3-4.3",
  close: "M6 6l12 12M18 6 6 18",
  user: "M20 21v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  shield: "M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3ZM9 12l2 2 4-4",
  print: "M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z",
  download: "M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
};

export function Icon({ name, size = 20, strokeWidth = 1.9, ...rest }: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
