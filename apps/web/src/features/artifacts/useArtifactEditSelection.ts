import { useCallback } from "react";
import type { ClientMessage } from "../../domain/chat/sessionModel";
import type { PageThemeMode } from "../../runtime/streamui/types";
import { selectArtifactEditVersion } from "./artifactEditOperationModel";

export type UseArtifactEditSelectionInput = {
  themeMode: PageThemeMode;
  updateMessage(
    messageId: string,
    updater: (message: ClientMessage) => ClientMessage
  ): void;
  clearSelections(): void;
};

export function useArtifactEditSelection({
  themeMode,
  updateMessage,
  clearSelections
}: UseArtifactEditSelectionInput) {
  return useCallback(
    (assistantId: string, editId?: string) => {
      let didSelect = false;
      updateMessage(assistantId, (message) => {
        const result = selectArtifactEditVersion(message, editId, themeMode);
        didSelect ||= result.selected;
        return result.message;
      });
      if (didSelect) {
        clearSelections();
      }
    },
    [clearSelections, themeMode, updateMessage]
  );
}
