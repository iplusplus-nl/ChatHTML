import type { ReactNode } from "react";

type ChatShellProps = {
  children: ReactNode;
  sidebar?: ReactNode;
  themeMode?: "day" | "night";
};

export function ChatShell({ children, sidebar, themeMode = "night" }: ChatShellProps) {
  return (
    <main className="app-shell" data-theme={themeMode}>
      {sidebar}
      <section className="chat-workspace">{children}</section>
    </main>
  );
}
