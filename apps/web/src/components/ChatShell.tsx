import type { ReactNode } from "react";

type ChatShellProps = {
  children: ReactNode;
  sidebar?: ReactNode;
};

export function ChatShell({ children, sidebar }: ChatShellProps) {
  return (
    <main className="app-shell">
      {sidebar}
      <section className="chat-workspace">{children}</section>
    </main>
  );
}
