import { MessagePrimitive } from "@assistant-ui/react";
import type { ReactNode } from "react";
import type { SessionFile } from "../domain/chat/sessionModel";

type ChatMessageProps = {
  role: "user" | "assistant";
  files?: SessionFile[];
  children: ReactNode;
};

export function ChatMessage({
  role,
  files = [],
  children
}: ChatMessageProps) {
  return (
    <MessagePrimitive.Root className={`chat-row ${role}`}>
      <div className="avatar" aria-hidden="true">
        {role === "user" ? "U" : "S"}
      </div>
      <div className={`message-bubble ${role}`}>
        {children ? <p>{children}</p> : null}
        {files.length > 0 ? (
          <div className="message-attachments" aria-label="Attached files">
            {files.map((file) => (
              file.kind === "image" && (file.embedUrl || file.dataUrl) ? (
                <img
                  key={file.id}
                  src={file.embedUrl || file.dataUrl}
                  alt={file.name}
                  loading="lazy"
                />
              ) : (
                <span className="message-file-chip" key={file.id}>
                  {file.name}
                </span>
              )
            ))}
          </div>
        ) : null}
      </div>
    </MessagePrimitive.Root>
  );
}
